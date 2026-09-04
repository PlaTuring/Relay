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

const productionModule = () => bundledModule("src/renderer/director-production.ts");
const controllerModule = () => bundledModule("src/renderer/director-p1-controller.ts");
const directorModule = () => bundledModule("src/renderer/director-console.ts");

function legacyProject(name = "旧版项目") {
  return {
    id: "project-legacy-001",
    name,
    productionBibles: {
      characterWardrobeProps: "黄色雨衣\r\n红色背包🙂",
      sceneWorld: "重庆屋顶\u0000保留",
      visualStyle: "真人电影感",
      unstructuredContinuity: "逐字保留\t连续性"
    },
    directorSettings: {
      language: "zh",
      mode: "T2V",
      totalDurationSeconds: 5,
      segmentDurationSeconds: 5,
      canvas: "16:9",
      resolution: "0.98",
      seed: "42",
      sampling: "quality_20",
      lastCompiledSnapshot: "literal-compiled\r\nbytes"
    },
    continuityDefaults: {
      characterAppearance: "同一张脸",
      wardrobe: "黄色雨衣",
      props: "红色背包",
      movementDirection: "向右",
      timeOfDay: "日出前",
      lighting: "阴天漫射光",
      sound: "雨声"
    }
  };
}

function legacyRevisionSnapshot() {
  return JSON.stringify({
    schemaVersion: 1,
    project: legacyProject("Revision 恢复副本"),
    entities: [{
      id: "entity-character-001",
      kind: "character",
      name: "快递员",
      notes: "恢复点角色",
      attributes: { wardrobe: "黄色雨衣" },
      archived: false
    }],
    scenes: [{
      id: "scene-rooftop-001",
      title: "屋顶",
      order: 0,
      notes: "恢复点场景",
      continuity: {},
      archived: false,
      shots: [{
        id: "shot-opening-001",
        startSeconds: 0,
        durationSeconds: 5,
        description: "Revision 中的原始镜头",
        cameraLanguage: "低机位",
        soundCue: "雨声",
        transitionNote: "",
        entityIds: ["entity-character-001"],
        continuity: {},
        archived: false
      }]
    }],
    takes: [],
    revisions: [],
    activeRevisionId: null
  }, null, 2);
}

function legacyV1State() {
  const revisionSnapshot = legacyRevisionSnapshot();
  return {
    schemaVersion: 1,
    project: legacyProject(),
    entities: [
      {
        id: "entity-character-001",
        kind: "character",
        name: "快递员👩🏽‍🚀",
        notes: "角色原文\r\n第二行",
        attributes: { wardrobe: "黄色雨衣", prop: "红色背包" },
        archived: false
      },
      {
        id: "entity-asset-001",
        kind: "asset",
        name: "旧参考图",
        notes: "不得猜测路径",
        attributes: { legacy: "原始属性🙂" },
        archived: false,
        legacyUnknown: { nested: ["保留", 7, true] }
      }
    ],
    scenes: [{
      id: "scene-rooftop-001",
      title: "屋顶",
      order: 0,
      notes: "场景原文\t保留",
      continuity: { lighting: { mode: "override", value: "暖光\r\n" } },
      archived: false,
      shots: [{
        id: "shot-opening-001",
        startSeconds: 0,
        durationSeconds: 5,
        description: "镜头原文\u0000END",
        cameraLanguage: "低机位",
        soundCue: "雨声",
        transitionNote: "硬切",
        entityIds: ["entity-character-001", "entity-asset-001"],
        continuity: { wardrobe: { mode: "inherit", value: "旧版恢复证据" } },
        archived: false
      }]
    }],
    takes: [{
      id: "take-candidate-001",
      name: "候选一",
      shotId: "shot-opening-001",
      revisionId: "revision-saved-001",
      localResultPath: "D:\\旧结果\\片段 🙂.mp4",
      notes: "人工备注\r\n逐字保留",
      rating: 4,
      status: "selected",
      createdAt: "2026-08-29T12:34:56.000Z"
    }],
    revisions: [{
      id: "revision-saved-001",
      parentRevisionId: null,
      createdAt: "2026-08-29T12:00:00.000Z",
      directorSnapshot: "{\r\n  \"literal\": \"逐字🙂\"\r\n}",
      productionSnapshot: revisionSnapshot
    }],
    activeRevisionId: "revision-saved-001"
  };
}

