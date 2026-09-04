import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../../..");
const SCHEMA_PATH = path.join(ROOT, "schemas/component-manifest/1.0.0.schema.json");
const VALID_DIR = path.join(HERE, "valid");
const CASES_DIR = path.join(HERE, "cases");
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_DEPTH = 64;
const MAX_VALUES = 200000;
const MAX_OBJECT_PROPERTIES = 10000;
const MAX_ARRAY_ITEMS = 10000;
const MAX_STRING_BYTES = 1024 * 1024;

function fail(message) {
  throw new Error(message);
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
    if (this.pos !== this.text.length) fail("invalid JSON at byte-like offset " + this.pos);
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
        try { value = JSON.parse(this.text.slice(start, this.pos)); } catch { fail("invalid JSON string at byte-like offset " + start); }
        const stringBytes = Buffer.byteLength(value, "utf8");
        if (stringBytes > MAX_STRING_BYTES) fail("JSON string exceeds 1 MiB");
        this.totalStringBytes += stringBytes;
        if (this.totalStringBytes > 12 * 1024 * 1024) fail("JSON string bytes exceed 12 MiB");
        if (value.includes("\u0000")) fail("NUL is forbidden in JSON strings");
        for (let index = 0; index < value.length; index += 1) {
          const unit = value.charCodeAt(index);
          if (unit >= 0xd800 && unit <= 0xdbff) {
            const next = value.charCodeAt(index + 1);
            if (!(next >= 0xdc00 && next <= 0xdfff)) fail("unpaired high surrogate");
            index += 1;
          } else if (unit >= 0xdc00 && unit <= 0xdfff) fail("unpaired low surrogate");
        }
        return value;
      }
      if (code < 0x20) fail("unescaped control character at byte-like offset " + this.pos);
      if (ch === "\\") {
        this.pos += 1;
        const escape = this.text[this.pos];
        if (!'"\\/bfnrtu'.includes(escape ?? "")) fail("invalid escape at byte-like offset " + this.pos);
        if (escape === "u") {
          const hex = this.text.slice(this.pos + 1, this.pos + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail("invalid unicode escape at byte-like offset " + this.pos);
          this.pos += 4;
        }
      }
      this.pos += 1;
    }
    fail("unterminated JSON string at byte-like offset " + start);
  }

  parseInteger() {
    const rest = this.text.slice(this.pos);
    const match = /^-?(?:0|[1-9][0-9]*)/.exec(rest);
    if (!match) fail("invalid JSON value at byte-like offset " + this.pos);
    if (match[0] === "-0") fail("negative zero is forbidden at byte-like offset " + this.pos);
    const end = this.pos + match[0].length;
    if (/[.eE]/.test(this.text[end] ?? "")) fail("non-integer number at byte-like offset " + this.pos);
    const value = Number(match[0]);
    if (!Number.isSafeInteger(value)) fail("unsafe integer at byte-like offset " + this.pos);
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
      if (this.text[this.pos] !== '"') fail("object key must be a string at byte-like offset " + this.pos);
      const key = this.parseString();
      if (Buffer.byteLength(key, "utf8") > 128) fail("JSON key exceeds 128 UTF-8 bytes");
      if (keys.has(key)) fail("duplicate JSON key at byte-like offset " + this.pos);
      keys.add(key);
      if (keys.size > MAX_OBJECT_PROPERTIES) fail("object property count exceeds 10000");
      this.skipWhitespace();
      if (this.text[this.pos] !== ":") fail("missing colon at byte-like offset " + this.pos);
      this.pos += 1;
      this.skipWhitespace();
      result[key] = this.parseValue(depth);
      this.skipWhitespace();
      if (this.text[this.pos] === "}") { this.pos += 1; return result; }
      if (this.text[this.pos] !== ",") fail("missing comma at byte-like offset " + this.pos);
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
      if (result.length >= MAX_ARRAY_ITEMS) fail("array item count exceeds 10000");
      result.push(this.parseValue(depth));
      this.skipWhitespace();
      if (this.text[this.pos] === "]") { this.pos += 1; return result; }
      if (this.text[this.pos] !== ",") fail("missing comma at byte-like offset " + this.pos);
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
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (typeof value === "object") {
    return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonicalJson(value[key])).join(",") + "}";
  }
  fail("unsupported JCS value");
}

function sha256(value) {
  const input = typeof value === "string" || Buffer.isBuffer(value) ? value : canonicalJson(value);
  return "sha256:" + crypto.createHash("sha256").update(input).digest("hex");
}

function documentContentHash(document) {
  const projected = structuredClone(document);
  delete projected.integrity;
  return sha256(projected);
}

function refreshIntegrity(document) {
  if (document.integrity) document.integrity.content_sha256 = documentContentHash(document);
}

function contractError(code, instancePath, ruleId) {
  return { code, instance_path: instancePath, rule_id: ruleId };
}

function assertExact(actual, expected, context) {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail(context + ": expected " + canonicalJson(expected) + " but got " + canonicalJson(actual));
  }
}

function pointerParts(pointer) {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) fail("invalid JSON Pointer " + pointer);
  return pointer.slice(1).split("/").map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function atPointer(document, pointer) {
  let current = document;
  for (const part of pointerParts(pointer)) {
    if (current === null || typeof current !== "object" || !(part in current)) fail("fixture pointer not found: " + pointer);
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
    if (parent === null || typeof parent !== "object" || !(part in parent)) fail("fixture pointer not found: " + pointer);
    parent = parent[part];
  }
  return { parent, key };
}

function mutate(document, mutation) {
  const allowed = new Set(["op", "path", "from", "value"]);
  for (const key of Object.keys(mutation)) if (!allowed.has(key)) fail("unknown mutation field " + key);
  const target = parentAtPointer(document, mutation.path);
  if (mutation.op === "remove") {
    if (!(target.key in target.parent)) fail("remove pointer not found: " + mutation.path);
    if (Array.isArray(target.parent)) target.parent.splice(Number(target.key), 1);
    else delete target.parent[target.key];
    return;
  }
  let value;
  if (mutation.op === "copy") value = structuredClone(atPointer(document, mutation.from));
  else if (mutation.op === "add" || mutation.op === "replace") value = structuredClone(mutation.value);
  else fail("unsupported mutation op " + mutation.op);
  if (Array.isArray(target.parent)) {
    if (target.key === "-") target.parent.push(value);
    else if (mutation.op === "add" || mutation.op === "copy") target.parent.splice(Number(target.key), 0, value);
    else target.parent[Number(target.key)] = value;
  } else {
    if (mutation.op === "replace" && !(target.key in target.parent)) fail("replace pointer not found: " + mutation.path);
    target.parent[target.key] = value;
  }
}

