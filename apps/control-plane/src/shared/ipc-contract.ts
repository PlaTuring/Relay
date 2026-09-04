import type {
  RelayAssetAvailability,
  RelayAssetBinding,
  RelayAssetPurpose,
  RelayBindingTargetKind,
  RelayMediaType,
  RelayProjectAsset,
  RelayProjectDocument
} from "./project-domain.js";
import type { RelayResolvedSeedPlan, RelaySeedPolicy } from "./seed-policy.js";
import type {
  UpdateCheckCacheContract,
  UpdateCheckResultContract,
  UpdateDownloadKind,
  UpdateDownloadStatusContract
} from "./update-source.js";

export type {
  CompletedUpdateCheckStatus,
  SuccessfulUpdateCheckStatus,
  UpdateCheckCacheContract,
  UpdateCheckResultContract,
  UpdateCheckStatus
} from "./update-source.js";

export const IPC_REGISTRY = Object.freeze({
  getBootstrap: "control:get-bootstrap",
  scanInstallation: "control:scan-installation",
  prepareInstallation: "control:prepare-installation",
  executeInstallation: "control:execute-installation",
  queryInstallation: "control:query-installation",
  cancelInstallation: "control:cancel-installation",
  chooseDirectory: "control:choose-directory",
  chooseFrame: "control:choose-frame",
  chooseResultMedia: "control:choose-result-media",
  chooseExportDirectory: "control:choose-export-directory",
  importLocalAssets: "control:asset-import-local",
  listLocalAssets: "control:asset-list-local",
  updateLocalAsset: "control:asset-update-local",
  refreshLocalAssets: "control:asset-refresh-local",
  relocateLocalAsset: "control:asset-relocate-local",
  confirmLocalAssetReplacement: "control:asset-confirm-replacement",
  copyLocalAssetToProject: "control:asset-copy-to-project",
  prepareLocalAssetFrame: "control:asset-prepare-frame",
  setUiTheme: "control:set-ui-theme",
  getProjectCenter: "control:project-center-get",
  createRelayProject: "control:project-create",
  loadRelayProject: "control:project-load",
  saveRelayProject: "control:project-save",
  cloneRelayProject: "control:project-clone",
  archiveRelayProject: "control:project-archive",
  restoreRelayProject: "control:project-restore",
  chooseAndConfigureDataRoot: "control:data-root-choose-configure",
  openDataRoot: "control:data-root-open",
  getUpdateCheckCache: "control:update-check-cache-get",
  checkForUpdates: "control:update-check-run",
  downloadUpdate: "control:update-download-start",
  getUpdateDownloadStatus: "control:update-download-status-get",
  cancelUpdateDownload: "control:update-download-cancel",
  openDownloadedUpdateFolder: "control:update-download-folder-open",
  openValidatedReleasePage: "control:update-validated-release-open",
  openAboutLink: "control:about-link-open",
  listGeneratedVideos: "control:generated-videos-list",
  supplementGeneratedVideo: "control:generated-videos-supplement",
  getGeneratedVideoPreview: "control:generated-videos-preview",
  playGeneratedVideo: "control:generated-videos-play",
  showGeneratedVideoInFolder: "control:generated-videos-reveal",
  addGeneratedVideoToProjectAssets: "control:generated-videos-add-to-assets",
  importProjectAssets: "control:project-assets-import",
  importDroppedProjectAssets: "control:project-assets-import-dropped",
  listProjectAssets: "control:project-assets-list",
  updateProjectAsset: "control:project-assets-update",
  refreshProjectAssets: "control:project-assets-refresh",
  relocateProjectAsset: "control:project-assets-relocate",
  removeProjectAsset: "control:project-assets-remove",
  listDeletedProjectAssets: "control:project-assets-deleted-list",
  restoreProjectAsset: "control:project-assets-restore",
  getProjectAssetPreview: "control:project-assets-preview",
  bindProjectAsset: "control:project-assets-bind",
  unbindProjectAsset: "control:project-assets-unbind",
  revealProjectAsset: "control:project-assets-reveal",
  prepareProjectAssetFrame: "control:project-assets-prepare-frame",
  copyProjectAssetIntoProject: "control:project-assets-copy-into-project",
  exportRelayProjectBundle: "control:project-bundle-export",
  importRelayProjectBundle: "control:project-bundle-import",
  compileAndOpenWorkflow: "control:compile-and-open-workflow",
  queryWorkflowHandoff: "control:query-workflow-handoff"
} as const);

