import { normalizeRelaySeedPolicy, type RelaySeedPolicy } from "../shared/seed-policy.js";

export type ProductionEntityKind = "character" | "location" | "prop";
export type LegacyProductionEntityKind = ProductionEntityKind | "asset";
export type ProductionTakeStatus = "candidate" | "selected" | "rejected" | "archived";
export type ProductionAssetMediaType = "image" | "video" | "audio";
export type ProductionAssetStorageMode = "reference" | "copy";
export type ProductionBindingTargetKind = "entity" | "shot";
export type ProductionShotDuration = 5 | 10 | 15;
export type ContinuityDimension =
  | "characterAppearance"
  | "wardrobe"
  | "props"
  | "movementDirection"
  | "scene"
  | "weather"
  | "timeOfDay"
  | "lighting"
  | "visualStyle"
  | "sound";

export const CONTINUITY_DIMENSIONS: readonly ContinuityDimension[] = Object.freeze([
  "characterAppearance",
  "wardrobe",
  "props",
  "movementDirection",
  "scene",
  "weather",
  "timeOfDay",
  "lighting",
  "visualStyle",
  "sound"
]);

export const PRODUCTION_SHOT_DURATIONS: readonly ProductionShotDuration[] = Object.freeze([5, 10, 15]);

export interface ContinuityCell {
  readonly mode: "inherit" | "override";
  readonly value: string;
}

export type ContinuityLayer = Readonly<Partial<Record<ContinuityDimension, ContinuityCell>>>;
export type ContinuityDefaults = Readonly<Record<ContinuityDimension, string>>;

export interface ProductionEntity {
  readonly id: string;
  readonly kind: ProductionEntityKind;
  readonly name: string;
  readonly notes: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly archived: boolean;
}

export interface ProductionAsset {
  readonly id: string;
  /** Stable ID of the persisted local AssetRecord owned by the asset library. */
  readonly sourceAssetId: string;
  readonly name: string;
  readonly mediaType: ProductionAssetMediaType;
  /** Project-relative POSIX-style reference. Absolute user paths never enter production state. */
  readonly projectRelativePath: string;
  readonly storageMode: ProductionAssetStorageMode;
  readonly sha256: string;
  readonly sizeBytes: number | null;
  readonly tags: readonly string[];
  readonly notes: string;
  readonly missing: boolean;
  readonly archived: boolean;
  readonly legacyEntityId: string | null;
}

export interface ProductionBinding {
  readonly id: string;
  readonly targetKind: ProductionBindingTargetKind;
  readonly targetId: string;
  readonly assetId: string;
  readonly role: string;
  readonly notes: string;
  readonly archived: boolean;
}

export interface LegacyProductionAssetEntityEvidence {
  readonly sourceIndex: number;
  readonly entity: {
    readonly id: string;
    readonly kind: "asset";
    readonly name: string;
    readonly notes: string;
    readonly attributes: Readonly<Record<string, string>>;
    readonly archived: boolean;
  };
  /** Canonical lossless JSON evidence of the complete pre-v7 record, including unknown fields. */
  readonly sourceSnapshot: string;
}

export interface ProductionShot {
  readonly id: string;
  readonly startSeconds: number;
  readonly durationSeconds: number;
  readonly description: string;
  readonly cameraLanguage: string;
  readonly soundCue: string;
  readonly transitionNote: string;
  readonly entityIds: readonly string[];
  readonly continuity: ContinuityLayer;
  readonly archived: boolean;
}

export interface ProductionScene {
  readonly id: string;
  readonly title: string;
  readonly order: number;
  readonly notes: string;
  readonly continuity: ContinuityLayer;
  readonly shots: readonly ProductionShot[];
  readonly archived: boolean;
}

export interface ProductionTake {
  readonly id: string;
  readonly name: string;
  readonly shotId: string;
  readonly revisionId: string | null;
  readonly assetId: string | null;
  /** v6 recovery-only field. New UI flows bind a Take to assetId instead. */
  readonly localResultPath: string;
  readonly notes: string;
  readonly rating: number | null;
  readonly status: ProductionTakeStatus;
  readonly createdAt: string;
}

export interface ProductionRevision {
  readonly id: string;
  readonly parentRevisionId: string | null;
  readonly createdAt: string;
  readonly directorSnapshot: string;
  readonly productionSnapshot: string;
}

export interface ProductionProject {
  readonly id: string;
  readonly name: string;
  readonly productionBibles: {
    readonly characterWardrobeProps: string;
    readonly sceneWorld: string;
    readonly visualStyle: string;
    readonly unstructuredContinuity: string;
  };
  readonly directorSettings: {
    readonly language: string;
    readonly mode: string;
    readonly totalDurationSeconds: number;
    readonly segmentDurationSeconds: number;
    readonly canvas: string;
    readonly resolution: string;
    readonly seed: string;
    readonly seedPolicy: RelaySeedPolicy;
    readonly sampling: string;
    readonly lastCompiledSnapshot: string;
  };
  readonly continuityDefaults: ContinuityDefaults;
}

export interface DirectorProductionState {
  readonly schemaVersion: 2;
  readonly project: ProductionProject;
  readonly entities: readonly ProductionEntity[];
  readonly assets: readonly ProductionAsset[];
  readonly bindings: readonly ProductionBinding[];
  readonly legacyAssetEntities: readonly LegacyProductionAssetEntityEvidence[];
  readonly scenes: readonly ProductionScene[];
  readonly takes: readonly ProductionTake[];
  readonly revisions: readonly ProductionRevision[];
  readonly activeRevisionId: string | null;
}

export interface ProductionContinuityIssue {
  readonly code: "empty_override";
  readonly shotId: string;
  readonly dimension: ContinuityDimension;
  readonly message: string;
}

export interface ResolvedContinuityCell {
  readonly dimension: ContinuityDimension;
  readonly value: string;
  readonly source: "project" | "scene" | "shot" | "empty";
  readonly inherited: boolean;
}

export interface DirectorV5MigrationResult {
  readonly state: DirectorProductionState;
  readonly directorSnapshot: string;
  readonly warnings: readonly string[];
}

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

const ENTITY_KINDS = new Set<ProductionEntityKind>(["character", "location", "prop"]);
const ASSET_MEDIA_TYPES = new Set<ProductionAssetMediaType>(["image", "video", "audio"]);
const ASSET_STORAGE_MODES = new Set<ProductionAssetStorageMode>(["reference", "copy"]);
const BINDING_TARGET_KINDS = new Set<ProductionBindingTargetKind>(["entity", "shot"]);
const TAKE_STATUSES = new Set<ProductionTakeStatus>(["candidate", "selected", "rejected", "archived"]);
const ID_PATTERN = /^(project|entity|asset|binding|scene|shot|take|revision)-[a-z0-9][a-z0-9-]{2,127}$/u;
type StableIdPrefix = "project" | "entity" | "asset" | "binding" | "scene" | "shot" | "take" | "revision";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nonNegativeInteger(value: unknown, fallback = 0): number {
  const candidate = Number(value);
  return Number.isSafeInteger(candidate) && candidate >= 0 ? candidate : fallback;
}

function positiveInteger(value: unknown, fallback = 1): number {
  const candidate = Number(value);
  return Number.isSafeInteger(candidate) && candidate > 0 ? candidate : fallback;
}

