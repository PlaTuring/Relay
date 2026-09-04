import {
  attachIntegrity,
  computePartialIdentity,
  sidecarAuthority
} from "../src/index.mjs";

export const FIXTURE_REVISION = "0123456789abcdef0123456789abcdef01234567";
export const FIXTURE_ARTIFACT_HASH = `sha256:${"a".repeat(64)}`;
export const FIXTURE_MANIFEST_HASH = `sha256:${"b".repeat(64)}`;
export const FIXTURE_PARTIAL_PATH = `cache/downloads/${"a".repeat(64)}.partial`;
export const FIXTURE_OWNER_TOKEN = "4".repeat(32);
export const FIXTURE_PROCESS_TICKS = "638602752000000000";
export const FIXTURE_LEASE_ID = "3".repeat(32);
export const FIXTURE_EXPECTED_LENGTH = 1024;

function emptyRange() {
  return { byte_length: 0, kind: "empty_prefix" };
}

function inclusiveRange(byteLength) {
  return {
    byte_length: byteLength,
    end_inclusive: byteLength - 1,
    kind: "inclusive_prefix",
    start_inclusive: 0
  };
}

export function makeLease({
  leaseId = FIXTURE_LEASE_ID,
  ownerPid = 4242,
  ownerProcessStartUtcTicks = FIXTURE_PROCESS_TICKS,
  ownerToken = FIXTURE_OWNER_TOKEN,
  resourceKey = "a".repeat(64)
} = {}) {
  return {
    lease_id: leaseId,
    mode: "write",
    owner: {
      owner_pid: ownerPid,
      owner_process_start_utc_ticks: ownerProcessStartUtcTicks,
      owner_token: ownerToken
    },
    resource_key: resourceKey,
    resource_type: "artifact"
  };
}

export function activeLease(lease = makeLease()) {
  return { active: true, ...structuredClone(lease) };
}

export function makeDocument({
  byteLength = 0,
  documentRevision = 1,
  lease = makeLease(),
  retryGeneration = 0,
  state = "prepared"
} = {}) {
  const locator = `https://downloads.example.test/releases/${FIXTURE_REVISION}/model.safetensors`;
  const core = {
    authority: sidecarAuthority(),
    component_manifest: {
      artifact_byte_length: FIXTURE_EXPECTED_LENGTH,
      artifact_sha256: FIXTURE_ARTIFACT_HASH,
      component_id: "h3-diffusion-model",
      component_version: "1.0.0",
      content_sha256: FIXTURE_MANIFEST_HASH,
      contract_id: "minimax-h3-tool.component-manifest",
      document_id: "11111111-1111-4111-8111-111111111111",
      document_revision: 1,
      schema_version: "1.0.0",
      source_locator: locator,
      source_revision: FIXTURE_REVISION
    },
    contract_id: "minimax-h3-tool.download-partial-sidecar",
    document_id: "22222222-2222-4222-8222-222222222222",
    document_revision: documentRevision,
    lease: structuredClone(lease),
    partial: {
      identity: `sha256:${"0".repeat(64)}`,
      received_range: byteLength === 0 ? emptyRange() : inclusiveRange(byteLength),
      relative_path: FIXTURE_PARTIAL_PATH
    },
    retry_generation: retryGeneration,
    schema_version: "1.0.0",
    source: {
      expected_artifact_sha256: FIXTURE_ARTIFACT_HASH,
      expected_byte_length: FIXTURE_EXPECTED_LENGTH,
      locator,
      revision: FIXTURE_REVISION,
      strong_etag: '"fixture-etag-a"'
    },
    state
  };
  core.partial.identity = computePartialIdentity(core);
  return attachIntegrity(core);
}

export function resign(document, mutate, { recomputePartialIdentity = false } = {}) {
  const core = structuredClone(document);
  delete core.integrity;
  mutate(core);
  if (recomputePartialIdentity) core.partial.identity = computePartialIdentity(core);
  return attachIntegrity(core);
}

export function receivingDocument({ byteLength = 128, documentRevision = 2, lease, retryGeneration = 0 } = {}) {
  return makeDocument({
    byteLength,
    documentRevision,
    lease: lease ?? makeLease(),
    retryGeneration,
    state: "receiving_bytes"
  });
}

export function expectedBytesReceivedDocument({
  documentRevision = 4,
  lease,
  retryGeneration = 0
} = {}) {
  return makeDocument({
    byteLength: FIXTURE_EXPECTED_LENGTH,
    documentRevision,
    lease: lease ?? makeLease(),
    retryGeneration,
    state: "expected_bytes_received"
  });
}

export const RAW_HOSTILE_FIXTURES = Object.freeze([
  {
    expectedCode: "SIDECAR.UTF8_BOM_FORBIDDEN",
    name: "utf8_bom",
    bytes: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("{}", "utf8")])
  },
  {
    expectedCode: "SIDECAR.INVALID_UTF8",
    name: "invalid_utf8",
    bytes: Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0xc3, 0x28, 0x7d])
  },
  {
    expectedCode: "SIDECAR.DUPLICATE_KEY",
    name: "duplicate_key",
    bytes: Buffer.from('{"contract_id":"a","contract_id":"b"}', "utf8")
  },
  {
    expectedCode: "SIDECAR.INVALID_NUMBER",
    name: "negative_zero",
    bytes: Buffer.from('{"a":-0}', "utf8")
  },
  {
    expectedCode: "SIDECAR.INVALID_NUMBER",
    name: "fractional_number",
    bytes: Buffer.from('{"a":1.0}', "utf8")
  },
  {
    expectedCode: "SIDECAR.INVALID_NUMBER",
    name: "exponent_number",
    bytes: Buffer.from('{"a":1e0}', "utf8")
  },
  {
    expectedCode: "SIDECAR.INVALID_NUMBER",
    name: "unsafe_integer",
    bytes: Buffer.from('{"a":9007199254740992}', "utf8")
  },
  {
    expectedCode: "SIDECAR.NON_CANONICAL_BYTES",
    name: "noncanonical_whitespace",
    bytes: Buffer.from('{ "a":1}', "utf8")
  }
]);

export const HOSTILE_CLASS_NAMES = Object.freeze([
  "absolute_path",
  "ads_path",
  "backslash_path",
  "bom",
  "device_name",
  "device_prefix",
  "duplicate_key",
  "etag_drift",
  "foreign_owner",
  "fragment_url",
  "integrity_mismatch",
  "invalid_etag",
  "invalid_utf8",
  "lease_mismatch",
  "length_overflow",
  "mutable_ref",
  "non_https",
  "noncanonical_bytes",
  "partial_identity_tampering",
  "percent_traversal",
  "query_url",
  "range_drift",
  "retry_skip",
  "source_drift",
  "state_jump",
  "traversal",
  "unc_path",
  "unknown_field",
  "unsafe_integer",
  "url_credentials"
]);
