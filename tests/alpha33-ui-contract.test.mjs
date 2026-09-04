import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "..");
const read = (relativePath) => readFile(resolve(repositoryRoot, relativePath), "utf8");
const rendererRoot = "apps/control-plane/src/renderer";

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  assert.ok(end > start, `missing end marker after ${startMarker}: ${endMarker}`);
  return source.slice(start, end);
}

test("Alpha 33 exposes readable typography and stronger light-theme contrast tokens", async () => {
  const styles = await read(`${rendererRoot}/styles.css`);
  for (const token of [
    "--font-body: 14px",
    "--font-help: 13px",
    "--font-micro: 12px",
    "--text-secondary: #4f5965",
    "--border: #cfd5dd"
  ]) assert.ok(styles.includes(token), `missing Alpha 33 token ${token}`);
  assert.doesNotMatch(styles, /font-size:\s*(?:8|9|10|11)px/u);
  assert.match(styles, /\.page-heading p:not\(\.eyebrow\)[\s\S]*?font-size:\s*var\(--font-help\)/u);
});

test("Alpha 33 quick create keeps one primary action and a compact continuous first form", async () => {
  const [html, styles] = await Promise.all([
    read(`${rendererRoot}/index.html`),
    read(`${rendererRoot}/styles.css`)
  ]);
  const quick = sliceBetween(html, 'id="view-project"', 'id="view-director"');
  const heading = sliceBetween(quick, '<header class="page-heading page-heading--project">', '<div id="project-guard"');
  assert.equal((heading.match(/\bbutton--primary\b/gu) ?? []).length, 1);
  assert.ok(heading.indexOf('id="compile-button"') < heading.indexOf('id="plan-chip"'));
  assert.ok(heading.indexOf('id="plan-chip"') < heading.indexOf('id="project-convert-to-director"'));
  assert.match(quick, /class="surface project-section project-section--brief"/u);
  assert.match(quick, /id="project-prompt"[^>]*rows="5"/u);
  assert.match(styles, /#workflow-name\s*\{\s*max-width:\s*none/u);
  assert.match(styles, /#project-prompt\s*\{\s*min-height:\s*124px;\s*max-height:\s*260px/u);
});

test("Alpha 33 Director folds low-frequency settings and keeps context tools out of the primary row", async () => {
  const [html, styles] = await Promise.all([
    read(`${rendererRoot}/index.html`),
    read(`${rendererRoot}/styles.css`)
  ]);
  const director = sliceBetween(html, 'id="view-director"', 'id="view-assets"');
  const heading = sliceBetween(director, '<header class="page-heading page-heading--project director-heading">', '<div id="director-guard"');
  const more = sliceBetween(heading, '<details class="director-more-menu">', '</details>');
  assert.equal((heading.match(/\bbutton--primary\b/gu) ?? []).length, 1);
  assert.match(more, /id="director-history-button"[\s\S]*?id="director-shot-settings-compact"/u);
  assert.match(heading, /class="director-session-controls"[\s\S]*?id="director-undo-button"[\s\S]*?id="director-redo-button"/u);
  assert.match(director, /<details class="director-settings-disclosure">[\s\S]*?<section class="surface director-setup"/u);
  assert.match(director, /id="director-segment-summary"[^>]*>30 秒 · 6 段 × 5 秒/u);
  assert.ok(director.indexOf('class="director-settings-disclosure"') < director.indexOf('id="director-p1-shot-stage"'));
  assert.match(styles, /\.director-settings-disclosure:not\(\[open\]\) #director-segment-summary\s*\{[\s\S]*?position:\s*absolute/u);
  assert.match(styles, /\.director-quick-plan__body > \.director-plan-summary\s*\{[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent/u);
});

test("Alpha 33 asset library has one lean toolbar and an adaptive shared empty state", async () => {
  const [html, styles] = await Promise.all([
    read(`${rendererRoot}/index.html`),
    read(`${rendererRoot}/styles.css`)
  ]);
  const assets = sliceBetween(html, 'id="view-assets"', 'id="view-import"');
  const toolbar = sliceBetween(assets, '<section class="asset-toolbar asset-library-toolbar"', '</section>');
  const menu = sliceBetween(toolbar, '<details class="asset-library-menu">', '</details>');
  assert.doesNotMatch(assets, /asset-library-boundary/u);
  assert.match(assets, /id="asset-drop-zone"[\s\S]*?高级导入可引用外部原文件/u);
  assert.match(toolbar, /id="asset-search"[\s\S]*?id="asset-type-filter"[\s\S]*?id="asset-view-switcher"/u);
  assert.match(menu, /id="asset-sort"[\s\S]*?id="asset-refresh-button"[\s\S]*?id="asset-trash-button"/u);
  assert.match(assets, /id="asset-empty" class="[^"]*\bempty-state-shell\b/u);
  assert.match(styles, /\.asset-drop-zone\s*\{[\s\S]*?min-height:\s*54px/u);
  assert.match(styles, /\.asset-library-toolbar\s*\{[\s\S]*?grid-template-areas:\s*"search type view menu"/u);
});

test("Alpha 33 narrow navigation keeps visible short labels, stable names, and one utilities menu", async () => {
  const [html, styles, renderer] = await Promise.all([
    read(`${rendererRoot}/index.html`),
    read(`${rendererRoot}/styles.css`),
    read(`${rendererRoot}/index.ts`)
  ]);
  const navigation = sliceBetween(html, '<nav id="main-navigation"', '</nav>');
  const buttons = [...navigation.matchAll(/<button class="header-tab[^"]*"[^>]*>/gu)].map((match) => match[0]);
  assert.equal(buttons.length, 5);
  for (const button of buttons) {
    assert.match(button, /aria-label="[^"]+"/u);
    assert.match(button, /title="[^"]+"/u);
  }
  assert.match(html, /<details class="header-utilities">[\s\S]*?id="adapter-pill"[\s\S]*?id="theme-switcher"[\s\S]*?id="component-settings-button"/u);
  assert.match(styles, /@media \(max-width: 1100px\)[\s\S]*?\.header-utilities > summary[\s\S]*?display:\s*inline-flex/u);
  assert.match(styles, /\.header-utilities > summary > span\[aria-hidden="true"\]\s*\{\s*display:\s*none/u);
  assert.match(styles, /\.header-utilities > summary > span:last-child\s*\{\s*white-space:\s*nowrap/u);
  assert.match(renderer, /headerUtilitiesBreakpoint = window\.matchMedia\("\(max-width: 1100px\)"\)/u);
  assert.match(renderer, /headerUtilities\.open = !compact/u);
  assert.match(renderer, /headerUtilitiesBreakpoint\.addEventListener\("change", syncHeaderUtilitiesMode\)/u);
  const alpha33Narrow = styles.slice(styles.indexOf("/* Alpha 33"));
  assert.match(alpha33Narrow, /@media \(max-width: 760px\)[\s\S]*?\.tool-label\s*\{[^}]*display:\s*block/u);
  assert.match(alpha33Narrow, /@media \(max-width: 520px\)[\s\S]*?\.tool-label\s*\{[^}]*display:\s*block/u);
  assert.match(alpha33Narrow, /data-view-target="import"[\s\S]*?content:\s*"导入"/u);
});

test("Alpha 33 About co-locates update status/actions and compacts identity and boundaries", async () => {
  const html = await read(`${rendererRoot}/index.html`);
  const about = sliceBetween(html, 'id="view-about"', '</main>');
  const heading = sliceBetween(about, '<header class="page-heading">', '</header>');
  const update = sliceBetween(about, '<section class="surface about-update"', '</section>');
  assert.doesNotMatch(heading, /about-check-update/u);
  assert.match(update, /id="about-update-status"[\s\S]*?id="about-check-update"[\s\S]*?id="about-open-release"/u);
  assert.match(about, /class="surface about-identity"[\s\S]*?class="about-product"[\s\S]*?class="about-brand"/u);
  const boundary = sliceBetween(about, '<section class="surface about-boundary"', '</section>');
  assert.equal((boundary.match(/<li>/gu) ?? []).length, 3);
});

test("Alpha 33 import/install share bounded empty-state semantics without fake import controls", async () => {
  const [html, renderer] = await Promise.all([
    read(`${rendererRoot}/index.html`),
    read(`${rendererRoot}/index.ts`)
  ]);
  const install = sliceBetween(html, 'id="view-install"', 'id="view-home"');
  const importView = sliceBetween(html, 'id="view-import"', 'id="view-about"');
  const renderScan = sliceBetween(renderer, "function renderScan(", "function updateDownloadSummary(");
  assert.match(install, /id="setup-location-step" class="[^"]*\bempty-state-shell\b/u);
  assert.match(importView, /class="surface placeholder-page empty-state-shell"/u);
  assert.match(importView, /社区 H3 工作流导入正在规划中/u);
  assert.doesNotMatch(importView, /<(?:button|form|input|select|textarea)\b/iu);
  assert.doesNotMatch(renderScan, /scrollIntoView/u, "scan completion must not jump the user into the middle of setup");
});

test("Alpha 33 project center removes duplicated current/open surfaces and keeps management secondary", async () => {
  const html = await read(`${rendererRoot}/index.html`);
  const home = sliceBetween(html, 'id="view-home"', 'id="view-project"');
  for (const removedId of [
    "project-center-open",
    "current-project-title",
    "project-center-current-state",
    "project-center-current-summary",
    "project-center-current-id",
    "project-center-current-updated",
    "project-center-open-quick",
    "project-center-open-director",
    "project-center-open-assets"
  ]) assert.doesNotMatch(home, new RegExp(`id="${removedId}"`, "u"));
  assert.match(home, /<details class="surface data-root-panel"[\s\S]*?id="project-center-data-root"/u);
  assert.match(home, /<details class="surface project-center-maintenance"/u);
  assert.match(home, /id="project-center-recent-list"[\s\S]*?id="project-center-import-bundle"/u);
});

test("Alpha 33 restores persisted quick and Director frame labels from prepared selections", async () => {
  const renderer = await read(`${rendererRoot}/index.ts`);
  const restore = sliceBetween(
    renderer,
    "async function restoreProjectFrameSelections",
    "async function activateRelayProject"
  );
  const syncQuick = sliceBetween(renderer, "function syncFrameControls", "for (const input of projectForm");
  const clear = sliceBetween(renderer, "async function clearFrame", "firstFrameButton.addEventListener");
  assert.match(restore, /firstFrame\s*=\s*await window\.controlPlane\.prepareProjectAssetFrame/u);
  assert.match(restore, /lastFrame\s*=\s*await window\.controlPlane\.prepareProjectAssetFrame/u);
  assert.match(restore, /syncFrameControls\(\);[\s\S]*?syncDirectorFrames\(\);/u);
  assert.match(syncQuick, /firstFrameName\.textContent\s*=\s*firstFrame\?\.displayName\s*\?\?\s*"未选择文件"/u);
  assert.match(syncQuick, /lastFrameName\.textContent\s*=\s*lastFrame\?\.displayName\s*\?\?\s*"未选择文件"/u);
  assert.match(clear, /syncDirectorFrames\(\);/u, "clearing a frame must also refresh the Director labels");
});
