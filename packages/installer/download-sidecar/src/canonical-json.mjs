import { createHash } from "node:crypto";

import { fail } from "./errors.mjs";

export const JSON_LIMITS = Object.freeze({
  maxBytes: 64 * 1024,
  maxDepth: 16,
  maxValues: 256,
  maxObjectProperties: 32,
  maxArrayItems: 32,
  maxKeyBytes: 128,
  maxStringBytes: 4096,
  maxTotalStringBytes: 16 * 1024
});

function pointerEscape(value) {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function appendPath(parent, segment) {
  return `${parent}/${pointerEscape(String(segment))}`;
}

class ParseFailure extends Error {
  constructor(code, instancePath, ruleId) {
    super(code);
    this.code = code;
    this.instancePath = instancePath;
    this.ruleId = ruleId;
  }
}

function parseFail(code, instancePath, ruleId) {
  throw new ParseFailure(code, instancePath, ruleId);
}

function assertWellFormedString(value, instancePath, ruleId) {
  if (value.includes("\u0000")) {
    fail("SIDECAR.INVALID_STRING", instancePath, "sidecar.json.string.nul_forbidden");
  }
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        fail("SIDECAR.INVALID_STRING", instancePath, ruleId);
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      fail("SIDECAR.INVALID_STRING", instancePath, ruleId);
    }
  }
}

class StrictJsonParser {
  constructor(text) {
    this.text = text;
    this.position = 0;
    this.valueCount = 0;
    this.totalStringBytes = 0;
  }

  parse() {
    this.skipWhitespace();
    const value = this.parseValue(0, "");
    this.skipWhitespace();
    if (this.position !== this.text.length) {
      parseFail("SIDECAR.INVALID_JSON", "", "sidecar.json.trailing_data");
    }
    return value;
  }

  skipWhitespace() {
    while (
      this.position < this.text.length &&
      /[\u0009\u000a\u000d\u0020]/u.test(this.text[this.position])
    ) {
      this.position += 1;
    }
  }

  countValue(depth, instancePath) {
    if (depth > JSON_LIMITS.maxDepth) {
      parseFail("SIDECAR.INPUT_TOO_DEEP", instancePath, "sidecar.json.depth_limit");
    }
    this.valueCount += 1;
    if (this.valueCount > JSON_LIMITS.maxValues) {
      parseFail("SIDECAR.TOO_MANY_VALUES", instancePath, "sidecar.json.value_limit");
    }
  }

  parseValue(depth, instancePath) {
    this.countValue(depth, instancePath);
    const character = this.text[this.position];
    if (character === "{") return this.parseObject(depth + 1, instancePath);
    if (character === "[") return this.parseArray(depth + 1, instancePath);
    if (character === '"') return this.parseString(false, instancePath);
    if (character === "t" && this.text.startsWith("true", this.position)) {
      this.position += 4;
      return true;
    }
    if (character === "f" && this.text.startsWith("false", this.position)) {
      this.position += 5;
      return false;
    }
    if (character === "n" && this.text.startsWith("null", this.position)) {
      this.position += 4;
      return null;
    }
    return this.parseInteger(instancePath);
  }

