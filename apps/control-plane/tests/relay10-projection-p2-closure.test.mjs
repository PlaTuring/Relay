import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");

async function bundledModule(entry) {
  const result = await build({
    entryPoints: [resolve(root, entry)],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    target: "node22",
    logLevel: "silent"
  });
  const source = result.outputFiles[0]?.text;
  assert.ok(source);
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

function projectAsset(assetId, mediaType, availability = "available") {
  return {
    assetId,
    displayName: assetId,
    sourceFileName: `${assetId}.${mediaType === "image" ? "png" : mediaType === "video" ? "mp4" : "wav"}`,
    mediaType,
    storageMode: "project_copy",
    projectRelativePath: `assets/originals/${assetId}.${mediaType === "image" ? "png" : mediaType === "video" ? "mp4" : "wav"}`,
    externalReferenceId: null,
    byteLength: 16,
    sha256: "a".repeat(64),
    tags: [],
    notes: "",
    availability,
    inspection: null,
    createdAt: "2026-09-03T00:00:00.000Z",
    updatedAt: "2026-09-03T00:00:00.000Z"
  };
}

test("legacy quick references migrate deterministically into explicit compiler slots and retain non-images", async () => {
  const [domain, policy] = await Promise.all([
    bundledModule("src/shared/project-domain.ts"),
    bundledModule("src/renderer/asset-projection-policy.ts")
  ]);
  const base = domain.createEmptyRelayProject({
    projectId: "project-legacy-quick-assets",
    name: "旧版素材迁移",
    createdAt: "2026-09-03T00:00:00.000Z"
  });
  const imageOne = projectAsset("asset-legacy-image-one", "image");
  const video = projectAsset("asset-legacy-video", "video");
  const missingImage = projectAsset("asset-legacy-image-missing", "image", "missing");
  const imageTwo = projectAsset("asset-legacy-image-two", "image");
  const project = domain.normalizeRelayProject({
    ...base,
    quick: {
      ...base.quick,
      mode: "FL2VA",
      referenceAssetIds: [imageOne.assetId, video.assetId, missingImage.assetId, imageTwo.assetId]
    },
    assets: [imageOne, video, missingImage, imageTwo]
  });

  const migrated = policy.migrateLegacyQuickAssetReferences(project);
  assert.equal(migrated.changed, true);
  assert.equal(migrated.project.quick.firstFrameAssetId, imageOne.assetId);
  assert.equal(migrated.project.quick.lastFrameAssetId, imageTwo.assetId);
  assert.deepEqual(migrated.migratedAssetIds, [imageOne.assetId, imageTwo.assetId]);
  assert.deepEqual(migrated.project.quick.referenceAssetIds, [video.assetId, missingImage.assetId]);
  assert.deepEqual(migrated.retainedLegacyAssetIds, [video.assetId, missingImage.assetId]);
  assert.equal(policy.migrateLegacyQuickAssetReferences(migrated.project).changed, false);
});

test("legacy migration preserves explicit choices, remains inert for T2V, and survives repository restart", async (context) => {
  const [domain, policy, repositoryModule] = await Promise.all([
    bundledModule("src/shared/project-domain.ts"),
    bundledModule("src/renderer/asset-projection-policy.ts"),
    bundledModule("src/main/services/project-repository.ts")
  ]);
  const dataRoot = await mkdtemp(join(os.tmpdir(), "relay-legacy-quick-projection-"));
  context.after(() => rm(dataRoot, { recursive: true, force: true }));
  const repository = repositoryModule.createProjectRepository({ dataRoot });
  const created = await repository.createProject({ name: "迁移重启" });
  const imageOne = projectAsset("asset-explicit-image", "image");
  const imageTwo = projectAsset("asset-legacy-second-image", "image");
  const legacyVideo = projectAsset("asset-legacy-record-video", "video");
  const old = domain.normalizeRelayProject({
    ...created,
    quick: {
      ...created.quick,
      mode: "REF2VA",
      totalDurationSeconds: 5,
      segmentDurationSeconds: 5,
      firstFrameAssetId: imageOne.assetId,
      referenceAssetIds: [imageOne.assetId, imageTwo.assetId, legacyVideo.assetId]
    },
    assets: [imageOne, imageTwo, legacyVideo]
  });
  const savedOld = await repository.saveProject(old, { expectedUpdatedAt: created.updatedAt });
  const result = policy.migrateLegacyQuickAssetReferences(savedOld);
  assert.equal(result.project.quick.firstFrameAssetId, imageOne.assetId);
  assert.equal(result.project.quick.lastFrameAssetId, imageTwo.assetId);
  assert.deepEqual(result.migratedAssetIds, [imageTwo.assetId]);
  assert.deepEqual(result.retainedLegacyAssetIds, [legacyVideo.assetId]);
  await repository.saveProject(result.project, { expectedUpdatedAt: savedOld.updatedAt });

  const restarted = repositoryModule.createProjectRepository({ dataRoot });
  const restored = await restarted.loadProject(created.projectId);
  assert.equal(restored.quick.firstFrameAssetId, imageOne.assetId);
  assert.equal(restored.quick.lastFrameAssetId, imageTwo.assetId);
  assert.deepEqual(restored.quick.referenceAssetIds, [legacyVideo.assetId]);

  const t2v = domain.normalizeRelayProject({
    ...restored,
    quick: {
      ...restored.quick,
      mode: "T2V",
      firstFrameAssetId: null,
      lastFrameAssetId: null,
      referenceAssetIds: [imageOne.assetId]
    }
  });
  const t2vResult = policy.migrateLegacyQuickAssetReferences(t2v);
  assert.equal(t2vResult.changed, false);
  assert.deepEqual(t2vResult.retainedLegacyAssetIds, [imageOne.assetId]);
});

test("binding disposition is decided without file state and matches certified mode inputs", async () => {
  const policy = await bundledModule("src/renderer/asset-projection-policy.ts");
  assert.equal(policy.directorBindingProjectionDisposition("T2V", "first_frame"), "record_only");
  assert.equal(policy.directorBindingProjectionDisposition("FL2VA", "first_frame"), "executable");
  assert.equal(policy.directorBindingProjectionDisposition("FL2VA", "scene_reference"), "record_only");
  assert.equal(policy.directorBindingProjectionDisposition("REF2VA", "continuity_reference"), "executable");
  assert.equal(policy.directorBindingProjectionDisposition("REF2VA", "video_reference"), "record_only");
});

test("renderer persists one-time legacy migration and validates files only after record-only disposition", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(resolve(root, "src/renderer/index.ts"), "utf8");
  const activationStart = source.indexOf("async function activateRelayProject");
  const activationEnd = source.indexOf("function projectWithQuickForm", activationStart);
  const activation = source.slice(activationStart, activationEnd);
  assert.match(activation, /migrateLegacyQuickAssetReferences\(loadedProject\)/u);
  assert.match(activation, /legacyQuickAssetMigration\.changed[\s\S]*?saveRelayProject/u);
  assert.match(activation, /expectedUpdatedAt:\s*loadedProject\.updatedAt/u);

  const projectionStart = source.indexOf("function buildDirectorAssetProjectionPlan");
  const projectionEnd = source.indexOf("function directorAssetProjectionSignature", projectionStart);
  const projection = source.slice(projectionStart, projectionEnd);
  const dispositionAt = projection.indexOf("directorBindingProjectionDisposition");
  const recordOnlyAt = projection.indexOf('if (disposition === "record_only") continue');
  const missingAt = projection.indexOf("if (asset === null)");
  assert.ok(dispositionAt >= 0 && recordOnlyAt > dispositionAt && missingAt > recordOnlyAt);
  assert.match(projection, /素材记录缺失（仅警告，不阻断编译）/u);
  assert.match(projection, /availability[^]*?仅警告，不阻断编译/u);

  const validationStart = source.indexOf("function directorValidationErrors");
  const validationEnd = source.indexOf("function focusDirectorField", validationStart);
  const validation = source.slice(validationStart, validationEnd);
  assert.match(validation, /if \(project === null\) \{[\s\S]*?state\.bindings/u);
});

test("all non-executable asset relationships are visibly labelled as project metadata", async () => {
  const { readFile } = await import("node:fs/promises");
  const [source, html] = await Promise.all([
    readFile(resolve(root, "src/renderer/index.ts"), "utf8"),
    readFile(resolve(root, "src/renderer/index.html"), "utf8")
  ]);
  const requiredCopy = "项目资料关系 · 不进入当前 H3 工作流";
  assert.match(source, new RegExp(requiredCopy, "u"));
  assert.match(source, /旧版参考素材[^\n]*项目资料关系 · 不进入当前 H3 工作流/u);
  assert.match(source, /binding\.targetKind !== "shot"[^]*?项目资料关系 · 不进入当前 H3 工作流/u);
  assert.ok(html.split(requiredCopy).length - 1 >= 4);
  assert.match(html, /项目、场景与实体绑定：项目资料关系 · 不进入当前 H3 工作流/u);
});
