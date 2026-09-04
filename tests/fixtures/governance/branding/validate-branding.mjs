import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const validPath = path.join(here, "boundary-policy.valid.json");
const hostileDirectory = path.join(here, "hostile");

const LAYER_IDS = [
  "user_brand",
  "minimax_h3_attribution",
  "ai_generated_disclosure",
];
const PROTECTED_LAYER_IDS = [
  "minimax_h3_attribution",
  "ai_generated_disclosure",
];
const EXPECTED_DECISIONS = new Map([
  ["user_brand", {
    id: "DEC-USER-BRAND",
    gateId: "EXT-BRAND-ASSET",
    ownerRoles: ["brand_owner", "product_owner"],
  }],
  ["minimax_h3_attribution", {
    id: "DEC-H3-ATTRIBUTION",
    gateId: "EXT-H3-LICENSE",
    ownerRoles: ["legal_owner", "product_owner"],
  }],
  ["ai_generated_disclosure", {
    id: "DEC-AI-DISCLOSURE",
    gateId: "EXT-H3-LICENSE",
    ownerRoles: ["legal_owner", "product_owner"],
  }],
]);
const EXPECTED_LAYER_METADATA = new Map([
  ["user_brand", {
    role: "optional_owner_supplied_software_identity",
    surfaceIntent: "software_name_logo_author_about_installer",
  }],
  ["minimax_h3_attribution", {
    role: "minimax_h3_model_attribution",
    surfaceIntent: "applicable_commercial_ui",
  }],
  ["ai_generated_disclosure", {
    role: "ai_generated_public_output_disclosure",
    surfaceIntent: "public_output_release_policy",
  }],
]);
const SOFTWARE_BRAND_SURFACES = [
  "software_name",
  "software_logo",
  "software_author_attribution",
  "software_about_page",
  "installer_brand_assets",
];
const EXPECTED_LICENSE_OBLIGATIONS = new Map([
  ["file_ai_generation_identifier", {
    sourceClause: "III.3(b)",
    normativeStrength: "encouraged",
    defaultPolicy: "default_recommended",
    userConfigurable: true,
    implementationState: "policy_only_not_implemented",
    layerId: null,
  }],
  ["agreement_copy_to_covered_third_parties", {
    sourceClause: "III.1",
    normativeStrength: "mandatory_when_applicable",
    defaultPolicy: "block_covered_distribution_if_missing",
    userConfigurable: false,
    implementationState: "external_applicability_blocked",
    layerId: null,
  }],
  ["notice_for_covered_non_hosted_third_party_distribution", {
    sourceClause: "III.4",
    normativeStrength: "mandatory_when_applicable",
    defaultPolicy: "block_covered_distribution_if_missing",
    userConfigurable: false,
    implementationState: "external_applicability_blocked",
    layerId: null,
  }],
  ["territory_and_commercial_authorization", {
    sourceClause: "II; IV.1; V.4",
    normativeStrength: "mandatory_when_applicable",
    defaultPolicy: "block_release_until_applicability_approved",
    userConfigurable: false,
    implementationState: "external_applicability_blocked",
    layerId: null,
  }],
  ["commercial_ui_h3_attribution", {
    sourceClause: "IV.2",
    normativeStrength: "mandatory_when_applicable",
    defaultPolicy: "block_applicable_commercial_release_if_missing",
    userConfigurable: false,
    implementationState: "external_applicability_blocked",
    layerId: "minimax_h3_attribution",
  }],
  ["public_environment_machine_generated_disclosure", {
    sourceClause: "Exhibit A.12",
    normativeStrength: "mandatory_when_applicable",
    defaultPolicy: "block_applicable_public_release_if_missing",
    userConfigurable: false,
    implementationState: "external_applicability_blocked",
    layerId: "ai_generated_disclosure",
  }],
]);
const CLOSED_KEYS = Object.freeze({
  topLevel: [
    "contract_id",
    "contract_version",
    "task_id",
    "status",
    "product_boundary",
    "software_brand_boundary",
    "official_sources",
    "layer_order",
    "layers",
    "independence",
    "brand_absence",
    "release_requirements",
    "license_policy",
    "external_decisions",
    "validation_cases",
  ],
  productBoundary: [
    "tool_may_generate_media",
    "tool_may_create_brand_assets",
    "tool_may_mutate_media",
    "tool_may_write_file_identifiers",
    "tool_may_supply_prompts",
    "tool_may_invoke_inference",
    "generation_component",
  ],
  softwareBrandBoundary: [
    "software_brand_only",
    "media_branding_authority",
    "external_gate",
    "allowed_asset_surfaces",
    "media_watermark_authority",
    "output_file_brand_mutation_authority",
    "video_watermark_toggle_allowed",
    "media_finalizer_brand_authority",
  ],
  officialSources: [
    "h3_model_card",
    "h3_license",
    "qwen_encoder_model_card",
  ],
  h3ModelCardSource: [
    "url",
    "license_declaration",
    "revision_status",
  ],
  h3LicenseSource: [
    "url",
    "license_name",
    "revision_status",
  ],
  qwenSource: [
    "url",
    "model_id",
    "license_declaration",
    "determines_h3_license",
    "revision_status",
  ],
  layer: [
    "id",
    "role",
    "surface_intent",
    "normative_strength",
    "release_enforcement",
    "asset_input",
    "asset_state",
    "absence_behavior",
    "runtime_user_toggle_allowed",
    "external_decision_id",
    "may_substitute_for",
    "may_disable",
  ],
  independence: [
    "substitution_forbidden",
    "disablement_forbidden",
  ],
  independencePair: [
    "from",
    "to",
  ],
  brandAbsence: [
    "asset_state",
    "valid",
    "effect",
    "preserves",
    "generate_placeholder",
  ],
  releaseRequirements: [
    "protected_layers",
    "brand_layer_optional",
    "brand_absence_action",
    "missing_protected_layer_action",
    "layer_decisions_must_be_separate",
  ],
  licensePolicy: [
    "applicability_decision",
    "obligations",
  ],
  licenseApplicability: [
    "gate_id",
    "status",
    "authority",
    "agent_may_close",
  ],
  licenseObligation: [
    "id",
    "source_clause",
    "normative_strength",
    "default_policy",
    "user_configurable",
    "implementation_state",
    "brand_state_may_override",
    "substitutable_by_layers",
  ],
  externalDecision: [
    "id",
    "layer_id",
    "gate_id",
    "status",
    "authority",
    "required_owner_roles",
    "agent_may_prepare_evidence",
    "agent_may_close",
    "approved_policy",
    "approval_evidence",
    "implies_decisions",
  ],
  validationCase: [
    "id",
    "brand_asset_present",
    "brand_layer_state",
    "active_layers",
    "expected_policy_result",
    "release_authority",
    "file_ai_generation_identifier_policy",
    "public_environment_disclosure_policy",
  ],
});

