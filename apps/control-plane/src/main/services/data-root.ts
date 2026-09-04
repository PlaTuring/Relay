import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
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
  rmdir,
  stat,
  writeFile
} from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve } from "node:path";

import { isRelayProjectId } from "../../shared/project-domain.js";

export const DATA_ROOT_POINTER_FILE = "data-root.pointer.json";
export const DATA_ROOT_POINTER_VERSION = 1 as const;

export interface DataRootPointer {
  readonly version: typeof DATA_ROOT_POINTER_VERSION;
  readonly dataRoot: string;
  readonly updatedAt: string;
}

export interface DataRootLayout {
  readonly root: string;
  readonly config: string;
  readonly applicationConfig: string;
  readonly installationConfig: string;
  readonly machineConfig: string;
  readonly uiConfig: string;
  readonly projects: string;
  readonly cache: string;
  readonly downloads: string;
  readonly logs: string;
  readonly runtime: string;
  readonly models: string;
}

export interface ProjectDirectoryLayout {
  readonly root: string;
  readonly document: string;
  readonly assetOriginals: string;
  readonly assetProxies: string;
  readonly assetThumbnails: string;
  readonly workflows: string;
  readonly recovery: string;
  readonly history: string;
  readonly exports: string;
}

export interface DataRootMigrationResult {
  readonly sourceRoot: string | null;
  readonly targetRoot: string;
  readonly mode: "new_library" | "migrate";
  readonly copiedFiles: number;
  readonly copiedBytes: number;
  readonly sourcePreserved: boolean;
}

export type DataRootFailureCode =
  | "DATA_ROOT_UNAVAILABLE"
  | "DATA_ROOT_NOT_FIXED_NTFS"
  | "DATA_ROOT_PERMISSION_DENIED"
  | "POINTER_READ_FAILED"
  | "POINTER_WRITE_FAILED";

const DATA_ROOT_FAILURE_MESSAGES: Readonly<Record<DataRootFailureCode, string>> = Object.freeze({
  DATA_ROOT_UNAVAILABLE: "Relay 数据目录不存在或当前不可访问。",
  DATA_ROOT_NOT_FIXED_NTFS: "Relay 数据目录必须位于本机固定 NTFS 磁盘，请重新选择目录。",
  DATA_ROOT_PERMISSION_DENIED: "Relay 没有权限读写所选数据目录，请选择其他目录或检查权限。",
  POINTER_READ_FAILED: "Relay 无法读取数据目录位置配置。",
  POINTER_WRITE_FAILED: "Relay 无法保存数据目录位置配置。"
});

export class DataRootFailure extends Error {
  readonly code: DataRootFailureCode;

  constructor(code: DataRootFailureCode, options?: ErrorOptions) {
    super(DATA_ROOT_FAILURE_MESSAGES[code], options);
    this.name = "DataRootFailure";
    this.code = code;
  }
}

/**
 * Deliberately contains no path.  This evidence is safe to include in startup
 * diagnostics and is also the injection seam used by the native path broker.
 */
export interface DataRootVolumeEvidence {
  readonly exists: boolean;
  readonly isDirectory: boolean;
  readonly fixedLocal: boolean;
  readonly filesystem: string | null;
  readonly driveType: string | null;
  readonly readable: boolean;
  readonly writable: boolean;
}

export type DataRootVolumeInspector = (
  candidatePath: string
) => DataRootVolumeEvidence | Promise<DataRootVolumeEvidence>;

export function classifyDataRootVolume(evidence: DataRootVolumeEvidence): DataRootFailureCode | null {
  if (!evidence.exists || !evidence.isDirectory) return "DATA_ROOT_UNAVAILABLE";
  if (!evidence.readable || !evidence.writable) return "DATA_ROOT_PERMISSION_DENIED";
  if (!evidence.fixedLocal || evidence.filesystem?.toLocaleLowerCase("en-US") !== "ntfs") {
    return "DATA_ROOT_NOT_FIXED_NTFS";
  }
  return null;
}

