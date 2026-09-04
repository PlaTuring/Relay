# MiniMax H3 Tool — Optimized Architecture Baseline

> Status: binding Phase 0 baseline
> Date: 2026-08-27
> Inputs: three independent audits, one red-team audit, and three cross-audits under `docs/reviews/`

## 1. Product boundary

The product is a local Windows control plane for MiniMax H3 + ComfyUI. It detects, installs, verifies, configures, compiles, and hands off a workflow. It is not a generation model or creative assistant.

```text
Tool control plane
  hardware/model discovery
  managed runtime installation
  recipe and capability resolution
  project/workflow compilation
  ComfyUI launch and verified handoff
          |
          | user clicks Run in ComfyUI
          v
ComfyUI + MiniMax H3 data plane
  H3 creates the actual video and native audio
  optional deterministic assembly/finalization follows
```

The tool must not submit the user's first formal `/prompt` job. After the user clicks Run, a future `H3LongVideoRunner` may deterministically expand and schedule multiple existing local H3 nodes inside that same Comfy execution. It may not generate prompts, scripts, shots, music, or model output itself.

## 2. Delivery layers

### Alpha-0: internal vertical slice

- One known Windows 11/NVIDIA hardware candidate.
- One managed ComfyUI Core runtime and locked frontend.
- One local fixed NTFS managed root, suggested on D when valid.
- One pinned FL2VA stack and one conservative recipe.
- One 5-second, 16:9, non-empty-prompt T2VA workflow.
- H3 native audio and a locally saved playable short video.
- No background/self-directed updater, Desktop execution adapter, community accelerator, BGM, upscaling, interpolation, or brand watermark. ADR-014 records the historical Alpha exception; current ADR-015 permits a user-initiated, fixed-repository Stable Release check and verified Setup download. ADR-016 additionally permits the same explicit “下载并安装” action to launch that exact revalidated Setup interactively, with no arguments; it never changes component catalogs.
- The user launches the prepared ComfyUI view and clicks Run.

### Alpha-1: controlled external test

Adds only capabilities with accepted evidence:

- T2VA/I2VA/L2VA/FL2VA at certified 5/10/15-second frame plans.
- First-frame-only path using an empty string only if proven; otherwise a visible, versioned neutral technical placeholder.
- One documented hardware/driver range.
- Known-root/manual-folder model reuse, resumable download, recovery, offline rerun, C-drive I/O budget, and signed installer.
- Current Desktop read-only detection. Automatic workflow opening is enabled only for versions that prove `OPEN_AND_FOCUS`; otherwise it remains an advanced export mode and is not counted as one-click success.

### 1.0

Adds separately gated Ref2VA, long-video continuation, media finalization, accelerator recipes, update trust, broader hardware support, safe uninstall/GC, and later brand watermark assets.

## 3. Runtime topology

### Alpha default: managed Core

Alpha uses a tool-owned, immutable ComfyUI Core generation. This is still ComfyUI, and H3 still performs all generation after the user clicks Run. The purpose of owning the runtime is to make the following claims testable:

- backend, frontend, templates, Python ABI, Torch stack, models, and nodes are pinned;
- the service binds explicitly to loopback and a process-owned port;
- Partner/API nodes, Manager, unknown custom nodes, runtime downloads, and `latest` references are disabled;
- all controllable model/cache/temp/input/output paths stay under the selected managed root;
- only the tool-owned process tree is started or stopped.

### Existing ComfyUI and Desktop

Existing environments are attach-only by default. Static discovery may read recognized files and paths, but must not import Python, start unknown nodes, install packages, or edit Desktop-managed state.

Desktop adapter capability levels are:

1. `OPEN_AND_FOCUS`: correct installation and exact workflow are opened and verified on canvas; satisfies the intended novice handoff.
2. `PERSIST_ONLY`: workflow can be saved through a supported interface but not focused; limited support.
3. `EXPORT_ONLY`: file export and manual opening instructions; advanced/diagnostic fallback only.
4. `UNSUPPORTED`: version, schema, or instance identity is unknown; fail closed.

Only `OPEN_AND_FOCUS` may be described as automatic Desktop handoff. Coordinate-based mouse automation, clipboard injection, or private Desktop state edits are never Stable implementations.

### comfy-cli

