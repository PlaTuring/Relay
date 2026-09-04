/**
 * Relay Alpha 28 project contract.
 *
 * This file is intentionally runtime-neutral.  The renderer may use the types
 * and normalisers, while only the main process is allowed to resolve stable
 * external-reference IDs to private absolute paths.
 */

import {
  normalizeRelayResolvedSeedPlan,
  normalizeRelaySeedPolicy,
  type RelayResolvedSeedPlan,
  type RelaySeedPolicy
} from "./seed-policy.js";

export const RELAY_PROJECT_SCHEMA_VERSION = 1 as const;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type RelayEditorMode = "quick" | "professional";
export type RelayWorkflowMode = "T2V" | "FL2VA" | "REF2VA";
export type RelayProjectStatus = "active" | "archived";
export type RelayMediaType = "image" | "video" | "audio";
export type RelayAssetStorageMode = "project_copy" | "external_reference";
export type RelayAssetAvailability =
  | "available"
  | "needs_conversion"
  | "missing"
  | "changed"
  | "incompatible"
  | "inspection_failed";
export type RelayAssetPurpose =
  | "first_frame"
  | "last_frame"
  | "subject_reference"
  | "product_reference"
  | "scene_reference"
  | "style_reference"
  | "motion_reference"
  | "video_reference"
  | "audio_reference"
  | "continuity_reference";
export type RelayBindingTargetKind = "project" | "entity" | "scene" | "shot";
export type RelayEntityKind = "character" | "prop" | "scene";
export type RelayTransitionType =
  | "tail_frame_continuation"
  | "hard_cut"
  | "fade"
  | "dissolve"
  | "match_cut"
  | "custom";
export type RelayTransitionCapability = "proven" | "intent_only";
export type RelayShotDurationSeconds = 5 | 10 | 15;

export const RELAY_SHOT_DURATIONS = Object.freeze([5, 10, 15] as const);

export const RELAY_CONTINUITY_FIELDS = Object.freeze([
  "subject",
  "wardrobeAppearance",
  "poseAction",
  "framePosition",
  "heldProps",
  "sceneWeatherTime",
  "cameraPositionMovement",
  "lighting",
  "audioState"
] as const);

export type RelayContinuityField = typeof RELAY_CONTINUITY_FIELDS[number];

export interface RelayContinuityValue {
  readonly mode: "inherit" | "override";
  readonly value: string;
  readonly locked: boolean;
}

export type RelayContinuityState = Readonly<Partial<Record<RelayContinuityField, RelayContinuityValue>>>;

export interface RelayQuickProjectState {
  readonly workflowName: string;
  /** The exact user input. Relay never expands or rewrites it. */
  readonly originalPrompt: string;
  readonly mode: RelayWorkflowMode;
  readonly language: "zh" | "en" | "mixed";
  readonly totalDurationSeconds: number;
  readonly segmentDurationSeconds: RelayShotDurationSeconds;
  readonly canvasAspectRatio: string;
  readonly resolutionMegapixels: string;
  readonly seed: string;
  readonly seedPolicy: RelaySeedPolicy;
  readonly sampling: string;
  readonly firstFrameAssetId: string | null;
  readonly lastFrameAssetId: string | null;
  readonly referenceAssetIds: readonly string[];
}

export interface RelayProfessionalProjectState {
  /** Preserves the existing director payload without inventing missing fields. */
  readonly directorState: JsonValue | null;
  /** Immutable source snapshot when a quick project is promoted. */
  readonly promotedQuickState: RelayQuickProjectState | null;
  readonly activeSceneId: string | null;
  readonly activeShotId: string | null;
}

