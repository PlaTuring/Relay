import {
  canonicalBytes,
  canonicalJson,
  contentSha256,
  parseCanonicalJson,
  sha256Jcs
} from "./canonical-json.mjs";
import { DownloadSidecarError, fail, toPublicError } from "./errors.mjs";

export { DownloadSidecarError, toPublicError };

export const SIDECAR_CONTRACT_ID = "minimax-h3-tool.download-partial-sidecar";
export const SIDECAR_SCHEMA_VERSION = "1.0.0";
export const MAX_ARTIFACT_BYTES = 8 * 1024 ** 4;

const MAX_RETRY_GENERATION = 1_000_000;
const MAX_PID = 4_294_967_295;
const MAX_PROCESS_START_UTC_TICKS = 3_155_378_975_999_999_999n;
const HASH_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const BARE_HASH_PATTERN = /^[0-9a-f]{64}$/u;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HEX_32_PATTERN = /^[0-9a-f]{32}$/u;
const GIT_REVISION_PATTERN = /^[0-9a-f]{40}$/u;
const DOMAIN_ID_PATTERN = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/u;
const COMPONENT_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/u;
const PROCESS_TICKS_PATTERN = /^[1-9][0-9]{0,18}$/u;
const MUTABLE_REFERENCE_SEGMENTS = new Set([
  "branch",
  "branches",
  "current",
  "head",
  "heads",
  "latest",
  "main",
  "master",
  "refs"
]);
const MUTABLE_REFERENCE_PATTERN = /^(?:latest|main|master|head|current|branch)(?:[._-].*)?$/iu;

const AUTHORITY = Object.freeze({
  deletion_authority: "none",
  download_authority: "none",
  execution_authority: "none",
  materialization_authority: "none",
  network_authority: "none",
  ownership_authority: "none",
  queue_authority: "none",
  verification_authority: "none"
});

const ROOT_KEYS = Object.freeze([
  "authority",
  "component_manifest",
  "contract_id",
  "document_id",
  "document_revision",
  "integrity",
  "lease",
  "partial",
  "retry_generation",
  "schema_version",
  "source",
  "state"
]);

const MANIFEST_KEYS = Object.freeze([
  "artifact_byte_length",
  "artifact_sha256",
  "component_id",
  "component_version",
  "content_sha256",
  "contract_id",
  "document_id",
  "document_revision",
  "schema_version",
  "source_locator",
  "source_revision"
]);

const SOURCE_KEYS = Object.freeze([
  "expected_artifact_sha256",
  "expected_byte_length",
  "locator",
  "revision",
  "strong_etag"
]);

const OWNER_KEYS = Object.freeze([
  "owner_pid",
  "owner_process_start_utc_ticks",
  "owner_token"
]);

const LEASE_KEYS = Object.freeze([
  "lease_id",
  "mode",
  "owner",
  "resource_key",
  "resource_type"
]);

const ACTIVE_LEASE_KEYS = Object.freeze(["active", ...LEASE_KEYS]);
const PARTIAL_KEYS = Object.freeze(["identity", "received_range", "relative_path"]);
const EMPTY_RANGE_KEYS = Object.freeze(["byte_length", "kind"]);
const INCLUSIVE_RANGE_KEYS = Object.freeze([
  "byte_length",
  "end_inclusive",
  "kind",
  "start_inclusive"
]);
const INTEGRITY_KEYS = Object.freeze(["content_sha256", "profile"]);
const AUTHORITY_KEYS = Object.freeze(Object.keys(AUTHORITY).sort());
const STATES = new Set(["prepared", "receiving_bytes", "expected_bytes_received"]);
const RECOVERY_PRIORS = new WeakSet();

