import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

function functionBlock(source, name, nextName) {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(`function ${nextName}`, start + 1);
  assert.ok(start >= 0, `${name} must exist`);
  assert.ok(end > start, `${nextName} must follow ${name}`);
  return source.slice(start, end);
}

test("asset usage presentation includes current quick slots and live project bindings", async () => {
  const source = await readFile(resolve(root, "src/renderer/index.ts"), "utf8");
  const quick = functionBlock(source, "quickProjectAssetReferences", "projectAssetReferencePresentation");
  assert.match(quick, /project\.quick\.mode === "T2V"/u);
  assert.match(quick, /project\.quick\.firstFrameAssetId === assetId/u);
  assert.match(quick, /project\.quick\.lastFrameAssetId === assetId/u);
  assert.match(quick, /project\.quick\.referenceAssetIds\.forEach/u);
  assert.match(quick, /project\.quick\.mode === "REF2VA" \? "参考素材" : "首帧"/u);

  const liveBindings = functionBlock(source, "currentProjectBindings", "quickProjectAssetReferences");
  assert.match(liveBindings, /projectView\?\.bindings/u);
  assert.match(liveBindings, /activeRelayProject\?\.bindings/u);
  assert.match(liveBindings, /binding\.assetId === assetId/u);

  const detail = functionBlock(source, "renderAssetDetail", "renderAssetLibrary");
  assert.match(detail, /projectAssetReferencePresentation\(asset\.assetId, projectView\)/u);
  assert.match(detail, /assetDetailUsageCount\.textContent = String\(references\.length\)/u);
  assert.match(detail, /assetBindingCount\.textContent = `\$\{references\.length\} 处`/u);
  assert.doesNotMatch(detail, /projectView\?\.usageCount/u);
});

test("asset preflight is rendered as structured media facts instead of truncated JSON", async () => {
  const source = await readFile(resolve(root, "src/renderer/index.ts"), "utf8");
  const facts = functionBlock(source, "assetInspectionFacts", "assetInspectionIssues");
  for (const expected of [
    "像素尺寸",
    "透明通道",
    "方向标记",
    "画面尺寸",
    "帧率",
    "视频编码",
    "像素格式",
    "音轨",
    "音频编码",
    "声道",
    "采样率",
    "检查时间"
  ]) assert.match(facts, new RegExp(expected, "u"));

  const renderFacts = functionBlock(source, "renderAssetTechnicalFacts", "currentProjectBindings");
  assert.match(renderFacts, /document\.createElement\("dl"\)/u);
  assert.match(renderFacts, /asset-technical-facts/u);
  assert.match(renderFacts, /asset-technical-fact--issues/u);
  assert.doesNotMatch(renderFacts, /JSON\.stringify|slice\(0, 240\)/u);

  const detail = functionBlock(source, "renderAssetDetail", "renderAssetLibrary");
  assert.match(detail, /renderAssetTechnicalFacts\(inspection \?\? null, asset\.mediaType\)/u);
  assert.doesNotMatch(detail, /JSON\.stringify|slice\(0, 240\)/u);
});

test("asset technical layout wraps hashes and collapses safely on narrow windows", async () => {
  const styles = await readFile(resolve(root, "src/renderer/styles.css"), "utf8");
  assert.match(styles, /\.asset-detail-summary__hash dd[\s\S]*?word-break:\s*break-all/u);
  assert.match(styles, /\.asset-detail-summary__technical[\s\S]*?grid-column:\s*1 \/ -1/u);
  assert.match(styles, /\.asset-technical-facts[\s\S]*?repeat\(auto-fit, minmax\(130px, 1fr\)\)/u);
  assert.match(styles, /\.asset-technical-fact--issues[\s\S]*?grid-column:\s*1 \/ -1/u);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*?\.asset-detail-summary__technical,[\s\S]*?\.asset-detail-summary__usage \{ grid-column: 1; grid-row: auto; \}/u);
});
