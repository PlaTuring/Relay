import type {
  RendererControlPlaneApi,
  UpdateCheckCacheContract,
  UpdateCheckResultContract,
  UpdateCheckStatus
} from "../shared/ipc-contract";
import type {
  UpdateDownloadStatusContract,
  UpdateReleaseAssetContract
} from "../shared/update-source";
import { formalVersionNumber } from "./version-presentation";

type UpdateApi = Pick<RendererControlPlaneApi,
  | "checkForUpdates"
  | "downloadUpdate"
  | "getUpdateDownloadStatus"
  | "cancelUpdateDownload"
  | "openDownloadedUpdateFolder"
>;

interface UpdatePresentation {
  readonly status: UpdateCheckStatus;
  readonly checkedAt: string | null;
  readonly currentVersion: string | null;
  readonly latestVersion: string | null;
  readonly tag: string | null;
  readonly releaseNotes: string | null;
  readonly publishedAt: string | null;
  readonly assets: readonly UpdateReleaseAssetContract[];
  readonly rateLimitResetAt?: string | null;
  readonly cached?: UpdateCheckCacheContract | null;
}

export interface UpdateUiDependencies {
  readonly controlPlane: RendererControlPlaneApi;
  readonly showError: (title: string, message: string) => void;
  readonly publicError: (error: unknown) => string;
  readonly formatBytes: (value: number) => string;
}

export interface UpdateUiController {
  readonly setCurrentVersion: (version: string) => void;
  readonly renderCheck: (
    presentation: UpdatePresentation | UpdateCheckResultContract | UpdateCheckCacheContract | null
  ) => void;
  readonly restoreDownloadStatus: () => Promise<void>;
  readonly stop: () => void;
}

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (value === null) throw new Error(`UI element is missing: ${id}`);
  return value as T;
}

function setButtonBusy(button: HTMLButtonElement, busy: boolean, label: string): void {
  button.disabled = busy;
  button.setAttribute("aria-busy", String(busy));
  const labelNode = button.querySelector<HTMLElement>(".button-label");
  if (labelNode !== null) labelNode.textContent = label;
}

function summarizeCachedUpdateCheck(cache: UpdateCheckCacheContract | null): string | null {
  if (cache === null) return null;
  if (cache.status === "update_available" && cache.latestVersion !== null) {
    return `已知新版本 ${formalVersionNumber(cache.latestVersion)}`;
  }
  if (cache.status === "latest") return "当时已是最新版本";
  if (cache.status === "no_release") return "当时尚无可用发布版本";
  return null;
}

function updateDownloadErrorMessage(status: UpdateDownloadStatusContract): string {
  if (status.message !== null && status.message.trim().length > 0) return status.message;
  switch (status.errorCode) {
    case "download_in_progress": return "已有一个更新下载正在进行。";
    case "no_validated_release": return "请先重新检查并验证发布版本。";
    case "no_newer_release": return "当前没有可安装的新版本。";
    case "data_root_unavailable": return "Relay 数据目录当前不可用。";
    case "network": return "下载期间网络连接中断，临时文件已清理。";
    case "http": return "发布资产服务器返回了错误响应，临时文件已清理。";
    case "redirect_blocked": return "下载被重定向到不受信任的位置，已拒绝并清理临时文件。";
    case "length_mismatch": return "下载长度与 GitHub 发布元数据不一致，临时文件已清理。";
    case "hash_mismatch": return "文件 SHA-256 与发布清单不一致，临时文件已清理。";
    case "installer_launch_unavailable": return "当前 Relay 构建未提供安装程序启动能力。";
    case "installer_launch_failed": return "安装程序未能启动，请检查 Windows 安全提示或系统策略。";
    case "filesystem": return "更新文件未能安全写入 Relay 数据目录。";
    case "cancelled": return "下载已取消，临时文件已清理。";
    default: return "更新下载未完成。";
  }
}

function updateDownloadPhaseLabel(status: UpdateDownloadStatusContract): string {
  switch (status.phase) {
    case "binary": return "正在下载安装版";
    case "verifying": return "正在校验长度与 SHA-256";
    case "finalizing": return "正在安全完成下载";
    case "installing": return "正在启动安装程序";
    case "completed": return "安装程序已启动";
    case "failed": return "下载未完成";
    case "cancelled": return "下载已取消";
    default: return "等待下载";
  }
}

