import { createHash } from "node:crypto";
import { lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import {
  type UpdateDownloadErrorCode,
  type UpdateDownloadKind,
  type UpdateDownloadStatusContract
} from "../../shared/update-source.js";
import { ensureDataRootLayout } from "./data-root.js";
import {
  compareStrictSemver,
  parseStrictStableVersion,
  type GithubValidatedUpdateAsset,
  type GithubValidatedUpdateRelease
} from "./github-update-check.js";

const DEFAULT_DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;
const DOWNLOAD_HEADERS = Object.freeze({
  Accept: "application/octet-stream",
  "User-Agent": "Relay-Stable-Update-Download"
});
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const ASSET_CDN_HOSTS = new Set([
  "release-assets.githubusercontent.com",
  "objects.githubusercontent.com"
]);

export interface GithubUpdateDownloadRequest {
  readonly url: string;
  readonly method: "GET";
  readonly headers: typeof DOWNLOAD_HEADERS;
  readonly signal: AbortSignal;
}

export interface GithubUpdateDownloadResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | null>>;
  readonly body: AsyncIterable<Uint8Array> | null;
}

export type GithubUpdateDownloadHttpClient = (
  request: GithubUpdateDownloadRequest
) => Promise<GithubUpdateDownloadResponse>;

export interface GithubUpdateDownloadService {
  /** Starts a main-process download and returns immediately with polling state. */
  downloadUpdate(request: { readonly kind: UpdateDownloadKind }): Promise<UpdateDownloadStatusContract>;
  getUpdateDownloadStatus(): UpdateDownloadStatusContract;
  cancelUpdateDownload(): Promise<UpdateDownloadStatusContract>;
  /** Performs an injected shell action without returning a path. */
  openDownloadedUpdateFolder(): Promise<boolean>;
  /** Performs an injected shell action without returning a URL. */
  openValidatedReleasePage(): Promise<boolean>;
}

export interface CreateGithubUpdateDownloadServiceOptions {
  readonly dataRootPath: string | null;
  readonly currentVersion: string;
  readonly preferredKind: UpdateDownloadKind;
  readonly getValidatedRelease: () => GithubValidatedUpdateRelease | null;
  readonly httpClient?: GithubUpdateDownloadHttpClient;
  readonly openFolder?: (folderPath: string) => void | Promise<void>;
  readonly openExternal?: (url: string) => void | Promise<void>;
  /** Launches only the exact, service-validated Setup path. No arguments are accepted. */
  readonly launchInstaller?: (installerPath: string) => void | Promise<void>;
  readonly timeoutMs?: number;
}

interface ActiveDownload {
  readonly context: {
    readonly controller: AbortController;
    cancelRequested: boolean;
  };
  readonly promise: Promise<void>;
}

interface DownloadedFile {
  readonly bytes: number;
  readonly sha256: string;
}

interface InstallerFileIdentity {
  readonly dev: number | bigint;
  readonly ino: number | bigint;
  readonly size: number | bigint;
  readonly mtimeMs: number | bigint;
  readonly ctimeMs: number | bigint;
  readonly birthtimeMs: number | bigint;
  readonly sha256: string;
}

export class UpdateDownloadServiceError extends Error {
  readonly code: UpdateDownloadErrorCode;

  constructor(code: UpdateDownloadErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "UpdateDownloadServiceError";
    this.code = code;
  }
}

function samePath(left: string, right: string): boolean {
  return resolve(left).toLocaleLowerCase("en-US") === resolve(right).toLocaleLowerCase("en-US");
}

async function assertDirectDirectory(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || !samePath(await realpath(path), path)) {
    throw new UpdateDownloadServiceError("filesystem", "更新下载目录不是普通本机目录。");
  }
}

async function assertReplaceableFile(path: string): Promise<void> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || !samePath(await realpath(path), path)) {
      throw new UpdateDownloadServiceError("filesystem", "更新目标文件不是普通文件。");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
}

export function updateDownloadDirectory(dataRootPath: string, version: string): string {
  if (!isAbsolute(dataRootPath) || dataRootPath.includes("\u0000")) {
    throw new TypeError("Update download dataRoot must be an absolute local directory.");
  }
  return join(resolve(dataRootPath), "downloads", "updates", parseStrictStableVersion(version));
}

