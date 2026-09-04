import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";

import {
  normalizeRelayProject,
  type RelayAssetBinding,
  type RelayProjectAsset,
  type RelayProjectDocument
} from "../../shared/project-domain.js";
import {
  ensureDataRootLayout,
  ensureProjectDirectoryLayout,
  resolveDataRootLayout,
  resolveProjectDirectoryLayout
} from "./data-root.js";
import {
  createProjectAssetService,
  type ProjectAssetBindingRequest,
  type ProjectAssetImportMode,
  type ProjectAssetCopyIntoProjectResult,
  type DeletedProjectAssetView,
  type ProjectAssetListRequest,
  type ProjectAssetRemovalResult,
  type ProjectAssetRestoreResult,
  type ProjectAssetService,
  type ProjectAssetView
} from "./project-assets.js";
import {
  createProjectAssetPreviewService,
  type ProjectAssetPreviewResult,
  type ProjectAssetPreviewService
} from "./project-asset-preview.js";
import {
  createProjectRepository,
  type RelayProjectRepository,
  type RelayProjectSummary,
  type RelayRecentProject
} from "./project-repository.js";
import {
  exportRelayProjectBundle,
  importRelayProjectBundle,
  inspectRelayProjectBundle,
  type RelayProjectBundleManifest
} from "./relay-project-bundle.js";
import type {
  AssetPreflightIssue,
  AssetPreflightOptions,
  AssetPreflightResult,
  AudioTechnicalInfo,
  ImageTechnicalInfo,
  ProjectAssetMediaType,
  VideoTechnicalInfo
} from "./asset-preflight.js";

const PRIVATE_REFERENCE_SCHEMA_VERSION = 1 as const;
const MAX_MACHINE_CONFIG_BYTES = 8 * 1024 * 1024;
const PRIVATE_REFERENCE_KEY = "relayPrivateReferences";
const PROJECT_ID = /^project-[a-z0-9][a-z0-9-]{7,127}$/u;
const ASSET_ID = /^asset-[a-z0-9][a-z0-9-]{7,127}$/u;
const REFERENCE_ID = /^reference-[a-z0-9][a-z0-9-]{7,127}$/u;

/**
 * Renderer-safe preflight result.  The canonical absolute path deliberately
 * does not cross the ProjectCenter service boundary.
 */
export interface ProjectCenterAssetPreflight {
  readonly status: AssetPreflightResult["status"];
  readonly fileName: string;
  readonly extension: string;
  readonly detectedMime: string | null;
  readonly mediaType: ProjectAssetMediaType | null;
  readonly byteLength: number | null;
  readonly sha256: string | null;
  readonly image: ImageTechnicalInfo | null;
  readonly video: VideoTechnicalInfo | null;
  readonly audio: AudioTechnicalInfo | null;
  readonly checkedAt: string;
  readonly issues: readonly AssetPreflightIssue[];
}

export interface ProjectCenterAssetImportItemResult {
  readonly fileName: string;
  readonly status: "imported" | "duplicate" | "rejected";
  readonly asset: RelayProjectAsset | null;
  readonly duplicateAssetId: string | null;
  readonly preflight: ProjectCenterAssetPreflight;
}

export interface ProjectCenterAssetImportBatchResult {
  readonly results: readonly ProjectCenterAssetImportItemResult[];
  readonly importedCount: number;
  readonly duplicateCount: number;
  readonly rejectedCount: number;
}

export interface ProjectCenterAssetRelinkResult {
  readonly status: "relinked" | "replacement_required" | "rejected";
  readonly asset: RelayProjectAsset;
  readonly preflight: ProjectCenterAssetPreflight;
}

export interface ProjectCenterRevealResult {
  readonly operationToken: string;
  readonly assetId: string;
  readonly displayName: string;
  readonly mediaType: RelayProjectAsset["mediaType"];
  readonly revealed: true;
}

export interface ProjectCenterBundleExportResult {
  readonly operationToken: string;
  readonly fileName: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly manifest: RelayProjectBundleManifest;
}

