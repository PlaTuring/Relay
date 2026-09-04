# Master Agent Orchestration

> Master/scheduler: `/root`
> Concurrency: one Root + at most three end-to-end code workers (A installation/detection, B workflow, C Electron/Windows)
> Active task state: `tasks/registry.json`
> Full 152-task catalog and dependency source: `tasks/TASK_BREAKDOWN.md`

## 1. Operating model

The root Agent is the integration manager. The active production wave uses three persistent code streams with disjoint ownership: A `packages/local-runtime/**`, B `packages/workflow/h3-compiler/**`, and C `apps/control-plane/**`. Root owns only cross-stream interfaces, root scripts, minimal smoke tests, real attach-only validation, and integration fixes.

Root responsibilities:

- maintain task states, dependencies, contracts, resource leases, risks, decisions, and release gates;
- dispatch only tasks whose dependencies are accepted and whose allowed paths do not overlap;
- give every worker a context packet containing scope, inputs, outputs, allowed paths, forbidden actions, acceptance commands, evidence level, and resource locks;
- review every result against the packet and the product boundary;
- integrate or reject the result, then unlock downstream tasks;
- keep GPU/model-download/Desktop/VM work serialized even when worker slots are available.

Root should not write a business module at the same time a worker owns that module. Root may edit governance, plans, registries, shared contracts when holding the `SCHEMA` lock, and small integration patches after a worker returns ownership.

## 2. State machine

Each task has one state:

```text
backlog
  -> ready
  -> assigned
  -> in_progress
  -> review
  -> accepted
             \
              -> unlock dependents

in_progress/review -> changes_requested -> assigned
in_progress/review -> blocked_external
in_progress/review -> rejected_scope
```

Only root changes a task to `accepted`. A written report without its required evidence remains `review` or `blocked_external`.

## 3. Scheduling algorithm

At the start and end of every wave, root:

1. loads the registry and marks tasks `ready` only when every dependency is `accepted`;
2. filters out tasks whose required capability gate is closed;
3. reserves any file-path and machine-resource locks;
4. ranks ready tasks by critical-path unlock count, risk reduction, and wall-clock latency;
5. assigns up to three non-overlapping tasks;
6. continues root integration work while workers run;
7. reviews the first completed result immediately rather than waiting for the entire wave;
8. dispatches the next ready task into the freed slot when doing so cannot invalidate the still-running workers;
9. runs an integration/contract check at each gate boundary.

Priority order:

1. eliminate a product or architecture fork;
2. freeze a shared fact/contract needed by multiple modules;
3. start long-latency but safe work after its resource lease exists;
4. build the shortest end-to-end slice;
5. add breadth only after the slice is repeatable.

## 4. Queues and locks

### Parallel CPU/document queue

ADRs, fixtures, schemas, pure functions, static graph lint, UI prototypes, and unit tests may run in parallel when paths do not overlap.

### Serialized queues

| Queue/lock | Serialized work |
|---|---|
| `MODEL-DOWNLOAD` / `artifact:<digest>` | large model download, materialization, full hash |
| `GPU-H3` / `gpu:<luid>` | model load, H3 smoke, accelerator benchmark, long-video test |
| `COMFY-DESKTOP` | Desktop install, private-state inspection, launch/open/UI automation |
| `WIN-VM` | clean-install, upgrade, rollback, uninstall, Procmon/network capture |
| `SCHEMA` | shared files under `schemas/` and cross-contract invariants |
| `ROOT-LOCKFILE` | package manager/build lockfiles |
| `runtime:<generation>` | exclusive materialization/update vs shared test reads |
| `project-run:<id>` | long Runner execution and checkpoint mutation |

No worker may begin real H3/model work until the resource-coordination task has at least a reviewed manual-lock protocol. A free worker slot does not imply a free GPU, volume, or Desktop.

## 5. Context packet template

Root sends the following for every task:

```yaml
task_id:
objective:
product_boundary_confirmation:
dependencies_and_input_revisions:
allowed_paths:
forbidden_paths:
required_locks:
forbidden_actions:
deliverables:
acceptance_commands:
required_evidence:
failure_fallback:
estimated_agent_hours:
```

The packet is stored under `tasks/context/<task-id>.md` for code-bearing tasks. A worker cannot expand its own scope because it discovers a useful adjacent improvement; it records the improvement for root to schedule.

## 6. Review checklist

Root accepts a task only when:

- it confirms the tool/H3/Comfy boundary and does not auto-submit a user's first formal queue job;
- every edit lies under `allowed_paths` and no user-owned file was overwritten;
- the stated dependencies and pinned upstream revisions match the registry;
- tests exercise success and assigned failure cases;
- a capability marked `proven` has repeatable evidence, not inference;
- API/Partner/unknown nodes fail closed where relevant;
- external models and existing Comfy instances remain read-only unless an approved task explicitly says otherwise;
- schema, lockfile, security, license, and resource impacts are declared;
- documentation does not turn an internal target into a public claim;
- outputs contain no secrets, full private prompts, or unintended large binaries.

## 7. Gates

| Gate | Unlocks | Minimum evidence |
|---|---|---|
| G0 Scope | all Phase 0 tasks | boundary ADR, Alpha capability matrix, non-goals |
| G1 Runtime | managed runtime implementation | managed Core final-path spike and selected-route ADR; Desktop/CLI remain separately gated optional adapters |
| G2 Stack | production UI/control-plane code | bounded stack spikes and packaging/security decision |
| G3 Contracts | parallel module implementation | versioned schemas, fixtures, owners, invariants |
| G4 Provenance | model download/reuse | exact Alpha artifact chain, hashes, licenses, legal owner queue |
| G5 Managed Probe | dynamic object/schema validation | immutable generation, loopback, allowlist, owned process tree |
| G6 Workflow | internal workflow compiler | canonical visual source, official projection evidence, graph safety lint |
| G7 Vertical Slice | breadth work | 5-second T2VA, user Run, H3 native audio, offline repeat |
| G8 Alpha-1 | controlled external test | T/I/L/FL route evidence, recovery, installer UX, signature, legal gates |
| G9 Ref2VA | Ref UI/package | reference tags/limits/route/model provenance tests |
| G10 Runner | 30-second work | GraphBuilder, continuation ADR, checkpoint/timebase/recovery PoCs |
| G11 Release | public 1.0 | update trust, SBOM, signatures, full safety/privacy/claims matrix |

External legal, certificate, hardware-access, and brand-asset decisions are tracked separately; an Agent cannot self-approve them.
The same unique G0–G11 IDs and names are materialized in `tasks/registry.json`; external WBS prerequisites use registered `EXT-*` IDs rather than free text. `P0-GOV-010` is the next independent review of this mapping and may propose changes, but only Root may integrate gate state.

## 8. Current execution wave

### Wave 0 — audits (accepted)

- Installer/runtime independent audit.
- H3/workflow independent audit.
- Product/delivery independent audit.
- Red-team assumptions audit.
- Installer-on-workflow, workflow-on-product, and product-on-installer cross-audits.

### Wave 1 — Phase 0 scope and evidence (accepted)

| Task | Worker | Paths | Locks | Purpose |
|---|---|---|---|---|
| `P0-WF-001` | `/root/workflow_plan_review` | `docs/evidence/UPSTREAM_CAPABILITY_SNAPSHOT.md`, `prototypes/phase0/capability-snapshot*` | none | official H3/Comfy classes, schemas, templates, artifacts, and proof status pinned |
| `P0-ARC-001` | `/root/installer_plan_review` | `docs/architecture/RUNTIME_TOPOLOGY_OPTIONS.md`, `prototypes/phase0/runtime-probe/**` | none; read-only machine probe | managed Core/Desktop/restricted CLI facts and a non-executing detector accepted |
| `P0-GOV-003/004` | `/root/product_risk_review` | capability matrix, external gates, ADR-001 | none | version visibility, Human gates, no-first-queue boundary accepted |
| Root integration | `/root` | root-owned plans, WBS, registry, decisions, risks | none | seven audits integrated; the WBS was later expanded to 152 acyclic tasks after final delivery-chain red-team review |

### Wave 2 — bounded architecture evidence (partially accepted)

| Task | Worker | Paths | Locks | Purpose |
|---|---|---|---|---|
| `P0-ARC-002` | `/root/product_risk_review` | `prototypes/phase0/stack-electron/**`, `docs/evidence/STACK_ELECTRON.md` | none; isolated subproject lockfile | accepted: 17 tests, two offline verifies, public-path lint; offline NSIS rebuild remains explicitly uncertified |
| `P0-ARC-006` | `/root/workflow_plan_review` | `prototypes/phase0/managed-core-layout/**`, `docs/evidence/MANAGED_CORE_LAYOUT.md` | none | accepted: 17/17 final-path, Unicode/space, pointer/fault/privacy checks |
| `P0-ARC-012` | `/root/installer_plan_review` | `prototypes/phase0/resource-leases/**`, `docs/adr/ADR-009-resource-leases.md` | none; fake workers only | accepted after root-requested public-owner redaction test; 9/9 |
| Root review | `/root` | registry, plan, orchestration and accepted evidence | none | tests rerun; missing public-output assertions/path hygiene were corrected before acceptance |