function immutableStatus(
  value: UpdateDownloadStatusContract,
  canOpenReleasePage: boolean
): UpdateDownloadStatusContract {
  return Object.freeze({ ...value, canOpenReleasePage });
}

function header(headers: Readonly<Record<string, string | null>>, name: string): string | null {
  const direct = headers[name];
  if (direct !== undefined) return direct;
  const target = name.toLocaleLowerCase("en-US");
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLocaleLowerCase("en-US") === target) return value;
  }
  return null;
}

function parseRequiredContentLength(
  headers: Readonly<Record<string, string | null>>,
  expectedLength: number
): void {
  const raw = header(headers, "content-length");
  if (raw === null || !/^(?:0|[1-9]\d*)$/u.test(raw)) {
    throw new UpdateDownloadServiceError("length_mismatch", "下载响应缺少有效的 Content-Length。");
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed !== expectedLength) {
    throw new UpdateDownloadServiceError("length_mismatch", "GitHub API 与下载响应报告的文件长度不一致。");
  }
}

function validateRedirectUrl(value: string): string {
  if (value.length === 0 || value.length > 8_192 || value.trim() !== value) {
    throw new UpdateDownloadServiceError("redirect_blocked", "更新下载重定向地址无效。");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new UpdateDownloadServiceError("redirect_blocked", "更新下载重定向地址无效。", { cause: error });
  }
  if (
    url.protocol !== "https:" || url.port !== "" || url.username !== "" ||
    url.password !== "" || url.hash !== "" || !ASSET_CDN_HOSTS.has(url.hostname)
  ) throw new UpdateDownloadServiceError("redirect_blocked", "更新下载重定向超出 GitHub 资产白名单。");
  return url.href;
}

/** Exported for deterministic redirect-policy tests; it grants no network action. */
export function isAllowedUpdateRedirect(value: string): boolean {
  try {
    validateRedirectUrl(value);
    return true;
  } catch {
    return false;
  }
}

async function* responseChunks(stream: ReadableStream<Uint8Array>): AsyncIterable<Uint8Array> {
  const reader = stream.getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) return;
      yield next.value;
    }
  } finally {
    reader.releaseLock();
  }
}

async function defaultDownloadHttpClient(
  request: GithubUpdateDownloadRequest
): Promise<GithubUpdateDownloadResponse> {
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    redirect: "manual",
    cache: "no-store",
    signal: request.signal
  });
  return Object.freeze({
    status: response.status,
    headers: Object.freeze({
      "content-length": response.headers.get("content-length"),
      location: response.headers.get("location")
    }),
    body: response.body === null ? null : responseChunks(response.body)
  });
}

function strictDownloadRequest(value: { readonly kind: UpdateDownloadKind }): UpdateDownloadKind {
  if (
    value === null || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).length !== 1 || value.kind !== "setup"
  ) throw new TypeError("Stable update download request must contain only kind=setup.");
  return value.kind;
}

async function writeAll(
  handle: Awaited<ReturnType<typeof open>>,
  value: Uint8Array
): Promise<void> {
  let offset = 0;
  while (offset < value.byteLength) {
    let bytesWritten: number;
    try {
      const written = await handle.write(value, offset, value.byteLength - offset);
      bytesWritten = written.bytesWritten;
    } catch (error) {
      throw new UpdateDownloadServiceError("filesystem", "Relay 无法写入更新临时文件。", { cause: error });
    }
    if (bytesWritten <= 0) {
      throw new UpdateDownloadServiceError("filesystem", "更新临时文件写入未取得进展。");
    }
    offset += bytesWritten;
  }
}

