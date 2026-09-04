import type { ComponentId, ComponentScanResult } from "../shared/ipc-contract";

const EXTERNAL_VISIBLE_COMPONENTS = new Set<ComponentId>([
  "ffmpeg_long_video_optional",
  "comfyui_desktop_optional"
]);

export interface ComponentUiPolicy {
  readonly externalVisibleOption: boolean;
  readonly detectedExternalReuse: boolean;
  readonly checked: boolean;
  readonly permanentlyLocked: boolean;
  readonly requirementLabel: "必需" | "可选" | "待校验" | "已配置";
  readonly stateLabel: string;
  readonly initialProgressLabel: string;
  readonly initialProgressState: "pending" | "complete";
}

export function isExternalVisibleComponent(id: ComponentId): boolean {
  return EXTERNAL_VISIBLE_COMPONENTS.has(id);
}

export function componentStateLabel(component: ComponentScanResult): string {
  const external = isExternalVisibleComponent(component.id);
  if (component.state === "found_unverified") return "已找到，待校验";
  if (component.id === "comfyui_desktop_optional" && component.state === "verified_reuse") {
    return "已配置";
  }
  if (component.id === "comfyui_desktop_optional" && component.state === "needs_download") {
    return "需安装";
  }
  if (external && component.state === "needs_download") return "可选安装";
  if (component.state === "verified_reuse") return "已验证可复用";
  return "需下载";
}

export function componentProgressLabel(
  component: ComponentScanResult,
  checked: boolean
): string {
  const external = isExternalVisibleComponent(component.id);
  if (external) {
    if (!checked) return "未选择";
    if (component.id === "comfyui_desktop_optional" && component.state === "verified_reuse") {
      return "已保存现有 ComfyUI 配置";
    }
    if (component.state === "verified_reuse") return "已验证，可直接复用";
    if (component.state === "found_unverified") return "等待安装前校验";
    return "等待安装或配置";
  }
  if (component.state === "verified_reuse") return "复用准备完成";
  if (component.state === "found_unverified") return "等待安装前校验";
  return "等待下载";
}

export function componentUiPolicy(component: ComponentScanResult): ComponentUiPolicy {
  const mandatory = component.required || component.id === "comfyui_desktop_optional";
  const externalVisibleOption = isExternalVisibleComponent(component.id);
  const detectedExternalReuse = externalVisibleOption && component.state === "verified_reuse";
  const detectedExternalCandidate = externalVisibleOption && component.state === "found_unverified";
  const unverifiedCandidate = component.state === "found_unverified";
  const checked = mandatory || component.selected || detectedExternalReuse || detectedExternalCandidate;
  const permanentlyLocked = mandatory || detectedExternalReuse;
  return Object.freeze({
    externalVisibleOption,
    detectedExternalReuse,
    checked,
    permanentlyLocked,
    requirementLabel: mandatory
      ? "必需"
      : unverifiedCandidate
        ? "待校验"
        : detectedExternalReuse
        ? "已配置"
        : "可选",
    stateLabel: componentStateLabel(component),
    initialProgressLabel: componentProgressLabel(component, checked),
    initialProgressState: component.state === "verified_reuse" ? "complete" : "pending"
  });
}
