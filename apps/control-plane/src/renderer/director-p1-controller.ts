import {
  directorShotFingerprint,
  type DirectorDraft,
  type DirectorShot
} from "./director-console.js";
import {
  assignShotToScene,
  canonicalProductionJson,
  createProductionRevision,
  isProductionShotDuration,
  migrateDirectorV5Draft,
  migrateProductionStateV1ToV2,
  normalizeProductionState,
  resolveShotContinuity,
  restoreProductionRevision,
  updateProductionProject,
  upsertProductionScene,
  type DirectorProductionState,
  type ProductionEntity,
  type ProductionRevision,
  type ProductionScene,
  type ProductionShot
} from "./director-production.js";
import type { RelaySeedPolicy } from "../shared/seed-policy.js";

export interface DirectorP1OutputSettings {
  readonly canvas?: string;
  readonly resolution?: string;
  readonly seed?: string;
  readonly seedPolicy?: RelaySeedPolicy;
  readonly sampling?: string;
}

export interface DirectorP1SyncInput {
  readonly state: DirectorProductionState;
  readonly workflowName: string;
  readonly draft: DirectorDraft;
  readonly output?: DirectorP1OutputSettings;
}

export interface DirectorP1SyncResult {
  readonly state: DirectorProductionState;
  readonly draft: DirectorDraft;
  readonly defaultSceneId: string;
}

export interface DirectorP1DecorationResult {
  readonly draft: DirectorDraft;
  readonly effectiveFingerprints: Readonly<Record<string, string>>;
}

export interface DirectorP1V7Payload {
  readonly version: 7;
  readonly workflowName: string;
  readonly draft: DirectorDraft;
  readonly productionState: DirectorProductionState;
  readonly lastCompiledShotFingerprints: Readonly<Record<string, string>>;
  readonly [key: string]: unknown;
}

/** @deprecated Compatibility type name; new payloads are always v7. */
export type DirectorP1V6Payload = DirectorP1V7Payload;

export interface DirectorP1Submission {
  readonly schemaVersion: 2;
  readonly workflowName: string;
  readonly draft: DirectorDraft;
  readonly effectiveDraft: DirectorDraft;
  readonly productionState: DirectorProductionState;
  readonly effectiveFingerprints: Readonly<Record<string, string>>;
  readonly directorSnapshot: string;
}

export type DirectorP1RestoreResult = Readonly<
  | {
      readonly ok: true;
      readonly sourceVersion: 5 | 6 | 7;
      readonly workflowName: string;
      readonly draft: DirectorDraft;
      readonly state: DirectorProductionState;
      readonly lastCompiledShotFingerprints: Readonly<Record<string, string>>;
      readonly warnings: readonly string[];
      readonly mayWriteBack: false;
    }
  | {
      readonly ok: false;
      readonly error: string;
      readonly mayWriteBack: false;
    }
>;

export type DirectorP1RevisionRestoreResult = Readonly<
  | {
      readonly ok: true;
      readonly workflowName: string;
      readonly draft: DirectorDraft;
      readonly state: DirectorProductionState;
      readonly effectiveFingerprints: Readonly<Record<string, string>>;
    }
  | {
      readonly ok: false;
      readonly error: string;
      readonly state: DirectorProductionState;
    }
