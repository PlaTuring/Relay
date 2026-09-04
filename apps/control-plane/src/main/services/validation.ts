import { win32 } from "node:path";

import type {
  CanvasPreset,
  CancelInstallationRequest,
  ComponentId,
  CompileAndOpenWorkflowRequest,
  DurationSeconds,
  ExecuteInstallationRequest,
  FrameSlot,
  PrepareInstallationRequest,
  ProjectAdvancedOptions,
  ProjectMode,
  ProjectSpec,
  QueryInstallationRequest,
  ScanInstallationRequest,
  SegmentDurationSeconds,
  SegmentTransition
} from "../../shared/ipc-contract.js";
import { validateWorkflowName } from "../../shared/workflow-name.js";
import { normalizeRelaySeedPolicy } from "../../shared/seed-policy.js";
import { ControlPlaneServiceError } from "./errors.js";
import { isSelectableOptionalComponent } from "./installation-component-policy.js";

const INSTALL_ROOT_FIELDS = Object.freeze(["installRoot", "comfyUiRoot", "modelRoot"]);
const PREPARE_FIELDS = Object.freeze(["installRoot", "selectedOptionalComponents"]);
const EXECUTE_FIELDS = Object.freeze(["planId", "installRoot"]);
const INSTALLATION_ID_FIELDS = Object.freeze(["installationId"]);
const COMPILE_FIELDS = Object.freeze([
  "workflowName",
  "project",
  "exportDirectorySelectionId",
  "projectId"
]);
const PROJECT_FIELDS = Object.freeze([
  "prompt",
  "mode",
  "firstFrameSelectionId",
  "lastFrameSelectionId",
  "durationSeconds",
  "segmentDurationSeconds",
  "segmentDurationsSeconds",
  "segmentShotIds",
  "segmentTransitions",
  "canvas",
  "resolutionMegapixels",
  "advanced"
]);

const MODES = new Set<ProjectMode>(["T2V", "FL2VA", "REF2VA"]);
const SEGMENT_DURATIONS = new Set<SegmentDurationSeconds>([5, 10, 15]);
const SEGMENT_TRANSITIONS = new Set<SegmentTransition>([
  "hard_cut",
  "tail_frame_continuation"
]);
const MAX_DIRECTOR_DURATION_SECONDS = 180;
const CANVASES = new Set<CanvasPreset>([
  "21:9",
  "16:9",
  "3:2",
  "4:3",
  "1:1",
  "3:4",
  "2:3",
  "9:16"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireClosedRecord(
  value: unknown,
  allowedFields: readonly string[],
  label: string
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ControlPlaneServiceError("INVALID_REQUEST", `${label} 格式无效。`);
  }

  const allowed = new Set(allowedFields);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new ControlPlaneServiceError("INVALID_REQUEST", `${label} 包含不允许的字段。`);
    }
  }
  return value;
}

function requireSelectionId(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^(?:frame|export)_[a-f0-9]{24}$/.test(value)) {
    throw new ControlPlaneServiceError("INVALID_REQUEST", `${label} 无效。`);
  }
  return value;
}

export function validateInstallRoot(value: unknown): string {
  if (typeof value !== "string") {
    throw new ControlPlaneServiceError("INVALID_INSTALL_ROOT", "安装目录必须是 Windows 绝对路径。");
  }

  const trimmed = value.trim().replaceAll("/", "\\");
  if (
    trimmed.length < 3 ||
    trimmed.length > 240 ||
    !/^[A-Za-z]:\\/.test(trimmed) ||
    trimmed.startsWith("\\\\?\\") ||
    trimmed.startsWith("\\\\.\\") ||
    /(?:^|\\)\.\.?(?:\\|$)/.test(trimmed) ||
    trimmed.includes("\0")
  ) {
    throw new ControlPlaneServiceError("INVALID_INSTALL_ROOT", "安装目录必须是普通本地磁盘上的 Windows 绝对路径。");
  }

  return win32.normalize(trimmed).replace(/\\+$/, "");
}

export function validateScanRequest(value: unknown): ScanInstallationRequest {
  const record = requireClosedRecord(value, INSTALL_ROOT_FIELDS, "扫描请求");
  return Object.freeze({
    installRoot: validateInstallRoot(record.installRoot),
    comfyUiRoot:
      record.comfyUiRoot === null ? null : validateInstallRoot(record.comfyUiRoot),
    modelRoot:
      record.modelRoot === null ? null : validateInstallRoot(record.modelRoot)
  });
}

