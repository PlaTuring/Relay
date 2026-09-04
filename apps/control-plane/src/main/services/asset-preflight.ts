import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { basename, extname, isAbsolute, normalize, resolve } from "node:path";

export type ProjectAssetMediaType = "image" | "video" | "audio";
export type AssetPreflightStatus =
  | "usable"
  | "needs_conversion"
  | "missing"
  | "changed"
  | "incompatible"
  | "check_failed";

export interface ImageTechnicalInfo {
  readonly format: "png" | "jpeg" | "webp" | "gif" | "bmp" | "tiff";
  readonly width: number;
  readonly height: number;
  readonly orientation: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  readonly hasAlpha: boolean;
  readonly structurallyDecoded: true;
}

export interface VideoTechnicalInfo {
  readonly durationSeconds: number | null;
  readonly frameRate: number | null;
  readonly codec: string | null;
  readonly pixelFormat: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly audioTrackCount: number;
}

export interface AudioTechnicalInfo {
  readonly durationSeconds: number | null;
  readonly codec: string | null;
  readonly channels: number | null;
  readonly sampleRate: number | null;
}

export interface AssetPreflightIssue {
  readonly code: string;
  readonly message: string;
}

export interface AssetPreflightResult {
  readonly status: AssetPreflightStatus;
  readonly fileName: string;
  readonly canonicalPath: string | null;
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

export interface AssetPreflightOptions {
  readonly ffprobePath?: string | null;
  readonly expectedByteLength?: number | null;
  readonly expectedSha256?: string | null;
  readonly maximumBytes?: number;
  readonly now?: () => Date;
  /** Must be wired to the already-approved main-process child-process adapter. */
  readonly ffprobeRunner?: (executable: string, arguments_: readonly string[]) => Promise<unknown>;
}

interface MagicMatch {
  readonly mime: string;
  readonly acceptedExtensions: ReadonlySet<string>;
  readonly mediaType: ProjectAssetMediaType;
  readonly format: string;
}

interface FfprobeStream {
  readonly codec_type?: unknown;
  readonly codec_name?: unknown;
  readonly pix_fmt?: unknown;
  readonly width?: unknown;
  readonly height?: unknown;
  readonly avg_frame_rate?: unknown;
  readonly r_frame_rate?: unknown;
  readonly channels?: unknown;
  readonly sample_rate?: unknown;
  readonly duration?: unknown;
}

interface FfprobePayload {
  readonly streams?: unknown;
  readonly format?: unknown;
}

const DEFAULT_MAXIMUM_BYTES = Number.MAX_SAFE_INTEGER;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "m4v", "mkv", "webm", "avi", "mpg", "mpeg"]);
const AUDIO_EXTENSIONS = new Set(["wav", "mp3", "flac", "m4a", "aac", "ogg", "opus"]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function issue(code: string, message: string): AssetPreflightIssue {
  return Object.freeze({ code, message });
}

function sameWindowsPath(left: string, right: string): boolean {
  return resolve(left).toLocaleLowerCase("en-US") === resolve(right).toLocaleLowerCase("en-US");
}

function extensionType(extension: string): ProjectAssetMediaType | null {
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  if (AUDIO_EXTENSIONS.has(extension)) return "audio";
  return null;
}

function startsWithBytes(bytes: Buffer, signature: Buffer): boolean {
  return bytes.length >= signature.length && bytes.subarray(0, signature.length).equals(signature);
}

function detectMagic(bytes: Buffer, extension: string): MagicMatch | null {
  if (startsWithBytes(bytes, PNG_SIGNATURE)) {
    return { mime: "image/png", acceptedExtensions: new Set(["png"]), mediaType: "image", format: "png" };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: "image/jpeg", acceptedExtensions: new Set(["jpg", "jpeg"]), mediaType: "image", format: "jpeg" };
  }
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    return { mime: "image/webp", acceptedExtensions: new Set(["webp"]), mediaType: "image", format: "webp" };
  }
  if (bytes.length >= 6 && (bytes.subarray(0, 6).toString("ascii") === "GIF87a" || bytes.subarray(0, 6).toString("ascii") === "GIF89a")) {
    return { mime: "image/gif", acceptedExtensions: new Set(["gif"]), mediaType: "image", format: "gif" };
  }
  if (bytes.length >= 2 && bytes.subarray(0, 2).toString("ascii") === "BM") {
    return { mime: "image/bmp", acceptedExtensions: new Set(["bmp"]), mediaType: "image", format: "bmp" };
  }
  if (bytes.length >= 4 && (
    bytes.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) ||
    bytes.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]))
  )) {
    return { mime: "image/tiff", acceptedExtensions: new Set(["tif", "tiff"]), mediaType: "image", format: "tiff" };
  }
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp") {
    const audio = extension === "m4a";
    return {
      mime: audio ? "audio/mp4" : "video/mp4",
      acceptedExtensions: audio ? new Set(["m4a"]) : new Set(["mp4", "mov", "m4v"]),
      mediaType: audio ? "audio" : "video",
      format: "iso-bmff"
    };
  }
  if (bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
    return { mime: "video/x-matroska", acceptedExtensions: new Set(["mkv", "webm"]), mediaType: "video", format: "ebml" };
  }
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "AVI ") {
    return { mime: "video/x-msvideo", acceptedExtensions: new Set(["avi"]), mediaType: "video", format: "avi" };
  }
  if (bytes.length >= 4 && bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && (bytes[3] === 0xba || bytes[3] === 0xb3)) {
    return { mime: "video/mpeg", acceptedExtensions: new Set(["mpg", "mpeg"]), mediaType: "video", format: "mpeg" };
  }
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WAVE") {
    return { mime: "audio/wav", acceptedExtensions: new Set(["wav"]), mediaType: "audio", format: "wav" };
  }
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString("ascii") === "fLaC") {
    return { mime: "audio/flac", acceptedExtensions: new Set(["flac"]), mediaType: "audio", format: "flac" };
  }
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString("ascii") === "OggS") {
    return { mime: extension === "opus" ? "audio/opus" : "audio/ogg", acceptedExtensions: new Set(["ogg", "opus"]), mediaType: "audio", format: "ogg" };
  }
  if (bytes.length >= 3 && bytes.subarray(0, 3).toString("ascii") === "ID3") {
    return { mime: "audio/mpeg", acceptedExtensions: new Set(["mp3"]), mediaType: "audio", format: "mp3" };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0) {
    if (extension === "aac") {
      return { mime: "audio/aac", acceptedExtensions: new Set(["aac"]), mediaType: "audio", format: "aac" };
    }
    return { mime: "audio/mpeg", acceptedExtensions: new Set(["mp3"]), mediaType: "audio", format: "mp3" };
  }
  return null;
}

