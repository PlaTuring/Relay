# Task Context Packets

`/root` creates one packet before dispatching each code-bearing or stateful task. The packet is immutable while its worker is active; any scope change is a new root-issued revision.

Every packet states the task ID, product boundary, accepted inputs, allowed paths, forbidden paths/actions, resource locks, deliverables, deterministic acceptance commands, evidence level, failure fallback, and next dependency. The worker may read the repository but may write only the listed paths.

The live owner and status remain authoritative in `tasks/registry.json`. A context packet authorizes work; it does not mark the result accepted.
