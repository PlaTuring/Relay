import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

import {
  compileProject,
} from "../../../packages/workflow/h3-compiler/src/index.mjs";

const controlPlaneRoot = path.resolve(import.meta.dirname, "..");
const repositoryRoot = path.resolve(controlPlaneRoot, "..", "..");
const rendererSource = await readFile(
  path.join(controlPlaneRoot, "src", "renderer", "index.ts"),
  "utf8",
);

async function loadTypeScriptModule(context, entry, { stubElectron = false } = {}) {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), "relay-comfy-projection-"));
  context.after(() => rm(outputRoot, { recursive: true, force: true }));
  const outfile = path.join(outputRoot, "module.mjs");
  await build({
    entryPoints: [path.join(controlPlaneRoot, entry)],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "silent",
    plugins: stubElectron ? [{
      name: "electron-utility-process-stub",
      setup(buildApi) {
        buildApi.onResolve({ filter: /^electron$/ }, () => ({
          path: "electron",
          namespace: "electron-stub",
        }));
        buildApi.onLoad({ filter: /.*/, namespace: "electron-stub" }, () => ({
          contents: "export const utilityProcess = Object.freeze({});",
          loader: "js",
        }));
      },
    }] : [],
  });
  return import(`${new URL(`file:///${outfile.replaceAll("\\", "/")}`).href}?${Date.now()}-${Math.random()}`);
}

