import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { build } from "esbuild";

const projectRoot = path.resolve(import.meta.dirname, "..");

function ids() {
  let value = 1;
  return () => (value++).toString(16).padStart(32, "0");
}

function clock() {
  let value = 0;
  return () => new Date(Date.UTC(2026, 7, 30, 14, 0, value++));
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

async function bundleEntry(context, name, entryPoint, electronSource = null) {
  const buildRoot = await mkdtemp(path.join(os.tmpdir(), `relay-a28-${name}-`));
  context.after(() => rm(buildRoot, { recursive: true, force: true }));
  const outfile = path.join(buildRoot, `${name}.mjs`);
  await build({
    entryPoints: [path.join(projectRoot, entryPoint)],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "silent",
    ...(electronSource === null ? {} : {
      plugins: [{
        name: `relay-${name}-electron-stub`,
        setup(builder) {
          builder.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "electron-stub" }));
          builder.onLoad({ filter: /.*/, namespace: "electron-stub" }, () => ({ contents: electronSource, loader: "js" }));
        }
      }]
    })
  });
  return import(`${pathToFileURL(outfile).href}?test=${Date.now()}-${Math.random()}`);
}

test("reference assets copy into verified project originals without changing the source or leaking paths", async (context) => {
  const { createProjectCenterService } = await bundleEntry(
    context,
    "asset-copy",
    "src/main/services/project-center.ts"
  );
  const temporary = await mkdtemp(path.join(os.tmpdir(), "relay-a28-copy-reference-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const dataRoot = path.join(temporary, "Relay 数据");
  const inputRoot = path.join(temporary, "用户 素材 Ω");
  await mkdir(inputRoot, { recursive: true });
  const source = path.join(inputRoot, "首帧 引用.png");
  const sourceBytes = png(1344, 768, 7);
  await writeFile(source, sourceBytes);

  const center = createProjectCenterService({ dataRoot, createId: ids(), now: clock() });
  await center.initialize();
  const project = await center.createProject({ name: "复制引用闭环" });
  const imported = await center.importAssets(project.projectId, {
    paths: [source, source],
    mode: "reference"
  });
  assert.deepEqual(imported.results.map((entry) => entry.status), ["imported", "duplicate"]);
  const asset = imported.results[0].asset;
  assert.ok(asset);
  assert.equal(asset.storageMode, "external_reference");

  const copied = await center.copyAssetIntoProject(project.projectId, asset.assetId);
  assert.equal(copied.status, "copied");
  assert.equal(copied.asset.storageMode, "project_copy");
  assert.equal(copied.asset.externalReferenceId, null);
  assert.match(copied.asset.projectRelativePath, /^assets\/originals\//u);
  assert.equal(JSON.stringify(copied).includes(temporary), false);
  const target = path.join(dataRoot, "projects", project.projectId, copied.asset.projectRelativePath);
  assert.deepEqual(await readFile(target), sourceBytes);
  assert.deepEqual(await readFile(source), sourceBytes, "copying into the project never modifies the user's source");

  const persisted = await center.loadProject(project.projectId);
  assert.equal(persisted.externalReferences.length, 0);
  assert.equal(JSON.stringify(persisted).includes(temporary), false);
  const machine = JSON.parse(await readFile(path.join(dataRoot, "config", "machine.json"), "utf8"));
  assert.equal(machine.relayPrivateReferences?.projects?.[project.projectId], undefined);
  const repeated = await center.copyAssetIntoProject(project.projectId, asset.assetId);
  assert.equal(repeated.status, "already_project_copy");
});

test("copy into project fails closed when an external asset hash changed", async (context) => {
  const { createProjectCenterService } = await bundleEntry(
    context,
    "asset-copy-changed",
    "src/main/services/project-center.ts"
  );
  const temporary = await mkdtemp(path.join(os.tmpdir(), "relay-a28-copy-changed-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const source = path.join(temporary, "reference.png");
  await writeFile(source, png(608, 352, 1));
  const dataRoot = path.join(temporary, "data");
  const center = createProjectCenterService({ dataRoot, createId: ids(), now: clock() });
  await center.initialize();
  const project = await center.createProject({ name: "内容变化阻断" });
  const imported = await center.importAssets(project.projectId, { paths: [source], mode: "reference" });
  const asset = imported.results[0].asset;
  assert.ok(asset);
  await writeFile(source, png(608, 352, 2));
  await assert.rejects(
    center.copyAssetIntoProject(project.projectId, asset.assetId),
    /SHA-256|内容|变化|changed/u
  );
  const persisted = await center.loadProject(project.projectId);
  assert.equal(persisted.assets[0].storageMode, "external_reference");
  assert.equal(persisted.assets[0].externalReferenceId, asset.externalReferenceId);
  assert.equal(persisted.assets[0].projectRelativePath, null);
  assert.equal(persisted.externalReferences.length, 1);
});

test("dropped asset IPC rejects empty, dangerous and excessive paths while preserving valid duplicates", async (context) => {
  globalThis.__relayA28Handlers = new Map();
  context.after(() => { delete globalThis.__relayA28Handlers; });
  const module = await bundleEntry(
    context,
    "drop-ipc",
    "src/main/ipc-registry.ts",
    `export const ipcMain = { handle(channel, handler) { globalThis.__relayA28Handlers.set(channel, handler); } };`
  );
  const calls = [];
  const emptyService = new Proxy({}, { get: () => async () => undefined });
  const projectCenter = new Proxy({}, {
    get(_target, property) {
      if (property === "importDroppedProjectAssets") {
        return async (request) => {
          calls.push(request);
          return { cancelled: false, importedCount: 0, duplicateCount: 0, rejectedCount: 0, results: [] };
        };
      }
      return async () => undefined;
    }
  });
  const rendererUrl = "file:///Relay/index.html";
  module.registerClosedIpcRegistry(rendererUrl, emptyService, emptyService, projectCenter, async () => undefined);
  const handler = globalThis.__relayA28Handlers.get("control:project-assets-import-dropped");
  assert.equal(typeof handler, "function");
  const frame = { url: rendererUrl };
  const event = { senderFrame: frame, sender: { mainFrame: frame } };
  const projectId = "project-a28drop01";

  const invalid = [
    { projectId, mode: "copy", paths: [] },
    { projectId, mode: "copy", paths: [""] },
    { projectId, mode: "copy", paths: ["relative.png"] },
    { projectId, mode: "link", paths: ["C:\\素材\\a.png"] },
    { projectId, mode: "copy", paths: ["\\\\.\\PhysicalDrive0"] },
    { projectId, mode: "reference", paths: ["C:\\valid.png\u0000hidden"] },
    { projectId, mode: "copy", paths: Array.from({ length: 513 }, (_, index) => `C:\\素材\\${index}.png`) },
    { projectId, mode: "copy", paths: ["C:\\素材\\a.png"], unexpected: true }
  ];
  for (const request of invalid) {
    await assert.rejects(async () => handler(event, request), /INVALID_REQUEST/u);
  }
  const validPath = "C:\\素材\\同一文件.png";
  const result = await handler(event, { projectId, mode: "reference", paths: [validPath, validPath] });
  assert.equal(result.cancelled, false);
  assert.deepEqual(calls, [{ projectId, mode: "reference", paths: [validPath, validPath] }]);
  assert.equal(JSON.stringify(result).includes(validPath), false);
});

test("preload resolves dropped Files privately with webUtils and never returns their paths", async (context) => {
  globalThis.__relayA28Invocations = [];
  globalThis.__relayA28Exposed = null;
  context.after(() => {
    delete globalThis.__relayA28Invocations;
    delete globalThis.__relayA28Exposed;
  });
  await bundleEntry(
    context,
    "drop-preload",
    "src/preload/index.ts",
    `
      export const contextBridge = { exposeInMainWorld(_name, value) { globalThis.__relayA28Exposed = value; } };
      export const ipcRenderer = { async invoke(channel, input) {
        globalThis.__relayA28Invocations.push({ channel, input });
        return { cancelled: false, importedCount: 1, duplicateCount: 0, rejectedCount: 0, results: [] };
      } };
      export const webUtils = { getPathForFile(file) { return file.__relayPath ?? ""; } };
    `
  );
  const firstPath = "C:\\用户素材\\首帧.png";
  const secondPath = "C:\\用户素材\\参考.mp4";
  const first = { __relayPath: firstPath };
  const second = { __relayPath: secondPath };
  const output = await globalThis.__relayA28Exposed.importDroppedProjectAssets(
    { projectId: "project-a28drop02", mode: "copy" },
    [first, second]
  );
  assert.equal(output.importedCount, 1);
  assert.equal(JSON.stringify(output).includes("用户素材"), false);
  assert.deepEqual(globalThis.__relayA28Invocations, [{
    channel: "control:project-assets-import-dropped",
    input: {
      projectId: "project-a28drop02",
      mode: "copy",
      paths: [firstPath, secondPath]
    }
  }]);
  assert.throws(
    () => globalThis.__relayA28Exposed.importDroppedProjectAssets(
      { projectId: "project-a28drop02", mode: "copy" },
      [{}]
    ),
    /本地路径/u
  );
  assert.equal(globalThis.__relayA28Invocations.length, 1, "invalid File objects never reach main IPC");
});
