#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..", "..");
const indexPath = path.join(here, "index.valid.json");
const hostileDirectory = path.join(here, "hostile");
const documentationPath = path.join(
  root,
  "docs",
  "architecture",
  "EXTERNAL_DISTRIBUTION_EVIDENCE_CHECKLIST.md",
);

const SHA256 = /^[a-f0-9]{64}$/;
const MUTABLE_REVISION = /^(?:main|master|latest|nightly|head|stable)$/i;
const IMMUTABLE_REVISION = /^(?:(?:git|sha256):)?[a-f0-9]{40,64}$/;
const UTC_DATE_TIME = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/;
const AGENT_IDENTITY = /(?:agent|bot|codex|worker|automation)/i;

const EXPECTED_COMPONENTS = new Map([
  ["h3-model", {
    category: "minimax-h3-model-and-model-files",
    applicability: "required",
    gates: ["EXT-H3-LICENSE"],
    signature: "upstream-attestation-or-human-waiver",
    evidence: ["per-file-model-provenance", "region-entity-aup-distribution", "h3-attribution-and-ai-disclosure", "separate-minimax-qwen-license-records", "h3-obligation-modality-lock"],
    tests: ["h3-per-file-provenance", "h3-license-scope", "h3-certified-profile-load", "h3-attribution-disclosure", "h3-qwen-license-record-separation", "h3-obligation-modality-lock"],
    claims: ["CAP-MODEL-BASE", "CAP-PUBLIC-INSTALLER", "CAP-AI-DISCLOSURE", "CAP-MP4-AUDIO", "CAP-LONG-30"],
    decisions: ["HUM-LEGAL-DISTRIBUTION", "HUM-SIGNING", "HUM-RELEASE"],
  }],
  ["comfyui-core", {
    category: "managed-comfyui-core",
    applicability: "required",
    gates: ["EXT-COMFY-CORE"],
    signature: "upstream-attestation-or-human-waiver",
    evidence: ["exact-core-revision", "gpl-source-offer", "process-combination-boundary"],
    tests: ["core-exact-revision", "core-source-offer-notice", "core-process-boundary", "core-offline-runtime-smoke"],
    claims: ["CAP-RT-CORE", "CAP-PUBLIC-INSTALLER", "CAP-MP4-AUDIO", "CAP-OFFLINE-RUN"],
    decisions: ["HUM-LEGAL-DISTRIBUTION", "HUM-SIGNING", "HUM-RELEASE"],
  }],
  ["comfyui-frontend", {
    category: "locked-comfyui-frontend-and-templates",
    applicability: "required",
    gates: ["EXT-COMFY-FRONTEND"],
    signature: "upstream-attestation-or-human-waiver",
    evidence: ["exact-frontend-template-revisions", "no-latest-proof", "source-notice-modifications"],
    tests: ["frontend-exact-artifact", "template-provenance", "frontend-no-latest", "frontend-source-notice-modifications"],
    claims: ["CAP-RT-CORE", "CAP-UI-WORKFLOW", "CAP-PUBLIC-INSTALLER", "CAP-OFFLINE-RUN"],
    decisions: ["HUM-LEGAL-DISTRIBUTION", "HUM-SIGNING", "HUM-RELEASE"],
  }],
  ["h3-long-video-runner", {
    category: "first-party-runner-and-frontend-extension",
    applicability: "conditional",
    gates: ["EXT-RUNNER-DIST"],
    signature: "upstream-attestation-or-human-waiver",
    evidence: ["architecture-adr", "process-license-boundary", "no-first-queue-test"],
    tests: ["runner-architecture-boundary", "runner-license-boundary", "runner-no-first-queue", "runner-resume-no-requeue"],
    claims: ["CAP-LONG-30", "CAP-LONG-60"],
    decisions: ["HUM-LEGAL-DISTRIBUTION", "HUM-SIGNING", "HUM-RELEASE"],
  }],
  ["pyav-runtime", {
    category: "pyav-wheel-and-linked-media-libraries",
    applicability: "required",
    gates: ["EXT-FFMPEG"],
    signature: "upstream-attestation-or-human-waiver",
    evidence: ["exact-wheel-version-hash", "linked-library-inventory", "codec-metadata-probe"],
    tests: ["pyav-exact-wheel", "pyav-linked-library-inventory", "pyav-codec-metadata-probe", "pyav-output-path"],
    claims: ["CAP-MP4-AUDIO", "CAP-PUBLIC-INSTALLER", "CAP-OFFLINE-RUN"],
    decisions: ["HUM-LEGAL-DISTRIBUTION", "HUM-SIGNING", "HUM-RELEASE"],
  }],
  ["private-ffmpeg-cli", {
    category: "private-ffmpeg-and-ffprobe-binaries",
    applicability: "conditional",
    gates: ["EXT-FFMPEG"],
    signature: "upstream-attestation-or-human-waiver",
    evidence: ["exact-binary-version-hash", "ffmpeg-buildconf", "enabled-codecs", "license-source-material", "codec-patent-market-decision"],
    tests: ["ffmpeg-exact-version-hash", "ffmpeg-buildconf-codecs", "ffmpeg-license-source-material", "ffmpeg-output-metadata"],
    claims: ["CAP-MP4-AUDIO", "CAP-POST-AUDIO", "CAP-LONG-30"],
    decisions: ["HUM-LEGAL-DISTRIBUTION", "HUM-SIGNING", "HUM-RELEASE"],
  }],
  ["restricted-comfy-cli", {
    category: "restricted-comfy-cli-route",
    applicability: "conditional",
    gates: ["EXT-COMFY-CLI"],
    signature: "upstream-attestation-or-human-waiver",
    evidence: ["exact-wheel-version-hash", "separate-process-boundary", "command-allowlist", "local-no-token-cloud-telemetry-egress", "no-runtime-downloads"],
    tests: ["cli-exact-wheel", "cli-command-allowlist", "cli-local-no-token-cloud-telemetry-egress", "cli-no-runtime-downloads"],
    claims: ["CAP-RT-CORE", "CAP-OFFLINE-RUN"],
    decisions: ["HUM-LEGAL-DISTRIBUTION", "HUM-SIGNING", "HUM-RELEASE"],
  }],
  ["native-helper", {
    category: "first-party-native-helper-executable",
    applicability: "required",
    gates: ["EXT-SIGNING"],
    signature: "authenticode-rfc3161-required",
    evidence: ["exact-source-build-record", "abi-threat-contract", "authenticode-rfc3161", "protocol-fuzz-packaged-identity"],
    tests: ["native-helper-build-identity", "native-helper-abi-threat-contract", "native-helper-protocol-fuzz", "native-helper-sign-verify"],
    claims: ["CAP-PUBLIC-INSTALLER"],
    decisions: ["HUM-LEGAL-DISTRIBUTION", "HUM-CERTIFICATE", "HUM-SIGNING", "HUM-RELEASE"],
  }],
  ["windows-signing", {
    category: "windows-certificate-signing-and-timestamp-evidence",
    applicability: "required",
    gates: ["EXT-SIGNING"],
    signature: "certificate-chain-and-custody-attestation-required",
    evidence: ["organization-certificate", "publisher-identity", "private-key-custody", "rfc3161-sign-verify", "revocation-renewal", "signed-artifact-coverage"],
    tests: ["signing-certificate-chain", "signing-private-key-custody", "signing-rfc3161-sign-verify", "signing-revocation-renewal-coverage"],
    claims: ["CAP-PUBLIC-INSTALLER"],
    decisions: ["HUM-LEGAL-DISTRIBUTION", "HUM-CERTIFICATE", "HUM-SIGNING", "HUM-RELEASE"],
  }],
  ["windows-installer", {
    category: "windows-installer-package",
    applicability: "required",
    gates: ["EXT-H3-LICENSE", "EXT-COMFY-CORE", "EXT-COMFY-FRONTEND", "EXT-SIGNING", "EXT-HARDWARE"],
    signature: "authenticode-rfc3161-required",
    evidence: ["exact-build-inputs", "package-sbom-notice", "authenticode-rfc3161", "offline-no-updater", "install-upgrade-rollback-uninstall"],
    tests: ["installer-frozen-input-inventory", "installer-sbom-notice", "installer-authenticode-rfc3161", "installer-offline-no-updater", "installer-install-upgrade-rollback-uninstall"],
    claims: ["CAP-PUBLIC-INSTALLER", "CAP-OFFLINE-RUN"],
    decisions: ["HUM-LEGAL-DISTRIBUTION", "HUM-CERTIFICATE", "HUM-SIGNING", "HUM-RELEASE"],
  }],
  ["windows-vm-qualification", {
    category: "windows-vm-install-release-qualification",
    applicability: "required",
    gates: ["EXT-HARDWARE", "EXT-SIGNING"],
    signature: "qa-report-human-attestation-required",
    evidence: ["vm-image-os-build-provenance", "hardware-profile", "exact-installer-hash", "repeatable-install-matrix", "c-drive-io-budget", "offline-egress", "retained-data-uninstall"],
    tests: ["vm-image-os-hardware-provenance", "vm-exact-installer-hash", "vm-install-upgrade-rollback-uninstall", "vm-c-drive-io-offline-egress", "vm-retained-data-repeatability"],
    claims: ["CAP-PUBLIC-INSTALLER", "CAP-OFFLINE-RUN"],
    decisions: ["HUM-LEGAL-DISTRIBUTION", "HUM-SIGNING", "HUM-RELEASE"],
  }],
]);

const COMMON_EVIDENCE = [
  "source-locator",
  "immutable-revision",
  "artifact-length-sha256",
  "provenance-chain",
  "license-text-notice-human-decision",
  "signature-or-human-waiver",
  "repeatable-test-reports",
  "claim-status-expiry",
  "human-owner-scope",
];

const EXPECTED_GATES = [
  "EXT-H3-LICENSE",
  "EXT-COMFY-CORE",
  "EXT-COMFY-FRONTEND",
  "EXT-RUNNER-DIST",
  "EXT-FFMPEG",
  "EXT-COMFY-CLI",
  "EXT-DESKTOP-DIST",
  "EXT-SIGNING",
  "EXT-HARDWARE",
  "EXT-BRAND-ASSET",
];

