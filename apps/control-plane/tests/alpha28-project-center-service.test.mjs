import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const controlPlaneRoot = path.resolve(import.meta.dirname, "..");

async function loadProjectCenter(context) {
  const buildRoot = await mkdtemp(path.join(os.tmpdir(), "relay-a28-project-center-module-"));
  context.after(() => rm(buildRoot, { recursive: true, force: true }));
  const output = path.join(buildRoot, "project-center.mjs");
  await build({
    entryPoints: [path.join(controlPlaneRoot, "src", "main", "services", "project-center.ts")],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "silent"
  });
  return import(`${new URL(`file:///${output.replaceAll("\\", "/")}`).href}?test=${Date.now()}`);
}

function png(width, height, marker = 0) {
  const bytes = Buffer.alloc(34);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes[24] = 8;
  bytes[25] = 6;
  bytes[33] = marker;
  return bytes;
}

function idFactory(start = 1) {
  let value = start;
  return () => (value++).toString(16).padStart(32, "0");
}

function clock() {
  let tick = 0;
  return () => new Date(Date.UTC(2026, 7, 30, 8, 0, tick++));
}

test("ProjectCenter closes project CRUD, private asset mappings, restart recovery, and renderer-safe results", async (context) => {
  const { createProjectCenterService } = await loadProjectCenter(context);
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "relay a28 center 用户 Ω "));
  context.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const dataRoot = path.join(fixtureRoot, "Relay 数据");
  const inputRoot = path.join(fixtureRoot, "用户素材");
  await mkdir(inputRoot, { recursive: true });
  const firstFrame = path.join(inputRoot, "首帧 图.png");
  const external = path.join(inputRoot, "外部参考.png");
  const relinked = path.join(inputRoot, "重新定位.png");
  const invalid = path.join(inputRoot, "伪装.png");
  await Promise.all([
    writeFile(firstFrame, png(1344, 768, 1)),
    writeFile(external, png(768, 1344, 2)),
    writeFile(relinked, png(768, 1344, 2)),
    writeFile(invalid, "not-an-image")
  ]);
  const revealed = [];
  const ids = idFactory();
  const now = clock();
  const center = createProjectCenterService({
    dataRoot,
    createId: ids,
    now,
    revealPath: async (privatePath) => { revealed.push(privatePath); }
  });

  const emptyLibrary = await center.initialize();
  assert.match(emptyLibrary.libraryToken, /^[0-9a-f]{64}$/u);
  assert.equal(emptyLibrary.projectCount, 0);
  assert.equal(emptyLibrary.recentProjectCount, 0);
  const created = await center.createProject({ name: "雨夜 项目 🙂 01" });
  assert.match(created.projectId, /^project-/u);
  assert.equal((await center.listProjects()).length, 1);
  assert.equal((await center.listRecentProjects())[0].projectId, created.projectId);

  const saved = await center.saveProject({
    projectId: created.projectId,
    project: { ...created, name: "雨夜项目已保存" },
    expectedUpdatedAt: created.updatedAt
  });
  assert.equal(saved.name, "雨夜项目已保存");
  await assert.rejects(
    center.saveProject({ projectId: created.projectId, project: saved, expectedUpdatedAt: created.updatedAt }),
    /另一操作|版本|变化/u
  );

  const machinePath = path.join(dataRoot, "config", "machine.json");
  await writeFile(machinePath, `${JSON.stringify({ gpuEvidence: { vramGb: 16 } }, null, 2)}\n`);
  const copied = await center.importAssets(created.projectId, { paths: [firstFrame, invalid] });
  assert.deepEqual(copied.results.map((entry) => entry.status), ["imported", "rejected"]);
  assert.equal(copied.importedCount, 1);
  assert.equal(copied.rejectedCount, 1);
  assert.equal("canonicalPath" in copied.results[0].preflight, false);
  assert.equal(JSON.stringify(copied).includes(firstFrame), false);
  assert.equal(JSON.stringify(copied).includes(fixtureRoot), false);

  const referenced = await center.importAssets(created.projectId, { paths: [external], mode: "reference" });
  assert.equal(referenced.results[0].status, "imported");
  const externalAsset = referenced.results[0].asset;
  const machine = JSON.parse(await readFile(machinePath, "utf8"));
  assert.deepEqual(machine.gpuEvidence, { vramGb: 16 }, "private mapping writes preserve unrelated machine evidence");
  assert.equal(machine.relayPrivateReferences.projects[created.projectId][externalAsset.externalReferenceId].absolutePath, external);
  assert.equal(JSON.stringify(await center.loadProject(created.projectId)).includes(external), false);

  const restartReveal = [];
  const restarted = createProjectCenterService({
    dataRoot,
    createId: ids,
    now,
    revealPath: (privatePath) => { restartReveal.push(privatePath); }
  });
  const restartState = await restarted.initialize();
  assert.equal(restartState.projectCount, 1);
  const restartedAssets = await restarted.listAssets(created.projectId);
  assert.equal(restartedAssets.length, 2);
  assert.equal(JSON.stringify(restartedAssets).includes(external), false);
  assert.equal((await restarted.refreshAssets(created.projectId)).find((entry) => entry.asset.assetId === externalAsset.assetId).asset.availability, "available");

  await rm(external);
  assert.equal((await restarted.refreshAssets(created.projectId)).find((entry) => entry.asset.assetId === externalAsset.assetId).asset.availability, "missing");
  const relink = await restarted.relinkAsset(created.projectId, externalAsset.assetId, relinked);
  assert.equal(relink.status, "relinked");
  assert.equal("canonicalPath" in relink.preflight, false);
  assert.equal(JSON.stringify(relink).includes(relinked), false);
  const reveal = await restarted.revealAsset(created.projectId, externalAsset.assetId);
  assert.equal(reveal.revealed, true);
  assert.match(reveal.operationToken, /^reveal-/u);
  assert.deepEqual(restartReveal, [relinked]);
  assert.equal(JSON.stringify(reveal).includes(relinked), false);
  const renamed = await restarted.updateAsset(created.projectId, externalAsset.assetId, {
    displayName: "主角参考素材",
    tags: ["主角", "连续性", "主角"],
    notes: "仅在当前项目使用"
  });
  assert.deepEqual(renamed.tags, ["主角", "连续性"]);
  assert.equal((await restarted.listAssets(created.projectId, { query: "当前项目", tags: ["主角"] }))[0].asset.displayName, "主角参考素材");

  const binding = await restarted.bindAsset(created.projectId, {
    targetKind: "project",
    targetId: created.projectId,
    assetId: externalAsset.assetId,
    purpose: "subject_reference"
  });
  assert.equal((await restarted.removeAsset(created.projectId, externalAsset.assetId)).status, "in_use");
  assert.equal(await restarted.unbindAsset(created.projectId, binding.bindingId), true);

  const cloned = await restarted.cloneProject(created.projectId, { name: "带外部引用的副本" });
  const cloneAssets = await restarted.refreshAssets(cloned.projectId);
  assert.equal(cloneAssets.find((entry) => entry.asset.assetId === externalAsset.assetId).asset.availability, "available", "clone persists a project-scoped copy of private resolvers");
  assert.equal((await restarted.removeAsset(created.projectId, externalAsset.assetId)).status, "removed");
  const machineAfterRemoval = JSON.parse(await readFile(machinePath, "utf8"));
  assert.equal(
    machineAfterRemoval.relayPrivateReferences.projects[created.projectId][externalAsset.externalReferenceId].absolutePath,
    relinked,
    "recoverable deletion retains the project-private resolver until explicit restore"
  );
  assert.equal(machineAfterRemoval.relayPrivateReferences.projects[cloned.projectId][externalAsset.externalReferenceId].absolutePath, relinked);
  assert.deepEqual(await restarted.listDeletedAssets(created.projectId), [{
    assetId: externalAsset.assetId,
    displayName: "主角参考素材",
    mediaType: "image",
    deletedAt: "2026-08-30T08:00:26.000Z"
  }]);
  assert.equal((await restarted.restoreAsset(created.projectId, externalAsset.assetId)).status, "restored");
  assert.equal(await restarted.resolveUsableAssetPath(created.projectId, externalAsset.assetId), relinked);
  assert.deepEqual(await restarted.listDeletedAssets(created.projectId), []);
  assert.equal((await restarted.refreshAssets(cloned.projectId)).find((entry) => entry.asset.assetId === externalAsset.assetId).asset.availability, "available");
  assert.equal((await restarted.archiveProject(cloned.projectId)).status, "archived");
  assert.equal((await restarted.listProjects()).some((entry) => entry.projectId === cloned.projectId), false);
  assert.equal((await restarted.listProjects({ includeArchived: true })).length, 2);
  assert.deepEqual(revealed, []);
});

