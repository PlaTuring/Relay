import { randomUUID } from "node:crypto";
import {
  constants as fsConstants,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import {
  canonicalRelayProjectJson,
  createEmptyRelayProject,
  isRelayProjectId,
  normalizeRelayProject,
  type RelayProjectDocument
} from "../../shared/project-domain.js";
import {
  ensureDataRootLayout,
  ensureProjectDirectoryLayout,
  resolveProjectDirectoryLayout
} from "./data-root.js";
import {
  isGeneratedVideoLocalIndexArtifactName,
  isGeneratedVideoPosterCacheArtifactName
} from "./generated-video-artifacts.js";

const MAX_PROJECT_BYTES = 64 * 1024 * 1024;
const APPLICATION_CONFIG_VERSION = 1 as const;
const MAX_RECENT_PROJECTS = 20;

export type ProjectRepositoryErrorCode =
  | "PROJECT_NOT_FOUND"
  | "PROJECT_ALREADY_EXISTS"
  | "PROJECT_CONFLICT"
  | "PROJECT_INVALID"
  | "PROJECT_IO_FAILED";

export class ProjectRepositoryError extends Error {
  public readonly code: ProjectRepositoryErrorCode;

  public constructor(code: ProjectRepositoryErrorCode, message: string) {
    super(message);
    this.name = "ProjectRepositoryError";
    this.code = code;
  }
}

export interface RelayProjectSummary {
  readonly projectId: string;
  readonly name: string;
  readonly editorMode: RelayProjectDocument["editorMode"];
  readonly status: RelayProjectDocument["status"];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
}

export interface RelayRecentProject extends RelayProjectSummary {
  readonly openedAt: string;
}

export interface CreateProjectRepositoryOptions {
  readonly dataRoot: string;
  readonly now?: () => Date;
  readonly createId?: () => string;
}

export interface RelayProjectRepository {
  readonly dataRoot: string;
  createProject(input: { readonly name: string }): Promise<RelayProjectDocument>;
  loadProject(projectId: string): Promise<RelayProjectDocument>;
  saveProject(project: RelayProjectDocument, options?: { readonly expectedUpdatedAt?: string | null }): Promise<RelayProjectDocument>;
  updateProject(
    projectId: string,
    updater: (project: RelayProjectDocument) => RelayProjectDocument,
    options?: { readonly expectedUpdatedAt?: string | null }
  ): Promise<RelayProjectDocument>;
  listProjects(options?: { readonly includeArchived?: boolean }): Promise<readonly RelayProjectSummary[]>;
  cloneProject(projectId: string, input: { readonly name: string }): Promise<RelayProjectDocument>;
  archiveProject(projectId: string): Promise<RelayProjectDocument>;
  restoreProject(projectId: string): Promise<RelayProjectDocument>;
  recordRecentProject(projectId: string): Promise<void>;
  listRecentProjects(): Promise<readonly RelayRecentProject[]>;
}

interface RecentEntry {
  readonly projectId: string;
  readonly openedAt: string;
}

interface ApplicationConfig {
  readonly schemaVersion: typeof APPLICATION_CONFIG_VERSION;
  readonly recentProjects: readonly RecentEntry[];
  readonly [key: string]: unknown;
}

function fail(code: ProjectRepositoryErrorCode, message: string): never {
  throw new ProjectRepositoryError(code, message);
}

function samePath(left: string, right: string): boolean {
  return resolve(left).toLocaleLowerCase("en-US") === resolve(right).toLocaleLowerCase("en-US");
}

function projectIdFrom(factory: () => string): string {
  const token = factory().replaceAll("-", "").toLocaleLowerCase("en-US");
  const projectId = `project-${token}`;
  if (!isRelayProjectId(projectId)) fail("PROJECT_INVALID", "无法生成安全的项目标识，请重试。");
  return projectId;
}

function summary(project: RelayProjectDocument): RelayProjectSummary {
  return Object.freeze({
    projectId: project.projectId,
    name: project.name,
    editorMode: project.editorMode,
    status: project.status,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    archivedAt: project.archivedAt
  });
}

async function directFile(path: string): Promise<boolean> {
  try {
    const metadata = await lstat(path);
    return metadata.isFile() && !metadata.isSymbolicLink() && samePath(await realpath(path), path);
  } catch {
    return false;
  }
}

async function directDirectory(path: string): Promise<boolean> {
  try {
    const metadata = await lstat(path);
    return metadata.isDirectory() && !metadata.isSymbolicLink() && samePath(await realpath(path), path);
  } catch {
    return false;
  }
}

async function atomicWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
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

async function readProjectFile(path: string, expectedProjectId?: string): Promise<RelayProjectDocument> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0 || metadata.size > MAX_PROJECT_BYTES || !samePath(await realpath(path), path)) {
      fail("PROJECT_INVALID", "项目文件无效、异常过大或经过了重解析。Relay 没有覆盖它。");
    }
    const project = normalizeRelayProject(JSON.parse(await readFile(path, "utf8")));
    if (expectedProjectId !== undefined && project.projectId !== expectedProjectId) {
      fail("PROJECT_INVALID", "项目文件标识与所在目录不一致。Relay 没有打开它。");
    }
    return project;
  } catch (error: unknown) {
    if (error instanceof ProjectRepositoryError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") fail("PROJECT_NOT_FOUND", "项目不存在或已被移动。");
    fail("PROJECT_INVALID", "项目文件无法读取或结构不兼容。原文件已保留。");
  }
}

