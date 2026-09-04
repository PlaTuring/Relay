import { lintStaticGraph } from "../../static-graph-lint/src/index.mjs";
import { documents } from "../../static-graph-lint/src/certified-h3-documents.mjs";
import {
  CANVASES,
  FORBIDDEN_CLASS_TYPES,
  LONG_DAG_CORE_CLASS_TYPES,
  MAX_GRAPH_NODES,
  MAX_SUBGRAPHS,
  OFFICIAL_FIXED_CAPABILITIES,
  PROTECTED_CLASS_TYPES,
  resolveCanvasSize,
  SAMPLING_PROFILE_STEPS,
} from "./constants.mjs";
import { canonicalJson } from "./canonical.mjs";
import { fail } from "./errors.mjs";
import { structureFingerprint } from "./template.mjs";

const SUSPICIOUS_CLASS = /(?:^|[_-])(?:api|partner|auth|cloud|upload|proxy|provider|endpoint|credential|token|secret|remote)(?:[_-]|$)/i;
const CONTROL_KEYS = new Set(["autoqueue", "runonload", "submit", "enqueue"]);
const SELECTOR_CANVASES = Object.freeze({
  "1:1 (Square)": "1:1",
  "2:3 (Portrait Photo)": "2:3",
  "3:2 (Photo)": "3:2",
  "3:4 (Portrait Standard)": "3:4",
  "4:3 (Standard)": "4:3",
  "9:16 (Portrait Widescreen)": "9:16",
  "16:9 (Widescreen)": "16:9",
  "21:9 (Ultrawide)": "21:9",
});
const SAMPLING_PROFILE_LABELS = Object.freeze({
  quality_20: "标准 20 步",
  quality_25: "高质量 25 步",
  turbo_8: "Turbo 8 步",
});

function normalizedKey(value) {
  return value.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
}

function scanControls(value, path = "/graph", seen = new Set()) {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) fail("GRAPH.NON_JSON_ALIAS", "Graph contains a non-JSON alias.", path);
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) scanControls(value[index], `${path}/${index}`, seen);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const normalized = normalizedKey(key);
    if (CONTROL_KEYS.has(normalized)) fail("GRAPH.AUTO_EXECUTION", "Automatic execution control is forbidden.", `${path}/${key}`);
    if (["action", "hook", "endpoint"].includes(normalized) && typeof child === "string"
      && /(?:^|[/:])(?:prompt|queue)(?:[/?#]|$)/i.test(child)) {
      fail("GRAPH.AUTO_EXECUTION", "Automatic execution target is forbidden.", `${path}/${key}`);
    }
    if (!["prompt", "text", "title", "widgetsvalues", "widgetsvaluesnamed"].includes(normalized)) {
      scanControls(child, `${path}/${key}`, seen);
    }
  }
}

function normalizedGraphLink(value, path) {
  if (Array.isArray(value)) {
    if (value.length !== 6) fail("GRAPH.LINK_SHAPE", "Workflow link shape is invalid.", path);
    return Object.freeze({
      id: value[0],
      origin: value[1],
      originSlot: value[2],
      target: value[3],
      targetSlot: value[4],
      type: value[5],
    });
  }
  if (!value || typeof value !== "object") fail("GRAPH.LINK_SHAPE", "Workflow link shape is invalid.", path);
  return Object.freeze({
    id: value.id,
    origin: value.origin_id,
    originSlot: value.origin_slot,
    target: value.target_id,
    targetSlot: value.target_slot,
    type: value.type,
  });
}

function slotSupportsType(slot, type) {
  if (!slot || typeof slot !== "object" || typeof type !== "string" || type.length === 0) return false;
  if (slot.type === type) return true;
  if (Array.isArray(slot.type)) return slot.type.includes(type);
  return typeof slot.type === "string"
    && slot.type.split(",").map((candidate) => candidate.trim()).includes(type);
}

function declaredLinkIds(slot, key, path) {
  const value = slot?.[key];
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) fail("GRAPH.LINK_BOOKKEEPING", "Workflow slot link bookkeeping is invalid.", path);
  const seen = new Set();
  for (const id of value) {
    if (!Number.isSafeInteger(id) || id < 0 || seen.has(id)) {
      fail("GRAPH.LINK_BOOKKEEPING", "Workflow slot link bookkeeping is invalid or duplicated.", path);
    }
    seen.add(id);
  }
  return value;
}

function sameLinkIds(actual, expected) {
  return actual.length === expected.length
    && actual.every((id) => expected.includes(id));
}

function validateGraphLinks(graph, scope, ids, globalLinkIds) {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const normalized = [];
  const linkIds = new Set();
  const outgoing = new Map();
  const incoming = new Map();
  const boundaryInputs = Array.isArray(graph.inputs) ? graph.inputs : [];
  const boundaryOutputs = Array.isArray(graph.outputs) ? graph.outputs : [];

  for (let index = 0; index < graph.links.length; index += 1) {
    const path = `${scope}/links/${index}`;
    const link = normalizedGraphLink(graph.links[index], path);
    if (!Number.isSafeInteger(link.id) || link.id < 0 || linkIds.has(link.id) || globalLinkIds.has(link.id)
      || !Number.isSafeInteger(link.originSlot) || link.originSlot < 0
      || !Number.isSafeInteger(link.targetSlot) || link.targetSlot < 0
      || typeof link.type !== "string" || link.type.length === 0) {
      fail("GRAPH.LINK_ID", "Workflow link identity, slot, or type is invalid or duplicated.", path);
    }
    linkIds.add(link.id);
    globalLinkIds.add(link.id);

    const originSlot = link.origin === -10
      ? boundaryInputs[link.originSlot]
      : nodes.get(link.origin)?.outputs?.[link.originSlot];
    const targetSlot = link.target === -20
      ? boundaryOutputs[link.targetSlot]
      : nodes.get(link.target)?.inputs?.[link.targetSlot];
    if (!originSlot || !targetSlot || !slotSupportsType(originSlot, link.type) || !slotSupportsType(targetSlot, link.type)) {
      fail("GRAPH.LINK_ENDPOINT", "Workflow link endpoint, slot, or type does not exist in the graph.", path);
    }
    if ((link.origin === -10 && boundaryInputs.length === 0)
      || (link.target === -20 && boundaryOutputs.length === 0)
      || (link.origin !== -10 && !nodes.has(link.origin))
      || (link.target !== -20 && !nodes.has(link.target))) {
      fail("GRAPH.LINK_ENDPOINT", "Workflow link endpoint is outside the current graph.", path);
    }

    const originKey = `${String(link.origin)}\0${link.originSlot}`;
    const targetKey = `${String(link.target)}\0${link.targetSlot}`;
    const originIds = outgoing.get(originKey) ?? [];
    originIds.push(link.id);
    outgoing.set(originKey, originIds);
    const targetIds = incoming.get(targetKey) ?? [];
    targetIds.push(link.id);
    incoming.set(targetKey, targetIds);
    if (targetIds.length !== 1) {
      fail("GRAPH.LINK_INPUT_AMBIGUOUS", "Workflow input has multiple incoming links.", path);
    }
    normalized.push(link);
  }

  for (const node of graph.nodes) {
    for (let slotIndex = 0; slotIndex < (node.outputs?.length ?? 0); slotIndex += 1) {
      const expected = outgoing.get(`${String(node.id)}\0${slotIndex}`) ?? [];
      const actual = declaredLinkIds(node.outputs[slotIndex], "links", `${scope}/nodes/${String(node.id)}/outputs/${slotIndex}`);
      if (!sameLinkIds(actual, expected)) {
        fail("GRAPH.LINK_BOOKKEEPING", "Workflow output links do not match the graph link table.", `${scope}/nodes/${String(node.id)}/outputs/${slotIndex}`);
      }
    }
    for (let slotIndex = 0; slotIndex < (node.inputs?.length ?? 0); slotIndex += 1) {
      const expected = incoming.get(`${String(node.id)}\0${slotIndex}`) ?? [];
      const declared = node.inputs[slotIndex]?.link;
      if (expected.length === 0 ? declared !== null && declared !== undefined : declared !== expected[0]) {
        fail("GRAPH.LINK_BOOKKEEPING", "Workflow input link does not match the graph link table.", `${scope}/nodes/${String(node.id)}/inputs/${slotIndex}`);
      }
    }
  }
  for (let slotIndex = 0; slotIndex < boundaryInputs.length; slotIndex += 1) {
    const expected = outgoing.get(`-10\0${slotIndex}`) ?? [];
    const actual = declaredLinkIds(boundaryInputs[slotIndex], "linkIds", `${scope}/inputs/${slotIndex}`);
    if (!sameLinkIds(actual, expected)) {
      fail("GRAPH.LINK_BOOKKEEPING", "Subgraph input links do not match the graph link table.", `${scope}/inputs/${slotIndex}`);
    }
  }
  for (let slotIndex = 0; slotIndex < boundaryOutputs.length; slotIndex += 1) {
    const expected = incoming.get(`-20\0${slotIndex}`) ?? [];
    const actual = declaredLinkIds(boundaryOutputs[slotIndex], "linkIds", `${scope}/outputs/${slotIndex}`);
    if (!sameLinkIds(actual, expected)) {
      fail("GRAPH.LINK_BOOKKEEPING", "Subgraph output links do not match the graph link table.", `${scope}/outputs/${slotIndex}`);
    }
  }

  if (Object.hasOwn(graph, "last_node_id")) {
    const numericIds = [...ids].filter((id) => Number.isSafeInteger(id));
    const maximum = numericIds.length === 0 ? 0 : Math.max(...numericIds);
    if (!Number.isSafeInteger(graph.last_node_id) || graph.last_node_id < maximum) {
      fail("GRAPH.LAST_NODE_ID", "Workflow last_node_id is behind the emitted node IDs.", `${scope}/last_node_id`);
    }
  }
  if (Object.hasOwn(graph, "last_link_id")) {
    const maximum = linkIds.size === 0 ? 0 : Math.max(...linkIds);
    if (!Number.isSafeInteger(graph.last_link_id) || graph.last_link_id < maximum) {
      fail("GRAPH.LAST_LINK_ID", "Workflow last_link_id is behind the emitted link IDs.", `${scope}/last_link_id`);
    }
  }
  return normalized;
}

