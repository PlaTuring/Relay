const COMFY_VERSION = "0.34.0";
const H3_REVISION = "4cc1d817b6184899b41293954329f576cb5ae86b";
const H3_REPOSITORY = "https://huggingface.co/Comfy-Org/MiniMax-H3";
const H3_MODELSCOPE_REPOSITORY = "https://www.modelscope.cn/models/Comfy-Org/MiniMax-H3";
const H3_MODELSCOPE_REVISION = "550fc1018db6decfd70b5c0e461a9df477bddf04";
const FFMPEG_RELEASE = "autobuild-2026-08-20-13-45";
const FFMPEG_ARCHIVE = "ffmpeg-n9.0.1-6-g9d4ca21220-win64-gpl-9.0.zip";
const COMFY_DESKTOP_VERSION = "1.0.46";

function h3Url(relativePath) {
  return `${H3_REPOSITORY}/resolve/${H3_REVISION}/${relativePath}?download=true`;
}

function h3ModelScopeUrl(relativePath) {
  return `${H3_MODELSCOPE_REPOSITORY}/resolve/${H3_MODELSCOPE_REVISION}/${relativePath}`;
}

function model({ id, component, role, relativePath, byteLength, sha256, experimental = false }) {
  const domesticUrl = h3ModelScopeUrl(relativePath);
  const upstreamUrl = h3Url(relativePath);
  return Object.freeze({
    id,
    component,
    kind: "model",
    role,
    relative_path: relativePath,
    destination_relative_path: `runtime/ComfyUI_windows_portable/ComfyUI/models/${relativePath}`,
    url: domesticUrl,
    urls: Object.freeze([domesticUrl, upstreamUrl]),
    expected_byte_length: byteLength,
    expected_sha256: sha256,
    source: Object.freeze({
      repository: H3_REPOSITORY,
      revision: H3_REVISION,
      relative_path: relativePath
    }),
    mirrors: Object.freeze([Object.freeze({
      repository: H3_MODELSCOPE_REPOSITORY,
      revision: H3_MODELSCOPE_REVISION,
      relative_path: relativePath,
      region: "CN",
      identity_policy: "exact_byte_length_and_sha256"
    })]),
    experimental
  });
}

