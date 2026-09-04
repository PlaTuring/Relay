import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const read = (relative) => readFile(resolve(root, relative), "utf8");

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `missing source slice: ${startMarker} -> ${endMarker}`);
  return source.slice(start, end);
}

test("only explicit project activation may switch main-process project authority", async () => {
  const renderer = await read("src/renderer/index.ts");
  const activate = sliceBetween(renderer, "async function activateRelayProject", "function projectWithQuickForm");
  assert.match(activate, /loadRelayProject\(\{ projectId, activate: true \}\)/u);
  const calls = [...renderer.matchAll(/loadRelayProject\(\{[\s\S]*?\}\)/gu)].map((match) => match[0]);
  assert.ok(calls.length >= 5, "all foreground and background project reads must be auditable");
  assert.equal(calls.filter((call) => call.includes("activate: true")).length, 1);
  assert.ok(calls.filter((call) => call.includes("activate: false")).length >= 4);
  assert.ok(calls.every((call) => /activate:\s*(?:true|false)/u.test(call)), "every project load must state whether it activates authority");
});

test("project changes invalidate workspace, asset catalog, list, and preview requests", async () => {
  const [renderer, context] = await Promise.all([
    read("src/renderer/index.ts"),
    read("src/renderer/project-operation-context.ts")
  ]);
  const transition = sliceBetween(renderer, "function beginProjectTransition", "async function activateRelayProject");
  const workspace = sliceBetween(renderer, "async function ensureDirectorWorkspaceLoaded", "function directorAssetBindingsForContext");
  const catalog = sliceBetween(renderer, "async function refreshDirectorAssetCatalog", "async function ensureAssetLibraryLoaded");
  assert.match(context, /projectId:[\s\S]*activationEpoch:/u);
  assert.match(context, /currentActivationEpoch === context\.activationEpoch[\s\S]*currentProjectId === context\.projectId/u);
  for (const invalidation of [
    "directorWorkspaceLoadGeneration += 1",
    "directorAssetCatalogRequestGeneration += 1",
    "assetPreviewRequestGeneration += 1",
    "assetTrashRequestGeneration += 1",
    "generatedVideoUi.invalidateProject()",
    "assetLibraryController.invalidate()"
  ]) assert.ok(transition.includes(invalidation), `missing transition invalidation: ${invalidation}`);
  assert.match(workspace, /requestGeneration = \+\+directorWorkspaceLoadGeneration/u);
  assert.ok((workspace.match(/requestGeneration !== directorWorkspaceLoadGeneration \|\| !isCurrentProjectOperation\(context\)/gu) ?? []).length >= 3);
  assert.match(catalog, /requestGeneration = \+\+directorAssetCatalogRequestGeneration/u);
  assert.match(catalog, /requestGeneration !== directorAssetCatalogRequestGeneration \|\| !isCurrentProjectOperation\(context\)/u);
});

test("asset trash and generated-video results are also bounded to the activation epoch", async () => {
  const [renderer, generatedRenderer] = await Promise.all([
    read("src/renderer/index.ts"),
    read("src/renderer/generated-video-ui.ts")
  ]);
  const trash = sliceBetween(renderer, "async function renderAssetTrash", "async function openAssetTrash");
  const generated = sliceBetween(generatedRenderer, "refresh = async", "generatedRefreshButton.addEventListener");
  assert.match(trash, /const context = captureProjectOperationContext\(\)/u);
  assert.match(trash, /requestGeneration = \+\+assetTrashRequestGeneration/u);
  assert.match(trash, /requestGeneration !== assetTrashRequestGeneration \|\| !isCurrentProjectOperation\(context\)/u);
  assert.match(generated, /const projectContext = dependencies\.getProjectContext\(\)/u);
  assert.match(generated, /requestToken = \+\+loadToken/u);
  assert.ok((generated.match(/requestToken !== loadToken/gu) ?? []).length >= 2);
  assert.ok((generated.match(/!dependencies\.isProjectContextCurrent\(projectContext\)/gu) ?? []).length >= 2);
  assert.match(generatedRenderer, /invalidateProject:[\s\S]*loadToken \+= 1[\s\S]*previewToken \+= 1[\s\S]*stopPolling\(\)/u);
});