function pointerEscape(value) {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertObject(value, path, ruleId = "sidecar.object.required") {
  if (!isObject(value)) fail("SIDECAR.INVALID_TYPE", path, ruleId);
}

function assertClosed(value, requiredKeys, path, rulePrefix) {
  assertObject(value, path, `${rulePrefix}.object`);
  const expected = new Set(requiredKeys);
  const unknown = Object.keys(value)
    .filter((key) => !expected.has(key))
    .sort(compareUtf8);
  if (unknown.length > 0) {
    fail(
      "SIDECAR.UNKNOWN_FIELD",
      `${path}/${pointerEscape(unknown[0])}`,
      `${rulePrefix}.closed`
    );
  }
  for (const key of requiredKeys) {
    if (!Object.hasOwn(value, key)) {
      fail(
        "SIDECAR.MISSING_FIELD",
        `${path}/${pointerEscape(key)}`,
        `${rulePrefix}.required`
      );
    }
  }
}

function assertExact(value, expected, path, ruleId) {
  if (value !== expected) fail("SIDECAR.INVALID_VALUE", path, ruleId);
}

function assertPattern(value, pattern, path, ruleId, { maxBytes } = {}) {
  if (typeof value !== "string" || !pattern.test(value)) {
    fail("SIDECAR.INVALID_VALUE", path, ruleId);
  }
  if (maxBytes !== undefined && Buffer.byteLength(value, "utf8") > maxBytes) {
    fail("SIDECAR.VALUE_TOO_LARGE", path, `${ruleId}.size`);
  }
}

function assertSafeInteger(value, minimum, maximum, path, ruleId) {
  if (
    !Number.isSafeInteger(value) ||
    Object.is(value, -0) ||
    value < minimum ||
    value > maximum
  ) {
    fail("SIDECAR.INVALID_NUMBER", path, ruleId);
  }
}

function assertHash(value, path, ruleId) {
  assertPattern(value, HASH_PATTERN, path, ruleId);
}

function assertUuid(value, path, ruleId) {
  assertPattern(value, UUID_V4_PATTERN, path, ruleId);
}

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function assertAuthority(authority) {
  const path = "/authority";
  assertClosed(authority, AUTHORITY_KEYS, path, "sidecar.authority");
  for (const key of AUTHORITY_KEYS) {
    assertExact(authority[key], AUTHORITY[key], `${path}/${key}`, `sidecar.authority.${key}.none`);
  }
}

function assertImmutableHttpsLocator(locator, revision, path) {
  if (typeof locator !== "string" || locator.length < 16 || locator.length > 2048) {
    fail("SIDECAR.UNSAFE_SOURCE_URL", path, "sidecar.source.url.length");
  }
  if (!locator.startsWith("https://")) {
    fail("SIDECAR.UNSAFE_SOURCE_URL", path, "sidecar.source.url.https_only");
  }
  if (/[%\\?#\u0000-\u0020\u007f]/u.test(locator)) {
    fail("SIDECAR.UNSAFE_SOURCE_URL", path, "sidecar.source.url.raw_hazards_forbidden");
  }
  const remainder = locator.slice("https://".length);
  const firstSlash = remainder.indexOf("/");
  if (firstSlash <= 0) {
    fail("SIDECAR.UNSAFE_SOURCE_URL", path, "sidecar.source.url.authority_and_path_required");
  }
  const authority = remainder.slice(0, firstSlash);
  const rawPath = remainder.slice(firstSlash);
  if (authority.includes("@") || authority.includes("[") || authority.includes("]")) {
    fail("SIDECAR.UNSAFE_SOURCE_URL", path, "sidecar.source.url.credentials_or_ip_literal");
  }
  const authorityMatch = /^([a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?)(?::([0-9]{1,5}))?$/u.exec(
    authority
  );
  if (!authorityMatch) {
    fail("SIDECAR.UNSAFE_SOURCE_URL", path, "sidecar.source.url.host_lexical");
  }
  const host = authorityMatch[1];
  if (
    host.length > 253 ||
    host.includes("..") ||
    host.split(".").some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label))
  ) {
    fail("SIDECAR.UNSAFE_SOURCE_URL", path, "sidecar.source.url.host_lexical");
  }
  if (authorityMatch[2] !== undefined && authorityMatch[2] !== "443") {
    fail("SIDECAR.UNSAFE_SOURCE_URL", path, "sidecar.source.url.https_port_only");
  }
  if (!/^\/[A-Za-z0-9._~/-]+$/u.test(rawPath) || rawPath.endsWith("/") || rawPath.includes("//")) {
    fail("SIDECAR.UNSAFE_SOURCE_URL", path, "sidecar.source.url.path_lexical");
  }
  const segments = rawPath.slice(1).split("/");
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === "." ||
        segment === ".." ||
        Buffer.byteLength(segment, "utf8") > 255
    )
  ) {
    fail("SIDECAR.UNSAFE_SOURCE_URL", path, "sidecar.source.url.path_segments");
  }
  if (
    segments.some(
      (segment) =>
        MUTABLE_REFERENCE_SEGMENTS.has(segment.toLowerCase()) ||
        MUTABLE_REFERENCE_PATTERN.test(segment)
    )
  ) {
    fail("SIDECAR.MUTABLE_SOURCE_REF", path, "sidecar.source.url.mutable_ref_forbidden");
  }
  const revisionSegments = segments.filter((segment) => GIT_REVISION_PATTERN.test(segment));
  if (revisionSegments.length !== 1 || revisionSegments[0] !== revision) {
    fail("SIDECAR.REVISION_BINDING_INVALID", path, "sidecar.source.url.exact_revision_segment");
  }
}

