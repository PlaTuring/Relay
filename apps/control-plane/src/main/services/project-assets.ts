import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { copyFile, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, normalize, relative, resolve } from "node:path";

import {
  normalizeProjectRelativePath,
  normalizeRelayProject,
  type JsonValue,
  type RelayAssetAvailability,
  type RelayAssetBinding,
  type RelayAssetPurpose,
  type RelayBindingTargetKind,
  type RelayExternalReference,
  type RelayProjectAsset,
  type RelayProjectDocument
} from "../../shared/project-domain.js";
import {
  preflightLocalAsset,
  type AssetPreflightOptions,
  type AssetPreflightResult,
  type ProjectAssetMediaType
} from "./asset-preflight.js";

export type ProjectAssetImportMode = "copy" | "reference";

export interface ProjectAssetServiceOptions {
  readonly projectRoot: string;
  readonly loadProject: () => Promise<RelayProjectDocument>;
  readonly saveProject: (project: RelayProjectDocument) => Promise<void>;
  readonly resolveExternalReference: (referenceId: string) => Promise<string | null>;
  readonly saveExternalReference: (referenceId: string, absolutePath: string) => Promise<void>;
  readonly removeExternalReference?: (referenceId: string) => Promise<void>;
  readonly ffprobePath?: string | null;
  readonly ffprobeRunner?: (executable: string, arguments_: readonly string[]) => Promise<unknown>;
  readonly preflight?: (path: string, options?: AssetPreflightOptions) => Promise<AssetPreflightResult>;
  readonly createId?: () => string;
  readonly now?: () => Date;
}

export interface ProjectAssetImportRequest {
  readonly paths: readonly string[];
  readonly mode?: ProjectAssetImportMode;
  /** Main-process-only integrity contract used when importing a generated result. */
  readonly expectedSource?: {
    readonly sha256: string;
    readonly byteLength: number;
  };
}

export interface ProjectAssetImportItemResult {
  readonly fileName: string;
  readonly status: "imported" | "duplicate" | "rejected";
  readonly asset: RelayProjectAsset | null;
  readonly duplicateAssetId: string | null;
  readonly preflight: AssetPreflightResult;
}

export interface ProjectAssetImportBatchResult {
  readonly results: readonly ProjectAssetImportItemResult[];
  readonly importedCount: number;
  readonly duplicateCount: number;
  readonly rejectedCount: number;
}

export interface ProjectAssetView {
  readonly asset: RelayProjectAsset;
  readonly usageCount: number;
  readonly bindings: readonly RelayAssetBinding[];
}

export interface ProjectAssetListRequest {
  readonly query?: string;
  readonly mediaType?: ProjectAssetMediaType | "all";
  readonly availability?: RelayAssetAvailability | "all";
  readonly tags?: readonly string[];
}

export interface ProjectAssetRemovalResult {
  readonly status: "removed" | "in_use" | "not_found";
  readonly bindings: readonly RelayAssetBinding[];
  /** Project copies are deliberately retained as recoverable orphan files. */
  readonly retainedProjectRelativePath: string | null;
}

export interface ProjectAssetRestoreResult {
  readonly status: "restored" | "already_present" | "not_found" | "conflict";
  readonly asset: RelayProjectAsset | null;
}

export interface DeletedProjectAssetView {
  readonly assetId: string;
  readonly displayName: string;
  readonly mediaType: ProjectAssetMediaType;
  readonly deletedAt: string;
}

export interface ProjectAssetRelinkResult {
  readonly status: "relinked" | "replacement_required" | "rejected";
  readonly asset: RelayProjectAsset;
  readonly preflight: AssetPreflightResult;
}

export interface ProjectAssetCopyIntoProjectResult {
  readonly status: "copied" | "already_project_copy";
  readonly asset: RelayProjectAsset;
}

export interface ProjectAssetBindingRequest {
  readonly targetKind: RelayBindingTargetKind;
  readonly targetId: string;
  readonly assetId: string;
  readonly purpose: RelayAssetPurpose;
  readonly notes?: string;
}

export interface ProjectAssetService {
  readonly importAssets: (request: ProjectAssetImportRequest) => Promise<ProjectAssetImportBatchResult>;
  readonly listAssets: (request?: ProjectAssetListRequest) => Promise<readonly ProjectAssetView[]>;
  readonly updateAsset: (assetId: string, update: { readonly displayName?: string; readonly tags?: readonly string[]; readonly notes?: string }) => Promise<RelayProjectAsset>;
  readonly refreshAssets: () => Promise<readonly ProjectAssetView[]>;
  readonly relinkAsset: (assetId: string, path: string, acceptReplacement?: boolean) => Promise<ProjectAssetRelinkResult>;
  readonly copyAssetIntoProject: (assetId: string) => Promise<ProjectAssetCopyIntoProjectResult>;
  readonly bindAsset: (request: ProjectAssetBindingRequest) => Promise<RelayAssetBinding>;
  readonly unbindAsset: (bindingId: string) => Promise<boolean>;
  readonly removeAsset: (assetId: string) => Promise<ProjectAssetRemovalResult>;
  readonly listDeletedAssets: () => Promise<readonly DeletedProjectAssetView[]>;
  readonly restoreAsset: (assetId: string) => Promise<ProjectAssetRestoreResult>;
  readonly resolveUsableAssetPath: (assetId: string) => Promise<string>;
}