export interface RelayProjectAsset {
  readonly assetId: string;
  readonly displayName: string;
  readonly sourceFileName: string;
  readonly mediaType: RelayMediaType;
  readonly storageMode: RelayAssetStorageMode;
  /** Present only for copied project assets and always project-relative. */
  readonly projectRelativePath: string | null;
  /** Stable private resolver key; never an absolute path. */
  readonly externalReferenceId: string | null;
  readonly byteLength: number;
  readonly sha256: string;
  readonly tags: readonly string[];
  readonly notes: string;
  readonly availability: RelayAssetAvailability;
  readonly inspection: JsonValue | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RelayProjectEntity {
  readonly entityId: string;
  readonly kind: RelayEntityKind;
  readonly name: string;
  readonly notes: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly archived: boolean;
}

export interface RelayAssetBinding {
  readonly bindingId: string;
  readonly targetKind: RelayBindingTargetKind;
  readonly targetId: string;
  readonly assetId: string;
  readonly purpose: RelayAssetPurpose;
  readonly notes: string;
  readonly createdAt: string;
}

export interface RelayShotTransition {
  readonly type: RelayTransitionType;
  readonly capability: RelayTransitionCapability;
  readonly inheritedFields: readonly RelayContinuityField[];
  readonly assetId: string | null;
  readonly customIntent: string;
}

export interface RelayProjectShot {
  readonly shotId: string;
  readonly name: string;
  readonly order: number;
  readonly durationSeconds: RelayShotDurationSeconds;
  readonly prompt: string;
  readonly camera: string;
  readonly sound: string;
  readonly startState: RelayContinuityState;
  readonly endState: RelayContinuityState;
  /** Null only for the first active shot in a project. */
  readonly transitionFromPrevious: RelayShotTransition | null;
  readonly archived: boolean;
}

export interface RelayProjectScene {
  readonly sceneId: string;
  readonly name: string;
  readonly order: number;
  readonly notes: string;
  readonly shotIds: readonly string[];
  readonly archived: boolean;
}

export interface RelayExternalReference {
  readonly referenceId: string;
  readonly kind: "comfyui_root" | "model_root" | "asset_file";
  readonly displayName: string;
  /** Key resolved by private application/installation configuration. */
  readonly locatorId: string;
  readonly expectedSha256: string | null;
  readonly attachOnly: true;
}

export interface RelayWorkflowHandoffRecord {
  readonly handoffId: string;
  readonly targetComfyReferenceId: string;
  readonly targetRelativePath: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly handedOffAt: string;
}

export interface RelayAuthoritativeWorkflowRecord {
  readonly workflowId: string;
  readonly displayName: string;
  readonly projectRelativePath: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly createdAt: string;
  /** Exact compile-time base seed and deterministic per-shot derivation. */
  readonly seedResolution: RelayResolvedSeedPlan | null;
  readonly handoffs: readonly RelayWorkflowHandoffRecord[];
}

export interface RelayProjectHistoryRecord {
  readonly historyId: string;
  readonly kind: "manual" | "compile_handoff" | "migration" | "restore";
  readonly createdAt: string;
  readonly projectRelativePath: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly label: string;
  /** Reproduction evidence for compile_handoff checkpoints. */
  readonly seedResolution: RelayResolvedSeedPlan | null;
}

export interface RelayProjectDocument {
  readonly schemaVersion: typeof RELAY_PROJECT_SCHEMA_VERSION;
  readonly projectId: string;
  readonly name: string;
  readonly editorMode: RelayEditorMode;
  readonly status: RelayProjectStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
  readonly quick: RelayQuickProjectState;
  readonly professional: RelayProfessionalProjectState;
  readonly assets: readonly RelayProjectAsset[];
  readonly entities: readonly RelayProjectEntity[];
  readonly bindings: readonly RelayAssetBinding[];
  readonly scenes: readonly RelayProjectScene[];
  readonly shots: readonly RelayProjectShot[];
  readonly externalReferences: readonly RelayExternalReference[];
  readonly workflows: readonly RelayAuthoritativeWorkflowRecord[];
  readonly history: readonly RelayProjectHistoryRecord[];
}

export interface RelayProjectMigrationResult {
  readonly project: RelayProjectDocument;
  readonly fromVersion: number;
  readonly migrated: boolean;
  readonly warnings: readonly string[];
}

const ID_PATTERNS = Object.freeze({
  project: /^project-[a-z0-9][a-z0-9-]{7,127}$/u,
  asset: /^asset-[a-z0-9][a-z0-9-]{7,127}$/u,
  entity: /^entity-[a-z0-9][a-z0-9-]{7,127}$/u,
  binding: /^binding-[a-z0-9][a-z0-9-]{7,127}$/u,
  scene: /^scene-[a-z0-9][a-z0-9-]{7,127}$/u,
  shot: /^shot-[a-z0-9][a-z0-9-]{7,127}$/u,
  workflow: /^workflow-[a-z0-9][a-z0-9-]{7,127}$/u,
  handoff: /^handoff-[a-z0-9][a-z0-9-]{7,127}$/u,
  history: /^history-[a-z0-9][a-z0-9-]{7,127}$/u,
  reference: /^reference-[a-z0-9][a-z0-9-]{7,127}$/u
});

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedText(value: unknown, maximum: number, fallback = ""): string {
  if (typeof value !== "string" || value.length > maximum || value.includes("\0")) return fallback;
  return value;
}

function requiredDisplayName(value: unknown): string {
  const candidate = boundedText(value, 160).trim();
  if (!candidate || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(candidate)) {
    throw new TypeError("Project name must be a non-empty Unicode display name without control characters.");
  }
  return candidate;
}

function timestamp(value: unknown, fallback: string): string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : fallback;
}

