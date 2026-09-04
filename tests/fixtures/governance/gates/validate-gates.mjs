import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..", "..");
const validPath = path.join(here, "catalog.valid.json");
const hostileDirectory = path.join(here, "hostile");
const wbsPath = path.join(root, "tasks", "TASK_BREAKDOWN.md");
const registryPath = path.join(root, "tasks", "registry.json");

class GateValidationError extends Error {
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.code = code;
  }
}

function fail(code, detail) {
  throw new GateValidationError(code, detail);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function expandDependencyToken(token, taskId) {
  const trimmed = token.trim();
  const range = trimmed.match(/^(.+-)(\d{3})\.\.(?:.+-)?(\d{3})$/);
  if (range) {
    const start = Number(range[2]);
    const end = Number(range[3]);
    if (end < start) fail("WBS.DESCENDING_RANGE", `${taskId}:${trimmed}`);
    return Array.from({ length: end - start + 1 }, (_, index) =>
      `${range[1]}${String(start + index).padStart(3, "0")}`,
    );
  }
  if (/^(?:external\s+)?EXT-[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(trimmed)) return [];
  if (trimmed === "remote-update program") return [];
  return [trimmed];
}

function parseWbs(text) {
  const declared = text.match(/Baseline:\s*(\d+)\s+bounded tasks/);
  if (!declared) fail("WBS.MISSING_COUNT", "Baseline count is absent");
  const tasks = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!/^\|\s*([A-Z0-9]+(?:-[A-Z0-9]+)*-[0-9]{3})\s*\|/.test(line)) continue;
    const columns = line.split("|").map((value) => value.trim());
    const id = columns[1];
    if (tasks.has(id)) fail("WBS.DUPLICATE_TASK", id);
    const dependencyCell = columns[3];
    const dependencies = !dependencyCell || dependencyCell === "—"
      ? []
      : dependencyCell.split(",").flatMap((token) => expandDependencyToken(token, id));
    const hoursMatch = (columns[6] ?? "").match(/\/\s*(\d+)/);
    if (!hoursMatch) fail("WBS.MISSING_HOURS", id);
    tasks.set(id, { id, dependencies, hours: Number(hoursMatch[1]) });
  }
  if (tasks.size !== Number(declared[1])) {
    fail("WBS.COUNT_MISMATCH", `declared=${declared[1]} parsed=${tasks.size}`);
  }
  for (const task of tasks.values()) {
    for (const dependency of task.dependencies) {
      if (!tasks.has(dependency)) fail("WBS.MISSING_DEPENDENCY", `${task.id}->${dependency}`);
    }
  }
  return tasks;
}

function assertUnique(values, code, label) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) fail(code, `${label}:${value}`);
    seen.add(value);
  }
}

function comparePaths(left, right) {
  return left.join("\u0000").localeCompare(right.join("\u0000"), "en", { sensitivity: "variant" });
}

function longestPath(tasks, target) {
  const memo = new Map();
  const visit = (id) => {
    if (memo.has(id)) return memo.get(id);
    const task = tasks.get(id);
    if (!task) fail("CRITICAL_PATH.UNKNOWN_TARGET", id);
    let best = { hours: 0, tasks: [] };
    for (const dependency of [...task.dependencies].sort()) {
      const candidate = visit(dependency);
      if (
        candidate.hours > best.hours ||
        (candidate.hours === best.hours && comparePaths(candidate.tasks, best.tasks) < 0)
      ) {
        best = candidate;
      }
    }
    const result = { hours: best.hours + task.hours, tasks: [...best.tasks, id] };
    memo.set(id, result);
    return result;
  };
  return visit(target);
}

function findGate(catalog, gateId) {
  const gate = catalog.gates.find((candidate) => candidate.id === gateId);
  if (!gate) fail("GATE.UNKNOWN_ID", gateId);
  return gate;
}

