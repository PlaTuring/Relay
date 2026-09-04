import {
  CANVASES,
  OFFICIAL_FIXED_CAPABILITIES,
  resolveCanvasSize,
  SAMPLING_PROFILE_STEPS,
  TEMPLATE_SPECS,
} from "./constants.mjs";
import { fail } from "./errors.mjs";
import { lintCompiledWorkflow } from "./graph-lint.mjs";
import { createSegmentPlan, validateProjectSpec } from "./project-spec.mjs";
import { createSegmentPrompts } from "./segment-prompt.mjs";
import { attachSeedPlan, resolveCompileSeedPlan } from "./seed-policy.mjs";
import { loadTemplate } from "./template-loader.mjs";
import { applyWorkflowOutputAttribution, createWorkflowOutputAttribution } from "./output-attribution.mjs";

const LONG_VIDEO_CORE_VERSION = "0.34.0";

const SAMPLING_PROFILE_LABELS = Object.freeze({
  quality_20: "标准 20 步",
  quality_25: "高质量 25 步",
  turbo_8: "Turbo 8 步",
});

const MODE_LABELS = Object.freeze({
  t2v: "T2V",
  first_frame: "FL2VA 首帧",
  last_frame: "FL2VA 尾帧",
  first_last_frame: "FL2VA 首尾帧",
  ref2va: "Ref2VA",
});

const H3_SUBGRAPH_INPUT_LABELS = Object.freeze({
  first_frame: "首帧（已连接时生效）",
  last_frame: "尾帧（已连接时生效）",
  prompt: "本镜提示词",
  width: "最终宽度（由分辨率节点）",
  height: "最终高度（由分辨率节点）",
  value_1: "本镜时长（秒）",
  noise_seed: "本镜实际种子",
  unet_name: "H3 UNET（固定）",
  clip_name: "文本编码器（固定）",
  vae_name: "视频 VAE（固定）",
  vae_name_1: "音频 VAE（固定）",
  value: "Turbo 加速（开启时生效）",
  lora_name: "Turbo LoRA（开启时生效）",
  strength_model_1: "Turbo LoRA 强度（开启时生效）",
  value_2: "Turbo 8 步（开启时生效）",
});

const QUALITY_STEPS_INPUT_IDS = Object.freeze({
  "79dd8a95-ce9d-4c14-b264-2162e8bec5ce": "c2745450-b576-5b03-84f7-56f1159fa529",
  "4c314f31-ecda-4b08-ae98-faaba1bf613f": "f610c2b2-23f4-5c7e-813b-3a0afe601f09",
});

function transitionLabel(value) {
  if (value === "tail_frame_continuation") return "尾帧延续";
  if (value === "hard_cut") return "硬切";
  if (value === null || value === undefined) return null;
  fail("COMPILER.TRANSITION", "Visible transition cannot be resolved.", "/transitions");
}

function h3CallTitle({ mode, samplingProfile, segment, seed, baseSeed }) {
  const modeLabel = MODE_LABELS[mode];
  const profileLabel = SAMPLING_PROFILE_LABELS[samplingProfile];
  if (!modeLabel || !profileLabel || !Number.isSafeInteger(seed) || !Number.isSafeInteger(baseSeed)) {
    fail("COMPILER.VISIBLE_PARAMETERS", "Visible H3 parameters cannot be resolved.", "/graph");
  }
  const shot = segment.total_segments > 1
    ? `镜头 ${String(segment.index).padStart(2, "0")} · ${segment.duration} 秒`
    : `单镜 · ${segment.duration} 秒`;
  const incomingTransition = transitionLabel(segment.transition_from_previous);
  return `MiniMax H3 · ${shot}${incomingTransition ? ` · ${incomingTransition}` : ""} · ${modeLabel}`;
}

function labelH3SubgraphInputs(call, subgraph) {
  for (const [name, label] of Object.entries(H3_SUBGRAPH_INPUT_LABELS)) {
    const definitionInput = subgraph.inputs?.find((input) => input.name === name);
    if (!definitionInput) {
      fail("TEMPLATE.SUBGRAPH_INPUT", "Pinned H3 subgraph input is missing.", "/template");
    }
    definitionInput.label = label;
    const callInput = call.inputs?.find((input) => input.name === name);
    if (callInput) callInput.label = label;
  }
}

function everyGraph(workflow) {
  const result = [workflow];
  for (let index = 0; index < result.length; index += 1) {
    for (const subgraph of result[index].definitions?.subgraphs ?? []) result.push(subgraph);
  }
  return result;
}

function findNode(graph, id, type) {
  const matches = graph.nodes.filter((node) => node.id === id && (type === undefined || node.type === type));
  if (matches.length !== 1) fail("TEMPLATE.BINDING", "Pinned template binding is absent or ambiguous.", "/template");
  return matches[0];
}

function setNamedWidget(node, name, index, value) {
  if (!Array.isArray(node.widgets_values) || index < 0 || index >= node.widgets_values.length
    || !node.widgets_values_named || typeof node.widgets_values_named !== "object"
    || !Object.hasOwn(node.widgets_values_named, name)) {
    fail("TEMPLATE.WIDGET_BINDING", "Pinned widget binding drifted.", "/template");
  }
  node.widgets_values[index] = value;
  node.widgets_values_named[name] = value;
}

function bindQualitySteps(graph, samplingProfile) {
  const activeSteps = SAMPLING_PROFILE_STEPS[samplingProfile];
  if (!Number.isSafeInteger(activeSteps)) {
    fail("COMPILER.SAMPLING_PROFILE", "Sampling profile does not resolve to a pinned step count.", "/advanced/sampling_profile");
  }
  const fullSteps = graph.nodes.filter((node) => node.type === "PrimitiveInt"
    && node.widgets_values?.[0] === OFFICIAL_FIXED_CAPABILITIES.quality_steps
    && node.widgets_values?.[1] === "fixed"
    && node.widgets_values_named?.value === OFFICIAL_FIXED_CAPABILITIES.quality_steps
    && node.widgets_values_named?.fixed === "fixed");
  if (fullSteps.length !== 1) {
    fail("TEMPLATE.QUALITY_STEPS_BINDING", "Pinned full-quality step binding is absent or ambiguous.", "/template");
  }
  const qualitySteps = samplingProfile === "quality_25"
    ? OFFICIAL_FIXED_CAPABILITIES.high_quality_steps
    : OFFICIAL_FIXED_CAPABILITIES.quality_steps;
  setNamedWidget(fullSteps[0], "value", 0, qualitySteps);
  return fullSteps[0];
}

function resolvedCanvas(project) {
  const preset = CANVASES[project.canvas];
  const size = resolveCanvasSize(project.canvas, project.resolution_megapixels);
  if (!preset || !size) fail("PROJECT.CANVAS_RESOLUTION", "Canvas and resolution cannot be resolved.", "/canvas");
  return Object.freeze({ ...preset, ...size, megapixels: project.resolution_megapixels });
}

function sanitizeModelProperties(workflow) {
  for (const graph of everyGraph(workflow)) {
    for (const node of graph.nodes) {
      if (node.properties && typeof node.properties === "object" && Array.isArray(node.properties.models)) {
        node.properties.models = [];
      }
    }
  }
}

function bindResolutionSelector(workflow, spec, callNode, canvas) {
  const inputByName = new Map(callNode.inputs.map((input) => [input.name, input]));
  for (const [name, linkId] of [["width", spec.width_link_id], ["height", spec.height_link_id]]) {
    const input = inputByName.get(name);
    if (!input || input.link !== linkId) fail("TEMPLATE.CANVAS_BINDING", "Pinned canvas binding drifted.", "/template");
  }
  const selector = findNode(workflow, spec.resolution_node_id, "ResolutionSelector");
  setNamedWidget(selector, "aspect_ratio", 0, canvas.selector_aspect_ratio);
  setNamedWidget(selector, "megapixels", 1, canvas.megapixels);
  setNamedWidget(selector, "multiple", 2, 32);
  selector.title = `分辨率 · ${canvas.width}×${canvas.height} · ${canvas.megapixels} MP`;

  const expectedLinks = [[spec.width_link_id, 0, "width"], [spec.height_link_id, 1, "height"]];
  for (const [linkId, outputSlot, inputName] of expectedLinks) {
    const link = workflow.links.find((candidate) => Array.isArray(candidate) && candidate[0] === linkId);
    const inputSlot = callNode.inputs.findIndex((input) => input.name === inputName);
    const output = selector.outputs?.[outputSlot];
    if (!link || inputSlot < 0 || link[1] !== selector.id || link[2] !== outputSlot
      || link[3] !== callNode.id || link[4] !== inputSlot || link[5] !== "INT"
      || !Array.isArray(output?.links) || !output.links.includes(linkId)) {
      fail("TEMPLATE.CANVAS_BINDING", "Pinned ResolutionSelector link drifted.", "/template");
    }
  }
}

