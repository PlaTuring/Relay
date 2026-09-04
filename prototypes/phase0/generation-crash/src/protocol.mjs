import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  writeFileSync,
  writeSync
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURE_ID = "P0-ARC-011-generation-crash";
export const RECIPE_ID = "alpha-crash-fixture";
export const STATIC_TIME = "2000-01-01T00:00:00.000Z";
export const POINTER_LIMIT_BYTES = 4096;
export const ARTIFACT_SIZE = 128 * 1024;

export const REASONS = Object.freeze({
  ACTIVE_DELETE_DENIED: "GC.ACTIVE_DELETE_DENIED",
  ACTIVE_MISSING: "GC.ACTIVE_MISSING",
  COMPLETION_CHECKSUM: "GC.COMPLETION_CHECKSUM",
  COMPLETION_MISSING: "GC.COMPLETION_MISSING",
  GENERATION_ID_INVALID: "GC.GENERATION_ID_INVALID",
  GENERATION_MISSING: "GC.GENERATION_MISSING",
  MANIFEST_HASH: "GC.MANIFEST_HASH",
  MANIFEST_INCOMPLETE: "GC.MANIFEST_INCOMPLETE",
  NOT_OWNED: "GC.NOT_OWNED",
  OWNER_MISMATCH: "GC.OWNER_MISMATCH",
  PATH_ESCAPE: "GC.PATH_ESCAPE",
  POINTER_CHECKSUM: "GC.POINTER_CHECKSUM",
  POINTER_INVALID: "GC.POINTER_INVALID",
  POINTER_TOO_LARGE: "GC.POINTER_TOO_LARGE",
  REPARSE_REJECTED: "GC.REPARSE_REJECTED",
  TRANSACTION_MISMATCH: "GC.TRANSACTION_MISMATCH"
});

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
export const PROTOTYPE_ROOT = resolve(moduleDirectory, "..");
export const WORK_ROOT = resolve(PROTOTYPE_ROOT, "work");
export const SCENARIOS_ROOT = resolve(WORK_ROOT, "受管 崩溃 恢复", "Scenario Roots With Space");

const OWNER_FILE = ".generation-owner.json";
const SCENARIO_OWNER_FILE = ".scenario-owner.json";
const WORK_OWNER_FILE = ".work-owner.json";
const MANIFEST_FILE = "manifest.json";
const RECEIPT_FILE = "verification.json";
const COMPLETION_FILE = "complete.json";
const ARTIFACT_RELATIVE = "runtime/fake-runtime.bin";

export class ProtocolError extends Error {
  constructor(code) {
    super(code);
    this.name = "ProtocolError";
    this.code = code;
  }
}

export function fail(code) {
  throw new ProtocolError(code);
}

export function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  fail(REASONS.POINTER_INVALID);
}

export function objectChecksum(value) {
  return sha256Bytes(Buffer.from(canonicalJson(value), "utf8"));
}

export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function writeDurable(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
  const handle = openSync(path, "w");
  try {
    writeSync(handle, bytes, 0, bytes.length, 0);
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
}

export function writeJsonDurable(path, value) {
  writeDurable(path, stableJson(value));
}

export function readJson(path, reason = REASONS.POINTER_INVALID) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail(reason);
  }
}

function normalized(path) {
  return resolve(path).replace(/[\\/]+$/u, "");
}

export function assertContained(candidate, root, allowEqual = false) {
  const candidatePath = normalized(candidate);
  const rootPath = normalized(root);
  if (allowEqual && candidatePath.toLowerCase() === rootPath.toLowerCase()) return candidatePath;
  const value = relative(rootPath, candidatePath);
  if (!value || value === ".." || value.startsWith(`..${sep}`) || isAbsolute(value)) {
    fail(REASONS.PATH_ESCAPE);
  }
  return candidatePath;
}

