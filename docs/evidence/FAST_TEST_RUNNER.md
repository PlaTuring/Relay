# QA-001 fast/offline test runner evidence

Status: **proven on the current Windows host; pending Root acceptance**  
Date: 2026-08-27  
Task: `QA-001`

## Scope and product boundary

The root command is:

```text
npm test
```

It performs test orchestration only. The registered `fast` lane does not launch ComfyUI, Desktop, a VM, GPU work, MiniMax H3, a model, a download, `/prompt`, or any media generation. MiniMax H3 remains the only video/audio generator and runs inside ComfyUI only after the user clicks Run.

The root package has zero external dependencies. `package-lock.json` contains only the private root package record.

## Registered fast tests

The fixed command entry point reads only the checked-in `scripts/test/test-manifest.json`; the CLI has no option for a caller-supplied manifest or executable. Tests execute sequentially in lexical ID order.

| ID | Kind | Entry | Timeout | Output limit |
|---|---|---|---:|---:|
| `capability-catalog-contract` | contract | `tests/fixtures/contracts/capability/validate.mjs` | 60 s | 256 KiB |
| `capability-snapshot-contract` | contract | `prototypes/phase0/capability-snapshot/validate-snapshot.mjs` | 15 s | 32 KiB |
| `no-self-update-policy` | policy | `prototypes/phase0/no-self-update/test-policy.mjs` | 60 s | 128 KiB |
| `qa-runner-contract` | runner security contract | `tests/runner/runner.test.mjs` | 60 s | 256 KiB |

These entries are read-only with respect to product, user and external state. The runner contract contains 12 tests, including all required malicious/negative fixtures.

## Execution and trust boundary

- Manifest adapters are limited to `node_script` and `node_test`; both resolve in code to the running, materialized `process.execPath`. A manifest cannot provide an executable.
- The runner constructs exact argument arrays and always uses `shell: false`. Shell metacharacters, substitutions, newlines, NULs, absolute/traversing script paths, unknown fields and unapproved adapters fail validation before spawn.
- Scripts must be materialized regular files below one of three reviewed roots: `prototypes/phase0/`, `scripts/test/`, or `tests/`. Symlinked files and paths resolving outside the repository fail closed.
- The child environment is an allowlist. It does not inherit the caller's `NODE_OPTIONS`, credentials, API keys or arbitrary executable search paths; it replaces `NODE_OPTIONS` with the fixed network-guard pre-import, and child `PATH` contains only the current Node directory. Offline npm flags, telemetry opt-outs and loopback discard proxies are set.
- A pre-import guard denies Node `net`, TLS, HTTP, HTTPS, HTTP/2, DNS, datagram, `fetch` and WebSocket entry points. The network fixture starts a descendant Node process without adding guard arguments and proves the fixed inherited `NODE_OPTIONS` denies that descendant before its attempted loopback connection. The checked-in manifest remains the primary boundary against a test intentionally invoking an absolute native executable; this is a reviewed test harness, not a kernel egress sandbox.
- stdout and stderr share a per-test byte budget capped by policy at 256 KiB. Public diagnostic excerpts are capped at 4 KiB. Exceeding the budget terminates the process tree and returns `RUNNER.OUTPUT_LIMIT`.
- Any repository/user absolute path, Windows/POSIX user-home path, supported token pattern or prompt-shaped output makes the test fail as `RUNNER.SENSITIVE_OUTPUT`; the raw value is not rendered.
- Timeouts terminate the owned Windows process tree with the fixed system executable `C:\Windows\System32\taskkill.exe` and exact `[/PID, pid, /T, /F]` arguments. Missing/failed cleanup returns `RUNNER.CLEANUP_FAILED`, not a successful timeout. A non-standard Windows system location is therefore fail-closed for this Alpha runner. POSIX uses a detached process group, but that path is not part of the present Windows acceptance claim.

## Status and exit semantics

