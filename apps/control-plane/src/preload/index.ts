import { contextBridge, ipcRenderer, webUtils } from "electron";

import {
  IPC_REGISTRY,
  type AboutLinkTarget,
  type AssetCopyToProjectRequest,
  type AssetLibraryApi,
  type AssetListRequest,
  type AssetMetadataUpdateRequest,
  type AssetPrepareFrameRequest,
  type AssetRelocateConfirmRequest,
  type AssetRelocateRequest,
  type CancelInstallationRequest,
  type CompileAndOpenWorkflowRequest,
  type CompileAndOpenWorkflowResult,
  type ControlPlaneApi,
  type ControlPlanePublicError,
  type DirectoryKind,
  type ExecuteInstallationRequest,
  type FrameSlot,
  type PrepareInstallationRequest,
  type ConfigureDataRootRequest,
  type ProjectAssetBindRequestContract,
  type ProjectAssetDropImportRequestContract,
  type ProjectAssetFrameRequestContract,
  type ProjectAssetIdRequestContract,
  type ProjectAssetImportRequestContract,
  type ProjectAssetListRequestContract,
  type ProjectAssetUnbindRequestContract,
  type ProjectAssetUpdateRequestContract,
  type QueryInstallationRequest,
  type RelayProjectBundleRequest,
  type RelayProjectCloneRequest,
  type RelayProjectCreateRequest,
  type RelayProjectIdRequest,
  type RelayProjectSaveRequest,
  type RendererControlPlaneApi,
  type ScanInstallationRequest,
  type UiTheme
} from "../shared/ipc-contract";
import type { UpdateDownloadKind } from "../shared/update-source";

const HANDOFF_QUERY_INTERVAL_MS = 200;
const HANDOFF_QUERY_DEADLINE_MS = 180_000;
const HANDOFF_IPC_DEADLINE_MS = 5_000;
const MAX_DROPPED_PROJECT_ASSETS = 512;
const MAX_WINDOWS_PATH_LENGTH = 32_767;

function resolveDroppedProjectAssetPaths(files: readonly File[]): readonly string[] {
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_DROPPED_PROJECT_ASSETS) {
    throw new TypeError("请选择 1–512 个本地素材文件。");
  }
  const paths = files.map((file) => {
    let path: string;
    try {
      path = webUtils.getPathForFile(file);
    } catch {
      throw new TypeError("拖放内容不是可读取的本地文件。");
    }
    if (
      typeof path !== "string" ||
      path.length === 0 ||
      path.length > MAX_WINDOWS_PATH_LENGTH ||
      path.trim() !== path ||
      /[\u0000-\u001f]/u.test(path)
    ) {
      throw new TypeError("拖放文件没有可验证的本地路径。");
    }
    return path;
  });
  return Object.freeze(paths);
}