function applyMutation(base, fixture) {
  const catalog = clone(base);
  const mutation = fixture.mutation;
  switch (mutation.kind) {
    case "duplicate_gate_id":
      findGate(catalog, mutation.target).id = findGate(catalog, mutation.source).id;
      break;
    case "duplicate_gate_name":
      findGate(catalog, mutation.target).name = findGate(catalog, mutation.source).name;
      break;
    case "remove_task_assignment":
      for (const taskIds of Object.values(catalog.task_assignments)) {
        const index = taskIds.indexOf(mutation.task_id);
        if (index >= 0) taskIds.splice(index, 1);
      }
      break;
    case "accept_gate":
      findGate(catalog, mutation.gate_id).status = "accepted";
      break;
    case "add_gate_requirement":
      findGate(catalog, mutation.gate_id).requires_tasks.push(mutation.task_id);
      break;
    case "protect_task":
      findGate(catalog, mutation.gate_id).protects_tasks.push(mutation.task_id);
      break;
    case "add_task_external":
      catalog.task_external_prerequisites.push({
        task_id: mutation.task_id,
        required: [mutation.external_id],
        conditional: [],
      });
      break;
    case "create_gate_cycle":
      findGate(catalog, mutation.from).requires_gates.push(mutation.to);
      break;
    case "self_unlock":
      findGate(catalog, mutation.gate_id).unlocks_gates.push(mutation.gate_id);
      break;
    case "conflicting_critical_path": {
      const source = catalog.critical_paths.find((claim) => claim.claim_id === mutation.claim_id);
      assert(source, `Missing source claim ${mutation.claim_id}`);
      catalog.critical_paths.push({ ...clone(source), claim_id: `${source.claim_id}_conflict`, agent_hours: mutation.agent_hours });
      break;
    }
    default:
      throw new Error(`Unsupported hostile mutation: ${mutation.kind}`);
  }
  return catalog;
}

