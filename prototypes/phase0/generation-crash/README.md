# P0-ARC-011 generation/active-pointer crash PoC

This Windows filesystem prototype uses deterministic fake bytes and tool-owned temporary paths only.
It never starts or installs Python, ComfyUI, MiniMax H3, a model, a GPU workload, a downloader, a
cloud API or a media generation job. MiniMax H3 remains the only media generator, inside ComfyUI
and only after the user clicks Run.

Run from the repository root:

```powershell
node .\prototypes\phase0\generation-crash\scripts\run-harness.mjs
```

The harness builds an old verified generation, starts a separate materializer process, and terminates
that process at exact generation/marker/pointer boundaries. Each scenario is recovered and retried
without selecting a directory by recency. It also terminates an owned fake parent tree while a fake
child is writing bytes and injects a second crash during owned cleanup.

All mutable state is recreated below ignored `work/` only after an exact ownership and containment
check. Public evidence contains stable test IDs and hashes, not PIDs, usernames, absolute paths,
tokens, environment dumps or child logs.

## Evidence boundary

The proof uses process termination (`TerminateProcess` semantics, plus an owned `taskkill /T` tree
termination case) on the current Windows host. File handles are flushed at the protocol's declared
durable boundaries, but the test does not cut machine power, bypass the OS cache, verify storage-device
flush behavior, or prove NTFS behavior across a real power failure. Atomic pointer visibility after
process termination is proven; power-loss durability remains a later VM/hardware fault-injection gate.