  parseString(isKey, instancePath) {
    const start = this.position;
    this.position += 1;
    while (this.position < this.text.length) {
      const codeUnit = this.text.charCodeAt(this.position);
      const character = this.text[this.position];
      if (character === '"') {
        this.position += 1;
        let value;
        try {
          value = JSON.parse(this.text.slice(start, this.position));
        } catch {
          parseFail("SIDECAR.INVALID_JSON", instancePath, "sidecar.json.string_lexical");
        }
        const byteLength = Buffer.byteLength(value, "utf8");
        if (isKey && byteLength > JSON_LIMITS.maxKeyBytes) {
          parseFail("SIDECAR.KEY_TOO_LARGE", instancePath, "sidecar.json.key_size_limit");
        }
        if (!isKey && byteLength > JSON_LIMITS.maxStringBytes) {
          parseFail("SIDECAR.STRING_TOO_LARGE", instancePath, "sidecar.json.string_size_limit");
        }
        this.totalStringBytes += byteLength;
        if (this.totalStringBytes > JSON_LIMITS.maxTotalStringBytes) {
          parseFail(
            "SIDECAR.STRING_BYTES_TOO_LARGE",
            instancePath,
            "sidecar.json.total_string_size_limit"
          );
        }
        if (value.includes("\u0000")) {
          parseFail("SIDECAR.INVALID_STRING", instancePath, "sidecar.json.string.nul_forbidden");
        }
        for (let index = 0; index < value.length; index += 1) {
          const unit = value.charCodeAt(index);
          if (unit >= 0xd800 && unit <= 0xdbff) {
            const next = value.charCodeAt(index + 1);
            if (!(next >= 0xdc00 && next <= 0xdfff)) {
              parseFail(
                "SIDECAR.INVALID_STRING",
                instancePath,
                "sidecar.json.string.unpaired_surrogate"
              );
            }
            index += 1;
          } else if (unit >= 0xdc00 && unit <= 0xdfff) {
            parseFail(
              "SIDECAR.INVALID_STRING",
              instancePath,
              "sidecar.json.string.unpaired_surrogate"
            );
          }
        }
        return value;
      }
      if (codeUnit < 0x20) {
        parseFail("SIDECAR.INVALID_JSON", instancePath, "sidecar.json.control_character");
      }
      if (character === "\\") {
        this.position += 1;
        const escape = this.text[this.position];
        if (!'"\\/bfnrtu'.includes(escape ?? "")) {
          parseFail("SIDECAR.INVALID_JSON", instancePath, "sidecar.json.escape_lexical");
        }
        if (escape === "u") {
          const hexadecimal = this.text.slice(this.position + 1, this.position + 5);
          if (!/^[0-9a-fA-F]{4}$/u.test(hexadecimal)) {
            parseFail("SIDECAR.INVALID_JSON", instancePath, "sidecar.json.unicode_escape");
          }
          this.position += 4;
        }
      }
      this.position += 1;
    }
    parseFail("SIDECAR.INVALID_JSON", instancePath, "sidecar.json.unterminated_string");
  }

  parseInteger(instancePath) {
    const start = this.position;
    const match = /^-?(?:0|[1-9][0-9]*)/u.exec(this.text.slice(start));
    if (!match) {
      parseFail("SIDECAR.INVALID_JSON", instancePath, "sidecar.json.value_lexical");
    }
    if (match[0] === "-0") {
      parseFail("SIDECAR.INVALID_NUMBER", instancePath, "sidecar.json.negative_zero_forbidden");
    }
    const end = start + match[0].length;
    if (/[.eE]/u.test(this.text[end] ?? "")) {
      parseFail("SIDECAR.INVALID_NUMBER", instancePath, "sidecar.json.integer_lexical_only");
    }
    const value = Number(match[0]);
    if (!Number.isSafeInteger(value)) {
      parseFail("SIDECAR.INVALID_NUMBER", instancePath, "sidecar.json.safe_integer_only");
    }
    this.position = end;
    return value;
  }

  parseObject(depth, instancePath) {
    const result = Object.create(null);
    const keys = new Set();
    this.position += 1;
    this.skipWhitespace();
    if (this.text[this.position] === "}") {
      this.position += 1;
      return result;
    }
    while (true) {
      if (this.text[this.position] !== '"') {
        parseFail("SIDECAR.INVALID_JSON", instancePath, "sidecar.json.object_key_string");
      }
      const key = this.parseString(true, instancePath);
      const propertyPath = appendPath(instancePath, key);
      if (keys.has(key)) {
        parseFail("SIDECAR.DUPLICATE_KEY", propertyPath, "sidecar.json.duplicate_key");
      }
      keys.add(key);
      if (keys.size > JSON_LIMITS.maxObjectProperties) {
        parseFail(
          "SIDECAR.TOO_MANY_PROPERTIES",
          instancePath,
          "sidecar.json.object_property_limit"
        );
      }
      this.skipWhitespace();
      if (this.text[this.position] !== ":") {
        parseFail("SIDECAR.INVALID_JSON", propertyPath, "sidecar.json.object_colon");
      }
      this.position += 1;
      this.skipWhitespace();
      result[key] = this.parseValue(depth, propertyPath);
      this.skipWhitespace();
      if (this.text[this.position] === "}") {
        this.position += 1;
        return result;
      }
      if (this.text[this.position] !== ",") {
        parseFail("SIDECAR.INVALID_JSON", instancePath, "sidecar.json.object_comma");
      }
      this.position += 1;
      this.skipWhitespace();
    }
  }

