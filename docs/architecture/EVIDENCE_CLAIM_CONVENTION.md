# Evidence level and claim registry convention

> Task: `P0-GOV-005`  
> Status: Proposed worker deliverable; Root acceptance is still required  
> Scope: governance claim records, offline technical verification, and public-claim eligibility  
> Non-goal: this convention grants no install, download, launch, inference, media, or ComfyUI queue authority

## 1. Boundary and purpose

An evidence claim records what is known, the exact scope in which it is known, why it is known, when the evidence stops being current, and whether the claim may be presented as Stable or as a public experimental claim. It is not a capability catalog, recipe, release approval, or execution command.

The tool still only installs, detects, configures, compiles workflows, performs deterministic orchestration, and hands a workflow to ComfyUI. MiniMax H3 is the only component that generates video and native audio, inside ComfyUI after the user clicks Run. A claim record cannot submit `/prompt`, start inference, create prompts, download runtime assets, call a cloud/Partner API, or authorize a first formal queue job.

This file defines the governance convention. `tests/fixtures/governance/claims/validate-claims.mjs` is an offline, dependency-free executable specification for the exact `1.0.0` fixture form. It is not a replacement for a later Contract-Owner JSON Schema or for cross-language production validation.

## 2. Separate state machines

The following concepts must never be collapsed into one status:

| Concept | Vocabulary | Meaning |
|---|---|---|
| Evidence level | `proven`, `inferred`, `poc_pending`, `experimental` | Strength and limits of the evidence supporting one scoped claim |
| Product capability state | `hidden`, `poc_pending`, `internal`, `certified`, `experimental` | Product exposure state from the Alpha capability matrix |
| Human/External gate state | `open`, `partial`, `closed` | Decision state controlled by the named non-Agent owner |
| Claim eligibility | Stable boolean, public boolean, and public tier | Derived permission to make a scoped product claim; never an execution permission |

`proven` does not imply `certified`, Stable, public, runnable, selected, or approved. A repeatable technical result can remain internal because a license, hardware, signing, privacy, distribution, or Human review gate is open. Conversely, a closed Human gate cannot turn weak or expired technical evidence into `proven`.

## 3. Evidence levels

| Level | Required basis | Stable eligibility | Public eligibility |
|---|---|---|---|
| `proven` | At least one hash-resolved direct test or accepted PoC in the exact scope, repeatable with at least two successful attempts and no failed attempt in that proof source | Possible only while current, active, complete, and all required gates have current independent closure | Possible as `stable` under the same conditions |
| `inferred` | At least one immutable source plus explicit inference basis; direct repeatability is absent or insufficient | Never | Never for a product availability/performance claim; public process transparency is outside this eligibility bit and must not imply availability |
| `poc_pending` | Explicit missing proof requirements; evidence sources may be empty | Never | Never |
| `experimental` | At least one direct scoped observation, explicit limitations, and outstanding validation requirements | Never | Possible only as `experimental`, advanced-only, default-off, with an explicit not-Stable disclosure and safe fallback, while current and all applicable gates are closed |

Unknown evidence levels fail closed. They are not mapped to the nearest known level. Evidence that is missing, expired, not-yet-observed, revoked, hash-drifted, outside scope, or backed by an incomplete gate set cannot be Stable or public.

## 4. Exact claim-record form

The fixture registry follows ADR-004 identity and integrity conventions:

```json
{
  "contract_id": "minimax-h3-tool.evidence-claim-registry",
  "schema_version": "1.0.0",
  "document_id": "00000000-0000-4000-8000-000000000000",
  "document_revision": 1,
  "registry_id": "CLAIM-REGISTRY-SYNTH-001",
  "records": [],
  "integrity": {
    "profile": "rfc8785-sha256-v1",
    "content_sha256": "sha256:<64 lower-case hex>"
  }
}
```

Every record is closed and contains:

- `claim_id` and a machine-oriented `claim_code`; free-form marketing text is deliberately outside the authority record;
- `subject.kind`, `subject.subject_id`, `subject.component_id`, `subject.scope_id`, an exact immutable subject revision, and subject artifact hash;
- `evidence.level`, immutable `source_refs`, level-specific basis/pending/limitation codes, and a freshness window;
- an immutable gate-requirement catalog reference, a completeness assertion, and the exact Human/External gate set selected from that catalog;
- lifecycle state, the mandatory downgrade/withdrawal policy, optional experimental presentation controls, and derived eligibility assertions.

