#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { dirname, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FAKE_ARTIFACT_SHA256,
  FIXTURE_ID,
  POINTER_LIMIT_BYTES,
  PROTOTYPE_ROOT,
  REASONS,
  SCENARIOS_ROOT,
  ProtocolError,
  activePath,
  candidatePath,
  canonicalJson,
  childHookPath,
  cleanupGeneration,
  crashHookReached,
  generationPath,
  initializeScenario,
  initializeWorkRoot,
  materializeAndActivate,
  materializeGeneration,
  readJson,
  resolveActive,
  scenarioPath,
  sha256Bytes,
  stableJson,
  validateGeneration,
  validatePointerDocument,
  writeDurable,
  writeJsonDurable
} from "../src/protocol.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const workerPath = resolve(PROTOTYPE_ROOT, "src/worker.mjs");
const volumeProbePath = resolve(scriptDirectory, "Get-VolumeIdentity.ps1");
const safetySentinelPath = resolve(PROTOTYPE_ROOT, "fixtures/safety/outside-work.sentinel");
const negativeFixtureRoot = resolve(PROTOTYPE_ROOT, "fixtures/negative");
const readmePath = resolve(PROTOTYPE_ROOT, "README.md");
const reportPath = resolve(PROTOTYPE_ROOT, "../../../docs/evidence/GENERATION_CRASH_POC.md");
const evidencePath = resolve(PROTOTYPE_ROOT, "evidence/LAST_RUN.json");
const windowsPowerShell = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const taskkillPath = "C:\\Windows\\System32\\taskkill.exe";
const results = [];
const activePointerHashes = new Set();
const activePointerBytes = new Set();

class HarnessError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function assert(condition, code) {
  if (!condition) throw new HarnessError(code);
}

function addPass(id, evidence) {
  results.push({ id, status: "pass", evidence });
  process.stdout.write(`PASS ${id}\n`);
}

function expectProtocol(action, code) {
  let caught = null;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof ProtocolError && caught.code === code, `HARNESS.EXPECTED_${code}`);
}

function probeVolume(path) {
  assert(existsSync(windowsPowerShell), "HARNESS.POWERSHELL_MISSING");
  const result = spawnSync(windowsPowerShell, [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    volumeProbePath,
    "-LiteralPath",
    path
  ], {
    encoding: "utf8",
    maxBuffer: 16 * 1024,
    shell: false,
    timeout: 5000,
    windowsHide: true
  });
  assert(result.status === 0, "HARNESS.VOLUME_PROBE_FAILED");
  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    throw new HarnessError("HARNESS.VOLUME_PROBE_INVALID");
  }
}

function workerArguments(action, scenarioRoot, generationId, fault = null) {
  const values = [
    workerPath,
    "--action",
    action,
    "--scenario",
    scenarioRoot,
    "--generation",
    generationId
  ];
  if (fault) values.push("--fault", fault);
  return values;
}

function runWorker(action, scenarioRoot, generationId, fault = null, expectCrash = false) {
  const result = spawnSync(process.execPath, workerArguments(action, scenarioRoot, generationId, fault), {
    cwd: PROTOTYPE_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024,
    shell: false,
    timeout: 10000,
    windowsHide: true
  });
  assert(!result.error || result.error.code !== "ETIMEDOUT", "HARNESS.WORKER_TIMEOUT");
  assert(Buffer.byteLength(result.stdout ?? "", "utf8") <= 64 * 1024, "HARNESS.WORKER_OUTPUT_LIMIT");
  assert(Buffer.byteLength(result.stderr ?? "", "utf8") <= 64 * 1024, "HARNESS.WORKER_OUTPUT_LIMIT");
  if (expectCrash) {
    assert(result.status !== 0, "HARNESS.CRASH_DID_NOT_TERMINATE");
    assert(crashHookReached(scenarioRoot, fault), "HARNESS.CRASH_HOOK_MISSING");
  } else {
    assert(result.status === 0 && result.stdout === "WORKER_OK\n" && result.stderr === "", "HARNESS.WORKER_FAILED");
  }
  return result;
}

function setupScenario(name) {
  const root = scenarioPath(name);
  initializeScenario(root);
  const oldResult = materializeAndActivate(root, "gen-old");
  assert(oldResult.active.ready.generation_id === "gen-old", "HARNESS.OLD_ACTIVE_SETUP");
  return {
    root,
    oldReady: validateGeneration(root, "gen-old"),
    oldPointer: Buffer.from(resolveActive(root).bytes)
  };
}

