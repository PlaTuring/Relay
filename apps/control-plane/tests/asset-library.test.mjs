import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  truncate,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const projectRoot = path.resolve(import.meta.dirname, "..");

async function loadAssetModule(context) {
  const buildRoot = await mkdtemp(path.join(os.tmpdir(), "relay-assets-module-"));
  context.after(() => rm(buildRoot, { recursive: true, force: true }));
  const outfile = path.join(buildRoot, "asset-library.mjs");
  await build({
    entryPoints: [path.join(projectRoot, "src", "main", "services", "asset-library.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "silent"
  });
  return import(`${new URL(`file:///${outfile.replaceAll("\\", "/")}`).href}?test=${Date.now()}`);
}

function dialogQueue(values = []) {
  const queue = [...values];
  return async () => queue.shift() ?? { canceled: true, filePaths: [] };
}

function createFixtureService(module, userDataPath, options = {}) {
  let id = 1;
  let clock = 0;
  const frameRegistrations = [];
  const service = module.createAssetLibraryService({
    userDataPath,
    chooseAssetFiles: options.chooseAssetFiles ?? dialogQueue(),
    chooseProjectDirectory: options.chooseProjectDirectory ?? dialogQueue(),
    chooseRelocationFile: options.chooseRelocationFile ?? dialogQueue(),
    registerFrameSelection: async (absolutePath, slot) => {
      frameRegistrations.push({ absolutePath, slot });
      return { selectionId: `frame_${slot}_${frameRegistrations.length}`, displayName: path.basename(absolutePath) };
    },
    createId: () => (id++).toString(16).padStart(32, "0"),
    now: () => new Date(Date.UTC(2026, 7, 30, 0, 0, clock++))
  });
  return { service, frameRegistrations };
}

const ALL = Object.freeze({ query: "", mediaType: "all", availability: "all", tags: [] });

test("local import persists private paths, deduplicates by SHA-256, and restarts without leaking paths", async (context) => {
  const module = await loadAssetModule(context);
  const root = await mkdtemp(path.join(os.tmpdir(), "relay 素材 Ω "));
  context.after(() => rm(root, { recursive: true, force: true }));
  const userData = path.join(root, "user-data");
  const media = path.join(root, "带 空格");
  await mkdir(media, { recursive: true });
  const image = path.join(media, "雨夜 图片.png");
  const imageDuplicate = path.join(media, "重复.png");
  const video = path.join(media, "镜头.mp4");
  const audio = path.join(media, "环境声.wav");
  const unsupported = path.join(media, "说明.exe");
  await Promise.all([
    writeFile(image, "same-image-content"),
    writeFile(imageDuplicate, "same-image-content"),
    writeFile(video, "video-content"),
    writeFile(audio, "audio-content"),
    writeFile(unsupported, "not-media")
  ]);
  const fixture = createFixtureService(module, userData, {
    chooseAssetFiles: dialogQueue([{
      canceled: false,
      filePaths: [image, imageDuplicate, video, audio, unsupported]
    }])
  });

  const imported = await fixture.service.importLocalAssets();
  assert.equal(imported.cancelled, false);
  assert.deepEqual(imported.results.map((item) => item.status), [
    "imported", "duplicate", "imported", "imported", "unsupported"
  ]);
  assert.equal(JSON.stringify(imported).includes(root), false, "renderer result must not expose absolute paths");
  const all = await fixture.service.listLocalAssets(ALL);
  assert.equal(all.total, 3);
  assert.deepEqual(new Set(all.assets.map((asset) => asset.mediaType)), new Set(["image", "video", "audio"]));
  assert.ok(all.assets.every((asset) => /^asset-[0-9a-f]{32}$/u.test(asset.assetId)));
  assert.ok(all.assets.every((asset) => /^[0-9a-f]{64}$/u.test(asset.sha256)));

  const imageAsset = all.assets.find((asset) => asset.mediaType === "image");
  assert.ok(imageAsset);
  const updated = await fixture.service.updateLocalAsset({
    assetId: imageAsset.assetId,
    displayName: "雨夜参考图",
    tags: ["角色", "雨夜", "角色"],
    note: "用于第一镜头"
  });
  assert.deepEqual(updated.tags, ["角色", "雨夜"]);
  const searched = await fixture.service.listLocalAssets({
    query: "第一镜头",
    mediaType: "image",
    availability: "available",
    tags: ["雨夜"]
  });
  assert.equal(searched.total, 1);
  assert.equal(searched.assets[0].displayName, "雨夜参考图");

  const privateLedger = JSON.parse(await readFile(module.assetLibraryLedgerPath(userData), "utf8"));
  assert.ok(
    privateLedger.assets.every((asset) => asset.originalAbsolutePath.startsWith(root)),
    "absolute paths belong only to the main-process private ledger"
  );
  const restarted = createFixtureService(module, userData).service;
  const restored = await restarted.listLocalAssets(ALL);
  assert.equal(restored.total, 3);
  assert.equal(restored.assets.find((asset) => asset.assetId === imageAsset.assetId)?.displayName, "雨夜参考图");
});

test("missing detection and relocation require exact SHA or an explicit replacement confirmation", async (context) => {
  const module = await loadAssetModule(context);
  const root = await mkdtemp(path.join(os.tmpdir(), "relay-assets-relocate-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const original = path.join(root, "original.png");
  const exact = path.join(root, "exact.png");
  const replacement = path.join(root, "replacement.png");
  await writeFile(original, "original-content");
  await copyFile(original, exact);
  await writeFile(replacement, "replacement-content");
  const relocations = dialogQueue([
    { canceled: false, filePaths: [exact] },
    { canceled: false, filePaths: [replacement] }
  ]);
  const fixture = createFixtureService(module, path.join(root, "user-data"), {
    chooseAssetFiles: dialogQueue([{ canceled: false, filePaths: [original] }]),
    chooseRelocationFile: relocations
  });
  const imported = await fixture.service.importLocalAssets();
  const asset = imported.results[0].asset;
  await rm(original);
  const detectedOnList = await fixture.service.listLocalAssets(ALL);
  assert.equal(detectedOnList.assets[0].availability, "missing", "a restart/list detects a missing file without trusting stale state");
  const missing = await fixture.service.refreshLocalAssets();
  assert.equal(missing.missingCount, 1);
  assert.equal(missing.assets[0].availability, "missing");

  const exactResult = await fixture.service.relocateLocalAsset({ assetId: asset.assetId });
  assert.equal(exactResult.status, "relocated");
  assert.equal(exactResult.asset.assetId, asset.assetId);
  assert.equal(exactResult.asset.availability, "available");

  const mismatch = await fixture.service.relocateLocalAsset({ assetId: asset.assetId });
  assert.equal(mismatch.status, "confirmation_required");
  assert.equal(JSON.stringify(mismatch).includes(root), false);
  assert.notEqual(mismatch.candidate.sha256, asset.sha256);
  const accepted = await fixture.service.confirmLocalAssetReplacement({
    assetId: asset.assetId,
    relocationToken: mismatch.relocationToken,
    acceptReplacement: true
  });
  assert.equal(accepted.status, "relocated");
  assert.equal(accepted.asset.assetId, asset.assetId, "replacement keeps the stable binding id");
  assert.equal(accepted.asset.sha256, mismatch.candidate.sha256);
});

test("explicit project copy is verified, relative, non-overwriting, and leaves the source unchanged", async (context) => {
  const module = await loadAssetModule(context);
  const root = await mkdtemp(path.join(os.tmpdir(), "relay-assets-copy-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "源 文件.png");
  const project = path.join(root, "项目 甲");
  const collisionProject = path.join(root, "项目 冲突");
  await Promise.all([mkdir(project, { recursive: true }), mkdir(path.join(collisionProject, "assets"), { recursive: true })]);
  await writeFile(source, "immutable-source-content");
  const before = await readFile(source);
  const fixture = createFixtureService(module, path.join(root, "user-data"), {
    chooseAssetFiles: dialogQueue([{ canceled: false, filePaths: [source] }]),
    chooseProjectDirectory: dialogQueue([
      { canceled: false, filePaths: [collisionProject] },
      { canceled: false, filePaths: [project] },
      { canceled: false, filePaths: [project] }
    ])
  });
  const imported = await fixture.service.importLocalAssets();
  const asset = imported.results[0].asset;
  const collisionTarget = path.join(collisionProject, "assets", `源 文件-${asset.sha256.slice(0, 12)}.png`);
  await writeFile(collisionTarget, "different-existing-content");
  await assert.rejects(
    fixture.service.copyLocalAssetToProject({ assetId: asset.assetId }),
    (error) => error?.code === "ASSET_LIBRARY_FAILED"
  );
  assert.equal(await readFile(collisionTarget, "utf8"), "different-existing-content", "different content is never overwritten");
  const copied = await fixture.service.copyLocalAssetToProject({ assetId: asset.assetId });
  assert.equal(copied.status, "copied");
  assert.match(copied.projectRelativePath, /^assets\//u);
  assert.equal(path.isAbsolute(copied.projectRelativePath), false);
  const target = path.join(project, copied.projectRelativePath);
  assert.deepEqual(await readFile(target), before);
  assert.deepEqual(await readFile(source), before, "source file must not be changed");
  const copiedAgain = await fixture.service.copyLocalAssetToProject({ assetId: asset.assetId });
  assert.equal(copiedAgain.status, "copied", "same verified copy is safely reused");

  const selection = await fixture.service.prepareLocalAssetFrame({ assetId: asset.assetId, slot: "first" });
  assert.equal(selection.displayName, path.basename(target));
  assert.equal(fixture.frameRegistrations.length, 1);
  assert.equal(fixture.frameRegistrations[0].absolutePath, target);
  assert.equal(fixture.frameRegistrations[0].slot, "first");
});

test("unsafe types, cancellation, changed content, and reparse project roots fail without fake success", async (context) => {
  const module = await loadAssetModule(context);
  const root = await mkdtemp(path.join(os.tmpdir(), "relay-assets-safety-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const image = path.join(root, "frame.png");
  const executable = path.join(root, "payload.exe");
  await writeFile(image, "frame-v1");
  await writeFile(executable, "payload");
  const empty = createFixtureService(module, path.join(root, "cancelled"), {
    chooseAssetFiles: dialogQueue([{ canceled: true, filePaths: [] }])
  });
  assert.deepEqual(await empty.service.importLocalAssets(), { cancelled: true, results: [] });

  const fixture = createFixtureService(module, path.join(root, "user-data"), {
    chooseAssetFiles: dialogQueue([{ canceled: false, filePaths: [executable, image] }])
  });
  const imported = await fixture.service.importLocalAssets();
  assert.equal(imported.results[0].status, "unsupported");
  assert.equal(imported.results[1].status, "imported");
  const asset = imported.results[1].asset;
  await writeFile(image, "frame-v2-different");
  await assert.rejects(
    fixture.service.prepareLocalAssetFrame({ assetId: asset.assetId, slot: "first" }),
    (error) => error?.code === "ASSET_CHANGED"
  );

  const realProject = path.join(root, "real-project");
  const junction = path.join(root, "project-junction");
  await mkdir(realProject);
  try {
    await symlink(realProject, junction, "junction");
  } catch (error) {
    if (error?.code === "EPERM") return;
    throw error;
  }
  const reparseFixture = createFixtureService(module, path.join(root, "reparse-user-data"), {
    chooseAssetFiles: dialogQueue([{ canceled: false, filePaths: [image] }]),
    chooseProjectDirectory: dialogQueue([{ canceled: false, filePaths: [junction] }])
  });
  const reparseImported = await reparseFixture.service.importLocalAssets();
  const reparseAsset = reparseImported.results[0].asset;
  await assert.rejects(
    reparseFixture.service.copyLocalAssetToProject({ assetId: reparseAsset.assetId }),
    (error) => error?.code === "INVALID_REQUEST"
  );
  assert.equal((await lstat(junction)).isSymbolicLink(), true);
});

test("large local media is stream-hashed and duplicate content still resolves to one stable asset", async (context) => {
  const module = await loadAssetModule(context);
  const root = await mkdtemp(path.join(os.tmpdir(), "relay-assets-large-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const large = path.join(root, "large-video.mkv");
  const duplicate = path.join(root, "large-video-copy.mkv");
  await writeFile(large, "");
  await truncate(large, 32 * 1024 * 1024);
  await copyFile(large, duplicate);
  const fixture = createFixtureService(module, path.join(root, "user-data"), {
    chooseAssetFiles: dialogQueue([{ canceled: false, filePaths: [large, duplicate] }])
  });
  const result = await fixture.service.importLocalAssets();
  assert.deepEqual(result.results.map((item) => item.status), ["imported", "duplicate"]);
  const expected = createHash("sha256").update(Buffer.alloc(32 * 1024 * 1024)).digest("hex");
  assert.equal(result.results[0].asset.sha256, expected);
  assert.equal((await fixture.service.listLocalAssets(ALL)).total, 1);
});

test("tampered project-relative traversal records fail closed and are never silently overwritten", async (context) => {
  const module = await loadAssetModule(context);
  const root = await mkdtemp(path.join(os.tmpdir(), "relay-assets-tamper-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const userData = path.join(root, "user-data");
  const source = path.join(root, "source.png");
  await writeFile(source, "source");
  const fixture = createFixtureService(module, userData, {
    chooseAssetFiles: dialogQueue([{ canceled: false, filePaths: [source] }])
  });
  await fixture.service.importLocalAssets();
  const ledgerPath = module.assetLibraryLedgerPath(userData);
  const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
  ledger.assets[0].storageMode = "project_copy";
  ledger.assets[0].projectRootAbsolutePath = root;
  ledger.assets[0].projectRelativePath = "../escape.png";
  ledger.assets[0].activeAbsolutePath = path.join(root, "..", "escape.png");
  const tampered = `${JSON.stringify(ledger)}\n`;
  await writeFile(ledgerPath, tampered);
  const restarted = createFixtureService(module, userData).service;
  await assert.rejects(
    restarted.listLocalAssets(ALL),
    (error) => error?.code === "ASSET_LIBRARY_FAILED"
  );
  assert.equal(await readFile(ledgerPath, "utf8"), tampered, "invalid private ledger is preserved for recovery");
});
