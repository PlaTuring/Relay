import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants, createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";

import { nativeEvidenceRoot, offlineEnvironment, projectRoot, releaseArtifactName } from "./lib.mjs";
import {
  assertFrozenExtraResourceInputs,
  attestPackagedRuntimeResources,
  collectPackageInputInventory,
  readJson,
  writePackageInputInventory
} from "./release-resource-attestation.mjs";
import {
  loadSigningConfiguration,
  signPeFile,
  signingEnvironment,
  verifyPeSignature
} from "./signing-contract.mjs";

const requestedTargets = [];
let directoryOnly = false;
let signedMode = false;
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === "--signed") {
    signedMode = true;
    continue;
  }
  if (argument === "--dir") {
    directoryOnly = true;
    continue;
  }
  if (argument === "--target") {
    const target = process.argv[index + 1];
    if (target !== "nsis" && target !== "portable") {
      throw new Error("PACKAGE.INVALID_TARGET");
    }
    requestedTargets.push(target);
    index += 1;
    continue;
  }
  throw new Error("PACKAGE.INVALID_ARGUMENT");
}

if (directoryOnly && requestedTargets.length > 0) {
  throw new Error("PACKAGE.CONFLICTING_OUTPUT_MODE");
}
if (!directoryOnly && requestedTargets.length === 0) {
  throw new Error("PACKAGE.TARGET_REQUIRED");
}
if (
  signedMode && (
    directoryOnly ||
    JSON.stringify([...new Set(requestedTargets)].sort()) !== JSON.stringify(["nsis", "portable"])
  )
) {
  throw new Error("PACKAGE.SIGNED_MODE_REQUIRES_NSIS_AND_PORTABLE");
}

// Signed mode validates every human-controlled input before build output or
// release evidence is touched. There is no fallback to the unsigned path.
const signingConfiguration = signedMode ? await loadSigningConfiguration(process.env) : null;
const releaseMode = signedMode ? "signed" : "unsigned";
const releaseDirectoryName = signedMode ? "release-signed" : "release-unsigned";
const releaseRoot = resolve(projectRoot, releaseDirectoryName);
const packageMetadata = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8"));
const versionedReleaseRoot = resolve(releaseRoot, `v${packageMetadata.version}`);
const sourceInventory = await readJson(resolve(projectRoot, "build", "input-inventory.json"));

if (!directoryOnly) {
  try {
    await lstat(versionedReleaseRoot);
    throw new Error("PACKAGE.VERSIONED_RELEASE_ALREADY_EXISTS");
  } catch (error) {
    if (error instanceof Error && error.message === "PACKAGE.VERSIONED_RELEASE_ALREADY_EXISTS") throw error;
    if (error?.code !== "ENOENT") throw new Error("PACKAGE.VERSIONED_RELEASE_DESTINATION_INVALID", { cause: error });
  }
}

await mkdir(nativeEvidenceRoot, { recursive: true });
for (const staleEvidence of [
  "packaged-native-identity.json",
  "packaged-native-runtime-probe.json",
  "packaged-app-native-call.json",
  "packaged-local-runtime-execution.json",
  "packaged-runtime-resource-attestation.json",
  "packaged-runtime-resource-attestation-signed.json",
  "signed-package-signatures.json"
]) {
  await rm(resolve(nativeEvidenceRoot, staleEvidence), { force: true });
}
if (!directoryOnly) {
  await rm(resolve(nativeEvidenceRoot, "installer-runtime-validation.json"), { force: true });
  await rm(resolve(nativeEvidenceRoot, "installer-runtime-validation-signed.json"), { force: true });
  await Promise.all(["SHA256SUMS", "SHA256SUMS.txt"].map((fileName) =>
    signedMode
      ? rm(resolve(releaseRoot, fileName), { force: true })
      : rm(resolve(projectRoot, "release-unsigned", fileName), { force: true })
  ));
}

const build = spawnSync(
  process.execPath,
  [resolve(projectRoot, "scripts", "build.mjs")],
  {
    cwd: projectRoot,
    encoding: "utf8",
    env: offlineEnvironment(),
    maxBuffer: 8 * 1024 * 1024,
    shell: false,
    windowsHide: true
  }
);
if (build.status !== 0) {
  throw new Error("PACKAGE.BUILD_FAILED");
}

