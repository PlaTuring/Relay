import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { nativeEvidenceRoot, projectRoot } from "./lib.mjs";

const evidenceRoot = nativeEvidenceRoot;
const proposedRoot = resolve(evidenceRoot, "proposed");
await mkdir(proposedRoot, { recursive: true });

const mainRelative = "apps/control-plane/src/main/main.ts";
const packageRelative = "apps/control-plane/package.json";
const clientRelative = "apps/control-plane/src/main/services/native-helper-client.ts";
const mainPath = resolve(projectRoot, "src", "main", "main.ts");
const packagePath = resolve(projectRoot, "package.json");
const clientCandidatePath = resolve(proposedRoot, "native-helper-client.ts");
const mainCandidatePath = resolve(proposedRoot, "main.ts");
const packageCandidatePath = resolve(proposedRoot, "package.json");

let main = await readFile(mainPath, "utf8");
main = main.replace(
  'import { app, BrowserWindow, nativeTheme, screen, session } from "electron";',
  'import { app, BrowserWindow, dialog, nativeTheme, screen, session } from "electron";'
);
main = main.replace(
  'import type { UiTheme } from "../shared/ipc-contract.js";',
  'import type { UiTheme } from "../shared/ipc-contract.js";\nimport { verifyNativeHelperAtStartup } from "./services/native-helper-client.js";'
);
main = main.replace(
  '  const userDataPath = app.getPath("userData");\n',
  '  const userDataPath = app.getPath("userData");\n  const nativeHelperEvidence = verifyNativeHelperAtStartup({\n    userDataPath,\n    resourcesPath: process.resourcesPath,\n    isPackaged: app.isPackaged\n  });\n'
);
main = main.replace(
  '  if (packagedProbeMode) {\n    const bootstrap = await services.getBootstrap();',
  '  if (packagedProbeMode) {\n    process.stdout.write(\n      `PACKAGED_NATIVE_HELPER_READY profile=${nativeHelperEvidence.profileId} enabled=${nativeHelperEvidence.enabledOpcodes.length}\\n`\n    );\n    const bootstrap = await services.getBootstrap();'
);
main = main.replace(
  '});\n\napp.on("window-all-closed", finishApplicationExitWhenWindowsClosed);',
  '}).catch((error: unknown) => {\n  const code = error instanceof Error && error.message.startsWith("NATIVE_HELPER.")\n    ? error.message\n    : "NATIVE_HELPER.STARTUP_FAILED";\n  if (headlessMode) process.stderr.write(`${code}\\n`);\n  else dialog.showErrorBox("Relay 无法启动", "本机组件自检失败，请重新安装 Relay 后重试。");\n  app.exit(2);\n});\n\napp.on("window-all-closed", finishApplicationExitWhenWindowsClosed);'
);
if (!main.includes("PACKAGED_NATIVE_HELPER_READY") || !main.includes("verifyNativeHelperAtStartup")) {
  throw new Error("NATIVE_PATCH.MAIN_TRANSFORM_FAILED");
}
await writeFile(mainCandidatePath, main, "utf8");

let packageJson = await readFile(packagePath, "utf8");
packageJson = packageJson.replace(
  '    "asar": true,\n',
  '    "asar": true,\n    "asarUnpack": [\n      "dist/main/native/*"\n    ],\n'
);
if (!packageJson.includes('"asarUnpack"')) throw new Error("NATIVE_PATCH.PACKAGE_TRANSFORM_FAILED");
await writeFile(packageCandidatePath, packageJson, "utf8");

function diffExisting(original, candidate, candidateRelative) {
  const repositoryRoot = resolve(projectRoot, "..", "..");
  const originalFromRepository = original.replaceAll("\\", "/")
    .replace(`${repositoryRoot.replaceAll("\\", "/")}/`, "");
  const candidateFromRepository = candidate.replaceAll("\\", "/")
    .replace(`${repositoryRoot.replaceAll("\\", "/")}/`, "");
  const result = spawnSync("git", ["diff", "--no-index", "--", originalFromRepository, candidateFromRepository], {
    cwd: repositoryRoot,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024
  });
  if (result.status !== 1 || result.stdout.length === 0) throw new Error("NATIVE_PATCH.DIFF_FAILED");
  return result.stdout.replaceAll(candidateFromRepository, candidateRelative);
}

function diffNew(candidateText) {
  const normalized = candidateText.replaceAll("\r\n", "\n");
  const lines = normalized.endsWith("\n") ? normalized.slice(0, -1).split("\n") : normalized.split("\n");
  return [
    `diff --git a/${clientRelative} b/${clientRelative}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${clientRelative}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
    ""
  ].join("\n");
}

const clientText = await readFile(clientCandidatePath, "utf8");
const patch = [
  diffNew(clientText),
  diffExisting(mainPath, mainCandidatePath, mainRelative),
  diffExisting(packagePath, packageCandidatePath, packageRelative)
].join("\n");
await writeFile(resolve(evidenceRoot, "proposed-root-patch.diff"), patch, "utf8");
process.stdout.write("NATIVE_PATCH status=generated files=3\n");
