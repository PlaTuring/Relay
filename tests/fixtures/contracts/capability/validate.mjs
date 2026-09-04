import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../../..");
const CAPABILITY_SCHEMA_PATH = path.join(ROOT, "schemas/capability-catalog/1.0.0.schema.json");
const NODE_SCHEMA_PATH = path.join(ROOT, "schemas/node-allowlist/1.0.0.schema.json");
const VALID_DIR = path.join(HERE, "valid");
const CASES_DIR = path.join(HERE, "cases");

const MAX_BYTES = 16 * 1024 * 1024;
const MAX_DEPTH = 64;
const MAX_VALUES = 200_000;
const MAX_OBJECT_PROPERTIES = 10_000;
const MAX_ARRAY_ITEMS = 10_000;
const MAX_STRING_BYTES = 1024 * 1024;
const SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

function fail(message) {
  throw new Error(message);
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
    if (this.pos !== this.text.length) fail(`invalid JSON at byte-like offset ${this.pos}`);
    return value;
  }

  skipWhitespace() {
    while (this.pos < this.text.length && /[\u0009\u000a\u000d\u0020]/.test(this.text[this.pos])) this.pos += 1;
  }

  count(depth) {
    if (depth > MAX_DEPTH) fail("JSON nesting exceeds 64");
    this.values += 1;
    if (this.values > MAX_VALUES) fail("JSON value count exceeds 200000");
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
        try { value = JSON.parse(this.text.slice(start, this.pos)); } catch { fail(`invalid JSON string at byte-like offset ${start}`); }
        if (Buffer.byteLength(value, "utf8") > MAX_STRING_BYTES) fail("JSON string exceeds 1 MiB");
        for (let i = 0; i < value.length; i += 1) {
          const c = value.charCodeAt(i);
          if (c >= 0xd800 && c <= 0xdbff) {
            const n = value.charCodeAt(i + 1);
            if (!(n >= 0xdc00 && n <= 0xdfff)) fail("unpaired high surrogate");
            i += 1;
          } else if (c >= 0xdc00 && c <= 0xdfff) fail("unpaired low surrogate");
        }
        return value;
      }
      if (code < 0x20) fail(`unescaped control character at byte-like offset ${this.pos}`);
      if (ch === "\\") {
        this.pos += 1;
        const esc = this.text[this.pos];
        if (!'"\\/bfnrtu'.includes(esc ?? "")) fail(`invalid escape at byte-like offset ${this.pos}`);
        if (esc === "u") {
          const hex = this.text.slice(this.pos + 1, this.pos + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail(`invalid unicode escape at byte-like offset ${this.pos}`);
          this.pos += 4;
        }
      }
      this.pos += 1;
    }
    fail(`unterminated JSON string at byte-like offset ${start}`);
  }

  parseInteger() {
    const rest = this.text.slice(this.pos);
    const match = /^-?(?:0|[1-9][0-9]*)/.exec(rest);
    if (!match) fail(`invalid JSON value at byte-like offset ${this.pos}`);
    const end = this.pos + match[0].length;
    if (/[.eE]/.test(this.text[end] ?? "")) fail(`non-integer number at byte-like offset ${this.pos}`);
    const value = Number(match[0]);
    if (!Number.isSafeInteger(value) || Math.abs(value) > SAFE_INTEGER) fail(`unsafe integer at byte-like offset ${this.pos}`);
    this.pos = end;
    return value;
  }

  parseObject(depth) {
    const out = {};
    const keys = new Set();
    this.pos += 1;
    this.skipWhitespace();
    if (this.text[this.pos] === "}") { this.pos += 1; return out; }
    while (true) {
      if (this.text[this.pos] !== '"') fail(`object key must be a string at byte-like offset ${this.pos}`);
      const key = this.parseString();
      if (Buffer.byteLength(key, "utf8") > 128) fail("JSON key exceeds 128 UTF-8 bytes");
      if (keys.has(key)) fail(`duplicate JSON key at byte-like offset ${this.pos}`);
      keys.add(key);
      if (keys.size > MAX_OBJECT_PROPERTIES) fail("object property count exceeds 10000");
      this.skipWhitespace();
      if (this.text[this.pos] !== ":") fail(`missing colon at byte-like offset ${this.pos}`);
      this.pos += 1;
      this.skipWhitespace();
      out[key] = this.parseValue(depth);
      this.skipWhitespace();
      const ch = this.text[this.pos];
      if (ch === "}") { this.pos += 1; return out; }
      if (ch !== ",") fail(`missing comma at byte-like offset ${this.pos}`);
      this.pos += 1;
      this.skipWhitespace();
    }
  }

  parseArray(depth) {
    const out = [];
    this.pos += 1;
    this.skipWhitespace();
    if (this.text[this.pos] === "]") { this.pos += 1; return out; }
    while (true) {
      if (out.length >= MAX_ARRAY_ITEMS) fail("array item count exceeds 10000");
      out.push(this.parseValue(depth));
      this.skipWhitespace();
      const ch = this.text[this.pos];
      if (ch === "]") { this.pos += 1; return out; }
      if (ch !== ",") fail(`missing comma at byte-like offset ${this.pos}`);
      this.pos += 1;
      this.skipWhitespace();
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
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) fail("JCS profile accepts safe integers only");
    return String(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  fail("unsupported JCS value");
}

function sha256(value) {
  const bytes = typeof value === "string" || Buffer.isBuffer(value) ? value : canonicalJson(value);
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function documentContentHash(document) {
  const projected = structuredClone(document);
  delete projected.integrity;
  return sha256(projected);
}

function refreshIntegrity(document) {
  if (document.integrity) document.integrity.content_sha256 = documentContentHash(document);
}

function error(code, instancePath, ruleId) {
  return { code, instance_path: instancePath, rule_id: ruleId };
}

function assertExact(actual, expected, context) {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail(`${context}: expected ${canonicalJson(expected)} but got ${canonicalJson(actual)}`);
  }
}

function pointerParts(pointer) {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) fail(`invalid JSON Pointer ${pointer}`);
  return pointer.slice(1).split("/").map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function atPointer(document, pointer) {
  let current = document;
  for (const part of pointerParts(pointer)) {
    if (current === null || typeof current !== "object" || !(part in current)) fail(`fixture pointer not found: ${pointer}`);
    current = current[part];
  }
  return current;
}

function parentAtPointer(document, pointer) {
  const parts = pointerParts(pointer);
  if (parts.length === 0) fail("fixture mutation may not replace the root");
  const key = parts.pop();
  let parent = document;
  for (const part of parts) {
    if (parent === null || typeof parent !== "object" || !(part in parent)) fail(`fixture pointer not found: ${pointer}`);
    parent = parent[part];
  }
  return { parent, key };
}

function mutate(document, mutation) {
  const allowed = new Set(["op", "path", "from", "value"]);
  for (const key of Object.keys(mutation)) if (!allowed.has(key)) fail(`unknown mutation field ${key}`);
  const { parent, key } = parentAtPointer(document, mutation.path);
  if (mutation.op === "remove") {
    if (!(key in parent)) fail(`remove pointer not found: ${mutation.path}`);
    if (Array.isArray(parent)) parent.splice(Number(key), 1); else delete parent[key];
    return;
  }
  let value;
  if (mutation.op === "copy") value = structuredClone(atPointer(document, mutation.from));
  else if (mutation.op === "add" || mutation.op === "replace") value = structuredClone(mutation.value);
  else fail(`unsupported mutation op ${mutation.op}`);
  if (Array.isArray(parent)) {
    if (key === "-") parent.push(value);
    else if (mutation.op === "add" || mutation.op === "copy") parent.splice(Number(key), 0, value);
    else parent[Number(key)] = value;
  } else {
    if (mutation.op === "replace" && !(key in parent)) fail(`replace pointer not found: ${mutation.path}`);
    parent[key] = value;
  }
}

function lintSchema(schema, expectedId) {
  if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") fail(`${expectedId}: wrong JSON Schema draft`);
  if (schema.$id !== expectedId) fail(`${expectedId}: wrong immutable schema id`);
  if (schema.additionalProperties !== false) fail(`${expectedId}: root object is not closed`);
  const annotationErrors = [];
  const errorRuleErrors = [];
  const seenRuleIds = new Map();
  const constraintKeys = new Set(["$ref", "type", "const", "enum", "required", "properties", "additionalProperties", "unevaluatedProperties", "items", "minItems", "maxItems", "uniqueItems", "minProperties", "maxProperties", "propertyNames", "pattern", "minLength", "maxLength", "minimum", "maximum", "oneOf", "allOf", "if", "then", "else"]);
  function walk(value, pointer, inConditional = false) {
    if (value === null || typeof value !== "object") return;
    if (typeof value.$ref === "string" && !value.$ref.startsWith("#/")) fail(`${expectedId}: non-local $ref at ${pointer}`);
    if (Object.keys(value).some((key) => constraintKeys.has(key))) {
      if (!/^[A-Z][A-Z0-9_]*(?:\.[A-Z][A-Z0-9_]*)+$/.test(value["x-error-code"] ?? "") || !/^[a-z0-9_.]+$/.test(value["x-rule-id"] ?? "")) errorRuleErrors.push(pointer || "/");
      else if (seenRuleIds.has(value["x-rule-id"])) errorRuleErrors.push(`${pointer || "/"} duplicates ${seenRuleIds.get(value["x-rule-id"])}`);
      else seenRuleIds.set(value["x-rule-id"], pointer || "/");
    }
    if (value.properties && !inConditional) {
      for (const [name, propertySchema] of Object.entries(value.properties)) {
        if (!("x-sensitive" in propertySchema) || !("x-trust-impact" in propertySchema)) annotationErrors.push(`${pointer}/properties/${name}`);
      }
    }
    for (const [key, child] of Object.entries(value)) {
      const conditional = inConditional || key === "if" || key === "then" || key === "else";
      if (Array.isArray(child)) child.forEach((item, index) => walk(item, `${pointer}/${key}/${index}`, conditional));
      else walk(child, `${pointer}/${key}`, conditional);
    }
  }
  walk(schema, "");
  if (annotationErrors.length) fail(`${expectedId}: properties missing trust annotations: ${annotationErrors.join(",")}`);
  if (errorRuleErrors.length) fail(`${expectedId}: constraints missing unique stable error annotations: ${errorRuleErrors.join(",")}`);
}

function resolveLocalRef(rootSchema, reference) {
  if (!reference.startsWith("#/")) fail(`non-local schema reference ${reference}`);
  let current = rootSchema;
  for (const part of pointerParts(reference.slice(1))) {
    if (current === null || typeof current !== "object" || !(part in current)) fail(`unresolved schema reference ${reference}`);
    current = current[part];
  }
  return current;
}

function schemaErrors(instance, schema, rootSchema, instancePath = "") {
  if (schema === true) return [];
  if (schema === false) return [instancePath];
  const errors = [];
  if (schema.$ref) errors.push(...schemaErrors(instance, resolveLocalRef(rootSchema, schema.$ref), rootSchema, instancePath));
  if (schema.const !== undefined && canonicalJson(instance) !== canonicalJson(schema.const)) errors.push(instancePath);
  if (schema.enum && !schema.enum.some((candidate) => canonicalJson(candidate) === canonicalJson(instance))) errors.push(instancePath);
  if (schema.type) {
    const matches = schema.type === "object" ? instance !== null && typeof instance === "object" && !Array.isArray(instance)
      : schema.type === "array" ? Array.isArray(instance)
      : schema.type === "string" ? typeof instance === "string"
      : schema.type === "integer" ? Number.isSafeInteger(instance)
      : schema.type === "boolean" ? typeof instance === "boolean"
      : schema.type === "null" ? instance === null
      : false;
    if (!matches) return [...errors, instancePath];
  }
  if (schema.allOf) for (const branch of schema.allOf) errors.push(...schemaErrors(instance, branch, rootSchema, instancePath));
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((branch) => schemaErrors(instance, branch, rootSchema, instancePath).length === 0).length;
    if (matches !== 1) errors.push(instancePath);
  }
  if (schema.if) {
    const condition = schemaErrors(instance, schema.if, rootSchema, instancePath).length === 0;
    if (condition && schema.then) errors.push(...schemaErrors(instance, schema.then, rootSchema, instancePath));
    if (!condition && schema.else) errors.push(...schemaErrors(instance, schema.else, rootSchema, instancePath));
  }
  if (typeof instance === "string") {
    if (schema.minLength !== undefined && [...instance].length < schema.minLength) errors.push(instancePath);
    if (schema.maxLength !== undefined && [...instance].length > schema.maxLength) errors.push(instancePath);
    if (schema.pattern && !(new RegExp(schema.pattern).test(instance))) errors.push(instancePath);
  }
  if (Number.isSafeInteger(instance)) {
    if (schema.minimum !== undefined && instance < schema.minimum) errors.push(instancePath);
    if (schema.maximum !== undefined && instance > schema.maximum) errors.push(instancePath);
  }
  if (Array.isArray(instance)) {
    if (schema.minItems !== undefined && instance.length < schema.minItems) errors.push(instancePath);
    if (schema.maxItems !== undefined && instance.length > schema.maxItems) errors.push(instancePath);
    if (schema.uniqueItems) {
      const seen = new Set();
      for (const item of instance) { const key = canonicalJson(item); if (seen.has(key)) errors.push(instancePath); seen.add(key); }
    }
    if (schema.items) instance.forEach((item, index) => errors.push(...schemaErrors(item, schema.items, rootSchema, `${instancePath}/${index}`)));
  }
  if (instance !== null && typeof instance === "object" && !Array.isArray(instance)) {
    const keys = Object.keys(instance);
    if (schema.minProperties !== undefined && keys.length < schema.minProperties) errors.push(instancePath);
    if (schema.maxProperties !== undefined && keys.length > schema.maxProperties) errors.push(instancePath);
    if (schema.required) for (const key of schema.required) if (!(key in instance)) errors.push(`${instancePath}/${key}`);
    if (schema.propertyNames) for (const key of keys) errors.push(...schemaErrors(key, schema.propertyNames, rootSchema, `${instancePath}/${key}`));
    const declared = new Set(Object.keys(schema.properties ?? {}));
    if (schema.properties) for (const [key, propertySchema] of Object.entries(schema.properties)) if (key in instance) errors.push(...schemaErrors(instance[key], propertySchema, rootSchema, `${instancePath}/${key}`));
    for (const key of keys) if (!declared.has(key)) {
      if (schema.additionalProperties === false) errors.push(`${instancePath}/${key}`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") errors.push(...schemaErrors(instance[key], schema.additionalProperties, rootSchema, `${instancePath}/${key}`));
    }
  }
  return errors;
}

function assertSchemaValid(document, schema, label) {
  const errors = schemaErrors(document, schema, schema);
  if (errors.length) fail(`${label}: JSON Schema rejected valid fixture at ${[...new Set(errors)].sort().slice(0, 8).join(",")}`);
}

const KNOWN_NODES = {
  EmptyMiniMaxH3LatentAV: ["sha256:2b04e745b0f8f5ac850030d97195eba13cb882f4fc4b0dfc853f4627c7f3f12b", "sha256:c3f34bff7a7ea46e586c566918a22986fa026ba590f86414e73098edf2fa59c4", "sha256:f23c9fb5c02ef0187d004a74f114735e26953c8d282147a45223de781a4860a2", "comfy_extras/nodes_minimax_h3.py", "0a08f185fd1155f18f16757c02553ff48cf365eb", "57500fc5bc92566a63f2046824f522cd55c335ca", false],
  MiniMaxH3ImageToVideo: ["sha256:f0d916a84a6fa13603198d4242adb9012a8a3cff3c2b1a67ce544ae78ca9632b", "sha256:ff2c10d6cf27e6a7560c322a49f4d9ca459036f8763998ef99c199b10d5274e4", "sha256:701870ddeb11c2ac58c1dd2d3ce39ac2df5fd2ec3bb601804f49ff60e22c9818", "comfy_extras/nodes_minimax_h3.py", "0a08f185fd1155f18f16757c02553ff48cf365eb", "57500fc5bc92566a63f2046824f522cd55c335ca", false],
  MiniMaxH3AddGuide: ["sha256:524876cb2baa092ffdeefb9ea4f3bf79c6a3f9f8b6dc43a45dd2da836401db70", "sha256:76110b0f5d08240b2a2b44baaf6b3df46a837b58e470d590689c850518e6993a", "sha256:bf7bfd2013db0bd45777568d6d67494f7bb99e803dd4cda3fbf3a40e857d2d62", "comfy_extras/nodes_minimax_h3.py", "0a08f185fd1155f18f16757c02553ff48cf365eb", "e01fb4c56b7a88149d469b99cbbfe3223d715054", false],
  MiniMaxH3ReferenceToVideo: ["sha256:61ec73f0f2d3081cc17ac821f09733a8ba1b896fd73df4d20f148df52f53d3b8", "sha256:ff2c10d6cf27e6a7560c322a49f4d9ca459036f8763998ef99c199b10d5274e4", "sha256:65c8d527ba6024c0282d0763e90b648683ea100cff2d55f7582be6930e85059c", "comfy_extras/nodes_minimax_h3.py", "0a08f185fd1155f18f16757c02553ff48cf365eb", "57500fc5bc92566a63f2046824f522cd55c335ca", false],
  MiniMaxH3SigmaShift: ["sha256:43f5d1ebad50412eaaebbace9e6719ec9ae1e416b08688f3285164cc2e67958f", "sha256:651d5b4ef3a85699db10e47a202aeee3836c9f7f6f25276306c685a77b9cddbc", "sha256:def7b38f215736b2bcfc09aa593097f240fde31c32266c8f1b032e11b5e561b8", "comfy_extras/nodes_minimax_h3.py", "0a08f185fd1155f18f16757c02553ff48cf365eb", "57500fc5bc92566a63f2046824f522cd55c335ca", false],
  CreateVideo: ["sha256:1281b8e8dce7e78910d22ae1add69c26a37d140189009e5653bff70024d44101", "sha256:ec146e9038deeadf99d62e2cf3af5025f9b6e0a78019f9f937d0f30671a05a0c", "sha256:cb95bed0f73f12f7c4b215c32bc3e70d13472d28f9fe621312df9ff45eda823d", "comfy_extras/nodes_video.py", "58f58aaf4daecd08e3b7488c5f313377e6f527e2", "68f0d3529667a2b34b27cc0ac5051bc0e8c45b49", false],
  SaveVideo: ["sha256:a5478ce0c6b7c398c0b4775514b7cd206f20511f37f53a5e97e454caa6fb7581", "sha256:cd23616031d7bc8462ec3e910be4f8061f98844643f0e187a51a139f72133e7d", "sha256:1ec11f525cacbf909a4527a3ec54df0d8d065b1ecc07229178a1d9a101f93996", "comfy_extras/nodes_video.py", "58f58aaf4daecd08e3b7488c5f313377e6f527e2", "68f0d3529667a2b34b27cc0ac5051bc0e8c45b49", true]
};

const PARTNER_API = new Set(["MinimaxTextToVideoNode", "MinimaxImageToVideoNode", "MinimaxSubjectToVideoNode", "MinimaxHailuoVideoNode", "MinimaxHailuo03TextToVideoNode", "MinimaxHailuo03FirstLastFrameNode", "MinimaxHailuo03ReferenceNode", "MinimaxHailuo03ContextIRNode", "MinimaxHailuo03RegenerateNode"]);
const NODE_ROOT_FIELDS = new Set(["contract_id", "schema_version", "document_id", "document_revision", "allowlist_id", "scope", "fingerprint_profile", "evidence_sources", "entries", "forbidden_identities", "disposition", "extensions", "integrity"]);
const CAP_ROOT_FIELDS = new Set(["contract_id", "schema_version", "document_id", "document_revision", "catalog_id", "authority", "upstreams", "evidence_sources", "node_allowlist_ref", "capabilities", "disposition", "extensions", "integrity"]);
const CAP_FIELDS = new Set(["capability_id", "publication_status", "evidence_status", "evidence_source_ids", "required_class_types", "gates", "prerequisites", "disposition"]);

function firstUnknown(object, allowed, pointer, ruleId) {
  for (const key of Object.keys(object)) if (!allowed.has(key)) return error("CONTRACT.UNKNOWN_FIELD", `${pointer}/${key}`, ruleId);
  return null;
}

function verifyIntegrity(document) {
  if (!document.integrity || document.integrity.content_sha256 !== documentContentHash(document)) {
    return error("CONTRACT.INTEGRITY_MISMATCH", "/integrity/content_sha256", "contract.integrity.jcs_sha256");
  }
  return null;
}

function validateExtensions(document) {
  if (!("extensions" in document)) return null;
  for (const [namespace, extension] of Object.entries(document.extensions)) {
    if (!/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9_]*){2,}$/.test(namespace)) return error("CONTRACT.INVALID_EXTENSION", `/extensions/${namespace}`, "contract.extension.namespace");
    if (!extension || extension.effect !== "display_metadata") return error("CONTRACT.OPERATIONAL_EXTENSION_FORBIDDEN", `/extensions/${namespace}/effect`, "contract.extension.display_only");
    const keys = Object.keys(extension);
    for (const key of keys) if (!["extension_version", "effect", "data"].includes(key)) return error("CONTRACT.UNKNOWN_FIELD", `/extensions/${namespace}/${key}`, "contract.extension.object.closed");
  }
  return null;
}

