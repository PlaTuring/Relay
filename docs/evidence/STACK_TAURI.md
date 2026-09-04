# P0-ARC-003 — Tauri/Rust bounded stack evidence

## 1. Conclusion

Tauri remains a **conditional candidate**, not a selected or rejected production stack. This host
can prove the comparison contract, static security boundary, shared Windows path oracle, Alpha
no-self-update policy and evidence hygiene. It cannot compile, run or package Tauri because Rust,
Cargo, Tauri CLI, MSVC and Windows SDK prerequisites are unavailable. Those gaps are reported as
blocked rather than simulated.

No package-size or performance advantage is claimed. A machine WebView2 Runtime is present, but
that fact alone does not prove a Tauri application will build, run, remain isolated, package
smaller, start faster or consume less memory than Electron. The final stack ADR must compare actual
artifacts produced from the same bounded functionality.

The product boundary is unchanged: the tool detects, verifies, configures, compiles and hands off a
workflow. MiniMax H3 generates video and native audio in ComfyUI only after the user visibly clicks
Run. This spike contains no tool-side generation or formal queue submission surface.

## 2. Actions not performed

This task did not:

- install or mutate Rust, Cargo, Node, WebView2, Visual Studio, Windows SDK or global packages;
- download models, runtimes, crates or npm packages;
- install, discover, start or modify ComfyUI/Desktop;
- invoke H3, a GPU, cloud inference, a Partner API or any media generation endpoint;
- compile Rust, launch a WebView, run an owned child, build an installer or modify user files;
- write a root manifest/lockfile, registry, schema, main plan or another prototype;
- add telemetry, an application updater or a tool-side Run/generate action.

The verifier launches the existing Node.js and PowerShell executables with argument arrays and
`shell=false`. The PowerShell probe only asks discovered tool commands for their version; it does
not execute build, install, repair or download verbs.

## 3. Host/toolchain evidence

The sanitized probe intentionally emits versions and boolean capabilities, never executable paths,
environment dumps or account names.

| Item | Read-only result |
|---|---|
| Windows | 10.0.26200.0, x64 |
| PowerShell harness | 7.6.4 |
| Node.js | v24.19.0 |
| npm | 11.17.0 |
| WebView2 Runtime | machine registration present, 151.0.4129.107 |
| Rust compiler | not discovered on PATH |
| Cargo / rustup | not discovered on PATH |
| Cargo-Tauri / JavaScript Tauri CLI | not discovered on PATH |
| MSVC `cl` / linker / MSBuild | not discovered on PATH |
| Visual Studio 2022 known roots / `vswhere` | not discovered |
| Windows SDK known roots / `signtool` | not discovered |

The negative results are bounded: they mean the named commands and known machine roots were not
found. The probe does not recursively search private user directories, import arbitrary Python,
run setup scripts, write a cache or contact the network.

## 4. What the artifact is

The prototype is an **uncompiled design fixture**:

```text
local semantic HTML/CSS
        |
        | frozen typed facade, four named methods
        v
Tauri invoke allowlist design
        |
        +-- security summary
        +-- managed-root picker (fails BLOCKED on this host)
        +-- managed-root path inspection
        +-- harmless owned direct-child probe design
```

There is deliberately no `Cargo.toml` or `Cargo.lock`. Without Cargo and an authorized dependency
resolution, writing package names/versions and calling them locked would fabricate supply-chain
evidence. `dependency-plan.json` instead lists roles with null package/version and the exact future
evidence required.

The Tauri configuration is named `tauri.conf.fixture.json` and marks itself
`not-consumed-by-tauri-cli`. It specifies one local `index.html`, `withGlobalTauri=false`, strict
CSP including `connect-src 'none'`, and an NSIS target. These are configuration assertions only;
no Tauri CLI parsed them and no WebView enforced them.

## 5. Command and renderer boundary

The comparison contract contains exactly four commands:

```text
security_get_summary
choose_managed_root
inspect_managed_root
run_owned_child_probe
```

The uncompiled Rust `generate_handler!` list matches those names exactly. The renderer fixture
accepts a narrow invoker internally and exports only a frozen four-method facade; it does not export
the generic invoker. No plugin registration exists. The picker command returns a visible `BLOCKED`
error until a pinned, reviewed native picker dependency is actually linked.