function normalizeJson(value: unknown, seen = new Set<object>()): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Production data only supports finite JSON numbers.");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError("Production data cannot contain cycles.");
    seen.add(value);
    const result = value.map((entry) => normalizeJson(entry, seen));
    seen.delete(value);
    return result;
  }
  if (typeof value === "object" && value !== null) {
    if (seen.has(value)) throw new TypeError("Production data cannot contain cycles.");
    seen.add(value);
    const result: Record<string, JsonValue> = {};
    for (const key of Object.keys(value as object).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) result[key] = normalizeJson(entry, seen);
    }
    seen.delete(value);
    return result;
  }
  throw new TypeError("Production data must be JSON serializable.");
}

export function canonicalProductionJson(value: unknown): string {
  return JSON.stringify(normalizeJson(value));
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function immutableJsonCopy<T>(value: T): T {
  return deepFreeze(JSON.parse(canonicalProductionJson(value)) as T);
}

function stableHash(value: unknown): string {
  const source = canonicalProductionJson(value);
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

function stableId(prefix: StableIdPrefix, identity: unknown): string {
  return `${prefix}-${stableHash(identity).slice(0, 20)}`;
}

function normalizedId(value: unknown, prefix: StableIdPrefix, identity: unknown): string {
  const candidate = text(value);
  return candidate.startsWith(`${prefix}-`) && ID_PATTERN.test(candidate) ? candidate : stableId(prefix, identity);
}

function emptyContinuityDefaults(): Record<ContinuityDimension, string> {
  return {
    characterAppearance: "",
    wardrobe: "",
    props: "",
    movementDirection: "",
    scene: "",
    weather: "",
    timeOfDay: "",
    lighting: "",
    visualStyle: "",
    sound: ""
  };
}

function normalizeAttributes(value: unknown): Readonly<Record<string, string>> {
  const record = asRecord(value);
  const result: Record<string, string> = {};
  if (record !== null) {
    for (const key of Object.keys(record).sort()) {
      if (typeof record[key] === "string") result[key] = record[key];
    }
  }
  return result;
}

function normalizeStringList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function normalizeSha256(value: unknown): string {
  const candidate = text(value).trim().toLowerCase();
  return /^[a-f0-9]{64}$/u.test(candidate) ? candidate : "";
}

function normalizeProjectRelativePath(value: string, allowEmpty = false): string {
  const candidate = value.trim().replace(/\\/gu, "/");
  if (candidate.length === 0 && allowEmpty) return "";
  if (candidate.length === 0
    || candidate.startsWith("/")
    || candidate.startsWith("//")
    || /^[a-z]:/iu.test(candidate)
    || candidate.includes("\0")) {
    throw new TypeError("Asset references must use a non-empty project-relative path.");
  }
  const parts = candidate.split("/").filter((part) => part.length > 0 && part !== ".");
  if (parts.length === 0 || parts.some((part) => part === "..")) {
    throw new TypeError("Asset references cannot escape the project directory.");
  }
  return parts.join("/");
}

function normalizeContinuityLayer(value: unknown): ContinuityLayer {
  const record = asRecord(value);
  const result: Partial<Record<ContinuityDimension, ContinuityCell>> = {};
  if (record === null) return result;
  for (const dimension of CONTINUITY_DIMENSIONS) {
    const candidate = asRecord(record[dimension]);
    if (candidate === null) continue;
    const mode = candidate.mode === "override" ? "override" : "inherit";
    // Restoration is lossless: legacy payloads may contain recovery text even
    // on an inherited cell. Resolution ignores that value while mode=inherit,
    // but migration must not erase it. New edits still canonicalize inherit to
    // an empty value through normalizedCell().
    result[dimension] = { mode, value: text(candidate.value) };
  }
  return result;
}

function normalizeContinuityDefaults(value: unknown): ContinuityDefaults {
  const record = asRecord(value);
  const defaults = emptyContinuityDefaults();
  if (record !== null) {
    for (const dimension of CONTINUITY_DIMENSIONS) defaults[dimension] = text(record[dimension]);
  }
  return defaults;
}

function findShot(state: DirectorProductionState, shotId: string): { scene: ProductionScene; shot: ProductionShot } | null {
  for (const scene of state.scenes) {
    const shot = scene.shots.find((candidate) => candidate.id === shotId);
    if (shot !== undefined) return { scene, shot };
  }
  return null;
}

function replaceState(
  state: DirectorProductionState,
  patch: Partial<Pick<DirectorProductionState,
    "project" | "entities" | "assets" | "bindings" | "legacyAssetEntities" | "scenes" | "takes" | "revisions" | "activeRevisionId">>
): DirectorProductionState {
  return immutableJsonCopy({ ...state, ...patch, schemaVersion: 2 as const });
}

export function createEmptyProductionState(input: { readonly projectName?: string; readonly identityKey?: string } = {}): DirectorProductionState {
  const name = text(input.projectName).trim();
  const projectId = stableId("project", { identityKey: text(input.identityKey) || name || "relay-production" });
  return immutableJsonCopy({
    schemaVersion: 2 as const,
    project: {
      id: projectId,
      name,
      productionBibles: {
        characterWardrobeProps: "",
        sceneWorld: "",
        visualStyle: "",
        unstructuredContinuity: ""
      },
      directorSettings: {
        language: "zh",
        mode: "T2V",
        totalDurationSeconds: 30,
        segmentDurationSeconds: 5,
        canvas: "9:16",
        resolution: "0.4",
        seed: "1",
        seedPolicy: "random_per_compile",
        sampling: "quality_20",
        lastCompiledSnapshot: ""
      },
      continuityDefaults: emptyContinuityDefaults()
    },
    entities: [],
    assets: [],
    bindings: [],
    legacyAssetEntities: [],
    scenes: [],
    takes: [],
    revisions: [],
    activeRevisionId: null
  });
}

export function normalizeProductionState(value: unknown): DirectorProductionState {
  const root = asRecord(value);
  if (root === null || (root.schemaVersion !== 1 && root.schemaVersion !== 2)) return createEmptyProductionState();
  const legacyV1 = root.schemaVersion === 1;
  const project = asRecord(root.project) ?? {};
  const bibles = asRecord(project.productionBibles) ?? {};
  const settings = asRecord(project.directorSettings) ?? {};
  const projectId = normalizedId(project.id, "project", { name: text(project.name) || "relay-production" });
  const entities: ProductionEntity[] = [];
  const assets: ProductionAsset[] = [];
  const bindings: ProductionBinding[] = [];
  const legacyAssetEntities: LegacyProductionAssetEntityEvidence[] = [];
  const entityIds = new Set<string>();
  const assetIds = new Set<string>();
  const legacyAssetIdByEntityId = new Map<string, string>();
  for (const [index, value] of (Array.isArray(root.entities) ? root.entities : []).entries()) {
    const candidate = asRecord(value);
    if (candidate === null) continue;
    if (candidate.kind === "asset") {
      const legacyEntityId = normalizedId(candidate.id, "entity", { projectId, index, kind: "asset", name: text(candidate.name) });
      const legacyEntity = {
        id: legacyEntityId,
        kind: "asset" as const,
        name: text(candidate.name),
        notes: text(candidate.notes),
        attributes: normalizeAttributes(candidate.attributes),
        archived: candidate.archived === true
      };
      const assetId = stableId("asset", { projectId, legacyEntityId });
      legacyAssetIdByEntityId.set(legacyEntityId, assetId);
      if (typeof candidate.id === "string") legacyAssetIdByEntityId.set(candidate.id, assetId);
      legacyAssetEntities.push({
        sourceIndex: index,
        entity: legacyEntity,
        sourceSnapshot: canonicalProductionJson(candidate)
      });
      if (!assetIds.has(assetId)) {
        assetIds.add(assetId);
        assets.push({
          id: assetId,
          sourceAssetId: "",
          name: legacyEntity.name,
          mediaType: "image",
          projectRelativePath: "",
          storageMode: "reference",
          sha256: "",
          sizeBytes: null,
          tags: [],
          notes: legacyEntity.notes,
          missing: true,
          archived: legacyEntity.archived,
          legacyEntityId
        });
      }
      continue;
    }
    if (!ENTITY_KINDS.has(candidate.kind as ProductionEntityKind)) continue;
    const id = normalizedId(candidate.id, "entity", { projectId, index, kind: candidate.kind, name: text(candidate.name) });
    if (entityIds.has(id)) continue;
    entityIds.add(id);
    entities.push({
      id,
      kind: candidate.kind as ProductionEntityKind,
      name: text(candidate.name),
      notes: text(candidate.notes),
      attributes: normalizeAttributes(candidate.attributes),
      archived: candidate.archived === true
    });
  }
  if (!legacyV1) {
    for (const [index, value] of (Array.isArray(root.assets) ? root.assets : []).entries()) {
      const candidate = asRecord(value);
      if (candidate === null) continue;
      const id = normalizedId(candidate.id, "asset", {
        projectId,
        index,
        sourceAssetId: text(candidate.sourceAssetId),
        projectRelativePath: text(candidate.projectRelativePath)
      });
      if (assetIds.has(id)) continue;
      assetIds.add(id);
      const size = candidate.sizeBytes === null ? null : Number(candidate.sizeBytes);
      assets.push({
        id,
        sourceAssetId: text(candidate.sourceAssetId),
        name: text(candidate.name),
        mediaType: ASSET_MEDIA_TYPES.has(candidate.mediaType as ProductionAssetMediaType)
          ? candidate.mediaType as ProductionAssetMediaType
          : "image",
        projectRelativePath: normalizeProjectRelativePath(text(candidate.projectRelativePath), true),
        storageMode: ASSET_STORAGE_MODES.has(candidate.storageMode as ProductionAssetStorageMode)
          ? candidate.storageMode as ProductionAssetStorageMode
          : "reference",
        sha256: normalizeSha256(candidate.sha256),
        sizeBytes: size !== null && Number.isSafeInteger(size) && size >= 0 ? size : null,
        tags: normalizeStringList(candidate.tags),
        notes: text(candidate.notes),
        missing: candidate.missing === true,
        archived: candidate.archived === true,
        legacyEntityId: typeof candidate.legacyEntityId === "string" ? candidate.legacyEntityId : null
      });
    }
    for (const value of Array.isArray(root.legacyAssetEntities) ? root.legacyAssetEntities : []) {
      const candidate = asRecord(value);
      const entity = asRecord(candidate?.entity);
      if (candidate === null || entity === null || entity.kind !== "asset") continue;
      const legacyEntityId = normalizedId(entity.id, "entity", {
        projectId,
        sourceIndex: nonNegativeInteger(candidate.sourceIndex),
        kind: "asset",
        name: text(entity.name)
      });
      if (legacyAssetEntities.some((evidence) => evidence.entity.id === legacyEntityId)) continue;
      legacyAssetEntities.push({
        sourceIndex: nonNegativeInteger(candidate.sourceIndex),
        entity: {
          id: legacyEntityId,
          kind: "asset",
          name: text(entity.name),
          notes: text(entity.notes),
          attributes: normalizeAttributes(entity.attributes),
          archived: entity.archived === true
        },
        sourceSnapshot: text(candidate.sourceSnapshot) || canonicalProductionJson(entity)
      });
    }
  }
  const scenes: ProductionScene[] = [];
  const sceneIds = new Set<string>();
  const shotIds = new Set<string>();
  const legacyBindingCandidates: { readonly shotId: string; readonly assetId: string }[] = [];
  for (const [sceneIndex, value] of (Array.isArray(root.scenes) ? root.scenes : []).entries()) {
    const candidate = asRecord(value);
    if (candidate === null) continue;
    const sceneId = normalizedId(candidate.id, "scene", { projectId, sceneIndex, title: text(candidate.title) });
    if (sceneIds.has(sceneId)) continue;
    sceneIds.add(sceneId);
    const shots: ProductionShot[] = [];
    for (const [shotIndex, shotValue] of (Array.isArray(candidate.shots) ? candidate.shots : []).entries()) {
      const shot = asRecord(shotValue);
      if (shot === null) continue;
      const shotId = normalizedId(shot.id, "shot", {
        projectId,
        sceneId,
        shotIndex,
        startSeconds: nonNegativeInteger(shot.startSeconds),
        durationSeconds: positiveInteger(shot.durationSeconds)
      });
      if (shotIds.has(shotId)) continue;
      shotIds.add(shotId);
      const rawEntityIds = (Array.isArray(shot.entityIds) ? shot.entityIds : [])
        .filter((id): id is string => typeof id === "string");
      for (const legacyEntityId of rawEntityIds) {
        const assetId = legacyAssetIdByEntityId.get(legacyEntityId);
        if (assetId !== undefined) legacyBindingCandidates.push({ shotId, assetId });
      }
      shots.push({
        id: shotId,
        startSeconds: nonNegativeInteger(shot.startSeconds),
        durationSeconds: positiveInteger(shot.durationSeconds),
        description: text(shot.description),
        cameraLanguage: text(shot.cameraLanguage),
        soundCue: text(shot.soundCue),
        transitionNote: text(shot.transitionNote),
        entityIds: [...new Set(rawEntityIds.filter((id) => entityIds.has(id)))],
        continuity: normalizeContinuityLayer(shot.continuity),
        archived: shot.archived === true
      });
    }
    scenes.push({
      id: sceneId,
      title: text(candidate.title),
      order: nonNegativeInteger(candidate.order, sceneIndex),
      notes: text(candidate.notes),
      continuity: normalizeContinuityLayer(candidate.continuity),
      shots,
      archived: candidate.archived === true
    });
  }
  const bindingIds = new Set<string>();
  if (!legacyV1) {
    for (const [index, value] of (Array.isArray(root.bindings) ? root.bindings : []).entries()) {
      const candidate = asRecord(value);
      if (candidate === null
        || !BINDING_TARGET_KINDS.has(candidate.targetKind as ProductionBindingTargetKind)
        || !assetIds.has(text(candidate.assetId))) continue;
      const targetKind = candidate.targetKind as ProductionBindingTargetKind;
      const targetId = text(candidate.targetId);
      const targetExists = targetKind === "entity" ? entityIds.has(targetId) : shotIds.has(targetId);
      if (!targetExists) continue;
      const id = normalizedId(candidate.id, "binding", {
        projectId,
        index,
        targetKind,
        targetId,
        assetId: text(candidate.assetId),
        role: text(candidate.role)
      });
      if (bindingIds.has(id)) continue;
      bindingIds.add(id);
      bindings.push({
        id,
        targetKind,
        targetId,
        assetId: text(candidate.assetId),
        role: text(candidate.role),
        notes: text(candidate.notes),
        archived: candidate.archived === true
      });
    }
  }
  for (const { shotId, assetId } of legacyBindingCandidates) {
    const id = stableId("binding", { projectId, targetKind: "shot", targetId: shotId, assetId, role: "legacy-entity-reference" });
    if (bindingIds.has(id)) continue;
    bindingIds.add(id);
    bindings.push({
      id,
      targetKind: "shot",
      targetId: shotId,
      assetId,
      role: "legacy-entity-reference",
      notes: "",
      archived: false
    });
  }
  const revisions: ProductionRevision[] = [];
  const revisionIds = new Set<string>();
  for (const value of Array.isArray(root.revisions) ? root.revisions : []) {
    const candidate = asRecord(value);
    if (candidate === null || typeof candidate.directorSnapshot !== "string" || typeof candidate.productionSnapshot !== "string") continue;
    const parentRevisionId = typeof candidate.parentRevisionId === "string" ? candidate.parentRevisionId : null;
    const id = normalizedId(candidate.id, "revision", {
      parentRevisionId,
      directorSnapshot: candidate.directorSnapshot,
      productionSnapshot: candidate.productionSnapshot
    });
    if (revisionIds.has(id)) continue;
    revisionIds.add(id);
    revisions.push({
      id,
      parentRevisionId,
      createdAt: text(candidate.createdAt),
      directorSnapshot: candidate.directorSnapshot,
      productionSnapshot: candidate.productionSnapshot
    });
  }
  const takes: ProductionTake[] = [];
  const takeIds = new Set<string>();
  for (const [index, value] of (Array.isArray(root.takes) ? root.takes : []).entries()) {
    const candidate = asRecord(value);
    if (candidate === null || !shotIds.has(text(candidate.shotId))) continue;
    const id = normalizedId(candidate.id, "take", {
      projectId,
      index,
      shotId: text(candidate.shotId),
      localResultPath: text(candidate.localResultPath)
    });
    if (takeIds.has(id)) continue;
    takeIds.add(id);
    const rating = candidate.rating === null ? null : Number(candidate.rating);
    takes.push({
      id,
      name: text(candidate.name),
      shotId: text(candidate.shotId),
      revisionId: typeof candidate.revisionId === "string" && revisionIds.has(candidate.revisionId)
        ? candidate.revisionId
        : null,
      assetId: typeof candidate.assetId === "string" && assetIds.has(candidate.assetId)
        ? candidate.assetId
        : null,
      localResultPath: text(candidate.localResultPath),
      notes: text(candidate.notes),
      rating: rating !== null && Number.isInteger(rating) && rating >= 0 && rating <= 5 ? rating : null,
      status: TAKE_STATUSES.has(candidate.status as ProductionTakeStatus)
        ? candidate.status as ProductionTakeStatus
        : "candidate",
      createdAt: text(candidate.createdAt)
    });
  }
  const activeRevisionId = typeof root.activeRevisionId === "string" && revisionIds.has(root.activeRevisionId)
    ? root.activeRevisionId
    : null;
  return immutableJsonCopy({
    schemaVersion: 2 as const,
    project: {
      id: projectId,
      name: text(project.name),
      productionBibles: {
        characterWardrobeProps: text(bibles.characterWardrobeProps),
        sceneWorld: text(bibles.sceneWorld),
        visualStyle: text(bibles.visualStyle),
        unstructuredContinuity: text(bibles.unstructuredContinuity)
      },
      directorSettings: {
        language: text(settings.language) || "zh",
        mode: text(settings.mode) || "T2V",
        totalDurationSeconds: positiveInteger(settings.totalDurationSeconds, 30),
        segmentDurationSeconds: positiveInteger(settings.segmentDurationSeconds, 5),
        canvas: text(settings.canvas) || "9:16",
        resolution: text(settings.resolution) || "0.4",
        seed: text(settings.seed) || "1",
        seedPolicy: normalizeRelaySeedPolicy(settings.seedPolicy ?? settings.seed_policy),
        sampling: text(settings.sampling) || "quality_20",
        lastCompiledSnapshot: text(settings.lastCompiledSnapshot)
      },
      continuityDefaults: normalizeContinuityDefaults(project.continuityDefaults)
    },
    entities,
    assets,
    bindings,
    legacyAssetEntities: legacyAssetEntities.sort((left, right) => left.sourceIndex - right.sourceIndex
      || left.entity.id.localeCompare(right.entity.id)),
    scenes: scenes.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id)),
    takes,
    revisions,
    activeRevisionId
  });
}

