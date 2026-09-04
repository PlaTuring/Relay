import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { nativeEvidenceRoot, projectRoot, releaseArtifactName, releaseEvidenceId } from "./lib.mjs";

const evidenceRoot = nativeEvidenceRoot;
const evidencePath = path.resolve(evidenceRoot, "portable-redirected-userdata-probe.json");
const packageMetadata = JSON.parse(await readFile(path.resolve(projectRoot, "package.json"), "utf8"));

let portablePath = path.resolve(
  projectRoot,
  "release-unsigned",
  releaseArtifactName("portable")
);
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument !== "--portable" || index + 1 >= process.argv.length) {
    throw new Error("STARTUP_COMPAT.INVALID_ARGUMENT");
  }
  portablePath = path.resolve(process.argv[index + 1]);
  index += 1;
}

if (process.platform !== "win32") throw new Error("STARTUP_COMPAT.WINDOWS_REQUIRED");
if (!portablePath.toLocaleLowerCase("en-US").endsWith(".exe")) {
  throw new Error("STARTUP_COMPAT.PORTABLE_EXE_REQUIRED");
}
const portableMetadata = await stat(portablePath);
if (!portableMetadata.isFile()) throw new Error("STARTUP_COMPAT.PORTABLE_MISSING");

async function sha256File(filePath) {
  return await new Promise((resolveHash, rejectHash) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath, { highWaterMark: 4 * 1024 * 1024 });
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", rejectHash);
    stream.once("end", () => resolveHash(hash.digest("hex")));
  });
}

function terminateOwnedTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (typeof child.pid === "number") {
    spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      timeout: 10_000
    });
  } else {
    child.kill();
  }
}

const validationPrefix = `relay-${releaseEvidenceId}-portable-`;
const validationRoot = await mkdtemp(path.join(os.tmpdir(), validationPrefix));
const expectedPrefix = path.join(os.tmpdir(), validationPrefix);
if (!path.resolve(validationRoot).toLocaleLowerCase("en-US").startsWith(path.resolve(expectedPrefix).toLocaleLowerCase("en-US"))) {
  throw new Error("STARTUP_COMPAT.TEMP_CONTAINMENT_FAILED");
}

const redirectedProfile = path.join(validationRoot, "VM Shared Profile", "用户 Ω");
const roaming = path.join(redirectedProfile, "Roaming");
const local = path.join(redirectedProfile, "Local");
const userData = path.join(redirectedProfile, "Electron UserData");
const managedDataRoot = path.join(validationRoot, "Managed Data Root");
await Promise.all([roaming, local, userData, managedDataRoot].map((directory) => mkdir(directory, { recursive: true })));
await writeFile(
  path.join(userData, "data-root.pointer.json"),
  `${JSON.stringify({ version: 1, dataRoot: managedDataRoot, updatedAt: "2026-09-01T00:00:00.000Z" }, null, 2)}\n`,
  "utf8"
);

const environment = {
  ...process.env,
  APPDATA: roaming,
  LOCALAPPDATA: local,
  MINIMAX_H3_PACKAGED_PROBE: "1"
};
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.NODE_OPTIONS;

const child = spawn(portablePath, [`--user-data-dir=${userData}`], {
  cwd: validationRoot,
  env: environment,
  shell: false,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"]
});

const timeoutMilliseconds = 45_000;
const outcome = await new Promise((resolveOutcome) => {
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let spawnCode = null;
  const timer = setTimeout(() => {
    timedOut = true;
    terminateOwnedTree(child);
  }, timeoutMilliseconds);
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout = `${stdout}${chunk}`.slice(-16_384); });
  child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-16_384); });
  child.once("error", (error) => {
    spawnCode = typeof error.code === "string" ? error.code : error.name;
  });
  child.once("close", (exitCode, signal) => {
    clearTimeout(timer);
    resolveOutcome({ exitCode, signal, stdout, stderr, timedOut, spawnCode });
  });
});

const probeEvidencePath = path.join(managedDataRoot, "logs", "packaged-startup-probe.json");
let persistedProbe = null;
for (let attempt = 0; attempt < 120; attempt += 1) {
  try {
    persistedProbe = JSON.parse(await readFile(probeEvidencePath, "utf8"));
    break;
  } catch (error) {
    if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
}
const persistedNative =
  persistedProbe?.conclusion === "passed" &&
  persistedProbe?.native_profile === "relay.win32.path-inspection" &&
  persistedProbe?.native_helper === "verified" &&
  persistedProbe?.data_root_volume === "fixed_local_ntfs_verified";
const persistedAdapters =
  persistedProbe?.adapters?.streamA === "stream_a_cli" &&
  persistedProbe?.adapters?.streamB === "stream_b_cli";
const persistedBoundary =
  persistedProbe?.product_boundary?.ran_model === false &&
  persistedProbe?.product_boundary?.submitted_prompt === false &&
  persistedProbe?.product_boundary?.submitted_queue === false &&
  persistedProbe?.product_boundary?.generated_media === false;
const nativeMarker = persistedNative || /PACKAGED_NATIVE_HELPER_READY profile=relay\.win32\.path-inspection enabled=\d+/u.test(outcome.stdout);
const adapterMarker = persistedAdapters || outcome.stdout.includes("PACKAGED_ADAPTER_READY streamA=stream_a_cli streamB=stream_b_cli");
const sensitiveOutputDetected = /(?:[A-Za-z]:\\|\\\\|\/Users\/|\/home\/|gh[pousr]_|private[_ -]?prompt)/iu.test(`${outcome.stdout}\n${outcome.stderr}`);
const passed = !outcome.timedOut && outcome.spawnCode === null && outcome.exitCode === 0 && outcome.signal === null && nativeMarker && adapterMarker && persistedBoundary && !sensitiveOutputDetected;

const evidence = Object.freeze({
  schema_version: 1,
  conclusion: passed ? "passed" : "failed",
  relay_version: packageMetadata.version,
  platform: process.platform,
  architecture: process.arch,
  portable: Object.freeze({
    file_name: path.basename(portablePath),
    byte_length: portableMetadata.size,
    sha256: await sha256File(portablePath)
  }),
  user_data_fixture: Object.freeze({
    isolated: true,
    redirected_profile_shape: true,
    unicode_and_spaces: true,
    fixed_ntfs_requirement_applied: false
  }),
  probe: Object.freeze({
    timed_out: outcome.timedOut,
    exit_code: outcome.exitCode,
    signal: outcome.signal,
    spawn_code: outcome.spawnCode,
    native_marker: nativeMarker,
    adapter_marker: adapterMarker,
    persisted_probe: persistedProbe !== null,
    sensitive_output_detected: sensitiveOutputDetected
  }),
  product_boundary: Object.freeze({
    ran_model: false,
    submitted_prompt: false,
    submitted_queue: false,
    generated_media: false
  })
});

await mkdir(evidenceRoot, { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
await rm(validationRoot, { recursive: true, force: true });

if (!passed) throw new Error("STARTUP_COMPAT.PORTABLE_PROBE_FAILED");
process.stdout.write("STARTUP_COMPAT portable=passed redirected_userdata=passed product_boundary=passed\n");
