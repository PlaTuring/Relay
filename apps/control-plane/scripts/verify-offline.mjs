import { readdir, readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import { nativeEvidenceRoot, projectRoot, releaseArtifactName, runNodeScript, sha256, sha256File } from "./lib.mjs";
import {
  inventoryDirectoryInputs,
  inventoryTopLevel,
  isExcludedInventoryPath,
  nativeInventoryInputs,
  repositoryTopLevelInputs
} from "./input-inventory-contract.mjs";
import {
  assertFrozenExtraResourceInputs,
  assertPackageInventoriesEqual,
  attestPackagedRuntimeResources,
  collectPackageInputInventory,
  packageInventoryDigest,
  readJson,
  sourceInventoryDigest,
  writePackageInputInventory
} from "./release-resource-attestation.mjs";
import {
  assertSignatureEvidence,
  loadSigningConfiguration
} from "./signing-contract.mjs";

let sourceOnly = false;
let signedRelease = false;
for (const argument of process.argv.slice(2)) {
  if (argument === "--source-only") sourceOnly = true;
  else if (argument === "--signed") signedRelease = true;
  else throw new Error("OFFLINE_VERIFY.INVALID_ARGUMENT");
}
if (sourceOnly && signedRelease) throw new Error("OFFLINE_VERIFY.CONFLICTING_MODE");
const signingConfiguration = signedRelease ? await loadSigningConfiguration(process.env) : null;
const releaseMode = signedRelease ? "signed" : "unsigned";
const releaseRoot = resolve(projectRoot, signedRelease ? "release-signed" : "release-unsigned");

const packageJson = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8"));
const packageLock = JSON.parse(await readFile(resolve(projectRoot, "package-lock.json"), "utf8"));
const inventory = JSON.parse(
  await readFile(resolve(projectRoot, "build", "input-inventory.json"), "utf8")
);

const directDependencies = packageJson.devDependencies;
for (const [name, version] of Object.entries(directDependencies)) {
  if (!/^\d+\.\d+\.\d+$/u.test(version)) {
    throw new Error(`SUPPLY_CHAIN.NON_EXACT_DIRECT_VERSION:${name}`);
  }
}
if (
  JSON.stringify(packageLock.packages[""].devDependencies) !==
  JSON.stringify(directDependencies)
) {
  throw new Error("SUPPLY_CHAIN.ROOT_LOCK_MISMATCH");
}
for (const [path, entry] of Object.entries(packageLock.packages)) {
  if (path === "") {
    continue;
  }
  if (
    typeof entry.version !== "string" ||
    typeof entry.integrity !== "string" ||
    typeof entry.resolved !== "string" ||
    typeof entry.license !== "string"
  ) {
    throw new Error("SUPPLY_CHAIN.INCOMPLETE_LOCK_ENTRY");
  }
  if (/\b(?:latest|main|master|HEAD)\b/u.test(entry.resolved)) {
    throw new Error("SUPPLY_CHAIN.MUTABLE_RESOLUTION");
  }
}

async function collectFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(absolute)));
    } else if (entry.isFile()) {
      files.push(absolute);
    }
  }
  return files;
}

const actualInputPaths = [
  ...inventoryTopLevel.map((path) => resolve(projectRoot, path)),
  ...(
    await Promise.all(
      inventoryDirectoryInputs(projectRoot).map((path) => collectFiles(path))
    )
  ).flat(),
  ...repositoryTopLevelInputs(projectRoot),
  ...nativeInventoryInputs(projectRoot)
]
  .map((path) => relative(projectRoot, path).split(sep).join("/"))
  .filter(
    (path) => path !== "build/input-inventory.json" && !isExcludedInventoryPath(path)
  )
  .sort((left, right) => left.localeCompare(right, "en"));
const declaredInputPaths = inventory.inputs.map((input) => input.path);
if (JSON.stringify(actualInputPaths) !== JSON.stringify(declaredInputPaths)) {
  throw new Error("BUILD_INPUT.FILE_SET_MISMATCH");
}

for (const input of inventory.inputs) {
  const absolute = resolve(projectRoot, ...input.path.split("/"));
  const bytes = await readFile(absolute);
  if (bytes.length !== input.bytes || sha256(bytes) !== input.sha256) {
    throw new Error(`BUILD_INPUT.MISMATCH:${input.path}`);
  }
}