const MAX_IMPORTS = 512;
const MAX_DISPLAY_NAME = 160;
const MAX_NOTES = 4_000;
const MAX_TAGS = 32;
const MAX_TAG_LENGTH = 48;
const ID_HEX = /^[0-9a-f]{32}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const ASSET_ID = /^asset-[a-z0-9][a-z0-9-]{7,127}$/u;
const BINDING_ID = /^binding-[a-z0-9][a-z0-9-]{7,127}$/u;
const DELETED_ASSETS_SCHEMA_VERSION = 1 as const;
const MAX_DELETED_ASSETS_BYTES = 8 * 1024 * 1024;
const PURPOSES = new Set<RelayAssetPurpose>([
  "first_frame", "last_frame", "subject_reference", "product_reference", "scene_reference",
  "style_reference", "motion_reference", "video_reference", "audio_reference", "continuity_reference"
]);

function sameWindowsPath(left: string, right: string): boolean {
  return resolve(left).toLocaleLowerCase("en-US") === resolve(right).toLocaleLowerCase("en-US");
}

function stableId(prefix: "asset" | "reference" | "binding", factory: () => string): string {
  const raw = factory().replaceAll("-", "").toLocaleLowerCase("en-US");
  if (!ID_HEX.test(raw)) throw new TypeError("Stable project asset identifier generation failed.");
  return `${prefix}-${raw}`;
}

function boundedText(value: unknown, maximum: number, allowEmpty = true): string {
  if (typeof value !== "string" || value.length > maximum || value.includes("\u0000") || /[\u0001-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) {
    throw new TypeError("Project asset text is invalid.");
  }
  const trimmed = value.trim();
  if (!allowEmpty && trimmed.length === 0) throw new TypeError("Project asset text is required.");
  return trimmed;
}

function tags(value: readonly string[]): readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_TAGS) throw new TypeError("Project asset tags are invalid.");
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of value) {
    const tag = boundedText(raw, MAX_TAG_LENGTH, false);
    const key = tag.toLocaleLowerCase("zh-CN");
    if (!seen.has(key)) {
      seen.add(key);
      result.push(tag);
    }
  }
  return Object.freeze(result);
}

function safeCopyFileName(fileName: string, sha256: string): string {
  const suffix = extname(fileName).slice(0, 17).toLocaleLowerCase("en-US");
  let stem = basename(fileName, extname(fileName))
    .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "_")
    .replace(/[. ]+$/gu, "")
    .slice(0, 96);
  if (!stem) stem = "asset";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(stem)) stem = `_${stem}`;
  return `${stem}-${sha256.slice(0, 12)}${suffix}`;
}

function publicPreflight(preflight: AssetPreflightResult): JsonValue {
  return {
    status: preflight.status,
    fileName: preflight.fileName,
    extension: preflight.extension,
    detectedMime: preflight.detectedMime,
    mediaType: preflight.mediaType,
    byteLength: preflight.byteLength,
    sha256: preflight.sha256,
    image: preflight.image as unknown as JsonValue,
    video: preflight.video as unknown as JsonValue,
    audio: preflight.audio as unknown as JsonValue,
    checkedAt: preflight.checkedAt,
    issues: preflight.issues as unknown as JsonValue
  };
}

function availability(status: AssetPreflightResult["status"]): RelayAssetAvailability {
  if (status === "usable") return "available";
  return status === "check_failed" ? "inspection_failed" : status;
}

function validPreflight(preflight: AssetPreflightResult): preflight is AssetPreflightResult & {
  readonly canonicalPath: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly mediaType: ProjectAssetMediaType;
} {
  return preflight.status === "usable" && preflight.canonicalPath !== null && preflight.byteLength !== null && preflight.sha256 !== null && preflight.mediaType !== null;
}

async function requireProjectRoot(projectRoot: string): Promise<string> {
  if (!isAbsolute(projectRoot) || projectRoot.includes("\u0000")) throw new TypeError("Project root must be an absolute path.");
  const normalized = normalize(projectRoot);
  const metadata = await lstat(normalized);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new TypeError("Project root must be a direct directory.");
  const canonical = await realpath(normalized);
  if (!sameWindowsPath(canonical, normalized)) throw new TypeError("Project root cannot be a reparse path.");
  return canonical;
}

async function ensureDirectChildDirectory(parent: string, name: string, label: string): Promise<string> {
  const directory = join(parent, name);
  try {
    await mkdir(directory);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || !sameWindowsPath(await realpath(directory), directory)) {
    throw new TypeError(`${label} is not a direct directory.`);
  }
  const containment = relative(parent, directory);
  if (containment.startsWith("..") || isAbsolute(containment)) {
    throw new TypeError(`${label} escapes its parent.`);
  }
  return directory;
}