const sourceNativeHelper = resolve(projectRoot, "dist", "main", "native", "relay-winbroker.exe");
if (signedMode) {
  await signPeFile(sourceNativeHelper, signingConfiguration);
  await verifyPeSignature(sourceNativeHelper, "source_native_helper", signingConfiguration);
}
const packageInputInventory = await collectPackageInputInventory(projectRoot, packageMetadata);
assertFrozenExtraResourceInputs(packageInputInventory, sourceInventory);
await writePackageInputInventory(projectRoot, packageInputInventory);

const builderCli = resolve(
  projectRoot,
  "node_modules",
  "electron-builder",
  "out",
  "cli",
  "cli.js"
);
const builderArguments = [builderCli];
if (directoryOnly) {
  builderArguments.push("--dir");
}
builderArguments.push("--win");
if (!directoryOnly) {
  builderArguments.push(...[...new Set(requestedTargets)]);
}
builderArguments.push("--x64", "--publish", "never");
builderArguments.push("--config.asarUnpack", "dist/main/native/*");
if (signedMode) {
  builderArguments.push("--config.forceCodeSigning=true");
  builderArguments.push(`--config.directories.output=${releaseDirectoryName}`);
  builderArguments.push(
    `--config.win.rfc3161TimeStampServer=${signingConfiguration.timestampUrl}`
  );
}

let packageEnvironment = offlineEnvironment();
const buildCacheRoot = resolve(projectRoot, ".build-cache");
const builderCache = resolve(buildCacheRoot, "electron-builder");
const electronCache = resolve(buildCacheRoot, "electron");
const npmCache = resolve(buildCacheRoot, "npm");
const buildTemporary = resolve(buildCacheRoot, "tmp");
for (const directory of [builderCache, electronCache, npmCache, buildTemporary]) {
  await mkdir(directory, { recursive: true });
  const identity = await realpath(directory);
  const child = relative(projectRoot, identity);
  if (child.length === 0 || child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) {
    throw new Error("PACKAGE.CACHE_CONTAINMENT_FAILED");
  }
}
packageEnvironment.ELECTRON_BUILDER_CACHE = builderCache;
packageEnvironment.ELECTRON_CACHE = electronCache;
packageEnvironment.npm_config_cache = npmCache;
packageEnvironment.TEMP = buildTemporary;
packageEnvironment.TMP = buildTemporary;
packageEnvironment.CSC_IDENTITY_AUTO_DISCOVERY = "false";
if (signedMode) packageEnvironment = signingEnvironment(packageEnvironment, signingConfiguration);
const packageResult = spawnSync(process.execPath, builderArguments, {
  cwd: projectRoot,
  env: packageEnvironment,
  stdio: "inherit",
  shell: false,
  windowsHide: true
});
if (packageResult.status !== 0) {
  throw new Error("PACKAGE.ELECTRON_BUILDER_FAILED");
}

const unpackedRoot = resolve(releaseRoot, "win-unpacked");
const requiredLegalFiles = [
  resolve(unpackedRoot, "LICENSE.electron.txt"),
  resolve(unpackedRoot, "LICENSES.chromium.html"),
  resolve(unpackedRoot, "resources", "licenses", "Relay", "LICENSE"),
  resolve(unpackedRoot, "resources", "licenses", "Relay", "NOTICE"),
  resolve(unpackedRoot, "resources", "licenses", "Relay", "THIRD_PARTY_NOTICES.md")
];
for (const legalPath of requiredLegalFiles) {
  const metadata = await lstat(legalPath);
  const canonical = resolve(await realpath(legalPath));
  const child = relative(unpackedRoot, canonical);
  if (
    !metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0 ||
    child.length === 0 || child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)
  ) throw new Error("PACKAGE.LEGAL_NOTICE_INVALID");
}
process.stdout.write(`PACKAGE_LEGAL_NOTICES required=${requiredLegalFiles.length} status=passed\n`);

