# P0-ARC-001 sanitized host-probe evidence

- Date: 2026-08-27 (Asia/Shanghai)
- Host scope: current Windows host, exact known/documented candidate locations only
- Command:

  ```powershell
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Invoke-RuntimeTopologyProbe.ps1 -Mode Host
  ```

- Exit code: `0`
- Probe schema: `runtime-probe-spike/0.1`
- Safety declaration: read-only; no external process; no Python import; no installation; no Desktop private-state read; no absolute-path disclosure

## Sanitized result

```json
{
  "candidateChecks": 10,
  "evidenceFound": 0,
  "partialLayouts": 0,
  "blockedReparsePoints": 0,
  "desktopExecutableCandidates": 0,
  "desktopRegistryCandidates": 0,
  "desktopStateOnlyCandidates": 0,
  "portableCandidates": 0,
  "coreCandidates": 0
}
```

Candidate IDs checked:

- `desktop-programfiles`
- `desktop-programfiles-x86`
- `desktop-local-programs`
- `desktop-local-data-state`
- `desktop-roaming-state`
- `portable-d-default`
- `core-d-default`
- `core-c-default`
- `core-userprofile-default`
- `desktop-user-installations-state`

The probe also queried the three standard Windows uninstall registry scopes and accepted only exact display names `Comfy Desktop`, `ComfyUI`, or `ComfyUI Desktop`; no matching record was returned.

## Interpretation

**Proven:** none of the fixed candidates above exposed the expected static markers during this run.

**Not proven:** that no ComfyUI or Desktop installation exists anywhere on the host. The probe deliberately performs no recursive drive scan, does not inspect arbitrary user-selected directories, and does not open Desktop private installation records. A later user-authorized path picker/adapter may discover another location.