`comfy-cli` is an optional Phase 0 helper candidate, not the trusted default installer backend. If adopted it runs as a pinned, separate process with isolated configuration, explicit workspace, local routing, telemetry disabled, an exact command allowlist, and post-condition validation. Cloud/generate routes, `latest`, `update all`, arbitrary node scripts, and runtime use are forbidden. Its GPL distribution route requires a release-level legal decision.

## 4. Managed installation model

Alpha uses one selected managed root and one profile:

```text
<managed-root>\
  control\
    catalog\
    install-state.json
    ownership-ledger.json
    active.json
    transactions\
  runtimes\<recipe-id>\<generation-id>\
  models\
  cache\
  workspace\
```

- Suggest `D:\MiniMaxH3` only when D is a supported local fixed NTFS volume with enough space. Otherwise show the actual recommended non-C fixed NTFS volume. Never silently fall back to C.
- Alpha uses a single root; separate runtime/model/cache/workspace volume selection is deferred.
- A Python environment is created in its final immutable generation path. A populated venv is never moved out of staging.
- Validation changes only a small `active.json` pointer from incomplete to active. A failed generation is quarantined and cannot launch.
- A named mutex and a small durable journal protect initial installation. Alpha handles resumable download, disk-full, crash-before-activation, and owned partial recovery.
- Each app version embeds its exact component catalog and has no background or self-directed update. Every component target still has an immutable URL/revision, expected length, SHA-256, origin, packager/quantizer, license chain, and role. ADR-015's user-initiated Stable Setup download cannot change that catalog; ADR-016's one-shot launcher may only open the revalidated interactive Setup with no arguments. TUF or an equivalent remote-update trust system remains mandatory before any background, forced or silent update.
- Ownership is recorded from day one. Alpha uninstall removes the app but preserves large managed data by default and shows its location; automatic recursive cleanup waits for full reparse/containment tests.

## 5. Hardware and recipe resolution

Hardware detection prefers a trustworthy NVIDIA path such as NVML/`nvidia-smi` or an equivalent API. WMI `AdapterRAM` is only a fallback because it can truncate modern VRAM values; on the current RTX 5080 it reports roughly 4 GB while `nvidia-smi` reports 16 GB.

A certified recipe identifies, at minimum:

- Windows build and architecture;
- GPU identity/architecture/VRAM, driver minimum, and system RAM;
- Python distribution/ABI;
- Torch/Torchaudio/Torchvision and CUDA wheel tags;
- Comfy backend/frontend/template revisions;
- local H3 node class/schema fingerprints;
- model/encoder/VAE artifact hashes and roles;
- steps, scheduler, attention, offload, decode, duration, canvas, and audio settings;
- expected technical smoke results and known failures.

Unknown hardware never inherits a nearby GPU recipe by name. The current RTX 5080 16 GB + 64 GB host is a **candidate**, not certified until the pinned stack completes the required H3 tests.

Community popularity is discovery input, not a recipe decision. The conservative official baseline is certified first; Turbo, SageAttention, caching, offload, and other optimizations are independent recipes with video, native-audio, success-rate, VRAM, time, and fallback evidence.

## 6. Model discovery and reuse

Model state is explicit:

```text
found -> identified -> verified -> compatible -> approved -> selected
```

- Initial discovery reads known configuration paths and user-selected folders only.
- A candidate first passes extension, size, bounded Safetensors-header, tensor-role/dtype/shape fingerprint, and manifest checks.
- Full SHA-256 is calculated only when the user selects a candidate for reuse, then cached by stable file identity, size, and modification state. Any change invalidates the cache.
- Unknown quantizations, Diffusers directories, GGUF, pickle-based weights, incomplete files, and unverifiable sources are reported but never selected automatically.
- External files remain read-only and are never moved, renamed, overwritten, or deleted by uninstall.
- Each file records model creator, packager/publisher, quantizer/converter, immutable source revision, license chain, and support status. A Comfy-Org repack is not described as a MiniMax-original file.

## 7. Workflow compilation

The optimized design has one authoritative project/visual build path, not two independently editable workflow truths and not two generic graph compilers.

```text
ProjectSpec
  -> CapabilityResolve
  -> RoutePlan                 # based on supplied slots, never content type
  -> CanvasPlan
  -> FrameAudioPlan
  -> TemplateBinding           # semantic roles into a pinned official template
  -> Canonical workflow.json   # user-visible Comfy graph
  -> Static Local-Node Lint
  -> controlled official graphToPrompt projection
  -> derived API graph         # build/test evidence, never authoritative or auto-queued
  -> verified Comfy handoff
```