export function assertNoLinks(path) {
  if (!existsSync(path)) return;
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink()) fail(REASONS.REPARSE_REJECTED);
  if (!metadata.isDirectory()) return;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    const childMetadata = lstatSync(child);
    if (childMetadata.isSymbolicLink()) fail(REASONS.REPARSE_REJECTED);
    if (childMetadata.isDirectory()) assertNoLinks(child);
  }
}

function assertExactKeys(value, keys, reason) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(reason);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (canonicalJson(actual) !== canonicalJson(expected)) fail(reason);
}

export function fakeArtifactBytes() {
  const value = Buffer.allocUnsafe(ARTIFACT_SIZE);
  for (let index = 0; index < value.length; index += 1) value[index] = (index * 31 + 17) % 251;
  return value;
}

export const FAKE_ARTIFACT_SHA256 = sha256Bytes(fakeArtifactBytes());

export function generationPath(scenarioRoot, generationId) {
  if (typeof generationId !== "string" || !/^gen-[a-z0-9-]{1,48}$/u.test(generationId)) {
    fail(REASONS.GENERATION_ID_INVALID);
  }
  const root = recipeRoot(scenarioRoot);
  return assertContained(resolve(root, generationId), root);
}

export function controlRoot(scenarioRoot) {
  return resolve(scenarioRoot, "control");
}

export function recipeRoot(scenarioRoot) {
  return resolve(scenarioRoot, "runtimes", RECIPE_ID);
}

export function activePath(scenarioRoot) {
  return resolve(controlRoot(scenarioRoot), "active.json");
}

export function candidatePath(scenarioRoot) {
  return resolve(controlRoot(scenarioRoot), "active.json.next");
}

function transactionPath(scenarioRoot, generationId) {
  return resolve(controlRoot(scenarioRoot), "transactions", `${generationId}.json`);
}

function hookPath(scenarioRoot, point) {
  if (!/^[a-z0-9-]+$/u.test(point)) fail(REASONS.PATH_ESCAPE);
  return resolve(controlRoot(scenarioRoot), "test-hooks", `${point}.json`);
}

export function scenarioPath(name) {
  if (!/^[a-z0-9-]+$/u.test(name)) fail(REASONS.PATH_ESCAPE);
  return assertContained(resolve(SCENARIOS_ROOT, name), SCENARIOS_ROOT);
}

export function initializeWorkRoot() {
  assertContained(WORK_ROOT, PROTOTYPE_ROOT);
  if (existsSync(WORK_ROOT)) {
    if (dirname(WORK_ROOT).toLowerCase() !== PROTOTYPE_ROOT.toLowerCase() || parse(WORK_ROOT).base !== "work") {
      fail(REASONS.PATH_ESCAPE);
    }
    assertWorkOwned();
    rmSync(WORK_ROOT, { recursive: true, force: false });
  }
  mkdirSync(WORK_ROOT);
  writeJsonDurable(resolve(WORK_ROOT, WORK_OWNER_FILE), {
    schema_version: 1,
    fixture_id: FIXTURE_ID,
    owned_root: WORK_ROOT
  });
  mkdirSync(SCENARIOS_ROOT, { recursive: true });
}

export function assertWorkOwned() {
  assertContained(WORK_ROOT, PROTOTYPE_ROOT);
  if (!existsSync(WORK_ROOT)) fail(REASONS.NOT_OWNED);
  assertNoLinks(WORK_ROOT);
  const owner = readJson(resolve(WORK_ROOT, WORK_OWNER_FILE), REASONS.NOT_OWNED);
  if (owner.fixture_id !== FIXTURE_ID || normalized(owner.owned_root).toLowerCase() !== normalized(WORK_ROOT).toLowerCase()) {
    fail(REASONS.OWNER_MISMATCH);
  }
}

