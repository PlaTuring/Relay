# Host MiniMax H3 runtime probe — 2026-08-27

## Scope

Read-only local qualification of an existing ComfyUI Portable installation. The probe started the local server with API nodes and manager UI disabled, queried `/system_stats` and `/object_info`, and did not call `/prompt`, submit a queue item, or generate media.

## Installation discovered

Host-specific paths and hardware identifiers are intentionally omitted from
the public evidence. The complete record remains local to the qualification
owner.

- Root: supported local fixed NTFS path (redacted)
- ComfyUI commit: `72865f4f27eaf5396f8f36370e0a2be3a9a090ee`
- Deployment: local portable with embedded Python
- ComfyUI: `0.33.1`
- Frontend: `1.48.7`
- Workflow templates: `0.11.41`
- Python: `3.13.14`
- PyTorch: `2.13.0+cu130`
- PyAV: `18.0.0`
- GPU: supported NVIDIA GPU (exact model and capacity redacted)
- RAM: sufficient for the qualification run (exact capacity redacted)

The probe command bound only to `127.0.0.1:8199` and included:

```text
--disable-auto-launch --disable-api-nodes --disable-manager-ui --lowvram --reserve-vram 2
```

## Local H3 assets discovered

- `models/diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors`
- `models/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors`
- `models/vae/minimax_h3_video_vae_fp16.safetensors`
- `models/vae/minimax_h3_audio_vae_fp32.safetensors`
- `models/loras/minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors`

The four required FL2VA files occupy about 39.6 GiB; the optional Turbo LoRA occupies about 1.82 GiB. The installer must classify these as external read-only candidates and offer reuse instead of downloading duplicates.

## Local templates discovered

The installed official template package contains:

- `video_minimax_h3_t2v.json`
- `video_minimax_h3_i2v.json`
- `video_minimax_h3_r2v.json`

## Node availability

The local `/object_info` response contains:

- `MiniMaxH3ImageToVideo`
- `MiniMaxH3ReferenceToVideo`
- `EmptyMiniMaxH3LatentAV`
- `UNETLoader`
- `CLIPLoader`
- `VAELoader`
- `CreateVideo`
- `SaveVideo`

## Result

The existing Portable installation is a valid real fixture for static discovery, model reuse, workflow compilation, managed local launch, and visible ComfyUI handoff. This evidence does not certify a formal H3 generation, public redistribution rights, a signed installer, or official ComfyUI Desktop integration.