export async function validateDataRootLocation(
  candidatePath: string,
  inspector: DataRootVolumeInspector
): Promise<DataRootVolumeEvidence> {
  if (!isAbsolute(candidatePath) || candidatePath.includes("\0")) {
    throw new DataRootFailure("DATA_ROOT_UNAVAILABLE");
  }
  let evidence: DataRootVolumeEvidence;
  try {
    evidence = await inspector(resolve(candidatePath));
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (typeof code === "string" && code.startsWith("NATIVE_")) throw error;
    if (code === "DATA_ROOT_UNAVAILABLE" || code === "DATA_ROOT_NOT_FIXED_NTFS" || code === "DATA_ROOT_PERMISSION_DENIED") {
      throw new DataRootFailure(code, { cause: error });
    }
    if (code === "EACCES" || code === "EPERM") {
      throw new DataRootFailure("DATA_ROOT_PERMISSION_DENIED", { cause: error });
    }
    throw new DataRootFailure("DATA_ROOT_UNAVAILABLE", { cause: error });
  }
  const failure = classifyDataRootVolume(evidence);
  if (failure !== null) throw new DataRootFailure(failure, { cause: Object.freeze({ ...evidence }) });
  return Object.freeze({ ...evidence });
}

function samePath(left: string, right: string): boolean {
  return resolve(left).toLocaleLowerCase("en-US") === resolve(right).toLocaleLowerCase("en-US");
}

function isFilesystemRoot(path: string): boolean {
  const parsed = parse(resolve(path));
  return samePath(parsed.root, path);
}

function knownProgramDirectory(path: string): boolean {
  const candidate = resolve(path).toLocaleLowerCase("en-US");
  return [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.ProgramW6432]
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    .some((entry) => candidate === resolve(entry).toLocaleLowerCase("en-US") || candidate.startsWith(`${resolve(entry).toLocaleLowerCase("en-US")}\\`));
}

export function dataRootPointerPath(userDataPath: string): string {
  if (!isAbsolute(userDataPath)) throw new TypeError("Electron userData path must be absolute.");
  return join(userDataPath, DATA_ROOT_POINTER_FILE);
}

export function resolveDataRootLayout(dataRoot: string): DataRootLayout {
  const root = resolve(dataRoot);
  const config = join(root, "config");
  return Object.freeze({
    root,
    config,
    applicationConfig: join(config, "application.json"),
    installationConfig: join(config, "installation.json"),
    machineConfig: join(config, "machine.json"),
    uiConfig: join(config, "ui.json"),
    projects: join(root, "projects"),
    cache: join(root, "cache"),
    downloads: join(root, "downloads"),
    logs: join(root, "logs"),
    runtime: join(root, "runtime"),
    models: join(root, "models")
  });
}

export function resolveProjectDirectoryLayout(dataRoot: string, projectId: string): ProjectDirectoryLayout {
  if (!isRelayProjectId(projectId)) throw new TypeError("Invalid stable project ID.");
  const data = resolveDataRootLayout(dataRoot);
  const root = join(data.projects, projectId);
  return Object.freeze({
    root,
    document: join(root, "project.relay.json"),
    assetOriginals: join(root, "assets", "originals"),
    assetProxies: join(root, "assets", "proxies"),
    assetThumbnails: join(root, "assets", "thumbnails"),
    workflows: join(root, "workflows"),
    recovery: join(root, "recovery"),
    history: join(root, "history"),
    exports: join(root, "exports")
  });
}

async function assertDirectDirectory(path: string, allowCreate: boolean): Promise<string> {
  const absolute = resolve(path);
  if (!isAbsolute(path) || path.includes("\0") || isFilesystemRoot(absolute) || knownProgramDirectory(absolute)) {
    throw new TypeError("Relay dataRoot must be an explicit local data directory outside Program Files and filesystem roots.");
  }
  if (allowCreate) await mkdir(absolute, { recursive: true });
  const metadata = await lstat(absolute);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new TypeError("Relay dataRoot must be a normal local directory.");
  if (!samePath(await realpath(absolute), absolute)) throw new TypeError("Relay dataRoot cannot traverse a reparse point.");
  await access(absolute, fsConstants.R_OK | fsConstants.W_OK);
  return absolute;
}

async function assertDirectFile(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || !samePath(await realpath(path), path)) {
    throw new TypeError("Data migration encountered a non-regular file or reparse point.");
  }
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
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

