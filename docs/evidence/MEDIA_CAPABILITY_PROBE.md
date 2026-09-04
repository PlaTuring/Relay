# P1-DET-011 media capability probe evidence

> Status: draft public evidence; implementation and test fields remain pending Root completion  
> Date: 2026-08-27  
> Task: `P1-DET-011`

## Product boundary

> I only implement installation, detection, configuration, workflow compilation, deterministic orchestration, or technical verification. MiniMax H3 generates the actual video and audio inside ComfyUI.

This task is a read-only capability probe and technical-verification task. It does not download or install PyAV or FFmpeg, process or create media, start ComfyUI or MiniMax H3, use a GPU, submit `/prompt`, or grant queue, generation, download, materialization, ownership, deletion, or launch authority. Any automated test accepted for this task must use fake executables and inert fixtures only.

The private absolute locator of every external runtime or executable is omitted. It is not replaced with an unkeyed path hash, prefix, username, filename, or other correlatable surrogate.

## Binding outcome

The three source classes below are independent. Evidence from one class cannot authorize or promote another.

### 1. External Portable PyAV identity observation

Root supplied one pre-existing, attach-only identity observation from an externally managed Portable runtime. P1-DET-011 did not execute that runtime. The private Python executable locator is completely omitted.

| Field | Observation |
|---|---|
| Source class | `external_pyav` |
| Status | `identity_observed` |
| Evidence status | `observation_only` |
| Selectable | `false` |
| Selected | `false` |
| PyAV | `18.0.0` |
| `libavutil` | `60.26.102` |
| `libavcodec` | `62.28.102` |
| `libavformat` | `62.12.102` |
| `libavdevice` | `62.3.102` |
| `libavfilter` | `11.14.102` |
| `libswscale` | `9.5.102` |
| `libswresample` | `6.3.102` |

These strings establish identity observation only. They do not establish a tool-managed runtime, exact Python or wheel artifact identity, linked-DLL tree identity, build configuration, codec availability, container mux/demux availability, metadata read/write behavior, license approval, recipe compatibility, or output correctness. External-runtime detection cannot promote this observation to `verified`, `compatible`, `approved`, `selected`, or runnable.

### 2. Ambient PATH FFmpeg presence observation

An ambient PATH entry associated with a winget-provided FFmpeg installation was reported as present. No exact FFmpeg build, compiler, configuration, library tuple, FFprobe pair, artifact hash, Authenticode identity, ownership record, codec set, container set, or metadata mechanism was supplied or observed by this task.

| Field | Observation |
|---|---|
| Source class | `ambient_host` |
| Status | `present_unverified` |
| Reason | `exact_build_not_observed` |
| Selectable | `false` |
| Selected | `false` |

Ambient PATH discovery is observation-only even if a future ambient probe reports a rich codec or container set. It never supplies automatic selection, fallback, execution, recipe, or packaging authority.

### 3. Managed private FFmpeg/FFprobe pair

No managed private FFmpeg/FFprobe pair is available for selection in this evidence. The state is absent/blocked unless every gate below independently matches the same exact files and packaged application build:

1. exact embedded component-manifest contract, schema ID and digest, document ID/revision/content digest, app ID/version/build ID, and catalog resource;
2. exact component ID/version/role, byte length, raw artifact SHA-256, destination identity, and stable file identity for both FFmpeg and FFprobe;
3. Authenticode verification against the release trust store, with signer identity and signed-artifact digest bound to that same file identity;
4. a current committed tool-owned ledger record, managed-root/runtime-generation identity, handle-relative containment, no-reparse proof, and an active execution read lease;
5. proof that every spawned process image is the exact verified artifact bound above; and
6. a coherent FFmpeg/FFprobe version, library, compiler, and configuration pair.

Manifest declarations are expected values, not self-authenticating proof. Missing, stale, conflicting, or mismatched proof fails closed before capability selection. Even a fully verified pair would initially be `selected: false`; a separate accepted recipe/finalization plan must require and select it.

## Official Alpha short-output path

The immutable Alpha recipe continues to describe the official short-output writer as Core `CreateVideo`/`SaveVideo` through PyAV:

- `writer`: `core_createvideo_savevideo_pyav`
- `external_ffmpeg_requirement`: `not_declared`
- profile state: `poc_pending`, `runnable: false`, `selectable: false`

P1-DET-011 does not amend or promote that recipe. It does not infer an external FFmpeg prerequisite from ambient presence or from external PyAV library identities. Introducing a private FFmpeg component would require a new independently accepted capability and recipe/finalization contract; it cannot be inserted into this Alpha recipe by observation.

## Capability-report design

When an exact managed target is independently verified, the production probe is designed to normalize these bounded public capability fields without returning raw child output or private paths:

| Surface | Public normalized fields | Evidence meaning |
|---|---|---|
| Managed PyAV | exact PyAV/Python/library versions; sanitized build-configuration digest/flags; codec encode/decode flags; container mux/demux flags; metadata API paths | API surface observed for one exact managed runtime; not output certification |
| Verified private FFmpeg/FFprobe | exact program/library/compiler versions; sanitized configuration digest/flags; coherent pair identity; codec flags; container flags; metadata CLI mechanisms | CLI surface observed for one exact verified private pair; not recipe selection or output certification |
| External PyAV | version strings and evidence digest only | identity observation; never selectable |
| Ambient FFmpeg | presence or safely normalized capability observation | host observation; always `selectable: false`, `selected: false` |

Build configuration is represented by a digest plus allowlisted, sanitized flags. Values that may contain build paths, usernames, secrets, or unknown text are fixed as `redacted`; raw configuration, stdout, and stderr are not part of the public report.

Metadata-path entries distinguish read, write, and copy mechanisms and identify whether the evidence came from an API or CLI surface. Merely listing such a mechanism does not prove metadata sanitation on a media file; that remains a later file/output test.

## Required fail-closed behavior

This matrix records the required design outcome. Implementation proof remains pending in the completion placeholders below.

| Condition | Required public outcome |
|---|---|
| No target supplied | `MEDIA.PROBE_UNAVAILABLE`; unavailable and not selectable |
| Relative, unresolved, or invalid executable target | `MEDIA.EXECUTABLE_NOT_ABSOLUTE` or `MEDIA.INVALID_REQUEST`; no spawn |
| External Portable PyAV identity only | observation only; never selected or promoted |
| Ambient PATH FFmpeg present, including a capability-rich build | observation only; `selectable: false`, `selected: false` |
| Managed PyAV runtime proof missing or stale | `MEDIA.PYAV_RUNTIME_UNVERIFIED`; no managed capability claim |
| PyAV version/library/build output is duplicate or conflicting | `MEDIA.PYAV_CONFLICT`; reject all capabilities from that invocation |
| Private catalog/build binding missing or stale | `MEDIA.CATALOG_PROOF_MISSING`; no private spawn or selection |
| Artifact length, hash, path binding, or file identity drifts | `MEDIA.ARTIFACT_MISMATCH`; no private spawn or selection |
| Authenticode proof or exact signer binding is missing | `MEDIA.SIGNATURE_PROOF_MISSING`; no private spawn or selection |
| Ownership, containment, no-reparse, or lease proof is missing | `MEDIA.OWNERSHIP_PROOF_MISSING`; no private spawn or selection |
| Spawned image differs from the verified artifact | `MEDIA.EXACT_IMAGE_PROOF_MISSING`; reject the result |
| FFmpeg and FFprobe versions/libraries/configurations conflict | `MEDIA.FFMPEG_PAIR_CONFLICT`; reject the pair |
| Executable missing, inaccessible, spawn failure, or nonzero exit | fixed failure code; no partial capability result |
| Timeout or descendant-process cleanup cannot be proven | fail closed; never report successful timeout recovery |
| stdout, stderr, or their combined budget is exceeded | `MEDIA.PROCESS_OUTPUT_LIMIT`; terminate the owned tree and suppress raw output |
| Invalid UTF-8, ANSI/terminal controls, C0/C1, bidi controls, or unsafe text | `MEDIA.OUTPUT_INVALID_UTF8` or `MEDIA.OUTPUT_UNSAFE_TEXT`; suppress raw output |
| Private Windows/UNC/file-URI path, username, token, prompt, or hostile diagnostic is emitted | fixed redacted failure only; no raw value, excerpt, or unkeyed hash |
| Malformed, oversized, duplicate, contradictory, or unknown capability records | `MEDIA.OUTPUT_INVALID`; no best-effort selection |
| Codec, container, metadata, version, or build evidence is incomplete | capability remains absent/unknown; it is never inferred |

Child processes must be launched only from absolute, independently verified targets with fixed argument arrays, `shell: false`, a bounded allowlisted environment, bounded time/output/record counts, and owned process-tree cleanup. User data and child output never become a shell command.

## No-real-tool and non-media test boundary

P1-DET-011 acceptance tests must use fake executable fixtures. They may emulate version, build, codec, container, metadata, conflict, timeout, process-tree, unsafe-text, and malicious-output behaviors, but they must not:

- invoke a real PyAV runtime, `ffmpeg`, or `ffprobe`;
- download, install, copy, replace, sign, or materialize a runtime or media tool;
- enumerate or process a real media file;
- generate, decode, encode, mux, demux, sanitize, or play media;
- start ComfyUI, MiniMax H3, Desktop, a GPU task, a VM, or a queue job; or
- scan the host PATH to auto-select an executable.

