import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import {
  RELAY_UPDATE_SOURCE,
  type CompletedUpdateCheckStatus,
  type SuccessfulUpdateCheckStatus,
  type UpdateCheckCacheContract,
  type UpdateCheckResultContract,
  type UpdateReleaseAssetContract,
  type UpdateReleaseAssetKind
} from "../../shared/update-source.js";
import { ensureDataRootLayout } from "./data-root.js";

const UPDATE_CACHE_FILE_NAME = "update-check.json";
const UPDATE_CACHE_MAX_BYTES = 64 * 1024;
const RESPONSE_MAX_BYTES = 4 * 1024 * 1024;
const RELEASE_NOTES_MAX_CHARACTERS = 800;
const DEFAULT_TIMEOUT_MS = 12_000;

const REQUEST_HEADERS = Object.freeze({
  Accept: "application/vnd.github+json",
  "User-Agent": "Relay-Stable-Update-Check",
  "X-GitHub-Api-Version": "2022-11-28"
});

export interface GithubUpdateHttpRequest {
  readonly url: typeof RELAY_UPDATE_SOURCE.releasesApiUrl;
  readonly method: "GET";
  readonly headers: typeof REQUEST_HEADERS;
  readonly timeoutMs: number;
}

export interface GithubUpdateHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | null>>;
  readonly body: string;
}

export type GithubUpdateHttpClient = (
  request: GithubUpdateHttpRequest
) => Promise<GithubUpdateHttpResponse>;

export interface GithubValidatedUpdateAsset extends UpdateReleaseAssetContract {
  /** Main-process authority only. Never place this object in an IPC response. */
  readonly downloadUrl: string;
  /** Official GitHub REST asset digest. Never place this value in an IPC response. */
  readonly sha256: string;
}

export interface GithubValidatedUpdateRelease {
  readonly channel: typeof RELAY_UPDATE_SOURCE.channel;
  readonly tag: string;
  readonly version: string;
  readonly releasePageUrl: string;
  readonly releaseNotes: string | null;
  readonly publishedAt: string;
  /** Main-process authority, keyed so renderer input cannot select arbitrary assets. */
  readonly assets: Readonly<{ readonly setup: GithubValidatedUpdateAsset }>;
}

export interface GithubUpdateCheckService {
  getCachedUpdateCheck(): Promise<UpdateCheckCacheContract | null>;
  checkForUpdates(): Promise<UpdateCheckResultContract>;
  /** Main-process-only handoff for the constrained downloader. */
  getValidatedRelease(): GithubValidatedUpdateRelease | null;
}

export interface CreateGithubUpdateCheckServiceOptions {
  readonly currentVersion: string;
  readonly dataRootPath: string | null;
  readonly httpClient?: GithubUpdateHttpClient;
  readonly now?: () => Date;
  readonly timeoutMs?: number;
}

interface ParsedSemver {
  readonly normalized: string;
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly (number | string)[];
}

interface SelectedRelease {
  readonly tag: string;
  readonly version: string;
  readonly release: Readonly<Record<string, unknown>>;
}

class MalformedGithubResponseError extends Error {}
class IncompleteGithubReleaseError extends Error {}

const STRICT_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;
const NUMERIC_IDENTIFIER = /^(?:0|[1-9]\d*)$/u;
const STRICT_STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const STRICT_GITHUB_SHA256_DIGEST = /^sha256:([0-9a-f]{64})$/u;

function parseIdentifier(value: string): number | string {
  if (!NUMERIC_IDENTIFIER.test(value)) return value;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new TypeError("Semantic version identifier is too large.");
  return parsed;
}

