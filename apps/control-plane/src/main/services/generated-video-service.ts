import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  parse,
  relative,
  resolve,
} from "node:path";

import { ensureProjectDirectoryLayout, resolveProjectDirectoryLayout } from "./data-root.js";
import { GENERATED_VIDEO_INDEX_FILE_NAME } from "./generated-video-artifacts.js";
import {
  GENERATED_VIDEO_PROJECT_ID_PATTERN,
  GENERATED_VIDEO_WORKFLOW_ID_PATTERN,
  createWorkflowOutputAttribution,
} from "./generated-video-output-attribution.js";
import {
  GeneratedVideoInspectionError,
  inspectStableGeneratedVideo,
  sha256GeneratedVideoFile,
  verifyGeneratedVideoSnapshot,
  type GeneratedVideoContainer,
  type GeneratedVideoProbe,
  type GeneratedVideoTechnicalInspection,
} from "./generated-video-inspection.js";

const INDEX_VERSION = 1 as const;
const MAX_INDEX_BYTES = 4 * 1024 * 1024;
const RESULT_ID = /^result-[a-z0-9][a-z0-9-]{7,127}$/u;
const ORIGIN_ID = /^origin-[a-f0-9]{32}$/u;
const ASSET_ID = /^asset-[a-z0-9][a-z0-9-]{7,127}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_AUTO_FILE = /^Relay_H3(?:_[0-9]{1,12}_?)?\.(mp4|mov|webm|mkv|avi)$/u;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_POSTER_BYTES = 4 * 1024 * 1024;
const ORIGIN_SCAN_CONCURRENCY = 4;
const VIDEO_INSPECTION_CONCURRENCY = 2;
const SNAPSHOT_CHECK_CONCURRENCY = 8;

export type GeneratedVideoSource = "automatic" | "manual";

export interface GeneratedVideoView {
  readonly resultId: string;
  readonly workflowId: string | null;
  readonly fileName: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly container: GeneratedVideoContainer;
  readonly source: GeneratedVideoSource;
  readonly discoveredAt: string;
  readonly technicalInspection: GeneratedVideoTechnicalInspection;
}

export interface GeneratedVideoListResult {
  readonly projectId: string;
  readonly videos: readonly GeneratedVideoView[];
}

export interface GeneratedVideoManualImportResult {
  readonly status: "added" | "duplicate";
  readonly video: GeneratedVideoView;
}

export interface GeneratedVideoPosterResult {
  readonly kind: "video_poster" | "unavailable";
  readonly status: "ready" | "unavailable" | "failed";
  readonly mimeType: "image/png" | null;
  readonly dataUrl: string | null;
  readonly cacheKey: string;
  readonly message: string | null;
}

export interface GeneratedVideoOpenResult {
  readonly opened: boolean;
  readonly errorCode: "CAPABILITY_UNAVAILABLE" | "OPEN_FAILED" | null;
}

export interface GeneratedVideoAddToAssetsResult {
  readonly status: "added" | "duplicate";
  readonly assetId: string;
}

export interface GeneratedVideoAssetCopyEvidence {
  readonly status: "added" | "duplicate";
  readonly assetId: string;
  readonly sha256: string;
  readonly byteLength: number;
}

export interface CreateGeneratedVideoServiceOptions {
  readonly dataRoot: string;
  readonly probeVideo?: GeneratedVideoProbe;
  readonly renderVideoPoster?: (sourcePath: string, outputPath: string) => Promise<void>;
  readonly openVideo?: (sourcePath: string) => Promise<void | boolean | string>;
  readonly revealVideo?: (sourcePath: string) => Promise<void | boolean>;
  readonly addToProjectAssets?: (input: {
    readonly projectId: string;
    readonly sourcePath: string;
    readonly expectedSha256: string;
    readonly expectedByteLength: number;
  }) => Promise<GeneratedVideoAssetCopyEvidence>;
  readonly now?: () => Date;
  readonly createId?: () => string;
  readonly wait?: (milliseconds: number) => Promise<void>;
  readonly stableObservationIntervalMs?: number;
}

export interface GeneratedVideoService {
  activateProject(projectId: string | null): void;
  registerCompileOrigin(input: {
    readonly projectId: string;
    readonly workflowId: string;
    readonly comfyOutputRoot: string;
  }): Promise<void>;
  list(input: { readonly projectId: string }): Promise<GeneratedVideoListResult>;
  manualImportFromMainSelection(input: {
    readonly projectId: string;
    readonly selectedPath: string;
  }): Promise<GeneratedVideoManualImportResult>;
  getPoster(input: { readonly projectId: string; readonly resultId: string }): Promise<GeneratedVideoPosterResult>;
  play(input: { readonly projectId: string; readonly resultId: string }): Promise<GeneratedVideoOpenResult>;
  reveal(input: { readonly projectId: string; readonly resultId: string }): Promise<GeneratedVideoOpenResult>;
  addToAssets(input: {
    readonly projectId: string;
    readonly resultId: string;
  }): Promise<GeneratedVideoAddToAssetsResult>;
}