>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function immutableJsonCopy<T>(value: T): T {
  const copy = JSON.parse(canonicalProductionJson(value)) as T;
  const freeze = (candidate: unknown, seen = new Set<object>()): void => {
    if (typeof candidate !== "object" || candidate === null || seen.has(candidate)) return;
    seen.add(candidate);
    for (const child of Object.values(candidate)) freeze(child, seen);
    Object.freeze(candidate);
  };
  freeze(copy);
  return copy;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function positiveInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function nonNegativeInteger(value: unknown): number | null {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function directorDraftFromUnknown(value: unknown): DirectorDraft | null {
  const root = asRecord(value);
  if (root === null) return null;
  const language = root.language === "en" ? "en" : root.language === "zh" ? "zh" : null;
  const mode = root.mode === "T2V" || root.mode === "FL2VA" || root.mode === "REF2VA"
    ? root.mode
    : null;
  const totalDurationSeconds = positiveInteger(root.totalDurationSeconds);
  const segmentDurationSeconds = positiveInteger(root.segmentDurationSeconds);
  if (language === null || mode === null || totalDurationSeconds === null || segmentDurationSeconds === null) {
    return null;
  }
  if (!isProductionShotDuration(segmentDurationSeconds)) return null;
  if (!Array.isArray(root.shots)) return null;
  const shots: DirectorShot[] = [];
  for (const value of root.shots) {
    const shot = asRecord(value);
    if (shot === null) return null;
    const startSeconds = nonNegativeInteger(shot.startSeconds);
    const durationSeconds = positiveInteger(shot.durationSeconds);
    if (startSeconds === null || durationSeconds === null || typeof shot.description !== "string") return null;
    if (!isProductionShotDuration(durationSeconds)) return null;
    const id = typeof shot.id === "string" && shot.id.startsWith("shot-") ? shot.id : null;
    shots.push({
      ...(id === null ? {} : { id }),
      startSeconds,
      durationSeconds,
      description: shot.description,
      cameraLanguage: text(shot.cameraLanguage),
      soundCue: text(shot.soundCue),
      transitionNote: text(shot.transitionNote)
    });
  }
  let cursor = 0;
  for (const shot of shots) {
    if (shot.startSeconds !== cursor) return null;
    cursor += shot.durationSeconds;
  }
  if (shots.length === 0 || cursor !== totalDurationSeconds) return null;
  if (mode === "REF2VA" && (shots.length !== 1 || totalDurationSeconds > 15)) return null;
  return immutableJsonCopy({
    language,
    mode,
    totalDurationSeconds,
    segmentDurationSeconds,
    characterBible: text(root.characterBible),
    worldBible: text(root.worldBible),
    visualStyleBible: text(root.visualStyleBible),
    continuity: text(root.continuity),
    shots,
    overallSoundscape: text(root.overallSoundscape),
    nonDiegeticMusic: text(root.nonDiegeticMusic),
    subjectDefinitions: text(root.subjectDefinitions),
    summary: text(root.summary),
    retentionAnalysis: text(root.retentionAnalysis),
    styleOpening: text(root.styleOpening)
  });
}

function shotTimingKey(shot: Pick<DirectorShot | ProductionShot, "startSeconds" | "durationSeconds">): string {
  return `${shot.startSeconds}:${shot.durationSeconds}`;
}

function productionShotLocation(
  state: DirectorProductionState,
  shotId: string
): { readonly scene: ProductionScene; readonly shot: ProductionShot } | null {
  for (const scene of state.scenes) {
    const shot = scene.shots.find((candidate) => candidate.id === shotId);
    if (shot !== undefined) return { scene, shot };
  }
  return null;
}

function findDefaultScene(state: DirectorProductionState): ProductionScene | null {
  return state.scenes.find((scene) => scene.title === "默认场景")
    ?? state.scenes.find((scene) => scene.title === "Default Scene")
    ?? null;
}

function activateCurrentShots(
  state: DirectorProductionState,
  currentShotIds: ReadonlySet<string>,
  defaultSceneId: string
): DirectorProductionState {
  const activeSceneIds = new Set(state.scenes
    .filter((scene) => scene.shots.some((shot) => currentShotIds.has(shot.id)))
    .map((scene) => scene.id));
  activeSceneIds.add(defaultSceneId);
  return normalizeProductionState({
    ...state,
    scenes: state.scenes.map((scene) => ({
      ...scene,
      archived: activeSceneIds.has(scene.id) ? false : scene.archived,
      shots: scene.shots.map((shot) => ({
        ...shot,
        archived: currentShotIds.has(shot.id) ? false : true
      }))
    }))
  });
}

/**
 * Synchronizes only literal user-authored Director values into Production State.
 * Missing timeline shots are archived, never deleted. Entities, continuity layers,
 * revisions and Takes are carried forward unchanged.
 */
export function syncDirectorProductionState(input: DirectorP1SyncInput): DirectorP1SyncResult {
  let timelineDuration = 0;
  for (const [index, shot] of input.draft.shots.entries()) {
    if (!isProductionShotDuration(shot.durationSeconds)) {
      throw new RangeError(`Director shot ${index + 1} duration must be 5, 10, or 15 seconds.`);
    }
    if (shot.startSeconds !== timelineDuration) {
      throw new RangeError(`Director shot ${index + 1} does not start at the contiguous timeline boundary.`);
    }
    timelineDuration += shot.durationSeconds;
  }
  if (timelineDuration <= 0 || timelineDuration !== input.draft.totalDurationSeconds) {
    throw new RangeError("Director total duration must equal the sum of active shot durations.");
  }
  if (!isProductionShotDuration(input.draft.segmentDurationSeconds)) {
    throw new RangeError("Director quick-plan duration must be 5, 10, or 15 seconds.");
  }
  if (input.draft.mode === "REF2VA" && (input.draft.shots.length !== 1 || timelineDuration > 15)) {
    throw new RangeError("Ref2VA supports exactly one 5, 10, or 15-second shot.");
  }
  const source = normalizeProductionState(input.state);
  const output = input.output ?? {};
  let state = updateProductionProject(source, {
    name: input.workflowName,
    productionBibles: {
      characterWardrobeProps: input.draft.characterBible ?? "",
      sceneWorld: input.draft.worldBible ?? "",
      visualStyle: input.draft.visualStyleBible ?? "",
      unstructuredContinuity: input.draft.continuity
    },
    directorSettings: {
      language: input.draft.language,
      mode: input.draft.mode,
      totalDurationSeconds: timelineDuration,
      segmentDurationSeconds: input.draft.segmentDurationSeconds,
      canvas: output.canvas ?? source.project.directorSettings.canvas,
      resolution: output.resolution ?? source.project.directorSettings.resolution,
      seed: output.seed ?? source.project.directorSettings.seed,
      seedPolicy: output.seedPolicy ?? source.project.directorSettings.seedPolicy,
      sampling: output.sampling ?? source.project.directorSettings.sampling
    }
  });

  let defaultScene = findDefaultScene(state);
  if (defaultScene === null) {
    state = upsertProductionScene(state, {
      title: input.draft.language === "zh" ? "默认场景" : "Default Scene",
      identityKey: "director-p1-default-scene",
      order: 0
    });
    defaultScene = findDefaultScene(state);
  }
  if (defaultScene === null) throw new Error("P1 default scene could not be established.");

  const allLocations = state.scenes.flatMap((scene) => scene.shots.map((shot) => ({ scene, shot })));
  const locationsById = new Map(allLocations.map((location) => [location.shot.id, location]));
  const locationsByTiming = new Map<string, { readonly scene: ProductionScene; readonly shot: ProductionShot }>();
  for (const location of [...allLocations].sort((left, right) => Number(left.shot.archived) - Number(right.shot.archived))) {
    if (!locationsByTiming.has(shotTimingKey(location.shot))) {
      locationsByTiming.set(shotTimingKey(location.shot), location);
    }
  }

  const currentShotIds = new Set<string>();
  const synchronizedShots: DirectorShot[] = [];
  for (const [index, draftShot] of input.draft.shots.entries()) {
    const byId = draftShot.id === undefined ? undefined : locationsById.get(draftShot.id);
    const byTiming = locationsByTiming.get(shotTimingKey(draftShot));
    const existing = byId ?? (byTiming !== undefined && !currentShotIds.has(byTiming.shot.id) ? byTiming : undefined);
    const targetSceneId = existing?.scene.id ?? defaultScene.id;
    const requestedId = existing?.shot.id ?? draftShot.id;
    state = assignShotToScene(state, targetSceneId, {
      ...(requestedId === undefined ? {} : { id: requestedId }),
      identityKey: `${input.draft.mode}:${draftShot.startSeconds}:${draftShot.durationSeconds}`,
      startSeconds: draftShot.startSeconds,
      durationSeconds: draftShot.durationSeconds,
      description: draftShot.description,
      cameraLanguage: draftShot.cameraLanguage ?? "",
      soundCue: draftShot.soundCue ?? "",
      transitionNote: draftShot.transitionNote ?? ""
    });
    const targetScene = state.scenes.find((scene) => scene.id === targetSceneId);
    const resolvedShot = requestedId === undefined
      ? targetScene?.shots.find((shot) => shot.startSeconds === draftShot.startSeconds
          && shot.durationSeconds === draftShot.durationSeconds && !currentShotIds.has(shot.id))
      : productionShotLocation(state, requestedId)?.shot;
    if (resolvedShot === undefined) throw new Error(`P1 shot ${index + 1} could not be synchronized.`);
    currentShotIds.add(resolvedShot.id);
    synchronizedShots.push({
      id: resolvedShot.id,
      startSeconds: draftShot.startSeconds,
      durationSeconds: draftShot.durationSeconds,
      description: draftShot.description,
      cameraLanguage: draftShot.cameraLanguage ?? "",
      soundCue: draftShot.soundCue ?? "",
      transitionNote: draftShot.transitionNote ?? ""
    });
  }

  state = activateCurrentShots(state, currentShotIds, defaultScene.id);
  return immutableJsonCopy({
    state,
    draft: { ...input.draft, shots: synchronizedShots },
    defaultSceneId: defaultScene.id
  });
}

function entityLiteralParagraphs(entity: ProductionEntity): readonly string[] {
  const values = [entity.name, entity.notes];
  for (const [key, value] of Object.entries(entity.attributes).sort(([left], [right]) => left.localeCompare(right))) {
    if (key.trim().length > 0 && value.trim().length > 0) values.push(`${key}: ${value}`);
  }
  return values.map((value) => value.trim()).filter(Boolean);
}

function appendUniqueParagraphs(base: string, additions: readonly string[]): string {
  const paragraphs = base.trim().length === 0 ? [] : [base.trim()];
  const seen = new Set(paragraphs);
  for (const raw of additions) {
    const value = raw.trim();
    if (value.length === 0 || seen.has(value)) continue;
    seen.add(value);
    paragraphs.push(value);
  }
  return paragraphs.join("\n\n");
}

function sceneTitlePromptParagraph(title: string, language: DirectorDraft["language"]): string {
  const value = title.trim();
  if (value.length === 0 || value === "默认场景" || value === "Default Scene") return "";
  return language === "zh" ? `场景: ${value}` : `scene: ${value}`;
}

/**
 * Produces the compiler-facing draft. This is a mechanical concatenation only:
 * no translation, rewriting, classification, planning, generation, or I/O.
 */
export function decorateDirectorDraftForProduction(
  stateInput: DirectorProductionState,
  draftInput: DirectorDraft
): DirectorP1DecorationResult {
  const state = normalizeProductionState(stateInput);
  const activeEntities = new Map(state.entities
    .filter((entity) => !entity.archived)
    .map((entity) => [entity.id, entity]));
  const decoratedShots: DirectorShot[] = draftInput.shots.map((draftShot) => {
    const location = draftShot.id === undefined
      ? state.scenes.flatMap((scene) => scene.shots.map((shot) => ({ scene, shot })))
          .find(({ shot }) => !shot.archived && shotTimingKey(shot) === shotTimingKey(draftShot))
      : productionShotLocation(state, draftShot.id) ?? undefined;
    if (location === undefined || location.shot.archived || location.scene.archived) return { ...draftShot };
    const additions: string[] = [
      sceneTitlePromptParagraph(location.scene.title, draftInput.language),
      location.scene.notes
    ];
    for (const entityId of location.shot.entityIds) {
      const entity = activeEntities.get(entityId);
      if (entity !== undefined) additions.push(...entityLiteralParagraphs(entity));
    }
    additions.push(...resolveShotContinuity(state, location.shot.id)
      .map((cell) => cell.value)
      .filter((value) => value.trim().length > 0));
    return {
      ...draftShot,
      id: location.shot.id,
      description: appendUniqueParagraphs(draftShot.description, additions)
    };
  });
  const draft = immutableJsonCopy({ ...draftInput, shots: decoratedShots });
  const effectiveFingerprints: Record<string, string> = {};
  draft.shots.forEach((shot, index) => {
    const key = shot.id ?? `timeline-${index}-${shot.startSeconds}-${shot.durationSeconds}`;
    effectiveFingerprints[key] = directorShotFingerprint(draft, shot);
  });
  return immutableJsonCopy({ draft, effectiveFingerprints });
}

function normalizedFingerprintRecord(value: unknown): Readonly<Record<string, string>> {
  const record = asRecord(value);
  const result: Record<string, string> = {};
  if (record !== null) {
    for (const key of Object.keys(record).sort()) {
      if (typeof record[key] === "string") result[key] = record[key];
    }
  }
  return immutableJsonCopy(result);
}

export function buildDirectorV7Payload(input: {
  readonly workflowName: string;
  readonly draft: DirectorDraft;
  readonly state: DirectorProductionState;
  readonly lastCompiledShotFingerprints?: Readonly<Record<string, string>>;
  readonly passthrough?: Readonly<Record<string, unknown>>;
}): DirectorP1V7Payload {
  const passthrough = { ...(input.passthrough ?? {}) };
  delete passthrough.version;
  delete passthrough.workflowName;
  delete passthrough.draft;
  delete passthrough.productionState;
  delete passthrough.lastCompiledShotFingerprints;
  return immutableJsonCopy({
    ...passthrough,
    version: 7 as const,
    workflowName: input.workflowName,
    draft: input.draft,
    productionState: normalizeProductionState(input.state),
    lastCompiledShotFingerprints: normalizedFingerprintRecord(input.lastCompiledShotFingerprints)
  });
}

/** @deprecated Kept to avoid a save-call race during the v7 UI rollout; it emits v7. */
export const buildDirectorV6Payload: typeof buildDirectorV7Payload = buildDirectorV7Payload;

/** Safe, read-only restoration. The caller must explicitly persist a later v7 payload. */
export function restoreDirectorPayload(value: unknown): DirectorP1RestoreResult {
  try {
    const root = asRecord(value);
    if (root === null) return immutableJsonCopy({ ok: false, error: "专业导播草稿不是对象。", mayWriteBack: false });
    const draft = directorDraftFromUnknown(root.draft);
    if (draft === null) return immutableJsonCopy({ ok: false, error: "专业导播草稿缺少有效的镜头数据。", mayWriteBack: false });
    const workflowName = text(root.workflowName);
    if (root.version === 7) {
      const production = asRecord(root.productionState);
      if (production === null || production.schemaVersion !== 2) {
        return immutableJsonCopy({ ok: false, error: "专业导播 v7 制作数据无效。", mayWriteBack: false });
      }
      const synchronized = syncDirectorProductionState({
        state: normalizeProductionState(production),
        workflowName,
        draft
      });
      return immutableJsonCopy({
        ok: true,
        sourceVersion: 7,
        workflowName,
        draft: synchronized.draft,
        state: synchronized.state,
        lastCompiledShotFingerprints: normalizedFingerprintRecord(root.lastCompiledShotFingerprints),
        warnings: [],
        mayWriteBack: false
      });
    }
    if (root.version === 6) {
      const production = asRecord(root.productionState);
      if (production === null || production.schemaVersion !== 1) {
        return immutableJsonCopy({ ok: false, error: "专业导播 v6 制作数据无效。", mayWriteBack: false });
      }
      const synchronized = syncDirectorProductionState({
        state: migrateProductionStateV1ToV2(production),
        workflowName,
        draft
      });
      return immutableJsonCopy({
        ok: true,
        sourceVersion: 6,
        workflowName,
        draft: synchronized.draft,
        state: synchronized.state,
        lastCompiledShotFingerprints: normalizedFingerprintRecord(root.lastCompiledShotFingerprints),
        warnings: ["已将专业导播 v6 制作数据确定性迁移为 v7；原始草稿未被自动覆盖。"],
        mayWriteBack: false
      });
    }
    if (root.version === 5) {
      const migrated = migrateDirectorV5Draft(root);
      if (migrated.directorSnapshot.length === 0) {
        return immutableJsonCopy({ ok: false, error: "专业导播 v5 草稿迁移失败。", mayWriteBack: false });
      }
      const synchronized = syncDirectorProductionState({ state: migrated.state, workflowName, draft });
      return immutableJsonCopy({
        ok: true,
        sourceVersion: 5,
        workflowName,
        draft: synchronized.draft,
        state: synchronized.state,
        lastCompiledShotFingerprints: {},
        warnings: migrated.warnings,
        mayWriteBack: false
      });
    }
    return immutableJsonCopy({ ok: false, error: "仅支持专业导播 v5、v6 或 v7 草稿。", mayWriteBack: false });
  } catch {
    return immutableJsonCopy({ ok: false, error: "专业导播草稿恢复失败，原始数据未被改写。", mayWriteBack: false });
  }
}

export function captureDirectorP1Submission(input: DirectorP1SyncInput): DirectorP1Submission {
  const synchronized = syncDirectorProductionState(input);
  const decorated = decorateDirectorDraftForProduction(synchronized.state, synchronized.draft);
  const snapshotValue = {
    schemaVersion: 2 as const,
    workflowName: input.workflowName,
    draft: synchronized.draft,
    effectiveFingerprints: decorated.effectiveFingerprints
  };
  return immutableJsonCopy({
    ...snapshotValue,
    effectiveDraft: decorated.draft,
    productionState: synchronized.state,
    directorSnapshot: canonicalProductionJson(snapshotValue)
  });
}

function mergedRevisionState(
  currentState: DirectorProductionState,
  revisionState: DirectorProductionState,
  revision: ProductionRevision
): DirectorProductionState {
  const revisions = [...currentState.revisions];
  for (const candidate of revisionState.revisions) {
    if (!revisions.some((existing) => existing.id === candidate.id)) revisions.push(candidate);
  }
  return normalizeProductionState({
    ...currentState,
    revisions,
    activeRevisionId: revision.id
  });
}

/** Creates one Revision only after a successful compile, from the captured submission snapshot. */
export function commitDirectorP1Compilation(input: {
  readonly currentState: DirectorProductionState;
  readonly submission: DirectorP1Submission;
  readonly succeeded: boolean;
  readonly createdAt?: string;
}): { readonly state: DirectorProductionState; readonly revision: ProductionRevision | null } {
  if (!input.succeeded) return immutableJsonCopy({ state: input.currentState, revision: null });
  const created = createProductionRevision(input.submission.productionState, {
    directorSnapshot: input.submission.directorSnapshot,
    ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt })
  });
  return immutableJsonCopy({
    state: mergedRevisionState(input.currentState, created.state, created.revision),
    revision: created.revision
  });
}