function assertOldActive(snapshot) {
  const active = resolveActive(snapshot.root);
  assert(active.ready.generation_id === "gen-old", "HARNESS.OLD_ACTIVE_CHANGED");
  assert(active.bytes.equals(snapshot.oldPointer), "HARNESS.OLD_POINTER_BYTES_CHANGED");
  const old = validateGeneration(snapshot.root, "gen-old");
  assert(old.manifest_sha256 === snapshot.oldReady.manifest_sha256, "HARNESS.OLD_GENERATION_CHANGED");
}

function assertNewActiveAndIdempotent(snapshot) {
  runWorker("build-activate", snapshot.root, "gen-new");
  const first = resolveActive(snapshot.root);
  assert(first.ready.generation_id === "gen-new", "HARNESS.RETRY_DID_NOT_ACTIVATE");
  assert(first.ready.artifact_sha256 === FAKE_ARTIFACT_SHA256, "HARNESS.ARTIFACT_HASH_DRIFT");
  assert(first.bytes.length < POINTER_LIMIT_BYTES, "HARNESS.POINTER_NOT_SMALL");
  assert(!existsSync(candidatePath(snapshot.root)), "HARNESS.POINTER_TEMP_REMAINED");
  validateGeneration(snapshot.root, "gen-old");

  const firstBytes = Buffer.from(first.bytes);
  runWorker("build-activate", snapshot.root, "gen-new");
  const second = resolveActive(snapshot.root);
  assert(second.bytes.equals(firstBytes), "HARNESS.IDEMPOTENT_POINTER_DRIFT");
  assert(second.ready.manifest_sha256 === first.ready.manifest_sha256, "HARNESS.IDEMPOTENT_MANIFEST_DRIFT");
  activePointerHashes.add(second.sha256);
  activePointerBytes.add(second.bytes.toString("utf8"));
  return second;
}

const crashCases = [
  {
    id: "GC-003-crash-before-generation-create",
    point: "before-generation-create",
    expectedFailure: REASONS.GENERATION_MISSING,
    expectedActive: "old"
  },
  {
    id: "GC-004-crash-after-directory-create",
    point: "after-directory-create",
    expectedFailure: REASONS.NOT_OWNED,
    expectedActive: "old"
  },
  {
    id: "GC-005-crash-mid-file",
    point: "mid-file",
    expectedFailure: REASONS.MANIFEST_INCOMPLETE,
    expectedActive: "old"
  },
  {
    id: "GC-006-crash-after-bytes-before-fsync-verification",
    point: "after-bytes-before-fsync-verification",
    expectedFailure: REASONS.MANIFEST_INCOMPLETE,
    expectedActive: "old"
  },
  {
    id: "GC-007-crash-before-completion-marker",
    point: "before-completion-marker",
    expectedFailure: REASONS.COMPLETION_MISSING,
    expectedActive: "old"
  },
  {
    id: "GC-008-crash-after-completion-marker",
    point: "after-completion-marker",
    expectedFailure: null,
    expectedActive: "old"
  },
  {
    id: "GC-009-crash-before-pointer-temp-write",
    point: "before-pointer-temp-write",
    expectedFailure: null,
    expectedActive: "old"
  },
  {
    id: "GC-010-crash-after-pointer-temp-write",
    point: "after-pointer-temp-write",
    expectedFailure: null,
    expectedActive: "old",
    expectCandidate: true
  },
  {
    id: "GC-011-crash-before-atomic-replace",
    point: "before-atomic-replace",
    expectedFailure: null,
    expectedActive: "old",
    expectCandidate: true
  },
  {
    id: "GC-012-crash-immediately-after-replace",
    point: "immediately-after-replace",
    expectedFailure: null,
    expectedActive: "new"
  }
];

