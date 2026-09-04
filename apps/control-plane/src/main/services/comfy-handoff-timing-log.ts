import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import type { ComfyHandoffTimingEvidence } from "./comfy-handoff.js";

export const COMFY_HANDOFF_TIMING_FILE_NAME = "comfy-handoff-timing.v2.json";
export const COMFY_HANDOFF_TIMING_HISTORY_LIMIT = 20;

const MAX_TIMING_FILE_BYTES = 128 * 1024;
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;
const OUTCOMES = new Set([
  "loaded",
  "visible_not_loaded",
  "window_closed",
  "renderer_gone",
  "stored_not_opened",
  "mock_exported",
  "failed"
]);
const FAILURE_STAGES = new Set([
  "request_validation",
  "input_preparation",
  "workflow_compilation",
  "capability_preflight",
  "workflow_persistence",
  "visible_handoff"
]);
const HANDOFF_OUTCOMES = new Set([
  "loaded",
  "visible_not_loaded",
  "window_closed",
  "renderer_gone"
]);
const REFRESH_DISPOSITIONS = new Set([
  "not_required",
  "reused",
  "performed",
  "failed"
]);

export type CompileAndOpenTimingStage =
  | "request_validation"
  | "input_preparation"
  | "workflow_compilation"
  | "capability_preflight"
  | "workflow_persistence"
  | "visible_handoff";

export type CompileAndOpenTimingEvidence = {
  readonly schemaVersion: "2.0.0";
  readonly outcome:
    | "loaded"
    | "visible_not_loaded"
    | "window_closed"
    | "renderer_gone"
    | "stored_not_opened"
    | "mock_exported"
    | "failed";
  readonly failedStage: CompileAndOpenTimingStage | null;
  readonly stableErrorCode: string | null;
  readonly totalMs: number;
  readonly requestValidationMs: number;
  readonly inputPreparationMs: number;
  readonly workflowCompilationMs: number;
  readonly capabilityPreflightMs: number;
  readonly workflowPersistenceMs: number;
  readonly visibleHandoffMs: number;
  readonly visibleHandoff: ComfyHandoffTimingEvidence | null;
};

function safeDuration(value: number): number {
  return Number.isFinite(value) && value >= 0
    ? Math.min(Math.round(value), MAX_DURATION_MS)
    : 0;
}

function samePath(left: string, right: string): boolean {
  return resolve(left).toLocaleLowerCase("en-US") === resolve(right).toLocaleLowerCase("en-US");
}

