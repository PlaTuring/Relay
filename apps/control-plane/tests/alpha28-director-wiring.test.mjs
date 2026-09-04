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

test("renderer wires Alpha 28 professional controls to deterministic project state", async () => {
  const source = await readFile(resolve(root, "src/renderer/index.ts"), "utf8");
  for (const id of [
    "director-undo-button",
    "director-redo-button",
    "director-history-button",
    "director-p1-current-shot-duration",
    "director-shot-start-state",
    "director-shot-end-state",
    "director-shot-restore-inheritance",
    "director-shot-lock-state",
    "director-shot-transition-kind",
    "director-shot-transition-asset",
    "director-shot-bind-asset"
  ]) assert.match(source, new RegExp(`element<[^>]+>\\(\"${id}\"\\)`));

  for (const symbol of [
    "createProjectWorkspaceController",
    "applyProjectWorkspaceEdit",
    "focusProjectWorkspaceShot",
    "undoProjectWorkspace",
    "redoProjectWorkspace",
    "claimProjectWorkspaceAutosave",
    "completeProjectWorkspaceAutosave",
    "setDirectorStateOverride",
    "restoreDirectorStateInheritance",
    "setDirectorStateLock",
    "setDirectorTransition"
  ]) assert.match(source, new RegExp(`\\b${symbol}\\b`));

  assert.match(source, /RELAY_CONTINUITY_FIELDS/u);
  assert.match(source, /tail_frame_continuation/u);
  assert.match(source, /hard_cut/u);
  assert.match(source, /directorHistoryDrawer\.open = true/u);
  assert.doesNotMatch(source, /\/prompt|queuePrompt|submitPrompt/u);
});

test("legacy frame picker is replaced by project-copy import, stable asset IDs, and persistent clear", async () => {
  const source = await readFile(resolve(root, "src/renderer/index.ts"), "utf8");
  assert.doesNotMatch(source, /window\.controlPlane\.chooseFrame\s*\(/u);
  assert.match(source, /window\.controlPlane\.importProjectAssets\(\{[\s\S]*?mode:\s*"copy"/u);
  assert.match(source, /result\.results\.length !== 1/u);
  assert.match(source, /参考帧一次只接受一张图片/u);
  assert.match(source, /entry\.asset\?\.assetId \?\? entry\.duplicateAssetId/u);
  assert.match(source, /window\.controlPlane\.prepareProjectAssetFrame\(\{/u);
  assert.match(source, /\[slot === "first" \? "firstFrameAssetId" : "lastFrameAssetId"\]: assetId/u);
  assert.match(source, /\[slot === "first" \? "firstFrameAssetId" : "lastFrameAssetId"\]: null/u);
});

test("quick form changes workflow label without renaming the project container", async () => {
  const source = await readFile(resolve(root, "src/renderer/index.ts"), "utf8");
  const block = source.match(/function projectWithQuickForm[\s\S]*?\n\}/u)?.[0] ?? "";
  assert.match(block, /name:\s*project\.name/u);
  assert.match(block, /workflowName:\s*workflowNameInput\.value/u);
  assert.doesNotMatch(block, /name:\s*workflowNameInput\.value/u);
});

test("scene-shot continuity, transition, and workspace undo redo remain behaviorally connected", async () => {
  const domain = await bundledModule("src/shared/project-domain.ts");
  const director = await bundledModule("src/renderer/professional-director.ts");
  const workspace = await bundledModule("src/renderer/project-workspace-controller.ts");
  const base = domain.createEmptyRelayProject({
    projectId: "project-alpha28-wiring",
    name: "项目容器名称",
    createdAt: "2026-08-30T00:00:00.000Z"
  });
  const quick = domain.normalizeRelayProject({
    ...base,
    quick: {
      ...base.quick,
      workflowName: "工作流标签",
      originalPrompt: "用户原始提示词，不扩写",
      totalDurationSeconds: 10,
      segmentDurationSeconds: 5
    }
  });
  let project = director.promoteQuickProjectToProfessional({
    project: quick,
    updatedAt: "2026-08-30T00:00:01.000Z"
  });
  assert.equal(project.name, "项目容器名称");
  assert.equal(project.quick.workflowName, "工作流标签");
  assert.equal(project.shots.length, 2);
  project = director.setDirectorStateOverride(project, {
    shotId: project.shots[0].shotId,
    phase: "end",
    field: "subject",
    value: "固定主体",
    updatedAt: "2026-08-30T00:00:02.000Z"
  });
  assert.equal(director.resolveDirectorShotStates(project)[1].start.subject.value, "固定主体");
  project = director.setDirectorTransition(project, {
    shotId: project.shots[1].shotId,
    type: "hard_cut",
    inheritedFields: [],
    updatedAt: "2026-08-30T00:00:03.000Z"
  });
  let controller = workspace.createProjectWorkspaceController(project, { viewportWidth: 1366 });
  const edited = director.setDirectorShotDurations(controller.session.current, {
    shotIds: [project.shots[1].shotId],
    durationSeconds: 10,
    updatedAt: "2026-08-30T00:00:04.000Z"
  });
  controller = workspace.applyProjectWorkspaceEdit(controller, {
    label: "修改镜头时长",
    nextProject: edited,
    createdAtMs: 4
  });
  assert.equal(controller.session.current.shots[1].durationSeconds, 10);
  controller = workspace.undoProjectWorkspace(controller, 5);
  assert.equal(controller.session.current.shots[1].durationSeconds, 5);
  controller = workspace.redoProjectWorkspace(controller, 6);
  assert.equal(controller.session.current.shots[1].durationSeconds, 10);
  assert.equal(controller.session.current.shots[1].transitionFromPrevious.type, "hard_cut");
});
