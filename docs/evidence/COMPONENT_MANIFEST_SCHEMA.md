# P0-CON-003 component manifest contract evidence

## Result

P0-CON-003 is complete as a contract-only deliverable. The component-manifest schema defines immutable artifact identity, provenance, licensing, role/destination, ownership and embedded application-catalog binding without implementing a downloader, installer, updater, launcher or delete operation.

Deterministic offline validation command:

```text
node tests/fixtures/contracts/component/validate.mjs
```

Observed result:

```text
PASS schema component-manifest sha256:62704fae90e6f9d1895a3d1351b8664f67222aedb8db390ab46e674394236608
PASS valid component-role-examples
SUMMARY schemas=1 valid_contracts=1 negative_cases=44 valid_mutation_cases=4
```

The validator additionally reported a pass for every named case and scanned all public contract evidence for a Windows `Users` absolute path. Two consecutive runs produced byte-identical stdout (`sha256:21b9d20b1693fbcf7f2e0e9d067b4b6837d554f8877ff2e6971d4b6dbfc98fb7`), and the same output was reproduced with `USERNAME=component`. Every checked-in JSON document under the allowed schema/fixture paths parsed successfully.

## Contract identities

- Schema ID: `urn:minimax-h3-tool:schema:component-manifest:1.0.0`
- Contract ID: `minimax-h3-tool.component-manifest`
- Valid fixture root content identity: `sha256:a886e46ee176eee2bfbda7ba66d2c9d89a095ebc816977dddeb89e564e21dc75`
- Synthetic license-record content identity: `sha256:248b7809e4beb7e2baee99c25ce07c7b6c94b51ab00cfbe78d39fa061e308ec6`
- Canonicalization profile: safe-integer RFC 8785 JCS profile with root `integrity` omitted

These identities describe the checked-in contract evidence only. They are not artifact approvals or upstream release identities.

## Enforced authority boundary

The manifest is immutable data embedded in exactly one application build. It explicitly grants no materialization, execution, ownership or deletion authority. A consumer must independently verify a signed build inventory binding the exact `(app_id, app_version, app_build_id, catalog_resource, integrity.content_sha256)` tuple and must accept exactly one embedded catalog. The requirement literal inside the manifest is not proof. Remote catalog discovery, runtime override and self-update are forbidden.

An immutable HTTPS artifact becomes merely eligible for a later explicit install transaction. A later consumer still needs all separate gates: app/build binding, approved license scope, role and destination match, available space, verified byte length and raw SHA-256, safe archive materialization, transaction commit and ownership-ledger commit. The schema never contains an absolute selected user path.

For an externally discovered model, an exact size/hash match proves identity only. It never grants ownership or delete authority and never changes the source to managed. The packaged manifest contains no runtime candidate ID, observation document reference or selected path; it declares only the requirement for a later model-selection contract to bind those exact values. The later match remains external read-only with `delete_authority: never` and requires handle-identity revalidation before every read. Managed artifacts separately require all five ordered transaction/ledger/containment/lease proofs before ownership can exist.

## Artifact and provenance invariants

Every component binds ID, version, role, Windows platform, architecture, release state, filename, MIME type, outer archive shape, expected length and raw SHA-256. Sources carry an immutable 40-hex revision and a locator that must be immutable HTTPS with that exact revision in its path, an embedded app-resource path, or external-match-only metadata. `latest`, `main`, mutable URL state and runtime retrieval are rejected.

Creator, publisher and packager are independent typed parties. Same-party relationships must be stated and must agree with party IDs and names. An ordered provenance chain begins with the creator, includes the publisher, ends with the packager, binds each input to the prior output, and ends at the exact source locator/revision and artifact identity. Every step independently passes the immutable locator rule. A byte-changing transformation uses exactly `created → named transform → packaged`; only the named middle step changes identity, and generic packaging preserves it. Producer identity binds the packager, exact SemVer 2.0.0, a closed `/(revisions|commits)/<revision>/source` or embedded equivalent locator, exact source revision and build-recipe hash. Its build ID must equal SHA-256 of the RFC 8785 JCS projection `{build_recipe_sha256, producer_id, producer_source_locator, producer_source_revision, producer_version}`. Direct probes reject `stable`, `nightly`, `release`, `trunk` and `main` as versions, reject channel-shaped producer paths, and accept ordinary and prerelease SemVer examples. Evidence items bind app-resource locators, lengths and hashes. Declared-unverified status requires pending evidence; verified release status requires verified source/package attestation; verified reproducible status requires a verified reproducibility report. Eligible release still requires verified evidence.