The official projection runs only in a tool-owned harness containing the pinned official frontend and approved extensions. It never loads arbitrary user/third-party frontend JavaScript. The derived graph carries a build ID, source workflow hash, recipe hash, frontend/object-info fingerprints, and compiler version. It can be stored under `build/<build-id>/` or a run evidence directory, but users do not edit it.

All graph layers, subgraph definitions, and future Runner expansion are checked against exact local `class_type` allowlists. Similar MiniMax Partner/API nodes, authentication fields, unknown output nodes, and unapproved custom nodes fail closed. Dynamic `/object_info` certification is performed only against a verified managed generation; starting an arbitrary external environment is not a safe read-only probe.

## 8. Routes, canvas, duration, and endpoints

The model's route exists for T2VA, I2VA, L2VA, and FL2VA, but product support is capability-gated. Alpha first proves non-empty prompt paths at 5/10/15 seconds. Four seconds and empty-prompt routes are separate gates.

`FrameAudioPlan` is the sole timebase decision source. It records:

- requested, H3-generated, and delivered frame counts;
- 24 FPS video PTS;
- 40 Hz audio-latent steps;
- 32 kHz PCM sample count;
- endpoint anchors and preservation strategy;
- trim, internal drop, or rational retime operations.

The plan is route-aware. A universal tail trim is forbidden because H3 anchors a supplied last frame at the generated final frame; trimming the tail would remove it. T2VA/first-only may tail-trim, last-only must preserve the last anchor, and first+last must preserve both endpoints. Exact delivery duration and endpoint preservation are advertised only after a selected strategy passes GPU and A/V tests.

`CanvasPlan` resolves 32-pixel multiples, the pinned H3 area limit, source aspect ratio, and visible crop/letterbox behavior before graph compilation. First/last images with conflicting ratios require a user-visible preview or warning.

The tool does not ask whether content is a story, product, talking head, mood piece, or music video. H3 interprets the user's prompt. The tool does not append “continue” or “naturally finish” instructions by default. An empty-input technical placeholder, if required, is minimal, versioned, visible, replaceable, and recorded separately from user text.

## 9. Output and FFmpeg capability resolution

External `ffmpeg.exe` is not globally required for the official short-video path. Comfy Core `CreateVideo`/`SaveVideo` can save video with audio through PyAV. PyAV and its FFmpeg libraries still belong in the recipe, SBOM, codec, and metadata tests.

A media capability resolver decides whether a private FFmpeg/FFprobe build is required:

- certified native short output: may use Core/PyAV only;
- exact retiming, unsupported metadata sanitation, or normalized delivery codec: private FFmpeg may be required;
- long-video assembly, BGM/voice mix, upscaling/interpolation rewrap, or final watermark: private FFmpeg is required.

Both paths must prove playable output, expected frame/sample duration, metadata sanitation, and actual codec/license provenance. FFmpeg's exact build and target-market codec/patent route remain release gates.

## 10. Long-video architecture

Long video is not part of Alpha-0 and is not claimed as native one-shot H3 generation. The first long-video experiment is two H3 windows, not 30 or 60 seconds.

Continuation profiles are distinct:

1. `decoded-guide`: uses official `MiniMaxH3AddGuide` with a valid prior clip tail and audio. This is the first candidate because it uses a public node contract, though repeated encode/decode and long-chain quality still require tests.
2. `paired-latent`: a tool-maintained experimental codec for paired H3 video/audio latent state. It requires exact Comfy/H3/model/VAE/Torch fingerprints, signed nodes, a versioned serialization schema, migration/rejection rules, and remains Experimental until proven.

The Runner uses Comfy Node Expansion/GraphBuilder after the user's Run click and never re-enters `/prompt`. Each segment has an explicit parent, global timebase, immutable input fingerprint, and atomic commit. A crash does not cause silent resubmission: the same runtime generation is relaunched, the user clicks Run again, and the Runner resumes from the last committed checkpoint. Updating or deleting any referenced runtime/model/Runner is prohibited while an unfinished run holds a lease.

Thirty seconds can become a Stable candidate only after the selected profile, global A/V timeline, fault recovery, cache invalidation, assembly, and fixed test matrix pass. Sixty seconds remains Beta until its own gate. Neither is marketed as guaranteed seamless one-shot footage.

