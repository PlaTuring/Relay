# P0-ARC-004 local verification results

- Date: 2026-08-27
- Evidence kind: sanitized host probe plus uncompiled design-fixture static verification
- Network/package activity: none
- Global mutation: none

| Run | Exit | Supported assertions | Explicit blocked categories | Host probe match | No-self-update | Public evidence lint |
|---|---:|---:|---:|---|---|---|
| 1 | 0 | 34 PASS | 14 BLOCKED | PASS | PASS | PASS |
| 2 | 0 | 34 PASS | 14 BLOCKED | PASS | PASS | PASS |

The `BLOCKED` lines are expected evidence results, not skipped failures. They cover modern .NET
compile/runtime/publish, WPF/WinUI runtime behavior, installer/signing, Job Object containment,
runtime accessibility, performance and resolved dependency/SBOM/license evidence.

SHA-256 anchors:

```text
HOST_TOOLCHAIN_PROBE.json  C57F6913CB5DC9643208F0E938A5F8D120AEB6EA6C88EC9D1B6B7C7ED75D9139
comparison-contract.json   F4F65984D8F1AF7A840EB6AFD31C941C9ADB646FD513800C588C09CC3E960AAE
comparison-cases.json      7F03594BAEBE0405AF92B4869DA75597DC746DC836B98ABA288B3958BB191F1B
verify-static.mjs          BE280CBCD8992EE463D9F6DFD05BA36358EFF62979B1B0B6F97F6BEC4EAFC9F8
```

Raw PowerShell/Node diagnostics were not committed. Published evidence contains only sanitized
versions, booleans, relative locations, counts and hashes.