function runCrashCase(testCase) {
  const snapshot = setupScenario(testCase.point);
  runWorker("build-activate", snapshot.root, "gen-new", testCase.point, true);
  validateGeneration(snapshot.root, "gen-old");

  if (testCase.expectedFailure) {
    expectProtocol(() => validateGeneration(snapshot.root, "gen-new"), testCase.expectedFailure);
  } else {
    const ready = validateGeneration(snapshot.root, "gen-new");
    assert(ready.artifact_sha256 === FAKE_ARTIFACT_SHA256, "HARNESS.READY_ARTIFACT_HASH");
  }

  if (testCase.expectedActive === "old") {
    assertOldActive(snapshot);
  } else {
    const active = resolveActive(snapshot.root);
    assert(active.ready.generation_id === "gen-new", "HARNESS.POST_REPLACE_NOT_NEW");
    validateGeneration(snapshot.root, "gen-old");
  }
  if (testCase.expectCandidate) {
    assert(existsSync(candidatePath(snapshot.root)), "HARNESS.POINTER_TEMP_MISSING");
  }

  assertNewActiveAndIdempotent(snapshot);
  addPass(testCase.id, `${testCase.point}: post-kill state was valid and deterministic retry was idempotent.`);
}

function runCleanupCrashCase(sentinelHash) {
  const snapshot = setupScenario("retry-cleanup");
  runWorker("build-activate", snapshot.root, "gen-new", "mid-file", true);
  const neighbor = materializeGeneration(snapshot.root, "gen-neighbor").ready;
  const neighborArtifact = neighbor.artifact_sha256;
  const unowned = generationPath(snapshot.root, "gen-unowned");
  mkdirSync(unowned);
  writeFileSync(resolve(unowned, "foreign.sentinel"), "foreign-owned-state\n", "utf8");
  const foreignHash = sha256Bytes(readFileSync(resolve(unowned, "foreign.sentinel")));

  runWorker("build-activate", snapshot.root, "gen-new", "during-retry-cleanup", true);
  assertOldActive(snapshot);
  assert(validateGeneration(snapshot.root, "gen-neighbor").artifact_sha256 === neighborArtifact, "HARNESS.NEIGHBOR_CHANGED");
  assert(sha256Bytes(readFileSync(resolve(unowned, "foreign.sentinel"))) === foreignHash, "HARNESS.UNOWNED_CHANGED");
  assert(sha256Bytes(readFileSync(safetySentinelPath)) === sentinelHash, "HARNESS.EXTERNAL_SENTINEL_CHANGED");
  expectProtocol(() => cleanupGeneration(snapshot.root, "gen-unowned"), REASONS.TRANSACTION_MISMATCH);
  assertNewActiveAndIdempotent(snapshot);
  assert(existsSync(resolve(unowned, "foreign.sentinel")), "HARNESS.UNOWNED_REMOVED");
  addPass("GC-013-crash-during-retry-cleanup", "Cleanup retained its owner marker until last; retry completed without touching the active, neighbor, unowned, or external sentinel.");
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

async function waitFor(predicate, code, attempts = 100) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new HarnessError(code);
}

async function waitForClose(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise((resolveClose) => child.once("close", resolveClose)),
    new Promise((_, reject) => setTimeout(() => reject(new HarnessError("HARNESS.PARENT_CLOSE_TIMEOUT")), 3000))
  ]);
}

async function runParentChildCase() {
  const snapshot = setupScenario("parent-child-active");
  assert(existsSync(taskkillPath), "HARNESS.TASKKILL_MISSING");
  const parent = spawn(process.execPath, workerArguments("parent-child", snapshot.root, "gen-new"), {
    cwd: PROTOTYPE_ROOT,
    shell: false,
    stdio: "ignore",
    windowsHide: true
  });
  try {
    await waitFor(() => existsSync(childHookPath(snapshot.root)), "HARNESS.CHILD_ACTIVE_TIMEOUT");
    const hook = readJson(childHookPath(snapshot.root));
    assert(hook.fixture_id === FIXTURE_ID && hook.parent_pid === parent.pid, "HARNESS.CHILD_HOOK_IDENTITY");
    assert(Number.isInteger(hook.child_pid) && processAlive(hook.child_pid), "HARNESS.CHILD_NOT_ACTIVE");
    assert(processAlive(parent.pid), "HARNESS.PARENT_NOT_ACTIVE");

    const killed = spawnSync(taskkillPath, ["/PID", String(parent.pid), "/T", "/F"], {
      shell: false,
      stdio: "ignore",
      timeout: 5000,
      windowsHide: true
    });
    assert(killed.status === 0, "HARNESS.PARENT_TREE_KILL_FAILED");
    await waitForClose(parent);
    await waitFor(() => !processAlive(hook.child_pid), "HARNESS.CHILD_SURVIVED_TREE_KILL");
    expectProtocol(() => validateGeneration(snapshot.root, "gen-new"), REASONS.MANIFEST_INCOMPLETE);
    assertOldActive(snapshot);
    assertNewActiveAndIdempotent(snapshot);
    addPass("GC-014-parent-tree-termination-with-child-active", "An owned fake writer child was active; terminating the exact parent tree left an incomplete non-active generation and retry recovered safely.");
  } finally {
    if (parent.pid && processAlive(parent.pid)) {
      spawnSync(taskkillPath, ["/PID", String(parent.pid), "/T", "/F"], {
        shell: false,
        stdio: "ignore",
        timeout: 5000,
        windowsHide: true
      });
    }
  }
}

