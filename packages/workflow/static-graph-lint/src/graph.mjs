import { GRAPH_KINDS, LIMITS, RULES } from "./constants.mjs";
import { isRecord } from "./canonical.mjs";

const VISUAL_GRAPH_KEYS = new Set([
  "id", "name", "revision", "last_node_id", "last_link_id", "nodes", "links", "groups", "config", "extra", "version",
  "definitions", "inputs", "outputs", "widgets", "properties", "state",
]);
const VISUAL_NODE_KEYS = new Set([
  "id", "type", "pos", "size", "flags", "order", "mode", "inputs", "outputs", "properties", "widgets_values",
  "color", "bgcolor", "title", "shape", "label", "serialize_widgets", "locked", "horizontal", "collapsed",
]);
const VISUAL_SLOT_KEYS = new Set(["name", "type", "link", "links", "label", "localized_name", "shape", "widget", "dir", "slot_index"]);
const EXECUTION_IDENTITY_FIELDS = new Set(["schema_fingerprints", "origin", "locked_revision", "git_blob_sha", "local_only", "is_api_node"]);
const SUSPICIOUS_IDENTITY = /(?:api|partner|auth|cloud|upload|proxy|provider|endpoint|credential|token|secret|remote)/i;
const SUSPICIOUS_INPUT = /(?:^|_)(?:api|auth|cloud|upload|proxy|provider|endpoint|credential|token|secret|key|url)(?:_|$)/i;
const CONNECTION_ONLY = new Set(["CLIP", "VAE", "MODEL", "CONDITIONING", "LATENT", "IMAGE", "AUDIO", "VIDEO"]);
const OPAQUE_INPUT_TYPES = new Set(["PROMPT", "EXTRA_PNGINFO"]);
const SUBGRAPH_INTERFACE_KEYS = new Set(["name", "type", "optional"]);

function normalizeControlKey(key) {
  return key.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
}