function collectGraph(graph, scope, records, definitions, globalLinkIds) {
  if (!graph || typeof graph !== "object" || !Array.isArray(graph.nodes) || !Array.isArray(graph.links)) {
    fail("GRAPH.SHAPE", "Workflow graph shape is invalid.", scope);
  }
  if (graph.nodes.length > MAX_GRAPH_NODES) fail("GRAPH.NODE_LIMIT", "Workflow node limit exceeded.", `${scope}/nodes`);
  const ids = new Set();
  for (const node of graph.nodes) {
    if (!node || typeof node !== "object" || !(typeof node.id === "string" || Number.isSafeInteger(node.id)) || ids.has(String(node.id))) {
      fail("GRAPH.NODE_ID", "Workflow node identity is invalid or duplicated.", `${scope}/nodes`);
    }
    ids.add(String(node.id));
    if (typeof node.type !== "string" || node.type.length === 0 || node.type.length > 160) {
      fail("GRAPH.CLASS_TYPE", "Workflow class type is invalid.", `${scope}/nodes`);
    }
    if (node.mode !== 0) {
      fail("GRAPH.NODE_MODE", "Every emitted execution node must remain enabled.", `${scope}/nodes/${String(node.id)}/mode`);
    }
    records.push({ scope, node });
  }
  validateGraphLinks(graph, scope, new Set(graph.nodes.map((node) => node.id)), globalLinkIds);
  const subgraphs = graph.definitions?.subgraphs ?? [];
  if (!Array.isArray(subgraphs) || subgraphs.length > MAX_SUBGRAPHS) {
    fail("GRAPH.SUBGRAPH_LIMIT", "Workflow subgraph definitions are invalid.", `${scope}/definitions`);
  }
  for (const subgraph of subgraphs) {
    if (!subgraph || typeof subgraph.id !== "string" || subgraph.id.length === 0 || definitions.has(subgraph.id)) {
      fail("GRAPH.SUBGRAPH_ID", "Workflow subgraph identity is invalid or duplicated.", `${scope}/definitions`);
    }
    definitions.add(subgraph.id);
    collectGraph(subgraph, `${scope}/definitions/${subgraph.id}`, records, definitions, globalLinkIds);
  }
}

function typeCounts(records) {
  const result = new Map();
  for (const { node } of records) result.set(node.type, (result.get(node.type) ?? 0) + 1);
  return result;
}

function selectorDimensions(aspectRatio, megapixels, multiple) {
  const canvas = SELECTOR_CANVASES[aspectRatio];
  const size = resolveCanvasSize(canvas, megapixels);
  if (!canvas || !size || !Number.isInteger(multiple) || multiple !== 32) {
    fail("GRAPH.RESOLUTION_SELECTOR", "ResolutionSelector widgets are outside the pinned official contract.", "/graph/nodes");
  }
  return [size.width, size.height];
}

function exactLink(workflow, { origin, originSlot, target, targetSlot, type }) {
  const matches = workflow.links.filter((link) => Array.isArray(link)
    && link[1] === origin && link[2] === originSlot
    && link[3] === target && link[4] === targetSlot && link[5] === type);
  if (matches.length !== 1) fail("GRAPH.DAG_LINK", "Long-video DAG link is absent or ambiguous.", "/graph/links");
  const linkId = matches[0][0];
  const originNode = workflow.nodes.find((node) => node.id === origin);
  const targetNode = workflow.nodes.find((node) => node.id === target);
  if (!originNode?.outputs?.[originSlot]?.links?.includes(linkId)
    || targetNode?.inputs?.[targetSlot]?.link !== linkId) {
    fail("GRAPH.DAG_LINK", "Long-video DAG slot bookkeeping does not match its visible link.", "/graph/links");
  }
  return linkId;
}

function nodeById(workflow, id, type) {
  const matches = workflow.nodes.filter((node) => node.id === id && node.type === type);
  if (matches.length !== 1) fail("GRAPH.DAG_NODE", "Long-video DAG node is absent or ambiguous.", "/graph/nodes");
  return matches[0];
}

function nodeRectangle(node) {
  if (!Array.isArray(node.pos) || node.pos.length !== 2 || !Array.isArray(node.size) || node.size.length !== 2
    || !node.pos.every(Number.isFinite) || !node.size.every(Number.isFinite)
    || node.size[0] < 0 || node.size[1] < 0) {
    fail("GRAPH.NODE_GEOMETRY", "Visible node geometry is invalid.", `/graph/nodes/${String(node.id)}`);
  }
  return Object.freeze({
    left: node.pos[0],
    top: node.pos[1],
    right: node.pos[0] + node.size[0],
    bottom: node.pos[1] + node.size[1],
  });
}

function rectanglesOverlap(left, right) {
  return left.right > right.left && right.right > left.left
    && left.bottom > right.top && right.bottom > left.top;
}

function validateVisibleNodeGeometry(workflow) {
  const visible = workflow.nodes.filter((node) => Array.isArray(node.pos) && Array.isArray(node.size));
  const rectangles = visible.map((node) => [node, nodeRectangle(node)]);
  for (let leftIndex = 0; leftIndex < rectangles.length; leftIndex += 1) {
    const [leftNode, left] = rectangles[leftIndex];
    if (left.right === left.left || left.bottom === left.top) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < rectangles.length; rightIndex += 1) {
      const [rightNode, right] = rectangles[rightIndex];
      if (right.right === right.left || right.bottom === right.top) continue;
      if (rectanglesOverlap(left, right)) {
        fail(
          "GRAPH.NODE_COLLISION",
          `Visible nodes ${String(leftNode.id)} and ${String(rightNode.id)} overlap.`,
          "/graph/nodes",
        );
      }
    }
  }
}