function validateCatalog(catalog, tasks, registry) {
  if (catalog.task_count !== tasks.size) fail("TASK.COUNT_MISMATCH", `${catalog.task_count}/${tasks.size}`);

  const expectedGateIds = Array.from({ length: 12 }, (_, index) => `G${index}`);
  const gateIds = catalog.gates.map((gate) => gate.id);
  assertUnique(gateIds, "GATE.DUPLICATE_ID", "gate id");
  assertUnique(catalog.gates.map((gate) => gate.name), "GATE.DUPLICATE_NAME", "gate name");
  if (gateIds.length !== 12 || [...gateIds].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).join("|") !== expectedGateIds.join("|")) {
    fail("GATE.ID_SET", gateIds.join(","));
  }

  const gateMap = new Map(catalog.gates.map((gate) => [gate.id, gate]));
  const externalIds = catalog.external_gates.map((gate) => gate.id);
  assertUnique(externalIds, "EXTERNAL.DUPLICATE_ID", "external id");
  const externalMap = new Map(catalog.external_gates.map((gate) => [gate.id, gate]));
  const authoritativeExternalCount = catalog.external_gates.filter(
    (gate) => gate.authority_class === "accepted_external_catalog",
  ).length;
  if (authoritativeExternalCount !== 10) {
    fail("EXTERNAL.AUTHORITATIVE_COUNT", String(authoritativeExternalCount));
  }
  for (const external of catalog.external_gates) {
    if (!/^EXT-[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(external.id)) fail("EXTERNAL.INVALID_ID", external.id);
    if (!external.owner) fail("EXTERNAL.MISSING_OWNER", external.id);
    if (!["accepted_external_catalog", "registry_release_prerequisite"].includes(external.authority_class)) {
      fail("EXTERNAL.INVALID_AUTHORITY_CLASS", external.id);
    }
    if (!["accepted", "blocked_external"].includes(external.status)) fail("EXTERNAL.INVALID_STATUS", external.id);
  }

  const alphaContractGate = gateMap.get("G3");
  const expectedAlphaContracts = [
    "P0-CON-001", "P0-CON-002", "P0-CON-003", "P0-CON-004", "P0-CON-005",
    "P0-CON-006", "P0-CON-007", "P0-CON-008", "P0-CON-009", "P0-CON-010",
    "P0-CON-012",
  ];
  if (alphaContractGate.requires_tasks.includes("P0-CON-011")) {
    fail("GATE.ALPHA_CONTRACT_FALSE_SERIALIZATION", "G3:P0-CON-011");
  }
  if ([...alphaContractGate.requires_tasks].sort().join("|") !== [...expectedAlphaContracts].sort().join("|")) {
    fail("GATE.ALPHA_CONTRACT_SET", alphaContractGate.requires_tasks.join(","));
  }
  if (!gateMap.get("G10").requires_tasks.includes("P0-CON-011")) {
    fail("GATE.RUNNER_CONTRACT_MISSING", "G10:P0-CON-011");
  }

  for (const gate of catalog.gates) {
    if (!["accepted", "not_started", "blocked_external"].includes(gate.status)) fail("GATE.INVALID_STATUS", gate.id);
    for (const field of ["requires_gates", "requires_tasks", "requires_external", "protects_tasks", "unlocks_gates"]) {
      assertUnique(gate[field], `GATE.DUPLICATE_${field.toUpperCase()}`, gate.id);
    }
    if (gate.unlocks_gates.includes(gate.id)) fail("GATE.SELF_UNLOCK", gate.id);
    for (const requiredGate of gate.requires_gates) {
      if (!gateMap.has(requiredGate)) fail("GATE.UNKNOWN_REQUIREMENT", `${gate.id}->${requiredGate}`);
    }
    for (const unlockedGate of gate.unlocks_gates) {
      if (!gateMap.has(unlockedGate)) fail("GATE.UNKNOWN_UNLOCK", `${gate.id}->${unlockedGate}`);
    }
    for (const taskId of [...gate.requires_tasks, ...gate.protects_tasks]) {
      if (!tasks.has(taskId)) fail("TASK.UNKNOWN_ID", `${gate.id}:${taskId}`);
    }
    for (const taskId of gate.protects_tasks) {
      if (gate.requires_tasks.includes(taskId)) fail("GATE.TASK_SELF_UNLOCK", `${gate.id}:${taskId}`);
    }
    for (const externalId of gate.requires_external) {
      if (!externalMap.has(externalId)) fail("EXTERNAL.UNKNOWN_ID", `${gate.id}:${externalId}`);
    }
    for (const conditional of gate.conditional_external) {
      if (!externalMap.has(conditional.id)) fail("EXTERNAL.UNKNOWN_ID", `${gate.id}:${conditional.id}`);
      if (!conditional.condition) fail("EXTERNAL.MISSING_CONDITION", `${gate.id}:${conditional.id}`);
    }
  }

  const visitState = new Map();
  const visit = (gateId) => {
    if (visitState.get(gateId) === 1) fail("GATE.CYCLE", gateId);
    if (visitState.get(gateId) === 2) return;
    visitState.set(gateId, 1);
    for (const predecessor of gateMap.get(gateId).requires_gates) visit(predecessor);
    visitState.set(gateId, 2);
  };
  for (const gateId of gateIds) visit(gateId);

  const assigned = new Map();
  for (const [gateId, taskIds] of Object.entries(catalog.task_assignments)) {
    if (!gateMap.has(gateId)) fail("TASK.UNKNOWN_ASSIGNMENT_GATE", gateId);
    assertUnique(taskIds, "TASK.DUPLICATE_ASSIGNMENT_IN_GATE", gateId);
    for (const taskId of taskIds) {
      if (!tasks.has(taskId)) fail("TASK.UNKNOWN_ID", `${gateId}:${taskId}`);
      if (assigned.has(taskId)) fail("TASK.MULTIPLE_ASSIGNMENTS", `${taskId}:${assigned.get(taskId)},${gateId}`);
      assigned.set(taskId, gateId);
    }
  }
  for (const taskId of tasks.keys()) {
    if (!assigned.has(taskId)) fail("TASK.MISSING_ASSIGNMENT", taskId);
  }

  const taskExternalSeen = new Set();
  for (const rule of catalog.task_external_prerequisites) {
    if (!tasks.has(rule.task_id)) fail("TASK.UNKNOWN_ID", rule.task_id);
    if (taskExternalSeen.has(rule.task_id)) fail("EXTERNAL.DUPLICATE_TASK_RULE", rule.task_id);
    taskExternalSeen.add(rule.task_id);
    assertUnique(rule.required, "EXTERNAL.DUPLICATE_TASK_REQUIREMENT", rule.task_id);
    for (const externalId of rule.required) {
      if (!externalMap.has(externalId)) fail("EXTERNAL.UNKNOWN_ID", `${rule.task_id}:${externalId}`);
    }
    for (const conditional of rule.conditional) {
      if (!externalMap.has(conditional.id)) fail("EXTERNAL.UNKNOWN_ID", `${rule.task_id}:${conditional.id}`);
      if (!conditional.condition) fail("EXTERNAL.MISSING_CONDITION", `${rule.task_id}:${conditional.id}`);
    }
  }

  const liveTaskMap = new Map(registry.tasks.map((task) => [task.id, task]));
  const liveExternalMap = new Map(registry.external_gates.map((gate) => [gate.id, gate]));
  const schedulableStatuses = new Set(["ready", "assigned", "in_progress", "review", "changes_requested"]);

  for (const gate of catalog.gates) {
    if (gate.status === "accepted") {
      for (const predecessor of gate.requires_gates) {
        if (gateMap.get(predecessor).status !== "accepted") fail("GATE.ACCEPTED_WITH_CLOSED_GATE", `${gate.id}->${predecessor}`);
      }
      for (const taskId of gate.requires_tasks) {
        if (liveTaskMap.get(taskId)?.status !== "accepted") fail("GATE.ACCEPTED_WITH_UNACCEPTED_TASK", `${gate.id}:${taskId}`);
      }
      for (const externalId of gate.requires_external) {
        const status = liveExternalMap.get(externalId)?.status ?? externalMap.get(externalId).status;
        if (status !== "accepted") fail("GATE.ACCEPTED_WITH_CLOSED_EXTERNAL", `${gate.id}:${externalId}`);
      }
    } else {
      for (const taskId of gate.protects_tasks) {
        const liveStatus = liveTaskMap.get(taskId)?.status;
        if (schedulableStatuses.has(liveStatus)) fail("GATE.CLOSED_BYPASS", `${gate.id}:${taskId}=${liveStatus}`);
      }
    }
  }

  for (const rule of catalog.task_external_prerequisites) {
    const liveStatus = liveTaskMap.get(rule.task_id)?.status;
    if (!schedulableStatuses.has(liveStatus)) continue;
    for (const externalId of rule.required) {
      const status = liveExternalMap.get(externalId)?.status ?? externalMap.get(externalId).status;
      if (status !== "accepted") fail("EXTERNAL.CLOSED_BYPASS", `${rule.task_id}:${externalId}=${liveStatus}`);
    }
  }

  const criticalClaimKeys = new Set();
  for (const claim of catalog.critical_paths) {
    const key = `${claim.kind}\u0000${claim.target_task}`;
    if (criticalClaimKeys.has(key)) fail("CRITICAL_PATH.CONFLICT", `${claim.kind}:${claim.target_task}`);
    criticalClaimKeys.add(key);
  }
  for (const claim of catalog.critical_paths) {
    if (claim.kind !== "longest_wbs_agent_hours") fail("CRITICAL_PATH.UNKNOWN_KIND", claim.kind);
    const computed = longestPath(tasks, claim.target_task);
    if (claim.agent_hours !== computed.hours) fail("CRITICAL_PATH.HOURS_MISMATCH", `${claim.claim_id}:${claim.agent_hours}/${computed.hours}`);
    if (claim.tasks.join("|") !== computed.tasks.join("|")) fail("CRITICAL_PATH.TASKS_MISMATCH", claim.claim_id);
  }

  return {
    gates: catalog.gates.length,
    tasks: assigned.size,
    external: catalog.external_gates.length,
    criticalPaths: catalog.critical_paths.length,
  };
}

