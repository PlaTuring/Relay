# Model registry 1.0.0

`minimax-h3-tool.model-registry@1.0.0` is mutable control state for model-candidate progression and exact recipe-slot selection. Its only successful lifecycle is:

```text
found -> identified -> verified -> compatible -> approved -> selected
```

The ordered history must start at `found`, contain every preceding stage exactly once, and end at `current_stage`. A filename, extension, local presence or byte length is discovery evidence only. Identification requires a bounded non-executing Safetensors-header and tensor role/dtype/shape fingerprint. Verification requires an explicit user reuse-verification trigger plus the raw full-file SHA-256 and a stable file-identity snapshot. Compatibility exact-binds the verified artifact to component, recipe, hardware-report and recipe-slot snapshots. Approval exact-binds provenance, immutable source revision, license scope, support state and user consent. Only `selected` may carry `reuse_permitted: true`.

Initial external discovery is limited to recognized configuration paths and an explicitly user-selected folder. There is no common-drive or ambient whole-machine scan scope. Unsupported quantizations, Diffusers directories, GGUF, pickle-based weights, incomplete files and unverifiable sources may remain visible at `found`; they cannot progress to an actionable selection.

An external candidate is permanently `external_read_only`: it is never moved, renamed, overwritten or deleted, and neither a matching hash nor a later lifecycle stage changes that classification. Every read of a selected external file still requires handle-identity, size, modification-state and reparse-policy revalidation. Any drift invalidates reuse and requires a new candidate; history is not silently rewound. Managed artifacts require a separate exact ownership-ledger snapshot and never infer ownership from this registry.

The registry is persisted with revision/CAS and same-directory atomic replacement rules from ADR-004. Version 1.0.0 has no implicit migration or downgrade. Future migrations require explicit exact schema-digest edges, preserve document ID, increment revision once and revalidate every stage and cross-document binding.

The root integrity profile is RFC 8785 JCS over the complete document with the root `integrity` property removed. This contract grants no model download, inference, media generation, cloud/Partner access or ComfyUI queue authority.

