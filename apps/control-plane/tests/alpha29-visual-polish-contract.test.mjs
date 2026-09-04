import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const read = (relative) => readFile(resolve(root, relative), "utf8");

test("narrow navigation retains stable accessible names when visual labels collapse", async () => {
  const html = await read("src/renderer/index.html");
  const navigation = html.match(/<nav id="main-navigation"[\s\S]*?<\/nav>/u)?.[0] ?? "";
  const buttons = [...navigation.matchAll(/<button class="header-tab[^>]*>/gu)].map((match) => match[0]);

  assert.equal(buttons.length, 6);
  for (const button of buttons) assert.match(button, /aria-label="[^"]+"/u);
  assert.match(navigation, /data-view-target="assets" aria-label="项目素材库"[\s\S]*?<span class="tool-label">素材库<\/span>/u);
  assert.match(navigation, /data-view-target="generated" aria-label="当前项目已生成视频"[\s\S]*?<span class="tool-label">视频成品<\/span>/u);
});

test("asset toolbar, recoverable deletion and overlay detail drawer have deterministic responsive contracts", async () => {
  const [css, source] = await Promise.all([
    read("src/renderer/styles.css"),
    read("src/renderer/index.ts")
  ]);

  assert.match(css, /grid-template-areas: "search type sort refresh trash view"/u);
  assert.match(css, /\.asset-library-toolbar #asset-refresh-button[^}]*grid-area: refresh[^}]*width: auto[^}]*justify-self: start/su);
  assert.match(css, /\.asset-library-toolbar #asset-trash-button[^}]*grid-area: trash[^}]*width: auto[^}]*justify-self: start/su);
  assert.match(css, /\.workspace-drawer-layer\s*\{[\s\S]*?position: fixed[\s\S]*?grid-template-columns: minmax\(0, 1fr\) minmax\(520px, 620px\)/u);
  assert.match(css, /\.workspace-drawer-layer\[hidden\] \{ display: none !important; \}/u);
  assert.match(css, /\.asset-library-status\.is-idle[\s\S]*?clip: rect\(0, 0, 0, 0\)/u);
  assert.match(source, /classList\.toggle\("is-idle", !busy && snapshot\.phase !== "error"\)/u);
});

test("about and managed install paths collapse safely before narrow phone widths", async () => {
  const css = await read("src/renderer/styles.css");
  const tablet = css.match(/@media \(max-width: 1050px\) \{[\s\S]*?(?=\n@media \(max-width: 760px\))/u)?.[0] ?? "";

  assert.match(tablet, /\.about-layout \{ grid-template-columns: 1fr; \}/u);
  assert.match(css, /\.managed-tree code[^}]*overflow-wrap: anywhere[^}]*word-break: break-word/su);
  assert.match(css, /\.component-title-row strong \{ font-size: 13px; line-height: 1\.4; \}/u);
});
