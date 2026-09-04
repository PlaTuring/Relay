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

const directorModule = () => bundledModule("src/renderer/professional-director.ts");
const domainModule = () => bundledModule("src/shared/project-domain.ts");

async function quickProject(patch = {}) {
  const { createEmptyRelayProject, normalizeRelayProject } = await domainModule();
  const base = createEmptyRelayProject({
    projectId: "project-alpha28-test",
    name: "雨夜项目 🐟",
    createdAt: "2026-08-30T00:00:00.000Z"
  });
  return normalizeRelayProject({
    ...base,
    quick: {
      ...base.quick,
      workflowName: "雨夜工作流 01",
      originalPrompt: "一名快递员追随发光纸鹤。",
      totalDurationSeconds: 30,
      segmentDurationSeconds: 5,
      ...patch
    }
  });
}

test("quick promotion preserves Quick data while Director shots start with independent prompts", async () => {
  const { promoteQuickProjectToProfessional, directorTotalDuration, orderedDirectorShots } = await directorModule();
  const project = await quickProject({
    originalPrompt: "中文 + English + Emoji 🐟\n原样保留。",
    canvasAspectRatio: "9:16",
    resolutionMegapixels: "0.98",
    seed: "42",
    sampling: "turbo_8"
  });
  const originalQuick = structuredClone(project.quick);
  const promoted = promoteQuickProjectToProfessional({
    project,
    updatedAt: "2026-08-30T00:00:01.000Z"
  });
  assert.equal(promoted.editorMode, "professional");
  assert.deepEqual(promoted.quick, originalQuick);
  assert.deepEqual(promoted.professional.promotedQuickState, originalQuick);
  assert.equal(promoted.scenes.length, 1);
  assert.equal(promoted.scenes[0].shotIds.length, 6);
  assert.equal(promoted.shots.length, 6);
  assert.equal(new Set(promoted.shots.map((shot) => shot.shotId)).size, 6);
  assert.equal(directorTotalDuration(promoted), 30);
  assert.deepEqual(orderedDirectorShots(promoted).map(({ shot }) => shot.durationSeconds), [5, 5, 5, 5, 5, 5]);
  assert.ok(promoted.shots.every((shot) => shot.prompt === ""));
  assert.equal(promoted.shots[0].transitionFromPrevious, null);
  assert.ok(promoted.shots.slice(1).every((shot) => shot.transitionFromPrevious.type === "tail_frame_continuation"));
  assert.equal(JSON.stringify(promoted).includes("absolute"), false);
});

test("Ref2VA promotion stays inside the certified single-shot 5–15 second boundary", async () => {
  const { promoteQuickProjectToProfessional } = await directorModule();
  await assert.rejects(
    () => quickProject({ mode: "REF2VA", totalDurationSeconds: 30, segmentDurationSeconds: 5 }),
    /Ref2VA.*5, 10, or 15/iu
  );
  const valid = await quickProject({ mode: "REF2VA", totalDurationSeconds: 15, segmentDurationSeconds: 15 });
  const promoted = promoteQuickProjectToProfessional({
    project: valid,
    updatedAt: "2026-08-30T00:00:01.000Z"
  });
  assert.equal(promoted.shots.length, 1);
  assert.equal(promoted.shots[0].durationSeconds, 15);
});

test("shot copy, cross-scene move, ordering, and batch 5/10/15 durations are deterministic", async () => {
  const {
    addDirectorScene,
    directorTotalDuration,
    duplicateDirectorShot,
    moveDirectorShot,
    orderedDirectorShots,
    promoteQuickProjectToProfessional,
    setDirectorShotDurations
  } = await directorModule();
  let project = promoteQuickProjectToProfessional({
    project: await quickProject({ totalDurationSeconds: 15 }),
    updatedAt: "2026-08-30T00:00:01.000Z"
  });
  const sourceId = project.shots[0].shotId;
  project = duplicateDirectorShot(project, {
    shotId: sourceId,
    duplicateShotId: "shot-alpha28-duplicate",
    updatedAt: "2026-08-30T00:00:02.000Z"
  });
  assert.equal(project.shots.find((shot) => shot.shotId === "shot-alpha28-duplicate").prompt, "");
  project = addDirectorScene(project, {
    sceneId: "scene-alpha28-second",
    name: "第二场",
    updatedAt: "2026-08-30T00:00:03.000Z"
  });
  project = moveDirectorShot(project, {
    shotId: "shot-alpha28-duplicate",
    targetSceneId: "scene-alpha28-second",
    targetIndex: 0,
    updatedAt: "2026-08-30T00:00:04.000Z"
  });
  assert.deepEqual(project.scenes.find((scene) => scene.sceneId === "scene-alpha28-second").shotIds, ["shot-alpha28-duplicate"]);
  assert.equal(orderedDirectorShots(project)[0].shot.transitionFromPrevious, null);
  assert.ok(orderedDirectorShots(project).slice(1).every(({ shot }) => shot.transitionFromPrevious !== null));
  const firstTwo = orderedDirectorShots(project).slice(0, 2).map(({ shot }) => shot.shotId);
  project = setDirectorShotDurations(project, {
    shotIds: firstTwo,
    durationSeconds: 10,
    updatedAt: "2026-08-30T00:00:05.000Z"
  });
  assert.deepEqual(orderedDirectorShots(project).slice(0, 2).map(({ shot }) => shot.durationSeconds), [10, 10]);
  assert.equal(directorTotalDuration(project), 30);
  assert.throws(() => setDirectorShotDurations(project, {
    shotIds: firstTwo,
    durationSeconds: 7,
    updatedAt: "2026-08-30T00:00:06.000Z"
  }), /5, 10, or 15/u);
});