async function requestDownloadResponse(options: {
  readonly initialUrl: string;
  readonly expectedLength: number;
  readonly client: GithubUpdateDownloadHttpClient;
  readonly signal: AbortSignal;
  readonly touchTimeout: () => void;
}): Promise<GithubUpdateDownloadResponse> {
  let url = options.initialUrl;
  const visited = new Set<string>();
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    if (visited.has(url)) {
      throw new UpdateDownloadServiceError("redirect_blocked", "更新下载重定向形成循环。");
    }
    visited.add(url);
    options.touchTimeout();
    let response: GithubUpdateDownloadResponse;
    try {
      response = await options.client(Object.freeze({
        url,
        method: "GET",
        headers: DOWNLOAD_HEADERS,
        signal: options.signal
      }));
    } catch (error) {
      if (error instanceof UpdateDownloadServiceError) throw error;
      if (options.signal.reason instanceof UpdateDownloadServiceError) throw options.signal.reason;
      throw new UpdateDownloadServiceError("network", "更新下载网络请求中断。", { cause: error });
    }
    options.touchTimeout();
    if (REDIRECT_STATUSES.has(response.status)) {
      if (redirects === MAX_REDIRECTS) {
        throw new UpdateDownloadServiceError("redirect_blocked", "更新下载重定向次数过多。");
      }
      const location = header(response.headers, "location");
      if (location === null) {
        throw new UpdateDownloadServiceError("redirect_blocked", "更新下载重定向缺少目标地址。");
      }
      let resolved: string;
      try {
        resolved = new URL(location, url).href;
      } catch (error) {
        throw new UpdateDownloadServiceError("redirect_blocked", "更新下载重定向地址无效。", { cause: error });
      }
      url = validateRedirectUrl(resolved);
      continue;
    }
    if (response.status !== 200) {
      throw new UpdateDownloadServiceError("http", `GitHub 更新资产下载失败（HTTP ${response.status}）。`);
    }
    parseRequiredContentLength(response.headers, options.expectedLength);
    if (response.body === null) {
      throw new UpdateDownloadServiceError("length_mismatch", "更新下载响应没有文件内容。");
    }
    return response;
  }
  throw new UpdateDownloadServiceError("redirect_blocked", "更新下载重定向次数过多。");
}

async function downloadAssetToPartial(options: {
  readonly asset: GithubValidatedUpdateAsset;
  readonly partialPath: string;
  readonly client: GithubUpdateDownloadHttpClient;
  readonly signal: AbortSignal;
  readonly touchTimeout: () => void;
  readonly onBytes: (received: number) => void;
}): Promise<DownloadedFile> {
  try {
    await rm(options.partialPath, { force: true });
  } catch (error) {
    throw new UpdateDownloadServiceError("filesystem", "Relay 无法清理旧的更新临时文件。", { cause: error });
  }
  const response = await requestDownloadResponse({
    initialUrl: options.asset.downloadUrl,
    expectedLength: options.asset.length,
    client: options.client,
    signal: options.signal,
    touchTimeout: options.touchTimeout
  });
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(options.partialPath, "wx", 0o600);
  } catch (error) {
    throw new UpdateDownloadServiceError("filesystem", "Relay 无法创建更新临时文件。", { cause: error });
  }
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    try {
      for await (const rawChunk of response.body as AsyncIterable<Uint8Array>) {
        options.touchTimeout();
        if (options.signal.aborted) throw options.signal.reason;
        const chunk = rawChunk instanceof Uint8Array ? rawChunk : new Uint8Array(rawChunk);
        if (chunk.byteLength === 0) continue;
        if (bytes + chunk.byteLength > options.asset.length) {
          throw new UpdateDownloadServiceError("length_mismatch", "下载响应超过 GitHub API 声明的文件长度。");
        }
        await writeAll(handle, chunk);
        hash.update(chunk);
        bytes += chunk.byteLength;
        options.onBytes(chunk.byteLength);
      }
    } catch (error) {
      if (error instanceof UpdateDownloadServiceError) throw error;
      if (options.signal.reason instanceof UpdateDownloadServiceError) throw options.signal.reason;
      throw new UpdateDownloadServiceError("network", "更新文件响应流中断。", { cause: error });
    }
    if (bytes !== options.asset.length) {
      throw new UpdateDownloadServiceError("length_mismatch", "下载响应短于 GitHub API 声明的文件长度。");
    }
    try {
      await handle.sync();
    } catch (error) {
      throw new UpdateDownloadServiceError("filesystem", "Relay 无法同步更新临时文件。", { cause: error });
    }
  } finally {
    await handle.close().catch(() => undefined);
  }
  return Object.freeze({ bytes, sha256: hash.digest("hex") });
}

