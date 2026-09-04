import { GRAPH_KINDS, LIMITS, RULES, tightenedLimits } from "./constants.mjs";
import { DiagnosticSink, makeResult } from "./diagnostics.mjs";
import { measureJsonValue, parseStrictJsonBytes, parseStrictJsonText, JsonInputError } from "./strict-json.mjs";
import { validateAuthority, validateDescriptors, computeDescriptorFingerprints, computeRootIntegrity } from "./authority.mjs";
import { lintGraphs } from "./graph.mjs";

function emptyStats() {
  return { graphs: 0, nodes: 0, edges: 0, subgraphs: 0, visits: 0 };
}

function addInputError(sink, error, prefix) {
  if (error instanceof JsonInputError) {
    const suffix = error.diagnostic.instance_path === "/" ? "" : error.diagnostic.instance_path;
    sink.add(error.diagnostic.code, `${prefix}${suffix}`, error.diagnostic.rule_id);
  } else {
    sink.add("INPUT.NON_JSON_VALUE", prefix, RULES.input);
  }
}

export function lintStaticGraph({ kind, graph, allowlist, descriptors, limits: requestedLimits }) {
  const limits = tightenedLimits(requestedLimits);
  const sink = new DiagnosticSink(limits.maxDiagnostics);
  const stats = emptyStats();
  if (!GRAPH_KINDS.includes(kind)) {
    sink.add("GRAPH.KIND_INVALID", "/kind", RULES.graph);
    return makeResult({ kind: typeof kind === "string" ? kind : "invalid", sink, stats, authorityBound: false });
  }
  for (const [value, path] of [[graph, "/graph"], [allowlist, "/allowlist"], [descriptors, "/descriptors"]]) {
    try {
      measureJsonValue(value, limits);
    } catch (error) {
      addInputError(sink, error, path);
      return makeResult({ kind, sink, stats, authorityBound: false });
    }
  }
  const authorityState = validateAuthority(allowlist, sink);
  if (!authorityState) return makeResult({ kind, sink, stats, authorityBound: false });
  const descriptorState = validateDescriptors(descriptors, authorityState, sink);
  if (!descriptorState) return makeResult({ kind, sink, stats, authorityBound: false });
  const actualStats = lintGraphs({ kind, graph, authority: authorityState, descriptors: descriptorState, sink, limits });
  return makeResult({ kind, sink, stats: actualStats, authorityBound: true });
}

export function lintStaticJsonBytes({ kind, graphBytes, allowlistBytes, descriptorBytes, limits: requestedLimits }) {
  const limits = tightenedLimits(requestedLimits);
  const sink = new DiagnosticSink(limits.maxDiagnostics);
  const stats = emptyStats();
  let graph;
  let allowlist;
  let descriptors;
  for (const [bytes, path, assign] of [
    [graphBytes, "/graph", (value) => { graph = value; }],
    [allowlistBytes, "/allowlist", (value) => { allowlist = value; }],
    [descriptorBytes, "/descriptors", (value) => { descriptors = value; }],
  ]) {
    try {
      assign(parseStrictJsonBytes(bytes, limits).value);
    } catch (error) {
      addInputError(sink, error, path);
      return makeResult({ kind: typeof kind === "string" ? kind : "invalid", sink, stats, authorityBound: false });
    }
  }
  return lintStaticGraph({ kind, graph, allowlist, descriptors, limits });
}

export {
  GRAPH_KINDS,
  LIMITS,
  JsonInputError,
  computeDescriptorFingerprints,
  computeRootIntegrity,
  parseStrictJsonBytes,
  parseStrictJsonText,
};
