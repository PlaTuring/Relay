# Tauri/Rust bounded stack spike

This directory is a deliberately bounded Phase 0 comparison artifact. It does not contain a
`Cargo.toml`, resolved dependencies, a compiled Tauri application, an installer, or a media
execution surface. The local host has WebView2 and Node.js, but the Rust, Cargo, Tauri, MSVC and
Windows SDK build prerequisites are unavailable. Inventing a compilable project or package
measurement would therefore be misleading.

The fixture preserves four things that can be reviewed and retested without those prerequisites:

1. a sanitized, read-only Windows toolchain probe;
2. the same path and command comparison contract used by the Electron spike;
3. explicitly uncompiled Rust/config/UI design sources with fail-closed gaps;
4. offline static checks for product boundary, Alpha no-self-update policy and public evidence
   hygiene.

MiniMax H3 remains the only media generator. This tool may detect, configure, compile and hand off
a workflow; the user must click Run in ComfyUI before H3 generates video or native audio.

## Verification

From the repository root:

```powershell
pwsh -NoLogo -NoProfile -NonInteractive -File .\prototypes\phase0\stack-tauri\scripts\probe-toolchain.ps1
node .\prototypes\phase0\stack-tauri\scripts\verify-static.mjs
node .\prototypes\phase0\stack-tauri\scripts\verify-static.mjs
```

The probe and verifier are read-only. They do not install packages, access the network, invoke a
GPU, start ComfyUI or write generated evidence. The verifier must report supported static checks as
`PASS` and unsupported runtime/package checks as `BLOCKED`.

## Future build PoC

Run a separate follow-up only on an approved, pre-provisioned Windows build host with pinned Rust,
Cargo, Tauri CLI, MSVC Build Tools and Windows SDK versions. Resolve exact dependencies there,
commit an isolated lock, and reproduce the Electron matrix: runtime isolation, native folder
picker, fixed executable/argument-array child, Job Object descendant cleanup, per-user installer,
signing, package sizes, startup/memory, accessibility and complete supply-chain inventory. Do not
use this fixture as production source before those gates pass.
