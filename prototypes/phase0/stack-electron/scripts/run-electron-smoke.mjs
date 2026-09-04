import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const electronExecutable = resolve(
  projectRoot,
  "node_modules",
  "electron",
  "dist",
  process.platform === "win32" ? "electron.exe" : "electron"
);
const profileRoot = resolve(projectRoot, "artifacts", "electron-profile");

try {
  if (dirname(profileRoot) !== resolve(projectRoot, "artifacts")) {
    throw new Error("Profile containment check failed.");
  }

  await rm(profileRoot, { recursive: true, force: true });
  await mkdir(profileRoot, { recursive: true });

  const child = spawn(electronExecutable, [projectRoot, "--self-test"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      MINIMAX_H3_SPIKE_PROFILE: profileRoot,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "false"
    },
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  // Stderr is intentionally drained but never copied into publishable stdout.
  child.stderr.on("data", () => undefined);

  const result = await new Promise((resolveResult, rejectResult) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      rejectResult(new Error("Electron self-test exceeded its time budget."));
    }, 15_000);

    child.once("error", () => {
      clearTimeout(timeout);
      rejectResult(new Error("Electron self-test process could not start."));
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolveResult({ code, signal });
    });
  });

  const eventLine = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.startsWith("{") && line.includes('"event":"electron-self-test"'));
  const event = eventLine ? JSON.parse(eventLine) : null;

  if (
    result.code !== 0 ||
    !event ||
    event.event !== "electron-self-test" ||
    event.contextIsolation !== true ||
    event.sandbox !== true ||
    event.nodeIntegration !== false ||
    event.preloadApiReady !== true ||
    event.rendererRequireType !== "undefined" ||
    event.rendererProcessType !== "undefined" ||
    event.ipcChannelCount !== 4 ||
    event.childReady !== true ||
    event.childTerminated !== true
  ) {
    throw new Error("Electron self-test result did not satisfy the bounded contract.");
  }

  process.stdout.write(`${JSON.stringify(event)}\n`);
} catch {
  process.stderr.write(
    "Electron self-test failed; raw child output is intentionally suppressed and local-only.\n"
  );
  process.exitCode = 1;
}
