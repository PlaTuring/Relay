import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { offlineEnvironment, projectRoot } from "./lib.mjs";

const testDirectory = resolve(projectRoot, "tests");
const testFiles = (await readdir(testDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
  .map((entry) => resolve(testDirectory, entry.name))
  .sort((left, right) => left.localeCompare(right, "en"));

if (testFiles.length === 0) {
  throw new Error("TEST.NO_TEST_FILES");
}

const result = spawnSync(process.execPath, ["--test", ...testFiles], {
  cwd: projectRoot,
  env: offlineEnvironment(),
  stdio: "inherit",
  shell: false,
  windowsHide: true
});
if (result.status !== 0) {
  throw new Error("TEST.FAILED");
}
