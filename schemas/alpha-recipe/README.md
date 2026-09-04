# Alpha recipe 1.0.0

This immutable-authority contract describes one reconstructable Alpha-0 profile. It binds exact accepted capability, node-allowlist and component-manifest snapshots, then records the control-plane, node, component, model-role, hardware and output requirements without granting any action.

The only current profile is deliberately `poc_pending`, `runnable: false` and `selectable: false`. Resolved synthetic components retain their upstream `blocked` release and pending-license state. Missing backend and model-role components remain explicit blockers. Recipe data cannot promote a capability, component, license, hardware certification or output result.

The contract grants no download, materialization, execution, ownership, deletion, launch or queue authority. It contains no command, endpoint, `/prompt`, auto-run, cloud/Partner fallback, arbitrary HTTP, runtime dependency download, self-update or private FFmpeg field. The 5-second path records Core `CreateVideo`/`SaveVideo` with PyAV and `external_ffmpeg_requirement: "not_declared"`; a later independently accepted capability is required before any private FFmpeg component can enter a different recipe.

All cross-document references bind exact schema ID/digest, document ID/revision and JCS content hash. Node selections additionally bind exact `class_type`, all three schema fingerprints and source identity. Every profile slot has its own exact schema definition: resolved slots bind the one allowed component ID, version, role, artifact hash and blocked status; unresolved slots bind the one allowed requirement ID, role, blocker reason and blocked readiness. Cross-slot substitution is invalid even when the transplanted component is itself a valid upstream record. Any drift, unknown operational field or upstream status promotion fails closed.

The document is immutable and has no migration or downgrade path. New content or capability evidence creates a new exact recipe document and is reviewed independently; this Alpha-0 fixture must never be updated in place to become runnable.
