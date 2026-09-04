import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../../..");
const VALID_DIR = path.join(HERE, "valid");
const CASES_DIR = path.join(HERE, "cases");
const HARDWARE_SCHEMA_PATH = path.join(ROOT, "schemas/hardware-report/1.0.0.schema.json");
const MODEL_SCHEMA_PATH = path.join(ROOT, "schemas/model-registry/1.0.0.schema.json");

const MAX_BYTES = 16 * 1024 * 1024;
const MAX_DEPTH = 64;
const MAX_VALUES = 200_000;
const MAX_OBJECT_PROPERTIES = 10_000;
const MAX_ARRAY_ITEMS = 10_000;
const MAX_KEY_BYTES = 128;
const MAX_STRING_BYTES = 1024 * 1024;
const MAX_TOTAL_STRING_BYTES = 12 * 1024 * 1024;
const MAX_ERRORS = 256;
const SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const SENSITIVE = new Set(["public", "internal", "local_path", "prompt", "asset_name", "account", "token", "personal_data"]);
const TRUST_ORDER = ["display", "observation", "execution", "ownership", "path", "artifact", "graph", "recovery"];
const CONSTRAINT_KEYS = new Set(["$ref", "type", "const", "enum", "required", "properties", "additionalProperties", "unevaluatedProperties", "items", "minItems", "maxItems", "uniqueItems", "minProperties", "maxProperties", "propertyNames", "pattern", "format", "minLength", "maxLength", "minimum", "maximum", "oneOf", "allOf", "if", "then", "else"]);

function fail(message) {
  throw new Error(message);
}

function normalizedError(code, instancePath, ruleId, byteOffset) {
  const out = { code, instance_path: instancePath, rule_id: ruleId };
  if (byteOffset !== undefined) out.byte_offset = byteOffset;
  return out;
}

class ParseFailure extends Error {
  constructor(error) {
    super(error.code);
    this.normalized = error;
  }
}

function parseFail(code, ruleId, text, position, includeOffset = true) {
  const offset = includeOffset ? Buffer.byteLength(text.slice(0, position), "utf8") : undefined;
  throw new ParseFailure(normalizedError(code, "", ruleId, offset));
}

class StrictJsonParser {
  constructor(text) {
    this.text = text;
    this.pos = 0;
    this.values = 0;
    this.totalStringBytes = 0;
  }

  parse() {
    this.skipWhitespace();
    const value = this.parseValue(0);
    this.skipWhitespace();
    if (this.pos !== this.text.length) parseFail("CONTRACT.INVALID_JSON", "contract.parse.trailing_content", this.text, this.pos);
    return value;
  }

  skipWhitespace() {
    while (this.pos < this.text.length && /[\u0009\u000a\u000d\u0020]/.test(this.text[this.pos])) this.pos += 1;
  }

  count(depth) {
    if (depth > MAX_DEPTH) parseFail("CONTRACT.LIMIT_EXCEEDED", "contract.limit.depth", this.text, this.pos);
    this.values += 1;
    if (this.values > MAX_VALUES) parseFail("CONTRACT.LIMIT_EXCEEDED", "contract.limit.values", this.text, this.pos);
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
        try { value = JSON.parse(this.text.slice(start, this.pos)); }
        catch { parseFail("CONTRACT.INVALID_JSON", "contract.parse.string", this.text, start); }
        const bytes = Buffer.byteLength(value, "utf8");
        if (bytes > MAX_STRING_BYTES) parseFail("CONTRACT.LIMIT_EXCEEDED", "contract.limit.string_bytes", this.text, start);
        this.totalStringBytes += bytes;
        if (this.totalStringBytes > MAX_TOTAL_STRING_BYTES) parseFail("CONTRACT.LIMIT_EXCEEDED", "contract.limit.total_string_bytes", this.text, start);
        for (let index = 0; index < value.length; index += 1) {
          const current = value.charCodeAt(index);
          if (current >= 0xd800 && current <= 0xdbff) {
            const next = value.charCodeAt(index + 1);
            if (!(next >= 0xdc00 && next <= 0xdfff)) parseFail("CONTRACT.INVALID_JSON", "contract.parse.unpaired_surrogate", this.text, start);
            index += 1;
          } else if (current >= 0xdc00 && current <= 0xdfff) parseFail("CONTRACT.INVALID_JSON", "contract.parse.unpaired_surrogate", this.text, start);
        }
        if (value.includes("\u0000")) parseFail("CONTRACT.INVALID_JSON", "contract.parse.nul_forbidden", this.text, start);
        return value;
      }
      if (code < 0x20) parseFail("CONTRACT.INVALID_JSON", "contract.parse.unescaped_control", this.text, this.pos);
      if (ch === "\\") {
        this.pos += 1;
        const escape = this.text[this.pos];
        if (!'"\\/bfnrtu'.includes(escape ?? "")) parseFail("CONTRACT.INVALID_JSON", "contract.parse.escape", this.text, this.pos);
        if (escape === "u") {
          const hex = this.text.slice(this.pos + 1, this.pos + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) parseFail("CONTRACT.INVALID_JSON", "contract.parse.unicode_escape", this.text, this.pos);
          this.pos += 4;
        }
      }
      this.pos += 1;
    }
    parseFail("CONTRACT.INVALID_JSON", "contract.parse.unterminated_string", this.text, start);
  }

  parseInteger() {
    const start = this.pos;
    const rest = this.text.slice(start);
    const match = /^-?(?:0|[1-9][0-9]*)/.exec(rest);
    if (!match) parseFail("CONTRACT.INVALID_JSON", "contract.parse.value", this.text, start);
    const token = match[0];
    const end = start + token.length;
    if (token === "-0" || /[.eE]/.test(this.text[end] ?? "")) parseFail("CONTRACT.INVALID_JSON", "contract.parse.integer_lexical", this.text, start);
    const value = Number(token);
    if (!Number.isSafeInteger(value) || Math.abs(value) > SAFE_INTEGER) parseFail("CONTRACT.INVALID_JSON", "contract.parse.safe_integer", this.text, start);
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
      if (this.text[this.pos] !== '"') parseFail("CONTRACT.INVALID_JSON", "contract.parse.object_key", this.text, this.pos);
      const keyStart = this.pos;
      const key = this.parseString();
      if (Buffer.byteLength(key, "utf8") > MAX_KEY_BYTES) parseFail("CONTRACT.LIMIT_EXCEEDED", "contract.limit.key_bytes", this.text, keyStart);
      if (keys.has(key)) parseFail("CONTRACT.DUPLICATE_KEY", "contract.parse.duplicate_key", this.text, keyStart);
      keys.add(key);
      if (keys.size > MAX_OBJECT_PROPERTIES) parseFail("CONTRACT.LIMIT_EXCEEDED", "contract.limit.object_properties", this.text, keyStart);
      this.skipWhitespace();
      if (this.text[this.pos] !== ":") parseFail("CONTRACT.INVALID_JSON", "contract.parse.colon", this.text, this.pos);
      this.pos += 1;
      this.skipWhitespace();
      out[key] = this.parseValue(depth);
      this.skipWhitespace();
      const ch = this.text[this.pos];
      if (ch === "}") { this.pos += 1; return out; }
      if (ch !== ",") parseFail("CONTRACT.INVALID_JSON", "contract.parse.comma", this.text, this.pos);
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
      if (out.length >= MAX_ARRAY_ITEMS) parseFail("CONTRACT.LIMIT_EXCEEDED", "contract.limit.array_items", this.text, this.pos);
      out.push(this.parseValue(depth));
      this.skipWhitespace();
      const ch = this.text[this.pos];
      if (ch === "]") { this.pos += 1; return out; }
      if (ch !== ",") parseFail("CONTRACT.INVALID_JSON", "contract.parse.comma", this.text, this.pos);
      this.pos += 1;
      this.skipWhitespace();
    }
  }
}

