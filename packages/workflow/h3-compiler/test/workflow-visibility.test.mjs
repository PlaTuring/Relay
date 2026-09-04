import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  compileProject,
  createHandoffWorkflow,
  exportProject,
} from "../src/index.mjs";

const profileCases = Object.freeze([
  ["quality_20", "标准 20 步", false],
  ["quality_25", "高质量 25 步", false],
  ["turbo_8", "Turbo 8 步", true],
]);

function t2vProject({ profile = "quality_20", duration = 5, shotIds } = {}) {
  const shots = Array.from({ length: duration / 5 }, (_, index) => index === 0
    ? "[Shot 1] Live-action opening."
    : `[Shot ${index + 1}] At 00:${String(index * 5).padStart(2, "0")}.000, live-action continuation.`
  ).join("\n");
  return {
    schema_version: "1.0.0",
    prompt: duration === 5
      ? "USER_SUPPLIED_PROMPT"
      : `integrated_multimodal_description: ${shots}\n\noverall_soundscape: Stable room tone.\n\nnon_diegetic_music: N/A`,
    mode: "t2v",
    duration,
    segment_duration: 5,
    ...(shotIds === undefined ? {} : { shot_ids: shotIds }),
    canvas: "16:9",
    resolution_megapixels: 0.98,
    advanced: {
      seed: 424242,
      seed_policy: "fixed",
      sampling_profile: profile,
    },
  };
}

function ref2vaProject() {
  return {
    schema_version: "1.0.0",
    prompt: [
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
    ].join("\n"),
    mode: "ref2va",
    duration: 5,
    canvas: "16:9",
    resolution_megapixels: 0.98,
    endpoints: { reference_images: ["input/reference.png"] },
    advanced: {
      seed: 515151,
      seed_policy: "fixed",
      sampling_profile: "quality_25",
    },
  };
}

test("root controls show real 20/25/8 profile, mode, single-shot seed, and final resolution", async () => {
  for (const [profile, profileLabel, turboEnabled] of profileCases) {
    const compilation = await compileProject(t2vProject({ profile }));
    const workflow = compilation.workflows[0].workflow;
    const call = workflow.nodes.find((node) => node.id === 140);
    assert.match(call.title, /MiniMax H3 · 单镜 · 5 秒 · T2V/u);
    assert.doesNotMatch(call.title, /种子|步/u);
    assert.equal(call.widgets_values_named.noise_seed, 424242);
    assert.equal(call.widgets_values_named.value, turboEnabled);
    const seedNode = workflow.nodes.find((node) => node.type === "PrimitiveInt" && node.title?.startsWith("种子 ·"));
    const seedInput = call.inputs.find((input) => input.name === "noise_seed");
    assert.equal(seedNode.widgets_values_named.value, 424242);
    assert.equal(seedNode.widgets_values_named.fixed, "fixed");
    assert.equal(Number.isSafeInteger(seedInput.link), true);
    assert.deepEqual(
      workflow.links.find((link) => Array.isArray(link) && link[0] === seedInput.link),
      [seedInput.link, seedNode.id, 0, call.id, call.inputs.indexOf(seedInput), "INT"],
    );
    const samplingGroup = workflow.groups.find((group) => group.title.includes(profileLabel));
    assert.equal(samplingGroup.title.includes("当前实际"), true);
    assert.equal(samplingGroup.title.includes("基础种子 424242"), true);
    assert.equal(samplingGroup.title.includes("认证子图内固定"), false);
    const expectedQualitySteps = profile === "quality_25" ? 25 : 20;
    const qualityNode = workflow.nodes.find((node) => node.type === "PrimitiveInt"
      && node.title?.startsWith("质量步数 ·"));
    const qualityInput = call.inputs.find((input) => input.name === "quality_steps");
    assert.equal(qualityNode.widgets_values_named.value, expectedQualitySteps);
    assert.equal(call.widgets_values_named.quality_steps, expectedQualitySteps);
    assert.deepEqual(
      workflow.links.find((link) => Array.isArray(link) && link[0] === qualityInput.link),
      [qualityInput.link, qualityNode.id, 0, call.id, call.inputs.indexOf(qualityInput), "INT"],
    );
    const turboNode = workflow.nodes.find((node) => node.type === "PrimitiveBoolean" && node.title?.startsWith("Turbo 加速"));
    const turboInput = call.inputs.find((input) => input.name === "value");
    assert.equal(turboNode.widgets_values_named.value, turboEnabled);
    assert.deepEqual(
      workflow.links.find((link) => Array.isArray(link) && link[0] === turboInput.link),
      [turboInput.link, turboNode.id, 0, call.id, call.inputs.indexOf(turboInput), "BOOLEAN"],
    );
    const settings = createHandoffWorkflow(compilation).extra.minimax_h3_tool.official_settings;
    assert.equal(settings.sampling_profile, profile);
    assert.equal(settings.active_steps, Number(profile.match(/\d+/u)[0]));
    assert.equal(settings.turbo_enabled, turboEnabled);
    assert.equal(settings.turbo_lora === null, !turboEnabled);
    assert.equal(settings.turbo_steps, turboEnabled ? 8 : null);
    assert.equal(
      workflow.nodes.find((node) => node.type === "ResolutionSelector").title,
      "分辨率 · 1344×768 · 0.98 MP",
    );
  }
});

