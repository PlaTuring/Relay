# External Distribution Evidence Checklist

> Task: `P0-GOV-008`  
> Machine index: `tests/fixtures/governance/distribution-evidence/index.valid.json`  
> Validator: `tests/fixtures/governance/distribution-evidence/validate.mjs`  
> Current conclusion: the checked-in baseline is structurally valid and **release-blocked**. It approves no artifact, license interpretation, certificate, brand asset, signature, hardware profile, claim, installer, or release.

## 1. Fixed product and authority boundary

> I only implement installation, detection, configuration, workflow compilation, deterministic orchestration, or technical verification. MiniMax H3 generates the actual video and audio inside ComfyUI.

This checklist indexes evidence for a Windows installer/configurator and ComfyUI workflow compiler. It grants no download, installation, execution, queue submission, media mutation, signing, or publication authority. MiniMax H3 remains the only video/native-audio generator, inside ComfyUI, after the user clicks **Run**.

An Agent may collect, index, validate, and recommend. Only an identified Human/External owner may accept a legal, certificate, brand, signing, or release decision. A structurally valid packet can—and the baseline does—remain non-releasable.

## 2. Machine contract

The index has seven independent layers:

1. `brand_boundary` fixes software-only branding and denies all generated-media/output branding authority.
2. `authority_policy` fixes Agent preparation authority and the five Human-only decision kinds.
3. `external_gates` mirrors all ten accepted `EXT-*` gates as `OPEN | PARTIAL | CLOSED` without changing `docs/EXTERNAL_GATES.md`.
4. `human_decisions` keeps legal, certificate, software-brand, signing, and release acceptance separate from technical evidence.
5. `license_records` keeps MiniMax H3 agreement/obligation records separate from the Qwen upstream license declaration and locks source-stated modality.
6. `components` contains the eleven non-conflatable evidence packets.
7. `public_claims` and `release_candidate` derive whether evidence may support an external claim; a producer cannot make release true merely by setting a Boolean.

Every component packet has closed fields for:

```text
source locator + immutable revision + source-record hash
artifact name + length + SHA-256
release binding + exact component/release artifact hashes + VM-qualified installer hash
creator/publisher/packager provenance chain
license expression + LICENSE hash + NOTICE hash + Human decision
signature requirement + exact signed-artifact hash + verification/timestamp reports
required tests + environment + attempts/passes + report hashes
claim status + expiry + limitations + release support
Human owner + scoped decision IDs
external gate IDs + explicit blockers
```

Unknown operational fields fail. `main`, `master`, `latest`, `nightly`, `HEAD`, or other mutable aliases cannot be a proven revision. A digest does not become Authenticode, a technical pass does not become legal approval, and a source declaration does not prove applicability to the target entity, territory, delivery mode, or release artifact.

Every accepted Human decision is bound to the exact target stage, legal entity, territories, delivery modes, component/capability scope, release artifact SHA-256, and a canonical SHA-256 projection of the indexed evidence set. Component claim IDs, Human decision IDs, public-claim component/gate/decision dependencies, and the hostile case set are exact machine sets rather than advisory lists.

## 3. Required packet coverage

These IDs are exact and exhaustive. Removing, duplicating, renaming, or merging one fails validation.