function validateNodeAllowlist(document) {
  let e = firstUnknown(document, NODE_ROOT_FIELDS, "", "node-allowlist.object.closed");
  if (e) return e;
  if (document.contract_id !== "minimax-h3-tool.node-allowlist" || document.schema_version !== "1.0.0") return error("CONTRACT.UNKNOWN_CONTRACT", "/contract_id", "node-allowlist.envelope.exact");
  e = validateExtensions(document); if (e) return e;
  const seenClass = new Set();
  const seenDisplay = new Map();
  for (let index = 0; index < document.entries.length; index += 1) {
    const entry = document.entries[index];
    const prefix = `/entries/${index}`;
    if (PARTNER_API.has(entry.class_type)) return error("NODE.PARTNER_API_FORBIDDEN", `${prefix}/class_type`, "node.identity.partner_api_forbidden");
    if (entry.display_name && seenDisplay.has(entry.display_name) && seenDisplay.get(entry.display_name) !== entry.class_type) return error("NODE.DISPLAY_NAME_COLLISION", `${prefix}/display_name`, "node.identity.display_name_non_authoritative");
    if (entry.display_name) seenDisplay.set(entry.display_name, entry.class_type);
    if (!(entry.class_type in KNOWN_NODES)) return error("NODE.UNKNOWN_CLASS_TYPE", `${prefix}/class_type`, "node.identity.class_type_known");
    if (seenClass.has(entry.class_type)) return error("NODE.DUPLICATE_CLASS_TYPE", `${prefix}/class_type`, "node.identity.class_type_unique");
    seenClass.add(entry.class_type);
    const [input, output, combined, sourcePath, blob, introduced, isOutput] = KNOWN_NODES[entry.class_type];
    if (entry.schema_fingerprints.input_schema_sha256 !== input) return error("NODE.INPUT_SCHEMA_DRIFT", `${prefix}/schema_fingerprints/input_schema_sha256`, "node.identity.input_schema_exact");
    if (entry.schema_fingerprints.output_schema_sha256 !== output) return error("NODE.OUTPUT_SCHEMA_DRIFT", `${prefix}/schema_fingerprints/output_schema_sha256`, "node.identity.output_schema_exact");
    if (entry.schema_fingerprints.combined_schema_sha256 !== combined) return error("NODE.COMBINED_SCHEMA_DRIFT", `${prefix}/schema_fingerprints/combined_schema_sha256`, "node.identity.combined_schema_exact");
    if (entry.origin.locked_revision !== "d8e7bbc9d586d95f758d6b0ed23d519088be578a") return error("NODE.ORIGIN_REVISION_DRIFT", `${prefix}/origin/locked_revision`, "node.identity.origin_revision_exact");
    if (entry.origin.source_path !== sourcePath || entry.origin.git_blob_sha !== blob || entry.origin.first_introduced_revision !== introduced) return error("NODE.ORIGIN_DRIFT", `${prefix}/origin`, "node.identity.origin_exact");
    if (entry.flags.local_only !== true || entry.flags.is_api_node !== false || entry.flags.is_output_node !== isOutput) return error("NODE.NONLOCAL_OR_API_FORBIDDEN", `${prefix}/flags`, "node.identity.local_flags_exact");
    if (entry.disposition?.kind !== "active") return error("NODE.IDENTITY_NOT_ACTIVE", `${prefix}/disposition/kind`, "node.identity.active_required");
  }
  const forbidden = new Set(document.forbidden_identities.map((item) => item.class_type));
  for (const classType of PARTNER_API) if (!forbidden.has(classType)) return error("NODE.FORBIDDEN_SEED_INCOMPLETE", "/forbidden_identities", "node.partner_api.seed_complete");
  e = verifyIntegrity(document); if (e) return e;
  return null;
}