function lintSchema(schema) {
  const expectedId = "urn:minimax-h3-tool:schema:component-manifest:1.0.0";
  if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") fail("wrong JSON Schema draft");
  if (schema.$id !== expectedId) fail("wrong immutable schema id");
  if (schema.additionalProperties !== false) fail("root object is not closed");
  const annotationErrors = [];
  const ruleErrors = [];
  const seen = new Map();
  const constraints = new Set(["$ref", "type", "const", "enum", "required", "properties", "additionalProperties", "unevaluatedProperties", "items", "minItems", "maxItems", "uniqueItems", "minProperties", "maxProperties", "propertyNames", "pattern", "minLength", "maxLength", "minimum", "maximum", "oneOf", "allOf", "if", "then", "else"]);
  const sensitivity = new Set(["public", "internal", "local_path", "prompt", "asset_name", "account", "token", "personal_data"]);
  const trustOrder = new Map(["display", "observation", "execution", "ownership", "path", "artifact", "graph", "recovery"].map((name, index) => [name, index]));
  function walk(value, pointer, conditional, propertyMap = false) {
    if (value === null || typeof value !== "object") return;
    if (typeof value.$ref === "string" && !value.$ref.startsWith("#/")) fail("non-local schema reference at " + pointer);
    if (!propertyMap && Object.keys(value).some((key) => constraints.has(key))) {
      const code = value["x-error-code"] ?? "";
      const rule = value["x-rule-id"] ?? "";
      if (!/^[A-Z][A-Z0-9_]*(?:\.[A-Z][A-Z0-9_]*)+$/.test(code) || !/^[a-z0-9_.]+$/.test(rule)) ruleErrors.push(pointer || "/");
      else if (seen.has(rule)) ruleErrors.push((pointer || "/") + " duplicates " + seen.get(rule));
      else seen.set(rule, pointer || "/");
    }
    if (value.properties && !conditional) {
      for (const [name, propertySchema] of Object.entries(value.properties)) {
        const impacts = propertySchema["x-trust-impact"];
        const validImpacts = Array.isArray(impacts) && impacts.length > 0 && new Set(impacts).size === impacts.length && impacts.every((impact) => trustOrder.has(impact)) && impacts.every((impact, index) => index === 0 || trustOrder.get(impacts[index - 1]) < trustOrder.get(impact));
        if (!sensitivity.has(propertySchema["x-sensitive"]) || !validImpacts) annotationErrors.push(pointer + "/properties/" + name);
      }
    }
    for (const [key, child] of Object.entries(value)) {
      const nestedConditional = conditional || key === "if" || key === "then" || key === "else";
      if (Array.isArray(child)) child.forEach((item, index) => walk(item, pointer + "/" + key + "/" + index, nestedConditional, false));
      else walk(child, pointer + "/" + key, nestedConditional, key === "properties");
    }
  }
  walk(schema, "", false, false);
  if (annotationErrors.length) fail("properties missing trust annotations: " + annotationErrors.join(","));
  if (ruleErrors.length) fail("constraints missing unique stable error annotations: " + ruleErrors.join(","));
}

function resolveLocalRef(rootSchema, reference) {
  let current = rootSchema;
  for (const part of pointerParts(reference.slice(1))) {
    if (current === null || typeof current !== "object" || !(part in current)) fail("unresolved schema reference " + reference);
    current = current[part];
  }
  return current;
}

function schemaErrors(instance, schema, rootSchema, instancePath) {
  if (schema === true) return [];
  if (schema === false) return [instancePath];
  const errors = [];
  if (schema.$ref) errors.push(...schemaErrors(instance, resolveLocalRef(rootSchema, schema.$ref), rootSchema, instancePath));
  if (schema.const !== undefined && canonicalJson(instance) !== canonicalJson(schema.const)) errors.push(instancePath);
  if (schema.enum && !schema.enum.some((item) => canonicalJson(item) === canonicalJson(instance))) errors.push(instancePath);
  if (schema.type) {
    const matches = schema.type === "object" ? instance !== null && typeof instance === "object" && !Array.isArray(instance)
      : schema.type === "array" ? Array.isArray(instance)
      : schema.type === "string" ? typeof instance === "string"
      : schema.type === "integer" ? Number.isSafeInteger(instance)
      : schema.type === "boolean" ? typeof instance === "boolean"
      : schema.type === "null" ? instance === null : false;
    if (!matches) return errors.concat([instancePath]);
  }
  if (schema.allOf) for (const branch of schema.allOf) errors.push(...schemaErrors(instance, branch, rootSchema, instancePath));
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((branch) => schemaErrors(instance, branch, rootSchema, instancePath).length === 0).length;
    if (matches !== 1) errors.push(instancePath);
  }
  if (typeof instance === "string") {
    if (schema.minLength !== undefined && [...instance].length < schema.minLength) errors.push(instancePath);
    if (schema.maxLength !== undefined && [...instance].length > schema.maxLength) errors.push(instancePath);
    if (schema.pattern && !new RegExp(schema.pattern).test(instance)) errors.push(instancePath);
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
      for (const item of instance) {
        const key = canonicalJson(item);
        if (seen.has(key)) errors.push(instancePath);
        seen.add(key);
      }
    }
    if (schema.items) instance.forEach((item, index) => errors.push(...schemaErrors(item, schema.items, rootSchema, instancePath + "/" + index)));
  }
  if (instance !== null && typeof instance === "object" && !Array.isArray(instance)) {
    const keys = Object.keys(instance);
    if (schema.minProperties !== undefined && keys.length < schema.minProperties) errors.push(instancePath);
    if (schema.maxProperties !== undefined && keys.length > schema.maxProperties) errors.push(instancePath);
    if (schema.required) for (const key of schema.required) if (!(key in instance)) errors.push(instancePath + "/" + key);
    if (schema.propertyNames) for (const key of keys) errors.push(...schemaErrors(key, schema.propertyNames, rootSchema, instancePath + "/" + key));
    const declared = new Set(Object.keys(schema.properties ?? {}));
    if (schema.properties) {
      for (const [key, propertySchema] of Object.entries(schema.properties)) {
        if (key in instance) errors.push(...schemaErrors(instance[key], propertySchema, rootSchema, instancePath + "/" + key));
      }
    }
    for (const key of keys) {
      if (!declared.has(key)) {
        if (schema.additionalProperties === false) errors.push(instancePath + "/" + key);
        else if (schema.additionalProperties && typeof schema.additionalProperties === "object") errors.push(...schemaErrors(instance[key], schema.additionalProperties, rootSchema, instancePath + "/" + key));
      }
    }
  }
  return errors;
}

function assertSchemaValid(document, schema, label) {
  const errors = schemaErrors(document, schema, schema, "");
  if (errors.length) fail(label + ": JSON Schema rejected valid fixture at " + [...new Set(errors)].sort().slice(0, 12).join(","));
}

const ROOT_FIELDS = new Set(["contract_id", "schema_version", "document_id", "document_revision", "manifest_id", "catalog_binding", "authority", "license_records", "components", "disposition", "extensions", "integrity"]);
const COMPONENT_FIELDS = new Set(["component_id", "component_version", "component_role", "platform", "architecture", "release_state", "artifact", "source", "provenance", "license_ref", "destination", "ownership_policy", "offline_availability", "dependencies", "signature", "disposition"]);
const MUTABLE_SEGMENT = /^(?:latest|main|master|head|current|branch)(?:[._-].*)?$/i;
const IMMUTABLE_PRODUCER_VERSION = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const DEVICE_STEM = /^(?:con|prn|aux|nul|clock\$|com[1-9]|lpt[1-9])$/i;

function isDeviceSegment(segment) {
  const normalized = segment.replace(/[. ]+$/g, "");
  const stem = (normalized.split(".")[0] ?? "").replace(/[. ]+$/g, "");
  return DEVICE_STEM.test(stem);
}

function firstUnknown(object, allowed, instancePath, ruleId) {
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) return contractError("CONTRACT.UNKNOWN_FIELD", instancePath + "/" + key, ruleId);
  }
  return null;
}