| Status | Meaning | Root exit effect |
|---|---|---|
| `passed` | selected child exited 0 within limits and emitted no sensitive output | none |
| `failed` | required prerequisite missing, child failure, timeout, output/safety violation, spawn or cleanup failure | exit 1 |
| `blocked` | an optional selected test lacks its approved executable prerequisite | exit 2 if no failure |
| `skipped` | a valid registered test belongs to a different explicitly selected lane | visible; no effect by itself |

Manifest/CLI validation aborts use exit 3. A missing prerequisite can never become `passed`.
Selecting a valid but unregistered lane aborts as `RUNNER.LANE_EMPTY`; an empty lane cannot report success.

## Negative fixture evidence

| Fixture/assertion | Exact result |
|---|---|
| shell metacharacter / command injection argument | `RUNNER.MANIFEST_SHELL_METACHARACTER` |
| duplicate test ID | `RUNNER.MANIFEST_DUPLICATE_ID` |
| GPU/model/H3/Comfy/ComfyUI/Desktop/VM/network/download lane | `RUNNER.MANIFEST_FORBIDDEN_LANE` |
| required approved adapter with missing executable | failed: `RUNNER.EXECUTABLE_NOT_FOUND` |
| optional approved adapter with missing executable | blocked: `RUNNER.EXECUTABLE_NOT_FOUND`, exit 2 |
| nonzero child | `RUNNER.CHILD_NONZERO` |
| oversized output | `RUNNER.OUTPUT_LIMIT`; process terminated |
| synthetic private path/token/prompt output | `RUNNER.SENSITIVE_OUTPUT`; raw output suppressed |
| timeout with a child-created grandchild | `RUNNER.TIMEOUT`; descendant PID confirmed dead |
| attempted Node network connection | guard emits `RUNNER.NETWORK_FORBIDDEN`; child cannot connect |
| Unicode and spaces in both a repository root and a repository-relative script path | passed |
| out-of-order manifest entries | executed in lexical ID order |

The fixtures are under `tests/runner/fixtures/`. The apparent user path in the sensitive-output fixture is synthetic and does not identify the build host.

## Explicit exclusions

The following existing commands are intentionally **not registered** in `fast`:

- Electron verification/package work: locally provisioned dependencies and build output ownership belong to the Electron spike.
- .NET and Tauri static verifiers: they perform host-specific PowerShell/toolchain probes; they are retained as direct spike evidence, not cross-host deterministic unit tests.
- resource-lease, runtime-probe, managed-core-layout and managed-process-ownership PowerShell suites: some own working/evidence directories outside QA-001 and must be registered only after their owners provide a non-mutating fast adapter or an explicit local-stack contract.
- all GPU, H3/model, ComfyUI/Desktop, VM, network and download work: forbidden from this runner rather than represented as skipped tests.

No `local_stack` entry is registered in this task. The runner understands the status/lane contract so a later approved entry can be added, but an attempt to select the empty lane fails as `RUNNER.LANE_EMPTY`; `npm test` never auto-discovers or silently runs locally installed stacks.

## Acceptance runs

Prerequisite proven on this host: Node `v24.19.0`; npm `11.17.0`; fixed Windows `taskkill.exe` present.

Validation sequence:

```text
node --check <every .mjs under scripts/test and tests/runner>
npm install --package-lock-only --ignore-scripts --offline --dry-run
npm test
npm test
```

Results:

```text
syntax checks: pass
offline lock dry-run: up to date, no download
root run 1: passed=4 failed=0 blocked=0 skipped=0
root run 2: passed=4 failed=0 blocked=0 skipped=0
runner contract in each root run: tests=12 pass=12 fail=0
```

Both root runs emitted the same ordered runner result lines; durations and child output are deliberately absent from the public summary.

## Conclusion and remaining gate

The checked-in fast lane, reason-code behavior, bounded/redacted output, Unicode/space handling, missing-prerequisite semantics and Windows timeout-tree cleanup are **proven on the current host**. No schema or product API changed. The only shared build impact is the new zero-dependency root `package.json` and `package-lock.json` under the granted `ROOT-LOCKFILE` lock.

After Root review accepts this evidence, QA-002 and subsequent modules can use `npm test` as their common fast/offline entry point.
