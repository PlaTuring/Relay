# P0-ARC-006 Managed Core final-path layout spike

This is a CPU-only filesystem prototype. It creates inert text fixtures shaped like a private Python environment and a ComfyUI runtime; it never starts Python, ComfyUI, MiniMax H3, a model, a GPU workload, a downloader, or a cloud API.

Run from the repository root on Windows PowerShell 5.1+ or PowerShell 7:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\prototypes\phase0\managed-core-layout\Invoke-ManagedCoreLayoutSpike.ps1
```

The command safely resets only `work/` after validating its exact ownership marker, builds generations directly under a final absolute path containing spaces and Chinese characters, injects two crash points, runs negative fixtures, and writes deterministic evidence to `evidence/LAST_RUN.json`.

The `fixtures/negative/` corpus intentionally contains the word `staging` in one rejected manifest. Positive managed state under `work/` must contain no such reference.

`work/` is ignored source-wise and is rebuilt locally on every run. Real final absolute paths remain inside that local fixture for path-binding tests; public README/report/machine evidence are automatically checked to contain no current account name or Windows user-profile absolute path.
