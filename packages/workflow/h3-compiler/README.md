# MiniMax H3 visual workflow compiler

This package deterministically compiles a strict `ProjectSpec` into an editable ComfyUI visual workflow derived from vendored, hash-locked official templates. It only exports local JSON. MiniMax H3 generates video and native audio inside ComfyUI after the user opens the graph and clicks Run.

```powershell
node .\bin\h3-compile.mjs compile `
  --project .\examples\project.t2v.json `
  --output-dir C:\an-existing-user-selected-directory
```

The CLI accepts only the `compile`, `--project`, and `--output-dir` argument array. It emits one JSON result on stdout, sanitized JSON errors on stderr, refuses overwrite, and returns `EXPORT_ONLY`; it never starts ComfyUI or performs automatic submission. Endpoint values are paths already relative to the managed local ComfyUI input directory.

`duration` is the requested total (`5`, `10`, `15`, `30`, or `60` seconds). The optional `segment_duration` is `5`, `10`, or `15` and defaults to `5`; it controls how `30`/`60`-second T2V and FL2VA projects are divided. For example, `duration: 30` plus `segment_duration: 5` produces six named H3 segments inside one editable ComfyUI dependency graph. A short total (`5`/`10`/`15`) remains one segment at that total duration.

The long T2V/FL2VA graph uses only pinned Comfy core class identities: each H3 subgraph output is split by `GetVideoComponents`; `ImageFromBatch(batch_index=-1)` feeds the prior final frame into the next H3 `first_frame`; current core `BatchImagesNode` and `AudioConcat` join ordered frames and native audio; `CreateVideo` rebuilds at 24 fps; and `Video Slice` trims the assembled video to the exact requested total before the single compact `SaveVideo`. The tool still does not run or queue this graph—generation begins only after the user opens it in ComfyUI and clicks Run.

This chained H3-subgraph path is intentionally marked **Experimental**, not Stable: [ComfyUI issue #15733](https://github.com/Comfy-Org/ComfyUI/issues/15733) and the still-unmerged [PR #15734](https://github.com/Comfy-Org/ComfyUI/pull/15734) document an intermittent tensor `version_counter` failure in repeated H3 subgraph inference. The segment plan carries `EXPERIMENTAL_H3_SUBGRAPH_TAIL_FRAME_CHAIN`. Long Ref2VA remains fail-closed after its first safely exportable segment because mixing the Ref2VA and FL2VA contracts has not been proven.

The optional closed `advanced` object exposes only settings proven by the pinned official templates: a non-negative safe-integer `seed`, `seed_policy` (`fixed` or `randomize`), and `sampling_profile` (`quality_20`, `quality_25`, or the official `turbo_8` LoRA path). The two quality profiles use the same pinned base graph with 20 or 25 steps; Turbo uses the pinned eight-step LoRA branch. The compiler deliberately keeps H3's official `res_multistep` sampler, `simple` scheduler, 24 fps, native stereo audio path, and guidance-distilled behavior fixed. It does not accept CFG, negative prompts, adjustable FPS, arbitrary sampler steps, or arbitrary LoRA strengths.

The minimal Ref2VA path uses `mode: "ref2va"` with `endpoints.reference_images` containing one or two staged local image paths. Those images bind, in order, to the official R2V template's `<Picture 1>` and `<Picture 2>` reference slots; they are reference conditioning, never first/last-frame endpoints. This path accepts the pinned 20-step standard and 25-step high-quality profiles; Turbo remains fail-closed. Missing Ref2VA weights are an installation-state gate in the desktop control plane, not a reason to hide or replace the mode, and the compiler never downloads them.

Canvas and resolution are independent. `canvas` is only an aspect-ratio ID: `21:9`, `16:9`, `3:2`, `4:3`, `1:1`, `3:4`, `2:3`, or `9:16`; it does not encode a fixed width and height. `resolution_megapixels` is the official `ResolutionSelector` float input and accepts the core node's `0.1`–`16.0` range. Defaults are `canvas: "9:16"` and `resolution_megapixels: 0.98`.

The exported graph keeps the official `ResolutionSelector`, its visible width/height links, the official aspect-ratio label, the independently selected megapixel value, and `multiple=32`. Actual width and height are resolved with the official formula (`megapixels × 1024²`, rounded to the nearest multiple of 32) and written into both the H3 call and pinned H3 node. Thus `9:16` at `0.4` MP resolves to `480 × 864`, while the same `9:16` at `0.98` MP resolves to `768 × 1344`.

Large template `MarkdownNote` panels and the detached size-preview helper are removed from the visible handoff. The remaining nodes are normalized into a compact layout and `SaveVideo` is constrained to `380 × 150`; no execution node, model node, or media path is hidden by that visual cleanup.
