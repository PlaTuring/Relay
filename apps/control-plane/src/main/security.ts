import type { BrowserWindow, Session, WebPreferences } from "electron";

export const CONTROL_SESSION_PARTITION = "persist:minimax-h3-control-plane";
export const ADAPTER_SESSION_PARTITION = "minimax-h3-adapter-offline";

export function createControlWebPreferences(preloadPath: string): WebPreferences {
  return {
    preload: preloadPath,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webviewTag: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    // ComfyUI is opened in a separate foreground window during handoff. Keep
    // Relay's local control renderer responsive so the IPC completion, modal
    // feedback and busy-state release are not suspended while it is occluded.
    backgroundThrottling: false,
    spellcheck: false,
    partition: CONTROL_SESSION_PARTITION
  };
}

export function lockDownControlSession(controlSession: Session): void {
  controlSession.setPermissionCheckHandler(() => false);
  controlSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  controlSession.webRequest.onBeforeRequest(
    {
      urls: [
        "http://*/*",
        "https://*/*",
        "ws://*/*",
        "wss://*/*",
        "ftp://*/*"
      ]
    },
    (_details, callback) => callback({ cancel: true })
  );
  controlSession.on("will-download", (event) => event.preventDefault());
}

export function lockDownWindowNavigation(
  window: BrowserWindow,
  expectedRendererUrl: string
): void {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (targetUrl !== expectedRendererUrl) {
      event.preventDefault();
    }
  });
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
}
