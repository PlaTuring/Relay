import type {
  GeneratedVideoContract,
  RendererControlPlaneApi
} from "../shared/ipc-contract";
import type { ProjectOperationContext } from "./project-operation-context";

type GeneratedVideoApi = Pick<RendererControlPlaneApi,
  | "listGeneratedVideos"
  | "supplementGeneratedVideo"
  | "getGeneratedVideoPreview"
  | "playGeneratedVideo"
  | "showGeneratedVideoInFolder"
  | "addGeneratedVideoToProjectAssets"
>;

export interface GeneratedVideoProjectContext extends ProjectOperationContext {
  readonly projectName: string;
}

export interface GeneratedVideoUiDependencies {
  readonly controlPlane: RendererControlPlaneApi;
  readonly getProjectContext: () => GeneratedVideoProjectContext | null;
  readonly isProjectContextCurrent: (context: ProjectOperationContext) => boolean;
  readonly flushAndCaptureProjectMutation: () => Promise<ProjectOperationContext>;
  readonly synchronizeProjectMutation: (context: ProjectOperationContext) => Promise<boolean>;
  readonly reloadProjectAssets: (context: ProjectOperationContext) => Promise<void>;
  readonly showFeedback: (options: {
    readonly kind: "success" | "warning" | "error";
    readonly title: string;
    readonly message: string;
  }) => void;
  readonly publicError: (error: unknown) => string;
  readonly formatBytes: (value: number) => string;
}

export interface GeneratedVideoUiController {
  readonly refresh: (quiet?: boolean) => Promise<void>;
  readonly activate: () => void;
  readonly deactivate: () => void;
  readonly invalidateProject: () => void;
}

const GENERATED_VIDEO_POLL_DELAYS_MS = Object.freeze([1_500, 3_000, 6_000, 12_000, 30_000]);

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
  else button.textContent = label;
}

function generatedVideoApi(controlPlane: RendererControlPlaneApi): GeneratedVideoApi | null {
  const candidate = controlPlane as Partial<GeneratedVideoApi>;
  return typeof candidate.listGeneratedVideos === "function"
    && typeof candidate.supplementGeneratedVideo === "function"
    && typeof candidate.getGeneratedVideoPreview === "function"
    && typeof candidate.playGeneratedVideo === "function"
    && typeof candidate.showGeneratedVideoInFolder === "function"
    && typeof candidate.addGeneratedVideoToProjectAssets === "function"
    ? candidate as GeneratedVideoApi
    : null;
}

function generatedVideoTechnicalSummary(video: GeneratedVideoContract): string {
  const inspection = video.technicalInspection;
  if (inspection.status !== "verified") return inspection.message ?? "技术信息未检查";
  const facts = [
    inspection.width !== null && inspection.height !== null ? `${inspection.width} × ${inspection.height}` : null,
    inspection.durationSeconds === null ? null : `${inspection.durationSeconds.toFixed(1)} 秒`,
    inspection.videoCodec,
    inspection.audioCodec === null ? null : `音频 ${inspection.audioCodec}`
  ].filter((value): value is string => value !== null);
  return facts.length === 0 ? "已通过本机技术检查" : facts.join(" · ");
}

function generatedFact(label: string, value: string, title?: string): HTMLDivElement {
  const row = document.createElement("div");
  const term = document.createElement("dt");
  const detail = document.createElement("dd");
  term.textContent = label;
  detail.textContent = value;
  if (title !== undefined) detail.title = title;
  row.append(term, detail);
  return row;
}

function generatedVideoActionButton(label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button--secondary button--small";
  button.textContent = label;
  return button;
}

