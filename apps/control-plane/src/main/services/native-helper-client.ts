import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { release as operatingSystemRelease } from "node:os";
import { dirname, join } from "node:path";

import { createStartupDiagnostic, type StartupDiagnostic } from "./startup-diagnostics.js";
import {
  NativeDataRootInspectionError,
  NativeHelperStartupError,
  type NativeHelperStartupCode,
  type NativeHelperStartupStage
} from "./startup-native-errors.js";

export {
  NativeDataRootInspectionError,
  NativeHelperStartupError,
  nativeDataRootInspectionMessage,
  nativeHelperStartupActions,
  nativeHelperStartupMessage,
  type NativeDataRootInspectionCode,
  type NativeHelperStartupCode,
  type NativeHelperStartupStage,
  type StartupRecoveryAction
} from "./startup-native-errors.js";
export {
  createStartupDiagnostic,
  formatStartupDiagnostic,
  type StartupDataRootVolumeDiagnostic,
  type StartupDiagnostic,
  type StartupDiagnosticCode
} from "./startup-diagnostics.js";

const PROFILE_ID = "relay.win32.path-inspection";
const PROFILE_VERSION = "1.0.0";
const PROFILE_ARGUMENT = "--capability-profile=path-inspection-v1";
const HELPER_FILE_NAME = "relay-winbroker.exe";
const PROFILE_FILE_NAME = "capability-profile.v1.json";
const IDENTITY_MANIFEST_FILE_NAME = "startup-native-build-manifest.json";
const ENABLED_OPCODES = Object.freeze([257, 258]) as readonly [257, 258];

interface NativeFrame {
  readonly kind: number;
  readonly opcode: number;
  readonly sequence: number;
  readonly payload: Record<string, unknown>;
}

