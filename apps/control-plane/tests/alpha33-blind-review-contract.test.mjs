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

function view(name, nextName) {
  return sliceBetween(
    html,
    `<section class="view" id="view-${name}"`,
    `<section class="view" id="view-${nextName}"`
  );
}

function pageHeading(markup) {
  return sliceBetween(markup, '<header class="page-heading', "</header>");
}

function primaryButtonTags(markup) {
  return [...markup.matchAll(/<button\b[^>]*class="[^"]*\bbutton--primary\b[^"]*"[^>]*>/gu)]
    .map((match) => match[0]);
}

function openingTagById(markup, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return markup.match(new RegExp(`<[^>]+\\bid="${escaped}"[^>]*>`, "u"))?.[0] ?? "";
}

function sectionContaining(markup, marker) {
  const markerPosition = markup.indexOf(marker);
  assert.notEqual(markerPosition, -1, `missing section marker: ${marker}`);
  const start = markup.lastIndexOf("<section", markerPosition);
  const end = markup.indexOf("</section>", markerPosition);
  assert.ok(start >= 0 && end > markerPosition, `missing section around: ${marker}`);
  return markup.slice(start, end);
}

function classesFromTag(tag) {
  return new Set((tag.match(/\bclass="([^"]*)"/u)?.[1] ?? "").split(/\s+/u).filter(Boolean));
}

test("Alpha 33 visible text has a 12px floor", () => {
  const pixelSizes = [...styles.matchAll(/font-size:\s*([0-9.]+)px/gu)]
    .map((match) => Number(match[1]));
  const undersized = [...new Set(pixelSizes.filter((size) => size > 0 && size < 12))];
  const fontTokens = [...styles.matchAll(/--font-[\w-]+:\s*([0-9.]+)px/gu)]
    .map((match) => Number(match[1]));
  const undersizedTokens = [...new Set(fontTokens.filter((size) => size > 0 && size < 12))];

  assert.deepEqual(undersized, [], `found visible font sizes below 12px: ${undersized.join(", ")}`);
  assert.deepEqual(undersizedTokens, [], `found font tokens below 12px: ${undersizedTokens.join(", ")}`);
});

test("Alpha 33 business PageHeaders expose exactly one primary action", () => {
  const pages = [
    ["home", "project", "project-center-create"],
    ["project", "director", "compile-button"],
    ["director", "assets", "director-compile-button"],
    ["assets", "generated", "asset-import-button"]
  ];

  for (const [name, nextName, expectedId] of pages) {
    const heading = pageHeading(view(name, nextName));
    const primary = primaryButtonTags(heading);
    assert.equal(primary.length, 1, `${name} PageHeader must contain one primary action`);
    assert.match(primary[0], new RegExp(`\\bid="${expectedId}"`, "u"));
  }
});

test("Alpha 33 quick creation keeps essential first-screen fields before optional settings", () => {
  const quick = view("project", "director");
  const requiredOrder = [
    'id="project-form"',
    'id="workflow-name"',
    'id="project-prompt"',
    'id="mode-title"',
    'id="output-settings"',
    'id="advanced-options"'
  ];
  const positions = requiredOrder.map((marker) => {
    const position = quick.indexOf(marker);
    assert.notEqual(position, -1, `quick creation is missing ${marker}`);
    return position;
  });

  assert.deepEqual(positions, [...positions].sort((left, right) => left - right));
  const firstSurface = sectionContaining(quick, 'aria-labelledby="workflow-name-title"');
  assert.match(firstSurface, /id="workflow-name"[\s\S]*?id="project-prompt"/u);
  assert.match(quick, /<details\b[^>]*id="advanced-options"/u);
  assert.doesNotMatch(quick, /class="[^"]*\bproject-submit\b|id="project-submit"/u);
});

