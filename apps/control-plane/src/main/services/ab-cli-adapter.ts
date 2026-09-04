import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { utilityProcess } from "electron";

import { ADAPTER_SESSION_PARTITION } from "../security.js";
import {
  BRANDING_AUTHORITY,
  type ComponentId,
  type ComponentScanResult,
  type CancelInstallationRequest,
  type ExecuteInstallationRequest,
  type InstallationStatusResult,
  type PrepareInstallationRequest,
  type PrepareInstallationResult,
  type ProjectSpec,
  type QueryInstallationRequest,
  type ScanDetectedLocations,
  type ScanInstallationRequest,
  type ScanInstallationResult
} from "../../shared/ipc-contract.js";
import {
  normalizeRelayResolvedSeedPlan,
  normalizeRelaySeedPolicy,
  relayCompileShotIds,
  relaySeedPlansEqual,
  relayWorkflowSeedPlan,
  resolveRelaySeedPlan,
  type RelayResolvedSeedPlan
} from "../../shared/seed-policy.js";
import { ControlPlaneServiceError } from "./errors.js";
import { assertMultiSegmentPromptPreflight } from "./workflow-text-preflight.js";
import { assertPlainJson } from "./validation.js";
import {
  normalizeInstallationComponents,
  resolveA3InstallationComponents,
  selectedPublicInstallationComponents,
  type A3InstallationComponent as A3Component
} from "./installation-component-policy.js";

const MAX_OUTPUT_BYTES = 1_048_576;
const DEFAULT_TIMEOUT_MS = 120_000;
const FFPROBE_TIMEOUT_MS = 30_000;
const FFPROBE_MAX_OUTPUT_BYTES = 1_048_576;
const FFPROBE_ARGUMENT_PREFIX = Object.freeze([
  "-v",
  "error",
  "-print_format",
  "json",
  "-show_format",
  "-show_streams"
] as const);
const MAX_WORKFLOW_SEGMENTS = 12;
// The attach scan is metadata-only in V2. Bound a wedged WMI/child process so
// the first-run wizard never remains on an indefinite "scanning" screen.
const SCAN_TIMEOUT_MS = 12_000;
const STREAM_A_UTILITY_PROTOCOL = "minimax-h3.local-runtime.utility.v1";
const STREAM_B_UTILITY_PROTOCOL = "minimax-h3.workflow-compiler.utility.v1";

type AdapterProcessPhase = "launch" | "request" | "execute" | "drain" | "decode";

function adapterProcessFailure(phase: AdapterProcessPhase, detail: string): ControlPlaneServiceError {
  return new ControlPlaneServiceError("ADAPTER_FAILED", `${detail}（阶段：${phase}）。`);
}

function localRuntimeProcessFailure(
  phase: AdapterProcessPhase,
  errorCode: string,
  moduleDetail: string
): ControlPlaneServiceError {
  if ([
    "LOCAL_RUNTIME.DOWNLOAD_ALREADY_RUNNING",
    "LOCAL_RUNTIME.DOWNLOAD_LEASE_LOST"
  ].includes(errorCode)) {
    return adapterProcessFailure(
      phase,
      "同一组件已有安装任务正在写入；请等待当前任务完成后再继续"
    );
  }
  if ([
    "LOCAL_RUNTIME.DOWNLOAD_DISK_FULL",
    "LOCAL_RUNTIME.DOWNLOAD_PARTIAL_WRITE_FAILED",
    "LOCAL_RUNTIME.DOWNLOAD_LOCK_FAILED"
  ].includes(errorCode)) {
    return adapterProcessFailure(
      phase,
      "安装盘空间不足或暂时无法写入；下载分片已经保留，请检查磁盘后继续恢复"
    );
  }
  if ([
    "LOCAL_RUNTIME.STATE_PERSIST_FAILED",
    "LOCAL_RUNTIME.DOWNLOAD_STATE_PERSIST_FAILED",
    "LOCAL_RUNTIME.DOWNLOAD_COMMIT_FAILED"
  ].includes(errorCode)) {
    return adapterProcessFailure(
      phase,
      "Windows 暂时占用了安装状态文件；下载分片已经保留，请点击“继续恢复安装”"
    );
  }
  if ([
    "LOCAL_RUNTIME.DOWNLOAD_NETWORK_FAILED",
    "LOCAL_RUNTIME.DOWNLOAD_STREAM_FAILED",
    "LOCAL_RUNTIME.DOWNLOAD_TRUNCATED"
  ].includes(errorCode)) {
    return adapterProcessFailure(
      phase,
      "下载连接中断；已保留断点并尝试备用源，仍未完成时可点击“继续恢复安装”"
    );
  }
  if (errorCode === "LOCAL_RUNTIME.DOWNLOAD_HTTP_FAILED") {
    return adapterProcessFailure(
      phase,
      "当前下载源拒绝或无法提供该文件；程序已尝试备用源，稍后可继续恢复"
    );
  }
  return adapterProcessFailure(
    phase,
    `适配器未能完成本机操作，错误码 ${errorCode}${moduleDetail}`
  );
}

function compilerProcessFailure(
  phase: AdapterProcessPhase,
  errorCode: string,
  moduleDetail: string,
  errorReason: string | null = null
): ControlPlaneServiceError {
  const promptReasonMessages: Readonly<Record<string, string>> = Object.freeze({
    PROMPT_FIELDS_DUPLICATED_OR_UNSUPPORTED: "提示词字段重复或包含不受支持的字段；请只保留当前模式的官方字段且每个字段只出现一次。",
    PROMPT_REQUIRED_FIELD_EMPTY: "提示词存在必填字段为空；只有 overall_soundscape 和 non_diegetic_music 可以留空。",
    PROMPT_MODE_FIELDS_MISMATCH: "提示词字段与当前选择的 H3 模式不匹配。",
    PROMPT_FIELD_ORDER: "提示词字段顺序不符合 MiniMax H3 官方格式。",
    PROMPT_TIMELINE_FIELD_MISSING: "当前模式缺少官方时间线字段。",
    BASE_THREE_FIELDS_REQUIRED: "T2V/首尾帧多段提示词必须包含官方三字段：integrated_multimodal_description、overall_soundscape、non_diegetic_music。",
    REF2VA_SIX_FIELDS_REQUIRED: "Ref2VA 多段提示词必须包含官方六字段：subject_definitions、summary、retention_analysis、detailed_description、overall_soundscape、non_diegetic_music。",
    REF2VA_SUBJECT_DEFINITIONS_FIRST: "Ref2VA 提示词必须从 subject_definitions 开始，前面不要添加其他内容。",
    T2V_DESCRIPTION_FIRST: "T2V 提示词必须从 integrated_multimodal_description 开始，前面不要添加其他内容。",
    KEYFRAME_PREAMBLE_INVALID: "首帧/首尾帧提示词在官方三字段前只能填写参考图片与目标视频的对应说明。",
    BASE_SHOT_ONE_FIRST: "多段 T2V/首尾帧的时间线必须从 [Shot 1] 或 [镜头 1] 开始。",
    SHOT_DESCRIPTION_EMPTY: "每个镜头都必须填写画面描述。",
    SHOT_NUMBER_SEQUENCE: "镜头编号必须从 1 开始并连续递增。",
    REF2VA_SUMMARY_TASK_TYPE: "Ref2VA 的 summary 必须以官方英文任务类型开头，例如 [reference generation]。",
    REF2VA_RETENTION_RELATIONSHIP: "Ref2VA 的 retention_analysis 每一行都必须使用官方关系标记。",
    REF2VA_STYLE_OPENING: "Ref2VA 的 detailed_description 必须先写整体视觉风格，再开始 [Shot 1] / [镜头 1]。",
    REF2VA_REFERENCE_LABEL_REQUIRED: "Ref2VA 的 subject_definitions 至少要定义一个 <Subject N>、<Picture N>、<Video N> 或 <Audio N> 参考标签。"
  });
  if (errorReason !== null && promptReasonMessages[errorReason] !== undefined) {
    return new ControlPlaneServiceError("INVALID_REQUEST", promptReasonMessages[errorReason]);
  }
  if ([
    "PROJECT.PROMPT_FORMAT",
    "PROJECT.PROMPT_MODE_FORMAT",
    "PROJECT.PROMPT_FIELD_ORDER"
  ].includes(errorCode)) {
    return new ControlPlaneServiceError(
      "INVALID_REQUEST",
      "提示词不符合所选 MiniMax H3 模式的官方字段结构或顺序；请检查基础三字段、Ref2VA 六字段及各字段内容。"
    );
  }
  if (errorCode === "PROJECT.PROMPT_TIMELINE") {
    return new ControlPlaneServiceError(
      "INVALID_REQUEST",
      "提示词镜头编号或时间线无效；[Shot 1] 不写时间，后续切点必须严格递增并早于总时长。"
    );
  }
  if (errorCode === "PROJECT.PROMPT_SEGMENTATION") {
    return new ControlPlaneServiceError(
      "INVALID_REQUEST",
      "提示词无法按所选单段时长安全拆分；每个分段边界都需要一个明确的 [Shot N] / [镜头 N] 切点。"
    );
  }
  if (errorCode === "PROJECT.PROMPT_REFERENCE_BINDING") {
    return new ControlPlaneServiceError(
      "INVALID_REQUEST",
      "提示词中的 Picture、Video 或 Audio 标签与当前工作流实际连接的参考素材不一致。"
    );
  }
  return adapterProcessFailure(
    phase,
    `工作流编译适配器失败，错误码 ${errorCode}${moduleDetail}`
  );
}

function adapterTimeoutFailure(
  phase: AdapterProcessPhase,
  timeoutMilliseconds: number
): ControlPlaneServiceError {
  const seconds = Math.ceil(timeoutMilliseconds / 1_000);
  const detail = phase === "drain"
    ? "适配器进程已退出，但输出管道未能及时收尾"
    : phase === "launch"
      ? "适配器未能在硬截止前启动"
      : "适配器未能在硬截止前完成本机操作";
  return adapterProcessFailure(phase, `${detail}，截止时间 ${seconds} 秒`);
}

export const AB_CLI_OPERATION_ALLOWLIST = Object.freeze({
  streamA: Object.freeze({
    scanLocations: Object.freeze(["ui-locations", "--request", "<managed-request-json>"]),
    scanInstallation: Object.freeze(["attach-plan", "--request", "<managed-request-json>"]),
    planInstallation: Object.freeze(["install-plan", "--request", "<managed-request-json>"]),
    executeInstallation: Object.freeze(["install", "--request", "<managed-request-json>"]),
    queryInstallation: Object.freeze(["install-status", "--request", "<managed-request-json>"]),
    cancelInstallation: Object.freeze(["install-cancel", "--request", "<managed-request-json>"]),
    recoverInstallation: Object.freeze(["install-recover", "--request", "<managed-request-json>"])
  }),
  streamB: Object.freeze({
    compileWorkflow: Object.freeze([
      "compile",
      "--project",
      "<managed-project-json>",
      "--output-dir",
      "<managed-output-directory>"
    ])
  })
} as const);

type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | { readonly [key: string]: JsonValue } | readonly JsonValue[];

interface CompilerRequest {
  readonly project: ProjectSpec;
  readonly resolvedFrames: {
    readonly first: string | null;
    readonly last: string | null;
  };
  /** Main resolves this only inside the explicit compile transaction. */
  readonly seedResolution?: RelayResolvedSeedPlan;
}

export interface ValidatedLaunchPlan {
  readonly executable: string;
  readonly args: readonly string[];
  readonly workingDirectory: string;
}

export interface RestoreCompletedInstallationRequest {
  readonly installRoot: string;
  readonly installationId: string;
  readonly comfyUiRoot: string;
  readonly completedComponents: readonly ComponentId[];
}

export interface AbCliAdapter {
  readonly streamAAvailable: boolean;
  readonly streamBAvailable: boolean;
  scanInstallation(request: ScanInstallationRequest): Promise<ScanInstallationResult | null>;
  prepareInstallation(request: PrepareInstallationRequest): Promise<PrepareInstallationResult | null>;
  executeInstallation(request: ExecuteInstallationRequest): Promise<InstallationStatusResult | null>;
  queryInstallation(request: QueryInstallationRequest): Promise<InstallationStatusResult | null>;
  cancelInstallation(request: CancelInstallationRequest): Promise<InstallationStatusResult | null>;
  restoreCompletedInstallation(request: RestoreCompletedInstallationRequest): Promise<boolean>;
  launchManagedComfy(): Promise<boolean>;
  dispose(): void;
  compileWorkflow(request: CompilerRequest): Promise<JsonValue | null>;
}

export interface CreateAbCliAdapterOptions {
  readonly appPath: string;
  readonly resourcesPath: string;
  readonly isPackaged: boolean;
  readonly enabled: boolean;
}

export interface CreateFixedFfprobeRunnerOptions {
  /**
   * Absolute ffprobe path obtained from Relay's verified installation state or
   * another explicitly trusted local configuration. The per-call executable
   * argument is only a compatibility seam for asset-preflight and may not
   * replace this authority.
   */
  readonly trustedExecutablePath: string;
  readonly timeoutMilliseconds?: number;
}

