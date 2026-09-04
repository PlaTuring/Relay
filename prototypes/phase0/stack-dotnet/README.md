# .NET desktop bounded stack spike

This Phase 0 artifact is deliberately **uncompiled**. The current Windows host has the
`Microsoft.NETCore.App 8.0.21` runtime, but no .NET SDK, Windows Desktop runtime, Visual Studio,
Windows SDK or packaging/signing tools. It therefore cannot honestly build, run, publish or
package a modern WPF/WinUI application.

The artifact preserves only what can be reviewed and repeated with the existing local tools:

1. a sanitized read-only .NET/Windows toolchain probe;
2. the same path and four-command comparison contract used by the Electron/Tauri spikes;
3. explicitly uncompiled WPF design fixtures with blocked runtime claims;
4. local static checks for product scope, updater absence and public-evidence hygiene.

MiniMax H3 remains the only media generator. This control plane may detect, verify, configure,
compile and hand off a workflow; it never submits the user's formal queue job. The user must click
Run in ComfyUI before H3 generates video or native audio.

## Verification

From the repository root:

```powershell
pwsh -NoLogo -NoProfile -NonInteractive -File .\prototypes\phase0\stack-dotnet\scripts\probe-toolchain.ps1
node .\prototypes\phase0\stack-dotnet\scripts\verify-static.mjs
node .\prototypes\phase0\stack-dotnet\scripts\verify-static.mjs
```

The probe and verifier do not install packages, restore NuGet dependencies, contact the network,
invoke a GPU, start ComfyUI or write generated evidence. Supported static checks report `PASS`;
modern .NET build/runtime/package categories report `BLOCKED` with the missing prerequisite.

## Future build PoC

Use a separate approved Windows build host with a pinned .NET SDK and Windows Desktop targeting
pack. Resolve exact artifacts there and reproduce the Electron matrix: native folder picker,
four-method typed boundary, fixed executable plus `ArgumentList`, owned-child cancellation,
Job Object containment, framework-dependent and self-contained publish sizes, per-user package,
signing, startup/memory, accessibility and complete runtime/SBOM/license evidence.

Do not treat the design fixtures as production source or the installed legacy .NET Framework
compiler as a substitute for the missing modern SDK.