function parseExifOrientation(payload: Buffer): ImageTechnicalInfo["orientation"] {
  let offset = 2;
  while (offset + 4 <= payload.length) {
    if (payload[offset] !== 0xff) break;
    const marker = payload[offset + 1] ?? 0;
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01) continue;
    if (marker === 0xda) break;
    if (offset + 2 > payload.length) break;
    const length = payload.readUInt16BE(offset);
    if (length < 2 || offset + length > payload.length) break;
    if (marker === 0xe1 && length >= 16 && payload.subarray(offset + 2, offset + 8).toString("ascii") === "Exif\u0000\u0000") {
      const tiff = offset + 8;
      const little = payload.subarray(tiff, tiff + 2).toString("ascii") === "II";
      const read16 = (at: number): number => little ? payload.readUInt16LE(at) : payload.readUInt16BE(at);
      const read32 = (at: number): number => little ? payload.readUInt32LE(at) : payload.readUInt32BE(at);
      if (tiff + 8 > payload.length || read16(tiff + 2) !== 42) return 1;
      const ifd = tiff + read32(tiff + 4);
      if (ifd + 2 > payload.length) return 1;
      const count = read16(ifd);
      for (let index = 0; index < count; index += 1) {
        const entry = ifd + 2 + index * 12;
        if (entry + 12 > payload.length) break;
        if (read16(entry) === 0x0112 && read16(entry + 2) === 3 && read32(entry + 4) >= 1) {
          const value = read16(entry + 8);
          if (value >= 1 && value <= 8) return value as ImageTechnicalInfo["orientation"];
        }
      }
    }
    offset += length;
  }
  return 1;
}

