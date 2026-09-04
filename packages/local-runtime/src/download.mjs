import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

import { atomicWriteJson } from "./atomic-file.mjs";
import { LocalRuntimeError, runtimeFail } from "./errors.mjs";

const SIDECAR_VERSION = "1.0.0";
const CHECKPOINT_BYTES = 8 * 1024 * 1024;
const CHECKPOINT_INTERVAL_MS = 750;
const CANCEL_CHECK_INTERVAL_MS = 50;
const CONNECT_TIMEOUT_MS = 20_000;
const STREAM_STALL_TIMEOUT_MS = 90_000;
const SOURCE_ROUNDS = 2;
const WINDOWS_RENAME_RETRY_DELAYS_MS = Object.freeze([0, 10, 25, 50, 100, 200, 400, 800, 1_600]);
const RETRYABLE_RENAME_ERRORS = new Set(["EACCES", "EBUSY", "EEXIST", "EPERM"]);
const FALLBACK_DOWNLOAD_CODES = new Set([
  "LOCAL_RUNTIME.DOWNLOAD_HTTP_FAILED",
  "LOCAL_RUNTIME.DOWNLOAD_LENGTH_MISMATCH",
  "LOCAL_RUNTIME.DOWNLOAD_NETWORK_FAILED",
  "LOCAL_RUNTIME.DOWNLOAD_RANGE_MISMATCH",
  "LOCAL_RUNTIME.DOWNLOAD_RANGE_UNSUPPORTED",
  "LOCAL_RUNTIME.DOWNLOAD_REDIRECT_FORBIDDEN",
  "LOCAL_RUNTIME.DOWNLOAD_SHA256_MISMATCH",
  "LOCAL_RUNTIME.DOWNLOAD_STREAM_FAILED",
  "LOCAL_RUNTIME.DOWNLOAD_TRUNCATED"
]);
const RETRY_NEXT_ROUND_CODES = new Set([
  "LOCAL_RUNTIME.DOWNLOAD_HTTP_FAILED",
  "LOCAL_RUNTIME.DOWNLOAD_NETWORK_FAILED",
  "LOCAL_RUNTIME.DOWNLOAD_STREAM_FAILED",
  "LOCAL_RUNTIME.DOWNLOAD_TRUNCATED"
]);

