import { createHash } from "node:crypto";
import { createReadStream, type Stats } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { extname, isAbsolute, normalize, parse, resolve } from "node:path";

const MAX_VIDEO_BYTES = 1024 * 1024 * 1024 * 1024;
const MAX_DURATION_SECONDS = 24 * 60 * 60;
const MAX_DIMENSION = 32_768;
const SAFE_CODEC = /^[A-Za-z0-9._-]{1,64}$/u;

export type GeneratedVideoContainer = "mp4" | "mov" | "webm" | "mkv" | "avi";

export interface GeneratedVideoTechnicalInspection {
  readonly status: "verified" | "unchecked";
  readonly durationSeconds: number | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly videoCodec: string | null;
  readonly audioCodec: string | null;
  readonly message: string | null;
}

export interface GeneratedVideoInspection {
  readonly byteLength: number;
  readonly mtimeMs: number;
  /** NTFS metadata identity used to notice same-size/same-mtime replacements. */
  readonly ctimeMs: number;
  readonly birthtimeMs: number;
  readonly sha256: string;
  readonly container: GeneratedVideoContainer;
  readonly technicalInspection: GeneratedVideoTechnicalInspection;
}

export type GeneratedVideoProbe = (sourcePath: string) => Promise<unknown>;

export class GeneratedVideoInspectionError extends Error {
  readonly code: "VIDEO_UNSAFE" | "VIDEO_NOT_STABLE" | "VIDEO_MAGIC_INVALID" | "VIDEO_PROBE_FAILED";

  constructor(code: GeneratedVideoInspectionError["code"], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GeneratedVideoInspectionError";
    this.code = code;
  }
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

function sameSnapshot(left: Stats, right: Stats): boolean {
  return left.size === right.size && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs && left.birthtimeMs === right.birthtimeMs;
}

async function directFileSnapshot(sourcePath: string): Promise<{ readonly path: string; readonly stats: Stats }> {
  if (!isNormalLocalAbsolutePath(sourcePath)) {
    throw new GeneratedVideoInspectionError("VIDEO_UNSAFE", "视频路径必须是本机绝对路径。");
  }
  const path = normalize(sourcePath);
  let stats: Stats;
  try {
    stats = await lstat(path);
  } catch (error) {
    throw new GeneratedVideoInspectionError("VIDEO_UNSAFE", "视频文件不存在或无法读取。", { cause: error });
  }
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size <= 0 || stats.size > MAX_VIDEO_BYTES) {
    throw new GeneratedVideoInspectionError("VIDEO_UNSAFE", "视频必须是大小受限的普通文件。");
  }
  let identity: string;
  try {
    identity = await realpath(path);
  } catch (error) {
    throw new GeneratedVideoInspectionError("VIDEO_UNSAFE", "无法确认视频文件的真实位置。", { cause: error });
  }
  if (!samePath(identity, path)) {
    throw new GeneratedVideoInspectionError("VIDEO_UNSAFE", "拒绝通过重解析点读取视频。");
  }
  return Object.freeze({ path, stats });
}

async function readHeader(path: string): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const bytes = Buffer.alloc(64);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    return bytes.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function printableBrand(bytes: Buffer): boolean {
  if (bytes.length < 12) return false;
  for (const byte of bytes.subarray(8, 12)) {
    if (byte < 0x20 || byte > 0x7e) return false;
  }
  return true;
}

function verifyMagic(path: string, header: Buffer, byteLength: number): GeneratedVideoContainer {
  const extension = extname(path).slice(1).toLocaleLowerCase("en-US");
  if (extension === "mp4" || extension === "mov") {
    if (header.length < 12 || header.subarray(4, 8).toString("ascii") !== "ftyp" || !printableBrand(header)) {
      throw new GeneratedVideoInspectionError("VIDEO_MAGIC_INVALID", "视频扩展名与 ISO 媒体 magic bytes 不匹配。");
    }
    const boxLength = header.readUInt32BE(0);
    if (boxLength !== 0 && boxLength !== 1 && (boxLength < 8 || boxLength > byteLength)) {
      throw new GeneratedVideoInspectionError("VIDEO_MAGIC_INVALID", "视频 ftyp box 长度无效。");
    }
    return extension;
  }
  if (extension === "webm" || extension === "mkv") {
    if (header.length < 4 || !header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
      throw new GeneratedVideoInspectionError("VIDEO_MAGIC_INVALID", "视频扩展名与 EBML magic bytes 不匹配。");
    }
    return extension;
  }
  if (extension === "avi") {
    if (header.length < 12 || header.subarray(0, 4).toString("ascii") !== "RIFF"
      || header.subarray(8, 12).toString("ascii") !== "AVI ") {
      throw new GeneratedVideoInspectionError("VIDEO_MAGIC_INVALID", "视频扩展名与 AVI magic bytes 不匹配。");
    }
    return "avi";
  }
  throw new GeneratedVideoInspectionError("VIDEO_MAGIC_INVALID", "不支持该视频容器。");
}