function groupContainsNodes(group, nodes) {
  if (!Array.isArray(group?.bounding) || group.bounding.length !== 4 || !group.bounding.every(Number.isFinite)) return false;
  const [left, top, width, height] = group.bounding;
  return width >= 0 && height >= 0 && nodes.every((node) => {
    const rectangle = nodeRectangle(node);
    return rectangle.left >= left && rectangle.top >= top
      && rectangle.right <= left + width && rectangle.bottom <= top + height;
  });
}

function exactWidget(node, name, index, expected, code, path = "/graph/nodes") {
  if (!Array.isArray(node.widgets_values) || node.widgets_values[index] !== expected
    || !node.widgets_values_named || node.widgets_values_named[name] !== expected) {
    fail(code, `Certified widget ${name} drifted from its effective value.`, path);
  }
}

function relativeScope(scope) {
  return scope.replace(/^\/(?:source|graph)/u, "");
}

function validateCertifiedModelWidgets(records, sourceRecords, templateKind, spec, calls) {
  const sourceByIdentity = new Map(sourceRecords.map(({ scope, node }) => (
    [`${relativeScope(scope)}\0${String(node.id)}\0${node.type}`, node]
  )));
  const modelWidget = new Map([
    ["UNETLoader", "unet_name"],
    ["CLIPLoader", "clip_name"],
    ["VAELoader", "vae_name"],
    ["LoraLoaderModelOnly", "lora_name"],
  ]);
  for (const { scope, node } of records) {
    const name = modelWidget.get(node.type);
    if (name === undefined) continue;
    const source = sourceByIdentity.get(`${relativeScope(scope)}\0${String(node.id)}\0${node.type}`);
    if (!source || typeof source.widgets_values_named?.[name] !== "string") {
      fail("GRAPH.MODEL_CONTRACT", "Certified model loader is absent from the immutable template.", `${scope}/nodes/${String(node.id)}`);
    }
    exactWidget(
      node,
      name,
      0,
      source.widgets_values_named[name],
      "GRAPH.MODEL_CONTRACT",
      `${scope}/nodes/${String(node.id)}`,
    );
  }

  if (templateKind === "r2v") return;
  const sourceCall = nodeById(sourceRecords.find(({ scope }) => scope === "/source")
    ? { nodes: sourceRecords.filter(({ scope }) => scope === "/source").map(({ node }) => node) }
    : { nodes: [] }, spec.call_node_id, spec.subgraph_id);
  for (const call of calls) {
    for (const [name, index] of [
      ["unet_name", 5],
      ["clip_name", 6],
      ["vae_name", 7],
      ["vae_name_1", 8],
      ["lora_name", 10],
    ]) {
      const expected = sourceCall.widgets_values_named?.[name];
      if (typeof expected !== "string") {
        fail("GRAPH.MODEL_CONTRACT", "Certified H3 model boundary is absent from the immutable template.", "/source/nodes");
      }
      exactWidget(call, name, index, expected, "GRAPH.MODEL_CONTRACT");
    }
  }
}

function validateFixedSamplingControls(records) {
  for (const { scope, node } of records) {
    const path = `${scope}/nodes/${String(node.id)}`;
    if (node.type === "KSamplerSelect") {
      exactWidget(node, "sampler_name", 0, OFFICIAL_FIXED_CAPABILITIES.sampler, "GRAPH.SAMPLER_CONTRACT", path);
    }
    if (node.type === "BasicScheduler") {
      exactWidget(node, "scheduler", 0, OFFICIAL_FIXED_CAPABILITIES.scheduler, "GRAPH.SCHEDULER_CONTRACT", path);
      exactWidget(node, "denoise", 2, OFFICIAL_FIXED_CAPABILITIES.denoise, "GRAPH.DENOISE_CONTRACT", path);
    }
  }
}

function rootLinkById(workflow, linkId) {
  const matches = workflow.links.filter((link) => Array.isArray(link) && link[0] === linkId);
  if (matches.length !== 1) fail("GRAPH.MEDIA_LINK", "Media input link is absent or ambiguous.", "/graph/links");
  return matches[0];
}

function loadImageLocator(node, expected, path) {
  if (node.type !== "LoadImage" || node.widgets_values?.[0] !== expected || node.widgets_values?.[1] !== "image"
    || node.widgets_values_named?.image !== expected
    || (Object.hasOwn(node.widgets_values_named ?? {}, "upload") && node.widgets_values_named.upload !== "image")) {
    fail("GRAPH.MEDIA_LOCATOR", "LoadImage does not use the exact staged media locator.", path);
  }
}

function validateImageInput(workflow, call, inputName, expectedLocator, expectedNodeId = undefined) {
  const slot = call.inputs?.findIndex((input) => input.name === inputName);
  const input = call.inputs?.[slot];
  if (slot < 0 || !Number.isSafeInteger(input?.link)) {
    fail("GRAPH.MEDIA_BINDING", "Required H3 image input is not connected.", "/graph/nodes");
  }
  const link = rootLinkById(workflow, input.link);
  const node = workflow.nodes.find((candidate) => candidate.id === link[1]);
  if (!node || link[2] !== 0 || link[3] !== call.id || link[4] !== slot || link[5] !== "IMAGE"
    || (expectedNodeId !== undefined && node.id !== expectedNodeId)) {
    fail("GRAPH.MEDIA_BINDING", "H3 image input is connected to the wrong source or slot.", "/graph/links");
  }
  loadImageLocator(node, expectedLocator, `/graph/nodes/${String(node.id)}`);
  return node.id;
}

function validateFl2vaImages(workflow, project, calls, spec, longDag) {
  if (project.mode === "t2v") return;
  const hasFirst = project.mode === "first_frame" || project.mode === "first_last_frame";
  const hasLast = project.mode === "last_frame" || project.mode === "first_last_frame";
  const firstCall = calls[0];
  const lastCall = calls.at(-1);
  const used = [];
  if (hasFirst) {
    used.push(validateImageInput(workflow, firstCall, "first_frame", project.endpoints.first_frame, spec.image_node_id));
  } else if (!longDag && firstCall.inputs?.find((input) => input.name === "first_frame")?.link !== null) {
    fail("GRAPH.MEDIA_BINDING", "Unused first-frame input must remain disconnected.", "/graph/nodes");
  }
  if (hasLast) {
    const expectedNodeId = hasFirst ? undefined : spec.image_node_id;
    const nodeId = validateImageInput(workflow, lastCall, "last_frame", project.endpoints.last_frame, expectedNodeId);
    if (used.includes(nodeId)) fail("GRAPH.MEDIA_BINDING", "First and last frame must use distinct LoadImage nodes.", "/graph/nodes");
    used.push(nodeId);
  } else if (!longDag && lastCall.inputs?.find((input) => input.name === "last_frame")?.link !== null) {
    fail("GRAPH.MEDIA_BINDING", "Unused last-frame input must remain disconnected.", "/graph/nodes");
  }
  if (longDag && canonicalJson([...used].sort((a, b) => a - b))
    !== canonicalJson([...longDag.endpoint_node_ids].sort((a, b) => a - b))) {
    fail("GRAPH.MEDIA_BINDING", "Long-video endpoint metadata does not identify the exact staged images.", "/graph/nodes");
  }
}

function validateRef2vaImages(workflow, call, project, spec) {
  const references = project.endpoints?.reference_images;
  if (!Array.isArray(references)) fail("GRAPH.REFERENCE_BINDING", "Ref2VA reference list is absent.", "/endpoints/reference_images");
  for (let index = 0; index < 2; index += 1) {
    const inputName = `ref_images.ref_image_${index}`;
    const input = call.inputs?.find((candidate) => candidate.name === inputName);
    if (index >= references.length) {
      if (!input || input.link !== null) fail("GRAPH.REFERENCE_BINDING", "Unused Ref2VA reference slot must remain disconnected.", "/graph/nodes");
      continue;
    }
    const nodeId = validateImageInput(workflow, call, inputName, references[index], spec.image_node_ids[index]);
    const link = rootLinkById(workflow, input.link);
    if (nodeId !== spec.image_node_ids[index] || link[0] !== spec.image_link_ids[index]) {
      fail("GRAPH.REFERENCE_BINDING", "Ref2VA reference order drifted from the validated project.", "/graph/links");
    }
  }
}

