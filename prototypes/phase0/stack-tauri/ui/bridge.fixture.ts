// UNCOMPILED DESIGN FIXTURE. The actual Tauri JavaScript API dependency is unresolved.

export type CommandName =
  | "security_get_summary"
  | "choose_managed_root"
  | "inspect_managed_root"
  | "run_owned_child_probe";

export interface SecuritySummary {
  readonly controlPlaneOnly: true;
  readonly remoteNavigationAllowed: false;
  readonly genericInvokeExposed: false;
  readonly commandCount: 4;
}

export interface ManagedRootInspection {
  readonly accepted: boolean;
  readonly displayPath?: string;
  readonly drive?: string;
  readonly isSystemDrive?: boolean;
  readonly containsSpaces?: boolean;
  readonly containsUnicode?: boolean;
  readonly warning?: string;
  readonly error?: string;
}

export interface OwnedChildResult {
  readonly ready: boolean;
  readonly terminated: boolean;
  readonly directChildOnly: true;
  readonly processTreeContained: false;
}

interface NarrowInvoker {
  invoke<T>(command: CommandName, payload?: Readonly<Record<string, string>>): Promise<T>;
}

export function createControlPlaneBridge(invoker: NarrowInvoker) {
  return Object.freeze({
    getSecuritySummary: () => invoker.invoke<SecuritySummary>("security_get_summary"),
    chooseManagedRoot: () => invoker.invoke<string>("choose_managed_root"),
    inspectManagedRoot: (candidate: string, systemDrive: string) =>
      invoker.invoke<ManagedRootInspection>("inspect_managed_root", { candidate, systemDrive }),
    runOwnedChildProbe: (label: string) =>
      invoker.invoke<OwnedChildResult>("run_owned_child_probe", { label }),
  });
}
