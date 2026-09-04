# Relay open-source readiness audit — 2026-09-04

## Scope

This audit covers the current source tree, source-license metadata, vendored
template provenance, JavaScript dependency inventory, source SBOM, public-file
privacy checks, source-control exclusions and the declared package-resource
contract. It includes a clean inspection of the newly rebuilt unsigned unpacked
application. It does not approve third-party model/runtime redistribution or a
different versioned installer.

The pre-existing conflicting 1.0.1 identities remain outside this audit. After
the source audit, an explicit follow-up produced one current-source unsigned
Setup and immutable local checksum freeze; the older identities were not
deleted or reconciled. No tag, remote repository or installed application was
modified.

## Proven conclusions

- `LICENSE` is an exact content match, after normalizing line endings and the
  final newline, to the [Apache Software Foundation's published Apache License
  2.0 text](https://www.apache.org/licenses/LICENSE-2.0.txt). `NOTICE`
  identifies Relay contributors and preserves the trademark boundary.
- All nine first-party package manifests and both package-lock root entries
  declare the exact SPDX identifier `Apache-2.0`. Each first-party manifest
  remains `private: true` to prevent accidental npm publication; this does not
  narrow the repository source license.
- `THIRD_PARTY_NOTICES.md` keeps third-party works outside Relay's Apache-2.0
  grant and reproduces the required MIT notice for the vendored Comfy-Org
  templates.
- The three H3 template JSON files byte-match the pinned
  `Comfy-Org/workflow_templates` revision
  `71f43419e53dfcb16330748f3b933ac0efcc4778`:

  | File | SHA-256 |
  | --- | --- |
  | `video_minimax_h3_t2v.json` | `2400b01a7c8acae3fed038c0372f08bacb90d2cdf915febadbe7e3f9802506ea` |
  | `video_minimax_h3_i2v.json` | `4dc94e9ea308c1d60409e7f55dba5e2788dab4659c2dbb90f1e9481498767540` |
  | `video_minimax_h3_r2v.json` | `14b30659a057547e02bdd4bbbdda3f8670aa6d7d81d1d8d99c4f9ad1e2eabc44` |

- The control-plane lock contains 399 non-root packages and 13 declared
  license expressions. Every locked package has a version, source URL,
  integrity value and non-empty declared license.
- The generated CycloneDX 1.6 source SBOM has 399 unique `bom-ref` values,
  preserves each normalized npm lock path, identifies Relay itself as
  Apache-2.0, uses `license.id` for a single SPDX identifier, and uses
  `expression` for compound SPDX expressions.
- Electron Builder is configured to package Relay's `LICENSE`, `NOTICE` and
  `THIRD_PARTY_NOTICES.md` under `resources/licenses/Relay/`. Package-resource
  attestation rejects missing, changed, extra, symlinked or unfrozen mapped
  resources.
- Production compiler code no longer imports a test fixture. Electron Builder
  uses six narrow runtime-directory mappings instead of copying the repository
  `packages` and `schemas` trees. The fresh unpacked artifact contains 50
  runtime files; no test, fixture or example directory and no private-path test
  marker is present.
- Application package metadata, the unpacked `app.asar` manifest and Relay.exe
  version information use `Relay contributors`, while public copy describes the
  software's functions without claiming a personal creator identity.
- The release-owner-supplied profile image at
  `apps/control-plane/src/renderer/assets/platuring-avatar.png` is recorded in
  `THIRD_PARTY_NOTICES.md`, included by the explicit renderer asset allowlist
  and frozen input inventory, and remains outside Relay's Apache-2.0 grant.
  Unknown or symlinked renderer assets still fail the build instead of entering
  a package implicitly.
- The reviewed public/legal documents contain no host-private absolute user
  path. The focused secret scan found no embedded credential, private key or
  access token in the reviewed source inputs.

## Verification evidence

Commands executed from the repository root:

```powershell
npm --prefix apps/control-plane run licenses:source
npm --prefix apps/control-plane run sbom:source
npm run verify:oss
node --test apps/control-plane/tests/open-source-hygiene-contract.test.mjs apps/control-plane/tests/input-inventory-contract.test.mjs apps/control-plane/tests/package-resource-attestation.test.mjs
npm --prefix apps/control-plane test
npm --prefix apps/control-plane run typecheck
npm --prefix packages/workflow/h3-compiler test
npm test
npm run smoke:product
npm run build:product
npm run package:win:dir
node apps/control-plane/scripts/verify-offline.mjs --source-only
node apps/control-plane/scripts/lint-public-evidence.mjs
```

Results:

- Source license ledger: 399 components generated.
- CycloneDX source SBOM: 399 components generated.
- Open-source verifier: passed; 12 manifests, 399 dependencies, 13 license
  expressions, three packaged Relay legal notices, privacy and release
  whitelist gates passed.
- Focused contract suite: 12 passed, 0 failed.
- Control-plane suite: 521 total, 520 passed, 0 failed, one anonymous-network
  probe explicitly skipped.
- H3 compiler: 83 passed, 0 failed. Static graph lint: 56 passed, 0 failed.
  TypeScript projects: 3 passed, 0 failed. Root fast lane: 5 passed, 0 failed.
- Product smoke completed with 47 local-runtime tests, 12 compiler tests and the
  complete control-plane suite; no media was generated and no prompt was
  submitted.
- Fresh unpacked package: 15 resource mappings and 75 declared resource files
  attested before the About profile update. The replacement package must repeat
  this attestation and confirm that the single noticed profile asset is present,
  while forbidden test/example trees and private-path markers remain absent.
- Source-only offline verification and public-evidence lint passed. The later
  unsigned Setup build passed static packaging, resource, helper, adapter,
  exact-byte freeze and SHA-256 checks. The full installed-runtime gate remains
  intentionally unclaimed because the installer was not executed.

Generated ledger and SBOM files are local evidence under the ignored
`apps/control-plane/artifacts/` directory; they are regenerated for a release
rather than committed as stale evidence.

## Remaining distribution gates

The following are not defects in Relay's source-license grant, but remain
separate release decisions:

1. ComfyUI, ComfyUI Desktop, FFmpeg/FFprobe, MiniMax H3 model artifacts, Qwen
   encoders, repacks/quantizations, Turbo LoRA, Ref2VA material and optional
   embeddings retain their own exact terms. See `docs/EXTERNAL_GATES.md` and
   `docs/RISK_REGISTER.md`; Apache-2.0 does not close those gates.
2. The clean unpacked inspection and frozen Setup byte/checksum verification are
   complete for the current local build. On 2026-09-04 the release owner
   explicitly accepted an isolated-VM install/launch-test waiver for only the
   100,871,043-byte unsigned Setup whose SHA-256 is
   `345b32283cd77b989eae92b4cf96c929378ff52a19847ccfff3e0aca5a57a7fe`.
   Installation remains untested and must not be described as verified. Any
   changed binary voids this waiver and must repeat release attestation.
3. The exact 25,194-byte profile image supplied and authorized by the release
   owner is included under the limited terms in `THIRD_PARTY_NOTICES.md`; it is
   not Apache-2.0 material. Any replacement or expanded use reopens
   `EXT-SOURCE-ASSET-PROVENANCE`.
4. Code-signing publisher identity is independent of source licensing and
   remains an external certificate/release matter.

These remaining gates must be reported precisely; they do not justify a claim
that third-party artifacts have been relicensed by Relay.
