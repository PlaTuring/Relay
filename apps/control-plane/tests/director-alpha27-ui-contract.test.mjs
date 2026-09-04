import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const read = (relativePath) => readFile(resolve(root, relativePath), "utf8");

test("Alpha 27 director is a single workspace with one handoff action", async () => {
  const html = await read("src/renderer/index.html");
  const director = html.slice(html.indexOf('id="view-director"'), html.indexOf('id="view-assets"'));

  assert.match(director, /id="director-p1-workspace"[^>]*data-workspace-view="studio"/u);
  assert.doesNotMatch(director, /data-director-workspace-view="(?:shots|data|continuity|history)"/u);
  assert.doesNotMatch(director, /版本与结果/u);
  assert.match(director, /id="director-p1-history-drawer"/u);
  assert.match(director, /id="director-p1-current-shot-tools"/u);
  assert.match(director, /id="director-p1-shot-stage"/u);
  assert.match(director, /id="director-p1-data-layer"/u);
  assert.equal((director.match(/class="[^"]*button--primary[^"]*"/gu) ?? []).length, 1);
  assert.match(director, /id="director-compile-button"[^>]*class="[^"]*button--primary/u);
  assert.doesNotMatch(director, /id="director-send-to-project"/u);
});

test("Alpha 27 timing and continuity controls are deterministic and field-addressable", async () => {
  const [html, ui] = await Promise.all([
    read("src/renderer/index.html"),
    read("src/renderer/director-p1-ui.ts")
  ]);

  assert.match(html, /id="director-p1-current-shot-duration"[^>]*aria-label="当前镜头时长"/u);
  const durationSelect = html.slice(
    html.indexOf('id="director-p1-current-shot-duration"'),
    html.indexOf("</select>", html.indexOf('id="director-p1-current-shot-duration"'))
  );
  assert.deepEqual([...durationSelect.matchAll(/<option value="(\d+)"/gu)].map((match) => match[1]), ["5", "10", "15"]);
  assert.match(html, /id="director-p1-total-duration"[^>]*aria-live="polite"/u);
  assert.match(ui, /setProductionShotDuration\(state,\s*activeShotId,\s*duration/u);
  assert.match(ui, /directorTimelineDuration\(shots\)/u);

  for (const dimension of [
    "characterAppearance", "wardrobe", "props", "movementDirection", "scene",
    "weather", "timeOfDay", "lighting", "visualStyle", "sound"
  ]) {
    assert.match(html, new RegExp(`<option value="${dimension}">`, "u"));
  }
  assert.match(ui, /button\.dataset\.directorP1Action = "set-continuity-mode"/u);
  assert.match(ui, /button\.dataset\.directorP1ShotId = activeShotId/u);
  assert.match(ui, /button\.dataset\.directorP1ContinuityDimension = dimension/u);
  assert.match(ui, /button\.dataset\.directorP1ContinuityMode = mode/u);
  assert.match(ui, /focusField:\s*\(shotId:\s*string,\s*field:\s*string\)/u);
  assert.match(ui, /requestedMode === "override"[\s\S]*?continuityLocks\.focus\(\)/u);
});

test("Alpha 27 Asset, Entity, Binding, and Take UI never exposes an absolute path", async () => {
  const [html, ui] = await Promise.all([
    read("src/renderer/index.html"),
    read("src/renderer/director-p1-ui.ts")
  ]);

  assert.match(html, /id="director-p1-shot-asset-bindings"[^>]*data-director-asset-binding-host="shot"/u);
  const host = html.slice(
    html.indexOf('id="director-p1-shot-asset-bindings"'),
    html.indexOf("</div>", html.indexOf('id="director-p1-shot-asset-bindings"'))
  );
  assert.doesNotMatch(host, /<button|<input|type="file"/u);
  assert.match(html, /id="director-p1-entity-asset"/u);
  assert.match(html, /id="director-p1-take-asset"/u);
  assert.doesNotMatch(html, /director-p1-(?:entity-reference|take-path|take-browse)/u);
  assert.doesNotMatch(ui, /chooseResultMedia|displayPath|localResultPath|basename\s*\(/u);
  assert.match(ui, /productionBindingsForTarget\(state,\s*"entity"/u);
  assert.match(ui, /upsertProductionBinding\(next,\s*\{/u);
  assert.match(ui, /targetKind:\s*"entity"/u);
  assert.match(ui, /assetId:\s*entityAsset\.value/u);
  assert.match(ui, /assetId:\s*takeAsset\.value/u);
  assert.doesNotMatch(html, /<option value="asset">/u);
});

test("Alpha 27 history and optional Takes stay compact, accessible, and non-generative", async () => {
  const [html, ui] = await Promise.all([
    read("src/renderer/index.html"),
    read("src/renderer/director-p1-ui.ts")
  ]);

  assert.match(html, /<details id="director-p1-history-drawer"/u);
  assert.match(html, /data-director-p1-action="restore-revision"/u);
  assert.match(html, /<details class="director-p1-panel" id="director-p1-takes-panel"/u);
  assert.doesNotMatch(html, /id="director-p1-takes-panel"[^>]*\sopen(?:\s|>)/u);
  assert.match(ui, /take\.shotId === activeShotId/u);
  assert.match(ui, /takes\.length === 0 && takeEditor\.hidden\) takesPanel\.open = false/u);
  assert.match(html, /id="director-state-chip"[^>]*role="status"[^>]*aria-live="polite"/u);
  assert.doesNotMatch([html, ui].join("\n"), /\/prompt|queuePrompt|submitPrompt|自动运行 H3/u);
});