async function atomicPublish(partialPath: string, destinationPath: string): Promise<void> {
  await assertReplaceableFile(destinationPath);
  try {
    await rename(partialPath, destinationPath);
  } catch (error) {
    throw new UpdateDownloadServiceError("filesystem", "Relay 无法原子完成已验证更新文件。", { cause: error });
  }
}

function snapshotInstallerIdentity(
  metadata: Awaited<ReturnType<typeof lstat>>,
  sha256: string
): InstallerFileIdentity {
  return Object.freeze({
    dev: metadata.dev,
    ino: metadata.ino,
    size: metadata.size,
    mtimeMs: metadata.mtimeMs,
    ctimeMs: metadata.ctimeMs,
    birthtimeMs: metadata.birthtimeMs,
    sha256
  });
}

function sameInstallerIdentity(
  left: InstallerFileIdentity,
  right: InstallerFileIdentity
): boolean {
  return (
    left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
    left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs &&
    left.birthtimeMs === right.birthtimeMs && left.sha256 === right.sha256
  );
}

async function assertVerifiedInstallerStillCurrent(
  installerPath: string,
  expected: InstallerFileIdentity
): Promise<void> {
  await assertReplaceableFile(installerPath);
  const metadata = await lstat(installerPath);
  const current = snapshotInstallerIdentity(metadata, expected.sha256);
  if (!sameInstallerIdentity(current, expected)) {
    throw new UpdateDownloadServiceError(
      "filesystem",
      "安装前复核发现下载文件身份已经变化。"
    );
  }
}

async function verifyPublishedInstaller(
  installerPath: string,
  asset: GithubValidatedUpdateAsset
): Promise<InstallerFileIdentity> {
  await assertReplaceableFile(installerPath);
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(installerPath, "r");
  } catch (error) {
    throw new UpdateDownloadServiceError(
      "filesystem",
      "已下载的安装程序无法重新打开校验。",
      { cause: error }
    );
  }
  const digest = createHash("sha256");
  let bytes = 0;
  let openedIdentity: InstallerFileIdentity | null = null;
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size !== asset.length) {
      throw new UpdateDownloadServiceError(
        "length_mismatch",
        "安装前复核发现下载文件长度已经变化。"
      );
    }
    openedIdentity = snapshotInstallerIdentity(metadata, asset.sha256);
    while (bytes < asset.length) {
      const result = await handle.read(buffer, 0, Math.min(buffer.length, asset.length - bytes), bytes);
      if (result.bytesRead <= 0) break;
      digest.update(buffer.subarray(0, result.bytesRead));
      bytes += result.bytesRead;
    }
    const finalMetadata = await handle.stat();
    if (!sameInstallerIdentity(
      snapshotInstallerIdentity(finalMetadata, asset.sha256),
      openedIdentity
    )) {
      throw new UpdateDownloadServiceError(
        "filesystem",
        "安装前复核发现下载文件在校验期间发生变化。"
      );
    }
  } finally {
    await handle.close().catch(() => undefined);
  }
  if (bytes !== asset.length) {
    throw new UpdateDownloadServiceError(
      "length_mismatch",
      "安装前复核发现下载文件长度已经变化。"
    );
  }
  const actualSha256 = digest.digest("hex");
  if (actualSha256 !== asset.sha256) {
    throw new UpdateDownloadServiceError(
      "hash_mismatch",
      "安装前复核发现下载文件的 SHA-256 已经变化。"
    );
  }
  if (openedIdentity === null) {
    throw new UpdateDownloadServiceError("filesystem", "安装前未能取得下载文件身份。");
  }
  await assertVerifiedInstallerStillCurrent(installerPath, openedIdentity);
  return openedIdentity;
}

