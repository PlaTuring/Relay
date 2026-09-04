/**
 * Renderer-side deterministic editing state.
 *
 * This module deliberately does not write files.  It emits an atomic-save
 * request that the project repository may execute as
 * `write temporary -> flush -> replace`.  Keeping I/O out of the renderer
 * makes success impossible to report before the repository confirms it.
 */

export type ProjectJsonPrimitive = string | number | boolean | null;
export type ProjectJsonValue =
  | ProjectJsonPrimitive
  | readonly ProjectJsonValue[]
  | { readonly [key: string]: ProjectJsonValue };

export type ProjectHistoryReason = "manual" | "compile_handoff" | "restore";
export type ProjectAutosavePhase = "idle" | "scheduled" | "saving" | "saved" | "failed";

export interface ProjectStateCommand<TProject> {
  readonly id: string;
  readonly label: string;
  readonly before: TProject;
  readonly after: TProject;
  readonly createdAtMs: number;
}

export interface ProjectHistoryCheckpoint {
  readonly id: string;
  readonly parentCheckpointId: string | null;
  readonly createdAt: string;
  readonly reason: ProjectHistoryReason;
  readonly label: string;
  readonly projectContentHash: string;
  readonly projectSnapshot: string;
}

export interface ProjectAutosaveState {
  readonly phase: ProjectAutosavePhase;
  readonly dueAtMs: number | null;
  readonly activeRequestId: string | null;
  readonly lastSavedAt: string | null;
  readonly lastError: string | null;
}

export interface AtomicProjectSaveRequest {
  readonly requestId: string;
  readonly projectRevision: number;
  readonly projectContentHash: string;
  readonly payload: string;
  /** Project-relative target.  Absolute private paths never enter renderer state. */
  readonly targetRelativePath: "project.relay.json";
  readonly temporaryRelativePath: string;
  readonly strategy: "write_temp_flush_replace";
  readonly requestedAtMs: number;
}

export interface ProjectStateSession<TProject> {
  readonly current: TProject;
  readonly currentRevision: number;
  readonly persistedContentHash: string;
  readonly commands: readonly ProjectStateCommand<TProject>[];
  /** Number of commands currently applied; commands after this index are redo. */
  readonly commandCursor: number;
  readonly history: readonly ProjectHistoryCheckpoint[];
  readonly activeCheckpointId: string | null;
  readonly autosave: ProjectAutosaveState;
  readonly autosaveDelayMs: number;
  readonly maximumUndoDepth: number;
}

export interface ProjectStateSessionOptions {
  readonly autosaveDelayMs?: number;
  readonly maximumUndoDepth?: number;
  /** Set false when loading a recovery snapshot not yet persisted as the project truth. */
  readonly initiallyPersisted?: boolean;
}

function normalizeJson(value: unknown, seen = new Set<object>()): ProjectJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Project state only supports finite JSON numbers.");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError("Project state cannot contain cycles.");
    seen.add(value);
    const normalized = value.map((entry) => normalizeJson(entry, seen));
    seen.delete(value);
    return normalized;
  }
  if (typeof value === "object" && value !== null) {
    if (seen.has(value)) throw new TypeError("Project state cannot contain cycles.");
    seen.add(value);
    const normalized: Record<string, ProjectJsonValue> = {};
    for (const key of Object.keys(value as object).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) normalized[key] = normalizeJson(entry, seen);
    }
    seen.delete(value);
    return normalized;
  }
  throw new TypeError("Project state must be JSON serializable.");
}

export function canonicalProjectJson(value: unknown): string {
  return JSON.stringify(normalizeJson(value));
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
  return Object.freeze(value);
}

export function immutableProjectCopy<T>(value: T): T {
  return deepFreeze(JSON.parse(canonicalProjectJson(value)) as T);
}

/** Stable, non-cryptographic content identity used only for in-memory ordering. */
export function projectContentHash(value: unknown): string {
  const source = typeof value === "string" ? value : canonicalProjectJson(value);
  const mask = 0xffffffffffffffffn;
  const prime = 0x100000001b3n;
  const hashWithSeed = (seed: bigint): string => {
    let hash = seed;
    for (let index = 0; index < source.length; index += 1) {
      hash ^= BigInt(source.charCodeAt(index));
      hash = (hash * prime) & mask;
    }
    return hash.toString(16).padStart(16, "0");
  };
  return `${hashWithSeed(0xcbf29ce484222325n)}${hashWithSeed(0x84222325cbf29ce4n)}`;
}

function positiveInteger(value: unknown, fallback: number): number {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : fallback;
}

function commandId(label: string, before: unknown, after: unknown, createdAtMs: number): string {
  return `command-${projectContentHash({ label, before, after, createdAtMs }).slice(0, 24)}`;
}

function checkpointId(input: {
  readonly parentCheckpointId: string | null;
  readonly createdAt: string;
  readonly reason: ProjectHistoryReason;
  readonly label: string;
  readonly projectContentHash: string;
  readonly sequence: number;
}): string {
  return `checkpoint-${projectContentHash(input).slice(0, 24)}`;
}

