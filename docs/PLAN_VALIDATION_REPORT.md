# Execution Plan Deep-Validation Report

> Date: 2026-08-27  
> Integration owner: `/root`  
> Verdict: conditionally feasible; Phase 0 evidence and a narrow Alpha-0 vertical slice must precede breadth or public claims.

## 1. Validation coverage

The plan was reviewed through three independent audits, one adversarial assumption audit, and three domain-cross reviews:

- installer/runtime architecture;
- H3/Comfy workflow and long-video runtime;
- novice product, compliance, distribution and delivery;
- red-team review of hidden assumptions;
- installer-on-workflow, workflow-on-product and product-on-installer cross-checks.

Their evidence is preserved under `docs/reviews/`. Binding resolutions are in `docs/OPTIMIZED_ARCHITECTURE.md`, `docs/DECISION_LOG.md`, accepted ADRs and the main execution plan.

## 2. Feasibility result

The intended product is feasible as a local installer/configurator and ComfyUI workflow compiler. It is not feasible to truthfully promise every GPU, every existing Comfy installation, automatic official-Desktop workflow focus, first-frame-only empty text, exact endpoint-safe 4 seconds, stable one-minute continuity, or arbitrary community acceleration before separate PoCs.

The first useful result is deliberately narrow:

```text
one Windows/NVIDIA candidate
-> one user-visible local fixed NTFS managed root
-> one immutable managed ComfyUI Core/frontend generation
-> one verified FL2VA base recipe
-> one 5-second non-empty-prompt T2VA visual workflow
-> tool opens owned ComfyUI
-> user clicks Run
-> MiniMax H3 generates native video and audio
-> offline second run
```

The tool performs no video/audio inference and does not submit the user's first formal queue job.

## 3. High-value corrections applied

1. **Managed Core is the Alpha-0 main path.** Existing Desktop/Core/Portable instances are attach-only by default. Official Desktop is a separate `OPEN_AND_FOCUS` capability and cannot block the controlled main path.
2. **No Alpha self-updater.** The application embeds an immutable component catalog. TUF/equivalent trust is required only before a real remote update channel exists.
3. **One workflow truth source.** A canonical visual workflow is built from typed plans and locked bindings. The API graph is a locked official projection used for audit/testing, never a second editable source or an automatic execution path.
4. **Local-node graph safety fails closed.** Exact `class_type` and schema fingerprints distinguish local H3 from same-brand Partner/API nodes; visual, derived, subgraph and expanded graphs are checked.
5. **External FFmpeg is capability-driven.** Core/PyAV may satisfy certified short output. Private FFmpeg/FFprobe is installed only for finalization that actually needs it, while bundled libraries still enter SBOM/license/codec testing.
6. **Endpoint plans are route-specific.** Universal tail trim would remove an FL2VA/L2VA last-frame anchor. T2VA, I2VA, L2VA and FL2VA use one rational 24/40/32000 timebase but different preservation strategies.
7. **Prompt semantics remain user-owned.** The program does not classify story/product/talking-head/MV, expand prompts, append continuation language or invent a creative role for references.
8. **Model discovery is tiered.** Static paths/size/bounded Safetensors headers identify candidates; full SHA-256 runs only after the user selects a reuse candidate and is cached against file identity.
9. **Runtime environments are built at final paths.** Populated Python environments never move out of staging; only a small validated active pointer changes.
10. **Hardware detection avoids WMI-only VRAM.** NVML/`nvidia-smi` or an equivalent supported API is primary; a source conflict fails closed instead of selecting a nearby recipe.
11. **Long video is a later Runner capability.** The first PoC uses official decoded `MiniMaxH3AddGuide`; paired A/V latent persistence remains experimental. Node expansion occurs after user Run and never re-enters `/prompt`.
12. **Community popularity is discovery, not certification.** Every Turbo/attention/cache/offload candidate locks its full stack and separately validates video, native audio, success rate, resources and fallback.
13. **A spike is not a shippable application.** Ten explicit tasks now cover the production Electron workspace, typed main/preload boundary, isolated renderer, narrow Win32 ABI/process/path primitives, bridge fuzzing, service composition, package assembly and VM install/upgrade/uninstall evidence. Clean-install QA depends on the resulting package.
14. **The scheduler fails closed.** The WBS validator now checks the unique `/root` master, ten-worker ceiling, accepted dependencies and gates, unique gate IDs/names, lock holders, path conflicts, wave/next-ready closure and registered machine-readable external prerequisites; 16 mutation fixtures prove prior false-green states are rejected, including an accepted ten-worker wave and a rejected eleven-worker wave.

## 4. Critical-path optimizations

Three false serialization points were removed during root review:

| Removed blocker | Previous effect | Corrected dependency |
|---|---|---|
| Desktop `OPEN_AND_FOCUS` fixture | A missing optional Desktop install blocked the runtime ADR and all contracts | G1 requires managed Core final-path evidence and the managed-runtime ADR; Desktop/CLI adapters stay separately gated |
| Long-video run/checkpoint schema | A later 30/60-second contract blocked the 5-second Alpha slice | Alpha cross-contract gate covers capability through workflow-build contracts; run/segment/checkpoint closes before Runner work |
| Shared stack-spike lockfile | Electron, Tauri and .NET evidence was serialized despite separate directories | Isolated prototypes own isolated lockfiles and may run in parallel; only root build integration uses `ROOT-LOCKFILE` |

