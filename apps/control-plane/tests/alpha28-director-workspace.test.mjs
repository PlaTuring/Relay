import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");

async function bundledModule(entry) {
  const result = await build({
    entryPoints: [resolve(root, entry)],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    target: "node22"
  });
  const source = result.outputFiles[0]?.text;
  assert.ok(source);
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

async function professionalProject() {
  const domain = await bundledModule("src/shared/project-domain.ts");
  const director = await bundledModule("src/renderer/professional-director.ts");
  const base = domain.createEmptyRelayProject({
    projectId: "project-alpha28-workspace",
    name: "工作区测试",
    createdAt: "2026-08-30T00:00:00.000Z"
  });
  const quick = domain.normalizeRelayProject({
    ...base,
    quick: {
      ...base.quick,
      workflowName: "工作区工作流",
      originalPrompt: "固定原始提示词",
      totalDurationSeconds: 10,
      segmentDurationSeconds: 5
    }
  });
  return director.promoteQuickProjectToProfessional({
    project: quick,
    updatedAt: "2026-08-30T00:00:01.000Z"
  });
}

test("workspace exposes one primary action and responsive panel/drawer/tab layouts", async () => {
  const {
    createProjectWorkspaceController,
    projectWorkspaceLayout,
    updateProjectWorkspaceViewport
  } = await bundledModule("src/renderer/project-workspace-controller.ts");
  const project = await professionalProject();
  let controller = createProjectWorkspaceController(project, { viewportWidth: 1600 });
  assert.equal(controller.layout.auxiliaryPresentation, "side_panel");
  assert.equal(controller.layout.maximumContentWidth, 1720);
  assert.equal(controller.actions.filter((action) => action.emphasis === "primary").length, 1);
  assert.equal(controller.actions.find((action) => action.emphasis === "primary").id, "compile_handoff");
  assert.equal(projectWorkspaceLayout(1440).auxiliaryPresentation, "side_panel");
  assert.equal(projectWorkspaceLayout(1439).auxiliaryPresentation, "drawer");
  controller = updateProjectWorkspaceViewport(controller, 1100);
  assert.equal(controller.layout.auxiliaryPresentation, "drawer");
  assert.equal(projectWorkspaceLayout(960).auxiliaryPresentation, "drawer");
  assert.equal(projectWorkspaceLayout(959).auxiliaryPresentation, "tabs");
  controller = updateProjectWorkspaceViewport(controller, 700);
  assert.equal(controller.layout.auxiliaryPresentation, "tabs");
  assert.equal(controller.layout.singleColumn, true);
  assert.equal(projectWorkspaceLayout(Number.NaN).viewportWidth, 1280);
});

test("only one shot is focused; edits, undo/redo, and auto-save remain wireable", async () => {
  const workspace = await bundledModule("src/renderer/project-workspace-controller.ts");
  const director = await bundledModule("src/renderer/professional-director.ts");
  const project = await professionalProject();
  let controller = workspace.createProjectWorkspaceController(project, {
    viewportWidth: 1366,
    autosaveDelayMs: 100
  });
  const secondId = project.shots[1].shotId;
  controller = workspace.focusProjectWorkspaceShot(controller, {
    shotId: secondId,
    updatedAt: "2026-08-30T00:00:02.000Z",
    createdAtMs: 1_000
  });
  assert.equal(workspace.currentProjectWorkspaceShot(controller).shotId, secondId);
  assert.equal(controller.focusedLocation.shotId, secondId);
  assert.deepEqual(workspace.projectWorkspaceUndoRedo(controller), { canUndo: true, canRedo: false });
  controller = workspace.undoProjectWorkspace(controller, 1_010);
  assert.equal(controller.session.current.professional.activeShotId, project.professional.activeShotId);
  controller = workspace.redoProjectWorkspace(controller, 1_020);
  assert.equal(controller.session.current.professional.activeShotId, secondId);

  const edited = director.setDirectorStateOverride(controller.session.current, {
    shotId: secondId,
    phase: "start",
    field: "subject",
    value: "用户逐字输入",
    updatedAt: "2026-08-30T00:00:03.000Z"
  });
  controller = workspace.applyProjectWorkspaceEdit(controller, {
    label: "修改镜头开始状态",
    nextProject: edited,
    createdAtMs: 2_000
  });
  assert.equal(workspace.projectWorkspaceSaveIndicator(controller), "unsaved");
  let request;
  [controller, request] = workspace.claimProjectWorkspaceAutosave(controller, 2_099);
  assert.equal(request, null);
  [controller, request] = workspace.claimProjectWorkspaceAutosave(controller, 2_100);
  assert.ok(request);
  assert.equal(workspace.projectWorkspaceSaveIndicator(controller), "saving");
  controller = workspace.completeProjectWorkspaceAutosave(controller, {
    request,
    succeeded: true,
    completedAt: "2026-08-30T00:00:04.000Z"
  });
  assert.equal(workspace.projectWorkspaceSaveIndicator(controller), "saved");
});

test("compile summary locators navigate to the exact shot field", async () => {
  const workspace = await bundledModule("src/renderer/project-workspace-controller.ts");
  const director = await bundledModule("src/renderer/professional-director.ts");
  let project = await professionalProject();
  const [firstId, secondId] = project.shots.map((shot) => shot.shotId);
  project = director.setDirectorStateOverride(project, {
    shotId: firstId,
    phase: "end",
    field: "lighting",
    value: "暖光",
    updatedAt: "2026-08-30T00:00:02.000Z"
  });
  project = director.setDirectorStateOverride(project, {
    shotId: secondId,
    phase: "start",
    field: "lighting",
    value: "冷光",
    updatedAt: "2026-08-30T00:00:03.000Z"
  });
  let controller = workspace.createProjectWorkspaceController(project, { viewportWidth: 1100 });
  assert.equal(controller.summary.issueCount, 1);
  assert.equal(controller.summary.warningCount, 1);
  const locator = controller.summary.issueLocators[0];
  assert.equal(locator, `shot:${secondId}:startState:lighting`);
  controller = workspace.locateProjectWorkspaceField(controller, locator);
  assert.equal(controller.focusedLocation.shotId, secondId);
  assert.equal(controller.focusedLocation.field, "lighting");
  assert.equal(controller.activeAuxiliaryView, "compile_check");
  assert.equal(controller.auxiliaryOpen, true);
});

test("history is an auxiliary view and restore creates a new current branch", async () => {
  const workspace = await bundledModule("src/renderer/project-workspace-controller.ts");
  const director = await bundledModule("src/renderer/professional-director.ts");
  const project = await professionalProject();
  let controller = workspace.createProjectWorkspaceController(project, { viewportWidth: 900 });
  controller = workspace.checkpointProjectWorkspace(controller, {
    reason: "manual",
    label: "原始版本",
    createdAt: "2026-08-30T00:00:02.000Z"
  });
  const checkpointId = controller.session.history[0].id;
  const edited = director.setDirectorShotDurations(project, {
    shotIds: project.shots.map((shot) => shot.shotId),
    durationSeconds: 10,
    updatedAt: "2026-08-30T00:00:03.000Z"
  });
  controller = workspace.applyProjectWorkspaceEdit(controller, {
    label: "批量时长",
    nextProject: edited,
    createdAtMs: 3
  });
  assert.equal(controller.summary.totalDurationSeconds, 20);
  controller = workspace.restoreProjectWorkspaceCheckpoint(controller, {
    checkpointId,
    createdAt: "2026-08-30T00:00:04.000Z",
    createdAtMs: 4
  });
  assert.equal(controller.summary.totalDurationSeconds, 10);
  assert.equal(controller.session.history.length, 2);
  assert.equal(controller.session.history[1].reason, "restore");
  assert.equal(controller.activeAuxiliaryView, "history");
  assert.equal(controller.layout.auxiliaryPresentation, "tabs");
  assert.equal(controller.layout.singleColumn, true);
});

test("workspace controller has no I/O, generation, queue, or fake-success surface", async () => {
  const source = await readFile(resolve(root, "src/renderer/project-workspace-controller.ts"), "utf8");
  assert.doesNotMatch(source, /node:fs|readFile|writeFile|fetch\s*\(|XMLHttpRequest|WebSocket|\/prompt|queuePrompt|submitPrompt/u);
  assert.doesNotMatch(source, /generate(?:Video|Audio)|runComfy|autoQueue|translatePrompt|expandPrompt/u);
  assert.match(source, /claimProjectWorkspaceAutosave/u);
  assert.match(source, /compile_handoff/u);
});
