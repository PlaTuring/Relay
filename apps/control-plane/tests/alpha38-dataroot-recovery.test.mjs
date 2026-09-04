import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const projectRoot = path.resolve(import.meta.dirname, "..");

async function loadTypeScriptModule(context, relativePath) {
  const buildRoot = await mkdtemp(path.join(os.tmpdir(), "relay-alpha38-dataroot-"));
  context.after(() => rm(buildRoot, { recursive: true, force: true }));
  const outfile = path.join(buildRoot, `${path.basename(relativePath, ".ts")}.mjs`);
  await build({
    entryPoints: [path.join(projectRoot, relativePath)],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "silent"
  });
  return import(`${new URL(`file:///${outfile.replaceAll("\\", "/")}`).href}?fixture=${Date.now()}`);
}

function volume(overrides = {}) {
  return Object.freeze({
    exists: true,
    isDirectory: true,
    fixedLocal: true,
    filesystem: "ntfs",
    driveType: "fixed_local",
    readable: true,
    writable: true,
    ...overrides
  });
}

test("redirected or VM-shared Electron userData stores only the small pointer and is not volume-gated", async (context) => {
  const data = await loadTypeScriptModule(context, "src/main/services/data-root.ts");
  const temporary = await mkdtemp(path.join(os.tmpdir(), "Relay 用户重定向 VM Shared "));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const userData = path.join(temporary, "AppData 重定向");
  const dataRoot = path.join(temporary, "模拟固定 NTFS", "RelayData");
  await data.ensureDataRootLayout(dataRoot);
  await data.saveDataRootPointer(userData, dataRoot, new Date("2026-08-31T00:00:00Z"));
  assert.equal((await data.loadDataRootPointer(userData, { strict: true })).dataRoot, path.resolve(dataRoot));
  assert.deepEqual(await (await import("node:fs/promises")).readdir(userData), ["data-root.pointer.json"]);
});

test("dataRoot volume evidence fails closed with stable user-actionable codes", async (context) => {
  const data = await loadTypeScriptModule(context, "src/main/services/data-root.ts");
  const candidate = path.resolve("D:\\MiniMaxH3");
  assert.deepEqual(await data.validateDataRootLocation(candidate, () => volume()), volume());
  for (const [expected, evidence] of [
    ["DATA_ROOT_UNAVAILABLE", volume({ exists: false })],
    ["DATA_ROOT_UNAVAILABLE", volume({ isDirectory: false })],
    ["DATA_ROOT_PERMISSION_DENIED", volume({ writable: false })],
    ["DATA_ROOT_NOT_FIXED_NTFS", volume({ filesystem: "fat32" })],
    ["DATA_ROOT_NOT_FIXED_NTFS", volume({ filesystem: "exfat" })],
    ["DATA_ROOT_NOT_FIXED_NTFS", volume({ fixedLocal: false, driveType: "remote" })],
    ["DATA_ROOT_NOT_FIXED_NTFS", volume({ fixedLocal: false, driveType: "removable" })]
  ]) {
    await assert.rejects(
      data.validateDataRootLocation(candidate, () => evidence),
      (error) => error?.code === expected && typeof error.message === "string" && error.message.length > 8
    );
  }
});

test("pointer corruption and write denial are distinguished from dataRoot failures", async (context) => {
  const data = await loadTypeScriptModule(context, "src/main/services/data-root.ts");
  const temporary = await mkdtemp(path.join(os.tmpdir(), "relay-alpha38-pointer-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const userData = path.join(temporary, "user-data");
  await mkdir(userData);
  await writeFile(path.join(userData, "data-root.pointer.json"), "{broken-json", "utf8");
  await assert.rejects(
    data.loadDataRootPointer(userData, { strict: true }),
    (error) => error?.code === "POINTER_READ_FAILED" && /无法读取/u.test(error.message)
  );
  assert.equal(await data.loadDataRootPointer(userData), null);

  const dataRoot = path.join(temporary, "valid-data-root");
  await data.ensureDataRootLayout(dataRoot);
  const blockedUserData = path.join(temporary, "not-a-directory");
  await writeFile(blockedUserData, "file", "utf8");
  await assert.rejects(
    data.saveDataRootPointer(blockedUserData, dataRoot),
    (error) => error?.code === "POINTER_WRITE_FAILED" && /无法保存/u.test(error.message)
  );
});

test("initial production root uses D when available and never silently creates C business data", async (context) => {
  const startup = await loadTypeScriptModule(context, "src/main/startup-data-root.ts");
  const base = { legacySetup: null, userDataPath: "R:\\RedirectedProfile\\Relay", headlessMode: false };
  assert.equal(startup.chooseInitialDataRootCandidate({ ...base, dDriveAvailable: true }), "D:\\MiniMaxH3");
  assert.equal(startup.chooseInitialDataRootCandidate({ ...base, dDriveAvailable: false }), null);
  assert.equal(
    startup.chooseInitialDataRootCandidate({
      ...base,
      legacySetup: { installRoot: "E:\\RelayData" },
      dDriveAvailable: false
    }),
    "E:\\RelayData"
  );
});

test("pointer restart persistence preserves Chinese dataRoot without leaking business files into userData", async (context) => {
  const data = await loadTypeScriptModule(context, "src/main/services/data-root.ts");
  const temporary = await mkdtemp(path.join(os.tmpdir(), "relay-alpha38-restart-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const userData = path.join(temporary, "用户 数据");
  const dataRoot = path.join(temporary, "项目 数据 Ω");
  await data.ensureDataRootLayout(dataRoot);
  await data.saveDataRootPointer(userData, dataRoot);
  const restarted = await data.loadDataRootPointer(userData, { strict: true });
  assert.equal(restarted.dataRoot, path.resolve(dataRoot));
  assert.deepEqual(await (await import("node:fs/promises")).readdir(userData), ["data-root.pointer.json"]);
});

test("recovery page exposes only real retry, choose, diagnostics and exit actions", async () => {
  const [html, preload, recoveryMain, appMain, buildScript] = await Promise.all([
    readFile(path.join(projectRoot, "src/renderer/startup-recovery.html"), "utf8"),
    readFile(path.join(projectRoot, "src/preload/startup-recovery.ts"), "utf8"),
    readFile(path.join(projectRoot, "src/main/startup-recovery-window.ts"), "utf8"),
    readFile(path.join(projectRoot, "src/main/main.ts"), "utf8"),
    readFile(path.join(projectRoot, "scripts/build.mjs"), "utf8")
  ]);
  for (const id of ["recovery-retry", "recovery-choose", "recovery-diagnostics", "recovery-exit"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`, "u"));
  }
  assert.match(preload, /ipcRenderer\.invoke\(CHANNELS\.(retry|choose|diagnostics|exit)/u);
  assert.match(appMain, /dialog\.showOpenDialog/u);
  assert.match(recoveryMain, /dialog\.showMessageBox/u);
  assert.match(recoveryMain, /diagnostic\s*=\s*diagnosticAfterFailedAttempt\(diagnostic, result, state\)/u);
  assert.match(recoveryMain, /detail:\s*diagnosticsText\(diagnostic\)/u);
  assert.doesNotMatch(recoveryMain, /detail:\s*diagnosticsText\(options\.diagnostic\)/u);
  assert.match(recoveryMain, /app\.exit\(2\)/u);
  assert.match(buildScript, /startup-recovery\.cjs/u);
  assert.match(buildScript, /startup-recovery\.html/u);
  assert.doesNotMatch(html, /[A-Za-z]:\\Users\\/u);
});