function validateCallParameters(workflow, templateKind, calls, expectations, spec) {
  if (!Array.isArray(expectations) || expectations.length !== calls.length) {
    fail("GRAPH.CALL_PARAMETERS", "H3 call expectations do not match the emitted calls.", "/graph/nodes");
  }
  for (const [index, call] of calls.entries()) {
    const expected = expectations[index];
    if (!expected || typeof expected.prompt !== "string" || !Number.isSafeInteger(expected.generatedFrames)) {
      fail("GRAPH.CALL_PARAMETERS", "H3 call expectation is invalid.", "/graph/nodes");
    }
    if (templateKind === "r2v") {
      exactWidget(call, "prompt", 0, expected.prompt, "GRAPH.PROMPT_BINDING");
      exactWidget(call, "length", 3, expected.generatedFrames, "GRAPH.DURATION_BINDING");
      exactWidget(call, "ref_image_size", 4, "match", "GRAPH.REFERENCE_BINDING");
      const promptNode = nodeById(workflow, spec.prompt_node_id, "PrimitiveStringMultiline");
      const durationNode = nodeById(workflow, spec.duration_node_id, "PrimitiveFloat");
      exactWidget(promptNode, "value", 0, expected.prompt, "GRAPH.PROMPT_BINDING");
      exactWidget(durationNode, "value", 0, expected.duration, "GRAPH.DURATION_BINDING");
    } else {
      exactWidget(call, "prompt", 0, expected.prompt, "GRAPH.PROMPT_BINDING");
      exactWidget(call, "value_1", 3, expected.duration, "GRAPH.DURATION_BINDING");
      exactWidget(call, "noise_seed", 4, expected.seed, "GRAPH.SEED_BINDING");
    }
  }
}

function validateVisibleControls(workflow, templateKind, project, seedPlan, controls, calls, spec) {
  if (!controls || !Array.isArray(controls.seed_node_ids)
    || !Array.isArray(controls.seed_values)
    || controls.seed_node_ids.length !== calls.length
    || controls.seed_values.length !== calls.length
    || seedPlan.shots.length < calls.length) {
    fail("GRAPH.VISIBLE_CONTROLS", "Visible control metadata does not match the compiled shots.", "/graph");
  }
  const profileLabel = SAMPLING_PROFILE_LABELS[project.advanced.sampling_profile];
  const group = (workflow.groups ?? []).find((candidate) => candidate.id === controls.group_id);
  if (!profileLabel || !group || !group.title.includes(profileLabel)) {
    fail("GRAPH.VISIBLE_CONTROLS", "Visible sampling group does not identify the active profile.", "/graph/groups");
  }

  if (templateKind === "r2v") {
    if (controls.kind !== "ref2va" || controls.seed_node_ids[0] !== spec.noise_node_id
      || controls.sampling_steps_node_id !== spec.quality_projection?.full_steps_node_id) {
      fail("GRAPH.VISIBLE_CONTROLS", "Ref2VA visible controls do not match the pinned execution nodes.", "/graph/nodes");
    }
    const noise = nodeById(workflow, controls.seed_node_ids[0], "RandomNoise");
    const steps = nodeById(workflow, controls.sampling_steps_node_id, "PrimitiveInt");
    if (!groupContainsNodes(group, [noise, steps])) {
      fail("GRAPH.VISIBLE_GROUP", "Ref2VA sampling group does not contain its visible controls.", "/graph/groups");
    }
    const seed = seedPlan.shots[0].seed;
    if (controls.seed_values[0] !== seed) {
      fail("GRAPH.VISIBLE_SEED", "Visible Ref2VA seed metadata does not match the deterministic seed plan.", "/graph/nodes");
    }
    if (noise.widgets_values_named?.noise_seed !== seed || noise.widgets_values?.[0] !== seed
      || noise.widgets_values_named?.control_after_generate !== "fixed" || noise.widgets_values?.[1] !== "fixed"
      || !noise.title?.includes(String(seed))) {
      fail("GRAPH.VISIBLE_SEED", "Visible Ref2VA seed node does not match the deterministic seed plan.", "/graph/nodes");
    }
    const activeSteps = SAMPLING_PROFILE_STEPS[project.advanced.sampling_profile];
    if (steps.widgets_values_named?.value !== activeSteps || steps.widgets_values?.[0] !== activeSteps
      || !steps.title?.includes(profileLabel)) {
      fail("GRAPH.VISIBLE_SAMPLING", "Visible Ref2VA sampling node does not match the active profile.", "/graph/nodes");
    }
    return;
  }

  if (controls.kind !== "subgraph") {
    fail("GRAPH.VISIBLE_CONTROLS", "H3 subgraph visible controls are missing.", "/graph/nodes");
  }
  if (!group.title.includes(`基础种子 ${seedPlan.base_seed}`)) {
    fail("GRAPH.VISIBLE_CONTROLS", "Visible sampling group does not truthfully identify the base seed.", "/graph/groups");
  }
  for (const [index, call] of calls.entries()) {
    const seed = seedPlan.shots[index].seed;
    if (controls.seed_values[index] !== seed) {
      fail("GRAPH.VISIBLE_SEED", "Visible seed metadata does not match the deterministic shot seed.", "/graph/nodes");
    }
    const seedNode = nodeById(workflow, controls.seed_node_ids[index], "PrimitiveInt");
    if (seedNode.widgets_values_named?.value !== seed || seedNode.widgets_values?.[0] !== seed
      || seedNode.widgets_values_named?.fixed !== "fixed" || seedNode.widgets_values?.[1] !== "fixed"
      || !seedNode.title?.includes(String(seed)) || call.widgets_values_named?.noise_seed !== seed) {
      fail("GRAPH.VISIBLE_SEED", "Visible seed node does not match the deterministic shot seed.", "/graph/nodes");
    }
    const targetSlot = call.inputs?.findIndex((input) => input.name === "noise_seed");
    if (targetSlot < 0) fail("GRAPH.VISIBLE_SEED", "Visible seed input is missing from the H3 call.", "/graph/nodes");
    exactLink(workflow, {
      origin: seedNode.id,
      originSlot: 0,
      target: call.id,
      targetSlot,
      type: "INT",
    });
  }

  const turboEnabled = project.advanced.sampling_profile === "turbo_8";
  const qualitySteps = project.advanced.sampling_profile === "quality_25"
    ? OFFICIAL_FIXED_CAPABILITIES.high_quality_steps
    : OFFICIAL_FIXED_CAPABILITIES.quality_steps;
  if (controls.quality_steps_value !== qualitySteps) {
    fail("GRAPH.VISIBLE_SAMPLING", "Visible quality metadata does not match the certified profile.", "/graph/nodes");
  }
  const qualityStepsNode = nodeById(workflow, controls.quality_steps_node_id, "PrimitiveInt");
  const turboEnabledNode = nodeById(workflow, controls.turbo_enabled_node_id, "PrimitiveBoolean");
  const turboStrengthNode = nodeById(workflow, controls.turbo_strength_node_id, "PrimitiveFloat");
  const turboStepsNode = nodeById(workflow, controls.turbo_steps_node_id, "PrimitiveInt");
  if (!groupContainsNodes(group, [qualityStepsNode, turboEnabledNode, turboStrengthNode, turboStepsNode])) {
    fail("GRAPH.VISIBLE_GROUP", "Sampling group does not contain its visible quality and Turbo controls.", "/graph/groups");
  }
  if (qualityStepsNode.widgets_values_named?.value !== qualitySteps || qualityStepsNode.widgets_values?.[0] !== qualitySteps
    || qualityStepsNode.widgets_values_named?.fixed !== "fixed" || qualityStepsNode.widgets_values?.[1] !== "fixed"
    || !qualityStepsNode.title?.includes(String(qualitySteps))
    || turboEnabledNode.widgets_values_named?.value !== turboEnabled || turboEnabledNode.widgets_values?.[0] !== turboEnabled
    || turboStrengthNode.widgets_values_named?.value !== OFFICIAL_FIXED_CAPABILITIES.turbo_model_strength
    || turboStrengthNode.widgets_values?.[0] !== OFFICIAL_FIXED_CAPABILITIES.turbo_model_strength
    || turboStepsNode.widgets_values_named?.value !== OFFICIAL_FIXED_CAPABILITIES.turbo_steps
    || turboStepsNode.widgets_values?.[0] !== OFFICIAL_FIXED_CAPABILITIES.turbo_steps
    || turboStepsNode.widgets_values_named?.fixed !== "fixed" || turboStepsNode.widgets_values?.[1] !== "fixed") {
    fail("GRAPH.VISIBLE_SAMPLING", "Visible Turbo controls do not match the certified profile.", "/graph/nodes");
  }
  for (const call of calls) {
    for (const [node, name, type] of [
      [qualityStepsNode, "quality_steps", "INT"],
      [turboEnabledNode, "value", "BOOLEAN"],
      [turboStrengthNode, "strength_model_1", "FLOAT"],
      [turboStepsNode, "value_2", "INT"],
    ]) {
      const targetSlot = call.inputs?.findIndex((input) => input.name === name);
      if (targetSlot < 0) fail("GRAPH.VISIBLE_SAMPLING", "Visible Turbo input is missing from the H3 call.", "/graph/nodes");
      exactLink(workflow, { origin: node.id, originSlot: 0, target: call.id, targetSlot, type });
    }
    if (call.widgets_values_named?.quality_steps !== qualitySteps
      || call.widgets_values?.at(-1) !== qualitySteps
      || call.widgets_values_named?.value !== turboEnabled
      || call.widgets_values_named?.strength_model_1 !== OFFICIAL_FIXED_CAPABILITIES.turbo_model_strength
      || call.widgets_values_named?.value_2 !== OFFICIAL_FIXED_CAPABILITIES.turbo_steps) {
      fail("GRAPH.VISIBLE_SAMPLING", "H3 widgets disagree with their visible Turbo controls.", "/graph/nodes");
    }
  }

  const subgraph = workflow.definitions?.subgraphs?.find((candidate) => candidate.id === controls.quality_subgraph_id);
  if (!subgraph || subgraph.id !== calls[0]?.type || !Array.isArray(subgraph.inputs)
    || !Array.isArray(subgraph.links) || !Number.isSafeInteger(controls.quality_input_index)
    || controls.quality_input_index !== subgraph.inputs.length - 1) {
    fail("GRAPH.VISIBLE_SAMPLING", "Certified quality boundary metadata is invalid.", "/graph/definitions");
  }
  const qualityInput = subgraph.inputs[controls.quality_input_index];
  if (!qualityInput || qualityInput.id !== controls.quality_input_id || qualityInput.name !== "quality_steps"
    || qualityInput.type !== "INT" || qualityInput.label !== "质量步数（由根图采样节点）"
    || canonicalJson(qualityInput.linkIds) !== canonicalJson([controls.quality_internal_link_id])) {
    fail("GRAPH.VISIBLE_SAMPLING", "Certified quality boundary input drifted.", "/graph/definitions");
  }
  const internalSteps = subgraph.nodes?.find((node) => node.id === controls.quality_internal_node_id);
  const internalInput = internalSteps?.inputs?.[0];
  if (!internalSteps || internalSteps.type !== "PrimitiveInt" || internalSteps.inputs?.length !== 1
    || internalInput?.name !== "value" || internalInput.type !== "INT"
    || internalInput.widget?.name !== "value" || internalInput.link !== controls.quality_internal_link_id
    || internalSteps.widgets_values_named?.value !== qualitySteps || internalSteps.widgets_values?.[0] !== qualitySteps) {
    fail("GRAPH.VISIBLE_SAMPLING", "Certified internal quality step binding drifted.", "/graph/definitions");
  }
  const internalLinks = subgraph.links.filter((link) => !Array.isArray(link)
    && link.id === controls.quality_internal_link_id);
  if (internalLinks.length !== 1 || internalLinks[0].origin_id !== -10
    || internalLinks[0].origin_slot !== controls.quality_input_index
    || internalLinks[0].target_id !== internalSteps.id || internalLinks[0].target_slot !== 0
    || internalLinks[0].type !== "INT") {
    fail("GRAPH.VISIBLE_SAMPLING", "Certified internal quality step link drifted.", "/graph/definitions");
  }
}

