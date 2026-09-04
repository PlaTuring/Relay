import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseStrictJsonBytes } from "../../static-graph-lint/src/index.mjs";
import { TEMPLATE_REVISION, TEMPLATE_SPECS } from "./constants.mjs";
import { sha256Bytes, sha256Canonical } from "./canonical.mjs";
import { fail } from "./errors.mjs";

const TEMPLATE_DIRECTORY = fileURLToPath(new URL("../templates/", import.meta.url));

function slotProjection(slot) {
  if (slot === null || typeof slot !== "object" || Array.isArray(slot)) return null;
  return {
    name: slot.name ?? null,
    type: slot.type ?? null,
    shape: slot.shape ?? null,
    link: slot.link ?? null,
    links: slot.links ?? null,
    widget: slot.widget && typeof slot.widget === "object" ? slot.widget.name ?? null : null,
  };
}

function linkProjection(link) {
  if (Array.isArray(link)) return link.slice();
  if (link && typeof link === "object") {
    return {
      id: link.id,
      origin_id: link.origin_id,
      origin_slot: link.origin_slot,
      target_id: link.target_id,
      target_slot: link.target_slot,
      type: link.type,
    };
  }
  return null;
}

function nodeProjection(node) {
  return {
    id: node.id,
    type: node.type,
    keys: Object.keys(node).sort(),
    inputs: Array.isArray(node.inputs) ? node.inputs.map(slotProjection) : null,
    outputs: Array.isArray(node.outputs) ? node.outputs.map(slotProjection) : null,
    widget_count: Array.isArray(node.widgets_values) ? node.widgets_values.length : node.widgets_values === undefined ? null : 1,
    named_widget_keys: node.widgets_values_named && typeof node.widgets_values_named === "object"
      ? Object.keys(node.widgets_values_named).sort()
      : [],
    property_keys: node.properties && typeof node.properties === "object" ? Object.keys(node.properties).sort() : [],
  };
}

function graphProjection(graph) {
  const subgraphs = graph?.definitions?.subgraphs;
  return {
    version: graph?.version ?? null,
    keys: graph && typeof graph === "object" ? Object.keys(graph).sort() : [],
    nodes: Array.isArray(graph?.nodes) ? graph.nodes.map(nodeProjection) : null,
    links: Array.isArray(graph?.links) ? graph.links.map(linkProjection) : null,
    subgraphs: Array.isArray(subgraphs)
      ? subgraphs.map((subgraph) => ({
        id: subgraph.id,
        name: subgraph.name ?? null,
        keys: Object.keys(subgraph).sort(),
        inputs: Array.isArray(subgraph.inputs) ? subgraph.inputs.map(slotProjection) : null,
        outputs: Array.isArray(subgraph.outputs) ? subgraph.outputs.map(slotProjection) : null,
        graph: graphProjection(subgraph),
      }))
      : [],
  };
}

export function structureFingerprint(workflow) {
  return sha256Canonical(graphProjection(workflow));
}

async function loadSpec(spec, requireStructure = true) {
  const bytes = await readFile(new URL(`../templates/${spec.filename}`, import.meta.url));
  if (bytes.byteLength !== spec.bytes || sha256Bytes(bytes) !== spec.sha256) {
    fail("TEMPLATE.INTEGRITY", "Vendored template bytes do not match immutable authority.", "/template");
  }
  let workflow;
  try {
    workflow = parseStrictJsonBytes(bytes).value;
  } catch {
    fail("TEMPLATE.JSON", "Vendored template is not strict JSON.", "/template");
  }
  const structureSha256 = structureFingerprint(workflow);
  if (requireStructure && spec.structure_sha256 !== "PENDING" && structureSha256 !== spec.structure_sha256) {
    fail("TEMPLATE.STRUCTURE", "Vendored template structure fingerprint does not match authority.", "/template");
  }
  return Object.freeze({
    workflow,
    authority: Object.freeze({
      repository: "https://github.com/Comfy-Org/workflow_templates",
      revision: TEMPLATE_REVISION,
      path: `templates/${spec.filename}`,
      bytes: spec.bytes,
      sha256: spec.sha256,
      structure_sha256: structureSha256,
    }),
  });
}

export async function loadTemplate(kind) {
  const spec = TEMPLATE_SPECS[kind];
  if (!spec) fail("TEMPLATE.KIND", "Unsupported template kind.", "/template");
  return loadSpec(spec);
}

export async function verifyVendoredTemplates() {
  const results = [];
  for (const [kind, spec] of Object.entries(TEMPLATE_SPECS)) {
    const loaded = await loadSpec(spec);
    results.push(Object.freeze({ kind, ...loaded.authority }));
  }
  return Object.freeze(results);
}

export { TEMPLATE_DIRECTORY };
