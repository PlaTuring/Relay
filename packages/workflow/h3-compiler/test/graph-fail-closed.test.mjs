import assert from "node:assert/strict";
import test from "node:test";

import { compileProject } from "../src/index.mjs";
import { TEMPLATE_SPECS } from "../src/constants.mjs";
import { lintCompiledWorkflow } from "../src/graph-lint.mjs";
import { loadTemplate } from "../src/template-loader.mjs";

function timedPrompt() {
  return [
    "integrated_multimodal_description: [Shot 1] Live-action opening.",
    "",
    "overall_soundscape: Stable room tone.",
    "",
    "non_diegetic_music: N/A",
  ].join("\n");
}

function referencePrompt() {
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

function project(mode) {
  return {
    schema_version: "1.0.0",
    prompt: mode === "ref2va" ? referencePrompt() : timedPrompt(),
    mode,
    duration: 5,
    segment_duration: 5,
    canvas: "16:9",
    resolution_megapixels: 0.4,
    ...(mode === "first_last_frame" ? {
      endpoints: { first_frame: "input/first.png", last_frame: "input/last.png" },
    } : {}),
    ...(mode === "ref2va" ? {
      endpoints: { reference_images: ["input/reference-1.png", "input/reference-2.png"] },
    } : {}),
    advanced: { seed: 424242, seed_policy: "fixed", sampling_profile: "quality_20" },
  };
}

function findNode(workflow, predicate) {
  const matches = workflow.nodes.filter(predicate);
  assert.equal(matches.length, 1, "test fixture must resolve one node");
  return matches[0];
}

function visibleControls(workflow, templateKind, spec, seedPlan) {
  if (templateKind === "r2v") {
    const group = workflow.groups.find((candidate) => candidate.title.startsWith("种子与采样 ·"));
    return {
      kind: "ref2va",
      seed_node_ids: [spec.noise_node_id],
      seed_values: [seedPlan.shots[0].seed],
      sampling_steps_node_id: spec.quality_projection.full_steps_node_id,
      group_id: group.id,
    };
  }
  const group = workflow.groups.find((candidate) => candidate.title.startsWith("采样与加速 ·"));
  const seedNodes = workflow.nodes
    .filter((node) => node.type === "PrimitiveInt" && node.title?.startsWith("种子 ·"));
  const qualityNode = findNode(workflow, (node) => node.type === "PrimitiveInt"
    && node.title?.startsWith("质量步数 ·"));
  const subgraph = workflow.definitions.subgraphs.find((candidate) => candidate.id === spec.subgraph_id);
  const qualityInputIndex = subgraph.inputs.findIndex((input) => input.name === "quality_steps");
  const qualityInput = subgraph.inputs[qualityInputIndex];
  const qualityInternalLink = subgraph.links.find((link) => !Array.isArray(link)
    && link.id === qualityInput.linkIds[0]);
  return {
    kind: "subgraph",
    seed_node_ids: seedNodes.map((node) => node.id),
    seed_values: seedPlan.shots.map((shot) => shot.seed),
    quality_steps_node_id: qualityNode.id,
    quality_steps_value: qualityNode.widgets_values_named.value,
    quality_subgraph_id: subgraph.id,
    quality_input_id: qualityInput.id,
    quality_input_index: qualityInputIndex,
    quality_internal_link_id: qualityInternalLink.id,
    quality_internal_node_id: qualityInternalLink.target_id,
    turbo_enabled_node_id: findNode(workflow, (node) => node.title?.startsWith("Turbo 加速 ·")).id,
    turbo_strength_node_id: findNode(workflow, (node) => node.title?.startsWith("Turbo LoRA 强度 ·")).id,
    turbo_steps_node_id: findNode(workflow, (node) => node.title?.startsWith("Turbo 步数 ·")).id,
    group_id: group.id,
  };
}

async function lintFixture(mode) {
  const compilation = await compileProject(project(mode));
  const workflow = compilation.workflows[0].workflow;
  const templateKind = mode === "t2v" ? "t2v" : mode === "ref2va" ? "r2v" : "i2v";
  const spec = TEMPLATE_SPECS[templateKind];
  const source = await loadTemplate(templateKind);
  const callType = templateKind === "r2v" ? "MiniMaxH3ReferenceToVideo" : spec.subgraph_id;
  const call = findNode(workflow, (node) => node.id === spec.call_node_id && node.type === callType);
  return {
    workflow,
    sourceWorkflow: source.workflow,
    templateKind,
    mode,
    spec,
    referenceImageCount: mode === "ref2va" ? 2 : 0,
    project: compilation.project,
    plan: compilation.plan,
    longDag: null,
    seedPlan: compilation.seed_plan,
    visibleControls: visibleControls(workflow, templateKind, spec, compilation.seed_plan),
    callExpectations: [{
      prompt: call.widgets_values_named.prompt,
      duration: compilation.plan.segments[0].duration,
      generatedFrames: compilation.plan.segments[0].generated_frames,
      seed: compilation.seed_plan.shots[0].seed,
    }],
  };
}

function assertMutationRejected(fixture, expectedCode, mutate) {
  const candidate = structuredClone(fixture.workflow);
  mutate(candidate, fixture);
  assert.throws(
    () => lintCompiledWorkflow({ ...fixture, workflow: candidate }),
    (error) => error?.code === expectedCode,
    `mutation must fail closed with ${expectedCode}`,
  );
}

function setWidget(node, name, index, value) {
  node.widgets_values[index] = value;
  node.widgets_values_named[name] = value;
}

function removeRootLink(workflow, linkId) {
  const link = workflow.links.find((candidate) => candidate[0] === linkId);
  assert.ok(link);
  const origin = workflow.nodes.find((node) => node.id === link[1]);
  const target = workflow.nodes.find((node) => node.id === link[3]);
  origin.outputs[link[2]].links = origin.outputs[link[2]].links.filter((id) => id !== linkId);
  target.inputs[link[4]].link = null;
  workflow.links = workflow.links.filter((candidate) => candidate[0] !== linkId);
}

function swapLinkOrigins(workflow, leftId, rightId) {
  const left = workflow.links.find((link) => link[0] === leftId);
  const right = workflow.links.find((link) => link[0] === rightId);
  assert.ok(left && right);
  const leftOrigin = workflow.nodes.find((node) => node.id === left[1]);
  const rightOrigin = workflow.nodes.find((node) => node.id === right[1]);
  leftOrigin.outputs[left[2]].links = leftOrigin.outputs[left[2]].links.filter((id) => id !== leftId);
  rightOrigin.outputs[right[2]].links = rightOrigin.outputs[right[2]].links.filter((id) => id !== rightId);
  [left[1], right[1]] = [right[1], left[1]];
  workflow.nodes.find((node) => node.id === left[1]).outputs[left[2]].links.push(leftId);
  workflow.nodes.find((node) => node.id === right[1]).outputs[right[2]].links.push(rightId);
}

test("graph identity, endpoints, bookkeeping, enabled mode, geometry, and SaveVideo fail closed", async () => {
  const fixture = await lintFixture("t2v");
  assertMutationRejected(fixture, "GRAPH.NODE_MODE", (workflow) => {
    workflow.nodes.find((node) => node.id === fixture.spec.call_node_id).mode = 4;
  });
  assertMutationRejected(fixture, "GRAPH.LINK_ID", (workflow) => {
    workflow.links.push(structuredClone(workflow.links[0]));
  });
  assertMutationRejected(fixture, "GRAPH.LINK_ID", (workflow) => {
    workflow.definitions.subgraphs[0].links[0].id = workflow.links[0][0];
  });
  assertMutationRejected(fixture, "GRAPH.LINK_ENDPOINT", (workflow) => {
    workflow.links[0][1] = 999_999;
  });
  assertMutationRejected(fixture, "GRAPH.LINK_BOOKKEEPING", (workflow) => {
    const link = workflow.links[0];
    workflow.nodes.find((node) => node.id === link[1]).outputs[link[2]].links = [];
  });
  assertMutationRejected(fixture, "GRAPH.LAST_NODE_ID", (workflow) => {
    workflow.last_node_id = 0;
  });
  assertMutationRejected(fixture, "GRAPH.LAST_LINK_ID", (workflow) => {
    workflow.last_link_id = 0;
  });
  assertMutationRejected(fixture, "GRAPH.NODE_COLLISION", (workflow) => {
    const selector = workflow.nodes.find((node) => node.type === "ResolutionSelector");
    const seed = workflow.nodes.find((node) => node.title?.startsWith("种子 ·"));
    seed.pos = [...selector.pos];
  });
  assertMutationRejected(fixture, "GRAPH.SAVE_LINK", (workflow) => {
    const save = workflow.nodes.find((node) => node.type === "SaveVideo");
    removeRootLink(workflow, save.inputs.find((input) => input.name === "video").link);
  });
});

test("model, prompt, duration, sampler, scheduler, and denoise values fail closed", async () => {
  const fixture = await lintFixture("t2v");
  const subgraph = (workflow) => workflow.definitions.subgraphs[0];
  assertMutationRejected(fixture, "GRAPH.MODEL_CONTRACT", (workflow) => {
    const call = workflow.nodes.find((node) => node.id === fixture.spec.call_node_id);
    setWidget(call, "unet_name", 5, "other.safetensors");
  });
  assertMutationRejected(fixture, "GRAPH.PROMPT_BINDING", (workflow) => {
    const call = workflow.nodes.find((node) => node.id === fixture.spec.call_node_id);
    setWidget(call, "prompt", 0, "changed prompt");
  });
  assertMutationRejected(fixture, "GRAPH.DURATION_BINDING", (workflow) => {
    const call = workflow.nodes.find((node) => node.id === fixture.spec.call_node_id);
    setWidget(call, "value_1", 3, 4);
  });
  assertMutationRejected(fixture, "GRAPH.SAMPLER_CONTRACT", (workflow) => {
    const sampler = subgraph(workflow).nodes.find((node) => node.type === "KSamplerSelect");
    setWidget(sampler, "sampler_name", 0, "euler");
  });
  assertMutationRejected(fixture, "GRAPH.SCHEDULER_CONTRACT", (workflow) => {
    const scheduler = subgraph(workflow).nodes.find((node) => node.type === "BasicScheduler");
    setWidget(scheduler, "scheduler", 0, "normal");
  });
  assertMutationRejected(fixture, "GRAPH.DENOISE_CONTRACT", (workflow) => {
    const scheduler = subgraph(workflow).nodes.find((node) => node.type === "BasicScheduler");
    setWidget(scheduler, "denoise", 2, 0.5);
  });
});

test("root and certified subgraph quality-step links fail closed", async () => {
  const fixture = await lintFixture("t2v");
  assertMutationRejected(fixture, "GRAPH.VISIBLE_SAMPLING", (workflow) => {
    const quality = workflow.nodes.find((node) => node.title?.startsWith("质量步数 ·"));
    setWidget(quality, "value", 0, 25);
  });
  assertMutationRejected(fixture, "GRAPH.DAG_LINK", (workflow) => {
    const call = workflow.nodes.find((node) => node.id === fixture.spec.call_node_id);
    removeRootLink(workflow, call.inputs.find((input) => input.name === "quality_steps").link);
  });
  assertMutationRejected(fixture, "GRAPH.VISIBLE_SAMPLING", (workflow) => {
    const subgraph = workflow.definitions.subgraphs[0];
    const input = subgraph.inputs.find((candidate) => candidate.name === "quality_steps");
    const linkId = input.linkIds[0];
    const link = subgraph.links.find((candidate) => !Array.isArray(candidate) && candidate.id === linkId);
    const target = subgraph.nodes.find((node) => node.id === link.target_id);
    input.linkIds = [];
    target.inputs = [];
    subgraph.links = subgraph.links.filter((candidate) => Array.isArray(candidate) || candidate.id !== linkId);
  });
});

test("FL2VA image locators and first/last source order fail closed", async () => {
  const fixture = await lintFixture("first_last_frame");
  assertMutationRejected(fixture, "GRAPH.MEDIA_LOCATOR", (workflow) => {
    const image = workflow.nodes.find((node) => node.id === fixture.spec.image_node_id);
    setWidget(image, "image", 0, "input/replaced.png");
  });
  assertMutationRejected(fixture, "GRAPH.MEDIA_BINDING", (workflow) => {
    const call = workflow.nodes.find((node) => node.id === fixture.spec.call_node_id);
    const first = call.inputs.find((input) => input.name === "first_frame").link;
    const last = call.inputs.find((input) => input.name === "last_frame").link;
    swapLinkOrigins(workflow, first, last);
  });
});

test("Ref2VA prompt, duration, image locators, and reference order fail closed", async () => {
  const fixture = await lintFixture("ref2va");
  assertMutationRejected(fixture, "GRAPH.PROMPT_BINDING", (workflow) => {
    const prompt = workflow.nodes.find((node) => node.id === fixture.spec.prompt_node_id);
    setWidget(prompt, "value", 0, "changed prompt");
  });
  assertMutationRejected(fixture, "GRAPH.DURATION_BINDING", (workflow) => {
    const duration = workflow.nodes.find((node) => node.id === fixture.spec.duration_node_id);
    setWidget(duration, "value", 0, 4);
  });
  assertMutationRejected(fixture, "GRAPH.MEDIA_LOCATOR", (workflow) => {
    const image = workflow.nodes.find((node) => node.id === fixture.spec.image_node_ids[0]);
    setWidget(image, "image", 0, "input/replaced.png");
  });
  assertMutationRejected(fixture, "GRAPH.MEDIA_BINDING", (workflow) => {
    swapLinkOrigins(workflow, fixture.spec.image_link_ids[0], fixture.spec.image_link_ids[1]);
  });
});
