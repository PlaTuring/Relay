import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const controlPlaneRoot = resolve(import.meta.dirname, "..");
const renderer = () => readFile(resolve(controlPlaneRoot, "src", "renderer", "index.ts"), "utf8");
const markup = () => readFile(resolve(controlPlaneRoot, "src", "renderer", "index.html"), "utf8");
const styles = () => readFile(resolve(controlPlaneRoot, "src", "renderer", "styles.css"), "utf8");

test("project center makes recent projects the primary ordered surface without hiding active projects", async () => {
  const source = await renderer();
  const ordering = source.match(/function visibleRecentProjects[\s\S]*?return Object\.freeze\(ordered\);\n\}/u)?.[0] ?? "";

  assert.match(ordering, /state\.recentProjects/u);
  assert.match(ordering, /activeRelayProject\?\.projectId \?\? state\.activeProjectId/u);
  assert.match(ordering, /for \(const project of \[\.\.\.active\.values\(\)\]/u);
  assert.match(ordering, /seen\.has\(project\.projectId\)/u);
  assert.doesNotMatch(ordering, /state\.projects\.filter[\s\S]*?return state\.projects/u);
});

test("the selected project is summarized inside its list row with one contextual editor route", async () => {
  const source = await renderer();
  const activeSummary = source.match(/function appendActiveProjectSummary[\s\S]*?\n\}/u)?.[0] ?? "";
  const actionFactory = source.match(/function projectCenterSurfaceButton[\s\S]*?(?=\nfunction appendActiveProjectSummary)/u)?.[0] ?? "";

  assert.match(activeSummary, /project-center-project--active/u);
  assert.match(activeSummary, /project-center-project__active-summary/u);
  assert.match(activeSummary, /project\.assets\.length/u);
  assert.match(activeSummary, /project\.shots\.filter/u);
  assert.match(activeSummary, /project\.workflows\.length/u);
  assert.match(activeSummary, /label: "继续编辑"[\s\S]*?project\.editorMode === "professional" \? "director" : "project"/u);
  assert.match(activeSummary, /label: "素材库"[\s\S]*?target: "assets"/u);
  assert.doesNotMatch(activeSummary, /label: "快速创建"[\s\S]*?label: "专业导播"/u);
  assert.match(actionFactory, /await activateRelayProject\(options\.projectId, options\.target\)/u);
  assert.match(actionFactory, /runAssetAction/u);
});

test("duplicate current-project and import surfaces are removed while secondary management remains real", async () => {
  const source = await renderer();
  const html = await markup();

  assert.doesNotMatch(html, /id="project-center-current(?:-[^"]+)?"/u);
  assert.doesNotMatch(html, /id="project-center-open"/u);
  assert.doesNotMatch(source, /projectCenterCurrentPanel|projectCenterOpen(?!DataRoot)/u);
  assert.match(source, /projectCenterMaintenancePanel\.dataset\.projectSelected = String\(enabled\)/u);
  assert.match(source, /window\.controlPlane\.importRelayProjectBundle\(\)/u);
  assert.match(source, /window\.controlPlane\.exportRelayProjectBundle/u);
  assert.match(source, /window\.controlPlane\.cloneRelayProject/u);
  assert.match(source, /window\.controlPlane\.archiveRelayProject/u);
});

test("dataRoot is a truthful compact status with guarded real actions", async () => {
  const source = await renderer();
  const render = source.match(/function renderProjectCenter\(\)[\s\S]*?\n\}/u)?.[0] ?? "";

  assert.match(render, /const dataRoot = state\?\.dataRoot\.trim\(\) \?\? ""/u);
  assert.match(render, /projectCenterDataRoot\.title = hasDataRoot/u);
  assert.match(render, /projectCenterOpenDataRoot\.disabled = !hasDataRoot/u);
  assert.match(render, /dataset\.configurationState = hasDataRoot \? "configured" : "missing"/u);
  assert.match(source, /await window\.controlPlane\.openDataRoot\(\)/u);
  assert.match(source, /await window\.controlPlane\.chooseAndConfigureDataRoot\(\{ mode \}\)/u);
});

test("project center keeps its primary action compact at the trailing edge when the heading becomes a grid", async () => {
  const source = await styles();
  const action = source.match(/\.page-heading--project-center > \.button\s*\{[\s\S]*?\}/u)?.[0] ?? "";

  assert.match(action, /width:\s*auto/u);
  assert.match(action, /margin-left:\s*auto/u);
  assert.match(action, /justify-self:\s*end/u);
});