function isQueueTarget(value) {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return ["submit", "queue", "enqueue"].includes(normalized)
    || /(?:^|[/:])(?:prompt|queue)(?:[/?#]|$)/i.test(normalized);
}

function exactKeys(value, allowed) {
  return isRecord(value) && Object.keys(value).every((key) => allowed.has(key));
}

function displayValue(node) {
  if (!isRecord(node)) return undefined;
  if (typeof node.title === "string") return node.title;
  if (isRecord(node._meta) && typeof node._meta.title === "string") return node._meta.title;
  if (isRecord(node.properties)) {
    if (typeof node.properties["Node name for S&R"] === "string") return node.properties["Node name for S&R"];
    if (typeof node.properties.display_name === "string") return node.properties.display_name;
  }
  return undefined;
}

function primitiveTypeValid(type, value, input) {
  if (type === "INT") return Number.isSafeInteger(value);
  if (type === "FLOAT") return typeof value === "number" && Number.isFinite(value);
  if (type === "STRING" || type === "DYNAMIC_COMBO") return typeof value === "string";
  if (type === "BOOLEAN") return typeof value === "boolean";
  if (type === "COMBO") return Array.isArray(input.options) && input.options.some((option) => Object.is(option, value));
  if (OPAQUE_INPUT_TYPES.has(type)) return true;
  return !CONNECTION_ONLY.has(type);
}

function connection(value) {
  return Array.isArray(value) && value.length === 2
    && (typeof value[0] === "string" || Number.isSafeInteger(value[0]))
    && Number.isSafeInteger(value[1]) && value[1] >= 0;
}

function expectedInputType(input) {
  const match = /^AUTOGROW<(.+)>$/.exec(input.type);
  return match ? match[1] : input.type;
}

class GraphSession {
  constructor({ kind, graph, authority, descriptors, sink, limits }) {
    this.kind = kind;
    this.graph = graph;
    this.authority = authority;
    this.descriptors = descriptors;
    this.sink = sink;
    this.limits = limits;
    this.stats = { graphs: 0, nodes: 0, edges: 0, subgraphs: 0, visits: 0 };
    this.exhausted = false;
    this.limitCodes = new Set();
  }

  add(code, path, rule = RULES.graph) {
    this.sink.add(code, path, rule);
  }

  visit(path, count = 1) {
    this.stats.visits += count;
    if (this.stats.visits > this.limits.maxVisitBudget) {
      if (!this.limitCodes.has("STRUCTURE.VISIT_BUDGET")) {
        this.add("STRUCTURE.VISIT_BUDGET", path, RULES.structure);
        this.limitCodes.add("STRUCTURE.VISIT_BUDGET");
      }
      this.exhausted = true;
      return false;
    }
    return true;
  }

  increment(field, amount, max, code, path) {
    this.stats[field] += amount;
    if (this.stats[field] > max && !this.limitCodes.has(code)) {
      this.add(code, path, RULES.structure);
      this.limitCodes.add(code);
    }
  }

  scanMetadata(value, path) {
    const stack = [{ value, path }];
    const seen = new Set();
    while (stack.length > 0 && !this.exhausted) {
      const current = stack.pop();
      if (!this.visit(current.path)) break;
      if (current.value === null || typeof current.value !== "object") continue;
      if (seen.has(current.value)) {
        this.add("STRUCTURE.NON_JSON_ALIAS", current.path, RULES.structure);
        continue;
      }
      seen.add(current.value);
      if (Array.isArray(current.value)) {
        for (let index = current.value.length - 1; index >= 0; index -= 1) stack.push({ value: current.value[index], path: `${current.path}/${index}` });
        continue;
      }
      for (const key of Object.keys(current.value).sort().reverse()) {
        const child = current.value[key];
        const normalized = normalizeControlKey(key);
        if (["autoqueue", "runonload", "submit", "queue", "enqueue"].includes(normalized)) {
          this.add("GRAPH.AUTO_QUEUE_CONTROL", `${current.path}/@control`, RULES.noQueue);
          return;
        }
        if (["endpoint", "action", "hook"].includes(normalized) && isQueueTarget(child)) {
          this.add("GRAPH.AUTO_QUEUE_TARGET", `${current.path}/@control`, RULES.noQueue);
          return;
        }
        if (["nodes", "classtype", "subgraphs", "subgraphref"].includes(normalized)) {
          this.add("GRAPH.HIDDEN_EXECUTION_SHAPE", `${current.path}/@hidden`, RULES.structure);
          return;
        }
        if (!["prompt", "text", "title", "displayname", "filename", "filenameprefix", "widgetsvalues"].includes(normalized)) {
          stack.push({ value: child, path: `${current.path}/@metadata` });
        }
      }
    }
  }

  directControl(value, path) {
    if (!isRecord(value)) return false;
    for (const key of Object.keys(value).sort()) {
      const normalized = normalizeControlKey(key);
      if (["autoqueue", "runonload", "submit", "queue", "enqueue"].includes(normalized)) {
        this.add("GRAPH.AUTO_QUEUE_CONTROL", `${path}/@control`, RULES.noQueue);
        return true;
      }
      if (["endpoint", "action", "hook"].includes(normalized) && isQueueTarget(value[key])) {
        this.add("GRAPH.AUTO_QUEUE_TARGET", `${path}/@control`, RULES.noQueue);
        return true;
      }
    }
    return false;
  }

  classifyUnknown(classType, node, path) {
    if (typeof classType === "string" && this.authority.forbidden.has(classType)) {
      this.add("GRAPH.PARTNER_API_NODE", `${path}/class_type`);
      return;
    }
    const shown = displayValue(node);
    if ((typeof classType === "string" && this.authority.displayNames.has(classType))
      || (typeof shown === "string" && this.authority.displayNames.has(shown)
        && this.authority.displayNames.get(shown) !== classType)) {
      this.add("GRAPH.DISPLAY_NAME_SPOOF", `${path}/class_type`);
      return;
    }
    if (typeof classType === "string" && SUSPICIOUS_IDENTITY.test(classType)) {
      this.add("GRAPH.REMOTE_OR_AUTH_NODE", `${path}/class_type`);
      return;
    }
    this.add("GRAPH.UNKNOWN_CLASS_TYPE", `${path}/class_type`);
  }

  validateIdentityAssertions(node, path) {
    for (const key of Object.keys(node)) {
      if (EXECUTION_IDENTITY_FIELDS.has(key)) {
        this.add("GRAPH.NODE_IDENTITY_SELF_ASSERTION", `${path}/@identity`);
        return false;
      }
    }
    return true;
  }

  layers() {
    if (this.kind !== "bundle") return [{ kind: this.kind, graph: this.graph, path: "/graph", index: 0 }];
    if (this.directControl(this.graph, "/graph")) return [];
    if (!isRecord(this.graph) || !exactKeys(this.graph, new Set(["layers"])) || !Array.isArray(this.graph.layers) || this.graph.layers.length < 1) {
      this.add("GRAPH.BUNDLE_INVALID", "/graph");
      return [];
    }
    const layers = [];
    for (let index = 0; index < this.graph.layers.length; index += 1) {
      const layer = this.graph.layers[index];
      if (!isRecord(layer) || !exactKeys(layer, new Set(["kind", "graph"]))
        || !["visual", "api", "expanded"].includes(layer.kind)) {
        this.add("GRAPH.BUNDLE_LAYER_INVALID", `/graph/layers/${index}`);
        continue;
      }
      layers.push({ kind: layer.kind, graph: layer.graph, path: `/graph/layers/${index}/graph`, index });
    }
    return layers;
  }

  normalizeExecutionGraph(value, path) {
    if (!isRecord(value)) {
      this.add("GRAPH.EXECUTION_GRAPH_INVALID", path);
      return null;
    }
    if (Object.hasOwn(value, "nodes")) {
      if (this.directControl(value, path)) return null;
      if (!exactKeys(value, new Set(["nodes", "definitions", "version"])) || !isRecord(value.nodes)) {
        this.add("GRAPH.EXECUTION_ENVELOPE_INVALID", path);
        return null;
      }
      return { nodes: value.nodes, definitions: value.definitions, source: value };
    }
    return { nodes: value, definitions: undefined, source: value };
  }

  subgraphInterface(definition, path, requireDeclared) {
    if (requireDeclared && (!Array.isArray(definition.inputs) || !Array.isArray(definition.outputs))) {
      this.add("GRAPH.SUBGRAPH_INTERFACE_MISSING", path);
      return null;
    }
    const inputs = definition.inputs ?? [];
    const outputs = definition.outputs ?? [];
    if (!Array.isArray(inputs) || !Array.isArray(outputs)) {
      this.add("GRAPH.SUBGRAPH_INTERFACE_INVALID", path);
      return null;
    }
    const inputMap = new Map();
    for (let index = 0; index < inputs.length; index += 1) {
      const input = inputs[index];
      if (!isRecord(input) || !exactKeys(input, SUBGRAPH_INTERFACE_KEYS) || typeof input.name !== "string"
        || typeof input.type !== "string" || inputMap.has(input.name)
        || (input.optional !== undefined && typeof input.optional !== "boolean")) {
        this.add("GRAPH.SUBGRAPH_INTERFACE_INVALID", `${path}/inputs/${index}`);
        return null;
      }
      inputMap.set(input.name, Object.freeze({ ...input, required: input.optional !== true }));
    }
    const outputList = [];
    const outputNames = new Set();
    for (let index = 0; index < outputs.length; index += 1) {
      const output = outputs[index];
      if (!isRecord(output) || !exactKeys(output, SUBGRAPH_INTERFACE_KEYS) || typeof output.name !== "string"
        || typeof output.type !== "string" || outputNames.has(output.name) || output.optional !== undefined) {
        this.add("GRAPH.SUBGRAPH_INTERFACE_INVALID", `${path}/outputs/${index}`);
        return null;
      }
      outputNames.add(output.name);
      outputList.push(Object.freeze({ index, name: output.name, type: output.type }));
    }
    return Object.freeze({ inputMap, outputs: Object.freeze(outputList), subgraph: true });
  }

  collectLayer(layer) {
    const state = { layer, definitions: new Map(), invalidDefinitions: new Set(), records: [], refEdges: new Map() };
    const queue = [{ kind: layer.kind, graph: layer.graph, path: layer.path, ownerId: null, isRoot: true }];
    while (queue.length > 0 && !this.exhausted) {
      const record = queue.shift();
      if (!this.visit(record.path)) break;
      let normalized;
      if (record.kind === "visual") {
        if (!isRecord(record.graph) || !Array.isArray(record.graph.nodes) || !Array.isArray(record.graph.links)) {
          this.add("GRAPH.VISUAL_GRAPH_INVALID", record.path);
          continue;
        }
        normalized = { nodes: record.graph.nodes, definitions: record.graph.definitions, source: record.graph };
      } else {
        normalized = this.normalizeExecutionGraph(record.graph, record.path);
        if (!normalized) continue;
      }
      const stored = { ...record, normalized };
      state.records.push(stored);
      this.stats.graphs += 1;
      if (record.ownerId !== null && !state.refEdges.has(record.ownerId)) state.refEdges.set(record.ownerId, new Set());
      if (normalized.definitions === undefined) continue;
      const definitions = normalized.definitions;
      if (!isRecord(definitions) || !exactKeys(definitions, new Set(["subgraphs"])) || !Array.isArray(definitions.subgraphs)) {
        this.add("GRAPH.DEFINITIONS_INVALID", `${record.path}/definitions`);
        continue;
      }
      for (let index = 0; index < definitions.subgraphs.length; index += 1) {
        const definition = definitions.subgraphs[index];
        const definitionPath = `${record.path}/definitions/subgraphs/${index}`;
        this.increment("subgraphs", 1, this.limits.maxSubgraphs, "STRUCTURE.SUBGRAPH_LIMIT", definitionPath);
        if (this.directControl(definition, definitionPath)) continue;
        if (!isRecord(definition) || typeof definition.id !== "string" || definition.id.length < 1 || definition.id.length > 128
          || state.definitions.has(definition.id)) {
          this.add(state.definitions.has(definition?.id) ? "GRAPH.DUPLICATE_SUBGRAPH_ID" : "GRAPH.SUBGRAPH_DEFINITION_INVALID", definitionPath);
          continue;
        }
        let child;
        if (record.kind === "visual") {
          if (!Array.isArray(definition.nodes) || !Array.isArray(definition.links)) {
            this.add("GRAPH.SUBGRAPH_DEFINITION_INVALID", definitionPath);
            continue;
          }
          child = definition;
        } else {
          if (!exactKeys(definition, new Set(["id", "kind", "inputs", "outputs", "graph"])) || definition.kind !== record.kind || !isRecord(definition.graph)) {
            this.add("GRAPH.SUBGRAPH_DEFINITION_INVALID", definitionPath);
            continue;
          }
          child = definition.graph;
        }
        const interfaceState = this.subgraphInterface(definition, definitionPath, record.kind !== "visual");
        if (!interfaceState) {
          state.invalidDefinitions.add(definition.id);
          continue;
        }
        state.definitions.set(definition.id, { path: definitionPath, definition, interface: interfaceState });
        queue.push({ kind: record.kind, graph: child, path: definitionPath, ownerId: definition.id, isRoot: false });
      }
    }
    return state;
  }

  validateVisual(record, state) {
    const graph = record.normalized.source;
    if (this.directControl(graph, record.path)) return;
    for (const key of Object.keys(graph)) {
      if (!VISUAL_GRAPH_KEYS.has(key)) {
        this.add("GRAPH.UNSUPPORTED_VISUAL_FIELD", `${record.path}/@field`);
        return;
      }
    }
    for (const metadataKey of ["groups", "config", "extra", "properties", "state"]) {
      if (Object.hasOwn(graph, metadataKey)) this.scanMetadata(graph[metadataKey], `${record.path}/${metadataKey}`);
    }
    const nodes = graph.nodes;
    this.increment("nodes", nodes.length, this.limits.maxNodes, "STRUCTURE.NODE_LIMIT", `${record.path}/nodes`);
    const nodeMap = new Map();
    const nodePaths = new Map();
    const descriptorsById = new Map();
    const adjacency = new Map();
    for (let index = 0; index < nodes.length && !this.exhausted; index += 1) {
      const node = nodes[index];
      const path = `${record.path}/nodes/${index}`;
      if (!this.visit(path)) break;
      if (!isRecord(node) || !(typeof node.id === "string" || Number.isSafeInteger(node.id)) || nodeMap.has(node.id)) {
        this.add(nodeMap.has(node?.id) ? "GRAPH.DUPLICATE_NODE_ID" : "GRAPH.VISUAL_NODE_INVALID", path);
        continue;
      }
      nodeMap.set(node.id, node);
      nodePaths.set(node.id, path);
      adjacency.set(node.id, new Set());
      if (this.directControl(node, path) || !this.validateIdentityAssertions(node, path)) continue;
      for (const key of Object.keys(node)) {
        if (!VISUAL_NODE_KEYS.has(key)) {
          this.add("GRAPH.UNSUPPORTED_NODE_FIELD", `${path}/@field`);
          break;
        }
      }
      if (isRecord(node.properties)) this.scanMetadata(node.properties, `${path}/properties`);
      if (typeof node.type !== "string") {
        this.add("GRAPH.CLASS_TYPE_MISSING", `${path}/type`);
        continue;
      }
      if (state.definitions.has(node.type)) {
        const subgraph = state.definitions.get(node.type);
        if (record.ownerId !== null) state.refEdges.get(record.ownerId).add(node.type);
        descriptorsById.set(node.id, subgraph.interface);
        const slots = node.inputs ?? [];
        if (!Array.isArray(slots)) {
          this.add("GRAPH.SUBGRAPH_INPUTS_INVALID", `${path}/inputs`);
        } else {
          const names = new Set();
          for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
            const slot = slots[slotIndex];
            const input = isRecord(slot) && typeof slot.name === "string" ? subgraph.interface.inputMap.get(slot.name) : undefined;
            if (!isRecord(slot) || !exactKeys(slot, VISUAL_SLOT_KEYS) || !input || names.has(slot.name) || (slot.type !== undefined && slot.type !== input.type)) {
              this.add("GRAPH.SUBGRAPH_INPUT_MISMATCH", `${path}/inputs/${slotIndex}`);
              continue;
            }
            names.add(slot.name);
            if (isRecord(slot.widget)) this.scanMetadata(slot.widget, `${path}/inputs/${slotIndex}/widget`);
          }
          for (const input of subgraph.interface.inputMap.values()) {
            if (input.required && !names.has(input.name)) this.add("GRAPH.SUBGRAPH_REQUIRED_INPUT_MISSING", `${path}/inputs`);
          }
        }
        const outputs = node.outputs ?? [];
        if (!Array.isArray(outputs) || outputs.length !== subgraph.interface.outputs.length) {
          this.add("GRAPH.SUBGRAPH_OUTPUT_MISMATCH", `${path}/outputs`);
        } else {
          for (let outputIndex = 0; outputIndex < outputs.length; outputIndex += 1) {
            const output = outputs[outputIndex];
            const expected = subgraph.interface.outputs[outputIndex];
            if (!isRecord(output) || output.name !== expected.name || output.type !== expected.type) {
              this.add("GRAPH.SUBGRAPH_OUTPUT_MISMATCH", `${path}/outputs/${outputIndex}`);
            }
          }
        }
        if (node.widgets_values !== undefined) this.scanMetadata(node.widgets_values, `${path}/widgets_values`);
        continue;
      }
      if (state.invalidDefinitions.has(node.type)) continue;
      const descriptor = this.descriptors.get(node.type);
      if (!descriptor) {
        this.classifyUnknown(node.type, node, path);
        continue;
      }
      descriptorsById.set(node.id, descriptor);
      if (node.inputs !== undefined) {
        if (!Array.isArray(node.inputs)) {
          this.add("GRAPH.VISUAL_INPUTS_INVALID", `${path}/inputs`);
        } else {
          const names = new Set();
          for (let slotIndex = 0; slotIndex < node.inputs.length; slotIndex += 1) {
            const slot = node.inputs[slotIndex];
            const slotPath = `${path}/inputs/${slotIndex}`;
            if (!isRecord(slot) || !exactKeys(slot, VISUAL_SLOT_KEYS) || typeof slot.name !== "string" || names.has(slot.name)) {
              this.add(names.has(slot?.name) ? "GRAPH.DUPLICATE_INPUT_NAME" : "GRAPH.VISUAL_INPUT_INVALID", slotPath);
              continue;
            }
            names.add(slot.name);
            const spec = descriptor.inputMap.get(slot.name);
            if (!spec) {
              this.add(SUSPICIOUS_INPUT.test(slot.name) ? "GRAPH.FORBIDDEN_INPUT" : "GRAPH.UNKNOWN_INPUT", `${slotPath}/name`);
              continue;
            }
            if (slot.type !== undefined && slot.type !== spec.type) this.add("GRAPH.INPUT_TYPE_MISMATCH", `${slotPath}/type`);
          }
        }
      }
      if (node.outputs !== undefined) {
        if (!Array.isArray(node.outputs)) {
          this.add("GRAPH.VISUAL_OUTPUTS_INVALID", `${path}/outputs`);
        } else {
          for (let outputIndex = 0; outputIndex < node.outputs.length; outputIndex += 1) {
            const output = node.outputs[outputIndex];
            const expected = descriptor.outputs[outputIndex];
            if (!isRecord(output) || !expected || output.type !== expected.type) this.add("GRAPH.OUTPUT_TYPE_MISMATCH", `${path}/outputs/${outputIndex}`);
          }
        }
      }
    }
    const links = graph.links;
    this.increment("edges", links.length, this.limits.maxEdges, "STRUCTURE.EDGE_LIMIT", `${record.path}/links`);
    const linkIds = new Set();
    const linkById = new Map();
    for (let index = 0; index < links.length && !this.exhausted; index += 1) {
      const link = links[index];
      const path = `${record.path}/links/${index}`;
      if (!this.visit(path)) break;
      if (!Array.isArray(link) || link.length !== 6 || !(typeof link[0] === "string" || Number.isSafeInteger(link[0]))
        || linkIds.has(link[0]) || !Number.isSafeInteger(link[2]) || !Number.isSafeInteger(link[4])) {
        this.add(linkIds.has(link?.[0]) ? "GRAPH.DUPLICATE_LINK_ID" : "GRAPH.LINK_INVALID", path);
        continue;
      }
      linkIds.add(link[0]);
      linkById.set(link[0], link);
      const source = nodeMap.get(link[1]);
      const target = nodeMap.get(link[3]);
      if (!source || !target) {
        this.add("GRAPH.DANGLING_LINK", path);
        continue;
      }
      adjacency.get(link[1]).add(link[3]);
      const sourceDescriptor = descriptorsById.get(link[1]);
      const targetDescriptor = descriptorsById.get(link[3]);
      if (sourceDescriptor && (!sourceDescriptor.outputs[link[2]] || sourceDescriptor.outputs[link[2]].type !== link[5])) {
        this.add("GRAPH.LINK_OUTPUT_TYPE_MISMATCH", path);
      }
      if (targetDescriptor && Array.isArray(target.inputs) && target.inputs[link[4]]) {
        const targetSpec = targetDescriptor.inputMap.get(target.inputs[link[4]].name);
        if (targetSpec && expectedInputType(targetSpec) !== link[5]) this.add("GRAPH.LINK_INPUT_TYPE_MISMATCH", path);
      }
    }
    for (const [nodeId, node] of nodeMap) {
      const nodePath = nodePaths.get(nodeId);
      if (Array.isArray(node.inputs)) {
        for (let slotIndex = 0; slotIndex < node.inputs.length; slotIndex += 1) {
          const linkId = node.inputs[slotIndex]?.link;
          if (linkId === null || linkId === undefined) continue;
          const link = linkById.get(linkId);
          if (!link || link[3] !== nodeId || link[4] !== slotIndex) this.add("GRAPH.DANGLING_SLOT_LINK", `${nodePath}/inputs/${slotIndex}/link`);
        }
      }
      if (Array.isArray(node.outputs)) {
        for (let slotIndex = 0; slotIndex < node.outputs.length; slotIndex += 1) {
          const outputLinks = node.outputs[slotIndex]?.links;
          if (outputLinks === undefined || outputLinks === null) continue;
          if (!Array.isArray(outputLinks)) {
            this.add("GRAPH.OUTPUT_LINKS_INVALID", `${nodePath}/outputs/${slotIndex}/links`);
            continue;
          }
          for (const linkId of outputLinks) {
            const link = linkById.get(linkId);
            if (!link || link[1] !== nodeId || link[2] !== slotIndex) this.add("GRAPH.DANGLING_SLOT_LINK", `${nodePath}/outputs/${slotIndex}/links`);
          }
        }
      }
    }
    this.detectGraphCycle(adjacency, record.path);
  }

  dynamicInput(descriptor, name) {
    for (const input of descriptor.inputMap.values()) {
      const match = /^AUTOGROW<(.+)>$/.exec(input.type);
      if (match && typeof input.prefix === "string" && name.startsWith(input.prefix)) {
        const suffix = name.slice(input.prefix.length);
        if (/^(?:0|[1-9][0-9]*)$/.test(suffix) && Number(suffix) < (input.max_items ?? Number.MAX_SAFE_INTEGER)) {
          return Object.freeze({ ...input, type: match[1], dynamic: true });
        }
      }
    }
    return undefined;
  }

  validateExecution(record, state) {
    const nodesObject = record.normalized.nodes;
    const ids = Object.keys(nodesObject).sort();
    this.increment("nodes", ids.length, this.limits.maxNodes, "STRUCTURE.NODE_LIMIT", `${record.path}/nodes`);
    const nodeMap = new Map(ids.map((id) => [id, nodesObject[id]]));
    const nodePaths = new Map(ids.map((id, index) => [id, `${record.path}/$nodes/${index}`]));
    const descriptorsById = new Map();
    const adjacency = new Map(ids.map((id) => [id, new Set()]));
    for (let index = 0; index < ids.length && !this.exhausted; index += 1) {
      const id = ids[index];
      const node = nodeMap.get(id);
      const path = nodePaths.get(id);
      if (!this.visit(path)) break;
      if (!isRecord(node)) {
        this.add("GRAPH.EXECUTION_NODE_INVALID", path);
        continue;
      }
      if (this.directControl(node, path)) continue;
      if (Object.hasOwn(node, "subgraph_ref")) {
        const target = typeof node.subgraph_ref === "string" ? state.definitions.get(node.subgraph_ref) : undefined;
        const targetInvalid = typeof node.subgraph_ref === "string" && state.invalidDefinitions.has(node.subgraph_ref);
        if (targetInvalid) continue;
        if (!exactKeys(node, new Set(["subgraph_ref", "inputs", "_meta"])) || typeof node.subgraph_ref !== "string"
          || !isRecord(node.inputs) || !target) {
          this.add(!target ? "GRAPH.DANGLING_SUBGRAPH_REF" : "GRAPH.SUBGRAPH_REF_NODE_INVALID", path);
          continue;
        }
        if (record.ownerId !== null) state.refEdges.get(record.ownerId).add(node.subgraph_ref);
        if (node._meta !== undefined) this.scanMetadata(node._meta, `${path}/_meta`);
        const interfaceState = target.interface;
        descriptorsById.set(id, interfaceState);
        for (const input of interfaceState.inputMap.values()) {
          if (input.required && !Object.hasOwn(node.inputs, input.name)) this.add("GRAPH.SUBGRAPH_REQUIRED_INPUT_MISSING", `${path}/inputs`);
        }
        for (const name of Object.keys(node.inputs).sort()) {
          const inputPath = `${path}/inputs/@input`;
          const input = interfaceState.inputMap.get(name);
          if (!input) {
            this.add("GRAPH.SUBGRAPH_INPUT_MISMATCH", inputPath);
            continue;
          }
          const value = node.inputs[name];
          if (OPAQUE_INPUT_TYPES.has(input.type)) continue;
          if (connection(value)) {
            const sourceId = String(value[0]);
            if (!nodeMap.has(sourceId)) this.add("GRAPH.DANGLING_REFERENCE", inputPath);
            else {
              this.increment("edges", 1, this.limits.maxEdges, "STRUCTURE.EDGE_LIMIT", inputPath);
              adjacency.get(sourceId).add(id);
            }
          } else if (!primitiveTypeValid(input.type, value, input)) {
            this.add("GRAPH.INPUT_VALUE_TYPE_MISMATCH", inputPath);
          }
        }
        continue;
      }
      if (!this.validateIdentityAssertions(node, path)) continue;
      if (!exactKeys(node, new Set(["class_type", "inputs", "_meta"]))) {
        this.add("GRAPH.UNSUPPORTED_NODE_FIELD", `${path}/@field`);
        continue;
      }
      if (node._meta !== undefined) this.scanMetadata(node._meta, `${path}/_meta`);
      if (typeof node.class_type !== "string" || !isRecord(node.inputs)) {
        this.add("GRAPH.EXECUTION_NODE_INVALID", path);
        continue;
      }
      const descriptor = this.descriptors.get(node.class_type);
      if (!descriptor) {
        this.classifyUnknown(node.class_type, node, path);
        continue;
      }
      descriptorsById.set(id, descriptor);
      for (const input of descriptor.inputMap.values()) {
        if (input.required && !Object.hasOwn(node.inputs, input.name)) this.add("GRAPH.REQUIRED_INPUT_MISSING", `${path}/inputs`);
      }
      for (const name of Object.keys(node.inputs).sort()) {
        const inputPath = `${path}/inputs/@input`;
        let input = descriptor.inputMap.get(name) ?? this.dynamicInput(descriptor, name);
        if (!input) {
          this.add(SUSPICIOUS_INPUT.test(name) ? "GRAPH.FORBIDDEN_INPUT" : "GRAPH.UNKNOWN_INPUT", inputPath);
          continue;
        }
        const value = node.inputs[name];
        if (OPAQUE_INPUT_TYPES.has(input.type)) continue;
        const values = /^AUTOGROW</.test(input.type) && Array.isArray(value) ? value : [value];
        for (const item of values) {
          if (connection(item)) {
            const sourceId = String(item[0]);
            if (!nodeMap.has(sourceId)) {
              this.add("GRAPH.DANGLING_REFERENCE", inputPath);
              continue;
            }
            this.increment("edges", 1, this.limits.maxEdges, "STRUCTURE.EDGE_LIMIT", inputPath);
            adjacency.get(sourceId).add(id);
          } else if (!primitiveTypeValid(input.type, item, input)) {
            this.add("GRAPH.INPUT_VALUE_TYPE_MISMATCH", inputPath);
          }
        }
      }
    }
    for (const id of ids) {
      const node = nodeMap.get(id);
      const descriptor = descriptorsById.get(id);
      if (!descriptor || !isRecord(node?.inputs)) continue;
      for (const name of Object.keys(node.inputs).sort()) {
        const input = descriptor.inputMap.get(name) ?? this.dynamicInput(descriptor, name);
        if (!input || OPAQUE_INPUT_TYPES.has(input.type)) continue;
        const values = /^AUTOGROW</.test(input.type) && Array.isArray(node.inputs[name]) ? node.inputs[name] : [node.inputs[name]];
        for (const item of values) {
          if (!connection(item)) continue;
          const sourceDescriptor = descriptorsById.get(String(item[0]));
          if (sourceDescriptor) {
            const output = sourceDescriptor.outputs[item[1]];
            if (!output || output.type !== expectedInputType(input)) this.add("GRAPH.REFERENCE_TYPE_MISMATCH", `${nodePaths.get(id)}/inputs/@input`);
          }
        }
      }
    }
    this.detectGraphCycle(adjacency, record.path);
  }

  detectGraphCycle(adjacency, path) {
    const indegree = new Map([...adjacency.keys()].map((key) => [key, 0]));
    for (const targets of adjacency.values()) for (const target of targets) indegree.set(target, (indegree.get(target) ?? 0) + 1);
    const queue = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([key]) => key).sort();
    let visited = 0;
    while (queue.length > 0) {
      const current = queue.shift();
      visited += 1;
      for (const target of [...(adjacency.get(current) ?? [])].sort()) {
        const degree = indegree.get(target) - 1;
        indegree.set(target, degree);
        if (degree === 0) {
          queue.push(target);
          queue.sort();
        }
      }
    }
    if (visited !== adjacency.size) this.add("GRAPH.EXECUTION_CYCLE", path, RULES.structure);
  }

  validateSubgraphReferences(state) {
    const adjacency = new Map([...state.definitions.keys()].map((key) => [key, new Set(state.refEdges.get(key) ?? [])]));
    const indegree = new Map([...adjacency.keys()].map((key) => [key, 0]));
    for (const targets of adjacency.values()) {
      for (const target of targets) {
        if (!adjacency.has(target)) continue;
        indegree.set(target, indegree.get(target) + 1);
      }
    }
    const queue = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([key]) => key).sort();
    const order = [];
    while (queue.length > 0) {
      const current = queue.shift();
      order.push(current);
      for (const target of [...adjacency.get(current)].sort()) {
        if (!indegree.has(target)) continue;
        const degree = indegree.get(target) - 1;
        indegree.set(target, degree);
        if (degree === 0) { queue.push(target); queue.sort(); }
      }
    }
    if (order.length !== adjacency.size) {
      this.add("GRAPH.SUBGRAPH_REFERENCE_CYCLE", state.layer.path, RULES.structure);
      return;
    }
    const depth = new Map([...adjacency.keys()].map((key) => [key, 1]));
    for (const source of order) {
      for (const target of adjacency.get(source)) depth.set(target, Math.max(depth.get(target) ?? 1, depth.get(source) + 1));
    }
    if ([...depth.values()].some((value) => value > this.limits.maxSubgraphRefDepth)) {
      this.add("STRUCTURE.SUBGRAPH_REF_DEPTH_LIMIT", state.layer.path, RULES.structure);
    }
  }

  run() {
    if (!GRAPH_KINDS.includes(this.kind)) {
      this.add("GRAPH.KIND_INVALID", "/kind");
      return this.stats;
    }
    for (const layer of this.layers()) {
      if (this.exhausted) break;
      const state = this.collectLayer(layer);
      for (const record of state.records) {
        if (this.exhausted) break;
        if (record.kind === "visual") this.validateVisual(record, state);
        else this.validateExecution(record, state);
      }
      this.validateSubgraphReferences(state);
    }
    return this.stats;
  }
}

export function lintGraphs(options) {
  return new GraphSession(options).run();
}