function simpleDraft({ mode = "T2V", shots, total = shots.reduce((sum, shot) => sum + shot.durationSeconds, 0) } = {}) {
  return {
    language: "zh",
    mode,
    totalDurationSeconds: total,
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
    styleOpening: ""
  };
}

test("explicit v6 schema-1 to v7 schema-2 migration preserves recoverable bytes and separates legacy assets", async () => {
  const production = await productionModule();
  const legacy = legacyV1State();
  const before = JSON.stringify(legacy);
  const migrated = production.migrateProductionStateV1ToV2(legacy);
  const repeated = production.migrateProductionStateV1ToV2(JSON.parse(before));

  assert.equal(JSON.stringify(legacy), before, "migration mutated the caller-owned v6 object");
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(production.canonicalProductionJson(migrated), production.canonicalProductionJson(repeated));
  assert.deepEqual(migrated.entities.map(({ id, kind }) => ({ id, kind })), [
    { id: "entity-character-001", kind: "character" }
  ]);
  assert.equal(migrated.entities[0].notes, "角色原文\r\n第二行");
  assert.equal(migrated.assets.length, 1);
  assert.equal(migrated.assets[0].sourceAssetId, "");
  assert.equal(migrated.assets[0].projectRelativePath, "");
  assert.equal(migrated.assets[0].missing, true, "migration must not invent file existence");
  assert.equal(migrated.assets[0].legacyEntityId, "entity-asset-001");
  assert.equal(migrated.legacyAssetEntities[0].sourceSnapshot, production.canonicalProductionJson(legacy.entities[1]));
  assert.equal(migrated.legacyAssetEntities[0].entity.attributes.legacy, "原始属性🙂");
  assert.deepEqual(migrated.scenes[0].shots[0].entityIds, ["entity-character-001"]);
  assert.equal(migrated.bindings.length, 1);
  assert.deepEqual(
    { targetKind: migrated.bindings[0].targetKind, targetId: migrated.bindings[0].targetId, assetId: migrated.bindings[0].assetId },
    { targetKind: "shot", targetId: "shot-opening-001", assetId: migrated.assets[0].id }
  );
  assert.equal(migrated.scenes[0].shots[0].continuity.wardrobe.value, "旧版恢复证据");
  assert.equal(migrated.scenes[0].continuity.lighting.value, "暖光\r\n");
  assert.equal(migrated.takes[0].localResultPath, "D:\\旧结果\\片段 🙂.mp4");
  assert.equal(migrated.takes[0].notes, "人工备注\r\n逐字保留");
  assert.equal(migrated.takes[0].revisionId, "revision-saved-001");
  assert.equal(migrated.revisions[0].directorSnapshot, legacy.revisions[0].directorSnapshot);
  assert.equal(migrated.revisions[0].productionSnapshot, legacy.revisions[0].productionSnapshot);
  assert.equal(migrated.activeRevisionId, "revision-saved-001");

  const restoredRevision = production.restoreProductionRevision(migrated, "revision-saved-001");
  assert.equal(restoredRevision.schemaVersion, 2);
  assert.equal(restoredRevision.project.name, "Revision 恢复副本");
  assert.equal(restoredRevision.scenes[0].shots[0].description, "Revision 中的原始镜头");
  assert.equal(restoredRevision.activeRevisionId, "revision-saved-001");
  assert.throws(() => production.migrateProductionStateV1ToV2(migrated), /schemaVersion 1/u);
});