function compactVisibleLayout(workflow, { longDag = false } = {}) {
  const noteIds = new Set(workflow.nodes.filter((node) => node.type === "MarkdownNote").map((node) => node.id));
  if (workflow.links.some((link) => Array.isArray(link) && (noteIds.has(link[1]) || noteIds.has(link[3])))) {
    fail("TEMPLATE.NOTE_BINDING", "A visible note unexpectedly participates in the execution graph.", "/template");
  }
  workflow.nodes = workflow.nodes.filter((node) => node.type !== "MarkdownNote");

  const previewIds = new Set(workflow.nodes
    .filter((node) => ["ImageScaleToTotalPixels", "GetImageSize"].includes(node.type))
    .map((node) => node.id));
  if (previewIds.size > 0) {
    const previewLinks = workflow.links.filter((link) => Array.isArray(link)
      && (previewIds.has(link[1]) || previewIds.has(link[3])));
    if (previewLinks.every((link) => previewIds.has(link[1]) && previewIds.has(link[3]))) {
      workflow.nodes = workflow.nodes.filter((node) => !previewIds.has(node.id));
      workflow.links = workflow.links.filter((link) => !(Array.isArray(link)
        && (previewIds.has(link[1]) || previewIds.has(link[3]))));
      workflow.groups = (workflow.groups ?? []).filter((group) => group.title !== "Use Image Size");
    }
  }

  const saveVideo = workflow.nodes.filter((node) => node.type === "SaveVideo");
  if (saveVideo.length !== 1) fail("TEMPLATE.OUTPUT_BINDING", "Pinned SaveVideo node is absent or ambiguous.", "/template");
  saveVideo[0].size = [380, 150];
  const saveLink = workflow.links.find((link) => Array.isArray(link) && link[3] === saveVideo[0].id && link[5] === "VIDEO");
  const source = saveLink ? workflow.nodes.find((node) => node.id === saveLink[1]) : undefined;
  if (source && Array.isArray(source.pos) && Array.isArray(source.size)) {
    saveVideo[0].pos = [source.pos[0] + source.size[0] + 120, source.pos[1]];
  }

  const positioned = workflow.nodes.filter((node) => Array.isArray(node.pos) && node.pos.length === 2);
  const minX = Math.min(...positioned.map((node) => node.pos[0]));
  const minY = Math.min(...positioned.map((node) => node.pos[1]));
  const shiftX = 80 - minX;
  const shiftY = 80 - minY;
  for (const node of positioned) node.pos = [node.pos[0] + shiftX, node.pos[1] + shiftY];
  for (const group of workflow.groups ?? []) {
    if (Array.isArray(group.bounding) && group.bounding.length === 4) {
      group.bounding = [group.bounding[0] + shiftX, group.bounding[1] + shiftY, group.bounding[2], group.bounding[3]];
    }
  }
  if (!workflow.extra || typeof workflow.extra !== "object" || Array.isArray(workflow.extra)) workflow.extra = {};
  workflow.extra.ds = { scale: longDag ? 0.42 : 0.78, offset: [40, 40] };
}

function bindSaveOutput(workflow, segment, { completeLongOutput = false, outputPrefix = null } = {}) {
  const saveVideo = workflow.nodes.filter((node) => node.type === "SaveVideo");
  if (saveVideo.length !== 1) fail("TEMPLATE.OUTPUT_BINDING", "Pinned SaveVideo node is absent or ambiguous.", "/template");
  const prefix = outputPrefix ?? (completeLongOutput ? "video/MiniMax_H3" : segment.planned_output_prefix);
  setNamedWidget(saveVideo[0], "filename_prefix", 0, prefix);
  saveVideo[0].title = completeLongOutput
    ? "Save Complete Video"
    : segment.total_segments > 1
      ? `Save ${segment.name}`
      : "Save Video";
}

function bindCommon(
  workflow,
  templateKind,
  project,
  segment,
  prompt = project.prompt,
  seed = project.advanced.seed,
  outputPrefix = null,
  baseSeed = seed,
) {
  const spec = TEMPLATE_SPECS[templateKind];
  const call = findNode(workflow, spec.call_node_id, spec.subgraph_id);
  const subgraph = workflow.definitions?.subgraphs?.find((candidate) => candidate.id === spec.subgraph_id);
  if (!subgraph) fail("TEMPLATE.SUBGRAPH_BINDING", "Pinned H3 subgraph is missing.", "/template");
  const h3 = subgraph.nodes.filter((node) => node.type === "MiniMaxH3ImageToVideo");
  if (h3.length !== 1) fail("TEMPLATE.H3_BINDING", "Pinned local H3 node is absent or ambiguous.", "/template");
  const durationNode = subgraph.nodes.filter((node) => node.type === "PrimitiveFloat" && /duration/i.test(node.title ?? ""));
  if (durationNode.length !== 1) fail("TEMPLATE.DURATION_BINDING", "Pinned duration node is absent or ambiguous.", "/template");
  const canvas = resolvedCanvas(project);
  const turboEnabled = project.advanced.sampling_profile === "turbo_8";

  bindQualitySteps(subgraph, project.advanced.sampling_profile);
  labelH3SubgraphInputs(call, subgraph);

  setNamedWidget(call, "prompt", 0, prompt);
  setNamedWidget(call, "width", 1, canvas.width);
  setNamedWidget(call, "height", 2, canvas.height);
  setNamedWidget(call, "value_1", 3, segment.duration);
  setNamedWidget(call, "noise_seed", 4, seed);
  setNamedWidget(call, "value", 9, turboEnabled);
  setNamedWidget(call, "strength_model_1", 11, OFFICIAL_FIXED_CAPABILITIES.turbo_model_strength);
  setNamedWidget(call, "value_2", 12, OFFICIAL_FIXED_CAPABILITIES.turbo_steps);
  setNamedWidget(h3[0], "prompt", 0, prompt);
  setNamedWidget(h3[0], "width", 1, canvas.width);
  setNamedWidget(h3[0], "height", 2, canvas.height);
  setNamedWidget(h3[0], "length", 3, segment.generated_frames);
  setNamedWidget(durationNode[0], "value", 0, segment.duration);

  const noise = subgraph.nodes.filter((node) => node.type === "RandomNoise");
  if (noise.length !== 1) fail("TEMPLATE.SEED_BINDING", "Pinned RandomNoise binding is absent or ambiguous.", "/template");
  setNamedWidget(noise[0], "noise_seed", 0, seed);
  setNamedWidget(noise[0], "control_after_generate", 1, "fixed");
  call.title = h3CallTitle({
    mode: segment.mode,
    samplingProfile: project.advanced.sampling_profile,
    segment,
    seed,
    baseSeed,
  });
  bindResolutionSelector(workflow, spec, call, canvas);

  bindSaveOutput(workflow, segment, { outputPrefix });
  sanitizeModelProperties(workflow);
  return { spec, call };
}

function bindImageNode(node, locator) {
  setNamedWidget(node, "image", 0, locator);
  if (!Array.isArray(node.widgets_values) || node.widgets_values.length < 2) fail("TEMPLATE.IMAGE_BINDING", "Pinned image widget drifted.", "/template");
  node.widgets_values[1] = "image";
  if (node.widgets_values_named && Object.hasOwn(node.widgets_values_named, "upload")) node.widgets_values_named.upload = "image";
}

