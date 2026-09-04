import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.argv[2] !== "--direct") {
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--direct"], {
    encoding: "utf8",
    env: process.env,
    shell: false,
    windowsHide: true
  });
  process.stdout.write(child.stdout || "DESCENDANT_NO_OUTPUT\n");
  process.exitCode = child.status ?? 88;
} else {
  try {
    await fetch("http://127.0.0.1:65535/runner-must-not-connect");
    process.stdout.write("NETWORK_GUARD_MISSING\n");
    process.exitCode = 90;
  } catch (error) {
    process.stdout.write(`${error?.code ?? "UNKNOWN_NETWORK_ERROR"}\n`);
    process.exitCode = error?.code === "RUNNER.NETWORK_FORBIDDEN" ? 86 : 87;
  }
}
