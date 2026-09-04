import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { nativeEvidenceRoot, projectRoot, releaseArtifactName, releaseEvidenceId, sha256File } from "./lib.mjs";
import { loadSigningConfiguration, verifyPeSignature } from "./signing-contract.mjs";

let signedMode = false;
for (const argument of process.argv.slice(2)) {
  if (argument === "--signed") signedMode = true;
  else throw new Error("INSTALLER.INVALID_ARGUMENT");
}
const signingConfiguration = signedMode ? await loadSigningConfiguration(process.env) : null;
const releaseMode = signedMode ? "signed" : "unsigned";
const releaseRoot = resolve(projectRoot, signedMode ? "release-signed" : "release-unsigned");

const evidenceRoot = nativeEvidenceRoot;
const validationRoot = resolve(evidenceRoot, signedMode ? "installer-validation-signed" : "installer-validation");
const installRoot = resolve(validationRoot, "installed", "Relay");
const profileRoot = resolve(validationRoot, "profile");
const probeUserData = resolve(profileRoot, "UserData");
const probeDataRoot = resolve(validationRoot, "ManagedDataRoot");
const markerPath = resolve(validationRoot, `.relay-${releaseEvidenceId}-validation-root`);
const evidencePath = resolve(
  evidenceRoot,
  signedMode ? "installer-runtime-validation-signed.json" : "installer-runtime-validation.json"
);
const installedExecutable = resolve(installRoot, "Relay.exe");
const uninstaller = resolve(installRoot, "Uninstall Relay.exe");

function contained(path, root) {
  const child = relative(root, path);
  return child.length > 0 && child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

async function exists(path) {
  try { await stat(path); return true; } catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}

async function waitForRequiredOutputs(paths, attempts = 120, intervalMs = 250) {
  let missing = [];
  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    missing = [];
    for (const path of paths) {
      if (!await exists(path)) missing.push(path);
    }
    if (missing.length === 0) return { missing, waitedMs: attempt * intervalMs };
    if (attempt < attempts) await new Promise((resolveDelay) => setTimeout(resolveDelay, intervalMs));
  }
  return { missing, waitedMs: attempts * intervalMs };
}

function powershell(script, environment = {}) {
  return spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8", env: { ...process.env, ...environment }, shell: false, windowsHide: true, timeout: 15_000
  });
}

function specialFolder(name) {
  const result = powershell(`$p=[Environment]::GetFolderPath('${name}'); [Console]::Out.Write($p)`);
  if (result.status !== 0 || !isAbsolute(result.stdout.trim())) throw new Error("INSTALLER.SPECIAL_FOLDER_FAILED");
  return result.stdout.trim();
}

function shortcutTarget(path) {
  const script = "$w=New-Object -ComObject WScript.Shell; [Console]::Out.Write($w.CreateShortcut($env:RELAY_VALIDATION_SHORTCUT_PATH).TargetPath)";
  const result = powershell(script, { RELAY_VALIDATION_SHORTCUT_PATH: path });
  if (result.status !== 0) throw new Error("INSTALLER.SHORTCUT_READ_FAILED");
  return result.stdout.trim();
}

function installedProbeProcesses(rootPid, executable) {
  const script = String.raw`
$rootPid = [int]$env:RELAY_VALIDATION_ROOT_PID
$target = [IO.Path]::GetFullPath($env:RELAY_VALIDATION_EXECUTABLE)
$all = @(Get-CimInstance Win32_Process)
$owned = [Collections.Generic.HashSet[int]]::new()
[void]$owned.Add($rootPid)
$changed = $true
while ($changed) {
  $changed = $false
  foreach ($process in $all) {
    if ($owned.Contains([int]$process.ParentProcessId) -and $owned.Add([int]$process.ProcessId)) { $changed = $true }
  }
}
$result = @($all | Where-Object {
  $owned.Contains([int]$_.ProcessId) -or
  ($_.ExecutablePath -and [IO.Path]::GetFullPath($_.ExecutablePath).Equals($target, [StringComparison]::OrdinalIgnoreCase))
} | Select-Object ProcessId, ParentProcessId, Name, ExecutablePath)
if ($result.Count -gt 0) { [Console]::Out.Write(($result | ConvertTo-Json -Compress)) }
`;
  const result = powershell(script, {
    RELAY_VALIDATION_ROOT_PID: String(rootPid),
    RELAY_VALIDATION_EXECUTABLE: executable
  });
  if (result.status !== 0) throw new Error("INSTALLER.PROBE_PROCESS_ENUMERATION_FAILED");
  if (result.stdout.trim().length === 0) return [];
  const parsed = JSON.parse(result.stdout);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function runInstalledAppProbe(executable, userDataPath, cwd, environment) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, [`--user-data-dir=${userDataPath}`], {
      cwd, env: environment, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"]
    });
    const rootPid = child.pid;
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      // This is the exact validation-owned root PID, never a global name kill.
      child.kill();
    }, 30_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolvePromise({ code, signal, rootPid, stdout, stderr, timedOut });
    });
  });
}

