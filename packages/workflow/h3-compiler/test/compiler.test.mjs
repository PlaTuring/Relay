import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path, { dirname } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { compileProject, exportProject, h3FrameCount, resolveCanvasSize, verifyVendoredTemplates } from "../src/index.mjs";
import { main as compilerCliMain } from "../bin/h3-compiler.mjs";

const packageRoot = path.resolve(dirname(fileURLToPath(import.meta.url)), "..");

const base = Object.freeze({
  schema_version: "1.0.0",
  prompt: "USER_SUPPLIED_PROMPT",
  duration: 5,
  canvas: "16:9",
  resolution_megapixels: 0.98,
});

function officialTimedPrompt(duration) {
  const shots = Array.from({ length: duration / 5 }, (_, index) => index === 0
    ? "[Shot 1] Live-action, cinematic. The first local segment begins."
    : `[Shot ${index + 1}] At 00:${String(index * 5).padStart(2, "0")}.000, the next local segment begins.`
  ).join("\n");
  return `integrated_multimodal_description: ${shots}\n\noverall_soundscape: Stable room tone continues.\n\nnon_diegetic_music: N/A`;
}

function officialReferencePrompt(duration) {
  return `subject_definitions:\n<Subject 1> is the subject in <Picture 1>.\n\nsummary:\n[reference generation] The target video preserves <Subject 1>.\n\nretention_analysis:\n<Subject 1>: fully_preserved - identity remains consistent.\n\ndetailed_description:\nThe target video uses a live-action cinematic style.\n${officialTimedPrompt(duration).match(/integrated_multimodal_description: ([\s\S]*?)\n\noverall_soundscape:/u)[1]}\n\noverall_soundscape:\nStable room tone continues.\n\nnon_diegetic_music:\nN/A`;
}

test("pinned templates, legal frames, and four endpoint modes compile", async () => {
  const templates = await verifyVendoredTemplates();
  assert.deepEqual(templates.map((entry) => [entry.kind, entry.bytes]), [["t2v", 67891], ["i2v", 71242], ["r2v", 45121]]);
  assert.deepEqual([5, 10, 15].map(h3FrameCount), [124, 243, 362]);
  const cases = [
    { mode: "t2v" },
    { mode: "first_frame", endpoints: { first_frame: "input/first.png" } },
    { mode: "last_frame", endpoints: { last_frame: "input/last.png" } },
    { mode: "first_last_frame", endpoints: { first_frame: "input/first.png", last_frame: "input/last.png" } },
  ];
  for (const entry of cases) {
    const prompt = entry.mode === "t2v" ? base.prompt : officialTimedPrompt(5);
    const result = await compileProject({ ...base, prompt, ...entry });
    assert.equal(result.workflows.length, 1);
    assert.equal(result.workflows[0].lint.ok, true);
    assert.equal(result.workflows[0].workflow.version, 0.4);
    assert.equal(result.workflows[0].workflow.nodes.some((node) => node.type === "ResolutionSelector"), true);
    assert.equal(result.workflows[0].workflow.nodes.some((node) => node.type === "MarkdownNote"), false);
    assert.deepEqual(result.workflows[0].workflow.nodes.find((node) => node.type === "SaveVideo").size, [380, 150]);
    assert.equal(
      JSON.stringify(result.workflows[0].workflow).includes(
        entry.mode === "t2v" ? "USER_SUPPLIED_PROMPT" : "integrated_multimodal_description",
      ),
      true,
    );
  }
});