export type FixedFfprobeRunner = (
  executable: string,
  arguments_: readonly string[]
) => Promise<unknown>;

const activeAdapterDisposers = new Set<() => void>();

/**
 * Synchronously releases only ComfyUI children created and retained by adapters
 * in this Electron process. This deliberately does not inspect ports, process
 * names, PIDs, or unrelated ComfyUI instances.
 */
export function disposeAbCliAdapters(): void {
  for (const dispose of [...activeAdapterDisposers]) dispose();
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function childEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ELECTRON_RUN_AS_NODE: "1",
    NO_COLOR: "1"
  };
  for (const key of ["SystemRoot", "WINDIR", "TEMP", "TMP"] as const) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

function fixedFfprobeMediaPath(arguments_: readonly string[]): string {
  if (
    !Array.isArray(arguments_) ||
    arguments_.length !== FFPROBE_ARGUMENT_PREFIX.length + 1 ||
    FFPROBE_ARGUMENT_PREFIX.some((argument, index) => arguments_[index] !== argument)
  ) {
    throw new ControlPlaneServiceError(
      "INVALID_REQUEST",
      "素材技术检查参数不符合 Relay 固定的 ffprobe 只读配置。"
    );
  }
  const mediaPath = arguments_[FFPROBE_ARGUMENT_PREFIX.length];
  if (
    typeof mediaPath !== "string" ||
    mediaPath.length === 0 ||
    mediaPath.length > 32_767 ||
    mediaPath.includes("\0") ||
    !isAbsolute(mediaPath)
  ) {
    throw new ControlPlaneServiceError(
      "INVALID_REQUEST",
      "素材技术检查只接受一个已定位的本机绝对文件路径。"
    );
  }
  return resolve(mediaPath);
}

function fixedFfprobeFailure(detail: string): ControlPlaneServiceError {
  return new ControlPlaneServiceError("ADAPTER_FAILED", `${detail}（本机素材技术检查）。`);
}

/**
 * Creates the sole approved ffprobe child-process seam for local asset
 * preflight. The executable is fixed when the runner is created, all ffprobe
 * switches are constant, and the only per-call value is one absolute media
 * path. No shell, PATH lookup, user-provided working directory, or inherited
 * command line is used.
 */
export function createFixedFfprobeRunner(
  options: CreateFixedFfprobeRunnerOptions
): FixedFfprobeRunner {
  const trustedInput = options.trustedExecutablePath;
  if (
    typeof trustedInput !== "string" ||
    trustedInput.length === 0 ||
    trustedInput.length > 32_767 ||
    trustedInput.includes("\0") ||
    !isAbsolute(trustedInput)
  ) {
    throw new ControlPlaneServiceError(
      "INVALID_REQUEST",
      "ffprobe 必须来自 Relay 已验证安装状态中的绝对路径。"
    );
  }
  const trustedExecutable = resolve(trustedInput);
  const timeoutMilliseconds = options.timeoutMilliseconds ?? FFPROBE_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMilliseconds) ||
    timeoutMilliseconds < 1 ||
    timeoutMilliseconds > DEFAULT_TIMEOUT_MS
  ) {
    throw new ControlPlaneServiceError("INVALID_REQUEST", "ffprobe 截止时间无效。");
  }

  return async (executable: string, arguments_: readonly string[]): Promise<unknown> => {
    if (
      typeof executable !== "string" ||
      executable.length === 0 ||
      executable.length > 32_767 ||
      executable.includes("\0") ||
      !isAbsolute(executable) ||
      !sameResolvedPath(executable, trustedExecutable)
    ) {
      throw new ControlPlaneServiceError(
        "INVALID_REQUEST",
        "素材技术检查拒绝了未受信的 ffprobe 路径。"
      );
    }
    const mediaPath = fixedFfprobeMediaPath(arguments_);
    const executableMetadata = await lstat(trustedExecutable);
    if (!executableMetadata.isFile() || executableMetadata.isSymbolicLink()) {
      const error = new Error("Trusted ffprobe path is not a regular file.") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    }
    const canonicalExecutable = await realpath(trustedExecutable);
    if (!sameResolvedPath(canonicalExecutable, trustedExecutable)) {
      throw new ControlPlaneServiceError(
        "INVALID_REQUEST",
        "素材技术检查拒绝了重解析后的 ffprobe 路径。"
      );
    }

    return await new Promise<unknown>((resolvePromise, rejectPromise) => {
      const environment = childEnvironment();
      delete environment.ELECTRON_RUN_AS_NODE;
      const child = spawn(
        canonicalExecutable,
        [...FFPROBE_ARGUMENT_PREFIX, mediaPath],
        {
          cwd: dirname(canonicalExecutable),
          env: environment,
          shell: false,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"]
        }
      );
      const stdout: Buffer[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let settled = false;

      const finish = (error: unknown | null, value?: unknown): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error !== null) rejectPromise(error);
        else resolvePromise(value);
      };
      const failOutputBound = (): void => {
        child.kill();
        finish(fixedFfprobeFailure("ffprobe 输出超过安全上限"));
      };
      const timer = setTimeout(() => {
        child.kill();
        finish(fixedFfprobeFailure(`ffprobe 未能在 ${timeoutMilliseconds} 毫秒内完成`));
      }, timeoutMilliseconds);

      child.stdout.on("data", (chunk: Buffer) => {
        stdoutBytes += chunk.byteLength;
        if (stdoutBytes > FFPROBE_MAX_OUTPUT_BYTES) {
          failOutputBound();
          return;
        }
        stdout.push(chunk);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderrBytes += chunk.byteLength;
        if (stderrBytes > FFPROBE_MAX_OUTPUT_BYTES) failOutputBound();
      });
      child.once("error", (error: Error) => finish(error));
      child.once("close", (exitCode) => {
        if (settled) return;
        if (exitCode !== 0) {
          finish(fixedFfprobeFailure(`ffprobe 未能读取素材，退出码 ${String(exitCode)}`));
          return;
        }
        try {
          const text = Buffer.concat(stdout).toString("utf8").trim();
          if (text.length === 0) throw new Error("empty ffprobe output");
          const value: unknown = JSON.parse(text);
          assertPlainJson(value);
          finish(null, value);
        } catch {
          finish(fixedFfprobeFailure("ffprobe 返回了无效 JSON"));
        }
      });
    });
  };
}

async function runFixedCli(
  entryPoint: string,
  args: readonly string[],
  request: unknown | undefined,
  acceptedExitCodes: ReadonlySet<number> = new Set([0]),
  timeoutMilliseconds = DEFAULT_TIMEOUT_MS
): Promise<unknown> {
  const input = request === undefined ? null : stableJson(request);
  if (input !== null && Buffer.byteLength(input, "utf8") > 131_072) {
    throw new ControlPlaneServiceError("INVALID_REQUEST", "适配器请求过大。");
  }

  return await new Promise<unknown>((resolvePromise, rejectPromise) => {
    let phase: AdapterProcessPhase = "launch";
    const child = spawn(process.execPath, [entryPoint, ...args], {
      cwd: dirname(entryPoint),
      env: childEnvironment(),
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const finish = (error: ControlPlaneServiceError | null, value?: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error !== null) rejectPromise(error);
      else resolvePromise(value);
    };

    const failBound = (): void => {
      child.kill();
      finish(adapterProcessFailure(phase, "适配器输出超过安全上限"));
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(adapterTimeoutFailure(phase, timeoutMilliseconds));
    }, timeoutMilliseconds);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > MAX_OUTPUT_BYTES) {
        failBound();
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > MAX_OUTPUT_BYTES) failBound();
    });
    child.once("error", () => {
      finish(adapterProcessFailure("launch", "适配器无法启动"));
    });
    child.once("spawn", () => {
      phase = input === null ? "execute" : "request";
    });
    child.once("close", (exitCode) => {
      if (settled) return;
      phase = "decode";
      if (exitCode === null || !acceptedExitCodes.has(exitCode)) {
        finish(adapterProcessFailure("execute", `适配器未能完成操作，退出码 ${String(exitCode)}`));
        return;
      }
      try {
        const text = Buffer.concat(stdout).toString("utf8").trim();
        if (text.length === 0) throw new Error("empty");
        const value: unknown = JSON.parse(text);
        assertPlainJson(value);
        finish(null, value);
      } catch {
        finish(adapterProcessFailure("decode", "适配器返回了无效 JSON"));
      }
    });
    child.stdin.on("error", () => {
      finish(adapterProcessFailure("request", "适配器请求写入失败"));
    });
    if (input === null) child.stdin.end();
    else child.stdin.end(input, "utf8");
  });
}

async function runFixedStreamAUtility(
  wrapperEntryPoint: string,
  command: StreamACommand,
  requestPath: string,
  acceptedExitCodes: ReadonlySet<number>,
  timeoutMilliseconds: number
): Promise<unknown> {
  const requestId = createHash("sha256")
    .update(`${process.pid}\0${command}\0${requestPath}`, "utf8")
    .digest("hex")
    .slice(0, 32);
  return await new Promise<unknown>((resolvePromise, rejectPromise) => {
    let settled = false;
    let requestSent = false;
    let phase: AdapterProcessPhase = "launch";
    const environment = childEnvironment();
    delete environment.ELECTRON_RUN_AS_NODE;
    const child = utilityProcess.fork(wrapperEntryPoint, [], {
      cwd: dirname(wrapperEntryPoint),
      env: environment,
      stdio: ["ignore", "ignore", "ignore"],
      partition: ADAPTER_SESSION_PARTITION,
      serviceName: "MiniMax H3 Local Adapter"
    });
    const finish = (error: ControlPlaneServiceError | null, value?: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      if (error !== null) rejectPromise(error);
      else resolvePromise(value);
    };
    const timer = setTimeout(() => {
      finish(adapterTimeoutFailure(phase, timeoutMilliseconds));
    }, timeoutMilliseconds);
    child.once("spawn", () => {
      phase = "request";
    });
    child.once("error", () => {
      finish(adapterProcessFailure("launch", "适配器无法启动"));
    });
    child.on("message", (value: unknown) => {
      if (settled) return;
      phase = "decode";
      try {
        const response = closedRecord(
          value,
          [
            "protocol",
            "ready",
            "request_id",
            "ok",
            "stage",
            "exit_code",
            "stdout_bytes",
            "stderr_bytes",
            "error_code",
            "module_basename",
            "value"
          ],
          "UtilityProcess 响应"
        );
        if (
          response.protocol === STREAM_A_UTILITY_PROTOCOL &&
          response.ready === true &&
          Object.keys(response).length === 2
        ) {
          if (requestSent) {
            finish(adapterProcessFailure("decode", "适配器重复就绪"));
            return;
          }
          phase = "request";
          try {
            child.postMessage({
              protocol: STREAM_A_UTILITY_PROTOCOL,
              request_id: requestId,
              command,
              request_path: requestPath
            });
            requestSent = true;
            phase = "execute";
          } catch {
            finish(adapterProcessFailure("request", "适配器请求通道不可用"));
          }
          return;
        }
        if (
          response.protocol !== STREAM_A_UTILITY_PROTOCOL ||
          response.request_id !== requestId ||
          !requestSent
        ) {
          finish(adapterProcessFailure("decode", "适配器消息身份无效"));
          return;
        }
        if (response.ok === false) {
          const responsePhase = response.stage === "request" ? "request" : "execute";
          const stdoutBytes = response.stdout_bytes ?? 0;
          const stderrBytes = response.stderr_bytes ?? 0;
          const errorCode = response.error_code ?? "UTILITY_WRAPPER.UNKNOWN";
          const moduleBasename = response.module_basename ?? null;
          if (
            (response.stage !== "request" && response.stage !== "execute") ||
            typeof stdoutBytes !== "number" ||
            !Number.isSafeInteger(stdoutBytes) ||
            stdoutBytes < 0 ||
            stdoutBytes > MAX_OUTPUT_BYTES ||
            typeof stderrBytes !== "number" ||
            !Number.isSafeInteger(stderrBytes) ||
            stderrBytes < 0 ||
            stderrBytes > MAX_OUTPUT_BYTES ||
            typeof errorCode !== "string" ||
            !/^[A-Z][A-Z0-9_.-]{1,95}$/u.test(errorCode) ||
            (moduleBasename !== null && (
              typeof moduleBasename !== "string" ||
              !/^[A-Za-z0-9._-]{1,120}$/u.test(moduleBasename)
            ))
          ) {
            finish(adapterProcessFailure("decode", "适配器失败响应无效"));
            return;
          }
          const moduleDetail = moduleBasename === null ? "" : `，模块 ${moduleBasename}`;
          finish(localRuntimeProcessFailure(responsePhase, errorCode, moduleDetail));
          return;
        }
        if (
          response.ok !== true ||
          typeof response.exit_code !== "number" ||
          !Number.isSafeInteger(response.exit_code) ||
          !acceptedExitCodes.has(response.exit_code) ||
          typeof response.stdout_bytes !== "number" ||
          !Number.isSafeInteger(response.stdout_bytes) ||
          response.stdout_bytes <= 0 ||
          response.stdout_bytes > MAX_OUTPUT_BYTES ||
          typeof response.stderr_bytes !== "number" ||
          !Number.isSafeInteger(response.stderr_bytes) ||
          response.stderr_bytes < 0 ||
          response.stderr_bytes > MAX_OUTPUT_BYTES ||
          !("value" in response)
        ) {
          finish(adapterProcessFailure("decode", "适配器消息响应无效"));
          return;
        }
        assertPlainJson(response.value, "UtilityProcess 结果");
        finish(null, response.value);
      } catch {
        finish(adapterProcessFailure("decode", "适配器消息无法解码"));
      }
    });
    child.once("exit", (code) => {
      if (settled) return;
      finish(adapterProcessFailure("execute", `适配器在返回消息前退出，退出码 ${String(code)}`));
    });
  });
}

