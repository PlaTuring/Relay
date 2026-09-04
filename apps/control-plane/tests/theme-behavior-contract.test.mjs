import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const rendererPath = resolve(import.meta.dirname, "..", "src", "renderer", "index.ts");

test("renderer migrates legacy theme state through native IPC and never re-persists it in localStorage", async () => {
  const renderer = await readFile(rendererPath, "utf8");

  assert.match(renderer, /type ThemeChoice = "light" \| "dark";/u);
  assert.match(renderer, /THEME_STORAGE_KEY = "relay-ui-theme"/u);
  assert.match(renderer, /LEGACY_THEME_STORAGE_KEY = "minimax-h3-theme"/u);
  assert.match(renderer, /document\.documentElement\.dataset\.theme = theme/u);
  assert.match(renderer, /button\[data-theme-choice="\$\{choice\}"\]/u);
  assert.match(renderer, /button\.setAttribute\("aria-pressed", String\(active\)\)/u);
  assert.match(renderer, /button\.title = active/u);
  assert.match(renderer, /function syncNativeTheme\(theme: ThemeChoice, reportPersistenceFailure = false\): void \{[\s\S]*?\.setUiTheme\(theme\)\.catch\(\(error: unknown\) => \{[\s\S]*?主题仅在当前会话生效[\s\S]*?catch \(error\)/u);
  assert.match(renderer, /function applyTheme\(theme: ThemeChoice, reportPersistenceFailure = false\): void \{[\s\S]*?syncNativeTheme\(theme, reportPersistenceFailure\);/u);

  assert.match(renderer, /function readStoredTheme\(\): ThemeChoice \| null \{[\s\S]*?try \{[\s\S]*?localStorage\.getItem\(THEME_STORAGE_KEY\)[\s\S]*?catch \{/u);
  assert.match(renderer, /function persistTheme\(theme: ThemeChoice\): void \{[\s\S]*?try \{[\s\S]*?localStorage\.removeItem\(THEME_STORAGE_KEY\)[\s\S]*?localStorage\.removeItem\(LEGACY_THEME_STORAGE_KEY\)[\s\S]*?catch \{/u);
  assert.doesNotMatch(
    renderer,
    /localStorage\.setItem\((?:THEME_STORAGE_KEY|LEGACY_THEME_STORAGE_KEY)/u,
    "dataRoot config/ui.json, not renderer localStorage, is the theme authority"
  );
  assert.match(renderer, /saved === "light" \|\| saved === "dark" \? saved : null/u);

  assert.match(renderer, /matchMedia\("\(prefers-color-scheme: dark\)"\)/u);
  assert.match(renderer, /let followsSystemTheme = storedTheme === null/u);
  assert.match(renderer, /applyTheme\(storedTheme \?\? readThemeFromRendererUrl\(\) \?\? \(systemColorScheme\?\.matches === true \? "dark" : "light"\)\)/u);
  assert.match(renderer, /button\.addEventListener\("click", \(\) => \{[\s\S]*?followsSystemTheme = false;[\s\S]*?applyTheme\(choice, true\);[\s\S]*?persistTheme\(choice\);/u);
  assert.match(renderer, /systemColorScheme\?\.addEventListener\("change", \(event\) => \{[\s\S]*?if \(followsSystemTheme\) applyTheme\(event\.matches \? "dark" : "light"\);/u);
});

test("theme selection also updates the native Electron title bar through a closed channel", async () => {
  const root = resolve(import.meta.dirname, "..");
  const [contract, preload, registry, main, security] = await Promise.all([
    readFile(resolve(root, "src", "shared", "ipc-contract.ts"), "utf8"),
    readFile(resolve(root, "src", "preload", "index.ts"), "utf8"),
    readFile(resolve(root, "src", "main", "ipc-registry.ts"), "utf8"),
    readFile(resolve(root, "src", "main", "main.ts"), "utf8"),
    readFile(resolve(root, "src", "main", "security.ts"), "utf8")
  ]);

  assert.ok(contract.includes('setUiTheme: "control:set-ui-theme"'));
  assert.ok(contract.includes('export type UiTheme = "light" | "dark"'));
  assert.ok(preload.includes("ipcRenderer.invoke(IPC_REGISTRY.setUiTheme, theme)"));
  assert.ok(registry.includes('const UI_THEMES = new Set<UiTheme>(["light", "dark"])'));
  assert.ok(registry.includes("setUiTheme(validateUiTheme(input))"));
  assert.ok(main.includes('titleBarStyle: "hidden"'));
  assert.ok(main.includes("if (!controlSession.isPersistent())"));
  assert.ok(main.includes('throw new Error("CONTROL_SESSION.PERSISTENCE_REQUIRED")'));
  assert.ok(main.includes("titleBarOverlay:"));
  assert.ok(main.includes("window.setTitleBarOverlay"));
  assert.ok(main.includes("nativeTheme.themeSource = theme"));
  assert.match(
    main,
    /loadUiThemePreference\(\s*layout\.config,\s*legacyTheme \?\? systemTheme,\s*"ui\.json"\s*\)/u
  );
  assert.ok(main.includes('saveUiThemePreference(layout.config, legacyTheme, "ui.json")'));
  assert.ok(main.includes('saveUiThemePreference(dataRootState.layout.config, theme, "ui.json")'));
  assert.ok(security.includes('CONTROL_SESSION_PARTITION = "persist:minimax-h3-control-plane"'));
  assert.ok(security.includes("partition: CONTROL_SESSION_PARTITION"));
});