export function initializeScenario(scenarioRoot) {
  assertContained(scenarioRoot, SCENARIOS_ROOT);
  mkdirSync(resolve(scenarioRoot, "control", "transactions"), { recursive: true });
  mkdirSync(resolve(scenarioRoot, "control", "test-hooks"), { recursive: true });
  mkdirSync(recipeRoot(scenarioRoot), { recursive: true });
  writeJsonDurable(resolve(scenarioRoot, SCENARIO_OWNER_FILE), {
    schema_version: 1,
    fixture_id: FIXTURE_ID,
    scenario_relative: relative(SCENARIOS_ROOT, scenarioRoot).replaceAll("\\", "/"),
    volume_root: parse(scenarioRoot).root
  });
  assertScenarioOwned(scenarioRoot);
}

export function assertScenarioOwned(scenarioRoot) {
  assertWorkOwned();
  assertContained(scenarioRoot, SCENARIOS_ROOT);
  assertNoLinks(scenarioRoot);
  const owner = readJson(resolve(scenarioRoot, SCENARIO_OWNER_FILE), REASONS.NOT_OWNED);
  const expectedRelative = relative(SCENARIOS_ROOT, scenarioRoot).replaceAll("\\", "/");
  if (
    owner.fixture_id !== FIXTURE_ID ||
    owner.scenario_relative !== expectedRelative ||
    String(owner.volume_root).toLowerCase() !== parse(scenarioRoot).root.toLowerCase()
  ) {
    fail(REASONS.OWNER_MISMATCH);
  }
}

function transactionDocument(scenarioRoot, generationId) {
  const generationRelative = relative(scenarioRoot, generationPath(scenarioRoot, generationId)).replaceAll("\\", "/");
  return {
    schema_version: 1,
    fixture_id: FIXTURE_ID,
    recipe_id: RECIPE_ID,
    generation_id: generationId,
    generation_relative: generationRelative,
    transaction_id: objectChecksum({ scenario: relative(SCENARIOS_ROOT, scenarioRoot), generation_id: generationId })
  };
}

function ensureTransaction(scenarioRoot, generationId) {
  const path = transactionPath(scenarioRoot, generationId);
  const expected = transactionDocument(scenarioRoot, generationId);
  if (!existsSync(path)) writeJsonDurable(path, expected);
  return requireTransaction(scenarioRoot, generationId);
}

function requireTransaction(scenarioRoot, generationId) {
  const path = transactionPath(scenarioRoot, generationId);
  const expected = transactionDocument(scenarioRoot, generationId);
  if (!existsSync(path)) fail(REASONS.TRANSACTION_MISMATCH);
  const actual = readJson(path, REASONS.TRANSACTION_MISMATCH);
  if (canonicalJson(actual) !== canonicalJson(expected)) fail(REASONS.TRANSACTION_MISMATCH);
  return { path, document: actual, sha256: sha256Bytes(readFileSync(path)) };
}

function ownerDocument(generationId, transactionHash) {
  return {
    schema_version: 1,
    fixture_id: FIXTURE_ID,
    recipe_id: RECIPE_ID,
    generation_id: generationId,
    transaction_sha256: transactionHash
  };
}

function validateOwner(scenarioRoot, generationId) {
  const root = generationPath(scenarioRoot, generationId);
  const ownerPath = resolve(root, OWNER_FILE);
  if (!existsSync(ownerPath)) fail(REASONS.NOT_OWNED);
  const transaction = requireTransaction(scenarioRoot, generationId);
  const owner = readJson(ownerPath, REASONS.NOT_OWNED);
  if (canonicalJson(owner) !== canonicalJson(ownerDocument(generationId, transaction.sha256))) {
    fail(REASONS.OWNER_MISMATCH);
  }
  assertNoLinks(root);
  return root;
}

export function writeCrashHookAndTerminate(scenarioRoot, point) {
  assertScenarioOwned(scenarioRoot);
  writeJsonDurable(hookPath(scenarioRoot, point), {
    schema_version: 1,
    fixture_id: FIXTURE_ID,
    point,
    reached: true
  });
  process.kill(process.pid, "SIGKILL");
  for (;;) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
}

function crashIf(scenarioRoot, selectedPoint, currentPoint) {
  if (selectedPoint === currentPoint) writeCrashHookAndTerminate(scenarioRoot, currentPoint);
}