interface NativeArtifactMetadata {
  readonly size: number;
  readonly dev?: number;
  readonly ino?: number;
  readonly mtimeMs?: number;
  readonly ctimeMs?: number;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

interface NativeArtifactIdentity {
  readonly path: string;
  readonly size: number;
  readonly dev: number;
  readonly ino: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
}

export interface NativeHelperSpawnResult {
  readonly status: number | null;
  readonly signal?: string | null;
  readonly stdout?: Buffer | string | null;
  readonly stderr?: Buffer | string | null;
  readonly error?: unknown;
}

export interface NativeHelperSpawnConfiguration {
  readonly cwd: string;
  readonly input: Buffer;
  readonly encoding: null;
  readonly maxBuffer: number;
  readonly stdio: ["pipe", "pipe", "pipe"];
  readonly shell: false;
  readonly windowsHide: true;
  readonly timeout: number;
}

export interface NativeHelperClientDependencies {
  readonly platform: NodeJS.Platform | string;
  readonly architecture: string;
  readonly osRelease: string;
  readonly lstat: (path: string) => NativeArtifactMetadata;
  readonly readFile: (path: string) => Buffer;
  readonly hashBytes: (bytes: Buffer) => string;
  readonly spawn: (
    executablePath: string,
    arguments_: readonly string[],
    configuration: NativeHelperSpawnConfiguration
  ) => NativeHelperSpawnResult;
}

export interface NativeHelperStartupEvidence {
  readonly profileId: string;
  readonly profileVersion: string;
  readonly enabledOpcodes: readonly [257, 258];
  readonly helperPathVerified: true;
  readonly diagnostic: StartupDiagnostic;
}

export interface NativeDataRootInspectionEvidence {
  readonly supported: true;
  readonly fixedLocal: true;
  readonly filesystem: "ntfs";
  readonly driveType: number;
  readonly diagnostic: StartupDiagnostic;
}

interface NativeHelperClientOptions {
  readonly resourcesPath: string;
  readonly isPackaged: boolean;
  readonly appVersion?: string;
  /** Transitional compatibility only; userData is never framed or inspected. */
  readonly userDataPath?: string;
  readonly dependencies?: Partial<NativeHelperClientDependencies>;
}

interface PreparedNativeHelper {
  readonly helperPath: string;
  readonly dependencies: NativeHelperClientDependencies;
  readonly appVersion: string;
  readonly artifactIdentities: readonly NativeArtifactIdentity[] | null;
}

interface CachedVerifiedPreparation {
  readonly prepared: PreparedNativeHelper;
  readonly startupEvidence: NativeHelperStartupEvidence;
  readonly dependencyOverrides: Partial<NativeHelperClientDependencies> | undefined;
  readonly key: string;
}

let cachedVerifiedPreparation: CachedVerifiedPreparation | null = null;

interface StartupState {
  helperExists: boolean;
  profileMatches: boolean;
  integrityVerified: boolean;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value !== "object") throw new TypeError("non-json value");
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(",")}}`;
}

function frame(kind: number, opcode: number, sequence: number, payload: Record<string, unknown>): Buffer {
  const bytes = Buffer.from(canonicalize(payload), "utf8");
  const header = Buffer.alloc(32);
  header.write("MH3W", 0, 4, "ascii");
  header.writeUInt16LE(32, 4);
  header.writeUInt16LE(1, 6);
  header.writeUInt32LE(bytes.length, 8);
  header.writeUInt16LE(kind, 12);
  header.writeUInt16LE(opcode, 14);
  header.writeUInt32LE(0, 16);
  header.writeBigUInt64LE(BigInt(sequence), 20);
  header.writeUInt32LE(0, 28);
  return Buffer.concat([header, bytes]);
}

function parseFrames(bytes: Buffer): NativeFrame[] {
  const frames: NativeFrame[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    if (frames.length >= 8 || bytes.length - offset < 32 || bytes.toString("ascii", offset, offset + 4) !== "MH3W") {
      throw new TypeError("invalid response frame");
    }
    const headerSize = bytes.readUInt16LE(offset + 4);
    const version = bytes.readUInt16LE(offset + 6);
    const length = bytes.readUInt32LE(offset + 8);
    const flags = bytes.readUInt32LE(offset + 16);
    const reserved = bytes.readUInt32LE(offset + 28);
    if (
      headerSize !== 32 || version !== 1 || flags !== 0 || reserved !== 0 ||
      length === 0 || length > 262_144 || bytes.length - offset - 32 < length
    ) throw new TypeError("invalid response header");
    const text = bytes.toString("utf8", offset + 32, offset + 32 + length);
    const parsed = JSON.parse(text) as unknown;
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object" || text !== canonicalize(parsed)) {
      throw new TypeError("non-canonical response");
    }
    frames.push(Object.freeze({
      kind: bytes.readUInt16LE(offset + 12),
      opcode: bytes.readUInt16LE(offset + 14),
      sequence: Number(bytes.readBigUInt64LE(offset + 20)),
      payload: parsed as Record<string, unknown>
    }));
    offset += 32 + length;
  }
  return frames;
}

function helperDirectory(resourcesPath: string, isPackaged: boolean): string {
  return isPackaged
    ? join(resourcesPath, "app.asar.unpacked", "dist", "main", "native")
    : join(import.meta.dirname, "..", "native");
}

function identityManifestPath(): string {
  // Kept inside app.asar while the checked executable/profile are unpacked.
  return join(import.meta.dirname, IDENTITY_MANIFEST_FILE_NAME);
}

function spawnNativeHelperDefault(
  helperPath: string,
  _arguments_: readonly string[],
  configuration: NativeHelperSpawnConfiguration
): NativeHelperSpawnResult {
  // The production path is deliberately pinned even though the injectable
  // seam exposes the argument array to executable fixtures.
  return spawnSync(helperPath, [PROFILE_ARGUMENT], configuration);
}

function defaultDependencies(): NativeHelperClientDependencies {
  return Object.freeze({
    platform: process.platform,
    architecture: process.arch,
    osRelease: operatingSystemRelease(),
    lstat: (path: string) => lstatSync(path),
    readFile: (path: string) => readFileSync(path),
    hashBytes: (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex"),
    spawn: spawnNativeHelperDefault
  });
}

function dependenciesFor(overrides: Partial<NativeHelperClientDependencies> | undefined): NativeHelperClientDependencies {
  return Object.freeze({ ...defaultDependencies(), ...overrides });
}

function startupFailure(
  code: NativeHelperStartupCode,
  stage: NativeHelperStartupStage,
  state: StartupState
): NativeHelperStartupError {
  return new NativeHelperStartupError({
    code,
    stage,
    helperExists: state.helperExists,
    profileMatches: state.profileMatches,
    integrityVerified: state.integrityVerified
  });
}

function errnoCode(error: unknown): string {
  if (typeof error !== "object" || error === null || !("code" in error)) return "";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code.toUpperCase() : "";
}

function artifactReadFailure(
  error: unknown,
  missingCode: NativeHelperStartupCode,
  otherwiseCode: NativeHelperStartupCode,
  stage: NativeHelperStartupStage,
  state: StartupState
): NativeHelperStartupError {
  const code = errnoCode(error);
  if (code === "ENOENT") return startupFailure(missingCode, stage, state);
  if (code === "EACCES" || code === "EPERM") return startupFailure("NATIVE_HELPER_BLOCKED", stage, state);
  return startupFailure(otherwiseCode, stage, state);
}

function assertSupportedHost(dependencies: NativeHelperClientDependencies, state: StartupState): void {
  if (dependencies.platform !== "win32") throw startupFailure("UNSUPPORTED_OS", "host", state);
  const windowsMajor = Number.parseInt(dependencies.osRelease.split(".")[0] ?? "", 10);
  if (Number.isFinite(windowsMajor) && windowsMajor < 10) {
    throw startupFailure("UNSUPPORTED_OS", "host", state);
  }
  if (dependencies.architecture !== "x64") throw startupFailure("UNSUPPORTED_ARCH", "host", state);
}

function readArtifact(options: {
  readonly path: string;
  readonly dependencies: NativeHelperClientDependencies;
  readonly state: StartupState;
  readonly stage: NativeHelperStartupStage;
  readonly missingCode: NativeHelperStartupCode;
  readonly invalidCode: NativeHelperStartupCode;
}): { readonly bytes: Buffer; readonly size: number; readonly identity: NativeArtifactIdentity | null } {
  let metadata: NativeArtifactMetadata;
  try {
    metadata = options.dependencies.lstat(options.path);
  } catch (error) {
    throw artifactReadFailure(error, options.missingCode, options.invalidCode, options.stage, options.state);
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || !Number.isSafeInteger(metadata.size) || metadata.size <= 0) {
    throw startupFailure(options.invalidCode, options.stage, options.state);
  }
  let bytes: Buffer;
  try {
    bytes = options.dependencies.readFile(options.path);
  } catch (error) {
    throw artifactReadFailure(error, options.missingCode, options.invalidCode, options.stage, options.state);
  }
  if (!Buffer.isBuffer(bytes) || bytes.length !== metadata.size) {
    throw startupFailure(options.invalidCode, options.stage, options.state);
  }
  const identity = [metadata.dev, metadata.ino, metadata.mtimeMs, metadata.ctimeMs]
    .every((value) => typeof value === "number" && Number.isFinite(value))
    ? Object.freeze({
        path: options.path,
        size: metadata.size,
        dev: metadata.dev as number,
        ino: metadata.ino as number,
        mtimeMs: metadata.mtimeMs as number,
        ctimeMs: metadata.ctimeMs as number
      })
    : null;
  return Object.freeze({ bytes, size: metadata.size, identity });
}

function parseJsonRecord(bytes: Buffer): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(bytes.toString("utf8")) as unknown;
    return parsed !== null && !Array.isArray(parsed) && typeof parsed === "object"
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function profileMatchesExpected(profile: Record<string, unknown>): boolean {
  const operations = profile.enabled_operations;
  const opcodes = Array.isArray(operations)
    ? operations.map((operation) => (
      operation !== null && !Array.isArray(operation) && typeof operation === "object"
        ? (operation as Record<string, unknown>).opcode
        : null
    ))
    : null;
  const transport = profile.transport;
  return (
    profile.schema_version === 1 && profile.profile_id === PROFILE_ID &&
    profile.profile_version === PROFILE_VERSION && profile.binary === HELPER_FILE_NAME &&
    profile.architecture === "x64" &&
    canonicalize(profile.fixed_argument_array) === canonicalize([PROFILE_ARGUMENT]) &&
    canonicalize(opcodes) === canonicalize(ENABLED_OPCODES) &&
    transport !== null && !Array.isArray(transport) && typeof transport === "object" &&
    (transport as Record<string, unknown>).network === false &&
    (transport as Record<string, unknown>).shell === false
  );
}

interface IdentityManifest {
  readonly profileSha256: string;
  readonly binarySha256: string;
  readonly binaryBytes: number;
}

function parseIdentityManifest(manifest: Record<string, unknown>): IdentityManifest | null {
  const capabilityProfile = manifest.capability_profile;
  const binary = manifest.binary;
  if (
    manifest.schema_version !== 1 || manifest.product !== "relay-winbroker" ||
    manifest.protocol_argument !== PROFILE_ARGUMENT || manifest.architecture !== "x64" ||
    capabilityProfile === null || Array.isArray(capabilityProfile) || typeof capabilityProfile !== "object" ||
    binary === null || Array.isArray(binary) || typeof binary !== "object"
  ) return null;
  const profileRecord = capabilityProfile as Record<string, unknown>;
  const binaryRecord = binary as Record<string, unknown>;
  const profileSha256 = profileRecord.sha256;
  const binarySha256 = binaryRecord.sha256;
  const binaryBytes = binaryRecord.bytes;
  if (
    profileRecord.id !== PROFILE_ID || profileRecord.version !== PROFILE_VERSION ||
    canonicalize(profileRecord.enabled_opcodes) !== canonicalize(ENABLED_OPCODES) ||
    binaryRecord.filename !== HELPER_FILE_NAME ||
    typeof profileSha256 !== "string" || !/^[0-9a-f]{64}$/u.test(profileSha256) ||
    typeof binarySha256 !== "string" || !/^[0-9a-f]{64}$/u.test(binarySha256) ||
    typeof binaryBytes !== "number" || !Number.isSafeInteger(binaryBytes) || binaryBytes <= 0
  ) return null;
  return Object.freeze({ profileSha256, binarySha256, binaryBytes });
}

function prepareNativeHelper(options: NativeHelperClientOptions): PreparedNativeHelper {
  const dependencies = dependenciesFor(options.dependencies);
  const state: StartupState = { helperExists: false, profileMatches: false, integrityVerified: false };
  assertSupportedHost(dependencies, state);
  const nativeDirectory = helperDirectory(options.resourcesPath, options.isPackaged);
  const helperPath = join(nativeDirectory, "relay-winbroker.exe");
  const helper = readArtifact({
    path: helperPath, dependencies, state, stage: "helper_presence",
    missingCode: "NATIVE_HELPER_MISSING", invalidCode: "NATIVE_HELPER_CORRUPTED"
  });
  state.helperExists = true;
  const profile = readArtifact({
    path: join(nativeDirectory, PROFILE_FILE_NAME), dependencies, state, stage: "profile_identity",
    missingCode: "NATIVE_HELPER_MISSING", invalidCode: "NATIVE_HELPER_PROFILE_MISMATCH"
  });
  const parsedProfile = parseJsonRecord(profile.bytes);
  if (parsedProfile === null || !profileMatchesExpected(parsedProfile)) {
    throw startupFailure("NATIVE_HELPER_PROFILE_MISMATCH", "profile_identity", state);
  }
  state.profileMatches = true;
  const manifest = readArtifact({
    path: identityManifestPath(), dependencies, state, stage: "integrity",
    missingCode: "NATIVE_HELPER_MISSING", invalidCode: "NATIVE_HELPER_CORRUPTED"
  });
  const parsedManifestRecord = parseJsonRecord(manifest.bytes);
  const parsedManifest = parsedManifestRecord === null ? null : parseIdentityManifest(parsedManifestRecord);
  if (parsedManifest === null) throw startupFailure("NATIVE_HELPER_CORRUPTED", "integrity", state);
  let profileSha256: string;
  let helperSha256: string;
  try {
    profileSha256 = dependencies.hashBytes(profile.bytes);
    helperSha256 = dependencies.hashBytes(helper.bytes);
  } catch {
    throw startupFailure("NATIVE_HELPER_CORRUPTED", "integrity", state);
  }
  if (
    parsedManifest.profileSha256 !== profileSha256 ||
    parsedManifest.binarySha256 !== helperSha256 || parsedManifest.binaryBytes !== helper.size
  ) throw startupFailure("NATIVE_HELPER_CORRUPTED", "integrity", state);
  state.integrityVerified = true;
  const identities = [helper.identity, profile.identity, manifest.identity];
  return Object.freeze({
    helperPath,
    dependencies,
    appVersion: options.appVersion ?? "unknown",
    artifactIdentities: identities.every((identity) => identity !== null)
      ? Object.freeze(identities as NativeArtifactIdentity[])
      : null
  });
}

function preparationKey(options: NativeHelperClientOptions): string {
  return canonicalize({
    resources_path: options.resourcesPath.toLocaleLowerCase("en-US"),
    packaged: options.isPackaged,
    app_version: options.appVersion ?? "unknown"
  });
}

function sameArtifactIdentity(left: NativeArtifactIdentity, right: NativeArtifactIdentity): boolean {
  return (
    left.path === right.path && left.size === right.size && left.dev === right.dev &&
    left.ino === right.ino && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs
  );
}

function rememberVerifiedPreparation(
  options: NativeHelperClientOptions,
  prepared: PreparedNativeHelper,
  startupEvidence: NativeHelperStartupEvidence
): void {
  if (prepared.artifactIdentities === null) {
    cachedVerifiedPreparation = null;
    return;
  }
  cachedVerifiedPreparation = Object.freeze({
    prepared,
    startupEvidence,
    dependencyOverrides: options.dependencies,
    key: preparationKey(options)
  });
}

function reuseVerifiedPreparation(options: NativeHelperClientOptions): CachedVerifiedPreparation | null {
  const cached = cachedVerifiedPreparation;
  if (
    cached === null || cached.dependencyOverrides !== options.dependencies || cached.key !== preparationKey(options) ||
    cached.prepared.artifactIdentities === null
  ) {
    cachedVerifiedPreparation = null;
    return null;
  }
  try {
    for (const expected of cached.prepared.artifactIdentities) {
      const metadata = cached.prepared.dependencies.lstat(expected.path);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size !== expected.size) {
        cachedVerifiedPreparation = null;
        return null;
      }
      const actual: NativeArtifactIdentity = Object.freeze({
        path: expected.path,
        size: metadata.size,
        dev: metadata.dev as number,
        ino: metadata.ino as number,
        mtimeMs: metadata.mtimeMs as number,
        ctimeMs: metadata.ctimeMs as number
      });
      if (
        ![actual.dev, actual.ino, actual.mtimeMs, actual.ctimeMs].every(Number.isFinite) ||
        !sameArtifactIdentity(actual, expected)
      ) {
        cachedVerifiedPreparation = null;
        return null;
      }
    }
  } catch {
    cachedVerifiedPreparation = null;
    return null;
  }
  return cached;
}

function spawnFailureCode(result: NativeHelperSpawnResult): NativeHelperStartupCode | null {
  const code = errnoCode(result.error);
  if (code === "ENOENT") return "NATIVE_HELPER_MISSING";
  if (code === "EACCES" || code === "EPERM") return "NATIVE_HELPER_BLOCKED";
  if (code === "ETIMEDOUT" || (result.status === null && result.signal !== undefined && result.signal !== null)) {
    return "NATIVE_HELPER_TIMEOUT";
  }
  if (result.error !== undefined) return "NATIVE_HELPER_BLOCKED";
  if (result.status !== 0) return "NATIVE_HELPER_PROTOCOL_INVALID";
  return null;
}

function executeReadOnlyOperation(
  prepared: PreparedNativeHelper,
  opcode: 257 | 258,
  payload: Record<string, unknown>
): Record<string, unknown> {
  const input = Buffer.concat([
    frame(1, 0, 0, { message_kind: "client_hello", profile_id: PROFILE_ID, profile_version: PROFILE_VERSION }),
    frame(3, opcode, 1, payload),
    frame(7, 0, 2, { message_kind: "close", profile_id: PROFILE_ID, profile_version: PROFILE_VERSION })
  ]);
  let result: NativeHelperSpawnResult;
  try {
    result = prepared.dependencies.spawn(prepared.helperPath, [PROFILE_ARGUMENT], {
      cwd: dirname(prepared.helperPath), input, encoding: null, maxBuffer: 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"], shell: false, windowsHide: true, timeout: 15_000
    });
  } catch (error) {
    const code = errnoCode(error);
    throw new NativeHelperStartupError({
      code: code === "ENOENT" ? "NATIVE_HELPER_MISSING" :
        code === "ETIMEDOUT" ? "NATIVE_HELPER_TIMEOUT" : "NATIVE_HELPER_BLOCKED",
      stage: "spawn", helperExists: true, profileMatches: true, integrityVerified: true
    });
  }
  const executionFailure = spawnFailureCode(result);
  if (executionFailure !== null) {
    throw new NativeHelperStartupError({
      code: executionFailure,
      stage: executionFailure === "NATIVE_HELPER_TIMEOUT" ? "spawn" : "protocol",
      helperExists: true, profileMatches: true, integrityVerified: true
    });
  }
  let responses: NativeFrame[];
  try {
    const stdout = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? "", "utf8");
    responses = parseFrames(stdout);
  } catch {
    throw new NativeHelperStartupError({
      code: "NATIVE_HELPER_PROTOCOL_INVALID", stage: "protocol",
      helperExists: true, profileMatches: true, integrityVerified: true
    });
  }
  const hello = responses[0];
  const response = responses[1];
  if (
    responses.length !== 2 || hello?.kind !== 2 || hello.opcode !== 0 || hello.sequence !== 0 ||
    hello.payload.status !== "ready" || hello.payload.message_kind !== "server_hello" ||
    hello.payload.profile_id !== PROFILE_ID || hello.payload.profile_version !== PROFILE_VERSION ||
    canonicalize(hello.payload.enabled_opcodes) !== canonicalize(ENABLED_OPCODES) ||
    response?.kind !== 4 || response.opcode !== opcode || response.sequence !== 1
  ) {
    throw new NativeHelperStartupError({
      code: "NATIVE_HELPER_PROTOCOL_INVALID", stage: "protocol",
      helperExists: true, profileMatches: true, integrityVerified: true
    });
  }
  return response.payload;
}

export function verifyNativeHelperAtStartup(options: NativeHelperClientOptions): NativeHelperStartupEvidence {
  const cached = reuseVerifiedPreparation(options);
  if (cached !== null) return cached.startupEvidence;
  const prepared = prepareNativeHelper(options);
  const response = executeReadOnlyOperation(prepared, 258, {
    candidate_path: prepared.helperPath,
    mutation_policy: "read_only",
    purpose: "native_helper_selfcheck"
  });
  if (
    response.status !== "ok" || response.exists !== true || response.reparse !== false ||
    response.canonicalized !== true
  ) {
    throw new NativeHelperStartupError({
      code: "NATIVE_HELPER_PROTOCOL_INVALID", stage: "helper_path",
      helperExists: true, profileMatches: true, integrityVerified: true
    });
  }
  const startupEvidence = Object.freeze({
    profileId: PROFILE_ID,
    profileVersion: PROFILE_VERSION,
    enabledOpcodes: ENABLED_OPCODES,
    helperPathVerified: true,
    diagnostic: createStartupDiagnostic({
      relayVersion: prepared.appVersion, platform: prepared.dependencies.platform,
      osRelease: prepared.dependencies.osRelease, architecture: prepared.dependencies.architecture,
      stage: "helper_path", helperExists: true, profileMatches: true, integrityVerified: true
    })
  });
  rememberVerifiedPreparation(options, prepared, startupEvidence);
  return startupEvidence;
}

export function inspectNativeDataRoot(
  options: NativeHelperClientOptions & { readonly dataRootPath: string }
): NativeDataRootInspectionEvidence {
  const prepared = reuseVerifiedPreparation(options)?.prepared ?? prepareNativeHelper(options);
  const response = executeReadOnlyOperation(prepared, 257, {
    candidate_kind: "relay_data_root",
    candidate_path: options.dataRootPath,
    require_fixed_local: true,
    required_filesystem: "ntfs"
  });
  if (response.status === "error") {
    const nativeCode = typeof response.code === "string" ? response.code : "";
    const reason = typeof response.reason === "string" ? response.reason : "";
    if (nativeCode.includes("PERMISSION") || nativeCode.includes("ACCESS_DENIED")) {
      throw new NativeDataRootInspectionError({ code: "DATA_ROOT_PERMISSION_DENIED" });
    }
    if (nativeCode === "RELAY_NATIVE.PATH_INVALID" && reason.includes("absolute-drive-only")) {
      throw new NativeDataRootInspectionError({ code: "DATA_ROOT_NOT_FIXED_NTFS" });
    }
    if (nativeCode === "RELAY_NATIVE.VOLUME_UNSUPPORTED" || nativeCode === "RELAY_NATIVE.PATH_INVALID") {
      throw new NativeDataRootInspectionError({ code: "DATA_ROOT_UNAVAILABLE" });
    }
    throw new NativeHelperStartupError({
      code: "NATIVE_HELPER_PROTOCOL_INVALID", stage: "data_root",
      helperExists: true, profileMatches: true, integrityVerified: true
    });
  }
  const filesystem = typeof response.filesystem === "string" ? response.filesystem.toLowerCase() : null;
  const fixedLocal = typeof response.fixed_local === "boolean" ? response.fixed_local : null;
  const driveType = typeof response.drive_type === "number" && Number.isSafeInteger(response.drive_type)
    ? response.drive_type : null;
  if (response.status !== "ok" || typeof response.supported !== "boolean" || filesystem === null || driveType === null) {
    throw new NativeHelperStartupError({
      code: "NATIVE_HELPER_PROTOCOL_INVALID", stage: "data_root",
      helperExists: true, profileMatches: true, integrityVerified: true
    });
  }
  if (response.supported !== true || fixedLocal !== true || filesystem !== "ntfs") {
    throw new NativeDataRootInspectionError({
      code: "DATA_ROOT_NOT_FIXED_NTFS", fixedLocal, filesystem, driveType
    });
  }
  const volume = Object.freeze({ fixedLocal: true, filesystem: "ntfs", driveType });
  return Object.freeze({
    supported: true, fixedLocal: true, filesystem: "ntfs", driveType,
    diagnostic: createStartupDiagnostic({
      relayVersion: prepared.appVersion, platform: prepared.dependencies.platform,
      osRelease: prepared.dependencies.osRelease, architecture: prepared.dependencies.architecture,
      stage: "data_root", helperExists: true, profileMatches: true, integrityVerified: true,
      dataRootVolume: volume
    })
  });
}
