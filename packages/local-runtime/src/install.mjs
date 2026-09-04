import { createHash } from "node:crypto";
import { lstat, mkdir, open, readFile, rm, statfs, writeFile } from "node:fs/promises";
import path from "node:path";

import { atomicWriteJson, atomicWriteText } from "./atomic-file.mjs";
import { INSTALL_CATALOG, resolveSelectedArtifacts, validateInstallCatalog } from "./catalog.mjs";
import { downloadArtifact, verifyFileIdentity } from "./download.mjs";
import { extractComfyPortable, extractFfmpegArchive } from "./extract.mjs";
import { runtimeFail } from "./errors.mjs";
import { assertClosedObject, deepFreeze, normalizeWindowsAbsolutePath, stableJson } from "./util.mjs";

const OPERATION_ID = /^install-[0-9a-f]{24}$/u;
const GIB = 1024 ** 3;
const REQUIRED_ACKNOWLEDGEMENTS = Object.freeze([
  "licenseAccepted",
  "territoryAcknowledged",
  "commercialAcknowledged",
  "downloadConsent"
]);

function sha256Text(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function closed(value, fields, rule) {
  assertClosedObject(value, new Set(fields), "install", `local_runtime.install.${rule}`);
}

function normalizeOperationId(value) {
  if (typeof value !== "string" || !OPERATION_ID.test(value)) {
    runtimeFail("LOCAL_RUNTIME.INVALID_OPERATION_ID", "install", "local_runtime.install.operation_id");
  }
  return value;
}

function normalizePlanRequest(input) {
  closed(input, ["managedRoot", "components", "existingModelRoots", "hardware", "acknowledgements", "operationId"], "request");
  const managedRoot = normalizeWindowsAbsolutePath(input.managedRoot, "install");
  if (!Array.isArray(input.components) || input.components.length === 0 || input.components.some((value) => typeof value !== "string")) {
    runtimeFail("LOCAL_RUNTIME.INVALID_COMPONENTS", "install", "local_runtime.install.components");
  }
  const components = [...new Set(input.components)];
  const existingModelRoots = input.existingModelRoots ?? [];
  if (!Array.isArray(existingModelRoots) || existingModelRoots.some((value) => typeof value !== "string")) {
    runtimeFail("LOCAL_RUNTIME.INVALID_MODEL_ROOTS", "install", "local_runtime.install.model_roots");
  }
  const normalizedRoots = [...new Set(existingModelRoots.map((value) => normalizeWindowsAbsolutePath(value, "install")))];
  let vramBytes = null;
  if (input.hardware !== undefined) {
    closed(input.hardware, ["vramBytes"], "hardware");
    if (!Number.isSafeInteger(input.hardware.vramBytes) || input.hardware.vramBytes < 0) {
      runtimeFail("LOCAL_RUNTIME.INVALID_HARDWARE", "install", "local_runtime.install.vram_bytes");
    }
    vramBytes = input.hardware.vramBytes;
  }
  const acknowledgements = input.acknowledgements ?? {};
  closed(acknowledgements, REQUIRED_ACKNOWLEDGEMENTS, "acknowledgements");
  const normalized = {
    managedRoot,
    components,
    existingModelRoots: normalizedRoots,
    hardware: { vramBytes },
    acknowledgements: Object.fromEntries(REQUIRED_ACKNOWLEDGEMENTS.map((key) => [key, acknowledgements[key] === true]))
  };
  if (input.operationId !== undefined) normalized.operationId = normalizeOperationId(input.operationId);
  return normalized;
}

function normalizeLocatorRequest(input) {
  closed(input, ["managedRoot", "operationId"], "locator");
  return {
    managedRoot: normalizeWindowsAbsolutePath(input.managedRoot, "install"),
    operationId: normalizeOperationId(input.operationId)
  };
}

function operationIdFor(request, catalog) {
  const basis = stableJson({ managedRoot: request.managedRoot.toUpperCase(), components: [...request.components].sort(), catalog_id: catalog.catalog_id });
  return `install-${sha256Text(basis).slice(0, 24)}`;
}

function internalPaths(managedRoot, operationId) {
  const stateRoot = path.join(managedRoot, ".minimax-h3", "install", operationId);
  return {
    stateRoot,
    state: path.join(stateRoot, "state.json"),
    request: path.join(stateRoot, "request.json"),
    preparedPlan: path.join(stateRoot, "prepared-plan.json"),
    cancel: path.join(stateRoot, "cancel.requested"),
    lock: path.join(stateRoot, "install.lock"),
    manifest: path.join(managedRoot, ".minimax-h3", "managed-manifest.json"),
    extraModels: path.join(managedRoot, ".minimax-h3", "extra_model_paths.yaml")
  };
}

async function readJson(filePath, code = "LOCAL_RUNTIME.INSTALL_STATE_NOT_FOUND") {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") runtimeFail(code, "install", "local_runtime.install.state_exists", 1);
    runtimeFail("LOCAL_RUNTIME.INSTALL_STATE_CORRUPT", "install", "local_runtime.install.state_json");
  }
}