function validateExtensions(document) {
  if (!("extensions" in document)) return null;
  let totalBytes = 0;
  for (const [namespace, extension] of Object.entries(document.extensions)) {
    if (!/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9_]*){2,}$/.test(namespace)) return contractError("CONTRACT.INVALID_EXTENSION", "/extensions/" + namespace, "contract.extension.namespace");
    if (!extension || extension.effect !== "display_metadata") return contractError("CONTRACT.OPERATIONAL_EXTENSION_FORBIDDEN", "/extensions/" + namespace + "/effect", "contract.extension.display_only");
    for (const key of Object.keys(extension)) {
      if (!["extension_version", "effect", "data"].includes(key)) return contractError("CONTRACT.UNKNOWN_FIELD", "/extensions/" + namespace + "/" + key, "contract.extension.object.closed");
    }
    const extensionBytes = Buffer.byteLength(canonicalJson(extension), "utf8");
    if (extensionBytes > 256 * 1024) return contractError("CONTRACT.EXTENSION_TOO_LARGE", "/extensions/" + namespace, "contract.extension.single_size");
    totalBytes += extensionBytes;
  }
  if (totalBytes > 1024 * 1024) return contractError("CONTRACT.EXTENSIONS_TOO_LARGE", "/extensions", "contract.extension.total_size");
  return null;
}

function pathProblem(value, instancePath) {
  if (typeof value !== "string" || /^[A-Za-z]:/.test(value) || /^[\\/]/.test(value) || /^\\\\/.test(value)) {
    return contractError("COMPONENT.PATH_ABSOLUTE_FORBIDDEN", instancePath, "component.destination.relative.no_absolute");
  }
  if (value.includes("\\")) return contractError("COMPONENT.PATH_SEPARATOR_FORBIDDEN", instancePath, "component.destination.relative.forward_slash");
  const segments = value.split("/");
  if (segments.some((part) => part === "." || part === "..")) return contractError("COMPONENT.PATH_TRAVERSAL_FORBIDDEN", instancePath, "component.destination.relative.no_traversal");
  if (value.includes(":")) return contractError("COMPONENT.PATH_ADS_FORBIDDEN", instancePath, "component.destination.relative.no_ads");
  if (segments.some((part) => isDeviceSegment(part))) return contractError("COMPONENT.PATH_DEVICE_FORBIDDEN", instancePath, "component.destination.relative.no_device");
  if (segments.some((part) => part.length === 0 || /[\u0000-\u001f<>"|?*]/.test(part) || /[. ]$/.test(part))) return contractError("COMPONENT.PATH_UNSAFE", instancePath, "component.destination.relative.safe_segments");
  return null;
}

function locatorPathProblem(locator, instancePath) {
  if (typeof locator !== "string" || !locator.startsWith("app-resource:")) return contractError("COMPONENT.APP_RESOURCE_INVALID", instancePath, "component.source.app_resource_relative");
  if (/%[0-9a-f]{2}/i.test(locator)) return contractError("COMPONENT.APP_RESOURCE_INVALID", instancePath, "component.source.app_resource_relative");
  return pathProblem(locator.slice("app-resource:".length), instancePath);
}

function validateImmutableLocator(locator, revision, instancePath, errorCode, ruleId) {
  if (typeof locator === "string" && locator.startsWith("app-resource:")) return locatorPathProblem(locator, instancePath);
  let url;
  try { url = new URL(locator); } catch { return contractError(errorCode, instancePath, ruleId); }
  let segments;
  try { segments = url.pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment)); } catch { return contractError(errorCode, instancePath, ruleId); }
  const encodedPathHazard = /%(?:00|2e|2f|5c)/i.test(url.pathname) || locator.includes("\\") || url.pathname.includes("//");
  if (url.protocol !== "https:" || (url.port && url.port !== "443") || url.username || url.password || url.search || url.hash || encodedPathHazard || segments.some((segment) => MUTABLE_SEGMENT.test(segment)) || !segments.includes(revision)) return contractError(errorCode, instancePath, ruleId);
  return null;
}

function validateProducerSourceLocator(locator, revision, instancePath) {
  const invalid = () => contractError("COMPONENT.PRODUCER_BUILD_IDENTITY_MUTABLE", instancePath, "component.provenance.producer_build_immutable");
  if (typeof locator !== "string" || typeof revision !== "string") return invalid();
  if (locator.startsWith("app-resource:")) {
    const pathIssue = locatorPathProblem(locator, instancePath);
    if (pathIssue) return invalid();
    return locator === "app-resource:producer-builds/" + revision + "/source" ? null : invalid();
  }
  let url;
  try { url = new URL(locator); } catch { return invalid(); }
  let segments;
  try { segments = url.pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment)); } catch { return invalid(); }
  const encodedPathHazard = /%(?:00|2e|2f|5c)/i.test(url.pathname) || locator.includes("\\") || url.pathname.includes("//");
  if (url.protocol !== "https:" || (url.port && url.port !== "443") || url.username || url.password || url.search || url.hash || encodedPathHazard) return invalid();
  if (segments.length !== 3 || !["revisions", "commits"].includes(segments[0]) || segments[1] !== revision || segments[2] !== "source") return invalid();
  return null;
}

function validateImmutableSource(source, prefix) {
  const locatorIssue = validateImmutableLocator(source.locator, source.source_revision, prefix + "/locator", "COMPONENT.MUTABLE_SOURCE_FORBIDDEN", "component.source.immutable_locator");
  if (locatorIssue) return locatorIssue;
  if (source.kind === "embedded_app_resource") {
    if (source.retrieval_policy !== "not_retrievable_embedded") return contractError("COMPONENT.SOURCE_POLICY_CONFLICT", prefix + "/retrieval_policy", "component.source.kind_policy_exact");
    return null;
  }
  if (source.kind === "immutable_https" && source.retrieval_policy !== "explicit_install_only") return contractError("COMPONENT.SOURCE_POLICY_CONFLICT", prefix + "/retrieval_policy", "component.source.kind_policy_exact");
  if (source.kind === "external_match_only" && source.retrieval_policy !== "match_only_no_retrieval") return contractError("COMPONENT.SOURCE_POLICY_CONFLICT", prefix + "/retrieval_policy", "component.source.kind_policy_exact");
  return null;
}

function validateRole(component, prefix) {
  const artifact = component.artifact;
  const archive = artifact.archive_shape;
  const destination = component.destination.destination_class;
  const role = component.component_role;
  let valid = false;
  if (role === "python_runtime") valid = component.architecture === "x86_64" && archive.kind === "fixed_archive" && ["application/zip", "application/x-tar+zstd"].includes(artifact.content_type) && destination === "runtime_generation";
  else if (role === "comfy_backend") valid = component.architecture === "noarch" && archive.kind === "fixed_archive" && destination === "runtime_generation";
  else if (role === "comfy_frontend") valid = component.architecture === "noarch" && archive.kind === "fixed_archive" && destination === "frontend_bundle";
  else if (role === "workflow_templates") valid = component.architecture === "noarch" && archive.kind === "fixed_archive" && destination === "workflow_templates";
  else if (role === "local_node") valid = component.architecture === "noarch" && archive.kind === "fixed_archive" && destination === "local_nodes";
  else if (role === "python_wheelhouse") valid = component.architecture === "noarch" && archive.kind === "fixed_archive" && archive.format === "wheelhouse_zip" && artifact.content_type === "application/vnd.python.wheelhouse" && destination === "runtime_generation";
  else if (["model_diffusion", "model_text_encoder", "model_video_vae", "model_audio_vae"].includes(role)) {
    const expectedDestination = role;
    valid = component.architecture === "noarch" && archive.kind === "single_file" && artifact.content_type === "application/vnd.safetensors" && [expectedDestination, "external_read_only_reference"].includes(destination);
  } else if (role === "native_helper") {
    valid = component.architecture === "x86_64" && archive.kind === "single_file" && artifact.content_type === "application/vnd.microsoft.portable-executable" && destination === "private_tools";
  } else if (role === "private_media_tool") {
    valid = component.architecture === "x86_64" && destination === "private_tools" && ((archive.kind === "single_file" && artifact.content_type === "application/vnd.microsoft.portable-executable") || (archive.kind === "fixed_archive" && artifact.content_type === "application/zip"));
  }
  if (!valid) return contractError("COMPONENT.ROLE_ARTIFACT_MISMATCH", prefix + "/component_role", "component.role.artifact_destination_exact");
  return null;
}