/** Explicit, deterministic v6 production schema migration. It performs no I/O. */
export function migrateProductionStateV1ToV2(value: unknown): DirectorProductionState {
  const root = asRecord(value);
  if (root === null || root.schemaVersion !== 1) {
    throw new TypeError("Expected a Director production schemaVersion 1 value.");
  }
  return normalizeProductionState(root);
}

export function updateProductionProject(
  state: DirectorProductionState,
  patch: {
    readonly name?: string;
    readonly productionBibles?: Partial<ProductionProject["productionBibles"]>;
    readonly directorSettings?: Partial<ProductionProject["directorSettings"]>;
  }
): DirectorProductionState {
  return replaceState(state, {
    project: {
      ...state.project,
      name: patch.name ?? state.project.name,
      productionBibles: {
        ...state.project.productionBibles,
        ...patch.productionBibles
      },
      directorSettings: {
        ...state.project.directorSettings,
        ...patch.directorSettings
      }
    }
  });
}

export function upsertProductionEntity(
  state: DirectorProductionState,
  input: {
    readonly id?: string;
    readonly identityKey?: string;
    readonly kind: ProductionEntityKind;
    readonly name: string;
    readonly notes?: string;
    readonly attributes?: Readonly<Record<string, string>>;
    readonly archived?: boolean;
  }
): DirectorProductionState {
  if (!ENTITY_KINDS.has(input.kind)) throw new TypeError("Unsupported production entity kind.");
  const id = normalizedId(input.id, "entity", {
    projectId: state.project.id,
    kind: input.kind,
    identityKey: text(input.identityKey) || input.name
  });
  const existing = state.entities.find((entity) => entity.id === id);
  const entity: ProductionEntity = {
    id,
    kind: input.kind,
    name: input.name,
    notes: input.notes ?? existing?.notes ?? "",
    attributes: normalizeAttributes(input.attributes ?? existing?.attributes ?? {}),
    archived: input.archived ?? existing?.archived ?? false
  };
  return replaceState(state, {
    entities: existing === undefined
      ? [...state.entities, entity]
      : state.entities.map((candidate) => candidate.id === id ? entity : candidate)
  });
}

