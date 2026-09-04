import assert from "node:assert/strict";
import test from "node:test";

import {
  compileProject,
  createHandoffWorkflow,
  SAMPLING_PROFILES,
  SAMPLING_PROFILE_STEPS,
} from "../src/index.mjs";

function advanced(samplingProfile) {
  return {
    seed: 424242,
    seed_policy: "fixed",
    sampling_profile: samplingProfile,
  };
}

function baseProject(samplingProfile) {
  return {
    schema_version: "1.0.0",
    prompt: "USER_SUPPLIED_PROMPT",
    mode: "t2v",
    duration: 5,
    canvas: "16:9",
    resolution_megapixels: 0.98,
    advanced: advanced(samplingProfile),
  };
}

function fullQualitySteps(workflow) {
  const graph = workflow.definitions?.subgraphs?.[0] ?? workflow;
  const matches = graph.nodes.filter((node) => node.type === "PrimitiveInt"
    && node.widgets_values_named?.fixed === "fixed"
    && [20, 25].includes(node.widgets_values_named?.value));
  assert.equal(matches.length, 1);
  return matches[0].widgets_values_named.value;
}

test("sampling profiles expose pinned 20, 25, and Turbo step counts", async () => {
  assert.deepEqual(SAMPLING_PROFILES, ["quality_20", "quality_25", "turbo_8"]);
  assert.deepEqual(SAMPLING_PROFILE_STEPS, { quality_20: 20, quality_25: 25, turbo_8: 8 });

  for (const [profile, activeSteps, fullSteps, turbo] of [
    ["quality_20", 20, 20, false],
    ["quality_25", 25, 25, false],
    ["turbo_8", 8, 20, true],
  ]) {
    const compilation = await compileProject(baseProject(profile));
    const workflow = compilation.workflows[0].workflow;
    const call = workflow.nodes.find((node) => node.id === 140);
    assert.equal(call.widgets_values_named.value, turbo);
    assert.equal(fullQualitySteps(workflow), fullSteps);
    const handoff = createHandoffWorkflow(compilation);
    assert.equal(handoff.extra.minimax_h3_tool.official_settings.sampling_profile, profile);
    assert.equal(handoff.extra.minimax_h3_tool.official_settings.active_steps, activeSteps);
  }
});

test("quality_25 binds the pinned Ref2VA full-quality branch while Turbo remains rejected", async () => {
  const project = {
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
    advanced: advanced("quality_25"),
  };
  const compilation = await compileProject(project);
  assert.equal(fullQualitySteps(compilation.workflows[0].workflow), 25);
  assert.equal(createHandoffWorkflow(compilation).extra.minimax_h3_tool.official_settings.active_steps, 25);

  await assert.rejects(
    compileProject({ ...project, advanced: advanced("turbo_8") }),
    (error) => error?.code === "PROJECT.SAMPLING_PROFILE_MODE",
  );
});

test("handoff keeps the structured seed resolution available for UI display", async () => {
  const compilation = await compileProject({
    ...baseProject("quality_25"),
    prompt: [
      "integrated_multimodal_description: [Shot 1] Live-action opening.",
      "[Shot 2] At 00:05.000, live-action continuation.",
      "[Shot 3] At 00:10.000, live-action continuation.",
      "",
      "overall_soundscape: Stable room tone.",
      "",
      "non_diegetic_music: N/A",
    ].join("\n"),
    duration: 15,
    segment_duration: 5,
    shot_ids: ["shot-alpha0001", "shot-alpha0002", "shot-alpha0003"],
  });
  const handoff = createHandoffWorkflow(compilation);
  assert.deepEqual(handoff.extra.relay_seed, compilation.seed_plan);
  assert.equal(handoff.extra.relay_seed.base_seed, 424242);
  assert.deepEqual(
    handoff.extra.minimax_h3_tool.official_settings.shot_seeds,
    compilation.seed_plan.shots,
  );
  assert.deepEqual(
    handoff.extra.relay_seed.shots.map(({ shot_id: shotId, ordinal, seed }) => ({ shotId, ordinal, seed })),
    compilation.seed_plan.shots.map(({ shot_id: shotId, ordinal, seed }) => ({ shotId, ordinal, seed })),
  );
});
