import { join } from "node:path";
import { pathToFileURL } from "node:url";

import * as electron from "electron";
import type { BrowserWindow } from "electron";

import {
  CONTROL_SESSION_PARTITION,
  createControlWebPreferences,
  lockDownControlSession,
  lockDownWindowNavigation
} from "./security.js";
import type { DataRootFailureCode } from "./services/data-root.js";

const CHANNELS = Object.freeze({
  getState: "startup-recovery:get-state",
  retry: "startup-recovery:retry",
  choose: "startup-recovery:choose-data-root",
  diagnostics: "startup-recovery:open-diagnostics",
  exit: "startup-recovery:exit",
  stateChanged: "startup-recovery:state-changed"
});

export interface StartupRecoveryDiagnostic {
  readonly relayVersion: string;
  readonly windowsVersion: string;
  readonly architecture: string;
  readonly stage: string;
  readonly code: string;
  readonly helperExists: boolean | null;
  readonly profileMatches: boolean | null;
  readonly dataRootDriveType: string | null;
  readonly dataRootFilesystem: string | null;
  readonly dataRootSupported: boolean | null;
}

export interface StartupRecoveryState {
  readonly code: DataRootFailureCode;
  readonly message: string;
  readonly busy: boolean;
}

export interface StartupRecoveryAttemptResult {
  readonly ok: boolean;
  readonly state?: StartupRecoveryState;
  /** Fresh evidence for the attempt. Kept main-process-only. */
  readonly diagnostic?: StartupRecoveryDiagnostic;
}

export interface StartupRecoveryWindowOptions {
  readonly initialState: StartupRecoveryState;
  readonly diagnostic: StartupRecoveryDiagnostic;
  readonly onRetry: () => Promise<StartupRecoveryAttemptResult>;
  readonly onChooseDataRoot: () => Promise<StartupRecoveryAttemptResult>;
}

function diagnosticsText(diagnostic: StartupRecoveryDiagnostic): string {
  return [
    `Relay: ${diagnostic.relayVersion}`,
    `Windows: ${diagnostic.windowsVersion}`,
    `Architecture: ${diagnostic.architecture}`,
    `Stage: ${diagnostic.stage}`,
    `Code: ${diagnostic.code}`,
    `Native helper exists: ${String(diagnostic.helperExists)}`,
    `Capability profile matches: ${String(diagnostic.profileMatches)}`,
    `Data drive type: ${diagnostic.dataRootDriveType ?? "unknown"}`,
    `Data filesystem: ${diagnostic.dataRootFilesystem ?? "unknown"}`,
    `Data root supported: ${String(diagnostic.dataRootSupported)}`
  ].join("\n");
}

function diagnosticAfterFailedAttempt(
  previous: StartupRecoveryDiagnostic,
  result: StartupRecoveryAttemptResult,
  nextState: StartupRecoveryState
): StartupRecoveryDiagnostic {
  if (result.diagnostic !== undefined) return Object.freeze({ ...result.diagnostic });
  // Older callers may only return the new stable error state. Never retain the
  // previous candidate's volume evidence under the new error code.
  return Object.freeze({
    ...previous,
    stage: "data_root_bootstrap",
    code: nextState.code,
    dataRootDriveType: null,
    dataRootFilesystem: null,
    dataRootSupported: false
  });
}

export function createStartupRecoveryWindow(options: StartupRecoveryWindowOptions): BrowserWindow {
  const { app, BrowserWindow, dialog, ipcMain, screen, session } = electron;
  const rendererPath = join(import.meta.dirname, "..", "renderer", "startup-recovery.html");
  const rendererUrl = pathToFileURL(rendererPath).href;
  const preloadPath = join(import.meta.dirname, "..", "preload", "startup-recovery.cjs");
  const controlSession = session.fromPartition(CONTROL_SESSION_PARTITION, { cache: false });
  lockDownControlSession(controlSession);
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const window = new BrowserWindow({
    width: Math.min(680, Math.max(420, workArea.width - 32)),
    height: Math.min(540, Math.max(440, workArea.height - 32)),
    minWidth: Math.min(420, Math.max(320, workArea.width - 16)),
    minHeight: Math.min(440, Math.max(320, workArea.height - 16)),
    show: false,
    title: "Relay 数据目录修复",
    backgroundColor: "#f5f5f3",
    autoHideMenuBar: true,
    webPreferences: createControlWebPreferences(preloadPath)
  });
  window.removeMenu();
  lockDownWindowNavigation(window, rendererUrl);

  let state = options.initialState;
  let diagnostic = options.diagnostic;
  let operationRunning = false;
  const publish = (): void => {
    if (!window.isDestroyed()) window.webContents.send(CHANNELS.stateChanged, state);
  };
  const runAttempt = async (
    attempt: () => Promise<StartupRecoveryAttemptResult>
  ): Promise<StartupRecoveryState> => {
    if (operationRunning) return state;
    operationRunning = true;
    state = Object.freeze({ ...state, busy: true });
    publish();
    try {
      const result = await attempt();
      if (!result.ok && result.state !== undefined) {
        state = result.state;
        diagnostic = diagnosticAfterFailedAttempt(diagnostic, result, state);
      }
      return state;
    } finally {
      operationRunning = false;
      state = Object.freeze({ ...state, busy: false });
      publish();
    }
  };

  for (const channel of Object.values(CHANNELS)) ipcMain.removeHandler(channel);
  ipcMain.handle(CHANNELS.getState, () => state);
  ipcMain.handle(CHANNELS.retry, () => runAttempt(options.onRetry));
  ipcMain.handle(CHANNELS.choose, () => runAttempt(options.onChooseDataRoot));
  ipcMain.handle(CHANNELS.diagnostics, async () => {
    await dialog.showMessageBox(window, {
      type: "info",
      title: "Relay 启动诊断信息",
      message: "可将以下最小诊断信息提供给 Relay 客服。",
      detail: diagnosticsText(diagnostic),
      buttons: ["关闭"],
      defaultId: 0,
      noLink: true
    });
    return true;
  });
  ipcMain.handle(CHANNELS.exit, () => {
    app.exit(2);
    return true;
  });

  window.once("ready-to-show", () => window.show());
  window.once("closed", () => {
    for (const channel of Object.values(CHANNELS)) ipcMain.removeHandler(channel);
    app.exit(2);
  });
  void window.loadURL(rendererUrl);
  return window;
}
