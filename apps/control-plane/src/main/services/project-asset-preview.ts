import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm } from "node:fs/promises";
import { isAbsolute, join, normalize, relative, resolve } from "node:path";

import type { RelayProjectAsset } from "../../shared/project-domain.js";

const MAX_PREVIEW_BYTES = 4 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ASSET_ID = /^asset-[a-z0-9][a-z0-9-]{7,127}$/u;

export type ProjectAssetPreviewKind =
  | "image_thumbnail"
  | "video_poster"
  | "audio_icon"
  | "unavailable";

export interface ProjectAssetPreviewResult {
  readonly kind: ProjectAssetPreviewKind;
  readonly status: "ready" | "unavailable" | "failed";
  readonly mimeType: "image/png" | null;
  /** Renderer-safe cached bytes. No absolute path crosses IPC. */
  readonly dataUrl: string | null;
  readonly cacheKey: string;
  readonly message: string | null;
}

export interface CreateProjectAssetPreviewServiceOptions {
  readonly projectRoot: string;
  readonly loadAsset: (assetId: string) => Promise<RelayProjectAsset | null>;
  readonly resolveAssetPath: (assetId: string) => Promise<string>;
  /** Electron nativeImage or another approved, local-only image decoder. */
  readonly renderImageThumbnail?: (sourcePath: string, outputPath: string) => Promise<void>;
  /** Optional approved local ffmpeg adapter. Never inferred from PATH. */
  readonly renderVideoPoster?: (sourcePath: string, outputPath: string) => Promise<void>;
  readonly createId?: () => string;
}

export interface ProjectAssetPreviewService {
  readonly getPreview: (assetId: string) => Promise<ProjectAssetPreviewResult>;
}

function sameWindowsPath(left: string, right: string): boolean {
  return resolve(left).toLocaleLowerCase("en-US") === resolve(right).toLocaleLowerCase("en-US");
}

async function requireDirectProjectRoot(projectRoot: string): Promise<string> {
  if (!isAbsolute(projectRoot) || projectRoot.includes("\u0000")) {
    throw new TypeError("Project asset preview root must be an absolute path.");
  }
  const root = normalize(projectRoot);
  const metadata = await lstat(root);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new TypeError("Project asset preview root must be a direct directory.");
  }
  if (!sameWindowsPath(await realpath(root), root)) {
    throw new TypeError("Project asset preview root cannot be a reparse path.");
  }
  return root;
}

async function ensureDirectChildDirectory(parent: string, name: string, label: string): Promise<string> {
  const directory = join(parent, name);
  try {
    await mkdir(directory);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new TypeError(`${label} is not a direct directory.`);
  }
  if (!sameWindowsPath(await realpath(directory), directory)) {
    throw new TypeError(`${label} cannot be a reparse path.`);
  }
  const containment = relative(parent, directory);
  if (containment.startsWith("..") || isAbsolute(containment)) {
    throw new TypeError(`${label} escapes its parent.`);
  }
  return directory;
}

async function requireThumbnailDirectory(projectRoot: string): Promise<string> {
  const root = await requireDirectProjectRoot(projectRoot);
  // Create and verify one component at a time. A recursive mkdir could otherwise
  // traverse an attacker-controlled reparse point before the final check runs.
  const assets = await ensureDirectChildDirectory(root, "assets", "Project asset directory");
  const directory = await ensureDirectChildDirectory(assets, "thumbnails", "Project thumbnail cache");
  const containment = relative(root, directory);
  if (containment.startsWith("..") || isAbsolute(containment)) {
    throw new TypeError("Project thumbnail cache escapes its root.");
  }
  return directory;
}

function isPng(bytes: Buffer): boolean {
  if (bytes.length < 33 || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return false;
  if (bytes.readUInt32BE(8) !== 13 || bytes.subarray(12, 16).toString("ascii") !== "IHDR") return false;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return width > 0 && height > 0 && width <= 32_768 && height <= 32_768;
}

async function readVerifiedPng(path: string): Promise<Buffer> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0 || metadata.size > MAX_PREVIEW_BYTES) {
    throw new TypeError("Cached asset preview is not a safe PNG file.");
  }
  if (!sameWindowsPath(await realpath(path), path)) {
    throw new TypeError("Cached asset preview cannot be a reparse path.");
  }
  const bytes = await readFile(path);
  if (!isPng(bytes)) throw new TypeError("Cached asset preview is not a PNG image.");
  return bytes;
}