Operational consumers must use an exact registered version/digest. Unknown fields and unknown enum values fail closed. Claim records contain no private absolute paths, prompts, tokens, media, executable instructions, URLs that are treated as fetch authority, or queue intent.

## 5. Sources, revision, hash, and scope

Every non-empty source reference has the closed fields `source_id`, `source_kind`, `locator`, `publisher`, `immutable_revision`, and `artifact_sha256`.

- A fixture locator is claim-directory-relative under `sources/`; production resolvers must provide an equivalent allowlisted, non-network authority resolver.
- `immutable_revision` is an exact `git:<40 hex>`, `version:<MAJOR.MINOR.PATCH>`, `decision:<id>`, or `fixture:<id>`. `main`, `latest`, `HEAD`, ranges, and mutable channels are invalid.
- `artifact_sha256` is the raw-byte SHA-256 of the resolved source. It is not a signature, license approval, ownership proof, or delete authority.
- The source document identity, publisher, revision, kind, raw hash, and covered `scope_id` must all match. A source from a neighboring version/profile does not support the claim.
- `proven` requires a qualifying direct source; prose, screenshots, a single success, an upstream support sentence, or a self-declared status do not qualify.

### 5.1 Component and legal-modality scoping

License and public-obligation claims are never inherited from an aggregate package, neighboring component, encoder, model card, or repository badge. Every such claim binds all of the following into its identity:

```text
component_id
scoped subject immutable revision + artifact hash
source_id + source raw-byte hash
clause_id + exact source-text-fragment hash
statement_code
source_modality
condition_code
```

The source modality vocabulary is closed: `declarative`, `encouraged`, `must`, `must_when_condition`, `prohibited`, `permitted`, and `optional`. A producer must preserve the exact source modality and condition. In particular, `encouraged` cannot be promoted to `must`, and `must`/`must_when_condition` cannot be weakened to `optional` or stripped of its condition. Any reinterpretation requires a separately reviewed legal claim; it cannot overwrite the source-wording claim.

The convention fixture pins the currently reviewed official repository revisions and records only source wording facts:

- MiniMax H3 revision `5d9b308a59ab12e67147f191e184baf704185bd1` identifies `minimax-h3-community-license-agreement`. Its LICENSE treats the Section III.3(b) file AI-generation identifier as `encouraged`, while the Agreement-copy and non-Hosted distribution NOTICE clauses are conditional requirements; Exhibit A.12 separately contains a conditional public-environment machine-generated disclosure restriction. See the [pinned MiniMax H3 commit](https://huggingface.co/MiniMaxAI/MiniMax-H3/commit/5d9b308a59ab12e67147f191e184baf704185bd1) and [LICENSE](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/5d9b308a59ab12e67147f191e184baf704185bd1/LICENSE).
- Qwen3-VL-32B-Instruct revision `0cfaf48183f594c314753d30a4c4974bc75f3ccb` separately identifies `apache-2.0`. See the [pinned Qwen commit](https://huggingface.co/Qwen/Qwen3-VL-32B-Instruct/commit/0cfaf48183f594c314753d30a4c4974bc75f3ccb).

Those records do not decide applicability, satisfy NOTICE/disclosure duties, or close `EXT-H3-LICENSE`. They only ensure exact component/source/modality preservation pending a Human legal decision.

Fixture source packs are explicitly synthetic. Their successful validation proves the convention/validator behavior only; they prove no H3 model, GPU, runtime, license, Desktop, signing, distribution, or media capability.

## 6. Freshness and expiry

`freshness` contains exact UTC-millisecond `observed_at_utc` and `expires_at_utc` timestamps plus the complete revalidation trigger set:

```text
evidence_expiry
gate_reopened
reproducibility_failure
scope_changed
source_hash_drift
upstream_revision_changed
```

`expires_at_utc` must be later than `observed_at_utc`. Eligibility is evaluated against a caller-owned time; a claim record cannot choose its own clock. The offline fixture harness pins `2026-08-27T12:00:00.000Z` so repeated summaries are byte-identical. A production evaluator must supply a trusted current UTC time.

At or after expiry, before observation time, or after any listed trigger, Stable/public presentation is withdrawn immediately and the evidence level is treated as `poc_pending` until a new immutable record is reviewed. Editing the old record's timestamps or hashes is forbidden.

## 7. Human and External gates

The record never invents its own required gate set. `gate_requirements.requirements_source_ref` resolves to an immutable catalog whose exact `requirement_key + scope_id` determines all required gate IDs and types. The record set must match it exactly.

- `open` and `partial` gates have no closure decision and block Stable/public claims.
- `closed` requires a hash-resolved immutable decision whose gate, type, scope, decision state, owner class, and validity window match.
- A Human gate must be closed by a `human_owner`; an External gate by an `external_owner`. An Agent-produced decision can be preserved as raw input but can never close either gate.
- Expired, unknown, mismatched, self-issued, or missing decisions block Stable/public eligibility.
- Fixture `EXT-SYNTH-*` and `HUM-SYNTH-*` identifiers are test-only and never alter `docs/EXTERNAL_GATES.md` or the live registry.

## 8. Eligibility derivation

Eligibility fields are assertions checked against source bytes and policy, not authority supplied by the producer.

| Requested result | Necessary conditions |
|---|---|
| `stable_eligible: true` | level `proven`; qualifying repeatable proof; current freshness; active lifecycle; complete exact gate set; every required decision independently closed and current |
| `public_claim_eligible: true`, tier `stable` | all Stable conditions and level `proven` |
| `public_claim_eligible: true`, tier `experimental` | level `experimental`; current direct evidence; active lifecycle; complete/current independently closed gates; advanced-only/default-off/not-Stable disclosure/fallback controls |
| either boolean `false` | deterministic blocker codes exactly equal the recomputed ordered blocker list |

Blockers are ordered lifecycle → freshness → missing evidence → evidence level → gate completeness/state/decision. This order is stable so two evaluators produce the same arrays and normalized error tuple.

Neither eligibility bit authorizes installation, workflow execution, artifact selection, model reuse, release, or queue submission. Downstream capability/recipe/release contracts must independently pass their own exact gates.

## 9. Revocation and downgrade

An active record has no revocation decision. A revoked record requires a hash-resolved governance decision bound to the exact `claim_id`, action `revoke`, effective time, and `downgrade_to: poc_pending`. Revocation immediately adds `claim_revoked` to both blocker lists.

Every record carries this fail-closed policy:

```text
on_expiry                  -> poc_pending
on_source_drift            -> poc_pending
on_scope_change            -> poc_pending
on_gate_reopen             -> poc_pending
on_reproducibility_failure -> poc_pending
on_revocation              -> poc_pending
public_withdrawal          -> immediate
```

Promotion or revalidation creates a new immutable claim record/source revision. A consumer must not silently rewrite an old revoked/expired record, delete unknown fields to make it pass, or retain a cached Stable/public badge after a downgrade trigger.

## 10. Deterministic validator and fixtures

The validator uses Node built-ins only. It performs strict UTF-8/duplicate-key/integer/closed-object checks, root JCS integrity validation, raw source hashing and containment, level rules, time evaluation, gate catalog/decision resolution, revocation checks, eligibility recomputation, exact negative error tuples, and public-evidence hygiene checks.

From the repository root:

```powershell
node .\tests\fixtures\governance\claims\validate-claims.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File .\tasks\validate_wbs.ps1
```

The valid registry covers every evidence level plus open-gate, expired, revoked, and component-scoped source-wording records. Files under `cases/` are bounded JSON-Pointer mutations and must fail with one exact `(code, instance_path, rule_id)` tuple. The hostile set includes cross-component license inference, source-wording hash drift, `encouraged → must`, and `must_when_condition → optional`. The harness refreshes root integrity after a mutation so domain failures are not masked by an incidental integrity error.

## 11. Evidence conclusion and limits

- **Proven by this task after two byte-identical successful runs:** the local `1.0.0` convention fixture is deterministic, all four evidence levels are distinguished, referenced source bytes/revisions/hashes are checked, and the hostile corpus fails exact rules.
- **Inferred/design input:** downstream Contract Owners can materialize the convention in shared schemas without changing its truth model.
- **Still pending/external:** any real H3/runtime/hardware/license/signing/Desktop/distribution/public capability claim, production cross-language equivalence, trusted-time integration, signatures, and live gate-owner decisions.
- **Fallback:** unknown, stale, incomplete, or unresolved records remain non-Stable and non-public; downstream capability stays hidden, internal, or `poc_pending` as its own contract requires.
