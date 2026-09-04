# P0-GOV-010 Critical-Path and Gate Review

- Review state: **changes requested addressed; awaiting Root re-review**
- Evidence level: topology and deterministic validation are `proven`; future scheduling enforcement is `proposed`; legal, signing, hardware, model, Desktop, GPU, and release conclusions remain external/pending.
- Forbidden operations observed: none. No download, install, ComfyUI, `/prompt`, GPU, model, or media operation was performed.

## 1. Outcome

The review produced one machine-readable `G0–G11` catalog, an exhaustive unique mapping for all 152 WBS tasks, exact hard/conditional external prerequisites, two reproducible critical-path claims, and ten hostile fixtures. The validator uses only Node built-ins and reads the WBS and live registry without modifying them.

The current dispatched set (`P0-GOV-010`, `P0-CON-004`, `P1-APP-001`, all `in_progress` in wave 5) does not bypass a closed gate or an unaccepted hard external prerequisite under the proposed catalog. Managed-Core implementation remains available: no legal, hardware, GPU, Desktop, or model gate blocks safe contract, runtime, installer, handoff, or no-model fixture work. Actual H3/GPU execution remains blocked at `P1-WF-013` until `EXT-H3-LICENSE` and `EXT-HARDWARE` are accepted.

## 2. Findings

### Proven structural findings

1. The WBS contains 152 unique tasks, has no missing task dependency, and is acyclic under the existing validator.
2. The proposed catalog contains exactly 12 unique IDs/names and covers every WBS task exactly once.
3. The live `G3` set is correct: `P0-CON-001..010` plus `P0-CON-012`, deliberately excluding `P0-CON-011`. Binding `docs/PLAN_VALIDATION_REPORT.md` §4 removes the run/checkpoint contract from the 5-second Alpha cross-contract gate. `P0-CON-011` instead belongs to `G10` and must close before Runner work through the existing WBS edges.
4. The live `G3` unlock list over-serializes `P1-DET-001`, `P1-WF-003`, and `P2-INS-001`, whose WBS edges intentionally consume individual accepted contracts. Only the cross-contract IPC consumer is held at the full-contract frontier.
5. Live `G4` unlocks the implementation tasks `P2-INS-006` and `P2-INS-012`. That conflates safe downloader/bridge implementation with authority to download or reuse real H3 artifacts. The corrected gate protects the first real H3/GPU task instead.
6. Live `G7` protects `P1-WF-015`, although the WBS intentionally allows endpoint compiler fixture work after `P1-WF-009/010`. This is a false critical-path edge. The corrected frontier starts at the certification batch `P1-WF-018`; Ref, accelerator, and Runner roots are also protected there.
7. The accepted external-gate document contains ten authoritative Human gates, while the live registry lazily materializes two external scheduling records. This is not currently a bypass because none of the current ready tasks has a hard external prerequisite. It becomes a bypass if Root materializes a future hard-gated task as ready/active without first materializing and accepting its exact external IDs.

### External state that remains pending

- All ten authoritative external gates are still `OPEN` in `docs/EXTERNAL_GATES.md`; the catalog represents them as `blocked_external` for scheduling.
- `EXT-REMOTE-UPDATE-DECISION` is already a live registry prerequisite for `REL-004`; it is classified separately from the ten-row authoritative document.
- No Agent result in this task accepts legal, certificate, hardware, model, Desktop, GPU, or release evidence.

## 3. Critical paths

Policy: sum the first integer Agent-hour estimate in each WBS `Queue / h` cell; exclude external/GPU/VM/download/participant wall time; for equal totals select the ordinal task-ID path. The validator recomputes rather than trusting prose.

### Internal Alpha-0 acceptance — 133 Agent hours

```text
P0-GOV-001 -> P0-GOV-002 -> P0-ARC-001 -> P0-ARC-006 ->
P0-ARC-009 -> P0-CON-001 -> P1-NAT-001 -> P1-NAT-003 ->
P1-DET-001 -> P2-INS-001 -> P2-INS-004 -> P2-INS-009 ->
P2-INS-010 -> P2-INS-011 -> P2-INS-013 -> P2-INS-014 ->
P2-INS-015 -> P1-APP-004 -> QA-018 -> P2-PKG-001 ->
P2-PKG-002 -> QA-016
```

The first actual 5-second output PoC `P1-WF-013` has a separate 93-Agent-hour longest path, but the WBS defines the accepted internal vertical slice through clean packaging/VM/E2E evidence at `QA-016`. External and scarce-resource wall time is deliberately not hidden inside the 133-hour figure.

### Public 1.0 decision — 211 Agent hours

The longest WBS chain continues from `QA-016` through `LONG-001`, `003`, `004`, `006..009`, `011`, `012`, then `REL-004..006`. The exact sequence is stored and validated in `catalog.valid.json`.

Desktop, comfy-cli, and optional OS-enforced zero-egress are not inserted into the Managed-Core critical path. Conditional external choices block only if selected.

## 4. Hostile evidence

| Fixture | Exact expected rule |
|---|---|
| duplicate gate ID | `GATE.DUPLICATE_ID` |
| duplicate gate name | `GATE.DUPLICATE_NAME` |
| missing task assignment | `TASK.MISSING_ASSIGNMENT` |
| accepted gate with an unaccepted requirement | `GATE.ACCEPTED_WITH_UNACCEPTED_TASK` |
| active task behind a closed gate | `GATE.CLOSED_BYPASS` |
| unknown `EXT-*` | `EXTERNAL.UNKNOWN_ID` |
| circular gate relation | `GATE.CYCLE` |
| gate self-unlock | `GATE.SELF_UNLOCK` |
| conflicting critical-path claim | `CRITICAL_PATH.CONFLICT` |
| `P0-CON-011` reinserted into Alpha `G3` | `GATE.ALPHA_CONTRACT_FALSE_SERIALIZATION` |