async function inspectFile(filePath) {
  try {
    const value = await stat(filePath);
    return value.isFile() ? value.size : null;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function sourceUrls(artifact) {
  const urls = artifact.urls ?? [artifact.url];
  if (!Array.isArray(urls) || urls.length === 0 || urls.some((value) => typeof value !== "string")) {
    runtimeFail("LOCAL_RUNTIME.DOWNLOAD_SOURCE_INVALID", "download", "local_runtime.download.source_candidates");
  }
  return [...new Set(urls)];
}

function sidecarFor(artifact, downloadedBytes, sourceUrl) {
  return {
    schema_version: SIDECAR_VERSION,
    artifact_id: artifact.id,
    url: sourceUrl,
    expected_byte_length: artifact.expected_byte_length,
    expected_sha256: artifact.expected_sha256,
    downloaded_bytes: downloadedBytes
  };
}

async function readMatchingSidecar(sidecarPath, artifact, partialSize) {
  let value;
  try {
    value = JSON.parse(await readFile(sidecarPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    runtimeFail("LOCAL_RUNTIME.DOWNLOAD_SIDECAR_INVALID", "download", "local_runtime.download.sidecar_json");
  }
  const expected = {
    schema_version: SIDECAR_VERSION,
    artifact_id: artifact.id,
    expected_byte_length: artifact.expected_byte_length,
    expected_sha256: artifact.expected_sha256
  };
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (value?.[key] !== expectedValue) runtimeFail("LOCAL_RUNTIME.DOWNLOAD_SIDECAR_MISMATCH", "download", "local_runtime.download.sidecar_binding");
  }
  if (!sourceUrls(artifact).includes(value?.url)) {
    runtimeFail("LOCAL_RUNTIME.DOWNLOAD_SIDECAR_MISMATCH", "download", "local_runtime.download.sidecar_source");
  }
  if (!Number.isSafeInteger(value?.downloaded_bytes) || value.downloaded_bytes < 0 || value.downloaded_bytes > partialSize) {
    runtimeFail("LOCAL_RUNTIME.DOWNLOAD_SIDECAR_MISMATCH", "download", "local_runtime.download.sidecar_progress");
  }
  return value;
}

async function seedHash(filePath, byteLength, { isCancelled = null } = {}) {
  const hash = createHash("sha256");
  if (byteLength === 0) return hash;
  let count = 0;
  let cancellationCheckpoint = 0;
  for await (const chunk of createReadStream(filePath)) {
    count += chunk.byteLength;
    hash.update(chunk);
    if (
      isCancelled !== null &&
      count - cancellationCheckpoint >= CHECKPOINT_BYTES
    ) {
      cancellationCheckpoint = count;
      if (await isCancelled()) return null;
    }
  }
  if (count !== byteLength) runtimeFail("LOCAL_RUNTIME.DOWNLOAD_PARTIAL_CHANGED", "download", "local_runtime.download.partial_identity");
  return hash;
}

function contentRangeMatches(response, offset, expectedByteLength) {
  const value = response.headers.get("content-range");
  const match = /^bytes ([0-9]+)-([0-9]+)\/([0-9]+|\*)$/u.exec(value ?? "");
  return Boolean(match &&
    Number(match[1]) === offset &&
    Number(match[2]) === expectedByteLength - 1 &&
    Number(match[3]) === expectedByteLength);
}

function validateResponseIdentity(response, requestedUrl, allowHttp) {
  let finalUrl;
  try {
    finalUrl = new URL(response.url || requestedUrl);
  } catch {
    runtimeFail("LOCAL_RUNTIME.DOWNLOAD_REDIRECT_FORBIDDEN", "download", "local_runtime.download.official_https_redirect");
  }
  if (allowHttp) return;
  const hostname = finalUrl.hostname.toLowerCase();
  const approved = hostname === "github.com" ||
    hostname === "huggingface.co" ||
    hostname === "dl.todesktop.com" ||
    hostname === "modelscope.cn" ||
    hostname.endsWith(".modelscope.cn") ||
    hostname.endsWith(".githubusercontent.com") ||
    hostname.endsWith(".hf.co");
  if (finalUrl.protocol !== "https:" || !approved) {
    runtimeFail("LOCAL_RUNTIME.DOWNLOAD_REDIRECT_FORBIDDEN", "download", "local_runtime.download.official_https_redirect");
  }
}

async function wait(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readWithStallTimeout(reader, controller) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("download stream stalled"));
    }, STREAM_STALL_TIMEOUT_MS);
  });
  try {
    return await Promise.race([reader.read(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSource(fetchImpl, url, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { headers, redirect: "follow", signal: controller.signal });
    return { response, controller };
  } catch {
    runtimeFail("LOCAL_RUNTIME.DOWNLOAD_NETWORK_FAILED", "download", "local_runtime.download.fetch");
  } finally {
    clearTimeout(timer);
  }
}

async function writeAll(handle, chunk) {
  let offset = 0;
  while (offset < chunk.byteLength) {
    let result;
    try {
      result = await handle.write(chunk, offset, chunk.byteLength - offset);
    } catch (error) {
      runtimeFail(
        error?.code === "ENOSPC" ? "LOCAL_RUNTIME.DOWNLOAD_DISK_FULL" : "LOCAL_RUNTIME.DOWNLOAD_PARTIAL_WRITE_FAILED",
        "download",
        "local_runtime.download.partial_write"
      );
    }
    if (!Number.isSafeInteger(result?.bytesWritten) || result.bytesWritten <= 0) {
      runtimeFail("LOCAL_RUNTIME.DOWNLOAD_STREAM_FAILED", "download", "local_runtime.download.partial_write");
    }
    offset += result.bytesWritten;
  }
}

async function syncPartial(handle) {
  try {
    await handle.datasync();
  } catch (error) {
    runtimeFail(
      error?.code === "ENOSPC" ? "LOCAL_RUNTIME.DOWNLOAD_DISK_FULL" : "LOCAL_RUNTIME.DOWNLOAD_PARTIAL_WRITE_FAILED",
      "download",
      "local_runtime.download.partial_sync"
    );
  }
}

async function commitPartial(partialPath, destinationPath) {
  for (let attempt = 0; attempt < WINDOWS_RENAME_RETRY_DELAYS_MS.length; attempt += 1) {
    await wait(WINDOWS_RENAME_RETRY_DELAYS_MS[attempt]);
    try {
      await rename(partialPath, destinationPath);
      return;
    } catch (error) {
      const retryable = RETRYABLE_RENAME_ERRORS.has(error?.code);
      if (!retryable || attempt === WINDOWS_RENAME_RETRY_DELAYS_MS.length - 1) {
        runtimeFail("LOCAL_RUNTIME.DOWNLOAD_COMMIT_FAILED", "download", "local_runtime.download.atomic_commit");
      }
    }
  }
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function readLease(lockPath) {
  try {
    return JSON.parse(await readFile(lockPath, "utf8"));
  } catch {
    return null;
  }
}

async function acquireDownloadLease(lockPath) {
  const token = randomUUID();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify({ pid: process.pid, token })}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      const assertOwner = async () => {
        const current = await readLease(lockPath);
        if (current?.pid !== process.pid || current?.token !== token) {
          runtimeFail("LOCAL_RUNTIME.DOWNLOAD_LEASE_LOST", "download", "local_runtime.download.single_writer");
        }
      };
      const release = async () => {
        for (const delayMs of WINDOWS_RENAME_RETRY_DELAYS_MS) {
          await wait(delayMs);
          const current = await readLease(lockPath);
          if (current?.pid !== process.pid || current?.token !== token) return;
          try {
            await rm(lockPath, { force: true });
            return;
          } catch (error) {
            if (!RETRYABLE_RENAME_ERRORS.has(error?.code)) return;
          }
        }
      };
      return { assertOwner, release };
    } catch (error) {
      if (error?.code !== "EEXIST") {
        runtimeFail("LOCAL_RUNTIME.DOWNLOAD_LOCK_FAILED", "download", "local_runtime.download.single_writer");
      }
      const lock = await readLease(lockPath);
      if (processIsAlive(lock?.pid)) {
        runtimeFail("LOCAL_RUNTIME.DOWNLOAD_ALREADY_RUNNING", "download", "local_runtime.download.single_writer", 1);
      }
      if (lock === null) {
        const metadata = await stat(lockPath).catch(() => null);
        if (metadata !== null && Date.now() - metadata.mtimeMs < 30_000) {
          runtimeFail("LOCAL_RUNTIME.DOWNLOAD_ALREADY_RUNNING", "download", "local_runtime.download.single_writer", 1);
        }
      }
      const confirmed = await readLease(lockPath);
      if (
        confirmed?.pid !== lock?.pid ||
        confirmed?.token !== lock?.token
      ) continue;
      await rm(lockPath, { force: true });
    }
  }
  runtimeFail("LOCAL_RUNTIME.DOWNLOAD_ALREADY_RUNNING", "download", "local_runtime.download.single_writer", 1);
}

