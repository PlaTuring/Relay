# Atomic Work Breakdown Structure

> Baseline: 152 bounded tasks. Typical size is 2–6 Agent hours; model download, GPU, VM, legal, certificate, and user-test wall time are tracked separately. This is intentionally finer than the old five-role plan, but tasks are not split below a stable reviewable artifact.

Legend: `CPU` is parallel; `SCHEMA`, `GPU`, `DL`, `DESKTOP`, `VM`, and `LOCKFILE` are serialized resources. “Accept” is the shortest objective completion test, not a substitute for the task context packet.

## A. Governance and product gates — 10 tasks

| ID | Task | Depends on | Output | Accept | Queue / h |
|---|---|---|---|---|---|
| P0-GOV-001 | Repository and Agent operating contract | — | `AGENTS.md`, Git baseline, ownership rules | New worker can identify scope, paths, locks, completion format | CPU / 3 |
| P0-GOV-002 | Consolidate audits and binding architecture | P0-GOV-001 | optimized architecture, decisions, risks | Every cross-audit P0 has a decision, task, or external gate | CPU / 5 |
| P0-GOV-003 | Alpha capability matrix and external-owner gates | P0-GOV-002 | capability matrix, external gates | Alpha-0/1/1.0 fields are filtered; Human gates cannot self-pass | CPU / 5 |
| P0-GOV-004 | Formal product/process boundary ADR | P0-GOV-002 | ADR-001 | Tool/H3/Comfy/Runner/test responsibilities and no-first-queue invariant | CPU / 3 |
| P0-GOV-005 | Evidence-level and claim registry convention | P0-GOV-003 | claims schema/spec | `proven/inferred/poc_pending/experimental` and expiry rules lintable | CPU / 4 |
| P0-GOV-006 | Terminology and UI-language glossary | P0-GOV-003 | glossary | T2VA/I2VA/L2VA/FL2VA, runtime/model/Desktop terms have one meaning | CPU / 2 |
| P0-GOV-007 | Alpha no-self-update policy | P0-GOV-004 | ADR note, build rule | No update service/channel/latest lookup exists in Alpha build plan | CPU / 2 |
| P0-GOV-008 | External distribution evidence checklist | P0-GOV-003 | evidence packet index | H3/Core/frontend/Runner/PyAV/FFmpeg/CLI/signing fields complete | CPU / 4 |
| P0-GOV-009 | Brand, H3 attribution, AI disclosure separation | P0-GOV-004 | branding boundary contract draft | Three layers cannot disable or replace each other | CPU / 3 |
| P0-GOV-010 | Gate/critical-path review | P0-GOV-003,P0-GOV-004 | gate report | Every production task maps to an explicit gate and exact dependencies | CPU / 3 |

## B. Runtime and control-plane architecture — 12 tasks

| ID | Task | Depends on | Output | Accept | Queue / h |
|---|---|---|---|---|---|
| P0-ARC-001 | Runtime topology options and read-only probe | P0-GOV-002 | topology report, safe probe | Managed Core/Desktop/restricted CLI contracts and current-host facts are reproducible | CPU / 6 |
| P0-ARC-002 | Electron/TypeScript bounded stack spike | P0-GOV-004 | isolated package/process/path prototype | Build, child-process isolation, path picker, per-user package evidence | CPU / 6 |
| P0-ARC-003 | Tauri/Rust bounded stack spike | P0-GOV-004 | isolated package/process/path prototype | Same comparison tests; toolchain and signing costs recorded | CPU / 6 |
| P0-ARC-004 | .NET desktop bounded stack spike | P0-GOV-004 | isolated package/process/path prototype | Same comparison tests; self-contained and Windows API evidence | CPU / 6 |
| P0-ARC-005 | Technology-stack ADR | P0-ARC-002,P0-ARC-003,P0-ARC-004 | ADR-003 | One production stack selected; native-helper boundary explicit | CPU / 4 |
| P0-ARC-006 | Managed Core final-path layout spike | P0-ARC-001 | immutable generation fixture | Space/Chinese path starts without staging references or global changes | CPU / 7 |
| P0-ARC-007 | Current Desktop `OPEN_AND_FOCUS` PoC | P0-ARC-001 | capability report | Cold/hot/multi-instance result and safe failure level; no coordinate automation | DESKTOP / 8 + external setup |
| P0-ARC-008 | Restricted comfy-cli helper PoC | P0-ARC-001,P0-GOV-007 | isolation/egress/license report | Pinned local allowlist, isolated config, no telemetry/cloud, postconditions checked | VM / 7 |
| P0-ARC-009 | Runtime topology ADR | P0-ARC-001,P0-ARC-006 | ADR-002 | Managed Core main path fixed; Desktop/CLI remain separately gated optional adapters and do not block Alpha-0 | CPU / 4 |
| P0-ARC-010 | Managed process/network ownership ADR | P0-ARC-006 | launcher protocol | Loopback, owned port/PID/Job Object/token, shutdown and egress boundaries | CPU / 4 |
| P0-ARC-011 | Generation/active-pointer crash PoC | P0-ARC-006 | pointer prototype/fault log | Incomplete generation never launches; pointer replace and retry are safe | CPU / 6 |
| P0-ARC-012 | Resource-lease protocol with fake workers | P0-GOV-001 | lease schema/mock tests | Artifact/volume/runtime/GPU/project locks serialize and recover stale owners | CPU / 7 |