function bindEndpoints(workflow, spec, call, segment) {
  const firstInput = call.inputs.find((input) => input.name === "first_frame");
  const lastInput = call.inputs.find((input) => input.name === "last_frame");
  if (!firstInput || !lastInput) fail("TEMPLATE.ENDPOINT_BINDING", "Pinned endpoint slots drifted.", "/template");
  const imageNode = findNode(workflow, spec.image_node_id, "LoadImage");
  const link = workflow.links.find((candidate) => Array.isArray(candidate) && candidate[0] === spec.image_link_id);
  if (!link || link[1] !== imageNode.id || link[2] !== 0 || link[3] !== call.id || link[5] !== "IMAGE") {
    fail("TEMPLATE.ENDPOINT_BINDING", "Pinned endpoint link drifted.", "/template");
  }
  const firstSlot = call.inputs.indexOf(firstInput);
  const lastSlot = call.inputs.indexOf(lastInput);
  firstInput.link = null;
  lastInput.link = null;

  if (segment.mode === "first_frame") {
    bindImageNode(imageNode, segment.endpoints.first_frame);
    firstInput.link = spec.image_link_id;
    link[4] = firstSlot;
    return;
  }
  if (segment.mode === "last_frame") {
    bindImageNode(imageNode, segment.endpoints.last_frame);
    lastInput.link = spec.image_link_id;
    link[4] = lastSlot;
    return;
  }
  if (segment.mode !== "first_last_frame") fail("COMPILER.ENDPOINT_MODE", "Image template requires an endpoint mode.", "/mode");
  bindImageNode(imageNode, segment.endpoints.first_frame);
  firstInput.link = spec.image_link_id;
  link[4] = firstSlot;

  const newNodeId = workflow.last_node_id + 1;
  const newLinkId = workflow.last_link_id + 1;
  if (!Number.isSafeInteger(newNodeId) || !Number.isSafeInteger(newLinkId)) fail("COMPILER.ID_SPACE", "Template ID space is invalid.", "/template");
  const lastImageNode = structuredClone(imageNode);
  lastImageNode.id = newNodeId;
  if (Array.isArray(lastImageNode.pos) && lastImageNode.pos.length === 2) {
    const imageHeight = Number.isFinite(lastImageNode.size?.[1]) ? lastImageNode.size[1] : 630;
    lastImageNode.pos[1] += imageHeight + 40;
  }
  if (!Array.isArray(lastImageNode.outputs) || !lastImageNode.outputs[0]) fail("TEMPLATE.IMAGE_BINDING", "Pinned image output drifted.", "/template");
  lastImageNode.outputs[0].links = [newLinkId];
  bindImageNode(lastImageNode, segment.endpoints.last_frame);
  workflow.nodes.push(lastImageNode);
  workflow.links.push([newLinkId, newNodeId, 0, call.id, lastSlot, "IMAGE"]);
  workflow.last_node_id = newNodeId;
  workflow.last_link_id = newLinkId;
  lastInput.link = newLinkId;
}

function bindReferenceImages(workflow, spec, call, segment) {
  const references = segment.endpoints?.reference_images;
  if (!Array.isArray(references) || references.length < 1 || references.length > 2) {
    fail("COMPILER.REFERENCE_IMAGES", "Ref2VA requires one or two validated reference images.", "/endpoints/reference_images");
  }
  const names = ["ref_images.ref_image_0", "ref_images.ref_image_1"];
  const removedNodeIds = new Set();
  const removedLinkIds = new Set();
  for (let index = 0; index < names.length; index += 1) {
    const input = call.inputs.find((candidate) => candidate.name === names[index]);
    const node = findNode(workflow, spec.image_node_ids[index], "LoadImage");
    const linkId = spec.image_link_ids[index];
    const link = workflow.links.find((candidate) => Array.isArray(candidate) && candidate[0] === linkId);
    const inputSlot = call.inputs.indexOf(input);
    if (!input || !link || inputSlot < 0 || link[1] !== node.id || link[2] !== 0
      || link[3] !== call.id || link[4] !== inputSlot || link[5] !== "IMAGE") {
      fail("TEMPLATE.REFERENCE_BINDING", "Pinned Ref2VA image binding drifted.", "/template");
    }
    if (index < references.length) {
      bindImageNode(node, references[index]);
      input.link = linkId;
    } else {
      input.link = null;
      removedNodeIds.add(node.id);
      removedLinkIds.add(linkId);
    }
  }
  if (removedNodeIds.size > 0) {
    workflow.nodes = workflow.nodes.filter((node) => !removedNodeIds.has(node.id));
    workflow.links = workflow.links.filter((link) => !(Array.isArray(link) && removedLinkIds.has(link[0])));
  }
}

function pruneRef2vaQualityBranch(workflow, spec, project) {
  if (!["quality_20", "quality_25"].includes(project.advanced.sampling_profile)) {
    fail("COMPILER.REF2VA_PROFILE", "Ref2VA supports only pinned quality profiles.", "/advanced/sampling_profile");
  }
  const projection = spec.quality_projection;
  if (!projection) fail("TEMPLATE.QUALITY_BINDING", "Pinned Ref2VA quality projection is missing.", "/template");

  const baseModel = findNode(workflow, projection.base_model_node_id, "UNETLoader");
  const guider = findNode(workflow, projection.guider_node_id, "BasicGuider");
  const scheduler = findNode(workflow, projection.scheduler_node_id, "BasicScheduler");
  const fullSteps = findNode(workflow, projection.full_steps_node_id, "PrimitiveInt");
  const prunedTypes = new Map([
    [141, "ComfySwitchNode"],
    [142, "ComfySwitchNode"],
    [144, "PrimitiveInt"],
    [145, "LoraLoaderModelOnly"],
    [146, "PrimitiveBoolean"],
  ]);
  for (const [nodeId, type] of prunedTypes) findNode(workflow, nodeId, type);

  const sourceLinks = new Map([
    [283, [144, 0, 142, 1, "INT"]],
    [284, [143, 0, 142, 0, "INT"]],
    [285, [127, 0, 145, 0, "MODEL"]],
    [286, [145, 0, 141, 1, "MODEL"]],
    [287, [127, 0, 141, 0, "MODEL"]],
    [288, [141, 0, 126, 0, "MODEL"]],
    [289, [142, 0, 124, 1, "INT"]],
    [290, [146, 0, 141, 2, "BOOLEAN"]],
    [291, [146, 0, 142, 2, "BOOLEAN"]],
  ]);
  for (const [linkId, expected] of sourceLinks) {
    const matches = workflow.links.filter((link) => Array.isArray(link) && link[0] === linkId);
    if (matches.length !== 1 || matches[0].slice(1).some((value, index) => value !== expected[index])) {
      fail("TEMPLATE.QUALITY_BINDING", "Pinned Ref2VA quality branch drifted.", "/template");
    }
    const [, originId, originSlot, targetId, targetSlot] = matches[0];
    const origin = findNode(workflow, originId);
    const target = findNode(workflow, targetId);
    if (!origin.outputs?.[originSlot]?.links?.includes(linkId) || target.inputs?.[targetSlot]?.link !== linkId) {
      fail("TEMPLATE.QUALITY_BINDING", "Pinned Ref2VA quality link bookkeeping drifted.", "/template");
    }
  }
  if (fullSteps.widgets_values_named?.value !== 20 || fullSteps.widgets_values?.[0] !== 20
    || fullSteps.widgets_values_named?.fixed !== "fixed" || fullSteps.widgets_values?.[1] !== "fixed") {
    fail("TEMPLATE.QUALITY_BINDING", "Pinned Ref2VA quality steps drifted.", "/template");
  }
  setNamedWidget(
    fullSteps,
    "value",
    0,
    project.advanced.sampling_profile === "quality_25"
      ? OFFICIAL_FIXED_CAPABILITIES.high_quality_steps
      : OFFICIAL_FIXED_CAPABILITIES.quality_steps,
  );

  const prunedNodeIds = new Set(projection.pruned_node_ids);
  const prunedLinkIds = new Set(projection.pruned_link_ids);
  workflow.nodes = workflow.nodes.filter((node) => !prunedNodeIds.has(node.id));
  workflow.links = workflow.links.flatMap((link) => {
    if (!Array.isArray(link) || !prunedLinkIds.has(link[0])) return [link];
    if (link[0] === projection.model_link_id) {
      return [[projection.model_link_id, baseModel.id, 0, guider.id, 0, "MODEL"]];
    }
    if (link[0] === projection.steps_link_id) {
      return [[projection.steps_link_id, fullSteps.id, 0, scheduler.id, 1, "INT"]];
    }
    return [];
  });

  for (const node of workflow.nodes) {
    for (const output of node.outputs ?? []) {
      if (Array.isArray(output.links)) output.links = output.links.filter((linkId) => !prunedLinkIds.has(linkId));
    }
  }
  baseModel.outputs[0].links.push(projection.model_link_id);
  fullSteps.outputs[0].links.push(projection.steps_link_id);
  guider.inputs[0].link = projection.model_link_id;
  scheduler.inputs[1].link = projection.steps_link_id;

  const switchGroup = (workflow.groups ?? []).find((group) => group.id === projection.switch_group_id);
  if (!switchGroup || switchGroup.title !== projection.switch_group_title) {
    fail("TEMPLATE.QUALITY_BINDING", "Pinned Ref2VA quality group drifted.", "/template");
  }
  workflow.groups = (workflow.groups ?? []).filter((group) => group.id !== switchGroup.id);
}

