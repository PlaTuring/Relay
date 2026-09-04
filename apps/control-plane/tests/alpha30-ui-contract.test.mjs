import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const [html, styles, renderer] = await Promise.all([
  readFile(resolve(root, "src/renderer/index.html"), "utf8"),
  readFile(resolve(root, "src/renderer/styles.css"), "utf8"),
  readFile(resolve(root, "src/renderer/index.ts"), "utf8")
]);

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  assert.ok(end > start, `missing end marker after ${startMarker}: ${endMarker}`);
  return source.slice(start, end);
}

function blocksAfter(source, marker) {
  const blocks = [];
  let searchFrom = 0;
  while (searchFrom < source.length) {
    const markerIndex = source.indexOf(marker, searchFrom);
    if (markerIndex === -1) break;
    const openingBrace = source.indexOf("{", markerIndex);
    assert.notEqual(openingBrace, -1, `missing opening brace after: ${marker}`);

    let depth = 0;
    for (let index = openingBrace; index < source.length; index += 1) {
      if (source[index] === "{") depth += 1;
      if (source[index] === "}") depth -= 1;
      if (depth === 0) {
        blocks.push(source.slice(openingBrace + 1, index));
        searchFrom = index + 1;
        break;
      }
    }
    assert.ok(searchFrom > openingBrace, `missing closing brace after: ${marker}`);
  }
  assert.ok(blocks.length > 0, `missing CSS marker: ${marker}`);
  return blocks;
}

function blockMatching(source, marker, pattern) {
  const block = blocksAfter(source, marker).find((candidate) => pattern.test(candidate));
  assert.ok(block, `no ${marker} block matches ${pattern}`);
  return block;
}

function optionValues(selectMarkup) {
  return [...selectMarkup.matchAll(/<option\b[^>]*value="([^"]+)"[^>]*>/gu)].map((match) => match[1]);
}

test("Alpha 30 quick creation has one real compile button in the page heading and no bottom primary panel", () => {
  const quickView = sliceBetween(
    html,
    '<section class="view" id="view-project"',
    '<section class="view" id="view-director"'
  );
  const heading = sliceBetween(quickView, '<header class="page-heading page-heading--project"', '<div id="project-guard"');
  const primaryButtons = [...quickView.matchAll(/<button\b[^>]*class="[^"]*\bbutton--primary\b[^"]*"[^>]*>/gu)];

  assert.equal(primaryButtons.length, 1);
  assert.match(primaryButtons[0][0], /id="compile-button"[^>]*type="submit"[^>]*form="project-form"/u);
  assert.match(heading, /id="compile-button"/u);
  assert.doesNotMatch(quickView, /class="[^"]*\bproject-submit\b|id="project-submit"|交接到 ComfyUI/u);
  assert.equal((renderer.match(/projectForm\.addEventListener\("submit"/gu) ?? []).length, 1);
});

test("Alpha 30 unified segmentation plan is a permanent static region with its live summary", () => {
  const setup = sliceBetween(
    html,
    '<section class="surface director-setup"',
    '<div class="director-production-grid director-studio-workspace"'
  );
  const plan = sliceBetween(
    html,
    '<section id="director-p1-quick-plan"',
    '<div class="director-toolbar-cluster" data-director-toolbar-group="output"'
  );

  assert.match(plan, /<section id="director-p1-quick-plan"/u);
  assert.match(plan, /id="director-quick-plan-title">统一分段计划/u);
  assert.match(plan, /id="director-total-duration"/u);
  assert.match(plan, /id="director-segment-duration"/u);
  assert.match(plan, /id="director-segment-summary"[^>]*>30 秒 · 6 段 × 5 秒</u);
  assert.doesNotMatch(plan, /<details|<summary|aria-expanded/u);
  assert.match(setup, /<header class="director-toolbar-heading">/u);
  assert.doesNotMatch(setup, /<details|<summary|aria-expanded/u);
});