async function runFixedStreamBUtility(
  wrapperEntryPoint: string,
  projectPath: string,
  outputDirectory: string,
  timeoutMilliseconds = DEFAULT_TIMEOUT_MS
): Promise<unknown> {
  const requestId = createHash("sha256")
    .update(`${process.pid}\0compile\0${projectPath}\0${outputDirectory}`, "utf8")
    .digest("hex")
    .slice(0, 32);
  return await new Promise<unknown>((resolvePromise, rejectPromise) => {
    let settled = false;
    let requestSent = false;
    let exitDrainTimer: ReturnType<typeof setTimeout> | null = null;
    let phase: AdapterProcessPhase = "launch";
    const environment = childEnvironment();
    delete environment.ELECTRON_RUN_AS_NODE;
    const child = utilityProcess.fork(wrapperEntryPoint, [], {
      cwd: dirname(wrapperEntryPoint),
      env: environment,
      stdio: ["ignore", "ignore", "ignore"],
      partition: ADAPTER_SESSION_PARTITION,
      serviceName: "MiniMax H3 Workflow Compiler"
    });
    const finish = (error: ControlPlaneServiceError | null, value?: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (exitDrainTimer !== null) clearTimeout(exitDrainTimer);
      child.kill();
      if (error !== null) rejectPromise(error);
      else resolvePromise(value);
    };
    const timer = setTimeout(() => {
      finish(adapterTimeoutFailure(phase, timeoutMilliseconds));
    }, timeoutMilliseconds);
    child.once("spawn", () => {
      phase = "request";
    });
    child.once("error", () => {
      finish(adapterProcessFailure("launch", "工作流编译适配器无法启动"));
    });
    child.on("message", (value: unknown) => {
      if (settled) return;
      phase = "decode";
      try {
        const response = closedRecord(
          value,
          [
            "protocol",
            "ready",
            "request_id",
            "ok",
            "stage",
            "exit_code",
            "stdout_bytes",
            "stderr_bytes",
            "error_code",
            "error_reason",
            "module_basename",
            "value"
          ],
          "工作流编译 UtilityProcess 响应"
        );
        if (
          response.protocol === STREAM_B_UTILITY_PROTOCOL &&
          response.ready === true &&
          Object.keys(response).length === 2
        ) {
          if (requestSent) {
            finish(adapterProcessFailure("decode", "工作流编译适配器重复就绪"));
            return;
          }
          phase = "request";
          try {
            child.postMessage({
              protocol: STREAM_B_UTILITY_PROTOCOL,
              request_id: requestId,
              command: "compile",
              project_path: projectPath,
              output_directory: outputDirectory
            });
            requestSent = true;
            phase = "execute";
          } catch {
            finish(adapterProcessFailure("request", "工作流编译请求通道不可用"));
          }
          return;
        }
        if (
          response.protocol !== STREAM_B_UTILITY_PROTOCOL ||
          response.request_id !== requestId ||
          !requestSent
        ) {
          finish(adapterProcessFailure("decode", "工作流编译消息身份无效"));
          return;
        }
        if (response.ok === false) {
          const responsePhase = response.stage === "request" ? "request" : "execute";
          const stdoutBytes = response.stdout_bytes ?? 0;
          const stderrBytes = response.stderr_bytes ?? 0;
          const errorCode = response.error_code ?? "WORKFLOW_WRAPPER.UNKNOWN";
          const errorReason = response.error_reason ?? null;
          const moduleBasename = response.module_basename ?? null;
          if (
            (response.stage !== "request" && response.stage !== "execute") ||
            typeof stdoutBytes !== "number" ||
            !Number.isSafeInteger(stdoutBytes) ||
            stdoutBytes < 0 ||
            stdoutBytes > MAX_OUTPUT_BYTES ||
            typeof stderrBytes !== "number" ||
            !Number.isSafeInteger(stderrBytes) ||
            stderrBytes < 0 ||
            stderrBytes > MAX_OUTPUT_BYTES ||
            typeof errorCode !== "string" ||
            !/^[A-Z][A-Z0-9_.-]{1,95}$/u.test(errorCode) ||
            (errorReason !== null && (
              typeof errorReason !== "string" ||
              !/^[A-Z][A-Z0-9_]{1,95}$/u.test(errorReason)
            )) ||
            (moduleBasename !== null && (
              typeof moduleBasename !== "string" ||
              !/^[A-Za-z0-9._-]{1,120}$/u.test(moduleBasename)
            ))
          ) {
            finish(adapterProcessFailure("decode", "工作流编译失败响应无效"));
            return;
          }
          const moduleDetail = moduleBasename === null ? "" : `，模块 ${moduleBasename}`;
          finish(compilerProcessFailure(responsePhase, errorCode, moduleDetail, errorReason));
          return;
        }
        if (
          response.ok !== true ||
          response.exit_code !== 0 ||
          typeof response.stdout_bytes !== "number" ||
          !Number.isSafeInteger(response.stdout_bytes) ||
          response.stdout_bytes <= 0 ||
          response.stdout_bytes > MAX_OUTPUT_BYTES ||
          typeof response.stderr_bytes !== "number" ||
          !Number.isSafeInteger(response.stderr_bytes) ||
          response.stderr_bytes < 0 ||
          response.stderr_bytes > MAX_OUTPUT_BYTES ||
          !("value" in response)
        ) {
          finish(adapterProcessFailure("decode", "工作流编译消息响应无效"));
          return;
        }
        assertPlainJson(response.value, "工作流编译 UtilityProcess 结果");
        finish(null, response.value);
      } catch {
        finish(adapterProcessFailure("decode", "工作流编译消息无法解码"));
      }
    });
    child.once("exit", (code) => {
      if (settled) return;
      exitDrainTimer = setTimeout(() => {
        finish(adapterProcessFailure(
          "execute",
          `工作流编译适配器在返回消息前退出，退出码 ${String(code)}`
        ));
      }, 500);
    });
  });
}

function closedRecord(
  value: unknown,
  fields: readonly string[],
  label: string
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ControlPlaneServiceError("ADAPTER_FAILED", `${label} 格式无效。`);
  }
  const record = value as Record<string, unknown>;
  const allowed = new Set(fields);
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new ControlPlaneServiceError("ADAPTER_FAILED", `${label} 包含未知字段。`);
  }
  return record;
}

function unwrapResult(value: unknown): unknown {
  const envelope = closedRecord(value, ["ok", "result"], "适配器响应");
  if (envelope.ok !== true || !("result" in envelope)) {
    throw new ControlPlaneServiceError("ADAPTER_FAILED", "适配器拒绝了请求。");
  }
  return envelope.result;
}

function finiteGiB(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_024) {
    throw new ControlPlaneServiceError("ADAPTER_FAILED", "适配器容量字段无效。");
  }
  return value;
}

const COMPONENT_IDS = new Set<ComponentId>([
  "fl2va_base",
  "turbo_acceleration_recommended",
  "ref2va_optional",
  "pyav_required",
  "ffmpeg_long_video_optional",
  "comfyui_desktop_optional"
]);

function parseComponent(value: unknown): ComponentScanResult {
  const item = closedRecord(
    value,
    ["id", "title", "description", "required", "selected", "state", "sizeGiB"],
    "组件扫描结果"
  );
  if (
    typeof item.id !== "string" ||
    !COMPONENT_IDS.has(item.id as ComponentId) ||
    typeof item.title !== "string" ||
    item.title.length > 80 ||
    typeof item.description !== "string" ||
    item.description.length > 240 ||
    typeof item.required !== "boolean" ||
    typeof item.selected !== "boolean" ||
    (item.state !== "verified_reuse" &&
      item.state !== "found_unverified" &&
      item.state !== "needs_download")
  ) {
    throw new ControlPlaneServiceError("ADAPTER_FAILED", "组件扫描结果字段无效。");
  }
  return Object.freeze({
    id: item.id as ComponentId,
    title: item.title,
    description: item.description,
    required: item.required,
    selected: item.selected,
    state: item.state,
    sizeGiB: finiteGiB(item.sizeGiB)
  });
}

function bytesAsGiB(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ControlPlaneServiceError("ADAPTER_FAILED", "适配器容量字段无效。");
  }
  return Math.round((value / 1024 ** 3) * 10) / 10;
}

function streamAGpuLabel(gpus: unknown): string {
  if (!Array.isArray(gpus) || gpus.length === 0) return "未发现受支持的 GPU";
  const gpu = gpus[0];
  if (typeof gpu !== "object" || gpu === null || Array.isArray(gpu)) return "GPU 信息不可用";
  const sources = (gpu as Record<string, unknown>).sources;
  if (!Array.isArray(sources)) return "GPU 信息不可用";
  for (const source of sources) {
    if (typeof source === "object" && source !== null && !Array.isArray(source)) {
      const productName = (source as Record<string, unknown>).product_name;
      if (typeof productName === "string" && productName.length > 0 && productName.length <= 160) {
        return productName;
      }
    }
  }
  return "GPU 信息不可用";
}

interface ParsedStreamAScan {
  readonly result: ScanInstallationResult;
  readonly vramBytes: number | null;
}

function optionalLocalUiPath(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    value.length < 3 ||
    value.length > 240 ||
    !/^[A-Za-z]:\\/u.test(value) ||
    value.startsWith("\\\\?\\") ||
    value.startsWith("\\\\.\\") ||
    /(?:^|\\)\.\.?(?:\\|$)/u.test(value) ||
    value.includes("\0")
  ) {
    throw new ControlPlaneServiceError("ADAPTER_FAILED", `${label} 路径无效。`);
  }
  return value;
}

function parseStreamAUiLocations(value: unknown): ScanDetectedLocations {
  const result = closedRecord(
    value,
    ["response_version", "sensitivity", "locations", "inspection"],
    "Stream A 本机位置结果"
  );
  const locations = closedRecord(result.locations, ["comfy", "models"], "Stream A 本机位置");
  const comfy = closedRecord(
    locations.comfy,
    ["source", "root_path", "topology"],
    "Stream A ComfyUI 位置"
  );
  const models = closedRecord(
    locations.models,
    ["source", "root_path", "recognized_asset_count", "expected_asset_count", "recognized_roles"],
    "Stream A 模型位置"
  );
  const inspection = closedRecord(
    result.inspection,
    [
      "bounded",
      "deadline_milliseconds",
      "deadline_exceeded",
      "max_candidate_roots",
      "inspected_comfy_root_count",
      "inspected_model_root_count",
      "recursive_scan",
      "custom_nodes_imported",
      "model_content_hashed",
      "network_called"
    ],
    "Stream A 本机位置检查"
  );
  const sources = new Set(["explicit", "detected", "missing"]);
  if (
    result.response_version !== "1.0.0" ||
    result.sensitivity !== "local_ui_only_do_not_log_or_export" ||
    typeof comfy.source !== "string" ||
    !sources.has(comfy.source) ||
    (comfy.topology !== null && comfy.topology !== "portable" && comfy.topology !== "core") ||
    typeof models.source !== "string" ||
    !sources.has(models.source) ||
    typeof models.recognized_asset_count !== "number" ||
    !Number.isSafeInteger(models.recognized_asset_count) ||
    models.recognized_asset_count < 0 ||
    typeof models.expected_asset_count !== "number" ||
    !Number.isSafeInteger(models.expected_asset_count) ||
    models.expected_asset_count <= 0 ||
    models.recognized_asset_count > models.expected_asset_count ||
    !Array.isArray(models.recognized_roles) ||
    models.recognized_roles.some((role) => typeof role !== "string" || role.length === 0 || role.length > 80) ||
    inspection.bounded !== true ||
    inspection.recursive_scan !== false ||
    inspection.custom_nodes_imported !== false ||
    inspection.model_content_hashed !== false ||
    inspection.network_called !== false ||
    typeof inspection.deadline_exceeded !== "boolean" ||
    ![
      inspection.deadline_milliseconds,
      inspection.max_candidate_roots,
      inspection.inspected_comfy_root_count,
      inspection.inspected_model_root_count
    ].every((item) => typeof item === "number" && Number.isSafeInteger(item) && item >= 0)
  ) {
    throw new ControlPlaneServiceError("ADAPTER_FAILED", "Stream A 本机位置结果未通过闭合校验。");
  }
  const comfyUiRoot = optionalLocalUiPath(comfy.root_path, "ComfyUI");
  const modelRoot = optionalLocalUiPath(models.root_path, "模型");
  if (
    (comfy.source === "missing") !== (comfyUiRoot === null) ||
    (models.source === "missing") !== (modelRoot === null) ||
    (comfyUiRoot === null && comfy.topology !== null) ||
    (modelRoot === null && models.recognized_asset_count !== 0)
  ) {
    throw new ControlPlaneServiceError("ADAPTER_FAILED", "Stream A 本机位置状态与路径不一致。");
  }
  return Object.freeze({
    comfyUiRoot,
    modelRoot,
    comfySource: comfy.source as ScanDetectedLocations["comfySource"],
    modelSource: models.source as ScanDetectedLocations["modelSource"]
  });
}