const FEATURE_GATES = ["route", "duration", "prompt", "endpoint", "audio"];
const PREREQUISITES = ["hardware", "runtime", "license"];

function validateCapabilityCatalog(document, allowlist, nodeSchemaDigest) {
  let e = firstUnknown(document, CAP_ROOT_FIELDS, "", "capability-catalog.object.closed");
  if (e) return e;
  if (document.contract_id !== "minimax-h3-tool.capability-catalog" || document.schema_version !== "1.0.0") return error("CONTRACT.UNKNOWN_CONTRACT", "/contract_id", "capability.envelope.exact");
  e = validateExtensions(document); if (e) return e;
  for (let index = 0; index < document.capabilities.length; index += 1) {
    const capability = document.capabilities[index];
    const prefix = `/capabilities/${index}`;
    e = firstUnknown(capability, CAP_FIELDS, prefix, "capability.object.closed"); if (e) return e;
    for (const name of FEATURE_GATES) if (!capability.gates || !(name in capability.gates)) return error("CAPABILITY.GATE_REQUIRED", `${prefix}/gates/${name}`, `capability.feature.${name}.required`);
    for (const name of PREREQUISITES) if (!capability.prerequisites || !(name in capability.prerequisites)) return error("CAPABILITY.GATE_REQUIRED", `${prefix}/prerequisites/${name}`, `capability.prerequisite.${name}.required`);
    for (const name of FEATURE_GATES) if (capability.gates[name].kind !== name) return error("CAPABILITY.GATE_KIND_MISMATCH", `${prefix}/gates/${name}/kind`, `capability.feature.${name}.kind_exact`);
    for (const name of PREREQUISITES) if (capability.prerequisites[name].kind !== name) return error("CAPABILITY.GATE_KIND_MISMATCH", `${prefix}/prerequisites/${name}/kind`, `capability.prerequisite.${name}.kind_exact`);
    if (capability.disposition?.kind !== "active" && capability.publication_status !== "blocked") return error("CAPABILITY.NONACTIVE_MUST_BE_BLOCKED", `${prefix}/publication_status`, "capability.disposition.nonactive_blocked");
    if (capability.publication_status === "stable") {
      if (capability.evidence_status !== "proven") return error("CAPABILITY.STABLE_REQUIRES_PROVEN", `${prefix}/evidence_status`, "capability.stable.evidence.proven");
      for (const name of FEATURE_GATES) if (capability.gates[name].evidence_status !== "proven" || capability.gates[name].readiness !== "passed") return error("CAPABILITY.STABLE_GATE_NOT_PASSED", `${prefix}/gates/${name}`, `capability.stable.${name}.passed`);
      for (const name of PREREQUISITES) if (capability.prerequisites[name].evidence_status !== "proven" || capability.prerequisites[name].readiness !== "passed") return error("CAPABILITY.STABLE_GATE_NOT_PASSED", `${prefix}/prerequisites/${name}`, `capability.stable.${name}.passed`);
    }
  }
  const ref = document.node_allowlist_ref;
  if (ref.schema_content_sha256 !== nodeSchemaDigest) return error("CAPABILITY.ALLOWLIST_SCHEMA_STALE", "/node_allowlist_ref/schema_content_sha256", "capability.node_allowlist_ref.schema_exact");
  if (ref.source_document_id !== allowlist.document_id || ref.source_document_revision !== allowlist.document_revision || ref.source_content_sha256 !== allowlist.integrity.content_sha256) return error("CAPABILITY.ALLOWLIST_REFERENCE_STALE", "/node_allowlist_ref/source_content_sha256", "capability.node_allowlist_ref.content_exact");
  const allowlisted = new Set(allowlist.entries.filter((entry) => entry.disposition.kind === "active").map((entry) => entry.class_type));
  for (let index = 0; index < document.capabilities.length; index += 1) for (const classType of document.capabilities[index].required_class_types) if (!allowlisted.has(classType)) return error("CAPABILITY.NODE_NOT_ALLOWLISTED", `/capabilities/${index}/required_class_types`, "capability.nodes.all_exact_allowlisted");
  e = verifyIntegrity(document); if (e) return e;
  return null;
}

