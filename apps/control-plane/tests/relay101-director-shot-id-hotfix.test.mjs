import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");

async function bundledModule(context, name, entry) {
  const buildRoot = await mkdtemp(path.join(os.tmpdir(), `relay-r101-${name}-`));
  context.after(() => rm(buildRoot, { recursive: true, force: true }));
  const outfile = path.join(buildRoot, `${name}.mjs`);
  await build({
    entryPoints: [path.join(root, entry)],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "silent"
  });
  return import(`${pathToFileURL(outfile).href}?case=${Date.now()}-${Math.random()}`);
}

function directorDraft(shotIds = ["shot-legacy-one", "shot-legacy-two"]) {
  return Object.freeze({
    language: "zh",
    mode: "T2V",
    totalDurationSeconds: 10,
    segmentDurationSeconds: 5,
    characterBible: "角色原文",
    worldBible: "场景原文",
    visualStyleBible: "风格原文",
    continuity: "连续性原文",
    shots: Object.freeze([
      Object.freeze({
        id: shotIds[0],
        startSeconds: 0,
        durationSeconds: 5,
        description: "旧镜头一",
        cameraLanguage: "固定机位",
        soundCue: "雨声",
        transitionNote: ""
      }),
      Object.freeze({
        id: shotIds[1],
        startSeconds: 5,
        durationSeconds: 5,
        description: "旧镜头二",
        cameraLanguage: "缓慢推进",
        soundCue: "脚步声",
        transitionNote: "尾帧延续"
      })
    ]),
    overallSoundscape: "雨夜",
    nonDiegeticMusic: "",
    subjectDefinitions: "人物设定",
    summary: "摘要",
    retentionAnalysis: "",
    styleOpening: ""
  });
}

async function authoritativeProject(domain, directorState = null) {
  const base = domain.createEmptyRelayProject({
    projectId: "project-r101-hotfix",
    name: "1.0.1 镜头迁移",
    createdAt: "2026-09-04T00:00:00.000Z"
  });
  return domain.normalizeRelayProject({
    ...base,
    editorMode: "professional",
    updatedAt: "2026-09-04T00:00:01.000Z",
    quick: {
      ...base.quick,
      workflowName: "迁移闭环",
      totalDurationSeconds: 10,
      segmentDurationSeconds: 5
    },
    professional: {
      ...base.professional,
      directorState,
      activeSceneId: "scene-authority-one",
      activeShotId: "shot-authority-two"
    },
    scenes: [{
      sceneId: "scene-authority-one",
      name: "权威场景",
      order: 0,
      notes: "项目场景原文",
      shotIds: ["shot-authority-one", "shot-authority-two"],
      archived: false
    }],
    shots: [
      {
        shotId: "shot-authority-one",
        name: "镜头 1",
        order: 0,
        durationSeconds: 5,
        prompt: "项目镜头一",
        camera: "",
        sound: "",
        startState: {},
        endState: {},
        transitionFromPrevious: null,
        archived: false
      },
      {
        shotId: "shot-authority-two",
        name: "镜头 2",
        order: 1,
        durationSeconds: 5,
        prompt: "项目镜头二",
        camera: "",
        sound: "",
        startState: {},
        endState: {},
        transitionFromPrevious: {
          type: "tail_frame_continuation",
          capability: "proven",
          inheritedFields: ["subject", "lighting"],
          assetId: null,
          customIntent: ""
        },
        archived: false
      }
    ],
    workflows: [{
      workflowId: "workflow-r101-before",
      displayName: "迁移前工作流",
      projectRelativePath: "workflows/before.json",
      byteLength: 456,
      sha256: "c".repeat(64),
      createdAt: "2026-09-04T00:00:00.000Z",
      seedResolution: {
        contractId: "relay.seed-plan",
        schemaVersion: 1,
        policy: "fixed",
        baseSeed: 42,
        nodeControlAfterGenerate: "fixed",
        shots: [{ shotId: null, ordinal: 1, seed: 42 }]
      },
      handoffs: []
    }],
    history: [{
      historyId: "history-r101-before",
      kind: "migration",
      createdAt: "2026-09-04T00:00:00.000Z",
      projectRelativePath: "history/before.json",
      byteLength: 123,
      sha256: "a".repeat(64),
      label: "迁移前",
      seedResolution: {
        contractId: "relay.seed-plan",
        schemaVersion: 1,
        policy: "fixed",
        baseSeed: 42,
        nodeControlAfterGenerate: "fixed",
        shots: [{ shotId: null, ordinal: 1, seed: 42 }]
      }
    }]
  });
}