test("Ref2VA compiles one or two reference images through the pinned official R2V template", async () => {
  for (const referenceImages of [
    ["input/reference-1.png"],
    ["input/reference-1.png", "input/reference-2.png"],
  ]) {
    const result = await compileProject({
      ...base,
      prompt: officialReferencePrompt(5),
      mode: "ref2va",
      endpoints: { reference_images: referenceImages },
    });
    assert.equal(result.workflows.length, 1);
    const entry = result.workflows[0];
    assert.equal(entry.template.path, "templates/video_minimax_h3_r2v.json");
    assert.equal(entry.template.sha256, "14b30659a057547e02bdd4bbbdda3f8670aa6d7d81d1d8d99c4f9ad1e2eabc44");
    assert.equal(entry.lint.template_kind, "r2v");
    assert.equal(entry.lint.static_lint.pinned_h3_class_type, "MiniMaxH3ReferenceToVideo");
    const workflow = entry.workflow;
    assert.equal(workflow.nodes.some((node) => node.type === "ResolutionSelector"), true);
    assert.equal(workflow.nodes.some((node) => node.type === "MarkdownNote"), false);
    const call = workflow.nodes.find((node) => node.type === "MiniMaxH3ReferenceToVideo");
    assert.equal(call.widgets_values_named.prompt.includes("subject_definitions:"), true);
    assert.equal(call.widgets_values_named.prompt.includes("detailed_description:"), true);
    assert.equal(call.widgets_values_named.width, 1344);
    assert.equal(call.widgets_values_named.height, 768);
    assert.equal(call.widgets_values_named.length, 124);
    assert.equal(call.widgets_values_named.ref_image_size, "match");
    assert.equal(call.inputs.filter((input) => (
      input.name.startsWith("ref_images.ref_image_") && input.link !== null
    )).length, referenceImages.length);
    assert.deepEqual(
      workflow.nodes.filter((node) => node.type === "LoadImage").map((node) => node.widgets_values_named.image),
      referenceImages,
    );
    assert.equal(workflow.nodes.some((node) => node.type === "LoraLoaderModelOnly"), false);
    assert.equal(workflow.nodes.some((node) => node.type === "ComfySwitchNode"), false);
    assert.equal(workflow.nodes.some((node) => node.type === "PrimitiveBoolean"), false);
    assert.equal(JSON.stringify(workflow).includes("minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors"), false);
    assert.deepEqual(
      workflow.links.find((link) => Array.isArray(link) && link[0] === 288),
      [288, 127, 0, 126, 0, "MODEL"],
    );
    assert.deepEqual(
      workflow.links.find((link) => Array.isArray(link) && link[0] === 289),
      [289, 143, 0, 124, 1, "INT"],
    );
    assert.deepEqual(workflow.nodes.find((node) => node.id === 127).outputs[0].links, [252, 288]);
    assert.deepEqual(workflow.nodes.find((node) => node.id === 143).outputs[0].links, [289]);
    assert.equal(workflow.nodes.find((node) => node.id === 126).inputs[0].link, 288);
    assert.equal(workflow.nodes.find((node) => node.id === 124).inputs[1].link, 289);
    assert.equal(JSON.stringify(workflow).includes("red_superboy_on_city_roof.png"), false);
    assert.equal(JSON.stringify(workflow).includes("mecha_dragon_lightning.png"), false);
  }

  const long = await compileProject({
    ...base,
    prompt: officialReferencePrompt(30),
    mode: "ref2va",
    duration: 30,
    endpoints: { reference_images: ["input/reference.png"] },
  });
  assert.equal(long.plan.status, "experimental_blocked");
  assert.equal(long.plan.segment_count, 6);
  assert.equal(long.workflows.length, 1);
  assert.equal(long.workflows[0].segment.mode, "ref2va");
  assert.equal(long.plan.segments.slice(1).every((segment) => segment.workflow_status === "blocked"), true);
  const { createHandoffWorkflow } = await import("../src/index.mjs");
  assert.throws(
    () => createHandoffWorkflow(long),
    (error) => error?.code === "HANDOFF.BLOCKED_SEGMENT_PLAN",
  );
  const blockedExportRoot = await mkdtemp(path.join(os.tmpdir(), "h3-ref2va-blocked-export-"));
  try {
    await assert.rejects(
      () => exportProject({
        project: {
          ...base,
          prompt: officialReferencePrompt(30),
          mode: "ref2va",
          duration: 30,
          endpoints: { reference_images: ["input/reference.png"] },
        },
        outputDirectory: blockedExportRoot,
      }),
      (error) => error?.code === "HANDOFF.BLOCKED_SEGMENT_PLAN",
    );
    assert.deepEqual(await (await import("node:fs/promises")).readdir(blockedExportRoot), []);
  } finally {
    await rm(blockedExportRoot, { recursive: true, force: true });
  }
});