async function requireDirectAssetDirectory(projectRoot: string): Promise<string> {
  const canonicalRoot = await requireProjectRoot(projectRoot);
  const assets = await ensureDirectChildDirectory(canonicalRoot, "assets", "Project asset directory");
  const assetDirectory = await ensureDirectChildDirectory(assets, "originals", "Project asset originals directory");
  const containment = relative(canonicalRoot, assetDirectory);
  if (containment.startsWith("..") || isAbsolute(containment)) throw new TypeError("Project asset directory escapes its root.");
  return assetDirectory;
}

interface DeletedAssetRecord {
  readonly asset: RelayProjectAsset;
  readonly externalReference: RelayExternalReference | null;
  readonly deletedAt: string;
}

interface DeletedAssetManifest {
  readonly schemaVersion: typeof DELETED_ASSETS_SCHEMA_VERSION;
  readonly entries: readonly DeletedAssetRecord[];
}

async function requireRecoveryDirectory(projectRoot: string): Promise<string> {
  const canonicalRoot = await requireProjectRoot(projectRoot);
  const directory = await ensureDirectChildDirectory(canonicalRoot, "recovery", "Project recovery directory");
  const containment = relative(canonicalRoot, directory);
  if (containment.startsWith("..") || isAbsolute(containment)) {
    throw new TypeError("Project recovery directory escapes its root.");
  }
  return directory;
}

async function deletedAssetManifestPath(projectRoot: string): Promise<string> {
  return join(await requireRecoveryDirectory(projectRoot), "deleted-assets.v1.json");
}

async function readDeletedAssetManifest(projectRoot: string): Promise<DeletedAssetManifest> {
  const path = await deletedAssetManifestPath(projectRoot);
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_DELETED_ASSETS_BYTES) {
      throw new TypeError("Deleted asset recovery manifest is unsafe.");
    }
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new TypeError("Deleted asset recovery manifest is invalid.");
    }
    const input = parsed as Record<string, unknown>;
    if (input.schemaVersion !== DELETED_ASSETS_SCHEMA_VERSION || !Array.isArray(input.entries)) {
      throw new TypeError("Deleted asset recovery manifest version is invalid.");
    }
    const entries = input.entries.map((value): DeletedAssetRecord => {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("Deleted asset recovery entry is invalid.");
      }
      const entry = value as Record<string, unknown>;
      if (
        entry.asset === null || typeof entry.asset !== "object" || Array.isArray(entry.asset) ||
        typeof (entry.asset as Record<string, unknown>).assetId !== "string" ||
        !ASSET_ID.test((entry.asset as Record<string, unknown>).assetId as string) ||
        (entry.externalReference !== null && (typeof entry.externalReference !== "object" || Array.isArray(entry.externalReference))) ||
        typeof entry.deletedAt !== "string" || !Number.isFinite(Date.parse(entry.deletedAt))
      ) throw new TypeError("Deleted asset recovery entry is invalid.");
      return Object.freeze({
        asset: entry.asset as unknown as RelayProjectAsset,
        externalReference: entry.externalReference as RelayExternalReference | null,
        deletedAt: entry.deletedAt
      });
    });
    if (new Set(entries.map((entry) => entry.asset.assetId)).size !== entries.length) {
      throw new TypeError("Deleted asset recovery manifest contains duplicate entries.");
    }
    return Object.freeze({ schemaVersion: DELETED_ASSETS_SCHEMA_VERSION, entries: Object.freeze(entries) });
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return Object.freeze({ schemaVersion: DELETED_ASSETS_SCHEMA_VERSION, entries: Object.freeze([]) });
    }
    throw error;
  }
}

async function writeDeletedAssetManifest(projectRoot: string, manifest: DeletedAssetManifest): Promise<void> {
  const destination = await deletedAssetManifestPath(projectRoot);
  const temporary = `${destination}.tmp`;
  const payload = `${JSON.stringify(manifest, null, 2)}\n`;
  if (Buffer.byteLength(payload, "utf8") > MAX_DELETED_ASSETS_BYTES) {
    throw new TypeError("Deleted asset recovery manifest is too large.");
  }
  await writeFile(temporary, payload, { encoding: "utf8", flag: "w" });
  await rename(temporary, destination);
}

function targetExists(project: RelayProjectDocument, targetKind: RelayBindingTargetKind, targetId: string): boolean {
  if (targetKind === "project") return targetId === project.projectId;
  if (targetKind === "entity") return project.entities.some((entity) => entity.entityId === targetId);
  if (targetKind === "scene") return project.scenes.some((scene) => scene.sceneId === targetId);
  return project.shots.some((shot) => shot.shotId === targetId);
}

function purposeMatchesMedia(purpose: RelayAssetPurpose, mediaType: ProjectAssetMediaType): boolean {
  if (purpose === "first_frame" || purpose === "last_frame") return mediaType === "image";
  if (purpose === "audio_reference") return mediaType === "audio";
  if (purpose === "video_reference" || purpose === "motion_reference") return mediaType === "video";
  return true;
}

