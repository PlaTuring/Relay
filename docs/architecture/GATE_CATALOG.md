# G0–G11 Gate Catalog

- Status: proposed for Root acceptance by `P0-GOV-010`
- Machine-readable source: `tests/fixtures/governance/gates/catalog.valid.json`
- Validator: `tests/fixtures/governance/gates/validate-gates.mjs`
- Scope: governance and deterministic scheduling only

The tool installs, detects, verifies, configures, compiles, and hands off. MiniMax H3 generates the actual video and native audio inside ComfyUI only after the user clicks **Run**. This catalog grants no download, installation, ComfyUI launch, `/prompt`, GPU, model, or media-generation authority.

## 1. Normative semantics

There are exactly twelve technical/release gates: `G0` through `G11`. IDs and names are case-sensitive and unique. A gate is accepted only by Root after every `requires_task`, predecessor gate, and hard external prerequisite has accepted evidence. Prose, a task report, an inferred capability, or a conditional external decision cannot accept a gate.

Three relations are deliberately separate:

1. `task_assignments` maps every one of the 152 WBS tasks to the milestone it primarily contributes to. This classification is exhaustive and unique, but creates no new dependency.
2. `protects_tasks` is the small fail-closed scheduling frontier. A protected task cannot be `ready`, `assigned`, `in_progress`, `review`, or `changes_requested` while the gate is closed.
3. WBS `Depends on` remains the exact task dependency graph. A gate does not serialize fixture-only or implementation work merely because that work contributes to a later milestone.

This split prevents two opposite failures: a closed production boundary cannot be bypassed, while legal, GPU, Desktop, model, or release evidence does not prematurely block safe Managed-Core implementation and no-model contract work.

## 2. Unique catalog

| Gate | Unique name | Requires tasks | Hard external requirement | Scheduling frontier | Failure fallback |
|---|---|---|---|---|---|
| `G0` | `scope` | `P0-GOV-003`, `P0-GOV-004` | none | stack comparison spikes | stop implementation at evidence gathering |
| `G1` | `runtime_topology` | `P0-ARC-001`, `006`, `009` | none | contract foundation and managed materialization/launch | Managed Core stays evidence-only; no Desktop/CLI bypass |
| `G2` | `control_plane_stack` | `P0-ARC-002..005` | none | first production app/native/detection/test-runner entry points | no second production stack |
| `G3` | `contracts` | `P0-CON-001..010` plus `P0-CON-012`; deliberately excludes `P0-CON-011` | none | cross-contract IPC consumer `P1-APP-002` | exact-schema consumers may proceed only on their own WBS dependencies |
| `G4` | `provenance` | governance checklist, component/catalog/license gate service, bounded classifier/hash/selection | `EXT-H3-LICENSE` | first real H3/GPU output task `P1-WF-013` | fixtures and no-model tests only |
| `G5` | `managed_probe` | `P2-INS-010..014` | none | exact workflow handoff/live output | exact generation disabled; static evidence only |
| `G6` | `workflow` | `P1-WF-002..012` | none | first real output task | no uncertified handoff or execution |
| `G7` | `vertical_slice` | installer/app/package/5-second/QA vertical evidence | H3 internal-use decision and actual hardware profile | certification breadth, Ref, accelerator, Runner starts | keep breadth hidden; repair shortest path |
| `G8` | `alpha_1` | breadth matrix, UAT, SBOM, signing, Alpha-1 audit | H3/Core/frontend/signing/hardware; FFmpeg/CLI conditional | external Alpha claim, not ordinary implementation tasks | remain internal Alpha-0 |
| `G9` | `ref2va` | `REF-001..007` | H3 license and hardware | `REL-004` | Ref2VA hidden |
| `G10` | `runner` | `P0-CON-011` plus `LONG-001..011` | H3 license and hardware | `LONG-012` | Runner and long durations hidden |
| `G11` | `release` | release, Ref, Runner, accelerator, signing and claim evidence | exact 1.0 external set | `REL-006` Human publish/rollback decision | do not publish |

The complete, non-abbreviated arrays, conditional external clauses, fallback strings, 152-task assignment, and two critical-path claims live only in the machine-readable source named above. This document does not duplicate those arrays as a second authority.

`P0-CON-011` is assigned to `G10`, not `G3`. This is a binding critical-path optimization from `docs/PLAN_VALIDATION_REPORT.md` §4: Alpha's cross-contract gate closes capability through workflow-build contracts, while run/segment/checkpoint contracts close before Runner work. The validator rejects any future attempt to add `P0-CON-011` to `G3`.

## 3. External authorities versus registry materialization

`docs/EXTERNAL_GATES.md` is the accepted authoritative catalog of ten Human/external gates:

`EXT-H3-LICENSE`, `EXT-COMFY-CORE`, `EXT-COMFY-FRONTEND`, `EXT-RUNNER-DIST`, `EXT-FFMPEG`, `EXT-COMFY-CLI`, `EXT-DESKTOP-DIST`, `EXT-SIGNING`, `EXT-HARDWARE`, and `EXT-BRAND-ASSET`.

The live registry currently materializes only `EXT-BRAND-ASSET` and the WBS-specific `EXT-REMOTE-UPDATE-DECISION`. The latter is a registered 1.0 release prerequisite, not an eleventh row retroactively added to the accepted external-gate document. The machine catalog preserves this distinction with `authority_class`:

- `accepted_external_catalog`: the ten authoritative gates;
- `registry_release_prerequisite`: `EXT-REMOTE-UPDATE-DECISION` already required by `REL-004` and materialized in the live registry.

The registry follows lazy materialization: Root adds an external gate before a task with that hard prerequisite can become `ready` or active. Absence from the active registry is therefore not itself a bypass. A bypass exists only when a task is schedulable while a hard prerequisite is unknown or not accepted. Conditional gates are materialized only if Root records that the condition is selected, such as bundling FFmpeg, comfy-cli, or Desktop.

## 4. Task-level external prerequisites

The machine catalog is exact and default-deny:

- a task absent from `task_external_prerequisites` has no **direct** external prerequisite;
- hard `required` IDs block readiness and activity until accepted;
- `conditional` IDs do not block until Root records the named product/packaging choice;
- transitive WBS dependencies and gate acceptance still apply.

This keeps the Managed-Core mainline unblocked correctly. Schema work, static discovery, the installer services, managed runtime materialization, non-H3 smoke, exact handoff implementation, and no-model QA can proceed from their exact WBS dependencies. The first actual local H3/GPU output (`P1-WF-013`) is hard-blocked by `EXT-H3-LICENSE` and `EXT-HARDWARE`; external distribution and 1.0 publication add the applicable Core/frontend/signing/Runner/FFmpeg/brand/update decisions.

## 5. Machine checks

The validator proves:

- exact `G0..G11`, unique IDs and names;
- all gate/task/external references exist;
- no gate dependency cycle or self-unlock;
- every WBS task is assigned exactly once;
- an accepted gate cannot cite an unaccepted task, predecessor gate, or hard external decision;
- a live ready/active task cannot sit behind a closed gate or hard external prerequisite;
- the two declared critical paths equal the deterministic longest paths computed from the WBS;
- ten hostile fixtures fail with their exact expected rule IDs, including a dedicated Alpha-contract false-serialization regression.

Root remains the only actor that can accept a gate, external decision, or registry state transition.
