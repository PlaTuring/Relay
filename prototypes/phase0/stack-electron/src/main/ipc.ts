import { existsSync } from "node:fs";
import path from "node:path";
import {
  dialog,
  ipcMain,
  type IpcMainInvokeEvent
} from "electron";

import {
  IPC_CHANNELS,
  parseManagedRootCandidate,
  type SecuritySummary
} from "../shared/contracts";
import { runOwnedChildProbe } from "./owned-child";
import {
  inspectWindowsManagedRoot,
  suggestedManagedRoot
} from "./path-policy";

export interface IpcRegistrationOptions {
  readonly trustedRendererUrl: string;
  readonly childExecutable: string;
  readonly childScript: string;
}

function requireTrustedSender(event: IpcMainInvokeEvent, expectedUrl: string): void {
  if (event.senderFrame?.url !== expectedUrl) {
    throw new Error("Rejected IPC from an untrusted renderer frame.");
  }
}

export function registerStrictIpc(options: IpcRegistrationOptions): () => void {
  const channels = Object.values(IPC_CHANNELS);
  const securitySummary: SecuritySummary = Object.freeze({
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    rendererNetworkBlocked: true,
    ipcChannels: Object.freeze([...channels]),
    suggestedManagedRoot: suggestedManagedRoot(existsSync),
    alphaSelfUpdate: false
  });

  ipcMain.handle(IPC_CHANNELS.getSecuritySummary, (event) => {
    requireTrustedSender(event, options.trustedRendererUrl);
    return securitySummary;
  });

  ipcMain.handle(IPC_CHANNELS.chooseManagedRoot, async (event) => {
    requireTrustedSender(event, options.trustedRendererUrl);
    const suggested = suggestedManagedRoot(existsSync);
    const result = await dialog.showOpenDialog({
      title: "选择 MiniMax H3 受管数据位置",
      ...(suggested ? { defaultPath: path.win32.dirname(suggested) } : {}),
      buttonLabel: "使用此文件夹",
      properties: ["openDirectory", "createDirectory", "dontAddToRecent"]
    });

    const selected = result.filePaths[0];
    if (result.canceled || !selected) {
      return null;
    }
    return inspectWindowsManagedRoot(selected);
  });

  ipcMain.handle(IPC_CHANNELS.inspectManagedRoot, (event, value: unknown) => {
    requireTrustedSender(event, options.trustedRendererUrl);
    return inspectWindowsManagedRoot(parseManagedRootCandidate(value));
  });

  ipcMain.handle(IPC_CHANNELS.runOwnedChildProbe, async (event) => {
    requireTrustedSender(event, options.trustedRendererUrl);
    return runOwnedChildProbe({
      executable: options.childExecutable,
      childScript: options.childScript,
      label: "有界子进程 探针 Ω",
      environment: { ELECTRON_RUN_AS_NODE: "1" }
    });
  });

  return () => {
    for (const channel of channels) {
      ipcMain.removeHandler(channel);
    }
  };
}