async function verifyAndCommitCompletePartial({
  artifact,
  sourceUrl,
  destinationPath,
  partialPath,
  sidecarPath,
  isCancelled,
  assertLease
}) {
  if (await isCancelled()) return Object.freeze({ status: "cancelled", downloaded_bytes: artifact.expected_byte_length });
  await assertLease();
  const hash = await seedHash(partialPath, artifact.expected_byte_length, { isCancelled });
  if (hash === null) return Object.freeze({ status: "cancelled", downloaded_bytes: artifact.expected_byte_length });
  const sha256 = hash.digest("hex");
  if (sha256 !== artifact.expected_sha256) {
    await rm(partialPath, { force: true });
    await rm(sidecarPath, { force: true });
    runtimeFail("LOCAL_RUNTIME.DOWNLOAD_SHA256_MISMATCH", "download", "local_runtime.download.sha256");
  }
  await assertLease();
  await commitPartial(partialPath, destinationPath);
  await rm(sidecarPath, { force: true });
  return Object.freeze({
    status: "downloaded",
    byte_length: artifact.expected_byte_length,
    sha256,
    source_url: sourceUrl
  });
}

async function downloadFromSource({
  artifact,
  sourceUrl,
  destinationPath,
  partialPath,
  sidecarPath,
  fetchImpl,
  allowHttp,
  isCancelled,
  onProgress,
  assertLease
}) {
  let offset = await inspectFile(partialPath) ?? 0;
  if (offset > artifact.expected_byte_length) runtimeFail("LOCAL_RUNTIME.DOWNLOAD_PARTIAL_OVERSIZE", "download", "local_runtime.download.partial_length");
  let sidecar = null;
  if (offset > 0) sidecar = await readMatchingSidecar(sidecarPath, artifact, offset);
  else if (await inspectFile(sidecarPath) !== null) await rm(sidecarPath, { force: true });

  if (offset === artifact.expected_byte_length) {
    return verifyAndCommitCompletePartial({
      artifact,
      sourceUrl: sidecar?.url ?? sourceUrl,
      destinationPath,
      partialPath,
      sidecarPath,
      isCancelled,
      assertLease
    });
  }

  if (await isCancelled()) return Object.freeze({ status: "cancelled", downloaded_bytes: offset });
  const headers = { "Accept-Encoding": "identity" };
  if (offset > 0) headers.Range = `bytes=${offset}-`;
  const { response, controller } = await fetchSource(fetchImpl, sourceUrl, headers);
  try {
    if (!response.body || !response.ok) runtimeFail("LOCAL_RUNTIME.DOWNLOAD_HTTP_FAILED", "download", "local_runtime.download.http_status");
    validateResponseIdentity(response, sourceUrl, allowHttp);
    if (offset > 0 && response.status === 206 && !contentRangeMatches(response, offset, artifact.expected_byte_length)) {
      runtimeFail("LOCAL_RUNTIME.DOWNLOAD_RANGE_MISMATCH", "download", "local_runtime.download.content_range");
    }
    if (offset > 0 && response.status !== 206) {
      runtimeFail("LOCAL_RUNTIME.DOWNLOAD_RANGE_UNSUPPORTED", "download", "local_runtime.download.resume_protocol");
    }
    const contentLength = response.headers.get("content-length");
    if (contentLength !== null && (!/^[0-9]+$/u.test(contentLength) || Number(contentLength) !== artifact.expected_byte_length - offset)) {
      runtimeFail("LOCAL_RUNTIME.DOWNLOAD_LENGTH_MISMATCH", "download", "local_runtime.download.response_content_length");
    }
  } catch (error) {
    controller.abort();
    await response.body?.cancel().catch(() => {});
    throw error;
  }

  let handle;
  try {
    handle = await open(partialPath, offset === 0 ? "w" : "a", 0o600);
  } catch (error) {
    runtimeFail(
      error?.code === "ENOSPC" ? "LOCAL_RUNTIME.DOWNLOAD_DISK_FULL" : "LOCAL_RUNTIME.DOWNLOAD_PARTIAL_WRITE_FAILED",
      "download",
      "local_runtime.download.partial_open"
    );
  }
  const reader = response.body.getReader();
  let downloaded = offset;
  let checkpointBytes = offset;
  let checkpointAt = Date.now();
  let cancelCheckBytes = offset;
  let cancelCheckAt = 0;
  const cancellationRequested = async (force = false) => {
    const now = Date.now();
    if (
      !force &&
      downloaded - cancelCheckBytes < CHECKPOINT_BYTES &&
      now - cancelCheckAt < CANCEL_CHECK_INTERVAL_MS
    ) return false;
    cancelCheckBytes = downloaded;
    cancelCheckAt = now;
    return isCancelled();
  };
  const persist = async (force = false) => {
    const now = Date.now();
    if (!force && downloaded - checkpointBytes < CHECKPOINT_BYTES && now - checkpointAt < CHECKPOINT_INTERVAL_MS) return;
    await assertLease();
    await syncPartial(handle);
    await atomicWriteJson(sidecarPath, sidecarFor(artifact, downloaded, sourceUrl), {
      failureCode: "LOCAL_RUNTIME.DOWNLOAD_STATE_PERSIST_FAILED",
      ruleId: "local_runtime.download.sidecar_atomic_replace",
      stage: "download"
    });
    await onProgress(downloaded, artifact.expected_byte_length);
    checkpointBytes = downloaded;
    checkpointAt = now;
  };
  try {
    await persist(true);
    while (true) {
      if (await cancellationRequested()) {
        await persist(true);
        return Object.freeze({ status: "cancelled", downloaded_bytes: downloaded });
      }
      let result;
      try {
        result = await readWithStallTimeout(reader, controller);
      } catch {
        await persist(true);
        runtimeFail("LOCAL_RUNTIME.DOWNLOAD_STREAM_FAILED", "download", "local_runtime.download.stream");
      }
      if (result.done) break;
      const chunk = result.value;
      const nextDownloaded = downloaded + chunk.byteLength;
      if (!Number.isSafeInteger(nextDownloaded) || nextDownloaded > artifact.expected_byte_length) {
        runtimeFail("LOCAL_RUNTIME.DOWNLOAD_LENGTH_OVERFLOW", "download", "local_runtime.download.exact_length");
      }
      await writeAll(handle, chunk);
      downloaded = nextDownloaded;
      await persist(false);
    }
    await persist(true);
  } finally {
    await reader.cancel().catch(() => {});
    await handle.close();
  }
  if (downloaded !== artifact.expected_byte_length) runtimeFail("LOCAL_RUNTIME.DOWNLOAD_TRUNCATED", "download", "local_runtime.download.exact_length");
  const hash = await seedHash(partialPath, downloaded, { isCancelled });
  if (hash === null) return Object.freeze({ status: "cancelled", downloaded_bytes: downloaded });
  const sha256 = hash.digest("hex");
  if (sha256 !== artifact.expected_sha256) {
    await rm(partialPath, { force: true });
    await rm(sidecarPath, { force: true });
    runtimeFail("LOCAL_RUNTIME.DOWNLOAD_SHA256_MISMATCH", "download", "local_runtime.download.sha256");
  }
  await assertLease();
  await commitPartial(partialPath, destinationPath);
  await rm(sidecarPath, { force: true });
  return Object.freeze({ status: "downloaded", byte_length: downloaded, sha256, source_url: sourceUrl });
}