let nativeHelperEvidence = null;
if (!signedRelease) {
  runNodeScript("scripts/typecheck.mjs");
  runNodeScript("scripts/build.mjs");
  nativeHelperEvidence = runNodeScript("scripts/verify-native-helper.mjs");
  runNodeScript("scripts/test.mjs");
  runNodeScript("scripts/generate-supply-chain.mjs", ["--sbom"]);
  runNodeScript("scripts/generate-supply-chain.mjs", ["--licenses"]);
  runNodeScript("scripts/lint-public-evidence.mjs");
}

const actualPackageInventory = await collectPackageInputInventory(projectRoot, packageJson);
assertFrozenExtraResourceInputs(actualPackageInventory, inventory);
if (sourceOnly) {
  await writePackageInputInventory(projectRoot, actualPackageInventory);
} else {
  const declaredPackageInventory = await readJson(
    resolve(projectRoot, "artifacts", "package-input-inventory.json")
  );
  assertPackageInventoriesEqual(actualPackageInventory, declaredPackageInventory);
}

const sourceInventorySha256 = sourceInventoryDigest(inventory);
const packageInventorySha256 = packageInventoryDigest(actualPackageInventory);
async function readOptionalJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

const distNativeHelper = resolve(projectRoot, "dist", "main", "native", "relay-winbroker.exe");
if (!signedRelease) {
  const nativeEvidencePath = resolve(nativeEvidenceRoot, "native-runtime-probe.json");
  const nativeEvidence = JSON.parse(await readFile(nativeEvidencePath, "utf8"));
  const nativeEvidenceValid =
    nativeHelperEvidence.includes("NATIVE_VERIFY status=enabled-profile-passed enabled=2 reserved_rejected=6") &&
    nativeEvidence.conclusion === "enabled_profile_passed" &&
    nativeEvidence.capability_profile?.enabled_count === 2 &&
    nativeEvidence.capability_profile?.reserved_rejected_count === 6 &&
    nativeEvidence.binary?.sha256 === await sha256File(distNativeHelper);
  if (!nativeEvidenceValid) throw new Error("NATIVE_HELPER.EVIDENCE_MISMATCH");
}

const packagedIdentityPath = resolve(nativeEvidenceRoot, "packaged-native-identity.json");
const packagedCallPath = resolve(nativeEvidenceRoot, "packaged-app-native-call.json");
const packagedIdentity = sourceOnly ? null : await readOptionalJson(packagedIdentityPath);
const packagedCall = sourceOnly ? null : await readOptionalJson(packagedCallPath);
let packageGate = "pending_release_artifact_validation";
let resourceGate = "pending_packaged_runtime_resource_attestation";
let signingGate = signedRelease
  ? "pending_signed_release_validation"
  : "not_required_unsigned_release";