async function copyDirectoryContents(
  source: string,
  target: string,
  excludeFileName: (fileName: string) => boolean = () => false
): Promise<void> {
  if (!await directDirectory(source) || !await directDirectory(target)) fail("PROJECT_IO_FAILED", "项目复制目录无效或经过了重解析。");
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);
    const back = relative(target, targetPath);
    if (back.startsWith("..") || isAbsolute(back)) fail("PROJECT_IO_FAILED", "项目复制目标越界。");
    if (entry.isSymbolicLink()) fail("PROJECT_IO_FAILED", "项目包含不允许复制的符号链接或重解析点。");
    if (entry.isDirectory()) {
      if (!await directDirectory(sourcePath)) fail("PROJECT_IO_FAILED", "项目子目录经过了重解析，已停止复制。");
      await mkdir(targetPath, { recursive: false });
      await copyDirectoryContents(sourcePath, targetPath, excludeFileName);
      continue;
    }
    if (!entry.isFile() || !await directFile(sourcePath)) fail("PROJECT_IO_FAILED", "项目包含不支持的文件系统对象。");
    if (excludeFileName(entry.name)) continue;
    await copyFile(sourcePath, targetPath, fsConstants.COPYFILE_EXCL);
  }
}

async function readApplicationConfig(path: string): Promise<ApplicationConfig> {
  try {
    if (!await directFile(path)) return Object.freeze({ schemaVersion: APPLICATION_CONFIG_VERSION, recentProjects: Object.freeze([]) });
    const metadata = await lstat(path);
    if (metadata.size > 1024 * 1024) return Object.freeze({ schemaVersion: APPLICATION_CONFIG_VERSION, recentProjects: Object.freeze([]) });
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (value === null || typeof value !== "object" || Array.isArray(value)) return Object.freeze({ schemaVersion: APPLICATION_CONFIG_VERSION, recentProjects: Object.freeze([]) });
    const source = value as Record<string, unknown>;
    const recentProjects: RecentEntry[] = [];
    if (Array.isArray(source.recentProjects)) {
      for (const entry of source.recentProjects.slice(0, MAX_RECENT_PROJECTS)) {
        if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
        const candidate = entry as Record<string, unknown>;
        if (isRelayProjectId(candidate.projectId) && typeof candidate.openedAt === "string" && Number.isFinite(Date.parse(candidate.openedAt))) {
          recentProjects.push({ projectId: candidate.projectId, openedAt: candidate.openedAt });
        }
      }
    }
    return Object.freeze({ ...source, schemaVersion: APPLICATION_CONFIG_VERSION, recentProjects: Object.freeze(recentProjects) });
  } catch {
    return Object.freeze({ schemaVersion: APPLICATION_CONFIG_VERSION, recentProjects: Object.freeze([]) });
  }
}

