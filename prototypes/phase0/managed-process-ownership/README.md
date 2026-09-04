# P0-ARC-010 managed process/network ownership spike

This is a Windows-only fake-process proof for the Managed Core launch envelope. It never starts
ComfyUI, MiniMax H3, Python, a model, a GPU task or an external network request. MiniMax H3 remains
the only media generator, inside ComfyUI and only after the user clicks Run.

The harness compiles three small .NET Framework fixtures with the Windows PowerShell 5.1 local C#
compiler, entirely below this prototype. The production-shaped launcher uses native
`CreateProcessW(CREATE_SUSPENDED)`, a non-breakaway Job Object with `KILL_ON_JOB_CLOSE`, an explicit
inherited-handle list, an inherited exclusive loopback listener, canonical executable hashing,
PID creation identity and a fixed argument array converted with Windows quoting rules. It verifies
the Job and process before `ResumeThread`.

The intentionally unsafe pre-assignment negative control is separate test-only code. It proves that
starting a fake child first and assigning it later leaves an already-spawned grandchild outside the
new Job. The production-shaped path never uses that sequence.

## Run

From the repository root:

```powershell
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\prototypes\phase0\managed-process-ownership\scripts\Run-Tests.ps1
```

Expected harness summary (followed by the public-evidence lint result):

```text
RESULT passed=14 failed=0
```

The command recreates only ignored `artifacts/local/` and `work/` directories after checking that
they remain below the prototype root. The committed `evidence/LAST_RUN.json` contains test IDs and
statuses only—no PID, launch token, correlation ID, username or absolute path.

## Evidence boundary

Proven behavior is limited to the fake executables, loopback sockets and the current Windows host.
The Job Object does not block network access. The loopback decoy test proves an unexpected socket
can be captured and the verified Job terminated; it does not prove non-loopback egress denial.
Comfy/Python/custom-node behavior and production firewall/WFP enforcement remain later gates.