test("Ref2VA image-reference contract rejects missing, extra, endpoint, and turbo_8 inputs", async () => {
  const invalid = [
    { endpoints: { reference_images: [] } },
    { endpoints: { reference_images: ["input/1.png", "input/2.png", "input/3.png"] } },
    { endpoints: { first_frame: "input/not-a-reference-contract.png" } },
    {
      endpoints: { reference_images: ["input/reference.png"] },
      advanced: { seed: 1, seed_policy: "fixed", sampling_profile: "turbo_8" },
    },
  ];
  for (const extra of invalid) {
    await assert.rejects(() => compileProject({ ...base, mode: "ref2va", ...extra }));
  }
});

test("30/60 plans compile explicit Experimental single-workflow core DAGs without submission", async () => {
  for (const duration of [30, 60]) {
    for (const segmentDuration of [5, 10, 15]) {
      const result = await compileProject({
        ...base,
        prompt: officialTimedPrompt(duration),
        mode: "t2v",
        duration,
        segment_duration: segmentDuration,
      });
      assert.equal(result.plan.status, "experimental_export_ready");
      assert.equal(result.plan.warning_code, "EXPERIMENTAL_H3_SUBGRAPH_TAIL_FRAME_CHAIN");
      assert.equal(result.plan.segment_count, duration / segmentDuration);
      assert.equal(result.plan.emitted_segment_count, duration / segmentDuration);
      assert.equal(result.plan.single_workflow_dag, true);
      assert.equal(result.plan.assembly_after_manual_run, true);
      assert.equal(result.plan.segments.every((entry) => entry.workflow_status === "included_in_single_workflow"), true);
      assert.deepEqual(
        result.plan.segments.map((entry) => entry.name),
        Array.from({ length: duration / segmentDuration }, (_, index) => (
          `segment-${String(index + 1).padStart(2, "0")}-of-${String(duration / segmentDuration).padStart(2, "0")}`
        )),
      );
      assert.equal(result.plan.segments.every((entry) => entry.planned_workflow_file === "minimax-h3.workflow.json"), true);
      assert.equal(result.plan.segments.every((entry) => entry.planned_output_prefix === null), true);
      assert.equal(result.workflows.length, 1);
      assert.deepEqual(result.workflows[0].included_segments, result.plan.segments.map((entry) => entry.index));
      const workflow = result.workflows[0].workflow;
      const callType = result.workflows[0].template.path.includes("t2v")
        ? "79dd8a95-ce9d-4c14-b264-2162e8bec5ce"
        : "4c314f31-ecda-4b08-ae98-faaba1bf613f";
      assert.equal(workflow.nodes.filter((node) => node.type === callType).length, duration / segmentDuration);
      assert.equal(workflow.nodes.filter((node) => node.type === "GetVideoComponents").length, duration / segmentDuration);
      assert.deepEqual(
        workflow.nodes.find((node) => node.type === "GetVideoComponents").outputs.map(({ name, type }) => ({ name, type })),
        [
          { name: "images", type: "IMAGE" },
          { name: "audio", type: "AUDIO" },
          { name: "fps", type: "FLOAT" },
          { name: "bit_depth", type: "COMBO" },
          { name: "color_space", type: "COMBO" },
        ],
      );
      assert.equal(workflow.nodes.find((node) => node.type === "GetVideoComponents").properties.ver, "0.34.0");
      assert.equal(workflow.nodes.filter((node) => node.type === "ImageFromBatch").length, (duration / segmentDuration - 1) * 2);
      assert.equal(workflow.nodes.filter((node) => node.type === "BatchImagesNode").length, duration / segmentDuration - 1);
      assert.deepEqual(
        workflow.nodes.find((node) => node.type === "BatchImagesNode").inputs.map((input) => input.name),
        ["images.image0", "images.image1", "images.image2"],
      );
      assert.equal(workflow.nodes.filter((node) => node.type === "AudioConcat").length, duration / segmentDuration - 1);
      assert.equal(workflow.nodes.filter((node) => node.type === "CreateVideo").length, 1);
      assert.deepEqual(workflow.nodes.find((node) => node.type === "CreateVideo").widgets_values, [24, 8, "sRGB"]);
      const trim = workflow.nodes.find((node) => node.type === "Video Slice");
      assert.deepEqual(trim.widgets_values, [0, duration, true]);
      const save = workflow.nodes.find((node) => node.type === "SaveVideo");
      assert.deepEqual(save.size, [380, 150]);
      assert.equal(save.widgets_values_named.filename_prefix, "video/MiniMax_H3");
      assert.equal(workflow.nodes.some((node) => node.type === "MarkdownNote"), false);
      assert.equal(result.workflows[0].lint.experimental_long_dag, true);
      assert.equal(result.plan.automatic_execution, false);
      assert.equal(result.plan.automatic_assembly, false);
    }
  }
});