test("asset thumbnails reject stale project, asset, epoch, generation, and detached targets", async () => {
  const renderer = await read("src/renderer/index.ts");
  const generic = sliceBetween(renderer, "function renderAssetPreviewResult", "function requestDirectorAssetPreview");
  const director = sliceBetween(renderer, "function requestDirectorAssetPreview", "function sortedAssetRecords");
  for (const guard of [
    "target.isConnected",
    "isCurrentProjectOperation(context)",
    "target.dataset.previewProjectId !== context.projectId",
    "target.dataset.previewAssetId !== assetId",
    "target.dataset.previewActivationEpoch !== String(context.activationEpoch)",
    "target.dataset.previewRequestGeneration !== String(requestGeneration)"
  ]) assert.ok(generic.includes(guard), `generic preview lacks ${guard}`);
  for (const guard of [
    "target.isConnected",
    "target.dataset.previewProjectId === projectId",
    "target.dataset.previewAssetId === assetId",
    "target.dataset.previewActivationEpoch === String(activationEpoch)",
    "target.dataset.previewRequestGeneration === String(requestGeneration)",
    "activeProjectActivationEpoch === activationEpoch",
    "directorProjectForAssetProjection()?.projectId === projectId"
  ]) assert.ok(director.includes(guard), `Director preview lacks ${guard}`);
});

test("frame selection and clearing cannot write UI state after a project switch", async () => {
  const renderer = await read("src/renderer/index.ts");
  const quick = sliceBetween(renderer, "async function chooseFrame", "function directorPurposeForFrameSlot");
  const director = sliceBetween(renderer, "async function chooseDirectorFrame", "function clearDirectorFrame");
  const clear = sliceBetween(renderer, "async function clearFrame", "firstFrameButton.addEventListener");
  assert.match(quick, /const context = captureProjectOperationContext\(\)/u);
  assert.ok((quick.match(/if \(!isCurrentProjectOperation\(context\)\) return/gu) ?? []).length >= 4);
  assert.match(quick, /loadRelayProject\(\{[\s\S]*?activate: false/u);
  assert.match(director, /const mutation = await flushAndCaptureProjectMutation\(\)/u);
  assert.ok((director.match(/if \(!isCurrentProjectOperation\(mutation\)\) return/gu) ?? []).length >= 3);
  assert.match(clear, /const context = captureProjectOperationContext\(\)/u);
  assert.match(clear, /await persistRelayProject\(updated\)[\s\S]{0,120}?if \(!isCurrentProjectOperation\(context\)\) return/u);
});

test("save conflicts reload authority and Director typing avoids full control redraws", async () => {
  const renderer = await read("src/renderer/index.ts");
  const conflict = sliceBetween(renderer, "function isProjectSaveConflict", "function adoptProjectAuthority");
  const persist = sliceBetween(renderer, "async function persistRelayProject", "function scheduleQuickProjectSave");
  const shotRender = sliceBetween(renderer, "function renderDirectorShots", "function directorTimelineSignature");
  assert.match(conflict, /loadRelayProject\(\{[\s\S]*?activate: false/u);
  assert.match(conflict, /activeRelayProject = authoritative/u);
  assert.match(conflict, /setQuickFormFromProject\(authoritative\)/u);
  assert.match(conflict, /resetDirectorSession\(authoritative\)[\s\S]*initializeDirectorWorkspace\(authoritative\)/u);
  assert.match(persist, /projectSaveConflictGenerationById/u);
  assert.match(persist, /reloadProjectAuthorityAfterConflict/u);
  assert.match(persist, /已重新载入磁盘中的最新版本/u);
  assert.ok((shotRender.match(/rerenderControls: false/gu) ?? []).length >= 2, "prompt, camera, and sound edits should preserve the existing controls and thumbnails");
});

test("T2V project relations remain record-only while executable image modes keep their inputs", async () => {
  const renderer = await read("src/renderer/index.ts");
  const controls = sliceBetween(renderer, "function renderDirectorWorkspaceControls", "function initializeDirectorWorkspace");
  const projectData = sliceBetween(renderer, "function renderDirectorProjectDataBindings", "function syncDirectorAssetRelationCopy");
  const copy = sliceBetween(renderer, "function syncDirectorAssetRelationCopy", "function renderDirectorShotAssetBindings");
  const bindings = sliceBetween(renderer, "function renderDirectorShotAssetBindings", "const inFlightActionKeys");
  assert.match(controls, /const boundAssetCount = mode === "T2V"\s*\? 0/u);
  assert.match(controls, /projection\.entries\.get\(binding\.bindingId\)\?\.status === "executable"/u);
  assert.match(projectData, /row\.dataset\.projectionStatus = "record_only"/u);
  assert.match(projectData, /targetKind:\s*"project"/u);
  assert.match(projectData, /不会建立镜头图片输入/u);
  assert.match(bindings, /mode === "T2V"[\s\S]*shotAssetsSection\.hidden = true/u);
  assert.match(bindings, /T2V 没有图片输入；连续性参考请在独立的“项目资料”区域管理/u);
  assert.match(bindings, /targetKind:\s*"shot"/u);
  assert.match(copy, /真实进入 FL2VA 工作流/u);
  assert.match(copy, /真实接入当前单镜头 Ref2VA 工作流/u);
});