The validator summary is deterministic and reports `valid=1 negative=10 gates=12 tasks=152 external=11 critical_paths=2`. Here `external=11` is the union of ten authoritative external gates plus the already-materialized `EXT-REMOTE-UPDATE-DECISION`; it is not a claim that the accepted external-gate document has eleven rows.

## 5. Minimal proposed Root registry delta

No live registry file was modified. Root should apply the following only after reviewing and accepting this task.

### A. Gate topology corrections

Use the existing registry fields now, with these exact replacements:

| Gate | `requires` delta | Replace `unlocks` with |
|---|---|---|
| `G0` | none | `P0-ARC-002`, `P0-ARC-003`, `P0-ARC-004` |
| `G1` | none | `P0-CON-001`, `P2-INS-010`, `P2-INS-013` |
| `G2` | none | `P1-APP-001`, `P1-NAT-001`, `P1-DET-001`, `QA-001` |
| `G3` | none; preserve `P0-CON-001..010` plus `P0-CON-012`, excluding `P0-CON-011` | `P1-APP-002` |
| `G4` | none | `P1-WF-013` |
| `G5` | none | `P1-WF-012`, `P1-WF-013` |
| `G6` | none | `P1-WF-013` |
| `G7` | none | `P1-WF-018`, `REF-001`, `ACC-001`, `LONG-001` |
| `G8` | add `QA-020` | empty array |
| `G9` | none | `REL-004` |
| `G10` | add `P0-CON-011` to the Runner gate requirements | `LONG-012` |
| `G11` | none | `REL-006` |

This removes the false `G7 -> P1-WF-015` serialization, keeps `P0-CON-011` off the Alpha cross-contract gate, and does not gate downloader, detector, bridge, or Alpha schema implementation behind Runner/legal/GPU decisions.

### B. Additive gate fields and validator enforcement

For each live gate, copy `requires_gates`, `requires_external`, and `conditional_external` exactly from `catalog.valid.json`. Treat current `unlocks` as the catalog's `protects_tasks`. Root should extend `tasks/validate_wbs.ps1` in a separately owned change so it rejects:

- an accepted gate whose predecessor or hard external requirement is not accepted;
- a ready/active protected task behind a closed gate;
- unknown conditional or hard external IDs;
- gate cycles and self-unlocks.

Until that validator change is integrated, `validate-gates.mjs` is the deterministic enforcement evidence; the live registry remains the authority for task state.

### C. Lazy external materialization

Do **not** bulk-add the eight authoritative external gates that are not yet live merely to match a count. Instead, before Root changes a task with a hard task-level external prerequisite to `ready` or active:

1. materialize each required external ID in `registry.external_gates` with `status=blocked_external`, the exact Human/external owner role, and a scoped `satisfies` statement;
2. copy the task's hard IDs into an additive `external_prerequisites` array;
3. keep the task `backlog`/`blocked_external` until those external records are `accepted`;
4. materialize conditional IDs only after Root records that the named packaging/product condition is selected.

The next mandatory additions are `EXT-H3-LICENSE` and `EXT-HARDWARE` before `P1-WF-013` can become ready. No addition is required for the current ready set.

### D. P0-GOV-010 acceptance record

After review, Root may set `P0-GOV-010.status` to `accepted`, preserve owner `/root/task-01-gate`, add these evidence paths, and remove `P0-GOV-010` from `current_wave.tasks`. Wave 5 remains `in_progress` while `P0-CON-004` or `P1-APP-001` is active; `current_wave.next_ready` is already empty.

```json
[
  "docs/architecture/GATE_CATALOG.md",
  "docs/evidence/CRITICAL_PATH_GATE_REVIEW.md",
  "tests/fixtures/governance/gates/catalog.valid.json",
  "tests/fixtures/governance/gates/validate-gates.mjs"
]
```

Root must run both acceptance commands after integrating any registry/validator delta. This worker cannot accept the task or a gate.

## 6. Acceptance evidence

Both context commands were run twice from the repository root. All four processes exited `0`, and both pairs of captured UTF-8 summaries were byte-identical.

```text
GATE_VALIDATION_OK valid=1 negative=10 gates=12 tasks=152 external=11 critical_paths=2
WBS_VALIDATION_OK tasks=152 unique=152 missing=0 cycles=0 registry_drift=0 active=26 wave=3 external=2 roots=P0-GOV-001
```

The gate validator's `external=11` uses the union semantics explained above. The live WBS validator's `external=2` reports the two WBS external prerequisite tokens currently materialized in the registry. These counts describe different layers and are both correct.

## 7. Impact and remaining risks

- Schema/API: none changed.
- Registry/WBS/master plan/root lockfile: none changed.
- Product code: none changed.
- Resource locks: none acquired.
- Remaining risks: lazy external materialization is not yet enforced by the live WBS validator; conditional external choices require an explicit Root decision record; Agent-hour critical paths exclude real scarce-resource and Human wall time by policy.
- Dependency unlocked only after Root acceptance: authoritative scheduling for post-contract and production implementation waves.

The correction does not change either computed critical-path length or sequence: Alpha-0 remains 133 Agent hours and public 1.0 remains 211 Agent hours. It changes only milestone ownership and the proposed registry delta: `P0-CON-011` moves from the erroneous `G3` requirement/assignment to `G10`, matching its existing Runner dependencies.
