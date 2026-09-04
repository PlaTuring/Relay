# P0-ARC-010 test evidence

Evidence date: 2026-08-27 (Asia/Shanghai)

The repository-relative acceptance command was run twice consecutively in its final form:

```powershell
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\prototypes\phase0\managed-process-ownership\scripts\Run-Tests.ps1
```

Both runs returned exit code 0 and the same summary:

```text
RESULT passed=14 failed=0
```

Each run also completed the public evidence lint successfully. The machine-readable result is
`evidence/LAST_RUN.json`; it contains only stable test IDs/statuses and explicit product-boundary
booleans.

Native fake-process behavior proven on this host includes suspended creation before Job assignment,
membership/limit verification before resume, child and grandchild containment, breakaway denial,
nested Job operation, inherited exclusive loopback socket transfer, parent-crash Job cleanup,
graceful-stop timeout escalation and unrelated-process preservation.

The forced PID-reuse branch is tested with a mismatched creation identity rather than waiting for
Windows to reuse an actual PID. External non-loopback egress denial, real Comfy/Python behavior and
production packaging remain blocked.
