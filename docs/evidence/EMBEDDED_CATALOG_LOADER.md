# P2-INS-002 embedded catalog loader evidence

## Scope confirmation and result

I only implement installation, detection, configuration, workflow compilation, deterministic orchestration, or technical verification. MiniMax H3 generates the actual video and audio inside ComfyUI.

P2-INS-002 is implemented as a package-local, data-only embedded catalog loader. It accepts one catalog from the current application build only after an independently configured app trust key authenticates a canonical signed build-inventory payload and every app/resource/content binding agrees. It returns frozen lazy data and contains no action capability.

No network request, download, install, update, materialization, delete, launch, queue, ComfyUI, GPU, custom-node/Python import or execution, or media generation was performed or added.

## Trust and binding model

The loader is constructed with the current app tuple and a bounded set of canonical Ed25519 SPKI public keys supplied separately by the privileged application packaging boundary. The signed inventory cannot provide or approve its own trust key, and a `verified`-style boolean is not accepted. Trust-anchor DER is bounded before it is copied, must parse as Ed25519 and must exactly match its canonical DER re-export.

The signed envelope is exact JCS UTF-8. Its detached Ed25519 signature covers the JCS encoding of the closed payload. The payload must be active, identify the signing key and policy, identify the current app artifact, and contain exactly one active component-manifest binding. The following values must agree across the current app configuration, authenticated inventory, selected embedded resource and validated manifest:

```text
(app_id, app_version, app_build_id, catalog_resource, integrity.content_sha256)
```

`integrity.content_sha256` is recomputed from RFC 8785 JCS with the entire root `integrity` property omitted. The accepted shared schema is hard-pinned to:

```text
sha256:62704fae90e6f9d1895a3d1351b8664f67222aedb8db390ab46e674394236608
```

The manifest's `external_binding_requirement` literal is treated only as data. It is not signature proof.

## Embedded resource cardinality

The input adapter must label its index `complete_current_app_embedded_resource_index`. The loader permits unrelated embedded app resources but requires exactly one `component_catalog` candidate. It rejects zero or multiple candidates, duplicate names, ASCII case aliases under its package-local simple ordinal fold, network catalog locators, percent-encoded catalog traversal, mutable catalog segments, and any remote discovery, override or fallback field without attempting network access. The current evidence does not claim an OS `CompareStringOrdinal` call or exhaustive Unicode-equivalence proof.

This module deliberately has no file-system access. Therefore the declaration that an input index is complete is a caller assertion: actual exhaustive enumeration of packaged resources remains a production app-adapter and packaging-test obligation. This evidence does not claim that a pure function can detect a packaged resource omitted by its caller.

## Strict parser and validation order

Both inventory and catalog bytes are checked against the 16 MiB raw limit before defensive copying. Parsing follows the ADR-004 profile: fatal UTF-8, no BOM, duplicate-key detection before insertion, integer-only lexical form, no negative zero, safe-integer range, no NUL or unpaired surrogate, and bounded depth/value/property/item/key/string totals.

The global ceilings are 16 MiB raw bytes, depth 64, 200,000 values, 10,000 object properties, 10,000 array items, 128 UTF-8 bytes per key, 1 MiB per string and 12 MiB total string bytes. Manifest validation order is size/encoding/parse → envelope/version → logical integrity → exact schema → domain → dependency/actionability closure → current-app authenticated cross-binding. A contract-valid revoked or superseded manifest remains readable evidence at the shared-contract layer but is rejected by this current-app loader; only `disposition.kind: active` loads.

Every hostile fixture asserts the exact stable tuple `{code, stage, instance_path, rule_id}`. Dynamic pointer tokens use RFC 6901 escaping. Parser byte offsets are exposed only when exact; raw values and private paths are not included.

## Data-only output and authority boundary

Successful loading returns a deeply frozen `lazy_embedded_component_catalog_data` handle with metadata, counts and read-only component/license lookup and iteration. The surface has no download, materialize, execute, delete, launch, queue or install method. A revision-pinned immutable HTTPS artifact locator is allowed only as inert component metadata; the catalog discovery path remains embedded-only and offline.

The loader does not grant artifact approval, license approval, provenance approval, ownership, selection, download, installation or deletion authority. Later services must independently satisfy their own contracts and gates.

## Deterministic fixtures and acceptance evidence

