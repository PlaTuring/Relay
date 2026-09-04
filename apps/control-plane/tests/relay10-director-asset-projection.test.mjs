import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const renderer = await readFile(resolve(root, "src/renderer/index.ts"), "utf8");

async function bundledModule(entry) {
  const result = await build({
    entryPoints: [resolve(root, entry)],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    target: "node22",
    logLevel: "silent"
  });
  const source = result.outputFiles[0]?.text;
  assert.ok(source);
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

function sliceBetween(startMarker, endMarker) {
  const start = renderer.indexOf(startMarker);
  const end = renderer.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing start marker: ${startMarker}`);
  assert.ok(end > start, `missing end marker after ${startMarker}: ${endMarker}`);
  return renderer.slice(start, end);
}

test("Director shot assets expose a Chinese purpose selector and an honest compile disposition", () => {
  const render = sliceBetween("function renderDirectorShotAssetBindings", "const inFlightActionKeys");
  const projectData = sliceBetween("function renderDirectorProjectDataBindings", "function syncDirectorAssetRelationCopy");
  assert.match(render, /director-shot-project-asset-purpose/u);
  assert.match(render, /选择素材在当前镜头中的用途/u);
  assert.match(render, /ASSET_PURPOSE_LABELS\[binding\.purpose\]/u);
  assert.match(render, /projection\?\.message/u);
  assert.match(render, /进入本次 H3 工作流/u);
  assert.match(projectData, /项目资料关系 · 不进入当前 H3 工作流/u);
  assert.match(projectData, /targetKind:\s*"project"/u);
  assert.match(render, /targetKind:\s*"shot"/u);
  assert.match(render, /const purpose = purposeSelect\.value as RelayAssetPurpose/u);
  assert.match(render, /const projectBinding:\s*RelayAssetBinding/u);
  assert.doesNotMatch(render, /asset\.mediaType === "video"[\s\S]{0,180}: "continuity_reference"/u);
});

test("projection rules fail closed for T2V, FL2VA boundaries, and Ref2VA one-to-two image references", () => {
  const projection = sliceBetween("function buildDirectorAssetProjectionPlan", "function directorAssetProjectionSignature");
  assert.match(projection, /directorBindingProjectionDisposition\(mode, binding\.purpose\)/u);
  assert.match(projection, /if \(disposition === "record_only"\) continue/u);
  assert.match(projection, /mode === "T2V"[\s\S]*?T2V 不接收素材输入/u);
  assert.match(projection, /mode === "FL2VA"/u);
  assert.match(projection, /binding\.purpose === "first_frame" \? firstShotId : lastShotId/u);
  assert.match(projection, /首帧只能绑定到本次编译的第一个镜头/u);
  assert.match(projection, /尾帧只能绑定到本次编译的最后一个镜头/u);
  assert.match(projection, /if \(asset\.mediaType !== "image"\) \{\s*invalidate\(entry, `\$\{ASSET_PURPOSE_LABELS\[binding\.purpose\]\}必须绑定通过预检的图片素材/u);
  assert.match(projection, /shotIds\.length !== 1/u);
  assert.match(projection, /referenceCandidates\.length > 2/u);
  assert.match(projection, /同一图片只需绑定一次/u);
  assert.match(projection, /entry\.slot = index === 0 \? "first" : "last"/u);
});