export function createUpdateUi(dependencies: UpdateUiDependencies): UpdateUiController {
  const aboutCheckUpdateButton = element<HTMLButtonElement>("about-check-update");
  const aboutUpdateStatus = element<HTMLElement>("about-update-status");
  const aboutUpdateMeta = element<HTMLElement>("about-update-meta");
  const aboutCurrentVersion = element<HTMLElement>("about-current-version");
  const aboutLatestVersion = element<HTMLElement>("about-latest-version");
  const aboutReleaseDate = element<HTMLElement>("about-release-date");
  const aboutDownloadUpdate = element<HTMLButtonElement>("about-download-update");
  const aboutDownloadProgress = element<HTMLElement>("about-download-progress");
  const aboutDownloadProgressTitle = element<HTMLElement>("about-download-progress-title");
  const aboutDownloadProgressMessage = element<HTMLElement>("about-download-progress-message");
  const aboutDownloadProgressPercent = element<HTMLElement>("about-download-progress-percent");
  const aboutDownloadProgressBar = element<HTMLElement>("about-download-progress-bar");
  const aboutDownloadProgressBytes = element<HTMLElement>("about-download-progress-bytes");
  const aboutCancelDownload = element<HTMLButtonElement>("about-cancel-download");
  const aboutOpenDownloadFolder = element<HTMLButtonElement>("about-open-download-folder");

  let lastSuccessfulUpdateCheck: UpdateCheckCacheContract | null = null;
  let updateDownloadAvailable = false;
  let updateDownloadPollTimer: number | null = null;
  let updateDownloadPollInFlight = false;

  const downloadApi = (): UpdateApi | null => {
    const candidate = dependencies.controlPlane as Partial<UpdateApi>;
    return typeof candidate.checkForUpdates === "function"
      && typeof candidate.downloadUpdate === "function"
      && typeof candidate.getUpdateDownloadStatus === "function"
      && typeof candidate.cancelUpdateDownload === "function"
      && typeof candidate.openDownloadedUpdateFolder === "function"
      ? candidate as UpdateApi
      : null;
  };

  const renderUpdateVersionFacts = (
    release: Pick<UpdateCheckCacheContract, "latestVersion" | "publishedAt"> | null,
    emptyVersionLabel: string
  ): void => {
    aboutLatestVersion.textContent = release?.latestVersion == null
      ? emptyVersionLabel
      : formalVersionNumber(release.latestVersion);
    const publishedAt = release?.publishedAt == null ? null : new Date(release.publishedAt);
    aboutReleaseDate.textContent = publishedAt === null || Number.isNaN(publishedAt.valueOf())
      ? "—"
      : publishedAt.toLocaleString("zh-CN");
  };

  const setUpdatePrimaryAction = (updateAvailable: boolean, downloading: boolean): void => {
    aboutDownloadUpdate.hidden = !updateAvailable;
    aboutCheckUpdateButton.hidden = updateAvailable;
    aboutDownloadUpdate.disabled = downloading;
    aboutCheckUpdateButton.disabled = downloading;
  };

  const renderCheck = (
    presentation: UpdatePresentation | UpdateCheckResultContract | UpdateCheckCacheContract | null
  ): void => {
    if (presentation !== null) {
      if ("cached" in presentation && presentation.cached != null) {
        lastSuccessfulUpdateCheck = presentation.cached;
      } else if ("schemaVersion" in presentation) {
        lastSuccessfulUpdateCheck = presentation;
      }
    }
    const status: UpdateCheckStatus | null = presentation?.status ?? null;
    const directRelease = presentation !== null
      && !("schemaVersion" in presentation)
      && presentation.status !== "checking"
      && presentation.status !== "network"
      && presentation.status !== "rate_limit"
      && presentation.status !== "malformed"
      && presentation.status !== "release_incomplete"
      ? presentation
      : null;
    const release = directRelease ?? lastSuccessfulUpdateCheck;
    if (presentation?.currentVersion != null) {
      aboutCurrentVersion.textContent = formalVersionNumber(presentation.currentVersion);
    }
    const emptyVersionLabel = status === null
      ? "尚未检查"
      : status === "checking"
        ? "正在检查…"
        : status === "network" || status === "rate_limit" || status === "malformed" || status === "release_incomplete"
          ? "本次未确认"
          : "未发现合格版本";
    renderUpdateVersionFacts(release, emptyVersionLabel);
    const checkedAt = presentation?.checkedAt == null ? null : new Date(presentation.checkedAt).toLocaleString("zh-CN");
    const cachedAt = lastSuccessfulUpdateCheck === null
      ? null
      : new Date(lastSuccessfulUpdateCheck.checkedAt).toLocaleString("zh-CN");
    const cachedSummary = summarizeCachedUpdateCheck(lastSuccessfulUpdateCheck);
    const cachedEvidence = cachedAt === null
      ? null
      : `上次成功检查：${cachedAt}${cachedSummary === null ? "" : ` · ${cachedSummary}`}`;
    const rateLimitResetAt = presentation !== null && "rateLimitResetAt" in presentation
      ? presentation.rateLimitResetAt
      : null;
    const resetAt = rateLimitResetAt == null ? null : new Date(rateLimitResetAt).toLocaleString("zh-CN");
    aboutUpdateStatus.dataset.status = status ?? "idle";
    aboutUpdateStatus.textContent = status === "checking"
      ? "正在检查 GitHub Releases…"
      : status === "latest"
        ? "当前已是最新版本。"
        : status === "update_available"
          ? `发现新版本 ${presentation?.latestVersion ?? ""}。`
          : status === "no_release"
            ? "仓库尚未发布可用版本。"
            : status === "release_incomplete"
              ? "最高合格版本的发布资产不完整或不安全，未降级选择旧版本。"
              : status === "network"
                ? "暂时无法连接 GitHub，请检查网络后重试。"
                : status === "rate_limit"
                  ? "GitHub 匿名检查次数暂时受限，请稍后重试。"
                  : status === "malformed"
                    ? "GitHub 返回的发布信息格式异常，未采用本次结果。"
                    : "尚未检查更新。";
    const failedAttempt = status === "network" || status === "rate_limit" || status === "malformed" || status === "release_incomplete";
    aboutUpdateMeta.textContent = status === "checking"
      ? cachedEvidence === null
        ? "正在匿名读取固定 GitHub Releases 更新源；尚无成功检查记录。"
        : `${cachedEvidence}；本次检查不会改写该记录。`
      : status === "rate_limit" && resetAt !== null
        ? `${cachedEvidence ?? "尚无成功检查记录"}；预计 ${resetAt} 后可重试。`
        : failedAttempt && cachedEvidence !== null
          ? `${cachedEvidence}；本次失败没有覆盖有效结果。`
          : checkedAt === null
            ? "仅在你点击后匿名读取 GitHub Releases，不需要登录或令牌。"
            : `${status === "latest" || status === "update_available" || status === "no_release" ? "成功检查" : "本次检查"}：${checkedAt} · GitHub Releases · 匿名只读。`;
    const hasValidatedUpdateRelease = directRelease?.tag != null
      && directRelease.assets.length === 1
      && directRelease.assets[0]?.kind === "setup";
    const canDownload = status === "update_available" && hasValidatedUpdateRelease && downloadApi() !== null;
    updateDownloadAvailable = canDownload;
    setUpdatePrimaryAction(canDownload, status === "checking");
    if (downloadApi() === null && status === "update_available") {
      aboutUpdateMeta.textContent = "当前构建未提供受限下载服务；不会显示不可用的下载操作。";
    }
  };

  const stop = (): void => {
    if (updateDownloadPollTimer !== null) window.clearTimeout(updateDownloadPollTimer);
    updateDownloadPollTimer = null;
  };

  const scheduleUpdateDownloadPoll = (): void => {
    stop();
    updateDownloadPollTimer = window.setTimeout(() => void pollUpdateDownloadStatus(), 500);
  };

  const renderDownloadStatus = (status: UpdateDownloadStatusContract): void => {
    const active = status.state === "downloading" || status.state === "installing";
    const cancellable = status.state === "downloading";
    const completed = status.state === "completed";
    const terminal = completed || status.state === "failed" || status.state === "cancelled";
    const ratio = status.bytesTotal > 0
      ? Math.min(1, Math.max(0, status.bytesReceived / status.bytesTotal))
      : completed ? 1 : 0;
    const percent = Math.round(ratio * 100);
    aboutDownloadProgress.hidden = status.state === "idle";
    aboutDownloadProgressTitle.textContent = updateDownloadPhaseLabel(status);
    aboutDownloadProgressMessage.textContent = status.state === "failed" || status.state === "cancelled"
      ? updateDownloadErrorMessage(status)
      : completed
        ? "安装程序已启动，Relay 正在退出。"
        : status.message ?? "正在下载、校验并准备安装更新。";
    aboutDownloadProgressPercent.textContent = status.bytesTotal > 0 || completed ? `${percent}%` : "—";
    aboutDownloadProgressBar.style.width = `${percent}%`;
    const progress = aboutDownloadProgress.querySelector<HTMLElement>('[role="progressbar"]');
    progress?.setAttribute("aria-valuenow", String(percent));
    progress?.setAttribute("aria-valuetext", status.bytesTotal > 0
      ? `${dependencies.formatBytes(status.bytesReceived)} / ${dependencies.formatBytes(status.bytesTotal)}`
      : updateDownloadPhaseLabel(status));
    aboutDownloadProgressBytes.textContent = status.bytesTotal > 0
      ? `${dependencies.formatBytes(status.bytesReceived)} / ${dependencies.formatBytes(status.bytesTotal)}`
      : status.bytesReceived > 0 ? `${dependencies.formatBytes(status.bytesReceived)} 已接收` : "等待真实字节进度";
    aboutCancelDownload.hidden = !cancellable;
    aboutCancelDownload.disabled = !cancellable;
    const canRecoverInstaller = status.state === "failed"
      && status.errorCode === "installer_launch_failed"
      && status.canOpenFolder;
    aboutOpenDownloadFolder.hidden = !canRecoverInstaller;
    aboutOpenDownloadFolder.disabled = !canRecoverInstaller;
    aboutCheckUpdateButton.hidden = completed;
    if (completed) aboutDownloadUpdate.hidden = true;
    else setUpdatePrimaryAction(updateDownloadAvailable, active);
    const downloadLabel = aboutDownloadUpdate.querySelector<HTMLElement>(".button-label");
    if (downloadLabel !== null) {
      downloadLabel.textContent = active
        ? status.state === "installing" ? "正在启动安装…" : "正在下载…"
        : status.state === "failed" ? "重试下载并安装" : "下载并安装";
    }
    if (active) scheduleUpdateDownloadPoll();
    else {
      stop();
      if (terminal) aboutDownloadUpdate.disabled = false;
    }
  };

  const pollUpdateDownloadStatus = async (): Promise<void> => {
    if (updateDownloadPollInFlight) return;
    const api = downloadApi();
    if (api === null) {
      stop();
      return;
    }
    updateDownloadPollInFlight = true;
    try {
      renderDownloadStatus(await api.getUpdateDownloadStatus());
    } catch {
      stop();
      aboutDownloadProgress.hidden = false;
      aboutDownloadProgressTitle.textContent = "无法读取下载状态";
      aboutDownloadProgressMessage.textContent = "更新服务暂不可用，本次下载与安装未继续。";
    } finally {
      updateDownloadPollInFlight = false;
    }
  };

  aboutCheckUpdateButton.addEventListener("click", () => {
    if (aboutCheckUpdateButton.disabled) return;
    setButtonBusy(aboutCheckUpdateButton, true, "正在检查…");
    renderCheck({
      status: "checking",
      checkedAt: null,
      currentVersion: null,
      latestVersion: null,
      tag: null,
      releaseNotes: null,
      publishedAt: null,
      assets: Object.freeze([]),
      rateLimitResetAt: null,
      cached: lastSuccessfulUpdateCheck
    });
    void dependencies.controlPlane.checkForUpdates()
      .then((result) => renderCheck(result))
      .catch(() => renderCheck({
        status: "network",
        checkedAt: new Date().toISOString(),
        currentVersion: null,
        latestVersion: null,
        tag: null,
        releaseNotes: null,
        publishedAt: null,
        assets: Object.freeze([]),
        rateLimitResetAt: null,
        cached: lastSuccessfulUpdateCheck
      }))
      .finally(() => setButtonBusy(aboutCheckUpdateButton, false, "检查更新"));
  });

  aboutDownloadUpdate.addEventListener("click", () => {
    const api = downloadApi();
    if (api === null || aboutDownloadUpdate.disabled) return;
    setButtonBusy(aboutDownloadUpdate, true, "正在开始…");
    void api.downloadUpdate({ kind: "setup" })
      .then((status) => renderDownloadStatus(status))
      .catch((error: unknown) => dependencies.showError("下载未开始", dependencies.publicError(error)))
      .finally(() => {
        if (updateDownloadPollTimer === null) setButtonBusy(aboutDownloadUpdate, false, "下载并安装");
      });
  });

  aboutCancelDownload.addEventListener("click", () => {
    const api = downloadApi();
    if (api === null || aboutCancelDownload.disabled) return;
    aboutCancelDownload.disabled = true;
    aboutCancelDownload.textContent = "正在取消…";
    void api.cancelUpdateDownload()
      .then((status) => renderDownloadStatus(status))
      .catch((error: unknown) => dependencies.showError("取消状态未确认", dependencies.publicError(error)))
      .finally(() => {
        aboutCancelDownload.textContent = "取消下载";
      });
  });

  aboutOpenDownloadFolder.addEventListener("click", () => {
    const api = downloadApi();
    if (api === null || aboutOpenDownloadFolder.disabled) return;
    aboutOpenDownloadFolder.disabled = true;
    void api.openDownloadedUpdateFolder()
      .then((opened) => {
        if (!opened) throw new Error("系统未能打开已校验安装包所在目录。");
      })
      .catch((error: unknown) => dependencies.showError("下载目录未打开", dependencies.publicError(error)))
      .finally(() => {
        aboutOpenDownloadFolder.disabled = false;
      });
  });

  return Object.freeze({
    setCurrentVersion: (version: string): void => {
      aboutCurrentVersion.textContent = formalVersionNumber(version);
    },
    renderCheck,
    restoreDownloadStatus: async (): Promise<void> => {
      const api = downloadApi();
      if (api === null) return;
      renderDownloadStatus(await api.getUpdateDownloadStatus());
    },
    stop
  });
}
