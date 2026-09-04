import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  assertSignatureEvidence,
  loadSigningConfiguration,
  signingEnvironment
} from "../scripts/signing-contract.mjs";

const projectRoot = resolve(import.meta.dirname, "..");

test("signed configuration is explicit, complete and keeps secrets out of the returned public fields", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "relay-signing-contract-"));
  try {
    const pfx = resolve(root, "certificate.pfx");
    const signTool = resolve(root, "signtool.exe");
    await writeFile(pfx, "fixture", "utf8");
    await writeFile(signTool, "fixture", "utf8");
    const environment = {
      RELAY_SIGNING_CERTIFICATE_PATH: pfx,
      RELAY_SIGNING_CERTIFICATE_PASSWORD: "secret-fixture",
      RELAY_SIGNING_EXPECTED_PUBLISHER: "PlaTuring Release",
      RELAY_SIGNING_TIMESTAMP_URL: "https://timestamp.example.test/",
      RELAY_SIGNTOOL_PATH: signTool
    };
    const configuration = await loadSigningConfiguration(environment);
    assert.equal(configuration.expectedPublisher, "PlaTuring Release");
    assert.equal(configuration.timestampUrl, "https://timestamp.example.test/");
    const childEnvironment = signingEnvironment({ HTTP_PROXY: "reject", OTHER: "kept" }, configuration);
    assert.equal(childEnvironment.CSC_LINK, pfx);
    assert.equal(childEnvironment.CSC_KEY_PASSWORD, "secret-fixture");
    assert.equal(childEnvironment.HTTP_PROXY, undefined);
    assert.equal(childEnvironment.OTHER, "kept");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("signed mode fails before packaging when human certificate inputs are absent", () => {
  const environment = {
    PATH: process.env.PATH ?? "",
    SystemRoot: process.env.SystemRoot ?? "C:\\Windows"
  };
  const result = spawnSync(
    process.execPath,
    [resolve(projectRoot, "scripts", "package.mjs"), "--signed", "--target", "nsis", "--target", "portable"],
    { cwd: projectRoot, env: environment, encoding: "utf8", shell: false, windowsHide: true }
  );
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /SIGNING\.REQUIRED_INPUT_MISSING/u);
});

