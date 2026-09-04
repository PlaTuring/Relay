import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, readFile, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { build } from "esbuild";

const appRoot = path.resolve(import.meta.dirname, "..");
const compilerAttribution = await import("../../../packages/workflow/h3-compiler/src/output-attribution.mjs");

function ids() {
  let value = 1;
  return () => (value++).toString(16).padStart(32, "0");
}

function mp4(marker = 0, extraBytes = 0) {
  const bytes = Buffer.alloc(64 + extraBytes, marker);
  bytes.writeUInt32BE(24, 0);
  bytes.write("ftyp", 4, "ascii");
  bytes.write("isom", 8, "ascii");
  bytes.writeUInt32BE(0x200, 12);
  bytes.write("isomiso2", 16, "ascii");
  return bytes;
}

function png() {
  const bytes = Buffer.alloc(40);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(320, 16);
  bytes.writeUInt32BE(180, 20);
  return bytes;
}

async function bundle(context, name, entry) {
  const root = await mkdtemp(path.join(os.tmpdir(), `relay-a40-${name}-`));
  context.after(() => rm(root, { recursive: true, force: true }));
  const output = path.join(root, `${name}.mjs`);
  await build({
    entryPoints: [path.join(appRoot, entry)],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "silent",
  });
  return import(`${pathToFileURL(output).href}?test=${Date.now()}-${Math.random()}`);
}

async function fixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), "relay a40 generated Ω "));
  context.after(() => rm(root, { recursive: true, force: true }));
  const dataRoot = path.join(root, "Relay 数据库");
  const comfyOutputRoot = path.join(root, "ComfyUI", "output");
  await mkdir(comfyOutputRoot, { recursive: true });
  return Object.freeze({ root, dataRoot, comfyOutputRoot });
}

const projectId = "project-alpha40-videos-a";
const workflowId = "workflow-alpha40-videos-a";

function probe() {
  return Promise.resolve({
    format: { duration: "5.125" },
    streams: [
      { codec_type: "video", codec_name: "h264", width: 1280, height: 720 },
      { codec_type: "audio", codec_name: "aac" },
    ],
  });
}

test("main TS and compiler MJS attribution helpers are exactly compatible", async (context) => {
  const main = await bundle(context, "attribution", "src/main/services/generated-video-output-attribution.ts");
  const input = { projectId, workflowId };
  assert.deepEqual(main.createWorkflowOutputAttribution(input), compilerAttribution.createWorkflowOutputAttribution(input));
  const mainWorkflow = { nodes: [{ type: "SaveVideo", widgets_values: ["old"], widgets_values_named: { filename_prefix: "old" } }] };
  const compilerWorkflow = structuredClone(mainWorkflow);
  assert.deepEqual(main.applyWorkflowOutputAttribution(mainWorkflow, input), compilerAttribution.applyWorkflowOutputAttribution(compilerWorkflow, input));
  assert.deepEqual(mainWorkflow, compilerWorkflow);
  assert.match(mainWorkflow.nodes[0].widgets_values[0], /^video\/Relay\/p_[a-f0-9]{16}\/w_[a-f0-9]{16}\/Relay_H3$/u);
  assert.equal(main.allocateWorkflowId(() => "00112233-4455-6677-8899-aabbccddeeff"), "workflow-00112233445566778899aabbccddeeff");
});

