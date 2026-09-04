import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";

import type { IpcMainInvokeEvent } from "electron";
import { ipcMain } from "electron";

import {
  IPC_REGISTRY,
  type AboutLinkTarget,
  type AssetAvailability,
  type AssetCopyToProjectRequest,
  type AssetLibraryApi,
  type AssetListRequest,
  type AssetMediaType,
  type AssetMetadataUpdateRequest,
  type AssetPrepareFrameRequest,
  type AssetRelocateConfirmRequest,
  type AssetRelocateRequest,
  type CancelInstallationRequest,
  type CanvasPreset,
  type CompileAndOpenWorkflowRequest,
  type CompileAndOpenWorkflowResult,
  type ComponentId,
  type ControlPlaneApi,
  type DirectoryKind,
  type DurationSeconds,
  type ExecuteInstallationRequest,
  type FrameSlot,
  type PrepareInstallationRequest,
  type ProjectAdvancedOptions,
  type ProjectAssetBindRequestContract,
  type ProjectAssetFrameRequestContract,
  type ProjectAssetIdRequestContract,
  type ProjectAssetImportRequestContract,
  type ProjectAssetListRequestContract,
  type ProjectAssetResolvedImportRequestContract,
  type ProjectAssetUnbindRequestContract,
  type ProjectAssetUpdateRequestContract,
  type ProjectMode,
  type ConfigureDataRootRequest,
  type RelayProjectBundleRequest,
  type RelayProjectCloneRequest,
  type RelayProjectCreateRequest,
  type RelayProjectIdRequest,
  type RelayProjectLoadRequest,
  type RelayProjectSaveRequest,
  type RendererControlPlaneApi,
  type ProjectSpec,
  type QueryInstallationRequest,
  type ScanInstallationRequest,
  type SegmentDurationSeconds,
  type SegmentTransition,
  type UiTheme
} from "../shared/ipc-contract.js";
import type { UpdateDownloadKind } from "../shared/update-source.js";
import { normalizeRelayProject } from "../shared/project-domain.js";
import { normalizeRelaySeedPolicy } from "../shared/seed-policy.js";
import { validateWorkflowName } from "../shared/workflow-name.js";
import { toControlPlanePublicError } from "./services/errors.js";
import {
  isSelectableOptionalComponent,
  SELECTABLE_OPTIONAL_COMPONENT_COUNT
} from "./services/installation-component-policy.js";

type UnknownRecord = Record<string, unknown>;

const PROJECT_MODES = new Set<ProjectMode>(["T2V", "FL2VA", "REF2VA"]);
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
const FRAME_SLOTS = new Set<FrameSlot>(["first", "last"]);
const DIRECTORY_KINDS = new Set<DirectoryKind>(["install_root", "comfyui_root", "model_root"]);
const UI_THEMES = new Set<UiTheme>(["light", "dark"]);
const ABOUT_LINK_TARGETS = new Set<AboutLinkTarget>(["author", "repository"]);
const ASSET_MEDIA_TYPES = new Set<AssetMediaType>(["image", "video", "audio"]);
const ASSET_AVAILABILITY = new Set<AssetAvailability>(["available", "missing", "changed"]);
const ASSET_ID_PATTERN = /^asset-[0-9a-f]{32}$/u;
const ASSET_RELOCATION_TOKEN_PATTERN = /^relocate-[0-9a-f]{32}$/u;
const GENERATED_VIDEO_RESULT_ID_PATTERN = /^result-[a-z0-9][a-z0-9-]{7,127}$/u;
const WORKFLOW_HANDOFF_OPERATION_LIMIT = 16;
const WORKFLOW_HANDOFF_RESULT_TTL_MS = 120_000;
const MAX_DROPPED_PROJECT_ASSETS = 512;
const MAX_WINDOWS_PATH_LENGTH = 32_767;
const UPDATE_DOWNLOAD_KINDS = new Set<UpdateDownloadKind>(["setup"]);

export type ProjectCenterIpcController = Pick<RendererControlPlaneApi,
  | "getProjectCenter"
  | "createRelayProject"
  | "loadRelayProject"
  | "saveRelayProject"
  | "cloneRelayProject"
  | "archiveRelayProject"
  | "restoreRelayProject"
  | "chooseAndConfigureDataRoot"
  | "openDataRoot"
  | "importProjectAssets"
  | "listProjectAssets"
  | "updateProjectAsset"
  | "refreshProjectAssets"
  | "relocateProjectAsset"
  | "removeProjectAsset"
  | "listDeletedProjectAssets"
  | "restoreProjectAsset"
  | "getProjectAssetPreview"
  | "bindProjectAsset"
  | "unbindProjectAsset"
  | "revealProjectAsset"
  | "prepareProjectAssetFrame"
  | "copyProjectAssetIntoProject"
  | "exportRelayProjectBundle"
  | "importRelayProjectBundle"
> & {
  readonly importDroppedProjectAssets: (
    request: ProjectAssetResolvedImportRequestContract
  ) => ReturnType<RendererControlPlaneApi["importDroppedProjectAssets"]>;
};

type WorkflowHandoffOperation =
  | { readonly state: "pending" }
  | { readonly state: "succeeded"; readonly result: CompileAndOpenWorkflowResult }
  | { readonly state: "failed"; readonly error: ReturnType<typeof toControlPlanePublicError> };

const workflowHandoffOperations = new Map<string, WorkflowHandoffOperation>();

function invalidRequest(detail: string): never {
  const error = new Error(`INVALID_REQUEST: ${detail}`) as Error & {
    code?: string;
  };
  error.name = "ControlPlaneError";
  error.code = "INVALID_REQUEST";
  throw error;
}

function validateUiTheme(value: unknown): UiTheme {
  if (typeof value !== "string" || !UI_THEMES.has(value as UiTheme)) {
    return invalidRequest("UI theme is invalid");
  }
  return value as UiTheme;
}

