# MiniMax H3 Win32 helper private-pipe wire ABI 1.0.0

> Deployment status: **frozen future/reserved contract**. Relay Alpha 27 does
> not claim this eight-operation ABI as implemented. The enabled production
> subset is the independently versioned machine-readable profile at
> `../../relay-winbroker/capability-profile.v1.json`; only opcodes `0x0101` and
> `0x0102` are enabled there, and all other opcodes fail closed.

## 1. Normative boundary

This document, `abi-manifest.v1.json`, `toolchain-lock.v1.json`, and
`../include/minimaxh3_winbroker_abi.h` freeze the P1-NAT-001 wire contract. The
machine-readable manifest is the digest authority. The header mirrors fixed
wire constants for later native implementation; it is not a DLL ABI and
declares no callable function.

The helper performs only installation, detection, configuration, deterministic
orchestration, and technical verification. It never generates video or audio.
MiniMax H3 generates the actual video and native audio inside ComfyUI only
after the user clicks Run.

The helper has no generic command, shell, arbitrary filesystem, network,
download, queue, `/prompt`, inference, prompt-creative, or media-generation
surface. No implementation may infer such a capability from an unknown field,
opcode, version, extension, path, environment variable, or build mode.

## 2. Transport and bootstrap

The only transport is three handles inherited when Electron main creates the
exact helper from its materialized build manifest:

| Child descriptor | Direction | Content |
|---:|---|---|
| `0` | caller to helper | control frames |
| `1` | helper to caller | control frames |
| `2` | closed | no diagnostic stream |
| `3` | caller to helper | authorized raw artifact frames |

The exact child argument array is `--wire-abi=1`. No path, handle value, PID,
URL, executable, argument, environment value, or user data is accepted on the
command line. Only the exact handle list may be inheritable. Named pipes,
public endpoints, TCP, stdin text commands, registry discovery, PATH lookup,
and attach-to-running-helper behavior are forbidden.

The helper accepts exactly one in-flight business request. A cancellation frame
may be received while that request is active. A session admits at most
1,048,576 requests, after which both peers close it and create a new helper.

## 3. Control frame

Each control frame begins with this 32-byte little-endian header:

| Offset | Bytes | Field | Required value |
|---:|---:|---|---|
| 0 | 4 | magic | ASCII `MH3W` |
| 4 | 2 | header size | `32` |
| 6 | 2 | framing version | `1` |
| 8 | 4 | payload length | `1..262144` |
| 12 | 2 | message kind | exact table below |
| 14 | 2 | opcode | exact request/response operation, otherwise `0` |
| 16 | 4 | flags | `0` |
| 20 | 8 | direction-local sequence | starts at `0`, increments by exactly one |
| 28 | 4 | reserved | `0` |

Message kinds are `1 client_hello`, `2 server_hello`, `3 request`, `4
response`, `5 cancel_request`, `6 cancel_result`, and `7 close`. Frames 1, 3,
and 5 are caller-to-helper; 2, 4, and 6 are helper-to-caller; close is allowed
in either direction. A kind in the wrong direction is a confusion attack.

The receiver checks magic, header size, version, flags, length, and truncation
before allocation or payload parsing. Payload bytes must be exact RFC 8785 JCS
UTF-8, with no BOM, invalid scalar, duplicate key, whitespace variation, or
trailing data. The root `integrity.content_sha256` is computed after removing
the complete root `integrity` property, exactly as ADR-004 specifies.

There is no negotiation. Framing version, wire schema version, ABI SemVer,
ABI manifest digest, helper tuple, and app tuple must all match the exact
materialized build authorization. A lower or higher value closes the session;
no downgrade, compatibility guess, field stripping, or retry under another
version is allowed.

## 4. Artifact stream frame

Descriptor 3 is not a second control channel. It accepts raw bytes only after
one successful `materialize_owned_artifact` or `commit_owned_state` request has
created an exact one-use `stream_ref`.

