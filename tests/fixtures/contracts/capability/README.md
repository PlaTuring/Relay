# P0-CON-002 offline contract fixtures

Run from the repository root:

```text
node tests/fixtures/contracts/capability/validate.mjs
```

The two files under `valid/` are complete immutable contract documents with correct RFC 8785 logical-content integrity values. Files under `cases/` are deterministic mutation fixtures: each names a fixed valid base, applies bounded JSON-Pointer operations in listed order, recalculates the mutated document's integrity, and declares either one exact normalized error tuple or `"valid"`.

Recalculating integrity is intentional. It prevents a domain-negative fixture from also failing the generic integrity rule, so every negative case proves one named fail-closed rule. Mutation files are test harness data, not product contracts and not a migration or runtime patch mechanism.

The harness uses only Node built-ins, performs no network access, starts no Python/ComfyUI/H3 process, reads no model, uses no GPU, and never submits `/prompt`. Its compact Draft 2020-12 evaluator is restricted to the keywords exercised by these two schemas; production cross-language validator equivalence remains a P0-CON-012 gate.