function validateAboutLinkTarget(value: unknown): AboutLinkTarget {
  if (typeof value !== "string" || !ABOUT_LINK_TARGETS.has(value as AboutLinkTarget)) {
    return invalidRequest("about link target is invalid");
  }
  return value as AboutLinkTarget;
}

function requireExactRecord(
  value: unknown,
  allowedKeys: readonly string[],
  label: string
): UnknownRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return invalidRequest(`${label} must be an object`);
  }

  const keys = Object.keys(value).sort();
  const expected = [...allowedKeys].sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  ) {
    return invalidRequest(`${label} has unexpected fields`);
  }
  return value as UnknownRecord;
}

function requireBoundedString(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number
): string {
  if (
    typeof value !== "string" ||
    value.trim().length < minimum ||
    value.length > maximum ||
    value.includes("\u0000")
  ) {
    return invalidRequest(`${label} is invalid`);
  }
  return value;
}

function requireInstallRoot(value: unknown): string {
  const root = requireBoundedString(value, "installRoot", 3, 240);
  if (!/^[A-Za-z]:\\[^<>:"|?*]*$/.test(root)) {
    return invalidRequest("installRoot must be an absolute local Windows path");
  }
  return root;
}

function requireSelectionId(value: unknown, label: string): string | null {
  if (value === null) {
    return null;
  }
  const id = requireBoundedString(value, label, 1, 128);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    return invalidRequest(`${label} has an invalid format`);
  }
  return id;
}

function validateScanRequest(value: unknown): ScanInstallationRequest {
  const input = requireExactRecord(
    value,
    ["installRoot", "comfyUiRoot", "modelRoot"],
    "scan request"
  );
  return {
    installRoot: requireInstallRoot(input.installRoot),
    comfyUiRoot: input.comfyUiRoot === null ? null : requireInstallRoot(input.comfyUiRoot),
    modelRoot: input.modelRoot === null ? null : requireInstallRoot(input.modelRoot)
  };
}

function validatePrepareRequest(value: unknown): PrepareInstallationRequest {
  const input = requireExactRecord(
    value,
    ["installRoot", "selectedOptionalComponents"],
    "installation request"
  );
  if (!Array.isArray(input.selectedOptionalComponents)) {
    return invalidRequest("selectedOptionalComponents must be an array");
  }

  const selected = input.selectedOptionalComponents.map((component) => {
    if (!isSelectableOptionalComponent(component)) {
      return invalidRequest("selectedOptionalComponents contains a non-optional component");
    }
    return component;
  });
  if (selected.length > SELECTABLE_OPTIONAL_COMPONENT_COUNT || new Set(selected).size !== selected.length) {
    return invalidRequest("selectedOptionalComponents contains duplicates or too many entries");
  }

  return {
    installRoot: requireInstallRoot(input.installRoot),
    selectedOptionalComponents: selected
  };
}

function requireOperationId(value: unknown, label: string): string {
  const id = requireBoundedString(value, label, 8, 96);
  if (!/^[a-z0-9][a-z0-9_-]{7,95}$/u.test(id)) {
    return invalidRequest(`${label} has an invalid format`);
  }
  return id;
}

function validateExecuteInstallationRequest(value: unknown): ExecuteInstallationRequest {
  const input = requireExactRecord(
    value,
    ["planId", "installRoot"],
    "installation execution request"
  );
  return {
    planId: requireOperationId(input.planId, "planId"),
    installRoot: requireInstallRoot(input.installRoot)
  };
}

function validateQueryInstallationRequest(value: unknown): QueryInstallationRequest {
  const input = requireExactRecord(value, ["installationId"], "installation query request");
  return { installationId: requireOperationId(input.installationId, "installationId") };
}

function validateCancelInstallationRequest(value: unknown): CancelInstallationRequest {
  const input = requireExactRecord(value, ["installationId"], "installation cancellation request");
  return { installationId: requireOperationId(input.installationId, "installationId") };
}

function validateFrameSlot(value: unknown): FrameSlot {
  if (typeof value !== "string" || !FRAME_SLOTS.has(value as FrameSlot)) {
    return invalidRequest("frame slot is invalid");
  }
  return value as FrameSlot;
}

function validateDirectoryKind(value: unknown): DirectoryKind {
  if (typeof value !== "string" || !DIRECTORY_KINDS.has(value as DirectoryKind)) {
    return invalidRequest("directory kind is invalid");
  }
  return value as DirectoryKind;
}

