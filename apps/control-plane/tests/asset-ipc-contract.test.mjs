import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const projectRoot = path.resolve(import.meta.dirname, "..");
const read = (relativePath) => readFile(path.resolve(projectRoot, relativePath), "utf8");

test("asset library IPC is closed, typed, native-dialog-only, and path-private", async () => {
  const [contract, registry, preload, main, service] = await Promise.all([
    read("src/shared/ipc-contract.ts"),
    read("src/main/ipc-registry.ts"),
    read("src/preload/index.ts"),
    read("src/main/main.ts"),
    read("src/main/services/asset-library.ts")
  ]);
  const channels = [
    ["importLocalAssets", "control:asset-import-local"],
    ["listLocalAssets", "control:asset-list-local"],
    ["updateLocalAsset", "control:asset-update-local"],
    ["refreshLocalAssets", "control:asset-refresh-local"],
    ["relocateLocalAsset", "control:asset-relocate-local"],
    ["confirmLocalAssetReplacement", "control:asset-confirm-replacement"],
    ["copyLocalAssetToProject", "control:asset-copy-to-project"],
    ["prepareLocalAssetFrame", "control:asset-prepare-frame"]
  ];
  for (const [name, channel] of channels) {
    assert.ok(contract.includes(`${name}: "${channel}"`));
    assert.ok(registry.includes(`IPC_REGISTRY.${name}`));
    assert.ok(preload.includes(`IPC_REGISTRY.${name}`));
  }
  assert.match(registry, /importLocalAssets,[\s\S]*?requireNoInput\(input, "local asset import"\)/u);
  assert.match(registry, /refreshLocalAssets,[\s\S]*?requireNoInput\(input, "local asset refresh"\)/u);
  assert.ok(registry.includes("validateAssetListRequest"));
  assert.ok(registry.includes("validateAssetMetadataUpdate"));
  assert.ok(registry.includes("validateAssetRelocateConfirm"));
  assert.ok(registry.includes("validateAssetPrepareFrame"));
  assert.doesNotMatch(preload, /ipcRenderer\.(?:send|on|once|sendSync|postMessage)/u);

  const publicRecord = contract.slice(
    contract.indexOf("export interface AssetRecord"),
    contract.indexOf("export interface AssetListRequest")
  );
  assert.doesNotMatch(publicRecord, /absolute|sourcePath|activePath|rootPath|displayPath/iu);
  for (const field of ["assetId", "displayName", "mediaType", "sha256", "availability", "projectRelativePath"]) {
    assert.ok(publicRecord.includes(field));
  }
  assert.ok(service.includes("originalAbsolutePath"));
  assert.ok(service.includes("activeAbsolutePath"));
  assert.doesNotMatch(service, /console\.(?:log|info|warn|error|debug)/u);
  assert.doesNotMatch(`${service}\n${registry}\n${preload}`, /node:(?:http|https|net|tls|dns|child_process)/u);
  assert.doesNotMatch(`${service}\n${registry}\n${preload}`, /\bfetch\s*\(|\bWebSocket\b|upload|cloud|submitQueue|queuePrompt/iu);

  assert.ok(main.includes('properties: ["openFile", "multiSelections"]'));
  assert.ok(main.includes('properties: ["openDirectory", "createDirectory"]'));
  assert.ok(main.includes("ASSET_DIALOG_FILTERS"));
  assert.doesNotMatch(contract, /interface Asset(?:List|Metadata|Relocate|Copy|Prepare)[^{]*\{[^}]*absolutePath/isu);
});

test("asset controller performs real API operations and refreshes persisted state", async (context) => {
  const buildRoot = await mkdtemp(path.join(os.tmpdir(), "relay-asset-controller-"));
  context.after(() => rm(buildRoot, { recursive: true, force: true }));
  const outfile = path.join(buildRoot, "controller.mjs");
  await build({
    entryPoints: [path.join(projectRoot, "src", "renderer", "asset-library.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });
  const module = await import(`${new URL(`file:///${outfile.replaceAll("\\", "/")}`).href}?test=${Date.now()}`);
  const asset = Object.freeze({
    assetId: "asset-00000000000000000000000000000001",
    displayName: "雨夜图片",
    sourceFileName: "雨夜.png",
    mediaType: "image",
    extension: "png",
    byteLength: 4,
    sha256: "a".repeat(64),
    tags: [],
    note: "",
    storageMode: "reference_original",
    availability: "available",
    projectRelativePath: null,
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z"
  });
  let records = [asset];
  const calls = [];
  const api = {
    listLocalAssets: async (request) => {
      calls.push(["list", request]);
      return { assets: records, total: records.length };
    },
    importLocalAssets: async () => {
      calls.push(["import"]);
      return { cancelled: false, results: [{ status: "duplicate", selectedFileName: "雨夜.png", duplicateAsset: asset }] };
    },
    updateLocalAsset: async (request) => {
      calls.push(["update", request]);
      records = [{ ...asset, displayName: request.displayName, tags: request.tags, note: request.note }];
      return records[0];
    },
    refreshLocalAssets: async () => ({ assets: records, missingCount: 0, changedCount: 0 }),
    relocateLocalAsset: async () => ({ status: "cancelled" }),
    confirmLocalAssetReplacement: async () => ({ status: "cancelled" }),
    copyLocalAssetToProject: async () => ({ status: "cancelled" }),
    prepareLocalAssetFrame: async (request) => ({ selectionId: `frame_${request.slot}`, displayName: "雨夜.png" })
  };
  const controller = module.createAssetLibraryController(api);
  const snapshots = [];
  const unsubscribe = controller.subscribe((snapshot) => snapshots.push(snapshot));
  await controller.load();
  assert.equal(controller.getSnapshot().assets.length, 1);
  await controller.setQuery("雨夜");
  assert.equal(calls.at(-1)[1].query, "雨夜");
  const imported = await controller.importSelected();
  assert.equal(imported.results[0].status, "duplicate");
  await controller.updateMetadata({ assetId: asset.assetId, displayName: "新名称", tags: ["角色"], note: "备注" });
  assert.equal(controller.getSnapshot().assets[0].displayName, "新名称");
  const frame = await controller.prepareFrame(asset.assetId, "first");
  assert.equal(frame.selectionId, "frame_first");
  assert.equal(controller.getSnapshot().busyAction, null);
  assert.ok(snapshots.length >= 6);
  unsubscribe();
});

test("asset controller rejects out-of-order lists and invalidated action results", async (context) => {
  const buildRoot = await mkdtemp(path.join(os.tmpdir(), "relay-asset-controller-race-"));
  context.after(() => rm(buildRoot, { recursive: true, force: true }));
  const outfile = path.join(buildRoot, "controller.mjs");
  await build({
    entryPoints: [path.join(projectRoot, "src", "renderer", "asset-library.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    logLevel: "silent"
  });
  const module = await import(`${new URL(`file:///${outfile.replaceAll("\\", "/")}`).href}?test=${Date.now()}`);
  const record = (assetId, displayName) => Object.freeze({
    assetId,
    displayName,
    sourceFileName: `${displayName}.png`,
    mediaType: "image",
    extension: "png",
    byteLength: 4,
    sha256: assetId.at(-1).repeat(64),
    tags: [],
    note: "",
    storageMode: "reference_original",
    availability: "available",
    projectRelativePath: null,
    createdAt: "2026-09-04T00:00:00.000Z",
    updatedAt: "2026-09-04T00:00:00.000Z"
  });
  const oldAsset = record("asset-00000000000000000000000000000001", "旧请求");
  const newAsset = record("asset-00000000000000000000000000000002", "新请求");
  let resolveOld;
  let resolveNew;
  const oldResponse = new Promise((resolve) => { resolveOld = resolve; });
  const newResponse = new Promise((resolve) => { resolveNew = resolve; });
  let resolveImport;
  const importResponse = new Promise((resolve) => { resolveImport = resolve; });
  const requestedQueries = [];
  const api = {
    listLocalAssets: async (request) => {
      requestedQueries.push(request.query);
      if (request.query === "old") return oldResponse;
      if (request.query === "new") return newResponse;
      return { assets: [], total: 0 };
    },
    importLocalAssets: async () => importResponse
  };
  const controller = module.createAssetLibraryController(api);

  const oldLoad = controller.setQuery("old");
  const newLoad = controller.setQuery("new");
  resolveNew({ assets: [newAsset], total: 1 });
  await newLoad;
  assert.equal(controller.getSnapshot().filters.query, "new");
  assert.equal(controller.getSnapshot().assets[0].displayName, "新请求");
  resolveOld({ assets: [oldAsset], total: 1 });
  await oldLoad;
  assert.deepEqual(requestedQueries, ["old", "new"]);
  assert.equal(controller.getSnapshot().filters.query, "new");
  assert.equal(controller.getSnapshot().assets[0].displayName, "新请求", "late old response must not replace the newest list");

  const importAction = controller.importSelected();
  assert.equal(controller.getSnapshot().busyAction, "import");
  controller.invalidate();
  resolveImport({ cancelled: false, results: [] });
  await assert.rejects(importAction, { name: "AssetLibraryOperationSupersededError" });
  assert.equal(controller.getSnapshot().phase, "idle");
  assert.equal(controller.getSnapshot().busyAction, null);
  assert.equal(controller.getSnapshot().assets.length, 0);
  assert.equal(controller.getSnapshot().lastImport, null);
});