function assertStrongEtag(value, path) {
  if (
    typeof value !== "string" ||
    value.startsWith("W/") ||
    value.includes(",") ||
    !/^"[\x21\x23-\x2b\x2d-\x7e]{1,256}"$/u.test(value)
  ) {
    fail("SIDECAR.INVALID_ETAG", path, "sidecar.source.etag.strong_single_quoted");
  }
}

function assertRelativePartialPath(value, expectedArtifactHash, path) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > 4096 ||
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.includes("\\") ||
    value.includes(":") ||
    value.includes("%") ||
    /[\u0000-\u001f\u007f<>"|?*]/u.test(value)
  ) {
    fail("SIDECAR.UNSAFE_RELATIVE_PATH", path, "sidecar.partial.path.lexical_safety");
  }
  const segments = value.split("/");
  for (const segment of segments) {
    if (
      segment.length === 0 ||
      segment === "." ||
      segment === ".." ||
      segment.endsWith(".") ||
      segment.endsWith(" ") ||
      Buffer.byteLength(segment, "utf8") > 255
    ) {
      fail("SIDECAR.UNSAFE_RELATIVE_PATH", path, "sidecar.partial.path.segment_safety");
    }
    const deviceStem = segment.split(".")[0].replace(/[ .]+$/u, "").toUpperCase();
    if (
      /^(?:CON|PRN|AUX|NUL|CLOCK\$|COM[1-9¹²³]|LPT[1-9¹²³])$/u.test(deviceStem)
    ) {
      fail("SIDECAR.UNSAFE_RELATIVE_PATH", path, "sidecar.partial.path.device_name_forbidden");
    }
  }
  if (!segments.at(-1).endsWith(".partial")) {
    fail("SIDECAR.UNSAFE_RELATIVE_PATH", path, "sidecar.partial.path.partial_suffix_required");
  }
  const expectedPath = `cache/downloads/${expectedArtifactHash.slice("sha256:".length)}.partial`;
  if (value !== expectedPath) {
    fail(
      "SIDECAR.PARTIAL_PATH_IDENTITY_MISMATCH",
      path,
      "sidecar.partial.path.artifact_addressed_exact"
    );
  }
}

function assertManifestBinding(binding) {
  const path = "/component_manifest";
  assertClosed(binding, MANIFEST_KEYS, path, "sidecar.component_manifest");
  assertExact(
    binding.contract_id,
    "minimax-h3-tool.component-manifest",
    `${path}/contract_id`,
    "sidecar.component_manifest.contract_id"
  );
  assertExact(
    binding.schema_version,
    "1.0.0",
    `${path}/schema_version`,
    "sidecar.component_manifest.schema_version"
  );
  assertUuid(binding.document_id, `${path}/document_id`, "sidecar.component_manifest.document_id");
  assertExact(
    binding.document_revision,
    1,
    `${path}/document_revision`,
    "sidecar.component_manifest.immutable_revision"
  );
  assertHash(binding.content_sha256, `${path}/content_sha256`, "sidecar.component_manifest.content_hash");
  assertPattern(
    binding.component_id,
    DOMAIN_ID_PATTERN,
    `${path}/component_id`,
    "sidecar.component_manifest.component_id",
    { maxBytes: 128 }
  );
  assertPattern(
    binding.component_version,
    COMPONENT_VERSION_PATTERN,
    `${path}/component_version`,
    "sidecar.component_manifest.component_version",
    { maxBytes: 128 }
  );
  assertSafeInteger(
    binding.artifact_byte_length,
    1,
    MAX_ARTIFACT_BYTES,
    `${path}/artifact_byte_length`,
    "sidecar.component_manifest.artifact_length"
  );
  assertHash(binding.artifact_sha256, `${path}/artifact_sha256`, "sidecar.component_manifest.artifact_hash");
  assertPattern(
    binding.source_revision,
    GIT_REVISION_PATTERN,
    `${path}/source_revision`,
    "sidecar.component_manifest.source_revision"
  );
  assertImmutableHttpsLocator(
    binding.source_locator,
    binding.source_revision,
    `${path}/source_locator`
  );
}

