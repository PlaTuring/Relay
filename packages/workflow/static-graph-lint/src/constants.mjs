export const LIMITS = Object.freeze({
  maxFileBytes: 8 * 1024 * 1024,
  maxTotalBytes: 24 * 1024 * 1024,
  maxJsonDepth: 128,
  maxJsonValues: 200_000,
  maxJsonProperties: 100_000,
  maxStringBytes: 1024 * 1024,
  maxAggregateStringBytes: 8 * 1024 * 1024,
  maxNodes: 4_096,
  maxEdges: 16_384,
  maxSubgraphs: 256,
  maxSubgraphRefDepth: 16,
  maxDiagnostics: 512,
  maxVisitBudget: 500_000,
});

export const GRAPH_KINDS = Object.freeze(["visual", "api", "expanded", "bundle"]);

export const FORBIDDEN_PARTNER_CLASS_TYPES = Object.freeze([
  "MinimaxTextToVideoNode",
  "MinimaxImageToVideoNode",
  "MinimaxSubjectToVideoNode",
  "MinimaxHailuoVideoNode",
  "MinimaxHailuo03TextToVideoNode",
  "MinimaxHailuo03FirstLastFrameNode",
  "MinimaxHailuo03ReferenceNode",
  "MinimaxHailuo03ContextIRNode",
  "MinimaxHailuo03RegenerateNode",
]);

export const ALLOWED_CORE_CLASS_TYPES = Object.freeze([
  "EmptyMiniMaxH3LatentAV",
  "MiniMaxH3ImageToVideo",
  "MiniMaxH3AddGuide",
  "MiniMaxH3ReferenceToVideo",
  "MiniMaxH3SigmaShift",
  "CreateVideo",
  "SaveVideo",
]);

export const AUTHORITY = Object.freeze({
  contractId: "minimax-h3-tool.node-allowlist",
  schemaVersion: "1.0.0",
  documentRevision: 1,
  runtimeTopology: "managed_core",
  backendOriginUri: "https://github.com/Comfy-Org/ComfyUI",
  backendLockedRevision: "d8e7bbc9d586d95f758d6b0ed23d519088be578a",
  policy: "exact_class_type_and_all_fingerprints_local_only",
  fingerprintProfile: Object.freeze({
    algorithm: "sha256",
    normalization: "sha256_c14n_json_sort_keys_v1",
    input_projection: "required_inputs_optional_inputs_hidden_inputs",
    output_projection: "outputs",
    combined_projection: "class_type_required_inputs_optional_inputs_hidden_inputs_outputs_flags",
  }),
});

export const TRUSTED_ALLOWLIST_ANCHOR = Object.freeze({
  contract_id: "minimax-h3-tool.node-allowlist",
  schema_version: "1.0.0",
  document_id: "10000000-0000-4000-8000-000000000001",
  document_revision: 1,
  content_sha256: "sha256:483262e8c31d1a47fa6c2bccd110bc64889b4c9ef2b0be032bd01c9367dbf300",
  backend_origin_uri: "https://github.com/Comfy-Org/ComfyUI",
  backend_locked_revision: "d8e7bbc9d586d95f758d6b0ed23d519088be578a",
  entry_tuple_sha256: "sha256:0aea35df5baefaa0a385d9f220370b63e1471225c77dd32022863c458143ea5a",
  class_types: Object.freeze([
    "MiniMaxH3ImageToVideo",
    "MiniMaxH3SigmaShift",
    "CreateVideo",
    "SaveVideo",
  ]),
});

export const DESCRIPTOR = Object.freeze({
  contractId: "minimax-h3-tool.static-node-descriptors",
  schemaVersion: "1.0.0",
  documentRevision: 1,
});

export const RULES = Object.freeze({
  input: "static_graph.input.v1",
  authority: "static_graph.authority.v1",
  descriptor: "static_graph.descriptor.v1",
  graph: "static_graph.graph.v1",
  structure: "static_graph.structure.v1",
  noQueue: "static_graph.no_first_queue.v1",
  cli: "static_graph.cli.v1",
});

export function tightenedLimits(overrides) {
  if (overrides === undefined || overrides === LIMITS) return LIMITS;
  const result = {};
  for (const [key, fixed] of Object.entries(LIMITS)) {
    const proposed = overrides?.[key];
    result[key] = Number.isSafeInteger(proposed) && proposed > 0 ? Math.min(fixed, proposed) : fixed;
  }
  return Object.freeze(result);
}
