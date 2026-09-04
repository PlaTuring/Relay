import type {
  NativeDataRootInspectionCode,
  NativeHelperStartupCode,
  NativeHelperStartupStage
} from "./startup-native-errors.js";

export type StartupDiagnosticCode = NativeHelperStartupCode | NativeDataRootInspectionCode;

export interface StartupDataRootVolumeDiagnostic {
  readonly fixedLocal: boolean | null;
  readonly filesystem: string | null;
  readonly driveType: number | null;
}

export interface StartupDiagnostic {
  readonly relayVersion: string;
  readonly operatingSystem: string;
  readonly architecture: string;
  readonly stage: NativeHelperStartupStage;
  readonly code: StartupDiagnosticCode | null;
  readonly helperExists: boolean;
  readonly profileMatches: boolean;
  readonly integrityVerified: boolean;
  readonly dataRootVolume: StartupDataRootVolumeDiagnostic | null;
}

function boundedToken(value: string, fallback: string, maximumLength: number): string {
  const bounded = value
    .replace(/[^\p{L}\p{N}._+() -]/gu, "?")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maximumLength);
  return bounded.length === 0 ? fallback : bounded;
}

function relayVersionToken(value: string | undefined): string {
  return (value ?? "").match(/\b\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\b/u)?.[0] ?? "unknown";
}

function operatingSystemReleaseToken(value: string): string {
  return value.match(/\b\d+(?:\.\d+){1,3}\b/u)?.[0] ?? "unknown-release";
}

export function createStartupDiagnostic(options: {
  readonly relayVersion?: string;
  readonly platform: NodeJS.Platform | string;
  readonly osRelease: string;
  readonly architecture: string;
  readonly stage: NativeHelperStartupStage;
  readonly code?: StartupDiagnosticCode | null;
  readonly helperExists: boolean;
  readonly profileMatches: boolean;
  readonly integrityVerified: boolean;
  readonly dataRootVolume?: {
    readonly fixedLocal?: boolean | null;
    readonly filesystem?: string | null;
    readonly driveType?: number | null;
  } | null;
}): StartupDiagnostic {
  const platform = options.platform === "win32" ? "Windows" : boundedToken(String(options.platform), "unknown-os", 24);
  const release = operatingSystemReleaseToken(options.osRelease);
  const filesystem = options.dataRootVolume?.filesystem;
  const dataRootVolume = options.dataRootVolume === undefined || options.dataRootVolume === null
    ? null
    : Object.freeze({
      fixedLocal: options.dataRootVolume.fixedLocal ?? null,
      filesystem: typeof filesystem === "string"
        ? boundedToken(filesystem.toLowerCase(), "unknown", 16)
        : null,
      driveType: Number.isSafeInteger(options.dataRootVolume.driveType)
        ? options.dataRootVolume.driveType ?? null
        : null
    });
  return Object.freeze({
    relayVersion: relayVersionToken(options.relayVersion),
    operatingSystem: `${platform} ${release}`,
    architecture: boundedToken(options.architecture, "unknown", 16),
    stage: options.stage,
    code: options.code ?? null,
    helperExists: options.helperExists,
    profileMatches: options.profileMatches,
    integrityVerified: options.integrityVerified,
    dataRootVolume
  });
}

export function formatStartupDiagnostic(diagnostic: StartupDiagnostic): string {
  const volume = diagnostic.dataRootVolume === null
    ? "dataRoot=not-inspected"
    : `dataRoot.fixedLocal=${String(diagnostic.dataRootVolume.fixedLocal)} dataRoot.fs=${diagnostic.dataRootVolume.filesystem ?? "unknown"} dataRoot.driveType=${diagnostic.dataRootVolume.driveType ?? "unknown"}`;
  return [
    `relay=${diagnostic.relayVersion}`,
    `os=${diagnostic.operatingSystem}`,
    `arch=${diagnostic.architecture}`,
    `stage=${diagnostic.stage}`,
    `code=${diagnostic.code ?? "OK"}`,
    `helperExists=${String(diagnostic.helperExists)}`,
    `profileMatches=${String(diagnostic.profileMatches)}`,
    `integrityVerified=${String(diagnostic.integrityVerified)}`,
    volume
  ].join(" ");
}
