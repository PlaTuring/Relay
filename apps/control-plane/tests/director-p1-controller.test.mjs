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

const controllerModule = () => bundledModule("src/renderer/director-p1-controller.ts");
const productionModule = () => bundledModule("src/renderer/director-production.ts");

function draft(totalDurationSeconds, shots, patch = {}) {
  return {
    language: "zh",
    mode: "T2V",
    totalDurationSeconds,
    segmentDurationSeconds: 5,
    characterBible: "",
    worldBible: "",
    visualStyleBible: "",
    continuity: "",
    shots,
    overallSoundscape: "",
    nonDiegeticMusic: "",
    subjectDefinitions: "",
    summary: "",
    retentionAnalysis: "",
    styleOpening: "",
    ...patch
  };
}

function timeline(count, prefix = "镜头") {
  return Array.from({ length: count }, (_, index) => ({
    startSeconds: index * 5,
    durationSeconds: 5,
    description: `${prefix}${index + 1}`
  }));
}

function activeShots(state) {
  return state.scenes.flatMap((scene) => scene.shots).filter((shot) => !shot.archived);
}

test("30 to 60 seconds keeps the first six stable shot IDs and literal text", async () => {
  const { syncDirectorProductionState } = await controllerModule();
  const { createEmptyProductionState } = await productionModule();
  const first = syncDirectorProductionState({
    state: createEmptyProductionState({ identityKey: "extend" }),
    workflowName: "延长测试",
    draft: draft(30, timeline(6))
  });
  const firstIds = first.draft.shots.map((shot) => shot.id);
  const firstText = first.draft.shots.map((shot) => shot.description);
  const extendedShots = [
    ...first.draft.shots,
    ...timeline(6, "新增").map((shot, index) => ({ ...shot, startSeconds: (index + 6) * 5 }))
  ];
  const extended = syncDirectorProductionState({
    state: first.state,
    workflowName: "延长测试",
    draft: draft(60, extendedShots)
  });
  assert.deepEqual(extended.draft.shots.slice(0, 6).map((shot) => shot.id), firstIds);
  assert.deepEqual(extended.draft.shots.slice(0, 6).map((shot) => shot.description), firstText);
  assert.equal(activeShots(extended.state).length, 12);
  assert.equal(new Set(extended.draft.shots.map((shot) => shot.id)).size, 12);
});

test("shortening archives tail shots while preserving their references, continuity, and Take ledger", async () => {
  const { syncDirectorProductionState } = await controllerModule();
  const {
    addProductionTake,
    assignShotToScene,
    createEmptyProductionState,
    setShotContinuity,
    upsertProductionEntity
  } = await productionModule();
  let synced = syncDirectorProductionState({
    state: createEmptyProductionState({ identityKey: "shorten" }),
    workflowName: "缩短测试",
    draft: draft(15, timeline(3))
  });
  let state = upsertProductionEntity(synced.state, {
    kind: "prop",
    identityKey: "paper-crane",
    name: "纸鹤",
    notes: "金色微光"
  });
  const tailId = synced.draft.shots[2].id;
  assert.ok(tailId);
  const tailLocation = state.scenes.find((scene) => scene.shots.some((shot) => shot.id === tailId));
  assert.ok(tailLocation);
  state = assignShotToScene(state, tailLocation.id, {
    id: tailId,
    startSeconds: 10,
    durationSeconds: 5,
    entityIds: [state.entities[0].id]
  });
  state = setShotContinuity(state, tailId, "lighting", { mode: "override", value: "日出暖光" });
  state = addProductionTake(state, {
    shotId: tailId,
    localResultPath: "D:\\RelayResults\\tail.mp4",
    notes: "用户关联的已有结果"
  });
  const shortened = syncDirectorProductionState({
    state,
    workflowName: "缩短测试",
    draft: draft(10, synced.draft.shots.slice(0, 2))
  });
  const archived = shortened.state.scenes.flatMap((scene) => scene.shots).find((shot) => shot.id === tailId);
  assert.ok(archived);
  assert.equal(archived.archived, true);
  assert.deepEqual(archived.entityIds, [state.entities[0].id]);
  assert.equal(archived.continuity.lighting.value, "日出暖光");
  assert.equal(shortened.state.takes[0].shotId, tailId);
  assert.equal(shortened.state.takes[0].localResultPath, "D:\\RelayResults\\tail.mp4");
});