function stripCertifiedQualityBoundaryForFingerprint(compiledSubgraphs, controls) {
  if (controls?.kind !== "subgraph") return compiledSubgraphs;
  const subgraph = compiledSubgraphs.subgraphs?.find((candidate) => candidate.id === controls.quality_subgraph_id);
  if (!subgraph) return compiledSubgraphs;
  subgraph.inputs.splice(controls.quality_input_index, 1);
  subgraph.links = subgraph.links.filter((link) => !(!Array.isArray(link)
    && link.id === controls.quality_internal_link_id));
  const internalSteps = subgraph.nodes?.find((node) => node.id === controls.quality_internal_node_id);
  if (internalSteps) internalSteps.inputs = [];
  return compiledSubgraphs;
}

function protectedProjection(records, templateKind) {
  const requiredH3Class = templateKind === "r2v"
    ? "MiniMaxH3ReferenceToVideo"
    : "MiniMaxH3ImageToVideo";
  const protectedSet = new Set(templateKind === "r2v"
    ? ["CreateVideo", "SaveVideo"]
    : PROTECTED_CLASS_TYPES.filter((type) => type !== "MiniMaxH3ReferenceToVideo"));
  const nodes = records
    .filter(({ node }) => protectedSet.has(node.type))
    .map(({ scope, node }, index) => ({ id: `${index}:${scope}:${node.id}`, type: node.type }));
  const allPresent = new Set(records.map(({ node }) => node.type));
  for (const required of [requiredH3Class, "CreateVideo", "SaveVideo"]) {
    if (!allPresent.has(required)) fail("GRAPH.REQUIRED_CLASS", "Certified local workflow class is missing.", "/graph");
  }
  const present = new Set(nodes.map((node) => node.type));
  for (const required of ["CreateVideo", "SaveVideo"]) {
    if (!present.has(required)) fail("GRAPH.REQUIRED_CLASS", "Certified local workflow class is missing.", "/graph");
  }
  const { allowlist, descriptors } = documents();
  const result = lintStaticGraph({ kind: "visual", graph: { version: 0.4, nodes, links: [] }, allowlist, descriptors });
  if (!result.ok || result.authority_binding !== "static_authority_binding") {
    fail("GRAPH.STATIC_LINT_REJECTED", "Canonical protected-node projection was rejected.", "/graph");
  }
  return Object.freeze({
    digest: result.digest,
    authority_binding: result.authority_binding,
    pinned_h3_class_type: requiredH3Class,
  });
}