// Electron Builder receives the canonical SemVer (for PE/package metadata),
// while the public Setup filename uses Relay's compact display version.  The
// final name is derived from the same package version in lib.mjs; it is never
// maintained as a second hard-coded version source.
if (!directoryOnly) {
  for (const target of [...new Set(requestedTargets)]) {
    const sourceName = target === "nsis"
      ? `Relay-${packageMetadata.version}-x64-Setup.exe`
      : `Relay-${packageMetadata.version}-x64-Portable.exe`;
    const finalName = releaseArtifactName(target === "nsis" ? "setup" : "portable");
    if (sourceName === finalName) continue;
    const sourcePath = resolve(releaseRoot, sourceName);
    const finalPath = resolve(releaseRoot, finalName);
    await rm(finalPath, { force: true });
    await rename(sourcePath, finalPath);
  }
}

const packagedNativeHelper = resolve(
  releaseRoot,
  "win-unpacked",
  "resources",
  "app.asar.unpacked",
  "dist",
  "main",
  "native",
  "relay-winbroker.exe"
);
const packagedNativeProfile = resolve(
  releaseRoot, "win-unpacked", "resources", "app.asar.unpacked",
  "dist", "main", "native", "capability-profile.v1.json"
);
const resourceAttestationPath = resolve(
  nativeEvidenceRoot,
  signedMode
    ? "packaged-runtime-resource-attestation-signed.json"
    : "packaged-runtime-resource-attestation.json"
);
const resourceAttestation = await attestPackagedRuntimeResources({
  projectRoot,
  releaseRoot,
  packageMetadata,
  packageInventory: packageInputInventory,
  sourceInventory,
  evidencePath: resourceAttestationPath,
  releaseMode
});
process.stdout.write(
  `PACKAGE_RUNTIME_RESOURCES mappings=${resourceAttestation.mapping_count} files=${resourceAttestation.file_count} status=passed\n`
);

// Resource identity alone cannot prove that the relative import closure is
// complete. Execute the packaged entry point itself so missing transitive
// modules or schemas fail the build before any checksum can be published.
// These probes are deterministic and local: they do not launch ComfyUI,
// access the network, submit a prompt, enqueue work, or generate media.
const packagedLocalRuntimeEntry = resolve(
  releaseRoot,
  "win-unpacked",
  "resources",
  "runtime",
  "packages",
  "local-runtime",
  "bin",
  "local-runtime.mjs"
);
const packagedRuntimeEnvironment = { ...process.env };
delete packagedRuntimeEnvironment.ELECTRON_RUN_AS_NODE;
delete packagedRuntimeEnvironment.NODE_OPTIONS;
delete packagedRuntimeEnvironment.NODE_PATH;

function executePackagedLocalRuntime(label, arguments_, input = undefined) {
  const result = spawnSync(process.execPath, [packagedLocalRuntimeEntry, ...arguments_], {
    cwd: projectRoot,
    env: packagedRuntimeEnvironment,
    encoding: "utf8",
    input,
    timeout: 20_000,
    maxBuffer: 2 * 1024 * 1024,
    shell: false,
    windowsHide: true
  });
  if (result.error?.code === "ETIMEDOUT") {
    throw new Error(`PACKAGE.PACKAGED_LOCAL_RUNTIME_TIMEOUT:${label}`);
  }
  if (result.status !== 0) {
    throw new Error(`PACKAGE.PACKAGED_LOCAL_RUNTIME_EXECUTION_FAILED:${label}`);
  }
  const lines = result.stdout.trim().split(/\r?\n/u).filter((line) => line.length > 0);
  if (lines.length !== 1) {
    throw new Error(`PACKAGE.PACKAGED_LOCAL_RUNTIME_PROTOCOL_INVALID:${label}`);
  }
  try {
    const payload = JSON.parse(lines[0]);
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      throw new TypeError("payload");
    }
    return payload;
  } catch {
    throw new Error(`PACKAGE.PACKAGED_LOCAL_RUNTIME_PROTOCOL_INVALID:${label}`);
  }
}

