# Third-party notices and redistribution boundary

This document is an engineering inventory, not legal advice or a substitute
for the license text shipped by an upstream project.

The repository-level Apache-2.0 license applies only to original Relay source,
documentation, tests, and assets for which the contributors have the right to
grant that license. It does not relicense third-party software, model weights,
templates, trademarks, or other material. Opening this repository does not by
itself authorize redistribution of every component that Relay can detect,
download, or interoperate with.

## Packaged framework and JavaScript dependencies

The Windows application is built with Electron. Electron is MIT-licensed and
incorporates Chromium and other software under their respective licenses. A
packaged Electron application contains Electron's `LICENSE.electron.txt` and
Chromium's `LICENSES.chromium.html`; those files must remain in distributions.

The locked control-plane dependency graph currently contains 399 non-root
packages. Its declared license expressions are:

| SPDX or package expression | Locked packages |
| --- | ---: |
| `MIT` | 291 |
| `ISC` | 37 |
| `Apache-2.0` | 29 |
| `MPL-2.0` | 12 |
| `BSD-3-Clause` | 10 |
| `BlueOak-1.0.0` | 8 |
| `BSD-2-Clause` | 6 |
| `(MIT OR CC0-1.0)` | 1 |
| `(WTFPL OR MIT)` | 1 |
| `0BSD` | 1 |
| `Python-2.0` | 1 |
| `WTFPL` | 1 |
| `WTFPL OR ISC` | 1 |

This count is derived from `apps/control-plane/package-lock.json`; it is not a
replacement for the packages' own license texts. Before a release, run:

```powershell
npm --prefix apps/control-plane run licenses:source
npm --prefix apps/control-plane run sbom:source
```

The generated inventory records exact names, versions, resolved artifacts,
integrity values, and declared licenses. Build tools such as TypeScript,
esbuild, Vitest, and electron-builder normally do not become Relay runtime
code merely because they are used to build it; any code they copy into an
artifact remains governed by its own license.

## Vendored Comfy-Org workflow templates

The following files are exact-byte copies from the MIT-licensed
[`Comfy-Org/workflow_templates`](https://github.com/Comfy-Org/workflow_templates/tree/71f43419e53dfcb16330748f3b933ac0efcc4778)
repository at revision `71f43419e53dfcb16330748f3b933ac0efcc4778`.
They are third-party MIT material, not Relay-authored Apache-2.0 material:

| Local path | SHA-256 |
| --- | --- |
| `packages/workflow/h3-compiler/templates/video_minimax_h3_t2v.json` | `2400b01a7c8acae3fed038c0372f08bacb90d2cdf915febadbe7e3f9802506ea` |
| `packages/workflow/h3-compiler/templates/video_minimax_h3_i2v.json` | `4dc94e9ea308c1d60409e7f55dba5e2788dab4659c2dbb90f1e9481498767540` |
| `packages/workflow/h3-compiler/templates/video_minimax_h3_r2v.json` | `14b30659a057547e02bdd4bbbdda3f8670aa6d7d81d1d8d99c4f9ad1e2eabc44` |

The upstream MIT notice is reproduced at the end of this file and must remain
with source or binary distributions that include these templates. This
provenance covers the template JSON only; model files referenced from inside a
template retain their separate licenses and are not included in the JSON.

## Relay brand/profile asset

`apps/control-plane/src/renderer/assets/platuring-avatar.png` was supplied by
the Relay release owner for use and redistribution with Relay. Its SHA-256 is
`138b2925844d1464ba7f5b4beb736c6fda4114c3c25127341069ebf497b2818e`.
It is included by the renderer's explicit asset allowlist and frozen build
inventory. The image is **not licensed under Relay's Apache-2.0 license**;
copyright and any trademark or personality rights remain with their respective
rightsholders. Distribution with unmodified Relay is permitted, but this notice
does not grant a separate right to reuse the image as a logo, avatar or identity
asset outside Relay.

The files named `Comfy Desktop.exe` and `python.exe` under prototype fixture
directories are tiny plain-text test markers, not copies of those programs.
`native/relay-winbroker/bin/relay-winbroker.exe` is a local build output from
the Relay helper source and is ignored; release builds must reproduce and
attest it rather than treating the checked-out binary as source.

## Components obtained separately

Relay's component catalog can refer to software and model artifacts that are
not stored in this source repository and are not covered by Apache-2.0:

| Component | Relevant upstream terms | Relay boundary |
| --- | --- | --- |
| ComfyUI Core | GPL-3.0 upstream | Separate runtime; source/offer and distribution obligations depend on the exact delivery method. |
| ComfyUI Desktop | Upstream AGPL/commercial terms require separate review | Detect or obtain only under the approved delivery route; Relay's license grants no Desktop rights. |
| Electron / Chromium | MIT plus Chromium third-party notices | Notices from the exact packaged Electron distribution must remain present. |
| FFmpeg / FFprobe | Depends on the exact build and codecs; the pinned BtbN catalog item is a GPL build | Preserve the selected build's license/source materials and review codec-patent obligations. |
| MiniMax H3 weights and VAE files | MiniMax H3 Community License and per-file upstream terms | Model rights, geography, acceptable-use, attribution, and downstream restrictions remain separate. |
| Qwen text encoder and quantized/repacked files | Original model license plus packager/quantizer terms | Require per-file provenance; a repository badge is not sufficient. |
| Turbo LoRA, Ref2VA, and optional embeddings | Artifact-specific upstream terms | Do not expose or redistribute until each exact artifact is approved. |

See `docs/EXTERNAL_GATES.md` and `docs/RISK_REGISTER.md`. Those gates remain
open unless a named human/external owner accepts evidence for the exact
artifact, version, territory, and delivery method. This source-license change
does not close any of them.

## Names and marks

MiniMax H3, ComfyUI, Comfy-Org, Electron, Chromium, FFmpeg, Qwen, Windows, and
other names are used only to identify compatible systems or upstream
components. Their owners retain all applicable rights. Relay is an independent
third-party project and is not an official product of, sponsored by, or
affiliated with those upstream projects merely because it interoperates with
them.

The Apache License does not grant permission to use Relay's name, logo, or
trade dress except for reasonable identification of the origin of the work.

## Comfy-Org/workflow_templates MIT license

Copyright (c) 2023-present Comfy Org

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
