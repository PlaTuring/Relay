import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  constants as fsConstants,
  copyFile,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve
} from "node:path";

import type {
  AssetAvailability,
  AssetCopyToProjectRequest,
  AssetCopyToProjectResult,
  AssetImportBatchResult,
  AssetImportItemResult,
  AssetLibraryApi,
  AssetListRequest,
  AssetListResult,
  AssetMediaType,
  AssetMetadataUpdateRequest,
  AssetPrepareFrameRequest,
  AssetRecord,
  AssetRefreshResult,
  AssetRelocateConfirmRequest,
  AssetRelocateConfirmResult,
  AssetRelocateRequest,
  AssetRelocateResult,
  AssetStorageMode,
  FrameSelection,
  FrameSlot
} from "../../shared/ipc-contract.js";
import { ControlPlaneServiceError } from "./errors.js";

const LEDGER_FILE = "relay-asset-library.private.v1.json";
const MAX_LEDGER_BYTES = 16 * 1024 * 1024;
const MAX_ASSETS = 10_000;
const MAX_DIALOG_SELECTIONS = 256;
const MAX_FILE_BYTES = Number.MAX_SAFE_INTEGER;
const MAX_DISPLAY_NAME = 160;
const MAX_NOTE_LENGTH = 4_000;
const MAX_TAGS = 32;
const MAX_TAG_LENGTH = 48;
const RELOCATION_TTL_MS = 10 * 60 * 1_000;
const ASSET_ID = /^asset-[0-9a-f]{32}$/u;
const RELOCATION_TOKEN = /^relocate-[0-9a-f]{32}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

const EXTENSION_TYPES = Object.freeze<Record<string, AssetMediaType>>({
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  bmp: "image",
  gif: "image",
  tif: "image",
  tiff: "image",
  mp4: "video",
  mov: "video",
  m4v: "video",
  mkv: "video",
  webm: "video",
  avi: "video",
  mpg: "video",
  mpeg: "video",
  wav: "audio",
  mp3: "audio",
  flac: "audio",
  m4a: "audio",
  aac: "audio",
  ogg: "audio",
  opus: "audio"
});

export const ASSET_DIALOG_FILTERS = Object.freeze([
  Object.freeze({ name: "图片", extensions: Object.freeze(["png", "jpg", "jpeg", "webp", "bmp", "gif", "tif", "tiff"]) }),
  Object.freeze({ name: "视频", extensions: Object.freeze(["mp4", "mov", "m4v", "mkv", "webm", "avi", "mpg", "mpeg"]) }),
  Object.freeze({ name: "音频", extensions: Object.freeze(["wav", "mp3", "flac", "m4a", "aac", "ogg", "opus"]) })
]);

interface NativeDialogResult {
  readonly canceled: boolean;
  readonly filePaths: readonly string[];
}

interface PrivateAssetRecord {
  readonly assetId: string;
  readonly displayName: string;
  readonly sourceFileName: string;
  readonly mediaType: AssetMediaType;
  readonly extension: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly tags: readonly string[];
  readonly note: string;
  readonly storageMode: AssetStorageMode;
  readonly availability: AssetAvailability;
  readonly projectRelativePath: string | null;
  readonly originalAbsolutePath: string;
  readonly activeAbsolutePath: string;
  readonly projectRootAbsolutePath: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface PrivateLedger {
  readonly version: 1;
  readonly assets: readonly PrivateAssetRecord[];
}

interface InspectedFile {
  readonly absolutePath: string;
  readonly sourceFileName: string;
  readonly mediaType: AssetMediaType;
  readonly extension: string;
  readonly byteLength: number;
  readonly sha256: string;
}

interface PendingRelocation {
  readonly assetId: string;
  readonly candidate: InspectedFile;
  readonly expiresAt: number;
}

export interface CreateAssetLibraryServiceOptions {
  readonly userDataPath: string;
  readonly chooseAssetFiles: () => Promise<NativeDialogResult>;
  readonly chooseProjectDirectory: () => Promise<NativeDialogResult>;
  readonly chooseRelocationFile: (mediaType: AssetMediaType) => Promise<NativeDialogResult>;
  readonly registerFrameSelection: (
    absolutePath: string,
    slot: FrameSlot
  ) => Promise<FrameSelection>;
  readonly now?: () => Date;
  readonly createId?: () => string;
}

export interface AssetLibraryService extends AssetLibraryApi {}

function fail(
  code: "INVALID_REQUEST" | "ASSET_LIBRARY_FAILED" | "ASSET_NOT_FOUND" | "ASSET_CHANGED",
  message: string
): never {
  throw new ControlPlaneServiceError(code, message);
}

function sameWindowsPath(left: string, right: string): boolean {
  return resolve(left).toLocaleLowerCase("en-US") === resolve(right).toLocaleLowerCase("en-US");
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function boundedString(value: unknown, maximum: number, allowEmpty = false): string | null {
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    value.includes("\u0000") ||
    /[\u0001-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)
  ) return null;
  const trimmed = value.trim();
  return allowEmpty || trimmed.length > 0 ? trimmed : null;
}

function normalizeTags(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length > MAX_TAGS) return null;
  const result: string[] = [];
  const keys = new Set<string>();
  for (const candidate of value) {
    const tag = boundedString(candidate, MAX_TAG_LENGTH);
    if (tag === null) return null;
    const key = tag.toLocaleLowerCase("zh-CN");
    if (keys.has(key)) continue;
    keys.add(key);
    result.push(tag);
  }
  return Object.freeze(result);
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validAbsolutePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 32_767 &&
    !value.includes("\u0000") &&
    isAbsolute(value)
  );
}