const packagedRuntimeSmoke = executePackagedLocalRuntime("smoke", ["smoke"]);
if (
  packagedRuntimeSmoke.evidence_mode !== "synthetic_smoke_no_host_io" ||
  packagedRuntimeSmoke.attach_plan?.model_executed !== false ||
  packagedRuntimeSmoke.attach_plan?.prompt_submitted !== false
) {
  throw new Error("PACKAGE.PACKAGED_LOCAL_RUNTIME_RESULT_INVALID:smoke");
}
const packagedRuntimeSidecar = executePackagedLocalRuntime(
  "sidecar_authority",
  ["sidecar", "--request", "-"],
  `${JSON.stringify({ operation: "authority" })}\n`
);
if (
  packagedRuntimeSidecar.network_authority !== "none" ||
  packagedRuntimeSidecar.execution_authority !== "none" ||
  packagedRuntimeSidecar.queue_authority !== "none"
) {
  throw new Error("PACKAGE.PACKAGED_LOCAL_RUNTIME_RESULT_INVALID:sidecar_authority");
}
const packagedRuntimeMedia = executePackagedLocalRuntime(
  "media_probe",
  ["media-probe", "--request", "-"],
  `${JSON.stringify({ ambientFfmpegPresent: false })}\n`
);
if (
  packagedRuntimeMedia.schemaVersion !== 1 ||
  packagedRuntimeMedia.ambientFfmpeg?.status !== "unavailable"
) {
  throw new Error("PACKAGE.PACKAGED_LOCAL_RUNTIME_RESULT_INVALID:media_probe");
}
await writeFile(
  resolve(nativeEvidenceRoot, "packaged-local-runtime-execution.json"),
  `${JSON.stringify({
    schema_version: 1,
    conclusion: "passed",
    release_mode: releaseMode,
    packaged_entry: "resources/runtime/packages/local-runtime/bin/local-runtime.mjs",
    probes: ["smoke", "sidecar_authority", "media_probe"],
    dependency_closure: {
      catalog_loader_and_schema: "loaded",
      download_sidecar: "executed",
      media_capability: "executed"
    },
    product_boundary: {
      ran_model: false,
      submitted_prompt: false,
      submitted_queue: false,
      generated_media: false,
      network_called: false
    }
  }, null, 2)}\n`,
  "utf8"
);
process.stdout.write("PACKAGE_LOCAL_RUNTIME_EXECUTION probes=3 status=passed\n");

const sourceNativeIdentity = {
  bytes: (await stat(sourceNativeHelper)).size,
  sha256: await sha256File(sourceNativeHelper)
};
const packagedNativeIdentity = {
  bytes: (await stat(packagedNativeHelper)).size,
  sha256: await sha256File(packagedNativeHelper)
};
const nativeIdentityMismatch =
  sourceNativeIdentity.bytes !== packagedNativeIdentity.bytes ||
  sourceNativeIdentity.sha256 !== packagedNativeIdentity.sha256;
if (!signedMode && nativeIdentityMismatch) {
  throw new Error("PACKAGE.NATIVE_HELPER_IDENTITY_MISMATCH");
}
const nativeProbe = spawnSync(
  process.execPath,
  [resolve(projectRoot, "scripts", "verify-native-helper.mjs"), "--binary", packagedNativeHelper,
    "--profile", packagedNativeProfile,
    "--evidence-file", "packaged-native-runtime-probe.json"],
  {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    shell: false,
    windowsHide: true,
    timeout: 20_000
  }
);
if (nativeProbe.status !== 0) {
  throw new Error("PACKAGE.NATIVE_HELPER_RUNTIME_PROBE_FAILED");
}
await writeFile(
  resolve(nativeEvidenceRoot, "packaged-native-identity.json"),
  `${JSON.stringify({
    schema_version: 1,
    release_mode: releaseMode,
    source: sourceNativeIdentity,
    packaged: packagedNativeIdentity,
    byte_identical: !nativeIdentityMismatch,
    runtime_probe: "passed",
    packaged_relative_path: "resources/app.asar.unpacked/dist/main/native/relay-winbroker.exe"
  }, null, 2)}\n`,
  "utf8"
);
process.stdout.write(`PACKAGE_NATIVE_HELPER sha256=${packagedNativeIdentity.sha256} runtime=passed\n`);