| Packet ID | Separate subject | Required distribution evidence | Human/external gate | Baseline disposition |
|---|---|---|---|---|
| `h3-model` | MiniMax H3 plus separately identified model-file dependencies | per-file source/revision/length/hash/provenance; H3 agreement/AUP/territory/commercial scope; Qwen separation; attribution/disclosure; profile test | `EXT-H3-LICENSE` | included but blocked |
| `comfyui-core` | managed ComfyUI Core | exact Core revision/artifact; modifications; GPL text/source offer/NOTICE; process boundary; offline runtime test | `EXT-COMFY-CORE` | included but blocked |
| `comfyui-frontend` | locked frontend and templates | exact independent frontend/template revisions and hashes; no-`latest`; modifications/source/NOTICE | `EXT-COMFY-FRONTEND` | included but blocked |
| `h3-long-video-runner` | first-party Runner/frontend extension | source/build identity; architecture ADR; process/license boundary; no-first-queue and no-requeue tests | `EXT-RUNNER-DIST` | excluded and blocked |
| `pyav-runtime` | PyAV wheel and linked media libraries | exact wheel/version/hash; linked-library inventory; codec/metadata/output-path probe; license/NOTICE | `EXT-FFMPEG` for the selected media stack | included but blocked |
| `private-ffmpeg-cli` | private FFmpeg/FFprobe binaries | exact binaries/version/hash; `-buildconf`; enabled codecs; LGPL/GPL/nonfree determination; source/build materials; market review | `EXT-FFMPEG` | excluded and blocked |
| `restricted-comfy-cli` | optional restricted CLI route | exact wheel/version/hash; separate-process boundary; command allowlist; explicit local workspace; no token/cloud/telemetry/egress/runtime-download tests | `EXT-COMFY-CLI` | excluded and blocked |
| `native-helper` | packaged first-party native executable | immutable source/build record; ABI/threat contract; protocol fuzz; packaged identity; exact Authenticode/RFC3161 evidence | `EXT-SIGNING` | included but blocked |
| `windows-signing` | certificate, publisher, key custody and timestamp evidence | organization certificate; publisher; custody/access; RFC3161 sign/verify; revocation/renewal; helper/installer/updater/uninstaller coverage | `EXT-SIGNING` | included but blocked |
| `windows-installer` | exact `.exe`/`.msi` release package | frozen inputs; package length/hash; SBOM/NOTICE; Authenticode/timestamp; offline/no-updater; install/upgrade/rollback/uninstall | applicable legal gates + `EXT-SIGNING` + `EXT-HARDWARE` | included but blocked |
| `windows-vm-qualification` | exact Windows release-qualification report | VM image/OS build/hardware provenance; exact installer hash; repeat runs; Unicode/space paths; C-drive budget; offline/egress; retained-data uninstall | `EXT-HARDWARE`, `EXT-SIGNING` | included but blocked |

PyAV and private FFmpeg are deliberately separate. ComfyUI Core, frontend/templates, and Runner are deliberately separate. Exclusion of a conditional packet is explicit; omission is never interpreted as approval.

## 4. Immutable license-record separation

The following records reflect official-source facts supplied and verified by Root for this task. They are questions and evidence requirements for Human/legal review, not an Agent legal conclusion.

