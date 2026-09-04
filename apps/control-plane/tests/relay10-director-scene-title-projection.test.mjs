import assert from "node:assert/strict";
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

test("a user-authored scene title enters only its assigned shot prompt", async () => {
  const controller = await bundledModule("src/renderer/director-p1-controller.ts");
  const production = await bundledModule("src/renderer/director-production.ts");
  const draft = {
    language: "zh",
    mode: "T2V",
    totalDurationSeconds: 10,
    segmentDurationSeconds: 5,
    characterBible: "",
    worldBible: "",
    visualStyleBible: "",
    continuity: "",
    shots: [
      { startSeconds: 0, durationSeconds: 5, description: "镜头一" },
      { startSeconds: 5, durationSeconds: 5, description: "镜头二" }
    ],
    overallSoundscape: "",
    nonDiegeticMusic: "",
    subjectDefinitions: "",
    summary: "",
    retentionAnalysis: "",
    styleOpening: ""
  };
  const synced = controller.syncDirectorProductionState({
    state: production.createEmptyProductionState({ identityKey: "scene-title" }),
    workflowName: "场景标题投影",
    draft
  });
  let state = production.upsertProductionScene(synced.state, {
    identityKey: "rain-roof",
    title: "雨夜屋顶",
    order: 1
  });
  const customScene = state.scenes.find((scene) => scene.title === "雨夜屋顶");
  assert.ok(customScene);
  state = production.assignShotToScene(state, customScene.id, {
    id: synced.draft.shots[0].id,
    startSeconds: 0,
    durationSeconds: 5
  });

  const result = controller.decorateDirectorDraftForProduction(state, synced.draft);
  assert.match(result.draft.shots[0].description, /场景: 雨夜屋顶/u);
  assert.doesNotMatch(result.draft.shots[1].description, /雨夜屋顶/u);
  assert.doesNotMatch(result.draft.shots[1].description, /默认场景/u);
});

test("default scene labels stay organizational and do not pollute the H3 prompt", async () => {
  const controller = await bundledModule("src/renderer/director-p1-controller.ts");
  const production = await bundledModule("src/renderer/director-production.ts");
  const draft = {
    language: "en",
    mode: "T2V",
    totalDurationSeconds: 5,
    segmentDurationSeconds: 5,
    continuity: "",
    shots: [{ startSeconds: 0, durationSeconds: 5, description: "a literal shot" }],
    overallSoundscape: "",
    nonDiegeticMusic: "",
    subjectDefinitions: "",
    summary: "",
    retentionAnalysis: "",
    styleOpening: ""
  };
  const synced = controller.syncDirectorProductionState({
    state: production.createEmptyProductionState({ identityKey: "default-scene-title" }),
    workflowName: "default scene",
    draft
  });
  const result = controller.decorateDirectorDraftForProduction(synced.state, synced.draft);
  assert.doesNotMatch(result.draft.shots[0].description, /Default Scene|默认场景/u);
});
