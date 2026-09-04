import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const projectRoot = path.resolve(import.meta.dirname, "..");
const modeEnvironmentKeys = ["MINIMAX_H3_SMOKE", "MINIMAX_H3_PACKAGED_PROBE"];

function applyModeEnvironment(context, mode) {
  const prior = new Map(modeEnvironmentKeys.map((key) => [key, process.env[key]]));
  delete process.env.MINIMAX_H3_SMOKE;
  delete process.env.MINIMAX_H3_PACKAGED_PROBE;
  if (mode === "smoke") process.env.MINIMAX_H3_SMOKE = "1";
  if (mode === "probe") process.env.MINIMAX_H3_PACKAGED_PROBE = "1";
  context.after(() => {
    for (const [key, value] of prior) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

async function loadMainWithElectronMock(context, mode = "desktop") {
  applyModeEnvironment(context, mode);
  const buildRoot = await mkdtemp(path.join(os.tmpdir(), "relay-main-window-shutdown-"));
  await mkdir(path.join(buildRoot, "relay-data", "logs"), { recursive: true });
  await mkdir(path.join(buildRoot, "RelayData", "logs"), { recursive: true });
  context.after(() => rm(buildRoot, { recursive: true, force: true }));

  const windows = [];
  const app = new EventEmitter();
  const counters = {
    acceptedQuit: 0,
    beforeQuitPrevented: [],
    dispose: 0,
    errors: [],
    exits: [],
    quit: 0
  };
  class FakeBrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = new EventEmitter();
      this.destroyed = false;
      windows.push(this);
    }

    isDestroyed() { return this.destroyed; }
    loadURL() { return Promise.resolve(); }
    removeMenu() {}
    setBackgroundColor() {}
    setTitleBarOverlay() {}
    show() {}
  }

  Object.assign(app, {
    exit(code) { counters.exits.push(code); },
    getAppPath() { return projectRoot; },
    getPath() { return buildRoot; },
    getVersion() { return "0.0.0-test"; },
    isPackaged: false,
    quit() {
      counters.quit += 1;
      const event = {
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; }
      };
      app.emit("before-quit", event);
      counters.beforeQuitPrevented.push(event.defaultPrevented);
      if (!event.defaultPrevented) counters.acceptedQuit += 1;
    },
    setAppUserModelId() {},
    whenReady() { return Promise.resolve(); }
  });

  globalThis.__relayMainWindowHarness = {
    app,
    buildRoot,
    BrowserWindow: FakeBrowserWindow,
    counters,
    nativeTheme: { shouldUseDarkColors: false, themeSource: "system" },
    screen: {
      getPrimaryDisplay() {
        return { workAreaSize: { width: 1280, height: 800 } };
      }
    },
    session: {
      fromPartition() {
        return { isPersistent: () => true };
      }
    },
    windows
  };
  context.after(() => {
    delete globalThis.__relayMainWindowHarness;
  });

  const outfile = path.join(buildRoot, `main-${mode}.mjs`);
  await build({
    entryPoints: [path.join(projectRoot, "src", "main", "main.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "silent",
    plugins: [{
      name: "relay-main-window-electron-stubs",
      setup(buildApi) {
        const virtual = (filter, pathName, contents) => {
          buildApi.onResolve({ filter }, () => ({ path: pathName, namespace: "relay-main-stub" }));
          buildApi.onLoad({ filter: new RegExp(`^${pathName}$`), namespace: "relay-main-stub" }, () => ({
            contents,
            loader: "js"
          }));
        };
        virtual(/^electron$/, "electron", `
          const harness = globalThis.__relayMainWindowHarness;
          export const app = harness.app;
          export const BrowserWindow = harness.BrowserWindow;
          export const nativeImage = {
            createFromPath() { throw new Error("TEST_NATIVE_IMAGE_MUST_NOT_RUN"); }
          };
          export const nativeTheme = harness.nativeTheme;
          export const screen = harness.screen;
          export const session = harness.session;
          export const dialog = {
            showErrorBox(...args) { harness.counters.errors.push(args); },
            showMessageBox: async (...args) => {
              harness.counters.errors.push(args);
              return { response: 0 };
            },
            showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
            showSaveDialog: async () => ({ canceled: true })
          };
          export const shell = {
            openPath: async () => "",
            showItemInFolder() {}
          };
        `);
        virtual(/^\.\/ipc-registry\.js$/, "ipc-registry", `
          export function registerClosedIpcRegistry() {}
        `);
        virtual(/^\.\/security\.js$/, "security", `
          export const ADAPTER_SESSION_PARTITION = "adapter";
          export const CONTROL_SESSION_PARTITION = "control";
          export function createControlWebPreferences() { return {}; }
          export function lockDownControlSession() {}
          export function lockDownWindowNavigation() {}
        `);
        virtual(/^\.\/services\/index\.js$/, "services-index", `
          export function createControlPlaneServices() {
            return {
              getBootstrap: async () => ({
                adapterState: { streamA: "stream_a_cli", streamB: "stream_b_cli" }
              })
            };
          }
        `);
        virtual(/^\.\/services\/ab-cli-adapter\.js$/, "adapter-dispose", `
          export function createFixedFfprobeRunner() {
            return async function fixedFfprobeRunner() {
              throw new Error("TEST_FFPROBE_MUST_NOT_RUN");
            };
          }
          export function disposeAbCliAdapters() {
            globalThis.__relayMainWindowHarness.counters.dispose += 1;
          }
        `);
        virtual(/^\.\/services\/data-root\.js$/, "data-root", `
          const harness = globalThis.__relayMainWindowHarness;
          function layout(root = harness.buildRoot + "/relay-data") {
            const config = root + "/config";
            return Object.freeze({
              root,
              config,
              applicationConfig: config + "/application.json",
              installationConfig: config + "/installation.json",
              machineConfig: config + "/machine.json",
              uiConfig: config + "/ui.json",
              projects: root + "/projects",
              cache: root + "/cache",
              downloads: root + "/downloads",
              logs: root + "/logs",
              runtime: root + "/runtime",
              models: root + "/models"
            });
          }
          export async function loadDataRootPointer() {
            return Object.freeze({ version: 1, dataRoot: harness.buildRoot + "/relay-data", updatedAt: "2026-01-01T00:00:00.000Z" });
          }
          export async function ensureDataRootLayout(root) { return layout(root); }
          export async function saveDataRootPointer() { throw new Error("TEST_POINTER_WRITE_MUST_NOT_RUN"); }
          export async function configureDataRoot() { throw new Error("TEST_DATA_ROOT_CONFIGURE_MUST_NOT_RUN"); }
        `);
        virtual(/^\.\/services\/project-migration\.js$/, "project-migration", `
          export async function migrateLegacyDataToDataRoot() {
            return Object.freeze({ status: "already_current" });
          }
        `);
        virtual(/^\.\/services\/project-center\.js$/, "project-center", `
          export function createProjectCenterService() {
            return {
              initialize: async () => {},
              listProjects: async () => Object.freeze([]),
              listRecentProjects: async () => Object.freeze([])
            };
          }
        `);
        virtual(/^\.\/services\/asset-library\.js$/, "asset-library", `
          export const ASSET_DIALOG_FILTERS = Object.freeze([]);
          export function createAssetLibraryService() { return Object.freeze({}); }
        `);
        virtual(/^\.\/services\/setup-preferences\.js$/, "setup-preferences", `
          export async function loadSetupPreferences() { return null; }
          export async function saveSetupPreferences() { throw new Error("TEST_SETUP_WRITE_MUST_NOT_RUN"); }
        `);
        virtual(/^\.\/services\/ui-theme-preferences\.js$/, "theme-preferences", `
          export async function loadUiThemePreference(_path, fallback) { return fallback; }
          export async function saveUiThemePreference() {}
        `);
        virtual(/^\.\/services\/native-helper-client\.js$/, "native-helper-client", `
          export function verifyNativeHelperAtStartup() {
            return Object.freeze({
              profileId: "relay.win32.path-inspection",
              profileVersion: "1.0.0",
              enabledOpcodes: Object.freeze([257, 258]),
              appDataVolumeSupported: true,
              helperPathVerified: true
            });
          }
          export function inspectNativeDataRoot() {
            return Object.freeze({
              supported: true,
              fixedLocal: true,
              filesystem: "ntfs",
              driveType: 3
            });
          }
          export class NativeHelperStartupError extends Error {}
          export function createStartupDiagnostic() { return Object.freeze({}); }
          export function formatStartupDiagnostic() { return "fixture"; }
          export function nativeHelperStartupMessage() { return "fixture"; }
          export function nativeHelperStartupActions() { return Object.freeze(["exit"]); }
        `);
      }
    }]
  });

  await import(`${new URL(`file:///${outfile.replaceAll("\\", "/")}`).href}?mode=${mode}-${Date.now()}`);
  const readinessDeadline = Date.now() + 5_000;
  while (Date.now() < readinessDeadline) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
    const ready = mode === "probe"
      ? counters.quit >= 2 || counters.exits.length > 0
      : windows.length > 0 || counters.errors.length > 0 || counters.exits.length > 0;
    if (ready) break;
  }
  return globalThis.__relayMainWindowHarness;
}

test("closing the Relay control window quits the app and disposes owned adapters exactly once", async (context) => {
  const harness = await loadMainWithElectronMock(context);
  assert.equal(harness.windows.length, 1, JSON.stringify(harness.counters.errors));

  harness.windows[0].emit("closed");
  assert.equal(harness.counters.quit, 1, "the main control window requests application quit");
  assert.equal(harness.counters.dispose, 1, "before-quit reaches the exact owned-adapter disposer");
  assert.deepEqual(harness.counters.beforeQuitPrevented, [true], "the first quit waits for cleanup");

  await new Promise((resolvePromise) => setImmediate(resolvePromise));
  assert.equal(harness.counters.quit, 2, "cleanup completion retries the native quit");
  assert.equal(harness.counters.acceptedQuit, 1);
  assert.deepEqual(harness.counters.beforeQuitPrevented, [true, false]);

  harness.app.emit("window-all-closed");
  assert.equal(harness.counters.quit, 2, "window-all-closed cannot recursively request quit");
  assert.equal(harness.counters.dispose, 1, "the once-only disposer is not repeated");
  assert.deepEqual(harness.counters.exits, [0], "all windows closed reaches a terminal Electron exit");
  harness.app.emit("window-all-closed");
  assert.deepEqual(harness.counters.exits, [0], "the terminal exit is idempotent");
});

test("headless smoke still exits through the guarded quit path", async (context) => {
  const harness = await loadMainWithElectronMock(context, "smoke");
  assert.equal(harness.windows.length, 1, JSON.stringify(harness.counters.errors));
  harness.windows[0].webContents.emit("did-finish-load");
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 75));
  assert.equal(harness.counters.quit, 2);
  assert.equal(harness.counters.acceptedQuit, 1);
  assert.equal(harness.counters.dispose, 1);
  harness.windows[0].emit("closed");
  harness.app.emit("window-all-closed");
  assert.equal(harness.counters.quit, 2, "the later window close is idempotent");
  assert.deepEqual(harness.counters.exits, [0]);
});

test("successful packaged adapter probe uses the guarded quit path and creates no window", async (context) => {
  const harness = await loadMainWithElectronMock(context, "probe");
  assert.equal(harness.windows.length, 0);
  assert.deepEqual(harness.counters.exits, [], "success does not bypass owned-adapter cleanup with app.exit");
  assert.equal(harness.counters.quit, 2);
  assert.equal(harness.counters.acceptedQuit, 1);
  assert.deepEqual(harness.counters.beforeQuitPrevented, [true, false]);
  assert.equal(harness.counters.dispose, 1);
});
