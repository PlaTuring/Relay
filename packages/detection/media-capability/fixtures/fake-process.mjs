import { spawn } from "node:child_process";

const mode = process.argv[2];
if (mode === "timeout") {
  setInterval(() => undefined, 1_000);
} else if (mode === "oversize") {
  process.stdout.write("x".repeat(1_000_000));
} else if (mode === "invalid-utf8") {
  process.stdout.write(Buffer.from([0xc3, 0x28]));
} else if (mode === "orphan-success") {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 250)"], {
    detached: true,
    stdio: "ignore",
    shell: false,
    windowsHide: true
  });
  child.unref();
} else {
  process.exitCode = 2;
}
