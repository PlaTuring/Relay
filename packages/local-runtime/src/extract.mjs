import { lstat, mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { runtimeFail } from "./errors.mjs";

const execFileAsync = promisify(execFile);
export const SYSTEM_TAR_EXE = "C:\\Windows\\System32\\tar.exe";

export function validateArchiveListing(stdout) {
  const entries = String(stdout).split(/\r?\n/u).filter((value) => value.length > 0);
  if (entries.length === 0 || entries.length > 1_000_000) runtimeFail("LOCAL_RUNTIME.ARCHIVE_LIST_INVALID", "extract", "local_runtime.extract.nonempty_bounded_listing");
  for (const raw of entries) {
    const value = raw.replaceAll("\\", "/");
    if (value.startsWith("/") || value.includes(":") || value.includes("\0")) {
      runtimeFail("LOCAL_RUNTIME.ARCHIVE_ABSOLUTE_PATH", "extract", "local_runtime.extract.relative_entries_only");
    }
    const parts = value.split("/").filter(Boolean);
    if (parts.some((part) => part === "." || part === "..")) {
      runtimeFail("LOCAL_RUNTIME.ARCHIVE_TRAVERSAL", "extract", "local_runtime.extract.no_traversal");
    }
    if (parts.some((part) => /[. ]$/u.test(part) || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu.test(part))) {
      runtimeFail("LOCAL_RUNTIME.ARCHIVE_WINDOWS_NAME_FORBIDDEN", "extract", "local_runtime.extract.portable_windows_names");
    }
  }
  return entries;
}

export function createSystemTarRunner(executable = SYSTEM_TAR_EXE) {
  return Object.freeze({
    async list(archivePath) {
      try {
        const result = await execFileAsync(executable, ["-tf", archivePath], { windowsHide: true, maxBuffer: 128 * 1024 * 1024 });
        return result.stdout;
      } catch {
        runtimeFail("LOCAL_RUNTIME.ARCHIVE_LIST_FAILED", "extract", "local_runtime.extract.tar_list");
      }
    },
    async extract(archivePath, destination) {
      try {
        await execFileAsync(executable, ["-xf", archivePath, "-C", destination], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
      } catch {
        runtimeFail("LOCAL_RUNTIME.ARCHIVE_EXTRACT_FAILED", "extract", "local_runtime.extract.tar_extract");
      }
    }
  });
}

async function verifyPlainTree(root) {
  const pending = [root];
  let count = 0;
  while (pending.length) {
    const current = pending.pop();
    const stats = await lstat(current);
    if (stats.isSymbolicLink()) runtimeFail("LOCAL_RUNTIME.EXTRACTED_REPARSE_FORBIDDEN", "extract", "local_runtime.extract.no_reparse");
    if (stats.isDirectory()) {
      for (const name of await readdir(current)) pending.push(path.join(current, name));
    } else if (!stats.isFile()) {
      runtimeFail("LOCAL_RUNTIME.EXTRACTED_SPECIAL_FILE_FORBIDDEN", "extract", "local_runtime.extract.regular_files_only");
    }
    count += 1;
    if (count > 2_000_000) runtimeFail("LOCAL_RUNTIME.EXTRACTED_TREE_TOO_LARGE", "extract", "local_runtime.extract.bounded_tree");
  }
}

async function requireRegularFile(filePath) {
  try {
    const stats = await lstat(filePath);
    return stats.isFile() && !stats.isSymbolicLink();
  } catch {
    return false;
  }
}

function safeArchiveRelative(value, rule) {
  if (typeof value !== "string" || value.length === 0) runtimeFail("LOCAL_RUNTIME.ARCHIVE_LAYOUT_INVALID", "extract", rule);
  const normalized = value.replaceAll("\\", "/");
  const parts = normalized.split("/");
  if (normalized.startsWith("/") || normalized.includes(":") || parts.some((part) => !part || part === "." || part === "..")) {
    runtimeFail("LOCAL_RUNTIME.ARCHIVE_LAYOUT_INVALID", "extract", rule);
  }
  return { normalized, parts };
}

export async function extractFfmpegArchive({
  archivePath,
  stagingPath,
  destinationPath,
  archiveRoot,
  requiredFiles,
  runner = createSystemTarRunner(),
  isCancelled = async () => false
}) {
  const root = safeArchiveRelative(archiveRoot, "local_runtime.extract.ffmpeg_archive_root");
  if (root.parts.length !== 1 || !Array.isArray(requiredFiles) || requiredFiles.length === 0) {
    runtimeFail("LOCAL_RUNTIME.ARCHIVE_LAYOUT_INVALID", "extract", "local_runtime.extract.ffmpeg_required_layout");
  }
  const required = requiredFiles.map((value) => safeArchiveRelative(value, "local_runtime.extract.ffmpeg_required_file"));
  let destinationExists = false;
  try {
    destinationExists = (await lstat(destinationPath)).isDirectory();
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (destinationExists) {
    const complete = (await Promise.all(required.map((value) => requireRegularFile(path.join(destinationPath, ...value.parts))))).every(Boolean);
    if (complete) return Object.freeze({ status: "reused_managed_ffmpeg" });
    runtimeFail("LOCAL_RUNTIME.FFMPEG_DESTINATION_INVALID", "extract", "local_runtime.extract.no_overwrite_existing_ffmpeg");
  }
  await rm(stagingPath, { recursive: true, force: true });
  await mkdir(stagingPath, { recursive: true });
  try {
    if (await isCancelled()) return Object.freeze({ status: "cancelled" });
    const listing = validateArchiveListing(await runner.list(archivePath)).map((value) => value.replaceAll("\\", "/"));
    if (listing.some((value) => value !== root.normalized && !value.startsWith(`${root.normalized}/`))) {
      runtimeFail("LOCAL_RUNTIME.FFMPEG_ARCHIVE_LAYOUT_INVALID", "extract", "local_runtime.extract.single_ffmpeg_root");
    }
    for (const requiredFile of required) {
      const expected = `${root.normalized}/${requiredFile.normalized}`;
      if (!listing.includes(expected)) runtimeFail("LOCAL_RUNTIME.FFMPEG_ARCHIVE_LAYOUT_INVALID", "extract", "local_runtime.extract.required_ffmpeg_binaries_listed");
    }
    if (await isCancelled()) return Object.freeze({ status: "cancelled" });
    await runner.extract(archivePath, stagingPath);
    await verifyPlainTree(stagingPath);
    const extractedRoot = path.join(stagingPath, root.normalized);
    for (const requiredFile of required) {
      if (!await requireRegularFile(path.join(extractedRoot, ...requiredFile.parts))) {
        runtimeFail("LOCAL_RUNTIME.FFMPEG_ARCHIVE_LAYOUT_INVALID", "extract", "local_runtime.extract.required_ffmpeg_binaries_extracted");
      }
    }
    if (await isCancelled()) return Object.freeze({ status: "cancelled" });
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await rename(extractedRoot, destinationPath);
    return Object.freeze({ status: "installed", destination_kind: "managed_ffmpeg" });
  } catch (error) {
    await rm(stagingPath, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(stagingPath, { recursive: true, force: true });
  }
}

export async function extractComfyPortable({ archivePath, stagingPath, destinationPath, runner = createSystemTarRunner() }) {
  let destinationExists = false;
  try {
    destinationExists = (await lstat(destinationPath)).isDirectory();
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (destinationExists) {
    const python = path.join(destinationPath, "python_embeded", "python.exe");
    const main = path.join(destinationPath, "ComfyUI", "main.py");
    if (await requireRegularFile(python) && await requireRegularFile(main)) return Object.freeze({ status: "reused_managed_runtime" });
    runtimeFail("LOCAL_RUNTIME.COMFY_DESTINATION_INVALID", "extract", "local_runtime.extract.no_overwrite_existing");
  }
  await rm(stagingPath, { recursive: true, force: true });
  await mkdir(stagingPath, { recursive: true });
  try {
    validateArchiveListing(await runner.list(archivePath));
    await runner.extract(archivePath, stagingPath);
    await verifyPlainTree(stagingPath);
    const extractedRoot = path.join(stagingPath, "ComfyUI_windows_portable");
    if (!await requireRegularFile(path.join(extractedRoot, "python_embeded", "python.exe")) ||
        !await requireRegularFile(path.join(extractedRoot, "ComfyUI", "main.py"))) {
      runtimeFail("LOCAL_RUNTIME.COMFY_ARCHIVE_LAYOUT_INVALID", "extract", "local_runtime.extract.required_comfy_layout");
    }
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await rename(extractedRoot, destinationPath);
    return Object.freeze({ status: "installed", destination_kind: "managed_comfy_portable" });
  } catch (error) {
    await rm(stagingPath, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(stagingPath, { recursive: true, force: true });
  }
}