async function sha256File(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

const packagedExecutable = resolve(
  releaseRoot,
  "win-unpacked",
  "Relay.exe"
);
const probeEnvironment = { ...process.env };
delete probeEnvironment.ELECTRON_RUN_AS_NODE;
delete probeEnvironment.NODE_OPTIONS;
probeEnvironment.MINIMAX_H3_PACKAGED_PROBE = "1";
const probeProfileRoot = resolve(buildCacheRoot, "packaged-probe-profile");
const probeRoaming = resolve(probeProfileRoot, "Roaming");
const probeLocal = resolve(probeProfileRoot, "Local");
const probeUserData = resolve(probeProfileRoot, "UserData");
const probeDataRoot = resolve(probeProfileRoot, "ManagedDataRoot");
await rm(probeProfileRoot, { recursive: true, force: true });
await mkdir(probeRoaming, { recursive: true });
await mkdir(probeLocal, { recursive: true });
await mkdir(probeUserData, { recursive: true });
await mkdir(probeDataRoot, { recursive: true });
await writeFile(
  resolve(probeUserData, "data-root.pointer.json"),
  `${JSON.stringify({ version: 1, dataRoot: probeDataRoot, updatedAt: "2026-09-01T00:00:00.000Z" }, null, 2)}\n`,
  "utf8"
);
probeEnvironment.APPDATA = probeRoaming;
probeEnvironment.LOCALAPPDATA = probeLocal;
const probe = spawnSync(packagedExecutable, [`--user-data-dir=${probeUserData}`], {
  cwd: projectRoot,
  env: probeEnvironment,
  encoding: "utf8",
  timeout: 20_000,
  maxBuffer: 2 * 1024 * 1024,
  shell: false,
  windowsHide: true
});
const marker = "PACKAGED_ADAPTER_READY streamA=stream_a_cli streamB=stream_b_cli";
const nativeMarker = "PACKAGED_NATIVE_HELPER_READY profile=relay.win32.path-inspection enabled=2";
if (probe.status !== 0 || !probe.stdout.includes(marker) || !probe.stdout.includes(nativeMarker)) {
  throw new Error("PACKAGE.PACKAGED_ADAPTER_PROBE_FAILED");
}
await writeFile(
  resolve(nativeEvidenceRoot, "packaged-app-native-call.json"),
  `${JSON.stringify({
    schema_version: 1,
    release_mode: releaseMode,
    conclusion: "passed",
    packaged_executable: "Relay.exe",
    packaged_executable_sha256: await sha256File(packagedExecutable),
    packaged_native_helper_sha256: packagedNativeIdentity.sha256,
    native_profile: "relay.win32.path-inspection",
    enabled_operations_called: [257, 258],
    native_marker: nativeMarker,
    adapter_marker: marker,
    adapter_probe: "passed",
    exit_code: probe.status,
    product_boundary: {
      ran_model: false,
      submitted_prompt: false,
      submitted_queue: false,
      generated_media: false
    }
  }, null, 2)}\n`,
  "utf8"
);
process.stdout.write(`${nativeMarker}\n${marker}\n`);

if (signedMode) {
  const setupPath = resolve(releaseRoot, releaseArtifactName("setup"));
  const portablePath = resolve(releaseRoot, releaseArtifactName("portable"));
  const signatures = [];
  for (const [label, path] of [
    ["source_native_helper", sourceNativeHelper],
    ["packaged_native_helper", packagedNativeHelper],
    ["packaged_application", packagedExecutable],
    ["setup", setupPath],
    ["portable", portablePath]
  ]) {
    signatures.push(await verifyPeSignature(path, label, signingConfiguration));
  }
  await writeFile(
    resolve(nativeEvidenceRoot, "signed-package-signatures.json"),
    `${JSON.stringify({
      schema_version: 1,
      conclusion: "passed",
      release_mode: "signed",
      expected_publisher: signingConfiguration.expectedPublisher,
      timestamp_url: signingConfiguration.timestampUrl,
      signatures,
      installed_uninstaller_validation: "required"
    }, null, 2)}\n`,
    "utf8"
  );
  process.stdout.write("PACKAGE_SIGNATURES status=passed required=5 uninstaller=installer-validation-required\n");
}

// Publish checksums only after the packaged executable and native adapter
// have completed their hermetic runtime probes. A failed probe therefore
// cannot leave behind a checksum document that looks release-ready.
if (!directoryOnly) {
  const version = packageMetadata.version;
  if (typeof version !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(version)) {
    throw new Error("PACKAGE.INVALID_VERSION_FOR_CHECKSUMS");
  }
  const currentArtifacts = [...new Set(requestedTargets)].map((target) =>
    resolve(
      releaseRoot,
      target === "nsis"
        ? releaseArtifactName("setup")
        : releaseArtifactName("portable")
    )
  );
  const checksumLines = [];
  for (const artifactPath of currentArtifacts.sort()) {
    checksumLines.push(`${await sha256File(artifactPath)} *${basename(artifactPath)}`);
  }
  const checksumDocument = `${checksumLines.join("\n")}\n`;
  await Promise.all(["SHA256SUMS", "SHA256SUMS.txt"].map((fileName) =>
    writeFile(
      resolve(releaseRoot, fileName),
      checksumDocument,
      { encoding: "utf8", flag: "w" }
    )
  ));
  await freezeVersionedRelease({
    releaseRoot,
    versionedReleaseRoot,
    artifactPaths: currentArtifacts,
    checksumDocument
  });
  process.stdout.write(`PACKAGE_CHECKSUMS count=${checksumLines.length}\n`);
  process.stdout.write(
    `PACKAGE_VERSIONED_RELEASE version=${version} assets=${currentArtifacts.length} status=frozen\n`
  );
}

if (signedMode) {
  process.stdout.write("PACKAGE signed=1 publish=never interactive_launch=0 unsigned_fallback=0\n");
} else {
  process.stdout.write("PACKAGE unsigned=1 publish=never interactive_launch=0\n");
}

async function freezeVersionedRelease({
  releaseRoot: sourceRoot,
  versionedReleaseRoot: destinationRoot,
  artifactPaths,
  checksumDocument
}) {
  const stagingRoot = resolve(sourceRoot, `.relay-release-staging-${randomUUID()}`);
  const stagingRelative = relative(sourceRoot, stagingRoot);
  if (
    stagingRelative.length === 0 || stagingRelative === ".." ||
    stagingRelative.startsWith(`..${sep}`) || isAbsolute(stagingRelative)
  ) throw new Error("PACKAGE.VERSIONED_RELEASE_STAGING_CONTAINMENT_FAILED");

  await mkdir(sourceRoot, { recursive: true });
  await mkdir(stagingRoot, { recursive: false });
  const artifactNames = artifactPaths.map((artifactPath) => basename(artifactPath)).sort();
  // The public-ready freeze has one canonical checksum document. The legacy
  // root-level SHA256SUMS copy remains only for existing offline validators.
  const expectedNames = [...artifactNames, "SHA256SUMS.txt"].sort();
  try {
    for (const artifactPath of artifactPaths) {
      const sourceMetadata = await lstat(artifactPath);
      if (
        !sourceMetadata.isFile() || sourceMetadata.isSymbolicLink() ||
        resolve(await realpath(artifactPath)).toLocaleLowerCase("en-US") !==
          resolve(artifactPath).toLocaleLowerCase("en-US")
      ) throw new Error("PACKAGE.VERSIONED_RELEASE_SOURCE_INVALID");
      const destination = resolve(stagingRoot, basename(artifactPath));
      await copyFile(artifactPath, destination, fsConstants.COPYFILE_EXCL);
      if (await sha256File(destination) !== await sha256File(artifactPath)) {
        throw new Error("PACKAGE.VERSIONED_RELEASE_COPY_MISMATCH");
      }
    }
    await writeFile(resolve(stagingRoot, "SHA256SUMS.txt"), checksumDocument, {
      encoding: "utf8",
      flag: "wx"
    });
    const entries = await readdir(stagingRoot, { withFileTypes: true });
    if (
      JSON.stringify(entries.map((entry) => entry.name).sort()) !== JSON.stringify(expectedNames) ||
      entries.some((entry) => !entry.isFile() || entry.isSymbolicLink())
    ) throw new Error("PACKAGE.VERSIONED_RELEASE_ASSET_WHITELIST_FAILED");
    await rename(stagingRoot, destinationRoot);
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}