export function parseStrictSemver(value: string): ParsedSemver {
  if (typeof value !== "string" || value.length === 0 || value.length > 160 || value.trim() !== value) {
    throw new TypeError("Version must be a bounded strict semantic version.");
  }
  const candidate = value.startsWith("v") ? value.slice(1) : value;
  const match = candidate.match(STRICT_SEMVER);
  if (match === null) throw new TypeError("Version is not valid strict semantic version syntax.");
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (![major, minor, patch].every(Number.isSafeInteger)) {
    throw new TypeError("Semantic version component is too large.");
  }
  const rawPrerelease = match[4];
  const prerelease = rawPrerelease === undefined
    ? Object.freeze([])
    : Object.freeze(rawPrerelease.split(".").map((part) => {
        if (/^\d+$/u.test(part) && !NUMERIC_IDENTIFIER.test(part)) {
          throw new TypeError("Numeric semantic version identifiers cannot contain leading zeroes.");
        }
        return parseIdentifier(part);
      }));
  return Object.freeze({ normalized: candidate, major, minor, patch, prerelease });
}

export function compareStrictSemver(left: string, right: string): number {
  const a = parseStrictSemver(left);
  const b = parseStrictSemver(right);
  for (const key of ["major", "minor", "patch"] as const) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
  if (a.prerelease.length === 0) return 1;
  if (b.prerelease.length === 0) return -1;
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = a.prerelease[index];
    const rightPart = b.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    if (typeof leftPart === "number" && typeof rightPart === "string") return -1;
    if (typeof leftPart === "string" && typeof rightPart === "number") return 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

export function parseStrictStableVersion(value: string): string {
  const parsed = parseStrictSemver(value).normalized;
  if (!STRICT_STABLE_VERSION.test(parsed)) {
    throw new TypeError("Version is outside Relay's strict stable semantic-version channel.");
  }
  return parsed;
}

/** Stable tag comparison always uses x.y.z; artifact display omits only patch zero. */
export function formatStableAssetVersion(value: string): string {
  const stable = parseStrictStableVersion(value);
  const parsed = parseStrictSemver(stable);
  return parsed.patch === 0
    ? `${parsed.major}.${parsed.minor}`
    : `${parsed.major}.${parsed.minor}.${parsed.patch}`;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value));
}

function directSamePath(left: string, right: string): boolean {
  return resolve(left).toLocaleLowerCase("en-US") === resolve(right).toLocaleLowerCase("en-US");
}

function freezePublicAssets(assets: readonly UpdateReleaseAssetContract[]): readonly UpdateReleaseAssetContract[] {
  return Object.freeze(assets.map((asset) => Object.freeze({
    kind: asset.kind,
    name: asset.name,
    length: asset.length
  })));
}

export function expectedStableSetupAssetName(version: string): string {
  return `Relay-${formatStableAssetVersion(version)}-x64-Setup.exe`;
}

function expectedAssetNames(version: string): Readonly<{ readonly setup: string }> {
  return Object.freeze({
    setup: expectedStableSetupAssetName(version)
  });
}

function validPublicAssets(value: unknown, version: string): readonly UpdateReleaseAssetContract[] | null {
  if (!Array.isArray(value) || value.length !== 1) return null;
  const expected = expectedAssetNames(version);
  const byKind = new Map<UpdateReleaseAssetKind, UpdateReleaseAssetContract>();
  for (const entry of value) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return null;
    const record = entry as Record<string, unknown>;
    if (
      record.kind !== "setup" ||
      typeof record.name !== "string" ||
      record.name !== expected.setup ||
      typeof record.length !== "number" ||
      !Number.isSafeInteger(record.length) ||
      record.length <= 0 ||
      byKind.has(record.kind)
    ) return null;
    byKind.set(record.kind, Object.freeze({
      kind: record.kind,
      name: record.name,
      length: record.length
    }));
  }
  if (byKind.size !== 1) return null;
  return freezePublicAssets([
    byKind.get("setup") as UpdateReleaseAssetContract
  ]);
}

export function updateCheckCachePath(dataRootPath: string): string {
  if (!isAbsolute(dataRootPath) || dataRootPath.includes("\u0000")) {
    throw new TypeError("Update cache dataRoot must be an absolute local directory.");
  }
  return join(resolve(dataRootPath), "config", UPDATE_CACHE_FILE_NAME);
}