test("ProjectCenter exports, verifies, and imports .relayproj without returning private paths", async (context) => {
  const { createProjectCenterService } = await loadProjectCenter(context);
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "relay-a28-center-bundle-"));
  context.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const dataRoot = path.join(fixtureRoot, "data");
  const sourceRoot = path.join(fixtureRoot, "source");
  const exportRoot = path.join(fixtureRoot, "exports");
  await Promise.all([mkdir(sourceRoot, { recursive: true }), mkdir(exportRoot, { recursive: true })]);
  const source = path.join(sourceRoot, "项目首帧.png");
  await writeFile(source, png(608, 352, 7));
  const ids = idFactory(100);
  const center = createProjectCenterService({ dataRoot, createId: ids, now: clock() });
  await center.initialize();
  const project = await center.createProject({ name: "可迁移项目" });
  await center.importAssets(project.projectId, { paths: [source] });

  const bundlePath = path.join(exportRoot, "项目副本.relayproj");
  const exported = await center.exportProjectBundle({ projectId: project.projectId, destinationPath: bundlePath });
  assert.equal(exported.fileName, "项目副本.relayproj");
  assert.ok(exported.byteLength > 0);
  assert.match(exported.sha256, /^[0-9a-f]{64}$/u);
  assert.match(exported.operationToken, /^export-/u);
  assert.equal(JSON.stringify(exported).includes(bundlePath), false);
  assert.equal(JSON.stringify(exported).includes(fixtureRoot), false);

  const inspected = await center.inspectProjectBundle(bundlePath);
  assert.equal(inspected.fileName, "项目副本.relayproj");
  assert.equal(inspected.project.projectId, project.projectId);
  assert.equal(inspected.filesVerified, inspected.manifest.files.length);
  assert.equal(JSON.stringify(inspected).includes(bundlePath), false);
  await assert.rejects(center.inspectProjectBundle("relative.relayproj"), /绝对路径/u);

  const imported = await center.importProjectBundle({ bundlePath, onProjectIdConflict: "copy" });
  assert.equal(imported.copiedDueToConflict, true);
  assert.notEqual(imported.project.projectId, project.projectId);
  assert.match(imported.operationToken, /^import-/u);
  assert.equal(JSON.stringify(imported).includes(bundlePath), false);
  assert.equal(JSON.stringify(imported).includes(fixtureRoot), false);
  assert.equal((await center.listProjects()).length, 2);
  assert.equal((await center.listRecentProjects())[0].projectId, imported.project.projectId);

  const restarted = createProjectCenterService({ dataRoot, createId: ids, now: clock() });
  assert.equal((await restarted.initialize()).projectCount, 2);
  const importedAssets = await restarted.listAssets(imported.project.projectId);
  assert.equal(importedAssets.length, 1);
  assert.equal(importedAssets[0].asset.availability, "available");
  assert.equal(JSON.stringify(importedAssets).includes(source), false);
});
