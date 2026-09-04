import { lstat, mkdir, rm, writeFile } from "node:fs/promises";
import { release as windowsRelease } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

import { app, BrowserWindow, dialog, nativeImage, nativeTheme, screen, session, shell } from "electron";

import { registerClosedIpcRegistry, type ProjectCenterIpcController } from "./ipc-registry.js";
import {
  ADAPTER_SESSION_PARTITION,
  CONTROL_SESSION_PARTITION,
  createControlWebPreferences,
  lockDownControlSession,
  lockDownWindowNavigation
} from "./security.js";
import { createControlPlaneServices } from "./services/index.js";
import { createFixedFfprobeRunner, disposeAbCliAdapters } from "./services/ab-cli-adapter.js";
import { createFixedFfmpegPosterRenderer } from "./services/fixed-ffmpeg-poster.js";
import { createGeneratedVideoService } from "./services/generated-video-service.js";
import { createNativeVideoPosterRenderer } from "./services/native-video-poster.js";
import {
  loadUiThemePreference,
  saveUiThemePreference
} from "./services/ui-theme-preferences.js";
import type { AboutLinkTarget, UiTheme } from "../shared/ipc-contract.js";
import { RELAY_UPDATE_SOURCE } from "../shared/update-source.js";
import * as nativeHelperClient from "./services/native-helper-client.js";
import {
  ASSET_DIALOG_FILTERS,
  createAssetLibraryService
} from "./services/asset-library.js";
import type { AssetMediaType } from "../shared/ipc-contract.js";
import {
  configureDataRoot,
  ensureDataRootLayout,
  loadDataRootPointer,
  saveDataRootPointer,
  type DataRootFailureCode,
  type DataRootVolumeEvidence,
  type DataRootVolumeInspector,
  type DataRootLayout
} from "./services/data-root.js";
import * as dataRootServices from "./services/data-root.js";
import { migrateLegacyDataToDataRoot } from "./services/project-migration.js";
import {
  createProjectCenterService,
  type ProjectCenterService
} from "./services/project-center.js";
import {
  loadSetupPreferences,
  saveSetupPreferences,
  type SetupPreferences
} from "./services/setup-preferences.js";
import { chooseInitialDataRootCandidate } from "./startup-data-root.js";
import {
  createStartupRecoveryWindow,
  type StartupRecoveryAttemptResult,
  type StartupRecoveryDiagnostic,
  type StartupRecoveryState
} from "./startup-recovery-window.js";

const STARTUP_RUNTIME_FAILURE_CODE = "STARTUP_RUNTIME_FAILURE" as const;

const STARTUP_ACTION_LABELS: Readonly<Record<nativeHelperClient.StartupRecoveryAction, string>> =
  Object.freeze({
    retry: "重试",
    open_diagnostics: "打开诊断信息",
    open_data_root_settings: "打开数据目录设置",
    exit: "退出"
  });

const smokeMode = process.env.MINIMAX_H3_SMOKE === "1";
const packagedProbeMode = process.env.MINIMAX_H3_PACKAGED_PROBE === "1";
const headlessMode = smokeMode || packagedProbeMode;
let applicationQuitRequested = false;
let shutdownCleanupComplete = false;
let shutdownRetryScheduled = false;
let terminalExitRequested = false;

function requestApplicationQuit(): void {
  if (applicationQuitRequested) return;
  applicationQuitRequested = true;
  app.quit();
}

function prepareApplicationQuit(event: { preventDefault(): void }): void {
  applicationQuitRequested = true;
  event.preventDefault();
  shutdownCleanupComplete = true;
  if (!shutdownRetryScheduled) {
    shutdownRetryScheduled = true;
    setImmediate(() => {
      shutdownRetryScheduled = false;
      if (!terminalExitRequested) app.quit();
    });
  }
}

function finishApplicationExitWhenWindowsClosed(): void {
  if (!applicationQuitRequested) {
    requestApplicationQuit();
    return;
  }
  if (!shutdownCleanupComplete) {
    app.quit();
    return;
  }
  if (terminalExitRequested) return;
  terminalExitRequested = true;
  app.exit(0);
}

function executableDirectory(): string {
  if (!app.isPackaged) return app.getAppPath();
  const portableDirectory = process.env.PORTABLE_EXECUTABLE_DIR;
  return typeof portableDirectory === "string" && isAbsolute(portableDirectory)
    ? portableDirectory
    : dirname(process.execPath);
}

async function directFileExists(path: string): Promise<boolean> {
  try {
    const metadata = await lstat(path);
    return metadata.isFile() && !metadata.isSymbolicLink();
  } catch {
    return false;
  }
}

async function initialDataRootCandidate(
  legacySetup: SetupPreferences | null,
  userDataPath: string
): Promise<string | null> {
  // Smoke and packaged validation must be hermetic.  In particular, an
  // installer probe running with a temporary APPDATA must never materialize
  // the production D:\MiniMaxH3 data library merely because D: exists.
  let dDriveAvailable = false;
  try {
    const metadata = await lstat("D:\\");
    dDriveAvailable = metadata.isDirectory();
  } catch {
    dDriveAvailable = false;
  }
  return chooseInitialDataRootCandidate({ legacySetup, userDataPath, headlessMode, dDriveAvailable });
}