export function crashHookReached(scenarioRoot, point) {
  const path = hookPath(scenarioRoot, point);
  if (!existsSync(path)) return false;
  const hook = readJson(path, REASONS.POINTER_INVALID);
  return hook.fixture_id === FIXTURE_ID && hook.point === point && hook.reached === true;
}

function buildingManifest(generationId) {
  return {
    schema_version: 1,
    fixture_id: FIXTURE_ID,
    recipe_id: RECIPE_ID,
    generation_id: generationId,
    state: "building",
    construction_method: "direct-final-path",
    artifact_relative: ARTIFACT_RELATIVE,
    artifacts: []
  };
}

function verifiedManifest(generationId, artifact) {
  return {
    schema_version: 1,
    fixture_id: FIXTURE_ID,
    recipe_id: RECIPE_ID,
    generation_id: generationId,
    state: "verified",
    construction_method: "direct-final-path",
    artifact_relative: ARTIFACT_RELATIVE,
    artifacts: [artifact]
  };
}

function completionDocument(generationId, manifestHash) {
  const payload = {
    schema_version: 1,
    fixture_id: FIXTURE_ID,
    recipe_id: RECIPE_ID,
    generation_id: generationId,
    manifest_sha256: manifestHash,
    verified_at: STATIC_TIME
  };
  return { ...payload, marker_sha256: objectChecksum(payload) };
}

export function validateGeneration(scenarioRoot, generationId) {
  assertScenarioOwned(scenarioRoot);
  const root = generationPath(scenarioRoot, generationId);
  if (!existsSync(root) || !lstatSync(root).isDirectory()) fail(REASONS.GENERATION_MISSING);
  validateOwner(scenarioRoot, generationId);

  const manifestPath = resolve(root, MANIFEST_FILE);
  if (!existsSync(manifestPath)) fail(REASONS.MANIFEST_INCOMPLETE);
  const manifest = readJson(manifestPath, REASONS.MANIFEST_INCOMPLETE);
  if (
    manifest.fixture_id !== FIXTURE_ID ||
    manifest.recipe_id !== RECIPE_ID ||
    manifest.generation_id !== generationId ||
    manifest.state !== "verified" ||
    manifest.construction_method !== "direct-final-path"
  ) {
    fail(REASONS.MANIFEST_INCOMPLETE);
  }
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length !== 1) fail(REASONS.MANIFEST_INCOMPLETE);
  const artifact = manifest.artifacts[0];
  if (artifact.relative_path !== ARTIFACT_RELATIVE || artifact.sha256 !== FAKE_ARTIFACT_SHA256 || artifact.size_bytes !== ARTIFACT_SIZE) {
    fail(REASONS.MANIFEST_HASH);
  }
  const artifactPath = assertContained(resolve(root, ...ARTIFACT_RELATIVE.split("/")), root);
  if (!existsSync(artifactPath) || statSync(artifactPath).size !== ARTIFACT_SIZE) fail(REASONS.MANIFEST_HASH);
  if (sha256Bytes(readFileSync(artifactPath)) !== artifact.sha256) fail(REASONS.MANIFEST_HASH);

  const manifestHash = sha256Bytes(readFileSync(manifestPath));
  const receiptPath = resolve(root, RECEIPT_FILE);
  if (!existsSync(receiptPath)) fail(REASONS.MANIFEST_INCOMPLETE);
  const receipt = readJson(receiptPath, REASONS.MANIFEST_INCOMPLETE);
  if (receipt.generation_id !== generationId || receipt.manifest_sha256 !== manifestHash || receipt.verified !== true) {
    fail(REASONS.MANIFEST_HASH);
  }

  const completionPath = resolve(root, COMPLETION_FILE);
  if (!existsSync(completionPath)) fail(REASONS.COMPLETION_MISSING);
  const completion = readJson(completionPath, REASONS.COMPLETION_CHECKSUM);
  assertExactKeys(completion, [
    "schema_version",
    "fixture_id",
    "recipe_id",
    "generation_id",
    "manifest_sha256",
    "verified_at",
    "marker_sha256"
  ], REASONS.COMPLETION_CHECKSUM);
  const { marker_sha256: markerHash, ...completionPayload } = completion;
  if (
    markerHash !== objectChecksum(completionPayload) ||
    completion.fixture_id !== FIXTURE_ID ||
    completion.recipe_id !== RECIPE_ID ||
    completion.generation_id !== generationId ||
    completion.manifest_sha256 !== manifestHash
  ) {
    fail(REASONS.COMPLETION_CHECKSUM);
  }
  return {
    generation_id: generationId,
    manifest_sha256: manifestHash,
    completion_sha256: sha256Bytes(readFileSync(completionPath)),
    artifact_sha256: artifact.sha256,
    generation_path: root
  };
}