function validateLongDag(workflow, project, plan, dag, calls) {
  const count = plan.segment_count;
  const tailBoundaryIndexes = plan.transitions
    .map((transition, index) => transition === "tail_frame_continuation" ? index + 1 : null)
    .filter((index) => index !== null);
  const sliceSegmentIndexes = tailBoundaryIndexes.map((index) => index + 1);
  const tailCount = tailBoundaryIndexes.length;
  const expectedArrayLengths = [
    [dag.call_node_ids, count],
    [dag.component_node_ids, count],
    [dag.tail_node_ids, tailCount],
    [dag.tail_boundary_indexes, tailCount],
    [dag.slice_node_ids, tailCount],
    [dag.slice_segment_indexes, tailCount],
    [dag.image_batch_node_ids, count - 1],
    [dag.audio_concat_node_ids, count - 1],
  ];
  if (expectedArrayLengths.some(([value, length]) => !Array.isArray(value) || value.length !== length)) {
    fail("GRAPH.DAG_SHAPE", "Long-video DAG metadata does not match the segment plan.", "/graph");
  }
  if (canonicalJson(dag.tail_boundary_indexes) !== canonicalJson(tailBoundaryIndexes)
    || canonicalJson(dag.slice_segment_indexes) !== canonicalJson(sliceSegmentIndexes)) {
    fail("GRAPH.DAG_TRANSITIONS", "Long-video DAG transition indexes do not match the segment plan.", "/graph");
  }

  const components = dag.component_node_ids.map((id) => nodeById(workflow, id, "GetVideoComponents"));
  const tails = dag.tail_node_ids.map((id) => nodeById(workflow, id, "ImageFromBatch"));
  const slices = dag.slice_node_ids.map((id) => nodeById(workflow, id, "ImageFromBatch"));
  const tailsByBoundary = new Map(tailBoundaryIndexes.map((boundaryIndex, index) => [boundaryIndex, tails[index]]));
  const slicesBySegment = new Map(sliceSegmentIndexes.map((segmentIndex, index) => [segmentIndex, slices[index]]));
  const imageBatches = dag.image_batch_node_ids.map((id) => nodeById(workflow, id, "BatchImagesNode"));
  const audioConcats = dag.audio_concat_node_ids.map((id) => nodeById(workflow, id, "AudioConcat"));

  const componentSchema = [
    { name: "images", type: "IMAGE" },
    { name: "audio", type: "AUDIO" },
    { name: "fps", type: "FLOAT" },
    { name: "bit_depth", type: "COMBO" },
    { name: "color_space", type: "COMBO" },
  ];
  for (const component of components) {
    if (component.properties?.ver !== "0.34.0") {
      fail("GRAPH.DAG_VIDEO_COMPONENTS_VERSION", "Generated GetVideoComponents nodes must declare ComfyUI Core v0.34.0.", "/graph/nodes");
    }
    if (canonicalJson(component.outputs.map(({ name, type }) => ({ name, type }))) !== canonicalJson(componentSchema)) {
      fail("GRAPH.DAG_VIDEO_COMPONENTS", "GetVideoComponents outputs do not match the pinned ComfyUI v0.34.0 schema.", "/graph/nodes");
    }
  }

  for (let index = 0; index < count; index += 1) {
    exactLink(workflow, { origin: calls[index].id, originSlot: 0, target: components[index].id, targetSlot: 0, type: "VIDEO" });
    if (index < count - 1) {
      const transition = plan.transitions[index];
      const nextFirstSlot = calls[index + 1].inputs.findIndex((input) => input.name === "first_frame");
      if (transition === "tail_frame_continuation") {
        const tail = tailsByBoundary.get(index + 1);
        if (!tail || canonicalJson(tail.widgets_values) !== canonicalJson([-1, 1])) {
          fail("GRAPH.DAG_TAIL", "Continuity extractor must select exactly the prior segment final frame.", "/graph/nodes");
        }
        exactLink(workflow, { origin: components[index].id, originSlot: 0, target: tail.id, targetSlot: 0, type: "IMAGE" });
        exactLink(workflow, { origin: tail.id, originSlot: 0, target: calls[index + 1].id, targetSlot: nextFirstSlot, type: "IMAGE" });
      } else if (transition === "hard_cut") {
        if (calls[index + 1].inputs[nextFirstSlot]?.link !== null) {
          fail("GRAPH.DAG_HARD_CUT", "Hard cut must not connect the prior segment final frame.", "/graph/nodes");
        }
      } else {
        fail("GRAPH.DAG_TRANSITIONS", "Long-video DAG contains an unsupported transition.", "/transitions");
      }
    }
    if (index > 0 && plan.transitions[index - 1] === "tail_frame_continuation") {
      const slice = slicesBySegment.get(index + 1);
      if (!slice || canonicalJson(slice.widgets_values) !== canonicalJson([1, plan.segments[index].generated_frames - 1])) {
        fail("GRAPH.DAG_JOIN_FRAME", "Joined tail-continuation frames must remove exactly one repeated frame.", "/graph/nodes");
      }
      exactLink(workflow, { origin: components[index].id, originSlot: 0, target: slice.id, targetSlot: 0, type: "IMAGE" });
    }
  }

  for (let index = 0; index < count - 1; index += 1) {
    const imageOrigin = index === 0 ? components[0] : imageBatches[index - 1];
    if (canonicalJson(imageBatches[index].inputs.map((input) => ({
      name: input.name,
      label: input.label,
      type: input.type,
      shape: input.shape ?? null,
    }))) !== canonicalJson([
      { name: "images.image0", label: "image0", type: "IMAGE", shape: null },
      { name: "images.image1", label: "image1", type: "IMAGE", shape: 7 },
      { name: "images.image2", label: "image2", type: "IMAGE", shape: 7 },
    ])) {
      fail("GRAPH.DAG_IMAGE_BATCH", "BatchImagesNode inputs do not match the pinned current core schema.", "/graph/nodes");
    }
    exactLink(workflow, { origin: imageOrigin.id, originSlot: 0, target: imageBatches[index].id, targetSlot: 0, type: "IMAGE" });
    const incomingFrames = plan.transitions[index] === "tail_frame_continuation"
      ? slicesBySegment.get(index + 2)
      : components[index + 1];
    if (!incomingFrames) fail("GRAPH.DAG_TRANSITIONS", "Transition frame source is missing.", "/graph");
    exactLink(workflow, { origin: incomingFrames.id, originSlot: 0, target: imageBatches[index].id, targetSlot: 1, type: "IMAGE" });
    const audioOrigin = index === 0 ? components[0] : audioConcats[index - 1];
    if (canonicalJson(audioConcats[index].widgets_values) !== canonicalJson(["after"])) {
      fail("GRAPH.DAG_AUDIO", "Audio segments must use ordered AudioConcat(after).", "/graph/nodes");
    }
    exactLink(workflow, { origin: audioOrigin.id, originSlot: index === 0 ? 1 : 0, target: audioConcats[index].id, targetSlot: 0, type: "AUDIO" });
    exactLink(workflow, { origin: components[index + 1].id, originSlot: 1, target: audioConcats[index].id, targetSlot: 1, type: "AUDIO" });
  }

  const create = nodeById(workflow, dag.create_video_node_id, "CreateVideo");
  const trim = nodeById(workflow, dag.video_slice_node_id, "Video Slice");
  const save = nodeById(workflow, dag.save_video_node_id, "SaveVideo");
  if (canonicalJson(create.widgets_values) !== canonicalJson([24, 8, "sRGB"])) {
    fail("GRAPH.DAG_CREATE_VIDEO", "Final CreateVideo must remain pinned to 24 fps, 8-bit sRGB output.", "/graph/nodes");
  }
  if (canonicalJson(trim.widgets_values) !== canonicalJson([0, project.duration, true])) {
    fail("GRAPH.DAG_TRIM", "Final Video Slice must trim to the exact requested total duration.", "/graph/nodes");
  }
  exactLink(workflow, { origin: imageBatches.at(-1).id, originSlot: 0, target: create.id, targetSlot: 0, type: "IMAGE" });
  exactLink(workflow, { origin: audioConcats.at(-1).id, originSlot: 0, target: create.id, targetSlot: 1, type: "AUDIO" });
  exactLink(workflow, { origin: create.id, originSlot: 0, target: trim.id, targetSlot: 0, type: "VIDEO" });
  exactLink(workflow, { origin: trim.id, originSlot: 0, target: save.id, targetSlot: 0, type: "VIDEO" });

  const hasFirst = project.mode === "first_frame" || project.mode === "first_last_frame";
  const hasLast = project.mode === "last_frame" || project.mode === "first_last_frame";
  const firstInput = calls[0].inputs.find((input) => input.name === "first_frame");
  const lastInput = calls.at(-1).inputs.find((input) => input.name === "last_frame");
  if (hasFirst !== Number.isSafeInteger(firstInput?.link) || hasLast !== Number.isSafeInteger(lastInput?.link)) {
    fail("GRAPH.DAG_ENDPOINT", "Long-video user endpoint bindings do not match the selected mode.", "/graph/nodes");
  }
  if (save.size?.[0] < 360 || save.size?.[0] > 420 || save.size?.[1] > 200) {
    fail("GRAPH.SAVE_LAYOUT", "SaveVideo must remain compact in the visible graph.", "/graph/nodes");
  }
}

