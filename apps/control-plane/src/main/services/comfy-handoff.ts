import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  unlink
} from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

import { BrowserWindow, dialog, session, type Session } from "electron";

import type { JsonValue } from "./ab-cli-adapter.js";
import type { VerifiedComfyRoot } from "./comfy-root.js";
import { ControlPlaneServiceError } from "./errors.js";

const COMFY_ORIGIN = "http://127.0.0.1:8188/";
const COMFY_HANDOFF_PARTITION = "minimax-h3-comfy-handoff";
const MAX_COMPILED_GRAPH_NODES = 512;
const MAX_COMPILED_SUBGRAPHS = 16;
const PINNED_COMFY_CORE_VERSION = "0.33.0";
const FRONTEND_SCRIPT_DEADLINE_MS = 25_000;
const READY_SCRIPT_DEADLINE_MS = 2_000;
const LOCAL_NAVIGATION_DEADLINE_MS = 5_000;
const FRONTEND_HANDOFF_RESULT_POLL_MS = 100;
const FRONTEND_HANDOFF_RESULT_ATTEMPTS = 240;
const NODE_DEFINITION_REFRESH_GRACE_MS = 1_000;
const guardedSessions = new WeakSet<Session>();
const rendererGoneWindows = new WeakSet<BrowserWindow>();
const userClosingWindows = new WeakSet<BrowserWindow>();
const closeDecisionWindows = new WeakSet<BrowserWindow>();
const closeAllowedWindows = new WeakSet<BrowserWindow>();
const managedGraphWindows = new WeakSet<BrowserWindow>();
const refreshedMediaFingerprintByWindow = new WeakMap<BrowserWindow, string>();
let comfyWindow: BrowserWindow | null = null;
let handoffQueue: Promise<void> = Promise.resolve();
let handoffCloseGeneration = 0;

type HandoffResponse = {
  readonly visible: boolean;
  readonly automaticallyLoaded: boolean;
};

type NodeDefinitionRefreshDisposition = "not_required" | "reused" | "performed" | "failed";
type HandoffTimingOutcome = "loaded" | "visible_not_loaded" | "window_closed" | "renderer_gone";

export type ComfyHandoffTimingEvidence = {
  readonly schemaVersion: "1.0.0";
  readonly outcome: HandoffTimingOutcome;
  readonly totalMs: number;
  readonly capabilityReadinessMs: number;
  readonly nodeDefinitionRefresh: {
    readonly disposition: NodeDefinitionRefreshDisposition;
    readonly elapsedMs: number;
  };
  readonly workflowLoadConfirmationMs: number;
};

let lastHandoffTimingEvidence: ComfyHandoffTimingEvidence | null = null;

function boundedElapsed(startedAt: number): number {
  return Math.max(0, Math.round(Date.now() - startedAt));
}

function recordHandoffTimingEvidence(input: {
  readonly outcome: HandoffTimingOutcome;
  readonly totalMs: number;
  readonly capabilityReadinessMs: number;
  readonly nodeDefinitionRefreshDisposition: NodeDefinitionRefreshDisposition;
  readonly nodeDefinitionRefreshMs: number;
  readonly workflowLoadConfirmationMs: number;
}): void {
  lastHandoffTimingEvidence = Object.freeze({
    schemaVersion: "1.0.0",
    outcome: input.outcome,
    totalMs: Math.max(0, Math.round(input.totalMs)),
    capabilityReadinessMs: Math.max(0, Math.round(input.capabilityReadinessMs)),
    nodeDefinitionRefresh: Object.freeze({
      disposition: input.nodeDefinitionRefreshDisposition,
      elapsedMs: Math.max(0, Math.round(input.nodeDefinitionRefreshMs))
    }),
    workflowLoadConfirmationMs: Math.max(0, Math.round(input.workflowLoadConfirmationMs))
  });
}

export function getLastComfyHandoffTimingEvidence(): ComfyHandoffTimingEvidence | null {
  return lastHandoffTimingEvidence;
}

const CLOSED_HANDOFF_RESPONSE: HandoffResponse = Object.freeze({
  visible: false,
  automaticallyLoaded: false
});

function sameWindowsPath(left: string, right: string): boolean {
  return resolve(left).toLocaleLowerCase("en-US") === resolve(right).toLocaleLowerCase("en-US");
}

