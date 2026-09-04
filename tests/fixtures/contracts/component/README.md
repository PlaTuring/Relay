# Component manifest contract fixtures

Run from the repository root:

```text
node tests/fixtures/contracts/component/validate.mjs
```

The validator uses Node.js built-ins only. It reads local JSON and Markdown, performs no network request, starts no ComfyUI or H3 process, downloads no artifact, installs nothing, and never writes during validation.

## Valid baseline

`valid/component-role-examples.json` is synthetic schema evidence. Its `.invalid` locators, placeholder byte identities, pending license review and blocked release states are deliberate; it makes no claim that a distributable runtime, model, node or helper has been approved. It exercises managed runtime, frontend, local-node, external model and signed native-helper roles.

The four valid mutation cases prove that display-only extensions are forward-safe, revoked records remain readable only while blocked, one party may explicitly occupy creator/publisher/packager roles without ambiguity, and a synthetic human-approved license decision is content-bound to every referenced artifact and provenance chain. The synthetic decision is contract evidence only, not legal approval for a real artifact.

## Exact rejection matrix

| Rule family | Cases | Fail-closed property |
| --- | --- | --- |
| Artifact identity | 01, 02, 11, 12 | Length/hash are present and agree across artifact and source metadata. |
| Immutable source/build | 03, 33, 45, 47, 48 | Component sources and provenance steps reject mutable refs and URL state. Producer identity additionally requires exact SemVer, a closed revision-anchored source-locator shape and a build ID equal to the JCS build-record projection hash. |
| Role and executable trust | 04, 27, 32 | Role/content/archive/destination/architecture must match; private executables require signature metadata bound to the exact artifact. |
| Parties and provenance | 05, 19, 26, 34–36, 44, 46 | Creator, publisher and packager, content-addressed producer build identity and strict evidence/status are explicit; relationships, the sole byte-changing transform and every chain input/output are exact. |
| License authority | 06, 20, 31 | A human review state, content-bound active license reference and exact reviewed artifact/provenance scope are mandatory. |
| Windows path/archive safety | 07, 08, 09, 10, 21, 29 | Absolute, traversal, ADS, device, reparse/link and unbound expanded-tree intent fail closed. |
| Catalog/app authority | 17, 18, 28 | Remote/override catalogs, wrong app binding and catalog self-attestation are rejected. |
| Ownership and destination | 16, 37, 38, 43 | Managed targets require all five proofs; immutable manifests contain no runtime external-candidate observation, and later-matched external artifacts remain read-only even after an exact hash match. |
| Graph/state safety | 13, 14, 24, 39, 40 | Component IDs are unique, dependencies are exact and acyclic, non-active manifests/components stay blocked, and eligible dependency closure is actionable. |
| Pipeline/closed contract | 15, 41, 42 | Integrity precedes schema/domain, hostile shapes normalize deterministically, and unknown execution-affecting fields cannot acquire meaning. |

Each negative case declares exactly one expected `{code, instance_path, rule_id}`. The harness normally refreshes only root integrity after applying a mutation so the expected semantic rule is reached. Case 41 deliberately preserves stale integrity to prove integrity failure precedes an otherwise valid unknown-field rejection.

The schema and validator are contract evidence, not an installer. Acceptance of a manifest never authorizes retrieval, materialization, ownership, deletion, execution or license approval.