test("v6 envelope restores read-only into v7 and a subsequent v7 round trip is canonical", async () => {
  const [production, controller] = await Promise.all([productionModule(), controllerModule()]);
  const legacy = legacyV1State();
  const draft = simpleDraft({ shots: [{
    id: "shot-opening-001",
    startSeconds: 0,
    durationSeconds: 5,
    description: "本次用户镜头"
  }] });
  const restoredV6 = controller.restoreDirectorPayload({
    version: 6,
    workflowName: "v6→v7",
    draft,
    productionState: legacy,
    lastCompiledShotFingerprints: { z: "z", a: "a" }
  });
  assert.equal(restoredV6.ok, true);
  assert.equal(restoredV6.sourceVersion, 6);
  assert.equal(restoredV6.state.schemaVersion, 2);
  assert.equal(restoredV6.mayWriteBack, false);
  assert.equal(restoredV6.warnings.length, 1);
  assert.equal(restoredV6.state.revisions[0].productionSnapshot, legacy.revisions[0].productionSnapshot);
  assert.equal(restoredV6.state.takes[0].localResultPath, legacy.takes[0].localResultPath);
  assert.equal(restoredV6.state.bindings[0].targetId, "shot-opening-001");

  const v7 = controller.buildDirectorV7Payload({
    workflowName: restoredV6.workflowName,
    draft: restoredV6.draft,
    state: restoredV6.state,
    lastCompiledShotFingerprints: restoredV6.lastCompiledShotFingerprints,
    passthrough: { customLiteral: "保留", version: 99 }
  });
  assert.equal(v7.version, 7);
  assert.equal(v7.productionState.schemaVersion, 2);
  assert.deepEqual(Object.keys(v7.lastCompiledShotFingerprints), ["a", "z"]);
  const restoredV7 = controller.restoreDirectorPayload(JSON.parse(JSON.stringify(v7)));
  assert.equal(restoredV7.ok, true);
  assert.equal(restoredV7.sourceVersion, 7);
  assert.equal(
    production.canonicalProductionJson(restoredV7.state),
    production.canonicalProductionJson(restoredV6.state)
  );
  assert.equal(controller.restoreDirectorPayload({ ...v7, version: 6 }).ok, false, "v6 must require schema 1");
});

test("Asset, Entity, Binding, Shot and asset-backed Take survive restart without absolute paths", async () => {
  const production = await productionModule();
  let state = production.createEmptyProductionState({ identityKey: "asset-binding" });
  state = production.upsertProductionEntity(state, { kind: "character", name: "女主", identityKey: "lead" });
  state = production.upsertProductionScene(state, { title: "屋顶", identityKey: "roof" });
  state = production.assignShotToScene(state, state.scenes[0].id, {
    identityKey: "shot",
    startSeconds: 0,
    durationSeconds: 5,
    entityIds: [state.entities[0].id]
  });
  const shotId = state.scenes[0].shots[0].id;
  const baseline = production.canonicalCompilationProductionSnapshot(state);
  state = production.upsertProductionAssetReference(state, {
    sourceAssetId: "asset-library-record-001",
    name: "女主参考图",
    mediaType: "image",
    projectRelativePath: "assets\\images\\lead.png",
    storageMode: "copy",
    sha256: "A".repeat(64),
    sizeBytes: 123,
    tags: ["角色", "角色", " 主角 "]
  });
  const assetId = state.assets[0].id;
  assert.equal(state.assets[0].projectRelativePath, "assets/images/lead.png");
  assert.equal(state.assets[0].sha256, "a".repeat(64));
  assert.deepEqual(state.assets[0].tags, ["角色", "主角"].sort((a, b) => a.localeCompare(b)));
  assert.equal(production.canonicalCompilationProductionSnapshot(state), baseline, "unbound assets do not affect compilation");
  assert.throws(() => production.upsertProductionAssetReference(state, {
    sourceAssetId: "absolute",
    name: "bad",
    mediaType: "image",
    projectRelativePath: "D:\\secret.png",
    storageMode: "reference"
  }), /project-relative/u);
  assert.throws(() => production.upsertProductionAssetReference(state, {
    sourceAssetId: "escape",
    name: "bad",
    mediaType: "image",
    projectRelativePath: "../secret.png",
    storageMode: "reference"
  }), /escape/u);

  state = production.upsertProductionBinding(state, {
    targetKind: "shot",
    targetId: shotId,
    assetId,
    role: "reference-image",
    identityKey: "shot-reference"
  });
  const bindingId = state.bindings[0].id;
  assert.notEqual(production.canonicalCompilationProductionSnapshot(state), baseline);
  assert.equal(production.productionBindingsForTarget(state, "shot", shotId)[0].assetId, assetId);
  state = production.addProductionTake(state, {
    shotId,
    assetId,
    name: "候选成片",
    status: "selected"
  });
  assert.equal(state.takes[0].localResultPath, "");
  const restarted = production.normalizeProductionState(JSON.parse(JSON.stringify(state)));
  assert.equal(restarted.assets[0].id, assetId);
  assert.equal(restarted.assets[0].sourceAssetId, "asset-library-record-001");
  assert.equal(restarted.bindings[0].id, bindingId);
  assert.equal(restarted.takes[0].assetId, assetId);

  state = production.archiveProductionBinding(restarted, bindingId);
  assert.deepEqual(production.productionBindingsForTarget(state, "shot", shotId), []);
  state = production.upsertProductionBinding(state, {
    id: bindingId,
    targetKind: "shot",
    targetId: shotId,
    assetId,
    role: "reference-image",
    archived: false
  });
  state = production.archiveProductionAssetReference(state, assetId);
  assert.equal(state.assets[0].archived, true);
  assert.equal(state.bindings[0].archived, true);
  assert.equal(state.takes[0].status, "archived");
});

