import { contextBridge, ipcRenderer } from "electron";

const CHANNELS = Object.freeze({
  getState: "startup-recovery:get-state",
  retry: "startup-recovery:retry",
  choose: "startup-recovery:choose-data-root",
  diagnostics: "startup-recovery:open-diagnostics",
  exit: "startup-recovery:exit",
  stateChanged: "startup-recovery:state-changed"
});

interface RecoveryState {
  readonly code: string;
  readonly message: string;
  readonly busy: boolean;
}

contextBridge.exposeInMainWorld("startupRecovery", Object.freeze({
  getState: () => ipcRenderer.invoke(CHANNELS.getState) as Promise<RecoveryState>,
  retry: () => ipcRenderer.invoke(CHANNELS.retry) as Promise<RecoveryState>,
  chooseDataRoot: () => ipcRenderer.invoke(CHANNELS.choose) as Promise<RecoveryState>,
  openDiagnostics: () => ipcRenderer.invoke(CHANNELS.diagnostics) as Promise<boolean>,
  exit: () => ipcRenderer.invoke(CHANNELS.exit) as Promise<boolean>,
  onStateChanged: (listener: (state: RecoveryState) => void) => {
    const handler = (_event: unknown, state: RecoveryState): void => listener(state);
    ipcRenderer.on(CHANNELS.stateChanged, handler);
    return () => ipcRenderer.removeListener(CHANNELS.stateChanged, handler);
  }
}));

