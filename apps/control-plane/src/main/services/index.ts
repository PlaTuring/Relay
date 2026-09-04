import { createHash, randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { basename, extname, isAbsolute, join, normalize, resolve } from "node:path";

import { dialog } from "electron";

import {
  APPLICATION_IDENTITY,
  BRANDING_AUTHORITY,
  MINIMAX_H3_LICENSE,
  PRODUCT_BOUNDARY,
  type BootstrapState,
  type CancelInstallationRequest,
  type CompileAndOpenWorkflowRequest,
  type CompileAndOpenWorkflowResult,
  type ComponentId,
  type ControlPlaneApi,
  type DirectoryKind,
  type DirectorySelection,
  type ExecuteInstallationRequest,
  type ExportDirectorySelection,
  type FrameSelection,
  type FrameSlot,
  type InstallationStatusResult,
  type PrepareInstallationRequest,
  type PrepareInstallationResult,
  type QueryInstallationRequest,
  type ResultMediaSelection,
  type ScanInstallationRequest,
  type ScanInstallationResult
} from "../../shared/ipc-contract.js";
import type { UpdateDownloadKind } from "../../shared/update-source.js";
import type { RelayProjectDocument } from "../../shared/project-domain.js";
import {
  relayCompileShotIds,
  resolveRelaySeedPlan,
  type RelayResolvedSeedPlan
} from "../../shared/seed-policy.js";
import { createAbCliAdapter } from "./ab-cli-adapter.js";
import {
  ControlPlaneServiceError,
  toControlPlanePublicError
} from "./errors.js";
import {
  createMockInstallationController,
  createMockPrepare,
  createMockScan
} from "./mock.js";
import {
  requireKnownSelection,
  validateCancelInstallationRequest,
  validateCompileRequest,
  validateExecuteInstallationRequest,
  validateFrameSlot,
  validatePrepareRequest,
  validateQueryInstallationRequest,
  validateScanRequest
} from "./validation.js";
import {
  assignUserWorkflowIdentity,
  exportDeterministicWorkflow
} from "./workflow-export.js";
import { stageProjectFrames } from "./frame-staging.js";
import {
  verifyUserSelectedComfyRoot,
  type VerifiedComfyRoot
} from "./comfy-root.js";
import {
  showWorkflowInComfyWindow,
  storeWorkflowInComfyLibrary,
  type ComfyHandoffTimingEvidence
} from "./comfy-handoff.js";
import {
  writeCompileAndOpenTimingEvidence,
  type CompileAndOpenTimingStage
} from "./comfy-handoff-timing-log.js";
import { assertComfySessionSupportsWorkflow } from "./comfy-session-capability.js";
import {
  inspectPersistedComponents,
  loadSetupPreferences,
  saveSetupPreferences,
  verifySavedDirectory,
  type SetupPreferences
} from "./setup-preferences.js";
import {
  createProjectRepository,
  type RelayProjectRepository
} from "./project-repository.js";
import { createProjectWorkflowStore } from "./project-workflow-store.js";
import { resolveProjectDirectoryLayout } from "./data-root.js";
import { createGithubUpdateCheckService } from "./github-update-check.js";
import { createGithubUpdateDownloadService } from "./github-update-download.js";
import type { GeneratedVideoService } from "./generated-video-service.js";
import {
  allocateWorkflowId,
  applyWorkflowOutputAttribution
} from "./generated-video-output-attribution.js";
import { normalizeInstallationComponents } from "./installation-component-policy.js";

export { createProjectRepository } from "./project-repository.js";

export { ControlPlaneServiceError, toControlPlanePublicError } from "./errors.js";

const COMFY_UI_ORIGIN = "http://127.0.0.1:8188/" as const;
const DEFAULT_WORKFLOW_DIRECTORY_NAME = "工作流文件";
const RESULT_MEDIA_EXTENSION_GROUPS = Object.freeze({
  image: Object.freeze(["png", "jpg", "jpeg", "webp", "bmp", "gif", "tif", "tiff"]),
  video: Object.freeze(["mp4", "mov", "m4v", "mkv", "webm", "avi", "mpg", "mpeg"]),
  audio: Object.freeze(["wav", "mp3", "flac", "m4a", "aac", "ogg", "opus"])
});
const RESULT_MEDIA_EXTENSIONS = new Set<string>([
  ...RESULT_MEDIA_EXTENSION_GROUPS.image,
  ...RESULT_MEDIA_EXTENSION_GROUPS.video,
  ...RESULT_MEDIA_EXTENSION_GROUPS.audio
]);

export interface CreateControlPlaneServicesOptions {
  readonly appVersion: string;
  readonly userDataPath: string;
  /** Optional Alpha 28 filename inside userDataPath/config; legacy tests keep the old default. */
  readonly setupPreferencesFileName?: string;
  /** Alpha 28 business-data root. Required only for project-owned workflow authority. */
  readonly dataRootPath?: string;
  /** Test/integration seam; when omitted, a repository is opened below dataRootPath. */
  readonly projectRepository?: RelayProjectRepository;
  readonly appPath: string;
  readonly executableDirectory: string;
  readonly resourcesPath: string;
  readonly isPackaged: boolean;
  readonly enableExternalAdapters?: boolean;
  readonly allowMockFallback?: boolean;
  readonly skipVisibleOpen?: boolean;
  readonly preferredUpdateKind?: UpdateDownloadKind;
  readonly openUpdateDownloadFolder?: (folderPath: string) => void | Promise<void>;
  readonly openValidatedUpdateRelease?: (url: string) => void | Promise<void>;
  readonly launchValidatedUpdateInstaller?: (installerPath: string) => void | Promise<void>;
  readonly generatedVideoService?: GeneratedVideoService;
}

export interface ControlPlaneServices extends ControlPlaneApi {
  registerTrustedFrameSelection(
    absolutePath: string,
    slot: FrameSlot
  ): Promise<FrameSelection>;
}

type RestoredSetup = SetupPreferences & {
  readonly vramBytes: number | null;
};

function selectionId(kind: "frame" | "export", path: string): string {
  const canonical = normalize(path).toLocaleLowerCase("en-US");
  const digest = createHash("sha256").update(canonical, "utf8").digest("hex").slice(0, 24);
  return `${kind}_${digest}`;
}

function sameWindowsPath(left: string, right: string): boolean {
  return resolve(left).toLocaleLowerCase("en-US") === resolve(right).toLocaleLowerCase("en-US");
}

function monotonicElapsed(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

async function safelyVerifyComfyRoot(root: string | null): Promise<VerifiedComfyRoot | null> {
  try {
    return await verifyUserSelectedComfyRoot(root);
  } catch {
    return null;
  }
}

function validateFactoryOptions(options: CreateControlPlaneServicesOptions): void {
  if (
    typeof options.appVersion !== "string" ||
    options.appVersion.length === 0 ||
    options.appVersion.length > 80 ||
    !isAbsolute(options.userDataPath) ||
    !isAbsolute(options.appPath) ||
    !isAbsolute(options.executableDirectory) ||
    !isAbsolute(options.resourcesPath) ||
    (options.dataRootPath !== undefined && !isAbsolute(options.dataRootPath)) ||
    (
      options.dataRootPath !== undefined &&
      options.projectRepository !== undefined &&
      !sameWindowsPath(options.dataRootPath, options.projectRepository.dataRoot)
    )
  ) {
    throw new ControlPlaneServiceError("INVALID_REQUEST", "主进程服务配置无效。");
  }
}

function stableComfyReference(root: string): {
  readonly referenceId: string;
  readonly locatorId: string;
} {
  const canonical = normalize(resolve(root)).toLocaleLowerCase("en-US");
  const digest = createHash("sha256").update(canonical, "utf8").digest("hex");
  return Object.freeze({
    referenceId: `reference-comfy-${digest.slice(0, 32)}`,
    locatorId: `comfy-root-${digest}`
  });
}

export interface ProjectAuthorityHandoffEvidence {
  readonly workflowId: string;
  readonly workflowFileName: string;
  readonly authorityDirectory: string;
  readonly authoritySha256: string;
  readonly authorityByteLength: number;
  readonly targetRelativePath: string;
  readonly authoritativeProject: RelayProjectDocument;
}

/**
 * Persists one real compiled graph as the Relay-project authority, then copies
 * and verifies that exact authority in the selected attach-only ComfyUI. This
 * function never calls a generation endpoint and never submits or runs the graph.
 */
export async function storeAndHandoffProjectWorkflow(options: {
  readonly dataRootPath: string;
  readonly repository: RelayProjectRepository;
  readonly projectId: string;
  readonly workflowName: string;
  readonly workflowId?: string;
  readonly workflow: unknown;
  readonly seedResolution?: RelayResolvedSeedPlan | null;
  readonly comfyRoot: VerifiedComfyRoot;
}): Promise<ProjectAuthorityHandoffEvidence> {
  if (
    !isAbsolute(options.dataRootPath) ||
    !sameWindowsPath(options.dataRootPath, options.repository.dataRoot)
  ) {
    throw new TypeError("Project repository does not belong to the configured Relay data root.");
  }

  const stableReference = stableComfyReference(options.comfyRoot.root);
  const current = await options.repository.loadProject(options.projectId);
  const existing = current.externalReferences.find((candidate) =>
    candidate.kind === "comfyui_root" && candidate.locatorId === stableReference.locatorId
  );
  const targetComfyReferenceId = existing?.referenceId ?? stableReference.referenceId;
  if (existing === undefined) {
    const collision = current.externalReferences.find((candidate) =>
      candidate.referenceId === targetComfyReferenceId
    );
    if (collision !== undefined) {
      throw new TypeError("Stable ComfyUI reference collides with a different project reference.");
    }
    await options.repository.saveProject(Object.freeze({
      ...current,
      externalReferences: Object.freeze([...current.externalReferences, Object.freeze({
        referenceId: targetComfyReferenceId,
        kind: "comfyui_root" as const,
        displayName: "当前已连接的 ComfyUI",
        locatorId: stableReference.locatorId,
        expectedSha256: null,
        attachOnly: true as const
      })])
    }), { expectedUpdatedAt: current.updatedAt });
  }

  // A freshly installed ComfyUI may not have opened its user/default profile
  // yet. Creating the ordinary directory is safe; the workflow store then
  // rejects reparse points and verifies containment before copying any bytes.
  await mkdir(options.comfyRoot.workflowDirectory, { recursive: true });
  const workflowStore = createProjectWorkflowStore({
    dataRoot: options.dataRootPath,
    repository: options.repository
  });
  const authority = await workflowStore.storeAuthoritativeWorkflow({
    projectId: options.projectId,
    displayName: options.workflowName,
    workflow: options.workflow,
    seedResolution: options.seedResolution ?? null,
    ...(options.workflowId === undefined ? {} : { workflowId: options.workflowId })
  });
  const handedOff = await workflowStore.handoffAuthoritativeWorkflow({
    projectId: options.projectId,
    workflowId: authority.workflowId,
    targetComfyReferenceId,
    targetComfyRoot: options.comfyRoot.root,
    targetWorkflowDirectory: options.comfyRoot.workflowDirectory
  });
  const handoff = handedOff.handoffs.at(-1);
  if (
    handoff === undefined ||
    handoff.sha256 !== authority.sha256 ||
    handoff.byteLength !== authority.byteLength
  ) {
    throw new Error("Project workflow handoff evidence does not match its authority.");
  }
  const layout = resolveProjectDirectoryLayout(options.dataRootPath, options.projectId);
  const authoritativeProject = await options.repository.loadProject(options.projectId);
  return Object.freeze({
    workflowId: authority.workflowId,
    workflowFileName: basename(authority.projectRelativePath),
    authorityDirectory: layout.workflows,
    authoritySha256: authority.sha256,
    authorityByteLength: authority.byteLength,
    targetRelativePath: handoff.targetRelativePath,
    authoritativeProject
  });
}

function createResultMediaSelection(selectedPath: unknown): ResultMediaSelection {
  if (
    typeof selectedPath !== "string" ||
    selectedPath.length === 0 ||
    selectedPath.length > 32_767 ||
    selectedPath.includes("\u0000") ||
    !isAbsolute(selectedPath)
  ) {
    throw new ControlPlaneServiceError("INVALID_REQUEST", "系统返回了无效的结果文件路径。");
  }

  const extension = extname(selectedPath).slice(1).toLocaleLowerCase("en-US");
  if (!RESULT_MEDIA_EXTENSIONS.has(extension)) {
    throw new ControlPlaneServiceError("INVALID_REQUEST", "请选择受支持的图像、视频或音频文件。");
  }

  const displayName = basename(selectedPath);
  if (displayName.length === 0 || displayName.length > 255 || displayName.includes("\u0000")) {
    throw new ControlPlaneServiceError("INVALID_REQUEST", "系统返回了无效的结果文件名。");
  }

  return Object.freeze({ displayPath: selectedPath, displayName });
}

export function createControlPlaneServices(
  options: CreateControlPlaneServicesOptions
): ControlPlaneServices {
  validateFactoryOptions(options);
  const frameSelections = new Map<string, string>();
  const exportSelections = new Map<string, string>();
  const preparedInstallations = new Map<string, PrepareInstallationResult>();
  const cancellationRequested = new Set<string>();
  const mockInstallation = createMockInstallationController();
  let verifiedComfyRoot: VerifiedComfyRoot | null = null;
  let activeInstallationId: string | null = null;
  let completedInstallationId: string | null = null;
  let completedInstallationComponents = new Set<ComponentId>();
  const adapter = createAbCliAdapter({
    appPath: options.appPath,
    resourcesPath: options.resourcesPath,
    isPackaged: options.isPackaged,
    enabled: options.enableExternalAdapters === true
  });
  let previousRandomBaseSeed: number | null = null;
  const projectDataRoot = options.dataRootPath ?? options.projectRepository?.dataRoot ?? null;
  const projectRepository = options.projectRepository ?? (
    projectDataRoot === null ? null : createProjectRepository({ dataRoot: projectDataRoot })
  );
  const updateCheck = createGithubUpdateCheckService({
    currentVersion: options.appVersion,
    dataRootPath: projectDataRoot
  });
  const updateDownload = createGithubUpdateDownloadService({
    dataRootPath: projectDataRoot,
    currentVersion: options.appVersion,
    preferredKind: options.preferredUpdateKind ?? "setup",
    getValidatedRelease: updateCheck.getValidatedRelease,
    ...(options.openUpdateDownloadFolder === undefined
      ? {}
      : { openFolder: options.openUpdateDownloadFolder }),
    ...(options.openValidatedUpdateRelease === undefined
      ? {}
      : { openExternal: options.openValidatedUpdateRelease }),
    ...(options.launchValidatedUpdateInstaller === undefined
      ? {}
      : { launchInstaller: options.launchValidatedUpdateInstaller })
  });
  const generatedVideos = options.generatedVideoService ?? null;

  const persistSetup = async (setup: SetupPreferences): Promise<void> => {
    if (!await saveSetupPreferences(options.userDataPath, setup, options.setupPreferencesFileName)) {
      throw new ControlPlaneServiceError(
        "ADAPTER_FAILED",
        "本机配置无法安全写入；已停止更新界面状态，请检查应用数据目录权限后重试。"
      );
    }
  };

  const restoreSavedSetup = async (): Promise<RestoredSetup | null> => {
    const saved = await loadSetupPreferences(options.userDataPath, options.setupPreferencesFileName);
    if (saved === null) return null;

    const restoredComfy = await safelyVerifyComfyRoot(saved.comfyUiRoot);
    const savedModelRoot = await verifySavedDirectory(saved.modelRoot);
    let normalized: SetupPreferences = Object.freeze({
      ...saved,
      comfyUiRoot: restoredComfy?.root ?? null,
      comfySource: restoredComfy === null ? "missing" : saved.comfySource,
      modelRoot: savedModelRoot,
      modelSource: savedModelRoot === null ? "missing" : saved.modelSource
    });
    let inspection = await inspectPersistedComponents(normalized, {
      comfyRootVerified: restoredComfy !== null
    });
    if (normalized.modelRoot === null && inspection.recoveredModelRoot !== null) {
      normalized = Object.freeze({
        ...normalized,
        modelRoot: inspection.recoveredModelRoot,
        modelSource: "detected"
      });
      inspection = await inspectPersistedComponents(normalized, {
        comfyRootVerified: restoredComfy !== null
      });
    }

    const restored: SetupPreferences = Object.freeze({
      ...normalized,
      setupComplete: inspection.setupComplete,
      completedComponents: inspection.completedComponents,
      completedInstallationId: inspection.setupComplete
        ? inspection.completedInstallationId
        : null
    });
    verifiedComfyRoot = restoredComfy;
    completedInstallationComponents = new Set(inspection.verifiedComponents);
    completedInstallationId = restored.completedInstallationId;
    await persistSetup(restored);
    if (
      restored.setupComplete &&
      restored.completedInstallationId !== null &&
      restoredComfy !== null &&
      restored.modelRoot !== null
    ) {
      try {
        await adapter.restoreCompletedInstallation({
          installRoot: restored.installRoot,
          installationId: restored.completedInstallationId,
          comfyUiRoot: restoredComfy.root,
          completedComponents: inspection.completedComponents
        });
      } catch {
        // Saved component evidence may remain useful, but a stale or malformed
        // transaction must never fabricate a launch-ready adapter context.
      }
    }
    return Object.freeze({
      ...restored,
      vramBytes: inspection.vramBytes
    });
  };

  const getBootstrap = async (): Promise<BootstrapState> => {
    const savedSetup = await restoreSavedSetup();
    return Object.freeze({
      appName: APPLICATION_IDENTITY.name,
      appVersion: options.appVersion,
      author: APPLICATION_IDENTITY.author,
      authorProfileUrl: APPLICATION_IDENTITY.authorProfileUrl,
      authorIntroductionUrl: APPLICATION_IDENTITY.authorIntroductionUrl,
      authorTagline: APPLICATION_IDENTITY.authorTagline,
      authorMotto: APPLICATION_IDENTITY.authorMotto,
      productDescription: APPLICATION_IDENTITY.productDescription,
      recommendedInstallRoot: "D:\\MiniMaxH3",
      savedSetup,
      branding: BRANDING_AUTHORITY,
      boundary: PRODUCT_BOUNDARY,
      license: MINIMAX_H3_LICENSE,
      adapterState: Object.freeze({
        streamA: adapter.streamAAvailable
          ? "stream_a_cli"
          : options.allowMockFallback === true
            ? "deterministic_mock"
            : "unavailable",
        streamB: adapter.streamBAvailable
          ? "stream_b_cli"
          : options.allowMockFallback === true
            ? "deterministic_mock"
            : "unavailable"
      })
    });
  };

  const scanInstallation = async (request: ScanInstallationRequest): Promise<ScanInstallationResult> => {
    const validated = validateScanRequest(request);
    const saved = await loadSetupPreferences(options.userDataPath, options.setupPreferencesFileName);
    const inherited = saved !== null && sameWindowsPath(saved.installRoot, validated.installRoot)
      ? saved
      : null;
    activeInstallationId = null;
    preparedInstallations.clear();
    cancellationRequested.clear();
    const result = await adapter.scanInstallation(validated);
    const selectedResult = result ?? (
      options.allowMockFallback === true ? createMockScan(validated) : null
    );
    if (selectedResult !== null) {
      const comfyCandidate = validated.comfyUiRoot !== null
        ? validated.comfyUiRoot
        : selectedResult.locations.comfyUiRoot ?? inherited?.comfyUiRoot ?? null;
      const verifiedComfy = await safelyVerifyComfyRoot(comfyCandidate);
      const comfySource = verifiedComfy === null
        ? "missing" as const
        : validated.comfyUiRoot !== null
          ? "explicit" as const
          : selectedResult.locations.comfyUiRoot !== null
            ? selectedResult.locations.comfySource
            : inherited?.comfySource ?? "detected" as const;

      const modelCandidate = validated.modelRoot !== null
        ? validated.modelRoot
        : selectedResult.locations.modelRoot ?? inherited?.modelRoot ?? null;
      let acceptedModelRoot = await verifySavedDirectory(modelCandidate);
      let modelSource = acceptedModelRoot === null
        ? "missing" as const
        : validated.modelRoot !== null
          ? "explicit" as const
          : selectedResult.locations.modelRoot !== null
            ? selectedResult.locations.modelSource
            : inherited?.modelSource ?? "detected" as const;
      let setup: SetupPreferences = Object.freeze({
        installRoot: selectedResult.installRoot,
        comfyUiRoot: verifiedComfy?.root ?? null,
        modelRoot: acceptedModelRoot,
        comfySource,
        modelSource,
        setupComplete: inherited?.setupComplete ?? false,
        completedComponents: inherited?.completedComponents ?? Object.freeze([]),
        completedInstallationId: inherited?.completedInstallationId ?? null
      });
      let inspection = await inspectPersistedComponents(setup, {
        comfyRootVerified: verifiedComfy !== null
      });
      if (
        acceptedModelRoot === null &&
        validated.modelRoot === null &&
        inspection.recoveredModelRoot !== null
      ) {
        acceptedModelRoot = inspection.recoveredModelRoot;
        modelSource = "detected";
        setup = Object.freeze({ ...setup, modelRoot: acceptedModelRoot, modelSource });
        inspection = await inspectPersistedComponents(setup, {
          comfyRootVerified: verifiedComfy !== null
        });
      }

      const verifiedComponents = new Set(inspection.verifiedComponents);
      const foundComponents = new Set(inspection.foundComponents);
      const components = normalizeInstallationComponents(selectedResult.components.map((component) => Object.freeze({
        ...component,
        selected: component.selected || verifiedComponents.has(component.id),
        state: verifiedComponents.has(component.id)
          ? "verified_reuse" as const
          : foundComponents.has(component.id)
            ? "found_unverified" as const
            : component.id === "comfyui_desktop_optional"
              ? "needs_download" as const
            : component.state
      })));
      const selectedComponents = components.filter((component) => component.selected || component.required);
      const totalFor = (state: "verified_reuse" | "found_unverified" | "needs_download"): number =>
        Math.round(selectedComponents
          .filter((component) => component.state === state)
          .reduce((total, component) => total + component.sizeGiB, 0) * 10) / 10;
      const acceptedResult = Object.freeze({
        ...selectedResult,
        locations: Object.freeze({
          comfyUiRoot: verifiedComfy?.root ?? null,
          modelRoot: acceptedModelRoot,
          comfySource,
          modelSource
        }),
        attachPlan: Object.freeze({
          mode: "attach_only" as const,
          existingComfyUi: verifiedComfy === null
            ? "未发现可附加的 ComfyUI"
            : `${verifiedComfy.root} · ${verifiedComfy.topology}`,
          mutatesExistingInstance: false as const
        }),
        verifiedReuseGiB: totalFor("verified_reuse"),
        pendingVerificationGiB: totalFor("found_unverified"),
        requiredDownloadGiB: totalFor("needs_download"),
        components
      });
      const persisted: SetupPreferences = Object.freeze({
        ...setup,
        modelRoot: acceptedModelRoot,
        modelSource,
        setupComplete: inspection.setupComplete,
        completedComponents: inspection.completedComponents,
        completedInstallationId: inspection.setupComplete
          ? inspection.completedInstallationId
          : null
      });
      verifiedComfyRoot = verifiedComfy;
      completedInstallationComponents = new Set(inspection.verifiedComponents);
      completedInstallationId = persisted.completedInstallationId;
      await persistSetup(persisted);
      return acceptedResult;
    }
    throw new ControlPlaneServiceError("ADAPTER_UNAVAILABLE", "Stream A 本机适配器不可用。");
  };

  const prepareInstallation = async (
    request: PrepareInstallationRequest
  ): Promise<PrepareInstallationResult> => {
    const validated = validatePrepareRequest(request);
    const result = await adapter.prepareInstallation(validated);
    if (result !== null) {
      preparedInstallations.set(result.planId, result);
      return result;
    }
    if (options.allowMockFallback === true) {
      const mock = createMockPrepare(validated);
      preparedInstallations.set(mock.planId, mock);
      return mock;
    }
    throw new ControlPlaneServiceError("ADAPTER_UNAVAILABLE", "请先使用 Stream A 完成本机扫描。");
  };

  const acceptInstallationState = async (
    status: InstallationStatusResult
  ): Promise<InstallationStatusResult> => {
    activeInstallationId = status.installationId;
    if (status.state !== "complete") return status;
    if (cancellationRequested.has(status.installationId)) {
      throw new ControlPlaneServiceError(
        "INSTALLATION_CANCELLED",
        "该安装任务已请求取消；即使发生完成竞态，也必须重新扫描并明确开始新事务。"
      );
    }

    const plan = preparedInstallations.get(status.planId);
    if (plan === undefined) {
      throw new ControlPlaneServiceError(
        "INSTALLATION_NOT_READY",
        "安装完成状态没有绑定到当前主进程计划。"
      );
    }
    if (verifiedComfyRoot === null) {
      verifiedComfyRoot = await safelyVerifyComfyRoot(
        join(plan.installRoot, "runtime", "ComfyUI_windows_portable")
      );
    }
    if (verifiedComfyRoot === null) {
      throw new ControlPlaneServiceError(
        "INSTALLATION_NOT_READY",
        "A3 已返回完成，但 ComfyUI 根目录仍未通过静态验证。"
      );
    }
    const saved = await loadSetupPreferences(options.userDataPath, options.setupPreferencesFileName);
    let savedModelRoot = await verifySavedDirectory(saved?.modelRoot ?? null);
    const managedModelRoot = join(
      plan.installRoot,
      "runtime",
      "ComfyUI_windows_portable",
      "ComfyUI",
      "models"
    );
    if (savedModelRoot === null) savedModelRoot = await verifySavedDirectory(managedModelRoot);
    const claimedComponents = Object.freeze([
      ...new Set([
        ...(saved?.completedComponents ?? []),
        ...completedInstallationComponents,
        ...plan.selectedComponents
      ])
    ]);
    let persisted: SetupPreferences = Object.freeze({
      installRoot: plan.installRoot,
      comfyUiRoot: verifiedComfyRoot.root,
      modelRoot: savedModelRoot,
      comfySource: saved?.comfySource === "explicit" ? "explicit" : "detected",
      modelSource: savedModelRoot === null
        ? "missing"
        : saved?.modelRoot !== null && saved?.modelRoot !== undefined && sameWindowsPath(saved.modelRoot, savedModelRoot)
          ? saved.modelSource
          : "detected",
      setupComplete: true,
      completedComponents: claimedComponents,
      completedInstallationId: status.installationId
    });
    let inspection = await inspectPersistedComponents(persisted, {
      comfyRootVerified: true
    });
    if (persisted.modelRoot === null && inspection.recoveredModelRoot !== null) {
      persisted = Object.freeze({
        ...persisted,
        modelRoot: inspection.recoveredModelRoot,
        modelSource: "detected"
      });
      inspection = await inspectPersistedComponents(persisted, {
        comfyRootVerified: true
      });
    }
    if (
      !inspection.setupComplete ||
      inspection.completedInstallationId !== status.installationId
    ) {
      throw new ControlPlaneServiceError(
        "INSTALLATION_NOT_READY",
        "A3 已返回完成，但持久化事务、基础模型或 PyAV 未通过快速复核。"
      );
    }
    persisted = Object.freeze({
      ...persisted,
      setupComplete: true,
      completedComponents: inspection.completedComponents,
      completedInstallationId: inspection.completedInstallationId
    });
    await persistSetup(persisted);
    completedInstallationId = inspection.completedInstallationId;
    completedInstallationComponents = new Set(inspection.verifiedComponents);
    return status;
  };

  const executeInstallation = async (
    request: ExecuteInstallationRequest
  ): Promise<InstallationStatusResult> => {
    const validated = validateExecuteInstallationRequest(request);
    const plan = preparedInstallations.get(validated.planId);
    if (plan === undefined || plan.installRoot !== validated.installRoot) {
      throw new ControlPlaneServiceError(
        "INSTALLATION_NOT_READY",
        "安装计划不存在、已失效或与所选目录不一致。"
      );
    }
    activeInstallationId = validated.planId;
    cancellationRequested.delete(validated.planId);
    const result = await adapter.executeInstallation(validated);
    if (result !== null) return await acceptInstallationState(result);
    if (options.allowMockFallback === true && plan.source === "deterministic_mock") {
      return await acceptInstallationState(mockInstallation.execute(validated));
    }
    throw new ControlPlaneServiceError("ADAPTER_UNAVAILABLE", "A3 真实安装执行器不可用。");
  };

  const queryInstallation = async (
    request: QueryInstallationRequest
  ): Promise<InstallationStatusResult> => {
    const validated = validateQueryInstallationRequest(request);
    if (activeInstallationId !== validated.installationId) {
      throw new ControlPlaneServiceError("INSTALLATION_NOT_READY", "安装任务不存在或已失效。");
    }
    const result = await adapter.queryInstallation(validated);
    if (result !== null) return await acceptInstallationState(result);
    if (options.allowMockFallback === true) {
      return await acceptInstallationState(mockInstallation.query(validated));
    }
    throw new ControlPlaneServiceError("ADAPTER_UNAVAILABLE", "A3 安装状态查询器不可用。");
  };

  const cancelInstallation = async (
    request: CancelInstallationRequest
  ): Promise<InstallationStatusResult> => {
    const validated = validateCancelInstallationRequest(request);
    if (activeInstallationId !== validated.installationId) {
      throw new ControlPlaneServiceError("INSTALLATION_NOT_READY", "安装任务不存在或已失效。");
    }
    cancellationRequested.add(validated.installationId);
    const result = await adapter.cancelInstallation(validated);
    if (result !== null) return await acceptInstallationState(result);
    if (options.allowMockFallback === true) {
      return await acceptInstallationState(mockInstallation.cancel(validated));
    }
    throw new ControlPlaneServiceError("ADAPTER_UNAVAILABLE", "A3 安装取消器不可用。");
  };

  const chooseFrame = async (slot: FrameSlot): Promise<FrameSelection | null> => {
    const validatedSlot = validateFrameSlot(slot);
    const result = await dialog.showOpenDialog({
      title: validatedSlot === "first" ? "选择首帧" : "选择尾帧",
      properties: ["openFile"],
      filters: [
        { name: "图像", extensions: ["png", "jpg", "jpeg", "webp"] }
      ]
    });
    if (result.canceled || result.filePaths.length !== 1) return null;
    const selectedPath = result.filePaths[0];
    if (selectedPath === undefined || !isAbsolute(selectedPath)) {
      throw new ControlPlaneServiceError("INVALID_REQUEST", "系统返回了无效的帧路径。");
    }
    return await registerTrustedFrameSelection(selectedPath, validatedSlot);
  };

  const registerTrustedFrameSelection = async (
    absolutePath: string,
    slot: FrameSlot
  ): Promise<FrameSelection> => {
    const validatedSlot = validateFrameSlot(slot);
    if (!isAbsolute(absolutePath) || absolutePath.length > 32_767 || absolutePath.includes("\u0000")) {
      throw new ControlPlaneServiceError("INVALID_REQUEST", "本地图片素材路径无效。");
    }
    const extension = extname(absolutePath).slice(1).toLocaleLowerCase("en-US");
    if (!RESULT_MEDIA_EXTENSION_GROUPS.image.includes(extension)) {
      throw new ControlPlaneServiceError(
        "INVALID_REQUEST",
        validatedSlot === "first" ? "首帧必须是受支持的图片素材。" : "尾帧必须是受支持的图片素材。"
      );
    }
    const id = selectionId("frame", absolutePath);
    frameSelections.set(id, absolutePath);
    return Object.freeze({ selectionId: id, displayName: basename(absolutePath) });
  };

  const chooseResultMedia = async (): Promise<ResultMediaSelection | null> => {
    const result = await dialog.showOpenDialog({
      title: "关联已有本地结果文件",
      properties: ["openFile"],
      filters: [
        { name: "视频", extensions: [...RESULT_MEDIA_EXTENSION_GROUPS.video] },
        { name: "图像", extensions: [...RESULT_MEDIA_EXTENSION_GROUPS.image] },
        { name: "音频", extensions: [...RESULT_MEDIA_EXTENSION_GROUPS.audio] }
      ]
    });
    if (
      typeof result !== "object" ||
      result === null ||
      typeof result.canceled !== "boolean" ||
      !Array.isArray(result.filePaths) ||
      result.filePaths.some((filePath) => typeof filePath !== "string")
    ) {
      throw new ControlPlaneServiceError("INVALID_REQUEST", "系统返回了无效的结果文件选择。");
    }
    if (result.canceled) return null;
    if (result.filePaths.length !== 1) {
      throw new ControlPlaneServiceError("INVALID_REQUEST", "请选择一个本地结果文件。");
    }
    return createResultMediaSelection(result.filePaths[0]);
  };

  const chooseDirectory = async (
    kind: DirectoryKind
  ): Promise<DirectorySelection | null> => {
    if (kind !== "install_root" && kind !== "comfyui_root" && kind !== "model_root") {
      throw new ControlPlaneServiceError("INVALID_REQUEST", "目录选择类型无效。");
    }
    const result = await dialog.showOpenDialog({
      title:
        kind === "install_root"
          ? "选择缺失组件安装位置"
          : kind === "comfyui_root"
            ? "选择现有 ComfyUI 根目录"
            : "选择现有 MiniMax H3 模型目录",
      ...(kind === "install_root" ? { defaultPath: "D:\\MiniMaxH3" } : {}),
      properties:
        kind === "install_root"
          ? ["openDirectory", "createDirectory"]
          : ["openDirectory"]
    });
    if (result.canceled || result.filePaths.length !== 1) return null;
    const selectedPath = result.filePaths[0];
    if (selectedPath === undefined || !isAbsolute(selectedPath)) {
      throw new ControlPlaneServiceError("INVALID_REQUEST", "系统返回了无效的目录路径。");
    }
    return Object.freeze({ displayPath: selectedPath });
  };

  const chooseExportDirectory = async (): Promise<ExportDirectorySelection | null> => {
    const defaultWorkflowDirectory = join(
      options.executableDirectory,
      DEFAULT_WORKFLOW_DIRECTORY_NAME
    );
    const result = await dialog.showOpenDialog({
      title: "选择工作流导出目录",
      defaultPath: defaultWorkflowDirectory,
      properties: ["openDirectory", "createDirectory"]
    });
    if (result.canceled || result.filePaths.length !== 1) return null;
    const selectedPath = result.filePaths[0];
    if (selectedPath === undefined || !isAbsolute(selectedPath)) {
      throw new ControlPlaneServiceError("INVALID_REQUEST", "系统返回了无效的导出目录。");
    }
    const id = selectionId("export", selectedPath);
    exportSelections.set(id, selectedPath);
    return Object.freeze({ selectionId: id, displayPath: selectedPath });
  };

  const requireGeneratedVideos = (): GeneratedVideoService => {
    if (generatedVideos === null) {
      throw new ControlPlaneServiceError("PROJECT_FAILED", "Relay 数据目录尚未就绪，无法读取已生成视频。");
    }
    return generatedVideos;
  };

  const supplementGeneratedVideo: ControlPlaneApi["supplementGeneratedVideo"] = async (request) => {
    const selected = await dialog.showOpenDialog({
      title: "补录已有视频",
      properties: ["openFile"],
      filters: [{ name: "视频", extensions: [...RESULT_MEDIA_EXTENSION_GROUPS.video] }]
    });
    if (selected.canceled || selected.filePaths.length !== 1) {
      return Object.freeze({ cancelled: true, status: null, video: null, errorCode: null, message: null });
    }
    try {
      const result = await requireGeneratedVideos().manualImportFromMainSelection({
        projectId: request.projectId,
        selectedPath: selected.filePaths[0]!
      });
      return Object.freeze({
        cancelled: false,
        status: result.status,
        video: result.video,
        errorCode: null,
        message: null
      });
    } catch (error) {
      return Object.freeze({
        cancelled: false,
        status: "rejected" as const,
        video: null,
        errorCode: error instanceof Error && "code" in error && typeof error.code === "string"
          ? error.code
          : "VIDEO_INVALID",
        message: error instanceof Error && error.message.trim().length > 0
          ? error.message.trim()
          : "所选文件未通过视频检查。"
      });
    }
  };

  const compileAndOpenWorkflow = async (
    request: CompileAndOpenWorkflowRequest
  ): Promise<CompileAndOpenWorkflowResult> => {
    const timingStartedAt = performance.now();
    const timingDurations: Record<CompileAndOpenTimingStage, number> = {
      request_validation: 0,
      input_preparation: 0,
      workflow_compilation: 0,
      capability_preflight: 0,
      workflow_persistence: 0,
      visible_handoff: 0
    };
    const completedTimingStages = new Set<CompileAndOpenTimingStage>();
    let activeTimingStage: CompileAndOpenTimingStage = "request_validation";
    let activeTimingStageStartedAt = performance.now();
    let timingOutcome: "loaded" | "visible_not_loaded" | "window_closed" | "renderer_gone" | "stored_not_opened" | "mock_exported" | "failed" = "failed";
    let failedTimingStage: CompileAndOpenTimingStage | null = null;
    let timingErrorCode: string | null = null;
    let visibleHandoffTiming: ComfyHandoffTimingEvidence | null = null;
    const finishTimingStage = (stage: CompileAndOpenTimingStage): void => {
      if (completedTimingStages.has(stage)) return;
      timingDurations[stage] = monotonicElapsed(activeTimingStageStartedAt);
      completedTimingStages.add(stage);
    };
    const startTimingStage = (stage: CompileAndOpenTimingStage): void => {
      activeTimingStage = stage;
      activeTimingStageStartedAt = performance.now();
    };

    try {
    const validated = validateCompileRequest(request);
    finishTimingStage("request_validation");
    startTimingStage("input_preparation");
    if (completedInstallationId === null || verifiedComfyRoot === null) {
      throw new ControlPlaneServiceError(
        "INSTALLATION_NOT_READY",
        "只有真实安装事务完成且 ComfyUI 根目录通过验证后才能编译。"
      );
    }
    if (
      validated.project.mode === "REF2VA" &&
      !completedInstallationComponents.has("ref2va_optional")
    ) {
      throw new ControlPlaneServiceError(
        "INSTALLATION_NOT_READY",
        "Ref2VA 模式已显示，但需要先在“安装与组件”中完成 Ref2VA 可选包的校验或安装。"
      );
    }
    const firstFrame = requireKnownSelection(
      validated.project.firstFrameSelectionId,
      frameSelections,
      "首帧选择"
    );
    const lastFrame = requireKnownSelection(
      validated.project.lastFrameSelectionId,
      frameSelections,
      "尾帧选择"
    );
    const selectedExportDirectory = requireKnownSelection(
      validated.exportDirectorySelectionId,
      exportSelections,
      "导出目录选择"
    );
    const defaultWorkflowDirectory = join(
      options.executableDirectory,
      DEFAULT_WORKFLOW_DIRECTORY_NAME
    );
    const exportDirectory = selectedExportDirectory ?? defaultWorkflowDirectory;
    const stagedFrames = await stageProjectFrames({
      mode: validated.project.mode,
      comfyInputDirectory: verifiedComfyRoot.inputDirectory,
      firstFrame,
      lastFrame
    });
    const advanced = validated.project.advanced ?? Object.freeze({
      seed: 1,
      seedPolicy: "random_per_compile" as const,
      samplingProfile: "quality_20" as const
    });
    const seedResolution = resolveRelaySeedPlan({
      policy: advanced.seedPolicy,
      fixedSeed: advanced.seed,
      shotIds: relayCompileShotIds(validated.project),
      entropy: () => randomBytes(8),
      previousRandomBaseSeed
    });
    if (seedResolution.policy === "random_per_compile") previousRandomBaseSeed = seedResolution.baseSeed;
    const workflowId = validated.projectId === undefined || validated.projectId === null
      ? null
      : allocateWorkflowId();
    finishTimingStage("input_preparation");
    startTimingStage("workflow_compilation");
    const rawCompiledWorkflow = await adapter.compileWorkflow({
      project: validated.project,
      resolvedFrames: stagedFrames,
      seedResolution
    });
    if (rawCompiledWorkflow === null && options.allowMockFallback !== true) {
      throw new ControlPlaneServiceError("ADAPTER_UNAVAILABLE", "Stream B 工作流编译器不可用或不支持所选模式。");
    }
    const attributedWorkflow = rawCompiledWorkflow === null
      ? null
      : structuredClone(rawCompiledWorkflow);
    if (attributedWorkflow !== null && workflowId !== null && validated.projectId !== undefined && validated.projectId !== null) {
      applyWorkflowOutputAttribution(attributedWorkflow, {
        projectId: validated.projectId,
        workflowId
      });
    }
    const compiledWorkflow = attributedWorkflow === null
      ? null
      : assignUserWorkflowIdentity({
          workflowName: validated.workflowName,
          workflow: attributedWorkflow
        });
    finishTimingStage("workflow_compilation");
    startTimingStage("capability_preflight");
    if (compiledWorkflow !== null && options.skipVisibleOpen !== true) {
      await assertComfySessionSupportsWorkflow({
        workflow: compiledWorkflow,
        launchIfUnavailable: () => adapter.launchManagedComfy()
      });
    }
    finishTimingStage("capability_preflight");
    startTimingStage("workflow_persistence");
    let handoff: CompileAndOpenWorkflowResult["handoff"] = "exported_mock_preview";
    let workflowLibraryDisplay: string | null = null;
    let automaticallyLoaded = false;
    let workflowFileName: string;
    let exportDirectoryDisplay: string;
    let projectAuthority: ProjectAuthorityHandoffEvidence | null = null;
    let authoritativeProject: RelayProjectDocument | null = null;
    if (compiledWorkflow !== null && validated.projectId !== undefined && validated.projectId !== null) {
      if (projectDataRoot === null || projectRepository === null) {
        throw new ControlPlaneServiceError(
          "WORKFLOW_EXPORT_FAILED",
          "当前 Relay 数据目录尚未就绪，无法保存项目权威工作流。"
        );
      }
      try {
        projectAuthority = await storeAndHandoffProjectWorkflow({
          dataRootPath: projectDataRoot,
          repository: projectRepository,
          projectId: validated.projectId,
          workflowName: validated.workflowName,
          ...(workflowId === null ? {} : { workflowId }),
          workflow: compiledWorkflow,
          seedResolution,
          comfyRoot: verifiedComfyRoot
        });
        authoritativeProject = projectAuthority.authoritativeProject;
      } catch (error) {
        if (error instanceof ControlPlaneServiceError) throw error;
        throw new ControlPlaneServiceError(
          "WORKFLOW_EXPORT_FAILED",
          "项目权威工作流未能完成写入、校验或 ComfyUI 交接；未报告成功。"
        );
      }
      workflowFileName = projectAuthority.workflowFileName;
      exportDirectoryDisplay = projectAuthority.authorityDirectory;
      workflowLibraryDisplay = projectAuthority.targetRelativePath;
      handoff = "stored_for_visible_selection";
      if (generatedVideos !== null && workflowId !== null) {
        await mkdir(verifiedComfyRoot.outputDirectory, { recursive: true });
        await generatedVideos.registerCompileOrigin({
          projectId: validated.projectId,
          workflowId,
          comfyOutputRoot: verifiedComfyRoot.outputDirectory
        });
      }
    } else {
      workflowFileName = await exportDeterministicWorkflow({
        exportDirectory,
          workflowName: validated.workflowName,
          project: validated.project,
          compiledWorkflow,
          seedResolution
      });
      exportDirectoryDisplay = selectedExportDirectory === null
        ? defaultWorkflowDirectory
        : selectedExportDirectory;
    }

    if (compiledWorkflow !== null && projectAuthority === null) {
      const stored = await storeWorkflowInComfyLibrary({
        root: verifiedComfyRoot,
        workflow: compiledWorkflow,
        preferredFileName: workflowFileName
      });
      workflowLibraryDisplay = `user/default/workflows/${stored.fileName}`;
      handoff = "stored_for_visible_selection";
    }
    finishTimingStage("workflow_persistence");
    startTimingStage("visible_handoff");
    if (compiledWorkflow !== null && options.skipVisibleOpen !== true) {
      const visible = await showWorkflowInComfyWindow({
        workflow: compiledWorkflow,
        workflowName: workflowFileName,
        launchIfNeeded: () => adapter.launchManagedComfy(),
        onTimingEvidence: (evidence) => {
          visibleHandoffTiming = evidence;
        }
      });
      automaticallyLoaded = visible.automaticallyLoaded;
      handoff = automaticallyLoaded
        ? "loaded_visible_comfyui"
        : visible.visible
          ? "visible_existing_graph_preserved"
          : "stored_for_visible_selection";
      timingOutcome = (visibleHandoffTiming as ComfyHandoffTimingEvidence | null)?.outcome ?? (
        automaticallyLoaded
          ? "loaded"
          : visible.visible
            ? "visible_not_loaded"
            : "window_closed"
      );
    } else {
      timingOutcome = compiledWorkflow === null ? "mock_exported" : "stored_not_opened";
    }
    finishTimingStage("visible_handoff");

    return Object.freeze({
      source: compiledWorkflow === null ? "deterministic_mock" : "stream_b_cli",
      workflowFileName,
      exportDirectoryDisplay,
      comfyUiOrigin: COMFY_UI_ORIGIN,
      handoff,
      workflowLibraryDisplay,
      automaticallyLoaded,
      seedResolution,
      authoritativeProject,
      awaitingUserRun: true,
      queueSubmission: false,
      branding: BRANDING_AUTHORITY
    });
    } catch (error) {
      finishTimingStage(activeTimingStage);
      timingOutcome = "failed";
      failedTimingStage = activeTimingStage;
      timingErrorCode = error instanceof ControlPlaneServiceError ? error.code : "ADAPTER_FAILED";
      throw error;
    } finally {
      if (projectDataRoot !== null) {
        try {
          await writeCompileAndOpenTimingEvidence(projectDataRoot, {
            schemaVersion: "2.0.0",
            outcome: timingOutcome,
            failedStage: failedTimingStage,
            stableErrorCode: timingErrorCode,
            totalMs: monotonicElapsed(timingStartedAt),
            requestValidationMs: timingDurations.request_validation,
            inputPreparationMs: timingDurations.input_preparation,
            workflowCompilationMs: timingDurations.workflow_compilation,
            capabilityPreflightMs: timingDurations.capability_preflight,
            workflowPersistenceMs: timingDurations.workflow_persistence,
            visibleHandoffMs: timingDurations.visible_handoff,
            visibleHandoff: visibleHandoffTiming
          });
        } catch {
          process.stderr.write("COMFY_HANDOFF_TIMING_WRITE_FAILED\n");
        }
      }
    }
  };

  return Object.freeze({
    getBootstrap,
    getUpdateCheckCache: updateCheck.getCachedUpdateCheck,
    checkForUpdates: updateCheck.checkForUpdates,
    downloadUpdate: updateDownload.downloadUpdate,
    getUpdateDownloadStatus: async () => updateDownload.getUpdateDownloadStatus(),
    cancelUpdateDownload: updateDownload.cancelUpdateDownload,
    openDownloadedUpdateFolder: updateDownload.openDownloadedUpdateFolder,
    openValidatedReleasePage: updateDownload.openValidatedReleasePage,
    listGeneratedVideos: (request: Parameters<ControlPlaneApi["listGeneratedVideos"]>[0]) => requireGeneratedVideos().list(request),
    supplementGeneratedVideo,
    getGeneratedVideoPreview: (request: Parameters<ControlPlaneApi["getGeneratedVideoPreview"]>[0]) => requireGeneratedVideos().getPoster(request),
    playGeneratedVideo: (request: Parameters<ControlPlaneApi["playGeneratedVideo"]>[0]) => requireGeneratedVideos().play(request),
    showGeneratedVideoInFolder: (request: Parameters<ControlPlaneApi["showGeneratedVideoInFolder"]>[0]) => requireGeneratedVideos().reveal(request),
    addGeneratedVideoToProjectAssets: (request: Parameters<ControlPlaneApi["addGeneratedVideoToProjectAssets"]>[0]) => requireGeneratedVideos().addToAssets(request),
    scanInstallation,
    prepareInstallation,
    executeInstallation,
    queryInstallation,
    cancelInstallation,
    chooseDirectory,
    chooseFrame,
    registerTrustedFrameSelection,
    chooseResultMedia,
    chooseExportDirectory,
    compileAndOpenWorkflow
  });
}