// Source-only verification intentionally validates the current source tree and
// its frozen inputs without consulting evidence from an older packaged build.
// Release verification keeps the packaged evidence mandatory below.
if (!sourceOnly && (packagedIdentity !== null || packagedCall !== null)) {
  const packagedHelper = resolve(
    releaseRoot, "win-unpacked", "resources", "app.asar.unpacked",
    "dist", "main", "native", "relay-winbroker.exe"
  );
  const packagedExecutable = resolve(releaseRoot, "win-unpacked", "Relay.exe");
  const packagedHelperSha256 = await sha256File(packagedHelper);
  if (
    packagedIdentity?.release_mode !== releaseMode ||
    (!signedRelease && packagedIdentity?.byte_identical !== true) ||
    packagedIdentity?.runtime_probe !== "passed" ||
    packagedIdentity?.packaged?.sha256 !== packagedHelperSha256 ||
    packagedCall?.release_mode !== releaseMode ||
    packagedCall?.conclusion !== "passed" ||
    packagedCall?.packaged_executable_sha256 !== await sha256File(packagedExecutable) ||
    packagedCall?.packaged_native_helper_sha256 !== packagedHelperSha256 ||
    JSON.stringify(packagedCall?.enabled_operations_called) !== JSON.stringify([257, 258]) ||
    packagedCall?.native_marker !== "PACKAGED_NATIVE_HELPER_READY profile=relay.win32.path-inspection enabled=2" ||
    packagedCall?.adapter_marker !== "PACKAGED_ADAPTER_READY streamA=stream_a_cli streamB=stream_b_cli" ||
    packagedCall?.product_boundary?.ran_model !== false ||
    packagedCall?.product_boundary?.submitted_prompt !== false ||
    packagedCall?.product_boundary?.submitted_queue !== false ||
    packagedCall?.product_boundary?.generated_media !== false
  ) throw new Error("PACKAGE.NATIVE_EVIDENCE_MISMATCH");

  const resourceEvidencePath = resolve(
    nativeEvidenceRoot,
    signedRelease
      ? "packaged-runtime-resource-attestation-signed.json"
      : "packaged-runtime-resource-attestation.json"
  );
  const declaredResourceEvidence = await readJson(resourceEvidencePath);
  const actualResourceEvidence = await attestPackagedRuntimeResources({
    projectRoot,
    releaseRoot,
    packageMetadata: packageJson,
    packageInventory: actualPackageInventory,
    sourceInventory: inventory,
    evidencePath: null,
    releaseMode
  });
  if (JSON.stringify(declaredResourceEvidence) !== JSON.stringify(actualResourceEvidence)) {
    throw new Error("PACKAGE_RESOURCE.EVIDENCE_MISMATCH");
  }
  resourceGate = "passed_exact_file_set_length_sha256";

  if (signedRelease) {
    const signatureEvidence = await readJson(
      resolve(nativeEvidenceRoot, "signed-package-signatures.json")
    );
    if (signatureEvidence.expected_publisher !== signingConfiguration.expectedPublisher) {
      throw new Error("SIGNING.EVIDENCE_PUBLISHER_MISMATCH");
    }
    assertSignatureEvidence(
      signatureEvidence,
      ["source_native_helper", "packaged_native_helper", "packaged_application", "setup", "portable"],
      signingConfiguration.expectedPublisher
    );
    const signatureByLabel = new Map(signatureEvidence.signatures.map((entry) => [entry.label, entry]));
    if (
      signatureByLabel.get("packaged_native_helper")?.sha256 !== packagedHelperSha256 ||
      signatureByLabel.get("packaged_application")?.sha256 !== await sha256File(packagedExecutable) ||
      signatureByLabel.get("setup")?.sha256 !== await sha256File(resolve(
        releaseRoot, releaseArtifactName("setup")
      )) ||
      signatureByLabel.get("portable")?.sha256 !== await sha256File(resolve(
        releaseRoot, releaseArtifactName("portable")
      ))
    ) {
      throw new Error("SIGNING.PACKAGE_HASH_MISMATCH");
    }
    signingGate = "passed_packaged_helper_app_setup_portable";
  }
  packageGate = "passed_release_artifact_and_runtime";
}

const installerEvidence = sourceOnly
  ? null
  : await readOptionalJson(
      resolve(
        nativeEvidenceRoot,
        signedRelease ? "installer-runtime-validation-signed.json" : "installer-runtime-validation.json"
      )
    );
let installerGate = "pending_installer_validation";
if (!sourceOnly && installerEvidence !== null) {
  const setupPath = resolve(releaseRoot, releaseArtifactName("setup"));
  const packagedHelper = resolve(
    releaseRoot, "win-unpacked", "resources", "app.asar.unpacked",
    "dist", "main", "native", "relay-winbroker.exe"
  );
  if (
    installerEvidence.release_mode !== releaseMode ||
    installerEvidence.conclusion !== "passed" || installerEvidence.installer_exit_code !== 0 ||
    installerEvidence.installer_sha256 !== await sha256File(setupPath) ||
    installerEvidence.desktop_shortcut?.created !== true ||
    installerEvidence.desktop_shortcut?.target_verified !== true ||
    installerEvidence.start_menu_shortcut?.created !== true ||
    installerEvidence.start_menu_shortcut?.target_verified !== true ||
    installerEvidence.installed_native_helper?.runtime_probe !== "passed" ||
    installerEvidence.installed_native_helper?.sha256 !== await sha256File(packagedHelper) ||
    installerEvidence.installed_app_probe !== "passed" ||
    installerEvidence.uninstall?.exit_code !== 0 ||
    installerEvidence.uninstall?.install_directory_removed !== true ||
    installerEvidence.uninstall?.shortcuts_removed !== true ||
    installerEvidence.product_boundary?.ran_model !== false ||
    installerEvidence.product_boundary?.submitted_prompt !== false ||
    installerEvidence.product_boundary?.submitted_queue !== false ||
    installerEvidence.product_boundary?.generated_media !== false
  ) throw new Error("INSTALLER.EVIDENCE_MISMATCH");
  if (signedRelease) {
    const installerSignatures = [
      ...(installerEvidence.signatures?.release_artifacts ?? []),
      ...(installerEvidence.signatures?.installed ?? [])
    ];
    assertSignatureEvidence(
      {
        conclusion: installerEvidence.conclusion,
        release_mode: installerEvidence.release_mode,
        signatures: installerSignatures
      },
      ["setup", "portable", "installed_application", "installed_native_helper", "installed_uninstaller"],
      signingConfiguration.expectedPublisher
    );
    const installedSignatureByLabel = new Map(installerSignatures.map((entry) => [entry.label, entry]));
    if (
      installedSignatureByLabel.get("setup")?.sha256 !== await sha256File(setupPath) ||
      installedSignatureByLabel.get("portable")?.sha256 !== await sha256File(resolve(
        releaseRoot, releaseArtifactName("portable")
      )) ||
      installedSignatureByLabel.get("installed_native_helper")?.sha256 !== await sha256File(packagedHelper)
    ) {
      throw new Error("SIGNING.INSTALLER_HASH_MISMATCH");
    }
    signingGate = "passed_all_packaged_and_installed_pe_including_uninstaller";
  }
  installerGate = "passed_installer_shortcuts_runtime_uninstall";
}

