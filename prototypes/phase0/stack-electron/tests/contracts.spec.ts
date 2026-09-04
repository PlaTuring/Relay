import { describe, expect, it } from "vitest";

import {
  IPC_CHANNELS,
  parseManagedRootCandidate
} from "../src/shared/contracts";

describe("strict IPC contract", () => {
  it("contains only the four bounded request-response channels", () => {
    expect(Object.values(IPC_CHANNELS)).toEqual([
      "security:get-summary",
      "managed-root:choose",
      "managed-root:inspect",
      "owned-child:run-probe"
    ]);
  });

  it("rejects non-string, empty, NUL and oversized managed-root requests", () => {
    expect(() => parseManagedRootCandidate({})).toThrow();
    expect(() => parseManagedRootCandidate("")).toThrow();
    expect(() => parseManagedRootCandidate("D:\\bad\0path")).toThrow();
    expect(() => parseManagedRootCandidate("x".repeat(32_768))).toThrow();
  });
});