function productionShot(state, shotId) {
  return state.scenes.flatMap((scene) => scene.shots).find((shot) => shot.id === shotId);
}

async function legacyProductionFixture(production) {
  let state = production.createEmptyProductionState({
    projectName: "旧专业导播",
    identityKey: "r101-legacy-state"
  });
  state = production.upsertProductionScene(state, {
    id: "scene-legacy-one",
    title: "旧场景",
    notes: "不得丢失的场景数据"
  });
  state = production.assignShotToScene(state, "scene-legacy-one", {
    id: "shot-legacy-one",
    startSeconds: 0,
    durationSeconds: 5,
    description: "旧镜头一",
    cameraLanguage: "固定机位",
    soundCue: "雨声"
  });
  state = production.assignShotToScene(state, "scene-legacy-one", {
    id: "shot-legacy-two",
    startSeconds: 5,
    durationSeconds: 5,
    description: "旧镜头二",
    cameraLanguage: "缓慢推进",
    soundCue: "脚步声",
    transitionNote: "尾帧延续"
  });
  state = production.setShotContinuity(state, "shot-legacy-one", "lighting", {
    mode: "override",
    value: "霓虹雨夜"
  });
  state = production.upsertProductionAssetReference(state, {
    id: "asset-legacy-image",
    sourceAssetId: "asset-source-image",
    name: "镜头参考图",
    mediaType: "image",
    projectRelativePath: "assets/originals/reference.png",
    storageMode: "copy",
    sha256: "b".repeat(64),
    sizeBytes: 321
  });
  state = production.upsertProductionBinding(state, {
    id: "binding-legacy-shot",
    targetKind: "shot",
    targetId: "shot-legacy-one",
    assetId: "asset-legacy-image",
    role: "first_frame",
    notes: "旧镜头绑定"
  });
  const revision = production.createProductionRevision(state, {
    directorSnapshot: JSON.stringify({ marker: "history-must-survive" }),
    createdAt: "2026-09-04T00:00:02.000Z"
  });
  state = production.addProductionTake(revision.state, {
    id: "take-legacy-video",
    shotId: "shot-legacy-two",
    revisionId: revision.revision.id,
    localResultPath: "D:\\RelayResults\\candidate.mp4",
    name: "候选成片",
    notes: "Take 原文",
    rating: 4,
    createdAt: "2026-09-04T00:00:03.000Z"
  });
  return { state, revision };
}

function numberedId(prefix, index) {
  return `${prefix}-${String(index + 1).padStart(3, "0")}`;
}

function parameterizedDraft(count) {
  return Object.freeze({
    ...directorDraft(),
    totalDurationSeconds: count * 5,
    shots: Object.freeze(Array.from({ length: count }, (_, index) => Object.freeze({
      id: numberedId("shot-legacy", index),
      startSeconds: index * 5,
      durationSeconds: 5,
      description: `提示词-${index + 1}`,
      cameraLanguage: `摄影机-${index + 1}`,
      soundCue: `声音-${index + 1}`,
      transitionNote: index === 0 ? "" : `衔接-${index + 1}`
    })))
  });
}

async function parameterizedProject(domain, count) {
  const base = domain.createEmptyRelayProject({
    projectId: `project-r101-matrix-${count}`,
    name: `镜头矩阵 ${count}`,
    createdAt: "2026-09-04T01:00:00.000Z"
  });
  const authorityIds = Array.from({ length: count }, (_, index) => numberedId("shot-authority", index));
  return domain.normalizeRelayProject({
    ...base,
    editorMode: "professional",
    quick: {
      ...base.quick,
      workflowName: `矩阵-${count}`,
      totalDurationSeconds: count * 5,
      segmentDurationSeconds: 5
    },
    professional: {
      ...base.professional,
      activeSceneId: "scene-authority-matrix",
      activeShotId: authorityIds.at(-1)
    },
    scenes: [{
      sceneId: "scene-authority-matrix",
      name: "矩阵场景",
      order: 0,
      notes: "",
      shotIds: authorityIds,
      archived: false
    }],
    shots: authorityIds.map((shotId, index) => ({
      shotId,
      name: `镜头 ${index + 1}`,
      order: index,
      durationSeconds: 5,
      prompt: "",
      camera: "",
      sound: "",
      startState: {},
      endState: {},
      transitionFromPrevious: index === 0 ? null : {
        type: "tail_frame_continuation",
        capability: "proven",
        inheritedFields: ["lighting", "audioState"],
        assetId: null,
        customIntent: ""
      },
      archived: false
    }))
  });
}