function validateArchive(component, prefix) {
  const archive = component.artifact.archive_shape;
  if (archive.kind !== "fixed_archive") return null;
  const pathPrefix = prefix + "/artifact/archive_shape";
  if (archive.link_policy !== "forbid_links_and_reparse") return contractError("COMPONENT.REPARSE_INTENT_FORBIDDEN", pathPrefix + "/link_policy", "component.archive.links_reparse_forbidden");
  if (!("expanded_tree_sha256" in archive)) return contractError("COMPONENT.ARCHIVE_EXPANDED_TREE_REQUIRED", pathPrefix + "/expanded_tree_sha256", "component.archive.expanded_tree_required");
  if (!("max_entry_byte_length" in archive) || archive.max_entry_byte_length > archive.expanded_byte_length) return contractError("COMPONENT.ARCHIVE_BOUNDS_INVALID", pathPrefix + "/max_entry_byte_length", "component.archive.expanded_bounds");
  if (archive.path_policy !== "canonical_relative_no_traversal_ads_device" || archive.expanded_tree_profile !== "canonical_regular_files_v1") return contractError("COMPONENT.ARCHIVE_POLICY_INVALID", pathPrefix, "component.archive.materializer_policy_exact");
  return null;
}

function validateProvenance(component, prefix) {
  const provenance = component.provenance;
  const base = prefix + "/provenance";
  if (!("publisher" in provenance)) return contractError("COMPONENT.PUBLISHER_REQUIRED", base + "/publisher", "component.provenance.publisher_required");
  if (provenance.creator.role !== "creator" || provenance.publisher.role !== "publisher" || provenance.packager.role !== "packager") {
    return contractError("COMPONENT.PARTY_ROLE_CONFLICT", base, "component.provenance.party_roles_exact");
  }
  const sameCreatorPackager = provenance.creator.party_id === provenance.packager.party_id;
  if ((provenance.relationship === "same_party") !== sameCreatorPackager) return contractError("COMPONENT.PARTY_RELATIONSHIP_CONFLICT", base + "/relationship", "component.provenance.party_relationship_exact");
  const samePublisherPackager = provenance.publisher.party_id === provenance.packager.party_id;
  if ((provenance.publisher_packager_relationship === "same_party") !== samePublisherPackager) return contractError("COMPONENT.PARTY_RELATIONSHIP_CONFLICT", base + "/publisher_packager_relationship", "component.provenance.publisher_packager_relationship_exact");
  const namesByParty = new Map();
  for (const party of [provenance.creator, provenance.publisher, provenance.packager]) {
    if (namesByParty.has(party.party_id) && namesByParty.get(party.party_id) !== party.display_name) return contractError("COMPONENT.PARTY_IDENTITY_CONFLICT", base, "component.provenance.same_party_display_name_exact");
    namesByParty.set(party.party_id, party.display_name);
  }
  if (provenance.producer_build_identity.producer_id !== provenance.packager.party_id) return contractError("COMPONENT.PRODUCER_BUILD_IDENTITY_CONFLICT", base + "/producer_build_identity/producer_id", "component.provenance.producer_is_packager");
  const producer = provenance.producer_build_identity;
  if (!IMMUTABLE_PRODUCER_VERSION.test(producer.producer_version) || !/^sha256:[0-9a-f]{64}$/.test(producer.producer_build_id)) {
    const field = !IMMUTABLE_PRODUCER_VERSION.test(producer.producer_version) ? "producer_version" : "producer_build_id";
    return contractError("COMPONENT.PRODUCER_BUILD_IDENTITY_MUTABLE", base + "/producer_build_identity/" + field, "component.provenance.producer_build_immutable");
  }
  const producerLocatorIssue = validateProducerSourceLocator(producer.producer_source_locator, producer.producer_source_revision, base + "/producer_build_identity/producer_source_locator");
  if (producerLocatorIssue) return producerLocatorIssue;
  const producerBuildProjection = {
    build_recipe_sha256: producer.build_recipe_sha256,
    producer_id: producer.producer_id,
    producer_source_locator: producer.producer_source_locator,
    producer_source_revision: producer.producer_source_revision,
    producer_version: producer.producer_version
  };
  if (producer.producer_build_id !== sha256(producerBuildProjection)) return contractError("COMPONENT.PRODUCER_BUILD_IDENTITY_HASH_MISMATCH", base + "/producer_build_identity/producer_build_id", "component.provenance.producer_build_record_hash_exact");
  const evidenceIds = new Set();
  for (let index = 0; index < provenance.evidence.items.length; index += 1) {
    const item = provenance.evidence.items[index];
    if (evidenceIds.has(item.evidence_id)) return contractError("COMPONENT.DUPLICATE_PROVENANCE_EVIDENCE", base + "/evidence/items/" + index + "/evidence_id", "component.provenance.evidence_id_unique");
    evidenceIds.add(item.evidence_id);
    const locatorIssue = locatorPathProblem(item.locator, base + "/evidence/items/" + index + "/locator");
    if (locatorIssue) return locatorIssue;
  }
  const evidenceVerified = provenance.evidence.items.every((item) => item.review_state === "verified_by_release_owner");
  const evidenceKinds = new Set(provenance.evidence.items.map((item) => item.kind));
  let evidenceStatusValid = false;
  if (provenance.evidence.status === "declared_unverified") evidenceStatusValid = !evidenceVerified;
  else if (provenance.evidence.status === "verified_release_attestation") evidenceStatusValid = evidenceVerified && (evidenceKinds.has("source_attestation") || evidenceKinds.has("package_attestation"));
  else if (provenance.evidence.status === "verified_reproducible_build") evidenceStatusValid = evidenceVerified && evidenceKinds.has("reproducibility_report");
  if (!evidenceStatusValid) return contractError("COMPONENT.PROVENANCE_EVIDENCE_STATUS_CONFLICT", base + "/evidence/status", "component.provenance.evidence_status_exact");
  const chain = provenance.chain;
  const allowedActors = new Set([provenance.creator.party_id, provenance.publisher.party_id, provenance.packager.party_id]);
  if (chain[0].event !== "created" || chain[0].actor_party_id !== provenance.creator.party_id || chain[0].input.kind !== "none") return contractError("COMPONENT.PROVENANCE_ORIGIN_INVALID", base + "/chain/0", "component.provenance.origin_exact");
  if (!chain.some((step) => step.actor_party_id === provenance.publisher.party_id)) return contractError("COMPONENT.PUBLISHER_NOT_IN_CHAIN", base + "/publisher/party_id", "component.provenance.publisher_participates");
  for (let index = 0; index < chain.length; index += 1) {
    const step = chain[index];
    if (step.sequence !== index || !allowedActors.has(step.actor_party_id)) return contractError("COMPONENT.PROVENANCE_STEP_INVALID", base + "/chain/" + index, "component.provenance.sequence_actor_exact");
    const locatorIssue = validateImmutableLocator(step.source_locator, step.source_revision, base + "/chain/" + index + "/source_locator", "COMPONENT.PROVENANCE_MUTABLE_LOCATOR", "component.provenance.each_locator_immutable");
    if (locatorIssue) return locatorIssue;
    if (index > 0) {
      if (step.input.kind !== "artifact" || canonicalJson(step.input.identity) !== canonicalJson(chain[index - 1].output)) return contractError("COMPONENT.PROVENANCE_CHAIN_BROKEN", base + "/chain/" + index + "/input/identity", "component.provenance.input_matches_parent");
    }
  }
  const last = chain[chain.length - 1];
  if (last.event !== "packaged" || last.actor_party_id !== provenance.packager.party_id) return contractError("COMPONENT.PROVENANCE_PACKAGER_INVALID", base + "/chain/" + (chain.length - 1), "component.provenance.packager_exact");
  if (last.source_locator !== component.source.locator || last.source_revision !== component.source.source_revision) return contractError("COMPONENT.PROVENANCE_SOURCE_STALE", base + "/chain/" + (chain.length - 1) + "/source_locator", "component.provenance.final_source_exact");
  if (last.output.byte_length !== component.artifact.byte_length || last.output.artifact_sha256 !== component.artifact.artifact_sha256) return contractError("COMPONENT.PROVENANCE_OUTPUT_STALE", base + "/chain/" + (chain.length - 1) + "/output", "component.provenance.final_output_exact");
  const events = chain.map((step) => step.event);
  const sameIdentity = (left, right) => canonicalJson(left) === canonicalJson(right);
  let transformationValid = false;
  if (provenance.transformation === "original_bytes_republished") {
    transformationValid = events[0] === "created" && events.at(-1) === "packaged" && events.slice(1, -1).every((event) => event === "mirrored") && chain.slice(1).every((step) => sameIdentity(step.output, chain[0].output));
  } else {
    const exactMiddleEvent = {
      compiled: "compiled",
      quantized: "quantized",
      bundled: "bundled",
      repackaged: "packaged"
    }[provenance.transformation];
    transformationValid = exactMiddleEvent !== undefined && canonicalJson(events) === canonicalJson(["created", exactMiddleEvent, "packaged"]) && !sameIdentity(chain[1].input.identity, chain[1].output) && sameIdentity(chain[2].input.identity, chain[2].output);
  }
  if (!transformationValid) return contractError("COMPONENT.PROVENANCE_TRANSFORMATION_MISMATCH", base + "/transformation", "component.provenance.transformation_chain_exact");
  return null;
}