test("bounded auto-scan waits 1.5s, hides a growing file, then discovers stable counter files", async (context) => {
  const module = await bundle(context, "service-auto", "src/main/services/generated-video-service.ts");
  const item = await fixture(context);
  const attribution = compilerAttribution.createWorkflowOutputAttribution({ projectId, workflowId });
  const directory = path.join(item.comfyOutputRoot, ...attribution.output_prefix.split("/").slice(0, -1));
  await mkdir(directory, { recursive: true });
  const growing = path.join(directory, "Relay_H3_00001_.mp4");
  await writeFile(growing, mp4(1));
  const observed = [];
  let growDuringWait = true;
  const service = module.createGeneratedVideoService({
    dataRoot: item.dataRoot,
    createId: ids(),
    probeVideo: probe,
    wait: async (milliseconds) => {
      observed.push(milliseconds);
      if (growDuringWait) {
        growDuringWait = false;
        await appendFile(growing, Buffer.from([7]));
      }
    },
  });
  service.activateProject(projectId);
  await service.registerCompileOrigin({ projectId, workflowId, comfyOutputRoot: item.comfyOutputRoot });
  assert.deepEqual((await service.list({ projectId })).videos, [], "a file that changes between observations is not available");
  const stable = await service.list({ projectId });
  assert.equal(stable.videos.length, 1);
  assert.equal(stable.videos[0].fileName, "Relay_H3_00001_.mp4");
  assert.equal(stable.videos[0].workflowId, workflowId);
  assert.equal(stable.videos[0].technicalInspection.status, "verified");
  assert.equal(JSON.stringify(stable).includes(item.root), false, "renderer view contains no local path");
  assert.ok(observed.length >= 2);
  assert.equal(observed.every((milliseconds) => milliseconds >= 1_500), true);

  await writeFile(path.join(directory, "Relay_H3_00002_.mp4"), mp4(2));
  const multiple = await service.list({ projectId });
  assert.deepEqual(multiple.videos.map((entry) => entry.fileName).sort(), [
    "Relay_H3_00001_.mp4",
    "Relay_H3_00002_.mp4",
  ]);
  await mkdir(path.join(item.comfyOutputRoot, "video"), { recursive: true });
  await writeFile(path.join(item.comfyOutputRoot, "video", "MiniMax_H3_00003_.mp4"), mp4(3));
  const afterLegacy = await service.list({ projectId });
  assert.equal(afterLegacy.videos.length, 2, "Alpha 39 generic prefixes are never guessed");

  const indexPath = path.join(item.dataRoot, "projects", projectId, "recovery", "generated-videos.v1.json");
  const index = JSON.parse(await readFile(indexPath, "utf8"));
  assert.equal(index.schemaVersion, 1);
  assert.equal(index.projectId, projectId);
  assert.equal(index.results.length, 2);
  assert.equal(index.results.every((entry) => entry.externalPath === null), true);

  let restartWaits = 0;
  const restarted = module.createGeneratedVideoService({
    dataRoot: item.dataRoot,
    createId: ids(),
    probeVideo: probe,
    wait: async () => { restartWaits += 1; },
  });
  restarted.activateProject(projectId);
  assert.equal((await restarted.list({ projectId })).videos.length, 2, "restart uses the local recovery index and bounded rescan");
  assert.equal(restartWaits, 0, "unchanged indexed files do not incur a new stability delay");
  restarted.activateProject("project-alpha40-videos-b");
  await assert.rejects(restarted.list({ projectId }), (error) => error?.code === "NOT_CURRENT_PROJECT");
  assert.equal((await restarted.list({ projectId: "project-alpha40-videos-b" })).videos.length, 0);
});

test("automatic results are re-inspected after same-size same-mtime replacement and deleted records are pruned", async (context) => {
  const module = await bundle(context, "service-identity", "src/main/services/generated-video-service.ts");
  const item = await fixture(context);
  const attribution = compilerAttribution.createWorkflowOutputAttribution({ projectId, workflowId });
  const directory = path.join(item.comfyOutputRoot, ...attribution.output_prefix.split("/").slice(0, -1));
  await mkdir(directory, { recursive: true });
  const source = path.join(directory, "Relay_H3_00001_.mp4");
  await writeFile(source, mp4(10));
  const preservedTimestamp = new Date("2026-09-04T00:00:00.000Z");
  await utimes(source, preservedTimestamp, preservedTimestamp);
  const service = module.createGeneratedVideoService({
    dataRoot: item.dataRoot,
    createId: ids(),
    probeVideo: probe,
    wait: async () => undefined,
  });
  service.activateProject(projectId);
  await service.registerCompileOrigin({ projectId, workflowId, comfyOutputRoot: item.comfyOutputRoot });
  const first = (await service.list({ projectId })).videos[0];
  const originalStats = await stat(source);

  await writeFile(source, mp4(11));
  await utimes(source, preservedTimestamp, preservedTimestamp);
  const replacedStats = await stat(source);
  assert.equal(replacedStats.size, originalStats.size);
  assert.equal(replacedStats.mtimeMs, originalStats.mtimeMs);
  assert.notEqual(replacedStats.ctimeMs, originalStats.ctimeMs, "filesystem identity notices replacement even when mtime is restored");
  const replaced = (await service.list({ projectId })).videos[0];
  assert.equal(replaced.resultId, first.resultId);
  assert.notEqual(replaced.sha256, first.sha256);

  await rm(source);
  assert.deepEqual((await service.list({ projectId })).videos, []);
  const persisted = JSON.parse(await readFile(
    path.join(item.dataRoot, "projects", projectId, "recovery", "generated-videos.v1.json"),
    "utf8",
  ));
  assert.equal(persisted.results.length, 0, "successful scans prune disappeared automatic results");
});

