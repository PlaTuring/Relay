import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const projectRoot = path.resolve(import.meta.dirname, "..");

async function loadModules(context) {
  const buildRoot = await mkdtemp(path.join(os.tmpdir(), "relay-a28-project-assets-module-"));
  context.after(() => rm(buildRoot, { recursive: true, force: true }));
  const assetsOut = path.join(buildRoot, "project-assets.mjs");
  const domainOut = path.join(buildRoot, "project-domain.mjs");
  const preflightOut = path.join(buildRoot, "asset-preflight.mjs");
  await Promise.all([
    build({ entryPoints: [path.join(projectRoot, "src", "main", "services", "project-assets.ts")], outfile: assetsOut, bundle: true, format: "esm", platform: "node", target: "node22", logLevel: "silent" }),
    build({ entryPoints: [path.join(projectRoot, "src", "shared", "project-domain.ts")], outfile: domainOut, bundle: true, format: "esm", platform: "node", target: "node22", logLevel: "silent" }),
    build({ entryPoints: [path.join(projectRoot, "src", "main", "services", "asset-preflight.ts")], outfile: preflightOut, bundle: true, format: "esm", platform: "node", target: "node22", logLevel: "silent" })
  ]);
  const cache = Date.now();
  return {
    assets: await import(`${new URL(`file:///${assetsOut.replaceAll("\\", "/")}`).href}?test=${cache}`),
    domain: await import(`${new URL(`file:///${domainOut.replaceAll("\\", "/")}`).href}?test=${cache}`),
    preflight: await import(`${new URL(`file:///${preflightOut.replaceAll("\\", "/")}`).href}?test=${cache}`)
  };
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

function fakeMp4(marker = 0) {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32BE(24, 0);
  bytes.write("ftyp", 4, "ascii");
  bytes.write("isom", 8, "ascii");
  bytes[31] = marker;
  return bytes;
}

function fakeWav(marker = 0) {
  const bytes = Buffer.alloc(44);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(36, 4);
  bytes.write("WAVE", 8, "ascii");
  bytes.write("fmt ", 12, "ascii");
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(48_000, 24);
  bytes[43] = marker;
  return bytes;
}

function idFactory() {
  let value = 1;
  return () => (value++).toString(16).padStart(32, "0");
}

async function createPersistentFixture(modules, root) {
  const projectDirectory = path.join(root, "projects", "project-a28asset1");
  await mkdir(projectDirectory, { recursive: true });
  const documentPath = path.join(projectDirectory, "project.relay.json");
  const initial = modules.domain.createEmptyRelayProject({
    projectId: "project-a28asset1",
    name: "素材闭环项目",
    createdAt: "2026-08-30T00:00:00.000Z"
  });
  await writeFile(documentPath, `${modules.domain.canonicalRelayProjectJson(initial)}\n`);
  const privateReferences = new Map();
  let clock = 0;
  let failSave = false;
  const loadProject = async () => modules.domain.normalizeRelayProject(JSON.parse(await readFile(documentPath, "utf8")));
  const saveProject = async (project) => {
    if (failSave) throw new Error("fixture save failed");
    await writeFile(documentPath, `${modules.domain.canonicalRelayProjectJson(project)}\n`);
  };
  const ffprobeRunner = async (_executable, arguments_) => {
    const file = arguments_.at(-1);
    if (path.extname(file).toLowerCase() === ".mp4") return {
      format: { duration: "5" },
      streams: [{ codec_type: "video", codec_name: "h264", pix_fmt: "yuv420p", width: 1280, height: 720, avg_frame_rate: "24/1" }]
    };
    return { format: { duration: "4" }, streams: [{ codec_type: "audio", codec_name: "pcm_s16le", channels: 2, sample_rate: "48000" }] };
  };
  const service = modules.assets.createProjectAssetService({
    projectRoot: projectDirectory,
    loadProject,
    saveProject,
    resolveExternalReference: async (referenceId) => privateReferences.get(referenceId) ?? null,
    saveExternalReference: async (referenceId, absolutePath) => { privateReferences.set(referenceId, absolutePath); },
    removeExternalReference: async (referenceId) => { privateReferences.delete(referenceId); },
    ffprobePath: "C:\\Relay\\ffprobe.exe",
    ffprobeRunner,
    preflight: async (file, options = {}) => modules.preflight.preflightLocalAsset(file, { ...options, ffprobeRunner }),
    createId: idFactory(),
    now: () => new Date(Date.UTC(2026, 7, 30, 0, 0, clock++))
  });
  return {
    projectDirectory, documentPath, privateReferences, loadProject, saveProject, service,
    setFailSave(value) { failSave = value; },
  };
}

test("project asset import defaults to verified originals copies, deduplicates SHA and persists metadata", async (context) => {
  const modules = await loadModules(context);
  const root = await mkdtemp(path.join(os.tmpdir(), "relay a28 project assets Ω "));
  context.after(() => rm(root, { recursive: true, force: true }));
  const fixture = await createPersistentFixture(modules, root);
  const inputs = path.join(root, "用户 输入");
  await mkdir(inputs);
  const image = path.join(inputs, "首帧 图.png");
  const duplicate = path.join(inputs, "内容重复.png");
  const video = path.join(inputs, "运镜.mp4");
  const audio = path.join(inputs, "环境声.wav");
  await writeFile(image, png(1344, 768));
  await writeFile(duplicate, png(1344, 768));
  await writeFile(video, fakeMp4());
  await writeFile(audio, fakeWav());
  const sourceBefore = await readFile(image);
  const imported = await fixture.service.importAssets({ paths: [image, duplicate, video, audio] });
  assert.deepEqual(imported.results.map((entry) => entry.status), ["imported", "duplicate", "imported", "imported"]);
  assert.equal(imported.importedCount, 3);
  assert.equal(imported.duplicateCount, 1);
  assert.equal(imported.rejectedCount, 0);
  assert.equal(imported.results[1].duplicateAssetId, imported.results[0].asset.assetId);
  const project = await fixture.loadProject();
  assert.equal(project.assets.length, 3);
  assert.ok(project.assets.every((asset) => asset.storageMode === "project_copy"));
  assert.ok(project.assets.every((asset) => asset.projectRelativePath.startsWith("assets/originals/")));
  assert.equal(JSON.stringify(project).includes(root), false, "authoritative project JSON must not leak private absolute paths");
  for (const asset of project.assets) {
    const copied = path.join(fixture.projectDirectory, asset.projectRelativePath);
    assert.deepEqual(await readFile(copied), await readFile(asset.mediaType === "image" ? image : asset.mediaType === "video" ? video : audio));
  }
  assert.deepEqual(await readFile(image), sourceBefore, "import never modifies the user's source file");

  const imageAsset = project.assets.find((asset) => asset.mediaType === "image");
  const updated = await fixture.service.updateAsset(imageAsset.assetId, {
    displayName: "雨夜主角参考",
    tags: ["角色", "雨夜", "角色"],
    notes: "首镜头使用"
  });
  assert.deepEqual(updated.tags, ["角色", "雨夜"]);
  assert.equal((await fixture.service.listAssets({ query: "首镜头", tags: ["雨夜"] })).length, 1);

  const restarted = modules.assets.createProjectAssetService({
    projectRoot: fixture.projectDirectory,
    loadProject: fixture.loadProject,
    saveProject: fixture.saveProject,
    resolveExternalReference: async (referenceId) => fixture.privateReferences.get(referenceId) ?? null,
    saveExternalReference: async (referenceId, absolutePath) => { fixture.privateReferences.set(referenceId, absolutePath); },
    preflight: modules.preflight.preflightLocalAsset,
    createId: idFactory()
  });
  assert.equal((await restarted.listAssets({ query: "雨夜主角" }))[0].asset.displayName, "雨夜主角参考");
});

test("generated-video import validates expected evidence before creating a project record", async (context) => {
  const modules = await loadModules(context);
  const root = await mkdtemp(path.join(os.tmpdir(), "relay-a28-generated-import-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const fixture = await createPersistentFixture(modules, root);
  const source = path.join(root, "generated.mp4");
  const bytes = fakeMp4(7);
  await writeFile(source, bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  await assert.rejects(
    fixture.service.importAssets({
      paths: [source],
      mode: "copy",
      expectedSource: { sha256: "0".repeat(64), byteLength: bytes.length },
    }),
    /no project record was created/u,
  );
  assert.equal((await fixture.loadProject()).assets.length, 0);

  const imported = await fixture.service.importAssets({
    paths: [source],
    mode: "copy",
    expectedSource: { sha256, byteLength: bytes.length },
  });
  assert.equal(imported.importedCount, 1);
  assert.equal(imported.results[0].asset.sha256, sha256);
  assert.deepEqual(await readFile(source), bytes);

  const originals = path.join(fixture.projectDirectory, "assets", "originals");
  const beforeFailure = await readdir(originals);
  const secondSource = path.join(root, "generated-second.mp4");
  const secondBytes = fakeMp4(8);
  await writeFile(secondSource, secondBytes);
  fixture.setFailSave(true);
  await assert.rejects(
    fixture.service.importAssets({
      paths: [secondSource],
      mode: "copy",
      expectedSource: {
        sha256: createHash("sha256").update(secondBytes).digest("hex"),
        byteLength: secondBytes.length,
      },
    }),
    /fixture save failed/u,
  );
  assert.deepEqual(await readdir(originals), beforeFailure, "failed generated-video transaction removes its newly created copy");
  assert.equal((await fixture.loadProject()).assets.length, 1);
});

test("all ten binding purposes are project relations, media mismatches fail, and referenced assets cannot be silently removed", async (context) => {
  const modules = await loadModules(context);
  const root = await mkdtemp(path.join(os.tmpdir(), "relay-a28-bindings-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const fixture = await createPersistentFixture(modules, root);
  const image = path.join(root, "image.png");
  const video = path.join(root, "video.mp4");
  const audio = path.join(root, "audio.wav");
  await writeFile(image, png(64, 64));
  await writeFile(video, fakeMp4());
  await writeFile(audio, fakeWav());
  await fixture.service.importAssets({ paths: [image, video, audio] });
  const project = await fixture.loadProject();
  const imageAsset = project.assets.find((asset) => asset.mediaType === "image");
  const videoAsset = project.assets.find((asset) => asset.mediaType === "video");
  const audioAsset = project.assets.find((asset) => asset.mediaType === "audio");
  const imagePurposes = ["first_frame", "last_frame", "subject_reference", "product_reference", "scene_reference", "style_reference", "continuity_reference"];
  const bindings = [];
  for (const purpose of imagePurposes) bindings.push(await fixture.service.bindAsset({ targetKind: "project", targetId: project.projectId, assetId: imageAsset.assetId, purpose }));
  bindings.push(await fixture.service.bindAsset({ targetKind: "project", targetId: project.projectId, assetId: videoAsset.assetId, purpose: "motion_reference" }));
  bindings.push(await fixture.service.bindAsset({ targetKind: "project", targetId: project.projectId, assetId: videoAsset.assetId, purpose: "video_reference" }));
  bindings.push(await fixture.service.bindAsset({ targetKind: "project", targetId: project.projectId, assetId: audioAsset.assetId, purpose: "audio_reference" }));
  assert.equal(bindings.length, 10);
  assert.equal((await fixture.service.listAssets()).reduce((sum, entry) => sum + entry.usageCount, 0), 10);
  await assert.rejects(
    fixture.service.bindAsset({ targetKind: "project", targetId: project.projectId, assetId: audioAsset.assetId, purpose: "first_frame" }),
    /media type/u
  );
  const blocked = await fixture.service.removeAsset(imageAsset.assetId);
  assert.equal(blocked.status, "in_use");
  assert.equal(blocked.bindings.length, imagePurposes.length);
  for (const binding of blocked.bindings) assert.equal(await fixture.service.unbindAsset(binding.bindingId), true);
  const removed = await fixture.service.removeAsset(imageAsset.assetId);
  assert.equal(removed.status, "removed");
  assert.match(removed.retainedProjectRelativePath, /^assets\/originals\//u, "project copy remains recoverable instead of being silently deleted");
  assert.ok(await readFile(path.join(fixture.projectDirectory, removed.retainedProjectRelativePath)));
});

test("external reference mode stores only a resolver ID, refresh detects missing/changed, and explicit relink keeps stable asset ID", async (context) => {
  const modules = await loadModules(context);
  const root = await mkdtemp(path.join(os.tmpdir(), "relay-a28-reference-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const fixture = await createPersistentFixture(modules, root);
  const source = path.join(root, "reference.png");
  const exact = path.join(root, "moved.png");
  const replacement = path.join(root, "replacement.png");
  await writeFile(source, png(320, 180, 1));
  await writeFile(exact, png(320, 180, 1));
  await writeFile(replacement, png(320, 180, 2));
  const imported = await fixture.service.importAssets({ paths: [source], mode: "reference" });
  const asset = imported.results[0].asset;
  assert.equal(asset.storageMode, "external_reference");
  assert.equal(asset.projectRelativePath, null);
  assert.match(asset.externalReferenceId, /^reference-/u);
  assert.equal(JSON.stringify(await fixture.loadProject()).includes(root), false);
  assert.equal(fixture.privateReferences.get(asset.externalReferenceId), source);
  await rm(source);
  assert.equal((await fixture.service.refreshAssets())[0].asset.availability, "missing");
  const exactResult = await fixture.service.relinkAsset(asset.assetId, exact);
  assert.equal(exactResult.status, "relinked");
  assert.equal(exactResult.asset.assetId, asset.assetId);
  const needsConfirmation = await fixture.service.relinkAsset(asset.assetId, replacement);
  assert.equal(needsConfirmation.status, "replacement_required");
  const replaced = await fixture.service.relinkAsset(asset.assetId, replacement, true);
  assert.equal(replaced.status, "relinked");
  assert.equal(replaced.asset.assetId, asset.assetId);
  assert.notEqual(replaced.asset.sha256, asset.sha256);
  assert.equal(await fixture.service.resolveUsableAssetPath(asset.assetId), replacement);
});

test("changed project copies and rejected inputs never report fake success", async (context) => {
  const modules = await loadModules(context);
  const root = await mkdtemp(path.join(os.tmpdir(), "relay-a28-errors-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const fixture = await createPersistentFixture(modules, root);
  const image = path.join(root, "image.png");
  const bad = path.join(root, "fake.png");
  await writeFile(image, png(100, 100));
  await writeFile(bad, "not a png");
  const result = await fixture.service.importAssets({ paths: [image, bad] });
  assert.deepEqual(result.results.map((entry) => entry.status), ["imported", "rejected"]);
  const asset = result.results[0].asset;
  const copy = path.join(fixture.projectDirectory, asset.projectRelativePath);
  await writeFile(copy, png(100, 100, 7));
  const refreshed = await fixture.service.refreshAssets();
  assert.equal(refreshed[0].asset.availability, "changed");
  await assert.rejects(fixture.service.resolveUsableAssetPath(asset.assetId), /内容与项目登记/u);
});