function assertSource(source, manifest) {
  const path = "/source";
  assertClosed(source, SOURCE_KEYS, path, "sidecar.source");
  assertPattern(source.revision, GIT_REVISION_PATTERN, `${path}/revision`, "sidecar.source.revision");
  assertImmutableHttpsLocator(source.locator, source.revision, `${path}/locator`);
  assertStrongEtag(source.strong_etag, `${path}/strong_etag`);
  assertSafeInteger(
    source.expected_byte_length,
    1,
    MAX_ARTIFACT_BYTES,
    `${path}/expected_byte_length`,
    "sidecar.source.expected_length"
  );
  assertHash(source.expected_artifact_sha256, `${path}/expected_artifact_sha256`, "sidecar.source.expected_hash");
  if (
    source.locator !== manifest.source_locator ||
    source.revision !== manifest.source_revision
  ) {
    fail("SIDECAR.SOURCE_BINDING_MISMATCH", path, "sidecar.binding.manifest_source_exact");
  }
  if (
    source.expected_byte_length !== manifest.artifact_byte_length ||
    source.expected_artifact_sha256 !== manifest.artifact_sha256
  ) {
    fail(
      "SIDECAR.EXPECTED_IDENTITY_MISMATCH",
      path,
      "sidecar.binding.manifest_artifact_exact"
    );
  }
}

function assertOwner(owner, path = "/lease/owner") {
  assertClosed(owner, OWNER_KEYS, path, "sidecar.lease.owner");
  assertPattern(owner.owner_token, HEX_32_PATTERN, `${path}/owner_token`, "sidecar.lease.owner.token");
  assertSafeInteger(owner.owner_pid, 1, MAX_PID, `${path}/owner_pid`, "sidecar.lease.owner.pid");
  assertPattern(
    owner.owner_process_start_utc_ticks,
    PROCESS_TICKS_PATTERN,
    `${path}/owner_process_start_utc_ticks`,
    "sidecar.lease.owner.process_start_ticks"
  );
  if (BigInt(owner.owner_process_start_utc_ticks) > MAX_PROCESS_START_UTC_TICKS) {
    fail(
      "SIDECAR.INVALID_VALUE",
      `${path}/owner_process_start_utc_ticks`,
      "sidecar.lease.owner.process_start_ticks_bounds"
    );
  }
}

function assertLeaseShape(lease, expectedArtifactHash) {
  const path = "/lease";
  assertClosed(lease, LEASE_KEYS, path, "sidecar.lease");
  assertPattern(lease.lease_id, HEX_32_PATTERN, `${path}/lease_id`, "sidecar.lease.id");
  assertExact(lease.resource_type, "artifact", `${path}/resource_type`, "sidecar.lease.artifact_type");
  assertPattern(lease.resource_key, BARE_HASH_PATTERN, `${path}/resource_key`, "sidecar.lease.bare_hash_key");
  assertExact(lease.mode, "write", `${path}/mode`, "sidecar.lease.write_mode");
  assertOwner(lease.owner);
  if (lease.resource_key !== expectedArtifactHash.slice("sha256:".length)) {
    fail("SIDECAR.LEASE_MISMATCH", path, "sidecar.lease.expected_artifact_key");
  }
}

function ownerEqual(left, right) {
  return (
    left.owner_token === right.owner_token &&
    left.owner_pid === right.owner_pid &&
    left.owner_process_start_utc_ticks === right.owner_process_start_utc_ticks
  );
}

function leaseIdentityEqual(left, right) {
  return (
    left.lease_id === right.lease_id &&
    left.resource_type === right.resource_type &&
    left.resource_key === right.resource_key &&
    left.mode === right.mode &&
    ownerEqual(left.owner, right.owner)
  );
}

function assertActiveLeaseShape(activeLease) {
  if (activeLease === undefined) {
    fail("SIDECAR.ACTIVE_LEASE_REQUIRED", "/lease", "sidecar.lease.active_context_required");
  }
  assertClosed(activeLease, ACTIVE_LEASE_KEYS, "/lease", "sidecar.active_lease");
  assertExact(activeLease.active, true, "/lease", "sidecar.active_lease.must_be_active");
  assertPattern(activeLease.lease_id, HEX_32_PATTERN, "/lease/lease_id", "sidecar.active_lease.id");
  assertExact(
    activeLease.resource_type,
    "artifact",
    "/lease/resource_type",
    "sidecar.active_lease.artifact_type"
  );
  assertPattern(
    activeLease.resource_key,
    BARE_HASH_PATTERN,
    "/lease/resource_key",
    "sidecar.active_lease.bare_hash_key"
  );
  assertExact(activeLease.mode, "write", "/lease/mode", "sidecar.active_lease.write_mode");
  assertOwner(activeLease.owner);
}