function isContained(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child.length > 0 && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

async function requireDirectDirectory(directory: string): Promise<string> {
  const metadata = await lstat(directory);
  const identity = await realpath(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || !sameWindowsPath(identity, directory)) {
    throw new ControlPlaneServiceError(
      "WORKFLOW_EXPORT_FAILED",
      "ComfyUI 工作流目录不是普通本地目录。"
    );
  }
  return identity;
}

async function ensureDirectChildDirectory(parent: string, name: string): Promise<string> {
  const parentIdentity = await requireDirectDirectory(parent);
  const candidate = join(parentIdentity, name);
  try {
    await mkdir(candidate, { recursive: false });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const candidateIdentity = await requireDirectDirectory(candidate);
  if (!isContained(parentIdentity, candidateIdentity)) {
    throw new ControlPlaneServiceError(
      "WORKFLOW_EXPORT_FAILED",
      "ComfyUI 工作流目录越过了已验证根目录。"
    );
  }
  return candidateIdentity;
}

async function ensureWorkflowDirectory(root: VerifiedComfyRoot): Promise<string> {
  const comfyIdentity = await requireDirectDirectory(root.comfyDirectory);
  const user = await ensureDirectChildDirectory(comfyIdentity, "user");
  const profile = await ensureDirectChildDirectory(user, "default");
  const workflows = await ensureDirectChildDirectory(profile, "workflows");
  if (!sameWindowsPath(workflows, root.workflowDirectory)) {
    throw new ControlPlaneServiceError(
      "WORKFLOW_EXPORT_FAILED",
      "ComfyUI workflow storage 与已验证目录不一致。"
    );
  }
  return workflows;
}

export async function storeWorkflowInComfyLibrary(options: {
  readonly root: VerifiedComfyRoot;
  readonly workflow: JsonValue;
  readonly preferredFileName: string;
}): Promise<{ readonly fileName: string; readonly fullPath: string }> {
  const workflowDirectory = await ensureWorkflowDirectory(options.root);
  const bytes = Buffer.from(`${JSON.stringify(options.workflow, null, 2)}\n`, "utf8");
  if (bytes.byteLength === 0 || bytes.byteLength > 4 * 1024 * 1024) {
    throw new ControlPlaneServiceError("WORKFLOW_EXPORT_FAILED", "工作流文件超过安全上限。");
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  const preferredFileName = options.preferredFileName.normalize("NFKC");
  if (
    basename(preferredFileName) !== preferredFileName ||
    !preferredFileName.endsWith(".json") ||
    preferredFileName.length < 6 ||
    preferredFileName.length > 160 ||
    /[<>:"/\\|?*\u0000-\u001f\u007f]/u.test(preferredFileName)
  ) {
    throw new ControlPlaneServiceError("WORKFLOW_EXPORT_FAILED", "工作流名称不安全。");
  }
  const preferredStem = preferredFileName.slice(0, -".json".length);
  const temporaryPath = join(workflowDirectory, `.minimax-h3-${randomUUID()}.tmp`);
  const temporary = await open(temporaryPath, "wx", 0o600);
  try {
    await temporary.writeFile(bytes);
    await temporary.sync();
  } finally {
    await temporary.close();
  }

  try {
    for (let suffix = 0; suffix < 100; suffix += 1) {
      const fileName = `${preferredStem}${suffix === 0 ? "" : `-${suffix + 1}`}.json`;
      const fullPath = join(workflowDirectory, fileName);
      try {
        await link(temporaryPath, fullPath);
        const metadata = await lstat(fullPath);
        const identity = await realpath(fullPath);
        if (
          !metadata.isFile() ||
          metadata.isSymbolicLink() ||
          !isContained(workflowDirectory, identity) ||
          basename(identity) !== fileName
        ) {
          throw new Error("unsafe-workflow-file");
        }
        const reread = await readFile(identity);
        if (createHash("sha256").update(reread).digest("hex") !== digest) {
          throw new Error("workflow-hash-mismatch");
        }
        return Object.freeze({ fileName, fullPath: identity });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          try {
            const metadata = await lstat(fullPath);
            const identity = await realpath(fullPath);
            if (
              metadata.isFile() &&
              !metadata.isSymbolicLink() &&
              isContained(workflowDirectory, identity) &&
              basename(identity) === fileName
            ) {
              const existing = await readFile(identity);
              if (createHash("sha256").update(existing).digest("hex") === digest) {
                return Object.freeze({ fileName, fullPath: identity });
              }
            }
          } catch {
            // A different or unreadable file keeps the deterministic suffix path.
          }
          continue;
        }
        throw error;
      }
    }
    throw new Error("workflow-name-exhausted");
  } catch (error) {
    if (error instanceof ControlPlaneServiceError) throw error;
    throw new ControlPlaneServiceError(
      "WORKFLOW_EXPORT_FAILED",
      "无法安全写入 ComfyUI workflow storage。"
    );
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

function isAllowedComfyUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "ws:") &&
      parsed.hostname === "127.0.0.1" &&
      parsed.port === "8188" &&
      parsed.username.length === 0 &&
      parsed.password.length === 0
    );
  } catch {
    return false;
  }
}

function guardHandoffSession(target: Session): void {
  if (guardedSessions.has(target)) return;
  guardedSessions.add(target);
  target.setPermissionCheckHandler(() => false);
  target.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  target.on("will-download", (event) => event.preventDefault());
  target.webRequest.onBeforeRequest(
    { urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*"] },
    (details, callback) => callback({ cancel: !isAllowedComfyUrl(details.url) })
  );
}

const COMFY_GRAPH_DIRTY_EXPRESSION = `(() => {
  const comfyApp = globalThis.app;
  const baseline = globalThis.__minimaxH3ManagedGraphBaseline;
  if (typeof baseline !== "string") return true;
  if (comfyApp === null || typeof comfyApp !== "object") return true;
  if (comfyApp.graph === null || typeof comfyApp.graph !== "object") return true;
  if (typeof comfyApp.graph.serialize !== "function") return true;
  try {
    return JSON.stringify(comfyApp.graph.serialize()) !== baseline;
  } catch {
    return true;
  }
})()`;

async function managedGraphIsDirty(window: BrowserWindow): Promise<boolean> {
  if (!managedGraphWindows.has(window)) return false;
  try {
    const result = await executeFrontendScriptWithDeadline(
      window,
      COMFY_GRAPH_DIRTY_EXPRESSION,
      READY_SCRIPT_DEADLINE_MS
    );
    return result === SCRIPT_DEADLINE || result !== false;
  } catch {
    return true;
  }
}

function markUserClosing(window: BrowserWindow): void {
  if (!userClosingWindows.has(window)) {
    userClosingWindows.add(window);
    handoffCloseGeneration += 1;
  }
  if (comfyWindow === window) comfyWindow = null;
}

async function finishUserCloseDecision(window: BrowserWindow): Promise<void> {
  let approved = true;
  if (!window.isDestroyed() && await managedGraphIsDirty(window)) {
    try {
      const result = await dialog.showMessageBox(window, {
        type: "warning",
        title: "关闭 ComfyUI",
        message: "当前画布有尚未保存的修改。",
        detail: "工作流原文件仍在 ComfyUI 的 Workflows 中；继续关闭会放弃你在画布上的后续修改。",
        buttons: ["返回画布", "放弃修改并关闭"],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      });
      approved = result.response === 1;
    } catch {
      approved = false;
    }
  }

  closeDecisionWindows.delete(window);
  if (window.isDestroyed()) return;
  if (!approved) {
    userClosingWindows.delete(window);
    if (comfyWindow === null) comfyWindow = window;
    return;
  }
  closeAllowedWindows.add(window);
  window.close();
}

function createComfyWindow(): BrowserWindow {
  const handoffSession = session.fromPartition(COMFY_HANDOFF_PARTITION, { cache: false });
  guardHandoffSession(handoffSession);
  const iconPath = resolve(import.meta.dirname, "..", "..", "renderer", "assets", "relay-icon.png");
  const window = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 960,
    minHeight: 680,
    show: false,
    backgroundColor: "#111318",
    icon: iconPath,
    title: "ComfyUI · MiniMax H3 workflow",
    autoHideMenuBar: true,
    webPreferences: {
      session: handoffSession,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: false,
      safeDialogs: true
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.webContents.on("will-prevent-unload", (event) => {
    // Electron's semantics are inverted: preventDefault() permits the unload.
    // Only do that after the close handler has compared the graph with the
    // managed baseline and, when needed, received explicit user confirmation.
    if (closeAllowedWindows.has(window)) event.preventDefault();
  });
  window.webContents.on("render-process-gone", () => {
    rendererGoneWindows.add(window);
    if (comfyWindow === window) comfyWindow = null;
    if (!window.isDestroyed()) window.destroy();
  });
  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (!isAllowedComfyUrl(targetUrl)) event.preventDefault();
  });
  window.on("close", (event) => {
    if (closeAllowedWindows.has(window)) {
      markUserClosing(window);
      return;
    }
    event.preventDefault();
    if (closeDecisionWindows.has(window)) return;
    closeDecisionWindows.add(window);
    markUserClosing(window);
    void finishUserCloseDecision(window);
  });
  window.on("closed", () => {
    if (comfyWindow === window) comfyWindow = null;
  });
  return window;
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

const SCRIPT_DEADLINE = Symbol("comfy-frontend-script-deadline");

async function executeFrontendScriptWithDeadline(
  window: BrowserWindow,
  expression: string,
  deadlineMilliseconds = FRONTEND_SCRIPT_DEADLINE_MS
): Promise<unknown | typeof SCRIPT_DEADLINE> {
  const execution = window.webContents.executeJavaScript(expression, true);
  // Electron cannot cancel an already-dispatched executeJavaScript call. Attach
  // a rejection handler so a late renderer failure never becomes unhandled,
  // while still guaranteeing that the Relay IPC caller regains control.
  void execution.catch(() => undefined);
  let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<typeof SCRIPT_DEADLINE>((resolvePromise) => {
    deadlineTimer = setTimeout(() => resolvePromise(SCRIPT_DEADLINE), deadlineMilliseconds);
  });
  try {
    return await Promise.race([execution, deadline]);
  } finally {
    if (deadlineTimer !== null) clearTimeout(deadlineTimer);
  }
}

type OperationOutcome = "resolved" | "rejected" | "timed_out";

async function settleOperationWithDeadline(
  operation: Promise<unknown>,
  deadlineMilliseconds: number
): Promise<OperationOutcome> {
  void operation.catch(() => undefined);
  let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<OperationOutcome>((resolvePromise) => {
    deadlineTimer = setTimeout(() => resolvePromise("timed_out"), deadlineMilliseconds);
  });
  try {
    return await Promise.race([
      operation.then<OperationOutcome, OperationOutcome>(() => "resolved", () => "rejected"),
      deadline
    ]);
  } finally {
    if (deadlineTimer !== null) clearTimeout(deadlineTimer);
  }
}

function enqueueHandoff(operation: () => Promise<HandoffResponse>): Promise<HandoffResponse> {
  const acceptedCloseGeneration = handoffCloseGeneration;
  const runUnlessClosed = (): Promise<HandoffResponse> =>
    acceptedCloseGeneration === handoffCloseGeneration
      ? operation()
      : Promise.resolve(CLOSED_HANDOFF_RESPONSE);
  const result = handoffQueue.then(runUnlessClosed, runUnlessClosed);
  handoffQueue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

type HandoffWindowState = "active" | "window_closed" | "renderer_gone";

function handoffWindowState(window: BrowserWindow): HandoffWindowState {
  if (rendererGoneWindows.has(window)) return "renderer_gone";
  if (userClosingWindows.has(window) || window.isDestroyed()) return "window_closed";
  return "active";
}

function hasAllowedComfyDocument(window: BrowserWindow): boolean {
  if (window.isDestroyed()) return false;
  try {
    return isAllowedComfyUrl(window.webContents.getURL());
  } catch {
    return false;
  }
}

const COMFY_READY_EXPRESSION = `(() => {
  const comfyApp = globalThis.app;
  if (comfyApp === null || typeof comfyApp !== "object") return false;
  if (typeof comfyApp.loadGraphData !== "function") return false;
  if (comfyApp.vueAppReady !== undefined && comfyApp.vueAppReady !== true) return false;
  if (comfyApp.isGraphReady !== undefined && comfyApp.isGraphReady !== true) return false;
  if (comfyApp.canvas === null || typeof comfyApp.canvas !== "object") return false;
  if (comfyApp.extensionManager === null || typeof comfyApp.extensionManager !== "object") return false;
  if (comfyApp.extensionManager.spinner !== false) return false;
  return comfyApp.configuringGraph !== true;
})()`;

async function waitForComfyReady(window: BrowserWindow, attempts: number): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (window.isDestroyed() || !hasAllowedComfyDocument(window)) return false;
    try {
      if ((await executeFrontendScriptWithDeadline(
        window,
        COMFY_READY_EXPRESSION,
        READY_SCRIPT_DEADLINE_MS
      )) === true) {
        return true;
      }
    } catch {
      // Navigation may have completed before the frontend publishes its app singleton.
    }
    if (attempt + 1 < attempts) await delay(250);
  }
  return false;
}

async function loadLocalComfy(window: BrowserWindow, attempts: number): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (window.isDestroyed()) return false;
    try {
      const outcome = await settleOperationWithDeadline(
        window.loadURL(COMFY_ORIGIN),
        LOCAL_NAVIGATION_DEADLINE_MS
      );
      if (outcome !== "rejected" && hasAllowedComfyDocument(window)) return true;
    } catch {
      // The bounded retry loop handles a locally starting ComfyUI instance.
    }
    if (attempt + 1 < attempts) await delay(750);
  }
  return false;
}