## C. Production control plane, native helper, and packaging — 10 tasks

| ID | Task | Depends on | Output | Accept | Queue / h |
|---|---|---|---|---|---|
| P1-APP-001 | Production Electron workspace and locked build graph | P0-ARC-005,QA-001 | production workspace, lock graph, build fixtures | Production/dev/package inputs are exact and reproducible; spike-only dependencies and mutable fetches are absent | LOCKFILE / 7 |
| P1-APP-002 | Typed main/preload/service IPC | P1-APP-001,P0-CON-012 | typed IPC contracts, main/preload/services, negative tests | Closed versioned channels validate both directions; renderer has no direct Node/system, queue, or generation authority | CPU / 7 |
| P1-APP-003 | Isolated BrowserWindow renderer shell and accessibility | P1-APP-001,P2-UX-001,P2-UX-004 | isolated renderer shell, policy and accessibility tests | Sandbox/context isolation/CSP/navigation/permission denials and keyboard/DPI/non-color states pass | CPU / 7 |
| P1-NAT-001 | Win32 helper ABI, toolchain, and threat contract | P0-ARC-005,P0-ARC-010,P0-CON-001 | versioned ABI/protocol, toolchain lock, threat contract | Exact calls, inputs, errors, caller identity, signing boundary and non-goals are deterministic and fail closed | CPU / 5 |
| P1-NAT-002 | Pre-first-instruction process, Job, and identity implementation | P1-NAT-001,P0-ARC-010 | native process/Job/identity primitives and attack tests | Suspended create→Job assign→resume, owned PID/token/loopback identity and child-escape rejection are proven | CPU / 7 |
| P1-NAT-003 | Handle, volume, reparse, and owned-commit primitives | P1-NAT-001,P0-ARC-011 | native handle/volume/commit primitives and hostile-path tests | Handle-relative containment, fixed-volume identity, reparse rejection and owned atomic commit pass Unicode/space attacks | CPU / 7 |
| P1-NAT-004 | Electron-helper bridge, protocol fuzz, and packaged identity | P1-APP-001,P1-NAT-002,P1-NAT-003 | locked bridge, fuzz corpus, packaged-helper identity tests | ABI/version/length/auth framing and exact packaged hash/signature fail closed before any privileged operation | LOCKFILE / 8 |
| P1-APP-004 | Production service composition | P1-APP-002,P1-APP-003,P1-NAT-004,P2-INS-015,P1-WF-012 | production service graph and composition tests | Installer/detection/configuration/workflow handoff compose through typed services with zero tool-side `/prompt` or media generation | CPU / 8 |
| P2-PKG-001 | Production package assembly and offline-input inventory | P1-APP-004,QA-018 | packaged application, frozen input inventory, reproducibility report | Assembly consumes only locked reviewed inputs, works offline, and contains no updater, runtime fetch, or undeclared executable | LOCKFILE / 7 |
| P2-PKG-002 | Per-user install, upgrade, and uninstall VM qualification | P2-PKG-001,P2-UX-007 | VM install/upgrade/uninstall evidence | Per-user Unicode/space install, rollback and uninstall preserve external models/projects and leave no unmanaged large C-drive data | VM / 8 |

## D. Versioned contracts — 12 tasks