| Offset | Bytes | Field | Required value |
|---:|---:|---|---|
| 0 | 4 | magic | ASCII `MH3S` |
| 4 | 2 | header size | `40` |
| 6 | 2 | framing version | `1` |
| 8 | 4 | chunk length | `1..1048576` |
| 12 | 4 | flags | `0`, or `1` only for the final chunk |
| 16 | 16 | stream ID | raw RFC 9562 UUID bytes, network byte order |
| 32 | 4 | chunk sequence | starts at `0`, increments by exactly one |
| 36 | 4 | reserved | `0` |

Total authorized bytes are at most 274,877,906,944 and must equal the control
request's exact length. SHA-256 is computed while streaming and must equal the
request. Only one stream may be active. A wrong reference, sequence, length,
hash, replay, cancellation, EOF, or timeout invalidates the stream and leaves
no published candidate. JSON/base64/blob transfer is forbidden.

## 5. Root message envelope

Every payload is a closed internal document with:

- exact `contract_id: minimax-h3-tool.win32-helper-wire`;
- exact `schema_version: 1.0.0`;
- independent lowercase UUIDv4 `document_id` and revision `1`;
- exact `message_kind` matching the binary header;
- session-scoped lowercase UUIDv4 `session_id`;
- the strict branch fields described below;
- the ADR-004 `integrity` object.

`document_id`, `request_id`, `correlation_id`, `session_id`, `stream_ref`, and
domain IDs are never reused as one another. A request ID is unique for the
whole session and is never accepted again even after completion or error.
Response frames echo `reply_to_request_id`, `reply_to_document_id`, and the
same operation opcode. A mismatch is not repaired by sequence order.

## 6. Handshake and identity

The first caller frame is `client_hello` at sequence 0; the first helper frame
is `server_hello` at sequence 0. No request, stream, or cancellation is valid
before both complete.

Each hello binds:

- ABI version and exact ABI manifest SHA-256;
- independent 256-bit caller and helper nonces;
- caller role `electron_main` and product `minimax-h3-tool.control-plane`;
- helper product `minimax-h3-tool.winbroker`;
- exact app/helper semantic version, build ID, build-manifest SHA-256, and PE
  image SHA-256 from the signed build authorization;
- inherited parent process handle, PID, creation FILETIME high/low words, and
  canonical parent image identity;
- actual helper image identity;
- build-derived signing state and OS-verified signature evidence.

PID alone, process name, pathname text, peer JSON, a content hash alone, or a
session nonce alone is never identity authority. The helper reopens and checks
the inherited parent process handle; Electron checks the exact packaged helper
tuple before creation and the returned tuple before any request.

The two build states are closed branches:

- `internal_unsigned`: both peers and the build authorization are explicitly
  internal and unsigned. This state is technical evidence only.
- `authenticode_release`: app and helper signatures, publisher SPKI SHA-256,
  RFC 3161 timestamp status, and the signed pairing manifest all verify under
  the exact release policy.

The state comes from compiled/package evidence, never a request, flag,
environment variable, config file, or peer claim. Mixed states and promotion
from unsigned to release close the session. The real release certificate is an
external gate; no placeholder signer is trusted.

## 7. Operation allowlist

Only these eight request opcodes exist:

| Opcode | Operation | Request body | Maximum timeout |
|---:|---|---|---:|
| `0x0101` | `inspect_volume_candidate` | `candidate_path`, `candidate_kind`, `required_filesystem`, `require_fixed_local` | 5 s |
| `0x0102` | `validate_path_identity` | `candidate_path`, `purpose`, `mutation_policy` | 15 s |
| `0x0103` | `prepare_owned_root` | `path_ref`, `owner_id`, `owner_marker_sha256` | 15 s |
| `0x0201` | `materialize_owned_artifact` | `owned_root_ref`, `relative_locator`, `artifact_role`, exact length/hash, `stream_ref` | 4 h, 30 s activity |
| `0x0202` | `commit_owned_state` | `owned_root_ref`, `relative_locator`, `state_role`, exact prior state, candidate length/hash, `stream_ref` | 30 s, 5 s activity |
| `0x0301` | `launch_managed_core` | owned/generation/manifest/runtime-lease refs and fixed loopback port policy | 60 s |
| `0x0302` | `verify_loopback_owner` | `launch_ref`, `listener_ref` | 30 s |
| `0x0303` | `query_or_stop_owned_launch` | `launch_ref`, exact action, `stop_policy_id` | 30 s |