function safeProjectRelativePath(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return false;
  const canonical = value.replaceAll("\\", "/");
  return canonical.startsWith("assets/") && !canonical.split("/").includes("..") && !isAbsolute(value);
}

function parsePrivateAsset(value: unknown): PrivateAssetRecord | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!exactKeys(record, [
    "assetId", "displayName", "sourceFileName", "mediaType", "extension", "byteLength",
    "sha256", "tags", "note", "storageMode", "availability", "projectRelativePath",
    "originalAbsolutePath", "activeAbsolutePath", "projectRootAbsolutePath", "createdAt", "updatedAt"
  ])) return null;
  const displayName = boundedString(record.displayName, MAX_DISPLAY_NAME);
  const sourceFileName = boundedString(record.sourceFileName, 255);
  const extension = boundedString(record.extension, 16);
  const tags = normalizeTags(record.tags);
  const note = boundedString(record.note, MAX_NOTE_LENGTH, true);
  if (
    typeof record.assetId !== "string" || !ASSET_ID.test(record.assetId) ||
    displayName === null || sourceFileName === null || extension === null ||
    (record.mediaType !== "image" && record.mediaType !== "video" && record.mediaType !== "audio") ||
    EXTENSION_TYPES[extension] !== record.mediaType ||
    typeof record.byteLength !== "number" || !Number.isSafeInteger(record.byteLength) ||
    record.byteLength < 0 || record.byteLength > MAX_FILE_BYTES ||
    typeof record.sha256 !== "string" || !SHA256.test(record.sha256) ||
    tags === null || note === null ||
    (record.storageMode !== "reference_original" && record.storageMode !== "project_copy") ||
    (record.availability !== "available" && record.availability !== "missing" && record.availability !== "changed") ||
    !safeProjectRelativePath(record.projectRelativePath) ||
    !validAbsolutePath(record.originalAbsolutePath) || !validAbsolutePath(record.activeAbsolutePath) ||
    (record.projectRootAbsolutePath !== null && !validAbsolutePath(record.projectRootAbsolutePath)) ||
    !validTimestamp(record.createdAt) || !validTimestamp(record.updatedAt)
  ) return null;
  if (
    record.storageMode === "reference_original" &&
    (
      record.projectRelativePath !== null || record.projectRootAbsolutePath !== null ||
      !sameWindowsPath(record.activeAbsolutePath, record.originalAbsolutePath)
    )
  ) return null;
  if (
    record.storageMode === "project_copy" &&
    (
      record.projectRelativePath === null || record.projectRootAbsolutePath === null ||
      !sameWindowsPath(
        record.activeAbsolutePath,
        join(record.projectRootAbsolutePath, record.projectRelativePath)
      )
    )
  ) return null;
  return Object.freeze({
    assetId: record.assetId,
    displayName,
    sourceFileName,
    mediaType: record.mediaType,
    extension,
    byteLength: record.byteLength,
    sha256: record.sha256,
    tags,
    note,
    storageMode: record.storageMode,
    availability: record.availability,
    projectRelativePath: record.projectRelativePath,
    originalAbsolutePath: record.originalAbsolutePath,
    activeAbsolutePath: record.activeAbsolutePath,
    projectRootAbsolutePath: record.projectRootAbsolutePath,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  });
}