function bindRef2va(
  workflow,
  project,
  segment,
  prompt = project.prompt,
  seed = project.advanced.seed,
  outputPrefix = null,
  baseSeed = seed,
) {
  const spec = TEMPLATE_SPECS.r2v;
  const call = findNode(workflow, spec.call_node_id, "MiniMaxH3ReferenceToVideo");
  const promptNode = findNode(workflow, spec.prompt_node_id, "PrimitiveStringMultiline");
  const durationNode = findNode(workflow, spec.duration_node_id, "PrimitiveFloat");
  const noiseNode = findNode(workflow, spec.noise_node_id, "RandomNoise");
  const canvas = resolvedCanvas(project);

  setNamedWidget(call, "prompt", 0, prompt);
  setNamedWidget(call, "width", 1, canvas.width);
  setNamedWidget(call, "height", 2, canvas.height);
  setNamedWidget(call, "length", 3, segment.generated_frames);
  setNamedWidget(call, "ref_image_size", 4, "match");
  setNamedWidget(promptNode, "value", 0, prompt);
  setNamedWidget(durationNode, "value", 0, segment.duration);
  setNamedWidget(noiseNode, "noise_seed", 0, seed);
  setNamedWidget(noiseNode, "control_after_generate", 1, "fixed");
  call.title = h3CallTitle({
    mode: segment.mode,
    samplingProfile: project.advanced.sampling_profile,
    segment,
    seed,
    baseSeed,
  });
  bindResolutionSelector(workflow, spec, call, canvas);
  bindReferenceImages(workflow, spec, call, segment);
  pruneRef2vaQualityBranch(workflow, spec, project);
  bindSaveOutput(workflow, segment, { outputPrefix });
  sanitizeModelProperties(workflow);
  return { spec, call };
}

function idAllocator(workflow) {
  let nextNodeId = workflow.last_node_id + 1;
  let nextLinkId = workflow.last_link_id + 1;
  let nextOrder = Math.max(...workflow.nodes.map((node) => Number.isSafeInteger(node.order) ? node.order : 0)) + 1;
  return {
    node() {
      const value = nextNodeId;
      nextNodeId += 1;
      workflow.last_node_id = value;
      return value;
    },
    link() {
      const value = nextLinkId;
      nextLinkId += 1;
      workflow.last_link_id = value;
      return value;
    },
    order() {
      const value = nextOrder;
      nextOrder += 1;
      return value;
    },
  };
}

function detachLink(workflow, linkId) {
  const index = workflow.links.findIndex((link) => Array.isArray(link) && link[0] === linkId);
  if (index < 0) fail("TEMPLATE.LINK_BINDING", "Pinned workflow link is missing.", "/template");
  const [, originId, originSlot, targetId, targetSlot] = workflow.links[index];
  const origin = workflow.nodes.find((node) => node.id === originId);
  const target = workflow.nodes.find((node) => node.id === targetId);
  if (!origin?.outputs?.[originSlot] || !target?.inputs?.[targetSlot]) {
    fail("TEMPLATE.LINK_BINDING", "Pinned workflow link endpoints drifted.", "/template");
  }
  if (Array.isArray(origin.outputs[originSlot].links)) {
    origin.outputs[originSlot].links = origin.outputs[originSlot].links.filter((candidate) => candidate !== linkId);
  }
  if (target.inputs[targetSlot].link === linkId) target.inputs[targetSlot].link = null;
  workflow.links.splice(index, 1);
}

function connectNodes(workflow, allocator, origin, originSlot, target, targetSlot, type, fixedLinkId) {
  const output = origin.outputs?.[originSlot];
  const input = target.inputs?.[targetSlot];
  if (!output || !input || output.type !== type || input.type !== type || input.link !== null) {
    fail("COMPILER.DAG_LINK", "Long-video node slots do not match the pinned core contract.", "/graph");
  }
  const linkId = fixedLinkId ?? allocator.link();
  if (workflow.links.some((link) => Array.isArray(link) && link[0] === linkId)) {
    fail("COMPILER.ID_SPACE", "Long-video link ID collides with the source workflow.", "/graph");
  }
  if (!Array.isArray(output.links)) output.links = [];
  output.links.push(linkId);
  input.link = linkId;
  workflow.links.push([linkId, origin.id, originSlot, target.id, targetSlot, type]);
  return linkId;
}

function coreProperties(type, version) {
  return {
    "Node name for S&R": type,
    cnr_id: "comfy-core",
    ver: version,
  };
}

function primitiveIntControlNode({ id, order, pos, title, value, version = LONG_VIDEO_CORE_VERSION }) {
  return {
    id,
    type: "PrimitiveInt",
    pos,
    size: [320, 90],
    flags: {},
    order,
    mode: 0,
    inputs: [],
    outputs: [{ localized_name: "INT", name: "INT", type: "INT", links: [] }],
    title,
    properties: coreProperties("PrimitiveInt", version),
    widgets_values: [value, "fixed"],
    widgets_values_named: { value, fixed: "fixed" },
  };
}

function primitiveFloatControlNode({ id, order, pos, title, value, version = LONG_VIDEO_CORE_VERSION }) {
  return {
    id,
    type: "PrimitiveFloat",
    pos,
    size: [320, 80],
    flags: {},
    order,
    mode: 0,
    inputs: [],
    outputs: [{ localized_name: "FLOAT", name: "FLOAT", type: "FLOAT", links: [] }],
    title,
    properties: coreProperties("PrimitiveFloat", version),
    widgets_values: [value],
    widgets_values_named: { value },
  };
}

function primitiveBooleanControlNode({ id, order, pos, title, value, version = LONG_VIDEO_CORE_VERSION }) {
  return {
    id,
    type: "PrimitiveBoolean",
    pos,
    size: [320, 80],
    flags: {},
    order,
    mode: 0,
    inputs: [],
    outputs: [{ localized_name: "BOOLEAN", name: "BOOLEAN", type: "BOOLEAN", links: [] }],
    title,
    properties: coreProperties("PrimitiveBoolean", version),
    widgets_values: [value],
    widgets_values_named: { value },
  };
}

function nextWorkflowGroupId(workflow) {
  const used = new Set((workflow.groups ?? []).map((group) => group.id));
  let id = 1;
  while (used.has(id)) id += 1;
  return id;
}

function linkedWidgetInput(call, name, type, label) {
  if (!call.widgets_values_named || !Object.hasOwn(call.widgets_values_named, name)) {
    fail("TEMPLATE.WIDGET_BINDING", "Pinned visible control widget is missing.", "/template");
  }
  let inputIndex = call.inputs?.findIndex((input) => input.name === name) ?? -1;
  if (inputIndex < 0) {
    if (!Array.isArray(call.inputs)) fail("TEMPLATE.WIDGET_BINDING", "Pinned call inputs are invalid.", "/template");
    call.inputs.push({ label, name, type, widget: { name }, link: null });
    inputIndex = call.inputs.length - 1;
  }
  const input = call.inputs[inputIndex];
  if (!input || input.type !== type || input.link !== null) {
    fail("TEMPLATE.WIDGET_BINDING", "Pinned visible control input drifted.", "/template");
  }
  input.label = label;
  if (!input.widget || input.widget.name !== name) input.widget = { name };
  return inputIndex;
}