export type GeneratedVideoServiceErrorCode =
  | "INVALID_REQUEST"
  | "NOT_CURRENT_PROJECT"
  | "INDEX_INVALID"
  | "ORIGIN_UNSAFE"
  | "VIDEO_NOT_STABLE"
  | "VIDEO_INVALID"
  | "RESULT_NOT_FOUND"
  | "CAPABILITY_UNAVAILABLE"
  | "ASSET_COPY_FAILED";

export class GeneratedVideoServiceError extends Error {
  readonly code: GeneratedVideoServiceErrorCode;

  constructor(code: GeneratedVideoServiceErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GeneratedVideoServiceError";
    this.code = code;
  }
}

interface GeneratedVideoOriginRecord {
  readonly originId: string;
  readonly workflowId: string;
  readonly comfyOutputRoot: string;
  readonly outputPrefix: string;
  readonly registeredAt: string;
}

interface GeneratedVideoResultRecord extends GeneratedVideoView {
  readonly originId: string | null;
  readonly relativeOutputPath: string | null;
  readonly externalPath: string | null;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  readonly birthtimeMs: number;
}

interface GeneratedVideoIndex {
  readonly schemaVersion: typeof INDEX_VERSION;
  readonly projectId: string;
  readonly updatedAt: string;
  readonly origins: readonly GeneratedVideoOriginRecord[];
  readonly results: readonly GeneratedVideoResultRecord[];
}

interface AutomaticCandidate {
  readonly origin: GeneratedVideoOriginRecord;
  readonly absolutePath: string;
  readonly relativeOutputPath: string;
  readonly fileName: string;
  readonly previous: GeneratedVideoResultRecord | null;
}

function samePath(left: string, right: string): boolean {
  return resolve(left).toLocaleLowerCase("en-US") === resolve(right).toLocaleLowerCase("en-US");
}

function isNormalLocalAbsolutePath(value: string): boolean {
  if (!isAbsolute(value) || value.includes("\u0000") || value.startsWith("\\\\")
    || value.startsWith("\\\\?\\") || value.startsWith("\\\\.\\")) return false;
  const absolute = resolve(value);
  return !absolute.slice(parse(absolute).root.length).includes(":");
}

function pathContained(parent: string, child: string): boolean {
  const back = relative(resolve(parent), resolve(child));
  return back.length > 0 && !back.startsWith("..") && !isAbsolute(back);
}

function requireProjectId(projectId: string): void {
  if (!GENERATED_VIDEO_PROJECT_ID_PATTERN.test(projectId)) {
    throw new GeneratedVideoServiceError("INVALID_REQUEST", "项目标识无效。");
  }
}

function requireWorkflowId(workflowId: string): void {
  if (!GENERATED_VIDEO_WORKFLOW_ID_PATTERN.test(workflowId)) {
    throw new GeneratedVideoServiceError("INVALID_REQUEST", "工作流标识无效。");
  }
}

function requireResultId(resultId: string): void {
  if (!RESULT_ID.test(resultId)) throw new GeneratedVideoServiceError("INVALID_REQUEST", "结果标识无效。");
}

function isoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function safeFileName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 255
    && !/[\\/\u0000-\u001f]/u.test(value) && value !== "." && value !== "..";
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((entry, index) => entry === sorted[index]);
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>,
): Promise<readonly R[]> {
  if (values.length === 0) return Object.freeze([]);
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await worker(values[index]!, index);
    }
  }));
  return Object.freeze(results);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseTechnicalInspection(value: unknown): GeneratedVideoTechnicalInspection | null {
  const item = asRecord(value);
  if (item === null || !exactKeys(item, [
    "status", "durationSeconds", "width", "height", "videoCodec", "audioCodec", "message",
  ]) || (item.status !== "verified" && item.status !== "unchecked")) return null;
  const nullableNumber = (entry: unknown): entry is number | null => entry === null
    || typeof entry === "number" && Number.isFinite(entry);
  const nullableText = (entry: unknown): entry is string | null => entry === null
    || typeof entry === "string" && entry.length <= 256 && !entry.includes("\u0000");
  if (!nullableNumber(item.durationSeconds) || !nullableNumber(item.width) || !nullableNumber(item.height)
    || !nullableText(item.videoCodec) || !nullableText(item.audioCodec) || !nullableText(item.message)) return null;
  if (item.status === "verified" && (item.durationSeconds === null || item.width === null || item.height === null
    || item.videoCodec === null || item.message !== null)) return null;
  if (item.status === "unchecked" && (item.durationSeconds !== null || item.width !== null || item.height !== null
    || item.videoCodec !== null || item.audioCodec !== null || item.message === null)) return null;
  return Object.freeze({
    status: item.status,
    durationSeconds: item.durationSeconds,
    width: item.width,
    height: item.height,
    videoCodec: item.videoCodec,
    audioCodec: item.audioCodec,
    message: item.message,
  });
}

function safeAutomaticRelativePath(value: unknown, outputPrefix: string): value is string {
  if (typeof value !== "string" || value.includes("\\") || value.startsWith("/") || value.includes("\u0000")) return false;
  const segments = value.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) return false;
  const prefixDirectory = outputPrefix.split("/").slice(0, -1).join("/");
  return value.startsWith(`${prefixDirectory}/`) && safeFileName(segments.at(-1));
}