The external Portable PyAV versions and ambient FFmpeg presence above are Root-supplied observations, not outputs of the P1-DET-011 test harness.

## Completion evidence placeholders

> **BEGIN ROOT COMPLETION PLACEHOLDERS — values below are intentionally not evidence until Root replaces them after independently running and reviewing the final implementation.**

- Final package file inventory: `[[ROOT_FILL_FINAL_PACKAGE_FILES]]`
- Final package/source digest set: `[[ROOT_FILL_FINAL_PACKAGE_DIGESTS]]`
- Typecheck command and result: `[[ROOT_FILL_TYPECHECK_RESULT]]`
- Unit-test count and result: `[[ROOT_FILL_UNIT_TEST_RESULT]]`
- Attack-test count and result: `[[ROOT_FILL_ATTACK_TEST_RESULT]]`
- Fake-executable fixture count: `[[ROOT_FILL_FAKE_FIXTURE_COUNT]]`
- Deterministic package test run 1 summary: `[[ROOT_FILL_PACKAGE_TEST_RUN_1]]`
- Deterministic package test run 2 summary: `[[ROOT_FILL_PACKAGE_TEST_RUN_2]]`
- Public stdout digest, run 1: `[[ROOT_FILL_PUBLIC_STDOUT_SHA256_RUN_1]]`
- Public stdout digest, run 2: `[[ROOT_FILL_PUBLIC_STDOUT_SHA256_RUN_2]]`
- Byte-identical repeated-output decision: `[[ROOT_FILL_DETERMINISM_DECISION]]`
- Root `npm test` regression result, explicitly not module coverage unless separately integrated: `[[ROOT_FILL_ROOT_NPM_TEST_RESULT]]`
- Live WBS validator result: `[[ROOT_FILL_WBS_VALIDATOR_RESULT]]`
- Public evidence/redaction scan result: `[[ROOT_FILL_PUBLIC_REDACTION_RESULT]]`

> **END ROOT COMPLETION PLACEHOLDERS.**

No test, digest, count, implementation-completeness, or repeatability claim is made while any placeholder remains.

## Evidence classification

### Proven contract facts

- The Alpha recipe is immutable, non-runnable and non-selectable, uses the Core `CreateVideo`/`SaveVideo` PyAV writer identity, and has `external_ffmpeg_requirement: not_declared`.
- Contract observation alone grants no download, materialization, execution, ownership, deletion, launch, queue, or media-generation authority.
- Existing external environments are attach-only by default and cannot inherit managed-runtime certification.

### Observation-only facts

- The exact external Portable PyAV and linked-library version strings listed above were supplied by Root as one identity observation.
- An ambient PATH entry associated with a winget FFmpeg installation was reported present without an exact build identity.

Neither observation is a `proven` runtime capability and neither is selectable.

### Blocked or pending

- A managed PyAV runtime identity and its exact codec/container/metadata surface are not established here.
- A manifest-, hash-, Authenticode-, ownership-, containment-, lease-, file-identity-, and exact-image-bound private FFmpeg/FFprobe pair is absent/blocked.
- Implementation, attack-test, repeated-output, and public-redaction conclusions remain pending until Root fills the completion block from actual accepted runs.
- Playable output, exact frame/sample duration, metadata sanitation, native-audio behavior, codec/license provenance, and target-market patent/legal approval remain later runtime, GPU, file, and Human release gates.

## Contract, API, registry, lockfile, and resource impact

This evidence document does not change a schema, Alpha recipe, component manifest, capability catalog, public application API, task registry, WBS, root package, or lockfile. It creates no selection or execution authority. P1-DET-011 uses no `GPU-H3`, `COMFY-DESKTOP`, `WIN-VM`, `MODEL-DOWNLOAD`, `SCHEMA`, or `ROOT-LOCKFILE` resource lock.

## Risks and next dependencies

- External PyAV and ambient FFmpeg can drift independently of the tool; their observations must never be cached as approval or selected as fallback.
- Exact codec/container listings do not resolve codec-license or target-market patent questions. FFmpeg distribution, signer, SBOM/NOTICE, and legal approval remain release gates.
- Safe process-tree closure and exact spawned-image verification require the approved production process/native-helper boundary; a test-double success is not native runtime proof.
- P1-WF-013 must separately prove the user-initiated Core/PyAV five-second output path with playable H3 native audio. P1-WF-014 must separately prove output metadata sanitation.
- After implementation evidence is complete and Root accepts P1-DET-011, its sanitized result can feed P1-DET-012. LONG-009 may consume a verified private-media-tool capability only after its other dependencies and a separately accepted recipe/media plan are satisfied.

Until then, the safe outcome is unchanged: Core/PyAV remains the declared short-output path, external/ambient observations are not selectable, and private FFmpeg remains blocked.