export function createGeneratedVideoUi(dependencies: GeneratedVideoUiDependencies): GeneratedVideoUiController {
  const generatedSupplementButton = element<HTMLButtonElement>("generated-supplement");
  const generatedRefreshButton = element<HTMLButtonElement>("generated-refresh");
  const generatedProjectName = element<HTMLElement>("generated-project-name");
  const generatedStatus = element<HTMLElement>("generated-status");
  const generatedVideoList = element<HTMLElement>("generated-video-list");
  const generatedEmpty = element<HTMLElement>("generated-empty");
  const api = generatedVideoApi(dependencies.controlPlane);

  let loadToken = 0;
  let previewToken = 0;
  let pollTimer: number | null = null;
  let refreshInFlight = false;
  let refreshPending = false;
  let signature = "";
  let unchangedPollCount = 0;

  const setStatus = (message: string, error = false): void => {
    generatedStatus.textContent = message;
    generatedStatus.classList.toggle("is-error", error);
  };

  const runAction = async (
    button: HTMLButtonElement,
    busyLabel: string,
    action: () => Promise<void>
  ): Promise<void> => {
    if (button.disabled) return;
    const original = button.textContent ?? "";
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.textContent = busyLabel;
    try {
      await action();
    } catch (error) {
      dependencies.showFeedback({ kind: "error", title: "视频操作未完成", message: dependencies.publicError(error) });
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        button.setAttribute("aria-busy", "false");
        button.textContent = original;
      }
    }
  };

  const stopPolling = (): void => {
    if (pollTimer !== null) window.clearTimeout(pollTimer);
    pollTimer = null;
  };

  const viewIsPollable = (): boolean => {
    const view = document.getElementById("view-generated");
    return view !== null && !view.hidden && document.visibilityState !== "hidden";
  };

  const resetBackoff = (): void => {
    unchangedPollCount = 0;
  };

  const videosSignature = (videos: readonly GeneratedVideoContract[]): string => JSON.stringify(videos.map((video) => [
    video.resultId,
    video.sha256,
    video.fileName,
    video.byteLength,
    video.discoveredAt,
    video.technicalInspection.status,
    video.technicalInspection.message
  ]));

  const renderCard = (
    projectContext: GeneratedVideoProjectContext,
    video: GeneratedVideoContract,
    cardPreviewToken: number
  ): HTMLElement => {
    if (api === null) throw new Error("当前构建未提供结果库服务。");
    const article = document.createElement("article");
    article.className = "surface generated-video-card";
    article.setAttribute("role", "listitem");
    article.dataset.resultId = video.resultId;

    const poster = document.createElement("figure");
    poster.className = "generated-video-poster";
    const posterFallback = document.createElement("span");
    posterFallback.className = "generated-video-poster__fallback";
    posterFallback.textContent = "正在读取视频封面…";
    const playPoster = document.createElement("button");
    playPoster.type = "button";
    playPoster.className = "generated-video-poster__play";
    playPoster.setAttribute("aria-label", `播放 ${video.fileName}`);
    playPoster.title = "使用系统播放器打开";
    playPoster.textContent = "▶";
    poster.append(posterFallback, playPoster);

    const body = document.createElement("div");
    body.className = "generated-video-card__body";
    const heading = document.createElement("header");
    heading.className = "generated-video-card__heading";
    const headingCopy = document.createElement("div");
    const title = document.createElement("h2");
    title.textContent = video.fileName;
    title.title = video.fileName;
    const discovered = document.createElement("p");
    const discoveredAt = new Date(video.discoveredAt);
    discovered.textContent = Number.isNaN(discoveredAt.valueOf())
      ? "发现时间未记录"
      : `发现于 ${discoveredAt.toLocaleString("zh-CN")}`;
    headingCopy.append(title, discovered);
    const source = document.createElement("span");
    source.className = "status-badge generated-video-card__source";
    source.textContent = video.source === "automatic" ? "自动发现" : "手动补录";
    heading.append(headingCopy, source);

    const facts = document.createElement("dl");
    facts.className = "generated-video-facts";
    facts.append(
      generatedFact("格式", video.container.toUpperCase()),
      generatedFact("大小", dependencies.formatBytes(video.byteLength)),
      generatedFact("工作流", video.workflowId === null ? "补录结果" : video.workflowId, video.workflowId ?? undefined),
      generatedFact("完整性", "SHA-256 已校验")
    );
    const inspection = document.createElement("p");
    inspection.className = "generated-video-inspection";
    inspection.classList.toggle("is-warning", video.technicalInspection.status !== "verified");
    inspection.textContent = generatedVideoTechnicalSummary(video);
    const diagnostics = document.createElement("details");
    diagnostics.className = "generated-video-diagnostics";
    const diagnosticsSummary = document.createElement("summary");
    diagnosticsSummary.textContent = "诊断信息";
    const diagnosticsFacts = document.createElement("dl");
    diagnosticsFacts.append(
      generatedFact("结果 ID", video.resultId, video.resultId),
      generatedFact("SHA-256", video.sha256, video.sha256)
    );
    diagnostics.append(diagnosticsSummary, diagnosticsFacts);

    const actions = document.createElement("div");
    actions.className = "generated-video-card__actions";
    const play = generatedVideoActionButton("播放");
    const reveal = generatedVideoActionButton("显示所在目录");
    const addAsset = generatedVideoActionButton("加入项目素材库");
    const playVideo = async (button: HTMLButtonElement): Promise<void> => runAction(button, "正在打开…", async () => {
      if (!dependencies.isProjectContextCurrent(projectContext)) return;
      const result = await api.playGeneratedVideo({ projectId: projectContext.projectId, resultId: video.resultId });
      if (!dependencies.isProjectContextCurrent(projectContext)) return;
      if (!result.opened) throw new Error(result.errorCode ?? "系统播放器未能打开该视频。");
    });
    play.addEventListener("click", () => void playVideo(play));
    playPoster.addEventListener("click", () => void playVideo(playPoster));
    reveal.addEventListener("click", () => void runAction(reveal, "正在打开…", async () => {
      if (!dependencies.isProjectContextCurrent(projectContext)) return;
      const result = await api.showGeneratedVideoInFolder({ projectId: projectContext.projectId, resultId: video.resultId });
      if (!dependencies.isProjectContextCurrent(projectContext)) return;
      if (!result.opened) throw new Error(result.errorCode ?? "系统未能显示视频所在目录。");
    }));
    addAsset.addEventListener("click", () => void runAction(addAsset, "正在复制并校验…", async () => {
      const mutation = await dependencies.flushAndCaptureProjectMutation();
      if (mutation.projectId !== projectContext.projectId) {
        throw new Error("项目已经切换，请在当前项目中重新打开该视频。");
      }
      const result = await api.addGeneratedVideoToProjectAssets({
        projectId: mutation.projectId,
        resultId: video.resultId
      });
      if (!dependencies.isProjectContextCurrent(mutation)) return;
      if (!await dependencies.synchronizeProjectMutation(mutation)) return;
      if (!dependencies.isProjectContextCurrent(mutation)) return;
      await dependencies.reloadProjectAssets(mutation);
      if (!dependencies.isProjectContextCurrent(mutation)) return;
      dependencies.showFeedback({
        kind: "success",
        title: result.status === "added" ? "已加入项目素材库" : "项目素材库已有相同视频",
        message: result.status === "added"
          ? "项目副本已复制并通过 SHA-256 校验；ComfyUI 原始视频保持不变。"
          : "未重复复制文件；ComfyUI 原始视频保持不变。"
      });
    }));
    actions.append(play, reveal, addAsset);
    body.append(heading, facts, inspection, diagnostics, actions);
    article.append(poster, body);

    void api.getGeneratedVideoPreview({ projectId: projectContext.projectId, resultId: video.resultId })
      .then((preview) => {
        if (cardPreviewToken !== previewToken
          || !dependencies.isProjectContextCurrent(projectContext)
          || !article.isConnected) return;
        if (preview.status === "ready" && preview.kind === "video_poster" && preview.dataUrl !== null) {
          const image = document.createElement("img");
          image.src = preview.dataUrl;
          image.alt = `${video.fileName} 视频封面`;
          image.decoding = "async";
          posterFallback.replaceWith(image);
          return;
        }
        posterFallback.textContent = preview.message ?? "无法生成封面";
      })
      .catch(() => {
        if (cardPreviewToken === previewToken
          && dependencies.isProjectContextCurrent(projectContext)
          && article.isConnected) posterFallback.textContent = "无法生成封面";
      });
    return article;
  };

  let refresh: (quiet?: boolean) => Promise<void>;

  const schedulePoll = (): void => {
    stopPolling();
    if (!viewIsPollable()) return;
    const delay = GENERATED_VIDEO_POLL_DELAYS_MS[Math.min(
      unchangedPollCount,
      GENERATED_VIDEO_POLL_DELAYS_MS.length - 1
    )] ?? GENERATED_VIDEO_POLL_DELAYS_MS[0];
    pollTimer = window.setTimeout(() => {
      pollTimer = null;
      void refresh(true);
    }, delay);
  };

  refresh = async (quiet = false): Promise<void> => {
    if (refreshInFlight) {
      if (!quiet) {
        refreshPending = true;
        resetBackoff();
      }
      return;
    }
    if (!quiet) resetBackoff();
    refreshInFlight = true;
    stopPolling();
    const requestToken = ++loadToken;
    const projectContext = dependencies.getProjectContext();
    if (!quiet) {
      generatedVideoList.replaceChildren();
      generatedEmpty.hidden = true;
    }
    generatedProjectName.textContent = projectContext?.projectName ?? "尚未打开项目";
    if (!quiet) setButtonBusy(generatedRefreshButton, true, "正在刷新…");
    generatedVideoList.setAttribute("aria-busy", "true");
    if (!quiet) setStatus("正在检查当前项目的稳定视频结果…");
    try {
      if (projectContext === null) {
        generatedSupplementButton.disabled = true;
        generatedRefreshButton.disabled = true;
        generatedEmpty.hidden = false;
        setStatus("打开项目后即可查看已生成视频。");
        return;
      }
      if (api === null) {
        generatedSupplementButton.disabled = true;
        generatedRefreshButton.disabled = true;
        generatedEmpty.hidden = false;
        setStatus("当前构建未提供结果库服务，无法列出或补录视频。", true);
        return;
      }
      generatedSupplementButton.disabled = false;
      const result = await api.listGeneratedVideos({ projectId: projectContext.projectId });
      if (requestToken !== loadToken || !dependencies.isProjectContextCurrent(projectContext)) return;
      const videos = [...result.videos];
      const nextSignature = videosSignature(videos);
      if (quiet && nextSignature === signature) {
        unchangedPollCount += 1;
        if (generatedStatus.classList.contains("is-error")) {
          setStatus(videos.length === 0 ? "没有发现已完成且通过检查的视频。" : `已找到 ${videos.length} 个可用视频。`);
        }
        return;
      }
      resetBackoff();
      signature = nextSignature;
      const cardPreviewToken = ++previewToken;
      generatedVideoList.replaceChildren(...videos.map((video) => renderCard(projectContext, video, cardPreviewToken)));
      generatedEmpty.hidden = videos.length !== 0;
      setStatus(videos.length === 0 ? "没有发现已完成且通过检查的视频。" : `已找到 ${videos.length} 个可用视频。`);
    } catch (error) {
      if (requestToken !== loadToken
        || projectContext === null
        || !dependencies.isProjectContextCurrent(projectContext)) return;
      unchangedPollCount += 1;
      if (!quiet || generatedVideoList.childElementCount === 0) generatedEmpty.hidden = false;
      setStatus(`结果库暂不可用：${dependencies.publicError(error)}`, true);
    } finally {
      if (requestToken === loadToken) {
        generatedVideoList.setAttribute("aria-busy", "false");
        if (!quiet) setButtonBusy(generatedRefreshButton, false, "刷新");
      }
      refreshInFlight = false;
      const pending = refreshPending;
      refreshPending = false;
      if (viewIsPollable()) {
        if (pending) queueMicrotask(() => void refresh());
        else schedulePoll();
      }
    }
  };

  generatedRefreshButton.addEventListener("click", () => {
    resetBackoff();
    void refresh();
  });
  document.addEventListener("visibilitychange", () => {
    if (!viewIsPollable()) {
      stopPolling();
      return;
    }
    resetBackoff();
    void refresh(true);
  });
  generatedSupplementButton.addEventListener("click", () => {
    const projectContext = dependencies.getProjectContext();
    if (projectContext === null || api === null || generatedSupplementButton.disabled) return;
    stopPolling();
    setButtonBusy(generatedSupplementButton, true, "正在选择…");
    void api.supplementGeneratedVideo({ projectId: projectContext.projectId })
      .then(async (result) => {
        if (!dependencies.isProjectContextCurrent(projectContext)) return;
        if (result.cancelled) {
          setStatus("已取消补录，项目结果未更改。");
          return;
        }
        if (result.status === "rejected") throw new Error(result.message ?? "所选文件未通过视频检查。");
        await refresh();
        if (!dependencies.isProjectContextCurrent(projectContext)) return;
        dependencies.showFeedback({
          kind: result.status === "duplicate" ? "warning" : "success",
          title: result.status === "duplicate" ? "该视频已经补录" : "视频已补录",
          message: result.status === "duplicate"
            ? "当前项目已有同一 SHA-256 的视频记录。"
            : "视频已通过稳定性、格式与完整性检查。"
        });
      })
      .catch((error: unknown) => {
        if (dependencies.isProjectContextCurrent(projectContext)) {
          dependencies.showFeedback({ kind: "error", title: "视频未补录", message: dependencies.publicError(error) });
        }
      })
      .finally(() => {
        if (!dependencies.isProjectContextCurrent(projectContext)) return;
        setButtonBusy(generatedSupplementButton, false, "补录已有视频");
        schedulePoll();
      });
  });

  return Object.freeze({
    refresh: (quiet = false) => refresh(quiet),
    activate: () => {
      resetBackoff();
      void refresh();
    },
    deactivate: stopPolling,
    invalidateProject: () => {
      loadToken += 1;
      previewToken += 1;
      signature = "";
      refreshPending = false;
      stopPolling();
    }
  });
}
