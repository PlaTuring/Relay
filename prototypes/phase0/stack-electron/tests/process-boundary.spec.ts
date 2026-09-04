import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const sourceRoot = path.resolve("src", "main");
const ipcSource = readFileSync(path.join(sourceRoot, "ipc.ts"), "utf8");
const childSource = readFileSync(path.join(sourceRoot, "owned-child.ts"), "utf8");
const mainSource = readFileSync(path.join(sourceRoot, "main.ts"), "utf8");

describe("process boundary source invariants", () => {
  it("requires an exact renderer URL for every IPC handler", () => {
    expect(ipcSource).toContain("event.senderFrame?.url !== expectedUrl");
    expect(ipcSource).not.toContain("startsWith(expectedUrl)");
    expect(ipcSource.match(/requireTrustedSender\(/gu)?.length).toBe(5);
  });

  it("starts the fixed child without a shell", () => {
    expect(childSource).toContain("const args = [options.childScript");
    expect(childSource).toContain("shell: false");
    expect(childSource).not.toMatch(/\bexec(?:File)?\s*\(/u);
  });

  it("keeps executeJavaScript inside the explicit self-test branch", () => {
    const selfTestBranch = mainSource.indexOf("if (selfTest) {");
    const executeJavaScript = mainSource.indexOf("window.webContents.executeJavaScript(");

    expect(selfTestBranch).toBeGreaterThan(0);
    expect(executeJavaScript).toBeGreaterThan(selfTestBranch);
    expect(mainSource.match(/executeJavaScript\(/gu)).toHaveLength(1);
    expect(mainSource.slice(0, selfTestBranch)).not.toContain("executeJavaScript(");
  });
});
