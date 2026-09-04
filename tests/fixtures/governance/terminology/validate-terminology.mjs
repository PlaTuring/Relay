import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..", "..");
const glossaryPath = path.join(here, "glossary.valid.json");
const copyPath = path.join(here, "ui-copy.valid.json");
const hostileDirectory = path.join(here, "hostile");
const markdownPath = path.join(root, "docs", "architecture", "TERMINOLOGY_GLOSSARY.md");

class TerminologyValidationError extends Error {
  constructor(code, ruleId, detail) {
    super(`${code} ${ruleId}: ${detail}`);
    this.code = code;
    this.ruleId = ruleId;
  }
}

function fail(code, ruleId, detail) {
  throw new TerminologyValidationError(code, ruleId, detail);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function expectKeys(value, keys, code, ruleId, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(code, ruleId, `${label}: expected object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (!isDeepStrictEqual(actual, expected)) {
    fail(code, ruleId, `${label}: keys=${actual.join(",")}`);
  }
}

function expectEqual(actual, expected, code, ruleId, label) {
  if (!isDeepStrictEqual(actual, expected)) {
    fail(code, ruleId, `${label}: observed=${JSON.stringify(actual)}`);
  }
}

function assertUnique(values, code, ruleId, label) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) fail(code, ruleId, `${label}:${value}`);
    seen.add(value);
  }
}

function indexExact(records, idKey, expectedIds, code, ruleId, label) {
  if (!Array.isArray(records)) fail(code, ruleId, `${label}: expected array`);
  const ids = records.map((record) => record?.[idKey]);
  assertUnique(ids, code, ruleId, label);
  expectEqual(ids, expectedIds, code, ruleId, `${label}.order`);
  return new Map(records.map((record) => [record[idKey], record]));
}

const routeKeys = [
  "route_id", "term", "expansion", "model_family", "first_frame", "last_frame",
  "reference_media", "prompt_policy", "endpoint_policy", "native_audio_policy",
];

const routeContract = {
  t2va: {
    term: "T2VA",
    expansion: "Text-to-Video-and-Audio",
    model_family: "fl2va",
    first_frame: "absent",
    last_frame: "absent",
    reference_media: "absent",
    prompt_policy: "non_empty_user_text_required_for_alpha_baseline",
    endpoint_policy: "no_declared_endpoint_anchor",
    native_audio_policy: "h3_is_only_producer_capability_gated",
  },
  i2va: {
    term: "I2VA",
    expansion: "Image-to-Video-and-Audio",
    model_family: "fl2va",
    first_frame: "required",
    last_frame: "absent",
    reference_media: "absent",
    prompt_policy: "empty_text_requires_separate_capability",
    endpoint_policy: "preserve_first_anchor",
    native_audio_policy: "h3_is_only_producer_capability_gated",
  },
  l2va: {
    term: "L2VA",
    expansion: "Last-frame-to-Video-and-Audio",
    model_family: "fl2va",
    first_frame: "absent",
    last_frame: "required",
    reference_media: "absent",
    prompt_policy: "empty_text_requires_separate_capability",
    endpoint_policy: "preserve_last_anchor_no_universal_tail_trim",
    native_audio_policy: "h3_is_only_producer_capability_gated",
  },
  fl2va: {
    term: "FL2VA",
    expansion: "First-and-Last-frames-to-Video-and-Audio",
    model_family: "fl2va",
    first_frame: "required",
    last_frame: "required",
    reference_media: "absent",
    prompt_policy: "empty_text_requires_separate_capability",
    endpoint_policy: "preserve_both_anchors_no_universal_tail_trim",
    native_audio_policy: "h3_is_only_producer_capability_gated",
  },
};

const modelRoleKeys = [
  "slot_id", "component_role", "model_family", "base_package", "runtime_included", "purpose",
];

const modelRoleContract = {
  fl2va_diffusion: {
    component_role: "model_diffusion",
    model_family: "fl2va",
    base_package: "required_one_hardware_appropriate_artifact",
    runtime_included: false,
    purpose: "h3_joint_video_audio_diffusion_for_t2va_i2va_l2va_fl2va",
  },
  text_encoder: {
    component_role: "model_text_encoder",
    model_family: "h3_shared_text_encoder",
    base_package: "required",
    runtime_included: false,
    purpose: "encode_user_supplied_text_without_semantic_rewrite",
  },
  video_vae: {
    component_role: "model_video_vae",
    model_family: "h3_video_vae",
    base_package: "required",
    runtime_included: false,
    purpose: "h3_video_latent_encode_decode",
  },
  audio_vae: {
    component_role: "model_audio_vae",
    model_family: "h3_audio_vae",
    base_package: "required",
    runtime_included: false,
    purpose: "h3_audio_latent_encode_decode",
  },
};

const topologyKeys = [
  "topology_id", "term", "ownership", "default_mode", "mutability", "discovery_policy",
  "execution_adapter_policy", "private_state_policy",
];

const topologyContract = {
  managed_core: {
    term: "Managed Core",
    ownership: "tool_owned",
    default_mode: "managed_execution",
    mutability: "immutable_runtime_generation",
    discovery_policy: "tool_inventory",
    execution_adapter_policy: "alpha_default",
    private_state_policy: "tool_managed_only",
  },
  desktop: {
    term: "Desktop",
    ownership: "external_owned",
    default_mode: "attach_only",
    mutability: "external_state_untouched",
    discovery_policy: "static_read_only",
    execution_adapter_policy: "separately_capability_gated",
    private_state_policy: "never_edit",
  },
  portable: {
    term: "Portable",
    ownership: "external_owned",
    default_mode: "attach_only",
    mutability: "external_state_untouched",
    discovery_policy: "static_read_only",
    execution_adapter_policy: "separately_capability_gated",
    private_state_policy: "never_edit",
  },
};

const desktopLevelKeys = [
  "level", "meaning", "automatic_handoff_claim_allowed", "formal_queue_submission",
];

const desktopLevelContract = {
  OPEN_AND_FOCUS: ["open_exact_installation_and_focus_exact_workflow_without_run", true, false],
  PERSIST_ONLY: ["persist_workflow_without_verified_canvas_focus", false, false],
  EXPORT_ONLY: ["export_file_and_require_manual_open", false, false],
  UNSUPPORTED: ["unknown_or_unverified_instance_fails_closed", false, false],
};

const operationKeys = [
  "operation_id", "actor", "surface", "queue_submission_count", "prompt_endpoint_access",
  "invokes_h3", "produces_media", "result",
];

const operationContract = {
  compile: {
    actor: "tool_control_plane",
    surface: "tool",
    queue_submission_count: 0,
    prompt_endpoint_access: "forbidden",
    invokes_h3: false,
    produces_media: false,
    result: "canonical_visual_workflow_and_derived_non_authoritative_audit_graph",
  },
  handoff: {
    actor: "tool_control_plane",
    surface: "tool_to_comfyui",
    queue_submission_count: 0,
    prompt_endpoint_access: "forbidden",
    invokes_h3: false,
    produces_media: false,
    result: "exact_workflow_presented_in_verified_comfyui_or_manual_export_fallback",
  },
  run: {
    actor: "user",
    surface: "visible_comfyui_frontend",
    queue_submission_count: 1,
    prompt_endpoint_access: "comfyui_frontend_after_explicit_user_action",
    invokes_h3: true,
    produces_media: false,
    result: "first_formal_job_accepted_for_comfyui_execution",
  },
  media_generation: {
    actor: "minimax_h3",
    surface: "comfyui_execution",
    queue_submission_count: 0,
    prompt_endpoint_access: "never",
    invokes_h3: true,
    produces_media: true,
    result: "actual_video_and_native_audio",
  },
};

const statusKeys = [
  "status", "normal_ui", "advanced_ui", "stable_ui_allowed", "runnable_by_status_alone",
];

const statusContract = {
  hidden: ["hidden", "hidden", false, false],
  poc_pending: ["hidden", "developer_diagnostics_only", false, false],
  internal: ["internal_build_only", "internal_build_only", false, false],
  certified: ["allowed_with_exact_profile_scope", "allowed_with_exact_profile_scope", true, false],
  experimental: ["hidden", "visible_default_off_with_risk_and_fallback", false, false],
};

const modelStateKeys = ["state", "meaning", "reuse_authorized", "recipe_bound"];
const modelStateContract = {
  found: ["candidate_path_observed", false, false],
  identified: ["bounded_metadata_and_role_identity_established", false, false],
  verified: ["exact_integrity_and_provenance_identity_verified", false, false],
  compatible: ["exact_recipe_runtime_hardware_compatibility_established", false, false],
  approved: ["reuse_policy_and_applicable_authority_checks_accepted", true, false],
  selected: ["approved_artifact_bound_to_the_current_recipe_slot", true, true],
};

const requiredTermIds = [
  "route.t2va", "route.i2va", "route.l2va", "route.fl2va", "model.fl2va_family",
  "model.ref2va_family", "runtime.runtime", "runtime.generation", "execution.media_generation",
  "model.model", "model.role.diffusion", "model.role.text_encoder", "model.role.video_vae",
  "model.role.audio_vae", "runtime.managed_core", "runtime.desktop", "runtime.portable",
  "runtime.attach_only", "workflow.compile", "workflow.handoff", "workflow.run",
  "workflow.prompt_endpoint", "audio.native", "status.stable", "status.hidden",
  "status.poc_pending", "status.internal", "status.certified", "status.experimental",
  "evidence.proven", "evidence.inferred", "node.local", "node.partner_api",
  "model.state.found", "model.state.identified", "model.state.verified",
  "model.state.compatible", "model.state.approved", "model.state.selected",
  "desktop.open_and_focus", "desktop.persist_only", "desktop.export_only", "desktop.unsupported",
];

function validateGlossary(glossary) {
  expectKeys(
    glossary,
    [
      "glossary_version", "glossary_id", "source_task", "locale_policy", "product_boundary",
      "routes", "model_roles", "runtime_topologies", "desktop_handoff_levels", "operations",
      "native_audio", "capability_statuses", "evidence_terms", "model_lifecycle",
      "ui_copy_policy", "terms",
    ],
    "TERM.GLOSSARY.SHAPE",
    "terminology.glossary.closed",
    "glossary",
  );
  expectEqual(glossary.glossary_version, "1.0.0", "TERM.GLOSSARY.IDENTITY", "terminology.glossary.identity", "version");
  expectEqual(glossary.glossary_id, "minimax-h3-tool.terminology", "TERM.GLOSSARY.IDENTITY", "terminology.glossary.identity", "id");
  expectEqual(glossary.source_task, "P0-GOV-006", "TERM.GLOSSARY.IDENTITY", "terminology.glossary.identity", "task");

  expectEqual(
    glossary.locale_policy,
    {
      canonical_locale: "zh-CN",
      machine_identifiers: "lower_snake_case",
      normative_route_tokens: ["T2VA", "I2VA", "L2VA", "FL2VA", "Ref2VA"],
      generation_word_policy: "qualify_as_runtime_generation_or_media_generation",
      stable_word_policy: "ui_label_only_for_certified",
    },
    "TERM.LOCALE.SEMANTIC_DRIFT",
    "terminology.locale.exact",
    "locale_policy",
  );
  expectEqual(
    glossary.product_boundary,
    {
      control_plane_actor: "tool_control_plane",
      media_generator_actor: "minimax_h3",
      execution_host: "comfyui",
      formal_start_actor: "user",
      formal_start_action: "comfyui_run",
      pre_run_formal_queue_submissions: 0,
      prompt_endpoint_policy: "forbidden_during_compile_open_handoff",
      partner_api_policy: "fail_closed_never_local",
      creative_behavior_policy: "forbidden",
    },
    "TERM.PRODUCT_BOUNDARY.SEMANTIC_DRIFT",
    "terminology.boundary.tool_h3_comfy_exact",
    "product_boundary",
  );

  const routes = indexExact(
    glossary.routes,
    "route_id",
    ["t2va", "i2va", "l2va", "fl2va"],
    "TERM.ROUTE.SET_DRIFT",
    "terminology.routes.exact_set",
    "routes",
  );
  for (const [routeId, expected] of Object.entries(routeContract)) {
    const route = routes.get(routeId);
    expectKeys(route, routeKeys, "TERM.ROUTE.SHAPE", "terminology.route.closed", routeId);
    for (const [field, value] of Object.entries(expected)) {
      expectEqual(route[field], value, "TERM.ROUTE.SEMANTIC_DRIFT", "terminology.route.input_matrix_exact", `${routeId}.${field}`);
    }
  }

  const roles = indexExact(
    glossary.model_roles,
    "slot_id",
    ["fl2va_diffusion", "text_encoder", "video_vae", "audio_vae"],
    "TERM.MODEL_ROLE.SET_DRIFT",
    "terminology.model_roles.base_package_exact",
    "model_roles",
  );
  for (const [slotId, expected] of Object.entries(modelRoleContract)) {
    const role = roles.get(slotId);
    expectKeys(role, modelRoleKeys, "TERM.MODEL_ROLE.SHAPE", "terminology.model_role.closed", slotId);
    for (const [field, value] of Object.entries(expected)) {
      expectEqual(role[field], value, "TERM.MODEL_ROLE.SEMANTIC_DRIFT", "terminology.model_roles.runtime_separate_exact", `${slotId}.${field}`);
    }
  }

  const topologies = indexExact(
    glossary.runtime_topologies,
    "topology_id",
    ["managed_core", "desktop", "portable"],
    "TERM.RUNTIME_TOPOLOGY.SET_DRIFT",
    "terminology.runtime_topologies.exact_set",
    "runtime_topologies",
  );
  for (const [topologyId, expected] of Object.entries(topologyContract)) {
    const topology = topologies.get(topologyId);
    expectKeys(topology, topologyKeys, "TERM.RUNTIME_TOPOLOGY.SHAPE", "terminology.runtime_topology.closed", topologyId);
    for (const [field, value] of Object.entries(expected)) {
      expectEqual(topology[field], value, "TERM.RUNTIME_TOPOLOGY.SEMANTIC_DRIFT", "terminology.runtime_topology.ownership_exact", `${topologyId}.${field}`);
    }
  }

  const desktopLevels = indexExact(
    glossary.desktop_handoff_levels,
    "level",
    ["OPEN_AND_FOCUS", "PERSIST_ONLY", "EXPORT_ONLY", "UNSUPPORTED"],
    "TERM.DESKTOP_LEVEL.SET_DRIFT",
    "terminology.desktop_handoff.exact_set",
    "desktop_handoff_levels",
  );
  for (const [level, expected] of Object.entries(desktopLevelContract)) {
    const record = desktopLevels.get(level);
    expectKeys(record, desktopLevelKeys, "TERM.DESKTOP_LEVEL.SHAPE", "terminology.desktop_handoff.closed", level);
    expectEqual(
      [record.meaning, record.automatic_handoff_claim_allowed, record.formal_queue_submission],
      expected,
      "TERM.DESKTOP_LEVEL.SEMANTIC_DRIFT",
      "terminology.desktop_handoff.no_run_exact",
      level,
    );
  }

  const operations = indexExact(
    glossary.operations,
    "operation_id",
    ["compile", "handoff", "run", "media_generation"],
    "TERM.OPERATION.SET_DRIFT",
    "terminology.operations.exact_set",
    "operations",
  );
  for (const [operationId, expected] of Object.entries(operationContract)) {
    const operation = operations.get(operationId);
    expectKeys(operation, operationKeys, "TERM.OPERATION.SHAPE", "terminology.operation.closed", operationId);
    for (const [field, value] of Object.entries(expected)) {
      expectEqual(operation[field], value, "TERM.OPERATION.BOUNDARY_DRIFT", "terminology.operation.compile_handoff_run_exact", `${operationId}.${field}`);
    }
  }

  expectEqual(
    glossary.native_audio,
    {
      producer: "minimax_h3",
      execution_host: "comfyui",
      start_condition: "after_explicit_user_run",
      same_execution_as_video: true,
      excluded_meanings: [
        "background_music", "voiceover", "post_mix", "silent_or_synthetic_container_track",
        "tool_notification_sound",
      ],
      claim_gate: "exact_route_profile_and_audio_output_must_be_certified",
    },
    "TERM.NATIVE_AUDIO.SEMANTIC_DRIFT",
    "terminology.native_audio.h3_only_exact",
    "native_audio",
  );

  const statuses = indexExact(
    glossary.capability_statuses,
    "status",
    ["hidden", "poc_pending", "internal", "certified", "experimental"],
    "TERM.STATUS.SET_DRIFT",
    "terminology.capability_status.exact_set",
    "capability_statuses",
  );
  for (const [status, expected] of Object.entries(statusContract)) {
    const record = statuses.get(status);
    expectKeys(record, statusKeys, "TERM.STATUS.SHAPE", "terminology.capability_status.closed", status);
    expectEqual(
      [record.normal_ui, record.advanced_ui, record.stable_ui_allowed, record.runnable_by_status_alone],
      expected,
      "TERM.STATUS.SEMANTIC_DRIFT",
      "terminology.capability_status.stable_mapping_exact",
      status,
    );
  }

  const evidence = indexExact(
    glossary.evidence_terms,
    "status",
    ["proven", "inferred", "experimental"],
    "TERM.EVIDENCE.SET_DRIFT",
    "terminology.evidence_status.exact_set",
    "evidence_terms",
  );
  const evidenceMeanings = {
    proven: "immutable_upstream_or_accepted_repeatable_poc_supports_the_exact_fact",
    inferred: "reasoned_but_not_repeatably_proven",
    experimental: "measured_evidence_exists_but_stable_gates_are_open",
  };
  for (const [status, meaning] of Object.entries(evidenceMeanings)) {
    const record = evidence.get(status);
    expectKeys(record, ["status", "meaning", "implies_certified", "stable_ui_allowed"], "TERM.EVIDENCE.SHAPE", "terminology.evidence_status.closed", status);
    expectEqual(
      [record.meaning, record.implies_certified, record.stable_ui_allowed],
      [meaning, false, false],
      "TERM.EVIDENCE.SEMANTIC_DRIFT",
      "terminology.evidence_status.no_promotion",
      status,
    );
  }

  const lifecycle = indexExact(
    glossary.model_lifecycle,
    "state",
    ["found", "identified", "verified", "compatible", "approved", "selected"],
    "TERM.MODEL_STATE.SET_DRIFT",
    "terminology.model_lifecycle.exact_order",
    "model_lifecycle",
  );
  for (const [state, expected] of Object.entries(modelStateContract)) {
    const record = lifecycle.get(state);
    expectKeys(record, modelStateKeys, "TERM.MODEL_STATE.SHAPE", "terminology.model_state.closed", state);
    expectEqual(
      [record.meaning, record.reuse_authorized, record.recipe_bound],
      expected,
      "TERM.MODEL_STATE.SEMANTIC_DRIFT",
      "terminology.model_lifecycle.no_discovery_promotion",
      state,
    );
  }

  expectEqual(
    glossary.ui_copy_policy,
    {
      project_primary_action_zh: "生成工作流并打开 ComfyUI",
      managed_core_normal_label_zh: "独立 H3 环境（推荐）",
      native_audio_label_zh: "H3 原生声音",
      poc_pending_label_zh: "正在验证",
      certified_label_zh: "Stable",
      found_model_required_caveat_zh: "完成身份、哈希、兼容性和批准检查后才能复用",
      desktop_attach_only_caveat_zh: "已检测到 ComfyUI Desktop；不会修改现有环境",
      runtime_generation_normal_label_zh: "运行环境版本",
    },
    "TERM.UI_POLICY.SEMANTIC_DRIFT",
    "terminology.ui_copy.canonical_labels_exact",
    "ui_copy_policy",
  );

  const terms = indexExact(
    glossary.terms,
    "term_id",
    requiredTermIds,
    "TERM.TERM_SET.DRIFT",
    "terminology.terms.exact_set",
    "terms",
  );
  assertUnique(glossary.terms.map((term) => `${term.domain}\u0000${term.token}`), "TERM.TERM.DUPLICATE", "terminology.term.domain_token_unique", "term");
  for (const termId of requiredTermIds) {
    const term = terms.get(termId);
    expectKeys(term, ["term_id", "token", "domain", "definition_zh"], "TERM.TERM.SHAPE", "terminology.term.closed", termId);
    if (typeof term.token !== "string" || !term.token.trim()) fail("TERM.TERM.EMPTY", "terminology.term.token_required", termId);
    if (typeof term.definition_zh !== "string" || term.definition_zh.length < 20) fail("TERM.TERM.EMPTY", "terminology.term.definition_required", termId);
  }

  return {
    routes: routes.size,
    roles: roles.size,
    topologies: topologies.size,
    operations: operations.size,
    statuses: statuses.size,
    terms: terms.size,
  };
}

const allowedCopySurfaces = new Set([
  "product_boundary_summary",
  "project_primary_action",
  "handoff_instruction",
  "model_reuse_summary",
  "runtime_topology_label",
  "external_instance_summary",
  "runtime_component_summary",
  "runtime_generation_label",
  "native_audio_label",
  "capability_badge",
  "node_origin_summary",
]);

const allowedContextKeys = new Set([
  "actor", "operation", "queue_submission", "model_state", "capability_status",
  "runtime_topology", "attach_only", "audio_kind", "runtime_includes_models", "node_origin", "term",
]);

function validateCopyEntry(entry, glossary) {
  expectKeys(entry, ["copy_id", "surface", "locale", "text", "context"], "TERM.UI_COPY.SHAPE", "terminology.ui_copy.closed", entry?.copy_id ?? "unknown");
  if (typeof entry.copy_id !== "string" || !entry.copy_id) fail("TERM.UI_COPY.IDENTITY", "terminology.ui_copy.id_required", "copy_id");
  if (!allowedCopySurfaces.has(entry.surface)) fail("TERM.UI_COPY.SURFACE", "terminology.ui_copy.surface_allowlist", entry.surface);
  if (entry.locale !== "zh-CN") fail("TERM.UI_COPY.LOCALE", "terminology.ui_copy.locale_exact", entry.copy_id);
  if (typeof entry.text !== "string" || !entry.text.trim()) fail("TERM.UI_COPY.TEXT", "terminology.ui_copy.text_required", entry.copy_id);
  if (!entry.context || typeof entry.context !== "object" || Array.isArray(entry.context)) fail("TERM.UI_COPY.CONTEXT", "terminology.ui_copy.context_object", entry.copy_id);
  for (const key of Object.keys(entry.context)) {
    if (!allowedContextKeys.has(key)) fail("TERM.UI_COPY.CONTEXT", "terminology.ui_copy.context_closed", `${entry.copy_id}:${key}`);
  }

  const normalizeText = (value) => value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  const text = normalizeText(entry.text);
  const context = entry.context;
  const policy = glossary.ui_copy_policy;
  const policyText = (key) => normalizeText(policy[key]);

  if (context.model_state && !glossary.model_lifecycle.some((state) => state.state === context.model_state)) {
    fail("TERM.UI_COPY.CONTEXT", "terminology.ui_copy.model_state_known", entry.copy_id);
  }
  if (context.capability_status && !glossary.capability_statuses.some((state) => state.status === context.capability_status)) {
    fail("TERM.UI_COPY.CONTEXT", "terminology.ui_copy.capability_status_known", entry.copy_id);
  }
  if (context.runtime_topology && !glossary.runtime_topologies.some((topology) => topology.topology_id === context.runtime_topology)) {
    fail("TERM.UI_COPY.CONTEXT", "terminology.ui_copy.runtime_topology_known", entry.copy_id);
  }

  switch (entry.surface) {
    case "product_boundary_summary":
      if (/本工具(?:会|将|可|负责)?(?:直接)?(?:生成|制作)(?:实际)?(?:视频|音频|声音)/u.test(text) || /(?:this\s+tool|control\s+plane).{0,12}(?:generates?|creates?).{0,8}(?:video|audio)/iu.test(text)) {
        fail("TERM.UI.TOOL_GENERATOR", "terminology.ui.control_plane.no_media_generation", entry.copy_id);
      }
      if (!text.includes("MiniMax H3") || !text.includes("ComfyUI") || !text.includes("Run")) {
        fail("TERM.UI.BOUNDARY_INCOMPLETE", "terminology.ui.boundary.names_all_actors", entry.copy_id);
      }
      break;
    case "project_primary_action":
      if (/(?:生成|制作|创建)(?:视频|音频|声音)|开始生成|立即运行|(?:^|\s)Run(?:$|\s)/iu.test(text)) {
        fail("TERM.UI.TOOL_GENERATOR", "terminology.ui.control_plane.no_media_generation", entry.copy_id);
      }
      if (text !== policyText("project_primary_action_zh")) {
        fail("TERM.UI.PRIMARY_ACTION_DRIFT", "terminology.ui.primary_action.compile_and_handoff_exact", entry.copy_id);
      }
      break;
    case "handoff_instruction":
      if (/\/prompt|自动提交|自动排队|auto(?:matically)?[- ]?(?:submit|queue)/iu.test(text)) {
        fail("TERM.UI.HANDOFF_AUTO_PROMPT", "terminology.ui.handoff.no_prompt_submission", entry.copy_id);
      }
      if (/自动.{0,8}(?:Run|运行|点击)|替(?:你|用户).{0,8}点击|无需.{0,8}Run/iu.test(text)) {
        fail("TERM.UI.HANDOFF_AUTO_RUN", "terminology.ui.handoff.no_run_proxy", entry.copy_id);
      }
      if (!text.includes("ComfyUI") || !text.includes("Run") || context.queue_submission !== "after_explicit_user_run") {
        fail("TERM.UI.HANDOFF_INCOMPLETE", "terminology.ui.handoff.user_run_explicit", entry.copy_id);
      }
      break;
    case "model_reuse_summary":
      if (!["approved", "selected"].includes(context.model_state) && /可直接复用|将复用|自动复用|已批准|已选入/iu.test(text)) {
        fail("TERM.UI.MODEL_STATE_PROMOTION", "terminology.ui.model_found_not_approved", entry.copy_id);
      }
      if (context.model_state === "found" && !text.includes(policyText("found_model_required_caveat_zh"))) {
        fail("TERM.UI.MODEL_CAVEAT_MISSING", "terminology.ui.model_found_caveat_required", entry.copy_id);
      }
      break;
    case "runtime_topology_label":
      if (context.runtime_topology === "managed_core" && text !== policyText("managed_core_normal_label_zh")) {
        fail("TERM.UI.RUNTIME_LABEL_DRIFT", "terminology.ui.managed_core.normal_label_exact", entry.copy_id);
      }
      break;
    case "external_instance_summary":
      if (context.attach_only === true && /自动安装|自动修改|将修改|已接管|可直接运行|已认证/iu.test(text)) {
        fail("TERM.UI.EXTERNAL_STATE_PROMOTION", "terminology.ui.external_instance.attach_only", entry.copy_id);
      }
      if (context.runtime_topology === "desktop" && context.attach_only === true && !text.includes(policyText("desktop_attach_only_caveat_zh"))) {
        fail("TERM.UI.EXTERNAL_CAVEAT_MISSING", "terminology.ui.desktop.attach_only_caveat_required", entry.copy_id);
      }
      break;
    case "runtime_component_summary":
      if (context.runtime_includes_models === false && /(?:包含|内含|自带).{0,12}(?:模型|权重|FL2VA|Ref2VA)/iu.test(text)) {
        fail("TERM.UI.RUNTIME_MODEL_CONFLATION", "terminology.ui.runtime.models_separate", entry.copy_id);
      }
      break;
    case "runtime_generation_label":
      if (/生成视频|视频生成|生成音频|媒体生成|media generation/iu.test(text)) {
        fail("TERM.UI.GENERATION_AMBIGUOUS", "terminology.ui.runtime_generation.qualify", entry.copy_id);
      }
      if (context.term === "runtime_generation" && text !== policyText("runtime_generation_normal_label_zh")) {
        fail("TERM.UI.RUNTIME_GENERATION_LABEL_DRIFT", "terminology.ui.runtime_generation.normal_label_exact", entry.copy_id);
      }
      break;
    case "native_audio_label":
      if (/BGM|背景音乐|配乐|旁白|voiceover|post[- ]?mix|后期混音|提示音/iu.test(text)) {
        fail("TERM.UI.NATIVE_AUDIO_CONFLATION", "terminology.ui.native_audio.not_post_audio", entry.copy_id);
      }
      if (context.audio_kind !== "h3_native" || text !== policyText("native_audio_label_zh")) {
        fail("TERM.UI.NATIVE_AUDIO_LABEL_DRIFT", "terminology.ui.native_audio.h3_label_exact", entry.copy_id);
      }
      break;
    case "capability_badge":
      if (context.capability_status !== "certified" && /Stable|稳定可用|已认证|Certified/iu.test(text)) {
        fail("TERM.UI.STATUS_PROMOTION", "terminology.ui.poc_pending.never_stable", entry.copy_id);
      }
      if (context.capability_status === "poc_pending" && text !== policyText("poc_pending_label_zh")) {
        fail("TERM.UI.POC_LABEL_DRIFT", "terminology.ui.poc_pending.label_exact", entry.copy_id);
      }
      if (context.capability_status === "certified" && text !== policyText("certified_label_zh")) {
        fail("TERM.UI.CERTIFIED_LABEL_DRIFT", "terminology.ui.certified.stable_label_exact", entry.copy_id);
      }
      break;
    case "node_origin_summary":
      if (context.node_origin === "partner_api" && /本地|local|离线/iu.test(text)) {
        fail("TERM.UI.PARTNER_AS_LOCAL", "terminology.ui.partner_api.never_local", entry.copy_id);
      }
      break;
    default:
      fail("TERM.UI_COPY.SURFACE", "terminology.ui_copy.surface_allowlist", entry.surface);
  }
}

function validateCopySet(copySet, glossary) {
  expectKeys(copySet, ["fixture_version", "copy_set_id", "entries"], "TERM.UI_COPY_SET.SHAPE", "terminology.ui_copy_set.closed", "ui-copy.valid.json");
  expectEqual(copySet.fixture_version, "1.0.0", "TERM.UI_COPY_SET.IDENTITY", "terminology.ui_copy_set.identity", "version");
  expectEqual(copySet.copy_set_id, "minimax-h3-tool.terminology.ui-copy.valid", "TERM.UI_COPY_SET.IDENTITY", "terminology.ui_copy_set.identity", "id");
  if (!Array.isArray(copySet.entries) || copySet.entries.length === 0) fail("TERM.UI_COPY_SET.EMPTY", "terminology.ui_copy_set.entries_required", "entries");
  assertUnique(copySet.entries.map((entry) => entry.copy_id), "TERM.UI_COPY_SET.DUPLICATE", "terminology.ui_copy_set.copy_id_unique", "copy_id");
  for (const entry of copySet.entries) validateCopyEntry(entry, glossary);
  return copySet.entries.length;
}

function applyMutation(glossary, mutation) {
  const mutated = clone(glossary);
  switch (mutation.kind) {
    case "set_product_boundary_field":
      mutated.product_boundary[mutation.field] = mutation.value;
      break;
    case "set_route_field": {
      const route = mutated.routes.find((candidate) => candidate.route_id === mutation.route_id);
      if (!route) throw new Error(`Unknown route in hostile fixture: ${mutation.route_id}`);
      route[mutation.field] = mutation.value;
      break;
    }
    case "set_model_role_field": {
      const role = mutated.model_roles.find((candidate) => candidate.slot_id === mutation.slot_id);
      if (!role) throw new Error(`Unknown model role in hostile fixture: ${mutation.slot_id}`);
      role[mutation.field] = mutation.value;
      break;
    }
    case "remove_model_role": {
      const index = mutated.model_roles.findIndex((candidate) => candidate.slot_id === mutation.slot_id);
      if (index < 0) throw new Error(`Unknown model role in hostile fixture: ${mutation.slot_id}`);
      mutated.model_roles.splice(index, 1);
      break;
    }
    case "set_topology_field": {
      const topology = mutated.runtime_topologies.find((candidate) => candidate.topology_id === mutation.topology_id);
      if (!topology) throw new Error(`Unknown topology in hostile fixture: ${mutation.topology_id}`);
      topology[mutation.field] = mutation.value;
      break;
    }
    case "set_operation_field": {
      const operation = mutated.operations.find((candidate) => candidate.operation_id === mutation.operation_id);
      if (!operation) throw new Error(`Unknown operation in hostile fixture: ${mutation.operation_id}`);
      operation[mutation.field] = mutation.value;
      break;
    }
    case "set_native_audio_field":
      mutated.native_audio[mutation.field] = mutation.value;
      break;
    case "set_capability_status_field": {
      const status = mutated.capability_statuses.find((candidate) => candidate.status === mutation.status);
      if (!status) throw new Error(`Unknown status in hostile fixture: ${mutation.status}`);
      status[mutation.field] = mutation.value;
      break;
    }
    case "set_model_state_field": {
      const state = mutated.model_lifecycle.find((candidate) => candidate.state === mutation.state);
      if (!state) throw new Error(`Unknown model state in hostile fixture: ${mutation.state}`);
      state[mutation.field] = mutation.value;
      break;
    }
    default:
      throw new Error(`Unsupported hostile mutation: ${mutation.kind}`);
  }
  return mutated;
}

function countOccurrences(text, needle) {
  return text.split(needle).length - 1;
}

function validateMarkdown(markdown, glossary) {
  if (!markdown.startsWith("# MiniMax H3 Tool — Terminology and UI-language Glossary")) {
    fail("TERM.MARKDOWN.IDENTITY", "terminology.markdown.title_exact", "title");
  }
  for (const term of glossary.terms) {
    const marker = `<!-- glossary:${term.term_id} -->`;
    if (countOccurrences(markdown, marker) !== 1) {
      fail("TERM.MARKDOWN.ANCHOR_DRIFT", "terminology.markdown.one_anchor_per_term", term.term_id);
    }
    if (countOccurrences(markdown, term.definition_zh) !== 1) {
      fail("TERM.MARKDOWN.DEFINITION_DRIFT", "terminology.markdown.definition_matches_data", term.term_id);
    }
  }
  const requiredClauses = [
    "本工具不生成视频或声音。",
    "交接不得调用 `/prompt`",
    "发现不等于批准复用",
    "Partner/API 节点不是本地节点",
  ];
  for (const clause of requiredClauses) {
    if (!markdown.includes(clause)) fail("TERM.MARKDOWN.BOUNDARY_MISSING", "terminology.markdown.hostile_claims_explicit", clause);
  }
}

const [glossaryText, copyText, markdown] = await Promise.all([
  readFile(glossaryPath, "utf8"),
  readFile(copyPath, "utf8"),
  readFile(markdownPath, "utf8"),
]);

const glossary = JSON.parse(glossaryText);
const copySet = JSON.parse(copyText);
const summary = validateGlossary(glossary);
const validCopyCount = validateCopySet(copySet, glossary);
validateMarkdown(markdown, glossary);

const hostileFiles = (await readdir(hostileDirectory))
  .filter((name) => name.endsWith(".json"))
  .sort((left, right) => left.localeCompare(right, "en", { sensitivity: "variant" }));
if (hostileFiles.length === 0) fail("TERM.HOSTILE.EMPTY", "terminology.hostile.fixtures_required", "hostile");

let hostilePassed = 0;
for (const name of hostileFiles) {
  const fixture = JSON.parse(await readFile(path.join(hostileDirectory, name), "utf8"));
  expectKeys(fixture, ["fixture_version", "fixture_id", "target", fixture.target === "glossary" ? "mutation" : "entry", "expected"], "TERM.HOSTILE.SHAPE", "terminology.hostile.closed", name);
  expectEqual(fixture.fixture_version, "1.0.0", "TERM.HOSTILE.IDENTITY", "terminology.hostile.version_exact", name);
  expectKeys(fixture.expected, ["code", "rule_id"], "TERM.HOSTILE.SHAPE", "terminology.hostile.expected_closed", name);

  let observed = null;
  try {
    if (fixture.target === "glossary") {
      validateGlossary(applyMutation(glossary, fixture.mutation));
    } else if (fixture.target === "ui_copy") {
      validateCopyEntry(fixture.entry, glossary);
    } else {
      throw new Error(`Unsupported hostile target: ${fixture.target}`);
    }
  } catch (error) {
    if (!(error instanceof TerminologyValidationError)) throw error;
    observed = { code: error.code, rule_id: error.ruleId };
  }
  if (!isDeepStrictEqual(observed, fixture.expected)) {
    throw new Error(`${fixture.fixture_id}: expected=${JSON.stringify(fixture.expected)} observed=${JSON.stringify(observed)}`);
  }
  hostilePassed += 1;
}

const digest = createHash("sha256")
  .update(JSON.stringify(glossary))
  .update("\u0000")
  .update(JSON.stringify(copySet))
  .digest("hex")
  .slice(0, 16);

console.log(
  `TERMINOLOGY_VALIDATION_OK terms=${summary.terms} routes=${summary.routes} model_roles=${summary.roles} topologies=${summary.topologies} operations=${summary.operations} statuses=${summary.statuses} ui_copy=${validCopyCount} hostile=${hostilePassed} markdown=OK digest=${digest}`,
);