type PinnedMediaScan = "absent" | "present" | "invalid";

function jsonRecord(value: JsonValue | undefined): Readonly<Record<string, JsonValue>> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, JsonValue>>
    : null;
}

function isPinnedCoreLoadImage(candidate: JsonValue): boolean {
  const node = jsonRecord(candidate);
  const properties = jsonRecord(node?.properties);
  const named = jsonRecord(node?.widgets_values_named);
  const positional = node?.widgets_values;
  const imageName = named?.image;
  return (
    node?.type === "LoadImage" &&
    properties?.cnr_id === "comfy-core" &&
    properties?.ver === PINNED_COMFY_CORE_VERSION &&
    typeof imageName === "string" &&
    imageName.length > 0 &&
    named?.upload === "image" &&
    Array.isArray(positional) &&
    positional.length === 2 &&
    positional[0] === imageName &&
    positional[1] === "image"
  );
}

function scanCertifiedNodeArray(value: JsonValue | undefined): PinnedMediaScan {
  if (!Array.isArray(value)) return "absent";
  if (value.length > MAX_COMPILED_GRAPH_NODES) return "invalid";
  for (let index = 0; index < value.length; index += 1) {
    if (isPinnedCoreLoadImage(value[index])) return "present";
  }
  return "absent";
}