export function validatePrepareRequest(value: unknown): PrepareInstallationRequest {
  const record = requireClosedRecord(value, PREPARE_FIELDS, "安装计划请求");
  if (!Array.isArray(record.selectedOptionalComponents)) {
    throw new ControlPlaneServiceError("INVALID_REQUEST", "可选组件列表无效。");
  }

  const selected = record.selectedOptionalComponents.map((item) => {
    if (!isSelectableOptionalComponent(item)) {
      throw new ControlPlaneServiceError("INVALID_REQUEST", "可选组件列表包含不允许的组件。");
    }
    return item;
  });
  if (new Set(selected).size !== selected.length) {
    throw new ControlPlaneServiceError("INVALID_REQUEST", "可选组件不能重复。");
  }

  return Object.freeze({
    installRoot: validateInstallRoot(record.installRoot),
    selectedOptionalComponents: Object.freeze(selected)
  });
}

function requireOperationId(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9_-]{7,95}$/u.test(value)) {
    throw new ControlPlaneServiceError("INVALID_REQUEST", `${label} 无效。`);
  }
  return value;
}

export function validateExecuteInstallationRequest(
  value: unknown
): ExecuteInstallationRequest {
  const record = requireClosedRecord(value, EXECUTE_FIELDS, "安装执行请求");
  return Object.freeze({
    planId: requireOperationId(record.planId, "安装计划"),
    installRoot: validateInstallRoot(record.installRoot)
  });
}

export function validateQueryInstallationRequest(value: unknown): QueryInstallationRequest {
  const record = requireClosedRecord(value, INSTALLATION_ID_FIELDS, "安装查询请求");
  return Object.freeze({
    installationId: requireOperationId(record.installationId, "安装任务")
  });
}

export function validateCancelInstallationRequest(value: unknown): CancelInstallationRequest {
  const record = requireClosedRecord(value, INSTALLATION_ID_FIELDS, "安装取消请求");
  return Object.freeze({
    installationId: requireOperationId(record.installationId, "安装任务")
  });
}

export function validateFrameSlot(value: unknown): FrameSlot {
  if (value !== "first" && value !== "last") {
    throw new ControlPlaneServiceError("INVALID_REQUEST", "帧选择位置无效。");
  }
  return value;
}