if (!sourceOnly && packageGate !== "passed_release_artifact_and_runtime") {
  throw new Error("RELEASE_GATE.PACKAGE_EVIDENCE_REQUIRED");
}
if (!sourceOnly && installerGate !== "passed_installer_shortcuts_runtime_uninstall") {
  throw new Error("RELEASE_GATE.INSTALLER_EVIDENCE_REQUIRED");
}
if (!sourceOnly && resourceGate !== "passed_exact_file_set_length_sha256") {
  throw new Error("RELEASE_GATE.RUNTIME_RESOURCE_ATTESTATION_REQUIRED");
}
if (signedRelease && signingGate !== "passed_all_packaged_and_installed_pe_including_uninstaller") {
  throw new Error("RELEASE_GATE.SIGNED_EVIDENCE_REQUIRED");
}

let checksumGate = "not_required_source_only";
if (!sourceOnly) {
  const expectedNames = (signedRelease
    ? [releaseArtifactName("portable"), releaseArtifactName("setup")]
    : [releaseArtifactName("setup")]
  ).sort((left, right) => left.localeCompare(right, "en"));
  const checksumPath = resolve(releaseRoot, "SHA256SUMS");
  const checksumText = await readFile(checksumPath, "utf8");
  const checksumTextCopy = await readFile(resolve(releaseRoot, "SHA256SUMS.txt"), "utf8");
  if (checksumTextCopy !== checksumText) throw new Error("RELEASE_GATE.CHECKSUM_DOCUMENTS_DIFFER");
  const lines = checksumText.trimEnd().split("\n");
  if (lines.length !== expectedNames.length) throw new Error("RELEASE_GATE.CHECKSUM_ENTRY_COUNT");
  const parsed = new Map();
  for (const line of lines) {
    const match = /^([a-f0-9]{64}) \*([^\\/]+)$/u.exec(line.trimEnd());
    if (match === null || parsed.has(match[2])) throw new Error("RELEASE_GATE.CHECKSUM_ENTRY_INVALID");
    parsed.set(match[2], match[1]);
  }
  if (JSON.stringify([...parsed.keys()].sort((left, right) => left.localeCompare(right, "en"))) !== JSON.stringify(expectedNames)) {
    throw new Error("RELEASE_GATE.CHECKSUM_ARTIFACT_SET");
  }
  for (const name of expectedNames) {
    if (parsed.get(name) !== await sha256File(resolve(releaseRoot, name))) {
      throw new Error(`RELEASE_GATE.CHECKSUM_MISMATCH:${name}`);
    }
  }
  checksumGate = signedRelease
    ? "passed_setup_portable_exact_sha256"
    : "passed_setup_exact_sha256";
}
const summary = {
  status: sourceOnly ? "source_only_passed" : "release_passed",
  offline: true,
  direct_dependencies: Object.keys(directDependencies).length,
  locked_packages: Object.keys(packageLock.packages).length - 1,
  ipc_channels: 1,
  public_evidence: "passed",
  source_inventory_sha256: sourceInventorySha256,
  package_lock_sha256: await sha256File(resolve(projectRoot, "package-lock.json")),
  package_inputs_sha256: packageInventorySha256,
  package_gate: packageGate,
  packaged_runtime_resource_gate: resourceGate,
  checksum_gate: checksumGate,
  native_helper_gate: signedRelease
    ? "signed_packaged_runtime_probe_passed"
    : "enabled_profile_passed_2_of_2_reserved_6_rejected",
  signing_gate: signingGate,
  installer_runtime_gate: installerGate
};
process.stdout.write(`${JSON.stringify(summary)}\n`);