function sourceSlice(startMarker, endMarker) {
  const start = rendererSource.indexOf(startMarker);
  const end = rendererSource.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing renderer marker: ${startMarker}`);
  assert.ok(end > start, `missing renderer end marker after ${startMarker}: ${endMarker}`);
  return rendererSource.slice(start, end);
}

function officialTimedPrompt(segmentCount) {
  const shots = Array.from({ length: segmentCount }, (_, index) => index === 0
    ? "[Shot 1] Live-action opening."
    : `[Shot ${index + 1}] At 00:${String(index * 5).padStart(2, "0")}.000, live-action continuation.`
  ).join("\n");
  return [
    `integrated_multimodal_description: ${shots}`,
    "",
    "overall_soundscape: Stable room tone.",
    "",
    "non_diegetic_music: N/A",
  ].join("\n");
}

function officialReferencePrompt() {
  return [
    "subject_definitions:",
    "<Subject 1> is the subject in <Picture 1>.",
    "",
    "summary:",
    "[reference generation] Preserve <Subject 1>.",
    "",
    "retention_analysis:",
    "<Subject 1>: fully_preserved - identity remains consistent.",
    "",
    "detailed_description:",
    "Live-action cinematic style. [Shot 1] The subject turns toward camera.",
    "",
    "overall_soundscape:",
    "Stable room tone.",
    "",
    "non_diegetic_music:",
    "N/A",
  ].join("\n");
}

function compilerProject(overrides = {}) {
  return {
    schema_version: "1.0.0",
    prompt: "USER_SUPPLIED_PROMPT",
    mode: "t2v",
    duration: 5,
    segment_duration: 5,
    canvas: "16:9",
    resolution_megapixels: 0.98,
    advanced: {
      seed: 117117,
      seed_policy: "fixed",
      sampling_profile: "quality_20",
    },
    ...overrides,
  };
}

function projectSpec(transitions) {
  return {
    prompt: officialTimedPrompt(3),
    mode: "T2V",
    firstFrameSelectionId: null,
    lastFrameSelectionId: null,
    durationSeconds: 15,
    segmentDurationSeconds: 5,
    segmentDurationsSeconds: [5, 5, 5],
    segmentShotIds: ["shot-projection01", "shot-projection02", "shot-projection03"],
    segmentTransitions: transitions,
    canvas: "16:9",
    resolutionMegapixels: 0.98,
    advanced: {
      seed: 117117,
      seedPolicy: "fixed",
      samplingProfile: "quality_20",
    },
  };
}

function loadImages(workflow) {
  return workflow.nodes
    .filter((node) => node.type === "LoadImage")
    .map((node) => node.widgets_values_named?.image ?? node.widgets_values?.[0]);
}

function h3Calls(workflow) {
  return workflow.nodes.filter((node) => (
    node.type === "79dd8a95-ce9d-4c14-b264-2162e8bec5ce"
    || node.type === "4c314f31-ecda-4b08-ae98-faaba1bf613f"
    || node.type === "MiniMaxH3ReferenceToVideo"
  ));
}

test("Director T2V marks continuity_reference as record-only and cannot project a fake LoadImage", async () => {
  const projection = sourceSlice(
    "function buildDirectorAssetProjectionPlan",
    "function directorAssetProjectionSignature",
  );
  const prepare = sourceSlice(
    "async function prepareDirectorCompilationFrames",
    "function directorDraftWithContinuityPromptContexts",
  );
  const capture = sourceSlice(
    "function captureDirectorCompilation",
    "async function markDirectorCompiled",
  );
  const defaultPurpose = sourceSlice(
    "function defaultDirectorAssetPurpose",
    "function directorTransitionProjectionIssues",
  );

  assert.match(projection, /directorBindingProjectionDisposition\(mode, binding\.purpose\)[\s\S]*?if \(disposition === "record_only"\) continue;/u);
  assert.match(projection, /mode === "T2V"[\s\S]*?T2V 不接收素材输入/u);
  assert.match(defaultPurpose, /return "continuity_reference"/u);
  assert.match(prepare, /if \(mode === "T2V"\) return Object\.freeze\(\{ firstFrameSelectionId: null, lastFrameSelectionId: null \}\)/u);
  assert.match(capture, /firstFrameSelectionId:\s*mode === "T2V" \? null : preparedFrames\.firstFrameSelectionId/u);
  assert.match(capture, /lastFrameSelectionId:\s*mode === "T2V" \? null : preparedFrames\.lastFrameSelectionId/u);

  const workflow = (await compileProject(compilerProject())).workflows[0].workflow;
  assert.deepEqual(loadImages(workflow), []);
  assert.equal(h3Calls(workflow)[0].inputs.find((input) => input.name === "first_frame")?.link ?? null, null);
  assert.equal(h3Calls(workflow)[0].inputs.find((input) => input.name === "last_frame")?.link ?? null, null);
});

test("Director FL2VA uses only restricted prepared selection IDs and leaves Quick frame authority untouched", async () => {
  const projection = sourceSlice(
    "function buildDirectorAssetProjectionPlan",
    "function directorAssetProjectionSignature",
  );
  const prepare = sourceSlice(
    "async function prepareDirectorCompilationFrames",
    "function directorDraftWithContinuityPromptContexts",
  );
  const capture = sourceSlice(
    "function captureDirectorCompilation",
    "async function markDirectorCompiled",
  );

  assert.match(projection, /mode === "FL2VA"/u);
  assert.match(projection, /directorBindingProjectionDisposition\(mode, binding\.purpose\)/u);
  assert.match(projection, /binding\.purpose === "first_frame" \? firstShotId : lastShotId/u);
  assert.match(prepare, /window\.controlPlane\.prepareProjectAssetFrame\(\{/u);
  assert.match(prepare, /projectId:\s*input\.projectId/u);
  assert.match(prepare, /assetId:\s*entry\.asset\.assetId/u);
  assert.match(prepare, /return Object\.freeze\(\{[\s\S]*firstFrameSelectionId:\s*preparedFirst\?\.selectionId \?\? null,[\s\S]*lastFrameSelectionId:\s*preparedLast\?\.selectionId \?\? null/u);
  assert.doesNotMatch(prepare, /\.quick|firstFrameAssetId|lastFrameAssetId|saveRelayProject|persistRelayProject/u);
  assert.doesNotMatch(capture, /quick\.(?:firstFrameAssetId|lastFrameAssetId)/u);

  const firstOnly = (await compileProject(compilerProject({
    prompt: officialTimedPrompt(1),
    mode: "first_frame",
    endpoints: { first_frame: "minimax-h3-prepared-first.png" },
  }))).workflows[0].workflow;
  assert.deepEqual(loadImages(firstOnly), ["minimax-h3-prepared-first.png"]);
  const firstOnlyCall = h3Calls(firstOnly)[0];
  assert.equal(Number.isSafeInteger(firstOnlyCall.inputs.find((input) => input.name === "first_frame").link), true);
  assert.equal(firstOnlyCall.inputs.find((input) => input.name === "last_frame").link, null);

  const both = (await compileProject(compilerProject({
    prompt: officialTimedPrompt(1),
    mode: "first_last_frame",
    endpoints: {
      first_frame: "minimax-h3-prepared-first.png",
      last_frame: "minimax-h3-prepared-last.png",
    },
  }))).workflows[0].workflow;
  assert.deepEqual(loadImages(both), [
    "minimax-h3-prepared-first.png",
    "minimax-h3-prepared-last.png",
  ]);
});

test("Director Ref2VA maps one or two image references stably while video, audio, and motion stay record-only", async () => {
  const projection = sourceSlice(
    "function buildDirectorAssetProjectionPlan",
    "function directorAssetProjectionSignature",
  );
  assert.match(projection, /directorBindingProjectionDisposition\(mode, binding\.purpose\)/u);
  assert.match(projection, /referenceCandidates\.length > 2/u);
  assert.match(projection, /entry\.slot = index === 0 \? "first" : "last"/u);
  assert.match(projection, /if \(asset\.mediaType !== "image"\)[\s\S]*?必须绑定通过预检的图片素材/u);
  assert.match(projection, /binding\.purpose === "motion_reference"[\s\S]*?当前认证 Ref2VA 编译器不接入动作参考/u);
  assert.match(projection, /项目资料关系 · 不进入当前 H3 工作流/u);

  for (const images of [
    ["minimax-h3-ref-subject.png"],
    ["minimax-h3-ref-subject.png", "minimax-h3-ref-style.png"],
  ]) {
    const workflow = (await compileProject(compilerProject({
      prompt: officialReferencePrompt(),
      mode: "ref2va",
      endpoints: { reference_images: images },
      advanced: {
        seed: 117117,
        seed_policy: "fixed",
        sampling_profile: "quality_25",
      },
    }))).workflows[0].workflow;
    assert.deepEqual(loadImages(workflow), images);
    const call = h3Calls(workflow)[0];
    assert.equal(
      call.inputs.filter((input) => input.name.startsWith("ref_images.ref_image_") && input.link !== null).length,
      images.length,
    );
    assert.equal(JSON.stringify(workflow).includes("video_reference"), false);
    assert.equal(JSON.stringify(workflow).includes("audio_reference"), false);
    assert.equal(JSON.stringify(workflow).includes("motion_reference"), false);
  }
});

test("resolved Director start/end continuity survives official prompt serialization and H3 segmentation", async (context) => {
  const [{ createEmptyRelayProject, normalizeRelayProject }, director, consoleModule] = await Promise.all([
    loadTypeScriptModule(context, "src/shared/project-domain.ts"),
    loadTypeScriptModule(context, "src/renderer/professional-director.ts"),
    loadTypeScriptModule(context, "src/renderer/director-console.ts"),
  ]);
  let project = createEmptyRelayProject({
    projectId: "project-projection-continuity",
    name: "连续性投射项目",
    createdAt: "2026-09-03T00:00:00.000Z",
  });
  project = normalizeRelayProject({
    ...project,
    quick: {
      ...project.quick,
      originalPrompt: "快速创建私有提示词不得进入专业导播",
      totalDurationSeconds: 10,
      segmentDurationSeconds: 5,
    },
  });
  project = director.promoteQuickProjectToProfessional({
    project,
    updatedAt: "2026-09-03T00:00:01.000Z",
  });
  const ordered = director.orderedDirectorShots(project);
  const [firstShotId, secondShotId] = ordered.map(({ shot }) => shot.shotId);
  project = director.setProjectContinuityDefault(project, {
    field: "subject",
    value: "朱雀保持红色短发",
    updatedAt: "2026-09-03T00:00:02.000Z",
  });
  project = director.setDirectorStateOverride(project, {
    shotId: firstShotId,
    phase: "end",
    field: "heldProps",
    value: "右手持银色短刀",
    updatedAt: "2026-09-03T00:00:03.000Z",
  });
  project = director.setDirectorStateOverride(project, {
    shotId: secondShotId,
    phase: "start",
    field: "lighting",
    value: "红色轮廓光",
    updatedAt: "2026-09-03T00:00:04.000Z",
  });

  const contexts = director.serializeDirectorContinuityPromptContexts(project);
  assert.deepEqual(contexts.map((entry) => entry.shotId), [firstShotId, secondShotId]);
  assert.match(contexts[1].promptContext, /角色\/主体 \(subject\): 朱雀保持红色短发/u);
  assert.match(contexts[1].promptContext, /持有道具 \(held props\): 右手持银色短刀/u);
  assert.match(contexts[1].promptContext, /光线 \(lighting\): 红色轮廓光/u);
  assert.doesNotMatch(contexts[1].promptContext, /快速创建私有提示词/u);

  const promptResult = consoleModule.serializeDirectorPrompt({
    language: "zh",
    mode: "T2V",
    totalDurationSeconds: 10,
    segmentDurationSeconds: 5,
    continuity: "",
    shots: ordered.map(({ shot }, index) => ({
      id: shot.shotId,
      startSeconds: index * 5,
      durationSeconds: 5,
      description: [
        index === 0 ? "朱雀拔刀。" : "朱雀向前一步。",
        contexts[index].promptContext,
      ].join("\n\n"),
    })),
    overallSoundscape: "金属轻响。",
    nonDiegeticMusic: "",
    subjectDefinitions: "",
    summary: "",
    retentionAnalysis: "",
    styleOpening: "",
  });
  assert.deepEqual(promptResult.errors, []);
  assert.match(promptResult.prompt, /镜头 ID \/ Shot ID/u);

  const workflow = (await compileProject(compilerProject({
    prompt: promptResult.prompt,
    duration: 10,
    segment_durations: [5, 5],
    shot_ids: [firstShotId, secondShotId],
    transitions: ["hard_cut"],
  }))).workflows[0].workflow;
  const prompts = h3Calls(workflow).map((call) => call.widgets_values_named.prompt);
  assert.equal(prompts.some((prompt) => prompt.includes("朱雀保持红色短发")), true);
  assert.equal(prompts.some((prompt) => prompt.includes("右手持银色短刀")), true);
  assert.equal(prompts.some((prompt) => prompt.includes("红色轮廓光")), true);

  const rendererContinuity = sourceSlice(
    "function directorDraftWithContinuityPromptContexts",
    "function captureDirectorCompilation",
  );
  const rendererCapture = sourceSlice(
    "function captureDirectorCompilation",
    "async function markDirectorCompiled",
  );
  assert.match(rendererContinuity, /serializeDirectorContinuityPromptContexts\(project\)/u);
  assert.match(rendererContinuity, /description:\s*\[shot\.description\.trimEnd\(\), promptContext\]/u);
  assert.match(rendererCapture, /serializeDirectorPrompt\(compilationDraft\)/u);
});

test("ProjectSpec transitions cross the real adapter and produce distinct hard-cut versus tail-continuation DAGs", async (context) => {
  const { createAbCliAdapter } = await loadTypeScriptModule(
    context,
    "src/main/services/ab-cli-adapter.ts",
    { stubElectron: true },
  );
  const adapter = createAbCliAdapter({
    appPath: controlPlaneRoot,
    resourcesPath: repositoryRoot,
    isPackaged: false,
    enabled: true,
  });
  context.after(() => adapter.dispose());
  assert.equal(adapter.streamBAvailable, true);

  const [hardCut, tail] = await Promise.all([
    adapter.compileWorkflow({
      project: projectSpec(["hard_cut", "hard_cut"]),
      resolvedFrames: { first: null, last: null },
    }),
    adapter.compileWorkflow({
      project: projectSpec(["tail_frame_continuation", "tail_frame_continuation"]),
      resolvedFrames: { first: null, last: null },
    }),
  ]);
  assert.ok(hardCut);
  assert.ok(tail);
  assert.deepEqual(hardCut.extra.minimax_h3_tool.segment_plan.transitions, ["hard_cut", "hard_cut"]);
  assert.deepEqual(tail.extra.minimax_h3_tool.segment_plan.transitions, [
    "tail_frame_continuation",
    "tail_frame_continuation",
  ]);
  assert.equal(hardCut.nodes.filter((node) => node.type === "ImageFromBatch").length, 0);
  assert.equal(tail.nodes.filter((node) => node.type === "ImageFromBatch").length, 4);
  const hardSecond = h3Calls(hardCut).find((node) => /镜头 02/u.test(node.title));
  const tailSecond = h3Calls(tail).find((node) => /镜头 02/u.test(node.title));
  assert.equal(hardSecond.inputs.find((input) => input.name === "first_frame").link, null);
  assert.equal(Number.isSafeInteger(tailSecond.inputs.find((input) => input.name === "first_frame").link), true);
  assert.match(hardSecond.title, /硬切 · T2V/u);
  assert.match(tailSecond.title, /尾帧延续 · FL2VA 首帧/u);
});

test("real exported handoff JSON exposes complete official settings and truthful root titles", async (context) => {
  const { createAbCliAdapter } = await loadTypeScriptModule(
    context,
    "src/main/services/ab-cli-adapter.ts",
    { stubElectron: true },
  );
  const adapter = createAbCliAdapter({
    appPath: controlPlaneRoot,
    resourcesPath: repositoryRoot,
    isPackaged: false,
    enabled: true,
  });
  context.after(() => adapter.dispose());

  const workflow = await adapter.compileWorkflow({
    project: projectSpec(["hard_cut", "tail_frame_continuation"]),
    resolvedFrames: { first: null, last: null },
  });
  assert.ok(workflow);
  const settings = workflow.extra.minimax_h3_tool.official_settings;
  assert.deepEqual(settings.shot_seeds.map((entry) => entry.shot_id), projectSpec([]).segmentShotIds);
  assert.deepEqual(settings.shot_seeds.map((entry) => entry.seed), h3Calls(workflow).map((call) => (
    call.widgets_values_named.noise_seed
  )));
  assert.equal(settings.seed, 117117);
  assert.equal(settings.base_seed, 117117);
  assert.equal(settings.sampling_profile, "quality_20");
  assert.equal(settings.active_steps, 20);
  assert.equal(settings.turbo_enabled, false);
  assert.equal(settings.turbo_lora, null);
  assert.equal(settings.sampler, "res_multistep");
  assert.equal(settings.scheduler, "simple");
  assert.equal(settings.denoise, 1);
  assert.equal(settings.fps, 24);
  assert.equal(settings.native_audio, true);
  assert.deepEqual(settings.models, {
    unet: "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
    clip: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
    video_vae: "minimax_h3_video_vae_fp16.safetensors",
    audio_vae: "minimax_h3_audio_vae_fp32.safetensors",
  });
  const calls = h3Calls(workflow);
  assert.equal(calls.length, 3);
  calls.forEach((call, index) => {
    assert.match(call.title, new RegExp(`镜头 ${String(index + 1).padStart(2, "0")}`, "u"));
    assert.doesNotMatch(call.title, /种子|步/u);
    const shotSeed = settings.shot_seeds[index].seed;
    const seedNode = workflow.nodes.find((node) => (
      node.type === "PrimitiveInt"
      && node.title === `镜头 ${String(index + 1).padStart(2, "0")} 实际种子 · ${shotSeed}`
    ));
    assert.ok(seedNode);
    assert.equal(seedNode.widgets_values_named.value, shotSeed);
    assert.equal(seedNode.widgets_values_named.fixed, "fixed");
    const seedInput = call.inputs.find((input) => input.name === "noise_seed");
    assert.deepEqual(
      workflow.links.find((link) => Array.isArray(link) && link[0] === seedInput.link),
      [seedInput.link, seedNode.id, 0, call.id, call.inputs.indexOf(seedInput), "INT"],
    );
  });
  const samplingGroup = workflow.groups.find((group) => group.title.includes("标准 20 步"));
  assert.ok(samplingGroup);
  assert.equal(samplingGroup.title.includes("当前实际"), true);
  assert.equal(samplingGroup.title.includes("基础种子 117117"), true);
  const qualityStepsNode = workflow.nodes.find((node) => (
    node.type === "PrimitiveInt" && node.title === "质量步数 · 标准 20 步"
  ));
  assert.ok(qualityStepsNode, "the full-quality step count must be a real visible root node");
  assert.equal(qualityStepsNode.widgets_values_named.value, 20);
  assert.equal(qualityStepsNode.widgets_values_named.fixed, "fixed");
  calls.forEach((call) => {
    const qualityInput = call.inputs.find((input) => input.name === "quality_steps");
    assert.ok(qualityInput, "each certified call must expose the root quality boundary");
    assert.deepEqual(
      workflow.links.find((link) => Array.isArray(link) && link[0] === qualityInput.link),
      [qualityInput.link, qualityStepsNode.id, 0, call.id, call.inputs.indexOf(qualityInput), "INT"],
    );
  });
  const turboNode = workflow.nodes.find((node) => (
    node.type === "PrimitiveBoolean" && node.title?.startsWith("Turbo 加速")
  ));
  assert.ok(turboNode);
  assert.equal(turboNode.widgets_values_named.value, false);
  calls.forEach((call) => {
    const turboInput = call.inputs.find((input) => input.name === "value");
    assert.deepEqual(
      workflow.links.find((link) => Array.isArray(link) && link[0] === turboInput.link),
      [turboInput.link, turboNode.id, 0, call.id, call.inputs.indexOf(turboInput), "BOOLEAN"],
    );
  });
  assert.equal(workflow.extra.minimax_h3_tool.automatic_execution, false);
  assert.equal(workflow.extra.minimax_h3_tool.queue_submission, false);
});
