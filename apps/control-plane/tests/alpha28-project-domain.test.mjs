import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");

async function loadModule(context, entry) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "relay-alpha28-domain-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const outfile = path.join(directory, "module.mjs");
  await build({ entryPoints: [path.join(root, entry)], outfile, bundle: true, format: "esm", platform: "node", target: "node22", logLevel: "silent" });
  return import(`${new URL(`file:///${outfile.replaceAll("\\", "/")}`).href}?${Date.now()}`);
}

test("shared project contract keeps Unicode display names separate from safe stable paths", async (context) => {
  const domain = await loadModule(context, "src/shared/project-domain.ts");
  const project = domain.createEmptyRelayProject({
    projectId: "project-12345678",
    name: "雨夜 / 项目 Ω 🙂",
    createdAt: "2026-08-30T00:00:00.000Z"
  });
  assert.equal(project.schemaVersion, 1);
  assert.equal(project.name, "雨夜 / 项目 Ω 🙂");
  assert.equal(project.editorMode, "quick");
  assert.equal(project.quick.originalPrompt, "");
  assert.equal(domain.normalizeProjectRelativePath("assets\\originals\\帧 🙂.png", "assets"), "assets/originals/帧 🙂.png");
  assert.throws(() => domain.normalizeProjectRelativePath("D:\\secret.png"), /relative/u);
  assert.throws(() => domain.normalizeProjectRelativePath("assets/../../secret.png"), /escapes/u);
  assert.throws(() => domain.createEmptyRelayProject({ projectId: "雨夜", name: "x", createdAt: "2026-08-30T00:00:00Z" }), /stable project ID/u);
  assert.equal(domain.canonicalRelayProjectJson(project), domain.canonicalRelayProjectJson(JSON.parse(JSON.stringify(project))));
});

test("quick and professional editors share one document without rewriting the original prompt", async (context) => {
  const domain = await loadModule(context, "src/shared/project-domain.ts");
  const empty = domain.createEmptyRelayProject({ projectId: "project-abcdefgh", name: "共用项目", createdAt: "2026-08-30T00:00:00Z" });
  const directorState = { version: 7, original: "逐字保留\r\nEmoji 🐟", nested: { b: 2, a: 1 } };
  const project = domain.normalizeRelayProject({
    ...empty,
    editorMode: "professional",
    quick: {
      ...empty.quick,
      workflowName: "鱼 城 01",
      originalPrompt: "一条机械金鱼 / do not rewrite",
      mode: "FL2VA",
      language: "mixed",
      totalDurationSeconds: 30,
      segmentDurationSeconds: 10
    },
    professional: {
      ...empty.professional,
      directorState,
      promotedQuickState: { ...empty.quick, originalPrompt: "一条机械金鱼 / do not rewrite" }
    }
  });
  assert.equal(project.quick.originalPrompt, "一条机械金鱼 / do not rewrite");
  assert.deepEqual(project.professional.directorState, directorState);
  assert.equal(project.quick.segmentDurationSeconds, 10);
  assert.equal(domain.migrateRelayProjectDocument(project).migrated, false);
  assert.throws(() => domain.migrateRelayProjectDocument({ ...project, schemaVersion: 99 }), /Unsupported/u);
});

