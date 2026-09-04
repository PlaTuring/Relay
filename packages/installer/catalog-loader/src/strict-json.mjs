import { createHash } from "node:crypto";

import { loaderError } from "./errors.mjs";

export const JSON_LIMITS = Object.freeze({
  maxBytes: 16 * 1024 * 1024,
  maxDepth: 64,
  maxValues: 200_000,
  maxObjectProperties: 10_000,
  maxArrayItems: 10_000,
  maxKeyBytes: 128,
  maxStringBytes: 1024 * 1024,
  maxTotalStringBytes: 12 * 1024 * 1024
});

class ParseFailure extends Error {
  constructor(code, ruleId, characterOffset) {
    super(code);
    this.code = code;
    this.ruleId = ruleId;
    this.characterOffset = characterOffset;
  }
}

function fail(code, ruleId, characterOffset) {
  throw new ParseFailure(code, ruleId, characterOffset);
}

class StrictJsonParser {
  constructor(text) {
    this.text = text;
    this.position = 0;
    this.values = 0;
    this.totalStringBytes = 0;
  }

  parse() {
    this.skipWhitespace();
    const value = this.parseValue(0);
    this.skipWhitespace();
    if (this.position !== this.text.length) {
      fail("CONTRACT.INVALID_JSON", "contract.parse.trailing_data", this.position);
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

  countValue(depth) {
    if (depth > JSON_LIMITS.maxDepth) {
      fail("CONTRACT.INPUT_TOO_DEEP", "contract.parse.depth_limit", this.position);
    }
    this.values += 1;
    if (this.values > JSON_LIMITS.maxValues) {
      fail("CONTRACT.TOO_MANY_VALUES", "contract.parse.value_limit", this.position);
    }
  }

  parseValue(depth) {
    this.countValue(depth);
    const character = this.text[this.position];
    if (character === "{") return this.parseObject(depth + 1);
    if (character === "[") return this.parseArray(depth + 1);
    if (character === '"') return this.parseString(false);
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
    return this.parseInteger();
  }

  parseString(isKey) {
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
          fail("CONTRACT.INVALID_JSON", "contract.parse.string_lexical", start);
        }
        const byteLength = Buffer.byteLength(value, "utf8");
        if (isKey && byteLength > JSON_LIMITS.maxKeyBytes) {
          fail("CONTRACT.KEY_TOO_LARGE", "contract.parse.key_size_limit", start);
        }
        if (!isKey && byteLength > JSON_LIMITS.maxStringBytes) {
          fail("CONTRACT.STRING_TOO_LARGE", "contract.parse.string_size_limit", start);
        }
        this.totalStringBytes += byteLength;
        if (this.totalStringBytes > JSON_LIMITS.maxTotalStringBytes) {
          fail(
            "CONTRACT.STRING_BYTES_TOO_LARGE",
            "contract.parse.total_string_size_limit",
            start
          );
        }
        if (value.includes("\u0000")) {
          fail("CONTRACT.INVALID_STRING", "contract.parse.nul_forbidden", start);
        }
        for (let index = 0; index < value.length; index += 1) {
          const unit = value.charCodeAt(index);
          if (unit >= 0xd800 && unit <= 0xdbff) {
            const next = value.charCodeAt(index + 1);
            if (!(next >= 0xdc00 && next <= 0xdfff)) {
              fail("CONTRACT.INVALID_STRING", "contract.parse.unpaired_surrogate", start);
            }
            index += 1;
          } else if (unit >= 0xdc00 && unit <= 0xdfff) {
            fail("CONTRACT.INVALID_STRING", "contract.parse.unpaired_surrogate", start);
          }
        }
        return value;
      }
      if (codeUnit < 0x20) {
        fail("CONTRACT.INVALID_JSON", "contract.parse.control_character", this.position);
      }
      if (character === "\\") {
        this.position += 1;
        const escape = this.text[this.position];
        if (!'"\\/bfnrtu'.includes(escape ?? "")) {
          fail("CONTRACT.INVALID_JSON", "contract.parse.escape_lexical", this.position);
        }
        if (escape === "u") {
          const hexadecimal = this.text.slice(this.position + 1, this.position + 5);
          if (!/^[0-9a-fA-F]{4}$/u.test(hexadecimal)) {
            fail("CONTRACT.INVALID_JSON", "contract.parse.unicode_escape_lexical", this.position);
          }
          this.position += 4;
        }
      }
      this.position += 1;
    }
    fail("CONTRACT.INVALID_JSON", "contract.parse.unterminated_string", start);
  }

  parseInteger() {
    const start = this.position;
    const match = /^-?(?:0|[1-9][0-9]*)/u.exec(this.text.slice(start));
    if (!match) fail("CONTRACT.INVALID_JSON", "contract.parse.value_lexical", start);
    if (match[0] === "-0") {
      fail("CONTRACT.INVALID_NUMBER", "contract.parse.negative_zero_forbidden", start);
    }
    const end = start + match[0].length;
    if (/[.eE]/u.test(this.text[end] ?? "")) {
      fail("CONTRACT.INVALID_NUMBER", "contract.parse.integer_lexical_only", start);
    }
    const value = Number(match[0]);
    if (!Number.isSafeInteger(value)) {
      fail("CONTRACT.INVALID_NUMBER", "contract.parse.safe_integer_only", start);
    }
    this.position = end;
    return value;
  }

  parseObject(depth) {
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
        fail("CONTRACT.INVALID_JSON", "contract.parse.object_key_string", this.position);
      }
      const keyOffset = this.position;
      const key = this.parseString(true);
      if (keys.has(key)) {
        fail("CONTRACT.DUPLICATE_KEY", "contract.parse.duplicate_key", keyOffset);
      }
      keys.add(key);
      if (keys.size > JSON_LIMITS.maxObjectProperties) {
        fail(
          "CONTRACT.TOO_MANY_PROPERTIES",
          "contract.parse.object_property_limit",
          keyOffset
        );
      }
      this.skipWhitespace();
      if (this.text[this.position] !== ":") {
        fail("CONTRACT.INVALID_JSON", "contract.parse.object_colon", this.position);
      }
      this.position += 1;
      this.skipWhitespace();
      result[key] = this.parseValue(depth);
      this.skipWhitespace();
      if (this.text[this.position] === "}") {
        this.position += 1;
        return result;
      }
      if (this.text[this.position] !== ",") {
        fail("CONTRACT.INVALID_JSON", "contract.parse.object_comma", this.position);
      }
      this.position += 1;
      this.skipWhitespace();
    }
  }

  parseArray(depth) {
    const result = [];
    this.position += 1;
    this.skipWhitespace();
    if (this.text[this.position] === "]") {
      this.position += 1;
      return result;
    }
    while (true) {
      if (result.length >= JSON_LIMITS.maxArrayItems) {
        fail("CONTRACT.TOO_MANY_ITEMS", "contract.parse.array_item_limit", this.position);
      }
      result.push(this.parseValue(depth));
      this.skipWhitespace();
      if (this.text[this.position] === "]") {
        this.position += 1;
        return result;
      }
      if (this.text[this.position] !== ",") {
        fail("CONTRACT.INVALID_JSON", "contract.parse.array_comma", this.position);
      }
      this.position += 1;
      this.skipWhitespace();
    }
  }
}