function requiredTimestamp(value: unknown, label: string): string {
  const candidate = timestamp(value, "");
  if (!candidate) throw new TypeError(`${label} timestamp is invalid.`);
  return candidate;
}

function id(value: unknown, kind: keyof typeof ID_PATTERNS): string {
  if (typeof value !== "string" || !ID_PATTERNS[kind].test(value)) {
    throw new TypeError(`Invalid stable ${kind} ID.`);
  }
  return value;
}

function uniqueStrings(value: unknown, maximum = 128): readonly string[] {
  if (!Array.isArray(value) || value.length > maximum) return Object.freeze([]);
  return Object.freeze([...new Set(value.filter((item): item is string => typeof item === "string")
    .map((item) => item.trim()).filter(Boolean))]);
}

function assertUnique<T>(values: readonly T[], key: (value: T) => string, label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    const candidate = key(value);
    if (seen.has(candidate)) throw new TypeError(`Duplicate ${label} ID.`);
    seen.add(candidate);
  }
}

function sha256(value: unknown, nullable = false): string | null {
  if (nullable && value === null) return null;
  const candidate = typeof value === "string" ? value.toLowerCase() : "";
  if (!/^[a-f0-9]{64}$/u.test(candidate)) throw new TypeError("Invalid SHA-256 digest.");
  return candidate;
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError("Expected a non-negative safe integer.");
  }
  return value;
}

function jsonValue(value: unknown, seen = new Set<object>()): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Project JSON cannot contain non-finite numbers.");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError("Project JSON cannot contain cycles.");
    seen.add(value);
    const result = value.map((item) => jsonValue(item, seen));
    seen.delete(value);
    return result;
  }
  if (typeof value === "object" && value !== null) {
    if (seen.has(value)) throw new TypeError("Project JSON cannot contain cycles.");
    seen.add(value);
    const result: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) result[key] = jsonValue(child, seen);
    }
    seen.delete(value);
    return result;
  }
  throw new TypeError("Project data must be JSON serializable.");
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
  return Object.freeze(value);
}

export function canonicalRelayProjectJson(value: unknown): string {
  return JSON.stringify(jsonValue(value));
}

function immutable<T>(value: T): T {
  return deepFreeze(JSON.parse(canonicalRelayProjectJson(value)) as T);
}

export function isRelayProjectId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERNS.project.test(value);
}

export function normalizeProjectRelativePath(value: unknown, prefix?: string): string {
  if (typeof value !== "string") throw new TypeError("Project path must be a string.");
  const candidate = value.trim().replaceAll("\\", "/");
  if (!candidate || candidate.startsWith("/") || /^[a-z]:/iu.test(candidate) || candidate.includes("\0")) {
    throw new TypeError("Project paths must be relative.");
  }
  const parts = candidate.split("/").filter((part) => part && part !== ".");
  if (!parts.length || parts.some((part) => part === "..")) throw new TypeError("Project path escapes its project root.");
  const normalized = parts.join("/");
  if (prefix !== undefined && normalized !== prefix && !normalized.startsWith(`${prefix}/`)) {
    throw new TypeError(`Project path must stay inside ${prefix}/.`);
  }
  return normalized;
}