function validateProjectSpec(value: unknown): ProjectSpec {
  const projectFields = [
    "prompt",
    "mode",
    "firstFrameSelectionId",
    "lastFrameSelectionId",
    "durationSeconds",
    "segmentDurationSeconds",
    "canvas",
    "resolutionMegapixels"
  ];
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.hasOwn(value, "advanced")
  ) projectFields.push("advanced");
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.hasOwn(value, "segmentDurationsSeconds")
  ) projectFields.push("segmentDurationsSeconds");
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.hasOwn(value, "segmentShotIds")
  ) projectFields.push("segmentShotIds");
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.hasOwn(value, "segmentTransitions")
  ) projectFields.push("segmentTransitions");
  const input = requireExactRecord(
    value,
    projectFields,
    "project"
  );
  if (typeof input.mode !== "string" || !PROJECT_MODES.has(input.mode as ProjectMode)) {
    return invalidRequest("project mode is invalid");
  }
  if (
    typeof input.durationSeconds !== "number" ||
    !Number.isSafeInteger(input.durationSeconds) ||
    input.durationSeconds < 5 ||
    input.durationSeconds > MAX_DIRECTOR_DURATION_SECONDS ||
    input.durationSeconds % 5 !== 0
  ) {
    return invalidRequest("project duration is invalid");
  }
  if (
    typeof input.segmentDurationSeconds !== "number" ||
    !SEGMENT_DURATIONS.has(input.segmentDurationSeconds as SegmentDurationSeconds)
  ) {
    return invalidRequest("project segment duration is invalid");
  }
  let segmentDurationsSeconds: readonly SegmentDurationSeconds[] | undefined;
  if (input.segmentDurationsSeconds !== undefined) {
    if (
      !Array.isArray(input.segmentDurationsSeconds) ||
      input.segmentDurationsSeconds.length === 0 ||
      input.segmentDurationsSeconds.length > 36 ||
      input.segmentDurationsSeconds.some((entry) => (
        typeof entry !== "number" || !SEGMENT_DURATIONS.has(entry as SegmentDurationSeconds)
      ))
    ) return invalidRequest("project segment durations are invalid");
    const total = input.segmentDurationsSeconds.reduce((sum: number, entry) => sum + Number(entry), 0);
    if (total !== input.durationSeconds) return invalidRequest("project segment durations do not match total duration");
    segmentDurationsSeconds = Object.freeze(input.segmentDurationsSeconds as SegmentDurationSeconds[]);
  }
  const segmentCount = segmentDurationsSeconds?.length
    ?? Math.ceil(input.durationSeconds / input.segmentDurationSeconds);
  let segmentShotIds: readonly string[] | undefined;
  if (input.segmentShotIds !== undefined) {
    if (
      !Array.isArray(input.segmentShotIds) ||
      input.segmentShotIds.length !== segmentCount ||
      input.segmentShotIds.some((entry) => typeof entry !== "string" || !/^shot-[a-z0-9][a-z0-9-]{7,127}$/u.test(entry)) ||
      new Set(input.segmentShotIds).size !== input.segmentShotIds.length
    ) return invalidRequest("project segment shot IDs are invalid");
    segmentShotIds = Object.freeze(input.segmentShotIds as string[]);
  }
  let segmentTransitions: readonly SegmentTransition[] | undefined;
  if (input.segmentTransitions !== undefined) {
    if (
      !Array.isArray(input.segmentTransitions) ||
      input.segmentTransitions.length !== segmentCount - 1 ||
      input.segmentTransitions.some(
        (entry) => typeof entry !== "string" || !SEGMENT_TRANSITIONS.has(entry as SegmentTransition)
      )
    ) return invalidRequest(
      "project segment transitions must match adjacent shots and use only hard_cut or tail_frame_continuation"
    );
    segmentTransitions = Object.freeze(input.segmentTransitions as SegmentTransition[]);
  }
  if (typeof input.canvas !== "string" || !CANVASES.has(input.canvas as CanvasPreset)) {
    return invalidRequest("project canvas is invalid");
  }
  if (
    typeof input.resolutionMegapixels !== "number" ||
    !Number.isFinite(input.resolutionMegapixels) ||
    input.resolutionMegapixels < 0.1 ||
    input.resolutionMegapixels > 16
  ) {
    return invalidRequest("project resolution megapixels is invalid");
  }
  const advanced = validateAdvancedOptions(input.advanced);

  return {
    prompt: requireBoundedString(input.prompt, "prompt", 1, 4_000),
    mode: input.mode as ProjectMode,
    firstFrameSelectionId: requireSelectionId(input.firstFrameSelectionId, "first frame selection"),
    lastFrameSelectionId: requireSelectionId(input.lastFrameSelectionId, "last frame selection"),
    durationSeconds: input.durationSeconds as DurationSeconds,
    segmentDurationSeconds: input.segmentDurationSeconds as SegmentDurationSeconds,
    ...(segmentDurationsSeconds === undefined ? {} : { segmentDurationsSeconds }),
    ...(segmentShotIds === undefined ? {} : { segmentShotIds }),
    ...(segmentTransitions === undefined ? {} : { segmentTransitions }),
    canvas: input.canvas as CanvasPreset,
    resolutionMegapixels: input.resolutionMegapixels,
    advanced
  };
}

function validateAdvancedOptions(value: unknown): ProjectAdvancedOptions {
  if (value === undefined) {
    return { seed: 1, seedPolicy: "random_per_compile", samplingProfile: "quality_20" };
  }
  const input = requireExactRecord(
    value,
    ["seed", "seedPolicy", "samplingProfile"],
    "project advanced options"
  );
  if (typeof input.seed !== "number" || !Number.isSafeInteger(input.seed) || input.seed < 0) {
    return invalidRequest("project seed is invalid");
  }
  if (input.seedPolicy !== "fixed" && input.seedPolicy !== "random_per_compile" && input.seedPolicy !== "randomize") {
    return invalidRequest("project seed policy is invalid");
  }
  if (
    input.samplingProfile !== "quality_20" &&
    input.samplingProfile !== "quality_25" &&
    input.samplingProfile !== "turbo_8"
  ) {
    return invalidRequest("project sampling profile is invalid");
  }
  return {
    seed: input.seed,
    seedPolicy: normalizeRelaySeedPolicy(input.seedPolicy),
    samplingProfile: input.samplingProfile
  };
}

function validateCompileRequest(value: unknown): CompileAndOpenWorkflowRequest {
  const hasProjectId = typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.hasOwn(value, "projectId");
  const input = requireExactRecord(
    value,
    ["workflowName", "project", "exportDirectorySelectionId", ...(hasProjectId ? ["projectId"] : [])],
    "workflow request"
  );
  const workflowName = validateWorkflowName(input.workflowName);
  if (!workflowName.ok) return invalidRequest(workflowName.message);
  const project = validateProjectSpec(input.project);
  if (project.mode === "FL2VA"
    && project.firstFrameSelectionId === null
    && project.lastFrameSelectionId === null) {
    return invalidRequest("FL2VA requires at least one endpoint image");
  }
  if (project.mode === "REF2VA"
    && project.firstFrameSelectionId === null
    && project.lastFrameSelectionId === null) {
    return invalidRequest("REF2VA requires at least one reference image");
  }
  if (project.mode === "REF2VA" && project.advanced?.samplingProfile === "turbo_8") {
    return invalidRequest("REF2VA supports quality_20 or quality_25, but not turbo_8");
  }
  if (project.mode === "T2V"
    && (project.firstFrameSelectionId !== null || project.lastFrameSelectionId !== null)) {
    return invalidRequest("T2V does not accept endpoint images");
  }
  return {
    workflowName: workflowName.value,
    project,
    ...(hasProjectId ? { projectId: input.projectId === null ? null : validateStableProjectId(input.projectId) } : {}),
    exportDirectorySelectionId: requireSelectionId(
      input.exportDirectorySelectionId,
      "export directory selection"
    )
  };
}