test("start/end states inherit mechanically, support override/restore/lock, and locate conflicts", async () => {
  const {
    promoteQuickProjectToProfessional,
    resolveDirectorShotStates,
    restoreDirectorStateInheritance,
    setDirectorStateLock,
    setDirectorStateOverride,
    setProjectContinuityDefault,
    validateDirectorContinuity
  } = await directorModule();
  let project = promoteQuickProjectToProfessional({
    project: await quickProject({ totalDurationSeconds: 10 }),
    updatedAt: "2026-08-30T00:00:01.000Z"
  });
  const [firstId, secondId] = project.shots.map((shot) => shot.shotId);
  project = setProjectContinuityDefault(project, {
    field: "wardrobeAppearance",
    value: "黄色雨衣",
    updatedAt: "2026-08-30T00:00:02.000Z"
  });
  project = setDirectorStateOverride(project, {
    shotId: firstId,
    phase: "end",
    field: "heldProps",
    value: "发光纸鹤",
    updatedAt: "2026-08-30T00:00:03.000Z"
  });
  let states = resolveDirectorShotStates(project);
  assert.equal(states[0].start.wardrobeAppearance.value, "黄色雨衣");
  assert.equal(states[1].start.heldProps.value, "发光纸鹤");
  assert.equal(states[1].start.heldProps.source, "previous_shot_end");
  assert.equal(states[1].start.heldProps.sourceShotId, firstId);

  project = setDirectorStateOverride(project, {
    shotId: secondId,
    phase: "start",
    field: "heldProps",
    value: "空手",
    updatedAt: "2026-08-30T00:00:04.000Z"
  });
  let issues = validateDirectorContinuity(project);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, "tail_continuation_mismatch");
  assert.equal(issues[0].shotId, secondId);
  assert.equal(issues[0].field, "heldProps");
  assert.equal(issues[0].locator, `shot:${secondId}:startState:heldProps`);

  project = setDirectorStateLock(project, {
    shotId: secondId,
    phase: "start",
    field: "heldProps",
    locked: true,
    updatedAt: "2026-08-30T00:00:05.000Z"
  });
  assert.throws(() => restoreDirectorStateInheritance(project, {
    shotId: secondId,
    phase: "start",
    field: "heldProps",
    updatedAt: "2026-08-30T00:00:06.000Z"
  }), /Unlock/iu);
  // A lock freezes the exact visible literal even if the previous shot later changes.
  project = setDirectorStateLock(project, {
    shotId: secondId,
    phase: "start",
    field: "wardrobeAppearance",
    locked: true,
    updatedAt: "2026-08-30T00:00:06.100Z"
  });
  project = setDirectorStateOverride(project, {
    shotId: firstId,
    phase: "end",
    field: "wardrobeAppearance",
    value: "蓝色雨衣",
    updatedAt: "2026-08-30T00:00:06.200Z"
  });
  assert.equal(resolveDirectorShotStates(project)[1].start.wardrobeAppearance.value, "黄色雨衣");
  project = setDirectorStateLock(project, {
    shotId: secondId,
    phase: "start",
    field: "wardrobeAppearance",
    locked: false,
    updatedAt: "2026-08-30T00:00:06.300Z"
  });
  project = restoreDirectorStateInheritance(project, {
    shotId: secondId,
    phase: "start",
    field: "wardrobeAppearance",
    updatedAt: "2026-08-30T00:00:06.400Z"
  });
  project = setDirectorStateLock(project, {
    shotId: secondId,
    phase: "start",
    field: "heldProps",
    locked: false,
    updatedAt: "2026-08-30T00:00:07.000Z"
  });
  project = restoreDirectorStateInheritance(project, {
    shotId: secondId,
    phase: "start",
    field: "heldProps",
    updatedAt: "2026-08-30T00:00:08.000Z"
  });
  states = resolveDirectorShotStates(project);
  assert.equal(states[1].start.heldProps.value, "发光纸鹤");
  issues = validateDirectorContinuity(project);
  assert.equal(issues.length, 0);
});

