# P0-ARC-012 Phase 0 evidence

- Date: 2026-08-27
- Host: Microsoft Windows NT `10.0.26200.0`
- Shell under test: Windows PowerShell `5.1.26100.7920`
- Filesystem under test: local NTFS
- Real model/GPU/Comfy/H3 access: none
- Fixture resources: fake SHA-256 strings, fake volume bytes, fake runtime/project IDs, fake GPU LUIDs

## Acceptance command

```powershell
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\prototypes\phase0\resource-leases\tests\Run-Tests.ps1
```

The final suite was run twice consecutively after adding the public-output redaction assertions. Both runs exited `0` with `9/9` passing. The second run reported:

```text
PASS artifact digest permits only one writer
PASS same fake GPU LUID is serialized
PASS runtime readers coexist and exclude writer
PASS project-run is mutually exclusive
PASS volume byte reservations are bounded and timeout never steals
PASS owner token and PID creation identity are both enforced
PASS public acquire result and snapshot redact private owner identity
PASS crashed owner is reclaimed only after process death proof
PASS reverse acquisition order is rejected immediately
RESULT passed=9 failed=0
```

The three public Markdown reports produced by this task (ADR, README, and this evidence report) were also scanned for Windows absolute-drive syntax and the current local account name. The scan returned no match. All published acceptance commands are repository-root relative.

The source-only safety scan also returned no match:

```powershell
rg -n --glob '*.ps1' --glob '*.psm1' `
  'nvidia-smi|Invoke-WebRequest|Start-BitsTransfer|System\.Net\.Http|Get-CimInstance|Get-WmiObject|python|pip|git\s+clone|ComfyUI|MiniMax-H3' .
```

## Evidence classification

### Proven by this PoC

- The five lease classes and fixed ordering behave as specified among cooperating Windows PowerShell processes in the same Windows session.
- A timeout does not remove live leases.
- PID death permits stale reclaim; PID creation identity and logical owner token are enforced.
- Acquire result and snapshot omit private owner fields both as object properties and after JSON serialization; the private ledger is intentionally outside this public-output assertion.
- Fake workers do not call model, GPU, network, Python, ComfyUI, or H3 adapters.

### Inferred / requires production integration tests

- Equivalent behavior after porting the module to the selected control-plane implementation.
- Correctness with actual volume IDs/capacity snapshots and real GPU LUIDs supplied by adapters.
- Correct ACL and coordination behavior when every process runs as the same interactive user.

### Not proven / blocked on later gates

- Cross-session, Windows service, `Global\` mutex, network filesystem, FAT/exFAT, or synced-folder behavior.
- Fair FIFO scheduling or writer starvation prevention.
- Downloader transaction, runtime generation rollback, actual GPU serialization, Comfy lifecycle, or project checkpoint integration.
- Any H3 generation, model compatibility, performance, output quality, or long-video capability.