function scanPinnedLocalMediaInput(workflow: JsonValue): PinnedMediaScan {
  const root = jsonRecord(workflow);
  if (root === null) return "invalid";

  const rootResult = scanCertifiedNodeArray(root.nodes);
  if (rootResult === "invalid") return "invalid";
  let result = rootResult;

  const definitions = jsonRecord(root.definitions);
  if (definitions === null || definitions.subgraphs === undefined) return result;
  const subgraphs = definitions.subgraphs;
  if (!Array.isArray(subgraphs) || subgraphs.length > MAX_COMPILED_SUBGRAPHS) return "invalid";
  for (let definitionIndex = 0; definitionIndex < subgraphs.length; definitionIndex += 1) {
    const definition = jsonRecord(subgraphs[definitionIndex]);
    if (definition === null) return "invalid";
    const definitionResult = scanCertifiedNodeArray(definition.nodes);
    if (definitionResult === "invalid") return "invalid";
    if (definitionResult === "present") result = "present";
  }
  return result;
}

function pinnedLocalMediaFingerprint(workflow: JsonValue): string | null {
  if (scanPinnedLocalMediaInput(workflow) === "invalid") return null;
  const root = jsonRecord(workflow);
  if (root === null) return null;
  const imageNames: string[] = [];
  const collect = (value: JsonValue | undefined): boolean => {
    if (!Array.isArray(value) || value.length > MAX_COMPILED_GRAPH_NODES) return false;
    for (const candidate of value) {
      if (!isPinnedCoreLoadImage(candidate)) continue;
      const node = jsonRecord(candidate);
      const named = jsonRecord(node?.widgets_values_named);
      imageNames.push(named?.image as string);
    }
    return true;
  };
  if (!collect(root.nodes)) return null;
  const definitions = jsonRecord(root.definitions);
  if (definitions !== null && definitions.subgraphs !== undefined) {
    if (!Array.isArray(definitions.subgraphs) || definitions.subgraphs.length > MAX_COMPILED_SUBGRAPHS) return null;
    for (const candidate of definitions.subgraphs) {
      const definition = jsonRecord(candidate);
      if (definition === null || !collect(definition.nodes)) return null;
    }
  }
  return createHash("sha256").update(imageNames.sort().join("\0"), "utf8").digest("hex");
}

type GraphLoadStatus = "loaded" | "failed" | "window_closed" | "renderer_gone";
type GraphLoadResult = {
  readonly status: GraphLoadStatus;
  readonly nodeDefinitionRefreshDisposition: NodeDefinitionRefreshDisposition;
  readonly nodeDefinitionRefreshMs: number;
  readonly workflowLoadConfirmationMs: number;
};

function frontendGraphLoadResult(value: unknown): {
  readonly status: "loaded" | "failed" | "stale";
  readonly nodeDefinitionRefreshMs: number;
  readonly workflowLoadConfirmationMs: number;
} | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!["loaded", "failed", "stale"].includes(String(record.status))
    || !Number.isSafeInteger(record.node_definition_refresh_ms)
    || (record.node_definition_refresh_ms as number) < 0
    || !Number.isSafeInteger(record.workflow_load_confirmation_ms)
    || (record.workflow_load_confirmation_ms as number) < 0) return null;
  return Object.freeze({
    status: record.status as "loaded" | "failed" | "stale",
    nodeDefinitionRefreshMs: record.node_definition_refresh_ms as number,
    workflowLoadConfirmationMs: record.workflow_load_confirmation_ms as number
  });
}