function normalizeQuick(value: unknown): RelayQuickProjectState {
  const source = record(value) ?? {};
  const duration = Number(source.segmentDurationSeconds);
  const mode = source.mode === "FL2VA" || source.mode === "REF2VA" ? source.mode : "T2V";
  const language = source.language === "en" || source.language === "mixed" ? source.language : "zh";
  const totalDurationSeconds = Math.max(5, Math.min(3_600, Number.isSafeInteger(source.totalDurationSeconds) ? Number(source.totalDurationSeconds) : 5));
  const segmentDurationSeconds = duration === 10 || duration === 15 ? duration : 5;
  if (totalDurationSeconds % segmentDurationSeconds !== 0) throw new TypeError("Total duration must be an exact multiple of segment duration.");
  if (mode === "REF2VA" && (totalDurationSeconds > 15 || totalDurationSeconds !== segmentDurationSeconds)) {
    throw new TypeError("Ref2VA supports exactly one 5, 10, or 15 second segment.");
  }
  return {
    workflowName: boundedText(source.workflowName, 160),
    originalPrompt: boundedText(source.originalPrompt, 32_000),
    mode,
    language,
    totalDurationSeconds,
    segmentDurationSeconds,
    canvasAspectRatio: boundedText(source.canvasAspectRatio, 32, "16:9") || "16:9",
    resolutionMegapixels: boundedText(source.resolutionMegapixels, 32, "0.4") || "0.4",
    seed: boundedText(source.seed, 64, "1") || "1",
    seedPolicy: normalizeRelaySeedPolicy(source.seedPolicy ?? source.seed_policy),
    sampling: boundedText(source.sampling, 64, "quality_20") || "quality_20",
    firstFrameAssetId: source.firstFrameAssetId === null || source.firstFrameAssetId === undefined ? null : id(source.firstFrameAssetId, "asset"),
    lastFrameAssetId: source.lastFrameAssetId === null || source.lastFrameAssetId === undefined ? null : id(source.lastFrameAssetId, "asset"),
    referenceAssetIds: uniqueStrings(source.referenceAssetIds).map((item) => id(item, "asset"))
  };
}

function normalizeContinuity(value: unknown): RelayContinuityState {
  const source = record(value) ?? {};
  const result: Partial<Record<RelayContinuityField, RelayContinuityValue>> = {};
  for (const field of RELAY_CONTINUITY_FIELDS) {
    const candidate = record(source[field]);
    if (candidate === null) continue;
    result[field] = {
      mode: candidate.mode === "override" ? "override" : "inherit",
      value: boundedText(candidate.value, 8_000),
      locked: candidate.locked === true
    };
  }
  return result;
}

function normalizeTransition(value: unknown): RelayShotTransition | null {
  if (value === null) return null;
  const source = record(value);
  if (source === null) throw new TypeError("Invalid shot transition.");
  const allowed = new Set<RelayTransitionType>(["tail_frame_continuation", "hard_cut", "fade", "dissolve", "match_cut", "custom"]);
  const type = allowed.has(source.type as RelayTransitionType) ? source.type as RelayTransitionType : "hard_cut";
  const capability: RelayTransitionCapability = type === "tail_frame_continuation" || type === "hard_cut"
    ? "proven"
    : "intent_only";
  return {
    type,
    capability,
    inheritedFields: uniqueStrings(source.inheritedFields).filter((field): field is RelayContinuityField =>
      (RELAY_CONTINUITY_FIELDS as readonly string[]).includes(field)),
    assetId: source.assetId === null ? null : id(source.assetId, "asset"),
    customIntent: boundedText(source.customIntent, 2_000)
  };
}

export function createEmptyRelayProject(input: {
  readonly projectId: string;
  readonly name: string;
  readonly createdAt: string;
}): RelayProjectDocument {
  const projectId = id(input.projectId, "project");
  const createdAt = timestamp(input.createdAt, "");
  if (!createdAt) throw new TypeError("Project creation timestamp is invalid.");
  return immutable({
    schemaVersion: RELAY_PROJECT_SCHEMA_VERSION,
    projectId,
    name: requiredDisplayName(input.name),
    editorMode: "quick" as const,
    status: "active" as const,
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
    quick: normalizeQuick({ firstFrameAssetId: null, lastFrameAssetId: null }),
    professional: {
      directorState: null,
      promotedQuickState: null,
      activeSceneId: null,
      activeShotId: null
    },
    assets: [], entities: [], bindings: [], scenes: [], shots: [], externalReferences: [], workflows: [], history: []
  });
}

