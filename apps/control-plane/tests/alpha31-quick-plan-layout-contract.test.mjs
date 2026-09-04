import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const styles = await readFile(resolve(root, "src/renderer/styles.css"), "utf8");

function blockAfter(source, marker) {
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `missing CSS marker: ${marker}`);
  const openingBrace = source.indexOf("{", markerIndex + marker.length);
  assert.notEqual(openingBrace, -1, `missing opening brace after: ${marker}`);

  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(openingBrace + 1, index);
  }
  assert.fail(`missing closing brace after: ${marker}`);
}

function numericDeclaration(rule, property) {
  const match = rule.match(new RegExp(`${property}:\\s*(\\d+)px`, "u"));
  assert.ok(match, `missing numeric declaration: ${property}`);
  return Number(match[1]);
}

test("Relay 1.0 quick plan uses two bounded controls and a dedicated summary row", () => {
  const card = blockAfter(styles, ".director-quick-plan");
  const body = blockAfter(styles, ".director-quick-plan__body");
  const summary = blockAfter(styles, ".director-quick-plan__body > .director-plan-summary");

  assert.match(card, /grid-template-columns:\s*minmax\(0, 1fr\)/u);
  assert.match(card, /gap:\s*0/u);
  assert.match(card, /padding:\s*0/u);
  assert.match(
    body,
    /grid-template-columns:\s*minmax\(112px, 128px\) minmax\(132px, 148px\)/u
  );
  assert.match(body, /justify-content:\s*start/u);
  assert.match(summary, /grid-column:\s*1\s*\/\s*-1/u);
  assert.match(styles, /\.director-quick-plan__body\s*>\s*\.director-plan-summary\s*\{/u);

  assert.doesNotMatch(
    styles,
    /\.director-toolbar-cluster\[data-director-toolbar-group="timing"\]\s+\.director-plan-summary/u,
    "the summary contract must target its real quick-plan body rather than the obsolete toolbar parent"
  );

  const bodyColumnDeclarations = [
    ...styles.matchAll(
      /\.director-quick-plan__body\s*\{[^{}]*grid-template-columns:\s*([^;]+);/gu
    )
  ].map((match) => match[1].trim());
  assert.deepEqual(bodyColumnDeclarations, [
    "minmax(112px, 128px) minmax(132px, 148px)",
    "minmax(132px, 148px)"
  ]);
});

test("Relay 1.0 responsive rules preserve compact widths and collapse only at an extreme viewport", () => {
  const dpiRange = blockAfter(
    styles,
    "@media (min-width: 761px) and (max-width: 1535px)"
  );
  const extremeNarrow = blockAfter(styles, "@media (max-width: 360px)");

  assert.match(
    dpiRange,
    /\.director-toolbar-grid\s*\{\s*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/u
  );
  assert.match(
    extremeNarrow,
    /\.director-quick-plan__body\s*\{\s*grid-template-columns:\s*minmax\(132px, 148px\)/u
  );
  assert.match(
    extremeNarrow,
    /\.director-quick-plan__body\s*>\s*\.field:first-child\s*\{\s*max-width:\s*128px/u
  );
  assert.doesNotMatch(extremeNarrow, /grid-template-columns:\s*1fr|width:\s*100%/u);
});

test("Relay 1.0 quick plan stays inside its toolbar track at common Windows DPI geometries", () => {
  const toolbar = blockAfter(styles, ".director-toolbar-grid");
  const body = blockAfter(styles, ".director-quick-plan__body");
  const card = blockAfter(styles, ".director-quick-plan");
  const baseColumns = toolbar.match(
    /grid-template-columns:\s*minmax\((\d+)px, ([\d.]+)fr\)\s+minmax\((\d+)px, ([\d.]+)fr\)\s+minmax\((\d+)px, ([\d.]+)fr\)\s+minmax\((\d+)px, ([\d.]+)fr\)/u
  );
  const planColumns = body.match(
    /grid-template-columns:\s*minmax\((\d+)px, (\d+)px\)\s+minmax\((\d+)px, (\d+)px\)/u
  );
  assert.ok(baseColumns, "missing four-column toolbar geometry");
  assert.ok(planColumns, "missing two-column quick-plan geometry");

  const toolbarMins = [baseColumns[1], baseColumns[3], baseColumns[5], baseColumns[7]].map(Number);
  const toolbarFractions = [baseColumns[2], baseColumns[4], baseColumns[6], baseColumns[8]].map(Number);
  const planMins = [Number(planColumns[1]), Number(planColumns[3])];
  const planMaxes = [Number(planColumns[2]), Number(planColumns[4])];
  const toolbarGap = numericDeclaration(toolbar, "gap");
  const planGap = numericDeclaration(body, "gap");
  const planPadding = numericDeclaration(body, "padding");
  const cardBorder = numericDeclaration(card, "border");

  assert.deepEqual(planMins, [112, 132]);
  assert.deepEqual(planMaxes, [128, 148]);
  assert.equal(toolbarMins[2], 280, "the timing track needs room for its bounded inner grid");

  function quickPlanTrackWidth(cssViewport) {
    const railWidth = cssViewport <= 520 ? 0 : cssViewport <= 760 ? 52 : 64;
    const viewPadding = cssViewport <= 760 ? 12 : cssViewport >= 1600 ? 28 : 20;
    const pageWidth = Math.min(1380, cssViewport - railWidth - (2 * viewPadding));
    const toolbarWidth = pageWidth - 2 - 28;

    if (cssViewport <= 760) return toolbarWidth;
    if (cssViewport <= 1535) return (toolbarWidth - toolbarGap) / 2;

    const distributable = toolbarWidth - (3 * toolbarGap);
    const fractionalUnit = distributable / toolbarFractions.reduce((sum, fraction) => sum + fraction, 0);
    return Math.max(toolbarMins[2], fractionalUnit * toolbarFractions[2]);
  }

  const twoColumnFootprint = planMins[0] + planMins[1] + planGap;
  const singleColumnFootprint = planMaxes[1];
  const scenarios = [1366, 1600, 1920].flatMap((physicalWidth) =>
    [1, 1.25, 1.5].map((deviceScaleFactor) => ({ physicalWidth, deviceScaleFactor }))
  );
  const breakpointScenarios = [320, 360, 361, 760, 761, 1535, 1536].map((physicalWidth) => ({
    physicalWidth,
    deviceScaleFactor: 1
  }));

  for (const { physicalWidth, deviceScaleFactor } of [...scenarios, ...breakpointScenarios]) {
    const cssViewport = Math.floor(physicalWidth / deviceScaleFactor);
    const trackWidth = quickPlanTrackWidth(cssViewport);
    const contentWidth = trackWidth - (2 * cardBorder) - (2 * planPadding);
    const requiredWidth = cssViewport <= 360 ? singleColumnFootprint : twoColumnFootprint;

    assert.ok(
      contentWidth >= requiredWidth,
      `${physicalWidth}px at ${deviceScaleFactor * 100}% leaves ${contentWidth.toFixed(2)}px `
        + `for a ${requiredWidth}px quick plan`
    );
  }
});