const packageMetadata = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8"));
const version = packageMetadata.version;
await rm(evidencePath, { force: true });
if (typeof version !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(version)) throw new Error("INSTALLER.VERSION_INVALID");
const setupPath = resolve(releaseRoot, releaseArtifactName("setup"));
const portablePath = resolve(releaseRoot, releaseArtifactName("portable"));
if (!await exists(setupPath)) throw new Error("INSTALLER.SETUP_MISSING");
if (signedMode && !await exists(portablePath)) throw new Error("INSTALLER.PORTABLE_MISSING");
if (!contained(installRoot, evidenceRoot) || !contained(validationRoot, evidenceRoot)) throw new Error("INSTALLER.ROOT_NOT_CONTAINED");
const desktopShortcut = resolve(specialFolder("Desktop"), "Relay.lnk");
const startMenuShortcut = resolve(specialFolder("Programs"), "Relay.lnk");
if (await exists(validationRoot)) {
  if (!await exists(markerPath)) throw new Error("INSTALLER.PREVIOUS_ROOT_UNOWNED");
  if (await exists(uninstaller)) {
    spawnSync(uninstaller, ["/S"], {
      // Keep the uninstaller's working directory outside the installation
      // tree.  NSIS copies itself to a temporary process; if that process
      // inherits installRoot as its CWD, Windows can leave the otherwise
      // empty install directory behind even though uninstall succeeded.
      cwd: validationRoot, encoding: "utf8", shell: false, windowsHide: true, timeout: 120_000
    });
  }
  for (const shortcut of [desktopShortcut, startMenuShortcut]) {
    if (!await exists(shortcut)) continue;
    const target = shortcutTarget(shortcut);
    if (resolve(target).toLocaleLowerCase("en-US") === resolve(installedExecutable).toLocaleLowerCase("en-US")) {
      await rm(shortcut, { force: true });
    }
  }
  await rm(validationRoot, { recursive: true, force: true });
}
await mkdir(resolve(validationRoot, "installed"), { recursive: true });
await mkdir(resolve(profileRoot, "Roaming"), { recursive: true });
await mkdir(resolve(profileRoot, "Local"), { recursive: true });
await mkdir(probeUserData, { recursive: true });
await mkdir(probeDataRoot, { recursive: true });
await writeFile(
  resolve(probeUserData, "data-root.pointer.json"),
  `${JSON.stringify({ version: 1, dataRoot: probeDataRoot, updatedAt: "2026-09-01T00:00:00.000Z" }, null, 2)}\n`,
  "utf8"
);
await writeFile(markerPath, `relay-${releaseEvidenceId}-installer-validation\n`, "utf8");

if (await exists(desktopShortcut) || await exists(startMenuShortcut)) {
  throw new Error("INSTALLER.PREEXISTING_SHORTCUT_PROTECTED");
}

const evidence = {
  schema_version: 1,
  release_mode: releaseMode,
  conclusion: "failed",
  installer_sha256: await sha256File(setupPath),
  installer_exit_code: null,
  installer_output_wait_ms: 0,
  desktop_shortcut: { created: false, target_verified: false },
  start_menu_shortcut: { created: false, target_verified: false },
  installed_native_helper: { runtime_probe: "not_run", sha256: null },
  installed_app_probe: "not_run",
  installed_app_probe_diagnostics: null,
  installed_app_process_release: { root_pid: null, waited_ms: 0, remaining: [] },
  installed_app_executable_release_wait_ms: null,
  uninstall: { exit_code: null, install_directory_removed: false, shortcuts_removed: false, waited_ms: 0, residue_entries: [] },
  failure_cleanup: { attempted: false, install_directory_removed: false, shortcuts_removed: false },
  signatures: signedMode ? { release_artifacts: [], installed: [] } : null,
  product_boundary: { ran_model: false, submitted_prompt: false, submitted_queue: false, generated_media: false }
};

