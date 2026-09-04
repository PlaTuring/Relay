import { createHash } from "node:crypto";

function normalize(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Non-finite number is not JSON.");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value).sort()) result[key] = normalize(value[key]);
    return result;
  }
  throw new TypeError("Unsupported JSON value.");
}

export function canonicalJson(value) {
  return JSON.stringify(normalize(value));
}

export function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256Canonical(value) {
  return sha256Bytes(Buffer.from(canonicalJson(value), "utf8"));
}

export function workflowBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}