export function archiveProductionEntity(state: DirectorProductionState, entityId: string): DirectorProductionState {
  if (!state.entities.some((entity) => entity.id === entityId)) throw new RangeError("Unknown production entity.");
  return replaceState(state, {
    entities: state.entities.map((entity) => entity.id === entityId ? { ...entity, archived: true } : entity)
  });
}

export function restoreProductionEntity(state: DirectorProductionState, entityId: string): DirectorProductionState {
  if (!state.entities.some((entity) => entity.id === entityId)) throw new RangeError("Unknown production entity.");
  return replaceState(state, {
    entities: state.entities.map((entity) => entity.id === entityId ? { ...entity, archived: false } : entity)
  });
}

export function upsertProductionAssetReference(
  state: DirectorProductionState,
  input: {
    readonly id?: string;
    readonly identityKey?: string;
    readonly sourceAssetId: string;
    readonly name: string;
    readonly mediaType: ProductionAssetMediaType;
    readonly projectRelativePath: string;
    readonly storageMode: ProductionAssetStorageMode;
    readonly sha256?: string;
    readonly sizeBytes?: number | null;
    readonly tags?: readonly string[];
    readonly notes?: string;
    readonly missing?: boolean;
    readonly archived?: boolean;
  }
): DirectorProductionState {
  if (input.sourceAssetId.trim().length === 0) throw new TypeError("A stable source AssetRecord ID is required.");
  if (!ASSET_MEDIA_TYPES.has(input.mediaType)) throw new TypeError("Unsupported production asset media type.");
  if (!ASSET_STORAGE_MODES.has(input.storageMode)) throw new TypeError("Unsupported production asset storage mode.");
  const projectRelativePath = normalizeProjectRelativePath(input.projectRelativePath);
  const sizeBytes = input.sizeBytes ?? null;
  if (sizeBytes !== null && (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0)) {
    throw new RangeError("Asset size must be a non-negative safe integer or null.");
  }
  const id = normalizedId(input.id, "asset", {
    projectId: state.project.id,
    sourceAssetId: input.sourceAssetId,
    identityKey: text(input.identityKey) || input.sourceAssetId
  });
  const existing = state.assets.find((asset) => asset.id === id);
  const asset: ProductionAsset = {
    id,
    sourceAssetId: input.sourceAssetId,
    name: input.name,
    mediaType: input.mediaType,
    projectRelativePath,
    storageMode: input.storageMode,
    sha256: normalizeSha256(input.sha256),
    sizeBytes,
    tags: normalizeStringList(input.tags),
    notes: input.notes ?? existing?.notes ?? "",
    missing: input.missing ?? existing?.missing ?? false,
    archived: input.archived ?? existing?.archived ?? false,
    legacyEntityId: existing?.legacyEntityId ?? null
  };
  return replaceState(state, {
    assets: existing === undefined
      ? [...state.assets, asset]
      : state.assets.map((candidate) => candidate.id === id ? asset : candidate)
  });
}

