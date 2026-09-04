import assert from "node:assert/strict";
import test from "node:test";

import {
  allocateWorkflowId,
  applyWorkflowOutputAttribution,
  compileProject,
  createHandoffWorkflow,
  createWorkflowOutputAttribution,
} from "../src/index.mjs";

const advanced = Object.freeze({ seed: 17, seed_policy: "fixed", sampling_profile: "quality_20" });
const attribution = Object.freeze({
  projectId: "project-alpha40-output-a",
  workflowId: "workflow-alpha40-output-a",
});

function timedPrompt(duration) {
  const shots = Array.from({ length: duration / 5 }, (_, index) => index === 0
    ? "[Shot 1] Live-action, cinematic. The first local segment begins."
    : `[Shot ${index + 1}] At 00:${String(index * 5).padStart(2, "0")}.000, the next local segment begins.`
  ).join("\n");
  return `integrated_multimodal_description: ${shots}\n\noverall_soundscape: Stable room tone continues.\n\nnon_diegetic_music: N/A`;
}

function referencePrompt() {
  return `subject_definitions:\n<Subject 1> is the subject in <Picture 1>.\n\nsummary:\n[reference generation] The target video preserves <Subject 1>.\n\nretention_analysis:\n<Subject 1>: fully_preserved - identity remains consistent.\n\ndetailed_description:\nThe target video uses a live-action cinematic style.\n[Shot 1] Live-action, cinematic. The first local segment begins.\n\noverall_soundscape:\nStable room tone continues.\n\nnon_diegetic_music:\nN/A`;
}

function project(overrides = {}) {
  return {
    schema_version: "1.0.0",
    prompt: "USER_SUPPLIED_PROMPT",
    mode: "t2v",
    duration: 5,
    canvas: "16:9",
    resolution_megapixels: 0.98,
    advanced,
    ...overrides,
  };
}

function savePrefix(compilation) {
  const save = compilation.workflows[0].workflow.nodes.find((node) => node.type === "SaveVideo");
  assert.ok(save);
  assert.equal(save.widgets_values[0], save.widgets_values_named.filename_prefix);
  return save.widgets_values_named.filename_prefix;
}

test("safe output attribution covers T2V, FL2VA, Ref2VA, and a segmented workflow", async () => {
  const cases = [
    project(),
    project({
      prompt: timedPrompt(5),
      mode: "first_last_frame",
      endpoints: { first_frame: "input/首帧.png", last_frame: "input/尾帧.png" },
    }),
    project({
      prompt: referencePrompt(),
      mode: "ref2va",
      endpoints: { reference_images: ["input/参考.png"] },
    }),
    project({ prompt: timedPrompt(10), duration: 10, segment_duration: 5 }),
  ];

  const expected = createWorkflowOutputAttribution(attribution);
  assert.match(expected.output_prefix, /^video\/Relay\/p_[a-f0-9]{16}\/w_[a-f0-9]{16}\/Relay_H3$/u);
  for (const input of cases) {
    const compiled = await compileProject(input, { outputAttribution: attribution });
    assert.equal(savePrefix(compiled), expected.output_prefix);
    assert.deepEqual(compiled.output_attribution, expected);
    assert.deepEqual(
      compiled.workflows[0].workflow.extra.relay_output_attribution,
      expected,
    );
    assert.equal(expected.output_prefix.includes("USER_SUPPLIED_PROMPT"), false);
    assert.equal(expected.output_prefix.includes("首帧"), false);
    const handoff = createHandoffWorkflow(compiled);
    assert.equal(
      handoff.nodes.find((node) => node.type === "SaveVideo").widgets_values_named.filename_prefix,
      expected.output_prefix,
    );
    assert.deepEqual(handoff.extra.minimax_h3_tool.output_attribution, expected);
  }
});

test("project and preallocated workflow identities create isolated namespaces", () => {
  const first = createWorkflowOutputAttribution(attribution);
  const otherProject = createWorkflowOutputAttribution({
    projectId: "project-alpha40-output-b",
    workflowId: attribution.workflowId,
  });
  const otherWorkflow = createWorkflowOutputAttribution({
    projectId: attribution.projectId,
    workflowId: "workflow-alpha40-output-b",
  });
  assert.notEqual(first.project_token, otherProject.project_token);
  assert.notEqual(first.workflow_token, otherWorkflow.workflow_token);
  assert.notEqual(first.output_prefix, otherProject.output_prefix);
  assert.notEqual(first.output_prefix, otherWorkflow.output_prefix);
  assert.equal(
    allocateWorkflowId(() => "00112233-4455-6677-8899-aabbccddeeff"),
    "workflow-00112233445566778899aabbccddeeff",
  );
});

test("standalone binder rejects ambiguous SaveVideo authority and writes before hashing", () => {
  const workflow = {
    nodes: [{
      type: "SaveVideo",
      widgets_values: ["video/old"],
      widgets_values_named: { filename_prefix: "video/old" },
    }],
    extra: {},
  };
  const bound = applyWorkflowOutputAttribution(workflow, attribution);
  assert.equal(workflow.nodes[0].widgets_values_named.filename_prefix, bound.output_prefix);
  assert.deepEqual(workflow.extra.relay_output_attribution, bound);
  assert.throws(
    () => applyWorkflowOutputAttribution({ nodes: [] }, attribution),
    (error) => error?.code === "TEMPLATE.OUTPUT_BINDING",
  );
  assert.throws(
    () => createWorkflowOutputAttribution({ ...attribution, projectId: "project/unsafe" }),
    (error) => error?.code === "COMPILER.OUTPUT_ATTRIBUTION",
  );
});