try {
  if (signedMode) {
    evidence.signatures.release_artifacts = [
      await verifyPeSignature(setupPath, "setup", signingConfiguration),
      await verifyPeSignature(portablePath, "portable", signingConfiguration)
    ];
  }
  const install = spawnSync(setupPath, ["/S", `/D=${installRoot}`], {
    cwd: dirname(setupPath), encoding: "utf8", shell: false, windowsHide: true, timeout: 120_000
  });
  evidence.installer_exit_code = install.status;
  if (install.status !== 0) throw new Error("INSTALLER.INSTALL_FAILED");
  const installedHelper = resolve(installRoot, "resources", "app.asar.unpacked", "dist", "main", "native", "relay-winbroker.exe");
  const installedProfile = resolve(installRoot, "resources", "app.asar.unpacked", "dist", "main", "native", "capability-profile.v1.json");
  // The outer NSIS launcher can exit before its unelevated child has finished
  // committing files and shortcuts. Observe the real outputs for a bounded
  // interval instead of turning that normal hand-off into a false failure.
  const requiredOutputs = [installedExecutable, installedHelper, installedProfile, uninstaller, desktopShortcut, startMenuShortcut];
  const installedOutputs = await waitForRequiredOutputs(requiredOutputs);
  evidence.installer_output_wait_ms = installedOutputs.waitedMs;
  if (installedOutputs.missing.length > 0) throw new Error("INSTALLER.REQUIRED_OUTPUT_MISSING");
  if (signedMode) {
    evidence.signatures.installed = [
      await verifyPeSignature(installedExecutable, "installed_application", signingConfiguration),
      await verifyPeSignature(installedHelper, "installed_native_helper", signingConfiguration),
      await verifyPeSignature(uninstaller, "installed_uninstaller", signingConfiguration)
    ];
  }
  evidence.desktop_shortcut = {
    created: true,
    target_verified: resolve(shortcutTarget(desktopShortcut)).toLocaleLowerCase("en-US") === resolve(installedExecutable).toLocaleLowerCase("en-US")
  };
  evidence.start_menu_shortcut = {
    created: true,
    target_verified: resolve(shortcutTarget(startMenuShortcut)).toLocaleLowerCase("en-US") === resolve(installedExecutable).toLocaleLowerCase("en-US")
  };
  if (!evidence.desktop_shortcut.target_verified || !evidence.start_menu_shortcut.target_verified) {
    throw new Error("INSTALLER.SHORTCUT_TARGET_MISMATCH");
  }
  const helperProbe = spawnSync(process.execPath, [
    resolve(projectRoot, "scripts", "verify-native-helper.mjs"),
    "--binary", installedHelper,
    "--profile", installedProfile,
    "--evidence-file", "installed-native-runtime-probe.json"
  ], { cwd: projectRoot, encoding: "utf8", shell: false, windowsHide: true, timeout: 30_000 });
  if (helperProbe.status !== 0 || !helperProbe.stdout.includes("status=enabled-profile-passed")) {
    throw new Error("INSTALLER.NATIVE_RUNTIME_PROBE_FAILED");
  }
  evidence.installed_native_helper = { runtime_probe: "passed", sha256: await sha256File(installedHelper) };
  const appEnvironment = { ...process.env,
    APPDATA: resolve(profileRoot, "Roaming"), LOCALAPPDATA: resolve(profileRoot, "Local"),
    MINIMAX_H3_PACKAGED_PROBE: "1" };
  delete appEnvironment.ELECTRON_RUN_AS_NODE;
  delete appEnvironment.NODE_OPTIONS;
  // Match a shortcut/external launch without pinning the install directory as
  // the probe process CWD.  The executable resolves all resources from
  // process.execPath; no product behavior depends on a mutable CWD.
  const appProbe = await runInstalledAppProbe(installedExecutable, probeUserData, validationRoot, appEnvironment);
  evidence.installed_app_probe_diagnostics = {
    timed_out: appProbe.timedOut,
    exit_code: appProbe.code,
    signal: appProbe.signal,
    root_pid: appProbe.rootPid,
    native_marker: appProbe.stdout.includes("PACKAGED_NATIVE_HELPER_READY profile=relay.win32.path-inspection enabled=2"),
    adapter_marker: appProbe.stdout.includes("PACKAGED_ADAPTER_READY streamA=stream_a_cli streamB=stream_b_cli"),
    stdout_tail: appProbe.stdout.slice(-8_192),
    stderr_tail: appProbe.stderr.slice(-8_192)
  };
  if (
    appProbe.timedOut || appProbe.code !== 0 || appProbe.signal !== null ||
    !appProbe.stdout.includes("PACKAGED_NATIVE_HELPER_READY profile=relay.win32.path-inspection enabled=2") ||
    !appProbe.stdout.includes("PACKAGED_ADAPTER_READY streamA=stream_a_cli streamB=stream_b_cli")
  ) throw new Error("INSTALLER.INSTALLED_APP_PROBE_FAILED");
  evidence.installed_app_probe = "passed";
  evidence.installed_app_process_release.root_pid = appProbe.rootPid;
  for (let attempt = 0; attempt <= 240; attempt += 1) {
    const remaining = installedProbeProcesses(appProbe.rootPid, installedExecutable);
    evidence.installed_app_process_release.remaining = remaining;
    evidence.installed_app_process_release.waited_ms = attempt * 250;
    if (remaining.length === 0) break;
    if (attempt === 240) throw new Error("INSTALLER.INSTALLED_APP_PROCESS_TREE_NOT_RELEASED");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  // A successful Electron process exit can be followed by a short Windows
  // image-map/antivirus release window.  Starting NSIS while Relay.exe is
  // still locked makes the uninstaller correctly remove every other file but
  // leave Relay.exe for reboot.  Prove the exact installed executable is
  // unlocked (rename round-trip) before testing uninstall.
  const executableUnlockProbe = `${installedExecutable}.relay-${releaseEvidenceId}-unlock-probe`;
  await rm(executableUnlockProbe, { force: true });
  for (let attempt = 0; attempt <= 240; attempt += 1) {
    try {
      await rename(installedExecutable, executableUnlockProbe);
      await rename(executableUnlockProbe, installedExecutable);
      evidence.installed_app_executable_release_wait_ms = attempt * 250;
      break;
    } catch (error) {
      if (!(["EBUSY", "EACCES", "EPERM"].includes(error?.code)) || attempt === 240) {
        throw new Error("INSTALLER.INSTALLED_APP_EXECUTABLE_NOT_RELEASED", { cause: error });
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }
  }
  const uninstall = spawnSync(uninstaller, ["/S"], {
    cwd: validationRoot, encoding: "utf8", shell: false, windowsHide: true, timeout: 120_000
  });
  evidence.uninstall.exit_code = uninstall.status;
  if (uninstall.status !== 0) throw new Error("INSTALLER.UNINSTALL_FAILED");
  // The NSIS launcher returns after delegating cleanup to its temporary
  // uninstaller process.  Antivirus/image-map release can take longer than
  // ten seconds after the installed executable was just probed, so observe
  // the real removal for up to one minute instead of declaring false residue.
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const installationRemains = await exists(installRoot);
    const shortcutRemains = await exists(desktopShortcut) || await exists(startMenuShortcut);
    if (!installationRemains && !shortcutRemains) break;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    evidence.uninstall.waited_ms += 250;
  }
  evidence.uninstall.install_directory_removed = !await exists(installRoot);
  evidence.uninstall.shortcuts_removed = !await exists(desktopShortcut) && !await exists(startMenuShortcut);
  if (!evidence.uninstall.install_directory_removed) {
    evidence.uninstall.residue_entries = await readdir(installRoot, { recursive: true });
  }
  if (!evidence.uninstall.install_directory_removed || !evidence.uninstall.shortcuts_removed) {
    throw new Error("INSTALLER.UNINSTALL_RESIDUE");
  }
  evidence.conclusion = "passed";
} finally {
  if (evidence.conclusion !== "passed") {
    evidence.failure_cleanup.attempted = true;
    if (await exists(uninstaller)) {
      spawnSync(uninstaller, ["/S"], {
        cwd: validationRoot, encoding: "utf8", shell: false, windowsHide: true, timeout: 120_000
      });
      for (let attempt = 0; attempt < 240 && await exists(installRoot); attempt += 1) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
      }
    }
    for (const shortcut of [desktopShortcut, startMenuShortcut]) {
      if (!await exists(shortcut)) continue;
      const target = shortcutTarget(shortcut);
      if (resolve(target).toLocaleLowerCase("en-US") === resolve(installedExecutable).toLocaleLowerCase("en-US")) {
        await rm(shortcut, { force: true });
      }
    }
    if (await exists(installRoot)) await rm(installRoot, { recursive: true, force: true });
    evidence.failure_cleanup.install_directory_removed = !await exists(installRoot);
    evidence.failure_cleanup.shortcuts_removed = !await exists(desktopShortcut) && !await exists(startMenuShortcut);
  }
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

process.stdout.write(
  signedMode
    ? "INSTALLER_VALIDATION status=passed mode=signed signatures=5 native=passed shortcuts=2 uninstall=passed\n"
    : "INSTALLER_VALIDATION status=passed native=passed shortcuts=2 uninstall=passed\n"
);