function scheduledAutosave(
  nowMs: number,
  delayMs: number,
  previous?: ProjectAutosaveState
): ProjectAutosaveState {
  return {
    phase: "scheduled",
    dueAtMs: nonNegativeInteger(nowMs, 0) + delayMs,
    activeRequestId: null,
    lastSavedAt: previous?.lastSavedAt ?? null,
    lastError: null
  };
}

export function createProjectStateSession<TProject>(
  project: TProject,
  options: ProjectStateSessionOptions = {}
): ProjectStateSession<TProject> {
  const current = immutableProjectCopy(project);
  const hash = projectContentHash(current);
  const initiallyPersisted = options.initiallyPersisted !== false;
  return Object.freeze({
    current,
    currentRevision: 0,
    persistedContentHash: initiallyPersisted ? hash : "",
    commands: Object.freeze([]),
    commandCursor: 0,
    history: Object.freeze([]),
    activeCheckpointId: null,
    autosave: Object.freeze<ProjectAutosaveState>({
      phase: initiallyPersisted ? "saved" : "scheduled",
      dueAtMs: initiallyPersisted ? null : 0,
      activeRequestId: null,
      lastSavedAt: null,
      lastError: null
    }),
    autosaveDelayMs: positiveInteger(options.autosaveDelayMs, 750),
    maximumUndoDepth: positiveInteger(options.maximumUndoDepth, 100)
  });
}

export function isProjectSessionDirty<TProject>(session: ProjectStateSession<TProject>): boolean {
  return projectContentHash(session.current) !== session.persistedContentHash;
}

export function canUndoProjectState<TProject>(session: ProjectStateSession<TProject>): boolean {
  return session.commandCursor > 0;
}

export function canRedoProjectState<TProject>(session: ProjectStateSession<TProject>): boolean {
  return session.commandCursor < session.commands.length;
}

export function applyProjectStateCommand<TProject>(
  session: ProjectStateSession<TProject>,
  input: {
    readonly label: string;
    readonly nextProject: TProject;
    readonly createdAtMs: number;
  }
): ProjectStateSession<TProject> {
  const label = input.label.trim();
  if (label.length === 0) throw new TypeError("Project commands require a visible label.");
  const before = immutableProjectCopy(session.current);
  const after = immutableProjectCopy(input.nextProject);
  if (canonicalProjectJson(before) === canonicalProjectJson(after)) return session;

  const createdAtMs = nonNegativeInteger(input.createdAtMs, 0);
  const command: ProjectStateCommand<TProject> = Object.freeze({
    id: commandId(label, before, after, createdAtMs),
    label,
    before,
    after,
    createdAtMs
  });
  const applied = [...session.commands.slice(0, session.commandCursor), command];
  const trimmed = applied.slice(Math.max(0, applied.length - session.maximumUndoDepth));
  return Object.freeze({
    ...session,
    current: after,
    currentRevision: session.currentRevision + 1,
    commands: Object.freeze(trimmed),
    commandCursor: trimmed.length,
    autosave: Object.freeze(scheduledAutosave(createdAtMs, session.autosaveDelayMs, session.autosave))
  });
}

function navigateCommand<TProject>(
  session: ProjectStateSession<TProject>,
  direction: "undo" | "redo",
  nowMs: number
): ProjectStateSession<TProject> {
  if (direction === "undo" && !canUndoProjectState(session)) return session;
  if (direction === "redo" && !canRedoProjectState(session)) return session;
  const commandIndex = direction === "undo" ? session.commandCursor - 1 : session.commandCursor;
  const command = session.commands[commandIndex];
  if (command === undefined) return session;
  const current = immutableProjectCopy(direction === "undo" ? command.before : command.after);
  return Object.freeze({
    ...session,
    current,
    currentRevision: session.currentRevision + 1,
    commandCursor: direction === "undo" ? commandIndex : commandIndex + 1,
    autosave: Object.freeze(scheduledAutosave(nowMs, session.autosaveDelayMs, session.autosave))
  });
}

export function undoProjectState<TProject>(
  session: ProjectStateSession<TProject>,
  nowMs: number
): ProjectStateSession<TProject> {
  return navigateCommand(session, "undo", nowMs);
}

export function redoProjectState<TProject>(
  session: ProjectStateSession<TProject>,
  nowMs: number
): ProjectStateSession<TProject> {
  return navigateCommand(session, "redo", nowMs);
}

export function rescheduleProjectAutosave<TProject>(
  session: ProjectStateSession<TProject>,
  nowMs: number
): ProjectStateSession<TProject> {
  if (!isProjectSessionDirty(session)) return session;
  return Object.freeze({
    ...session,
    autosave: Object.freeze(scheduledAutosave(nowMs, session.autosaveDelayMs, session.autosave))
  });
}