export interface ProjectCenterBundleInspectionResult {
  readonly fileName: string;
  readonly manifest: RelayProjectBundleManifest;
  readonly project: RelayProjectDocument;
  readonly archiveByteLength: number;
  readonly filesVerified: number;
}

export interface ProjectCenterBundleImportResult {
  readonly operationToken: string;
  readonly project: RelayProjectDocument;
  readonly importedFileCount: number;
  readonly copiedDueToConflict: boolean;
  readonly excludedExternalReferenceIds: readonly string[];
}

export interface ProjectCenterLibraryState {
  readonly libraryToken: string;
  readonly projectCount: number;
  readonly recentProjectCount: number;
}

export interface ProjectCenterServiceOptions {
  /** Fixed for the lifetime of this service instance. */
  readonly dataRoot: string;
  readonly ffprobePath?: string | null;
  /** Existing approved adapter; this service never starts a child process. */
  readonly ffprobeRunner?: (executable: string, arguments_: readonly string[]) => Promise<unknown>;
  readonly preflight?: (path: string, options?: AssetPreflightOptions) => Promise<AssetPreflightResult>;
  readonly renderImageThumbnail?: (sourcePath: string, outputPath: string) => Promise<void>;
  readonly renderVideoPoster?: (sourcePath: string, outputPath: string) => Promise<void>;
  /** Main-process-only callback, for example Electron shell.showItemInFolder. */
  readonly revealPath?: (absolutePath: string) => Promise<void> | void;
  readonly now?: () => Date;
  readonly createId?: () => string;
}

export interface ProjectCenterService {
  initialize(): Promise<ProjectCenterLibraryState>;
  listProjects(options?: { readonly includeArchived?: boolean }): Promise<readonly RelayProjectSummary[]>;
  listRecentProjects(): Promise<readonly RelayRecentProject[]>;
  createProject(input: { readonly name: string }): Promise<RelayProjectDocument>;
  loadProject(projectId: string): Promise<RelayProjectDocument>;
  saveProject(input: {
    readonly projectId: string;
    readonly project: RelayProjectDocument;
    readonly expectedUpdatedAt?: string | null;
  }): Promise<RelayProjectDocument>;
  cloneProject(projectId: string, input: { readonly name: string }): Promise<RelayProjectDocument>;
  archiveProject(projectId: string): Promise<RelayProjectDocument>;
  restoreProject(projectId: string): Promise<RelayProjectDocument>;
  importAssets(projectId: string, input: {
    readonly paths: readonly string[];
    readonly mode?: ProjectAssetImportMode;
    /** Not exposed through renderer IPC; generated-video integrity binding only. */
    readonly expectedSource?: {
      readonly sha256: string;
      readonly byteLength: number;
    };
  }): Promise<ProjectCenterAssetImportBatchResult>;
  listAssets(projectId: string, request?: ProjectAssetListRequest): Promise<readonly ProjectAssetView[]>;
  updateAsset(projectId: string, assetId: string, update: {
    readonly displayName?: string;
    readonly tags?: readonly string[];
    readonly notes?: string;
  }): Promise<RelayProjectAsset>;
  refreshAssets(projectId: string): Promise<readonly ProjectAssetView[]>;
  relinkAsset(projectId: string, assetId: string, selectedPath: string, acceptReplacement?: boolean): Promise<ProjectCenterAssetRelinkResult>;
  copyAssetIntoProject(projectId: string, assetId: string): Promise<ProjectAssetCopyIntoProjectResult>;
  bindAsset(projectId: string, request: ProjectAssetBindingRequest): Promise<RelayAssetBinding>;
  unbindAsset(projectId: string, bindingId: string): Promise<boolean>;
  removeAsset(projectId: string, assetId: string): Promise<ProjectAssetRemovalResult>;
  listDeletedAssets(projectId: string): Promise<readonly DeletedProjectAssetView[]>;
  restoreAsset(projectId: string, assetId: string): Promise<ProjectAssetRestoreResult>;
  getAssetPreview(projectId: string, assetId: string): Promise<ProjectAssetPreviewResult>;
  revealAsset(projectId: string, assetId: string): Promise<ProjectCenterRevealResult>;
  /** Main-process-only resolver. Never return its result through IPC or persist it in project JSON. */
  resolveUsableAssetPath(projectId: string, assetId: string): Promise<string>;
  inspectProjectBundle(bundlePath: string): Promise<ProjectCenterBundleInspectionResult>;
  exportProjectBundle(input: {
    readonly projectId: string;
    readonly destinationPath: string;
    readonly externalReferencePolicy?: "exclude" | "copy";
  }): Promise<ProjectCenterBundleExportResult>;
  importProjectBundle(input: {
    readonly bundlePath: string;
    readonly onProjectIdConflict?: "error" | "copy";
  }): Promise<ProjectCenterBundleImportResult>;
}

