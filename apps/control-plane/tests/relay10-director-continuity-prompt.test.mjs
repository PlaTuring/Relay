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

async function professionalProject(totalDurationSeconds = 10) {
  const { createEmptyRelayProject, normalizeRelayProject } = await domainModule();
  const { promoteQuickProjectToProfessional } = await directorModule();
  const base = createEmptyRelayProject({
    projectId: "project-continuity-prompt",
    name: "连续性项目",
    createdAt: "2026-09-03T00:00:00.000Z"
  });
  const quick = normalizeRelayProject({
    ...base,
    quick: {
      ...base.quick,
      originalPrompt: "不得混入连续性上下文的快速创建提示词",
      totalDurationSeconds,
      segmentDurationSeconds: 5
    }
  });
  return promoteQuickProjectToProfessional({
    project: quick,
    updatedAt: "2026-09-03T00:00:01.000Z"
  });
}

test("empty resolved continuity keeps ordered shot IDs with empty prompt contexts", async () => {
  const { orderedDirectorShots, serializeDirectorContinuityPromptContexts } = await directorModule();
  const project = await professionalProject(15);
  const contexts = serializeDirectorContinuityPromptContexts(project);

  assert.deepEqual(
    contexts.map(({ shotId }) => shotId),
    orderedDirectorShots(project).map(({ shot }) => shot.shotId)
  );
  assert.deepEqual(contexts.map(({ promptContext }) => promptContext), ["", "", ""]);
  assert.equal(Object.isFrozen(contexts), true);
  assert.ok(contexts.every((entry) => Object.isFrozen(entry)));
});

test("project defaults serialize as resolved start/end values with fixed bilingual labels", async () => {
  const {
    serializeDirectorContinuityPromptContexts,
    setProjectContinuityDefault
  } = await directorModule();
  let project = await professionalProject(10);
  project = setProjectContinuityDefault(project, {
    field: "subject",
    value: "朱雀 / Scarlet Finch 🐦",
    updatedAt: "2026-09-03T00:00:02.000Z"
  });
  project = setProjectContinuityDefault(project, {
    field: "lighting",
    value: "柔和轮廓光 / soft rim light",
    updatedAt: "2026-09-03T00:00:03.000Z"
  });

  const contexts = serializeDirectorContinuityPromptContexts(project);
  const expected = (shotId) => [
    "镜头连续性 / Shot continuity",
    `镜头 ID / Shot ID: ${shotId}`,
    "实际开始状态 / Resolved start state",
    "角色/主体 (subject): 朱雀 / Scarlet Finch 🐦",
    "光线 (lighting): 柔和轮廓光 / soft rim light",
    "实际结束状态 / Resolved end state",
    "角色/主体 (subject): 朱雀 / Scarlet Finch 🐦",
    "光线 (lighting): 柔和轮廓光 / soft rim light"
  ].join("\n");

  assert.equal(contexts[0].promptContext, expected(contexts[0].shotId));
  assert.equal(contexts[1].promptContext, expected(contexts[1].shotId));
  assert.doesNotMatch(contexts[0].promptContext, /不得混入/u);
  assert.doesNotMatch(contexts[0].promptContext, /source|inherited|locked/iu);
});

test("previous-shot inheritance and current overrides serialize final values in stable field order", async () => {
  const { normalizeRelayProject } = await domainModule();
  const {
    orderedDirectorShots,
    serializeDirectorContinuityPromptContexts,
    setDirectorStateOverride,
    setProjectContinuityDefault
  } = await directorModule();
  let project = await professionalProject(10);
  const [firstId, secondId] = orderedDirectorShots(project).map(({ shot }) => shot.shotId);
  project = setProjectContinuityDefault(project, {
    field: "wardrobeAppearance",
    value: "blue coat",
    updatedAt: "2026-09-03T00:00:02.000Z"
  });
  project = setDirectorStateOverride(project, {
    shotId: firstId,
    phase: "end",
    field: "heldProps",
    value: "发光纸鹤",
    updatedAt: "2026-09-03T00:00:03.000Z"
  });
  project = setDirectorStateOverride(project, {
    shotId: secondId,
    phase: "start",
    field: "poseAction",
    value: "turns toward camera",
    updatedAt: "2026-09-03T00:00:04.000Z"
  });
  project = setDirectorStateOverride(project, {
    shotId: secondId,
    phase: "end",
    field: "cameraPositionMovement",
    value: "低机位向前推 / low-angle dolly in",
    updatedAt: "2026-09-03T00:00:05.000Z"
  });

  // Physical array order is not timeline authority; scene.shotIds is.
  project = normalizeRelayProject({ ...project, shots: [...project.shots].reverse() });

  const first = serializeDirectorContinuityPromptContexts(project);
  const second = serializeDirectorContinuityPromptContexts(project);
  assert.deepEqual(second, first);
  assert.deepEqual(first.map(({ shotId }) => shotId), [firstId, secondId]);

  const context = first[1].promptContext;
  assert.match(context, /姿态\/动作 \(pose\/action\): turns toward camera/u);
  assert.match(context, /持有道具 \(held props\): 发光纸鹤/u);
  assert.match(context, /摄影机位置\/运动 \(camera position\/movement\): 低机位向前推 \/ low-angle dolly in/u);
  assert.ok(context.indexOf("服装外观") < context.indexOf("姿态/动作"));
  assert.ok(context.indexOf("姿态/动作") < context.indexOf("持有道具"));

  const endOffset = context.indexOf("实际结束状态 / Resolved end state");
  assert.ok(endOffset > 0);
  const endContext = context.slice(endOffset);
  assert.ok(endContext.indexOf("服装外观") < endContext.indexOf("姿态/动作"));
  assert.ok(endContext.indexOf("姿态/动作") < endContext.indexOf("持有道具"));
  assert.ok(endContext.indexOf("持有道具") < endContext.indexOf("摄影机位置/运动"));
});
