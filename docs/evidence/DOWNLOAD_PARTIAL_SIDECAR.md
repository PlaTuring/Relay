# P2-INS-005 — Download partial-sidecar evidence

## 1. Scope confirmation and task

Task: `P2-INS-005 — Download partial-sidecar format`.

> I only implement installation, detection, configuration, workflow compilation, deterministic orchestration, or technical verification. MiniMax H3 generates the actual video and audio inside ComfyUI.

This implementation is a pure/offline data format, canonical codec, validator, and hostile fixture suite. It does not perform HTTP, download bytes, open/write/delete any partial or model file, acquire/release a lease, reserve disk, hash or verify received artifact bytes, extract/materialize a model, mark ownership, start a process, execute a workflow, call H3, or submit a ComfyUI queue job. No `MODEL-DOWNLOAD`, GPU, Desktop, VM, schema, or root-lockfile resource was acquired.

Binding inputs read before implementation:

- `AGENTS.md`;
- all of `schemas/component-manifest/**` and the accepted P0-CON-003 context packet;
- `docs/adr/ADR-009-resource-leases.md` and the accepted P0-ARC-012 context packet;
- download/recovery/ownership boundaries in `docs/OPTIMIZED_ARCHITECTURE.md`;
- `tasks/TASK_BREAKDOWN.md`;
- `docs/adr/ADR-004-contract-conventions.md` and `schemas/README.md`.

## 2. Files created

- `packages/installer/download-sidecar/package.json` — dependency-free package-local test entrypoint; no lockfile.
- `packages/installer/download-sidecar/README.md` — normative format, identity projection, state/retry/recovery rules, lease/path boundary, APIs, and non-goals.
- `packages/installer/download-sidecar/src/canonical-json.mjs` — bounded fatal-UTF-8, duplicate-detecting, integer-only canonical parser/JCS serializer and SHA-256 projections.
- `packages/installer/download-sidecar/src/errors.mjs` — deterministic fixed public errors with allowlisted pointer segments, owner-path collapse, attacker-key redaction, and stack-path suppression.
- `packages/installer/download-sidecar/src/index.mjs` — closed format/domain validation, immutable source/ETag/manifest binding, collision-safe partial identity/path, lease/owner checks, state/retry/recovery validation, canonical parse/serialize APIs.
- `packages/installer/download-sidecar/test/fixtures.mjs` — stable valid and hostile raw fixture constructors/catalogue.
- `packages/installer/download-sidecar/test/download-sidecar.test.mjs` — canonical, hostile, boundary, transition, recovery, privacy, and purity tests.
- `docs/evidence/DOWNLOAD_PARTIAL_SIDECAR.md` — this evidence packet.

No registry/WBS, shared schema, app, root package/lockfile, component manifest, or any other path was changed by this task.

## 3. Acceptance commands and results

Run from the repository root unless a working directory is stated.

### Package-local deterministic pass 1

```powershell
npm test
```

Working directory: `packages/installer/download-sidecar`.

Result to be finalized after the acceptance run: expected exit `0`, `78` tests passed, `0` failed.

### Package-local deterministic pass 2

```powershell
npm test
```

Working directory: `packages/installer/download-sidecar`.

Result to be finalized after the acceptance run: expected exit `0`, `78` tests passed, `0` failed.

### Root fast suite

```powershell
npm test
```

Result to be finalized after the acceptance run.

### WBS validation

```powershell
powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\tasks\validate_wbs.ps1
```

Result to be finalized after the acceptance run.

The package test also statically proves that production source imports only `node:crypto` and local modules and contains no filesystem, network, process, child-process, or `/prompt` API surface.

## 4. Evidence and conclusion status

### Proven by deterministic local tests

