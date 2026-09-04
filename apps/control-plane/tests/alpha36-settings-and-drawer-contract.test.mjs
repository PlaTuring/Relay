import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [html, styles] = await Promise.all([
  readFile(resolve(root, "src/renderer/index.html"), "utf8"),
  readFile(resolve(root, "src/renderer/styles.css"), "utf8")
]);

test("Alpha 36 removes the marked static helper copy without weakening real validation", () => {
  for (const removed of [
    "无需输入 <code>.json</code>",
    "用于 JSON 文件名和 ComfyUI 工作流标签。",
    "Ref2VA 当前认证范围仅包含参考图片与官方字段格式。",
    "只在固定模式中编辑。",
    "按需调整，不阻挡镜头工作区",
    "Relay 只保存制作数据、编译并交接工作流",
    "结构时间线 · 不是视频预览",
    "Relay 只检查结构与时长，不代写、翻译或扩写内容。"
  ]) {
    assert.equal(html.includes(removed), false, `marked helper copy remains: ${removed}`);
  }
  assert.match(html, /id="workflow-name-error"[^>]*role="alert"/u);
  assert.match(html, /id="prompt-error"[^>]*role="alert"/u);
  assert.match(html, /id="prompt-format-note"[^>]*>按所选模式填写官方字段；多段提示词需标明每个镜头时间点。/u);
  assert.doesNotMatch(html, /id="director-mode"[^>]*aria-describedby="director-mode-note"/u);
});

test("Alpha 36 Director settings compact the output card and stretch paired rows equally", () => {
  assert.match(styles, /grid-template-areas:\s*"name mode"\s*"timing output"/u);
  assert.match(styles, /\.director-toolbar-name\s*\{\s*grid-area:\s*name/u);
  assert.match(styles, /\[data-director-toolbar-group="timing"\]\s*\{\s*grid-area:\s*timing/u);
  assert.match(styles, /\[data-director-toolbar-group="output"\]\s*\{\s*grid-area:\s*output/u);
  assert.match(styles, /\.director-toolbar-grid\s*\{[\s\S]*?align-items:\s*stretch/u);
  assert.match(styles, /\[data-director-toolbar-group="output"\]\s*>\s*\.field\s*\{[\s\S]*?grid-template-rows:\s*auto auto/u);
  assert.match(styles, /\[data-director-toolbar-group="output"\][\s\S]*?>\s*\.field\s*>\s*:is\(input, select\)[\s\S]*?height:\s*var\(--control-height-compact\)/u);
});

test("Alpha 36 uses an inset floating work panel and a single-line tab rail", () => {
  assert.match(styles, /\.director-workspace-drawer\s*\{[^}]*width:\s*clamp\(480px, 42vw, 580px\)/u);
  assert.match(styles, /\.director-workspace-drawer\s*\{[^}]*border-radius:\s*12px/u);
  assert.match(styles, /\.director-workspace-drawer\s*\{[^}]*animation:\s*director-drawer-in/u);
  assert.match(styles, /\.director-drawer-tabs\s*\{[^}]*flex-wrap:\s*nowrap[^}]*overflow-x:\s*auto/u);
  assert.match(styles, /@media \(max-width:\s*699px\)[\s\S]*?\.director-workspace-drawer\s*\{[\s\S]*?width:\s*100%/u);
});