function streamAVramBytes(gpus: unknown): number | null {
  if (!Array.isArray(gpus)) return null;
  let largest: number | null = null;
  for (const gpu of gpus) {
    if (typeof gpu !== "object" || gpu === null || Array.isArray(gpu)) continue;
    const sources = (gpu as Record<string, unknown>).sources;
    if (!Array.isArray(sources)) continue;
    for (const source of sources) {
      if (typeof source !== "object" || source === null || Array.isArray(source)) continue;
      const value = (source as Record<string, unknown>).vram_bytes;
      if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
        largest = largest === null ? value : Math.max(largest, value);
      }
    }
  }
  return largest;
}

function parseStreamAScan(
  value: unknown,
  expectedRoot: string,
  locations: ScanDetectedLocations
): ParsedStreamAScan {
  const result = closedRecord(
    value,
    [
      "response_version",
      "evidence_mode",
      "redacted",
      "authority",
      "hardware",
      "storage",
      "comfy",
      "models",
      "component_install_plan",
      "attach_plan",
      "plan_digest"
    ],
    "Stream A 扫描结果"
  );
  const hardware = closedRecord(
    result.hardware,
    ["probe_status", "system", "volumes", "gpus", "failures"],
    "Stream A 硬件结果"
  );
  const system = closedRecord(
    hardware.system,
    ["platform", "architecture", "logical_processor_count", "system_ram_bytes"],
    "Stream A 系统结果"
  );
  const storage = closedRecord(result.storage, ["managed_root"], "Stream A 存储结果");
  const managedRoot = closedRecord(
    storage.managed_root,
    ["status", "reason", "source", "display_path", "path_ref", "silent_c_fallback"],
    "Stream A 安装根结果"
  );
  const comfy = closedRecord(
    result.comfy,
    ["discovery_scope", "installations", "attach_candidate_count"],
    "Stream A ComfyUI 结果"
  );
  const models = closedRecord(
    result.models,
    [
      "profile_id",
      "profile_status",
      "expected_asset_count",
      "verified_asset_count",
      "all_five_byte_identities_verified",
      "assets",
      "totals",
      "missing_file_download_plan",
      "selection_authority"
    ],
    "Stream A 模型结果"
  );
  const totals = closedRecord(
    models.totals,
    [
      "reuse_download_bytes",
      "avoided_download_bytes",
      "pending_verification_bytes",
      "missing_download_bytes"
    ],
    "Stream A 模型容量"
  );
  if (
    result.response_version !== "1.0.0" ||
    result.redacted !== true ||
    system.platform !== "win32" ||
    typeof system.architecture !== "string" ||
    typeof system.system_ram_bytes !== "number" ||
    typeof managedRoot.display_path !== "string" ||
    managedRoot.silent_c_fallback !== false ||
    !Array.isArray(comfy.installations) ||
    typeof models.all_five_byte_identities_verified !== "boolean"
  ) {
    throw new ControlPlaneServiceError("ADAPTER_FAILED", "Stream A 扫描结果未通过闭合校验。");
  }

  const verifiedReuseGiB = bytesAsGiB(totals.avoided_download_bytes);
  const pendingVerificationGiB = bytesAsGiB(totals.pending_verification_bytes ?? 0);
  const requiredDownloadGiB = bytesAsGiB(totals.missing_download_bytes);
  const allModelsVerified = models.all_five_byte_identities_verified;
  const foundRoles = new Set<string>();
  const verifiedRoles = new Set<string>();
  const roleSizes = new Map<string, number>();
  if (Array.isArray(models.assets)) {
    for (const value of models.assets) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
      const asset = value as Record<string, unknown>;
      const progression = asset.progression;
      if (
        typeof asset.role !== "string" ||
        typeof asset.expected_byte_length !== "number" ||
        !Number.isSafeInteger(asset.expected_byte_length) ||
        asset.expected_byte_length <= 0 ||
        typeof progression !== "object" ||
        progression === null ||
        Array.isArray(progression)
      ) continue;
      roleSizes.set(asset.role, asset.expected_byte_length);
      const progressionRecord = progression as Record<string, unknown>;
      if (progressionRecord.found === true && progressionRecord.identified === true) {
        foundRoles.add(asset.role);
      }
      if (progressionRecord.verified === true) verifiedRoles.add(asset.role);
    }
  }
  const baseRoles = ["fl2va_diffusion", "qwen_text_encoder", "video_vae", "audio_vae"];
  const turboRole = "fl2va_turbo_8step_lora";
  const baseVerified = baseRoles.every((role) => verifiedRoles.has(role)) || allModelsVerified;
  const baseFound = baseRoles.every((role) => foundRoles.has(role));
  const turboVerified = verifiedRoles.has(turboRole) || allModelsVerified;
  const turboFound = foundRoles.has(turboRole);
  const turboSizeGiB = bytesAsGiB(roleSizes.get(turboRole) ?? 1_956_193_000);
  const baseSizeGiB = baseRoles.every((role) => roleSizes.has(role))
    ? bytesAsGiB(baseRoles.reduce((sum, role) => sum + (roleSizes.get(role) ?? 0), 0))
    : Math.max(0, verifiedReuseGiB + requiredDownloadGiB - turboSizeGiB);
  let existingComfyUi = "未发现可附加的 ComfyUI";
  const firstInstallation = comfy.installations[0];
  if (typeof firstInstallation === "object" && firstInstallation !== null && !Array.isArray(firstInstallation)) {
    const displayRoot = (firstInstallation as Record<string, unknown>).display_root;
    if (typeof displayRoot === "string" && displayRoot.length > 0 && displayRoot.length <= 240) {
      existingComfyUi = displayRoot;
    }
  }
  const memoryGiB = Math.round((system.system_ram_bytes / 1024 ** 3) * 10) / 10;
  const vramBytes = streamAVramBytes(hardware.gpus);
  const components = normalizeInstallationComponents([
    Object.freeze({
      id: "fl2va_base",
      title: "FL2VA 基础包",
      description: "Comfy-Org MiniMax-H3 原始文件；国内优先走 ModelScope 中国 CDN，失败后自动回退 Hugging Face，并强制校验大小与 SHA-256。",
      required: true,
      selected: true,
      state: baseVerified ? "verified_reuse" : baseFound ? "found_unverified" : "needs_download",
      sizeGiB: baseSizeGiB
    }),
    Object.freeze({
      id: "turbo_acceleration_recommended",
      title: "Turbo 加速权重（硬件配方推荐）",
      description: "Comfy-Org FL2V Turbo 权重；国内源优先、Hugging Face 备用，并强制校验大小与 SHA-256；不会启用未知加速节点。",
      required: false,
      selected: true,
      state: turboVerified ? "verified_reuse" : turboFound ? "found_unverified" : "needs_download",
      sizeGiB: turboSizeGiB
    }),
    Object.freeze({
      id: "ref2va_optional",
      title: "Ref2VA 可选包",
      description: "Comfy-Org Ref2VA 权重；国内源优先、Hugging Face 备用；当前认证工作流仅接入 1–2 张参考图片，不接入参考视频或声音。",
      required: false,
      selected: false,
      // The attach scan verifies only the five FL2VA profile assets. Merely
      // finding ComfyUI is not evidence that the optional Ref2VA weights exist.
      // The install plan performs the authoritative full SHA-256 reuse check
      // after the user explicitly selects this component.
      state: "needs_download",
      sizeGiB: 19.5
    }),
    Object.freeze({
      id: "pyav_required",
      title: "PyAV（随 ComfyUI 提供）",
      description: "随 Comfy-Org 官方 ComfyUI v0.34.0 运行环境提供，不要求全局安装。",
      required: true,
      selected: true,
      state: locations.comfyUiRoot === null ? "needs_download" : "found_unverified",
      sizeGiB: 0.1
    }),
    Object.freeze({
      id: "ffmpeg_long_video_optional",
      title: "FFmpeg（素材检查与封面选配）",
      description: "FFmpeg 官网列出的 BtbN 固定 Windows 构建；用于本地视频/音频的时长与编解码检查，并在可用时提取视频封面；不参与 H3 采样或分段拼接。",
      required: false,
      selected: false,
      state: "needs_download",
      sizeGiB: 0.2
    }),
    Object.freeze({
      id: "comfyui_desktop_optional",
      title: "ComfyUI Desktop / 现有 ComfyUI",
      description: locations.comfyUiRoot === null
        ? "未配置可交接的 ComfyUI；将下载并校验 Comfy 官方 Desktop 安装包。"
        : "已保存并静态复核现有 ComfyUI，工作流将直接交接到该环境。",
      required: true,
      selected: true,
      state: locations.comfyUiRoot === null ? "needs_download" : "verified_reuse",
      sizeGiB: 0.2
    })
  ]);

  return Object.freeze({
    result: Object.freeze({
      source: "stream_a_cli",
      installRoot: expectedRoot,
      locations,
      system: Object.freeze({
        windows: `Windows · ${system.architecture}`,
        gpu: streamAGpuLabel(hardware.gpus),
        vramBytes,
        memory: `${memoryGiB} GB`,
        targetVolume: managedRoot.display_path
      }),
      attachPlan: Object.freeze({
        mode: "attach_only",
        existingComfyUi,
        mutatesExistingInstance: false
      }),
      verifiedReuseGiB,
      pendingVerificationGiB,
      requiredDownloadGiB,
      components
    }),
    vramBytes
  });
}

interface A3PlanEntry {
  readonly artifactId: string;
  readonly action: "download" | "reuse_managed" | "extract_downloaded_archive" | "reuse_external_read_only";
  readonly kind: string;
  readonly expectedByteLength: number;
  readonly downloadBytes: number;
}

interface InstallationContext {
  readonly operationId: string;
  readonly managedRoot: string;
  readonly components: readonly A3Component[];
  readonly publicComponents: readonly ComponentId[];
  readonly existingModelRoots: readonly string[];
  readonly vramBytes: number | null;
  readonly entries: readonly A3PlanEntry[];
  readonly launchRoot: string;
  launchPlan: ValidatedLaunchPlan | null;
  lastState: InstallationStatusResult["state"] | "planned";
  lastResult: InstallationStatusResult | null;
}

const A3_COMPONENTS = new Set<A3Component>([
  "comfy-portable",
  "comfy-desktop",
  "ffmpeg-managed",
  "fl2va-base",
  "ref2va-addon",
  "fl2v-turbo",
  "ref2v-turbo"
]);
const A3_ENTRY_COMPONENTS = new Set<string>([
  ...A3_COMPONENTS,
  "shared-h3-base"
]);
const RESTORABLE_PUBLIC_COMPONENTS: ReadonlySet<string> = new Set([
  "fl2va_base",
  "turbo_acceleration_recommended",
  "ref2va_optional",
  "pyav_required",
  "ffmpeg_long_video_optional",
  "comfyui_desktop_optional"
]);

function requireRestoredComponents(value: readonly ComponentId[]): readonly ComponentId[] {
  if (
    !Array.isArray(value) ||
    value.length > RESTORABLE_PUBLIC_COMPONENTS.size ||
    value.some((component) =>
      typeof component !== "string" || !RESTORABLE_PUBLIC_COMPONENTS.has(component)
    ) ||
    new Set(value).size !== value.length ||
    !value.includes("fl2va_base") ||
    !value.includes("pyav_required")
  ) {
    throw new ControlPlaneServiceError("INVALID_REQUEST", "已验证安装能力集合无效。");
  }
  return Object.freeze([...value]);
}

function requireOperationId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9_-]{7,95}$/u.test(value)) {
    throw new ControlPlaneServiceError("ADAPTER_FAILED", "A3 安装 operation_id 无效。");
  }
  return value;
}

function sameResolvedPath(left: string, right: string): boolean {
  return resolve(left).toLocaleLowerCase("en-US") === resolve(right).toLocaleLowerCase("en-US");
}

