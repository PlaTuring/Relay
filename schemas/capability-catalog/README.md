# Capability catalog 1.0.0

This immutable authority contract separates five feature decisions—route, duration, prompt/empty-prompt, endpoint preservation, and native audio—from hardware, runtime, and license prerequisites. A consumer must evaluate every gate independently.

`publication_status: "stable"` is only actionable when the catalog validator proves the capability-level evidence is `proven`, every feature and prerequisite gate is `passed` with proven evidence, all referenced local node identities match an exact node-allowlist snapshot, and neither document/capability disposition is superseded or revoked. A conforming JSON shape alone never promotes a capability.

The catalog author may preserve bounded unknown `display_metadata` extensions. No extension can affect execution, node/model selection, graph compilation, launch, queueing, recovery, path ownership, or deletion.

Failure is closed: an unresolved reference, stale content hash, missing gate, unknown field, unknown enum, inferred/experimental claim presented as Stable, or revoked authority leaves the capability unavailable.