export function normalizeRelayProject(value: unknown): RelayProjectDocument {
  const source = record(value);
  if (source === null || source.schemaVersion !== RELAY_PROJECT_SCHEMA_VERSION) {
    throw new TypeError("Unsupported Relay project schema version.");
  }
  const nowFallback = typeof source.createdAt === "string" ? source.createdAt : "";
  const assets = (Array.isArray(source.assets) ? source.assets : []).map((value): RelayProjectAsset => {
    const item = record(value);
    if (item === null) throw new TypeError("Invalid project asset.");
    const storageMode: RelayAssetStorageMode = item.storageMode === "external_reference" ? "external_reference" : "project_copy";
    const relativePath = item.projectRelativePath === null ? null : normalizeProjectRelativePath(item.projectRelativePath, "assets");
    const externalReferenceId = item.externalReferenceId === null ? null : id(item.externalReferenceId, "reference");
    if ((storageMode === "project_copy") !== (relativePath !== null) || (storageMode === "external_reference") !== (externalReferenceId !== null)) {
      throw new TypeError("Asset storage mode and locator do not agree.");
    }
    const availability = new Set<RelayAssetAvailability>(["available", "needs_conversion", "missing", "changed", "incompatible", "inspection_failed"])
      .has(item.availability as RelayAssetAvailability) ? item.availability as RelayAssetAvailability : "inspection_failed";
    return {
      assetId: id(item.assetId, "asset"), displayName: boundedText(item.displayName, 160), sourceFileName: boundedText(item.sourceFileName, 255),
      mediaType: item.mediaType === "video" || item.mediaType === "audio" ? item.mediaType : "image", storageMode,
      projectRelativePath: relativePath, externalReferenceId, byteLength: nonNegativeInteger(item.byteLength),
      sha256: sha256(item.sha256) as string, tags: uniqueStrings(item.tags, 32), notes: boundedText(item.notes, 4_000),
      availability, inspection: item.inspection === null ? null : jsonValue(item.inspection),
      createdAt: timestamp(item.createdAt, nowFallback), updatedAt: timestamp(item.updatedAt, nowFallback)
    };
  });
  const assetIds = new Set(assets.map((asset) => asset.assetId));
  assertUnique(assets, (asset) => asset.assetId, "asset");
  const entities = (Array.isArray(source.entities) ? source.entities : []).map((value): RelayProjectEntity => {
    const item = record(value);
    if (item === null) throw new TypeError("Invalid project entity.");
    const attributes: Record<string, string> = {};
    for (const [key, entry] of Object.entries(record(item.attributes) ?? {})) if (typeof entry === "string") attributes[key] = entry;
    return { entityId: id(item.entityId, "entity"), kind: item.kind === "prop" || item.kind === "scene" ? item.kind : "character",
      name: boundedText(item.name, 160), notes: boundedText(item.notes, 4_000), attributes, archived: item.archived === true };
  });
  const shots = (Array.isArray(source.shots) ? source.shots : []).map((value): RelayProjectShot => {
    const item = record(value);
    if (item === null) throw new TypeError("Invalid project shot.");
    const duration = Number(item.durationSeconds);
    if (duration !== 5 && duration !== 10 && duration !== 15) throw new TypeError("Shot duration must be 5, 10, or 15 seconds.");
    return { shotId: id(item.shotId, "shot"), name: boundedText(item.name, 160), order: nonNegativeInteger(item.order),
      durationSeconds: duration, prompt: boundedText(item.prompt, 32_000), camera: boundedText(item.camera, 8_000),
      sound: boundedText(item.sound, 8_000), startState: normalizeContinuity(item.startState), endState: normalizeContinuity(item.endState),
      transitionFromPrevious: normalizeTransition(item.transitionFromPrevious), archived: item.archived === true };
  });
  assertUnique(entities, (entity) => entity.entityId, "entity");
  assertUnique(shots, (shot) => shot.shotId, "shot");
  const shotIds = new Set(shots.map((shot) => shot.shotId));
  const scenes = (Array.isArray(source.scenes) ? source.scenes : []).map((value): RelayProjectScene => {
    const item = record(value);
    if (item === null) throw new TypeError("Invalid project scene.");
    const ids = uniqueStrings(item.shotIds).map((shotId) => id(shotId, "shot"));
    if (ids.some((shotId) => !shotIds.has(shotId))) throw new TypeError("Scene references an unknown shot.");
    return { sceneId: id(item.sceneId, "scene"), name: boundedText(item.name, 160), order: nonNegativeInteger(item.order),
      notes: boundedText(item.notes, 8_000), shotIds: ids, archived: item.archived === true };
  });
  assertUnique(scenes, (scene) => scene.sceneId, "scene");
  const targetIds = new Set([source.projectId, ...entities.map((entry) => entry.entityId), ...scenes.map((entry) => entry.sceneId), ...shotIds]);
  const bindings = (Array.isArray(source.bindings) ? source.bindings : []).map((value): RelayAssetBinding => {
    const item = record(value);
    if (item === null) throw new TypeError("Invalid asset binding.");
    const purposeSet = new Set<RelayAssetPurpose>(["first_frame", "last_frame", "subject_reference", "product_reference", "scene_reference", "style_reference", "motion_reference", "video_reference", "audio_reference", "continuity_reference"]);
    const targetKindSet = new Set<RelayBindingTargetKind>(["project", "entity", "scene", "shot"]);
    const targetId = boundedText(item.targetId, 160);
    const assetId = id(item.assetId, "asset");
    if (!targetIds.has(targetId) || !assetIds.has(assetId) || !purposeSet.has(item.purpose as RelayAssetPurpose) || !targetKindSet.has(item.targetKind as RelayBindingTargetKind)) {
      throw new TypeError("Asset binding references an unknown target, asset, or purpose.");
    }
    return { bindingId: id(item.bindingId, "binding"), targetKind: item.targetKind as RelayBindingTargetKind, targetId,
      assetId, purpose: item.purpose as RelayAssetPurpose, notes: boundedText(item.notes, 4_000), createdAt: timestamp(item.createdAt, nowFallback) };
  });
  assertUnique(bindings, (binding) => binding.bindingId, "binding");
  const externalReferences = (Array.isArray(source.externalReferences) ? source.externalReferences : []).map((value): RelayExternalReference => {
    const item = record(value);
    if (item === null || item.attachOnly !== true) throw new TypeError("External references must remain attach-only.");
    const kind = item.kind === "model_root" || item.kind === "asset_file" ? item.kind : "comfyui_root";
    const locatorId = boundedText(item.locatorId, 160).trim();
    if (!locatorId) throw new TypeError("External reference locator ID is required.");
    return { referenceId: id(item.referenceId, "reference"), kind, displayName: boundedText(item.displayName, 160),
      locatorId, expectedSha256: sha256(item.expectedSha256, true), attachOnly: true };
  });
  assertUnique(externalReferences, (reference) => reference.referenceId, "external reference");
  const workflows = (Array.isArray(source.workflows) ? source.workflows : []).map((value): RelayAuthoritativeWorkflowRecord => {
    const item = record(value);
    if (item === null) throw new TypeError("Invalid authoritative workflow record.");
    const handoffs = (Array.isArray(item.handoffs) ? item.handoffs : []).map((value): RelayWorkflowHandoffRecord => {
      const handoff = record(value);
      if (handoff === null) throw new TypeError("Invalid workflow handoff record.");
      return { handoffId: id(handoff.handoffId, "handoff"), targetComfyReferenceId: id(handoff.targetComfyReferenceId, "reference"),
        targetRelativePath: normalizeProjectRelativePath(handoff.targetRelativePath), byteLength: nonNegativeInteger(handoff.byteLength),
        sha256: sha256(handoff.sha256) as string, handedOffAt: timestamp(handoff.handedOffAt, nowFallback) };
    });
    assertUnique(handoffs, (handoff) => handoff.handoffId, "handoff");
    return { workflowId: id(item.workflowId, "workflow"), displayName: boundedText(item.displayName, 160),
      projectRelativePath: normalizeProjectRelativePath(item.projectRelativePath, "workflows"), byteLength: nonNegativeInteger(item.byteLength),
      sha256: sha256(item.sha256) as string, createdAt: timestamp(item.createdAt, nowFallback),
      seedResolution: item.seedResolution === null || item.seedResolution === undefined
        ? null
        : normalizeRelayResolvedSeedPlan(item.seedResolution), handoffs };
  });
  assertUnique(workflows, (workflow) => workflow.workflowId, "workflow");
  const history = (Array.isArray(source.history) ? source.history : []).map((value): RelayProjectHistoryRecord => {
    const item = record(value);
    if (item === null) throw new TypeError("Invalid project history record.");
    const kind = item.kind === "compile_handoff" || item.kind === "migration" || item.kind === "restore" ? item.kind : "manual";
    return { historyId: id(item.historyId, "history"), kind, createdAt: timestamp(item.createdAt, nowFallback),
      projectRelativePath: normalizeProjectRelativePath(item.projectRelativePath, "history"), byteLength: nonNegativeInteger(item.byteLength),
      sha256: sha256(item.sha256) as string, label: boundedText(item.label, 160),
      seedResolution: item.seedResolution === null || item.seedResolution === undefined
        ? null
        : normalizeRelayResolvedSeedPlan(item.seedResolution) };
  });
  assertUnique(history, (entry) => entry.historyId, "history");
  const professional = record(source.professional) ?? {};
  const projectId = id(source.projectId, "project");
  const quick = normalizeQuick(source.quick);
  for (const assetId of [quick.firstFrameAssetId, quick.lastFrameAssetId, ...quick.referenceAssetIds]) {
    if (assetId !== null && !assetIds.has(assetId)) throw new TypeError("Quick project references an unknown asset.");
  }
  const activeSceneId = professional.activeSceneId === null ? null : id(professional.activeSceneId, "scene");
  const activeShotId = professional.activeShotId === null ? null : id(professional.activeShotId, "shot");
  if (activeSceneId !== null && !scenes.some((scene) => scene.sceneId === activeSceneId)) throw new TypeError("Active scene is missing.");
  if (activeShotId !== null && !shotIds.has(activeShotId)) throw new TypeError("Active shot is missing.");
  const externalReferenceIds = new Set(externalReferences.map((reference) => reference.referenceId));
  for (const workflow of workflows) {
    if (workflow.handoffs.some((handoff) => !externalReferenceIds.has(handoff.targetComfyReferenceId))) {
      throw new TypeError("Workflow handoff references an unknown ComfyUI target.");
    }
  }
  const createdAt = requiredTimestamp(source.createdAt, "Project creation");
  const updatedAt = requiredTimestamp(source.updatedAt, "Project update");
  const status = source.status === "archived" ? "archived" : "active";
  const archivedAt = status === "archived" ? requiredTimestamp(source.archivedAt, "Project archive") : null;
  return immutable({
    schemaVersion: RELAY_PROJECT_SCHEMA_VERSION, projectId, name: requiredDisplayName(source.name),
    editorMode: source.editorMode === "professional" ? "professional" : "quick",
    status,
    createdAt, updatedAt,
    archivedAt, quick,
    professional: { directorState: professional.directorState === null || professional.directorState === undefined ? null : jsonValue(professional.directorState),
      promotedQuickState: professional.promotedQuickState === null || professional.promotedQuickState === undefined ? null : normalizeQuick(professional.promotedQuickState),
      activeSceneId, activeShotId }, assets, entities, bindings, scenes, shots, externalReferences, workflows, history
  });
}

export function migrateRelayProjectDocument(value: unknown): RelayProjectMigrationResult {
  const source = record(value);
  if (source === null) throw new TypeError("Relay project must be a JSON object.");
  if (source.schemaVersion === RELAY_PROJECT_SCHEMA_VERSION) {
    return Object.freeze({ project: normalizeRelayProject(source), fromVersion: RELAY_PROJECT_SCHEMA_VERSION, migrated: false, warnings: Object.freeze([]) });
  }
  throw new TypeError(`Unsupported Relay project schema version: ${String(source.schemaVersion)}.`);
}