The numeric opcode and `operation.kind` must be an exact pair. Every body is
closed. Only the first two operations accept one raw user-selected Windows path
as canonical UTF-8 JSON text. They return observations or a session-scoped
opaque `path_ref`; they do not log the path. All later operations use opaque
references plus contract-relative locators where explicitly listed.

Candidate path text has one encoding only. UTF-16/base64/hex alternatives,
percent encoding, URI syntax, mixed separators, UNC/device/ADS forms, NUL,
unpaired surrogates, trailing dot/space, and ambiguous aliases are rejected.
Unicode code points are preserved and never NFC/NFD-normalized. Final authority
comes from volume, handle, file identity, reparse policy, owner, and post-open
verification, not lexical normalization.

The caller never supplies executable, argv, cwd, environment, raw handle, raw
PID, process name, raw port, URL, host, endpoint, queue, workflow, prompt,
media, delete target, or network policy. `launch_managed_core` resolves the
exact executable/argument/minimal-environment tuple only from an already
verified immutable launch manifest. `verify_loopback_owner` observes inherited
listener and OS ownership evidence; it never scans, binds, connects, or sends
network traffic. Stop acts only on the exact `launch_ref` and revalidates the
owned Job/process identity.

## 8. Cancellation, timeout, and terminality

`timeout_ms` is required and must lie within the operation's exact range. The
helper starts a monotonic deadline on receipt; caller wall clock and an infinite
or zero timeout have no authority. Activity timeout additionally bounds stream
silence.

A `cancel_request` contains only a new document ID, session ID, target request
ID, and integrity. It is not a business opcode. Cancellation is idempotent for
the same live target but an unknown/completed target produces typed
`INVALID_CANCEL`. Exactly one terminal business response is emitted.

Observation and streaming operations cancel before their documented publish
point. Atomic state/artifact publication cannot report cancelled after the
replace/rename point. Launch cancellation terminates the original process
handle while still suspended; after resume it may close or terminate only the
verified exact Job. Stop escalation runs to a verified terminal state and is
not abandoned mid-teardown. Only verified-owned candidates may be cleaned.

Pipe loss, parent death, helper crash, protocol-fatal error, or handshake
failure closes all helper-owned handles. `KILL_ON_JOB_CLOSE` terminates only
the exact owned process tree. The helper never attaches to or mutates an
unknown process after restart.

## 9. Typed errors and parse precedence

An error response contains exactly:

```json
{
  "code": "WIN32_HELPER.UNKNOWN_OPCODE",
  "numeric_code": 1012,
  "instance_path": "",
  "rule_id": "frame.opcode.allowlist",
  "retryability": "never",
  "session_action": "close",
  "operation_effect": "none"
}
```

The full code/number registry is in `abi-manifest.v1.json`. Codes and rule IDs
are stable and non-localized. Errors never contain invalid values, full paths,
nonces, tokens, prompt/media text, command lines, or raw Win32 messages.

Validation precedence is: fixed header, declared size/truncation, UTF-8/strict
JSON/JCS, root envelope/integrity, handshake/session/version/identity,
correlation, opcode/branch, domain policy, OS operation. A fatal earlier phase
does not run a later one. Independent same-phase errors use ADR-004's UTF-8
pointer/code/rule ordering, capped at 256; protocol fixtures assert the exact
primary tuple.

## 10. Change policy

Changing a frame field, limit, identity source, build/signing state, operation,
request field, mutation authority, error meaning, path policy, or cancellation
publish point requires a new exact manifest digest and security review. Adding
an operation or operational field is at least an ABI minor change; weakening a
trust rule or changing semantics is major. Old readers never execute it by
guess. A generic bridge, network surface, queue surface, or generation surface
requires an approved scope ADR and is outside this contract.