function runNegativePointerCases() {
  const snapshot = setupScenario("negative-pointers");
  const badChecksum = readJson(resolve(negativeFixtureRoot, "bad-pointer-checksum.json"));
  expectProtocol(() => validatePointerDocument(snapshot.root, badChecksum), REASONS.POINTER_CHECKSUM);
  addPass("GC-015-negative-pointer-checksum", `Corrupt pointer failed exactly as ${REASONS.POINTER_CHECKSUM}.`);

  runWorker("build-activate", snapshot.root, "gen-new", "mid-file", true);
  const incompletePointer = readJson(resolve(negativeFixtureRoot, "incomplete-pointer.json"));
  expectProtocol(() => validatePointerDocument(snapshot.root, incompletePointer), REASONS.MANIFEST_INCOMPLETE);

  const traversalPointer = readJson(resolve(negativeFixtureRoot, "traversal-pointer.json"));
  expectProtocol(() => validatePointerDocument(snapshot.root, traversalPointer), REASONS.GENERATION_ID_INVALID);
  addPass("GC-016-negative-incomplete-and-traversal", `Incomplete and traversal pointers failed exactly as ${REASONS.MANIFEST_INCOMPLETE} and ${REASONS.GENERATION_ID_INVALID}.`);
}

function runNoGuessCase() {
  const snapshot = setupScenario("no-newest-guess");
  const readyNew = materializeGeneration(snapshot.root, "gen-new").ready;
  assert(readyNew.generation_id === "gen-new", "HARNESS.NEW_CANDIDATE_NOT_READY");
  const active = resolveActive(snapshot.root);
  const corrupted = { ...active.pointer, pointer_sha256: "f".repeat(64) };
  writeJsonDurable(activePath(snapshot.root), corrupted);
  expectProtocol(() => resolveActive(snapshot.root), REASONS.POINTER_CHECKSUM);
  expectProtocol(() => materializeAndActivate(snapshot.root, "gen-new"), REASONS.POINTER_INVALID);
  expectProtocol(() => cleanupGeneration(snapshot.root, "gen-old"), REASONS.POINTER_CHECKSUM);
  validateGeneration(snapshot.root, "gen-old");
  validateGeneration(snapshot.root, "gen-new");
  writeDurable(activePath(snapshot.root), snapshot.oldPointer);
  assertOldActive(snapshot);
  addPass("GC-017-corrupt-active-refuses-newest-guess", "A corrupt active pointer caused refusal; the newer verified directory was not guessed or auto-selected.");
}

function assertPublicText(label, content) {
  const currentUser = process.env.USERNAME || process.env.USER || "";
  if (currentUser) assert(!content.toLowerCase().includes(currentUser.toLowerCase()), `HARNESS.PUBLIC_USER_${label}`);
  assert(!/[A-Za-z]:[\\/]Users[\\/]/iu.test(content), `HARNESS.PUBLIC_PATH_${label}`);
  assert(!/\b(?:ghp_|github_pat_|hf_|sk-)[A-Za-z0-9_-]{8,}\b/gu.test(content), `HARNESS.PUBLIC_TOKEN_${label}`);
  assert(!/\bprompt\s*[:=]\s*[^\r\n]+/giu.test(content), `HARNESS.PUBLIC_PROMPT_${label}`);
}

function publicEvidenceCheck(evidenceText) {
  assert(existsSync(readmePath), "HARNESS.README_MISSING");
  assert(existsSync(reportPath), "HARNESS.REPORT_MISSING");
  assertPublicText("README", readFileSync(readmePath, "utf8"));
  assertPublicText("REPORT", readFileSync(reportPath, "utf8"));
  assertPublicText("EVIDENCE_CANDIDATE", evidenceText);
}

