# Static local-node graph lint

This package implements P1-WF-002 as a zero-dependency Node.js 24+ ESM library and read-only CLI. It performs **static authority binding**, not runtime certification. MiniMax H3 remains the only component that generates video and native audio, inside ComfyUI after the user clicks Run.

Authority is not established by caller-supplied self-hashes. The package compiles the one accepted allowlist document ID/revision/content digest and an ordered digest of all four exact active identity tuples (class type, three schema fingerprints, origin URI/revision/path/blob, flags, and disposition). A caller cannot replace that trust root. Accepting a future authority requires a reviewed package/code revision.

The library never reads files, fetches, imports custom-node Python or JavaScript, evaluates graph content, spawns a process, mutates an input, launches ComfyUI, submits `/prompt` or `/queue`, generates media, or rewrites prompt text. The CLI is a narrow adapter that reads three local regular JSON files and invokes the pure core.

## API

```js
import { lintStaticGraph, lintStaticJsonBytes } from "@minimax-h3/static-graph-lint";

const result = lintStaticGraph({
  kind: "visual", // visual | api | expanded | bundle
  graph,
  allowlist,
  descriptors,
});
```

`kind` is mandatory. The linter never guesses a graph kind. A bundle is `{ "layers": [{ "kind": "visual|api|expanded", "graph": ... }] }`; every layer is checked. Visual `definitions.subgraphs` and explicitly typed API/expanded subgraphs are checked even when unreachable.

Results contain bounded, sorted `{code, instance_path, rule_id}` diagnostics and a deterministic digest. They contain no timestamp, filename, absolute path, node value, prompt, or user data. `runtime_certified` is always `false`: live managed-runtime `/api/object_info` matching is a separate gate.

## CLI

```powershell
node .\bin\static-graph-lint.mjs `
  --graph .\workflow.json `
  --allowlist .\node-allowlist.json `
  --descriptors .\node-descriptors.json `
  --kind visual `
  --format json
```

Only the exact flags above are accepted; `--format` is optional (`json` or `lines`). Stdin, URI/URL, UNC/device/ADS paths, directories, symlinks/reparse paths when detectable, duplicate flags, and unknown flags fail before parsing. Exit codes: `0` pass, `1` lint rejection, `2` CLI/input failure.

Run tests with:

```powershell
npm --prefix packages/workflow/static-graph-lint test
```

See [SPEC.md](./SPEC.md) for the descriptor sidecar contract, graph shapes, exact limits, and trust boundary.