### Wave 3 — runtime/policy closure (accepted)

| Task | Worker | Paths | Locks | Purpose |
|---|---|---|---|---|
| `P0-ARC-002` | `/root/product_risk_review` | isolated Electron spike and evidence | none | accepted after evidence hygiene fixes and Root rerun; candidate only, not stack selection |
| `P0-ARC-009` | `/root/workflow_plan_review` | `docs/adr/ADR-002-runtime-topology.md` | none | accepted: managed Core main path; three lifecycles separated; pre-first-instruction Job containment required |
| `P0-GOV-007` | `/root/installer_plan_review` | no-self-update ADR/linter fixtures | ADR-015 Stable download plus ADR-016 verified interactive Setup launch; ADR-014 retained as history | accepted after two Root reruns at 16/16; no background/self-directed updater or remote catalog/runtime installer surface. Current Relay may only perform user-initiated fixed-repository Stable Release discovery, verified Setup download, and—after the same explicit “下载并安装” action—one empty-argument interactive launch of that exact managed file. |

### Wave 4 — stack, process ownership and contract foundation (accepted)

| Task group | Result |
|---|---|
| `P0-ARC-003/004/005` | Tauri and .NET stayed evidence-gated alternatives; Electron/TypeScript plus one narrow signed Win32 helper became the Alpha control plane. |
| `P0-ARC-010` | 14/14 fake-process checks established pre-first-instruction Job containment, owned loopback identity and the two-level offline/network claim. |
| `P0-ARC-011` | 19/19 deterministic crash checks established generation/pointer recovery after process kill; true power-loss durability remains a later VM gate. |
| `P0-CON-001/002` | Shared contract conventions and exact local-node/capability fingerprints were accepted with fail-closed fixtures. |
| `P0-CON-003` | Accepted after three independent red-team rounds. The final corpus passes 44 negative and four valid mutation cases and grants no download, install, execution, ownership or deletion authority. |
| `QA-001` | The zero-dependency fast runner passes its four allowlisted groups and 12 hostile-runner checks. |

Wave 4 is closed and all machine resource locks are released. The next parallel dispatch set is:

- `P0-GOV-010` — Gate/critical-path mapping review on the CPU/document lane;
- `P0-CON-004` — the minimal Alpha recipe schema in the serialized `SCHEMA` lane;
- `P1-APP-001` — the production Electron workspace and locked build graph under `ROOT-LOCKFILE`.

All three entries are materialized as `ready` with exact context packets and non-overlapping paths. `P1-NAT-001` follows the first freed CPU slot; static workflow lint and the data-only embedded-catalog loader remain in the catalog but are not allowed to bypass the contract/gate review. Subsequent component downloads, model materialization and GPU runs remain disabled until the recipe, legal/provenance, volume, ownership and resource gates are independently accepted. Current Desktop `OPEN_AND_FOCUS` also remains optional and externally blocked until a real fixture is explicitly provisioned.

## 9. Efficiency rules

- Before dispatching or accepting a task-registry change, run `powershell -NoProfile -ExecutionPolicy Bypass -File tasks/validate_wbs.ps1`; task count, IDs, dependencies, cycles, gates, locks, active statuses, and current-wave membership must pass.
- Aim for 2–6 Agent-hour atomic tasks. Split work above 8 hours into contract, implementation, failure injection, and matrix-report tasks.
- Keep external/download/GPU/VM wall time out of Agent-hour estimates.
- Do not split tightly coupled edits across workers merely to increase task count. A task split is useful only when outputs have a stable interface and can be reviewed independently.
- Prefer one vertical implementation path over three compatibility paths. Desktop/Portable breadth is not allowed to block managed Core Alpha.
- Prefer fixtures and mock workers before scarce-resource tests.
- Never download the same large artifact twice. Never run two certification jobs on the same GPU.
- UI workers consume contracts and fixtures; they do not invent service fields.
- QA workers test from outside the implementation and do not edit the same module under review.

## 10. Source-of-truth order

When documents disagree, use this order:

1. `AGENTS.md` — operational and product boundary;
2. accepted ADRs and `docs/DECISION_LOG.md`;
3. `docs/OPTIMIZED_ARCHITECTURE.md`;
4. `tasks/registry.json` and the assigned context packet;
5. `MINIMAX_H3_TOOL_EXECUTION_PLAN.md`;
6. audit reports, which preserve evidence and dissent but are not implementation orders.
