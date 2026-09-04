# Download partial sidecar 1.0.0

This package defines and validates private mutable control state for one resumable artifact byte prefix. It is pure and offline: it imports only Node's hashing primitive and performs no filesystem or network operation. MiniMax H3 remains the only component that generates actual video and native audio, inside ComfyUI after the user clicks Run.

The sidecar is data, not authority. Every valid document contains exact `"none"` literals for network, download, verification, materialization, ownership, deletion, execution, and queue authority. `expected_bytes_received` means only that the recorded contiguous prefix length equals the manifest's expected artifact length. It does not mean that bytes exist on disk, match the expected SHA-256, are verified, are safe to extract, are owned, are materialized, may be deleted, may execute, or may enter a ComfyUI queue.

## Persistence and JSON profile

- Trust class: private mutable control state.
- Contract/schema: `minimax-h3-tool.download-partial-sidecar` / exact `1.0.0`.
- Exact RFC 8785-style JCS UTF-8 bytes, no BOM and no trailing newline.
- Duplicate keys, invalid UTF-8, unpaired surrogates, NUL, `-0`, fractional/exponent numbers, unsafe integers, noncanonical bytes, unknown fields, and documents over 64 KiB fail closed.
- Root integrity is `sha256(JCS(document with the entire root integrity property omitted))`, encoded as lower-case `sha256:<64 hex>`.
- `document_revision` is a positive safe integer and every accepted mutation increments it by exactly one. This package serializes/parses bytes but does not write files; the caller remains responsible for ADR-004 same-directory atomic replace, CAS, durable flush, and journaling.
- No absolute path is stored. The only path is the exact artifact-addressed managed-root-relative locator `cache/downloads/<bare-artifact-sha256>.partial`.

All objects are closed. The root contains exactly:

```text
authority
component_manifest
contract_id
document_id
document_revision
integrity
lease
partial
retry_generation
schema_version
source
state
```

The component-manifest binding records the exact manifest contract/schema/document ID/revision/content hash and the exact component ID/version/artifact length/hash/source locator/revision. The source repeats the actionable locator/revision/expected length/hash and adds a strong ETag; the validator requires the repeated identities to match exactly.

## Immutable source and partial identity

The locator must be raw lower-case-scheme HTTPS with no credentials, query, fragment, backslash, percent escape, control/space, IP-literal brackets, or non-443 explicit port. It contains exactly one path segment equal to the lower-case 40-hex `revision`. Dot/empty segments and mutable aliases fail closed. Mutable aliases include `latest`, `main`, `master`, `head`, `current`, and `branch`, including `._-` suffix forms such as `latest.zip` and `main-build`; `refs`, `heads`, and `branches` are also denied.

`strong_etag` is one nonempty quoted strong opaque tag. Weak `W/` tags, unquoted tags, lists/commas, controls, spaces, and empty tags are rejected. ETag drift during a transition is an error even if other expected identity fields remain unchanged.

`partial.identity` is the SHA-256 of the canonical projection containing exactly:

- profile `minimax-h3-tool.download-partial-identity.v1`;
- the complete component-manifest snapshot/component/artifact/source binding;
- source locator, revision, strong ETag, expected length, and expected artifact hash;
- the exact artifact-addressed relative partial path.

It intentionally excludes owner, lease ID, retry generation, document revision, state, and received range so a proven stale owner may be replaced without changing artifact identity. Tampering or any projection drift fails closed.

The pinned initial golden vector in `test/fixtures.mjs` has canonical byte length `2118`, canonical-bytes SHA-256 `57d989bf085fb041a7fa5ceef530568847a5ece0e5bae88284f2437f0c5a39cc`, partial identity `sha256:dea9f10712d901c3397daf1a4859db937fde0a5e4dc7b941eaf7454b616d1b86`, and root content integrity `sha256:29ed93eb13824902d5ebebcdb2abbeeb617a96c2524b4cd4c3d89a2d57eaa486`. Tests compare these hard-coded values rather than deriving expected values with the implementation under test.

## Range and states

The received range is a contiguous prefix and has one of two closed forms:

```json
{"byte_length":0,"kind":"empty_prefix"}
```

```json
{"byte_length":128,"end_inclusive":127,"kind":"inclusive_prefix","start_inclusive":0}
```

Inclusive `end + 1` arithmetic is checked for safe-integer overflow, must equal the redundant `byte_length`, and may not exceed the expected length. Expected artifact length is restricted to `1..8 TiB` in this package.

The closed state graph is:

```text
prepared
  -> receiving_bytes
       -> receiving_bytes
       -> expected_bytes_received
```

- Initial state is revision `1`, retry generation `0`, `prepared`, and an empty prefix.
- Same-attempt state/progress mutations keep `retry_generation` unchanged. Progress must increase, except the adjacent `receiving_bytes -> expected_bytes_received` finalization may preserve an already-full range.
- A one-byte artifact therefore has the legal path empty `prepared` -> full `receiving_bytes` -> same-range `expected_bytes_received`; `prepared -> expected_bytes_received` remains a rejected jump.
- `retry_generation` is a transfer-attempt generation, not a snapshot revision. A retry/recovery edge increments it by exactly one, increments document revision by exactly one, and preserves the range exactly. Partial prefixes re-enter `prepared`; an already-full `receiving_bytes` prefix re-enters `receiving_bytes` under the new lease and can then finalize without growth.
- Retry skips, revision skips, range growth/regression on retry, non-progress updates, and state jumps fail closed. `expected_bytes_received` terminates transport/range mutation. Its only later edge is the exact stale-owner recovery rebind described below.

## Artifact writer lease and recovery

The sidecar binds the ADR-009 artifact writer lease:

```text
lease_id       lower-case 32 hex
resource_type  artifact
resource_key   bare lower-case 64-hex expected artifact SHA-256
mode           write
owner          owner_token + owner_pid + owner_process_start_utc_ticks
```

`owner_token` is lower-case 32 hex. PID is a positive Windows PID integer. Process creation ticks are stored as exact positive decimal text because .NET UTC ticks exceed I-JSON's safe integer range. All three owner fields must match the currently active lease. A `lease_id` can never be rebound to a different owner triple; stale recovery requires a genuinely new lease ID. The lease key must also equal the source/manifest artifact hash and the basename digest of the partial path. This prevents two nonconflicting artifact leases from targeting one partial path.

Normal parse/serialize/validation requires the exact current `active: true` artifact-write lease and owner triple. `parseCanonicalRecoveryPrior` is the only stale-owner read path: it still performs strict canonical parsing, integrity and all domain checks; requires a different current active lease for the same artifact key/type/mode; brands the returned document as non-actionable; and permits it only as prior evidence for `validateTransition`. The ADR-009 lease coordinator—not this package—must first prove the prior owner definitely stale. There is no TTL, force-steal, liveness probe, or lease acquisition here.

A stale `expected_bytes_received` prior may perform exactly one `expected_bytes_received -> expected_bytes_received` recovery rebind with `document_revision + 1`, `retry_generation + 1`, a changed lease identity/owner bound to the current active artifact writer, and exactly unchanged full range, source, ETag, expected identity, manifest binding, partial identity/path, and no-authority literals. This narrow edge lets P2-INS-007 continue after a writer crash; it grants neither verification nor materialization and cannot reopen transport or grow the range.

## Paths and public errors

Path validation is intentionally lexical only. It rejects traversal, percent traversal, empty/dot segments, ADS/colon, absolute/UNC/device prefixes, backslashes, Windows forbidden characters, trailing dot/space, and DOS device stems including extensions. It does not claim handle identity, local fixed NTFS volume identity, containment, or reparse-point safety. A future filesystem caller must perform the native handle/volume/reparse checks required by ADR-004/P1-NAT-003 before any read or mutation.

Errors are deterministic triples of `code`, RFC 6901 `instance_path`, and stable `rule_id`. They never include invalid values. Owner-field paths collapse to `/lease/owner`, and public errors contain no owner token, process-start ticks, username, absolute path, source snippet, or local filename.

## API and non-goals

- `attachIntegrity(core)`: pure deterministic integrity attachment.
- `computePartialIdentity(document)`: pure content identity projection.
- `serializeCanonicalSidecar(document, context)`: validate and return canonical bytes.
- `parseCanonicalSidecar(bytes, context)`: strict canonical parse, active-lease check, and frozen document.
- `parseCanonicalRecoveryPrior(bytes, context)`: strict non-actionable stale-prior parse for recovery only.
- `validateInitialSidecar`, `validateSidecar`, `validateTransition`: pure validators.
- `toPublicError`: fixed redacted public tuple.

None of these APIs opens a path, performs HTTP, downloads bytes, inspects or hashes a partial/model file, acquires/releases a lease, writes/replaces/deletes a sidecar, reserves disk, verifies an artifact, extracts/materializes a model, marks ownership, launches a process, executes a workflow, calls H3, or submits a queue job.