function validateStableProjectId(value: unknown): string {
  if (typeof value !== "string" || !/^project-[a-z0-9][a-z0-9-]{7,127}$/u.test(value)) {
    return invalidRequest("project id is invalid");
  }
  return value;
}

function requireTrustedMainFrame(
  event: IpcMainInvokeEvent,
  expectedRendererUrl: string
): void {
  if (
    event.senderFrame === null ||
    event.senderFrame !== event.sender.mainFrame ||
    event.senderFrame.url !== expectedRendererUrl
  ) {
    throw new Error("IPC.SENDER_NOT_TRUSTED");
  }
}

function requireNoInput(value: unknown, label: string): void {
  if (value !== undefined) {
    invalidRequest(`${label} does not accept input`);
  }
}

function validateWorkflowHandoffQuery(value: unknown): string {
  const record = requireExactRecord(value, ["operationId"], "workflow handoff query");
  const operationId = record.operationId;
  if (
    typeof operationId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(operationId)
  ) {
    return invalidRequest("workflow handoff operation id is invalid");
  }
  return operationId;
}

function validateAssetId(value: unknown): string {
  if (typeof value !== "string" || !ASSET_ID_PATTERN.test(value)) {
    return invalidRequest("asset id is invalid");
  }
  return value;
}

function validateAssetTags(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 32) return invalidRequest("asset tags are invalid");
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (
      typeof candidate !== "string" || candidate.trim().length === 0 ||
      candidate.length > 48 || candidate.includes("\u0000")
    ) return invalidRequest("asset tag is invalid");
    const tag = candidate.trim();
    const key = tag.toLocaleLowerCase("zh-CN");
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return Object.freeze(tags);
}

function validateAssetListRequest(value: unknown): AssetListRequest {
  const input = requireExactRecord(value, ["query", "mediaType", "availability", "tags"], "asset list request");
  if (
    typeof input.query !== "string" || input.query.length > 200 || input.query.includes("\u0000") ||
    (input.mediaType !== "all" && (typeof input.mediaType !== "string" || !ASSET_MEDIA_TYPES.has(input.mediaType as AssetMediaType))) ||
    (input.availability !== "all" && (typeof input.availability !== "string" || !ASSET_AVAILABILITY.has(input.availability as AssetAvailability)))
  ) return invalidRequest("asset list filter is invalid");
  return Object.freeze({
    query: input.query,
    mediaType: input.mediaType as AssetMediaType | "all",
    availability: input.availability as AssetAvailability | "all",
    tags: validateAssetTags(input.tags)
  });
}

function validateAssetMetadataUpdate(value: unknown): AssetMetadataUpdateRequest {
  const input = requireExactRecord(value, ["assetId", "displayName", "tags", "note"], "asset metadata update");
  return Object.freeze({
    assetId: validateAssetId(input.assetId),
    displayName: requireBoundedString(input.displayName, "asset display name", 1, 160).trim(),
    tags: validateAssetTags(input.tags),
    note: typeof input.note === "string" && input.note.length <= 4_000 && !input.note.includes("\u0000")
      ? input.note
      : invalidRequest("asset note is invalid")
  });
}

function validateAssetRelocate(value: unknown): AssetRelocateRequest {
  const input = requireExactRecord(value, ["assetId"], "asset relocate request");
  return Object.freeze({ assetId: validateAssetId(input.assetId) });
}

function validateAssetRelocateConfirm(value: unknown): AssetRelocateConfirmRequest {
  const input = requireExactRecord(
    value,
    ["assetId", "relocationToken", "acceptReplacement"],
    "asset replacement confirmation"
  );
  if (
    typeof input.relocationToken !== "string" ||
    !ASSET_RELOCATION_TOKEN_PATTERN.test(input.relocationToken) ||
    typeof input.acceptReplacement !== "boolean"
  ) return invalidRequest("asset replacement confirmation is invalid");
  return Object.freeze({
    assetId: validateAssetId(input.assetId),
    relocationToken: input.relocationToken,
    acceptReplacement: input.acceptReplacement
  });
}

function validateAssetCopy(value: unknown): AssetCopyToProjectRequest {
  const input = requireExactRecord(value, ["assetId"], "asset copy request");
  return Object.freeze({ assetId: validateAssetId(input.assetId) });
}

function validateAssetPrepareFrame(value: unknown): AssetPrepareFrameRequest {
  const input = requireExactRecord(value, ["assetId", "slot"], "asset frame request");
  return Object.freeze({
    assetId: validateAssetId(input.assetId),
    slot: validateFrameSlot(input.slot)
  });
}

function validateRelayProjectIdRequest(value: unknown): RelayProjectIdRequest {
  const input = requireExactRecord(value, ["projectId"], "Relay project request");
  return Object.freeze({ projectId: validateStableProjectId(input.projectId) });
}

function validateRelayProjectLoadRequest(value: unknown): RelayProjectLoadRequest {
  const input = requireExactRecord(value, ["projectId", "activate"], "Relay project load request");
  if (typeof input.activate !== "boolean") return invalidRequest("project activation intent is invalid");
  return Object.freeze({ projectId: validateStableProjectId(input.projectId), activate: input.activate });
}

function validateRelayProjectCreate(value: unknown): RelayProjectCreateRequest {
  const input = requireExactRecord(value, ["name"], "Relay project creation request");
  return Object.freeze({
    name: requireBoundedString(input.name, "project name", 1, 160).trim()
  });
}

function validateRelayProjectClone(value: unknown): RelayProjectCloneRequest {
  const input = requireExactRecord(value, ["projectId", "name"], "Relay project clone request");
  return Object.freeze({
    projectId: validateStableProjectId(input.projectId),
    name: requireBoundedString(input.name, "project copy name", 1, 160).trim()
  });
}

