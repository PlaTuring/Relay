import test from "node:test";
import assert from "node:assert/strict";
import { LIMITS, parseStrictJsonBytes, parseStrictJsonText } from "../src/index.mjs";
import { decodeUtf8Json, measureJsonValue } from "../src/strict-json.mjs";

function code(callback) {
  try {
    callback();
  } catch (error) {
    assert.equal(typeof error.diagnostic?.code, "string");
    return error.diagnostic.code;
  }
  assert.fail("expected a strict JSON diagnostic");
}

test("strict parser rejects malformed, duplicate-key, trailing, BOM, invalid UTF-8 and invalid Unicode JSON", () => {
  assert.equal(code(() => parseStrictJsonText("{")), "INPUT.MALFORMED_JSON");
  assert.equal(code(() => parseStrictJsonText('{"a":1,"a":2}')), "INPUT.DUPLICATE_JSON_KEY");
  assert.equal(code(() => parseStrictJsonText("{}{}")), "INPUT.TRAILING_JSON_DATA");
  assert.equal(code(() => parseStrictJsonBytes(Uint8Array.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]))), "INPUT.UTF8_BOM_FORBIDDEN");
  assert.equal(code(() => parseStrictJsonBytes(Uint8Array.from([0x22, 0xc3, 0x28, 0x22]))), "INPUT.INVALID_UTF8");
  assert.equal(code(() => parseStrictJsonText('"\\ud800"')), "INPUT.INVALID_UNICODE_ESCAPE");
  assert.equal(code(() => parseStrictJsonText("9007199254740992")), "INPUT.UNSAFE_INTEGER");
});

test("JSON depth accepts fixed N and rejects N+1", () => {
  const nested = (depth) => `${"[".repeat(depth - 1)}0${"]".repeat(depth - 1)}`;
  assert.equal(parseStrictJsonText(nested(LIMITS.maxJsonDepth)).value instanceof Array, true);
  assert.equal(code(() => parseStrictJsonText(nested(LIMITS.maxJsonDepth + 1))), "INPUT.JSON_DEPTH_LIMIT");
});

test("JSON value and property limits accept fixed N and reject N+1", () => {
  const valuesAt = `[${Array.from({ length: LIMITS.maxJsonValues - 1 }, () => "0").join(",")}]`;
  assert.equal(parseStrictJsonText(valuesAt).stats.values, LIMITS.maxJsonValues);
  assert.equal(code(() => parseStrictJsonText(`${valuesAt.slice(0, -1)},0]`)), "INPUT.JSON_VALUE_LIMIT");

  const objectText = (count) => `{${Array.from({ length: count }, (_, index) => `"k${index}":0`).join(",")}}`;
  assert.equal(parseStrictJsonText(objectText(LIMITS.maxJsonProperties)).stats.properties, LIMITS.maxJsonProperties);
  assert.equal(code(() => parseStrictJsonText(objectText(LIMITS.maxJsonProperties + 1))), "INPUT.JSON_PROPERTY_LIMIT");
});

test("individual and aggregate string byte limits accept fixed N and reject N+1", () => {
  const oneMiB = "a".repeat(LIMITS.maxStringBytes);
  assert.equal(parseStrictJsonText(JSON.stringify(oneMiB)).value.length, LIMITS.maxStringBytes);
  assert.equal(code(() => parseStrictJsonText(JSON.stringify(`${oneMiB}a`))), "INPUT.STRING_SIZE_LIMIT");
  const aggregateAt = Array.from({ length: 8 }, () => oneMiB);
  assert.equal(parseStrictJsonText(JSON.stringify(aggregateAt)).stats.aggregate_string_bytes, LIMITS.maxAggregateStringBytes);
  assert.equal(code(() => parseStrictJsonText(JSON.stringify([...aggregateAt, "a"]))), "INPUT.STRING_AGGREGATE_LIMIT");
});

test("per-file bytes accept N and reject N+1 before decoding", () => {
  const at = new Uint8Array(LIMITS.maxFileBytes);
  at.fill(0x20);
  assert.equal(decodeUtf8Json(at).length, LIMITS.maxFileBytes);
  assert.equal(code(() => decodeUtf8Json(new Uint8Array(LIMITS.maxFileBytes + 1))), "INPUT.FILE_SIZE_LIMIT");
  assert.equal(LIMITS.maxTotalBytes, LIMITS.maxFileBytes * 3);
});

test("callers may tighten but cannot loosen fixed ceilings", () => {
  assert.equal(parseStrictJsonText("[[0]]", { maxJsonDepth: 3 }).value[0][0], 0);
  assert.equal(code(() => parseStrictJsonText("[[[0]]]", { maxJsonDepth: 3 })), "INPUT.JSON_DEPTH_LIMIT");
  assert.doesNotThrow(() => parseStrictJsonText("[[[0]]]", { maxJsonDepth: LIMITS.maxJsonDepth + 100 }));
  const measured = measureJsonValue({ safe: [1, 2, 3] });
  assert.equal(measured.properties, 1);
});