test("expanded continuity is deterministic, restorable, and conflicts locate shot plus dimension", async () => {
  const production = await productionModule();
  assert.deepEqual(production.CONTINUITY_DIMENSIONS, [
    "characterAppearance", "wardrobe", "props", "movementDirection", "scene",
    "weather", "timeOfDay", "lighting", "visualStyle", "sound"
  ]);
  let state = production.createEmptyProductionState({ identityKey: "continuity-v7" });
  state = production.upsertProductionScene(state, { title: "屋顶", identityKey: "roof" });
  const sceneId = state.scenes[0].id;
  state = production.assignShotToScene(state, sceneId, { identityKey: "one", startSeconds: 0, durationSeconds: 5 });
  state = production.assignShotToScene(state, sceneId, { identityKey: "two", startSeconds: 5, durationSeconds: 5 });
  const [shotOne, shotTwo] = state.scenes[0].shots.map((shot) => shot.id);
  state = production.setProjectContinuityDefault(state, "weather", "细雨");
  state = production.setProjectContinuityDefault(state, "scene", "屋顶温室");
  state = production.setSceneContinuity(state, sceneId, "visualStyle", { mode: "override", value: "" });
  state = production.setShotContinuity(state, shotOne, "weather", { mode: "override", value: "" });
  state = production.setShotContinuity(state, shotTwo, "visualStyle", { mode: "override", value: "电影感" });
  assert.deepEqual(production.validateProductionContinuity(state).map(({ shotId, dimension }) => ({ shotId, dimension })), [
    { shotId: shotOne, dimension: "weather" },
    { shotId: shotOne, dimension: "visualStyle" }
  ]);
  state = production.unsetShotContinuity(state, shotOne, "weather");
  assert.deepEqual(production.resolveShotContinuity(state, shotOne).find((cell) => cell.dimension === "weather"), {
    dimension: "weather",
    value: "细雨",
    source: "project",
    inherited: true
  });
  state = production.setShotContinuity(state, shotOne, "sound", { mode: "override", value: "雨声" });
  state = production.setShotContinuity(state, shotOne, "sound", { mode: "inherit", value: "must-clear-on-new-edit" });
  assert.deepEqual(state.scenes[0].shots[0].continuity.sound, { mode: "inherit", value: "" });
  state = production.unsetShotContinuity(state, shotOne, "sound");
  assert.equal(state.scenes[0].shots[0].continuity.sound, undefined);
});

