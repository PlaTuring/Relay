#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../../..");
const SCHEMA_PATH = path.join(ROOT, "schemas/alpha-recipe/1.0.0.schema.json");
const VALID_PATH = path.join(HERE, "valid/alpha0-poc-pending-recipe.json");
const CASES_DIR = path.join(HERE, "cases");
const CAP_SCHEMA_PATH = path.join(ROOT, "schemas/capability-catalog/1.0.0.schema.json");
const NODE_SCHEMA_PATH = path.join(ROOT, "schemas/node-allowlist/1.0.0.schema.json");
const COMPONENT_SCHEMA_PATH = path.join(ROOT, "schemas/component-manifest/1.0.0.schema.json");
const CAP_PATH = path.join(ROOT, "tests/fixtures/contracts/capability/valid/alpha0-t2va-capability.json");
const NODE_PATH = path.join(ROOT, "tests/fixtures/contracts/capability/valid/alpha0-local-node-allowlist.json");
const COMPONENT_PATH = path.join(ROOT, "tests/fixtures/contracts/component/valid/component-role-examples.json");

const MAX_BYTES = 16 * 1024 * 1024;
const MAX_DEPTH = 64;
const MAX_VALUES = 200_000;
const MAX_OBJECT_PROPERTIES = 10_000;
const MAX_ARRAY_ITEMS = 10_000;
const MAX_STRING_BYTES = 1024 * 1024;

function fail(message) { throw new Error(message); }

class StrictJsonParser {
  constructor(text) { this.text = text; this.pos = 0; this.values = 0; }
  parse() {
    this.skip();
    const value = this.value(0);
    this.skip();
    if (this.pos !== this.text.length) fail(`invalid JSON at byte-like offset ${this.pos}`);
    return value;
  }
  skip() { while (/[\u0009\u000a\u000d\u0020]/.test(this.text[this.pos] ?? "")) this.pos += 1; }
  count(depth) {
    if (depth > MAX_DEPTH) fail("JSON nesting exceeds 64");
    this.values += 1;
    if (this.values > MAX_VALUES) fail("JSON value count exceeds 200000");
  }
  value(depth) {
    this.count(depth);
    const ch = this.text[this.pos];
    if (ch === "{") return this.object(depth + 1);
    if (ch === "[") return this.array(depth + 1);
    if (ch === '"') return this.string();
    if (this.text.startsWith("true", this.pos)) { this.pos += 4; return true; }
    if (this.text.startsWith("false", this.pos)) { this.pos += 5; return false; }
    if (this.text.startsWith("null", this.pos)) { this.pos += 4; return null; }
    return this.integer();
  }
  string() {
    const start = this.pos++;
    while (this.pos < this.text.length) {
      const code = this.text.charCodeAt(this.pos);
      const ch = this.text[this.pos];
      if (ch === '"') {
        this.pos += 1;
        let value;
        try { value = JSON.parse(this.text.slice(start, this.pos)); } catch { fail(`invalid string at ${start}`); }
        if (Buffer.byteLength(value, "utf8") > MAX_STRING_BYTES) fail("JSON string exceeds 1 MiB");
        for (let i = 0; i < value.length; i += 1) {
          const current = value.charCodeAt(i);
          if (current >= 0xd800 && current <= 0xdbff) {
            const next = value.charCodeAt(++i);
            if (!(next >= 0xdc00 && next <= 0xdfff)) fail("unpaired high surrogate");
          } else if (current >= 0xdc00 && current <= 0xdfff) fail("unpaired low surrogate");
        }
        return value;
      }
      if (code < 0x20) fail(`unescaped control at ${this.pos}`);
      if (ch === "\\") {
        const escape = this.text[++this.pos];
        if (!'"\\/bfnrtu'.includes(escape ?? "")) fail(`invalid escape at ${this.pos}`);
        if (escape === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(this.text.slice(this.pos + 1, this.pos + 5))) fail(`invalid unicode escape at ${this.pos}`);
          this.pos += 4;
        }
      }
      this.pos += 1;
    }
    fail(`unterminated string at ${start}`);
  }
  integer() {
    const match = /^-?(?:0|[1-9][0-9]*)/.exec(this.text.slice(this.pos));
    if (!match) fail(`invalid JSON value at ${this.pos}`);
    if (match[0] === "-0") fail(`negative zero at ${this.pos}`);
    const end = this.pos + match[0].length;
    if (/[.eE]/.test(this.text[end] ?? "")) fail(`non-integer at ${this.pos}`);
    const value = Number(match[0]);
    if (!Number.isSafeInteger(value)) fail(`unsafe integer at ${this.pos}`);
    this.pos = end;
    return value;
  }
  object(depth) {
    const out = {};
    const keys = new Set();
    this.pos += 1; this.skip();
    if (this.text[this.pos] === "}") { this.pos += 1; return out; }
    while (true) {
      if (this.text[this.pos] !== '"') fail(`object key required at ${this.pos}`);
      const key = this.string();
      if (Buffer.byteLength(key, "utf8") > 128) fail("JSON key exceeds 128 bytes");
      if (keys.has(key)) fail(`duplicate JSON key at ${this.pos}`);
      keys.add(key);
      if (keys.size > MAX_OBJECT_PROPERTIES) fail("object property count exceeds 10000");
      this.skip(); if (this.text[this.pos++] !== ":") fail(`missing colon at ${this.pos - 1}`); this.skip();
      out[key] = this.value(depth); this.skip();
      const ch = this.text[this.pos++];
      if (ch === "}") return out;
      if (ch !== ",") fail(`missing comma at ${this.pos - 1}`);
      this.skip();
    }
  }
  array(depth) {
    const out = [];
    this.pos += 1; this.skip();
    if (this.text[this.pos] === "]") { this.pos += 1; return out; }
    while (true) {
      if (out.length >= MAX_ARRAY_ITEMS) fail("array item count exceeds 10000");
      out.push(this.value(depth)); this.skip();
      const ch = this.text[this.pos++];
      if (ch === "]") return out;
      if (ch !== ",") fail(`missing comma at ${this.pos - 1}`);
      this.skip();
    }
  }
}