class BrandingBoundaryValidationError extends Error {
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.code = code;
  }
}

function fail(code, detail) {
  throw new BrandingBoundaryValidationError(code, detail);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right, "en", { sensitivity: "variant" }));
}

function assertClosedObject(value, expectedKeys, codePrefix, detail) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${codePrefix}.OBJECT_REQUIRED`, detail);
  }
  const actualKeys = Object.keys(value);
  const expectedSet = new Set(expectedKeys);
  const unknownKeys = sorted(actualKeys.filter((key) => !expectedSet.has(key)));
  if (unknownKeys.length !== 0) {
    fail(`${codePrefix}.UNKNOWN_KEY`, `${detail}:${unknownKeys.join(",")}`);
  }
  const actualSet = new Set(actualKeys);
  const missingKeys = sorted(expectedKeys.filter((key) => !actualSet.has(key)));
  if (missingKeys.length !== 0) {
    fail(`${codePrefix}.MISSING_KEY`, `${detail}:${missingKeys.join(",")}`);
  }
}

function assertArray(value, code, detail) {
  if (!Array.isArray(value)) fail(code, detail);
}

function assertUnique(values, code, detail) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) fail(code, `${detail}:${value}`);
    seen.add(value);
  }
}

function assertExactSet(values, expected, code, detail) {
  assertArray(values, code, detail);
  assertUnique(values, code, detail);
  if (sorted(values).join("|") !== sorted(expected).join("|")) {
    fail(code, `${detail}:${values.join(",")}`);
  }
}

function findLayer(policy, layerId) {
  const layer = policy.layers.find((candidate) => candidate.id === layerId);
  if (!layer) fail("LAYER.UNKNOWN_ID", layerId);
  return layer;
}

function findDecision(policy, decisionId) {
  const decision = policy.external_decisions.find((candidate) => candidate.id === decisionId);
  if (!decision) fail("DECISION.UNKNOWN_ID", decisionId);
  return decision;
}

function findCase(policy, caseId) {
  const candidate = policy.validation_cases.find((item) => item.id === caseId);
  if (!candidate) fail("CASE.UNKNOWN_ID", caseId);
  return candidate;
}

function findObligation(policy, obligationId) {
  const obligation = policy.license_policy.obligations.find((candidate) => candidate.id === obligationId);
  if (!obligation) fail("LICENSE_POLICY.UNKNOWN_OBLIGATION", obligationId);
  return obligation;
}

function findOfficialSource(policy, sourceId) {
  const source = policy.official_sources?.[sourceId];
  if (!source) fail("SOURCE.UNKNOWN_ID", sourceId);
  return source;
}

function validateClosedStructure(policy) {
  assertClosedObject(policy, CLOSED_KEYS.topLevel, "STRUCTURE.TOP_LEVEL", "policy");
  assertClosedObject(
    policy.product_boundary,
    CLOSED_KEYS.productBoundary,
    "STRUCTURE.PRODUCT_BOUNDARY",
    "product_boundary",
  );
  assertClosedObject(
    policy.software_brand_boundary,
    CLOSED_KEYS.softwareBrandBoundary,
    "STRUCTURE.SOFTWARE_BRAND_BOUNDARY",
    "software_brand_boundary",
  );
  assertClosedObject(
    policy.official_sources,
    CLOSED_KEYS.officialSources,
    "STRUCTURE.OFFICIAL_SOURCES",
    "official_sources",
  );
  assertClosedObject(
    policy.official_sources.h3_model_card,
    CLOSED_KEYS.h3ModelCardSource,
    "STRUCTURE.OFFICIAL_SOURCE",
    "h3_model_card",
  );
  assertClosedObject(
    policy.official_sources.h3_license,
    CLOSED_KEYS.h3LicenseSource,
    "STRUCTURE.OFFICIAL_SOURCE",
    "h3_license",
  );
  assertClosedObject(
    policy.official_sources.qwen_encoder_model_card,
    CLOSED_KEYS.qwenSource,
    "STRUCTURE.OFFICIAL_SOURCE",
    "qwen_encoder_model_card",
  );

  assertArray(policy.layers, "STRUCTURE.LAYER.ARRAY_REQUIRED", "layers");
  policy.layers.forEach((layer, index) => {
    assertClosedObject(layer, CLOSED_KEYS.layer, "STRUCTURE.LAYER", `layers[${index}]`);
  });

  assertClosedObject(
    policy.independence,
    CLOSED_KEYS.independence,
    "STRUCTURE.INDEPENDENCE",
    "independence",
  );
  for (const matrixName of CLOSED_KEYS.independence) {
    const pairs = policy.independence[matrixName];
    assertArray(pairs, "STRUCTURE.INDEPENDENCE_PAIR.ARRAY_REQUIRED", matrixName);
    pairs.forEach((pair, index) => {
      assertClosedObject(
        pair,
        CLOSED_KEYS.independencePair,
        "STRUCTURE.INDEPENDENCE_PAIR",
        `${matrixName}[${index}]`,
      );
    });
  }

  assertClosedObject(
    policy.brand_absence,
    CLOSED_KEYS.brandAbsence,
    "STRUCTURE.BRAND_ABSENCE",
    "brand_absence",
  );
  assertClosedObject(
    policy.release_requirements,
    CLOSED_KEYS.releaseRequirements,
    "STRUCTURE.RELEASE_REQUIREMENTS",
    "release_requirements",
  );
  assertClosedObject(
    policy.license_policy,
    CLOSED_KEYS.licensePolicy,
    "STRUCTURE.LICENSE_POLICY",
    "license_policy",
  );
  assertClosedObject(
    policy.license_policy.applicability_decision,
    CLOSED_KEYS.licenseApplicability,
    "STRUCTURE.LICENSE_APPLICABILITY",
    "license_policy.applicability_decision",
  );
  assertArray(
    policy.license_policy.obligations,
    "STRUCTURE.LICENSE_OBLIGATION.ARRAY_REQUIRED",
    "license_policy.obligations",
  );
  policy.license_policy.obligations.forEach((obligation, index) => {
    const expectedKeys = [
      ...CLOSED_KEYS.licenseObligation,
      ...(obligation?.id === "commercial_ui_h3_attribution" ||
      obligation?.id === "public_environment_machine_generated_disclosure"
        ? ["layer_id"]
        : []),
    ];
    assertClosedObject(
      obligation,
      expectedKeys,
      "STRUCTURE.LICENSE_OBLIGATION",
      `license_policy.obligations[${index}]`,
    );
  });

  assertArray(
    policy.external_decisions,
    "STRUCTURE.EXTERNAL_DECISION.ARRAY_REQUIRED",
    "external_decisions",
  );
  policy.external_decisions.forEach((decision, index) => {
    assertClosedObject(
      decision,
      CLOSED_KEYS.externalDecision,
      "STRUCTURE.EXTERNAL_DECISION",
      `external_decisions[${index}]`,
    );
  });

  assertArray(
    policy.validation_cases,
    "STRUCTURE.VALIDATION_CASE.ARRAY_REQUIRED",
    "validation_cases",
  );
  policy.validation_cases.forEach((candidate, index) => {
    assertClosedObject(
      candidate,
      CLOSED_KEYS.validationCase,
      "STRUCTURE.VALIDATION_CASE",
      `validation_cases[${index}]`,
    );
  });
}

function expectedOrderedPairKeys() {
  const keys = [];
  for (const from of LAYER_IDS) {
    for (const to of LAYER_IDS) {
      if (from !== to) keys.push(`${from}->${to}`);
    }
  }
  return sorted(keys);
}

function validatePairMatrix(pairs, code) {
  assertArray(pairs, code, "matrix must be an array");
  const keys = pairs.map((pair) => {
    if (!pair || typeof pair !== "object") fail(code, "pair must be an object");
    if (!LAYER_IDS.includes(pair.from) || !LAYER_IDS.includes(pair.to) || pair.from === pair.to) {
      fail(code, `${String(pair.from)}->${String(pair.to)}`);
    }
    return `${pair.from}->${pair.to}`;
  });
  assertUnique(keys, code, "pair");
  if (sorted(keys).join("|") !== expectedOrderedPairKeys().join("|")) {
    fail(code, keys.join(","));
  }
}

function validateProductBoundary(boundary) {
  if (!boundary || typeof boundary !== "object") fail("PRODUCT_BOUNDARY.MISSING", "product_boundary");
  for (const field of [
    "tool_may_generate_media",
    "tool_may_create_brand_assets",
    "tool_may_mutate_media",
    "tool_may_write_file_identifiers",
    "tool_may_supply_prompts",
    "tool_may_invoke_inference",
  ]) {
    if (boundary[field] !== false) fail("PRODUCT_BOUNDARY.AUTHORITY_FORBIDDEN", field);
  }
  if (boundary.generation_component !== "MiniMax H3 inside ComfyUI after the user clicks Run") {
    fail("PRODUCT_BOUNDARY.GENERATION_COMPONENT", String(boundary.generation_component));
  }
}

function validateSoftwareBrandBoundary(boundary) {
  if (boundary.software_brand_only !== true) {
    fail("BRAND.SOFTWARE_ONLY_REQUIRED", String(boundary.software_brand_only));
  }
  if (boundary.media_branding_authority !== false) {
    fail("BRAND.MEDIA_AUTHORITY_FORBIDDEN", String(boundary.media_branding_authority));
  }
  if (boundary.external_gate !== "EXT-BRAND-ASSET") {
    fail("BRAND.EXTERNAL_GATE_SCOPE", String(boundary.external_gate));
  }
  assertExactSet(
    boundary.allowed_asset_surfaces,
    SOFTWARE_BRAND_SURFACES,
    "BRAND.SOFTWARE_SURFACE_SET",
    "allowed_asset_surfaces",
  );
  if (boundary.media_watermark_authority !== false) {
    fail("BRAND.MEDIA_WATERMARK_FORBIDDEN", String(boundary.media_watermark_authority));
  }
  if (boundary.output_file_brand_mutation_authority !== false) {
    fail(
      "BRAND.OUTPUT_FILE_MUTATION_FORBIDDEN",
      String(boundary.output_file_brand_mutation_authority),
    );
  }
  if (boundary.video_watermark_toggle_allowed !== false) {
    fail(
      "BRAND.VIDEO_WATERMARK_TOGGLE_FORBIDDEN",
      String(boundary.video_watermark_toggle_allowed),
    );
  }
  if (boundary.media_finalizer_brand_authority !== false) {
    fail(
      "BRAND.MEDIA_FINALIZER_AUTHORITY_FORBIDDEN",
      String(boundary.media_finalizer_brand_authority),
    );
  }
}

function validateOfficialSources(sources) {
  if (!sources || typeof sources !== "object") fail("SOURCE.MISSING", "official_sources");
  const h3ModelCard = sources.h3_model_card;
  if (
    !h3ModelCard ||
    h3ModelCard.url !== "https://huggingface.co/MiniMaxAI/MiniMax-H3" ||
    h3ModelCard.license_declaration !== "minimax-h3-community-license-agreement"
  ) {
    fail("SOURCE.H3_LICENSE_DECLARATION", "h3_model_card");
  }
  const h3License = sources.h3_license;
  if (
    !h3License ||
    h3License.url !== "https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE" ||
    h3License.license_name !== "MiniMax H3 Community License Agreement"
  ) {
    fail("SOURCE.H3_LICENSE", "h3_license");
  }
  const qwen = sources.qwen_encoder_model_card;
  if (
    !qwen ||
    qwen.url !== "https://huggingface.co/Qwen/Qwen3-VL-32B-Instruct" ||
    qwen.model_id !== "Qwen/Qwen3-VL-32B-Instruct" ||
    qwen.license_declaration !== "apache-2.0"
  ) {
    fail("SOURCE.QWEN_LICENSE_DECLARATION", "qwen_encoder_model_card");
  }
  if (qwen.determines_h3_license !== false) {
    fail("PROVENANCE.LICENSE_CONFLATION", String(qwen.determines_h3_license));
  }
  for (const [sourceId, source] of Object.entries(sources)) {
    if (source.revision_status !== "mutable_upstream_revalidation_required") {
      fail("SOURCE.REVALIDATION_REQUIRED", sourceId);
    }
  }
}

function validateLayers(policy) {
  assertArray(policy.layers, "LAYER.ID_SET", "layers");
  const layerIds = policy.layers.map((layer) => layer.id);
  assertUnique(layerIds, "LAYER.DUPLICATE_ID", "layer");
  if (layerIds.join("|") !== LAYER_IDS.join("|")) fail("LAYER.ID_SET", layerIds.join(","));
  if (!Array.isArray(policy.layer_order) || policy.layer_order.join("|") !== LAYER_IDS.join("|")) {
    fail("LAYER.ORDER", String(policy.layer_order));
  }

  for (const layer of policy.layers) {
    const expectedMetadata = EXPECTED_LAYER_METADATA.get(layer.id);
    if (
      layer.role !== expectedMetadata.role ||
      layer.surface_intent !== expectedMetadata.surfaceIntent
    ) {
      const code = layer.id === "user_brand" ? "BRAND.SOFTWARE_SCOPE" : "LAYER.SURFACE_BINDING";
      fail(code, layer.id);
    }
    assertArray(layer.may_substitute_for, "LAYER.SUBSTITUTION_FORBIDDEN", layer.id);
    if (layer.may_substitute_for.length !== 0) {
      fail("LAYER.SUBSTITUTION_FORBIDDEN", `${layer.id}->${layer.may_substitute_for.join(",")}`);
    }
    assertArray(layer.may_disable, "LAYER.DISABLEMENT_FORBIDDEN", layer.id);
    if (layer.may_disable.length !== 0) {
      fail("LAYER.DISABLEMENT_FORBIDDEN", `${layer.id}->${layer.may_disable.join(",")}`);
    }
    const expectedDecision = EXPECTED_DECISIONS.get(layer.id);
    if (layer.external_decision_id !== expectedDecision.id) {
      fail("LAYER.DECISION_BINDING", `${layer.id}:${String(layer.external_decision_id)}`);
    }
  }

  const brand = findLayer(policy, "user_brand");
  if (
    brand.normative_strength !== "optional" ||
    brand.release_enforcement !== "optional" ||
    brand.asset_input !== "owner_supplied_only"
  ) {
    fail("BRAND.ASSET_MUST_BE_OPTIONAL", brand.id);
  }
  if (brand.asset_state !== "absent" || brand.absence_behavior !== "valid_no_op") {
    fail("BRAND.ABSENCE_STATE", `${String(brand.asset_state)}:${String(brand.absence_behavior)}`);
  }
  if (brand.runtime_user_toggle_allowed !== false) {
    fail("BRAND.RUNTIME_TOGGLE_FORBIDDEN", String(brand.runtime_user_toggle_allowed));
  }

  for (const layerId of PROTECTED_LAYER_IDS) {
    const layer = findLayer(policy, layerId);
    if (
      layer.normative_strength !== "mandatory_when_applicable" ||
      layer.release_enforcement !== "required_when_human_legal_applicability_true"
    ) {
      fail("LAYER.REQUIRED_WHEN_APPLICABLE", layerId);
    }
    if (layer.runtime_user_toggle_allowed !== false) {
      fail("LAYER.RUNTIME_TOGGLE_FORBIDDEN", layerId);
    }
    if (layer.asset_input !== "not_applicable" || layer.asset_state !== "not_applicable") {
      fail("LAYER.BRAND_ASSET_COUPLING", layerId);
    }
    if (layer.absence_behavior !== "block_external_release") {
      fail("LAYER.MISSING_ACTION", layerId);
    }
  }
}

function validateLicensePolicy(policy) {
  const licensePolicy = policy.license_policy;
  if (!licensePolicy || typeof licensePolicy !== "object") fail("LICENSE_POLICY.MISSING", "license_policy");
  const applicability = licensePolicy.applicability_decision;
  if (
    !applicability ||
    applicability.gate_id !== "EXT-H3-LICENSE" ||
    applicability.status !== "blocked_external"
  ) {
    fail("LICENSE_POLICY.EXTERNAL_BLOCKED", "applicability_decision");
  }
  if (applicability.authority !== "human_external") {
    fail("LICENSE_POLICY.HUMAN_EXTERNAL", String(applicability.authority));
  }
  if (applicability.agent_may_close !== false) {
    fail("LICENSE_POLICY.AGENT_CLOSE_FORBIDDEN", String(applicability.agent_may_close));
  }

  assertArray(licensePolicy.obligations, "LICENSE_POLICY.OBLIGATION_SET", "obligations");
  const obligationIds = licensePolicy.obligations.map((obligation) => obligation.id);
  assertExactSet(
    obligationIds,
    [...EXPECTED_LICENSE_OBLIGATIONS.keys()],
    "LICENSE_POLICY.OBLIGATION_SET",
    "obligations",
  );

  for (const [obligationId, expected] of EXPECTED_LICENSE_OBLIGATIONS) {
    const obligation = findObligation(policy, obligationId);
    if (
      obligationId === "file_ai_generation_identifier" &&
      obligation.normative_strength !== "encouraged"
    ) {
      fail("LICENSE_POLICY.FILE_IDENTIFIER_STRENGTH", String(obligation.normative_strength));
    }
    if (
      obligationId === "public_environment_machine_generated_disclosure" &&
      obligation.normative_strength !== "mandatory_when_applicable"
    ) {
      fail("LICENSE_POLICY.PUBLIC_DISCLOSURE_STRENGTH", String(obligation.normative_strength));
    }
    if (obligation.normative_strength !== expected.normativeStrength) {
      fail("LICENSE_POLICY.OBLIGATION_STRENGTH", obligationId);
    }
    if (
      obligation.source_clause !== expected.sourceClause ||
      obligation.default_policy !== expected.defaultPolicy ||
      obligation.implementation_state !== expected.implementationState
    ) {
      fail("LICENSE_POLICY.OBLIGATION_BINDING", obligationId);
    }
    if (obligation.user_configurable !== expected.userConfigurable) {
      const code = obligationId === "file_ai_generation_identifier"
        ? "LICENSE_POLICY.FILE_IDENTIFIER_USER_CONFIGURABLE"
        : "LICENSE_POLICY.MANDATORY_NOT_OPTIONAL";
      fail(code, obligationId);
    }
    if (expected.layerId === null) {
      if (Object.hasOwn(obligation, "layer_id")) fail("LICENSE_POLICY.OBLIGATION_LAYER", obligationId);
    } else if (obligation.layer_id !== expected.layerId) {
      fail("LICENSE_POLICY.OBLIGATION_LAYER", obligationId);
    }
    if (obligation.brand_state_may_override !== false) {
      fail("LICENSE_POLICY.BRAND_OVERRIDE_FORBIDDEN", obligationId);
    }
    assertArray(
      obligation.substitutable_by_layers,
      "LICENSE_POLICY.OBLIGATION_SUBSTITUTION_FORBIDDEN",
      obligationId,
    );
    if (obligation.substitutable_by_layers.length !== 0) {
      fail(
        "LICENSE_POLICY.OBLIGATION_SUBSTITUTION_FORBIDDEN",
        `${obligationId}:${obligation.substitutable_by_layers.join(",")}`,
      );
    }
  }
}

function validateBrandAbsence(policy) {
  const absence = policy.brand_absence;
  if (!absence || absence.asset_state !== "absent" || absence.valid !== true || absence.effect !== "no_op") {
    fail("BRAND_ABSENCE.MUST_BE_VALID_NO_OP", "brand_absence");
  }
  assertExactSet(
    absence.preserves,
    PROTECTED_LAYER_IDS,
    "BRAND_ABSENCE.PRESERVE_SET",
    "preserves",
  );
  if (absence.generate_placeholder !== false) {
    fail("BRAND_ABSENCE.PLACEHOLDER_FORBIDDEN", String(absence.generate_placeholder));
  }
}

function validateReleaseRequirements(requirements) {
  if (!requirements || typeof requirements !== "object") fail("RELEASE_REQUIREMENTS.MISSING", "release_requirements");
  assertExactSet(
    requirements.protected_layers,
    PROTECTED_LAYER_IDS,
    "RELEASE_REQUIREMENTS.PROTECTED_SET",
    "protected_layers",
  );
  if (requirements.brand_layer_optional !== true) fail("BRAND.ASSET_MUST_BE_OPTIONAL", "release_requirements");
  if (requirements.brand_absence_action !== "continue_with_unbranded_software_identity") {
    fail("BRAND_ABSENCE.ACTION", String(requirements.brand_absence_action));
  }
  if (requirements.missing_protected_layer_action !== "block_external_release") {
    fail("RELEASE_REQUIREMENTS.FAIL_CLOSED", String(requirements.missing_protected_layer_action));
  }
  if (requirements.layer_decisions_must_be_separate !== true) {
    fail("DECISION.SEPARATION_REQUIRED", String(requirements.layer_decisions_must_be_separate));
  }
}

function validateExternalDecisions(policy) {
  assertArray(policy.external_decisions, "DECISION.ID_SET", "external_decisions");
  const decisionIds = policy.external_decisions.map((decision) => decision.id);
  assertUnique(decisionIds, "DECISION.DUPLICATE_ID", "decision");
  assertExactSet(
    policy.external_decisions.map((decision) => decision.layer_id),
    LAYER_IDS,
    "DECISION.LAYER_SET",
    "decision layers",
  );

  for (const layerId of LAYER_IDS) {
    const expected = EXPECTED_DECISIONS.get(layerId);
    const decision = findDecision(policy, expected.id);
    if (decision.layer_id !== layerId || decision.gate_id !== expected.gateId) {
      fail("DECISION.LAYER_BINDING", `${decision.id}:${String(decision.layer_id)}:${String(decision.gate_id)}`);
    }
    if (decision.status !== "blocked_external") fail("DECISION.EXTERNAL_BLOCKED", decision.id);
    if (decision.authority !== "human_external") fail("DECISION.HUMAN_EXTERNAL", decision.id);
    assertExactSet(
      decision.required_owner_roles,
      expected.ownerRoles,
      "DECISION.OWNER_ROLES",
      decision.id,
    );
    if (decision.agent_may_prepare_evidence !== true) fail("DECISION.EVIDENCE_PREPARATION", decision.id);
    if (decision.agent_may_close !== false) fail("DECISION.AGENT_CLOSE_FORBIDDEN", decision.id);
    if (decision.approved_policy !== null || decision.approval_evidence !== null) {
      fail("DECISION.UNAPPROVED_CONTENT", decision.id);
    }
    assertArray(decision.implies_decisions, "DECISION.IMPLICATION_FORBIDDEN", decision.id);
    if (decision.implies_decisions.length !== 0) {
      fail("DECISION.IMPLICATION_FORBIDDEN", `${decision.id}->${decision.implies_decisions.join(",")}`);
    }
  }
}

function validateCases(policy) {
  assertArray(policy.validation_cases, "CASE.ID_SET", "validation_cases");
  const expectedCaseIds = [
    "brand-asset-absent-no-op",
    "brand-asset-present-independent",
    "brand-assets-authorized-software-only",
  ];
  assertExactSet(
    policy.validation_cases.map((candidate) => candidate.id),
    expectedCaseIds,
    "CASE.ID_SET",
    "case ids",
  );

  for (const candidate of policy.validation_cases) {
    if (candidate.expected_policy_result !== "valid" || candidate.release_authority !== "blocked_external") {
      fail("CASE.EXTERNAL_BLOCKED", candidate.id);
    }
    assertArray(candidate.active_layers, "CASE.ACTIVE_LAYER_SET", candidate.id);
    assertUnique(candidate.active_layers, "CASE.ACTIVE_LAYER_SET", candidate.id);
    for (const layerId of candidate.active_layers) {
      if (!LAYER_IDS.includes(layerId)) fail("CASE.ACTIVE_LAYER_SET", `${candidate.id}:${layerId}`);
    }
    if (candidate.file_ai_generation_identifier_policy !== "default_recommended") {
      fail("CASE.BRAND_STATE_OVERRIDES_FILE_IDENTIFIER", candidate.id);
    }
    if (candidate.public_environment_disclosure_policy !== "mandatory_when_applicable") {
      fail("CASE.BRAND_STATE_OVERRIDES_PUBLIC_DISCLOSURE", candidate.id);
    }
  }

  const absent = findCase(policy, "brand-asset-absent-no-op");
  if (absent.brand_asset_present !== false || absent.brand_layer_state !== "absent_no_op") {
    fail("CASE.BRAND_ABSENCE_STATE", absent.id);
  }
  if (sorted(absent.active_layers).join("|") !== sorted(PROTECTED_LAYER_IDS).join("|")) {
    fail("CASE.BRAND_ABSENCE_REMOVES_PROTECTED", absent.active_layers.join(","));
  }

  const present = findCase(policy, "brand-asset-present-independent");
  if (present.brand_asset_present !== true || present.brand_layer_state !== "software_assets_enabled") {
    fail("CASE.BRAND_PRESENT_STATE", present.id);
  }
  if (sorted(present.active_layers).join("|") !== sorted(LAYER_IDS).join("|")) {
    fail("CASE.BRAND_PRESENT_LAYER_SET", present.active_layers.join(","));
  }

  const scoped = findCase(policy, "brand-assets-authorized-software-only");
  if (scoped.brand_asset_present !== true || scoped.brand_layer_state !== "software_surfaces_only") {
    fail("CASE.SOFTWARE_BRAND_SCOPE", scoped.id);
  }
  if (sorted(scoped.active_layers).join("|") !== sorted(LAYER_IDS).join("|")) {
    fail("CASE.SOFTWARE_BRAND_SCOPE_LAYER_SET", scoped.active_layers.join(","));
  }
}

function validatePolicy(policy) {
  validateClosedStructure(policy);
  if (policy.contract_id !== "brand-attribution-disclosure-boundary") {
    fail("CONTRACT.ID", String(policy.contract_id));
  }
  if (policy.contract_version !== "0.4.0-draft" || policy.task_id !== "P0-GOV-009") {
    fail("CONTRACT.VERSION_TASK", `${String(policy.contract_version)}:${String(policy.task_id)}`);
  }
  if (policy.status !== "draft_external_blocked") fail("CONTRACT.EXTERNAL_BLOCKED", String(policy.status));

  validateProductBoundary(policy.product_boundary);
  validateSoftwareBrandBoundary(policy.software_brand_boundary);
  validateOfficialSources(policy.official_sources);
  validateLayers(policy);
  validatePairMatrix(policy.independence?.substitution_forbidden, "INDEPENDENCE.SUBSTITUTION_MATRIX");
  validatePairMatrix(policy.independence?.disablement_forbidden, "INDEPENDENCE.DISABLEMENT_MATRIX");
  validateBrandAbsence(policy);
  validateReleaseRequirements(policy.release_requirements);
  validateLicensePolicy(policy);
  validateExternalDecisions(policy);
  validateCases(policy);

  return {
    layers: policy.layers.length,
    decisions: policy.external_decisions.length,
    obligations: policy.license_policy.obligations.length,
    cases: policy.validation_cases.length,
    softwareBrandOnly: policy.software_brand_boundary.software_brand_only,
    mediaBrandingAuthority: policy.software_brand_boundary.media_branding_authority,
    pairRules:
      policy.independence.substitution_forbidden.length +
      policy.independence.disablement_forbidden.length,
  };
}

function applyMutation(base, fixture) {
  const policy = clone(base);
  const mutation = fixture.mutation;
  switch (mutation.kind) {
    case "set_top_level_field":
      policy[mutation.field] = clone(mutation.value);
      break;
    case "set_product_boundary_field":
      policy.product_boundary[mutation.field] = clone(mutation.value);
      break;
    case "set_software_brand_boundary_field":
      policy.software_brand_boundary[mutation.field] = clone(mutation.value);
      break;
    case "set_official_sources_field":
      policy.official_sources[mutation.field] = clone(mutation.value);
      break;
    case "set_layer_field":
      findLayer(policy, mutation.layer_id)[mutation.field] = clone(mutation.value);
      break;
    case "append_layer_relation":
      findLayer(policy, mutation.layer_id)[mutation.field].push(mutation.target_layer_id);
      break;
    case "remove_independence_pair": {
      const pairs = policy.independence[mutation.matrix];
      const index = pairs.findIndex(
        (pair) => pair.from === mutation.from && pair.to === mutation.to,
      );
      if (index < 0) throw new Error(`Hostile fixture pair not found: ${fixture.fixture_id}`);
      pairs.splice(index, 1);
      break;
    }
    case "set_independence_field":
      policy.independence[mutation.field] = clone(mutation.value);
      break;
    case "set_independence_pair_field": {
      const pairs = policy.independence[mutation.matrix];
      const pair = pairs.find(
        (candidate) => candidate.from === mutation.from && candidate.to === mutation.to,
      );
      if (!pair) throw new Error(`Hostile fixture pair not found: ${fixture.fixture_id}`);
      pair[mutation.field] = clone(mutation.value);
      break;
    }
    case "remove_brand_preserve": {
      const index = policy.brand_absence.preserves.indexOf(mutation.layer_id);
      if (index < 0) throw new Error(`Hostile fixture preserve not found: ${fixture.fixture_id}`);
      policy.brand_absence.preserves.splice(index, 1);
      break;
    }
    case "set_brand_absence_field":
      policy.brand_absence[mutation.field] = clone(mutation.value);
      break;
    case "set_release_requirement_field":
      policy.release_requirements[mutation.field] = clone(mutation.value);
      break;
    case "set_decision_field":
      findDecision(policy, mutation.decision_id)[mutation.field] = clone(mutation.value);
      break;
    case "append_decision_implication":
      findDecision(policy, mutation.decision_id).implies_decisions.push(mutation.target_decision_id);
      break;
    case "set_case_active_layers":
      findCase(policy, mutation.case_id).active_layers = clone(mutation.active_layers);
      break;
    case "set_case_field":
      findCase(policy, mutation.case_id)[mutation.field] = clone(mutation.value);
      break;
    case "set_obligation_field":
      findObligation(policy, mutation.obligation_id)[mutation.field] = clone(mutation.value);
      break;
    case "set_license_policy_field":
      policy.license_policy[mutation.field] = clone(mutation.value);
      break;
    case "set_license_applicability_field":
      policy.license_policy.applicability_decision[mutation.field] = clone(mutation.value);
      break;
    case "append_obligation_substitution":
      findObligation(policy, mutation.obligation_id).substitutable_by_layers.push(mutation.layer_id);
      break;
    case "set_official_source_field":
      findOfficialSource(policy, mutation.source_id)[mutation.field] = clone(mutation.value);
      break;
    default:
      throw new Error(`Unsupported hostile mutation: ${String(mutation.kind)}`);
  }
  return policy;
}

const validPolicy = JSON.parse(await readFile(validPath, "utf8"));
const validSummary = validatePolicy(validPolicy);

const hostileFiles = (await readdir(hostileDirectory))
  .filter((name) => name.endsWith(".json"))
  .sort((left, right) => left.localeCompare(right, "en", { sensitivity: "variant" }));

let negativePassed = 0;
for (const name of hostileFiles) {
  const fixture = JSON.parse(await readFile(path.join(hostileDirectory, name), "utf8"));
  const mutated = applyMutation(validPolicy, fixture);
  let observed = null;
  try {
    validatePolicy(mutated);
  } catch (error) {
    if (!(error instanceof BrandingBoundaryValidationError)) throw error;
    observed = error.code;
  }
  if (observed !== fixture.expected_code) {
    throw new Error(
      `${fixture.fixture_id}: expected ${fixture.expected_code}, observed ${observed ?? "PASS"}`,
    );
  }
  negativePassed += 1;
}

console.log(
  `BRANDING_BOUNDARY_VALIDATION_OK valid=1 negative=${negativePassed} layers=${validSummary.layers} decisions=${validSummary.decisions} obligations=${validSummary.obligations} cases=${validSummary.cases} pair_rules=${validSummary.pairRules} software_brand_only=${validSummary.softwareBrandOnly} media_branding_authority=${validSummary.mediaBrandingAuthority} external_blocked=${validSummary.decisions + 1}`,
);