function publicAsset(asset: PrivateAssetRecord): AssetRecord {
  return Object.freeze({
    assetId: asset.assetId,
    displayName: asset.displayName,
    sourceFileName: asset.sourceFileName,
    mediaType: asset.mediaType,
    extension: asset.extension,
    byteLength: asset.byteLength,
    sha256: asset.sha256,
    tags: Object.freeze([...asset.tags]),
    note: asset.note,
    storageMode: asset.storageMode,
    availability: asset.availability,
    projectRelativePath: asset.projectRelativePath,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt
  });
}

function assetIdFrom(factory: () => string): string {
  const value = factory().replaceAll("-", "").toLocaleLowerCase("en-US");
  if (!/^[0-9a-f]{32}$/u.test(value)) fail("ASSET_LIBRARY_FAILED", "素材标识生成失败，请重试。");
  return `asset-${value}`;
}

function relocationTokenFrom(factory: () => string): string {
  const value = factory().replaceAll("-", "").toLocaleLowerCase("en-US");
  if (!/^[0-9a-f]{32}$/u.test(value)) fail("ASSET_LIBRARY_FAILED", "素材重定位凭据生成失败，请重试。");
  return `relocate-${value}`;
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

async function inspectFile(path: string): Promise<InspectedFile> {
  if (!validAbsolutePath(path)) fail("INVALID_REQUEST", "系统返回了无效的本地素材路径。");
  const normalizedPath = normalize(path);
  const extension = extname(normalizedPath).slice(1).toLocaleLowerCase("en-US");
  const mediaType = EXTENSION_TYPES[extension];
  if (mediaType === undefined) fail("INVALID_REQUEST", "请选择受支持的图片、视频或音频文件。");
  try {
    const before = await lstat(normalizedPath, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink()) {
      fail("INVALID_REQUEST", "请选择普通本地文件，不能选择目录、符号链接或重解析点。");
    }
    const canonical = await realpath(normalizedPath);
    if (!sameWindowsPath(canonical, normalizedPath)) {
      fail("INVALID_REQUEST", "素材路径经过重解析，已停止读取。");
    }
    if (before.size < 0n || before.size > BigInt(MAX_FILE_BYTES)) {
      fail("INVALID_REQUEST", "素材文件大小超出本机安全处理范围。");
    }
    const digest = await sha256File(normalizedPath);
    const after = await lstat(normalizedPath, { bigint: true });
    if (
      !after.isFile() || after.isSymbolicLink() ||
      after.size !== before.size || after.mtimeNs !== before.mtimeNs
    ) fail("ASSET_CHANGED", "素材在校验期间发生变化，请等待文件写入完成后重试。");
    return Object.freeze({
      absolutePath: normalizedPath,
      sourceFileName: basename(normalizedPath),
      mediaType,
      extension,
      byteLength: Number(after.size),
      sha256: digest
    });
  } catch (error: unknown) {
    if (error instanceof ControlPlaneServiceError) throw error;
    fail("ASSET_LIBRARY_FAILED", "无法读取所选本地素材，请检查文件是否存在且具有读取权限。");
  }
}

async function inspectAvailability(asset: PrivateAssetRecord): Promise<AssetAvailability> {
  try {
    const candidate = await inspectFile(asset.activeAbsolutePath);
    return candidate.byteLength === asset.byteLength && candidate.sha256 === asset.sha256
      ? "available"
      : "changed";
  } catch (error: unknown) {
    const code = error instanceof ControlPlaneServiceError ? error.code : null;
    return code === "ASSET_CHANGED" ? "changed" : "missing";
  }
}

async function fileStillPresent(path: string): Promise<boolean> {
  try {
    const metadata = await lstat(path);
    return metadata.isFile() && !metadata.isSymbolicLink() && sameWindowsPath(await realpath(path), path);
  } catch {
    return false;
  }
}

async function safeProjectDirectory(root: string): Promise<string> {
  if (!validAbsolutePath(root)) fail("INVALID_REQUEST", "系统返回了无效的项目目录。");
  const normalizedRoot = normalize(root);
  try {
    const rootInfo = await lstat(normalizedRoot);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
      fail("INVALID_REQUEST", "项目目录不能是文件、符号链接或重解析点。");
    }
    if (!sameWindowsPath(await realpath(normalizedRoot), normalizedRoot)) {
      fail("INVALID_REQUEST", "项目目录经过重解析，已停止复制。");
    }
    const assetDirectory = join(normalizedRoot, "assets");
    await mkdir(assetDirectory, { recursive: true });
    const assetInfo = await lstat(assetDirectory);
    if (!assetInfo.isDirectory() || assetInfo.isSymbolicLink()) {
      fail("INVALID_REQUEST", "项目素材目录不是安全的普通目录。");
    }
    if (!sameWindowsPath(await realpath(assetDirectory), assetDirectory)) {
      fail("INVALID_REQUEST", "项目素材目录经过重解析，已停止复制。");
    }
    const back = relative(normalizedRoot, assetDirectory);
    if (back.startsWith("..") || isAbsolute(back)) fail("INVALID_REQUEST", "项目素材目录越界。");
    return normalizedRoot;
  } catch (error: unknown) {
    if (error instanceof ControlPlaneServiceError) throw error;
    fail("ASSET_LIBRARY_FAILED", "无法创建安全的项目素材目录，请检查目录权限后重试。");
  }
}

