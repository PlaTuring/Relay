import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";
import { resolveSelectedArtifacts } from "../../../packages/local-runtime/src/catalog.mjs";
import { chooseManagedRoot } from "../../../packages/local-runtime/src/discovery.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");

async function loadTypeScriptModule(context, relativePath) {
  const buildRoot = await mkdtemp(path.join(os.tmpdir(), "relay-alpha37-install-"));
  context.after(() => rm(buildRoot, { recursive: true, force: true }));
  const outfile = path.join(buildRoot, `${path.basename(relativePath, ".ts")}.mjs`);
  await build({
    entryPoints: [path.join(projectRoot, relativePath)],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "silent"
  });
  return import(`${new URL(`file:///${outfile.replaceAll("\\", "/")}`).href}?fixture=${Date.now()}`);
}

function component(id, required = false, selected = false) {
  return Object.freeze({
    id,
    title: id,
    description: id,
    required,
    selected,
    state: "needs_download",
    sizeGiB: 1
  });
}

test("required installation components are selected and sorted before every optional component", async (context) => {
  const policy = await loadTypeScriptModule(
    context,
    path.join("src", "main", "services", "installation-component-policy.ts")
  );
  const normalized = policy.normalizeInstallationComponents([
    component("ffmpeg_long_video_optional", true, true),
    component("ref2va_optional"),
    component("comfyui_desktop_optional"),
    component("turbo_acceleration_recommended"),
    component("pyav_required", false, false),
    component("fl2va_base", false, false)
  ]);

  assert.deepEqual(normalized.map(({ id }) => id), [
    "fl2va_base",
    "pyav_required",
    "comfyui_desktop_optional",
    "turbo_acceleration_recommended",
    "ref2va_optional",
    "ffmpeg_long_video_optional"
  ]);
  assert.deepEqual(normalized.map(({ required }) => required), [true, true, true, false, false, false]);
  assert.deepEqual(normalized.slice(0, 3).map(({ selected }) => selected), [true, true, true]);
  assert.equal(Object.isFrozen(normalized), true);
});

test("Desktop cannot be omitted or smuggled through the optional selection channel", async (context) => {
  const [policy, validation] = await Promise.all([
    loadTypeScriptModule(
      context,
      path.join("src", "main", "services", "installation-component-policy.ts")
    ),
    loadTypeScriptModule(
      context,
      path.join("src", "main", "services", "validation.ts")
    )
  ]);

  assert.deepEqual(policy.selectedPublicInstallationComponents([]), [
    "fl2va_base",
    "pyav_required",
    "comfyui_desktop_optional"
  ]);
  assert.deepEqual(policy.selectedPublicInstallationComponents([
    "ffmpeg_long_video_optional",
    "turbo_acceleration_recommended"
  ]), [
    "fl2va_base",
    "pyav_required",
    "comfyui_desktop_optional",
    "turbo_acceleration_recommended",
    "ffmpeg_long_video_optional"
  ]);
  assert.throws(
    () => validation.validatePrepareRequest({
      installRoot: "D:\\MiniMaxH3",
      selectedOptionalComponents: ["comfyui_desktop_optional"]
    }),
    /可选组件列表包含不允许的组件/u
  );
});

test("missing ComfyUI provisions required Desktop while a verified external root remains attach-only", async (context) => {
  const policy = await loadTypeScriptModule(
    context,
    path.join("src", "main", "services", "installation-component-policy.ts")
  );

  assert.deepEqual(policy.resolveA3InstallationComponents({
    hasAttachedComfyUi: false,
    selectedOptionalComponents: []
  }), ["comfy-portable", "comfy-desktop", "fl2va-base"]);
  const requiredArtifacts = resolveSelectedArtifacts([
    "comfy-portable",
    "comfy-desktop",
    "fl2va-base"
  ]);
  assert.equal(requiredArtifacts.some(({ component }) => component === "comfy-portable"), true);
  assert.equal(requiredArtifacts.some(({ component }) => component === "comfy-desktop"), true);
  assert.equal(requiredArtifacts.some(({ component }) => component === "fl2va-base"), true);
  assert.deepEqual(policy.resolveA3InstallationComponents({
    hasAttachedComfyUi: true,
    selectedOptionalComponents: []
  }), ["fl2va-base"]);
  assert.deepEqual(policy.resolveA3InstallationComponents({
    hasAttachedComfyUi: false,
    selectedOptionalComponents: [
      "ffmpeg_long_video_optional",
      "ref2va_optional",
      "turbo_acceleration_recommended"
    ]
  }), [
    "comfy-portable",
    "comfy-desktop",
    "fl2va-base",
    "fl2v-turbo",
    "ref2va-addon",
    "ffmpeg-managed"
  ]);
});

test("mock scan and prepare expose the same required Desktop invariant", async (context) => {
  const mock = await loadTypeScriptModule(
    context,
    path.join("src", "main", "services", "mock.ts")
  );
  const scan = mock.createMockScan({
    installRoot: "D:\\MiniMaxH3",
    comfyUiRoot: null,
    modelRoot: null
  });
  const desktop = scan.components.find(({ id }) => id === "comfyui_desktop_optional");
  assert.deepEqual(
    scan.components.filter(({ required }) => required).map(({ id }) => id),
    ["fl2va_base", "pyav_required", "comfyui_desktop_optional"]
  );
  assert.equal(desktop?.required, true);
  assert.equal(desktop?.selected, true);
  assert.equal(desktop?.state, "needs_download");

  const plan = mock.createMockPrepare({
    installRoot: "D:\\MiniMaxH3",
    selectedOptionalComponents: []
  });
  assert.deepEqual(plan.selectedComponents, [
    "fl2va_base",
    "pyav_required",
    "comfyui_desktop_optional"
  ]);
});

test("first-run root defaults only to a supported local NTFS D volume and never silently falls back to C", async () => {
  const fixedVolume = (drive, filesystem = "ntfs") => Object.freeze({
    drive_letter: drive,
    drive_type: "fixed_local",
    filesystem
  });
  const supported = chooseManagedRoot({ volumes: [fixedVolume("D:")] });
  assert.equal(supported.status, "eligible_for_explicit_prepare");
  assert.equal(supported.source, "default_visible_d");
  assert.equal(supported.private_path, "D:\\MiniMaxH3");
  assert.equal(supported.silent_c_fallback, false);

  const cOnly = chooseManagedRoot({ volumes: [fixedVolume("C:")] });
  assert.equal(cOnly.status, "blocked");
  assert.equal(cOnly.private_path, null);
  assert.equal(cOnly.silent_c_fallback, false);

  const unsupportedD = chooseManagedRoot({ volumes: [fixedVolume("D:", "exfat")] });
  assert.equal(unsupportedD.status, "blocked");
  assert.equal(unsupportedD.private_path, null);

  const serviceSource = await readFile(
    path.join(projectRoot, "src", "main", "services", "index.ts"),
    "utf8"
  );
  const rendererSource = await readFile(
    path.join(projectRoot, "src", "renderer", "index.ts"),
    "utf8"
  );
  assert.match(serviceSource, /recommendedInstallRoot:\s*"D:\\\\MiniMaxH3"/u);
  assert.match(
    rendererSource,
    /savedSetup\?\.installRoot\s*\?\?\s*bootstrap\.recommendedInstallRoot/u
  );
});
