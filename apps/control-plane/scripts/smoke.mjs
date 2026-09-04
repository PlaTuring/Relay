import { spawn, spawnSync } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { offlineEnvironment, projectRoot } from "./lib.mjs";

const readyMarker = "CONTROL_PLANE_UI_READY";
const timeoutMilliseconds = 20_000;

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
  throw new Error("SMOKE.BUILD_FAILED");
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
runtimeEnvironment.MINIMAX_H3_SMOKE = "1";

const smokeProfileRoot = resolve(projectRoot, ".build-cache", "smoke-profile");
const roamingProfile = resolve(smokeProfileRoot, "Roaming");
const localProfile = resolve(smokeProfileRoot, "Local");
const smokeUserData = resolve(smokeProfileRoot, "UserData");
const smokeDataRoot = resolve(projectRoot, ".build-cache", "smoke-data-root");
await rm(smokeProfileRoot, { recursive: true, force: true });
await rm(smokeDataRoot, { recursive: true, force: true });
await mkdir(roamingProfile, { recursive: true });
await mkdir(localProfile, { recursive: true });
await mkdir(smokeUserData, { recursive: true });
await mkdir(smokeDataRoot, { recursive: true });
await writeFile(
  resolve(smokeUserData, "data-root.pointer.json"),
  `${JSON.stringify({ version: 1, dataRoot: smokeDataRoot, updatedAt: "2026-09-01T00:00:00.000Z" }, null, 2)}\n`,
  "utf8"
);
runtimeEnvironment.APPDATA = roamingProfile;
runtimeEnvironment.LOCALAPPDATA = localProfile;

const child = spawn(electronExecutable, [`--user-data-dir=${smokeUserData}`, projectRoot], {
  cwd: projectRoot,
  env: runtimeEnvironment,
  stdio: ["ignore", "pipe", "pipe"],
  shell: false,
  windowsHide: true
});

const outcome = await new Promise((resolveOutcome) => {
  let settled = false;
  let capturedOutput = "";
  const finish = (result) => {
    if (settled) {
      return;
    }
    settled = true;
    clearTimeout(timeout);
    resolveOutcome({ result, capturedOutput });
  };
  const inspect = (chunk) => {
    capturedOutput = `${capturedOutput}${chunk.toString("utf8")}`.slice(-16_384);
    if (capturedOutput.includes(readyMarker)) {
      finish("ready");
    }
  };
  child.stdout.on("data", inspect);
  child.stderr.on("data", inspect);
  child.once("error", () => finish("launch_failed"));
  child.once("close", () => finish("exited_before_ready"));
  const timeout = setTimeout(() => finish("timeout"), timeoutMilliseconds);
});

if (child.exitCode === null && child.signalCode === null) {
  child.kill();
}

if (outcome.result !== "ready") {
  const diagnostic = outcome.capturedOutput.trim();
  throw new Error(
    `SMOKE.${String(outcome.result).toUpperCase()}${diagnostic ? `\n${diagnostic}` : ""}`
  );
}

process.stdout.write(`${readyMarker} mode=deterministic_mock\n`);