function validateOwnership(component, prefix) {
  const ownership = component.ownership_policy;
  if (component.source.kind === "external_match_only") {
    if (ownership.kind !== "external_match_only" || ownership.classification !== "external_read_only" || ownership.delete_authority !== "never" || ownership.manifest_grants_ownership !== false || ownership.manifest_grants_delete !== false) {
      return contractError("COMPONENT.EXTERNAL_OWNERSHIP_FORBIDDEN", prefix + "/ownership_policy/classification", "component.external.always_read_only");
    }
    if (component.destination.kind !== "external_match_requirement" || "relative_path" in component.destination || "candidate_ref" in component.destination || component.destination.destination_class !== "external_read_only_reference" || component.destination.selection_binding !== "later_exact_model_observation_reference_required" || component.offline_availability.kind !== "external_presence_required") return contractError("COMPONENT.EXTERNAL_ROUTE_CONFLICT", prefix + "/destination", "component.external.route_exact");
  } else {
    if (ownership.kind !== "managed_target" || ownership.classification !== "tool_owned_only_after_verified_ledger_commit" || ownership.manifest_grants_ownership !== false || ownership.manifest_grants_delete !== false || ownership.delete_authority !== "separate_ledger_containment_lease_gate") {
      return contractError("COMPONENT.MANIFEST_AUTHORITY_FORBIDDEN", prefix + "/ownership_policy", "component.ownership.manifest_never_grants");
    }
    const requiredProofs = ["verified_download_length_hash", "owned_transaction_commit", "ownership_ledger_entry", "handle_containment_no_reparse", "no_active_lease"];
    if (canonicalJson(ownership.required_proofs) !== canonicalJson(requiredProofs)) return contractError("COMPONENT.MANAGED_PROOFS_INCOMPLETE", prefix + "/ownership_policy/required_proofs", "component.ownership.required_proofs_exact");
    if (component.destination.kind !== "managed_relative" || !("relative_path" in component.destination)) return contractError("COMPONENT.MANAGED_ROUTE_CONFLICT", prefix + "/destination", "component.managed.route_exact");
    const expectedOffline = component.source.kind === "embedded_app_resource" ? "bundled_in_app" : "requires_explicit_install_network";
    if (component.offline_availability.kind !== expectedOffline) return contractError("COMPONENT.OFFLINE_POLICY_CONFLICT", prefix + "/offline_availability/kind", "component.offline.source_exact");
  }
  if (component.offline_availability.runtime_network_install !== "forbidden") return contractError("COMPONENT.RUNTIME_NETWORK_FORBIDDEN", prefix + "/offline_availability/runtime_network_install", "component.offline.runtime_network_forbidden");
  return null;
}

function validateSignature(component, prefix) {
  const signature = component.signature;
  if (!signature) return null;
  if (signature.signed_artifact_sha256 !== component.artifact.artifact_sha256) return contractError("COMPONENT.SIGNATURE_ARTIFACT_STALE", prefix + "/signature/signed_artifact_sha256", "component.signature.signed_artifact_exact");
  if (signature.kind === "embedded_authenticode") {
    if (signature.scheme !== "authenticode" || component.artifact.archive_shape.kind !== "single_file" || component.artifact.content_type !== "application/vnd.microsoft.portable-executable") return contractError("COMPONENT.SIGNATURE_SCHEME_MISMATCH", prefix + "/signature/scheme", "component.signature.scheme_shape_exact");
  } else if (signature.kind === "detached_signature") {
    const resourceIssue = locatorPathProblem(signature.signature_resource.locator, prefix + "/signature/signature_resource/locator");
    if (resourceIssue) return resourceIssue;
  } else return contractError("COMPONENT.SIGNATURE_KIND_UNKNOWN", prefix + "/signature/kind", "component.signature.kind_exact");
  return null;
}

function validateLicenseReference(component, prefix, licenses) {
  const record = licenses.get(component.license_ref.license_record_id);
  if (!record || record.disposition.kind !== "active") return contractError("COMPONENT.LICENSE_REFERENCE_INVALID", prefix + "/license_ref/license_record_id", "component.license_ref.active_record");
  if (component.license_ref.license_record_content_sha256 !== sha256(record)) return contractError("COMPONENT.LICENSE_REFERENCE_STALE", prefix + "/license_ref/license_record_content_sha256", "component.license_ref.content_exact");
  return null;
}