function parseIndex(value: unknown, projectId: string): GeneratedVideoIndex | null {
  const root = asRecord(value);
  if (root === null || !exactKeys(root, ["schemaVersion", "projectId", "updatedAt", "origins", "results"])
    || root.schemaVersion !== INDEX_VERSION || root.projectId !== projectId || !isoDate(root.updatedAt)
    || !Array.isArray(root.origins) || root.origins.length > 512
    || !Array.isArray(root.results) || root.results.length > 10_000) return null;

  const origins: GeneratedVideoOriginRecord[] = [];
  for (const valueOrigin of root.origins) {
    const origin = asRecord(valueOrigin);
    if (origin === null || !exactKeys(origin, ["originId", "workflowId", "comfyOutputRoot", "outputPrefix", "registeredAt"])
      || typeof origin.originId !== "string" || !ORIGIN_ID.test(origin.originId)
      || typeof origin.workflowId !== "string" || !GENERATED_VIDEO_WORKFLOW_ID_PATTERN.test(origin.workflowId)
      || typeof origin.comfyOutputRoot !== "string" || !isNormalLocalAbsolutePath(origin.comfyOutputRoot)
      || typeof origin.outputPrefix !== "string" || !isoDate(origin.registeredAt)) return null;
    const expected = createWorkflowOutputAttribution({ projectId, workflowId: origin.workflowId });
    if (origin.outputPrefix !== expected.output_prefix) return null;
    origins.push(Object.freeze({
      originId: origin.originId,
      workflowId: origin.workflowId,
      comfyOutputRoot: normalize(origin.comfyOutputRoot),
      outputPrefix: origin.outputPrefix,
      registeredAt: origin.registeredAt,
    }));
  }
  if (new Set(origins.map((entry) => entry.originId)).size !== origins.length) return null;
  const originsById = new Map(origins.map((entry) => [entry.originId, entry]));

  const results: GeneratedVideoResultRecord[] = [];
  const containers = new Set<GeneratedVideoContainer>(["mp4", "mov", "webm", "mkv", "avi"]);
  for (const valueResult of root.results) {
    const result = asRecord(valueResult);
    const legacyKeys = [
      "resultId", "workflowId", "fileName", "byteLength", "mtimeMs", "sha256", "container", "source",
      "discoveredAt", "technicalInspection", "originId", "relativeOutputPath", "externalPath",
    ];
    const currentKeys = [...legacyKeys, "ctimeMs", "birthtimeMs"];
    if (result === null || !(exactKeys(result, legacyKeys) || exactKeys(result, currentKeys))
      || typeof result.resultId !== "string" || !RESULT_ID.test(result.resultId)
      || !safeFileName(result.fileName) || !Number.isSafeInteger(result.byteLength) || (result.byteLength as number) <= 0
      || typeof result.mtimeMs !== "number" || !Number.isFinite(result.mtimeMs) || result.mtimeMs < 0
      || result.ctimeMs !== undefined && (typeof result.ctimeMs !== "number" || !Number.isFinite(result.ctimeMs) || result.ctimeMs < 0)
      || result.birthtimeMs !== undefined && (typeof result.birthtimeMs !== "number" || !Number.isFinite(result.birthtimeMs) || result.birthtimeMs < 0)
      || typeof result.sha256 !== "string" || !SHA256.test(result.sha256)
      || typeof result.container !== "string" || !containers.has(result.container as GeneratedVideoContainer)
      || (result.source !== "automatic" && result.source !== "manual") || !isoDate(result.discoveredAt)) return null;
    const technicalInspection = parseTechnicalInspection(result.technicalInspection);
    if (technicalInspection === null) return null;
    if (result.source === "automatic") {
      if (typeof result.originId !== "string" || !ORIGIN_ID.test(result.originId)
        || typeof result.workflowId !== "string" || !GENERATED_VIDEO_WORKFLOW_ID_PATTERN.test(result.workflowId)
        || result.externalPath !== null) return null;
      const origin = originsById.get(result.originId);
      if (origin === undefined || origin.workflowId !== result.workflowId
        || !safeAutomaticRelativePath(result.relativeOutputPath, origin.outputPrefix)) return null;
    } else if (result.originId !== null || result.workflowId !== null || result.relativeOutputPath !== null
      || typeof result.externalPath !== "string" || !isNormalLocalAbsolutePath(result.externalPath)) return null;
    results.push(Object.freeze({
      resultId: result.resultId,
      workflowId: result.workflowId as string | null,
      fileName: result.fileName,
      byteLength: result.byteLength as number,
      mtimeMs: result.mtimeMs,
      // A legacy index intentionally misses the stronger identity and is
      // therefore re-inspected on the next bounded scan.
      ctimeMs: typeof result.ctimeMs === "number" ? result.ctimeMs : -1,
      birthtimeMs: typeof result.birthtimeMs === "number" ? result.birthtimeMs : -1,
      sha256: result.sha256,
      container: result.container as GeneratedVideoContainer,
      source: result.source,
      discoveredAt: result.discoveredAt,
      technicalInspection,
      originId: result.originId as string | null,
      relativeOutputPath: result.relativeOutputPath as string | null,
      externalPath: result.externalPath as string | null,
    }));
  }
  if (new Set(results.map((entry) => entry.resultId)).size !== results.length) return null;
  return Object.freeze({
    schemaVersion: INDEX_VERSION,
    projectId,
    updatedAt: root.updatedAt,
    origins: Object.freeze(origins),
    results: Object.freeze(results),
  });
}

