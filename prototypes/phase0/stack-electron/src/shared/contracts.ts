export const IPC_CHANNELS = Object.freeze({
  getSecuritySummary: "security:get-summary",
  chooseManagedRoot: "managed-root:choose",
  inspectManagedRoot: "managed-root:inspect",
  runOwnedChildProbe: "owned-child:run-probe"
} as const);

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export interface ManagedRootInspection {
  readonly displayPath: string;
  readonly drive: string;
  readonly isSystemDrive: boolean;
  readonly containsSpaces: boolean;
  readonly containsUnicode: boolean;
  readonly warnings: readonly string[];
}

export interface SecuritySummary {
  readonly contextIsolation: true;
  readonly sandbox: true;
  readonly nodeIntegration: false;
  readonly rendererNetworkBlocked: true;
  readonly ipcChannels: readonly IpcChannel[];
  readonly suggestedManagedRoot: string | null;
  readonly alphaSelfUpdate: false;
}

export interface OwnedChildProbeResult {
  readonly label: string;
  readonly childPid: number;
  readonly readyObserved: boolean;
  readonly exitCode: number | null;
  readonly exitSignal: NodeJS.Signals | null;
  readonly terminated: boolean;
}

export interface ControlPlaneApi {
  getSecuritySummary(): Promise<SecuritySummary>;
  chooseManagedRoot(): Promise<ManagedRootInspection | null>;
  inspectManagedRoot(candidate: string): Promise<ManagedRootInspection>;
  runOwnedChildProbe(): Promise<OwnedChildProbeResult>;
}

export function parseManagedRootCandidate(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError("Managed root must be a string.");
  }
  if (value.length === 0 || value.length > 32_767 || value.includes("\0")) {
    throw new TypeError("Managed root has an invalid length or character.");
  }
  return value;
}