const ARTIFACTS = Object.freeze([
  Object.freeze({
    id: "comfy-portable-nvidia-0.34.0",
    component: "comfy-portable",
    kind: "comfy_archive",
    role: "comfy_portable",
    relative_path: "ComfyUI_windows_portable_nvidia.7z",
    destination_relative_path: "downloads/ComfyUI_windows_portable_nvidia-0.34.0.7z",
    url: "https://github.com/Comfy-Org/ComfyUI/releases/download/v0.34.0/ComfyUI_windows_portable_nvidia.7z",
    expected_byte_length: 2_146_721_943,
    expected_sha256: "ed57cc6b19ae3d83add1ecebfdd56b25e04e0008cf0fe9af43a4ad8797e2a24c",
    installed_byte_estimate: 8_589_934_592,
    source: Object.freeze({
      repository: "https://github.com/Comfy-Org/ComfyUI",
      revision: "v0.34.0",
      relative_path: "ComfyUI_windows_portable_nvidia.7z"
    }),
    experimental: false
  }),
  Object.freeze({
    id: "ffmpeg-btbn-n9.0.1-6-g9d4ca21220-win64-gpl-9.0",
    component: "ffmpeg-managed",
    kind: "ffmpeg_archive",
    role: "ffmpeg_cli",
    relative_path: FFMPEG_ARCHIVE,
    destination_relative_path: `downloads/${FFMPEG_ARCHIVE}`,
    managed_destination_relative_path: `runtime/ffmpeg/${FFMPEG_ARCHIVE.slice(0, -4)}`,
    archive_root: FFMPEG_ARCHIVE.slice(0, -4),
    required_files: Object.freeze(["bin/ffmpeg.exe", "bin/ffprobe.exe"]),
    url: `https://github.com/BtbN/FFmpeg-Builds/releases/download/${FFMPEG_RELEASE}/${FFMPEG_ARCHIVE}`,
    expected_byte_length: 169_203_574,
    expected_sha256: "5bbf30d81a46e4ea3bf692da189141e88a269252518e9202b95fedec3996b93e",
    installed_byte_estimate: 676_814_296,
    source: Object.freeze({
      repository: "https://github.com/BtbN/FFmpeg-Builds",
      revision: "48576f197ad1c2afb2e0b8efe204919a1afbff54",
      release: FFMPEG_RELEASE,
      asset_id: 522_311_360,
      relative_path: FFMPEG_ARCHIVE,
      evidence: "github_release_asset_size_and_sha256_digest"
    }),
    upstream: Object.freeze({
      project: "https://ffmpeg.org/",
      windows_build_provider_listing: "https://ffmpeg.org/download.html#build-windows"
    }),
    experimental: false
  }),
  Object.freeze({
    id: "comfy-desktop-installer-1.0.46-x64",
    component: "comfy-desktop",
    kind: "external_installer",
    role: "comfy_desktop_installer",
    relative_path: `Comfy-Desktop-${COMFY_DESKTOP_VERSION}-x64-Setup.exe`,
    destination_relative_path: `downloads/Comfy-Desktop-${COMFY_DESKTOP_VERSION}-x64-Setup.exe`,
    url: "https://dl.todesktop.com/241130tqe9q3y/windows/nsis/x64",
    expected_byte_length: 179_991_984,
    expected_sha256: "16322682641f1262c2686183f96f1cef8bbc523f3886c8fbd516508295606ab5",
    execution_policy: "download_verify_user_launch_only",
    mutable_origin: true,
    fail_closed_identity: true,
    source: Object.freeze({
      repository: "https://github.com/Comfy-Org/Comfy-Desktop",
      revision: COMFY_DESKTOP_VERSION,
      download_entry: "https://download.comfy.org/",
      content_disposition_version: COMFY_DESKTOP_VERSION,
      evidence: "official_redirect_response_plus_full_file_sha256_and_authenticode"
    }),
    signature: Object.freeze({
      status: "Valid",
      subject: "Drip Artificial Inc"
    }),
    experimental: false
  }),
  model({
    id: "h3-fl2va-int8-convrot",
    component: "fl2va-base",
    role: "fl2va_diffusion",
    relativePath: "diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors",
    byteLength: 20_970_379_616,
    sha256: "e889202c41dafb67b10d67b97f0d8541508036a6090af23425a5c2615d03c47a"
  }),
  model({
    id: "h3-ref2va-int8-convrot",
    component: "ref2va-addon",
    role: "ref2va_diffusion",
    relativePath: "diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors",
    byteLength: 20_970_379_616,
    sha256: "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779"
  }),
  model({
    id: "h3-qwen3vl-32b-nvfp4-awq",
    component: "shared-h3-base",
    role: "qwen_text_encoder",
    relativePath: "text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
    byteLength: 15_687_142_551,
    sha256: "35a88d51044231fe332301d7a62aa81e3f2cba62febeb446e2c1e3e0ef76f2c6"
  }),
  model({
    id: "h3-video-vae-fp16",
    component: "shared-h3-base",
    role: "video_vae",
    relativePath: "vae/minimax_h3_video_vae_fp16.safetensors",
    byteLength: 5_207_808_496,
    sha256: "7c1f131492e7eddacaac9069a61b81bdd39de5cc96561e677c5eab1cdce5e522"
  }),
  model({
    id: "h3-audio-vae-fp32",
    component: "shared-h3-base",
    role: "audio_vae",
    relativePath: "vae/minimax_h3_audio_vae_fp32.safetensors",
    byteLength: 605_254_808,
    sha256: "8e505d95dd1561d47abd43d4238fd40d9bb1ae9e147ed0a4cba778d76ae4db48"
  }),
  model({
    id: "h3-fl2v-turbo-8step",
    component: "fl2v-turbo",
    role: "fl2va_turbo_8step_lora",
    relativePath: "loras/minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors",
    byteLength: 1_956_193_000,
    sha256: "2339acdf19bfe123f46b971ea35d367a84adb85de43627e1eceafa5a5b2b111e",
    experimental: true
  }),
  model({
    id: "h3-ref2v-turbo-4step",
    component: "ref2v-turbo",
    role: "ref2va_turbo_4step_lora",
    relativePath: "loras/minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors",
    byteLength: 1_956_193_000,
    sha256: "5b9ab5ade15d0775676d01a907268a69a1468dc6033b3b0d3ded5502f3ebb84c",
    experimental: true
  })
]);

export const INSTALL_CATALOG = Object.freeze({
  schema_version: "1.0.0",
  catalog_id: "minimax-h3-windows-pinned-2026-08-28",
  comfy_version: COMFY_VERSION,
  h3_revision: H3_REVISION,
  components: Object.freeze({
    "comfy-portable": Object.freeze({ requires: Object.freeze([]) }),
    "fl2va-base": Object.freeze({ requires: Object.freeze(["shared-h3-base"]) }),
    "ref2va-addon": Object.freeze({ requires: Object.freeze(["shared-h3-base"]) }),
    "fl2v-turbo": Object.freeze({ requires: Object.freeze(["fl2va-base"]) }),
    "ref2v-turbo": Object.freeze({ requires: Object.freeze(["ref2va-addon"]) }),
    "ffmpeg-managed": Object.freeze({ requires: Object.freeze([]) }),
    "comfy-desktop": Object.freeze({ requires: Object.freeze([]) }),
    "shared-h3-base": Object.freeze({ requires: Object.freeze([]), internal: true })
  }),
  artifacts: ARTIFACTS
});

