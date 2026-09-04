import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.argv[2] === "--grandchild") {
  setInterval(() => {}, 1000);
} else {
  const grandchild = spawn(process.execPath, [fileURLToPath(import.meta.url), "--grandchild"], {
    shell: false,
    stdio: "ignore",
    windowsHide: true
  });
  process.stdout.write(`GRANDCHILD_PID=${grandchild.pid}\n`);
  setInterval(() => {}, 1000);
}
