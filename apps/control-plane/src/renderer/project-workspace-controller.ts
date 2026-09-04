import {
  RELAY_CONTINUITY_FIELDS,
  normalizeRelayProject,
  type RelayProjectDocument,
  type RelayProjectScene,
  type RelayProjectShot,
  type RelayShotDurationSeconds,
  type RelayShotTransition,
  type RelayWorkflowMode
} from "../shared/project-domain.js";

import {
  applyProjectStateCommand,
  canRedoProjectState,
  canUndoProjectState,
  claimProjectAutosave,
  completeProjectAutosave,
  createProjectHistoryCheckpoint,
  createProjectStateSession,
  isProjectSessionDirty,
  projectContentHash,
  redoProjectState,
  restoreProjectHistoryCheckpoint,
  undoProjectState,
  type AtomicProjectSaveRequest,
  type ProjectHistoryReason,
  type ProjectStateSession,
  type ProjectStateSessionOptions
} from "./project-state-engine.js";
import {
  directorTotalDuration,
  focusDirectorShot,
  orderedDirectorShots,
  validateDirectorContinuity,
  type DirectorContinuityIssue
} from "./professional-director.js";

export type WorkspaceAuxiliaryPresentation = "side_panel" | "drawer" | "tabs";
export type WorkspaceAuxiliaryView = "assets_continuity" | "compile_check" | "history";
export type WorkspaceSaveIndicator = "saved" | "saving" | "failed" | "unsaved";

export interface ProjectWorkspaceLayout {
  readonly viewportWidth: number;
  readonly maximumContentWidth: number;
  readonly auxiliaryPresentation: WorkspaceAuxiliaryPresentation;
  readonly timelinePresentation: "horizontal" | "compact";
  readonly singleColumn: boolean;
}

export interface WorkspaceFieldLocation {
  readonly locator: string;
  readonly shotId: string | null;
  readonly section: "project" | "shot" | "transition" | "asset" | "history";
  readonly field: string | null;
}

export interface ProjectWorkspaceSummary {
  readonly activeSceneCount: number;
  readonly activeShotCount: number;
  readonly totalDurationSeconds: number;
  readonly issueCount: number;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly issueLocators: readonly string[];
}

export interface ProjectWorkspaceAction {
  readonly id: "compile_handoff" | "save_checkpoint" | "open_history";
  readonly emphasis: "primary" | "secondary";
  readonly label: string;
}

export interface ProjectWorkspaceController {
  readonly session: ProjectStateSession<RelayProjectDocument>;
  readonly layout: ProjectWorkspaceLayout;
  readonly activeAuxiliaryView: WorkspaceAuxiliaryView;
  readonly auxiliaryOpen: boolean;
  readonly focusedLocation: WorkspaceFieldLocation | null;
  readonly issues: readonly DirectorContinuityIssue[];
  readonly summary: ProjectWorkspaceSummary;
  readonly actions: readonly ProjectWorkspaceAction[];
}

export interface CreateProjectWorkspaceOptions extends ProjectStateSessionOptions {
  readonly viewportWidth: number;
  readonly activeAuxiliaryView?: WorkspaceAuxiliaryView;
}

export interface DirectorSegmentSeedShot {
  readonly id?: string;
  readonly startSeconds: number;
  readonly durationSeconds: number;
  readonly description: string;
  readonly cameraLanguage?: string;
  readonly soundCue?: string;
  readonly transitionNote?: string;
}

export interface MaterializeDirectorSegmentPlanInput {
  readonly mode: RelayWorkflowMode;
  readonly totalDurationSeconds: number;
  readonly segmentDurationSeconds: RelayShotDurationSeconds;
  readonly updatedAt: string;
  /**
   * One-way migration source for a legacy Director draft whose cards existed
   * before its shots were materialized in RelayProjectDocument. Existing
   * authoritative shot data always wins over this presentation snapshot.
   */
  readonly seedShots?: readonly DirectorSegmentSeedShot[];
}