export async function ensureDataRootLayout(dataRoot: string): Promise<DataRootLayout> {
  try {
    const root = await assertDirectDirectory(dataRoot, true);
    const layout = resolveDataRootLayout(root);
    await Promise.all([
      layout.config, layout.projects, layout.cache, layout.downloads, layout.logs, layout.runtime, layout.models
    ].map((path) => mkdir(path, { recursive: true })));
    for (const path of [layout.config, layout.projects, layout.cache, layout.downloads, layout.logs, layout.runtime, layout.models]) {
      await assertDirectDirectory(path, false);
    }
    return layout;
  } catch (error: unknown) {
    if (error instanceof DataRootFailure) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
      throw new DataRootFailure("DATA_ROOT_PERMISSION_DENIED", { cause: error });
    }
    if (code === "ENOENT") throw new DataRootFailure("DATA_ROOT_UNAVAILABLE", { cause: error });
    if (error instanceof TypeError) {
      throw new DataRootFailure("DATA_ROOT_NOT_FIXED_NTFS", { cause: error });
    }
    throw new DataRootFailure("DATA_ROOT_UNAVAILABLE", { cause: error });
  }
}

export async function ensureProjectDirectoryLayout(dataRoot: string, projectId: string): Promise<ProjectDirectoryLayout> {
  await ensureDataRootLayout(dataRoot);
  const layout = resolveProjectDirectoryLayout(dataRoot, projectId);
  await Promise.all([
    layout.root, layout.assetOriginals, layout.assetProxies, layout.assetThumbnails,
    layout.workflows, layout.recovery, layout.history, layout.exports
  ].map((path) => mkdir(path, { recursive: true })));
  for (const path of [layout.root, layout.assetOriginals, layout.assetProxies, layout.assetThumbnails, layout.workflows, layout.recovery, layout.history, layout.exports]) {
    await assertDirectDirectory(path, false);
  }
  return layout;
}

export async function loadDataRootPointer(
  userDataPath: string,
  options: { readonly strict?: boolean } = {}
): Promise<DataRootPointer | null> {
  try {
    const path = dataRootPointerPath(userDataPath);
    const metadata = await lstat(path);
    // Parent-directory redirection is explicitly supported for Electron
    // userData. Reject a pointer that is itself a link, but do not require its
    // parent's canonical path to equal the redirected path string.
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 4_096) {
      if (options.strict === true) throw new DataRootFailure("POINTER_READ_FAILED");
      return null;
    }
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      if (options.strict === true) throw new DataRootFailure("POINTER_READ_FAILED");
      return null;
    }
    const record = value as Record<string, unknown>;
    if (Object.keys(record).sort().join(",") !== "dataRoot,updatedAt,version" || record.version !== DATA_ROOT_POINTER_VERSION ||
      typeof record.dataRoot !== "string" || !isAbsolute(record.dataRoot) || record.dataRoot.includes("\0") ||
      typeof record.updatedAt !== "string" || !Number.isFinite(Date.parse(record.updatedAt))) {
      if (options.strict === true) throw new DataRootFailure("POINTER_READ_FAILED");
      return null;
    }
    const dataRoot = resolve(record.dataRoot);
    return Object.freeze({ version: DATA_ROOT_POINTER_VERSION, dataRoot, updatedAt: record.updatedAt });
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (options.strict === true) {
      if (error instanceof DataRootFailure) throw error;
      throw new DataRootFailure("POINTER_READ_FAILED", { cause: error });
    }
    return null;
  }
}

export async function saveDataRootPointer(userDataPath: string, dataRoot: string, now = new Date()): Promise<DataRootPointer> {
  const root = await assertDirectDirectory(dataRoot, false);
  const pointer = Object.freeze({ version: DATA_ROOT_POINTER_VERSION, dataRoot: root, updatedAt: now.toISOString() });
  try {
    await atomicWrite(dataRootPointerPath(userDataPath), pointer);
  } catch (error: unknown) {
    throw new DataRootFailure("POINTER_WRITE_FAILED", { cause: error });
  }
  return pointer;
}

async function directoryIsEmpty(path: string): Promise<boolean> {
  try {
    return (await readdir(path)).length === 0;
  } catch (error: unknown) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
}

async function sha256File(path: string): Promise<string> {
  return await new Promise<string>((resolveHash, rejectHash) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path, { highWaterMark: 4 * 1024 * 1024 });
    stream.on("data", (chunk: Buffer | string) => hash.update(chunk));
    stream.once("error", rejectHash);
    stream.once("end", () => resolveHash(hash.digest("hex")));
  });
}

function pathContains(parent: string, child: string): boolean {
  const back = relative(resolve(parent), resolve(child));
  return back.length > 0 && !back.startsWith("..") && !isAbsolute(back);
}