function exposeQualityStepsBoundary({ workflow, calls, project, allocator }) {
  const subgraphId = calls[0]?.type;
  if (typeof subgraphId !== "string" || calls.some((call) => call.type !== subgraphId)) {
    fail("COMPILER.VISIBLE_PARAMETERS", "Visible quality control calls do not share one certified subgraph.", "/graph");
  }
  const subgraph = workflow.definitions?.subgraphs?.find((candidate) => candidate.id === subgraphId);
  const inputId = QUALITY_STEPS_INPUT_IDS[subgraphId];
  if (!subgraph || !inputId || !Array.isArray(subgraph.inputs) || !Array.isArray(subgraph.links)) {
    fail("COMPILER.VISIBLE_PARAMETERS", "Certified subgraph cannot expose its quality step boundary.", "/graph/definitions");
  }
  if (subgraph.inputs.some((input) => input.name === "quality_steps" || input.id === inputId)) {
    fail("COMPILER.VISIBLE_PARAMETERS", "Quality step boundary is already present or ambiguous.", "/graph/definitions");
  }
  const qualitySteps = project.advanced.sampling_profile === "quality_25"
    ? OFFICIAL_FIXED_CAPABILITIES.high_quality_steps
    : OFFICIAL_FIXED_CAPABILITIES.quality_steps;
  const fullSteps = subgraph.nodes.filter((node) => node.type === "PrimitiveInt"
    && node.widgets_values?.[0] === qualitySteps
    && node.widgets_values?.[1] === "fixed"
    && node.widgets_values_named?.value === qualitySteps
    && node.widgets_values_named?.fixed === "fixed");
  if (fullSteps.length !== 1 || !Array.isArray(fullSteps[0].inputs) || fullSteps[0].inputs.length !== 0) {
    fail("COMPILER.VISIBLE_PARAMETERS", "Certified full-quality step node cannot accept a visible boundary.", "/graph/definitions");
  }

  const internalLinkId = allocator.link();
  const inputIndex = subgraph.inputs.length;
  const priorPos = subgraph.inputs.at(-1)?.pos;
  const inputPosition = Array.isArray(priorPos) && priorPos.length === 2
    ? [priorPos[0], priorPos[1] + 20]
    : [-2412.37890625, 5114];
  subgraph.inputs.push({
    id: inputId,
    name: "quality_steps",
    type: "INT",
    linkIds: [internalLinkId],
    label: "质量步数（由根图采样节点）",
    pos: inputPosition,
  });
  fullSteps[0].inputs.push({
    localized_name: "value",
    name: "value",
    type: "INT",
    widget: { name: "value" },
    link: internalLinkId,
  });
  subgraph.links.push({
    id: internalLinkId,
    origin_id: -10,
    origin_slot: inputIndex,
    target_id: fullSteps[0].id,
    target_slot: 0,
    type: "INT",
  });

  for (const call of calls) {
    if (!Array.isArray(call.widgets_values) || !call.widgets_values_named
      || Object.hasOwn(call.widgets_values_named, "quality_steps")) {
      fail("COMPILER.VISIBLE_PARAMETERS", "H3 call cannot expose a deterministic quality widget.", "/graph/nodes");
    }
    call.widgets_values.push(qualitySteps);
    call.widgets_values_named.quality_steps = qualitySteps;
  }
  return Object.freeze({
    subgraphId,
    inputId,
    inputIndex,
    internalLinkId,
    fullStepsNodeId: fullSteps[0].id,
    qualitySteps,
  });
}

function exposeSubgraphControls({ workflow, calls, project, seedPlan, selector }) {
  if (calls.length !== seedPlan.shots.length || calls.length === 0) {
    fail("COMPILER.VISIBLE_PARAMETERS", "Visible seed controls do not match the deterministic shot plan.", "/graph");
  }
  const allocator = idAllocator(workflow);
  const longDag = calls.length > 1;
  const selectorX = selector.pos[0];
  const selectorY = selector.pos[1];
  const seedNodeIds = [];
  const qualityBoundary = exposeQualityStepsBoundary({ workflow, calls, project, allocator });

  for (const [index, call] of calls.entries()) {
    const seed = seedPlan.shots[index].seed;
    const seedNode = primitiveIntControlNode({
      id: allocator.node(),
      order: allocator.order(),
      pos: longDag ? [call.pos[0], call.pos[1] - 130] : [selectorX, selectorY + 210],
      title: calls.length === 1
        ? `种子 · 基础/本镜 ${seed}`
        : `镜头 ${String(index + 1).padStart(2, "0")} 实际种子 · ${seed}`,
      value: seed,
    });
    workflow.nodes.push(seedNode);
    seedNodeIds.push(seedNode.id);
    const targetSlot = linkedWidgetInput(call, "noise_seed", "INT", "本镜实际种子（由种子节点）");
    connectNodes(workflow, allocator, seedNode, 0, call, targetSlot, "INT");
  }

  const turboEnabled = project.advanced.sampling_profile === "turbo_8";
  const controlY = longDag ? selectorY + 220 : selectorY - 490;
  const controlX = findFreeControlColumn(workflow, {
    initialX: selectorX,
    y: controlY,
    nodeIds: [],
    widths: [320, 320, 320, 320],
    heights: [90, 80, 80, 90],
    offsets: [0, 110, 220, 320],
  });
  const qualityStepsNode = primitiveIntControlNode({
    id: allocator.node(),
    order: allocator.order(),
    pos: [controlX, controlY],
    title: project.advanced.sampling_profile === "quality_25"
      ? "质量步数 · 高质量 25 步"
      : turboEnabled
        ? "质量步数 · 标准 20 步（Turbo 开启时旁路）"
        : "质量步数 · 标准 20 步",
    value: qualityBoundary.qualitySteps,
  });
  const turboEnabledNode = primitiveBooleanControlNode({
    id: allocator.node(),
    order: allocator.order(),
    pos: [controlX, controlY + 110],
    title: `Turbo 加速 · ${turboEnabled ? "开启" : "关闭"}`,
    value: turboEnabled,
  });
  const turboStrengthNode = primitiveFloatControlNode({
    id: allocator.node(),
    order: allocator.order(),
    pos: [controlX, controlY + 220],
    title: "Turbo LoRA 强度 · 开启时生效",
    value: OFFICIAL_FIXED_CAPABILITIES.turbo_model_strength,
  });
  const turboStepsNode = primitiveIntControlNode({
    id: allocator.node(),
    order: allocator.order(),
    pos: [controlX, controlY + 320],
    title: "Turbo 步数 · 开启时生效",
    value: OFFICIAL_FIXED_CAPABILITIES.turbo_steps,
  });
  workflow.nodes.push(qualityStepsNode, turboEnabledNode, turboStrengthNode, turboStepsNode);
  for (const call of calls) {
    connectNodes(
      workflow,
      allocator,
      qualityStepsNode,
      0,
      call,
      linkedWidgetInput(call, "quality_steps", "INT", "质量步数（由根图采样节点）"),
      "INT",
    );
    connectNodes(
      workflow,
      allocator,
      turboEnabledNode,
      0,
      call,
      linkedWidgetInput(call, "value", "BOOLEAN", "Turbo 加速（由采样节点）"),
      "BOOLEAN",
    );
    connectNodes(
      workflow,
      allocator,
      turboStrengthNode,
      0,
      call,
      linkedWidgetInput(call, "strength_model_1", "FLOAT", "Turbo LoRA 强度（由采样节点）"),
      "FLOAT",
    );
    connectNodes(
      workflow,
      allocator,
      turboStepsNode,
      0,
      call,
      linkedWidgetInput(call, "value_2", "INT", "Turbo 步数（由采样节点）"),
      "INT",
    );
  }

  const groupId = nextWorkflowGroupId(workflow);
  workflow.groups = [...(workflow.groups ?? []), {
    id: groupId,
    title: project.advanced.sampling_profile === "turbo_8"
      ? `采样与加速 · 当前实际 ${SAMPLING_PROFILE_LABELS[project.advanced.sampling_profile]} · 基础种子 ${seedPlan.base_seed}`
      : `采样与加速 · 当前实际 ${SAMPLING_PROFILE_LABELS[project.advanced.sampling_profile]} · 基础种子 ${seedPlan.base_seed}`,
    bounding: [controlX - 25, controlY - 45, 370, 475],
    color: turboEnabled ? "#8a641a" : "#3f789e",
    flags: {},
  }];

  return Object.freeze({
    kind: "subgraph",
    seed_node_ids: Object.freeze(seedNodeIds),
    seed_values: Object.freeze(seedPlan.shots.slice(0, calls.length).map((shot) => shot.seed)),
    quality_steps_node_id: qualityStepsNode.id,
    quality_steps_value: qualityBoundary.qualitySteps,
    quality_subgraph_id: qualityBoundary.subgraphId,
    quality_input_id: qualityBoundary.inputId,
    quality_input_index: qualityBoundary.inputIndex,
    quality_internal_link_id: qualityBoundary.internalLinkId,
    quality_internal_node_id: qualityBoundary.fullStepsNodeId,
    turbo_enabled_node_id: turboEnabledNode.id,
    turbo_strength_node_id: turboStrengthNode.id,
    turbo_steps_node_id: turboStepsNode.id,
    group_id: groupId,
  });
}

function paddedRectanglesOverlap(left, right, padding = 30) {
  return left.x < right.x + right.width + padding
    && left.x + left.width + padding > right.x
    && left.y < right.y + right.height + padding
    && left.y + left.height + padding > right.y;
}