test("Alpha 33 Director folds low-frequency session actions and keeps one direct primary", () => {
  const director = view("director", "assets");
  const heading = pageHeading(director);
  const lowFrequency = heading.match(/<details\b(?![^>]*\bopen\b)[^>]*>[\s\S]*?id="director-history-button"[\s\S]*?id="director-shot-settings-compact"[\s\S]*?<\/details>/u)?.[0] ?? "";

  assert.notEqual(lowFrequency, "", "history and contextual tools must live in one default-collapsed disclosure");
  for (const [id, label] of [["director-undo-button", "撤销上一步"], ["director-redo-button", "重做下一步"]]) {
    const compactButton = heading.match(new RegExp(`<button\\b[^>]*id="${id}"[^>]*>[\\s\\S]*?<\\/button>`, "u"))?.[0] ?? "";
    assert.match(compactButton, /class="[^"]*\bdirector-icon-button\b/u);
    assert.match(compactButton, new RegExp(`aria-label="${label}"`, "u"));
    assert.doesNotMatch(compactButton.replace(/<button\b[^>]*>/u, ""), /撤销|重做/u, `${id} must remain icon-only in the heading`);
  }
  assert.match(heading, /id="director-check-button"[^>]*aria-controls="director-workspace-drawer"/u);
  assert.equal(primaryButtonTags(heading).length, 1);
  assert.match(primaryButtonTags(heading)[0], /id="director-compile-button"/u);
});

test("Alpha 33 asset library distinguishes primary import, discovery, and folded management", () => {
  const assets = view("assets", "generated");
  const heading = pageHeading(assets);
  const toolbarPosition = assets.indexOf("asset-library-toolbar");
  const listPosition = assets.indexOf('id="asset-list"');
  const foldedManagement = /<details\b(?![^>]*\bopen\b)[^>]*>[\s\S]*?id="asset-sort"[\s\S]*?id="asset-refresh-button"[\s\S]*?id="asset-trash-button"[\s\S]*?<\/details>/u.test(assets);

  assert.match(heading, /id="asset-import-button"/u);
  assert.equal(primaryButtonTags(heading).length, 1);
  assert.ok(toolbarPosition >= 0 && listPosition > toolbarPosition, "search/filter toolbar must precede the asset collection");
  assert.ok(foldedManagement, "sorting, refresh and trash must stay in one default-collapsed library menu");
  assert.match(assets, /id="asset-drop-zone"[^>]*aria-label="[^"]+"/u);
  assert.doesNotMatch(openingTagById(assets, "asset-advanced-import-button"), /button--primary/u);
});

test("Alpha 33 narrow navigation prevents overflow while preserving programmatic semantics", () => {
  const navigation = html.match(/<nav id="main-navigation"[\s\S]*?<\/nav>/u)?.[0] ?? "";
  const buttons = [...navigation.matchAll(/<button\b[^>]*class="[^"]*\bheader-tab\b[^"]*"[^>]*>/gu)]
    .map((match) => match[0]);
  const utilitiesStart = styles.indexOf("@media (max-width: 1100px)");
  const utilitiesEnd = styles.indexOf("/* Shared empty/setup-state vocabulary. */", utilitiesStart);
  assert.ok(utilitiesStart >= 0 && utilitiesEnd > utilitiesStart, "missing narrow header utilities contract");
  const utilities = styles.slice(utilitiesStart, utilitiesEnd);
  const utilitiesSummaryRule = utilities.match(/\.header-utilities > summary\s*\{([^}]*)\}/u)?.[1] ?? "";
  const mobileStart = styles.lastIndexOf("@media (max-width: 520px)");
  assert.notEqual(mobileStart, -1, "missing phone navigation contract");
  const mobile = styles.slice(mobileStart);
  const mobileLabelRule = mobile.match(/\.tool-label\s*\{([^}]*)\}/u)?.[1] ?? "";

  assert.equal(buttons.length, 6);
  for (const button of buttons) assert.match(button, /aria-label="[^"]+"/u);
  assert.match(renderer, /button\.closest\("\.main-navigation"\)[\s\S]*?setAttribute\("aria-current", "page"\)[\s\S]*?removeAttribute\("aria-current"\)/u);
  assert.match(utilitiesSummaryRule, /white-space:\s*nowrap/u, "narrow utilities label must not split Chinese characters vertically");
  for (const button of buttons) assert.match(button, /title="[^"]+"/u);
  assert.match(mobileLabelRule, /display:\s*none/u, "phone navigation labels must not overflow the narrow rail");
});