function validateRelayProjectSave(value: unknown): RelayProjectSaveRequest {
  const input = requireExactRecord(value, ["project", "expectedUpdatedAt"], "Relay project save request");
  const project = normalizeRelayProject(input.project);
  if (
    input.expectedUpdatedAt !== null &&
    (typeof input.expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(input.expectedUpdatedAt)))
  ) return invalidRequest("expected project revision is invalid");
  return Object.freeze({
    project,
    expectedUpdatedAt: input.expectedUpdatedAt as string | null
  });
}

function validateConfigureDataRoot(value: unknown): ConfigureDataRootRequest {
  const input = requireExactRecord(value, ["mode"], "data directory request");
  if (input.mode !== "new_library" && input.mode !== "migrate") {
    return invalidRequest("data directory operation is invalid");
  }
  return Object.freeze({ mode: input.mode });
}

function validateProjectAssetImport(value: unknown): ProjectAssetImportRequestContract {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return invalidRequest("project asset import request must be an object");
  }
  const input = value as UnknownRecord;
  if (
    !Object.hasOwn(input, "projectId") ||
    Object.keys(input).some((key) => key !== "projectId" && key !== "mode") ||
    (input.mode !== undefined && input.mode !== "copy" && input.mode !== "reference")
  ) return invalidRequest("project asset import request is invalid");
  return Object.freeze({
    projectId: validateStableProjectId(input.projectId),
    ...(input.mode === undefined ? {} : { mode: input.mode })
  });
}

function validateDroppedProjectAssetPath(value: unknown, index: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_WINDOWS_PATH_LENGTH ||
    value.trim() !== value ||
    /[\u0000-\u001f]/u.test(value) ||
    !isAbsolute(value) ||
    /^\\\\[.?]\\/u.test(value) ||
    (/^[A-Za-z]:/u.test(value) && value.slice(2).includes(":"))
  ) {
    return invalidRequest(`dropped project asset path ${index + 1} is invalid`);
  }
  return value;
}

function validateDroppedProjectAssetImport(value: unknown): ProjectAssetResolvedImportRequestContract {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return invalidRequest("dropped project asset import request must be an object");
  }
  const input = value as UnknownRecord;
  if (
    !Object.hasOwn(input, "projectId") || !Object.hasOwn(input, "paths") ||
    Object.keys(input).some((key) => key !== "projectId" && key !== "mode" && key !== "paths") ||
    (input.mode !== undefined && input.mode !== "copy" && input.mode !== "reference")
  ) return invalidRequest("dropped project asset import request is invalid");
  if (!Array.isArray(input.paths) || input.paths.length === 0 || input.paths.length > MAX_DROPPED_PROJECT_ASSETS) {
    return invalidRequest("dropped project asset path count is invalid");
  }
  return Object.freeze({
    projectId: validateStableProjectId(input.projectId),
    mode: input.mode === "reference" ? "reference" : "copy",
    paths: Object.freeze(input.paths.map((path, index) => validateDroppedProjectAssetPath(path, index)))
  });
}

function validateProjectAssetList(value: unknown): ProjectAssetListRequestContract {
  const input = requireExactRecord(
    value,
    ["projectId", "query", "mediaType", "availability", "tags"],
    "project asset list request"
  );
  const mediaTypes = new Set(["all", "image", "video", "audio"]);
  const availability = new Set([
    "all", "available", "needs_conversion", "missing", "changed", "incompatible", "inspection_failed"
  ]);
  if (typeof input.query !== "string" || input.query.length > 200 || input.query.includes("\u0000")) {
    return invalidRequest("project asset query is invalid");
  }
  if (typeof input.mediaType !== "string" || !mediaTypes.has(input.mediaType)) {
    return invalidRequest("project asset media type is invalid");
  }
  if (typeof input.availability !== "string" || !availability.has(input.availability)) {
    return invalidRequest("project asset availability is invalid");
  }
  return Object.freeze({
    projectId: validateStableProjectId(input.projectId),
    query: input.query,
    mediaType: input.mediaType as ProjectAssetListRequestContract["mediaType"],
    availability: input.availability as ProjectAssetListRequestContract["availability"],
    tags: validateAssetTags(input.tags)
  });
}

function validateProjectAssetUpdate(value: unknown): ProjectAssetUpdateRequestContract {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return invalidRequest("project asset update must be an object");
  const input = value as UnknownRecord;
  const allowed = new Set(["projectId", "assetId", "displayName", "tags", "notes"]);
  if (Object.keys(input).some((key) => !allowed.has(key)) || !Object.hasOwn(input, "projectId") || !Object.hasOwn(input, "assetId")) {
    return invalidRequest("project asset update has unexpected fields");
  }
  const result: ProjectAssetUpdateRequestContract = {
    projectId: validateStableProjectId(input.projectId),
    assetId: validateAssetId(input.assetId),
    ...(input.displayName === undefined ? {} : {
      displayName: requireBoundedString(input.displayName, "asset display name", 1, 160).trim()
    }),
    ...(input.tags === undefined ? {} : { tags: validateAssetTags(input.tags) }),
    ...(input.notes === undefined ? {} : {
      notes: typeof input.notes === "string" && input.notes.length <= 4_000 && !input.notes.includes("\u0000")
        ? input.notes
        : invalidRequest("asset notes are invalid")
    })
  };
  return Object.freeze(result);
}

function validateProjectAssetIdRequest(value: unknown): ProjectAssetIdRequestContract {
  const input = requireExactRecord(value, ["projectId", "assetId"], "project asset request");
  return Object.freeze({
    projectId: validateStableProjectId(input.projectId),
    assetId: validateAssetId(input.assetId)
  });
}

function validateProjectAssetFrameRequest(value: unknown): ProjectAssetFrameRequestContract {
  const input = requireExactRecord(
    value,
    ["projectId", "assetId", "slot"],
    "project asset frame request"
  );
  return Object.freeze({
    projectId: validateStableProjectId(input.projectId),
    assetId: validateAssetId(input.assetId),
    slot: validateFrameSlot(input.slot)
  });
}