The optimized catalog contains 152 bounded tasks. A final integration red-team added ten previously missing production Electron/native-helper/package tasks and split the former 10-hour release rehearsal into three independently reviewable tasks. The catalog supports up to ten path-isolated workers, while schemas, lockfile/build integration, model download, GPU, Desktop and VM resources stay single-holder serialized where parallelism would create corruption or false evidence.

## 5. Machine-check results

Run from the repository root:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tasks\validate_wbs.ps1
node .\prototypes\phase0\capability-snapshot\validate-snapshot.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\prototypes\phase0\runtime-probe\tests\Run-Tests.ps1
```

Current accepted results:

```text
WBS_VALIDATION_OK tasks=152 unique=152 missing=0 cycles=0 registry_drift=0 active=26 wave=0 external=2 roots=P0-GOV-001
root fast lane: 5/5 groups passed; hostile runner contract: 12/12 passed
WBS scheduler mutation suite: 16/16 passed locally; ten concurrent workers are accepted and eleven fail closed
component manifest: 44 negative + 4 valid mutation cases passed; final independent red-team: 0 P0/P1
capability/local-node contracts: 17 negative + 2 valid mutation cases passed
JSON_PARSE_OK task=P0-WF-001 nodes=7 forbidden=9 capabilities=11 templates=7 models=3 gates=17 fingerprints=OK statuses=OK gate_refs=OK
runtime probe: 5/5 PASS
Electron bounded spike: 6 test files / 17 tests PASS; hidden Electron self-test and public-evidence lint PASS
resource leases: 9/9 PASS; managed final-path layout: 17/17 PASS; no-self-update policy: 16/16 PASS
managed process ownership: 14/14 PASS; generation/pointer crash recovery: 19/19 PASS
Tauri static evidence: 31 PASS / 11 explicitly BLOCKED; .NET static evidence: 34 PASS / 14 explicitly BLOCKED
```

Worker completion is not acceptance. `/root` rereads outputs, reruns commands, checks allowed paths and requests changes when an invariant or privacy rule lacks proof.

## 6. Current execution structure

- Permanent master/reviewer/scheduler: `/root`.
- Concurrent executors: at most ten task-scoped workers; resource locks remain single-holder.
- Full dependency source: `tasks/TASK_BREAKDOWN.md`.
- Active status/owner/locks: `tasks/registry.json`.
- Persistent worker instructions: `tasks/context/<task-id>.md`.
- Operational contract: `AGENTS.md`.

The fourth Phase 0 wave is accepted. It closed the control-plane stack choice, managed process/network ownership, active-generation crash recovery, contract conventions, capability/local-node contracts, component provenance/ownership contracts and the zero-dependency fast test runner. The component-manifest contract required three independent red-team rounds before acceptance; the final review found no remaining P0/P1 issue.

The next three-way dispatch is intentionally non-overlapping and fully materialized in the registry and context packets:

1. `P0-GOV-010` audits the unique Gate/critical-path catalog without mutating live state.
2. `P0-CON-004` owns the serialized `SCHEMA` lane and defines exactly one non-runnable, evidence-preserving minimal Alpha recipe.
3. `P1-APP-001` owns `ROOT-LOCKFILE` and creates the production Electron workspace/build graph without runtime or generation authority.

No model download, GPU inference, formal `/prompt`, first-job submission or video/audio generation is part of that dispatch. Those remain behind later provenance, ownership, hardware, workflow-handoff and explicit user-Run gates.

## 7. Open gates that Agents cannot invent away

- Intended distribution regions and MiniMax H3 commercial/downstream terms.
- Concrete GPL/AGPL/commercial distribution topology for Core, frontend, any self-owned node, Desktop and optional CLI.
- PyAV/FFmpeg build, codec/patent and redistribution decision for the actual artifact.
- Authenticode certificate identity, timestamping and release owner.
- Real hardware/model/runtime certification; the current RTX 5080 host remains only a candidate.
- Current official Desktop fixture if `OPEN_AND_FOCUS` is later required.
- Owner-provided watermark asset and policy; it remains independent from H3 attribution and AI disclosure.

These gates may block controlled external or public release. They do not justify weakening the internal managed-Core slice, pretending evidence exists, or adding a third-party inference API.

## 8. Root acceptance rule

A task unlocks dependents only after `/root` verifies its allowed paths, deterministic tests, failure cases, evidence classification, external-state impact and product boundary. A prose report, successful happy path or worker `completed` status alone is insufficient.

## 9. Final integration red-team closure

After Wave 4 integration, three independent read-only regressions rechecked product boundaries, workflow/contracts and scheduler/delivery completeness. They originally found the production Electron/package chain, mandatory Win32 helper implementation chain and scheduler fail-closed checks missing, plus Gate/next-ready, recipe-status, external-prerequisite and task-size inconsistencies.

Root integrated the fixes as 152 bounded tasks, 12 unique G0–G11 gates, two registered `EXT-*` Human gates, three materialized next-ready packets, a five-group fast lane and a 15-case scheduler mutation suite. Each original reviewer then reran its focused audit and reported every prior P0/P1/P2 resolved with no new P0/P1. This closes plan/infrastructure validation only; it does not certify a production installer, real H3 recipe, model artifact, GPU, Comfy Desktop, signature or public release.