test("expected namespace refuses a reparse point and never scans the target", async (context) => {
  const module = await bundle(context, "service-reparse", "src/main/services/generated-video-service.ts");
  const item = await fixture(context);
  const attribution = compilerAttribution.createWorkflowOutputAttribution({ projectId, workflowId });
  const components = attribution.output_prefix.split("/").slice(0, -1);
  const relayRoot = path.join(item.comfyOutputRoot, ...components.slice(0, 2));
  const outside = path.join(item.root, "outside");
  await Promise.all([mkdir(relayRoot, { recursive: true }), mkdir(outside, { recursive: true })]);
  await writeFile(path.join(outside, "Relay_H3_00001_.mp4"), mp4(4));
  await symlink(outside, path.join(relayRoot, components[2]), process.platform === "win32" ? "junction" : "dir");
  const service = module.createGeneratedVideoService({ dataRoot: item.dataRoot, createId: ids(), wait: async () => undefined });
  service.activateProject(projectId);
  await service.registerCompileOrigin({ projectId, workflowId, comfyOutputRoot: item.comfyOutputRoot });
  assert.deepEqual((await service.list({ projectId })).videos, []);
});

test("manual supplement supports Unicode, rejects damage, deduplicates, and exposes an honest missing-poster-service state", async (context) => {
  const module = await bundle(context, "service-manual", "src/main/services/generated-video-service.ts");
  const item = await fixture(context);
  const source = path.join(item.root, "改名视频 你好 Ω.mp4");
  const corrupt = path.join(item.root, "损坏视频.mp4");
  await Promise.all([writeFile(source, mp4(5)), writeFile(corrupt, "not a video", "utf8")]);
  const service = module.createGeneratedVideoService({ dataRoot: item.dataRoot, createId: ids(), wait: async () => undefined });
  service.activateProject(projectId);
  const added = await service.manualImportFromMainSelection({ projectId, selectedPath: source });
  assert.equal(added.status, "added");
  assert.equal(added.video.fileName, "改名视频 你好 Ω.mp4");
  assert.equal(added.video.source, "manual");
  assert.equal(added.video.workflowId, null);
  assert.equal(added.video.technicalInspection.status, "unchecked");
  assert.match(added.video.technicalInspection.message, /未检查/u);
  assert.equal(JSON.stringify(added).includes(item.root), false);
  const duplicate = await service.manualImportFromMainSelection({ projectId, selectedPath: source });
  assert.equal(duplicate.status, "duplicate");
  assert.equal(duplicate.video.resultId, added.video.resultId);
  await assert.rejects(
    service.manualImportFromMainSelection({ projectId, selectedPath: corrupt }),
    (error) => error?.code === "VIDEO_INVALID",
  );
  const poster = await service.getPoster({ projectId, resultId: added.video.resultId });
  assert.equal(poster.status, "unavailable");
  assert.match(poster.message, /封面服务/u);
  assert.equal(poster.dataUrl, null);
});

test("poster/play/reveal and explicit add-to-assets use verified paths internally without mutating the source", async (context) => {
  const module = await bundle(context, "service-actions", "src/main/services/generated-video-service.ts");
  const item = await fixture(context);
  const source = path.join(item.root, "动作视频.mp4");
  const original = mp4(6);
  await writeFile(source, original);
  const calls = [];
  const service = module.createGeneratedVideoService({
    dataRoot: item.dataRoot,
    createId: ids(),
    wait: async () => undefined,
    renderVideoPoster: async (input, output) => {
      calls.push(["poster", input]);
      await writeFile(output, png(), { flag: "wx" });
    },
    openVideo: async (input) => { calls.push(["play", input]); },
    revealVideo: async (input) => { calls.push(["reveal", input]); },
    addToProjectAssets: async ({ projectId: copiedProject, sourcePath, expectedSha256, expectedByteLength }) => {
      calls.push(["asset", sourcePath]);
      assert.equal(copiedProject, projectId);
      const target = path.join(item.dataRoot, "projects", projectId, "assets", "originals", "copied.mp4");
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, await readFile(sourcePath), { flag: "wx" });
      return {
        status: "added",
        assetId: "asset-alpha40-video-copy",
        sha256: expectedSha256,
        byteLength: expectedByteLength,
      };
    },
  });
  service.activateProject(projectId);
  const imported = await service.manualImportFromMainSelection({ projectId, selectedPath: source });
  const resultId = imported.video.resultId;
  const poster = await service.getPoster({ projectId, resultId });
  assert.equal(poster.status, "ready");
  assert.match(poster.dataUrl, /^data:image\/png;base64,/u);
  assert.deepEqual(await service.play({ projectId, resultId }), { opened: true, errorCode: null });
  assert.deepEqual(await service.reveal({ projectId, resultId }), { opened: true, errorCode: null });
  assert.deepEqual(await service.addToAssets({ projectId, resultId }), {
    status: "added",
    assetId: "asset-alpha40-video-copy",
  });
  assert.deepEqual(await readFile(source), original, "poster/open/reveal/copy hooks leave the source unchanged");
  assert.equal(calls.every((entry) => entry[1] === source), true);
});