export type IpcChannel = (typeof IPC_REGISTRY)[keyof typeof IPC_REGISTRY];

export const APPLICATION_IDENTITY = Object.freeze({
  name: "Relay",
  author: "柏拉图灵 | PlaTuring",
  authorProfileUrl: "https://github.com/PlaTuring/Relay",
  authorIntroductionUrl: "https://github.com/PlaTuring/Relay",
  authorTagline: "抖音 / B站：柏拉图灵",
  authorMotto: "",
  productDescription: "MiniMax H3 本地配置与 ComfyUI 工作流交接工具"
} as const);

export const PRODUCT_BOUNDARY = Object.freeze({
  applicationRole: "installer_configurator_workflow_compiler",
  formalSubmissionOwner: "visible_comfyui_user_action",
  mediaGenerationOwner: "minimax_h3_inside_comfyui",
  queueSubmission: false
} as const);

export const BRANDING_AUTHORITY = Object.freeze({
  software_brand_only: true,
  media_branding_authority: false
} as const);

export const MINIMAX_H3_LICENSE = Object.freeze({
  agreementUrl: "https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE",
  notice:
    "MiniMax H3 is licensed under the MiniMax H3 Community License Agreement, Copyright © 2026 MiniMax. All Rights Reserved.",
  aiGenerationIdentifier: "encouraged_not_required",
  legalDecisionOwner: "user"
} as const);

export const MINIMAX_H3_PROJECT_MODE_CAPABILITIES = Object.freeze({
  T2V: Object.freeze({
    label: "T2V",
    visibility: "always",
    requiredComponentId: "fl2va_base",
    availabilityGate: "installation_state",
    missingComponentBehavior: "visible_install_required",
    compilerMode: "t2v",
    inputContract: Object.freeze({ kind: "prompt_only" }),
    samplingProfiles: Object.freeze(["quality_20", "quality_25", "turbo_8"] as const)
  }),
  FL2VA: Object.freeze({
    label: "FL2VA",
    visibility: "always",
    requiredComponentId: "fl2va_base",
    availabilityGate: "installation_state",
    missingComponentBehavior: "visible_install_required",
    compilerMode: "first_or_last_frame",
    inputContract: Object.freeze({
      kind: "endpoint_images",
      minimumImages: 1,
      maximumImages: 2,
      semantics: "first_and_or_last_frame"
    }),
    samplingProfiles: Object.freeze(["quality_20", "quality_25", "turbo_8"] as const)
  }),
  REF2VA: Object.freeze({
    label: "Ref2VA",
    visibility: "always",
    requiredComponentId: "ref2va_optional",
    availabilityGate: "installation_state",
    missingComponentBehavior: "visible_install_required",
    compilerMode: "ref2va",
    inputContract: Object.freeze({
      kind: "reference_images",
      minimumImages: 1,
      maximumImages: 2,
      semantics: "reference_conditioning_not_endpoints",
      selectionSlots: Object.freeze(["first", "last"] as const)
    }),
    samplingProfiles: Object.freeze(["quality_20", "quality_25"] as const)
  })
} as const);

export const MINIMAX_H3_OFFICIAL_WORKFLOW_CAPABILITIES = Object.freeze({
  sampler: "res_multistep",
  scheduler: "simple",
  qualitySteps: 20,
  highQualitySteps: 25,
  turboSteps: 8,
  turboModelStrength: 1,
  fps: 24,
  nativeAudioSampleRateHz: 32_000,
  nativeAudioChannels: 2,
  guidanceDistilled: true,
  configurableCfgScale: false,
  configurableNegativePrompt: false,
  configurableFps: false,
  projectModes: MINIMAX_H3_PROJECT_MODE_CAPABILITIES
} as const);

export type AdapterSource = "stream_a_cli" | "stream_b_cli" | "deterministic_mock";
export type AdapterAvailability = AdapterSource | "unavailable";
export type ComponentState = "verified_reuse" | "found_unverified" | "needs_download";
export type ComponentId =
  | "fl2va_base"
  | "turbo_acceleration_recommended"
  | "ref2va_optional"
  | "pyav_required"
  | "ffmpeg_long_video_optional"
  | "comfyui_desktop_optional";