function resultView(record: GeneratedVideoResultRecord): GeneratedVideoView {
  return Object.freeze({
    resultId: record.resultId,
    workflowId: record.workflowId,
    fileName: record.fileName,
    byteLength: record.byteLength,
    sha256: record.sha256,
    container: record.container,
    source: record.source,
    discoveredAt: record.discoveredAt,
    technicalInspection: record.technicalInspection,
  });
}

async function requireDirectDirectory(path: string, label: string): Promise<string> {
  if (!isNormalLocalAbsolutePath(path)) {
    throw new GeneratedVideoServiceError("ORIGIN_UNSAFE", `${label}必须是本机绝对目录。`);
  }
  const direct = normalize(path);
  let metadata;
  try {
    metadata = await lstat(direct);
  } catch (error) {
    throw new GeneratedVideoServiceError("ORIGIN_UNSAFE", `${label}不存在或不可读取。`, { cause: error });
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || !samePath(await realpath(direct), direct)) {
    throw new GeneratedVideoServiceError("ORIGIN_UNSAFE", `${label}不能是文件或重解析点。`);
  }
  return direct;
}

async function directChildDirectory(parent: string, name: string): Promise<string | null> {
  const child = join(parent, name);
  if (!pathContained(parent, child)) throw new GeneratedVideoServiceError("ORIGIN_UNSAFE", "输出目录越界。");
  try {
    const metadata = await lstat(child);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || !samePath(await realpath(child), child)) {
      throw new GeneratedVideoServiceError("ORIGIN_UNSAFE", "输出目录包含重解析点。");
    }
    return child;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function exactOutputDirectory(origin: GeneratedVideoOriginRecord): Promise<string | null> {
  let current = await requireDirectDirectory(origin.comfyOutputRoot, "ComfyUI output 目录");
  const components = origin.outputPrefix.split("/").slice(0, -1);
  for (const component of components) {
    if (!/^[A-Za-z0-9_]+$/u.test(component)) {
      throw new GeneratedVideoServiceError("ORIGIN_UNSAFE", "输出前缀包含不安全目录。");
    }
    const next = await directChildDirectory(current, component);
    if (next === null) return null;
    current = next;
  }
  return current;
}

function originId(projectId: string, workflowId: string, outputRoot: string): string {
  const digest = createHash("sha256")
    .update(`relay-generated-origin-v1\0${projectId}\0${workflowId}\0${resolve(outputRoot).toLocaleLowerCase("en-US")}`, "utf8")
    .digest("hex");
  return `origin-${digest.slice(0, 32)}`;
}

function resultId(createId: () => string): string {
  const raw = createId();
  if (typeof raw !== "string") throw new GeneratedVideoServiceError("INVALID_REQUEST", "无法生成安全的结果标识。");
  const value = `result-${raw.replaceAll("-", "").toLocaleLowerCase("en-US")}`;
  if (!RESULT_ID.test(value)) throw new GeneratedVideoServiceError("INVALID_REQUEST", "无法生成安全的结果标识。");
  return value;
}

function indexPath(dataRoot: string, projectId: string): string {
  return join(resolveProjectDirectoryLayout(dataRoot, projectId).recovery, GENERATED_VIDEO_INDEX_FILE_NAME);
}

async function readIndex(dataRoot: string, projectId: string, now: () => Date): Promise<GeneratedVideoIndex> {
  await ensureProjectDirectoryLayout(dataRoot, projectId);
  const path = indexPath(dataRoot, projectId);
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0 || metadata.size > MAX_INDEX_BYTES
      || !samePath(await realpath(path), path)) {
      throw new GeneratedVideoServiceError("INDEX_INVALID", "本机生成视频索引不安全或已损坏。");
    }
    const parsed = parseIndex(JSON.parse(await readFile(path, "utf8")), projectId);
    if (parsed === null) throw new GeneratedVideoServiceError("INDEX_INVALID", "本机生成视频索引格式无效。");
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      if (error instanceof GeneratedVideoServiceError) throw error;
      throw new GeneratedVideoServiceError("INDEX_INVALID", "无法读取本机生成视频索引。", { cause: error });
    }
    return Object.freeze({
      schemaVersion: INDEX_VERSION,
      projectId,
      updatedAt: now().toISOString(),
      origins: Object.freeze([]),
      results: Object.freeze([]),
    });
  }
}