This proves source/config shape, not Tauri's runtime command permissions. Production acceptance
still requires a compiled packaged probe showing that remote navigation, arbitrary invoke,
devtools, unapproved permissions, new windows, drag/drop attack surfaces and network egress are
denied in both development and packaged modes.

## 6. Windows managed-root behavior

The same comparison cases as the Electron spike are executed by a dependency-free JavaScript
oracle:

- `D:\MiniMax H3\模型 Ω` is accepted and preserved with spaces and Unicode;
- an explicit `C:\MiniMaxH3` choice is accepted but marked as system-drive semantics so the UI can
  show the large-file warning;
- relative, UNC and device namespace forms fail closed in this bounded policy;
- a supported D drive produces the suggestion `D:\MiniMaxH3`;
- when D is not supported, the result is `null`, never a silent C fallback.

The uncompiled Rust source mirrors this path-shape logic and is checked statically. Rust execution,
the native folder dialog, fixed-NTFS detection, free-space budgeting, reparse points, permissions,
long paths, disconnects and canonicalization remain blocked. Therefore this evidence does not claim
that the Rust implementation passed the path cases.

## 7. Owned process boundary

The Rust design selects its own current executable, supplies a fixed argument array, sets standard
streams explicitly, enforces a short deadline, kills and waits for the direct child, and accepts
only a bounded label from the renderer. It contains no command-shell executable and the renderer
cannot provide executable, arguments, working directory or environment.

This is only static source evidence. No child was started. Readiness identity, token validation,
PID reuse, stdout framing, cancellation races, crash cleanup and packaged paths are untested. Most
importantly, the result explicitly reports `processTreeContained=false`: standard Rust child kill
does not establish Windows Job Object descendant containment. A production launcher must use a
reviewed Windows API boundary and prove grandchild cleanup in a packaged test.

## 8. Installer, D/C budget and signing

The fixture requests an NSIS target, but no bundler parsed the config and no installer exists.
Per-user scope, install-directory choice, elevation behavior, upgrade/uninstall, residue and
accessibility are all blocked.

Large models, managed runtime, download cache, temporary media and outputs remain a separate
user-visible managed root: default suggestion D when supported, otherwise explicit user choice,
never a silent C fallback. Even if a future Tauri shell is small, its application files, logs,
WebView2 user data and any WebView2 bootstrap/repair behavior still consume a C-drive budget unless
explicitly configured and measured. Presence of the machine runtime must not be used to report zero
WebView cost.

`signtool` is unavailable and there is no artifact to sign. Publisher identity, certificate/key
custody, RFC 3161 timestamping, installer/uninstaller/helper coverage and post-signature hash and
verification are release gates.

## 9. Dependency, security and update evidence

No Cargo dependency graph was resolved, so these items are blocked:

- exact `Cargo.lock` checksums and source revisions;
- `cargo metadata/tree` and build-script/native dependency inventory;
- crate plus packaged-binary SBOM;
- license allowlist and notices;
- advisory snapshot and tool version;
- Rust/MSVC/Windows SDK/WebView2 loader provenance and reproducibility;
- installer toolchain provenance.

The accepted Alpha no-self-update linter passes the prototype. There is no updater dependency,
service/API, scheduler, channel, update endpoint, remote catalog, mutable package target, runtime
download hook or “update all” surface. Alpha security fixes therefore require a newly built,
reviewed and signed full installer through a separate release process. Introducing remote update
metadata later requires the repository's separate trusted-update gate; it is not part of this
spike.

Static CSP and the absence of network code are not zero-egress proof. A packaged app and owned
process tree must be tested with OS/network instrumentation before making that claim.

## 10. Accessibility

The local HTML fixture provides `zh-CN`, semantic `main/header/section`, native button, headings,
descriptions, `aria-live`, 44-pixel minimum action height, `:focus-visible`, responsive layout and
reduced-motion handling. The only button is the disabled folder-picker placeholder. There is no
tool-side Run, generate, queue or submit action.

This is a static foundation only. Native dialog focus return, full keyboard order, Narrator,
Windows high contrast, 200% scaling, error summaries and packaged WebView accessibility tree are
blocked until an app can run.

## 11. Same-matrix comparison with Electron