function validateProjectAssetBind(value: unknown): ProjectAssetBindRequestContract {
  const input = requireExactRecord(
    value,
    ["projectId", "targetKind", "targetId", "assetId", "purpose", "notes"],
    "project asset binding request"
  );
  const targetKinds = new Set(["project", "entity", "scene", "shot"]);
  const purposes = new Set([
    "first_frame", "last_frame", "subject_reference", "product_reference", "scene_reference",
    "style_reference", "motion_reference", "video_reference", "audio_reference", "continuity_reference"
  ]);
  if (typeof input.targetKind !== "string" || !targetKinds.has(input.targetKind)) return invalidRequest("asset binding target kind is invalid");
  if (typeof input.purpose !== "string" || !purposes.has(input.purpose)) return invalidRequest("asset binding purpose is invalid");
  const targetId = requireBoundedString(input.targetId, "asset binding target", 8, 160);
  if (!/^(project|entity|scene|shot)-[a-z0-9][a-z0-9-]{7,127}$/u.test(targetId)) return invalidRequest("asset binding target id is invalid");
  if (typeof input.notes !== "string" || input.notes.length > 2_000 || input.notes.includes("\u0000")) return invalidRequest("asset binding notes are invalid");
  return Object.freeze({
    projectId: validateStableProjectId(input.projectId),
    targetKind: input.targetKind as ProjectAssetBindRequestContract["targetKind"],
    targetId,
    assetId: validateAssetId(input.assetId),
    purpose: input.purpose as ProjectAssetBindRequestContract["purpose"],
    notes: input.notes
  });
}

function validateProjectAssetUnbind(value: unknown): ProjectAssetUnbindRequestContract {
  const input = requireExactRecord(value, ["projectId", "bindingId"], "project asset unbind request");
  const bindingId = requireBoundedString(input.bindingId, "asset binding id", 8, 160);
  if (!/^binding-[a-z0-9][a-z0-9-]{7,127}$/u.test(bindingId)) return invalidRequest("asset binding id is invalid");
  return Object.freeze({ projectId: validateStableProjectId(input.projectId), bindingId });
}

function validateRelayProjectBundle(value: unknown): RelayProjectBundleRequest {
  const input = requireExactRecord(value, ["projectId", "externalReferencePolicy"], "project bundle request");
  if (input.externalReferencePolicy !== "exclude" && input.externalReferencePolicy !== "copy") {
    return invalidRequest("project bundle external reference policy is invalid");
  }
  return Object.freeze({
    projectId: validateStableProjectId(input.projectId),
    externalReferencePolicy: input.externalReferencePolicy
  });
}

function validateUpdateDownloadRequest(value: unknown): { readonly kind: UpdateDownloadKind } {
  const input = requireExactRecord(value, ["kind"], "update download request");
  if (typeof input.kind !== "string" || !UPDATE_DOWNLOAD_KINDS.has(input.kind as UpdateDownloadKind)) {
    return invalidRequest("update download kind is invalid");
  }
  return Object.freeze({ kind: input.kind as UpdateDownloadKind });
}

function validateGeneratedVideoIdRequest(value: unknown): {
  readonly projectId: string;
  readonly resultId: string;
} {
  const input = requireExactRecord(value, ["projectId", "resultId"], "generated video request");
  const resultId = requireBoundedString(input.resultId, "generated video result id", 8, 160);
  if (!GENERATED_VIDEO_RESULT_ID_PATTERN.test(resultId)) {
    return invalidRequest("generated video result id is invalid");
  }
  return Object.freeze({ projectId: validateStableProjectId(input.projectId), resultId });
}

function startWorkflowHandoffOperation(
  services: ControlPlaneApi,
  request: CompileAndOpenWorkflowRequest
): { readonly operationId: string } {
  if (workflowHandoffOperations.size >= WORKFLOW_HANDOFF_OPERATION_LIMIT) {
    invalidRequest("too many workflow handoff operations are active");
  }
  const operationId = randomUUID();
  workflowHandoffOperations.set(operationId, Object.freeze({ state: "pending" }));
  setImmediate(() => {
    void services.compileAndOpenWorkflow(request).then(
      (result) => {
        workflowHandoffOperations.set(
          operationId,
          Object.freeze({ state: "succeeded", result })
        );
      },
      (error: unknown) => {
        workflowHandoffOperations.set(
          operationId,
          Object.freeze({ state: "failed", error: toControlPlanePublicError(error) })
        );
      }
    ).finally(() => {
      const timer = setTimeout(
        () => workflowHandoffOperations.delete(operationId),
        WORKFLOW_HANDOFF_RESULT_TTL_MS
      );
      timer.unref();
    });
  });
  return Object.freeze({ operationId });
}