export function createGithubUpdateDownloadService(
  options: CreateGithubUpdateDownloadServiceOptions
): GithubUpdateDownloadService {
  if (options.dataRootPath !== null && (!isAbsolute(options.dataRootPath) || options.dataRootPath.includes("\u0000"))) {
    throw new TypeError("Update download dataRoot must be absolute.");
  }
  if (options.preferredKind !== "setup") {
    throw new TypeError("Update preferred kind is invalid.");
  }
  const preferredKind: UpdateDownloadKind = "setup";
  const currentVersion = parseStrictStableVersion(options.currentVersion);
  const timeoutMs = options.timeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
    throw new TypeError("Update download idle timeout must be between one and 120 seconds.");
  }
  const client = options.httpClient ?? defaultDownloadHttpClient;
  let status: UpdateDownloadStatusContract = Object.freeze({
    state: "idle",
    preferredKind,
    kind: null,
    version: null,
    tag: null,
    phase: "idle",
    assetName: null,
    bytesReceived: 0,
    bytesTotal: 0,
    errorCode: null,
    message: null,
    canOpenFolder: false,
    canOpenReleasePage: false
  });
  let active: ActiveDownload | null = null;
  let completedFolderPath: string | null = null;

  const currentStatus = (): UpdateDownloadStatusContract => immutableStatus(
    status,
    options.getValidatedRelease() !== null
  );

  const setStatus = (next: UpdateDownloadStatusContract): void => {
    status = Object.freeze({ ...next });
  };

  const failWithoutTask = (
    code: UpdateDownloadErrorCode,
    message: string,
    kind: UpdateDownloadKind
  ): UpdateDownloadStatusContract => {
    completedFolderPath = null;
    setStatus({
      state: "failed",
      preferredKind,
      kind,
      version: null,
      tag: null,
      phase: "failed",
      assetName: null,
      bytesReceived: 0,
      bytesTotal: 0,
      errorCode: code,
      message,
      canOpenFolder: false,
      canOpenReleasePage: false
    });
    return currentStatus();
  };

  const runDownload = async (
    context: { readonly controller: AbortController; cancelRequested: boolean },
    release: GithubValidatedUpdateRelease,
    kind: UpdateDownloadKind
  ): Promise<void> => {
    const binary = release.assets.setup;
    let directory: string | null = null;
    let binaryPartial: string | null = null;
    let binaryDestination: string | null = null;
    let verifiedInstallerIdentity: InstallerFileIdentity | null = null;
    let received = 0;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const touchTimeout = (): void => {
      if (timeout !== null) clearTimeout(timeout);
      timeout = setTimeout(() => {
        if (!context.controller.signal.aborted) {
          context.controller.abort(new UpdateDownloadServiceError("network", "更新下载等待网络数据超时。"));
        }
      }, timeoutMs);
    };
    const updateProgress = (increment: number): void => {
      received += increment;
      setStatus({
        state: "downloading",
        preferredKind,
        kind,
        version: release.version,
        tag: release.tag,
        phase: "binary",
        assetName: binary.name,
        bytesReceived: received,
        bytesTotal: binary.length,
        errorCode: null,
        message: "正在下载稳定版安装文件…",
        canOpenFolder: false,
        canOpenReleasePage: true
      });
    };
    try {
      if (options.dataRootPath === null) {
        throw new UpdateDownloadServiceError("data_root_unavailable", "Relay 数据目录尚未就绪，无法下载更新。");
      }
      if (!/^[0-9a-f]{64}$/u.test(binary.sha256)) {
        throw new UpdateDownloadServiceError("hash_mismatch", "GitHub 官方资产摘要无效，Relay 未开始下载。");
      }
      const layout = await ensureDataRootLayout(options.dataRootPath);
      directory = updateDownloadDirectory(layout.root, release.version);
      const updatesDirectory = join(layout.downloads, "updates");
      await mkdir(updatesDirectory, { recursive: true });
      await assertDirectDirectory(updatesDirectory);
      await mkdir(directory, { recursive: true });
      await assertDirectDirectory(directory);
      binaryPartial = join(directory, `${binary.name}.partial`);
      binaryDestination = join(directory, binary.name);
      await assertReplaceableFile(binaryDestination);
      await rm(binaryDestination, { force: true });

      setStatus({
        state: "downloading",
        preferredKind,
        kind,
        version: release.version,
        tag: release.tag,
        phase: "binary",
        assetName: binary.name,
        bytesReceived: 0,
        bytesTotal: binary.length,
        errorCode: null,
        message: "正在下载稳定版安装文件…",
        canOpenFolder: false,
        canOpenReleasePage: true
      });
      touchTimeout();
      const downloaded = await downloadAssetToPartial({
        asset: binary,
        partialPath: binaryPartial,
        client,
        signal: context.controller.signal,
        touchTimeout,
        onBytes: updateProgress
      });
      setStatus({
        state: "downloading",
        preferredKind,
        kind,
        version: release.version,
        tag: release.tag,
        phase: "verifying",
        assetName: binary.name,
        bytesReceived: received,
        bytesTotal: binary.length,
        errorCode: null,
        message: "正在校验 SHA-256…",
        canOpenFolder: false,
        canOpenReleasePage: true
      });
      if (downloaded.sha256 !== binary.sha256) {
        throw new UpdateDownloadServiceError("hash_mismatch", "下载文件的 SHA-256 与 GitHub 官方资产摘要不一致。");
      }
      setStatus({
        state: "downloading",
        preferredKind,
        kind,
        version: release.version,
        tag: release.tag,
        phase: "finalizing",
        assetName: binary.name,
        bytesReceived: received,
        bytesTotal: binary.length,
        errorCode: null,
        message: "正在完成已验证下载…",
        canOpenFolder: false,
        canOpenReleasePage: true
      });
      await atomicPublish(binaryPartial, binaryDestination);
      binaryPartial = null;
      completedFolderPath = directory;
      verifiedInstallerIdentity = await verifyPublishedInstaller(binaryDestination, binary);
      if (context.cancelRequested || context.controller.signal.aborted) {
        throw new UpdateDownloadServiceError("cancelled", "更新安装已由用户取消。");
      }
      if (timeout !== null) {
        clearTimeout(timeout);
        timeout = null;
      }
      if (options.launchInstaller === undefined) {
        throw new UpdateDownloadServiceError(
          "installer_launch_unavailable",
          "当前 Relay 构建未提供安装程序启动能力。"
        );
      }
      setStatus({
        state: "installing",
        preferredKind,
        kind,
        version: release.version,
        tag: release.tag,
        phase: "installing",
        assetName: binary.name,
        bytesReceived: received,
        bytesTotal: binary.length,
        errorCode: null,
        message: "校验完成，正在启动 Relay 安装程序…",
        canOpenFolder: false,
        canOpenReleasePage: true
      });
      try {
        await assertVerifiedInstallerStillCurrent(binaryDestination, verifiedInstallerIdentity);
        await options.launchInstaller(binaryDestination);
      } catch (error) {
        throw new UpdateDownloadServiceError(
          "installer_launch_failed",
          "Relay 安装程序未能启动，请检查 Windows 安全提示或系统策略。",
          { cause: error }
        );
      }
      setStatus({
        state: "completed",
        preferredKind,
        kind,
        version: release.version,
        tag: release.tag,
        phase: "completed",
        assetName: binary.name,
        bytesReceived: received,
        bytesTotal: binary.length,
        errorCode: null,
        message: "Relay 安装程序已启动。",
        canOpenFolder: true,
        canOpenReleasePage: true
      });
    } catch (error) {
      let cancelled = context.cancelRequested;
      let failure = error instanceof UpdateDownloadServiceError
        ? error
          : context.controller.signal.reason instanceof UpdateDownloadServiceError
            ? context.controller.signal.reason
            : new UpdateDownloadServiceError("filesystem", "Relay 无法完成更新文件操作。", { cause: error });
      completedFolderPath = null;
      // A terminal status is observable by the renderer immediately. Remove every
      // partial before publishing that status so callers can never observe
      // "failed/cancelled" while an unverified executable is still present.
      try {
        if (binaryPartial !== null) await rm(binaryPartial, { force: true });
        binaryPartial = null;
        if (
          (failure.code === "installer_launch_failed" || failure.code === "installer_launch_unavailable") &&
          directory !== null && binaryDestination !== null && verifiedInstallerIdentity !== null
        ) {
          await assertVerifiedInstallerStillCurrent(binaryDestination, verifiedInstallerIdentity);
          completedFolderPath = directory;
        } else if (
          binaryDestination !== null
        ) {
          await rm(binaryDestination, { force: true });
        }
      } catch (cleanupError) {
        cancelled = false;
        if (binaryDestination !== null) {
          await rm(binaryDestination, { force: true }).catch(() => undefined);
        }
        completedFolderPath = null;
        failure = new UpdateDownloadServiceError(
          "filesystem",
          "更新临时文件未能完全清理；Relay 未报告下载成功。",
          { cause: cleanupError }
        );
      }
      setStatus({
        state: cancelled ? "cancelled" : "failed",
        preferredKind,
        kind,
        version: release.version,
        tag: release.tag,
        phase: cancelled ? "cancelled" : "failed",
        assetName: binary.name,
        bytesReceived: received,
        bytesTotal: binary.length,
        errorCode: cancelled ? "cancelled" : failure.code,
        message: cancelled ? "更新下载已取消，临时文件已删除。" : failure.message.trim(),
        canOpenFolder: completedFolderPath !== null,
        canOpenReleasePage: true
      });
    } finally {
      if (timeout !== null) clearTimeout(timeout);
      try {
        if (binaryPartial !== null) await rm(binaryPartial, { force: true });
      } catch {
        completedFolderPath = null;
        setStatus({
          state: "failed",
          preferredKind,
          kind,
          version: release.version,
          tag: release.tag,
          phase: "failed",
          assetName: binary.name,
          bytesReceived: received,
          bytesTotal: binary.length,
          errorCode: "filesystem",
          message: "更新临时文件未能完全清理；Relay 未报告下载成功。",
          canOpenFolder: false,
          canOpenReleasePage: true
        });
      }
    }
  };

  const downloadUpdate = async (
    request: { readonly kind: UpdateDownloadKind }
  ): Promise<UpdateDownloadStatusContract> => {
    const kind = strictDownloadRequest(request);
    if (active !== null) {
      throw new UpdateDownloadServiceError("download_in_progress", "同一时间只能下载一个 Relay 更新文件。");
    }
    const release = options.getValidatedRelease();
    if (release === null) {
      return failWithoutTask("no_validated_release", "请先主动检查并验证最新稳定版本。", kind);
    }
    if (compareStrictSemver(release.version, currentVersion) <= 0) {
      return failWithoutTask("no_newer_release", "当前没有可安装的新版本。", kind);
    }
    if (status.state === "completed" && status.version === release.version && status.tag === release.tag) {
      return currentStatus();
    }
    if (options.dataRootPath === null) {
      return failWithoutTask("data_root_unavailable", "Relay 数据目录尚未就绪，无法下载更新。", kind);
    }
    completedFolderPath = null;
    const context = { controller: new AbortController(), cancelRequested: false };
    setStatus({
      state: "downloading",
      preferredKind,
      kind,
      version: release.version,
      tag: release.tag,
      phase: "binary",
      assetName: release.assets.setup.name,
      bytesReceived: 0,
      bytesTotal: release.assets.setup.length,
      errorCode: null,
      message: "正在准备下载稳定版安装文件…",
      canOpenFolder: false,
      canOpenReleasePage: true
    });
    let pending: Promise<void>;
    pending = runDownload(context, release, kind).finally(() => {
      if (active?.promise === pending) active = null;
    });
    active = { context, promise: pending };
    return currentStatus();
  };

  const cancelUpdateDownload = async (): Promise<UpdateDownloadStatusContract> => {
    const task = active;
    if (task === null) return currentStatus();
    if (status.state === "installing") return currentStatus();
    task.context.cancelRequested = true;
    task.context.controller.abort(new UpdateDownloadServiceError("cancelled", "更新下载已由用户取消。"));
    await task.promise;
    return currentStatus();
  };

  const openDownloadedUpdateFolder = async (): Promise<boolean> => {
    if (completedFolderPath === null || options.openFolder === undefined || status.canOpenFolder !== true) return false;
    try {
      await assertDirectDirectory(completedFolderPath);
      await options.openFolder(completedFolderPath);
      return true;
    } catch {
      return false;
    }
  };

  const openValidatedReleasePage = async (): Promise<boolean> => {
    const release = options.getValidatedRelease();
    if (release === null || options.openExternal === undefined) return false;
    try {
      await options.openExternal(release.releasePageUrl);
      return true;
    } catch {
      return false;
    }
  };

  return Object.freeze({
    downloadUpdate,
    getUpdateDownloadStatus: currentStatus,
    cancelUpdateDownload,
    openDownloadedUpdateFolder,
    openValidatedReleasePage
  });
}