test("mechanical decoration includes scene, referenced entities, and resolved continuity only", async () => {
  const { decorateDirectorDraftForProduction, syncDirectorProductionState } = await controllerModule();
  const {
    addProductionTake,
    assignShotToScene,
    createEmptyProductionState,
    createProductionRevision,
    setProjectContinuityDefault,
    updateProductionTake,
    upsertProductionEntity,
    upsertProductionScene
  } = await productionModule();
  let synced = syncDirectorProductionState({
    state: createEmptyProductionState({ identityKey: "decorate" }),
    workflowName: "机械合并",
    draft: draft(10, timeline(2))
  });
  let state = upsertProductionEntity(synced.state, {
    kind: "character",
    identityKey: "courier",
    name: "快递员",
    notes: "明黄色雨衣",
    attributes: { prop: "红色配送包" }
  });
  const referencedId = state.entities[0].id;
  state = upsertProductionEntity(state, {
    kind: "location",
    identityKey: "unused",
    name: "未使用地点",
    notes: "这段原文不应进入工作流"
  });
  const unusedId = state.entities[1].id;
  const firstId = synced.draft.shots[0].id;
  assert.ok(firstId);
  const scene = state.scenes.find((candidate) => candidate.shots.some((shot) => shot.id === firstId));
  assert.ok(scene);
  state = upsertProductionScene(state, { id: scene.id, title: "雨夜屋顶", notes: "屋顶温室。" });
  state = assignShotToScene(state, scene.id, {
    id: firstId,
    startSeconds: 0,
    durationSeconds: 5,
    entityIds: [referencedId]
  });
  state = setProjectContinuityDefault(state, "lighting", "阴天漫射光");
  const revision = createProductionRevision(state, { directorSnapshot: "literal" });
  state = addProductionTake(revision.state, {
    shotId: firstId,
    localResultPath: "D:\\RelayResults\\candidate.mp4",
    notes: "第一版审阅"
  });
  const before = decorateDirectorDraftForProduction(state, synced.draft);
  assert.match(before.draft.shots[0].description, /场景: 雨夜屋顶/u);
  assert.match(before.draft.shots[0].description, /屋顶温室/u);
  assert.match(before.draft.shots[0].description, /快递员/u);
  assert.match(before.draft.shots[0].description, /明黄色雨衣/u);
  assert.match(before.draft.shots[0].description, /prop: 红色配送包/u);
  assert.match(before.draft.shots[0].description, /阴天漫射光/u);
  assert.doesNotMatch(before.draft.shots[0].description, /未使用地点|第一版审阅/u);

  state = upsertProductionEntity(state, {
    id: unusedId,
    kind: "location",
    name: "未使用地点改名",
    notes: "仍然不应进入工作流"
  });
  state = updateProductionTake(state, state.takes[0].id, { notes: "第二版审阅", rating: 5 });
  const afterUnusedChanges = decorateDirectorDraftForProduction(state, synced.draft);
  assert.deepEqual(afterUnusedChanges.effectiveFingerprints, before.effectiveFingerprints);

  state = upsertProductionEntity(state, {
    id: referencedId,
    kind: "character",
    name: "快递员",
    notes: "蓝色雨衣"
  });
  const afterReferencedChange = decorateDirectorDraftForProduction(state, synced.draft);
  assert.notEqual(afterReferencedChange.effectiveFingerprints[firstId], before.effectiveFingerprints[firstId]);
  const secondId = synced.draft.shots[1].id;
  assert.ok(secondId);
  assert.equal(afterReferencedChange.effectiveFingerprints[secondId], before.effectiveFingerprints[secondId]);
});

test("editing one shot changes only that shot's effective fingerprint", async () => {
  const { decorateDirectorDraftForProduction, syncDirectorProductionState } = await controllerModule();
  const { createEmptyProductionState } = await productionModule();
  const synced = syncDirectorProductionState({
    state: createEmptyProductionState({ identityKey: "per-shot" }),
    workflowName: "逐镜状态",
    draft: draft(10, timeline(2))
  });
  const before = decorateDirectorDraftForProduction(synced.state, synced.draft);
  const editedDraft = {
    ...synced.draft,
    shots: synced.draft.shots.map((shot, index) => index === 0 ? { ...shot, description: "只修改镜头一" } : shot)
  };
  const after = decorateDirectorDraftForProduction(synced.state, editedDraft);
  const firstId = synced.draft.shots[0].id;
  const secondId = synced.draft.shots[1].id;
  assert.ok(firstId && secondId);
  assert.notEqual(after.effectiveFingerprints[firstId], before.effectiveFingerprints[firstId]);
  assert.equal(after.effectiveFingerprints[secondId], before.effectiveFingerprints[secondId]);
});