function contained(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child.length > 0 && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

type DirectDirectoryIdentity = {
  readonly path: string;
  readonly device: number;
  readonly inode: number;
};

async function requireDirectDirectory(directory: string): Promise<DirectDirectoryIdentity> {
  const metadata = await lstat(directory);
  const canonical = await realpath(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || !samePath(canonical, directory)) {
    throw new Error("HANDOFF_TIMING.DIRECTORY_UNSAFE");
  }
  return Object.freeze({ path: canonical, device: metadata.dev, inode: metadata.ino });
}

async function requireLogsDirectory(dataRootDirectory: string): Promise<{
  readonly dataRoot: DirectDirectoryIdentity;
  readonly logs: DirectDirectoryIdentity;
}> {
  if (!isAbsolute(dataRootDirectory)) throw new Error("HANDOFF_TIMING.DATA_ROOT_INVALID");
  const dataRoot = await requireDirectDirectory(dataRootDirectory);
  const expectedLogs = join(dataRoot.path, "logs");
  try {
    await mkdir(expectedLogs, { recursive: false });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const logs = await requireDirectDirectory(expectedLogs);
  if (!contained(dataRoot.path, logs.path) || relative(dataRoot.path, logs.path) !== "logs") {
    throw new Error("HANDOFF_TIMING.LOGS_OUTSIDE_DATA_ROOT");
  }
  return Object.freeze({ dataRoot, logs });
}

function sameDirectoryIdentity(left: DirectDirectoryIdentity, right: DirectDirectoryIdentity): boolean {
  return samePath(left.path, right.path) && left.device === right.device && left.inode === right.inode;
}

function stableErrorCode(value: unknown): string | null {
  return typeof value === "string" && /^[A-Z][A-Z0-9_.-]{1,95}$/u.test(value) ? value : null;
}

function storedHandoff(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const handoff = value as Record<string, unknown>;
  const refresh = handoff.node_definition_refresh;
  if (
    !HANDOFF_OUTCOMES.has(String(handoff.outcome)) ||
    refresh === null ||
    typeof refresh !== "object" ||
    Array.isArray(refresh) ||
    !REFRESH_DISPOSITIONS.has(String((refresh as Record<string, unknown>).disposition))
  ) return null;
  return Object.freeze({
    outcome: String(handoff.outcome),
    total_ms: safeDuration(Number(handoff.total_ms)),
    capability_readiness_ms: safeDuration(Number(handoff.capability_readiness_ms)),
    node_definition_refresh: Object.freeze({
      disposition: String((refresh as Record<string, unknown>).disposition),
      elapsed_ms: safeDuration(Number((refresh as Record<string, unknown>).elapsed_ms))
    }),
    workflow_load_confirmation_ms: safeDuration(Number(handoff.workflow_load_confirmation_ms))
  });
}

function storedSample(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const sample = value as Record<string, unknown>;
  const stages = sample.stages;
  const failedStage = sample.failed_stage === null ? null : String(sample.failed_stage);
  const errorCode = sample.stable_error_code === null ? null : stableErrorCode(sample.stable_error_code);
  if (
    typeof sample.recorded_at_utc !== "string" ||
    sample.recorded_at_utc.length > 32 ||
    !Number.isFinite(Date.parse(sample.recorded_at_utc)) ||
    !OUTCOMES.has(String(sample.outcome)) ||
    (failedStage !== null && !FAILURE_STAGES.has(failedStage)) ||
    (sample.stable_error_code !== null && errorCode === null) ||
    stages === null ||
    typeof stages !== "object" ||
    Array.isArray(stages)
  ) return null;
  const stageRecord = stages as Record<string, unknown>;
  const handoff = stageRecord.visible_handoff === null
    ? null
    : storedHandoff(stageRecord.visible_handoff);
  if (stageRecord.visible_handoff !== null && handoff === null) return null;
  return Object.freeze({
    recorded_at_utc: sample.recorded_at_utc,
    outcome: String(sample.outcome),
    failed_stage: failedStage,
    stable_error_code: errorCode,
    total_ms: safeDuration(Number(sample.total_ms)),
    stages: Object.freeze({
      request_validation_ms: safeDuration(Number(stageRecord.request_validation_ms)),
      input_preparation_ms: safeDuration(Number(stageRecord.input_preparation_ms)),
      workflow_compilation_ms: safeDuration(Number(stageRecord.workflow_compilation_ms)),
      capability_preflight_ms: safeDuration(Number(stageRecord.capability_preflight_ms)),
      workflow_persistence_ms: safeDuration(Number(stageRecord.workflow_persistence_ms)),
      visible_handoff_ms: safeDuration(Number(stageRecord.visible_handoff_ms)),
      visible_handoff: handoff
    })
  });
}

function serializedSample(
  evidence: CompileAndOpenTimingEvidence,
  recordedAt: Date
): Record<string, unknown> {
  if (
    evidence.schemaVersion !== "2.0.0" ||
    !OUTCOMES.has(evidence.outcome) ||
    (evidence.failedStage !== null && !FAILURE_STAGES.has(evidence.failedStage)) ||
    (evidence.stableErrorCode !== null && stableErrorCode(evidence.stableErrorCode) === null) ||
    !Number.isFinite(recordedAt.getTime())
  ) throw new Error("HANDOFF_TIMING.EVIDENCE_INVALID");
  const handoff = evidence.visibleHandoff === null
    ? null
    : storedHandoff({
        outcome: evidence.visibleHandoff.outcome,
        total_ms: evidence.visibleHandoff.totalMs,
        capability_readiness_ms: evidence.visibleHandoff.capabilityReadinessMs,
        node_definition_refresh: {
          disposition: evidence.visibleHandoff.nodeDefinitionRefresh.disposition,
          elapsed_ms: evidence.visibleHandoff.nodeDefinitionRefresh.elapsedMs
        },
        workflow_load_confirmation_ms: evidence.visibleHandoff.workflowLoadConfirmationMs
      });
  if (evidence.visibleHandoff !== null && handoff === null) {
    throw new Error("HANDOFF_TIMING.HANDOFF_EVIDENCE_INVALID");
  }
  return Object.freeze({
    recorded_at_utc: recordedAt.toISOString(),
    outcome: evidence.outcome,
    failed_stage: evidence.failedStage,
    stable_error_code: evidence.stableErrorCode,
    total_ms: safeDuration(evidence.totalMs),
    stages: Object.freeze({
      request_validation_ms: safeDuration(evidence.requestValidationMs),
      input_preparation_ms: safeDuration(evidence.inputPreparationMs),
      workflow_compilation_ms: safeDuration(evidence.workflowCompilationMs),
      capability_preflight_ms: safeDuration(evidence.capabilityPreflightMs),
      workflow_persistence_ms: safeDuration(evidence.workflowPersistenceMs),
      visible_handoff_ms: safeDuration(evidence.visibleHandoffMs),
      visible_handoff: handoff
    })
  });
}

async function existingSamples(destination: string): Promise<readonly Record<string, unknown>[]> {
  try {
    const metadata = await lstat(destination);
    if (!metadata.isFile() || metadata.isSymbolicLink() || !samePath(await realpath(destination), destination)) {
      throw new Error("HANDOFF_TIMING.DESTINATION_UNSAFE");
    }
    if (metadata.size > MAX_TIMING_FILE_BYTES) return [];
    const parsed = JSON.parse(await readFile(destination, "utf8")) as Record<string, unknown>;
    if (parsed.schema_version !== 2 || !Array.isArray(parsed.samples)) return [];
    return parsed.samples
      .map(storedSample)
      .filter((sample): sample is Record<string, unknown> => sample !== null)
      .slice(-COMFY_HANDOFF_TIMING_HISTORY_LIMIT);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    if (error instanceof SyntaxError) return [];
    throw error;
  }
}

async function requireReplaceableDestination(destination: string): Promise<void> {
  try {
    const metadata = await lstat(destination);
    if (!metadata.isFile() || metadata.isSymbolicLink() || !samePath(await realpath(destination), destination)) {
      throw new Error("HANDOFF_TIMING.DESTINATION_UNSAFE");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

let writeQueue: Promise<void> = Promise.resolve();

async function writeEvidence(
  dataRootDirectory: string,
  evidence: CompileAndOpenTimingEvidence,
  recordedAt: Date
): Promise<void> {
  const initial = await requireLogsDirectory(dataRootDirectory);
  const destination = join(initial.logs.path, COMFY_HANDOFF_TIMING_FILE_NAME);
  const temporary = join(initial.logs.path, `.${COMFY_HANDOFF_TIMING_FILE_NAME}.${randomUUID()}.tmp`);
  const samples = [
    ...await existingSamples(destination),
    serializedSample(evidence, recordedAt)
  ].slice(-COMFY_HANDOFF_TIMING_HISTORY_LIMIT);
  const payload = Object.freeze({ schema_version: 2, samples: Object.freeze(samples) });

  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    const temporaryMetadata = await lstat(temporary);
    const temporaryIdentity = await realpath(temporary);
    if (
      !temporaryMetadata.isFile() ||
      temporaryMetadata.isSymbolicLink() ||
      !contained(initial.logs.path, temporaryIdentity) ||
      !samePath(temporaryIdentity, temporary)
    ) throw new Error("HANDOFF_TIMING.TEMPORARY_UNSAFE");

    const current = await requireLogsDirectory(initial.dataRoot.path);
    if (
      !sameDirectoryIdentity(current.dataRoot, initial.dataRoot) ||
      !sameDirectoryIdentity(current.logs, initial.logs)
    ) throw new Error("HANDOFF_TIMING.LOGS_CHANGED");
    await requireReplaceableDestination(destination);
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export function writeCompileAndOpenTimingEvidence(
  dataRootDirectory: string,
  evidence: CompileAndOpenTimingEvidence,
  recordedAt = new Date()
): Promise<void> {
  const operation = writeQueue.then(() => writeEvidence(dataRootDirectory, evidence, recordedAt));
  writeQueue = operation.catch(() => undefined);
  return operation;
}