The package suite contains a valid signed-current-build path, a frozen/lazy capability-boundary check, an inert immutable-HTTPS metadata check, trust-key hardening checks and 47 exact fail-closed cases. Those cases cover exhaustive-index assertion, catalog cardinality and case aliases, discovery/override/fallback fields, network and percent-encoded catalog paths, canonical signed inventory, duplicate-key confusion at the signature boundary, signature/key/policy/status drift, three-way app/resource/hash drift, strict JSON lexical and resource ceilings, schema/integrity/domain/closure failures, manifest status drift and authority escalation.

Acceptance commands:

```text
npm --prefix packages/installer/catalog-loader test
node packages/installer/catalog-loader/test/catalog-loader.test.mjs  # repeated twice for stdout identity
npm test
powershell -NoProfile -ExecutionPolicy Bypass -File tasks/validate_wbs.ps1
```

Final observed results, all with exit code 0:

```text
package npm test: SUMMARY passed=55 failed=0 negative_cases=47
deterministic run 1: stdout_sha256=f5c3e338c549c3db15b0865e26bd47db766a5b2f6fe4ca3367023d7c8e79fa17
deterministic run 2: stdout_sha256=f5c3e338c549c3db15b0865e26bd47db766a5b2f6fe4ca3367023d7c8e79fa17
stdout byte-identical: true
root npm test: SUMMARY passed=5 failed=0 blocked=0 skipped=0
WBS: WBS_VALIDATION_OK tasks=152 unique=152 missing=0 cycles=0 registry_drift=0 active=36 wave=9 external=2 roots=P0-GOV-001
```

The repeated stdout digest covers the direct deterministic package runner output (without package-manager banner text). The suite also snapshots every file under the package before executing loader cases and verifies the package tree remains byte-identical afterward.

## Delegated upstream identity data

`test/fixtures/user-provided-upstream-identities.json` stores the following user-provided/delegated future catalog identity data exactly. It was not independently verified and is not license, provenance, signature, release, compatibility, selection or action approval:

| Role | Byte length | SHA-256 |
|---|---:|---|
| FL2VA main | 20,970,379,616 | `e889202c41dafb67b10d67b97f0d8541508036a6090af23425a5c2615d03c47a` |
| text | 15,687,142,551 | `35a88d51044231fe332301d7a62aa81e3f2cba62febeb446e2c1e3e0ef76f2c6` |
| videoVAE | 5,207,808,496 | `7c1f131492e7eddacaac9069a61b81bdd39de5cc96561e677c5eab1cdce5e522` |
| audioVAE | 605,254,808 | `8e505d95dd1561d47abd43d4238fd40d9bb1ae9e147ed0a4cba778d76ae4db48` |
| Ref2VA | 20,970,379,616 | `9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779` |

The delegated upstream revision is `4cc1d817b6184899b41293954329f576cb5ae86b`. The fixture is explicitly `blocked`, non-actionable, license-unapproved, provenance-unverified and signature-unverified. Ref2VA remains blocked merely by being listed. The fixture's pinned JCS identity is:

```text
sha256:f48c6dcb82bf8ebf834072082f0e34b5562243ae13b2b4cd06012c8b90b71759
```

## Conclusion classification

- **Proven:** package-local strict parsing, accepted-schema/domain/closure validation, signature verification against a separately configured canonical Ed25519 trust key, exact current-app/resource/JCS-content binding, status drift rejection, frozen lazy data-only output and the enumerated fail-closed behaviors under deterministic fixtures.
- **Inferred pending integration:** a production app adapter can supply a truly exhaustive embedded-resource index and app-embedded trust anchor while preserving this API contract.
- **Blocked external:** real build signing keys/inventory, packaging-adapter exhaustiveness evidence, real catalog population, upstream artifact verification, license approval, provenance/signature evidence and any later materialization/installation decision.

## Files, contracts and next dependencies

Created package code, tests, fixtures and API documentation under `packages/installer/catalog-loader/`, plus this evidence file. No shared schema, app code, registry/WBS content, repository package metadata, root lockfile or other path was changed. The package imports the accepted component-manifest schema read-only and pins its digest; it introduces only a package-local loader and signed-inventory envelope API.

After Root acceptance, this completes the P2-INS-002 dependency for P2-INS-003 (pre-download license/region gate), P2-INS-004 (peak/final space planner), P2-INS-008 (safe fixed-archive materializer), P2-UX-002 and QA-018. None of those later operations is authorized by loader success alone.