test("signed configuration rejects malformed or non-HTTPS timestamp inputs before build", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "relay-signing-negative-"));
  try {
    const pfx = resolve(root, "certificate.pfx");
    const signTool = resolve(root, "signtool.exe");
    await writeFile(pfx, "fixture", "utf8");
    await writeFile(signTool, "fixture", "utf8");
    const base = {
      RELAY_SIGNING_CERTIFICATE_PATH: pfx,
      RELAY_SIGNING_CERTIFICATE_PASSWORD: "secret-fixture",
      RELAY_SIGNING_EXPECTED_PUBLISHER: "PlaTuring Release",
      RELAY_SIGNTOOL_PATH: signTool
    };
    await assert.rejects(
      loadSigningConfiguration({ ...base, RELAY_SIGNING_TIMESTAMP_URL: "not a URL" }),
      /SIGNING\.TIMESTAMP_URL_INVALID/u
    );
    await assert.rejects(
      loadSigningConfiguration({ ...base, RELAY_SIGNING_TIMESTAMP_URL: "http://timestamp.example.test/" }),
      /SIGNING\.TIMESTAMP_MUST_USE_HTTPS/u
    );
    await assert.rejects(
      loadSigningConfiguration({
        ...base,
        RELAY_SIGNING_EXPECTED_PUBLISHER: " ",
        RELAY_SIGNING_TIMESTAMP_URL: "https://timestamp.example.test/"
      }),
      /SIGNING\.PUBLISHER_INVALID/u
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("signature evidence requires every PE, the approved publisher and timestamp", () => {
  const valid = (label) => ({
    label,
    trust_policy: "passed",
    authenticode_status: "Valid",
    signer_subject: "CN=PlaTuring Release",
    signer_thumbprint: "AABBCC",
    timestamp_subject: "CN=RFC3161 Timestamp",
    timestamp_thumbprint: "DDEEFF",
    timestamp_evidence: "The signature is timestamped: 2026-08-30"
  });
  const report = {
    conclusion: "passed",
    release_mode: "signed",
    signatures: [valid("helper"), valid("app"), valid("uninstaller"), valid("setup"), valid("portable")]
  };
  assert.doesNotThrow(() => assertSignatureEvidence(
    report,
    ["helper", "app", "uninstaller", "setup", "portable"],
    "PlaTuring Release"
  ));
  assert.throws(
    () => assertSignatureEvidence(
      { ...report, signatures: report.signatures.filter(({ label }) => label !== "uninstaller") },
      ["helper", "app", "uninstaller", "setup", "portable"],
      "PlaTuring Release"
    ),
    /SIGNING\.EVIDENCE_REQUIRED:uninstaller/u
  );
  assert.throws(
    () => assertSignatureEvidence(
      { ...report, signatures: [valid("helper"), { ...valid("app"), timestamp_evidence: "" }] },
      ["helper", "app"],
      "PlaTuring Release"
    ),
    /SIGNING\.EVIDENCE_REQUIRED:app/u
  );
});

test("package metadata keeps default unsigned dist Setup-only and signed releases fail-closed", async () => {
  const packageMetadata = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8"));
  assert.equal(packageMetadata.scripts.dist, "node scripts/package.mjs --target nsis");
  assert.equal(packageMetadata.scripts["dist:win"], "node scripts/package.mjs --target nsis");
  assert.equal(packageMetadata.scripts["dist:portable"], "node scripts/package.mjs --target portable");
  assert.equal(packageMetadata.scripts["dist:signed"], "node scripts/signed-release.mjs");
  assert.deepEqual(packageMetadata.build.win.signExts, [".exe"]);
});

test("signed release contract forces signing and verifies packaged plus installed PE artifacts", async () => {
  const packageScript = await readFile(resolve(projectRoot, "scripts", "package.mjs"), "utf8");
  const installerScript = await readFile(
    resolve(projectRoot, "scripts", "validate-installer-runtime.mjs"),
    "utf8"
  );
  const signedReleaseScript = await readFile(
    resolve(projectRoot, "scripts", "signed-release.mjs"),
    "utf8"
  );
  assert.match(packageScript, /--config\.forceCodeSigning=true/u);
  assert.match(packageScript, /signed-package-signatures\.json/u);
  for (const label of ["packaged_native_helper", "packaged_application", "setup", "portable"]) {
    assert.ok(packageScript.includes(`\"${label}\"`), `missing package signature target ${label}`);
  }
  for (const label of ["installed_application", "installed_native_helper", "installed_uninstaller"]) {
    assert.ok(installerScript.includes(`\"${label}\"`), `missing installed signature target ${label}`);
  }
  assert.match(signedReleaseScript, /validate-installer-runtime\.mjs", \["--signed"\]/u);
  assert.match(signedReleaseScript, /verify-offline\.mjs", \["--signed"\]/u);
});

test("installer runtime probe isolates Electron userData instead of reusing a production profile", async () => {
  const installerScript = await readFile(
    resolve(projectRoot, "scripts", "validate-installer-runtime.mjs"),
    "utf8"
  );
  assert.match(installerScript, /`--user-data-dir=\$\{userDataPath\}`/u);
  assert.match(installerScript, /const probeUserData = resolve\(profileRoot, "UserData"\)/u);
  assert.match(installerScript, /installed_app_probe_diagnostics/u);
  assert.match(installerScript, /waitForRequiredOutputs/u);
  assert.match(installerScript, /installer_output_wait_ms/u);
  assert.match(installerScript, /attempts = 120, intervalMs = 250/u);
});
