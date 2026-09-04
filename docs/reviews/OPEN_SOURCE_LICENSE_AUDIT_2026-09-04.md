# Relay source-license and redistribution audit — 2026-09-04

## Scope and conclusion

This audit covers repository source, checked-in assets, locked JavaScript
dependencies, Electron packaging inputs, external component catalog entries,
and versioned release-freeze behavior. It does not provide legal approval for
third-party redistribution.

Relay-owned source now uses the standard Apache License 2.0. `private: true`
remains in npm manifests solely to prevent accidental package publication.
Third-party material keeps its own license, and exact items whose provenance
is not evidenced are excluded rather than being described as open source.

The initial source and unpacked-package audit did not touch an installer or
public release. A later explicit request produced one current-source unsigned
1.0.1 Setup, preserved the superseded root artifact in the ignored build cache,
and froze the new bytes under `release-unsigned/v1.0.1/`. No public release,
tag, remote repository or installed application was modified.

## Evidence inventory

### Relay-owned source — proven metadata

- `LICENSE` exactly matches the Apache Software Foundation's standard Apache
  License 2.0 text after line-ending and final-newline normalization.
- All nine first-party package manifests and both package-lock root entries
  declare the exact SPDX identifier `Apache-2.0`. First-party manifests retain
  `private: true` to prevent accidental npm publication.