function validateFixture(document, allowlist, nodeSchemaDigest) {
  if (document.contract_id === "minimax-h3-tool.node-allowlist") return validateNodeAllowlist(document);
  if (document.contract_id === "minimax-h3-tool.capability-catalog") return validateCapabilityCatalog(document, allowlist, nodeSchemaDigest);
  return error("CONTRACT.UNKNOWN_CONTRACT", "/contract_id", "contract.envelope.known");
}

function validateCaseShape(testCase) {
  const allowed = new Set(["fixture_case_version", "case_id", "base", "mutations", "expected"]);
  for (const key of Object.keys(testCase)) if (!allowed.has(key)) fail(`${testCase.case_id ?? "case"}: unknown case field ${key}`);
  if (testCase.fixture_case_version !== "1.0.0" || !Array.isArray(testCase.mutations) || testCase.mutations.length === 0) fail(`${testCase.case_id}: invalid case envelope`);
  if (!/^valid\/[a-z0-9-]+\.json$/.test(testCase.base)) fail(`${testCase.case_id}: base must be a fixed fixture-relative locator`);
}

function sanitizePublicEvidence() {
  const optionalFiles = [
    path.join(ROOT, "schemas/capability-catalog/README.md"),
    path.join(ROOT, "schemas/node-allowlist/README.md"),
    path.join(ROOT, "docs/evidence/CAPABILITY_SCHEMA.md"),
    path.join(HERE, "README.md"),
    path.join(HERE, "validate.mjs")
  ].filter((file) => fs.existsSync(file));
  const files = [CAPABILITY_SCHEMA_PATH, NODE_SCHEMA_PATH, ...optionalFiles, ...fs.readdirSync(VALID_DIR).map((name) => path.join(VALID_DIR, name)), ...fs.readdirSync(CASES_DIR).map((name) => path.join(CASES_DIR, name))];
  const privatePathPattern = /[A-Za-z]:[\\/]Users[\\/][^\\/\s"']+/i;
  const currentUser = (process.env.USERNAME ?? "").trim().toLowerCase();
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    if (privatePathPattern.test(text)) fail(`public evidence contains a private absolute path in ${path.basename(file)}`);
    if (currentUser.length >= 3 && text.toLowerCase().includes(currentUser)) fail(`public evidence contains the current username in ${path.basename(file)}`);
  }
  return files.length;
}

