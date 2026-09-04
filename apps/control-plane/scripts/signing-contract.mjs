import { spawnSync } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { sha256File } from "./lib.mjs";

const REQUIRED_SIGNING_ENVIRONMENT = Object.freeze([
  "RELAY_SIGNING_CERTIFICATE_PATH",
  "RELAY_SIGNING_CERTIFICATE_PASSWORD",
  "RELAY_SIGNING_EXPECTED_PUBLISHER",
  "RELAY_SIGNING_TIMESTAMP_URL"
]);

async function requireRegularFile(path, code) {
  let metadata;
  try {
    metadata = await stat(path);
  } catch {
    throw new Error(code);
  }
  if (!metadata.isFile()) throw new Error(code);
}

async function discoverSignTool(environment) {
  const explicit = environment.RELAY_SIGNTOOL_PATH;
  if (typeof explicit === "string" && explicit.length > 0) {
    if (!isAbsolute(explicit)) throw new Error("SIGNING.SIGNTOOL_PATH_NOT_ABSOLUTE");
    await requireRegularFile(explicit, "SIGNING.SIGNTOOL_NOT_FOUND");
    return explicit;
  }
  const programFilesX86 = environment["ProgramFiles(x86)"];
  if (typeof programFilesX86 !== "string" || programFilesX86.length === 0) {
    throw new Error("SIGNING.SIGNTOOL_NOT_FOUND");
  }
  const binRoot = resolve(programFilesX86, "Windows Kits", "10", "bin");
  let versions;
  try {
    versions = (await readdir(binRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^\d+\.\d+\.\d+\.\d+$/u.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left, "en", { numeric: true }));
  } catch {
    throw new Error("SIGNING.SIGNTOOL_NOT_FOUND");
  }
  for (const version of versions) {
    const candidate = resolve(binRoot, version, "x64", "signtool.exe");
    try {
      await requireRegularFile(candidate, "SIGNING.SIGNTOOL_NOT_FOUND");
      return candidate;
    } catch {
      // Continue to the next installed SDK. No private path is logged.
    }
  }
  throw new Error("SIGNING.SIGNTOOL_NOT_FOUND");
}

export async function loadSigningConfiguration(environment = process.env) {
  for (const name of REQUIRED_SIGNING_ENVIRONMENT) {
    if (typeof environment[name] !== "string" || environment[name].length === 0) {
      throw new Error(`SIGNING.REQUIRED_INPUT_MISSING:${name}`);
    }
  }
  const certificatePath = environment.RELAY_SIGNING_CERTIFICATE_PATH;
  if (!isAbsolute(certificatePath)) throw new Error("SIGNING.CERTIFICATE_PATH_NOT_ABSOLUTE");
  await requireRegularFile(certificatePath, "SIGNING.CERTIFICATE_NOT_FOUND");
  let timestampUrl;
  try {
    timestampUrl = new URL(environment.RELAY_SIGNING_TIMESTAMP_URL);
  } catch {
    throw new Error("SIGNING.TIMESTAMP_URL_INVALID");
  }
  if (timestampUrl.protocol !== "https:") throw new Error("SIGNING.TIMESTAMP_MUST_USE_HTTPS");
  if (timestampUrl.username.length > 0 || timestampUrl.password.length > 0 || timestampUrl.hash.length > 0) {
    throw new Error("SIGNING.TIMESTAMP_URL_INVALID");
  }
  const expectedPublisher = environment.RELAY_SIGNING_EXPECTED_PUBLISHER.trim();
  if (expectedPublisher.length < 2) throw new Error("SIGNING.PUBLISHER_INVALID");
  return Object.freeze({
    certificatePath,
    certificatePassword: environment.RELAY_SIGNING_CERTIFICATE_PASSWORD,
    expectedPublisher,
    timestampUrl: timestampUrl.href,
    signToolPath: await discoverSignTool(environment)
  });
}

export function signingEnvironment(baseEnvironment, configuration) {
  const environment = { ...baseEnvironment };
  environment.CSC_LINK = configuration.certificatePath;
  environment.CSC_KEY_PASSWORD = configuration.certificatePassword;
  environment.CSC_IDENTITY_AUTO_DISCOVERY = "false";
  // The default package environment deliberately rejects network access. The
  // explicit signed transaction needs only the human-approved RFC3161 server.
  delete environment.HTTP_PROXY;
  delete environment.HTTPS_PROXY;
  delete environment.ALL_PROXY;
  delete environment.NO_PROXY;
  return environment;
}

export async function signPeFile(path, configuration) {
  await requireRegularFile(path, "SIGNING.TARGET_NOT_FOUND");
  const result = spawnSync(configuration.signToolPath, [
    "sign",
    "/fd", "SHA256",
    "/tr", configuration.timestampUrl,
    "/td", "SHA256",
    "/f", configuration.certificatePath,
    "/p", configuration.certificatePassword,
    path
  ], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 2 * 1024 * 1024
  });
  if (result.status !== 0) throw new Error("SIGNING.SIGNTOOL_SIGN_FAILED");
}

