export const COMPILER_VERSION = "0.1.0";
export const PROJECT_SCHEMA_VERSION = "1.0.0";
export const TEMPLATE_REVISION = "71f43419e53dfcb16330748f3b933ac0efcc4778";

export const MODES = Object.freeze(["t2v", "first_frame", "last_frame", "first_last_frame", "ref2va"]);
export const DURATIONS = Object.freeze([5, 10, 15, 30, 60]);
export const SEGMENT_DURATIONS = Object.freeze([5, 10, 15]);
export const RESOLUTION_MEGAPIXEL_PRESETS = Object.freeze([
  0.2,
  0.3,
  0.4,
  0.5,
  0.6,
  0.7,
  0.8,
  0.9,
  0.98,
  1.0,
  1.2,
  1.5,
  1.8,
  2.0,
]);
export const DEFAULT_RESOLUTION_MEGAPIXELS = 0.98;
export const MIN_RESOLUTION_MEGAPIXELS = 0.1;
export const MAX_RESOLUTION_MEGAPIXELS = 16.0;
export const DEFAULT_CANVAS = "9:16";
export const CANVASES = Object.freeze({
  "21:9": Object.freeze({
    selector_aspect_ratio: "21:9 (Ultrawide)",
    ratio_width: 21,
    ratio_height: 9,
  }),
  "16:9": Object.freeze({
    selector_aspect_ratio: "16:9 (Widescreen)",
    ratio_width: 16,
    ratio_height: 9,
  }),
  "3:2": Object.freeze({
    selector_aspect_ratio: "3:2 (Photo)",
    ratio_width: 3,
    ratio_height: 2,
  }),
  "4:3": Object.freeze({
    selector_aspect_ratio: "4:3 (Standard)",
    ratio_width: 4,
    ratio_height: 3,
  }),
  "1:1": Object.freeze({
    selector_aspect_ratio: "1:1 (Square)",
    ratio_width: 1,
    ratio_height: 1,
  }),
  "3:4": Object.freeze({
    selector_aspect_ratio: "3:4 (Portrait Standard)",
    ratio_width: 3,
    ratio_height: 4,
  }),
  "2:3": Object.freeze({
    selector_aspect_ratio: "2:3 (Portrait Photo)",
    ratio_width: 2,
    ratio_height: 3,
  }),
  "9:16": Object.freeze({
    selector_aspect_ratio: "9:16 (Portrait Widescreen)",
    ratio_width: 9,
    ratio_height: 16,
  }),
});

function roundHalfEven(value) {
  const lower = Math.floor(value);
  const fraction = value - lower;
  if (Math.abs(fraction - 0.5) < Number.EPSILON * Math.max(1, Math.abs(value)) * 4) {
    return lower % 2 === 0 ? lower : lower + 1;
  }
  return Math.round(value);
}

export function resolveCanvasSize(canvasId, megapixels) {
  const canvas = CANVASES[canvasId];
  if (!canvas || typeof megapixels !== "number" || !Number.isFinite(megapixels)
    || megapixels < MIN_RESOLUTION_MEGAPIXELS || megapixels > MAX_RESOLUTION_MEGAPIXELS) return null;
  const totalPixels = megapixels * 1024 * 1024;
  const scale = Math.sqrt(totalPixels / (canvas.ratio_width * canvas.ratio_height));
  return Object.freeze({
    width: roundHalfEven((canvas.ratio_width * scale) / 32) * 32,
    height: roundHalfEven((canvas.ratio_height * scale) / 32) * 32,
  });
}

export const SEED_POLICIES = Object.freeze(["fixed", "random_per_compile"]);
export const SAMPLING_PROFILE_STEPS = Object.freeze({
  quality_20: 20,
  quality_25: 25,
  turbo_8: 8,
});
export const SAMPLING_PROFILES = Object.freeze(Object.keys(SAMPLING_PROFILE_STEPS));
export const DEFAULT_ADVANCED_OPTIONS = Object.freeze({
  seed: 1,
  seed_policy: "random_per_compile",
  sampling_profile: "quality_20",
});

export const OFFICIAL_FIXED_CAPABILITIES = Object.freeze({
  quality_steps: 20,
  high_quality_steps: 25,
  turbo_steps: 8,
  turbo_model_strength: 1,
  sampler: "res_multistep",
  scheduler: "simple",
  denoise: 1,
  fps: 24,
  audio: "native_stereo_joint_generation",
  guidance: "distilled_no_cfg_scale",
});