const [validText, wbsText, registryText] = await Promise.all([
  readFile(validPath, "utf8"),
  readFile(wbsPath, "utf8"),
  readFile(registryPath, "utf8"),
]);
const validCatalog = JSON.parse(validText);
const tasks = parseWbs(wbsText);
const registry = JSON.parse(registryText);
const validSummary = validateCatalog(validCatalog, tasks, registry);

const hostileFiles = (await readdir(hostileDirectory))
  .filter((name) => name.endsWith(".json"))
  .sort();
let negativePassed = 0;
for (const name of hostileFiles) {
  const fixture = JSON.parse(await readFile(path.join(hostileDirectory, name), "utf8"));
  const mutated = applyMutation(validCatalog, fixture);
  const hostileRegistry = clone(registry);
  if (fixture.mutation.kind === "protect_task") {
    const task = hostileRegistry.tasks.find((candidate) => candidate.id === fixture.mutation.task_id);
    assert(task, `Missing live task for hostile fixture ${fixture.fixture_id}`);
    task.status = "in_progress";
  }
  if (fixture.mutation.kind === "accept_gate") {
    const requiredTaskId = findGate(mutated, fixture.mutation.gate_id).requires_tasks.at(-1);
    const task = hostileRegistry.tasks.find((candidate) => candidate.id === requiredTaskId);
    if (task) task.status = "backlog";
  }
  let observed = null;
  try {
    validateCatalog(mutated, tasks, hostileRegistry);
  } catch (error) {
    if (!(error instanceof GateValidationError)) throw error;
    observed = error.code;
  }
  if (observed !== fixture.expected_code) {
    throw new Error(`${fixture.fixture_id}: expected ${fixture.expected_code}, observed ${observed ?? "PASS"}`);
  }
  negativePassed += 1;
}

console.log(
  `GATE_VALIDATION_OK valid=1 negative=${negativePassed} gates=${validSummary.gates} tasks=${validSummary.tasks} external=${validSummary.external} critical_paths=${validSummary.criticalPaths}`,
);
