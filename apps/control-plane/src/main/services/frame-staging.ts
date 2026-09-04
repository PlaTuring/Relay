import { createHash } from "node:crypto";
import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, resolve } from "node:path";

import type { ProjectMode } from "../../shared/ipc-contract.js";
import { ControlPlaneServiceError } from "./errors.js";

const MAX_FRAME_BYTES = 64 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

function matchesImageSignature(extension: string, bytes: Buffer): boolean {
  if (extension === ".png") {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
  }
  if (extension === ".jpg" || extension === ".jpeg") {
    return bytes.length >= 4 &&
      bytes[0] === 0xff && bytes[1] === 0xd8 &&
      bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  }
  if (extension === ".webp") {
    return bytes.length >= 12 &&
      bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
      bytes.subarray(8, 12).toString("ascii") === "WEBP";
  }
  return false;
}

function sameWindowsPath(left: string, right: string): boolean {
  return resolve(left).toLocaleLowerCase("en-US") === resolve(right).toLocaleLowerCase("en-US");
}

async function requireDirectDirectory(path: string): Promise<string> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("not-direct-directory");
    const identity = await realpath(path);
    if (!sameWindowsPath(identity, path)) throw new Error("reparse-path");
    return identity;
  } catch {
    throw new ControlPlaneServiceError(
      "WORKFLOW_EXPORT_FAILED",
      "未找到可安全写入的已识别 ComfyUI input 目录。"
    );
  }
}

async function stageOneFrame(sourcePath: string, inputDirectory: string): Promise<string> {
  if (!isAbsolute(sourcePath)) {
    throw new ControlPlaneServiceError("INVALID_REQUEST", "帧文件路径无效。");
  }
  const extension = extname(sourcePath).toLocaleLowerCase("en-US");
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new ControlPlaneServiceError("INVALID_REQUEST", "帧文件类型无效。");
  }

  let bytes: Buffer;
  try {
    const metadata = await lstat(sourcePath);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size <= 0 ||
      metadata.size > MAX_FRAME_BYTES
    ) {
      throw new Error("unsafe-source");
    }
    const identity = await realpath(sourcePath);
    if (!sameWindowsPath(identity, sourcePath)) throw new Error("reparse-source");
    bytes = await readFile(identity);
  } catch {
    throw new ControlPlaneServiceError("INVALID_REQUEST", "帧必须是普通、非 reparse 的本地图像文件。");
  }
  if (!matchesImageSignature(extension, bytes)) {
    throw new ControlPlaneServiceError("INVALID_REQUEST", "帧文件内容与扩展名不匹配。请选择真实的 PNG、JPEG 或 WebP 图片。");
  }

  const digest = createHash("sha256").update(bytes).digest("hex");
  const fileName = `minimax-h3-${digest.slice(0, 24)}${extension}`;
  const target = join(inputDirectory, fileName);
  if (!sameWindowsPath(resolve(inputDirectory, basename(target)), target)) {
    throw new ControlPlaneServiceError("INVALID_REQUEST", "帧目标路径无效。");
  }

  try {
    await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw new ControlPlaneServiceError("WORKFLOW_EXPORT_FAILED", "无法复制帧到 ComfyUI input 目录。");
    }
    try {
      const existingMetadata = await lstat(target);
      const targetIdentity = await realpath(target);
      if (
        !existingMetadata.isFile() ||
        existingMetadata.isSymbolicLink() ||
        !sameWindowsPath(targetIdentity, target) ||
        createHash("sha256").update(await readFile(targetIdentity)).digest("hex") !== digest
      ) {
        throw new Error("collision");
      }
    } catch {
      throw new ControlPlaneServiceError("WORKFLOW_EXPORT_FAILED", "帧目标已存在且内容不匹配，未覆盖。");
    }
  }

  const written = await readFile(target);
  if (createHash("sha256").update(written).digest("hex") !== digest) {
    throw new ControlPlaneServiceError("WORKFLOW_EXPORT_FAILED", "复制后的帧校验失败。");
  }
  return fileName;
}

export async function stageProjectFrames(options: {
  readonly mode: ProjectMode;
  readonly comfyInputDirectory: string | null;
  readonly firstFrame: string | null;
  readonly lastFrame: string | null;
}): Promise<{ readonly first: string | null; readonly last: string | null }> {
  if (options.mode === "T2V") return Object.freeze({ first: null, last: null });
  if (
    options.comfyInputDirectory === null ||
    (options.firstFrame === null && options.lastFrame === null)
  ) {
    const requirement = options.mode === "REF2VA"
      ? "Ref2VA 需要已验证的用户所选 ComfyUI 根目录，以及至少一张参考图片。"
      : "FL2VA 需要已验证的用户所选 ComfyUI 根目录，以及至少一张首帧或尾帧图像。";
    throw new ControlPlaneServiceError(
      "INVALID_REQUEST",
      requirement
    );
  }
  const inputDirectory = await requireDirectDirectory(options.comfyInputDirectory);
  const first = options.firstFrame === null
    ? null
    : await stageOneFrame(options.firstFrame, inputDirectory);
  const last = options.lastFrame === null
    ? null
    : await stageOneFrame(options.lastFrame, inputDirectory);
  return Object.freeze({ first, last });
}