function timestampLine(output) {
  const line = output.split(/\r?\n/u).find((candidate) =>
    /signature is timestamped|time\s*stamp|时间戳/iu.test(candidate)
  );
  if (line === undefined) throw new Error("SIGNING.TIMESTAMP_TIME_MISSING");
  return line.trim().slice(0, 256);
}

function powershellSignature(path) {
  const script = String.raw`
$signature = Get-AuthenticodeSignature -LiteralPath $env:RELAY_SIGNATURE_TARGET
$result = [ordered]@{
  status = [string]$signature.Status
  status_message = [string]$signature.StatusMessage
  signer_subject = if ($signature.SignerCertificate) { [string]$signature.SignerCertificate.Subject } else { $null }
  signer_thumbprint = if ($signature.SignerCertificate) { [string]$signature.SignerCertificate.Thumbprint } else { $null }
  timestamp_subject = if ($signature.TimeStamperCertificate) { [string]$signature.TimeStamperCertificate.Subject } else { $null }
  timestamp_thumbprint = if ($signature.TimeStamperCertificate) { [string]$signature.TimeStamperCertificate.Thumbprint } else { $null }
}
[Console]::Out.Write(($result | ConvertTo-Json -Compress))
`;
  const result = spawnSync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    {
      encoding: "utf8",
      env: { ...process.env, RELAY_SIGNATURE_TARGET: path },
      shell: false,
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 1 * 1024 * 1024
    }
  );
  if (result.status !== 0) throw new Error("SIGNING.AUTHENTICODE_QUERY_FAILED");
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error("SIGNING.AUTHENTICODE_QUERY_INVALID");
  }
}

export async function verifyPeSignature(path, label, configuration) {
  await requireRegularFile(path, "SIGNING.TARGET_NOT_FOUND");
  const verification = spawnSync(
    configuration.signToolPath,
    ["verify", "/pa", "/all", "/v", path],
    {
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024
    }
  );
  if (verification.status !== 0) throw new Error(`SIGNING.TRUST_VERIFY_FAILED:${label}`);
  const authenticode = powershellSignature(path);
  if (authenticode.status !== "Valid") throw new Error(`SIGNING.AUTHENTICODE_NOT_VALID:${label}`);
  if (
    typeof authenticode.signer_subject !== "string" ||
    !authenticode.signer_subject.toLocaleLowerCase("en-US").includes(
      configuration.expectedPublisher.toLocaleLowerCase("en-US")
    )
  ) {
    throw new Error(`SIGNING.PUBLISHER_MISMATCH:${label}`);
  }
  if (
    typeof authenticode.timestamp_subject !== "string" || authenticode.timestamp_subject.length === 0 ||
    typeof authenticode.timestamp_thumbprint !== "string" || authenticode.timestamp_thumbprint.length === 0
  ) {
    throw new Error(`SIGNING.TIMESTAMP_CERTIFICATE_MISSING:${label}`);
  }
  const metadata = await stat(path);
  return Object.freeze({
    label,
    bytes: metadata.size,
    sha256: await sha256File(path),
    trust_policy: "passed",
    signtool_exit_code: verification.status,
    authenticode_status: authenticode.status,
    signer_subject: authenticode.signer_subject,
    signer_thumbprint: authenticode.signer_thumbprint,
    timestamp_subject: authenticode.timestamp_subject,
    timestamp_thumbprint: authenticode.timestamp_thumbprint,
    timestamp_evidence: timestampLine(`${verification.stdout}\n${verification.stderr}`)
  });
}

export function assertSignatureEvidence(report, requiredLabels, expectedPublisher) {
  if (report?.conclusion !== "passed" || report?.release_mode !== "signed") {
    throw new Error("SIGNING.EVIDENCE_NOT_PASSED");
  }
  const entries = new Map((report.signatures ?? []).map((entry) => [entry.label, entry]));
  for (const label of requiredLabels) {
    const entry = entries.get(label);
    if (
      entry?.trust_policy !== "passed" || entry?.authenticode_status !== "Valid" ||
      typeof entry.signer_subject !== "string" ||
      !entry.signer_subject.toLocaleLowerCase("en-US").includes(expectedPublisher.toLocaleLowerCase("en-US")) ||
      typeof entry.signer_thumbprint !== "string" || entry.signer_thumbprint.length === 0 ||
      typeof entry.timestamp_subject !== "string" || entry.timestamp_subject.length === 0 ||
      typeof entry.timestamp_thumbprint !== "string" || entry.timestamp_thumbprint.length === 0 ||
      typeof entry.timestamp_evidence !== "string" || entry.timestamp_evidence.length === 0
    ) {
      throw new Error(`SIGNING.EVIDENCE_REQUIRED:${label}`);
    }
  }
}