function parseCache(value: unknown): UpdateCheckCacheContract | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const expectedKeys = [
    "assets", "channel", "checkedAt", "currentVersion", "latestVersion", "publishedAt",
    "releaseNotes", "schemaVersion", "sourceId", "status", "tag"
  ];
  if (Object.keys(record).sort().join(",") !== expectedKeys.sort().join(",")) return null;
  if (
    record.schemaVersion !== 2 ||
    record.sourceId !== RELAY_UPDATE_SOURCE.sourceId ||
    record.channel !== RELAY_UPDATE_SOURCE.channel ||
    !validTimestamp(record.checkedAt) ||
    (record.status !== "latest" && record.status !== "update_available" && record.status !== "no_release") ||
    typeof record.currentVersion !== "string"
  ) return null;
  let currentVersion: string;
  try {
    currentVersion = parseStrictStableVersion(record.currentVersion);
  } catch {
    return null;
  }
  if (record.status === "no_release") {
    if (
      record.latestVersion !== null || record.tag !== null || record.releaseNotes !== null ||
      record.publishedAt !== null || !Array.isArray(record.assets) || record.assets.length !== 0
    ) return null;
    return Object.freeze({
      schemaVersion: 2,
      sourceId: RELAY_UPDATE_SOURCE.sourceId,
      channel: RELAY_UPDATE_SOURCE.channel,
      checkedAt: record.checkedAt,
      status: record.status,
      currentVersion,
      latestVersion: null,
      tag: null,
      releaseNotes: null,
      publishedAt: null,
      assets: Object.freeze([])
    });
  }
  if (
    typeof record.latestVersion !== "string" || typeof record.tag !== "string" ||
    !validTimestamp(record.publishedAt) ||
    (record.releaseNotes !== null && (
      typeof record.releaseNotes !== "string" || record.releaseNotes.length > RELEASE_NOTES_MAX_CHARACTERS
    ))
  ) return null;
  let latestVersion: string;
  try {
    latestVersion = parseStrictStableVersion(record.latestVersion);
    if (parseStrictStableTag(record.tag).version !== latestVersion) return null;
  } catch {
    return null;
  }
  const assets = validPublicAssets(record.assets, latestVersion);
  if (assets === null) return null;
  return Object.freeze({
    schemaVersion: 2,
    sourceId: RELAY_UPDATE_SOURCE.sourceId,
    channel: RELAY_UPDATE_SOURCE.channel,
    checkedAt: record.checkedAt,
    status: record.status,
    currentVersion,
    latestVersion,
    tag: record.tag,
    releaseNotes: record.releaseNotes as string | null,
    publishedAt: record.publishedAt,
    assets
  });
}

export async function loadUpdateCheckCache(dataRootPath: string | null): Promise<UpdateCheckCacheContract | null> {
  if (dataRootPath === null) return null;
  try {
    const path = updateCheckCachePath(dataRootPath);
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0 || metadata.size > UPDATE_CACHE_MAX_BYTES) return null;
    if (!directSamePath(await realpath(path), path)) return null;
    return parseCache(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return null;
  }
}

