import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const rendererRoot = path.resolve("src", "renderer");
const html = readFileSync(path.join(rendererRoot, "index.html"), "utf8");
const renderer = readFileSync(path.join(rendererRoot, "renderer.ts"), "utf8");
const packageJson = JSON.parse(readFileSync(path.resolve("package.json"), "utf8"));

describe("bounded renderer surface", () => {
  it("has a restrictive CSP and no embedded remote content", () => {
    expect(html).toContain("connect-src 'none'");
    expect(html).not.toContain("unsafe-eval");
    expect(html).not.toContain("unsafe-inline");
    expect(html).not.toMatch(/https?:\/\//u);
  });

  it("uses semantic controls, keyboard focus CSS and live status regions", () => {
    expect(html).toContain("<main>");
    expect(html).toContain('id="choose-root"');
    expect(html).toContain('id="run-child-probe"');
    expect(html.match(/aria-live="polite"/gu)?.length).toBeGreaterThanOrEqual(4);
    expect(readFileSync(path.join(rendererRoot, "styles.css"), "utf8")).toContain(
      ":focus-visible"
    );
  });

  it("never uses innerHTML or a generic IPC/remote API", () => {
    expect(renderer).not.toContain("innerHTML");
    expect(renderer).not.toContain("fetch(");
    expect(renderer).not.toContain("/prompt");
  });

  it("contains no updater dependency or publish channel", () => {
    expect(packageJson.devDependencies["electron-updater"]).toBeUndefined();
    expect(packageJson.dependencies).toBeUndefined();
    expect(packageJson.build.publish).toBeUndefined();
  });
});
