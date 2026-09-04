import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { offlineEnvironment, projectRoot } from "./lib.mjs";

const acceptedArguments = new Set(["--dev"]);
for (const argument of process.argv.slice(2)) {
  if (!acceptedArguments.has(argument)) {
    throw new Error("START.INVALID_ARGUMENT");
  }
}

const build = spawnSync(
  process.execPath,
  [resolve(projectRoot, "scripts", "build.mjs")],
  {
    cwd: projectRoot,
    encoding: "utf8",
    env: offlineEnvironment(),
    maxBuffer: 8 * 1024 * 1024,
    shell: false,
    windowsHide: true
  }
);
if (build.status !== 0) {
  throw new Error("START.BUILD_FAILED");
}

const electronExecutable = resolve(
  projectRoot,
  "node_modules",
  "electron",
  "dist",
  process.platform === "win32" ? "electron.exe" : "electron"
);
const runtimeEnvironment = { ...process.env };
delete runtimeEnvironment.ELECTRON_RUN_AS_NODE;
delete runtimeEnvironment.NODE_OPTIONS;
runtimeEnvironment.MINIMAX_H3_CONTROL_PLANE_MODE = process.argv.includes("--dev")
  ? "development"
  : "production-preview";

const child = spawn(electronExecutable, [projectRoot], {
  cwd: projectRoot,
  env: runtimeEnvironment,
  stdio: "inherit",
  shell: false,
  windowsHide: false
});

const forwardSignal = (signal) => {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill(signal);
  }
};
process.once("SIGINT", () => forwardSignal("SIGINT"));
process.once("SIGTERM", () => forwardSignal("SIGTERM"));

child.once("error", () => {
  process.stderr.write("START.ELECTRON_LAUNCH_FAILED\n");
  process.exitCode = 1;
});
child.once("close", (code, signal) => {
  if (signal !== null) {
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
