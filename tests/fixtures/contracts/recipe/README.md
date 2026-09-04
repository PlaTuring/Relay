# P0-CON-004 offline recipe fixtures

Run from the repository root:

```text
node tests/fixtures/contracts/recipe/validate.mjs
```

`valid/alpha0-poc-pending-recipe.json` is one immutable, reconstructable profile bound to the accepted P0-CON-002/P0-CON-003 synthetic authority documents. It is intentionally non-runnable. Missing backend/FL2VA/encoder/VAE requirements and every pending or blocked upstream state remain explicit. Each resolved and unresolved slot has an exact identity; a valid upstream component cannot be transplanted into a different slot, and unresolved slots cannot exchange requirement IDs, roles or blocker reasons.

Files under `cases/` are bounded JSON-Pointer mutations. The harness refreshes root integrity after each mutation so every negative fixture reaches one deterministic fail-closed rule rather than an incidental hash error. The harness uses Node built-ins only and performs no network, model, ComfyUI, GPU, `/prompt` or media operation.

The immutable recipe has no migration or downgrade path. Display-only extensions may be preserved but cannot affect any operational decision. Support projection is default deny and exports only public opaque identities/statuses; no prompt, token, username, absolute path or extension data is exported.
