# Hardware report 1.0.0

`minimax-h3-tool.hardware-report@1.0.0` is a runtime-observation snapshot. It records synthetic or locally collected host, GPU and volume observations with their exact source, integer confidence, observation time, freshness and conflicts. The document is evidence only: it cannot select a recipe, approve a model, launch a runtime, mutate a path or submit a ComfyUI job.

The preferred NVIDIA sources are `nvml`, `nvidia_smi` and `nvidia_driver_api`. `wmi_cim` is a fallback observation source. A fresh preferred-source VRAM claim that differs from a WMI claim for the same report-local GPU subject creates an unresolved conflict, and the corresponding GPU resolution must be non-actionable. WMI-only GPU evidence is also non-actionable. Unknown, stale, low-confidence or ambiguously correlated evidence never inherits a nearby GPU recipe by product name.

No official MiniMax H3 minimum-VRAM guarantee is encoded. An observed capacity can be `observation_only` or backed by an `experimental_self_poc`; neither state is an official-support claim or a Stable recipe gate.

Confidence is represented as integer basis points. Freshness is evaluated against the document's explicit `evaluated_at_utc` and `max_age_ms`; validators must not read the wall clock. Hardware identifiers are deliberately absent from the public contract surface. Report-local `subject_id` values are opaque correlation labels, not device identity, ownership or authorization.

Every observation snapshot is immutable (`document_revision: 1`). A new probe produces a new document ID and integrity value. There is no in-place migration or downgrade for 1.0.0; a future schema version requires an explicit normalizer from retained raw evidence and may not promote unknown evidence to trusted evidence.

The root integrity profile is RFC 8785 JCS over the complete document with the root `integrity` property removed. Contract source and fixtures may be review-formatted, while persisted production bytes are canonical UTF-8 without BOM.