async function initializeDataRoot(
  userDataPath: string,
  systemTheme: UiTheme,
  inspectVolume: DataRootVolumeInspector
): Promise<{ readonly layout: DataRootLayout; readonly theme: UiTheme }> {
  const pointer = await loadDataRootPointer(userDataPath, { strict: true });
  const legacySetup = await loadSetupPreferences(userDataPath);
  const legacyThemePath = join(userDataPath, "relay-ui-theme.json");
  const hasLegacyTheme = await directFileExists(legacyThemePath);
  const legacyTheme = hasLegacyTheme
    ? await loadUiThemePreference(userDataPath, systemTheme)
    : undefined;
  // Probe/smoke profiles are isolated and may provide an explicit pointer to
  // a separate fixed-NTFS fixture. Honouring that pointer is what lets the
  // Electron profile itself live on a redirected/share-like location without
  // turning userData into the managed business-data root.
  const candidate = pointer?.dataRoot ?? await initialDataRootCandidate(legacySetup, userDataPath);
  if (candidate === null) throw createDataRootFailure("DATA_ROOT_UNAVAILABLE");
  await validateStartupDataRoot(candidate, inspectVolume);
  const layout = await ensureDataRootLayout(candidate);
  if (pointer === null) await saveDataRootPointer(userDataPath, layout.root);

  const migration = await migrateLegacyDataToDataRoot({
    dataRoot: layout.root,
    userDataPath,
    ...(legacySetup === null ? {} : { setupPreferences: legacySetup }),
    ...(legacyTheme === undefined ? {} : { uiThemePreference: legacyTheme })
  });
  if (migration.status === "migrated") {
    if (legacySetup !== null) {
      const saved = await saveSetupPreferences(layout.config, legacySetup, "installation.json");
      if (!saved) throw new Error("DATA_ROOT.INSTALLATION_MIGRATION_FAILED");
    }
    if (legacyTheme !== undefined) {
      await saveUiThemePreference(layout.config, legacyTheme, "ui.json");
    }
    // The verified migration backup now lives under dataRoot/config.  Remove
    // only the two explicit legacy business files; Electron cache stays put.
    await Promise.all([
      rm(join(userDataPath, "setup-locations.v1.json"), { force: true }),
      rm(legacyThemePath, { force: true })
    ]);
  } else {
    if (legacySetup !== null && await loadSetupPreferences(layout.config, "installation.json") === null) {
      const saved = await saveSetupPreferences(layout.config, legacySetup, "installation.json");
      if (!saved) throw new Error("DATA_ROOT.INSTALLATION_RECOVERY_FAILED");
    }
  }

  const theme = await loadUiThemePreference(
    layout.config,
    legacyTheme ?? systemTheme,
    "ui.json"
  );
  return Object.freeze({ layout, theme });
}

export interface ControlWindowBounds {
  readonly width: number;
  readonly height: number;
  readonly minWidth: number;
  readonly minHeight: number;
}

export function computeControlWindowBounds(workAreaWidth: number, workAreaHeight: number): ControlWindowBounds {
  const usableWidth = Math.max(320, Math.floor(workAreaWidth) - 16);
  const usableHeight = Math.max(320, Math.floor(workAreaHeight) - 16);
  return Object.freeze({
    width: Math.min(1180, usableWidth),
    height: Math.min(780, usableHeight),
    minWidth: Math.min(360, usableWidth),
    minHeight: Math.min(360, usableHeight)
  });
}

function controlRendererUrl(theme: UiTheme): string {
  const rendererPath = join(import.meta.dirname, "..", "renderer", "index.html");
  const url = new URL(pathToFileURL(rendererPath).href);
  url.searchParams.set("theme", theme);
  return url.href;
}

function createControlWindow(initialTheme: UiTheme, rendererUrl: string): BrowserWindow {
  const preloadPath = join(import.meta.dirname, "..", "preload", "index.cjs");
  const iconPath = join(import.meta.dirname, "..", "renderer", "assets", "relay-icon.png");
  const controlSession = session.fromPartition(CONTROL_SESSION_PARTITION, {
    cache: false
  });
  if (!controlSession.isPersistent()) {
    throw new Error("CONTROL_SESSION.PERSISTENCE_REQUIRED");
  }

  lockDownControlSession(controlSession);

  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const bounds = computeControlWindowBounds(workArea.width, workArea.height);

  const window = new BrowserWindow({
    ...bounds,
    show: false,
    backgroundColor: initialTheme === "dark" ? "#181a1d" : "#f5f5f3",
    icon: iconPath,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: initialTheme === "dark" ? "#1d2329" : "#f1f2f3",
      symbolColor: initialTheme === "dark" ? "#e8eaed" : "#24272b",
      height: 34
    },
    autoHideMenuBar: true,
    webPreferences: createControlWebPreferences(preloadPath)
  });

  window.removeMenu();
  lockDownWindowNavigation(window, rendererUrl);
  window.once("ready-to-show", () => {
    if (!headlessMode) {
      window.show();
    }
  });
  window.webContents.once("did-finish-load", () => {
    if (smokeMode) {
      process.stdout.write("CONTROL_PLANE_UI_READY\n");
      setTimeout(requestApplicationQuit, 50).unref();
    }
  });
  window.once("closed", requestApplicationQuit);
  void window.loadURL(rendererUrl);
  return window;
}

async function applyUiTheme(window: BrowserWindow | null, theme: UiTheme): Promise<void> {
  if (window === null || window.isDestroyed()) return;
  nativeTheme.themeSource = theme;
  const dark = theme === "dark";
  window.setBackgroundColor(dark ? "#181a1d" : "#f5f5f3");
  if (process.platform === "win32") {
    window.setTitleBarOverlay({
      color: dark ? "#1d2329" : "#f1f2f3",
      symbolColor: dark ? "#e8eaed" : "#24272b",
      height: 34
    });
  }
}