interface PrivateReferenceEntry {
  readonly absolutePath: string;
  readonly updatedAt: string;
}

interface PrivateReferenceSection {
  readonly schemaVersion: typeof PRIVATE_REFERENCE_SCHEMA_VERSION;
  readonly projects: Readonly<Record<string, Readonly<Record<string, PrivateReferenceEntry>>>>;
}

type MachineConfig = Readonly<Record<string, unknown>>;

function sameWindowsPath(left: string, right: string): boolean {
  return resolve(left).toLocaleLowerCase("en-US") === resolve(right).toLocaleLowerCase("en-US");
}

function requireProjectId(projectId: string): void {
  if (!PROJECT_ID.test(projectId)) throw new TypeError("项目标识无效。");
}

function requireAssetId(assetId: string): void {
  if (!ASSET_ID.test(assetId)) throw new TypeError("素材标识无效。");
}

function operationToken(prefix: string, createId: () => string): string {
  const raw = createId().replaceAll("-", "").toLocaleLowerCase("en-US");
  if (!/^[0-9a-f]{32}$/u.test(raw)) throw new TypeError("无法生成安全的操作标识。");
  return `${prefix}-${raw}`;
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    const handle = await open(temporary, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function readMachineConfig(path: string): Promise<MachineConfig> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_MACHINE_CONFIG_BYTES || !sameWindowsPath(await realpath(path), path)) {
      throw new TypeError("machine.json 不是可安全读取的普通配置文件。");
    }
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("machine.json 的结构无效。");
    return Object.freeze({ ...(value as Record<string, unknown>) });
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return Object.freeze({});
    throw error;
  }
}

function parsePrivateSection(config: MachineConfig): PrivateReferenceSection {
  const raw = config[PRIVATE_REFERENCE_KEY];
  if (raw === undefined) return Object.freeze({ schemaVersion: PRIVATE_REFERENCE_SCHEMA_VERSION, projects: Object.freeze({}) });
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new TypeError("machine.json 中的素材私有定位表无效，Relay 未覆盖它。");
  const section = raw as Record<string, unknown>;
  if (section.schemaVersion !== PRIVATE_REFERENCE_SCHEMA_VERSION || section.projects === null || typeof section.projects !== "object" || Array.isArray(section.projects)) {
    throw new TypeError("machine.json 中的素材私有定位表版本或结构不兼容，Relay 未覆盖它。");
  }
  const projects: Record<string, Readonly<Record<string, PrivateReferenceEntry>>> = {};
  for (const [projectId, rawReferences] of Object.entries(section.projects as Record<string, unknown>)) {
    if (!PROJECT_ID.test(projectId) || rawReferences === null || typeof rawReferences !== "object" || Array.isArray(rawReferences)) {
      throw new TypeError("machine.json 中存在无效项目定位记录，Relay 未覆盖它。");
    }
    const references: Record<string, PrivateReferenceEntry> = {};
    for (const [referenceId, rawEntry] of Object.entries(rawReferences as Record<string, unknown>)) {
      if (!REFERENCE_ID.test(referenceId) || rawEntry === null || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
        throw new TypeError("machine.json 中存在无效素材定位记录，Relay 未覆盖它。");
      }
      const entry = rawEntry as Record<string, unknown>;
      if (typeof entry.absolutePath !== "string" || !isAbsolute(entry.absolutePath) || typeof entry.updatedAt !== "string" || !Number.isFinite(Date.parse(entry.updatedAt))) {
        throw new TypeError("machine.json 中的素材定位值无效，Relay 未覆盖它。");
      }
      references[referenceId] = Object.freeze({ absolutePath: resolve(entry.absolutePath), updatedAt: entry.updatedAt });
    }
    projects[projectId] = Object.freeze(references);
  }
  return Object.freeze({ schemaVersion: PRIVATE_REFERENCE_SCHEMA_VERSION, projects: Object.freeze(projects) });
}

