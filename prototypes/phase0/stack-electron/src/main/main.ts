import path from "node:path";
import { pathToFileURL } from "node:url";
import { writeFile } from "node:fs/promises";

import {
  app,
  BrowserWindow,
  session,
  type Session,
  type WebPreferences
} from "electron";

import { registerStrictIpc } from "./ipc";
import { runOwnedChildProbe } from "./owned-child";
import { createRendererWebPreferences } from "./security";

app.disableHardwareAcceleration();
app.commandLine.appendSwitch("disk-cache-size", "10485760");
app.commandLine.appendSwitch("media-cache-size", "0");

const profileOverride = process.env.MINIMAX_H3_SPIKE_PROFILE;
if (profileOverride) {
  const profilePath = path.resolve(profileOverride);
  app.setPath("userData", profilePath);
  app.setPath("sessionData", path.join(profilePath, "Session"));
}

const selfTest = process.argv.includes("--self-test");

function denyRendererNetwork(targetSession: Session): void {
  targetSession.setPermissionCheckHandler(() => false);
  targetSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  targetSession.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
    (_details, callback) => callback({ cancel: true })
  );
}

interface MainWindowResult {
  readonly window: BrowserWindow;
  readonly webPreferences: WebPreferences;
}

async function createMainWindow(
  rendererHtml: string,
  preloadPath: string
): Promise<MainWindowResult> {
  const rendererUrl = pathToFileURL(rendererHtml).toString();
  const webPreferences = createRendererWebPreferences(preloadPath);
  const window = new BrowserWindow({
    width: 880,
    height: 680,
    minWidth: 680,
    minHeight: 520,
    show: !selfTest,
    title: "MiniMax H3 控制平面技术栈探针",
    backgroundColor: "#f5f7fb",
    webPreferences
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (targetUrl !== rendererUrl) {
      event.preventDefault();
    }
  });

  await window.loadFile(rendererHtml);
  return { window, webPreferences };
}

async function start(): Promise<void> {
  denyRendererNetwork(session.defaultSession);

  const rendererHtml = path.join(__dirname, "../renderer/index.html");
  const preloadPath = path.join(__dirname, "../preload/index.js");
  const childScript = path.join(__dirname, "../child/harmless-child.js");
  const trustedRendererUrl = pathToFileURL(rendererHtml).toString();
  const unregisterIpc = registerStrictIpc({
    trustedRendererUrl,
    childExecutable: process.execPath,
    childScript
  });

  app.once("will-quit", unregisterIpc);
  const { window, webPreferences } = await createMainWindow(rendererHtml, preloadPath);

  if (selfTest) {
    const rendererProbe = (await window.webContents.executeJavaScript(
      `Promise.resolve(window.controlPlane.getSecuritySummary()).then((security) => ({
        apiType: typeof window.controlPlane,
        requireType: typeof window.require,
        processType: typeof window.process,
        ipcChannelCount: security.ipcChannels.length
      }))`,
      true
    )) as {
      readonly apiType: string;
      readonly requireType: string;
      readonly processType: string;
      readonly ipcChannelCount: number;
    };
    const childResult = await runOwnedChildProbe({
      executable: process.execPath,
      childScript,
      label: "Electron 主进程 空格与中文 Ω",
      environment: { ELECTRON_RUN_AS_NODE: "1" }
    });
    const result = {
      event: "electron-self-test",
      contextIsolation: webPreferences.contextIsolation,
      sandbox: webPreferences.sandbox,
      nodeIntegration: webPreferences.nodeIntegration,
      preloadApiReady: rendererProbe.apiType === "object",
      rendererRequireType: rendererProbe.requireType,
      rendererProcessType: rendererProbe.processType,
      ipcChannelCount: rendererProbe.ipcChannelCount,
      childReady: childResult.readyObserved,
      childTerminated: childResult.terminated
    } as const;
    console.log(JSON.stringify(result));
    if (profileOverride) {
      await writeFile(
        path.join(path.resolve(profileOverride), "self-test-result.json"),
        `${JSON.stringify(result, null, 2)}\n`,
        "utf8"
      );
    }
    window.destroy();
    app.quit();
  }
}

app.whenReady().then(start).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown startup error";
  console.error(`Electron stack spike failed: ${message}`);
  app.exit(1);
});

app.on("window-all-closed", () => {
  app.quit();
});
