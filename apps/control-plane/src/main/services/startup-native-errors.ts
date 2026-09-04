export type NativeHelperStartupCode =
  | "NATIVE_HELPER_MISSING"
  | "NATIVE_HELPER_BLOCKED"
  | "NATIVE_HELPER_PROFILE_MISMATCH"
  | "NATIVE_HELPER_CORRUPTED"
  | "NATIVE_HELPER_TIMEOUT"
  | "NATIVE_HELPER_PROTOCOL_INVALID"
  | "UNSUPPORTED_OS"
  | "UNSUPPORTED_ARCH";

export type NativeDataRootInspectionCode =
  | "DATA_ROOT_UNAVAILABLE"
  | "DATA_ROOT_NOT_FIXED_NTFS"
  | "DATA_ROOT_PERMISSION_DENIED";

export type NativeHelperStartupStage =
  | "host"
  | "helper_presence"
  | "profile_identity"
  | "integrity"
  | "spawn"
  | "protocol"
  | "helper_path"
  | "data_root";

export type StartupRecoveryAction = "retry" | "open_diagnostics" | "open_data_root_settings" | "exit";

const NATIVE_HELPER_MESSAGES: Readonly<Record<NativeHelperStartupCode, string>> = Object.freeze({
  NATIVE_HELPER_MISSING: "Relay 本机组件缺失，可能安装不完整或被安全软件隔离。",
  NATIVE_HELPER_BLOCKED: "Relay 本机组件被 Windows 安全策略阻止，请检查 Defender、AppLocker 或企业安全策略。",
  NATIVE_HELPER_PROFILE_MISMATCH: "Relay 主程序与本机组件版本不一致，请使用完整安装包修复安装。",
  NATIVE_HELPER_CORRUPTED: "Relay 本机组件校验失败，文件可能损坏或被替换。",
  NATIVE_HELPER_TIMEOUT: "Relay 本机组件启动超时，请检查安全软件或系统策略。",
  NATIVE_HELPER_PROTOCOL_INVALID: "Relay 本机组件返回了无效响应。",
  UNSUPPORTED_OS: "Relay 当前支持 Windows 10 和 Windows 11。",
  UNSUPPORTED_ARCH: "Relay 当前仅提供 Windows x64 版本；ARM64 尚未提供原生版本。"
});

const NATIVE_HELPER_ACTIONS: Readonly<Record<NativeHelperStartupCode, readonly StartupRecoveryAction[]>> =
  Object.freeze({
    NATIVE_HELPER_MISSING: Object.freeze<StartupRecoveryAction[]>(["retry", "open_diagnostics", "exit"]),
    NATIVE_HELPER_BLOCKED: Object.freeze<StartupRecoveryAction[]>(["retry", "open_diagnostics", "exit"]),
    NATIVE_HELPER_PROFILE_MISMATCH: Object.freeze<StartupRecoveryAction[]>(["retry", "open_diagnostics", "exit"]),
    NATIVE_HELPER_CORRUPTED: Object.freeze<StartupRecoveryAction[]>(["retry", "open_diagnostics", "exit"]),
    NATIVE_HELPER_TIMEOUT: Object.freeze<StartupRecoveryAction[]>(["retry", "open_diagnostics", "exit"]),
    NATIVE_HELPER_PROTOCOL_INVALID: Object.freeze<StartupRecoveryAction[]>(["retry", "open_diagnostics", "exit"]),
    UNSUPPORTED_OS: Object.freeze<StartupRecoveryAction[]>(["open_diagnostics", "exit"]),
    UNSUPPORTED_ARCH: Object.freeze<StartupRecoveryAction[]>(["open_diagnostics", "exit"])
  });

const DATA_ROOT_MESSAGES: Readonly<Record<NativeDataRootInspectionCode, string>> = Object.freeze({
  DATA_ROOT_UNAVAILABLE: "Relay 数据目录不存在或当前不可访问。",
  DATA_ROOT_NOT_FIXED_NTFS: "Relay 数据目录必须位于本机固定 NTFS 磁盘，请重新选择目录。",
  DATA_ROOT_PERMISSION_DENIED: "Relay 没有权限读写所选数据目录，请选择其他目录或检查权限。"
});

export function nativeHelperStartupMessage(code: NativeHelperStartupCode): string {
  return NATIVE_HELPER_MESSAGES[code];
}

export function nativeHelperStartupActions(code: NativeHelperStartupCode): readonly StartupRecoveryAction[] {
  return NATIVE_HELPER_ACTIONS[code];
}

export function nativeDataRootInspectionMessage(code: NativeDataRootInspectionCode): string {
  return DATA_ROOT_MESSAGES[code];
}

export class NativeHelperStartupError extends Error {
  readonly code: NativeHelperStartupCode;
  readonly stage: NativeHelperStartupStage;
  readonly helperExists: boolean;
  readonly profileMatches: boolean;
  readonly integrityVerified: boolean;

  constructor(options: {
    readonly code: NativeHelperStartupCode;
    readonly stage: NativeHelperStartupStage;
    readonly helperExists?: boolean;
    readonly profileMatches?: boolean;
    readonly integrityVerified?: boolean;
  }) {
    super(options.code);
    this.name = "NativeHelperStartupError";
    this.code = options.code;
    this.stage = options.stage;
    this.helperExists = options.helperExists ?? false;
    this.profileMatches = options.profileMatches ?? false;
    this.integrityVerified = options.integrityVerified ?? false;
  }
}

export class NativeDataRootInspectionError extends Error {
  readonly code: NativeDataRootInspectionCode;
  readonly stage = "data_root" as const;
  readonly fixedLocal: boolean | null;
  readonly filesystem: string | null;
  readonly driveType: number | null;

  constructor(options: {
    readonly code: NativeDataRootInspectionCode;
    readonly fixedLocal?: boolean | null;
    readonly filesystem?: string | null;
    readonly driveType?: number | null;
  }) {
    super(options.code);
    this.name = "NativeDataRootInspectionError";
    this.code = options.code;
    this.fixedLocal = options.fixedLocal ?? null;
    this.filesystem = options.filesystem ?? null;
    this.driveType = options.driveType ?? null;
  }
}