function expectedLicenseScopeHashes(components) {
  const ordered = [...components].sort((left, right) => {
    const leftKey = left.component_id + "\u0000" + left.component_version + "\u0000" + left.artifact.artifact_sha256;
    const rightKey = right.component_id + "\u0000" + right.component_version + "\u0000" + right.artifact.artifact_sha256;
    return Buffer.compare(Buffer.from(leftKey, "utf8"), Buffer.from(rightKey, "utf8"));
  });
  const artifacts = ordered.map((component) => ({
    artifact_sha256: component.artifact.artifact_sha256,
    byte_length: component.artifact.byte_length,
    component_id: component.component_id,
    component_version: component.component_version,
    source_kind: component.source.kind
  }));
  const provenance = ordered.map((component) => ({
    component_id: component.component_id,
    component_version: component.component_version,
    provenance_content_sha256: sha256(component.provenance)
  }));
  return { artifactSet: sha256(artifacts), provenanceSet: sha256(provenance) };
}

function validateApprovedLicenseScopes(document, licenses) {
  for (const [licenseId, record] of licenses.entries()) {
    if (record.review.state !== "approved") continue;
    const index = document.license_records.findIndex((item) => item.license_record_id === licenseId);
    const prefix = "/license_records/" + index;
    const components = document.components.filter((component) => component.license_ref.license_record_id === licenseId);
    const hashes = expectedLicenseScopeHashes(components);
    if (record.review.reviewed_artifact_set_sha256 !== hashes.artifactSet) return contractError("COMPONENT.LICENSE_ARTIFACT_SCOPE_STALE", prefix + "/review/reviewed_artifact_set_sha256", "component.license.reviewed_artifact_set_exact");
    if (record.review.reviewed_provenance_set_sha256 !== hashes.provenanceSet) return contractError("COMPONENT.LICENSE_PROVENANCE_SCOPE_STALE", prefix + "/review/reviewed_provenance_set_sha256", "component.license.reviewed_provenance_set_exact");
    const requiredModes = new Set(components.map((component) => component.source.kind === "embedded_app_resource" ? "bundled_redistribution" : component.source.kind === "external_match_only" ? "external_read_only_reuse" : "explicit_user_download"));
    for (const mode of requiredModes) if (!record.review.delivery_modes.includes(mode)) return contractError("COMPONENT.LICENSE_DELIVERY_SCOPE_MISSING", prefix + "/review/delivery_modes", "component.license.delivery_modes_cover_components");
    if ((requiredModes.has("bundled_redistribution") || requiredModes.has("explicit_user_download")) && record.obligations.redistribution !== "approved_with_conditions") return contractError("COMPONENT.LICENSE_REDISTRIBUTION_NOT_APPROVED", prefix + "/obligations/redistribution", "component.license.redistribution_approved");
    if (record.obligations.source_code === "review_pending" || record.obligations.attribution === "review_pending") return contractError("COMPONENT.LICENSE_OBLIGATIONS_UNRESOLVED", prefix + "/obligations", "component.license.obligations_resolved");
  }
  return null;
}

function validateDependencies(document) {
  const byId = new Map(document.components.map((component, index) => [component.component_id, { component, index }]));
  for (let sourceIndex = 0; sourceIndex < document.components.length; sourceIndex += 1) {
    const source = document.components[sourceIndex];
    for (let dependencyIndex = 0; dependencyIndex < source.dependencies.length; dependencyIndex += 1) {
      const dependency = source.dependencies[dependencyIndex];
      const target = byId.get(dependency.component_id);
      const prefix = "/components/" + sourceIndex + "/dependencies/" + dependencyIndex;
      if (!target || target.component.component_version !== dependency.component_version || target.component.artifact.artifact_sha256 !== dependency.artifact_sha256) return contractError("COMPONENT.DEPENDENCY_STALE", prefix, "component.dependencies.exact_identity");
      if (source.release_state === "eligible" && (target.component.disposition.kind !== "active" || target.component.release_state !== "eligible")) return contractError("COMPONENT.DEPENDENCY_NOT_ACTIONABLE", prefix, "component.dependencies.eligible_closure");
    }
  }
  function reaches(currentId, goalId, seen) {
    if (currentId === goalId) return true;
    if (seen.has(currentId)) return false;
    seen.add(currentId);
    const current = byId.get(currentId);
    if (!current) return false;
    return current.component.dependencies.some((dependency) => reaches(dependency.component_id, goalId, seen));
  }
  for (let sourceIndex = 0; sourceIndex < document.components.length; sourceIndex += 1) {
    const source = document.components[sourceIndex];
    for (let dependencyIndex = 0; dependencyIndex < source.dependencies.length; dependencyIndex += 1) {
      if (reaches(source.dependencies[dependencyIndex].component_id, source.component_id, new Set())) {
        return contractError("COMPONENT.DEPENDENCY_CYCLE", "/components/" + sourceIndex + "/dependencies/" + dependencyIndex, "component.dependencies.acyclic");
      }
    }
  }
  return null;
}

function validateActionability(document, licenses) {
  for (let index = 0; index < document.components.length; index += 1) {
    const component = document.components[index];
    if (component.release_state !== "eligible") continue;
    const prefix = "/components/" + index;
    const license = licenses.get(component.license_ref.license_record_id);
    if (!license || license.review.state !== "approved") return contractError("COMPONENT.LICENSE_NOT_APPROVED", prefix + "/release_state", "component.license.release_blocked_until_approved");
    if (component.provenance.evidence.status === "declared_unverified" || !component.provenance.evidence.items.every((item) => item.review_state === "verified_by_release_owner")) return contractError("COMPONENT.PROVENANCE_NOT_VERIFIED", prefix + "/release_state", "component.provenance.release_blocked_until_verified");
  }
  return null;
}

function verifyIntegrity(document) {
  if (!document || typeof document !== "object" || Array.isArray(document) || !document.integrity || document.integrity.content_sha256 !== documentContentHash(document)) return contractError("CONTRACT.INTEGRITY_MISMATCH", "/integrity/content_sha256", "contract.integrity.jcs_sha256");
  return null;
}