export async function sha256GeneratedVideoFile(sourcePath: string): Promise<string> {
  return await new Promise<string>((resolveHash, rejectHash) => {
    const hash = createHash("sha256");
    const stream = createReadStream(sourcePath, { highWaterMark: 4 * 1024 * 1024 });
    stream.on("data", (chunk: Buffer | string) => hash.update(chunk));
    stream.once("error", rejectHash);
    stream.once("end", () => resolveHash(hash.digest("hex")));
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function safeCodec(value: unknown): string | null {
  return typeof value === "string" && SAFE_CODEC.test(value) ? value : null;
}

function normalizeProbe(value: unknown): GeneratedVideoTechnicalInspection {
  const root = record(value);
  const format = record(root?.format);
  const streams = Array.isArray(root?.streams) ? root.streams.map(record).filter((entry): entry is Record<string, unknown> => entry !== null) : [];
  const video = streams.find((stream) => stream.codec_type === "video") ?? null;
  if (video === null) {
    throw new GeneratedVideoInspectionError("VIDEO_PROBE_FAILED", "FFprobe 未发现视频流。");
  }
  const duration = finiteNumber(format?.duration ?? video.duration);
  const width = finiteNumber(video.width);
  const height = finiteNumber(video.height);
  if (duration === null || duration <= 0 || duration > MAX_DURATION_SECONDS
    || width === null || height === null || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width <= 0 || height <= 0 || width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new GeneratedVideoInspectionError("VIDEO_PROBE_FAILED", "FFprobe 返回的时长或画面尺寸无效。");
  }
  const videoCodec = safeCodec(video.codec_name);
  if (videoCodec === null) {
    throw new GeneratedVideoInspectionError("VIDEO_PROBE_FAILED", "FFprobe 返回的视频编码无效。");
  }
  const audio = streams.find((stream) => stream.codec_type === "audio") ?? null;
  const audioCodec = audio === null ? null : safeCodec(audio.codec_name);
  if (audio !== null && audioCodec === null) {
    throw new GeneratedVideoInspectionError("VIDEO_PROBE_FAILED", "FFprobe 返回的音频编码无效。");
  }
  return Object.freeze({
    status: "verified",
    durationSeconds: duration,
    width,
    height,
    videoCodec,
    audioCodec,
    message: null,
  });
}

export async function inspectStableGeneratedVideo(options: {
  readonly sourcePath: string;
  readonly stableObservationIntervalMs?: number;
  readonly wait?: (milliseconds: number) => Promise<void>;
  readonly probeVideo?: GeneratedVideoProbe;
}): Promise<GeneratedVideoInspection> {
  const interval = options.stableObservationIntervalMs ?? 1_500;
  if (!Number.isSafeInteger(interval) || interval < 1_500 || interval > 60_000) {
    throw new TypeError("视频稳定性检查间隔必须至少为 1500 毫秒。");
  }
  const wait = options.wait ?? ((milliseconds: number) => new Promise<void>((resolveWait) => {
    setTimeout(resolveWait, milliseconds);
  }));
  const first = await directFileSnapshot(options.sourcePath);
  await wait(interval);
  const second = await directFileSnapshot(first.path);
  if (!sameSnapshot(first.stats, second.stats)) {
    throw new GeneratedVideoInspectionError("VIDEO_NOT_STABLE", "视频仍在写入，尚未达到稳定状态。");
  }
  const header = await readHeader(first.path);
  const container = verifyMagic(first.path, header, second.stats.size);
  const sha256 = await sha256GeneratedVideoFile(first.path);
  const afterHash = await directFileSnapshot(first.path);
  if (!sameSnapshot(second.stats, afterHash.stats)) {
    throw new GeneratedVideoInspectionError("VIDEO_NOT_STABLE", "视频在完整性检查期间发生变化。");
  }
  let technicalInspection: GeneratedVideoTechnicalInspection;
  if (options.probeVideo === undefined) {
    technicalInspection = Object.freeze({
      status: "unchecked",
      durationSeconds: null,
      width: null,
      height: null,
      videoCodec: null,
      audioCodec: null,
      message: "未配置经过验证的本机 FFprobe，技术信息未检查。",
    });
  } else {
    let rawProbe: unknown;
    try {
      rawProbe = await options.probeVideo(first.path);
    } catch (error) {
      if (error instanceof GeneratedVideoInspectionError) throw error;
      throw new GeneratedVideoInspectionError("VIDEO_PROBE_FAILED", "FFprobe 无法验证该视频。", { cause: error });
    }
    technicalInspection = normalizeProbe(rawProbe);
  }
  const afterProbe = await directFileSnapshot(first.path);
  if (!sameSnapshot(afterHash.stats, afterProbe.stats)) {
    throw new GeneratedVideoInspectionError("VIDEO_NOT_STABLE", "视频在技术检查期间发生变化。");
  }
  return Object.freeze({
    byteLength: afterProbe.stats.size,
    mtimeMs: afterProbe.stats.mtimeMs,
    ctimeMs: afterProbe.stats.ctimeMs,
    birthtimeMs: afterProbe.stats.birthtimeMs,
    sha256,
    container,
    technicalInspection,
  });
}

export async function verifyGeneratedVideoSnapshot(options: {
  readonly sourcePath: string;
  readonly byteLength: number;
  readonly mtimeMs: number;
  readonly ctimeMs?: number;
  readonly birthtimeMs?: number;
}): Promise<void> {
  const snapshot = await directFileSnapshot(options.sourcePath);
  if (snapshot.stats.size !== options.byteLength || snapshot.stats.mtimeMs !== options.mtimeMs
    || options.ctimeMs !== undefined && snapshot.stats.ctimeMs !== options.ctimeMs
    || options.birthtimeMs !== undefined && snapshot.stats.birthtimeMs !== options.birthtimeMs) {
    throw new GeneratedVideoInspectionError("VIDEO_NOT_STABLE", "视频已在索引后发生变化，请重新扫描。");
  }
}
