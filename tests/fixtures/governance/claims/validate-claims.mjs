import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../../..");
const VALID_PATH = path.join(HERE, "registry.valid.json");
const CASES_DIR = path.join(HERE, "cases");
const SOURCES_DIR = path.join(HERE, "sources");
const CONVENTION_PATH = path.join(ROOT, "docs", "architecture", "EVIDENCE_CLAIM_CONVENTION.md");
const FIXTURE_AS_OF_UTC = "2026-08-27T12:00:00.000Z";
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_DEPTH = 64;
const MAX_VALUES = 200_000;
const MAX_OBJECT_PROPERTIES = 10_000;
const MAX_ARRAY_ITEMS = 10_000;
const MAX_STRING_BYTES = 1024 * 1024;
const REQUIRED_REVALIDATION_TRIGGERS = [
  "evidence_expiry",
  "gate_reopened",
  "reproducibility_failure",
  "scope_changed",
  "source_hash_drift",
  "upstream_revision_changed",
];
const DOWNGRADE_POLICY = {
  on_expiry: "poc_pending",
  on_source_drift: "poc_pending",
  on_scope_change: "poc_pending",
  on_gate_reopen: "poc_pending",
  on_reproducibility_failure: "poc_pending",
  on_revocation: "poc_pending",
  public_withdrawal: "immediate",
};

function fatal(message) {
  throw new Error(message);
}

function normalizedError(code, instancePath, ruleId) {
  return { code, instance_path: instancePath, rule_id: ruleId };
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

class StrictJsonParser {
  constructor(text) {
    this.text = text;
    this.pos = 0;
    this.values = 0;
  }

  parse() {
    this.skipWhitespace();
    const value = this.parseValue(0);
    this.skipWhitespace();
    if (this.pos !== this.text.length) fatal(`invalid JSON at offset ${this.pos}`);
    return value;
  }

  skipWhitespace() {
    while (this.pos < this.text.length && /[\u0009\u000a\u000d\u0020]/.test(this.text[this.pos])) this.pos += 1;
  }

  count(depth) {
    if (depth > MAX_DEPTH) fatal("JSON nesting exceeds 64");
    this.values += 1;
    if (this.values > MAX_VALUES) fatal("JSON value count exceeds 200000");
  }

  parseValue(depth) {
    this.count(depth);
    const ch = this.text[this.pos];
    if (ch === "{") return this.parseObject(depth + 1);
    if (ch === "[") return this.parseArray(depth + 1);
    if (ch === '"') return this.parseString();
    if (ch === "t" && this.text.startsWith("true", this.pos)) { this.pos += 4; return true; }
    if (ch === "f" && this.text.startsWith("false", this.pos)) { this.pos += 5; return false; }
    if (ch === "n" && this.text.startsWith("null", this.pos)) { this.pos += 4; return null; }
    return this.parseInteger();
  }

  parseString() {
    const start = this.pos;
    this.pos += 1;
    while (this.pos < this.text.length) {
      const code = this.text.charCodeAt(this.pos);
      const ch = this.text[this.pos];
      if (ch === '"') {
        this.pos += 1;
        let value;
        try { value = JSON.parse(this.text.slice(start, this.pos)); } catch { fatal(`invalid JSON string at offset ${start}`); }
        if (Buffer.byteLength(value, "utf8") > MAX_STRING_BYTES) fatal("JSON string exceeds 1 MiB");
        for (let index = 0; index < value.length; index += 1) {
          const current = value.charCodeAt(index);
          if (current >= 0xd800 && current <= 0xdbff) {
            const next = value.charCodeAt(index + 1);
            if (!(next >= 0xdc00 && next <= 0xdfff)) fatal("unpaired high surrogate");
            index += 1;
          } else if (current >= 0xdc00 && current <= 0xdfff) fatal("unpaired low surrogate");
        }
        return value;
      }
      if (code < 0x20) fatal(`unescaped control character at offset ${this.pos}`);
      if (ch === "\\") {
        this.pos += 1;
        const escape = this.text[this.pos];
        if (!'"\\/bfnrtu'.includes(escape ?? "")) fatal(`invalid escape at offset ${this.pos}`);
        if (escape === "u") {
          const hex = this.text.slice(this.pos + 1, this.pos + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fatal(`invalid unicode escape at offset ${this.pos}`);
          this.pos += 4;
        }
      }
      this.pos += 1;
    }
    fatal(`unterminated JSON string at offset ${start}`);
  }

  parseInteger() {
    const match = /^-?(?:0|[1-9][0-9]*)/.exec(this.text.slice(this.pos));
    if (!match) fatal(`invalid JSON value at offset ${this.pos}`);
    const end = this.pos + match[0].length;
    if (/[.eE]/.test(this.text[end] ?? "")) fatal(`non-integer number at offset ${this.pos}`);
    if (match[0] === "-0") fatal(`negative zero at offset ${this.pos}`);
    const value = Number(match[0]);
    if (!Number.isSafeInteger(value)) fatal(`unsafe integer at offset ${this.pos}`);
    this.pos = end;
    return value;
  }

  parseObject(depth) {
    const result = {};
    const keys = new Set();
    this.pos += 1;
    this.skipWhitespace();
    if (this.text[this.pos] === "}") { this.pos += 1; return result; }
    while (true) {
      if (this.text[this.pos] !== '"') fatal(`object key must be a string at offset ${this.pos}`);
      const key = this.parseString();
      if (Buffer.byteLength(key, "utf8") > 128) fatal("JSON key exceeds 128 UTF-8 bytes");
      if (keys.has(key)) fatal(`duplicate JSON key at offset ${this.pos}`);
      keys.add(key);
      if (keys.size > MAX_OBJECT_PROPERTIES) fatal("object property count exceeds 10000");
      this.skipWhitespace();
      if (this.text[this.pos] !== ":") fatal(`missing colon at offset ${this.pos}`);
      this.pos += 1;
      this.skipWhitespace();
      result[key] = this.parseValue(depth);
      this.skipWhitespace();
      if (this.text[this.pos] === "}") { this.pos += 1; return result; }
      if (this.text[this.pos] !== ",") fatal(`missing comma at offset ${this.pos}`);
      this.pos += 1;
      this.skipWhitespace();
    }
  }

  parseArray(depth) {
    const result = [];
    this.pos += 1;
    this.skipWhitespace();
    if (this.text[this.pos] === "]") { this.pos += 1; return result; }
    while (true) {
      if (result.length >= MAX_ARRAY_ITEMS) fatal("array item count exceeds 10000");
      result.push(this.parseValue(depth));
      this.skipWhitespace();
      if (this.text[this.pos] === "]") { this.pos += 1; return result; }
      if (this.text[this.pos] !== ",") fatal(`missing comma at offset ${this.pos}`);
      this.pos += 1;
      this.skipWhitespace();
    }
  }
}

function readJson(filePath) {
  const bytes = fs.readFileSync(filePath);
  if (bytes.length > MAX_BYTES) fatal(`${path.basename(filePath)} exceeds 16 MiB`);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) fatal(`${path.basename(filePath)} has a forbidden UTF-8 BOM`);
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { fatal(`${path.basename(filePath)} is not valid UTF-8`); }
  return new StrictJsonParser(text).parse();
}

function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) fatal("canonical fixture JSON accepts safe integers only");
    return String(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  fatal("unsupported canonical JSON value");
}