type WorkflowHandoffStatus =
  | { readonly state: "pending" }
  | { readonly state: "succeeded"; readonly result: CompileAndOpenWorkflowResult }
  | { readonly state: "failed"; readonly error: ControlPlanePublicError };

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function invokeWithDeadline<T>(channel: string, input: unknown): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("本机交接服务响应超时，请重试。")), HANDOFF_IPC_DEADLINE_MS);
  });
  try {
    return await Promise.race([ipcRenderer.invoke(channel, input) as Promise<T>, timeout]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

async function compileAndOpenWorkflow(
  request: CompileAndOpenWorkflowRequest
): Promise<CompileAndOpenWorkflowResult> {
  const started = await invokeWithDeadline<{ readonly operationId: string }>(
    IPC_REGISTRY.compileAndOpenWorkflow,
    request
  );
  const deadline = Date.now() + HANDOFF_QUERY_DEADLINE_MS;
  while (Date.now() < deadline) {
    const status = await invokeWithDeadline<WorkflowHandoffStatus>(
      IPC_REGISTRY.queryWorkflowHandoff,
      { operationId: started.operationId }
    );
    if (status.state === "succeeded") return status.result;
    if (status.state === "failed") {
      throw Object.assign(new Error(status.error.message), {
        name: status.error.name,
        code: status.error.code
      });
    }
    await delay(HANDOFF_QUERY_INTERVAL_MS);
  }
  throw new Error(
    "交接完成状态在三分钟内未返回，Relay 无法确认本次工作流是否已写入或打开；没有提交运行任务。请重试，并以 ComfyUI 当前标签或工作流目录中的实际文件为准。"
  );
}

const controlPlaneApi: RendererControlPlaneApi = Object.freeze({
  getBootstrap: () =>
    ipcRenderer.invoke(IPC_REGISTRY.getBootstrap) as ReturnType<
      ControlPlaneApi["getBootstrap"]
    >,
  scanInstallation: (request: ScanInstallationRequest) =>
    ipcRenderer.invoke(IPC_REGISTRY.scanInstallation, request) as ReturnType<
      ControlPlaneApi["scanInstallation"]
    >,
  prepareInstallation: (request: PrepareInstallationRequest) =>
    ipcRenderer.invoke(IPC_REGISTRY.prepareInstallation, request) as ReturnType<
      ControlPlaneApi["prepareInstallation"]
    >,
  executeInstallation: (request: ExecuteInstallationRequest) =>
    ipcRenderer.invoke(IPC_REGISTRY.executeInstallation, request) as ReturnType<
      ControlPlaneApi["executeInstallation"]
    >,
  queryInstallation: (request: QueryInstallationRequest) =>
    ipcRenderer.invoke(IPC_REGISTRY.queryInstallation, request) as ReturnType<
      ControlPlaneApi["queryInstallation"]
    >,
  cancelInstallation: (request: CancelInstallationRequest) =>
    ipcRenderer.invoke(IPC_REGISTRY.cancelInstallation, request) as ReturnType<
      ControlPlaneApi["cancelInstallation"]
    >,
  chooseDirectory: (kind: DirectoryKind) =>
    ipcRenderer.invoke(IPC_REGISTRY.chooseDirectory, kind) as ReturnType<
      ControlPlaneApi["chooseDirectory"]
    >,
  chooseFrame: (slot: FrameSlot) =>
    ipcRenderer.invoke(IPC_REGISTRY.chooseFrame, slot) as ReturnType<
      ControlPlaneApi["chooseFrame"]
    >,
  chooseResultMedia: () =>
    ipcRenderer.invoke(IPC_REGISTRY.chooseResultMedia) as ReturnType<
      ControlPlaneApi["chooseResultMedia"]
    >,
  chooseExportDirectory: () =>
    ipcRenderer.invoke(IPC_REGISTRY.chooseExportDirectory) as ReturnType<
      ControlPlaneApi["chooseExportDirectory"]
    >,
  importLocalAssets: () =>
    ipcRenderer.invoke(IPC_REGISTRY.importLocalAssets) as ReturnType<
      AssetLibraryApi["importLocalAssets"]
    >,
  listLocalAssets: (request: AssetListRequest) =>
    ipcRenderer.invoke(IPC_REGISTRY.listLocalAssets, request) as ReturnType<
      AssetLibraryApi["listLocalAssets"]
    >,
  updateLocalAsset: (request: AssetMetadataUpdateRequest) =>
    ipcRenderer.invoke(IPC_REGISTRY.updateLocalAsset, request) as ReturnType<
      AssetLibraryApi["updateLocalAsset"]
    >,
  refreshLocalAssets: () =>
    ipcRenderer.invoke(IPC_REGISTRY.refreshLocalAssets) as ReturnType<
      AssetLibraryApi["refreshLocalAssets"]
    >,
  relocateLocalAsset: (request: AssetRelocateRequest) =>
    ipcRenderer.invoke(IPC_REGISTRY.relocateLocalAsset, request) as ReturnType<
      AssetLibraryApi["relocateLocalAsset"]
    >,
  confirmLocalAssetReplacement: (request: AssetRelocateConfirmRequest) =>
    ipcRenderer.invoke(IPC_REGISTRY.confirmLocalAssetReplacement, request) as ReturnType<
      AssetLibraryApi["confirmLocalAssetReplacement"]
    >,
  copyLocalAssetToProject: (request: AssetCopyToProjectRequest) =>
    ipcRenderer.invoke(IPC_REGISTRY.copyLocalAssetToProject, request) as ReturnType<
      AssetLibraryApi["copyLocalAssetToProject"]
    >,
  prepareLocalAssetFrame: (request: AssetPrepareFrameRequest) =>
    ipcRenderer.invoke(IPC_REGISTRY.prepareLocalAssetFrame, request) as ReturnType<
      AssetLibraryApi["prepareLocalAssetFrame"]
    >,
  setUiTheme: (theme: UiTheme) =>
    ipcRenderer.invoke(IPC_REGISTRY.setUiTheme, theme) as ReturnType<
      RendererControlPlaneApi["setUiTheme"]
    >,
  getProjectCenter: () =>
    ipcRenderer.invoke(IPC_REGISTRY.getProjectCenter) as ReturnType<RendererControlPlaneApi["getProjectCenter"]>,
  createRelayProject: (request: RelayProjectCreateRequest) =>
    ipcRenderer.invoke(IPC_REGISTRY.createRelayProject, request) as ReturnType<RendererControlPlaneApi["createRelayProject"]>,
  loadRelayProject: (request: RelayProjectIdRequest) =>
    ipcRenderer.invoke(IPC_REGISTRY.loadRelayProject, request) as ReturnType<RendererControlPlaneApi["loadRelayProject"]>,
  saveRelayProject: (request: RelayProjectSaveRequest) =>
    ipcRenderer.invoke(IPC_REGISTRY.saveRelayProject, request) as ReturnType<RendererControlPlaneApi["saveRelayProject"]>,
  cloneRelayProject: (request: RelayProjectCloneRequest) =>
    ipcRenderer.invoke(IPC_REGISTRY.cloneRelayProject, request) as ReturnType<RendererControlPlaneApi["cloneRelayProject"]>,
  archiveRelayProject: (request: RelayProjectIdRequest) =>
    ipcRenderer.invoke(IPC_REGISTRY.archiveRelayProject, request) as ReturnType<RendererControlPlaneApi["archiveRelayProject"]>,
  restoreRelayProject: (request: RelayProjectIdRequest) =>
    ipcRenderer.invoke(IPC_REGISTRY.restoreRelayProject, request) as ReturnType<RendererControlPlaneApi["restoreRelayProject"]>,
  chooseAndConfigureDataRoot: (request: ConfigureDataRootRequest) =>
    ipcRenderer.invoke(IPC_REGISTRY.chooseAndConfigureDataRoot, request) as ReturnType<RendererControlPlaneApi["chooseAndConfigureDataRoot"]>,
  openDataRoot: () =>
    ipcRenderer.invoke(IPC_REGISTRY.openDataRoot) as ReturnType<RendererControlPlaneApi["openDataRoot"]>,
  getUpdateCheckCache: () =>
    ipcRenderer.invoke(IPC_REGISTRY.getUpdateCheckCache) as ReturnType<RendererControlPlaneApi["getUpdateCheckCache"]>,
  checkForUpdates: () =>
    ipcRenderer.invoke(IPC_REGISTRY.checkForUpdates) as ReturnType<RendererControlPlaneApi["checkForUpdates"]>,
  downloadUpdate: (request: { readonly kind: UpdateDownloadKind }) =>
    ipcRenderer.invoke(IPC_REGISTRY.downloadUpdate, request) as ReturnType<RendererControlPlaneApi["downloadUpdate"]>,
  getUpdateDownloadStatus: () =>
    ipcRenderer.invoke(IPC_REGISTRY.getUpdateDownloadStatus) as ReturnType<RendererControlPlaneApi["getUpdateDownloadStatus"]>,
  cancelUpdateDownload: () =>
    ipcRenderer.invoke(IPC_REGISTRY.cancelUpdateDownload) as ReturnType<RendererControlPlaneApi["cancelUpdateDownload"]>,
  openDownloadedUpdateFolder: () =>
    ipcRenderer.invoke(IPC_REGISTRY.openDownloadedUpdateFolder) as ReturnType<RendererControlPlaneApi["openDownloadedUpdateFolder"]>,
  openValidatedReleasePage: () =>
    ipcRenderer.invoke(IPC_REGISTRY.openValidatedReleasePage) as ReturnType<RendererControlPlaneApi["openValidatedReleasePage"]>,
  openAboutLink: (target: AboutLinkTarget) =>
    ipcRenderer.invoke(IPC_REGISTRY.openAboutLink, target) as ReturnType<RendererControlPlaneApi["openAboutLink"]>,
  listGeneratedVideos: (request: { readonly projectId: string }) =>
    ipcRenderer.invoke(IPC_REGISTRY.listGeneratedVideos, request) as ReturnType<RendererControlPlaneApi["listGeneratedVideos"]>,
  supplementGeneratedVideo: (request: { readonly projectId: string }) =>
    ipcRenderer.invoke(IPC_REGISTRY.supplementGeneratedVideo, request) as ReturnType<RendererControlPlaneApi["supplementGeneratedVideo"]>,
  getGeneratedVideoPreview: (request: { readonly projectId: string; readonly resultId: string }) =>
    ipcRenderer.invoke(IPC_REGISTRY.getGeneratedVideoPreview, request) as ReturnType<RendererControlPlaneApi["getGeneratedVideoPreview"]>,
  playGeneratedVideo: (request: { readonly projectId: string; readonly resultId: string }) =>
    ipcRenderer.invoke(IPC_REGISTRY.playGeneratedVideo, request) as ReturnType<RendererControlPlaneApi["playGeneratedVideo"]>,
  showGeneratedVideoInFolder: (request: { readonly projectId: string; readonly resultId: string }) =>
    ipcRenderer.invoke(IPC_REGISTRY.showGeneratedVideoInFolder, request) as ReturnType<RendererControlPlaneApi["showGeneratedVideoInFolder"]>,
  addGeneratedVideoToProjectAssets: (request: { readonly projectId: string; readonly resultId: string }) =>
    ipcRenderer.invoke(IPC_REGISTRY.addGeneratedVideoToProjectAssets, request) as ReturnType<RendererControlPlaneApi["addGeneratedVideoToProjectAssets"]>,
  importProjectAssets: (request: ProjectAssetImportRequestContract) =>
    ipcRenderer.invoke(IPC_REGISTRY.importProjectAssets, request) as ReturnType<RendererControlPlaneApi["importProjectAssets"]>,
  importDroppedProjectAssets: (request: ProjectAssetDropImportRequestContract, files: readonly File[]) =>
    ipcRenderer.invoke(IPC_REGISTRY.importDroppedProjectAssets, {
      projectId: request.projectId,
      ...(request.mode === undefined ? {} : { mode: request.mode }),
      paths: resolveDroppedProjectAssetPaths(files)
    }) as ReturnType<RendererControlPlaneApi["importDroppedProjectAssets"]>,
  listProjectAssets: (request: ProjectAssetListRequestContract) =>
    ipcRenderer.invoke(IPC_REGISTRY.listProjectAssets, request) as ReturnType<RendererControlPlaneApi["listProjectAssets"]>,
  updateProjectAsset: (request: ProjectAssetUpdateRequestContract) =>
    ipcRenderer.invoke(IPC_REGISTRY.updateProjectAsset, request) as ReturnType<RendererControlPlaneApi["updateProjectAsset"]>,
  refreshProjectAssets: (request: RelayProjectIdRequest) =>
    ipcRenderer.invoke(IPC_REGISTRY.refreshProjectAssets, request) as ReturnType<RendererControlPlaneApi["refreshProjectAssets"]>,
  relocateProjectAsset: (request: ProjectAssetIdRequestContract) =>
    ipcRenderer.invoke(IPC_REGISTRY.relocateProjectAsset, request) as ReturnType<RendererControlPlaneApi["relocateProjectAsset"]>,
  removeProjectAsset: (request: ProjectAssetIdRequestContract) =>
    ipcRenderer.invoke(IPC_REGISTRY.removeProjectAsset, request) as ReturnType<RendererControlPlaneApi["removeProjectAsset"]>,
  listDeletedProjectAssets: (request: RelayProjectIdRequest) =>
    ipcRenderer.invoke(IPC_REGISTRY.listDeletedProjectAssets, request) as ReturnType<RendererControlPlaneApi["listDeletedProjectAssets"]>,
  restoreProjectAsset: (request: ProjectAssetIdRequestContract) =>
    ipcRenderer.invoke(IPC_REGISTRY.restoreProjectAsset, request) as ReturnType<RendererControlPlaneApi["restoreProjectAsset"]>,
  getProjectAssetPreview: (request: ProjectAssetIdRequestContract) =>
    ipcRenderer.invoke(IPC_REGISTRY.getProjectAssetPreview, request) as ReturnType<RendererControlPlaneApi["getProjectAssetPreview"]>,
  bindProjectAsset: (request: ProjectAssetBindRequestContract) =>
    ipcRenderer.invoke(IPC_REGISTRY.bindProjectAsset, request) as ReturnType<RendererControlPlaneApi["bindProjectAsset"]>,
  unbindProjectAsset: (request: ProjectAssetUnbindRequestContract) =>
    ipcRenderer.invoke(IPC_REGISTRY.unbindProjectAsset, request) as ReturnType<RendererControlPlaneApi["unbindProjectAsset"]>,
  revealProjectAsset: (request: ProjectAssetIdRequestContract) =>
    ipcRenderer.invoke(IPC_REGISTRY.revealProjectAsset, request) as ReturnType<RendererControlPlaneApi["revealProjectAsset"]>,
  prepareProjectAssetFrame: (request: ProjectAssetFrameRequestContract) =>
    ipcRenderer.invoke(IPC_REGISTRY.prepareProjectAssetFrame, request) as ReturnType<RendererControlPlaneApi["prepareProjectAssetFrame"]>,
  copyProjectAssetIntoProject: (request: ProjectAssetIdRequestContract) =>
    ipcRenderer.invoke(IPC_REGISTRY.copyProjectAssetIntoProject, request) as ReturnType<RendererControlPlaneApi["copyProjectAssetIntoProject"]>,
  exportRelayProjectBundle: (request: RelayProjectBundleRequest) =>
    ipcRenderer.invoke(IPC_REGISTRY.exportRelayProjectBundle, request) as ReturnType<RendererControlPlaneApi["exportRelayProjectBundle"]>,
  importRelayProjectBundle: () =>
    ipcRenderer.invoke(IPC_REGISTRY.importRelayProjectBundle) as ReturnType<RendererControlPlaneApi["importRelayProjectBundle"]>,
  compileAndOpenWorkflow
});

contextBridge.exposeInMainWorld("controlPlane", controlPlaneApi);
