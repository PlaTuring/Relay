# Node allowlist 1.0.0

This immutable authority is tied to ComfyUI Core revision `d8e7bbc9d586d95f758d6b0ed23d519088be578a`. A local node identity is the tuple of exact `class_type`, input fingerprint, output fingerprint, combined schema fingerprint, origin URI/revision/path/blob, local/API/output flags, and active disposition.

The input fingerprint projection is `{required_inputs, optional_inputs, hidden_inputs}`; the output projection is `{outputs}`; the combined fingerprint is the accepted P0-WF-001 descriptor containing `class_type`, all input sets, outputs, and flags. All projections use the accepted snapshot's recursively sorted-key JSON normalization. These fingerprints are source-derived authority; the live `/api/object_info` normalization/match remains a separate runtime gate.

`display_name` is optional display metadata. It must never be used to match or authorize a node. Every `is_api_node: true` class, every explicit Partner/API class, every unknown class, and every mismatch in any exact identity field fails closed. The explicit forbidden list is regression evidence, not an exhaustive allow rule: unknown identities remain forbidden even if their labels resemble local H3 nodes.

Superseded or revoked entries/documents are non-actionable. A replacement is a new immutable document; this contract is never edited in place.
