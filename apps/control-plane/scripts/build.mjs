import { copyFile, cp, lstat, mkdir, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { build } from "esbuild";

import { offlineEnvironment, projectRoot } from "./lib.mjs";

const dist = resolve(projectRoot, "dist");
if (dist !== resolve(projectRoot, "dist")) {
  throw new Error("BUILD.INVALID_DIST_TARGET");
}
await rm(dist, { recursive: true, force: true });
await mkdir(resolve(dist, "renderer"), { recursive: true });

const typescriptCli = resolve(projectRoot, "node_modules", "typescript", "bin", "tsc");
const compile = spawnSync(process.execPath, [typescriptCli, "-p", "tsconfig.main.json"], {
  cwd: projectRoot,
  encoding: "utf8",
  env: offlineEnvironment(),
  maxBuffer: 8 * 1024 * 1024,
  shell: false,
  windowsHide: true
});
if (compile.status !== 0) {
  throw new Error("BUILD.MAIN_COMPILE_FAILED");
}

const nativeBuild = spawnSync(
  process.execPath,
  [resolve(projectRoot, "scripts", "build-native-helper.mjs")],
  {
    cwd: projectRoot,
    encoding: "utf8",
    env: offlineEnvironment(),
    maxBuffer: 8 * 1024 * 1024,
    shell: false,
    windowsHide: true
  }
);
if (nativeBuild.status !== 0) {
  const error = new Error("BUILD.NATIVE_HELPER_FAILED");
  error.cause = {
    status: nativeBuild.status,
    stdout: nativeBuild.stdout?.slice(0, 4_096),
    stderr: nativeBuild.stderr?.slice(0, 4_096)
  };
  throw error;
}

await build({
  entryPoints: [resolve(projectRoot, "src", "preload", "index.ts")],
  outfile: resolve(dist, "preload", "index.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  legalComments: "none",
  sourcemap: false,
  metafile: false,
  write: true
});

await build({
  entryPoints: [resolve(projectRoot, "src", "preload", "startup-recovery.ts")],
  outfile: resolve(dist, "preload", "startup-recovery.cjs"),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  legalComments: "none",
  sourcemap: false,
  metafile: false,
  write: true
});

await build({
  entryPoints: [resolve(projectRoot, "src", "renderer", "index.ts")],
  outfile: resolve(dist, "renderer", "renderer.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "chrome142",
  legalComments: "none",
  sourcemap: false,
  metafile: false,
  write: true
});

await build({
  entryPoints: [resolve(projectRoot, "src", "renderer", "startup-recovery.ts")],
  outfile: resolve(dist, "renderer", "startup-recovery.js"),
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "chrome142",
  legalComments: "none",
  sourcemap: false,
  metafile: false,
  write: true
});

await cp(
  resolve(projectRoot, "src", "renderer", "index.html"),
  resolve(dist, "renderer", "index.html")
);
await cp(
  resolve(projectRoot, "src", "renderer", "styles.css"),
  resolve(dist, "renderer", "styles.css")
);
await cp(
  resolve(projectRoot, "src", "renderer", "startup-recovery.html"),
  resolve(dist, "renderer", "startup-recovery.html")
);
await cp(
  resolve(projectRoot, "src", "renderer", "startup-recovery.css"),
  resolve(dist, "renderer", "startup-recovery.css")
);
const rendererAssetSource = resolve(projectRoot, "src", "renderer", "assets");
const rendererAssetDestination = resolve(dist, "renderer", "assets");
const packagedRendererAssets = new Set([
  "relay-icon.ico",
  "relay-icon.png",
  "relay-installer-header.bmp",
  "relay-installer-sidebar.bmp",
  "relay-logo.svg",
  "platuring-avatar.png"
]);
await mkdir(rendererAssetDestination, { recursive: false });
for (const entry of await readdir(rendererAssetSource, { withFileTypes: true })) {
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw new Error(`BUILD.RENDERER_ASSET_UNSUPPORTED:${entry.name}`);
  }
  if (!packagedRendererAssets.has(entry.name)) {
    throw new Error(`BUILD.RENDERER_ASSET_NOT_ALLOWLISTED:${entry.name}`);
  }
  const source = resolve(rendererAssetSource, entry.name);
  const metadata = await lstat(source);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`BUILD.RENDERER_ASSET_UNSUPPORTED:${entry.name}`);
  }
  await copyFile(source, resolve(rendererAssetDestination, entry.name));
}
for (const requiredName of packagedRendererAssets) {
  const metadata = await lstat(resolve(rendererAssetDestination, requiredName));
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`BUILD.RENDERER_ASSET_MISSING:${requiredName}`);
  }
}
await cp(
  resolve(projectRoot, "src", "main", "services", "electron-utility-wrapper.cjs"),
  resolve(dist, "main", "services", "electron-utility-wrapper.cjs")
);
await cp(
  resolve(projectRoot, "src", "main", "services", "electron-workflow-compiler-wrapper.cjs"),
  resolve(dist, "main", "services", "electron-workflow-compiler-wrapper.cjs")
);

process.stdout.write("BUILD passed=1 failed=0\n");
