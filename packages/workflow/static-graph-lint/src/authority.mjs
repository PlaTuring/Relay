import { ALLOWED_CORE_CLASS_TYPES, AUTHORITY, DESCRIPTOR, FORBIDDEN_PARTNER_CLASS_TYPES, RULES, TRUSTED_ALLOWLIST_ANCHOR } from "./constants.mjs";
import { canonicalJson, deepEqualJson, isRecord, sha256Canonical, withoutRootIntegrity } from "./canonical.mjs";

const SHA256 = /^sha256:[0-9a-f]{64}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DOMAIN_ID = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/;
const CLASS_TYPE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SOURCE_PATH = /^[A-Za-z0-9_./-]+$/;

function keysAre(value, allowed) {
  if (!isRecord(value)) return false;
  const set = new Set(allowed);
  return Object.keys(value).every((key) => set.has(key));
}

function hasKeys(value, required) {
  return isRecord(value) && required.every((key) => Object.hasOwn(value, key));
}

function dispositionIsActive(value) {
  return isRecord(value) && Object.keys(value).length === 1 && value.kind === "active";
}

function add(sink, code, path, rule = RULES.authority) {
  sink.add(code, path, rule);
}

function validIntegrity(document) {
  return hasKeys(document.integrity, ["algorithm", "canonicalization", "content_sha256"])
    && keysAre(document.integrity, ["algorithm", "canonicalization", "content_sha256"])
    && document.integrity.algorithm === "sha256"
    && document.integrity.canonicalization === "rfc8785_jcs_root_integrity_omitted"
    && SHA256.test(document.integrity.content_sha256)
    && sha256Canonical(withoutRootIntegrity(document)) === document.integrity.content_sha256;
}

function validateOrigin(origin, scope, evidenceIds) {
  return hasKeys(origin, ["upstream_id", "origin_uri", "locked_revision", "source_path", "git_blob_sha", "first_introduced_revision", "evidence_source_ids"])
    && keysAre(origin, ["upstream_id", "origin_uri", "locked_revision", "source_path", "git_blob_sha", "first_introduced_revision", "evidence_source_ids"])
    && origin.upstream_id === "comfyui-core"
    && origin.origin_uri === scope.backend_origin_uri
    && origin.locked_revision === scope.backend_locked_revision
    && typeof origin.source_path === "string" && SOURCE_PATH.test(origin.source_path) && origin.source_path.length <= 256
    && GIT_SHA.test(origin.git_blob_sha)
    && GIT_SHA.test(origin.first_introduced_revision)
    && Array.isArray(origin.evidence_source_ids) && origin.evidence_source_ids.length >= 1 && origin.evidence_source_ids.length <= 16
    && new Set(origin.evidence_source_ids).size === origin.evidence_source_ids.length
    && origin.evidence_source_ids.every((id) => evidenceIds.has(id));
}

function validateFlags(flags) {
  return hasKeys(flags, ["local_only", "is_api_node", "is_output_node"])
    && keysAre(flags, ["local_only", "is_api_node", "is_output_node"])
    && flags.local_only === true
    && flags.is_api_node === false
    && typeof flags.is_output_node === "boolean";
}

function validateFingerprints(fingerprints) {
  return hasKeys(fingerprints, ["input_schema_sha256", "output_schema_sha256", "combined_schema_sha256"])
    && keysAre(fingerprints, ["input_schema_sha256", "output_schema_sha256", "combined_schema_sha256"])
    && SHA256.test(fingerprints.input_schema_sha256)
    && SHA256.test(fingerprints.output_schema_sha256)
    && SHA256.test(fingerprints.combined_schema_sha256);
}

