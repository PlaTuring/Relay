import { contextBridge, ipcRenderer } from "electron";

import {
  IPC_CHANNELS,
  type ControlPlaneApi
} from "../shared/contracts";

const controlPlaneApi: ControlPlaneApi = Object.freeze({
  getSecuritySummary: () => ipcRenderer.invoke(IPC_CHANNELS.getSecuritySummary),
  chooseManagedRoot: () => ipcRenderer.invoke(IPC_CHANNELS.chooseManagedRoot),
  inspectManagedRoot: (candidate: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.inspectManagedRoot, candidate),
  runOwnedChildProbe: () => ipcRenderer.invoke(IPC_CHANNELS.runOwnedChildProbe)
});

contextBridge.exposeInMainWorld("controlPlane", controlPlaneApi);
