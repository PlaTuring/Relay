import { lstat, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, normalize, resolve } from "node:path";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_POSTER_BYTES = 4 * 1024 * 1024;

export interface NativeThumbnailImage {
  isEmpty(): boolean;
  toPNG(): Buffer;
}

export interface CreateNativeVideoPosterOptions {
  readonly createThumbnailFromPath: (
    sourcePath: string,
    size: { readonly width: number; readonly height: number }
  ) => Promise<NativeThumbnailImage>;
}

function sameWindowsPath(left: string, right: string): boolean {
  return resolve(left).toLocaleLowerCase("en-US") === resolve(right).toLocaleLowerCase("en-US");
}

async function requireDirectSource(path: string): Promise<string> {
  if (!isAbsolute(path) || path.includes("\u0000")) throw new TypeError("Video source path is invalid.");
  const normalized = normalize(path);
  const metadata = await lstat(normalized);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new TypeError("Video source is not a direct file.");
  if (!sameWindowsPath(await realpath(normalized), normalized)) throw new TypeError("Video source cannot be a reparse path.");
  return normalized;
}

async function requireDirectOutputParent(path: string): Promise<string> {
  if (!isAbsolute(path) || path.includes("\u0000")) throw new TypeError("Video poster output path is invalid.");
  const normalized = normalize(path);
  const parent = dirname(normalized);
  const metadata = await lstat(parent);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new TypeError("Video poster directory is not direct.");
  if (!sameWindowsPath(await realpath(parent), parent)) throw new TypeError("Video poster directory cannot be a reparse path.");
  return normalized;
}

/**
 * Uses the operating system's local thumbnail provider when the optional
 * managed FFmpeg component is absent. Paths never cross renderer IPC; the
 * caller receives the same bounded PNG cache artifact as the FFmpeg path.
 */
export function createNativeVideoPosterRenderer(
  options: CreateNativeVideoPosterOptions
): (sourcePath: string, outputPath: string) => Promise<void> {
  return async (sourcePath: string, outputPath: string): Promise<void> => {
    const [source, target] = await Promise.all([
      requireDirectSource(sourcePath),
      requireDirectOutputParent(outputPath)
    ]);
    const thumbnail = await options.createThumbnailFromPath(source, Object.freeze({ width: 512, height: 384 }));
    if (thumbnail.isEmpty()) throw new Error("Native video thumbnail is empty.");
    const bytes = thumbnail.toPNG();
    if (
      !Buffer.isBuffer(bytes)
      || bytes.byteLength < PNG_SIGNATURE.byteLength
      || bytes.byteLength > MAX_POSTER_BYTES
      || !bytes.subarray(0, PNG_SIGNATURE.byteLength).equals(PNG_SIGNATURE)
    ) throw new Error("Native video thumbnail is not a bounded PNG.");
    await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
  };
}
