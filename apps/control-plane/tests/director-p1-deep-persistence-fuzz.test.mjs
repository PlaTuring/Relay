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

let controllerPromise;
let productionPromise;
let directorPromise;
let uiPromise;
const controllerModule = () => controllerPromise ??= bundledModule("src/renderer/director-p1-controller.ts");
const productionModule = () => productionPromise ??= bundledModule("src/renderer/director-production.ts");
const directorModule = () => directorPromise ??= bundledModule("src/renderer/director-console.ts");
const uiModule = () => uiPromise ??= bundledModule("src/renderer/director-p1-ui.ts");

function makeShots(totalDurationSeconds, segmentDurationSeconds, prefix) {
  const shots = [];
  for (let start = 0, index = 0; start < totalDurationSeconds; start += segmentDurationSeconds, index += 1) {
    shots.push({
      startSeconds: start,
      durationSeconds: Math.min(segmentDurationSeconds, totalDurationSeconds - start),
      description: `${prefix}${index + 1}`,
      cameraLanguage: `镜头语言-${index + 1}`,
      soundCue: `声音-${index + 1}`,
      transitionNote: index === 0 ? "" : `转场-${index + 1}`
    });
  }
  return shots;
}

function makeDraft({
  mode = "T2V",
  language = "zh",
  total = 30,
  segment = 5,
  shots = makeShots(total, segment, "用户原文-"),
  text = ""
} = {}) {
  return {
    language,
    mode,
    totalDurationSeconds: total,
    segmentDurationSeconds: segment,
    characterBible: `角色全局参考${text}`,
    worldBible: `场景全局参考${text}`,
    visualStyleBible: `视觉全局参考${text}`,
    continuity: `非结构连续性原文${text}`,
    shots,
    overallSoundscape: `整体声景${text}`,
    nonDiegeticMusic: `画外配乐${text}`,
    subjectDefinitions: "",
    summary: "",
    retentionAnalysis: "",
    styleOpening: ""
  };
}

function activeShots(state) {
  return state.scenes
    .filter((scene) => !scene.archived)
    .flatMap((scene) => scene.shots.filter((shot) => !shot.archived))
    .sort((left, right) => left.startSeconds - right.startSeconds
      || left.durationSeconds - right.durationSeconds
      || left.id.localeCompare(right.id));
}

