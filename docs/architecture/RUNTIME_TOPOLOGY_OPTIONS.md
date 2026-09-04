# P0-ARC-001 — Windows runtime topology and adapter spike

> Status: Phase 0 conditional recommendation, not a final ADR  
> Scope: runtime ownership, static discovery, adapter contracts and the next executable PoCs  
> Product boundary: this tool installs/configures/scans/compiles and hands off a workflow. MiniMax H3 alone generates video and native audio inside ComfyUI after the user clicks Run.

## 1. Decision summary

For the Alpha path, the strongest conditional choice is:

1. **Primary execution topology: tool-managed, immutable ComfyUI Core/Portable generation on the user-selected local NTFS volume, defaulting to a visible `D:\MiniMaxH3` root when D is suitable.**
2. **Desktop-managed environments remain attach-only secondary targets** until a versioned adapter proves instance identity, supported model-path configuration and `OPEN_AND_FOCUS` without writing Desktop private state.
3. **A restricted comfy-cli helper is not a Stable runtime owner.** It may be reconsidered for a narrow, pinned developer/bootstrap PoC, but its current command surface overlaps installer/updater/Manager/model/cloud responsibilities and conflicts with the product's local-only, no-hidden-download boundary.

This is conditional rather than final because no runtime was launched in P0-ARC-001. In particular, exact-workflow focus in Desktop, generation-phase offline behavior, managed Core launch, model-path attachment and C-drive budgets are not yet proven.