| ID | Task | Depends on | Output | Accept | Queue / h |
|---|---|---|---|---|---|
| P0-CON-001 | Contract conventions and compatibility | P0-GOV-004,P0-ARC-009 | schema style ADR | IDs, versions, unknown fields, migrations, timestamps, paths fixed | SCHEMA / 4 |
| P0-CON-002 | Capability catalog and local-node allowlist schema | P0-CON-001,P0-WF-001 | schema + fixtures | Proven/status/hardware/license/class/schema fingerprints validate | SCHEMA / 5 |
| P0-CON-003 | Component manifest and provenance schema | P0-CON-001 | schema + fixtures | URL/revision/length/hash/role/creator/packager/license/ownership required | SCHEMA / 5 |
| P0-CON-004 | Minimal Alpha recipe schema | P0-CON-001,P0-CON-002,P0-CON-003 | schema + one profile fixture | Runtime/frontend/model/hardware/output pins reconstruct one profile; `poc_pending`/blocked authorities stay non-runnable and runnable promotion fails exact rules | SCHEMA / 6 |
| P0-CON-005 | Project specification and asset-role schema | P0-CON-001 | schema + fixtures | Original/effective text, slots, duration, canvas and revision represented | SCHEMA / 5 |
| P0-CON-006 | Install state and transaction schema | P0-CON-001,P0-ARC-011 | schema + recovery fixtures | Six-state initial install is idempotent and cannot mark partial active | SCHEMA / 5 |
| P0-CON-007 | Ownership ledger schema | P0-CON-001 | schema + managed/external fixtures | Delete authority and external-read-only state are unambiguous | SCHEMA / 4 |
| P0-CON-008 | Hardware report and model registry schemas | P0-CON-001 | schemas + conflict fixtures | Source confidence, VRAM conflict, model state progression represented | SCHEMA / 5 |
| P0-CON-009 | Route, Canvas, and FrameAudio plan schemas | P0-CON-001,P0-CON-005 | schemas + vectors | Requested/generated/delivered A/V and endpoint/crop strategy validate | SCHEMA / 6 |
| P0-CON-010 | Template binding and workflow-build schema | P0-CON-001,P0-CON-002,P0-CON-005 | schemas + fixture | Canonical visual and derived graph hashes/build fingerprints close | SCHEMA / 5 |
| P0-CON-011 | Run/segment/checkpoint/media-plan schemas | P0-CON-001 | schemas + fixtures | Project/recipe/run/parent hashes and atomic states explicit | SCHEMA / 6 |
| P0-CON-012 | Alpha cross-contract invariant harness | P0-CON-002..P0-CON-010 | validator/test corpus | Valid Alpha vertical fixture passes; intentional capability/component/recipe/project/install/ownership/hardware/route/workflow mismatches fail exact rule | SCHEMA / 7 |

## E. Hardware, instance, and model discovery — 12 tasks

| ID | Task | Depends on | Output | Accept | Queue / h |
|---|---|---|---|---|---|
| P1-DET-001 | Windows/volume/filesystem probe | P0-CON-008,P0-ARC-005,P1-NAT-003 | probe module/tests | Fixed NTFS/non-C candidates, FAT32 rejection, space and volume ID correct | CPU / 5 |
| P1-DET-002 | NVIDIA GPU/VRAM/driver probe | P0-CON-008,P0-ARC-005 | probe module/tests | NVML/SMI preferred; WMI truncation fixture cannot certify wrong profile | CPU / 6 |
| P1-DET-003 | CPU/RAM/OS-build probe | P0-CON-008,P0-ARC-005 | probe module/tests | Stable structured values and unsupported-state reasons | CPU / 3 |
| P1-DET-004 | Static Comfy/Desktop/Portable discovery | P0-ARC-001,P0-CON-008 | detector/fixtures | No external Python import/start/write; instance types distinguished | CPU / 6 |
| P1-DET-005 | Read-only known model-path parser | P1-DET-004 | parser/fixtures | Safe YAML/config parse, Desktop-private state remains untouched | CPU / 5 |
| P1-DET-006 | Known-root candidate scanner | P0-CON-008,P1-DET-005 | scanner/tests | Bounded paths, cancellation, permissions/Unicode handled | CPU / 5 |
| P1-DET-007 | User-selected-folder scanner | P0-CON-008 | scanner/tests | Only selected scope scanned; progress/cancel and no unrelated indexing | CPU / 4 |
| P1-DET-008 | Bounded Safetensors header classifier | P0-CON-003,P0-CON-008 | classifier/malicious fixtures | Role/dtype/tensor fingerprint; oversized/deep/malformed headers rejected | CPU / 6 |
| P1-DET-009 | Selected-candidate full hash cache | P1-DET-008 | hash worker/cache tests | Full hash delayed until selection; identity change invalidates cached proof | CPU / 5 |
| P1-DET-010 | Model state and recipe compatibility resolver | P0-CON-004,P1-DET-008,P1-DET-009 | resolver/tests | Only approved+selected artifacts enter recipe; unknown never silent | CPU / 5 |
| P1-DET-011 | PyAV/private-FFmpeg capability probe | P0-CON-004 | probe/fixtures | Actual versions/codecs/build/metadata path reported without shell strings | CPU / 4 |
| P1-DET-012 | Unified diagnostic report | P1-DET-001..P1-DET-011 | report generator/redaction tests | Report validates, explains conflicts, and contains no private secrets | CPU / 5 |

