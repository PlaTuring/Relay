import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { offlineEnvironment, projectRoot } from "./lib.mjs";

const typescriptCli = resolve(projectRoot, "node_modules", "typescript", "bin", "tsc");
const projects = [
  "tsconfig.main.json",
  "tsconfig.preload.json",
  "tsconfig.renderer.json"
];

for (const project of projects) {
  const result = spawnSync(process.execPath, [typescriptCli, "-p", project, "--noEmit"], {
    cwd: projectRoot,
    encoding: "utf8",
    env: offlineEnvironment(),
    maxBuffer: 8 * 1024 * 1024,
    shell: false,
    windowsHide: true
  });
  if (result.status !== 0) {
    process.stderr.write(`TYPECHECK.FAILED:${project}\n`);
    process.exit(1);
  }
}

process.stdout.write("TYPECHECK passed=3 failed=0\n");

