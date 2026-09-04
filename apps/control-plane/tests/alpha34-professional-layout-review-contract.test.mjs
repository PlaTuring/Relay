import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const read = (relative) => readFile(resolve(root, relative), "utf8");

test("three independent professional layout reviews and the Root dedupe remain auditable", async () => {
  const dedupe = await read("../../docs/reviews/ALPHA33_PROFESSIONAL_LAYOUT_REVIEW_SUMMARY.md");
  for (const task of ["alpha33_visual_blind", "alpha33_ux_blind", "alpha33_responsive_blind"]) {
    assert.ok(dedupe.includes(task), `missing independent review ${task}`);
  }
  assert.match(dedupe, /采纳|部分采纳|拒绝/u);
});

test("page-scoped feedback and modal drawers cannot leak stale state or background focus", async () => {
  const renderer = await read("src/renderer/index.ts");
  assert.match(renderer, /function setToastView[\s\S]*?hideToast/u);
  assert.match(renderer, /function showView[\s\S]*?setToastView\(requestedView\)/u);
  assert.match(renderer, /function setModalIsolation[\s\S]*?\.app-header, \.tool-sidebar[\s\S]*?setAttribute\("inert", ""\)/u);
  assert.match(renderer, /function modalFocusableElements[\s\S]*?summary[\s\S]*?contenteditable/u);
  assert.match(renderer, /function openDirectorDrawer[\s\S]*?setModalIsolation\(directorDrawerLayer, true\)/u);
  assert.match(renderer, /function openAssetDetailDrawer[\s\S]*?setModalIsolation\(assetDetailLayer, true\)/u);
});

test("zero-download reuse has truthful language and managed storage appears only for downloads", async () => {
  const renderer = await read("src/renderer/index.ts");
  const language = renderer.match(/function syncInstallationPlanLanguage[\s\S]*?(?=\nfunction updateDownloadSummary)/u)?.[0] ?? "";
  assert.match(language, /managedRootSection\.hidden = !requiresDownload/u);
  assert.match(language, /下载与复用计划[\s\S]*?下载并配置所选组件/u);
  assert.match(language, /复用本机环境[\s\S]*?校验并使用此环境/u);
  assert.match(language, /本机环境已准备[\s\S]*?使用此环境并继续/u);
});

test("empty asset library, about order, path disclosure, and navigation labels follow the converged IA", async () => {
  const [html, renderer, styles] = await Promise.all([
    read("src/renderer/index.html"),
    read("src/renderer/index.ts"),
    read("src/renderer/styles.css")
  ]);
  assert.match(html, /id="asset-library-toolbar"[^>]*hidden/u);
  assert.match(renderer, /assetLibraryToolbar\.hidden = snapshot\.total === 0/u);
  const product = html.indexOf("about-product");
  const boundary = html.indexOf("about-boundary");
  const update = html.indexOf("about-update");
  assert.ok(product >= 0 && product < boundary && boundary < update);
  const productCard = html.slice(product, boundary);
  assert.match(productCard, /about-product__summary[\s\S]*?about-product__profile/u);
  assert.match(productCard, /src="\.\/assets\/platuring-avatar\.png"[^>]*alt="柏拉图灵标识"/u);
  assert.match(productCard, /独立开发者[\s\S]*?id="about-author-state">柏拉图灵 \| PlaTuring<\/span>[\s\S]*?抖音 \/ B站：柏拉图灵/u);
  assert.match(productCard, /<dt>项目仓库<\/dt>/u);
  assert.doesNotMatch(productCard, /<dt>(?:GitHub|开发者)<\/dt>|id="about-developer-name"/u);
  assert.doesNotMatch(html, /class="[^"]*\bsurface\s+about-brand\b/u);
  assert.doesNotMatch(html, /about-identity/u);
  assert.match(html, /data-view-target="generated"[^>]*aria-label="当前项目已生成视频"[\s\S]*?data-view-target="upscale"[^>]*aria-label="画质超分"/u);
  assert.match(
    html,
    /id="existing-environment-reuse"[\s\S]*?aria-label="选择要只读复用的现有 ComfyUI 根目录"[\s\S]*?aria-label="选择要校验并复用的现有 H3 模型目录"/u
  );
  assert.match(styles, /\.data-root-panel__path code:focus-visible[\s\S]*?white-space:\s*normal/u);
  assert.doesNotMatch(html, /权威工作流/u);
});