async function readOptionalJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    runtimeFail("LOCAL_RUNTIME.INSTALL_STATE_CORRUPT", "install", "local_runtime.install.state_json");
  }
}

async function isPlainPath(filePath) {
  const root = path.parse(filePath).root;
  const relative = path.relative(root, filePath);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) return false;
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
  }
  return true;
}

async function ensureManagedRoot(managedRoot) {
  const root = path.parse(managedRoot).root;
  const relative = path.relative(root, managedRoot);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) runtimeFail("LOCAL_RUNTIME.MANAGED_ROOT_REPARSE_FORBIDDEN", "install", "local_runtime.install.plain_managed_root");
    } catch (error) {
      if (error?.code === "ENOENT") break;
      throw error;
    }
  }
  await mkdir(managedRoot, { recursive: true });
  if (!await isPlainPath(managedRoot)) runtimeFail("LOCAL_RUNTIME.MANAGED_ROOT_REPARSE_FORBIDDEN", "install", "local_runtime.install.plain_managed_root");
}

function artifactDestination(managedRoot, artifact) {
  const relative = artifact.destination_relative_path.split("/");
  return path.join(managedRoot, ...relative);
}

function externalCandidates(root, artifact) {
  const relative = artifact.relative_path.split("/");
  const filename = relative.at(-1);
  return [
    path.join(root, ...relative),
    path.join(root, filename),
    path.join(root, "models", ...relative),
    path.join(root, "ComfyUI", "models", ...relative)
  ];
}

async function findVerifiedExternal(artifact, roots) {
  for (const root of roots) {
    for (const candidate of externalCandidates(root, artifact)) {
      if (!await isPlainPath(candidate)) continue;
      const identity = await verifyFileIdentity(candidate, artifact);
      if (identity.verified) return candidate;
    }
  }
  return null;
}

async function managedManifestHasArtifact(managedRoot, artifact) {
  const paths = internalPaths(managedRoot, "install-000000000000000000000000");
  let manifest;
  try {
    manifest = JSON.parse(await readFile(paths.manifest, "utf8"));
  } catch {
    return false;
  }
  const entry = manifest.artifacts?.find((value) => value.id === artifact.id);
  return entry?.expected_byte_length === artifact.expected_byte_length && entry.expected_sha256 === artifact.expected_sha256;
}

async function managedComfyIsPinned(managedRoot, artifact) {
  if (!await managedManifestHasArtifact(managedRoot, artifact)) return false;
  const runtime = path.join(managedRoot, "runtime", "ComfyUI_windows_portable");
  return await isPlainPath(path.join(runtime, "python_embeded", "python.exe")) && await isPlainPath(path.join(runtime, "ComfyUI", "main.py"));
}

async function managedFfmpegIsPinned(managedRoot, artifact) {
  if (!await managedManifestHasArtifact(managedRoot, artifact)) return false;
  const destination = path.join(managedRoot, ...artifact.managed_destination_relative_path.split("/"));
  for (const relativeFile of artifact.required_files) {
    if (!await isPlainPath(path.join(destination, ...relativeFile.split("/")))) return false;
  }
  return true;
}

