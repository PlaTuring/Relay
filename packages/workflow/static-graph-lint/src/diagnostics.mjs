import { LIMITS } from "./constants.mjs";
import { sha256Canonical } from "./canonical.mjs";

function compareDiagnostics(left, right) {
  const ordinal = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  return ordinal(left.instance_path, right.instance_path)
    || ordinal(left.code, right.code)
    || ordinal(left.rule_id, right.rule_id);
}

export class DiagnosticSink {
  #items = [];
  #dedupe = new Set();
  #omitted = 0;

  constructor(max = LIMITS.maxDiagnostics) {
    this.max = max;
  }

  add(code, instancePath, ruleId) {
    const item = Object.freeze({ code, instance_path: instancePath || "/", rule_id: ruleId });
    const key = `${item.instance_path}\u0000${item.code}\u0000${item.rule_id}`;
    if (!this.#dedupe.has(key)) {
      if (this.#items.length >= this.max) {
        this.#omitted += 1;
        return;
      }
      this.#dedupe.add(key);
      this.#items.push(item);
    }
  }

  get size() {
    return this.#items.length;
  }

  finalize() {
    const sorted = this.#items.slice().sort(compareDiagnostics);
    return Object.freeze({
      diagnostics: Object.freeze(sorted),
      truncated: this.#omitted > 0,
      omitted: this.#omitted,
    });
  }
}

export function makeResult({ kind, sink, stats, authorityBound }) {
  const finalized = sink.finalize();
  const base = {
    ok: finalized.diagnostics.length === 0,
    kind,
    authority_binding: authorityBound ? "static_authority_binding" : "rejected",
    runtime_certified: false,
    diagnostics: finalized.diagnostics,
    diagnostics_truncated: finalized.truncated,
    diagnostics_omitted: finalized.omitted,
    stats: Object.freeze({
      graphs: stats.graphs,
      nodes: stats.nodes,
      edges: stats.edges,
      subgraphs: stats.subgraphs,
      visits: stats.visits,
    }),
  };
  return Object.freeze({ ...base, digest: sha256Canonical(base) });
}