test("theme borders and Director responsive hierarchy retain visible controls", async () => {
  const styles = await read("src/renderer/styles.css");
  assert.ok(styles.includes("--border-strong: #687280"));
  assert.ok(styles.includes("--border-strong: #8793a1"));
  assert.match(styles, /@media \(max-width: 1439px\)[\s\S]*?\.director-current-shot-summary__facts\s*\{\s*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/u);
  const baseToolLabel = styles.match(/\.tool-label\s*\{[^}]*\}/u)?.[0] ?? "";
  assert.match(baseToolLabel, /white-space:\s*nowrap/u);
  assert.match(baseToolLabel, /word-break:\s*keep-all/u);
  const narrowNavigation = styles.slice(styles.indexOf("@media (max-width: 520px)"));
  assert.match(narrowNavigation, /\.tool-label\s*\{\s*display:\s*none/u);
  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*?\.generated-video-list\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/u);
});

test("desktop navigation labels stay on one line and all page primary actions finish at the right edge", async () => {
  const styles = await read("src/renderer/styles.css");
  const toolLabel = styles.match(/\.tool-label\s*\{[\s\S]*?\}/u)?.[0] ?? "";
  const projectCenterAction = styles.match(/\.page-heading--project-center > \.button\s*\{[\s\S]*?\}/u)?.[0] ?? "";
  const quickAction = styles.match(/\.project-heading-actions--quick #compile-button\s*\{[^}]*order:\s*4[^}]*\}/u)?.[0] ?? "";
  const directorAction = styles.match(/\.director-heading-actions > #director-compile-button\s*\{[^}]*width:\s*auto[^}]*margin-left:\s*auto[^}]*\}/u)?.[0] ?? "";

  assert.match(toolLabel, /white-space:\s*nowrap/u);
  assert.match(toolLabel, /word-break:\s*keep-all/u);
  assert.doesNotMatch(toolLabel, /text-wrap:\s*balance/u);
  assert.match(projectCenterAction, /margin-left:\s*auto/u);
  assert.match(projectCenterAction, /justify-self:\s*end/u);
  assert.match(quickAction, /order:\s*4/u);
  assert.match(quickAction, /width:\s*auto/u);
  assert.match(quickAction, /min-width:\s*0/u);
  assert.match(directorAction, /margin-left:\s*auto/u);
  assert.match(directorAction, /width:\s*auto/u);
  assert.match(directorAction, /min-width:\s*0/u);

  assert.match(styles, /@media \(min-width: 960px\)[\s\S]*?\.page-heading--project-center,[\s\S]*?\.page-heading--project,[\s\S]*?\.director-heading\s*\{[\s\S]*?grid-template-columns:\s*minmax\(260px, 1fr\) auto/u);
  assert.match(styles, /@media \(min-width: 960px\)[\s\S]*?\.project-heading-actions--quick,[\s\S]*?\.director-heading-actions\s*\{[\s\S]*?justify-self:\s*end[\s\S]*?flex-wrap:\s*nowrap/u);
  assert.doesNotMatch(styles, /@media \(max-width: 1300px\)\s*\{\s*\.director-heading\s*\{[^}]*display:\s*grid/u);

  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*?\.project-heading-actions--quick #compile-button\s*\{\s*width:\s*100%/u);
  assert.match(styles, /@media \(max-width: 959px\)[\s\S]*?\.director-heading-actions > #director-compile-button\s*\{[\s\S]*?width:\s*100%/u);
});