function assertActiveWriterLease(sidecarLease, activeLease) {
  assertActiveLeaseShape(activeLease);
  if (
    activeLease.lease_id !== sidecarLease.lease_id ||
    activeLease.resource_type !== sidecarLease.resource_type ||
    activeLease.resource_key !== sidecarLease.resource_key ||
    activeLease.mode !== sidecarLease.mode
  ) {
    fail("SIDECAR.LEASE_MISMATCH", "/lease", "sidecar.lease.active_identity_exact");
  }
  if (!ownerEqual(activeLease.owner, sidecarLease.owner)) {
    fail("SIDECAR.FOREIGN_OWNER", "/lease/owner", "sidecar.lease.active_owner_triple_exact");
  }
}

function assertRecoveryWriterLease(sidecarLease, activeLease) {
  assertActiveLeaseShape(activeLease);
  if (
    activeLease.resource_type !== sidecarLease.resource_type ||
    activeLease.resource_key !== sidecarLease.resource_key ||
    activeLease.mode !== sidecarLease.mode
  ) {
    fail("SIDECAR.LEASE_MISMATCH", "/lease", "sidecar.recovery.same_artifact_writer_resource");
  }
  if (activeLease.lease_id === sidecarLease.lease_id) {
    if (!ownerEqual(activeLease.owner, sidecarLease.owner)) {
      fail(
        "SIDECAR.LEASE_ID_OWNER_CONFLICT",
        "/lease",
        "sidecar.recovery.lease_id_never_rebound"
      );
    }
    fail("SIDECAR.RECOVERY_NOT_REQUIRED", "/lease", "sidecar.recovery.prior_lease_must_differ");
  }
}

function assertReceivedRange(range, expectedLength) {
  const path = "/partial/received_range";
  assertObject(range, path, "sidecar.partial.range.object");
  if (range.kind === "empty_prefix") {
    assertClosed(range, EMPTY_RANGE_KEYS, path, "sidecar.partial.range.empty");
    assertExact(range.byte_length, 0, `${path}/byte_length`, "sidecar.partial.range.empty_length");
    return 0;
  }
  if (range.kind !== "inclusive_prefix") {
    fail("SIDECAR.UNKNOWN_RANGE_KIND", `${path}/kind`, "sidecar.partial.range.kind");
  }
  assertClosed(range, INCLUSIVE_RANGE_KEYS, path, "sidecar.partial.range.inclusive");
  assertExact(
    range.start_inclusive,
    0,
    `${path}/start_inclusive`,
    "sidecar.partial.range.contiguous_prefix_start"
  );
  assertSafeInteger(
    range.end_inclusive,
    0,
    Number.MAX_SAFE_INTEGER,
    `${path}/end_inclusive`,
    "sidecar.partial.range.end_safe_integer"
  );
  if (!Number.isSafeInteger(range.end_inclusive + 1)) {
    fail("SIDECAR.LENGTH_OVERFLOW", path, "sidecar.partial.range.inclusive_math_safe");
  }
  assertSafeInteger(
    range.byte_length,
    1,
    MAX_ARTIFACT_BYTES,
    `${path}/byte_length`,
    "sidecar.partial.range.byte_length"
  );
  if (range.byte_length !== range.end_inclusive + 1) {
    fail("SIDECAR.RANGE_LENGTH_MISMATCH", path, "sidecar.partial.range.inclusive_length_exact");
  }
  if (range.byte_length > expectedLength) {
    fail("SIDECAR.LENGTH_OVERFLOW", path, "sidecar.partial.range.not_over_expected");
  }
  return range.byte_length;
}

function partialIdentityProjection(document) {
  const manifest = document.component_manifest;
  const source = document.source;
  return {
    component_manifest: {
      artifact_byte_length: manifest.artifact_byte_length,
      artifact_sha256: manifest.artifact_sha256,
      component_id: manifest.component_id,
      component_version: manifest.component_version,
      content_sha256: manifest.content_sha256,
      contract_id: manifest.contract_id,
      document_id: manifest.document_id,
      document_revision: manifest.document_revision,
      schema_version: manifest.schema_version,
      source_locator: manifest.source_locator,
      source_revision: manifest.source_revision
    },
    partial_relative_path: document.partial.relative_path,
    profile: "minimax-h3-tool.download-partial-identity.v1",
    source: {
      expected_artifact_sha256: source.expected_artifact_sha256,
      expected_byte_length: source.expected_byte_length,
      locator: source.locator,
      revision: source.revision,
      strong_etag: source.strong_etag
    }
  };
}