## F. Initial installer and managed runtime — 15 tasks

| ID | Task | Depends on | Output | Accept | Queue / h |
|---|---|---|---|---|---|
| P2-INS-001 | Managed-root recommendation service | P1-DET-001,P0-CON-006 | service/tests | D only when valid; no silent C fallback; one root persisted visibly | CPU / 4 |
| P2-INS-002 | Embedded catalog loader | P0-CON-003,P0-GOV-007 | loader/tests | Exact signed current-app build tuple loads as lazy data only; drift, network fallback, and download/materialize/execute authority fail closed | CPU / 4 |
| P2-INS-003 | Pre-download license/region gate service | P2-INS-002,P0-GOV-003 | state machine/fixtures | Download URL is unresolved until applicable external decision and acceptance | CPU / 5 |
| P2-INS-004 | Peak/final space planner | P2-INS-001,P2-INS-002 | planner/tests | Download/partial/final/temp/reserve calculated on selected volume | CPU / 5 |
| P2-INS-005 | Download partial-sidecar format | P0-CON-003,P0-ARC-012 | implementation/tests | URL/revision/ETag/range/length/hash/owner recorded | CPU / 4 |
| P2-INS-006 | Single-source Range/resume client | P2-INS-005 | client/server tests | 206/content-range/ETag mismatch and 200 restart behave safely | DL / 6 |
| P2-INS-007 | Streaming length/hash verifier | P2-INS-006 | verifier/tests | Overrun, short file and hash mismatch never materialize | CPU / 4 |
| P2-INS-008 | Safe fixed-archive materializer | P2-INS-002,P2-INS-007,P0-CON-007 | materializer/attack fixtures | Traversal/absolute/device/ADS/reparse/size-limit entries rejected | CPU / 7 |
| P2-INS-009 | Initial-install mutex and durable journal | P0-CON-006,P2-INS-004 | state machine/fault tests | Concurrent install blocked; every state restart is deterministic | CPU / 6 |
| P2-INS-010 | Final generation runtime materializer | P0-ARC-011,P2-INS-008,P2-INS-009 | runtime service/tests | Final-path build, complete flag, pointer activation; no staging references | CPU / 7 |
| P2-INS-011 | Single-profile wheelhouse/runtime dependency install | P0-CON-004,P2-INS-010 | locked inventory/install tests | No index, binary-only, hashes, pip check/import or archive equivalent | CPU / 7 |
| P2-INS-012 | External-model read-only bridge | P1-DET-010,P0-CON-007,P2-INS-010 | bridge/tests | External path referenced without move/write/delete; missing path fails clearly | CPU / 5 |
| P2-INS-013 | Owned loopback Comfy launcher | P0-ARC-010,P2-INS-010,P2-INS-011,P1-NAT-002,P1-NAT-004 | launcher/tests | Correct generation/port/frontend/offline flags; only owned process stops | CPU / 7 |
| P2-INS-014 | Non-H3 runtime smoke | P2-INS-012,P2-INS-013 | smoke report | Start, object/schema capability, model visibility and shutdown pass without GPU generation | CPU / 5 |
| P2-INS-015 | Installer service composition | P2-INS-001..P2-INS-014 | service facade/contract tests | Plan→download→materialize→validate→activate is restartable end-to-end | CPU / 8 |

## G. Short-workflow compiler and handoff — 20 tasks