async function parameterizedProductionFixture(production, count) {
  let state = production.createEmptyProductionState({
    projectName: `旧矩阵 ${count}`,
    identityKey: `r101-matrix-${count}`
  });
  state = production.upsertProductionScene(state, {
    id: "scene-legacy-matrix",
    title: "旧矩阵场景"
  });
  state = production.upsertProductionAssetReference(state, {
    id: "asset-legacy-matrix",
    sourceAssetId: "asset-source-matrix",
    name: "矩阵素材",
    mediaType: "image",
    projectRelativePath: "assets/originals/matrix.png",
    storageMode: "copy",
    sha256: "d".repeat(64),
    sizeBytes: 999
  });
  for (let index = 0; index < count; index += 1) {
    const shotId = numberedId("shot-legacy", index);
    state = production.assignShotToScene(state, "scene-legacy-matrix", {
      id: shotId,
      startSeconds: index * 5,
      durationSeconds: 5,
      description: `提示词-${index + 1}`,
      cameraLanguage: `摄影机-${index + 1}`,
      soundCue: `声音-${index + 1}`,
      transitionNote: index === 0 ? "" : `衔接-${index + 1}`
    });
    state = production.setShotContinuity(state, shotId, "lighting", {
      mode: "override",
      value: `连续性-${index + 1}`
    });
    state = production.upsertProductionBinding(state, {
      id: numberedId("binding-legacy", index),
      targetKind: "shot",
      targetId: shotId,
      assetId: "asset-legacy-matrix",
      role: `reference-${index + 1}`
    });
  }
  const revision = production.createProductionRevision(state, {
    directorSnapshot: JSON.stringify({ count, marker: "matrix-history" }),
    createdAt: "2026-09-04T01:00:01.000Z"
  });
  state = revision.state;
  for (let index = 0; index < count; index += 1) {
    state = production.addProductionTake(state, {
      id: numberedId("take-legacy", index),
      shotId: numberedId("shot-legacy", index),
      revisionId: revision.revision.id,
      localResultPath: `D:\\RelayResults\\matrix-${index + 1}.mp4`,
      name: `候选-${index + 1}`,
      notes: `Take-${index + 1}`,
      createdAt: "2026-09-04T01:00:02.000Z"
    });
  }
  return state;
}

