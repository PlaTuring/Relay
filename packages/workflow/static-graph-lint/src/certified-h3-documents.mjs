import { computeDescriptorFingerprints, computeRootIntegrity } from "./authority.mjs";
import { FORBIDDEN_PARTNER_CLASS_TYPES } from "./constants.mjs";

const revision = "d8e7bbc9d586d95f758d6b0ed23d519088be578a";
const originUri = "https://github.com/Comfy-Org/ComfyUI";

function origin(sourcePath, blob, introduced) {
  return {
    upstream_id: "comfyui-core",
    origin_uri: originUri,
    locked_revision: revision,
    source_path: sourcePath,
    git_blob_sha: blob,
    first_introduced_revision: introduced,
    evidence_source_ids: ["p0-wf-001-snapshot"],
  };
}

function descriptorBase(classType) {
  if (classType === "MiniMaxH3ImageToVideo") {
    return {
      class_type: classType,
      required_inputs: [
        { name: "clip", type: "CLIP" },
        { name: "vae", type: "VAE" },
        { name: "prompt", type: "STRING", multiline: true, dynamic_prompts: true },
        { name: "width", type: "INT", default: 1344, min: 32, max: "MAX_RESOLUTION", step: 32 },
        { name: "height", type: "INT", default: 768, min: 32, max: "MAX_RESOLUTION", step: 32 },
        { name: "length", type: "INT", default: 124, min: 5, max: 3600, step: 17 },
      ],
      optional_inputs: [{ name: "first_frame", type: "IMAGE" }, { name: "last_frame", type: "IMAGE" }],
      hidden_inputs: [],
      outputs: [{ index: 0, name: "positive", type: "CONDITIONING" }, { index: 1, type: "LATENT" }],
      origin: origin("comfy_extras/nodes_minimax_h3.py", "0a08f185fd1155f18f16757c02553ff48cf365eb", "57500fc5bc92566a63f2046824f522cd55c335ca"),
      flags: { local_only: true, is_api_node: false, is_output_node: false },
      evidence_status: "proven",
      disposition: { kind: "active" },
    };
  }
  if (classType === "MiniMaxH3SigmaShift") {
    return {
      class_type: classType,
      required_inputs: [
        { name: "model", type: "MODEL" },
        { name: "shift_video", type: "FLOAT", default: 12, min: 0.01, max: 100, step: 0.01 },
        { name: "shift_audio", type: "FLOAT", default: 3, min: 0.01, max: 100, step: 0.01 },
      ],
      optional_inputs: [],
      hidden_inputs: [],
      outputs: [{ index: 0, type: "MODEL" }],
      origin: origin("comfy_extras/nodes_minimax_h3.py", "0a08f185fd1155f18f16757c02553ff48cf365eb", "57500fc5bc92566a63f2046824f522cd55c335ca"),
      flags: { local_only: true, is_api_node: false, is_output_node: false },
      evidence_status: "proven",
      disposition: { kind: "active" },
    };
  }
  if (classType === "CreateVideo") {
    return {
      class_type: classType,
      required_inputs: [
        { name: "images", type: "IMAGE" },
        { name: "fps", type: "FLOAT", default: 30, min: 1, max: 120, step: 1 },
      ],
      optional_inputs: [
        { name: "audio", type: "AUDIO" },
        { name: "bit_depth", type: "COMBO", options: ["auto", 8, 10], default: "auto" },
        { name: "color_space", type: "COMBO", options: ["sRGB", "HDR", "HDR PQ"], default: "sRGB" },
      ],
      hidden_inputs: [],
      outputs: [{ index: 0, type: "VIDEO" }],
      origin: origin("comfy_extras/nodes_video.py", "58f58aaf4daecd08e3b7488c5f313377e6f527e2", "68f0d3529667a2b34b27cc0ac5051bc0e8c45b49"),
      flags: { local_only: true, is_api_node: false, is_output_node: false },
      evidence_status: "proven",
      disposition: { kind: "active" },
    };
  }
  if (classType === "SaveVideo") {
    return {
      class_type: classType,
      required_inputs: [
        { name: "video", type: "VIDEO" },
        { name: "filename_prefix", type: "STRING", default: "video/ComfyUI" },
        { name: "format", type: "DYNAMIC_COMBO", options: ["auto", "mp4", "mkv", "webm"] },
      ],
      optional_inputs: [{ name: "codec", type: "DYNAMIC_COMBO", options: ["auto", "h264", "av1"], hidden: true }],
      hidden_inputs: [{ name: "prompt", type: "PROMPT" }, { name: "extra_pnginfo", type: "EXTRA_PNGINFO" }],
      outputs: [{ index: 0, name: "video", type: "VIDEO" }],
      origin: origin("comfy_extras/nodes_video.py", "58f58aaf4daecd08e3b7488c5f313377e6f527e2", "68f0d3529667a2b34b27cc0ac5051bc0e8c45b49"),
      flags: { local_only: true, is_api_node: false, is_output_node: true },
      evidence_status: "proven",
      disposition: { kind: "active" },
    };
  }
  throw new Error("unknown certified H3 class");
}