export function registerClosedIpcRegistry(
  expectedRendererUrl: string,
  services: ControlPlaneApi,
  assetLibrary: AssetLibraryApi,
  projectCenter: ProjectCenterIpcController,
  setUiTheme: (theme: UiTheme) => Promise<void>,
  openAboutLink: (target: AboutLinkTarget) => Promise<boolean>
): void {
  const trusted = <T>(
    handler: (event: IpcMainInvokeEvent, input: unknown) => Promise<T>
  ) => (event: IpcMainInvokeEvent, input?: unknown) => {
    requireTrustedMainFrame(event, expectedRendererUrl);
    return handler(event, input);
  };

  ipcMain.handle(
    IPC_REGISTRY.getBootstrap,
    trusted(() => services.getBootstrap())
  );
  ipcMain.handle(
    IPC_REGISTRY.scanInstallation,
    trusted((_event, input) => services.scanInstallation(validateScanRequest(input)))
  );
  ipcMain.handle(
    IPC_REGISTRY.prepareInstallation,
    trusted((_event, input) => services.prepareInstallation(validatePrepareRequest(input)))
  );
  ipcMain.handle(
    IPC_REGISTRY.executeInstallation,
    trusted((_event, input) =>
      services.executeInstallation(validateExecuteInstallationRequest(input))
    )
  );
  ipcMain.handle(
    IPC_REGISTRY.queryInstallation,
    trusted((_event, input) =>
      services.queryInstallation(validateQueryInstallationRequest(input))
    )
  );
  ipcMain.handle(
    IPC_REGISTRY.cancelInstallation,
    trusted((_event, input) =>
      services.cancelInstallation(validateCancelInstallationRequest(input))
    )
  );
  ipcMain.handle(
    IPC_REGISTRY.chooseDirectory,
    trusted((_event, input) => services.chooseDirectory(validateDirectoryKind(input)))
  );
  ipcMain.handle(
    IPC_REGISTRY.chooseFrame,
    trusted((_event, input) => services.chooseFrame(validateFrameSlot(input)))
  );
  ipcMain.handle(
    IPC_REGISTRY.chooseResultMedia,
    trusted((_event, input) => {
      requireNoInput(input, "result media selection");
      return services.chooseResultMedia();
    })
  );
  ipcMain.handle(
    IPC_REGISTRY.chooseExportDirectory,
    trusted(() => services.chooseExportDirectory())
  );
  ipcMain.handle(
    IPC_REGISTRY.importLocalAssets,
    trusted((_event, input) => {
      requireNoInput(input, "local asset import");
      return assetLibrary.importLocalAssets();
    })
  );
  ipcMain.handle(
    IPC_REGISTRY.listLocalAssets,
    trusted((_event, input) => assetLibrary.listLocalAssets(validateAssetListRequest(input)))
  );
  ipcMain.handle(
    IPC_REGISTRY.updateLocalAsset,
    trusted((_event, input) => assetLibrary.updateLocalAsset(validateAssetMetadataUpdate(input)))
  );
  ipcMain.handle(
    IPC_REGISTRY.refreshLocalAssets,
    trusted((_event, input) => {
      requireNoInput(input, "local asset refresh");
      return assetLibrary.refreshLocalAssets();
    })
  );
  ipcMain.handle(
    IPC_REGISTRY.relocateLocalAsset,
    trusted((_event, input) => assetLibrary.relocateLocalAsset(validateAssetRelocate(input)))
  );
  ipcMain.handle(
    IPC_REGISTRY.confirmLocalAssetReplacement,
    trusted((_event, input) =>
      assetLibrary.confirmLocalAssetReplacement(validateAssetRelocateConfirm(input))
    )
  );
  ipcMain.handle(
    IPC_REGISTRY.copyLocalAssetToProject,
    trusted((_event, input) => assetLibrary.copyLocalAssetToProject(validateAssetCopy(input)))
  );
  ipcMain.handle(
    IPC_REGISTRY.prepareLocalAssetFrame,
    trusted((_event, input) => assetLibrary.prepareLocalAssetFrame(validateAssetPrepareFrame(input)))
  );
  ipcMain.handle(
    IPC_REGISTRY.setUiTheme,
    trusted((_event, input) => setUiTheme(validateUiTheme(input)))
  );
  ipcMain.handle(
    IPC_REGISTRY.getProjectCenter,
    trusted((_event, input) => {
      requireNoInput(input, "project center");
      return projectCenter.getProjectCenter();
    })
  );
  ipcMain.handle(
    IPC_REGISTRY.createRelayProject,
    trusted((_event, input) => projectCenter.createRelayProject(validateRelayProjectCreate(input)))
  );
  ipcMain.handle(
    IPC_REGISTRY.loadRelayProject,
    trusted((_event, input) => projectCenter.loadRelayProject(validateRelayProjectLoadRequest(input)))
  );
  ipcMain.handle(
    IPC_REGISTRY.saveRelayProject,
    trusted((_event, input) => projectCenter.saveRelayProject(validateRelayProjectSave(input)))
  );
  ipcMain.handle(
    IPC_REGISTRY.cloneRelayProject,
    trusted((_event, input) => projectCenter.cloneRelayProject(validateRelayProjectClone(input)))
  );
  ipcMain.handle(
    IPC_REGISTRY.archiveRelayProject,
    trusted((_event, input) => projectCenter.archiveRelayProject(validateRelayProjectIdRequest(input)))
  );
  ipcMain.handle(
    IPC_REGISTRY.restoreRelayProject,
    trusted((_event, input) => projectCenter.restoreRelayProject(validateRelayProjectIdRequest(input)))
  );
  ipcMain.handle(
    IPC_REGISTRY.chooseAndConfigureDataRoot,
    trusted((_event, input) => projectCenter.chooseAndConfigureDataRoot(validateConfigureDataRoot(input)))
  );
  ipcMain.handle(
    IPC_REGISTRY.openDataRoot,
    trusted((_event, input) => {
      requireNoInput(input, "open data directory");
      return projectCenter.openDataRoot();
    })
  );
  ipcMain.handle(
    IPC_REGISTRY.getUpdateCheckCache,
    trusted((_event, input) => {
      requireNoInput(input, "get update check cache");
      return services.getUpdateCheckCache();
    })
  );
  ipcMain.handle(
    IPC_REGISTRY.checkForUpdates,
    trusted((_event, input) => {
      requireNoInput(input, "check for updates");
      return services.checkForUpdates();
    })
  );
  ipcMain.handle(
    IPC_REGISTRY.downloadUpdate,
    trusted((_event, input) => services.downloadUpdate(validateUpdateDownloadRequest(input)))
  );
  ipcMain.handle(
    IPC_REGISTRY.getUpdateDownloadStatus,
    trusted((_event, input) => {
      requireNoInput(input, "get update download status");
      return services.getUpdateDownloadStatus();
    })
  );
  ipcMain.handle(
    IPC_REGISTRY.cancelUpdateDownload,
    trusted((_event, input) => {
      requireNoInput(input, "cancel update download");
      return services.cancelUpdateDownload();
    })
  );
  ipcMain.handle(
    IPC_REGISTRY.openDownloadedUpdateFolder,
    trusted((_event, input) => {
      requireNoInput(input, "open downloaded update folder");
      return services.openDownloadedUpdateFolder();
    })
  );
  ipcMain.handle(
    IPC_REGISTRY.openValidatedReleasePage,
    trusted((_event, input) => {
      requireNoInput(input, "open validated release page");
      return services.openValidatedReleasePage();
    })
  );
  ipcMain.handle(
    IPC_REGISTRY.openAboutLink,
    trusted((_event, input) => openAboutLink(validateAboutLinkTarget(input)))
  );
  ipcMain.handle(
    IPC_REGISTRY.listGeneratedVideos,
    trusted((_event, input) => services.listGeneratedVideos(validateRelayProjectIdRequest(input)))
  );
  ipcMain.handle(
    IPC_REGISTRY.supplementGeneratedVideo,
    trusted((_event, input) => services.supplementGeneratedVideo(validateRelayProjectIdRequest(input)))
  );
  ipcMain.handle(
    IPC_REGISTRY.getGeneratedVideoPreview,
    trusted((_event, input) => services.getGeneratedVideoPreview(validateGeneratedVideoIdRequest(input)))
  );
  ipcMain.handle(
    IPC_REGISTRY.playGeneratedVideo,
    trusted((_event, input) => services.playGeneratedVideo(validateGeneratedVideoIdRequest(input)))
  );
  ipcMain.handle(
    IPC_REGISTRY.showGeneratedVideoInFolder,
    trusted((_event, input) => services.showGeneratedVideoInFolder(validateGeneratedVideoIdRequest(input)))
  );
  ipcMain.handle(
    IPC_REGISTRY.addGeneratedVideoToProjectAssets,
    trusted((_event, input) => services.addGeneratedVideoToProjectAssets(validateGeneratedVideoIdRequest(input)))
  );
  ipcMain.handle(
    IPC_REGISTRY.importProjectAssets,
    trusted((_event, input) => projectCenter.importProjectAssets(validateProjectAssetImport(input)))
  );
  ipcMain.handle(
    IPC_REGISTRY.importDroppedProjectAssets,
    trusted((_event, input) => projectCenter.importDroppedProjectAssets(validateDroppedProjectAssetImport(input)))
  );
  ipcMain.handle(
    IPC_REGISTRY.listProjectAssets,
    trusted((_event, input) => projectCenter.listProjectAssets(validateProjectAssetList(input)))
  );
  ipcMain.handle(
    IPC_REGISTRY.updateProjectAsset,
    trusted((_event, input) => projectCenter.updateProjectAsset(validateProjectAssetUpdate(input)))
  );
  ipcMain.handle(
    IPC_REGISTRY.refreshProjectAssets,
    trusted((_event, input) => projectCenter.refreshProjectAssets(validateRelayProjectIdRequest(input)))
  );
  ipcMain.handle(
    IPC_REGISTRY.relocateProjectAsset,
    trusted((_event, input) => projectCenter.relocateProjectAsset(validateProjectAssetIdRequest(input)))
  );
  ipcMain.handle(
    IPC_REGISTRY.removeProjectAsset,
    trusted((_event, input) => projectCenter.removeProjectAsset(validateProjectAssetIdRequest(input)))
  );
  ipcMain.handle(
    IPC_REGISTRY.listDeletedProjectAssets,
    trusted((_event, input) => projectCenter.listDeletedProjectAssets(validateRelayProjectIdRequest(input)))
  );
  ipcMain.handle(
    IPC_REGISTRY.restoreProjectAsset,
    trusted((_event, input) => projectCenter.restoreProjectAsset(validateProjectAssetIdRequest(input)))
  );
  ipcMain.handle(
    IPC_REGISTRY.getProjectAssetPreview,
    trusted((_event, input) => projectCenter.getProjectAssetPreview(validateProjectAssetIdRequest(input)))
  );
  ipcMain.handle(
    IPC_REGISTRY.bindProjectAsset,
    trusted((_event, input) => projectCenter.bindProjectAsset(validateProjectAssetBind(input)))
  );
  ipcMain.handle(
    IPC_REGISTRY.unbindProjectAsset,
    trusted((_event, input) => projectCenter.unbindProjectAsset(validateProjectAssetUnbind(input)))
  );
  ipcMain.handle(
    IPC_REGISTRY.revealProjectAsset,
    trusted((_event, input) => projectCenter.revealProjectAsset(validateProjectAssetIdRequest(input)))
  );
  ipcMain.handle(
    IPC_REGISTRY.prepareProjectAssetFrame,
    trusted((_event, input) => projectCenter.prepareProjectAssetFrame(validateProjectAssetFrameRequest(input)))
  );
  ipcMain.handle(
    IPC_REGISTRY.copyProjectAssetIntoProject,
    trusted((_event, input) => projectCenter.copyProjectAssetIntoProject(validateProjectAssetIdRequest(input)))
  );
  ipcMain.handle(
    IPC_REGISTRY.exportRelayProjectBundle,
    trusted((_event, input) => projectCenter.exportRelayProjectBundle(validateRelayProjectBundle(input)))
  );
  ipcMain.handle(
    IPC_REGISTRY.importRelayProjectBundle,
    trusted((_event, input) => {
      requireNoInput(input, "project bundle import");
      return projectCenter.importRelayProjectBundle();
    })
  );
  ipcMain.handle(
    IPC_REGISTRY.compileAndOpenWorkflow,
    trusted(async (_event, input) =>
      startWorkflowHandoffOperation(services, validateCompileRequest(input))
    )
  );
  ipcMain.handle(
    IPC_REGISTRY.queryWorkflowHandoff,
    trusted(async (_event, input) => {
      const operationId = validateWorkflowHandoffQuery(input);
      const operation = workflowHandoffOperations.get(operationId);
      if (operation === undefined) {
        return invalidRequest("workflow handoff operation was not found or has expired");
      }
      return operation;
    })
  );
}