test("1/3/6/12-shot legacy work copies reconcile every literal and foreign key, then restart as a no-op", async (context) => {
  const [reconciliation, production, domain] = await Promise.all([
    bundledModule(context, "reconciliation-matrix", "src/renderer/professional-director-reconciliation.ts"),
    bundledModule(context, "production-matrix", "src/renderer/director-production.ts"),
    bundledModule(context, "domain-matrix", "src/shared/project-domain.ts")
  ]);

  for (const count of [1, 3, 6, 12]) {
    const project = await parameterizedProject(domain, count);
    const draft = parameterizedDraft(count);
    const state = await parameterizedProductionFixture(production, count);
    const authorityIds = Array.from({ length: count }, (_, index) => numberedId("shot-authority", index));
    const fingerprints = Object.fromEntries(Array.from(
      { length: count },
      (_, index) => [numberedId("shot-legacy", index), `fingerprint-${index + 1}`]
    ));
    const result = reconciliation.reconcileProfessionalDirectorStateWithProject({
      project,
      draft,
      state,
      sourceVersion: 7,
      legacyActiveShotId: numberedId("shot-legacy", count - 1),
      lastCompiledShotFingerprints: fingerprints
    });

    assert.equal(result.ok, true, result.ok ? undefined : `${count}: ${result.error}`);
    assert.equal(result.changed, true, `${count}: drifted IDs must be migrated`);
    assert.deepEqual(result.draft.shots.map((shot) => shot.id), authorityIds, `${count}: authoritative IDs`);
    assert.equal(result.activeShotId, authorityIds.at(-1), `${count}: the final shot remains selected`);
    assert.deepEqual(result.lastCompiledShotFingerprints, {}, `${count}: live compile proof is invalidated`);
    assert.deepEqual(result.state.revisions, state.revisions, `${count}: immutable Revision history survives`);

    for (let index = 0; index < count; index += 1) {
      const authorityId = authorityIds[index];
      const migratedDraft = result.draft.shots[index];
      const migratedState = productionShot(result.state, authorityId);
      assert.equal(migratedDraft.description, `提示词-${index + 1}`, `${count}/${index}: prompt`);
      assert.equal(migratedDraft.cameraLanguage, `摄影机-${index + 1}`, `${count}/${index}: camera`);
      assert.equal(migratedDraft.soundCue, `声音-${index + 1}`, `${count}/${index}: sound`);
      assert.equal(migratedState.description, `提示词-${index + 1}`, `${count}/${index}: production prompt`);
      assert.equal(migratedState.cameraLanguage, `摄影机-${index + 1}`, `${count}/${index}: production camera`);
      assert.equal(migratedState.soundCue, `声音-${index + 1}`, `${count}/${index}: production sound`);
      assert.equal(migratedState.continuity.lighting.value, `连续性-${index + 1}`, `${count}/${index}: continuity`);
      assert.equal(
        result.state.bindings.find((binding) => binding.id === numberedId("binding-legacy", index)).targetId,
        authorityId,
        `${count}/${index}: binding foreign key`
      );
      assert.equal(
        result.state.takes.find((take) => take.id === numberedId("take-legacy", index)).shotId,
        authorityId,
        `${count}/${index}: Take foreign key`
      );
    }

    const restarted = reconciliation.reconcileProfessionalDirectorStateWithProject({
      project,
      draft: result.draft,
      state: result.state,
      sourceVersion: 7,
      legacyActiveShotId: result.activeShotId,
      lastCompiledShotFingerprints: result.lastCompiledShotFingerprints
    });
    assert.equal(restarted.ok, true, restarted.ok ? undefined : `${count}: ${restarted.error}`);
    assert.equal(restarted.changed, false, `${count}: second reconciliation must be a no-op`);
    assert.deepEqual(restarted.draft, result.draft, `${count}: draft restart stability`);
    assert.deepEqual(restarted.state, result.state, `${count}: production restart stability`);
  }
});

test("null or invalid project activeShotId adopts the mapped non-first legacy selection and keeps it on restart", async (context) => {
  const [reconciliation, production, domain] = await Promise.all([
    bundledModule(context, "reconciliation-active-fallback", "src/renderer/professional-director-reconciliation.ts"),
    bundledModule(context, "production-active-fallback", "src/renderer/director-production.ts"),
    bundledModule(context, "domain-active-fallback", "src/shared/project-domain.ts")
  ]);
  const authoritative = await parameterizedProject(domain, 3);
  const aligned = reconciliation.reconcileProfessionalDirectorStateWithProject({
    project: authoritative,
    draft: parameterizedDraft(3),
    state: await parameterizedProductionFixture(production, 3),
    sourceVersion: 7,
    legacyActiveShotId: "shot-legacy-003",
    lastCompiledShotFingerprints: {}
  });
  assert.equal(aligned.ok, true, aligned.ok ? undefined : aligned.error);

  for (const invalidActiveShotId of [null, "shot-authority-missing"]) {
    // The invalid case models an old/raw in-memory document before the normalizer
    // gets a chance to enforce membership. Reconciliation must not trust it.
    const project = {
      ...authoritative,
      professional: {
        ...authoritative.professional,
        activeShotId: invalidActiveShotId
      }
    };
    const result = reconciliation.reconcileProfessionalDirectorStateWithProject({
      project,
      draft: aligned.draft,
      state: aligned.state,
      sourceVersion: 7,
      legacyActiveShotId: "shot-authority-003",
      lastCompiledShotFingerprints: { "shot-authority-003": "stale-proof" }
    });
    assert.equal(result.ok, true, result.ok ? undefined : result.error);
    assert.equal(result.changed, true,
      "repairing only a null/invalid authoritative selection still requires one atomic save");
    assert.equal(result.activeShotId, "shot-authority-003");
    assert.deepEqual(result.lastCompiledShotFingerprints, {});

    const synchronizedProject = {
      ...authoritative,
      professional: {
        ...authoritative.professional,
        activeShotId: result.activeShotId
      }
    };
    const restarted = reconciliation.reconcileProfessionalDirectorStateWithProject({
      project: synchronizedProject,
      draft: result.draft,
      state: result.state,
      sourceVersion: 7,
      legacyActiveShotId: result.activeShotId,
      lastCompiledShotFingerprints: result.lastCompiledShotFingerprints
    });
    assert.equal(restarted.ok, true, restarted.ok ? undefined : restarted.error);
    assert.equal(restarted.changed, false);
    assert.equal(restarted.activeShotId, "shot-authority-003",
      "the second startup keeps the synchronized non-first authoritative selection");
  }
});