export function lintCompiledWorkflow({
  workflow,
  sourceWorkflow,
  templateKind,
  mode,
  spec,
  referenceImageCount = 0,
  project,
  plan,
  longDag,
  seedPlan,
  visibleControls,
  callExpectations,
}) {
  scanControls(workflow);
  const sourceRecords = [];
  const sourceDefinitions = new Set();
  collectGraph(sourceWorkflow, "/source", sourceRecords, sourceDefinitions, new Set());
  const records = [];
  const definitions = new Set();
  collectGraph(workflow, "/graph", records, definitions, new Set());

  if (canonicalJson([...definitions].sort()) !== canonicalJson([...sourceDefinitions].sort())) {
    fail("GRAPH.HIDDEN_SUBGRAPH", "Compiled subgraph identities differ from the immutable template.", "/graph/definitions");
  }
  const trustedTypes = new Set(sourceRecords.map(({ node }) => node.type));
  for (const definition of definitions) trustedTypes.add(definition);
  if (longDag) for (const type of LONG_DAG_CORE_CLASS_TYPES) trustedTypes.add(type);
  for (const { node } of records) {
    if (FORBIDDEN_CLASS_TYPES.includes(node.type)) fail("GRAPH.PARTNER_API_NODE", "Partner/API node is forbidden.", "/graph/nodes");
    if (SUSPICIOUS_CLASS.test(node.type)) fail("GRAPH.REMOTE_OR_AUTH_NODE", "Remote/auth class identity is forbidden.", "/graph/nodes");
    if (!trustedTypes.has(node.type)) fail("GRAPH.UNKNOWN_CLASS_TYPE", "Unknown class identity is forbidden.", "/graph/nodes");
  }

  const expectedCounts = typeCounts(sourceRecords);
  expectedCounts.set("MarkdownNote", 0);
  expectedCounts.set("ImageScaleToTotalPixels", 0);
  expectedCounts.set("GetImageSize", 0);
  if (mode === "first_last_frame") expectedCounts.set("LoadImage", (expectedCounts.get("LoadImage") ?? 0) + 1);
  if (mode === "ref2va") {
    expectedCounts.set("LoadImage", referenceImageCount);
    expectedCounts.set("ComfySwitchNode", 0);
    expectedCounts.set("LoraLoaderModelOnly", 0);
    expectedCounts.set("PrimitiveBoolean", 0);
    expectedCounts.set("PrimitiveInt", (expectedCounts.get("PrimitiveInt") ?? 0) - 1);
  }
  if (longDag) {
    const count = plan.segment_count;
    const tailCount = plan.transitions.filter((transition) => transition === "tail_frame_continuation").length;
    const callType = spec.subgraph_id;
    expectedCounts.set(callType, (expectedCounts.get(callType) ?? 0) + count - 1);
    expectedCounts.set("GetVideoComponents", count);
    expectedCounts.set("ImageFromBatch", tailCount * 2);
    expectedCounts.set("BatchImagesNode", count - 1);
    expectedCounts.set("AudioConcat", count - 1);
    expectedCounts.set("CreateVideo", (expectedCounts.get("CreateVideo") ?? 0) + 1);
    expectedCounts.set("Video Slice", 1);
  }
  if (visibleControls?.kind === "subgraph") {
    expectedCounts.set("PrimitiveInt", (expectedCounts.get("PrimitiveInt") ?? 0) + visibleControls.seed_node_ids.length + 2);
    expectedCounts.set("PrimitiveBoolean", (expectedCounts.get("PrimitiveBoolean") ?? 0) + 1);
    expectedCounts.set("PrimitiveFloat", (expectedCounts.get("PrimitiveFloat") ?? 0) + 1);
  }
  const actualCounts = typeCounts(records);
  for (const [type, expected] of expectedCounts) {
    if ((actualCounts.get(type) ?? 0) !== expected) fail("GRAPH.STRUCTURE_DRIFT", "Compiled node structure drifted.", "/graph/nodes");
  }
  for (const type of actualCounts.keys()) {
    if (!expectedCounts.has(type)) fail("GRAPH.UNKNOWN_CLASS_TYPE", "Unexpected compiled class identity.", "/graph/nodes");
  }

  const callType = templateKind === "r2v" ? "MiniMaxH3ReferenceToVideo" : spec.subgraph_id;
  const callIds = longDag ? longDag.call_node_ids : [spec.call_node_id];
  const calls = callIds.map((id) => nodeById(workflow, id, callType));
  validateVisibleControls(workflow, templateKind, project, seedPlan, visibleControls, calls, spec);

  const sourceSubgraphs = structuredClone(sourceWorkflow.definitions ?? { subgraphs: [] });
  const compiledSubgraphs = stripCertifiedQualityBoundaryForFingerprint(
    structuredClone(workflow.definitions ?? { subgraphs: [] }),
    visibleControls,
  );
  if (structureFingerprint({ version: sourceWorkflow.version, nodes: [], links: [], definitions: sourceSubgraphs })
    !== structureFingerprint({ version: workflow.version, nodes: [], links: [], definitions: compiledSubgraphs })) {
    fail("GRAPH.SUBGRAPH_DRIFT", "Immutable subgraph structure drifted.", "/graph/definitions");
  }

  validateCertifiedModelWidgets(records, sourceRecords, templateKind, spec, calls);
  validateFixedSamplingControls(records);
  validateCallParameters(workflow, templateKind, calls, callExpectations, spec);
  validateVisibleNodeGeometry(workflow);
  const canvasPreset = CANVASES[project.canvas];
  const canvasSize = resolveCanvasSize(project.canvas, project.resolution_megapixels);
  if (!canvasPreset || !canvasSize) fail("GRAPH.CANVAS_BINDING", "Compiled project canvas is not audited.", "/graph/nodes");
  const canvas = { ...canvasPreset, ...canvasSize };
  const selector = nodeById(workflow, spec.resolution_node_id, "ResolutionSelector");
  if (selector.widgets_values_named?.aspect_ratio !== canvas.selector_aspect_ratio
    || selector.widgets_values_named?.megapixels !== project.resolution_megapixels
    || selector.widgets_values_named?.multiple !== 32
    || selector.widgets_values?.[0] !== canvas.selector_aspect_ratio
    || selector.widgets_values?.[1] !== project.resolution_megapixels
    || selector.widgets_values?.[2] !== 32) {
    fail("GRAPH.RESOLUTION_SELECTOR", "ResolutionSelector does not match the audited canvas preset.", "/graph/nodes");
  }
  if (canonicalJson(selectorDimensions(
    selector.widgets_values_named.aspect_ratio,
    selector.widgets_values_named.megapixels,
    selector.widgets_values_named.multiple,
  )) !== canonicalJson([canvas.width, canvas.height])) {
    fail("GRAPH.RESOLUTION_SELECTOR", "Official ResolutionSelector does not resolve to the exact H3 canvas.", "/graph/nodes");
  }

  for (const [callIndex, call] of calls.entries()) {
    if (call.widgets_values_named?.width !== canvas.width || call.widgets_values_named?.height !== canvas.height) {
      fail("GRAPH.CANVAS_BINDING", "H3 call widgets do not resolve to the exact canvas.", "/graph/nodes");
    }
    for (const [name, outputSlot] of [["width", 0], ["height", 1]]) {
      const targetSlot = call.inputs?.findIndex((candidate) => candidate.name === name);
      const input = call.inputs?.[targetSlot];
      if (targetSlot < 0 || !Number.isSafeInteger(input?.link)) {
        fail("GRAPH.CANVAS_BINDING", "Official ResolutionSelector must remain visibly connected to every H3 call.", "/graph/nodes");
      }
      const linkId = exactLink(workflow, {
        origin: selector.id,
        originSlot: outputSlot,
        target: call.id,
        targetSlot,
        type: "INT",
      });
      if (input.link !== linkId || !selector.outputs?.[outputSlot]?.links?.includes(linkId)) {
        fail("GRAPH.CANVAS_BINDING", "ResolutionSelector link bookkeeping drifted.", "/graph/links");
      }
      if (callIndex === 0) {
        const pinned = name === "width" ? spec.width_link_id : spec.height_link_id;
        if (linkId !== pinned) fail("GRAPH.CANVAS_BINDING", "Pinned official ResolutionSelector link ID drifted.", "/graph/links");
      }
    }
  }

  if (templateKind !== "r2v") {
    const subgraph = workflow.definitions?.subgraphs?.find((candidate) => candidate.id === spec.subgraph_id);
    const h3 = subgraph?.nodes?.filter((node) => node.type === "MiniMaxH3ImageToVideo") ?? [];
    if (h3.length !== 1 || h3[0].widgets_values_named?.width !== canvas.width
      || h3[0].widgets_values_named?.height !== canvas.height) {
      fail("GRAPH.CANVAS_BINDING", "Pinned H3 node does not resolve to the exact canvas.", "/graph/definitions");
    }
    const expectedFullSteps = project.advanced.sampling_profile === "quality_25"
      ? SAMPLING_PROFILE_STEPS.quality_25
      : OFFICIAL_FIXED_CAPABILITIES.quality_steps;
    const fullSteps = subgraph.nodes.filter((node) => node.type === "PrimitiveInt"
      && node.widgets_values?.[1] === "fixed"
      && node.widgets_values_named?.fixed === "fixed"
      && [OFFICIAL_FIXED_CAPABILITIES.quality_steps, OFFICIAL_FIXED_CAPABILITIES.high_quality_steps]
        .includes(node.widgets_values?.[0]));
    if (fullSteps.length !== 1 || fullSteps[0].widgets_values?.[0] !== expectedFullSteps
      || fullSteps[0].widgets_values_named?.value !== expectedFullSteps) {
      fail("GRAPH.QUALITY_STEPS", "Full-quality steps do not match the selected sampling profile.", "/graph/definitions");
    }
  }
  const call = calls[0];
  if (templateKind === "r2v") {
    const referenceInputs = ["ref_images.ref_image_0", "ref_images.ref_image_1"]
      .map((name) => call.inputs?.find((input) => input.name === name));
    if (referenceInputs.some((input) => !input)
      || referenceInputs.filter((input) => input.link !== null).length !== referenceImageCount) {
      fail("GRAPH.REFERENCE_BINDING", "Compiled Ref2VA reference slots do not match the validated project.", "/graph/nodes");
    }
    validateRef2vaImages(workflow, call, project, spec);
    const quality = spec.quality_projection;
    if (!quality || quality.pruned_node_ids.some((nodeId) => workflow.nodes.some((node) => node.id === nodeId))
      || quality.pruned_link_ids.some((linkId) => workflow.links.some((link) => Array.isArray(link) && link[0] === linkId
        && linkId !== quality.model_link_id && linkId !== quality.steps_link_id))) {
      fail("GRAPH.REF2VA_QUALITY", "Inactive Ref2VA Turbo branch remains in the quality workflow.", "/graph");
    }
    const modelLink = exactLink(workflow, {
      origin: quality.base_model_node_id,
      originSlot: 0,
      target: quality.guider_node_id,
      targetSlot: 0,
      type: "MODEL",
    });
    const stepsLink = exactLink(workflow, {
      origin: quality.full_steps_node_id,
      originSlot: 0,
      target: quality.scheduler_node_id,
      targetSlot: 1,
      type: "INT",
    });
    const fullSteps = nodeById(workflow, quality.full_steps_node_id, "PrimitiveInt");
    const expectedSteps = SAMPLING_PROFILE_STEPS[project.advanced.sampling_profile];
    if (modelLink !== quality.model_link_id || stepsLink !== quality.steps_link_id
      || ![OFFICIAL_FIXED_CAPABILITIES.quality_steps, OFFICIAL_FIXED_CAPABILITIES.high_quality_steps].includes(expectedSteps)
      || fullSteps.widgets_values_named?.value !== expectedSteps || fullSteps.widgets_values?.[0] !== expectedSteps) {
      fail("GRAPH.REF2VA_QUALITY", "Ref2VA quality model or step projection drifted.", "/graph");
    }
  } else {
    validateFl2vaImages(workflow, project, calls, spec, longDag);
  }
  if (workflow.nodes.some((node) => node.type === "MarkdownNote")) {
    fail("GRAPH.VISIBLE_NOTE", "Large template MarkdownNote nodes must not remain in the handoff graph.", "/graph/nodes");
  }
  const saves = workflow.nodes.filter((node) => node.type === "SaveVideo");
  if (saves.length !== 1 || saves[0].size?.[0] < 360 || saves[0].size?.[0] > 420 || saves[0].size?.[1] > 200) {
    fail("GRAPH.SAVE_LAYOUT", "The visible handoff must contain one compact SaveVideo node.", "/graph/nodes");
  }
  if (!longDag) {
    const saveInput = saves[0].inputs?.findIndex((input) => input.name === "video");
    if (saveInput < 0) fail("GRAPH.SAVE_LINK", "SaveVideo input is absent.", "/graph/nodes");
    const saveOrigin = templateKind === "r2v"
      ? workflow.nodes.filter((node) => node.type === "CreateVideo")
      : [call];
    if (saveOrigin.length !== 1) {
      fail("GRAPH.SAVE_LINK", "SaveVideo source is absent or ambiguous.", "/graph/nodes");
    }
    const saveLinks = workflow.links.filter((link) => Array.isArray(link)
      && link[1] === saveOrigin[0].id && link[2] === 0
      && link[3] === saves[0].id && link[4] === saveInput && link[5] === "VIDEO");
    if (saveLinks.length !== 1) {
      fail("GRAPH.SAVE_LINK", "SaveVideo is not connected to the exact certified video source.", "/graph/links");
    }
    const linkId = exactLink(workflow, {
      origin: saveOrigin[0].id,
      originSlot: 0,
      target: saves[0].id,
      targetSlot: saveInput,
      type: "VIDEO",
    });
    if (saves[0].inputs[saveInput].link !== linkId) {
      fail("GRAPH.SAVE_LINK", "SaveVideo is not connected to the emitted H3 call.", "/graph/links");
    }
  }
  if (longDag) {
    const expectedWarningCode = plan.transitions.every((transition) => transition === "tail_frame_continuation")
      ? "EXPERIMENTAL_H3_SUBGRAPH_TAIL_FRAME_CHAIN"
      : "EXPERIMENTAL_H3_SUBGRAPH_TRANSITION_SEQUENCE";
    if (plan.status !== "experimental_export_ready" || plan.warning_code !== expectedWarningCode) {
      fail("GRAPH.DAG_TRUTH_STATUS", "Chained H3 subgraphs must remain explicitly Experimental.", "/segment_plan");
    }
    validateLongDag(workflow, project, plan, longDag, calls);
  }

  return Object.freeze({
    ok: true,
    static_lint: protectedProjection(records, templateKind),
    node_count: records.length,
    subgraph_count: definitions.size,
    structure_sha256: structureFingerprint(workflow),
    template_kind: templateKind,
    experimental_long_dag: Boolean(longDag),
  });
}