export function createProjectRepository(options: CreateProjectRepositoryOptions): RelayProjectRepository {
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? randomUUID;
  const dataRoot = resolve(options.dataRoot);
  const locks = new Map<string, Promise<void>>();

  const serialize = async <T>(key: string, operation: () => Promise<T>): Promise<T> => {
    const previous = locks.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const barrier = new Promise<void>((resolveBarrier) => { release = resolveBarrier; });
    const current = previous.then(() => barrier, () => barrier);
    locks.set(key, current);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (locks.get(key) === current) locks.delete(key);
    }
  };

  const loadProject = async (projectId: string): Promise<RelayProjectDocument> => {
    if (!isRelayProjectId(projectId)) fail("PROJECT_INVALID", "项目标识无效。");
    const layout = resolveProjectDirectoryLayout(dataRoot, projectId);
    return readProjectFile(layout.document, projectId);
  };

  const persist = async (
    project: RelayProjectDocument,
    saveOptions: { readonly expectedUpdatedAt?: string | null } = {}
  ): Promise<RelayProjectDocument> => serialize(project.projectId, async () => {
    await ensureDataRootLayout(dataRoot);
    const normalized = normalizeRelayProject(project);
    const layout = await ensureProjectDirectoryLayout(dataRoot, normalized.projectId);
    const exists = await directFile(layout.document);
    const current = exists ? await readProjectFile(layout.document, normalized.projectId) : null;
    if (saveOptions.expectedUpdatedAt !== undefined) {
      if (!exists && saveOptions.expectedUpdatedAt !== null) fail("PROJECT_CONFLICT", "项目已被移除，未覆盖未知状态。");
      if (current !== null && current.updatedAt !== saveOptions.expectedUpdatedAt) fail("PROJECT_CONFLICT", "项目已在另一操作中更新，请重新载入后再保存。");
    }
    const candidateTime = now().getTime();
    const minimumTime = current === null ? candidateTime : Date.parse(current.updatedAt) + 1;
    const updatedAt = new Date(Math.max(candidateTime, minimumTime)).toISOString();
    const next = normalizeRelayProject({ ...normalized, updatedAt });
    await atomicWrite(layout.document, `${canonicalRelayProjectJson(next)}\n`);
    const verified = await readProjectFile(layout.document, next.projectId);
    if (canonicalRelayProjectJson(verified) !== canonicalRelayProjectJson(next)) fail("PROJECT_IO_FAILED", "项目保存后的校验失败。");
    return verified;
  });

  const repository: RelayProjectRepository = {
    dataRoot,
    async createProject(input) {
      await ensureDataRootLayout(dataRoot);
      const projectId = projectIdFrom(createId);
      const createdAt = now().toISOString();
      const project = createEmptyRelayProject({ projectId, name: input.name, createdAt });
      const layout = resolveProjectDirectoryLayout(dataRoot, projectId);
      if (await directDirectory(layout.root)) fail("PROJECT_ALREADY_EXISTS", "项目标识已存在，请重试。");
      await ensureProjectDirectoryLayout(dataRoot, projectId);
      try {
        await atomicWrite(layout.document, `${canonicalRelayProjectJson(project)}\n`);
        await repository.recordRecentProject(projectId);
        return await readProjectFile(layout.document, projectId);
      } catch (error) {
        await rm(layout.root, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
    },
    loadProject,
    saveProject: persist,
    async updateProject(projectId, updater, saveOptions = {}) {
      if (typeof updater !== "function") fail("PROJECT_INVALID", "项目更新函数无效。");
      const current = await loadProject(projectId);
      if (saveOptions.expectedUpdatedAt !== undefined && saveOptions.expectedUpdatedAt !== current.updatedAt) {
        fail("PROJECT_CONFLICT", "项目版本已变化，请重新载入。");
      }
      const next = updater(current);
      if (next.projectId !== current.projectId || next.createdAt !== current.createdAt) {
        fail("PROJECT_INVALID", "项目更新不能改变稳定项目标识或创建时间。");
      }
      return persist(next, { expectedUpdatedAt: current.updatedAt });
    },
    async listProjects(listOptions = {}) {
      const layout = await ensureDataRootLayout(dataRoot);
      const projects: RelayProjectSummary[] = [];
      for (const entry of await readdir(layout.projects, { withFileTypes: true })) {
        if (!entry.isDirectory() || !isRelayProjectId(entry.name)) continue;
        const projectDirectory = join(layout.projects, entry.name);
        if (!await directDirectory(projectDirectory)) continue;
        try {
          const project = await readProjectFile(join(projectDirectory, "project.relay.json"), entry.name);
          if (listOptions.includeArchived === true || project.status !== "archived") projects.push(summary(project));
        } catch {
          // Invalid projects remain on disk for manual recovery and are not
          // silently rewritten by a list operation.
        }
      }
      return Object.freeze(projects.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
    },
    async cloneProject(projectId, input) {
      const source = await loadProject(projectId);
      const cloneId = projectIdFrom(createId);
      const sourceLayout = resolveProjectDirectoryLayout(dataRoot, projectId);
      const targetLayout = await ensureProjectDirectoryLayout(dataRoot, cloneId);
      try {
        for (const [sourceDirectory, targetDirectory, excludeFileName] of [
          [sourceLayout.assetOriginals, targetLayout.assetOriginals, undefined],
          [sourceLayout.assetProxies, targetLayout.assetProxies, undefined],
          [sourceLayout.assetThumbnails, targetLayout.assetThumbnails, isGeneratedVideoPosterCacheArtifactName],
          [sourceLayout.workflows, targetLayout.workflows, undefined],
          [sourceLayout.recovery, targetLayout.recovery, isGeneratedVideoLocalIndexArtifactName],
          [sourceLayout.history, targetLayout.history, undefined],
          [sourceLayout.exports, targetLayout.exports, undefined]
        ] as const) await copyDirectoryContents(sourceDirectory, targetDirectory, excludeFileName);
        // Generated-video discovery is machine-local evidence tied to the
        // source project ID and an external ComfyUI output directory. A cloned
        // project keeps ordinary recovery/history data but never inherits that
        // external result index or its disposable generated-video poster cache.
        const createdAt = now().toISOString();
        const cloned = normalizeRelayProject({
          ...source,
          projectId: cloneId,
          name: input.name,
          status: "active",
          createdAt,
          updatedAt: createdAt,
          archivedAt: null,
          bindings: source.bindings.map((binding) => binding.targetKind === "project" ? { ...binding, targetId: cloneId } : binding),
          workflows: source.workflows.map((workflow) => ({ ...workflow, handoffs: [] }))
        });
        await atomicWrite(targetLayout.document, `${canonicalRelayProjectJson(cloned)}\n`);
        await repository.recordRecentProject(cloneId);
        return await readProjectFile(targetLayout.document, cloneId);
      } catch (error) {
        await rm(targetLayout.root, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
    },
    async archiveProject(projectId) {
      const current = await loadProject(projectId);
      if (current.status === "archived") return current;
      const archivedAt = now().toISOString();
      return persist(normalizeRelayProject({ ...current, status: "archived", archivedAt }), { expectedUpdatedAt: current.updatedAt });
    },
    async restoreProject(projectId) {
      const current = await loadProject(projectId);
      if (current.status === "active") return current;
      const restored = await persist(
        normalizeRelayProject({ ...current, status: "active", archivedAt: null }),
        { expectedUpdatedAt: current.updatedAt }
      );
      await repository.recordRecentProject(restored.projectId);
      return restored;
    },
    async recordRecentProject(projectId) {
      if (!isRelayProjectId(projectId)) fail("PROJECT_INVALID", "项目标识无效。");
      await serialize("application-config", async () => {
        const layout = await ensureDataRootLayout(dataRoot);
        const config = await readApplicationConfig(layout.applicationConfig);
        const openedAt = now().toISOString();
        const recentProjects = [{ projectId, openedAt }, ...config.recentProjects.filter((entry) => entry.projectId !== projectId)]
          .slice(0, MAX_RECENT_PROJECTS);
        await atomicWrite(layout.applicationConfig, `${JSON.stringify({ ...config, schemaVersion: APPLICATION_CONFIG_VERSION, recentProjects }, null, 2)}\n`);
      });
    },
    async listRecentProjects() {
      const layout = await ensureDataRootLayout(dataRoot);
      const config = await readApplicationConfig(layout.applicationConfig);
      const result: RelayRecentProject[] = [];
      for (const entry of config.recentProjects) {
        try {
          const project = await loadProject(entry.projectId);
          result.push(Object.freeze({ ...summary(project), openedAt: entry.openedAt }));
        } catch {
          // Stale recent entries are ignored but retained until a successful
          // subsequent write, preserving recovery evidence.
        }
      }
      return Object.freeze(result);
    }
  };

  return Object.freeze(repository);
}