export function archiveProductionAssetReference(state: DirectorProductionState, assetId: string): DirectorProductionState {
  if (!state.assets.some((asset) => asset.id === assetId)) throw new RangeError("Unknown production asset.");
  return replaceState(state, {
    assets: state.assets.map((asset) => asset.id === assetId ? { ...asset, archived: true } : asset),
    bindings: state.bindings.map((binding) => binding.assetId === assetId ? { ...binding, archived: true } : binding),
    takes: state.takes.map((take) => take.assetId === assetId ? { ...take, status: "archived" as const } : take)
  });
}

export function upsertProductionBinding(
  state: DirectorProductionState,
  input: {
    readonly id?: string;
    readonly identityKey?: string;
    readonly targetKind: ProductionBindingTargetKind;
    readonly targetId: string;
    readonly assetId: string;
    readonly role?: string;
    readonly notes?: string;
    readonly archived?: boolean;
  }
): DirectorProductionState {
  if (!BINDING_TARGET_KINDS.has(input.targetKind)) throw new TypeError("Unsupported binding target kind.");
  const targetExists = input.targetKind === "entity"
    ? state.entities.some((entity) => entity.id === input.targetId)
    : findShot(state, input.targetId) !== null;
  if (!targetExists) throw new RangeError("Unknown production binding target.");
  if (!state.assets.some((asset) => asset.id === input.assetId && !asset.archived)) {
    throw new RangeError("Unknown or archived production asset.");
  }
  const role = input.role ?? "reference";
  const id = normalizedId(input.id, "binding", {
    projectId: state.project.id,
    targetKind: input.targetKind,
    targetId: input.targetId,
    assetId: input.assetId,
    role,
    identityKey: text(input.identityKey)
  });
  const existing = state.bindings.find((binding) => binding.id === id);
  const binding: ProductionBinding = {
    id,
    targetKind: input.targetKind,
    targetId: input.targetId,
    assetId: input.assetId,
    role,
    notes: input.notes ?? existing?.notes ?? "",
    archived: input.archived ?? existing?.archived ?? false
  };
  return replaceState(state, {
    bindings: existing === undefined
      ? [...state.bindings, binding]
      : state.bindings.map((candidate) => candidate.id === id ? binding : candidate)
  });
}

export function archiveProductionBinding(state: DirectorProductionState, bindingId: string): DirectorProductionState {
  if (!state.bindings.some((binding) => binding.id === bindingId)) throw new RangeError("Unknown production binding.");
  return replaceState(state, {
    bindings: state.bindings.map((binding) => binding.id === bindingId ? { ...binding, archived: true } : binding)
  });
}

export function productionBindingsForTarget(
  state: DirectorProductionState,
  targetKind: ProductionBindingTargetKind,
  targetId: string
): readonly ProductionBinding[] {
  return immutableJsonCopy(state.bindings.filter((binding) => !binding.archived
    && binding.targetKind === targetKind && binding.targetId === targetId));
}

export function upsertProductionScene(
  state: DirectorProductionState,
  input: { readonly id?: string; readonly identityKey?: string; readonly title: string; readonly order?: number; readonly notes?: string }
): DirectorProductionState {
  const id = normalizedId(input.id, "scene", {
    projectId: state.project.id,
    identityKey: text(input.identityKey) || input.title
  });
  const existing = state.scenes.find((scene) => scene.id === id);
  const scene: ProductionScene = {
    id,
    title: input.title,
    order: input.order ?? existing?.order ?? state.scenes.length,
    notes: input.notes ?? existing?.notes ?? "",
    continuity: existing?.continuity ?? {},
    shots: existing?.shots ?? [],
    archived: existing?.archived ?? false
  };
  return replaceState(state, {
    scenes: (existing === undefined
      ? [...state.scenes, scene]
      : state.scenes.map((candidate) => candidate.id === id ? scene : candidate))
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
  });
}

export function archiveProductionScene(state: DirectorProductionState, sceneId: string): DirectorProductionState {
  if (!state.scenes.some((scene) => scene.id === sceneId)) throw new RangeError("Unknown production scene.");
  return replaceState(state, {
    scenes: state.scenes.map((scene) => scene.id === sceneId ? { ...scene, archived: true } : scene)
  });
}

export function restoreProductionScene(state: DirectorProductionState, sceneId: string): DirectorProductionState {
  if (!state.scenes.some((scene) => scene.id === sceneId)) throw new RangeError("Unknown production scene.");
  return replaceState(state, {
    scenes: state.scenes.map((scene) => scene.id === sceneId ? { ...scene, archived: false } : scene)
  });
}