| Record ID | Subject | Declared source fact | Official locator | Current state |
|---|---|---|---|---|
| `minimax-h3-community-license-agreement` | MiniMax H3 | repository declares `minimax-h3-community-license-agreement` | [MiniMax H3 repository](https://huggingface.co/MiniMaxAI/MiniMax-H3) | `blocked_external` |
| `minimax-h3-license-notice-obligations` | MiniMax H3 LICENSE/NOTICE | separate immutable evidence for Agreement-copy, modified-file notice, NOTICE, Applicable Territory and commercial-term review | [MiniMax H3 LICENSE](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE) | `blocked_external` |
| `minimax-h3-ai-generation-identification` | MiniMax H3 generated-content identification | separate immutable evidence for III.3(b) file identifier and Exhibit A.12 public-environment disclosure | [MiniMax H3 LICENSE](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE) | `blocked_external` |
| `qwen3-vl-32b-instruct-apache-2.0` | Qwen3-VL-32B-Instruct | upstream repository separately declares `Apache-2.0`; it must not inherit the H3 agreement record | [Qwen3-VL-32B-Instruct repository](https://huggingface.co/Qwen/Qwen3-VL-32B-Instruct) | `blocked_external` |

Each record needs its own immutable upstream revision, content SHA-256, exact applicability to the release entity/territories/delivery modes, and Human/legal review. Until all four are present, its evidence state must be exactly `blocked_external`; `unknown`, `proven`, or a repository badge cannot support distribution.

### H3 modality lock

The validator pins these source-stated modalities so a later summary cannot silently turn a recommendation into a requirement or a requirement into a recommendation:

| Obligation ID | Source section | Locked modality | Applicability boundary |
|---|---|---|---|
| `h3-agreement-copy` | III.1 | `must` | conditional on the covered third-party distribution; Human/legal determines the exact release applicability |
| `h3-modified-file-notice` | III.2 | `must` | conditional on modifying covered files; Human/legal determines the exact release applicability |
| `h3-notice-file` | III.4 | `must` | conditional on the covered third-party non-hosted distribution; immutable prescribed NOTICE text is still required as evidence |
| `h3-file-ai-generation-identifier` | III.3(b) | `encouraged` | it is not represented as mandatory |
| `h3-public-environment-machine-generated-disclosure` | Exhibit A.12 | `must` | conditional on the covered public-environment use; Human/legal determines applicability |
| `h3-applicable-territory-commercial-terms` | Applicable Territory and commercial terms | `human-review-required` | no Agent may decide territorial or commercial authorization |

The file identifier and public-environment disclosure are distinct obligations. Software branding has no generated-media authority and cannot replace either obligation; the `encouraged` III.3(b) file identifier must not be promoted to `must`.

## 5. Software-brand boundary

The only brand capability in this contract is `CAP-SOFTWARE-BRANDING`:

```text
software_brand_only=true
media_branding_authority=false
allowed: software name, software logo, author attribution, About page, installer
forbidden: generated media, output watermark, media mutation
```

`EXT-BRAND-ASSET` and `HUM-BRAND` govern only those software presentation surfaces. No user media/output watermark capability exists. MiniMax H3 attribution, LICENSE/NOTICE obligations, and conditional AI disclosure remain independent legal/product requirements; software branding cannot disable, replace, or visually stand in for them.

The retired media-brand capability identifier is forbidden anywhere in the packet. A software-brand claim may support a release only after its exact Human brand decision and `EXT-BRAND-ASSET` scope close; even then, the two Boolean boundary values above cannot change.

## 6. Status and authority semantics

Evidence status and publication status are different dimensions:

| Layer | Values | Release-supporting value |
|---|---|---|
| Evidence | `unknown`, `blocked`, `blocked_external`, `proven` | only `proven`, with all referenced Human decisions accepted |
| Component claim | `unknown`, `blocked`, `inferred`, `poc_pending`, `experimental`, `proven` | only `proven` |
| Public claim | `unknown`, `blocked`, `hidden`, `poc_pending`, `internal`, `experimental`, `certified` | `certified`, or a fully scoped advanced `experimental` claim |
| External gate | `OPEN`, `PARTIAL`, `CLOSED` | only scoped `CLOSED` with Human owner and decision/scope hashes |
| Human decision | `unknown`, `blocked`, `accepted`, `rejected`, `expired` | only Human/External `accepted` with a decision-record hash |
| Release candidate | `blocked`, `candidate`, `approved` | only `approved` plus an accepted scoped release decision |

`blocked`, `blocked_external`, and `unknown` never support release. `inferred`, `poc_pending`, `internal`, and raw test success also never support an external component claim. Expiry, artifact drift, revision drift, license change, legal entity/territory change, delivery-mode change, certificate revocation, signer change, component-set change, or claim change triggers revalidation.

A release-supporting component or public claim requires a calendar-valid UTC millisecond expiry. The VM retained-data repeatability result requires at least two passing attempts on the same exact qualified installer binding; a one-attempt “repeatability” report fails.

The Human-only records are:

| Decision ID | Authority | Agent limit |
|---|---|---|
| `HUM-LEGAL-DISTRIBUTION` | legal/open-source compliance owner | Agent cannot approve license, territory, commercial, patent, source-offer, NOTICE, or combination conclusions |
| `HUM-CERTIFICATE` | organization administrator | Agent cannot purchase/request the certificate, choose the legal publisher, or treat self-signing as public trust |
| `HUM-BRAND` | software brand/product owner | Agent cannot create or approve official software brand assets/presentation, and receives no media/output branding authority |
| `HUM-SIGNING` | authorized release owner | Agent may prepare sign/verify automation but cannot accept signer, timestamp, key custody, or coverage |
| `HUM-RELEASE` | authorized release owner | Agent cannot approve, publish, or convert a candidate into a release |

The validator rejects explicit Agent, bot, automation, Codex, or worker identities in an acceptance/owner field. Identity strings and record hashes are necessary evidence, not proof that the asserted Human is authorized; Root/release review still verifies that external fact.

## 7. Fail-closed release computation

`supports_external_distribution=true` is valid only when all applicable inputs support it:

```text
exact included component set (no undecided required component)
AND every included component has proven source/artifact/provenance/license/tests
AND every included component binds its exact artifact to the exact installer release hash
AND VM qualification binds its report and tested installer hash to that same release artifact
AND exact signature evidence or a permitted Human signing waiver
AND every component Human decision is accepted and scoped
AND every applicable external gate is CLOSED and scoped
AND the public installer claim is certified
AND exact installer and VM qualification packets support the same artifact hash
AND legal entity and territories are non-empty
AND HUM-RELEASE accepts that exact artifact, component set, entity, territories and claims
```

For native helper and installer executables, an Authenticode/RFC3161 requirement cannot be waived or satisfied with a SHA-256 digest. For an excluded Runner, private FFmpeg, or restricted CLI route, the corresponding capability must remain non-supporting/hidden. Enabling one reintroduces its exact component and external gate requirements.

The checked-in baseline intentionally contains null immutable revisions/hashes, empty test results, `OPEN` gates, unassigned Human owners, blocked decisions, and `supports_external_distribution=false`. This is the only honest positive fixture before external evidence exists. No synthetic “release-ready” Human approval is checked in.

## 8. Hostile fixture coverage

The deterministic mutation corpus proves rejection of:

- missing/duplicate packets and unknown operational fields;
- Core/frontend and PyAV/private-FFmpeg conflation;
- absent/mutable revision and malformed artifact hashes;
- Agent self-acceptance for legal, certificate, brand, signing, and release;
- Agent/bot substitution for a Human owner;
- `OPEN` gates, blocked decisions, blocked/unknown component claims, blocked public claims, and blocked tests supporting release;
- excluded Runner support, SHA-256 presented as Authenticode, and manual release booleans/labels;
- missing or conflated H3/Qwen license records;
- missing H3 NOTICE obligation;
- III.3(b) `encouraged → must` drift and Exhibit A.12 `must → encouraged` drift;
- missing immutable revision/content hash/applicability/Human review marked anything other than `blocked_external`;
- restricted CLI no-token/cloud/telemetry/egress evidence omission and VM qualification test omission;
- component license proof without an accepted Human legal decision.
- any attempt to set `media_branding_authority=true` or turn software branding into output watermark/media mutation authority.

The hostile filename/case-ID set is itself pinned; deleting or replacing a negative case makes the validator fail instead of silently lowering the reported hostile count.

## 9. Acceptance commands

Run from the repository root; the validator uses Node built-ins, reads only checked-in files, performs no network request, starts no ComfyUI/H3 process, installs/downloads nothing, touches no model/media/GPU/Desktop/VM, and writes nothing:

```text
node tests/fixtures/governance/distribution-evidence/validate.mjs
```

The stdout line begins with `DISTRIBUTION_EVIDENCE_VALIDATION_OK`, includes deterministic counts and the raw index SHA-256, and must be byte-identical across two consecutive runs.

The independent live WBS check is:

```text
powershell -NoProfile -ExecutionPolicy Bypass -File .\tasks\validate_wbs.ps1
```

It must exit `0` with a line beginning `WBS_VALIDATION_OK`. The current task does not edit the registry, WBS, schemas, package/test manifest, or lockfiles; Root may later add this standalone validator to a shared test manifest under separate ownership.

## 10. Downstream use and remaining external work

After Root accepts P0-GOV-008, this index is an input—not a release decision—for `QA-018`, `QA-019`, `QA-020`, `REL-003`, and `REL-005`. Those tasks must replace nulls with immutable, release-artifact-bound evidence and preserve every Human gate.

Current evidence conclusions:

- **Proven:** the checklist shape, exact category separation, authority policy, H3/Qwen license-record separation, modality locks, and fail-closed rules are deterministic local governance evidence.
- **Blocked external:** all real artifact revisions/hashes, H3/Qwen applicability, legal conclusions, certificate/publisher/key custody, signatures, installer identity, VM results, claims, and release approval.
- **Not claimed:** any commercial permission, regional availability, supported hardware, distributable build, valid signature, public brand asset, or publish decision.
