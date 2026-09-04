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

const directorModule = () => bundledModule("src/renderer/professional-director.ts");
const domainModule = () => bundledModule("src/shared/project-domain.ts");

async function professionalProject() {
  const { createEmptyRelayProject, normalizeRelayProject } = await domainModule();
  const { promoteQuickProjectToProfessional } = await directorModule();
  const base = createEmptyRelayProject({
    projectId: "project-transition-inheritance",
    name: "衔接继承",
    createdAt: "2026-09-03T00:00:00.000Z"
  });
  const quick = normalizeRelayProject({
    ...base,
    quick: { ...base.quick, totalDurationSeconds: 10, segmentDurationSeconds: 5 }
  });
  return promoteQuickProjectToProfessional({
    project: quick,
    updatedAt: "2026-09-03T00:00:01.000Z"
  });
}

test("transition inheritedFields controls resolved state and serialized compiler prompt", async () => {
  const {
    orderedDirectorShots,
    resolveDirectorShotStates,
    serializeDirectorContinuityPromptContexts,
    setDirectorStateOverride,
    setDirectorTransition,
    setProjectContinuityDefault
  } = await directorModule();
  let project = await professionalProject();
  const [firstId, secondId] = orderedDirectorShots(project).map(({ shot }) => shot.shotId);

  project = setProjectContinuityDefault(project, {
    field: "subject",
    value: "项目固定主体",
    updatedAt: "2026-09-03T00:00:02.000Z"
  });
  for (const [field, value] of [
    ["subject", "上一镜头主体"],
    ["lighting", "上一镜头光线"],
    ["audioState", "上一镜头环境声"]
  ]) {
    project = setDirectorStateOverride(project, {
      shotId: firstId,
      phase: "end",
      field,
      value,
      updatedAt: "2026-09-03T00:00:03.000Z"
    });
  }
  project = setDirectorTransition(project, {
    shotId: secondId,
    type: "hard_cut",
    inheritedFields: ["audioState"],
    updatedAt: "2026-09-03T00:00:04.000Z"
  });

  const second = resolveDirectorShotStates(project)[1];
  assert.equal(second.start.subject.value, "项目固定主体");
  assert.equal(second.start.subject.source, "project_default");
  assert.equal(second.start.subject.sourceShotId, null);
  assert.equal(second.start.lighting.value, "");
  assert.equal(second.start.lighting.source, "empty");
  assert.equal(second.start.audioState.value, "上一镜头环境声");
  assert.equal(second.start.audioState.source, "previous_shot_end");
  assert.equal(second.start.audioState.sourceShotId, firstId);

  const context = serializeDirectorContinuityPromptContexts(project)[1].promptContext;
  assert.match(context, /角色\/主体 \(subject\): 项目固定主体/u);
  assert.match(context, /音频状态 \(audio state\): 上一镜头环境声/u);
  assert.doesNotMatch(context, /上一镜头主体|上一镜头光线/u);
});

test("legacy/default transition still inherits every continuity field", async () => {
  const {
    orderedDirectorShots,
    resolveDirectorShotStates,
    setDirectorStateOverride
  } = await directorModule();
  let project = await professionalProject();
  const [firstId] = orderedDirectorShots(project).map(({ shot }) => shot.shotId);
  project = setDirectorStateOverride(project, {
    shotId: firstId,
    phase: "end",
    field: "heldProps",
    value: "连续道具",
    updatedAt: "2026-09-03T00:00:02.000Z"
  });
  const second = resolveDirectorShotStates(project)[1];
  assert.equal(second.start.heldProps.value, "连续道具");
  assert.equal(second.start.heldProps.source, "previous_shot_end");
});