function safeCopyFileName(fileName: string, sha256: string): string {
  const rawExtension = extname(fileName).slice(0, 17);
  let stem = basename(fileName, extname(fileName))
    .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "_")
    .replace(/[. ]+$/gu, "")
    .slice(0, 96);
  if (stem.length === 0) stem = "asset";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(stem)) stem = `_${stem}`;
  return `${stem}-${sha256.slice(0, 12)}${rawExtension.toLocaleLowerCase("en-US")}`;
}

function validateDialogResult(result: unknown, allowMany: boolean): NativeDialogResult {
  if (
    result === null || typeof result !== "object" || Array.isArray(result) ||
    typeof (result as NativeDialogResult).canceled !== "boolean" ||
    !Array.isArray((result as NativeDialogResult).filePaths) ||
    (result as NativeDialogResult).filePaths.some((path) => typeof path !== "string")
  ) fail("INVALID_REQUEST", "Windows 文件选择器返回了无效结果。");
  const validated = result as NativeDialogResult;
  if (validated.filePaths.length > (allowMany ? MAX_DIALOG_SELECTIONS : 1)) {
    fail("INVALID_REQUEST", allowMany ? "一次最多导入 256 个本地素材。" : "请只选择一个文件或目录。");
  }
  return validated;
}

function validateAssetId(value: unknown): string {
  if (typeof value !== "string" || !ASSET_ID.test(value)) fail("INVALID_REQUEST", "素材标识无效。");
  return value;
}

export function assetLibraryLedgerPath(userDataPath: string): string {
  return join(userDataPath, LEDGER_FILE);
}

