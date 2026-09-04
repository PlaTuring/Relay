import assert from "node:assert/strict";
import test from "node:test";

import {
  compileProject,
  createHandoffWorkflow,
  validateProjectSpec,
} from "../src/index.mjs";

function project(transitions) {
  return {
    schema_version: "1.0.0",
    prompt: [
      "integrated_multimodal_description: [Shot 1] Live-action opening.",
      "[Shot 2] At 00:05.000, live-action continuation.",
      "[Shot 3] At 00:10.000, live-action continuation.",
      "",
      "overall_soundscape: Stable room tone.",
      "",
      "non_diegetic_music: N/A",
    ].join("\n"),
    mode: "t2v",
    duration: 15,
    segment_duration: 5,
    segment_durations: [5, 5, 5],
    shot_ids: ["shot-transition01", "shot-transition02", "shot-transition03"],
    ...(transitions === undefined ? {} : { transitions }),
    canvas: "16:9",
    resolution_megapixels: 0.98,
    advanced: {
      seed: 8080,
      seed_policy: "fixed",
      sampling_profile: "quality_20",
    },
  };
}

function ordered(workflow, type) {
  return workflow.nodes.filter((node) => node.type === type)
    .sort((left, right) => left.title.localeCompare(right.title));
}

test("transition validation defaults old projects to tail continuation and fails closed on drift", () => {
  assert.deepEqual(validateProjectSpec(project()).transitions, [
    "tail_frame_continuation",
    "tail_frame_continuation",
  ]);
  assert.deepEqual(validateProjectSpec(project(["hard_cut", "tail_frame_continuation"])).transitions, [
    "hard_cut",
    "tail_frame_continuation",
  ]);
  assert.throws(
    () => validateProjectSpec(project(["hard_cut"])),
    (error) => error?.code === "PROJECT.TRANSITIONS",
  );
  assert.throws(
    () => validateProjectSpec(project(["hard_cut", "dissolve"])),
    (error) => error?.code === "PROJECT.TRANSITION_TYPE",
  );
  assert.deepEqual(validateProjectSpec({
    ...project([]),
    duration: 5,
    segment_durations: [5],
    shot_ids: ["shot-transition01"],
  }).transitions, []);
});

test("mixed transition DAG connects and removes a frame only for tail continuation", async () => {
  const compilation = await compileProject(project(["hard_cut", "tail_frame_continuation"]));
  assert.deepEqual(compilation.plan.transitions, ["hard_cut", "tail_frame_continuation"]);
  assert.deepEqual(
    compilation.plan.segments.map((segment) => ({
      mode: segment.mode,
      transition: segment.transition_from_previous,
      requiresTail: segment.requires_previous_segment_final_frame,
    })),
    [
      { mode: "t2v", transition: null, requiresTail: false },
      { mode: "t2v", transition: "hard_cut", requiresTail: false },
      { mode: "first_frame", transition: "tail_frame_continuation", requiresTail: true },
    ],
  );
  assert.equal(compilation.plan.continuity, "official_core_mixed_transition_sequence");
  assert.equal(compilation.plan.warning_code, "EXPERIMENTAL_H3_SUBGRAPH_TRANSITION_SEQUENCE");

  const workflow = compilation.workflows[0].workflow;
  const callType = "79dd8a95-ce9d-4c14-b264-2162e8bec5ce";
  const calls = ordered(workflow, callType);
  const components = ordered(workflow, "GetVideoComponents");
  const imageBatches = ordered(workflow, "BatchImagesNode");
  const tails = workflow.nodes.filter((node) => node.type === "ImageFromBatch" && node.widgets_values?.[0] === -1);
  const slices = workflow.nodes.filter((node) => node.type === "ImageFromBatch" && node.widgets_values?.[0] === 1);

  assert.equal(tails.length, 1);
  assert.equal(slices.length, 1);
  assert.equal(calls[1].inputs.find((input) => input.name === "first_frame").link, null);
  assert.equal(Number.isSafeInteger(calls[2].inputs.find((input) => input.name === "first_frame").link), true);
  assert.match(calls[1].title, /镜头 02 · 5 秒 · 硬切 · T2V/u);
  assert.match(calls[2].title, /镜头 03 · 5 秒 · 尾帧延续 · FL2VA 首帧/u);
  assert.match(tails[0].title, /尾帧延续/u);
  assert.match(slices[0].title, /尾帧延续/u);
  assert.equal(workflow.groups.some((group) => /镜头 02 · 5 秒 · 硬切/u.test(group.title)), true);
  assert.equal(workflow.groups.some((group) => /镜头 03 · 5 秒 · 尾帧延续/u.test(group.title)), true);

  const hardCutFrameLink = workflow.links.find((link) => Array.isArray(link)
    && link[3] === imageBatches[0].id && link[4] === 1 && link[5] === "IMAGE");
  assert.equal(hardCutFrameLink[1], components[1].id);
  const tailFrameLink = workflow.links.find((link) => Array.isArray(link)
    && link[3] === imageBatches[1].id && link[4] === 1 && link[5] === "IMAGE");
  assert.equal(tailFrameLink[1], slices[0].id);

  const handoff = createHandoffWorkflow(compilation);
  assert.deepEqual(handoff.extra.minimax_h3_tool.segment_plan.transitions, [
    "hard_cut",
    "tail_frame_continuation",
  ]);
  assert.deepEqual(
    handoff.extra.minimax_h3_tool.segment_plan.segments.map((segment) => segment.transition_from_previous),
    [null, "hard_cut", "tail_frame_continuation"],
  );
});

test("all-hard-cut DAG keeps every segment's complete frame batch", async () => {
  const compilation = await compileProject(project(["hard_cut", "hard_cut"]));
  const workflow = compilation.workflows[0].workflow;
  const callType = "79dd8a95-ce9d-4c14-b264-2162e8bec5ce";
  const calls = ordered(workflow, callType);
  const components = ordered(workflow, "GetVideoComponents");
  const imageBatches = ordered(workflow, "BatchImagesNode");

  assert.equal(workflow.nodes.filter((node) => node.type === "ImageFromBatch").length, 0);
  assert.equal(calls.slice(1).every((call) => call.inputs.find((input) => input.name === "first_frame").link === null), true);
  for (let index = 0; index < imageBatches.length; index += 1) {
    const link = workflow.links.find((candidate) => Array.isArray(candidate)
      && candidate[3] === imageBatches[index].id && candidate[4] === 1 && candidate[5] === "IMAGE");
    assert.equal(link[1], components[index + 1].id);
  }
  assert.equal(compilation.plan.continuity, "official_core_hard_cut_sequence");
  assert.equal(compilation.workflows[0].lint.ok, true);
});
