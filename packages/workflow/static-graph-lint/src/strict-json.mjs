import { LIMITS, RULES, tightenedLimits } from "./constants.mjs";

export class JsonInputError extends Error {
  constructor(code, instancePath = "/") {
    super(code);
    this.name = "JsonInputError";
    this.diagnostic = Object.freeze({ code, instance_path: instancePath, rule_id: RULES.input });
  }
}

function fail(code, path = "/") {
  throw new JsonInputError(code, path);
}

export function decodeUtf8Json(bytes, limits = LIMITS) {
  limits = tightenedLimits(limits);
  if (!(bytes instanceof Uint8Array)) throw new TypeError("bytes must be a Uint8Array");
  if (bytes.byteLength > limits.maxFileBytes) fail("INPUT.FILE_SIZE_LIMIT");
  if (bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    fail("INPUT.UTF8_BOM_FORBIDDEN");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    fail("INPUT.INVALID_UTF8");
  }
}

export function parseStrictJsonBytes(bytes, limits = LIMITS) {
  limits = tightenedLimits(limits);
  return parseStrictJsonText(decodeUtf8Json(bytes, limits), limits);
}

export function parseStrictJsonText(text, limits = LIMITS) {
  limits = tightenedLimits(limits);
  if (typeof text !== "string") throw new TypeError("text must be a string");
  let offset = 0;
  let values = 0;
  let properties = 0;
  let aggregateStringBytes = 0;

  const countValue = () => {
    values += 1;
    if (values > limits.maxJsonValues) fail("INPUT.JSON_VALUE_LIMIT");
  };
  const countString = (value) => {
    const bytes = Buffer.byteLength(value, "utf8");
    if (bytes > limits.maxStringBytes) fail("INPUT.STRING_SIZE_LIMIT");
    aggregateStringBytes += bytes;
    if (aggregateStringBytes > limits.maxAggregateStringBytes) fail("INPUT.STRING_AGGREGATE_LIMIT");
  };
  const whitespace = () => {
    while (offset < text.length && (text[offset] === " " || text[offset] === "\t" || text[offset] === "\n" || text[offset] === "\r")) offset += 1;
  };
  const parseString = () => {
    if (text[offset] !== '"') fail("INPUT.MALFORMED_JSON");
    offset += 1;
    let result = "";
    while (offset < text.length) {
      const character = text[offset++];
      if (character === '"') {
        countString(result);
        return result;
      }
      if (character === "\\") {
        if (offset >= text.length) fail("INPUT.MALFORMED_JSON");
        const escape = text[offset++];
        const simple = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
        if (Object.hasOwn(simple, escape)) {
          result += simple[escape];
          continue;
        }
        if (escape !== "u" || !/^[0-9a-fA-F]{4}$/.test(text.slice(offset, offset + 4))) fail("INPUT.MALFORMED_JSON");
        const first = Number.parseInt(text.slice(offset, offset + 4), 16);
        offset += 4;
        if (first >= 0xd800 && first <= 0xdbff) {
          if (text.slice(offset, offset + 2) !== "\\u" || !/^[0-9a-fA-F]{4}$/.test(text.slice(offset + 2, offset + 6))) fail("INPUT.INVALID_UNICODE_ESCAPE");
          const second = Number.parseInt(text.slice(offset + 2, offset + 6), 16);
          if (second < 0xdc00 || second > 0xdfff) fail("INPUT.INVALID_UNICODE_ESCAPE");
          result += String.fromCodePoint(0x10000 + ((first - 0xd800) << 10) + second - 0xdc00);
          offset += 6;
        } else {
          if (first >= 0xdc00 && first <= 0xdfff) fail("INPUT.INVALID_UNICODE_ESCAPE");
          result += String.fromCharCode(first);
        }
        continue;
      }
      if (character.charCodeAt(0) <= 0x1f) fail("INPUT.MALFORMED_JSON");
      result += character;
    }
    fail("INPUT.MALFORMED_JSON");
  };
  const parseValue = (depth) => {
    if (depth > limits.maxJsonDepth) fail("INPUT.JSON_DEPTH_LIMIT");
    whitespace();
    countValue();
    const character = text[offset];
    if (character === '"') return parseString();
    if (character === "{") {
      offset += 1;
      const result = Object.create(null);
      const keys = new Set();
      whitespace();
      if (text[offset] === "}") { offset += 1; return result; }
      while (offset < text.length) {
        whitespace();
        if (text[offset] !== '"') fail("INPUT.MALFORMED_JSON");
        const key = parseString();
        properties += 1;
        if (properties > limits.maxJsonProperties) fail("INPUT.JSON_PROPERTY_LIMIT");
        if (keys.has(key)) fail("INPUT.DUPLICATE_JSON_KEY", "/@duplicate");
        keys.add(key);
        whitespace();
        if (text[offset++] !== ":") fail("INPUT.MALFORMED_JSON");
        result[key] = parseValue(depth + 1);
        whitespace();
        if (text[offset] === "}") { offset += 1; return result; }
        if (text[offset++] !== ",") fail("INPUT.MALFORMED_JSON");
      }
      fail("INPUT.MALFORMED_JSON");
    }
    if (character === "[") {
      offset += 1;
      const result = [];
      whitespace();
      if (text[offset] === "]") { offset += 1; return result; }
      while (offset < text.length) {
        result.push(parseValue(depth + 1));
        whitespace();
        if (text[offset] === "]") { offset += 1; return result; }
        if (text[offset++] !== ",") fail("INPUT.MALFORMED_JSON");
      }
      fail("INPUT.MALFORMED_JSON");
    }
    const remainder = text.slice(offset);
    if (remainder.startsWith("true")) { offset += 4; return true; }
    if (remainder.startsWith("false")) { offset += 5; return false; }
    if (remainder.startsWith("null")) { offset += 4; return null; }
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(remainder);
    if (!match) fail("INPUT.MALFORMED_JSON");
    offset += match[0].length;
    const number = Number(match[0]);
    if (!Number.isFinite(number)) fail("INPUT.NUMBER_RANGE");
    if (Number.isInteger(number) && !Number.isSafeInteger(number)) fail("INPUT.UNSAFE_INTEGER");
    return number;
  };

  whitespace();
  if (offset === text.length) fail("INPUT.MALFORMED_JSON");
  const value = parseValue(1);
  whitespace();
  if (offset !== text.length) fail("INPUT.TRAILING_JSON_DATA");
  return Object.freeze({
    value,
    stats: Object.freeze({ values, properties, aggregate_string_bytes: aggregateStringBytes }),
  });
}

