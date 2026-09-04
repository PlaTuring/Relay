#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

function run(label, args, { capture = false } = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: MAX_OUTPUT_BYTES,
    shell: false,
    windowsHide: true,
    stdio: capture ? "pipe" : "inherit"
  });
  if (result.status !== 0) {
    if (capture && result.stderr) process.stderr.write(result.stderr);
    throw new Error(`PRODUCT_SMOKE.${label}_FAILED`);
  }
  process.stdout.write(`PRODUCT_SMOKE PASS ${label}\n`);
  return capture ? result.stdout.trim() : "";
}

function parseSingleJson(label, output) {
  const lines = output.split(/\r?\n/u).filter(Boolean);
  assert.equal(lines.length, 1, `${label} must emit one JSON line`);
  return JSON.parse(lines[0]);
}

run("local_runtime_tests", [
  "--test",
  "packages/local-runtime/test/local-runtime.test.mjs",
  "packages/local-runtime/test/installer.test.mjs"
]);
const localRuntime = parseSingleJson(
  "local-runtime smoke",
  run("local_runtime_cli", ["packages/local-runtime/bin/local-runtime.mjs", "smoke"], { capture: true })
);
assert.equal(localRuntime.models.expected_asset_count, 5);
assert.equal(localRuntime.models.verified_asset_count, 5);
assert.equal(localRuntime.models.totals.reuse_download_bytes, 0);
assert.equal(localRuntime.attach_plan.network_called, false);
assert.equal(localRuntime.attach_plan.model_executed, false);
assert.equal(localRuntime.attach_plan.prompt_submitted, false);

run("h3_compiler_tests", ["--test", "packages/workflow/h3-compiler/test/compiler.test.mjs"]);
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "minimax-h3-product-smoke-"));
try {
  const canonicalTemporaryRoot = await realpath(temporaryRoot);
  const projectPath = path.join(canonicalTemporaryRoot, "project.json");
  const exportDirectory = path.join(canonicalTemporaryRoot, "export");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(exportDirectory));
  await writeFile(projectPath, `${JSON.stringify({
    schema_version: "1.0.0",
    prompt: "Technical local handoff smoke test",
    mode: "t2v",
    duration: 5,
    canvas: "16:9",
    resolution_megapixels: 0.98
  })}\n`, { encoding: "utf8", flag: "wx" });
  const compilation = parseSingleJson(
    "compiler smoke",
    run("h3_compiler_cli", [
      "packages/workflow/h3-compiler/bin/h3-compile.mjs",
      "compile",
      "--project",
      projectPath,
      "--output-dir",
      exportDirectory
    ], { capture: true })
  );
  assert.equal(compilation.ok, true);
  assert.equal(compilation.handoff.capability, "EXPORT_ONLY");
  assert.equal(compilation.handoff.automatic_execution, false);
  assert.equal(compilation.handoff.automatic_submission, false);
  assert.equal(compilation.handoff.auto_run, false);
  assert.ok(Array.isArray(compilation.exported) && compilation.exported.length === 1);
  const workflowPath = path.resolve(compilation.exported[0].workflow_path);
  assert.equal(path.dirname(workflowPath), exportDirectory);
  const workflowText = await readFile(workflowPath, "utf8");
  JSON.parse(workflowText);
  assert.equal(workflowText.includes('"/prompt"'), false);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

run("control_plane_tests", ["apps/control-plane/scripts/test.mjs"]);
run("control_plane_ui", ["apps/control-plane/scripts/smoke.mjs"]);
process.stdout.write("PRODUCT_SMOKE complete=1 media_generated=0 prompt_submitted=0\n");