async function copyTreeVerified(source: string, target: string): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  const walk = async (sourceDirectory: string, targetDirectory: string): Promise<void> => {
    await mkdir(targetDirectory, { recursive: false }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    for (const entry of await readdir(sourceDirectory, { withFileTypes: true })) {
      const sourcePath = join(sourceDirectory, entry.name);
      const targetPath = join(targetDirectory, entry.name);
      const relation = relative(target, targetPath);
      if (relation.startsWith("..") || isAbsolute(relation)) throw new TypeError("Data migration target escaped its staging directory.");
      if (entry.isSymbolicLink()) throw new TypeError("Data migration refuses symbolic links and reparse points.");
      if (entry.isDirectory()) {
        await assertDirectDirectory(sourcePath, false);
        await walk(sourcePath, targetPath);
        continue;
      }
      if (!entry.isFile()) throw new TypeError("Data migration encountered an unsupported filesystem entry.");
      await assertDirectFile(sourcePath);
      const before = await stat(sourcePath);
      await copyFile(sourcePath, targetPath, fsConstants.COPYFILE_EXCL);
      const after = await stat(targetPath);
      const sourceAfter = await stat(sourcePath);
      if (!after.isFile() || before.size !== after.size || before.size !== sourceAfter.size || before.mtimeMs !== sourceAfter.mtimeMs) {
        throw new Error("Data migration copy verification failed or the source changed during migration.");
      }
      const [sourceHash, targetHash] = await Promise.all([sha256File(sourcePath), sha256File(targetPath)]);
      if (sourceHash !== targetHash) throw new Error("Data migration SHA-256 verification failed.");
      files += 1;
      bytes += after.size;
    }
  };
  await walk(source, target);
  return { files, bytes };
}

/**
 * Selects a new library or performs an explicit verified migration.
 * Migration is copy-verify-switch and deliberately preserves the source as a
 * recovery copy; deleting it is a separate, user-visible operation.
 */
export async function configureDataRoot(options: {
  readonly userDataPath: string;
  readonly targetRoot: string;
  readonly sourceRoot?: string | null;
  readonly mode: "new_library" | "migrate";
  readonly now?: Date;
}): Promise<DataRootMigrationResult> {
  const sourceRoot = options.sourceRoot === undefined || options.sourceRoot === null
    ? null
    : await assertDirectDirectory(options.sourceRoot, false);
  const target = resolve(options.targetRoot);
  if (sourceRoot !== null && samePath(sourceRoot, target)) {
    await ensureDataRootLayout(target);
    await saveDataRootPointer(options.userDataPath, target, options.now);
    return Object.freeze({ sourceRoot, targetRoot: target, mode: options.mode, copiedFiles: 0, copiedBytes: 0, sourcePreserved: true });
  }
  if (sourceRoot !== null && (pathContains(sourceRoot, target) || pathContains(target, sourceRoot))) {
    throw new TypeError("Source and target dataRoot directories cannot contain one another.");
  }
  if (options.mode === "migrate" && sourceRoot === null) throw new TypeError("A source dataRoot is required for migration.");
  if (!await directoryIsEmpty(target)) throw new TypeError("The selected target dataRoot must be empty for a new library or migration.");
  let targetExisted = false;
  try {
    await assertDirectDirectory(target, false);
    targetExisted = true;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      try {
        await lstat(target);
        throw error;
      } catch (nested: unknown) {
        if ((nested as NodeJS.ErrnoException).code !== "ENOENT") throw nested;
      }
    }
  }
  const parent = dirname(target);
  await assertDirectDirectory(parent, false);
  const staging = join(parent, `.relay-data-root-${randomUUID()}.staging`);
  let copied = { files: 0, bytes: 0 };
  try {
    if (options.mode === "migrate" && sourceRoot !== null) copied = await copyTreeVerified(sourceRoot, staging);
    else await mkdir(staging, { recursive: false });
    if (targetExisted) await rmdir(target);
    await rename(staging, target);
    await ensureDataRootLayout(target);
    await saveDataRootPointer(options.userDataPath, target, options.now);
    return Object.freeze({ sourceRoot, targetRoot: target, mode: options.mode, copiedFiles: copied.files, copiedBytes: copied.bytes, sourcePreserved: sourceRoot !== null });
  } catch (error) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    if (targetExisted) await mkdir(target, { recursive: true }).catch(() => undefined);
    throw error;
  }
}