| ID | Task | Depends on | Output | Accept | Queue / h |
|---|---|---|---|---|---|
| P0-WF-001 | Pin official upstream capability snapshot | P0-GOV-002 | evidence + machine snapshot | Local/API classes, schemas, templates, artifacts and proof status pinned | CPU / 6 |
| P1-WF-002 | Static local-node graph lint specification | P0-WF-001,P0-CON-002 | lint rules/negative fixtures | Partner/API/unknown/auth classes fail across graphs and subgraphs | CPU / 5 |
| P1-WF-003 | Canonical official template normalization | P0-WF-001,P0-CON-010 | pinned T2 fixture/binding map | Template digest and semantic roles stable; no runtime `main` fetch | CPU / 5 |
| P1-WF-004 | Controlled official projection harness | P0-ARC-009,P1-WF-003 | harness/supply-chain record | Pinned frontend only; no third-party JS; visual→derived graph repeatable | LOCKFILE / 7 |
| P1-WF-005 | Workflow build/hash invalidation service | P0-CON-010,P1-WF-004 | service/tests | Project/recipe/template/frontend change invalidates old derived graph | CPU / 5 |
| P1-WF-006 | Input truth table and RoutePlan core | P0-CON-005,P0-CON-009 | pure resolver/tests | Route depends only on slots/capabilities; no content classification | CPU / 4 |
| P1-WF-007 | CanvasPlan math and preview geometry | P0-CON-009,P0-WF-001 | library/vectors | 32 grid/area/aspect/crop and conflicting endpoints are explicit | CPU / 6 |
| P1-WF-008 | FrameAudioPlan rational timebase core | P0-CON-009,P0-WF-001 | library/property tests | 24/40/32000 targets derive without accumulated rounding drift | CPU / 7 |
| P1-WF-009 | Endpoint-preserving frame-plan strategies | P1-WF-008 | pure strategies/vectors | T/I/L/FL never remove declared endpoint in static vectors | CPU / 6 |
| P1-WF-010 | T2VA ProjectSpec→visual compiler | P1-WF-002,P1-WF-003,P1-WF-006,P1-WF-007,P1-WF-008 | compiler/golden JSON | One 5-second T2 visual graph validates with real model roles | CPU / 7 |
| P1-WF-011 | T2 derived-graph and semantic check | P1-WF-004,P1-WF-005,P1-WF-010 | derived fixture/report | Projection matches binding; lint passes; no `/prompt` is called | CPU / 5 |
| P1-WF-012 | Managed frontend workflow handoff | P2-INS-013,P1-WF-010 | handoff adapter/tests | Owned instance presents exact visual workflow and does not auto-queue | CPU / 6 |
| P1-WF-013 | Core/PyAV 5-second output capability PoC | P1-WF-011,P1-WF-012,P2-INS-014 | output report | User Run yields playable H3 native-audio file; actual media stack recorded | GPU / 5 + inference |
| P1-WF-014 | Short-output metadata sanitizer/test | P1-WF-013 | sanitizer/scan report | Public output has no prompt/workflow/username/absolute path | CPU / 5 |
| P1-WF-015 | I2VA compiler and first-frame geometry fixture | P1-WF-009,P1-WF-010 | compiler fixtures | First anchor retained; crop/stretch preview matches graph | CPU / 5 |
| P1-WF-016 | L2VA compiler and last-endpoint fixture | P1-WF-009,P1-WF-010 | compiler fixtures | Delivered last frame retains last anchor in selected strategy | CPU / 5 |
| P1-WF-017 | FL2VA compiler and dual-endpoint fixture | P1-WF-009,P1-WF-010 | compiler fixtures | Both endpoints retained and A/V plan is explicit | CPU / 6 |
| P1-WF-018 | 5/10/15 × T/I/L/FL GPU certification batch | P1-WF-013,P1-WF-015,P1-WF-016,P1-WF-017,P0-ARC-012 | evidence matrix | Every enabled cell passes endpoint, frame/sample, audio, graph, metadata gates | GPU / 8 + batch wall time |
| P1-WF-019 | Empty prompt/neutral-placeholder matrix | P1-WF-018 | static+GPU report | First/last/both behavior and actual model text explicit; unsupported hidden | GPU / 6 + inference |
| P1-WF-020 | Four-second local capability PoC | P1-WF-018 | report/capability decision | Exact frame/audio/endpoints pass or UI minimum remains 5 seconds | GPU / 4 + inference |

## H. Novice UX — 8 tasks