test("mixed old-draft/already-authoritative production state is safe or fails closed without mutation", async (context) => {
  const [reconciliation, production, domain] = await Promise.all([
    bundledModule(context, "reconciliation-mixed", "src/renderer/professional-director-reconciliation.ts"),
    bundledModule(context, "production-mixed", "src/renderer/director-production.ts"),
    bundledModule(context, "domain-mixed", "src/shared/project-domain.ts")
  ]);
  const project = await parameterizedProject(domain, 3);
  const oldDraft = parameterizedDraft(3);
  const oldState = await parameterizedProductionFixture(production, 3);
  const firstPass = reconciliation.reconcileProfessionalDirectorStateWithProject({
    project,
    draft: oldDraft,
    state: oldState,
    sourceVersion: 7,
    legacyActiveShotId: "shot-legacy-003",
    lastCompiledShotFingerprints: {}
  });
  assert.equal(firstPass.ok, true, firstPass.ok ? undefined : firstPass.error);
  const draftBefore = JSON.stringify(oldDraft);
  const stateBefore = JSON.stringify(firstPass.state);

  const mixed = reconciliation.reconcileProfessionalDirectorStateWithProject({
    project,
    draft: oldDraft,
    state: firstPass.state,
    sourceVersion: 7,
    legacyActiveShotId: "shot-legacy-003",
    lastCompiledShotFingerprints: { "shot-legacy-001": "stale-proof" }
  });
  if (mixed.ok) {
    assert.equal(mixed.changed, true);
    assert.deepEqual(mixed.draft.shots.map((shot) => shot.id), [
      "shot-authority-001",
      "shot-authority-002",
      "shot-authority-003"
    ]);
    assert.deepEqual(mixed.lastCompiledShotFingerprints, {}, "a mixed repair cannot retain stale compile proof");
  } else {
    assert.ok([
      "DIRECTOR_SHOT_ID_RECONCILIATION_INCOMPLETE",
      "DIRECTOR_SHOT_ID_RECONCILIATION_AMBIGUOUS",
      "DIRECTOR_SHOT_ID_RECONCILIATION_CONFLICT"
    ].includes(mixed.code));
    assert.equal(JSON.stringify(oldDraft), draftBefore);
    assert.equal(JSON.stringify(firstPass.state), stateBefore);
  }
});

for (const sourceVersion of [5, 6, 7]) {
  test(`preserved v${sourceVersion} shot IDs reconcile to authoritative project IDs without data loss`, async (context) => {
    const [reconciliation, production, domain] = await Promise.all([
      bundledModule(context, `reconciliation-v${sourceVersion}`, "src/renderer/professional-director-reconciliation.ts"),
      bundledModule(context, `production-v${sourceVersion}`, "src/renderer/director-production.ts"),
      bundledModule(context, `domain-v${sourceVersion}`, "src/shared/project-domain.ts")
    ]);
    const project = await authoritativeProject(domain);
    const legacy = await legacyProductionFixture(production);
    const revisionsBefore = structuredClone(legacy.state.revisions);
    const projectHistoryBefore = structuredClone(project.history);
    const projectWorkflowsBefore = structuredClone(project.workflows);

    const result = reconciliation.reconcileProfessionalDirectorStateWithProject({
      project,
      draft: directorDraft(),
      state: legacy.state,
      sourceVersion,
      legacyActiveShotId: "shot-legacy-two",
      lastCompiledShotFingerprints: {
        "shot-legacy-one": "fingerprint-one",
        "shot-legacy-two": "fingerprint-two"
      }
    });

    assert.equal(result.ok, true, result.ok ? undefined : result.error);
    assert.equal(result.changed, true);
    assert.deepEqual(
      result.draft.shots.map((shot) => shot.id),
      ["shot-authority-one", "shot-authority-two"]
    );
    assert.equal(result.activeShotId, "shot-authority-two", "the authoritative project selection wins");
    assert.equal(productionShot(result.state, "shot-legacy-one"), undefined);
    assert.equal(productionShot(result.state, "shot-legacy-two"), undefined);
    assert.equal(productionShot(result.state, "shot-authority-one").continuity.lighting.value, "霓虹雨夜");
    assert.equal(
      result.state.bindings.find((binding) => binding.id === "binding-legacy-shot").targetId,
      "shot-authority-one"
    );
    assert.equal(
      result.state.takes.find((take) => take.id === "take-legacy-video").shotId,
      "shot-authority-two"
    );
    assert.equal(result.state.takes[0].notes, "Take 原文");
    assert.deepEqual(result.state.revisions, revisionsBefore, "read-only history checkpoints are not rewritten or lost");
    assert.deepEqual(project.history, projectHistoryBefore, "project history remains untouched by Director reconciliation");
    assert.deepEqual(project.workflows, projectWorkflowsBefore, "workflow and seed-resolution evidence remains untouched");
    assert.deepEqual(
      result.lastCompiledShotFingerprints,
      {},
      "an ID migration invalidates live compile proof instead of re-keying it and pretending the work copy is compiled"
    );
    assert.equal(result.state.project.directorSettings.lastCompiledSnapshot, "");

    const restarted = reconciliation.reconcileProfessionalDirectorStateWithProject({
      project,
      draft: result.draft,
      state: result.state,
      sourceVersion: 7,
      legacyActiveShotId: result.activeShotId,
      lastCompiledShotFingerprints: result.lastCompiledShotFingerprints
    });
    assert.equal(restarted.ok, true, restarted.ok ? undefined : restarted.error);
    assert.equal(restarted.changed, false, "a restart must not repeat or drift an already-completed migration");
    assert.deepEqual(restarted.draft, result.draft);
    assert.deepEqual(restarted.state, result.state);
    assert.deepEqual(restarted.lastCompiledShotFingerprints, result.lastCompiledShotFingerprints);
  });
}

