import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const projectRoot = resolve(import.meta.dirname, "..");
const read = (relativePath) => readFile(resolve(projectRoot, relativePath), "utf8");

test("packaged Stream A and B use fixed CJS parentPort wrappers instead of UtilityProcess stdout", async () => {
  const [adapter, runtimeWrapper, compilerWrapper, build, packageJson] = await Promise.all([
    read("src/main/services/ab-cli-adapter.ts"),
    read("src/main/services/electron-utility-wrapper.cjs"),
    read("src/main/services/electron-workflow-compiler-wrapper.cjs"),
    read("scripts/build.mjs"),
    read("package.json")
  ]);

  assert.ok(adapter.includes('stdio: ["ignore", "ignore", "ignore"]'));
  assert.ok(adapter.includes("child.postMessage({"));
  assert.ok(adapter.includes('resolve(options.resourcesPath, "runtime", "electron-utility-wrapper.cjs")'));
  assert.ok(adapter.includes('resolve(options.resourcesPath, "runtime", "electron-workflow-compiler-wrapper.cjs")'));
  assert.ok(adapter.includes("const SCAN_TIMEOUT_MS = 12_000"));
  assert.doesNotMatch(adapter, /runFixedUtilityCli|createUtilityProcessCompletionGate/u);
  for (const wrapper of [runtimeWrapper, compilerWrapper]) {
    assert.ok(wrapper.includes('const { pathToFileURL } = require("node:url")'));
    assert.ok(wrapper.includes('parentPort.once("message"'));
    assert.ok(wrapper.includes("post({ protocol: PROTOCOL, ready: true })"));
    assert.doesNotMatch(wrapper, /console\.|process\.(?:stdout|stderr)\.write|full[_-]?path/iu);
  }
  assert.ok(runtimeWrapper.includes("await import(pathToFileURL(runtimeEntry).href)"));
  assert.ok(runtimeWrapper.includes('"ui-locations"'));
  assert.ok(compilerWrapper.includes("await import(pathToFileURL(compilerEntry).href)"));
  assert.ok(compilerWrapper.includes('request.command !== "compile"'));
  assert.ok(compilerWrapper.includes('["compile", "--project", projectPath, "--output-dir", outputDirectory]'));
  assert.ok(compilerWrapper.includes("error_reason"));
  assert.ok(adapter.includes("REF2VA_STYLE_OPENING"));
  assert.ok(adapter.includes("exitDrainTimer = setTimeout"));
  assert.ok(build.includes('"electron-utility-wrapper.cjs"'));
  assert.ok(build.includes('"electron-workflow-compiler-wrapper.cjs"'));
  assert.ok(packageJson.includes('"to": "runtime/electron-utility-wrapper.cjs"'));
  assert.ok(packageJson.includes('"to": "runtime/electron-workflow-compiler-wrapper.cjs"'));
  assert.ok(packageJson.includes('"to": "runtime/packages/local-runtime/src"'));
  assert.ok(packageJson.includes('"to": "runtime/packages/workflow/h3-compiler/src"'));
  assert.ok(packageJson.includes('"to": "runtime/packages/workflow/static-graph-lint/src"'));
  assert.doesNotMatch(packageJson, /"to": "runtime\/(?:schemas|packages)"/u);
});

test("scan performs bounded UI location discovery before metadata attach inspection", async () => {
  const adapter = await read("src/main/services/ab-cli-adapter.ts");
  const scanStart = adapter.indexOf("async scanInstallation(request: ScanInstallationRequest)");
  const locations = adapter.indexOf('"ui-locations"', scanStart);
  const attach = adapter.indexOf('"attach-plan"', scanStart);

  assert.ok(scanStart >= 0);
  assert.ok(locations > scanStart);
  assert.ok(attach > locations);
  assert.ok(adapter.includes("user_model_roots: Object.freeze([locations.modelRoot])"));
  assert.ok(adapter.includes("locations,\n      system:"));
  assert.ok(adapter.includes('state: locations.comfyUiRoot === null ? "needs_download" : "found_unverified"'));
  assert.ok(adapter.includes('resolve(managedRoot, ".minimax-h3", "extra_model_paths.yaml")'));
});