function run() {
  const capabilitySchema = readJson(CAPABILITY_SCHEMA_PATH);
  const nodeSchema = readJson(NODE_SCHEMA_PATH);
  lintSchema(capabilitySchema, "urn:minimax-h3-tool:schema:capability-catalog:1.0.0");
  lintSchema(nodeSchema, "urn:minimax-h3-tool:schema:node-allowlist:1.0.0");
  const capabilitySchemaDigest = sha256(capabilitySchema);
  const nodeSchemaDigest = sha256(nodeSchema);

  const allowlistPath = path.join(VALID_DIR, "alpha0-local-node-allowlist.json");
  const catalogPath = path.join(VALID_DIR, "alpha0-t2va-capability.json");
  const allowlist = readJson(allowlistPath);
  const catalog = readJson(catalogPath);
  assertSchemaValid(allowlist, nodeSchema, "valid allowlist");
  assertSchemaValid(catalog, capabilitySchema, "valid capability catalog");
  let result = validateNodeAllowlist(allowlist);
  if (result) fail(`valid allowlist rejected: ${canonicalJson(result)}`);
  result = validateCapabilityCatalog(catalog, allowlist, nodeSchemaDigest);
  if (result) fail(`valid capability catalog rejected: ${canonicalJson(result)}`);

  const caseFiles = fs.readdirSync(CASES_DIR).filter((name) => name.endsWith(".json")).sort();
  let negativeCount = 0;
  let positiveMutationCount = 0;
  const caseLines = [];
  for (const fileName of caseFiles) {
    const testCase = readJson(path.join(CASES_DIR, fileName));
    validateCaseShape(testCase);
    const document = readJson(path.join(HERE, testCase.base));
    for (const mutation of testCase.mutations) mutate(document, mutation);
    refreshIntegrity(document);
    const actual = validateFixture(document, allowlist, nodeSchemaDigest);
    if (testCase.expected === "valid") {
      if (actual !== null) fail(`${testCase.case_id}: expected valid but got ${canonicalJson(actual)}`);
      assertSchemaValid(document, document.contract_id === "minimax-h3-tool.node-allowlist" ? nodeSchema : capabilitySchema, testCase.case_id);
      positiveMutationCount += 1;
    } else {
      if (actual === null) fail(`${testCase.case_id}: expected rejection but document was accepted`);
      assertExact(actual, testCase.expected, testCase.case_id);
      negativeCount += 1;
    }
    caseLines.push(`PASS case ${testCase.case_id}`);
  }
  const sanitizedFileCount = sanitizePublicEvidence();
  console.log(`PASS schema capability-catalog ${capabilitySchemaDigest}`);
  console.log(`PASS schema node-allowlist ${nodeSchemaDigest}`);
  console.log("PASS valid alpha0-local-node-allowlist");
  console.log("PASS valid alpha0-t2va-capability");
  for (const line of caseLines) console.log(line);
  console.log(`PASS sanitized public evidence (${sanitizedFileCount} files)`);
  console.log(`SUMMARY schemas=2 valid_contracts=2 negative_cases=${negativeCount} valid_mutation_cases=${positiveMutationCount}`);
}

run();