function readJson(filePath) {
  const bytes = fs.readFileSync(filePath);
  if (bytes.length > MAX_BYTES) fail("JSON document exceeds 16 MiB");
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) fail("UTF-8 BOM is forbidden");
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { fail("invalid UTF-8"); }
  return new StrictJsonParser(text).parse();
}

function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") { if (!Number.isSafeInteger(value)) fail("JCS safe integers only"); return String(value); }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  fail("unsupported JCS value");
}

function sha256(value) {
  const bytes = typeof value === "string" || Buffer.isBuffer(value) ? value : canonicalJson(value);
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function contentHash(document) { const copy = structuredClone(document); delete copy.integrity; return sha256(copy); }
function refreshIntegrity(document) { document.integrity.content_sha256 = contentHash(document); }
function issue(code, instancePath, ruleId) { return { code, instance_path: instancePath, rule_id: ruleId }; }
function exact(actual, expected, label) { if (canonicalJson(actual) !== canonicalJson(expected)) fail(`${label}: expected ${canonicalJson(expected)} got ${canonicalJson(actual)}`); }

function parts(pointer) {
  if (!pointer.startsWith("/")) fail(`invalid pointer ${pointer}`);
  return pointer.slice(1).split("/").map((item) => item.replace(/~1/g, "/").replace(/~0/g, "~"));
}
function parentAt(document, pointer) {
  const values = parts(pointer); const key = values.pop(); let target = document;
  for (const value of values) target = target[value];
  return { target, key };
}
function mutate(document, mutation) {
  const { target, key } = parentAt(document, mutation.path);
  if (mutation.op === "replace") { if (!(key in target)) fail(`replace missing ${mutation.path}`); target[key] = mutation.value; }
  else if (mutation.op === "add") { if (key in target) fail(`add exists ${mutation.path}`); target[key] = mutation.value; }
  else if (mutation.op === "remove") { if (!(key in target)) fail(`remove missing ${mutation.path}`); if (Array.isArray(target)) target.splice(Number(key), 1); else delete target[key]; }
  else fail(`unknown mutation ${mutation.op}`);
}

function resolveRef(schema, reference) {
  if (!reference.startsWith("#/")) fail(`non-local schema ref ${reference}`);
  let value = schema;
  for (const part of reference.slice(2).split("/")) value = value[part.replace(/~1/g, "/").replace(/~0/g, "~")];
  if (!value) fail(`unresolved schema ref ${reference}`);
  return value;
}

function schemaErrors(instance, schema, root, pointer = "") {
  if (schema.$ref) return schemaErrors(instance, resolveRef(root, schema.$ref), root, pointer);
  const errors = [];
  if (schema.const !== undefined && canonicalJson(instance) !== canonicalJson(schema.const)) errors.push(pointer);
  if (schema.enum && !schema.enum.some((value) => canonicalJson(value) === canonicalJson(instance))) errors.push(pointer);
  if (schema.type) {
    const valid = schema.type === "object" ? instance !== null && typeof instance === "object" && !Array.isArray(instance)
      : schema.type === "array" ? Array.isArray(instance)
      : schema.type === "string" ? typeof instance === "string"
      : schema.type === "integer" ? Number.isSafeInteger(instance)
      : schema.type === "boolean" ? typeof instance === "boolean" : false;
    if (!valid) return [pointer];
  }
  if (typeof instance === "string") {
    if (schema.minLength !== undefined && [...instance].length < schema.minLength) errors.push(pointer);
    if (schema.maxLength !== undefined && [...instance].length > schema.maxLength) errors.push(pointer);
    if (schema.pattern && !new RegExp(schema.pattern).test(instance)) errors.push(pointer);
  }
  if (Array.isArray(instance)) {
    if (schema.minItems !== undefined && instance.length < schema.minItems) errors.push(pointer);
    if (schema.maxItems !== undefined && instance.length > schema.maxItems) errors.push(pointer);
    if (schema.uniqueItems && new Set(instance.map(canonicalJson)).size !== instance.length) errors.push(pointer);
    if (schema.items) instance.forEach((value, index) => errors.push(...schemaErrors(value, schema.items, root, `${pointer}/${index}`)));
  }
  if (instance && typeof instance === "object" && !Array.isArray(instance)) {
    const keys = Object.keys(instance);
    if (schema.minProperties !== undefined && keys.length < schema.minProperties) errors.push(pointer);
    if (schema.maxProperties !== undefined && keys.length > schema.maxProperties) errors.push(pointer);
    for (const key of schema.required ?? []) if (!(key in instance)) errors.push(`${pointer}/${key}`);
    for (const key of keys) if (schema.propertyNames) errors.push(...schemaErrors(key, schema.propertyNames, root, `${pointer}/${key}`));
    const known = new Set(Object.keys(schema.properties ?? {}));
    for (const [key, propertySchema] of Object.entries(schema.properties ?? {})) if (key in instance) errors.push(...schemaErrors(instance[key], propertySchema, root, `${pointer}/${key}`));
    for (const key of keys.filter((key) => !known.has(key))) {
      if (schema.additionalProperties === false) errors.push(`${pointer}/${key}`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") errors.push(...schemaErrors(instance[key], schema.additionalProperties, root, `${pointer}/${key}`));
    }
  }
  return errors;
}

function lintSchema(schema) {
  if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") fail("wrong JSON Schema draft");
  if (schema.$id !== "urn:minimax-h3-tool:schema:alpha-recipe:1.0.0") fail("wrong immutable schema id");
  if (schema.additionalProperties !== false || schema["x-primary-trust-class"] !== "immutable_authority") fail("recipe root is not closed immutable authority");
  const sensitivities = new Set(["public", "internal", "local_path", "prompt", "asset_name", "account", "token", "personal_data"]);
  const trustOrder = new Map(["display", "observation", "execution", "ownership", "path", "artifact", "graph", "recovery"].map((value, index) => [value, index]));
  const ruleIds = new Set();
  function walk(value, pointer) {
    if (!value || typeof value !== "object") return;
    if (typeof value.$ref === "string" && !value.$ref.startsWith("#/")) fail(`non-local schema reference ${pointer}`);
    if (value["x-rule-id"]) {
      if (ruleIds.has(value["x-rule-id"])) fail(`duplicate rule id ${value["x-rule-id"]}`);
      ruleIds.add(value["x-rule-id"]);
      if (!value["x-error-code"]) fail(`missing error code ${pointer}`);
    }
    for (const [name, property] of Object.entries(value.properties ?? {})) {
      const impacts = property["x-trust-impact"];
      const validImpacts = Array.isArray(impacts) && impacts.length > 0 && new Set(impacts).size === impacts.length && impacts.every((impact, index) => trustOrder.has(impact) && (index === 0 || trustOrder.get(impacts[index - 1]) < trustOrder.get(impact)));
      if (!sensitivities.has(property["x-sensitive"]) || !validImpacts) fail(`missing/invalid trust annotation ${pointer}/properties/${name}`);
    }
    for (const [key, child] of Object.entries(value)) if (key !== "properties" || child) walk(child, `${pointer}/${key}`);
  }
  walk(schema, "");
}

const EXPECTED_REFS = {
  capability_catalog: { contract_id: "minimax-h3-tool.capability-catalog", schema_version: "1.0.0", schema_id: "urn:minimax-h3-tool:schema:capability-catalog:1.0.0", schemaPath: CAP_SCHEMA_PATH, documentPath: CAP_PATH },
  node_allowlist: { contract_id: "minimax-h3-tool.node-allowlist", schema_version: "1.0.0", schema_id: "urn:minimax-h3-tool:schema:node-allowlist:1.0.0", schemaPath: NODE_SCHEMA_PATH, documentPath: NODE_PATH },
  component_manifest: { contract_id: "minimax-h3-tool.component-manifest", schema_version: "1.0.0", schema_id: "urn:minimax-h3-tool:schema:component-manifest:1.0.0", schemaPath: COMPONENT_SCHEMA_PATH, documentPath: COMPONENT_PATH }
};

const PARTNER_API = new Set(["MinimaxTextToVideoNode", "MinimaxImageToVideoNode", "MinimaxSubjectToVideoNode", "MinimaxHailuoVideoNode", "MinimaxHailuo03TextToVideoNode", "MinimaxHailuo03FirstLastFrameNode", "MinimaxHailuo03ReferenceNode", "MinimaxHailuo03ContextIRNode", "MinimaxHailuo03RegenerateNode"]);
const REQUIRED_NODES = ["MiniMaxH3ImageToVideo", "MiniMaxH3SigmaShift", "CreateVideo", "SaveVideo"];
const EXPECTED_COMPONENT_SLOTS = {
  python_runtime: { binding_state: "resolved_blocked", component_id: "python-runtime-fixture", component_version: "3.12.0", component_role: "python_runtime", artifact_sha256: "sha256:1111111111111111111111111111111111111111111111111111111111111111", release_state: "blocked", license_state: "pending_external", disposition: "active" },
  comfy_backend: { binding_state: "unresolved", requirement_id: "comfyui-core-locked", component_role: "comfy_backend", readiness: "blocked", reason_code: "RECIPE.BACKEND_COMPONENT_MISSING" },
  comfy_frontend: { binding_state: "resolved_blocked", component_id: "comfy-frontend-fixture", component_version: "1.0.0", component_role: "comfy_frontend", artifact_sha256: "sha256:2222222222222222222222222222222222222222222222222222222222222222", release_state: "blocked", license_state: "pending_external", disposition: "active" },
  local_node_pack: { binding_state: "resolved_blocked", component_id: "local-node-fixture", component_version: "1.0.0", component_role: "local_node", artifact_sha256: "sha256:3333333333333333333333333333333333333333333333333333333333333333", release_state: "blocked", license_state: "pending_external", disposition: "active" }
};
const EXPECTED_MODEL_SLOTS = {
  base_diffusion: { binding_state: "resolved_blocked", component_id: "h3-model-fixture", component_version: "1.0.0", component_role: "model_diffusion", artifact_sha256: "sha256:4444444444444444444444444444444444444444444444444444444444444444", release_state: "blocked", license_state: "pending_external", disposition: "active" },
  fl2va_diffusion: { binding_state: "unresolved", requirement_id: "h3-fl2va-model", component_role: "model_diffusion", readiness: "blocked", reason_code: "RECIPE.FL2VA_COMPONENT_MISSING" },
  text_encoder: { binding_state: "unresolved", requirement_id: "h3-text-encoder", component_role: "model_text_encoder", readiness: "blocked", reason_code: "RECIPE.TEXT_ENCODER_COMPONENT_MISSING" },
  video_vae: { binding_state: "unresolved", requirement_id: "h3-video-vae", component_role: "model_video_vae", readiness: "blocked", reason_code: "RECIPE.VIDEO_VAE_COMPONENT_MISSING" },
  audio_vae: { binding_state: "unresolved", requirement_id: "h3-audio-vae", component_role: "model_audio_vae", readiness: "blocked", reason_code: "RECIPE.AUDIO_VAE_COMPONENT_MISSING" }
};

function firstSlotDrift(actual, expected) {
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) return "binding_state";
  for (const key of Object.keys(expected)) if (!(key in actual) || canonicalJson(actual[key]) !== canonicalJson(expected[key])) return key;
  for (const key of Object.keys(actual)) if (!(key in expected)) return key;
  return null;
}

function validateRecipe(document, schema, upstreams) {
  if (document?.contract_id !== "minimax-h3-tool.alpha-recipe") return issue("CONTRACT.UNKNOWN_CONTRACT", "/contract_id", "recipe.envelope.contract_id_exact");
  if (document?.schema_version !== "1.0.0") return issue("CONTRACT.UNSUPPORTED_VERSION", "/schema_version", "recipe.envelope.schema_version_exact");
  if (contentHash(document) !== document?.integrity?.content_sha256) return issue("CONTRACT.INTEGRITY_MISMATCH", "/integrity/content_sha256", "recipe.integrity.root_jcs_exact");

  function forbiddenCoreField(value, pointer = "") {
    if (!value || typeof value !== "object") return null;
    for (const [key, child] of Object.entries(value)) {
      if (pointer === "" && key === "extensions") continue;
      const childPointer = `${pointer}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`;
      if (/(?:auto_submit|auto_run|prompt_endpoint)/i.test(key)) return issue("RECIPE.AUTO_PROMPT_FORBIDDEN", childPointer, "recipe.boundary.no_auto_prompt");
      if (/(?:cloud_inference|partner_inference|remote_fallback|api_endpoint)/i.test(key)) return issue("RECIPE.CLOUD_PARTNER_FORBIDDEN", childPointer, "recipe.boundary.no_cloud_partner");
      if (/(?:private_ffmpeg|ffmpeg_executable|ffmpeg_path)/i.test(key)) return issue("RECIPE.FFMPEG_UNGROUNDED", childPointer, "recipe.output.ffmpeg_requires_capability");
      const nested = forbiddenCoreField(child, childPointer);
      if (nested) return nested;
    }
    return null;
  }
  const forbiddenField = forbiddenCoreField(document);
  if (forbiddenField) return forbiddenField;

  const grants = document.authority?.grants ?? {};
  for (const key of ["download", "materialization", "execution", "ownership", "deletion", "launch", "queue_submission"]) {
    if (grants[key] !== false) return issue("RECIPE.AUTHORITY_ESCALATION", `/authority/grants/${key}`, "recipe.authority.no_action_grants");
  }

  for (const [name, expected] of Object.entries(EXPECTED_REFS)) {
    const ref = document.source_bindings?.[name];
    if (!ref) return issue("RECIPE.PREREQUISITE_MISSING", `/source_bindings/${name}`, "recipe.sources.all_required");
    const sourceSchema = upstreams[name].schema;
    const sourceDocument = upstreams[name].document;
    if (ref.contract_id !== expected.contract_id || ref.schema_version !== expected.schema_version || ref.schema_id !== expected.schema_id) return issue("RECIPE.SCHEMA_IDENTITY_DRIFT", `/source_bindings/${name}/schema_id`, "recipe.sources.schema_identity_exact");
    if (ref.schema_content_sha256 !== sha256(sourceSchema)) return issue("RECIPE.SCHEMA_HASH_DRIFT", `/source_bindings/${name}/schema_content_sha256`, "recipe.sources.schema_digest_exact");
    if (ref.source_document_id !== sourceDocument.document_id || ref.source_document_revision !== sourceDocument.document_revision || ref.source_content_sha256 !== sourceDocument.integrity.content_sha256 || contentHash(sourceDocument) !== sourceDocument.integrity.content_sha256) return issue("RECIPE.DOCUMENT_IDENTITY_DRIFT", `/source_bindings/${name}/source_content_sha256`, "recipe.sources.document_snapshot_exact");
  }

  const profile = document.profile ?? {};
  if (profile.publication_status !== "poc_pending" || profile.runnable !== false || profile.selectable !== false) return issue("RECIPE.STATUS_PROMOTION_FORBIDDEN", "/profile/runnable", "recipe.profile.pending_never_runnable");
  const capability = upstreams.capability_catalog.document.capabilities.find((value) => value.capability_id === profile.capability?.capability_id);
  if (!capability) return issue("RECIPE.CAPABILITY_IDENTITY_DRIFT", "/profile/capability/capability_id", "recipe.capability.exact_source_record");
  if (profile.capability.publication_status !== capability.publication_status || profile.capability.evidence_status !== capability.evidence_status || profile.capability.disposition !== capability.disposition.kind) return issue("RECIPE.CAPABILITY_STATUS_PROMOTION", "/profile/capability/publication_status", "recipe.capability.status_cannot_promote");

  const control = profile.control_plane ?? {};
  const binding = upstreams.component_manifest.document.catalog_binding;
  if (control.app_id !== binding.app_id || control.app_version !== binding.app_version || control.app_build_id !== binding.app_build_id) return issue("RECIPE.APP_IDENTITY_DRIFT", "/profile/control_plane/app_build_id", "recipe.control.app_tuple_exact");
  const allowlist = upstreams.node_allowlist.document;
  if (!/^[0-9a-f]{40}$/.test(control.backend_locked_revision ?? "")) return issue("RECIPE.MUTABLE_REVISION_FORBIDDEN", "/profile/control_plane/backend_locked_revision", "recipe.control.backend_immutable_revision");
  if (control.backend_origin_uri !== allowlist.scope.backend_origin_uri || control.backend_locked_revision !== allowlist.scope.backend_locked_revision) return issue("RECIPE.RUNTIME_IDENTITY_DRIFT", "/profile/control_plane/backend_locked_revision", "recipe.control.backend_identity_exact");
  if (control.api_nodes !== "disabled" || control.unknown_custom_nodes !== "disabled") return issue("RECIPE.CLOUD_PARTNER_FORBIDDEN", "/profile/control_plane/api_nodes", "recipe.control.local_nodes_only");
  if (control.workflow_handoff !== "persist_only_user_must_click_run") return issue("RECIPE.AUTO_PROMPT_FORBIDDEN", "/profile/control_plane/workflow_handoff", "recipe.control.user_run_required");

  if (!Array.isArray(profile.nodes) || profile.nodes.length !== REQUIRED_NODES.length) return issue("RECIPE.PREREQUISITE_MISSING", "/profile/nodes", "recipe.nodes.all_required");
  for (let index = 0; index < profile.nodes.length; index += 1) {
    const node = profile.nodes[index];
    if (PARTNER_API.has(node.class_type) || node.is_api_node === true || node.local_only === false) return issue("RECIPE.PARTNER_API_FORBIDDEN", `/profile/nodes/${index}/class_type`, "recipe.nodes.partner_api_fail_closed");
    if (node.class_type !== REQUIRED_NODES[index]) return issue("RECIPE.NODE_IDENTITY_DRIFT", `/profile/nodes/${index}/class_type`, "recipe.nodes.ordered_class_exact");
    const source = allowlist.entries.find((value) => value.class_type === node.class_type);
    if (!source) return issue("RECIPE.NODE_IDENTITY_DRIFT", `/profile/nodes/${index}/class_type`, "recipe.nodes.allowlist_record_required");
    const fields = [["input_schema_sha256", "input_schema_sha256"], ["output_schema_sha256", "output_schema_sha256"], ["combined_schema_sha256", "combined_schema_sha256"]];
    for (const [target, sourceName] of fields) if (node[target] !== source.schema_fingerprints[sourceName]) return issue("RECIPE.NODE_FINGERPRINT_DRIFT", `/profile/nodes/${index}/${target}`, "recipe.nodes.all_fingerprints_exact");
    if (node.source_path !== source.origin.source_path || node.git_blob_sha !== source.origin.git_blob_sha || node.locked_revision !== source.origin.locked_revision) return issue("RECIPE.NODE_ORIGIN_DRIFT", `/profile/nodes/${index}/source_path`, "recipe.nodes.origin_exact");
    if (node.runtime_acceptance !== source.runtime_acceptance || node.disposition !== source.disposition.kind) return issue("RECIPE.NODE_STATUS_PROMOTION", `/profile/nodes/${index}/runtime_acceptance`, "recipe.nodes.status_cannot_promote");
  }

  const componentMap = new Map(upstreams.component_manifest.document.components.map((value) => [value.component_id, value]));
  for (const [slot, expected] of Object.entries(EXPECTED_COMPONENT_SLOTS)) {
    const value = profile.components?.[slot];
    if (!value) return issue("RECIPE.PREREQUISITE_MISSING", `/profile/components/${slot}`, "recipe.components.all_roles_required");
    const drift = firstSlotDrift(value, expected);
    if (expected.binding_state === "unresolved") {
      if (value.readiness !== "blocked") return issue("RECIPE.COMPONENT_STATUS_PROMOTION", `/profile/components/${slot}/readiness`, "recipe.components.unresolved_stays_blocked");
      if (drift) return issue("RECIPE.UNRESOLVED_IDENTITY_DRIFT", `/profile/components/${slot}/${drift}`, "recipe.components.unresolved_slot_exact");
      continue;
    }
    if (value.release_state !== "blocked") return issue("RECIPE.COMPONENT_STATUS_PROMOTION", `/profile/components/${slot}/release_state`, "recipe.components.blocked_cannot_promote");
    if (value.license_state !== "pending_external") return issue("RECIPE.LEGAL_STATUS_PROMOTION", `/profile/components/${slot}/license_state`, "recipe.components.license_cannot_promote");
    if (drift) return issue("RECIPE.COMPONENT_IDENTITY_DRIFT", `/profile/components/${slot}/${drift}`, "recipe.components.identity_exact");
    const source = componentMap.get(expected.component_id);
    if (!source || expected.component_version !== source.component_version || expected.component_role !== source.component_role || expected.artifact_sha256 !== source.artifact.artifact_sha256 || source.release_state !== "blocked") return issue("RECIPE.COMPONENT_IDENTITY_DRIFT", `/profile/components/${slot}/component_id`, "recipe.components.upstream_slot_exact");
  }
  for (const [slot, expected] of Object.entries(EXPECTED_MODEL_SLOTS)) {
    const value = profile.models?.[slot];
    if (!value) return issue("RECIPE.PREREQUISITE_MISSING", `/profile/models/${slot}`, "recipe.models.all_roles_required");
    const drift = firstSlotDrift(value, expected);
    if (expected.binding_state === "unresolved") {
      if (value.readiness !== "blocked") return issue("RECIPE.COMPONENT_STATUS_PROMOTION", `/profile/models/${slot}/readiness`, "recipe.models.unresolved_stays_blocked");
      if (drift) return issue("RECIPE.UNRESOLVED_IDENTITY_DRIFT", `/profile/models/${slot}/${drift}`, "recipe.models.unresolved_slot_exact");
      continue;
    }
    if (value.release_state !== "blocked") return issue("RECIPE.COMPONENT_STATUS_PROMOTION", `/profile/models/${slot}/release_state`, "recipe.models.blocked_cannot_promote");
    if (value.license_state !== "pending_external") return issue("RECIPE.LEGAL_STATUS_PROMOTION", `/profile/models/${slot}/license_state`, "recipe.models.license_cannot_promote");
    if (drift) return issue("RECIPE.MODEL_IDENTITY_DRIFT", `/profile/models/${slot}/${drift}`, "recipe.models.identity_exact");
    const source = componentMap.get(expected.component_id);
    if (!source || expected.component_version !== source.component_version || expected.component_role !== source.component_role || expected.artifact_sha256 !== source.artifact.artifact_sha256 || source.release_state !== "blocked") return issue("RECIPE.MODEL_IDENTITY_DRIFT", `/profile/models/${slot}/component_id`, "recipe.models.upstream_slot_exact");
  }

  if (profile.legal?.review_state !== "pending_external" || profile.legal?.authority !== "human_legal_owner" || profile.legal?.readiness !== "poc_pending") return issue("RECIPE.LEGAL_STATUS_PROMOTION", "/profile/legal/review_state", "recipe.legal.human_pending_cannot_promote");
  const hardware = capability.prerequisites.hardware;
  if (profile.hardware?.profile_id !== hardware.requirement_ids[0] || profile.hardware?.requirement_id !== hardware.requirement_ids[0]) return issue("RECIPE.HARDWARE_IDENTITY_DRIFT", "/profile/hardware/profile_id", "recipe.hardware.requirement_exact");
  if (profile.hardware?.evidence_status !== hardware.evidence_status || profile.hardware?.readiness !== hardware.readiness || profile.hardware?.selection_authority !== "none_until_exact_hardware_report_match") return issue("RECIPE.HARDWARE_STATUS_PROMOTION", "/profile/hardware/readiness", "recipe.hardware.pending_cannot_select");

  const output = profile.output ?? {};
  const gates = capability.gates;
  const outputExact = output.capability_id === capability.capability_id && output.route === gates.route.route && output.requested_seconds === gates.duration.requested_seconds && canonicalJson(output.frame_rate) === canonicalJson(gates.duration.frame_rate) && output.nonempty_prompt_required === !gates.prompt.empty_prompt_allowed && output.endpoint_mode === gates.endpoint.endpoint_mode && output.native_audio_required === gates.audio.native_audio_required && output.sample_rate_hz === gates.audio.sample_rate_hz && output.channels === gates.audio.channels;
  if (!outputExact) return issue("RECIPE.OUTPUT_IDENTITY_DRIFT", "/profile/output", "recipe.output.capability_gates_exact");
  if (output.external_ffmpeg_requirement !== "not_declared") return issue("RECIPE.FFMPEG_UNGROUNDED", "/profile/output/external_ffmpeg_requirement", "recipe.output.ffmpeg_requires_capability");
  if (output.readiness !== "poc_pending" || output.runnable !== false) return issue("RECIPE.OUTPUT_STATUS_PROMOTION", "/profile/output/readiness", "recipe.output.pending_cannot_run");

  const rawSchemaErrors = [...new Set(schemaErrors(document, schema, schema))].sort();
  if (rawSchemaErrors.length) {
    const pointer = rawSchemaErrors[0];
    const field = pointer.split("/").at(-1);
    if (["auto_submit_prompt", "auto_run", "prompt_endpoint"].includes(field)) return issue("RECIPE.AUTO_PROMPT_FORBIDDEN", pointer, "recipe.boundary.no_auto_prompt");
    if (["cloud_inference", "partner_inference", "remote_fallback", "api_endpoint"].includes(field)) return issue("RECIPE.CLOUD_PARTNER_FORBIDDEN", pointer, "recipe.boundary.no_cloud_partner");
    if (["private_ffmpeg", "ffmpeg_executable", "ffmpeg_path"].includes(field)) return issue("RECIPE.FFMPEG_UNGROUNDED", pointer, "recipe.output.ffmpeg_requires_capability");
    if (pointer && parentAt(document, pointer).target && field in parentAt(document, pointer).target) return issue("CONTRACT.UNKNOWN_FIELD", pointer, "recipe.core.closed");
    return issue("RECIPE.SCHEMA_CONSTRAINT", pointer, "recipe.schema.exact");
  }
  return null;
}

function supportProjection(document) {
  return {
    contract_id: document.contract_id,
    schema_version: document.schema_version,
    document_id: document.document_id,
    recipe_id: document.recipe_id,
    recipe_version: document.recipe_version,
    profile: {
      profile_id: document.profile.profile_id,
      publication_status: document.profile.publication_status,
      runnable: document.profile.runnable,
      selectable: document.profile.selectable,
      reason_codes: document.profile.reason_codes
    },
    integrity: document.integrity
  };
}

function sanitizePublicEvidence(document) {
  const files = [
    SCHEMA_PATH,
    path.join(ROOT, "schemas/alpha-recipe/README.md"),
    VALID_PATH,
    path.join(HERE, "README.md"),
    path.join(HERE, "validate.mjs"),
    ...fs.readdirSync(CASES_DIR).filter((name) => name.endsWith(".json")).map((name) => path.join(CASES_DIR, name)),
    path.join(ROOT, "docs/evidence/ALPHA_RECIPE_SCHEMA.md")
  ].filter((file) => fs.existsSync(file));
  const username = process.env.USERNAME ?? "";
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    if (/[A-Za-z]:[\\/]Users[\\/]/i.test(text)) fail(`private Windows user path in ${path.relative(ROOT, file)}`);
    if (username.length >= 3 && new RegExp(`Users[\\\\/]${username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(text)) fail(`current username in ${path.relative(ROOT, file)}`);
  }
  const projection = canonicalJson(supportProjection(document));
  if (/(?:prompt|token|extensions|[A-Za-z]:[\\/]Users[\\/])/i.test(projection)) fail("support projection leaked sensitive or extension data");
  return files.length;
}

function run() {
  const schema = readJson(SCHEMA_PATH);
  lintSchema(schema);
  const recipe = readJson(VALID_PATH);
  const upstreams = Object.fromEntries(Object.entries(EXPECTED_REFS).map(([name, value]) => [name, { schema: readJson(value.schemaPath), document: readJson(value.documentPath) }]));
  const validResult = validateRecipe(recipe, schema, upstreams);
  if (validResult) fail(`valid recipe rejected: ${canonicalJson(validResult)}`);
  const positiveSchemaErrors = schemaErrors(recipe, schema, schema);
  if (positiveSchemaErrors.length) fail(`valid recipe failed schema at ${[...new Set(positiveSchemaErrors)].sort().slice(0, 12).join(",")}`);

  let negativeCount = 0;
  let validMutationCount = 0;
  for (const fileName of fs.readdirSync(CASES_DIR).filter((name) => name.endsWith(".json")).sort()) {
    const testCase = readJson(path.join(CASES_DIR, fileName));
    if (testCase.fixture_case_version !== "1.0.0" || testCase.base !== "valid/alpha0-poc-pending-recipe.json" || !Array.isArray(testCase.mutations) || testCase.mutations.length === 0) fail(`${testCase.case_id}: invalid case envelope`);
    const candidate = structuredClone(recipe);
    for (const mutation of testCase.mutations) mutate(candidate, mutation);
    refreshIntegrity(candidate);
    const actual = validateRecipe(candidate, schema, upstreams);
    if (testCase.expected === "valid") {
      if (actual) fail(`${testCase.case_id}: expected valid got ${canonicalJson(actual)}`);
      validMutationCount += 1;
    } else {
      exact(actual, testCase.expected, testCase.case_id);
      negativeCount += 1;
    }
    console.log(`PASS case ${testCase.case_id}`);
  }
  const publicFileCount = sanitizePublicEvidence(recipe);
  console.log(`PASS schema alpha-recipe ${sha256(schema)}`);
  console.log(`PASS valid alpha0-poc-pending-recipe status=${recipe.profile.publication_status} runnable=${recipe.profile.runnable}`);
  console.log(`PASS redaction public_files=${publicFileCount} private_paths=0 support_projection=pass`);
  console.log(`SUMMARY schemas=1 valid_contracts=1 negative_cases=${negativeCount} valid_mutation_cases=${validMutationCount}`);
}

try { run(); } catch (error) { console.error(`FAIL ${error.message}`); process.exitCode = 1; }