## 11. Offline, privacy, and process security

The strongest claims apply only to the managed runtime:

- explicit loopback binding, random owned port, no wildcard CORS;
- local H3 class allowlist, Partner/API nodes disabled, unknown nodes disabled;
- pinned local frontend, templates, wheels, models, and media libraries;
- Manager, runtime installers, telemetry, and update checks absent from the generation process;
- no runtime `pip`, Git, model, registry, or frontend downloads;
- offline completion and online process-tree egress capture tests;
- public output metadata allowlist; project-private reproducibility data stays local;
- support bundles use field allowlists and remove prompts, asset names, usernames, tokens, and absolute paths by default.

An arbitrary existing Desktop/custom-node instance may be compatible, but it is not granted the same no-egress certification without its own evidence.

## 12. Resource coordination

Parallel agents do not parallelize scarce machine resources. Before any real model or H3 work, the project implements or manually enforces leases for:

- `artifact:<sha256>` — one downloader/full-hash writer per artifact;
- `volume:<id>` — reserved peak bytes before materialization;
- `runtime:<generation>` — read lease for tests, write lease for update/cleanup;
- `gpu:<adapter-luid>` — one certification run per physical GPU;
- `project-run:<id>` — one Runner per project revision;
- `COMFY-DESKTOP` and `WIN-VM` — one UI/VM owner.

Reports separate Agent work time from download, GPU, VM, and human-observation wall time.

## 13. Core versioned contracts

The implementation freezes small contracts in dependency order rather than one oversized schema task:

1. contract conventions and compatibility rules;
2. component manifest and provenance;
3. minimal recipe;
4. project specification and asset roles;
5. installation state and ownership ledger;
6. capability catalog and local-node allowlist;
7. hardware report and model registry;
8. route/canvas/frame-audio plans;
9. template binding and workflow build metadata;
10. run/segment/checkpoint manifests;
11. media capability/finalization plan;
12. future context profile and branding extension.

Each contract has one owner, JSON Schema, valid/invalid fixtures, migrations or an explicit no-migration policy, unknown-field behavior, and cross-contract invariants.

## 14. Technology-stack decision

ADR-003 and D-018 are accepted: the Alpha production control plane is Electron + TypeScript plus one narrow, signed, versioned Win32 helper. Electron is only the UI/control plane. It detects, installs, verifies, configures, compiles, and hands off; it does not perform model inference, generate media, create prompts, or submit the user's first formal `/prompt` job. MiniMax H3 still creates all actual video and native audio inside ComfyUI after the user clicks Run.

Production implementation is split into explicit task lanes:

- **app:** hardened main/renderer separation, allowlisted IPC, local project/workflow compilation, owned-process launch and verified ComfyUI handoff;
- **helper:** only enumerated handle, volume, reparse-point and pre-first-instruction Job operations; no generic shell, arbitrary command, model, GPU or media surface;
- **package/release:** per-user installer, native/app signing, deterministic dependency locking, SBOM/NOTICE, C-drive budget, accessibility, Chinese/space paths and the Alpha no-self-updater policy.

The bounded spikes do not close production gates for native-helper runtime behavior, signing, clean-VM install/uninstall, offline package reproducibility, security-update SLA, accessibility, or package/C-drive size. Tauri/Rust is the sole evidence-gated revisit candidate if ADR-003's explicit trigger fires. .NET is not a parallel production branch. Python/PySide remains excluded from the control plane and isolated from Comfy's Python environment.

## 15. First vertical slice exit criteria

The first implementation milestone is complete only when one machine can:

1. select a visible supported NTFS managed root;
2. identify the candidate hardware profile without using truncated WMI VRAM;
3. materialize one immutable managed Core generation without global Python/CUDA/PATH changes;
4. verify or obtain the pinned four-role H3 stack using exact manifests;
5. compile and lint one 5-second T2VA visual workflow;
6. launch only the owned local Comfy instance and present that workflow;
7. wait for the user to click Run;
8. let H3 create a playable local video with native audio;
9. repeat the run offline;
10. survive download interruption, disk-full, and crash-before-activation without corrupting a complete installation.

Nothing in this exit criterion asks the tool or an Agent to create the video's content. The MP4 is technical H3 evidence only.