The current official Comfy Desktop is a multi-installation manager with per-install updates and snapshots, not one stable folder layout. Its official Windows documentation also places default installations/shared assets under `%LOCALAPPDATA%` and settings/logs under `%APPDATA%`, while allowing custom installation paths. [Official Windows documentation](https://docs.comfy.org/installation/desktop/windows) The current source/repository describes isolated installations, updates, snapshots and adoption of existing installs. [Comfy Desktop at audited revision `2908735`](https://github.com/Comfy-Org/Comfy-Desktop/tree/29087358520593cc2d08224e89d6bc8c9d455254)

## 2. Scope and confidence vocabulary

This spike uses the repository's capability rule:

- **proven:** repeated local evidence or immutable upstream evidence supports the claim;
- **inferred:** architecture judgment supported by evidence but not yet exercised end to end;
- **blocked:** required lock, software, external decision or PoC is absent;
- **rejected for Stable:** the route conflicts with a non-negotiable boundary unless redesigned.

Static discovery only produces a candidate. It does not advance an external instance or model to trusted/compatible/approved/selected.

At task start, `docs/MASTER_ORCHESTRATION.md`, `docs/DECISION_LOG.md`, `docs/RISK_REGISTER.md` and `tasks/registry.json` were not present in this workspace. This worker therefore used only the explicit task packet and `AGENTS.md`; it did not create, infer or modify root-owned contracts or locks.

## 3. Current-host static evidence

The read-only prototype checked 10 fixed known/documented candidates plus exact-name records in the three standard Windows uninstall registry scopes. It found:

| Evidence type | Count |
|---|---:|
| Desktop executable candidate | 0 |
| Desktop uninstall-registry candidate | 0 |
| Desktop data-directory-only evidence | 0 |
| Portable candidate | 0 |
| Core candidate | 0 |
| Partial/ambiguous layout | 0 |

Evidence: [`HOST_PROBE_2026-08-27.md`](../../prototypes/phase0/runtime-probe/evidence/HOST_PROBE_2026-08-27.md)

**Proven:** the listed candidates had no expected static markers at probe time.

**Not proven:** that the entire host has no Desktop/Comfy installation. The probe intentionally did not scan drives recursively, read Desktop private instance state, follow reparse points, parse external Python, enumerate model files or inspect arbitrary paths. A later path-picker scan can discover an installation elsewhere with user authorization.

## 4. Common adapter contract

All three routes must implement the same capability result. Directory shape alone is insufficient.

| Contract field | Required meaning | Stable gate |
|---|---|---|
| `topology` | `desktop_managed`, `managed_core`, `managed_portable`, or `restricted_cli_helper` | Exact enum, never inferred from display name alone |
| `owner` | Who may write runtime, frontend, models, config, logs, update state | A mutation matrix exists for every path/state item |
| `instance_identity` | App version, installation ID, backend commit/version, frontend version, adapter schema | Unknown or drifting identity fails closed |
| `launch` | Executable, fixed argument array, working directory, environment envelope, PID/creation time, Job Object and reserved port | No shell command construction; only own process tree is stopped |
| `endpoint` | Bound loopback address/port and process ownership proof | Explicit `127.0.0.1`; never bare `--listen` |
| `node_policy` | API nodes, unknown custom nodes, Manager and runtime downloads | Disabled; only a signed Runner may be whitelisted in a separate long-video recipe |
| `model_paths` | Read-only external model candidates and tool-owned model roots | No external model move/overwrite; supported write entry only |
| `workflow_handoff` | Persist, open and focus exact project workflow | Capability is one of `OPEN_AND_FOCUS`, `PERSIST_ONLY`, `EXPORT_ONLY`, `UNSUPPORTED` |
| `offline` | Update checks, knowledge/telemetry, frontend/template fetches, API nodes and egress | Network capture passes for the generation phase |
| `update_authority` | Which owner can create/activate a new backend/frontend/runtime generation | No implicit `latest`; one authority per artifact |
| `rollback` | How launcher, runtime, models, project and checkpoints are independently recovered | Active work remains on its old immutable generation |
| `storage_budget` | D final/peak and C controlled/OS-written bytes by category | No silent large-file fallback to C; clean-VM I/O report exists |
| `confidence` | `proven`, `inferred`, `experimental`, `blocked` | Only proven capability becomes Stable |

## 5. Option A — Desktop-managed installation

### Ownership and intended flow

Comfy Desktop owns its launcher, installation registry, backend/frontend selection, per-install Python environment, shared paths, updates and snapshots. The tool would statically discover the app, ask the user to choose a Desktop installation, attach verified model paths through a supported Desktop entry, persist a workflow and request Desktop to open the exact installation/workflow.

The audited current Desktop source models multiple installations and shared/per-install paths. It also generates Desktop-managed model configuration; those files must be treated as private/read-only unless the upstream provides a supported bridge. [Installation record source](https://github.com/Comfy-Org/Comfy-Desktop/blob/29087358520593cc2d08224e89d6bc8c9d455254/src/main/installations.ts#L16-L71), [model-path source](https://github.com/Comfy-Org/Comfy-Desktop/blob/29087358520593cc2d08224e89d6bc8c9d455254/src/main/lib/models.ts#L202-L273)

### Contract status

| Concern | Current status | Required proof |
|---|---|---|
| Discovery | Static executable/registry/data-root markers are straightforward; current host found none | Current + one legacy Desktop fixture; exact app and installation schema |
| Launch and instance identity | Blocked | Select one installation ID; cold/hot/multi-instance launch returns owned PID, endpoint, backend and frontend identity |
| Model path | Blocked | A supported Desktop UI/bridge entry adds a read-only external model root without editing generated/private files |
| `OPEN_AND_FOCUS` | Blocked | Exact project revision is visible and focused after cold start, hot start and multiple open tabs |
| Offline generation | Blocked | API nodes disabled; no updater/template/Manager/telemetry/network traffic during the measured generation window |
| Update | Proven that Desktop can check/manage updates; adapter behavior after update is unproven | App update invalidates cached capability and forces re-probe before next handoff |
| Rollback | Upstream describes snapshots; cross-product restore semantics are unproven | Tool never claims it can roll Desktop back; unfinished project still resolves its certified runtime or is clearly blocked |

Official `/userdata` routes can save/list workflow files, but persistence does not prove cross-process focus. [ComfyUI server routes](https://docs.comfy.org/development/comfyui-server/comms_routes) No documented stable external `OPEN_AND_FOCUS` contract has been proven in this task.

### Maintenance, supply chain and licensing

- **Maintenance:** low for Python/CUDA provisioning, high for adapter drift. Desktop app, installation schema, backend and frontend can update independently.
- **Supply chain:** Desktop adds Electron/ToDesktop distribution, its bootstrap Python, per-install environment and update channel. The tool does not control their full release lifecycle.
- **License:** current Comfy Desktop is dual-licensed AGPL-3.0-or-later/commercial, with a narrow MIT exception for its bridge-types package. Detection and official-channel guidance are a cleaner boundary than bundling or modifying it; redistribution/integration still requires legal approval. [Audited Desktop repository/license](https://github.com/Comfy-Org/Comfy-Desktop/tree/29087358520593cc2d08224e89d6bc8c9d455254)
- **D drive:** custom installation paths exist, but official defaults include large installation/shared roots in `%LOCALAPPDATA%`; the adapter must explicitly prove and show every chosen large-data root.
- **C drive:** `%APPDATA%` settings/logs and installer/updater/OS caches remain. “C drive zero writes” is impossible to promise.
- **Beginner handoff:** potentially best if `OPEN_AND_FOCUS` exists; unacceptable if normal success falls back to “open folder and drag JSON.”

### Verdict

**Secondary/conditional.** Use only for exact certified Desktop versions/installations. Until `OPEN_AND_FOCUS` and supported model-path configuration are proven, expose it as attach-only or export-only, not the Alpha default.

## 6. Option B — tool-managed Core/Portable generation

### Ownership and intended flow

The tool owns an immutable runtime generation under a final absolute path such as:

```text
D:\MiniMaxH3\runtimes\<recipe-id>\<generation-id>\
```

It owns Python/embedded Python, pinned ComfyUI backend, frontend, wheels, signed custom Runner where applicable, private user/input/output/temp directories and a small `active.json` pointer. Models are separate content-addressed artifacts or verified external read-only references; they are not copied into every generation.

The pinned ComfyUI CLI exposes the controls required for this topology: explicit listen/port/base/input/output/temp, frontend selection, custom-node disable/whitelist, API-node disable and metadata disable. [Pinned CLI arguments](https://github.com/Comfy-Org/ComfyUI/blob/d8e7bbc9d586d95f758d6b0ed23d519088be578a/comfy/cli_args.py#L57-L70), [node/network-related arguments](https://github.com/Comfy-Org/ComfyUI/blob/d8e7bbc9d586d95f758d6b0ed23d519088be578a/comfy/cli_args.py#L142-L185)

### Contract status

| Concern | Current status | Required proof |
|---|---|---|
| Discovery | Prototype proves layout-marker detection only | Tool-owned manifest/digest becomes authoritative; external Core remains attach-only |
| Launch and instance identity | Inferred, not run | Final-path generation starts on reserved loopback port; reported versions/hashes match recipe; Job Object teardown is scoped |
| Model path | Inferred | Tool-generated `extra_model_paths` or base-directory config references verified external/model-store roots without modifying user config |
| `OPEN_AND_FOCUS` | Blocked but locally controllable | Persist a unique workflow in the owned user dir and load/focus it in the pinned frontend; verify project revision/hash |
| Offline generation | Inferred | `--disable-api-nodes`, no custom nodes except signed Runner, Manager disabled, fixed frontend/templates and process egress capture |
| Update | Architecture-proven, implementation blocked | Build new final-path generation; validate; replace only small active pointer |
| Rollback | Architecture-proven, implementation blocked | Switch pointer to N-1; retain generations/models referenced by unfinished projects |

### Maintenance, supply chain and licensing

- **Maintenance:** highest initial packaging/compatibility cost, lowest adapter ambiguity. The tool must certify Python ABI, Torch/Torchaudio/Torchvision/CUDA wheel tags, backend/frontend/templates, nodes, models and FFmpeg/PyAV.
- **Supply chain:** broad but explicit and hashable. Stable installation uses a signed manifest/wheelhouse and no runtime pip/Manager/latest fetch.
- **License:** the audited ComfyUI revision carries GPL-3.0. Distribution of ComfyUI and all bundled dependencies requires notices/source-offer and compatibility review; keeping the proprietary tool as a separate process does not erase distribution obligations. [Pinned ComfyUI license](https://github.com/Comfy-Org/ComfyUI/blob/d8e7bbc9d586d95f758d6b0ed23d519088be578a/LICENSE)
- **D drive:** strongest control. Runtime, model store, cache, temp media, output and checkpoints can be selected before acquisition. The venv/embedded runtime is built in its final generation path and never moved from staging.
- **C drive:** app settings, logs, Windows caches, crash dumps and possibly driver caches remain. The process envelope must relocate `TEMP/TMP`, HF/HF-Xet and framework caches where supported, then measure residual C writes.
- **Beginner handoff:** deterministic once exact-workflow focus is implemented. It can still launch a pinned web frontend if Desktop integration is unavailable, but that is a product UX decision requiring explicit approval.

### Verdict

**Recommended primary Alpha topology, conditional on the next launch/handoff PoCs.** It best preserves a locked recipe, offline behavior, D-drive guarantees and recoverable updates.

## 7. Option C — restricted comfy-cli helper

### What “restricted” must mean

The current official comfy-cli is intentionally broad: it installs latest ComfyUI and Manager by default, manages/update custom nodes, downloads/removes models, can execute registry-provided install scripts, launches arbitrary frontend PRs, submits local/cloud workflows and directly invokes Partner models that upload local inputs. [comfy-cli at audited revision `c1fa1f4`](https://github.com/Comfy-Org/comfy-cli/tree/c1fa1f48d20847ff37c450b6adfb2f152c8c8b51)

Its documentation also says a default install without a path goes under `<HOME>/comfy`; launch can refresh a configured knowledge bundle in the background, while analytics are opt-in but still represent another state surface. [Pinned README](https://github.com/Comfy-Org/comfy-cli/blob/c1fa1f48d20847ff37c450b6adfb2f152c8c8b51/README.md)

Therefore a restricted helper cannot be a generic `comfy` executable with hidden menu items. It would require:

- an exact source/wheel version and hash;
- a fixed absolute D-drive workspace and tool-owned isolated helper environment;
- a hard command allowlist implemented before argument construction;
- forced local target, `COMFY_KNOWLEDGE_DISABLE=1`, `DO_NOT_TRACK=1` and `COMFY_NO_TELEMETRY=1`;
- Manager disabled and no `install`, `update`, `node`, `model`, `run`, `jobs`, `download`, `cloud`, `generate`, `skills`, PR or registry commands;
- no acceptance of arbitrary passthrough launch arguments from project/user data;
- no updater authority and no independent active-runtime pointer.

At that point, if the only permitted operation is launching one pinned workspace, direct launch of the owned Python/Comfy entry point is simpler, smaller and easier to audit.

### Contract status

| Concern | Current status | Required proof |
|---|---|---|
| Discovery/bootstrap | Inferred convenience | Pinned helper reports one explicit workspace without mutating `comfy.yaml` or user defaults |
| Launch and identity | Blocked | Fixed launch adapter returns owned PID/port and never accepts cloud/default target |
| Model path | Rejected as owner | Tool's model catalog remains authoritative; helper cannot download/remove models |
| `OPEN_AND_FOCUS` | Unsupported by current evidence | Helper launch alone does not prove exact workflow focus |
| Offline | Blocked/high risk | Network capture with all cache/knowledge/telemetry/update features disabled |
| Update/rollback | Rejected as owner | Helper update/snapshot mechanisms do not replace immutable tool generations |

### Maintenance, supply chain and licensing

- **Maintenance:** adds a second orchestration/config/update layer on top of the tool's own installer.
- **Supply chain:** adds comfy-cli, its Python dependency graph, optional uv/Manager/registry integrations and generic cloud/Partner code paths even if not called.
- **License:** comfy-cli is GPL-3.0; redistribution must be included in legal/SBOM review. [Official license statement](https://github.com/Comfy-Org/comfy-cli/blob/c1fa1f48d20847ff37c450b6adfb2f152c8c8b51/README.md#license)
- **D drive:** an explicit workspace can be D, but the documented default is under HOME and helper/tool caches require separate proof.
- **C drive:** tool environment, user config/cache and HOME-default behavior risk C writes unless every path is redirected and measured.
- **Beginner handoff:** no benefit over direct managed launch for the final “only click Run” experience; helper errors add another diagnostic layer.

### Verdict

**Rejected as the Stable runtime/update/model owner.** Keep only as an optional source-audit or developer-only experiment unless a later PoC shows a unique capability that direct managed launch cannot provide.

## 8. Comparative scorecard

Scores are architecture judgments for this product, not generic ratings of the upstream projects.

| Criterion | Desktop-managed | Managed Core/Portable | Restricted comfy-cli helper |
|---|---|---|---|
| Runtime determinism | Low–medium; Desktop update/schema controlled upstream | High after recipe certification | Medium; helper and workspace state both drift |
| Initial engineering | Medium adapter/bridge work | High packaging/runtime work | Medium, but duplicates installer logic |
| Long-term maintenance | High adapter drift | High certification, lower ownership ambiguity | Highest overlap/command-surface risk |
| Offline enforceability | Blocked; launcher/update behavior separate | Best control; still needs capture | Blocked; must suppress broad network-capable surface |
| Update/rollback ownership | Desktop owns; tool can only re-certify | Clear immutable generation + pointer | Ambiguous dual authority |
| Model reuse safety | Requires supported Desktop entry | Strong: external read-only reference + own config | Weak if model commands remain reachable |
| D-drive control | Partial; custom paths need proof | Strong | Partial; workspace plus config/cache proof needed |
| C-drive budget predictability | Lowest | Highest after clean-VM measurement | Medium–low |
| `OPEN_AND_FOCUS` | Potentially best, currently blocked | Controllable, currently blocked | No proven benefit |
| Beginner experience | Excellent only if adapter succeeds | Good after owned handoff; may use browser UI | Extra failure layer |
| License/integration | Desktop AGPL/commercial boundary | ComfyUI GPL distribution obligations | Adds comfy-cli GPL obligations |
| Alpha recommendation | Secondary attach-only | Primary conditional | Do not ship as owner |

## 9. Storage and C-drive budget contract

No route may promise “C drive zero writes.” The installer UI should show four separate budgets:

| Budget | Desktop-managed | Managed Core/Portable | Restricted helper |
|---|---|---|---|
| User-selected managed large data | Only if Desktop supported settings prove D roots | D runtime/model/cache/temp/output/checkpoint roots | D explicit workspace, if retained |
| Upstream app/private state | `%APPDATA%` settings/logs and updater state | None beyond the tool's own small control state | Helper config/tool env unless redirected |
| Windows/uncontrollable | installer cache, crash dump, driver/shader/security scan | same | same |
| Peak/rollback | Desktop installation/snapshot semantics | current + N-1 generation, download partials, media/checkpoints | helper env + workspace + any helper caches |

Stable acceptance requires a clean Windows 10/11 VM I/O trace that reports actual C and D deltas by path category. If D is absent, unsupported or not local NTFS, the product must ask for another location; it must not silently put models/runtime/cache/temp/output on C.

## 10. Static probe prototype

Implementation: [`prototypes/phase0/runtime-probe`](../../prototypes/phase0/runtime-probe/README.md)

The prototype:

- checks exact known/documented paths and exact-name uninstall entries;
- recognizes inert Desktop executable/state, Portable and Core marker layouts;
- separates Desktop app evidence from orphaned/data-only evidence;
- blocks traversal of candidate-root reparse points;
- returns only redacted candidate IDs and static marker booleans;
- does not run/import Python, launch a process, install software, read Desktop private state, scan drives, enumerate models or make network calls.

Fixture tests parse the PowerShell AST for forbidden process/network/mutating commands, compare all fixture hashes and timestamps before/after, validate fail-closed classification and reject path/username disclosure.

This is intentionally not the future production scanner. It proves the minimum safe discovery boundary before a shared schema exists.

## 11. Required next PoCs

### Next PoC A — managed Core launch and identity (proposed; root assigns the task ID)

Prerequisites: approved pinned runtime fixture/artifact; no H3 model or GPU needed.

Validate:

1. build/use one runtime in its final D generation path;
2. launch by argument array on `127.0.0.1` and reserved port with private user/input/output/temp;
3. disable API nodes, all custom nodes, Manager and runtime downloads; pin frontend/templates;
4. prove PID/creation time/Job Object ownership and safe teardown;
5. query only the owned instance for versions/features/object info;
6. show no unexpected network and no large C writes.

### Next PoC B — Desktop adapter and `OPEN_AND_FOCUS` (proposed; root assigns the task ID)

Prerequisites: `COMFY-DESKTOP` lock; use a clean/sacrificial environment or approved existing instance. This task may require `WIN-VM` if installation/update behavior is exercised.

Validate current and one legacy version:

1. discover app version, installation ID, backend/frontend and selected instance without guessing folders;
2. enumerate supported model roots through official bridge/settings only;
3. persist a uniquely named project workflow without overwriting user state;
4. cold start, hot start, multiple installations and unsaved tabs;
5. assert the exact project revision becomes active (`OPEN_AND_FOCUS`), not merely listed;
6. update the Desktop app and prove adapter re-probe/fail-closed behavior;
7. measure C/D writes and generation-window network.

If item 5 fails, Desktop cannot satisfy the normal Alpha handoff and remains `PERSIST_ONLY`/`EXPORT_ONLY`.

### Next PoC C — model-path adapters (proposed; root assigns the task ID)

Prerequisites: model contract owner and approved small fake-model fixtures; no real model download.

Validate Desktop, Core and Portable separately: supported read/write boundary, path containment/reparse behavior, filenames with spaces/Chinese, external read-only reuse, duplicate roots, missing/removable drive and zero overwrite of external config/models.

### Next PoC D — restricted comfy-cli source/launch delta (optional; root assigns the task ID)

Do this only if root identifies a unique benefit beyond direct launch. First perform source-level command/network/config audit at the pinned commit. A runnable PoC must use a disposable tool-owned workspace and cannot install Manager/nodes/models, submit workflows, invoke cloud/Partner commands or become an updater. If its fixed allowlist is functionally just `launch`, close the option as unnecessary.

## 12. Acceptance status

| Conclusion | Status | Evidence/blocker |
|---|---|---|
| Probe is read-only against fixtures | Proven | AST safety test plus before/after hashes/timestamps |
| Probe output does not disclose host paths/user | Proven | fixture test and sanitized host output |
| No Desktop/Core/Portable at fixed candidates on current host | Proven, narrowly scoped | host evidence file; not a full-drive conclusion |
| Desktop is multi-installation and has independent updates/data roots | Proven upstream | official docs and pinned source |
| Managed Core offers the clearest ownership/offline/rollback topology | Inferred | requires Next PoC A |
| Desktop can open and focus the exact generated workflow | Blocked | requires Next PoC B and `COMFY-DESKTOP` lock |
| Desktop can safely attach external H3 model paths | Blocked | requires supported upstream entry and Next PoC C |
| Restricted comfy-cli can be fully offline and path-contained | Blocked; unnecessary by default | broad current command/network/config surface |
| Exact D/C budgets | Blocked | clean-VM I/O traces required |
| Distribution licensing is closed | Blocked | legal review of ComfyUI GPL, Desktop AGPL/commercial and optional comfy-cli GPL |

No shared schema, API, package lockfile, task registry or root decision file was changed by P0-ARC-001.
