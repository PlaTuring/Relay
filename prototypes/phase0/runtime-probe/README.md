# P0-ARC-001 runtime probe spike

This directory contains a Windows-only, static discovery prototype. It identifies candidate topology markers without starting ComfyUI, Desktop, Python, git, comfy-cli, an installer, or any other external process.

## Safety contract

- Read-only filesystem and exact-name Windows uninstall-registry queries only.
- No recursive drive scan. Only documented/known candidate locations are checked.
- No external Python import, executable launch, package install, network request, model enumeration, or large-file hashing.
- Desktop private settings and installation records are not opened. The prototype only distinguishes executable/registry evidence from the presence of documented data roots.
- Candidate roots that are reparse points are not traversed.
- JSON output redacts every absolute candidate path and the local username.
- Static discovery never means compatible, trusted, approved, selected, or runnable.

## Run fixture acceptance tests

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\Run-Tests.ps1
```

The tests require only Windows PowerShell 5.1 or PowerShell 7. They parse the probe AST for forbidden mutating/network/process commands, run the probe against inert fixtures, compare fixture hashes and timestamps before/after, and verify that output contains no absolute path or username.

## Run the sanitized host probe

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Invoke-RuntimeTopologyProbe.ps1 -Mode Host
```

The host probe prints JSON to stdout and writes no report file. Capture/report persistence belongs to the calling product, which must treat raw discovery paths as private state and log only candidate IDs and capability results.

## Deliberate omissions

This spike does not:

- parse Desktop private installation registries or model-path YAML;
- import an existing Comfy runtime to query `object_info`;
- prove a Desktop `OPEN_AND_FOCUS` handoff;
- approve or hash models;
- decide a runtime recipe;
- install, update, roll back, launch, or remove anything.

Those operations require separate Phase 0 contracts and, where applicable, the `COMFY-DESKTOP`, `MODEL-DOWNLOAD`, or other resource lock.