function parseLaunchPlan(value: unknown, managedRoot: string): ValidatedLaunchPlan | null {
  const plan = closedRecord(
    value,
    [
      "status",
      "hardware_profile",
      "experimental",
      "executable",
      "args",
      "cwd",
      "loopback_only",
      "api_nodes_disabled",
      "all_custom_nodes_disabled",
      "started",
      "prompt_submitted",
      "queue_submitted"
    ],
    "A3 ComfyUI launch_plan"
  );
  if (
    (plan.status !== "ready_after_install" && plan.status !== "blocked") ||
    typeof plan.hardware_profile !== "string" ||
    typeof plan.experimental !== "boolean" ||
    typeof plan.executable !== "string" ||
    !isAbsolute(plan.executable) ||
    !Array.isArray(plan.args) ||
    typeof plan.cwd !== "string" ||
    !isAbsolute(plan.cwd) ||
    plan.loopback_only !== true ||
    plan.api_nodes_disabled !== true ||
    plan.all_custom_nodes_disabled !== true ||
    plan.started !== false ||
    plan.prompt_submitted !== false ||
    plan.queue_submitted !== false
  ) {
    throw new ControlPlaneServiceError("ADAPTER_FAILED", "A3 launch_plan 安全边界无效。");
  }
  const root = resolve(managedRoot);
  const executable = resolve(plan.executable);
  const cwd = resolve(plan.cwd);
  const expectedPortable = resolve(root, "runtime", "ComfyUI_windows_portable");
  const expectedExecutable = resolve(expectedPortable, "python_embeded", "python.exe");
  const expectedCwd = resolve(expectedPortable, "ComfyUI");
  const expectedMain = resolve(expectedCwd, "main.py");
  if (
    !isContainedOrEqual(root, executable) ||
    !isContainedOrEqual(root, cwd) ||
    !sameResolvedPath(executable, expectedExecutable) ||
    !sameResolvedPath(cwd, expectedCwd)
  ) {
    throw new ControlPlaneServiceError("ADAPTER_FAILED", "A3 launch_plan 越过 managed root。");
  }
  const args = plan.args.map((item) => {
    if (typeof item !== "string" || item.length === 0 || item.length > 320 || item.includes("\0")) {
      throw new ControlPlaneServiceError("ADAPTER_FAILED", "A3 launch_plan 参数无效。");
    }
    return item;
  });
  const fixedPrefix = [
    expectedMain,
    "--listen",
    "127.0.0.1",
    "--port",
    "8188",
    "--disable-auto-launch",
    "--disable-api-nodes",
    "--disable-all-custom-nodes"
  ];
  if (
    args.length < fixedPrefix.length ||
    !fixedPrefix.every((item, index) => index === 0
      ? sameResolvedPath(args[index] ?? "", item)
      : args[index] === item)
  ) {
    throw new ControlPlaneServiceError("ADAPTER_FAILED", "A3 launch_plan 不是固定 loopback ComfyUI 启动参数。");
  }
  let tail = args.slice(fixedPrefix.length);
  const profile = plan.hardware_profile;
  const expectedMemoryArgs = profile === "preferred_24gb_plus"
    ? ["--reserve-vram", "2"]
    : profile === "experimental_16gb_class"
      ? ["--lowvram", "--reserve-vram", "2", "--async-offload"]
      : profile === "unknown_blocked" || profile === "below_16gb_class_blocked"
        ? []
        : null;
  if (
    expectedMemoryArgs === null ||
    plan.experimental !== (profile === "experimental_16gb_class") ||
    expectedMemoryArgs.some((item, index) => tail[index] !== item)
  ) {
    throw new ControlPlaneServiceError("ADAPTER_FAILED", "A3 launch_plan 硬件配方参数无效。");
  }
  tail = tail.slice(expectedMemoryArgs.length);
  if (tail.length === 2 && tail[0] === "--extra-model-paths-config") {
    const expectedConfig = resolve(root, ".minimax-h3", "extra_model_paths.yaml");
    if (!isAbsolute(tail[1] ?? "") || !sameResolvedPath(tail[1] ?? "", expectedConfig)) {
      throw new ControlPlaneServiceError("ADAPTER_FAILED", "A3 launch_plan 外部模型配置路径无效。");
    }
    tail = [];
  }
  if (tail.length !== 0) {
    throw new ControlPlaneServiceError("ADAPTER_FAILED", "A3 launch_plan 包含非固定参数。");
  }
  if (
    (plan.status === "ready_after_install") !==
      (profile === "preferred_24gb_plus" || profile === "experimental_16gb_class")
  ) {
    throw new ControlPlaneServiceError("ADAPTER_FAILED", "A3 launch_plan 硬件状态不一致。");
  }
  if (plan.status === "blocked") return null;
  return Object.freeze({
    executable,
    args: Object.freeze(args),
    workingDirectory: cwd
  });
}

function createExternalPortableLaunchPlan(
  root: string,
  managedRoot: string
): ValidatedLaunchPlan | null {
  const executable = [
    resolve(root, "python_embeded", "python.exe"),
    resolve(root, "python_embedded", "python.exe")
  ].find((candidate) => existsSync(candidate));
  if (executable === undefined) return null;
  const workingDirectory = resolve(root, "ComfyUI");
  return Object.freeze({
    executable,
    workingDirectory,
    args: Object.freeze([
      resolve(workingDirectory, "main.py"),
      "--listen",
      "127.0.0.1",
      "--port",
      "8188",
      "--disable-auto-launch",
      "--disable-api-nodes",
      "--disable-all-custom-nodes",
      "--extra-model-paths-config",
      resolve(managedRoot, ".minimax-h3", "extra_model_paths.yaml")
    ])
  });
}

function isContainedOrEqual(root: string, candidate: string): boolean {
  if (root.toLocaleLowerCase("en-US") === candidate.toLocaleLowerCase("en-US")) return true;
  return containedPath(root, candidate);
}

async function launchPlanFilesystemIsSafe(
  context: Pick<InstallationContext, "launchRoot" | "launchPlan">
): Promise<boolean> {
  const plan = context.launchPlan;
  if (plan === null) return false;
  try {
    const [rootMetadata, executableMetadata, cwdMetadata, mainMetadata] = await Promise.all([
      lstat(context.launchRoot),
      lstat(plan.executable),
      lstat(plan.workingDirectory),
      lstat(plan.args[0] ?? "")
    ]);
    const [rootIdentity, executableIdentity, cwdIdentity, mainIdentity] = await Promise.all([
      realpath(context.launchRoot),
      realpath(plan.executable),
      realpath(plan.workingDirectory),
      realpath(plan.args[0] ?? "")
    ]);
    const root = resolve(context.launchRoot);
    return (
      rootMetadata.isDirectory() &&
      !rootMetadata.isSymbolicLink() &&
      sameResolvedPath(rootIdentity, root) &&
      executableMetadata.isFile() &&
      !executableMetadata.isSymbolicLink() &&
      cwdMetadata.isDirectory() &&
      !cwdMetadata.isSymbolicLink() &&
      mainMetadata.isFile() &&
      !mainMetadata.isSymbolicLink() &&
      isContainedOrEqual(rootIdentity, executableIdentity) &&
      isContainedOrEqual(rootIdentity, cwdIdentity) &&
      isContainedOrEqual(rootIdentity, mainIdentity)
    );
  } catch {
    return false;
  }
}

function parseInstallPlan(
  value: unknown,
  request: PrepareInstallationRequest,
  components: readonly A3Component[],
  existingModelRoots: readonly string[],
  externalComfyRoot: string | null,
  vramBytes: number | null
): { readonly result: PrepareInstallationResult; readonly context: InstallationContext } {
  const plan = closedRecord(
    value,
    [
      "schema_version",
      "operation_id",
      "managed_root",
      "selected_components",
      "catalog_id",
      "entries",
      "totals",
      "required_acknowledgements",
      "execution_authorized",
      "launch_plan"
    ],
    "A3 安装计划"
  );
  const operationId = requireOperationId(plan.operation_id);
  const selectedComponents = plan.selected_components;
  if (
    plan.schema_version !== "1.0.0" ||
    typeof plan.managed_root !== "string" ||
    !sameResolvedPath(plan.managed_root, request.installRoot) ||
    !Array.isArray(selectedComponents) ||
    selectedComponents.length !== components.length ||
    !components.every((component, index) => selectedComponents[index] === component) ||
    typeof plan.catalog_id !== "string" ||
    plan.catalog_id.length === 0 ||
    plan.catalog_id.length > 160 ||
    !Array.isArray(plan.entries) ||
    plan.entries.length === 0 ||
    plan.entries.length > 64 ||
    typeof plan.execution_authorized !== "boolean"
  ) {
    throw new ControlPlaneServiceError("ADAPTER_FAILED", "A3 安装计划未通过闭合校验。");
  }
  const entries = Object.freeze(plan.entries.map((value) => {
    const entry = closedRecord(
      value,
      [
        "artifact_id",
        "component",
        "kind",
        "role",
        "action",
        "destination_relative_path",
        "expected_byte_length",
        "expected_sha256",
        "download_bytes",
        "external_read_only",
        "experimental",
        "execution_policy"
      ],
      "A3 安装计划 entry"
    );
    const actions = new Set<A3PlanEntry["action"]>([
      "download",
      "reuse_managed",
      "extract_downloaded_archive",
      "reuse_external_read_only"
    ]);
    if (
      typeof entry.artifact_id !== "string" ||
      !/^[a-z0-9][a-z0-9._-]{1,127}$/u.test(entry.artifact_id) ||
      typeof entry.component !== "string" ||
      !A3_ENTRY_COMPONENTS.has(entry.component) ||
      typeof entry.kind !== "string" ||
      entry.kind.length === 0 ||
      entry.kind.length > 80 ||
      typeof entry.role !== "string" ||
      entry.role.length === 0 ||
      entry.role.length > 120 ||
      typeof entry.action !== "string" ||
      !actions.has(entry.action as A3PlanEntry["action"]) ||
      typeof entry.destination_relative_path !== "string" ||
      entry.destination_relative_path.length === 0 ||
      entry.destination_relative_path.length > 320 ||
      isAbsolute(entry.destination_relative_path) ||
      /(?:^|[\\/])\.\.?(?:[\\/]|$)/u.test(entry.destination_relative_path) ||
      typeof entry.expected_byte_length !== "number" ||
      !Number.isSafeInteger(entry.expected_byte_length) ||
      entry.expected_byte_length <= 0 ||
      typeof entry.expected_sha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(entry.expected_sha256) ||
      typeof entry.download_bytes !== "number" ||
      !Number.isSafeInteger(entry.download_bytes) ||
      entry.download_bytes < 0 ||
      entry.download_bytes > entry.expected_byte_length ||
      typeof entry.external_read_only !== "boolean" ||
      typeof entry.experimental !== "boolean" ||
      (entry.kind === "external_installer"
        ? entry.execution_policy !== "download_verify_user_launch_only"
        : entry.execution_policy !== undefined)
    ) {
      throw new ControlPlaneServiceError("ADAPTER_FAILED", "A3 安装计划 entry 未通过闭合校验。");
    }
    return Object.freeze({
      artifactId: entry.artifact_id,
      action: entry.action as A3PlanEntry["action"],
      kind: entry.kind,
      expectedByteLength: entry.expected_byte_length,
      downloadBytes: entry.download_bytes
    });
  }));
  if (new Set(entries.map((entry) => entry.artifactId)).size !== entries.length) {
    throw new ControlPlaneServiceError("ADAPTER_FAILED", "A3 安装计划包含重复 artifact。");
  }
  const totals = closedRecord(
    plan.totals,
    [
      "download_bytes",
      "avoided_download_bytes",
      "installed_byte_estimate",
      "safety_reserve_bytes",
      "required_free_bytes",
      "available_free_bytes",
      "space_status"
    ],
    "A3 安装计划 totals"
  );
  for (const field of [
    "download_bytes",
    "avoided_download_bytes",
    "installed_byte_estimate",
    "safety_reserve_bytes",
    "required_free_bytes"
  ] as const) {
    if (typeof totals[field] !== "number" || !Number.isSafeInteger(totals[field]) || totals[field] < 0) {
      throw new ControlPlaneServiceError("ADAPTER_FAILED", "A3 安装计划容量字段无效。");
    }
  }
  if (
    (totals.available_free_bytes !== null &&
      (typeof totals.available_free_bytes !== "number" ||
        !Number.isSafeInteger(totals.available_free_bytes) ||
        totals.available_free_bytes < 0)) ||
    !["sufficient", "insufficient", "unknown_blocked"].includes(String(totals.space_status))
  ) {
    throw new ControlPlaneServiceError("ADAPTER_FAILED", "A3 安装计划磁盘预检字段无效。");
  }
  const requiredAcknowledgements = plan.required_acknowledgements;
  if (
    !Array.isArray(requiredAcknowledgements) ||
    requiredAcknowledgements.length !== 4 ||
    new Set(requiredAcknowledgements).size !== 4 ||
    ![
      "licenseAccepted",
      "territoryAcknowledged",
      "commercialAcknowledged",
      "downloadConsent"
    ].every((key) => requiredAcknowledgements.includes(key))
  ) {
    throw new ControlPlaneServiceError("ADAPTER_FAILED", "A3 安装计划四项确认字段无效。");
  }
  const publicComponents = selectedPublicInstallationComponents(
    request.selectedOptionalComponents
  );
  const validatedLaunchPlan = parseLaunchPlan(plan.launch_plan, request.installRoot);
  if (validatedLaunchPlan === null) {
    throw new ControlPlaneServiceError("ADAPTER_FAILED", "当前硬件未达到 A3 的 16 GB VRAM 最低安装配方。");
  }
  const installsManagedComfy = components.includes("comfy-portable");
  const externalPortableRoot = installsManagedComfy ? null : externalComfyRoot;
  const launchPlan = installsManagedComfy
    ? validatedLaunchPlan
    : externalPortableRoot === null
      ? null
      : createExternalPortableLaunchPlan(externalPortableRoot, request.installRoot);
  const result = Object.freeze({
    source: "stream_a_cli" as const,
    planId: operationId,
    installRoot: request.installRoot,
    state: "ready" as const,
    selectedComponents: publicComponents,
    mutatesExistingComfyUi: false as const,
    branding: BRANDING_AUTHORITY
  });
  return Object.freeze({
    result,
    context: {
      operationId,
      managedRoot: request.installRoot,
      components: Object.freeze([...components]),
      publicComponents,
      existingModelRoots: Object.freeze([...existingModelRoots]),
      vramBytes,
      entries,
      launchRoot: externalPortableRoot ?? request.installRoot,
      launchPlan,
      lastState: "planned",
      lastResult: null
    }
  });
}