export function assignShotToScene(
  state: DirectorProductionState,
  sceneId: string,
  input: {
    readonly id?: string;
    readonly identityKey?: string;
    readonly startSeconds: number;
    readonly durationSeconds: number;
    readonly description?: string;
    readonly cameraLanguage?: string;
    readonly soundCue?: string;
    readonly transitionNote?: string;
    readonly entityIds?: readonly string[];
  }
): DirectorProductionState {
  if (!state.scenes.some((scene) => scene.id === sceneId)) throw new RangeError("Unknown production scene.");
  const id = normalizedId(input.id, "shot", {
    projectId: state.project.id,
    identityKey: text(input.identityKey) || `${input.startSeconds}:${input.durationSeconds}`
  });
  const existing = findShot(state, id)?.shot;
  const knownEntityIds = new Set(state.entities.map((entity) => entity.id));
  const shot: ProductionShot = {
    id,
    startSeconds: nonNegativeInteger(input.startSeconds),
    durationSeconds: positiveInteger(input.durationSeconds),
    description: input.description ?? existing?.description ?? "",
    cameraLanguage: input.cameraLanguage ?? existing?.cameraLanguage ?? "",
    soundCue: input.soundCue ?? existing?.soundCue ?? "",
    transitionNote: input.transitionNote ?? existing?.transitionNote ?? "",
    entityIds: [...new Set((input.entityIds ?? existing?.entityIds ?? []).filter((entityId) => knownEntityIds.has(entityId)))],
    continuity: existing?.continuity ?? {},
    archived: existing?.archived ?? false
  };
  return replaceState(state, {
    scenes: state.scenes.map((scene) => ({
      ...scene,
      shots: scene.id === sceneId
        ? [...scene.shots.filter((candidate) => candidate.id !== id), shot]
            .sort((left, right) => left.startSeconds - right.startSeconds || left.id.localeCompare(right.id))
        : scene.shots.filter((candidate) => candidate.id !== id)
    }))
  });
}

export function archiveProductionShot(state: DirectorProductionState, shotId: string): DirectorProductionState {
  if (findShot(state, shotId) === null) throw new RangeError("Unknown production shot.");
  return replaceState(state, {
    scenes: state.scenes.map((scene) => ({
      ...scene,
      shots: scene.shots.map((shot) => shot.id === shotId ? { ...shot, archived: true } : shot)
    }))
  });
}

export function isProductionShotDuration(value: unknown): value is ProductionShotDuration {
  return PRODUCTION_SHOT_DURATIONS.includes(value as ProductionShotDuration);
}

export function directorTimelineDuration(
  value: DirectorProductionState | readonly Readonly<{ durationSeconds: number; archived?: boolean }>[]
): number {
  const shots: readonly Readonly<{ durationSeconds: number; archived?: boolean }>[] = "scenes" in value
    ? value.scenes.flatMap((scene) => scene.archived ? [] : scene.shots)
    : value;
  return shots.reduce((total, shot) => total + (shot.archived ? 0 : shot.durationSeconds), 0);
}

/** Changes one active shot to an official 5/10/15-second duration and reflows the timeline deterministically. */
export function setProductionShotDuration(
  state: DirectorProductionState,
  shotId: string,
  durationSeconds: ProductionShotDuration
): DirectorProductionState {
  if (!isProductionShotDuration(durationSeconds)) throw new RangeError("Shot duration must be 5, 10, or 15 seconds.");
  const target = findShot(state, shotId);
  if (target === null) throw new RangeError("Unknown production shot.");
  if (target.scene.archived || target.shot.archived) throw new RangeError("Cannot retime an archived production shot.");
  const orderedActive = state.scenes
    .filter((scene) => !scene.archived)
    .flatMap((scene) => scene.shots.filter((shot) => !shot.archived))
    .sort((left, right) => left.startSeconds - right.startSeconds || left.id.localeCompare(right.id));
  let cursor = 0;
  const timing = new Map<string, { readonly startSeconds: number; readonly durationSeconds: number }>();
  for (const shot of orderedActive) {
    const duration = shot.id === shotId ? durationSeconds : shot.durationSeconds;
    timing.set(shot.id, { startSeconds: cursor, durationSeconds: duration });
    cursor += duration;
  }
  return replaceState(state, {
    project: {
      ...state.project,
      directorSettings: { ...state.project.directorSettings, totalDurationSeconds: cursor }
    },
    scenes: state.scenes.map((scene) => ({
      ...scene,
      shots: scene.shots.map((shot) => {
        const next = timing.get(shot.id);
        return next === undefined ? shot : { ...shot, ...next };
      }).sort((left, right) => left.startSeconds - right.startSeconds || left.id.localeCompare(right.id))
    }))
  });
}

export function setProjectContinuityDefault(
  state: DirectorProductionState,
  dimension: ContinuityDimension,
  value: string
): DirectorProductionState {
  if (!CONTINUITY_DIMENSIONS.includes(dimension)) throw new TypeError("Unknown continuity dimension.");
  return replaceState(state, {
    project: {
      ...state.project,
      continuityDefaults: { ...state.project.continuityDefaults, [dimension]: value }
    }
  });
}

function normalizedCell(cell: ContinuityCell): ContinuityCell {
  return cell.mode === "override"
    ? { mode: "override", value: cell.value }
    : { mode: "inherit", value: "" };
}

export function setSceneContinuity(
  state: DirectorProductionState,
  sceneId: string,
  dimension: ContinuityDimension,
  cell: ContinuityCell
): DirectorProductionState {
  if (!state.scenes.some((scene) => scene.id === sceneId)) throw new RangeError("Unknown production scene.");
  return replaceState(state, {
    scenes: state.scenes.map((scene) => scene.id === sceneId
      ? { ...scene, continuity: { ...scene.continuity, [dimension]: normalizedCell(cell) } }
      : scene)
  });
}

export function unsetSceneContinuity(
  state: DirectorProductionState,
  sceneId: string,
  dimension: ContinuityDimension
): DirectorProductionState {
  if (!state.scenes.some((scene) => scene.id === sceneId)) throw new RangeError("Unknown production scene.");
  return replaceState(state, {
    scenes: state.scenes.map((scene) => {
      if (scene.id !== sceneId) return scene;
      const continuity = { ...scene.continuity };
      delete continuity[dimension];
      return { ...scene, continuity };
    })
  });
}

export function setShotContinuity(
  state: DirectorProductionState,
  shotId: string,
  dimension: ContinuityDimension,
  cell: ContinuityCell
): DirectorProductionState {
  if (findShot(state, shotId) === null) throw new RangeError("Unknown production shot.");
  return replaceState(state, {
    scenes: state.scenes.map((scene) => ({
      ...scene,
      shots: scene.shots.map((shot) => shot.id === shotId
        ? { ...shot, continuity: { ...shot.continuity, [dimension]: normalizedCell(cell) } }
        : shot)
    }))
  });
}

export function unsetShotContinuity(
  state: DirectorProductionState,
  shotId: string,
  dimension: ContinuityDimension
): DirectorProductionState {
  if (findShot(state, shotId) === null) throw new RangeError("Unknown production shot.");
  return replaceState(state, {
    scenes: state.scenes.map((scene) => ({
      ...scene,
      shots: scene.shots.map((shot) => {
        if (shot.id !== shotId) return shot;
        const continuity = { ...shot.continuity };
        delete continuity[dimension];
        return { ...shot, continuity };
      })
    }))
  });
}