test("v7 payload round-trips and v5 migration is explicit and fail-closed", async () => {
  const {
    buildDirectorV6Payload,
    buildDirectorV7Payload,
    restoreDirectorPayload,
    syncDirectorProductionState
  } = await controllerModule();
  const { createEmptyProductionState } = await productionModule();
  const synced = syncDirectorProductionState({
    state: createEmptyProductionState({ identityKey: "payload" }),
    workflowName: "持久化",
    draft: draft(10, timeline(2))
  });
  const payload = buildDirectorV7Payload({
    workflowName: "持久化",
    draft: synced.draft,
    state: synced.state,
    lastCompiledShotFingerprints: { [synced.draft.shots[0].id]: "fingerprint" },
    passthrough: { canvas: "16:9", version: 99, productionState: "must-not-win" }
  });
  assert.equal(payload.version, 7);
  assert.equal(payload.canvas, "16:9");
  assert.equal(payload.productionState.schemaVersion, 2);
  const restored = restoreDirectorPayload(payload);
  assert.equal(restored.ok, true);
  assert.equal(restored.sourceVersion, 7);
  assert.equal(restored.mayWriteBack, false);
  assert.equal(restored.draft.shots[0].id, synced.draft.shots[0].id);
  assert.equal(buildDirectorV6Payload({
    workflowName: "兼容导出名",
    draft: synced.draft,
    state: synced.state
  }).version, 7, "the deprecated v6-named export must never emit a new v6 envelope");

  const legacy = {
    version: 5,
    workflowName: "旧导播台",
    draft: draft(10, [
      { id: "shot-legacy-001", startSeconds: 0, durationSeconds: 5, description: "旧镜头一" },
      { id: "shot-legacy-002", startSeconds: 5, durationSeconds: 5, description: "旧镜头二" }
    ])
  };
  const migrated = restoreDirectorPayload(legacy);
  assert.equal(migrated.ok, true);
  assert.equal(migrated.sourceVersion, 5);
  assert.deepEqual(migrated.draft.shots.map((shot) => shot.id), ["shot-legacy-001", "shot-legacy-002"]);
  assert.equal(migrated.mayWriteBack, false, "migration never authorizes implicit storage overwrite");

  const invalid = restoreDirectorPayload({ version: 5, workflowName: "损坏", draft: null });
  assert.deepEqual(invalid, {
    ok: false,
    error: "专业导播草稿缺少有效的镜头数据。",
    mayWriteBack: false
  });
});

test("successful async completion revisions the submitted snapshot; failure does not", async () => {
  const {
    captureDirectorP1Submission,
    commitDirectorP1Compilation,
    restoreDirectorP1Revision,
    syncDirectorProductionState
  } = await controllerModule();
  const { createEmptyProductionState } = await productionModule();
  const initial = syncDirectorProductionState({
    state: createEmptyProductionState({ identityKey: "async" }),
    workflowName: "提交快照",
    draft: draft(5, timeline(1, "提交时"))
  });
  const submission = captureDirectorP1Submission({
    state: initial.state,
    workflowName: "提交快照",
    draft: initial.draft
  });
  const editedDraft = {
    ...initial.draft,
    shots: [{ ...initial.draft.shots[0], description: "等待编译期间的编辑" }]
  };
  const live = syncDirectorProductionState({
    state: initial.state,
    workflowName: "提交快照-当前",
    draft: editedDraft
  });
  const failed = commitDirectorP1Compilation({
    currentState: live.state,
    submission,
    succeeded: false
  });
  assert.equal(failed.revision, null);
  assert.equal(failed.state.revisions.length, 0);

  const succeeded = commitDirectorP1Compilation({
    currentState: live.state,
    submission,
    succeeded: true,
    createdAt: "2026-08-29T10:00:00.000Z"
  });
  assert.ok(succeeded.revision);
  assert.equal(succeeded.state.revisions.length, 1);
  assert.equal(activeShots(succeeded.state)[0].description, "等待编译期间的编辑", "live work copy is not rolled back");
  const revisionProduction = JSON.parse(succeeded.revision.productionSnapshot);
  assert.equal(revisionProduction.scenes[0].shots[0].description, "提交时1");
  const restored = restoreDirectorP1Revision(succeeded.state, succeeded.revision.id);
  assert.equal(restored.ok, true);
  assert.equal(restored.draft.shots[0].description, "提交时1");
  assert.equal(activeShots(restored.state)[0].description, "提交时1");
});

test("P1 controller stays local and exposes no creative or generation surface", async () => {
  const source = await readFile(resolve(root, "src/renderer/director-p1-controller.ts"), "utf8");
  assert.doesNotMatch(source, /fetch\s*\(|XMLHttpRequest|WebSocket|node:fs|readFile|writeFile|\/prompt|queuePrompt|submitPrompt/u);
  assert.doesNotMatch(source, /generate(?:Video|Audio)|runComfy|autoQueue|translatePrompt|expandPrompt/u);
  assert.match(source, /mechanical concatenation only/u);
  assert.match(source, /succeeded/u);
  assert.match(source, /mayWriteBack: false/u);
});