test("only proven transitions compile; unsupported transitions stay visible intent-only", async () => {
  const {
    compileDirectorTransitions,
    promoteQuickProjectToProfessional,
    setDirectorTransition,
    validateDirectorContinuity
  } = await directorModule();
  let project = promoteQuickProjectToProfessional({
    project: await quickProject({ totalDurationSeconds: 15 }),
    updatedAt: "2026-08-30T00:00:01.000Z"
  });
  const [, secondId, thirdId] = project.shots.map((shot) => shot.shotId);
  project = setDirectorTransition(project, {
    shotId: secondId,
    type: "hard_cut",
    updatedAt: "2026-08-30T00:00:02.000Z"
  });
  project = setDirectorTransition(project, {
    shotId: thirdId,
    type: "dissolve",
    customIntent: "用户仅记录的意图",
    updatedAt: "2026-08-30T00:00:03.000Z"
  });
  const transitions = compileDirectorTransitions(project);
  assert.deepEqual(transitions.map((entry) => ({
    type: entry.type,
    disposition: entry.disposition,
    connectsTail: entry.connectPreviousTailFrameToCurrentFirstFrame
  })), [
    { type: "hard_cut", disposition: "compile", connectsTail: false },
    { type: "dissolve", disposition: "record_only", connectsTail: false }
  ]);
  const issues = validateDirectorContinuity(project);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, "record_only_transition");
  assert.match(issues[0].message, /仅记录/u);
});

test("Take accepts only an available, hashed, real local asset", async () => {
  const { attachDirectorTake, promoteQuickProjectToProfessional, readProfessionalDirectorMetadata } = await directorModule();
  const { normalizeRelayProject } = await domainModule();
  let project = promoteQuickProjectToProfessional({
    project: await quickProject({ totalDurationSeconds: 5 }),
    updatedAt: "2026-08-30T00:00:01.000Z"
  });
  const shotId = project.shots[0].shotId;
  const availableAsset = {
    assetId: "asset-alpha28-real-video",
    displayName: "本地候选",
    sourceFileName: "candidate.mp4",
    mediaType: "video",
    storageMode: "project_copy",
    projectRelativePath: "assets/originals/candidate.mp4",
    externalReferenceId: null,
    byteLength: 1234,
    sha256: "a".repeat(64),
    tags: [],
    notes: "",
    availability: "available",
    inspection: { durationSeconds: 5 },
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z"
  };
  project = normalizeRelayProject({ ...project, assets: [availableAsset] });
  project = attachDirectorTake(project, {
    takeId: "take-alpha28-candidate",
    shotId,
    assetId: availableAsset.assetId,
    name: "候选一",
    createdAt: "2026-08-30T00:00:02.000Z",
    updatedAt: "2026-08-30T00:00:02.000Z"
  });
  assert.equal(readProfessionalDirectorMetadata(project).takes[0].assetId, availableAsset.assetId);
  const missing = normalizeRelayProject({
    ...project,
    assets: [{ ...availableAsset, assetId: "asset-alpha28-missing", availability: "missing" }],
    professional: {
      ...project.professional,
      directorState: null
    }
  });
  assert.throws(() => attachDirectorTake(missing, {
    takeId: "take-alpha28-invalid",
    shotId,
    assetId: "asset-alpha28-missing",
    name: "无效",
    createdAt: "2026-08-30T00:00:03.000Z",
    updatedAt: "2026-08-30T00:00:03.000Z"
  }), /available, inspected local project asset/iu);
});

test("professional director remains deterministic and has no generation or creative rewriting surface", async () => {
  const source = await readFile(resolve(root, "src/renderer/professional-director.ts"), "utf8");
  assert.doesNotMatch(source, /fetch\s*\(|XMLHttpRequest|WebSocket|node:fs|readFile|writeFile|\/prompt|queuePrompt|submitPrompt/u);
  assert.doesNotMatch(source, /generate(?:Video|Audio)|runComfy|autoQueue|translatePrompt|expandPrompt|writeStory/u);
  assert.match(source, /without creative planning/u);
  assert.match(source, /Director shots never inherit Quick Create prompt text implicitly/u);
  assert.match(source, /record_only/u);
});