test("long FL2VA modes bind user endpoints only at graph edges and chain official final frames", async () => {
  const cases = [
    ["first_frame", { first_frame: "input/first.png" }, true, false],
    ["last_frame", { last_frame: "input/last.png" }, false, true],
    ["first_last_frame", { first_frame: "input/first.png", last_frame: "input/last.png" }, true, true],
  ];
  for (const [mode, endpoints, hasFirst, hasLast] of cases) {
    const result = await compileProject({
      ...base,
      prompt: officialTimedPrompt(30),
      mode,
      endpoints,
      duration: 30,
      segment_duration: 5,
    });
    assert.equal(result.plan.status, "experimental_export_ready");
    assert.equal(result.plan.segment_count, 6);
    assert.deepEqual(
      result.plan.segments.map((segment) => segment.mode),
      mode === "first_frame"
        ? ["first_frame", "first_frame", "first_frame", "first_frame", "first_frame", "first_frame"]
        : mode === "last_frame"
          ? ["t2v", "first_frame", "first_frame", "first_frame", "first_frame", "first_last_frame"]
          : ["first_frame", "first_frame", "first_frame", "first_frame", "first_frame", "first_last_frame"],
    );
    const workflow = result.workflows[0].workflow;
    const calls = workflow.nodes
      .filter((node) => node.type === "4c314f31-ecda-4b08-ae98-faaba1bf613f")
      .sort((left, right) => left.title.localeCompare(right.title));
    assert.equal(Number.isSafeInteger(calls[0].inputs.find((input) => input.name === "first_frame").link), hasFirst);
    assert.equal(Number.isSafeInteger(calls.at(-1).inputs.find((input) => input.name === "last_frame").link), hasLast);
    assert.equal(calls.slice(1).every((call) => Number.isSafeInteger(
      call.inputs.find((input) => input.name === "first_frame").link,
    )), true);
    assert.equal(workflow.nodes.filter((node) => node.type === "LoadImage").length, hasFirst && hasLast ? 2 : 1);
  }
});

test("segment_duration defaults to five and rejects values outside 5/10/15", async () => {
  const defaults = await compileProject({
    ...base,
    prompt: officialTimedPrompt(30),
    mode: "t2v",
    duration: 30,
  });
  assert.equal(defaults.project.segment_duration, 5);
  assert.equal(defaults.plan.segment_count, 6);
  for (const segmentDuration of [0, 6, 20, "5"]) {
    await assert.rejects(() => compileProject({
      ...base,
      mode: "t2v",
      duration: 30,
      segment_duration: segmentDuration,
    }));
  }
});