async function writeIndex(dataRoot: string, value: GeneratedVideoIndex, createId: () => string): Promise<void> {
  const path = indexPath(dataRoot, value.projectId);
  await requireDirectDirectory(dirname(path), "项目 recovery 目录");
  const suffix = createId().replaceAll("-", "").toLocaleLowerCase("en-US");
  if (!/^[a-z0-9]{8,128}$/u.test(suffix)) throw new GeneratedVideoServiceError("INDEX_INVALID", "索引临时标识无效。");
  const temporary = join(dirname(path), `.${GENERATED_VIDEO_INDEX_FILE_NAME}.${suffix}.tmp`);
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  if (bytes.byteLength > MAX_INDEX_BYTES) throw new GeneratedVideoServiceError("INDEX_INVALID", "本机生成视频索引超过安全上限。");
  try {
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
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

function withIndex(index: GeneratedVideoIndex, input: {
  readonly updatedAt: string;
  readonly origins?: readonly GeneratedVideoOriginRecord[];
  readonly results?: readonly GeneratedVideoResultRecord[];
}): GeneratedVideoIndex {
  return Object.freeze({
    schemaVersion: INDEX_VERSION,
    projectId: index.projectId,
    updatedAt: input.updatedAt,
    origins: Object.freeze([...(input.origins ?? index.origins)]),
    results: Object.freeze([...(input.results ?? index.results)]),
  });
}

function inspectionCode(error: unknown): GeneratedVideoServiceErrorCode {
  if (error instanceof GeneratedVideoInspectionError && error.code === "VIDEO_NOT_STABLE") return "VIDEO_NOT_STABLE";
  return "VIDEO_INVALID";
}

async function candidateForOrigin(
  origin: GeneratedVideoOriginRecord,
  existing: readonly GeneratedVideoResultRecord[]
): Promise<{ readonly candidates: readonly AutomaticCandidate[]; readonly visibleSourceKeys: ReadonlySet<string> }> {
  const directory = await exactOutputDirectory(origin);
  if (directory === null) return Object.freeze({ candidates: Object.freeze([]), visibleSourceKeys: new Set<string>() });
  const prefixDirectory = origin.outputPrefix.split("/").slice(0, -1).join("/");
  const previousByPath = new Map(existing
    .filter((entry) => entry.source === "automatic" && entry.originId === origin.originId && entry.relativeOutputPath !== null)
    .map((entry) => [entry.relativeOutputPath!, entry]));
  const candidates: AutomaticCandidate[] = [];
  const visibleSourceKeys = new Set<string>();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !SAFE_AUTO_FILE.test(entry.name)) continue;
    const absolutePath = join(directory, entry.name);
    if (!pathContained(origin.comfyOutputRoot, absolutePath)) {
      throw new GeneratedVideoServiceError("ORIGIN_UNSAFE", "候选视频越出 ComfyUI output 目录。");
    }
    const metadata = await lstat(absolutePath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || !samePath(await realpath(absolutePath), absolutePath)) continue;
    const relativeOutputPath = `${prefixDirectory}/${entry.name}`;
    visibleSourceKeys.add(`${origin.originId}\0${relativeOutputPath}`);
    const previous = previousByPath.get(relativeOutputPath) ?? null;
    if (previous !== null && previous.byteLength === metadata.size && previous.mtimeMs === metadata.mtimeMs
      && previous.ctimeMs === metadata.ctimeMs && previous.birthtimeMs === metadata.birthtimeMs) continue;
    candidates.push(Object.freeze({ origin, absolutePath, relativeOutputPath, fileName: entry.name, previous }));
  }
  return Object.freeze({ candidates: Object.freeze(candidates), visibleSourceKeys });
}

function isPng(bytes: Buffer): boolean {
  return bytes.length >= 33 && bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
    && bytes.readUInt32BE(8) === 13 && bytes.subarray(12, 16).toString("ascii") === "IHDR"
    && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(16) <= 32_768
    && bytes.readUInt32BE(20) > 0 && bytes.readUInt32BE(20) <= 32_768;
}

async function readDirectPng(path: string): Promise<Buffer> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0 || metadata.size > MAX_POSTER_BYTES
    || !samePath(await realpath(path), path)) throw new TypeError("封面缓存不是安全 PNG。");
  const bytes = await readFile(path);
  if (!isPng(bytes)) throw new TypeError("封面缓存不是有效 PNG。");
  return bytes;
}