const EXPECTED_DECISIONS = new Map([
  ["HUM-LEGAL-DISTRIBUTION", "legal"],
  ["HUM-CERTIFICATE", "certificate"],
  ["HUM-BRAND", "brand"],
  ["HUM-SIGNING", "signing"],
  ["HUM-RELEASE", "release"],
]);

const EXPECTED_LICENSE_RECORDS = new Map([
  ["minimax-h3-community-license-agreement", {
    component: "h3-model",
    subject: "minimax-h3",
    type: "license-agreement",
    license: "minimax-h3-community-license-agreement",
    source: "https://huggingface.co/MiniMaxAI/MiniMax-H3",
    obligations: new Map(),
  }],
  ["minimax-h3-license-notice-obligations", {
    component: "h3-model",
    subject: "minimax-h3",
    type: "license-notice-obligations",
    license: "minimax-h3-community-license-agreement",
    source: "https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE",
    obligations: new Map([
      ["h3-agreement-copy", ["III.1", "must", "covered-third-party-distribution", "Provide the Agreement with a covered distribution to a third party; exact applicability is Human/legal-owned."]],
      ["h3-modified-file-notice", ["III.2", "must", "covered-files-are-modified", "Modified covered files require prominent modification notice; exact applicability is Human/legal-owned."]],
      ["h3-notice-file", ["III.4", "must", "covered-third-party-non-hosted-distribution", "Carry the prescribed NOTICE for the covered distribution condition; exact text and applicability require an immutable snapshot and Human/legal review."]],
      ["h3-applicable-territory-commercial-terms", ["Applicable Territory and commercial terms", "human-review-required", "target-entity-territory-and-commercial-use", "No Agent conclusion is permitted for territory or commercial authorization."]],
    ]),
  }],
  ["minimax-h3-ai-generation-identification", {
    component: "h3-model",
    subject: "minimax-h3",
    type: "ai-generation-identification",
    license: "minimax-h3-community-license-agreement",
    source: "https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE",
    obligations: new Map([
      ["h3-file-ai-generation-identifier", ["III.3(b)", "encouraged", "file-containing-generated-content", "A file AI-generation identifier is encouraged, not mandatory."]],
      ["h3-public-environment-machine-generated-disclosure", ["Exhibit A.12", "must", "covered-public-environment-use", "Machine-generated content disclosure is mandatory when the Exhibit A.12 condition applies; applicability is Human/legal-owned."]],
    ]),
  }],
  ["qwen3-vl-32b-instruct-apache-2.0", {
    component: "h3-model",
    subject: "qwen3-vl-32b-instruct",
    type: "separate-upstream-license-declaration",
    license: "Apache-2.0",
    source: "https://huggingface.co/Qwen/Qwen3-VL-32B-Instruct",
    obligations: new Map(),
  }],
]);

const EXPECTED_PUBLIC_CLAIMS = new Map([
  ["CAP-PUBLIC-INSTALLER", {
    components: ["h3-model", "comfyui-core", "comfyui-frontend", "pyav-runtime", "native-helper", "windows-signing", "windows-installer", "windows-vm-qualification"],
    gates: ["EXT-H3-LICENSE", "EXT-COMFY-CORE", "EXT-COMFY-FRONTEND", "EXT-SIGNING", "EXT-HARDWARE"],
    decisions: ["HUM-LEGAL-DISTRIBUTION", "HUM-CERTIFICATE", "HUM-SIGNING", "HUM-RELEASE"],
  }],
  ["CAP-MP4-AUDIO", {
    components: ["h3-model", "comfyui-core", "pyav-runtime"],
    gates: ["EXT-H3-LICENSE", "EXT-COMFY-CORE", "EXT-FFMPEG"],
    decisions: ["HUM-LEGAL-DISTRIBUTION", "HUM-RELEASE"],
  }],
  ["CAP-LONG-30", {
    components: ["h3-model", "h3-long-video-runner", "private-ffmpeg-cli"],
    gates: ["EXT-H3-LICENSE", "EXT-RUNNER-DIST", "EXT-FFMPEG"],
    decisions: ["HUM-LEGAL-DISTRIBUTION", "HUM-SIGNING", "HUM-RELEASE"],
  }],
  ["CAP-OFFLINE-RUN", {
    components: ["comfyui-core", "comfyui-frontend", "pyav-runtime", "windows-installer", "windows-vm-qualification"],
    gates: ["EXT-COMFY-CORE", "EXT-COMFY-FRONTEND", "EXT-HARDWARE"],
    decisions: ["HUM-LEGAL-DISTRIBUTION", "HUM-RELEASE"],
  }],
  ["CAP-SOFTWARE-BRANDING", {
    components: [],
    gates: ["EXT-BRAND-ASSET"],
    decisions: ["HUM-BRAND", "HUM-RELEASE"],
  }],
]);

const EXPECTED_HOSTILE_FILES = [
  "01-missing-required-component.json",
  "02-duplicate-component.json",
  "03-unknown-operational-field.json",
  "04-core-frontend-conflation.json",
  "05-pyav-private-ffmpeg-conflation.json",
  "06-missing-immutable-revision-field.json",
  "07-mutable-source-revision.json",
  "08-invalid-artifact-hash.json",
  "09-agent-accepts-legal.json",
  "10-agent-accepts-certificate.json",
  "11-agent-accepts-brand.json",
  "12-agent-accepts-signing.json",
  "13-agent-accepts-release.json",
  "14-agent-as-human-owner.json",
  "15-open-gate-supports-release.json",
  "16-blocked-decision-supports-release.json",
  "17-blocked-component-claim-supports-release.json",
  "18-unknown-component-claim-supports-release.json",
  "19-excluded-runner-claims-support.json",
  "20-blocked-tests-support-release.json",
  "21-sha256-is-not-authenticode.json",
  "22-blocked-public-claim-supports-release.json",
  "23-approved-label-without-release-support.json",
  "24-manual-release-support.json",
  "25-missing-qwen-license-record.json",
  "26-h3-file-identifier-modality-drift.json",
  "27-h3-public-disclosure-modality-drift.json",
  "28-missing-license-proof-not-blocked-external.json",
  "29-qwen-license-conflated-with-h3.json",
  "30-cli-egress-test-omitted.json",
  "31-vm-evidence-test-omitted.json",
  "32-license-proof-without-human-acceptance.json",
  "33-h3-notice-obligation-omitted.json",
  "34-h3-blocked-license-record-support.json",
  "35-human-acceptance-with-unscoped-evidence.json",
  "36-certified-public-claim-without-support.json",
  "37-nonboolean-release-support.json",
  "38-public-claim-requirement-omitted.json",
  "39-h3-obligation-summary-contradiction.json",
  "40-release-installer-artifact-mismatch.json",
  "41-vm-qualified-installer-mismatch.json",
  "42-component-claim-mapping-omitted.json",
  "43-component-human-decision-omitted.json",
  "44-blank-closed-gate-owner.json",
  "45-vm-single-attempt-repeatability.json",
  "46-supporting-public-claim-without-expiry.json",
  "47-qualified-installer-on-non-vm-component.json",
  "48-media-branding-authority-enabled.json",
  "49-legacy-media-brand-capability.json",
];

const ROOT_KEYS = [
  "format_version",
  "task_id",
  "packet_id",
  "packet_purpose",
  "brand_boundary",
  "authority_policy",
  "release_candidate",
  "external_gates",
  "human_decisions",
  "license_records",
  "components",
  "public_claims",
];

class DistributionEvidenceError extends Error {
  constructor(code, instancePath, ruleId, detail) {
    super(`${code} ${instancePath} ${ruleId}: ${detail}`);
    this.code = code;
    this.instancePath = instancePath;
    this.ruleId = ruleId;
  }
}

