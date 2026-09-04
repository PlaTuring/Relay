import {
  RELAY_CONTINUITY_FIELDS,
  RELAY_SHOT_DURATIONS,
  canonicalRelayProjectJson,
  normalizeRelayProject,
  type JsonValue,
  type RelayContinuityField,
  type RelayContinuityState,
  type RelayContinuityValue,
  type RelayProjectAsset,
  type RelayProjectDocument,
  type RelayProjectScene,
  type RelayProjectShot,
  type RelayQuickProjectState,
  type RelayShotDurationSeconds,
  type RelayShotTransition,
  type RelayTransitionType
} from "../shared/project-domain.js";

import { projectContentHash } from "./project-state-engine.js";

export const PROFESSIONAL_DIRECTOR_STATE_VERSION = 1 as const;

export type DirectorStatePhase = "start" | "end";
export type DirectorIssueSeverity = "error" | "warning" | "information";
export type DirectorCompileDisposition = "compile" | "record_only";

export interface ProfessionalTake {
  readonly takeId: string;
  readonly shotId: string;
  readonly assetId: string;
  readonly name: string;
  readonly notes: string;
  readonly createdAt: string;
}

export interface ProfessionalDirectorMetadata {
  readonly schemaVersion: typeof PROFESSIONAL_DIRECTOR_STATE_VERSION;
  /** Existing legacy payload is retained byte-for-byte as JSON data. */
  readonly preservedLegacyDirectorState: JsonValue | null;
  readonly projectDefaults: Readonly<Record<RelayContinuityField, string>>;
  readonly takes: readonly ProfessionalTake[];
}

export interface ResolvedDirectorStateField {
  readonly field: RelayContinuityField;
  readonly value: string;
  readonly locked: boolean;
  readonly inherited: boolean;
  readonly source:
    | "project_default"
    | "previous_shot_end"
    | "shot_start_override"
    | "shot_start"
    | "shot_end_override"
    | "empty";
  readonly sourceShotId: string | null;
}

export interface ResolvedDirectorShotState {
  readonly shotId: string;
  readonly start: Readonly<Record<RelayContinuityField, ResolvedDirectorStateField>>;
  readonly end: Readonly<Record<RelayContinuityField, ResolvedDirectorStateField>>;
}

export interface DirectorShotContinuityPromptContext {
  readonly shotId: string;
  /** Deterministic, resolved continuity text that may be appended to this shot's prompt. */
  readonly promptContext: string;
}

export interface DirectorContinuityIssue {
  readonly issueId: string;
  readonly severity: DirectorIssueSeverity;
  readonly code:
    | "tail_continuation_mismatch"
    | "transition_asset_missing"
    | "transition_asset_unavailable"
    | "record_only_transition";
  readonly sceneId: string;
  readonly shotId: string;
  readonly field: RelayContinuityField | "transition";
  readonly locator: string;
  readonly message: string;
}

export interface CompiledDirectorTransition {
  readonly previousShotId: string;
  readonly shotId: string;
  readonly type: RelayTransitionType;
  readonly disposition: DirectorCompileDisposition;
  readonly connectPreviousTailFrameToCurrentFirstFrame: boolean;
  readonly assetId: string | null;
  readonly inheritedFields: readonly RelayContinuityField[];
  readonly intent: string;
}

export interface PromoteQuickProjectInput {
  readonly project: RelayProjectDocument;
  readonly updatedAt: string;
}

export interface AddDirectorSceneInput {
  readonly sceneId: string;
  readonly name: string;
  readonly notes?: string;
  readonly updatedAt: string;
}

export interface AddDirectorShotInput {
  readonly sceneId: string;
  readonly shotId: string;
  readonly name: string;
  readonly durationSeconds: RelayShotDurationSeconds;
  readonly prompt?: string;
  readonly updatedAt: string;
}

const COMPILED_TRANSITIONS = new Set<RelayTransitionType>(["tail_frame_continuation", "hard_cut"]);
const SHA256 = /^[a-f0-9]{64}$/u;

