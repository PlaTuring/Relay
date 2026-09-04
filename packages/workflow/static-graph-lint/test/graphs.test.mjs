import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { lintStaticGraph } from "../src/index.mjs";
import { FORBIDDEN_PARTNER_CLASS_TYPES } from "../src/constants.mjs";
import { documents, positiveApiGraph, positiveVisualGraph } from "./fixture-factory.mjs";

function run(kind, graph, options = {}) {
  return lintStaticGraph({ kind, graph, ...documents(), ...options });
}

function codes(result) {
  return result.diagnostics.map((item) => item.code);
}

function assertRejectsOnly(kind, graph, code) {
  const result = run(kind, graph);
  assert.equal(result.ok, false);
  assert.deepEqual(codes(result), [code], JSON.stringify(result.diagnostics));
}

test("positive visual, API, expanded, nested, and explicitly typed bundle graphs pass", () => {
  assert.equal(run("visual", positiveVisualGraph()).ok, true);
  assert.equal(run("api", positiveApiGraph()).ok, true);
  assert.equal(run("expanded", positiveApiGraph("expanded")).ok, true);

  const nested = {
    nodes: [{ id: "call", type: "sub-local", inputs: [], outputs: [] }],
    links: [],
    definitions: {
      subgraphs: [{ id: "sub-local", nodes: positiveVisualGraph().nodes, links: [] }],
    },
  };
  const nestedResult = run("visual", nested);
  assert.equal(nestedResult.ok, true, JSON.stringify(nestedResult.diagnostics));
  assert.equal(nestedResult.stats.subgraphs, 1);

  const bundle = {
    layers: [
      { kind: "visual", graph: positiveVisualGraph() },
      { kind: "api", graph: positiveApiGraph() },
      { kind: "expanded", graph: positiveApiGraph("expanded") },
    ],
  };
  const bundleResult = run("bundle", bundle);
  assert.equal(bundleResult.ok, true, JSON.stringify(bundleResult.diagnostics));
  assert.equal(bundleResult.stats.graphs, 5);
});

test("kind is explicit and graph-kind ambiguity fails closed", () => {
  assertRejectsOnly("visual", positiveApiGraph(), "GRAPH.VISUAL_GRAPH_INVALID");
  assert.equal(run("guessed", positiveVisualGraph()).diagnostics[0].code, "GRAPH.KIND_INVALID");
  assertRejectsOnly("bundle", { layers: [{ graph: positiveApiGraph() }] }, "GRAPH.BUNDLE_LAYER_INVALID");
});

for (const classType of FORBIDDEN_PARTNER_CLASS_TYPES) {
  test(`explicit Partner/API seed ${classType} is rejected`, () => {
    assertRejectsOnly("api", { hostile: { class_type: classType, inputs: {} } }, "GRAPH.PARTNER_API_NODE");
  });
}

test("unknown, auth/cloud, and display-name spoof identities are distinct fail-closed cases", () => {
  assertRejectsOnly("api", { hostile: { class_type: "TotallyUnknownLocalNode", inputs: {} } }, "GRAPH.UNKNOWN_CLASS_TYPE");
  assertRejectsOnly("api", { hostile: { class_type: "CloudAuthProviderNode", inputs: {} } }, "GRAPH.REMOTE_OR_AUTH_NODE");
  assertRejectsOnly("api", { hostile: { class_type: "UnknownNode", inputs: {}, _meta: { title: "MiniMax H3 Sigma Shift" } } }, "GRAPH.DISPLAY_NAME_SPOOF");
  assertRejectsOnly("visual", { nodes: [{ id: 1, type: "MiniMax H3 Sigma Shift", title: "harmless" }], links: [] }, "GRAPH.DISPLAY_NAME_SPOOF");
});

test("descriptor-known input names and types are enforced; auth/cloud extras are primary", () => {
  const unknown = positiveApiGraph();
  unknown.nodes.sigma.inputs.unlisted = 1;
  assertRejectsOnly("api", unknown, "GRAPH.UNKNOWN_INPUT");
  const auth = positiveApiGraph();
  auth.nodes.sigma.inputs.api_token = "secret-not-reported";
  assertRejectsOnly("api", auth, "GRAPH.FORBIDDEN_INPUT");
  const wrongType = positiveApiGraph();
  wrongType.nodes.sigma.inputs.shift_video = "12";
  assertRejectsOnly("api", wrongType, "GRAPH.INPUT_VALUE_TYPE_MISMATCH");
});

