import type {
  AboutLinkTarget,
  AssetAvailability,
  AssetCopyToProjectResult,
  AssetImportBatchResult,
  AssetLibraryApi,
  AssetListResult,
  AssetMediaType,
  AssetRecord,
  AssetRefreshResult,
  AssetRelocateConfirmResult,
  AssetRelocateResult,
  CanvasPreset,
  ComponentId,
  ComponentScanResult,
  DirectoryKind,
  DurationSeconds,
  ExportDirectorySelection,
  FrameSelection,
  InstallationStatusResult,
  ProjectAssetViewContract,
  ProjectCenterState,
  ProjectMode,
  ProjectSpec,
  RendererControlPlaneApi,
  SamplingProfile,
  ScanDetectedLocations,
  ScanInstallationRequest,
  ScanInstallationResult,
  SegmentTransition,
  SegmentDurationSeconds,
  SeedPolicy
} from "../shared/ipc-contract";
import { MINIMAX_H3_OFFICIAL_WORKFLOW_CAPABILITIES } from "../shared/ipc-contract";
import type {
  JsonValue,
  RelayAssetBinding,
  RelayAssetPurpose,
  RelayContinuityField,
  RelayMediaType,
  RelayProjectAsset,
  RelayProjectDocument,
  RelayProjectShot,
  RelayShotDurationSeconds,
  RelayTransitionType
} from "../shared/project-domain";
import { RELAY_CONTINUITY_FIELDS } from "../shared/project-domain";
import type { RelayResolvedSeedPlan } from "../shared/seed-policy";
import { formalVersionLabel } from "./version-presentation";
import { createGeneratedVideoUi } from "./generated-video-ui";
import {
  captureProjectOperationIdentity,
  projectOperationIdentityMatches,
  ProjectOperationSupersededError,
  requireProjectOperationIdentity,
  type ProjectOperationContext
} from "./project-operation-context";
import { createUpdateUi } from "./update-ui";
import {
  directorBindingProjectionDisposition,
  migrateLegacyQuickAssetReferences
} from "./asset-projection-policy";
import { validateWorkflowName } from "../shared/workflow-name";
import {
  AssetLibraryOperationSupersededError,
  createAssetLibraryController,
  type AssetLibrarySnapshot
} from "./asset-library";
import {
  componentProgressLabel,
  componentUiPolicy
} from "./component-policy";
import {
  directorCompilationSnapshot,
  directorClock,
  directorSegmentPlan,
  directorShotFingerprint,
  directorShotIdentityKey,
  directorShotMemoryKey,
  serializeDirectorPrompt,
  uniqueDirectorShotId,
  type DirectorDraft,
  type DirectorLanguage,
  type DirectorMode,
  type DirectorShot
} from "./director-console";
import {
  buildDirectorV7Payload,
  captureDirectorP1Submission,
  commitDirectorP1Compilation,
  decorateDirectorDraftForProduction,
  restoreDirectorP1Revision,
  restoreDirectorPayload,
  syncDirectorProductionState,
  type DirectorP1Submission
} from "./director-p1-controller";
import { activeShotsForP1, createDirectorP1Ui, type DirectorP1Ui } from "./director-p1-ui";
import {
  archiveProductionBinding,
  createEmptyProductionState,
  directorTimelineDuration,
  productionBindingsForTarget,
  upsertProductionAssetReference,
  upsertProductionBinding,
  validateProductionContinuity,
  type DirectorProductionState
} from "./director-production";
import {
  compileDirectorTransitions,
  orderedDirectorShots,
  promoteQuickProjectToProfessional,
  readProfessionalDirectorMetadata,
  resolveDirectorShotStates,
  restoreDirectorStateInheritance,
  serializeDirectorContinuityPromptContexts,
  setDirectorShotDurations,
  setDirectorStateLock,
  setDirectorStateOverride,
  setDirectorTransition,
  validateDirectorContinuity,
  type DirectorStatePhase
} from "./professional-director";
import {
  reconcileProfessionalDirectorStateWithProject,
  safelyRefreshProfessionalDirectorState
} from "./professional-director-reconciliation";
import {
  applyProjectWorkspaceEdit,
  claimProjectWorkspaceAutosave,
  completeProjectWorkspaceAutosave,
  createProjectWorkspaceController,
  focusProjectWorkspaceShot,
  locateProjectWorkspaceField,
  materializeDirectorSegmentPlan,
  projectWorkspaceSaveIndicator,
  projectWorkspaceUndoRedo,
  redoProjectWorkspace,
  undoProjectWorkspace,
  type ProjectWorkspaceController
} from "./project-workspace-controller";
import {
  projectContentHash
} from "./project-state-engine";
import {
  assertProjectContainsCompileHandoff,
  canAdoptProjectAuthority,
  mergeAuthoritativeProjectWithEditorState,
  synchronizeWorkspaceAuthoritativeProject
} from "./project-authority-sync";

type ViewName = "home" | "install" | "project" | "director" | "assets" | "generated" | "upscale" | "about";

function isViewName(value: string | undefined): value is ViewName {
  return value === "home" || value === "install" || value === "project" || value === "director" || value === "assets" || value === "generated" || value === "upscale" || value === "about";
}

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (value === null) throw new Error(`UI element is missing: ${id}`);
  return value as T;
}

type ThemeChoice = "light" | "dark";

const THEME_STORAGE_KEY = "relay-ui-theme";
const LEGACY_THEME_STORAGE_KEY = "minimax-h3-theme";
const THEME_LABELS: Readonly<Record<ThemeChoice, string>> = Object.freeze({
  light: "浅色主题",
  dark: "深色主题"
});

function readStoredTheme(): ThemeChoice | null {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY)
      ?? window.localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
    return saved === "light" || saved === "dark" ? saved : null;
  } catch {
    return null;
  }
}

function persistTheme(theme: ThemeChoice): void {
  try {
    // dataRoot/config/ui.json is authoritative. localStorage is read only once
    // for legacy migration and is never used as an ongoing business store.
    window.localStorage.removeItem(THEME_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
  } catch {
    // The active in-memory choice and native dataRoot-backed setting still apply.
  }
}

function readThemeFromRendererUrl(): ThemeChoice | null {
  try {
    const theme = new URL(window.location.href).searchParams.get("theme");
    return theme === "light" || theme === "dark" ? theme : null;
  } catch {
    return null;
  }
}

function colorSchemeQuery(): MediaQueryList | null {
  try {
    return typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : null;
  } catch {
    return null;
  }
}

const themeSwitcher = element<HTMLElement>("theme-switcher");
const headerUtilitiesCandidate = document.querySelector<HTMLDetailsElement>(".header-utilities");
if (headerUtilitiesCandidate === null) throw new Error("UI element is missing: .header-utilities");
const headerUtilities: HTMLDetailsElement = headerUtilitiesCandidate;
const headerUtilitiesSummaryCandidate = headerUtilities.querySelector<HTMLElement>("summary");
if (headerUtilitiesSummaryCandidate === null) throw new Error("UI element is missing: .header-utilities summary");
const headerUtilitiesSummary: HTMLElement = headerUtilitiesSummaryCandidate;
const headerUtilitiesBreakpoint = window.matchMedia("(max-width: 1100px)");

function syncHeaderUtilitiesMode(): void {
  const compact = headerUtilitiesBreakpoint.matches;
  headerUtilities.open = !compact;
  headerUtilitiesSummary.setAttribute("aria-expanded", String(headerUtilities.open));
}

syncHeaderUtilitiesMode();
headerUtilitiesBreakpoint.addEventListener("change", syncHeaderUtilitiesMode);
headerUtilities.addEventListener("toggle", () => {
  headerUtilitiesSummary.setAttribute("aria-expanded", String(headerUtilities.open));
});
headerUtilities.addEventListener("click", (event) => {
  if (!headerUtilitiesBreakpoint.matches) return;
  const target = event.target;
  const action = target instanceof HTMLElement ? target.closest<HTMLButtonElement>("button") : null;
  if (action === null) return;
  const navigates = action.dataset.viewTarget !== undefined;
  queueMicrotask(() => {
    headerUtilities.open = false;
    if (!navigates) headerUtilitiesSummary.focus({ preventScroll: true });
  });
});
headerUtilities.addEventListener("keydown", (event) => {
  if (!headerUtilitiesBreakpoint.matches || event.key !== "Escape" || !headerUtilities.open) return;
  event.preventDefault();
  headerUtilities.open = false;
  headerUtilitiesSummary.focus({ preventScroll: true });
});

function themeButton(choice: ThemeChoice): HTMLButtonElement {
  const button = themeSwitcher.querySelector<HTMLButtonElement>(`button[data-theme-choice="${choice}"]`);
  if (button === null) throw new Error(`Theme button is missing: ${choice}`);
  return button;
}

const themeButtons: ReadonlyArray<readonly [ThemeChoice, HTMLButtonElement]> = [
  ["light", themeButton("light")],
  ["dark", themeButton("dark")]
];

function syncNativeTheme(theme: ThemeChoice, reportPersistenceFailure = false): void {
  try {
    void window.controlPlane.setUiTheme(theme).catch((error: unknown) => {
      if (!reportPersistenceFailure) return;
      showFeedback({
        kind: "warning",
        title: "主题仅在当前会话生效",
        message: "主题配置未能保存，重启 Relay 后可能恢复为之前的主题。",
        detail: publicError(error)
      });
    });
  } catch (error) {
    // Web theme switching must not depend on native-title-bar synchronization.
    if (reportPersistenceFailure) {
      showFeedback({
        kind: "warning",
        title: "主题仅在当前会话生效",
        message: "主题配置未能保存，重启 Relay 后可能恢复为之前的主题。",
        detail: publicError(error)
      });
    }
  }
}

function applyTheme(theme: ThemeChoice, reportPersistenceFailure = false): void {
  document.documentElement.dataset.theme = theme;
  for (const [choice, button] of themeButtons) {
    const active = choice === theme;
    button.setAttribute("aria-pressed", String(active));
    button.title = active ? `当前为${THEME_LABELS[choice]}` : `切换到${THEME_LABELS[choice]}`;
  }
  syncNativeTheme(theme, reportPersistenceFailure);
}

const systemColorScheme = colorSchemeQuery();
const storedTheme = readStoredTheme();
let followsSystemTheme = storedTheme === null;
applyTheme(storedTheme ?? readThemeFromRendererUrl() ?? (systemColorScheme?.matches === true ? "dark" : "light"));

for (const [choice, button] of themeButtons) {
  button.addEventListener("click", () => {
    followsSystemTheme = false;
    applyTheme(choice, true);
    persistTheme(choice);
  });
}

try {
  systemColorScheme?.addEventListener("change", (event) => {
    if (followsSystemTheme) applyTheme(event.matches ? "dark" : "light");
  });
} catch {
  // Theme controls remain usable if a host cannot subscribe to system changes.
}

const appShell = element<HTMLDivElement>("app-shell");
const globalStatus = element<HTMLDivElement>("global-status");
const appToast = element<HTMLElement>("app-toast");
const appToastTitle = element<HTMLElement>("app-toast-title");
const appToastMessage = element<HTMLElement>("app-toast-message");
const appToastClose = element<HTMLButtonElement>("app-toast-close");
const installForm = element<HTMLFormElement>("install-form");
const installRoot = element<HTMLInputElement>("install-root");
const comfyUiRoot = element<HTMLInputElement>("existing-comfy-root");
const modelRoot = element<HTMLInputElement>("existing-model-root");
const scanButton = element<HTMLButtonElement>("scan-button");
const scanResults = element<HTMLDivElement>("scan-results");
const scanError = element<HTMLOutputElement>("scan-error");
const prepareButton = element<HTMLButtonElement>("prepare-button");
const prepareStatus = element<HTMLOutputElement>("prepare-status");
const componentsTitle = element<HTMLElement>("components-title");
const componentsDescription = element<HTMLElement>("components-description");
const installationTitle = element<HTMLElement>("installation-title");
const installationDescription = element<HTMLElement>("installation-description");
const installationActionTitle = element<HTMLElement>("installation-action-title");
const installationActionNote = element<HTMLElement>("installation-action-note");
const installationProgress = element<HTMLElement>("installation-progress");
const installationProgressTitle = element<HTMLHeadingElement>("installation-progress-title");
const installationProgressPercent = element<HTMLElement>("installation-progress-percent");
const installationProgressBar = element<HTMLElement>("installation-progress-bar");
const installationProgressMessage = element<HTMLParagraphElement>("installation-progress-message");
const installationTransferMetrics = element<HTMLParagraphElement>("installation-transfer-metrics");
const installationIdDisplay = element<HTMLElement>("installation-id-display");
const cancelInstallationButton = element<HTMLButtonElement>("cancel-installation-button");
const componentList = element<HTMLDivElement>("component-list");
const projectGuard = element<HTMLDivElement>("project-guard");
const projectForm = element<HTMLFormElement>("project-form");
const workflowNameInput = element<HTMLInputElement>("workflow-name");
const workflowNameError = element<HTMLParagraphElement>("workflow-name-error");
const projectPrompt = element<HTMLTextAreaElement>("project-prompt");
const promptCount = element<HTMLSpanElement>("prompt-count");
const promptError = element<HTMLParagraphElement>("prompt-error");
const promptTimelineAdvice = element<HTMLElement>("prompt-timeline-advice");
const promptTimelineAdviceText = element<HTMLElement>("prompt-timeline-advice-text");
const applyPromptDuration = element<HTMLButtonElement>("apply-prompt-duration");
const compileButton = element<HTMLButtonElement>("compile-button");
const projectSubmitStatus = element<HTMLParagraphElement>("project-submit-status");
const feedbackDialog = element<HTMLDialogElement>("feedback-dialog");
const feedbackIcon = element<HTMLElement>("feedback-icon");
const feedbackKicker = element<HTMLElement>("feedback-kicker");
const feedbackTitle = element<HTMLElement>("feedback-title");
const feedbackMessage = element<HTMLParagraphElement>("feedback-message");
const feedbackDetail = element<HTMLParagraphElement>("feedback-detail");
const feedbackSeedEvidence = element<HTMLElement>("feedback-seed-evidence");
const feedbackSeedPolicy = element<HTMLElement>("feedback-seed-policy");
const feedbackBaseSeed = element<HTMLElement>("feedback-base-seed");
const feedbackShotSeeds = element<HTMLOListElement>("feedback-shot-seeds");
const feedbackClose = element<HTMLButtonElement>("feedback-close");
const environmentRequiredDialog = element<HTMLDialogElement>("environment-required-dialog");
const environmentRequiredTitle = element<HTMLElement>("environment-required-title");
const environmentRequiredMessage = element<HTMLParagraphElement>("environment-required-message");
const environmentRequiredCancel = element<HTMLButtonElement>("environment-required-cancel");
const environmentRequiredInstall = element<HTMLButtonElement>("environment-required-install");
const actionConfirmDialog = element<HTMLDialogElement>("action-confirm-dialog");
const actionConfirmTitle = element<HTMLElement>("action-confirm-title");
const actionConfirmMessage = element<HTMLParagraphElement>("action-confirm-message");
const actionConfirmCancel = element<HTMLButtonElement>("action-confirm-cancel");
const actionConfirmSubmit = element<HTMLButtonElement>("action-confirm-submit");
const firstFrameButton = element<HTMLButtonElement>("choose-first-frame");
const lastFrameButton = element<HTMLButtonElement>("choose-last-frame");
const firstFrameName = element<HTMLElement>("first-frame-name");
const lastFrameName = element<HTMLElement>("last-frame-name");
const mainNavigation = element<HTMLElement>("main-navigation");
const componentSettingsButton = element<HTMLButtonElement>("component-settings-button");
const ref2vaModeCard = element<HTMLLabelElement>("ref2va-mode-card");
const ref2vaModeInput = ref2vaModeCard.querySelector<HTMLInputElement>('input[name="mode"]');
const ref2vaModeState = element<HTMLElement>("ref2va-mode-state");
const firstFrameLabel = element<HTMLElement>("first-frame-label");
const lastFrameLabel = element<HTMLElement>("last-frame-label");
const lastFramePicker = element<HTMLElement>("last-frame-picker");
const setupLocationStep = element<HTMLElement>("setup-location-step");
const scanActivity = element<HTMLElement>("scan-activity");
const scanActivityTitle = element<HTMLElement>("scan-activity-title");
const scanElapsed = element<HTMLElement>("scan-elapsed");
const frameControls = element<HTMLElement>("frame-controls");
const frameControlsNote = element<HTMLElement>("frame-controls-note");
const projectSeed = element<HTMLInputElement>("project-seed");
const seedPolicy = element<HTMLSelectElement>("seed-policy");
const samplingProfile = element<HTMLSelectElement>("sampling-profile");
const locationResults = element<HTMLElement>("location-results");
const managedRootSection = element<HTMLElement>("managed-root-section");
const existingEnvironmentReuse = element<HTMLDetailsElement>("existing-environment-reuse");
const existingEnvironmentReuseSummary = element<HTMLElement>("existing-environment-reuse-summary");
const comfyLocationSelection = element<HTMLElement>("comfy-location-selection");
const modelLocationSelection = element<HTMLElement>("model-location-selection");
const scanActions = element<HTMLElement>("scan-actions");
const scanStateBadge = element<HTMLElement>("scan-state-badge");
const outputSettings = element<HTMLElement>("output-settings");
const projectDuration = element<HTMLSelectElement>("project-duration");
const segmentDuration = element<HTMLSelectElement>("segment-duration");
const projectCanvas = element<HTMLSelectElement>("project-canvas");
const projectResolution = element<HTMLSelectElement>("project-resolution");
const segmentSummary = element<HTMLElement>("segment-summary");
const segmentRecommendation = element<HTMLParagraphElement>("segment-recommendation");
const canvasSizeSummary = element<HTMLElement>("canvas-size-summary");
const aboutAppName = element<HTMLElement>("about-app-name");
const aboutAppVersion = element<HTMLElement>("about-app-version");
const aboutProductDescription = element<HTMLElement>("about-product-description");
const aboutAuthorState = element<HTMLElement>("about-author-state");
const aboutAuthorTagline = element<HTMLElement>("about-author-tagline");
const aboutAuthorProfile = element<HTMLButtonElement>("about-author-profile");
const directorGuard = element<HTMLElement>("director-guard");
const directorConsole = element<HTMLElement>("director-console");
const directorStateChip = element<HTMLElement>("director-state-chip");
const directorCompileButton = element<HTMLButtonElement>("director-compile-button");
const directorSaveDraftButton = element<HTMLButtonElement>("director-save-draft");
const directorWorkflowName = element<HTMLInputElement>("director-workflow-name");
const directorLanguage = element<HTMLSelectElement>("director-language");
const directorMode = element<HTMLSelectElement>("director-mode");
const directorTotalDuration = element<HTMLSelectElement>("director-total-duration");
const directorSegmentDuration = element<HTMLSelectElement>("director-segment-duration");
const directorSegmentSummary = element<HTMLElement>("director-segment-summary");
const directorShotCount = element<HTMLElement>("director-shot-count");
const directorTimelineTrack = element<HTMLElement>("director-timeline-track");
const directorShotList = element<HTMLElement>("director-shot-list");
const directorContinuity = element<HTMLTextAreaElement>("director-continuity");
const directorCharacterBible = element<HTMLTextAreaElement>("director-character-bible");
const directorWorldBible = element<HTMLTextAreaElement>("director-world-bible");
const directorVisualStyleBible = element<HTMLTextAreaElement>("director-visual-style-bible");
const directorSoundscape = element<HTMLTextAreaElement>("director-soundscape");
const directorMusic = element<HTMLTextAreaElement>("director-music");
const directorRefFields = element<HTMLElement>("director-ref-fields");
const directorSubjects = element<HTMLTextAreaElement>("director-subjects");
const directorSummary = element<HTMLTextAreaElement>("director-summary");
const directorRetention = element<HTMLTextAreaElement>("director-retention");
const directorStyleOpening = element<HTMLTextAreaElement>("director-style-opening");
const directorFrameControls = element<HTMLElement>("director-frame-controls");
const directorFirstFrameButton = element<HTMLButtonElement>("director-first-frame");
const directorLastFrameButton = element<HTMLButtonElement>("director-last-frame");
const directorClearFirstFrameButton = element<HTMLButtonElement>("director-clear-first-frame");
const directorClearLastFrameButton = element<HTMLButtonElement>("director-clear-last-frame");
const directorOpenRefInstallButton = element<HTMLButtonElement>("director-open-ref-install");
const directorFirstFrameLabel = element<HTMLElement>("director-first-frame-label");
const directorLastFrameLabel = element<HTMLElement>("director-last-frame-label");
const directorFirstFrameName = element<HTMLElement>("director-first-frame-name");
const directorLastFrameName = element<HTMLElement>("director-last-frame-name");
const directorCanvas = element<HTMLSelectElement>("director-canvas");
const directorResolution = element<HTMLSelectElement>("director-resolution");
const directorSeed = element<HTMLInputElement>("director-seed");
const directorSeedPolicy = element<HTMLSelectElement>("director-seed-policy");
const directorSampling = element<HTMLSelectElement>("director-sampling");
const directorValidation = element<HTMLElement>("director-validation");
const directorPromptPreview = element<HTMLElement>("director-prompt-preview");
const directorPromptCount = element<HTMLElement>("director-prompt-count");
const directorCheckButton = element<HTMLButtonElement>("director-check-button");
const directorCheckLabel = element<HTMLElement>("director-check-label");
const directorShotSettingsButton = element<HTMLButtonElement>("director-shot-settings-button");
const directorShotSettingsCompact = element<HTMLButtonElement>("director-shot-settings-compact");
const directorCurrentShotSummary = element<HTMLElement>("director-current-shot-summary");
const directorCurrentShotTime = element<HTMLElement>("director-current-shot-time");
const directorCurrentShotAssets = element<HTMLElement>("director-current-shot-assets");
const directorCurrentShotContinuity = element<HTMLElement>("director-current-shot-continuity");
const directorCurrentShotTransition = element<HTMLElement>("director-current-shot-transition");
const directorCurrentShotTools = element<HTMLElement>("director-p1-current-shot-tools");
const directorDrawerLayer = element<HTMLElement>("director-workspace-drawer-layer");
const directorDrawer = element<HTMLElement>("director-workspace-drawer");
const directorDrawerScrim = element<HTMLButtonElement>("director-drawer-scrim");
const directorDrawerClose = element<HTMLButtonElement>("director-drawer-close");
const directorDrawerTitle = element<HTMLElement>("director-drawer-title");
const directorDrawerTabs = element<HTMLElement>("director-drawer-tabs");
const directorDrawerShotHost = element<HTMLElement>("director-drawer-shot-host");
const directorShotAssetBindings = element<HTMLElement>("director-p1-shot-asset-bindings");
const directorShotAssetsTitle = element<HTMLElement>("director-p1-shot-assets-title");
const directorShotAssetsDescription = element<HTMLElement>("director-p1-shot-assets-description");
const directorProjectDataRelations = element<HTMLElement>("director-project-data-relations");
const directorProjectDataBindings = element<HTMLElement>("director-project-data-bindings");
const directorProjectDataBindAsset = element<HTMLButtonElement>("director-project-data-bind-asset");
const assetSearchInput = element<HTMLInputElement>("asset-search");
const assetTypeFilter = element<HTMLSelectElement>("asset-type-filter");
const assetAvailabilityFilter = element<HTMLSelectElement>("asset-availability-filter");
const assetSort = element<HTMLSelectElement>("asset-sort");
const assetRefreshButton = element<HTMLButtonElement>("asset-refresh-button");
const assetImportButton = element<HTMLButtonElement>("asset-import-button");
const assetAdvancedImportButton = element<HTMLButtonElement>("asset-advanced-import-button");
const assetTrashButton = element<HTMLButtonElement>("asset-trash-button");
const assetViewList = element<HTMLButtonElement>("asset-view-list");
const assetViewGrid = element<HTMLButtonElement>("asset-view-grid");
const assetLibraryStatus = element<HTMLOutputElement>("asset-library-status");
const assetLibraryToolbar = element<HTMLElement>("asset-library-toolbar");
const assetList = element<HTMLElement>("asset-list");
const assetListCount = element<HTMLElement>("asset-list-count");
const assetEmpty = element<HTMLElement>("asset-empty");
const assetDetail = element<HTMLFormElement>("asset-detail");
const assetDetailEmpty = element<HTMLElement>("asset-detail-empty");
const assetDetailState = element<HTMLElement>("asset-detail-state");
const assetDetailType = element<HTMLElement>("asset-detail-type");
const assetDetailSize = element<HTMLElement>("asset-detail-size");
const assetDetailHash = element<HTMLElement>("asset-detail-hash");
const assetDetailStorage = element<HTMLElement>("asset-detail-storage");
const assetDisplayName = element<HTMLInputElement>("asset-display-name");
const assetTags = element<HTMLInputElement>("asset-tags");
const assetNote = element<HTMLTextAreaElement>("asset-note");
const assetDetailPath = element<HTMLElement>("asset-detail-path");
const assetSaveMetadata = element<HTMLButtonElement>("asset-save-metadata");
const assetRelocateButton = element<HTMLButtonElement>("asset-relocate");
const assetCopyProjectButton = element<HTMLButtonElement>("asset-copy-project");
const projectCenterStatus = element<HTMLOutputElement>("project-center-status");
const projectCenterDataRoot = element<HTMLElement>("project-center-data-root");
const projectCenterRecentList = element<HTMLElement>("project-center-recent-list");
const projectCenterRecentEmpty = element<HTMLElement>("project-center-recent-empty");
const projectCenterCreate = element<HTMLButtonElement>("project-center-create");
const projectCenterOpenDataRoot = element<HTMLButtonElement>("project-center-open-data-root");
const projectCenterChangeDataRoot = element<HTMLButtonElement>("project-center-change-data-root");
const projectCenterImportBundle = element<HTMLButtonElement>("project-center-import-bundle");
const projectCenterExportBundle = element<HTMLButtonElement>("project-center-export-bundle");
const projectCenterClone = element<HTMLButtonElement>("project-center-clone");
const projectCenterArchive = element<HTMLButtonElement>("project-center-archive");
const projectCenterTrash = element<HTMLButtonElement>("project-center-trash");
const projectTrashDialog = element<HTMLDialogElement>("project-trash-dialog");
const projectTrashList = element<HTMLElement>("project-trash-list");
const projectTrashEmpty = element<HTMLElement>("project-trash-empty");
const projectTrashClose = element<HTMLButtonElement>("project-trash-close");
const projectCenterProjectTemplate = element<HTMLTemplateElement>("project-center-project-template");
const projectCenterMaintenancePanel = projectCenterImportBundle.closest<HTMLElement>(".project-center-maintenance");
const projectCenterDataRootPanel = projectCenterDataRoot.closest<HTMLElement>(".data-root-panel");
const projectConvertToDirector = element<HTMLButtonElement>("project-convert-to-director");
const assetCurrentProject = element<HTMLElement>("asset-current-project");
const assetDropZone = element<HTMLElement>("asset-drop-zone");
const assetDetailLayer = element<HTMLElement>("asset-detail-layer");
const assetDetailDrawer = element<HTMLElement>("asset-detail-drawer");
const assetDetailBackdrop = element<HTMLButtonElement>("asset-detail-backdrop");
const assetDetailClose = element<HTMLButtonElement>("asset-detail-close");
const assetDetailThumbnail = element<HTMLImageElement>("asset-detail-thumbnail");
const assetDetailPreviewFallback = element<HTMLElement>("asset-detail-preview-fallback");
const assetDetailPreviewName = element<HTMLElement>("asset-detail-preview-name");
const assetDetailPreviewMeta = element<HTMLElement>("asset-detail-preview-meta");
const assetDetailTechnical = element<HTMLElement>("asset-detail-technical");
const assetDetailUsageCount = element<HTMLElement>("asset-detail-usage-count");
const assetBindingCount = element<HTMLElement>("asset-binding-count");
const assetBindingList = element<HTMLElement>("asset-binding-list");
const assetRevealFile = element<HTMLButtonElement>("asset-reveal-file");
const assetRemoveRecord = element<HTMLButtonElement>("asset-remove-record");
const assetImportOptionsDialog = element<HTMLDialogElement>("asset-import-options-dialog");
const assetTrashDialog = element<HTMLDialogElement>("asset-trash-dialog");
const assetTrashList = element<HTMLElement>("asset-trash-list");
const assetTrashEmpty = element<HTMLElement>("asset-trash-empty");
const assetTrashClose = element<HTMLButtonElement>("asset-trash-close");
const assetImportOptionsCancel = element<HTMLButtonElement>("asset-import-options-cancel");
const assetImportReferenceConfirm = element<HTMLButtonElement>("asset-import-reference-confirm");
const directorUndoButton = element<HTMLButtonElement>("director-undo-button");
const directorRedoButton = element<HTMLButtonElement>("director-redo-button");
const directorHistoryButton = element<HTMLButtonElement>("director-history-button");
const directorAutosaveState = element<HTMLElement>("director-autosave-state");
const directorHistoryDrawer = element<HTMLDetailsElement>("director-p1-history-drawer");
const directorCurrentShotHeading = element<HTMLElement>("director-p1-current-shot-heading");
const directorCurrentShotDuration = element<HTMLSelectElement>("director-p1-current-shot-duration");
const directorWorkspaceTotalDuration = element<HTMLOutputElement>("director-p1-total-duration");
const directorShotStartState = element<HTMLFieldSetElement>("director-shot-start-state");
const directorShotEndState = element<HTMLFieldSetElement>("director-shot-end-state");
const directorShotStartSource = element<HTMLElement>("director-shot-start-source");
const directorShotStateCount = element<HTMLElement>("director-shot-state-count");
const directorShotRestoreInheritance = element<HTMLButtonElement>("director-shot-restore-inheritance");
const directorShotLockState = element<HTMLButtonElement>("director-shot-lock-state");
const directorShotTransitionKind = element<HTMLSelectElement>("director-shot-transition-kind");
const directorShotTransitionAsset = element<HTMLSelectElement>("director-shot-transition-asset");
const directorShotTransitionState = element<HTMLElement>("director-shot-transition-state");
const directorTransitionInheritSubject = element<HTMLInputElement>("director-transition-inherit-subject");
const directorTransitionInheritEnvironment = element<HTMLInputElement>("director-transition-inherit-environment");
const directorTransitionInheritAudio = element<HTMLInputElement>("director-transition-inherit-audio");
const directorShotBindAsset = element<HTMLButtonElement>("director-shot-bind-asset");
const projectCreateDialog = element<HTMLDialogElement>("project-create-dialog");
const projectCreateForm = element<HTMLFormElement>("project-create-form");
const projectCreateName = element<HTMLInputElement>("project-create-name");
const projectCreateError = element<HTMLElement>("project-create-error");
const projectCreateCancel = element<HTMLButtonElement>("project-create-cancel");
const dataRootDialog = element<HTMLDialogElement>("data-root-dialog");
const dataRootMigrateButton = element<HTMLButtonElement>("data-root-migrate-button");
const dataRootNewLibraryButton = element<HTMLButtonElement>("data-root-new-library-button");
const dataRootCancel = element<HTMLButtonElement>("data-root-cancel");

assetDetailHash.parentElement?.classList.add("asset-detail-summary__hash");
assetDetailTechnical.parentElement?.classList.add("asset-detail-summary__technical");
assetDetailUsageCount.parentElement?.classList.add("asset-detail-summary__usage");

let latestScan: ScanInstallationResult | null = null;
let installationComplete = false;
let activeInstallationId: string | null = null;
let installationPollToken = 0;
let lastInstallationState: InstallationStatusResult["state"] | null = null;
let installationTransferSample: {
  readonly installationId: string;
  readonly downloadedBytes: number;
  readonly timestampMs: number;
  readonly bytesPerSecond: number | null;
} | null = null;
let firstFrame: FrameSelection | null = null;
let lastFrame: FrameSelection | null = null;
let exportDirectory: ExportDirectorySelection | null = null;
let scanTimer: number | null = null;
let preparedOptionalComponents = new Set<ComponentId>();
const completedOptionalComponents = new Set<ComponentId>();
let restoredConfigurationReady = false;
let projectCenterState: ProjectCenterState | null = null;
let projectCenterRequestGeneration = 0;
let activeRelayProject: RelayProjectDocument | null = null;
let activeProjectActivationEpoch = 0;
let projectSaveTimer: number | null = null;
let projectSaveInFlight: Promise<RelayProjectDocument> | null = null;
let directorWorkspace: ProjectWorkspaceController | null = null;
let directorWorkspaceSaveTimer: number | null = null;
let directorWorkspaceSaveInFlight: Promise<void> | null = null;
const directorContinuityInputs = new Map<string, HTMLTextAreaElement>();
const DIRECTOR_CONTINUITY_LABELS: Readonly<Record<RelayContinuityField, string>> = Object.freeze({
  subject: "角色 / 主体",
  wardrobeAppearance: "服装与外观",
  poseAction: "姿态与动作",
  framePosition: "画面位置",
  heldProps: "持有道具",
  sceneWeatherTime: "场景、天气与时间",
  cameraPositionMovement: "摄影机位置与运动",
  lighting: "光线",
  audioState: "声音状态"
});
const DIRECTOR_TRANSITION_SUBJECT_FIELDS: readonly RelayContinuityField[] = Object.freeze([
  "subject", "wardrobeAppearance", "poseAction", "framePosition", "heldProps"
]);
const DIRECTOR_TRANSITION_ENVIRONMENT_FIELDS: readonly RelayContinuityField[] = Object.freeze([
  "sceneWeatherTime", "cameraPositionMovement", "lighting"
]);
const DIRECTOR_TRANSITION_AUDIO_FIELDS: readonly RelayContinuityField[] = Object.freeze(["audioState"]);
let projectAssetViews: readonly ProjectAssetViewContract[] = Object.freeze([]);
let assetImportMode: "copy" | "reference" = "copy";
let assetViewMode: "grid" | "list" = "grid";
let assetDetailReturnFocus: HTMLElement | null = null;
let directorAssetCatalogRequestGeneration = 0;
let assetPreviewRequestGeneration = 0;
let assetTrashRequestGeneration = 0;
let directorWorkspaceLoadGeneration = 0;
const modalIsolationAdded = new WeakMap<HTMLElement, readonly HTMLElement[]>();

function modalFocusableElements(root: HTMLElement): readonly HTMLElement[] {
  return Object.freeze([...root.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], summary, [contenteditable="true"], [tabindex]:not([tabindex="-1"])'
  )].filter((candidate) => (
    candidate.offsetParent !== null
    && candidate.getAttribute("aria-hidden") !== "true"
    && !candidate.hasAttribute("inert")
  )));
}

function setModalIsolation(layer: HTMLElement, active: boolean): void {
  if (!active) {
    for (const target of modalIsolationAdded.get(layer) ?? []) target.removeAttribute("inert");
    modalIsolationAdded.delete(layer);
    return;
  }
  if (modalIsolationAdded.has(layer)) return;
  const candidates = [
    ...document.querySelectorAll<HTMLElement>(".app-header, .tool-sidebar"),
    ...[...(layer.parentElement?.children ?? [])].filter((candidate): candidate is HTMLElement => (
      candidate instanceof HTMLElement && candidate !== layer
    ))
  ];
  const added: HTMLElement[] = [];
  for (const target of candidates) {
    if (target.hasAttribute("inert")) continue;
    target.setAttribute("inert", "");
    added.push(target);
  }
  modalIsolationAdded.set(layer, Object.freeze(added));
}

let selectedProjectAssetId: string | null = null;
const directorShotMemory = new Map<string, string>();
interface DirectorShotMetadata {
  cameraLanguage: string;
  soundCue: string;
  transitionNote: string;
}
const directorShotMetadata = new Map<string, DirectorShotMetadata>();
const directorShotIds = new Map<string, string>();
let directorActiveShotId: string | null = null;
let directorLastCompiledSnapshot = "";
let directorLastCompiledTechnicalSnapshot = "";
let directorLastCompiledShotFingerprints: Readonly<Record<string, string>> = Object.freeze({});
let directorLegacyShotIdMap: Readonly<Record<string, string>> = Object.freeze({});
let directorProductionState: DirectorProductionState = createEmptyProductionState({ identityKey: "relay-director-p1" });
interface DirectorPendingCompilation {
  readonly sequence: number;
  readonly projectId: string;
  readonly activationEpoch: number;
  readonly workflowName: string;
  readonly project: ProjectSpec;
  readonly compilationSnapshot: string;
  readonly technicalSnapshot: string;
  readonly totalDurationSeconds: DurationSeconds;
  readonly segmentDurationsSeconds: readonly SegmentDurationSeconds[];
  readonly segmentShotIds: readonly string[];
  readonly submission: DirectorP1Submission;
}
let directorPendingCompilation: DirectorPendingCompilation | null = null;
let directorCompilationSequence = 0;
let directorLatestSubmittedSequence = 0;
let directorCompileDispatchPending = false;
let directorCompileInFlightCount = 0;
let directorP1Ui: DirectorP1Ui;

const officialCapabilities = MINIMAX_H3_OFFICIAL_WORKFLOW_CAPABILITIES;
element("official-sampler").textContent = officialCapabilities.sampler;
element("official-scheduler").textContent = officialCapabilities.scheduler;
element("official-fps").textContent = `${officialCapabilities.fps} fps（固定）`;
element("official-native-audio").textContent = `${officialCapabilities.nativeAudioSampleRateHz / 1000} kHz 立体声联合生成`;
element("official-guidance-controls").textContent = officialCapabilities.configurableCfgScale || officialCapabilities.configurableNegativePrompt
  ? "由认证工作流提供"
  : "官方模板不暴露";
const qualityOption = samplingProfile.querySelector<HTMLOptionElement>('option[value="quality_20"]');
const highQualityOption = samplingProfile.querySelector<HTMLOptionElement>('option[value="quality_25"]');
const turboOption = samplingProfile.querySelector<HTMLOptionElement>('option[value="turbo_8"]');
if (qualityOption !== null) qualityOption.textContent = `标准 · ${officialCapabilities.qualitySteps} 步`;
if (highQualityOption !== null) highQualityOption.textContent = `高质量 · ${officialCapabilities.highQualitySteps} 步`;
if (turboOption !== null) turboOption.textContent = `Turbo · ${officialCapabilities.turboSteps} 步 / LoRA 强度 ${officialCapabilities.turboModelStrength}`;

function setGlobalStatus(message: string): void {
  globalStatus.textContent = message;
}

// A33_TOAST_LIFECYCLE_START
type FeedbackKind = "success" | "warning" | "error";

interface ToastScope {
  readonly view: ViewName;
  readonly navigationRevision: number;
}

interface ActiveToast extends ToastScope {
  readonly notificationId: number;
}

interface FeedbackOptions {
  readonly kind: FeedbackKind;
  readonly title: string;
  readonly message: string;
  readonly detail?: string;
  readonly seedResolution?: RelayResolvedSeedPlan;
  readonly modal?: boolean;
  readonly toastScope?: ToastScope | null;
}

type FeedbackReporter = (options: Omit<FeedbackOptions, "toastScope">) => void;

let currentToastView: ViewName | null = null;
let toastNavigationRevision = 0;
let nextToastNotificationId = 0;
let activeToast: ActiveToast | null = null;
let appToastTimer: number | null = null;

function toastScopeIsCurrent(scope: ToastScope): boolean {
  return currentToastView === scope.view && toastNavigationRevision === scope.navigationRevision;
}

function captureToastScope(): ToastScope | null {
  return currentToastView === null
    ? null
    : Object.freeze({ view: currentToastView, navigationRevision: toastNavigationRevision });
}

function hideToast(expectedNotificationId?: number): void {
  if (expectedNotificationId !== undefined && activeToast?.notificationId !== expectedNotificationId) return;
  if (appToastTimer !== null) {
    window.clearTimeout(appToastTimer);
    appToastTimer = null;
  }
  activeToast = null;
  appToast.hidden = true;
}

function setToastView(view: ViewName): void {
  if (currentToastView === view) return;
  currentToastView = view;
  toastNavigationRevision += 1;
  if (activeToast !== null && !toastScopeIsCurrent(activeToast)) {
    hideToast(activeToast.notificationId);
  }
}

function showToast(options: FeedbackOptions): void {
  const scope = options.toastScope === undefined ? captureToastScope() : options.toastScope;
  if (scope === null || !toastScopeIsCurrent(scope)) return;
  hideToast();
  const notificationId = ++nextToastNotificationId;
  activeToast = Object.freeze({ ...scope, notificationId });
  appToastTitle.textContent = options.title;
  appToastMessage.textContent = options.detail === undefined || options.detail.length === 0
    ? options.message
    : `${options.message} · ${options.detail}`;
  appToast.hidden = false;
  appToastTimer = window.setTimeout(() => hideToast(notificationId), 5200);
}

function feedbackForScope(scope: ToastScope | null = captureToastScope()): FeedbackReporter {
  return (options) => showFeedback({ ...options, toastScope: scope });
}

appToastClose.addEventListener("click", () => hideToast());

function showFeedback(options: FeedbackOptions): void {
  if (options.kind === "success" && options.modal !== true) {
    showToast(options);
    return;
  }
  if (!feedbackDialog.open) {
    const active = document.activeElement;
    feedbackReturnFocus = active instanceof HTMLElement ? active : null;
  }
  feedbackDialog.dataset.kind = options.kind;
  feedbackIcon.textContent = options.kind === "success" ? "✓" : options.kind === "warning" ? "!" : "×";
  feedbackKicker.textContent = options.kind === "success" ? "操作成功" : options.kind === "warning" ? "需要确认" : "操作未完成";
  feedbackTitle.textContent = options.title;
  feedbackMessage.textContent = options.message;
  feedbackDetail.textContent = options.detail ?? "";
  feedbackDetail.hidden = options.detail === undefined || options.detail.length === 0;
  renderFeedbackSeedEvidence(options.seedResolution);
  if (!feedbackDialog.open) feedbackDialog.showModal();
  feedbackClose.focus();
}

function renderFeedbackSeedEvidence(plan: RelayResolvedSeedPlan | undefined): void {
  feedbackShotSeeds.replaceChildren();
  if (plan === undefined) {
    feedbackSeedEvidence.hidden = true;
    feedbackSeedPolicy.textContent = "";
    feedbackBaseSeed.textContent = "";
    return;
  }
  feedbackSeedPolicy.textContent = plan.policy === "fixed" ? "固定种子" : "本次编译随机";
  feedbackBaseSeed.textContent = String(plan.baseSeed);
  for (const shot of plan.shots) {
    const row = document.createElement("li");
    if (shot.shotId !== null) row.title = `稳定镜头 ID：${shot.shotId}`;
    const label = document.createElement("span");
    label.textContent = `镜头 ${String(shot.ordinal).padStart(2, "0")}`;
    const value = document.createElement("code");
    value.textContent = String(shot.seed);
    row.append(label, value);
    feedbackShotSeeds.append(row);
  }
  feedbackSeedEvidence.hidden = false;
}
// A33_TOAST_LIFECYCLE_END

feedbackClose.addEventListener("click", () => feedbackDialog.close());
let feedbackReturnFocus: HTMLElement | null = null;
feedbackDialog.addEventListener("close", () => {
  const target = feedbackReturnFocus;
  feedbackReturnFocus = null;
  if (target?.isConnected === true) target.focus({ preventScroll: true });
});

let environmentRequiredReturnFocus: HTMLElement | null = null;
let environmentRequiredNavigating = false;

function showEnvironmentRequiredDialog(): void {
  const locations = latestScan === null ? null : resultLocations(latestScan);
  const missing = latestScan === null
    ? []
    : [
        locations?.comfyUiRoot === null ? "ComfyUI" : null,
        ...latestScan.components
          .filter((component) => component.required && component.state !== "verified_reuse")
          .map((component) => component.title)
      ].filter((label): label is string => label !== null);
  environmentRequiredTitle.textContent = lastInstallationState === "running" || lastInstallationState === "cancel_pending"
    ? "必需环境正在准备"
    : "必需环境尚未准备";
  environmentRequiredMessage.textContent = missing.length > 0
    ? `仍需准备或验证：${[...new Set(missing)].join("、")}。当前项目和草稿已经保留。`
    : "当前项目和草稿已经保留。安装页会列出本机仍缺少或尚未验证的组件。";
  if (!environmentRequiredDialog.open) {
    const active = document.activeElement;
    environmentRequiredReturnFocus = active instanceof HTMLElement ? active : null;
    environmentRequiredNavigating = false;
    environmentRequiredDialog.showModal();
  }
  environmentRequiredInstall.focus();
}

environmentRequiredCancel.addEventListener("click", () => environmentRequiredDialog.close());
environmentRequiredInstall.addEventListener("click", () => {
  environmentRequiredNavigating = true;
  environmentRequiredDialog.close();
  showView("install");
  const focusNextAction = (): void => {
    const target = !managedRootSection.hidden ? installRoot : prepareButton;
    target.scrollIntoView({ block: "center", behavior: preferredScrollBehavior() });
    target.focus({ preventScroll: true });
  };
  if (latestScan === null) {
    void runScan(true).finally(focusNextAction);
  } else {
    window.requestAnimationFrame(focusNextAction);
  }
});
environmentRequiredDialog.addEventListener("close", () => {
  const target = environmentRequiredReturnFocus;
  environmentRequiredReturnFocus = null;
  if (!environmentRequiredNavigating && target?.isConnected === true) {
    target.focus({ preventScroll: true });
  }
  environmentRequiredNavigating = false;
});

let actionConfirmReturnFocus: HTMLElement | null = null;
let actionConfirmResolve: ((confirmed: boolean) => void) | null = null;

function finishActionConfirmation(confirmed: boolean): void {
  const resolve = actionConfirmResolve;
  actionConfirmResolve = null;
  if (actionConfirmDialog.open) actionConfirmDialog.close();
  resolve?.(confirmed);
  const target = actionConfirmReturnFocus;
  actionConfirmReturnFocus = null;
  if (target?.isConnected === true) target.focus({ preventScroll: true });
}

function confirmAction(options: {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
}): Promise<boolean> {
  if (actionConfirmResolve !== null) finishActionConfirmation(false);
  const active = document.activeElement;
  actionConfirmReturnFocus = active instanceof HTMLElement ? active : null;
  actionConfirmTitle.textContent = options.title;
  actionConfirmMessage.textContent = options.message;
  actionConfirmSubmit.textContent = options.confirmLabel;
  actionConfirmDialog.showModal();
  actionConfirmCancel.focus();
  return new Promise<boolean>((resolve) => {
    actionConfirmResolve = resolve;
  });
}

actionConfirmCancel.addEventListener("click", () => finishActionConfirmation(false));
actionConfirmSubmit.addEventListener("click", () => finishActionConfirmation(true));
actionConfirmDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  finishActionConfirmation(false);
});

function preferredScrollBehavior(): ScrollBehavior {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  } catch {
    return "auto";
  }
}

function publicError(error: unknown): string {
  if (!(error instanceof Error)) return "操作未完成，请重试。";
  const message = error.message.replace(/^Error invoking remote method '[^']+':\s*/u, "");
  const separator = message.indexOf(": ");
  return separator >= 0 ? message.slice(separator + 2) : message;
}

type DirectorDrawerTab = "issues" | "prompt" | "details" | "assets" | "transition" | "takes";

const DIRECTOR_DRAWER_TITLES: Readonly<Record<DirectorDrawerTab, string>> = Object.freeze({
  issues: "编译检查",
  prompt: "提示词预览",
  details: "镜头状态与连续性",
  assets: "镜头素材",
  transition: "镜头衔接",
  takes: "候选成片"
});
let directorDrawerActiveTab: DirectorDrawerTab = "issues";
let directorDrawerReturnFocus: HTMLElement | null = null;

function directorDrawerPanel(tab: DirectorDrawerTab): HTMLElement {
  return element<HTMLElement>(`director-drawer-panel-${tab}`);
}

function createDirectorDrawerPanel(tab: Exclude<DirectorDrawerTab, "issues" | "prompt">): HTMLElement {
  const panel = document.createElement("section");
  panel.id = `director-drawer-panel-${tab}`;
  panel.className = "director-drawer-panel director-drawer-panel--shot";
  panel.dataset.directorDrawerPanel = tab;
  panel.setAttribute("role", "tabpanel");
  panel.setAttribute("aria-labelledby", `director-drawer-tab-${tab}`);
  panel.hidden = true;
  return panel;
}

function mountDirectorShotToolsInDrawer(): void {
  const body = directorCurrentShotTools.querySelector<HTMLElement>(".director-current-shot-tools__body");
  if (body === null) throw new Error("Director shot editor body is missing.");
  const durationField = directorCurrentShotDuration.closest<HTMLElement>(".field");
  const statePanel = element<HTMLElement>("director-shot-state-panel");
  const transitionPanel = element<HTMLElement>("director-shot-transition-panel");
  const assetsPanel = element<HTMLElement>("director-p1-shot-assets-title").closest<HTMLElement>("section");
  const continuityPanel = element<HTMLElement>("director-p1-continuity-panel");
  const takesPanel = element<HTMLElement>("director-p1-takes-panel");
  if (durationField === null || assetsPanel === null) throw new Error("Director drawer section is missing.");

  const details = createDirectorDrawerPanel("details");
  details.append(durationField, statePanel, continuityPanel);
  const assets = createDirectorDrawerPanel("assets");
  assets.append(assetsPanel);
  const transition = createDirectorDrawerPanel("transition");
  transition.append(transitionPanel);
  const takes = createDirectorDrawerPanel("takes");
  takes.append(takesPanel);
  body.replaceChildren(details, assets, transition, takes);
  directorCurrentShotTools.hidden = false;
  directorDrawerShotHost.append(directorCurrentShotTools);
}

function setDirectorDrawerTab(tab: DirectorDrawerTab): void {
  directorDrawerActiveTab = tab;
  directorDrawerTitle.textContent = DIRECTOR_DRAWER_TITLES[tab];
  for (const button of directorDrawerTabs.querySelectorAll<HTMLButtonElement>("[data-director-drawer-tab]")) {
    const active = button.dataset.directorDrawerTab === tab;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  }
  for (const panel of directorDrawer.querySelectorAll<HTMLElement>("[data-director-drawer-panel]")) {
    panel.hidden = panel.dataset.directorDrawerPanel !== tab;
  }
}

function openDirectorDrawer(tab: DirectorDrawerTab, trigger?: HTMLElement | null): void {
  if (!assetDetailLayer.hidden) closeAssetDetailDrawer(false);
  if (directorDrawerLayer.hidden) {
    directorDrawerReturnFocus = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  }
  setDirectorDrawerTab(tab);
  directorDrawerLayer.hidden = false;
  setModalIsolation(directorDrawerLayer, true);
  document.body.classList.add("director-drawer-open");
  directorCheckButton.setAttribute("aria-expanded", "true");
  directorShotSettingsButton.setAttribute("aria-expanded", "true");
  directorShotSettingsCompact.setAttribute("aria-expanded", "true");
  window.requestAnimationFrame(() => {
    const activeTab = directorDrawerTabs.querySelector<HTMLButtonElement>(
      `[data-director-drawer-tab="${tab}"]`
    );
    (activeTab ?? directorDrawerClose).focus({ preventScroll: true });
  });
}

function closeDirectorDrawer(restoreFocus = true): void {
  if (directorDrawerLayer.hidden) return;
  directorDrawerLayer.hidden = true;
  setModalIsolation(directorDrawerLayer, false);
  document.body.classList.remove("director-drawer-open");
  directorCheckButton.setAttribute("aria-expanded", "false");
  directorShotSettingsButton.setAttribute("aria-expanded", "false");
  directorShotSettingsCompact.setAttribute("aria-expanded", "false");
  const target = directorDrawerReturnFocus;
  directorDrawerReturnFocus = null;
  if (restoreFocus && target?.isConnected === true) target.focus({ preventScroll: true });
}

mountDirectorShotToolsInDrawer();
setDirectorDrawerTab("issues");

directorDrawerTabs.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-director-drawer-tab]");
  const tab = button?.dataset.directorDrawerTab as DirectorDrawerTab | undefined;
  if (button === null || tab === undefined || !(tab in DIRECTOR_DRAWER_TITLES)) return;
  setDirectorDrawerTab(tab);
});
directorDrawerTabs.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  const buttons = [...directorDrawerTabs.querySelectorAll<HTMLButtonElement>("[data-director-drawer-tab]")];
  const current = buttons.findIndex((button) => button.dataset.directorDrawerTab === directorDrawerActiveTab);
  if (current < 0) return;
  event.preventDefault();
  const delta = event.key === "ArrowRight" ? 1 : -1;
  const next = buttons[(current + delta + buttons.length) % buttons.length];
  if (next === undefined) return;
  setDirectorDrawerTab(next.dataset.directorDrawerTab as DirectorDrawerTab);
  next.focus();
});
directorDrawerClose.addEventListener("click", () => closeDirectorDrawer());
directorDrawerScrim.addEventListener("click", () => closeDirectorDrawer());
directorCheckButton.addEventListener("click", () => openDirectorDrawer("issues", directorCheckButton));
directorShotSettingsButton.addEventListener("click", () => openDirectorDrawer("details", directorShotSettingsButton));
directorShotSettingsCompact.addEventListener("click", () => openDirectorDrawer("details", directorShotSettingsCompact));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !directorDrawerLayer.hidden) {
    event.preventDefault();
    closeDirectorDrawer();
    return;
  }
  if (event.key !== "Tab" || directorDrawerLayer.hidden) return;
  const focusable = modalFocusableElements(directorDrawer);
  if (focusable.length === 0) {
    event.preventDefault();
    directorDrawer.focus({ preventScroll: true });
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
});

directorP1Ui = createDirectorP1Ui({
  initialState: directorProductionState,
  onChange: (state) => {
    directorProductionState = state;
    markDirectorDirty();
    reconcileDirectorTimelineFromProduction(state);
    renderDirectorShotAssetBindings();
    updateDirectorPreview();
  },
  onRestoreRevision: (revisionId) => restoreDirectorProductionRevisionToWorkCopy(revisionId),
  onOpenShotDrawer: (tab) => openDirectorDrawer(tab, directorShotSettingsButton),
  confirmAction,
  onValidationError: (message) => showFeedback({
    kind: "warning",
    title: "制作数据未保存",
    message
  })
});

function requireActiveRelayProjectId(): string {
  if (activeRelayProject === null) throw new Error("请先在项目中心新建或打开一个项目。");
  return activeRelayProject.projectId;
}

function captureProjectOperationContext(): ProjectOperationContext {
  return captureProjectOperationIdentity(activeRelayProject?.projectId ?? null, activeProjectActivationEpoch);
}

function isCurrentProjectOperation(context: ProjectOperationContext): boolean {
  return projectOperationIdentityMatches(
    context,
    activeRelayProject?.projectId ?? null,
    activeProjectActivationEpoch
  );
}

function requireCurrentProjectOperation(context: ProjectOperationContext): void {
  requireProjectOperationIdentity(
    context,
    activeRelayProject?.projectId ?? null,
    activeProjectActivationEpoch
  );
}

function activeRelayProjectName(): string {
  return activeRelayProject?.name ?? "Relay 项目";
}

function projectAssetExtension(asset: RelayProjectAsset): string {
  const match = asset.sourceFileName.match(/\.([a-z0-9]{1,12})$/iu);
  return match?.[1]?.toLocaleLowerCase("en-US") ?? "file";
}

function projectAssetAsLegacyRecord(asset: RelayProjectAsset): AssetRecord {
  return Object.freeze({
    assetId: asset.assetId,
    displayName: asset.displayName,
    sourceFileName: asset.sourceFileName,
    mediaType: asset.mediaType,
    extension: projectAssetExtension(asset),
    byteLength: asset.byteLength,
    sha256: asset.sha256,
    tags: asset.tags,
    note: asset.notes,
    storageMode: asset.storageMode === "project_copy" ? "project_copy" : "reference_original",
    availability: asset.availability === "available"
      ? "available"
      : asset.availability === "missing"
        ? "missing"
        : "changed",
    projectRelativePath: asset.projectRelativePath,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt
  });
}

function projectAvailabilityFilter(value: AssetAvailability | "all"): RelayProjectAsset["availability"] | "all" {
  return value;
}

const projectAssetLibraryAdapter: AssetLibraryApi = Object.freeze({
  async importLocalAssets(): Promise<AssetImportBatchResult> {
    const mutation = await flushAndCaptureProjectMutation();
    const result = await window.controlPlane.importProjectAssets({
      projectId: mutation.projectId,
      mode: assetImportMode
    });
    await synchronizeProjectMutation(mutation);
    requireCurrentProjectOperation(mutation);
    return Object.freeze({
      cancelled: result.cancelled,
      results: Object.freeze(result.results.map((entry) => {
        if (entry.status === "imported" && entry.asset !== null) {
          return Object.freeze({
            status: "imported" as const,
            selectedFileName: entry.fileName,
            asset: projectAssetAsLegacyRecord(entry.asset)
          });
        }
        if (entry.status === "duplicate" && entry.asset !== null) {
          return Object.freeze({
            status: "duplicate" as const,
            selectedFileName: entry.fileName,
            duplicateAsset: projectAssetAsLegacyRecord(entry.asset)
          });
        }
        return Object.freeze({
          status: "failed" as const,
          selectedFileName: entry.fileName,
          message: entry.issues.join("；") || "素材未通过本地预检。"
        });
      }))
    });
  },
  async listLocalAssets(request: Parameters<AssetLibraryApi["listLocalAssets"]>[0]): Promise<AssetListResult> {
    const context = captureProjectOperationContext();
    const views = await window.controlPlane.listProjectAssets({
      projectId: context.projectId,
      query: request.query,
      mediaType: request.mediaType,
      availability: projectAvailabilityFilter(request.availability),
      tags: request.tags
    });
    requireCurrentProjectOperation(context);
    projectAssetViews = views;
    return Object.freeze({ assets: Object.freeze(views.map((entry) => projectAssetAsLegacyRecord(entry.asset))), total: views.length });
  },
  async updateLocalAsset(request: Parameters<AssetLibraryApi["updateLocalAsset"]>[0]): Promise<AssetRecord> {
    const mutation = await flushAndCaptureProjectMutation();
    const asset = await window.controlPlane.updateProjectAsset({
      projectId: mutation.projectId,
      assetId: request.assetId,
      displayName: request.displayName,
      tags: request.tags,
      notes: request.note
    });
    await synchronizeProjectMutation(mutation);
    requireCurrentProjectOperation(mutation);
    return projectAssetAsLegacyRecord(asset);
  },
  async refreshLocalAssets(): Promise<AssetRefreshResult> {
    const mutation = await flushAndCaptureProjectMutation();
    const views = await window.controlPlane.refreshProjectAssets({ projectId: mutation.projectId });
    await synchronizeProjectMutation(mutation);
    requireCurrentProjectOperation(mutation);
    projectAssetViews = views;
    const assets = Object.freeze(views.map((entry) => projectAssetAsLegacyRecord(entry.asset)));
    return Object.freeze({
      assets,
      missingCount: views.filter((entry) => entry.asset.availability === "missing").length,
      changedCount: views.filter((entry) => entry.asset.availability === "changed").length
    });
  },
  async relocateLocalAsset(request: Parameters<AssetLibraryApi["relocateLocalAsset"]>[0]): Promise<AssetRelocateResult> {
    const mutation = await flushAndCaptureProjectMutation();
    const result = await window.controlPlane.relocateProjectAsset({
      projectId: mutation.projectId,
      assetId: request.assetId
    });
    await synchronizeProjectMutation(mutation);
    requireCurrentProjectOperation(mutation);
    if (result.status === "cancelled") return Object.freeze({ status: "cancelled" });
    if (result.status === "relinked" && result.asset !== null) {
      return Object.freeze({ status: "relocated", asset: projectAssetAsLegacyRecord(result.asset) });
    }
    if (result.status === "replacement_required") {
      throw new Error("所选文件与原素材内容不同，不能作为同一素材重新定位。请使用“导入素材”将它作为新素材加入项目。");
    }
    throw new Error(result.issues.join("；") || "所选文件未通过素材重新定位检查。");
  },
  async confirmLocalAssetReplacement(_request: Parameters<AssetLibraryApi["confirmLocalAssetReplacement"]>[0]): Promise<AssetRelocateConfirmResult> {
    return Object.freeze({ status: "cancelled" });
  },
  async copyLocalAssetToProject(request: Parameters<AssetLibraryApi["copyLocalAssetToProject"]>[0]): Promise<AssetCopyToProjectResult> {
    const mutation = await flushAndCaptureProjectMutation();
    const result = await window.controlPlane.copyProjectAssetIntoProject({
      projectId: mutation.projectId,
      assetId: request.assetId
    });
    await synchronizeProjectMutation(mutation);
    requireCurrentProjectOperation(mutation);
    const relativePath = result.asset.projectRelativePath;
    if (relativePath === null) throw new Error("项目素材副本已经写入，但未返回可验证的项目相对路径。");
    return Object.freeze({
      status: "copied",
      projectDirectoryName: activeRelayProjectName(),
      projectRelativePath: relativePath,
      asset: projectAssetAsLegacyRecord(result.asset)
    });
  },
  async prepareLocalAssetFrame(request: Parameters<AssetLibraryApi["prepareLocalAssetFrame"]>[0]) {
    const context = captureProjectOperationContext();
    const selection = await window.controlPlane.prepareProjectAssetFrame({
      projectId: context.projectId,
      assetId: request.assetId,
      slot: request.slot
    });
    requireCurrentProjectOperation(context);
    return selection;
  }
});

const assetLibraryController = createAssetLibraryController(projectAssetLibraryAdapter);
let assetLibrarySnapshot: AssetLibrarySnapshot = assetLibraryController.getSnapshot();
let allAssetRecords: readonly AssetRecord[] = Object.freeze([]);
let selectedAssetId: string | null = null;
let assetSearchTimer: number | null = null;

const ASSET_TYPE_LABELS: Readonly<Record<AssetMediaType, string>> = Object.freeze({
  image: "图片",
  video: "视频",
  audio: "音频"
});
const ASSET_AVAILABILITY_LABELS: Readonly<Record<AssetAvailability, string>> = Object.freeze({
  available: "可用",
  missing: "源文件丢失",
  changed: "源文件已变化"
});
const PROJECT_ASSET_AVAILABILITY_LABELS: Readonly<Record<RelayProjectAsset["availability"], string>> = Object.freeze({
  available: "可用",
  needs_conversion: "需转换",
  missing: "文件丢失",
  changed: "文件已变化",
  incompatible: "不兼容",
  inspection_failed: "检查失败"
});
const ASSET_PREFLIGHT_STATUS_LABELS: Readonly<Record<string, string>> = Object.freeze({
  usable: "检查通过",
  needs_conversion: "需要转换",
  missing: "文件丢失",
  changed: "文件已变化",
  incompatible: "不兼容",
  check_failed: "检查失败"
});
const ASSET_PURPOSE_LABELS: Readonly<Record<RelayAssetPurpose, string>> = Object.freeze({
  first_frame: "首帧",
  last_frame: "尾帧",
  subject_reference: "主体参考",
  product_reference: "产品参考",
  scene_reference: "场景参考",
  style_reference: "风格参考",
  motion_reference: "动作参考",
  video_reference: "视频参考",
  audio_reference: "音频参考",
  continuity_reference: "连续性参考"
});
const DIRECTOR_PROJECT_REFERENCE_PURPOSE_BY_MEDIA: Readonly<Record<RelayMediaType, RelayAssetPurpose>> = Object.freeze({
  image: "continuity_reference",
  video: "video_reference",
  audio: "audio_reference"
});
const DIRECTOR_IMAGE_REFERENCE_PURPOSES: readonly RelayAssetPurpose[] = Object.freeze([
  "subject_reference",
  "product_reference",
  "scene_reference",
  "style_reference",
  "continuity_reference"
]);

type DirectorAssetProjectionStatus = "executable" | "record_only" | "invalid";
type DirectorAssetProjectionSlot = "first" | "last";

interface DirectorAssetProjectionEntry {
  readonly binding: RelayAssetBinding;
  readonly asset: RelayProjectAsset | null;
  status: DirectorAssetProjectionStatus;
  slot: DirectorAssetProjectionSlot | null;
  message: string;
}

interface DirectorAssetProjectionPlan {
  readonly entries: ReadonlyMap<string, DirectorAssetProjectionEntry>;
  readonly first: DirectorAssetProjectionEntry | null;
  readonly last: DirectorAssetProjectionEntry | null;
  readonly errors: readonly string[];
}

interface DirectorPreparedFrameSelectionIds {
  readonly firstFrameSelectionId: string | null;
  readonly lastFrameSelectionId: string | null;
}

function directorOrderedShotIds(project: RelayProjectDocument): readonly string[] {
  return Object.freeze(orderedDirectorShots(project).map(({ shot }) => shot.shotId));
}

function directorSortedShotBindings(project: RelayProjectDocument): readonly RelayAssetBinding[] {
  const shotIds = directorOrderedShotIds(project);
  const shotOrder = new Map(shotIds.map((shotId, index) => [shotId, index]));
  const purposeOrder = new Map<RelayAssetPurpose, number>([
    ["first_frame", 0],
    ["subject_reference", 1],
    ["product_reference", 2],
    ["scene_reference", 3],
    ["style_reference", 4],
    ["continuity_reference", 5],
    ["last_frame", 6],
    ["motion_reference", 7],
    ["video_reference", 8],
    ["audio_reference", 9]
  ]);
  return Object.freeze(project.bindings
    .filter((binding) => binding.targetKind === "shot" && shotOrder.has(binding.targetId))
    .sort((left, right) => (
      (shotOrder.get(left.targetId) ?? Number.MAX_SAFE_INTEGER) - (shotOrder.get(right.targetId) ?? Number.MAX_SAFE_INTEGER)
      || (purposeOrder.get(left.purpose) ?? Number.MAX_SAFE_INTEGER) - (purposeOrder.get(right.purpose) ?? Number.MAX_SAFE_INTEGER)
      || left.createdAt.localeCompare(right.createdAt)
      || left.bindingId.localeCompare(right.bindingId)
    )));
}

function buildDirectorAssetProjectionPlan(
  project: RelayProjectDocument,
  mode: ProjectMode
): DirectorAssetProjectionPlan {
  const shotIds = directorOrderedShotIds(project);
  const firstShotId = shotIds[0] ?? null;
  const lastShotId = shotIds.at(-1) ?? null;
  const assetById = new Map(project.assets.map((asset) => [asset.assetId, asset]));
  const entries = new Map<string, DirectorAssetProjectionEntry>();
  const errors = new Set<string>();
  const firstCandidates: DirectorAssetProjectionEntry[] = [];
  const lastCandidates: DirectorAssetProjectionEntry[] = [];
  const referenceCandidates: DirectorAssetProjectionEntry[] = [];

  const invalidate = (entry: DirectorAssetProjectionEntry, message: string): void => {
    entry.status = "invalid";
    entry.slot = null;
    entry.message = `无法编译 · ${message}`;
    errors.add(message);
  };

  const recordOnlyMessage = (
    binding: RelayAssetBinding,
    asset: RelayProjectAsset | null
  ): string => {
    const reason = mode === "T2V"
      ? "T2V 不接收素材输入"
      : mode === "FL2VA"
        ? "FL2VA 仅接入首帧和尾帧图片"
        : binding.purpose === "motion_reference"
          ? "当前认证 Ref2VA 编译器不接入动作参考"
          : "此用途不会接入当前 Ref2VA 节点";
    const availability = asset === null
      ? " · 素材记录缺失（仅警告，不阻断编译）"
      : asset.availability === "available"
        ? ""
        : ` · ${PROJECT_ASSET_AVAILABILITY_LABELS[asset.availability]}（仅警告，不阻断编译）`;
    return `项目资料关系 · 不进入当前 H3 工作流 · ${reason}${availability}`;
  };

  for (const binding of directorSortedShotBindings(project)) {
    const asset = assetById.get(binding.assetId) ?? null;
    const disposition = directorBindingProjectionDisposition(mode, binding.purpose);
    const entry: DirectorAssetProjectionEntry = {
      binding,
      asset,
      status: disposition,
      slot: null,
      message: disposition === "record_only"
        ? recordOnlyMessage(binding, asset)
        : "等待校验 · 本用途会进入当前 H3 工作流"
    };
    entries.set(binding.bindingId, entry);
    // Disposition is determined before file validation. A record-only relation
    // is allowed to retain a missing or changed source as recoverable project
    // metadata; only a binding that the graph will consume may block compile.
    if (disposition === "record_only") continue;
    if (asset === null) {
      invalidate(entry, `${ASSET_PURPOSE_LABELS[binding.purpose]}绑定的素材记录不存在，请解除绑定或重新导入。`);
      continue;
    }
    if (asset.availability !== "available") {
      invalidate(entry, `${asset.displayName} 当前状态为“${PROJECT_ASSET_AVAILABILITY_LABELS[asset.availability]}”，请先在素材库处理。`);
      continue;
    }
    if (mode === "FL2VA") {
      if (asset.mediaType !== "image") {
        invalidate(entry, `${ASSET_PURPOSE_LABELS[binding.purpose]}必须绑定通过预检的图片素材。`);
        continue;
      }
      const expectedShotId = binding.purpose === "first_frame" ? firstShotId : lastShotId;
      if (binding.targetId !== expectedShotId) {
        invalidate(entry, binding.purpose === "first_frame"
          ? "首帧只能绑定到本次编译的第一个镜头。"
          : "尾帧只能绑定到本次编译的最后一个镜头。");
        continue;
      }
      (binding.purpose === "first_frame" ? firstCandidates : lastCandidates).push(entry);
      continue;
    }
    if (asset.mediaType !== "image") {
      invalidate(entry, `${ASSET_PURPOSE_LABELS[binding.purpose]}必须绑定通过预检的图片素材。`);
      continue;
    }
    if (shotIds.length !== 1 || binding.targetId !== firstShotId) {
      invalidate(entry, "当前认证 Ref2VA 镜头素材接入仅支持单镜头工作流。请改为单镜头，或将该素材保留为项目资料。");
      continue;
    }
    referenceCandidates.push(entry);
  }

  if (firstCandidates.length > 1) {
    for (const entry of firstCandidates) invalidate(entry, "本次工作流存在多个首帧绑定；每次编译只能有一个首帧。");
  } else if (firstCandidates[0] !== undefined) {
    firstCandidates[0].status = "executable";
    firstCandidates[0].slot = "first";
    firstCandidates[0].message = "进入本次 H3 工作流 · 首帧";
  }
  if (lastCandidates.length > 1) {
    for (const entry of lastCandidates) invalidate(entry, "本次工作流存在多个尾帧绑定；每次编译只能有一个尾帧。");
  } else if (lastCandidates[0] !== undefined) {
    lastCandidates[0].status = "executable";
    lastCandidates[0].slot = "last";
    lastCandidates[0].message = "进入本次 H3 工作流 · 尾帧";
  }

  if (referenceCandidates.length > 0) {
    const duplicateAssetIds = new Set<string>();
    const seenAssetIds = new Set<string>();
    for (const entry of referenceCandidates) {
      const assetId = entry.asset?.assetId;
      if (assetId === undefined) continue;
      if (seenAssetIds.has(assetId)) duplicateAssetIds.add(assetId);
      seenAssetIds.add(assetId);
    }
    if (duplicateAssetIds.size > 0) {
      for (const entry of referenceCandidates) {
        if (entry.asset !== null && duplicateAssetIds.has(entry.asset.assetId)) {
          invalidate(entry, `${entry.asset.displayName} 被重复绑定为 Ref2VA 参考图；同一图片只需绑定一次。`);
        }
      }
    }
    if (referenceCandidates.length > 2) {
      for (const entry of referenceCandidates.slice(2)) {
        invalidate(entry, "当前认证 Ref2VA 工作流最多接入 2 张参考图片；请解除多余绑定。");
      }
    }
    const validReferences = referenceCandidates.filter((entry) => entry.status !== "invalid").slice(0, 2);
    for (const [index, entry] of validReferences.entries()) {
      entry.status = "executable";
      entry.slot = index === 0 ? "first" : "last";
      entry.message = `进入本次 H3 工作流 · 参考图 ${index + 1}`;
    }
  }

  const executableEntries = [...entries.values()].filter((entry) => entry.status === "executable");
  return Object.freeze({
    entries,
    first: executableEntries.find((entry) => entry.slot === "first") ?? null,
    last: executableEntries.find((entry) => entry.slot === "last") ?? null,
    errors: Object.freeze([...errors])
  });
}

function directorAssetProjectionSignature(plan: DirectorAssetProjectionPlan): string {
  return JSON.stringify({
    first: plan.first === null
      ? null
      : [plan.first.binding.bindingId, plan.first.binding.assetId, plan.first.binding.purpose],
    last: plan.last === null
      ? null
      : [plan.last.binding.bindingId, plan.last.binding.assetId, plan.last.binding.purpose],
    errors: plan.errors
  });
}

function directorProjectForAssetProjection(): RelayProjectDocument | null {
  return directorWorkspace?.session.current ?? activeRelayProject;
}

function directorAssetPurposeOptions(
  project: RelayProjectDocument,
  mode: ProjectMode,
  shotId: string,
  mediaType: RelayMediaType
): readonly RelayAssetPurpose[] {
  if (mode === "T2V") {
    return Object.freeze([DIRECTOR_PROJECT_REFERENCE_PURPOSE_BY_MEDIA[mediaType]]);
  }
  if (mediaType !== "image") return Object.freeze([]);
  const shotIds = directorOrderedShotIds(project);
  if (mode === "REF2VA") {
    return shotIds.length === 1 && shotId === shotIds[0]
      ? DIRECTOR_IMAGE_REFERENCE_PURPOSES
      : Object.freeze([]);
  }
  return Object.freeze([
    ...(shotId === shotIds[0] ? ["first_frame" as const] : []),
    ...(shotId === shotIds.at(-1) ? ["last_frame" as const] : [])
  ]);
}

function defaultDirectorAssetPurpose(
  project: RelayProjectDocument,
  mode: ProjectMode,
  shotId: string,
  mediaType: RelayMediaType
): RelayAssetPurpose {
  if (mode === "T2V") {
    if (mediaType === "image") return "continuity_reference";
    return DIRECTOR_PROJECT_REFERENCE_PURPOSE_BY_MEDIA[mediaType];
  }
  if (mode === "REF2VA") return "subject_reference";
  if (mode === "FL2VA") {
    const shotIds = directorOrderedShotIds(project);
    if (shotId === shotIds[0]) return "first_frame";
    if (shotId === shotIds.at(-1)) return "last_frame";
  }
  return DIRECTOR_PROJECT_REFERENCE_PURPOSE_BY_MEDIA[mediaType];
}

function directorTransitionProjectionIssues(project: RelayProjectDocument): readonly string[] {
  const issues: string[] = [];
  for (const [index, transition] of compileDirectorTransitions(project).entries()) {
    const label = `镜头 ${index + 1} → ${index + 2}`;
    if (transition.disposition !== "compile"
      || (transition.type !== "hard_cut" && transition.type !== "tail_frame_continuation")) {
      issues.push(`${label} 的衔接方式“${transition.type}”目前仅记录创作意图，当前编译器不会执行；请改为硬切或尾帧延续。`);
    }
    if (transition.assetId !== null) {
      issues.push(`${label} 选择了衔接素材，但当前编译器不会消费该素材；请取消衔接素材后再编译。`);
    }
  }
  return Object.freeze(issues);
}

function captureDirectorSegmentTransitions(project: RelayProjectDocument): readonly SegmentTransition[] {
  const issues = directorTransitionProjectionIssues(project);
  if (issues.length > 0) throw new Error(issues.join("\n"));
  return Object.freeze(compileDirectorTransitions(project).map((transition) => {
    if (transition.type !== "hard_cut" && transition.type !== "tail_frame_continuation") {
      throw new Error(`衔接方式“${transition.type}”尚未获得当前编译器支持。`);
    }
    return transition.type;
  }));
}

function directorSegmentTransitionSnapshot(project: RelayProjectDocument): JsonValue {
  const issues = directorTransitionProjectionIssues(project);
  if (issues.length === 0) {
    return compileDirectorTransitions(project).map((transition) => transition.type as SegmentTransition);
  }
  return {
    blocked: [...issues],
    transitions: compileDirectorTransitions(project).map((transition) => ({
      type: transition.type,
      disposition: transition.disposition,
      assetId: transition.assetId
    }))
  };
}
const ASSET_TARGET_LABELS: Readonly<Record<RelayAssetBinding["targetKind"], string>> = Object.freeze({
  project: "项目",
  entity: "实体",
  scene: "场景",
  shot: "镜头"
});

interface AssetReferencePresentation {
  readonly key: string;
  readonly title: string;
  readonly detail: string;
}

interface AssetTechnicalFact {
  readonly label: string;
  readonly value: string;
}

function formatAssetBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MiB`;
  return `${(value / 1024 ** 3).toFixed(2)} GiB`;
}

function jsonObject(value: JsonValue | undefined): Readonly<Record<string, JsonValue>> | null {
  return value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, JsonValue>>
    : null;
}

function jsonString(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function jsonNumber(value: JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function jsonBoolean(value: JsonValue | undefined): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function formatAssetDuration(value: number): string {
  return `${value.toLocaleString("zh-CN", { maximumFractionDigits: 3 })} 秒`;
}

function formatAssetFrequency(value: number): string {
  return value >= 1000 && value % 1000 === 0
    ? `${value / 1000} kHz`
    : `${value.toLocaleString("zh-CN")} Hz`;
}

function assetInspectionFacts(inspection: JsonValue | null, mediaType: RelayMediaType): readonly AssetTechnicalFact[] {
  const source = jsonObject(inspection ?? undefined);
  if (source === null) return Object.freeze([]);
  const facts: AssetTechnicalFact[] = [];
  const status = jsonString(source.status);
  if (status !== null) facts.push({ label: "检查结果", value: ASSET_PREFLIGHT_STATUS_LABELS[status] ?? status });
  const mime = jsonString(source.detectedMime);
  if (mime !== null) facts.push({ label: "识别格式", value: mime });

  if (mediaType === "image") {
    const image = jsonObject(source.image);
    const width = jsonNumber(image?.width);
    const height = jsonNumber(image?.height);
    if (width !== null && height !== null) facts.push({ label: "像素尺寸", value: `${width} × ${height}` });
    const format = jsonString(image?.format);
    if (format !== null) facts.push({ label: "图像格式", value: format.toLocaleUpperCase("en-US") });
    const hasAlpha = jsonBoolean(image?.hasAlpha);
    if (hasAlpha !== null) facts.push({ label: "透明通道", value: hasAlpha ? "有" : "无" });
    const orientation = jsonNumber(image?.orientation);
    if (orientation !== null) facts.push({ label: "方向标记", value: orientation === 1 ? "1（正常）" : String(orientation) });
  } else if (mediaType === "video") {
    const video = jsonObject(source.video);
    const width = jsonNumber(video?.width);
    const height = jsonNumber(video?.height);
    if (width !== null && height !== null) facts.push({ label: "画面尺寸", value: `${width} × ${height}` });
    const duration = jsonNumber(video?.durationSeconds);
    if (duration !== null) facts.push({ label: "时长", value: formatAssetDuration(duration) });
    const frameRate = jsonNumber(video?.frameRate);
    if (frameRate !== null) facts.push({ label: "帧率", value: `${frameRate.toLocaleString("zh-CN", { maximumFractionDigits: 3 })} fps` });
    const codec = jsonString(video?.codec);
    if (codec !== null) facts.push({ label: "视频编码", value: codec });
    const pixelFormat = jsonString(video?.pixelFormat);
    if (pixelFormat !== null) facts.push({ label: "像素格式", value: pixelFormat });
    const audioTracks = jsonNumber(video?.audioTrackCount);
    if (audioTracks !== null) facts.push({ label: "音轨", value: `${audioTracks} 条` });
  } else {
    const audio = jsonObject(source.audio);
    const duration = jsonNumber(audio?.durationSeconds);
    if (duration !== null) facts.push({ label: "时长", value: formatAssetDuration(duration) });
    const codec = jsonString(audio?.codec);
    if (codec !== null) facts.push({ label: "音频编码", value: codec });
    const channels = jsonNumber(audio?.channels);
    if (channels !== null) facts.push({ label: "声道", value: `${channels} 声道` });
    const sampleRate = jsonNumber(audio?.sampleRate);
    if (sampleRate !== null) facts.push({ label: "采样率", value: formatAssetFrequency(sampleRate) });
  }
  const checkedAt = jsonString(source.checkedAt);
  if (checkedAt !== null) {
    const timestamp = new Date(checkedAt);
    facts.push({
      label: "检查时间",
      value: Number.isNaN(timestamp.getTime()) ? checkedAt : timestamp.toLocaleString("zh-CN", { hour12: false })
    });
  }
  return Object.freeze(facts);
}

function assetInspectionIssues(inspection: JsonValue | null): readonly string[] {
  const issues = jsonObject(inspection ?? undefined)?.issues;
  if (!Array.isArray(issues)) return Object.freeze([]);
  return Object.freeze(issues.flatMap((issue) => {
    const message = jsonString(jsonObject(issue)?.message);
    return message === null ? [] : [message];
  }));
}

function renderAssetTechnicalFacts(inspection: JsonValue | null, mediaType: RelayMediaType): void {
  assetDetailTechnical.replaceChildren();
  const facts = assetInspectionFacts(inspection, mediaType);
  const issues = assetInspectionIssues(inspection);
  if (facts.length === 0 && issues.length === 0) {
    assetDetailTechnical.textContent = "尚无技术预检信息";
    return;
  }
  const list = document.createElement("dl");
  list.className = "asset-technical-facts";
  for (const fact of facts) {
    const row = document.createElement("div");
    row.className = "asset-technical-fact";
    const label = document.createElement("dt");
    label.textContent = fact.label;
    const value = document.createElement("dd");
    value.textContent = fact.value;
    row.append(label, value);
    list.append(row);
  }
  if (issues.length > 0) {
    const row = document.createElement("div");
    row.className = "asset-technical-fact asset-technical-fact--issues";
    const label = document.createElement("dt");
    label.textContent = "需要处理";
    const value = document.createElement("dd");
    value.textContent = issues.join("；");
    row.append(label, value);
    list.append(row);
  }
  assetDetailTechnical.append(list);
}

function currentProjectBindings(assetId: string, projectView: ProjectAssetViewContract | null): readonly RelayAssetBinding[] {
  const merged = new Map<string, RelayAssetBinding>();
  for (const binding of projectView?.bindings ?? []) merged.set(binding.bindingId, binding);
  for (const binding of activeRelayProject?.bindings ?? []) {
    if (binding.assetId === assetId) merged.set(binding.bindingId, binding);
  }
  return Object.freeze([...merged.values()]);
}

function quickProjectAssetReferences(assetId: string): readonly AssetReferencePresentation[] {
  const project = activeRelayProject;
  if (project === null) return Object.freeze([]);
  const workflowLabel = project.quick.workflowName.trim() || project.name;
  const references: AssetReferencePresentation[] = [];
  if (project.quick.firstFrameAssetId === assetId) {
    references.push({
      key: "quick:first",
      title: "快速创建",
      detail: project.quick.mode === "T2V"
        ? `${workflowLabel} · 旧版首帧记录 · 项目资料关系 · 不进入当前 H3 工作流`
        : `${workflowLabel} · ${project.quick.mode === "REF2VA" ? "参考素材" : "首帧"} · 进入当前 H3 工作流`
    });
  }
  if (project.quick.lastFrameAssetId === assetId) {
    references.push({
      key: "quick:last",
      title: "快速创建",
      detail: project.quick.mode === "T2V"
        ? `${workflowLabel} · 旧版尾帧记录 · 项目资料关系 · 不进入当前 H3 工作流`
        : `${workflowLabel} · ${project.quick.mode === "REF2VA" ? "参考素材" : "尾帧"} · 进入当前 H3 工作流`
    });
  }
  project.quick.referenceAssetIds.forEach((referenceAssetId, index) => {
    if (referenceAssetId !== assetId) return;
    references.push({
      key: `quick:reference:${index}`,
      title: "快速创建",
      detail: `${workflowLabel} · 旧版参考素材 ${index + 1} · 项目资料关系 · 不进入当前 H3 工作流`
    });
  });
  return Object.freeze(references);
}

function projectAssetReferencePresentation(
  assetId: string,
  projectView: ProjectAssetViewContract | null
): readonly AssetReferencePresentation[] {
  const quick = quickProjectAssetReferences(assetId);
  const project = activeRelayProject;
  const mode = project?.editorMode === "professional"
    ? directorSelectedMode() as ProjectMode
    : project?.quick.mode ?? "T2V";
  const projection = project === null ? null : buildDirectorAssetProjectionPlan(project, mode);
  const bindings = currentProjectBindings(assetId, projectView).map((binding): AssetReferencePresentation => {
    const projected = binding.targetKind === "shot" ? projection?.entries.get(binding.bindingId) : undefined;
    const disposition = binding.targetKind !== "shot" || projected === undefined || projected.status === "record_only"
      ? "项目资料关系 · 不进入当前 H3 工作流"
      : projected.message;
    return {
      key: `binding:${binding.bindingId}`,
      title: `${ASSET_TARGET_LABELS[binding.targetKind]}${binding.targetKind === "shot" ? "绑定" : "资料关系"}`,
      detail: `${binding.targetId} · ${ASSET_PURPOSE_LABELS[binding.purpose]} · ${disposition}`
    };
  });
  return Object.freeze([...quick, ...bindings]);
}

function assetBusyLabel(snapshot: AssetLibrarySnapshot): string {
  if (snapshot.busyAction === "import") return "正在读取所选文件并计算 SHA-256…";
  if (snapshot.busyAction === "update") return "正在保存素材资料…";
  if (snapshot.busyAction === "refresh") return "正在重新检查本地文件…";
  if (snapshot.busyAction === "relocate") return "正在校验重新定位的文件…";
  if (snapshot.busyAction === "confirm_replacement") return "正在更新素材记录…";
  if (snapshot.busyAction === "copy") return "正在复制并校验项目素材…";
  if (snapshot.busyAction === "prepare_frame") return "正在准备参考图片…";
  if (snapshot.phase === "loading") return "正在读取本地素材记录…";
  return snapshot.errorMessage ?? `${snapshot.total} 项素材记录 · 仅保存在本机`;
}

function selectedAsset(): AssetRecord | null {
  return allAssetRecords.find((asset) => asset.assetId === selectedAssetId)
    ?? assetLibrarySnapshot.assets.find((asset) => asset.assetId === selectedAssetId)
    ?? null;
}

function closeAssetDetailDrawer(restoreFocus = true): void {
  if (assetDetailLayer.hidden) return;
  assetDetailLayer.hidden = true;
  setModalIsolation(assetDetailLayer, false);
  document.body.classList.remove("workspace-drawer-open");
  assetDetailDrawer.setAttribute("aria-hidden", "true");
  const target = assetDetailReturnFocus;
  assetDetailReturnFocus = null;
  if (restoreFocus && target?.isConnected === true) target.focus({ preventScroll: true });
}

function openAssetDetailDrawer(returnFocus: HTMLElement): void {
  if (!directorDrawerLayer.hidden) closeDirectorDrawer(false);
  assetDetailReturnFocus = returnFocus;
  assetDetailLayer.hidden = false;
  setModalIsolation(assetDetailLayer, true);
  document.body.classList.add("workspace-drawer-open");
  assetDetailDrawer.setAttribute("aria-hidden", "false");
  window.requestAnimationFrame(() => assetDetailClose.focus({ preventScroll: true }));
}

function renderAssetDetail(): void {
  const asset = selectedAsset();
  const projectView = projectAssetViews.find((entry) => entry.asset.assetId === selectedAssetId) ?? null;
  const hasAsset = asset !== null;
  assetDetail.hidden = !hasAsset;
  assetDetailEmpty.hidden = hasAsset;
  if (asset === null) return;
  const availability = projectView?.asset.availability;
  assetDetailState.textContent = availability === undefined
    ? ASSET_AVAILABILITY_LABELS[asset.availability]
    : PROJECT_ASSET_AVAILABILITY_LABELS[availability];
  assetDetailState.classList.toggle("status-badge--success", availability === "available" || asset.availability === "available");
  assetDetailState.classList.toggle("status-badge--warning", availability !== undefined ? availability !== "available" : asset.availability !== "available");
  assetDetailType.textContent = `${ASSET_TYPE_LABELS[asset.mediaType]} · ${asset.extension.toUpperCase()} · ${asset.sourceFileName}`;
  assetDetailSize.textContent = formatAssetBytes(asset.byteLength);
  assetDetailHash.textContent = asset.sha256;
  assetDetailStorage.textContent = asset.storageMode === "project_copy" ? "项目副本" : "引用原文件";
  assetDisplayName.value = asset.displayName;
  assetTags.value = asset.tags.join(", ");
  assetNote.value = asset.note;
  assetDetailPath.textContent = asset.projectRelativePath === null
    ? "引用原文件；未复制到项目素材目录。"
    : `项目相对引用：${asset.projectRelativePath}`;
  assetCopyProjectButton.disabled = asset.availability !== "available" || asset.storageMode === "project_copy";
  assetCopyProjectButton.hidden = asset.storageMode === "project_copy";
  assetCopyProjectButton.textContent = "复制到项目";
  assetDetailPreviewName.textContent = asset.displayName;
  assetDetailThumbnail.hidden = true;
  assetDetailThumbnail.removeAttribute("src");
  assetDetailPreviewFallback.hidden = false;
  assetDetailPreviewFallback.textContent = asset.mediaType === "image" ? "图片" : asset.mediaType === "video" ? "视频" : "音频";
  const previewFacts = assetInspectionFacts(projectView?.asset.inspection ?? null, asset.mediaType);
  const previewTechnical = previewFacts
    .filter((fact) => fact.label === "像素尺寸" || fact.label === "画面尺寸" || fact.label === "时长" || fact.label === "采样率")
    .slice(0, 2)
    .map((fact) => fact.value);
  assetDetailPreviewMeta.textContent = [ASSET_TYPE_LABELS[asset.mediaType], ...previewTechnical, formatAssetBytes(asset.byteLength)].join(" · ");
  const inspection = projectView?.asset.inspection;
  renderAssetTechnicalFacts(inspection ?? null, asset.mediaType);
  const references = projectAssetReferencePresentation(asset.assetId, projectView);
  assetDetailUsageCount.textContent = String(references.length);
  assetBindingCount.textContent = `${references.length} 处`;
  assetBindingList.replaceChildren();
  if (references.length === 0) {
    const empty = document.createElement("p");
    empty.id = "asset-binding-empty";
    empty.textContent = "当前项目尚未引用此素材。";
    assetBindingList.append(empty);
  } else {
    for (const reference of references) {
      const row = document.createElement("p");
      row.className = "asset-binding-entry";
      row.dataset.referenceKey = reference.key;
      const title = document.createElement("strong");
      title.textContent = reference.title;
      const detail = document.createElement("small");
      detail.textContent = reference.detail;
      row.append(title, detail);
      assetBindingList.append(row);
    }
  }
}

function renderAssetPreviewResult(
  context: ProjectOperationContext,
  requestGeneration: number,
  assetId: string,
  target: HTMLElement,
  result: Awaited<ReturnType<typeof window.controlPlane.getProjectAssetPreview>>
): void {
  if (!target.isConnected
    || !isCurrentProjectOperation(context)
    || target.dataset.previewProjectId !== context.projectId
    || target.dataset.previewAssetId !== assetId
    || target.dataset.previewActivationEpoch !== String(context.activationEpoch)
    || target.dataset.previewRequestGeneration !== String(requestGeneration)) return;
  target.replaceChildren();
  if (result.status === "ready" && result.dataUrl !== null) {
    const image = document.createElement("img");
    image.src = result.dataUrl;
    image.alt = "";
    image.decoding = "async";
    target.append(image);
    target.dataset.previewState = "ready";
  } else if (result.kind === "audio_icon") {
    target.dataset.previewState = "ready";
    target.textContent = "音频";
  } else {
    target.dataset.previewState = result.status === "failed" ? "failed" : "unavailable";
    target.title = result.message ?? "当前素材没有可用预览。";
  }
  if (selectedAssetId !== assetId) return;
  if (result.status === "ready" && result.dataUrl !== null) {
    assetDetailThumbnail.src = result.dataUrl;
    assetDetailThumbnail.hidden = false;
    assetDetailPreviewFallback.hidden = true;
  } else {
    assetDetailThumbnail.hidden = true;
    assetDetailThumbnail.removeAttribute("src");
    assetDetailPreviewFallback.hidden = false;
    assetDetailPreviewFallback.textContent = result.kind === "audio_icon"
      ? "音频素材"
      : result.message ?? "预览不可用";
  }
}

function requestAssetPreview(assetId: string, target: HTMLElement): void {
  if (activeRelayProject === null) return;
  const context = captureProjectOperationContext();
  const requestGeneration = ++assetPreviewRequestGeneration;
  target.replaceChildren();
  target.dataset.previewState = "loading";
  target.dataset.previewProjectId = context.projectId;
  target.dataset.previewAssetId = assetId;
  target.dataset.previewActivationEpoch = String(context.activationEpoch);
  target.dataset.previewRequestGeneration = String(requestGeneration);
  const isCurrentRequest = (): boolean => (
    target.isConnected
    && isCurrentProjectOperation(context)
    && target.dataset.previewProjectId === context.projectId
    && target.dataset.previewAssetId === assetId
    && target.dataset.previewActivationEpoch === String(context.activationEpoch)
    && target.dataset.previewRequestGeneration === String(requestGeneration)
  );
  void window.controlPlane.getProjectAssetPreview({
    projectId: context.projectId,
    assetId
  }).then((result) => renderAssetPreviewResult(context, requestGeneration, assetId, target, result)).catch((error: unknown) => {
    if (!isCurrentRequest()) return;
    target.replaceChildren();
    target.dataset.previewState = "failed";
    target.title = publicError(error);
    if (selectedAssetId === assetId) {
      assetDetailPreviewFallback.hidden = false;
      assetDetailPreviewFallback.textContent = "预览准备失败";
    }
  });
}

function requestDirectorAssetPreview(
  projectId: string,
  assetId: string,
  displayName: string,
  target: HTMLElement
): void {
  const activationEpoch = activeProjectActivationEpoch;
  const requestGeneration = ++assetPreviewRequestGeneration;
  target.replaceChildren();
  target.dataset.previewState = "loading";
  target.dataset.previewProjectId = projectId;
  target.dataset.previewAssetId = assetId;
  target.dataset.previewActivationEpoch = String(activationEpoch);
  target.dataset.previewRequestGeneration = String(requestGeneration);
  target.setAttribute("role", "img");
  target.setAttribute("aria-label", `正在准备 ${displayName} 的预览`);
  const isCurrentRequest = (): boolean => (
    target.isConnected
    && target.dataset.previewProjectId === projectId
    && target.dataset.previewAssetId === assetId
    && target.dataset.previewActivationEpoch === String(activationEpoch)
    && target.dataset.previewRequestGeneration === String(requestGeneration)
    && activeProjectActivationEpoch === activationEpoch
    && directorProjectForAssetProjection()?.projectId === projectId
  );
  void window.controlPlane.getProjectAssetPreview({ projectId, assetId }).then((result) => {
    if (!isCurrentRequest()) return;
    target.replaceChildren();
    if (result.status === "ready" && result.dataUrl !== null) {
      const image = document.createElement("img");
      image.src = result.dataUrl;
      image.alt = "";
      image.decoding = "async";
      target.append(image);
      target.dataset.previewState = "ready";
      target.setAttribute("aria-label", `${displayName} 的本地缩略图`);
      return;
    }
    if (result.kind === "audio_icon") {
      target.dataset.previewState = "ready";
      target.textContent = "音频";
      target.setAttribute("aria-label", `${displayName} 是音频素材`);
      return;
    }
    target.dataset.previewState = result.status === "failed" ? "failed" : "unavailable";
    target.title = result.message ?? "当前素材没有可用预览。";
    target.setAttribute("aria-label", `${displayName}：${result.message ?? "当前没有可用预览"}`);
  }).catch((error: unknown) => {
    if (!isCurrentRequest()) return;
    target.replaceChildren();
    target.dataset.previewState = "failed";
    target.title = publicError(error);
    target.setAttribute("aria-label", `${displayName}：预览准备失败`);
  });
}

function sortedAssetRecords(records: readonly AssetRecord[]): readonly AssetRecord[] {
  const next = [...records];
  if (assetSort.value === "name") next.sort((left, right) => left.displayName.localeCompare(right.displayName, "zh-CN"));
  else if (assetSort.value === "type") next.sort((left, right) => left.mediaType.localeCompare(right.mediaType) || left.displayName.localeCompare(right.displayName, "zh-CN"));
  else next.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return Object.freeze(next);
}

function renderAssetLibrary(snapshot: AssetLibrarySnapshot): void {
  assetLibrarySnapshot = snapshot;
  const busy = snapshot.busyAction !== null || snapshot.phase === "loading";
  assetLibraryToolbar.hidden = snapshot.total === 0;
  assetLibraryStatus.textContent = assetBusyLabel(snapshot);
  assetLibraryStatus.classList.toggle("is-error", snapshot.phase === "error");
  assetLibraryStatus.classList.toggle("is-idle", !busy && snapshot.phase !== "error");
  assetImportButton.disabled = busy;
  assetRefreshButton.disabled = busy;
  assetSaveMetadata.disabled = busy;
  assetRelocateButton.disabled = busy || selectedAssetId === null;
  assetListCount.textContent = `${snapshot.total} 项`;
  assetList.dataset.layout = assetViewMode;
  assetList.replaceChildren();
  for (const asset of sortedAssetRecords(snapshot.assets)) {
    const item = document.createElement("article");
    item.className = "asset-list-item";
    item.dataset.assetId = asset.assetId;
    item.setAttribute("role", "listitem");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "asset-list-button";
    button.setAttribute("aria-pressed", String(asset.assetId === selectedAssetId));
    const mark = document.createElement("span");
    mark.className = `asset-thumbnail asset-type-mark--${asset.mediaType}`;
    mark.dataset.previewState = "loading";
    const copy = document.createElement("span");
    copy.className = "asset-list-copy";
    const name = document.createElement("strong");
    name.textContent = asset.displayName;
    const meta = document.createElement("small");
    const projectView = projectAssetViews.find((entry) => entry.asset.assetId === asset.assetId) ?? null;
    const usageCount = projectAssetReferencePresentation(asset.assetId, projectView).length;
    meta.textContent = `${ASSET_TYPE_LABELS[asset.mediaType]} · ${usageCount} 处引用`;
    copy.append(name, meta);
    const state = document.createElement("span");
    state.className = "asset-state";
    state.dataset.state = asset.availability;
    state.textContent = ASSET_AVAILABILITY_LABELS[asset.availability];
    button.append(mark, copy, state);
    requestAssetPreview(asset.assetId, mark);
    button.addEventListener("click", () => {
      selectedAssetId = asset.assetId;
      for (const candidate of assetList.querySelectorAll<HTMLButtonElement>(".asset-list-button")) {
        const selected = candidate.closest<HTMLElement>("[data-asset-id]")?.dataset.assetId === asset.assetId;
        candidate.setAttribute("aria-pressed", String(selected));
      }
      renderAssetDetail();
      requestAssetPreview(asset.assetId, mark);
      openAssetDetailDrawer(button);
    });
    item.append(button);
    assetList.append(item);
  }
  assetEmpty.hidden = snapshot.assets.length > 0;
  if (selectedAssetId !== null && !snapshot.assets.some((asset) => asset.assetId === selectedAssetId)) {
    selectedAssetId = null;
  }
  renderAssetDetail();
}

function synchronizeDirectorAssetCatalog(records: readonly AssetRecord[]): void {
  allAssetRecords = Object.freeze([...records]);
  let next = directorProductionState;
  for (const asset of records) {
    next = upsertProductionAssetReference(next, {
      id: asset.assetId,
      identityKey: asset.assetId,
      sourceAssetId: asset.assetId,
      name: asset.displayName,
      mediaType: asset.mediaType,
      projectRelativePath: asset.projectRelativePath ?? "",
      storageMode: asset.storageMode === "project_copy" ? "copy" : "reference",
      sha256: asset.sha256,
      sizeBytes: asset.byteLength,
      tags: asset.tags,
      notes: asset.note,
      missing: asset.availability !== "available"
    });
  }
  directorProductionState = next;
  directorP1Ui.setState(next);
  directorP1Ui.setAssetOptions(records.map((asset) => Object.freeze({
    assetId: asset.assetId,
    displayName: asset.displayName,
    mediaType: asset.mediaType,
    availability: asset.availability === "available" ? "available" as const : "missing" as const
  })));
  renderDirectorShotAssetBindings();
  renderAssetDetail();
}

async function refreshDirectorAssetCatalog(
  requestedContext?: ProjectOperationContext
): Promise<boolean> {
  if (activeRelayProject === null) {
    directorAssetCatalogRequestGeneration += 1;
    synchronizeDirectorAssetCatalog(Object.freeze([]));
    return true;
  }
  const context = requestedContext ?? captureProjectOperationContext();
  if (!isCurrentProjectOperation(context)) return false;
  const requestGeneration = ++directorAssetCatalogRequestGeneration;
  const listed = await window.controlPlane.listProjectAssets({
    projectId: context.projectId,
    query: "",
    mediaType: "all",
    availability: "all",
    tags: Object.freeze([])
  });
  if (requestGeneration !== directorAssetCatalogRequestGeneration || !isCurrentProjectOperation(context)) {
    return false;
  }
  projectAssetViews = listed;
  synchronizeDirectorAssetCatalog(listed.map((entry) => projectAssetAsLegacyRecord(entry.asset)));
  return true;
}

async function ensureAssetLibraryLoaded(): Promise<void> {
  if (activeRelayProject === null) {
    assetCurrentProject.textContent = "未选择项目";
    return;
  }
  const context = captureProjectOperationContext();
  const projectName = activeRelayProject.name;
  assetCurrentProject.textContent = projectName;
  if (assetLibraryController.getSnapshot().phase === "idle") await assetLibraryController.load();
  else await assetLibraryController.setQuery(assetSearchInput.value);
  if (!isCurrentProjectOperation(context)) return;
  await refreshDirectorAssetCatalog(context);
}

function directorProjectPlan(project: RelayProjectDocument): readonly DirectorShot[] {
  let startSeconds = 0;
  return Object.freeze(orderedDirectorShots(project).map(({ shot }) => {
    const entry: DirectorShot = Object.freeze({
      id: shot.shotId,
      startSeconds,
      durationSeconds: shot.durationSeconds,
      description: shot.prompt,
      cameraLanguage: shot.camera,
      soundCue: shot.sound,
      transitionNote: shot.transitionFromPrevious?.customIntent ?? ""
    });
    startSeconds += shot.durationSeconds;
    return entry;
  }));
}

function continuityInputKey(phase: DirectorStatePhase, field: RelayContinuityField): string {
  return `${phase}:${field}`;
}

function initializeDirectorContinuityInputs(): void {
  if (directorContinuityInputs.size > 0) return;
  for (const [phase, fieldset] of [["start", directorShotStartState], ["end", directorShotEndState]] as const) {
    for (const child of [...fieldset.children]) {
      if (child instanceof HTMLLabelElement) child.hidden = true;
    }
    for (const field of RELAY_CONTINUITY_FIELDS) {
      const wrapper = document.createElement("label");
      wrapper.className = "field director-continuity-field";
      const caption = document.createElement("span");
      caption.className = "field-label";
      caption.textContent = DIRECTOR_CONTINUITY_LABELS[field];
      const input = document.createElement("textarea");
      input.id = `director-shot-${phase}-state-${field}`;
      input.rows = 2;
      input.placeholder = "可留空";
      input.dataset.directorStatePhase = phase;
      input.dataset.directorStateField = field;
      input.addEventListener("change", () => {
        const shot = directorWorkspace === null ? null : activeDirectorWorkspaceShot(directorWorkspace);
        if (shot === null) return;
        try {
          applyDirectorWorkspaceMutation(
            `修改${phase === "start" ? "开始" : "结束"}状态：${DIRECTOR_CONTINUITY_LABELS[field]}`,
            (project) => setDirectorStateOverride(project, {
              shotId: shot.shotId,
              phase,
              field,
              value: input.value,
              updatedAt: new Date().toISOString()
            })
          );
        } catch (error) {
          renderDirectorWorkspaceControls();
          showFeedback({ kind: "error", title: "镜头状态未保存", message: publicError(error) });
        }
      });
      wrapper.append(caption, input);
      fieldset.append(wrapper);
      directorContinuityInputs.set(continuityInputKey(phase, field), input);
    }
  }
}

function updateDirectorWorkspaceSaveIndicator(): void {
  if (directorWorkspace === null) {
    directorAutosaveState.textContent = "自动保存待机";
    return;
  }
  const state = projectWorkspaceSaveIndicator(directorWorkspace);
  directorAutosaveState.textContent = state === "saving"
    ? "正在保存…"
    : state === "failed"
      ? `保存失败${directorWorkspace.session.autosave.lastError === null ? "" : ` · ${directorWorkspace.session.autosave.lastError}`}`
      : state === "unsaved"
        ? "等待自动保存"
        : directorWorkspace.session.autosave.lastSavedAt === null
          ? "已载入保存内容"
          : `已保存 · ${new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(new Date(directorWorkspace.session.autosave.lastSavedAt))}`;
}

function scheduleDirectorWorkspaceAutosave(): void {
  updateDirectorWorkspaceSaveIndicator();
  if (directorWorkspaceSaveTimer !== null) window.clearTimeout(directorWorkspaceSaveTimer);
  directorWorkspaceSaveTimer = window.setTimeout(() => {
    directorWorkspaceSaveTimer = null;
    void runDirectorWorkspaceAutosave();
  }, 500);
}

function synchronizeWorkspaceProfessionalMetadata(
  controller: ProjectWorkspaceController,
  source: RelayProjectDocument | null
): ProjectWorkspaceController {
  if (source === null || source.projectId !== controller.session.current.projectId) return controller;
  return Object.freeze({
    ...controller,
    session: Object.freeze({
      ...controller.session,
      current: Object.freeze({
        ...controller.session.current,
        professional: Object.freeze({
          ...controller.session.current.professional,
          directorState: source.professional.directorState
        })
      })
    })
  });
}

function projectWithReconciledDirectorActiveShot(
  project: RelayProjectDocument,
  activeShotId: string | null
): RelayProjectDocument {
  const location = activeShotId === null
    ? null
    : orderedDirectorShots(project).find(({ shot }) => shot.shotId === activeShotId) ?? null;
  if (activeShotId !== null && location === null) {
    throw new Error("对账后的当前镜头不属于当前项目；Relay 已停止恢复以保护项目数据。");
  }
  const activeSceneId = location?.scene.sceneId ?? null;
  if (project.professional.activeShotId === activeShotId
    && project.professional.activeSceneId === activeSceneId) return project;
  return Object.freeze({
    ...project,
    professional: Object.freeze({
      ...project.professional,
      activeSceneId,
      activeShotId
    })
  });
}

async function runDirectorWorkspaceAutosave(): Promise<void> {
  if (directorWorkspaceSaveInFlight !== null || directorWorkspace === null) return;
  const context: ProjectOperationContext = Object.freeze({
    projectId: directorWorkspace.session.current.projectId,
    activationEpoch: activeProjectActivationEpoch
  });
  if (!isCurrentProjectOperation(context)) return;
  const nowMs = Date.now();
  const [claimed, request] = claimProjectWorkspaceAutosave(directorWorkspace, nowMs);
  directorWorkspace = claimed;
  updateDirectorWorkspaceSaveIndicator();
  if (request === null) {
    if (projectWorkspaceSaveIndicator(claimed) === "unsaved") scheduleDirectorWorkspaceAutosave();
    return;
  }
  const operation = (async () => {
    try {
      // Persist exactly the immutable payload that the state engine claimed.
      // A later edit receives its own revision and follow-up atomic save.
      const projectToSave = JSON.parse(request.payload) as RelayProjectDocument;
      const saved = await persistRelayProject(projectToSave);
      if (isCurrentProjectOperation(context)
        && directorWorkspace?.session.current.projectId === context.projectId) {
        const editedAfterClaim = directorWorkspace.session.currentRevision !== request.projectRevision;
        directorWorkspace = completeProjectWorkspaceAutosave(directorWorkspace, {
          request,
          succeeded: true,
          completedAt: saved.updatedAt
        });
        if (editedAfterClaim) activeRelayProject = directorWorkspace.session.current;
      }
    } catch (error) {
      if (!isCurrentProjectOperation(context)) return;
      if (directorWorkspace?.session.current.projectId === context.projectId) {
        directorWorkspace = completeProjectWorkspaceAutosave(directorWorkspace, {
          request,
          succeeded: false,
          completedAt: new Date().toISOString(),
          error: publicError(error)
        });
      }
      showFeedback({ kind: "error", title: "专业导播自动保存失败", message: publicError(error) });
    } finally {
      directorWorkspaceSaveInFlight = null;
      if (isCurrentProjectOperation(context)) {
        updateDirectorWorkspaceSaveIndicator();
        if (directorWorkspace?.session.current.projectId === context.projectId
          && projectWorkspaceSaveIndicator(directorWorkspace) === "unsaved") {
          scheduleDirectorWorkspaceAutosave();
        }
      }
    }
  })();
  directorWorkspaceSaveInFlight = operation;
  await operation;
}

function applyDirectorWorkspaceMutation(
  label: string,
  update: (project: RelayProjectDocument) => RelayProjectDocument,
  options: {
    readonly rerenderTimeline?: boolean;
    readonly rerenderControls?: boolean;
    readonly autosave?: boolean;
  } = {}
): void {
  if (directorWorkspace === null) throw new Error("专业导播项目尚未载入。");
  const workspaceProject = directorWorkspace.session.current;
  const baseProject: RelayProjectDocument = activeRelayProject?.projectId === workspaceProject.projectId
    ? {
        ...workspaceProject,
        professional: {
          ...workspaceProject.professional,
          directorState: activeRelayProject.professional.directorState
        }
      }
    : workspaceProject;
  const nextProject = update(baseProject);
  directorWorkspace = applyProjectWorkspaceEdit(directorWorkspace, {
    label,
    nextProject,
    createdAtMs: Date.now()
  });
  activeRelayProject = directorWorkspace.session.current;
  directorActiveShotId = activeRelayProject.professional.activeShotId;
  if (options.rerenderTimeline === true) {
    renderDirectorShots(directorProjectPlan(activeRelayProject));
    syncDirectorProductionWorkCopy();
    directorP1Ui.setActiveShot(activeRelayProject.professional.activeShotId);
  }
  if (options.rerenderControls !== false) renderDirectorWorkspaceControls();
  else updateDirectorWorkspaceSaveIndicator();
  updateDirectorPreview();
  if (options.autosave !== false) scheduleDirectorWorkspaceAutosave();
}

function directorTransitionFieldsFromControls(): readonly RelayContinuityField[] {
  return Object.freeze([
    ...(directorTransitionInheritSubject.checked ? DIRECTOR_TRANSITION_SUBJECT_FIELDS : []),
    ...(directorTransitionInheritEnvironment.checked ? DIRECTOR_TRANSITION_ENVIRONMENT_FIELDS : []),
    ...(directorTransitionInheritAudio.checked ? DIRECTOR_TRANSITION_AUDIO_FIELDS : [])
  ]);
}

function nextDirectorShot(project: RelayProjectDocument, shotId: string): RelayProjectShot | null {
  const ordered = orderedDirectorShots(project).map((entry) => entry.shot);
  const index = ordered.findIndex((shot) => shot.shotId === shotId);
  return index < 0 ? null : ordered[index + 1] ?? null;
}

function authoritativeDirectorShotId(): string | null {
  if (directorWorkspace !== null) return directorWorkspace.session.current.professional.activeShotId;
  return activeRelayProject?.professional.activeShotId ?? directorActiveShotId;
}

function activeDirectorWorkspaceShot(workspace: ProjectWorkspaceController): RelayProjectShot | null {
  const activeShotId = workspace.session.current.professional.activeShotId;
  if (activeShotId === null) return null;
  return workspace.session.current.shots.find((shot) => shot.shotId === activeShotId && !shot.archived) ?? null;
}

function renderDirectorWorkspaceControls(): void {
  initializeDirectorContinuityInputs();
  const workspace = directorWorkspace;
  const shot = workspace === null ? null : activeDirectorWorkspaceShot(workspace);
  const project = workspace?.session.current ?? null;
  const undoRedo = workspace === null ? { canUndo: false, canRedo: false } : projectWorkspaceUndoRedo(workspace);
  directorUndoButton.disabled = !undoRedo.canUndo;
  directorRedoButton.disabled = !undoRedo.canRedo;
  directorCurrentShotDuration.disabled = shot === null;
  directorShotRestoreInheritance.disabled = shot === null;
  directorShotLockState.disabled = shot === null;
  directorShotBindAsset.disabled = shot === null;
  if (shot === null || project === null) {
    directorCurrentShotHeading.textContent = "尚未选择镜头";
    directorCurrentShotTime.textContent = "—";
    directorCurrentShotAssets.textContent = "0 项";
    directorCurrentShotContinuity.textContent = "未检查";
    directorCurrentShotTransition.textContent = "未设置";
    directorWorkspaceTotalDuration.textContent = "0 秒";
    directorShotStartSource.textContent = "无继承来源";
    directorShotStateCount.textContent = "0";
    for (const input of directorContinuityInputs.values()) {
      input.value = "";
      input.disabled = true;
    }
    renderDirectorShotAssetBindings();
    updateDirectorWorkspaceSaveIndicator();
    return;
  }
  const ordered = orderedDirectorShots(project);
  const index = ordered.findIndex((entry) => entry.shot.shotId === shot.shotId);
  directorCurrentShotHeading.textContent = `${ordered[index]?.scene.name ?? "场景"} · ${shot.name}`;
  const startSeconds = ordered.slice(0, Math.max(0, index)).reduce((total, entry) => total + entry.shot.durationSeconds, 0);
  directorCurrentShotTime.textContent = `${directorClock(startSeconds)} · ${shot.durationSeconds} 秒`;
  const mode = directorSelectedMode();
  const projection = buildDirectorAssetProjectionPlan(project, mode);
  const boundAssetCount = mode === "T2V"
    ? 0
    : directorAssetBindingsForContext(project, mode, shot.shotId).filter((binding) => (
        binding.targetKind === "shot" && projection.entries.get(binding.bindingId)?.status === "executable"
      )).length;
  directorCurrentShotAssets.textContent = `${boundAssetCount} 项`;
  const shotIssues = validateDirectorContinuity(project).filter((issue) => issue.shotId === shot.shotId).length;
  directorCurrentShotContinuity.textContent = shotIssues === 0 ? "检查通过" : `${shotIssues} 项待处理`;
  directorCurrentShotDuration.value = String(shot.durationSeconds);
  directorWorkspaceTotalDuration.textContent = `${ordered.reduce((total, entry) => total + entry.shot.durationSeconds, 0)} 秒`;
  const resolved = resolveDirectorShotStates(project).find((entry) => entry.shotId === shot.shotId);
  const previous = index > 0 ? ordered[index - 1]?.shot ?? null : null;
  directorShotStartSource.textContent = previous === null ? "首个镜头使用项目固定设定" : `机械继承自 ${previous.name} 的结束状态`;
  let explicitCount = 0;
  let lockedCount = 0;
  for (const phase of ["start", "end"] as const) {
    const layer = phase === "start" ? shot.startState : shot.endState;
    for (const field of RELAY_CONTINUITY_FIELDS) {
      const input = directorContinuityInputs.get(continuityInputKey(phase, field));
      const fieldState = resolved?.[phase][field];
      if (input === undefined || fieldState === undefined) continue;
      input.value = fieldState.value;
      input.disabled = fieldState.locked;
      input.dataset.inherited = String(fieldState.inherited);
      input.dataset.locked = String(fieldState.locked);
      input.title = fieldState.inherited
        ? `继承来源：${fieldState.source}${fieldState.sourceShotId === null ? "" : ` · ${fieldState.sourceShotId}`}`
        : "本镜头显式覆盖";
      if (layer[field] !== undefined) explicitCount += 1;
      if (fieldState.locked) lockedCount += 1;
    }
  }
  directorShotStateCount.textContent = `${explicitCount} 项覆盖`;
  const allLocked = lockedCount === RELAY_CONTINUITY_FIELDS.length * 2;
  directorShotLockState.setAttribute("aria-pressed", String(allLocked));
  directorShotLockState.textContent = allLocked ? "解锁当前状态" : "锁定当前状态";

  const following = nextDirectorShot(project, shot.shotId);
  const transition = following?.transitionFromPrevious ?? null;
  const hasFollowing = following !== null;
  directorShotTransitionKind.disabled = !hasFollowing;
  // Certified hard-cut/tail-continuation graphs do not accept an arbitrary
  // transition asset.  Keep the selector actionable only to let an older
  // project clear a preserved record; never offer a new fake graph input.
  const hasLegacyTransitionAsset = hasFollowing && transition?.assetId != null;
  directorShotTransitionAsset.disabled = !hasLegacyTransitionAsset;
  directorTransitionInheritSubject.disabled = !hasFollowing;
  directorTransitionInheritEnvironment.disabled = !hasFollowing;
  directorTransitionInheritAudio.disabled = !hasFollowing;
  directorShotTransitionKind.value = transition?.type === "hard_cut" ? "hard_cut" : "tail_continuation";
  const inherited = new Set(transition?.inheritedFields ?? []);
  directorTransitionInheritSubject.checked = DIRECTOR_TRANSITION_SUBJECT_FIELDS.every((field) => inherited.has(field));
  directorTransitionInheritEnvironment.checked = DIRECTOR_TRANSITION_ENVIRONMENT_FIELDS.every((field) => inherited.has(field));
  directorTransitionInheritAudio.checked = DIRECTOR_TRANSITION_AUDIO_FIELDS.every((field) => inherited.has(field));
  directorShotTransitionAsset.replaceChildren(new Option("不使用额外衔接素材（认证工作流）", ""));
  if (hasLegacyTransitionAsset) {
    const legacyAsset = project.assets.find((candidate) => candidate.assetId === transition.assetId);
    directorShotTransitionAsset.add(new Option(
      `${legacyAsset?.displayName ?? "找不到的旧版素材"} · 仅保留记录，请清除`,
      transition.assetId
    ));
    directorShotTransitionAsset.value = transition.assetId;
  } else {
    directorShotTransitionAsset.value = "";
  }
  directorShotTransitionState.textContent = following === null
    ? "无下一镜头"
    : transition?.type === "hard_cut"
      ? "硬切 · 已认证"
      : "尾帧延续 · 已认证";
  directorCurrentShotTransition.textContent = directorShotTransitionState.textContent;
  renderDirectorShotAssetBindings();
  updateDirectorWorkspaceSaveIndicator();
}

function initializeDirectorWorkspace(project: RelayProjectDocument): void {
  directorWorkspace = createProjectWorkspaceController(project, {
    viewportWidth: window.innerWidth,
    autosaveDelayMs: 450,
    initiallyPersisted: true
  });
  directorActiveShotId = project.professional.activeShotId;
  renderDirectorShots(directorProjectPlan(project));
  syncDirectorProductionWorkCopy();
  directorP1Ui.setActiveShot(project.professional.activeShotId);
  renderDirectorWorkspaceControls();
}

async function ensureDirectorWorkspaceLoaded(): Promise<void> {
  if (activeRelayProject === null) return;
  const context = captureProjectOperationContext();
  const requestGeneration = ++directorWorkspaceLoadGeneration;
  if (directorWorkspace?.session.current === activeRelayProject) {
    renderDirectorWorkspaceControls();
    return;
  }
  let project = activeRelayProject;
  const needsPromotion = project.editorMode !== "professional" || orderedDirectorShots(project).length === 0;
  if (needsPromotion) {
    project = promoteQuickProjectToProfessional({ project, updatedAt: new Date().toISOString() });
  }
  const selectedSegment = Number(directorSegmentDuration.value);
  if (selectedSegment !== 5 && selectedSegment !== 10 && selectedSegment !== 15) {
    throw new RangeError("统一分段时长必须是 5、10 或 15 秒。");
  }
  const materialized = materializeDirectorSegmentPlan(project, {
    mode: directorSelectedMode(),
    totalDurationSeconds: Number(directorTotalDuration.value),
    segmentDurationSeconds: selectedSegment,
    updatedAt: new Date().toISOString(),
    seedShots: currentDirectorShots()
  });
  if (needsPromotion || materialized !== project) {
    project = await persistRelayProject(materialized);
    if (requestGeneration !== directorWorkspaceLoadGeneration || !isCurrentProjectOperation(context)) return;
    activeRelayProject = project;
  } else {
    project = materialized;
  }
  if (requestGeneration !== directorWorkspaceLoadGeneration || !isCurrentProjectOperation(context)) return;
  if (!await refreshDirectorAssetCatalog(context)) return;
  if (requestGeneration !== directorWorkspaceLoadGeneration || !isCurrentProjectOperation(context)) return;
  initializeDirectorWorkspace(project);
}

function directorAssetBindingsForContext(
  project: RelayProjectDocument,
  mode: ProjectMode,
  shotId: string
): readonly RelayAssetBinding[] {
  if (mode === "T2V") return Object.freeze([]);
  return Object.freeze(project.bindings.filter((binding) => (
    binding.targetKind === "shot" && binding.targetId === shotId
  )));
}

function directorProjectDataRelationsForProject(
  project: RelayProjectDocument,
  mode: ProjectMode
): readonly { readonly binding: RelayAssetBinding; readonly legacyShotRecord: boolean }[] {
  return Object.freeze(project.bindings.flatMap((binding) => {
    if (binding.targetKind === "project" && binding.targetId === project.projectId) {
      return [{ binding, legacyShotRecord: false }];
    }
    if (mode === "T2V" && binding.targetKind === "shot") {
      return [{ binding, legacyShotRecord: true }];
    }
    return [];
  }));
}

function renderDirectorProjectDataBindings(): void {
  directorProjectDataBindings.replaceChildren();
  const project = directorProjectForAssetProjection();
  const mode = directorSelectedMode();
  directorProjectDataRelations.hidden = false;
  if (project === null) {
    directorProjectDataBindAsset.disabled = true;
    const empty = document.createElement("p");
    empty.className = "director-p1-empty";
    empty.textContent = "打开项目后即可管理项目资料素材。";
    directorProjectDataBindings.append(empty);
    return;
  }
  directorProjectDataBindAsset.disabled = false;
  const relations = directorProjectDataRelationsForProject(project, mode);
  const list = document.createElement("div");
  list.className = "director-shot-asset-list director-project-data-list";
  for (const relation of relations) {
    const { binding, legacyShotRecord } = relation;
    const asset = project.assets.find((candidate) => candidate.assetId === binding.assetId);
    const row = document.createElement("div");
    row.className = "director-shot-asset-row";
    row.dataset.projectionStatus = "record_only";
    row.dataset.relationScope = legacyShotRecord ? "legacy-shot" : "project";
    const thumbnail = document.createElement("span");
    thumbnail.className = `director-shot-asset-thumbnail asset-type-mark--${asset?.mediaType ?? "image"}`;
    if (asset === undefined) {
      thumbnail.dataset.previewState = "unavailable";
      thumbnail.setAttribute("role", "img");
      thumbnail.setAttribute("aria-label", "素材记录不可用，无法显示预览");
    } else {
      requestDirectorAssetPreview(project.projectId, asset.assetId, asset.displayName, thumbnail);
    }
    const copy = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = asset?.displayName ?? "素材记录不可用";
    const meta = document.createElement("small");
    meta.textContent = legacyShotRecord
      ? `${ASSET_PURPOSE_LABELS[binding.purpose]} · 旧版镜头记录迁移展示 · 不计入镜头素材或 T2V 编译`
      : `${ASSET_PURPOSE_LABELS[binding.purpose]} · 项目资料关系 · 不进入当前 H3 工作流`;
    copy.append(name, meta);
    const action = document.createElement("button");
    action.type = "button";
    action.className = "button button--secondary button--small";
    action.textContent = legacyShotRecord ? "迁移为项目资料" : "移除资料关联";
    action.addEventListener("click", () => {
      applyDirectorWorkspaceMutation(
        legacyShotRecord ? "迁移旧版项目资料" : "移除项目资料关联",
        (current) => ({
          ...current,
          updatedAt: new Date().toISOString(),
          bindings: legacyShotRecord
            ? current.bindings.map((candidate) => candidate.bindingId === binding.bindingId
                ? { ...candidate, targetKind: "project", targetId: current.projectId }
                : candidate)
            : current.bindings.filter((candidate) => candidate.bindingId !== binding.bindingId)
        })
      );
      if (legacyShotRecord) {
        for (const productionBinding of productionBindingsForTarget(directorProductionState, "shot", binding.targetId)
          .filter((candidate) => candidate.assetId === binding.assetId && !candidate.archived)) {
          directorProductionState = archiveProductionBinding(directorProductionState, productionBinding.id);
        }
        directorP1Ui.setState(directorProductionState);
      }
      markDirectorDirty();
      syncDirectorFrames();
      updateDirectorPreview();
    });
    row.append(thumbnail, copy, action);
    list.append(row);
  }
  if (relations.length > 0) directorProjectDataBindings.append(list);

  const relatedAssetIds = new Set(relations.map(({ binding }) => binding.assetId));
  const available = project.assets.filter((asset) => (
    asset.availability === "available" && !relatedAssetIds.has(asset.assetId)
  ));
  const controls = document.createElement("div");
  controls.className = "director-shot-asset-controls director-project-data-controls";
  const select = document.createElement("select");
  select.id = "director-project-data-asset-select";
  select.setAttribute("aria-label", "选择要关联为项目资料的素材");
  select.append(new Option(available.length === 0 ? "没有可关联的项目素材" : "选择项目资料素材", ""));
  for (const asset of available) {
    select.add(new Option(`${asset.displayName} · ${ASSET_TYPE_LABELS[asset.mediaType]}`, asset.assetId));
  }
  select.disabled = available.length === 0;
  const purpose = document.createElement("span");
  purpose.className = "director-shot-asset-purpose-summary";
  purpose.textContent = "选择素材后将保存为项目资料，不会建立镜头图片输入。";
  const bind = document.createElement("button");
  bind.id = "director-project-data-asset-bind";
  bind.type = "button";
  bind.className = "button button--secondary button--small";
  bind.textContent = "关联项目资料";
  bind.disabled = true;
  select.addEventListener("change", () => {
    const asset = project.assets.find((candidate) => candidate.assetId === select.value);
    bind.disabled = asset === undefined;
    purpose.textContent = asset === undefined
      ? "选择素材后将保存为项目资料，不会建立镜头图片输入。"
      : `${ASSET_PURPOSE_LABELS[DIRECTOR_PROJECT_REFERENCE_PURPOSE_BY_MEDIA[asset.mediaType]]} · 仅项目资料，不参与 T2V 或其他工作流编译`;
  });
  bind.addEventListener("click", () => {
    const asset = project.assets.find((candidate) => candidate.assetId === select.value);
    if (asset === undefined) return;
    const createdAt = new Date().toISOString();
    const projectBinding: RelayAssetBinding = {
      bindingId: `binding-${crypto.randomUUID()}`,
      targetKind: "project",
      targetId: project.projectId,
      assetId: asset.assetId,
      purpose: DIRECTOR_PROJECT_REFERENCE_PURPOSE_BY_MEDIA[asset.mediaType],
      notes: "",
      createdAt
    };
    applyDirectorWorkspaceMutation("关联项目资料", (current) => ({
      ...current,
      updatedAt: createdAt,
      bindings: [...current.bindings, projectBinding]
    }));
    markDirectorDirty();
    updateDirectorPreview();
  });
  const openLibrary = document.createElement("button");
  openLibrary.type = "button";
  openLibrary.className = "button button--secondary button--small";
  openLibrary.textContent = "打开素材库";
  openLibrary.addEventListener("click", () => showView("assets"));
  controls.append(select, purpose, bind, openLibrary);
  directorProjectDataBindings.append(controls);
}

function syncDirectorAssetRelationCopy(
  project: RelayProjectDocument,
  mode: ProjectMode,
  shotId: string
): boolean {
  const shotIds = directorOrderedShotIds(project);
  if (mode === "T2V") return false;
  if (mode === "FL2VA") {
    directorShotAssetsTitle.textContent = "首尾帧素材";
    directorShotAssetsDescription.textContent = "只有首镜头的首帧和末镜头的尾帧会真实进入 FL2VA 工作流。";
    directorShotBindAsset.textContent = "选择首帧 / 尾帧";
    directorShotBindAsset.dataset.emptyMessage = "请导入通过预检的图片，再将其设置为首帧或尾帧。";
    return shotId === shotIds[0] || shotId === shotIds.at(-1);
  }
  directorShotAssetsTitle.textContent = "Ref2VA 参考图片";
  directorShotAssetsDescription.textContent = "主体、产品、场景、风格与连续性参考会真实接入当前单镜头 Ref2VA 工作流，最多 2 张。";
  directorShotBindAsset.textContent = "选择参考图片";
  directorShotBindAsset.dataset.emptyMessage = "请导入通过预检的图片，再选择明确的 Ref2VA 参考用途。";
  return shotIds.length === 1 && shotId === shotIds[0];
}

function renderDirectorShotAssetBindings(): void {
  renderDirectorProjectDataBindings();
  directorShotAssetBindings.replaceChildren();
  const project = directorWorkspace?.session.current ?? activeRelayProject;
  const mode = directorSelectedMode();
  const shotId = project?.professional.activeShotId ?? directorActiveShotId;
  const shotAssetsSection = directorShotAssetsTitle.closest<HTMLElement>("section");
  const shotAssetsTab = directorDrawerTabs.querySelector<HTMLButtonElement>('[data-director-drawer-tab="assets"]');
  if (shotAssetsTab !== null) shotAssetsTab.hidden = mode === "T2V";
  if (mode === "T2V") {
    if (directorDrawerActiveTab === "assets") setDirectorDrawerTab("details");
    if (shotAssetsSection !== null) shotAssetsSection.hidden = true;
    directorShotAssetsTitle.textContent = "镜头素材";
    directorShotAssetsDescription.textContent = "T2V 没有图片输入；连续性参考请在独立的“项目资料”区域管理。";
    directorShotBindAsset.disabled = true;
    return;
  }
  if (shotAssetsSection !== null) shotAssetsSection.hidden = false;
  if (shotId === null || project === null) {
    directorShotAssetsTitle.textContent = "镜头素材";
    directorShotAssetsDescription.textContent = "先从时间线选择镜头，再查看当前模式可接入的图片输入。";
    directorShotBindAsset.textContent = "选择镜头素材";
    directorShotBindAsset.disabled = true;
    const empty = document.createElement("p");
    empty.className = "director-p1-empty";
    empty.textContent = "先从时间线选择一个镜头。";
    directorShotAssetBindings.append(empty);
    return;
  }
  const supportsBindingHere = syncDirectorAssetRelationCopy(project, mode, shotId);
  directorShotBindAsset.disabled = !supportsBindingHere;
  const projectionPlan = buildDirectorAssetProjectionPlan(project, mode);
  const bindings = directorAssetBindingsForContext(project, mode, shotId);
  const list = document.createElement("div");
  list.className = "director-shot-asset-list";
  for (const binding of bindings) {
    const asset = project.assets.find((candidate) => candidate.assetId === binding.assetId);
    const projection = projectionPlan.entries.get(binding.bindingId);
    const projectionStatus = projection?.status ?? "invalid";
    const row = document.createElement("div");
    row.className = "director-shot-asset-row";
    row.dataset.projectionStatus = projectionStatus;
    const thumbnail = document.createElement("span");
    thumbnail.className = `director-shot-asset-thumbnail asset-type-mark--${asset?.mediaType ?? "image"}`;
    if (asset === undefined) {
      thumbnail.dataset.previewState = "unavailable";
      thumbnail.setAttribute("role", "img");
      thumbnail.setAttribute("aria-label", "素材记录不可用，无法显示预览");
    } else {
      requestDirectorAssetPreview(project.projectId, asset.assetId, asset.displayName, thumbnail);
    }
    const copy = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = asset?.displayName ?? "素材记录不可用";
    const meta = document.createElement("small");
    const relationMessage = projection?.message ?? "该素材未能映射到认证工作流输入";
    meta.textContent = asset === undefined
      ? `${ASSET_PURPOSE_LABELS[binding.purpose]} · ${relationMessage} · 素材记录缺失（仅警告，不阻断编译）`
      : `${ASSET_TYPE_LABELS[asset.mediaType]} · ${PROJECT_ASSET_AVAILABILITY_LABELS[asset.availability]} · ${ASSET_PURPOSE_LABELS[binding.purpose]} · ${relationMessage}`;
    copy.append(name, meta);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "button button--secondary button--small";
    remove.textContent = "解除工作流绑定";
    remove.addEventListener("click", () => {
      applyDirectorWorkspaceMutation(
        "解除工作流素材绑定",
        (current) => ({
          ...current,
          updatedAt: new Date().toISOString(),
          bindings: current.bindings.filter((candidate) => candidate.bindingId !== binding.bindingId)
        })
      );
      for (const legacy of productionBindingsForTarget(directorProductionState, "shot", binding.targetId)
        .filter((candidate) => candidate.assetId === binding.assetId && !candidate.archived)) {
        directorProductionState = archiveProductionBinding(directorProductionState, legacy.id);
      }
      directorP1Ui.setState(directorProductionState);
      markDirectorDirty();
      syncDirectorFrames();
      updateDirectorPreview();
    });
    row.append(thumbnail, copy, remove);
    list.append(row);
  }
  if (bindings.length > 0) directorShotAssetBindings.append(list);
  const available = project.assets.filter((asset) => (
    asset.availability === "available"
    && !bindings.some((binding) => binding.assetId === asset.assetId)
    && directorAssetPurposeOptions(project, mode, shotId, asset.mediaType).length > 0
  ));
  const controls = document.createElement("div");
  controls.className = "director-shot-asset-controls";
  const select = document.createElement("select");
  select.id = "director-shot-project-asset-select";
  select.setAttribute("aria-label", "选择要接入当前工作流的图片素材");
  const emptyOption = !supportsBindingHere
    ? mode === "FL2VA" ? "当前镜头不是首帧或尾帧位置" : "Ref2VA 参考图只支持单镜头工作流"
    : available.length === 0 ? "没有可接入的图片素材" : "选择图片素材";
  select.append(new Option(emptyOption, ""));
  for (const asset of available) {
    select.add(new Option(`${asset.displayName} · ${ASSET_TYPE_LABELS[asset.mediaType]}`, asset.assetId));
  }
  select.disabled = !supportsBindingHere || available.length === 0;
  const purposeSelect = document.createElement("select");
  purposeSelect.id = "director-shot-project-asset-purpose";
  purposeSelect.setAttribute("aria-label", "选择素材在当前镜头中的用途；当前模式决定是否进入工作流");
  purposeSelect.disabled = true;
  const purposeSummary = document.createElement("span");
  purposeSummary.className = "director-shot-asset-purpose-summary";
  purposeSummary.hidden = true;
  const projectionStatus = document.createElement("small");
  projectionStatus.id = "director-shot-project-asset-projection";
  projectionStatus.setAttribute("role", "status");
  projectionStatus.dataset.projectionStatus = "invalid";
  projectionStatus.textContent = !supportsBindingHere
    ? mode === "FL2VA"
      ? "此镜头没有 FL2VA 图片输入位；不会创建伪绑定。"
      : "当前认证 Ref2VA 只允许单镜头参考图；不会创建伪绑定。"
    : available.length === 0
      ? directorShotBindAsset.dataset.emptyMessage ?? "请先在素材库导入可用素材。"
      : "选择图片和用途后，会明确显示如何进入本次 H3 工作流。";
  const bind = document.createElement("button");
  bind.id = "director-shot-project-asset-bind";
  bind.type = "button";
  bind.className = "button button--secondary button--small";
  bind.textContent = "接入工作流";
  bind.disabled = true;
  const syncPurposeAndProjection = (): void => {
    const asset = project.assets.find((candidate) => candidate.assetId === select.value);
    purposeSelect.replaceChildren();
    purposeSummary.hidden = true;
    if (asset === undefined) {
      purposeSelect.hidden = false;
      purposeSelect.append(new Option("先选择图片用途", ""));
      purposeSelect.disabled = true;
      bind.disabled = true;
      projectionStatus.dataset.projectionStatus = "invalid";
      return;
    }
    const purposes = directorAssetPurposeOptions(project, mode, shotId, asset.mediaType);
    for (const purpose of purposes) {
      purposeSelect.add(new Option(`${ASSET_PURPOSE_LABELS[purpose]} · 进入工作流`, purpose));
    }
    const purpose = defaultDirectorAssetPurpose(project, mode, shotId, asset.mediaType);
    purposeSelect.value = purpose;
    purposeSelect.hidden = false;
    purposeSelect.disabled = false;
    const updateProjectionPreview = (): void => {
      const selectedPurpose = purposeSelect.value as RelayAssetPurpose;
      const previewBinding: RelayAssetBinding = {
        bindingId: "binding-preview",
        targetKind: "shot",
        targetId: shotId,
        assetId: asset.assetId,
        purpose: selectedPurpose,
        notes: "",
        createdAt: "9999-12-31T23:59:59.999Z"
      };
      const previewProject: RelayProjectDocument = {
        ...project,
        bindings: [...project.bindings, previewBinding]
      };
      const preview = buildDirectorAssetProjectionPlan(previewProject, mode).entries.get(previewBinding.bindingId);
      projectionStatus.dataset.projectionStatus = preview?.status ?? "invalid";
      projectionStatus.textContent = preview?.message ?? "无法确认此素材是否能进入工作流。";
      bind.disabled = preview === undefined || preview.status !== "executable";
    };
    purposeSelect.onchange = updateProjectionPreview;
    updateProjectionPreview();
  };
  select.addEventListener("change", syncPurposeAndProjection);
  bind.addEventListener("click", () => {
    if (select.value.length === 0 || purposeSelect.value.length === 0) return;
    const asset = project.assets.find((candidate) => candidate.assetId === select.value);
    if (asset === undefined) return;
    const purpose = purposeSelect.value as RelayAssetPurpose;
    const bindingId = `binding-${crypto.randomUUID()}`;
    const createdAt = new Date().toISOString();
    const projectBinding: RelayAssetBinding = {
      bindingId,
      targetKind: "shot",
      targetId: shotId,
      assetId: select.value,
      purpose,
      notes: "",
      createdAt
    };
    applyDirectorWorkspaceMutation(
      "接入工作流素材",
      (current) => ({
        ...current,
        updatedAt: createdAt,
        bindings: [...current.bindings, projectBinding]
      })
    );
    directorProductionState = upsertProductionBinding(directorProductionState, {
      identityKey: `shot-reference:${shotId}:${select.value}:${purpose}`,
      targetKind: "shot",
      targetId: shotId,
      assetId: select.value,
      role: "reference"
    });
    directorP1Ui.setState(directorProductionState);
    markDirectorDirty();
    syncDirectorFrames();
    updateDirectorPreview();
  });
  const openLibrary = document.createElement("button");
  openLibrary.type = "button";
  openLibrary.className = "button button--secondary button--small";
  openLibrary.textContent = "打开素材库";
  openLibrary.addEventListener("click", () => showView("assets"));
  controls.append(select, purposeSelect, purposeSummary, projectionStatus, bind, openLibrary);
  directorShotAssetBindings.append(controls);
}

const inFlightActionKeys = new Set<string>();

async function runAssetAction(
  operation: (reportFeedback: FeedbackReporter) => Promise<void>,
  title: string | ((error: unknown) => string),
  actionKey = typeof title === "string" ? title : "project-action"
): Promise<void> {
  if (inFlightActionKeys.has(actionKey)) return;
  inFlightActionKeys.add(actionKey);
  const reportFeedback = feedbackForScope();
  try {
    await operation(reportFeedback);
  } catch (error) {
    if (error instanceof ProjectOperationSupersededError
      || error instanceof AssetLibraryOperationSupersededError) return;
    reportFeedback({
      kind: "error",
      title: typeof title === "string" ? title : title(error),
      message: publicError(error)
    });
  } finally {
    inFlightActionKeys.delete(actionKey);
  }
}

function projectOpenFailureTitle(error: unknown): string {
  return /项目已在另一操作中更新|项目版本已变化|项目已被移除/u.test(publicError(error))
    ? "项目版本需要重新载入"
    : "项目无法打开";
}

assetLibraryController.subscribe(renderAssetLibrary);
async function performAssetImport(mode: "copy" | "reference"): Promise<void> {
  assetImportMode = mode;
  await runAssetAction(async (reportFeedback) => {
    const result = await assetLibraryController.importSelected();
    if (result.cancelled) return;
    await refreshDirectorAssetCatalog();
    const imported = result.results.filter((item) => item.status === "imported").length;
    const duplicates = result.results.filter((item) => item.status === "duplicate").length;
    const failures = result.results.flatMap((item) => item.status === "failed" || item.status === "unsupported"
      ? [`${item.selectedFileName}：${item.message}`]
      : []);
    reportFeedback({
      kind: failures.length > 0 ? "warning" : "success",
      title: failures.length > 0 ? "部分素材未导入" : "素材已加入项目",
      message: duplicates > 0 && imported === 0 && failures.length === 0
        ? "所选素材已在项目中，没有创建重复副本。"
        : `新增 ${imported} 项${duplicates > 0 ? `，${duplicates} 项已在项目中` : ""}${failures.length > 0 ? `，${failures.length} 项未处理` : ""}。${mode === "copy" ? "项目副本已写入素材库，" : "已登记外部引用，"}源文件保持不变。`,
      ...(failures.length > 0 ? { detail: failures.join("\n") } : {})
    });
  }, "素材未导入");
  assetImportMode = "copy";
}

async function performDroppedAssetImport(files: readonly File[]): Promise<void> {
  if (files.length === 0) return;
  await runAssetAction(async (reportFeedback) => {
    const mutation = await flushAndCaptureProjectMutation();
    const result = await window.controlPlane.importDroppedProjectAssets({
      projectId: mutation.projectId
    }, files);
    const synchronized = await synchronizeProjectMutation(mutation);
    if (!synchronized) return;
    await assetLibraryController.load();
    if (!isCurrentProjectOperation(mutation)) return;
    if (!await refreshDirectorAssetCatalog(mutation)) return;
    const failures = result.results
      .filter((entry) => entry.status === "rejected")
      .map((entry) => `${entry.fileName}：${entry.issues.join("；") || "未通过本地预检"}`);
    reportFeedback({
      kind: failures.length > 0 ? "warning" : "success",
      title: failures.length > 0 ? "部分素材未导入" : "素材已加入项目",
      message: result.importedCount === 0 && result.duplicateCount > 0 && failures.length === 0
        ? "拖入的素材已在项目中，没有创建重复副本。"
        : `新增 ${result.importedCount} 项${result.duplicateCount > 0 ? `，${result.duplicateCount} 项已在项目中` : ""}${failures.length > 0 ? `，${failures.length} 项未处理` : ""}。项目副本已写入素材库，源文件保持不变。`,
      ...(failures.length > 0 ? { detail: failures.join("\n") } : {})
    });
  }, "拖入的素材未导入");
}

assetImportButton.addEventListener("click", () => {
  void performAssetImport("copy");
});

assetAdvancedImportButton.addEventListener("click", (event) => {
  event.stopPropagation();
  assetImportOptionsDialog.showModal();
  assetImportOptionsCancel.focus();
});
assetImportOptionsCancel.addEventListener("click", () => assetImportOptionsDialog.close());
assetImportReferenceConfirm.addEventListener("click", () => {
  assetImportOptionsDialog.close();
  void performAssetImport("reference");
});
assetImportOptionsDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  assetImportOptionsDialog.close();
  assetAdvancedImportButton.focus();
});

assetRefreshButton.addEventListener("click", () => {
  void runAssetAction(async () => {
    await assetLibraryController.refreshExistence();
    await refreshDirectorAssetCatalog();
  }, "文件状态未更新");
});

assetDetail.addEventListener("submit", (event) => {
  event.preventDefault();
  const assetId = selectedAssetId;
  if (assetId === null) return;
  void runAssetAction(async (reportFeedback) => {
    const tags = [...new Set(assetTags.value.split(/[,，;；\n]/u).map((tag) => tag.trim()).filter(Boolean))];
    await assetLibraryController.updateMetadata({
      assetId,
      displayName: assetDisplayName.value.trim(),
      tags,
      note: assetNote.value
    });
    await refreshDirectorAssetCatalog();
    reportFeedback({ kind: "success", title: "素材资料已保存", message: "名称、标签和备注已写入本机素材记录。" });
  }, "素材资料未保存");
});

assetRelocateButton.addEventListener("click", () => {
  const assetId = selectedAssetId;
  if (assetId === null) return;
  void runAssetAction(async (reportFeedback) => {
    const result = await assetLibraryController.relocate(assetId);
    if (result.status === "cancelled") return;
    if (result.status === "relocated") {
      await refreshDirectorAssetCatalog();
      reportFeedback({ kind: "success", title: "素材已重新定位", message: "已用 SHA-256 确认是同一文件；素材绑定保持有效。" });
      return;
    }
    throw new Error("所选文件与原素材内容不同，不能作为同一素材重新定位。请使用“导入素材”将它作为新素材加入项目。");
  }, "素材未重新定位");
});

assetCopyProjectButton.addEventListener("click", () => {
  const assetId = selectedAssetId;
  if (assetId === null) return;
  void runAssetAction(async (reportFeedback) => {
    const result = await assetLibraryController.copyToProject(assetId);
    if (result.status === "cancelled") return;
    await refreshDirectorAssetCatalog();
    reportFeedback({
      kind: "success",
      title: "项目素材副本已建立",
      message: `已复制并校验到 ${result.projectRelativePath}；源文件保持不变。`
    });
  }, "项目素材副本未建立");
});

assetSearchInput.addEventListener("input", () => {
  if (assetSearchTimer !== null) window.clearTimeout(assetSearchTimer);
  assetSearchTimer = window.setTimeout(() => {
    assetSearchTimer = null;
    void assetLibraryController.setQuery(assetSearchInput.value).catch((error: unknown) => {
      showFeedback({ kind: "error", title: "素材搜索未完成", message: publicError(error) });
    });
  }, 180);
});
assetTypeFilter.addEventListener("change", () => {
  void assetLibraryController.setFilters({ mediaType: assetTypeFilter.value as AssetMediaType | "all" }).catch((error: unknown) => {
    showFeedback({ kind: "error", title: "素材筛选未完成", message: publicError(error) });
  });
});
assetAvailabilityFilter.addEventListener("change", () => {
  void assetLibraryController.setFilters({ availability: assetAvailabilityFilter.value as AssetAvailability | "all" }).catch((error: unknown) => {
    showFeedback({ kind: "error", title: "素材筛选未完成", message: publicError(error) });
  });
});
assetSort.addEventListener("change", () => renderAssetLibrary(assetLibrarySnapshot));
assetViewList.addEventListener("click", () => {
  assetViewMode = "list";
  assetViewList.setAttribute("aria-pressed", "true");
  assetViewGrid.setAttribute("aria-pressed", "false");
  renderAssetLibrary(assetLibrarySnapshot);
});
assetViewGrid.addEventListener("click", () => {
  assetViewMode = "grid";
  assetViewList.setAttribute("aria-pressed", "false");
  assetViewGrid.setAttribute("aria-pressed", "true");
  renderAssetLibrary(assetLibrarySnapshot);
});
assetDetailClose.addEventListener("click", () => closeAssetDetailDrawer());
assetDetailBackdrop.addEventListener("click", () => closeAssetDetailDrawer());
assetDetailDrawer.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    closeAssetDetailDrawer();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = modalFocusableElements(assetDetailDrawer);
  if (focusable.length === 0) {
    event.preventDefault();
    assetDetailDrawer.focus({ preventScroll: true });
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
});

function promptLanguage(value: string): "zh" | "en" | "mixed" {
  const hasHan = /\p{Script=Han}/u.test(value);
  const hasLatin = /[A-Za-z]/u.test(value);
  return hasHan && hasLatin ? "mixed" : hasHan ? "zh" : "en";
}

type ProjectCenterSummary = ProjectCenterState["projects"][number];

function visibleRecentProjects(state: ProjectCenterState | null): readonly ProjectCenterSummary[] {
  if (state === null) return Object.freeze([]);
  const active = new Map(state.projects
    .filter((project) => project.status === "active")
    .map((project) => [project.projectId, project] as const));
  const ordered: ProjectCenterSummary[] = [];
  const seen = new Set<string>();
  const activeProjectId = activeRelayProject?.projectId ?? state.activeProjectId;
  if (activeProjectId !== null && activeProjectId !== undefined) {
    const current = active.get(activeProjectId);
    if (current !== undefined) {
      ordered.push(current);
      seen.add(current.projectId);
    }
  }
  for (const recent of state.recentProjects) {
    const project = active.get(recent.projectId);
    if (project === undefined || seen.has(project.projectId)) continue;
    ordered.push(project);
    seen.add(project.projectId);
  }
  for (const project of [...active.values()].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))) {
    if (seen.has(project.projectId)) continue;
    ordered.push(project);
    seen.add(project.projectId);
  }
  return Object.freeze(ordered);
}

function projectCenterSurfaceButton(options: {
  readonly label: string;
  readonly projectId: string;
  readonly target: Extract<ViewName, "project" | "director" | "assets">;
}): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button button--secondary button--small project-center-project__surface-action";
  button.dataset.projectSurface = options.target;
  button.textContent = options.label;
  button.addEventListener("click", () => {
    if (button.disabled) return;
    button.disabled = true;
    void runAssetAction(async () => {
      await activateRelayProject(options.projectId, options.target);
    }, projectOpenFailureTitle, `open-project:${options.projectId}`).finally(() => {
      if (button.isConnected) button.disabled = false;
    });
  });
  return button;
}

function appendActiveProjectSummary(article: HTMLElement, project: RelayProjectDocument): void {
  article.classList.add("project-center-project--active");
  article.dataset.projectActive = "true";
  const summary = document.createElement("div");
  summary.className = "project-center-project__active-summary";
  summary.dataset.projectCurrentSummary = "true";

  const facts = document.createElement("p");
  facts.className = "project-center-project__facts";
  facts.textContent = `${project.assets.length} 项素材 · ${project.shots.filter((shot) => !shot.archived).length} 个镜头 · ${project.workflows.length} 个已编译工作流`;
  summary.append(facts);

  const actions = document.createElement("div");
  actions.className = "project-center-project__surface-actions";
  actions.setAttribute("aria-label", `继续项目 ${project.name}`);
  actions.append(
    projectCenterSurfaceButton({
      label: "继续编辑",
      projectId: project.projectId,
      target: project.editorMode === "professional" ? "director" : "project"
    }),
    projectCenterSurfaceButton({ label: "素材库", projectId: project.projectId, target: "assets" })
  );
  summary.append(actions);
  article.append(summary);
}

function updateProjectCenterActions(): void {
  const enabled = activeRelayProject !== null;
  projectCenterExportBundle.disabled = !enabled;
  projectCenterClone.disabled = !enabled;
  projectCenterArchive.disabled = !enabled;
  if (projectCenterMaintenancePanel !== null) {
    projectCenterMaintenancePanel.dataset.projectSelected = String(enabled);
  }
}

function renderProjectCenter(): void {
  const state = projectCenterState;
  const dataRoot = state?.dataRoot.trim() ?? "";
  const hasDataRoot = dataRoot.length > 0;
  projectCenterDataRoot.textContent = hasDataRoot ? dataRoot : "尚未配置";
  projectCenterDataRoot.title = hasDataRoot ? dataRoot : "尚未配置 Relay 数据目录";
  projectCenterDataRoot.setAttribute(
    "aria-label",
    hasDataRoot ? `Relay 数据目录：${dataRoot}` : "尚未配置 Relay 数据目录"
  );
  projectCenterOpenDataRoot.disabled = !hasDataRoot;
  if (projectCenterDataRootPanel !== null) {
    projectCenterDataRootPanel.dataset.configurationState = hasDataRoot ? "configured" : "missing";
  }
  projectCenterRecentList.replaceChildren();
  const projects = visibleRecentProjects(state);
  for (const summary of projects) {
    const fragment = projectCenterProjectTemplate.content.cloneNode(true) as DocumentFragment;
    const article = fragment.querySelector<HTMLElement>("[data-project-id]");
    const button = fragment.querySelector<HTMLButtonElement>('[data-project-action="open"]');
    const name = fragment.querySelector<HTMLElement>("[data-project-name]");
    const meta = fragment.querySelector<HTMLElement>("[data-project-meta]");
    const mode = fragment.querySelector<HTMLElement>("[data-project-mode]");
    if (article === null || button === null || name === null || meta === null || mode === null) continue;
    const isActive = summary.projectId === activeRelayProject?.projectId;
    article.dataset.projectId = summary.projectId;
    article.dataset.projectActive = String(isActive);
    article.dataset.editorMode = summary.editorMode;
    name.textContent = summary.name;
    meta.textContent = `更新于 ${new Date(summary.updatedAt).toLocaleString("zh-CN")}`;
    mode.textContent = summary.editorMode === "professional" ? "专业导播" : "快速创建";
    const projectTarget: Extract<ViewName, "project" | "director"> = summary.editorMode === "professional" ? "director" : "project";
    button.setAttribute("aria-current", String(isActive));
    button.setAttribute("aria-label", `${isActive ? "继续当前项目" : "打开项目"} ${summary.name}，进入${summary.editorMode === "professional" ? "专业导播" : "快速创建"}`);
    button.addEventListener("click", () => {
      if (button.disabled) return;
      button.disabled = true;
      void runAssetAction(async () => {
        await activateRelayProject(summary.projectId, projectTarget);
      }, projectOpenFailureTitle, `open-project:${summary.projectId}`).finally(() => {
        if (button.isConnected) button.disabled = false;
      });
    });
    if (isActive && activeRelayProject !== null) appendActiveProjectSummary(article, activeRelayProject);
    projectCenterRecentList.append(fragment);
  }
  projectCenterRecentEmpty.hidden = projects.length > 0;
  const activeProjectCount = state?.projects.filter((project) => project.status === "active").length ?? 0;
  projectCenterStatus.textContent = activeRelayProject === null
    ? `${activeProjectCount} 个可用项目`
    : `${activeProjectCount} 个可用项目 · 当前：${activeRelayProject.name}`;
  updateProjectCenterActions();
}

async function refreshProjectCenter(): Promise<ProjectCenterState> {
  const requestGeneration = ++projectCenterRequestGeneration;
  const state = await window.controlPlane.getProjectCenter();
  if (requestGeneration === projectCenterRequestGeneration) {
    projectCenterState = state;
    renderProjectCenter();
  }
  return state;
}

function recoveryTimestamp(value: string | null | undefined): string {
  if (value === null || value === undefined) return "删除时间未记录";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "删除时间未记录" : `删除于 ${parsed.toLocaleString("zh-CN")}`;
}

function renderProjectTrash(): void {
  projectTrashList.replaceChildren();
  const deleted = (projectCenterState?.projects ?? [])
    .filter((project) => project.status === "archived")
    .sort((left, right) => (right.archivedAt ?? right.updatedAt).localeCompare(left.archivedAt ?? left.updatedAt));
  projectTrashEmpty.hidden = deleted.length > 0;
  for (const project of deleted) {
    const row = document.createElement("article");
    row.className = "recovery-list__item";
    row.setAttribute("role", "listitem");
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = project.name;
    const detail = document.createElement("small");
    detail.textContent = recoveryTimestamp(project.archivedAt);
    copy.append(title, detail);
    const restore = document.createElement("button");
    restore.type = "button";
    restore.className = "button button--secondary button--small";
    restore.textContent = "恢复";
      restore.addEventListener("click", () => {
      if (restore.disabled) return;
      restore.disabled = true;
      void runAssetAction(async (reportFeedback) => {
        const transitionEpoch = beginProjectTransition();
        const restored = await window.controlPlane.restoreRelayProject({ projectId: project.projectId });
        if (transitionEpoch !== activeProjectActivationEpoch) return;
        projectTrashDialog.close();
        const activated = await activateRelayProject(restored.projectId, "home", transitionEpoch);
        if (!activated) return;
        reportFeedback({ kind: "success", title: "项目已恢复", message: "项目已回到项目中心，原有素材、镜头、历史和工作流保持不变。" });
      }, "项目未恢复").finally(() => {
        if (restore.isConnected) restore.disabled = false;
      });
    });
    row.append(copy, restore);
    projectTrashList.append(row);
  }
}

async function openProjectTrash(): Promise<void> {
  await refreshProjectCenter();
  renderProjectTrash();
  projectTrashDialog.showModal();
  projectTrashClose.focus();
}

async function renderAssetTrash(): Promise<boolean> {
  const context = captureProjectOperationContext();
  const requestGeneration = ++assetTrashRequestGeneration;
  const deleted = await window.controlPlane.listDeletedProjectAssets({ projectId: context.projectId });
  if (requestGeneration !== assetTrashRequestGeneration || !isCurrentProjectOperation(context)) return false;
  assetTrashList.replaceChildren();
  assetTrashEmpty.hidden = deleted.length > 0;
  for (const asset of deleted) {
    const row = document.createElement("article");
    row.className = "recovery-list__item";
    row.setAttribute("role", "listitem");
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = asset.displayName;
    const detail = document.createElement("small");
    detail.textContent = `${ASSET_TYPE_LABELS[asset.mediaType]} · ${recoveryTimestamp(asset.deletedAt)}`;
    copy.append(title, detail);
    const restore = document.createElement("button");
    restore.type = "button";
    restore.className = "button button--secondary button--small";
    restore.textContent = "恢复";
    restore.addEventListener("click", () => {
      if (restore.disabled) return;
      restore.disabled = true;
      void runAssetAction(async (reportFeedback) => {
        const mutation = await flushAndCaptureProjectMutation();
        if (mutation.projectId !== context.projectId) throw new Error("项目已经切换，请重新打开当前项目的素材回收站。");
        const result = await window.controlPlane.restoreProjectAsset({ projectId: mutation.projectId, assetId: asset.assetId });
        const synchronized = await synchronizeProjectMutation(mutation);
        if (!synchronized) return;
        if (result.status === "not_found") throw new Error("回收记录已不存在，请重新打开回收站。");
        if (result.status === "conflict") throw new Error("当前项目已经存在同标识素材，未覆盖任何记录。");
        await assetLibraryController.load();
        if (!isCurrentProjectOperation(mutation)) return;
        if (!await refreshDirectorAssetCatalog(mutation)) return;
        if (!await renderAssetTrash()) return;
        reportFeedback({
          kind: "success",
          title: result.status === "already_present" ? "素材已在项目中" : "素材已恢复",
          message: "源文件和项目副本均未被修改；素材记录已重新可用。"
        });
      }, "素材未恢复").finally(() => {
        if (restore.isConnected) restore.disabled = false;
      });
    });
    row.append(copy, restore);
    assetTrashList.append(row);
  }
  return true;
}

async function openAssetTrash(): Promise<void> {
  if (!await renderAssetTrash()) return;
  assetTrashDialog.showModal();
  assetTrashClose.focus();
}

function syncQuickSeedPolicyControls(): void {
  const fixed = seedPolicy.value === "fixed";
  projectSeed.disabled = !fixed;
  projectSeed.setAttribute("aria-disabled", String(!fixed));
}

function syncDirectorSeedPolicyControls(): void {
  const fixed = directorSeedPolicy.value === "fixed";
  directorSeed.disabled = !fixed;
  directorSeed.setAttribute("aria-disabled", String(!fixed));
}

function setQuickFormFromProject(project: RelayProjectDocument): void {
  workflowNameInput.value = project.quick.workflowName || project.name;
  projectPrompt.value = project.quick.originalPrompt;
  const mode = projectForm.querySelector<HTMLInputElement>(`input[name="mode"][value="${project.quick.mode}"]`);
  if (mode !== null && !mode.disabled) mode.checked = true;
  if ([...projectDuration.options].some((option) => option.value === String(project.quick.totalDurationSeconds))) {
    projectDuration.value = String(project.quick.totalDurationSeconds);
  }
  if ([...segmentDuration.options].some((option) => option.value === String(project.quick.segmentDurationSeconds))) {
    segmentDuration.value = String(project.quick.segmentDurationSeconds);
  }
  if ([...projectCanvas.options].some((option) => option.value === project.quick.canvasAspectRatio)) {
    projectCanvas.value = project.quick.canvasAspectRatio;
  }
  if ([...projectResolution.options].some((option) => option.value === project.quick.resolutionMegapixels)) {
    projectResolution.value = project.quick.resolutionMegapixels;
  }
  projectSeed.value = project.quick.seed;
  if (optionValueExists(seedPolicy, project.quick.seedPolicy)) seedPolicy.value = project.quick.seedPolicy;
  if ([...samplingProfile.options].some((option) => option.value === project.quick.sampling)) {
    samplingProfile.value = project.quick.sampling;
  }
  promptCount.textContent = `${projectPrompt.value.length} / 4000`;
  syncFrameControls();
  syncQuickSeedPolicyControls();
  syncSegmentPlan();
  syncCanvasSummary();
}

async function restoreProjectFrameSelections(
  project: RelayProjectDocument,
  activationEpoch: number
): Promise<boolean> {
  let restoredFirstFrame: FrameSelection | null = null;
  let restoredLastFrame: FrameSelection | null = null;
  try {
    if (project.quick.firstFrameAssetId !== null) {
      restoredFirstFrame = await window.controlPlane.prepareProjectAssetFrame({
        projectId: project.projectId,
        assetId: project.quick.firstFrameAssetId,
        slot: "first"
      });
    }
    if (project.quick.lastFrameAssetId !== null) {
      restoredLastFrame = await window.controlPlane.prepareProjectAssetFrame({
        projectId: project.projectId,
        assetId: project.quick.lastFrameAssetId,
        slot: "last"
      });
    }
  } catch (error) {
    if (activationEpoch !== activeProjectActivationEpoch || activeRelayProject?.projectId !== project.projectId) {
      return false;
    }
    showFeedback({ kind: "warning", title: "项目参考素材需要处理", message: publicError(error) });
  }
  if (activationEpoch !== activeProjectActivationEpoch || activeRelayProject?.projectId !== project.projectId) {
    return false;
  }
  firstFrame = restoredFirstFrame;
  lastFrame = restoredLastFrame;
  syncFrameControls();
  syncDirectorFrames();
  return true;
}

async function flushActiveProjectEditorsBeforeChange(): Promise<void> {
  if (projectSaveTimer !== null) {
    window.clearTimeout(projectSaveTimer);
    projectSaveTimer = null;
    if (activeRelayProject !== null) {
      await persistRelayProject(projectWithQuickForm(activeRelayProject));
    }
  }
  if (directorWorkspaceSaveTimer !== null) {
    window.clearTimeout(directorWorkspaceSaveTimer);
    directorWorkspaceSaveTimer = null;
  }
  if (directorAutosaveTimer !== null) {
    window.clearTimeout(directorAutosaveTimer);
    directorAutosaveTimer = null;
  }
  if (projectSaveInFlight !== null) await projectSaveInFlight;
  if (directorWorkspaceSaveInFlight !== null) await directorWorkspaceSaveInFlight;
  if (directorWorkspace !== null && projectWorkspaceSaveIndicator(directorWorkspace) !== "saved") {
    await persistRelayProject(directorWorkspace.session.current);
  }
  if (directorDraftDirty && activeRelayProject !== null) {
    const saved = await saveDirectorDraft(true);
    if (!saved) throw new Error("切换项目前无法保存专业导播草稿。");
  }
}

function resetDirectorSession(project: RelayProjectDocument | null): void {
  directorWorkspace = null;
  directorShotMemory.clear();
  directorShotMetadata.clear();
  directorShotIds.clear();
  directorShotList.replaceChildren();
  directorTimelineTrack.replaceChildren();
  directorActiveShotId = null;
  directorLastCompiledSnapshot = "";
  directorLastCompiledTechnicalSnapshot = "";
  directorLastCompiledShotFingerprints = Object.freeze({});
  directorLegacyShotIdMap = Object.freeze({});
  directorPendingCompilation = null;
  directorCompileDispatchPending = false;
  directorDraftDirty = false;
  directorDraftRestored = false;
  directorLastAutosavedAt = null;

  directorWorkflowName.value = project?.name ?? "";
  directorLanguage.value = "zh";
  directorMode.value = project?.quick.mode ?? "T2V";
  directorTotalDuration.value = String(project?.quick.totalDurationSeconds ?? 30);
  directorSegmentDuration.value = String(project?.quick.segmentDurationSeconds ?? 5);
  directorCanvas.value = project?.quick.canvasAspectRatio ?? "9:16";
  directorResolution.value = project?.quick.resolutionMegapixels ?? "0.4";
  directorSeed.value = project?.quick.seed ?? "1";
  directorSeedPolicy.value = project?.quick.seedPolicy ?? "random_per_compile";
  directorSampling.value = project?.quick.sampling ?? "quality_20";
  for (const field of [
    directorContinuity,
    directorCharacterBible,
    directorWorldBible,
    directorVisualStyleBible,
    directorSoundscape,
    directorMusic,
    directorSubjects,
    directorSummary,
    directorRetention,
    directorStyleOpening
  ]) field.value = "";

  directorProductionState = createEmptyProductionState({
    projectName: project?.name ?? "",
    identityKey: project === null ? "relay-director-no-project" : `relay-director-${project.projectId}`
  });
  directorP1Ui.setState(directorProductionState);
  directorP1Ui.resetTransientEditors();
  directorP1Ui.setActiveShot(null);
  directorP1Ui.setAssetOptions(Object.freeze([]));
  directorPromptPreview.textContent = "";
  directorPromptCount.textContent = "0 / 4000";
  directorShotCount.textContent = "0 个镜头";
  directorSegmentSummary.textContent = "";
  directorStateChip.textContent = project === null ? "未打开项目" : "已载入项目";
  directorStateChip.classList.toggle("status-badge--success", project !== null);
  if (!directorDrawerLayer.hidden) closeDirectorDrawer();
  syncDirectorSeedPolicyControls();
  syncDirectorCompileButtonState();
}

function beginProjectTransition(): number {
  directorWorkspaceLoadGeneration += 1;
  directorAssetCatalogRequestGeneration += 1;
  assetPreviewRequestGeneration += 1;
  assetTrashRequestGeneration += 1;
  generatedVideoUi.invalidateProject();
  assetLibraryController.invalidate();
  projectAssetViews = Object.freeze([]);
  selectedAssetId = null;
  return ++activeProjectActivationEpoch;
}

async function activateRelayProject(
  projectId: string,
  target: ViewName = "home",
  requestedActivationEpoch?: number
): Promise<boolean> {
  const activationEpoch = requestedActivationEpoch ?? beginProjectTransition();
  if (activationEpoch !== activeProjectActivationEpoch) return false;
  await flushActiveProjectEditorsBeforeChange();
  if (activationEpoch !== activeProjectActivationEpoch) return false;
  const loadedProject = await window.controlPlane.loadRelayProject({ projectId, activate: true });
  if (activationEpoch !== activeProjectActivationEpoch) return false;
  const legacyQuickAssetMigration = migrateLegacyQuickAssetReferences(loadedProject);
  const project = legacyQuickAssetMigration.changed
    ? await window.controlPlane.saveRelayProject({
        project: legacyQuickAssetMigration.project,
        expectedUpdatedAt: loadedProject.updatedAt
      })
    : loadedProject;
  if (activationEpoch !== activeProjectActivationEpoch) return false;
  activeRelayProject = project;
  resetDirectorSession(project);
  persistedProjectUpdatedAtById.set(project.projectId, project.updatedAt);
  projectAssetViews = Object.freeze([]);
  selectedAssetId = null;
  setQuickFormFromProject(project);
  if (!await restoreProjectFrameSelections(project, activationEpoch)) return false;
  if (activationEpoch !== activeProjectActivationEpoch) return false;
  await refreshProjectCenter();
  if (activationEpoch !== activeProjectActivationEpoch) return false;
  restoreDirectorDraft();
  if (target !== "home") showView(target);
  return true;
}

function projectWithQuickForm(project: RelayProjectDocument): RelayProjectDocument {
  const mode = selectedRadio<ProjectMode>("mode");
  return {
    ...project,
    // A project name identifies the project container. The workflow name is an
    // independent export label and must never silently rename that container.
    name: project.name,
    updatedAt: new Date().toISOString(),
    quick: {
      ...project.quick,
      workflowName: workflowNameInput.value,
      originalPrompt: projectPrompt.value,
      mode,
      language: promptLanguage(projectPrompt.value),
      totalDurationSeconds: selectedDuration(),
      segmentDurationSeconds: selectedSegmentDuration(),
      canvasAspectRatio: projectCanvas.value,
      resolutionMegapixels: projectResolution.value,
      seed: projectSeed.value,
      seedPolicy: seedPolicy.value as SeedPolicy,
      sampling: samplingProfile.value
    }
  };
}

let activeProjectRevision = 0;
const persistedProjectUpdatedAtById = new Map<string, string>();
const projectSaveConflictGenerationById = new Map<string, number>();

function isProjectSaveConflict(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { readonly code?: unknown }).code ?? "")
    : "";
  return code === "PROJECT_CONFLICT"
    || /PROJECT_CONFLICT|项目已在另一操作中更新|项目版本已变化|项目已被移除/u.test(publicError(error));
}

async function reloadProjectAuthorityAfterConflict(context: ProjectOperationContext): Promise<boolean> {
  const authoritative = await window.controlPlane.loadRelayProject({
    projectId: context.projectId,
    activate: false
  });
  if (!isCurrentProjectOperation(context)) return false;
  activeProjectRevision += 1;
  persistedProjectUpdatedAtById.set(authoritative.projectId, authoritative.updatedAt);
  activeRelayProject = authoritative;
  setQuickFormFromProject(authoritative);
  projectAssetViews = Object.freeze([]);
  assetLibraryController.invalidate();
  directorAssetCatalogRequestGeneration += 1;
  assetPreviewRequestGeneration += 1;
  if (directorWorkspace?.session.current.projectId === authoritative.projectId) {
    resetDirectorSession(authoritative);
    initializeDirectorWorkspace(authoritative);
  }
  return true;
}

function adoptProjectAuthority(
  authoritativeProject: RelayProjectDocument,
  expectedProjectId: string,
  expectedActivationEpoch: number
): boolean {
  if (!canAdoptProjectAuthority({
    authoritativeProject,
    expectedProjectId,
    currentProjectId: activeRelayProject?.projectId ?? null,
    expectedActivationEpoch,
    currentActivationEpoch: activeProjectActivationEpoch,
    knownUpdatedAt: persistedProjectUpdatedAtById.get(expectedProjectId)
  })) return false;

  if (directorWorkspace !== null) {
    directorWorkspace = synchronizeWorkspaceAuthoritativeProject(directorWorkspace, authoritativeProject);
  }
  const editorProject = directorWorkspace?.session.current.projectId === expectedProjectId
    ? directorWorkspace.session.current
    : activeRelayProject;
  if (editorProject === null) return false;
  activeRelayProject = mergeAuthoritativeProjectWithEditorState(authoritativeProject, editorProject);
  persistedProjectUpdatedAtById.set(authoritativeProject.projectId, authoritativeProject.updatedAt);
  return true;
}

function adoptCompiledProjectAuthority(
  authoritativeProject: RelayProjectDocument | null,
  expectedProjectId: string,
  expectedActivationEpoch: number,
  workflowFileName: string,
  targetRelativePath: string | null
): boolean {
  if (authoritativeProject === null) return false;
  if (authoritativeProject.projectId !== expectedProjectId) {
    throw new Error("编译结果归属于其他项目，Relay 已阻止写入当前项目。");
  }
  assertProjectContainsCompileHandoff(authoritativeProject, workflowFileName, targetRelativePath);
  return adoptProjectAuthority(authoritativeProject, expectedProjectId, expectedActivationEpoch);
}

async function flushAndCaptureProjectMutation(): Promise<{
  readonly projectId: string;
  readonly activationEpoch: number;
}> {
  const projectId = requireActiveRelayProjectId();
  const activationEpoch = activeProjectActivationEpoch;
  await flushActiveProjectEditorsBeforeChange();
  if (activeRelayProject?.projectId !== projectId || activeProjectActivationEpoch !== activationEpoch) {
    throw new Error("项目已经切换，本次操作未继续写入旧项目。");
  }
  return Object.freeze({ projectId, activationEpoch });
}

async function synchronizeProjectMutation(context: {
  readonly projectId: string;
  readonly activationEpoch: number;
}): Promise<boolean> {
  const authoritativeProject = await window.controlPlane.loadRelayProject({
    projectId: context.projectId,
    activate: false
  });
  if (
    activeRelayProject?.projectId !== context.projectId ||
    activeProjectActivationEpoch !== context.activationEpoch
  ) return false;
  if (!adoptProjectAuthority(authoritativeProject, context.projectId, context.activationEpoch)) {
    throw new Error("项目操作已完成，但 Relay 未能同步项目最新版本；请重新载入项目。");
  }
  return true;
}

async function persistRelayProject(project: RelayProjectDocument): Promise<RelayProjectDocument> {
  const projectId = project.projectId;
  const revision = ++activeProjectRevision;
  const activationEpoch = activeRelayProject?.projectId === projectId
    ? activeProjectActivationEpoch
    : null;
  const conflictGeneration = projectSaveConflictGenerationById.get(projectId) ?? 0;
  if (activationEpoch !== null) activeRelayProject = project;
  const previous = projectSaveInFlight;
  const operation = (async () => {
    if (previous !== null) await previous.catch(() => undefined);
    if ((projectSaveConflictGenerationById.get(projectId) ?? 0) !== conflictGeneration) {
      throw new ProjectOperationSupersededError();
    }
    if (activationEpoch !== null && !isCurrentProjectOperation({ projectId, activationEpoch })) {
      throw new ProjectOperationSupersededError();
    }
    if (activationEpoch !== null && isCurrentProjectOperation({ projectId, activationEpoch })) {
      directorAutosaveState.textContent = "保存中…";
    }
    const saved = await window.controlPlane.saveRelayProject({
      project,
      expectedUpdatedAt: persistedProjectUpdatedAtById.get(projectId) ?? project.updatedAt
    });
    persistedProjectUpdatedAtById.set(projectId, saved.updatedAt);
    if (activationEpoch !== null
      && isCurrentProjectOperation({ projectId, activationEpoch })
      && activeProjectRevision === revision) {
      activeRelayProject = saved;
      directorAutosaveState.textContent = "已保存";
    }
    return saved;
  })();
  projectSaveInFlight = operation;
  try {
    return await operation;
  } catch (error) {
    if (isProjectSaveConflict(error)) {
      projectSaveConflictGenerationById.set(projectId, conflictGeneration + 1);
      if (activationEpoch !== null) {
        const reloaded = await reloadProjectAuthorityAfterConflict({ projectId, activationEpoch }).catch(() => false);
        if (reloaded) {
          throw new Error("项目已在另一操作中更新；Relay 已重新载入磁盘中的最新版本，请确认内容后重试。");
        }
      }
    }
    if (activationEpoch !== null && isCurrentProjectOperation({ projectId, activationEpoch })) {
      directorAutosaveState.textContent = "保存失败";
    }
    throw error;
  } finally {
    if (projectSaveInFlight === operation) projectSaveInFlight = null;
  }
}

function scheduleQuickProjectSave(): void {
  if (activeRelayProject === null) return;
  const scheduledProject = projectWithQuickForm(activeRelayProject);
  const context = captureProjectOperationContext();
  activeRelayProject = scheduledProject;
  if (projectSaveTimer !== null) window.clearTimeout(projectSaveTimer);
  projectSaveTimer = window.setTimeout(() => {
    projectSaveTimer = null;
    if (!isCurrentProjectOperation(context)) return;
    void persistRelayProject(scheduledProject).catch((error: unknown) => {
      if (!isCurrentProjectOperation(context) || error instanceof ProjectOperationSupersededError) return;
      showFeedback({ kind: "error", title: "项目自动保存失败", message: publicError(error) });
    });
  }, 450);
}

async function flushQuickProjectSave(): Promise<RelayProjectDocument> {
  if (activeRelayProject === null) throw new Error("请先打开一个 Relay 项目。");
  if (projectSaveTimer !== null) {
    window.clearTimeout(projectSaveTimer);
    projectSaveTimer = null;
  }
  return persistRelayProject(projectWithQuickForm(activeRelayProject));
}

async function importRelayBundleFromPicker(reportFeedback: FeedbackReporter): Promise<void> {
  const transitionEpoch = beginProjectTransition();
  const result = await window.controlPlane.importRelayProjectBundle();
  if (result.cancelled || result.project === null) return;
  const activated = await activateRelayProject(result.project.projectId, "home", transitionEpoch);
  if (!activated) return;
  reportFeedback({
    kind: "success",
    title: "项目包已导入",
    message: "项目、项目内素材、连续性数据和已编译工作流已校验并写入当前数据目录。",
    ...(result.displayPath === null ? {} : { detail: result.displayPath })
  });
}

projectCenterCreate.addEventListener("click", () => {
  projectCreateName.value = "";
  projectCreateError.hidden = true;
  projectCreateDialog.showModal();
  projectCreateName.focus();
});
projectCreateCancel.addEventListener("click", () => projectCreateDialog.close());
projectCreateForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = projectCreateName.value.trim();
  if (name.length === 0) {
    projectCreateError.textContent = "请输入项目名称。";
    projectCreateError.hidden = false;
    projectCreateName.focus();
    return;
  }
  void runAssetAction(async () => {
    const transitionEpoch = beginProjectTransition();
    const project = await window.controlPlane.createRelayProject({ name });
    if (transitionEpoch !== activeProjectActivationEpoch) return;
    projectCreateDialog.close();
    const activated = await activateRelayProject(project.projectId, "project", transitionEpoch);
    if (!activated) return;
    feedbackForScope()({ kind: "success", title: "项目已建立", message: "项目文件已真实写入 Relay 数据目录。" });
  }, "项目未建立");
});
projectCenterImportBundle.addEventListener("click", () => void runAssetAction(importRelayBundleFromPicker, "项目包未导入"));
projectCenterOpenDataRoot.addEventListener("click", () => void runAssetAction(async () => {
  await window.controlPlane.openDataRoot();
}, "数据目录无法打开"));
projectCenterChangeDataRoot.addEventListener("click", () => dataRootDialog.showModal());
dataRootCancel.addEventListener("click", () => dataRootDialog.close());
for (const [button, mode] of [[dataRootMigrateButton, "migrate"], [dataRootNewLibraryButton, "new_library"]] as const) {
  button.addEventListener("click", () => void runAssetAction(async (reportFeedback) => {
    const result = await window.controlPlane.chooseAndConfigureDataRoot({ mode });
    if (result === null) return;
    dataRootDialog.close();
    projectCenterState = result;
    renderProjectCenter();
    reportFeedback({ kind: "success", title: "数据目录已切换", message: "Relay 已验证并保存新的数据目录；应用将按主进程提示完成切换。" });
  }, "数据目录未切换"));
}
projectCenterExportBundle.addEventListener("click", () => void runAssetAction(async (reportFeedback) => {
  const result = await window.controlPlane.exportRelayProjectBundle({
    projectId: requireActiveRelayProjectId(),
    externalReferencePolicy: "copy"
  });
  if (result.cancelled) return;
  reportFeedback({
    kind: "success",
    title: "项目包已导出",
    message: "项目包内文件长度与 SHA-256 已校验。",
    ...(result.displayPath === null ? {} : { detail: result.displayPath })
  });
}, "项目包未导出"));
projectCenterClone.addEventListener("click", () => void runAssetAction(async (reportFeedback) => {
  if (activeRelayProject === null) return;
  const sourceProject = activeRelayProject;
  const transitionEpoch = beginProjectTransition();
  const copy = await window.controlPlane.cloneRelayProject({ projectId: sourceProject.projectId, name: `${sourceProject.name} 副本` });
  const activated = await activateRelayProject(copy.projectId, "home", transitionEpoch);
  if (!activated) return;
  reportFeedback({ kind: "success", title: "项目副本已建立", message: "副本拥有新的项目 ID，原项目保持不变。" });
}, "项目副本未建立"));
projectCenterArchive.addEventListener("click", () => void runAssetAction(async (reportFeedback) => {
  if (activeRelayProject === null) return;
  const targetProject = Object.freeze({
    projectId: activeRelayProject.projectId,
    name: activeRelayProject.name
  });
  if (!await confirmAction({
    title: `删除项目“${targetProject.name}”？`,
    message: "项目会从普通列表移入回收站，可以恢复；项目文件和外部素材不会被永久删除。",
    confirmLabel: "删除项目"
  })) return;
    const deletingActiveProject = activeRelayProject?.projectId === targetProject.projectId;
    const deletionEpoch = deletingActiveProject ? beginProjectTransition() : activeProjectActivationEpoch;
    if (deletingActiveProject) await flushActiveProjectEditorsBeforeChange();
    await window.controlPlane.archiveRelayProject({ projectId: targetProject.projectId });
    if (!deletingActiveProject || deletionEpoch !== activeProjectActivationEpoch
      || activeRelayProject?.projectId !== targetProject.projectId) {
      await refreshProjectCenter();
      reportFeedback({ kind: "success", title: "项目已移入回收站", message: "项目文件、素材、历史和工作流均保留，可从项目回收站恢复。" });
      return;
    }
    activeRelayProject = null;
    resetDirectorSession(null);
    workflowNameInput.value = "";
    projectPrompt.value = "";
    firstFrame = null;
    lastFrame = null;
    syncFrameControls();
    await refreshProjectCenter();
    showView("home");
    reportFeedback({ kind: "success", title: "项目已移入回收站", message: "项目文件、素材、历史和工作流均保留，可从项目回收站恢复。" });
}, "项目未删除"));
projectCenterTrash.addEventListener("click", () => void runAssetAction(openProjectTrash, "项目回收站未打开"));
projectTrashClose.addEventListener("click", () => projectTrashDialog.close());
projectTrashDialog.addEventListener("cancel", () => projectTrashDialog.close());
projectConvertToDirector.addEventListener("click", () => void runAssetAction(async () => {
  const context = captureProjectOperationContext();
  const project = await flushQuickProjectSave();
  requireCurrentProjectOperation(context);
  const promoted = promoteQuickProjectToProfessional({ project, updatedAt: new Date().toISOString() });
  const saved = await persistRelayProject(promoted);
  requireCurrentProjectOperation(context);
  activeRelayProject = saved;
  directorDraftRestored = false;
  restoreDirectorDraft();
  await refreshProjectCenter();
  requireCurrentProjectOperation(context);
  showView("director");
}, "项目未转为专业导播"));

assetRevealFile.addEventListener("click", () => void runAssetAction(async () => {
  if (selectedAssetId === null) return;
  await window.controlPlane.revealProjectAsset({ projectId: requireActiveRelayProjectId(), assetId: selectedAssetId });
}, "无法显示素材所在目录"));
assetRemoveRecord.addEventListener("click", () => void runAssetAction(async (reportFeedback) => {
  if (selectedAssetId === null) return;
  const context = captureProjectOperationContext();
  const assetId = selectedAssetId;
  const asset = selectedAsset();
  if (asset === null || !await confirmAction({
    title: `删除素材“${asset.displayName}”？`,
    message: "素材会从项目列表移入回收站，可以恢复；源文件和项目副本不会被永久删除。",
    confirmLabel: "删除素材"
  })) return;
  if (!isCurrentProjectOperation(context)) return;
  const mutation = await flushAndCaptureProjectMutation();
  if (mutation.projectId !== context.projectId || mutation.activationEpoch !== context.activationEpoch) return;
  const result = await window.controlPlane.removeProjectAsset({ projectId: mutation.projectId, assetId });
  const synchronized = await synchronizeProjectMutation(mutation);
  if (!synchronized) return;
  if (result.status === "in_use") {
    showFeedback({ kind: "warning", title: "素材仍被项目引用", message: `请先解除 ${result.bindings.length} 处镜头、场景或实体引用。` });
    return;
  }
  if (result.status === "not_found") throw new Error("素材记录已不存在，请刷新素材库。");
  selectedAssetId = null;
  closeAssetDetailDrawer(false);
  await assetLibraryController.load();
  if (!isCurrentProjectOperation(mutation)) return;
  if (!await refreshDirectorAssetCatalog(mutation)) return;
  reportFeedback({ kind: "success", title: "素材已移入回收站", message: "源文件和项目副本均未删除，可从素材库的回收站恢复。" });
}, "素材未删除"));
assetTrashButton.addEventListener("click", () => void runAssetAction(openAssetTrash, "素材回收站未打开"));
assetTrashClose.addEventListener("click", () => assetTrashDialog.close());
assetTrashDialog.addEventListener("cancel", () => assetTrashDialog.close());

assetDropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  assetDropZone.classList.add("is-dragging");
});
assetDropZone.addEventListener("dragleave", () => assetDropZone.classList.remove("is-dragging"));
assetDropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  assetDropZone.classList.remove("is-dragging");
  const files = Object.freeze([...event.dataTransfer?.files ?? []]);
  void performDroppedAssetImport(files);
});

const generatedVideoUi = createGeneratedVideoUi({
  controlPlane: window.controlPlane,
  getProjectContext: () => activeRelayProject === null
    ? null
    : Object.freeze({
        projectId: activeRelayProject.projectId,
        projectName: activeRelayProject.name,
        activationEpoch: activeProjectActivationEpoch
      }),
  isProjectContextCurrent: isCurrentProjectOperation,
  flushAndCaptureProjectMutation,
  synchronizeProjectMutation,
  reloadProjectAssets: async (context) => {
    projectAssetViews = Object.freeze([]);
    await assetLibraryController.load().catch(() => undefined);
    if (!isCurrentProjectOperation(context)) return;
    await refreshDirectorAssetCatalog(context).catch(() => false);
  },
  showFeedback,
  publicError,
  formatBytes: formatAssetBytes
});

const updateUi = createUpdateUi({
  controlPlane: window.controlPlane,
  showError: (title, message) => showFeedback({ kind: "error", title, message }),
  publicError,
  formatBytes: formatAssetBytes
});

function setButtonBusy(button: HTMLButtonElement, busy: boolean, label: string): void {
  button.disabled = busy;
  button.setAttribute("aria-busy", String(busy));
  const labelNode = button.querySelector<HTMLElement>(".button-label");
  if (labelNode !== null) labelNode.textContent = label;
}

function openAboutLink(button: HTMLButtonElement, target: AboutLinkTarget): void {
  if (button.disabled) return;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  void window.controlPlane.openAboutLink(target)
    .then((opened) => {
      if (!opened) throw new Error("系统未能打开默认浏览器。");
    })
    .catch((error: unknown) => showFeedback({
      kind: "error",
      title: "GitHub 页面未打开",
      message: publicError(error)
    }))
    .finally(() => {
      button.disabled = false;
      button.setAttribute("aria-busy", "false");
    });
}

aboutAuthorProfile.addEventListener("click", () => openAboutLink(aboutAuthorProfile, "repository"));

type ProjectFormControl = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement;
const projectFormControlStates = new Map<ProjectFormControl, boolean>();

function setProjectFormBusy(busy: boolean): void {
  projectForm.toggleAttribute("aria-busy", busy);
  if (busy) {
    projectFormControlStates.clear();
    for (const control of projectForm.querySelectorAll<ProjectFormControl>("input, textarea, select, button")) {
      if (control === compileButton) continue;
      projectFormControlStates.set(control, control.disabled);
      control.disabled = true;
    }
    projectSubmitStatus.textContent = "已固定本次提交快照；工作流完成交接前，当前表单暂时锁定。";
    projectSubmitStatus.hidden = false;
    return;
  }
  for (const [control, disabled] of projectFormControlStates) {
    if (control.isConnected) control.disabled = disabled;
  }
  projectFormControlStates.clear();
  projectSubmitStatus.textContent = "";
  projectSubmitStatus.hidden = true;
  syncFrameControls();
  syncRef2vaAvailability();
}

function syncDirectorCompileButtonState(): void {
  const busy = directorCompileDispatchPending || directorCompileInFlightCount > 0;
  directorCompileButton.disabled = busy;
  directorCompileButton.setAttribute("aria-busy", String(busy));
}

function showView(view: ViewName): void {
  const needsProject = view === "project" || view === "director" || view === "assets" || view === "generated";
  const requestedView: ViewName = needsProject && activeRelayProject === null
    ? "home"
    : view;
  if (requestedView !== "generated") generatedVideoUi.deactivate();
  setToastView(requestedView);
  if (requestedView !== "director") closeDirectorDrawer(false);
  if (requestedView !== "assets" && !assetDetailLayer.hidden) closeAssetDetailDrawer(false);
  for (const section of document.querySelectorAll<HTMLElement>("[data-view]")) {
    const active = section.dataset.view === requestedView;
    section.hidden = !active;
    section.classList.toggle("is-active", active);
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-view-target]")) {
    const active = button.dataset.viewTarget === requestedView;
    button.classList.toggle("is-active", active);
    if (button.closest(".main-navigation") !== null) {
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
  }
  element<HTMLElement>("main-content").focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: preferredScrollBehavior() });
  if (requestedView === "assets") {
    void ensureAssetLibraryLoaded().catch((error: unknown) => {
      assetLibraryStatus.textContent = publicError(error);
      assetLibraryStatus.classList.add("is-error");
    });
  }
  if (requestedView === "generated") {
    generatedVideoUi.activate();
  }
  if (requestedView === "director") {
    void ensureDirectorWorkspaceLoaded().catch((error: unknown) => {
      showFeedback({ kind: "error", title: "专业导播项目未载入", message: publicError(error) });
    });
  }
  if (requestedView === "home") renderProjectCenter();
}

function formatGiB(value: number): string {
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)} GB`;
}

function formatTransferRate(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return "等待新数据";
  const mebibytes = bytesPerSecond / 1024 ** 2;
  return `${mebibytes >= 10 ? mebibytes.toFixed(1) : mebibytes.toFixed(2)} MiB/s`;
}

function formatRemainingTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "计算中";
  if (seconds < 60) return `约 ${Math.max(1, Math.ceil(seconds))} 秒`;
  if (seconds < 3600) return `约 ${Math.ceil(seconds / 60)} 分钟`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.ceil((seconds % 3600) / 60);
  return `约 ${hours} 小时${minutes > 0 ? ` ${minutes} 分钟` : ""}`;
}

function renderInstallationTransferMetrics(status: InstallationStatusResult): void {
  const terminal = status.state === "complete" || status.state === "cancelled" || status.state === "failed";
  if (terminal || status.networkTotalBytes <= 0) {
    installationTransferSample = null;
    installationTransferMetrics.hidden = true;
    installationTransferMetrics.textContent = "";
    return;
  }
  const now = Date.now();
  const previous = installationTransferSample;
  let bytesPerSecond = previous?.installationId === status.installationId
    ? previous.bytesPerSecond
    : null;
  if (
    previous?.installationId === status.installationId &&
    status.networkDownloadedBytes >= previous.downloadedBytes
  ) {
    const elapsedSeconds = (now - previous.timestampMs) / 1000;
    const deltaBytes = status.networkDownloadedBytes - previous.downloadedBytes;
    if (elapsedSeconds >= 0.25 && deltaBytes > 0) {
      const instantaneous = deltaBytes / elapsedSeconds;
      bytesPerSecond = bytesPerSecond === null
        ? instantaneous
        : (bytesPerSecond * 0.65) + (instantaneous * 0.35);
    }
  }
  installationTransferSample = Object.freeze({
    installationId: status.installationId,
    downloadedBytes: status.networkDownloadedBytes,
    timestampMs: now,
    bytesPerSecond
  });
  const downloaded = formatGiB(status.networkDownloadedBytes / 1024 ** 3);
  const total = formatGiB(status.networkTotalBytes / 1024 ** 3);
  if (status.phase !== "download") {
    installationTransferMetrics.textContent = `真实下载 ${downloaded} / ${total} · 下载阶段已结束，正在${installationStateLabel(status)}`;
    installationTransferMetrics.hidden = false;
    return;
  }
  const remainingBytes = Math.max(0, status.networkTotalBytes - status.networkDownloadedBytes);
  const rate = bytesPerSecond === null ? "正在建立速度样本" : formatTransferRate(bytesPerSecond);
  const eta = bytesPerSecond === null ? "预计时间计算中" : `剩余 ${formatRemainingTime(remainingBytes / bytesPerSecond)}`;
  installationTransferMetrics.textContent = `真实下载 ${downloaded} / ${total} · ${rate} · ${eta}`;
  installationTransferMetrics.hidden = false;
}

function locationSourceLabel(source: string): string {
  switch (source) {
    case "explicit":
    case "user_selected": return "用户选择";
    case "detected":
    case "auto_detected": return "自动检测";
    case "managed": return "本工具受管目录";
    case "missing": return "未检测到";
    default: return source.length > 0 ? source : "未检测到";
  }
}

function resultLocations(result: ScanInstallationResult): ScanDetectedLocations {
  return result.locations;
}

function syncInstallationLocationPresentation(locations: ScanDetectedLocations): void {
  const hasComfy = locations.comfyUiRoot !== null && locations.comfyUiRoot.trim().length > 0;
  const hasModel = locations.modelRoot !== null && locations.modelRoot.trim().length > 0;
  const foundLabels = [hasComfy ? "ComfyUI" : null, hasModel ? "H3 模型" : null]
    .filter((label): label is string => label !== null);
  const managedDestination = installRoot.value.trim().length > 0 ? installRoot.value.trim() : "D:\\MiniMaxH3";
  element("managed-root-title").textContent = "将安装到";
  existingEnvironmentReuseSummary.textContent = foundLabels.length === 0
    ? `未发现可复用环境；无需选择，Relay 将使用 ${managedDestination}。`
    : `发现可复用环境：${foundLabels.join("、")}；展开可核对或改选。`;
  existingEnvironmentReuse.open = false;
}

function renderDetectedLocation(
  kind: "comfy" | "model",
  path: string | null,
  source: string
): void {
  const input = kind === "comfy" ? comfyUiRoot : modelRoot;
  const card = element<HTMLElement>(`${kind}-location-card`);
  const state = element<HTMLElement>(`${kind}-location-state`);
  const sourceLabel = element<HTMLElement>(`${kind}-location-source`);
  const found = path !== null && path.trim().length > 0;
  input.value = path ?? "";
  sourceLabel.textContent = `检测来源：${locationSourceLabel(source)}`;
  state.textContent = found ? "已定位" : "未选择（可选）";
  state.classList.toggle("is-found", found);
  state.classList.toggle("is-empty-optional", !found);
  card.classList.remove("is-missing");
  const selection = kind === "comfy" ? comfyLocationSelection : modelLocationSelection;
  selection.textContent = found
    ? path
    : kind === "comfy"
      ? "未选择外部 ComfyUI；将使用受管环境。"
      : "未选择外部模型目录；将安装到受管环境。";
}

function markLocationPending(kind: "comfy" | "model", path: string): void {
  const normalized = path.trim();
  const hasPath = normalized.length > 0;
  element(`${kind}-location-source`).textContent = hasPath
    ? "检测来源：用户选择，等待重新检测"
    : "检测来源：未检测到";
  const state = element(`${kind}-location-state`);
  state.textContent = hasPath ? "待检测" : "未选择（可选）";
  state.classList.remove("is-found");
  state.classList.toggle("is-empty-optional", !hasPath);
  element(`${kind}-location-card`).classList.remove("is-missing");
  const selection = kind === "comfy" ? comfyLocationSelection : modelLocationSelection;
  selection.textContent = hasPath
    ? normalized
    : kind === "comfy"
      ? "未选择外部 ComfyUI；将使用受管环境。"
      : "未选择外部模型目录；将安装到受管环境。";
}

function renderComponent(component: ComponentScanResult): HTMLElement {
  const article = document.createElement("article");
  article.className = "component-card";
  article.dataset.componentId = component.id;
  const policy = componentUiPolicy(component);
  article.dataset.externalReuse = String(policy.detectedExternalReuse);
  article.dataset.componentState = component.state;
  article.dataset.reuseProgressLabel = policy.initialProgressLabel;
  article.dataset.reuseProgressState = policy.initialProgressState;

  const selector = document.createElement("label");
  selector.className = "component-toggle";
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.name = "optionalComponent";
  checkbox.value = component.id;
  checkbox.checked = policy.checked;
  checkbox.disabled = policy.permanentlyLocked;
  checkbox.dataset.locked = String(policy.permanentlyLocked);
  checkbox.dataset.componentState = component.state;
  checkbox.setAttribute(
    "aria-label",
    `${component.title}${policy.requirementLabel === "必需"
      ? "（必需）"
      : policy.detectedExternalReuse
        ? "（已检测，复用锁定）"
        : "（可选）"}`
  );
  const control = document.createElement("span");
  control.className = "component-toggle__control";
  selector.append(checkbox, control);

  const glyph = document.createElement("span");
  glyph.className = `component-glyph component-glyph--${component.id}`;
  glyph.setAttribute("aria-hidden", "true");
  glyph.textContent = component.id === "pyav_required" ? "Py" : component.id.startsWith("ffmpeg") ? "FF" : component.id.startsWith("comfyui") ? "C" : component.id.startsWith("turbo") ? "⚡" : component.id.startsWith("ref") ? "R" : "F";

  const copy = document.createElement("div");
  copy.className = "component-copy";
  const titleRow = document.createElement("div");
  titleRow.className = "component-title-row";
  const title = document.createElement("strong");
  title.textContent = component.title;
  const requirement = document.createElement("span");
  requirement.className = policy.requirementLabel === "必需" ? "required-tag" : "optional-tag";
  requirement.textContent = policy.requirementLabel;
  titleRow.append(title, requirement);
  const description = document.createElement("p");
  description.textContent = component.description;
  const progress = document.createElement("div");
  progress.className = "component-progress";
  progress.dataset.componentProgress = component.id;
  const progressLabel = document.createElement("small");
  progressLabel.className = "component-progress__label";
  progressLabel.textContent = policy.initialProgressLabel;
  const progressTrack = document.createElement("span");
  progressTrack.className = "component-progress__track";
  progressTrack.setAttribute("role", "progressbar");
  progressTrack.setAttribute("aria-label", `${component.title}进度`);
  progressTrack.setAttribute("aria-valuemin", "0");
  progressTrack.setAttribute("aria-valuemax", "100");
  const progressBar = document.createElement("i");
  progressTrack.append(progressBar);
  progress.append(progressLabel, progressTrack);
  setComponentProgress(progress, policy.initialProgressState);
  checkbox.addEventListener("change", () => {
    if (checkbox.checked) {
      setComponentProgress(progress, policy.initialProgressState);
      progressLabel.textContent = componentProgressLabel(component, true);
    } else {
      setComponentProgress(progress, "pending");
      progressLabel.textContent = "未选择";
    }
    if (latestScan !== null) updateDownloadSummary(latestScan);
  });
  copy.append(titleRow, description, progress);

  const state = document.createElement("div");
  state.className = `component-state component-state--${component.state}`;
  const stateText = document.createElement("strong");
  stateText.textContent = policy.stateLabel;
  const size = document.createElement("span");
  size.textContent = component.id === "pyav_required"
    ? "包含在 ComfyUI 中"
    : formatGiB(component.sizeGiB);
  state.append(stateText, size);

  article.append(selector, glyph, copy, state);
  return article;
}

function renderManagedComfyComponent(): HTMLElement {
  const article = document.createElement("article");
  article.className = "component-card";
  article.dataset.componentId = "managed_comfy_portable";
  article.dataset.managedSelected = "true";

  const fixed = document.createElement("span");
  fixed.className = "component-fixed-check";
  fixed.setAttribute("aria-label", "必需");
  fixed.textContent = "✓";
  const glyph = document.createElement("span");
  glyph.className = "component-glyph";
  glyph.setAttribute("aria-hidden", "true");
  glyph.textContent = "C";
  const copy = document.createElement("div");
  copy.className = "component-copy";
  const titleRow = document.createElement("div");
  titleRow.className = "component-title-row";
  const title = document.createElement("strong");
  title.textContent = "ComfyUI Windows 便携运行环境";
  const required = document.createElement("span");
  required.className = "required-tag";
  required.textContent = "必需";
  titleRow.append(title, required);
  const description = document.createElement("p");
  description.textContent = "未找到可附加的 ComfyUI；将在统一受管根中安装固定版本 Portable。";
  const progress = document.createElement("div");
  progress.className = "component-progress";
  progress.dataset.componentProgress = "managed_comfy_portable";
  const progressLabel = document.createElement("small");
  progressLabel.className = "component-progress__label";
  progressLabel.textContent = "等待安装计划";
  const track = document.createElement("span");
  track.className = "component-progress__track";
  track.setAttribute("role", "progressbar");
  track.setAttribute("aria-label", "ComfyUI Windows Portable 进度");
  track.setAttribute("aria-valuemin", "0");
  track.setAttribute("aria-valuemax", "100");
  track.append(document.createElement("i"));
  progress.append(progressLabel, track);
  setComponentProgress(progress, "pending");
  copy.append(titleRow, description, progress);
  const state = document.createElement("div");
  state.className = "component-state component-state--needs_download";
  const stateText = document.createElement("strong");
  stateText.textContent = "需安装";
  const size = document.createElement("span");
  size.textContent = "下载约 2.0 GB · 解压后约 8.0 GB";
  state.append(stateText, size);
  article.append(fixed, glyph, copy, state);
  return article;
}

function setComponentProgress(
  progress: HTMLElement,
  state: "pending" | "running" | "complete" | "failed"
): void {
  progress.dataset.state = state;
  const track = progress.querySelector<HTMLElement>(".component-progress__track");
  if (track === null) return;
  if (state === "complete") track.setAttribute("aria-valuenow", "100");
  else if (state === "pending") track.setAttribute("aria-valuenow", "0");
  else track.removeAttribute("aria-valuenow");
}

function updateComponentProgress(status: InstallationStatusResult): void {
  for (const article of componentList.querySelectorAll<HTMLElement>(".component-card")) {
    const checkbox = article.querySelector<HTMLInputElement>('input[name="optionalComponent"]');
    const progress = article.querySelector<HTMLElement>(".component-progress");
    const label = article.querySelector<HTMLElement>(".component-progress__label");
    if (progress === null || label === null) continue;
    if (article.dataset.externalReuse === "true") {
      setComponentProgress(
        progress,
        article.dataset.reuseProgressState === "complete" ? "complete" : "pending"
      );
      label.textContent = article.dataset.reuseProgressLabel ?? "已检测，可复用";
      continue;
    }
    const selected = checkbox?.checked === true || article.dataset.managedSelected === "true";
    if (!selected) {
      setComponentProgress(progress, "pending");
      label.textContent = "未选择";
    } else if (status.state === "complete") {
      setComponentProgress(progress, "complete");
      label.textContent = "安装与配置完成";
    } else if (status.state === "failed" || status.state === "recovery_required") {
      setComponentProgress(progress, "failed");
      label.textContent = status.recoverable ? "等待失败恢复" : "安装失败";
    } else if (status.state === "cancelled") {
      setComponentProgress(progress, "pending");
      label.textContent = "安装已取消";
    } else {
      setComponentProgress(progress, "running");
      label.textContent = installationStateLabel(status);
    }
  }
}

function renderScan(result: ScanInstallationResult): void {
  const locations = resultLocations(result);
  element("reuse-size").textContent = formatGiB(result.verifiedReuseGiB);
  element("pending-size").textContent = formatGiB(result.pendingVerificationGiB);
  element("system-windows").textContent = result.system.windows;
  element("system-gpu").textContent = result.system.gpu;
  element("system-memory").textContent = result.system.memory;
  element("system-volume").textContent = result.system.targetVolume;
  setSegmentRecommendation(result.system.vramBytes);
  renderDetectedLocation("comfy", locations.comfyUiRoot, locations.comfySource);
  renderDetectedLocation("model", locations.modelRoot, locations.modelSource);
  installRoot.value = result.installRoot;
  syncInstallationLocationPresentation(locations);
  const componentRows = result.components.map(renderComponent);
  if (locations.comfyUiRoot === null) componentRows.unshift(renderManagedComfyComponent());
  componentList.replaceChildren(...componentRows);
  syncRef2vaAvailability();
  updateDownloadSummary(result);
  locationResults.hidden = false;
  scanActions.hidden = false;
  scanResults.hidden = false;
  scanStateBadge.textContent = "检测完成";
  scanStateBadge.classList.add("status-badge--success");
  setSetupStage("components");
}

function syncInstallationPlanLanguage(result: ScanInstallationResult, totalGiB: number): void {
  const prepareLabel = prepareButton.querySelector<HTMLElement>(".button-label");
  const requiresDownload = totalGiB > 0;
  const requiresVerification = result.pendingVerificationGiB > 0;
  managedRootSection.hidden = !requiresDownload;

  if (requiresDownload) {
    componentsTitle.textContent = "下载与复用计划";
    componentsDescription.textContent = "已有组件保持复用；只下载当前勾选的缺失组件。";
    installationTitle.textContent = "下载并配置缺失组件";
    installationDescription.textContent = "Relay 将按清单下载、校验并配置缺失文件，同时保留已有环境。";
    installationActionTitle.textContent = "配置完成后进入项目界面";
    installationActionNote.textContent = "下载和校验完成前，工作流编译保持锁定。";
    if (prepareLabel !== null) prepareLabel.textContent = "下载并配置所选组件";
    return;
  }

  if (requiresVerification) {
    componentsTitle.textContent = "复用本机环境";
    componentsDescription.textContent = "无需下载；Relay 将校验已发现的文件并保存当前配置。";
    installationTitle.textContent = "校验并保存本机配置";
    installationDescription.textContent = "Relay 将验证现有 ComfyUI、模型和组件，不移动或覆盖外部文件。";
    installationActionTitle.textContent = "校验完成后进入项目界面";
    installationActionNote.textContent = "校验完成前，工作流编译保持锁定。";
    if (prepareLabel !== null) prepareLabel.textContent = "校验并使用此环境";
    return;
  }

  componentsTitle.textContent = "本机环境已准备";
  componentsDescription.textContent = "无需下载或重复安装；确认后直接使用当前已验证环境。";
  installationTitle.textContent = "保存本机配置";
  installationDescription.textContent = "Relay 将记录当前环境位置，不复制外部 ComfyUI 或模型文件。";
  installationActionTitle.textContent = "确认当前环境";
  installationActionNote.textContent = "保存配置后即可编译和交接工作流。";
  if (prepareLabel !== null) prepareLabel.textContent = "使用此环境并继续";
}

function updateDownloadSummary(result: ScanInstallationResult): void {
  const locations = resultLocations(result);
  let totalGiB = locations.comfyUiRoot === null ? 2 : 0;
  for (const component of result.components) {
    if (component.state !== "needs_download" || component.id === "pyav_required") continue;
    const checkbox = componentList.querySelector<HTMLInputElement>(
      `input[name="optionalComponent"][value="${component.id}"]`
    );
    if (component.required || checkbox?.checked === true) totalGiB += component.sizeGiB;
  }
  element("download-size").textContent = `约 ${formatGiB(totalGiB)}`;
  syncInstallationPlanLanguage(result, totalGiB);
}

function setSetupStage(stage: "location" | "components" | "complete"): void {
  const order = ["location", "components", "complete"] as const;
  const stageIndex = order.indexOf(stage);
  for (const [index, name] of order.entries()) {
    const marker = element<HTMLElement>(`setup-marker-${name}`);
    marker.classList.toggle("is-current", index === stageIndex);
    marker.classList.toggle("is-complete", index < stageIndex);
  }
}

function startScanFeedback(): void {
  const startedAt = Date.now();
  scanActivity.hidden = false;
  const update = (): void => {
    const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    scanElapsed.textContent = `已用 ${seconds} 秒`;
    scanActivityTitle.textContent = seconds < 4
      ? "正在读取硬件信息"
      : seconds < 10
        ? "正在定位 ComfyUI 与模型文件"
        : "正在读取硬件 / 定位文件，请稍候";
  };
  update();
  scanTimer = window.setInterval(update, 1000);
}

function stopScanFeedback(): void {
  if (scanTimer !== null) {
    window.clearInterval(scanTimer);
    scanTimer = null;
  }
  scanActivity.hidden = true;
}

function selectedOptionalComponents(): ComponentId[] {
  return [...componentList.querySelectorAll<HTMLInputElement>('input[name="optionalComponent"]:checked')]
    .filter((input) => input.dataset.locked !== "true")
    .filter((input) => input.dataset.componentState !== "verified_reuse")
    .map((input) => input.value as ComponentId);
}

function comparablePath(value: string | null): string {
  return (value ?? "").trim().replace(/[\\/]+$/u, "").toLocaleLowerCase("en-US");
}

function scanPathsStillCurrent(result: ScanInstallationResult): boolean {
  const locations = resultLocations(result);
  return comparablePath(installRoot.value) === comparablePath(result.installRoot)
    && comparablePath(comfyUiRoot.value) === comparablePath(locations.comfyUiRoot)
    && comparablePath(modelRoot.value) === comparablePath(locations.modelRoot);
}

function selectedRadio<T extends string>(name: string): T {
  const input = projectForm.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`);
  if (input === null) throw new Error(`Missing selected ${name}`);
  return input.value as T;
}

function selectedDuration(): DurationSeconds {
  return Number(projectDuration.value) as DurationSeconds;
}

function selectedSegmentDuration(): SegmentDurationSeconds {
  return Number(segmentDuration.value) as SegmentDurationSeconds;
}

function timelineTimestamp(seconds: number): string {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}.000`;
}

const promptDurationOptions = Object.freeze([5, 10, 15, 30, 60] as const);
const promptShotMarker = /[\[［【][\t ]*(?:shot|镜头)[\t ]*[0-9０-９]+[\t ]*[\]］】]/giu;
const promptShotStartClock = /^(?:At|在)[\t ]*(\d{2,3}):(\d{2})(?:\.(\d{1,3}))?(?![\d.])/iu;

function detectedPromptDuration(prompt: string): { readonly shots: number; readonly seconds: DurationSeconds } | null {
  const normalized = prompt.normalize("NFKC");
  const markers = [...normalized.matchAll(promptShotMarker)];
  if (markers.length < 2) return null;
  let maximumCutMilliseconds = 0;
  for (let index = 1; index < markers.length; index += 1) {
    const marker = markers[index];
    const bodyStart = (marker?.index ?? 0) + (marker?.[0].length ?? 0);
    const bodyEnd = markers[index + 1]?.index ?? normalized.length;
    const clock = normalized.slice(bodyStart, bodyEnd).trimStart().match(promptShotStartClock);
    if (clock === null) return null;
    const minutes = Number(clock[1]);
    const seconds = Number(clock[2]);
    const fraction = clock[3] ?? "";
    if (!Number.isSafeInteger(minutes) || !Number.isSafeInteger(seconds) || seconds > 59) return null;
    const milliseconds = fraction.length === 0 ? 0 : Number(fraction.padEnd(3, "0"));
    maximumCutMilliseconds = Math.max(maximumCutMilliseconds, (minutes * 60 + seconds) * 1_000 + milliseconds);
  }
  const recommended = promptDurationOptions.find((seconds) => seconds * 1_000 > maximumCutMilliseconds);
  return recommended === undefined ? null : Object.freeze({ shots: markers.length, seconds: recommended });
}

function syncPromptTimelineAdvice(): void {
  const detected = detectedPromptDuration(projectPrompt.value);
  const current = selectedDuration();
  if (detected === null || current >= detected.seconds) {
    promptTimelineAdvice.hidden = true;
    applyPromptDuration.dataset.duration = "";
    return;
  }
  promptTimelineAdviceText.textContent = `检测到 ${detected.shots} 个带时间线的镜头，当前总时长只有 ${current} 秒；按最后一个镜头切点至少应选择 ${detected.seconds} 秒。`;
  applyPromptDuration.textContent = `改为 ${detected.seconds} 秒`;
  applyPromptDuration.dataset.duration = String(detected.seconds);
  promptTimelineAdvice.hidden = false;
}

function exampleTimeline(totalSeconds: number, segmentSeconds: number, mode: ProjectMode): string {
  const starts: number[] = [];
  for (let start = 0; start < totalSeconds; start += segmentSeconds) starts.push(start);
  return starts.map((start, index) => {
    const boundary = index === 0 ? "" : `在 ${timelineTimestamp(start)}，`;
    const action = mode === "FL2VA"
      ? index === 0
        ? "延续参考帧中的金毛犬、红色领巾和雨后公园环境，镜头低机位缓慢跟拍。"
        : "保持金毛犬外观、红色领巾、光线与运动方向连续，动作自然推进。"
      : mode === "REF2VA"
        ? "<Subject 1> 在雨后公园里追逐蓝色飞盘，保持品种、毛色、体型和红色领巾一致。"
        : index === 0
          ? "一只系着红色领巾的金毛犬在雨后公园里追逐蓝色飞盘，镜头低机位缓慢跟拍。"
          : "同一只金毛犬继续追逐飞盘，外观、红色领巾、场景光线和运动方向保持连续。";
    return `[镜头 ${index + 1}] ${boundary}${action}`;
  }).join("\n");
}

function syncPromptPlaceholder(): void {
  const mode = selectedRadio<ProjectMode>("mode");
  const totalSeconds = selectedDuration();
  const segmentSeconds = selectedSegmentDuration();
  const isMultiSegment = totalSeconds > segmentSeconds;

  if (mode === "T2V" && !isMultiSegment) {
    projectPrompt.placeholder = "例如：一只系着红色领巾的金毛犬在雨后公园里追逐蓝色飞盘，镜头低机位缓慢跟拍，伴随轻风、鸟鸣和湿草地上的脚步声。";
    return;
  }
  if (mode === "REF2VA" && isMultiSegment) {
    projectPrompt.placeholder = "Ref2VA 当前仅支持单段工作流，请将单段时长设为与总时长相同。";
    return;
  }

  const timeline = exampleTimeline(totalSeconds, segmentSeconds, mode);
  projectPrompt.placeholder = mode === "REF2VA"
    ? `主体定义：\n<Subject 1> 由 <Picture 1> 定义，是一只系着红色领巾的金毛犬。\n\n摘要：\n[reference generation] 保持 <Subject 1> 的外观和红色领巾与参考图一致。\n\n保留分析：\n<Subject 1>: fully_preserved - 保留品种、毛色、体型和红色领巾。\n\n详细描述：\n${timeline}\n\n整体声景：\n轻风、远处鸟鸣和脚步掠过湿地的声音。\n\n画外配乐：\n轻快、克制的木吉他旋律。`
    : `综合多模态描述：\n${timeline}\n\n整体声景：\n轻风、远处鸟鸣、爪子掠过湿草地和飞盘划过空气的声音。\n\n画外配乐：\n轻快、克制的木吉他旋律。`;
}

function syncSegmentPlan(): void {
  const totalSeconds = selectedDuration();
  const segmentSeconds = selectedSegmentDuration();
  syncPromptPlaceholder();
  syncPromptTimelineAdvice();
  const fullSegments = Math.floor(totalSeconds / segmentSeconds);
  const tailSeconds = totalSeconds % segmentSeconds;
  const segmentCount = Math.ceil(totalSeconds / segmentSeconds);
  if (tailSeconds === 0) {
    segmentSummary.textContent = `${totalSeconds} 秒总时长 · ${segmentCount} 段 × ${segmentSeconds} 秒`;
    return;
  }
  if (fullSegments === 0) {
    segmentSummary.textContent = `${totalSeconds} 秒总时长 · 1 个尾段 ${tailSeconds} 秒（短于所选单段）`;
    return;
  }
  segmentSummary.textContent = `${totalSeconds} 秒总时长 · ${segmentCount} 段（${fullSegments} × ${segmentSeconds} 秒 + 尾段 ${tailSeconds} 秒）`;
}

function roundHalfEven(value: number): number {
  const lower = Math.floor(value);
  const fraction = value - lower;
  if (Math.abs(fraction - 0.5) < Number.EPSILON * Math.max(1, Math.abs(value)) * 4) {
    return lower % 2 === 0 ? lower : lower + 1;
  }
  return Math.round(value);
}

function syncCanvasSummary(): void {
  const aspectRatio = projectCanvas.value as CanvasPreset;
  const separator = aspectRatio.indexOf(":");
  const ratioWidth = Number(aspectRatio.slice(0, separator));
  const ratioHeight = Number(aspectRatio.slice(separator + 1));
  const megapixels = Number(projectResolution.value);
  const pixelArea = megapixels * (1024 ** 2);
  const width = roundHalfEven(Math.sqrt(pixelArea * ratioWidth / ratioHeight) / 32) * 32;
  const height = roundHalfEven(Math.sqrt(pixelArea * ratioHeight / ratioWidth) / 32) * 32;
  const megapixelLabel = projectResolution.selectedOptions[0]?.textContent?.trim() ?? `${megapixels} MP`;
  canvasSizeSummary.textContent = `${aspectRatio} · ${megapixelLabel} · 约 ${width} × ${height} · 尺寸已对齐`;
}

let directorDraftDirty = false;
let directorDraftRestored = false;
let directorAutosaveTimer: number | null = null;
let directorLastAutosavedAt: string | null = null;

function directorSelectedMode(): DirectorMode {
  return directorMode.value as DirectorMode;
}

function directorSelectedLanguage(): DirectorLanguage {
  return directorLanguage.value as DirectorLanguage;
}

function createDirectorShotId(usedIds = new Set(directorShotIds.values())): string {
  let candidate: string;
  do {
    candidate = `shot-${window.crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
  } while (usedIds.has(candidate));
  return candidate;
}

function rememberDirectorShots(): void {
  for (const card of directorShotList.querySelectorAll<HTMLElement>("[data-director-shot-key]")) {
    const key = card.dataset.directorShotKey;
    if (typeof key !== "string" || key.length === 0) continue;
    const description = card.querySelector<HTMLTextAreaElement>('[data-director-shot-field="description"]');
    const camera = card.querySelector<HTMLTextAreaElement>('[data-director-shot-field="camera"]');
    const sound = card.querySelector<HTMLTextAreaElement>('[data-director-shot-field="sound"]');
    const transition = card.querySelector<HTMLTextAreaElement>('[data-director-shot-field="transition"]');
    if (description !== null) directorShotMemory.set(key, description.value);
    const metadata = directorShotMetadata.get(key);
    if (metadata !== undefined) {
      metadata.cameraLanguage = camera?.value ?? "";
      metadata.soundCue = sound?.value ?? "";
      metadata.transitionNote = transition?.value ?? "";
    }
  }
}

function currentDirectorShots(): readonly DirectorShot[] {
  return [...directorShotList.querySelectorAll<HTMLElement>("[data-director-shot-key]")]
    .map((card): DirectorShot => {
      const key = card.dataset.directorShotKey ?? "";
      const metadata = directorShotMetadata.get(key);
      return Object.freeze({
        id: card.dataset.directorShotId ?? "shot-unassigned",
        startSeconds: Number(card.dataset.directorShotStart),
        durationSeconds: Number(card.dataset.directorShotDuration),
        description: card.querySelector<HTMLTextAreaElement>('[data-director-shot-field="description"]')?.value ?? "",
        cameraLanguage: card.querySelector<HTMLTextAreaElement>('[data-director-shot-field="camera"]')?.value ?? "",
        soundCue: card.querySelector<HTMLTextAreaElement>('[data-director-shot-field="sound"]')?.value ?? "",
        transitionNote: card.querySelector<HTMLTextAreaElement>('[data-director-shot-field="transition"]')?.value ?? ""
      });
    });
}

function collectDirectorDraft(): DirectorDraft {
  const shots = currentDirectorShots();
  const totalDurationSeconds = directorTimelineDuration(shots);
  const representativeSegment = shots[0]?.durationSeconds ?? Number(directorSegmentDuration.value);
  return Object.freeze({
    language: directorSelectedLanguage(),
    mode: directorSelectedMode(),
    totalDurationSeconds,
    segmentDurationSeconds: representativeSegment,
    characterBible: directorCharacterBible.value,
    worldBible: directorWorldBible.value,
    visualStyleBible: directorVisualStyleBible.value,
    continuity: directorContinuity.value,
    shots: Object.freeze(shots),
    overallSoundscape: directorSoundscape.value,
    nonDiegeticMusic: directorMusic.value,
    subjectDefinitions: directorSubjects.value,
    summary: directorSummary.value,
    retentionAnalysis: directorRetention.value,
    styleOpening: directorStyleOpening.value
  });
}

function syncDirectorProductionWorkCopy(): ReturnType<typeof syncDirectorProductionState> {
  const synchronized = syncDirectorProductionState({
    state: directorProductionState,
    workflowName: directorWorkflowName.value,
    draft: collectDirectorDraft(),
    output: {
      canvas: directorCanvas.value,
      resolution: directorResolution.value,
      seed: directorSeed.value,
      seedPolicy: directorSeedPolicy.value as SeedPolicy,
      sampling: directorSampling.value
    }
  });
  directorProductionState = synchronized.state;
  directorP1Ui.setState(directorProductionState);
  return synchronized;
}

type CurrentDirectorProductionView = Readonly<{
  readonly synchronized: ReturnType<typeof syncDirectorProductionState>;
  readonly decorated: ReturnType<typeof decorateDirectorDraftForProduction>;
}>;

function currentDirectorProductionView(): CurrentDirectorProductionView {
  const synchronized = syncDirectorProductionWorkCopy();
  return Object.freeze({
    synchronized,
    decorated: decorateDirectorDraftForProduction(synchronized.state, synchronized.draft)
  });
}

function currentDirectorFrameSnapshotIds(mode = directorSelectedMode() as ProjectMode): DirectorPreparedFrameSelectionIds {
  if (mode === "T2V") {
    return Object.freeze({ firstFrameSelectionId: null, lastFrameSelectionId: null });
  }
  const project = directorProjectForAssetProjection();
  if (project !== null) {
    const projection = buildDirectorAssetProjectionPlan(project, mode);
    if (projection.first !== null || projection.last !== null) {
      const bindingSnapshotId = (entry: DirectorAssetProjectionEntry | null): string | null => entry === null
        ? null
        : `binding:${entry.binding.bindingId}:${entry.binding.assetId}:${entry.binding.purpose}`;
      return Object.freeze({
        firstFrameSelectionId: bindingSnapshotId(projection.first),
        lastFrameSelectionId: bindingSnapshotId(projection.last)
      });
    }
  }
  return Object.freeze({ firstFrameSelectionId: null, lastFrameSelectionId: null });
}

function currentDirectorTechnicalSnapshot(): string {
  const shots = currentDirectorShots();
  const frameSnapshot = currentDirectorFrameSnapshotIds();
  const projectionProject = directorProjectForAssetProjection();
  return JSON.stringify({
    workflowName: directorWorkflowName.value.trim(),
    mode: directorSelectedMode(),
    segmentDurationSeconds: shots[0]?.durationSeconds ?? Number(directorSegmentDuration.value),
    segmentDurationsSeconds: shots.map((shot) => shot.durationSeconds),
    subjectDefinitions: directorSubjects.value,
    summary: directorSummary.value,
    retentionAnalysis: directorRetention.value,
    styleOpening: directorStyleOpening.value,
    canvas: directorCanvas.value,
    resolutionMegapixels: Number(directorResolution.value),
    seed: Number(directorSeed.value),
    seedPolicy: directorSeedPolicy.value,
    samplingProfile: directorSampling.value,
    firstFrameSelectionId: frameSnapshot.firstFrameSelectionId,
    lastFrameSelectionId: frameSnapshot.lastFrameSelectionId,
    assetProjection: projectionProject === null
      ? null
      : directorAssetProjectionSignature(buildDirectorAssetProjectionPlan(
        projectionProject,
        directorSelectedMode()
      ))
  });
}

function currentDirectorCompilationSnapshot(): string {
  const production = currentDirectorProductionView();
  const frameSnapshot = currentDirectorFrameSnapshotIds();
  const project = directorProjectForAssetProjection();
  return JSON.stringify({
    director: directorCompilationSnapshot({
      draft: production.decorated.draft,
      workflowName: directorWorkflowName.value,
      canvas: directorCanvas.value,
      resolutionMegapixels: Number(directorResolution.value),
      seed: Number(directorSeed.value),
      seedPolicy: directorSeedPolicy.value as SeedPolicy,
      samplingProfile: directorSampling.value,
      firstFrameSelectionId: frameSnapshot.firstFrameSelectionId,
      lastFrameSelectionId: frameSnapshot.lastFrameSelectionId
    }),
    assetProjection: project === null
      ? null
      : directorAssetProjectionSignature(buildDirectorAssetProjectionPlan(project, directorSelectedMode())),
    continuityPromptContexts: project === null ? null : serializeDirectorContinuityPromptContexts(project),
    segmentTransitions: project === null ? null : directorSegmentTransitionSnapshot(project)
  });
}

function markDirectorDirty(): void {
  directorDraftDirty = true;
  const context = activeRelayProject === null ? null : captureProjectOperationContext();
  directorStateChip.textContent = "正在自动保存…";
  directorStateChip.classList.remove("status-badge--success");
  if (directorAutosaveTimer !== null) window.clearTimeout(directorAutosaveTimer);
  directorAutosaveTimer = window.setTimeout(() => {
    directorAutosaveTimer = null;
    if (!directorDraftDirty || context === null || !isCurrentProjectOperation(context)) return;
    void saveDirectorDraft(true, true, context).then((saved) => {
      if (!saved || !isCurrentProjectOperation(context)) return;
      directorLastAutosavedAt = new Intl.DateTimeFormat("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
      }).format(new Date());
      directorStateChip.textContent = `已自动保存 · ${directorLastAutosavedAt}`;
      directorStateChip.classList.add("status-badge--success");
    });
  }, 650);
}

function updateDirectorShotStatuses(production = currentDirectorProductionView()): number {
  const draft = production.decorated.draft;
  const technicalCurrent = directorLastCompiledTechnicalSnapshot.length > 0
    && directorLastCompiledTechnicalSnapshot === currentDirectorTechnicalSnapshot();
  let dirtyCount = 0;
  const cards = [...directorShotList.querySelectorAll<HTMLElement>("[data-director-shot-key]")];
  for (const [index, card] of cards.entries()) {
    const shot = draft.shots[index];
    if (shot === undefined) continue;
    const fingerprint = production.decorated.effectiveFingerprints[shot.id ?? ""]
      ?? directorShotFingerprint(draft, shot);
    const compiled = technicalCurrent
      && shot.id !== undefined
      && directorLastCompiledShotFingerprints[shot.id] === fingerprint;
    if (!compiled) dirtyCount += 1;
    card.dataset.compileState = compiled ? "compiled" : "dirty";
    const state = card.querySelector<HTMLElement>("[data-director-shot-status]");
    if (state !== null) {
      state.textContent = compiled ? "已编译" : "待重新编译";
      state.classList.toggle("is-compiled", compiled);
    }
    const timelineSegment = directorTimelineTrack.querySelector<HTMLElement>(`[data-director-shot-index="${index}"]`);
    timelineSegment?.classList.toggle("is-dirty", !compiled);
    timelineSegment?.classList.toggle("is-compiled", compiled);
  }
  return dirtyCount;
}

function selectDirectorShot(
  shotId: string,
  options: {
    readonly focusEditor?: boolean;
    readonly scroll?: boolean;
    readonly productionField?: string;
  } = {}
): boolean {
  const requestedTarget = directorShotList.querySelector<HTMLElement>(
    `[data-director-shot-id="${CSS.escape(shotId)}"]`
  );
  if (requestedTarget === null) return false;

  let workspaceChanged = false;
  if (directorWorkspace !== null) {
    const workspaceProject = directorWorkspace.session.current;
    const selectable = workspaceProject.shots.some((shot) => shot.shotId === shotId && !shot.archived);
    if (!selectable) return false;
    if (workspaceProject.professional.activeShotId !== shotId) {
      directorWorkspace = focusProjectWorkspaceShot(directorWorkspace, {
        shotId,
        updatedAt: new Date().toISOString(),
        createdAtMs: Date.now()
      });
      workspaceChanged = true;
    }
    activeRelayProject = directorWorkspace.session.current;
  }

  const selectedShotId = directorWorkspace?.session.current.professional.activeShotId ?? shotId;
  const target = directorShotList.querySelector<HTMLElement>(
    `[data-director-shot-id="${CSS.escape(selectedShotId)}"]`
  );
  if (target === null) return false;
  directorActiveShotId = selectedShotId;
  for (const card of directorShotList.querySelectorAll<HTMLElement>("[data-director-shot-id]")) {
    const active = card === target;
    card.classList.toggle("is-active", active);
    const toggle = card.querySelector<HTMLButtonElement>(".director-shot-toggle");
    toggle?.setAttribute("aria-expanded", String(active));
    const body = card.querySelector<HTMLElement>(".director-shot-body");
    if (body !== null) {
      body.hidden = !active;
      body.setAttribute("aria-hidden", String(!active));
    }
  }
  for (const item of directorTimelineTrack.querySelectorAll<HTMLButtonElement>("[data-director-shot-id]")) {
    const active = item.dataset.directorShotId === selectedShotId;
    item.classList.toggle("is-active", active);
    item.setAttribute("aria-pressed", String(active));
  }
  if (options.productionField === undefined) directorP1Ui.setActiveShot(selectedShotId);
  else directorP1Ui.focusField(selectedShotId, options.productionField);
  renderDirectorWorkspaceControls();
  if (workspaceChanged) scheduleDirectorWorkspaceAutosave();
  if (options.scroll === true) {
    target.scrollIntoView({ behavior: preferredScrollBehavior(), block: "center" });
  }
  if (options.focusEditor === true) {
    target.querySelector<HTMLTextAreaElement>(".director-shot-description")?.focus({ preventScroll: true });
  }
  return true;
}

function renderDirectorTimeline(plan: readonly DirectorShot[]): void {
  directorTimelineTrack.replaceChildren();
  for (const [index, segment] of plan.entries()) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "director-timeline__segment";
    item.dataset.directorShotIndex = String(index);
    if (segment.id !== undefined) item.dataset.directorShotId = segment.id;
    item.setAttribute("aria-pressed", "false");
    item.style.flexGrow = String(segment.durationSeconds);
    item.title = `定位到镜头 ${index + 1}`;
    const number = document.createElement("b");
    number.textContent = String(index + 1).padStart(2, "0");
    const time = document.createElement("small");
    time.textContent = `${directorClock(segment.startSeconds)} · ${segment.durationSeconds}s`;
    item.append(number, time);
    item.addEventListener("click", () => {
      if (segment.id !== undefined) selectDirectorShot(segment.id, { focusEditor: true, scroll: true });
    });
    directorTimelineTrack.append(item);
  }
}

function renderDirectorShots(planOverride?: readonly DirectorShot[]): void {
  rememberDirectorShots();
  const requestedTotal = Number(directorTotalDuration.value);
  const segment = Number(directorSegmentDuration.value);
  const mode = directorSelectedMode();
  const workspacePlan = directorWorkspace === null
    ? null
    : directorProjectPlan(directorWorkspace.session.current);
  const authoritativeSource = workspacePlan !== null || planOverride !== undefined;
  const plan = workspacePlan
    ?? (planOverride === undefined
      ? directorSegmentPlan(requestedTotal, segment)
      : Object.freeze(planOverride.map((shot) => Object.freeze({ ...shot }))));
  const total = directorTimelineDuration(plan);
  directorShotList.replaceChildren();
  for (const [index, shot] of plan.entries()) {
    const memoryKey = directorShotMemoryKey(mode, total, shot.durationSeconds, shot.startSeconds, shot.durationSeconds);
    const identityKey = directorShotIdentityKey(mode, shot.durationSeconds, shot.startSeconds, shot.durationSeconds);
    let shotId = shot.id ?? directorShotIds.get(identityKey);
    if (shotId === undefined) {
      shotId = createDirectorShotId();
    }
    directorShotIds.set(identityKey, shotId);
    let metadata = directorShotMetadata.get(memoryKey);
    if (metadata === undefined) {
      metadata = {
        cameraLanguage: shot.cameraLanguage ?? "",
        soundCue: shot.soundCue ?? "",
        transitionNote: shot.transitionNote ?? ""
      };
      directorShotMetadata.set(memoryKey, metadata);
    }
    if (authoritativeSource) {
      directorShotMemory.set(memoryKey, shot.description);
      metadata.cameraLanguage = shot.cameraLanguage ?? "";
      metadata.soundCue = shot.soundCue ?? "";
      metadata.transitionNote = shot.transitionNote ?? "";
    }
    const article = document.createElement("article");
    article.className = "director-shot-card";
    article.dataset.directorShotKey = memoryKey;
    article.dataset.directorShotId = shotId;
    article.dataset.directorShotStart = String(shot.startSeconds);
    article.dataset.directorShotDuration = String(shot.durationSeconds);
    const header = document.createElement("button");
    header.type = "button";
    header.className = "director-shot-toggle";
    header.setAttribute("aria-expanded", "false");
    const identity = document.createElement("div");
    const number = document.createElement("span");
    number.className = "director-shot-number";
    number.textContent = String(index + 1).padStart(2, "0");
    const title = document.createElement("span");
    const strong = document.createElement("strong");
    strong.textContent = `镜头 ${index + 1}`;
    const clock = document.createElement("small");
    clock.textContent = index === 0 ? "从 00:00.000 开始" : `从 ${directorClock(shot.startSeconds)} 开始`;
    title.append(strong, clock);
    identity.append(number, title);
    const state = document.createElement("div");
    state.className = "director-shot-state";
    const duration = document.createElement("span");
    duration.className = "director-shot-duration";
    duration.textContent = `${shot.durationSeconds} 秒`;
    const compileState = document.createElement("span");
    compileState.className = "director-shot-fingerprint";
    compileState.dataset.directorShotStatus = "true";
    state.append(duration, compileState);
    header.append(identity, state);
    const body = document.createElement("div");
    body.className = "director-shot-body";
    body.id = `director-shot-body-${shotId}`;
    body.hidden = true;
    body.setAttribute("aria-hidden", "true");
    header.setAttribute("aria-controls", body.id);
    const label = document.createElement("label");
    label.className = "sr-only";
    label.htmlFor = `director-shot-${shotId}`;
    label.textContent = `镜头 ${index + 1} 内容`;
    const textarea = document.createElement("textarea");
    textarea.id = `director-shot-${shotId}`;
    textarea.className = "director-shot-description";
    textarea.rows = 5;
    textarea.dataset.directorShotField = "description";
    textarea.value = authoritativeSource ? shot.description : directorShotMemory.get(memoryKey) ?? "";
    textarea.placeholder = index === 0
      ? "填写开场画面、主体动作、摄影机运动与当前声音。"
      : "填写这一段的新动作与镜头变化；需要延续的内容请明确写出。";
    textarea.addEventListener("input", () => {
      directorShotMemory.set(memoryKey, textarea.value);
      if (directorWorkspace !== null) {
        applyDirectorWorkspaceMutation("修改镜头内容", (project) => ({
          ...project,
          updatedAt: new Date().toISOString(),
          shots: project.shots.map((candidate) => candidate.shotId === shotId
            ? { ...candidate, prompt: textarea.value }
            : candidate)
        }), { autosave: false, rerenderControls: false });
      }
      markDirectorDirty();
      if (directorWorkspace === null) updateDirectorPreview();
    });
    const notes = document.createElement("details");
    notes.className = "director-shot-notes";
    const summary = document.createElement("summary");
    summary.textContent = "镜头语言、声音与转场（可选）";
    const fields = document.createElement("div");
    fields.className = "director-shot-notes__grid";
    const makeField = (
      field: "camera" | "sound" | "transition",
      fieldLabel: string,
      value: string,
      placeholder: string
    ): HTMLLabelElement => {
      const wrapper = document.createElement("label");
      wrapper.className = "field";
      const caption = document.createElement("span");
      caption.className = "field-label";
      caption.textContent = fieldLabel;
      const input = document.createElement("textarea");
      input.rows = 2;
      input.dataset.directorShotField = field;
      input.value = value;
      input.placeholder = placeholder;
      input.addEventListener("input", () => {
        if (field === "camera") metadata!.cameraLanguage = input.value;
        if (field === "sound") metadata!.soundCue = input.value;
        if (field === "transition") metadata!.transitionNote = input.value;
        if (directorWorkspace !== null && field !== "transition") {
          applyDirectorWorkspaceMutation(`修改镜头${field === "camera" ? "语言" : "声音"}`, (project) => ({
            ...project,
            updatedAt: new Date().toISOString(),
            shots: project.shots.map((candidate) => candidate.shotId === shotId
              ? { ...candidate, [field === "camera" ? "camera" : "sound"]: input.value }
              : candidate)
          }), { autosave: false, rerenderControls: false });
        }
        markDirectorDirty();
        if (directorWorkspace === null || field === "transition") updateDirectorPreview();
      });
      wrapper.append(caption, input);
      return wrapper;
    };
    fields.append(
      makeField("camera", "镜头语言", metadata.cameraLanguage, "例如：低机位缓慢推进；可留空。"),
      makeField("sound", "声音提示", metadata.soundCue, "只写本镜头独有的声音变化；可留空。"),
      makeField("transition", "转场 / 连续性备注", metadata.transitionNote, "例如：动作匹配切到下一镜；可留空。")
    );
    notes.append(summary, fields);
    body.append(label, textarea, notes);
    article.append(header, body);
    header.addEventListener("click", () => selectDirectorShot(shotId!, { focusEditor: true }));
    directorShotList.append(article);
  }
  directorShotCount.textContent = `${plan.length} 个镜头`;
  const uniformDuration = plan.length > 0 && plan.every((shot) => shot.durationSeconds === plan[0]?.durationSeconds)
    ? plan[0]!.durationSeconds
    : null;
  const durationSummary = plan.map((shot) => `${shot.durationSeconds} 秒`).join(" + ");
  directorSegmentSummary.textContent = uniformDuration === null
    ? `${total} 秒 · ${plan.length} 段 · ${durationSummary}`
    : `${total} 秒 · ${plan.length} 段 × ${uniformDuration} 秒`;
  const renderedShots = currentDirectorShots();
  renderDirectorTimeline(renderedShots);
  const currentIds = new Set(renderedShots.flatMap((shot) => shot.id === undefined ? [] : [shot.id]));
  const preferredActiveShotId = authoritativeDirectorShotId();
  const nextActive = preferredActiveShotId !== null && currentIds.has(preferredActiveShotId)
    ? preferredActiveShotId
    : renderedShots[0]?.id ?? null;
  if (nextActive !== null) selectDirectorShot(nextActive);
  else {
    directorActiveShotId = null;
    directorP1Ui.setActiveShot(null);
    renderDirectorWorkspaceControls();
  }
  if (!authoritativeSource) syncDirectorProductionWorkCopy();
}

function directorTimelineSignature(shots: readonly DirectorShot[]): string {
  return shots.map((shot) => `${shot.id ?? ""}:${shot.startSeconds}:${shot.durationSeconds}`).join("|");
}

function reconcileDirectorTimelineFromProduction(state: DirectorProductionState): void {
  const productionShots = activeShotsForP1(state);
  if (directorWorkspace !== null) {
    const authoritativeShots = directorProjectPlan(directorWorkspace.session.current);
    if (directorTimelineSignature(authoritativeShots) !== directorTimelineSignature(currentDirectorShots())) {
      renderDirectorShots(authoritativeShots);
    }
    syncDirectorProductionWorkCopy();
    directorP1Ui.setActiveShot(directorWorkspace.session.current.professional.activeShotId);
    return;
  }
  if (directorTimelineSignature(productionShots) === directorTimelineSignature(currentDirectorShots())) return;
  renderDirectorShots(productionShots);
}

function directorValidationErrors(
  production = currentDirectorProductionView()
): { readonly prompt: string; readonly errors: readonly string[] } {
  const project = directorProjectForAssetProjection();
  const previewDraft = project === null
    ? production.decorated.draft
    : directorDraftWithContinuityPromptContexts(production.decorated.draft, project);
  const result = serializeDirectorPrompt(previewDraft);
  const errors = [...result.errors];
  for (const issue of validateProductionContinuity(production.synchronized.state)) errors.push(issue.message);
  if (directorWorkspace !== null) {
    for (const issue of validateDirectorContinuity(directorWorkspace.session.current)) errors.push(issue.message);
  }
  // Current project bindings are validated by their real graph disposition
  // below. The legacy Production view has no purpose/disposition field, so it
  // is only used as a fail-closed fallback when no authoritative project is
  // available; otherwise it would incorrectly block record-only relationships.
  if (project === null) {
    const state = production.synchronized.state;
    const assetById = new Map(state.assets.map((asset) => [asset.id, asset]));
    for (const binding of state.bindings) {
      if (binding.archived) continue;
      const asset = assetById.get(binding.assetId);
      if (asset === undefined || asset.archived || asset.missing) {
        errors.push(`素材绑定 ${binding.id} 当前不可用；请在素材库重新定位后再编译。`);
      }
    }
  }
  const name = validateWorkflowName(directorWorkflowName.value);
  if (!name.ok) errors.unshift(name.message);
  const mode = directorSelectedMode();
  if (mode === "REF2VA" && !ref2vaIsReady()) errors.push("Ref2VA 模型包尚未安装并验证。");
  const projection = project === null ? null : buildDirectorAssetProjectionPlan(project, mode);
  if (project !== null && projection !== null) {
    for (const error of projection.errors) {
      if (!errors.includes(error)) errors.push(error);
    }
    for (const issue of directorTransitionProjectionIssues(project)) {
      if (!errors.includes(issue)) errors.push(issue);
    }
  }
  const effectiveFirstFrame = projection?.first !== null && projection?.first !== undefined;
  const effectiveLastFrame = projection?.last !== null && projection?.last !== undefined;
  const frameIssue = requireFrames(mode, effectiveFirstFrame, effectiveLastFrame);
  if (frameIssue !== null) errors.push(frameIssue);
  if (mode === "REF2VA" && effectiveFirstFrame && effectiveLastFrame) {
    const prompt = result.prompt;
    if (!prompt.includes("<Picture 2>")) {
      errors.push("已选择参考图 2，但提示词没有声明或使用 <Picture 2>；请修正主体定义或取消第二张图片。");
    }
  }
  const seed = Number(directorSeed.value);
  if (directorSeedPolicy.value === "fixed" && (!Number.isSafeInteger(seed) || seed < 0)) {
    errors.push("固定种子必须是有效的非负整数。");
  }
  return Object.freeze({ prompt: result.prompt, errors: Object.freeze(errors) });
}

function focusDirectorField(target: HTMLElement): void {
  const drawerPanel = target.closest<HTMLElement>("[data-director-drawer-panel]");
  if (drawerPanel !== null) {
    openDirectorDrawer(drawerPanel.dataset.directorDrawerPanel as DirectorDrawerTab, directorCheckButton);
  }
  const details = target.closest<HTMLDetailsElement>("details");
  if (details !== null) details.open = true;
  target.scrollIntoView({ behavior: preferredScrollBehavior(), block: "center" });
  target.focus({ preventScroll: true });
}

function locateDirectorValidationError(message: string): void {
  const workspaceIssue = directorWorkspace?.issues.find((issue) => issue.message === message);
  if (workspaceIssue !== undefined && directorWorkspace !== null) {
    try {
      directorWorkspace = locateProjectWorkspaceField(directorWorkspace, workspaceIssue.locator);
      const shotId = directorWorkspace.focusedLocation?.shotId;
      if (shotId !== null && shotId !== undefined) selectDirectorShot(shotId, { scroll: true });
      else renderDirectorWorkspaceControls();
      if (workspaceIssue.field === "transition") {
        openDirectorDrawer("transition", directorCheckButton);
        focusDirectorField(workspaceIssue.locator.endsWith(":asset")
          ? directorShotTransitionAsset
          : directorShotTransitionKind);
      } else {
        openDirectorDrawer("details", directorCheckButton);
        const target = directorContinuityInputs.get(continuityInputKey("start", workspaceIssue.field));
        if (target !== undefined) focusDirectorField(target);
      }
      return;
    } catch (error) {
      showFeedback({ kind: "error", title: "无法定位检查项", message: publicError(error) });
      return;
    }
  }
  const continuityIssue = validateProductionContinuity(directorProductionState)
    .find((issue) => issue.message === message);
  if (continuityIssue !== undefined) {
    selectDirectorShot(continuityIssue.shotId, {
      scroll: true,
      productionField: continuityIssue.dimension
    });
    return;
  }
  if (message.includes("素材绑定") || message.includes("素材库")) {
    showView("assets");
    return;
  }
  const shotMatch = message.match(/(?:镜头|shot)\s*(\d+)/iu);
  if (shotMatch !== null) {
    const index = Number(shotMatch[1]) - 1;
    const shot = currentDirectorShots()[index];
    if (shot?.id !== undefined) {
      selectDirectorShot(shot.id, { focusEditor: true, scroll: true });
      return;
    }
  }
  if (message.includes("名称")) return focusDirectorField(directorWorkflowName);
  if (message.includes("种子")) return focusDirectorField(directorSeed);
  if (message.includes("首帧") || message.includes("尾帧") || message.includes("参考图")) {
    directorFrameControls.scrollIntoView({ behavior: preferredScrollBehavior(), block: "center" });
    const projectionProject = directorProjectForAssetProjection();
    const projection = projectionProject === null
      ? null
      : buildDirectorAssetProjectionPlan(projectionProject, directorSelectedMode());
    const focusFirst = message.includes("首帧")
      || message.includes("参考图 1")
      || (projection?.first === null || projection?.first === undefined);
    (focusFirst ? directorFirstFrameButton : directorLastFrameButton).focus({ preventScroll: true });
    return;
  }
  if (message.includes("主体")) return focusDirectorField(directorSubjects);
  if (message.includes("摘要")) return focusDirectorField(directorSummary);
  if (message.includes("保留")) return focusDirectorField(directorRetention);
  if (message.includes("开场")) return focusDirectorField(directorStyleOpening);
  if (message.includes("声景") || message.includes("声音")) return focusDirectorField(directorSoundscape);
  if (message.includes("配乐") || message.includes("音乐")) return focusDirectorField(directorMusic);
  if (message.includes("连续")) return focusDirectorField(directorContinuity);
  const firstShot = currentDirectorShots()[0];
  if (firstShot?.id !== undefined) {
    selectDirectorShot(firstShot.id, { focusEditor: true, scroll: true });
  }
}

function updateDirectorPreview(): void {
  const production = currentDirectorProductionView();
  const result = directorValidationErrors(production);
  const dirtyShotCount = updateDirectorShotStatuses(production);
  directorPromptPreview.textContent = result.prompt;
  directorPromptCount.textContent = `${result.prompt.length} / 4000`;
  directorPromptCount.classList.toggle("is-over", result.prompt.length > 4000);
  directorCheckLabel.textContent = result.errors.length === 0 ? "检查通过" : `${result.errors.length} 项待处理`;
  directorCheckButton.dataset.state = result.errors.length === 0 ? "ready" : "attention";
  directorCheckButton.setAttribute("aria-label", result.errors.length === 0
    ? "打开编译检查，当前检查通过"
    : `打开编译检查，当前有 ${result.errors.length} 项待处理`);
  directorValidation.replaceChildren();
  if (result.errors.length === 0) {
    const ready = document.createElement("p");
    ready.className = "director-validation__ready";
    ready.textContent = "结构检查通过，可以交给现有工作流编译器。";
    directorValidation.append(ready);
  } else {
    const heading = document.createElement("strong");
    heading.textContent = `还有 ${result.errors.length} 项需要处理`;
    const list = document.createElement("ul");
    for (const error of result.errors) {
      const item = document.createElement("li");
      const locate = document.createElement("button");
      locate.type = "button";
      locate.className = "director-validation__locator";
      locate.textContent = error;
      locate.title = "定位到需要处理的位置";
      locate.addEventListener("click", () => locateDirectorValidationError(error));
      item.append(locate);
      list.append(item);
    }
    directorValidation.append(heading, list);
  }
  syncDirectorCompileButtonState();
  if (directorDraftDirty) {
    directorStateChip.textContent = directorAutosaveTimer !== null
      ? "正在自动保存…"
      : result.errors.length === 0
        ? `有未保存更改 · ${dirtyShotCount} 段待重新编译`
        : `有未保存更改 · 缺 ${result.errors.length} 项`;
  } else if (dirtyShotCount > 0) {
    directorStateChip.textContent = directorLastAutosavedAt === null
      ? `${dirtyShotCount} 段待重新编译`
      : `已自动保存 · ${directorLastAutosavedAt} · ${dirtyShotCount} 段待编译`;
    directorStateChip.classList.remove("status-badge--success");
  } else {
    directorStateChip.textContent = "已编译 · 无待处理变更";
    directorStateChip.classList.add("status-badge--success");
  }
}

function syncDirectorFrames(): void {
  const mode = directorSelectedMode();
  const project = directorProjectForAssetProjection();
  const projection = project === null ? null : buildDirectorAssetProjectionPlan(project, mode);
  directorFirstFrameName.textContent = projection?.first?.asset?.displayName ?? "未选择文件";
  directorLastFrameName.textContent = projection?.last?.asset?.displayName ?? "未选择文件";
  directorFrameControls.hidden = mode === "T2V";
  const referenceMode = mode === "REF2VA";
  directorFirstFrameLabel.textContent = referenceMode ? "参考图 1" : "首帧";
  directorLastFrameLabel.textContent = referenceMode ? "参考图 2（可选）" : "尾帧";
  directorClearFirstFrameButton.disabled = projection?.first === null || projection?.first === undefined;
  directorClearLastFrameButton.disabled = projection?.last === null || projection?.last === undefined;
  directorOpenRefInstallButton.hidden = !referenceMode || ref2vaIsReady();
}

function selectedDirectorSegmentDuration(): RelayShotDurationSeconds {
  const value = Number(directorSegmentDuration.value);
  if (value !== 5 && value !== 10 && value !== 15) {
    throw new RangeError("统一分段时长必须是 5、10 或 15 秒。");
  }
  return value;
}

function materializeDirectorPlanFromControls(label: string): void {
  if (directorWorkspace === null) {
    renderDirectorShots();
    return;
  }
  rememberDirectorShots();
  const seedShots = currentDirectorShots();
  applyDirectorWorkspaceMutation(label, (project) => materializeDirectorSegmentPlan(project, {
    mode: directorSelectedMode(),
    totalDurationSeconds: Number(directorTotalDuration.value),
    segmentDurationSeconds: selectedDirectorSegmentDuration(),
    updatedAt: new Date().toISOString(),
    seedShots
  }), { rerenderTimeline: true });
}

function syncDirectorMode(preserveProductionTimeline = false): void {
  const mode = directorSelectedMode();
  const referenceMode = mode === "REF2VA";
  directorRefFields.hidden = !referenceMode;
  syncDirectorFrames();
  for (const option of directorTotalDuration.options) {
    option.disabled = referenceMode && Number(option.value) > 15;
  }
  if (referenceMode && Number(directorTotalDuration.value) > 15) directorTotalDuration.value = "15";
  for (const option of directorSegmentDuration.options) {
    option.disabled = referenceMode && option.value !== directorTotalDuration.value;
  }
  if (referenceMode) directorSegmentDuration.value = directorTotalDuration.value;
  const turbo = directorSampling.querySelector<HTMLOptionElement>('option[value="turbo_8"]');
  if (turbo !== null) turbo.disabled = referenceMode;
  if (referenceMode && directorSampling.value === "turbo_8") directorSampling.value = "quality_20";
  if (directorWorkspace !== null && !preserveProductionTimeline) {
    materializeDirectorPlanFromControls("修改统一分段计划");
    updateDirectorPreview();
    return;
  }
  const productionTimeline = preserveProductionTimeline ? activeShotsForP1(directorProductionState) : undefined;
  // A fresh Production State intentionally has no scenes yet. Treating its
  // empty active-shot list as an explicit timeline would erase the quick-plan
  // cards, then immediately fail the strict total-duration invariant during
  // renderer bootstrap. Only a non-empty persisted timeline may override the
  // current quick-plan controls.
  renderDirectorShots(productionTimeline !== undefined && productionTimeline.length > 0
    ? productionTimeline
    : undefined);
  updateDirectorPreview();
}

function syncDirectorRefAvailability(): void {
  const option = directorMode.querySelector<HTMLOptionElement>('option[value="REF2VA"]');
  if (option !== null) {
    option.disabled = false;
    option.textContent = ref2vaIsReady()
      ? "参考图片生成视频 · Ref2VA（已准备）"
      : "参考图片生成视频 · Ref2VA（需安装模型包）";
  }
  syncDirectorMode(true);
}

async function saveDirectorDraft(
  silent = false,
  clearDirty = true,
  requestedContext?: ProjectOperationContext
): Promise<boolean> {
  const reportFeedback = feedbackForScope();
  const context = requestedContext
    ?? (activeRelayProject === null ? null : captureProjectOperationContext());
  try {
    if (activeRelayProject === null || context === null) throw new Error("请先打开一个 Relay 项目。");
    requireCurrentProjectOperation(context);
    rememberDirectorShots();
    const synchronized = syncDirectorProductionWorkCopy();
    const payload = buildDirectorV7Payload({
      workflowName: directorWorkflowName.value,
      draft: synchronized.draft,
      state: synchronized.state,
      lastCompiledShotFingerprints: directorLastCompiledShotFingerprints,
      passthrough: {
        lastCompiledSnapshot: directorLastCompiledSnapshot,
        lastCompiledTechnicalSnapshot: directorLastCompiledTechnicalSnapshot,
        canvas: directorCanvas.value,
        resolution: directorResolution.value,
        seed: directorSeed.value,
        seedPolicy: directorSeedPolicy.value,
        sampling: directorSampling.value,
        shotIds: [...directorShotIds.entries()].map(([key, id]) => ({ key, id })),
        shotMemory: [...directorShotMemory.entries()].map(([key, description]) => ({
          key,
          description,
          ...directorShotMetadata.get(key)
        }))
      }
    });
    const workspaceProject = directorWorkspace?.session.current;
    if (workspaceProject !== undefined && workspaceProject.projectId !== activeRelayProject.projectId) {
      throw new Error("专业导播工作区与当前项目不一致；本次保存已取消。");
    }
    const authoritativeActiveShotId = workspaceProject?.professional.activeShotId
      ?? activeRelayProject.professional.activeShotId;
    const projectForSave = projectWithReconciledDirectorActiveShot(activeRelayProject, authoritativeActiveShotId);
    const metadata = readProfessionalDirectorMetadata(projectForSave);
    const pendingShotIdMap = directorLegacyShotIdMap;
    const reconciledMetadata = {
      ...metadata,
      takes: metadata.takes.map((take) => ({
        ...take,
        shotId: pendingShotIdMap[take.shotId] ?? take.shotId
      }))
    };
    const jsonPayload = JSON.parse(JSON.stringify(payload)) as JsonValue;
    const nextProject: RelayProjectDocument = {
      ...projectForSave,
      editorMode: "professional",
      updatedAt: new Date().toISOString(),
      professional: {
        ...projectForSave.professional,
        activeShotId: authoritativeActiveShotId,
        directorState: JSON.parse(JSON.stringify({
          ...reconciledMetadata,
          preservedLegacyDirectorState: jsonPayload
        })) as JsonValue
      }
    };
    const savedProject = await persistRelayProject(nextProject);
    requireCurrentProjectOperation(context);
    if (directorWorkspace !== null) {
      directorWorkspace = synchronizeWorkspaceProfessionalMetadata(directorWorkspace, savedProject);
    }
    if (directorLegacyShotIdMap === pendingShotIdMap) directorLegacyShotIdMap = Object.freeze({});
    if (clearDirty) directorDraftDirty = false;
    updateDirectorPreview();
    if (!silent) {
      reportFeedback({
        kind: "success",
        title: "专业导播草稿已保存",
        message: "镜头文本、制作数据和编排参数已写入当前项目 project.relay.json。"
      });
    }
    return true;
  } catch (error) {
    if (error instanceof ProjectOperationSupersededError
      || (context !== null && !isCurrentProjectOperation(context))) return false;
    directorStateChip.textContent = "自动保存失败";
    directorStateChip.classList.remove("status-badge--success");
    if (!silent) reportFeedback({ kind: "error", title: "草稿未保存", message: publicError(error) });
    return false;
  }
}

function assertDirectorAssetPreparationContext(input: {
  readonly projectId: string;
  readonly activationEpoch: number;
  readonly projectionSignature: string;
  readonly mode: ProjectMode;
}): RelayProjectDocument {
  const current = directorProjectForAssetProjection();
  if (activeProjectActivationEpoch !== input.activationEpoch
    || activeRelayProject?.projectId !== input.projectId
    || current?.projectId !== input.projectId) {
    throw new Error("准备镜头素材期间项目已经切换；本次编译已取消，请在当前项目重新点击编译。");
  }
  if (directorSelectedMode() !== input.mode) {
    throw new Error("准备镜头素材期间工作流模式已经变化；本次编译已取消，请确认模式后重新点击编译。");
  }
  const currentSignature = directorAssetProjectionSignature(buildDirectorAssetProjectionPlan(current, input.mode));
  if (currentSignature !== input.projectionSignature) {
    throw new Error("准备镜头素材期间素材绑定已经变化；本次编译已取消，请确认绑定后重新点击编译。");
  }
  return current;
}

async function prepareDirectorCompilationFrames(input: {
  readonly projectId: string;
  readonly activationEpoch: number;
}): Promise<DirectorPreparedFrameSelectionIds> {
  const project = directorProjectForAssetProjection();
  if (project === null || project.projectId !== input.projectId) {
    throw new Error("当前专业项目不可用，请重新打开项目后再编译。");
  }
  const mode = directorSelectedMode() as ProjectMode;
  if (mode === "T2V") return Object.freeze({ firstFrameSelectionId: null, lastFrameSelectionId: null });
  const projection = buildDirectorAssetProjectionPlan(project, mode);
  if (projection.errors.length > 0) throw new Error(projection.errors.join("\n"));
  if (projection.first === null && projection.last === null) {
    return Object.freeze({ firstFrameSelectionId: null, lastFrameSelectionId: null });
  }
  const context = {
    projectId: input.projectId,
    activationEpoch: input.activationEpoch,
    projectionSignature: directorAssetProjectionSignature(projection),
    mode
  } as const;
  const prepare = async (
    entry: DirectorAssetProjectionEntry | null,
    slot: DirectorAssetProjectionSlot
  ): Promise<FrameSelection | null> => {
    if (entry === null || entry.asset === null) return null;
    assertDirectorAssetPreparationContext(context);
    try {
      const selection = await window.controlPlane.prepareProjectAssetFrame({
        projectId: input.projectId,
        assetId: entry.asset.assetId,
        slot
      });
      assertDirectorAssetPreparationContext(context);
      return selection;
    } catch (error) {
      throw new Error(`${entry.asset.displayName} 未能准备为${slot === "first" ? "首张" : "第二张"}工作流图片：${publicError(error)}`);
    }
  };
  const preparedFirst = await prepare(projection.first, "first");
  const preparedLast = await prepare(projection.last, "last");
  assertDirectorAssetPreparationContext(context);
  return Object.freeze({
    firstFrameSelectionId: preparedFirst?.selectionId ?? null,
    lastFrameSelectionId: preparedLast?.selectionId ?? null
  });
}

function directorDraftWithContinuityPromptContexts(
  draft: DirectorDraft,
  project: RelayProjectDocument
): DirectorDraft {
  const contexts = serializeDirectorContinuityPromptContexts(project);
  const contextByShotId = new Map(contexts.map((context) => [context.shotId, context.promptContext]));
  const draftShotIds = new Set(draft.shots.map((shot) => shot.id));
  const projectShotIds = new Set(directorOrderedShotIds(project));
  if (draftShotIds.size !== projectShotIds.size
    || [...draftShotIds].some((shotId) => shotId === undefined || !projectShotIds.has(shotId))) {
    throw new Error("专业导播镜头与连续性状态不同步；请重新载入项目后再编译。");
  }
  return Object.freeze({
    ...draft,
    shots: Object.freeze(draft.shots.map((shot) => {
      const promptContext = shot.id === undefined ? "" : contextByShotId.get(shot.id) ?? "";
      if (promptContext.length === 0) return shot;
      return Object.freeze({
        ...shot,
        description: [shot.description.trimEnd(), promptContext].filter((value) => value.length > 0).join("\n\n")
      });
    }))
  });
}

function captureDirectorCompilation(preparedFrames: DirectorPreparedFrameSelectionIds): DirectorPendingCompilation {
  if (activeRelayProject === null) throw new Error("请先打开一个 Relay 项目。");
  const authoritativeProject = directorProjectForAssetProjection();
  if (authoritativeProject === null || authoritativeProject.projectId !== activeRelayProject.projectId) {
    throw new Error("专业导播权威项目状态不可用，请重新打开项目后再编译。");
  }
  const synchronized = syncDirectorProductionWorkCopy();
  const submission = captureDirectorP1Submission({
    state: synchronized.state,
    workflowName: directorWorkflowName.value,
    draft: synchronized.draft,
    output: {
      canvas: directorCanvas.value,
      resolution: directorResolution.value,
      seed: directorSeed.value,
      seedPolicy: directorSeedPolicy.value as SeedPolicy,
      sampling: directorSampling.value
    }
  });
  const compilationDraft = directorDraftWithContinuityPromptContexts(submission.effectiveDraft, authoritativeProject);
  const promptResult = serializeDirectorPrompt(compilationDraft);
  if (promptResult.errors.length > 0) {
    throw new Error(promptResult.errors.join("\n"));
  }
  const sequence = ++directorCompilationSequence;
  directorLatestSubmittedSequence = sequence;
  const segmentDurationsSeconds = Object.freeze(
    submission.effectiveDraft.shots.map((shot) => shot.durationSeconds as SegmentDurationSeconds)
  );
  const totalDurationSeconds = submission.effectiveDraft.shots.reduce(
    (total, shot) => total + shot.durationSeconds,
    0
  ) as DurationSeconds;
  const mode = submission.effectiveDraft.mode as ProjectMode;
  const segmentTransitions = captureDirectorSegmentTransitions(authoritativeProject);
  const frameSnapshot = currentDirectorFrameSnapshotIds(mode);
  const project: ProjectSpec = Object.freeze({
    prompt: promptResult.prompt,
    mode,
    firstFrameSelectionId: mode === "T2V" ? null : preparedFrames.firstFrameSelectionId,
    lastFrameSelectionId: mode === "T2V" ? null : preparedFrames.lastFrameSelectionId,
    durationSeconds: totalDurationSeconds,
    segmentDurationSeconds: segmentDurationsSeconds[0] ?? (Number(directorSegmentDuration.value) as SegmentDurationSeconds),
    segmentDurationsSeconds,
    segmentShotIds: Object.freeze(submission.effectiveDraft.shots.map((shot) => {
      if (shot.id === undefined) throw new Error("专业导播镜头缺少稳定 ID，无法建立可复现种子计划。");
      return shot.id;
    })),
    segmentTransitions,
    canvas: directorCanvas.value as CanvasPreset,
    resolutionMegapixels: Number(directorResolution.value),
    advanced: Object.freeze({
      seed: Number(directorSeed.value),
      seedPolicy: directorSeedPolicy.value as SeedPolicy,
      samplingProfile: directorSampling.value as SamplingProfile
    })
  });
  return Object.freeze({
    sequence,
    projectId: activeRelayProject.projectId,
    activationEpoch: activeProjectActivationEpoch,
    workflowName: directorWorkflowName.value.trim(),
    project,
    compilationSnapshot: JSON.stringify({
      director: directorCompilationSnapshot({
        draft: submission.effectiveDraft,
        workflowName: directorWorkflowName.value,
        canvas: directorCanvas.value,
        resolutionMegapixels: Number(directorResolution.value),
        seed: Number(directorSeed.value),
        seedPolicy: directorSeedPolicy.value as SeedPolicy,
        samplingProfile: directorSampling.value,
        firstFrameSelectionId: frameSnapshot.firstFrameSelectionId,
        lastFrameSelectionId: frameSnapshot.lastFrameSelectionId
      }),
      assetProjection: directorAssetProjectionSignature(buildDirectorAssetProjectionPlan(authoritativeProject, mode)),
      continuityPromptContexts: serializeDirectorContinuityPromptContexts(authoritativeProject),
      segmentTransitions
    }),
    technicalSnapshot: currentDirectorTechnicalSnapshot(),
    totalDurationSeconds,
    segmentDurationsSeconds,
    segmentShotIds: project.segmentShotIds ?? Object.freeze([]),
    submission
  });
}

async function markDirectorCompiled(pending: DirectorPendingCompilation): Promise<boolean> {
  const committed = commitDirectorP1Compilation({
    currentState: directorProductionState,
    submission: pending.submission,
    succeeded: true,
    createdAt: new Date().toISOString()
  });
  directorProductionState = committed.state;
  directorP1Ui.setState(directorProductionState);
  const ownsCurrentMarker = pending.sequence === directorLatestSubmittedSequence;
  let liveStillMatches = false;
  if (ownsCurrentMarker) {
    directorLastCompiledSnapshot = pending.compilationSnapshot;
    directorLastCompiledTechnicalSnapshot = pending.technicalSnapshot;
    directorLastCompiledShotFingerprints = pending.submission.effectiveFingerprints;
    liveStillMatches = currentDirectorCompilationSnapshot() === pending.compilationSnapshot
      && currentDirectorTechnicalSnapshot() === pending.technicalSnapshot;
  }
  // Every successful request keeps its immutable Revision. Only the newest
  // submission may claim the current compiled marker when requests overlap.
  return saveDirectorDraft(true, ownsCurrentMarker && liveStillMatches);
}

function optionValueExists(select: HTMLSelectElement, value: unknown): value is string {
  return typeof value === "string" && [...select.options].some((option) => option.value === value);
}

function legacyDirectorIdentityKey(memoryKey: string): string | null {
  const parts = memoryKey.split(":");
  if (parts.length !== 5) return null;
  const [mode, , segment, start, duration] = parts;
  if (mode !== "T2V" && mode !== "FL2VA" && mode !== "REF2VA") return null;
  const values = [segment, start, duration].map(Number);
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0) || values[0] === 0 || values[2] === 0) return null;
  return directorShotIdentityKey(mode, values[0]!, values[1]!, values[2]!);
}

function restoreDirectorShotId(
  identityKey: string,
  candidateId: unknown,
  usedIds: Set<string>
): void {
  if (directorShotIds.has(identityKey)) return;
  const restored = uniqueDirectorShotId(candidateId, usedIds, () => createDirectorShotId(usedIds));
  usedIds.add(restored);
  directorShotIds.set(identityKey, restored);
}

function normalizedDirectorStoredKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const legacy = legacyDirectorIdentityKey(value);
  if (legacy !== null) return legacy;
  const parts = value.split(":");
  if (parts.length !== 4) return null;
  const [mode, segment, start, duration] = parts;
  if (mode !== "T2V" && mode !== "FL2VA" && mode !== "REF2VA") return null;
  const values = [segment, start, duration].map(Number);
  if (values.some((candidate) => !Number.isSafeInteger(candidate) || candidate < 0)
    || values[0] === 0 || values[2] === 0) return null;
  return directorShotIdentityKey(mode, values[0]!, values[1]!, values[2]!);
}

function applyDirectorDraftToWorkCopy(
  workflowName: string,
  draft: DirectorDraft,
  state: DirectorProductionState,
  persisted?: Record<string, unknown>
): void {
  directorProductionState = state;
  directorWorkflowName.value = workflowName;
  if (optionValueExists(directorLanguage, draft.language)) directorLanguage.value = draft.language;
  if (optionValueExists(directorMode, draft.mode)) directorMode.value = draft.mode;
  if (optionValueExists(directorTotalDuration, String(draft.totalDurationSeconds))) {
    directorTotalDuration.value = String(draft.totalDurationSeconds);
  }
  if (optionValueExists(directorSegmentDuration, String(draft.segmentDurationSeconds))) {
    directorSegmentDuration.value = String(draft.segmentDurationSeconds);
  }
  directorCharacterBible.value = draft.characterBible ?? "";
  directorWorldBible.value = draft.worldBible ?? "";
  directorVisualStyleBible.value = draft.visualStyleBible ?? "";
  directorContinuity.value = draft.continuity;
  directorSoundscape.value = draft.overallSoundscape;
  directorMusic.value = draft.nonDiegeticMusic;
  directorSubjects.value = draft.subjectDefinitions;
  directorSummary.value = draft.summary;
  directorRetention.value = draft.retentionAnalysis;
  directorStyleOpening.value = draft.styleOpening;

  const settings = state.project.directorSettings;
  const canvas = persisted?.canvas ?? settings.canvas;
  const resolution = persisted?.resolution ?? settings.resolution;
  const sampling = persisted?.sampling ?? settings.sampling;
  const restoredSeedPolicy = persisted?.seedPolicy ?? settings.seedPolicy;
  if (optionValueExists(directorCanvas, canvas)) directorCanvas.value = canvas;
  if (optionValueExists(directorResolution, resolution)) directorResolution.value = resolution;
  if (optionValueExists(directorSampling, sampling)) directorSampling.value = sampling;
  if (optionValueExists(directorSeedPolicy, restoredSeedPolicy)) directorSeedPolicy.value = restoredSeedPolicy;
  const seed = persisted?.seed ?? settings.seed;
  if (typeof seed === "string") directorSeed.value = seed;
  syncDirectorSeedPolicyControls();

  directorShotMemory.clear();
  directorShotMetadata.clear();
  directorShotIds.clear();
  const usedShotIds = new Set<string>();
  // The current draft owns current-mode identities. Production State may also
  // contain archived shots from another mode with identical timing; deriving
  // their keys from draft.mode would let an archived ID occupy a live key.
  for (const shot of draft.shots) {
    const key = directorShotIdentityKey(draft.mode, shot.durationSeconds, shot.startSeconds, shot.durationSeconds);
    restoreDirectorShotId(key, shot.id, usedShotIds);
  }
  if (Array.isArray(persisted?.shotIds)) {
    for (const value of persisted.shotIds) {
      if (typeof value !== "object" || value === null) continue;
      const entry = value as Record<string, unknown>;
      const key = normalizedDirectorStoredKey(entry.key);
      if (key !== null) restoreDirectorShotId(key, entry.id, usedShotIds);
    }
  }
  // Persisted memory is the only safe carrier for archived modes because a
  // ProductionShot intentionally has no mode field. Current draft text is
  // applied afterwards and therefore remains authoritative.
  if (Array.isArray(persisted?.shotMemory)) {
    for (const value of persisted.shotMemory) {
      if (typeof value !== "object" || value === null) continue;
      const entry = value as Record<string, unknown>;
      const key = normalizedDirectorStoredKey(entry.key);
      if (key === null || typeof entry.description !== "string") continue;
      directorShotMemory.set(key, entry.description);
      directorShotMetadata.set(key, {
        cameraLanguage: typeof entry.cameraLanguage === "string" ? entry.cameraLanguage : "",
        soundCue: typeof entry.soundCue === "string" ? entry.soundCue : "",
        transitionNote: typeof entry.transitionNote === "string" ? entry.transitionNote : ""
      });
      restoreDirectorShotId(key, entry.id, usedShotIds);
    }
  }
  for (const shot of draft.shots) {
    const key = directorShotIdentityKey(draft.mode, shot.durationSeconds, shot.startSeconds, shot.durationSeconds);
    directorShotMemory.set(key, shot.description);
    directorShotMetadata.set(key, {
      cameraLanguage: shot.cameraLanguage ?? "",
      soundCue: shot.soundCue ?? "",
      transitionNote: shot.transitionNote ?? ""
    });
  }
  directorP1Ui.setState(directorProductionState);
  syncDirectorMode(true);
}

/**
 * Adopts a reconciled selection in both project authorities without creating
 * an unrelated undo command. All candidates are validated before either live
 * reference changes, so a mismatch fails closed and leaves both untouched.
 */
function applyReconciledDirectorActiveShot(activeShotId: string | null): void {
  const activeProject = activeRelayProject;
  if (activeProject === null) throw new Error("当前 Relay 项目不可用；导播状态未被修改。");
  if (activeShotId !== null
    && !activeProject.shots.some((shot) => shot.shotId === activeShotId && !shot.archived)) {
    throw new Error("对账后的当前镜头不属于当前项目；Relay 已停止恢复以保护项目数据。");
  }
  const workspace = directorWorkspace;
  if (workspace !== null && workspace.session.current.projectId !== activeProject.projectId) {
    throw new Error("专业导播工作区与当前项目不一致；Relay 已停止恢复。");
  }
  const nextActiveProject = projectWithReconciledDirectorActiveShot(activeProject, activeShotId);
  const nextWorkspaceProject = workspace === null
    ? null
    : projectWithReconciledDirectorActiveShot(workspace.session.current, activeShotId);

  activeRelayProject = Object.freeze({
    ...nextActiveProject,
    professional: Object.freeze({
      ...nextActiveProject.professional,
      activeShotId
    })
  });
  if (workspace !== null && nextWorkspaceProject !== null) {
    directorWorkspace = Object.freeze({
      ...workspace,
      session: Object.freeze({
        ...workspace.session,
        current: Object.freeze({
          ...nextWorkspaceProject,
          professional: Object.freeze({
            ...nextWorkspaceProject.professional,
            activeShotId
          })
        })
      })
    });
  }
  directorActiveShotId = activeShotId;
}

function restoreDirectorProductionRevisionToWorkCopy(revisionId: string): void {
  const restored = restoreDirectorP1Revision(directorProductionState, revisionId);
  if (!restored.ok) {
    showFeedback({ kind: "error", title: "版本无法恢复", message: restored.error });
    return;
  }
  const project = directorWorkspace?.session.current ?? activeRelayProject;
  if (project === null) {
    showFeedback({ kind: "error", title: "版本无法恢复", message: "当前 Relay 项目不可用；历史数据保持不变。" });
    return;
  }
  const reconciled = reconcileProfessionalDirectorStateWithProject({
    project,
    draft: restored.draft,
    state: restored.state,
    sourceVersion: 7,
    legacyActiveShotId: directorActiveShotId ?? project.professional.activeShotId,
    lastCompiledShotFingerprints: Object.freeze({})
  });
  if (!reconciled.ok) {
    showFeedback({
      kind: "error",
      title: "版本无法安全恢复",
      message: `${reconciled.error}（${reconciled.code}）`
    });
    return;
  }
  applyReconciledDirectorActiveShot(reconciled.activeShotId);
  applyDirectorDraftToWorkCopy(restored.workflowName, reconciled.draft, reconciled.state);
  if (reconciled.changed) {
    directorLegacyShotIdMap = Object.freeze({ ...directorLegacyShotIdMap, ...reconciled.shotIdMap });
  }
  directorP1Ui.setActiveShot(reconciled.activeShotId);
  // A Revision proves that its historical workflow compiled, but local frame
  // selections are capability-bound and deliberately are not persisted. Do not
  // combine historical shot fingerprints with whatever reference media happens
  // to be selected in the current window and present that as a current compile.
  directorLastCompiledShotFingerprints = Object.freeze({});
  directorLastCompiledTechnicalSnapshot = "";
  directorLastCompiledSnapshot = "";
  markDirectorDirty();
  updateDirectorPreview();
  showFeedback({
    kind: "success",
    title: "已恢复为工作副本",
    message: "历史版本已恢复到编辑区；原历史记录仍保留，后续成功编译会建立新版本。"
  });
}

function restoreDirectorDraft(): void {
  if (directorDraftRestored) return;
  directorDraftRestored = true;
  try {
    const metadata = activeRelayProject === null ? null : readProfessionalDirectorMetadata(activeRelayProject);
    // Browser-local legacy drafts have no project identity. Attaching one to the
    // currently open project can resurrect a deleted project's prompt, so only
    // the dataRoot-backed state embedded in this exact project may be restored.
    const source = metadata?.preservedLegacyDirectorState ?? null;
    if (source === null || typeof source !== "object" || Array.isArray(source)) {
      const project = activeRelayProject;
      if (project === null) return;
      directorWorkflowName.value = project.name;
      if (optionValueExists(directorMode, project.quick.mode)) directorMode.value = project.quick.mode;
      if (optionValueExists(directorTotalDuration, String(project.quick.totalDurationSeconds))) directorTotalDuration.value = String(project.quick.totalDurationSeconds);
      if (optionValueExists(directorSegmentDuration, String(project.quick.segmentDurationSeconds))) directorSegmentDuration.value = String(project.quick.segmentDurationSeconds);
      if (optionValueExists(directorCanvas, project.quick.canvasAspectRatio)) directorCanvas.value = project.quick.canvasAspectRatio;
      if (optionValueExists(directorResolution, project.quick.resolutionMegapixels)) directorResolution.value = project.quick.resolutionMegapixels;
      directorSeed.value = project.quick.seed;
      if (optionValueExists(directorSeedPolicy, project.quick.seedPolicy)) directorSeedPolicy.value = project.quick.seedPolicy;
      if (optionValueExists(directorSampling, project.quick.sampling)) directorSampling.value = project.quick.sampling;
      syncDirectorSeedPolicyControls();
      directorShotMemory.clear();
      directorShotMetadata.clear();
      directorShotIds.clear();
      directorLastCompiledSnapshot = "";
      directorLastCompiledTechnicalSnapshot = "";
      directorLastCompiledShotFingerprints = Object.freeze({});
      let startSeconds = 0;
      for (const shot of project.shots.filter((candidate) => !candidate.archived).sort((left, right) => left.order - right.order)) {
        const key = directorShotMemoryKey(project.quick.mode, project.quick.totalDurationSeconds, project.quick.segmentDurationSeconds, startSeconds, shot.durationSeconds);
        directorShotMemory.set(key, shot.prompt);
        startSeconds += shot.durationSeconds;
      }
      syncDirectorMode();
      directorDraftDirty = false;
      updateDirectorPreview();
      return;
    }
    const payload = source as Record<string, unknown>;
    const draft = payload.draft as Record<string, unknown> | undefined;
    if ((payload.version === 5 || payload.version === 6 || payload.version === 7) && draft !== undefined) {
      const restored = restoreDirectorPayload(payload);
      if (!restored.ok) {
        directorStateChip.textContent = restored.error;
        return;
      }
      const project = activeRelayProject;
      if (project === null) return;
      const reconciled = reconcileProfessionalDirectorStateWithProject({
        project,
        draft: restored.draft,
        state: restored.state,
        sourceVersion: restored.sourceVersion,
        legacyActiveShotId: payload.activeShotId ?? payload.directorActiveShotId,
        lastCompiledShotFingerprints: restored.lastCompiledShotFingerprints
      });
      if (!reconciled.ok) {
        directorStateChip.textContent = `${reconciled.error}（${reconciled.code}）`;
        directorStateChip.classList.remove("status-badge--success");
        return;
      }
      directorLastCompiledSnapshot = !reconciled.changed && typeof payload.lastCompiledSnapshot === "string"
        ? payload.lastCompiledSnapshot
        : "";
      directorLastCompiledTechnicalSnapshot = !reconciled.changed && typeof payload.lastCompiledTechnicalSnapshot === "string"
        ? payload.lastCompiledTechnicalSnapshot
        : "";
      directorLastCompiledShotFingerprints = reconciled.lastCompiledShotFingerprints;
      applyReconciledDirectorActiveShot(reconciled.activeShotId);
      applyDirectorDraftToWorkCopy(restored.workflowName, reconciled.draft, reconciled.state, payload);
      if (reconciled.changed) {
        directorLegacyShotIdMap = Object.freeze({ ...directorLegacyShotIdMap, ...reconciled.shotIdMap });
      }
      directorP1Ui.setActiveShot(reconciled.activeShotId);
      directorDraftDirty = reconciled.changed;
      updateDirectorPreview();
      if (reconciled.changed) markDirectorDirty();
      return;
    }
    if ((payload.version !== 1 && payload.version !== 2 && payload.version !== 3 && payload.version !== 4) || draft === undefined) return;
    if (typeof payload.workflowName === "string") directorWorkflowName.value = payload.workflowName;
    if (optionValueExists(directorLanguage, draft.language)) directorLanguage.value = draft.language;
    if (optionValueExists(directorMode, draft.mode)) directorMode.value = draft.mode;
    if (optionValueExists(directorTotalDuration, String(draft.totalDurationSeconds))) directorTotalDuration.value = String(draft.totalDurationSeconds);
    if (optionValueExists(directorSegmentDuration, String(draft.segmentDurationSeconds))) directorSegmentDuration.value = String(draft.segmentDurationSeconds);
    if (typeof draft.characterBible === "string") directorCharacterBible.value = draft.characterBible;
    if (typeof draft.worldBible === "string") directorWorldBible.value = draft.worldBible;
    if (typeof draft.visualStyleBible === "string") directorVisualStyleBible.value = draft.visualStyleBible;
    if (typeof draft.continuity === "string") directorContinuity.value = draft.continuity;
    if (typeof draft.overallSoundscape === "string") directorSoundscape.value = draft.overallSoundscape;
    if (typeof draft.nonDiegeticMusic === "string") directorMusic.value = draft.nonDiegeticMusic;
    if (typeof draft.subjectDefinitions === "string") directorSubjects.value = draft.subjectDefinitions;
    if (typeof draft.summary === "string") directorSummary.value = draft.summary;
    if (typeof draft.retentionAnalysis === "string") directorRetention.value = draft.retentionAnalysis;
    if (typeof draft.styleOpening === "string") directorStyleOpening.value = draft.styleOpening;
    if (optionValueExists(directorCanvas, payload.canvas)) directorCanvas.value = payload.canvas;
    if (optionValueExists(directorResolution, payload.resolution)) directorResolution.value = payload.resolution;
    if (typeof payload.seed === "string") directorSeed.value = payload.seed;
    if (optionValueExists(directorSeedPolicy, payload.seedPolicy)) directorSeedPolicy.value = payload.seedPolicy;
    if (optionValueExists(directorSampling, payload.sampling)) directorSampling.value = payload.sampling;
    syncDirectorSeedPolicyControls();
    directorShotMemory.clear();
    directorShotMetadata.clear();
    directorShotIds.clear();
    directorLastCompiledSnapshot = "";
    directorLastCompiledTechnicalSnapshot = "";
    directorLastCompiledShotFingerprints = Object.freeze({});
    const usedShotIds = new Set<string>();
    if ((payload.version === 2 || payload.version === 3 || payload.version === 4) && Array.isArray(payload.shotMemory)) {
      for (const entry of payload.shotMemory) {
        if (typeof entry !== "object" || entry === null) continue;
        const candidate = entry as Record<string, unknown>;
        if (typeof candidate.key === "string" && typeof candidate.description === "string") {
          const normalizedKey = normalizedDirectorStoredKey(candidate.key);
          if (normalizedKey === null) continue;
          directorShotMemory.set(normalizedKey, candidate.description);
          if (payload.version === 3 || payload.version === 4) {
            directorShotMetadata.set(normalizedKey, {
              cameraLanguage: typeof candidate.cameraLanguage === "string" ? candidate.cameraLanguage : "",
              soundCue: typeof candidate.soundCue === "string" ? candidate.soundCue : "",
              transitionNote: typeof candidate.transitionNote === "string" ? candidate.transitionNote : ""
            });
            restoreDirectorShotId(normalizedKey, candidate.id, usedShotIds);
          }
        }
      }
    } else if (Array.isArray(draft.shots)) {
      for (const shot of draft.shots) {
        if (typeof shot !== "object" || shot === null) continue;
        const candidate = shot as Record<string, unknown>;
        const startSeconds = Number(candidate.startSeconds);
        const durationSeconds = Number(candidate.durationSeconds);
        if (Number.isSafeInteger(startSeconds) && Number.isSafeInteger(durationSeconds)
          && typeof candidate.description === "string") {
          directorShotMemory.set(directorShotMemoryKey(
            directorSelectedMode(),
            Number(directorTotalDuration.value),
            Number(directorSegmentDuration.value),
            startSeconds,
            durationSeconds
          ), candidate.description);
        }
      }
    }
    syncDirectorMode();
    directorDraftDirty = false;
    updateDirectorPreview();
  } catch {
    directorStateChip.textContent = "草稿无法恢复";
  }
}

function validateDirectorForCompilation(): boolean {
  const result = directorValidationErrors();
  if (result.errors.length > 0) {
    showFeedback({
      kind: "warning",
      title: "专业导播还有未完成项目",
      message: result.errors.join("\n")
    });
    return false;
  }
  return true;
}

function setSegmentRecommendation(vramBytes: number | null): void {
  if (vramBytes === null) {
    outputSettings.dataset.vramGib = "unknown";
    segmentDuration.dataset.recommendedSeconds = "5";
    segmentRecommendation.textContent = "尚未读取显存；默认 5 秒最稳妥，也可以手动选择 10 或 15 秒。";
    return;
  }
  const vramGiB = vramBytes / (1024 ** 3);
  outputSettings.dataset.vramGib = vramGiB.toFixed(1);
  if (vramGiB < 20) {
    segmentDuration.dataset.recommendedSeconds = "5";
    segmentRecommendation.textContent = `检测到约 ${vramGiB.toFixed(0)} GB 显存：本地保守建议 5 秒/段（非官方性能保证）。`;
  } else if (vramGiB < 32) {
    segmentDuration.dataset.recommendedSeconds = "10";
    segmentRecommendation.textContent = `检测到约 ${vramGiB.toFixed(0)} GB 显存：本地经验建议 10 秒/段；5 秒更稳（非官方性能保证）。`;
  } else {
    segmentDuration.dataset.recommendedSeconds = "15";
    segmentRecommendation.textContent = `检测到约 ${vramGiB.toFixed(0)} GB 显存：本地经验建议 15 秒/段；10 秒更稳（非官方性能保证）。`;
  }
}

function requireFrames(
  mode: ProjectMode,
  hasFirstFrame = firstFrame !== null,
  hasLastFrame = lastFrame !== null
): string | null {
  if (mode === "FL2VA" && !hasFirstFrame && !hasLastFrame) {
    return "FL2VA 工作流至少需要选择一张首帧或尾帧。";
  }
  if (mode === "REF2VA" && !hasFirstFrame) {
    return !hasLastFrame
      ? "Ref2VA 工作流至少需要选择参考图 1。"
      : "请先选择参考图 1；不能只绑定参考图 2，以免 <Picture 1>/<Picture 2> 与实际文件错位。";
  }
  return null;
}

function setProjectAvailability(available: boolean, message: string): void {
  installationComplete = available;
  projectGuard.hidden = available;
  directorGuard.hidden = available;
  directorConsole.classList.remove("is-locked");
  compileButton.disabled = compileButton.getAttribute("aria-busy") === "true";
  syncDirectorCompileButtonState();
  element("plan-chip").textContent = message;
  element("plan-chip").classList.toggle("status-badge--success", available);
  appShell.dataset.setupComplete = String(available);
  mainNavigation.hidden = false;
  componentSettingsButton.hidden = false;
}

function ref2vaIsReady(): boolean {
  return completedOptionalComponents.has("ref2va_optional");
}

function syncRef2vaAvailability(): void {
  if (ref2vaModeInput === null) return;
  const ready = ref2vaIsReady();
  ref2vaModeInput.disabled = !ready;
  ref2vaModeState.textContent = ready
    ? "Ref2VA 模型已准备"
    : "需先到右上角“安装与组件”安装 Ref2VA 包";
  ref2vaModeState.classList.toggle("is-ready", ready);
  ref2vaModeCard.title = ready
    ? "Ref2VA 工作流可用"
    : "该模式始终显示；安装并校验 Ref2VA 可选包后即可选择。";
  if (!ready && ref2vaModeInput.checked) {
    const t2v = projectForm.querySelector<HTMLInputElement>('input[name="mode"][value="T2V"]');
    if (t2v !== null) t2v.checked = true;
    syncFrameControls();
  }
  const refreshed = safelyRefreshProfessionalDirectorState(
    () => syncDirectorRefAvailability(),
    (error) => {
      // Environment detection is authoritative for installation state. A stale
      // project/editor work copy must not turn a successful machine scan into
      // an application-wide initialization failure.
      directorStateChip.textContent = `专业导播状态需重新载入：${publicError(error)}`;
      directorStateChip.classList.remove("status-badge--success");
      directorStateChip.dataset.errorCode = "DIRECTOR_STATE_REFRESH_FAILED";
    }
  );
  if (refreshed) delete directorStateChip.dataset.errorCode;
}

function installationStateLabel(status: InstallationStatusResult): string {
  switch (status.state) {
    case "running": return "正在安装";
    case "cancel_pending": return "正在安全取消";
    case "cancelled": return "安装已取消";
    case "recovery_required": return "等待失败恢复";
    case "failed": return "安装失败";
    case "complete": return "安装完成";
  }
}

function renderInstallationStatus(status: InstallationStatusResult): void {
  const progress = Math.max(0, Math.min(100, status.progressBasisPoints / 100));
  installationProgress.hidden = false;
  installationProgressTitle.textContent = installationStateLabel(status);
  installationProgressPercent.textContent = `${progress.toFixed(progress % 1 === 0 ? 0 : 1)}%`;
  installationProgressBar.style.width = `${progress}%`;
  installationProgressBar.parentElement?.setAttribute("aria-valuenow", String(Math.round(progress)));
  installationProgressMessage.textContent = status.totalBytes > 0
    ? `${status.message} · ${formatGiB(status.completedBytes / 1024 ** 3)} / ${formatGiB(status.totalBytes / 1024 ** 3)}`
    : status.message;
  renderInstallationTransferMetrics(status);
  installationIdDisplay.textContent = status.installationId;
  for (const item of document.querySelectorAll<HTMLElement>("[data-install-step]")) {
    const step = status.steps.find((candidate) => candidate.id === item.dataset.installStep);
    item.dataset.state = step?.state ?? "pending";
  }
  updateComponentProgress(status);

  activeInstallationId = status.installationId;
  lastInstallationState = status.state;
  const active = status.state === "running" || status.state === "cancel_pending";
  cancelInstallationButton.disabled = !active || status.state === "cancel_pending";
  prepareButton.disabled = active;
  for (const checkbox of componentList.querySelectorAll<HTMLInputElement>('input[name="optionalComponent"]')) {
    checkbox.disabled = active || checkbox.dataset.locked === "true";
  }

  if (status.state === "complete") {
    restoredConfigurationReady = true;
    for (const component of preparedOptionalComponents) completedOptionalComponents.add(component);
    preparedOptionalComponents = new Set<ComponentId>();
    syncRef2vaAvailability();
    setProjectAvailability(true, `安装完成 · ${status.installationId}`);
    setSetupStage("complete");
    prepareStatus.classList.remove("inline-message--error");
    prepareStatus.textContent = "所选组件已完成下载、校验与本机配置；现在可以编译工作流。";
    prepareStatus.hidden = false;
    setButtonBusy(prepareButton, false, "安装已完成");
    showView("project");
    return;
  }

  setProjectAvailability(false, `${installationStateLabel(status)} · 编译已锁定`);
  if (status.state === "recovery_required" || status.state === "failed") {
    setButtonBusy(prepareButton, false, status.recoverable ? "继续恢复安装" : "重新开始安装");
  } else if (status.state === "cancelled") {
    activeInstallationId = null;
    setButtonBusy(prepareButton, false, "重新开始安装");
  } else {
    setButtonBusy(prepareButton, true, "安装进行中…");
  }
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolvePromise) => window.setTimeout(resolvePromise, milliseconds));
}

async function followInstallation(installationId: string, token: number): Promise<void> {
  while (token === installationPollToken) {
    await delay(650);
    if (token !== installationPollToken) return;
    try {
      const status = await window.controlPlane.queryInstallation({ installationId });
      renderInstallationStatus(status);
      if (status.state !== "running" && status.state !== "cancel_pending") return;
    } catch (error) {
      setProjectAvailability(false, "安装状态不可确认 · 编译已锁定");
      prepareStatus.textContent = publicError(error);
      prepareStatus.classList.add("inline-message--error");
      prepareStatus.hidden = false;
      setButtonBusy(prepareButton, false, "查询失败，重新尝试");
      return;
    }
  }
}

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-view-target]")) {
  button.addEventListener("click", () => {
    const view = button.dataset.viewTarget;
    if (isViewName(view)) {
      showView(view);
      if (view === "install" && latestScan === null) void runScan(true);
    }
  });
}

for (const [buttonId, input, kind] of [
  ["browse-install-root", installRoot, "install_root"],
  ["browse-existing-comfy-root", comfyUiRoot, "comfyui_root"],
  ["browse-existing-model-root", modelRoot, "model_root"]
] as const) {
  element<HTMLButtonElement>(buttonId).addEventListener("click", () => {
    void (async () => {
      const selection = await window.controlPlane.chooseDirectory(kind as DirectoryKind);
      if (selection === null) return;
      input.value = selection.displayPath;
      input.focus();
      if (kind === "comfyui_root") markLocationPending("comfy", selection.displayPath);
      if (kind === "model_root") markLocationPending("model", selection.displayPath);
      if (installationComplete) {
        restoredConfigurationReady = false;
        setProjectAvailability(false, "位置已更改 · 重新检测后才能编译");
      }
      scanStateBadge.textContent = "位置已更改，请重新检测";
      scanStateBadge.classList.remove("status-badge--success");
      scanActions.hidden = false;
      setGlobalStatus(kind === "install_root"
        ? "已选择统一受管根，请重新检测。"
        : kind === "comfyui_root"
          ? "已选择现有 ComfyUI 根目录，请重新检测。"
          : "已选择现有 H3 模型根目录，请重新检测。");
    })().catch((error: unknown) => {
      scanError.textContent = publicError(error);
      scanError.hidden = false;
      input.focus();
    });
  });
}

for (const input of [installRoot, comfyUiRoot, modelRoot]) {
  input.addEventListener("input", () => {
    if (input === comfyUiRoot) markLocationPending("comfy", input.value);
    if (input === modelRoot) markLocationPending("model", input.value);
    if (installationComplete) {
      restoredConfigurationReady = false;
      setProjectAvailability(false, "位置已更改 · 重新检测后才能编译");
    }
    if (latestScan === null) return;
    scanStateBadge.textContent = "位置已更改，请重新检测";
    scanStateBadge.classList.remove("status-badge--success");
    scanActions.hidden = false;
  });
}

async function runScan(automatic: boolean): Promise<void> {
  const configurationWasReady = installationComplete && restoredConfigurationReady;
  scanError.hidden = true;
  prepareStatus.hidden = true;
  if (!configurationWasReady) setProjectAvailability(false, "正在检查本机环境");
  if (automatic) {
    locationResults.hidden = true;
    managedRootSection.hidden = true;
    scanResults.hidden = true;
  }
  scanActions.hidden = true;
  scanStateBadge.textContent = automatic ? "正在自动检测" : "正在重新检测";
  scanStateBadge.classList.remove("status-badge--success");
  startScanFeedback();
  setButtonBusy(scanButton, true, "正在检测…");
  try {
    const request: ScanInstallationRequest = {
      installRoot: installRoot.value,
      comfyUiRoot: comfyUiRoot.value.trim().length === 0 ? null : comfyUiRoot.value,
      modelRoot: modelRoot.value.trim().length === 0 ? null : modelRoot.value
    };
    latestScan = await window.controlPlane.scanInstallation(request);
    installationPollToken += 1;
    activeInstallationId = null;
    lastInstallationState = null;
    installationProgress.hidden = true;
    renderScan(latestScan);
    const requiredComponentsReady = latestScan.locations.comfyUiRoot !== null
      && latestScan.components
        .filter((component) => component.required)
        .every((component) => component.state === "verified_reuse");
    if (configurationWasReady && requiredComponentsReady) {
      for (const component of latestScan.components) {
        if (!component.required && component.state === "verified_reuse") {
          completedOptionalComponents.add(component.id);
        }
      }
      setProjectAvailability(true, "已保存配置 · 复核通过");
      syncRef2vaAvailability();
      setGlobalStatus("保存的本机配置已复核，工作流功能保持可用。");
    } else {
      restoredConfigurationReady = false;
      setProjectAvailability(false, "检测完成 · 等待确认安装");
      setGlobalStatus("检测完成，可以核对位置与组件后开始安装。");
    }
  } catch (error) {
    latestScan = null;
    scanResults.hidden = true;
    locationResults.hidden = false;
    managedRootSection.hidden = false;
    scanActions.hidden = false;
    scanStateBadge.textContent = "自动检测未完成";
    markLocationPending("comfy", comfyUiRoot.value);
    markLocationPending("model", modelRoot.value);
    scanError.textContent = `${publicError(error)} Relay 仍可使用项目与导播功能；安装时将采用上方受管目录。如需复用已有环境，可展开次级入口后选择。`;
    scanError.hidden = false;
    setSetupStage("location");
    if (configurationWasReady) {
      setProjectAvailability(true, "使用已保存配置 · 本次复核失败");
      setGlobalStatus("本次组件复核未完成，仍保留启动时已通过静态校验的保存配置。");
    } else {
      setGlobalStatus("自动检测未完成，已开放手动路径选择与重试。");
    }
  } finally {
    stopScanFeedback();
    setButtonBusy(scanButton, false, "重新检测");
  }
}

installForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void runScan(false);
});

prepareButton.addEventListener("click", () => {
  void (async () => {
    if (latestScan === null) return;
    prepareStatus.hidden = true;
    prepareStatus.classList.remove("inline-message--error");
    if (!scanPathsStillCurrent(latestScan)) {
      prepareStatus.textContent = "检测后位置已经更改。请先点击“重新检测”，避免把组件安装到旧目录。";
      prepareStatus.classList.add("inline-message--error");
      prepareStatus.hidden = false;
      scanActions.hidden = false;
      return;
    }
    setProjectAvailability(false, "安装进行中 · 编译已锁定");
    setButtonBusy(prepareButton, true, "正在启动安装…");
    try {
      let planId = activeInstallationId;
      if (planId === null || lastInstallationState !== "recovery_required") {
        const selectedComponents = selectedOptionalComponents();
        const plan = await window.controlPlane.prepareInstallation({
          installRoot: latestScan.installRoot,
          selectedOptionalComponents: selectedComponents
        });
        preparedOptionalComponents = new Set(selectedComponents);
        planId = plan.planId;
      }
      activeInstallationId = planId;
      const token = installationPollToken + 1;
      installationPollToken = token;
      installationProgress.hidden = false;
      installationProgressTitle.textContent = lastInstallationState === "recovery_required"
        ? "正在启动失败恢复"
        : "正在启动真实安装";
      installationProgressMessage.textContent = "安装事务已启动，正在等待首个持久化状态…";
      installationIdDisplay.textContent = planId;
      setGlobalStatus("安装事务已启动；下载、校验、解压、复用和恢复状态将持续更新。");
      const execution = window.controlPlane.executeInstallation({
        planId,
        installRoot: latestScan.installRoot
      });
      void followInstallation(planId, token);
      const status = await execution;
      if (token === installationPollToken) renderInstallationStatus(status);
    } catch (error) {
      setProjectAvailability(false, "安装未完成 · 编译已锁定");
      prepareStatus.textContent = publicError(error);
      prepareStatus.classList.add("inline-message--error");
      prepareStatus.hidden = false;
      setButtonBusy(prepareButton, false, "重新尝试安装");
    } finally {
      if (!installationComplete && lastInstallationState !== "running" && lastInstallationState !== "cancel_pending") {
        prepareButton.disabled = false;
      }
    }
  })();
});

cancelInstallationButton.addEventListener("click", () => {
  void (async () => {
    if (activeInstallationId === null) return;
    cancelInstallationButton.disabled = true;
    setProjectAvailability(false, "正在取消 · 编译已锁定");
    try {
      const status = await window.controlPlane.cancelInstallation({
        installationId: activeInstallationId
      });
      renderInstallationStatus(status);
      if (status.state === "cancel_pending") {
        const token = installationPollToken + 1;
        installationPollToken = token;
        void followInstallation(status.installationId, token);
      }
    } catch (error) {
      prepareStatus.textContent = publicError(error);
      prepareStatus.classList.add("inline-message--error");
      prepareStatus.hidden = false;
    }
  })();
});

projectPrompt.addEventListener("input", () => {
  promptCount.textContent = `${projectPrompt.value.length} / 4000`;
  promptError.hidden = projectPrompt.value.trim().length > 0;
  syncPromptTimelineAdvice();
});

applyPromptDuration.addEventListener("click", () => {
  const duration = Number(applyPromptDuration.dataset.duration);
  if (!promptDurationOptions.includes(duration as (typeof promptDurationOptions)[number])) return;
  projectDuration.value = String(duration);
  syncFrameControls();
  syncSegmentPlan();
  scheduleQuickProjectSave();
  projectDuration.focus();
});

workflowNameInput.addEventListener("input", () => {
  const result = validateWorkflowName(workflowNameInput.value);
  workflowNameError.textContent = result.ok ? "" : result.message;
  workflowNameError.hidden = result.ok;
});

async function chooseFrame(slot: "first" | "last"): Promise<void> {
  const context = captureProjectOperationContext();
  await flushQuickProjectSave();
  if (!isCurrentProjectOperation(context)) return;
  const result = await window.controlPlane.importProjectAssets({
    projectId: context.projectId,
    mode: "copy"
  });
  if (!isCurrentProjectOperation(context)) return;
  if (result.cancelled) return;
  const refreshed = await window.controlPlane.loadRelayProject({
    projectId: context.projectId,
    activate: false
  });
  if (!isCurrentProjectOperation(context)) return;
  activeRelayProject = refreshed;
  persistedProjectUpdatedAtById.set(refreshed.projectId, refreshed.updatedAt);
  if (result.results.length !== 1) {
    if (!await refreshDirectorAssetCatalog(context)) return;
    if (!isCurrentProjectOperation(context)) return;
    if (directorWorkspace !== null) initializeDirectorWorkspace(refreshed);
    showFeedback({
      kind: "warning",
      title: "参考帧一次只接受一张图片",
      message: `本次选择了 ${result.results.length} 个文件；素材已按你的选择导入项目素材库，但没有更改${slot === "first" ? "首帧" : "尾帧"}。请重新选择单张图片。`
    });
    return;
  }
  const entry = result.results[0];
  if (entry === undefined || entry.status === "rejected") {
    throw new Error(entry?.issues.join("；") || "所选文件未通过本地图片预检。");
  }
  const assetId = entry.asset?.assetId ?? entry.duplicateAssetId;
  const asset = refreshed.assets.find((candidate) => candidate.assetId === assetId);
  if (assetId === null || asset === undefined) throw new Error("素材导入完成，但未能确认稳定素材 ID。");
  if (asset.mediaType !== "image") throw new Error("首帧和尾帧只接受通过本地预检的图片素材。");
  if (asset.availability !== "available") {
    throw new Error(`图片素材当前状态为“${PROJECT_ASSET_AVAILABILITY_LABELS[asset.availability]}”，不能作为参考帧。`);
  }
  const selection = await window.controlPlane.prepareProjectAssetFrame({
    projectId: refreshed.projectId,
    assetId,
    slot
  });
  if (!isCurrentProjectOperation(context)) return;
  const updated: RelayProjectDocument = {
    ...refreshed,
    updatedAt: new Date().toISOString(),
    quick: {
      ...refreshed.quick,
      [slot === "first" ? "firstFrameAssetId" : "lastFrameAssetId"]: assetId
    }
  };
  const saved = await persistRelayProject(updated);
  if (!isCurrentProjectOperation(context)) return;
  if (slot === "first") {
    firstFrame = selection;
    firstFrameName.textContent = selection.displayName;
  } else {
    lastFrame = selection;
    lastFrameName.textContent = selection.displayName;
  }
  if (!await refreshDirectorAssetCatalog(context)) return;
  if (!isCurrentProjectOperation(context)) return;
  if (directorWorkspace !== null) initializeDirectorWorkspace(saved);
  syncDirectorFrames();
  updateDirectorPreview();
}

function directorPurposeForFrameSlot(mode: ProjectMode, slot: DirectorAssetProjectionSlot): RelayAssetPurpose {
  if (mode === "FL2VA") return slot === "first" ? "first_frame" : "last_frame";
  if (mode === "REF2VA") return slot === "first" ? "subject_reference" : "continuity_reference";
  throw new Error("T2V 不接收首帧、尾帧或参考图输入。");
}

async function chooseDirectorFrame(slot: DirectorAssetProjectionSlot): Promise<void> {
  const mutation = await flushAndCaptureProjectMutation();
  const result = await window.controlPlane.importProjectAssets({
    projectId: mutation.projectId,
    mode: "copy"
  });
  if (!isCurrentProjectOperation(mutation)) return;
  if (result.cancelled) return;
  await synchronizeProjectMutation(mutation);
  if (!isCurrentProjectOperation(mutation)) return;
  if (result.results.length !== 1) {
    if (!await refreshDirectorAssetCatalog(mutation)) return;
    throw new Error(`专业导播的${slot === "first" ? "第一张" : "第二张"}图片一次只接受一个文件；本次选择的素材仍已按你的选择加入项目素材库。`);
  }
  const entry = result.results[0];
  if (entry === undefined || entry.status === "rejected") {
    throw new Error(entry?.issues.join("；") || "所选文件未通过本地图片预检。");
  }
  const assetId = entry.asset?.assetId ?? entry.duplicateAssetId;
  if (!await refreshDirectorAssetCatalog(mutation)) return;
  if (!isCurrentProjectOperation(mutation)) return;
  const project = directorProjectForAssetProjection();
  const asset = project?.assets.find((candidate) => candidate.assetId === assetId);
  if (project === null || project === undefined || assetId === null || asset === undefined) {
    throw new Error("素材导入完成，但未能在当前专业项目中确认稳定素材 ID。");
  }
  if (asset.mediaType !== "image") throw new Error("专业导播的首帧、尾帧和 Ref2VA 参考图只接受图片素材。");
  if (asset.availability !== "available") {
    throw new Error(`图片素材当前状态为“${PROJECT_ASSET_AVAILABILITY_LABELS[asset.availability]}”，不能进入工作流。`);
  }
  const mode = directorSelectedMode() as ProjectMode;
  const purpose = directorPurposeForFrameSlot(mode, slot);
  const shotIds = directorOrderedShotIds(project);
  const targetShotId = mode === "FL2VA"
    ? (slot === "first" ? shotIds[0] : shotIds.at(-1))
    : shotIds[0];
  if (targetShotId === undefined) throw new Error("专业导播没有可绑定素材的活动镜头。");
  if (mode === "REF2VA" && shotIds.length !== 1) {
    throw new Error("当前认证 Ref2VA 镜头素材接入仅支持单镜头工作流。");
  }
  const previousProjection = buildDirectorAssetProjectionPlan(project, mode);
  const replacedEntry = slot === "first" ? previousProjection.first : previousProjection.last;
  const removedBindings = project.bindings.filter((binding) => binding.targetKind === "shot" && (
    binding.bindingId === replacedEntry?.binding.bindingId
    || binding.assetId === asset.assetId
    || (mode === "FL2VA" && binding.purpose === purpose)
    || (mode === "REF2VA" && binding.targetId === targetShotId && binding.purpose === purpose)
  ));
  const removedIds = new Set(removedBindings.map((binding) => binding.bindingId));
  const createdAt = new Date().toISOString();
  const binding: RelayAssetBinding = {
    bindingId: `binding-${crypto.randomUUID()}`,
    targetKind: "shot",
    targetId: targetShotId,
    assetId: asset.assetId,
    purpose,
    notes: "",
    createdAt
  };
  if (!isCurrentProjectOperation(mutation)) return;
  applyDirectorWorkspaceMutation(
    slot === "first" ? "设置专业导播第一张工作流图片" : "设置专业导播第二张工作流图片",
    (current) => ({
      ...current,
      updatedAt: createdAt,
      bindings: [...current.bindings.filter((candidate) => !removedIds.has(candidate.bindingId)), binding]
    })
  );
  for (const removed of removedBindings) {
    for (const legacy of productionBindingsForTarget(directorProductionState, "shot", removed.targetId)
      .filter((candidate) => candidate.assetId === removed.assetId && !candidate.archived)) {
      directorProductionState = archiveProductionBinding(directorProductionState, legacy.id);
    }
  }
  directorProductionState = upsertProductionBinding(directorProductionState, {
    identityKey: `shot-reference:${targetShotId}:${asset.assetId}:${purpose}`,
    targetKind: "shot",
    targetId: targetShotId,
    assetId: asset.assetId,
    role: "reference"
  });
  directorP1Ui.setState(directorProductionState);
  markDirectorDirty();
  syncDirectorFrames();
  updateDirectorPreview();
}

function clearDirectorFrame(slot: DirectorAssetProjectionSlot): void {
  const project = directorProjectForAssetProjection();
  if (project === null) throw new Error("请先打开一个专业导播项目。");
  const projection = buildDirectorAssetProjectionPlan(project, directorSelectedMode());
  const entry = slot === "first" ? projection.first : projection.last;
  if (entry === null) return;
  applyDirectorWorkspaceMutation(
    slot === "first" ? "清除专业导播第一张工作流图片" : "清除专业导播第二张工作流图片",
    (current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      bindings: current.bindings.filter((binding) => binding.bindingId !== entry.binding.bindingId)
    })
  );
  for (const legacy of productionBindingsForTarget(directorProductionState, "shot", entry.binding.targetId)
    .filter((candidate) => candidate.assetId === entry.binding.assetId && !candidate.archived)) {
    directorProductionState = archiveProductionBinding(directorProductionState, legacy.id);
  }
  directorP1Ui.setState(directorProductionState);
  markDirectorDirty();
  syncDirectorFrames();
  updateDirectorPreview();
}

async function clearFrame(slot: "first" | "last"): Promise<void> {
  if (activeRelayProject === null) throw new Error("请先打开一个 Relay 项目。");
  const context = captureProjectOperationContext();
  const project = projectWithQuickForm(activeRelayProject);
  const updated: RelayProjectDocument = {
    ...project,
    updatedAt: new Date().toISOString(),
    quick: {
      ...project.quick,
      [slot === "first" ? "firstFrameAssetId" : "lastFrameAssetId"]: null
    }
  };
  const saved = await persistRelayProject(updated);
  if (!isCurrentProjectOperation(context)) return;
  if (slot === "first") {
    firstFrame = null;
    firstFrameName.textContent = "未选择文件";
  } else {
    lastFrame = null;
    lastFrameName.textContent = "未选择文件";
  }
  if (directorWorkspace !== null) initializeDirectorWorkspace(saved);
  syncDirectorFrames();
  updateDirectorPreview();
}

firstFrameButton.addEventListener("click", () => {
  void chooseFrame("first").catch((error: unknown) => {
    showFeedback({ kind: "error", title: "无法选择首帧", message: publicError(error) });
  });
});
lastFrameButton.addEventListener("click", () => {
  void chooseFrame("last").catch((error: unknown) => {
    showFeedback({ kind: "error", title: "无法选择尾帧", message: publicError(error) });
  });
});
directorFirstFrameButton.addEventListener("click", () => {
  void chooseDirectorFrame("first").catch((error: unknown) => {
    showFeedback({ kind: "error", title: "无法选择参考图片", message: publicError(error) });
  });
});
directorLastFrameButton.addEventListener("click", () => {
  void chooseDirectorFrame("last").catch((error: unknown) => {
    showFeedback({ kind: "error", title: "无法选择参考图片", message: publicError(error) });
  });
});
directorClearFirstFrameButton.addEventListener("click", () => {
  try {
    clearDirectorFrame("first");
  } catch (error) {
    showFeedback({ kind: "error", title: "首帧未清除", message: publicError(error) });
  }
});
directorClearLastFrameButton.addEventListener("click", () => {
  try {
    clearDirectorFrame("last");
  } catch (error) {
    showFeedback({ kind: "error", title: "尾帧未清除", message: publicError(error) });
  }
});
directorOpenRefInstallButton.addEventListener("click", () => {
  showView("install");
  setGlobalStatus("请在组件清单中勾选并安装 Ref2VA 可选包。");
  window.requestAnimationFrame(() => {
    componentList.querySelector<HTMLElement>('[data-component-id="ref2va_optional"]')
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
});

function syncFrameControls(): void {
  firstFrameName.textContent = firstFrame?.displayName ?? "未选择文件";
  lastFrameName.textContent = lastFrame?.displayName ?? "未选择文件";
  const mode = selectedRadio<ProjectMode>("mode");
  const disabled = mode === "T2V";
  firstFrameButton.disabled = disabled;
  lastFrameButton.disabled = disabled;
  frameControls.classList.toggle("is-disabled", disabled);
  const referenceMode = mode === "REF2VA";
  frameControlsNote.textContent = disabled
    ? "当前为文字生成视频；切换到首尾帧或参考素材模式后可选择图片。"
    : referenceMode
      ? "参考素材模式可绑定 1–2 张本地参考图片。"
      : "首尾帧模式至少选择首帧或尾帧之一。";
  firstFrameLabel.textContent = referenceMode ? "参考图 1" : "首帧";
  lastFrameLabel.textContent = referenceMode ? "参考图 2（可选）" : "尾帧";
  lastFramePicker.classList.toggle("is-reference", referenceMode);
  if (turboOption !== null) turboOption.disabled = referenceMode;
  if (referenceMode && samplingProfile.value === "turbo_8") samplingProfile.value = "quality_20";
  samplingProfile.title = referenceMode
    ? "Ref2VA 可选 20 步标准或 25 步高质量；Turbo 当前不可用"
    : "选择已认证的采样配置";
  for (const option of projectDuration.options) {
    option.disabled = referenceMode && Number(option.value) > 15;
  }
  if (referenceMode && selectedDuration() > 15) {
    projectDuration.value = "15";
  }
  for (const option of segmentDuration.options) {
    option.disabled = referenceMode && Number(option.value) !== selectedDuration();
  }
  if (referenceMode) {
    segmentDuration.value = String(selectedDuration());
  }
  syncSegmentPlan();
}
for (const input of projectForm.querySelectorAll<HTMLInputElement>('input[name="mode"]')) {
  input.addEventListener("change", () => {
    syncFrameControls();
    scheduleQuickProjectSave();
  });
}
ref2vaModeCard.addEventListener("click", (event) => {
  if (ref2vaModeInput?.disabled !== true) return;
  event.preventDefault();
  showView("install");
  setGlobalStatus("请在组件清单中勾选并安装 Ref2VA 可选包。模式入口不会因缺少模型而隐藏。");
  window.requestAnimationFrame(() => {
    componentList.querySelector<HTMLElement>('[data-component-id="ref2va_optional"]')
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
});
syncFrameControls();
syncQuickSeedPolicyControls();
syncRef2vaAvailability();
seedPolicy.addEventListener("change", () => {
  syncQuickSeedPolicyControls();
  scheduleQuickProjectSave();
});
projectDuration.addEventListener("change", () => {
  syncFrameControls();
  syncSegmentPlan();
  scheduleQuickProjectSave();
});
segmentDuration.addEventListener("change", syncSegmentPlan);
projectCanvas.addEventListener("change", syncCanvasSummary);
projectResolution.addEventListener("change", syncCanvasSummary);
syncSegmentPlan();
syncCanvasSummary();
setSegmentRecommendation(null);

for (const input of [
  directorWorkflowName,
  directorCharacterBible,
  directorWorldBible,
  directorVisualStyleBible,
  directorContinuity,
  directorSoundscape,
  directorMusic,
  directorSubjects,
  directorSummary,
  directorRetention,
  directorStyleOpening,
  directorSeed
]) {
  input.addEventListener("input", () => {
    markDirectorDirty();
    updateDirectorPreview();
  });
}

directorLanguage.addEventListener("change", () => {
  markDirectorDirty();
  updateDirectorPreview();
});
directorMode.addEventListener("change", () => {
  markDirectorDirty();
  syncDirectorMode();
});
directorTotalDuration.addEventListener("change", () => {
  markDirectorDirty();
  if (directorSelectedMode() === "REF2VA") directorSegmentDuration.value = directorTotalDuration.value;
  syncDirectorMode();
});
directorSegmentDuration.addEventListener("change", () => {
  markDirectorDirty();
  materializeDirectorPlanFromControls("修改统一分段计划");
  updateDirectorPreview();
});
directorSeedPolicy.addEventListener("change", () => {
  syncDirectorSeedPolicyControls();
  markDirectorDirty();
  updateDirectorPreview();
});
syncDirectorSeedPolicyControls();
for (const input of [directorCanvas, directorResolution, directorSampling]) {
  input.addEventListener("change", () => {
    markDirectorDirty();
    updateDirectorPreview();
  });
}

directorUndoButton.addEventListener("click", () => {
  if (directorWorkspace === null) return;
  const metadataSource = activeRelayProject;
  directorWorkspace = undoProjectWorkspace(directorWorkspace, Date.now());
  directorWorkspace = synchronizeWorkspaceProfessionalMetadata(directorWorkspace, metadataSource);
  activeRelayProject = directorWorkspace.session.current;
  directorActiveShotId = activeRelayProject.professional.activeShotId;
  renderDirectorShots(directorProjectPlan(activeRelayProject));
  renderDirectorWorkspaceControls();
  scheduleDirectorWorkspaceAutosave();
});

directorRedoButton.addEventListener("click", () => {
  if (directorWorkspace === null) return;
  const metadataSource = activeRelayProject;
  directorWorkspace = redoProjectWorkspace(directorWorkspace, Date.now());
  directorWorkspace = synchronizeWorkspaceProfessionalMetadata(directorWorkspace, metadataSource);
  activeRelayProject = directorWorkspace.session.current;
  directorActiveShotId = activeRelayProject.professional.activeShotId;
  renderDirectorShots(directorProjectPlan(activeRelayProject));
  renderDirectorWorkspaceControls();
  scheduleDirectorWorkspaceAutosave();
});

directorHistoryButton.addEventListener("click", () => {
  directorHistoryDrawer.open = true;
  directorHistoryDrawer.scrollIntoView({ behavior: preferredScrollBehavior(), block: "center" });
  directorHistoryDrawer.querySelector<HTMLElement>("summary")?.focus({ preventScroll: true });
});

directorCurrentShotDuration.addEventListener("change", () => {
  const shot = directorWorkspace === null ? null : activeDirectorWorkspaceShot(directorWorkspace);
  const duration = Number(directorCurrentShotDuration.value);
  if (shot === null || (duration !== 5 && duration !== 10 && duration !== 15)) return;
  try {
    applyDirectorWorkspaceMutation("修改当前镜头时长", (project) => setDirectorShotDurations(project, {
      shotIds: [shot.shotId],
      durationSeconds: duration,
      updatedAt: new Date().toISOString()
    }), { rerenderTimeline: true });
  } catch (error) {
    renderDirectorWorkspaceControls();
    showFeedback({ kind: "error", title: "镜头时长未修改", message: publicError(error) });
  }
});

directorShotRestoreInheritance.addEventListener("click", () => {
  const shot = directorWorkspace === null ? null : activeDirectorWorkspaceShot(directorWorkspace);
  if (shot === null) return;
  try {
    applyDirectorWorkspaceMutation("恢复当前镜头开始状态继承", (source) => {
      let project = source;
      for (const field of RELAY_CONTINUITY_FIELDS) {
        if (project.shots.find((candidate) => candidate.shotId === shot.shotId)?.startState[field]?.locked === true) {
          project = setDirectorStateLock(project, {
            shotId: shot.shotId,
            phase: "start",
            field,
            locked: false,
            updatedAt: new Date().toISOString()
          });
        }
        project = restoreDirectorStateInheritance(project, {
          shotId: shot.shotId,
          phase: "start",
          field,
          updatedAt: new Date().toISOString()
        });
      }
      return project;
    });
  } catch (error) {
    showFeedback({ kind: "error", title: "继承状态未恢复", message: publicError(error) });
  }
});

directorShotLockState.addEventListener("click", () => {
  const shot = directorWorkspace === null ? null : activeDirectorWorkspaceShot(directorWorkspace);
  if (shot === null) return;
  const shouldLock = directorShotLockState.getAttribute("aria-pressed") !== "true";
  try {
    applyDirectorWorkspaceMutation(shouldLock ? "锁定当前镜头状态" : "解锁当前镜头状态", (source) => {
      let project = source;
      for (const phase of ["start", "end"] as const) {
        for (const field of RELAY_CONTINUITY_FIELDS) {
          project = setDirectorStateLock(project, {
            shotId: shot.shotId,
            phase,
            field,
            locked: shouldLock,
            updatedAt: new Date().toISOString()
          });
        }
      }
      return project;
    });
  } catch (error) {
    showFeedback({ kind: "error", title: "镜头状态锁定未修改", message: publicError(error) });
  }
});

function applyDirectorTransitionControls(label: string): void {
  const workspace = directorWorkspace;
  const shot = workspace === null ? null : activeDirectorWorkspaceShot(workspace);
  const following = shot === null || workspace === null ? null : nextDirectorShot(workspace.session.current, shot.shotId);
  if (following === null) return;
  const type: RelayTransitionType = directorShotTransitionKind.value === "hard_cut"
    ? "hard_cut"
    : "tail_frame_continuation";
  applyDirectorWorkspaceMutation(label, (project) => setDirectorTransition(project, {
    shotId: following.shotId,
    type,
    inheritedFields: directorTransitionFieldsFromControls(),
    assetId: directorShotTransitionAsset.value || null,
    updatedAt: new Date().toISOString()
  }));
}

directorShotTransitionKind.addEventListener("change", () => {
  try {
    applyDirectorTransitionControls("修改镜头衔接方式");
  } catch (error) {
    showFeedback({ kind: "error", title: "镜头衔接未修改", message: publicError(error) });
  }
});
directorShotTransitionAsset.addEventListener("change", () => {
  try {
    applyDirectorTransitionControls("修改镜头衔接素材");
  } catch (error) {
    showFeedback({ kind: "error", title: "衔接素材未修改", message: publicError(error) });
  }
});
for (const checkbox of [directorTransitionInheritSubject, directorTransitionInheritEnvironment, directorTransitionInheritAudio]) {
  checkbox.addEventListener("change", () => {
    try {
      applyDirectorTransitionControls("修改镜头衔接继承字段");
    } catch (error) {
      showFeedback({ kind: "error", title: "衔接继承范围未修改", message: publicError(error) });
    }
  });
}

directorShotBindAsset.addEventListener("click", () => {
  const select = document.getElementById("director-shot-project-asset-select") as HTMLSelectElement | null;
  if (select !== null && !select.disabled) {
    select.focus();
    return;
  }
  showView("assets");
  showFeedback({
    kind: "warning",
    title: "请先导入可用素材",
    message: directorShotBindAsset.dataset.emptyMessage
      ?? "已打开当前项目素材库。导入并通过本地预检后，即可回到专业导播选择素材关系。"
  });
});

directorProjectDataBindAsset.addEventListener("click", () => {
  const select = document.getElementById("director-project-data-asset-select") as HTMLSelectElement | null;
  if (select !== null && !select.disabled) {
    select.focus();
    return;
  }
  showView("assets");
  showFeedback({
    kind: "warning",
    title: "请先导入可用素材",
    message: "已打开当前项目素材库。导入并通过本地预检后，可回到“项目资料”区域建立记录关系。"
  });
});

directorSaveDraftButton.addEventListener("click", () => void saveDirectorDraft(false));
directorCompileButton.addEventListener("click", () => {
  if (directorCompileDispatchPending || directorCompileInFlightCount > 0) return;
  if (!installationComplete) {
    showEnvironmentRequiredDialog();
    return;
  }
  if (!validateDirectorForCompilation()) return;
  const project = directorProjectForAssetProjection();
  if (project === null || activeRelayProject === null || project.projectId !== activeRelayProject.projectId) {
    showFeedback({ kind: "error", title: "专业项目状态不可用", message: "请重新打开当前项目后再编译。" });
    return;
  }
  const context = Object.freeze({
    projectId: project.projectId,
    activationEpoch: activeProjectActivationEpoch
  });
  directorCompileDispatchPending = true;
  syncDirectorCompileButtonState();
  void (async () => {
    let dispatched = false;
    try {
      const preparedFrames = await prepareDirectorCompilationFrames(context);
      directorPendingCompilation = captureDirectorCompilation(preparedFrames);
      dispatched = true;
      window.setTimeout(() => projectForm.requestSubmit(), 0);
    } catch (error) {
      directorPendingCompilation = null;
      showFeedback({
        kind: "error",
        title: "镜头素材未能进入工作流",
        message: publicError(error)
      });
    } finally {
      if (!dispatched) {
        directorCompileDispatchPending = false;
        syncDirectorCompileButtonState();
      }
    }
  })();
});

renderDirectorShots();
syncDirectorFrames();
updateDirectorPreview();

element<HTMLButtonElement>("choose-export-directory").addEventListener("click", () => {
  void (async () => {
    const selection = await window.controlPlane.chooseExportDirectory();
    if (selection === null) return;
    exportDirectory = selection;
    element("export-directory-name").textContent = selection.displayPath;
  })().catch((error: unknown) => {
    showFeedback({ kind: "error", title: "无法更改工作流目录", message: publicError(error) });
  });
});

projectForm.addEventListener("input", (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) scheduleQuickProjectSave();
});
projectForm.addEventListener("change", (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) scheduleQuickProjectSave();
});

projectForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const submittedDirectorCompilation = directorPendingCompilation;
  directorPendingCompilation = null;
  directorCompileDispatchPending = false;
  if (submittedDirectorCompilation !== null) directorCompileInFlightCount += 1;
  syncDirectorCompileButtonState();
  void (async () => {
    try {
      if (!installationComplete) {
        showEnvironmentRequiredDialog();
        return;
      }
      if (activeRelayProject === null) {
        showFeedback({ kind: "warning", title: "请先打开项目", message: "工作流必须归属于 Relay 数据目录中的项目。" });
        showView("home");
        return;
      }

      let compileWorkflowName: string;
      let project: ProjectSpec;
      let relayProjectDocument: RelayProjectDocument;
      const compilationActivationEpoch = submittedDirectorCompilation?.activationEpoch ?? activeProjectActivationEpoch;
      if (submittedDirectorCompilation !== null) {
        if (activeRelayProject.projectId !== submittedDirectorCompilation.projectId
          || activeProjectActivationEpoch !== submittedDirectorCompilation.activationEpoch) {
          showFeedback({ kind: "warning", title: "项目已经切换", message: "本次专业导播编译已取消；请在当前项目重新点击编译。" });
          return;
        }
        const workflowName = validateWorkflowName(submittedDirectorCompilation.workflowName);
        if (!workflowName.ok) {
          showFeedback({ kind: "warning", title: "工作流名称无效", message: workflowName.message });
          directorWorkflowName.focus();
          return;
        }
        compileWorkflowName = workflowName.value;
        project = submittedDirectorCompilation.project;
        relayProjectDocument = activeRelayProject;
      } else {
        const workflowName = validateWorkflowName(workflowNameInput.value);
        if (!workflowName.ok) {
          workflowNameError.textContent = workflowName.message;
          workflowNameError.hidden = false;
          workflowNameInput.focus();
          return;
        }
        const prompt = projectPrompt.value;
        if (prompt.trim().length === 0) {
          promptError.hidden = false;
          projectPrompt.focus();
          return;
        }
        const mode = selectedRadio<ProjectMode>("mode");
        const frameIssue = requireFrames(mode);
        if (frameIssue !== null) {
          showFeedback({ kind: "warning", title: "请补充参考素材", message: frameIssue });
          return;
        }
        const seed = Number(projectSeed.value);
        const selectedSeedPolicy = seedPolicy.value as SeedPolicy;
        if (selectedSeedPolicy === "fixed" && (!Number.isSafeInteger(seed) || seed < 0)) {
          showFeedback({
            kind: "warning",
            title: "种子设置无效",
            message: "种子必须是 0 到 9007199254740991 之间的整数。"
          });
          element<HTMLDetailsElement>("advanced-options").open = true;
          projectSeed.focus();
          return;
        }
        compileWorkflowName = workflowName.value;
        project = Object.freeze({
          prompt,
          mode,
          firstFrameSelectionId: mode === "T2V" ? null : firstFrame?.selectionId ?? null,
          lastFrameSelectionId: mode === "T2V" ? null : lastFrame?.selectionId ?? null,
          durationSeconds: selectedDuration(),
          segmentDurationSeconds: selectedSegmentDuration(),
          canvas: projectCanvas.value as CanvasPreset,
          resolutionMegapixels: Number(projectResolution.value),
          advanced: Object.freeze({
            seed,
            seedPolicy: selectedSeedPolicy,
            samplingProfile: samplingProfile.value as SamplingProfile
          })
        });
        relayProjectDocument = await flushQuickProjectSave();
      }

      if (feedbackDialog.open) feedbackDialog.close();
      setGlobalStatus("正在编译、写入并交接本次工作流，请稍候…");
      if (submittedDirectorCompilation === null) {
        setProjectFormBusy(true);
        setButtonBusy(compileButton, true, "正在编译工作流…");
      }
      try {
        const result = await window.controlPlane.compileAndOpenWorkflow({
          workflowName: compileWorkflowName,
          project,
          exportDirectorySelectionId: exportDirectory?.selectionId ?? null,
          projectId: relayProjectDocument.projectId
        });
        const compilationProjectIsStillActive = (): boolean =>
          activeRelayProject?.projectId === relayProjectDocument.projectId
            && activeProjectActivationEpoch === compilationActivationEpoch;
        let projectStillActive = compilationProjectIsStillActive();
        let authorityAdopted = result.authoritativeProject === null
          ? result.handoff === "exported_mock_preview"
          : false;
        if (projectStillActive) {
          if (result.authoritativeProject !== null) {
            authorityAdopted = adoptCompiledProjectAuthority(
              result.authoritativeProject,
              relayProjectDocument.projectId,
              compilationActivationEpoch,
              result.workflowFileName,
              result.workflowLibraryDisplay
            );
          }
          if (!authorityAdopted && compilationProjectIsStillActive()) {
            const refreshedProject = await window.controlPlane.loadRelayProject({
              projectId: relayProjectDocument.projectId,
              activate: false
            });
            authorityAdopted = adoptCompiledProjectAuthority(
              refreshedProject,
              relayProjectDocument.projectId,
              compilationActivationEpoch,
              result.workflowFileName,
              result.workflowLibraryDisplay
            );
          }
        }
        projectStillActive = compilationProjectIsStillActive();
        if (projectStillActive && !authorityAdopted) {
          throw new Error("工作流已交接，但 Relay 未能同步项目最新版本；未继续覆盖当前项目，请重新载入后重试。");
        }
        const directorHistorySaved = submittedDirectorCompilation === null || !projectStillActive
          ? true
          : await markDirectorCompiled(submittedDirectorCompilation);
      const resultMessage = result.handoff === "loaded_visible_comfyui"
        ? "已在独立的本地 ComfyUI 窗口载入可编辑画布，可继续检查和调整节点、素材与参数。"
        : result.handoff === "visible_existing_graph_preserved"
          ? "新工作流已保存；检测到 ComfyUI 当前画布有未保存修改，因此没有自动替换。"
        : result.handoff === "stored_for_visible_selection"
          ? `未能确认前端自动载入；工作流已安全写入 ${result.workflowLibraryDisplay ?? "user/default/workflows"}，请在 ComfyUI 的 Workflows 中选择该文件。`
          : "已导出工作流；当前技术 Smoke 未打开外部窗口。";
      const resultDetail = `${result.exportDirectoryDisplay} · ${result.workflowFileName}${result.workflowLibraryDisplay === null ? "" : ` · ${result.workflowLibraryDisplay}`}`;
      showFeedback({
        kind: !projectStillActive || !directorHistorySaved
          ? "warning"
          : result.handoff === "loaded_visible_comfyui" || result.handoff === "exported_mock_preview"
          ? "success"
          : "warning",
        modal: result.handoff === "loaded_visible_comfyui" || result.handoff === "exported_mock_preview",
        title: !projectStillActive
          ? "工作流已打开，当前项目已切换"
          : !directorHistorySaved
          ? "工作流已打开，但历史未保存"
          : result.handoff === "loaded_visible_comfyui" ? "工作流已打开" : "工作流已保存",
        message: !projectStillActive
          ? `${resultMessage}\n交接期间已切换项目，Relay 没有把旧项目的编译状态写入当前项目，也没有自动切回。`
          : directorHistorySaved
          ? resultMessage
          : `${resultMessage}\n专业导播的本次编译历史未能写入项目，请保存草稿后重试。`,
        detail: resultDetail,
        seedResolution: result.seedResolution
      });
      setGlobalStatus(result.handoff === "loaded_visible_comfyui"
        ? "工作流已编译并在 ComfyUI 中打开。"
        : result.handoff === "visible_existing_graph_preserved"
          ? "工作流已保存；为保护 ComfyUI 当前未保存修改，画布没有被替换。"
        : result.handoff === "stored_for_visible_selection"
          ? "工作流已保存，但 ComfyUI 未能自动打开。"
          : "工作流已导出；当前未打开 ComfyUI。");
      if (projectStillActive) {
        await activateRelayProject(relayProjectDocument.projectId, submittedDirectorCompilation === null ? "project" : "director");
      }
      } catch (error) {
        showFeedback({ kind: "error", title: "工作流未完成", message: publicError(error) });
        setGlobalStatus("工作流未能完成导出或交接。");
      } finally {
        if (submittedDirectorCompilation === null) {
          setProjectFormBusy(false);
          setButtonBusy(compileButton, false, "编译并在 ComfyUI 中打开");
          compileButton.disabled = false;
        }
      }
    } finally {
      if (submittedDirectorCompilation !== null) {
        directorCompileInFlightCount = Math.max(0, directorCompileInFlightCount - 1);
      }
      syncDirectorCompileButtonState();
    }
  })();
});

void (async () => {
  try {
    const bootstrap = await window.controlPlane.getBootstrap();
    installRoot.value = bootstrap.savedSetup?.installRoot ?? bootstrap.recommendedInstallRoot;
    comfyUiRoot.value = bootstrap.savedSetup?.comfyUiRoot ?? "";
    modelRoot.value = bootstrap.savedSetup?.modelRoot ?? "";
    setSegmentRecommendation(bootstrap.savedSetup?.vramBytes ?? null);
    element("brand-name").textContent = bootstrap.appName;
    const visualVersion = formalVersionLabel(bootstrap.appVersion);
    element("header-version").textContent = visualVersion;
    aboutAppName.textContent = bootstrap.appName;
    aboutAppVersion.textContent = visualVersion;
    updateUi.setCurrentVersion(bootstrap.appVersion);
    aboutProductDescription.textContent = bootstrap.productDescription;
    aboutAuthorState.textContent = bootstrap.author;
    aboutAuthorTagline.textContent = bootstrap.authorTagline;
    aboutAuthorProfile.textContent = bootstrap.authorIntroductionUrl;
    updateUi.renderCheck(await window.controlPlane.getUpdateCheckCache().catch(() => null));
    await updateUi.restoreDownloadStatus().catch(() => undefined);
    const bothCli = bootstrap.adapterState.streamA === "stream_a_cli" && bootstrap.adapterState.streamB === "stream_b_cli";
    const usingMock = bootstrap.adapterState.streamA === "deterministic_mock" || bootstrap.adapterState.streamB === "deterministic_mock";
    const anyUnavailable = bootstrap.adapterState.streamA === "unavailable" || bootstrap.adapterState.streamB === "unavailable";
    element("adapter-label").textContent = bothCli
      ? "Relay 服务可用"
      : usingMock
        ? "界面演示模式"
        : "本机服务部分不可用";
    element("adapter-pill").classList.toggle("is-mock", usingMock);
    element("adapter-pill").classList.toggle("is-error", anyUnavailable && !usingMock);
    appShell.dataset.ready = "true";
    document.documentElement.dataset.appReady = "true";
    projectCenterState = await window.controlPlane.getProjectCenter();
    const initialProjectId = projectCenterState.activeProjectId
      ?? projectCenterState.recentProjects[0]?.projectId
      ?? null;
    if (initialProjectId !== null) {
      await activateRelayProject(initialProjectId, "home");
    } else {
      renderProjectCenter();
    }
    if (storedTheme !== null) persistTheme(storedTheme);
    if (bootstrap.savedSetup?.setupComplete === true) {
      restoredConfigurationReady = true;
      for (const component of bootstrap.savedSetup.completedComponents) {
        completedOptionalComponents.add(component);
      }
      setProjectAvailability(true, "已载入保存配置");
      syncRef2vaAvailability();
      await ensureAssetLibraryLoaded().catch((error: unknown) => {
        assetLibraryStatus.textContent = `素材库暂未载入：${publicError(error)}`;
        assetLibraryStatus.classList.add("is-error");
      });
      showView("home");
      setGlobalStatus("已载入并快速复核保存的 ComfyUI 与 H3 配置；没有重复执行全量扫描。");
    } else {
      await ensureAssetLibraryLoaded().catch((error: unknown) => {
        assetLibraryStatus.textContent = `素材库暂未载入：${publicError(error)}`;
        assetLibraryStatus.classList.add("is-error");
      });
      setGlobalStatus("应用已就绪，正在自动检测现有 ComfyUI 与 H3 模型。");
      showView("home");
      await runScan(true);
    }
  } catch (error) {
    element("adapter-label").textContent = "初始化失败";
    element("adapter-pill").classList.add("is-error");
    locationResults.hidden = false;
    managedRootSection.hidden = false;
    scanActions.hidden = false;
    scanStateBadge.textContent = "初始化未完成";
    scanError.textContent = `${publicError(error)} 请确认上方受管安装目录后重新检测；复用已有环境为可选。`;
    scanError.hidden = false;
  }
})();
