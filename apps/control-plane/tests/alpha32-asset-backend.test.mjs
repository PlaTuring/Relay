import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { build } from "esbuild";

const appRoot = path.resolve(import.meta.dirname, "..");

function png(width = 64, height = 64, marker = 0) {
  const bytes = Buffer.alloc(40);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes[24] = 8;
  bytes[25] = 6;
  bytes[39] = marker;
  return bytes;
}

function ids() {
  let value = 1;
  return () => (value++).toString(16).padStart(32, "0");
}

async function bundle(context, name, entryPoint) {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), `relay-a32-${name}-`));
  context.after(() => rm(outputRoot, { recursive: true, force: true }));
  const outfile = path.join(outputRoot, `${name}.mjs`);
  await build({
    entryPoints: [path.join(appRoot, entryPoint)],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "silent"
  });
  return import(`${pathToFileURL(outfile).href}?test=${Date.now()}-${Math.random()}`);
}

async function bundleWithElectron(context, name, entryPoint, electronSource) {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), `relay-a32-${name}-`));
  context.after(() => rm(outputRoot, { recursive: true, force: true }));
  const outfile = path.join(outputRoot, `${name}.mjs`);
  await build({
    entryPoints: [path.join(appRoot, entryPoint)], outfile, bundle: true, format: "esm",
    platform: "node", target: "node22", logLevel: "silent",
    plugins: [{
      name: `relay-a32-${name}-electron`,
      setup(builder) {
        builder.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "electron-a32" }));
        builder.onLoad({ filter: /.*/, namespace: "electron-a32" }, () => ({ contents: electronSource, loader: "js" }));
      }
    }]
  });
  return import(`${pathToFileURL(outfile).href}?test=${Date.now()}-${Math.random()}`);
}

function asset(overrides = {}) {
  return Object.freeze({
    assetId: "asset-00000000000000000000000000000001",
    displayName: "真实缩略图",
    sourceFileName: "source.png",
    mediaType: "image",
    storageMode: "project_copy",
    projectRelativePath: "assets/originals/source.png",
    externalReferenceId: null,
    byteLength: 40,
    sha256: "a".repeat(64),
    tags: [], notes: "", availability: "available", inspection: null,
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
    ...overrides
  });
}

test("project preview cache renders one real PNG, persists it, and never exposes private paths", async (context) => {
  const module = await bundle(context, "preview", "src/main/services/project-asset-preview.ts");
  const root = await mkdtemp(path.join(os.tmpdir(), "relay a32 preview Ω "));
  context.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "assets", "originals", "source.png");
  await mkdir(path.dirname(source), { recursive: true });
  const sourceBytes = png(1920, 1080, 7);
  await writeFile(source, sourceBytes);
  const record = asset({ byteLength: sourceBytes.length });
  let renders = 0;
  const service = module.createProjectAssetPreviewService({
    projectRoot: root,
    loadAsset: async (assetId) => assetId === record.assetId ? record : null,
    resolveAssetPath: async () => source,
    renderImageThumbnail: async (_input, output) => {
      renders += 1;
      await writeFile(output, png(320, 180, 9), { flag: "wx" });
    },
    createId: ids()
  });
  const first = await service.getPreview(record.assetId);
  const second = await service.getPreview(record.assetId);
  assert.equal(first.status, "ready");
  assert.equal(first.kind, "image_thumbnail");
  assert.match(first.dataUrl, /^data:image\/png;base64,/u);
  assert.equal(renders, 1, "the second request reuses the persisted thumbnail cache");
  assert.equal(first.dataUrl, second.dataUrl);
  assert.equal(JSON.stringify(first).includes(root), false, "IPC result does not reveal the source or cache path");
  const cached = path.join(root, "assets", "thumbnails", `image-${record.assetId}-${record.sha256.slice(0, 16)}.png`);
  assert.deepEqual(await readFile(cached), png(320, 180, 9));
  assert.deepEqual(await readFile(source), sourceBytes, "thumbnail generation never modifies the source");

  const restarted = module.createProjectAssetPreviewService({
    projectRoot: root,
    loadAsset: async () => record,
    resolveAssetPath: async () => source,
    renderImageThumbnail: async () => { throw new Error("cache should have been used"); }
  });
  assert.equal((await restarted.getPreview(record.assetId)).status, "ready");
});

