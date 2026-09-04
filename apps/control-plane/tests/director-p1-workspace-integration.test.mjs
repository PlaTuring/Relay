import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const read = (relativePath) => readFile(resolve(root, relativePath), "utf8");

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

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing start marker: ${startMarker}`);
  assert.ok(end > start, `missing end marker after ${startMarker}: ${endMarker}`);
  return source.slice(start, end);
}

test("P1 director is one professional workspace with compact history, summary, and one contextual drawer", async () => {
  const html = await read("src/renderer/index.html");

  assert.match(
    html,
    /id="director-p1-workspace"[^>]*data-director-p1-region="production-workspace"[^>]*data-workspace-view="studio"/u
  );
  assert.doesNotMatch(html, /data-director-workspace-view="(?:shots|data|continuity|history)"/u);
  assert.doesNotMatch(html, /id="director-workspace-tabs"/u);
  assert.doesNotMatch(html, /版本与结果/u);
  assert.match(html, /<details id="director-p1-history-drawer"/u);
  assert.match(html, /<aside id="director-current-shot-summary"[^>]*data-layout-area="shot-inspector"/u);
  assert.match(html, /<section id="director-p1-current-shot-tools"[^>]*hidden/u);
  assert.equal((html.match(/id="director-workspace-drawer"/gu) ?? []).length, 1);
  assert.match(html, /id="director-workspace-drawer"[^>]*role="dialog"/u);
  assert.match(html, /id="director-drawer-shot-host"/u);
  assert.match(html, /id="director-p1-data-layer"/u);
  assert.match(html, /id="director-p1-shot-stage"/u);
  assert.match(html, /id="director-p1-shot-asset-bindings"[^>]*data-director-asset-binding-host="shot"/u);
});

test("page navigation is presentation-only and cannot clear an unsaved director form", async () => {
  const renderer = await read("src/renderer/index.ts");
  const switcher = sliceBetween(renderer, "function showView", "function formatGiB");

  assert.match(switcher, /section\.hidden\s*=\s*!active/u);
  assert.match(switcher, /section\.classList\.toggle\("is-active",\s*active\)/u);
  assert.doesNotMatch(
    switcher,
    /replaceChildren|innerHTML|localStorage|sessionStorage|\.value\s*=|renderDirectorShots|restoreDirectorDraft|collectDirectorDraft/u
  );
});

test("P1 production surface exposes real entity, scene, continuity, Revision, and Take data controls only", async () => {
  const [html, ui, controller, production] = await Promise.all([
    read("src/renderer/index.html"),
    read("src/renderer/director-p1-ui.ts"),
    read("src/renderer/director-p1-controller.ts"),
    read("src/renderer/director-production.ts")
  ]);

  for (const id of [
    "director-p1-entities-panel",
    "director-p1-scenes-panel",
    "director-p1-continuity-panel",
    "director-p1-revisions-panel",
    "director-p1-takes-panel"
  ]) {
    assert.ok(html.includes(`id="${id}"`), `missing P1 production surface: ${id}`);
  }
  assert.ok(html.includes('data-workspace-panel="data"'));
  assert.equal(/data-workspace-panel="(?:continuity|history)"/u.test(html), false);

  const p1Actions = [...html.matchAll(/data-director-p1-action="([^"]+)"/gu)].map((match) => match[1]);
  assert.ok(p1Actions.includes("save-entity"));
  assert.ok(p1Actions.includes("save-scene"));
  assert.ok(p1Actions.includes("save-continuity"));
  assert.match(ui, /button\.dataset\.directorP1Action = "set-continuity-mode"/u);
  assert.ok(p1Actions.includes("restore-revision"));
  assert.ok(p1Actions.includes("save-take"));
  assert.equal(p1Actions.some((action) => /generate|run|queue|submit|prompt|inference/iu.test(action)), false);

  const p1Sources = [ui, controller, production].join("\n");
  assert.doesNotMatch(
    p1Sources,
    /\/prompt|queuePrompt|submitPrompt|compileAndOpenWorkflow|requestSubmit\s*\(|fetch\s*\(|XMLHttpRequest|WebSocket|child_process|node:fs/iu
  );
});

test("renderer persists the complete P1 work copy through the current director envelope without an implicit rewrite", async () => {
  const renderer = await read("src/renderer/index.ts");
  const save = sliceBetween(renderer, "function saveDirectorDraft", "function captureDirectorCompilation");
  const applyWorkCopy = sliceBetween(
    renderer,
    "function applyDirectorDraftToWorkCopy",
    "function restoreDirectorProductionRevisionToWorkCopy"
  );
  const restoreRevision = sliceBetween(
    renderer,
    "function restoreDirectorProductionRevisionToWorkCopy",
    "function restoreDirectorDraft"
  );
  const restore = sliceBetween(renderer, "function restoreDirectorDraft", "function validateDirectorForCompilation");

  assert.match(save, /buildDirectorV\d+Payload\s*\(\s*\{/u);
  assert.match(save, /state:\s*synchronized\.state/u);
  assert.match(save, /lastCompiledShotFingerprints:\s*directorLastCompiledShotFingerprints/u);
  assert.match(save, /lastCompiledTechnicalSnapshot:\s*directorLastCompiledTechnicalSnapshot/u);
  assert.match(save, /if \(activeRelayProject === null \|\| context === null\) throw new Error/u);
  assert.match(save, /requireCurrentProjectOperation\(context\)[\s\S]*await persistRelayProject\(nextProject\)[\s\S]*requireCurrentProjectOperation\(context\)/u);
  assert.match(save, /preservedLegacyDirectorState:\s*jsonPayload/u);
  assert.match(save, /await persistRelayProject\(nextProject\)/u);
  assert.doesNotMatch(save, /localStorage/u);
  assert.doesNotMatch(save, /localStorage\.setItem/u);

  const takeMapCapture = save.indexOf("const pendingShotIdMap = directorLegacyShotIdMap");
  const takeRekey = save.indexOf("shotId: pendingShotIdMap[take.shotId] ?? take.shotId", takeMapCapture);
  const takePersist = save.indexOf("await persistRelayProject(nextProject)", takeRekey);
  const takeMapClear = save.indexOf("directorLegacyShotIdMap = Object.freeze({})", takePersist);
  assert.ok(
    takeMapCapture >= 0 && takeRekey > takeMapCapture && takePersist > takeRekey && takeMapClear > takePersist,
    "legacy metadata Takes must be re-keyed in the same CAS save, then clear the temporary map only after persistence"
  );

  assert.match(restore, /payload\.version === 5 \|\| payload\.version === 6(?: \|\| payload\.version === 7)?/u);
  const payloadRestore = restore.indexOf("restoreDirectorPayload(payload)");
  const payloadReconcile = restore.indexOf("reconcileProfessionalDirectorStateWithProject", payloadRestore);
  const payloadApply = restore.indexOf("applyDirectorDraftToWorkCopy", payloadReconcile);
  assert.ok(
    payloadRestore >= 0 && payloadReconcile > payloadRestore && payloadApply > payloadReconcile,
    "a preserved v5/v6/v7 payload must restore, reconcile to project IDs, and only then enter the work copy"
  );
  assert.match(
    restore.slice(payloadReconcile, payloadApply + 180),
    /applyDirectorDraftToWorkCopy\(restored\.workflowName,\s*reconciled\.draft,\s*reconciled\.state,\s*payload\)/u
  );
  assert.match(applyWorkCopy, /directorProductionState\s*=\s*state/u);
  assert.match(applyWorkCopy, /directorP1Ui\.setState\(directorProductionState\)/u);
  assert.match(restore, /directorLastCompiledShotFingerprints\s*=\s*reconciled\.lastCompiledShotFingerprints/u);

  const revisionRestore = restoreRevision.indexOf("restoreDirectorP1Revision");
  const revisionReconcile = restoreRevision.indexOf("reconcileProfessionalDirectorStateWithProject", revisionRestore);
  const revisionFailureGuard = restoreRevision.indexOf("if (!reconciled.ok)", revisionReconcile);
  const revisionApply = restoreRevision.indexOf("applyDirectorDraftToWorkCopy", revisionFailureGuard);
  assert.ok(
    revisionRestore >= 0
      && revisionReconcile > revisionRestore
      && revisionFailureGuard > revisionReconcile
      && revisionApply > revisionFailureGuard,
    "history restore must reconcile and pass its fail-closed guard before applying any work-copy state"
  );
  assert.match(
    restoreRevision.slice(revisionApply, revisionApply + 180),
    /applyDirectorDraftToWorkCopy\(restored\.workflowName,\s*reconciled\.draft,\s*reconciled\.state\)/u
  );
  assert.doesNotMatch(restore, /localStorage\.setItem/u);
  assert.doesNotMatch(restore, /localStorage|legacyStored|DIRECTOR_DRAFT_STORAGE_KEY/u);
});

test("Take registration requires a successful Revision and binds a real Asset ID without a raw path picker", async () => {
  const [html, ui] = await Promise.all([
    read("src/renderer/index.html"),
    read("src/renderer/director-p1-ui.ts")
  ]);

  assert.match(html, /id="director-p1-take-asset"[^>]*data-director-p1-action="select-take-asset"/u);
  assert.doesNotMatch(html, /director-p1-take-(?:path|browse)/u);
  assert.match(ui, /setAssetOptions\(assets:\s*readonly DirectorP1AssetOption\[\]\)/u);
  assert.match(ui, /assetId:\s*takeAsset\.value/u);
  assert.match(ui, /state\.activeRevisionId === null/u);
  assert.match(ui, /revisionId:\s*state\.activeRevisionId/u);
  assert.doesNotMatch(ui, /chooseResultMedia|displayPath|basename\s*\(|localResultPath/u);
});

test("only a successful workflow handoff commits the captured P1 submission as a Revision", async () => {
  const renderer = await read("src/renderer/index.ts");
  const capture = sliceBetween(renderer, "function captureDirectorCompilation", "function markDirectorCompiled");
  const commit = sliceBetween(renderer, "function markDirectorCompiled", "function optionValueExists");
  const submit = sliceBetween(
    renderer,
    'projectForm.addEventListener("submit"',
    "void (async () => {\n  try {\n    const bootstrap"
  );

  assert.match(capture, /captureDirectorP1Submission\s*\(\s*\{/u);
  assert.match(capture, /compilationSnapshot:[\s\S]*?submission\.effectiveDraft/u);
  assert.match(capture, /technicalSnapshot:\s*currentDirectorTechnicalSnapshot\(\)/u);
  assert.match(commit, /commitDirectorP1Compilation\s*\(\s*\{[\s\S]*?submission:\s*pending\.submission,[\s\S]*?succeeded:\s*true/u);
  assert.match(commit, /directorLastCompiledShotFingerprints\s*=\s*pending\.submission\.effectiveFingerprints/u);

  const handoffCall = submit.indexOf("await window.controlPlane.compileAndOpenWorkflow");
  const revisionCall = submit.indexOf("markDirectorCompiled(submittedDirectorCompilation)");
  const catchBranch = submit.indexOf("} catch (error)");
  assert.ok(handoffCall >= 0 && revisionCall > handoffCall, "Revision must be committed only after the handoff resolves");
  assert.ok(catchBranch > revisionCall, "Revision commit must remain outside the failure branch");
  assert.doesNotMatch(submit.slice(catchBranch), /markDirectorCompiled|commitDirectorP1Compilation/u);
});

test("compiled state is tracked per stable shot fingerprint, including timeline and card status", async () => {
  const renderer = await read("src/renderer/index.ts");
  const status = sliceBetween(renderer, "function updateDirectorShotStatuses", "function renderDirectorTimeline");

  assert.match(status, /production\.decorated\.effectiveFingerprints\[shot\.id \?\? ""\]/u);
  assert.match(status, /directorLastCompiledShotFingerprints\[shot\.id\]\s*===\s*fingerprint/u);
  assert.match(status, /card\.dataset\.compileState\s*=\s*compiled \? "compiled" : "dirty"/u);
  assert.match(status, /timelineSegment\?\.classList\.toggle\("is-dirty",\s*!compiled\)/u);
  assert.match(status, /timelineSegment\?\.classList\.toggle\("is-compiled",\s*compiled\)/u);
  assert.match(status, /if \(!compiled\) dirtyCount \+= 1/u);
  assert.doesNotMatch(status, /directorCompilationIsCurrent/u);
});

test("P1 timeline sorting and authoritative scene membership remain deterministic with duplicate scene names", async () => {
  const [ui, production] = await Promise.all([
    bundledModule("src/renderer/director-p1-ui.ts"),
    bundledModule("src/renderer/director-production.ts")
  ]);
  const { activeShotsForP1, replaceSceneMembership } = ui;
  const { assignShotToScene, createEmptyProductionState, upsertProductionScene } = production;

  const addScene = (current, identityKey, title) => {
    const known = new Set(current.scenes.map((scene) => scene.id));
    const next = upsertProductionScene(current, { identityKey, title });
    const created = next.scenes.find((scene) => !known.has(scene.id));
    assert.ok(created, `scene must be created for ${identityKey}`);
    return { state: next, id: created.id };
  };

  let state = createEmptyProductionState({ identityKey: "p1-ui-membership" });
  let created = addScene(state, "default", "默认场景");
  state = created.state;
  const defaultId = created.id;
  created = addScene(state, "target", "同名场景");
  state = created.state;
  const targetId = created.id;
  created = addScene(state, "duplicate", "同名场景");
  state = created.state;
  const duplicateId = created.id;

  state = assignShotToScene(state, defaultId, {
    id: "shot-aaa",
    startSeconds: 10,
    durationSeconds: 5,
    description: "A"
  });
  state = assignShotToScene(state, targetId, {
    id: "shot-bbb",
    startSeconds: 0,
    durationSeconds: 10,
    description: "B"
  });
  state = assignShotToScene(state, targetId, {
    id: "shot-ccc",
    startSeconds: 0,
    durationSeconds: 5,
    description: "C"
  });
  state = assignShotToScene(state, duplicateId, {
    id: "shot-ddd",
    startSeconds: 15,
    durationSeconds: 5,
    description: "D"
  });

  assert.deepEqual(activeShotsForP1(state).map((shot) => shot.id), ["shot-ccc", "shot-bbb", "shot-aaa", "shot-ddd"]);

  state = replaceSceneMembership(state, targetId, ["shot-aaa", "shot-ccc"]);
  assert.deepEqual(state.scenes.find((scene) => scene.id === targetId).shots.map((shot) => shot.id), ["shot-ccc", "shot-aaa"]);
  assert.deepEqual(state.scenes.find((scene) => scene.id === defaultId).shots.map((shot) => shot.id), ["shot-bbb"]);
  assert.deepEqual(state.scenes.find((scene) => scene.id === duplicateId).shots.map((shot) => shot.id), ["shot-ddd"]);

  state = replaceSceneMembership(state, targetId, []);
  assert.deepEqual(state.scenes.find((scene) => scene.id === targetId).shots, []);
  assert.deepEqual(state.scenes.find((scene) => scene.id === defaultId).shots.map((shot) => shot.id), ["shot-bbb", "shot-ccc", "shot-aaa"]);
  assert.deepEqual(state.scenes.find((scene) => scene.id === duplicateId).shots.map((shot) => shot.id), ["shot-ddd"]);
  assert.deepEqual(activeShotsForP1(state).map((shot) => shot.id), ["shot-ccc", "shot-bbb", "shot-aaa", "shot-ddd"]);
});

test("P1 source contracts clear invalid shot selection, synchronize continuity editing, and prevalidate Take bindings in Chinese", async () => {
  const ui = await read("src/renderer/director-p1-ui.ts");
  const saveScene = sliceBetween(ui, 'if (action === "save-scene")', 'if (action === "archive-scene"');
  const renderContinuity = sliceBetween(ui, "function renderContinuity", "function renderRevisions");
  const publicApi = ui.slice(ui.indexOf("return Object.freeze({", ui.indexOf("function createDirectorP1Ui")));

  assert.match(saveScene, /const knownSceneIds = new Set\(state\.scenes\.map\(\(scene\) => scene\.id\)\)/u);
  assert.match(saveScene, /next\.scenes\.find\(\(scene\) => !knownSceneIds\.has\(scene\.id\)\)\?\.id/u);
  assert.doesNotMatch(saveScene, /scene\.title\s*===\s*sceneName/u);
  assert.match(saveScene, /replaceSceneMembership\(next,\s*target,\s*selectedShotIds\)/u);

  assert.match(ui, /activeShotId !== null && activeShotLocation\(state, activeShotId\) === null\) activeShotId = null/u);
  assert.match(publicApi, /activeShotId = shotId !== null && activeShotLocation\(state, shotId\) !== null \? shotId : null/u);
  assert.doesNotMatch(publicApi, /activeShotsForP1\(state\)\[0\]\?\.id/u);

  assert.match(renderContinuity, /continuityLocks\.disabled = continuityMode\.value !== "override"/u);
  assert.match(ui, /continuityMode\.addEventListener\("change",\s*\(\) => \{[\s\S]*?continuityLocks\.disabled = continuityMode\.value !== "override"/u);
  assert.match(ui, /if \(takeAsset\.value\.length === 0\) throw new TypeError\("请先从素材库选择本地成片或候选素材。"\)/u);
});