export function resolveShotContinuity(state: DirectorProductionState, shotId: string): readonly ResolvedContinuityCell[] {
  const found = findShot(state, shotId);
  if (found === null) throw new RangeError("Unknown production shot.");
  return immutableJsonCopy(CONTINUITY_DIMENSIONS.map((dimension): ResolvedContinuityCell => {
    const shotCell = found.shot.continuity[dimension];
    if (shotCell?.mode === "override") {
      return { dimension, value: shotCell.value, source: "shot", inherited: false };
    }
    const sceneCell = found.scene.continuity[dimension];
    if (sceneCell?.mode === "override") {
      return { dimension, value: sceneCell.value, source: "scene", inherited: true };
    }
    const projectValue = state.project.continuityDefaults[dimension];
    return projectValue.length > 0
      ? { dimension, value: projectValue, source: "project", inherited: true }
      : { dimension, value: "", source: "empty", inherited: true };
  }));
}

export function buildContinuityMatrix(state: DirectorProductionState): readonly {
  readonly sceneId: string;
  readonly shotId: string;
  readonly cells: readonly ResolvedContinuityCell[];
}[] {
  return immutableJsonCopy(state.scenes.flatMap((scene) => scene.shots.map((shot) => ({
    sceneId: scene.id,
    shotId: shot.id,
    cells: resolveShotContinuity(state, shot.id)
  }))));
}

/** Structural-only continuity validation. It never writes, creates, or rewrites user content. */
export function validateProductionContinuity(state: DirectorProductionState): readonly ProductionContinuityIssue[] {
  const issues: ProductionContinuityIssue[] = [];
  for (const scene of state.scenes) {
    if (scene.archived) continue;
    for (const shot of scene.shots) {
      if (shot.archived) continue;
      for (const dimension of CONTINUITY_DIMENSIONS) {
        const cell = shot.continuity[dimension];
        if (cell?.mode === "override" && cell.value.trim().length === 0) {
          issues.push({
            code: "empty_override",
            shotId: shot.id,
            dimension,
            message: `镜头 ${shot.id} 的 ${dimension} 已设为本镜头覆盖，但内容为空。`
          });
          continue;
        }
        const sceneCell = scene.continuity[dimension];
        if (cell?.mode !== "override"
          && sceneCell?.mode === "override"
          && sceneCell.value.trim().length === 0) {
          issues.push({
            code: "empty_override",
            shotId: shot.id,
            dimension,
            message: `镜头 ${shot.id} 继承的场景 ${dimension} 覆盖内容为空。`
          });
        }
      }
    }
  }
  return immutableJsonCopy(issues);
}

export function addProductionTake(
  state: DirectorProductionState,
  input: {
    readonly id?: string;
    readonly identityKey?: string;
    readonly name?: string;
    readonly shotId: string;
    readonly revisionId?: string | null;
    readonly assetId?: string;
    readonly localResultPath?: string;
    readonly notes?: string;
    readonly rating?: number | null;
    readonly status?: ProductionTakeStatus;
    readonly createdAt?: string;
  }
): DirectorProductionState {
  if (findShot(state, input.shotId) === null) throw new RangeError("Unknown production shot.");
  const revisionId = input.revisionId === undefined ? state.activeRevisionId : input.revisionId;
  if (revisionId !== null && !state.revisions.some((revision) => revision.id === revisionId)) {
    throw new RangeError("Unknown production revision for take.");
  }
  const assetId = input.assetId ?? null;
  if (assetId !== null && !state.assets.some((asset) => asset.id === assetId && !asset.archived)) {
    throw new RangeError("Unknown or archived production asset for take.");
  }
  const localResultPath = input.localResultPath ?? "";
  if (assetId === null && localResultPath.trim().length === 0) {
    throw new TypeError("A production asset ID is required; localResultPath is accepted only for v6 recovery.");
  }
  const rating = input.rating ?? null;
  if (rating !== null && (!Number.isInteger(rating) || rating < 0 || rating > 5)) {
    throw new RangeError("Take rating must be an integer from 0 through 5 or null.");
  }
  const status = input.status ?? "candidate";
  if (!TAKE_STATUSES.has(status)) throw new TypeError("Unsupported take status.");
  const id = normalizedId(input.id, "take", {
    projectId: state.project.id,
    shotId: input.shotId,
    revisionId,
    assetId,
    identityKey: text(input.identityKey) || assetId || localResultPath
  });
  if (state.takes.some((take) => take.id === id)) throw new RangeError("This take already exists.");
  // The data layer never reads the system clock. UI/service callers may attach a
  // timestamp for display, but it is deliberately optional metadata.
  const createdAt = input.createdAt ?? "";
  const takes = status === "selected"
    ? state.takes.map((take) => take.shotId === input.shotId && take.status === "selected"
      ? { ...take, status: "candidate" as const }
      : take)
    : [...state.takes];
  takes.push({
    id,
    name: input.name ?? "",
    shotId: input.shotId,
    revisionId,
    assetId,
    localResultPath,
    notes: input.notes ?? "",
    rating,
    status,
    createdAt
  });
  return replaceState(state, { takes });
}

export function updateProductionTake(
  state: DirectorProductionState,
  takeId: string,
  patch: {
    readonly assetId?: string | null;
    readonly name?: string;
    readonly notes?: string;
    readonly rating?: number | null;
    readonly status?: ProductionTakeStatus;
  }
): DirectorProductionState {
  const existing = state.takes.find((take) => take.id === takeId);
  if (existing === undefined) throw new RangeError("Unknown production take.");
  const rating = patch.rating === undefined ? existing.rating : patch.rating;
  if (rating !== null && (!Number.isInteger(rating) || rating < 0 || rating > 5)) {
    throw new RangeError("Take rating must be an integer from 0 through 5 or null.");
  }
  const status = patch.status ?? existing.status;
  if (!TAKE_STATUSES.has(status)) throw new TypeError("Unsupported take status.");
  const assetId = patch.assetId === undefined ? existing.assetId : patch.assetId;
  if (assetId !== null && !state.assets.some((asset) => asset.id === assetId && !asset.archived)) {
    throw new RangeError("Unknown or archived production asset for take.");
  }
  if (assetId === null && existing.localResultPath.trim().length === 0) {
    throw new TypeError("A production asset ID is required for this take.");
  }
  return replaceState(state, {
    takes: state.takes.map((take) => {
      if (take.id === takeId) return {
        ...take,
        assetId,
        name: patch.name ?? take.name,
        notes: patch.notes ?? take.notes,
        rating,
        status
      };
      if (status === "selected" && take.shotId === existing.shotId && take.status === "selected") {
        return { ...take, status: "candidate" as const };
      }
      return take;
    })
  });
}

export function archiveProductionTake(state: DirectorProductionState, takeId: string): DirectorProductionState {
  return updateProductionTake(state, takeId, { status: "archived" });
}

function productionContent(state: DirectorProductionState): object {
  return {
    schemaVersion: state.schemaVersion,
    project: state.project,
    entities: state.entities,
    assets: state.assets,
    bindings: state.bindings,
    legacyAssetEntities: state.legacyAssetEntities,
    scenes: state.scenes,
    takes: state.takes
  };
}