function cacheName(asset: RelayProjectAsset, kind: "image" | "video"): string {
  return `${kind}-${asset.assetId}-${asset.sha256.slice(0, 16)}.png`;
}

function result(input: ProjectAssetPreviewResult): ProjectAssetPreviewResult {
  return Object.freeze(input);
}

export function createProjectAssetPreviewService(
  options: CreateProjectAssetPreviewServiceOptions
): ProjectAssetPreviewService {
  if (
    typeof options.loadAsset !== "function" ||
    typeof options.resolveAssetPath !== "function"
  ) throw new TypeError("Project asset preview dependencies are invalid.");
  const createId = options.createId ?? randomUUID;
  const inFlight = new Map<string, Promise<ProjectAssetPreviewResult>>();

  const createPreview = async (assetId: string): Promise<ProjectAssetPreviewResult> => {
    if (!ASSET_ID.test(assetId)) throw new TypeError("Project asset ID is invalid.");
    const asset = await options.loadAsset(assetId);
    if (asset === null) throw new TypeError("Project asset was not found.");
    const cacheKey = `${asset.assetId}:${asset.sha256.slice(0, 16)}`;
    if (asset.availability !== "available") {
      return result({
        kind: "unavailable", status: "unavailable", mimeType: null, dataUrl: null, cacheKey,
        message: "素材当前不可用，请先重新定位或完成本机检查。"
      });
    }
    if (asset.mediaType === "audio") {
      return result({
        kind: "audio_icon", status: "ready", mimeType: null, dataUrl: null, cacheKey,
        message: "音频素材使用媒体图标显示；Relay 不提供虚假的音频波形。"
      });
    }
    const renderer = asset.mediaType === "image"
      ? options.renderImageThumbnail
      : options.renderVideoPoster;
    if (renderer === undefined) {
      return result({
        kind: "unavailable", status: "unavailable", mimeType: null, dataUrl: null, cacheKey,
        message: asset.mediaType === "video"
          ? "当前未配置经过验证的本机 FFmpeg，无法生成视频封面。"
          : "当前本机图片解码器不可用，无法生成缩略图。"
      });
    }

    try {
      const directory = await requireThumbnailDirectory(options.projectRoot);
      const target = join(directory, cacheName(asset, asset.mediaType));
      let bytes: Buffer;
      try {
        bytes = await readVerifiedPng(target);
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          await rm(target, { force: true }).catch(() => undefined);
        }
        const sourcePath = await options.resolveAssetPath(asset.assetId);
        const suffix = createId().replaceAll("-", "").toLocaleLowerCase("en-US");
        if (!/^[0-9a-f]{32}$/u.test(suffix)) throw new TypeError("Preview temporary identifier is invalid.");
        const temporary = join(directory, `.${cacheName(asset, asset.mediaType)}.${suffix}.tmp`);
        try {
          await renderer(sourcePath, temporary);
          bytes = await readVerifiedPng(temporary);
          try {
            await rename(temporary, target);
          } catch (renameError: unknown) {
            if ((renameError as NodeJS.ErrnoException).code !== "EEXIST") throw renameError;
            await rm(temporary, { force: true });
            bytes = await readVerifiedPng(target);
          }
        } catch (renderError: unknown) {
          await rm(temporary, { force: true }).catch(() => undefined);
          throw renderError;
        }
      }
      return result({
        kind: asset.mediaType === "image" ? "image_thumbnail" : "video_poster",
        status: "ready",
        mimeType: "image/png",
        dataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
        cacheKey,
        message: null
      });
    } catch {
      return result({
        kind: "unavailable", status: "failed", mimeType: null, dataUrl: null, cacheKey,
        message: asset.mediaType === "video"
          ? "视频封面生成失败，可以重试；原始素材没有被修改。"
          : "图片缩略图生成失败，可以重试；原始素材没有被修改。"
      });
    }
  };

  return Object.freeze({
    getPreview(assetId: string) {
      const existing = inFlight.get(assetId);
      if (existing !== undefined) return existing;
      const operation = createPreview(assetId).finally(() => inFlight.delete(assetId));
      inFlight.set(assetId, operation);
      return operation;
    }
  });
}