Fixed archives bind entry count, total expanded bytes, maximum entry bytes, entry-manifest SHA-256, canonical expanded-tree SHA-256 and a link/reparse-forbidden policy. The schema README fixes the interoperable JCS entry-manifest and length-delimited expanded-tree framing algorithms, including Windows case-insensitive collision rejection. These fields do not replace runtime inspection: a future materializer must re-enumerate entries, enforce all declared bounds and paths, recompute raw file hashes and verify both identities before commit. Native helpers and private media tools require signature metadata bound to the exact artifact; Authenticode is embedded in a single PE, while Minisign/OpenPGP require a separately hashed embedded signature resource. A future consumer must still perform trust-store verification before materialization.

## License and release invariants

License records bind embedded license text, embedded notice, redistribution requirements, license/notice inclusion, source-code obligations, attribution obligations, human review state and record disposition. Pending and rejected reviews are valid evidence states but cannot make a component eligible. An approved review is explicitly scoped to target regions, delivery modes, a reviewed artifact set and a reviewed provenance set. The schema README fixes both JCS set projections; the validator recomputes them across every referencing component, including producer build and provenance evidence/status, so any drift invalidates the scope. Agents, hashes and signatures cannot grant legal approval.

## Exact negative evidence

Forty-four negative cases cover all required hostile inputs and added trust-boundary attacks:

- missing length/hash and source/artifact size/hash conflict;
- `main` mutable source locator;
- role/artifact/destination mismatch, missing private-executable signature and stale signed-artifact binding;
- creator/packager ambiguity, missing publisher, missing producer/evidence identity, non-SemVer producer version, non-anchored producer locator, stale producer build-record hash, mutable intermediate origin, non-exact byte transformation, reproducible status without a report and broken provenance chain;
- absent human license decision, stale license-record content reference and stale human-reviewed artifact set;
- traversal, ADS, DOS device, absolute path, link/reparse intent and missing expanded-tree identity;
- duplicate/conflicting component ID and dependency cycle;
- unknown operational `auto_install` field;
- external artifact falsely marked tool-owned, external artifact routed into the managed root, runtime candidate identity embedded in the immutable manifest, and incomplete managed ownership proofs;
- remote catalog, wrong application binding and catalog self-attestation;
- revoked component incorrectly marked eligible, non-active manifest containing an eligible component, and eligible component with a non-actionable dependency;
- stale integrity combined with an unknown operational field, and a hostile null core shape normalized without a runtime exception.

Each case asserts an exact deterministic error code, instance JSON Pointer and stable rule ID. Four positive mutation cases cover display-only extension metadata, blocked revoked records, explicit same-party creator/publisher/packager identity and a synthetic content-bound approved-license branch. The validator pipeline is fixed to envelope/version → integrity → schema → domain → cross-component/actionability, so schema-hostile shapes never reach unsafe domain dereferences.

## Consumer obligations and pending evidence

This task does not prove any real upstream artifact, license, signature, model, URL or packaging decision. The valid fixture intentionally uses `.invalid` URLs, synthetic hashes, `pending_external` license review and `blocked` release states. Real catalog population remains gated on immutable upstream revisions, measured bytes, raw hashes, license-owner review, build-inventory signing and role-specific materialization PoCs.

A future consumer must fail closed if the schema/version is unsupported, the signed build inventory is unavailable, any source or artifact metadata drifts, the license scope does not cover the intended delivery, a dependency is missing/conflicting/cyclic, an archive violates bounds or path rules, a signature cannot be verified, or ownership/containment ledger proofs are absent.

No model was downloaded, no ComfyUI/H3/GPU process was started, no cloud or third-party API was called, and no installation, update, deletion or media-generation logic was added.
