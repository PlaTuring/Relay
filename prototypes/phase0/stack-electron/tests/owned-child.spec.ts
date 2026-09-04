import path from "node:path";

import { describe, expect, it } from "vitest";

import { runOwnedChildProbe } from "../src/main/owned-child";

describe("owned child lifecycle", () => {
  it("uses argument arrays, preserves Unicode/space values and terminates repeatedly", async () => {
    const childScript = path.resolve("dist", "src", "child", "harmless-child.js");

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const label = `路径 含空格 Ω #${attempt}`;
      const result = await runOwnedChildProbe({
        executable: process.execPath,
        childScript,
        label
      });

      expect(result.label).toBe(label);
      expect(result.readyObserved).toBe(true);
      expect(result.childPid).toBeGreaterThan(0);
      expect(result.terminated).toBe(true);
      expect(result.exitCode !== null || result.exitSignal !== null).toBe(true);
    }
  });
});