test("Director compile prepares stable project assets asynchronously without reading or writing Quick frame state", () => {
  const prepare = sliceBetween("async function prepareDirectorCompilationFrames", "function directorDraftWithContinuityPromptContexts");
  const capture = sliceBetween("function captureDirectorCompilation", "async function markDirectorCompiled");
  const click = sliceBetween('directorCompileButton.addEventListener("click"', "renderDirectorShots();");

  assert.match(prepare, /window\.controlPlane\.prepareProjectAssetFrame\(\{/u);
  assert.match(prepare, /projectId:\s*input\.projectId/u);
  assert.match(prepare, /assetId:\s*entry\.asset\.assetId/u);
  assert.match(prepare, /assertDirectorAssetPreparationContext\(context\)/u);
  assert.match(renderer, /directorSelectedMode\(\) !== input\.mode/u);
  assert.match(capture, /firstFrameSelectionId:\s*mode === "T2V" \? null : preparedFrames\.firstFrameSelectionId/u);
  assert.match(capture, /lastFrameSelectionId:\s*mode === "T2V" \? null : preparedFrames\.lastFrameSelectionId/u);
  assert.match(click, /await prepareDirectorCompilationFrames\(context\)/u);
  assert.match(click, /captureDirectorCompilation\(preparedFrames\)/u);
  assert.ok(click.indexOf("prepareDirectorCompilationFrames") < click.indexOf("captureDirectorCompilation"));
  for (const source of [prepare, capture, click]) {
    assert.doesNotMatch(source, /quick\.(?:firstFrameAssetId|lastFrameAssetId)|projectWithQuickForm|flushQuickProjectSave/u);
  }
});

test("a professional frame binding survives a repository restart while Quick frame fields stay untouched", async (context) => {
  const [domain, director, repositoryModule] = await Promise.all([
    bundledModule("src/shared/project-domain.ts"),
    bundledModule("src/renderer/professional-director.ts"),
    bundledModule("src/main/services/project-repository.ts")
  ]);
  const dataRoot = await mkdtemp(join(os.tmpdir(), "relay-director-binding-restart-"));
  context.after(() => rm(dataRoot, { recursive: true, force: true }));
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 8, 3, 0, 0, tick++));
  const repository = repositoryModule.createProjectRepository({ dataRoot, now });
  const created = await repository.createProject({ name: "专业素材恢复" });
  const professional = director.promoteQuickProjectToProfessional({
    project: domain.normalizeRelayProject({
      ...created,
      quick: {
        ...created.quick,
        mode: "FL2VA",
        totalDurationSeconds: 15,
        segmentDurationSeconds: 15,
        firstFrameAssetId: null,
        lastFrameAssetId: null
      }
    }),
    updatedAt: "2026-09-03T00:00:01.000Z"
  });
  const shotId = professional.scenes[0]?.shotIds[0];
  assert.ok(shotId);
  const asset = {
    assetId: "asset-director-frame-restart",
    displayName: "专业首帧",
    sourceFileName: "director-first.png",
    mediaType: "image",
    storageMode: "project_copy",
    projectRelativePath: "assets/originals/director-first.png",
    externalReferenceId: null,
    byteLength: 16,
    sha256: "a".repeat(64),
    tags: [],
    notes: "",
    availability: "available",
    inspection: { width: 1280, height: 720 },
    createdAt: "2026-09-03T00:00:01.000Z",
    updatedAt: "2026-09-03T00:00:01.000Z"
  };
  const bound = domain.normalizeRelayProject({
    ...professional,
    updatedAt: "2026-09-03T00:00:02.000Z",
    assets: [asset],
    bindings: [{
      bindingId: "binding-director-frame-restart",
      targetKind: "shot",
      targetId: shotId,
      assetId: asset.assetId,
      purpose: "first_frame",
      notes: "",
      createdAt: "2026-09-03T00:00:02.000Z"
    }]
  });
  await repository.saveProject(bound, { expectedUpdatedAt: created.updatedAt });

  const restarted = repositoryModule.createProjectRepository({ dataRoot });
  const restored = await restarted.loadProject(created.projectId);
  assert.equal(restored.quick.firstFrameAssetId, null);
  assert.equal(restored.quick.lastFrameAssetId, null);
  assert.deepEqual(restored.bindings.map(({ targetKind, targetId, assetId, purpose }) => ({
    targetKind,
    targetId,
    assetId,
    purpose
  })), [{
    targetKind: "shot",
    targetId: shotId,
    assetId: asset.assetId,
    purpose: "first_frame"
  }]);
});