export function measureJsonValue(value, limits = LIMITS) {
  limits = tightenedLimits(limits);
  let values = 0;
  let properties = 0;
  let aggregateStringBytes = 0;
  let maxDepth = 0;
  const stack = [{ value, depth: 1 }];
  const seen = new Set();
  while (stack.length > 0) {
    const current = stack.pop();
    values += 1;
    if (values > limits.maxJsonValues) fail("INPUT.JSON_VALUE_LIMIT");
    if (current.depth > limits.maxJsonDepth) fail("INPUT.JSON_DEPTH_LIMIT");
    maxDepth = Math.max(maxDepth, current.depth);
    if (typeof current.value === "string") {
      const bytes = Buffer.byteLength(current.value, "utf8");
      if (bytes > limits.maxStringBytes) fail("INPUT.STRING_SIZE_LIMIT");
      aggregateStringBytes += bytes;
      if (aggregateStringBytes > limits.maxAggregateStringBytes) fail("INPUT.STRING_AGGREGATE_LIMIT");
    } else if (current.value !== null && typeof current.value === "object") {
      if (seen.has(current.value)) fail("INPUT.NON_JSON_CYCLE");
      seen.add(current.value);
      if (Array.isArray(current.value)) {
        for (let index = current.value.length - 1; index >= 0; index -= 1) stack.push({ value: current.value[index], depth: current.depth + 1 });
      } else {
        const prototype = Object.getPrototypeOf(current.value);
        if (prototype !== Object.prototype && prototype !== null) fail("INPUT.NON_JSON_OBJECT");
        const keys = Object.keys(current.value);
        properties += keys.length;
        if (properties > limits.maxJsonProperties) fail("INPUT.JSON_PROPERTY_LIMIT");
        for (let index = keys.length - 1; index >= 0; index -= 1) {
          const keyBytes = Buffer.byteLength(keys[index], "utf8");
          if (keyBytes > limits.maxStringBytes) fail("INPUT.STRING_SIZE_LIMIT");
          aggregateStringBytes += keyBytes;
          if (aggregateStringBytes > limits.maxAggregateStringBytes) fail("INPUT.STRING_AGGREGATE_LIMIT");
          stack.push({ value: current.value[keys[index]], depth: current.depth + 1 });
        }
      }
    } else if (typeof current.value !== "number" && typeof current.value !== "boolean" && current.value !== null) {
      fail("INPUT.NON_JSON_VALUE");
    } else if (typeof current.value === "number" && (!Number.isFinite(current.value) || (Number.isInteger(current.value) && !Number.isSafeInteger(current.value)))) {
      fail(Number.isFinite(current.value) ? "INPUT.UNSAFE_INTEGER" : "INPUT.NUMBER_RANGE");
    }
  }
  return Object.freeze({ values, properties, aggregate_string_bytes: aggregateStringBytes, max_depth: maxDepth });
}