export function validateProjectSpec(value: unknown): ProjectSpec {
  const record = requireClosedRecord(value, PROJECT_FIELDS, "项目参数");
  if (
    typeof record.prompt !== "string" ||
    record.prompt.trim().length === 0 ||
    record.prompt.length > 4_000
  ) {
    throw new ControlPlaneServiceError("INVALID_REQUEST", "提示词长度必须为 1 到 4000 个字符。");
  }
  if (typeof record.mode !== "string" || !MODES.has(record.mode as ProjectMode)) {
    throw new ControlPlaneServiceError("INVALID_REQUEST", "项目模式无效。");
  }
  if (
    typeof record.durationSeconds !== "number" ||
    !Number.isSafeInteger(record.durationSeconds) ||
    record.durationSeconds < 5 ||
    record.durationSeconds > MAX_DIRECTOR_DURATION_SECONDS ||
    record.durationSeconds % 5 !== 0
  ) {
    throw new ControlPlaneServiceError("INVALID_REQUEST", "时长无效。");
  }
  if (
    typeof record.segmentDurationSeconds !== "number" ||
    !SEGMENT_DURATIONS.has(record.segmentDurationSeconds as SegmentDurationSeconds)
  ) {
    throw new ControlPlaneServiceError("INVALID_REQUEST", "单段时长无效。");
  }
  let segmentDurationsSeconds: readonly SegmentDurationSeconds[] | undefined;
  if (record.segmentDurationsSeconds !== undefined) {
    if (
      !Array.isArray(record.segmentDurationsSeconds) ||
      record.segmentDurationsSeconds.length === 0 ||
      record.segmentDurationsSeconds.length > 36 ||
      record.segmentDurationsSeconds.some((entry) => (
        typeof entry !== "number" || !SEGMENT_DURATIONS.has(entry as SegmentDurationSeconds)
      ))
    ) throw new ControlPlaneServiceError("INVALID_REQUEST", "逐镜时长只能由 5、10 或 15 秒组成。");
    const total = record.segmentDurationsSeconds.reduce((sum: number, entry) => sum + Number(entry), 0);
    if (total !== record.durationSeconds) {
      throw new ControlPlaneServiceError("INVALID_REQUEST", "逐镜时长总和必须等于项目总时长。");
    }
    segmentDurationsSeconds = Object.freeze(record.segmentDurationsSeconds as SegmentDurationSeconds[]);
  }
  const segmentCount = segmentDurationsSeconds?.length
    ?? Math.ceil(record.durationSeconds / record.segmentDurationSeconds);
  let segmentShotIds: readonly string[] | undefined;
  if (record.segmentShotIds !== undefined) {
    if (
      !Array.isArray(record.segmentShotIds) ||
      record.segmentShotIds.length !== segmentCount ||
      record.segmentShotIds.some((entry) => typeof entry !== "string" || !/^shot-[a-z0-9][a-z0-9-]{7,127}$/u.test(entry)) ||
      new Set(record.segmentShotIds).size !== record.segmentShotIds.length
    ) throw new ControlPlaneServiceError("INVALID_REQUEST", "逐镜标识必须与逐镜时长一一对应且保持唯一。");
    segmentShotIds = Object.freeze(record.segmentShotIds as string[]);
  }
  let segmentTransitions: readonly SegmentTransition[] | undefined;
  if (record.segmentTransitions !== undefined) {
    if (
      !Array.isArray(record.segmentTransitions) ||
      record.segmentTransitions.length !== segmentCount - 1 ||
      record.segmentTransitions.some(
        (entry) => typeof entry !== "string" || !SEGMENT_TRANSITIONS.has(entry as SegmentTransition)
      )
    ) throw new ControlPlaneServiceError(
      "INVALID_REQUEST",
      "逐镜衔接必须与相邻镜头一一对应，且只能使用硬切或尾帧延续。"
    );
    segmentTransitions = Object.freeze(record.segmentTransitions as SegmentTransition[]);
  }
  if (typeof record.canvas !== "string" || !CANVASES.has(record.canvas as CanvasPreset)) {
    throw new ControlPlaneServiceError("INVALID_REQUEST", "画布规格无效。");
  }
  if (
    typeof record.resolutionMegapixels !== "number" ||
    !Number.isFinite(record.resolutionMegapixels) ||
    record.resolutionMegapixels < 0.1 ||
    record.resolutionMegapixels > 16
  ) {
    throw new ControlPlaneServiceError("INVALID_REQUEST", "分辨率必须在 0.1 到 16.0 MP 之间。");
  }
  const advanced = validateAdvancedOptions(record.advanced);

  return Object.freeze({
    prompt: record.prompt,
    mode: record.mode as ProjectMode,
    firstFrameSelectionId: requireSelectionId(record.firstFrameSelectionId, "首帧选择"),
    lastFrameSelectionId: requireSelectionId(record.lastFrameSelectionId, "尾帧选择"),
    durationSeconds: record.durationSeconds as DurationSeconds,
    segmentDurationSeconds: record.segmentDurationSeconds as SegmentDurationSeconds,
    ...(segmentDurationsSeconds === undefined ? {} : { segmentDurationsSeconds }),
    ...(segmentShotIds === undefined ? {} : { segmentShotIds }),
    ...(segmentTransitions === undefined ? {} : { segmentTransitions }),
    canvas: record.canvas as CanvasPreset,
    resolutionMegapixels: record.resolutionMegapixels,
    advanced
  });
}

function validateAdvancedOptions(value: unknown): ProjectAdvancedOptions {
  if (value === undefined) {
    return Object.freeze({ seed: 1, seedPolicy: "random_per_compile", samplingProfile: "quality_20" });
  }
  const record = requireClosedRecord(
    value,
    ["seed", "seedPolicy", "samplingProfile"],
    "高级参数"
  );
  if (typeof record.seed !== "number" || !Number.isSafeInteger(record.seed) || record.seed < 0) {
    throw new ControlPlaneServiceError("INVALID_REQUEST", "随机种子必须是非负安全整数。");
  }
  if (record.seedPolicy !== "fixed" && record.seedPolicy !== "random_per_compile" && record.seedPolicy !== "randomize") {
    throw new ControlPlaneServiceError("INVALID_REQUEST", "随机种子策略无效。");
  }
  if (
    record.samplingProfile !== "quality_20" &&
    record.samplingProfile !== "quality_25" &&
    record.samplingProfile !== "turbo_8"
  ) {
    throw new ControlPlaneServiceError("INVALID_REQUEST", "采样配置无效。");
  }
  return Object.freeze({
    seed: record.seed,
    seedPolicy: normalizeRelaySeedPolicy(record.seedPolicy),
    samplingProfile: record.samplingProfile
  });
}