test("Quick and Director frame pickers persist to separate authoritative fields", () => {
  const quick = sliceBetween("async function chooseFrame", "function directorPurposeForFrameSlot");
  const director = sliceBetween("async function chooseDirectorFrame", "function clearDirectorFrame");
  const workspaceMutation = sliceBetween("function applyDirectorWorkspaceMutation", "function directorTransitionFieldsFromControls");
  const locator = sliceBetween("function locateDirectorValidationError", "function updateDirectorPreview");
  const listeners = sliceBetween('firstFrameButton.addEventListener("click"', 'directorOpenRefInstallButton.addEventListener("click"');

  assert.match(quick, /\[slot === "first" \? "firstFrameAssetId" : "lastFrameAssetId"\]: assetId/u);
  assert.doesNotMatch(quick, /RelayAssetBinding|applyDirectorWorkspaceMutation/u);
  assert.match(director, /const binding:\s*RelayAssetBinding/u);
  assert.match(director, /applyDirectorWorkspaceMutation/u);
  assert.match(director, /bindings:\s*\[\.\.\.current\.bindings\.filter/u);
  assert.match(workspaceMutation, /scheduleDirectorWorkspaceAutosave\(\)/u);
  assert.doesNotMatch(director, /\.quick|firstFrameAssetId|lastFrameAssetId|firstFrame\s*=|lastFrame\s*=/u);
  assert.match(listeners, /directorFirstFrameButton[\s\S]*?chooseDirectorFrame\("first"\)/u);
  assert.match(listeners, /directorLastFrameButton[\s\S]*?chooseDirectorFrame\("last"\)/u);
  assert.doesNotMatch(listeners.slice(listeners.indexOf("directorFirstFrameButton")), /chooseFrame\(/u);
  assert.match(locator, /buildDirectorAssetProjectionPlan\(projectionProject, directorSelectedMode\(\)\)/u);
  assert.doesNotMatch(locator, /\bfirstFrame\b|\blastFrame\b/u);
});

test("Director transitions and resolved continuity are projected only when the compiler can execute them", () => {
  const transitions = sliceBetween("function directorTransitionProjectionIssues", "const ASSET_TARGET_LABELS");
  const continuity = sliceBetween("function directorDraftWithContinuityPromptContexts", "function captureDirectorCompilation");
  const capture = sliceBetween("function captureDirectorCompilation", "async function markDirectorCompiled");

  assert.match(transitions, /transition\.disposition !== "compile"/u);
  assert.match(transitions, /transition\.assetId !== null/u);
  assert.match(transitions, /当前编译器不会消费该素材/u);
  assert.match(transitions, /return transition\.type/u);
  assert.match(transitions, /function directorSegmentTransitionSnapshot/u);
  assert.match(transitions, /blocked:\s*\[\.\.\.issues\]/u);
  assert.match(continuity, /serializeDirectorContinuityPromptContexts\(project\)/u);
  assert.match(continuity, /description:\s*\[shot\.description\.trimEnd\(\), promptContext\]/u);
  assert.match(capture, /const compilationDraft = directorDraftWithContinuityPromptContexts/u);
  assert.match(capture, /serializeDirectorPrompt\(compilationDraft\)/u);
  assert.match(capture, /segmentTransitions,/u);
  assert.doesNotMatch(continuity, /persistRelayProject|saveRelayProject/u);
});

test("Director preview and compile serialize the same continuity-augmented draft", () => {
  const validation = sliceBetween("function directorValidationErrors", "function focusDirectorField");
  const capture = sliceBetween("function captureDirectorCompilation", "async function markDirectorCompiled");
  assert.match(validation, /const previewDraft = project === null[\s\S]*?directorDraftWithContinuityPromptContexts\(production\.decorated\.draft, project\)/u);
  assert.match(validation, /serializeDirectorPrompt\(previewDraft\)/u);
  assert.match(capture, /directorDraftWithContinuityPromptContexts\(submission\.effectiveDraft, authoritativeProject\)/u);
  assert.match(capture, /serializeDirectorPrompt\(compilationDraft\)/u);
});