function mapRawInstallState(raw: string): InstallationStatusResult["state"] {
  if (raw === "in_progress") return "running";
  if (raw === "cancellation_requested") return "cancel_pending";
  if (raw === "cancelled") return "cancelled";
  if (raw === "failed") return "recovery_required";
  if (raw === "complete") return "complete";
  throw new ControlPlaneServiceError("ADAPTER_FAILED", "A3 安装状态值无效。");
}

function parseInstallStatus(
  value: unknown,
  context: InstallationContext
): InstallationStatusResult {
  const response = closedRecord(
    value,
    ["schema_version", "operation_id", "status", "managed_root", "entries", "launch_plan", "error"],
    "A3 安装状态"
  );
  if (
    response.schema_version !== "1.0.0" ||
    requireOperationId(response.operation_id) !== context.operationId ||
    typeof response.status !== "string" ||
    typeof response.managed_root !== "string" ||
    !sameResolvedPath(response.managed_root, context.managedRoot) ||
    !Array.isArray(response.entries) ||
    response.entries.length === 0 ||
    response.entries.length > 64
  ) {
    throw new ControlPlaneServiceError("ADAPTER_FAILED", "A3 安装状态未通过闭合校验。");
  }
  let installErrorCode: string | null = null;
  if (response.error !== null) {
    const error = closedRecord(response.error, ["code", "rule_id"], "A3 安装公开错误");
    if (
      typeof error.code !== "string" ||
      error.code.length === 0 ||
      error.code.length > 160 ||
      typeof error.rule_id !== "string" ||
      error.rule_id.length === 0 ||
      error.rule_id.length > 200
    ) throw new ControlPlaneServiceError("ADAPTER_FAILED", "A3 安装公开错误字段无效。");
    installErrorCode = error.code;
  }
  const planEntries = new Map(context.entries.map((entry) => [entry.artifactId, entry]));
  const seen = new Set<string>();
  const entries = response.entries.map((value) => {
    const entry = closedRecord(
      value,
      ["artifact_id", "action", "status", "downloaded_bytes"],
      "A3 安装状态 entry"
    );
    const planEntry = typeof entry.artifact_id === "string" ? planEntries.get(entry.artifact_id) : undefined;
    if (
      planEntry === undefined ||
      seen.has(planEntry.artifactId) ||
      entry.action !== planEntry.action ||
      !["pending", "running", "reused", "complete", "cancelled", "failed"].includes(String(entry.status)) ||
      typeof entry.downloaded_bytes !== "number" ||
      !Number.isSafeInteger(entry.downloaded_bytes) ||
      entry.downloaded_bytes < 0 ||
      entry.downloaded_bytes > planEntry.expectedByteLength
    ) {
      throw new ControlPlaneServiceError("ADAPTER_FAILED", "A3 安装状态 entry 无效。");
    }
    seen.add(planEntry.artifactId);
    return Object.freeze({
      plan: planEntry,
      status: entry.status as "pending" | "running" | "reused" | "complete" | "cancelled" | "failed",
      downloadedBytes: entry.downloaded_bytes
    });
  });
  if (entries.length !== context.entries.length || seen.size !== context.entries.length) {
    throw new ControlPlaneServiceError("ADAPTER_FAILED", "A3 安装状态缺少计划 artifact。");
  }
  const state = mapRawInstallState(response.status);
  context.lastState = state;
  const parsedLaunchPlan = parseLaunchPlan(response.launch_plan, context.managedRoot);
  if (context.components.includes("comfy-portable")) {
    context.launchPlan = parsedLaunchPlan ?? context.launchPlan;
  }

  let totalBytes = 0;
  let completedBytes = 0;
  let networkDownloadedBytes = 0;
  let networkTotalBytes = 0;
  let completedEntries = 0;
  let phase: InstallationStatusResult["phase"] = state === "complete"
    ? "complete"
    : state === "cancelled" ? "cancelled" : "planning";
  const steps = new Map<InstallationStatusResult["steps"][number]["id"], InstallationStatusResult["steps"][number]["state"]>([
    ["reuse", "pending"],
    ["download", "pending"],
    ["verify", "pending"],
    ["extract", "pending"],
    ["configure", "pending"],
    ["recover", "pending"]
  ]);
  for (const entry of entries) {
    const rawEntryState = entry.status;
    const entryTotal = entry.plan.expectedByteLength;
    totalBytes += entryTotal;
    const terminal = rawEntryState === "complete" || rawEntryState === "reused";
    if (terminal) completedEntries += 1;
    completedBytes += terminal ? entryTotal : entry.downloadedBytes;
    if (entry.plan.action.startsWith("reuse_")) {
      if (rawEntryState === "reused") steps.set("reuse", "reused");
      else if (rawEntryState === "failed") steps.set("reuse", "failed");
      else if (rawEntryState === "cancelled") steps.set("reuse", "cancelled");
      else if (rawEntryState === "running") steps.set("reuse", "running");
      if (rawEntryState === "running") phase = "reuse";
      continue;
    }
    networkTotalBytes += entryTotal;
    networkDownloadedBytes += Math.min(entry.downloadedBytes, entryTotal);
    const isExtractedArchive = entry.plan.kind === "comfy_archive" || entry.plan.kind === "ffmpeg_archive";
    if (rawEntryState === "running") {
      const extracting = isExtractedArchive && (
        entry.plan.action === "extract_downloaded_archive" ||
        entry.downloadedBytes >= entry.plan.expectedByteLength
      );
      phase = extracting ? "extract" : "download";
      steps.set(extracting ? "extract" : "download", "running");
    } else if (rawEntryState === "complete") {
      steps.set("download", "complete");
      steps.set("verify", "complete");
      if (isExtractedArchive) steps.set("extract", "complete");
    } else if (rawEntryState === "failed") {
      const failedPhase = isExtractedArchive && entry.downloadedBytes >= entry.plan.expectedByteLength
        ? "extract"
        : "download";
      steps.set(failedPhase, "failed");
    } else if (rawEntryState === "cancelled") {
      steps.set("download", "cancelled");
    }
  }
  if (state === "recovery_required") {
    phase = "recover";
    steps.set("recover", "pending");
  }
  if (state === "complete") {
    phase = "complete";
    steps.set("configure", "complete");
    for (const key of steps.keys()) {
      if (steps.get(key) === "pending") steps.set(key, "complete");
    }
  }
  const progressBasisPoints = totalBytes > 0
    ? Math.min(10_000, Math.round((completedBytes / totalBytes) * 10_000))
    : Math.min(10_000, Math.round((completedEntries / entries.length) * 10_000));
  const labels = Object.freeze({
    reuse: "复用现有组件",
    download: "下载缺失文件",
    verify: "校验长度与 SHA-256",
    extract: "安全解压与物化",
    configure: "配置运行环境",
    recover: "失败恢复"
  });
  const result = Object.freeze({
    source: "stream_a_cli",
    installationId: context.operationId,
    planId: context.operationId,
    state,
    phase,
    progressBasisPoints: state === "complete" ? 10_000 : progressBasisPoints,
    completedBytes: Math.min(completedBytes, totalBytes || completedBytes),
    totalBytes,
    networkDownloadedBytes: Math.min(networkDownloadedBytes, networkTotalBytes || networkDownloadedBytes),
    networkTotalBytes,
    message: state === "complete"
      ? "所有所选安装项均已完成。"
      : state === "recovery_required"
        ? installErrorCode === "LOCAL_RUNTIME.INSTALL_ORPHANED"
          ? "上次安装进程异常结束；已保留下载分片，点击继续即可断点恢复。"
          : "安装事务保留了可恢复状态。"
        : state === "cancelled"
          ? "安装已安全取消，项目编译保持锁定。"
          : "正在执行 A3 安装事务。",
    steps: Object.freeze([...steps].map(([id, stepState]) => Object.freeze({
      id,
      label: labels[id],
      state: stepState
    }))),
    recoverable: state === "recovery_required"
  });
  context.lastResult = result;
  return result;
}

function parseRestoredLaunchContext(
  value: unknown,
  request: RestoreCompletedInstallationRequest
): Pick<InstallationContext, "launchRoot" | "launchPlan" | "lastState" | "publicComponents"> | null {
  const response = closedRecord(
    value,
    ["schema_version", "operation_id", "status", "managed_root", "entries", "launch_plan", "error"],
    "A3 已保存安装状态"
  );
  if (
    response.schema_version !== "1.0.0" ||
    requireOperationId(response.operation_id) !== request.installationId ||
    response.status !== "complete" ||
    typeof response.managed_root !== "string" ||
    !sameResolvedPath(response.managed_root, request.installRoot) ||
    !Array.isArray(response.entries) ||
    response.entries.length === 0 ||
    response.entries.length > 64 ||
    response.error !== null
  ) return null;
  const artifactIds = new Set<string>();
  for (const value of response.entries) {
    const entry = closedRecord(
      value,
      ["artifact_id", "action", "status", "downloaded_bytes"],
      "A3 已保存安装 entry"
    );
    if (
      typeof entry.artifact_id !== "string" ||
      !/^[a-z0-9][a-z0-9._-]{1,127}$/u.test(entry.artifact_id) ||
      artifactIds.has(entry.artifact_id) ||
      typeof entry.action !== "string" ||
      !["download", "reuse_managed", "extract_downloaded_archive", "reuse_external_read_only"]
        .includes(entry.action) ||
      !["complete", "reused"].includes(String(entry.status)) ||
      (entry.action.startsWith("reuse_") ? entry.status !== "reused" : entry.status !== "complete") ||
      typeof entry.downloaded_bytes !== "number" ||
      !Number.isSafeInteger(entry.downloaded_bytes) ||
      entry.downloaded_bytes < 0
    ) return null;
    artifactIds.add(entry.artifact_id);
  }
  const managedComfyRoot = resolve(
    request.installRoot,
    "runtime",
    "ComfyUI_windows_portable"
  );
  const usesManagedComfy = sameResolvedPath(request.comfyUiRoot, managedComfyRoot);
  if (usesManagedComfy && !artifactIds.has("comfy-portable-nvidia-0.34.0")) return null;
  const launchPlan = usesManagedComfy
    ? parseLaunchPlan(response.launch_plan, request.installRoot)
    : createExternalPortableLaunchPlan(request.comfyUiRoot, request.installRoot);
  if (launchPlan === null) return null;
  return Object.freeze({
    launchRoot: usesManagedComfy ? resolve(request.installRoot) : resolve(request.comfyUiRoot),
    launchPlan,
    lastState: "complete" as const,
    publicComponents: request.completedComponents
  });
}

function parseCancelAcknowledgement(
  value: unknown,
  context: InstallationContext
): InstallationStatusResult {
  const response = closedRecord(value, ["operation_id", "status"], "A3 安装取消确认");
  if (
    requireOperationId(response.operation_id) !== context.operationId ||
    !["cancellation_requested", "complete", "failed", "cancelled"].includes(String(response.status))
  ) {
    throw new ControlPlaneServiceError("ADAPTER_FAILED", "A3 安装取消确认无效。");
  }
  const previous = context.lastResult;
  const result: InstallationStatusResult = Object.freeze({
    source: "stream_a_cli",
    installationId: context.operationId,
    planId: context.operationId,
    state: "cancel_pending",
    phase: previous?.phase ?? "planning",
    progressBasisPoints: previous?.progressBasisPoints ?? 0,
    completedBytes: previous?.completedBytes ?? 0,
    totalBytes: previous?.totalBytes ?? context.entries.reduce(
      (sum, entry) => sum + entry.expectedByteLength,
      0
    ),
    networkDownloadedBytes: previous?.networkDownloadedBytes ?? 0,
    networkTotalBytes: previous?.networkTotalBytes ?? context.entries.reduce(
      (sum, entry) => entry.action.startsWith("reuse_") ? sum : sum + entry.expectedByteLength,
      0
    ),
    message: response.status === "cancellation_requested"
      ? "安装器已接受取消请求；项目编译保持锁定，等待持久化终态。"
      : "取消请求与安装终态发生竞态；项目编译保持锁定，请重新扫描确认。",
    steps: previous?.steps ?? Object.freeze([
      Object.freeze({ id: "reuse", label: "复用现有组件", state: "pending" }),
      Object.freeze({ id: "download", label: "下载缺失文件", state: "pending" }),
      Object.freeze({ id: "verify", label: "校验长度与 SHA-256", state: "pending" }),
      Object.freeze({ id: "extract", label: "安全解压与物化", state: "pending" }),
      Object.freeze({ id: "configure", label: "配置运行环境", state: "pending" }),
      Object.freeze({ id: "recover", label: "失败恢复", state: "pending" })
    ]),
    recoverable: false
  });
  context.lastState = "cancel_pending";
  context.lastResult = result;
  return result;
}