function validateSha(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

function validRelativePath(value) {
  return typeof value === "string" && value.length > 0 && !value.includes("\\") && value.split("/").every((part) => part && part !== "." && part !== "..");
}

export function validateInstallCatalog(catalog, { allowHttp = false } = {}) {
  if (!catalog || typeof catalog !== "object" || !Array.isArray(catalog.artifacts) || !catalog.components) {
    throw new TypeError("invalid install catalog");
  }
  const ids = new Set();
  for (const [componentId, component] of Object.entries(catalog.components)) {
    if (!component || typeof component !== "object" || !Array.isArray(component.requires)) throw new TypeError("invalid catalog component");
    if (component.blocked === true && typeof component.blocked_reason_code !== "string") throw new TypeError("blocked component requires reason");
    if (component.blocked === true && catalog.artifacts.some((artifact) => artifact.component === componentId)) {
      throw new TypeError("blocked component cannot contain install artifacts");
    }
  }
  for (const artifact of catalog.artifacts) {
    if (!artifact || typeof artifact.id !== "string" || ids.has(artifact.id)) throw new TypeError("duplicate or invalid artifact id");
    ids.add(artifact.id);
    if (!Object.hasOwn(catalog.components, artifact.component)) throw new TypeError("unknown artifact component");
    const urls = artifact.urls ?? [artifact.url];
    if (!Array.isArray(urls) || urls.length === 0 || urls[0] !== artifact.url || new Set(urls).size !== urls.length) {
      throw new TypeError("invalid artifact URL candidates");
    }
    for (const url of urls) {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" && !(allowHttp && parsed.protocol === "http:")) throw new TypeError("artifact URL must use HTTPS");
      if (/\/(?:main|latest)(?:\/|$)/u.test(parsed.pathname)) throw new TypeError("mutable artifact URL forbidden");
    }
    if (!Number.isSafeInteger(artifact.expected_byte_length) || artifact.expected_byte_length < 1 || !validateSha(artifact.expected_sha256)) {
      throw new TypeError("invalid artifact identity");
    }
    if (!validRelativePath(artifact.relative_path) || !validRelativePath(artifact.destination_relative_path)) throw new TypeError("unsafe relative path");
    if (artifact.kind === "ffmpeg_archive") {
      if (!validRelativePath(artifact.managed_destination_relative_path) || !artifact.managed_destination_relative_path.startsWith("runtime/ffmpeg/")) {
        throw new TypeError("unsafe FFmpeg destination");
      }
      if (typeof artifact.archive_root !== "string" || artifact.archive_root.includes("/") || artifact.archive_root.includes("\\")) {
        throw new TypeError("unsafe FFmpeg archive root");
      }
      if (!Array.isArray(artifact.required_files) || artifact.required_files.length === 0 || artifact.required_files.some((value) => !validRelativePath(value))) {
        throw new TypeError("invalid FFmpeg required files");
      }
    }
    if (artifact.kind === "external_installer") {
      if (!artifact.destination_relative_path.startsWith("downloads/")) throw new TypeError("external installer must remain in managed downloads");
      if (artifact.execution_policy !== "download_verify_user_launch_only") throw new TypeError("external installer execution policy must forbid silent execution");
      if (artifact.mutable_origin !== true || artifact.fail_closed_identity !== true) throw new TypeError("mutable external installer must fail closed on byte identity");
      if (artifact.signature?.status !== "Valid" || typeof artifact.signature.subject !== "string") throw new TypeError("external installer requires verified signature evidence");
    }
  }
  return catalog;
}

export function resolveSelectedArtifacts(componentIds, catalog = INSTALL_CATALOG, options = {}) {
  validateInstallCatalog(catalog, options);
  if (!Array.isArray(componentIds) || componentIds.length === 0) throw new TypeError("components must be a non-empty array");
  const selected = new Set();
  const visit = (id) => {
    const component = catalog.components[id];
    if (!component || component.internal && !selected.has(id)) {
      if (!component) throw new TypeError(`unknown component: ${id}`);
    }
    if (component.blocked === true) {
      const error = new TypeError(`blocked component: ${id}`);
      error.code = "CATALOG_COMPONENT_BLOCKED";
      error.component = id;
      error.reason_code = component.blocked_reason_code;
      throw error;
    }
    if (selected.has(id)) return;
    selected.add(id);
    for (const required of component.requires ?? []) visit(required);
  };
  for (const id of componentIds) {
    if (catalog.components[id]?.internal) throw new TypeError("internal component cannot be selected directly");
    visit(id);
  }
  return Object.freeze(catalog.artifacts.filter((artifact) => selected.has(artifact.component)));
}