function parseJpeg(bytes: Buffer): ImageTechnicalInfo | null {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    let marker = bytes[offset + 1] ?? 0;
    offset += 2;
    while (marker === 0xff && offset < bytes.length) marker = bytes[offset++] ?? 0;
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0xd8 || marker === 0x01) continue;
    if (offset + 2 > bytes.length) return null;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      if (length < 8) return null;
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      if (width <= 0 || height <= 0) return null;
      return Object.freeze({
        format: "jpeg",
        width,
        height,
        orientation: parseExifOrientation(bytes),
        hasAlpha: false,
        structurallyDecoded: true
      });
    }
    offset += length;
  }
  return null;
}

function parseTiff(bytes: Buffer): ImageTechnicalInfo | null {
  const little = bytes.subarray(0, 2).toString("ascii") === "II";
  const read16 = (at: number): number => little ? bytes.readUInt16LE(at) : bytes.readUInt16BE(at);
  const read32 = (at: number): number => little ? bytes.readUInt32LE(at) : bytes.readUInt32BE(at);
  if (bytes.length < 8 || read16(2) !== 42) return null;
  const ifd = read32(4);
  if (ifd + 2 > bytes.length) return null;
  const count = read16(ifd);
  let width: number | null = null;
  let height: number | null = null;
  let orientation: ImageTechnicalInfo["orientation"] = 1;
  let samples = 3;
  for (let index = 0; index < count; index += 1) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > bytes.length) return null;
    const tag = read16(entry);
    const type = read16(entry + 2);
    const quantity = read32(entry + 4);
    if (quantity < 1 || (type !== 3 && type !== 4)) continue;
    const value = type === 3 ? read16(entry + 8) : read32(entry + 8);
    if (tag === 0x0100) width = value;
    if (tag === 0x0101) height = value;
    if (tag === 0x0112 && value >= 1 && value <= 8) orientation = value as ImageTechnicalInfo["orientation"];
    if (tag === 0x0115) samples = value;
  }
  if (width === null || height === null || width <= 0 || height <= 0) return null;
  return Object.freeze({ format: "tiff", width, height, orientation, hasAlpha: samples >= 4, structurallyDecoded: true });
}