test("H3 subgraph keeps stable input names while exposing truthful media, seed, and Turbo labels", async () => {
  const workflow = (await compileProject(t2vProject())).workflows[0].workflow;
  const subgraph = workflow.definitions.subgraphs[0];
  const call = workflow.nodes.find((node) => node.id === 140);
  const expected = new Map([
    ["first_frame", "首帧（已连接时生效）"],
    ["last_frame", "尾帧（已连接时生效）"],
    ["prompt", "本镜提示词"],
    ["width", "最终宽度（由分辨率节点）"],
    ["height", "最终高度（由分辨率节点）"],
    ["value_1", "本镜时长（秒）"],
    ["noise_seed", "本镜实际种子"],
    ["unet_name", "H3 UNET（固定）"],
    ["clip_name", "文本编码器（固定）"],
    ["vae_name", "视频 VAE（固定）"],
    ["vae_name_1", "音频 VAE（固定）"],
    ["value", "Turbo 加速（开启时生效）"],
    ["lora_name", "Turbo LoRA（开启时生效）"],
    ["strength_model_1", "Turbo LoRA 强度（开启时生效）"],
    ["value_2", "Turbo 8 步（开启时生效）"],
    ["quality_steps", "质量步数（由根图采样节点）"],
  ]);
  for (const [name, label] of expected) {
    assert.equal(subgraph.inputs.find((input) => input.name === name)?.label, label);
    const callInput = call.inputs.find((input) => input.name === name);
    if (callInput) {
      const linkedLabel = name === "noise_seed"
        ? "本镜实际种子（由种子节点）"
        : name === "value"
          ? "Turbo 加速（由采样节点）"
          : name === "strength_model_1"
            ? "Turbo LoRA 强度（由采样节点）"
            : name === "value_2"
              ? "Turbo 步数（由采样节点）"
              : label;
      assert.equal(callInput.label, linkedLabel);
    }
  }
  assert.equal(call.widgets_values_named.value, false);
  assert.equal(call.widgets_values_named.quality_steps, 20);
  assert.match(subgraph.inputs.find((input) => input.name === "value_2").label, /开启时生效/u);
  const qualityBoundary = subgraph.inputs.find((input) => input.name === "quality_steps");
  const internalQualityLink = subgraph.links.find((link) => !Array.isArray(link)
    && link.id === qualityBoundary.linkIds[0]);
  const internalQualityNode = subgraph.nodes.find((node) => node.id === internalQualityLink.target_id);
  assert.deepEqual(
    internalQualityLink,
    {
      id: qualityBoundary.linkIds[0],
      origin_id: -10,
      origin_slot: subgraph.inputs.indexOf(qualityBoundary),
      target_id: internalQualityNode.id,
      target_slot: 0,
      type: "INT",
    },
  );
  assert.equal(internalQualityNode.widgets_values_named.value, 20);

  const i2v = await compileProject({
    ...t2vProject(),
    prompt: [
      "integrated_multimodal_description: [Shot 1] Live-action opening.",
      "",
      "overall_soundscape: Stable room tone.",
      "",
      "non_diegetic_music: N/A",
    ].join("\n"),
    mode: "first_last_frame",
    endpoints: { first_frame: "input/first.png", last_frame: "input/last.png" },
  });
  const i2vWorkflow = i2v.workflows[0].workflow;
  const i2vSubgraph = i2vWorkflow.definitions.subgraphs[0];
  const i2vCall = i2vWorkflow.nodes.find((node) => node.id === 105);
  assert.equal(i2vSubgraph.inputs.find((input) => input.name === "first_frame").label, "首帧（已连接时生效）");
  assert.equal(i2vSubgraph.inputs.find((input) => input.name === "last_frame").label, "尾帧（已连接时生效）");
  assert.equal(i2vCall.inputs.find((input) => input.name === "first_frame").label, "首帧（已连接时生效）");
  assert.equal(i2vCall.inputs.find((input) => input.name === "last_frame").label, "尾帧（已连接时生效）");
});