function productionContentIdentity(state: DirectorProductionState): object {
  return {
    schemaVersion: state.schemaVersion,
    project: state.project,
    entities: state.entities,
    assets: state.assets,
    bindings: state.bindings,
    legacyAssetEntities: state.legacyAssetEntities,
    scenes: state.scenes,
    takes: state.takes.map(({ createdAt: _createdAt, ...take }) => take)
  };
}

export function canonicalProductionSnapshot(state: DirectorProductionState): string {
  return canonicalProductionJson(productionContent(state));
}

export function canonicalCompilationProductionSnapshot(state: DirectorProductionState): string {
  const activeScenes = state.scenes
    .filter((scene) => !scene.archived)
    .map((scene) => ({
      ...scene,
      shots: scene.shots.filter((shot) => !shot.archived)
    }));
  const referencedEntityIds = new Set(activeScenes.flatMap((scene) => scene.shots.flatMap((shot) => shot.entityIds)));
  const activeShotIds = new Set(activeScenes.flatMap((scene) => scene.shots.map((shot) => shot.id)));
  const relevantBindings = state.bindings.filter((binding) => !binding.archived && (
    (binding.targetKind === "shot" && activeShotIds.has(binding.targetId))
    || (binding.targetKind === "entity" && referencedEntityIds.has(binding.targetId))
  ));
  const referencedAssetIds = new Set(relevantBindings.map((binding) => binding.assetId));
  return canonicalProductionJson({
    schemaVersion: state.schemaVersion,
    project: state.project,
    entities: state.entities.filter((entity) => !entity.archived && referencedEntityIds.has(entity.id)),
    assets: state.assets.filter((asset) => !asset.archived && referencedAssetIds.has(asset.id)),
    bindings: relevantBindings,
    scenes: activeScenes
  });
}

export function createProductionRevision(
  state: DirectorProductionState,
  input: { readonly directorSnapshot: string; readonly parentRevisionId?: string | null; readonly createdAt?: string }
): { readonly state: DirectorProductionState; readonly revision: ProductionRevision } {
  const parentRevisionId = input.parentRevisionId === undefined ? state.activeRevisionId : input.parentRevisionId;
  if (parentRevisionId !== null && !state.revisions.some((revision) => revision.id === parentRevisionId)) {
    throw new RangeError("Unknown parent production revision.");
  }
  const productionSnapshot = canonicalProductionSnapshot(state);
  const id = stableId("revision", {
    parentRevisionId,
    directorSnapshot: input.directorSnapshot,
    productionIdentity: productionContentIdentity(state)
  });
  const existing = state.revisions.find((revision) => revision.id === id);
  if (existing !== undefined) return immutableJsonCopy({ state, revision: existing });
  const revision: ProductionRevision = {
    id,
    parentRevisionId,
    // Kept outside the content identity: equal content and lineage keep one ID.
    createdAt: input.createdAt ?? "",
    directorSnapshot: input.directorSnapshot,
    productionSnapshot
  };
  return immutableJsonCopy({
    state: replaceState(state, { revisions: [...state.revisions, revision], activeRevisionId: id }),
    revision
  });
}

export function restoreProductionRevision(state: DirectorProductionState, revisionId: string): DirectorProductionState {
  const revision = state.revisions.find((candidate) => candidate.id === revisionId);
  if (revision === undefined) throw new RangeError("Unknown production revision.");
  const restored = asRecord(JSON.parse(revision.productionSnapshot));
  if (restored === null) throw new TypeError("Invalid production revision snapshot.");
  return normalizeProductionState({
    ...restored,
    revisions: state.revisions,
    activeRevisionId: revision.id
  });
}

export function migrateDirectorV5Draft(value: unknown): DirectorV5MigrationResult {
  const root = asRecord(value);
  if (root === null || root.version !== 5) {
    return immutableJsonCopy({
      state: createEmptyProductionState(),
      directorSnapshot: "",
      warnings: ["未识别为专业导播 v5 草稿，已建立空白制作数据。"]
    });
  }
  const draft = asRecord(root.draft);
  if (draft === null) {
    return immutableJsonCopy({
      state: createEmptyProductionState(),
      directorSnapshot: canonicalProductionJson(root),
      warnings: ["专业导播 v5 草稿缺少 draft，已建立空白制作数据。"]
    });
  }
  const workflowName = text(root.workflowName);
  let state = createEmptyProductionState({
    projectName: workflowName,
    identityKey: `director-v5:${workflowName}:${text(draft.mode)}`
  });
  const characterBible = text(draft.characterBible);
  const worldBible = text(draft.worldBible);
  const visualStyleBible = text(draft.visualStyleBible);
  const continuity = text(draft.continuity);
  state = replaceState(state, {
    project: {
      ...state.project,
      productionBibles: {
        characterWardrobeProps: characterBible,
        sceneWorld: worldBible,
        visualStyle: visualStyleBible,
        unstructuredContinuity: continuity
      },
      directorSettings: {
        language: text(draft.language) || "zh",
        mode: text(draft.mode) || "T2V",
        totalDurationSeconds: positiveInteger(draft.totalDurationSeconds, 30),
        segmentDurationSeconds: positiveInteger(draft.segmentDurationSeconds, 5),
        canvas: text(root.canvas) || "9:16",
        resolution: text(root.resolution) || "0.4",
        seed: text(root.seed) || "1",
        seedPolicy: normalizeRelaySeedPolicy(root.seedPolicy ?? root.seed_policy),
        sampling: text(root.sampling) || "quality_20",
        lastCompiledSnapshot: text(root.lastCompiledSnapshot)
      }
    }
  });
  state = upsertProductionScene(state, { title: "默认场景", identityKey: "director-v5-default-scene", order: 0 });
  const sceneId = state.scenes[0]?.id;
  if (sceneId === undefined) throw new Error("Failed to create migration scene.");
  const shots = Array.isArray(draft.shots) ? draft.shots : [];
  const warnings: string[] = [];
  if (shots.length === 0) warnings.push("v5 草稿没有可迁移的镜头。" );
  for (const [index, value] of shots.entries()) {
    const shot = asRecord(value);
    if (shot === null) {
      warnings.push(`已跳过无法识别的第 ${index + 1} 个镜头。`);
      continue;
    }
    const startSeconds = nonNegativeInteger(shot.startSeconds, index * state.project.directorSettings.segmentDurationSeconds);
    const durationSeconds = positiveInteger(shot.durationSeconds, state.project.directorSettings.segmentDurationSeconds);
    const migratedId = typeof shot.id === "string" && shot.id.startsWith("shot-") ? shot.id : null;
    state = assignShotToScene(state, sceneId, {
      ...(migratedId === null ? {} : { id: migratedId }),
      identityKey: `${text(draft.mode)}:${startSeconds}:${durationSeconds}`,
      startSeconds,
      durationSeconds,
      description: text(shot.description),
      cameraLanguage: text(shot.cameraLanguage),
      soundCue: text(shot.soundCue),
      transitionNote: text(shot.transitionNote)
    });
  }
  return immutableJsonCopy({ state, directorSnapshot: canonicalProductionJson(root), warnings });
}
