import { open, lstat, mkdir, readFile, readdir, rename } from "node:fs/promises";
import path from "node:path";

import { runtimeFail } from "./errors.mjs";
import { deepFreeze, normalizeWindowsAbsolutePath, sha256Json, stableJson } from "./util.mjs";

const ID = /^[a-z0-9][a-z0-9-]{0,95}$/u;

async function requirePlainDirectory(directory, stage) {
  let stats;
  try {
    stats = await lstat(directory);
  } catch {
    runtimeFail("LOCAL_RUNTIME.MANAGED_ROOT_NOT_PREPARED", stage, "local_runtime.transaction.root_prepared");
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    runtimeFail("LOCAL_RUNTIME.REPARSE_OR_NON_DIRECTORY", stage, "local_runtime.transaction.no_reparse");
  }
}

async function ensureStateDirectory(managedRoot) {
  await requirePlainDirectory(managedRoot, "transaction");
  const stateRoot = path.join(managedRoot, ".minimax-h3");
  try {
    await mkdir(stateRoot);
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "EEXIST") throw error;
  }
  await requirePlainDirectory(stateRoot, "transaction");
  const transactions = path.join(stateRoot, "transactions");
  try {
    await mkdir(transactions);
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "EEXIST") throw error;
  }
  await requirePlainDirectory(transactions, "transaction");
  return transactions;
}

async function atomicWrite(filePath, value) {
  const temporary = `${filePath}.${process.pid}.new`;
  const bytes = Buffer.from(`${stableJson(value)}\n`, "utf8");
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, filePath);
}

async function readLatestJournal(transactions, transactionId) {
  const escaped = transactionId.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pattern = new RegExp(`^${escaped}\\.r([1-9][0-9]*)\\.json$`, "u");
  const revisions = (await readdir(transactions))
    .map((name) => ({ name, match: pattern.exec(name) }))
    .filter((item) => item.match && Number.isSafeInteger(Number(item.match[1])))
    .map((item) => ({ name: item.name, revision: Number(item.match[1]) }))
    .sort((left, right) => right.revision - left.revision);
  if (!revisions.length) return null;
  const text = await readFile(path.join(transactions, revisions[0].name), "utf8");
  const journal = JSON.parse(text);
  if (journal.revision !== revisions[0].revision || journal.transaction_id !== transactionId) {
    runtimeFail("LOCAL_RUNTIME.TRANSACTION_CORRUPT", "transaction", "local_runtime.transaction.revision_binding");
  }
  return journal;
}

function transactionIdFor(plan) {
  return `tx-${sha256Json(plan).slice("sha256:".length, "sha256:".length + 32)}`;
}

function journalCore(plan, transactionId) {
  const actions = Array.isArray(plan?.component_install_plan?.actions) ? plan.component_install_plan.actions : [];
  return {
    journal_version: "1.0.0",
    transaction_id: transactionId,
    plan_digest: plan.plan_digest ?? sha256Json(plan),
    authority: {
      network: "none",
      model_download: "none",
      model_mutation: "none_external_read_only",
      comfy_launch: "none",
      queue_submission: "none"
    },
    status: "planned",
    revision: 1,
    actions: actions.map((action) => ({
      action_id: action.action_id,
      kind: action.kind,
      state: "pending",
      attempt: 0,
      evidence_digest: null
    }))
  };
}

export async function initializeInstallTransaction({ managed_root: managedRootInput, plan }) {
  const managedRoot = normalizeWindowsAbsolutePath(managedRootInput, "transaction");
  const transactions = await ensureStateDirectory(managedRoot);
  const transactionId = transactionIdFor(plan);
  if (!ID.test(transactionId)) runtimeFail("LOCAL_RUNTIME.INVALID_TRANSACTION_ID", "transaction", "local_runtime.transaction.id");
  try {
    const existing = await readLatestJournal(transactions, transactionId);
    if (!existing) throw Object.assign(new Error("not found"), { code: "ENOENT" });
    const expectedDigest = plan.plan_digest ?? sha256Json(plan);
    if (existing.plan_digest !== expectedDigest) {
      runtimeFail("LOCAL_RUNTIME.TRANSACTION_PLAN_CONFLICT", "transaction", "local_runtime.transaction.plan_exact");
    }
    return deepFreeze(existing);
  } catch (error) {
    if (error instanceof SyntaxError) runtimeFail("LOCAL_RUNTIME.TRANSACTION_CORRUPT", "transaction", "local_runtime.transaction.valid_json");
    if (error && typeof error === "object" && error.code !== "ENOENT") throw error;
  }
  const journal = journalCore(plan, transactionId);
  await atomicWrite(path.join(transactions, `${transactionId}.r1.json`), journal);
  return deepFreeze(journal);
}

export async function readInstallTransaction({ managed_root: managedRootInput, transaction_id: transactionId }) {
  const managedRoot = normalizeWindowsAbsolutePath(managedRootInput, "transaction");
  if (typeof transactionId !== "string" || !ID.test(transactionId)) {
    runtimeFail("LOCAL_RUNTIME.INVALID_TRANSACTION_ID", "transaction", "local_runtime.transaction.id");
  }
  const transactions = await ensureStateDirectory(managedRoot);
  try {
    const journal = await readLatestJournal(transactions, transactionId);
    if (!journal) runtimeFail("LOCAL_RUNTIME.TRANSACTION_NOT_FOUND", "transaction", "local_runtime.transaction.exists", 1);
    return deepFreeze(journal);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      runtimeFail("LOCAL_RUNTIME.TRANSACTION_NOT_FOUND", "transaction", "local_runtime.transaction.exists", 1);
    }
    runtimeFail("LOCAL_RUNTIME.TRANSACTION_CORRUPT", "transaction", "local_runtime.transaction.valid_json");
  }
}

export async function transitionInstallTransaction({
  managed_root: managedRoot,
  transaction_id: transactionId,
  action_id: actionId,
  next_state: nextState,
  evidence_digest: evidenceDigest = null
}) {
  const current = structuredClone(await readInstallTransaction({ managed_root: managedRoot, transaction_id: transactionId }));
  const action = current.actions.find((item) => item.action_id === actionId);
  if (!action) runtimeFail("LOCAL_RUNTIME.ACTION_NOT_FOUND", "transaction", "local_runtime.transaction.action_exists");
  const edge = `${action.state}->${nextState}`;
  const allowed = new Set(["pending->running", "running->complete", "running->failed", "running->pending"]);
  if (!allowed.has(edge)) runtimeFail("LOCAL_RUNTIME.INVALID_TRANSACTION_EDGE", "transaction", "local_runtime.transaction.edge");
  if (nextState === "complete" && (typeof evidenceDigest !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(evidenceDigest))) {
    runtimeFail("LOCAL_RUNTIME.EVIDENCE_REQUIRED", "transaction", "local_runtime.transaction.complete_evidence");
  }
  action.state = nextState;
  action.evidence_digest = nextState === "complete" ? evidenceDigest : null;
  if (nextState === "running") action.attempt += 1;
  current.revision += 1;
  current.status = current.actions.every((item) => item.state === "complete")
    ? "complete"
    : current.actions.some((item) => item.state === "failed") ? "blocked" : "in_progress";
  const root = normalizeWindowsAbsolutePath(managedRoot, "transaction");
  const transactions = await ensureStateDirectory(root);
  try {
    await atomicWrite(path.join(transactions, `${transactionId}.r${current.revision}.json`), current);
  } catch {
    runtimeFail("LOCAL_RUNTIME.TRANSACTION_WRITE_FAILED", "transaction", "local_runtime.transaction.atomic_write");
  }
  return deepFreeze(current);
}