async function loadGraphData(
  window: BrowserWindow,
  workflow: JsonValue,
  workflowName: string
): Promise<GraphLoadResult> {
  const loadStartedAt = Date.now();
  const mediaScan = scanPinnedLocalMediaInput(workflow);
  const initialRefreshDisposition: NodeDefinitionRefreshDisposition = mediaScan === "present"
    ? "reused"
    : "not_required";
  const complete = (
    status: GraphLoadStatus,
    frontend: ReturnType<typeof frontendGraphLoadResult> = null,
    refreshDisposition: NodeDefinitionRefreshDisposition = initialRefreshDisposition
  ): GraphLoadResult => Object.freeze({
    status,
    nodeDefinitionRefreshDisposition: refreshDisposition,
    nodeDefinitionRefreshMs: frontend?.nodeDefinitionRefreshMs ?? 0,
    workflowLoadConfirmationMs: frontend?.workflowLoadConfirmationMs ?? boundedElapsed(loadStartedAt)
  });
  if (mediaScan === "invalid") return complete("failed");
  const mediaFingerprint = pinnedLocalMediaFingerprint(workflow);
  if (mediaFingerprint === null) return complete("failed");
  const encodedWorkflow = JSON.stringify(JSON.stringify(workflow));
  const encodedName = JSON.stringify(workflowName.replace(/\.json$/iu, ""));
  const handoffToken = randomUUID();
  const encodedHandoffToken = JSON.stringify(handoffToken);
  const requiresNodeDefinitionRefresh = mediaScan === "present"
    && refreshedMediaFingerprintByWindow.get(window) !== mediaFingerprint;
  const refreshDisposition: NodeDefinitionRefreshDisposition = requiresNodeDefinitionRefresh
    ? "performed"
    : initialRefreshDisposition;
  const expression = `(async () => {
    const workflow = JSON.parse(${encodedWorkflow});
    const handoffToken = ${encodedHandoffToken};
    const handoffMarkerKey = "__minimaxH3HandoffToken";
    const comfyApp = globalThis.app;
    if (comfyApp === null || typeof comfyApp !== "object") return "not_ready";
    if (typeof comfyApp.loadGraphData !== "function") return "not_ready";
    if (comfyApp.vueAppReady !== undefined && comfyApp.vueAppReady !== true) return "not_ready";
    if (comfyApp.isGraphReady !== undefined && comfyApp.isGraphReady !== true) return "not_ready";
    if (comfyApp.canvas === null || typeof comfyApp.canvas !== "object") return "not_ready";
    if (comfyApp.extensionManager === null || typeof comfyApp.extensionManager !== "object") return "not_ready";
    if (comfyApp.extensionManager.spinner !== false) return "not_ready";
    if (comfyApp.configuringGraph === true || globalThis.__minimaxH3WorkflowLoadPromise) return "busy";

    const previousManagedBaseline = typeof globalThis.__minimaxH3ManagedGraphBaseline === "string"
      ? globalThis.__minimaxH3ManagedGraphBaseline
      : null;
    if (typeof globalThis.__minimaxH3UserInteractionGeneration !== "number") {
      globalThis.__minimaxH3UserInteractionGeneration = 0;
    }
    if (
      globalThis.__minimaxH3InteractionTrackingInstalled !== true &&
      typeof globalThis.addEventListener === "function"
    ) {
      const markUserInteraction = () => {
        globalThis.__minimaxH3UserInteractionGeneration += 1;
      };
      for (const eventName of ["pointerdown", "keydown", "paste", "drop", "input"]) {
        globalThis.addEventListener(eventName, markUserInteraction, {
          capture: true,
          passive: true
        });
      }
      globalThis.__minimaxH3InteractionTrackingInstalled = true;
    }
    const acceptedUserInteractionGeneration = globalThis.__minimaxH3UserInteractionGeneration;

    const settleBounded = async (candidate, milliseconds) => {
      let timer = null;
      const deadline = new Promise((resolve) => {
        timer = setTimeout(() => resolve("timed_out"), milliseconds);
      });
      const settled = Promise.resolve(candidate).then(
        () => "resolved",
        () => "rejected"
      );
      try {
        return await Promise.race([settled, deadline]);
      } finally {
        if (timer !== null) clearTimeout(timer);
      }
    };

    const timingNow = () => Date.now();
    let nodeDefinitionRefreshMs = 0;
    const finish = (status, workflowLoadConfirmationMs = 0) => ({
      status,
      node_definition_refresh_ms: Math.max(0, Math.round(nodeDefinitionRefreshMs)),
      workflow_load_confirmation_ms: Math.max(0, Math.round(workflowLoadConfirmationMs))
    });

    if (workflow === null || typeof workflow !== "object" || Array.isArray(workflow)) {
      return finish("failed");
    }
    if (${requiresNodeDefinitionRefresh}) {
      if (typeof comfyApp.reloadNodeDefs !== "function") return finish("failed");
      const refreshStartedAt = timingNow();
      try {
        const refreshResult = comfyApp.reloadNodeDefs();
        const refreshOutcome = await settleBounded(refreshResult, ${NODE_DEFINITION_REFRESH_GRACE_MS});
        nodeDefinitionRefreshMs = timingNow() - refreshStartedAt;
        if (refreshOutcome === "rejected") return finish("failed");
      } catch {
        nodeDefinitionRefreshMs = timingNow() - refreshStartedAt;
        return finish("failed");
      }
    }
    const sourceExtra = workflow.extra;
    workflow.extra = sourceExtra !== null && typeof sourceExtra === "object" && !Array.isArray(sourceExtra)
      ? { ...sourceExtra, [handoffMarkerKey]: handoffToken }
      : { [handoffMarkerKey]: handoffToken };

    const settleAndVerify = async () => {
      if (comfyApp.graph === null || typeof comfyApp.graph !== "object"
        || typeof comfyApp.graph.serialize !== "function") {
        return { matches: false, baseline: null };
      }

      let previous = null;
      let stableSnapshots = 0;
      let stableMismatches = 0;
      let observedMatchingGraph = false;
      let baseline = null;
      let matches = false;
      // ComfyUI's workflow store can restore the previous tab shortly after
      // loadGraphData resolves.  Observe a minimum 600 ms window instead of
      // treating two immediately equal animation frames as proof of success.
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        const snapshot = comfyApp.graph.serialize();
        const current = JSON.stringify(snapshot);
        const graphMatches = snapshot !== null && typeof snapshot === "object"
          && snapshot.extra !== null && typeof snapshot.extra === "object"
          && snapshot.extra[handoffMarkerKey] === handoffToken;
        const workflowStore = comfyApp.extensionManager.workflow;
        const activeWorkflow = workflowStore !== null && typeof workflowStore === "object"
          ? workflowStore.activeWorkflow
          : null;
        const activeState = activeWorkflow !== null && typeof activeWorkflow === "object"
          ? activeWorkflow.activeState
          : null;
        const exposesWorkflowState = workflowStore !== null && typeof workflowStore === "object"
          && Array.isArray(workflowStore.openWorkflows);
        const activeMatches = !exposesWorkflowState || (
          activeState !== null && typeof activeState === "object"
          && activeState.extra !== null && typeof activeState.extra === "object"
          && activeState.extra[handoffMarkerKey] === handoffToken
        );
        const frontendSettled = comfyApp.configuringGraph !== true
          && comfyApp.extensionManager.spinner === false;
        matches = graphMatches && activeMatches && frontendSettled;
        stableSnapshots = matches && current === previous ? stableSnapshots + 1 : 0;
        stableMismatches = !matches && current === previous ? stableMismatches + 1 : 0;
        observedMatchingGraph = observedMatchingGraph || matches;
        previous = current;
        baseline = current;
        if (attempt >= 11 && (
          (matches && stableSnapshots >= 2) ||
          (observedMatchingGraph && !matches && stableMismatches >= 2)
        )) break;
      }
      return { matches, baseline };
    };

    const operation = (async () => {
      const workflowLoadStartedAt = timingNow();
      const status = await (async () => {
      // One automatic re-apply is enough to resolve ComfyUI's occasional
      // previous-tab restore race.  A genuine graph/configuration failure stays
      // fail-closed and is never converted into an execution request.
      let retryWorkflowTarget = null;
      for (let loadAttempt = 0; loadAttempt < 2; loadAttempt += 1) {
        let graphLoadState = "pending";
        try {
          const workflowTarget = loadAttempt === 1 && retryWorkflowTarget !== null
            ? retryWorkflowTarget
            : ${encodedName};
          const graphLoadResult = comfyApp.loadGraphData(workflow, true, true, workflowTarget);
          void Promise.resolve(graphLoadResult).then(
            () => { graphLoadState = "resolved"; },
            () => { graphLoadState = "rejected"; }
          );
          if (loadAttempt === 0) {
            const workflowStore = comfyApp.extensionManager.workflow;
            const openWorkflows = workflowStore !== null && typeof workflowStore === "object"
              ? workflowStore.openWorkflows
              : null;
            if (Array.isArray(openWorkflows)) {
              retryWorkflowTarget = openWorkflows.find((candidate) => {
                const activeState = candidate !== null && typeof candidate === "object"
                  ? candidate.activeState
                  : null;
                return activeState !== null && typeof activeState === "object"
                  && activeState.extra !== null && typeof activeState.extra === "object"
                  && activeState.extra[handoffMarkerKey] === handoffToken;
              }) ?? null;
            }
          }
        } catch {
          return "failed";
        }

        try {
          const verification = await settleAndVerify();
          if (graphLoadState === "rejected") return "failed";
          if (verification.matches && typeof verification.baseline === "string") {
            globalThis.__minimaxH3ManagedGraphBaseline = verification.baseline;
            return "loaded";
          }
          // A hanging ComfyUI promise must not add a fixed six-second delay when
          // the graph is already verifiable. If it has not produced a matching
          // graph within the observation window, fail closed instead of starting
          // a concurrent second load that could later overwrite user activity.
          if (graphLoadState === "pending") return "stale";
          if (
            loadAttempt === 0 &&
            (globalThis.__minimaxH3UserInteractionGeneration !== acceptedUserInteractionGeneration ||
              typeof verification.baseline !== "string" ||
              previousManagedBaseline === null ||
              verification.baseline !== previousManagedBaseline)
          ) {
            // Only the exact graph managed by the preceding handoff is safe to
            // replace automatically. A user switching tabs during verification
            // is not the restore race and must never be overwritten.
            return "stale";
          }
        } catch {
          return "stale";
        }
      }
      try {
        const finalBaseline = comfyApp.graph !== null && typeof comfyApp.graph === "object"
          && typeof comfyApp.graph.serialize === "function"
          ? JSON.stringify(comfyApp.graph.serialize())
          : null;
        if (previousManagedBaseline !== null && finalBaseline === previousManagedBaseline) {
          globalThis.__minimaxH3ManagedGraphBaseline = previousManagedBaseline;
        } else {
          delete globalThis.__minimaxH3ManagedGraphBaseline;
        }
      } catch {
        delete globalThis.__minimaxH3ManagedGraphBaseline;
      }
      return "stale";
      })();
      return finish(status, timingNow() - workflowLoadStartedAt);
    })();
    globalThis.__minimaxH3WorkflowLoadResult = {
      token: handoffToken,
      result: "running"
    };
    globalThis.__minimaxH3WorkflowLoadPromise = operation;
    void operation.then(
      (result) => {
        globalThis.__minimaxH3WorkflowLoadResult = { token: handoffToken, result };
      },
      () => {
        globalThis.__minimaxH3WorkflowLoadResult = { token: handoffToken, result: "failed" };
      }
    ).finally(() => {
      if (globalThis.__minimaxH3WorkflowLoadPromise === operation) {
        delete globalThis.__minimaxH3WorkflowLoadPromise;
      }
    });
    return "started";
  })()`;
  const resultExpression = `(() => {
    const state = globalThis.__minimaxH3WorkflowLoadResult;
    if (state === null || typeof state !== "object") return "running";
    if (state.token !== ${encodedHandoffToken}) return "running";
    if (typeof state.result === "string") return state.result;
    return state.result !== null && typeof state.result === "object"
      && typeof state.result.status === "string"
      ? state.result
      : "running";
  })()`;
  const markMediaDefinitionsRefreshed = (): void => {
    if (mediaScan === "present") refreshedMediaFingerprintByWindow.set(window, mediaFingerprint);
  };
  const completeFrontend = (frontend: NonNullable<ReturnType<typeof frontendGraphLoadResult>>): GraphLoadResult => {
    const status: GraphLoadStatus = frontend.status === "loaded" ? "loaded" : "failed";
    const disposition = requiresNodeDefinitionRefresh && frontend.status !== "loaded"
      && frontend.workflowLoadConfirmationMs === 0
      ? "failed"
      : refreshDisposition;
    return complete(status, frontend, disposition);
  };
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const stateBeforeLoad = handoffWindowState(window);
    if (stateBeforeLoad !== "active") return complete(stateBeforeLoad, null, refreshDisposition);
    try {
      const result = await executeFrontendScriptWithDeadline(window, expression);
      const stateAfterLoad = handoffWindowState(window);
      if (stateAfterLoad !== "active") return complete(stateAfterLoad, null, refreshDisposition);
      if (result === SCRIPT_DEADLINE) return complete("failed", null, refreshDisposition);
      const frontend = frontendGraphLoadResult(result);
      if (frontend !== null) {
        if (frontend.status === "loaded") markMediaDefinitionsRefreshed();
        return completeFrontend(frontend);
      }
      if (result === "loaded") {
        markMediaDefinitionsRefreshed();
        return complete("loaded", null, refreshDisposition);
      }
      if (result === "failed" || result === "stale") return complete("failed", null, refreshDisposition);
      if (result === "started") {
        for (let pollAttempt = 0; pollAttempt < FRONTEND_HANDOFF_RESULT_ATTEMPTS; pollAttempt += 1) {
          const stateBeforePoll = handoffWindowState(window);
          if (stateBeforePoll !== "active") return complete(stateBeforePoll, null, refreshDisposition);
          const polled = await executeFrontendScriptWithDeadline(
            window,
            resultExpression,
            READY_SCRIPT_DEADLINE_MS
          );
          const stateAfterPoll = handoffWindowState(window);
          if (stateAfterPoll !== "active") return complete(stateAfterPoll, null, refreshDisposition);
          const polledFrontend = frontendGraphLoadResult(polled);
          if (polledFrontend !== null) {
            if (polledFrontend.status === "loaded") markMediaDefinitionsRefreshed();
            return completeFrontend(polledFrontend);
          }
          if (polled === "loaded") {
            markMediaDefinitionsRefreshed();
            return complete("loaded", null, refreshDisposition);
          }
          if (polled === "failed" || polled === "stale") return complete("failed", null, refreshDisposition);
          if (polled === SCRIPT_DEADLINE) return complete("failed", null, refreshDisposition);
          await delay(FRONTEND_HANDOFF_RESULT_POLL_MS);
        }
        return complete("failed", null, refreshDisposition);
      }
    } catch {
      // A just-finished navigation can briefly reject JavaScript execution.
      const stateAfterFailure = handoffWindowState(window);
      if (stateAfterFailure !== "active") return complete(stateAfterFailure, null, refreshDisposition);
    }
    await delay(250);
  }
  const finalState = handoffWindowState(window);
  return complete(finalState === "active" ? "failed" : finalState, null, refreshDisposition);
}