/** Restores a revision as an editable work copy; it never compiles or runs it. */
export function restoreDirectorP1Revision(
  currentState: DirectorProductionState,
  revisionId: string
): DirectorP1RevisionRestoreResult {
  try {
    const revision = currentState.revisions.find((candidate) => candidate.id === revisionId);
    if (revision === undefined) throw new RangeError("Unknown production revision.");
    const snapshot = asRecord(JSON.parse(revision.directorSnapshot));
    const draft = directorDraftFromUnknown(snapshot?.draft);
    if (snapshot === null || draft === null || (snapshot.schemaVersion !== 1 && snapshot.schemaVersion !== 2)) {
      throw new TypeError("Invalid Director revision snapshot.");
    }
    const restored = restoreProductionRevision(currentState, revisionId);
    const synchronized = syncDirectorProductionState({
      state: restored,
      workflowName: text(snapshot.workflowName),
      draft
    });
    return immutableJsonCopy({
      ok: true,
      workflowName: text(snapshot.workflowName),
      draft: synchronized.draft,
      state: synchronized.state,
      effectiveFingerprints: normalizedFingerprintRecord(snapshot.effectiveFingerprints)
    });
  } catch {
    return immutableJsonCopy({
      ok: false,
      error: "历史版本无法恢复，当前工作副本保持不变。",
      state: currentState
    });
  }
}