test("asset, binding, Scene to Shot and transition capability are fail-closed", async (context) => {
  const domain = await loadModule(context, "src/shared/project-domain.ts");
  const base = domain.createEmptyRelayProject({ projectId: "project-assets001", name: "素材与镜头", createdAt: "2026-08-30T00:00:00Z" });
  const asset = {
    assetId: "asset-12345678", displayName: "首帧", sourceFileName: "first.png", mediaType: "image",
    storageMode: "project_copy", projectRelativePath: "assets/originals/first.png", externalReferenceId: null,
    byteLength: 10, sha256: "a".repeat(64), tags: ["人物", "人物"], notes: "", availability: "available",
    inspection: { width: 1280, height: 720 }, createdAt: base.createdAt, updatedAt: base.updatedAt
  };
  const shot = {
    shotId: "shot-12345678", name: "镜头一", order: 0, durationSeconds: 15, prompt: "用户原文", camera: "", sound: "",
    startState: { wardrobeAppearance: { mode: "inherit", value: "", locked: true } },
    endState: { wardrobeAppearance: { mode: "override", value: "黄色雨衣", locked: false } },
    transitionFromPrevious: { type: "fade", capability: "proven", inheritedFields: ["wardrobeAppearance"], assetId: null, customIntent: "意图" },
    archived: false
  };
  const project = domain.normalizeRelayProject({
    ...base,
    quick: { ...base.quick, firstFrameAssetId: asset.assetId },
    assets: [asset],
    scenes: [{ sceneId: "scene-12345678", name: "场景一", order: 0, notes: "", shotIds: [shot.shotId], archived: false }],
    shots: [shot],
    bindings: [{ bindingId: "binding-12345678", targetKind: "shot", targetId: shot.shotId, assetId: asset.assetId,
      purpose: "first_frame", notes: "", createdAt: base.createdAt }]
  });
  assert.equal(project.shots[0].transitionFromPrevious.capability, "intent_only", "unsupported transitions cannot claim proven execution");
  assert.equal(project.bindings[0].purpose, "first_frame");
  assert.equal(project.assets[0].projectRelativePath, "assets/originals/first.png");
  assert.throws(() => domain.normalizeRelayProject({ ...project, shots: [{ ...shot, durationSeconds: 7 }] }), /5, 10, or 15/u);
  assert.throws(() => domain.normalizeRelayProject({ ...project, bindings: [{ ...project.bindings[0], assetId: "asset-missing0" }] }), /unknown target/u);
  assert.throws(() => domain.normalizeRelayProject({ ...project, assets: [{ ...asset, projectRelativePath: "../outside.png" }] }), /escapes/u);
  assert.throws(() => domain.normalizeRelayProject({ ...project, assets: [asset, asset] }), /Duplicate asset ID/u);
});

test("duration constraints preserve long segmented workflows and fail closed for Ref2VA", async (context) => {
  const domain = await loadModule(context, "src/shared/project-domain.ts");
  const base = domain.createEmptyRelayProject({ projectId: "project-duration01", name: "时长边界", createdAt: "2026-08-30T00:00:00Z" });
  const long = domain.normalizeRelayProject({ ...base, quick: { ...base.quick, totalDurationSeconds: 60, segmentDurationSeconds: 15 } });
  assert.equal(long.quick.totalDurationSeconds / long.quick.segmentDurationSeconds, 4);
  const ref = domain.normalizeRelayProject({ ...base, quick: { ...base.quick, mode: "REF2VA", totalDurationSeconds: 15, segmentDurationSeconds: 15 } });
  assert.equal(ref.quick.mode, "REF2VA");
  assert.throws(() => domain.normalizeRelayProject({ ...base, quick: { ...base.quick, mode: "REF2VA", totalDurationSeconds: 30, segmentDurationSeconds: 15 } }), /exactly one/u);
  assert.throws(() => domain.normalizeRelayProject({ ...base, quick: { ...base.quick, totalDurationSeconds: 25, segmentDurationSeconds: 10 } }), /multiple/u);
});

test("external ComfyUI and model roots remain stable attach-only resolver references", async (context) => {
  const domain = await loadModule(context, "src/shared/project-domain.ts");
  const base = domain.createEmptyRelayProject({ projectId: "project-external01", name: "外部环境", createdAt: "2026-08-30T00:00:00Z" });
  const project = domain.normalizeRelayProject({
    ...base,
    externalReferences: [
      { referenceId: "reference-comfy001", kind: "comfyui_root", displayName: "现有 ComfyUI", locatorId: "installation.comfy.primary", expectedSha256: null, attachOnly: true },
      { referenceId: "reference-model001", kind: "model_root", displayName: "现有模型", locatorId: "installation.models.primary", expectedSha256: null, attachOnly: true }
    ]
  });
  const json = JSON.stringify(project);
  assert.equal(json.includes("D:\\"), false);
  assert.ok(project.externalReferences.every((entry) => entry.attachOnly));
  assert.throws(() => domain.normalizeRelayProject({ ...project, externalReferences: [{ ...project.externalReferences[0], attachOnly: false }] }), /attach-only/u);
});