function publicPreflight(preflight: AssetPreflightResult): ProjectCenterAssetPreflight {
  return Object.freeze({
    status: preflight.status,
    fileName: preflight.fileName,
    extension: preflight.extension,
    detectedMime: preflight.detectedMime,
    mediaType: preflight.mediaType,
    byteLength: preflight.byteLength,
    sha256: preflight.sha256,
    image: preflight.image,
    video: preflight.video,
    audio: preflight.audio,
    checkedAt: preflight.checkedAt,
    issues: Object.freeze([...preflight.issues])
  });
}

async function requireDirectPrivateFile(path: string): Promise<string> {
  if (!isAbsolute(path) || path.includes("\u0000")) throw new TypeError("外部素材必须是绝对本地文件路径。");
  const candidate = resolve(path);
  const metadata = await lstat(candidate);
  if (!metadata.isFile() || metadata.isSymbolicLink() || !sameWindowsPath(await realpath(candidate), candidate)) {
    throw new TypeError("外部素材必须是未经过重解析的普通本地文件。");
  }
  return candidate;
}

export function createProjectCenterService(options: ProjectCenterServiceOptions): ProjectCenterService {
  if (!isAbsolute(options.dataRoot) || options.dataRoot.includes("\u0000")) throw new TypeError("ProjectCenter dataRoot 必须是绝对本地目录。");
  const dataRoot = resolve(options.dataRoot);
  const layout = resolveDataRootLayout(dataRoot);
  const repository: RelayProjectRepository = createProjectRepository({
    dataRoot,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.createId === undefined ? {} : { createId: options.createId })
  });
  const now = options.now ?? (() => new Date());
  const createId: () => string = options.createId ?? (() => randomUUID());
  const assetServices = new Map<string, ProjectAssetService>();
  const assetPreviewServices = new Map<string, ProjectAssetPreviewService>();
  const projectLocks = new Map<string, Promise<void>>();
  let machineLock: Promise<void> = Promise.resolve();

  const serializeProject = async <T>(projectId: string, operation: () => Promise<T>): Promise<T> => {
    requireProjectId(projectId);
    const previous = projectLocks.get(projectId) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const barrier = new Promise<void>((resolveBarrier) => { release = resolveBarrier; });
    const current = previous.then(() => barrier, () => barrier);
    projectLocks.set(projectId, current);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (projectLocks.get(projectId) === current) projectLocks.delete(projectId);
    }
  };

  const serializeMachine = async <T>(operation: () => Promise<T>): Promise<T> => {
    const previous = machineLock;
    let release: () => void = () => undefined;
    machineLock = new Promise<void>((resolveBarrier) => { release = resolveBarrier; });
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
    }
  };

  const updatePrivateSection = async (
    updater: (section: PrivateReferenceSection) => PrivateReferenceSection
  ): Promise<void> => serializeMachine(async () => {
    await ensureDataRootLayout(dataRoot);
    const config = await readMachineConfig(layout.machineConfig);
    const next = updater(parsePrivateSection(config));
    await atomicWriteJson(layout.machineConfig, { ...config, [PRIVATE_REFERENCE_KEY]: next });
    parsePrivateSection(await readMachineConfig(layout.machineConfig));
  });

  const resolvePrivateReference = async (projectId: string, referenceId: string): Promise<string | null> => serializeMachine(async () => {
    const config = await readMachineConfig(layout.machineConfig);
    const path = parsePrivateSection(config).projects[projectId]?.[referenceId]?.absolutePath ?? null;
    if (path === null) return null;
    try {
      return await requireDirectPrivateFile(path);
    } catch {
      return null;
    }
  });

  const savePrivateReference = async (projectId: string, referenceId: string, absolutePath: string): Promise<void> => {
    requireProjectId(projectId);
    if (!REFERENCE_ID.test(referenceId)) throw new TypeError("外部素材定位标识无效。");
    const path = await requireDirectPrivateFile(absolutePath);
    await updatePrivateSection((section) => {
      const projectReferences = { ...(section.projects[projectId] ?? {}) };
      projectReferences[referenceId] = Object.freeze({ absolutePath: path, updatedAt: now().toISOString() });
      return Object.freeze({
        schemaVersion: PRIVATE_REFERENCE_SCHEMA_VERSION,
        projects: Object.freeze({ ...section.projects, [projectId]: Object.freeze(projectReferences) })
      });
    });
  };

  const removePrivateReference = async (projectId: string, referenceId: string): Promise<void> => updatePrivateSection((section) => {
    const projectReferences = { ...(section.projects[projectId] ?? {}) };
    delete projectReferences[referenceId];
    const projects = { ...section.projects };
    if (Object.keys(projectReferences).length === 0) delete projects[projectId];
    else projects[projectId] = Object.freeze(projectReferences);
    return Object.freeze({ schemaVersion: PRIVATE_REFERENCE_SCHEMA_VERSION, projects: Object.freeze(projects) });
  });

  const copyPrivateReferences = async (sourceProjectId: string, targetProjectId: string): Promise<void> => updatePrivateSection((section) => {
    const source = section.projects[sourceProjectId];
    if (source === undefined || Object.keys(source).length === 0) return section;
    return Object.freeze({
      schemaVersion: PRIVATE_REFERENCE_SCHEMA_VERSION,
      projects: Object.freeze({ ...section.projects, [targetProjectId]: Object.freeze({ ...source }) })
    });
  });

  const assetService = async (projectId: string): Promise<ProjectAssetService> => {
    requireProjectId(projectId);
    const cached = assetServices.get(projectId);
    if (cached !== undefined) return cached;
    await repository.loadProject(projectId);
    const projectLayout = await ensureProjectDirectoryLayout(dataRoot, projectId);
    const service = createProjectAssetService({
      projectRoot: projectLayout.root,
      loadProject: async () => repository.loadProject(projectId),
      saveProject: async (project) => {
        const current = await repository.loadProject(projectId);
        await repository.saveProject(project, { expectedUpdatedAt: current.updatedAt });
      },
      resolveExternalReference: async (referenceId) => resolvePrivateReference(projectId, referenceId),
      saveExternalReference: async (referenceId, path) => savePrivateReference(projectId, referenceId, path),
      removeExternalReference: async (referenceId) => removePrivateReference(projectId, referenceId),
      ...(options.ffprobePath === undefined ? {} : { ffprobePath: options.ffprobePath }),
      ...(options.ffprobeRunner === undefined ? {} : { ffprobeRunner: options.ffprobeRunner }),
      ...(options.preflight === undefined ? {} : { preflight: options.preflight }),
      createId,
      now
    });
    assetServices.set(projectId, service);
    return service;
  };

  const assetPreviewService = async (projectId: string): Promise<ProjectAssetPreviewService> => {
    requireProjectId(projectId);
    const cached = assetPreviewServices.get(projectId);
    if (cached !== undefined) return cached;
    const projectLayout = await ensureProjectDirectoryLayout(dataRoot, projectId);
    const assets = await assetService(projectId);
    const preview = createProjectAssetPreviewService({
      projectRoot: projectLayout.root,
      loadAsset: async (assetId) => (await assets.listAssets()).find(
        (entry) => entry.asset.assetId === assetId
      )?.asset ?? null,
      resolveAssetPath: (assetId) => assets.resolveUsableAssetPath(assetId),
      ...(options.renderImageThumbnail === undefined ? {} : {
        renderImageThumbnail: options.renderImageThumbnail
      }),
      ...(options.renderVideoPoster === undefined ? {} : {
        renderVideoPoster: options.renderVideoPoster
      }),
      createId
    });
    assetPreviewServices.set(projectId, preview);
    return preview;
  };

  const service: ProjectCenterService = {
    async initialize() {
      await ensureDataRootLayout(dataRoot);
      const [projects, recent] = await Promise.all([repository.listProjects({ includeArchived: true }), repository.listRecentProjects()]);
      return Object.freeze({
        libraryToken: createHash("sha256").update(dataRoot.toLocaleLowerCase("en-US"), "utf8").digest("hex"),
        projectCount: projects.length,
        recentProjectCount: recent.length
      });
    },
    async listProjects(listOptions = {}) {
      return repository.listProjects(listOptions);
    },
    async listRecentProjects() {
      return repository.listRecentProjects();
    },
    async createProject(input) {
      return repository.createProject(input);
    },
    async loadProject(projectId) {
      const project = await repository.loadProject(projectId);
      await repository.recordRecentProject(projectId);
      return project;
    },
    async saveProject(input) {
      requireProjectId(input.projectId);
      return serializeProject(input.projectId, async () => {
        const project = normalizeRelayProject(input.project);
        if (project.projectId !== input.projectId) throw new TypeError("保存项目时，项目标识与请求不一致。");
        return repository.saveProject(project, {
          ...(input.expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt: input.expectedUpdatedAt })
        });
      });
    },
    async cloneProject(projectId, input) {
      return serializeProject(projectId, async () => {
        const cloned = await repository.cloneProject(projectId, input);
        await copyPrivateReferences(projectId, cloned.projectId);
        return cloned;
      });
    },
    async archiveProject(projectId) {
      return serializeProject(projectId, () => repository.archiveProject(projectId));
    },
    async restoreProject(projectId) {
      return serializeProject(projectId, () => repository.restoreProject(projectId));
    },
    async importAssets(projectId, input) {
      return serializeProject(projectId, async () => {
        const imported = await (await assetService(projectId)).importAssets(input);
        const preview = await assetPreviewService(projectId);
        const imageAssets = imported.results
          .filter((entry) => entry.status === "imported" && entry.asset?.mediaType === "image")
          .map((entry) => entry.asset!);
        // Native image decoding is bounded so a 30-item drop cannot create a
        // large, unbounded burst of decoder memory. Video posters stay lazy.
        let previewIndex = 0;
        await Promise.all(Array.from(
          { length: Math.min(4, imageAssets.length) },
          async () => {
            while (previewIndex < imageAssets.length) {
              const current = imageAssets[previewIndex++];
              if (current === undefined) break;
              await preview.getPreview(current.assetId);
            }
          }
        ));
        return Object.freeze({
          results: Object.freeze(imported.results.map((entry) => Object.freeze({
            fileName: entry.fileName,
            status: entry.status,
            asset: entry.asset,
            duplicateAssetId: entry.duplicateAssetId,
            preflight: publicPreflight(entry.preflight)
          }))),
          importedCount: imported.importedCount,
          duplicateCount: imported.duplicateCount,
          rejectedCount: imported.rejectedCount
        });
      });
    },
    async listAssets(projectId, request = {}) {
      return (await assetService(projectId)).listAssets(request);
    },
    async updateAsset(projectId, assetId, update) {
      return serializeProject(projectId, async () => (await assetService(projectId)).updateAsset(assetId, update));
    },
    async refreshAssets(projectId) {
      return serializeProject(projectId, async () => (await assetService(projectId)).refreshAssets());
    },
    async relinkAsset(projectId, assetId, selectedPath, acceptReplacement = false) {
      return serializeProject(projectId, async () => {
        const result = await (await assetService(projectId)).relinkAsset(assetId, selectedPath, acceptReplacement);
        return Object.freeze({ status: result.status, asset: result.asset, preflight: publicPreflight(result.preflight) });
      });
    },
    async copyAssetIntoProject(projectId, assetId) {
      return serializeProject(
        projectId,
        async () => (await assetService(projectId)).copyAssetIntoProject(assetId)
      );
    },
    async bindAsset(projectId, request) {
      return serializeProject(projectId, async () => (await assetService(projectId)).bindAsset(request));
    },
    async unbindAsset(projectId, bindingId) {
      return serializeProject(projectId, async () => (await assetService(projectId)).unbindAsset(bindingId));
    },
    async removeAsset(projectId, assetId) {
      return serializeProject(projectId, async () => (await assetService(projectId)).removeAsset(assetId));
    },
    async listDeletedAssets(projectId) {
      return serializeProject(projectId, async () => (await assetService(projectId)).listDeletedAssets());
    },
    async restoreAsset(projectId, assetId) {
      return serializeProject(projectId, async () => (await assetService(projectId)).restoreAsset(assetId));
    },
    async getAssetPreview(projectId, assetId) {
      requireProjectId(projectId);
      requireAssetId(assetId);
      return (await assetPreviewService(projectId)).getPreview(assetId);
    },
    async revealAsset(projectId, assetId) {
      requireAssetId(assetId);
      if (options.revealPath === undefined) throw new TypeError("当前主进程未配置显示素材所在目录能力。");
      const assets = await (await assetService(projectId)).listAssets();
      const asset = assets.find((entry) => entry.asset.assetId === assetId)?.asset;
      if (asset === undefined) throw new TypeError("素材不存在，无法显示所在目录。");
      const path = await (await assetService(projectId)).resolveUsableAssetPath(assetId);
      await options.revealPath(path);
      return Object.freeze({
        operationToken: operationToken("reveal", createId),
        assetId,
        displayName: asset.displayName,
        mediaType: asset.mediaType,
        revealed: true
      });
    },
    async resolveUsableAssetPath(projectId, assetId) {
      requireProjectId(projectId);
      requireAssetId(assetId);
      return (await assetService(projectId)).resolveUsableAssetPath(assetId);
    },
    async inspectProjectBundle(bundlePath) {
      if (!isAbsolute(bundlePath)) throw new TypeError("项目包检查源必须是文件选择器返回的绝对路径。");
      const inspected = await inspectRelayProjectBundle(bundlePath);
      return Object.freeze({
        fileName: basename(bundlePath),
        manifest: inspected.manifest,
        project: inspected.project,
        archiveByteLength: inspected.archiveByteLength,
        filesVerified: inspected.filesVerified
      });
    },
    async exportProjectBundle(input) {
      return serializeProject(input.projectId, async () => {
        const project = await repository.loadProject(input.projectId);
        const projectLayout = resolveProjectDirectoryLayout(dataRoot, input.projectId);
        const exported = await exportRelayProjectBundle({
          projectRoot: projectLayout.root,
          project,
          destinationPath: input.destinationPath,
          ...(input.externalReferencePolicy === undefined ? {} : { externalReferencePolicy: input.externalReferencePolicy }),
          resolveExternalReference: async (referenceId) => resolvePrivateReference(input.projectId, referenceId),
          ...(options.ffprobePath === undefined ? {} : { ffprobePath: options.ffprobePath }),
          ...(options.ffprobeRunner === undefined ? {} : { ffprobeRunner: options.ffprobeRunner }),
          now,
          createId
        });
        return Object.freeze({
          operationToken: operationToken("export", createId),
          fileName: basename(exported.destinationPath),
          byteLength: exported.byteLength,
          sha256: exported.sha256,
          manifest: exported.manifest
        });
      });
    },
    async importProjectBundle(input) {
      await ensureDataRootLayout(dataRoot);
      const imported = await importRelayProjectBundle({
        bundlePath: input.bundlePath,
        dataRoot,
        ...(input.onProjectIdConflict === undefined ? {} : { onProjectIdConflict: input.onProjectIdConflict }),
        now,
        createId
      });
      assetServices.delete(imported.project.projectId);
      assetPreviewServices.delete(imported.project.projectId);
      await repository.recordRecentProject(imported.project.projectId);
      return Object.freeze({
        operationToken: operationToken("import", createId),
        project: imported.project,
        importedFileCount: imported.importedFileCount,
        copiedDueToConflict: imported.copiedDueToConflict,
        excludedExternalReferenceIds: imported.excludedExternalReferenceIds
      });
    }
  };

  return Object.freeze(service);
}