export function validateAuthority(authority, sink) {
  const rootKeys = ["contract_id", "schema_version", "document_id", "document_revision", "allowlist_id", "scope", "fingerprint_profile", "evidence_sources", "entries", "forbidden_identities", "disposition", "extensions", "integrity"];
  const required = rootKeys.filter((key) => key !== "extensions");
  if (!hasKeys(authority, required) || !keysAre(authority, rootKeys)) {
    add(sink, "AUTHORITY.ENVELOPE_INVALID", "/allowlist");
    return null;
  }
  if (authority.contract_id !== AUTHORITY.contractId || authority.schema_version !== AUTHORITY.schemaVersion
    || authority.document_revision !== AUTHORITY.documentRevision || !UUID_V4.test(authority.document_id)
    || typeof authority.allowlist_id !== "string" || !DOMAIN_ID.test(authority.allowlist_id) || authority.allowlist_id.length > 128) {
    add(sink, "AUTHORITY.IDENTITY_INVALID", "/allowlist");
    return null;
  }
  if (!hasKeys(authority.scope, ["runtime_topology", "backend_origin_uri", "backend_locked_revision", "policy"])
    || !keysAre(authority.scope, ["runtime_topology", "backend_origin_uri", "backend_locked_revision", "policy"])
    || authority.scope.runtime_topology !== AUTHORITY.runtimeTopology
    || authority.scope.backend_origin_uri !== AUTHORITY.backendOriginUri
    || authority.scope.backend_locked_revision !== AUTHORITY.backendLockedRevision
    || authority.scope.policy !== AUTHORITY.policy) {
    add(sink, "AUTHORITY.SCOPE_INVALID", "/allowlist/scope");
    return null;
  }
  const profile = authority.fingerprint_profile;
  if (!hasKeys(profile, ["algorithm", "normalization", "input_projection", "output_projection", "combined_projection"])
    || !keysAre(profile, ["algorithm", "normalization", "input_projection", "output_projection", "combined_projection"])
    || profile.algorithm !== AUTHORITY.fingerprintProfile.algorithm
    || profile.normalization !== AUTHORITY.fingerprintProfile.normalization
    || profile.input_projection !== AUTHORITY.fingerprintProfile.input_projection
    || profile.output_projection !== AUTHORITY.fingerprintProfile.output_projection
    || profile.combined_projection !== AUTHORITY.fingerprintProfile.combined_projection) {
    add(sink, "AUTHORITY.FINGERPRINT_PROFILE_INVALID", "/allowlist/fingerprint_profile");
    return null;
  }
  if (!dispositionIsActive(authority.disposition)) {
    add(sink, "AUTHORITY.NOT_ACTIVE", "/allowlist/disposition");
    return null;
  }
  if (!validIntegrity(authority)) {
    add(sink, "AUTHORITY.INTEGRITY_MISMATCH", "/allowlist/integrity");
    return null;
  }
  if (!Array.isArray(authority.evidence_sources) || authority.evidence_sources.length < 1 || authority.evidence_sources.length > 32) {
    add(sink, "AUTHORITY.EVIDENCE_INVALID", "/allowlist/evidence_sources");
    return null;
  }
  const evidenceIds = new Set();
  for (let index = 0; index < authority.evidence_sources.length; index += 1) {
    const source = authority.evidence_sources[index];
    if (!hasKeys(source, ["source_id", "locator", "revision", "content_sha256", "evidence_status"])
      || !keysAre(source, ["source_id", "locator", "revision", "content_sha256", "evidence_status"])
      || typeof source.source_id !== "string" || !DOMAIN_ID.test(source.source_id) || evidenceIds.has(source.source_id)
      || typeof source.locator !== "string" || !/^(?:repo:[A-Za-z0-9._/-]+|https:\/\/[^?#]+)$/.test(source.locator)
      || typeof source.revision !== "string" || source.revision.length < 5 || source.revision.length > 128
      || !SHA256.test(source.content_sha256) || source.evidence_status !== "proven") {
      add(sink, "AUTHORITY.EVIDENCE_INVALID", `/allowlist/evidence_sources/${index}`);
      return null;
    }
    evidenceIds.add(source.source_id);
  }
  if (!Array.isArray(authority.entries) || authority.entries.length < 1 || authority.entries.length > 64) {
    add(sink, "AUTHORITY.ENTRIES_INVALID", "/allowlist/entries");
    return null;
  }
  const entries = new Map();
  const displayNames = new Map();
  for (let index = 0; index < authority.entries.length; index += 1) {
    const entry = authority.entries[index];
    const path = `/allowlist/entries/${index}`;
    if (!hasKeys(entry, ["class_type", "schema_fingerprints", "origin", "flags", "evidence_status", "runtime_acceptance", "disposition"])
      || !keysAre(entry, ["class_type", "display_name", "schema_fingerprints", "origin", "flags", "evidence_status", "runtime_acceptance", "disposition"])) {
      add(sink, "AUTHORITY.ENTRY_INVALID", path);
      return null;
    }
    if (typeof entry.class_type !== "string" || !CLASS_TYPE.test(entry.class_type)
      || !ALLOWED_CORE_CLASS_TYPES.includes(entry.class_type) || entries.has(entry.class_type)) {
      add(sink, entries.has(entry.class_type) ? "AUTHORITY.DUPLICATE_CLASS_TYPE" : "AUTHORITY.CLASS_TYPE_INVALID", `${path}/class_type`);
      return null;
    }
    if (Object.hasOwn(entry, "display_name") && (typeof entry.display_name !== "string" || entry.display_name.length < 1 || entry.display_name.length > 256)) {
      add(sink, "AUTHORITY.DISPLAY_METADATA_INVALID", `${path}/display_name`);
      return null;
    }
    if (!validateFingerprints(entry.schema_fingerprints) || !validateOrigin(entry.origin, authority.scope, evidenceIds)
      || !validateFlags(entry.flags) || entry.evidence_status !== "proven"
      || !["passed", "poc_pending", "blocked"].includes(entry.runtime_acceptance) || !dispositionIsActive(entry.disposition)) {
      add(sink, "AUTHORITY.ENTRY_IDENTITY_INVALID", path);
      return null;
    }
    entries.set(entry.class_type, entry);
    if (entry.display_name) displayNames.set(entry.display_name, entry.class_type);
  }
  if (!Array.isArray(authority.forbidden_identities) || authority.forbidden_identities.length < 9 || authority.forbidden_identities.length > 64) {
    add(sink, "AUTHORITY.FORBIDDEN_SEED_INVALID", "/allowlist/forbidden_identities");
    return null;
  }
  const forbidden = new Set();
  for (let index = 0; index < authority.forbidden_identities.length; index += 1) {
    const entry = authority.forbidden_identities[index];
    if (!isRecord(entry) || typeof entry.class_type !== "string" || forbidden.has(entry.class_type)
      || entry.is_api_node !== true || entry.local_only !== false || entry.reason_code !== "NODE.PARTNER_API_FORBIDDEN") {
      add(sink, "AUTHORITY.FORBIDDEN_SEED_INVALID", `/allowlist/forbidden_identities/${index}`);
      return null;
    }
    forbidden.add(entry.class_type);
  }
  if (FORBIDDEN_PARTNER_CLASS_TYPES.some((classType) => !forbidden.has(classType))
    || [...entries.keys()].some((classType) => forbidden.has(classType))) {
    add(sink, "AUTHORITY.FORBIDDEN_SEED_INCOMPLETE", "/allowlist/forbidden_identities");
    return null;
  }
  const tupleProjection = authority.entries.map((entry) => ({
    class_type: entry.class_type,
    schema_fingerprints: entry.schema_fingerprints,
    origin: {
      origin_uri: entry.origin.origin_uri,
      locked_revision: entry.origin.locked_revision,
      source_path: entry.origin.source_path,
      git_blob_sha: entry.origin.git_blob_sha,
    },
    flags: entry.flags,
    disposition: entry.disposition,
  }));
  if (!deepEqualJson([...entries.keys()], TRUSTED_ALLOWLIST_ANCHOR.class_types)
    || sha256Canonical(tupleProjection) !== TRUSTED_ALLOWLIST_ANCHOR.entry_tuple_sha256) {
    add(sink, "AUTHORITY.ENTRY_TUPLE_ANCHOR_MISMATCH", "/allowlist/entries");
    return null;
  }
  if (authority.contract_id !== TRUSTED_ALLOWLIST_ANCHOR.contract_id
    || authority.schema_version !== TRUSTED_ALLOWLIST_ANCHOR.schema_version
    || authority.document_id !== TRUSTED_ALLOWLIST_ANCHOR.document_id
    || authority.document_revision !== TRUSTED_ALLOWLIST_ANCHOR.document_revision
    || authority.integrity.content_sha256 !== TRUSTED_ALLOWLIST_ANCHOR.content_sha256) {
    add(sink, "AUTHORITY.TRUST_ANCHOR_MISMATCH", "/allowlist");
    return null;
  }
  return Object.freeze({ authority, entries, displayNames, forbidden });
}

function descriptorFingerprint(entry) {
  const input = {
    required_inputs: entry.required_inputs,
    optional_inputs: entry.optional_inputs,
    hidden_inputs: entry.hidden_inputs,
  };
  const output = { outputs: entry.outputs };
  const combined = {
    class_type: entry.class_type,
    required_inputs: entry.required_inputs,
    optional_inputs: entry.optional_inputs,
    hidden_inputs: entry.hidden_inputs,
    outputs: entry.outputs,
    flags: { is_api_node: entry.flags.is_api_node, is_output_node: entry.flags.is_output_node },
  };
  return Object.freeze({
    input_schema_sha256: sha256Canonical(input),
    output_schema_sha256: sha256Canonical(output),
    combined_schema_sha256: sha256Canonical(combined),
  });
}

function validateInputSets(entry) {
  const names = new Set();
  for (const setName of ["required_inputs", "optional_inputs", "hidden_inputs"]) {
    const set = entry[setName];
    if (!Array.isArray(set) || set.length > 256) return false;
    for (const input of set) {
      if (!isRecord(input) || typeof input.name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(input.name)
        || typeof input.type !== "string" || input.type.length < 1 || input.type.length > 128 || names.has(input.name)) return false;
      names.add(input.name);
      try { canonicalJson(input); } catch { return false; }
    }
  }
  if (!Array.isArray(entry.outputs) || entry.outputs.length > 256) return false;
  const indexes = new Set();
  for (let index = 0; index < entry.outputs.length; index += 1) {
    const output = entry.outputs[index];
    if (!isRecord(output) || !Number.isInteger(output.index) || output.index !== index || indexes.has(output.index)
      || typeof output.type !== "string" || output.type.length < 1 || output.type.length > 128) return false;
    indexes.add(output.index);
  }
  return true;
}

export function validateDescriptors(document, authorityState, sink) {
  const rootKeys = ["contract_id", "schema_version", "document_id", "document_revision", "authority_ref", "fingerprint_profile", "descriptors", "disposition", "integrity"];
  if (!hasKeys(document, rootKeys) || !keysAre(document, rootKeys)
    || document.contract_id !== DESCRIPTOR.contractId || document.schema_version !== DESCRIPTOR.schemaVersion
    || document.document_revision !== DESCRIPTOR.documentRevision || !UUID_V4.test(document.document_id)) {
    add(sink, "DESCRIPTOR.ENVELOPE_INVALID", "/descriptors", RULES.descriptor);
    return null;
  }
  const reference = document.authority_ref;
  if (!hasKeys(reference, ["contract_id", "schema_version", "document_id", "document_revision", "content_sha256"])
    || !keysAre(reference, ["contract_id", "schema_version", "document_id", "document_revision", "content_sha256"])
    || reference.contract_id !== authorityState.authority.contract_id
    || reference.schema_version !== authorityState.authority.schema_version
    || reference.document_id !== authorityState.authority.document_id
    || reference.document_revision !== authorityState.authority.document_revision
    || reference.content_sha256 !== authorityState.authority.integrity.content_sha256) {
    add(sink, "DESCRIPTOR.AUTHORITY_REF_MISMATCH", "/descriptors/authority_ref", RULES.descriptor);
    return null;
  }
  if (!deepEqualJson(document.fingerprint_profile, authorityState.authority.fingerprint_profile)) {
    add(sink, "DESCRIPTOR.FINGERPRINT_PROFILE_MISMATCH", "/descriptors/fingerprint_profile", RULES.descriptor);
    return null;
  }
  if (!dispositionIsActive(document.disposition) || !validIntegrity(document)) {
    add(sink, !dispositionIsActive(document.disposition) ? "DESCRIPTOR.NOT_ACTIVE" : "DESCRIPTOR.INTEGRITY_MISMATCH", "/descriptors", RULES.descriptor);
    return null;
  }
  if (!Array.isArray(document.descriptors) || document.descriptors.length !== authorityState.entries.size) {
    add(sink, "DESCRIPTOR.SET_MISMATCH", "/descriptors/descriptors", RULES.descriptor);
    return null;
  }
  const descriptors = new Map();
  for (let index = 0; index < document.descriptors.length; index += 1) {
    const descriptor = document.descriptors[index];
    const path = `/descriptors/descriptors/${index}`;
    const allowedKeys = ["class_type", "required_inputs", "optional_inputs", "hidden_inputs", "outputs", "schema_fingerprints", "origin", "flags", "evidence_status", "disposition"];
    if (!hasKeys(descriptor, allowedKeys) || !keysAre(descriptor, allowedKeys)
      || typeof descriptor.class_type !== "string" || descriptors.has(descriptor.class_type)) {
      add(sink, descriptors.has(descriptor?.class_type) ? "DESCRIPTOR.DUPLICATE_CLASS_TYPE" : "DESCRIPTOR.ENTRY_INVALID", path, RULES.descriptor);
      return null;
    }
    const authorityEntry = authorityState.entries.get(descriptor.class_type);
    if (!authorityEntry) {
      add(sink, "DESCRIPTOR.UNKNOWN_CLASS_TYPE", `${path}/class_type`, RULES.descriptor);
      return null;
    }
    if (!validateInputSets(descriptor)) {
      add(sink, "DESCRIPTOR.SCHEMA_INVALID", path, RULES.descriptor);
      return null;
    }
    const computed = descriptorFingerprint(descriptor);
    if (!validateFingerprints(descriptor.schema_fingerprints)
      || !deepEqualJson(computed, descriptor.schema_fingerprints)
      || !deepEqualJson(computed, authorityEntry.schema_fingerprints)) {
      add(sink, "DESCRIPTOR.FINGERPRINT_MISMATCH", `${path}/schema_fingerprints`, RULES.descriptor);
      return null;
    }
    if (!isRecord(descriptor.origin) || !deepEqualJson(descriptor.origin, authorityEntry.origin)) {
      add(sink, "DESCRIPTOR.ORIGIN_MISMATCH", `${path}/origin`, RULES.descriptor);
      return null;
    }
    if (!deepEqualJson(descriptor.flags, authorityEntry.flags) || !validateFlags(descriptor.flags)) {
      add(sink, "DESCRIPTOR.FLAGS_MISMATCH", `${path}/flags`, RULES.descriptor);
      return null;
    }
    if (descriptor.evidence_status !== "proven" || !dispositionIsActive(descriptor.disposition)
      || !deepEqualJson(descriptor.disposition, authorityEntry.disposition)) {
      add(sink, "DESCRIPTOR.DISPOSITION_MISMATCH", `${path}/disposition`, RULES.descriptor);
      return null;
    }
    const inputMap = new Map();
    for (const [setName, required] of [["required_inputs", true], ["optional_inputs", false], ["hidden_inputs", false]]) {
      for (const input of descriptor[setName]) inputMap.set(input.name, Object.freeze({ ...input, required, set: setName }));
    }
    descriptors.set(descriptor.class_type, Object.freeze({ ...descriptor, inputMap }));
  }
  return descriptors;
}

export function computeDescriptorFingerprints(entry) {
  return descriptorFingerprint(entry);
}

export function computeRootIntegrity(document) {
  return sha256Canonical(withoutRootIntegrity(document));
}
