import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const projectRoot = resolve(import.meta.dirname, "..");
const read = (relativePath) => readFile(resolve(projectRoot, relativePath), "utf8");

test("assisted Setup offers a real optional Relay launch on its finish page", async () => {
  const [packageJson, installerInclude, packageScript] = await Promise.all([
    read("package.json").then(JSON.parse),
    read("build/installer.nsh"),
    read("scripts/package.mjs"),
  ]);

  assert.equal(packageJson.build.nsis.oneClick, false, "the checkbox belongs to the assisted finish page");
  assert.equal(packageJson.build.nsis.runAfterFinish, true, "electron-builder must retain its finish-page launch checkbox");
  assert.equal(packageJson.build.publish, null, "building an installer must not publish it");
  assert.equal(packageJson.scripts.postinstall, undefined, "dependency installation must not launch Relay");
  assert.doesNotMatch(installerInclude, /customFinishPage|ExecShell|ExecWait|StartApp/u,
    "the custom include must not bypass the builder-owned checkbox or start Relay unconditionally");
  assert.match(packageScript, /--publish", "never/u);
  assert.match(packageScript, /interactive_launch=0/u,
    "the build and isolated package probe must not opt into the installed user's finish-page launch");
});

test("finish-page launch remains an application start, never a ComfyUI generation action", async () => {
  const [packageJson, packageScript] = await Promise.all([
    read("package.json").then(JSON.parse),
    read("scripts/package.mjs"),
  ]);

  assert.equal(packageJson.build.nsis.runAfterFinish, true);
  assert.doesNotMatch(packageScript, /\/prompt|queue_prompt|submitPrompt|clickRun/u);
  assert.match(packageScript, /generated_media:\s*false/u);
  assert.match(packageScript, /submitted_prompt:\s*false/u);
  assert.match(packageScript, /submitted_queue:\s*false/u);
});