function dataRootRecoveryState(error: unknown): StartupRecoveryState {
  if (isDataRootFailure(error)) {
    return Object.freeze({ code: error.code, message: error.message, busy: false });
  }
  const failure = createDataRootFailure("DATA_ROOT_UNAVAILABLE", error);
  return Object.freeze({ code: failure.code, message: failure.message, busy: false });
}

const DATA_ROOT_MESSAGES: Readonly<Record<DataRootFailureCode, string>> = Object.freeze({
  DATA_ROOT_UNAVAILABLE: "Relay 数据目录不存在或当前不可访问。",
  DATA_ROOT_NOT_FIXED_NTFS: "Relay 数据目录必须位于本机固定 NTFS 磁盘，请重新选择目录。",
  DATA_ROOT_PERMISSION_DENIED: "Relay 没有权限读写所选数据目录，请选择其他目录或检查权限。",
  POINTER_READ_FAILED: "Relay 无法读取数据目录位置配置。",
  POINTER_WRITE_FAILED: "Relay 无法保存数据目录位置配置。"
});

function isDataRootFailure(error: unknown): error is Error & { readonly code: DataRootFailureCode } {
  if (!(error instanceof Error) || typeof (error as { code?: unknown }).code !== "string") return false;
  return Object.hasOwn(DATA_ROOT_MESSAGES, (error as unknown as { code: string }).code);
}

function createDataRootFailure(code: DataRootFailureCode, cause?: unknown): Error & { readonly code: DataRootFailureCode } {
  const RuntimeDataRootFailure = dataRootServices.DataRootFailure;
  if (typeof RuntimeDataRootFailure === "function") return new RuntimeDataRootFailure(code, { cause });
  return Object.assign(new Error(DATA_ROOT_MESSAGES[code], { cause }), { code });
}

async function validateStartupDataRoot(
  candidatePath: string,
  inspector: DataRootVolumeInspector
): Promise<DataRootVolumeEvidence> {
  if (typeof dataRootServices.validateDataRootLocation === "function") {
    return dataRootServices.validateDataRootLocation(candidatePath, inspector);
  }
  return await inspector(candidatePath);
}

function dataRootDiagnosticFields(error: unknown): Pick<
  StartupRecoveryDiagnostic,
  "dataRootDriveType" | "dataRootFilesystem" | "dataRootSupported"
> {
  const nested = error instanceof Error && error.cause !== undefined ? error.cause : error;
  if (typeof nested !== "object" || nested === null) {
    return Object.freeze({ dataRootDriveType: null, dataRootFilesystem: null, dataRootSupported: false });
  }
  const record = nested as Record<string, unknown>;
  const driveType = typeof record.driveType === "string" || typeof record.driveType === "number"
    ? String(record.driveType)
    : null;
  const filesystem = typeof record.filesystem === "string" ? record.filesystem : null;
  const fixedLocal = typeof record.fixedLocal === "boolean" ? record.fixedLocal : null;
  return Object.freeze({
    dataRootDriveType: driveType,
    dataRootFilesystem: filesystem,
    dataRootSupported: fixedLocal === null || filesystem === null
      ? false
      : fixedLocal && filesystem.toLocaleLowerCase("en-US") === "ntfs"
  });
}

function relaunchAfterDataRootRecovery(): void {
  app.relaunch();
  app.exit(0);
}

function showDataRootRecovery(options: {
  readonly error: unknown;
  readonly userDataPath: string;
  readonly systemTheme: UiTheme;
  readonly inspectVolume: DataRootVolumeInspector;
  readonly helperExists: boolean;
  readonly profileMatches: boolean;
}): void {
  let state = dataRootRecoveryState(options.error);
  const recoveryDiagnostic = (error: unknown, current: StartupRecoveryState): StartupRecoveryDiagnostic => Object.freeze({
      relayVersion: app.getVersion(),
      windowsVersion: windowsRelease(),
      architecture: process.arch,
      stage: "data_root_bootstrap",
      code: current.code,
      helperExists: options.helperExists,
      profileMatches: options.profileMatches,
      ...dataRootDiagnosticFields(error)
    });
  const diagnostic = recoveryDiagnostic(options.error, state);
  const retry = async (): Promise<StartupRecoveryAttemptResult> => {
    try {
      await initializeDataRoot(options.userDataPath, options.systemTheme, options.inspectVolume);
      relaunchAfterDataRootRecovery();
      return Object.freeze({ ok: true });
    } catch (error: unknown) {
      state = dataRootRecoveryState(error);
      return Object.freeze({ ok: false, state, diagnostic: recoveryDiagnostic(error, state) });
    }
  };
  const choose = async (): Promise<StartupRecoveryAttemptResult> => {
    const selected = await dialog.showOpenDialog({
      title: "选择 Relay 数据目录（必须位于本机固定 NTFS 磁盘）",
      properties: ["openDirectory", "createDirectory"]
    });
    if (selected.canceled || selected.filePaths.length !== 1) {
      return Object.freeze({ ok: false, state });
    }
    const targetRoot = selected.filePaths[0];
    if (targetRoot === undefined || !isAbsolute(targetRoot)) {
      const error = createDataRootFailure("DATA_ROOT_UNAVAILABLE");
      state = dataRootRecoveryState(error);
      return Object.freeze({ ok: false, state, diagnostic: recoveryDiagnostic(error, state) });
    }
    try {
      await validateStartupDataRoot(targetRoot, options.inspectVolume);
      const layout = await ensureDataRootLayout(targetRoot);
      await saveDataRootPointer(options.userDataPath, layout.root);
      relaunchAfterDataRootRecovery();
      return Object.freeze({ ok: true });
    } catch (error: unknown) {
      state = dataRootRecoveryState(error);
      return Object.freeze({ ok: false, state, diagnostic: recoveryDiagnostic(error, state) });
    }
  };
  createStartupRecoveryWindow({
    initialState: state,
    diagnostic,
    onRetry: retry,
    onChooseDataRoot: choose
  });
}

