import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererSourceUrl = new URL("../src/renderer/index.ts", import.meta.url);

test("accepting the prompt duration recommendation schedules project persistence", async () => {
  const source = await readFile(rendererSourceUrl, "utf8");
  const start = source.indexOf('applyPromptDuration.addEventListener("click"');
  const end = source.indexOf("workflowNameInput.addEventListener", start);

  assert.notEqual(start, -1, "prompt duration recommendation handler must exist");
  assert.notEqual(end, -1, "handler boundary must exist");

  const handler = source.slice(start, end);
  assert.match(handler, /projectDuration\.value\s*=\s*String\(duration\)/u);
  assert.match(handler, /syncSegmentPlan\(\)/u);
  assert.match(handler, /scheduleQuickProjectSave\(\)/u);
});
