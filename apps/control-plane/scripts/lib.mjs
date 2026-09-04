import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageMetadata = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8"));
const stableMatch = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.exec(packageMetadata.version ?? "");
if (stableMatch === null) throw new Error("RELEASE.INVALID_APPLICATION_VERSION");
export const applicationVersion = packageMetadata.version;
export const applicationDisplayVersion = Number(stableMatch[3]) === 0
  ? `${stableMatch[1]}.${stableMatch[2]}`
  : applicationVersion;
export const releaseEvidenceId = `v${applicationVersion}`;
export const nativeEvidenceRoot = resolve(
  projectRoot,
  "artifacts",
  `native-${releaseEvidenceId}`
);

export function releaseArtifactName(kind) {
  if (kind === "setup") return `Relay-${applicationDisplayVersion}-x64-Setup.exe`;
  if (kind === "portable") return `Relay-${applicationDisplayVersion}-x64-Portable.exe`;
  throw new TypeError("RELEASE.INVALID_ARTIFACT_KIND");
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export function offlineEnvironment() {
  const environment = {
    PATH: process.env.PATH ?? "",
    SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
    TEMP: process.env.TEMP ?? "",
    TMP: process.env.TMP ?? "",
    npm_config_offline: "true",
    npm_config_audit: "false",
    npm_config_fund: "false",
    npm_config_update_notifier: "false",
    NO_UPDATE_NOTIFIER: "1",
    HTTP_PROXY: "http://127.0.0.1:9",
    HTTPS_PROXY: "http://127.0.0.1:9",
    ALL_PROXY: "http://127.0.0.1:9",
    NO_PROXY: ""
  };
  for (const key of [
    "APPDATA",
    "LOCALAPPDATA",
    "USERPROFILE",
    "ComSpec",
    "PATHEXT",
    "ProgramData",
    "ProgramFiles",
    "ProgramFiles(x86)"
  ]) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

export function runNodeScript(relativeScript, args = []) {
  const result = spawnSync(
    process.execPath,
    [resolve(projectRoot, relativeScript), ...args],
    {
      cwd: projectRoot,
      encoding: "utf8",
      env: offlineEnvironment(),
      maxBuffer: 8 * 1024 * 1024,
      shell: false,
      windowsHide: true
    }
  );

  if (result.status !== 0) {
    const error = new Error(`VERIFY.STEP_FAILED:${relativeScript}`);
    error.cause = {
      status: result.status,
      signal: result.signal,
      stdout: result.stdout?.slice(0, 2_048),
      stderr: result.stderr?.slice(0, 2_048)
    };
    throw error;
  }
  return result.stdout.trim();
}