test("multi-shot root controls expose every deterministic shot seed and the shared base seed", async () => {
  const shotIds = ["shot-visible0001", "shot-visible0002", "shot-visible0003"];
  const compilation = await compileProject(t2vProject({
    duration: 15,
    shotIds,
    profile: "quality_25",
  }));
  const calls = compilation.workflows[0].workflow.nodes
    .filter((node) => node.type === "79dd8a95-ce9d-4c14-b264-2162e8bec5ce")
    .sort((left, right) => left.title.localeCompare(right.title));
  assert.equal(calls.length, 3);
  calls.forEach((call, index) => {
    const shot = compilation.seed_plan.shots[index];
    const modeLabel = index === 0 ? "T2V" : "FL2VA 首帧";
    assert.match(call.title, new RegExp(`镜头 ${String(index + 1).padStart(2, "0")}`, "u"));
    assert.match(call.title, new RegExp(`${modeLabel}$`, "u"));
    assert.doesNotMatch(call.title, /种子|步/u);
    assert.equal(call.widgets_values_named.noise_seed, shot.seed);
    const seedNode = compilation.workflows[0].workflow.nodes.find((node) => (
      node.type === "PrimitiveInt"
      && node.title === `镜头 ${String(index + 1).padStart(2, "0")} 实际种子 · ${shot.seed}`
    ));
    assert.equal(seedNode.widgets_values_named.value, shot.seed);
    const seedInput = call.inputs.find((input) => input.name === "noise_seed");
    assert.deepEqual(
      compilation.workflows[0].workflow.links.find((link) => Array.isArray(link) && link[0] === seedInput.link),
      [seedInput.link, seedNode.id, 0, call.id, call.inputs.indexOf(seedInput), "INT"],
    );
  });
  const samplingGroup = compilation.workflows[0].workflow.groups.find((group) => group.title.includes("高质量 25 步"));
  assert.equal(samplingGroup.title.includes("当前实际"), true);
  assert.equal(samplingGroup.title.includes("认证子图内固定"), false);
  assert.equal(samplingGroup.title.includes(`基础种子 ${compilation.seed_plan.base_seed}`), true);
  const qualityNode = compilation.workflows[0].workflow.nodes.find((node) => node.type === "PrimitiveInt"
    && node.title === "质量步数 · 高质量 25 步");
  assert.equal(qualityNode.widgets_values_named.value, 25);
  for (const call of calls) {
    const input = call.inputs.find((candidate) => candidate.name === "quality_steps");
    assert.equal(call.widgets_values_named.quality_steps, 25);
    assert.deepEqual(
      compilation.workflows[0].workflow.links.find((link) => Array.isArray(link) && link[0] === input.link),
      [input.link, qualityNode.id, 0, call.id, call.inputs.indexOf(input), "INT"],
    );
  }
});