test("ambiguous duplicate legacy IDs fail closed without mutating any input", async (context) => {
  const [reconciliation, production, domain] = await Promise.all([
    bundledModule(context, "reconciliation-ambiguous", "src/renderer/professional-director-reconciliation.ts"),
    bundledModule(context, "production-ambiguous", "src/renderer/director-production.ts"),
    bundledModule(context, "domain-ambiguous", "src/shared/project-domain.ts")
  ]);
  const project = await authoritativeProject(domain);
  const legacy = await legacyProductionFixture(production);
  const ambiguousDraft = directorDraft(["shot-legacy-one", "shot-legacy-one"]);
  const projectBefore = JSON.stringify(project);
  const draftBefore = JSON.stringify(ambiguousDraft);
  const stateBefore = JSON.stringify(legacy.state);

  const result = reconciliation.reconcileProfessionalDirectorStateWithProject({
    project,
    draft: ambiguousDraft,
    state: legacy.state,
    sourceVersion: 7,
    legacyActiveShotId: "shot-legacy-one",
    lastCompiledShotFingerprints: { "shot-legacy-one": "fingerprint" }
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "DIRECTOR_SHOT_ID_RECONCILIATION_AMBIGUOUS");
  assert.match(result.error, /镜头|ID|对应|歧义/u);
  assert.equal(JSON.stringify(project), projectBefore);
  assert.equal(JSON.stringify(ambiguousDraft), draftBefore);
  assert.equal(JSON.stringify(legacy.state), stateBefore);
});

test("incomplete timing correspondence fails closed instead of attaching legacy content to a wrong shot", async (context) => {
  const [reconciliation, production, domain] = await Promise.all([
    bundledModule(context, "reconciliation-incomplete", "src/renderer/professional-director-reconciliation.ts"),
    bundledModule(context, "production-incomplete", "src/renderer/director-production.ts"),
    bundledModule(context, "domain-incomplete", "src/shared/project-domain.ts")
  ]);
  const project = await authoritativeProject(domain);
  const legacy = await legacyProductionFixture(production);
  const wrongTiming = {
    ...directorDraft(),
    totalDurationSeconds: 15,
    shots: [
      directorDraft().shots[0],
      { ...directorDraft().shots[1], startSeconds: 5, durationSeconds: 10 }
    ]
  };
  const result = reconciliation.reconcileProfessionalDirectorStateWithProject({
    project,
    draft: wrongTiming,
    state: legacy.state,
    sourceVersion: 7,
    legacyActiveShotId: "shot-legacy-two",
    lastCompiledShotFingerprints: {}
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "DIRECTOR_SHOT_ID_RECONCILIATION_INCOMPLETE");
});

test("the real v5/v6/v7 restore and history-restore paths reconcile before applying a work copy", async () => {
  const renderer = await readFile(path.join(root, "src", "renderer", "index.ts"), "utf8");
  const restoreStart = renderer.indexOf("function restoreDirectorDraft()");
  const restoreEnd = renderer.indexOf("function validateDirectorForCompilation", restoreStart);
  assert.ok(restoreStart >= 0 && restoreEnd > restoreStart);
  const restore = renderer.slice(restoreStart, restoreEnd);
  const restoredPayload = restore.indexOf("restoreDirectorPayload(payload)");
  const reconciliation = restore.indexOf("reconcileProfessionalDirectorStateWithProject", restoredPayload);
  const apply = restore.indexOf("applyDirectorDraftToWorkCopy", restoredPayload);
  assert.ok(restoredPayload >= 0 && reconciliation > restoredPayload && apply > reconciliation,
    "v5/v6/v7 payloads must be reconciled against the open project before reaching UI state");
  assert.match(restore.slice(reconciliation, apply), /sourceVersion:\s*restored\.sourceVersion/u);
  assert.match(restore.slice(reconciliation), /directorLastCompiledSnapshot\s*=\s*!reconciled\.changed[\s\S]*?:\s*""/u);
  assert.match(restore.slice(reconciliation), /directorLastCompiledTechnicalSnapshot\s*=\s*!reconciled\.changed[\s\S]*?:\s*""/u);

  const historyStart = renderer.indexOf("function restoreDirectorProductionRevisionToWorkCopy");
  const historyEnd = renderer.indexOf("function restoreDirectorDraft", historyStart);
  assert.ok(historyStart >= 0 && historyEnd > historyStart);
  const history = renderer.slice(historyStart, historyEnd);
  const restoredRevision = history.indexOf("restoreDirectorP1Revision");
  const historyReconciliation = history.indexOf("reconcileProfessionalDirectorStateWithProject", restoredRevision);
  const historyApply = history.indexOf("applyDirectorDraftToWorkCopy", restoredRevision);
  assert.ok(restoredRevision >= 0 && historyReconciliation > restoredRevision && historyApply > historyReconciliation,
    "restoring a historical checkpoint must pass through the same authoritative-ID reconciliation");
});

test("a Director refresh exception is contained and cannot turn a successful environment scan into initialization failure", async (context) => {
  const reconciliation = await bundledModule(
    context,
    "refresh-isolation",
    "src/renderer/professional-director-reconciliation.ts"
  );
  const successfulScan = Object.freeze({ scanId: "scan-r101-success", requiredComponentsReady: true });
  let latestScan = successfulScan;
  let initializationStatus = "ready";
  let reported = null;

  const refreshed = reconciliation.safelyRefreshProfessionalDirectorState(
    () => {
      throw new Error("legacy Director preview mismatch");
    },
    (error) => {
      reported = error;
    }
  );

  assert.equal(refreshed, false);
  assert.equal(latestScan, successfulScan, "the completed environment scan remains authoritative");
  assert.equal(initializationStatus, "ready", "project-preview failure cannot relabel application initialization");
  assert.match(String(reported), /legacy Director preview mismatch/u);

  let calls = 0;
  assert.equal(reconciliation.safelyRefreshProfessionalDirectorState(() => { calls += 1; }, () => {}), true);
  assert.equal(calls, 1);
});

test("the installed runScan path uses the tested isolation wrapper outside environment error ownership", async () => {
  const renderer = await readFile(path.join(root, "src", "renderer", "index.ts"), "utf8");
  const refreshStart = renderer.indexOf("function syncRef2vaAvailability");
  const refreshEnd = renderer.indexOf("function installationStateLabel", refreshStart);
  assert.ok(refreshStart >= 0 && refreshEnd > refreshStart);
  const refresh = renderer.slice(refreshStart, refreshEnd);
  assert.match(refresh, /safelyRefreshProfessionalDirectorState\(/u);
  assert.match(refresh, /syncDirectorRefAvailability/u);
  assert.match(refresh, /directorStateChip\.textContent/u,
    "a contained Director failure is reported only on the Director surface");

  const scanStart = renderer.indexOf("async function runScan(automatic: boolean)");
  const scanEnd = renderer.indexOf('installForm.addEventListener("submit"', scanStart);
  assert.ok(scanStart >= 0 && scanEnd > scanStart);
  const scan = renderer.slice(scanStart, scanEnd);
  assert.match(scan, /latestScan\s*=\s*await window\.controlPlane\.scanInstallation/u);
  assert.match(scan, /syncRef2vaAvailability\(\)/u);
  assert.doesNotMatch(scan, /syncDirectorRefAvailability\(\)/u,
    "runScan may call only the isolating facade, never the throwable Director refresh directly");
});

test("reconciled active selection reaches project and workspace authority before UI, then persists in the same CAS", async () => {
  const renderer = await readFile(path.join(root, "src", "renderer", "index.ts"), "utf8");
  const transactionStart = renderer.indexOf("function applyReconciledDirectorActiveShot");
  const transactionEnd = renderer.indexOf("function restoreDirectorProductionRevisionToWorkCopy", transactionStart);
  assert.ok(transactionStart >= 0 && transactionEnd > transactionStart,
    "the active-shot repair needs one named transaction before restore/render code");
  const transaction = renderer.slice(transactionStart, transactionEnd);
  assert.match(transaction, /activeShotId[^\n]*null|activeShotId === null/u);
  assert.match(transaction, /shots\.some\([\s\S]*?shotId === activeShotId[\s\S]*?!shot\.archived/u,
    "the transaction must fail closed unless the reconciled ID belongs to an active authoritative shot");
  assert.match(transaction, /activeRelayProject\s*=\s*Object\.freeze\([\s\S]*?activeShotId/u);
  assert.match(transaction, /directorWorkspace\s*=\s*Object\.freeze\([\s\S]*?session:[\s\S]*?current:[\s\S]*?activeShotId/u);
  assert.doesNotMatch(transaction, /applyProjectWorkspaceEdit|focusProjectWorkspaceShot/u,
    "migration synchronization is not a user command and must not manufacture undo history");

  const historyStart = renderer.indexOf("function restoreDirectorProductionRevisionToWorkCopy");
  const historyEnd = renderer.indexOf("function restoreDirectorDraft", historyStart);
  const history = renderer.slice(historyStart, historyEnd);
  const historyReconcile = history.indexOf("reconcileProfessionalDirectorStateWithProject");
  const historySync = history.indexOf("applyReconciledDirectorActiveShot", historyReconcile);
  const historyApply = history.indexOf("applyDirectorDraftToWorkCopy", historyReconcile);
  const historyUi = history.indexOf("directorP1Ui.setActiveShot", historyReconcile);
  assert.ok(historyReconcile >= 0 && historySync > historyReconcile && historyApply > historySync && historyUi > historyApply,
    "history restore must update authority before applying or rendering the work copy");
  assert.match(history.slice(historyReconcile, historySync), /legacyActiveShotId:\s*directorActiveShotId/u,
    "history restore must carry a non-first legacy selection when project activeShotId is null or invalid");

  const restoreStart = renderer.indexOf("function restoreDirectorDraft()");
  const restoreEnd = renderer.indexOf("function validateDirectorForCompilation", restoreStart);
  const restore = renderer.slice(restoreStart, restoreEnd);
  const payloadReconcile = restore.indexOf("reconcileProfessionalDirectorStateWithProject");
  const payloadSync = restore.indexOf("applyReconciledDirectorActiveShot", payloadReconcile);
  const payloadApply = restore.indexOf("applyDirectorDraftToWorkCopy", payloadReconcile);
  const payloadUi = restore.indexOf("directorP1Ui.setActiveShot", payloadReconcile);
  assert.ok(payloadReconcile >= 0 && payloadSync > payloadReconcile && payloadApply > payloadSync && payloadUi > payloadApply,
    "v5/v6/v7 startup restore must update authority before applying or rendering the work copy");

  const saveStart = renderer.indexOf("async function saveDirectorDraft");
  const saveEnd = renderer.indexOf("function captureDirectorCompilation", saveStart);
  const save = renderer.slice(saveStart, saveEnd);
  const activeCapture = save.indexOf("authoritativeActiveShotId");
  const nextProject = save.indexOf("const nextProject", activeCapture);
  const activePersistField = save.indexOf("activeShotId: authoritativeActiveShotId", nextProject);
  const persist = save.indexOf("await persistRelayProject(nextProject)", activePersistField);
  assert.ok(activeCapture >= 0 && nextProject > activeCapture && activePersistField > nextProject && persist > activePersistField,
    "the reconciled selection must be part of the same project document and CAS that persists the migrated payload");
});
