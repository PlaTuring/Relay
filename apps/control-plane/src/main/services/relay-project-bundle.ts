import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve
} from "node:path";
import { Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInflateRaw, inflateRawSync } from "node:zlib";

import {
  canonicalRelayProjectJson,
  normalizeProjectRelativePath,
  normalizeRelayProject,
  RELAY_PROJECT_SCHEMA_VERSION,
  type JsonValue,
  type RelayProjectAsset,
  type RelayProjectDocument
} from "../../shared/project-domain.js";
import { preflightLocalAsset } from "./asset-preflight.js";
import { isGeneratedVideoPosterCacheArtifactName } from "./generated-video-artifacts.js";

export const RELAY_PROJECT_BUNDLE_VERSION = 1 as const;

export interface RelayProjectBundleFileRecord {
  readonly path: string;
  readonly byteLength: number;
  readonly sha256: string;
}

export interface RelayProjectBundleExternalRecord {
  readonly referenceId: string;
  readonly displayName: string;
  readonly expectedSha256: string | null;
  readonly action: "excluded" | "copied";
  readonly bundleRelativePath: string | null;
}

export interface RelayProjectBundleManifest {
  readonly format: "relay-project-bundle";
  readonly bundleVersion: typeof RELAY_PROJECT_BUNDLE_VERSION;
  readonly projectSchemaVersion: typeof RELAY_PROJECT_SCHEMA_VERSION;
  readonly projectId: string;
  readonly createdAt: string;
  readonly files: readonly RelayProjectBundleFileRecord[];
  readonly externalReferences: readonly RelayProjectBundleExternalRecord[];
}

export interface ExportRelayProjectBundleOptions {
  readonly projectRoot: string;
  readonly project: RelayProjectDocument;
  readonly destinationPath: string;
  readonly externalReferencePolicy?: "exclude" | "copy";
  readonly resolveExternalReference: (referenceId: string) => Promise<string | null>;
  readonly ffprobePath?: string | null;
  readonly ffprobeRunner?: (executable: string, arguments_: readonly string[]) => Promise<unknown>;
  readonly now?: () => Date;
  readonly createId?: () => string;
}

export interface ExportRelayProjectBundleResult {
  readonly destinationPath: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly manifest: RelayProjectBundleManifest;
}

export interface InspectRelayProjectBundleResult {
  readonly manifest: RelayProjectBundleManifest;
  readonly project: RelayProjectDocument;
  readonly archiveByteLength: number;
  readonly filesVerified: number;
}

export interface ImportRelayProjectBundleOptions {
  readonly bundlePath: string;
  readonly dataRoot: string;
  readonly onProjectIdConflict?: "error" | "copy";
  readonly now?: () => Date;
  readonly createId?: () => string;
}

export interface ImportRelayProjectBundleResult {
  readonly project: RelayProjectDocument;
  readonly projectRoot: string;
  readonly importedFileCount: number;
  readonly copiedDueToConflict: boolean;
  readonly excludedExternalReferenceIds: readonly string[];
}

interface BundleSourceEntry {
  readonly path: string;
  readonly sourcePath: string | null;
  readonly bytes: Buffer | null;
}

interface PreparedSourceEntry extends BundleSourceEntry, RelayProjectBundleFileRecord {
  readonly crc32: number;
}

interface ZipCentralEntry {
  readonly path: string;
  readonly flags: number;
  readonly method: 0 | 8;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
  readonly externalAttributes: number;
}

const ARCHIVE_MANIFEST = "RELAY-MANIFEST.json";
const ARCHIVE_SUMS = "SHA256SUMS.txt";
const ARCHIVE_COMPATIBILITY = "compatibility.json";
const PROJECT_DOCUMENT = "project.relay.json";
const MAX_ENTRY_COUNT = 10_000;
const MAX_CENTRAL_DIRECTORY = 64 * 1024 * 1024;
const MAX_METADATA_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED = 128 * 1024 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 1_000;
const MAX_STANDARD_ZIP_SIZE = 0xffff_ffff;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_ENCRYPTED_FLAG = 0x0001;
const CRC_TABLE = createCrcTable();
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const PROJECT_ID = /^project-[a-z0-9][a-z0-9-]{7,127}$/u;
const FORBIDDEN_SECRET = /(?:^|[._-])(?:secret|token|credential|password|private[-_]?key)(?:[._-]|$)|\.(?:pem|pfx|p12|key|env)$/iu;
// Generated-video posters are disposable, machine-local evidence for files in
// an external ComfyUI output directory. They must follow the result index out
// of portable project bundles; ordinary project asset thumbnails remain
// portable and continue to be exported.
const ALLOWED_PAYLOAD_PREFIXES = ["assets/originals", "assets/proxies", "assets/thumbnails", "workflows", "history"] as const;

function createCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) !== 0 ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[index] = value >>> 0;
  }
  return table;
}

function updateCrc32(current: number, bytes: Buffer): number {
  let value = current;
  for (const byte of bytes) value = (CRC_TABLE[(value ^ byte) & 0xff] ?? 0) ^ (value >>> 8);
  return value >>> 0;
}

function finalCrc32(current: number): number {
  return (current ^ 0xffff_ffff) >>> 0;
}

function sameWindowsPath(left: string, right: string): boolean {
  return resolve(left).toLocaleLowerCase("en-US") === resolve(right).toLocaleLowerCase("en-US");
}

function stableProjectId(factory: () => string): string {
  const raw = factory().replaceAll("-", "").toLocaleLowerCase("en-US");
  if (!/^[0-9a-f]{32}$/u.test(raw)) throw new TypeError("Project copy identifier generation failed.");
  return `project-${raw}`;
}