function finishDescriptor(classType) {
  const descriptor = descriptorBase(classType);
  descriptor.schema_fingerprints = structuredClone(computeDescriptorFingerprints(descriptor));
  return descriptor;
}

function forbidden(classType, index) {
  const introduced = [
    "1271c4ef9df2b4eb037688da514f63e1bd8bd727",
    "1271c4ef9df2b4eb037688da514f63e1bd8bd727",
    "1271c4ef9df2b4eb037688da514f63e1bd8bd727",
    "f16a70ba670e11de549af188663a87c77c5bc0c2",
    "7dd46274601239644fff19b1b069cff199fcf738",
    "7dd46274601239644fff19b1b069cff199fcf738",
    "7dd46274601239644fff19b1b069cff199fcf738",
    "12666983cba9b43254ed993c2894dc727ca8ecfd",
    "12666983cba9b43254ed993c2894dc727ca8ecfd",
  ];
  return {
    class_type: classType,
    registered_at_locked_revision: index !== 2,
    is_api_node: true,
    local_only: false,
    origin: {
      origin_uri: originUri,
      locked_revision: revision,
      source_path: "comfy_api_nodes/nodes_minimax.py",
      git_blob_sha: "de3895221eb8261ee2650b020727d670079f0f23",
    },
    first_introduced_revision: introduced[index],
    reason_code: "NODE.PARTNER_API_FORBIDDEN",
  };
}

export function documents() {
  const descriptorEntries = [
    finishDescriptor("MiniMaxH3ImageToVideo"),
    finishDescriptor("MiniMaxH3SigmaShift"),
    finishDescriptor("CreateVideo"),
    finishDescriptor("SaveVideo"),
  ];
  const authority = {
    contract_id: "minimax-h3-tool.node-allowlist",
    schema_version: "1.0.0",
    document_id: "10000000-0000-4000-8000-000000000001",
    document_revision: 1,
    allowlist_id: "alpha0-local-h3-core",
    scope: {
      runtime_topology: "managed_core",
      backend_origin_uri: originUri,
      backend_locked_revision: revision,
      policy: "exact_class_type_and_all_fingerprints_local_only",
    },
    fingerprint_profile: {
      algorithm: "sha256",
      normalization: "sha256_c14n_json_sort_keys_v1",
      input_projection: "required_inputs_optional_inputs_hidden_inputs",
      output_projection: "outputs",
      combined_projection: "class_type_required_inputs_optional_inputs_hidden_inputs_outputs_flags",
    },
    evidence_sources: [{
      source_id: "p0-wf-001-snapshot",
      locator: "repo:prototypes/phase0/capability-snapshot.json",
      revision: "P0-WF-001",
      content_sha256: "sha256:d123836a883573ad5bd957935af11ab5b8812bd2ad3f12bc21e0c50ae89b3bfd",
      evidence_status: "proven",
    }],
    entries: descriptorEntries.map((entry) => ({
      class_type: entry.class_type,
      display_name: ({
        MiniMaxH3ImageToVideo: "MiniMax H3 Image To Video",
        MiniMaxH3SigmaShift: "MiniMax H3 Sigma Shift",
        CreateVideo: "Create Video",
        SaveVideo: "Save Video",
      })[entry.class_type],
      schema_fingerprints: structuredClone(entry.schema_fingerprints),
      origin: structuredClone(entry.origin),
      flags: structuredClone(entry.flags),
      evidence_status: "proven",
      runtime_acceptance: "poc_pending",
      disposition: { kind: "active" },
    })),
    forbidden_identities: FORBIDDEN_PARTNER_CLASS_TYPES.map(forbidden),
    disposition: { kind: "active" },
  };
  authority.integrity = {
    algorithm: "sha256",
    canonicalization: "rfc8785_jcs_root_integrity_omitted",
    content_sha256: computeRootIntegrity(authority),
  };
  const descriptors = {
    contract_id: "minimax-h3-tool.static-node-descriptors",
    schema_version: "1.0.0",
    document_id: "20000000-0000-4000-8000-000000000099",
    document_revision: 1,
    authority_ref: {
      contract_id: authority.contract_id,
      schema_version: authority.schema_version,
      document_id: authority.document_id,
      document_revision: authority.document_revision,
      content_sha256: authority.integrity.content_sha256,
    },
    fingerprint_profile: structuredClone(authority.fingerprint_profile),
    descriptors: descriptorEntries,
    disposition: { kind: "active" },
  };
  descriptors.integrity = {
    algorithm: "sha256",
    canonicalization: "rfc8785_jcs_root_integrity_omitted",
    content_sha256: computeRootIntegrity(descriptors),
  };
  return { allowlist: authority, descriptors };
}