function normalizeSchemaStage(document, schema) {
  const rawErrors = schemaErrors(document, schema, schema, "");
  if (rawErrors.length === 0) return null;
  if (document && typeof document === "object" && !Array.isArray(document)) {
    const rootUnknown = firstUnknown(document, ROOT_FIELDS, "", "component-manifest.object.closed");
    if (rootUnknown) return rootUnknown;
    const catalog = document.catalog_binding;
    if (catalog && typeof catalog === "object" && !Array.isArray(catalog)) {
      if (catalog.remote_catalog_policy !== "forbidden" || catalog.delivery !== "embedded_in_current_app" || catalog.runtime_override_policy !== "forbidden") return contractError("COMPONENT.REMOTE_CATALOG_FORBIDDEN", "/catalog_binding/remote_catalog_policy", "component.catalog.embedded_only");
      if (catalog.app_id !== "minimax-h3-tool") return contractError("COMPONENT.APP_BINDING_MISMATCH", "/catalog_binding/app_id", "component.catalog.app_exact");
      if (catalog.external_binding_requirement !== "signed_build_inventory_binds_exact_catalog_tuple" || catalog.catalog_cardinality !== "exactly_one") return contractError("COMPONENT.CATALOG_EXTERNAL_BINDING_REQUIRED", "/catalog_binding/external_binding_requirement", "component.catalog.external_build_binding");
    }
    if (Array.isArray(document.license_records)) {
      for (let index = 0; index < document.license_records.length; index += 1) {
        const record = document.license_records[index];
        if (record && typeof record === "object" && !("review" in record)) return contractError("COMPONENT.LICENSE_REVIEW_REQUIRED", "/license_records/" + index + "/review", "component.license.review.required");
      }
    }
    if (Array.isArray(document.components)) {
      for (let index = 0; index < document.components.length; index += 1) {
        const component = document.components[index];
        const prefix = "/components/" + index;
        if (!component || typeof component !== "object" || Array.isArray(component)) continue;
        const unknown = firstUnknown(component, COMPONENT_FIELDS, prefix, "component.object.closed");
        if (unknown) return unknown;
        if (component.artifact && typeof component.artifact === "object") {
          if (!("byte_length" in component.artifact)) return contractError("COMPONENT.ARTIFACT_LENGTH_REQUIRED", prefix + "/artifact/byte_length", "component.artifact.length.required");
          if (!("artifact_sha256" in component.artifact)) return contractError("COMPONENT.ARTIFACT_HASH_REQUIRED", prefix + "/artifact/artifact_sha256", "component.artifact.hash.required");
          const archive = component.artifact.archive_shape;
          if (archive && typeof archive === "object" && archive.kind === "fixed_archive") {
            if (archive.link_policy !== "forbid_links_and_reparse") return contractError("COMPONENT.REPARSE_INTENT_FORBIDDEN", prefix + "/artifact/archive_shape/link_policy", "component.archive.links_reparse_forbidden");
            if (!("expanded_tree_sha256" in archive)) return contractError("COMPONENT.ARCHIVE_EXPANDED_TREE_REQUIRED", prefix + "/artifact/archive_shape/expanded_tree_sha256", "component.archive.expanded_tree_required");
          }
        }
        if (component.provenance && typeof component.provenance === "object" && !("publisher" in component.provenance)) return contractError("COMPONENT.PUBLISHER_REQUIRED", prefix + "/provenance/publisher", "component.provenance.publisher_required");
        if (component.provenance && typeof component.provenance === "object" && !("producer_build_identity" in component.provenance)) return contractError("COMPONENT.PRODUCER_BUILD_IDENTITY_REQUIRED", prefix + "/provenance/producer_build_identity", "component.provenance.producer_build_required");
        if (component.provenance && typeof component.provenance === "object" && !("evidence" in component.provenance)) return contractError("COMPONENT.PROVENANCE_EVIDENCE_REQUIRED", prefix + "/provenance/evidence", "component.provenance.evidence_required");
        const producer = component.provenance?.producer_build_identity;
        if (producer && typeof producer === "object" && !Array.isArray(producer)) {
          if (typeof producer.producer_version === "string" && !IMMUTABLE_PRODUCER_VERSION.test(producer.producer_version)) return contractError("COMPONENT.PRODUCER_BUILD_IDENTITY_MUTABLE", prefix + "/provenance/producer_build_identity/producer_version", "component.provenance.producer_build_immutable");
          if (typeof producer.producer_build_id === "string" && !/^sha256:[0-9a-f]{64}$/.test(producer.producer_build_id)) return contractError("COMPONENT.PRODUCER_BUILD_IDENTITY_MUTABLE", prefix + "/provenance/producer_build_identity/producer_build_id", "component.provenance.producer_build_immutable");
          const producerLocatorIssue = validateProducerSourceLocator(producer.producer_source_locator, producer.producer_source_revision, prefix + "/provenance/producer_build_identity/producer_source_locator");
          if (producerLocatorIssue) return producerLocatorIssue;
        }
        if (component.source?.kind === "external_match_only" && component.destination && typeof component.destination === "object" && "candidate_ref" in component.destination) return contractError("COMPONENT.RUNTIME_OBSERVATION_IN_MANIFEST_FORBIDDEN", prefix + "/destination/candidate_ref", "component.external.candidate_binding_later_only");
        if (component.source?.kind === "external_match_only" && component.ownership_policy?.classification !== "external_read_only") return contractError("COMPONENT.EXTERNAL_OWNERSHIP_FORBIDDEN", prefix + "/ownership_policy/classification", "component.external.always_read_only");
        if (component.ownership_policy?.kind === "managed_target" && Array.isArray(component.ownership_policy.required_proofs) && component.ownership_policy.required_proofs.length !== 5) return contractError("COMPONENT.MANAGED_PROOFS_INCOMPLETE", prefix + "/ownership_policy/required_proofs", "component.ownership.required_proofs_exact");
      }
    }
  }
  const paths = [...new Set(rawErrors)].sort((left, right) => left.length - right.length || Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")));
  return contractError("CONTRACT.SCHEMA_INVALID", paths[0] ?? "", "component-manifest.schema.exact");
}

function validateComponentDomain(document) {
  let issue = firstUnknown(document, ROOT_FIELDS, "", "component-manifest.object.closed");
  if (issue) return issue;
  if (document.contract_id !== "minimax-h3-tool.component-manifest" || document.schema_version !== "1.0.0") return contractError("CONTRACT.UNKNOWN_CONTRACT", "/contract_id", "component-manifest.envelope.exact");
  issue = validateExtensions(document); if (issue) return issue;
  if (document.catalog_binding.remote_catalog_policy !== "forbidden" || document.catalog_binding.delivery !== "embedded_in_current_app" || document.catalog_binding.runtime_override_policy !== "forbidden") return contractError("COMPONENT.REMOTE_CATALOG_FORBIDDEN", "/catalog_binding/remote_catalog_policy", "component.catalog.embedded_only");
  if (document.catalog_binding.app_id !== "minimax-h3-tool") return contractError("COMPONENT.APP_BINDING_MISMATCH", "/catalog_binding/app_id", "component.catalog.app_exact");
  if (document.catalog_binding.catalog_cardinality !== "exactly_one" || document.catalog_binding.external_binding_requirement !== "signed_build_inventory_binds_exact_catalog_tuple") return contractError("COMPONENT.CATALOG_EXTERNAL_BINDING_REQUIRED", "/catalog_binding/external_binding_requirement", "component.catalog.external_build_binding");
  issue = pathProblem(document.catalog_binding.catalog_resource, "/catalog_binding/catalog_resource"); if (issue) return issue;
  const authority = document.authority;
  if (authority.materialization_authority !== "none_requires_explicit_install_transaction" || authority.ownership_authority !== "none_requires_verified_ownership_ledger_commit" || authority.deletion_authority !== "none_requires_separate_ledger_containment_lease_gate" || authority.execution_authority !== "none_manifest_is_data_only") return contractError("COMPONENT.MANIFEST_AUTHORITY_FORBIDDEN", "/authority", "component.manifest.data_only");
  if (document.disposition.kind !== "active") {
    const eligibleIndex = document.components.findIndex((component) => component.release_state === "eligible");
    if (eligibleIndex >= 0) return contractError("COMPONENT.MANIFEST_NONACTIVE_MUST_BLOCK_ALL", "/components/" + eligibleIndex + "/release_state", "component.manifest.nonactive_blocks_all");
  }

  const licenses = new Map();
  for (let index = 0; index < document.license_records.length; index += 1) {
    const record = document.license_records[index];
    if (!("review" in record)) return contractError("COMPONENT.LICENSE_REVIEW_REQUIRED", "/license_records/" + index + "/review", "component.license.review.required");
    if (licenses.has(record.license_record_id)) return contractError("COMPONENT.DUPLICATE_LICENSE_ID", "/license_records/" + index + "/license_record_id", "component.license.id.unique");
    const textPath = locatorPathProblem(record.license_text.locator, "/license_records/" + index + "/license_text/locator");
    if (textPath) return textPath;
    const noticePath = locatorPathProblem(record.notice.locator, "/license_records/" + index + "/notice/locator");
    if (noticePath) return noticePath;
    licenses.set(record.license_record_id, record);
  }

  const componentIds = new Set();
  for (let index = 0; index < document.components.length; index += 1) {
    const component = document.components[index];
    const prefix = "/components/" + index;
    issue = firstUnknown(component, COMPONENT_FIELDS, prefix, "component.object.closed"); if (issue) return issue;
    if (!("byte_length" in component.artifact)) return contractError("COMPONENT.ARTIFACT_LENGTH_REQUIRED", prefix + "/artifact/byte_length", "component.artifact.length.required");
    if (!("artifact_sha256" in component.artifact)) return contractError("COMPONENT.ARTIFACT_HASH_REQUIRED", prefix + "/artifact/artifact_sha256", "component.artifact.hash.required");
    if (componentIds.has(component.component_id)) return contractError("COMPONENT.DUPLICATE_ID", prefix + "/component_id", "component.id.unique");
    componentIds.add(component.component_id);
    if (component.disposition.kind !== "active" && component.release_state !== "blocked") return contractError("COMPONENT.NONACTIVE_MUST_BE_BLOCKED", prefix + "/release_state", "component.disposition.nonactive_blocked");
    issue = validateImmutableSource(component.source, prefix + "/source"); if (issue) return issue;
    issue = validateProvenance(component, prefix); if (issue) return issue;
    if (component.source.expected_artifact_sha256 !== component.artifact.artifact_sha256) return contractError("COMPONENT.ARTIFACT_HASH_CONFLICT", prefix + "/source/expected_artifact_sha256", "component.artifact.identity.hash_consistent");
    if (component.source.expected_byte_length !== component.artifact.byte_length) return contractError("COMPONENT.ARTIFACT_SIZE_CONFLICT", prefix + "/source/expected_byte_length", "component.artifact.identity.length_consistent");
    issue = validateRole(component, prefix); if (issue) return issue;
    issue = validateArchive(component, prefix); if (issue) return issue;
    issue = validateLicenseReference(component, prefix, licenses); if (issue) return issue;
    if (component.destination.kind === "managed_relative") {
      issue = pathProblem(component.destination.relative_path, prefix + "/destination/relative_path"); if (issue) return issue;
    }
    if (/[<>:"/\\|?*\u0000-\u001f]/.test(component.artifact.filename) || isDeviceSegment(component.artifact.filename) || /[. ]$/.test(component.artifact.filename)) return contractError("COMPONENT.ARTIFACT_FILENAME_UNSAFE", prefix + "/artifact/filename", "component.artifact.filename_safe");
    issue = validateOwnership(component, prefix); if (issue) return issue;
    if (["native_helper", "private_media_tool"].includes(component.component_role) && !component.signature) return contractError("COMPONENT.PRIVATE_EXECUTABLE_SIGNATURE_REQUIRED", prefix + "/signature", "component.role.private_executable_signature");
    issue = validateSignature(component, prefix); if (issue) return issue;
  }
  issue = validateApprovedLicenseScopes(document, licenses); if (issue) return issue;
  issue = validateDependencies(document); if (issue) return issue;
  issue = validateActionability(document, licenses); if (issue) return issue;
  return null;
}

function validateComponentManifest(document, schema) {
  if (!document || typeof document !== "object" || Array.isArray(document)) return contractError("CONTRACT.INVALID_ROOT", "", "contract.root.object_required");
  if (document.contract_id !== "minimax-h3-tool.component-manifest") return contractError("CONTRACT.UNKNOWN_CONTRACT", "/contract_id", "component-manifest.envelope.exact");
  if (document.schema_version !== "1.0.0") return contractError("CONTRACT.UNSUPPORTED_VERSION", "/schema_version", "component-manifest.schema_version.exact");
  let issue = verifyIntegrity(document); if (issue) return issue;
  issue = normalizeSchemaStage(document, schema); if (issue) return issue;
  return validateComponentDomain(document);
}

function validateCaseShape(testCase) {
  const allowed = new Set(["fixture_case_version", "case_id", "base", "mutations", "refresh_integrity", "expected"]);
  for (const key of Object.keys(testCase)) if (!allowed.has(key)) fail((testCase.case_id ?? "case") + ": unknown case field " + key);
  if (testCase.fixture_case_version !== "1.0.0" || !Array.isArray(testCase.mutations) || testCase.mutations.length === 0) fail(testCase.case_id + ": invalid case envelope");
  if ("refresh_integrity" in testCase && typeof testCase.refresh_integrity !== "boolean") fail(testCase.case_id + ": refresh_integrity must be boolean");
  if (testCase.base !== "valid/component-role-examples.json") fail(testCase.case_id + ": base must be the fixed fixture-relative locator");
}

function sanitizePublicEvidence() {
  const optional = [
    path.join(ROOT, "schemas/component-manifest/README.md"),
    path.join(ROOT, "docs/evidence/COMPONENT_MANIFEST_SCHEMA.md"),
    path.join(HERE, "README.md"),
    path.join(HERE, "validate.mjs")
  ].filter((file) => fs.existsSync(file));
  const files = [SCHEMA_PATH, ...optional, ...fs.readdirSync(VALID_DIR).map((name) => path.join(VALID_DIR, name)), ...fs.readdirSync(CASES_DIR).map((name) => path.join(CASES_DIR, name))];
  const privatePathPattern = /[A-Za-z]:[\\/]Users[\\/][^\\/\s"']+/i;
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    if (privatePathPattern.test(text)) fail("public evidence contains a private absolute path in " + path.basename(file));
  }
  return files.length;
}

function run() {
  const schema = readJson(SCHEMA_PATH);
  lintSchema(schema);
  const schemaDigest = sha256(schema);
  const validPath = path.join(VALID_DIR, "component-role-examples.json");
  const valid = readJson(validPath);
  assertSchemaValid(valid, schema, "valid component role examples");
  const validResult = validateComponentManifest(valid, schema);
  if (validResult) fail("valid component role examples rejected: " + canonicalJson(validResult));
  const caseFiles = fs.readdirSync(CASES_DIR).filter((name) => name.endsWith(".json")).sort();
  let negativeCount = 0;
  let validMutationCount = 0;
  const caseLines = [];
  for (const fileName of caseFiles) {
    const testCase = readJson(path.join(CASES_DIR, fileName));
    validateCaseShape(testCase);
    const document = readJson(path.join(HERE, testCase.base));
    for (const mutation of testCase.mutations) mutate(document, mutation);
    if (testCase.refresh_integrity !== false) refreshIntegrity(document);
    const actual = validateComponentManifest(document, schema);
    if (testCase.expected === "valid") {
      if (actual !== null) fail(testCase.case_id + ": expected valid but got " + canonicalJson(actual));
      assertSchemaValid(document, schema, testCase.case_id);
      validMutationCount += 1;
    } else {
      if (actual === null) fail(testCase.case_id + ": expected rejection but document was accepted");
      assertExact(actual, testCase.expected, testCase.case_id);
      negativeCount += 1;
    }
    caseLines.push("PASS case " + testCase.case_id);
  }
  const sanitizedCount = sanitizePublicEvidence();
  console.log("PASS schema component-manifest " + schemaDigest);
  console.log("PASS valid component-role-examples");
  for (const line of caseLines) console.log(line);
  console.log("PASS sanitized public evidence (" + sanitizedCount + " files)");
  console.log("SUMMARY schemas=1 valid_contracts=1 negative_cases=" + negativeCount + " valid_mutation_cases=" + validMutationCount);
}

run();