test("project-center default copy import eagerly creates a bounded real image thumbnail", async (context) => {
  const module = await bundle(context, "project-center-preview", "src/main/services/project-center.ts");
  const root = await mkdtemp(path.join(os.tmpdir(), "relay-a32-project-center-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const dataRoot = path.join(root, "Relay 数据库");
  const source = path.join(root, "用户原图.png");
  const sourceBytes = png(800, 600, 3);
  await writeFile(source, sourceBytes);
  let renders = 0;
  const center = module.createProjectCenterService({
    dataRoot,
    renderImageThumbnail: async (_input, output) => {
      renders += 1;
      await writeFile(output, png(320, 240, 8), { flag: "wx" });
    }
  });
  await center.initialize();
  const project = await center.createProject({ name: "缩略图闭环" });
  const imported = await center.importAssets(project.projectId, { paths: [source] });
  assert.equal(imported.importedCount, 1);
  assert.equal(imported.results[0].asset.storageMode, "project_copy");
  assert.equal(renders, 1, "the image cache is ready when the import transaction completes");
  const preview = await center.getAssetPreview(project.projectId, imported.results[0].asset.assetId);
  assert.equal(preview.status, "ready");
  assert.match(preview.dataUrl, /^data:image\/png;base64,/u);
  assert.equal(renders, 1, "the preview endpoint reuses the cached thumbnail");
  assert.deepEqual(await readFile(source), sourceBytes, "project import and preview do not mutate the source");
});

test("thumbnail creation rejects an intermediate reparse point before writing outside the project", async (context) => {
  const module = await bundle(context, "preview-reparse", "src/main/services/project-asset-preview.ts");
  const root = await mkdtemp(path.join(os.tmpdir(), "relay-a32-preview-reparse-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "relay-a32-preview-outside-"));
  context.after(() => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(outside, { recursive: true, force: true })
  ]));
  await symlink(outside, path.join(root, "assets"), "junction");
  const record = asset();
  let rendered = false;
  const service = module.createProjectAssetPreviewService({
    projectRoot: root,
    loadAsset: async () => record,
    resolveAssetPath: async () => path.join(outside, "source.png"),
    renderImageThumbnail: async () => { rendered = true; }
  });
  const preview = await service.getPreview(record.assetId);
  assert.equal(preview.status, "failed");
  assert.equal(rendered, false);
  await assert.rejects(readFile(path.join(outside, "thumbnails", "unexpected.png")));
  await assert.rejects(readFile(path.join(outside, "thumbnails")), { code: "ENOENT" });
});

test("video and audio previews fail honestly when no certified poster renderer exists", async (context) => {
  const module = await bundle(context, "preview-capability", "src/main/services/project-asset-preview.ts");
  const root = await mkdtemp(path.join(os.tmpdir(), "relay-a32-preview-capability-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "assets", "originals"), { recursive: true });
  const records = new Map([
    ["asset-00000000000000000000000000000002", asset({ assetId: "asset-00000000000000000000000000000002", mediaType: "video", sourceFileName: "clip.mp4", projectRelativePath: "assets/originals/clip.mp4" })],
    ["asset-00000000000000000000000000000003", asset({ assetId: "asset-00000000000000000000000000000003", mediaType: "audio", sourceFileName: "voice.wav", projectRelativePath: "assets/originals/voice.wav" })]
  ]);
  const service = module.createProjectAssetPreviewService({
    projectRoot: root,
    loadAsset: async (assetId) => records.get(assetId) ?? null,
    resolveAssetPath: async () => { throw new Error("not needed"); }
  });
  const video = await service.getPreview("asset-00000000000000000000000000000002");
  assert.equal(video.status, "unavailable");
  assert.equal(video.dataUrl, null);
  assert.match(video.message, /FFmpeg/u);
  const audio = await service.getPreview("asset-00000000000000000000000000000003");
  assert.equal(audio.status, "ready");
  assert.equal(audio.kind, "audio_icon");
  assert.equal(audio.dataUrl, null, "Relay does not expose a fake waveform");
});

test("default imports copy into project and safe deletion is restorable without deleting either file", async (context) => {
  const [assets, domain, preflight] = await Promise.all([
    bundle(context, "assets", "src/main/services/project-assets.ts"),
    bundle(context, "domain", "src/shared/project-domain.ts"),
    bundle(context, "preflight", "src/main/services/asset-preflight.ts")
  ]);
  const root = await mkdtemp(path.join(os.tmpdir(), "relay-a32-delete-restore-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const projectRoot = path.join(root, "projects", "project-a32assets");
  const source = path.join(root, "用户素材.png");
  await mkdir(projectRoot, { recursive: true });
  const bytes = png(640, 360, 4);
  await writeFile(source, bytes);
  let project = domain.createEmptyRelayProject({
    projectId: "project-a32assets",
    name: "可恢复删除",
    createdAt: "2026-08-30T00:00:00.000Z"
  });
  const service = assets.createProjectAssetService({
    projectRoot,
    loadProject: async () => project,
    saveProject: async (next) => { project = next; },
    resolveExternalReference: async () => null,
    saveExternalReference: async () => undefined,
    preflight: preflight.preflightLocalAsset,
    createId: ids(),
    now: () => new Date("2026-08-30T00:00:00.000Z")
  });
  const imported = await service.importAssets({ paths: [source] });
  assert.equal(imported.importedCount, 1);
  const importedAsset = imported.results[0].asset;
  assert.equal(importedAsset.storageMode, "project_copy");
  const copied = path.join(projectRoot, importedAsset.projectRelativePath);
  assert.deepEqual(await readFile(copied), bytes);
  const removed = await service.removeAsset(importedAsset.assetId);
  assert.equal(removed.status, "removed");
  assert.equal(project.assets.length, 0);
  assert.deepEqual(await readFile(source), bytes);
  assert.deepEqual(await readFile(copied), bytes, "recoverable delete retains the verified project copy");
  const tombstones = JSON.parse(await readFile(path.join(projectRoot, "recovery", "deleted-assets.v1.json"), "utf8"));
  assert.equal(tombstones.entries[0].asset.assetId, importedAsset.assetId);
  assert.equal(JSON.stringify(tombstones).includes(root), false, "recovery data contains no private absolute path");
  assert.deepEqual(await service.listDeletedAssets(), [{
    assetId: importedAsset.assetId,
    displayName: importedAsset.displayName,
    mediaType: "image",
    deletedAt: "2026-08-30T00:00:00.000Z"
  }]);
  const restored = await service.restoreAsset(importedAsset.assetId);
  assert.equal(restored.status, "restored");
  assert.equal(project.assets[0].assetId, importedAsset.assetId);
  assert.equal((JSON.parse(await readFile(path.join(projectRoot, "recovery", "deleted-assets.v1.json"), "utf8"))).entries.length, 0);
  assert.deepEqual(await service.listDeletedAssets(), []);
});

test("preview and restore IPC remain closed, typed, path-private, and default-copy capable", async () => {
  const [contract, registry, preload, main, poster] = await Promise.all([
    readFile(path.join(appRoot, "src", "shared", "ipc-contract.ts"), "utf8"),
    readFile(path.join(appRoot, "src", "main", "ipc-registry.ts"), "utf8"),
    readFile(path.join(appRoot, "src", "preload", "index.ts"), "utf8"),
    readFile(path.join(appRoot, "src", "main", "main.ts"), "utf8"),
    readFile(path.join(appRoot, "src", "main", "services", "fixed-ffmpeg-poster.ts"), "utf8")
  ]);
  for (const [name, channel] of [
    ["listDeletedProjectAssets", "control:project-assets-deleted-list"],
    ["getProjectAssetPreview", "control:project-assets-preview"],
    ["restoreProjectAsset", "control:project-assets-restore"]
  ]) {
    assert.ok(contract.includes(`${name}: "${channel}"`));
    assert.ok(registry.includes(`IPC_REGISTRY.${name}`));
    assert.ok(preload.includes(`IPC_REGISTRY.${name}`));
  }
  assert.match(main, /const mode = request\.mode \?\? "copy"/u);
  assert.match(main, /mode: request\.mode \?\? "copy"/u);
  const previewContract = contract.slice(
    contract.indexOf("export interface ProjectAssetPreviewContract"),
    contract.indexOf("export interface ProjectAssetRelinkContract")
  );
  assert.doesNotMatch(previewContract, /absolutePath|sourcePath|projectRoot|cachePath/u);
  assert.match(previewContract, /dataUrl: string \| null/u);
  const deletedContract = contract.slice(
    contract.indexOf("export interface DeletedProjectAssetViewContract"),
    contract.indexOf("export interface ProjectAssetPreviewContract")
  );
  assert.match(deletedContract, /assetId: string[\s\S]*displayName: string[\s\S]*mediaType: RelayMediaType[\s\S]*deletedAt: string/u);
  assert.doesNotMatch(deletedContract, /sha256|absolutePath|sourcePath|projectRelativePath|externalReference/u);
  assert.doesNotMatch(`${registry}\n${preload}`, /node:(?:http|https|net|tls|dns|child_process)/u);
  assert.doesNotMatch(`${registry}\n${preload}`, /upload|cloud|submitQueue|queuePrompt|\/prompt/iu);
  assert.match(main, /hasFfmpeg \? \{[\s\S]*createFixedFfmpegPosterRenderer/u);
  assert.match(poster, /spawn\(executable, Object\.freeze\(\[/u);
  assert.match(poster, /shell: false/u);
  assert.match(poster, /windowsHide: true/u);
  assert.doesNotMatch(poster, /process\.env\.PATH|exec\(|execFile\(/u);
});

test("single and batch drops go straight through webUtils to default-copy IPC without opening a dialog", async (context) => {
  globalThis.__relayA32Invocations = [];
  globalThis.__relayA32Api = null;
  context.after(() => {
    delete globalThis.__relayA32Invocations;
    delete globalThis.__relayA32Api;
  });
  await bundleWithElectron(
    context,
    "drop-preload",
    "src/preload/index.ts",
    `
      export const contextBridge = { exposeInMainWorld(_name, api) { globalThis.__relayA32Api = api; } };
      export const ipcRenderer = { async invoke(channel, input) {
        globalThis.__relayA32Invocations.push({ channel, input });
        return { cancelled: false, importedCount: input.paths?.length ?? 0, duplicateCount: 0, rejectedCount: 0, results: [] };
      } };
      export const webUtils = { getPathForFile(file) { return file.path; } };
    `
  );
  const projectId = "project-a32drops1";
  await globalThis.__relayA32Api.importDroppedProjectAssets(
    { projectId },
    [{ path: "C:\\素材\\单图.png" }]
  );
  await globalThis.__relayA32Api.importDroppedProjectAssets(
    { projectId },
    [
      { path: "C:\\素材\\一.png" },
      { path: "C:\\素材\\二.mp4" },
      { path: "C:\\素材\\三.wav" }
    ]
  );
  assert.deepEqual(globalThis.__relayA32Invocations, [
    {
      channel: "control:project-assets-import-dropped",
      input: { projectId, paths: ["C:\\素材\\单图.png"] }
    },
    {
      channel: "control:project-assets-import-dropped",
      input: { projectId, paths: ["C:\\素材\\一.png", "C:\\素材\\二.mp4", "C:\\素材\\三.wav"] }
    }
  ]);
  assert.equal(globalThis.__relayA32Invocations.some((entry) => "mode" in entry.input), false);
  assert.equal(globalThis.__relayA32Invocations.some((entry) => /dialog|directory/u.test(entry.channel)), false);
});
