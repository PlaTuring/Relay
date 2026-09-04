# P0-ARC-003 local test results

Evidence date: 2026-08-27 (Asia/Shanghai)

## Supported checks

The supported command is repository-relative and performs no install, download, build or file
write:

```powershell
node .\prototypes\phase0\stack-tauri\scripts\verify-static.mjs
```

Two consecutive runs completed with exit code 0. Each run reported 31 static/probe assertions as
`PASS` and 11 runtime/build/package categories as `BLOCKED`. The assertions include:

- live sanitized toolchain probe equals the captured fact file;
- control-plane/H3 handoff boundary;
- exact four-command contract and uncompiled Rust allowlist shape;
- local-only WebView/CSP configuration fixture;
- all shared path cases, including Unicode, spaces, explicit C warning semantics, no silent C
  fallback and rejection of relative/UNC/device namespace forms;
- fail-closed native picker placeholder;
- fixed executable plus argument-array direct-child source shape and explicit lack of Job Object
  proof;
- typed renderer facade, semantic HTML/focus/reduced-motion foundation and absence of a tool-side
  media action;
- unresolved dependency plan remains honest;
- accepted Alpha no-self-update lint;
- public evidence/private-path lint.

## Toolchain facts

The read-only probe found Windows 10.0.26200.0 x64, PowerShell 7.6.4, Node.js v24.19.0, npm
11.17.0 and a machine-registered WebView2 Runtime 151.0.4129.107. It did not discover Rust, Cargo, rustup,
Cargo-Tauri/Tauri CLI, MSVC compiler/linker, MSBuild, Windows SDK known roots, Visual Studio 2022
known roots, `vswhere` or `signtool`.

Absence means “not discoverable through the probe's PATH and documented machine-root checks,” not
proof that no unrelated copy exists anywhere on disk.

## Precisely blocked

- Rust/Cargo/Tauri compile, typecheck, test, dev runtime and package build;
- actual command dispatch, WebView isolation and runtime zero-egress behavior;
- native folder picker behavior and accessibility focus restoration;
- owned-child readiness/identity/cancellation and Windows Job Object process-tree cleanup;
- NSIS per-user install, upgrade, uninstall and residue behavior;
- Authenticode signing and timestamp verification;
- package/unpacked size, startup time and idle memory;
- Narrator, full keyboard, high contrast and 200% scaling;
- exact Cargo lock/tree, SBOM, licenses, advisory scan and native binary provenance.

No raw third-party output or host-private paths are stored in this evidence directory.
