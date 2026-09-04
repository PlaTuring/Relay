import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const prototypeRoot = resolve(scriptDirectory, "..");
const repositoryRoot = resolve(scriptDirectory, "../../../..");
const passes = [];

function check(id, condition, detail) {
  if (!condition) throw new Error(`${id} failed: ${detail}`);
  passes.push(id);
  process.stdout.write(`PASS ${id}\n`);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function runSanitized(executable, args) {
  const result = spawnSync(executable, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 30_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Sanitized subprocess failed: ${executable} exit=${result.status ?? "spawn"}`);
  }
  return result.stdout.trim();
}

function inspectManagedRoot(candidate, systemDrive) {
  if (
    typeof candidate !== "string" ||
    candidate.length === 0 ||
    candidate.length > 32_767 ||
    candidate.includes("\0") ||
    candidate.startsWith("\\\\") ||
    !/^[A-Za-z]:[\\/]/u.test(candidate)
  ) {
    return { accepted: false };
  }
  const drive = candidate.slice(0, 2).toUpperCase();
  return {
    accepted: true,
    displayPath: candidate,
    drive,
    isSystemDrive: drive === systemDrive.trim().toUpperCase(),
    containsSpaces: /\s/u.test(candidate),
    containsUnicode: /[^\x00-\x7f]/u.test(candidate),
  };
}

const exactCommands = [
  "security_get_summary",
  "choose_managed_root",
  "inspect_managed_root",
  "run_owned_child_probe",
];

const contract = await readJson(resolve(prototypeRoot, "design/comparison-contract.json"));
const dependencyPlan = await readJson(resolve(prototypeRoot, "design/dependency-plan.json"));
const config = await readJson(resolve(prototypeRoot, "design/tauri.conf.fixture.json"));
const fixtures = await readJson(resolve(prototypeRoot, "fixtures/comparison-cases.json"));
const capturedProbe = await readJson(resolve(prototypeRoot, "evidence/HOST_TOOLCHAIN_PROBE.json"));
const commandsSource = await readFile(
  resolve(prototypeRoot, "design/src-tauri/src/commands.rs"),
  "utf8",
);
const mainSource = await readFile(
  resolve(prototypeRoot, "design/src-tauri/src/main.rs"),
  "utf8",
);
const childSource = await readFile(
  resolve(prototypeRoot, "design/src-tauri/src/owned_child.rs"),
  "utf8",
);
const pathSource = await readFile(
  resolve(prototypeRoot, "design/src-tauri/src/path_policy.rs"),
  "utf8",
);
const bridgeSource = await readFile(resolve(prototypeRoot, "ui/bridge.fixture.ts"), "utf8");
const html = await readFile(resolve(prototypeRoot, "ui/index.html"), "utf8");
const css = await readFile(resolve(prototypeRoot, "ui/styles.css"), "utf8");

const liveProbeText = runSanitized("pwsh.exe", [
  "-NoLogo",
  "-NoProfile",
  "-NonInteractive",
  "-File",
  resolve(prototypeRoot, "scripts/probe-toolchain.ps1"),
]);
const liveProbe = JSON.parse(liveProbeText.split(/\r?\n/u).filter(Boolean).at(-1));
check(
  "ST-001-host-probe",
  isDeepStrictEqual(liveProbe, capturedProbe) &&
    liveProbe.guarantees.fileWrites === false &&
    liveProbe.guarantees.networkAccess === false &&
    liveProbe.guarantees.privatePathsEmitted === false,
  "captured sanitized toolchain evidence drifted",
);

check(
  "ST-002-product-boundary",
  contract.evidenceKind === "uncompiled-design-fixture" &&
    contract.productBoundary.controlPlaneOnly === true &&
    contract.productBoundary.toolSubmitsFormalQueue === false &&
    contract.productBoundary.toolGeneratesMedia === false &&
    contract.productBoundary.h3GeneratesAfterVisibleUserRunInComfy === true,
  "product boundary is missing or broadened",
);

check(
  "ST-003-command-contract",
  isDeepStrictEqual(
    contract.commandSurface.map((entry) => entry.command),
    exactCommands,
  ) && contract.commandSurface.length === 4,
  "command contract is not the exact four-command allowlist",
);

check(
  "ST-004-local-webview-config",
  config.fixtureStatus === "not-consumed-by-tauri-cli" &&
    config.build.frontendDist === "../ui" &&
    config.app.withGlobalTauri === false &&
    config.app.windows.length === 1 &&
    config.app.windows[0].url === "index.html" &&
    config.app.security.csp.includes("connect-src 'none'") &&
    config.app.security.csp.includes("object-src 'none'") &&
    isDeepStrictEqual(config.bundle.targets, ["nsis"]),
  "local-only configuration fixture is incomplete",
);

for (const testCase of fixtures.managedRootCases) {
  const actual = inspectManagedRoot(testCase.candidate, testCase.systemDrive);
  for (const [key, expectedValue] of Object.entries(testCase.expected)) {
    check(
      `ST-005-path-${testCase.name}-${key}`,
      actual[key] === expectedValue,
      `comparison path fixture mismatch for ${key}`,
    );
  }
}

for (const testCase of fixtures.suggestionCases) {
  const actual = testCase.supportedDrives.some((drive) => drive.toUpperCase() === "D:")
    ? "D:\\MiniMaxH3"
    : null;
  check(
    `ST-006-suggestion-${testCase.name}`,
    actual === testCase.expected,
    "D-drive suggestion oracle drifted",
  );
}
check(
  "ST-007-path-source-shape",
  pathSource.includes("inspect_windows_managed_root") &&
    pathSource.includes("suggest_managed_root") &&
    pathSource.includes("candidate.starts_with(\"\\\\\\\\\")") &&
    pathSource.includes("!bytes[0].is_ascii_alphabetic()"),
  "uncompiled Rust path design no longer mirrors the comparison oracle",
);

check(
  "ST-008-rust-command-allowlist",
  (commandsSource.match(/#\[tauri::command\]/gu) ?? []).length === 4 &&
    exactCommands.every((name) => commandsSource.includes(`pub fn ${name}`)) &&
    exactCommands.every((name) => mainSource.includes(`commands::${name}`)) &&
    !mainSource.includes("plugin("),
  "uncompiled Rust source is not limited to the exact command surface",
);

check(
  "ST-009-native-picker-fails-closed",
  /pub fn choose_managed_root\(\)[\s\S]+Err\("BLOCKED:/u.test(commandsSource),
  "missing native picker must fail explicitly",
);

check(
  "ST-010-owned-child-static-boundary",
  childSource.includes("Command::new(&executable)") &&
    childSource.includes(".args(&args)") &&
    childSource.includes(".stdin(Stdio::null())") &&
    childSource.includes("child.kill()") &&
    childSource.includes("child.wait()") &&
    childSource.includes("process_tree_contained: false") &&
    !/["'](?:cmd|powershell)\.exe["']/iu.test(childSource) &&
    /pub fn run_owned_child_probe\(label: String\)/u.test(commandsSource),
  "owned child design allows shell/executable input or hides process-tree limitation",
);

check(
  "ST-011-typed-renderer-bridge",
  exactCommands.every((name) => bridgeSource.includes(`\"${name}\"`)) &&
    !bridgeSource.includes("export interface NarrowInvoker") &&
    bridgeSource.includes("Object.freeze") &&
    bridgeSource.includes("processTreeContained: false"),
  "renderer bridge is generic, mutable, or overclaims Job Object containment",
);

check(
  "ST-012-accessibility-static-foundation",
  html.includes('<html lang="zh-CN">') &&
    html.includes("<main>") &&
    html.includes("aria-live=\"polite\"") &&
    html.includes("<button type=\"button\"") &&
    css.includes("button:focus-visible") &&
    css.includes("prefers-reduced-motion") &&
    css.includes("min-height: 44px"),
  "semantic/focus/reduced-motion static foundation is incomplete",
);

const buttonLabels = [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/giu)].map((match) =>
  match[1].replace(/<[^>]+>/gu, "").trim(),
);
check(
  "ST-013-no-tool-side-run-surface",
  buttonLabels.length === 1 &&
    buttonLabels.every((label) => !/(?:Run|运行|生成|排队|提交)/iu.test(label)) &&
    html.includes("用户明确点击 Run 后生成"),
  "UI adds a tool-side execution surface or loses the handoff boundary",
);

check(
  "ST-014-dependency-honesty",
  dependencyPlan.status === "blocked-exact-resolution-unavailable" &&
    dependencyPlan.plannedRoles.every(
      (entry) =>
        entry.exactPackage === null && entry.exactVersion === null && entry.resolutionStatus === "blocked",
    ) &&
    capturedProbe.rust.rustc.present === false &&
    capturedProbe.rust.cargo.present === false &&
    capturedProbe.javascript.tauriCli.present === false,
  "the design invents a dependency resolution despite missing toolchains",
);

const noSelfUpdateOutput = runSanitized(process.execPath, [
  resolve(repositoryRoot, "prototypes/phase0/no-self-update/lint-no-self-update.mjs"),
  prototypeRoot,
]);
check(
  "ST-015-alpha-no-self-update",
  noSelfUpdateOutput.startsWith("PASS alpha-no-self-update"),
  "accepted Alpha no-self-update policy rejected this prototype",
);

const publicLintOutput = runSanitized(process.execPath, [
  resolve(prototypeRoot, "scripts/lint-public-evidence.mjs"),
]);
const publicLintResult = JSON.parse(publicLintOutput.split(/\r?\n/u).filter(Boolean).at(-1));
check(
  "ST-016-public-evidence-hygiene",
  publicLintResult.status === "pass" && publicLintResult.filesScanned > 0,
  "public evidence contains a private host path or ignore policy regressed",
);

const blocked = [
  "Rust/Cargo/Tauri compile, typecheck, unit test, build and dev runtime",
  "MSVC linker and Windows SDK native build",
  "actual Tauri command dispatch, WebView isolation and zero-egress runtime",
  "native folder picker behavior and focus restoration",
  "owned-child identity handshake, cancellation and termination behavior",
  "Windows Job Object and descendant process-tree cleanup",
  "NSIS per-user package build/install/upgrade/uninstall",
  "Authenticode signing and timestamp verification",
  "installer/unpacked size, cold/warm startup and idle memory",
  "Narrator, keyboard, high-contrast and 200-percent scaling",
  "Cargo lock/tree, SBOM, license, advisory and native provenance evidence",
];
for (const item of blocked) process.stdout.write(`BLOCKED ${item}\n`);
process.stdout.write(
  `${JSON.stringify({ event: "stack-tauri-static-verify", status: "pass", passed: passes.length, blocked: blocked.length })}\n`,
);