async function freeBytesFor(managedRoot, override) {
  if (Number.isSafeInteger(override) && override >= 0) return override;
  try {
    const value = await statfs(path.parse(managedRoot).root, { bigint: true });
    const result = value.bavail * value.bsize;
    return result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : Number.MAX_SAFE_INTEGER;
  } catch {
    return null;
  }
}

function hardwareProfile(vramBytes) {
  if (Number.isSafeInteger(vramBytes) && vramBytes >= 24 * GIB) return { id: "preferred_24gb_plus", runnable: true, experimental: false, memory_args: ["--reserve-vram", "2"] };
  if (Number.isSafeInteger(vramBytes) && vramBytes >= 15 * GIB) return { id: "experimental_16gb_class", runnable: true, experimental: true, memory_args: ["--lowvram", "--reserve-vram", "2", "--async-offload"] };
  return { id: vramBytes === null ? "unknown_blocked" : "below_16gb_class_blocked", runnable: false, experimental: false, memory_args: [] };
}

function launchPlan(managedRoot, profile, hasExternalModels) {
  const portable = path.join(managedRoot, "runtime", "ComfyUI_windows_portable");
  const args = [
    path.join(portable, "ComfyUI", "main.py"),
    "--listen", "127.0.0.1",
    "--port", "8188",
    "--disable-auto-launch",
    "--disable-api-nodes",
    "--disable-all-custom-nodes",
    ...profile.memory_args
  ];
  if (hasExternalModels) args.push("--extra-model-paths-config", path.join(managedRoot, ".minimax-h3", "extra_model_paths.yaml"));
  return {
    status: profile.runnable ? "ready_after_install" : "blocked",
    hardware_profile: profile.id,
    experimental: profile.experimental,
    executable: path.join(portable, "python_embeded", "python.exe"),
    args,
    cwd: path.join(portable, "ComfyUI"),
    loopback_only: true,
    api_nodes_disabled: true,
    all_custom_nodes_disabled: true,
    started: false,
    prompt_submitted: false,
    queue_submitted: false
  };
}