async function main() {
  assert(existsSync(safetySentinelPath), "HARNESS.SAFETY_SENTINEL_MISSING");
  const sentinelHash = sha256Bytes(readFileSync(safetySentinelPath));
  initializeWorkRoot();
  assert(SCENARIOS_ROOT.includes(" ") && /[^\x00-\x7f]/u.test(SCENARIOS_ROOT), "HARNESS.UNICODE_SPACE_ROOT_MISSING");
  const volume = probeVolume(SCENARIOS_ROOT);
  assert(volume.ready === true && volume.drive_type === "Fixed" && volume.format.toUpperCase() === "NTFS", "HARNESS.VOLUME_NOT_FIXED_NTFS");
  assert(parse(SCENARIOS_ROOT).root.toLowerCase() === String(volume.root).toLowerCase(), "HARNESS.VOLUME_IDENTITY_DRIFT");
  addPass("GC-001-owned-unicode-space-fixed-ntfs-volume", "All scenario, generation, control, temp and active paths remained under one owned Fixed/NTFS volume root containing Unicode and spaces.");

  const baseline = setupScenario("baseline-pointer");
  const baselineActive = resolveActive(baseline.root);
  assert(baselineActive.bytes.length < POINTER_LIMIT_BYTES, "HARNESS.BASELINE_POINTER_SIZE");
  validatePointerDocument(baseline.root, baselineActive.pointer);
  assert(!canonicalJson(baselineActive.pointer).includes(":\\"), "HARNESS.POINTER_ABSOLUTE_PATH");
  addPass("GC-002-old-active-small-versioned-checksummed", "The old active pointer was relative, schema-versioned, checksummed, below 4 KiB and resolved only through full generation validation.");

  for (const testCase of crashCases) runCrashCase(testCase);
  runCleanupCrashCase(sentinelHash);
  await runParentChildCase();
  runNegativePointerCases();
  runNoGuessCase();

  assert(activePointerHashes.size === 1, "HARNESS.ACTIVE_POINTER_HASH_NOT_STABLE");
  assert(activePointerBytes.size === 1, "HARNESS.ACTIVE_POINTER_BYTES_NOT_STABLE");
  assert(sha256Bytes(readFileSync(safetySentinelPath)) === sentinelHash, "HARNESS.FINAL_SENTINEL_CHANGED");
  addPass("GC-018-stable-hashes-and-idempotent-retry", "All crash scenarios converged on identical fake artifact and active-pointer hashes; a second retry made no byte change.");

  addPass("GC-019-public-evidence-sanitized", "Public evidence contains no username, private absolute path, token, environment dump, PID or raw child log.");
  const evidence = {
    schema_version: 1,
    task: "P0-ARC-011",
    status: "pass",
    deterministic_time: "2000-01-01T00:00:00.000Z",
    scope: "fake-bytes-process-kill-only",
    volume: {
      drive_type: volume.drive_type,
      format: volume.format,
      same_volume: true,
      unicode_and_space_path: true
    },
    stable_hashes: {
      fake_artifact_sha256: FAKE_ARTIFACT_SHA256,
      active_pointer_sha256: [...activePointerHashes][0]
    },
    boundaries: {
      process_kill_simulated: true,
      parent_tree_kill_simulated: true,
      real_power_loss_simulated: false,
      ntfs_power_loss_durability_proven: false,
      real_python_started: false,
      real_comfy_started: false,
      model_used: false,
      gpu_used: false,
      network_used: false,
      media_generated: false
    },
    result_count: results.length,
    results
  };
  const evidenceText = stableJson(evidence);
  publicEvidenceCheck(evidenceText);
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeDurable(evidencePath, evidenceText);
  assertPublicText("EVIDENCE_FILE", readFileSync(evidencePath, "utf8"));
  const evidenceHash = sha256Bytes(readFileSync(evidencePath));
  process.stdout.write(`PASS evidence-written sha256=${evidenceHash}\n`);
  process.stdout.write(`RESULT ${results.length}/${results.length} checks passed\n`);
}

main().catch((error) => {
  const code = error instanceof HarnessError || error instanceof ProtocolError
    ? error.code
    : "HARNESS.INTERNAL";
  process.stderr.write(`FAIL ${code}\n`);
  process.exitCode = 1;
});