| ID | Task | Depends on | Output | Accept | Queue / h |
|---|---|---|---|---|---|
| P2-UX-001 | Alpha installer IA from fixtures | P0-GOV-003,P2-INS-004 | low-fi/state fixtures | Normal path asks only root, license, recommended summary | CPU / 5 |
| P2-UX-002 | Component purpose/provenance copy | P0-GOV-006,P2-INS-002 | localized catalog copy | Runtime, FL2VA roles, optional capabilities and sizes are accurate | CPU / 4 |
| P2-UX-003 | Install progress/pause/resume UX | P2-INS-006,P2-INS-009 | UI states | Closing/reopening explains saved progress and avoids duplicate download | CPU / 5 |
| P2-UX-004 | Alpha project-create IA | P0-GOV-003,P1-WF-006,P1-WF-007 | low-fi/state fixtures | No content type or node settings; only enabled input/duration/canvas fields | CPU / 5 |
| P2-UX-005 | Compile summary and actual-model-text view | P1-WF-006,P1-WF-008 | summary component | Route/time/crop/input/placeholder are visible without technical clutter | CPU / 4 |
| P2-UX-006 | Model reuse and attach-only UX | P1-DET-010,P1-DET-004 | state/copy fixtures | “Found” differs from approved; existing Comfy remains explicitly unmodified | CPU / 4 |
| P2-UX-007 | Error/recovery and accessibility pass | P2-INS-015,P1-WF-012,P1-APP-003 | messages/a11y tests | What happened/saved/next; keyboard, 125/150% DPI, non-color status | CPU / 7 |
| P2-UX-008 | Novice UAT | P2-UX-001..P2-UX-007 | recordings/metrics/report | ≥80% normal completion, ≤3 content choices, zero dangerous modifications | Human test / 6 + participants |

## I. Security, QA, packaging, and release — 20 tasks

| ID | Task | Depends on | Output | Accept | Queue / h |
|---|---|---|---|---|---|
| QA-001 | Unit/contract test runner | P0-ARC-005,P0-CON-001 | test entrypoint | One command runs fast tests without model/Comfy | LOCKFILE / 5 |
| QA-002 | Schema and golden-fixture CI | QA-001,P0-CON-012 | CI job | Valid/invalid/cross-contract fixtures produce deterministic report | CPU / 4 |
| QA-003 | Windows path/reparse containment tests | P2-INS-001,P2-INS-008 | corpus/tests | Root ancestor reparse, device/ADS/traversal cannot escape | VM / 6 |
| QA-004 | Archive size/count/bomb tests | P2-INS-008 | corpus/tests | Limits fail before out-of-root or unbounded expansion | VM / 5 |
| QA-005 | Child-process argument/injection tests | P0-ARC-010,P2-INS-013 | tests | User paths never execute shell metacharacters; process owner is exact | CPU / 4 |
| QA-006 | Malicious external Comfy discovery test | P1-DET-004 | fixtures/report | Detector never imports node code, writes bytecode, or starts instance | CPU / 4 |
| QA-007 | API/Partner graph negative suite | P1-WF-002,P1-WF-011 | fixtures/report | All visual/derived/subgraph forbidden-node cases fail closed | CPU / 5 |
| QA-008 | No-prequeue invariant capture | P1-WF-012 | network/server test | Compile/open causes zero `/prompt`; user Run is first submission | CPU / 4 |
| QA-009 | Managed-process zero-egress negative test | P2-INS-013,P1-WF-002 | injected worker/capture | Test egress blocked/logged; only owned loopback traffic permitted | VM / 7 |
| QA-010 | Offline second-run vertical test | P1-WF-013 | report | With network disabled, launch→user Run→output succeeds | GPU+VM / 5 + inference |
| QA-011 | C-drive I/O budget capture | P2-INS-015,P1-WF-013 | Procmon/diff report | No managed large data on C; small settings/log paths and bounds disclosed | VM / 7 |
| QA-012 | Download interruption recovery | P2-INS-006,P2-INS-009 | fault report | Kill at 30%; resume without duplicate/corrupt target | DL+VM / 4 |
| QA-013 | Disk-full recovery | P2-INS-004,P2-INS-009 | fault report | Failure occurs before activation; recovery and user message correct | VM / 4 |
| QA-014 | Crash-before-active-pointer recovery | P0-ARC-011,P2-INS-010 | fault report | Old/none active remains valid; incomplete generation quarantined | VM / 4 |
| QA-015 | Ownership/uninstall preserve-data test | P0-CON-007,P2-INS-015 | uninstall report | External models and project/large data remain; exact retained paths shown | VM / 5 |
| QA-016 | Win11 clean vertical installation | QA-007..QA-015,P2-UX-007,P2-PKG-002 | E2E report | Root→install→open→user Run→output→offline repeat passes | GPU+VM+DL / 8 + wall time |
| QA-017 | Win10/alternate-path controlled matrix | QA-016 | E2E report | Supported build and Unicode/space path pass or support is narrowed | GPU+VM / 7 + wall time |
| QA-018 | Dependency inventory/SBOM/NOTICE generator | P1-APP-004,P1-NAT-004,P2-INS-002 | inventory and gap report | Every shipped artifact has source/hash/license/build identity | CPU / 7 |
| QA-019 | Authenticode build/sign/verify pipeline | P0-ARC-005,QA-018,P2-PKG-001 | pipeline design/test artifact | Unsigned internal build distinguished; external build verifies/timestamps with Human cert | CPU+external / 6 |
| QA-020 | Alpha-1 release/claim gate audit | P2-UX-008,QA-016,QA-018,QA-019,P0-GOV-008 | release evidence report | No open P0/Human gate or unsupported public claim can release | CPU / 6 |

