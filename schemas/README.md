# Shared contract authoring rules

> Status: conventions only. No concrete P0-CON-002..011 business schema is created by P0-CON-001.
>
> Binding source after Root acceptance: [`ADR-004-contract-conventions.md`](../docs/adr/ADR-004-contract-conventions.md).

## Product boundary

Schemas describe installation, detection, configuration, workflow compilation/handoff and deterministic technical state. They do not authorize tool-side media generation, cloud/Partner inference, prompt creation or automatic ComfyUI queue submission. MiniMax H3 generates video and native audio only inside ComfyUI after the user clicks Run.

## Future directory layout

Concrete contract owners use the following versioned layout:

```text
schemas/
  README.md
  common/
    <version>/
      <name>.schema.json
  contracts/
    <contract-name>/
      <version>.schema.json
      fixtures/
        <version>/
          valid/
          invalid/
          boundary/
          canonical/
  migrations/
    <contract-name>/
      <from-version>__<to-version>/
        README.md
        fixtures/
```

P0-CON-001 intentionally creates none of these subtrees. A later owner creates only its assigned contract subtree. Migration implementation code belongs to the selected product stack, not implicitly under `schemas/`; this directory holds its contract and fixtures.

## Mandatory schema profile

- JSON Schema Draft 2020-12.
- `$id`: `urn:minimax-h3-tool:schema:<contract-name>:<MAJOR.MINOR.PATCH>`.
- `$ref`: exact offline-resolved `$id`; never network, `latest`, `main` or version range.
- Contract root: `contract_id`, `schema_version`, `document_id`; persisted documents also follow the ADR revision/integrity rules.
- Field names: `lower_snake_case`; contract/file names: `lower-kebab-case`; enum/kind: `lower_snake_case`.
- Non-composed objects use `additionalProperties: false`; composed object boundaries use `unevaluatedProperties: false`.
- Every constraint has a stable `x-error-code`/rule ID.
- Every property declares/inherits `x-sensitive` and `x-trust-impact`.
- Operational fields are required or selected by a required `kind` discriminator.
- No semantic use of JSON Schema `default`; null is forbidden unless explicitly meaningful.
- Number tokens use integer-only lexical form and I-JSON safe range; fractions/timebases use reduced rationals with exact units.
- UTC timestamp strings use mandatory assertion format `utc-date-time-ms` with exact `YYYY-MM-DDTHH:mm:ss.SSSZ`.
- Private/local path formats are exactly `windows-absolute-path` and `contract-relative-path`; format assertion is mandatory.
- Tool-persisted contract instances use UTF-8/no BOM and RFC 8785 canonical bytes/integrity.

Schema source files and fixtures may be pretty-printed for review. Their evidence must include the JCS logical schema/instance digest; tool-persisted production instances use exact canonical bytes.

## Trust classes must be explicit

Every contract README/schema annotation selects one primary class from ADR-004:

- immutable authority;
- mutable control state;
- persisted user configuration;
- runtime observation;
- user-selected path;
- external-instance discovery;
- generated visual/API graph;
- technical run/checkpoint evidence.

If a document crosses classes, split it or use the strictest class. Local presence never makes data trusted. Observation/discovery cannot authorize execution, reuse, deletion or capability promotion.

## Unknown fields and extensions

Core objects are closed. Unknown operational field, enum or union kind is an error. Do not add a permissive `additionalProperties: true` or a generic catch-all map.

An optional root `extensions` object is allowed only when the concrete schema declares it. Unknown extensions must use a reverse-DNS key, exact `extension_version`, and `effect: "display_metadata"`; consumers preserve but never interpret bounded `data`. An operational extension requires its own exact registered schema/capability and cannot masquerade as display metadata.

Raw upstream evidence may be preserved only in a named, bounded observation container and remains non-actionable.

## Hash and artifact vocabulary

- `integrity.content_sha256`: RFC 8785 JCS hash of the root document with the root `integrity` property removed.
- `artifact_sha256`: raw bytes hash of model/wheel/archive/media.
- `schema_content_sha256`: JCS logical schema hash.
- Canonical visual/API graph hashes: stored by workflow-build sidecar; they never authorize auto-queue.

All SHA-256 text is lower-case `sha256:<64 hex>`. A hash is not a signature, provenance verdict, owner marker or delete authority.

## Required fixtures per contract

Each contract owner supplies:

1. minimal and maximal valid documents;
2. every enum/union/state branch;
3. unknown core field/enum/kind failures;
4. missing required, illegal null/empty/default-assumption failures;
5. duplicate key, invalid UTF-8/BOM, oversize/depth/count boundaries;
6. canonical JCS bytes and expected content hash;
7. timestamp, safe-integer, rational reduction/unit failures;
8. Windows absolute/relative path and containment-related representations when relevant;
9. display-extension preservation/bounds, or an explicit no-extension test;
10. sensitive/support-export projection;
11. exact deterministic `(code, instance_path, rule_id)` expectations;
12. migration fixtures or an explicit immutable/no-migration policy;
13. cross-document ID + revision + content-hash mismatch fixtures where referenced.

Invalid fixtures must assert the exact normalized error tuple, not merely “validator returned false.” Binary/model/media fixtures are references with role/length/hash; never embed large base64 data here.

## Downstream ownership map

| Task | Expected contract area | Primary trust emphasis |
|---|---|---|
| P0-CON-002 | capability catalog + local-node allowlist | immutable authority; status/schema/unknown-node fail-closed |
| P0-CON-003 | component manifest + provenance | immutable authority; raw artifact identity and immutable source |
| P0-CON-004 | minimal Alpha recipe | immutable authority; reconstructable cross-references |
| P0-CON-005 | project specification + asset roles | untrusted persisted user configuration; exact user text |
| P0-CON-006 | install state + transaction | mutable control state; idempotent state/atomic commit |
| P0-CON-007 | ownership ledger | mutable control state; delete authority/external-read-only |
| P0-CON-008 | hardware report + model registry | runtime observation plus controlled registry progression |
| P0-CON-009 | Route/Canvas/FrameAudio plans | exact integer/rational units and endpoint strategy |
| P0-CON-010 | template binding + workflow build | generated graph; visual/API/source hash closure |
| P0-CON-011 | run/segment/checkpoint/media plan | technical run evidence; parent/timebase/atomic state |
| P0-CON-012 | cross-contract invariant harness | exact mismatch rule/error tuples across the Alpha fixture |

One worker may not edit another contract subtree without Root granting the `SCHEMA` lock and path ownership.

## Reviewer quick gate

Before accepting a schema, confirm:

- exact `$id`/version/digest and no mutable reference;
- primary trust class and closed objects;
- required/optional/null/default semantics;
- unknown enum/union/extension behavior;
- JCS/integrity/raw-artifact hash separation;
- UTC/integer/rational/unit rules;
- private Windows path representation and handle-based action policy;
- explicit migration/downgrade refusal and atomic persistence;
- default-deny redaction plus provenance/correlation separation;
- global limits and deterministic error fixtures;
- cross-contract references bind document ID + revision + content hash;
- no shell, arbitrary HTTP, cloud/Partner, prompt-creative, queue-submit or auto-Run field.

If any convention is unresolved, keep that concrete schema Proposed/blocked and request an ADR-004 amendment rather than selecting an implementation-specific default.