type HandoffAttempt = {
  readonly response: { readonly visible: boolean; readonly automaticallyLoaded: boolean };
  readonly rendererGone: boolean;
  readonly timing: {
    readonly capabilityReadinessMs: number;
    readonly nodeDefinitionRefreshDisposition: NodeDefinitionRefreshDisposition;
    readonly nodeDefinitionRefreshMs: number;
    readonly workflowLoadConfirmationMs: number;
  };
};

async function showWorkflowInComfyWindowAttempt(options: {
  readonly workflow: JsonValue;
  readonly workflowName: string;
  readonly launchIfNeeded: (() => Promise<boolean>) | null;
}): Promise<HandoffAttempt> {
  const attemptStartedAt = Date.now();
  let capabilityReadinessMs: number | null = null;
  const attemptResult = (
    response: HandoffResponse,
    rendererGone: boolean,
    graphLoad: GraphLoadResult | null = null
  ): HandoffAttempt => Object.freeze({
    response,
    rendererGone,
    timing: Object.freeze({
      capabilityReadinessMs: capabilityReadinessMs ?? boundedElapsed(attemptStartedAt),
      nodeDefinitionRefreshDisposition: graphLoad?.nodeDefinitionRefreshDisposition ?? "not_required",
      nodeDefinitionRefreshMs: graphLoad?.nodeDefinitionRefreshMs ?? 0,
      workflowLoadConfirmationMs: graphLoad?.workflowLoadConfirmationMs ?? 0
    })
  });
  const created = comfyWindow === null || comfyWindow.isDestroyed();
  let window = created ? createComfyWindow() : comfyWindow as BrowserWindow;
  comfyWindow = window;

  let ready = false;
  if (!created && hasAllowedComfyDocument(window)) {
    // A stale renderer is still capable of holding a user-edited LiteGraph.
    // Check the managed baseline before any readiness recovery can destroy the
    // window; otherwise a stopped/restarting Comfy service could discard edits
    // without the close confirmation path ever running.
    if (managedGraphWindows.has(window) && await managedGraphIsDirty(window)) {
      window.show();
      window.focus();
      return attemptResult(Object.freeze({ visible: true, automaticallyLoaded: false }), false);
    }
    // Reuse the already initialized frontend. Calling loadURL here tears down the
    // active graph and races its startup restore against the next loadGraphData.
    ready = await waitForComfyReady(window, 12);
    if (!ready) {
      const staleState = handoffWindowState(window);
      if (staleState !== "active") {
        return attemptResult(CLOSED_HANDOFF_RESPONSE, staleState === "renderer_gone");
      }
      // A window can keep the old 8188 document after its ComfyUI process has
      // exited. Rebuild it inside this same user action so a second click is not
      // required to launch and load the new workflow.
      if (!window.isDestroyed()) window.destroy();
      if (comfyWindow === window) comfyWindow = null;
      window = createComfyWindow();
      comfyWindow = window;
    }
  }

  if (!ready) {
    let reachable = await loadLocalComfy(window, 2);
    const stateAfterInitialLoad = handoffWindowState(window);
    if (stateAfterInitialLoad !== "active") {
      return attemptResult(CLOSED_HANDOFF_RESPONSE, stateAfterInitialLoad === "renderer_gone");
    }
    if (!reachable && options.launchIfNeeded !== null) {
      const launched = await options.launchIfNeeded();
      if (launched) reachable = await loadLocalComfy(window, 40);
    }
    if (!reachable) reachable = await loadLocalComfy(window, 8);
    if (reachable) ready = await waitForComfyReady(window, 40);
  }

  if (!ready) {
    const finalState = handoffWindowState(window);
    const rendererGone = finalState === "renderer_gone";
    if (!window.isDestroyed()) window.destroy();
    if (comfyWindow === window) comfyWindow = null;
    return attemptResult(CLOSED_HANDOFF_RESPONSE, rendererGone);
  }

  window.show();
  window.focus();
  if (managedGraphWindows.has(window) && await managedGraphIsDirty(window)) {
    return attemptResult(Object.freeze({ visible: true, automaticallyLoaded: false }), false);
  }
  capabilityReadinessMs = boundedElapsed(attemptStartedAt);
  const graphLoad = await loadGraphData(
    window,
    options.workflow,
    options.workflowName
  );
  const rendererGone = graphLoad.status === "renderer_gone";
  const windowClosed = graphLoad.status === "window_closed";
  if (graphLoad.status === "loaded") managedGraphWindows.add(window);
  if (rendererGone) {
    if (!window.isDestroyed()) window.destroy();
    if (comfyWindow === window) comfyWindow = null;
  }
  return attemptResult(
    Object.freeze({
      visible: !rendererGone && !windowClosed,
      automaticallyLoaded: graphLoad.status === "loaded"
    }),
    rendererGone,
    graphLoad
  );
}