| Dimension | Accepted Electron evidence | Tauri evidence in this task | Comparable now? |
|---|---|---|---|
| Installer / unpacked size | 95.18 MiB / 365.90 MiB | no artifact | No |
| Build footprint / SBOM | about 527.50 MiB dev modules; 384 SBOM components | no resolved Cargo graph | No |
| Renderer isolation | packaged runtime values and four-channel bridge proven | CSP/global API config shape only | No |
| Typed allowlist | compiled/runtime four IPC methods | exact four methods statically matched | Partly, source only |
| Native folder picker | Electron dialog implemented; manual UX still open | explicit blocked placeholder | No |
| Unicode/space paths | runtime/unit path shape and child labels passed | shared JavaScript oracle; Rust source uncompiled | Only fixture semantics |
| Owned direct child | repeated dev and packaged direct child passed | source shape only | No |
| Job Object/process tree | not proven | explicitly not implemented/proven | Yes: both blocked |
| Per-user installer | assisted NSIS built; VM behavior open | config target only | No |
| Signing | built artifact verified NotSigned | no artifact and no signing tool | No |
| Startup / memory | not measured | not measurable | Yes: both blocked |
| Accessibility | richer static Web foundation; runtime manual checks open | minimal static foundation; all runtime checks open | Partly |
| Alpha no updater | policy/config/runtime-package evidence | shared policy static lint passes | Partly |
| Public evidence hygiene | deterministic lint passes | deterministic lint passes | Yes |

The table intentionally leaves package size, startup and memory blank for Tauri. The existing
WebView2 runtime may reduce what is bundled, but it also shifts runtime/version/repair cost to a
machine component. Only same-host built artifacts and measurements can decide the tradeoff.

## 12. Verification and reproducibility

From the repository root:

```powershell
pwsh -NoLogo -NoProfile -NonInteractive -File .\prototypes\phase0\stack-tauri\scripts\probe-toolchain.ps1
node .\prototypes\phase0\stack-tauri\scripts\verify-static.mjs
node .\prototypes\phase0\stack-tauri\scripts\verify-static.mjs
```

The two verifier runs completed with exit code 0. Each reported 31 supported assertions as `PASS`
and 11 production/runtime categories as `BLOCKED`. The verifier re-runs the read-only probe and
compares it with the sanitized capture, checks every path fixture and design invariant, calls the
accepted Alpha no-self-update linter, and calls a public-evidence lint. It makes no network request
and writes no generated files.

Public-evidence lint scans this report and the prototype's public text/source. It rejects private
Windows account-root paths and the current account name, reports only repository-relative
locations, and requires local build/cache/private-artifact directories to remain ignored. Raw
third-party output is not stored.

## 13. Evidence grade

### Proven on this host

- sanitized read-only host facts and absence/presence semantics described above;
- shared JavaScript path oracle and no silent C fallback;
- static four-command/config/source/UI boundary;
- no tool-side media action in the UI fixture;
- accepted Alpha no-self-update policy and public-evidence hygiene;
- two consecutive local-only verifier passes.

### Configuration or inference only

- CSP, local navigation and global API settings are intended Tauri isolation settings;
- Rust path/child source appears to mirror the comparison contract;
- NSIS is the intended packaging target;
- machine WebView2 registration suggests a runtime prerequisite is present.

### Blocked

- every actual Rust/Tauri compile, test, runtime and package claim;
- native picker, packaged WebView command/isolation/egress behavior;
- owned-child identity/cancellation and Job Object process-tree cleanup;
- per-user install/upgrade/uninstall and C-drive measurements;
- signing, package size, startup, memory and accessibility runtime tests;
- lock, SBOM, license, advisory and complete binary provenance.

## 14. Recommendation and next PoC

Do not select Tauri from this evidence and do not discard it solely because this host lacks its
toolchain. Keep it conditional. On an approved pre-provisioned Windows build host, create an
isolated pinned Tauri project, resolve and review exact dependencies, then reproduce the same four
commands, path cases, harmless child fixture, package settings and measurement harness used for
Electron. Add a Windows Job Object implementation before treating owned process lifecycle as a
production capability.

Root acceptance of P0-ARC-003 contributes evidence to P0-ARC-005. The final stack decision remains
blocked until P0-ARC-004 is also accepted and all candidates are judged with the same evidence
grade; P0-ARC-002 alone is not enough.