function pointerPayload(ready) {
  return {
    schema_version: 1,
    recipe_id: RECIPE_ID,
    generation_id: ready.generation_id,
    manifest_sha256: ready.manifest_sha256,
    completion_sha256: ready.completion_sha256
  };
}

export function createPointerDocument(ready) {
  const payload = pointerPayload(ready);
  return { ...payload, pointer_sha256: objectChecksum(payload) };
}

export function validatePointerDocument(scenarioRoot, pointer) {
  assertExactKeys(pointer, [
    "schema_version",
    "recipe_id",
    "generation_id",
    "manifest_sha256",
    "completion_sha256",
    "pointer_sha256"
  ], REASONS.POINTER_INVALID);
  const { pointer_sha256: pointerHash, ...payload } = pointer;
  if (pointerHash !== objectChecksum(payload)) fail(REASONS.POINTER_CHECKSUM);
  if (pointer.schema_version !== 1 || pointer.recipe_id !== RECIPE_ID) fail(REASONS.POINTER_INVALID);
  const ready = validateGeneration(scenarioRoot, pointer.generation_id);
  if (
    pointer.manifest_sha256 !== ready.manifest_sha256 ||
    pointer.completion_sha256 !== ready.completion_sha256
  ) {
    fail(REASONS.POINTER_INVALID);
  }
  return ready;
}

export function readAndValidatePointerFile(scenarioRoot, path) {
  const bytes = readFileSync(path);
  if (bytes.length >= POINTER_LIMIT_BYTES) fail(REASONS.POINTER_TOO_LARGE);
  const pointer = readJson(path, REASONS.POINTER_INVALID);
  const ready = validatePointerDocument(scenarioRoot, pointer);
  return { pointer, ready, bytes, sha256: sha256Bytes(bytes) };
}

export function resolveActive(scenarioRoot) {
  assertScenarioOwned(scenarioRoot);
  const path = activePath(scenarioRoot);
  if (!existsSync(path)) fail(REASONS.ACTIVE_MISSING);
  return readAndValidatePointerFile(scenarioRoot, path);
}

function activeReferencesGeneration(scenarioRoot, generationId) {
  if (!existsSync(activePath(scenarioRoot))) return false;
  return resolveActive(scenarioRoot).ready.generation_id === generationId;
}

function collectOwnedEntries(root) {
  const files = [];
  const directories = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const path = resolve(directory, entry.name);
      assertContained(path, root);
      const metadata = lstatSync(path);
      if (metadata.isSymbolicLink()) fail(REASONS.REPARSE_REJECTED);
      if (metadata.isDirectory()) {
        visit(path);
        directories.push(path);
      } else if (entry.name !== OWNER_FILE) {
        files.push(path);
      }
    }
  };
  visit(root);
  return { files, directories };
}

