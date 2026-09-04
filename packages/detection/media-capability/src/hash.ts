import { createHash } from "node:crypto";

import type { Sha256 } from "./types.ts";

export function sha256Bytes(value: Uint8Array): Sha256 {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function sha256Text(value: string): Sha256 {
  return sha256Bytes(Buffer.from(value, "utf8"));
}

export function isSha256(value: unknown): value is Sha256 {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}
