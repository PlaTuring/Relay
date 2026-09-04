import { describe, expect, it } from "vitest";

import {
  inspectWindowsManagedRoot,
  suggestedManagedRoot
} from "../src/main/path-policy";

describe("Windows managed-root path policy", () => {
  it("preserves a local path containing spaces and Unicode", () => {
    const result = inspectWindowsManagedRoot("D:\\MiniMax H3\\模型 Ω", "C:");

    expect(result.displayPath).toBe("D:\\MiniMax H3\\模型 Ω");
    expect(result.drive).toBe("D:");
    expect(result.containsSpaces).toBe(true);
    expect(result.containsUnicode).toBe(true);
    expect(result.isSystemDrive).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  it("warns but does not silently rewrite an explicitly selected C path", () => {
    const result = inspectWindowsManagedRoot("C:\\MiniMaxH3", "C:");

    expect(result.displayPath).toBe("C:\\MiniMaxH3");
    expect(result.isSystemDrive).toBe(true);
    expect(result.warnings.join(" ")).toContain("must not silently default");
  });

  it.each(["MiniMaxH3", "\\\\server\\share", "\\\\?\\D:\\MiniMaxH3"])(
    "rejects non-local or non-absolute candidate %s",
    (candidate) => {
      expect(() => inspectWindowsManagedRoot(candidate)).toThrow();
    }
  );

  it("suggests D only when the volume is present and never falls back to C", () => {
    expect(suggestedManagedRoot((candidate) => candidate === "D:\\")).toBe(
      "D:\\MiniMaxH3"
    );
    expect(suggestedManagedRoot(() => false)).toBeNull();
  });
});