export function cleanupGeneration(scenarioRoot, generationId, crashPoint = null) {
  assertScenarioOwned(scenarioRoot);
  const root = generationPath(scenarioRoot, generationId);
  if (!existsSync(root)) return { already_absent: true };
  if (activeReferencesGeneration(scenarioRoot, generationId)) fail(REASONS.ACTIVE_DELETE_DENIED);
  assertContained(root, recipeRoot(scenarioRoot));
  assertNoLinks(root);

  const ownerPath = resolve(root, OWNER_FILE);
  if (!existsSync(ownerPath)) {
    const transaction = requireTransaction(scenarioRoot, generationId);
    const entries = readdirSync(root);
    if (entries.length !== 0 || transaction.document.generation_id !== generationId) fail(REASONS.NOT_OWNED);
    rmdirSync(root);
    return { transaction_only_empty: true };
  }
  validateOwner(scenarioRoot, generationId);
  const { files, directories } = collectOwnedEntries(root);
  let removed = 0;
  for (const file of files) {
    rmSync(file, { force: false });
    removed += 1;
    if (crashPoint === "during-retry-cleanup" && removed === 1) {
      writeCrashHookAndTerminate(scenarioRoot, crashPoint);
    }
  }
  for (const directory of directories) rmdirSync(directory);
  rmSync(ownerPath, { force: false });
  rmdirSync(root);
  return { removed_files: removed };
}

function prepareGenerationDirectory(scenarioRoot, generationId, selectedCrashPoint) {
  const transaction = ensureTransaction(scenarioRoot, generationId);
  const root = generationPath(scenarioRoot, generationId);
  crashIf(scenarioRoot, selectedCrashPoint, "before-generation-create");
  mkdirSync(root);
  crashIf(scenarioRoot, selectedCrashPoint, "after-directory-create");
  writeJsonDurable(resolve(root, OWNER_FILE), ownerDocument(generationId, transaction.sha256));
  writeJsonDurable(resolve(root, MANIFEST_FILE), buildingManifest(generationId));
  return root;
}

function materializeNewGeneration(scenarioRoot, generationId, selectedCrashPoint) {
  const root = prepareGenerationDirectory(scenarioRoot, generationId, selectedCrashPoint);
  const bytes = fakeArtifactBytes();
  const artifactPath = resolve(root, ...ARTIFACT_RELATIVE.split("/"));
  mkdirSync(dirname(artifactPath), { recursive: true });
  const handle = openSync(artifactPath, "w");
  writeSync(handle, bytes, 0, bytes.length / 2, 0);
  crashIf(scenarioRoot, selectedCrashPoint, "mid-file");
  writeSync(handle, bytes, bytes.length / 2, bytes.length / 2, bytes.length / 2);
  crashIf(scenarioRoot, selectedCrashPoint, "after-bytes-before-fsync-verification");
  fsyncSync(handle);
  closeSync(handle);

  const artifact = {
    relative_path: ARTIFACT_RELATIVE,
    size_bytes: ARTIFACT_SIZE,
    sha256: sha256Bytes(readFileSync(artifactPath))
  };
  const manifestPath = resolve(root, MANIFEST_FILE);
  writeJsonDurable(manifestPath, verifiedManifest(generationId, artifact));
  const manifestHash = sha256Bytes(readFileSync(manifestPath));
  writeJsonDurable(resolve(root, RECEIPT_FILE), {
    schema_version: 1,
    fixture_id: FIXTURE_ID,
    generation_id: generationId,
    manifest_sha256: manifestHash,
    verified: true,
    verified_at: STATIC_TIME
  });
  crashIf(scenarioRoot, selectedCrashPoint, "before-completion-marker");
  writeJsonDurable(resolve(root, COMPLETION_FILE), completionDocument(generationId, manifestHash));
  crashIf(scenarioRoot, selectedCrashPoint, "after-completion-marker");
  return validateGeneration(scenarioRoot, generationId);
}

export function materializeGeneration(scenarioRoot, generationId, selectedCrashPoint = null) {
  assertScenarioOwned(scenarioRoot);
  try {
    return { ready: validateGeneration(scenarioRoot, generationId), reused: true };
  } catch (error) {
    if (!(error instanceof ProtocolError) || error.code === REASONS.OWNER_MISMATCH || error.code === REASONS.REPARSE_REJECTED) throw error;
  }

  const root = generationPath(scenarioRoot, generationId);
  if (existsSync(root)) cleanupGeneration(scenarioRoot, generationId, selectedCrashPoint);
  return { ready: materializeNewGeneration(scenarioRoot, generationId, selectedCrashPoint), reused: false };
}

