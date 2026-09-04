import test from "node:test";
import assert from "node:assert/strict";
import { LIMITS, lintStaticGraph } from "../src/index.mjs";
import { documents, positiveApiGraph, positiveVisualGraph } from "./fixture-factory.mjs";

function run(kind, graph, limits) {
  return lintStaticGraph({ kind, graph, ...documents(), limits });
}

function has(result, code) {
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((item) => item.code === code), JSON.stringify(result.diagnostics));
}

function visualNode(id) {
  return { id, type: "MiniMaxH3SigmaShift", outputs: [{ name: "MODEL", type: "MODEL", links: [] }] };
}

test("duplicate IDs and dangling links reject with one primary structural diagnostic", () => {
  const duplicate = { nodes: [visualNode(1), visualNode(1)], links: [] };
  assert.deepEqual(run("visual", duplicate).diagnostics.map((item) => item.code), ["GRAPH.DUPLICATE_NODE_ID"]);
  const dangling = { nodes: [visualNode(1)], links: [[1, 1, 0, 2, 0, "MODEL"]] };
  assert.deepEqual(run("visual", dangling).diagnostics.map((item) => item.code), ["GRAPH.DANGLING_LINK"]);
});

test("direct and indirect graph dependency cycles are rejected", () => {
  const direct = { nodes: [visualNode(1)], links: [[1, 1, 0, 1, 0, "MODEL"]] };
  assert.deepEqual(run("visual", direct).diagnostics.map((item) => item.code), ["GRAPH.EXECUTION_CYCLE"]);
  const indirect = {
    nodes: [visualNode(1), visualNode(2), visualNode(3)],
    links: [
      [1, 1, 0, 2, 0, "MODEL"],
      [2, 2, 0, 3, 0, "MODEL"],
      [3, 3, 0, 1, 0, "MODEL"],
    ],
  };
  assert.deepEqual(run("visual", indirect).diagnostics.map((item) => item.code), ["GRAPH.EXECUTION_CYCLE"]);
});

function refNode(id, target) {
  return { id, type: target, inputs: [], outputs: [] };
}

test("direct and indirect subgraph-reference cycles are rejected, including orphan definitions", () => {
  const direct = {
    nodes: [], links: [],
    definitions: { subgraphs: [{ id: "A", inputs: [], outputs: [], nodes: [refNode(1, "A")], links: [] }] },
  };
  assert.deepEqual(run("visual", direct).diagnostics.map((item) => item.code), ["GRAPH.SUBGRAPH_REFERENCE_CYCLE"]);
  const indirect = {
    nodes: [], links: [],
    definitions: { subgraphs: [
      { id: "A", inputs: [], outputs: [], nodes: [refNode(1, "B")], links: [] },
      { id: "B", inputs: [], outputs: [], nodes: [refNode(2, "C")], links: [] },
      { id: "C", inputs: [], outputs: [], nodes: [refNode(3, "A")], links: [] },
    ] },
  };
  assert.deepEqual(run("visual", indirect).diagnostics.map((item) => item.code), ["GRAPH.SUBGRAPH_REFERENCE_CYCLE"]);
});

test("subgraph reference inputs are closed against declared interfaces and cannot hide execution", () => {
  const graph = {
    nodes: {
      call: { subgraph_ref: "typed", inputs: { hidden: { class_type: "MinimaxHailuo03TextToVideoNode", inputs: {} } } },
    },
    definitions: {
      subgraphs: [{ id: "typed", kind: "api", inputs: [], outputs: [], graph: {} }],
    },
  };
  assert.deepEqual(run("api", graph).diagnostics.map((item) => item.code), ["GRAPH.SUBGRAPH_INPUT_MISMATCH"]);
});