test("canvas aspect and ResolutionSelector megapixels are independent closed fields", async () => {
  const defaults = await compileProject({
    schema_version: "1.0.0",
    prompt: "DEFAULT_CANVAS_TEST",
    mode: "t2v",
    duration: 5,
  });
  assert.equal(defaults.project.canvas, "9:16");
  assert.equal(defaults.project.resolution_megapixels, 0.98);

  const continuousOfficialRange = await compileProject({
    ...base,
    mode: "t2v",
    canvas: "9:16",
    resolution_megapixels: 0.41,
  });
  assert.deepEqual(
    continuousOfficialRange.workflows[0].workflow.nodes.find((node) => node.type === "ResolutionSelector").widgets_values,
    ["9:16 (Portrait Widescreen)", 0.41, 32],
  );

  for (const extra of [
    { canvas: "768x1344" },
    { canvas: "5:4" },
    { resolution_megapixels: 0.09 },
    { resolution_megapixels: 16.01 },
    { resolution_megapixels: Number.NaN },
    { resolution_megapixels: "0.98" },
  ]) {
    await assert.rejects(() => compileProject({ ...base, mode: "t2v", ...extra }));
  }
});

test("audited canvas presets and pinned advanced settings bind real official widgets", async () => {
  const canvases = new Map([
    ["21:9", "21:9 (Ultrawide)"],
    ["16:9", "16:9 (Widescreen)"],
    ["3:2", "3:2 (Photo)"],
    ["4:3", "4:3 (Standard)"],
    ["1:1", "1:1 (Square)"],
    ["3:4", "3:4 (Portrait Standard)"],
    ["2:3", "2:3 (Portrait Photo)"],
    ["9:16", "9:16 (Portrait Widescreen)"],
  ]);
  for (const [canvas, selectorAspect] of canvases) {
    const result = await compileProject({ ...base, mode: "t2v", canvas });
    const { width, height } = resolveCanvasSize(canvas, base.resolution_megapixels);
    const workflow = result.workflows[0].workflow;
    const subgraph = workflow.definitions.subgraphs[0];
    const h3 = subgraph.nodes.find((node) => node.type === "MiniMaxH3ImageToVideo");
    assert.equal(h3.widgets_values_named.width, width);
    assert.equal(h3.widgets_values_named.height, height);
    const selector = workflow.nodes.find((node) => node.type === "ResolutionSelector");
    assert.deepEqual(selector.widgets_values, [selectorAspect, base.resolution_megapixels, 32]);
    assert.deepEqual(selector.widgets_values_named, {
      aspect_ratio: selectorAspect,
      megapixels: base.resolution_megapixels,
      multiple: 32,
    });
    const call = workflow.nodes.find((node) => node.id === 140);
    assert.equal(call.inputs.find((input) => input.name === "width").link, 246);
    assert.equal(call.inputs.find((input) => input.name === "height").link, 247);
    assert.deepEqual(selector.outputs.map((output) => output.links), [[246], [247]]);
  }

  const portrait04 = await compileProject({ ...base, mode: "t2v", canvas: "9:16", resolution_megapixels: 0.4 });
  const portrait098 = await compileProject({ ...base, mode: "t2v", canvas: "9:16", resolution_megapixels: 0.98 });
  const portrait04Workflow = portrait04.workflows[0].workflow;
  const portrait098Workflow = portrait098.workflows[0].workflow;
  assert.deepEqual(
    portrait04Workflow.nodes.find((node) => node.type === "ResolutionSelector").widgets_values,
    ["9:16 (Portrait Widescreen)", 0.4, 32],
  );
  assert.deepEqual(
    portrait098Workflow.nodes.find((node) => node.type === "ResolutionSelector").widgets_values,
    ["9:16 (Portrait Widescreen)", 0.98, 32],
  );
  const portrait04Call = portrait04Workflow.nodes.find((node) => node.id === 140);
  const portrait098Call = portrait098Workflow.nodes.find((node) => node.id === 140);
  assert.deepEqual(
    [portrait04Call.widgets_values_named.width, portrait04Call.widgets_values_named.height],
    [480, 864],
  );
  assert.deepEqual(
    [portrait098Call.widgets_values_named.width, portrait098Call.widgets_values_named.height],
    [768, 1344],
  );

  const result = await compileProject({
    ...base,
    mode: "t2v",
    advanced: {
      seed: 424242,
      seed_policy: "random_per_compile",
      sampling_profile: "turbo_8",
    },
  }, { generateBaseSeed: () => 424242 });
  const workflow = result.workflows[0].workflow;
  const call = workflow.nodes.find((node) => node.id === 140);
  const subgraph = workflow.definitions.subgraphs[0];
  const noise = subgraph.nodes.find((node) => node.type === "RandomNoise");
  assert.equal(call.widgets_values_named.noise_seed, 424242);
  assert.equal(call.widgets_values_named.value, true);
  assert.equal(call.widgets_values_named.strength_model_1, 1);
  assert.equal(call.widgets_values_named.value_2, 8);
  assert.deepEqual(noise.widgets_values, [424242, "fixed"]);

  const handoff = (await import("../src/index.mjs")).createHandoffWorkflow(result);
  assert.deepEqual(handoff.extra.minimax_h3_tool.official_settings, {
    mode: "t2v",
    canvas: "16:9",
    resolution_megapixels: 0.98,
    resolved_width: 1344,
    resolved_height: 768,
    total_duration_seconds: 5,
    segment_durations_seconds: [5],
    seed: 424242,
    base_seed: 424242,
    seed_policy: "random_per_compile",
    node_control_after_generate: "fixed",
    shot_seeds: [{ shot_id: null, ordinal: 1, seed: 424242 }],
    sampling_profile: "turbo_8",
    active_steps: 8,
    turbo_enabled: true,
    turbo_lora: "minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors",
    turbo_model_strength: 1,
    turbo_steps: 8,
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

test("advanced contract fails closed for invented or unsafe controls", async () => {
  const invalid = [
    { advanced: { seed: -1, seed_policy: "fixed", sampling_profile: "quality_20" } },
    { advanced: { seed: 1.5, seed_policy: "fixed", sampling_profile: "quality_20" } },
    { advanced: { seed: 1, seed_policy: "increment", sampling_profile: "quality_20" } },
    { advanced: { seed: 1, seed_policy: "fixed", sampling_profile: "custom_steps" } },
    { advanced: { seed: 1, seed_policy: "fixed", sampling_profile: "quality_20", cfg: 7 } },
    { negative_prompt: "not supported" },
  ];
  for (const extra of invalid) {
    await assert.rejects(() => compileProject({ ...base, mode: "t2v", ...extra }));
  }

  const defaults = await compileProject({ ...base, mode: "t2v" });
  assert.deepEqual(defaults.project.advanced, {
    seed: 1,
    seed_policy: "random_per_compile",
    sampling_profile: "quality_20",
  });
});

test("library export and argv-array CLI emit loadable workflow JSON", async () => {
  const first = await mkdtemp(path.join(os.tmpdir(), "h3-compiler-library-"));
  const second = await mkdtemp(path.join(os.tmpdir(), "h3-compiler-cli-"));
  try {
    const result = await exportProject({ project: { ...base, mode: "t2v" }, outputDirectory: first });
    assert.equal(result.handoff.capability, "EXPORT_ONLY");
    assert.equal(result.handoff.automatic_submission, false);
    const workflow = JSON.parse(await readFile(result.exported[0].workflow_path, "utf8"));
    assert.equal(workflow.version, 0.4);

    const referenceResult = await exportProject({
      project: {
        ...base,
        prompt: officialReferencePrompt(5),
        mode: "ref2va",
        endpoints: { reference_images: ["input/reference.png"] },
      },
      outputDirectory: second,
    });
    assert.equal(referenceResult.exported[0].template_path, "templates/video_minimax_h3_r2v.json");
    const referenceWorkflow = JSON.parse(await readFile(referenceResult.exported[0].workflow_path, "utf8"));
    assert.equal(referenceWorkflow.nodes.some((node) => node.type === "MiniMaxH3ReferenceToVideo"), true);

    const request = JSON.stringify({ ...base, prompt: officialTimedPrompt(5), mode: "first_last_frame", endpoints: {
      first_frame: "input/first.png",
      last_frame: "input/last.png",
    } });
    const cli = spawnSync(process.execPath, [
      path.resolve(packageRoot, "bin/h3-compiler.mjs"),
      "compile",
      "--request",
      "-",
    ], { cwd: packageRoot, encoding: "utf8", input: request, shell: false });
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(cli.stderr, "");
    const response = JSON.parse(cli.stdout);
    assert.equal(response.ok, true);
    assert.deepEqual(Object.keys(response.result), ["workflow"]);
    assert.equal(response.result.workflow.version, 0.4);
    assert.equal(response.result.workflow.extra.minimax_h3_tool.queue_submission, false);
  } finally {
    await rm(first, { recursive: true, force: true });
    await rm(second, { recursive: true, force: true });
  }
});

test("long export writes one editable DAG plus an explicit Experimental segment plan", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "h3-compiler-long-export-"));
  try {
    const result = await exportProject({
      project: {
        ...base,
        prompt: officialTimedPrompt(30),
        mode: "t2v",
        duration: 30,
        segment_duration: 5,
      },
      outputDirectory: temporaryRoot,
    });
    assert.equal(result.status, "experimental_export_ready");
    assert.deepEqual(result.exported.map((entry) => entry.file_name), ["minimax-h3.workflow.json"]);
    assert.deepEqual(result.exported[0].included_segments, [1, 2, 3, 4, 5, 6]);
    assert.equal(result.segment_plan.file_name, "minimax-h3.segment-plan.json");
    const plan = JSON.parse(await readFile(result.segment_plan.path, "utf8"));
    assert.equal(plan.experimental, true);
    assert.equal(plan.single_workflow_dag, true);
    assert.equal(plan.emitted_workflow_count, 1);
    assert.equal(plan.emitted_segment_count, 6);
    assert.equal(plan.automatic_execution, false);
    assert.equal(plan.automatic_assembly, false);
    assert.equal(plan.assembly_after_manual_run, true);
    assert.equal(plan.segments.every((segment) => segment.planned_workflow_file === "minimax-h3.workflow.json"), true);
    const workflow = JSON.parse(await readFile(result.exported[0].workflow_path, "utf8"));
    assert.equal(workflow.nodes.filter((node) => node.type === "SaveVideo").length, 1);
    assert.equal(workflow.nodes.filter((node) => node.type === "Video Slice").length, 1);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("closed CLI main API supports fixed project and output arguments without process argv", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "h3-compiler-main-"));
  const projectPath = path.join(temporaryRoot, "project.json");
  const outputDirectory = path.join(temporaryRoot, "output");
  const stdout = [];
  const stderr = [];
  try {
    await mkdir(outputDirectory);
    await writeFile(projectPath, `${JSON.stringify({ ...base, mode: "t2v" })}\n`, "utf8");
    const exitCode = await compilerCliMain(
      ["compile", "--project", projectPath, "--output-dir", outputDirectory],
      {
        stdin: process.stdin,
        stdout: { write: (value) => stdout.push(String(value)) },
        stderr: { write: (value) => stderr.push(String(value)) },
      },
    );
    assert.equal(exitCode, 0);
    assert.equal(stderr.join(""), "");
    const response = JSON.parse(stdout.join(""));
    assert.equal(response.ok, true);
    assert.equal(response.handoff.automatic_submission, false);
    const workflow = JSON.parse(await readFile(response.exported[0].workflow_path, "utf8"));
    assert.equal(workflow.version, 0.4);
    assert.equal(JSON.stringify(workflow).includes('"/prompt"'), false);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
