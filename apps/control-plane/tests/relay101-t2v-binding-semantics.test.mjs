import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const [renderer, html, styles] = await Promise.all([
  readFile(resolve(root, "src/renderer/index.ts"), "utf8"),
  readFile(resolve(root, "src/renderer/index.html"), "utf8"),
  readFile(resolve(root, "src/renderer/styles.css"), "utf8")
]);

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing start marker: ${startMarker}`);
  assert.ok(end > start, `missing end marker after ${startMarker}: ${endMarker}`);
  return source.slice(start, end);
}

async function loadProjectionPolicy() {
  const result = await build({
    entryPoints: [resolve(root, "src/renderer/asset-projection-policy.ts")],
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

test("projection remains fail-closed: T2V has no executable material input", async () => {
  const policy = await loadProjectionPolicy();
  for (const purpose of [
    "first_frame",
    "last_frame",
    "subject_reference",
    "product_reference",
    "scene_reference",
    "style_reference",
    "continuity_reference",
    "motion_reference",
    "video_reference",
    "audio_reference"
  ]) {
    assert.equal(policy.directorBindingProjectionDisposition("T2V", purpose), "record_only");
  }
  assert.equal(policy.directorBindingProjectionDisposition("FL2VA", "first_frame"), "executable");
  assert.equal(policy.directorBindingProjectionDisposition("FL2VA", "last_frame"), "executable");
  assert.equal(policy.directorBindingProjectionDisposition("FL2VA", "continuity_reference"), "record_only");
  for (const purpose of [
    "subject_reference",
    "product_reference",
    "scene_reference",
    "style_reference",
    "continuity_reference"
  ]) {
    assert.equal(policy.directorBindingProjectionDisposition("REF2VA", purpose), "executable");
  }
  assert.equal(policy.directorBindingProjectionDisposition("REF2VA", "first_frame"), "record_only");
  assert.equal(policy.directorBindingProjectionDisposition("REF2VA", "video_reference"), "record_only");
});

test("purpose choices expose only inputs the selected workflow can really consume", () => {
  const choices = sliceBetween(renderer, "function directorAssetPurposeOptions", "function defaultDirectorAssetPurpose");
  assert.match(choices, /mode === "T2V"[\s\S]*DIRECTOR_PROJECT_REFERENCE_PURPOSE_BY_MEDIA\[mediaType\]/u);
  assert.match(choices, /mediaType !== "image"\) return Object\.freeze\(\[\]\)/u);
  assert.match(choices, /mode === "REF2VA"[\s\S]*shotIds\.length === 1[\s\S]*DIRECTOR_IMAGE_REFERENCE_PURPOSES/u);
  assert.match(choices, /shotId === shotIds\[0\][\s\S]*"first_frame"/u);
  assert.match(choices, /shotId === shotIds\.at\(-1\)[\s\S]*"last_frame"/u);
  assert.doesNotMatch(choices, /DIRECTOR_ASSET_PURPOSES_BY_MEDIA/u);
});

test("T2V creates a project metadata relation instead of a fake shot input", () => {
  const copy = sliceBetween(renderer, "function syncDirectorAssetRelationCopy", "function renderDirectorShotAssetBindings");
  const projectData = sliceBetween(renderer, "function renderDirectorProjectDataBindings", "function syncDirectorAssetRelationCopy");
  const render = sliceBetween(renderer, "function renderDirectorShotAssetBindings", "const inFlightActionKeys");
  assert.match(copy, /if \(mode === "T2V"\) return false/u);
  assert.match(projectData, /targetKind:\s*"project"/u);
  assert.match(projectData, /targetId:\s*project\.projectId/u);
  assert.match(projectData, /仅项目资料，不参与 T2V 或其他工作流编译/u);
  assert.match(projectData, /不会建立镜头图片输入/u);
  assert.match(render, /if \(mode === "T2V"\)[\s\S]*shotAssetsSection\.hidden = true/u);
  assert.match(render, /T2V 没有图片输入；连续性参考请在独立的“项目资料”区域管理/u);
  assert.doesNotMatch(projectData + render, /directorMode\.value\s*=/u);
});

test("FL2VA and Ref2VA use explicit workflow-input actions and never auto-switch mode", () => {
  const copy = sliceBetween(renderer, "function syncDirectorAssetRelationCopy", "function renderDirectorShotAssetBindings");
  const render = sliceBetween(renderer, "function renderDirectorShotAssetBindings", "const inFlightActionKeys");
  assert.match(copy, /只有首镜头的首帧和末镜头的尾帧会真实进入 FL2VA 工作流/u);
  assert.match(copy, /主体、产品、场景、风格与连续性参考会真实接入当前单镜头 Ref2VA 工作流/u);
  assert.match(render, /preview\.status !== "executable"/u);
  assert.match(render, /targetKind:\s*"shot"/u);
  assert.match(render, /bind\.textContent = "接入工作流"/u);
  assert.match(render, /此镜头没有 FL2VA 图片输入位；不会创建伪绑定/u);
  assert.match(render, /当前认证 Ref2VA 只允许单镜头参考图；不会创建伪绑定/u);
  assert.doesNotMatch(copy + render, /directorMode\.value\s*=/u);
});

test("shot material rows request a real bounded preview by IDs and reject stale results", () => {
  const preview = sliceBetween(renderer, "function requestDirectorAssetPreview", "function sortedAssetRecords");
  const render = sliceBetween(renderer, "function renderDirectorShotAssetBindings", "const inFlightActionKeys");
  assert.match(preview, /getProjectAssetPreview\(\{ projectId, assetId \}\)/u);
  assert.doesNotMatch(preview, /path|filePath|absolutePath|sourcePath/u);
  assert.match(preview, /activeProjectActivationEpoch === activationEpoch/u);
  assert.match(preview, /directorProjectForAssetProjection\(\)\?\.projectId === projectId/u);
  assert.match(preview, /target\.isConnected/u);
  assert.match(preview, /result\.status === "ready" && result\.dataUrl !== null/u);
  assert.match(preview, /"failed" : "unavailable"/u);
  assert.match(render, /director-shot-asset-thumbnail/u);
  assert.match(render, /requestDirectorAssetPreview\(project\.projectId, asset\.assetId, asset\.displayName, thumbnail\)/u);
  assert.match(styles, /\.director-shot-asset-thumbnail\[data-preview-state="loading"\]::after/u);
  assert.match(styles, /\.director-shot-asset-thumbnail\[data-preview-state="unavailable"\]::after/u);
  assert.match(styles, /\.director-shot-asset-thumbnail\[data-preview-state="failed"\]::after/u);
});

test("the drawer uses neutral relation wording before mode-aware copy is rendered", () => {
  assert.match(html, /id="director-project-data-title">项目资料素材</u);
  assert.match(html, /data-director-asset-binding-host="project"/u);
  assert.match(html, /id="director-p1-shot-assets-title">镜头素材</u);
  assert.match(html, /id="director-p1-shot-assets-description"/u);
  assert.match(html, /data-director-drawer-tab="assets"[^>]*>镜头素材</u);
  assert.doesNotMatch(html, /id="director-shot-bind-asset"[^>]*>从项目素材库绑定</u);
});
