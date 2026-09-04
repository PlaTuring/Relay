# ADR-017: Relay source license and distribution boundary

- Status: Accepted
- Date: 2026-09-04
- Decision owners: Relay repository maintainers
- Scope: Relay-owned source repository material and release-input policy

## Context

The public repository described Relay as open source while package metadata
used `UNLICENSED` and no repository license defined the permissions granted to
recipients. At the same time, Relay interoperates with and can obtain software,
models and templates from multiple upstream projects. A repository license for
Relay's own work must not be presented as a license for those separate works.

The application packages also use `private: true`. In npm metadata this blocks
accidental publication; it is not a copyright license and does not make an
otherwise licensed source tree proprietary.

## Decision

1. Original Relay source, documentation, tests and assets for which
   contributors can grant rights are licensed under Apache License 2.0.
   The complete standard license is stored at `LICENSE`; the package manifests
   declare the SPDX identifier `Apache-2.0`.
2. Package manifests retain `private: true` to prevent unintended npm
   publication. Source licensing and npm publication are independent controls.
3. A repository `NOTICE` and `THIRD_PARTY_NOTICES.md` define attribution and
   the non-Relay boundary. Third-party works keep their upstream licenses and
   are never relicensed by this decision.
4. The three vendored MiniMax H3 workflow JSON templates are exact-byte copies
   from Comfy-Org/workflow_templates revision
   `71f43419e53dfcb16330748f3b933ac0efcc4778`, an MIT-licensed upstream
   repository. Their paths and hashes are recorded in the third-party notice,
   and the upstream MIT notice is packaged with Relay.
5. Material without documented provenance or redistribution authority is
   excluded from the Apache-2.0 grant by exact path and remains behind an open
   evidence gate. A public checkout does not imply permission to redistribute
   such material in binaries.
6. Electron/Chromium notices and Relay legal notices are packaged as attested
   resources. Dependency license/SBOM inventories are regenerated for release
   evidence.
7. Versioned release output starts from a nonexistent destination, freezes via
   a private staging directory, accepts only the requested artifacts plus
   `SHA256SUMS.txt`, and never reuses or replaces an existing version folder.
   Existing 1.0.1 artifact identities are outside this ADR and are unchanged.

## Consequences

- Recipients receive explicit copyright and patent permissions for Relay-owned
  work instead of conflicting `UNLICENSED` metadata.
- Contributors must have the right to submit each contribution under
  Apache-2.0 and must record any third-party material separately.
- Model, ComfyUI, Desktop, FFmpeg, codec, trademark and artifact-specific
  external gates remain open until the named owner accepts exact evidence.
- Both repository lockfile root entries declare `Apache-2.0` and must remain
  aligned with their first-party manifests. Dependency metadata remains
  evidence about the locked packages, not authority to relicense them.

## Rejected alternatives

- `UNLICENSED`: contradicts the intended open-source permissions.
- Changing `private` to `false`: unnecessary and would enable accidental npm
  publication without adding source rights.
- Claiming Apache-2.0 for the whole dependency/runtime/model stack: legally
  inaccurate because those works keep their own licenses.
- A custom source license: less interoperable and less auditable than a
  standard SPDX license.

## Verification

`npm run verify:oss` checks manifest metadata, required legal files, third-party
boundaries, packaged notices, privacy exclusions, source-control ignores and
the fail-closed versioned release contract.