function replaceProjectAsset(project: RelayProjectDocument, asset: RelayProjectAsset, now: string): RelayProjectDocument {
  return normalizeRelayProject({
    ...project,
    updatedAt: now,
    assets: project.assets.map((entry) => entry.assetId === asset.assetId ? asset : entry)
  });
}

export function createProjectAssetService(options: ProjectAssetServiceOptions): ProjectAssetService {
  if (
    typeof options.loadProject !== "function" || typeof options.saveProject !== "function" ||
    typeof options.resolveExternalReference !== "function" || typeof options.saveExternalReference !== "function"
  ) throw new TypeError("Project asset service dependencies are invalid.");
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());
  const inspect = options.preflight ?? preflightLocalAsset;
  let serialized: Promise<void> = Promise.resolve();
  const run = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = serialized.then(operation, operation);
    serialized = next.then(() => undefined, () => undefined);
    return next;
  };

  const inspectPath = async (path: string, expected?: RelayProjectAsset): Promise<AssetPreflightResult> => await inspect(path, {
    ...(options.ffprobePath === undefined ? {} : { ffprobePath: options.ffprobePath }),
    ...(options.ffprobeRunner === undefined ? {} : { ffprobeRunner: options.ffprobeRunner }),
    expectedByteLength: expected?.byteLength ?? null,
    expectedSha256: expected?.sha256 ?? null
  });

  const locate = async (asset: RelayProjectAsset): Promise<string | null> => {
    if (asset.storageMode === "project_copy") {
      if (asset.projectRelativePath === null) return null;
      const relativePath = normalizeProjectRelativePath(asset.projectRelativePath, "assets/originals");
      const root = await requireProjectRoot(options.projectRoot);
      const target = resolve(root, relativePath);
      const containment = relative(root, target);
      return containment.startsWith("..") || isAbsolute(containment) ? null : target;
    }
    return asset.externalReferenceId === null ? null : await options.resolveExternalReference(asset.externalReferenceId);
  };

  const importAssets = async (request: ProjectAssetImportRequest): Promise<ProjectAssetImportBatchResult> => run(async () => {
    if (!Array.isArray(request.paths) || request.paths.length === 0 || request.paths.length > MAX_IMPORTS || request.paths.some((path) => typeof path !== "string")) {
      throw new TypeError("Import must contain between 1 and 512 local paths.");
    }
    const mode = request.mode ?? "copy";
    if (mode !== "copy" && mode !== "reference") throw new TypeError("Project asset import mode is invalid.");
    if (request.expectedSource !== undefined && (
      request.paths.length !== 1 || mode !== "copy"
      || !SHA256.test(request.expectedSource.sha256)
      || !Number.isSafeInteger(request.expectedSource.byteLength) || request.expectedSource.byteLength <= 0
    )) throw new TypeError("Expected generated-video source evidence is invalid.");
    const results: ProjectAssetImportItemResult[] = [];
    for (const path of request.paths) {
      const preflight = await inspectPath(path);
      if (request.expectedSource !== undefined && (!validPreflight(preflight)
        || preflight.sha256 !== request.expectedSource.sha256
        || preflight.byteLength !== request.expectedSource.byteLength)) {
        throw new TypeError("Generated-video source changed before project import; no project record was created.");
      }
      if (!validPreflight(preflight)) {
        results.push(Object.freeze({ fileName: preflight.fileName, status: "rejected", asset: null, duplicateAssetId: null, preflight }));
        continue;
      }
      let project = await options.loadProject();
      const duplicate = project.assets.find((asset) => asset.sha256 === preflight.sha256 && asset.byteLength === preflight.byteLength);
      if (duplicate !== undefined) {
        results.push(Object.freeze({ fileName: preflight.fileName, status: "duplicate", asset: duplicate, duplicateAssetId: duplicate.assetId, preflight }));
        continue;
      }

      const timestamp = now().toISOString();
      const assetId = stableId("asset", createId);
      let projectRelativePath: string | null = null;
      let externalReferenceId: string | null = null;
      let externalReference: RelayExternalReference | null = null;
      let newlyCreatedCopyPath: string | null = null;
      if (mode === "copy") {
        const assetDirectory = await requireDirectAssetDirectory(options.projectRoot);
        const fileName = safeCopyFileName(preflight.fileName, preflight.sha256);
        const target = join(assetDirectory, fileName);
        const root = await requireProjectRoot(options.projectRoot);
        const containment = relative(root, target);
        if (containment.startsWith("..") || isAbsolute(containment)) throw new TypeError("Project asset copy escapes its root.");
        let created = false;
        try {
          await copyFile(preflight.canonicalPath, target, fsConstants.COPYFILE_EXCL);
          created = true;
          newlyCreatedCopyPath = target;
        } catch (error: unknown) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
        const copied = await inspectPath(target);
        if (!validPreflight(copied) || copied.byteLength !== preflight.byteLength || copied.sha256 !== preflight.sha256) {
          if (created && request.expectedSource !== undefined) {
            await rm(target, { force: true }).catch(() => undefined);
            newlyCreatedCopyPath = null;
          } else if (created) {
            // Retain the mismatching file for forensic recovery; never erase a path after an uncertain copy.
          }
          throw new TypeError("Project asset copy verification failed; no project record was created.");
        }
        const sourceAfter = await inspectPath(preflight.canonicalPath, {
          assetId, displayName: preflight.fileName, sourceFileName: preflight.fileName,
          mediaType: preflight.mediaType, storageMode: "project_copy", projectRelativePath: "assets/originals/pending",
          externalReferenceId: null, byteLength: preflight.byteLength, sha256: preflight.sha256,
          tags: [], notes: "", availability: "available", inspection: null, createdAt: timestamp, updatedAt: timestamp
        });
        if (!validPreflight(sourceAfter)) throw new TypeError("Source asset changed during copy; no project record was created.");
        if (request.expectedSource !== undefined && (copied.sha256 !== request.expectedSource.sha256
          || copied.byteLength !== request.expectedSource.byteLength
          || sourceAfter.sha256 !== request.expectedSource.sha256
          || sourceAfter.byteLength !== request.expectedSource.byteLength)) {
          if (newlyCreatedCopyPath !== null) {
            await rm(newlyCreatedCopyPath, { force: true }).catch(() => undefined);
            newlyCreatedCopyPath = null;
          }
          throw new TypeError("Generated-video source changed during project import; no project record was created.");
        }
        projectRelativePath = normalizeProjectRelativePath(relative(root, target), "assets/originals");
      } else {
        externalReferenceId = stableId("reference", createId);
        await options.saveExternalReference(externalReferenceId, preflight.canonicalPath);
        externalReference = Object.freeze({
          referenceId: externalReferenceId,
          kind: "asset_file",
          displayName: preflight.fileName,
          locatorId: externalReferenceId,
          expectedSha256: preflight.sha256,
          attachOnly: true
        });
      }

      const asset: RelayProjectAsset = Object.freeze({
        assetId,
        displayName: basename(preflight.fileName, extname(preflight.fileName)).slice(0, MAX_DISPLAY_NAME) || preflight.fileName.slice(0, MAX_DISPLAY_NAME),
        sourceFileName: preflight.fileName,
        mediaType: preflight.mediaType,
        storageMode: mode === "copy" ? "project_copy" : "external_reference",
        projectRelativePath,
        externalReferenceId,
        byteLength: preflight.byteLength,
        sha256: preflight.sha256,
        tags: Object.freeze([]),
        notes: "",
        availability: "available",
        inspection: publicPreflight(preflight),
        createdAt: timestamp,
        updatedAt: timestamp
      });
      project = normalizeRelayProject({
        ...project,
        updatedAt: timestamp,
        assets: [...project.assets, asset],
        externalReferences: externalReference === null ? project.externalReferences : [...project.externalReferences, externalReference]
      });
      try {
        await options.saveProject(project);
      } catch (error: unknown) {
        if (externalReferenceId !== null && options.removeExternalReference !== undefined) await options.removeExternalReference(externalReferenceId).catch(() => undefined);
        if (request.expectedSource !== undefined && newlyCreatedCopyPath !== null) {
          await rm(newlyCreatedCopyPath, { force: true }).catch(() => undefined);
        }
        throw error;
      }
      results.push(Object.freeze({ fileName: preflight.fileName, status: "imported", asset, duplicateAssetId: null, preflight }));
    }
    return Object.freeze({
      results: Object.freeze(results),
      importedCount: results.filter((entry) => entry.status === "imported").length,
      duplicateCount: results.filter((entry) => entry.status === "duplicate").length,
      rejectedCount: results.filter((entry) => entry.status === "rejected").length
    });
  });

  const listAssets = async (request: ProjectAssetListRequest = {}): Promise<readonly ProjectAssetView[]> => {
    const project = await options.loadProject();
    const query = (request.query ?? "").trim().toLocaleLowerCase("zh-CN");
    const requestedTags = tags(request.tags ?? []).map((tag) => tag.toLocaleLowerCase("zh-CN"));
    return Object.freeze(project.assets
      .filter((asset) => request.mediaType === undefined || request.mediaType === "all" || asset.mediaType === request.mediaType)
      .filter((asset) => request.availability === undefined || request.availability === "all" || asset.availability === request.availability)
      .filter((asset) => query.length === 0 || `${asset.displayName}\n${asset.sourceFileName}\n${asset.notes}\n${asset.tags.join("\n")}`.toLocaleLowerCase("zh-CN").includes(query))
      .filter((asset) => requestedTags.every((tag) => asset.tags.some((candidate) => candidate.toLocaleLowerCase("zh-CN") === tag)))
      .map((asset) => {
        const bindings = Object.freeze(project.bindings.filter((binding) => binding.assetId === asset.assetId));
        return Object.freeze({ asset, usageCount: bindings.length, bindings });
      }));
  };

  const updateAsset = async (assetId: string, update: { readonly displayName?: string; readonly tags?: readonly string[]; readonly notes?: string }): Promise<RelayProjectAsset> => run(async () => {
    if (!ASSET_ID.test(assetId)) throw new TypeError("Project asset ID is invalid.");
    const project = await options.loadProject();
    const current = project.assets.find((asset) => asset.assetId === assetId);
    if (current === undefined) throw new TypeError("Project asset was not found.");
    const timestamp = now().toISOString();
    const updated: RelayProjectAsset = Object.freeze({
      ...current,
      displayName: update.displayName === undefined ? current.displayName : boundedText(update.displayName, MAX_DISPLAY_NAME, false),
      tags: update.tags === undefined ? current.tags : tags(update.tags),
      notes: update.notes === undefined ? current.notes : boundedText(update.notes, MAX_NOTES),
      updatedAt: timestamp
    });
    await options.saveProject(replaceProjectAsset(project, updated, timestamp));
    return updated;
  });

  const refreshAssets = async (): Promise<readonly ProjectAssetView[]> => run(async () => {
    let project = await options.loadProject();
    const timestamp = now().toISOString();
    const refreshed: RelayProjectAsset[] = [];
    for (const asset of project.assets) {
      const path = await locate(asset);
      const preflight = path === null
        ? Object.freeze({ status: "missing", fileName: asset.sourceFileName, canonicalPath: null, extension: extname(asset.sourceFileName).slice(1), detectedMime: null, mediaType: asset.mediaType, byteLength: null, sha256: null, image: null, video: null, audio: null, checkedAt: timestamp, issues: Object.freeze([{ code: "REFERENCE_MISSING", message: "外部素材引用无法解析。" }]) }) as AssetPreflightResult
        : await inspectPath(path, asset);
      refreshed.push(Object.freeze({ ...asset, availability: availability(preflight.status), inspection: publicPreflight(preflight), updatedAt: timestamp }));
    }
    project = normalizeRelayProject({ ...project, updatedAt: timestamp, assets: refreshed });
    await options.saveProject(project);
    return await listAssets();
  });

  const relinkAsset = async (assetId: string, path: string, acceptReplacement = false): Promise<ProjectAssetRelinkResult> => run(async () => {
    if (!ASSET_ID.test(assetId)) throw new TypeError("Project asset ID is invalid.");
    let project = await options.loadProject();
    const current = project.assets.find((asset) => asset.assetId === assetId);
    if (current === undefined) throw new TypeError("Project asset was not found.");
    const preflight = await inspectPath(path);
    if (!validPreflight(preflight) || preflight.mediaType !== current.mediaType) {
      return Object.freeze({ status: "rejected", asset: current, preflight });
    }
    const exact = preflight.sha256 === current.sha256 && preflight.byteLength === current.byteLength;
    if (!exact && !acceptReplacement) return Object.freeze({ status: "replacement_required", asset: current, preflight });
    const duplicate = project.assets.find((asset) => asset.assetId !== assetId && asset.sha256 === preflight.sha256);
    if (duplicate !== undefined) return Object.freeze({ status: "rejected", asset: current, preflight });
    const timestamp = now().toISOString();
    let projectRelativePath = current.projectRelativePath;
    if (current.storageMode === "project_copy") {
      const assetDirectory = await requireDirectAssetDirectory(options.projectRoot);
      const fileName = safeCopyFileName(preflight.fileName, preflight.sha256);
      const target = join(assetDirectory, fileName);
      try {
        await copyFile(preflight.canonicalPath, target, fsConstants.COPYFILE_EXCL);
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      const copied = await inspectPath(target);
      if (!validPreflight(copied) || copied.sha256 !== preflight.sha256 || copied.byteLength !== preflight.byteLength) throw new TypeError("Relink copy verification failed.");
      projectRelativePath = normalizeProjectRelativePath(relative(await requireProjectRoot(options.projectRoot), target), "assets/originals");
    } else if (current.externalReferenceId !== null) {
      await options.saveExternalReference(current.externalReferenceId, preflight.canonicalPath);
      project = normalizeRelayProject({
        ...project,
        externalReferences: project.externalReferences.map((reference) => reference.referenceId === current.externalReferenceId
          ? { ...reference, displayName: preflight.fileName, expectedSha256: preflight.sha256 }
          : reference)
      });
    }
    const updated: RelayProjectAsset = Object.freeze({
      ...current,
      sourceFileName: preflight.fileName,
      projectRelativePath,
      byteLength: preflight.byteLength,
      sha256: preflight.sha256,
      availability: "available",
      inspection: publicPreflight(preflight),
      updatedAt: timestamp
    });
    await options.saveProject(replaceProjectAsset(project, updated, timestamp));
    return Object.freeze({ status: "relinked", asset: updated, preflight });
  });

  const copyAssetIntoProject = async (assetId: string): Promise<ProjectAssetCopyIntoProjectResult> => run(async () => {
    if (!ASSET_ID.test(assetId)) throw new TypeError("Project asset ID is invalid.");
    const project = await options.loadProject();
    const current = project.assets.find((asset) => asset.assetId === assetId);
    if (current === undefined) throw new TypeError("Project asset was not found.");

    const sourcePath = await locate(current);
    if (sourcePath === null) throw new TypeError("Project asset is missing.");
    const sourceBefore = await inspectPath(sourcePath, current);
    if (!validPreflight(sourceBefore)) {
      throw new TypeError(sourceBefore.issues[0]?.message ?? "Project asset is not usable.");
    }
    if (current.storageMode === "project_copy") {
      return Object.freeze({ status: "already_project_copy", asset: current });
    }
    if (current.externalReferenceId === null) {
      throw new TypeError("External project asset reference is invalid.");
    }

    const assetDirectory = await requireDirectAssetDirectory(options.projectRoot);
    const projectRoot = await requireProjectRoot(options.projectRoot);
    const target = join(assetDirectory, safeCopyFileName(sourceBefore.fileName, sourceBefore.sha256));
    const containment = relative(projectRoot, target);
    if (containment.startsWith("..") || isAbsolute(containment)) {
      throw new TypeError("Project asset copy escapes its root.");
    }
    try {
      await copyFile(sourceBefore.canonicalPath, target, fsConstants.COPYFILE_EXCL);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const copied = await inspectPath(target);
    if (
      !validPreflight(copied) ||
      copied.byteLength !== sourceBefore.byteLength ||
      copied.sha256 !== sourceBefore.sha256 ||
      copied.mediaType !== current.mediaType
    ) {
      throw new TypeError("Project asset copy verification failed; the external reference was retained.");
    }
    const sourceAfter = await inspectPath(sourceBefore.canonicalPath, current);
    if (!validPreflight(sourceAfter)) {
      throw new TypeError("Source asset changed during copy; the external reference was retained.");
    }

    const timestamp = now().toISOString();
    const updated: RelayProjectAsset = Object.freeze({
      ...current,
      storageMode: "project_copy",
      projectRelativePath: normalizeProjectRelativePath(relative(projectRoot, target), "assets/originals"),
      externalReferenceId: null,
      availability: "available",
      inspection: publicPreflight(copied),
      updatedAt: timestamp
    });
    const nextProject = normalizeRelayProject({
      ...project,
      updatedAt: timestamp,
      assets: project.assets.map((asset) => asset.assetId === assetId ? updated : asset),
      externalReferences: project.externalReferences.filter(
        (reference) => reference.referenceId !== current.externalReferenceId
      )
    });
    await options.saveProject(nextProject);
    if (options.removeExternalReference !== undefined) {
      // The authoritative project now points only to its verified copy. A stale
      // private resolver is harmless, so cleanup failure must not roll back or
      // misreport the already completed copy transaction.
      await options.removeExternalReference(current.externalReferenceId).catch(() => undefined);
    }
    return Object.freeze({ status: "copied", asset: updated });
  });

  const bindAsset = async (request: ProjectAssetBindingRequest): Promise<RelayAssetBinding> => run(async () => {
    if (!ASSET_ID.test(request.assetId) || !PURPOSES.has(request.purpose) || !["project", "entity", "scene", "shot"].includes(request.targetKind)) {
      throw new TypeError("Project asset binding request is invalid.");
    }
    const project = await options.loadProject();
    const asset = project.assets.find((entry) => entry.assetId === request.assetId);
    if (asset === undefined || !targetExists(project, request.targetKind, request.targetId)) throw new TypeError("Binding target or asset was not found.");
    if (!purposeMatchesMedia(request.purpose, asset.mediaType)) throw new TypeError("Asset media type does not match the selected purpose.");
    const existing = project.bindings.find((binding) => binding.assetId === request.assetId && binding.targetKind === request.targetKind && binding.targetId === request.targetId && binding.purpose === request.purpose);
    if (existing !== undefined) return existing;
    const timestamp = now().toISOString();
    const binding: RelayAssetBinding = Object.freeze({
      bindingId: stableId("binding", createId), targetKind: request.targetKind, targetId: request.targetId,
      assetId: request.assetId, purpose: request.purpose, notes: boundedText(request.notes ?? "", MAX_NOTES), createdAt: timestamp
    });
    await options.saveProject(normalizeRelayProject({ ...project, updatedAt: timestamp, bindings: [...project.bindings, binding] }));
    return binding;
  });

  const unbindAsset = async (bindingId: string): Promise<boolean> => run(async () => {
    if (!BINDING_ID.test(bindingId)) throw new TypeError("Project binding ID is invalid.");
    const project = await options.loadProject();
    if (!project.bindings.some((binding) => binding.bindingId === bindingId)) return false;
    const timestamp = now().toISOString();
    await options.saveProject(normalizeRelayProject({ ...project, updatedAt: timestamp, bindings: project.bindings.filter((binding) => binding.bindingId !== bindingId) }));
    return true;
  });

  const removeAsset = async (assetId: string): Promise<ProjectAssetRemovalResult> => run(async () => {
    if (!ASSET_ID.test(assetId)) throw new TypeError("Project asset ID is invalid.");
    const project = await options.loadProject();
    const asset = project.assets.find((entry) => entry.assetId === assetId);
    if (asset === undefined) return Object.freeze({ status: "not_found", bindings: Object.freeze([]), retainedProjectRelativePath: null });
    const related = Object.freeze(project.bindings.filter((binding) => binding.assetId === assetId));
    const quickUse = project.quick.firstFrameAssetId === assetId || project.quick.lastFrameAssetId === assetId || project.quick.referenceAssetIds.includes(assetId);
    if (related.length > 0 || quickUse) return Object.freeze({ status: "in_use", bindings: related, retainedProjectRelativePath: asset.projectRelativePath });
    const timestamp = now().toISOString();
    const externalReference = asset.externalReferenceId === null
      ? null
      : project.externalReferences.find((reference) => reference.referenceId === asset.externalReferenceId) ?? null;
    const deleted = await readDeletedAssetManifest(options.projectRoot);
    const nextDeleted = Object.freeze({
      schemaVersion: DELETED_ASSETS_SCHEMA_VERSION,
      entries: Object.freeze([
        ...deleted.entries.filter((entry) => entry.asset.assetId !== assetId),
        Object.freeze({ asset, externalReference, deletedAt: timestamp })
      ])
    });
    await writeDeletedAssetManifest(options.projectRoot, nextDeleted);
    const next = normalizeRelayProject({
      ...project,
      updatedAt: timestamp,
      assets: project.assets.filter((entry) => entry.assetId !== assetId),
      externalReferences: asset.externalReferenceId === null ? project.externalReferences : project.externalReferences.filter((reference) => reference.referenceId !== asset.externalReferenceId)
    });
    await options.saveProject(next);
    // The private resolver and project copy are both retained for explicit recovery.
    // Neither an external source nor a project-owned file is deleted here.
    return Object.freeze({ status: "removed", bindings: Object.freeze([]), retainedProjectRelativePath: asset.projectRelativePath });
  });

  const listDeletedAssets = async (): Promise<readonly DeletedProjectAssetView[]> => run(async () => {
    const deleted = await readDeletedAssetManifest(options.projectRoot);
    return Object.freeze(deleted.entries
      .map((entry) => Object.freeze({
        assetId: entry.asset.assetId,
        displayName: entry.asset.displayName,
        mediaType: entry.asset.mediaType,
        deletedAt: entry.deletedAt
      }))
      .sort((left, right) => right.deletedAt.localeCompare(left.deletedAt)));
  });

  const restoreAsset = async (assetId: string): Promise<ProjectAssetRestoreResult> => run(async () => {
    if (!ASSET_ID.test(assetId)) throw new TypeError("Project asset ID is invalid.");
    const project = await options.loadProject();
    const present = project.assets.find((entry) => entry.assetId === assetId);
    if (present !== undefined) return Object.freeze({ status: "already_present", asset: present });
    const deleted = await readDeletedAssetManifest(options.projectRoot);
    const record = deleted.entries.find((entry) => entry.asset.assetId === assetId);
    if (record === undefined) return Object.freeze({ status: "not_found", asset: null });
    if (project.assets.some((entry) => entry.sha256 === record.asset.sha256 && entry.byteLength === record.asset.byteLength)) {
      return Object.freeze({ status: "conflict", asset: null });
    }
    const timestamp = now().toISOString();
    const next = normalizeRelayProject({
      ...project,
      updatedAt: timestamp,
      assets: [...project.assets, record.asset],
      externalReferences: record.externalReference === null || project.externalReferences.some(
        (reference) => reference.referenceId === record.externalReference?.referenceId
      ) ? project.externalReferences : [...project.externalReferences, record.externalReference]
    });
    await options.saveProject(next);
    await writeDeletedAssetManifest(options.projectRoot, Object.freeze({
      schemaVersion: DELETED_ASSETS_SCHEMA_VERSION,
      entries: Object.freeze(deleted.entries.filter((entry) => entry.asset.assetId !== assetId))
    }));
    return Object.freeze({ status: "restored", asset: record.asset });
  });

  const resolveUsableAssetPath = async (assetId: string): Promise<string> => {
    if (!ASSET_ID.test(assetId)) throw new TypeError("Project asset ID is invalid.");
    const project = await options.loadProject();
    const asset = project.assets.find((entry) => entry.assetId === assetId);
    if (asset === undefined) throw new TypeError("Project asset was not found.");
    const path = await locate(asset);
    if (path === null) throw new TypeError("Project asset is missing.");
    const preflight = await inspectPath(path, asset);
    if (!validPreflight(preflight)) throw new TypeError(preflight.issues[0]?.message ?? "Project asset is not usable.");
    return preflight.canonicalPath;
  };

  return Object.freeze({
    importAssets,
    listAssets,
    updateAsset,
    refreshAssets,
    relinkAsset,
    copyAssetIntoProject,
    bindAsset,
    unbindAsset,
    removeAsset,
    listDeletedAssets,
    restoreAsset,
    resolveUsableAssetPath
  });
}