test("Ref2VA root controls expose its actual quality profile, seed, and final resolution", async () => {
  const compilation = await compileProject(ref2vaProject());
  const workflow = compilation.workflows[0].workflow;
  const call = workflow.nodes.find((node) => node.type === "MiniMaxH3ReferenceToVideo");
  const noise = workflow.nodes.find((node) => node.type === "RandomNoise");
  assert.match(call.title, /Ref2VA$/u);
  assert.doesNotMatch(call.title, /种子|步/u);
  assert.equal(noise.widgets_values_named.noise_seed, 515151);
  assert.equal(noise.title, "种子 · 基础/本镜 515151");
  const steps = workflow.nodes.find((node) => node.id === 143);
  assert.equal(steps.title, "采样步数 · 高质量 25 步");
  assert.equal(steps.widgets_values_named.value, 25);
  assert.equal(
    workflow.groups.some((group) => group.title === "种子与采样 · 高质量 25 步 · Ref2VA 不支持 Turbo"),
    true,
  );
  assert.equal(
    workflow.nodes.find((node) => node.type === "ResolutionSelector").title,
    "分辨率 · 1344×768 · 0.98 MP",
  );
  const settings = createHandoffWorkflow(compilation).extra.minimax_h3_tool.official_settings;
  assert.equal(settings.mode, "ref2va");
  assert.equal(settings.sampling_profile, "quality_25");
  assert.equal(settings.active_steps, 25);
  assert.equal(settings.turbo_enabled, false);
  assert.equal(settings.turbo_lora, null);
  assert.deepEqual(settings.models, {
    unet: "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
    clip: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
    video_vae: "minimax_h3_video_vae_fp16.safetensors",
    audio_vae: "minimax_h3_audio_vae_fp32.safetensors",
  });
});

test("official settings form a complete read-only projection of hidden certified execution controls", async () => {
  const compilation = await compileProject(t2vProject({ profile: "quality_20" }));
  const settings = createHandoffWorkflow(compilation).extra.minimax_h3_tool.official_settings;
  assert.deepEqual(settings, {
    mode: "t2v",
    canvas: "16:9",
    resolution_megapixels: 0.98,
    resolved_width: 1344,
    resolved_height: 768,
    total_duration_seconds: 5,
    segment_durations_seconds: [5],
    seed: 424242,
    base_seed: 424242,
    seed_policy: "fixed",
    node_control_after_generate: "fixed",
    shot_seeds: [{ shot_id: null, ordinal: 1, seed: 424242 }],
    sampling_profile: "quality_20",
    active_steps: 20,
    turbo_enabled: false,
    turbo_lora: null,
    turbo_model_strength: null,
    turbo_steps: null,
    models: {
      unet: "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
      clip: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
      video_vae: "minimax_h3_video_vae_fp16.safetensors",
      audio_vae: "minimax_h3_audio_vae_fp32.safetensors",
    },
    sampler: "res_multistep",
    scheduler: "simple",
    denoise: 1,
    fps: 24,
    audio: "native_stereo_joint_generation",
    native_audio: true,
    guidance: "distilled_no_cfg_scale",
  });
});

test("exportProject writes the same authoritative official settings as visible handoff", async () => {
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "h3-visible-export-"));
  const project = t2vProject({
    duration: 15,
    shotIds: ["shot-export0001", "shot-export0002", "shot-export0003"],
    profile: "quality_25",
  });
  try {
    const expectedCompilation = await compileProject(project);
    const expectedWorkflow = createHandoffWorkflow(expectedCompilation);
    const result = await exportProject({ project, outputDirectory });
    const exportedWorkflow = JSON.parse(await readFile(result.exported[0].workflow_path, "utf8"));
    assert.deepEqual(
      exportedWorkflow.extra.minimax_h3_tool.official_settings,
      expectedWorkflow.extra.minimax_h3_tool.official_settings,
    );
    assert.deepEqual(exportedWorkflow.extra.relay_seed, expectedWorkflow.extra.relay_seed);
    assert.equal(exportedWorkflow.extra.minimax_h3_tool.official_settings.active_steps, 25);
    assert.equal(exportedWorkflow.extra.minimax_h3_tool.official_settings.shot_seeds.length, 3);
    assert.equal(exportedWorkflow.extra.minimax_h3_tool.queue_submission, false);
    assert.equal(exportedWorkflow.extra.minimax_h3_tool.automatic_execution, false);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});