export function createAssetLibraryService(
  options: CreateAssetLibraryServiceOptions
): AssetLibraryService {
  if (
    !validAbsolutePath(options.userDataPath) ||
    typeof options.chooseAssetFiles !== "function" ||
    typeof options.chooseProjectDirectory !== "function" ||
    typeof options.chooseRelocationFile !== "function" ||
    typeof options.registerFrameSelection !== "function"
  ) fail("INVALID_REQUEST", "素材库服务配置无效。");

  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? randomUUID;
  const pendingRelocations = new Map<string, PendingRelocation>();
  let cachedAssets: readonly PrivateAssetRecord[] | null = null;
  let serialized: Promise<void> = Promise.resolve();

  const runSerialized = <T>(operation: () => Promise<T>): Promise<T> => {
    const run = serialized.then(operation, operation);
    serialized = run.then(() => undefined, () => undefined);
    return run;
  };

  const load = async (): Promise<readonly PrivateAssetRecord[]> => {
    if (cachedAssets !== null) return cachedAssets;
    const path = assetLibraryLedgerPath(options.userDataPath);
    try {
      const metadata = await lstat(path);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_LEDGER_BYTES) {
        fail("ASSET_LIBRARY_FAILED", "本机素材台账无效或异常过大；为避免数据丢失，Relay 没有覆盖它。");
      }
      const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        fail("ASSET_LIBRARY_FAILED", "本机素材台账格式无效；为避免数据丢失，Relay 没有覆盖它。");
      }
      const ledger = parsed as Record<string, unknown>;
      if (!exactKeys(ledger, ["version", "assets"]) || ledger.version !== 1 || !Array.isArray(ledger.assets) || ledger.assets.length > MAX_ASSETS) {
        fail("ASSET_LIBRARY_FAILED", "本机素材台账版本或内容无效；为避免数据丢失，Relay 没有覆盖它。");
      }
      const assets = ledger.assets.map(parsePrivateAsset);
      if (assets.some((asset) => asset === null)) {
        fail("ASSET_LIBRARY_FAILED", "本机素材台账包含无效记录；为避免数据丢失，Relay 没有覆盖它。");
      }
      const validAssets = assets as PrivateAssetRecord[];
      if (
        new Set(validAssets.map((asset) => asset.assetId)).size !== validAssets.length ||
        new Set(validAssets.map((asset) => asset.sha256)).size !== validAssets.length
      ) fail("ASSET_LIBRARY_FAILED", "本机素材台账包含重复标识或哈希；为避免数据丢失，Relay 没有覆盖它。");
      cachedAssets = Object.freeze(validAssets);
      return cachedAssets;
    } catch (error: unknown) {
      if (error instanceof ControlPlaneServiceError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        cachedAssets = Object.freeze([]);
        return cachedAssets;
      }
      fail("ASSET_LIBRARY_FAILED", "无法读取本机素材台账；请检查应用数据目录权限后重试。");
    }
  };

  const save = async (assets: readonly PrivateAssetRecord[]): Promise<void> => {
    if (assets.length > MAX_ASSETS) fail("ASSET_LIBRARY_FAILED", "素材库已达到 10000 条本机记录上限。");
    const destination = assetLibraryLedgerPath(options.userDataPath);
    const temporary = `${destination}.tmp-${process.pid}-${randomUUID()}`;
    const payload: PrivateLedger = Object.freeze({ version: 1, assets });
    const encoded = `${JSON.stringify(payload)}\n`;
    if (Buffer.byteLength(encoded, "utf8") > MAX_LEDGER_BYTES) fail("ASSET_LIBRARY_FAILED", "素材台账超过本机安全大小上限。");
    await mkdir(dirname(destination), { recursive: true });
    try {
      await writeFile(temporary, encoded, { encoding: "utf8", flag: "wx", mode: 0o600 });
      await rename(temporary, destination);
      cachedAssets = Object.freeze([...assets]);
    } catch (error: unknown) {
      if (error instanceof ControlPlaneServiceError) throw error;
      fail("ASSET_LIBRARY_FAILED", "素材变更无法安全写入本机台账；没有显示假成功。");
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  };

  const findAsset = (assets: readonly PrivateAssetRecord[], assetId: string): PrivateAssetRecord => {
    const asset = assets.find((candidate) => candidate.assetId === assetId);
    if (asset === undefined) fail("ASSET_NOT_FOUND", "未找到这条本地素材记录，可能已由另一窗口更新。");
    return asset;
  };

  const importLocalAssets = async (): Promise<AssetImportBatchResult> => runSerialized(async () => {
    const selection = validateDialogResult(await options.chooseAssetFiles(), true);
    if (selection.canceled) return Object.freeze({ cancelled: true, results: Object.freeze([]) });
    if (selection.filePaths.length === 0) fail("INVALID_REQUEST", "请选择至少一个本地素材文件。");
    let assets = [...await load()];
    const results: AssetImportItemResult[] = [];
    for (const selectedPath of selection.filePaths) {
      const selectedFileName = basename(selectedPath) || "未命名素材";
      const extension = extname(selectedPath).slice(1).toLocaleLowerCase("en-US");
      if (EXTENSION_TYPES[extension] === undefined) {
        results.push(Object.freeze({ status: "unsupported", selectedFileName, message: "不支持此文件类型。" }));
        continue;
      }
      try {
        const inspected = await inspectFile(selectedPath);
        const duplicate = assets.find((asset) => asset.sha256 === inspected.sha256);
        if (duplicate !== undefined) {
          results.push(Object.freeze({
            status: "duplicate",
            selectedFileName,
            duplicateAsset: publicAsset(duplicate)
          }));
          continue;
        }
        const timestamp = now().toISOString();
        const asset: PrivateAssetRecord = Object.freeze({
          assetId: assetIdFrom(createId),
          displayName: inspected.sourceFileName,
          sourceFileName: inspected.sourceFileName,
          mediaType: inspected.mediaType,
          extension: inspected.extension,
          byteLength: inspected.byteLength,
          sha256: inspected.sha256,
          tags: Object.freeze([]),
          note: "",
          storageMode: "reference_original",
          availability: "available",
          projectRelativePath: null,
          originalAbsolutePath: inspected.absolutePath,
          activeAbsolutePath: inspected.absolutePath,
          projectRootAbsolutePath: null,
          createdAt: timestamp,
          updatedAt: timestamp
        });
        assets.push(asset);
        results.push(Object.freeze({ status: "imported", selectedFileName, asset: publicAsset(asset) }));
      } catch (error: unknown) {
        results.push(Object.freeze({
          status: "failed",
          selectedFileName,
          message: error instanceof ControlPlaneServiceError ? error.message : "无法读取此本地素材。"
        }));
      }
    }
    if (results.some((result) => result.status === "imported")) await save(assets);
    return Object.freeze({ cancelled: false, results: Object.freeze(results) });
  });

  const listLocalAssets = async (request: AssetListRequest): Promise<AssetListResult> => runSerialized(async () => {
    const query = boundedString(request.query, 200, true);
    const tags = normalizeTags(request.tags);
    if (
      query === null || tags === null ||
      (request.mediaType !== "all" && request.mediaType !== "image" && request.mediaType !== "video" && request.mediaType !== "audio") ||
      (request.availability !== "all" && request.availability !== "available" && request.availability !== "missing" && request.availability !== "changed")
    ) fail("INVALID_REQUEST", "素材搜索或筛选条件无效。");
    const loaded = await load();
    const presenceChecked = await Promise.all(loaded.map(async (asset): Promise<PrivateAssetRecord> => {
      if (asset.availability === "missing" || await fileStillPresent(asset.activeAbsolutePath)) return asset;
      return Object.freeze({ ...asset, availability: "missing", updatedAt: now().toISOString() });
    }));
    if (presenceChecked.some((asset, index) => asset !== loaded[index])) await save(presenceChecked);
    const queryKey = query.toLocaleLowerCase("zh-CN");
    const tagKeys = tags.map((tag) => tag.toLocaleLowerCase("zh-CN"));
    const assets = presenceChecked.filter((asset) => {
      if (request.mediaType !== "all" && asset.mediaType !== request.mediaType) return false;
      if (request.availability !== "all" && asset.availability !== request.availability) return false;
      const assetTagKeys = asset.tags.map((tag) => tag.toLocaleLowerCase("zh-CN"));
      if (!tagKeys.every((tag) => assetTagKeys.includes(tag))) return false;
      if (queryKey.length === 0) return true;
      return [asset.displayName, asset.sourceFileName, asset.note, asset.sha256, ...asset.tags]
        .some((value) => value.toLocaleLowerCase("zh-CN").includes(queryKey));
    }).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt, "en"));
    return Object.freeze({ assets: Object.freeze(assets.map(publicAsset)), total: assets.length });
  });

  const updateLocalAsset = async (request: AssetMetadataUpdateRequest): Promise<AssetRecord> => runSerialized(async () => {
    const assetId = validateAssetId(request.assetId);
    const displayName = boundedString(request.displayName, MAX_DISPLAY_NAME);
    const tags = normalizeTags(request.tags);
    const note = boundedString(request.note, MAX_NOTE_LENGTH, true);
    if (displayName === null || tags === null || note === null) fail("INVALID_REQUEST", "素材名称、标签或备注无效。");
    const assets = [...await load()];
    const current = findAsset(assets, assetId);
    const updated: PrivateAssetRecord = Object.freeze({
      ...current,
      displayName,
      tags,
      note,
      updatedAt: now().toISOString()
    });
    assets[assets.indexOf(current)] = updated;
    await save(assets);
    return publicAsset(updated);
  });

  const refreshLocalAssets = async (): Promise<AssetRefreshResult> => runSerialized(async () => {
    const current = await load();
    const refreshed = await Promise.all(current.map(async (asset): Promise<PrivateAssetRecord> => {
      const availability = await inspectAvailability(asset);
      return availability === asset.availability
        ? asset
        : Object.freeze({ ...asset, availability, updatedAt: now().toISOString() });
    }));
    if (refreshed.some((asset, index) => asset !== current[index])) await save(refreshed);
    return Object.freeze({
      assets: Object.freeze(refreshed.map(publicAsset)),
      missingCount: refreshed.filter((asset) => asset.availability === "missing").length,
      changedCount: refreshed.filter((asset) => asset.availability === "changed").length
    });
  });

  const relocateLocalAsset = async (request: AssetRelocateRequest): Promise<AssetRelocateResult> => runSerialized(async () => {
    const assetId = validateAssetId(request.assetId);
    const assets = [...await load()];
    const current = findAsset(assets, assetId);
    const selection = validateDialogResult(await options.chooseRelocationFile(current.mediaType), false);
    if (selection.canceled) return Object.freeze({ status: "cancelled" });
    const selectedPath = selection.filePaths[0];
    if (selectedPath === undefined) fail("INVALID_REQUEST", "请选择一个用于重定位的本地文件。");
    const candidate = await inspectFile(selectedPath);
    if (candidate.mediaType !== current.mediaType) fail("INVALID_REQUEST", "重定位文件的媒体类型与原素材不一致。");
    if (candidate.sha256 === current.sha256 && candidate.byteLength === current.byteLength) {
      const updated: PrivateAssetRecord = Object.freeze({
        ...current,
        sourceFileName: candidate.sourceFileName,
        extension: candidate.extension,
        originalAbsolutePath: candidate.absolutePath,
        activeAbsolutePath: candidate.absolutePath,
        storageMode: "reference_original",
        availability: "available",
        projectRelativePath: null,
        projectRootAbsolutePath: null,
        updatedAt: now().toISOString()
      });
      assets[assets.indexOf(current)] = updated;
      await save(assets);
      return Object.freeze({ status: "relocated", asset: publicAsset(updated) });
    }
    const duplicate = assets.find((asset) => asset.assetId !== assetId && asset.sha256 === candidate.sha256);
    if (duplicate !== undefined) fail("INVALID_REQUEST", `所选内容已登记为素材“${duplicate.displayName}”，不能把两个稳定 ID 指向同一文件。`);
    for (const [token, pending] of pendingRelocations) {
      if (pending.expiresAt <= Date.now() || pending.assetId === assetId) pendingRelocations.delete(token);
    }
    const relocationToken = relocationTokenFrom(createId);
    pendingRelocations.set(relocationToken, Object.freeze({
      assetId,
      candidate,
      expiresAt: Date.now() + RELOCATION_TTL_MS
    }));
    return Object.freeze({
      status: "confirmation_required",
      relocationToken,
      candidate: Object.freeze({
        selectedFileName: candidate.sourceFileName,
        mediaType: candidate.mediaType,
        extension: candidate.extension,
        byteLength: candidate.byteLength,
        sha256: candidate.sha256
      })
    });
  });

  const confirmLocalAssetReplacement = async (
    request: AssetRelocateConfirmRequest
  ): Promise<AssetRelocateConfirmResult> => runSerialized(async () => {
    const assetId = validateAssetId(request.assetId);
    if (typeof request.relocationToken !== "string" || !RELOCATION_TOKEN.test(request.relocationToken) || typeof request.acceptReplacement !== "boolean") {
      fail("INVALID_REQUEST", "素材替换确认参数无效。");
    }
    const pending = pendingRelocations.get(request.relocationToken);
    pendingRelocations.delete(request.relocationToken);
    if (pending === undefined || pending.assetId !== assetId || pending.expiresAt <= Date.now()) {
      fail("INVALID_REQUEST", "素材替换确认已过期，请重新选择文件。");
    }
    if (!request.acceptReplacement) return Object.freeze({ status: "cancelled" });
    const candidate = await inspectFile(pending.candidate.absolutePath);
    if (
      candidate.sha256 !== pending.candidate.sha256 ||
      candidate.byteLength !== pending.candidate.byteLength
    ) fail("ASSET_CHANGED", "替换文件在确认期间发生变化，请重新选择。");
    const assets = [...await load()];
    const current = findAsset(assets, assetId);
    const duplicate = assets.find((asset) => asset.assetId !== assetId && asset.sha256 === candidate.sha256);
    if (duplicate !== undefined) fail("INVALID_REQUEST", `所选内容已登记为素材“${duplicate.displayName}”。`);
    const updated: PrivateAssetRecord = Object.freeze({
      ...current,
      sourceFileName: candidate.sourceFileName,
      mediaType: candidate.mediaType,
      extension: candidate.extension,
      byteLength: candidate.byteLength,
      sha256: candidate.sha256,
      originalAbsolutePath: candidate.absolutePath,
      activeAbsolutePath: candidate.absolutePath,
      storageMode: "reference_original",
      availability: "available",
      projectRelativePath: null,
      projectRootAbsolutePath: null,
      updatedAt: now().toISOString()
    });
    assets[assets.indexOf(current)] = updated;
    await save(assets);
    return Object.freeze({ status: "relocated", asset: publicAsset(updated) });
  });

  const copyLocalAssetToProject = async (
    request: AssetCopyToProjectRequest
  ): Promise<AssetCopyToProjectResult> => runSerialized(async () => {
    const assetId = validateAssetId(request.assetId);
    const assets = [...await load()];
    const current = findAsset(assets, assetId);
    const source = await inspectFile(current.activeAbsolutePath);
    if (source.byteLength !== current.byteLength || source.sha256 !== current.sha256) {
      const changed: PrivateAssetRecord = Object.freeze({ ...current, availability: "changed", updatedAt: now().toISOString() });
      assets[assets.indexOf(current)] = changed;
      await save(assets);
      fail("ASSET_CHANGED", "素材内容已变化；重新定位或确认新版本后才能复制。");
    }
    const selection = validateDialogResult(await options.chooseProjectDirectory(), false);
    if (selection.canceled) return Object.freeze({ status: "cancelled" });
    const selectedRoot = selection.filePaths[0];
    if (selectedRoot === undefined) fail("INVALID_REQUEST", "请选择项目根目录。");
    const projectRoot = await safeProjectDirectory(selectedRoot);
    const projectRelativePath = join("assets", safeCopyFileName(current.sourceFileName, source.sha256));
    const target = join(projectRoot, projectRelativePath);
    const containment = relative(projectRoot, target);
    if (containment.startsWith("..") || isAbsolute(containment)) fail("INVALID_REQUEST", "项目素材复制目标越界。");
    let created = false;
    try {
      try {
        await copyFile(source.absolutePath, target, fsConstants.COPYFILE_EXCL);
        created = true;
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      const copied = await inspectFile(target);
      if (copied.byteLength !== source.byteLength || copied.sha256 !== source.sha256) {
        if (created) await rm(target, { force: true });
        fail("ASSET_LIBRARY_FAILED", "项目中存在同名但内容不同的文件；Relay 没有覆盖它。");
      }
      const sourceAfter = await inspectFile(source.absolutePath);
      if (sourceAfter.byteLength !== source.byteLength || sourceAfter.sha256 !== source.sha256) {
        if (created) await rm(target, { force: true });
        fail("ASSET_CHANGED", "源素材在复制期间发生变化；已撤销本次新副本。");
      }
      const updated: PrivateAssetRecord = Object.freeze({
        ...current,
        activeAbsolutePath: target,
        storageMode: "project_copy",
        availability: "available",
        projectRelativePath: projectRelativePath.replaceAll("\\", "/"),
        projectRootAbsolutePath: projectRoot,
        updatedAt: now().toISOString()
      });
      assets[assets.indexOf(current)] = updated;
      await save(assets);
      return Object.freeze({
        status: "copied",
        projectDirectoryName: basename(projectRoot),
        projectRelativePath: updated.projectRelativePath as string,
        asset: publicAsset(updated)
      });
    } catch (error: unknown) {
      if (error instanceof ControlPlaneServiceError) throw error;
      if (created) await rm(target, { force: true }).catch(() => undefined);
      fail("ASSET_LIBRARY_FAILED", "本地素材复制未完成；源文件保持不变，请检查项目目录权限。");
    }
  });

  const prepareLocalAssetFrame = async (
    request: AssetPrepareFrameRequest
  ): Promise<FrameSelection> => runSerialized(async () => {
    const assetId = validateAssetId(request.assetId);
    if (request.slot !== "first" && request.slot !== "last") fail("INVALID_REQUEST", "工作流素材槽位无效。");
    const assets = [...await load()];
    const current = findAsset(assets, assetId);
    if (current.mediaType !== "image") fail("INVALID_REQUEST", "当前工作流的帧输入只支持图片素材；视频和音频仍可在专业导播中作为制作资料绑定。");
    const inspected = await inspectFile(current.activeAbsolutePath);
    if (inspected.byteLength !== current.byteLength || inspected.sha256 !== current.sha256) {
      const changed: PrivateAssetRecord = Object.freeze({ ...current, availability: "changed", updatedAt: now().toISOString() });
      assets[assets.indexOf(current)] = changed;
      await save(assets);
      fail("ASSET_CHANGED", "素材内容已变化，重新定位或确认新版本后才能编译工作流。");
    }
    if (current.availability !== "available") {
      const restored: PrivateAssetRecord = Object.freeze({ ...current, availability: "available", updatedAt: now().toISOString() });
      assets[assets.indexOf(current)] = restored;
      await save(assets);
    }
    return await options.registerFrameSelection(inspected.absolutePath, request.slot);
  });

  return Object.freeze({
    importLocalAssets,
    listLocalAssets,
    updateLocalAsset,
    refreshLocalAssets,
    relocateLocalAsset,
    confirmLocalAssetReplacement,
    copyLocalAssetToProject,
    prepareLocalAssetFrame
  });
}