function fail(code, instancePath, ruleId, detail) {
  throw new DistributionEvidenceError(code, instancePath, ruleId, detail);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function digest(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function canonicalStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalStringify(item)).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(",")}}`;
}

function evidenceSetDigest(packet) {
  return digest(canonicalStringify({
    brand_boundary: packet.brand_boundary,
    authority_policy: packet.authority_policy,
    release_candidate: packet.release_candidate,
    external_gates: packet.external_gates,
    license_records: packet.license_records,
    components: packet.components,
    public_claims: packet.public_claims,
  }));
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertObject(value, instancePath) {
  if (!isObject(value)) {
    fail("SHAPE.NOT_OBJECT", instancePath, "DIST-SHAPE-001", "expected an object");
  }
}

function assertArray(value, instancePath) {
  if (!Array.isArray(value)) {
    fail("SHAPE.NOT_ARRAY", instancePath, "DIST-SHAPE-001", "expected an array");
  }
}

function assertClosedObject(value, keys, instancePath) {
  assertObject(value, instancePath);
  const allowed = new Set(keys);
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      fail("SHAPE.MISSING_KEY", `${instancePath}/${escapePointer(key)}`, "DIST-SHAPE-002", key);
    }
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail("SHAPE.UNKNOWN_KEY", `${instancePath}/${escapePointer(key)}`, "DIST-SHAPE-003", key);
    }
  }
}

function escapePointer(value) {
  return String(value).replaceAll("~", "~0").replaceAll("/", "~1");
}

function sameSet(actual, expected) {
  return actual.length === expected.length &&
    [...actual].sort().join("\u0000") === [...expected].sort().join("\u0000");
}

function assertUniqueStrings(values, instancePath, code = "SHAPE.DUPLICATE_VALUE", ruleId = "DIST-SHAPE-004") {
  assertArray(values, instancePath);
  const seen = new Set();
  for (let index = 0; index < values.length; index += 1) {
    if (typeof values[index] !== "string" || values[index].length === 0) {
      fail("SHAPE.INVALID_STRING", `${instancePath}/${index}`, "DIST-SHAPE-005", "expected non-empty string");
    }
    if (seen.has(values[index])) fail(code, `${instancePath}/${index}`, ruleId, values[index]);
    seen.add(values[index]);
  }
}

function assertSha256(value, instancePath, code, ruleId) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    fail(code, instancePath, ruleId, "expected lowercase sha256");
  }
}

function assertBoolean(value, instancePath, ruleId) {
  if (typeof value !== "boolean") {
    fail("SHAPE.INVALID_BOOLEAN", instancePath, ruleId, String(value));
  }
}

function isImmutableRevision(value) {
  return typeof value === "string" && IMMUTABLE_REVISION.test(value) && !MUTABLE_REVISION.test(value);
}

function isUtcDateTime(value) {
  return typeof value === "string" && UTC_DATE_TIME.test(value) && Number.isFinite(Date.parse(value));
}

function assertHumanId(value, instancePath, ruleId) {
  if (typeof value !== "string" || value.trim().length === 0 || AGENT_IDENTITY.test(value)) {
    fail("AUTHORITY.INVALID_HUMAN_ID", instancePath, ruleId, String(value));
  }
}

function indexedBy(items, idField, instancePath, duplicateCode, ruleId) {
  assertArray(items, instancePath);
  const result = new Map();
  for (let index = 0; index < items.length; index += 1) {
    assertObject(items[index], `${instancePath}/${index}`);
    const id = items[index][idField];
    if (typeof id !== "string" || id.length === 0) {
      fail("SHAPE.INVALID_ID", `${instancePath}/${index}/${idField}`, "DIST-SHAPE-006", String(id));
    }
    if (result.has(id)) fail(duplicateCode, `${instancePath}/${index}/${idField}`, ruleId, id);
    result.set(id, { value: items[index], index });
  }
  return result;
}

function validateAuthorityPolicy(policy) {
  const instancePath = "/authority_policy";
  assertClosedObject(policy, [
    "evidence_preparer",
    "agent_permissions",
    "agent_acceptance_permissions",
    "human_only_decision_kinds",
    "evidence_statuses",
    "component_claim_statuses",
    "public_claim_statuses",
    "release_supporting_component_claim_statuses",
    "release_supporting_public_claim_statuses",
  ], instancePath);
  const expected = {
    evidence_preparer: "agent",
    agent_permissions: ["collect", "index", "validate", "recommend"],
    agent_acceptance_permissions: [],
    human_only_decision_kinds: ["legal", "certificate", "brand", "signing", "release"],
    evidence_statuses: ["unknown", "blocked", "blocked_external", "proven"],
    component_claim_statuses: ["unknown", "blocked", "inferred", "poc_pending", "experimental", "proven"],
    public_claim_statuses: ["unknown", "blocked", "hidden", "poc_pending", "internal", "experimental", "certified"],
    release_supporting_component_claim_statuses: ["proven"],
    release_supporting_public_claim_statuses: ["certified", "experimental"],
  };
  for (const [key, wanted] of Object.entries(expected)) {
    const actual = policy[key];
    const equal = Array.isArray(wanted)
      ? Array.isArray(actual) && sameSet(actual, wanted)
      : actual === wanted;
    if (!equal) fail("AUTHORITY.POLICY_DRIFT", `${instancePath}/${key}`, "DIST-AUTH-001", key);
  }
}

function validateBrandBoundary(boundary) {
  const instancePath = "/brand_boundary";
  assertClosedObject(boundary, [
    "capability_id", "software_brand_only", "media_branding_authority", "allowed_surfaces",
    "forbidden_surfaces", "independent_requirements",
  ], instancePath);
  assertBoolean(boundary.software_brand_only, `${instancePath}/software_brand_only`, "DIST-BRAND-001");
  assertBoolean(boundary.media_branding_authority, `${instancePath}/media_branding_authority`, "DIST-BRAND-001");
  assertUniqueStrings(boundary.allowed_surfaces, `${instancePath}/allowed_surfaces`);
  assertUniqueStrings(boundary.forbidden_surfaces, `${instancePath}/forbidden_surfaces`);
  assertUniqueStrings(boundary.independent_requirements, `${instancePath}/independent_requirements`);
  if (boundary.capability_id !== "CAP-SOFTWARE-BRANDING" || boundary.software_brand_only !== true ||
      boundary.media_branding_authority !== false ||
      !sameSet(boundary.allowed_surfaces, ["software-name", "software-logo", "author-attribution", "about-page", "installer"]) ||
      !sameSet(boundary.forbidden_surfaces, ["generated-media", "output-watermark", "media-mutation"]) ||
      !sameSet(boundary.independent_requirements, ["h3-attribution", "license-notice", "conditional-ai-disclosure"])) {
    fail("BRAND.BOUNDARY_DRIFT", instancePath, "DIST-BRAND-002", boundary.capability_id);
  }
}

function validateDecisions(packet) {
  const expectedEvidenceSetSha256 = evidenceSetDigest(packet);
  const map = indexedBy(packet.human_decisions, "decision_id", "/human_decisions", "COVERAGE.DUPLICATE_DECISION", "DIST-COV-003");
  if (!sameSet([...map.keys()], [...EXPECTED_DECISIONS.keys()])) {
    fail("COVERAGE.DECISION_SET", "/human_decisions", "DIST-COV-003", [...map.keys()].join(","));
  }
  for (const [decisionId, expectedKind] of EXPECTED_DECISIONS) {
    const { value: decision, index } = map.get(decisionId);
    const basePath = `/human_decisions/${index}`;
    assertClosedObject(decision, [
      "decision_id", "kind", "authority_class", "status", "prepared_by", "owner", "accepted_by",
      "decision_record_sha256", "scope", "supports_external_distribution",
    ], basePath);
    assertClosedObject(decision.prepared_by, ["authority_type", "authority_id"], `${basePath}/prepared_by`);
    assertClosedObject(decision.owner, ["owner_id", "owner_role"], `${basePath}/owner`);
    if (typeof decision.owner.owner_role !== "string" || decision.owner.owner_role.trim().length === 0) {
      fail("AUTHORITY.MISSING_OWNER_ROLE", `${basePath}/owner/owner_role`, "DIST-AUTH-002", decisionId);
    }
    assertClosedObject(decision.scope, [
      "target_stage", "legal_entity", "territories", "delivery_modes", "component_ids", "release_artifact_sha256",
      "evidence_set_sha256", "capability_ids", "expires_at", "revalidation_triggers",
    ], `${basePath}/scope`);
    assertBoolean(decision.supports_external_distribution, `${basePath}/supports_external_distribution`, "DIST-AUTH-002");
    if (decision.kind !== expectedKind || decision.authority_class !== "human_external_only") {
      fail("AUTHORITY.DECISION_IDENTITY_DRIFT", basePath, "DIST-AUTH-002", decisionId);
    }
    if (decision.prepared_by.authority_type !== "agent" || typeof decision.prepared_by.authority_id !== "string") {
      fail("AUTHORITY.INVALID_PREPARER", `${basePath}/prepared_by`, "DIST-AUTH-002", decisionId);
    }
    if (decision.accepted_by !== null) {
      assertClosedObject(decision.accepted_by, ["authority_type", "authority_id"], `${basePath}/accepted_by`);
      if (decision.accepted_by.authority_type === "agent" || AGENT_IDENTITY.test(String(decision.accepted_by.authority_id))) {
        fail("AUTHORITY.AGENT_ACCEPTANCE", `${basePath}/accepted_by`, "DIST-AUTH-003", decisionId);
      }
    }
    if (!["unknown", "blocked", "accepted", "rejected", "expired"].includes(decision.status)) {
      fail("AUTHORITY.INVALID_DECISION_STATUS", `${basePath}/status`, "DIST-AUTH-004", decision.status);
    }
    if (decision.status === "accepted") {
      if (decision.accepted_by === null || !["human", "external"].includes(decision.accepted_by.authority_type)) {
        fail("AUTHORITY.ACCEPTED_MISSING_HUMAN", `${basePath}/accepted_by`, "DIST-AUTH-004", decisionId);
      }
      assertHumanId(decision.owner.owner_id, `${basePath}/owner/owner_id`, "DIST-AUTH-004");
      assertHumanId(decision.accepted_by.authority_id, `${basePath}/accepted_by/authority_id`, "DIST-AUTH-004");
      assertSha256(decision.decision_record_sha256, `${basePath}/decision_record_sha256`, "AUTHORITY.DECISION_RECORD_REQUIRED", "DIST-AUTH-004");
      const scope = decision.scope;
      if (typeof scope.target_stage !== "string" || scope.target_stage.length === 0 ||
          typeof scope.legal_entity !== "string" || scope.legal_entity.length === 0 ||
          scope.territories.length === 0 || scope.delivery_modes.length === 0 || scope.capability_ids.length === 0 ||
          (decision.kind !== "brand" && scope.component_ids.length === 0)) {
        fail("AUTHORITY.DECISION_SCOPE_REQUIRED", `${basePath}/scope`, "DIST-AUTH-004", decisionId);
      }
      assertSha256(scope.release_artifact_sha256, `${basePath}/scope/release_artifact_sha256`, "AUTHORITY.DECISION_SCOPE_REQUIRED", "DIST-AUTH-004");
      assertSha256(scope.evidence_set_sha256, `${basePath}/scope/evidence_set_sha256`, "AUTHORITY.DECISION_SCOPE_REQUIRED", "DIST-AUTH-004");
      if (scope.evidence_set_sha256 !== expectedEvidenceSetSha256) {
        fail("AUTHORITY.EVIDENCE_SET_MISMATCH", `${basePath}/scope/evidence_set_sha256`, "DIST-AUTH-004", decisionId);
      }
      if (!decision.supports_external_distribution) {
        fail("AUTHORITY.ACCEPTED_WITHOUT_SUPPORT", `${basePath}/supports_external_distribution`, "DIST-AUTH-004", decisionId);
      }
    } else {
      if (decision.supports_external_distribution) {
        fail("AUTHORITY.NON_ACCEPTED_SUPPORT", `${basePath}/supports_external_distribution`, "DIST-AUTH-005", decisionId);
      }
      if (decision.accepted_by !== null) {
        fail("AUTHORITY.NON_ACCEPTED_HAS_ACCEPTOR", `${basePath}/accepted_by`, "DIST-AUTH-005", decisionId);
      }
    }
    assertUniqueStrings(decision.scope.territories, `${basePath}/scope/territories`);
    assertUniqueStrings(decision.scope.delivery_modes, `${basePath}/scope/delivery_modes`);
    assertUniqueStrings(decision.scope.component_ids, `${basePath}/scope/component_ids`);
    assertUniqueStrings(decision.scope.capability_ids, `${basePath}/scope/capability_ids`);
    assertUniqueStrings(decision.scope.revalidation_triggers, `${basePath}/scope/revalidation_triggers`);
  }
  return new Map([...map].map(([id, item]) => [id, item.value]));
}

function validateGates(packet) {
  const map = indexedBy(packet.external_gates, "gate_id", "/external_gates", "COVERAGE.DUPLICATE_GATE", "DIST-COV-002");
  if (!sameSet([...map.keys()], EXPECTED_GATES)) {
    fail("COVERAGE.GATE_SET", "/external_gates", "DIST-COV-002", [...map.keys()].join(","));
  }
  for (const [gateId, item] of map) {
    const gate = item.value;
    const basePath = `/external_gates/${item.index}`;
    assertClosedObject(gate, ["gate_id", "state", "human_owner", "decision_record_sha256", "scope_record_sha256", "supports_external_distribution"], basePath);
    assertClosedObject(gate.human_owner, ["owner_id", "owner_role"], `${basePath}/human_owner`);
    if (typeof gate.human_owner.owner_role !== "string" || gate.human_owner.owner_role.trim().length === 0) {
      fail("AUTHORITY.MISSING_OWNER_ROLE", `${basePath}/human_owner/owner_role`, "DIST-GATE-001", gateId);
    }
    assertBoolean(gate.supports_external_distribution, `${basePath}/supports_external_distribution`, "DIST-GATE-001");
    if (!["OPEN", "PARTIAL", "CLOSED"].includes(gate.state)) {
      fail("GATE.INVALID_STATE", `${basePath}/state`, "DIST-GATE-001", gate.state);
    }
    if (gate.state !== "CLOSED" && gate.supports_external_distribution) {
      fail("GATE.OPEN_SUPPORT", `${basePath}/supports_external_distribution`, "DIST-GATE-002", gateId);
    }
    if (gate.state === "CLOSED") {
      assertHumanId(gate.human_owner.owner_id, `${basePath}/human_owner/owner_id`, "DIST-GATE-003");
      assertSha256(gate.decision_record_sha256, `${basePath}/decision_record_sha256`, "GATE.DECISION_RECORD_REQUIRED", "DIST-GATE-003");
      assertSha256(gate.scope_record_sha256, `${basePath}/scope_record_sha256`, "GATE.SCOPE_RECORD_REQUIRED", "DIST-GATE-003");
      if (!gate.supports_external_distribution) {
        fail("GATE.CLOSED_WITHOUT_SUPPORT", `${basePath}/supports_external_distribution`, "DIST-GATE-003", gateId);
      }
    }
  }
  return new Map([...map].map(([id, item]) => [id, item.value]));
}

function validateLicenseRecords(packet, decisions) {
  const map = indexedBy(packet.license_records, "record_id", "/license_records", "COVERAGE.DUPLICATE_LICENSE_RECORD", "DIST-LICREC-001");
  if (!sameSet([...map.keys()], [...EXPECTED_LICENSE_RECORDS.keys()])) {
    fail("COVERAGE.LICENSE_RECORD_SET", "/license_records", "DIST-LICREC-001", [...map.keys()].join(","));
  }
  for (const [recordId, expected] of EXPECTED_LICENSE_RECORDS) {
    const { value: record, index } = map.get(recordId);
    const basePath = `/license_records/${index}`;
    assertClosedObject(record, [
      "record_id", "component_id", "subject_id", "record_type", "declared_license_id", "source_locator",
      "immutable_revision", "content_sha256", "evidence_status", "applicability", "human_review", "obligations",
    ], basePath);
    assertClosedObject(record.applicability, ["status", "target_stage", "territories", "legal_entity", "delivery_modes"], `${basePath}/applicability`);
    assertClosedObject(record.human_review, ["status", "decision_id", "owner_id"], `${basePath}/human_review`);
    const actualIdentity = [record.component_id, record.subject_id, record.record_type, record.declared_license_id];
    const expectedIdentity = [expected.component, expected.subject, expected.type, expected.license];
    if (actualIdentity.join("\u0000") !== expectedIdentity.join("\u0000")) {
      fail("LICENSE_RECORD.IDENTITY_DRIFT", basePath, "DIST-LICREC-002", recordId);
    }
    if (record.source_locator !== expected.source) {
      fail("LICENSE_RECORD.SOURCE_DRIFT", `${basePath}/source_locator`, "DIST-LICREC-003", recordId);
    }
    if (!decisions.has(record.human_review.decision_id) || record.human_review.decision_id !== "HUM-LEGAL-DISTRIBUTION") {
      fail("LICENSE_RECORD.INVALID_HUMAN_DECISION", `${basePath}/human_review/decision_id`, "DIST-LICREC-004", recordId);
    }
    if (!["unknown", "reviewed", "not-applicable"].includes(record.applicability.status)) {
      fail("LICENSE_RECORD.INVALID_APPLICABILITY", `${basePath}/applicability/status`, "DIST-LICREC-004", recordId);
    }
    if (!["blocked_external", "accepted", "rejected", "expired"].includes(record.human_review.status)) {
      fail("LICENSE_RECORD.INVALID_REVIEW_STATUS", `${basePath}/human_review/status`, "DIST-LICREC-004", recordId);
    }
    assertUniqueStrings(record.applicability.territories, `${basePath}/applicability/territories`);
    assertUniqueStrings(record.applicability.delivery_modes, `${basePath}/applicability/delivery_modes`);

    const obligations = indexedBy(record.obligations, "obligation_id", `${basePath}/obligations`, "LICENSE_RECORD.DUPLICATE_OBLIGATION", "DIST-LICREC-005");
    if (!sameSet([...obligations.keys()], [...expected.obligations.keys()])) {
      fail("LICENSE_RECORD.OBLIGATION_SET", `${basePath}/obligations`, "DIST-LICREC-005", recordId);
    }
    for (const [obligationId, expectedTuple] of expected.obligations) {
      const obligationItem = obligations.get(obligationId);
      const obligation = obligationItem.value;
      const obligationPath = `${basePath}/obligations/${obligationItem.index}`;
      assertClosedObject(obligation, ["obligation_id", "section", "modality", "condition", "summary"], obligationPath);
      const actualTuple = [obligation.section, obligation.modality, obligation.condition, obligation.summary];
      if (actualTuple.join("\u0000") !== expectedTuple.join("\u0000")) {
        const driftField = obligation.modality !== expectedTuple[1] ? "modality" : "summary";
        const code = driftField === "modality" ? "LICENSE_RECORD.MODALITY_DRIFT" : "LICENSE_RECORD.SUMMARY_DRIFT";
        fail(code, `${obligationPath}/${driftField}`, "DIST-LICREC-006", obligationId);
      }
    }

    const immutableComplete = isImmutableRevision(record.immutable_revision) &&
      SHA256.test(String(record.content_sha256));
    const applicabilityComplete = ["reviewed", "not-applicable"].includes(record.applicability.status) &&
      typeof record.applicability.legal_entity === "string" && record.applicability.legal_entity.length > 0 &&
      record.applicability.territories.length > 0 && record.applicability.delivery_modes.length > 0;
    const legalDecision = decisions.get("HUM-LEGAL-DISTRIBUTION");
    let reviewComplete = record.human_review.status === "accepted" && legalDecision.status === "accepted";
    if (reviewComplete) {
      assertHumanId(record.human_review.owner_id, `${basePath}/human_review/owner_id`, "DIST-LICREC-007");
      const scopeMatches = record.applicability.target_stage === legalDecision.scope.target_stage &&
        record.applicability.legal_entity === legalDecision.scope.legal_entity &&
        legalDecision.scope.component_ids.includes(record.component_id) &&
        record.applicability.territories.every((territory) => legalDecision.scope.territories.includes(territory)) &&
        record.applicability.delivery_modes.every((mode) => legalDecision.scope.delivery_modes.includes(mode));
      if (!scopeMatches) {
        fail("LICENSE_RECORD.HUMAN_SCOPE_MISMATCH", `${basePath}/applicability`, "DIST-LICREC-007", recordId);
      }
      reviewComplete = scopeMatches;
    }
    if (!immutableComplete || !applicabilityComplete || !reviewComplete) {
      if (record.evidence_status !== "blocked_external") {
        fail("LICENSE_RECORD.MISSING_PROOF_NOT_BLOCKED", `${basePath}/evidence_status`, "DIST-LICREC-007", recordId);
      }
    } else if (record.evidence_status !== "proven") {
      fail("LICENSE_RECORD.COMPLETE_NOT_PROVEN", `${basePath}/evidence_status`, "DIST-LICREC-007", recordId);
    }
  }
  return new Map([...map].map(([id, item]) => [id, item.value]));
}

function validateComponentProof(component, basePath, policy, decisions, gates, licenseRecords, disposition) {
  const evidenceStatuses = new Set(policy.evidence_statuses);
  for (const [field, status] of [
    ["source", component.source.status],
    ["artifact", component.artifact.status],
    ["provenance", component.provenance.status],
    ["license", component.license.status],
    ["tests", component.tests.status],
  ]) {
    if (!evidenceStatuses.has(status)) {
      fail("EVIDENCE.INVALID_STATUS", `${basePath}/${field}/status`, "DIST-EVID-001", status);
    }
  }

  if (component.source.status === "proven") {
    if (typeof component.source.locator !== "string" || component.source.locator.length === 0) {
      fail("SOURCE.LOCATOR_REQUIRED", `${basePath}/source/locator`, "DIST-SRC-001", component.component_id);
    }
    if (!isImmutableRevision(component.source.immutable_revision)) {
      fail("SOURCE.MUTABLE_REVISION", `${basePath}/source/immutable_revision`, "DIST-SRC-002", String(component.source.immutable_revision));
    }
    assertSha256(component.source.source_record_sha256, `${basePath}/source/source_record_sha256`, "SOURCE.RECORD_HASH_REQUIRED", "DIST-SRC-003");
  }
  if (component.artifact.status === "proven") {
    if (typeof component.artifact.artifact_name !== "string" || component.artifact.artifact_name.length === 0) {
      fail("ARTIFACT.NAME_REQUIRED", `${basePath}/artifact/artifact_name`, "DIST-ART-001", component.component_id);
    }
    if (!Number.isSafeInteger(component.artifact.length_bytes) || component.artifact.length_bytes <= 0) {
      fail("ARTIFACT.LENGTH_REQUIRED", `${basePath}/artifact/length_bytes`, "DIST-ART-002", component.component_id);
    }
    assertSha256(component.artifact.sha256, `${basePath}/artifact/sha256`, "ARTIFACT.INVALID_SHA256", "DIST-ART-003");
  }
  if (!["blocked", "proven"].includes(component.release_binding.status)) {
    fail("BINDING.INVALID_STATUS", `${basePath}/release_binding/status`, "DIST-BIND-001", component.release_binding.status);
  }
  for (const field of ["release_artifact_sha256", "component_artifact_sha256", "qualified_installer_sha256"]) {
    if (component.release_binding[field] !== null) {
      assertSha256(component.release_binding[field], `${basePath}/release_binding/${field}`, "BINDING.INVALID_SHA256", "DIST-BIND-001");
    }
  }
  if (component.component_id !== "windows-vm-qualification" && component.release_binding.qualified_installer_sha256 !== null) {
    fail("BINDING.UNEXPECTED_QUALIFIED_INSTALLER", `${basePath}/release_binding/qualified_installer_sha256`, "DIST-BIND-002", component.component_id);
  }
  if (component.release_binding.status === "proven") {
    assertSha256(component.release_binding.release_artifact_sha256, `${basePath}/release_binding/release_artifact_sha256`, "BINDING.RELEASE_HASH_REQUIRED", "DIST-BIND-003");
    assertSha256(component.release_binding.component_artifact_sha256, `${basePath}/release_binding/component_artifact_sha256`, "BINDING.COMPONENT_HASH_REQUIRED", "DIST-BIND-003");
    if (component.artifact.status !== "proven" || component.release_binding.component_artifact_sha256 !== component.artifact.sha256) {
      fail("BINDING.COMPONENT_ARTIFACT_MISMATCH", `${basePath}/release_binding/component_artifact_sha256`, "DIST-BIND-003", component.component_id);
    }
    if (component.component_id === "windows-vm-qualification") {
      assertSha256(component.release_binding.qualified_installer_sha256, `${basePath}/release_binding/qualified_installer_sha256`, "BINDING.QUALIFIED_INSTALLER_REQUIRED", "DIST-BIND-004");
      if (component.release_binding.qualified_installer_sha256 !== component.release_binding.release_artifact_sha256) {
        fail("BINDING.VM_INSTALLER_MISMATCH", `${basePath}/release_binding/qualified_installer_sha256`, "DIST-BIND-004", component.component_id);
      }
    }
  }
  if (component.provenance.status === "proven") {
    assertSha256(component.provenance.chain_record_sha256, `${basePath}/provenance/chain_record_sha256`, "PROVENANCE.CHAIN_HASH_REQUIRED", "DIST-PROV-001");
    for (const field of ["creator", "publisher", "packager"]) {
      if (typeof component.provenance[field] !== "string" || component.provenance[field].length === 0) {
        fail("PROVENANCE.PARTY_REQUIRED", `${basePath}/provenance/${field}`, "DIST-PROV-002", field);
      }
    }
  }
  if (!decisions.has(component.license.human_decision_id)) {
    fail("LICENSE.UNKNOWN_DECISION", `${basePath}/license/human_decision_id`, "DIST-LIC-001", component.license.human_decision_id);
  }
  if (component.license.status === "proven") {
    for (const field of ["expression", "license_text_sha256", "notice_sha256"]) {
      if (field === "expression") {
        if (typeof component.license[field] !== "string" || component.license[field].length === 0) {
          fail("LICENSE.EXPRESSION_REQUIRED", `${basePath}/license/${field}`, "DIST-LIC-002", component.component_id);
        }
      } else {
        assertSha256(component.license[field], `${basePath}/license/${field}`, "LICENSE.HASH_REQUIRED", "DIST-LIC-002");
      }
    }
    const legal = decisions.get(component.license.human_decision_id);
    if (legal.kind !== "legal" || legal.status !== "accepted" || !legal.supports_external_distribution) {
      fail("LICENSE.HUMAN_REVIEW_NOT_ACCEPTED", `${basePath}/license/human_decision_id`, "DIST-LIC-003", component.component_id);
    }
  }

  if (!decisions.has(component.signature.human_decision_id)) {
    fail("SIGNATURE.UNKNOWN_DECISION", `${basePath}/signature/human_decision_id`, "DIST-SIG-001", component.signature.human_decision_id);
  }
  if (!["unknown", "blocked", "blocked_external", "proven", "human-waiver"].includes(component.signature.status)) {
    fail("SIGNATURE.INVALID_STATUS", `${basePath}/signature/status`, "DIST-SIG-001", component.signature.status);
  }
  if (component.signature.status === "proven") {
    const expectedSignatureTypes = {
      "upstream-attestation-or-human-waiver": ["upstream-signature", "content-attestation"],
      "authenticode-rfc3161-required": ["authenticode-rfc3161"],
      "certificate-chain-and-custody-attestation-required": ["certificate-chain-custody-attestation"],
      "qa-report-human-attestation-required": ["human-signed-qa-attestation"],
    };
    if (!expectedSignatureTypes[component.signature.requirement]?.includes(component.signature.signature_type)) {
      if (component.signature.requirement === "authenticode-rfc3161-required") {
        fail("SIGNATURE.SHA256_NOT_AUTHENTICODE", `${basePath}/signature/signature_type`, "DIST-SIG-002", component.component_id);
      }
      fail("SIGNATURE.INVALID_PROOF_TYPE", `${basePath}/signature/signature_type`, "DIST-SIG-002", component.component_id);
    }
    for (const field of ["signed_artifact_sha256", "verification_report_sha256", "timestamp_report_sha256"]) {
      assertSha256(component.signature[field], `${basePath}/signature/${field}`, "SIGNATURE.HASH_REQUIRED", "DIST-SIG-003");
    }
    if (typeof component.signature.signer_identity !== "string" || component.signature.signer_identity.length === 0) {
      fail("SIGNATURE.SIGNER_REQUIRED", `${basePath}/signature/signer_identity`, "DIST-SIG-003", component.component_id);
    }
    if (SHA256.test(String(component.artifact.sha256)) && component.signature.signed_artifact_sha256 !== component.artifact.sha256) {
      fail("SIGNATURE.ARTIFACT_MISMATCH", `${basePath}/signature/signed_artifact_sha256`, "DIST-SIG-004", component.component_id);
    }
  }
  if (component.signature.status === "human-waiver") {
    if (typeof component.signature.waiver_rationale !== "string" || component.signature.waiver_rationale.length === 0) {
      fail("SIGNATURE.WAIVER_RATIONALE_REQUIRED", `${basePath}/signature/waiver_rationale`, "DIST-SIG-005", component.component_id);
    }
    const signing = decisions.get(component.signature.human_decision_id);
    if (signing.kind !== "signing" || signing.status !== "accepted") {
      fail("SIGNATURE.WAIVER_NOT_HUMAN_ACCEPTED", `${basePath}/signature/human_decision_id`, "DIST-SIG-005", component.component_id);
    }
    if (component.signature.requirement !== "upstream-attestation-or-human-waiver") {
      fail("SIGNATURE.REQUIRED_PROOF_WAIVER_FORBIDDEN", `${basePath}/signature/status`, "DIST-SIG-006", component.component_id);
    }
  }

  const resultMap = indexedBy(component.tests.results, "test_id", `${basePath}/tests/results`, "TEST.DUPLICATE_RESULT", "DIST-TEST-001");
  for (const [testId, item] of resultMap) {
    const resultPath = `${basePath}/tests/results/${item.index}`;
    assertClosedObject(item.value, ["test_id", "status", "report_sha256", "environment_id", "attempt_count", "pass_count"], resultPath);
    if (!component.tests.required_test_ids.includes(testId)) {
      fail("TEST.UNDECLARED_RESULT", `${resultPath}/test_id`, "DIST-TEST-001", testId);
    }
    const result = item.value;
    if (!["passed", "failed", "blocked"].includes(result.status)) {
      fail("TEST.INVALID_RESULT_STATUS", `${resultPath}/status`, "DIST-TEST-001", result.status);
    }
    assertSha256(result.report_sha256, `${resultPath}/report_sha256`, "TEST.REPORT_HASH_REQUIRED", "DIST-TEST-001");
    if (typeof result.environment_id !== "string" || result.environment_id.length === 0) {
      fail("TEST.ENVIRONMENT_REQUIRED", `${resultPath}/environment_id`, "DIST-TEST-001", testId);
    }
    if (!Number.isSafeInteger(result.attempt_count) || result.attempt_count <= 0 ||
        !Number.isSafeInteger(result.pass_count) || result.pass_count < 0 || result.pass_count > result.attempt_count ||
        (result.status === "passed" && result.pass_count !== result.attempt_count)) {
      fail("TEST.REPEAT_COUNT_INVALID", `${resultPath}/pass_count`, "DIST-TEST-001", testId);
    }
    if (component.component_id === "windows-vm-qualification" && testId === "vm-retained-data-repeatability" && result.attempt_count < 2) {
      fail("TEST.VM_REPEAT_COUNT_REQUIRED", `${resultPath}/attempt_count`, "DIST-TEST-006", testId);
    }
  }
  if (component.tests.status === "proven") {
    if (!sameSet([...resultMap.keys()], component.tests.required_test_ids)) {
      fail("TEST.RESULT_SET", `${basePath}/tests/results`, "DIST-TEST-002", component.component_id);
    }
    for (const item of resultMap.values()) {
      const result = item.value;
      const resultPath = `${basePath}/tests/results/${item.index}`;
      if (result.status !== "passed") fail("TEST.NOT_PASSED", `${resultPath}/status`, "DIST-TEST-003", result.test_id);
      if (!Number.isSafeInteger(result.attempt_count) || result.attempt_count <= 0 || result.pass_count !== result.attempt_count) {
        fail("TEST.REPEAT_COUNT_INVALID", `${resultPath}/pass_count`, "DIST-TEST-004", result.test_id);
      }
    }
  }

  if (!policy.component_claim_statuses.includes(component.claim.status)) {
    fail("CLAIM.INVALID_STATUS", `${basePath}/claim/status`, "DIST-CLAIM-001", component.claim.status);
  }
  assertBoolean(component.claim.supports_external_distribution, `${basePath}/claim/supports_external_distribution`, "DIST-CLAIM-001");
  if (component.claim.supports_external_distribution && !policy.release_supporting_component_claim_statuses.includes(component.claim.status)) {
    fail("CLAIM.NON_SUPPORTING_STATUS", `${basePath}/claim/supports_external_distribution`, "DIST-CLAIM-002", component.claim.status);
  }
  if (disposition === "excluded" && component.claim.supports_external_distribution) {
    fail("CLAIM.EXCLUDED_COMPONENT_SUPPORT", `${basePath}/claim/supports_external_distribution`, "DIST-CLAIM-003", component.component_id);
  }
  if (component.claim.supports_external_distribution) {
    if (component.component_id === "h3-model") {
      for (const recordId of EXPECTED_LICENSE_RECORDS.keys()) {
        if (licenseRecords.get(recordId).evidence_status !== "proven") {
          fail("CLAIM.LICENSE_RECORDS_NOT_PROVEN", "/license_records", "DIST-CLAIM-004", recordId);
        }
      }
    }
    if (component.tests.status !== "proven") fail("CLAIM.TESTS_NOT_PROVEN", `${basePath}/tests/status`, "DIST-CLAIM-004", component.component_id);
    if (component.release_binding.status !== "proven") fail("CLAIM.RELEASE_BINDING_NOT_PROVEN", `${basePath}/release_binding/status`, "DIST-CLAIM-004", component.component_id);
    for (const [field, status] of [["source", component.source.status], ["artifact", component.artifact.status], ["provenance", component.provenance.status], ["license", component.license.status]]) {
      if (status !== "proven") fail("CLAIM.EVIDENCE_NOT_PROVEN", `${basePath}/${field}/status`, "DIST-CLAIM-004", component.component_id);
    }
    if (!["proven", "human-waiver"].includes(component.signature.status)) {
      fail("CLAIM.SIGNATURE_NOT_PROVEN", `${basePath}/signature/status`, "DIST-CLAIM-004", component.component_id);
    }
    assertHumanId(component.human_owner.owner_id, `${basePath}/human_owner/owner_id`, "DIST-CLAIM-005");
    for (const decisionId of component.human_owner.decision_ids) {
      const decision = decisions.get(decisionId);
      if (!decision || decision.status !== "accepted" || !decision.supports_external_distribution) {
        fail("CLAIM.HUMAN_DECISION_NOT_ACCEPTED", `${basePath}/human_owner/decision_ids`, "DIST-CLAIM-005", decisionId);
      }
      if (!decision.scope.component_ids.includes(component.component_id)) {
        fail("CLAIM.HUMAN_DECISION_SCOPE_MISMATCH", `${basePath}/human_owner/decision_ids`, "DIST-CLAIM-005", decisionId);
      }
      if (!component.claim.claim_ids.some((claimId) => decision.scope.capability_ids.includes(claimId))) {
        fail("CLAIM.HUMAN_DECISION_CLAIM_SCOPE_MISMATCH", `${basePath}/human_owner/decision_ids`, "DIST-CLAIM-005", decisionId);
      }
    }
    for (const gateId of component.external_gate_ids) {
      const gate = gates.get(gateId);
      if (!gate || gate.state !== "CLOSED" || !gate.supports_external_distribution) {
        fail("CLAIM.GATE_NOT_CLOSED", `${basePath}/external_gate_ids`, "DIST-CLAIM-006", gateId);
      }
    }
    if (component.blockers.length !== 0) {
      fail("CLAIM.UNRESOLVED_BLOCKERS", `${basePath}/blockers`, "DIST-CLAIM-007", component.component_id);
    }
    if (!isUtcDateTime(component.claim.expires_at)) {
      fail("CLAIM.EXPIRY_REQUIRED", `${basePath}/claim/expires_at`, "DIST-CLAIM-008", component.component_id);
    }
  } else if (component.blockers.length === 0) {
    fail("CLAIM.MISSING_BLOCKER", `${basePath}/blockers`, "DIST-CLAIM-007", component.component_id);
  }
}

function validateComponents(packet, decisions, gates, licenseRecords) {
  const map = indexedBy(packet.components, "component_id", "/components", "COVERAGE.DUPLICATE_COMPONENT", "DIST-COV-001");
  if (!sameSet([...map.keys()], [...EXPECTED_COMPONENTS.keys()])) {
    fail("COVERAGE.COMPONENT_SET", "/components", "DIST-COV-001", [...map.keys()].join(","));
  }
  const dispositions = indexedBy(packet.release_candidate.component_dispositions, "component_id", "/release_candidate/component_dispositions", "RELEASE.DUPLICATE_DISPOSITION", "DIST-REL-001");
  if (!sameSet([...dispositions.keys()], [...EXPECTED_COMPONENTS.keys()])) {
    fail("RELEASE.DISPOSITION_SET", "/release_candidate/component_dispositions", "DIST-REL-001", [...dispositions.keys()].join(","));
  }
  const dispositionMap = new Map();
  for (const [componentId, item] of dispositions) {
    assertClosedObject(item.value, ["component_id", "disposition"], `/release_candidate/component_dispositions/${item.index}`);
    if (!["included", "excluded", "undecided"].includes(item.value.disposition)) {
      fail("RELEASE.INVALID_DISPOSITION", `/release_candidate/component_dispositions/${item.index}/disposition`, "DIST-REL-001", item.value.disposition);
    }
    dispositionMap.set(componentId, item.value.disposition);
  }

  for (const [componentId, expected] of EXPECTED_COMPONENTS) {
    const { value: component, index } = map.get(componentId);
    const basePath = `/components/${index}`;
    assertClosedObject(component, [
      "component_id", "category", "applicability", "external_gate_ids", "required_evidence", "source", "artifact", "release_binding",
      "provenance", "license", "signature", "tests", "claim", "human_owner", "blockers",
    ], basePath);
    assertClosedObject(component.source, ["status", "locator", "immutable_revision", "source_record_sha256"], `${basePath}/source`);
    assertClosedObject(component.artifact, ["status", "artifact_name", "length_bytes", "sha256"], `${basePath}/artifact`);
    assertClosedObject(component.release_binding, ["status", "release_artifact_sha256", "component_artifact_sha256", "qualified_installer_sha256"], `${basePath}/release_binding`);
    assertClosedObject(component.provenance, ["status", "chain_record_sha256", "creator", "publisher", "packager"], `${basePath}/provenance`);
    assertClosedObject(component.license, ["status", "expression", "license_text_sha256", "notice_sha256", "human_decision_id"], `${basePath}/license`);
    assertClosedObject(component.signature, ["requirement", "status", "signature_type", "signed_artifact_sha256", "signer_identity", "verification_report_sha256", "timestamp_report_sha256", "waiver_rationale", "human_decision_id"], `${basePath}/signature`);
    assertClosedObject(component.tests, ["status", "required_test_ids", "results"], `${basePath}/tests`);
    assertClosedObject(component.claim, ["status", "claim_ids", "supports_external_distribution", "expires_at", "limitations"], `${basePath}/claim`);
    assertClosedObject(component.human_owner, ["owner_id", "owner_role", "decision_ids"], `${basePath}/human_owner`);
    if (component.category !== expected.category || component.applicability !== expected.applicability) {
      fail("COMPONENT.IDENTITY_DRIFT", basePath, "DIST-COMP-001", componentId);
    }
    assertUniqueStrings(component.external_gate_ids, `${basePath}/external_gate_ids`);
    if (!sameSet(component.external_gate_ids, expected.gates)) {
      fail("COMPONENT.GATE_SET", `${basePath}/external_gate_ids`, "DIST-COMP-002", componentId);
    }
    if (component.signature.requirement !== expected.signature) {
      fail("COMPONENT.SIGNATURE_REQUIREMENT_DRIFT", `${basePath}/signature/requirement`, "DIST-COMP-003", componentId);
    }
    assertUniqueStrings(component.required_evidence, `${basePath}/required_evidence`);
    const expectedEvidence = [...COMMON_EVIDENCE, ...expected.evidence];
    if (!sameSet(component.required_evidence, expectedEvidence)) {
      fail("COMPONENT.REQUIRED_EVIDENCE_SET", `${basePath}/required_evidence`, "DIST-COMP-004", componentId);
    }
    assertUniqueStrings(component.tests.required_test_ids, `${basePath}/tests/required_test_ids`);
    if (!sameSet(component.tests.required_test_ids, expected.tests)) {
      fail("TEST.REQUIRED_SET", `${basePath}/tests/required_test_ids`, "DIST-TEST-005", componentId);
    }
    assertUniqueStrings(component.claim.claim_ids, `${basePath}/claim/claim_ids`);
    if (!sameSet(component.claim.claim_ids, expected.claims)) {
      fail("COMPONENT.CLAIM_SET", `${basePath}/claim/claim_ids`, "DIST-COMP-005", componentId);
    }
    assertUniqueStrings(component.claim.limitations, `${basePath}/claim/limitations`);
    assertUniqueStrings(component.human_owner.decision_ids, `${basePath}/human_owner/decision_ids`);
    if (!sameSet(component.human_owner.decision_ids, expected.decisions)) {
      fail("COMPONENT.DECISION_SET", `${basePath}/human_owner/decision_ids`, "DIST-COMP-006", componentId);
    }
    assertUniqueStrings(component.blockers, `${basePath}/blockers`);
    if (typeof component.human_owner.owner_role !== "string" || component.human_owner.owner_role.trim().length === 0) {
      fail("AUTHORITY.MISSING_OWNER_ROLE", `${basePath}/human_owner/owner_role`, "DIST-AUTH-006", componentId);
    }
    if (component.human_owner.owner_id !== null && AGENT_IDENTITY.test(String(component.human_owner.owner_id))) {
      fail("AUTHORITY.AGENT_AS_HUMAN_OWNER", `${basePath}/human_owner/owner_id`, "DIST-AUTH-006", componentId);
    }
    for (const decisionId of component.human_owner.decision_ids) {
      if (!decisions.has(decisionId)) {
        fail("AUTHORITY.UNKNOWN_DECISION", `${basePath}/human_owner/decision_ids`, "DIST-AUTH-007", decisionId);
      }
    }
    if (component.license.human_decision_id !== "HUM-LEGAL-DISTRIBUTION") {
      fail("LICENSE.INVALID_DECISION_KIND", `${basePath}/license/human_decision_id`, "DIST-LIC-001", componentId);
    }
    if (component.signature.human_decision_id !== "HUM-SIGNING") {
      fail("SIGNATURE.INVALID_DECISION_KIND", `${basePath}/signature/human_decision_id`, "DIST-SIG-001", componentId);
    }
    if (component.applicability === "required" && dispositionMap.get(componentId) !== "included") {
      fail("RELEASE.REQUIRED_COMPONENT_EXCLUDED", "/release_candidate/component_dispositions", "DIST-REL-002", componentId);
    }
    validateComponentProof(component, basePath, packet.authority_policy, decisions, gates, licenseRecords, dispositionMap.get(componentId));
  }
  return {
    componentMap: new Map([...map].map(([id, item]) => [id, item.value])),
    dispositionMap,
  };
}

function validatePublicClaims(packet, componentMap, decisions, gates) {
  const map = indexedBy(packet.public_claims, "claim_id", "/public_claims", "COVERAGE.DUPLICATE_PUBLIC_CLAIM", "DIST-CLAIM-010");
  if (!sameSet([...map.keys()], [...EXPECTED_PUBLIC_CLAIMS.keys()])) {
    fail("COVERAGE.PUBLIC_CLAIM_SET", "/public_claims", "DIST-CLAIM-010", [...map.keys()].join(","));
  }
  for (const [claimId, item] of map) {
    const claim = item.value;
    const expected = EXPECTED_PUBLIC_CLAIMS.get(claimId);
    const basePath = `/public_claims/${item.index}`;
    assertClosedObject(claim, ["claim_id", "status", "required_component_ids", "required_gate_ids", "required_decision_ids", "expires_at", "limitations", "supports_external_distribution"], basePath);
    assertUniqueStrings(claim.required_component_ids, `${basePath}/required_component_ids`);
    assertUniqueStrings(claim.required_gate_ids, `${basePath}/required_gate_ids`);
    assertUniqueStrings(claim.required_decision_ids, `${basePath}/required_decision_ids`);
    assertUniqueStrings(claim.limitations, `${basePath}/limitations`);
    assertBoolean(claim.supports_external_distribution, `${basePath}/supports_external_distribution`, "DIST-CLAIM-011");
    if (!sameSet(claim.required_component_ids, expected.components) ||
        !sameSet(claim.required_gate_ids, expected.gates) ||
        !sameSet(claim.required_decision_ids, expected.decisions)) {
      fail("PUBLIC_CLAIM.REQUIREMENT_SET", basePath, "DIST-CLAIM-011", claimId);
    }
    if (!packet.authority_policy.public_claim_statuses.includes(claim.status)) {
      fail("PUBLIC_CLAIM.INVALID_STATUS", `${basePath}/status`, "DIST-CLAIM-011", claim.status);
    }
    for (const componentId of claim.required_component_ids) {
      if (!componentMap.has(componentId)) fail("PUBLIC_CLAIM.UNKNOWN_COMPONENT", `${basePath}/required_component_ids`, "DIST-CLAIM-011", componentId);
      if (!componentMap.get(componentId).claim.claim_ids.includes(claimId)) {
        fail("PUBLIC_CLAIM.COMPONENT_MAPPING_MISMATCH", `${basePath}/required_component_ids`, "DIST-CLAIM-011", componentId);
      }
    }
    for (const gateId of claim.required_gate_ids) {
      if (!gates.has(gateId)) fail("PUBLIC_CLAIM.UNKNOWN_GATE", `${basePath}/required_gate_ids`, "DIST-CLAIM-011", gateId);
    }
    for (const decisionId of claim.required_decision_ids) {
      if (!decisions.has(decisionId)) fail("PUBLIC_CLAIM.UNKNOWN_DECISION", `${basePath}/required_decision_ids`, "DIST-CLAIM-011", decisionId);
    }
    if (claim.supports_external_distribution && !packet.authority_policy.release_supporting_public_claim_statuses.includes(claim.status)) {
      fail("PUBLIC_CLAIM.NON_SUPPORTING_STATUS", `${basePath}/supports_external_distribution`, "DIST-CLAIM-012", `${claimId}:${claim.status}`);
    }
    if (claim.status === "certified" && !claim.supports_external_distribution) {
      fail("PUBLIC_CLAIM.CERTIFIED_WITHOUT_SUPPORT", `${basePath}/supports_external_distribution`, "DIST-CLAIM-012", claimId);
    }
    if (claim.supports_external_distribution) {
      if (!isUtcDateTime(claim.expires_at)) {
        fail("PUBLIC_CLAIM.EXPIRY_REQUIRED", `${basePath}/expires_at`, "DIST-CLAIM-013", claimId);
      }
      for (const componentId of claim.required_component_ids) {
        if (!componentMap.get(componentId).claim.supports_external_distribution) {
          fail("PUBLIC_CLAIM.COMPONENT_NOT_SUPPORTING", `${basePath}/required_component_ids`, "DIST-CLAIM-013", componentId);
        }
      }
      for (const gateId of claim.required_gate_ids) {
        const gate = gates.get(gateId);
        if (gate.state !== "CLOSED" || !gate.supports_external_distribution) {
          fail("PUBLIC_CLAIM.GATE_NOT_CLOSED", `${basePath}/required_gate_ids`, "DIST-CLAIM-013", gateId);
        }
      }
      for (const decisionId of claim.required_decision_ids) {
        const decision = decisions.get(decisionId);
        if (decision.status !== "accepted" || !decision.supports_external_distribution) {
          fail("PUBLIC_CLAIM.DECISION_NOT_ACCEPTED", `${basePath}/required_decision_ids`, "DIST-CLAIM-013", decisionId);
        }
        if (!decision.scope.capability_ids.includes(claimId)) {
          fail("PUBLIC_CLAIM.DECISION_SCOPE_MISMATCH", `${basePath}/required_decision_ids`, "DIST-CLAIM-013", decisionId);
        }
      }
    }
  }
  return new Map([...map].map(([id, item]) => [id, item.value]));
}

function validateReleaseCandidate(packet, componentMap, dispositionMap, decisions, publicClaims) {
  const release = packet.release_candidate;
  const basePath = "/release_candidate";
  assertClosedObject(release, [
    "target_stage", "status", "release_artifact_sha256", "legal_entity", "territories", "delivery_modes",
    "component_dispositions", "human_release_decision_id", "supports_external_distribution",
  ], basePath);
  assertBoolean(release.supports_external_distribution, `${basePath}/supports_external_distribution`, "DIST-REL-003");
  if (!["blocked", "candidate", "approved"].includes(release.status)) {
    fail("RELEASE.INVALID_STATUS", `${basePath}/status`, "DIST-REL-003", release.status);
  }
  assertUniqueStrings(release.territories, `${basePath}/territories`);
  assertUniqueStrings(release.delivery_modes, `${basePath}/delivery_modes`);
  if (release.delivery_modes.length === 0) {
    fail("RELEASE.DELIVERY_MODE_REQUIRED", `${basePath}/delivery_modes`, "DIST-REL-003", release.status);
  }
  if (release.status === "approved" && !release.supports_external_distribution) {
    fail("RELEASE.APPROVED_WITHOUT_SUPPORT", `${basePath}/supports_external_distribution`, "DIST-REL-004", release.status);
  }
  if (!decisions.has(release.human_release_decision_id) || decisions.get(release.human_release_decision_id).kind !== "release") {
    fail("RELEASE.INVALID_HUMAN_DECISION", `${basePath}/human_release_decision_id`, "DIST-REL-005", release.human_release_decision_id);
  }
  for (const [componentId, disposition] of dispositionMap) {
    if (disposition === "excluded" && componentMap.get(componentId).claim.supports_external_distribution) {
      fail("RELEASE.EXCLUDED_COMPONENT_SUPPORT", `${basePath}/component_dispositions`, "DIST-REL-006", componentId);
    }
  }
  const installer = componentMap.get("windows-installer");
  const vmQualification = componentMap.get("windows-vm-qualification");
  if (release.release_artifact_sha256 !== null && installer.artifact.sha256 !== null &&
      release.release_artifact_sha256 !== installer.artifact.sha256) {
    fail("RELEASE.INSTALLER_ARTIFACT_MISMATCH", `${basePath}/release_artifact_sha256`, "DIST-REL-006", "windows-installer");
  }
  if (vmQualification.release_binding.qualified_installer_sha256 !== null && release.release_artifact_sha256 !== null &&
      vmQualification.release_binding.qualified_installer_sha256 !== release.release_artifact_sha256) {
    fail("RELEASE.VM_QUALIFICATION_MISMATCH", "/components", "DIST-REL-006", "windows-vm-qualification");
  }
  if (!release.supports_external_distribution) return;

  if (release.status !== "approved") {
    fail("RELEASE.SUPPORT_WITHOUT_APPROVAL", `${basePath}/status`, "DIST-REL-007", release.status);
  }
  assertSha256(release.release_artifact_sha256, `${basePath}/release_artifact_sha256`, "RELEASE.ARTIFACT_HASH_REQUIRED", "DIST-REL-007");
  if (typeof release.legal_entity !== "string" || release.legal_entity.length === 0 || release.territories.length === 0) {
    fail("RELEASE.SCOPE_REQUIRED", basePath, "DIST-REL-007", "entity and territories required");
  }
  for (const [componentId, disposition] of dispositionMap) {
    if (disposition === "undecided") {
      fail("RELEASE.UNDECIDED_COMPONENT", `${basePath}/component_dispositions`, "DIST-REL-008", componentId);
    }
    if (disposition === "included" && !componentMap.get(componentId).claim.supports_external_distribution) {
      fail("RELEASE.COMPONENT_NOT_SUPPORTING", `${basePath}/component_dispositions`, "DIST-REL-008", componentId);
    }
    if (disposition === "included" && componentMap.get(componentId).release_binding.release_artifact_sha256 !== release.release_artifact_sha256) {
      fail("RELEASE.COMPONENT_BINDING_MISMATCH", `${basePath}/component_dispositions`, "DIST-REL-008", componentId);
    }
  }
  for (const decisionId of ["HUM-LEGAL-DISTRIBUTION", "HUM-CERTIFICATE", "HUM-SIGNING", "HUM-RELEASE"]) {
    const decision = decisions.get(decisionId);
    if (decision.status !== "accepted" || !decision.supports_external_distribution) {
      fail("RELEASE.HUMAN_DECISION_NOT_ACCEPTED", `${basePath}/human_release_decision_id`, "DIST-REL-009", decisionId);
    }
    if (decision.scope.target_stage !== release.target_stage ||
        decision.scope.release_artifact_sha256 !== release.release_artifact_sha256 ||
        decision.scope.legal_entity !== release.legal_entity ||
        !sameSet(decision.scope.territories, release.territories) ||
        !sameSet(decision.scope.delivery_modes, release.delivery_modes)) {
      fail("RELEASE.HUMAN_DECISION_SCOPE_MISMATCH", `${basePath}/human_release_decision_id`, "DIST-REL-009", decisionId);
    }
  }
  const publicInstaller = publicClaims.get("CAP-PUBLIC-INSTALLER");
  if (!publicInstaller.supports_external_distribution || publicInstaller.status !== "certified") {
    fail("RELEASE.PUBLIC_INSTALLER_NOT_CERTIFIED", "/public_claims", "DIST-REL-010", "CAP-PUBLIC-INSTALLER");
  }
  const releaseDecision = decisions.get("HUM-RELEASE");
  const includedComponentIds = [...dispositionMap].filter(([, disposition]) => disposition === "included").map(([componentId]) => componentId);
  const supportingClaimIds = [...publicClaims].filter(([, claim]) => claim.supports_external_distribution).map(([claimId]) => claimId);
  if (!sameSet(releaseDecision.scope.component_ids, includedComponentIds) ||
      !sameSet(releaseDecision.scope.capability_ids, supportingClaimIds)) {
    fail("RELEASE.DECISION_SCOPE_MISMATCH", `${basePath}/human_release_decision_id`, "DIST-REL-011", "HUM-RELEASE");
  }
  if (publicClaims.get("CAP-SOFTWARE-BRANDING").supports_external_distribution) {
    const brand = decisions.get("HUM-BRAND");
    if (brand.status !== "accepted" || !brand.supports_external_distribution) {
      fail("RELEASE.BRAND_DECISION_NOT_ACCEPTED", "/public_claims", "DIST-REL-012", "HUM-BRAND");
    }
  }
}

function validatePacket(packet) {
  assertClosedObject(packet, ROOT_KEYS, "");
  if (canonicalStringify(packet).includes("CAP-BRAND-WATERMARK")) {
    fail("BRAND.LEGACY_MEDIA_CAPABILITY", "/brand_boundary", "DIST-BRAND-003", "CAP-BRAND-WATERMARK");
  }
  if (packet.format_version !== "1.0.0" || packet.task_id !== "P0-GOV-008" ||
      packet.packet_purpose !== "synthetic-checklist-contract-only-no-distribution-approval") {
    fail("PACKET.IDENTITY_DRIFT", "", "DIST-PACKET-001", packet.packet_id);
  }
  validateAuthorityPolicy(packet.authority_policy);
  validateBrandBoundary(packet.brand_boundary);
  const decisions = validateDecisions(packet);
  const gates = validateGates(packet);
  const licenseRecords = validateLicenseRecords(packet, decisions);
  const { componentMap, dispositionMap } = validateComponents(packet, decisions, gates, licenseRecords);
  const publicClaims = validatePublicClaims(packet, componentMap, decisions, gates);
  validateReleaseCandidate(packet, componentMap, dispositionMap, decisions, publicClaims);
  return {
    components: componentMap.size,
    gates: gates.size,
    decisions: decisions.size,
    licenseRecords: licenseRecords.size,
    publicClaims: publicClaims.size,
    release: packet.release_candidate.supports_external_distribution,
  };
}

function decodePointer(pointer) {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) throw new Error(`Invalid JSON pointer: ${pointer}`);
  return pointer.slice(1).split("/").map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
}

function getPointer(document, pointer) {
  let current = document;
  for (const part of decodePointer(pointer)) {
    if (current === null || typeof current !== "object" || !Object.hasOwn(current, part)) {
      throw new Error(`Missing mutation source: ${pointer}`);
    }
    current = current[part];
  }
  return current;
}

function getParent(document, pointer) {
  const parts = decodePointer(pointer);
  if (parts.length === 0) throw new Error("Root mutation is forbidden");
  const key = parts.pop();
  let parent = document;
  for (const part of parts) {
    if (parent === null || typeof parent !== "object" || !Object.hasOwn(parent, part)) {
      throw new Error(`Missing mutation parent: ${pointer}`);
    }
    parent = parent[part];
  }
  return { parent, key };
}

function applyMutation(document, mutation) {
  assertClosedObject(mutation, mutation.op === "copy" ? ["op", "from", "path"] : ["op", "path", "value"], "/mutation");
  if (!["add", "remove", "replace", "copy"].includes(mutation.op)) throw new Error(`Unsupported mutation op: ${mutation.op}`);
  const value = mutation.op === "copy" ? clone(getPointer(document, mutation.from)) : clone(mutation.value);
  const { parent, key } = getParent(document, mutation.path);
  if (Array.isArray(parent)) {
    if (mutation.op === "add" || mutation.op === "copy") {
      if (key === "-") parent.push(value);
      else parent.splice(Number(key), 0, value);
    } else if (mutation.op === "remove") {
      parent.splice(Number(key), 1);
    } else {
      parent[Number(key)] = value;
    }
    return;
  }
  if (mutation.op === "remove") {
    if (!Object.hasOwn(parent, key)) throw new Error(`Missing mutation target: ${mutation.path}`);
    delete parent[key];
  } else {
    if (mutation.op === "replace" && !Object.hasOwn(parent, key)) throw new Error(`Missing mutation target: ${mutation.path}`);
    parent[key] = value;
  }
}

function validateDocumentation(text) {
  if (text.includes("CAP-BRAND-WATERMARK")) {
    fail("BRAND.LEGACY_MEDIA_CAPABILITY", "/documentation", "DIST-BRAND-003", "CAP-BRAND-WATERMARK");
  }
  const requiredLiterals = [
    "I only implement installation, detection, configuration, workflow compilation, deterministic orchestration, or technical verification. MiniMax H3 generates the actual video and audio inside ComfyUI.",
    "node tests/fixtures/governance/distribution-evidence/validate.mjs",
    "minimax-h3-community-license-agreement",
    "minimax-h3-license-notice-obligations",
    "minimax-h3-ai-generation-identification",
    "qwen3-vl-32b-instruct-apache-2.0",
    "III.3(b)",
    "encouraged",
    "Exhibit A.12",
    "blocked_external",
    "CAP-SOFTWARE-BRANDING",
    "software_brand_only",
    "media_branding_authority",
  ];
  for (const literal of requiredLiterals) {
    if (!text.includes(literal)) {
      fail("DOCUMENTATION.MISSING_LITERAL", "/documentation", "DIST-DOC-001", literal);
    }
  }
  for (const componentId of EXPECTED_COMPONENTS.keys()) {
    if (!text.includes(`\`${componentId}\``)) {
      fail("DOCUMENTATION.MISSING_COMPONENT", "/documentation", "DIST-DOC-002", componentId);
    }
  }
}