function findFreeControlColumn(workflow, {
  initialX,
  y,
  nodeIds,
  widths,
  heights,
  offsets,
  step = 400,
}) {
  const excluded = new Set(nodeIds);
  const occupied = workflow.nodes
    .filter((node) => !excluded.has(node.id))
    .map((node) => ({
      x: node.pos?.[0],
      y: node.pos?.[1],
      width: node.size?.[0],
      height: node.size?.[1],
    }))
    .filter((rect) => Object.values(rect).every(Number.isFinite));
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const x = initialX + attempt * step;
    const candidates = offsets.map((offset, index) => ({
      x,
      y: y + offset,
      width: widths[index],
      height: heights[index],
    }));
    if (candidates.every((candidate) => occupied.every(
      (rect) => !paddedRectanglesOverlap(candidate, rect),
    ))) return x;
  }
  fail("COMPILER.VISIBLE_LAYOUT", "Visible control placement could not be resolved safely.", "/graph");
}

function arrangeRef2vaControls({ workflow, project, seedPlan, spec, selector }) {
  const noise = findNode(workflow, spec.noise_node_id, "RandomNoise");
  const fullSteps = findNode(workflow, spec.quality_projection.full_steps_node_id, "PrimitiveInt");
  const seed = seedPlan.shots[0]?.seed;
  if (!Number.isSafeInteger(seed)) {
    fail("COMPILER.VISIBLE_PARAMETERS", "Visible Ref2VA seed cannot be resolved.", "/graph");
  }
  noise.title = `种子 · 基础/本镜 ${seed}`;
  noise.size = [320, 90];
  const controlY = selector.pos[1];
  fullSteps.size = [320, 90];
  const controlX = findFreeControlColumn(workflow, {
    initialX: selector.pos[0] + 800,
    y: controlY,
    nodeIds: [noise.id, fullSteps.id],
    widths: [noise.size[0], fullSteps.size[0]],
    heights: [noise.size[1], fullSteps.size[1]],
    offsets: [0, 120],
  });
  noise.pos = [controlX, controlY];
  fullSteps.title = `采样步数 · ${SAMPLING_PROFILE_LABELS[project.advanced.sampling_profile]}`;
  fullSteps.pos = [controlX, controlY + 120];
  const groupId = nextWorkflowGroupId(workflow);
  workflow.groups = [...(workflow.groups ?? []), {
    id: groupId,
    title: `种子与采样 · ${SAMPLING_PROFILE_LABELS[project.advanced.sampling_profile]} · Ref2VA 不支持 Turbo`,
    bounding: [controlX - 25, controlY - 45, 370, 300],
    color: "#3f789e",
    flags: {},
  }];
  return Object.freeze({
    kind: "ref2va",
    seed_node_ids: Object.freeze([noise.id]),
    seed_values: Object.freeze([seed]),
    sampling_steps_node_id: fullSteps.id,
    group_id: groupId,
  });
}

function getVideoComponentsNode({ id, order, pos, version }) {
  return {
    id,
    type: "GetVideoComponents",
    pos,
    size: [230, 120],
    flags: {},
    order,
    mode: 0,
    inputs: [{ name: "video", type: "VIDEO", link: null }],
    outputs: [
      { name: "images", type: "IMAGE", links: [] },
      { name: "audio", type: "AUDIO", links: [] },
      { name: "fps", type: "FLOAT", links: null },
      { name: "bit_depth", type: "COMBO", links: null },
      { name: "color_space", type: "COMBO", links: null },
    ],
    properties: coreProperties("GetVideoComponents", version),
  };
}

function imageFromBatchNode({ id, order, pos, version, batchIndex, length, title }) {
  return {
    id,
    type: "ImageFromBatch",
    title,
    pos,
    size: [270, 140],
    flags: {},
    order,
    mode: 0,
    inputs: [
      { name: "image", type: "IMAGE", link: null },
      { name: "batch_index", type: "INT", widget: { name: "batch_index" }, link: null },
      { name: "length", type: "INT", widget: { name: "length" }, link: null },
    ],
    outputs: [{ name: "IMAGE", type: "IMAGE", links: [] }],
    properties: coreProperties("ImageFromBatch", version),
    widgets_values: [batchIndex, length],
    widgets_values_named: { batch_index: batchIndex, length },
  };
}

function batchImagesNode({ id, order, pos, version, title }) {
  return {
    id,
    type: "BatchImagesNode",
    title,
    pos,
    size: [210, 90],
    flags: {},
    order,
    mode: 0,
    inputs: [
      { label: "image0", localized_name: "images.image0", name: "images.image0", type: "IMAGE", link: null },
      { label: "image1", localized_name: "images.image1", name: "images.image1", shape: 7, type: "IMAGE", link: null },
      { label: "image2", localized_name: "images.image2", name: "images.image2", shape: 7, type: "IMAGE", link: null },
    ],
    outputs: [{ name: "IMAGE", type: "IMAGE", links: [] }],
    properties: coreProperties("BatchImagesNode", version),
  };
}

function audioConcatNode({ id, order, pos, version, title }) {
  return {
    id,
    type: "AudioConcat",
    title,
    pos,
    size: [240, 120],
    flags: {},
    order,
    mode: 0,
    inputs: [
      { name: "audio1", type: "AUDIO", link: null },
      { name: "audio2", type: "AUDIO", link: null },
    ],
    outputs: [{ name: "AUDIO", type: "AUDIO", links: [] }],
    properties: coreProperties("AudioConcat", version),
    widgets_values: ["after"],
    widgets_values_named: { direction: "after" },
  };
}

function createVideoNode({ prototype, id, order, pos }) {
  const node = structuredClone(prototype);
  node.id = id;
  node.title = "Assemble Complete Video · 24 fps";
  node.pos = pos;
  node.size = [270, 140];
  node.order = order;
  for (const input of node.inputs ?? []) input.link = null;
  for (const output of node.outputs ?? []) output.links = [];
  // ComfyUI v0.34.0 added the color_space widget and changed bit_depth to a
  // combo.  Keep all three values explicit so a newly installed official
  // Desktop serializes exactly the same contract.  Older 0.33.x frontends
  // ignore the trailing widget value while retaining the first two values.
  node.widgets_values = [OFFICIAL_FIXED_CAPABILITIES.fps, 8, "sRGB"];
  node.widgets_values_named = {
    ...(node.widgets_values_named ?? {}),
    fps: OFFICIAL_FIXED_CAPABILITIES.fps,
    bit_depth: 8,
    color_space: "sRGB",
  };
  return node;
}

function videoSliceNode({ id, order, pos, version, duration }) {
  return {
    id,
    type: "Video Slice",
    title: `Trim Complete Video · ${duration}s`,
    pos,
    size: [270, 170],
    flags: {},
    order,
    mode: 0,
    inputs: [
      { name: "video", type: "VIDEO", link: null },
      { name: "start_time", type: "FLOAT", widget: { name: "start_time" }, link: null },
      { name: "duration", type: "FLOAT", widget: { name: "duration" }, link: null },
      { name: "strict_duration", type: "BOOLEAN", widget: { name: "strict_duration" }, link: null },
    ],
    outputs: [{ name: "VIDEO", type: "VIDEO", links: [] }],
    properties: coreProperties("Video Slice", version),
    widgets_values: [0, duration, true],
    widgets_values_named: { start_time: 0, duration, strict_duration: true },
  };
}

function prepareLongEndpointNodes({ workflow, allocator, spec, project, calls }) {
  if (project.mode === "t2v") return [];
  const imageNode = findNode(workflow, spec.image_node_id, "LoadImage");
  if (!Array.isArray(imageNode.outputs?.[0]?.links)) imageNode.outputs[0].links = [];
  imageNode.outputs[0].links = [];
  for (const call of calls) {
    const first = call.inputs.find((input) => input.name === "first_frame");
    const last = call.inputs.find((input) => input.name === "last_frame");
    if (!first || !last) fail("TEMPLATE.ENDPOINT_BINDING", "Pinned endpoint slots drifted.", "/template");
    first.link = null;
    last.link = null;
  }

  const used = [];
  const hasFirst = project.mode === "first_frame" || project.mode === "first_last_frame";
  const hasLast = project.mode === "last_frame" || project.mode === "first_last_frame";
  if (hasFirst) {
    bindImageNode(imageNode, project.endpoints.first_frame);
    imageNode.title = "User First Frame";
    imageNode.pos = [-450, 80];
    connectNodes(
      workflow,
      allocator,
      imageNode,
      0,
      calls[0],
      calls[0].inputs.findIndex((input) => input.name === "first_frame"),
      "IMAGE",
      spec.image_link_id,
    );
    used.push(imageNode.id);
  }
  if (hasLast) {
    const lastImage = hasFirst ? structuredClone(imageNode) : imageNode;
    if (hasFirst) {
      lastImage.id = allocator.node();
      lastImage.outputs[0].links = [];
      workflow.nodes.push(lastImage);
    }
    bindImageNode(lastImage, project.endpoints.last_frame);
    lastImage.title = "User Last Frame";
    const imageHeight = Number.isFinite(lastImage.size?.[1]) ? lastImage.size[1] : 630;
    lastImage.pos = [-450, hasFirst ? 80 + imageHeight + 40 : 80];
    const finalCall = calls.at(-1);
    connectNodes(
      workflow,
      allocator,
      lastImage,
      0,
      finalCall,
      finalCall.inputs.findIndex((input) => input.name === "last_frame"),
      "IMAGE",
    );
    used.push(lastImage.id);
  }
  return used;
}

