import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const controlPlaneRoot = path.resolve(import.meta.dirname, "..");

async function loadModules(context) {
  const buildRoot = await mkdtemp(path.join(os.tmpdir(), "relay-a28-bundle-module-"));
  context.after(() => rm(buildRoot, { recursive: true, force: true }));
  const bundleOut = path.join(buildRoot, "relay-project-bundle.mjs");
  const domainOut = path.join(buildRoot, "project-domain.mjs");
  await Promise.all([
    build({ entryPoints: [path.join(controlPlaneRoot, "src", "main", "services", "relay-project-bundle.ts")], outfile: bundleOut, bundle: true, format: "esm", platform: "node", target: "node22", logLevel: "silent" }),
    build({ entryPoints: [path.join(controlPlaneRoot, "src", "shared", "project-domain.ts")], outfile: domainOut, bundle: true, format: "esm", platform: "node", target: "node22", logLevel: "silent" })
  ]);
  const cache = Date.now();
  return {
    bundle: await import(`${new URL(`file:///${bundleOut.replaceAll("\\", "/")}`).href}?test=${cache}`),
    domain: await import(`${new URL(`file:///${domainOut.replaceAll("\\", "/")}`).href}?test=${cache}`)
  };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
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

async function createFixture(context) {
  const modules = await loadModules(context);
  const root = await mkdtemp(path.join(os.tmpdir(), "relay-a28-bundle-fixture-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const projectRoot = path.join(root, "source", "project-bundle01");
  const copiedRelative = "assets/originals/first-frame.png";
  const copiedBytes = png(1280, 720, 1);
  const externalBytes = png(768, 1344, 2);
  const workflowBytes = Buffer.from('{"workflow":"verified"}\n', "utf8");
  const historyBytes = Buffer.from('{"history":"checkpoint"}\n', "utf8");
  const thumbnailBytes = png(160, 90, 3);
  const externalPath = path.join(root, "outside", "参考 图.png");
  await Promise.all([
    mkdir(path.join(projectRoot, "assets", "originals"), { recursive: true }),
    mkdir(path.join(projectRoot, "assets", "proxies"), { recursive: true }),
    mkdir(path.join(projectRoot, "assets", "thumbnails"), { recursive: true }),
    mkdir(path.join(projectRoot, "workflows"), { recursive: true }),
    mkdir(path.join(projectRoot, "history"), { recursive: true }),
    mkdir(path.dirname(externalPath), { recursive: true })
  ]);
  await Promise.all([
    writeFile(path.join(projectRoot, ...copiedRelative.split("/")), copiedBytes),
    writeFile(path.join(projectRoot, "assets", "proxies", "empty.proxy"), Buffer.alloc(0)),
    writeFile(path.join(projectRoot, "assets", "thumbnails", "first.png"), thumbnailBytes),
    writeFile(path.join(projectRoot, "workflows", "current.json"), workflowBytes),
    writeFile(path.join(projectRoot, "history", "checkpoint.json"), historyBytes),
    writeFile(externalPath, externalBytes)
  ]);
  const timestamp = "2026-08-30T01:02:03.000Z";
  const empty = modules.domain.createEmptyRelayProject({ projectId: "project-bundle01", name: "可迁移项目 🙂", createdAt: timestamp });
  const copiedAsset = {
    assetId: "asset-copied01", displayName: "首帧", sourceFileName: "first-frame.png", mediaType: "image",
    storageMode: "project_copy", projectRelativePath: copiedRelative, externalReferenceId: null,
    byteLength: copiedBytes.length, sha256: sha256(copiedBytes), tags: ["角色", "首帧"], notes: "源文件保持不变",
    availability: "available", inspection: { format: "png", width: 1280, height: 720 }, createdAt: timestamp, updatedAt: timestamp
  };
  const externalAsset = {
    assetId: "asset-external01", displayName: "外部参考", sourceFileName: "参考 图.png", mediaType: "image",
    storageMode: "external_reference", projectRelativePath: null, externalReferenceId: "reference-asset0001",
    byteLength: externalBytes.length, sha256: sha256(externalBytes), tags: ["参考"], notes: "只保存稳定定位 ID",
    availability: "available", inspection: { format: "png", width: 768, height: 1344 }, createdAt: timestamp, updatedAt: timestamp
  };
  const project = modules.domain.normalizeRelayProject({
    ...empty,
    assets: [copiedAsset, externalAsset],
    externalReferences: [{ referenceId: "reference-asset0001", kind: "asset_file", displayName: "外部参考", locatorId: "asset-locator-01", expectedSha256: externalAsset.sha256, attachOnly: true }],
    bindings: [{ bindingId: "binding-project01", targetKind: "project", targetId: empty.projectId, assetId: copiedAsset.assetId, purpose: "first_frame", notes: "项目首帧", createdAt: timestamp }],
    quick: { ...empty.quick, workflowName: "雨夜项目", mode: "FL2VA", firstFrameAssetId: copiedAsset.assetId },
    workflows: [{ workflowId: "workflow-current01", displayName: "权威工作流", projectRelativePath: "workflows/current.json", byteLength: workflowBytes.length, sha256: sha256(workflowBytes), createdAt: timestamp, handoffs: [] }],
    history: [{ historyId: "history-checkpoint01", kind: "manual", createdAt: timestamp, projectRelativePath: "history/checkpoint.json", byteLength: historyBytes.length, sha256: sha256(historyBytes), label: "手工检查点" }]
  });
  return { modules, root, projectRoot, project, copiedBytes, externalBytes, externalPath, workflowBytes, historyBytes };
}

test(".relayproj excludes private external paths, verifies every payload, and imports a portable project", async (context) => {
  const fixture = await createFixture(context);
  const destination = path.join(fixture.root, "exports", "portable.relayproj");
  const exported = await fixture.modules.bundle.exportRelayProjectBundle({
    projectRoot: fixture.projectRoot,
    project: fixture.project,
    destinationPath: destination,
    externalReferencePolicy: "exclude",
    resolveExternalReference: async (referenceId) => referenceId === "reference-asset0001" ? fixture.externalPath : null,
    now: () => new Date("2026-08-30T02:00:00.000Z"),
    createId: () => "11111111111111111111111111111111"
  });
  assert.ok(exported.byteLength > 0);
  assert.match(exported.sha256, /^[0-9a-f]{64}$/u);
  assert.deepEqual(exported.manifest.externalReferences.map((entry) => entry.action), ["excluded"]);
  assert.equal((await readFile(destination)).includes(Buffer.from(fixture.externalPath, "utf8")), false);

  const inspected = await fixture.modules.bundle.inspectRelayProjectBundle(destination);
  assert.equal(inspected.filesVerified, inspected.manifest.files.length);
  assert.ok(inspected.manifest.files.some((entry) => entry.path === "assets/proxies/empty.proxy" && entry.byteLength === 0));
  assert.equal(inspected.project.assets.find((asset) => asset.assetId === "asset-external01").storageMode, "external_reference");

  const imported = await fixture.modules.bundle.importRelayProjectBundle({ bundlePath: destination, dataRoot: path.join(fixture.root, "new-library") });
  assert.equal(imported.project.projectId, fixture.project.projectId);
  assert.equal(imported.project.assets.find((asset) => asset.assetId === "asset-external01").availability, "missing");
  assert.deepEqual(imported.excludedExternalReferenceIds, ["reference-asset0001"]);
  assert.deepEqual(await readFile(path.join(imported.projectRoot, "assets", "originals", "first-frame.png")), fixture.copiedBytes);
  assert.deepEqual(await readFile(path.join(imported.projectRoot, "workflows", "current.json")), fixture.workflowBytes);
  assert.deepEqual(await readFile(path.join(imported.projectRoot, "history", "checkpoint.json")), fixture.historyBytes);
  assert.equal((await readFile(path.join(imported.projectRoot, "assets", "proxies", "empty.proxy"))).length, 0);
  assert.equal(JSON.parse(await readFile(path.join(imported.projectRoot, "project.relay.json"), "utf8")).projectId, fixture.project.projectId);
});

test("external copy policy snapshots verified bytes without mutating the source, and ID conflicts import as a copy", async (context) => {
  const fixture = await createFixture(context);
  const destination = path.join(fixture.root, "exports", "with-external.relayproj");
  const sourceBefore = await readFile(fixture.externalPath);
  await fixture.modules.bundle.exportRelayProjectBundle({
    projectRoot: fixture.projectRoot,
    project: fixture.project,
    destinationPath: destination,
    externalReferencePolicy: "copy",
    resolveExternalReference: async () => fixture.externalPath,
    now: () => new Date("2026-08-30T02:01:00.000Z")
  });
  assert.deepEqual(await readFile(fixture.externalPath), sourceBefore);
  const inspected = await fixture.modules.bundle.inspectRelayProjectBundle(destination);
  assert.equal(inspected.manifest.externalReferences[0].action, "copied");
  const snapshotted = inspected.project.assets.find((asset) => asset.assetId === "asset-external01");
  assert.equal(snapshotted.storageMode, "project_copy");
  assert.equal(snapshotted.externalReferenceId, null);
  assert.equal(inspected.project.externalReferences.length, 0);

  const dataRoot = path.join(fixture.root, "copy-library");
  const first = await fixture.modules.bundle.importRelayProjectBundle({ bundlePath: destination, dataRoot });
  assert.deepEqual(await readFile(path.join(first.projectRoot, ...snapshotted.projectRelativePath.split("/"))), fixture.externalBytes);
  const second = await fixture.modules.bundle.importRelayProjectBundle({
    bundlePath: destination,
    dataRoot,
    onProjectIdConflict: "copy",
    createId: () => "22222222222222222222222222222222",
    now: () => new Date("2026-08-30T02:02:00.000Z")
  });
  assert.equal(second.copiedDueToConflict, true);
  assert.equal(second.project.projectId, "project-22222222222222222222222222222222");
  assert.equal(second.project.bindings.find((binding) => binding.targetKind === "project").targetId, second.project.projectId);
  assert.notEqual(first.projectRoot, second.projectRoot);
  await assert.rejects(() => fixture.modules.bundle.importRelayProjectBundle({ bundlePath: destination, dataRoot }), /already exists/u);
});

test("tampered payloads, private absolute paths, and existing destinations fail closed", async (context) => {
  const fixture = await createFixture(context);
  const destination = path.join(fixture.root, "exports", "verified.relayproj");
  await fixture.modules.bundle.exportRelayProjectBundle({
    projectRoot: fixture.projectRoot,
    project: fixture.project,
    destinationPath: destination,
    externalReferencePolicy: "exclude",
    resolveExternalReference: async () => fixture.externalPath
  });
  await assert.rejects(() => fixture.modules.bundle.exportRelayProjectBundle({
    projectRoot: fixture.projectRoot, project: fixture.project, destinationPath: destination,
    resolveExternalReference: async () => null
  }), /already exists/u);

  const archive = await readFile(destination);
  const assetOffset = archive.indexOf(fixture.copiedBytes);
  assert.ok(assetOffset >= 0);
  archive[assetOffset + fixture.copiedBytes.length - 1] ^= 0xff;
  const tampered = path.join(fixture.root, "exports", "tampered.relayproj");
  await writeFile(tampered, archive);
  await assert.rejects(() => fixture.modules.bundle.inspectRelayProjectBundle(tampered), /hash mismatch|CRC/u);

  const privateProject = fixture.modules.domain.normalizeRelayProject({
    ...fixture.project,
    professional: {
      ...fixture.project.professional,
      directorState: {
        privateSource: path.win32.join("C:\\", "Users", "fixture-user", "private.png")
      }
    }
  });
  await assert.rejects(() => fixture.modules.bundle.exportRelayProjectBundle({
    projectRoot: fixture.projectRoot,
    project: privateProject,
    destinationPath: path.join(fixture.root, "exports", "private.relayproj"),
    resolveExternalReference: async () => null
  }), /absolute private path/u);
});

function unsafeZip(entries) {
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;
  for (const input of entries) {
    const name = Buffer.from(input.name, "utf8");
    const data = input.data ?? Buffer.alloc(0);
    const method = input.method ?? 0;
    const compressedSize = input.compressedSize ?? data.length;
    const uncompressedSize = input.uncompressedSize ?? data.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(compressedSize, 18);
    local.writeUInt32LE(uncompressedSize, 22);
    local.writeUInt16LE(name.length, 26);
    localChunks.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(compressedSize, 20);
    central.writeUInt32LE(uncompressedSize, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((input.externalAttributes ?? 0) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralChunks.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const localBytes = Buffer.concat(localChunks);
  const centralBytes = Buffer.concat(centralChunks);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(localBytes.length, 16);
  return Buffer.concat([localBytes, centralBytes, end]);
}

test("malicious ZIP paths, duplicates, reparse entries, and compression bombs are rejected before extraction", async (context) => {
  const modules = await loadModules(context);
  const root = await mkdtemp(path.join(os.tmpdir(), "relay-a28-malicious-bundle-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const cases = [
    ["zip-slip", unsafeZip([{ name: "../escape.txt" }]), /escapes|relative|canonical/u],
    ["absolute", unsafeZip([{ name: "C:/private.txt" }]), /relative/u],
    ["secret", unsafeZip([{ name: "assets/originals/token.env" }]), /secret/u],
    ["duplicate", unsafeZip([{ name: "project.relay.json" }, { name: "PROJECT.RELAY.JSON" }]), /duplicate/iu],
    ["symlink", unsafeZip([{ name: "assets/originals/link.png", externalAttributes: 0xa000 << 16 }]), /symbolic-link|reparse/iu],
    ["bomb", unsafeZip([{ name: "assets/originals/bomb.png", method: 8, data: Buffer.from([0]), compressedSize: 1, uncompressedSize: 1001 }]), /compression ratio/u]
  ];
  for (const [name, bytes, pattern] of cases) {
    const bundlePath = path.join(root, `${name}.relayproj`);
    await writeFile(bundlePath, bytes);
    await assert.rejects(() => modules.bundle.inspectRelayProjectBundle(bundlePath), pattern, name);
  }
  assert.equal(await readFile(path.join(root, "zip-slip.relayproj")).then(() => true), true);
  await assert.rejects(() => readFile(path.join(root, "escape.txt")), /ENOENT/u);
});
