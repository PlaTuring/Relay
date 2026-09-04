import { createHash } from "node:crypto";

import {
  BRANDING_AUTHORITY,
  type CancelInstallationRequest,
  type ExecuteInstallationRequest,
  type InstallationPhase,
  type InstallationStatusResult,
  type PrepareInstallationRequest,
  type PrepareInstallationResult,
  type QueryInstallationRequest,
  type ScanInstallationRequest,
  type ScanInstallationResult
} from "../../shared/ipc-contract.js";
import {
  normalizeInstallationComponents,
  selectedPublicInstallationComponents
} from "./installation-component-policy.js";

function shortHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}

export function createMockScan(request: ScanInstallationRequest): ScanInstallationResult {
  return Object.freeze({
    source: "deterministic_mock",
    installRoot: request.installRoot,
    locations: Object.freeze({
      comfyUiRoot: request.comfyUiRoot,
      modelRoot: request.modelRoot,
      comfySource: request.comfyUiRoot === null ? "missing" : "explicit",
      modelSource: request.modelRoot === null ? "missing" : "explicit"
    }),
    system: Object.freeze({
      windows: "Windows 10/11 · 模拟检测",
      gpu: "GPU 信息等待本机适配器",
      vramBytes: null,
      memory: "内存信息等待本机适配器",
      targetVolume: `${request.installRoot.slice(0, 2)} · 用户已选目录`
    }),
    attachPlan: Object.freeze({
      mode: "attach_only",
      existingComfyUi: request.comfyUiRoot ?? "未选择现有 ComfyUI（模拟路径）",
      mutatesExistingInstance: false
    }),
    verifiedReuseGiB: 0,
    pendingVerificationGiB: 0,
    requiredDownloadGiB: 42.8,
    components: normalizeInstallationComponents([
      Object.freeze({
        id: "fl2va_base",
        title: "FL2VA 基础包",
        description: "来自 Comfy-Org 官方 MiniMax-H3 仓库的 FL2VA 模型、共享编码器与 Video/Audio VAE。",
        required: true,
        selected: true,
        state: "needs_download",
        sizeGiB: 40.5
      }),
      Object.freeze({
        id: "turbo_acceleration_recommended",
        title: "Turbo 加速权重（硬件配方推荐）",
        description: "来自 Comfy-Org 官方 MiniMax-H3 仓库的 FL2V Turbo 权重；不启用未知加速节点。",
        required: false,
        selected: true,
        state: "needs_download",
        sizeGiB: 2
      }),
      Object.freeze({
        id: "ref2va_optional",
        title: "Ref2VA 可选包",
        description: "来自 Comfy-Org 官方 MiniMax-H3 仓库；用于参考图片、视频或声音的 Ref2VA 能力。",
        required: false,
        selected: false,
        state: "needs_download",
        sizeGiB: 19.5
      }),
      Object.freeze({
        id: "pyav_required",
        title: "PyAV（随 ComfyUI 提供）",
        description: "随 Comfy-Org 官方 ComfyUI v0.34.0 运行环境提供，不要求全局安装。",
        required: true,
        selected: true,
        state: "needs_download",
        sizeGiB: 0.1
      }),
      Object.freeze({
        id: "ffmpeg_long_video_optional",
        title: "FFmpeg（仅长视频选配）",
        description: "FFmpeg 官网列出的 BtbN 固定 Windows 构建；用于本地媒体预检和视频封面，不参与 H3 采样或分段拼接。",
        required: false,
        selected: false,
        state: "needs_download",
        sizeGiB: 0.2
      }),
      Object.freeze({
        id: "comfyui_desktop_optional",
        title: "ComfyUI Desktop / 现有 ComfyUI",
        description: request.comfyUiRoot === null
          ? "未配置可交接的 ComfyUI；将下载并校验 Comfy 官方 Desktop 安装包。"
          : "已保存并静态复核现有 ComfyUI，工作流将直接交接到该环境。",
        required: true,
        selected: true,
        state: request.comfyUiRoot === null ? "needs_download" : "verified_reuse",
        sizeGiB: 0.2
      })
    ])
  });
}

export function createMockPrepare(
  request: PrepareInstallationRequest
): PrepareInstallationResult {
  const selected = selectedPublicInstallationComponents(request.selectedOptionalComponents);
  return Object.freeze({
    source: "deterministic_mock",
    planId: `mock_${shortHash(JSON.stringify([request.installRoot, selected]))}`,
    installRoot: request.installRoot,
    state: "ready",
    selectedComponents: Object.freeze(selected),
    mutatesExistingComfyUi: false,
    branding: BRANDING_AUTHORITY
  });
}

function mockSteps(tick: number, terminal: "complete" | "cancelled" | null) {
  const ids = ["reuse", "download", "verify", "extract", "configure", "recover"] as const;
  return Object.freeze(ids.map((id, index) => Object.freeze({
    id,
    label: {
      reuse: "复用现有组件",
      download: "下载缺失文件",
      verify: "校验长度与 SHA-256",
      extract: "安全解压与物化",
      configure: "配置运行环境",
      recover: "失败恢复"
    }[id],
    state: terminal === "cancelled"
      ? "cancelled" as const
      : terminal === "complete" || index < tick
        ? (id === "reuse" ? "reused" as const : "complete" as const)
        : index === tick
          ? "running" as const
          : "pending" as const
  })));
}

export function createMockInstallationController() {
  const operations = new Map<string, { tick: number; cancelled: boolean }>();

  const result = (
    installationId: string,
    tick: number,
    cancelled: boolean
  ): InstallationStatusResult => {
    const complete = !cancelled && tick >= 5;
    const phases: readonly InstallationPhase[] = [
      "reuse",
      "download",
      "verify",
      "extract",
      "configure",
      "complete"
    ];
    return Object.freeze({
      source: "deterministic_mock",
      installationId,
      planId: installationId,
      state: cancelled ? "cancelled" : complete ? "complete" : "running",
      phase: cancelled ? "cancelled" : phases[Math.min(tick, phases.length - 1)] ?? "planning",
      progressBasisPoints: cancelled ? Math.min(tick * 2_000, 9_000) : Math.min(tick * 2_000, 10_000),
      completedBytes: Math.min(tick, 5) * 1024 ** 3,
      totalBytes: 5 * 1024 ** 3,
      networkDownloadedBytes: Math.min(tick, 5) * 1024 ** 3,
      networkTotalBytes: 5 * 1024 ** 3,
      message: cancelled
        ? "技术 Smoke 安装已取消。"
        : complete
          ? "技术 Smoke 安装已完成。"
          : "技术 Smoke 正在模拟确定性安装进度。",
      steps: mockSteps(tick, cancelled ? "cancelled" : complete ? "complete" : null),
      recoverable: false
    });
  };

  return Object.freeze({
    execute(request: ExecuteInstallationRequest): InstallationStatusResult {
      operations.set(request.planId, { tick: 0, cancelled: false });
      return result(request.planId, 0, false);
    },
    query(request: QueryInstallationRequest): InstallationStatusResult {
      const operation = operations.get(request.installationId);
      if (operation === undefined) throw new Error("unknown mock installation");
      if (!operation.cancelled) operation.tick = Math.min(operation.tick + 1, 5);
      return result(request.installationId, operation.tick, operation.cancelled);
    },
    cancel(request: CancelInstallationRequest): InstallationStatusResult {
      const operation = operations.get(request.installationId);
      if (operation === undefined) throw new Error("unknown mock installation");
      operation.cancelled = true;
      return result(request.installationId, operation.tick, true);
    }
  });
}
