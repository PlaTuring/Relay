import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";

const projectRoot = resolve(import.meta.dirname, "..");

const requiredRuntimeMappings = new Map([
  ["../../packages/local-runtime/bin", "runtime/packages/local-runtime/bin"],
  ["../../packages/local-runtime/src", "runtime/packages/local-runtime/src"],
  ["../../packages/installer/catalog-loader/src", "runtime/packages/installer/catalog-loader/src"],
  ["../../packages/installer/download-sidecar/src", "runtime/packages/installer/download-sidecar/src"],
  ["../../packages/detection/media-capability/src", "runtime/packages/detection/media-capability/src"],
  ["../../schemas/component-manifest/1.0.0.schema.json", "runtime/schemas/component-manifest/1.0.0.schema.json"]
]);

function execute(entry, arguments_, input) {
  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;
  delete environment.NODE_OPTIONS;
  delete environment.NODE_PATH;
  const result = spawnSync(process.execPath, [entry, ...arguments_], {
    encoding: "utf8",
    env: environment,
    input,
    maxBuffer: 2 * 1024 * 1024,
    shell: false,
    timeout: 20_000,
    windowsHide: true
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const lines = result.stdout.trim().split(/\r?\n/u).filter(Boolean);
  assert.equal(lines.length, 1);
  return JSON.parse(lines[0]);
}

test("declared extraResources form an executable packaged local-runtime dependency closure", async (context) => {
  const packageMetadata = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8"));
  const declaredMappings = new Map(
    packageMetadata.build.extraResources.map(({ from, to }) => [from, to])
  );
  for (const [source, destination] of requiredRuntimeMappings) {
    assert.equal(declaredMappings.get(source), destination, source);
  }

  const stagingRoot = await mkdtemp(resolve(tmpdir(), "relay-packaged-runtime-closure-"));
  context.after(() => rm(stagingRoot, { recursive: true, force: true }));
  for (const [source, destination] of requiredRuntimeMappings) {
    const sourcePath = resolve(projectRoot, source);
    const destinationPath = resolve(stagingRoot, destination);
    await mkdir(dirname(destinationPath), { recursive: true });
    await cp(sourcePath, destinationPath, { recursive: true, errorOnExist: true, force: false });
  }

  const entry = resolve(stagingRoot, "runtime", "packages", "local-runtime", "bin", "local-runtime.mjs");
  const smoke = execute(entry, ["smoke"]);
  assert.equal(smoke.evidence_mode, "synthetic_smoke_no_host_io");
  assert.equal(smoke.attach_plan.model_executed, false);
  assert.equal(smoke.attach_plan.prompt_submitted, false);

  const sidecar = execute(
    entry,
    ["sidecar", "--request", "-"],
    `${JSON.stringify({ operation: "authority" })}\n`
  );
  assert.equal(sidecar.network_authority, "none");
  assert.equal(sidecar.execution_authority, "none");
  assert.equal(sidecar.queue_authority, "none");

  const media = execute(
    entry,
    ["media-probe", "--request", "-"],
    `${JSON.stringify({ ambientFfmpegPresent: false })}\n`
  );
  assert.equal(media.schemaVersion, 1);
  assert.equal(media.ambientFfmpeg.status, "unavailable");
});

test("package gate executes the transitive runtime before publishing checksums", async () => {
  const source = await readFile(resolve(projectRoot, "scripts", "package.mjs"), "utf8");
  const executionGate = source.indexOf("PACKAGE_LOCAL_RUNTIME_EXECUTION probes=3 status=passed");
  const checksumGate = source.indexOf("PACKAGE_CHECKSUMS count=");

  assert.ok(executionGate >= 0);
  assert.ok(checksumGate > executionGate);
  assert.match(source, /\["sidecar", "--request", "-"\]/u);
  assert.match(source, /\["media-probe", "--request", "-"\]/u);
  assert.match(source, /packaged-local-runtime-execution\.json/u);
  assert.match(source, /catalog_loader_and_schema: "loaded"/u);
  assert.doesNotMatch(source, /\/prompt|queue_prompt/u);
});