function parseImage(bytes: Buffer, format: string): ImageTechnicalInfo | null {
  if (format === "png") {
    if (bytes.length < 33 || bytes.subarray(12, 16).toString("ascii") !== "IHDR") return null;
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    const colorType = bytes[25] ?? 255;
    if (width <= 0 || height <= 0 || ![0, 2, 3, 4, 6].includes(colorType)) return null;
    const hasTransparencyChunk = bytes.includes(Buffer.from("tRNS", "ascii"));
    return Object.freeze({ format: "png", width, height, orientation: 1, hasAlpha: colorType === 4 || colorType === 6 || hasTransparencyChunk, structurallyDecoded: true });
  }
  if (format === "jpeg") return parseJpeg(bytes);
  if (format === "gif") {
    if (bytes.length < 13) return null;
    const width = bytes.readUInt16LE(6);
    const height = bytes.readUInt16LE(8);
    if (width <= 0 || height <= 0) return null;
    const hasAlpha = bytes.includes(Buffer.from([0x21, 0xf9, 0x04]));
    return Object.freeze({ format: "gif", width, height, orientation: 1, hasAlpha, structurallyDecoded: true });
  }
  if (format === "bmp") {
    if (bytes.length < 30) return null;
    const dib = bytes.readUInt32LE(14);
    if (dib < 12) return null;
    const width = dib === 12 ? bytes.readUInt16LE(18) : Math.abs(bytes.readInt32LE(18));
    const height = dib === 12 ? bytes.readUInt16LE(20) : Math.abs(bytes.readInt32LE(22));
    const bits = dib === 12 ? bytes.readUInt16LE(24) : bytes.readUInt16LE(28);
    if (width <= 0 || height <= 0) return null;
    return Object.freeze({ format: "bmp", width, height, orientation: 1, hasAlpha: bits === 32, structurallyDecoded: true });
  }
  if (format === "webp") {
    if (bytes.length < 30) return null;
    const chunk = bytes.subarray(12, 16).toString("ascii");
    if (chunk === "VP8X") {
      const flags = bytes[20] ?? 0;
      const width = 1 + (bytes[24] ?? 0) + ((bytes[25] ?? 0) << 8) + ((bytes[26] ?? 0) << 16);
      const height = 1 + (bytes[27] ?? 0) + ((bytes[28] ?? 0) << 8) + ((bytes[29] ?? 0) << 16);
      if (width <= 0 || height <= 0) return null;
      return Object.freeze({ format: "webp", width, height, orientation: 1, hasAlpha: (flags & 0x10) !== 0, structurallyDecoded: true });
    }
    if (chunk === "VP8 " && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      const width = bytes.readUInt16LE(26) & 0x3fff;
      const height = bytes.readUInt16LE(28) & 0x3fff;
      if (width <= 0 || height <= 0) return null;
      return Object.freeze({ format: "webp", width, height, orientation: 1, hasAlpha: false, structurallyDecoded: true });
    }
    if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
      const b1 = bytes[21] ?? 0; const b2 = bytes[22] ?? 0; const b3 = bytes[23] ?? 0; const b4 = bytes[24] ?? 0;
      const width = 1 + (((b2 & 0x3f) << 8) | b1);
      const height = 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6));
      return Object.freeze({ format: "webp", width, height, orientation: 1, hasAlpha: true, structurallyDecoded: true });
    }
    return null;
  }
  if (format === "tiff") return parseTiff(bytes);
  return null;
}