function sha256Bytes(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function contentHash(document) {
  const projection = structuredClone(document);
  delete projection.integrity;
  return sha256Bytes(Buffer.from(canonicalJson(projection), "utf8"));
}

function refreshIntegrity(document) {
  if (isPlainObject(document.integrity)) document.integrity.content_sha256 = contentHash(document);
}

function pointerEscape(value) {
  return String(value).replace(/~/g, "~0").replace(/\//g, "~1");
}

function objectShape(value, allowed, required, instancePath, ruleId) {
  if (!isPlainObject(value)) return normalizedError("CONTRACT.INVALID_SHAPE", instancePath, `${ruleId}.object`);
  for (const key of Object.keys(value).sort()) {
    if (!allowed.includes(key)) return normalizedError("CONTRACT.UNKNOWN_FIELD", `${instancePath}/${pointerEscape(key)}`, `${ruleId}.closed`);
  }
  for (const key of required) {
    if (!(key in value)) return normalizedError("CONTRACT.MISSING_FIELD", `${instancePath}/${pointerEscape(key)}`, `${ruleId}.${key}.required`);
  }
  return null;
}

function stringArray(value, instancePath, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) return normalizedError("CLAIM.STRING_ARRAY_REQUIRED", instancePath, "claim.array.nonempty_strings");
  const seen = new Set();
  for (let index = 0; index < value.length; index += 1) {
    if (typeof value[index] !== "string" || !/^[a-z0-9][a-z0-9_-]{1,127}$/.test(value[index])) return normalizedError("CLAIM.INVALID_REASON_CODE", `${instancePath}/${index}`, "claim.reason_code.syntax");
    if (seen.has(value[index])) return normalizedError("CLAIM.DUPLICATE_ARRAY_VALUE", `${instancePath}/${index}`, "claim.array.unique");
    seen.add(value[index]);
  }
  return null;
}

function validTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function timestampCheck(value, instancePath, ruleId) {
  return validTimestamp(value) ? null : normalizedError("CLAIM.INVALID_TIMESTAMP", instancePath, ruleId);
}

function isImmutableRevision(value) {
  if (typeof value !== "string" || /(?:^|[:._-])(main|latest|head)(?:$|[:._-])/i.test(value)) return false;
  return /^(?:git:[0-9a-f]{40}|version:(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)|decision:[A-Z0-9][A-Z0-9._-]{2,127}|fixture:[a-z0-9][a-z0-9._-]{2,127})$/.test(value);
}

function validSha256(value) {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}

function sameStringSet(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === new Set(left).size && right.length === new Set(right).size && [...left].sort().join("\u0000") === [...right].sort().join("\u0000");
}

function exactObject(actual, expected) {
  return canonicalJson(actual) === canonicalJson(expected);
}

const SOURCE_REF_FIELDS = ["source_id", "source_kind", "locator", "publisher", "immutable_revision", "artifact_sha256"];
const SOURCE_KINDS = new Set(["repeatable_test", "accepted_poc", "reasoned_analysis", "immutable_upstream", "license_obligation_extract", "gate_catalog", "gate_decision_pack", "revocation_decision_pack"]);

function validateSourceReference(reference, instancePath, expectedKinds = null) {
  let issue = objectShape(reference, SOURCE_REF_FIELDS, SOURCE_REF_FIELDS, instancePath, "claim.source_ref");
  if (issue) return { issue };
  if (typeof reference.source_id !== "string" || !/^SRC-[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(reference.source_id)) return { issue: normalizedError("CLAIM.INVALID_SOURCE_ID", `${instancePath}/source_id`, "claim.source.id.syntax") };
  if (!SOURCE_KINDS.has(reference.source_kind) || (expectedKinds && !expectedKinds.has(reference.source_kind))) return { issue: normalizedError("CLAIM.UNKNOWN_SOURCE_KIND", `${instancePath}/source_kind`, "claim.source.kind.known") };
  if (reference.publisher !== "synthetic-governance-fixture") return { issue: normalizedError("CLAIM.SOURCE_PUBLISHER_MISMATCH", `${instancePath}/publisher`, "claim.source.publisher.exact") };
  if (!isImmutableRevision(reference.immutable_revision)) return { issue: normalizedError("CLAIM.SOURCE_REVISION_NOT_IMMUTABLE", `${instancePath}/immutable_revision`, "claim.source.revision.immutable") };
  if (!validSha256(reference.artifact_sha256)) return { issue: normalizedError("CLAIM.SOURCE_HASH_INVALID", `${instancePath}/artifact_sha256`, "claim.source.hash.sha256") };
  if (typeof reference.locator !== "string" || !/^sources\/[a-z0-9]+(?:-[a-z0-9]+)*\.json$/.test(reference.locator)) return { issue: normalizedError("CLAIM.SOURCE_LOCATOR_FORBIDDEN", `${instancePath}/locator`, "claim.source.locator.fixture_relative") };

  const resolved = path.resolve(HERE, ...reference.locator.split("/"));
  const relative = path.relative(SOURCES_DIR, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return { issue: normalizedError("CLAIM.SOURCE_UNRESOLVED", `${instancePath}/locator`, "claim.source.locator.resolved_contained") };
  const bytes = fs.readFileSync(resolved);
  if (sha256Bytes(bytes) !== reference.artifact_sha256) return { issue: normalizedError("CLAIM.SOURCE_HASH_MISMATCH", `${instancePath}/artifact_sha256`, "claim.source.hash.raw_exact") };
  const source = readJson(resolved);
  const commonFields = ["source_document_version", "source_id", "source_kind", "publisher", "immutable_revision"];
  const kindFields = {
    repeatable_test: ["component_ids", "scope_ids", "repeatable", "pass_count", "attempt_count", "test_case_ids"],
    accepted_poc: ["component_ids", "scope_ids", "repeatable", "pass_count", "attempt_count", "test_case_ids"],
    reasoned_analysis: ["component_ids", "scope_ids", "basis_codes"],
    immutable_upstream: ["component_ids", "scope_ids", "basis_codes"],
    license_obligation_extract: ["component_ids", "scope_ids", "obligations"],
    gate_catalog: ["requirements"],
    gate_decision_pack: ["decisions"],
    revocation_decision_pack: ["revocations"],
  };
  const allFields = [...commonFields, ...kindFields[reference.source_kind]];
  issue = objectShape(source, allFields, allFields, instancePath, "claim.source_document");
  if (issue) return { issue };
  if (source.source_document_version !== "1.0.0" || source.source_id !== reference.source_id || source.source_kind !== reference.source_kind || source.publisher !== reference.publisher || source.immutable_revision !== reference.immutable_revision) {
    return { issue: normalizedError("CLAIM.SOURCE_IDENTITY_MISMATCH", instancePath, "claim.source.identity.exact") };
  }
  return { source, resolved };
}

function validateDirectSourceDocument(source, instancePath) {
  if (!Array.isArray(source.component_ids) || source.component_ids.length === 0 || source.component_ids.some((value) => typeof value !== "string")) return normalizedError("CLAIM.SOURCE_COMPONENT_INVALID", instancePath, "claim.source.component.nonempty");
  if (!Array.isArray(source.scope_ids) || source.scope_ids.length === 0 || source.scope_ids.some((value) => typeof value !== "string")) return normalizedError("CLAIM.SOURCE_SCOPE_INVALID", instancePath, "claim.source.scope.nonempty");
  if (typeof source.repeatable !== "boolean" || !Number.isSafeInteger(source.pass_count) || !Number.isSafeInteger(source.attempt_count) || source.pass_count < 0 || source.attempt_count < 1 || source.pass_count > source.attempt_count) return normalizedError("CLAIM.SOURCE_RESULT_INVALID", instancePath, "claim.source.result.counts") ;
  if (!Array.isArray(source.test_case_ids) || source.test_case_ids.length !== source.attempt_count || source.test_case_ids.some((value) => typeof value !== "string")) return normalizedError("CLAIM.SOURCE_TEST_CASES_INVALID", instancePath, "claim.source.test_cases.exact_count");
  return null;
}

function validateAnalysisSourceDocument(source, instancePath) {
  if (!Array.isArray(source.component_ids) || source.component_ids.length === 0 || source.component_ids.some((value) => typeof value !== "string")) return normalizedError("CLAIM.SOURCE_COMPONENT_INVALID", instancePath, "claim.source.component.nonempty");
  if (!Array.isArray(source.scope_ids) || source.scope_ids.length === 0 || source.scope_ids.some((value) => typeof value !== "string")) return normalizedError("CLAIM.SOURCE_SCOPE_INVALID", instancePath, "claim.source.scope.nonempty");
  return stringArray(source.basis_codes, `${instancePath}/basis_codes`);
}

function validateSubject(subject, instancePath) {
  const fields = ["kind", "subject_id", "component_id", "scope_id", "immutable_revision", "artifact_sha256"];
  let issue = objectShape(subject, fields, fields, instancePath, "claim.subject");
  if (issue) return issue;
  if (!new Set(["technical_verification", "capability", "distribution_claim", "hardware_profile", "governance_rule", "license_obligation"]).has(subject.kind)) return normalizedError("CLAIM.UNKNOWN_SUBJECT_KIND", `${instancePath}/kind`, "claim.subject.kind.known");
  if (typeof subject.subject_id !== "string" || !/^[A-Z][A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(subject.subject_id)) return normalizedError("CLAIM.INVALID_SUBJECT_ID", `${instancePath}/subject_id`, "claim.subject.id.syntax");
  if (typeof subject.component_id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(subject.component_id)) return normalizedError("CLAIM.INVALID_COMPONENT_ID", `${instancePath}/component_id`, "claim.subject.component_id.syntax");
  if (typeof subject.scope_id !== "string" || !/^scope-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(subject.scope_id)) return normalizedError("CLAIM.INVALID_SCOPE_ID", `${instancePath}/scope_id`, "claim.subject.scope_id.syntax");
  if (!isImmutableRevision(subject.immutable_revision)) return normalizedError("CLAIM.SUBJECT_REVISION_NOT_IMMUTABLE", `${instancePath}/immutable_revision`, "claim.subject.revision.immutable");
  if (!validSha256(subject.artifact_sha256)) return normalizedError("CLAIM.SUBJECT_HASH_INVALID", `${instancePath}/artifact_sha256`, "claim.subject.hash.sha256");
  return null;
}

function validateFreshness(freshness, instancePath, asOfMilliseconds) {
  const fields = ["observed_at_utc", "expires_at_utc", "revalidation_triggers"];
  let issue = objectShape(freshness, fields, fields, instancePath, "claim.freshness");
  if (issue) return { issue };
  issue = timestampCheck(freshness.observed_at_utc, `${instancePath}/observed_at_utc`, "claim.freshness.observed.utc_ms");
  if (issue) return { issue };
  issue = timestampCheck(freshness.expires_at_utc, `${instancePath}/expires_at_utc`, "claim.freshness.expires.utc_ms");
  if (issue) return { issue };
  const observed = Date.parse(freshness.observed_at_utc);
  const expires = Date.parse(freshness.expires_at_utc);
  if (expires <= observed) return { issue: normalizedError("CLAIM.INVALID_FRESHNESS_WINDOW", `${instancePath}/expires_at_utc`, "claim.freshness.expires_after_observed") };
  if (!sameStringSet(freshness.revalidation_triggers, REQUIRED_REVALIDATION_TRIGGERS)) return { issue: normalizedError("CLAIM.REVALIDATION_TRIGGERS_INCOMPLETE", `${instancePath}/revalidation_triggers`, "claim.freshness.triggers.complete") };
  return {
    current: observed <= asOfMilliseconds && asOfMilliseconds < expires,
    state: asOfMilliseconds < observed ? "evidence_not_yet_current" : asOfMilliseconds >= expires ? "evidence_expired" : "current",
  };
}

function validateEvidence(evidence, subject, instancePath, asOfMilliseconds) {
  const fields = ["level", "source_refs", "basis_codes", "pending_requirements", "limitations", "freshness"];
  let issue = objectShape(evidence, fields, fields, instancePath, "claim.evidence");
  if (issue) return { issue };
  const levels = new Set(["proven", "inferred", "poc_pending", "experimental"]);
  if (!levels.has(evidence.level)) return { issue: normalizedError("CLAIM.UNKNOWN_EVIDENCE_LEVEL", `${instancePath}/level`, "claim.evidence.level.known") };
  if (!Array.isArray(evidence.source_refs)) return { issue: normalizedError("CONTRACT.INVALID_SHAPE", `${instancePath}/source_refs`, "claim.evidence.sources.array") };
  issue = stringArray(evidence.basis_codes, `${instancePath}/basis_codes`, { allowEmpty: evidence.level === "poc_pending" });
  if (issue) return { issue };
  issue = stringArray(evidence.pending_requirements, `${instancePath}/pending_requirements`, { allowEmpty: evidence.level === "proven" });
  if (issue) return { issue };
  issue = stringArray(evidence.limitations, `${instancePath}/limitations`, { allowEmpty: evidence.level === "proven" });
  if (issue) return { issue };

  const sourceIds = new Set();
  const resolvedSources = [];
  for (let index = 0; index < evidence.source_refs.length; index += 1) {
    const sourcePath = `${instancePath}/source_refs/${index}`;
    const resolution = validateSourceReference(evidence.source_refs[index], sourcePath, new Set(["repeatable_test", "accepted_poc", "reasoned_analysis", "immutable_upstream", "license_obligation_extract"]));
    if (resolution.issue) return resolution;
    if (sourceIds.has(evidence.source_refs[index].source_id)) return { issue: normalizedError("CLAIM.DUPLICATE_SOURCE_ID", `${sourcePath}/source_id`, "claim.evidence.source_ids.unique") };
    sourceIds.add(evidence.source_refs[index].source_id);
    if (["repeatable_test", "accepted_poc"].includes(resolution.source.source_kind)) issue = validateDirectSourceDocument(resolution.source, sourcePath);
    else if (["reasoned_analysis", "immutable_upstream"].includes(resolution.source.source_kind)) issue = validateAnalysisSourceDocument(resolution.source, sourcePath);
    else issue = validateObligationSourceDocument(resolution.source, sourcePath);
    if (issue) return { issue };
    if (!resolution.source.component_ids.includes(subject.component_id)) return { issue: normalizedError("CLAIM.SOURCE_COMPONENT_SCOPE_MISMATCH", sourcePath, "claim.evidence.source.component_exact") };
    if (!resolution.source.scope_ids.includes(subject.scope_id)) return { issue: normalizedError("CLAIM.SOURCE_SCOPE_MISMATCH", sourcePath, "claim.evidence.source.scope_exact") };
    resolvedSources.push(resolution.source);
  }

  const qualifyingProof = resolvedSources.some((source) => ["repeatable_test", "accepted_poc"].includes(source.source_kind) && source.repeatable === true && source.pass_count >= 2 && source.pass_count === source.attempt_count);
  const directObservation = resolvedSources.some((source) => ["repeatable_test", "accepted_poc"].includes(source.source_kind) && source.pass_count >= 1);
  if (evidence.level === "proven" && !qualifyingProof) return { issue: normalizedError("CLAIM.PROVEN_REQUIRES_REPEATABLE_SOURCE", `${instancePath}/source_refs`, "claim.evidence.proven.repeatable_direct") };
  if (evidence.level === "inferred" && resolvedSources.length === 0) return { issue: normalizedError("CLAIM.INFERRED_REQUIRES_SOURCE", `${instancePath}/source_refs`, "claim.evidence.inferred.source_required") };
  if (evidence.level === "poc_pending" && evidence.pending_requirements.length === 0) return { issue: normalizedError("CLAIM.POC_PENDING_REQUIRES_PLAN", `${instancePath}/pending_requirements`, "claim.evidence.poc_pending.plan_required") };
  if (evidence.level === "experimental" && !directObservation) return { issue: normalizedError("CLAIM.EXPERIMENTAL_REQUIRES_DIRECT_SOURCE", `${instancePath}/source_refs`, "claim.evidence.experimental.direct") };
  if (evidence.level === "experimental" && (evidence.limitations.length === 0 || evidence.pending_requirements.length === 0)) return { issue: normalizedError("CLAIM.EXPERIMENTAL_SCOPE_REQUIRED", instancePath, "claim.evidence.experimental.limits_and_plan") };
  const freshnessResult = validateFreshness(evidence.freshness, `${instancePath}/freshness`, asOfMilliseconds);
  if (freshnessResult.issue) return freshnessResult;
  return { ...freshnessResult, qualifyingProof, directObservation, sourceMissing: evidence.source_refs.length === 0, resolvedSources };
}

function validateObligationSourceDocument(source, instancePath) {
  if (!Array.isArray(source.component_ids) || source.component_ids.length === 0 || source.component_ids.some((value) => typeof value !== "string")) return normalizedError("CLAIM.SOURCE_COMPONENT_INVALID", instancePath, "claim.source.component.nonempty");
  if (!Array.isArray(source.scope_ids) || source.scope_ids.length === 0 || source.scope_ids.some((value) => typeof value !== "string")) return normalizedError("CLAIM.SOURCE_SCOPE_INVALID", instancePath, "claim.source.scope.nonempty");
  if (!Array.isArray(source.obligations) || source.obligations.length === 0) return normalizedError("CLAIM.OBLIGATION_SOURCE_INVALID", `${instancePath}/obligations`, "claim.obligation_source.nonempty");
  const fields = ["component_id", "clause_id", "statement_code", "wording_fragment", "source_text_sha256", "source_modality", "condition_code", "upstream_locator", "upstream_revision"];
  const modalities = new Set(["declarative", "encouraged", "must", "must_when_condition", "prohibited", "permitted", "optional"]);
  const identities = new Set();
  for (let index = 0; index < source.obligations.length; index += 1) {
    const obligation = source.obligations[index];
    const obligationPath = `${instancePath}/obligations/${index}`;
    let issue = objectShape(obligation, fields, fields, obligationPath, "claim.obligation_source.entry");
    if (issue) return issue;
    const identity = `${obligation.component_id}\u0000${obligation.clause_id}`;
    if (identities.has(identity)) return normalizedError("CLAIM.DUPLICATE_OBLIGATION_IDENTITY", `${obligationPath}/clause_id`, "claim.obligation_source.identity.unique");
    identities.add(identity);
    if (!source.component_ids.includes(obligation.component_id)) return normalizedError("CLAIM.OBLIGATION_COMPONENT_SCOPE_MISMATCH", `${obligationPath}/component_id`, "claim.obligation_source.component_declared");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(obligation.component_id) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(obligation.clause_id)) return normalizedError("CLAIM.OBLIGATION_IDENTITY_INVALID", obligationPath, "claim.obligation_source.identity.syntax");
    if (!/^[a-z][a-z0-9_]{2,127}$/.test(obligation.statement_code) || !/^[a-z][a-z0-9_]{2,127}$/.test(obligation.condition_code)) return normalizedError("CLAIM.INVALID_REASON_CODE", obligationPath, "claim.obligation_source.codes.syntax");
    if (typeof obligation.wording_fragment !== "string" || obligation.wording_fragment.length < 3 || sha256Bytes(Buffer.from(obligation.wording_fragment, "utf8")) !== obligation.source_text_sha256) return normalizedError("CLAIM.OBLIGATION_WORDING_HASH_INVALID", `${obligationPath}/source_text_sha256`, "claim.obligation_source.wording_hash.exact");
    if (!modalities.has(obligation.source_modality)) return normalizedError("CLAIM.UNKNOWN_SOURCE_MODALITY", `${obligationPath}/source_modality`, "claim.obligation_source.modality.known");
    if (!isImmutableRevision(obligation.upstream_revision) || typeof obligation.upstream_locator !== "string" || !/^https:\/\/huggingface\.co\//.test(obligation.upstream_locator) || !obligation.upstream_locator.includes(obligation.upstream_revision.slice(4))) return normalizedError("CLAIM.OBLIGATION_UPSTREAM_NOT_PINNED", `${obligationPath}/upstream_revision`, "claim.obligation_source.upstream.immutable") ;
  }
  return null;
}

function validateSourceAssertion(assertion, record, evidenceResult, instancePath) {
  const fields = ["source_id", "clause_id", "source_text_sha256", "statement_code", "asserted_modality", "condition_code"];
  let issue = objectShape(assertion, fields, fields, instancePath, "claim.source_assertion");
  if (issue) return issue;
  const source = evidenceResult.resolvedSources.find((candidate) => candidate.source_id === assertion.source_id && candidate.source_kind === "license_obligation_extract");
  if (!source) return normalizedError("CLAIM.OBLIGATION_SOURCE_UNRESOLVED", `${instancePath}/source_id`, "claim.obligation.source_ref.bound");
  const exact = source.obligations.find((entry) => entry.component_id === record.subject.component_id && entry.clause_id === assertion.clause_id);
  if (!exact) {
    const otherComponent = source.obligations.some((entry) => entry.clause_id === assertion.clause_id);
    return normalizedError(otherComponent ? "CLAIM.OBLIGATION_COMPONENT_SCOPE_MISMATCH" : "CLAIM.OBLIGATION_CLAUSE_UNRESOLVED", `${instancePath}/clause_id`, otherComponent ? "claim.obligation.component_exact" : "claim.obligation.clause.resolved");
  }
  if (assertion.source_text_sha256 !== exact.source_text_sha256) return normalizedError("CLAIM.OBLIGATION_WORDING_MISMATCH", `${instancePath}/source_text_sha256`, "claim.obligation.wording.exact");
  if (assertion.statement_code !== exact.statement_code) return normalizedError("CLAIM.OBLIGATION_STATEMENT_MISMATCH", `${instancePath}/statement_code`, "claim.obligation.statement.exact");
  if (assertion.asserted_modality !== exact.source_modality) return normalizedError("CLAIM.OBLIGATION_MODALITY_MISMATCH", `${instancePath}/asserted_modality`, "claim.obligation.modality.exact_no_promotion_or_weakening");
  if (assertion.condition_code !== exact.condition_code) return normalizedError("CLAIM.OBLIGATION_CONDITION_MISMATCH", `${instancePath}/condition_code`, "claim.obligation.condition.exact");
  return null;
}

function validateGateCatalog(source, instancePath) {
  if (!Array.isArray(source.requirements)) return normalizedError("CLAIM.GATE_CATALOG_INVALID", instancePath, "claim.gate_catalog.requirements.array");
  const seen = new Set();
  for (let index = 0; index < source.requirements.length; index += 1) {
    const item = source.requirements[index];
    const itemPath = `${instancePath}/requirements/${index}`;
    const fields = ["requirement_key", "scope_id", "required_gates"];
    let issue = objectShape(item, fields, fields, itemPath, "claim.gate_catalog.requirement");
    if (issue) return issue;
    if (seen.has(item.requirement_key)) return normalizedError("CLAIM.DUPLICATE_GATE_REQUIREMENT", `${itemPath}/requirement_key`, "claim.gate_catalog.requirement.unique");
    seen.add(item.requirement_key);
    if (!Array.isArray(item.required_gates)) return normalizedError("CLAIM.GATE_CATALOG_INVALID", `${itemPath}/required_gates`, "claim.gate_catalog.gates.array");
    const gateIds = new Set();
    for (let gateIndex = 0; gateIndex < item.required_gates.length; gateIndex += 1) {
      const gate = item.required_gates[gateIndex];
      issue = objectShape(gate, ["gate_id", "gate_type"], ["gate_id", "gate_type"], `${itemPath}/required_gates/${gateIndex}`, "claim.gate_catalog.gate");
      if (issue) return issue;
      if (gateIds.has(gate.gate_id)) return normalizedError("CLAIM.DUPLICATE_GATE_ID", `${itemPath}/required_gates/${gateIndex}/gate_id`, "claim.gate_catalog.gate.unique");
      gateIds.add(gate.gate_id);
    }
  }
  return null;
}

function validateDecisionReference(reference, instancePath, expectedKind) {
  const fields = [...SOURCE_REF_FIELDS, "decision_id"];
  let issue = objectShape(reference, fields, fields, instancePath, "claim.decision_ref");
  if (issue) return { issue };
  const commonReference = Object.fromEntries(SOURCE_REF_FIELDS.map((field) => [field, reference[field]]));
  const resolution = validateSourceReference(commonReference, instancePath, new Set([expectedKind]));
  if (resolution.issue) return resolution;
  if (typeof reference.decision_id !== "string" || !/^DEC-[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(reference.decision_id)) return { issue: normalizedError("CLAIM.INVALID_DECISION_ID", `${instancePath}/decision_id`, "claim.decision.id.syntax") };
  return resolution;
}

function validateGateDecisionPack(source, instancePath) {
  if (!Array.isArray(source.decisions)) return normalizedError("CLAIM.GATE_DECISION_PACK_INVALID", instancePath, "claim.gate_decision_pack.array");
  const seen = new Set();
  const fields = ["decision_id", "gate_id", "gate_type", "requirement_keys", "owner_type", "state", "decided_at_utc", "expires_at_utc"];
  for (let index = 0; index < source.decisions.length; index += 1) {
    const item = source.decisions[index];
    const itemPath = `${instancePath}/decisions/${index}`;
    let issue = objectShape(item, fields, fields, itemPath, "claim.gate_decision");
    if (issue) return issue;
    if (seen.has(item.decision_id)) return normalizedError("CLAIM.DUPLICATE_DECISION_ID", `${itemPath}/decision_id`, "claim.gate_decision.id.unique");
    seen.add(item.decision_id);
    if (!Array.isArray(item.requirement_keys) || item.requirement_keys.length === 0 || item.requirement_keys.some((value) => typeof value !== "string")) return normalizedError("CLAIM.GATE_DECISION_SCOPE_INVALID", `${itemPath}/requirement_keys`, "claim.gate_decision.scope.nonempty");
    issue = timestampCheck(item.decided_at_utc, `${itemPath}/decided_at_utc`, "claim.gate_decision.decided.utc_ms"); if (issue) return issue;
    issue = timestampCheck(item.expires_at_utc, `${itemPath}/expires_at_utc`, "claim.gate_decision.expires.utc_ms"); if (issue) return issue;
    if (Date.parse(item.expires_at_utc) <= Date.parse(item.decided_at_utc)) return normalizedError("CLAIM.GATE_DECISION_WINDOW_INVALID", `${itemPath}/expires_at_utc`, "claim.gate_decision.expires_after_decision");
  }
  return null;
}

function validateGateRequirements(gateRequirements, subject, instancePath, asOfMilliseconds) {
  const fields = ["requirement_key", "requirements_source_ref", "complete", "gates"];
  let issue = objectShape(gateRequirements, fields, fields, instancePath, "claim.gate_requirements");
  if (issue) return { issue };
  if (typeof gateRequirements.requirement_key !== "string" || !/^req-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(gateRequirements.requirement_key)) return { issue: normalizedError("CLAIM.INVALID_REQUIREMENT_KEY", `${instancePath}/requirement_key`, "claim.gates.requirement_key.syntax") };
  if (typeof gateRequirements.complete !== "boolean") return { issue: normalizedError("CONTRACT.INVALID_SHAPE", `${instancePath}/complete`, "claim.gates.complete.boolean") };
  if (!Array.isArray(gateRequirements.gates)) return { issue: normalizedError("CONTRACT.INVALID_SHAPE", `${instancePath}/gates`, "claim.gates.array") };
  const catalogResolution = validateSourceReference(gateRequirements.requirements_source_ref, `${instancePath}/requirements_source_ref`, new Set(["gate_catalog"]));
  if (catalogResolution.issue) return catalogResolution;
  issue = validateGateCatalog(catalogResolution.source, `${instancePath}/requirements_source_ref`);
  if (issue) return { issue };
  const expected = catalogResolution.source.requirements.find((item) => item.requirement_key === gateRequirements.requirement_key && item.scope_id === subject.scope_id);
  if (!expected) return { issue: normalizedError("CLAIM.GATE_REQUIREMENT_UNRESOLVED", `${instancePath}/requirement_key`, "claim.gates.requirement_scope.resolved") };
  const expectedPairs = expected.required_gates.map((gate) => `${gate.gate_id}\u0000${gate.gate_type}`).sort();
  const actualPairs = gateRequirements.gates.map((gate) => `${gate?.gate_id}\u0000${gate?.gate_type}`).sort();
  if (expectedPairs.join("\u0001") !== actualPairs.join("\u0001")) return { issue: normalizedError("CLAIM.GATE_SET_MISMATCH", `${instancePath}/gates`, "claim.gates.catalog_exact") };

  const gateStates = [];
  const seenGateIds = new Set();
  for (let index = 0; index < gateRequirements.gates.length; index += 1) {
    const gate = gateRequirements.gates[index];
    const gatePath = `${instancePath}/gates/${index}`;
    const allowed = ["gate_id", "gate_type", "state", "decision_ref"];
    issue = objectShape(gate, allowed, ["gate_id", "gate_type", "state"], gatePath, "claim.gate");
    if (issue) return { issue };
    if (seenGateIds.has(gate.gate_id)) return { issue: normalizedError("CLAIM.DUPLICATE_GATE_ID", `${gatePath}/gate_id`, "claim.gates.id.unique") };
    seenGateIds.add(gate.gate_id);
    if (!/^(?:EXT|HUM)-[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(gate.gate_id)) return { issue: normalizedError("CLAIM.INVALID_GATE_ID", `${gatePath}/gate_id`, "claim.gate.id.syntax") };
    if (!new Set(["human", "external"]).has(gate.gate_type)) return { issue: normalizedError("CLAIM.UNKNOWN_GATE_TYPE", `${gatePath}/gate_type`, "claim.gate.type.known") };
    if (!new Set(["open", "partial", "closed"]).has(gate.state)) return { issue: normalizedError("CLAIM.UNKNOWN_GATE_STATE", `${gatePath}/state`, "claim.gate.state.known") };
    if (gate.state !== "closed") {
      if ("decision_ref" in gate) return { issue: normalizedError("CLAIM.NONCLOSED_GATE_HAS_DECISION", `${gatePath}/decision_ref`, "claim.gate.nonclosed.no_decision") };
      gateStates.push(gate.state === "open" ? "gate_open" : "gate_partial");
      continue;
    }
    if (!("decision_ref" in gate)) return { issue: normalizedError("CONTRACT.MISSING_FIELD", `${gatePath}/decision_ref`, "claim.gate.closed.decision_ref.required") };
    const decisionResolution = validateDecisionReference(gate.decision_ref, `${gatePath}/decision_ref`, "gate_decision_pack");
    if (decisionResolution.issue) return decisionResolution;
    issue = validateGateDecisionPack(decisionResolution.source, `${gatePath}/decision_ref`);
    if (issue) return { issue };
    const decision = decisionResolution.source.decisions.find((item) => item.decision_id === gate.decision_ref.decision_id);
    if (!decision) return { issue: normalizedError("CLAIM.GATE_DECISION_UNRESOLVED", `${gatePath}/decision_ref/decision_id`, "claim.gate.decision.resolved") };
    if (decision.gate_id !== gate.gate_id || decision.gate_type !== gate.gate_type || !decision.requirement_keys.includes(gateRequirements.requirement_key) || decision.state !== "closed") return { issue: normalizedError("CLAIM.GATE_DECISION_SCOPE_MISMATCH", `${gatePath}/decision_ref/decision_id`, "claim.gate.decision.scope_exact") };
    const expectedOwner = gate.gate_type === "human" ? "human_owner" : "external_owner";
    if (decision.owner_type !== expectedOwner) return { issue: normalizedError("CLAIM.GATE_DECISION_NOT_INDEPENDENT", `${gatePath}/decision_ref/decision_id`, "claim.gate.decision.non_agent_owner") };
    if (asOfMilliseconds < Date.parse(decision.decided_at_utc) || asOfMilliseconds >= Date.parse(decision.expires_at_utc)) gateStates.push("gate_decision_expired");
  }
  return { complete: gateRequirements.complete, gateStates: [...new Set(gateStates)] };
}

function validateRevocationPack(source, instancePath) {
  if (!Array.isArray(source.revocations)) return normalizedError("CLAIM.REVOCATION_PACK_INVALID", instancePath, "claim.revocation_pack.array");
  const fields = ["decision_id", "claim_id", "action", "owner_type", "effective_at_utc", "downgrade_to", "reason_code"];
  const seen = new Set();
  for (let index = 0; index < source.revocations.length; index += 1) {
    const item = source.revocations[index];
    const itemPath = `${instancePath}/revocations/${index}`;
    let issue = objectShape(item, fields, fields, itemPath, "claim.revocation_decision");
    if (issue) return issue;
    if (seen.has(item.decision_id)) return normalizedError("CLAIM.DUPLICATE_DECISION_ID", `${itemPath}/decision_id`, "claim.revocation_decision.id.unique");
    seen.add(item.decision_id);
    issue = timestampCheck(item.effective_at_utc, `${itemPath}/effective_at_utc`, "claim.revocation.effective.utc_ms"); if (issue) return issue;
  }
  return null;
}

function validateLifecycle(lifecycle, claimId, instancePath, asOfMilliseconds) {
  const activeFields = ["state", "effective_at_utc", "reason_code"];
  const revokedFields = [...activeFields, "decision_ref"];
  if (!isPlainObject(lifecycle) || !new Set(["active", "revoked"]).has(lifecycle.state)) return { issue: normalizedError("CLAIM.UNKNOWN_LIFECYCLE_STATE", `${instancePath}/state`, "claim.lifecycle.state.known") };
  const fields = lifecycle.state === "active" ? activeFields : revokedFields;
  let issue = objectShape(lifecycle, fields, fields, instancePath, "claim.lifecycle");
  if (issue) return { issue };
  issue = timestampCheck(lifecycle.effective_at_utc, `${instancePath}/effective_at_utc`, "claim.lifecycle.effective.utc_ms");
  if (issue) return { issue };
  if (Date.parse(lifecycle.effective_at_utc) > asOfMilliseconds) return { issue: normalizedError("CLAIM.LIFECYCLE_NOT_YET_EFFECTIVE", `${instancePath}/effective_at_utc`, "claim.lifecycle.effective.not_future") };
  if (typeof lifecycle.reason_code !== "string" || !/^[a-z0-9][a-z0-9_]{1,127}$/.test(lifecycle.reason_code)) return { issue: normalizedError("CLAIM.INVALID_REASON_CODE", `${instancePath}/reason_code`, "claim.lifecycle.reason.syntax") };
  if (lifecycle.state === "active") return { revoked: false };
  const resolution = validateDecisionReference(lifecycle.decision_ref, `${instancePath}/decision_ref`, "revocation_decision_pack");
  if (resolution.issue) return resolution;
  issue = validateRevocationPack(resolution.source, `${instancePath}/decision_ref`);
  if (issue) return { issue };
  const decision = resolution.source.revocations.find((item) => item.decision_id === lifecycle.decision_ref.decision_id);
  if (!decision) return { issue: normalizedError("CLAIM.REVOCATION_DECISION_UNRESOLVED", `${instancePath}/decision_ref/decision_id`, "claim.revocation.decision.resolved") };
  if (decision.claim_id !== claimId || decision.action !== "revoke" || decision.downgrade_to !== "poc_pending" || !new Set(["human_owner", "governance_owner"]).has(decision.owner_type) || decision.effective_at_utc !== lifecycle.effective_at_utc) return { issue: normalizedError("CLAIM.REVOCATION_DECISION_MISMATCH", `${instancePath}/decision_ref/decision_id`, "claim.revocation.decision.scope_exact") };
  return { revoked: true };
}

function validateDowngradePolicy(policy, instancePath) {
  const fields = Object.keys(DOWNGRADE_POLICY);
  let issue = objectShape(policy, fields, fields, instancePath, "claim.downgrade_policy");
  if (issue) return issue;
  if (!exactObject(policy, DOWNGRADE_POLICY)) return normalizedError("CLAIM.UNSAFE_DOWNGRADE_POLICY", instancePath, "claim.downgrade_policy.fail_closed_exact");
  return null;
}

function validateExperimentalControls(controls, instancePath) {
  const fields = ["surface", "default_enabled", "disclosure_code", "fallback_code"];
  let issue = objectShape(controls, fields, fields, instancePath, "claim.experimental_controls");
  if (issue) return issue;
  if (controls.surface !== "advanced_only" || controls.default_enabled !== false || controls.disclosure_code !== "experimental_not_stable" || controls.fallback_code !== "withdraw_claim") return normalizedError("CLAIM.EXPERIMENTAL_CONTROLS_UNSAFE", instancePath, "claim.experimental.public_controls_exact");
  return null;
}

function validateEligibilityShape(eligibility, instancePath) {
  const fields = ["stable_eligible", "public_claim_eligible", "public_tier", "stable_blockers", "public_blockers"];
  let issue = objectShape(eligibility, fields, fields, instancePath, "claim.eligibility");
  if (issue) return issue;
  if (typeof eligibility.stable_eligible !== "boolean") return normalizedError("CONTRACT.INVALID_SHAPE", `${instancePath}/stable_eligible`, "claim.eligibility.stable.boolean");
  if (typeof eligibility.public_claim_eligible !== "boolean") return normalizedError("CONTRACT.INVALID_SHAPE", `${instancePath}/public_claim_eligible`, "claim.eligibility.public.boolean");
  if (!new Set(["none", "stable", "experimental"]).has(eligibility.public_tier)) return normalizedError("CLAIM.UNKNOWN_PUBLIC_TIER", `${instancePath}/public_tier`, "claim.eligibility.public_tier.known");
  issue = stringArray(eligibility.stable_blockers, `${instancePath}/stable_blockers`, { allowEmpty: true }); if (issue) return issue;
  issue = stringArray(eligibility.public_blockers, `${instancePath}/public_blockers`, { allowEmpty: true }); if (issue) return issue;
  return null;
}

function expectedEligibility(record, evidenceResult, gateResult, lifecycleResult) {
  const lifecycleBlockers = lifecycleResult.revoked ? ["claim_revoked"] : [];
  const freshnessBlockers = evidenceResult.current ? [] : [evidenceResult.state];
  const sourceBlockers = evidenceResult.sourceMissing ? ["evidence_missing"] : [];
  const stableLevelBlockers = record.evidence.level === "proven" ? [] : [`evidence_level_${record.evidence.level}`];
  const publicLevelBlockers = new Set(["proven", "experimental"]).has(record.evidence.level) ? [] : [`evidence_level_${record.evidence.level}`];
  const gateBlockers = [
    ...(gateResult.complete ? [] : ["gate_requirements_incomplete"]),
    ...gateResult.gateStates,
  ];
  const stableBlockers = [...lifecycleBlockers, ...freshnessBlockers, ...sourceBlockers, ...stableLevelBlockers, ...gateBlockers];
  const publicBlockers = [...lifecycleBlockers, ...freshnessBlockers, ...sourceBlockers, ...publicLevelBlockers, ...gateBlockers];
  const stableEligible = stableBlockers.length === 0;
  const publicEligible = publicBlockers.length === 0;
  const publicTier = publicEligible ? (record.evidence.level === "experimental" ? "experimental" : "stable") : "none";
  return { stableEligible, publicEligible, publicTier, stableBlockers, publicBlockers };
}

function validateRecord(record, index, asOfMilliseconds) {
  const prefix = `/records/${index}`;
  const fields = ["claim_id", "claim_code", "subject", "evidence", "source_assertion", "gate_requirements", "lifecycle", "downgrade_policy", "experimental_controls", "eligibility"];
  const required = fields.filter((field) => !["source_assertion", "experimental_controls"].includes(field));
  let issue = objectShape(record, fields, required, prefix, "claim.record");
  if (issue) return issue;
  if (typeof record.claim_id !== "string" || !/^CLAIM-[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(record.claim_id)) return normalizedError("CLAIM.INVALID_CLAIM_ID", `${prefix}/claim_id`, "claim.id.syntax");
  if (typeof record.claim_code !== "string" || !/^[a-z][a-z0-9_]{2,127}$/.test(record.claim_code)) return normalizedError("CLAIM.INVALID_CLAIM_CODE", `${prefix}/claim_code`, "claim.code.syntax");
  issue = validateSubject(record.subject, `${prefix}/subject`); if (issue) return issue;
  const evidenceResult = validateEvidence(record.evidence, record.subject, `${prefix}/evidence`, asOfMilliseconds); if (evidenceResult.issue) return evidenceResult.issue;
  if (record.subject.kind === "license_obligation") {
    if (!("source_assertion" in record)) return normalizedError("CONTRACT.MISSING_FIELD", `${prefix}/source_assertion`, "claim.obligation.source_assertion.required");
    issue = validateSourceAssertion(record.source_assertion, record, evidenceResult, `${prefix}/source_assertion`); if (issue) return issue;
  } else if ("source_assertion" in record) return normalizedError("CLAIM.SOURCE_ASSERTION_WRONG_SUBJECT", `${prefix}/source_assertion`, "claim.obligation.subject_kind.exact");
  const gateResult = validateGateRequirements(record.gate_requirements, record.subject, `${prefix}/gate_requirements`, asOfMilliseconds); if (gateResult.issue) return gateResult.issue;
  const lifecycleResult = validateLifecycle(record.lifecycle, record.claim_id, `${prefix}/lifecycle`, asOfMilliseconds); if (lifecycleResult.issue) return lifecycleResult.issue;
  issue = validateDowngradePolicy(record.downgrade_policy, `${prefix}/downgrade_policy`); if (issue) return issue;
  if (record.evidence.level === "experimental") {
    if (!("experimental_controls" in record)) return normalizedError("CONTRACT.MISSING_FIELD", `${prefix}/experimental_controls`, "claim.experimental.controls.required");
    issue = validateExperimentalControls(record.experimental_controls, `${prefix}/experimental_controls`); if (issue) return issue;
  } else if ("experimental_controls" in record) return normalizedError("CLAIM.EXPERIMENTAL_CONTROLS_WRONG_LEVEL", `${prefix}/experimental_controls`, "claim.experimental.controls.level_exact");
  issue = validateEligibilityShape(record.eligibility, `${prefix}/eligibility`); if (issue) return issue;

  if (record.eligibility.stable_eligible) {
    if (record.evidence.level !== "proven") return normalizedError("CLAIM.STABLE_REQUIRES_PROVEN", `${prefix}/evidence/level`, "claim.eligibility.stable.proven");
    if (!evidenceResult.current) return normalizedError("CLAIM.STABLE_REQUIRES_CURRENT_EVIDENCE", `${prefix}/evidence/freshness/expires_at_utc`, "claim.eligibility.stable.current");
    if (lifecycleResult.revoked) return normalizedError("CLAIM.STABLE_FORBIDDEN_WHEN_REVOKED", `${prefix}/lifecycle/state`, "claim.eligibility.stable.active");
    if (!gateResult.complete) return normalizedError("CLAIM.STABLE_REQUIRES_COMPLETE_GATE_SET", `${prefix}/gate_requirements/complete`, "claim.eligibility.stable.gates_complete");
    if (gateResult.gateStates.includes("gate_open") || gateResult.gateStates.includes("gate_partial")) return normalizedError("CLAIM.STABLE_REQUIRES_CLOSED_GATES", `${prefix}/gate_requirements/gates`, "claim.eligibility.stable.gates_closed");
    if (gateResult.gateStates.includes("gate_decision_expired")) return normalizedError("CLAIM.STABLE_REQUIRES_CURRENT_GATE_DECISIONS", `${prefix}/gate_requirements/gates`, "claim.eligibility.stable.gate_decisions_current");
  }
  if (record.eligibility.public_claim_eligible) {
    if (!new Set(["proven", "experimental"]).has(record.evidence.level)) return normalizedError("CLAIM.PUBLIC_REQUIRES_PROVEN_OR_EXPERIMENTAL", `${prefix}/evidence/level`, "claim.eligibility.public.level");
    if (!evidenceResult.current) return normalizedError("CLAIM.PUBLIC_REQUIRES_CURRENT_EVIDENCE", `${prefix}/evidence/freshness/expires_at_utc`, "claim.eligibility.public.current");
    if (lifecycleResult.revoked) return normalizedError("CLAIM.PUBLIC_FORBIDDEN_WHEN_REVOKED", `${prefix}/lifecycle/state`, "claim.eligibility.public.active");
    if (!gateResult.complete) return normalizedError("CLAIM.PUBLIC_REQUIRES_COMPLETE_GATE_SET", `${prefix}/gate_requirements/complete`, "claim.eligibility.public.gates_complete");
    if (gateResult.gateStates.includes("gate_open") || gateResult.gateStates.includes("gate_partial")) return normalizedError("CLAIM.PUBLIC_REQUIRES_CLOSED_GATES", `${prefix}/gate_requirements/gates`, "claim.eligibility.public.gates_closed");
    if (gateResult.gateStates.includes("gate_decision_expired")) return normalizedError("CLAIM.PUBLIC_REQUIRES_CURRENT_GATE_DECISIONS", `${prefix}/gate_requirements/gates`, "claim.eligibility.public.gate_decisions_current");
  }

  const expected = expectedEligibility(record, evidenceResult, gateResult, lifecycleResult);
  if (record.eligibility.stable_eligible !== expected.stableEligible) return normalizedError("CLAIM.ELIGIBILITY_ASSERTION_MISMATCH", `${prefix}/eligibility/stable_eligible`, "claim.eligibility.stable.derived");
  if (record.eligibility.public_claim_eligible !== expected.publicEligible) return normalizedError("CLAIM.ELIGIBILITY_ASSERTION_MISMATCH", `${prefix}/eligibility/public_claim_eligible`, "claim.eligibility.public.derived");
  if (record.eligibility.public_tier !== expected.publicTier) return normalizedError("CLAIM.PUBLIC_TIER_MISMATCH", `${prefix}/eligibility/public_tier`, "claim.eligibility.public_tier.derived");
  if (!exactObject(record.eligibility.stable_blockers, expected.stableBlockers)) return normalizedError("CLAIM.ELIGIBILITY_REASON_MISMATCH", `${prefix}/eligibility/stable_blockers`, "claim.eligibility.stable_blockers.derived");
  if (!exactObject(record.eligibility.public_blockers, expected.publicBlockers)) return normalizedError("CLAIM.ELIGIBILITY_REASON_MISMATCH", `${prefix}/eligibility/public_blockers`, "claim.eligibility.public_blockers.derived");
  return null;
}

function validateRegistry(registry, asOfMilliseconds) {
  const fields = ["contract_id", "schema_version", "document_id", "document_revision", "registry_id", "records", "integrity"];
  let issue = objectShape(registry, fields, fields, "", "claim_registry");
  if (issue) return issue;
  if (registry.contract_id !== "minimax-h3-tool.evidence-claim-registry" || registry.schema_version !== "1.0.0") return normalizedError("CONTRACT.UNKNOWN_CONTRACT", "/contract_id", "claim_registry.envelope.exact");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(registry.document_id)) return normalizedError("CONTRACT.INVALID_DOCUMENT_ID", "/document_id", "claim_registry.document_id.uuid4");
  if (registry.document_revision !== 1 || registry.registry_id !== "CLAIM-REGISTRY-SYNTH-001") return normalizedError("CONTRACT.INVALID_ENVELOPE", "/registry_id", "claim_registry.identity.exact");
  issue = objectShape(registry.integrity, ["profile", "content_sha256"], ["profile", "content_sha256"], "/integrity", "claim_registry.integrity");
  if (issue) return issue;
  if (registry.integrity.profile !== "rfc8785-sha256-v1" || registry.integrity.content_sha256 !== contentHash(registry)) return normalizedError("CONTRACT.INTEGRITY_MISMATCH", "/integrity/content_sha256", "claim_registry.integrity.jcs_sha256");
  if (!Array.isArray(registry.records) || registry.records.length === 0) return normalizedError("CONTRACT.INVALID_SHAPE", "/records", "claim_registry.records.nonempty_array");
  const claimIds = new Set();
  for (let index = 0; index < registry.records.length; index += 1) {
    const claimId = registry.records[index]?.claim_id;
    if (claimIds.has(claimId)) return normalizedError("CLAIM.DUPLICATE_CLAIM_ID", `/records/${index}/claim_id`, "claim_registry.claim_id.unique");
    claimIds.add(claimId);
    issue = validateRecord(registry.records[index], index, asOfMilliseconds);
    if (issue) return issue;
  }
  return null;
}

function pointerParts(pointer) {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) fatal(`invalid JSON Pointer ${pointer}`);
  return pointer.slice(1).split("/").map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function atPointer(document, pointer) {
  let current = document;
  for (const part of pointerParts(pointer)) {
    if (!isPlainObject(current) && !Array.isArray(current)) fatal(`fixture pointer not traversable: ${pointer}`);
    if (!(part in current)) fatal(`fixture pointer not found: ${pointer}`);
    current = current[part];
  }
  return current;
}

function parentAtPointer(document, pointer) {
  const parts = pointerParts(pointer);
  if (parts.length === 0) fatal("fixture mutation may not replace the root");
  const key = parts.pop();
  let parent = document;
  for (const part of parts) {
    if ((!isPlainObject(parent) && !Array.isArray(parent)) || !(part in parent)) fatal(`fixture pointer not found: ${pointer}`);
    parent = parent[part];
  }
  return { parent, key };
}

function mutate(document, mutation) {
  const allowed = ["op", "path", "from", "value"];
  for (const key of Object.keys(mutation)) if (!allowed.includes(key)) fatal(`unknown mutation field ${key}`);
  const { parent, key } = parentAtPointer(document, mutation.path);
  if (mutation.op === "remove") {
    if (!(key in parent)) fatal(`remove pointer not found: ${mutation.path}`);
    if (Array.isArray(parent)) parent.splice(Number(key), 1); else delete parent[key];
    return;
  }
  let value;
  if (mutation.op === "copy") value = structuredClone(atPointer(document, mutation.from));
  else if (mutation.op === "add" || mutation.op === "replace") value = structuredClone(mutation.value);
  else fatal(`unsupported mutation op ${mutation.op}`);
  if (Array.isArray(parent)) {
    if (key === "-") parent.push(value);
    else if (mutation.op === "add" || mutation.op === "copy") parent.splice(Number(key), 0, value);
    else parent[Number(key)] = value;
  } else {
    if (mutation.op === "replace" && !(key in parent)) fatal(`replace pointer not found: ${mutation.path}`);
    parent[key] = value;
  }
}

function validateCaseShape(testCase, fileName) {
  const fields = ["fixture_case_version", "case_id", "mutations", "expected"];
  const issue = objectShape(testCase, fields, fields, "", "claim_fixture_case");
  if (issue) fatal(`${fileName}: invalid case shape ${canonicalJson(issue)}`);
  if (testCase.fixture_case_version !== "1.0.0" || typeof testCase.case_id !== "string" || !Array.isArray(testCase.mutations) || testCase.mutations.length === 0) fatal(`${fileName}: invalid fixture case envelope`);
  if (!isPlainObject(testCase.expected) || Object.keys(testCase.expected).sort().join("|") !== "code|instance_path|rule_id") fatal(`${fileName}: expected must be one exact normalized tuple`);
}

function sanitizePublicEvidence() {
  const files = [CONVENTION_PATH];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      else files.push(fullPath);
    }
  };
  visit(HERE);
  const privatePathPattern = /[A-Za-z]:[\\/]Users[\\/][^\\/\s"']+/i;
  const currentUser = (process.env.USERNAME ?? "").trim().toLowerCase();
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    if (privatePathPattern.test(text)) fatal(`public evidence contains a private absolute path in ${path.relative(HERE, file)}`);
    if (currentUser.length >= 3 && text.toLowerCase().includes(currentUser)) fatal(`public evidence contains the current username in ${path.relative(HERE, file)}`);
  }
  return files.length;
}

function run() {
  const asOfMilliseconds = Date.parse(FIXTURE_AS_OF_UTC);
  const registry = readJson(VALID_PATH);
  const validIssue = validateRegistry(registry, asOfMilliseconds);
  if (validIssue) fatal(`valid registry rejected: ${canonicalJson(validIssue)}`);

  const levelCounts = new Map(["proven", "inferred", "poc_pending", "experimental"].map((level) => [level, 0]));
  for (const record of registry.records) levelCounts.set(record.evidence.level, levelCounts.get(record.evidence.level) + 1);
  if ([...levelCounts.values()].some((count) => count === 0)) fatal("valid registry does not cover every evidence level");

  const caseFiles = fs.readdirSync(CASES_DIR).filter((name) => name.endsWith(".json")).sort();
  let negativeCases = 0;
  for (const fileName of caseFiles) {
    const testCase = readJson(path.join(CASES_DIR, fileName));
    validateCaseShape(testCase, fileName);
    const mutated = structuredClone(registry);
    for (const mutation of testCase.mutations) mutate(mutated, mutation);
    refreshIntegrity(mutated);
    const actual = validateRegistry(mutated, asOfMilliseconds);
    if (!actual) fatal(`${testCase.case_id}: expected rejection but registry passed`);
    if (canonicalJson(actual) !== canonicalJson(testCase.expected)) fatal(`${testCase.case_id}: expected ${canonicalJson(testCase.expected)} but observed ${canonicalJson(actual)}`);
    negativeCases += 1;
  }

  const sanitizedFiles = sanitizePublicEvidence();
  console.log(`CLAIM_VALIDATION_OK version=1.0.0 as_of=${FIXTURE_AS_OF_UTC} valid_registry=1 valid_records=${registry.records.length} levels=proven:${levelCounts.get("proven")},inferred:${levelCounts.get("inferred")},poc_pending:${levelCounts.get("poc_pending")},experimental:${levelCounts.get("experimental")} negative=${negativeCases} source_packs=${fs.readdirSync(SOURCES_DIR).filter((name) => name.endsWith(".json")).length} sanitized_files=${sanitizedFiles}`);
}

run();