  parseArray(depth, instancePath) {
    const result = [];
    this.position += 1;
    this.skipWhitespace();
    if (this.text[this.position] === "]") {
      this.position += 1;
      return result;
    }
    while (true) {
      if (result.length >= JSON_LIMITS.maxArrayItems) {
        parseFail("SIDECAR.TOO_MANY_ITEMS", instancePath, "sidecar.json.array_item_limit");
      }
      const itemPath = appendPath(instancePath, result.length);
      result.push(this.parseValue(depth, itemPath));
      this.skipWhitespace();
      if (this.text[this.position] === "]") {
        this.position += 1;
        return result;
      }
      if (this.text[this.position] !== ",") {
        parseFail("SIDECAR.INVALID_JSON", instancePath, "sidecar.json.array_comma");
      }
      this.position += 1;
      this.skipWhitespace();
    }
  }
}

function copyBytes(input) {
  if (!(input instanceof Uint8Array)) {
    fail("SIDECAR.INVALID_INPUT_BYTES", "", "sidecar.input.bytes_required");
  }
  return Buffer.from(input);
}

export function parseCanonicalJson(input) {
  const bytes = copyBytes(input);
  if (bytes.length === 0) {
    fail("SIDECAR.INVALID_JSON", "", "sidecar.input.nonempty");
  }
  if (bytes.length > JSON_LIMITS.maxBytes) {
    fail("SIDECAR.INPUT_TOO_LARGE", "", "sidecar.input.raw_size_limit");
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    fail("SIDECAR.UTF8_BOM_FORBIDDEN", "", "sidecar.input.utf8_without_bom");
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("SIDECAR.INVALID_UTF8", "", "sidecar.input.valid_utf8");
  }
  let value;
  try {
    value = new StrictJsonParser(text).parse();
  } catch (error) {
    if (!(error instanceof ParseFailure)) throw error;
    fail(error.code, error.instancePath, error.ruleId);
  }
  const canonicalBytes = Buffer.from(canonicalJson(value), "utf8");
  if (!bytes.equals(canonicalBytes)) {
    fail("SIDECAR.NON_CANONICAL_BYTES", "", "sidecar.input.exact_jcs_bytes");
  }
  return value;
}

export function canonicalJson(value, instancePath = "") {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
      fail("SIDECAR.INVALID_NUMBER", instancePath, "sidecar.jcs.safe_integer_only");
    }
    return String(value);
  }
  if (typeof value === "string") {
    assertWellFormedString(value, instancePath, "sidecar.jcs.string.well_formed");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value
      .map((item, index) => canonicalJson(item, appendPath(instancePath, index)))
      .join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => {
        assertWellFormedString(key, instancePath, "sidecar.jcs.key.well_formed");
        return `${JSON.stringify(key)}:${canonicalJson(
          value[key],
          appendPath(instancePath, key)
        )}`;
      })
      .join(",")}}`;
  }
  fail("SIDECAR.INVALID_JCS_VALUE", instancePath, "sidecar.jcs.json_values_only");
}

export function sha256Jcs(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

export function contentSha256(document) {
  const projection = structuredClone(document);
  delete projection.integrity;
  return sha256Jcs(projection);
}

export function canonicalBytes(value) {
  return Buffer.from(canonicalJson(value), "utf8");
}
