import { createHash } from "node:crypto";
import path from "node:path";

import { runtimeFail } from "./errors.mjs";

export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

export function assertClosedObject(value, allowedFields, stage, ruleId) {
  if (!isPlainObject(value)) runtimeFail("LOCAL_RUNTIME.INVALID_REQUEST", stage, `${ruleId}.object`);
  for (const key of Object.keys(value)) {
    if (!allowedFields.has(key)) runtimeFail("LOCAL_RUNTIME.UNKNOWN_FIELD", stage, `${ruleId}.closed`);
  }
}

export function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

export function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

export function sha256Json(value) {
  return `sha256:${createHash("sha256").update(stableJson(value), "utf8").digest("hex")}`;
}

export function sha256Text(value) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

export function compareOrdinal(left, right) {
  return Buffer.compare(Buffer.from(String(left), "utf8"), Buffer.from(String(right), "utf8"));
}

export function normalizeWindowsAbsolutePath(value, stage = "request") {
  if (typeof value !== "string" || value.length < 3 || value.length > 32_767) {
    runtimeFail("LOCAL_RUNTIME.INVALID_PATH", stage, "local_runtime.path.windows_absolute");
  }
  if (/^(?:\\\\|\\[?.]\\)/u.test(value) || value.includes("\0") || /(^|[\\/])\.\.?(?:[\\/]|$)/u.test(value)) {
    runtimeFail("LOCAL_RUNTIME.INVALID_PATH", stage, "local_runtime.path.no_device_unc_or_traversal");
  }
  const normalized = path.win32.normalize(value);
  if (!/^[A-Za-z]:\\[^\0:]*$/u.test(normalized) || normalized.startsWith("\\\\")) {
    runtimeFail("LOCAL_RUNTIME.INVALID_PATH", stage, "local_runtime.path.drive_rooted_absolute");
  }
  const reserved = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;
  for (const segment of normalized.slice(3).split("\\")) {
    if (!segment || /[. ]$/u.test(segment) || reserved.test(segment)) {
      runtimeFail("LOCAL_RUNTIME.INVALID_PATH", stage, "local_runtime.path.safe_segments");
    }
  }
  const root = path.win32.parse(normalized).root;
  if (normalized.toLowerCase() === root.toLowerCase()) {
    runtimeFail("LOCAL_RUNTIME.INVALID_PATH", stage, "local_runtime.path.not_volume_root");
  }
  return normalized;
}

export function driveLetterOf(value) {
  return path.win32.parse(normalizeWindowsAbsolutePath(value)).root.slice(0, 2).toUpperCase();
}

export function redactWindowsPath(value) {
  const normalized = normalizeWindowsAbsolutePath(value, "redaction");
  if (/^[Dd]:\\MiniMaxH3$/u.test(normalized)) return "D:\\MiniMaxH3";
  const parsed = path.win32.parse(normalized);
  return `${parsed.root}…\\<redacted>`;
}

export function uniqueWindowsPaths(values) {
  const result = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = normalizeWindowsAbsolutePath(value);
    const key = normalized.toUpperCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(normalized);
    }
  }
  return result;
}

export function sumSafeIntegers(values, stage = "plan") {
  let sum = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(sum + value)) {
      runtimeFail("LOCAL_RUNTIME.INTEGER_OVERFLOW", stage, "local_runtime.integer.safe_sum");
    }
    sum += value;
  }
  return sum;
}