async function showWorkflowInComfyWindowExclusive(options: {
  readonly workflow: JsonValue;
  readonly workflowName: string;
  readonly launchIfNeeded: (() => Promise<boolean>) | null;
}): Promise<HandoffResponse> {
  const startedAt = Date.now();
  let capabilityReadinessMs = 0;
  let nodeDefinitionRefreshMs = 0;
  let workflowLoadConfirmationMs = 0;
  let nodeDefinitionRefreshDisposition: NodeDefinitionRefreshDisposition = "not_required";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await showWorkflowInComfyWindowAttempt(options);
    capabilityReadinessMs += result.timing.capabilityReadinessMs;
    nodeDefinitionRefreshMs += result.timing.nodeDefinitionRefreshMs;
    workflowLoadConfirmationMs += result.timing.workflowLoadConfirmationMs;
    if (result.timing.nodeDefinitionRefreshDisposition !== "not_required") {
      nodeDefinitionRefreshDisposition = result.timing.nodeDefinitionRefreshDisposition;
    }
    if (!result.rendererGone || attempt === 1) {
      const outcome: HandoffTimingOutcome = result.response.automaticallyLoaded
        ? "loaded"
        : result.rendererGone
          ? "renderer_gone"
          : result.response.visible
            ? "visible_not_loaded"
            : "window_closed";
      recordHandoffTimingEvidence({
        outcome,
        totalMs: boundedElapsed(startedAt),
        capabilityReadinessMs,
        nodeDefinitionRefreshDisposition,
        nodeDefinitionRefreshMs,
        workflowLoadConfirmationMs
      });
      return result.response;
    }
  }
  recordHandoffTimingEvidence({
    outcome: "window_closed",
    totalMs: boundedElapsed(startedAt),
    capabilityReadinessMs,
    nodeDefinitionRefreshDisposition,
    nodeDefinitionRefreshMs,
    workflowLoadConfirmationMs
  });
  return CLOSED_HANDOFF_RESPONSE;
}

export async function showWorkflowInComfyWindow(options: {
  readonly workflow: JsonValue;
  readonly workflowName: string;
  readonly launchIfNeeded: (() => Promise<boolean>) | null;
  readonly onTimingEvidence?: (
    evidence: ComfyHandoffTimingEvidence
  ) => void | Promise<void>;
}): Promise<HandoffResponse> {
  return enqueueHandoff(async () => {
    const response = await showWorkflowInComfyWindowExclusive(options);
    const evidence = lastHandoffTimingEvidence;
    if (evidence !== null && options.onTimingEvidence !== undefined) {
      try {
        await options.onTimingEvidence(evidence);
      } catch {
        // Diagnostics are best effort and must never turn a successful visible
        // handoff into a user-facing compilation failure. Keep the marker free
        // of paths, workflow names and prompt contents.
        process.stderr.write("COMFY_HANDOFF_TIMING_WRITE_FAILED\n");
      }
    }
    return response;
  });
}

export async function verifyExecutableFile(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    const metadata = await lstat(path);
    return metadata.isFile() && !metadata.isSymbolicLink() && sameWindowsPath(await realpath(path), path);
  } catch {
    return false;
  }
}
