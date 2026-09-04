import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const applicationRoot = path.resolve(import.meta.dirname, "..");
const read = (relativePath) => readFile(path.join(applicationRoot, relativePath), "utf8");

test("missing ComfyUI or H3 no longer redirects editing views to installation", async () => {
  const renderer = await read("src/renderer/index.ts");
  const showView = renderer.match(/function showView\([\s\S]*?(?=\nfunction formatGiB)/u)?.[0] ?? "";

  assert.match(showView, /needsProject/u);
  assert.doesNotMatch(showView, /needsPreparedEnvironment|!installationComplete[\s\S]*?"install"/u);
  assert.match(showView, /activeRelayProject === null[\s\S]*?"home"/u);
});

test("environment availability controls compile readiness without hiding the application shell", async () => {
  const [html, renderer, css] = await Promise.all([
    read("src/renderer/index.html"),
    read("src/renderer/index.ts"),
    read("src/renderer/styles.css")
  ]);
  const availability = renderer.match(
    /function setProjectAvailability\([\s\S]*?(?=\nfunction ref2vaIsReady)/u
  )?.[0] ?? "";

  assert.match(availability, /projectGuard\.hidden = available/u);
  assert.match(availability, /directorGuard\.hidden = available/u);
  assert.match(availability, /mainNavigation\.hidden = false/u);
  assert.match(availability, /componentSettingsButton\.hidden = false/u);
  assert.doesNotMatch(availability, /directorConsole\.classList\.toggle\("is-locked"/u);
  assert.doesNotMatch(css, /data-setup-complete="false"[^\n]*\.tool-sidebar[^\n]*display:\s*none/u);
  assert.match(html, /本机生成环境尚未准备[\s\S]*?仍可编辑/u);
});

test("quick create and professional director share a real install action at compile time", async () => {
  const [html, renderer] = await Promise.all([
    read("src/renderer/index.html"),
    read("src/renderer/index.ts")
  ]);

  assert.match(html, /id="environment-required-dialog"/u);
  assert.match(html, /id="environment-required-install"[\s\S]*?>打开安装与组件</u);
  assert.match(html, /id="environment-required-cancel"[\s\S]*?>继续编辑</u);
  assert.match(renderer, /function showEnvironmentRequiredDialog/u);
  assert.match(renderer, /environmentRequiredInstall\.addEventListener\("click"[\s\S]*?showView\("install"\)/u);
  assert.match(renderer, /directorCompileButton\.addEventListener\("click"[\s\S]*?if \(!installationComplete\)[\s\S]*?showEnvironmentRequiredDialog\(\)/u);
  assert.match(renderer, /projectForm\.addEventListener\("submit"[\s\S]*?if \(!installationComplete\)[\s\S]*?showEnvironmentRequiredDialog\(\)/u);
});

test("the main process remains the final fail-closed workflow gate", async () => {
  const service = await read("src/main/services/index.ts");
  const compile = service.match(
    /async compileAndOpenWorkflow\([\s\S]*?(?=\n\s*(?:async )?[A-Za-z].*\{)/u
  )?.[0] ?? service;
  assert.match(compile, /INSTALLATION_NOT_READY/u);
  assert.match(compile, /completedInstallationId|verifiedComfyRoot/u);
  assert.doesNotMatch(compile, /\/prompt/u);
});

test("first run finishes environment discovery at project center instead of trapping the user", async () => {
  const renderer = await read("src/renderer/index.ts");
  assert.match(renderer, /showView\("home"\);\s*await runScan\(true\);/u);
});
