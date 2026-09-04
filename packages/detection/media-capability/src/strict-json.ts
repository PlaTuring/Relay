interface JsonLimits {
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxArrayLength: number;
  readonly maxObjectProperties: number;
  readonly maxStringLength: number;
}

const defaultLimits: JsonLimits = Object.freeze({
  maxDepth: 16,
  maxNodes: 20_000,
  maxArrayLength: 8_192,
  maxObjectProperties: 256,
  maxStringLength: 32_768
});

export function parseStrictJson(text: string, limits: JsonLimits = defaultLimits): unknown {
  let offset = 0;
  let nodes = 0;

  function fail(): never {
    throw new Error("MEDIA.OUTPUT_INVALID");
  }

  function skipWhitespace(): void {
    while (offset < text.length && /[\u0020\u0009\u000a\u000d]/u.test(text[offset] ?? "")) {
      offset += 1;
    }
  }

  function parseString(): string {
    if (text[offset] !== '"') fail();
    const start = offset;
    offset += 1;
    while (offset < text.length) {
      const code = text.charCodeAt(offset);
      if (code === 0x22) {
        offset += 1;
        const raw = text.slice(start, offset);
        let value: unknown;
        try {
          value = JSON.parse(raw) as unknown;
        } catch {
          fail();
        }
        if (
          typeof value !== "string" ||
          Buffer.byteLength(value, "utf8") > limits.maxStringLength
        ) {
          fail();
        }
        for (let index = 0; index < value.length; index += 1) {
          const unit = value.charCodeAt(index);
          if (unit >= 0xd800 && unit <= 0xdbff) {
            const next = value.charCodeAt(index + 1);
            if (!(next >= 0xdc00 && next <= 0xdfff)) fail();
            index += 1;
          } else if (unit >= 0xdc00 && unit <= 0xdfff) {
            fail();
          }
        }
        return value;
      }
      if (code < 0x20) fail();
      if (code === 0x5c) {
        offset += 1;
        const escaped = text[offset];
        if (escaped === "u") {
          if (!/^[0-9a-fA-F]{4}$/u.test(text.slice(offset + 1, offset + 5))) fail();
          offset += 5;
          continue;
        }
        if (!escaped || !'"\\/bfnrt'.includes(escaped)) fail();
      }
      offset += 1;
    }
    fail();
  }

  function parseNumber(): number {
    const match = /-?(?:0|[1-9][0-9]*)/uy;
    match.lastIndex = offset;
    const result = match.exec(text);
    if (!result) fail();
    offset = match.lastIndex;
    if (result[0] === "-0") fail();
    const value = Number(result[0]);
    if (!Number.isSafeInteger(value)) fail();
    return value;
  }

  function parseValue(depth: number): unknown {
    if (depth > limits.maxDepth || ++nodes > limits.maxNodes) fail();
    skipWhitespace();
    const character = text[offset];
    if (character === '"') return parseString();
    if (character === "{") return parseObject(depth + 1);
    if (character === "[") return parseArray(depth + 1);
    if (text.startsWith("true", offset)) {
      offset += 4;
      return true;
    }
    if (text.startsWith("false", offset)) {
      offset += 5;
      return false;
    }
    if (text.startsWith("null", offset)) {
      offset += 4;
      return null;
    }
    return parseNumber();
  }

  function parseArray(depth: number): unknown[] {
    offset += 1;
    skipWhitespace();
    const values: unknown[] = [];
    if (text[offset] === "]") {
      offset += 1;
      return values;
    }
    while (true) {
      if (values.length >= limits.maxArrayLength) fail();
      values.push(parseValue(depth));
      skipWhitespace();
      if (text[offset] === "]") {
        offset += 1;
        return values;
      }
      if (text[offset] !== ",") fail();
      offset += 1;
      skipWhitespace();
    }
  }

  function parseObject(depth: number): Record<string, unknown> {
    offset += 1;
    skipWhitespace();
    const value: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    const keys = new Set<string>();
    if (text[offset] === "}") {
      offset += 1;
      return value;
    }
    while (true) {
      if (keys.size >= limits.maxObjectProperties || text[offset] !== '"') fail();
      const key = parseString();
      if (keys.has(key)) fail();
      keys.add(key);
      skipWhitespace();
      if (text[offset] !== ":") fail();
      offset += 1;
      value[key] = parseValue(depth);
      skipWhitespace();
      if (text[offset] === "}") {
        offset += 1;
        return value;
      }
      if (text[offset] !== ",") fail();
      offset += 1;
      skipWhitespace();
    }
  }

  if (text.startsWith("\ufeff")) fail();
  const result = parseValue(0);
  skipWhitespace();
  if (offset !== text.length) fail();
  return result;
}

export function requireClosedObject(
  value: unknown,
  requiredKeys: readonly string[]
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("MEDIA.OUTPUT_INVALID");
  }
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...requiredKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error("MEDIA.OUTPUT_INVALID");
  }
  return record;
}