test("mixed 5/10/15-second shots drive total duration, prompt validation, fingerprints and Ref2VA boundary", async () => {
  const [production, controller, director] = await Promise.all([
    productionModule(), controllerModule(), directorModule()
  ]);
  let state = production.createEmptyProductionState({ identityKey: "mixed-duration" });
  state = production.upsertProductionScene(state, { title: "默认场景", identityKey: "scene" });
  const sceneId = state.scenes[0].id;
  state = production.assignShotToScene(state, sceneId, { identityKey: "one", startSeconds: 0, durationSeconds: 5 });
  state = production.assignShotToScene(state, sceneId, { identityKey: "two", startSeconds: 5, durationSeconds: 5 });
  state = production.assignShotToScene(state, sceneId, { identityKey: "three", startSeconds: 10, durationSeconds: 5 });
  const ids = state.scenes[0].shots.map((shot) => shot.id);
  state = production.setProductionShotDuration(state, ids[1], 10);
  state = production.setProductionShotDuration(state, ids[2], 15);
  const active = state.scenes[0].shots.filter((shot) => !shot.archived);
  assert.deepEqual(active.map(({ startSeconds, durationSeconds }) => ({ startSeconds, durationSeconds })), [
    { startSeconds: 0, durationSeconds: 5 },
    { startSeconds: 5, durationSeconds: 10 },
    { startSeconds: 15, durationSeconds: 15 }
  ]);
  assert.equal(production.directorTimelineDuration(state), 30);
  assert.equal(state.project.directorSettings.totalDurationSeconds, 30);
  assert.throws(() => production.setProductionShotDuration(state, ids[0], 7), /5, 10, or 15/u);

  const draft = simpleDraft({ shots: active.map((shot, index) => ({
    id: shot.id,
    startSeconds: shot.startSeconds,
    durationSeconds: shot.durationSeconds,
    description: `镜头 ${index + 1}`
  })) });
  const prompt = director.serializeDirectorPrompt(draft);
  assert.deepEqual(prompt.errors, []);
  const synced = controller.syncDirectorProductionState({ state, workflowName: "混合镜头", draft });
  assert.equal(synced.state.project.directorSettings.totalDurationSeconds, 30);
  const beforeFingerprint = director.directorShotFingerprint(draft, draft.shots[1]);
  const changed = { ...draft, totalDurationSeconds: 35, shots: draft.shots.map((shot, index) => index === 1
    ? { ...shot, durationSeconds: 15 }
    : index === 2 ? { ...shot, startSeconds: 20 } : shot) };
  assert.notEqual(director.directorShotFingerprint(changed, changed.shots[1]), beforeFingerprint);
  assert.deepEqual(director.serializeDirectorPrompt(changed).errors, []);
  assert.equal(director.directorSegmentPlan(30, 10).length, 3, "quick-plan remains uniform");
  assert.deepEqual(director.directorSegmentPlan(22, 15), [], "quick-plan rejects unsupported remainder");

  const gapped = { ...draft, shots: draft.shots.map((shot, index) => index === 1 ? { ...shot, startSeconds: 10 } : shot) };
  assert.match(director.serializeDirectorPrompt(gapped).errors.join("\n"), /按顺序连续/u);
  assert.throws(() => controller.syncDirectorProductionState({ state, workflowName: "gap", draft: gapped }), /contiguous/u);
  const refLong = { ...draft, mode: "REF2VA" };
  assert.throws(() => controller.syncDirectorProductionState({ state, workflowName: "Ref", draft: refLong }), /exactly one/u);
  const refSingle = simpleDraft({ mode: "REF2VA", shots: [{ startSeconds: 0, durationSeconds: 15, description: "<主体 1> 保持一致" }] });
  assert.doesNotThrow(() => controller.syncDirectorProductionState({
    state: production.createEmptyProductionState({ identityKey: "ref-single" }),
    workflowName: "Ref 单镜头",
    draft: refSingle
  }));
});

test("Alpha 27 data layer remains pure local orchestration with no generation, queue, filesystem, or network surface", async () => {
  const sources = (await Promise.all([
    readFile(resolve(root, "src/renderer/director-production.ts"), "utf8"),
    readFile(resolve(root, "src/renderer/director-console.ts"), "utf8"),
    readFile(resolve(root, "src/renderer/director-p1-controller.ts"), "utf8")
  ])).join("\n");
  assert.doesNotMatch(sources, /fetch\s*\(|XMLHttpRequest|WebSocket|node:fs|readFile|writeFile|\/prompt|queuePrompt|submitPrompt|generate(?:Video|Audio)|runComfy|autoQueue/iu);
});