export const TEMPLATE_SPECS = Object.freeze({
  t2v: Object.freeze({
    filename: "video_minimax_h3_t2v.json",
    bytes: 67891,
    sha256: "2400b01a7c8acae3fed038c0372f08bacb90d2cdf915febadbe7e3f9802506ea",
    structure_sha256: "0cf7e16c486144d31424e2dd2122fca41c3bd9bc9450904b94161566202b46f9",
    subgraph_id: "79dd8a95-ce9d-4c14-b264-2162e8bec5ce",
    call_node_id: 140,
    resolution_node_id: 115,
    width_link_id: 246,
    height_link_id: 247,
  }),
  i2v: Object.freeze({
    filename: "video_minimax_h3_i2v.json",
    bytes: 71242,
    sha256: "4dc94e9ea308c1d60409e7f55dba5e2788dab4659c2dbb90f1e9481498767540",
    structure_sha256: "4408836c513a4908161c186ecb6df56b219f2fe1f8bf184df26603058f3d604e",
    subgraph_id: "4c314f31-ecda-4b08-ae98-faaba1bf613f",
    call_node_id: 105,
    resolution_node_id: 115,
    image_node_id: 114,
    image_link_id: 218,
    width_link_id: 219,
    height_link_id: 220,
  }),
  r2v: Object.freeze({
    filename: "video_minimax_h3_r2v.json",
    bytes: 45121,
    sha256: "14b30659a057547e02bdd4bbbdda3f8670aa6d7d81d1d8d99c4f9ad1e2eabc44",
    structure_sha256: "b70440f32ed3ca78243c897f45b4999fb6fd87b73a38d8302162b6d63f1a245c",
    call_node_id: 136,
    resolution_node_id: 115,
    prompt_node_id: 138,
    duration_node_id: 132,
    noise_node_id: 129,
    image_node_ids: Object.freeze([137, 139]),
    image_link_ids: Object.freeze([278, 282]),
    width_link_id: 276,
    height_link_id: 277,
    quality_projection: Object.freeze({
      base_model_node_id: 127,
      guider_node_id: 126,
      scheduler_node_id: 124,
      full_steps_node_id: 143,
      pruned_node_ids: Object.freeze([141, 142, 144, 145, 146]),
      pruned_link_ids: Object.freeze([283, 284, 285, 286, 287, 288, 289, 290, 291]),
      model_link_id: 288,
      steps_link_id: 289,
      switch_group_id: 3,
      switch_group_title: "Switch Model and Settings",
    }),
  }),
});

export const PROTECTED_CLASS_TYPES = Object.freeze([
  "MiniMaxH3ImageToVideo",
  "MiniMaxH3ReferenceToVideo",
  "MiniMaxH3SigmaShift",
  "CreateVideo",
  "SaveVideo",
]);

// These are pinned Comfy core class identities used only by the visible long-video
// dependency graph. They never submit a queue job and are rejected outside that graph.
export const LONG_DAG_CORE_CLASS_TYPES = Object.freeze([
  "GetVideoComponents",
  "ImageFromBatch",
  "BatchImagesNode",
  "AudioConcat",
  "CreateVideo",
  "Video Slice",
]);

export const FORBIDDEN_CLASS_TYPES = Object.freeze([
  "MinimaxTextToVideoNode",
  "MinimaxImageToVideoNode",
  "MinimaxSubjectToVideoNode",
  "MinimaxHailuoVideoNode",
  "MinimaxHailuo03TextToVideoNode",
  "MinimaxHailuo03FirstLastFrameNode",
  "MinimaxHailuo03ReferenceNode",
  "MinimaxHailuo03ContextIRNode",
  "MinimaxHailuo03RegenerateNode",
]);

export const MAX_PROJECT_BYTES = 128 * 1024;
export const MAX_PROMPT_BYTES = 32 * 1024;
export const MAX_ENDPOINT_BYTES = 1024;
export const MAX_CLI_RESPONSE_BYTES = 1024 * 1024;
export const MAX_GRAPH_NODES = 512;
export const MAX_SUBGRAPHS = 16;