test("node-supplied origin/fingerprint/flag identity cannot authorize itself", () => {
  const graph = positiveApiGraph();
  graph.nodes.sigma.origin = { origin_uri: "https://github.com/Comfy-Org/ComfyUI" };
  assertRejectsOnly("api", graph, "GRAPH.NODE_IDENTITY_SELF_ASSERTION");
});

test("orphan and nested definitions are linted even when unreachable or disabled", () => {
  const graph = positiveVisualGraph();
  graph.definitions = {
    subgraphs: [{
      id: "orphan",
      nodes: [{ id: 9, type: "MinimaxHailuo03TextToVideoNode", mode: 4 }],
      links: [],
    }],
  };
  assertRejectsOnly("visual", graph, "GRAPH.PARTNER_API_NODE");
});

test("official template tuple metadata never grants trust or bypasses subgraph traversal", async () => {
  const referencePath = fileURLToPath(new URL("../fixtures/reference/official-template-tuples.json", import.meta.url));
  const tuple = JSON.parse(await readFile(referencePath, "utf8"));
  assert.equal(tuple.locked_revision, "71f43419e53dfcb16330748f3b933ac0efcc4778");
  const graph = positiveVisualGraph();
  graph.extra = { non_authoritative_template_tuple: tuple };
  graph.definitions = {
    subgraphs: [{
      id: "unreachable-template-subgraph",
      nodes: [{ id: 10, type: "MinimaxHailuo03ReferenceNode" }],
      links: [],
    }],
  };
  assertRejectsOnly("visual", graph, "GRAPH.PARTNER_API_NODE");
});

test("structural auto-queue controls and queue endpoints are rejected", () => {
  const auto = positiveVisualGraph();
  auto.extra = { auto_queue: true };
  assertRejectsOnly("visual", auto, "GRAPH.AUTO_QUEUE_CONTROL");
  const endpoint = positiveApiGraph();
  endpoint.nodes.sigma._meta = { action: "http://127.0.0.1:8188/prompt" };
  assertRejectsOnly("api", endpoint, "GRAPH.AUTO_QUEUE_TARGET");
  const hook = positiveVisualGraph();
  hook.config = { hook: "/queue" };
  assertRejectsOnly("visual", hook, "GRAPH.AUTO_QUEUE_TARGET");
});

test("ordinary prompt, title, filename, widget, and SaveVideo hidden prompt data are not keyword-scanned", () => {
  const graph = {
    nodes: [{
      id: 1,
      type: "SaveVideo",
      title: "explain /prompt and queue without running either",
      inputs: [{ name: "prompt", type: "PROMPT", link: null }],
      widgets_values: ["submit /queue", "folder/queue-file.mp4"],
      properties: { display_name: "filename says enqueue" },
    }],
    links: [],
    extra: { filename: "queue", title: "/prompt", prompt: { queue: true, class_type: "not execution here" } },
  };
  const result = run("visual", graph);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
});

test("hidden execution-shaped metadata fails closed", () => {
  const graph = positiveVisualGraph();
  graph.extra = { harmless: { nodes: [{ class_type: "MinimaxHailuo03TextToVideoNode" }] } };
  assertRejectsOnly("visual", graph, "GRAPH.HIDDEN_EXECUTION_SHAPE");
});

test("two runs are byte-identical, do not mutate inputs, and have no fetch side effects", () => {
  const fixture = documents();
  const graph = positiveApiGraph();
  const before = JSON.stringify({ graph, fixture });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("network side effect"); };
  try {
    const first = lintStaticGraph({ kind: "api", graph, ...fixture });
    const second = lintStaticGraph({ kind: "api", graph, ...fixture });
    assert.equal(JSON.stringify(first), JSON.stringify(second));
    assert.equal(JSON.stringify({ graph, fixture }), before);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