export function claimProjectAutosave<TProject>(
  session: ProjectStateSession<TProject>,
  nowMs: number
): readonly [ProjectStateSession<TProject>, AtomicProjectSaveRequest | null] {
  if (!isProjectSessionDirty(session)
    || session.autosave.phase !== "scheduled"
    || session.autosave.dueAtMs === null
    || nowMs < session.autosave.dueAtMs) {
    return Object.freeze([session, null]);
  }
  const payload = canonicalProjectJson(session.current);
  const contentHash = projectContentHash(payload);
  const requestId = `autosave-${projectContentHash({
    revision: session.currentRevision,
    contentHash,
    nowMs
  }).slice(0, 24)}`;
  const request: AtomicProjectSaveRequest = Object.freeze({
    requestId,
    projectRevision: session.currentRevision,
    projectContentHash: contentHash,
    payload,
    targetRelativePath: "project.relay.json",
    temporaryRelativePath: `project.relay.json.${requestId}.tmp`,
    strategy: "write_temp_flush_replace",
    requestedAtMs: nonNegativeInteger(nowMs, 0)
  });
  const next = Object.freeze({
    ...session,
    autosave: Object.freeze<ProjectAutosaveState>({
      ...session.autosave,
      phase: "saving",
      dueAtMs: null,
      activeRequestId: requestId,
      lastError: null
    })
  });
  return Object.freeze([next, request]);
}

export function completeProjectAutosave<TProject>(
  session: ProjectStateSession<TProject>,
  input: {
    readonly request: AtomicProjectSaveRequest;
    readonly succeeded: boolean;
    readonly completedAt: string;
    readonly error?: string;
    readonly retryAtMs?: number;
  }
): ProjectStateSession<TProject> {
  if (session.autosave.activeRequestId !== input.request.requestId) return session;
  if (!input.succeeded) {
    const error = (input.error ?? "项目自动保存失败。").trim() || "项目自动保存失败。";
    return Object.freeze({
      ...session,
      autosave: Object.freeze<ProjectAutosaveState>({
        phase: input.retryAtMs === undefined ? "failed" : "scheduled",
        dueAtMs: input.retryAtMs === undefined ? null : nonNegativeInteger(input.retryAtMs, 0),
        activeRequestId: null,
        lastSavedAt: session.autosave.lastSavedAt,
        lastError: error
      })
    });
  }

  const currentHash = projectContentHash(session.current);
  const currentChangedAfterClaim = currentHash !== input.request.projectContentHash;
  return Object.freeze({
    ...session,
    persistedContentHash: input.request.projectContentHash,
    autosave: Object.freeze<ProjectAutosaveState>({
      phase: currentChangedAfterClaim ? "scheduled" : "saved",
      dueAtMs: currentChangedAfterClaim
        ? input.request.requestedAtMs + session.autosaveDelayMs
        : null,
      activeRequestId: null,
      lastSavedAt: input.completedAt,
      lastError: null
    })
  });
}

export function createProjectHistoryCheckpoint<TProject>(
  session: ProjectStateSession<TProject>,
  input: {
    readonly reason: ProjectHistoryReason;
    readonly label: string;
    readonly createdAt: string;
  }
): ProjectStateSession<TProject> {
  const label = input.label.trim();
  if (label.length === 0) throw new TypeError("Project history checkpoints require a visible label.");
  const projectSnapshot = canonicalProjectJson(session.current);
  const contentHash = projectContentHash(projectSnapshot);
  const checkpoint: ProjectHistoryCheckpoint = Object.freeze({
    id: checkpointId({
      parentCheckpointId: session.activeCheckpointId,
      createdAt: input.createdAt,
      reason: input.reason,
      label,
      projectContentHash: contentHash,
      sequence: session.history.length
    }),
    parentCheckpointId: session.activeCheckpointId,
    createdAt: input.createdAt,
    reason: input.reason,
    label,
    projectContentHash: contentHash,
    projectSnapshot
  });
  return Object.freeze({
    ...session,
    history: Object.freeze([...session.history, checkpoint]),
    activeCheckpointId: checkpoint.id
  });
}

export function restoreProjectHistoryCheckpoint<TProject>(
  session: ProjectStateSession<TProject>,
  input: {
    readonly checkpointId: string;
    readonly createdAt: string;
    readonly createdAtMs: number;
    readonly label?: string;
  }
): ProjectStateSession<TProject> {
  const source = session.history.find((checkpoint) => checkpoint.id === input.checkpointId);
  if (source === undefined) throw new TypeError(`Unknown project checkpoint: ${input.checkpointId}`);
  const restored = immutableProjectCopy(JSON.parse(source.projectSnapshot) as TProject);
  const edited = applyProjectStateCommand(session, {
    label: input.label?.trim() || `恢复历史：${source.label}`,
    nextProject: restored,
    createdAtMs: input.createdAtMs
  });
  // A restore is a new immutable branch head.  The source checkpoint remains untouched.
  const branchBase = Object.freeze({ ...edited, activeCheckpointId: source.id });
  return createProjectHistoryCheckpoint(branchBase, {
    reason: "restore",
    label: input.label?.trim() || `从“${source.label}”恢复`,
    createdAt: input.createdAt
  });
}