export function computePartialIdentity(document) {
  if (!isObject(document) || !isObject(document.component_manifest) || !isObject(document.source)) {
    fail("SIDECAR.INVALID_TYPE", "", "sidecar.partial.identity.input_shape");
  }
  if (!isObject(document.partial) || typeof document.partial.relative_path !== "string") {
    fail("SIDECAR.INVALID_TYPE", "/partial", "sidecar.partial.identity.input_shape");
  }
  return sha256Jcs(partialIdentityProjection(document));
}

function assertPartial(partial, document) {
  const path = "/partial";
  assertClosed(partial, PARTIAL_KEYS, path, "sidecar.partial");
  assertRelativePartialPath(
    partial.relative_path,
    document.source.expected_artifact_sha256,
    `${path}/relative_path`
  );
  assertHash(partial.identity, `${path}/identity`, "sidecar.partial.identity.hash_shape");
  const receivedByteLength = assertReceivedRange(
    partial.received_range,
    document.source.expected_byte_length
  );
  const expectedIdentity = computePartialIdentity(document);
  if (partial.identity !== expectedIdentity) {
    fail("SIDECAR.PARTIAL_IDENTITY_MISMATCH", `${path}/identity`, "sidecar.partial.identity.projection_exact");
  }
  return receivedByteLength;
}

function assertIntegrity(document) {
  const path = "/integrity";
  assertClosed(document.integrity, INTEGRITY_KEYS, path, "sidecar.integrity");
  assertExact(
    document.integrity.profile,
    "rfc8785-sha256-v1",
    `${path}/profile`,
    "sidecar.integrity.profile"
  );
  assertHash(
    document.integrity.content_sha256,
    `${path}/content_sha256`,
    "sidecar.integrity.content_hash_shape"
  );
  if (document.integrity.content_sha256 !== contentSha256(document)) {
    fail("SIDECAR.INTEGRITY_MISMATCH", path, "sidecar.integrity.root_without_integrity_jcs");
  }
}

function assertState(document, receivedByteLength) {
  if (typeof document.state !== "string" || !STATES.has(document.state)) {
    fail("SIDECAR.UNKNOWN_STATE", "/state", "sidecar.state.closed_enum");
  }
  const expected = document.source.expected_byte_length;
  if (document.state === "receiving_bytes" && receivedByteLength === 0) {
    fail("SIDECAR.STATE_RANGE_MISMATCH", "/state", "sidecar.state.receiving_has_bytes");
  }
  if (document.state === "expected_bytes_received") {
    if (receivedByteLength !== expected) {
      fail(
        "SIDECAR.STATE_RANGE_MISMATCH",
        "/state",
        "sidecar.state.expected_bytes_received_length"
      );
    }
  } else if (document.state === "prepared" && receivedByteLength >= expected) {
    fail("SIDECAR.STATE_RANGE_MISMATCH", "/state", "sidecar.state.nonterminal_shorter_than_expected");
  }
}

function validateDocumentShape(document) {
  assertClosed(document, ROOT_KEYS, "", "sidecar.root");
  assertExact(document.contract_id, SIDECAR_CONTRACT_ID, "/contract_id", "sidecar.envelope.contract_id");
  assertExact(
    document.schema_version,
    SIDECAR_SCHEMA_VERSION,
    "/schema_version",
    "sidecar.envelope.schema_version"
  );
  assertUuid(document.document_id, "/document_id", "sidecar.envelope.document_id");
  assertSafeInteger(
    document.document_revision,
    1,
    Number.MAX_SAFE_INTEGER,
    "/document_revision",
    "sidecar.envelope.document_revision"
  );
  assertIntegrity(document);
  assertAuthority(document.authority);
  assertManifestBinding(document.component_manifest);
  assertSource(document.source, document.component_manifest);
  assertSafeInteger(
    document.retry_generation,
    0,
    MAX_RETRY_GENERATION,
    "/retry_generation",
    "sidecar.retry_generation.bounds"
  );
  assertLeaseShape(document.lease, document.source.expected_artifact_sha256);
  const receivedByteLength = assertPartial(document.partial, document);
  assertState(document, receivedByteLength);
  return receivedByteLength;
}