export async function verifyFileIdentity(filePath, artifact) {
  const size = await inspectFile(filePath);
  if (size !== artifact.expected_byte_length) return Object.freeze({ verified: false, reason: size === null ? "missing" : "size_mismatch" });
  const hash = await seedHash(filePath, size);
  const sha256 = hash.digest("hex");
  return Object.freeze({ verified: sha256 === artifact.expected_sha256, reason: sha256 === artifact.expected_sha256 ? null : "sha256_mismatch", sha256 });
}

export async function downloadArtifact({
  artifact,
  destinationPath,
  partialPath = `${destinationPath}.partial`,
  sidecarPath = `${destinationPath}.partial.json`,
  fetchImpl = globalThis.fetch,
  allowHttp = false,
  isCancelled = async () => false,
  onProgress = async () => {}
}) {
  const candidates = sourceUrls(artifact);
  for (const candidate of candidates) {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" && !(allowHttp && parsed.protocol === "http:")) {
      runtimeFail("LOCAL_RUNTIME.DOWNLOAD_SCHEME_FORBIDDEN", "download", "local_runtime.download.https_only");
    }
  }
  await mkdir(path.dirname(destinationPath), { recursive: true });
  const existing = await verifyFileIdentity(destinationPath, artifact);
  if (existing.verified) return Object.freeze({ status: "reused_managed", byte_length: artifact.expected_byte_length, sha256: artifact.expected_sha256 });
  if (existing.reason !== "missing") runtimeFail("LOCAL_RUNTIME.DESTINATION_IDENTITY_MISMATCH", "download", "local_runtime.download.no_overwrite");

  const lease = await acquireDownloadLease(`${destinationPath}.download.lock`);
  try {
    await lease.assertOwner();
    const afterLease = await verifyFileIdentity(destinationPath, artifact);
    if (afterLease.verified) return Object.freeze({ status: "reused_managed", byte_length: artifact.expected_byte_length, sha256: artifact.expected_sha256 });
    if (afterLease.reason !== "missing") runtimeFail("LOCAL_RUNTIME.DESTINATION_IDENTITY_MISMATCH", "download", "local_runtime.download.no_overwrite");

    let lastError = null;
    let roundCandidates = candidates;
    for (let round = 0; round < SOURCE_ROUNDS; round += 1) {
      const nextRoundCandidates = [];
      for (const sourceUrl of roundCandidates) {
        try {
          return await downloadFromSource({
            artifact,
            sourceUrl,
            destinationPath,
            partialPath,
            sidecarPath,
            fetchImpl,
            allowHttp,
            isCancelled,
            onProgress,
            assertLease: lease.assertOwner
          });
        } catch (error) {
          if (!(error instanceof LocalRuntimeError) || !FALLBACK_DOWNLOAD_CODES.has(error.code)) throw error;
          lastError = error;
          if (RETRY_NEXT_ROUND_CODES.has(error.code)) nextRoundCandidates.push(sourceUrl);
        }
      }
      if (nextRoundCandidates.length === 0) break;
      roundCandidates = nextRoundCandidates;
      if (round + 1 < SOURCE_ROUNDS) await wait(500 * (round + 1));
    }
    throw lastError;
  } finally {
    await lease.release();
  }
}