function parseWorkflow(value: unknown): JsonValue {
  let result = value;
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.hasOwn(value, "ok")
  ) {
    result = unwrapResult(value);
  }
  assertPlainJson(result, "编译结果");
  const record =
    typeof result === "object" && result !== null && !Array.isArray(result)
      ? (result as Record<string, unknown>)
      : null;
  const workflow = record !== null && Object.hasOwn(record, "workflow")
    ? record.workflow
    : result;
  assertPlainJson(workflow, "工作流");
  const encoded = stableJson(workflow);
  if (Buffer.byteLength(encoded, "utf8") > MAX_OUTPUT_BYTES) {
    throw new ControlPlaneServiceError("ADAPTER_FAILED", "工作流超过安全上限。");
  }
  return workflow as JsonValue;
}

function containedPath(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child.length > 0 && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

async function readContainedWorkflowExport(
  value: unknown,
  outputDirectory: string
): Promise<JsonValue> {
  let responseValue = value;
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.hasOwn(value, "result")
  ) {
    responseValue = unwrapResult(value);
  }
  const response = closedRecord(
    responseValue,
    [
      "ok",
      "compiler_version",
      "template_revision",
      "status",
      "exported",
      "exports",
      "segment_plan",
      "handoff"
    ],
    "Stream B 导出结果"
  );
  const exportsValue = response.exported ?? response.exports;
  const handoff = closedRecord(
    response.handoff,
    ["capability", "status", "user_action", "automatic_execution", "automatic_submission", "auto_run"],
    "Stream B 交接结果"
  );
  if (
    response.ok !== true ||
    !Array.isArray(exportsValue) ||
    exportsValue.length !== 1 ||
    handoff.capability !== "EXPORT_ONLY" ||
    handoff.automatic_execution !== false ||
    handoff.automatic_submission !== false ||
    handoff.auto_run !== false
  ) {
    throw new ControlPlaneServiceError("ADAPTER_FAILED", "Stream B 导出结果未通过闭合校验。");
  }
  const item = closedRecord(
    exportsValue[0],
    [
      "segment",
      "included_segments",
      "file_name",
      "workflow_path",
      "workflow_sha256",
      "template_path",
      "template_sha256",
      "template_structure_sha256",
      "compiled_structure_sha256",
      "static_lint_digest"
    ],
    "Stream B workflow 导出项"
  );
  const includedSegments = item.included_segments;
  if (
    !Number.isSafeInteger(item.segment) ||
    (item.segment as number) < 1 ||
    !Array.isArray(includedSegments) ||
    includedSegments.length < 1 ||
    includedSegments.length > MAX_WORKFLOW_SEGMENTS ||
    includedSegments.some(
      (segment, index) =>
        !Number.isSafeInteger(segment) ||
        segment < 1 ||
        segment > MAX_WORKFLOW_SEGMENTS ||
        segment !== (item.segment as number) + index
    )
  ) {
    throw new ControlPlaneServiceError(
      "ADAPTER_FAILED",
      "Stream B workflow 分段身份无效。"
    );
  }
  if (
    typeof item.file_name !== "string" ||
    basename(item.file_name) !== item.file_name ||
    typeof item.workflow_path !== "string" ||
    !isAbsolute(item.workflow_path) ||
    typeof item.workflow_sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(item.workflow_sha256)
  ) {
    throw new ControlPlaneServiceError("ADAPTER_FAILED", "Stream B workflow 路径或身份无效。");
  }

  try {
    const outputIdentity = await realpath(outputDirectory);
    const workflowIdentity = await realpath(item.workflow_path);
    const metadata = await lstat(item.workflow_path);
    if (
      !containedPath(outputIdentity, workflowIdentity) ||
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size <= 0 ||
      metadata.size > 4 * 1024 * 1024 ||
      basename(workflowIdentity) !== item.file_name
    ) {
      throw new Error("unsafe-export");
    }
    const bytes = await readFile(workflowIdentity);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== item.workflow_sha256) throw new Error("hash-mismatch");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const workflow: unknown = JSON.parse(text);
    assertPlainJson(workflow, "Stream B visual workflow");
    return workflow as JsonValue;
  } catch (error) {
    if (error instanceof ControlPlaneServiceError) throw error;
    throw new ControlPlaneServiceError("ADAPTER_FAILED", "Stream B workflow 文件未通过 containment 与哈希校验。");
  }
}

type StreamACommand =
  | "ui-locations"
  | "attach-plan"
  | "install-plan"
  | "install"
  | "install-status"
  | "install-cancel"
  | "install-recover";