export type ProjectMode = keyof typeof MINIMAX_H3_PROJECT_MODE_CAPABILITIES;
/**
 * Total director timelines are the sum of independently authored 5/10/15s
 * shots. Runtime validators keep the actual value to a bounded multiple of
 * five; the wider number type prevents the UI from pretending only the quick
 * 5/10/15/30/60 presets are possible.
 */
export type DurationSeconds = number;
export type SegmentDurationSeconds = 5 | 10 | 15;
export type CanvasPreset =
  | "21:9"
  | "16:9"
  | "3:2"
  | "4:3"
  | "1:1"
  | "3:4"
  | "2:3"
  | "9:16";
export type SeedPolicy = RelaySeedPolicy;
export type SamplingProfile = "quality_20" | "quality_25" | "turbo_8";
export type DirectoryKind = "install_root" | "comfyui_root" | "model_root";
export type FrameSlot = "first" | "last";
export type UiTheme = "light" | "dark";
export type AboutLinkTarget = "author" | "repository";
export type AssetMediaType = "image" | "video" | "audio";
export type AssetStorageMode = "reference_original" | "project_copy";
export type AssetAvailability = "available" | "missing" | "changed";

export interface AssetRecord {
  readonly assetId: string;
  readonly displayName: string;
  readonly sourceFileName: string;
  readonly mediaType: AssetMediaType;
  readonly extension: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly tags: readonly string[];
  readonly note: string;
  readonly storageMode: AssetStorageMode;
  readonly availability: AssetAvailability;
  readonly projectRelativePath: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AssetListRequest {
  readonly query: string;
  readonly mediaType: AssetMediaType | "all";
  readonly availability: AssetAvailability | "all";
  readonly tags: readonly string[];
}

export interface AssetListResult {
  readonly assets: readonly AssetRecord[];
  readonly total: number;
}

export type AssetImportItemResult =
  | {
      readonly status: "imported";
      readonly selectedFileName: string;
      readonly asset: AssetRecord;
    }
  | {
      readonly status: "duplicate";
      readonly selectedFileName: string;
      readonly duplicateAsset: AssetRecord;
    }
  | {
      readonly status: "unsupported" | "failed";
      readonly selectedFileName: string;
      readonly message: string;
    };

export interface AssetImportBatchResult {
  readonly cancelled: boolean;
  readonly results: readonly AssetImportItemResult[];
}

export interface AssetMetadataUpdateRequest {
  readonly assetId: string;
  readonly displayName: string;
  readonly tags: readonly string[];
  readonly note: string;
}

export interface AssetRefreshResult {
  readonly assets: readonly AssetRecord[];
  readonly missingCount: number;
  readonly changedCount: number;
}

export interface AssetRelocateRequest {
  readonly assetId: string;
}

export interface AssetReplacementCandidate {
  readonly selectedFileName: string;
  readonly mediaType: AssetMediaType;
  readonly extension: string;
  readonly byteLength: number;
  readonly sha256: string;
}

export type AssetRelocateResult =
  | { readonly status: "cancelled" }
  | { readonly status: "relocated"; readonly asset: AssetRecord }
  | {
      readonly status: "confirmation_required";
      readonly relocationToken: string;
      readonly candidate: AssetReplacementCandidate;
    };

export interface AssetRelocateConfirmRequest {
  readonly assetId: string;
  readonly relocationToken: string;
  readonly acceptReplacement: boolean;
}

export type AssetRelocateConfirmResult =
  | { readonly status: "cancelled" }
  | { readonly status: "relocated"; readonly asset: AssetRecord };

export interface AssetCopyToProjectRequest {
  readonly assetId: string;
}

export type AssetCopyToProjectResult =
  | { readonly status: "cancelled" }
  | {
      readonly status: "copied";
      readonly projectDirectoryName: string;
      readonly projectRelativePath: string;
      readonly asset: AssetRecord;
    };

export interface AssetPrepareFrameRequest {
  readonly assetId: string;
  readonly slot: FrameSlot;
}

export interface BrandingAuthority {
  readonly software_brand_only: true;
  readonly media_branding_authority: false;
}

export interface BootstrapState {
  readonly appName: typeof APPLICATION_IDENTITY.name;
  readonly appVersion: string;
  readonly author: typeof APPLICATION_IDENTITY.author;
  readonly authorProfileUrl: typeof APPLICATION_IDENTITY.authorProfileUrl;
  readonly authorIntroductionUrl: typeof APPLICATION_IDENTITY.authorIntroductionUrl;
  readonly authorTagline: typeof APPLICATION_IDENTITY.authorTagline;
  readonly authorMotto: typeof APPLICATION_IDENTITY.authorMotto;
  readonly productDescription: typeof APPLICATION_IDENTITY.productDescription;
  readonly recommendedInstallRoot: "D:\\MiniMaxH3";
  readonly savedSetup: {
    readonly installRoot: string;
    readonly comfyUiRoot: string | null;
    readonly modelRoot: string | null;
    readonly setupComplete: boolean;
    readonly completedComponents: readonly ComponentId[];
    readonly completedInstallationId: string | null;
    readonly vramBytes: number | null;
  } | null;
  readonly branding: BrandingAuthority;
  readonly boundary: typeof PRODUCT_BOUNDARY;
  readonly adapterState: {
    readonly streamA: AdapterAvailability;
    readonly streamB: AdapterAvailability;
  };
  readonly license: typeof MINIMAX_H3_LICENSE;
}

export interface ScanInstallationRequest {
  readonly installRoot: string;
  readonly comfyUiRoot: string | null;
  readonly modelRoot: string | null;
}

export type DetectedLocationSource = "explicit" | "detected" | "missing";

export interface ScanDetectedLocations {
  readonly comfyUiRoot: string | null;
  readonly modelRoot: string | null;
  readonly comfySource: DetectedLocationSource;
  readonly modelSource: DetectedLocationSource;
}

export interface ComponentScanResult {
  readonly id: ComponentId;
  readonly title: string;
  readonly description: string;
  readonly required: boolean;
  readonly selected: boolean;
  readonly state: ComponentState;
  readonly sizeGiB: number;
}

export interface ScanInstallationResult {
  readonly source: AdapterSource;
  readonly installRoot: string;
  readonly locations: ScanDetectedLocations;
  readonly system: {
    readonly windows: string;
    readonly gpu: string;
    readonly vramBytes: number | null;
    readonly memory: string;
    readonly targetVolume: string;
  };
  readonly attachPlan: {
    readonly mode: "attach_only";
    readonly existingComfyUi: string;
    readonly mutatesExistingInstance: false;
  };
  readonly verifiedReuseGiB: number;
  readonly pendingVerificationGiB: number;
  readonly requiredDownloadGiB: number;
  readonly components: readonly ComponentScanResult[];
}

export interface PrepareInstallationRequest {
  readonly installRoot: string;
  readonly selectedOptionalComponents: readonly ComponentId[];
}

export interface PrepareInstallationResult {
  readonly source: AdapterSource;
  readonly planId: string;
  readonly installRoot: string;
  readonly state: "ready";
  readonly selectedComponents: readonly ComponentId[];
  readonly mutatesExistingComfyUi: false;
  readonly branding: BrandingAuthority;
}

export type InstallationPhase =
  | "planning"
  | "reuse"
  | "download"
  | "verify"
  | "extract"
  | "configure"
  | "recover"
  | "complete"
  | "cancelled"
  | "failed";

export type InstallationState =
  | "running"
  | "cancel_pending"
  | "cancelled"
  | "recovery_required"
  | "failed"
  | "complete";

export type InstallationStepState =
  | "pending"
  | "running"
  | "complete"
  | "reused"
  | "cancelled"
  | "failed";

export interface InstallationStep {
  readonly id: "reuse" | "download" | "verify" | "extract" | "configure" | "recover";
  readonly label: string;
  readonly state: InstallationStepState;
}

export interface ExecuteInstallationRequest {
  readonly planId: string;
  readonly installRoot: string;
}

export interface QueryInstallationRequest {
  readonly installationId: string;
}

export interface CancelInstallationRequest {
  readonly installationId: string;
}

export interface InstallationStatusResult {
  readonly source: AdapterSource;
  readonly installationId: string;
  readonly planId: string;
  readonly state: InstallationState;
  readonly phase: InstallationPhase;
  readonly progressBasisPoints: number;
  readonly completedBytes: number;
  readonly totalBytes: number;
  readonly networkDownloadedBytes: number;
  readonly networkTotalBytes: number;
  readonly message: string;
  readonly steps: readonly InstallationStep[];
  readonly recoverable: boolean;
}

export interface FrameSelection {
  readonly selectionId: string;
  readonly displayName: string;
}

export interface ResultMediaSelection {
  readonly displayPath: string;
  readonly displayName: string;
}

export interface DirectorySelection {
  readonly displayPath: string;
}

export interface ExportDirectorySelection {
  readonly selectionId: string;
  readonly displayPath: string;
}

export interface ProjectSpec {
  readonly prompt: string;
  readonly mode: ProjectMode;
  readonly firstFrameSelectionId: string | null;
  readonly lastFrameSelectionId: string | null;
  readonly durationSeconds: DurationSeconds;
  readonly segmentDurationSeconds: SegmentDurationSeconds;
  /** Exact per-shot timing from Relay Director. Omitted for uniform quick projects. */
  readonly segmentDurationsSeconds?: readonly SegmentDurationSeconds[];
  /** Stable Director shot IDs matching segmentDurationsSeconds. */
  readonly segmentShotIds?: readonly string[];
  /** Proven transition between adjacent Director shots, in shot order. */
  readonly segmentTransitions?: readonly SegmentTransition[];
  readonly canvas: CanvasPreset;
  readonly resolutionMegapixels: number;
  readonly advanced?: ProjectAdvancedOptions;
}

export type SegmentTransition = "hard_cut" | "tail_frame_continuation";

export interface ProjectAdvancedOptions {
  readonly seed: number;
  readonly seedPolicy: SeedPolicy;
  readonly samplingProfile: SamplingProfile;
}

export interface CompileAndOpenWorkflowRequest {
  readonly workflowName: string;
  readonly project: ProjectSpec;
  readonly exportDirectorySelectionId: string | null;
  /** When present, the authoritative workflow is owned by this Relay project. */
  readonly projectId?: string | null;
}

export interface CompileAndOpenWorkflowResult {
  readonly source: AdapterSource;
  readonly workflowFileName: string;
  readonly exportDirectoryDisplay: string;
  readonly comfyUiOrigin: "http://127.0.0.1:8188/";
  readonly handoff:
    | "loaded_visible_comfyui"
    | "visible_existing_graph_preserved"
    | "stored_for_visible_selection"
    | "exported_mock_preview";
  readonly workflowLibraryDisplay: string | null;
  readonly automaticallyLoaded: boolean;
  /** Exact local compile resolution persisted with the workflow and project history. */
  readonly seedResolution: RelayResolvedSeedPlan;
  /**
   * Final project document after the main process has stored the workflow and
   * compile-handoff history. Renderer code must adopt this authority before
   * attempting another optimistic-concurrency save for the same project.
   */
  readonly authoritativeProject: RelayProjectDocument | null;
  readonly awaitingUserRun: true;
  readonly queueSubmission: false;
  readonly branding: BrandingAuthority;
}

export interface RelayProjectSummaryContract {
  readonly projectId: string;
  readonly name: string;
  readonly editorMode: "quick" | "professional";
  readonly status: "active" | "archived";
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
  readonly openedAt?: string;
}

export interface ProjectCenterState {
  readonly dataRoot: string;
  readonly projects: readonly RelayProjectSummaryContract[];
  readonly recentProjects: readonly RelayProjectSummaryContract[];
  readonly activeProjectId: string | null;
}

export interface RelayProjectIdRequest {
  readonly projectId: string;
}

export interface RelayProjectLoadRequest extends RelayProjectIdRequest {
  /** Only an explicit user navigation may change the main-process active project. */
  readonly activate: boolean;
}

export interface RelayProjectCreateRequest {
  readonly name: string;
}

export interface RelayProjectCloneRequest extends RelayProjectIdRequest {
  readonly name: string;
}

export interface RelayProjectSaveRequest {
  readonly project: RelayProjectDocument;
  readonly expectedUpdatedAt: string | null;
}

export interface ConfigureDataRootRequest {
  readonly mode: "new_library" | "migrate";
}

export interface ProjectAssetImportRequestContract extends RelayProjectIdRequest {
  /** Omitted by the ordinary UI: importing copies into the project by default. */
  readonly mode?: "copy" | "reference";
}

/** Renderer-facing drag/drop request. File paths stay inside the preload/main boundary. */
export interface ProjectAssetDropImportRequestContract extends RelayProjectIdRequest {
  /** Omitted by the ordinary drop target: importing copies into the project by default. */
  readonly mode?: "copy" | "reference";
}

/** Private preload-to-main payload. Never return this shape to the renderer. */
export interface ProjectAssetResolvedImportRequestContract extends ProjectAssetDropImportRequestContract {
  readonly paths: readonly string[];
}

export interface ProjectAssetImportItemContract {
  readonly fileName: string;
  readonly status: "imported" | "duplicate" | "rejected";
  readonly asset: RelayProjectAsset | null;
  readonly duplicateAssetId: string | null;
  readonly issues: readonly string[];
}

export interface ProjectAssetImportBatchContract {
  readonly cancelled: boolean;
  readonly importedCount: number;
  readonly duplicateCount: number;
  readonly rejectedCount: number;
  readonly results: readonly ProjectAssetImportItemContract[];
}

export interface ProjectAssetListRequestContract extends RelayProjectIdRequest {
  readonly query: string;
  readonly mediaType: RelayMediaType | "all";
  readonly availability: RelayAssetAvailability | "all";
  readonly tags: readonly string[];
}

export interface ProjectAssetViewContract {
  readonly asset: RelayProjectAsset;
  readonly usageCount: number;
  readonly bindings: readonly RelayAssetBinding[];
}

export interface ProjectAssetUpdateRequestContract extends RelayProjectIdRequest {
  readonly assetId: string;
  readonly displayName?: string;
  readonly tags?: readonly string[];
  readonly notes?: string;
}

export interface ProjectAssetIdRequestContract extends RelayProjectIdRequest {
  readonly assetId: string;
}

export interface ProjectAssetFrameRequestContract extends ProjectAssetIdRequestContract {
  readonly slot: FrameSlot;
}

export interface ProjectAssetBindRequestContract extends RelayProjectIdRequest {
  readonly targetKind: RelayBindingTargetKind;
  readonly targetId: string;
  readonly assetId: string;
  readonly purpose: RelayAssetPurpose;
  readonly notes: string;
}

export interface ProjectAssetUnbindRequestContract extends RelayProjectIdRequest {
  readonly bindingId: string;
}

export interface ProjectAssetRemovalContract {
  readonly status: "removed" | "in_use" | "not_found";
  readonly bindings: readonly RelayAssetBinding[];
  readonly retainedProjectRelativePath: string | null;
}

export interface ProjectAssetRestoreContract {
  readonly status: "restored" | "already_present" | "not_found" | "conflict";
  readonly asset: RelayProjectAsset | null;
}

export interface DeletedProjectAssetViewContract {
  readonly assetId: string;
  readonly displayName: string;
  readonly mediaType: RelayMediaType;
  readonly deletedAt: string;
}

export interface ProjectAssetPreviewContract {
  readonly kind: "image_thumbnail" | "video_poster" | "audio_icon" | "unavailable";
  readonly status: "ready" | "unavailable" | "failed";
  readonly mimeType: "image/png" | null;
  /** Bounded cached thumbnail bytes. Absolute paths never cross IPC. */
  readonly dataUrl: string | null;
  readonly cacheKey: string;
  readonly message: string | null;
}

export interface ProjectAssetRelinkContract {
  readonly status: "cancelled" | "relinked" | "replacement_required" | "rejected";
  readonly asset: RelayProjectAsset | null;
  readonly issues: readonly string[];
}

export interface ProjectAssetCopyIntoProjectContract {
  readonly status: "copied" | "already_project_copy";
  readonly asset: RelayProjectAsset;
}

export interface RelayProjectBundleRequest extends RelayProjectIdRequest {
  readonly externalReferencePolicy: "exclude" | "copy";
}

export interface RelayProjectBundleResultContract {
  readonly cancelled: boolean;
  readonly displayPath: string | null;
  readonly project: RelayProjectDocument | null;
  readonly sha256: string | null;
  readonly byteLength: number;
}

export interface GeneratedVideoIdRequestContract extends RelayProjectIdRequest {
  readonly resultId: string;
}

export interface GeneratedVideoTechnicalInspectionContract {
  readonly status: "verified" | "unchecked";
  readonly durationSeconds: number | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly videoCodec: string | null;
  readonly audioCodec: string | null;
  readonly message: string | null;
}

export interface GeneratedVideoContract {
  readonly resultId: string;
  readonly workflowId: string | null;
  readonly fileName: string;
  readonly byteLength: number;
  readonly sha256: string;
  readonly container: "mp4" | "mov" | "webm" | "mkv" | "avi";
  readonly source: "automatic" | "manual";
  readonly discoveredAt: string;
  readonly technicalInspection: GeneratedVideoTechnicalInspectionContract;
}

export interface GeneratedVideoListResultContract {
  readonly projectId: string;
  readonly videos: readonly GeneratedVideoContract[];
}

export interface GeneratedVideoSupplementResultContract {
  readonly cancelled: boolean;
  readonly status: "added" | "duplicate" | "rejected" | null;
  readonly video: GeneratedVideoContract | null;
  readonly errorCode: string | null;
  readonly message: string | null;
}

export interface GeneratedVideoPreviewContract {
  readonly kind: "video_poster" | "unavailable";
  readonly status: "ready" | "unavailable" | "failed";
  readonly mimeType: "image/png" | null;
  readonly dataUrl: string | null;
  readonly cacheKey: string;
  readonly message: string | null;
}

export interface GeneratedVideoOpenResultContract {
  readonly opened: boolean;
  readonly errorCode: string | null;
}

export interface GeneratedVideoAddToAssetsResultContract {
  readonly status: "added" | "duplicate";
  readonly assetId: string;
}

export type ControlPlaneErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_INSTALL_ROOT"
  | "FRAME_SELECTION_CANCELLED"
  | "EXPORT_SELECTION_CANCELLED"
  | "ADAPTER_UNAVAILABLE"
  | "ADAPTER_FAILED"
  | "INSTALLATION_NOT_READY"
  | "INSTALLATION_CANCELLED"
  | "ASSET_LIBRARY_FAILED"
  | "ASSET_NOT_FOUND"
  | "ASSET_CHANGED"
  | "PROJECT_FAILED"
  | "DATA_ROOT_FAILED"
  | "PROJECT_ASSET_FAILED"
  | "PROJECT_BUNDLE_FAILED"
  | "WORKFLOW_EXPORT_FAILED"
  | "COMFYUI_OPEN_FAILED";

export interface ControlPlanePublicError {
  readonly name: "ControlPlaneError";
  readonly code: ControlPlaneErrorCode;
  readonly message: string;
}

export interface ControlPlaneApi {
  getBootstrap(): Promise<BootstrapState>;
  getUpdateCheckCache(): Promise<UpdateCheckCacheContract | null>;
  checkForUpdates(): Promise<UpdateCheckResultContract>;
  downloadUpdate(request: { readonly kind: UpdateDownloadKind }): Promise<UpdateDownloadStatusContract>;
  getUpdateDownloadStatus(): Promise<UpdateDownloadStatusContract>;
  cancelUpdateDownload(): Promise<UpdateDownloadStatusContract>;
  openDownloadedUpdateFolder(): Promise<boolean>;
  openValidatedReleasePage(): Promise<boolean>;
  listGeneratedVideos(request: RelayProjectIdRequest): Promise<GeneratedVideoListResultContract>;
  supplementGeneratedVideo(request: RelayProjectIdRequest): Promise<GeneratedVideoSupplementResultContract>;
  getGeneratedVideoPreview(request: GeneratedVideoIdRequestContract): Promise<GeneratedVideoPreviewContract>;
  playGeneratedVideo(request: GeneratedVideoIdRequestContract): Promise<GeneratedVideoOpenResultContract>;
  showGeneratedVideoInFolder(request: GeneratedVideoIdRequestContract): Promise<GeneratedVideoOpenResultContract>;
  addGeneratedVideoToProjectAssets(
    request: GeneratedVideoIdRequestContract
  ): Promise<GeneratedVideoAddToAssetsResultContract>;
  scanInstallation(request: ScanInstallationRequest): Promise<ScanInstallationResult>;
  prepareInstallation(request: PrepareInstallationRequest): Promise<PrepareInstallationResult>;
  executeInstallation(request: ExecuteInstallationRequest): Promise<InstallationStatusResult>;
  queryInstallation(request: QueryInstallationRequest): Promise<InstallationStatusResult>;
  cancelInstallation(request: CancelInstallationRequest): Promise<InstallationStatusResult>;
  chooseDirectory(kind: DirectoryKind): Promise<DirectorySelection | null>;
  chooseFrame(slot: FrameSlot): Promise<FrameSelection | null>;
  chooseResultMedia(): Promise<ResultMediaSelection | null>;
  chooseExportDirectory(): Promise<ExportDirectorySelection | null>;
  compileAndOpenWorkflow(
    request: CompileAndOpenWorkflowRequest
  ): Promise<CompileAndOpenWorkflowResult>;
}

export interface AssetLibraryApi {
  importLocalAssets(): Promise<AssetImportBatchResult>;
  listLocalAssets(request: AssetListRequest): Promise<AssetListResult>;
  updateLocalAsset(request: AssetMetadataUpdateRequest): Promise<AssetRecord>;
  refreshLocalAssets(): Promise<AssetRefreshResult>;
  relocateLocalAsset(request: AssetRelocateRequest): Promise<AssetRelocateResult>;
  confirmLocalAssetReplacement(
    request: AssetRelocateConfirmRequest
  ): Promise<AssetRelocateConfirmResult>;
  copyLocalAssetToProject(
    request: AssetCopyToProjectRequest
  ): Promise<AssetCopyToProjectResult>;
  prepareLocalAssetFrame(request: AssetPrepareFrameRequest): Promise<FrameSelection>;
}

export interface RendererControlPlaneApi extends ControlPlaneApi, AssetLibraryApi {
  setUiTheme(theme: UiTheme): Promise<void>;
  openAboutLink(target: AboutLinkTarget): Promise<boolean>;
  getProjectCenter(): Promise<ProjectCenterState>;
  createRelayProject(request: RelayProjectCreateRequest): Promise<RelayProjectDocument>;
  loadRelayProject(request: RelayProjectLoadRequest): Promise<RelayProjectDocument>;
  saveRelayProject(request: RelayProjectSaveRequest): Promise<RelayProjectDocument>;
  cloneRelayProject(request: RelayProjectCloneRequest): Promise<RelayProjectDocument>;
  archiveRelayProject(request: RelayProjectIdRequest): Promise<RelayProjectDocument>;
  restoreRelayProject(request: RelayProjectIdRequest): Promise<RelayProjectDocument>;
  chooseAndConfigureDataRoot(request: ConfigureDataRootRequest): Promise<ProjectCenterState | null>;
  openDataRoot(): Promise<boolean>;
  importProjectAssets(request: ProjectAssetImportRequestContract): Promise<ProjectAssetImportBatchContract>;
  importDroppedProjectAssets(
    request: ProjectAssetDropImportRequestContract,
    files: readonly File[]
  ): Promise<ProjectAssetImportBatchContract>;
  listProjectAssets(request: ProjectAssetListRequestContract): Promise<readonly ProjectAssetViewContract[]>;
  updateProjectAsset(request: ProjectAssetUpdateRequestContract): Promise<RelayProjectAsset>;
  refreshProjectAssets(request: RelayProjectIdRequest): Promise<readonly ProjectAssetViewContract[]>;
  relocateProjectAsset(request: ProjectAssetIdRequestContract): Promise<ProjectAssetRelinkContract>;
  removeProjectAsset(request: ProjectAssetIdRequestContract): Promise<ProjectAssetRemovalContract>;
  listDeletedProjectAssets(request: RelayProjectIdRequest): Promise<readonly DeletedProjectAssetViewContract[]>;
  restoreProjectAsset(request: ProjectAssetIdRequestContract): Promise<ProjectAssetRestoreContract>;
  getProjectAssetPreview(request: ProjectAssetIdRequestContract): Promise<ProjectAssetPreviewContract>;
  bindProjectAsset(request: ProjectAssetBindRequestContract): Promise<RelayAssetBinding>;
  unbindProjectAsset(request: ProjectAssetUnbindRequestContract): Promise<boolean>;
  revealProjectAsset(request: ProjectAssetIdRequestContract): Promise<boolean>;
  prepareProjectAssetFrame(request: ProjectAssetFrameRequestContract): Promise<FrameSelection>;
  copyProjectAssetIntoProject(
    request: ProjectAssetIdRequestContract
  ): Promise<ProjectAssetCopyIntoProjectContract>;
  exportRelayProjectBundle(request: RelayProjectBundleRequest): Promise<RelayProjectBundleResultContract>;
  importRelayProjectBundle(): Promise<RelayProjectBundleResultContract>;
}
