# P0-CON-004 minimal Alpha recipe contract evidence

## Result and boundary

P0-CON-004 provides one Draft 2020-12 immutable-authority recipe contract, one synthetic non-runnable Alpha-0 profile, an offline validator and deterministic mutation corpus.

The contract only supports deterministic installation/configuration/workflow-compilation inputs. It does not download or materialize artifacts, start ComfyUI, use a GPU, submit `/prompt`, generate media, grant ownership/delete authority, call cloud/Partner inference, or introduce private FFmpeg. MiniMax H3 remains the only video/native-audio generator and runs only inside ComfyUI after the user clicks Run.

## Exact identities

- Recipe schema ID: `urn:minimax-h3-tool:schema:alpha-recipe:1.0.0`
- Recipe contract ID: `minimax-h3-tool.alpha-recipe`
- Recipe schema JCS digest: `sha256:f790df52fa505653ba1e194508acde1ca8641d4878820d227c3c541fd7c5ef79`
- Valid recipe logical content digest: `sha256:1d7afdb7e18132b06f334f5a2463f3707d9b4cdf96a2dfb211f2392afe40194a`
- Capability schema JCS digest: `sha256:e3ec4c0c1cefbec0ac4f0bf7d1853c125b02521f617dd581506ee77b8441d12d`
- Node allowlist schema JCS digest: `sha256:831cdae6677c2d735844245fade720f13e9b8717c41bda25f0626319d88a7b48`
- Component manifest schema JCS digest: `sha256:62704fae90e6f9d1895a3d1351b8664f67222aedb8db390ab46e674394236608`
- Repeated validator stdout digest: `sha256:8122c154fb43510d8ca3802bcbfa2cf7dec9e27f2840b9b8d4c4db0943984973`

The recipe binds the accepted synthetic authority snapshots by exact schema ID/digest, document ID/revision and root JCS content hash. It also binds the app tuple, managed Core origin/revision, four exact local node identities and fingerprints, resolved blocked component identities, required model roles, hardware requirement and exact output gates. Every component/model slot has a dedicated exact schema `const` and a matching semantic expected-slot record; upstream validity of a transplanted record cannot satisfy the wrong slot.

## Deliberate non-runnable state

The only profile is `alpha0-t2va-5s-nonempty` with `publication_status: poc_pending`, `runnable: false` and `selectable: false`.

The accepted synthetic component manifest has no resolvable `comfy_backend`, FL2VA diffusion, text encoder, video VAE or audio VAE component. The recipe therefore records those exact roles as unresolved blocked prerequisites rather than inventing component identities. Resolved runtime/frontend/local-node/base-model fixture components retain `release_state: blocked` and `license_state: pending_external`. Node runtime acceptance, hardware certification and output capability remain `poc_pending`.

The output pin is T2VA, 5 seconds, 24/1 FPS, non-empty prompt required, no endpoint role, H3 native 32 kHz stereo audio, and the Core `CreateVideo`/`SaveVideo` PyAV writer path. `external_ffmpeg_requirement` is exactly `not_declared`; no external FFmpeg prerequisite is inferred.

## Fail-closed coverage

Fifty-three negative mutation fixtures assert exact `(code, instance_path, rule_id)` tuples for:

- schema ID/digest and referenced document drift;
- app/build, Core revision, runtime, frontend, node fingerprint/origin, model, hardware and output identity drift;
- mutable revision, unknown node, Partner/API node and enabled API policy;
- `poc_pending` profile/capability/node/hardware/output promotion and blocked component/license promotion;
- missing backend and FL2VA prerequisites;
- resolved component cross-slot substitution and role drift;
- base-model replacement with a different valid upstream component;
- exact requirement ID, component role and reason-code drift for every unresolved backend/model slot;
- unresolved model cross-slot swapping while all swapped records remain blocked;
- unknown execution field, cloud fallback, automatic `/prompt`/queue handoff, ungrounded private/external FFmpeg and action-authority escalation.

One positive mutation proves bounded reverse-DNS `display_metadata` extension preservation without operational effect. The core schema remains closed.

## Offline acceptance evidence

Commands executed from the repository root:

```text
node --check .\tests\fixtures\contracts\recipe\validate.mjs
node .\tests\fixtures\contracts\recipe\validate.mjs
npm test
```

The recipe validator was executed in repeated pairs. Final observed summary:

```text
PASS schema alpha-recipe sha256:f790df52fa505653ba1e194508acde1ca8641d4878820d227c3c541fd7c5ef79
PASS valid alpha0-poc-pending-recipe status=poc_pending runnable=false
PASS redaction public_files=60 private_paths=0 support_projection=pass
SUMMARY schemas=1 valid_contracts=1 negative_cases=53 valid_mutation_cases=1
```

The root fast lane remained green: `passed=5 failed=0 blocked=0 skipped=0`.

The validator uses Node built-ins only. It strict-parses UTF-8/no-BOM integer-only JSON with duplicate-key and global-limit rejection, checks JCS root integrity, lints schema IDs/refs/trust annotations/rule IDs, evaluates the schema subset used here, resolves accepted upstream files offline, enforces cross-document/status invariants, and scans public task artifacts plus a default-deny support projection for private Windows user paths/current username/sensitive categories.

## Evidence classification

Proven by this task:

- the recipe schema and valid fixture parse and have the exact digests above;
- the synthetic profile reconstructs all currently known bindings and explicit unresolved blockers;
- recipe data cannot promote upstream pending/blocked capability, node, component, license, hardware or output state;
- the named negative corpus fails with deterministic exact tuples;
- repeated validator output is byte-identical and the public/support projection scan is clean.

Derived contract evidence, not a runtime claim:

- the compact evaluator covers the Draft 2020-12 keywords used by this schema; production/cross-language equivalence remains a later contract gate;
- the accepted upstream fixtures are synthetic authority evidence, not approved distributable artifacts.

Still blocked or `poc_pending`:

- real backend/frontend/runtime/model artifacts, wheelhouse and license approvals;
- exact hardware-report match and GPU/runtime certification;
- live object-info fingerprint match and 5-second native-audio output PoC;
- any FFmpeg capability, workflow build/handoff and user-initiated formal Run.

## Contract and dependency impact

Only `schemas/alpha-recipe/**`, `tests/fixtures/contracts/recipe/**` and this evidence file were created. No other schema, task registry, WBS, plan, installer, downloader, workflow implementation or lockfile changed. The contract has an explicit immutable/no-migration policy and grants no action authority.

After Root review and acceptance, this evidence can unlock P1-DET-010, P1-DET-011 and later single-profile wheelhouse/runtime recipe work. It does not unlock GPU, ComfyUI, model download or media generation.