async function runStreamACommand(
  entryPoint: string,
  utilityWrapperEntryPoint: string | null,
  command: StreamACommand,
  request: unknown,
  isPackaged: boolean,
  acceptedExitCodes: ReadonlySet<number> = new Set([0]),
  timeoutMilliseconds = DEFAULT_TIMEOUT_MS
): Promise<unknown> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "minimax-h3-stream-a-"));
  const requestPath = join(temporaryRoot, "request.json");
  try {
    await writeFile(requestPath, `${stableJson(request)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
    const args = [command, "--request", requestPath];
    return isPackaged
      ? utilityWrapperEntryPoint === null
        ? Promise.reject(adapterProcessFailure("launch", "打包适配器包装器不可用"))
        : await runFixedStreamAUtility(
            utilityWrapperEntryPoint,
            command,
            requestPath,
            acceptedExitCodes,
            timeoutMilliseconds
          )
      : await runFixedCli(
          entryPoint,
          args,
          undefined,
          acceptedExitCodes,
          timeoutMilliseconds
        );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function runStreamBCompiler(
  entryPoint: string,
  utilityWrapperEntryPoint: string | null,
  project: unknown,
  isPackaged: boolean
): Promise<JsonValue> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "minimax-h3-control-plane-"));
  const projectPath = join(temporaryRoot, "project.json");
  const outputDirectory = join(temporaryRoot, "output");
  try {
    await mkdir(outputDirectory, { recursive: false });
    await writeFile(projectPath, `${stableJson(project)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
    const args = ["compile", "--project", projectPath, "--output-dir", outputDirectory];
    const output = isPackaged
      ? utilityWrapperEntryPoint === null
        ? Promise.reject(adapterProcessFailure("launch", "打包工作流编译包装器不可用"))
        : await runFixedStreamBUtility(
            utilityWrapperEntryPoint,
            projectPath,
            outputDirectory
          )
      : await runFixedCli(entryPoint, args, undefined);
    return await readContainedWorkflowExport(output, outputDirectory);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

export function createAbCliAdapter(options: CreateAbCliAdapterOptions): AbCliAdapter {
  const runtimeRoot = options.isPackaged
    ? resolve(options.resourcesPath, "runtime")
    : resolve(options.appPath, "..", "..");
  const streamAEntryPoint = resolve(runtimeRoot, "packages", "local-runtime", "bin", "local-runtime.mjs");
  const streamAUtilityWrapper = options.isPackaged
    ? resolve(options.resourcesPath, "runtime", "electron-utility-wrapper.cjs")
    : null;
  const streamBEntryPoint = resolve(
    runtimeRoot,
    "packages",
    "workflow",
    "h3-compiler",
    "bin",
    "h3-compile.mjs"
  );
  const streamBUtilityWrapper = options.isPackaged
    ? resolve(options.resourcesPath, "runtime", "electron-workflow-compiler-wrapper.cjs")
    : null;
  const canUseExternal = options.enabled;
  const streamAAvailable = canUseExternal && existsSync(streamAEntryPoint) && (
    !options.isPackaged || (
      streamAUtilityWrapper !== null && existsSync(streamAUtilityWrapper)
    )
  );
  const streamBAvailable = canUseExternal && existsSync(streamBEntryPoint) && (
    !options.isPackaged || (
      streamBUtilityWrapper !== null && existsSync(streamBUtilityWrapper)
    )
  );
  const scannedRoots = new Map<
    string,
    {
      readonly request: ScanInstallationRequest;
      readonly vramBytes: number | null;
    }
  >();
  const installationContexts = new Map<string, InstallationContext>();
  let latestLaunchContext: Pick<
    InstallationContext,
    "launchRoot" | "launchPlan" | "lastState"
  > | null = null;
  let ownedComfyChild: ReturnType<typeof spawn> | null = null;
  let previousRandomBaseSeed: number | null = null;
  let disposed = false;

  const killExactChild = (child: ReturnType<typeof spawn>): void => {
    if (child.exitCode !== null || child.killed) return;
    try {
      child.kill();
    } catch {
      // The exact retained child may already have crossed its terminal event.
    }
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    activeAdapterDisposers.delete(dispose);
    const child = ownedComfyChild;
    ownedComfyChild = null;
    if (child !== null) killExactChild(child);
  };
  activeAdapterDisposers.add(dispose);

  const a3Components = (
    request: PrepareInstallationRequest,
    scan: ScanInstallationRequest
  ): readonly A3Component[] => {
    if (request.selectedOptionalComponents.includes("comfyui_desktop_optional")) {
      throw new ControlPlaneServiceError(
        "INVALID_REQUEST",
        "ComfyUI Desktop 是必需组件，不能通过可选组件通道提交。"
      );
    }
    const values: A3Component[] = [];
    if (scan.comfyUiRoot === null) {
      values.push("comfy-portable");
      values.push("comfy-desktop");
    }
    values.push("fl2va-base");
    if (request.selectedOptionalComponents.includes("turbo_acceleration_recommended")) {
      values.push("fl2v-turbo");
    }
    if (request.selectedOptionalComponents.includes("ref2va_optional")) {
      values.push("ref2va-addon");
    }
    if (request.selectedOptionalComponents.includes("ffmpeg_long_video_optional")) {
      values.push("ffmpeg-managed");
    }
    const expected = resolveA3InstallationComponents({
      hasAttachedComfyUi: scan.comfyUiRoot !== null,
      selectedOptionalComponents: request.selectedOptionalComponents
    });
    if (
      values.some((value) => !A3_COMPONENTS.has(value)) ||
      new Set(values).size !== values.length ||
      values.length !== expected.length ||
      values.some((value, index) => value !== expected[index])
    ) {
      throw new ControlPlaneServiceError("INVALID_REQUEST", "A3 组件映射无效。");
    }
    return Object.freeze(values);
  };

  const executionRequest = (
    context: InstallationContext
  ): Readonly<Record<string, unknown>> => Object.freeze({
    managedRoot: context.managedRoot,
    components: context.components,
    existingModelRoots: context.existingModelRoots,
    ...(context.vramBytes === null
      ? {}
      : { hardware: Object.freeze({ vramBytes: context.vramBytes }) }),
    operationId: context.operationId,
    acknowledgements: Object.freeze({
      licenseAccepted: true,
      territoryAcknowledged: true,
      commercialAcknowledged: true,
      downloadConsent: true
    })
  });

  const locatorRequest = (
    context: InstallationContext
  ): Readonly<Record<string, unknown>> => Object.freeze({
    managedRoot: context.managedRoot,
    operationId: context.operationId
  });

  const adapter: AbCliAdapter = {
    streamAAvailable,
    streamBAvailable,
    async scanInstallation(request: ScanInstallationRequest) {
      if (!streamAAvailable) return null;
      const locationOutput = await runStreamACommand(
        streamAEntryPoint,
        streamAUtilityWrapper,
        "ui-locations",
        Object.freeze({
          request_version: "1.0.0",
          ...(request.comfyUiRoot === null
            ? {}
            : { user_comfy_roots: Object.freeze([request.comfyUiRoot]) }),
          ...(request.modelRoot === null
            ? {}
            : { user_model_roots: Object.freeze([request.modelRoot]) })
        }),
        options.isPackaged,
        new Set([0]),
        SCAN_TIMEOUT_MS
      );
      const locations = parseStreamAUiLocations(locationOutput);
      const effectiveRequest: ScanInstallationRequest = Object.freeze({
        installRoot: request.installRoot,
        comfyUiRoot: locations.comfyUiRoot,
        modelRoot: locations.modelRoot
      });
      const output = await runStreamACommand(
        streamAEntryPoint,
        streamAUtilityWrapper,
        "attach-plan",
        Object.freeze({
          request_version: "1.0.0",
          managed_root: request.installRoot,
          ...(locations.comfyUiRoot === null
            ? {}
            : { user_comfy_roots: Object.freeze([locations.comfyUiRoot]) }),
          ...(locations.modelRoot === null
            ? {}
            : { user_model_roots: Object.freeze([locations.modelRoot]) })
        }),
        options.isPackaged,
        new Set([0, 1]),
        SCAN_TIMEOUT_MS
      );
      const parsed = parseStreamAScan(output, request.installRoot, locations);
      scannedRoots.set(request.installRoot.toLocaleLowerCase("en-US"), Object.freeze({
        request: effectiveRequest,
        vramBytes: parsed.vramBytes
      }));
      return parsed.result;
    },
    async prepareInstallation(request: PrepareInstallationRequest) {
      if (!streamAAvailable) return null;
      const scan = scannedRoots.get(request.installRoot.toLocaleLowerCase("en-US"));
      if (scan === undefined) return null;
      const components = a3Components(request, scan.request);
      const existingModelRoots = Object.freeze(
        scan.request.modelRoot === null ? [] : [scan.request.modelRoot]
      );
      const output = await runStreamACommand(
        streamAEntryPoint,
        streamAUtilityWrapper,
        "install-plan",
        Object.freeze({
          managedRoot: request.installRoot,
          components,
          existingModelRoots,
          ...(scan.vramBytes === null
            ? {}
            : { hardware: Object.freeze({ vramBytes: scan.vramBytes }) }),
          acknowledgements: Object.freeze({
            licenseAccepted: false,
            territoryAcknowledged: false,
            commercialAcknowledged: false,
            downloadConsent: false
          })
        }),
        options.isPackaged
      );
      const parsed = parseInstallPlan(
        output,
        request,
        components,
        existingModelRoots,
        scan.request.comfyUiRoot,
        scan.vramBytes
      );
      installationContexts.set(parsed.context.operationId, parsed.context);
      if (parsed.context.launchPlan !== null) latestLaunchContext = parsed.context;
      return parsed.result;
    },
    async executeInstallation(request: ExecuteInstallationRequest) {
      if (!streamAAvailable) return null;
      const context = installationContexts.get(request.planId);
      if (context === undefined || context.managedRoot !== request.installRoot) return null;
      const command: StreamACommand = context.lastState === "recovery_required"
        ? "install-recover"
        : "install";
      const output = await runStreamACommand(
        streamAEntryPoint,
        streamAUtilityWrapper,
        command,
        command === "install-recover" ? locatorRequest(context) : executionRequest(context),
        options.isPackaged,
        new Set([0]),
        12 * 60 * 60_000
      );
      const status = parseInstallStatus(output, context);
      if (context.launchPlan !== null) latestLaunchContext = context;
      return status;
    },
    async queryInstallation(request: QueryInstallationRequest) {
      if (!streamAAvailable) return null;
      const context = installationContexts.get(request.installationId);
      if (context === undefined) return null;
      const output = await runStreamACommand(
        streamAEntryPoint,
        streamAUtilityWrapper,
        "install-status",
        locatorRequest(context),
        options.isPackaged
      );
      const status = parseInstallStatus(output, context);
      if (context.launchPlan !== null) latestLaunchContext = context;
      return status;
    },
    async cancelInstallation(request: CancelInstallationRequest) {
      if (!streamAAvailable) return null;
      const context = installationContexts.get(request.installationId);
      if (context === undefined) return null;
      const output = await runStreamACommand(
        streamAEntryPoint,
        streamAUtilityWrapper,
        "install-cancel",
        locatorRequest(context),
        options.isPackaged
      );
      return parseCancelAcknowledgement(output, context);
    },
    async restoreCompletedInstallation(request: RestoreCompletedInstallationRequest) {
      latestLaunchContext = null;
      if (disposed || !streamAAvailable) return false;
      if (
        typeof request.installRoot !== "string" ||
        request.installRoot.length === 0 ||
        request.installRoot.length > 32_767 ||
        request.installRoot.includes("\0") ||
        !isAbsolute(request.installRoot) ||
        typeof request.installationId !== "string" ||
        typeof request.comfyUiRoot !== "string" ||
        request.comfyUiRoot.length === 0 ||
        request.comfyUiRoot.length > 32_767 ||
        request.comfyUiRoot.includes("\0") ||
        !isAbsolute(request.comfyUiRoot)
      ) {
        throw new ControlPlaneServiceError("INVALID_REQUEST", "已保存安装事务定位信息无效。");
      }
      const normalizedRequest = Object.freeze({
        installRoot: resolve(request.installRoot),
        installationId: requireOperationId(request.installationId),
        comfyUiRoot: resolve(request.comfyUiRoot),
        completedComponents: requireRestoredComponents(request.completedComponents)
      });
      installationContexts.delete(normalizedRequest.installationId);
      const output = await runStreamACommand(
        streamAEntryPoint,
        streamAUtilityWrapper,
        "install-status",
        Object.freeze({
          managedRoot: normalizedRequest.installRoot,
          operationId: normalizedRequest.installationId
        }),
        options.isPackaged,
        new Set([0]),
        SCAN_TIMEOUT_MS
      );
      const restored = parseRestoredLaunchContext(output, normalizedRequest);
      if (restored === null || !await launchPlanFilesystemIsSafe(restored)) return false;
      const restoredComponents: A3Component[] = [];
      if (sameResolvedPath(
        normalizedRequest.comfyUiRoot,
        resolve(normalizedRequest.installRoot, "runtime", "ComfyUI_windows_portable")
      )) restoredComponents.push("comfy-portable");
      if (restored.publicComponents.includes("fl2va_base")) restoredComponents.push("fl2va-base");
      if (restored.publicComponents.includes("ref2va_optional")) restoredComponents.push("ref2va-addon");
      if (restored.publicComponents.includes("turbo_acceleration_recommended")) {
        restoredComponents.push("fl2v-turbo");
      }
      if (restored.publicComponents.includes("ffmpeg_long_video_optional")) {
        restoredComponents.push("ffmpeg-managed");
      }
      const context: InstallationContext = {
        operationId: normalizedRequest.installationId,
        managedRoot: normalizedRequest.installRoot,
        components: Object.freeze(restoredComponents),
        publicComponents: restored.publicComponents,
        existingModelRoots: Object.freeze([]),
        vramBytes: null,
        entries: Object.freeze([]),
        launchRoot: restored.launchRoot,
        launchPlan: restored.launchPlan,
        lastState: "complete",
        lastResult: null
      };
      installationContexts.set(context.operationId, context);
      latestLaunchContext = context;
      return true;
    },
    async launchManagedComfy() {
      if (disposed) return false;
      const context = latestLaunchContext;
      const plan = context?.launchPlan ?? null;
      if (context === null || plan === null || context.lastState !== "complete") return false;
      if (ownedComfyChild !== null && ownedComfyChild.exitCode === null) return true;
      if (!await launchPlanFilesystemIsSafe(context)) return false;
      const environment = childEnvironment();
      delete environment.ELECTRON_RUN_AS_NODE;
      const child = spawn(plan.executable, [...plan.args], {
        cwd: plan.workingDirectory,
        env: environment,
        shell: false,
        windowsHide: true,
        stdio: "ignore"
      });
      ownedComfyChild = child;
      const releaseOwnedChild = (): void => {
        if (ownedComfyChild === child) ownedComfyChild = null;
      };
      child.once("exit", releaseOwnedChild);
      child.once("error", releaseOwnedChild);
      return await new Promise<boolean>((resolvePromise) => {
        let settled = false;
        const finish = (value: boolean): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolvePromise(value);
        };
        const timer = setTimeout(() => finish(!disposed && child.exitCode === null), 3_000);
        child.once("spawn", () => {
          if (disposed || ownedComfyChild !== child) {
            killExactChild(child);
            finish(false);
            return;
          }
          finish(true);
        });
        child.once("error", () => finish(false));
      });
    },
    dispose,
    async compileWorkflow(request: CompilerRequest) {
      if (!streamBAvailable) return null;
      assertMultiSegmentPromptPreflight(request.project);
      if (request.project.mode === "REF2VA") {
        const refDurations = request.project.segmentDurationsSeconds
          ?? Object.freeze([request.project.segmentDurationSeconds]);
        if (refDurations.length !== 1 || refDurations[0] !== request.project.durationSeconds) {
          throw new ControlPlaneServiceError(
            "INVALID_REQUEST",
            "Ref2VA 当前只支持一个 5、10 或 15 秒镜头；请减少为单镜头后再编译。"
          );
        }
        if (request.project.durationSeconds > 15) {
          throw new ControlPlaneServiceError(
            "INVALID_REQUEST",
            "Ref2VA 当前仅安全支持 5、10 或 15 秒单段工作流；30/60 秒长链尚未通过官方连续性兼容验证。"
          );
        }
        const ref2vaReady = [...installationContexts.values()].some(
          (context) =>
            context.lastState === "complete" &&
            context.publicComponents.includes("ref2va_optional")
        );
        if (!ref2vaReady) {
          throw new ControlPlaneServiceError(
            "INSTALLATION_NOT_READY",
            "Ref2VA 工作流要求当前已完成的安装事务包含并校验 Ref2VA 可选包。"
          );
        }
        if (request.project.advanced?.samplingProfile === "turbo_8") {
          throw new ControlPlaneServiceError(
            "INVALID_REQUEST",
            "Ref2VA 支持 20 步标准或 25 步高质量，当前不支持 Turbo。"
          );
        }
      }
      if (request.project.advanced?.samplingProfile === "turbo_8") {
        const turboReady = [...installationContexts.values()].some(
          (context) =>
            context.lastState === "complete" &&
            context.publicComponents.includes("turbo_acceleration_recommended")
        );
        if (!turboReady) {
          throw new ControlPlaneServiceError(
            "INSTALLATION_NOT_READY",
            "官方 Turbo 8-step 工作流要求当前已完成的安装事务包含并校验 Turbo 加速权重。"
          );
        }
      }
      if (
        request.project.mode !== "T2V" &&
        request.resolvedFrames.first === null &&
        request.resolvedFrames.last === null
      ) throw new ControlPlaneServiceError(
        "INVALID_REQUEST",
        request.project.mode === "REF2VA"
          ? "Ref2VA 至少需要复制后的一张参考图片。"
          : "FL2VA 至少需要复制后的首帧或尾帧。"
      );
      const compilerMode = request.project.mode === "T2V"
        ? "t2v"
        : request.project.mode === "REF2VA"
          ? "ref2va"
        : request.resolvedFrames.first !== null && request.resolvedFrames.last !== null
          ? "first_last_frame"
          : request.resolvedFrames.first !== null
            ? "first_frame"
            : "last_frame";
      const requestedPolicy = normalizeRelaySeedPolicy(request.project.advanced?.seedPolicy);
      const compileShotIds = relayCompileShotIds(request.project);
      const seedResolution = request.seedResolution === undefined
        ? resolveRelaySeedPlan({
            policy: requestedPolicy,
            fixedSeed: request.project.advanced?.seed ?? 1,
            shotIds: compileShotIds,
            entropy: () => randomBytes(8),
            previousRandomBaseSeed
          })
        : normalizeRelayResolvedSeedPlan(request.seedResolution);
      if (seedResolution.policy !== requestedPolicy
        || seedResolution.shots.length !== compileShotIds.length
        || seedResolution.shots.some((shot, index) => shot.shotId !== compileShotIds[index])
        || (requestedPolicy === "fixed" && seedResolution.baseSeed !== (request.project.advanced?.seed ?? 1))) {
        throw new ControlPlaneServiceError("INVALID_REQUEST", "编译种子解析与当前镜头计划不一致。");
      }
      if (requestedPolicy === "random_per_compile") previousRandomBaseSeed = seedResolution.baseSeed;
      const endpoints = request.project.mode === "T2V"
        ? null
        : request.project.mode === "REF2VA"
          ? Object.freeze({
              reference_images: Object.freeze(
                [request.resolvedFrames.first, request.resolvedFrames.last]
                  .filter((value): value is string => value !== null)
              )
            })
          : Object.freeze({
            ...(request.resolvedFrames.first === null
              ? {}
              : { first_frame: request.resolvedFrames.first }),
            ...(request.resolvedFrames.last === null
              ? {}
              : { last_frame: request.resolvedFrames.last })
            });
      const compilerProject = Object.freeze({
        schema_version: "1.0.0",
        prompt: request.project.prompt,
        mode: compilerMode,
        duration: request.project.durationSeconds,
        segment_duration: request.project.segmentDurationSeconds,
        ...(request.project.segmentDurationsSeconds === undefined
          ? {}
          : { segment_durations: request.project.segmentDurationsSeconds }),
        ...(request.project.segmentShotIds === undefined
          ? {}
          : { shot_ids: request.project.segmentShotIds }),
        ...(request.project.segmentTransitions === undefined
          ? {}
          : { transitions: request.project.segmentTransitions }),
        canvas: request.project.canvas,
        resolution_megapixels: request.project.resolutionMegapixels,
        advanced: Object.freeze({
          seed: request.project.advanced?.seed ?? 1,
          seed_policy: requestedPolicy,
          sampling_profile: request.project.advanced?.samplingProfile ?? "quality_20",
          resolved_base_seed: seedResolution.baseSeed,
          resolved_shot_seeds: Object.freeze(seedResolution.shots.map((shot) => shot.seed))
        }),
        ...(endpoints === null ? {} : { endpoints })
      });
      const workflow = await runStreamBCompiler(
        streamBEntryPoint,
        streamBUtilityWrapper,
        compilerProject,
        options.isPackaged
      );
      const embeddedSeedResolution = relayWorkflowSeedPlan(workflow);
      if (embeddedSeedResolution === null || !relaySeedPlansEqual(seedResolution, embeddedSeedResolution)) {
        throw new ControlPlaneServiceError("ADAPTER_FAILED", "工作流编译器未返回可复现的种子解析证据。");
      }
      return workflow;
    }
  };
  return Object.freeze(adapter);
}