export function activateGeneration(scenarioRoot, ready, selectedCrashPoint = null) {
  assertScenarioOwned(scenarioRoot);
  const currentReady = validateGeneration(scenarioRoot, ready.generation_id);
  const pointer = createPointerDocument(currentReady);
  const json = stableJson(pointer);
  if (Buffer.byteLength(json, "utf8") >= POINTER_LIMIT_BYTES) fail(REASONS.POINTER_TOO_LARGE);

  crashIf(scenarioRoot, selectedCrashPoint, "before-pointer-temp-write");
  const temporary = candidatePath(scenarioRoot);
  const active = activePath(scenarioRoot);
  if (dirname(temporary).toLowerCase() !== dirname(active).toLowerCase() || parse(temporary).root.toLowerCase() !== parse(active).root.toLowerCase()) {
    fail(REASONS.PATH_ESCAPE);
  }
  writeDurable(temporary, json);
  crashIf(scenarioRoot, selectedCrashPoint, "after-pointer-temp-write");
  readAndValidatePointerFile(scenarioRoot, temporary);
  crashIf(scenarioRoot, selectedCrashPoint, "before-atomic-replace");
  renameSync(temporary, active);
  crashIf(scenarioRoot, selectedCrashPoint, "immediately-after-replace");
  return resolveActive(scenarioRoot);
}

export function materializeAndActivate(scenarioRoot, generationId, selectedCrashPoint = null) {
  const materialized = materializeGeneration(scenarioRoot, generationId, selectedCrashPoint);
  if (existsSync(activePath(scenarioRoot))) {
    try {
      const current = resolveActive(scenarioRoot);
      if (
        current.ready.generation_id === materialized.ready.generation_id &&
        current.ready.manifest_sha256 === materialized.ready.manifest_sha256 &&
        current.ready.completion_sha256 === materialized.ready.completion_sha256
      ) {
        return { active: current, reused: true };
      }
    } catch {
      // A corrupt active pointer is never repaired by selecting the newest directory.
      throw new ProtocolError(REASONS.POINTER_INVALID);
    }
  }
  return { active: activateGeneration(scenarioRoot, materialized.ready, selectedCrashPoint), reused: materialized.reused };
}

export function prepareParentChildGeneration(scenarioRoot, generationId) {
  assertScenarioOwned(scenarioRoot);
  const root = generationPath(scenarioRoot, generationId);
  if (existsSync(root)) cleanupGeneration(scenarioRoot, generationId);
  const prepared = prepareGenerationDirectory(scenarioRoot, generationId, null);
  return {
    generation_path: prepared,
    artifact_path: resolve(prepared, ...ARTIFACT_RELATIVE.split("/"))
  };
}

export function validateOwnedIncompleteGeneration(scenarioRoot, generationId) {
  assertScenarioOwned(scenarioRoot);
  const root = generationPath(scenarioRoot, generationId);
  if (!existsSync(root)) fail(REASONS.GENERATION_MISSING);
  validateOwner(scenarioRoot, generationId);
  const manifest = readJson(resolve(root, MANIFEST_FILE), REASONS.MANIFEST_INCOMPLETE);
  if (manifest.generation_id !== generationId || manifest.state !== "building") {
    fail(REASONS.MANIFEST_INCOMPLETE);
  }
  return {
    generation_path: root,
    artifact_path: resolve(root, ...ARTIFACT_RELATIVE.split("/"))
  };
}

export function childHookPath(scenarioRoot) {
  return hookPath(scenarioRoot, "child-active");
}

export function writeChildActiveHook(scenarioRoot, parentPid) {
  writeJsonDurable(childHookPath(scenarioRoot), {
    schema_version: 1,
    fixture_id: FIXTURE_ID,
    point: "child-active",
    parent_pid: parentPid,
    child_pid: process.pid
  });
}
