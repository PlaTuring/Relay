import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");

async function productionModule() {
  const result = await build({
    entryPoints: [resolve(root, "src/renderer/director-production.ts")],
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

test("empty production state is JSON-persistable, canonical, and deeply immutable", async () => {
  const { canonicalProductionJson, canonicalProductionSnapshot, createEmptyProductionState } = await productionModule();
  const state = createEmptyProductionState({ projectName: "屋顶花园", identityKey: "project-1" });
  assert.equal(state.schemaVersion, 2);
  assert.deepEqual(state.assets, []);
  assert.deepEqual(state.bindings, []);
  assert.deepEqual(state.legacyAssetEntities, []);
  assert.equal(state.project.name, "屋顶花园");
  assert.match(state.project.id, /^project-[a-f0-9]{20}$/u);
  assert.equal(Object.isFrozen(state), true);
  assert.equal(Object.isFrozen(state.project.continuityDefaults), true);
  assert.throws(() => { state.project.name = "mutated"; }, TypeError);
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
  assert.equal(canonicalProductionJson({ z: 1, a: 2 }), '{"a":2,"z":1}');
  assert.equal(canonicalProductionSnapshot(state), canonicalProductionSnapshot(createEmptyProductionState({
    projectName: "屋顶花园",
    identityKey: "project-1"
  })));
});

test("entity library uses stable IDs and recoverable deletion", async () => {
  const { archiveProductionEntity, createEmptyProductionState, restoreProductionEntity, upsertProductionEntity } = await productionModule();
  let state = createEmptyProductionState({ identityKey: "entities" });
  const callerAttributes = { wardrobe: "黄色雨衣" };
  state = upsertProductionEntity(state, {
    kind: "character",
    name: "快递员",
    identityKey: "courier",
    attributes: callerAttributes
  });
  const entityId = state.entities[0].id;
  callerAttributes.wardrobe = "蓝色外套";
  assert.equal(state.entities[0].attributes.wardrobe, "黄色雨衣");

  state = upsertProductionEntity(state, {
    kind: "character",
    name: "快递员 A",
    identityKey: "courier",
    notes: "保留面部与背包。"
  });
  assert.equal(state.entities.length, 1);
  assert.equal(state.entities[0].id, entityId);
  assert.equal(state.entities[0].name, "快递员 A");

  state = archiveProductionEntity(state, entityId);
  assert.equal(state.entities.length, 1);
  assert.equal(state.entities[0].archived, true);
  state = restoreProductionEntity(state, entityId);
  assert.equal(state.entities[0].archived, false);
  assert.equal(state.entities[0].name, "快递员 A");
  assert.throws(() => archiveProductionEntity(state, "entity-not-found"), /Unknown/u);
  assert.throws(() => restoreProductionEntity(state, "entity-not-found"), /Unknown/u);
});

test("scene deletion is reversible without changing scene or shot identity", async () => {
  const {
    archiveProductionScene,
    assignShotToScene,
    createEmptyProductionState,
    restoreProductionScene,
    upsertProductionScene
  } = await productionModule();
  let state = createEmptyProductionState({ identityKey: "recover-scene" });
  state = upsertProductionScene(state, { title: "雨夜屋顶", identityKey: "roof" });
  const sceneId = state.scenes[0].id;
  state = assignShotToScene(state, sceneId, { identityKey: "shot-1", startSeconds: 0, durationSeconds: 5 });
  const shotId = state.scenes[0].shots[0].id;
  state = archiveProductionScene(state, sceneId);
  assert.equal(state.scenes[0].archived, true);
  assert.equal(state.scenes[0].shots[0].id, shotId);
  state = restoreProductionScene(state, sceneId);
  assert.equal(state.scenes[0].archived, false);
  assert.equal(state.scenes[0].id, sceneId);
  assert.equal(state.scenes[0].shots[0].id, shotId);
});

test("project-scene-shot hierarchy maps and moves a stable shot without duplication", async () => {
  const { assignShotToScene, createEmptyProductionState, upsertProductionScene } = await productionModule();
  let state = createEmptyProductionState({ identityKey: "hierarchy" });
  state = upsertProductionScene(state, { title: "屋顶", identityKey: "roof", order: 2 });
  state = upsertProductionScene(state, { title: "巷道", identityKey: "alley", order: 1 });
  assert.deepEqual(state.scenes.map((scene) => scene.title), ["巷道", "屋顶"]);

  const alleyId = state.scenes[0].id;
  const roofId = state.scenes[1].id;
  state = assignShotToScene(state, alleyId, {
    identityKey: "opening",
    startSeconds: 0,
    durationSeconds: 5,
    description: "快递员进入巷道。"
  });
  const shotId = state.scenes[0].shots[0].id;
  state = assignShotToScene(state, roofId, {
    id: shotId,
    startSeconds: 0,
    durationSeconds: 5,
    description: "快递员抵达屋顶。"
  });
  assert.equal(state.scenes.find((scene) => scene.id === alleyId).shots.length, 0);
  assert.equal(state.scenes.find((scene) => scene.id === roofId).shots.length, 1);
  assert.equal(state.scenes.find((scene) => scene.id === roofId).shots[0].id, shotId);
});

test("continuity matrix resolves project, scene, shot, and explicit blank overrides", async () => {
  const {
    assignShotToScene,
    buildContinuityMatrix,
    createEmptyProductionState,
    resolveShotContinuity,
    setProjectContinuityDefault,
    setSceneContinuity,
    setShotContinuity,
    unsetShotContinuity,
    upsertProductionScene
  } = await productionModule();
  let state = createEmptyProductionState({ identityKey: "continuity" });
  state = upsertProductionScene(state, { title: "场景", identityKey: "scene" });
  const sceneId = state.scenes[0].id;
  state = assignShotToScene(state, sceneId, { identityKey: "shot", startSeconds: 0, durationSeconds: 5 });
  const shotId = state.scenes[0].shots[0].id;
  state = setProjectContinuityDefault(state, "wardrobe", "黄色雨衣");
  state = setProjectContinuityDefault(state, "lighting", "阴天漫射光");
  state = setSceneContinuity(state, sceneId, "lighting", { mode: "override", value: "日出暖光" });
  state = setShotContinuity(state, shotId, "lighting", { mode: "inherit", value: "ignored" });
  state = setShotContinuity(state, shotId, "wardrobe", { mode: "override", value: "" });

  const matrix = Object.fromEntries(resolveShotContinuity(state, shotId).map((cell) => [cell.dimension, cell]));
  assert.deepEqual(matrix.lighting, {
    dimension: "lighting",
    value: "日出暖光",
    source: "scene",
    inherited: true
  });
  assert.deepEqual(matrix.wardrobe, {
    dimension: "wardrobe",
    value: "",
    source: "shot",
    inherited: false
  });
  assert.equal(matrix.sound.source, "empty");
  assert.equal(Object.isFrozen(matrix.lighting), true);
  const allShots = buildContinuityMatrix(state);
  assert.equal(allShots.length, 1);
  assert.equal(allShots[0].shotId, shotId);
  assert.equal(Object.isFrozen(allShots[0].cells), true);

  state = unsetShotContinuity(state, shotId, "wardrobe");
  assert.equal(state.scenes[0].shots[0].continuity.wardrobe, undefined);
  assert.equal(resolveShotContinuity(state, shotId).find((cell) => cell.dimension === "wardrobe").source, "project");
});

test("revision identity ignores timestamp but preserves lineage and recoverable snapshots", async () => {
  const {
    assignShotToScene,
    createEmptyProductionState,
    createProductionRevision,
    restoreProductionRevision,
    upsertProductionScene
  } = await productionModule();
  let state = createEmptyProductionState({ projectName: "Revision", identityKey: "revision" });
  state = upsertProductionScene(state, { title: "场景一", identityKey: "scene-1" });
  const sceneId = state.scenes[0].id;
  state = assignShotToScene(state, sceneId, {
    identityKey: "shot-1",
    startSeconds: 0,
    durationSeconds: 5,
    description: "原始镜头"
  });
  const first = createProductionRevision(state, {
    directorSnapshot: '{"prompt":"literal"}',
    createdAt: "2026-01-01T00:00:00.000Z"
  });
  assert.match(first.revision.id, /^revision-[a-f0-9]{20}$/u);
  assert.equal(first.revision.parentRevisionId, null);
  assert.doesNotMatch(first.revision.productionSnapshot, /revisions/u);
  assert.equal(JSON.parse(first.revision.directorSnapshot).prompt, "literal");

  const sameContentDifferentClock = createProductionRevision(state, {
    directorSnapshot: '{"prompt":"literal"}',
    createdAt: "2030-01-01T00:00:00.000Z"
  });
  assert.equal(sameContentDifferentClock.revision.id, first.revision.id);

  state = assignShotToScene(first.state, sceneId, {
    identityKey: "shot-2",
    startSeconds: 5,
    durationSeconds: 5,
    description: "新增镜头"
  });
  const second = createProductionRevision(state, { directorSnapshot: '{"prompt":"literal-2"}' });
  assert.equal(second.revision.parentRevisionId, first.revision.id);
  assert.notEqual(second.revision.id, first.revision.id);
  const restored = restoreProductionRevision(second.state, first.revision.id);
  assert.equal(restored.scenes[0].shots.length, 1);
  assert.equal(restored.activeRevisionId, first.revision.id);
  assert.equal(restored.revisions.length, 2);
});

test("take timestamps are recoverable metadata but do not change revision identity", async () => {
  const {
    addProductionTake,
    assignShotToScene,
    createEmptyProductionState,
    createProductionRevision,
    upsertProductionScene
  } = await productionModule();
  let base = createEmptyProductionState({ identityKey: "revision-take-metadata" });
  base = upsertProductionScene(base, { title: "场景", identityKey: "scene" });
  base = assignShotToScene(base, base.scenes[0].id, { identityKey: "shot", startSeconds: 0, durationSeconds: 5 });
  const shotId = base.scenes[0].shots[0].id;
  const early = addProductionTake(base, {
    shotId,
    localResultPath: "D:\\Results\\same.mp4",
    createdAt: "2026-01-01T00:00:00.000Z"
  });
  const late = addProductionTake(base, {
    shotId,
    localResultPath: "D:\\Results\\same.mp4",
    createdAt: "2036-01-01T00:00:00.000Z"
  });
  const earlyRevision = createProductionRevision(early, { directorSnapshot: "literal", createdAt: "2026" });
  const lateRevision = createProductionRevision(late, { directorSnapshot: "literal", createdAt: "2036" });
  assert.equal(earlyRevision.revision.id, lateRevision.revision.id);
  assert.notEqual(earlyRevision.revision.productionSnapshot, lateRevision.revision.productionSnapshot);
});

test("take ledger only records caller-selected paths and keeps one selected take per shot", async () => {
  const {
    addProductionTake,
    archiveProductionTake,
    assignShotToScene,
    createEmptyProductionState,
    updateProductionTake,
    upsertProductionScene
  } = await productionModule();
  let state = createEmptyProductionState({ identityKey: "takes" });
  state = upsertProductionScene(state, { title: "场景", identityKey: "scene" });
  state = assignShotToScene(state, state.scenes[0].id, { identityKey: "shot", startSeconds: 0, durationSeconds: 5 });
  const shotId = state.scenes[0].shots[0].id;
  state = addProductionTake(state, {
    shotId,
    name: "候选一",
    localResultPath: "D:\\Results\\take-1.mp4",
    status: "selected",
    createdAt: "2026-01-01T00:00:00.000Z"
  });
  const firstId = state.takes[0].id;
  state = addProductionTake(state, {
    shotId,
    localResultPath: "D:\\Results\\take-2.mp4",
    status: "selected",
    rating: 5
  });
  assert.deepEqual(state.takes.map((take) => take.status), ["candidate", "selected"]);
  assert.equal(state.takes[1].createdAt, "");
  state = updateProductionTake(state, firstId, { notes: "用户保留", rating: 4, status: "selected" });
  assert.deepEqual(state.takes.map((take) => take.status), ["selected", "candidate"]);
  assert.equal(state.takes[0].localResultPath, "D:\\Results\\take-1.mp4");
  assert.equal(state.takes[0].name, "候选一");
  state = archiveProductionTake(state, firstId);
  assert.equal(state.takes[0].status, "archived");
  assert.equal(state.takes.length, 2);
  assert.throws(() => addProductionTake(state, { shotId, localResultPath: "" }), /asset ID|localResultPath/iu);
});

test("compile identity ignores unreferenced library records and Take review metadata", async () => {
  const {
    addProductionTake,
    assignShotToScene,
    canonicalCompilationProductionSnapshot,
    createEmptyProductionState,
    createProductionRevision,
    upsertProductionEntity,
    upsertProductionScene
  } = await productionModule();
  let state = createEmptyProductionState({ identityKey: "compile-snapshot" });
  state = upsertProductionScene(state, { title: "场景", identityKey: "scene" });
  const sceneId = state.scenes[0].id;
  state = assignShotToScene(state, sceneId, { identityKey: "shot", startSeconds: 0, durationSeconds: 5 });
  const shotId = state.scenes[0].shots[0].id;
  const baseSnapshot = canonicalCompilationProductionSnapshot(state);

  state = upsertProductionEntity(state, { kind: "prop", name: "纸鹤", identityKey: "crane" });
  const entityId = state.entities[0].id;
  assert.equal(canonicalCompilationProductionSnapshot(state), baseSnapshot);

  const revisionResult = createProductionRevision(state, { directorSnapshot: "literal" });
  state = addProductionTake(revisionResult.state, {
    shotId,
    localResultPath: "D:\\Results\\review.mp4",
    notes: "审阅备注",
    rating: 3
  });
  assert.equal(state.takes[0].revisionId, revisionResult.revision.id);
  assert.equal(canonicalCompilationProductionSnapshot(state), baseSnapshot);

  state = assignShotToScene(state, sceneId, {
    id: shotId,
    startSeconds: 0,
    durationSeconds: 5,
    entityIds: [entityId]
  });
  assert.notEqual(canonicalCompilationProductionSnapshot(state), baseSnapshot);
});

test("v5 migration preserves literal fields and shot IDs without creative inference", async () => {
  const { migrateDirectorV5Draft } = await productionModule();
  const legacy = {
    version: 5,
    workflowName: "雨夜花园",
    canvas: "16:9",
    resolution: "0.98",
    seed: "42",
    seedPolicy: "random_per_compile",
    sampling: "turbo_8",
    lastCompiledSnapshot: "literal-compiled-state",
    draft: {
      language: "zh",
      mode: "T2V",
      totalDurationSeconds: 10,
      segmentDurationSeconds: 5,
      characterBible: "黄色雨衣、红色背包。",
      worldBible: "重庆屋顶。",
      visualStyleBible: "真人电影感。",
      continuity: "外观保持一致。",
      shots: [
        { id: "shot-legacy-001", startSeconds: 0, durationSeconds: 5, description: "镜头一原文", cameraLanguage: "低机位" },
        { id: "shot-legacy-002", startSeconds: 5, durationSeconds: 5, description: "镜头二原文", soundCue: "雨声" }
      ]
    }
  };
  const migrated = migrateDirectorV5Draft(legacy);
  legacy.draft.shots[0].description = "caller mutation";
  assert.deepEqual(migrated.warnings, []);
  assert.equal(JSON.parse(migrated.directorSnapshot).version, 5);
  assert.equal(migrated.state.project.name, "雨夜花园");
  assert.equal(migrated.state.project.productionBibles.characterWardrobeProps, "黄色雨衣、红色背包。");
  assert.deepEqual(migrated.state.project.directorSettings, {
    language: "zh",
    mode: "T2V",
    totalDurationSeconds: 10,
    segmentDurationSeconds: 5,
    canvas: "16:9",
    resolution: "0.98",
    seed: "42",
    seedPolicy: "random_per_compile",
    sampling: "turbo_8",
    lastCompiledSnapshot: "literal-compiled-state"
  });
  assert.equal(migrated.state.entities.length, 0, "free text is not creatively classified into entities");
  assert.deepEqual(migrated.state.scenes[0].shots.map((shot) => shot.id), ["shot-legacy-001", "shot-legacy-002"]);
  assert.equal(migrated.state.scenes[0].shots[0].description, "镜头一原文");
  assert.equal(Object.isFrozen(migrated.state.scenes[0].shots), true);

  const invalid = migrateDirectorV5Draft({ version: 4 });
  assert.equal(invalid.state.scenes.length, 0);
  assert.equal(invalid.directorSnapshot, "");
  assert.equal(invalid.warnings.length, 1);
});

test("production data source remains local and has no generation or media-I/O surface", async () => {
  const source = await readFile(resolve(root, "src/renderer/director-production.ts"), "utf8");
  assert.doesNotMatch(source, /fetch\s*\(|XMLHttpRequest|WebSocket|node:fs|readFile|writeFile|\/prompt|queuePrompt|submitPrompt/u);
  assert.doesNotMatch(source, /generate(?:Video|Audio)|runComfy|autoQueue/u);
  assert.match(source, /localResultPath/u);
  assert.match(source, /productionSnapshot/u);
  assert.match(source, /directorSnapshot/u);
});