## J. Ref2VA add-on — 7 tasks

| ID | Task | Depends on | Output | Accept | Queue / h |
|---|---|---|---|---|---|
| REF-001 | Ref2VA artifact provenance/capability extension | QA-016,P0-CON-002,P0-CON-003 | manifest/capability update | Ref checkpoint exact; shared encoder/VAEs not duplicated | SCHEMA / 5 |
| REF-002 | Reference limits and tag-map resolver | REF-001,P0-WF-001 | pure resolver/tests | Picture/Video/Audio order and official counts/durations exact | CPU / 5 |
| REF-003 | Ref-only text policy PoC | REF-002 | static+GPU report | Non-empty requirement or visible placeholder/experimental status decided | GPU / 5 + inference |
| REF-004 | Ref2VA template binding/compiler | REF-002,P1-WF-003 | visual/derived fixtures | Image/video/audio references bind without endpoint confusion/API nodes | CPU / 7 |
| REF-005 | Ref2VA + AddGuide endpoint compatibility PoC | REF-004 | matrix report | Supported/experimental/rejected combinations explicit | GPU / 6 + inference |
| REF-006 | Ref capability UI/add-on installer | REF-001,REF-004,P2-UX-004 | UI/service integration | Hidden until installed/certified; purpose/size/reuse explained | CPU / 6 |
| REF-007 | Ref2VA technical certification | REF-003..REF-006,QA-009 | evidence report | Three media types, native audio, metadata, offline, uninstall protection pass | GPU+VM / 8 + wall time |

## K. Long-video continuation — 12 tasks

| ID | Task | Depends on | Output | Accept | Queue / h |
|---|---|---|---|---|---|
| LONG-001 | Runner/GraphBuilder no-requeue architecture ADR | QA-016,P0-WF-001,P0-CON-011 | ADR | Expansion after user Run; deterministic IDs; no `/prompt` re-entry; run/checkpoint contract fixed | CPU / 5 |
| LONG-002 | Global variable-window A/V timeline library | P1-WF-008,P0-CON-011 | library/property tests | `W1+Σ(Wi-Oi)`, latent steps, PCM and PTS do not drift | CPU / 7 |
| LONG-003 | Mock two-segment Runner expansion | LONG-001,LONG-002 | signed-node skeleton/tests | Explicit dependency/segment IDs; mock loop executes once per segment | CPU / 7 |
| LONG-004 | Official decoded-AddGuide two-segment PoC | LONG-003,P0-ARC-012 | report/profile fixture | Prior valid frames+audio guide next local H3 window; no queue re-entry | GPU / 8 + inference |
| LONG-005 | Paired AV latent schema/codec experiment | LONG-003 | codec/tests | Two tensors + full fingerprints atomically save/load; mismatch rejects | CPU+GPU / 8 + inference |
| LONG-006 | Continuation-profile ADR | LONG-004,LONG-005 | ADR | Stable candidate selected; other profile status and fallback explicit | CPU / 4 |
| LONG-007 | Atomic segment/checkpoint commit | P0-CON-011,LONG-006 | implementation/fault tests | Half files never complete; parent/hash/timebase chain exact | CPU / 7 |
| LONG-008 | Resume and cache-invalidation engine | LONG-007 | implementation/fault tests | Relaunch+user Run resumes last commit; upstream change invalidates descendants | CPU / 7 |
| LONG-009 | Media assembly capability and private FFmpeg integration | LONG-002,LONG-008,P1-DET-011 | assembler/tests | Stream-copy only when safe; otherwise fixed re-encode; exact A/V/metadata | CPU / 8 |
| LONG-010 | Optional BGM/voice mix add-on | LONG-009 | mix plan/tests | User-provided tracks only; gain/ducking/timing deterministic and visible | CPU / 6 |
| LONG-011 | 30-second certification harness and batch | LONG-008,LONG-009,QA-009 | fixed cases/evidence | Written pass rate, recovery, seams, A/V, resources, offline and metadata pass | GPU+VM / 8 + batch wall time |
| LONG-012 | 60-second Beta harness and batch | LONG-011 | fixed cases/evidence | Beta failure limits, recovery, exact output and resource ceiling visible | GPU+VM / 8 + batch wall time |