function assertSafeEntryPath(value: string): string {
  if (typeof value !== "string" || !value || value.includes("\u0000") || value.includes("\\") || value.startsWith("/") || /^[a-z]:/iu.test(value)) {
    throw new TypeError("Bundle entry path must be a normalized relative UTF-8 path.");
  }
  const normalized = normalizeProjectRelativePath(value);
  if (normalized !== value || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new TypeError("Bundle entry path is not canonical.");
  }
  if (FORBIDDEN_SECRET.test(basename(normalized))) throw new TypeError("Bundle entry resembles a secret or private-key file and was excluded.");
  return normalized;
}

function isPayloadPath(path: string): boolean {
  return path === PROJECT_DOCUMENT || path === ARCHIVE_COMPATIBILITY ||
    ALLOWED_PAYLOAD_PREFIXES.some((prefix) => path.startsWith(`${prefix}/`));
}

function assertNoPrivateAbsolutePaths(value: unknown, field = "project"): void {
  if (typeof value === "string") {
    if (/^(?:[a-z]:[\\/]|\\\\)/iu.test(value.trim())) throw new TypeError(`Project bundle contains an absolute private path at ${field}.`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoPrivateAbsolutePaths(entry, `${field}[${index}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) assertNoPrivateAbsolutePaths(entry, `${field}.${key}`);
  }
}

async function requireDirectDirectory(path: string, create = false): Promise<string> {
  if (!isAbsolute(path) || path.includes("\u0000")) throw new TypeError("Directory must be an absolute local path.");
  const normalized = normalize(path);
  if (create) await mkdir(normalized, { recursive: true });
  const metadata = await lstat(normalized);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new TypeError("Directory is not a direct local directory.");
  const canonical = await realpath(normalized);
  if (!sameWindowsPath(canonical, normalized)) throw new TypeError("Directory resolves through a reparse point.");
  return canonical;
}

async function requireContainedFile(projectRoot: string, projectRelativePath: string): Promise<string> {
  const safe = assertSafeEntryPath(projectRelativePath);
  if (!isPayloadPath(safe)) throw new TypeError("Project bundle payload path is outside the allowlist.");
  const target = resolve(projectRoot, safe);
  const containment = relative(projectRoot, target);
  if (containment.startsWith("..") || isAbsolute(containment)) throw new TypeError("Project bundle source escapes the project root.");
  const metadata = await lstat(target);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new TypeError(`Project bundle source is not a direct file: ${safe}`);
  const canonical = await realpath(target);
  if (!sameWindowsPath(canonical, target)) throw new TypeError(`Project bundle source resolves through a reparse point: ${safe}`);
  return canonical;
}

async function scanDirectory(projectRoot: string, prefix: string): Promise<readonly BundleSourceEntry[]> {
  const safePrefix = normalizeProjectRelativePath(prefix);
  const directory = resolve(projectRoot, safePrefix);
  try {
    const metadata = await lstat(directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || !sameWindowsPath(await realpath(directory), directory)) {
      throw new TypeError(`Project directory is not direct: ${safePrefix}`);
    }
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return Object.freeze([]);
    throw error;
  }
  const entries: BundleSourceEntry[] = [];
  const visit = async (absoluteDirectory: string, relativeDirectory: string): Promise<void> => {
    for (const entry of await readdir(absoluteDirectory, { withFileTypes: true })) {
      const childRelative = assertSafeEntryPath(`${relativeDirectory}/${entry.name}`);
      const childAbsolute = resolve(projectRoot, childRelative);
      const containment = relative(projectRoot, childAbsolute);
      if (containment.startsWith("..") || isAbsolute(containment)) throw new TypeError("Project scan escaped its root.");
      const metadata = await lstat(childAbsolute);
      if (metadata.isSymbolicLink() || !sameWindowsPath(await realpath(childAbsolute), childAbsolute)) throw new TypeError(`Reparse entry rejected: ${childRelative}`);
      if (metadata.isDirectory()) await visit(childAbsolute, childRelative);
      else if (metadata.isFile()) entries.push(Object.freeze({ path: childRelative, sourcePath: childAbsolute, bytes: null }));
      else throw new TypeError(`Unsupported filesystem entry rejected: ${childRelative}`);
    }
  };
  await visit(directory, safePrefix);
  return Object.freeze(entries);
}

async function hashAndCrcSource(entry: BundleSourceEntry): Promise<PreparedSourceEntry> {
  let byteLength = 0;
  let crc = 0xffff_ffff;
  const hash = createHash("sha256");
  if (entry.bytes !== null) {
    byteLength = entry.bytes.length;
    crc = updateCrc32(crc, entry.bytes);
    hash.update(entry.bytes);
  } else if (entry.sourcePath !== null) {
    const before = await lstat(entry.sourcePath, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || !sameWindowsPath(await realpath(entry.sourcePath), entry.sourcePath)) throw new TypeError(`Bundle source changed or became indirect: ${entry.path}`);
    for await (const chunk of createReadStream(entry.sourcePath, { highWaterMark: 4 * 1024 * 1024 })) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      byteLength += bytes.length;
      crc = updateCrc32(crc, bytes);
      hash.update(bytes);
    }
    const after = await lstat(entry.sourcePath, { bigint: true });
    if (after.size !== before.size || after.mtimeNs !== before.mtimeNs) throw new TypeError(`Bundle source changed while hashing: ${entry.path}`);
  } else throw new TypeError("Bundle source entry has no content.");
  if (byteLength > MAX_STANDARD_ZIP_SIZE) throw new TypeError(`Bundle entry exceeds the current safe 4 GiB stored-entry limit: ${entry.path}`);
  return Object.freeze({ ...entry, byteLength, sha256: hash.digest("hex"), crc32: finalCrc32(crc) });
}

function dosDateTime(value: Date): { date: number; time: number } {
  const year = Math.max(1980, Math.min(2107, value.getUTCFullYear()));
  return {
    date: ((year - 1980) << 9) | ((value.getUTCMonth() + 1) << 5) | value.getUTCDate(),
    time: (value.getUTCHours() << 11) | (value.getUTCMinutes() << 5) | Math.floor(value.getUTCSeconds() / 2)
  };
}

async function writeStoredZip(destination: string, entries: readonly PreparedSourceEntry[], timestamp: Date): Promise<void> {
  if (entries.length > 0xffff) throw new TypeError("Bundle contains too many ZIP entries.");
  const handle = await open(destination, "wx");
  let position = 0;
  const central: Buffer[] = [];
  const writeChunk = async (bytes: Buffer): Promise<void> => {
    let offset = 0;
    while (offset < bytes.length) {
      const result = await handle.write(bytes, offset, bytes.length - offset, position + offset);
      if (result.bytesWritten <= 0) throw new Error("zip-write-stalled");
      offset += result.bytesWritten;
    }
    position += bytes.length;
  };
  try {
    const stamp = dosDateTime(timestamp);
    for (const entry of entries) {
      const name = Buffer.from(entry.path, "utf8");
      const localOffset = position;
      if (localOffset > MAX_STANDARD_ZIP_SIZE) throw new TypeError("Bundle exceeds the current safe 4 GiB archive limit.");
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(ZIP_UTF8_FLAG, 6);
      local.writeUInt16LE(0, 8);
      local.writeUInt16LE(stamp.time, 10);
      local.writeUInt16LE(stamp.date, 12);
      local.writeUInt32LE(entry.crc32, 14);
      local.writeUInt32LE(entry.byteLength, 18);
      local.writeUInt32LE(entry.byteLength, 22);
      local.writeUInt16LE(name.length, 26);
      local.writeUInt16LE(0, 28);
      await writeChunk(local);
      await writeChunk(name);
      let verifiedLength = 0;
      let verifiedCrc = 0xffff_ffff;
      const verifiedHash = createHash("sha256");
      const consume = async (bytes: Buffer): Promise<void> => {
        verifiedLength += bytes.length;
        verifiedCrc = updateCrc32(verifiedCrc, bytes);
        verifiedHash.update(bytes);
        await writeChunk(bytes);
      };
      if (entry.bytes !== null) await consume(entry.bytes);
      else if (entry.sourcePath !== null) {
        const before = await lstat(entry.sourcePath, { bigint: true });
        for await (const chunk of createReadStream(entry.sourcePath, { highWaterMark: 4 * 1024 * 1024 })) await consume(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        const after = await lstat(entry.sourcePath, { bigint: true });
        if (before.size !== after.size || before.mtimeNs !== after.mtimeNs) throw new TypeError(`Bundle source changed while archiving: ${entry.path}`);
      }
      if (verifiedLength !== entry.byteLength || finalCrc32(verifiedCrc) !== entry.crc32 || verifiedHash.digest("hex") !== entry.sha256) {
        throw new TypeError(`Bundle source verification failed while archiving: ${entry.path}`);
      }
      const header = Buffer.alloc(46);
      header.writeUInt32LE(0x02014b50, 0);
      header.writeUInt16LE(20, 4);
      header.writeUInt16LE(20, 6);
      header.writeUInt16LE(ZIP_UTF8_FLAG, 8);
      header.writeUInt16LE(0, 10);
      header.writeUInt16LE(stamp.time, 12);
      header.writeUInt16LE(stamp.date, 14);
      header.writeUInt32LE(entry.crc32, 16);
      header.writeUInt32LE(entry.byteLength, 20);
      header.writeUInt32LE(entry.byteLength, 24);
      header.writeUInt16LE(name.length, 28);
      header.writeUInt16LE(0, 30);
      header.writeUInt16LE(0, 32);
      header.writeUInt16LE(0, 34);
      header.writeUInt16LE(0, 36);
      header.writeUInt32LE(0, 38);
      header.writeUInt32LE(localOffset, 42);
      central.push(Buffer.concat([header, name]));
    }
    const centralOffset = position;
    for (const entry of central) await writeChunk(entry);
    const centralSize = position - centralOffset;
    if (centralOffset > MAX_STANDARD_ZIP_SIZE || centralSize > MAX_STANDARD_ZIP_SIZE || position + 22 > MAX_STANDARD_ZIP_SIZE) {
      throw new TypeError("Bundle exceeds the current safe standard ZIP size limit.");
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(centralOffset, 16);
    end.writeUInt16LE(0, 20);
    await writeChunk(end);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function archiveDigest(path: string): Promise<{ byteLength: number; sha256: string }> {
  let byteLength = 0;
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path, { highWaterMark: 4 * 1024 * 1024 })) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += bytes.length;
    hash.update(bytes);
  }
  return Object.freeze({ byteLength, sha256: hash.digest("hex") });
}

function compatibilityDocument(project: RelayProjectDocument): JsonValue {
  return {
    format: "relay-project-compatibility",
    version: 1,
    workflowMode: project.quick.mode,
    requiredCapabilities: project.quick.mode === "REF2VA" ? ["minimax_h3", "ref2va"] : ["minimax_h3"],
    modelFilesIncluded: false,
    runtimeIncluded: false,
    automaticQueueSubmission: false
  };
}

function sourceEntry(path: string, sourcePath: string): BundleSourceEntry {
  return Object.freeze({ path: assertSafeEntryPath(path), sourcePath, bytes: null });
}

function bytesEntry(path: string, bytes: Buffer): BundleSourceEntry {
  return Object.freeze({ path: assertSafeEntryPath(path), sourcePath: null, bytes });
}

async function buildExportSnapshot(options: ExportRelayProjectBundleOptions): Promise<{
  project: RelayProjectDocument;
  sources: readonly BundleSourceEntry[];
  externalReferences: readonly RelayProjectBundleExternalRecord[];
}> {
  const projectRoot = await requireDirectDirectory(options.projectRoot);
  let project = normalizeRelayProject(options.project);
  const policy = options.externalReferencePolicy ?? "exclude";
  const sources: BundleSourceEntry[] = [];
  const externalRecords: RelayProjectBundleExternalRecord[] = [];
  const copiedReferenceIds = new Set<string>();
  const updatedAssets: RelayProjectAsset[] = [];
  for (const asset of project.assets) {
    if (asset.storageMode === "project_copy") {
      if (asset.projectRelativePath === null) throw new TypeError("Project copy asset is missing its relative path.");
      const relativePath = normalizeProjectRelativePath(asset.projectRelativePath, "assets/originals");
      sources.push(sourceEntry(relativePath, await requireContainedFile(projectRoot, relativePath)));
      updatedAssets.push(asset);
      continue;
    }
    if (asset.externalReferenceId === null) throw new TypeError("External asset is missing its stable resolver ID.");
    const reference = project.externalReferences.find((entry) => entry.referenceId === asset.externalReferenceId);
    if (reference === undefined) throw new TypeError("External asset resolver record is missing.");
    if (policy === "exclude") {
      externalRecords.push(Object.freeze({
        referenceId: reference.referenceId, displayName: reference.displayName,
        expectedSha256: reference.expectedSha256, action: "excluded", bundleRelativePath: null
      }));
      updatedAssets.push(asset);
      continue;
    }
    const resolved = await options.resolveExternalReference(reference.referenceId);
    if (resolved === null) throw new TypeError(`External asset cannot be resolved for copy: ${reference.displayName}`);
    const preflight = await preflightLocalAsset(resolved, {
      ...(options.ffprobePath === undefined ? {} : { ffprobePath: options.ffprobePath }),
      ...(options.ffprobeRunner === undefined ? {} : { ffprobeRunner: options.ffprobeRunner }),
      expectedByteLength: asset.byteLength,
      expectedSha256: asset.sha256
    });
    if (preflight.status !== "usable" || preflight.canonicalPath === null || preflight.sha256 !== asset.sha256 || preflight.byteLength !== asset.byteLength) {
      throw new TypeError(`External asset failed verified copy preflight: ${reference.displayName}`);
    }
    const extension = extname(preflight.fileName).toLocaleLowerCase("en-US");
    const relativePath = normalizeProjectRelativePath(`assets/originals/external-${asset.assetId}-${asset.sha256.slice(0, 12)}${extension}`, "assets/originals");
    sources.push(sourceEntry(relativePath, preflight.canonicalPath));
    updatedAssets.push(Object.freeze({
      ...asset,
      storageMode: "project_copy",
      projectRelativePath: relativePath,
      externalReferenceId: null,
      availability: "available"
    }));
    copiedReferenceIds.add(reference.referenceId);
    externalRecords.push(Object.freeze({
      referenceId: reference.referenceId, displayName: reference.displayName,
      expectedSha256: reference.expectedSha256, action: "copied", bundleRelativePath: relativePath
    }));
  }
  project = normalizeRelayProject({
    ...project,
    assets: updatedAssets,
    externalReferences: project.externalReferences.filter((reference) => !copiedReferenceIds.has(reference.referenceId))
  });

  const referencedPaths = new Set<string>();
  for (const workflow of project.workflows) referencedPaths.add(normalizeProjectRelativePath(workflow.projectRelativePath, "workflows"));
  for (const history of project.history) referencedPaths.add(normalizeProjectRelativePath(history.projectRelativePath, "history"));
  for (const path of referencedPaths) sources.push(sourceEntry(path, await requireContainedFile(projectRoot, path)));
  sources.push(...await scanDirectory(projectRoot, "assets/proxies"));
  sources.push(...(await scanDirectory(projectRoot, "assets/thumbnails"))
    .filter((entry) => !isGeneratedVideoPosterCacheArtifactName(basename(entry.path))));
  sources.push(bytesEntry(ARCHIVE_COMPATIBILITY, Buffer.from(`${JSON.stringify(compatibilityDocument(project), null, 2)}\n`, "utf8")));
  assertNoPrivateAbsolutePaths(project);
  const keys = new Set<string>();
  for (const entry of sources) {
    const key = entry.path.toLocaleLowerCase("en-US");
    if (keys.has(key)) throw new TypeError(`Duplicate project bundle entry: ${entry.path}`);
    keys.add(key);
  }
  return Object.freeze({ project, sources: Object.freeze(sources), externalReferences: Object.freeze(externalRecords) });
}

export async function exportRelayProjectBundle(options: ExportRelayProjectBundleOptions): Promise<ExportRelayProjectBundleResult> {
  if (!isAbsolute(options.destinationPath) || extname(options.destinationPath).toLocaleLowerCase("en-US") !== ".relayproj") {
    throw new TypeError("Relay project bundle destination must be an absolute .relayproj path.");
  }
  try {
    await lstat(options.destinationPath);
    throw new TypeError("Relay project bundle destination already exists; Relay will not overwrite it.");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await requireDirectDirectory(dirname(options.destinationPath), true);
  const snapshot = await buildExportSnapshot(options);
  const projectBytes = Buffer.from(`${canonicalRelayProjectJson(snapshot.project)}\n`, "utf8");
  const contentSources = [bytesEntry(PROJECT_DOCUMENT, projectBytes), ...snapshot.sources];
  const preparedContent = await Promise.all(contentSources.map(hashAndCrcSource));
  const manifest: RelayProjectBundleManifest = Object.freeze({
    format: "relay-project-bundle",
    bundleVersion: RELAY_PROJECT_BUNDLE_VERSION,
    projectSchemaVersion: RELAY_PROJECT_SCHEMA_VERSION,
    projectId: snapshot.project.projectId,
    createdAt: (options.now ?? (() => new Date()))().toISOString(),
    files: Object.freeze(preparedContent.map(({ path, byteLength, sha256 }) => Object.freeze({ path, byteLength, sha256 }))),
    externalReferences: snapshot.externalReferences
  });
  const sums = `${manifest.files.map((entry) => `${entry.sha256} *${entry.path}`).join("\n")}\n`;
  const finalSources = [
    ...preparedContent,
    await hashAndCrcSource(bytesEntry(ARCHIVE_MANIFEST, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"))),
    await hashAndCrcSource(bytesEntry(ARCHIVE_SUMS, Buffer.from(sums, "utf8")))
  ].sort((left, right) => left.path.localeCompare(right.path, "en"));
  const partial = `${options.destinationPath}.partial-${(options.createId ?? randomUUID)().replaceAll("-", "")}`;
  try {
    await writeStoredZip(partial, finalSources, new Date(manifest.createdAt));
    await rename(partial, options.destinationPath);
  } catch (error: unknown) {
    await rm(partial, { force: true }).catch(() => undefined);
    throw error;
  }
  const digest = await archiveDigest(options.destinationPath);
  return Object.freeze({ destinationPath: options.destinationPath, ...digest, manifest });
}

async function readExactly(handle: Awaited<ReturnType<typeof open>>, position: number, length: number): Promise<Buffer> {
  const result = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const read = await handle.read(result, offset, length - offset, position + offset);
    if (read.bytesRead <= 0) throw new TypeError("Unexpected end of ZIP archive.");
    offset += read.bytesRead;
  }
  return result;
}

async function parseZipCentral(path: string): Promise<{ entries: readonly ZipCentralEntry[]; byteLength: number }> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || !sameWindowsPath(await realpath(path), path)) throw new TypeError("Project bundle must be a direct local file.");
  const handle = await open(path, "r");
  try {
    const tailLength = Math.min(metadata.size, 65_557);
    const tail = await readExactly(handle, metadata.size - tailLength, tailLength);
    let endOffset = -1;
    for (let index = tail.length - 22; index >= 0; index -= 1) {
      if (tail.readUInt32LE(index) === 0x06054b50) { endOffset = index; break; }
    }
    if (endOffset < 0) throw new TypeError("Project bundle ZIP end record is missing.");
    const disk = tail.readUInt16LE(endOffset + 4);
    const centralDisk = tail.readUInt16LE(endOffset + 6);
    const diskEntries = tail.readUInt16LE(endOffset + 8);
    const totalEntries = tail.readUInt16LE(endOffset + 10);
    const centralSize = tail.readUInt32LE(endOffset + 12);
    const centralOffset = tail.readUInt32LE(endOffset + 16);
    const commentLength = tail.readUInt16LE(endOffset + 20);
    if (disk !== 0 || centralDisk !== 0 || diskEntries !== totalEntries || totalEntries > MAX_ENTRY_COUNT || totalEntries === 0) throw new TypeError("Multi-disk, empty, or oversized project bundles are not supported.");
    if (commentLength !== tail.length - endOffset - 22) throw new TypeError("Project bundle ZIP comment length is invalid.");
    if (centralSize > MAX_CENTRAL_DIRECTORY || centralOffset + centralSize > metadata.size) throw new TypeError("Project bundle central directory is invalid or too large.");
    const central = await readExactly(handle, centralOffset, centralSize);
    const entries: ZipCentralEntry[] = [];
    const keys = new Set<string>();
    let offset = 0;
    let total = 0;
    while (offset < central.length) {
      if (offset + 46 > central.length || central.readUInt32LE(offset) !== 0x02014b50) throw new TypeError("Project bundle central entry is malformed.");
      const flags = central.readUInt16LE(offset + 8);
      const method = central.readUInt16LE(offset + 10);
      const crc32 = central.readUInt32LE(offset + 16);
      const compressedSize = central.readUInt32LE(offset + 20);
      const uncompressedSize = central.readUInt32LE(offset + 24);
      const nameLength = central.readUInt16LE(offset + 28);
      const extraLength = central.readUInt16LE(offset + 30);
      const comment = central.readUInt16LE(offset + 32);
      const diskStart = central.readUInt16LE(offset + 34);
      const externalAttributes = central.readUInt32LE(offset + 38);
      const localHeaderOffset = central.readUInt32LE(offset + 42);
      const end = offset + 46 + nameLength + extraLength + comment;
      if (end > central.length || diskStart !== 0 || (flags & ZIP_ENCRYPTED_FLAG) !== 0 || (method !== 0 && method !== 8)) throw new TypeError("Encrypted, split, or unsupported ZIP entry rejected.");
      if (compressedSize === 0xffff_ffff || uncompressedSize === 0xffff_ffff || localHeaderOffset === 0xffff_ffff) throw new TypeError("ZIP64 project bundles are not supported by this release.");
      const unixMode = (externalAttributes >>> 16) & 0xf000;
      const windowsAttributes = externalAttributes & 0xffff;
      if (unixMode === 0xa000 || (windowsAttributes & 0x0400) !== 0) throw new TypeError("Symbolic-link or reparse ZIP entry rejected.");
      const name = central.subarray(offset + 46, offset + 46 + nameLength).toString((flags & ZIP_UTF8_FLAG) !== 0 ? "utf8" : "latin1");
      const safe = assertSafeEntryPath(name);
      const key = safe.toLocaleLowerCase("en-US");
      if (keys.has(key)) throw new TypeError("Duplicate project bundle entry rejected.");
      keys.add(key);
      if (uncompressedSize > 0 && compressedSize === 0) throw new TypeError("Abnormal zero-byte compressed entry rejected.");
      if (compressedSize > 0 && uncompressedSize / compressedSize > MAX_COMPRESSION_RATIO) throw new TypeError("Abnormal project bundle compression ratio rejected.");
      total += uncompressedSize;
      if (total > MAX_TOTAL_UNCOMPRESSED) throw new TypeError("Project bundle expands beyond the safe total size limit.");
      entries.push(Object.freeze({ path: safe, flags, method: method as 0 | 8, crc32, compressedSize, uncompressedSize, localHeaderOffset, externalAttributes }));
      offset = end;
    }
    if (entries.length !== totalEntries || offset !== central.length) throw new TypeError("Project bundle entry count does not match its directory.");
    return Object.freeze({ entries: Object.freeze(entries), byteLength: metadata.size });
  } finally {
    await handle.close();
  }
}

async function zipEntryDataOffset(bundlePath: string, entry: ZipCentralEntry): Promise<number> {
  const handle = await open(bundlePath, "r");
  try {
    const header = await readExactly(handle, entry.localHeaderOffset, 30);
    if (header.readUInt32LE(0) !== 0x04034b50 || header.readUInt16LE(8) !== entry.method) throw new TypeError("Project bundle local ZIP header is invalid.");
    const nameLength = header.readUInt16LE(26);
    const extraLength = header.readUInt16LE(28);
    const name = (await readExactly(handle, entry.localHeaderOffset + 30, nameLength)).toString((entry.flags & ZIP_UTF8_FLAG) !== 0 ? "utf8" : "latin1");
    if (assertSafeEntryPath(name) !== entry.path) throw new TypeError("Project bundle local and central entry names differ.");
    return entry.localHeaderOffset + 30 + nameLength + extraLength;
  } finally {
    await handle.close();
  }
}

async function readZipEntryBuffer(bundlePath: string, entry: ZipCentralEntry): Promise<Buffer> {
  if (entry.uncompressedSize > MAX_METADATA_BYTES || entry.compressedSize > MAX_METADATA_BYTES) throw new TypeError("Project bundle metadata entry is too large.");
  const offset = await zipEntryDataOffset(bundlePath, entry);
  const handle = await open(bundlePath, "r");
  try {
    const compressed = await readExactly(handle, offset, entry.compressedSize);
    const bytes = entry.method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: MAX_METADATA_BYTES });
    if (bytes.length !== entry.uncompressedSize || finalCrc32(updateCrc32(0xffff_ffff, bytes)) !== entry.crc32) throw new TypeError("Project bundle metadata CRC or length mismatch.");
    return bytes;
  } finally {
    await handle.close();
  }
}

function parseManifest(value: unknown): RelayProjectBundleManifest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Project bundle manifest is not an object.");
  const record = value as Record<string, unknown>;
  if (record.format !== "relay-project-bundle" || record.bundleVersion !== RELAY_PROJECT_BUNDLE_VERSION || record.projectSchemaVersion !== RELAY_PROJECT_SCHEMA_VERSION || !PROJECT_ID.test(String(record.projectId)) || typeof record.createdAt !== "string" || !Number.isFinite(Date.parse(record.createdAt))) {
    throw new TypeError("Project bundle manifest identity or version is invalid.");
  }
  if (!Array.isArray(record.files) || record.files.length === 0 || record.files.length > MAX_ENTRY_COUNT || !Array.isArray(record.externalReferences)) throw new TypeError("Project bundle manifest file list is invalid.");
  const files = record.files.map((value): RelayProjectBundleFileRecord => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Project bundle file record is invalid.");
    const item = value as Record<string, unknown>;
    const path = assertSafeEntryPath(String(item.path));
    if (!isPayloadPath(path) || typeof item.byteLength !== "number" || !Number.isSafeInteger(item.byteLength) || item.byteLength < 0 || typeof item.sha256 !== "string" || !HASH_PATTERN.test(item.sha256)) throw new TypeError("Project bundle file record is invalid.");
    return Object.freeze({ path, byteLength: item.byteLength, sha256: item.sha256 });
  });
  const externalReferences = record.externalReferences.map((value): RelayProjectBundleExternalRecord => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Project bundle external-reference record is invalid.");
    const item = value as Record<string, unknown>;
    if (typeof item.referenceId !== "string" || typeof item.displayName !== "string" || (item.expectedSha256 !== null && (typeof item.expectedSha256 !== "string" || !HASH_PATTERN.test(item.expectedSha256))) || (item.action !== "excluded" && item.action !== "copied")) throw new TypeError("Project bundle external-reference record is invalid.");
    const bundleRelativePath = item.bundleRelativePath === null ? null : normalizeProjectRelativePath(item.bundleRelativePath, "assets/originals");
    if ((item.action === "copied") !== (bundleRelativePath !== null)) throw new TypeError("Project bundle external-reference action is inconsistent.");
    return Object.freeze({ referenceId: item.referenceId, displayName: item.displayName, expectedSha256: item.expectedSha256, action: item.action, bundleRelativePath });
  });
  return Object.freeze({
    format: "relay-project-bundle", bundleVersion: RELAY_PROJECT_BUNDLE_VERSION,
    projectSchemaVersion: RELAY_PROJECT_SCHEMA_VERSION, projectId: String(record.projectId), createdAt: record.createdAt,
    files: Object.freeze(files), externalReferences: Object.freeze(externalReferences)
  });
}

function parseSums(bytes: Buffer): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (const line of bytes.toString("utf8").split(/\r?\n/u)) {
    if (!line) continue;
    const match = line.match(/^([0-9a-f]{64}) \*(.+)$/u);
    if (match === null) throw new TypeError("Project bundle SHA256SUMS format is invalid.");
    const path = assertSafeEntryPath(match[2] ?? "");
    if (result.has(path)) throw new TypeError("Project bundle SHA256SUMS contains duplicates.");
    result.set(path, match[1] ?? "");
  }
  return result;
}

async function readAndValidateBundleMetadata(bundlePath: string): Promise<{
  zip: { readonly entries: readonly ZipCentralEntry[]; readonly byteLength: number };
  manifest: RelayProjectBundleManifest;
  project: RelayProjectDocument;
}> {
  const zip = await parseZipCentral(bundlePath);
  const byPath = new Map(zip.entries.map((entry) => [entry.path, entry]));
  const manifestEntry = byPath.get(ARCHIVE_MANIFEST);
  const sumsEntry = byPath.get(ARCHIVE_SUMS);
  const projectEntry = byPath.get(PROJECT_DOCUMENT);
  if (manifestEntry === undefined || sumsEntry === undefined || projectEntry === undefined) throw new TypeError("Project bundle is missing its manifest, hash list, or project document.");
  const manifest = parseManifest(JSON.parse((await readZipEntryBuffer(bundlePath, manifestEntry)).toString("utf8")));
  const sums = parseSums(await readZipEntryBuffer(bundlePath, sumsEntry));
  const manifestPaths = new Set(manifest.files.map((file) => file.path));
  if (manifestPaths.size !== manifest.files.length || sums.size !== manifest.files.length) throw new TypeError("Project bundle manifest or hash list contains duplicate/missing entries.");
  const allowedArchivePaths = new Set([ARCHIVE_MANIFEST, ARCHIVE_SUMS, ...manifestPaths]);
  if (zip.entries.some((entry) => !allowedArchivePaths.has(entry.path)) || allowedArchivePaths.size !== zip.entries.length) throw new TypeError("Project bundle contains unmanifested files.");
  for (const file of manifest.files) {
    const entry = byPath.get(file.path);
    if (entry === undefined || entry.uncompressedSize !== file.byteLength || sums.get(file.path) !== file.sha256) throw new TypeError(`Project bundle manifest mismatch: ${file.path}`);
  }
  const project = normalizeRelayProject(JSON.parse((await readZipEntryBuffer(bundlePath, projectEntry)).toString("utf8")));
  if (project.projectId !== manifest.projectId) throw new TypeError("Project bundle project ID does not match its manifest.");
  assertNoPrivateAbsolutePaths(project);
  return Object.freeze({ zip, manifest, project });
}

export async function inspectRelayProjectBundle(bundlePath: string): Promise<InspectRelayProjectBundleResult> {
  const metadata = await readAndValidateBundleMetadata(bundlePath);
  const byPath = new Map(metadata.zip.entries.map((entry) => [entry.path, entry]));
  for (const file of metadata.manifest.files) {
    const entry = byPath.get(file.path) as ZipCentralEntry;
    await verifyZipEntry(bundlePath, entry, file);
  }
  return Object.freeze({ manifest: metadata.manifest, project: metadata.project, archiveByteLength: metadata.zip.byteLength, filesVerified: metadata.manifest.files.length });
}

async function verifyZipEntry(bundlePath: string, entry: ZipCentralEntry, expected: RelayProjectBundleFileRecord): Promise<void> {
  const offset = await zipEntryDataOffset(bundlePath, entry);
  const hash = createHash("sha256");
  let crc = 0xffff_ffff;
  let length = 0;
  const verifier = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += bytes.length;
      crc = updateCrc32(crc, bytes);
      hash.update(bytes);
      callback();
    }
  });
  if (entry.compressedSize > 0) {
    const input = createReadStream(bundlePath, { start: offset, end: offset + entry.compressedSize - 1 });
    if (entry.method === 0) await pipeline(input, verifier);
    else await pipeline(input, createInflateRaw(), verifier);
  } else if (entry.method !== 0 || entry.uncompressedSize !== 0) {
    throw new TypeError(`Project bundle contains an invalid empty entry: ${entry.path}`);
  }
  if (length !== expected.byteLength || length !== entry.uncompressedSize || finalCrc32(crc) !== entry.crc32 || hash.digest("hex") !== expected.sha256) {
    throw new TypeError(`Project bundle content hash mismatch: ${entry.path}`);
  }
}

async function extractVerifiedEntry(bundlePath: string, entry: ZipCentralEntry, expected: RelayProjectBundleFileRecord, target: string): Promise<void> {
  const offset = await zipEntryDataOffset(bundlePath, entry);
  await mkdir(dirname(target), { recursive: true });
  const hash = createHash("sha256");
  let crc = 0xffff_ffff;
  let length = 0;
  const verifier = new Transform({
    transform(chunk: Buffer | string, _encoding, callback) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += bytes.length;
      crc = updateCrc32(crc, bytes);
      hash.update(bytes);
      callback(null, bytes);
    }
  });
  try {
    if (entry.compressedSize === 0) {
      if (entry.method !== 0 || entry.uncompressedSize !== 0) throw new TypeError(`Project bundle contains an invalid empty entry: ${entry.path}`);
      await writeFile(target, Buffer.alloc(0), { flag: "wx", mode: 0o600 });
    } else {
      const input = createReadStream(bundlePath, { start: offset, end: offset + entry.compressedSize - 1 });
      const output = createWriteStream(target, { flags: "wx", mode: 0o600 });
      if (entry.method === 0) await pipeline(input, verifier, output);
      else await pipeline(input, createInflateRaw(), verifier, output);
    }
    if (length !== expected.byteLength || length !== entry.uncompressedSize || finalCrc32(crc) !== entry.crc32 || hash.digest("hex") !== expected.sha256) {
      throw new TypeError(`Project bundle extraction verification failed: ${entry.path}`);
    }
  } catch (error: unknown) {
    await rm(target, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function importRelayProjectBundle(options: ImportRelayProjectBundleOptions): Promise<ImportRelayProjectBundleResult> {
  if (!isAbsolute(options.bundlePath) || extname(options.bundlePath).toLocaleLowerCase("en-US") !== ".relayproj") throw new TypeError("Project import source must be an absolute .relayproj file.");
  const metadata = await readAndValidateBundleMetadata(normalize(options.bundlePath));
  const dataRoot = await requireDirectDirectory(options.dataRoot, true);
  const projectsRoot = await requireDirectDirectory(join(dataRoot, "projects"), true);
  const conflictPolicy = options.onProjectIdConflict ?? "error";
  let project = metadata.project;
  let target = join(projectsRoot, project.projectId);
  let copiedDueToConflict = false;
  try {
    await lstat(target);
    if (conflictPolicy !== "copy") throw new TypeError("A project with this ID already exists; choose import as copy to preserve both projects.");
    copiedDueToConflict = true;
    let candidate: string;
    do candidate = stableProjectId(options.createId ?? randomUUID); while (await stat(join(projectsRoot, candidate)).then(() => true, () => false));
    const originalProjectId = project.projectId;
    const timestamp = (options.now ?? (() => new Date()))().toISOString();
    project = normalizeRelayProject({
      ...project,
      projectId: candidate,
      name: `${project.name.slice(0, 140)}（导入副本）`,
      updatedAt: timestamp,
      bindings: project.bindings.map((binding) => binding.targetKind === "project" && binding.targetId === originalProjectId ? { ...binding, targetId: candidate } : binding),
      assets: project.assets.map((asset) => asset.storageMode === "external_reference" ? { ...asset, availability: "missing" } : asset)
    });
    target = join(projectsRoot, candidate);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const containment = relative(projectsRoot, target);
  if (containment.startsWith("..") || isAbsolute(containment)) throw new TypeError("Imported project target escapes the data root.");
  const staging = await mkdtemp(join(projectsRoot, ".relay-import-"));
  try {
    const byPath = new Map(metadata.zip.entries.map((entry) => [entry.path, entry]));
    for (const file of metadata.manifest.files) {
      if (file.path === ARCHIVE_COMPATIBILITY || file.path === PROJECT_DOCUMENT) continue;
      const entry = byPath.get(file.path);
      if (entry === undefined) throw new TypeError(`Project bundle entry missing during extraction: ${file.path}`);
      const destination = resolve(staging, file.path);
      const escaped = relative(staging, destination);
      if (escaped.startsWith("..") || isAbsolute(escaped)) throw new TypeError("Project bundle extraction target escaped staging.");
      await extractVerifiedEntry(options.bundlePath, entry, file, destination);
    }
    const externalExcluded = new Set(metadata.manifest.externalReferences.filter((entry) => entry.action === "excluded").map((entry) => entry.referenceId));
    if (!copiedDueToConflict && externalExcluded.size > 0) {
      project = normalizeRelayProject({
        ...project,
        assets: project.assets.map((asset) => asset.externalReferenceId !== null && externalExcluded.has(asset.externalReferenceId) ? { ...asset, availability: "missing" } : asset)
      });
    }
    await writeFile(join(staging, PROJECT_DOCUMENT), `${canonicalRelayProjectJson(project)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    for (const directory of ["assets/originals", "assets/proxies", "assets/thumbnails", "workflows", "recovery", "history", "exports"]) {
      await mkdir(join(staging, directory), { recursive: true });
    }
    await rename(staging, target);
    return Object.freeze({
      project,
      projectRoot: target,
      importedFileCount: metadata.manifest.files.filter((file) => file.path !== ARCHIVE_COMPATIBILITY && file.path !== PROJECT_DOCUMENT).length + 1,
      copiedDueToConflict,
      excludedExternalReferenceIds: Object.freeze([...externalExcluded])
    });
  } catch (error: unknown) {
    await rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}