test("Alpha 33 About keeps update status and actions in the same card", () => {
  const about = sliceBetween(html, '<section class="view" id="view-about"', "</main>");
  const heading = pageHeading(about);
  const updateStart = about.indexOf('<section class="surface about-update"');
  assert.notEqual(updateStart, -1, "About must keep one update card");
  const updateCard = about.slice(updateStart);

  for (const id of ["about-check-update", "about-update-status", "about-update-meta", "about-download-update"]) {
    assert.ok(updateCard.includes(`id="${id}"`), `update card is missing ${id}`);
  }
  assert.doesNotMatch(heading, /id="about-check-update"/u);
  assert.equal((about.match(/class="[^"]*\bsurface\s+about-update\b/gu) ?? []).length, 1);
  const profile = about.match(/<section class="about-product__profile"[\s\S]*?<\/section>/u)?.[0] ?? "";
  assert.match(profile, /<p class="eyebrow">独立开发者<\/p>[\s\S]*?柏拉图灵 \| PlaTuring[\s\S]*?抖音 \/ B站：柏拉图灵/u);
  assert.deepEqual([...profile.matchAll(/<dt>([^<]+)<\/dt>/gu)].map((match) => match[1]), ["项目仓库"]);
  assert.doesNotMatch(profile, />\s*GitHub\s*</iu);
  assert.doesNotMatch(about, /class="[^"]*\bsurface\s+about-brand\b/u);
});

test("Alpha 33 key empty states share one semantic visual base", () => {
  const stateTags = ["setup-location-step", "project-center-recent-empty", "asset-empty"]
    .map((id) => openingTagById(html, id));
  const generatedState = openingTagById(html, "generated-empty");
  stateTags.push(generatedState);
  for (const tag of stateTags) assert.notEqual(tag, "", "a key page is missing its empty/initial state shell");

  const commonClasses = [...classesFromTag(stateTags[0])]
    .filter((className) => /empty-state/u.test(className))
    .filter((className) => stateTags.every((tag) => classesFromTag(tag).has(className)));
  assert.equal(commonClasses.length, 1, "key page states must share one empty-state class");
  const sharedClass = commonClasses[0].replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  assert.match(styles, new RegExp(`\\.${sharedClass}\\s*\\{[^}]+\\}`, "su"));
});

test("Alpha 33 project center has no hidden duplicate current-project or import surface", () => {
  const home = view("home", "project");

  assert.doesNotMatch(home, /id="project-center-current(?:-|")/u);
  assert.doesNotMatch(home, /id="project-center-open"/u);
  assert.equal((home.match(/id="project-center-import-bundle"/gu) ?? []).length, 1);
  assert.match(home, /<details\b[^>]*class="[^"]*\bproject-center-maintenance\b/u);
  assert.doesNotMatch(renderer, /\bprojectCenterCurrentPanel\b/u);
});

test("Alpha 33 toast is one static live region with a restartable dismiss lifecycle", () => {
  assert.equal((html.match(/id="app-toast"/gu) ?? []).length, 1);
  const toastTag = openingTagById(html, "app-toast");
  assert.match(toastTag, /role="status"/u);
  assert.match(toastTag, /aria-live="polite"/u);
  assert.match(toastTag, /\bhidden\b/u);
  for (const id of ["app-toast-title", "app-toast-message", "app-toast-close"]) {
    assert.ok(html.includes(`id="${id}"`), `static toast is missing ${id}`);
  }

  const hide = sliceBetween(renderer, "function hideToast", "function showToast");
  const show = sliceBetween(renderer, "function showToast", 'appToastClose.addEventListener("click"');
  assert.match(hide, /clearTimeout\(appToastTimer\)[\s\S]*?appToastTimer = null[\s\S]*?appToast\.hidden = true/u);
  assert.match(show, /(?:clearTimeout\(appToastTimer\)|hideToast\(\))[\s\S]*?appToastTitle\.textContent[\s\S]*?appToastMessage\.textContent[\s\S]*?appToast\.hidden = false/u);
  assert.match(show, /appToastTimer = window\.setTimeout\((?:hideToast|\(\) => hideToast\([^)]*\)),\s*\d+\)/u);
  assert.doesNotMatch(show, /createElement|append(?:Child)?\(/u);
  assert.match(renderer, /appToastClose\.addEventListener\("click", (?:hideToast|\(\) => hideToast\(\))\)/u);
});
