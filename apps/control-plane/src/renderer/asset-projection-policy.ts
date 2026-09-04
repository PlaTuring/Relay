import type {
  RelayAssetPurpose,
  RelayProjectDocument,
  RelayWorkflowMode
} from "../shared/project-domain";

export type DirectorBindingProjectionDisposition = "executable" | "record_only";

export interface LegacyQuickAssetMigrationResult {
  readonly project: RelayProjectDocument;
  readonly migratedAssetIds: readonly string[];
  readonly retainedLegacyAssetIds: readonly string[];
  readonly changed: boolean;
}

const REF2VA_EXECUTABLE_PURPOSES = new Set<RelayAssetPurpose>([
  "subject_reference",
  "product_reference",
  "scene_reference",
  "style_reference",
  "continuity_reference"
]);

export function directorBindingProjectionDisposition(
  mode: RelayWorkflowMode,
  purpose: RelayAssetPurpose
): DirectorBindingProjectionDisposition {
  if (mode === "T2V") return "record_only";
  if (mode === "FL2VA") {
    return purpose === "first_frame" || purpose === "last_frame" ? "executable" : "record_only";
  }
  return REF2VA_EXECUTABLE_PURPOSES.has(purpose) ? "executable" : "record_only";
}

/**
 * Converts the legacy quick.referenceAssetIds list into the explicit frame
 * slots consumed by the current compiler. Existing explicit selections always
 * win. Only locally available image records can be migrated; every other ID is
 * retained as visible legacy project metadata instead of being discarded.
 */
export function migrateLegacyQuickAssetReferences(
  project: RelayProjectDocument
): LegacyQuickAssetMigrationResult {
  const legacyIds = [...project.quick.referenceAssetIds];
  if (legacyIds.length === 0 || project.quick.mode === "T2V") {
    return Object.freeze({
      project,
      migratedAssetIds: Object.freeze([]),
      retainedLegacyAssetIds: Object.freeze(legacyIds),
      changed: false
    });
  }

  const assetsById = new Map(project.assets.map((asset) => [asset.assetId, asset]));
  const usableLegacyIds = legacyIds.filter((assetId) => {
    const asset = assetsById.get(assetId);
    return asset?.mediaType === "image" && asset.availability === "available";
  });
  let firstFrameAssetId = project.quick.firstFrameAssetId;
  let lastFrameAssetId = project.quick.lastFrameAssetId;
  const consumedIds = new Set<string>();
  if (firstFrameAssetId !== null) consumedIds.add(firstFrameAssetId);
  if (lastFrameAssetId !== null) consumedIds.add(lastFrameAssetId);

  const takeNextUsable = (): string | null => {
    const candidate = usableLegacyIds.find((assetId) => !consumedIds.has(assetId));
    if (candidate === undefined) return null;
    consumedIds.add(candidate);
    return candidate;
  };

  const migratedAssetIds: string[] = [];
  if (firstFrameAssetId === null) {
    firstFrameAssetId = takeNextUsable();
    if (firstFrameAssetId !== null) migratedAssetIds.push(firstFrameAssetId);
  }
  if (lastFrameAssetId === null) {
    lastFrameAssetId = takeNextUsable();
    if (lastFrameAssetId !== null) migratedAssetIds.push(lastFrameAssetId);
  }

  // Explicit slots (pre-existing or migrated above) supersede duplicate legacy
  // entries. IDs which could not be assigned remain available for recovery and
  // are presented as non-executable project metadata in the asset library.
  const explicitIds = new Set([firstFrameAssetId, lastFrameAssetId].filter((value): value is string => value !== null));
  const retainedLegacyAssetIds = legacyIds.filter((assetId) => !explicitIds.has(assetId));
  const changed = firstFrameAssetId !== project.quick.firstFrameAssetId
    || lastFrameAssetId !== project.quick.lastFrameAssetId
    || retainedLegacyAssetIds.length !== legacyIds.length;
  if (!changed) {
    return Object.freeze({
      project,
      migratedAssetIds: Object.freeze([]),
      retainedLegacyAssetIds: Object.freeze(legacyIds),
      changed: false
    });
  }

  return Object.freeze({
    project: {
      ...project,
      quick: {
        ...project.quick,
        firstFrameAssetId,
        lastFrameAssetId,
        referenceAssetIds: Object.freeze(retainedLegacyAssetIds)
      }
    },
    migratedAssetIds: Object.freeze(migratedAssetIds),
    retainedLegacyAssetIds: Object.freeze(retainedLegacyAssetIds),
    changed: true
  });
}
