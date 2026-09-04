import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const projectRoot = path.resolve(import.meta.dirname, "..");

async function loadThemeModule(context) {
  const buildRoot = await mkdtemp(path.join(os.tmpdir(), "relay-theme-preference-build-"));
  context.after(() => rm(buildRoot, { recursive: true, force: true }));
  const outfile = path.join(buildRoot, "ui-theme-preferences.mjs");
  await build({
    entryPoints: [path.join(projectRoot, "src", "main", "services", "ui-theme-preferences.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "silent",
  });
  return import(`${new URL(`file:///${outfile.replaceAll("\\", "/")}`).href}?test=${Date.now()}`);
}

test("light and dark theme choices atomically overwrite and survive restart", async (context) => {
  const module = await loadThemeModule(context);
  const userData = await mkdtemp(path.join(os.tmpdir(), "relay-theme-userdata-"));
  context.after(() => rm(userData, { recursive: true, force: true }));

  assert.equal(await module.loadUiThemePreference(userData, "light"), "light");
  await module.saveUiThemePreference(userData, "dark");
  assert.equal(await module.loadUiThemePreference(userData, "light"), "dark");
  await module.saveUiThemePreference(userData, "light");
  assert.equal(await module.loadUiThemePreference(userData, "dark"), "light");

  const stored = JSON.parse(await readFile(module.uiThemePreferencePath(userData), "utf8"));
  assert.deepEqual(stored, { version: 1, theme: "light" });
});

test("malformed, oversized, or unknown theme records fail closed to the supplied system theme", async (context) => {
  const module = await loadThemeModule(context);
  const userData = await mkdtemp(path.join(os.tmpdir(), "relay-theme-invalid-"));
  context.after(() => rm(userData, { recursive: true, force: true }));
  const destination = module.uiThemePreferencePath(userData);

  await writeFile(destination, "{not json", "utf8");
  assert.equal(await module.loadUiThemePreference(userData, "dark"), "dark");
  await writeFile(destination, JSON.stringify({ version: 1, theme: "system" }), "utf8");
  assert.equal(await module.loadUiThemePreference(userData, "light"), "light");
  await writeFile(destination, JSON.stringify({ version: 1, theme: "dark", extra: true }), "utf8");
  assert.equal(await module.loadUiThemePreference(userData, "light"), "light");
  await writeFile(destination, "x".repeat(513), "utf8");
  assert.equal(await module.loadUiThemePreference(userData, "dark"), "dark");
});