function buildLongVideoDag({ workflow, project, plan, segmentPrompts, seedPlan, spec, call, subgraph, outputPrefix }) {
  if (!plan.single_workflow_dag || plan.segment_count < 2 || project.mode === "ref2va") {
    fail("COMPILER.LONG_DAG_MODE", "Long-video DAG was requested for an unsupported plan.", "/duration");
  }
  const allocator = idAllocator(workflow);
  const saveVideo = workflow.nodes.find((node) => node.type === "SaveVideo");
  const oldSaveLink = saveVideo?.inputs?.[0]?.link;
  if (!Number.isSafeInteger(oldSaveLink)) fail("TEMPLATE.OUTPUT_BINDING", "Pinned SaveVideo link is missing.", "/template");
  detachLink(workflow, oldSaveLink);

  if (spec.image_link_id !== undefined) detachLink(workflow, spec.image_link_id);
  for (const name of ["first_frame", "last_frame"]) {
    const input = call.inputs.find((candidate) => candidate.name === name);
    if (!input) fail("TEMPLATE.ENDPOINT_BINDING", "Pinned endpoint slots drifted.", "/template");
    input.link = null;
  }

  const columns = Math.min(4, plan.segment_count);
  const calls = [call];
  const selector = findNode(workflow, spec.resolution_node_id, "ResolutionSelector");
  const canvas = resolvedCanvas(project);
  selector.title = `分辨率 · ${canvas.width}×${canvas.height} · ${project.resolution_megapixels} MP`;
  selector.pos = [80, 80];
  call.title = h3CallTitle({
    mode: plan.segments[0].mode,
    samplingProfile: project.advanced.sampling_profile,
    segment: { ...plan.segments[0], total_segments: plan.segment_count },
    seed: seedPlan.shots[0].seed,
    baseSeed: seedPlan.base_seed,
  });
  call.pos = [430, 80];
  call.outputs[0].links = [];
  setNamedWidget(call, "prompt", 0, segmentPrompts[0]);

  for (let index = 1; index < plan.segment_count; index += 1) {
    const clone = structuredClone(call);
    clone.id = allocator.node();
    clone.order = allocator.order();
    clone.title = h3CallTitle({
      mode: plan.segments[index].mode,
      samplingProfile: project.advanced.sampling_profile,
      segment: { ...plan.segments[index], total_segments: plan.segment_count },
      seed: seedPlan.shots[index].seed,
      baseSeed: seedPlan.base_seed,
    });
    setNamedWidget(clone, "prompt", 0, segmentPrompts[index]);
    setNamedWidget(clone, "value_1", 3, plan.segments[index].duration);
    setNamedWidget(clone, "noise_seed", 4, seedPlan.shots[index].seed);
    const column = index % columns;
    const row = Math.floor(index / columns);
    clone.pos = [430 + column * 800, 80 + row * 760];
    for (const input of clone.inputs) input.link = null;
    for (const output of clone.outputs) output.links = [];
    workflow.nodes.push(clone);
    calls.push(clone);
    for (const [name, sourceSlot] of [["width", 0], ["height", 1]]) {
      const targetSlot = clone.inputs.findIndex((input) => input.name === name);
      connectNodes(workflow, allocator, selector, sourceSlot, clone, targetSlot, "INT");
    }
  }

  const endpointNodeIds = prepareLongEndpointNodes({ workflow, allocator, spec, project, calls });
  // These nodes are authored by this compiler (not copied from the immutable
  // upstream H3 templates), so their metadata follows the exact Core schema we
  // serialize below.
  const version = LONG_VIDEO_CORE_VERSION;
  const components = [];
  const tails = [];
  const slices = [];
  const tailBoundaryIndexes = [];
  const sliceSegmentIndexes = [];
  const sliceBySegmentIndex = new Map();
  for (let index = 0; index < calls.length; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = 950 + column * 800;
    const y = 80 + row * 760;
    const component = getVideoComponentsNode({
      id: allocator.node(),
      order: allocator.order(),
      pos: [x, y],
      version,
    });
    const incomingTransition = transitionLabel(plan.segments[index].transition_from_previous);
    component.title = `拆分镜头 ${String(index + 1).padStart(2, "0")}${incomingTransition ? ` · ${incomingTransition}` : ""}`;
    workflow.nodes.push(component);
    components.push(component);
    connectNodes(workflow, allocator, calls[index], 0, component, 0, "VIDEO");

    if (index < calls.length - 1 && plan.transitions[index] === "tail_frame_continuation") {
      const tail = imageFromBatchNode({
        id: allocator.node(),
        order: allocator.order(),
        pos: [x, y + 170],
        version,
        batchIndex: -1,
        length: 1,
        title: `尾帧延续 · 镜头 ${String(index + 1).padStart(2, "0")} → ${String(index + 2).padStart(2, "0")}`,
      });
      workflow.nodes.push(tail);
      tails.push(tail);
      tailBoundaryIndexes.push(index + 1);
      connectNodes(workflow, allocator, component, 0, tail, 0, "IMAGE");
      const nextFirstSlot = calls[index + 1].inputs.findIndex((input) => input.name === "first_frame");
      connectNodes(workflow, allocator, tail, 0, calls[index + 1], nextFirstSlot, "IMAGE");
    }

    if (index > 0 && plan.transitions[index - 1] === "tail_frame_continuation") {
      const slice = imageFromBatchNode({
        id: allocator.node(),
        order: allocator.order(),
        pos: [x, y + 350],
        version,
        batchIndex: 1,
        length: plan.segments[index].generated_frames - 1,
        title: `尾帧延续 · 去除镜头 ${String(index + 1).padStart(2, "0")} 重复首帧`,
      });
      workflow.nodes.push(slice);
      slices.push(slice);
      sliceSegmentIndexes.push(index + 1);
      sliceBySegmentIndex.set(index, slice);
      connectNodes(workflow, allocator, component, 0, slice, 0, "IMAGE");
    }
  }

  const rows = Math.ceil(plan.segment_count / columns);
  const assemblyY = 80 + rows * 760 + 80;
  let imageOrigin = components[0];
  let imageOriginSlot = 0;
  const imageBatches = [];
  for (let index = 1; index < components.length; index += 1) {
    const transition = plan.transitions[index - 1];
    const node = batchImagesNode({
      id: allocator.node(),
      order: allocator.order(),
      pos: [430 + (index - 1) * 250, assemblyY],
      version,
      title: `拼接画面 01–${String(index + 1).padStart(2, "0")} · ${transitionLabel(transition)}`,
    });
    workflow.nodes.push(node);
    imageBatches.push(node);
    connectNodes(workflow, allocator, imageOrigin, imageOriginSlot, node, 0, "IMAGE");
    const incomingFrames = transition === "tail_frame_continuation"
      ? sliceBySegmentIndex.get(index)
      : components[index];
    if (!incomingFrames) fail("COMPILER.DAG_TRANSITION", "Transition frame source is missing.", "/transitions");
    connectNodes(workflow, allocator, incomingFrames, 0, node, 1, "IMAGE");
    imageOrigin = node;
    imageOriginSlot = 0;
  }

  let audioOrigin = components[0];
  let audioOriginSlot = 1;
  const audioConcats = [];
  for (let index = 1; index < components.length; index += 1) {
    const transition = plan.transitions[index - 1];
    const node = audioConcatNode({
      id: allocator.node(),
      order: allocator.order(),
      pos: [430 + (index - 1) * 250, assemblyY + 170],
      version,
      title: `拼接音频 01–${String(index + 1).padStart(2, "0")} · ${transitionLabel(transition)}`,
    });
    workflow.nodes.push(node);
    audioConcats.push(node);
    connectNodes(workflow, allocator, audioOrigin, audioOriginSlot, node, 0, "AUDIO");
    connectNodes(workflow, allocator, components[index], 1, node, 1, "AUDIO");
    audioOrigin = node;
    audioOriginSlot = 0;
  }

  const createPrototype = subgraph.nodes.find((node) => node.type === "CreateVideo");
  if (!createPrototype) fail("TEMPLATE.OUTPUT_BINDING", "Pinned CreateVideo prototype is missing.", "/template");
  const create = createVideoNode({
    prototype: createPrototype,
    id: allocator.node(),
    order: allocator.order(),
    pos: [430 + Math.max(1, plan.segment_count - 1) * 250 + 100, assemblyY],
  });
  workflow.nodes.push(create);
  connectNodes(workflow, allocator, imageOrigin, imageOriginSlot, create, 0, "IMAGE");
  connectNodes(workflow, allocator, audioOrigin, audioOriginSlot, create, 1, "AUDIO");
  const trim = videoSliceNode({
    id: allocator.node(),
    order: allocator.order(),
    pos: [create.pos[0] + create.size[0] + 100, assemblyY],
    version,
    duration: project.duration,
  });
  workflow.nodes.push(trim);
  connectNodes(workflow, allocator, create, 0, trim, 0, "VIDEO");
  connectNodes(workflow, allocator, trim, 0, saveVideo, 0, "VIDEO");
  bindSaveOutput(workflow, { ...plan.segments[0], total_segments: plan.segment_count }, {
    completeLongOutput: true,
    outputPrefix,
  });

  const existingGroupIds = new Set((workflow.groups ?? []).map((group) => group.id));
  let nextGroupId = 1;
  const segmentGroups = calls.map((segmentCall, index) => {
    while (existingGroupIds.has(nextGroupId)) nextGroupId += 1;
    const id = nextGroupId;
    existingGroupIds.add(id);
    nextGroupId += 1;
    return {
      id,
      title: `镜头 ${String(index + 1).padStart(2, "0")} · ${plan.segments[index].duration} 秒${plan.segments[index].transition_from_previous ? ` · ${transitionLabel(plan.segments[index].transition_from_previous)}` : ""}`,
      bounding: [segmentCall.pos[0] - 30, segmentCall.pos[1] - 45, 790, 700],
      color: "#3f789e",
      flags: {},
    };
  });
  workflow.groups = [...(workflow.groups ?? []), ...segmentGroups];

  return Object.freeze({
    call_node_ids: Object.freeze(calls.map((node) => node.id)),
    component_node_ids: Object.freeze(components.map((node) => node.id)),
    tail_node_ids: Object.freeze(tails.map((node) => node.id)),
    tail_boundary_indexes: Object.freeze(tailBoundaryIndexes),
    slice_node_ids: Object.freeze(slices.map((node) => node.id)),
    slice_segment_indexes: Object.freeze(sliceSegmentIndexes),
    image_batch_node_ids: Object.freeze(imageBatches.map((node) => node.id)),
    audio_concat_node_ids: Object.freeze(audioConcats.map((node) => node.id)),
    endpoint_node_ids: Object.freeze(endpointNodeIds),
    create_video_node_id: create.id,
    video_slice_node_id: trim.id,
    save_video_node_id: saveVideo.id,
  });
}

