const REVISION = "4cc1d817b6184899b41293954329f576cb5ae86b";
const REPOSITORY = "https://huggingface.co/Comfy-Org/MiniMax-H3";

function artifact({ role, relativePath, byteLength, sha256, requirement, status = "metadata_proven" }) {
  return Object.freeze({
    role,
    relative_path: relativePath,
    filename: relativePath.slice(relativePath.lastIndexOf("/") + 1),
    expected_byte_length: byteLength,
    expected_artifact_sha256: `sha256:${sha256}`,
    source: Object.freeze({
      repository: REPOSITORY,
      revision: REVISION,
      relative_path: relativePath,
      publisher_role: "comfy_official_packaging_not_model_origin",
      evidence_status: status
    }),
    requirement
  });
}

export const H3_ATTACH_PROFILE = Object.freeze({
  profile_id: "h3-fl2va-int8-qwen-nvfp4-turbo8-metadata-v1",
  profile_status: "attach_candidate_not_recipe_approval",
  official_minimum_vram_claim: "none_known",
  assets: Object.freeze([
    artifact({
      role: "fl2va_diffusion",
      relativePath: "diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors",
      byteLength: 20_970_379_616,
      sha256: "e889202c41dafb67b10d67b97f0d8541508036a6090af23425a5c2615d03c47a",
      requirement: "required"
    }),
    artifact({
      role: "qwen_text_encoder",
      relativePath: "text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
      byteLength: 15_687_142_551,
      sha256: "35a88d51044231fe332301d7a62aa81e3f2cba62febeb446e2c1e3e0ef76f2c6",
      requirement: "required"
    }),
    artifact({
      role: "video_vae",
      relativePath: "vae/minimax_h3_video_vae_fp16.safetensors",
      byteLength: 5_207_808_496,
      sha256: "7c1f131492e7eddacaac9069a61b81bdd39de5cc96561e677c5eab1cdce5e522",
      requirement: "required"
    }),
    artifact({
      role: "audio_vae",
      relativePath: "vae/minimax_h3_audio_vae_fp32.safetensors",
      byteLength: 605_254_808,
      sha256: "8e505d95dd1561d47abd43d4238fd40d9bb1ae9e147ed0a4cba778d76ae4db48",
      requirement: "required"
    }),
    artifact({
      role: "fl2va_turbo_8step_lora",
      relativePath: "loras/minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors",
      byteLength: 1_956_193_000,
      sha256: "2339acdf19bfe123f46b971ea35d367a84adb85de43627e1eceafa5a5b2b111e",
      requirement: "optional_experimental",
      status: "experimental_metadata_only"
    })
  ])
});

export const AUTHORITY = Object.freeze({
  product_boundary: "compile_and_handoff_only_user_runs_h3_in_comfyui",
  discovery: "bounded_static_known_or_user_selected_roots_only",
  custom_node_import: "forbidden",
  comfy_launch: "forbidden",
  model_execution: "forbidden",
  model_download: "pinned_https_only_after_four_explicit_acknowledgements",
  prompt_submission: "forbidden",
  queue_submission: "forbidden",
  external_model_ownership: "external_read_only_never_tool_owned_or_deleted"
});