const [indexText, documentationText] = await Promise.all([
  readFile(indexPath, "utf8"),
  readFile(documentationPath, "utf8"),
]);
if (indexText.charCodeAt(0) === 0xfeff) fail("JSON.BOM_FORBIDDEN", "", "DIST-JSON-001", "index.valid.json");
const validPacket = JSON.parse(indexText);
const summary = validatePacket(validPacket);
validateDocumentation(documentationText);

const hostileFiles = (await readdir(hostileDirectory)).filter((name) => name.endsWith(".json")).sort();
if (!sameSet(hostileFiles, EXPECTED_HOSTILE_FILES)) {
  fail("HOSTILE.CORPUS_SET", "/hostile", "DIST-HOSTILE-001", hostileFiles.join(","));
}
let hostilePassed = 0;
const hostileCaseIds = new Set();
for (const hostileFile of hostileFiles) {
  const fixtureText = await readFile(path.join(hostileDirectory, hostileFile), "utf8");
  const fixture = JSON.parse(fixtureText);
  assertClosedObject(fixture, ["fixture_case_version", "case_id", "base", "mutations", "expected"], "/fixture");
  assertClosedObject(fixture.expected, ["code", "instance_path", "rule_id"], "/fixture/expected");
  if (fixture.fixture_case_version !== "1.0.0" || fixture.base !== "../index.valid.json") {
    throw new Error(`${hostileFile}: invalid fixture envelope`);
  }
  assertArray(fixture.mutations, "/fixture/mutations");
  const expectedCaseId = hostileFile.slice(0, -".json".length);
  if (fixture.case_id !== expectedCaseId || hostileCaseIds.has(fixture.case_id) || fixture.mutations.length === 0) {
    fail("HOSTILE.INVALID_CASE_ID", "/fixture/case_id", "DIST-HOSTILE-002", `${hostileFile}:${fixture.case_id}`);
  }
  hostileCaseIds.add(fixture.case_id);
  const hostilePacket = clone(validPacket);
  for (const mutation of fixture.mutations) applyMutation(hostilePacket, mutation);
  let observed = null;
  try {
    validatePacket(hostilePacket);
  } catch (error) {
    if (!(error instanceof DistributionEvidenceError)) throw error;
    observed = { code: error.code, instance_path: error.instancePath, rule_id: error.ruleId };
  }
  const expectedText = JSON.stringify(fixture.expected);
  const observedText = JSON.stringify(observed);
  if (expectedText !== observedText) {
    throw new Error(`${fixture.case_id}: expected ${expectedText}, observed ${observedText}`);
  }
  hostilePassed += 1;
}

console.log(
  `DISTRIBUTION_EVIDENCE_VALIDATION_OK valid=1 hostile=${hostilePassed} components=${summary.components} license_records=${summary.licenseRecords} gates=${summary.gates} decisions=${summary.decisions} public_claims=${summary.publicClaims} release=${summary.release} index_sha256=${digest(indexText)}`,
);