export async function compileProject(projectInput, options = {}) {
  const project = validateProjectSpec(projectInput);
  const plan = createSegmentPlan(project);
  const seedPlan = resolveCompileSeedPlan(project, plan, options);
  const segmentPrompts = createSegmentPrompts(project, plan);
  const outputAttribution = options.outputAttribution === undefined
    ? null
    : createWorkflowOutputAttribution(options.outputAttribution);
  const outputPrefix = outputAttribution?.output_prefix ?? null;
  const compiled = [];

  if (plan.single_workflow_dag) {
    const segment = Object.freeze({ ...plan.segments[0], total_segments: plan.segment_count });
    const templateKind = project.mode === "t2v" ? "t2v" : "i2v";
    const loaded = await loadTemplate(templateKind);
    const workflow = structuredClone(loaded.workflow);
    const { spec, call } = bindCommon(
      workflow,
      templateKind,
      project,
      segment,
      segmentPrompts[0],
      seedPlan.shots[0].seed,
      outputPrefix,
      seedPlan.base_seed,
    );
    const subgraph = workflow.definitions?.subgraphs?.find((candidate) => candidate.id === spec.subgraph_id);
    if (!subgraph) fail("TEMPLATE.SUBGRAPH_BINDING", "Pinned H3 subgraph is missing.", "/template");
    const longDag = buildLongVideoDag({
      workflow,
      project,
      plan,
      segmentPrompts,
      seedPlan,
      spec,
      call,
      subgraph,
      outputPrefix,
    });
    const visibleControls = exposeSubgraphControls({
      workflow,
      calls: longDag.call_node_ids.map((nodeId) => findNode(workflow, nodeId, spec.subgraph_id)),
      project,
      seedPlan,
      selector: findNode(workflow, spec.resolution_node_id, "ResolutionSelector"),
    });
    compactVisibleLayout(workflow, { longDag: true });
    if (outputAttribution !== null) applyWorkflowOutputAttribution(workflow, options.outputAttribution);
    attachSeedPlan(workflow, seedPlan);
    const lint = lintCompiledWorkflow({
      workflow,
      sourceWorkflow: loaded.workflow,
      templateKind,
      mode: project.mode,
      spec,
      referenceImageCount: 0,
      project,
      plan,
      longDag,
      seedPlan,
      visibleControls,
      callExpectations: plan.segments.map((entry, index) => Object.freeze({
        prompt: segmentPrompts[index],
        duration: entry.duration,
        generatedFrames: entry.generated_frames,
        seed: seedPlan.shots[index].seed,
      })),
    });
    compiled.push(Object.freeze({
      segment,
      included_segments: Object.freeze(plan.segments.map((entry) => entry.index)),
      workflow,
      template: loaded.authority,
      lint,
    }));
    return Object.freeze({
      project,
      plan,
      seed_plan: seedPlan,
      output_attribution: outputAttribution,
      workflows: Object.freeze(compiled),
    });
  }

  for (const segmentBase of plan.segments.filter((segment) => segment.workflow_status === "ready")) {
    const segment = Object.freeze({ ...segmentBase, total_segments: plan.segment_count });
    const templateKind = segment.mode === "t2v" ? "t2v" : segment.mode === "ref2va" ? "r2v" : "i2v";
    const loaded = await loadTemplate(templateKind);
    const workflow = structuredClone(loaded.workflow);
    const shotSeed = seedPlan.shots[segment.index - 1].seed;
    const { spec, call } = templateKind === "r2v"
      ? bindRef2va(
        workflow,
        project,
        segment,
        segmentPrompts[segment.index - 1],
        shotSeed,
        outputPrefix,
        seedPlan.base_seed,
      )
      : bindCommon(
        workflow,
        templateKind,
        project,
        segment,
        segmentPrompts[segment.index - 1],
        shotSeed,
        outputPrefix,
        seedPlan.base_seed,
      );
    if (templateKind === "i2v") bindEndpoints(workflow, spec, call, segment);
    const selector = findNode(workflow, spec.resolution_node_id, "ResolutionSelector");
    const visibleControls = templateKind === "r2v"
      ? arrangeRef2vaControls({ workflow, project, seedPlan, spec, selector })
      : exposeSubgraphControls({ workflow, calls: [call], project, seedPlan, selector });
    compactVisibleLayout(workflow);
    if (outputAttribution !== null) applyWorkflowOutputAttribution(workflow, options.outputAttribution);
    attachSeedPlan(workflow, seedPlan);
    const lint = lintCompiledWorkflow({
      workflow,
      sourceWorkflow: loaded.workflow,
      templateKind,
      mode: segment.mode,
      spec,
      referenceImageCount: segment.endpoints?.reference_images?.length ?? 0,
      project,
      plan,
      seedPlan,
      visibleControls,
      callExpectations: [Object.freeze({
        prompt: segmentPrompts[segment.index - 1],
        duration: segment.duration,
        generatedFrames: segment.generated_frames,
        seed: shotSeed,
      })],
    });
    compiled.push(Object.freeze({ segment, workflow, template: loaded.authority, lint }));
  }
  return Object.freeze({
    project,
    plan,
    seed_plan: seedPlan,
    output_attribution: outputAttribution,
    workflows: Object.freeze(compiled),
  });
}