- `NOTICE`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md` and
  `THIRD_PARTY_NOTICES.md` define attribution, contribution, reporting and
  distribution boundaries.
- ADR-017 and D-024 record the decision. R-037 records the risk of an
  over-broad license claim.

### Locked JavaScript graph — declared-license evidence

`apps/control-plane/package-lock.json` contains 399 non-root packages and every
entry has a non-empty version, source, integrity and license field. Thirteen
license expressions occur: MIT, ISC, Apache-2.0, MPL-2.0, BSD-3-Clause,
BlueOak-1.0.0, BSD-2-Clause, `(MIT OR CC0-1.0)`, `(WTFPL OR MIT)`, 0BSD,
Python-2.0, WTFPL and `WTFPL OR ISC`.

This is proven package-declared metadata, not a legal compatibility opinion.
The release process must regenerate the source license ledger and CycloneDX
SBOM, retain the exact packages' license texts, and review any dependency or
license-expression change.

The generated CycloneDX 1.6 source SBOM gives all 399 lock entries unique
`bom-ref` values and preserves each normalized npm lock path. Relay's root
component declares Apache-2.0. Single SPDX identifiers use `license.id`, while
the three compound SPDX expressions use CycloneDX's `expression` union member.

### Comfy-Org workflow templates — proven origin and MIT license

The compiler pins Comfy-Org/workflow_templates revision
`71f43419e53dfcb16330748f3b933ac0efcc4778`. Independent byte comparison against
that revision recorded exact matches:

| Template | SHA-256 |
| --- | --- |
| `video_minimax_h3_t2v.json` | `2400b01a7c8acae3fed038c0372f08bacb90d2cdf915febadbe7e3f9802506ea` |
| `video_minimax_h3_i2v.json` | `4dc94e9ea308c1d60409e7f55dba5e2788dab4659c2dbb90f1e9481498767540` |
| `video_minimax_h3_r2v.json` | `14b30659a057547e02bdd4bbbdda3f8670aa6d7d81d1d8d99c4f9ad1e2eabc44` |

The upstream repository is MIT-licensed with copyright line
`Copyright (c) 2023-present Comfy Org`. The complete MIT text is preserved in
`THIRD_PARTY_NOTICES.md` and packaged as an attested legal resource. These
facts cover only the JSON templates, not the model artifacts linked in their
embedded documentation.

### Checked-in executables and visual assets

- `native/relay-winbroker/bin/relay-winbroker.exe` is a generated native-helper
  output and is excluded by `native/**/bin/`; release builds must reproduce and
  attest it from the helper source.
- Prototype files named `Comfy Desktop.exe` and `python.exe` are tiny text test
  fixtures, not redistributed copies of those products. A global `*.exe`
  ignore is deliberately forbidden so those fixtures remain reviewable.
- Relay logo/header/installer artwork is treated as project material, while
  Apache-2.0 grants no trademark rights.
- `apps/control-plane/src/renderer/assets/platuring-avatar.png` was supplied by
  the release owner for use and redistribution with Relay. The exact 25,194-byte
  file is pinned by SHA-256 in `THIRD_PARTY_NOTICES.md`, remains outside the
  Apache-2.0 grant, and enters source/package only through the explicit renderer
  allowlist. Unknown or symlinked asset inputs remain rejected.

### Separately obtained software and models — open external gates

ComfyUI Core, ComfyUI Desktop, FFmpeg/FFprobe, MiniMax H3 weights and VAEs,
Qwen encoders, quantized/repacked files, Turbo LoRA, Ref2VA artifacts and
optional embeddings are not relicensed by Relay. Their precise licenses,
source/offer obligations, territories, acceptable-use terms, codec/patent
issues and redistribution routes remain controlled by `docs/EXTERNAL_GATES.md`.
This work does not close those gates.

## Packaging and publication controls

Relay's `LICENSE`, `NOTICE` and `THIRD_PARTY_NOTICES.md` are explicit
electron-builder resources under `resources/licenses/Relay/`. The frozen input
inventory includes and hashes each file, and resource attestation rejects a
missing, changed, unlisted, symlinked or out-of-contract file.

Source-control rules also exclude local projects, generated media, model and
runtime data, release/build outputs, native binaries, local environment files,
npm credentials, secret directories, private keys and signing certificates.
An `.env.example` remains eligible for review if one is intentionally added.

The versioned release freezer:

1. rejects a destination that already exists;
2. creates a random contained staging directory;
3. copies artifacts with exclusive-create semantics and re-hashes them;
4. writes one checksum document with exclusive-create semantics;
5. requires exactly the requested artifact names plus `SHA256SUMS.txt`;
6. atomically renames staging to the version destination;
7. removes only its private staging directory after failure.

It contains no hard-coded 1.0.1 replacement path and never recursively removes
the final version directory. Root and control-plane `.gitignore` rules exclude
versioned release output, build caches, local projects, native outputs, models,
media and downloads from source commits.

## Verification results

- OSS hygiene verifier: passed; 12 manifests, 399 dependencies, 13 license
  expressions, 3 packaged legal notices, privacy and release whitelist passed.
- Focused Node contract tests: 12 passed, 0 failed.
- Source-license ledger: generated for 399 dependencies.
- CycloneDX source SBOM: generated for 399 dependencies; exact license-union,
  root-license, unique-reference and lock-path assertions passed.
- Renderer asset packaging contract: explicit allowlist, noticed profile asset
  inclusion, exact SHA-256 evidence and unknown-input rejection assertions passed.
- Full control-plane suite: 521 tests, 520 passed, 0 failed and one explicitly
  skipped anonymous-network probe.
- Workflow compiler suite: 83 passed, 0 failed. Static graph lint suite: 56
  passed, 0 failed. Main, preload and renderer TypeScript projects: 3 passed,
  0 failed. Root fast lane: 5 passed, 0 failed.
- Product smoke: local runtime 47 passed, H3 compiler 12 passed, control-plane
  520 passed with one network probe skipped, UI readiness passed, and the final
  evidence remained `media_generated=0` and `prompt_submitted=0`.
- A fresh unsigned unpacked application was built without launching the app.
  Package attestation accepted 11 resource mappings and 53 declared resource
  files. The runtime subtree contains 50 files and no `test`, `tests`,
  `fixture`, `fixtures`, `example` or `examples` directory. Content scanning
  found no Administrator profile path or synthetic secret/token path marker.
- The unpacked artifact physically contains Relay's `LICENSE`, `NOTICE` and
  `THIRD_PARTY_NOTICES.md` under `resources/licenses/Relay/`, plus Electron's
  `LICENSE.electron.txt` and `LICENSES.chromium.html` at the application root.
  That evidence predates the authorized profile update; the replacement package
  must attest the exact noticed image. Package metadata and PE version
  information continue to use the neutral `Relay contributors` value.
- Source-only offline verification, public-evidence lint and open-source hygiene
  verification passed. The later Setup build passed package input, legal file,
  native helper, adapter, exact-byte freeze and checksum gates. Full installed-
  runtime verification is deliberately not claimed because the installer was
  not executed.

## Remaining release requirements

1. Close or explicitly waive each relevant external distribution gate for the
   exact release composition; Apache-2.0 alone is not sufficient.
2. Keep the profile image limited to the exact release-owner-authorized bytes
   and the About identity use recorded in `THIRD_PARTY_NOTICES.md`; any
   replacement or expanded use reopens its external provenance gate.
3. Before publishing the frozen Setup, perform the still-missing isolated
   installer-runtime validation against those exact bytes. Any different public
   binary must repeat the clean-package inspection and freeze.