## L. Accelerator recipes — 8 tasks

| ID | Task | Depends on | Output | Accept | Queue / h |
|---|---|---|---|---|---|
| ACC-001 | Conservative baseline benchmark protocol | QA-016 | protocol/fixtures | Success, time, VRAM/RAM/disk, frames, native audio and metadata measured | CPU / 4 |
| ACC-002 | Official Turbo provenance and recipe PoC | ACC-001 | report | Exact LoRA/steps/license; video/audio tradeoff and baseline fallback | GPU / 6 + inference |
| ACC-003 | SageAttention compatibility recipe PoC | ACC-001 | report | Exact wheel/Torch/CUDA/GPU; import/fallback and A/V results | GPU / 6 + inference |
| ACC-004 | Memory offload/fast-disk recipe PoC | ACC-001 | report | 16 GB candidate completes without uncontrolled C temp; resource evidence | GPU / 6 + inference |
| ACC-005 | Cache-node candidate PoC | ACC-001 | report | Exact node/version; success/A/V/time; no hidden network/dependency install | GPU / 6 + inference |
| ACC-006 | Accelerator combination prohibition/resolver | ACC-002..ACC-005 | resolver/tests | Only explicitly certified combinations selectable; unknown reverts baseline | CPU / 5 |
| ACC-007 | Preview/final recipe UX | ACC-006,P2-UX-005 | UI/contract tests | User sees supported mode, expected tradeoff, and restore-baseline action | CPU / 4 |
| ACC-008 | Per-hardware accelerator certification | ACC-006,QA-009 | signed evidence matrix | Every published profile has repeat runs and audio/video integrity | GPU+VM / 8 + batch wall time |

## M. Software branding and final public release — 6 tasks

| ID | Task | Depends on | Output | Accept | Queue / h |
|---|---|---|---|---|---|
| REL-001 | Software-branding schema no-op extension | P0-GOV-009 | schema/fixture | `software_brand_only=true`, `media_branding_authority=false`; no asset is valid and no workflow/output contract is affected | SCHEMA / 4 |
| REL-002 | Owner-supplied software-brand integration | REL-001,EXT-BRAND-ASSET | app/about/installer branding tests | Approved name/Logo/authorship assets and hashes appear only in software UI/about/installer; media/output mutation and watermark controls remain absent | CPU / 6 |
| REL-003 | H3 attribution and AI-disclosure enforcement | P0-GOV-008,LONG-009 | policy implementation/tests | Brand layer cannot remove attribution/disclosure required by release policy | CPU / 5 |
| REL-004 | 1.0 install/upgrade/rollback/offline rehearsal matrices | LONG-012,REF-007,ACC-008,REL-002,REL-003,QA-020,EXT-REMOTE-UPDATE-DECISION | bounded VM/GPU rehearsal evidence | Install/upgrade/rollback/uninstall/offline and retained-data matrices pass without changing the tool/H3 boundary | VM+GPU+external / 8 + wall time |
| REL-005 | Release evidence aggregation and claim freeze | REL-004,QA-018,QA-019,P0-GOV-008 | immutable evidence index and public-claim set | Every binary, license, signature, test, support limit and claim resolves to accepted evidence; unknowns block | CPU+external / 5 |
| REL-006 | Final 1.0 publish/rollback decision | REL-005 | signed Human release decision and rollback pointer | Authorized release owner either publishes the exact signed build or records a blocked decision; Agents cannot self-approve | external / 3 |

## Critical path to first useful result

```text
P0-GOV-001/002/003/004
  -> P0-ARC-001/006/009 + P0-WF-001
  -> P0-CON-001..010 + P0-CON-012
  -> P1-APP-001 + P1-NAT-001..004 + P1-DET core tasks + P2-INS-001..015
  -> P1-WF-002..013 + P2-UX-001..007 + P1-APP-002/003
  -> P1-APP-004 -> QA-018 -> P2-PKG-001/002
  -> QA-008/010/011/012/013/014/016
  -> internal Alpha-0 vertical slice accepted
```

Desktop, Ref2VA, long video, accelerators, remote update, and branding are deliberately off this critical path.
