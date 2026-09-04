import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

test("entity asset association is explicitly project-only rather than a fake H3 input", async () => {
  const html = await readFile(resolve(root, "src/renderer/index.html"), "utf8");
  const start = html.indexOf('id="director-p1-entity-asset"');
  assert.notEqual(start, -1);
  const field = html.slice(Math.max(0, start - 220), start + 520);
  assert.match(field, /关联资料素材/u);
  assert.match(field, /项目资料关系 · 不进入当前 H3 工作流/u);
  assert.match(field, /镜头素材/u);
});

test("transition asset control cannot create an unsupported graph input but can clear legacy data", async () => {
  const html = await readFile(resolve(root, "src/renderer/index.html"), "utf8");
  const renderer = await readFile(resolve(root, "src/renderer/index.ts"), "utf8");
  const htmlStart = html.indexOf('for="director-shot-transition-asset"');
  assert.notEqual(htmlStart, -1);
  const field = html.slice(htmlStart, htmlStart + 720);
  assert.match(field, /旧版衔接素材记录/u);
  assert.match(field, /不接入额外素材/u);
  assert.match(field, /disabled/u);

  const start = renderer.indexOf("const hasLegacyTransitionAsset");
  const end = renderer.indexOf("directorShotTransitionState.textContent", start);
  assert.ok(start >= 0 && end > start);
  const projection = renderer.slice(start, end);
  assert.match(projection, /disabled = !hasLegacyTransitionAsset/u);
  assert.match(projection, /仅保留记录，请清除/u);
  assert.doesNotMatch(projection, /project\.assets\.filter/u);
});

test("mock installation copy does not falsely claim FFmpeg performs H3 segment assembly", async () => {
  const mock = await readFile(resolve(root, "src/main/services/mock.ts"), "utf8");
  const rowStart = mock.indexOf('id: "ffmpeg_long_video_optional"');
  assert.notEqual(rowStart, -1);
  const row = mock.slice(rowStart, rowStart + 700);
  assert.match(row, /本地媒体预检和视频封面/u);
  assert.match(row, /不参与 H3 采样或分段拼接/u);
  assert.doesNotMatch(row, /用于 30\/60 秒分段拼接/u);
});
