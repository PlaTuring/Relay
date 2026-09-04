# Brand, MiniMax H3 Attribution, and AI Disclosure Boundary

> Task: `P0-GOV-009`  
> Status: machine-checkable draft; Human/legal decisions are `blocked_external`  
> Scope: policy separation and deterministic technical verification only

## 1. Fixed product boundary

I only implement installation, detection, configuration, workflow compilation, deterministic orchestration, or technical verification. MiniMax H3 generates the actual video and audio inside ComfyUI.

This contract does not authorize the tool to generate media, create a brand asset, write or expand a prompt, invoke inference, or submit the user's first formal ComfyUI queue job. It defines three presentation-policy layers that downstream implementation must keep separate.

## 2. The three layers

| Layer ID | Purpose | Release enforcement | User-disable behavior | Current decision authority |
|---|---|---:|---|---|
| `user_brand` | Optional owner-supplied name, logo, or watermark treatment | Optional | May disable only itself | `EXT-BRAND-ASSET`; Human brand/product owners |
| `minimax_h3_attribution` | Identify MiniMax H3 in the applicable commercial UI | `mandatory_when_applicable`; applicability is external | Must not be user-disableable once applicable | `EXT-H3-LICENSE`; Human legal/product owners |
| `ai_generated_disclosure` | Apply a clear/prominent machine-generated disclosure when public-environment use is applicable | `mandatory_when_applicable`; applicability is external | Must not be user-disableable once applicable | `EXT-H3-LICENSE`; Human legal/product owners |

The last two rows are separate obligations even though they currently reference the same external gate. Naming MiniMax H3 is not an AI-generated disclosure; an AI-generated disclosure is not MiniMax H3 attribution. User branding is neither.

No approved brand asset, attribution copy, disclosure copy, placement, territory, release subject, or legal interpretation is contained in this draft.

### 2.1 Official-source fact boundary

The following are source facts encoded for review, not Agent legal acceptance:

- The official [MiniMax H3 model card](https://huggingface.co/MiniMaxAI/MiniMax-H3) declares `minimax-h3-community-license-agreement`.
- Section III.3(b) of the official [MiniMax H3 LICENSE](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE) is introduced by `You are encouraged to`. A file-level `file_ai_generation_identifier` is therefore encoded as `encouraged`, enabled by recommendation by default, and user-configurable. It is not encoded as a mandatory watermark or media mutation.
- Section III.1's Agreement-copy condition, Section III.4's NOTICE condition for covered non-Hosted-Service third-party distribution, Applicable Territory/commercial terms, and Exhibit A.12's public-environment machine-generated disclosure restriction are encoded as `mandatory_when_applicable`. Human/legal owners must decide whether each condition applies to an exact release.
- Exhibit A.12 public-environment disclosure is distinct from the encouraged file identifier. Neither is an optional user brand asset, and neither can be satisfied merely by MiniMax H3 UI attribution.
- The [Qwen3-VL-32B-Instruct model card](https://huggingface.co/Qwen/Qwen3-VL-32B-Instruct) separately declares `apache-2.0`. That component fact must not be inherited as, substituted for, or used to determine the MiniMax H3 license.

The upstream `main` pages are mutable; release evidence must freeze the reviewed versions/hashes and re-run Human/legal applicability review.

## 3. Binding invariants

### `BOUNDARY-LAYER-001` — exact independent layer set

The policy has exactly the three layer IDs above. Each has its own decision record. Decision IDs may not be shared, and one decision may not imply that another decision is closed.

### `BOUNDARY-SUBSTITUTE-002` — no cross-layer substitution

For every ordered pair of different layers, the source is forbidden from substituting for the target. This is a complete six-pair matrix, not a list of selected examples.

Examples that must fail closed include:

- treating a customer logo as MiniMax H3 attribution;
- treating “made with MiniMax H3” as the complete AI-generated disclosure;
- treating an AI disclosure badge as the customer's brand layer.

### `BOUNDARY-DISABLE-003` — no cross-layer disablement

For every ordered pair of different layers, the source is forbidden from disabling, masking, deleting, covering, weakening, or conditionally switching off the target. The optional brand layer may disable only itself. Attribution and public-environment disclosure are not user-disableable when their externally decided conditions apply.

### `BOUNDARY-NOOP-004` — missing brand asset is valid

An absent user brand asset is a valid `no_op`. The workflow or release finalizer continues without user branding and preserves both `minimax_h3_attribution` and `ai_generated_disclosure` as protected conditional layers. Brand presence, absence, or self-disable also leaves the encouraged/default-recommended file identifier policy unchanged; only an explicit user setting may configure that recommendation. The tool must not generate a temporary logo, wordmark, watermark, branded placeholder, file identifier, or disclosure media treatment in this task.

### `BOUNDARY-EXTERNAL-005` — Agents cannot approve policy

All three decision records remain `blocked_external`. Agents may prepare evidence and validate structure, but may not:

- close `EXT-BRAND-ASSET` or `EXT-H3-LICENSE`;
- supply approved brand or legal copy;
- change the authority from `human_external`;
- convert missing approval evidence into a release-ready claim.

An external release remains blocked until the applicable Human owners approve the exact release artifact, version, region, wording, placement, and evidence. A validator pass proves only that the draft preserves separation.

### `BOUNDARY-LICENSE-006` — normative strength cannot drift

The machine policy preserves two different strengths:

- `file_ai_generation_identifier`: `encouraged`, `default_recommended`, and `user_configurable`;
- `public_environment_machine_generated_disclosure`: `mandatory_when_applicable` and fail-closed when an applicable public release lacks disclosure.

Validation rejects both encouraged-to-mandatory drift and mandatory-when-applicable-to-optional drift. Brand state cannot alter either policy, and MiniMax H3 attribution cannot substitute for either. The validator records other conditional distribution/territory/commercial obligations without deciding their applicability.

### `BOUNDARY-CLOSED-007` — authority-bearing records are structurally closed

The canonical machine policy uses exact key sets, not extensible property bags. Before semantic validation, the validator rejects every unknown or missing key at the top level and in:

- `product_boundary`;
- the official-source map and each source record;
- layer records, the independence object, and every independence pair;
- `brand_absence` and `release_requirements`;
- the license-policy object, applicability record, and every obligation record;
- every external decision and validation case.

Unknown queue, generation, auto-run, auto-prompt, replacement, disablement, exception, or approval fields fail with the owning object's exact `STRUCTURE.*.UNKNOWN_KEY` code. This prevents a future reader from treating an unvalidated extension field as authority. Adding a legitimate field requires a reviewed contract-version change, a canonical key-set update, and positive and hostile fixtures.

## 4. State truth table

This table describes structural policy behavior. It does not close an external release gate.

| User brand state | H3 attribution layer | Public-environment disclosure layer | File identifier policy | Structural result |
|---|---|---|---|---|
| Asset absent | Preserved conditionally | Preserved conditionally | `default_recommended` | Valid brand `no_op`; external authority still blocked |
| Asset present and enabled | Preserved conditionally | Preserved conditionally | `default_recommended` | Independent policies; external authority still blocked |
| Asset present but user-disabled | Preserved conditionally | Preserved conditionally | `default_recommended` | Valid self-disable of brand only; external authority still blocked |
| Any state | Missing when applicable | Preserved | Unchanged | Fail closed; brand/disclosure cannot replace attribution |
| Any state | Preserved | Missing when applicable | Unchanged | Fail closed; brand/attribution/file identifier cannot replace disclosure |

Output metadata sanitation is an adjacent release requirement, not a fourth branding layer and not a substitute for any layer in this contract.

## 5. Machine-checkable draft

The canonical fixture is `tests/fixtures/governance/branding/boundary-policy.valid.json`. It records:

- the exact layer set and each layer's separate decision ID;
- all six non-substitution pairs and all six non-disablement pairs;
- the valid brand-absent `no_op` and the two protected layers it preserves;
- the official source declarations, separate H3/Qwen provenance, and six release-policy obligations with exact normative strength;
- the encouraged/default-recommended/user-configurable file identifier, distinct from conditionally mandatory public-environment disclosure;
- exact closed key sets for every authority-bearing object and record, with no permissive unknown-field path;
- three external decision records with null approval policy/evidence;
- deterministic structural cases proving absent, present, and self-disabled branding do not alter attribution, disclosure, or the file-identifier recommendation.

The validator is dependency-free and performs no network, media, prompt, inference, or application action:

```powershell
node .\tests\fixtures\governance\branding\validate-branding.mjs
```

Hostile fixtures under `tests/fixtures/governance/branding/hostile/` must each fail with their exact declared rule code. They cover both known-field semantic drift and unknown-field authority smuggling. Files are sorted before evaluation; the report contains no timestamps or machine-specific paths, so identical inputs produce byte-identical output.

## 6. Downstream contract

- `REL-001` may add a schema no-op representation, but no-asset must remain valid and must not change H3, Runner, attribution, or disclosure contracts.
- `REL-002` may integrate only owner-supplied assets after `EXT-BRAND-ASSET` is closed by its Human owner.
- `REL-003` must enforce H3 attribution and AI disclosure independently; the brand layer has no authority over either.
- A future file-identifier implementation remains separate from `REL-003`, must honor the Human-approved release policy and explicit user configuration, and is not implemented by this task.
- Any future change that merges layers, conflates Qwen/H3 licenses, changes normative strength, adds cross-layer replacement/disable authority, embeds unapproved copy, or self-closes a Human gate requires review and must fail the current validator.

## 7. Evidence classification

- **Proven by this task:** the draft and hostile corpus are machine-checkable and deterministically enforce separation, no-op, source-strength, provenance non-conflation, and non-delegation invariants.
- **Official-source fact, mutable upstream:** the current model-card license declarations and cited LICENSE clause structure; release evidence still needs immutable snapshots/hashes.
- **Blocked external:** clause applicability, brand asset approval, MiniMax H3 attribution wording, public-environment disclosure wording, file-identifier default presentation, placement, territory, and release approval.
- **Not claimed:** legal sufficiency, brand approval, release certification, or runtime/UI integration.