export function validateSidecar(document, { activeLease } = {}) {
  if (RECOVERY_PRIORS.has(document)) {
    fail("SIDECAR.RECOVERY_PRIOR_NON_ACTIONABLE", "", "sidecar.recovery.prior_only");
  }
  validateDocumentShape(document);
  assertActiveWriterLease(document.lease, activeLease);
  return document;
}

export function validateInitialSidecar(document, { activeLease } = {}) {
  const receivedByteLength = validateDocumentShape(document);
  assertActiveWriterLease(document.lease, activeLease);
  if (
    document.document_revision !== 1 ||
    document.retry_generation !== 0 ||
    document.state !== "prepared" ||
    receivedByteLength !== 0
  ) {
    fail("SIDECAR.INVALID_INITIAL_STATE", "", "sidecar.transition.initial_prepared_empty_generation_zero");
  }
  return document;
}

function canonicalEqual(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function assertImmutableBindings(previous, next) {
  if (previous.document_id !== next.document_id) {
    fail("SIDECAR.DOCUMENT_ID_DRIFT", "/document_id", "sidecar.transition.document_id_stable");
  }
  if (!canonicalEqual(previous.authority, next.authority)) {
    fail("SIDECAR.AUTHORITY_DRIFT", "/authority", "sidecar.transition.authority_stable");
  }
  if (previous.source.locator !== next.source.locator || previous.source.revision !== next.source.revision) {
    fail("SIDECAR.SOURCE_DRIFT", "/source", "sidecar.transition.source_stable");
  }
  if (previous.source.strong_etag !== next.source.strong_etag) {
    fail("SIDECAR.ETAG_DRIFT", "/source/strong_etag", "sidecar.transition.etag_stable");
  }
  if (
    previous.source.expected_byte_length !== next.source.expected_byte_length ||
    previous.source.expected_artifact_sha256 !== next.source.expected_artifact_sha256
  ) {
    fail(
      "SIDECAR.EXPECTED_IDENTITY_DRIFT",
      "/source",
      "sidecar.transition.expected_identity_stable"
    );
  }
  if (!canonicalEqual(previous.component_manifest, next.component_manifest)) {
    fail(
      "SIDECAR.MANIFEST_BINDING_DRIFT",
      "/component_manifest",
      "sidecar.transition.manifest_binding_stable"
    );
  }
  if (previous.partial.relative_path !== next.partial.relative_path) {
    fail("SIDECAR.PARTIAL_PATH_DRIFT", "/partial/relative_path", "sidecar.transition.partial_path_stable");
  }
  if (previous.partial.identity !== next.partial.identity) {
    fail("SIDECAR.PARTIAL_IDENTITY_DRIFT", "/partial/identity", "sidecar.transition.partial_identity_stable");
  }
  if (
    previous.lease.resource_type !== next.lease.resource_type ||
    previous.lease.resource_key !== next.lease.resource_key ||
    previous.lease.mode !== next.lease.mode
  ) {
    fail("SIDECAR.LEASE_MISMATCH", "/lease", "sidecar.transition.lease_resource_stable");
  }
}

function getReceivedByteLength(document) {
  return document.partial.received_range.byte_length;
}

function assertRevisionAdvance(previous, next) {
  if (!Number.isSafeInteger(previous.document_revision + 1)) {
    fail("SIDECAR.REVISION_OVERFLOW", "/document_revision", "sidecar.transition.revision_increment_safe");
  }
  if (next.document_revision !== previous.document_revision + 1) {
    fail("SIDECAR.REVISION_SKIP", "/document_revision", "sidecar.transition.revision_exactly_one");
  }
}

function assertRetryAdvance(previous, next) {
  const delta = next.retry_generation - previous.retry_generation;
  if (delta < 0 || delta > 1) {
    fail("SIDECAR.RETRY_SKIP", "/retry_generation", "sidecar.transition.retry_same_or_exactly_one");
  }
  if (delta === 1 && next.retry_generation > MAX_RETRY_GENERATION) {
    fail("SIDECAR.RETRY_OVERFLOW", "/retry_generation", "sidecar.transition.retry_increment_safe");
  }
  return delta;
}

function assertSameAttemptTransition(previous, next, previousBytes, nextBytes) {
  if (!leaseIdentityEqual(previous.lease, next.lease)) {
    fail("SIDECAR.LEASE_BINDING_DRIFT", "/lease", "sidecar.transition.same_attempt_same_lease_owner");
  }
  const edge = `${previous.state}->${next.state}`;
  const allowed = new Set([
    "prepared->receiving_bytes",
    "receiving_bytes->receiving_bytes",
    "receiving_bytes->expected_bytes_received"
  ]);
  if (!allowed.has(edge)) {
    fail("SIDECAR.STATE_JUMP", "/state", "sidecar.transition.same_attempt_edge");
  }
  const finalizationWithoutGrowth =
    edge === "receiving_bytes->expected_bytes_received" &&
    nextBytes === previousBytes &&
    nextBytes === next.source.expected_byte_length;
  if (nextBytes < previousBytes || (nextBytes === previousBytes && !finalizationWithoutGrowth)) {
    fail("SIDECAR.RANGE_NOT_ADVANCED", "/partial/received_range", "sidecar.transition.same_attempt_progress");
  }
}

function assertRetryTransition(previous, next, previousBytes, nextBytes) {
  if (
    previous.lease.lease_id === next.lease.lease_id &&
    !ownerEqual(previous.lease.owner, next.lease.owner)
  ) {
    fail(
      "SIDECAR.LEASE_ID_OWNER_CONFLICT",
      "/lease",
      "sidecar.transition.lease_id_never_rebound"
    );
  }
  if (previous.state === "expected_bytes_received") {
    if (next.state !== "expected_bytes_received") {
      fail("SIDECAR.STATE_JUMP", "/state", "sidecar.transition.terminal_rebind_only");
    }
    if (previous.lease.lease_id === next.lease.lease_id) {
      fail(
        "SIDECAR.RECOVERY_REBIND_REQUIRED",
        "/lease",
        "sidecar.transition.terminal_retry_changes_lease_id"
      );
    }
    if (nextBytes !== previousBytes) {
      fail("SIDECAR.RANGE_DRIFT", "/partial/received_range", "sidecar.transition.retry_range_exact");
    }
    return;
  }
  const fullPrefix = previousBytes === previous.source.expected_byte_length;
  const requiredNextState = fullPrefix ? "receiving_bytes" : "prepared";
  if (next.state !== requiredNextState) {
    fail("SIDECAR.STATE_JUMP", "/state", "sidecar.transition.retry_reenter_receiving_if_full_else_prepared");
  }
  if (nextBytes !== previousBytes) {
    fail("SIDECAR.RANGE_DRIFT", "/partial/received_range", "sidecar.transition.retry_range_exact");
  }
}

export function validateTransition(previous, next, { activeLease } = {}) {
  const previousBytes = validateDocumentShape(previous);
  const nextBytes = validateDocumentShape(next);
  assertActiveWriterLease(next.lease, activeLease);
  assertRevisionAdvance(previous, next);
  assertImmutableBindings(previous, next);
  const retryDelta = assertRetryAdvance(previous, next);
  if (retryDelta === 0) {
    assertSameAttemptTransition(previous, next, previousBytes, nextBytes);
  } else {
    assertRetryTransition(previous, next, previousBytes, nextBytes);
  }
  return next;
}

export function attachIntegrity(coreDocument) {
  assertObject(coreDocument, "", "sidecar.integrity.core_document_object");
  if (Object.hasOwn(coreDocument, "integrity")) {
    fail("SIDECAR.INTEGRITY_ALREADY_PRESENT", "/integrity", "sidecar.integrity.attach_once");
  }
  const document = structuredClone(coreDocument);
  document.integrity = {
    content_sha256: "sha256:" + "0".repeat(64),
    profile: "rfc8785-sha256-v1"
  };
  document.integrity.content_sha256 = contentSha256(document);
  return deepFreeze(document);
}

export function serializeCanonicalSidecar(document, { activeLease, previous, initial = false } = {}) {
  if (previous !== undefined) {
    validateTransition(previous, document, { activeLease });
  } else if (initial) {
    validateInitialSidecar(document, { activeLease });
  } else {
    validateSidecar(document, { activeLease });
  }
  return canonicalBytes(document);
}

export function parseCanonicalSidecar(bytes, { activeLease, previous, initial = false } = {}) {
  const document = parseCanonicalJson(bytes);
  if (previous !== undefined) {
    validateTransition(previous, document, { activeLease });
  } else if (initial) {
    validateInitialSidecar(document, { activeLease });
  } else {
    validateSidecar(document, { activeLease });
  }
  return deepFreeze(document);
}

export function parseCanonicalRecoveryPrior(bytes, { activeLease } = {}) {
  const document = parseCanonicalJson(bytes);
  validateDocumentShape(document);
  assertRecoveryWriterLease(document.lease, activeLease);
  deepFreeze(document);
  RECOVERY_PRIORS.add(document);
  return document;
}

export function sidecarAuthority() {
  return structuredClone(AUTHORITY);
}