function parseBytes(bytes) {
  if (bytes.length > MAX_BYTES) throw new ParseFailure(normalizedError("CONTRACT.INPUT_TOO_LARGE", "", "contract.limit.document_bytes"));
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) throw new ParseFailure(normalizedError("CONTRACT.INVALID_UTF8", "", "contract.parse.utf8_no_bom", 0));
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new ParseFailure(normalizedError("CONTRACT.INVALID_UTF8", "", "contract.parse.valid_utf8")); }
  return new StrictJsonParser(text).parse();
}

function readJson(filePath) {
  return parseBytes(fs.readFileSync(filePath));
}

function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) fail("canonical JSON accepts safe integers only");
    return String(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  fail("unsupported canonical JSON value");
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
  if (!document.integrity || typeof document.integrity !== "object") document.integrity = { profile: "rfc8785-sha256-v1", content_sha256: "sha256:" + "0".repeat(64) };
  document.integrity.content_sha256 = documentContentHash(document);
}

function pointerEscape(value) {
  return String(value).replace(/~/g, "~0").replace(/\//g, "~1");
}

function pointerParts(pointer) {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) fail("invalid JSON Pointer in fixture");
  return pointer.slice(1).split("/").map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function atPointer(document, pointer) {
  let current = document;
  for (const part of pointerParts(pointer)) {
    if (current === null || typeof current !== "object" || !(part in current)) fail("fixture pointer not found");
    current = current[part];
  }
  return current;
}

function parentAtPointer(document, pointer) {
  const parts = pointerParts(pointer);
  if (!parts.length) fail("fixture cannot replace root");
  const key = parts.pop();
  let parent = document;
  for (const part of parts) {
    if (parent === null || typeof parent !== "object" || !(part in parent)) fail("fixture pointer not found");
    parent = parent[part];
  }
  return { parent, key };
}

function mutate(document, mutation) {
  const allowed = new Set(["op", "path", "from", "value"]);
  for (const key of Object.keys(mutation)) if (!allowed.has(key)) fail("unknown fixture mutation field");
  const { parent, key } = parentAtPointer(document, mutation.path);
  if (mutation.op === "remove") {
    if (!(key in parent)) fail("fixture remove pointer not found");
    if (Array.isArray(parent)) parent.splice(Number(key), 1); else delete parent[key];
    return;
  }
  let value;
  if (mutation.op === "copy") value = structuredClone(atPointer(document, mutation.from));
  else if (mutation.op === "add" || mutation.op === "replace") value = structuredClone(mutation.value);
  else fail("unsupported fixture mutation op");
  if (Array.isArray(parent)) {
    if (key === "-") parent.push(value);
    else if (mutation.op === "add" || mutation.op === "copy") parent.splice(Number(key), 0, value);
    else parent[Number(key)] = value;
  } else {
    if (mutation.op === "replace" && !(key in parent)) fail("fixture replace pointer not found");
    parent[key] = value;
  }
}

function resolveLocalRef(rootSchema, reference) {
  if (!reference.startsWith("#/")) fail("non-local schema reference");
  let current = rootSchema;
  for (const part of pointerParts(reference.slice(1))) {
    if (current === null || typeof current !== "object" || !(part in current)) fail("unresolved schema reference");
    current = current[part];
  }
  return current;
}

function lintSchema(schema, expectedId) {
  if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") fail(`${expectedId}: wrong JSON Schema draft`);
  if (schema.$id !== expectedId) fail(`${expectedId}: wrong immutable schema id`);
  if (schema.additionalProperties !== false) fail(`${expectedId}: root object is not closed`);
  const seenRuleIds = new Map();
  const failures = [];

  function walk(value, pointer, inConditional = false) {
    if (value === null || typeof value !== "object") return;
    if (typeof value.$ref === "string" && !value.$ref.startsWith("#/")) failures.push(`${pointer}: non-local ref`);
    const isConstraint = Object.keys(value).some((key) => CONSTRAINT_KEYS.has(key));
    if (isConstraint) {
      if (!/^[A-Z][A-Z0-9_]*(?:\.[A-Z][A-Z0-9_]*)+$/.test(value["x-error-code"] ?? "")) failures.push(`${pointer || "/"}: missing error code`);
      if (!/^[a-z0-9_.]+$/.test(value["x-rule-id"] ?? "")) failures.push(`${pointer || "/"}: missing rule id`);
      else if (seenRuleIds.has(value["x-rule-id"])) failures.push(`${pointer || "/"}: duplicate rule id`);
      else seenRuleIds.set(value["x-rule-id"], pointer || "/");
    }
    if (value.type === "object" && value.additionalProperties !== false) {
      const allowedOpen = pointer.endsWith("/$defs/extension/properties/data") || pointer.endsWith("/$defs/extensions");
      if (!allowedOpen) failures.push(`${pointer || "/"}: object not closed`);
    }
    if (value.properties && !inConditional) {
      for (const [name, propertySchema] of Object.entries(value.properties)) {
        const propertyPointer = `${pointer}/properties/${pointerEscape(name)}`;
        if (!SENSITIVE.has(propertySchema["x-sensitive"])) failures.push(`${propertyPointer}: invalid sensitivity`);
        const impacts = propertySchema["x-trust-impact"];
        if (!Array.isArray(impacts) || impacts.length === 0 || new Set(impacts).size !== impacts.length || impacts.some((item) => !TRUST_ORDER.includes(item))) failures.push(`${propertyPointer}: invalid trust impact`);
        else {
          const ordered = [...impacts].sort((left, right) => TRUST_ORDER.indexOf(left) - TRUST_ORDER.indexOf(right));
          if (canonicalJson(ordered) !== canonicalJson(impacts)) failures.push(`${propertyPointer}: trust impact order`);
        }
      }
    }
    for (const [key, child] of Object.entries(value)) {
      const conditional = inConditional || key === "if" || key === "then" || key === "else";
      if (Array.isArray(child)) child.forEach((item, index) => walk(item, `${pointer}/${pointerEscape(key)}/${index}`, conditional));
      else walk(child, `${pointer}/${pointerEscape(key)}`, conditional);
    }
  }

  walk(schema, "");
  if (failures.length) fail(`${expectedId}: schema lint failed: ${failures.slice(0, 12).join("; ")}`);
}

function calendarUtcDateTimeMs(value) {
  if (typeof value !== "string" || !/^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$/.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function windowsAbsolutePath(value) {
  if (typeof value !== "string" || !/^[A-Z]:\\/.test(value) || value.length > 32767) return false;
  if (/^(?:\\\\|\\\\[?.]\\)/.test(value) || /[\u0000-\u001f]/.test(value) || /[\/]/.test(value.slice(3))) return false;
  if (value.length > 3 && value.endsWith("\\")) return false;
  const segments = value.slice(3).split("\\");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || /[. ]$/.test(segment) || /:/.test(segment) || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(segment))) return false;
  return true;
}

function contractRelativePath(value) {
  if (typeof value !== "string" || !value || value.length > 4096 || value.startsWith("/") || value.includes("\\") || value.includes(":")) return false;
  const segments = value.split("/");
  return !segments.some((segment) => !segment || segment === "." || segment === ".." || Buffer.byteLength(segment, "utf8") > 255 || /%2e|%2f|%5c/i.test(segment));
}

function formatValid(value, format) {
  if (format === "utc-date-time-ms") return calendarUtcDateTimeMs(value);
  if (format === "windows-absolute-path") return windowsAbsolutePath(value);
  if (format === "contract-relative-path") return contractRelativePath(value);
  fail("unknown asserted format");
}

function schemaError(schema, instancePath, keyword, overrideCode, overrideRule) {
  return normalizedError(overrideCode ?? schema["x-error-code"] ?? "CONTRACT.SCHEMA_CONSTRAINT", instancePath, overrideRule ?? schema["x-rule-id"] ?? "contract.schema.unknown");
}

function resolvedSchema(schema, rootSchema) {
  let current = schema;
  const seen = new Set();
  while (current && typeof current === "object" && current.$ref) {
    if (seen.has(current.$ref)) fail("cyclic local schema ref");
    seen.add(current.$ref);
    current = resolveLocalRef(rootSchema, current.$ref);
  }
  return current;
}

function branchDiscriminator(branch, rootSchema) {
  const resolved = resolvedSchema(branch, rootSchema);
  for (const key of ["kind", "stage"]) {
    const value = resolved?.properties?.[key]?.const;
    if (value !== undefined) return { key, value };
  }
  return undefined;
}

function schemaErrors(instance, schema, rootSchema, instancePath = "") {
  if (schema === true) return [];
  if (schema === false) return [schemaError({}, instancePath, "false")];
  if (schema.$ref) return schemaErrors(instance, resolveLocalRef(rootSchema, schema.$ref), rootSchema, instancePath);
  const errors = [];

  if (schema.const !== undefined && canonicalJson(instance) !== canonicalJson(schema.const)) errors.push(schemaError(schema, instancePath, "const"));
  if (schema.enum && !schema.enum.some((candidate) => canonicalJson(candidate) === canonicalJson(instance))) errors.push(schemaError(schema, instancePath, "enum", "CONTRACT.UNKNOWN_ENUM"));
  if (schema.type) {
    const matches = schema.type === "object" ? instance !== null && typeof instance === "object" && !Array.isArray(instance)
      : schema.type === "array" ? Array.isArray(instance)
      : schema.type === "string" ? typeof instance === "string"
      : schema.type === "integer" ? Number.isSafeInteger(instance)
      : schema.type === "boolean" ? typeof instance === "boolean"
      : schema.type === "null" ? instance === null
      : false;
    if (!matches) return [...errors, schemaError(schema, instancePath, "type")];
  }
  if (schema.allOf) for (const branch of schema.allOf) errors.push(...schemaErrors(instance, branch, rootSchema, instancePath));
  if (schema.oneOf) {
    const discriminators = schema.oneOf.map((branch) => ({ branch, discriminator: branchDiscriminator(branch, rootSchema) }));
    const key = discriminators.find((item) => item.discriminator)?.discriminator.key;
    if (key && instance !== null && typeof instance === "object" && !Array.isArray(instance) && key in instance) {
      const matching = discriminators.find((item) => item.discriminator?.key === key && item.discriminator.value === instance[key]);
      if (!matching) errors.push(schemaError(schema, `${instancePath}/${pointerEscape(key)}`, "oneOf", "CONTRACT.UNKNOWN_UNION_KIND"));
      else errors.push(...schemaErrors(instance, matching.branch, rootSchema, instancePath));
    } else {
      const results = schema.oneOf.map((branch) => schemaErrors(instance, branch, rootSchema, instancePath));
      if (results.filter((result) => result.length === 0).length !== 1) errors.push(schemaError(schema, instancePath, "oneOf", "CONTRACT.UNKNOWN_UNION_KIND"));
    }
  }
  if (typeof instance === "string") {
    if (schema.minLength !== undefined && [...instance].length < schema.minLength) errors.push(schemaError(schema, instancePath, "minLength"));
    if (schema.maxLength !== undefined && [...instance].length > schema.maxLength) errors.push(schemaError(schema, instancePath, "maxLength"));
    if (schema.pattern && !(new RegExp(schema.pattern).test(instance))) errors.push(schemaError(schema, instancePath, "pattern"));
    if (schema.format && !formatValid(instance, schema.format)) errors.push(schemaError(schema, instancePath, "format"));
  }
  if (Number.isSafeInteger(instance)) {
    if (schema.minimum !== undefined && instance < schema.minimum) errors.push(schemaError(schema, instancePath, "minimum"));
    if (schema.maximum !== undefined && instance > schema.maximum) errors.push(schemaError(schema, instancePath, "maximum"));
  }
  if (Array.isArray(instance)) {
    if (schema.minItems !== undefined && instance.length < schema.minItems) errors.push(schemaError(schema, instancePath, "minItems"));
    if (schema.maxItems !== undefined && instance.length > schema.maxItems) errors.push(schemaError(schema, instancePath, "maxItems"));
    if (schema.uniqueItems) {
      const seen = new Set();
      for (const item of instance) { const key = canonicalJson(item); if (seen.has(key)) errors.push(schemaError(schema, instancePath, "uniqueItems")); seen.add(key); }
    }
    if (schema.items) instance.forEach((item, index) => errors.push(...schemaErrors(item, schema.items, rootSchema, `${instancePath}/${index}`)));
  }
  if (instance !== null && typeof instance === "object" && !Array.isArray(instance)) {
    const keys = Object.keys(instance);
    if (schema.minProperties !== undefined && keys.length < schema.minProperties) errors.push(schemaError(schema, instancePath, "minProperties"));
    if (schema.maxProperties !== undefined && keys.length > schema.maxProperties) errors.push(schemaError(schema, instancePath, "maxProperties"));
    if (schema.required) for (const key of schema.required) if (!(key in instance)) errors.push(schemaError(schema, `${instancePath}/${pointerEscape(key)}`, "required"));
    if (schema.propertyNames) for (const key of keys) errors.push(...schemaErrors(key, schema.propertyNames, rootSchema, `${instancePath}/${pointerEscape(key)}`));
    const declared = new Set(Object.keys(schema.properties ?? {}));
    if (schema.properties) for (const [key, propertySchema] of Object.entries(schema.properties)) if (key in instance) errors.push(...schemaErrors(instance[key], propertySchema, rootSchema, `${instancePath}/${pointerEscape(key)}`));
    for (const key of keys) if (!declared.has(key)) {
      if (schema.additionalProperties === false) errors.push(schemaError(schema, `${instancePath}/${pointerEscape(key)}`, "additionalProperties", "CONTRACT.UNKNOWN_FIELD"));
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") errors.push(...schemaErrors(instance[key], schema.additionalProperties, rootSchema, `${instancePath}/${pointerEscape(key)}`));
    }
  }
  return errors;
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function normalizeErrors(errors) {
  const map = new Map();
  for (const item of errors) map.set(`${item.instance_path}\u0000${item.code}\u0000${item.rule_id}`, item);
  const sorted = [...map.values()].sort((left, right) => compareUtf8(left.instance_path, right.instance_path) || left.code.localeCompare(right.code, "en-US") || left.rule_id.localeCompare(right.rule_id, "en-US"));
  if (sorted.length <= MAX_ERRORS) return sorted;
  return [...sorted.slice(0, MAX_ERRORS - 1), normalizedError("CONTRACT.TOO_MANY_ERRORS", "", "contract.error.limit")];
}

function domainError(code, instancePath, ruleId) {
  return normalizedError(code, instancePath, ruleId);
}

function exactEqual(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function indexBy(items, key, code, pathPrefix, ruleId, errors) {
  const map = new Map();
  items.forEach((item, index) => {
    const value = item[key];
    if (map.has(value)) errors.push(domainError(code, `${pathPrefix}/${index}/${pointerEscape(key)}`, ruleId));
    else map.set(value, item);
  });
  return map;
}

const SOURCE_POLICY = {
  nvml: { tier: "preferred_vendor_api", min: 9000, max: 10000, observations: new Set(["gpu"]) },
  nvidia_smi: { tier: "preferred_vendor_cli", min: 9000, max: 10000, observations: new Set(["gpu"]) },
  nvidia_driver_api: { tier: "preferred_vendor_api", min: 9000, max: 10000, observations: new Set(["gpu"]) },
  windows_system_api: { tier: "os_native", min: 8000, max: 10000, observations: new Set(["host", "volume"]) },
  wmi_cim: { tier: "fallback_wmi", min: 1, max: 4000, observations: new Set(["gpu", "host", "volume"]) },
  unknown: { tier: "unknown", min: 0, max: 0, observations: new Set(["unknown"]) }
};

function collectHardwareClaims(document) {
  const bySubject = new Map();
  for (const source of document.sources) {
    for (const observation of source.observations) {
      const claims = bySubject.get(observation.subject_id) ?? [];
      claims.push({ source, observation });
      bySubject.set(observation.subject_id, claims);
    }
  }
  return bySubject;
}

function gpuClaimValue(observation, metric) {
  if (metric === "gpu_vram_bytes") return observation.vram_bytes;
  if (metric === "gpu_product_name") return observation.product_name;
  if (metric === "gpu_architecture") return observation.architecture;
  if (metric === "gpu_driver_version") return observation.driver_version;
  return undefined;
}

function validateHardware(document) {
  const errors = [];
  const sourceMap = indexBy(document.sources, "source_id", "HARDWARE.DUPLICATE_SOURCE_ID", "/sources", "hardware.source.id_unique", errors);
  const evaluated = Date.parse(document.freshness.evaluated_at_utc);
  const stale = [];
  const unknown = [];

  document.sources.forEach((source, sourceIndex) => {
    const prefix = `/sources/${sourceIndex}`;
    const policy = SOURCE_POLICY[source.source_kind];
    if (policy && source.source_tier !== policy.tier) errors.push(domainError("HARDWARE.SOURCE_TIER_MISMATCH", `${prefix}/source_tier`, "hardware.source.kind_tier_exact"));
    if (policy && (source.confidence_basis_points < policy.min || source.confidence_basis_points > policy.max)) errors.push(domainError("HARDWARE.SOURCE_CONFIDENCE_INVALID", `${prefix}/confidence_basis_points`, "hardware.source.kind_confidence_range"));
    source.observations.forEach((observation, observationIndex) => {
      if (policy && !policy.observations.has(observation.kind)) errors.push(domainError("HARDWARE.SOURCE_OBSERVATION_KIND_INVALID", `${prefix}/observations/${observationIndex}/kind`, "hardware.source.observation_kind_exact"));
    });
    if (source.source_kind === "unknown") {
      unknown.push(source.source_id);
      if (source.freshness_status !== "unknown") errors.push(domainError("HARDWARE.FRESHNESS_MISMATCH", `${prefix}/freshness_status`, "hardware.freshness.source_status_exact"));
      return;
    }
    const observed = Date.parse(source.observed_at_utc);
    const expected = observed > evaluated || evaluated - observed > document.freshness.max_age_ms ? "stale" : "fresh";
    if (expected === "stale") stale.push(source.source_id);
    if (source.freshness_status !== expected) errors.push(domainError("HARDWARE.FRESHNESS_MISMATCH", `${prefix}/freshness_status`, "hardware.freshness.source_status_exact"));
  });

  stale.sort();
  unknown.sort();
  const actualStale = [...document.freshness.stale_source_ids].sort();
  const actualUnknown = [...document.freshness.unknown_source_ids].sort();
  if (!exactEqual(stale, actualStale)) errors.push(domainError("HARDWARE.FRESHNESS_MISMATCH", "/freshness/stale_source_ids", "hardware.freshness.stale_set_exact"));
  if (!exactEqual(unknown, actualUnknown)) errors.push(domainError("HARDWARE.FRESHNESS_MISMATCH", "/freshness/unknown_source_ids", "hardware.freshness.unknown_set_exact"));
  const expectedFreshness = unknown.length && !stale.length ? "unknown" : stale.length && (stale.length < document.sources.length) ? "mixed" : stale.length ? "stale" : "fresh";
  if (document.freshness.status !== expectedFreshness) errors.push(domainError("HARDWARE.FRESHNESS_MISMATCH", "/freshness/status", "hardware.freshness.aggregate_exact"));

  const claims = collectHardwareClaims(document);
  const conflictMap = indexBy(document.conflicts, "conflict_id", "HARDWARE.DUPLICATE_CONFLICT_ID", "/conflicts", "hardware.conflict.id_unique", errors);
  document.conflicts.forEach((conflict, conflictIndex) => {
    for (const sourceId of conflict.source_ids) if (!sourceMap.has(sourceId)) errors.push(domainError("HARDWARE.CONFLICT_SOURCE_UNKNOWN", `/conflicts/${conflictIndex}/source_ids`, "hardware.conflict.sources_exist"));
    if (!claims.has(conflict.subject_id)) errors.push(domainError("HARDWARE.CONFLICT_SUBJECT_UNKNOWN", `/conflicts/${conflictIndex}/subject_id`, "hardware.conflict.subject_exists"));
  });

  const host = document.resolutions.host;
  const hostClaims = (claims.get(host.subject_id) ?? []).filter((item) => item.observation.kind === "host" && host.source_ids.includes(item.source.source_id));
  if (!hostClaims.length) errors.push(domainError("HARDWARE.RESOLUTION_SOURCE_MISSING", "/resolutions/host/source_ids", "hardware.host_resolution.sources_exist"));
  else {
    const expectedHost = hostClaims[0].observation;
    for (const field of ["windows_build", "cpu_architecture", "logical_processor_count", "system_ram_bytes"]) {
      if (host[field] !== expectedHost[field] || hostClaims.some((item) => item.observation[field] !== expectedHost[field])) errors.push(domainError("HARDWARE.RESOLUTION_VALUE_MISMATCH", `/resolutions/host/${field}`, "hardware.host_resolution.values_exact"));
    }
    if (hostClaims.some((item) => item.source.freshness_status !== "fresh")) errors.push(domainError("HARDWARE.SOURCE_STALE", "/resolutions/host/source_ids", "hardware.resolution.fresh_sources_required"));
  }

  document.resolutions.gpus.forEach((resolution, resolutionIndex) => {
    const prefix = `/resolutions/gpus/${resolutionIndex}`;
    const gpuClaims = (claims.get(resolution.subject_id) ?? []).filter((item) => item.observation.kind === "gpu");
    const preferred = gpuClaims.filter((item) => ["nvml", "nvidia_smi", "nvidia_driver_api"].includes(item.source.source_kind) && item.source.freshness_status === "fresh");
    const wmi = gpuClaims.filter((item) => item.source.source_kind === "wmi_cim" && item.source.freshness_status === "fresh");
    const detected = [];
    for (const metric of ["gpu_vram_bytes", "gpu_product_name", "gpu_architecture", "gpu_driver_version"]) {
      const pairs = [];
      for (const left of preferred) for (const right of wmi) if (!exactEqual(gpuClaimValue(left.observation, metric), gpuClaimValue(right.observation, metric))) pairs.push([left.source.source_id, right.source.source_id]);
      for (let leftIndex = 0; leftIndex < preferred.length; leftIndex += 1) for (let rightIndex = leftIndex + 1; rightIndex < preferred.length; rightIndex += 1) {
        if (!exactEqual(gpuClaimValue(preferred[leftIndex].observation, metric), gpuClaimValue(preferred[rightIndex].observation, metric))) pairs.push([preferred[leftIndex].source.source_id, preferred[rightIndex].source.source_id]);
      }
      for (const pair of pairs) detected.push({ metric, pair });
    }
    const vramConflict = detected.find((item) => item.metric === "gpu_vram_bytes");
    if (vramConflict) {
      if (resolution.kind === "resolved") errors.push(domainError("HARDWARE.VRAM_CONFLICT", prefix, "hardware.vram_conflict.fail_closed"));
      const matching = document.conflicts.find((conflict) => conflict.subject_id === resolution.subject_id && conflict.metric === "gpu_vram_bytes" && vramConflict.pair.every((id) => conflict.source_ids.includes(id)));
      if (!matching) errors.push(domainError("HARDWARE.CONFLICT_REQUIRED", prefix, "hardware.vram_conflict.record_required"));
      else if (resolution.kind === "non_actionable" && (!resolution.conflict_ids.includes(matching.conflict_id) || resolution.reason !== "conflicted")) errors.push(domainError("HARDWARE.CONFLICT_MUST_BLOCK", prefix, "hardware.vram_conflict.resolution_blocked"));
    }
    if (resolution.kind === "resolved") {
      if (!preferred.length) errors.push(domainError("HARDWARE.WMI_FALLBACK_NOT_ACTIONABLE", prefix, "hardware.wmi_fallback.never_certifies_gpu"));
      const selectedClaims = gpuClaims.filter((item) => resolution.source_ids.includes(item.source.source_id));
      if (selectedClaims.some((item) => item.source.freshness_status !== "fresh")) errors.push(domainError("HARDWARE.SOURCE_STALE", `${prefix}/source_ids`, "hardware.resolution.fresh_sources_required"));
      if (selectedClaims.some((item) => item.source.confidence_basis_points < 9000)) errors.push(domainError("HARDWARE.SOURCE_CONFIDENCE_INSUFFICIENT", `${prefix}/source_ids`, "hardware.gpu_resolution.preferred_confidence_required"));
      if (!selectedClaims.length) errors.push(domainError("HARDWARE.RESOLUTION_SOURCE_MISSING", `${prefix}/source_ids`, "hardware.gpu_resolution.sources_exist"));
      else {
        const expected = selectedClaims[0].observation;
        const fields = ["vendor", "product_name", "architecture", "compute_capability", "driver_version", "vram_bytes"];
        for (const field of fields) if (!exactEqual(resolution[field], expected[field]) || selectedClaims.some((item) => !exactEqual(item.observation[field], expected[field]))) errors.push(domainError("HARDWARE.RESOLUTION_VALUE_MISMATCH", `${prefix}/${field}`, "hardware.gpu_resolution.values_exact"));
        const confidence = Math.min(...selectedClaims.map((item) => item.source.confidence_basis_points));
        if (resolution.confidence_basis_points !== confidence) errors.push(domainError("HARDWARE.RESOLUTION_CONFIDENCE_MISMATCH", `${prefix}/confidence_basis_points`, "hardware.gpu_resolution.confidence_exact"));
      }
    } else if (resolution.reason === "conflicted" && resolution.conflict_ids.length === 0) errors.push(domainError("HARDWARE.CONFLICT_REQUIRED", `${prefix}/conflict_ids`, "hardware.conflict.nonempty_when_conflicted"));
    for (const conflictId of resolution.conflict_ids ?? []) if (!conflictMap.has(conflictId)) errors.push(domainError("HARDWARE.CONFLICT_REFERENCE_UNKNOWN", `${prefix}/conflict_ids`, "hardware.conflict.reference_exists"));
  });

  document.resolutions.volumes.forEach((resolution, resolutionIndex) => {
    const prefix = `/resolutions/volumes/${resolutionIndex}`;
    const volumeClaims = (claims.get(resolution.subject_id) ?? []).filter((item) => item.observation.kind === "volume" && resolution.source_ids.includes(item.source.source_id));
    if (!volumeClaims.length) errors.push(domainError("HARDWARE.RESOLUTION_SOURCE_MISSING", `${prefix}/source_ids`, "hardware.volume_resolution.sources_exist"));
    else {
      const expected = volumeClaims[0].observation;
      for (const field of ["drive_letter", "drive_type", "filesystem", "capacity_bytes", "free_bytes"]) if (!exactEqual(resolution[field], expected[field]) || volumeClaims.some((item) => !exactEqual(item.observation[field], expected[field]))) errors.push(domainError("HARDWARE.RESOLUTION_VALUE_MISMATCH", `${prefix}/${field}`, "hardware.volume_resolution.values_exact"));
      if (resolution.free_bytes > resolution.capacity_bytes) errors.push(domainError("HARDWARE.VOLUME_CAPACITY_INVALID", `${prefix}/free_bytes`, "hardware.volume.free_not_above_capacity"));
      const eligible = resolution.drive_type === "fixed_local" && resolution.filesystem === "ntfs" && volumeClaims.every((item) => item.source.freshness_status === "fresh" && item.source.confidence_basis_points >= 8000);
      if ((resolution.managed_root_gate === "eligible_for_separate_path_validation") !== eligible) errors.push(domainError("HARDWARE.VOLUME_GATE_INVALID", `${prefix}/managed_root_gate`, "hardware.volume.eligibility_exact"));
    }
  });
  return errors;
}

const STAGES = ["found", "identified", "verified", "compatible", "approved", "selected"];

function stageEvidence(candidate, stage) {
  return candidate.stage_history.find((record) => record.stage === stage)?.evidence;
}

function refTuple(reference) {
  return [reference.contract_id, reference.schema_version, reference.schema_content_sha256, reference.source_document_id, reference.source_document_revision, reference.source_content_sha256];
}

function validatePartyRole(provenance, field, role, prefix, errors) {
  if (provenance[field].role !== role) errors.push(domainError("MODEL.PROVENANCE_ROLE_MISMATCH", `${prefix}/${field}/role`, "model.provenance.party_roles_exact"));
}

function validateModel(document, context) {
  const errors = [];
  indexBy(document.candidates, "candidate_id", "MODEL.DUPLICATE_CANDIDATE_ID", "/candidates", "model.candidate.id_unique", errors);
  const selectedSlots = new Map();

  document.candidates.forEach((candidate, candidateIndex) => {
    const prefix = `/candidates/${candidateIndex}`;
    const historyStages = candidate.stage_history.map((record) => record.stage);
    const expectedPrefix = STAGES.slice(0, historyStages.length);
    if (!exactEqual(historyStages, expectedPrefix)) {
      errors.push(domainError("MODEL.PROGRESSION_SKIPPED", `${prefix}/stage_history`, "model.progression.contiguous_prefix"));
      return;
    }
    if (candidate.current_stage !== historyStages.at(-1)) errors.push(domainError("MODEL.CURRENT_STAGE_MISMATCH", `${prefix}/current_stage`, "model.progression.current_is_last"));
    for (let index = 1; index < candidate.stage_history.length; index += 1) {
      if (Date.parse(candidate.stage_history[index].recorded_at_utc) < Date.parse(candidate.stage_history[index - 1].recorded_at_utc)) errors.push(domainError("MODEL.STAGE_TIME_REGRESSION", `${prefix}/stage_history/${index}/recorded_at_utc`, "model.progression.time_monotonic"));
    }
    const found = stageEvidence(candidate, "found");
    if (found.discovery_scope !== candidate.location.discovery_scope) errors.push(domainError("MODEL.DISCOVERY_SCOPE_MISMATCH", `${prefix}/stage_history/0/evidence/discovery_scope`, "model.discovery.scope_matches_location"));
    if (found.observed_byte_length !== found.file_identity.byte_length) errors.push(domainError("MODEL.FILE_IDENTITY_LENGTH_MISMATCH", `${prefix}/stage_history/0/evidence/file_identity/byte_length`, "model.found.length_identity_exact"));
    if (candidate.stage_history.length > 1 && (found.finding_class !== "candidate" || found.container_hint !== "safetensors")) errors.push(domainError("MODEL.UNSUPPORTED_FORMAT_PROGRESSION", `${prefix}/stage_history/0/evidence/finding_class`, "model.progression.supported_candidate_required"));

    const identified = stageEvidence(candidate, "identified");
    if (identified) {
      if (identified.byte_length !== found.observed_byte_length) errors.push(domainError("MODEL.IDENTIFICATION_LENGTH_MISMATCH", `${prefix}/stage_history/1/evidence/byte_length`, "model.identified.length_matches_found"));
      if (identified.tensor_role !== candidate.model_role) errors.push(domainError("MODEL.ROLE_MISMATCH", `${prefix}/stage_history/1/evidence/tensor_role`, "model.identified.role_matches_candidate"));
      if (identified.manifest_match !== "exact_candidate") errors.push(domainError("MODEL.MANIFEST_MATCH_REQUIRED", `${prefix}/stage_history/1/evidence/manifest_match`, "model.identified.manifest_exact_for_progression"));
    }

    const verified = stageEvidence(candidate, "verified");
    if (verified) {
      if (verified.byte_length !== found.observed_byte_length) errors.push(domainError("MODEL.VERIFIED_LENGTH_MISMATCH", `${prefix}/stage_history/2/evidence/byte_length`, "model.verified.length_matches_found"));
      if (!exactEqual(verified.file_identity, found.file_identity)) errors.push(domainError("MODEL.HASH_CACHE_STALE", `${prefix}/stage_history/2/evidence/file_identity`, "model.verified.file_identity_exact"));
    }

    const compatible = stageEvidence(candidate, "compatible");
    if (compatible) {
      if (compatible.artifact_sha256 !== verified.artifact_sha256) errors.push(domainError("MODEL.ARTIFACT_IDENTITY_DRIFT", `${prefix}/stage_history/3/evidence/artifact_sha256`, "model.progression.artifact_hash_exact"));
      if (compatible.component_role !== candidate.model_role) errors.push(domainError("MODEL.ROLE_MISMATCH", `${prefix}/stage_history/3/evidence/component_role`, "model.compatible.role_matches_candidate"));
      const hardware = context.hardwareById.get(compatible.hardware_report_ref.source_document_id);
      if (!hardware || hardware.integrity.content_sha256 !== compatible.hardware_report_ref.source_content_sha256 || hardware.report_id !== compatible.hardware_report_ref.report_id || context.hardwareSchemaDigest !== compatible.hardware_report_ref.schema_content_sha256) {
        errors.push(domainError("MODEL.HARDWARE_BINDING_STALE", `${prefix}/stage_history/3/evidence/hardware_report_ref`, "model.compatible.hardware_snapshot_exact"));
      } else {
        const gpu = hardware.resolutions.gpus.find((item) => item.subject_id === compatible.gpu_subject_id);
        if (!gpu || gpu.kind !== "resolved") errors.push(domainError("MODEL.HARDWARE_BINDING_NON_ACTIONABLE", `${prefix}/stage_history/3/evidence/gpu_subject_id`, "model.compatible.hardware_gpu_resolved"));
      }
    }

    const approved = stageEvidence(candidate, "approved");
    if (approved) {
      if (approved.artifact_sha256 !== verified.artifact_sha256) errors.push(domainError("MODEL.ARTIFACT_IDENTITY_DRIFT", `${prefix}/stage_history/4/evidence/artifact_sha256`, "model.progression.artifact_hash_exact"));
      const provenance = approved.provenance;
      validatePartyRole(provenance, "creator", "creator", `${prefix}/stage_history/4/evidence/provenance`, errors);
      validatePartyRole(provenance, "publisher", "publisher", `${prefix}/stage_history/4/evidence/provenance`, errors);
      validatePartyRole(provenance, "packager", "packager", `${prefix}/stage_history/4/evidence/provenance`, errors);
      if (provenance.converter.kind === "party" && provenance.converter.party.role !== "converter_or_quantizer") errors.push(domainError("MODEL.PROVENANCE_ROLE_MISMATCH", `${prefix}/stage_history/4/evidence/provenance/converter/party/role`, "model.provenance.converter_role_exact"));
      const sameParty = provenance.creator.party_id === provenance.publisher.party_id && provenance.creator.party_id === provenance.packager.party_id;
      if (provenance.transformation === "original_bytes" && !sameParty) errors.push(domainError("MODEL.PROVENANCE_MISLABEL", `${prefix}/stage_history/4/evidence/provenance/transformation`, "model.provenance.original_requires_same_party"));
      if (provenance.transformation !== "original_bytes" && provenance.creator.party_id === provenance.packager.party_id && provenance.converter.kind === "not_applicable") errors.push(domainError("MODEL.PROVENANCE_MISLABEL", `${prefix}/stage_history/4/evidence/provenance/transformation`, "model.provenance.transformation_parties_exact"));
    }

    const selected = stageEvidence(candidate, "selected");
    if (selected) {
      if (selected.artifact_sha256 !== verified.artifact_sha256) errors.push(domainError("MODEL.ARTIFACT_IDENTITY_DRIFT", `${prefix}/stage_history/5/evidence/artifact_sha256`, "model.progression.artifact_hash_exact"));
      if (selected.model_role !== candidate.model_role) errors.push(domainError("MODEL.ROLE_MISMATCH", `${prefix}/stage_history/5/evidence/model_role`, "model.selected.role_matches_candidate"));
      for (const [field, left, right] of [
        ["recipe_ref", refTuple(selected.recipe_ref), refTuple(compatible.recipe_ref)],
        ["hardware_report_ref", refTuple(selected.hardware_report_ref), refTuple(compatible.hardware_report_ref)],
        ["profile_id", selected.profile_id, compatible.profile_id],
        ["slot_id", selected.slot_id, compatible.slot_id],
        ["gpu_subject_id", selected.gpu_subject_id, compatible.gpu_subject_id],
        ["support_status", selected.support_status, approved.support_status]
      ]) if (!exactEqual(left, right)) errors.push(domainError("MODEL.SELECTION_BINDING_STALE", `${prefix}/stage_history/5/evidence/${field}`, "model.selected.bindings_match_approved_compatible"));
      const slotKey = canonicalJson([refTuple(selected.recipe_ref), selected.profile_id, selected.slot_id, selected.model_role]);
      if (selectedSlots.has(slotKey)) errors.push(domainError("MODEL.DUPLICATE_RECIPE_SLOT_SELECTION", `${prefix}/stage_history/5/evidence/slot_id`, "model.selected.one_candidate_per_recipe_slot"));
      else selectedSlots.set(slotKey, candidate.candidate_id);
    }

    const shouldPermit = candidate.lifecycle_status.kind === "active" && candidate.current_stage === "selected" && candidate.stage_history.length === STAGES.length;
    if (shouldPermit) {
      if (candidate.reuse_decision.kind !== "selected_for_recipe") errors.push(domainError("MODEL.SELECTION_REQUIRED", `${prefix}/reuse_decision`, "model.reuse.selected_only_after_full_progression"));
      else {
        for (const [field, left, right] of [
          ["selection_id", candidate.reuse_decision.selection_id, selected.selection_id],
          ["artifact_sha256", candidate.reuse_decision.artifact_sha256, selected.artifact_sha256],
          ["recipe_ref", refTuple(candidate.reuse_decision.recipe_ref), refTuple(selected.recipe_ref)],
          ["profile_id", candidate.reuse_decision.profile_id, selected.profile_id],
          ["slot_id", candidate.reuse_decision.slot_id, selected.slot_id]
        ]) if (!exactEqual(left, right)) errors.push(domainError("MODEL.REUSE_BINDING_STALE", `${prefix}/reuse_decision/${field}`, "model.reuse.bindings_match_selected"));
      }
    } else if (candidate.reuse_decision.kind !== "not_authorized") {
      const code = candidate.lifecycle_status.kind === "invalidated" ? "MODEL.INVALIDATED_REUSE_FORBIDDEN" : "MODEL.PROGRESSION_INCOMPLETE";
      errors.push(domainError(code, `${prefix}/reuse_decision`, candidate.lifecycle_status.kind === "invalidated" ? "model.invalidated.never_reusable" : "model.reuse.full_progression_required"));
    }
    if (candidate.location.kind === "external_file" && (candidate.location.tool_owned !== false || candidate.location.delete_authority !== "never" || candidate.location.ownership_class !== "external_read_only")) errors.push(domainError("MODEL.EXTERNAL_OWNERSHIP_FORBIDDEN", `${prefix}/location`, "model.external.always_read_only"));
  });
  return errors;
}

function validateEnvelopeAndIntegrity(document, schemas) {
  if (document === null || typeof document !== "object" || Array.isArray(document)) return [domainError("CONTRACT.UNKNOWN_CONTRACT", "", "contract.envelope.object")];
  const schema = schemas.get(document.contract_id);
  if (!schema) return [domainError("CONTRACT.UNKNOWN_CONTRACT", "/contract_id", "contract.envelope.contract_id")];
  if (document.schema_version !== "1.0.0") return [domainError("CONTRACT.UNSUPPORTED_VERSION", "/schema_version", "contract.envelope.schema_version")];
  if (!document.integrity || typeof document.integrity !== "object" || document.integrity.content_sha256 !== documentContentHash(document)) return [domainError("CONTRACT.INTEGRITY_MISMATCH", "/integrity/content_sha256", "contract.integrity.root_content_sha256")];
  return [];
}

function validateDocument(document, schemas, context) {
  const early = validateEnvelopeAndIntegrity(document, schemas);
  if (early.length) return normalizeErrors(early);
  const schema = schemas.get(document.contract_id);
  const shape = normalizeErrors(schemaErrors(document, schema, schema));
  if (shape.length) return shape;
  const domain = document.contract_id === "minimax-h3-tool.hardware-report" ? validateHardware(document) : validateModel(document, context);
  return normalizeErrors(domain);
}

function assertNoErrors(errors, label) {
  if (errors.length) fail(`${label}: ${canonicalJson(errors.slice(0, 8))}`);
}

function tupleProjection(errors) {
  return errors.map(({ code, instance_path, rule_id, byte_offset }) => byte_offset === undefined ? { code, instance_path, rule_id } : { code, instance_path, rule_id, byte_offset });
}

function assertExpected(actualErrors, expected, label) {
  const expectedList = Array.isArray(expected) ? expected : [expected];
  const actual = tupleProjection(actualErrors);
  if (canonicalJson(actual) !== canonicalJson(expectedList)) fail(`${label}: expected ${canonicalJson(expectedList)} got ${canonicalJson(actual)}`);
}

function generatedRawBytes(generator) {
  if (generator === "duplicate_key") return Buffer.from('{"contract_id":"a","contract_id":"b"}', "utf8");
  if (generator === "bom") return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("{}", "utf8")]);
  if (generator === "invalid_utf8") return Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0xc3, 0x28, 0x7d]);
  if (generator === "fraction") return Buffer.from('{"number":1.0}', "utf8");
  if (generator === "exponent") return Buffer.from('{"number":1e0}', "utf8");
  if (generator === "negative_zero") return Buffer.from('{"number":-0}', "utf8");
  if (generator === "unsafe_integer") return Buffer.from('{"number":9007199254740992}', "utf8");
  if (generator === "depth") return Buffer.from("[".repeat(66) + "0" + "]".repeat(66), "utf8");
  if (generator === "oversize") return Buffer.alloc(MAX_BYTES + 1, 0x20);
  if (generator === "total_strings") {
    const chunk = "x".repeat(MAX_STRING_BYTES);
    return Buffer.from(`[${new Array(13).fill(JSON.stringify(chunk)).join(",")}]`, "utf8");
  }
  fail("unknown raw generator");
}