async function persistSuccessfulStartupDiagnostic(options: {
  readonly layout: DataRootLayout;
  readonly helperEvidence: nativeHelperClient.NativeHelperStartupEvidence;
  readonly dataRootVolume: DataRootVolumeEvidence;
}): Promise<void> {
  const driveType = Number.parseInt(options.dataRootVolume.driveType ?? "", 10);
  const diagnostic = nativeHelperClient.createStartupDiagnostic({
    relayVersion: app.getVersion(),
    platform: process.platform,
    osRelease: windowsRelease(),
    architecture: process.arch,
    stage: "data_root",
    code: null,
    helperExists: options.helperEvidence.helperPathVerified,
    profileMatches:
      options.helperEvidence.profileId === "relay.win32.path-inspection" &&
      options.helperEvidence.profileVersion === "1.0.0",
    integrityVerified: options.helperEvidence.helperPathVerified,
    dataRootVolume: {
      fixedLocal: options.dataRootVolume.fixedLocal,
      filesystem: options.dataRootVolume.filesystem,
      driveType: Number.isSafeInteger(driveType) ? driveType : null
    }
  });
  // Use an append-only, exclusive file rather than replacing a user-controlled
  // path. The payload is path-free and contains no username, prompt or token.
  const fileName = `startup-diagnostic-${Date.now()}-${process.pid}.json`;
  await writeFile(
    join(options.layout.logs, fileName),
    `${JSON.stringify(diagnostic, null, 2)}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 }
  );
}

function isNativeHelperStartupFailure(
  error: unknown
): error is nativeHelperClient.NativeHelperStartupError {
  return error instanceof nativeHelperClient.NativeHelperStartupError;
}

function safeFatalStartupPresentation(error: unknown): {
  readonly code: nativeHelperClient.NativeHelperStartupCode | typeof STARTUP_RUNTIME_FAILURE_CODE;
  readonly message: string;
  readonly actions: readonly nativeHelperClient.StartupRecoveryAction[];
  readonly diagnostic: string;
} {
  if (isNativeHelperStartupFailure(error)) {
    const diagnostic = nativeHelperClient.createStartupDiagnostic({
      relayVersion: app.getVersion(),
      platform: process.platform,
      osRelease: windowsRelease(),
      architecture: process.arch,
      stage: error.stage,
      code: error.code,
      helperExists: error.helperExists,
      profileMatches: error.profileMatches,
      integrityVerified: error.integrityVerified
    });
    return Object.freeze({
      code: error.code,
      message: nativeHelperClient.nativeHelperStartupMessage(error.code),
      actions: nativeHelperClient.nativeHelperStartupActions(error.code),
      diagnostic: nativeHelperClient.formatStartupDiagnostic(diagnostic)
    });
  }
  // This branch deliberately exposes neither a raw exception nor a private
  // path. It is distinct from native-helper and dataRoot failures so a later
  // startup regression cannot be mislabeled as a broken installation.
  return Object.freeze({
    code: STARTUP_RUNTIME_FAILURE_CODE,
    message: "Relay 未能完成启动，请打开诊断信息并将诊断代码提供给客服。",
    actions: Object.freeze<nativeHelperClient.StartupRecoveryAction[]>(["retry", "open_diagnostics", "exit"]),
    diagnostic: [
      `relay=${app.getVersion()}`,
      `os=Windows ${windowsRelease()}`,
      `arch=${process.arch}`,
      "stage=application_startup",
      `code=${STARTUP_RUNTIME_FAILURE_CODE}`
    ].join(" ")
  });
}

async function presentFatalStartupFailure(error: unknown): Promise<void> {
  const presentation = safeFatalStartupPresentation(error);
  if (headlessMode) {
    process.stderr.write(`${presentation.diagnostic}\n`);
    app.exit(2);
    return;
  }

  while (true) {
    const buttons = presentation.actions.map((action) => STARTUP_ACTION_LABELS[action]);
    const exitIndex = presentation.actions.indexOf("exit");
    const retryIndex = presentation.actions.indexOf("retry");
    const result = await dialog.showMessageBox({
      type: "error",
      title: "Relay 无法启动",
      message: presentation.message,
      detail: `诊断代码：${presentation.code}`,
      buttons,
      defaultId: retryIndex >= 0 ? retryIndex : 0,
      cancelId: exitIndex >= 0 ? exitIndex : buttons.length - 1,
      noLink: true
    });
    const action = presentation.actions[result.response] ?? "exit";
    if (action === "open_diagnostics") {
      await dialog.showMessageBox({
        type: "info",
        title: "Relay 启动诊断信息",
        message: `诊断代码：${presentation.code}`,
        detail: presentation.diagnostic,
        buttons: ["返回"],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      });
      continue;
    }
    if (action === "retry") {
      app.relaunch();
      app.exit(0);
      return;
    }
    app.exit(2);
    return;
  }
}

if (process.platform === "win32") app.setAppUserModelId("io.github.platuring.relay");

app.whenReady().then(async () => {
  const userDataPath = app.getPath("userData");
  // Native helper identity/protocol verification is intentionally independent
  // from Electron userData. A redirected or VM-shared userData path is allowed
  // because it stores only the small pointer, Electron cache and lock state.
  const nativeHelperEvidence = nativeHelperClient.verifyNativeHelperAtStartup({
    resourcesPath: process.resourcesPath,
    isPackaged: app.isPackaged,
    appVersion: app.getVersion()
  });
  const systemTheme: UiTheme = nativeTheme.shouldUseDarkColors ? "dark" : "light";
  let verifiedDataRootVolume: DataRootVolumeEvidence | null = null;
  const inspectDataRootVolume: DataRootVolumeInspector = async (candidatePath) => {
    let inspectionPath = candidatePath;
    try {
      await lstat(candidatePath);
    } catch (error: unknown) {
      // The one automatic creation policy is the documented first-run
      // D:\MiniMaxH3 default. Validate D: itself before creating the child.
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && candidatePath.toLocaleLowerCase("en-US") === "d:\\minimaxh3") {
        inspectionPath = "D:\\";
      } else {
        throw error;
      }
    }
    const evidence = nativeHelperClient.inspectNativeDataRoot({
      dataRootPath: inspectionPath,
      resourcesPath: process.resourcesPath,
      isPackaged: app.isPackaged,
      appVersion: app.getVersion()
    });
    const volume = Object.freeze<DataRootVolumeEvidence>({
      exists: true,
      isDirectory: true,
      fixedLocal: evidence.fixedLocal,
      filesystem: evidence.filesystem,
      driveType: String(evidence.driveType),
      readable: true,
      writable: true
    });
    verifiedDataRootVolume = volume;
    return volume;
  };
  let dataRootState: { readonly layout: DataRootLayout; readonly theme: UiTheme };
  try {
    try {
      await mkdir(userDataPath, { recursive: true });
    } catch (error: unknown) {
      throw createDataRootFailure("POINTER_WRITE_FAILED", error);
    }
    dataRootState = await initializeDataRoot(userDataPath, systemTheme, inspectDataRootVolume);
    if (verifiedDataRootVolume === null) throw createDataRootFailure("DATA_ROOT_UNAVAILABLE");
    try {
      await persistSuccessfulStartupDiagnostic({
        layout: dataRootState.layout,
        helperEvidence: nativeHelperEvidence,
        dataRootVolume: verifiedDataRootVolume
      });
    } catch (error: unknown) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
        throw createDataRootFailure("DATA_ROOT_PERMISSION_DENIED", error);
      }
      throw error;
    }
  } catch (error: unknown) {
    if (isDataRootFailure(error)) {
      showDataRootRecovery({
        error,
        userDataPath,
        systemTheme,
        inspectVolume: inspectDataRootVolume,
        helperExists: true,
        profileMatches: true
      });
      return;
    }
    throw error;
  }
  const initialTheme = dataRootState.theme;
  nativeTheme.themeSource = initialTheme;
  const rendererUrl = controlRendererUrl(initialTheme);
  lockDownControlSession(
    session.fromPartition(ADAPTER_SESSION_PARTITION, { cache: false })
  );
  const managedFfprobePath = join(
    dataRootState.layout.runtime,
    "ffmpeg",
    "ffmpeg-n9.0.1-6-g9d4ca21220-win64-gpl-9.0",
    "bin",
    "ffprobe.exe"
  );
  const managedFfmpegPath = join(dirname(managedFfprobePath), "ffmpeg.exe");
  const hasManagedFfprobe = await directFileExists(managedFfprobePath);
  const fixedGeneratedVideoProbe = hasManagedFfprobe
    ? createFixedFfprobeRunner({ trustedExecutablePath: managedFfprobePath })
    : null;
  const fixedGeneratedVideoPoster = createFixedFfmpegPosterRenderer({
    trustedExecutablePath: managedFfmpegPath
  });
  const nativeGeneratedVideoPoster = createNativeVideoPosterRenderer({
    createThumbnailFromPath: (sourcePath, size) => nativeImage.createThumbnailFromPath(sourcePath, size)
  });
  let projectCenterForGeneratedVideos: ProjectCenterService | null = null;
  const generatedVideoService = createGeneratedVideoService({
    dataRoot: dataRootState.layout.root,
    ...(fixedGeneratedVideoProbe === null ? {} : {
      probeVideo: (sourcePath: string) => fixedGeneratedVideoProbe(managedFfprobePath, [
        "-v", "error", "-print_format", "json", "-show_format", "-show_streams", sourcePath
      ])
    }),
    renderVideoPoster: async (sourcePath, outputPath) => {
      if (await directFileExists(managedFfmpegPath)) {
        await fixedGeneratedVideoPoster(sourcePath, outputPath);
        return;
      }
      await nativeGeneratedVideoPoster(sourcePath, outputPath);
    },
    openVideo: async (sourcePath) => {
      const message = await shell.openPath(sourcePath);
      if (message !== "") throw new Error("Windows 无法打开该视频。");
    },
    revealVideo: async (sourcePath) => shell.showItemInFolder(sourcePath),
    addToProjectAssets: async ({ projectId, sourcePath, expectedSha256, expectedByteLength }) => {
      const center = projectCenterForGeneratedVideos;
      if (center === null) throw new Error("项目素材库尚未就绪。");
      const imported = await center.importAssets(projectId, {
        paths: [sourcePath],
        mode: "copy",
        expectedSource: { sha256: expectedSha256, byteLength: expectedByteLength }
      });
      const item = imported.results[0];
      if (item === undefined || item.asset === null || item.status === "rejected") {
        throw new Error("项目素材库拒绝了该视频副本。");
      }
      if (item.asset.sha256 !== expectedSha256 || item.asset.byteLength !== expectedByteLength) {
        throw new Error("项目素材副本与生成视频的完整性证据不一致。");
      }
      return Object.freeze({
        status: item.status === "duplicate" ? "duplicate" as const : "added" as const,
        assetId: item.asset.assetId,
        sha256: item.asset.sha256,
        byteLength: item.asset.byteLength
      });
    }
  });
  const services = createControlPlaneServices({
    appVersion: app.getVersion(),
    userDataPath: dataRootState.layout.config,
    setupPreferencesFileName: "installation.json",
    dataRootPath: dataRootState.layout.root,
    appPath: app.getAppPath(),
    executableDirectory: executableDirectory(),
    resourcesPath: process.resourcesPath,
    isPackaged: app.isPackaged,
    enableExternalAdapters: !smokeMode,
    allowMockFallback: smokeMode,
    skipVisibleOpen: headlessMode,
    preferredUpdateKind: "setup",
    openUpdateDownloadFolder: async (folderPath) => {
      const message = await shell.openPath(folderPath);
      if (message !== "") throw new Error("Windows 无法打开更新下载目录。");
    },
    openValidatedUpdateRelease: (url) => shell.openExternal(url),
    launchValidatedUpdateInstaller: async (installerPath) => {
      const message = await shell.openPath(installerPath);
      if (message !== "") throw new Error("Windows 未能启动已验证的 Relay 安装程序。");
      setImmediate(requestApplicationQuit);
    },
    generatedVideoService
  });

  if (packagedProbeMode) {
    process.stdout.write(
      `PACKAGED_NATIVE_HELPER_READY profile=${nativeHelperEvidence.profileId} enabled=${nativeHelperEvidence.enabledOpcodes.length}\n`
    );
    const bootstrap = await services.getBootstrap();
    const ready =
      bootstrap.adapterState.streamA === "stream_a_cli" &&
      bootstrap.adapterState.streamB === "stream_b_cli";
    if (ready) {
      // electron-builder's Portable launcher does not reliably forward child
      // stdout. A path-free, test-only marker inside the explicitly selected
      // dataRoot provides independently verifiable startup evidence without
      // writing business data into Electron userData.
      await writeFile(
        join(dataRootState.layout.logs, "packaged-startup-probe.json"),
        `${JSON.stringify({
          schema_version: 1,
          relay_version: app.getVersion(),
          conclusion: "passed",
          native_profile: nativeHelperEvidence.profileId,
          native_helper: "verified",
          data_root_volume: "fixed_local_ntfs_verified",
          adapters: { streamA: "stream_a_cli", streamB: "stream_b_cli" },
          product_boundary: {
            ran_model: false,
            submitted_prompt: false,
            submitted_queue: false,
            generated_media: false
          }
        }, null, 2)}\n`,
        { encoding: "utf8", flag: "wx", mode: 0o600 }
      );
      process.stdout.write("PACKAGED_ADAPTER_READY streamA=stream_a_cli streamB=stream_b_cli\n");
      requestApplicationQuit();
    } else {
      process.stderr.write(
        `PACKAGED_ADAPTER_UNAVAILABLE streamA=${bootstrap.adapterState.streamA} streamB=${bootstrap.adapterState.streamB}\n`
      );
      app.exit(2);
    }
    return;
  }

  let controlWindow: BrowserWindow | null = null;
  const assetLibrary = createAssetLibraryService({
    // The legacy asset IPC remains available for backwards compatibility, but
    // its ledger is business data and therefore belongs under dataRoot rather
    // than Electron's AppData directory. The Alpha 28 project asset library is
    // the primary UI and stores each asset inside its owning project.
    userDataPath: dataRootState.layout.config,
    chooseAssetFiles: async () => dialog.showOpenDialog({
      title: "导入本地素材（不会上传）",
      properties: ["openFile", "multiSelections"],
      filters: ASSET_DIALOG_FILTERS.map((filter) => ({
        name: filter.name,
        extensions: [...filter.extensions]
      }))
    }),
    chooseProjectDirectory: async () => dialog.showOpenDialog({
      title: "选择项目根目录（将在其中创建 assets 文件夹）",
      properties: ["openDirectory", "createDirectory"]
    }),
    chooseRelocationFile: async (mediaType: AssetMediaType) => {
      const filter = ASSET_DIALOG_FILTERS.find((candidate) => (
        mediaType === "image" ? candidate.name === "图片" :
          mediaType === "video" ? candidate.name === "视频" : candidate.name === "音频"
      ));
      return dialog.showOpenDialog({
        title: "重新定位本地素材",
        properties: ["openFile"],
        filters: filter === undefined ? [] : [{ name: filter.name, extensions: [...filter.extensions] }]
      });
    },
    registerFrameSelection: (absolutePath, slot) =>
      services.registerTrustedFrameSelection(absolutePath, slot)
  });

  const createProjectCenter = async (layout: DataRootLayout): Promise<ProjectCenterService> => {
    const ffprobePath = join(
      layout.runtime,
      "ffmpeg",
      "ffmpeg-n9.0.1-6-g9d4ca21220-win64-gpl-9.0",
      "bin",
      "ffprobe.exe"
    );
    const ffmpegPath = join(dirname(ffprobePath), "ffmpeg.exe");
    const [hasFfprobe, hasFfmpeg] = await Promise.all([
      directFileExists(ffprobePath),
      directFileExists(ffmpegPath)
    ]);
    const service = createProjectCenterService({
      dataRoot: layout.root,
      ...(hasFfprobe ? {
        ffprobePath,
        ffprobeRunner: createFixedFfprobeRunner({ trustedExecutablePath: ffprobePath })
      } : {}),
      renderImageThumbnail: async (sourcePath, outputPath) => {
        const source = nativeImage.createFromPath(sourcePath);
        if (source.isEmpty()) throw new TypeError("本机图片解码器无法读取该素材。");
        const size = source.getSize();
        if (size.width <= 0 || size.height <= 0) throw new TypeError("图片尺寸无效。");
        const scale = Math.min(1, 512 / size.width, 384 / size.height);
        const width = Math.max(1, Math.round(size.width * scale));
        const height = Math.max(1, Math.round(size.height * scale));
        const thumbnail = scale < 1
          ? source.resize({ width, height, quality: "good" })
          : source;
        const bytes = thumbnail.toPNG();
        if (bytes.length === 0 || bytes.length > 4 * 1024 * 1024) {
          throw new TypeError("图片缩略图超出本机安全缓存范围。");
        }
        await writeFile(outputPath, bytes, { flag: "wx" });
      },
      ...(hasFfmpeg ? {
        renderVideoPoster: createFixedFfmpegPosterRenderer({ trustedExecutablePath: ffmpegPath })
      } : {}),
      revealPath: (absolutePath) => shell.showItemInFolder(absolutePath)
    });
    await service.initialize();
    return service;
  };

  let projectCenter = await createProjectCenter(dataRootState.layout);
  projectCenterForGeneratedVideos = projectCenter;
  let activeProjectId = (await projectCenter.listRecentProjects())[0]?.projectId ?? null;
  generatedVideoService.activateProject(activeProjectId);
  const setActiveProjectId = (projectId: string | null): void => {
    activeProjectId = projectId;
    generatedVideoService.activateProject(projectId);
  };
  const projectState = async () => Object.freeze({
    dataRoot: dataRootState.layout.root,
    projects: await projectCenter.listProjects({ includeArchived: true }),
    recentProjects: await projectCenter.listRecentProjects(),
    activeProjectId
  });
  const projectCenterController: ProjectCenterIpcController = Object.freeze({
    getProjectCenter: projectState,
    async createRelayProject(request) {
      const project = await projectCenter.createProject(request);
      setActiveProjectId(project.projectId);
      return project;
    },
    async loadRelayProject(request) {
      const project = await projectCenter.loadProject(request.projectId);
      if (request.activate) setActiveProjectId(project.projectId);
      return project;
    },
    async saveRelayProject(request) {
      const project = await projectCenter.saveProject({
        projectId: request.project.projectId,
        project: request.project,
        expectedUpdatedAt: request.expectedUpdatedAt
      });
      setActiveProjectId(project.projectId);
      return project;
    },
    async cloneRelayProject(request) {
      const project = await projectCenter.cloneProject(request.projectId, { name: request.name });
      setActiveProjectId(project.projectId);
      return project;
    },
    async archiveRelayProject(request) {
      const project = await projectCenter.archiveProject(request.projectId);
      if (activeProjectId === project.projectId) setActiveProjectId(null);
      return project;
    },
    async restoreRelayProject(request) {
      const project = await projectCenter.restoreProject(request.projectId);
      setActiveProjectId(project.projectId);
      return project;
    },
    async chooseAndConfigureDataRoot(request) {
      const selected = await dialog.showOpenDialog({
        title: request.mode === "migrate" ? "选择新的 Relay 数据目录并迁移" : "选择新的 Relay 数据目录",
        defaultPath: dataRootState.layout.root,
        properties: ["openDirectory", "createDirectory"]
      });
      if (selected.canceled || selected.filePaths.length !== 1) return null;
      const targetRoot = selected.filePaths[0];
      if (targetRoot === undefined || !isAbsolute(targetRoot)) throw new Error("DATA_ROOT.INVALID_SELECTION");
      await validateStartupDataRoot(targetRoot, inspectDataRootVolume);
      await configureDataRoot({
        userDataPath,
        targetRoot,
        mode: request.mode,
        ...(request.mode === "migrate" ? { sourceRoot: dataRootState.layout.root } : {})
      });
      dataRootState = Object.freeze({
        layout: await ensureDataRootLayout(targetRoot),
        theme: dataRootState.theme
      });
      projectCenter = await createProjectCenter(dataRootState.layout);
      projectCenterForGeneratedVideos = projectCenter;
      setActiveProjectId((await projectCenter.listRecentProjects())[0]?.projectId ?? null);
      const state = await projectState();
      const restart = setTimeout(() => {
        app.relaunch();
        app.exit(0);
      }, 350);
      restart.unref();
      return state;
    },
    async openDataRoot() {
      return await shell.openPath(dataRootState.layout.root) === "";
    },
    async importProjectAssets(request) {
      const mode = request.mode ?? "copy";
      const selected = await dialog.showOpenDialog({
        title: mode === "copy" ? "导入素材" : "引用本地素材（源文件移动后需要重新定位）",
        properties: ["openFile", "multiSelections"],
        filters: ASSET_DIALOG_FILTERS.map((filter) => ({ name: filter.name, extensions: [...filter.extensions] }))
      });
      if (selected.canceled) {
        return Object.freeze({ cancelled: true, importedCount: 0, duplicateCount: 0, rejectedCount: 0, results: Object.freeze([]) });
      }
      const result = await projectCenter.importAssets(request.projectId, {
        paths: selected.filePaths,
        mode
      });
      return Object.freeze({
        cancelled: false,
        importedCount: result.importedCount,
        duplicateCount: result.duplicateCount,
        rejectedCount: result.rejectedCount,
        results: Object.freeze(result.results.map((entry) => Object.freeze({
          fileName: entry.fileName,
          status: entry.status,
          asset: entry.asset,
          duplicateAssetId: entry.duplicateAssetId,
          issues: Object.freeze(entry.preflight.issues.map((issue) => issue.message))
        })))
      });
    },
    async importDroppedProjectAssets(request) {
      const result = await projectCenter.importAssets(request.projectId, {
        paths: request.paths,
        mode: request.mode ?? "copy"
      });
      return Object.freeze({
        cancelled: false,
        importedCount: result.importedCount,
        duplicateCount: result.duplicateCount,
        rejectedCount: result.rejectedCount,
        results: Object.freeze(result.results.map((entry) => Object.freeze({
          fileName: entry.fileName,
          status: entry.status,
          asset: entry.asset,
          duplicateAssetId: entry.duplicateAssetId,
          issues: Object.freeze(entry.preflight.issues.map((issue) => issue.message))
        })))
      });
    },
    listProjectAssets: (request) => projectCenter.listAssets(request.projectId, request),
    updateProjectAsset: (request) => projectCenter.updateAsset(request.projectId, request.assetId, {
      ...(request.displayName === undefined ? {} : { displayName: request.displayName }),
      ...(request.tags === undefined ? {} : { tags: request.tags }),
      ...(request.notes === undefined ? {} : { notes: request.notes })
    }),
    refreshProjectAssets: (request) => projectCenter.refreshAssets(request.projectId),
    async relocateProjectAsset(request) {
      const selected = await dialog.showOpenDialog({
        title: "重新定位项目素材",
        properties: ["openFile"],
        filters: ASSET_DIALOG_FILTERS.map((filter) => ({ name: filter.name, extensions: [...filter.extensions] }))
      });
      if (selected.canceled || selected.filePaths.length !== 1) {
        return Object.freeze({ status: "cancelled", asset: null, issues: Object.freeze([]) });
      }
      const result = await projectCenter.relinkAsset(request.projectId, request.assetId, selected.filePaths[0]!, false);
      return Object.freeze({
        status: result.status,
        asset: result.asset,
        issues: Object.freeze(result.preflight.issues.map((issue) => issue.message))
      });
    },
    removeProjectAsset: (request) => projectCenter.removeAsset(request.projectId, request.assetId),
    listDeletedProjectAssets: (request) => projectCenter.listDeletedAssets(request.projectId),
    restoreProjectAsset: (request) => projectCenter.restoreAsset(request.projectId, request.assetId),
    getProjectAssetPreview: (request) => projectCenter.getAssetPreview(request.projectId, request.assetId),
    bindProjectAsset: (request) => projectCenter.bindAsset(request.projectId, request),
    unbindProjectAsset: (request) => projectCenter.unbindAsset(request.projectId, request.bindingId),
    async revealProjectAsset(request) {
      await projectCenter.revealAsset(request.projectId, request.assetId);
      return true;
    },
    async prepareProjectAssetFrame(request) {
      const absolutePath = await projectCenter.resolveUsableAssetPath(request.projectId, request.assetId);
      return services.registerTrustedFrameSelection(absolutePath, request.slot);
    },
    async copyProjectAssetIntoProject(request) {
      return projectCenter.copyAssetIntoProject(request.projectId, request.assetId);
    },
    async exportRelayProjectBundle(request) {
      const project = await projectCenter.loadProject(request.projectId);
      const selected = await dialog.showSaveDialog({
        title: "导出 Relay 项目包",
        defaultPath: `${project.name}.relayproj`,
        filters: [{ name: "Relay 项目包", extensions: ["relayproj"] }]
      });
      if (selected.canceled || selected.filePath === undefined) {
        return Object.freeze({ cancelled: true, displayPath: null, project: null, sha256: null, byteLength: 0 });
      }
      const result = await projectCenter.exportProjectBundle({
        projectId: request.projectId,
        destinationPath: selected.filePath,
        externalReferencePolicy: request.externalReferencePolicy
      });
      return Object.freeze({
        cancelled: false,
        displayPath: result.fileName,
        project,
        sha256: result.sha256,
        byteLength: result.byteLength
      });
    },
    async importRelayProjectBundle() {
      const selected = await dialog.showOpenDialog({
        title: "导入 Relay 项目包",
        properties: ["openFile"],
        filters: [{ name: "Relay 项目包", extensions: ["relayproj"] }]
      });
      if (selected.canceled || selected.filePaths.length !== 1) {
        return Object.freeze({ cancelled: true, displayPath: null, project: null, sha256: null, byteLength: 0 });
      }
      const result = await projectCenter.importProjectBundle({
        bundlePath: selected.filePaths[0]!,
        onProjectIdConflict: "copy"
      });
      setActiveProjectId(result.project.projectId);
      return Object.freeze({
        cancelled: false,
        displayPath: selected.filePaths[0]!.split(/[\\/]/u).at(-1) ?? "project.relayproj",
        project: result.project,
        sha256: null,
        byteLength: 0
      });
    }
  });
  registerClosedIpcRegistry(
    rendererUrl,
    services,
    assetLibrary,
    projectCenterController,
    async (theme) => {
      await saveUiThemePreference(dataRootState.layout.config, theme, "ui.json");
      await applyUiTheme(controlWindow, theme);
    },
    async (target: AboutLinkTarget) => {
      const targetUrl = target === "author"
        ? RELAY_UPDATE_SOURCE.authorProfileUrl
        : RELAY_UPDATE_SOURCE.repositoryPageUrl;
      await shell.openExternal(targetUrl);
      return true;
    }
  );
  controlWindow = createControlWindow(initialTheme, rendererUrl);
}).catch(async (error: unknown) => {
  await presentFatalStartupFailure(error);
});

app.on("window-all-closed", finishApplicationExitWhenWindowsClosed);
app.once("before-quit", disposeAbCliAdapters);
app.once("before-quit", prepareApplicationQuit);