const PROJECT_SHOT_ID = /^shot-[a-z0-9][a-z0-9-]{7,127}$/u;

function defaultSegmentTransition(): RelayShotTransition {
  return {
    type: "tail_frame_continuation",
    capability: "proven",
    inheritedFields: [...RELAY_CONTINUITY_FIELDS],
    assetId: null,
    customIntent: ""
  };
}

function segmentTimingKey(startSeconds: number, durationSeconds: number): string {
  return `${startSeconds}:${durationSeconds}`;
}

function deterministicSegmentId(
  prefix: "scene" | "shot",
  projectId: string,
  identity: Readonly<Record<string, unknown>>,
  usedIds: ReadonlySet<string>
): string {
  let collision = 0;
  while (true) {
    const candidate = `${prefix}-${projectContentHash({
      projectId,
      purpose: "uniform-director-segment-plan",
      ...identity,
      collision
    }).slice(0, 24)}`;
    if (!usedIds.has(candidate)) return candidate;
    collision += 1;
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Materializes the compact uniform-segmentation controls into the authoritative
 * Relay project. It is deliberately mechanical: it never expands or rewrites
 * prompt content. Shots that leave the active plan are archived in place, so
 * their literal fields, continuity state, bindings and stable IDs remain
 * recoverable when the same timing plan is restored.
 */
export function materializeDirectorSegmentPlan(
  project: RelayProjectDocument,
  input: MaterializeDirectorSegmentPlanInput
): RelayProjectDocument {
  const total = input.totalDurationSeconds;
  const segment = input.segmentDurationSeconds;
  if (!Number.isSafeInteger(total) || total <= 0 || total % segment !== 0) {
    throw new RangeError("Director total duration must be an exact multiple of its segment duration.");
  }
  if (input.mode === "REF2VA" && (total > 15 || total !== segment)) {
    throw new RangeError("Ref2VA supports exactly one 5, 10, or 15-second segment.");
  }

  const plan = Array.from({ length: total / segment }, (_, index) => Object.freeze({
    startSeconds: index * segment,
    durationSeconds: segment,
    index
  }));
  const orderedBefore = orderedDirectorShots(project);
  const activeIndex = orderedBefore.findIndex((entry) => entry.shot.shotId === project.professional.activeShotId);
  const shotById = new Map(project.shots.map((shot) => [shot.shotId, shot]));
  const activeByTiming = new Map<string, RelayProjectShot>();
  let activeCursor = 0;
  for (const { shot } of orderedBefore) {
    activeByTiming.set(segmentTimingKey(activeCursor, shot.durationSeconds), shot);
    activeCursor += shot.durationSeconds;
  }
  const archivedByOrderAndDuration = new Map<string, RelayProjectShot[]>();
  for (const shot of project.shots.filter((candidate) => candidate.archived)) {
    const key = `${shot.order}:${shot.durationSeconds}`;
    const candidates = archivedByOrderAndDuration.get(key) ?? [];
    candidates.push(shot);
    archivedByOrderAndDuration.set(key, candidates);
  }
  const seedByTiming = new Map<string, DirectorSegmentSeedShot>();
  for (const seed of input.seedShots ?? []) {
    if (!Number.isSafeInteger(seed.startSeconds) || seed.startSeconds < 0
      || seed.durationSeconds !== 5 && seed.durationSeconds !== 10 && seed.durationSeconds !== 15) continue;
    const key = segmentTimingKey(seed.startSeconds, seed.durationSeconds);
    if (!seedByTiming.has(key)) seedByTiming.set(key, seed);
  }

  const usedIds = new Set(project.shots.map((shot) => shot.shotId));
  const selectedIds = new Set<string>();
  const selectedShots: RelayProjectShot[] = [];
  for (const planned of plan) {
    const timingKey = segmentTimingKey(planned.startSeconds, planned.durationSeconds);
    const seed = seedByTiming.get(timingKey);
    const seededExisting = seed?.id === undefined ? undefined : shotById.get(seed.id);
    const orderedExisting = activeByTiming.get(timingKey);
    const archivedExisting = archivedByOrderAndDuration.get(`${planned.index}:${planned.durationSeconds}`)
      ?.find((shot) => !selectedIds.has(shot.shotId));
    const existing = seededExisting !== undefined
        && seededExisting.durationSeconds === planned.durationSeconds
        && !selectedIds.has(seededExisting.shotId)
      ? seededExisting
      : orderedExisting !== undefined && !selectedIds.has(orderedExisting.shotId)
        ? orderedExisting
        : archivedExisting;

    let shot: RelayProjectShot;
    if (existing !== undefined) {
      shot = {
        ...existing,
        order: planned.index,
        archived: false
      };
    } else {
      const requestedSeedId = seed?.id !== undefined && PROJECT_SHOT_ID.test(seed.id) && !usedIds.has(seed.id)
        ? seed.id
        : null;
      const shotId = requestedSeedId ?? deterministicSegmentId("shot", project.projectId, {
        mode: input.mode,
        startSeconds: planned.startSeconds,
        durationSeconds: planned.durationSeconds
      }, usedIds);
      usedIds.add(shotId);
      shot = {
        shotId,
        name: `镜头 ${planned.index + 1}`,
        order: planned.index,
        durationSeconds: planned.durationSeconds,
        prompt: seed?.description ?? "",
        camera: seed?.cameraLanguage ?? "",
        sound: seed?.soundCue ?? "",
        startState: {},
        endState: {},
        transitionFromPrevious: planned.index === 0 ? null : defaultSegmentTransition(),
        archived: false
      };
    }
    shot = planned.index === 0
      ? { ...shot, transitionFromPrevious: null }
      : shot.transitionFromPrevious === null
        ? { ...shot, transitionFromPrevious: defaultSegmentTransition() }
        : shot;
    selectedIds.add(shot.shotId);
    selectedShots.push(shot);
  }

  const selectedById = new Map(selectedShots.map((shot) => [shot.shotId, shot]));
  const shots = project.shots.map((shot) => selectedById.get(shot.shotId)
    ?? (shot.archived ? shot : { ...shot, archived: true }));
  for (const shot of selectedShots) {
    if (!shotById.has(shot.shotId)) shots.push(shot);
  }

  const existingScene = project.scenes.find((scene) => scene.shotIds.includes(selectedShots[0]!.shotId))
    ?? project.scenes.find((scene) => scene.sceneId === project.professional.activeSceneId)
    ?? project.scenes.find((scene) => !scene.archived)
    ?? project.scenes[0];
  const sceneIds = new Set(project.scenes.map((scene) => scene.sceneId));
  const planSceneId = existingScene?.sceneId ?? deterministicSegmentId("scene", project.projectId, {
    role: "uniform-plan"
  }, sceneIds);
  const planScene: RelayProjectScene = existingScene ?? {
    sceneId: planSceneId,
    name: "场景 1",
    order: 0,
    notes: "",
    shotIds: [],
    archived: false
  };
  const scenes = project.scenes.map((scene): RelayProjectScene => {
    const remaining = scene.shotIds.filter((shotId) => !selectedIds.has(shotId));
    if (scene.sceneId !== planSceneId) return { ...scene, shotIds: remaining };
    return {
      ...scene,
      archived: false,
      shotIds: [...selectedShots.map((shot) => shot.shotId), ...remaining]
    };
  });
  if (!scenes.some((scene) => scene.sceneId === planSceneId)) {
    scenes.push({ ...planScene, shotIds: selectedShots.map((shot) => shot.shotId) });
  }

  const previousActiveId = project.professional.activeShotId;
  const activeShotId = previousActiveId !== null && selectedIds.has(previousActiveId)
    ? previousActiveId
    : selectedShots[Math.min(Math.max(activeIndex, 0), selectedShots.length - 1)]!.shotId;
  const quick = {
    ...project.quick,
    mode: input.mode,
    totalDurationSeconds: total,
    segmentDurationSeconds: segment
  };
  const professional = {
    ...project.professional,
    activeSceneId: planSceneId,
    activeShotId
  };
  const comparableCurrent = {
    editorMode: project.editorMode,
    quick: project.quick,
    professional: project.professional,
    scenes: project.scenes,
    shots: project.shots
  };
  const comparableNext = {
    editorMode: "professional",
    quick,
    professional,
    scenes,
    shots
  };
  if (sameJson(comparableCurrent, comparableNext)) return project;
  return normalizeRelayProject({
    ...project,
    editorMode: "professional",
    updatedAt: input.updatedAt,
    quick,
    professional,
    scenes,
    shots
  });
}

export function projectWorkspaceLayout(viewportWidth: number): ProjectWorkspaceLayout {
  const safeWidth = Number.isFinite(viewportWidth) ? Math.max(320, Math.floor(viewportWidth)) : 1280;
  if (safeWidth < 960) {
    return Object.freeze({
      viewportWidth: safeWidth,
      maximumContentWidth: safeWidth,
      auxiliaryPresentation: "tabs",
      timelinePresentation: "compact",
      singleColumn: true
    });
  }
  if (safeWidth < 1440) {
    return Object.freeze({
      viewportWidth: safeWidth,
      maximumContentWidth: Math.min(safeWidth, 1160),
      auxiliaryPresentation: "drawer",
      timelinePresentation: "horizontal",
      singleColumn: false
    });
  }
  return Object.freeze({
    viewportWidth: safeWidth,
    maximumContentWidth: 1720,
    auxiliaryPresentation: "side_panel",
    timelinePresentation: "horizontal",
    singleColumn: false
  });
}

function controllerActions(): readonly ProjectWorkspaceAction[] {
  return Object.freeze([
    Object.freeze({ id: "compile_handoff", emphasis: "primary", label: "编译并在 ComfyUI 中打开" }),
    Object.freeze({ id: "save_checkpoint", emphasis: "secondary", label: "保存历史检查点" }),
    Object.freeze({ id: "open_history", emphasis: "secondary", label: "历史记录" })
  ]);
}

function summary(project: RelayProjectDocument, issues: readonly DirectorContinuityIssue[]): ProjectWorkspaceSummary {
  const shots = orderedDirectorShots(project);
  return Object.freeze({
    activeSceneCount: project.scenes.filter((scene) => !scene.archived).length,
    activeShotCount: shots.length,
    totalDurationSeconds: directorTotalDuration(project),
    issueCount: issues.length,
    errorCount: issues.filter((issue) => issue.severity === "error").length,
    warningCount: issues.filter((issue) => issue.severity === "warning").length,
    issueLocators: Object.freeze(issues.map((issue) => issue.locator))
  });
}

function rebuildController(
  controller: Omit<ProjectWorkspaceController, "issues" | "summary" | "actions">
): ProjectWorkspaceController {
  const issues = validateDirectorContinuity(controller.session.current);
  return Object.freeze({
    ...controller,
    issues,
    summary: summary(controller.session.current, issues),
    actions: controllerActions()
  });
}

export function createProjectWorkspaceController(
  project: RelayProjectDocument,
  options: CreateProjectWorkspaceOptions
): ProjectWorkspaceController {
  const session = createProjectStateSession(project, options);
  return rebuildController({
    session,
    layout: projectWorkspaceLayout(options.viewportWidth),
    activeAuxiliaryView: options.activeAuxiliaryView ?? "assets_continuity",
    auxiliaryOpen: options.viewportWidth >= 1440,
    focusedLocation: null
  });
}

export function updateProjectWorkspaceViewport(
  controller: ProjectWorkspaceController,
  viewportWidth: number
): ProjectWorkspaceController {
  const layout = projectWorkspaceLayout(viewportWidth);
  return rebuildController({
    session: controller.session,
    layout,
    activeAuxiliaryView: controller.activeAuxiliaryView,
    auxiliaryOpen: layout.auxiliaryPresentation === "side_panel" ? true : controller.auxiliaryOpen,
    focusedLocation: controller.focusedLocation
  });
}

export function setProjectWorkspaceAuxiliaryView(
  controller: ProjectWorkspaceController,
  view: WorkspaceAuxiliaryView,
  open = true
): ProjectWorkspaceController {
  return rebuildController({
    session: controller.session,
    layout: controller.layout,
    activeAuxiliaryView: view,
    auxiliaryOpen: open,
    focusedLocation: controller.focusedLocation
  });
}

export function applyProjectWorkspaceEdit(
  controller: ProjectWorkspaceController,
  input: {
    readonly label: string;
    readonly nextProject: RelayProjectDocument;
    readonly createdAtMs: number;
  }
): ProjectWorkspaceController {
  const session = applyProjectStateCommand(controller.session, input);
  return rebuildController({
    session,
    layout: controller.layout,
    activeAuxiliaryView: controller.activeAuxiliaryView,
    auxiliaryOpen: controller.auxiliaryOpen,
    focusedLocation: controller.focusedLocation
  });
}

export function focusProjectWorkspaceShot(
  controller: ProjectWorkspaceController,
  input: { readonly shotId: string; readonly updatedAt: string; readonly createdAtMs: number }
): ProjectWorkspaceController {
  const nextProject = focusDirectorShot(controller.session.current, input.shotId, input.updatedAt);
  const next = applyProjectWorkspaceEdit(controller, {
    label: "切换当前镜头",
    nextProject,
    createdAtMs: input.createdAtMs
  });
  return rebuildController({
    session: next.session,
    layout: next.layout,
    activeAuxiliaryView: next.activeAuxiliaryView,
    auxiliaryOpen: next.auxiliaryOpen,
    focusedLocation: {
      locator: `shot:${input.shotId}`,
      shotId: input.shotId,
      section: "shot",
      field: null
    }
  });
}

export function currentProjectWorkspaceShot(controller: ProjectWorkspaceController): RelayProjectShot | null {
  const activeShotId = controller.focusedLocation?.shotId
    ?? controller.session.current.professional.activeShotId;
  if (activeShotId === null) return null;
  return controller.session.current.shots.find((shot) => shot.shotId === activeShotId && !shot.archived) ?? null;
}

export function undoProjectWorkspace(
  controller: ProjectWorkspaceController,
  nowMs: number
): ProjectWorkspaceController {
  return rebuildController({
    session: undoProjectState(controller.session, nowMs),
    layout: controller.layout,
    activeAuxiliaryView: controller.activeAuxiliaryView,
    auxiliaryOpen: controller.auxiliaryOpen,
    focusedLocation: controller.focusedLocation
  });
}

export function redoProjectWorkspace(
  controller: ProjectWorkspaceController,
  nowMs: number
): ProjectWorkspaceController {
  return rebuildController({
    session: redoProjectState(controller.session, nowMs),
    layout: controller.layout,
    activeAuxiliaryView: controller.activeAuxiliaryView,
    auxiliaryOpen: controller.auxiliaryOpen,
    focusedLocation: controller.focusedLocation
  });
}

export function projectWorkspaceUndoRedo(controller: ProjectWorkspaceController): Readonly<{
  canUndo: boolean;
  canRedo: boolean;
}> {
  return Object.freeze({
    canUndo: canUndoProjectState(controller.session),
    canRedo: canRedoProjectState(controller.session)
  });
}

export function claimProjectWorkspaceAutosave(
  controller: ProjectWorkspaceController,
  nowMs: number
): readonly [ProjectWorkspaceController, AtomicProjectSaveRequest | null] {
  const [session, request] = claimProjectAutosave(controller.session, nowMs);
  return Object.freeze([
    rebuildController({
      session,
      layout: controller.layout,
      activeAuxiliaryView: controller.activeAuxiliaryView,
      auxiliaryOpen: controller.auxiliaryOpen,
      focusedLocation: controller.focusedLocation
    }),
    request
  ]);
}

export function completeProjectWorkspaceAutosave(
  controller: ProjectWorkspaceController,
  input: Parameters<typeof completeProjectAutosave<RelayProjectDocument>>[1]
): ProjectWorkspaceController {
  return rebuildController({
    session: completeProjectAutosave(controller.session, input),
    layout: controller.layout,
    activeAuxiliaryView: controller.activeAuxiliaryView,
    auxiliaryOpen: controller.auxiliaryOpen,
    focusedLocation: controller.focusedLocation
  });
}

export function projectWorkspaceSaveIndicator(controller: ProjectWorkspaceController): WorkspaceSaveIndicator {
  if (controller.session.autosave.phase === "saving") return "saving";
  if (controller.session.autosave.phase === "failed") return "failed";
  return isProjectSessionDirty(controller.session) ? "unsaved" : "saved";
}

export function checkpointProjectWorkspace(
  controller: ProjectWorkspaceController,
  input: { readonly reason: ProjectHistoryReason; readonly label: string; readonly createdAt: string }
): ProjectWorkspaceController {
  return rebuildController({
    session: createProjectHistoryCheckpoint(controller.session, input),
    layout: controller.layout,
    activeAuxiliaryView: controller.activeAuxiliaryView,
    auxiliaryOpen: controller.auxiliaryOpen,
    focusedLocation: controller.focusedLocation
  });
}

export function restoreProjectWorkspaceCheckpoint(
  controller: ProjectWorkspaceController,
  input: {
    readonly checkpointId: string;
    readonly createdAt: string;
    readonly createdAtMs: number;
    readonly label?: string;
  }
): ProjectWorkspaceController {
  const session = restoreProjectHistoryCheckpoint(controller.session, input);
  return rebuildController({
    session,
    layout: controller.layout,
    activeAuxiliaryView: "history",
    auxiliaryOpen: true,
    focusedLocation: {
      locator: `history:${session.activeCheckpointId ?? ""}`,
      shotId: null,
      section: "history",
      field: null
    }
  });
}

export function locateProjectWorkspaceField(
  controller: ProjectWorkspaceController,
  locator: string
): ProjectWorkspaceController {
  const shotMatch = locator.match(/^shot:([^:]+)(?::(startState|endState|transition)(?::([^:]+))?)?$/u);
  if (shotMatch !== null) {
    const shotId = shotMatch[1] ?? "";
    if (!controller.session.current.shots.some((shot) => shot.shotId === shotId && !shot.archived)) {
      throw new TypeError(`Issue locator references an unknown active shot: ${shotId}`);
    }
    const section = shotMatch[2] === "transition" ? "transition" as const : "shot" as const;
    return rebuildController({
      session: controller.session,
      layout: controller.layout,
      activeAuxiliaryView: "compile_check",
      auxiliaryOpen: true,
      focusedLocation: {
        locator,
        shotId,
        section,
        field: shotMatch[3] ?? shotMatch[2] ?? null
      }
    });
  }
  if (/^asset:[^:]+/u.test(locator)) {
    return rebuildController({
      session: controller.session,
      layout: controller.layout,
      activeAuxiliaryView: "assets_continuity",
      auxiliaryOpen: true,
      focusedLocation: { locator, shotId: null, section: "asset", field: null }
    });
  }
  if (/^project(?::[^:]+)?$/u.test(locator)) {
    return rebuildController({
      session: controller.session,
      layout: controller.layout,
      activeAuxiliaryView: "compile_check",
      auxiliaryOpen: true,
      focusedLocation: { locator, shotId: null, section: "project", field: null }
    });
  }
  throw new TypeError(`Unsupported workspace field locator: ${locator}`);
}