export function validateCompileRequest(value: unknown): CompileAndOpenWorkflowRequest {
  const record = requireClosedRecord(value, COMPILE_FIELDS, "工作流请求");
  const workflowName = validateWorkflowName(record.workflowName);
  if (!workflowName.ok) {
    throw new ControlPlaneServiceError("INVALID_REQUEST", workflowName.message);
  }
  const exportId = requireSelectionId(record.exportDirectorySelectionId, "导出目录选择");
  if (exportId !== null && !exportId.startsWith("export_")) {
    throw new ControlPlaneServiceError("INVALID_REQUEST", "导出目录选择无效。");
  }
  const project = validateProjectSpec(record.project);
  if (
    project.mode === "FL2VA" &&
    project.firstFrameSelectionId === null &&
    project.lastFrameSelectionId === null
  ) {
    throw new ControlPlaneServiceError("INVALID_REQUEST", "FL2VA 至少需要首帧或尾帧之一。");
  }
  if (
    project.mode === "REF2VA" &&
    project.firstFrameSelectionId === null &&
    project.lastFrameSelectionId === null
  ) {
    throw new ControlPlaneServiceError("INVALID_REQUEST", "Ref2VA 至少需要一张参考图片。");
  }
  if (project.mode === "REF2VA" && project.advanced?.samplingProfile === "turbo_8") {
    throw new ControlPlaneServiceError("INVALID_REQUEST", "Ref2VA 当前不支持 Turbo；请选择 20 步标准或 25 步高质量。");
  }
  if (
    project.mode === "T2V" &&
    (project.firstFrameSelectionId !== null || project.lastFrameSelectionId !== null)
  ) {
    throw new ControlPlaneServiceError("INVALID_REQUEST", "T2V 不接受首帧或尾帧。");
  }
  return Object.freeze({
    workflowName: workflowName.value,
    project,
    ...(record.projectId === undefined ? {} : {
      projectId: record.projectId === null
        ? null
        : typeof record.projectId === "string" && /^project-[a-z0-9][a-z0-9-]{7,127}$/u.test(record.projectId)
          ? record.projectId
          : (() => { throw new ControlPlaneServiceError("INVALID_REQUEST", "项目标识无效。"); })()
    }),
    exportDirectorySelectionId: exportId
  });
}

export function requireKnownSelection(
  id: string | null,
  selections: ReadonlyMap<string, string>,
  label: string
): string | null {
  if (id === null) return null;
  const path = selections.get(id);
  if (path === undefined) {
    throw new ControlPlaneServiceError("INVALID_REQUEST", `${label} 已失效，请重新选择。`);
  }
  return path;
}

export function assertPlainJson(value: unknown, label = "适配器输出"): void {
  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    nodes += 1;
    if (nodes > 50_000 || current.depth > 64) {
      throw new ControlPlaneServiceError("ADAPTER_FAILED", `${label} 超出允许复杂度。`);
    }
    if (
      current.value === null ||
      typeof current.value === "string" ||
      typeof current.value === "boolean"
    ) continue;
    if (typeof current.value === "number") {
      if (!Number.isFinite(current.value)) {
        throw new ControlPlaneServiceError("ADAPTER_FAILED", `${label} 包含无效数值。`);
      }
      continue;
    }
    if (Array.isArray(current.value)) {
      for (const item of current.value) stack.push({ value: item, depth: current.depth + 1 });
      continue;
    }
    if (isRecord(current.value)) {
      for (const [key, item] of Object.entries(current.value)) {
        if (key.length > 256 || item === undefined) {
          throw new ControlPlaneServiceError("ADAPTER_FAILED", `${label} 不是闭合 JSON。`);
        }
        stack.push({ value: item, depth: current.depth + 1 });
      }
      continue;
    }
    throw new ControlPlaneServiceError("ADAPTER_FAILED", `${label} 不是有效 JSON。`);
  }
}