function assertSameBytes(left, right, message) {
  assert.equal(Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")), 0, message);
}

async function assertRoundTripCompilationBytes({ controller, director, workflowName, draft, state }) {
  const before = controller.captureDirectorP1Submission({ state, workflowName, draft });
  const beforePrompt = director.serializeDirectorPrompt(before.effectiveDraft);
  const payload = controller.buildDirectorV6Payload({
    workflowName,
    draft: before.draft,
    state,
    lastCompiledShotFingerprints: before.effectiveFingerprints,
    passthrough: {
      canvas: state.project.directorSettings.canvas,
      resolution: state.project.directorSettings.resolution,
      seed: state.project.directorSettings.seed,
      sampling: state.project.directorSettings.sampling
    }
  });
  const persistedBytes = JSON.stringify(payload);
  const restored = controller.restoreDirectorPayload(JSON.parse(persistedBytes));
  assert.equal(restored.ok, true);
  const after = controller.captureDirectorP1Submission({
    state: restored.state,
    workflowName: restored.workflowName,
    draft: restored.draft
  });
  const afterPrompt = director.serializeDirectorPrompt(after.effectiveDraft);
  assert.deepEqual(afterPrompt.errors, beforePrompt.errors);
  assertSameBytes(afterPrompt.prompt, beforePrompt.prompt, "compiler-facing prompt bytes changed after v7 restore");
  assertSameBytes(after.directorSnapshot, before.directorSnapshot, "captured Director submission bytes changed after v7 restore");
  assert.deepEqual(after.effectiveFingerprints, before.effectiveFingerprints);
  return { before, beforePrompt, payload, restored, persistedBytes };
}

test("a complete P1 production work copy survives v7 persistence with byte-identical compiler input", async () => {
  const [controller, production, director, ui] = await Promise.all([
    controllerModule(),
    productionModule(),
    directorModule(),
    uiModule()
  ]);
  const draft = makeDraft({ text: "｜中文🙂\r\n第二行" });
  let synced = controller.syncDirectorProductionState({
    state: production.createEmptyProductionState({ identityKey: "deep-round-trip" }),
    workflowName: "深度持久化🎬",
    draft,
    output: { canvas: "16:9", resolution: "0.98", seed: "922337", sampling: "quality_20" }
  });
  let state = production.upsertProductionEntity(synced.state, {
    identityKey: "lead",
    kind: "character",
    name: "女主角👩🏽‍🚀",
    notes: "透明雨衣\r\n保留原始换行",
    attributes: { "服装": "黄色", "道具": "纸鹤🕊️", "": "也应稳定保存" }
  });
  state = production.upsertProductionEntity(state, {
    identityKey: "prop",
    kind: "prop",
    name: "纸鹤",
    notes: "未引用实体不能污染编译输入"
  });

  const knownSceneIds = new Set(state.scenes.map((scene) => scene.id));
  state = production.upsertProductionScene(state, {
    identityKey: "same-title-a",
    title: "同名场景",
    order: 1,
    notes: "场景 A 原文"
  });
  const sceneA = state.scenes.find((scene) => !knownSceneIds.has(scene.id));
  assert.ok(sceneA);
  const afterSceneAIds = new Set(state.scenes.map((scene) => scene.id));
  state = production.upsertProductionScene(state, {
    identityKey: "same-title-b",
    title: "同名场景",
    order: 2,
    notes: "场景 B 原文"
  });
  const sceneB = state.scenes.find((scene) => !afterSceneAIds.has(scene.id));
  assert.ok(sceneB);
  assert.notEqual(sceneA.id, sceneB.id);

  const shotIds = synced.draft.shots.map((shot) => shot.id);
  assert.equal(shotIds.every(Boolean), true);
  state = ui.replaceSceneMembership(state, sceneA.id, [shotIds[0], shotIds[2]]);
  state = ui.replaceSceneMembership(state, sceneA.id, [shotIds[2]]);
  assert.deepEqual(state.scenes.find((scene) => scene.id === sceneA.id).shots.filter((shot) => !shot.archived).map((shot) => shot.id), [shotIds[2]]);
  state = ui.replaceSceneMembership(state, sceneA.id, []);
  assert.deepEqual(state.scenes.find((scene) => scene.id === sceneA.id).shots.filter((shot) => !shot.archived), []);
  state = ui.replaceSceneMembership(state, sceneA.id, [shotIds[0], shotIds[2]]);
  state = production.assignShotToScene(state, sceneA.id, {
    id: shotIds[0],
    startSeconds: 0,
    durationSeconds: 5,
    entityIds: [state.entities[0].id]
  });
  state = production.setProjectContinuityDefault(state, "lighting", "项目默认灯光");
  state = production.setProjectContinuityDefault(state, "sound", "项目默认声音");
  state = production.setSceneContinuity(state, sceneA.id, "lighting", { mode: "override", value: "场景 A 灯光" });
  state = production.setShotContinuity(state, shotIds[0], "lighting", { mode: "inherit", value: "必须被清空" });
  state = production.setShotContinuity(state, shotIds[0], "sound", { mode: "override", value: "" });

  const captured = controller.captureDirectorP1Submission({
    state,
    workflowName: "深度持久化🎬",
    draft: synced.draft
  });
  const committed = controller.commitDirectorP1Compilation({
    currentState: state,
    submission: captured,
    succeeded: true,
    createdAt: "2026-08-29T12:34:56.000Z"
  });
  assert.ok(committed.revision);
  state = production.addProductionTake(committed.state, {
    identityKey: "take-unicode",
    name: "候选片段🎞️",
    shotId: shotIds[0],
    revisionId: committed.revision.id,
    localResultPath: "D:\\Relay 结果\\含空格\\片段🎬.mp4",
    notes: "人工审核：保留",
    rating: 5,
    status: "selected",
    createdAt: "2026-08-29T12:35:00.000Z"
  });

  const result = await assertRoundTripCompilationBytes({
    controller,
    director,
    workflowName: "深度持久化🎬",
    draft: synced.draft,
    state
  });
  assert.deepEqual(result.beforePrompt.errors, []);
  assert.equal(result.restored.state.entities.length, 2);
  assert.equal(result.restored.state.scenes.filter((scene) => scene.title === "同名场景").length, 2);
  assert.equal(new Set(result.restored.state.scenes.filter((scene) => scene.title === "同名场景").map((scene) => scene.id)).size, 2);
  assert.deepEqual(
    result.restored.state.scenes.find((scene) => scene.id === sceneA.id).shots.filter((shot) => !shot.archived).map((shot) => shot.id),
    [shotIds[0], shotIds[2]]
  );
  assert.equal(result.restored.draft.overallSoundscape, draft.overallSoundscape);
  assert.equal(result.restored.draft.nonDiegeticMusic, draft.nonDiegeticMusic);
  assert.equal(result.restored.state.revisions.length, 1);
  assert.equal(result.restored.state.takes.length, 1);
  assert.equal(result.restored.state.takes[0].revisionId, committed.revision.id);
  assert.equal(result.restored.state.takes[0].localResultPath, "D:\\Relay 结果\\含空格\\片段🎬.mp4");
  const continuity = production.resolveShotContinuity(result.restored.state, shotIds[0]);
  assert.deepEqual(continuity.find((cell) => cell.dimension === "lighting"), {
    dimension: "lighting",
    value: "场景 A 灯光",
    source: "scene",
    inherited: true
  });
  assert.deepEqual(continuity.find((cell) => cell.dimension === "sound"), {
    dimension: "sound",
    value: "",
    source: "shot",
    inherited: false
  });
});

test("30↔60 and T2V↔FL2VA↔Ref2VA transitions retain stable production records and deterministic bytes", async () => {
  const [controller, production, director] = await Promise.all([
    controllerModule(),
    productionModule(),
    directorModule()
  ]);
  let state = production.createEmptyProductionState({ identityKey: "mode-duration-cycle" });
  let firstSixIds = [];
  let allTwelveIds = [];
  let linkedRevisionId = null;
  let linkedTakeId = null;
  const stages = [
    { mode: "T2V", total: 30, prefix: "文字-" },
    { mode: "T2V", total: 60, prefix: "文字扩展-" },
    { mode: "FL2VA", total: 60, prefix: "首尾帧-" },
    { mode: "REF2VA", total: 5, prefix: "参考-" },
    { mode: "T2V", total: 30, prefix: "文字恢复-" },
    { mode: "T2V", total: 60, prefix: "文字再扩展-" }
  ];

  for (const [stageIndex, stage] of stages.entries()) {
    const draft = stage.mode === "REF2VA"
      ? makeDraft({
          mode: "REF2VA",
          total: 5,
          segment: 5,
          shots: [{ startSeconds: 0, durationSeconds: 5, description: "<主体 1> 保持 <图片 1> 的身份与服装。" }]
        })
      : makeDraft({
          mode: stage.mode,
          total: stage.total,
          segment: 5,
          shots: makeShots(stage.total, 5, stage.prefix)
        });
    if (stage.mode === "REF2VA") {
      draft.subjectDefinitions = "<主体 1> 由 <图片 1> 定义。";
      draft.summary = "[reference generation] 保持 <主体 1> 一致。";
      draft.retentionAnalysis = "<主体 1>: fully_preserved - 保留身份与服装。";
      draft.styleOpening = "真人实拍、电影感。";
    }
    const synced = controller.syncDirectorProductionState({
      state,
      workflowName: "模式时长循环",
      draft
    });
    state = synced.state;
    if (stageIndex === 0) {
      firstSixIds = synced.draft.shots.map((shot) => shot.id);
      const submission = controller.captureDirectorP1Submission({ state, workflowName: "模式时长循环", draft: synced.draft });
      const committed = controller.commitDirectorP1Compilation({
        currentState: state,
        submission,
        succeeded: true,
        createdAt: "2026-08-29T00:00:00.000Z"
      });
      state = committed.state;
      linkedRevisionId = committed.revision.id;
      state = production.addProductionTake(state, {
        identityKey: "persistent-take",
        name: "跨模式保留",
        shotId: firstSixIds[0],
        revisionId: linkedRevisionId,
        localResultPath: "D:\\RelayResults\\persistent.mp4"
      });
      linkedTakeId = state.takes[0].id;
    }
    if (stageIndex === 1) {
      allTwelveIds = synced.draft.shots.map((shot) => shot.id);
      assert.deepEqual(allTwelveIds.slice(0, 6), firstSixIds);
    }
    if (stageIndex === 2) assert.deepEqual(synced.draft.shots.map((shot) => shot.id), allTwelveIds);
    if (stageIndex === 3) assert.equal(synced.draft.shots[0].id, firstSixIds[0]);
    if (stageIndex === 4) assert.deepEqual(synced.draft.shots.map((shot) => shot.id), firstSixIds);
    if (stageIndex === 5) assert.deepEqual(synced.draft.shots.map((shot) => shot.id), allTwelveIds);

    const roundTrip = await assertRoundTripCompilationBytes({
      controller,
      director,
      workflowName: "模式时长循环",
      draft: synced.draft,
      state
    });
    assert.deepEqual(roundTrip.beforePrompt.errors, []);
    state = roundTrip.restored.state;
    assert.equal(state.revisions.some((revision) => revision.id === linkedRevisionId), true);
    assert.equal(state.takes.some((take) => take.id === linkedTakeId && take.revisionId === linkedRevisionId), true);
    assert.equal(activeShots(state).length, stage.total / 5);
  }
});

test("legacy v2-v5 project payload restoration stays literal without attaching an unscoped browser draft", async () => {
  const [renderer, controller, production, director] = await Promise.all([
    read("src/renderer/index.ts"),
    controllerModule(),
    productionModule(),
    directorModule()
  ]);
  const start = renderer.indexOf("function restoreDirectorDraft");
  const end = renderer.indexOf("function validateDirectorForCompilation", start);
  assert.ok(start >= 0 && end > start);
  const restoreSource = renderer.slice(start, end);
  const saveStart = renderer.indexOf("async function saveDirectorDraft");
  const saveEnd = renderer.indexOf("function captureDirectorCompilation", saveStart);
  const persistStart = renderer.indexOf("async function persistRelayProject");
  const persistEnd = renderer.indexOf("function scheduleQuickProjectSave", persistStart);
  assert.ok(saveStart >= 0 && saveEnd > saveStart);
  assert.ok(persistStart >= 0 && persistEnd > persistStart);
  const saveSource = renderer.slice(saveStart, saveEnd);
  const persistSource = renderer.slice(persistStart, persistEnd);
  assert.match(restoreSource, /payload\.version !== 1 && payload\.version !== 2 && payload\.version !== 3 && payload\.version !== 4/u);
  assert.match(restoreSource, /payload\.version === 2 \|\| payload\.version === 3 \|\| payload\.version === 4/u);
  assert.match(restoreSource, /normalizedDirectorStoredKey\(candidate\.key\)/u);
  assert.match(restoreSource, /payload\.version === 3 \|\| payload\.version === 4/u);
  assert.match(restoreSource, /restoreDirectorShotId\(normalizedKey,\s*candidate\.id,\s*usedShotIds\)/u);
  assert.doesNotMatch(restoreSource, /localStorage|legacyStored|DIRECTOR_DRAFT_STORAGE_KEY/u);
  assert.match(saveSource, /if \(activeRelayProject === null \|\| context === null\) throw new Error/u);
  assert.match(saveSource, /requireCurrentProjectOperation\(context\)[\s\S]*await persistRelayProject\(nextProject\)[\s\S]*requireCurrentProjectOperation\(context\)/u);
  assert.match(saveSource, /preservedLegacyDirectorState: jsonPayload/u);
  assert.match(saveSource, /await persistRelayProject\(nextProject\)/u);
  assert.doesNotMatch(saveSource, /localStorage|DIRECTOR_DRAFT_STORAGE_KEY/u);
  assert.match(persistSource, /expectedUpdatedAt: persistedProjectUpdatedAtById\.get\(projectId\) \?\? project\.updatedAt/u);
  assert.match(persistSource, /activeRelayProject\?\.projectId === projectId/u);
  assert.doesNotMatch(persistSource, /localStorage/u);

  const legacyDraft = makeDraft({
    total: 10,
    shots: [
      { id: "shot-legacy-001", startSeconds: 0, durationSeconds: 5, description: "旧镜头一🙂" },
      { id: "shot-legacy-002", startSeconds: 5, durationSeconds: 5, description: "旧镜头二\r\n第二行" }
    ],
    text: "旧数据"
  });
  const v5 = {
    version: 5,
    workflowName: "v5→v7",
    draft: legacyDraft,
    canvas: "3:2",
    resolution: "0.4",
    seed: "77",
    sampling: "quality_20"
  };
  const migrated = controller.restoreDirectorPayload(JSON.parse(JSON.stringify(v5)));
  assert.equal(migrated.ok, true);
  assert.equal(migrated.sourceVersion, 5);
  assert.equal(migrated.mayWriteBack, false);
  assert.deepEqual(migrated.draft.shots.map((shot) => shot.id), ["shot-legacy-001", "shot-legacy-002"]);
  const roundTrip = await assertRoundTripCompilationBytes({
    controller,
    director,
    workflowName: migrated.workflowName,
    draft: migrated.draft,
    state: migrated.state
  });
  assert.equal(roundTrip.restored.sourceVersion, 7);
  assert.equal(roundTrip.restored.mayWriteBack, false);
  assert.equal(production.canonicalProductionJson(roundTrip.restored.state), production.canonicalProductionJson(migrated.state));
});

test("deterministic fuzz corpus preserves Chinese, Emoji, whitespace, controls, and long boundaries", async () => {
  const [controller, production, director] = await Promise.all([
    controllerModule(),
    productionModule(),
    directorModule()
  ]);
  const corpus = [
    "",
    "   \t\r\n  ",
    "异常中文：重庆雨夜；引号‘’“”与斜杠\\/以及空字符\u0000结束",
    "👩🏽‍🚀🐉🕊️🎬 家庭成员：👨‍👩‍👧‍👦",
    "双向文本\u202Eabc\u202C恢复；零宽\u200B字符；连接符\u200D",
    "组合音 e\u0301 与预组字符 é；全角 ＡＢＣ１２３",
    "孤立代理项：\ud800 / \udfff",
    `${"超长边界🙂中文".repeat(8_192)}END`
  ];
  let random = 0x5eed1234;
  const alphabet = ["中", "文", " ", "\n", "\t", "🙂", "Ω", "é", "\\", "\u200B", "A", "9"];
  for (let caseIndex = 0; caseIndex < 32; caseIndex += 1) {
    let value = "";
    const length = (caseIndex * 37) % 513;
    for (let index = 0; index < length; index += 1) {
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      value += alphabet[random % alphabet.length];
    }
    corpus.push(value);
  }

  for (const [caseIndex, value] of corpus.entries()) {
    const draft = makeDraft({
      total: 5,
      segment: 5,
      shots: [{
        startSeconds: 0,
        durationSeconds: 5,
        description: value,
        cameraLanguage: value,
        soundCue: value,
        transitionNote: value
      }],
      text: value
    });
    const synced = controller.syncDirectorProductionState({
      state: production.createEmptyProductionState({ identityKey: `fuzz-${caseIndex}` }),
      workflowName: `模糊测试-${caseIndex}`,
      draft
    });
    const roundTrip = await assertRoundTripCompilationBytes({
      controller,
      director,
      workflowName: `模糊测试-${caseIndex}`,
      draft: synced.draft,
      state: synced.state
    });
    assert.equal(roundTrip.restored.draft.shots[0].description, value, `description changed in fuzz case ${caseIndex}`);
    assert.equal(roundTrip.restored.draft.shots[0].cameraLanguage, value, `camera lane changed in fuzz case ${caseIndex}`);
    assert.equal(roundTrip.restored.draft.overallSoundscape, `整体声景${value}`);
    assert.equal(roundTrip.restored.draft.nonDiegeticMusic, `画外配乐${value}`);
    assert.equal(JSON.stringify(JSON.parse(roundTrip.persistedBytes)), roundTrip.persistedBytes);
  }
});

test("deep P1 persistence surfaces remain local and expose no generation or queue path", async () => {
  const sources = (await Promise.all([
    read("src/renderer/director-production.ts"),
    read("src/renderer/director-p1-controller.ts"),
    read("src/renderer/director-p1-ui.ts")
  ])).join("\n");
  assert.doesNotMatch(
    sources,
    /\/prompt|queuePrompt|submitPrompt|requestSubmit\s*\(|fetch\s*\(|XMLHttpRequest|WebSocket|child_process|node:fs|generate(?:Video|Audio)|runComfy|autoQueue/iu
  );
});