async function buildPlan(input, dependencies = {}, includePrivate = false) {
  const request = normalizePlanRequest(input);
  const catalog = dependencies.catalog ?? INSTALL_CATALOG;
  validateInstallCatalog(catalog, { allowHttp: dependencies.testMode === true });
  let artifacts;
  try {
    artifacts = resolveSelectedArtifacts(request.components, catalog, { allowHttp: dependencies.testMode === true });
  } catch (error) {
    if (error?.code === "CATALOG_COMPONENT_BLOCKED") {
      runtimeFail("LOCAL_RUNTIME.COMPONENT_BLOCKED", "install", `local_runtime.install.blocked_component.${error.component}`);
    }
    runtimeFail("LOCAL_RUNTIME.INVALID_COMPONENTS", "install", "local_runtime.install.catalog_components");
  }
  const operationId = operationIdFor(request, catalog);
  if (request.operationId !== undefined && request.operationId !== operationId) {
    runtimeFail("LOCAL_RUNTIME.OPERATION_ID_MISMATCH", "install", "local_runtime.install.deterministic_operation_id");
  }
  const entries = [];
  for (const artifact of artifacts) {
    const destinationPath = artifactDestination(request.managedRoot, artifact);
    let action = "download";
    let sourcePath = null;
    if (artifact.kind === "comfy_archive") {
      if (await managedComfyIsPinned(request.managedRoot, artifact)) action = "reuse_managed";
      else {
        const archiveIdentity = await verifyFileIdentity(destinationPath, artifact);
        if (archiveIdentity.verified) action = "extract_downloaded_archive";
      }
    } else if (artifact.kind === "ffmpeg_archive") {
      if (await managedFfmpegIsPinned(request.managedRoot, artifact)) action = "reuse_managed";
      else {
        const archiveIdentity = await verifyFileIdentity(destinationPath, artifact);
        if (archiveIdentity.verified) action = "extract_downloaded_archive";
      }
    } else if (artifact.kind === "external_installer") {
      const managedIdentity = await verifyFileIdentity(destinationPath, artifact);
      if (managedIdentity.verified) action = "reuse_managed";
    } else {
      const managedIdentity = await verifyFileIdentity(destinationPath, artifact);
      if (managedIdentity.verified) action = "reuse_managed";
      else {
        sourcePath = await findVerifiedExternal(artifact, request.existingModelRoots);
        if (sourcePath) action = "reuse_external_read_only";
      }
    }
    const downloadBytes = action === "download" ? artifact.expected_byte_length : 0;
    const entry = {
      artifact_id: artifact.id,
      component: artifact.component,
      kind: artifact.kind,
      role: artifact.role,
      action,
      destination_relative_path: artifact.destination_relative_path,
      expected_byte_length: artifact.expected_byte_length,
      expected_sha256: artifact.expected_sha256,
      download_bytes: downloadBytes,
      external_read_only: action === "reuse_external_read_only",
      experimental: artifact.experimental === true
    };
    if (artifact.kind === "external_installer") entry.execution_policy = artifact.execution_policy;
    if (includePrivate) Object.defineProperties(entry, {
      artifact: { value: artifact, enumerable: false },
      destinationPath: { value: destinationPath, enumerable: false },
      sourcePath: { value: sourcePath, enumerable: false }
    });
    entries.push(entry);
  }
  const downloadBytes = entries.reduce((sum, value) => sum + value.download_bytes, 0);
  const avoidedBytes = entries.filter((value) => value.action.startsWith("reuse_")).reduce((sum, value) => sum + value.expected_byte_length, 0);
  const artifactsById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const installedEstimate = entries
    .filter((value) => (value.kind === "comfy_archive" || value.kind === "ffmpeg_archive") && value.action !== "reuse_managed")
    .reduce((sum, value) => sum + (artifactsById.get(value.artifact_id)?.installed_byte_estimate ?? 0), 0);
  const safetyReserve = 512 * 1024 * 1024;
  const requiredFreeBytes = downloadBytes + installedEstimate + safetyReserve;
  const freeBytes = await freeBytesFor(request.managedRoot, dependencies.freeSpaceBytes);
  const profile = hardwareProfile(request.hardware.vramBytes);
  const executionAuthorized = REQUIRED_ACKNOWLEDGEMENTS.every((key) => request.acknowledgements[key] === true);
  const plan = {
    schema_version: "1.0.0",
    operation_id: operationId,
    managed_root: request.managedRoot,
    selected_components: request.components,
    catalog_id: catalog.catalog_id,
    entries,
    totals: {
      download_bytes: downloadBytes,
      avoided_download_bytes: avoidedBytes,
      installed_byte_estimate: installedEstimate,
      safety_reserve_bytes: safetyReserve,
      required_free_bytes: requiredFreeBytes,
      available_free_bytes: freeBytes,
      space_status: freeBytes === null ? "unknown_blocked" : freeBytes >= requiredFreeBytes ? "sufficient" : "insufficient"
    },
    required_acknowledgements: REQUIRED_ACKNOWLEDGEMENTS,
    execution_authorized: executionAuthorized,
    launch_plan: launchPlan(request.managedRoot, profile, entries.some((value) => value.external_read_only))
  };
  if (includePrivate) Object.defineProperties(plan, {
    request: { value: request, enumerable: false },
    catalog: { value: catalog, enumerable: false }
  });
  return plan;
}

export async function createInstallPlan(input, dependencies = {}) {
  return deepFreeze(await buildPlan(input, dependencies, false));
}

function preparedStateFor(plan) {
  return {
    schema_version: "1.0.0",
    operation_id: plan.operation_id,
    status: "in_progress",
    managed_root: plan.managed_root,
    entries: plan.entries.map((entry) => ({
      artifact_id: entry.artifact_id,
      action: entry.action,
      status: entry.action.startsWith("reuse_") ? "reused" : "pending",
      downloaded_bytes: 0
    })),
    launch_plan: plan.launch_plan,
    error: null
  };
}

function preparedBindingFor(plan) {
  return {
    schema_version: "1.0.0",
    operation_id: plan.operation_id,
    managed_root: plan.managed_root,
    catalog_id: plan.catalog_id,
    selected_components: plan.selected_components,
    entries: plan.entries.map((entry) => ({
      artifact_id: entry.artifact_id,
      action: entry.action,
      destination_relative_path: entry.destination_relative_path,
      expected_byte_length: entry.expected_byte_length,
      expected_sha256: entry.expected_sha256
    }))
  };
}