function parseFinite(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseInteger(value: unknown): number | null {
  const parsed = parseFinite(value);
  return parsed !== null && Number.isSafeInteger(parsed) ? parsed : null;
}

function parseFrameRate(value: unknown): number | null {
  if (typeof value !== "string") return parseFinite(value);
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/u);
  if (match !== null) {
    const numerator = Number(match[1]);
    const denominator = Number(match[2]);
    return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0 ? numerator / denominator : null;
  }
  return parseFinite(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function parseProbe(payload: FfprobePayload): { video: VideoTechnicalInfo | null; audio: AudioTechnicalInfo | null } {
  const streams = Array.isArray(payload.streams) ? payload.streams.filter((value): value is FfprobeStream => value !== null && typeof value === "object") : [];
  const format = payload.format !== null && typeof payload.format === "object" && !Array.isArray(payload.format)
    ? payload.format as Record<string, unknown>
    : {};
  const videoStream = streams.find((stream) => stream.codec_type === "video");
  const audioStreams = streams.filter((stream) => stream.codec_type === "audio");
  const audioStream = audioStreams[0];
  const duration = parseFinite(format.duration) ?? parseFinite(videoStream?.duration) ?? parseFinite(audioStream?.duration);
  const video = videoStream === undefined ? null : Object.freeze({
    durationSeconds: duration,
    frameRate: parseFrameRate(videoStream.avg_frame_rate) ?? parseFrameRate(videoStream.r_frame_rate),
    codec: stringValue(videoStream.codec_name),
    pixelFormat: stringValue(videoStream.pix_fmt),
    width: parseInteger(videoStream.width),
    height: parseInteger(videoStream.height),
    audioTrackCount: audioStreams.length
  });
  const audio = audioStream === undefined ? null : Object.freeze({
    durationSeconds: duration,
    codec: stringValue(audioStream.codec_name),
    channels: parseInteger(audioStream.channels),
    sampleRate: parseInteger(audioStream.sample_rate)
  });
  return Object.freeze({ video, audio });
}

async function readPrefix(filePath: string, byteLength: number): Promise<Buffer> {
  const maximum = Math.min(byteLength, 4 * 1024 * 1024);
  const handle = await open(filePath, "r");
  try {
    const result = Buffer.alloc(maximum);
    const { bytesRead } = await handle.read(result, 0, maximum, 0);
    return result.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function hashFile(filePath: string): Promise<string> {
  return await new Promise<string>((resolveHash, rejectHash) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath, { highWaterMark: 4 * 1024 * 1024 });
    stream.on("data", (chunk: Buffer | string) => hash.update(chunk));
    stream.once("error", rejectHash);
    stream.once("end", () => resolveHash(hash.digest("hex")));
  });
}

function baseResult(filePath: string, now: Date): Omit<AssetPreflightResult, "status" | "issues"> {
  return {
    fileName: basename(filePath),
    canonicalPath: null,
    extension: extname(filePath).slice(1).toLocaleLowerCase("en-US"),
    detectedMime: null,
    mediaType: null,
    byteLength: null,
    sha256: null,
    image: null,
    video: null,
    audio: null,
    checkedAt: now.toISOString()
  };
}

function result(
  base: Omit<AssetPreflightResult, "status" | "issues">,
  status: AssetPreflightStatus,
  issues: readonly AssetPreflightIssue[],
  overrides: Partial<Omit<AssetPreflightResult, "status" | "issues">> = {}
): AssetPreflightResult {
  return Object.freeze({ ...base, ...overrides, status, issues: Object.freeze([...issues]) });
}

export async function preflightLocalAsset(
  filePath: string,
  options: AssetPreflightOptions = {}
): Promise<AssetPreflightResult> {
  const now = (options.now ?? (() => new Date()))();
  const base = baseResult(typeof filePath === "string" ? filePath : "", now);
  if (typeof filePath !== "string" || filePath.includes("\u0000") || !isAbsolute(filePath)) {
    return result(base, "incompatible", [issue("PATH_NOT_ABSOLUTE", "请选择普通本地文件，路径必须是绝对路径。")]);
  }
  const normalized = normalize(filePath);
  const extension = extname(normalized).slice(1).toLocaleLowerCase("en-US");
  const declaredType = extensionType(extension);
  if (declaredType === null) {
    return result({ ...base, extension }, "incompatible", [issue("EXTENSION_UNSUPPORTED", "文件扩展名不属于 Relay 支持的图片、视频或音频格式。")]);
  }
  const maximumBytes = options.maximumBytes ?? DEFAULT_MAXIMUM_BYTES;
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) {
    return result({ ...base, extension }, "check_failed", [issue("PREFLIGHT_CONFIGURATION_INVALID", "素材预检大小限制配置无效。")]);
  }

  let before;
  let canonicalPath: string;
  try {
    before = await lstat(normalized, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink()) {
      return result({ ...base, extension }, "incompatible", [issue("NOT_DIRECT_FILE", "不能导入目录、符号链接或重解析路径。")]);
    }
    canonicalPath = await realpath(normalized);
    if (!sameWindowsPath(canonicalPath, normalized)) {
      return result({ ...base, extension }, "incompatible", [issue("REPARSE_PATH", "素材路径经过重解析，Relay 已停止读取。")]);
    }
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    return result({ ...base, extension }, code === "ENOENT" ? "missing" : "check_failed", [
      issue(code === "ENOENT" ? "FILE_MISSING" : "FILE_UNREADABLE", code === "ENOENT" ? "素材文件不存在或已被移动。" : "无法读取素材文件，请检查权限。")
    ]);
  }
  if (before.size <= 0n || before.size > BigInt(maximumBytes) || before.size > BigInt(Number.MAX_SAFE_INTEGER)) {
    return result({ ...base, extension, canonicalPath }, "incompatible", [issue("FILE_SIZE_OUT_OF_RANGE", "素材文件为空或大小超出本机安全处理范围。")]);
  }

  try {
    const prefix = await readPrefix(canonicalPath, Number(before.size));
    const magic = detectMagic(prefix, extension);
    if (magic === null) {
      return result({ ...base, extension, canonicalPath, byteLength: Number(before.size) }, "incompatible", [issue("MAGIC_UNKNOWN", "文件内容签名不是受支持的媒体格式。")]);
    }
    if (!magic.acceptedExtensions.has(extension) || magic.mediaType !== declaredType) {
      return result({ ...base, extension, canonicalPath, detectedMime: magic.mime, mediaType: magic.mediaType, byteLength: Number(before.size) }, "incompatible", [issue("MIME_EXTENSION_MISMATCH", "文件内容与扩展名不一致，已停止导入。")]);
    }
    const digest = await hashFile(canonicalPath);
    const after = await lstat(canonicalPath, { bigint: true });
    if (!after.isFile() || after.isSymbolicLink() || after.size !== before.size || after.mtimeNs !== before.mtimeNs) {
      return result({ ...base, extension, canonicalPath, detectedMime: magic.mime, mediaType: magic.mediaType, byteLength: Number(after.size), sha256: digest }, "changed", [issue("CHANGED_DURING_CHECK", "文件在校验期间发生变化，请等待写入完成后重试。")]);
    }
    const common = { ...base, extension, canonicalPath, detectedMime: magic.mime, mediaType: magic.mediaType, byteLength: Number(after.size), sha256: digest };
    if (
      (options.expectedByteLength !== undefined && options.expectedByteLength !== null && options.expectedByteLength !== Number(after.size)) ||
      (options.expectedSha256 !== undefined && options.expectedSha256 !== null && (!HASH_PATTERN.test(options.expectedSha256) || options.expectedSha256 !== digest))
    ) {
      return result(common, "changed", [issue("CONTENT_CHANGED", "文件内容与项目登记的长度或 SHA-256 不一致。")]);
    }
    if (magic.mediaType === "image") {
      const image = parseImage(prefix, magic.format);
      if (image === null) return result(common, "incompatible", [issue("IMAGE_DECODE_FAILED", "图片结构无法解码，不能作为项目素材使用。")]);
      return result({ ...common, image }, "usable", []);
    }

    const ffprobePath = options.ffprobePath === undefined ? "ffprobe" : options.ffprobePath;
    if (ffprobePath === null || ffprobePath.trim().length === 0 || ffprobePath.includes("\u0000")) {
      return result(common, "check_failed", [issue("FFPROBE_UNAVAILABLE", "未配置可用的 ffprobe，无法验证视频或音频技术信息；Relay 没有假装检查成功。")]);
    }
    try {
      if (options.ffprobeRunner === undefined) {
        return result(common, "check_failed", [issue("FFPROBE_UNAVAILABLE", "ffprobe 尚未接入 Relay 已批准的本机执行适配器，无法验证视频或音频技术信息。")]);
      }
      const rawProbe = await options.ffprobeRunner(ffprobePath, Object.freeze([
        "-v", "error", "-print_format", "json", "-show_format", "-show_streams", canonicalPath
      ]));
      if (rawProbe === null || typeof rawProbe !== "object" || Array.isArray(rawProbe)) throw new TypeError("ffprobe payload is invalid");
      const probe = parseProbe(rawProbe as FfprobePayload);
      if (magic.mediaType === "video" && probe.video === null) {
        return result(common, "incompatible", [issue("VIDEO_STREAM_MISSING", "容器中没有可识别的视频轨道。")]);
      }
      if (magic.mediaType === "audio" && probe.audio === null) {
        return result(common, "incompatible", [issue("AUDIO_STREAM_MISSING", "容器中没有可识别的音频轨道。")]);
      }
      return result({ ...common, video: probe.video, audio: probe.audio }, "usable", []);
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      return result(common, code === "ENOENT" ? "check_failed" : "incompatible", [
        issue(code === "ENOENT" ? "FFPROBE_UNAVAILABLE" : "FFPROBE_REJECTED", code === "ENOENT" ? "本机未找到 ffprobe，无法验证视频或音频技术信息。" : "ffprobe 无法解析该媒体，当前文件不兼容。")
      ]);
    }
  } catch (error: unknown) {
    return result({ ...base, extension, canonicalPath }, "check_failed", [issue("PREFLIGHT_FAILED", "素材预检没有完成，请确认文件保持可读后重试。")]);
  }
}