- Canonical bytes use UTF-8 without BOM/newline and reject duplicate keys, invalid UTF-8/surrogates/NUL, noncanonical bytes, `-0`, fraction/exponent tokens, unsafe integers, unknown fields, bad integrity, and parser resource ceilings.
- The pinned initial golden vector is `2118` bytes with canonical-bytes SHA-256 `57d989bf085fb041a7fa5ceef530568847a5ece0e5bae88284f2437f0c5a39cc`, partial identity `sha256:dea9f10712d901c3397daf1a4859db937fde0a5e4dc7b941eaf7454b616d1b86`, and root content hash `sha256:29ed93eb13824902d5ebebcdb2abbeeb617a96c2524b4cd4c3d89a2d57eaa486`. Expected values are hard-coded, not recomputed by the implementation under test.
- The immutable HTTPS locator contains exactly one matching 40-hex revision segment and rejects HTTP, credentials, query/fragment, non-443 port, backslash, dot/percent traversal, mutable aliases (including suffixed forms), and revision mismatch without URL normalization.
- One strong quoted ETag is required; weak/list/invalid ETags and transition drift fail closed.
- Manifest document snapshot plus component ID/version/artifact/source fields are bound to source expected length/hash/locator/revision and the content-derived partial identity.
- The only partial path is `cache/downloads/<bare-artifact-sha256>.partial`; its digest equals source/manifest hash and the artifact-write lease key. Traversal, percent traversal, ADS, absolute/UNC/device/backslash paths, empty/dot/trailing segments, forbidden characters, and DOS devices fail lexically.
- Inclusive range math is a contiguous prefix, checks `end + 1` overflow, exactly matches redundant byte length, never exceeds expected length, and supports one-byte/full-final-chunk completion.
- State edges, exact `document_revision + 1`, same-attempt retry stability, exact retry `+1`, retry range immutability, retry skips, range/state jumps, partial/full-prefix crash recovery, and narrow terminal owner rebind are deterministic.
- Normal reads require the exact active ADR-009 artifact-write lease ID/key/mode and owner token/PID/process-start-ticks triple. Stale recovery requires a genuinely new lease ID on the same artifact writer resource; a lease ID can never be rebound to a foreign owner.
- `expected_bytes_received` and terminal recovery retain all eight explicit no-authority literals and contain no verified/materialized/complete claim.
- Public errors redact arbitrary/nested/duplicate/malformed attacker keys to one fixed pointer segment, collapse owner details, suppress stack paths, and expose no owner token/ticks, username, absolute path, invalid value, or source snippet.
- Production source is pure/offline and has no filesystem/network/process/child-process/queue surface.

### Inferred, not claimed as proven

- P2-INS-006 can use the exact source/ETag/range/retry format for a single-source Range client; that integration does not exist in this task.
- The 8 TiB package ceiling is a conservative local format bound within I-JSON, not evidence that any supported volume/install recipe can reserve or materialize an artifact of that size.
- A caller can persist these canonical bytes with ADR-004 atomic/CAS rules; this package deliberately does not implement durable filesystem persistence.

### Blocked/outside this task

- Network response semantics (`206`, `Content-Range`, server `200` restart), actual partial-file length, streaming SHA-256, and short/overrun detection remain P2-INS-006/P2-INS-007.
- Native handle containment, local fixed NTFS identity, reparse-point/TOCTOU checks, and atomic file replacement remain P1-NAT-003 and installer transaction work. Lexical validation is not advertised as their substitute.
- Ownership ledger commit, delete authority, materialization, runtime activation, execution, queue submission, and H3 media generation remain explicitly unavailable.
- Real lease-coordinator integration must adapt ADR-009's private ledger record to this package's closed active-lease context and remains a downstream integration test.

## 5. Schema, API, and lockfile impact

- Shared schema impact: none. `schemas/**` was read only.
- Root/package graph impact: none. No root `package.json`, root/package lockfile, or shared test manifest changed.
- Package-local API added: `attachIntegrity`, `computePartialIdentity`, `serializeCanonicalSidecar`, `parseCanonicalSidecar`, `parseCanonicalRecoveryPrior`, `validateInitialSidecar`, `validateSidecar`, `validateTransition`, `sidecarAuthority`, `toPublicError`, and format constants.
- The API is pure data validation/serialization and grants no action authority. `parseCanonicalRecoveryPrior` produces a branded non-actionable prior accepted only as transition evidence.
- Repository resource-lock impact: none.

## 6. Open risks and external dependencies

- P2-INS-006 must prove that HTTP request/response range and ETag semantics map exactly to the stored inclusive prefix without mixing responses or trusting a server restart.
- P2-INS-006/P2-INS-007 must compare the actual opened partial-file handle length with the sidecar under the same current artifact-write lease before advancing state or hashing.
- The persistence consumer must implement same-directory candidate write, durable flush, CAS on document ID/revision/content hash, atomic replace, reopen/revalidate, and owned orphan cleanup.
- ADR-009 production integration still needs its local-NTFS ACL/session/atomic-ledger gates; this package neither proves stale liveness nor permits TTL/force-steal.
- The exact artifact-addressed path is lexical. Native handle, volume, containment, and reparse checks remain mandatory before any file action.
- Terminal owner rebind exists only so P2-INS-007 can continue verification after a proven stale writer; downstream must not interpret that edge as byte verification or materialization.

No human/legal, network, model, GPU, ComfyUI, or external-service dependency was needed to complete this format task.

## 7. Next dependency unlocked

After Root accepts this evidence, `P2-INS-006 — Single-source Range/resume client` is ready. It must consume this sidecar as private mutable control state, hold the exact active artifact-write lease, preserve the no-authority boundary, and add real client/server tests for `206`/`Content-Range`/ETag mismatch and safe `200` restart without materializing a model.