export function createGeneratedVideoService(options: CreateGeneratedVideoServiceOptions): GeneratedVideoService {
  if (!isNormalLocalAbsolutePath(options.dataRoot)) {
    throw new TypeError("Generated-video data root must be an absolute path.");
  }
  const interval = options.stableObservationIntervalMs ?? 1_500;
  if (!Number.isSafeInteger(interval) || interval < 1_500 || interval > 60_000) {
    throw new TypeError("Generated-video stable observation interval is invalid.");
  }
  const dataRoot = resolve(options.dataRoot);
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? randomUUID;
  let activeProjectId: string | null = null;
  const projectLocks = new Map<string, Promise<void>>();

  const timestamp = (): string => {
    const value = now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new TypeError("Generated-video clock is invalid.");
    return value.toISOString();
  };

  const requireCurrent = (projectId: string): void => {
    requireProjectId(projectId);
    if (projectId !== activeProjectId) {
      throw new GeneratedVideoServiceError("NOT_CURRENT_PROJECT", "只能读取当前项目的已生成视频。");
    }
  };

  const serialize = async <T>(projectId: string, operation: () => Promise<T>): Promise<T> => {
    const prior = projectLocks.get(projectId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolveRelease) => { release = resolveRelease; });
    projectLocks.set(projectId, current);
    await prior.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (projectLocks.get(projectId) === current) projectLocks.delete(projectId);
    }
  };

  const resultPath = async (index: GeneratedVideoIndex, record: GeneratedVideoResultRecord): Promise<string> => {
    let path: string;
    if (record.source === "manual") {
      if (record.externalPath === null) throw new GeneratedVideoServiceError("INDEX_INVALID", "手动补录结果缺少本机路径。");
      path = normalize(record.externalPath);
    } else {
      const origin = index.origins.find((entry) => entry.originId === record.originId);
      if (origin === undefined || record.relativeOutputPath === null) {
        throw new GeneratedVideoServiceError("INDEX_INVALID", "自动结果缺少已登记来源。");
      }
      const directory = await exactOutputDirectory(origin);
      if (directory === null) throw new GeneratedVideoServiceError("RESULT_NOT_FOUND", "结果文件当前不可用。");
      path = join(origin.comfyOutputRoot, ...record.relativeOutputPath.split("/"));
      if (!pathContained(origin.comfyOutputRoot, path) || !pathContained(directory, path)) {
        throw new GeneratedVideoServiceError("INDEX_INVALID", "结果文件越出已登记目录。");
      }
    }
    try {
      await verifyGeneratedVideoSnapshot({
        sourcePath: path,
        byteLength: record.byteLength,
        mtimeMs: record.mtimeMs,
        ctimeMs: record.ctimeMs,
        birthtimeMs: record.birthtimeMs,
      });
    } catch (error) {
      throw new GeneratedVideoServiceError("RESULT_NOT_FOUND", "结果文件已移动、变化或当前不可用。", { cause: error });
    }
    return path;
  };

  const recordById = (index: GeneratedVideoIndex, id: string): GeneratedVideoResultRecord => {
    requireResultId(id);
    const record = index.results.find((entry) => entry.resultId === id);
    if (record === undefined) throw new GeneratedVideoServiceError("RESULT_NOT_FOUND", "未找到当前项目中的视频结果。");
    return record;
  };

  const scan = async (index: GeneratedVideoIndex): Promise<GeneratedVideoIndex> => {
    const enumerated = await mapConcurrent(index.origins, ORIGIN_SCAN_CONCURRENCY, async (origin) => {
      try {
        return Object.freeze({ originId: origin.originId, succeeded: true, ...(await candidateForOrigin(origin, index.results)) });
      } catch (error) {
        if (error instanceof GeneratedVideoServiceError) return Object.freeze({
          originId: origin.originId,
          succeeded: false,
          candidates: Object.freeze([]),
          visibleSourceKeys: new Set<string>(),
        });
        throw error;
      }
    });
    const candidates = enumerated.flatMap((entry) => [...entry.candidates]);
    const successfulOrigins = new Set(enumerated.filter((entry) => entry.succeeded).map((entry) => entry.originId));
    const visibleSourceKeys = new Set(enumerated.flatMap((entry) => [...entry.visibleSourceKeys]));
    const replacedKeys = new Set(candidates.map((candidate) => `${candidate.origin.originId}\0${candidate.relativeOutputPath}`));
    const retained = index.results.filter((entry) => entry.source !== "automatic" || entry.originId === null
      || entry.relativeOutputPath === null || !successfulOrigins.has(entry.originId)
      || visibleSourceKeys.has(`${entry.originId}\0${entry.relativeOutputPath}`)
        && !replacedKeys.has(`${entry.originId}\0${entry.relativeOutputPath}`));
    if (candidates.length === 0 && retained.length === index.results.length) return index;

    const inspected = await mapConcurrent(candidates, VIDEO_INSPECTION_CONCURRENCY, async (candidate): Promise<GeneratedVideoResultRecord | null> => {
      try {
        const inspection = await inspectStableGeneratedVideo({
          sourcePath: candidate.absolutePath,
          stableObservationIntervalMs: interval,
          ...(options.wait === undefined ? {} : { wait: options.wait }),
          ...(options.probeVideo === undefined ? {} : { probeVideo: options.probeVideo }),
        });
        return Object.freeze({
          resultId: candidate.previous?.resultId ?? resultId(createId),
          workflowId: candidate.origin.workflowId,
          fileName: candidate.fileName,
          byteLength: inspection.byteLength,
          mtimeMs: inspection.mtimeMs,
          ctimeMs: inspection.ctimeMs,
          birthtimeMs: inspection.birthtimeMs,
          sha256: inspection.sha256,
          container: inspection.container,
          source: "automatic",
          discoveredAt: candidate.previous?.discoveredAt ?? timestamp(),
          technicalInspection: inspection.technicalInspection,
          originId: candidate.origin.originId,
          relativeOutputPath: candidate.relativeOutputPath,
          externalPath: null,
        });
      } catch {
        return null;
      }
    });
    return withIndex(index, {
      updatedAt: timestamp(),
      results: [...retained, ...inspected.filter((entry): entry is GeneratedVideoResultRecord => entry !== null)],
    });
  };

  const availableViews = async (index: GeneratedVideoIndex): Promise<readonly GeneratedVideoView[]> => {
    const checked = await mapConcurrent(index.results, SNAPSHOT_CHECK_CONCURRENCY, async (record): Promise<GeneratedVideoView | null> => {
      try {
        await resultPath(index, record);
        return resultView(record);
      } catch {
        return null;
      }
    });
    return Object.freeze(checked
      .filter((entry): entry is GeneratedVideoView => entry !== null)
      .sort((left, right) => right.discoveredAt.localeCompare(left.discoveredAt) || left.fileName.localeCompare(right.fileName)));
  };

  const service: GeneratedVideoService = {
    activateProject(projectId) {
      if (projectId !== null) requireProjectId(projectId);
      activeProjectId = projectId;
    },

    async registerCompileOrigin(input) {
      requireCurrent(input.projectId);
      requireWorkflowId(input.workflowId);
      const outputRoot = await requireDirectDirectory(input.comfyOutputRoot, "ComfyUI output 目录");
      if (basename(outputRoot).toLocaleLowerCase("en-US") !== "output") {
        throw new GeneratedVideoServiceError("ORIGIN_UNSAFE", "自动发现仅支持 ComfyUI 默认 output 目录；自定义目录请手动补录。");
      }
      await serialize(input.projectId, async () => {
        const index = await readIndex(dataRoot, input.projectId, now);
        const attribution = createWorkflowOutputAttribution({ projectId: input.projectId, workflowId: input.workflowId });
        const id = originId(input.projectId, input.workflowId, outputRoot);
        const existing = index.origins.find((entry) => entry.originId === id);
        if (existing !== undefined) return;
        const origin: GeneratedVideoOriginRecord = Object.freeze({
          originId: id,
          workflowId: input.workflowId,
          comfyOutputRoot: outputRoot,
          outputPrefix: attribution.output_prefix,
          registeredAt: timestamp(),
        });
        await writeIndex(dataRoot, withIndex(index, {
          updatedAt: timestamp(),
          origins: [...index.origins, origin],
        }), createId);
      });
    },

    async list(input) {
      requireCurrent(input.projectId);
      return await serialize(input.projectId, async () => {
        const before = await readIndex(dataRoot, input.projectId, now);
        const after = await scan(before);
        if (after !== before) await writeIndex(dataRoot, after, createId);
        return Object.freeze({ projectId: input.projectId, videos: await availableViews(after) });
      });
    },

    async manualImportFromMainSelection(input) {
      requireCurrent(input.projectId);
      if (typeof input.selectedPath !== "string" || !isNormalLocalAbsolutePath(input.selectedPath)) {
        throw new GeneratedVideoServiceError("INVALID_REQUEST", "主进程选择的视频路径无效。");
      }
      return await serialize(input.projectId, async () => {
        let inspection;
        try {
          inspection = await inspectStableGeneratedVideo({
            sourcePath: input.selectedPath,
            stableObservationIntervalMs: interval,
            ...(options.wait === undefined ? {} : { wait: options.wait }),
            ...(options.probeVideo === undefined ? {} : { probeVideo: options.probeVideo }),
          });
        } catch (error) {
          throw new GeneratedVideoServiceError(inspectionCode(error), error instanceof Error ? error.message : "视频检查失败。", { cause: error });
        }
        const index = await readIndex(dataRoot, input.projectId, now);
        const duplicate = index.results.find((entry) => entry.sha256 === inspection.sha256 && entry.byteLength === inspection.byteLength);
        if (duplicate !== undefined) return Object.freeze({ status: "duplicate", video: resultView(duplicate) });
        const selectedPath = normalize(input.selectedPath);
        const record: GeneratedVideoResultRecord = Object.freeze({
          resultId: resultId(createId),
          workflowId: null,
          fileName: basename(selectedPath),
          byteLength: inspection.byteLength,
          mtimeMs: inspection.mtimeMs,
          ctimeMs: inspection.ctimeMs,
          birthtimeMs: inspection.birthtimeMs,
          sha256: inspection.sha256,
          container: inspection.container,
          source: "manual",
          discoveredAt: timestamp(),
          technicalInspection: inspection.technicalInspection,
          originId: null,
          relativeOutputPath: null,
          externalPath: selectedPath,
        });
        await writeIndex(dataRoot, withIndex(index, {
          updatedAt: timestamp(),
          results: [...index.results, record],
        }), createId);
        return Object.freeze({ status: "added", video: resultView(record) });
      });
    },

    async getPoster(input) {
      requireCurrent(input.projectId);
      return await serialize(input.projectId, async () => {
        const index = await readIndex(dataRoot, input.projectId, now);
        const record = recordById(index, input.resultId);
        const cacheKey = `${record.resultId}:${record.sha256.slice(0, 16)}`;
        if (options.renderVideoPoster === undefined) {
          return Object.freeze({
            kind: "unavailable", status: "unavailable", mimeType: null, dataUrl: null, cacheKey,
            message: "当前构建没有可用的本机视频封面服务。",
          });
        }
        try {
          const sourcePath = await resultPath(index, record);
          const layout = await ensureProjectDirectoryLayout(dataRoot, input.projectId);
          const thumbnailRoot = await requireDirectDirectory(layout.assetThumbnails, "项目缩略图目录");
          const target = join(thumbnailRoot, `generated-${record.resultId}-${record.sha256.slice(0, 16)}.png`);
          let bytes: Buffer;
          try {
            bytes = await readDirectPng(target);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") await rm(target, { force: true }).catch(() => undefined);
            const suffix = createId().replaceAll("-", "").toLocaleLowerCase("en-US");
            if (!/^[a-z0-9]{8,128}$/u.test(suffix)) throw new TypeError("封面临时标识无效。");
            const temporary = join(thumbnailRoot, `.generated-${record.resultId}-${suffix}.tmp`);
            try {
              await options.renderVideoPoster(sourcePath, temporary);
              bytes = await readDirectPng(temporary);
              try {
                await rename(temporary, target);
              } catch (renameError) {
                if ((renameError as NodeJS.ErrnoException).code !== "EEXIST") throw renameError;
                await rm(temporary, { force: true });
                bytes = await readDirectPng(target);
              }
            } finally {
              await rm(temporary, { force: true }).catch(() => undefined);
            }
          }
          return Object.freeze({
            kind: "video_poster", status: "ready", mimeType: "image/png", dataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
            cacheKey, message: null,
          });
        } catch {
          return Object.freeze({
            kind: "unavailable", status: "failed", mimeType: null, dataUrl: null, cacheKey,
            message: "当前系统未能读取视频画面；可直接播放，或安装 FFmpeg 后重试。原视频没有被修改。",
          });
        }
      });
    },

    async play(input) {
      requireCurrent(input.projectId);
      requireResultId(input.resultId);
      if (options.openVideo === undefined) return Object.freeze({ opened: false, errorCode: "CAPABILITY_UNAVAILABLE" });
      return await serialize(input.projectId, async () => {
        try {
          const index = await readIndex(dataRoot, input.projectId, now);
          const path = await resultPath(index, recordById(index, input.resultId));
          const outcome = await options.openVideo!(path);
          const opened = outcome === undefined || outcome === true || outcome === "";
          return Object.freeze({ opened, errorCode: opened ? null : "OPEN_FAILED" });
        } catch {
          return Object.freeze({ opened: false, errorCode: "OPEN_FAILED" });
        }
      });
    },

    async reveal(input) {
      requireCurrent(input.projectId);
      requireResultId(input.resultId);
      if (options.revealVideo === undefined) return Object.freeze({ opened: false, errorCode: "CAPABILITY_UNAVAILABLE" });
      return await serialize(input.projectId, async () => {
        try {
          const index = await readIndex(dataRoot, input.projectId, now);
          const path = await resultPath(index, recordById(index, input.resultId));
          const outcome = await options.revealVideo!(path);
          const opened = outcome === undefined || outcome === true;
          return Object.freeze({ opened, errorCode: opened ? null : "OPEN_FAILED" });
        } catch {
          return Object.freeze({ opened: false, errorCode: "OPEN_FAILED" });
        }
      });
    },

    async addToAssets(input) {
      requireCurrent(input.projectId);
      requireResultId(input.resultId);
      if (options.addToProjectAssets === undefined) {
        throw new GeneratedVideoServiceError("CAPABILITY_UNAVAILABLE", "项目素材复制服务当前不可用。");
      }
      return await serialize(input.projectId, async () => {
        const index = await readIndex(dataRoot, input.projectId, now);
        const record = recordById(index, input.resultId);
        const sourcePath = await resultPath(index, record);
        const before = await sha256GeneratedVideoFile(sourcePath);
        if (before !== record.sha256) throw new GeneratedVideoServiceError("ASSET_COPY_FAILED", "源视频完整性已变化，未复制到素材库。");
        let evidence: GeneratedVideoAssetCopyEvidence;
        try {
          evidence = await options.addToProjectAssets!({
            projectId: input.projectId,
            sourcePath,
            expectedSha256: record.sha256,
            expectedByteLength: record.byteLength,
          });
        } catch (error) {
          throw new GeneratedVideoServiceError("ASSET_COPY_FAILED", "无法复制并校验项目素材副本。", { cause: error });
        }
        const after = await sha256GeneratedVideoFile(sourcePath);
        if (after !== before || evidence.sha256 !== record.sha256 || evidence.byteLength !== record.byteLength
          || !ASSET_ID.test(evidence.assetId) || (evidence.status !== "added" && evidence.status !== "duplicate")) {
          throw new GeneratedVideoServiceError("ASSET_COPY_FAILED", "项目素材副本证据与源视频不一致。");
        }
        return Object.freeze({ status: evidence.status, assetId: evidence.assetId });
      });
    },
  };

  return Object.freeze(service);
}

export { GENERATED_VIDEO_INDEX_FILE_NAME };
