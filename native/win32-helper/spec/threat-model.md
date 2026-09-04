# P1-NAT-001 Win32 helper threat contract

## Security objective

Keep strong Windows path/process authority behind one narrow, session-bound,
fail-closed helper without creating a generic privileged bridge. The helper is
not an inference engine, downloader, shell, filesystem utility, Comfy client,
or creative component.

## Protected assets

- tool-owned root identity, owner marker, immutable artifacts, and atomic state;
- external models and external Comfy installations, which remain read-only;
- launch manifests, runtime leases, suspended process handles, Jobs, inherited
  loopback listener evidence, and exact stop authority;
- packaged app/helper build identity, publisher identity, and ABI digest;
- private paths, nonces, tokens, and raw OS diagnostics;
- the user-Run boundary: no helper message can authorize `/prompt` or media.

## Trusted inputs and boundaries

Only an exact packaged Electron main parent, inherited private handles, an
exact signed build authorization, compiled policy, verified immutable
manifests, and helper-produced opaque references may create authority. Renderer
input, peer JSON claims, user path text, mutable files, environment variables,
process names, PIDs, ports, URLs, and existing Comfy instances are untrusted.

For `internal_unsigned`, authenticity is not claimed; it is bounded technical
evidence and cannot be promoted. For `authenticode_release`, both artifacts,
the publisher SPKI anchor, timestamp policy, and pairing manifest must verify.

## Threat and control matrix

| Threat ID | Attack | Required control | Failure effect |
|---|---|---|---|
| `threat.frame_confusion` | wrong magic/kind/flags/control-vs-stream | fixed headers, direction, separate pipe | reject before payload; close |
| `threat.truncation_dos` | huge length, truncated header/payload/chunk | pre-allocation limits, exact EOF accounting | reject; no publish |
| `threat.encoding_confusion` | invalid UTF-8, BOM, duplicate key, non-JCS | fatal decoder, duplicate parser, exact JCS bytes | reject; close |
| `threat.version_downgrade` | lower/higher frame, schema, ABI, or digest | exact tuple; no negotiation | reject; close |
| `threat.replay` | repeated frame/sequence/request/stream | strict sequence and lifetime uniqueness | reject; close |
| `threat.correlation_confusion` | response/cancel/opcode mapped to wrong request | document/request/opcode/session cross-check | reject; no mutation |
| `threat.parent_spoof` | renderer or unrelated process opens helper | inherited parent handle plus PID/creation/image/build | reject handshake |
| `threat.build_substitution` | wrong app/helper/version/hash | signed exact build authorization and self/parent evidence | reject handshake |
| `threat.signing_promotion` | unsigned or mixed artifacts claim release | build-derived closed state and OS signature checks | reject; never publish |
| `threat.generic_command` | exec, shell, PowerShell, cmd, arbitrary image/argv | eight-opcode equality and closed bodies | reject; close |
| `threat.ambient_authority` | cwd/env/PATH/raw handle/PID/name/port smuggling | fixed bootstrap; opaque refs; minimal manifest-derived launch | reject; no mutation |
| `threat.filesystem_authority` | generic read/list/copy/move/delete | only typed owned-root/artifact/state operations | reject; preserve external data |
| `threat.network_surface` | URL, DNS, HTTP, socket, tunnel, download/update | no network APIs or operation; loopback check is observation | reject; close |
| `threat.queue_generation` | queue, graph submit, `/prompt`, video/audio/media | no opcode/field and explicit hostile corpus | reject; zero formal submit |
| `threat.prompt_creative` | prompt expansion, story/shot/music behavior | no prompt/media fields; product boundary lint | reject |
| `threat.path_ambiguity` | UNC/device/ADS/URI/dual encoding/alias | one UTF-8 form plus handle/volume/reparse identity | reject before mutation |
| `threat.path_toctou` | swap ancestor/target after lexical check | open handles, file/volume IDs, post-create verification | rollback; no publish |
| `threat.external_mutation` | overwrite/move/delete external model/instance | external-read-only refs have no mutation transition | reject |
| `threat.stream_smuggling` | stream before auth, wrong ref, overrun, base64 JSON | one-use stream ref, separate header/pipe, exact length/hash | invalidate; clean owned candidate |
| `threat.job_escape` | child runs before Job or requests breakaway | suspended create, non-breakaway Job, verify then resume | terminate while suspended |
| `threat.stop_wrong_process` | PID reuse/name/port kill | launch ref plus PID creation/image/hash/Job revalidation | zero mutation |
| `threat.cancel_crash_partial` | cancellation/crash near commit/resume | explicit publish points, atomic replace, Job close | old state remains valid |
| `threat.secret_disclosure` | path/nonce/token/raw OS message in output | event/error allowlists and opaque IDs | omit sensitive value |

## Operation authority table

| Operation | Reads | May mutate | Cannot accept |
|---|---|---|---|
| inspect volume | one user candidate | no | arbitrary scan/list |
| validate path | one user candidate | no | delete/launch authority |
| prepare owned root | validated path ref | exact owned marker/root | external ref, generic mkdir |
| materialize artifact | owned ref + approved role + stream | one verified owned candidate/commit | URL, external target, arbitrary file role |
| commit state | owned ref + exact CAS + stream | one atomic small state | generic copy/move/delete |
| launch core | owned generation/manifest/lease refs | exact suspended child/Job | executable/args/cwd/env/user prompt |
| verify loopback owner | launch/listener refs | no | host/URL/connect/scan |
| query or stop | launch ref | exact Job only for stop | PID/name/port/external process |

## Out of scope and non-claims

- An attacker already controlling the same Windows user account, an elevated
  OS principal, the kernel, or the release signing key is outside the
  authentication boundary. This does not permit a weaker release design.
- The contract does not prove native path primitives, Job behavior, packaged
  Electron bridging, Authenticode, certificate custody, clean-VM installation,
  real Comfy identity, Gate A offline qualification, or Gate B OS-enforced
  egress. Those remain downstream gates.
- Job containment is not a firewall. The helper itself performs no network
  operation; Managed Core network qualification remains ADR-012's separate
  responsibility.
- Static fixtures do not generate media, start Comfy, submit a queue job, or
  validate H3 output.

## Required hostile evidence

`tests/fixtures/native-helper/protocol` must retain exact negative cases for
every threat ID above. Deleting a case, changing an expected tuple, widening the
eight operations, accepting a forbidden field, or changing the ABI digest must
make validation fail. The validator uses fixed case counts, threat coverage,
header mirrors, and a hard-coded digest; the spec cannot approve its own drift.