async function saveUpdateCheckCache(dataRootPath: string, cache: UpdateCheckCacheContract): Promise<void> {
  const layout = await ensureDataRootLayout(dataRootPath);
  await mkdir(layout.config, { recursive: true });
  const destination = updateCheckCachePath(layout.root);
  const temporary = `${destination}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(cache, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
    const handle = await open(temporary, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

function parseStrictStableTag(tag: string): { readonly tag: string; readonly version: string } {
  if (typeof tag !== "string" || tag.length === 0 || tag.length > 80 || tag.trim() !== tag) {
    throw new TypeError("Release tag is malformed.");
  }
  const version = parseStrictStableVersion(tag);
  if (tag !== `v${version}`) throw new TypeError("Release tag is malformed.");
  return Object.freeze({ tag, version });
}

function validateReleasePageUrl(value: string, tag: string): string {
  if (value.length === 0 || value.length > 2_048 || value.trim() !== value) throw new TypeError("Release URL is invalid.");
  const url = new URL(value);
  const expectedPath = `/${RELAY_UPDATE_SOURCE.owner}/${RELAY_UPDATE_SOURCE.repository}/releases/tag/${tag}`;
  if (
    url.protocol !== "https:" || url.hostname !== "github.com" || url.port !== "" ||
    url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "" ||
    url.pathname !== expectedPath
  ) throw new TypeError("Release URL is outside the fixed public GitHub repository.");
  return url.href;
}

function validateAssetDownloadUrl(value: string, tag: string, name: string): string {
  if (value.length === 0 || value.length > 4_096 || value.trim() !== value) {
    throw new IncompleteGithubReleaseError("Asset download URL is invalid.");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new IncompleteGithubReleaseError("Asset download URL is invalid.", { cause: error });
  }
  const expectedPath = `/${RELAY_UPDATE_SOURCE.owner}/${RELAY_UPDATE_SOURCE.repository}/releases/download/${tag}/${name}`;
  if (
    url.protocol !== "https:" || url.hostname !== "github.com" || url.port !== "" ||
    url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "" ||
    url.pathname !== expectedPath
  ) throw new IncompleteGithubReleaseError("Asset download URL is outside the fixed release.");
  return url.href;
}

function shortPlainReleaseNotes(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new TypeError("Release notes are malformed.");
  const normalized = value
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/gu, " ")
    .trim();
  return normalized.length === 0 ? null : normalized.slice(0, RELEASE_NOTES_MAX_CHARACTERS);
}

function selectHighestEligibleRelease(body: string): SelectedRelease | null {
  if (Buffer.byteLength(body, "utf8") > RESPONSE_MAX_BYTES) {
    throw new MalformedGithubResponseError("GitHub response is too large.");
  }
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch (error) {
    throw new MalformedGithubResponseError("GitHub response is not JSON.", { cause: error });
  }
  if (!Array.isArray(value)) throw new MalformedGithubResponseError("GitHub releases response is not an array.");
  let selected: SelectedRelease | null = null;
  let selectedCount = 0;
  for (const entry of value) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
    const release = entry as Record<string, unknown>;
    if (release.draft !== false || release.prerelease !== false || typeof release.tag_name !== "string") continue;
    let parsed: { readonly tag: string; readonly version: string };
    try {
      parsed = parseStrictStableTag(release.tag_name);
    } catch {
      continue;
    }
    if (selected === null || compareStrictSemver(parsed.version, selected.version) > 0) {
      selected = Object.freeze({ tag: parsed.tag, version: parsed.version, release: Object.freeze({ ...release }) });
      selectedCount = 1;
    } else if (compareStrictSemver(parsed.version, selected.version) === 0) {
      selectedCount += 1;
    }
  }
  if (selectedCount > 1) throw new MalformedGithubResponseError("Highest release version is ambiguous.");
  return selected;
}

function parseValidatedRelease(selected: SelectedRelease): GithubValidatedUpdateRelease {
  const release = selected.release;
  if (!validTimestamp(release.published_at) || typeof release.html_url !== "string") {
    throw new MalformedGithubResponseError("Selected release metadata is malformed.");
  }
  const releasePageUrl = validateReleasePageUrl(release.html_url, selected.tag);
  const releaseNotes = shortPlainReleaseNotes(release.body);
  if (!Array.isArray(release.assets) || release.assets.length !== 1) {
    throw new IncompleteGithubReleaseError("Selected stable release must contain exactly one Setup asset.");
  }
  const names = expectedAssetNames(selected.version);
  const assets = new Map<UpdateReleaseAssetKind, GithubValidatedUpdateAsset>();
  for (const entry of release.assets) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new IncompleteGithubReleaseError("Release asset metadata is malformed.");
    }
    const asset = entry as Record<string, unknown>;
    if (
      typeof asset.name !== "string" || typeof asset.size !== "number" ||
      !Number.isSafeInteger(asset.size) || asset.size <= 0 ||
      typeof asset.browser_download_url !== "string" ||
      typeof asset.digest !== "string" ||
      asset.state !== "uploaded"
    ) throw new IncompleteGithubReleaseError("Release asset metadata is malformed.");
    const digest = STRICT_GITHUB_SHA256_DIGEST.exec(asset.digest);
    if (digest === null) {
      throw new IncompleteGithubReleaseError("Release asset is missing a strict GitHub SHA-256 digest.");
    }
    const kind: UpdateReleaseAssetKind | undefined = asset.name === names.setup ? "setup" : undefined;
    if (kind === undefined || assets.has(kind)) {
      throw new IncompleteGithubReleaseError("Release assets are missing, duplicated, or unexpected.");
    }
    assets.set(kind, Object.freeze({
      kind,
      name: asset.name,
      length: asset.size,
      downloadUrl: validateAssetDownloadUrl(asset.browser_download_url, selected.tag, asset.name),
      sha256: digest[1] as string
    }));
  }
  if (assets.size !== 1) throw new IncompleteGithubReleaseError("Release Setup asset is incomplete.");
  return Object.freeze({
    channel: RELAY_UPDATE_SOURCE.channel,
    tag: selected.tag,
    version: selected.version,
    releasePageUrl,
    releaseNotes,
    publishedAt: release.published_at,
    assets: Object.freeze({
      setup: assets.get("setup") as GithubValidatedUpdateAsset
    })
  });
}

function publicAssets(release: GithubValidatedUpdateRelease): readonly UpdateReleaseAssetContract[] {
  return freezePublicAssets([
    release.assets.setup
  ]);
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

function rateLimitResetAt(headers: Readonly<Record<string, string | null>>): string | null {
  const raw = header(headers, "x-ratelimit-reset");
  if (raw === null || !/^\d{1,12}$/u.test(raw)) return null;
  const milliseconds = Number(raw) * 1_000;
  if (!Number.isSafeInteger(milliseconds)) return null;
  const parsed = new Date(milliseconds);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Reads the GitHub REST body without ever accumulating more than the fixed
 * response budget. This also caps decompressed/chunked responses whose
 * Content-Length is absent or smaller than the bytes delivered by fetch.
 */
export async function readBoundedGithubResponseBody(
  body: ReadableStream<Uint8Array> | null
): Promise<string> {
  if (body === null) return "";
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = Buffer.from(next.value.buffer, next.value.byteOffset, next.value.byteLength);
      if (bytes + chunk.byteLength > RESPONSE_MAX_BYTES) {
        await reader.cancel("Relay GitHub response exceeded its byte limit.").catch(() => undefined);
        throw new MalformedGithubResponseError("GitHub response is too large.");
      }
      if (chunk.byteLength === 0) continue;
      chunks.push(chunk);
      bytes += chunk.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, bytes).toString("utf8");
}

async function githubHttpClient(request: GithubUpdateHttpRequest): Promise<GithubUpdateHttpResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeoutMs);
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      redirect: "error",
      cache: "no-store",
      signal: controller.signal
    });
    const declaredLength = response.headers.get("content-length");
    if (declaredLength !== null) {
      if (!/^(?:0|[1-9]\d*)$/u.test(declaredLength)) {
        controller.abort();
        throw new MalformedGithubResponseError("GitHub response length is malformed.");
      }
      const parsedLength = Number(declaredLength);
      if (!Number.isSafeInteger(parsedLength) || parsedLength > RESPONSE_MAX_BYTES) {
        controller.abort();
        throw new MalformedGithubResponseError("GitHub response is too large.");
      }
    }
    const body = await readBoundedGithubResponseBody(response.body);
    return Object.freeze({
      status: response.status,
      headers: Object.freeze({
        "content-type": response.headers.get("content-type"),
        "x-ratelimit-remaining": response.headers.get("x-ratelimit-remaining"),
        "x-ratelimit-reset": response.headers.get("x-ratelimit-reset")
      }),
      body
    });
  } finally {
    clearTimeout(timer);
  }
}

function result(options: {
  readonly status: CompletedUpdateCheckStatus;
  readonly checkedAt: string;
  readonly currentVersion: string;
  readonly latestVersion?: string | null;
  readonly tag?: string | null;
  readonly releaseNotes?: string | null;
  readonly publishedAt?: string | null;
  readonly assets?: readonly UpdateReleaseAssetContract[];
  readonly rateLimitResetAt?: string | null;
  readonly message: string;
  readonly cachePersisted?: boolean;
  readonly cached: UpdateCheckCacheContract | null;
}): UpdateCheckResultContract {
  return Object.freeze({
    status: options.status,
    channel: RELAY_UPDATE_SOURCE.channel,
    checkedAt: options.checkedAt,
    currentVersion: options.currentVersion,
    latestVersion: options.latestVersion ?? null,
    tag: options.tag ?? null,
    releaseNotes: options.releaseNotes ?? null,
    publishedAt: options.publishedAt ?? null,
    assets: freezePublicAssets(options.assets ?? []),
    rateLimitResetAt: options.rateLimitResetAt ?? null,
    message: options.message,
    cachePersisted: options.cachePersisted ?? false,
    cached: options.cached
  });
}

export function createGithubUpdateCheckService(
  options: CreateGithubUpdateCheckServiceOptions
): GithubUpdateCheckService {
  const currentVersion = parseStrictStableVersion(options.currentVersion);
  if (options.dataRootPath !== null && !isAbsolute(options.dataRootPath)) {
    throw new TypeError("Update check dataRoot must be absolute.");
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) {
    throw new TypeError("Update check timeout must be between one and sixty seconds.");
  }
  const httpClient = options.httpClient ?? githubHttpClient;
  const now = options.now ?? (() => new Date());
  let inFlight: Promise<UpdateCheckResultContract> | null = null;
  let validatedRelease: GithubValidatedUpdateRelease | null = null;

  const getCachedUpdateCheck = (): Promise<UpdateCheckCacheContract | null> => (
    loadUpdateCheckCache(options.dataRootPath)
  );

  const execute = async (): Promise<UpdateCheckResultContract> => {
    const checkedAt = now().toISOString();
    const previousCache = await getCachedUpdateCheck();
    let response: GithubUpdateHttpResponse;
    try {
      response = await httpClient(Object.freeze({
        url: RELAY_UPDATE_SOURCE.releasesApiUrl,
        method: "GET",
        headers: REQUEST_HEADERS,
        timeoutMs
      }));
    } catch (error) {
      if (error instanceof MalformedGithubResponseError) {
        return result({
          status: "malformed",
          checkedAt,
          currentVersion,
          message: "GitHub 返回的版本信息格式异常，Relay 未采用该结果。",
          cached: previousCache
        });
      }
      return result({
        status: "network",
        checkedAt,
        currentVersion,
        message: "无法连接 GitHub，请检查网络后重试。",
        cached: previousCache
      });
    }

    if (response.status === 403 || response.status === 429) {
      const resetAt = rateLimitResetAt(response.headers);
      return result({
        status: "rate_limit",
        checkedAt,
        currentVersion,
        rateLimitResetAt: resetAt,
        message: resetAt === null
          ? "GitHub 暂时限制了匿名检查次数，请稍后重试。"
          : `GitHub 暂时限制了匿名检查次数，可在 ${resetAt} 后重试。`,
        cached: previousCache
      });
    }

    let successfulStatus: SuccessfulUpdateCheckStatus;
    let latestVersion: string | null = null;
    let tag: string | null = null;
    let releaseNotes: string | null = null;
    let publishedAt: string | null = null;
    let assets: readonly UpdateReleaseAssetContract[] = Object.freeze([]);
    let message: string;

    if (response.status === 404) {
      validatedRelease = null;
      successfulStatus = "no_release";
      message = "该公开仓库尚未发布正式稳定版本。";
    } else if (response.status === 200) {
      let selected: SelectedRelease | null;
      try {
        selected = selectHighestEligibleRelease(response.body);
      } catch {
        return result({
          status: "malformed",
          checkedAt,
          currentVersion,
          message: "GitHub 返回的版本信息格式异常，Relay 未采用该结果。",
          cached: previousCache
        });
      }
      if (selected === null) {
        validatedRelease = null;
        successfulStatus = "no_release";
        message = "该公开仓库尚未发布合格的正式稳定版本。";
      } else {
        latestVersion = selected.version;
        tag = selected.tag;
        let release: GithubValidatedUpdateRelease;
        try {
          release = parseValidatedRelease(selected);
        } catch (error) {
          validatedRelease = null;
          if (error instanceof IncompleteGithubReleaseError) {
            return result({
              status: "release_incomplete",
              checkedAt,
              currentVersion,
              latestVersion,
              tag,
              message: `最高稳定版本 ${latestVersion} 的 Setup 资产不完整，Relay 不会改用旧版本。`,
              cached: previousCache
            });
          }
          return result({
            status: "malformed",
            checkedAt,
            currentVersion,
            latestVersion,
            tag,
            message: "GitHub 返回的最高稳定版本信息格式异常，Relay 未采用该结果。",
            cached: previousCache
          });
        }
        validatedRelease = release;
        releaseNotes = release.releaseNotes;
        publishedAt = release.publishedAt;
        assets = publicAssets(release);
        if (compareStrictSemver(currentVersion, latestVersion) < 0) {
          successfulStatus = "update_available";
          message = `发现稳定新版本 ${latestVersion}。`;
        } else {
          successfulStatus = "latest";
          message = "当前已是稳定通道最新版本。";
        }
      }
    } else {
      return result({
        status: "network",
        checkedAt,
        currentVersion,
        message: `GitHub 暂时无法完成检查（HTTP ${response.status}）。`,
        cached: previousCache
      });
    }

    const cache: UpdateCheckCacheContract = Object.freeze({
      schemaVersion: 2,
      sourceId: RELAY_UPDATE_SOURCE.sourceId,
      channel: RELAY_UPDATE_SOURCE.channel,
      checkedAt,
      status: successfulStatus,
      currentVersion,
      latestVersion,
      tag,
      releaseNotes,
      publishedAt,
      assets
    });
    if (options.dataRootPath === null) {
      return result({
        status: successfulStatus,
        checkedAt,
        currentVersion,
        latestVersion,
        tag,
        releaseNotes,
        publishedAt,
        assets,
        message: `${message} 检查结果未写入数据目录。`,
        cached: previousCache
      });
    }
    try {
      await saveUpdateCheckCache(options.dataRootPath, cache);
      return result({
        status: successfulStatus,
        checkedAt,
        currentVersion,
        latestVersion,
        tag,
        releaseNotes,
        publishedAt,
        assets,
        message,
        cachePersisted: true,
        cached: cache
      });
    } catch {
      return result({
        status: successfulStatus,
        checkedAt,
        currentVersion,
        latestVersion,
        tag,
        releaseNotes,
        publishedAt,
        assets,
        message: `${message} 但检查结果未能保存到 Relay 数据目录。`,
        cached: previousCache
      });
    }
  };

  const checkForUpdates = (): Promise<UpdateCheckResultContract> => {
    if (inFlight !== null) return inFlight;
    const pending = execute().finally(() => {
      if (inFlight === pending) inFlight = null;
    });
    inFlight = pending;
    return pending;
  };

  return Object.freeze({
    getCachedUpdateCheck,
    checkForUpdates,
    getValidatedRelease: () => validatedRelease
  });
}