function samePreparedBinding(left, right) {
  return left !== null && stableJson(left) === stableJson(right);
}

export async function prepareInstallPlan(input, dependencies = {}) {
  const plan = await createInstallPlan(input, dependencies);
  await ensureManagedRoot(plan.managed_root);
  const paths = internalPaths(plan.managed_root, plan.operation_id);
  await acquireLock(paths.lock, false);
  try {
    const binding = preparedBindingFor(plan);
    const [existingBinding, existingState] = await Promise.all([
      readOptionalJson(paths.preparedPlan),
      readOptionalJson(paths.state)
    ]);
    if (existingState?.status === "in_progress" && samePreparedBinding(existingBinding, binding)) return plan;
    await rm(paths.cancel, { force: true });
    await atomicWriteJson(paths.preparedPlan, binding);
    await atomicWriteJson(paths.state, preparedStateFor(plan));
  } finally {
    await rm(paths.lock, { force: true });
  }
  return plan;
}

async function cancelled(cancelPath) {
  try {
    return (await lstat(cancelPath)).isFile();
  } catch {
    return false;
  }
}

async function activeInstallWriter(lockPath) {
  let lock;
  try {
    lock = JSON.parse(await readFile(lockPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    return false;
  }
  if (!Number.isSafeInteger(lock?.pid) || lock.pid <= 0) return false;
  try {
    process.kill(lock.pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function acquireLock(lockPath, recover) {
  await mkdir(path.dirname(lockPath), { recursive: true });
  if (recover) {
    try {
      const current = JSON.parse(await readFile(lockPath, "utf8"));
      try {
        process.kill(current.pid, 0);
        runtimeFail("LOCAL_RUNTIME.INSTALL_ALREADY_RUNNING", "install", "local_runtime.install.single_writer", 1);
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
      await rm(lockPath, { force: true });
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "LOCAL_RUNTIME.INSTALL_ALREADY_RUNNING") throw error;
    }
  }
  try {
    const handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(`${stableJson({ pid: process.pid })}\n`, "utf8");
    await handle.close();
  } catch (error) {
    if (error?.code === "EEXIST") runtimeFail("LOCAL_RUNTIME.INSTALL_ALREADY_RUNNING", "install", "local_runtime.install.single_writer", 1);
    throw error;
  }
}

async function writeExtraModelPaths(filePath, entries) {
  const models = entries.filter((entry) => entry.kind === "model");
  if (models.length === 0) {
    await rm(filePath, { force: true });
    return;
  }
  const managed = models.filter((entry) => entry.action !== "reuse_external_read_only");
  const external = models.filter((entry) => entry.action === "reuse_external_read_only");
  const lines = ["# Generated by Relay. Managed paths are tool-owned; external model files remain read-only."];
  if (managed.length > 0) {
    let managedModelRoot = managed[0].destinationPath;
    for (const _segment of managed[0].artifact.relative_path.split("/")) managedModelRoot = path.dirname(managedModelRoot);
    const categories = [...new Set(managed.map((entry) => entry.artifact.relative_path.split("/")[0]))].sort();
    lines.push("minimax_h3_managed:");
    lines.push(`  base_path: ${JSON.stringify(managedModelRoot)}`);
    for (const category of categories) lines.push(`  ${category}: ${category}`);
  }
  for (const [index, entry] of external.entries()) {
    const category = entry.artifact.relative_path.split("/")[0];
    lines.push(`minimax_h3_external_${index + 1}:`);
    lines.push(`  base_path: ${JSON.stringify(path.dirname(entry.sourcePath))}`);
    lines.push(`  ${category}: .`);
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  await atomicWriteText(filePath, `${lines.join("\n")}\n`);
}

async function readManifest(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return { schema_version: "1.0.0", artifacts: [] };
    runtimeFail("LOCAL_RUNTIME.MANIFEST_CORRUPT", "install", "local_runtime.install.manifest_json");
  }
}

async function recordManagedArtifact(filePath, artifact) {
  const manifest = await readManifest(filePath);
  manifest.artifacts = manifest.artifacts.filter((value) => value.id !== artifact.id);
  manifest.artifacts.push({
    id: artifact.id,
    expected_byte_length: artifact.expected_byte_length,
    expected_sha256: artifact.expected_sha256,
    destination_relative_path: artifact.destination_relative_path,
    source_revision: artifact.source.revision
  });
  manifest.artifacts.sort((left, right) => left.id.localeCompare(right.id, "en"));
  await atomicWriteJson(filePath, manifest);
}

function publicState(state) {
  return deepFreeze({
    schema_version: state.schema_version,
    operation_id: state.operation_id,
    status: state.status,
    managed_root: state.managed_root,
    entries: state.entries,
    launch_plan: state.launch_plan,
    error: state.error ?? null
  });
}

async function executeInstall(input, dependencies = {}, recover = false) {
  const request = normalizePlanRequest(input);
  const catalog = dependencies.catalog ?? INSTALL_CATALOG;
  validateInstallCatalog(catalog, { allowHttp: dependencies.testMode === true });
  const expectedOperationId = operationIdFor(request, catalog);
  if (request.operationId !== undefined && request.operationId !== expectedOperationId) {
    runtimeFail("LOCAL_RUNTIME.OPERATION_ID_MISMATCH", "install", "local_runtime.install.deterministic_operation_id");
  }
  await ensureManagedRoot(request.managedRoot);
  const paths = internalPaths(request.managedRoot, expectedOperationId);
  await acquireLock(paths.lock, recover);
  let state = null;
  try {
    state = await readOptionalJson(paths.state);
    const plan = await buildPlan(input, dependencies, true);
    if (!plan.execution_authorized) runtimeFail("LOCAL_RUNTIME.ACKNOWLEDGEMENTS_REQUIRED", "install", "local_runtime.install.four_acknowledgements");
    if (plan.totals.space_status !== "sufficient") runtimeFail("LOCAL_RUNTIME.INSUFFICIENT_OR_UNKNOWN_SPACE", "install", "local_runtime.install.space_preflight");
    if (plan.launch_plan.status === "blocked") runtimeFail("LOCAL_RUNTIME.HARDWARE_PROFILE_BLOCKED", "install", "local_runtime.install.minimum_16gb_class_vram");
    state = {
      schema_version: "1.0.0",
      operation_id: plan.operation_id,
      status: "in_progress",
      managed_root: plan.request.managedRoot,
      entries: plan.entries.map((entry) => ({ artifact_id: entry.artifact_id, action: entry.action, status: entry.action.startsWith("reuse_") ? "reused" : "pending", downloaded_bytes: 0 })),
      launch_plan: plan.launch_plan,
      error: null
    };
    await atomicWriteJson(paths.request, plan.request);
    await atomicWriteJson(paths.state, state);
    if (await cancelled(paths.cancel)) {
      state.status = "cancelled";
      await atomicWriteJson(paths.state, state);
      return publicState(state);
    }
    await writeExtraModelPaths(paths.extraModels, plan.entries);
    for (let index = 0; index < plan.entries.length; index += 1) {
      const entry = plan.entries[index];
      const stateEntry = state.entries[index];
      if (await cancelled(paths.cancel)) {
        state.status = "cancelled";
        stateEntry.status = "cancelled";
        await atomicWriteJson(paths.state, state);
        return publicState(state);
      }
      if (stateEntry.status === "reused") continue;
      stateEntry.status = "running";
      await atomicWriteJson(paths.state, state);
      const result = await downloadArtifact({
        artifact: entry.artifact,
        destinationPath: entry.destinationPath,
        fetchImpl: dependencies.fetchImpl,
        allowHttp: dependencies.testMode === true,
        isCancelled: () => cancelled(paths.cancel),
        onProgress: async (downloaded) => {
          stateEntry.downloaded_bytes = downloaded;
          await atomicWriteJson(paths.state, state);
        }
      });
      if (result.status === "cancelled") {
        state.status = "cancelled";
        stateEntry.status = "cancelled";
        stateEntry.downloaded_bytes = result.downloaded_bytes;
        await atomicWriteJson(paths.state, state);
        return publicState(state);
      }
      stateEntry.downloaded_bytes = result.byte_length;
      if (entry.kind === "comfy_archive") {
        const staging = path.join(plan.request.managedRoot, ".minimax-h3", "staging", plan.operation_id, "comfy");
        const destination = path.join(plan.request.managedRoot, "runtime", "ComfyUI_windows_portable");
        await extractComfyPortable({ archivePath: entry.destinationPath, stagingPath: staging, destinationPath: destination, runner: dependencies.tarRunner });
        await recordManagedArtifact(paths.manifest, entry.artifact);
        await rm(entry.destinationPath, { force: true });
      } else if (entry.kind === "ffmpeg_archive") {
        const staging = path.join(plan.request.managedRoot, ".minimax-h3", "staging", plan.operation_id, "ffmpeg");
        const destination = path.join(plan.request.managedRoot, ...entry.artifact.managed_destination_relative_path.split("/"));
        const extracted = await extractFfmpegArchive({
          archivePath: entry.destinationPath,
          stagingPath: staging,
          destinationPath: destination,
          archiveRoot: entry.artifact.archive_root,
          requiredFiles: entry.artifact.required_files,
          runner: dependencies.tarRunner,
          isCancelled: () => cancelled(paths.cancel)
        });
        if (extracted.status === "cancelled") {
          state.status = "cancelled";
          stateEntry.status = "cancelled";
          await atomicWriteJson(paths.state, state);
          return publicState(state);
        }
        await recordManagedArtifact(paths.manifest, entry.artifact);
        await rm(entry.destinationPath, { force: true });
      } else {
        await recordManagedArtifact(paths.manifest, entry.artifact);
      }
      stateEntry.status = "complete";
      await atomicWriteJson(paths.state, state);
    }
    state.status = "complete";
    await rm(paths.cancel, { force: true });
    await atomicWriteJson(paths.state, state);
    return publicState(state);
  } catch (error) {
    if (state !== null) {
      state.status = "failed";
      state.error = error?.code ? { code: error.code, rule_id: error.rule_id ?? "local_runtime.install.dependency" } : { code: "LOCAL_RUNTIME.INSTALL_FAILED", rule_id: "local_runtime.install.internal" };
      const running = state.entries.find((entry) => entry.status === "running");
      if (running) running.status = "failed";
      try { await atomicWriteJson(paths.state, state); } catch {}
    }
    throw error;
  } finally {
    await rm(paths.lock, { force: true });
  }
}

export async function installComponents(input, dependencies = {}) {
  return executeInstall(input, dependencies, false);
}

export async function getInstallStatus(input) {
  const request = normalizeLocatorRequest(input);
  const paths = internalPaths(request.managedRoot, request.operationId);
  const state = await readJson(paths.state);
  if (await cancelled(paths.cancel) && state.status === "in_progress") state.status = "cancellation_requested";
  const running = state.entries.find((entry) => entry.status === "running");
  if (state.status === "in_progress" && running !== undefined && !await activeInstallWriter(paths.lock)) {
    state.status = "failed";
    state.error = {
      code: "LOCAL_RUNTIME.INSTALL_ORPHANED",
      rule_id: "local_runtime.install.orphaned_writer"
    };
    running.status = "failed";
  }
  return publicState(state);
}

export async function cancelInstall(input) {
  const request = normalizeLocatorRequest(input);
  const paths = internalPaths(request.managedRoot, request.operationId);
  const state = await readJson(paths.state);
  if (["complete", "failed", "cancelled"].includes(state.status)) {
    return deepFreeze({ operation_id: request.operationId, status: state.status });
  }
  await writeFile(paths.cancel, "cancel\n", { encoding: "utf8", flag: "w", mode: 0o600 });
  return deepFreeze({ operation_id: request.operationId, status: "cancellation_requested" });
}

export async function recoverInstall(input, dependencies = {}) {
  const request = normalizeLocatorRequest(input);
  const paths = internalPaths(request.managedRoot, request.operationId);
  const original = await readJson(paths.request, "LOCAL_RUNTIME.INSTALL_REQUEST_NOT_FOUND");
  await rm(paths.cancel, { force: true });
  return executeInstall({ ...original, operationId: request.operationId }, dependencies, true);
}
