import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { deepFreeze } from "./util.mjs";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT_BYTES = 1024 * 1024;
const TIMEOUT_MS = 8_000;

const DISK_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  "$items=Get-CimInstance -ClassName Win32_LogicalDisk | Select-Object DeviceID,DriveType,FileSystem,Size,FreeSpace",
  "$items | ConvertTo-Json -Compress -Depth 3"
].join(";");

const WMI_GPU_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  "$items=Get-CimInstance -ClassName Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion",
  "$items | ConvertTo-Json -Compress -Depth 3"
].join(";");

function safeJsonArray(text) {
  if (typeof text !== "string" || text.length === 0 || text.length > MAX_OUTPUT_BYTES || /[\0\uD800-\uDFFF]/u.test(text)) return [];
  try {
    const value = JSON.parse(text);
    const array = Array.isArray(value) ? value : value === null ? [] : [value];
    return array.filter((item) => item !== null && typeof item === "object" && !Array.isArray(item));
  } catch {
    return [];
  }
}

function finiteInteger(value) {
  const number = typeof value === "string" && /^[0-9]+$/u.test(value) ? Number(value) : value;
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

export function createLiveProcessRunner({ environment = process.env, execute = execFileAsync } = {}) {
  const systemRoot = environment.SystemRoot ?? "C:\\Windows";
  const programFiles = environment.ProgramFiles ?? `${path.win32.parse(systemRoot).root}Program Files`;
  const programW6432 = environment.ProgramW6432 ?? programFiles;
  return Object.freeze({
    async run(executable, args) {
      try {
        const result = await execute(executable, args, {
          encoding: "utf8",
          windowsHide: true,
          timeout: TIMEOUT_MS,
          maxBuffer: MAX_OUTPUT_BYTES,
          shell: false,
          env: {
            SystemRoot: systemRoot,
            WINDIR: environment.WINDIR ?? systemRoot,
            ProgramFiles: programFiles,
            ProgramW6432: programW6432
          }
        });
        return Object.freeze({ ok: true, stdout: result.stdout });
      } catch {
        return Object.freeze({ ok: false, stdout: "" });
      }
    }
  });
}

function parseSmi(text) {
  const rows = [];
  for (const line of String(text).split(/\r?\n/u)) {
    if (!line.trim()) continue;
    const parts = line.split(",").map((part) => part.trim());
    if (parts.length !== 4 || !/^[0-9]+$/u.test(parts[0]) || !/^[0-9]+$/u.test(parts[2])) continue;
    const memoryMiB = Number(parts[2]);
    if (!Number.isSafeInteger(memoryMiB) || memoryMiB <= 0 || memoryMiB > 1024 * 1024) continue;
    rows.push({
      index: Number(parts[0]),
      product_name: parts[1].slice(0, 256),
      vram_bytes: memoryMiB * 1024 * 1024,
      driver_version: parts[3].slice(0, 128)
    });
  }
  return rows.sort((left, right) => left.index - right.index);
}

function parseVolumes(text) {
  return safeJsonArray(text)
    .map((item) => ({
      drive_letter: typeof item.DeviceID === "string" && /^[A-Za-z]:$/u.test(item.DeviceID) ? item.DeviceID.toUpperCase() : null,
      drive_type: item.DriveType === 3 ? "fixed_local" : "other",
      filesystem: typeof item.FileSystem === "string" ? item.FileSystem.toLowerCase() : "unknown",
      capacity_bytes: finiteInteger(item.Size),
      free_bytes: finiteInteger(item.FreeSpace)
    }))
    .filter((item) => item.drive_letter && item.capacity_bytes !== null && item.free_bytes !== null)
    .sort((left, right) => left.drive_letter.localeCompare(right.drive_letter, "en-US"));
}

function parseWmiGpus(text) {
  return safeJsonArray(text).map((item, index) => ({
    index,
    product_name: typeof item.Name === "string" ? item.Name.slice(0, 256) : "unknown",
    vram_bytes: finiteInteger(item.AdapterRAM),
    driver_version: typeof item.DriverVersion === "string" ? item.DriverVersion.slice(0, 128) : "unknown"
  }));
}

function resolveGpuClaims(smi, wmi) {
  const resolutions = [];
  const usedWmi = new Set();
  const normalizedName = (value) => String(value).trim().toLocaleLowerCase("en-US");
  for (const preferred of smi) {
    const fallbackIndex = wmi.findIndex((candidate, index) =>
      !usedWmi.has(index) && normalizedName(candidate.product_name) === normalizedName(preferred.product_name));
    const fallback = fallbackIndex >= 0 ? wmi[fallbackIndex] : undefined;
    if (fallbackIndex >= 0) usedWmi.add(fallbackIndex);
    const sources = [];
    sources.push({ kind: "nvidia_smi", confidence_basis_points: 9500, ...preferred });
    if (fallback) sources.push({ kind: "wmi_cim", confidence_basis_points: 2500, ...fallback });
    resolutions.push({
      subject_id: `gpu-${resolutions.length}`,
      status: "resolved_observation",
      reason: fallback?.vram_bytes && preferred.vram_bytes !== fallback.vram_bytes
        ? "preferred_source_exact_wmi_non_authoritative"
        : "preferred_source_exact",
      official_support_claim: "none",
      sources
    });
  }
  for (const [index, fallback] of wmi.entries()) {
    if (usedWmi.has(index)) continue;
    resolutions.push({
      subject_id: `gpu-${resolutions.length}`,
      status: "non_actionable",
      reason: "wmi_only_never_certifies_recipe",
      official_support_claim: "none",
      sources: [{ kind: "wmi_cim", confidence_basis_points: 2500, ...fallback }]
    });
  }
  return resolutions;
}

export async function probeWindowsHost({ runner = createLiveProcessRunner(), platform = process.platform } = {}) {
  const system = {
    platform,
    architecture: os.arch(),
    logical_processor_count: os.cpus().length,
    system_ram_bytes: os.totalmem()
  };
  if (platform !== "win32") {
    return deepFreeze({
      probe_status: "unsupported_platform",
      system,
      volumes: [],
      gpus: [],
      failures: ["LOCAL_RUNTIME.WINDOWS_REQUIRED"]
    });
  }

  const configuredSystemRoot = process.env.SystemRoot ?? "C:\\Windows";
  const systemRoot = /^[A-Za-z]:\\[^\0:]+$/u.test(configuredSystemRoot) ? path.win32.normalize(configuredSystemRoot) : "C:\\Windows";
  const powershell = path.win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const smiCandidates = [
    path.win32.join(systemRoot, "System32", "nvidia-smi.exe"),
    `${path.win32.parse(systemRoot).root}Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe`
  ];
  const smiArguments = ["--query-gpu=index,name,memory.total,driver_version", "--format=csv,noheader,nounits"];
  const diskPromise = runner.run(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", DISK_SCRIPT]);
  const wmiPromise = runner.run(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", WMI_GPU_SCRIPT]);
  const smiPromise = (async () => {
    for (const candidate of smiCandidates) {
      const result = await runner.run(candidate, smiArguments);
      if (result.ok) return result;
    }
    return Object.freeze({ ok: false, stdout: "" });
  })();
  const [diskResult, smiResult, wmiResult] = await Promise.all([diskPromise, smiPromise, wmiPromise]);
  const failures = [];
  if (!diskResult.ok) failures.push("LOCAL_RUNTIME.DISK_PROBE_UNAVAILABLE");
  if (!smiResult.ok) failures.push("LOCAL_RUNTIME.SMI_PROBE_UNAVAILABLE");
  if (!wmiResult.ok) failures.push("LOCAL_RUNTIME.WMI_GPU_PROBE_UNAVAILABLE");
  const volumes = diskResult.ok ? parseVolumes(diskResult.stdout) : [];
  const smi = smiResult.ok ? parseSmi(smiResult.stdout) : [];
  const wmi = wmiResult.ok ? parseWmiGpus(wmiResult.stdout) : [];
  return deepFreeze({
    probe_status: failures.length === 3 ? "unavailable" : failures.length ? "partial" : "complete",
    system,
    volumes,
    gpus: resolveGpuClaims(smi, wmi),
    failures: failures.sort()
  });
}

export function createFixtureHostProbe(observation) {
  return Object.freeze({
    async probe() {
      return deepFreeze(structuredClone(observation));
    }
  });
}
