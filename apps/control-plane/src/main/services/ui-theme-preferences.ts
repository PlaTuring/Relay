import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { UiTheme } from "../../shared/ipc-contract.js";

const THEME_PREFERENCE_FILE = "relay-ui-theme.json";
const MAX_PREFERENCE_BYTES = 512;

interface PersistedThemePreference {
  readonly version: 1;
  readonly theme: UiTheme;
}

export function uiThemePreferencePath(userDataPath: string, fileName = THEME_PREFERENCE_FILE): string {
  return join(userDataPath, fileName);
}

export async function loadUiThemePreference(
  userDataPath: string,
  fallback: UiTheme,
  fileName = THEME_PREFERENCE_FILE
): Promise<UiTheme> {
  try {
    const path = uiThemePreferencePath(userDataPath, fileName);
    const contents = await readFile(path, "utf8");
    if (Buffer.byteLength(contents, "utf8") > MAX_PREFERENCE_BYTES) return fallback;
    const parsed: unknown = JSON.parse(contents);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      Object.keys(parsed).sort().join(",") !== "theme,version"
    ) return fallback;
    const record = parsed as Partial<PersistedThemePreference>;
    return record.version === 1 && (record.theme === "light" || record.theme === "dark")
      ? record.theme
      : fallback;
  } catch {
    return fallback;
  }
}

export async function saveUiThemePreference(
  userDataPath: string,
  theme: UiTheme,
  fileName = THEME_PREFERENCE_FILE
): Promise<void> {
  await mkdir(userDataPath, { recursive: true });
  const destination = uiThemePreferencePath(userDataPath, fileName);
  const temporary = `${destination}.tmp-${process.pid}`;
  const payload: PersistedThemePreference = Object.freeze({ version: 1, theme });
  try {
    await writeFile(temporary, `${JSON.stringify(payload)}\n`, { encoding: "utf8", flag: "w" });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}