test("subgraph call dependencies contribute edges and graph-cycle detection", () => {
  const graph = {
    nodes: {
      call: { subgraph_ref: "typed", inputs: { model: ["sigma", 0] } },
      sigma: {
        class_type: "MiniMaxH3SigmaShift",
        inputs: { model: ["call", 0], shift_video: 12, shift_audio: 3 },
      },
    },
    definitions: {
      subgraphs: [{
        id: "typed", kind: "api",
        inputs: [{ name: "model", type: "MODEL" }],
        outputs: [{ name: "model", type: "MODEL" }],
        graph: {},
      }],
    },
  };
  const result = run("api", graph);
  assert.deepEqual(result.diagnostics.map((item) => item.code), ["GRAPH.EXECUTION_CYCLE"]);
  assert.equal(result.stats.edges, 2);
});

test("dangling and untyped subgraph references fail closed", () => {
  const dangling = { nodes: { call: { subgraph_ref: "missing", inputs: {} } } };
  assert.deepEqual(run("api", dangling).diagnostics.map((item) => item.code), ["GRAPH.DANGLING_SUBGRAPH_REF"]);
  const untyped = {
    nodes: { call: { subgraph_ref: "typed", inputs: {} } },
    definitions: { subgraphs: [{ id: "typed", kind: "api", graph: {} }] },
  };
  assert.deepEqual(run("api", untyped).diagnostics.map((item) => item.code), ["GRAPH.SUBGRAPH_INTERFACE_MISSING"]);
});

function chain(length) {
  const subgraphs = [];
  for (let index = 0; index < length; index += 1) {
    subgraphs.push({
      id: `S${index}`,
      inputs: [], outputs: [],
      nodes: index + 1 < length ? [refNode(index, `S${index + 1}`)] : [],
      links: [],
    });
  }
  return { nodes: [], links: [], definitions: { subgraphs } };
}

test("subgraph reference depth accepts N and rejects N+1 at the fixed limit", () => {
  assert.equal(run("visual", chain(LIMITS.maxSubgraphRefDepth)).ok, true);
  has(run("visual", chain(LIMITS.maxSubgraphRefDepth + 1)), "STRUCTURE.SUBGRAPH_REF_DEPTH_LIMIT");
});

test("node, edge, and subgraph count limits accept N and reject N+1", () => {
  const nodesAt = Array.from({ length: LIMITS.maxNodes }, (_, index) => visualNode(index));
  assert.equal(run("visual", { nodes: nodesAt, links: [] }).ok, true);
  has(run("visual", { nodes: [...nodesAt, visualNode(LIMITS.maxNodes)], links: [] }), "STRUCTURE.NODE_LIMIT");

  const twoNodes = [visualNode(1), visualNode(2)];
  const linksAt = Array.from({ length: LIMITS.maxEdges }, (_, index) => [index, 1, 0, 2, 0, "MODEL"]);
  assert.equal(run("visual", { nodes: twoNodes, links: linksAt }).ok, true);
  has(run("visual", { nodes: twoNodes, links: [...linksAt, [LIMITS.maxEdges, 1, 0, 2, 0, "MODEL"]] }), "STRUCTURE.EDGE_LIMIT");

  const definitionsAt = Array.from({ length: LIMITS.maxSubgraphs }, (_, index) => ({ id: `S${index}`, inputs: [], outputs: [], nodes: [], links: [] }));
  assert.equal(run("visual", { nodes: [], links: [], definitions: { subgraphs: definitionsAt } }).ok, true);
  has(run("visual", { nodes: [], links: [], definitions: { subgraphs: [...definitionsAt, { id: "overflow", inputs: [], outputs: [], nodes: [], links: [] }] } }), "STRUCTURE.SUBGRAPH_LIMIT");
});

test("diagnostics and deterministic visit budget are bounded", () => {
  const graph = { nodes: Array.from({ length: 5 }, (_, index) => ({ id: index, type: `Unknown${index}` })), links: [] };
  const result = run("visual", graph, { maxDiagnostics: 2 });
  assert.equal(result.diagnostics.length, 2);
  assert.equal(result.diagnostics_truncated, true);
  assert.equal(result.diagnostics_omitted, 3);
  has(run("visual", positiveVisualGraph(), { maxVisitBudget: 1 }), "STRUCTURE.VISIT_BUDGET");
});