test("Alpha 30 uses one overlay drawer for checks, prompt preview, and all contextual shot editors", () => {
  const directorView = sliceBetween(
    html,
    '<section class="view" id="view-director"',
    '<section class="view" id="view-assets"'
  );
  const stage = sliceBetween(directorView, 'id="director-p1-shot-stage"', 'id="director-current-shot-summary"');
  const drawer = sliceBetween(
    html,
    '<div id="director-workspace-drawer-layer"',
    '<section class="view" id="view-assets"'
  );
  const mount = sliceBetween(renderer, "function mountDirectorShotToolsInDrawer", "function setDirectorDrawerTab");
  const open = sliceBetween(renderer, "function openDirectorDrawer", "function closeDirectorDrawer");

  assert.equal((directorView.match(/id="director-workspace-drawer"/gu) ?? []).length, 1);
  assert.equal((directorView.match(/id="director-workspace-drawer-layer"/gu) ?? []).length, 1);
  assert.match(drawer, /id="director-workspace-drawer"[^>]*role="dialog"/u);
  assert.match(drawer, /id="director-workspace-drawer"[^>]*aria-modal="true"/u);
  assert.match(drawer, /data-director-drawer-tab="issues"[^>]*>问题列表/u);
  assert.match(drawer, /data-director-drawer-tab="prompt"[^>]*>提示词预览/u);
  for (const tab of ["details", "assets", "transition", "takes"]) {
    assert.match(drawer, new RegExp(`data-director-drawer-tab="${tab}"`, "u"));
  }
  assert.match(drawer, /id="director-validation"[^>]*role="status"/u);
  assert.match(drawer, /id="director-prompt-preview"/u);
  assert.match(drawer, /id="director-drawer-shot-host"/u);
  assert.doesNotMatch(stage, /id="director-validation"|id="director-prompt-preview"|compile-inspector/u);
  assert.match(mount, /body\.replaceChildren\(details, assets, transition, takes\)/u);
  assert.match(mount, /directorDrawerShotHost\.append\(directorCurrentShotTools\)/u);
  assert.match(open, /directorDrawerLayer\.hidden = false/u);
  assert.match(renderer, /event\.key !== "Tab" \|\| directorDrawerLayer\.hidden/u);
  assert.match(renderer, /directorDrawer\.querySelectorAll<HTMLElement>/u);
  assert.doesNotMatch(open, /classList\.(?:add|toggle)\([^\n]*(?:director-studio-workspace|page-container)/u);

  assert.match(styles, /\.director-drawer-layer\s*\{[\s\S]*?position:\s*fixed/u);
  assert.match(styles, /grid-template-columns:\s*minmax\(0, 1fr\) auto/u);
  assert.match(styles, /width:\s*clamp\(480px, 42vw, 580px\)/u);
  assert.match(styles, /border-radius:\s*12px/u);
  assert.match(styles, /\.director-drawer__scroller\s*\{[\s\S]*?overflow-x:\s*hidden/u);
});

test("Alpha 30 heading exposes compact check and details entrances wired to that same drawer", () => {
  const directorHeading = sliceBetween(
    html,
    '<header class="page-heading page-heading--project director-heading">',
    '<div id="director-guard"'
  );
  const summary = sliceBetween(
    html,
    '<aside id="director-current-shot-summary"',
    '<section id="director-p1-current-shot-tools"'
  );

  assert.match(directorHeading, /id="director-check-button"[^>]*aria-controls="director-workspace-drawer"/u);
  assert.match(directorHeading, /id="director-shot-settings-compact"[^>]*aria-controls="director-workspace-drawer"/u);
  assert.match(summary, /id="director-shot-settings-button"[^>]*aria-controls="director-workspace-drawer"/u);
  assert.match(renderer, /directorCheckButton\.addEventListener\("click",\s*\(\) => openDirectorDrawer\("issues"/u);
  assert.match(renderer, /directorShotSettingsButton\.addEventListener\("click",\s*\(\) => openDirectorDrawer\("details"/u);
  assert.match(renderer, /directorShotSettingsCompact\.addEventListener\("click",\s*\(\) => openDirectorDrawer\("details"/u);
});

test("Relay 1.0 responsive Director contract matches desktop, tablet, and narrow layouts", () => {
  const desktop = blockMatching(
    styles,
    ".director-studio-workspace {",
    /grid-template-columns:\s*minmax\(0, 1fr\) 300px/u
  );
  const tablet = blockMatching(
    styles,
    "@media (max-width: 1439px)",
    /\.director-studio-workspace\s*\{/u
  );
  const tabletHeading = blockMatching(
    styles,
    "@media (max-width: 959px)",
    /\.director-current-shot-summary\s*\{\s*display:\s*grid/u
  );
  const tabletDrawer = blockMatching(
    styles,
    "@media (max-width: 959px)",
    /\.director-workspace-drawer\s*\{/u
  );
  const phoneDrawer = blockMatching(
    styles,
    "@media (max-width: 699px)",
    /\.director-workspace-drawer\s*\{/u
  );
  const narrow = blockMatching(
    styles,
    "@media (max-width: 620px)",
    /\.director-current-shot-summary\s*\{\s*display:\s*none/u
  );

  assert.match(desktop, /grid-template-columns:\s*minmax\(0, 1fr\) 300px/u);
  assert.match(tablet, /\.director-studio-workspace\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/u);
  assert.match(tablet, /\.director-current-shot-summary__facts\s*\{\s*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/u);
  assert.match(tabletHeading, /\.director-heading-actions\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) auto/u);
  assert.match(tabletHeading, /\.director-current-shot-summary\s*\{\s*display:\s*grid/u);
  assert.match(narrow, /\.director-current-shot-summary\s*\{\s*display:\s*none/u);
  assert.match(tabletDrawer, /\.director-drawer-layer\s*\{[\s\S]*?left:\s*0/u);
  assert.match(tabletDrawer, /\.director-workspace-drawer\s*\{[\s\S]*?width:\s*min\(560px, calc\(100vw - 16px\)\)/u);
  assert.match(phoneDrawer, /\.director-workspace-drawer\s*\{[\s\S]*?width:\s*100%/u);
});

test("Quick and Director expose the same seed policies but capture their values independently", () => {
  const quickPolicy = sliceBetween(html, '<select id="seed-policy"', "</select>");
  const directorPolicy = sliceBetween(html, '<select id="director-seed-policy"', "</select>");
  const quickSync = sliceBetween(renderer, "function syncQuickSeedPolicyControls", "function syncDirectorSeedPolicyControls");
  const directorSync = sliceBetween(renderer, "function syncDirectorSeedPolicyControls", "function setQuickFormFromProject");
  const quickPersistence = sliceBetween(renderer, "function projectWithQuickForm", "let activeProjectRevision");
  const directorCapture = sliceBetween(renderer, "function captureDirectorCompilation", "function markDirectorCompiled");

  assert.deepEqual(optionValues(quickPolicy), ["random_per_compile", "fixed"]);
  assert.deepEqual(optionValues(directorPolicy), ["random_per_compile", "fixed"]);
  assert.match(quickPolicy, /value="random_per_compile" selected/u);
  assert.match(directorPolicy, /value="random_per_compile" selected/u);
  assert.match(html, /id="project-seed"[^>]*disabled/u);
  assert.match(html, /id="director-seed"[^>]*disabled/u);
  assert.match(quickSync, /seedPolicy\.value === "fixed"[\s\S]*?projectSeed\.disabled = !fixed/u);
  assert.match(directorSync, /directorSeedPolicy\.value === "fixed"[\s\S]*?directorSeed\.disabled = !fixed/u);
  assert.match(renderer, /seedPolicy\.addEventListener\("change"[\s\S]*?syncQuickSeedPolicyControls\(\)/u);
  assert.match(renderer, /directorSeedPolicy\.addEventListener\("change"[\s\S]*?syncDirectorSeedPolicyControls\(\)/u);
  assert.match(quickPersistence, /seedPolicy:\s*seedPolicy\.value as SeedPolicy/u);
  assert.match(renderer, /directorSeedPolicy\.value = project\.quick\.seedPolicy/u);
  assert.match(directorCapture, /seedPolicy:\s*directorSeedPolicy\.value as SeedPolicy/u);
  assert.doesNotMatch(directorCapture, /projectSeed|seedPolicy\.value\s*=/u);
  assert.doesNotMatch(renderer, /seedPolicy\.value\s*=\s*"fixed"|directorSeedPolicy\.value\s*=\s*"fixed"|randomize/u);
});
