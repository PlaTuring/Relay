# Contributing to Relay

Thank you for helping improve Relay.

## Product boundary

Relay is a Windows installer, configurator, project and asset manager, and
deterministic ComfyUI workflow compiler. MiniMax H3 inside ComfyUI produces
video and native audio only after the operator explicitly runs the workflow.

Changes must not add a media-generation backend, submit `/prompt`, click Run,
hide uploads, add cloud inference, or download runtime dependencies without an
approved architecture decision.

## Development setup

JavaScript and TypeScript checks require Windows 10 or 11 x64 and Node.js 24
or newer. Run those checks before the native product build:

```powershell
npm --prefix apps/control-plane ci
node apps/control-plane/node_modules/electron/install.js
npm --prefix apps/control-plane run typecheck
npm test
npm run verify:oss
```

The explicit `electron/install.js` step materializes the exact Electron version
already pinned in `package-lock.json` before the offline UI tests begin. It
does not install ComfyUI, models, or any media-generation runtime.

`npm run build:product` additionally requires Visual Studio Build Tools 2022,
MSVC toolset `14.44.35207` (compiler `19.44.35228`) and Windows SDK
`10.0.26100.0`. The build is deliberately fail-closed when that locked native
toolchain is unavailable.

Do not use real projects, prompts, models, or generated media as fixtures.
Tests should use synthetic data and must not execute ComfyUI or submit a queue.

## Pull requests

- Keep each change focused and include regression tests.
- Preserve local data, external models, attached ComfyUI installations, and
  the installer/runtime separation.
- Do not commit release directories, native build outputs, `.relayproj`
  files, model files, generated media, logs, credentials, or private paths.
- Do not modify dependency lockfiles unless the dependency change itself is
  reviewed and the lockfile is intentionally regenerated.
- Document any new third-party source, binary, image, template, model, font,
  or data file with its origin, immutable version, license, and redistribution
  status.

Unless explicitly stated otherwise, an intentionally submitted contribution
is licensed under Apache-2.0 as described by section 5 of `LICENSE`. Submitters
must have the right to contribute the material; do not copy code or assets
whose license or provenance is unknown.

See `SECURITY.md` for private vulnerability reports and
`THIRD_PARTY_NOTICES.md` for components that are not covered by Relay's source
license.
