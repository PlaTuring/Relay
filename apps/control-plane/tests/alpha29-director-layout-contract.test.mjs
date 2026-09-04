import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function read(relativePath) {
  return readFile(resolve(root, relativePath), "utf8");
}

function sliceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("Alpha 30 director workspace keeps the timeline before one lightweight current-shot summary", async () => {
  const html = await read("src/renderer/index.html");
  const workspace = sliceBetween(
    html,
    '<div class="director-production-grid director-studio-workspace" id="director-p1-workspace"',
    '<section class="view" id="view-assets"'
  );

  assert.match(workspace, /data-director-layout="single-page-scroll"/u);

  const orderedMarkers = [
    'id="director-p1-studio-header" class="director-studio-header" data-layout-area="header"',
    'id="director-p1-data-layer" data-layout-area="data"',
    'id="director-p1-history-drawer" class="surface director-history-drawer" data-layout-area="history"',
    'id="director-p1-shot-stage" class="director-shot-stage" data-layout-area="timeline-editor"',
    'id="director-current-shot-summary" class="surface director-current-shot-summary" data-layout-area="shot-inspector"'
  ];
  const positions = orderedMarkers.map((marker) => {
    const position = workspace.indexOf(marker);
    assert.notEqual(position, -1, `missing layout marker: ${marker}`);
    return position;
  });
  assert.deepEqual(positions, [...positions].sort((left, right) => left - right));
  assert.ok(
    positions[3] < positions[4],
    "the timeline/editor must precede the complementary current-shot inspector for deterministic Grid placement"
  );
});

test("Alpha 30 director primary stage owns only the timeline and active-shot editor host", async () => {
  const html = await read("src/renderer/index.html");
  const stage = sliceBetween(html, 'id="director-p1-shot-stage"', 'id="director-current-shot-summary"');

  assert.match(stage, /aria-labelledby="director-board-title"/u);
  assert.match(stage, /id="director-timeline-track"/u);
  assert.match(stage, /id="director-shot-list"/u);
  assert.doesNotMatch(stage, /compile-inspector|id="director-validation"|id="director-prompt-preview"/u);
  assert.doesNotMatch(stage, /id="director-p1-shot-asset-bindings"|id="director-shot-start-state"|id="director-p1-takes-panel"/u);
});

test("Alpha 30 permanent shot inspector is read-only while complex controls live in the shared drawer host", async () => {
  const html = await read("src/renderer/index.html");
  const summary = sliceBetween(
    html,
    '<aside id="director-current-shot-summary"',
    '<section id="director-p1-current-shot-tools"'
  );

  assert.match(summary, /data-layout-area="shot-inspector"/u);
  assert.match(summary, /id="director-shot-settings-button"[^>]*aria-controls="director-workspace-drawer"/u);
  for (const id of [
    "director-current-shot-time",
    "director-current-shot-assets",
    "director-current-shot-continuity",
    "director-current-shot-transition"
  ]) assert.ok(summary.includes(`id="${id}"`), `missing lightweight current-shot fact: ${id}`);
  assert.doesNotMatch(summary, /textarea|fieldset|id="director-p1-shot-asset-bindings"|id="director-p1-takes-panel"/u);

  const tools = sliceBetween(
    html,
    '<section id="director-p1-current-shot-tools"',
    '<div id="director-workspace-drawer-layer"'
  );
  assert.match(tools, /aria-label="当前镜头辅助编辑"[^>]*hidden/u);
  for (const id of [
    "director-p1-current-shot-duration",
    "director-shot-start-state",
    "director-shot-end-state",
    "director-shot-transition-kind",
    "director-p1-shot-asset-bindings",
    "director-p1-continuity-panel",
    "director-p1-takes-panel"
  ]) {
    assert.ok(tools.includes(`id="${id}"`), `missing contextual current-shot control: ${id}`);
  }
  assert.doesNotMatch(tools, /id="director-shot-list"|id="director-timeline-track"/u);
  assert.match(html, /id="director-drawer-shot-host"/u);
});

test("Alpha 30 director page retains exactly one primary action and all established control IDs remain unique", async () => {
  const html = await read("src/renderer/index.html");
  const directorView = sliceBetween(html, '<section class="view" id="view-director"', '<section class="view" id="view-assets"');
  const primaryButtons = [...directorView.matchAll(/<button\b[^>]*class="[^"]*\bbutton--primary\b[^"]*"[^>]*>/gu)];

  assert.equal(primaryButtons.length, 1);
  assert.match(primaryButtons[0][0], /id="director-compile-button"/u);

  const ids = [...html.matchAll(/\bid="([^"]+)"/gu)].map((match) => match[1]);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual(duplicateIds, []);
});
