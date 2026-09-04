# P1-WF-002 static graph lint specification

## Trust statement

Passing means only that the supplied graph is statically bound to the package's compiled immutable allowlist trust anchor and a matching package-local descriptor sidecar. Internal consistency and caller-supplied self-hashes are necessary but never sufficient. It does not prove the installed runtime, `/api/object_info`, Python source, model compatibility, runtime acceptance, GPU output, or queue behavior. Display names and node self-assertions are never authority.

The accepted trust root is exact: contract `minimax-h3-tool.node-allowlist` 1.0.0, document `10000000-0000-4000-8000-000000000001` revision 1, root content digest `sha256:483262e8c31d1a47fa6c2bccd110bc64889b4c9ef2b0be032bd01c9367dbf300`, backend origin `https://github.com/Comfy-Org/ComfyUI` at `d8e7bbc9d586d95f758d6b0ed23d519088be578a`, and ordered active-entry tuple digest `sha256:0aea35df5baefaa0a385d9f220370b63e1471225c77dd32022863c458143ea5a`. The caller cannot override it. A replacement authority requires a reviewed package/code revision with a new anchor; accepting a self-signed runtime document is forbidden.

The official template tuples in `fixtures/reference/official-template-tuples.json` are non-authoritative regression metadata. Their revision, byte length, and digest never add an allowed class. T2V/I2V `definitions.subgraphs` remain recursively linted, including orphan definitions. `api_*` and Partner nodes remain forbidden.

## Descriptor sidecar 1.0.0

The sidecar is an immutable JSON document with these exact root fields:

- `contract_id`: `minimax-h3-tool.static-node-descriptors`
- `schema_version`: `1.0.0`; `document_revision`: `1`; UUID-v4 `document_id`
- `authority_ref`: exact allowlist contract/version/document/revision/root digest tuple
- `fingerprint_profile`: byte-for-logical-value equality with the allowlist profile
- `descriptors`: exactly one active descriptor for every active allowlist entry
- `disposition`: `{ "kind": "active" }`
- `integrity`: SHA-256 of recursively sorted-key canonical JSON with the root `integrity` member omitted

Each descriptor contains exact `class_type`, ordered `required_inputs`, `optional_inputs`, `hidden_inputs`, ordered `outputs`, three fingerprints, origin, flags, proven evidence status, and active disposition. Array order is preserved. Object keys are recursively sorted before SHA-256. The projections are:

```text
input    = {required_inputs, optional_inputs, hidden_inputs}
output   = {outputs}
combined = {class_type, required_inputs, optional_inputs, hidden_inputs,
            outputs, flags:{is_api_node,is_output_node}}
```

All three computed fingerprints must equal both the descriptor values and immutable allowlist values. Origin URI, locked revision, source path, git blob, `local_only=true`, `is_api_node=false`, output flag, proven status, and active disposition must match exactly. This is source-descriptor binding only.

## Accepted graph shapes

- `visual`: a Comfy visual graph with `nodes` array and `links` array. Executable identity exists only at `nodes[*].type`. A node `type` exactly equal to a declared subgraph ID is a recognized subgraph reference.
- `api` and `expanded`: either a plain node-ID map or `{nodes, definitions?, version?}`. Executable nodes are exactly `{class_type, inputs, _meta?}`. A subgraph call is exactly `{subgraph_ref, inputs, _meta?}`.
- API/expanded definitions are `{subgraphs:[{id, kind, graph}]}` and `kind` must equal the containing layer. Visual definitions are visual subgraph objects with `id`, `nodes`, and `links`.
- `bundle`: `{layers:[{kind, graph}]}` with non-bundle explicit layer kinds.

Unknown or ambiguous execution containers fail closed. Every root and every definition, including disabled, unreachable, nested, and orphan definitions, is validated. Graph dependency cycles, subgraph-reference cycles, duplicate IDs, dangling links/references, type mismatch, and hidden graph-shaped metadata are rejected.

No-first-queue checks operate on structural control fields only. `auto_queue`, `run_on_load`, `submit`, `queue`, `enqueue`, or endpoint/action/hook targets for `/prompt` or `/queue` are forbidden. Ordinary prompt text, titles, display metadata, filenames, `widgets_values`, and descriptor-authorized `PROMPT`/`EXTRA_PNGINFO` inputs are not keyword-scanned. In particular, `SaveVideo`'s hidden `prompt` input is legitimate opaque data.

## Fixed ceilings

| Resource | Ceiling |
|---|---:|
| One input file | 8 MiB |
| Three CLI files total | 24 MiB |
| JSON depth | 128 |
| JSON values | 200,000 |
| JSON properties | 100,000 |
| One decoded string | 1 MiB UTF-8 |
| Aggregate decoded strings | 8 MiB UTF-8 |
| Nodes | 4,096 |
| Edges | 16,384 |
| Subgraphs | 256 |
| Subgraph-reference depth | 16 |
| Diagnostics | 512 |
| Deterministic visits | 500,000 |

Callers may tighten ceilings but cannot loosen them. Strict parsing rejects malformed JSON, duplicate keys, invalid UTF-8/BOM, invalid Unicode escapes, trailing data, non-finite numbers, and non-JSON object graphs.