function copyBoundedBytes(input) {
  if (!(input instanceof Uint8Array)) {
    throw loaderError({
      code: "CONTRACT.INVALID_INPUT_BYTES",
      stage: "size",
      instancePath: "",
      ruleId: "contract.input.bytes_required"
    });
  }
  if (input.byteLength > JSON_LIMITS.maxBytes) {
    throw loaderError({
      code: "CONTRACT.INPUT_TOO_LARGE",
      stage: "size",
      instancePath: "",
      ruleId: "contract.input.raw_size_limit"
    });
  }
  return Buffer.from(input);
}

export function parseStrictJson(input, { stage = "parse", requireCanonicalBytes = false } = {}) {
  const bytes = copyBoundedBytes(input);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw loaderError({
      code: "CONTRACT.UTF8_BOM_FORBIDDEN",
      stage: "encoding",
      instancePath: "",
      ruleId: "contract.input.utf8_without_bom",
      byteOffset: 0
    });
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw loaderError({
      code: "CONTRACT.INVALID_UTF8",
      stage: "encoding",
      instancePath: "",
      ruleId: "contract.input.valid_utf8"
    });
  }
  let value;
  try {
    value = new StrictJsonParser(text).parse();
  } catch (error) {
    if (!(error instanceof ParseFailure)) throw error;
    const byteOffset = Buffer.byteLength(text.slice(0, error.characterOffset), "utf8");
    throw loaderError({
      code: error.code,
      stage,
      instancePath: "",
      ruleId: error.ruleId,
      byteOffset
    });
  }
  if (requireCanonicalBytes) {
    const canonicalBytes = Buffer.from(canonicalJson(value), "utf8");
    if (!bytes.equals(canonicalBytes)) {
      throw loaderError({
        code: "CONTRACT.NON_CANONICAL_JSON",
        stage,
        instancePath: "",
        ruleId: "contract.input.exact_jcs_bytes"
      });
    }
  }
  return value;
}

export function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw loaderError({
        code: "CONTRACT.INVALID_NUMBER",
        stage: "canonicalization",
        instancePath: "",
        ruleId: "contract.jcs.safe_integer_only"
      });
    }
    return String(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  throw loaderError({
    code: "CONTRACT.INVALID_JCS_VALUE",
    stage: "canonicalization",
    instancePath: "",
    ruleId: "contract.jcs.json_values_only"
  });
}

export function sha256Jcs(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

export function contentSha256(document) {
  const projection = structuredClone(document);
  delete projection.integrity;
  return sha256Jcs(projection);
}