function parseCaseError(generator) {
  try {
    parseBytes(generatedRawBytes(generator));
  } catch (error) {
    if (error instanceof ParseFailure) return [error.normalized];
    throw error;
  }
  return [];
}

function scanPublicEvidence() {
  const paths = [
    path.join(ROOT, "schemas/hardware-report/README.md"),
    path.join(ROOT, "schemas/model-registry/README.md"),
    path.join(ROOT, "docs/evidence/HARDWARE_MODEL_SCHEMA.md")
  ].filter((candidate) => fs.existsSync(candidate));
  const forbidden = [/C:\\Users\\/i, /RTX\s*5080/i, /16303\s*MiB/i, /65180\s*MiB/i, /PCI(?:E)?[_ -]?(?:ID|LUID)/i];
  const username = process.env.USERNAME;
  if (username && username.length >= 3) forbidden.push(new RegExp(username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  for (const filePath of paths) {
    const text = fs.readFileSync(filePath, "utf8");
    if (forbidden.some((pattern) => pattern.test(text))) fail("public evidence contains private host detail");
  }
  return paths.length;
}

function main() {
  const hardwareSchema = readJson(HARDWARE_SCHEMA_PATH);
  const modelSchema = readJson(MODEL_SCHEMA_PATH);
  lintSchema(hardwareSchema, "urn:minimax-h3-tool:schema:hardware-report:1.0.0");
  lintSchema(modelSchema, "urn:minimax-h3-tool:schema:model-registry:1.0.0");
  const hardwareSchemaDigest = sha256(hardwareSchema);
  const modelSchemaDigest = sha256(modelSchema);
  const schemas = new Map([
    ["minimax-h3-tool.hardware-report", hardwareSchema],
    ["minimax-h3-tool.model-registry", modelSchema]
  ]);

  const validFiles = fs.readdirSync(VALID_DIR).filter((name) => name.endsWith(".json")).sort();
  const validDocuments = new Map();
  for (const name of validFiles) {
    const document = readJson(path.join(VALID_DIR, name));
    validDocuments.set(name, document);
  }
  const hardwareDocuments = [...validDocuments.values()].filter((document) => document.contract_id === "minimax-h3-tool.hardware-report");
  const context = { hardwareSchemaDigest, hardwareById: new Map(hardwareDocuments.map((document) => [document.document_id, document])) };

  process.stdout.write(`PASS schema hardware-report ${hardwareSchemaDigest}\n`);
  process.stdout.write(`PASS schema model-registry ${modelSchemaDigest}\n`);
  for (const name of validFiles) {
    const document = validDocuments.get(name);
    assertNoErrors(validateDocument(document, schemas, context), `valid ${name}`);
    process.stdout.write(`PASS valid ${name.replace(/\.json$/, "")}\n`);
  }

  const selectedBase = structuredClone(validDocuments.get("model-registry-selected-external.json"));
  let derivedValid = 0;
  for (let index = 0; index < STAGES.length; index += 1) {
    const document = structuredClone(selectedBase);
    const candidate = document.candidates[0];
    candidate.stage_history = candidate.stage_history.slice(0, index + 1);
    candidate.current_stage = STAGES[index];
    document.sequence = index + 1;
    document.updated_at_utc = candidate.stage_history.at(-1).recorded_at_utc;
    if (index < STAGES.length - 1) candidate.reuse_decision = { kind: "not_authorized", reuse_permitted: false, reason_code: "MODEL.FULL_PROGRESSION_REQUIRED" };
    refreshIntegrity(document);
    assertNoErrors(validateDocument(document, schemas, context), `derived lifecycle ${STAGES[index]}`);
    process.stdout.write(`PASS derived lifecycle-${STAGES[index]}\n`);
    derivedValid += 1;
  }
  {
    const document = structuredClone(validDocuments.get("model-registry-found.json"));
    const evidence = document.candidates[0].stage_history[0].evidence;
    evidence.finding_class = "unsupported_format";
    evidence.container_hint = "gguf";
    refreshIntegrity(document);
    assertNoErrors(validateDocument(document, schemas, context), "derived unsupported found");
    process.stdout.write("PASS derived unsupported-found-non-actionable\n");
    derivedValid += 1;
  }
  {
    const document = structuredClone(selectedBase);
    document.candidates[0].lifecycle_status = { kind: "invalidated", invalidated_at_utc: "2026-01-01T02:06:00.000Z", reason: "file_identity_changed" };
    document.candidates[0].reuse_decision = { kind: "not_authorized", reuse_permitted: false, reason_code: "MODEL.CANDIDATE_INVALIDATED" };
    refreshIntegrity(document);
    assertNoErrors(validateDocument(document, schemas, context), "derived invalidated selected");
    process.stdout.write("PASS derived invalidated-selected-non-actionable\n");
    derivedValid += 1;
  }
  {
    const document = structuredClone(validDocuments.get("hardware-report-resolved.json"));
    document.extensions = { "org.example.fixture_notes": { extension_version: "1.0.0", effect: "display_metadata", data: { label: "synthetic" } } };
    refreshIntegrity(document);
    assertNoErrors(validateDocument(document, schemas, context), "derived display extension");
    process.stdout.write("PASS derived display-extension\n");
    derivedValid += 1;
  }

  let negativeCases = 0;
  let validCases = 0;
  const caseFiles = fs.existsSync(CASES_DIR) ? fs.readdirSync(CASES_DIR).filter((name) => name.endsWith(".json")).sort() : [];
  const caseDefinitions = [];
  const caseIds = new Set();
  for (const name of caseFiles) {
    const source = readJson(path.join(CASES_DIR, name));
    const entries = Array.isArray(source) ? source : [source];
    if (!entries.length) fail(`${name}: empty case bundle`);
    entries.forEach((fixtureCase, index) => {
      if (fixtureCase === null || typeof fixtureCase !== "object" || Array.isArray(fixtureCase)) fail(`${name}: case ${index} is not an object`);
      const allowed = new Set(["fixture_case_version", "case_id", "kind", "base", "mutations", "refresh_integrity", "generator", "expected"]);
      for (const key of Object.keys(fixtureCase)) if (!allowed.has(key)) fail(`${name}: unknown case field ${key}`);
      if (fixtureCase.fixture_case_version !== 1) fail(`${name}: unsupported fixture case version`);
      if (typeof fixtureCase.case_id !== "string" || !/^[a-z0-9][a-z0-9-]{0,127}$/.test(fixtureCase.case_id)) fail(`${name}: invalid case id`);
      if (caseIds.has(fixtureCase.case_id)) fail(`${name}: duplicate case id`);
      caseIds.add(fixtureCase.case_id);
      caseDefinitions.push({ fixtureCase, sourceName: name });
    });
  }
  for (const { fixtureCase, sourceName } of caseDefinitions) {
    let errors;
    if (fixtureCase.kind === "raw_parse") {
      if (fixtureCase.base !== undefined || fixtureCase.mutations !== undefined || fixtureCase.refresh_integrity !== undefined) fail(`${sourceName}: raw case has mutation fields`);
      errors = parseCaseError(fixtureCase.generator);
    } else if (fixtureCase.kind === "mutation") {
      const base = validDocuments.get(fixtureCase.base);
      if (!base) fail("case references unknown valid base");
      const document = structuredClone(base);
      for (const mutation of fixtureCase.mutations ?? []) mutate(document, mutation);
      if (fixtureCase.refresh_integrity !== false) refreshIntegrity(document);
      errors = validateDocument(document, schemas, context);
    } else fail(`${sourceName}: unsupported case kind`);
    if (process.env.HARDWARE_MODEL_CAPTURE === "1") {
      process.stdout.write(`CAPTURE ${fixtureCase.case_id} ${canonicalJson(tupleProjection(errors))}\n`);
      if (errors.length) negativeCases += 1; else validCases += 1;
    } else if (fixtureCase.expected === "valid") {
      assertNoErrors(errors, `case ${fixtureCase.case_id}`);
      validCases += 1;
    } else {
      assertExpected(errors, fixtureCase.expected, `case ${fixtureCase.case_id}`);
      negativeCases += 1;
    }
    process.stdout.write(`PASS case ${fixtureCase.case_id}\n`);
  }

  const publicFiles = scanPublicEvidence();
  process.stdout.write(`SUMMARY schemas=2 valid_contracts=${validFiles.length} derived_valid=${derivedValid} negative_cases=${negativeCases} valid_cases=${validCases} public_files_scanned=${publicFiles}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`FAIL hardware-model-contract reason=${error instanceof Error ? error.message : "unknown"}\n`);
  process.exitCode = 1;
}