function emptyDefaults(): Record<RelayContinuityField, string> {
  return {
    subject: "",
    wardrobeAppearance: "",
    poseAction: "",
    framePosition: "",
    heldProps: "",
    sceneWeatherTime: "",
    cameraPositionMovement: "",
    lighting: "",
    audioState: ""
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function immutable<T>(value: T): T {
  const copy = JSON.parse(canonicalRelayProjectJson(value)) as T;
  const freeze = (candidate: unknown, seen = new Set<object>()): void => {
    if (candidate === null || typeof candidate !== "object" || seen.has(candidate)) return;
    seen.add(candidate);
    for (const child of Object.values(candidate as Record<string, unknown>)) freeze(child, seen);
    Object.freeze(candidate);
  };
  freeze(copy);
  return copy;
}

function metadataJson(metadata: ProfessionalDirectorMetadata): JsonValue {
  return JSON.parse(canonicalRelayProjectJson(metadata)) as JsonValue;
}

function directorMetadataId(prefix: "scene" | "shot" | "take", identity: unknown): string {
  return `${prefix}-${projectContentHash(identity).slice(0, 24)}`;
}

function isDuration(value: unknown): value is RelayShotDurationSeconds {
  return (RELAY_SHOT_DURATIONS as readonly unknown[]).includes(value);
}

function assertDuration(value: unknown): asserts value is RelayShotDurationSeconds {
  if (!isDuration(value)) throw new TypeError("Shot duration must be exactly 5, 10, or 15 seconds.");
}

function professionalMetadata(value: JsonValue | null): ProfessionalDirectorMetadata {
  const source = record(value);
  if (source?.schemaVersion === PROFESSIONAL_DIRECTOR_STATE_VERSION
    && Object.prototype.hasOwnProperty.call(source, "preservedLegacyDirectorState")) {
    const defaults = emptyDefaults();
    const rawDefaults = record(source.projectDefaults);
    for (const field of RELAY_CONTINUITY_FIELDS) defaults[field] = text(rawDefaults?.[field]);
    const takes = Array.isArray(source.takes)
      ? source.takes.flatMap((entry): ProfessionalTake[] => {
        const item = record(entry);
        if (item === null) return [];
        return [{
          takeId: text(item.takeId),
          shotId: text(item.shotId),
          assetId: text(item.assetId),
          name: text(item.name),
          notes: text(item.notes),
          createdAt: text(item.createdAt)
        }];
      })
      : [];
    const preserved = source.preservedLegacyDirectorState;
    return immutable({
      schemaVersion: PROFESSIONAL_DIRECTOR_STATE_VERSION,
      preservedLegacyDirectorState: preserved === undefined ? null : preserved as JsonValue,
      projectDefaults: defaults,
      takes
    });
  }
  return immutable({
    schemaVersion: PROFESSIONAL_DIRECTOR_STATE_VERSION,
    preservedLegacyDirectorState: value,
    projectDefaults: emptyDefaults(),
    takes: []
  });
}

export function readProfessionalDirectorMetadata(project: RelayProjectDocument): ProfessionalDirectorMetadata {
  return professionalMetadata(project.professional.directorState);
}

function replaceProject(
  project: RelayProjectDocument,
  patch: Partial<RelayProjectDocument>,
  updatedAt?: string
): RelayProjectDocument {
  return normalizeRelayProject({
    ...project,
    ...patch,
    updatedAt: updatedAt ?? project.updatedAt
  });
}

function replaceMetadata(
  project: RelayProjectDocument,
  metadata: ProfessionalDirectorMetadata,
  updatedAt?: string
): RelayProjectDocument {
  return replaceProject(project, {
    professional: {
      ...project.professional,
      directorState: metadataJson(metadata)
    }
  }, updatedAt);
}

function orderedScenes(project: RelayProjectDocument): readonly RelayProjectScene[] {
  return project.scenes.filter((scene) => !scene.archived)
    .sort((left, right) => left.order - right.order || left.sceneId.localeCompare(right.sceneId));
}

export function orderedDirectorShots(project: RelayProjectDocument): readonly {
  readonly scene: RelayProjectScene;
  readonly shot: RelayProjectShot;
}[] {
  const shotById = new Map(project.shots.filter((shot) => !shot.archived).map((shot) => [shot.shotId, shot]));
  const result: { scene: RelayProjectScene; shot: RelayProjectShot }[] = [];
  for (const scene of orderedScenes(project)) {
    for (const shotId of scene.shotIds) {
      const shot = shotById.get(shotId);
      if (shot !== undefined) result.push({ scene, shot });
    }
  }
  return result;
}

function assertKnownScene(project: RelayProjectDocument, sceneId: string): RelayProjectScene {
  const scene = project.scenes.find((candidate) => candidate.sceneId === sceneId && !candidate.archived);
  if (scene === undefined) throw new TypeError(`Unknown active scene: ${sceneId}`);
  return scene;
}

function findShot(project: RelayProjectDocument, shotId: string): { scene: RelayProjectScene; shot: RelayProjectShot } {
  const shot = project.shots.find((candidate) => candidate.shotId === shotId && !candidate.archived);
  if (shot === undefined) throw new TypeError(`Unknown active shot: ${shotId}`);
  const scene = project.scenes.find((candidate) => !candidate.archived && candidate.shotIds.includes(shotId));
  if (scene === undefined) throw new TypeError(`Active shot is not assigned to a scene: ${shotId}`);
  return { scene, shot };
}

function normalizeOrders(project: RelayProjectDocument, patch: {
  readonly scenes?: readonly RelayProjectScene[];
  readonly shots?: readonly RelayProjectShot[];
  readonly updatedAt?: string;
}): RelayProjectDocument {
  const scenes = patch.scenes ?? project.scenes;
  const shots = patch.shots ?? project.shots;
  const shotOrder = new Map<string, number>();
  let globalOrder = 0;
  const normalizedScenes = scenes.map((scene) => {
    if (scene.archived) return scene;
    const orderedShotIds = scene.shotIds.filter((shotId) => shots.some((shot) => shot.shotId === shotId && !shot.archived));
    for (const shotId of orderedShotIds) shotOrder.set(shotId, globalOrder++);
    return { ...scene, shotIds: orderedShotIds };
  }).map((scene) => scene.archived ? scene : {
    ...scene,
    order: scenes.filter((candidate) => !candidate.archived)
      .sort((left, right) => left.order - right.order || left.sceneId.localeCompare(right.sceneId))
      .findIndex((candidate) => candidate.sceneId === scene.sceneId)
  });
  const normalizedShots = shots.map((shot) => shot.archived ? shot : {
    ...shot,
    order: shotOrder.get(shot.shotId) ?? shot.order
  });
  const ordered = replaceProject(project, { scenes: normalizedScenes, shots: normalizedShots }, patch.updatedAt);
  const activeShotIds = orderedDirectorShots(ordered).map((entry) => entry.shot.shotId);
  const firstShotId = activeShotIds[0] ?? null;
  const activeSet = new Set(activeShotIds);
  return replaceProject(ordered, {
    shots: ordered.shots.map((shot) => {
      if (!activeSet.has(shot.shotId)) return shot;
      if (shot.shotId === firstShotId) return { ...shot, transitionFromPrevious: null };
      return shot.transitionFromPrevious === null
        ? { ...shot, transitionFromPrevious: defaultTransition() }
        : shot;
    })
  }, patch.updatedAt);
}

function defaultTransition(): RelayShotTransition {
  return {
    type: "tail_frame_continuation",
    capability: "proven",
    inheritedFields: [...RELAY_CONTINUITY_FIELDS],
    assetId: null,
    customIntent: ""
  };
}

function quickPromotionSegments(quick: RelayQuickProjectState): readonly RelayShotDurationSeconds[] {
  if (quick.mode === "REF2VA" && quick.totalDurationSeconds > 15) {
    throw new TypeError("Ref2VA is certified only for a single 5–15 second shot.");
  }
  assertDuration(quick.segmentDurationSeconds);
  if (quick.totalDurationSeconds < quick.segmentDurationSeconds
    || quick.totalDurationSeconds % quick.segmentDurationSeconds !== 0) {
    throw new TypeError("Quick-project duration must divide exactly into 5, 10, or 15 second shots.");
  }
  return Object.freeze(Array.from(
    { length: quick.totalDurationSeconds / quick.segmentDurationSeconds },
    () => quick.segmentDurationSeconds
  ));
}

/**
 * Creates the professional timeline without creative planning. Quick Create
 * remains available as an immutable source snapshot, but its prompt is not a
 * default for Director shots: the two editors own independent prompt data.
 */
export function promoteQuickProjectToProfessional(input: PromoteQuickProjectInput): RelayProjectDocument {
  const project = normalizeRelayProject(input.project);
  if (project.professional.promotedQuickState !== null) {
    return replaceProject(project, { editorMode: "professional" }, input.updatedAt);
  }
  const existing = orderedDirectorShots(project);
  if (existing.length > 0) {
    const first = existing[0];
    if (first === undefined) throw new TypeError("Professional project contains an invalid active timeline.");
    const requestedActive = existing.find((entry) => entry.shot.shotId === project.professional.activeShotId) ?? first;
    return replaceProject(project, {
      editorMode: "professional",
      professional: {
        directorState: metadataJson(professionalMetadata(project.professional.directorState)),
        promotedQuickState: project.quick,
        activeSceneId: requestedActive.scene.sceneId,
        activeShotId: requestedActive.shot.shotId
      }
    }, input.updatedAt);
  }
  const durations = quickPromotionSegments(project.quick);
  const sceneId = directorMetadataId("scene", { projectId: project.projectId, purpose: "quick-promotion" });
  const shots = durations.map((durationSeconds, index): RelayProjectShot => ({
    shotId: directorMetadataId("shot", { projectId: project.projectId, purpose: "quick-promotion", index }),
    name: `镜头 ${index + 1}`,
    order: index,
    durationSeconds,
    prompt: "",
    camera: "",
    sound: "",
    startState: {},
    endState: {},
    transitionFromPrevious: index === 0 ? null : defaultTransition(),
    archived: false
  }));
  const scene: RelayProjectScene = {
    sceneId,
    name: "场景 1",
    order: 0,
    notes: "",
    shotIds: shots.map((shot) => shot.shotId),
    archived: false
  };
  const metadata = professionalMetadata(project.professional.directorState);
  return replaceProject(project, {
    editorMode: "professional",
    professional: {
      directorState: metadataJson(metadata),
      promotedQuickState: project.quick,
      activeSceneId: sceneId,
      activeShotId: shots[0]?.shotId ?? null
    },
    scenes: [...project.scenes, scene],
    shots: [...project.shots, ...shots]
  }, input.updatedAt);
}

export function addDirectorScene(project: RelayProjectDocument, input: AddDirectorSceneInput): RelayProjectDocument {
  if (project.scenes.some((scene) => scene.sceneId === input.sceneId)) throw new TypeError("Scene ID already exists.");
  const scene: RelayProjectScene = {
    sceneId: input.sceneId,
    name: input.name,
    order: orderedScenes(project).length,
    notes: input.notes ?? "",
    shotIds: [],
    archived: false
  };
  const next = replaceProject(project, {
    scenes: [...project.scenes, scene],
    professional: {
      ...project.professional,
      activeSceneId: input.sceneId,
      activeShotId: null
    }
  }, input.updatedAt);
  return normalizeOrders(next, { updatedAt: input.updatedAt });
}

export function addDirectorShot(project: RelayProjectDocument, input: AddDirectorShotInput): RelayProjectDocument {
  assertDuration(input.durationSeconds);
  const scene = assertKnownScene(project, input.sceneId);
  if (project.shots.some((shot) => shot.shotId === input.shotId)) throw new TypeError("Shot ID already exists.");
  const hasPrevious = orderedDirectorShots(project).length > 0;
  const shot: RelayProjectShot = {
    shotId: input.shotId,
    name: input.name,
    order: project.shots.filter((candidate) => !candidate.archived).length,
    durationSeconds: input.durationSeconds,
    prompt: input.prompt ?? "",
    camera: "",
    sound: "",
    startState: {},
    endState: {},
    transitionFromPrevious: hasPrevious ? defaultTransition() : null,
    archived: false
  };
  const scenes = project.scenes.map((candidate) => candidate.sceneId === scene.sceneId
    ? { ...candidate, shotIds: [...candidate.shotIds, shot.shotId] }
    : candidate);
  const next = replaceProject(project, {
    scenes,
    shots: [...project.shots, shot],
    professional: {
      ...project.professional,
      activeSceneId: scene.sceneId,
      activeShotId: shot.shotId
    }
  }, input.updatedAt);
  return normalizeOrders(next, { updatedAt: input.updatedAt });
}

export function duplicateDirectorShot(project: RelayProjectDocument, input: {
  readonly shotId: string;
  readonly duplicateShotId: string;
  readonly updatedAt: string;
}): RelayProjectDocument {
  const { scene, shot } = findShot(project, input.shotId);
  if (project.shots.some((candidate) => candidate.shotId === input.duplicateShotId)) {
    throw new TypeError("Duplicate shot ID already exists.");
  }
  const sourceIndex = scene.shotIds.indexOf(shot.shotId);
  const duplicate: RelayProjectShot = {
    ...shot,
    shotId: input.duplicateShotId,
    name: shot.name ? `${shot.name} 副本` : "镜头副本",
    order: shot.order + 1,
    transitionFromPrevious: defaultTransition()
  };
  const ids = [...scene.shotIds];
  ids.splice(sourceIndex + 1, 0, duplicate.shotId);
  const scenes = project.scenes.map((candidate) => candidate.sceneId === scene.sceneId
    ? { ...candidate, shotIds: ids }
    : candidate);
  const next = replaceProject(project, {
    scenes,
    shots: [...project.shots, duplicate],
    professional: {
      ...project.professional,
      activeSceneId: scene.sceneId,
      activeShotId: duplicate.shotId
    }
  }, input.updatedAt);
  return normalizeOrders(next, { updatedAt: input.updatedAt });
}

export function moveDirectorShot(project: RelayProjectDocument, input: {
  readonly shotId: string;
  readonly targetSceneId: string;
  readonly targetIndex: number;
  readonly updatedAt: string;
}): RelayProjectDocument {
  const { shot } = findShot(project, input.shotId);
  const target = assertKnownScene(project, input.targetSceneId);
  if (!Number.isSafeInteger(input.targetIndex) || input.targetIndex < 0 || input.targetIndex > target.shotIds.length) {
    throw new TypeError("Shot target index is outside the target scene.");
  }
  const scenesWithoutShot = project.scenes.map((scene) => ({
    ...scene,
    shotIds: scene.shotIds.filter((shotId) => shotId !== shot.shotId)
  }));
  const scenes = scenesWithoutShot.map((scene) => {
    if (scene.sceneId !== target.sceneId) return scene;
    const ids = [...scene.shotIds];
    ids.splice(Math.min(input.targetIndex, ids.length), 0, shot.shotId);
    return { ...scene, shotIds: ids };
  });
  const next = replaceProject(project, {
    scenes,
    professional: {
      ...project.professional,
      activeSceneId: target.sceneId,
      activeShotId: shot.shotId
    }
  }, input.updatedAt);
  return normalizeOrders(next, { updatedAt: input.updatedAt });
}

export function setDirectorShotDurations(project: RelayProjectDocument, input: {
  readonly shotIds: readonly string[];
  readonly durationSeconds: RelayShotDurationSeconds;
  readonly updatedAt: string;
}): RelayProjectDocument {
  assertDuration(input.durationSeconds);
  const requested = new Set(input.shotIds);
  for (const shotId of requested) findShot(project, shotId);
  return replaceProject(project, {
    shots: project.shots.map((shot) => requested.has(shot.shotId)
      ? { ...shot, durationSeconds: input.durationSeconds }
      : shot)
  }, input.updatedAt);
}

export function directorTotalDuration(project: RelayProjectDocument): number {
  return orderedDirectorShots(project).reduce((total, entry) => total + entry.shot.durationSeconds, 0);
}

export function focusDirectorShot(project: RelayProjectDocument, shotId: string, updatedAt?: string): RelayProjectDocument {
  const { scene } = findShot(project, shotId);
  return replaceProject(project, {
    professional: {
      ...project.professional,
      activeSceneId: scene.sceneId,
      activeShotId: shotId
    }
  }, updatedAt);
}

export function setProjectContinuityDefault(project: RelayProjectDocument, input: {
  readonly field: RelayContinuityField;
  readonly value: string;
  readonly updatedAt: string;
}): RelayProjectDocument {
  const metadata = professionalMetadata(project.professional.directorState);
  return replaceMetadata(project, {
    ...metadata,
    projectDefaults: { ...metadata.projectDefaults, [input.field]: input.value }
  }, input.updatedAt);
}

function replaceShotState(
  project: RelayProjectDocument,
  shotId: string,
  phase: DirectorStatePhase,
  state: RelayContinuityState,
  updatedAt: string
): RelayProjectDocument {
  findShot(project, shotId);
  return replaceProject(project, {
    shots: project.shots.map((shot) => shot.shotId === shotId
      ? { ...shot, [phase === "start" ? "startState" : "endState"]: state }
      : shot)
  }, updatedAt);
}

function stateLayer(shot: RelayProjectShot, phase: DirectorStatePhase): RelayContinuityState {
  return phase === "start" ? shot.startState : shot.endState;
}

export function setDirectorStateOverride(project: RelayProjectDocument, input: {
  readonly shotId: string;
  readonly phase: DirectorStatePhase;
  readonly field: RelayContinuityField;
  readonly value: string;
  readonly updatedAt: string;
}): RelayProjectDocument {
  const { shot } = findShot(project, input.shotId);
  const layer = stateLayer(shot, input.phase);
  if (layer[input.field]?.locked === true) throw new TypeError("Unlock the continuity field before editing it.");
  return replaceShotState(project, input.shotId, input.phase, {
    ...layer,
    [input.field]: { mode: "override", value: input.value, locked: false }
  }, input.updatedAt);
}

export function restoreDirectorStateInheritance(project: RelayProjectDocument, input: {
  readonly shotId: string;
  readonly phase: DirectorStatePhase;
  readonly field: RelayContinuityField;
  readonly updatedAt: string;
}): RelayProjectDocument {
  const { shot } = findShot(project, input.shotId);
  const layer = stateLayer(shot, input.phase);
  if (layer[input.field]?.locked === true) throw new TypeError("Unlock the continuity field before restoring inheritance.");
  const next = { ...layer } as Partial<Record<RelayContinuityField, RelayContinuityValue>>;
  delete next[input.field];
  return replaceShotState(project, input.shotId, input.phase, next, input.updatedAt);
}

export function setDirectorStateLock(project: RelayProjectDocument, input: {
  readonly shotId: string;
  readonly phase: DirectorStatePhase;
  readonly field: RelayContinuityField;
  readonly locked: boolean;
  readonly updatedAt: string;
}): RelayProjectDocument {
  const { shot } = findShot(project, input.shotId);
  const layer = stateLayer(shot, input.phase);
  const existing = layer[input.field] ?? { mode: "inherit" as const, value: "", locked: false };
  const resolvedShot = resolveDirectorShotStates(project).find((candidate) => candidate.shotId === input.shotId);
  if (resolvedShot === undefined) throw new TypeError(`Unknown active shot: ${input.shotId}`);
  const resolvedValue = resolvedShot[input.phase][input.field].value;
  // Locking an inherited value freezes the currently visible literal value.
  // Upstream edits therefore cannot silently alter a locked downstream shot.
  const next: RelayContinuityValue = input.locked && existing.mode === "inherit"
    ? { mode: "override", value: resolvedValue, locked: true }
    : { ...existing, locked: input.locked };
  return replaceShotState(project, input.shotId, input.phase, {
    ...layer,
    [input.field]: next
  }, input.updatedAt);
}

function resolveLayer(
  shotId: string,
  base: Readonly<Record<RelayContinuityField, ResolvedDirectorStateField>>,
  layer: RelayContinuityState,
  phase: DirectorStatePhase
): Readonly<Record<RelayContinuityField, ResolvedDirectorStateField>> {
  const result = {} as Record<RelayContinuityField, ResolvedDirectorStateField>;
  for (const field of RELAY_CONTINUITY_FIELDS) {
    const candidate = layer[field];
    const inherited = base[field];
    if (candidate?.mode === "override") {
      result[field] = {
        field,
        value: candidate.value,
        locked: candidate.locked,
        inherited: false,
        source: phase === "start" ? "shot_start_override" : "shot_end_override",
        sourceShotId: shotId
      };
    } else {
      result[field] = {
        ...inherited,
        field,
        locked: candidate?.locked ?? false,
        inherited: true
      };
    }
  }
  return immutable(result);
}

function projectDefaultResolution(project: RelayProjectDocument): Readonly<Record<RelayContinuityField, ResolvedDirectorStateField>> {
  const defaults = professionalMetadata(project.professional.directorState).projectDefaults;
  const result = {} as Record<RelayContinuityField, ResolvedDirectorStateField>;
  for (const field of RELAY_CONTINUITY_FIELDS) {
    result[field] = {
      field,
      value: defaults[field],
      locked: false,
      inherited: true,
      source: defaults[field] ? "project_default" : "empty",
      sourceShotId: null
    };
  }
  return immutable(result);
}

export function resolveDirectorShotStates(project: RelayProjectDocument): readonly ResolvedDirectorShotState[] {
  const result: ResolvedDirectorShotState[] = [];
  const projectDefaults = projectDefaultResolution(project);
  let previousEnd: Readonly<Record<RelayContinuityField, ResolvedDirectorStateField>> | null = null;
  let previousShotId: string | null = null;
  for (const { shot } of orderedDirectorShots(project)) {
    // A transition's inheritedFields is a production control, not merely a
    // validation preference.  Fields which are not selected restart from the
    // project-level fixed setting (or empty) instead of silently inheriting the
    // prior shot.  Legacy/null transitions retain the original all-field
    // inheritance contract.
    const inheritedFromPrevious = new Set(
      shot.transitionFromPrevious?.inheritedFields ?? RELAY_CONTINUITY_FIELDS
    );
    const startBase = previousEnd === null
      ? projectDefaults
      : immutable(Object.fromEntries(RELAY_CONTINUITY_FIELDS.map((field) => [field, {
        ...(inheritedFromPrevious.has(field) ? previousEnd?.[field] : projectDefaults[field]),
        field,
        inherited: true,
        source: inheritedFromPrevious.has(field)
          ? "previous_shot_end" as const
          : projectDefaults[field].source,
        sourceShotId: inheritedFromPrevious.has(field) ? previousShotId : null
      }])) as Record<RelayContinuityField, ResolvedDirectorStateField>);
    const start = resolveLayer(shot.shotId, startBase, shot.startState, "start");
    const endBase = immutable(Object.fromEntries(RELAY_CONTINUITY_FIELDS.map((field) => [field, {
      ...start[field],
      field,
      inherited: true,
      source: "shot_start" as const,
      sourceShotId: shot.shotId
    }])) as Record<RelayContinuityField, ResolvedDirectorStateField>);
    const end = resolveLayer(shot.shotId, endBase, shot.endState, "end");
    result.push(immutable({ shotId: shot.shotId, start, end }));
    previousEnd = end;
    previousShotId = shot.shotId;
  }
  return Object.freeze(result);
}

const DIRECTOR_CONTINUITY_PROMPT_FIELD_LABELS: Readonly<Record<RelayContinuityField, string>> = Object.freeze({
  subject: "角色/主体 (subject)",
  wardrobeAppearance: "服装外观 (wardrobe appearance)",
  poseAction: "姿态/动作 (pose/action)",
  framePosition: "画面位置 (frame position)",
  heldProps: "持有道具 (held props)",
  sceneWeatherTime: "场景/天气/时间 (scene/weather/time)",
  cameraPositionMovement: "摄影机位置/运动 (camera position/movement)",
  lighting: "光线 (lighting)",
  audioState: "音频状态 (audio state)"
});

function serializeResolvedContinuityPhase(
  heading: string,
  fields: Readonly<Record<RelayContinuityField, ResolvedDirectorStateField>>
): readonly string[] {
  const values = RELAY_CONTINUITY_FIELDS.flatMap((field): string[] => {
    const value = fields[field].value;
    return value.trim() === "" ? [] : [`${DIRECTOR_CONTINUITY_PROMPT_FIELD_LABELS[field]}: ${value}`];
  });
  return values.length === 0 ? [] : [heading, ...values];
}

/**
 * Serializes only the resolved start/end state literals for each active shot.
 *
 * Ordering is inherited from orderedDirectorShots/resolveDirectorShotStates and
 * field ordering is fixed by RELAY_CONTINUITY_FIELDS. The serializer does not
 * add creative content, source paths, assets, or inheritance implementation
 * details. Empty shots remain addressable by shotId with an empty context.
 */
export function serializeDirectorContinuityPromptContexts(
  project: RelayProjectDocument
): readonly DirectorShotContinuityPromptContext[] {
  return Object.freeze(resolveDirectorShotStates(project).map((shotState) => {
    const start = serializeResolvedContinuityPhase(
      "实际开始状态 / Resolved start state",
      shotState.start
    );
    const end = serializeResolvedContinuityPhase(
      "实际结束状态 / Resolved end state",
      shotState.end
    );
    const promptContext = start.length === 0 && end.length === 0
      ? ""
      : [
        "镜头连续性 / Shot continuity",
        `镜头 ID / Shot ID: ${shotState.shotId}`,
        ...start,
        ...end
      ].join("\n");
    return immutable({ shotId: shotState.shotId, promptContext });
  }));
}

export function setDirectorTransition(project: RelayProjectDocument, input: {
  readonly shotId: string;
  readonly type: RelayTransitionType;
  readonly inheritedFields?: readonly RelayContinuityField[];
  readonly assetId?: string | null;
  readonly customIntent?: string;
  readonly updatedAt: string;
}): RelayProjectDocument {
  const ordered = orderedDirectorShots(project);
  const index = ordered.findIndex((entry) => entry.shot.shotId === input.shotId);
  if (index < 0) throw new TypeError(`Unknown active shot: ${input.shotId}`);
  if (index === 0) throw new TypeError("The first active shot cannot have a transition from a previous shot.");
  const inheritedFields = [...new Set(input.inheritedFields ?? RELAY_CONTINUITY_FIELDS)];
  const transition: RelayShotTransition = {
    type: input.type,
    capability: COMPILED_TRANSITIONS.has(input.type) ? "proven" : "intent_only",
    inheritedFields,
    assetId: input.assetId ?? null,
    customIntent: input.customIntent ?? ""
  };
  return replaceProject(project, {
    shots: project.shots.map((shot) => shot.shotId === input.shotId
      ? { ...shot, transitionFromPrevious: transition }
      : shot)
  }, input.updatedAt);
}

function availableRealAsset(project: RelayProjectDocument, assetId: string): RelayProjectAsset | null {
  const asset = project.assets.find((candidate) => candidate.assetId === assetId);
  if (asset === undefined
    || asset.availability !== "available"
    || asset.byteLength <= 0
    || !SHA256.test(asset.sha256)
    || (asset.projectRelativePath === null && asset.externalReferenceId === null)) return null;
  return asset;
}

export function attachDirectorTake(project: RelayProjectDocument, input: {
  readonly takeId: string;
  readonly shotId: string;
  readonly assetId: string;
  readonly name: string;
  readonly notes?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}): RelayProjectDocument {
  findShot(project, input.shotId);
  const asset = availableRealAsset(project, input.assetId);
  if (asset === null) throw new TypeError("A Take must reference an available, inspected local project asset.");
  const metadata = professionalMetadata(project.professional.directorState);
  if (metadata.takes.some((take) => take.takeId === input.takeId)) throw new TypeError("Take ID already exists.");
  return replaceMetadata(project, {
    ...metadata,
    takes: [...metadata.takes, {
      takeId: input.takeId,
      shotId: input.shotId,
      assetId: asset.assetId,
      name: input.name,
      notes: input.notes ?? "",
      createdAt: input.createdAt
    }]
  }, input.updatedAt);
}

export function compileDirectorTransitions(project: RelayProjectDocument): readonly CompiledDirectorTransition[] {
  const ordered = orderedDirectorShots(project);
  return Object.freeze(ordered.slice(1).map((entry, relativeIndex): CompiledDirectorTransition => {
    const previous = ordered[relativeIndex];
    if (previous === undefined) throw new TypeError("Transition sequence is incomplete.");
    const transition = entry.shot.transitionFromPrevious ?? {
      type: "hard_cut" as const,
      capability: "proven" as const,
      inheritedFields: [],
      assetId: null,
      customIntent: ""
    };
    const compiled = COMPILED_TRANSITIONS.has(transition.type) && transition.capability === "proven";
    return immutable({
      previousShotId: previous.shot.shotId,
      shotId: entry.shot.shotId,
      type: transition.type,
      disposition: compiled ? "compile" : "record_only",
      connectPreviousTailFrameToCurrentFirstFrame: compiled && transition.type === "tail_frame_continuation",
      assetId: transition.assetId,
      inheritedFields: transition.inheritedFields,
      intent: transition.customIntent
    });
  }));
}

export function validateDirectorContinuity(project: RelayProjectDocument): readonly DirectorContinuityIssue[] {
  const ordered = orderedDirectorShots(project);
  const resolved = new Map(resolveDirectorShotStates(project).map((entry) => [entry.shotId, entry]));
  const issues: DirectorContinuityIssue[] = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (previous === undefined || current === undefined) continue;
    const transition = current.shot.transitionFromPrevious;
    if (transition === null) continue;
    if (transition.capability !== "proven" || !COMPILED_TRANSITIONS.has(transition.type)) {
      issues.push({
        issueId: `issue-${projectContentHash({ shotId: current.shot.shotId, type: transition.type }).slice(0, 24)}`,
        severity: "information",
        code: "record_only_transition",
        sceneId: current.scene.sceneId,
        shotId: current.shot.shotId,
        field: "transition",
        locator: `shot:${current.shot.shotId}:transition`,
        message: `${transition.type} 仅记录创作意图；当前认证编译器不会生成对应节点。`
      });
      continue;
    }
    if (transition.assetId !== null) {
      const asset = project.assets.find((candidate) => candidate.assetId === transition.assetId);
      if (asset === undefined) {
        issues.push({
          issueId: `issue-${projectContentHash({ shotId: current.shot.shotId, assetId: transition.assetId }).slice(0, 24)}`,
          severity: "error",
          code: "transition_asset_missing",
          sceneId: current.scene.sceneId,
          shotId: current.shot.shotId,
          field: "transition",
          locator: `shot:${current.shot.shotId}:transition:asset`,
          message: "衔接引用的项目素材不存在。"
        });
      } else if (availableRealAsset(project, asset.assetId) === null) {
        issues.push({
          issueId: `issue-${projectContentHash({ shotId: current.shot.shotId, assetId: asset.assetId, state: asset.availability }).slice(0, 24)}`,
          severity: "error",
          code: "transition_asset_unavailable",
          sceneId: current.scene.sceneId,
          shotId: current.shot.shotId,
          field: "transition",
          locator: `shot:${current.shot.shotId}:transition:asset`,
          message: `衔接素材当前状态为 ${asset.availability}，不能进入工作流。`
        });
      }
    }
    if (transition.type !== "tail_frame_continuation") continue;
    const previousResolved = resolved.get(previous.shot.shotId);
    const currentResolved = resolved.get(current.shot.shotId);
    if (previousResolved === undefined || currentResolved === undefined) continue;
    for (const field of transition.inheritedFields) {
      if (previousResolved.end[field].value !== currentResolved.start[field].value) {
        issues.push({
          issueId: `issue-${projectContentHash({ shotId: current.shot.shotId, field, code: "tail" }).slice(0, 24)}`,
          severity: "warning",
          code: "tail_continuation_mismatch",
          sceneId: current.scene.sceneId,
          shotId: current.shot.shotId,
          field,
          locator: `shot:${current.shot.shotId}:startState:${field}`,
          message: `尾帧延续要求“${field}”继承上一镜头结束状态，但当前镜头存在不同覆盖值。`
        });
      }
    }
  }
  return Object.freeze(issues.map((issue) => immutable(issue)));
}

export function effectiveDirectorShotPrompt(project: RelayProjectDocument, shotId: string): string {
  const { shot } = findShot(project, shotId);
  // Director shots never inherit Quick Create prompt text implicitly.
  return shot.prompt;
}
