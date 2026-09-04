import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  truncate,
  utimes,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const projectRoot = path.resolve(import.meta.dirname, "..");

async function loadPreferencesModule(context) {
  const buildRoot = await mkdtemp(path.join(os.tmpdir(), "h3-setup-preferences-module-"));
  context.after(() => rm(buildRoot, { recursive: true, force: true }));
  const outfile = path.join(buildRoot, "setup-preferences.mjs");
  await build({
    entryPoints: [path.join(projectRoot, "src", "main", "services", "setup-preferences.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "silent"
  });
  return import(`${new URL(`file:///${outfile.replaceAll("\\", "/")}`).href}?fixture=${Date.now()}`);
}

function completedState(operationId, managedRoot) {
  return {
    schema_version: "1.0.0",
    operation_id: operationId,
    status: "complete",
    managed_root: managedRoot,
    entries: [
      ["h3-fl2va-int8-convrot", "reuse_external_read_only", "reused"],
      ["h3-qwen3vl-32b-nvfp4-awq", "reuse_external_read_only", "reused"],
      ["h3-video-vae-fp16", "reuse_external_read_only", "reused"],
      ["h3-audio-vae-fp32", "reuse_external_read_only", "reused"],
      ["comfy-desktop-installer-1.0.46-x64", "download", "complete"]
    ].map(([artifact_id, action, status]) => ({
      artifact_id,
      action,
      status,
      downloaded_bytes: action === "download" ? 179_991_984 : 0
    })),
    launch_plan: {},
    error: null
  };
}

function completedRequest(operationId, managedRoot, modelRoot) {
  return {
    managedRoot,
    components: ["fl2va-base", "comfy-desktop"],
    existingModelRoots: [modelRoot],
    hardware: { vramBytes: 17_179_869_184 },
    acknowledgements: {
      licenseAccepted: true,
      territoryAcknowledged: true,
      commercialAcknowledged: true,
      downloadConsent: true
    },
    operationId
  };
}

test("v1 preferences migrate without trusting historical component claims", async (context) => {
  const api = await loadPreferencesModule(context);
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "h3-prefs-v1-"));
  context.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const userData = path.join(fixtureRoot, "user-data");
  const installRoot = path.join(fixtureRoot, "managed");
  const comfyRoot = path.join(fixtureRoot, "ComfyUI_windows_portable");
  const modelRoot = path.join(fixtureRoot, "external-models");
  await Promise.all([
    mkdir(userData, { recursive: true }),
    mkdir(installRoot, { recursive: true }),
    mkdir(modelRoot, { recursive: true }),
    mkdir(path.join(comfyRoot, "python_embeded", "Lib", "site-packages", "av"), { recursive: true })
  ]);
  await Promise.all([
    writeFile(path.join(comfyRoot, "python_embeded", "Lib", "site-packages", "av", "__init__.py"), "# fixture\n"),
    writeFile(path.join(comfyRoot, "python_embeded", "Lib", "site-packages", "av", "_core.pyd"), "fixture")
  ]);
  await writeFile(path.join(userData, "setup-locations.v1.json"), `${JSON.stringify({
    version: 1,
    installRoot,
    comfyUiRoot: comfyRoot,
    modelRoot,
    comfySource: "explicit",
    modelSource: "explicit"
  })}\n`);

  const migrated = await api.loadSetupPreferences(userData);
  assert.equal(migrated.setupComplete, false);
  assert.deepEqual(migrated.completedComponents, []);
  assert.equal(migrated.completedInstallationId, null);

  assert.equal(await api.saveSetupPreferences(userData, migrated), true);
  const persisted = JSON.parse(await readFile(path.join(userData, "setup-locations.v1.json"), "utf8"));
  assert.equal(persisted.version, 2);
  assert.equal(persisted.setupComplete, false);
  assert.deepEqual(persisted.completedComponents, []);
});

test("completed transaction is bounded evidence, while only current verification unlocks components", async (context) => {
  const api = await loadPreferencesModule(context);
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "h3-prefs-transaction-"));
  context.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const installRoot = path.join(fixtureRoot, "managed");
  const comfyRoot = path.join(fixtureRoot, "ComfyUI_windows_portable");
  const modelRoot = path.join(fixtureRoot, "external-models");
  const operationId = "install-aaaaaaaaaaaaaaaaaaaaaaaa";
  const operationRoot = path.join(installRoot, ".minimax-h3", "install", operationId);
  await Promise.all([
    mkdir(operationRoot, { recursive: true }),
    mkdir(modelRoot, { recursive: true }),
    mkdir(path.join(comfyRoot, "python_embeded", "Lib", "site-packages", "av"), { recursive: true })
  ]);
  await Promise.all([
    writeFile(path.join(operationRoot, "state.json"), JSON.stringify(completedState(operationId, installRoot))),
    writeFile(path.join(operationRoot, "request.json"), JSON.stringify(completedRequest(operationId, installRoot, modelRoot))),
    writeFile(path.join(comfyRoot, "python_embeded", "Lib", "site-packages", "av", "__init__.py"), "# fixture\n"),
    writeFile(path.join(comfyRoot, "python_embeded", "Lib", "site-packages", "av", "_core.pyd"), "fixture")
  ]);
  const setup = {
    installRoot,
    comfyUiRoot: comfyRoot,
    modelRoot,
    comfySource: "explicit",
    modelSource: "explicit",
    setupComplete: false,
    completedComponents: [],
    completedInstallationId: null
  };

  const withoutComfy = await api.inspectPersistedComponents(setup, { comfyRootVerified: false });
  assert.deepEqual(withoutComfy.claimedComponents, ["comfyui_desktop_optional", "fl2va_base"]);
  assert.deepEqual(withoutComfy.verifiedComponents, []);
  assert.deepEqual(withoutComfy.completedComponents, []);
  assert.equal(withoutComfy.completedInstallationId, operationId);
  assert.equal(withoutComfy.vramBytes, 17_179_869_184);
  assert.equal(withoutComfy.setupComplete, false);

  const withComfy = await api.inspectPersistedComponents(setup, { comfyRootVerified: true });
  assert.deepEqual(withComfy.verifiedComponents, ["comfyui_desktop_optional", "pyav_required"]);
  assert.deepEqual(withComfy.completedComponents, withComfy.verifiedComponents);
  assert.ok(!withComfy.completedComponents.includes("fl2va_base"));
  assert.equal(withComfy.setupComplete, false);

  const corrupt = completedState(operationId, `${installRoot}-other`);
  await writeFile(path.join(operationRoot, "state.json"), JSON.stringify(corrupt));
  const rejected = await api.inspectPersistedComponents(setup, { comfyRootVerified: false });
  assert.deepEqual(rejected.claimedComponents, []);
  assert.equal(rejected.completedInstallationId, null);
  assert.equal(rejected.vramBytes, null);
});

test("external model quick restore rejects any same-size file modified after the completed transaction", async (context) => {
  const api = await loadPreferencesModule(context);
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "h3-prefs-mtime-"));
  context.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const installRoot = path.join(fixtureRoot, "managed");
  const comfyRoot = path.join(fixtureRoot, "ComfyUI_windows_portable");
  const modelRoot = path.join(fixtureRoot, "external-models");
  const operationId = "install-bbbbbbbbbbbbbbbbbbbbbbbb";
  const operationRoot = path.join(installRoot, ".minimax-h3", "install", operationId);
  const modelFiles = [
    ["diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors", 20_970_379_616],
    ["text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", 15_687_142_551],
    ["vae/minimax_h3_video_vae_fp16.safetensors", 5_207_808_496],
    ["vae/minimax_h3_audio_vae_fp32.safetensors", 605_254_808]
  ];
  await Promise.all([
    mkdir(operationRoot, { recursive: true }),
    mkdir(path.join(comfyRoot, "python_embeded", "Lib", "site-packages", "av"), { recursive: true }),
    ...modelFiles.map(([relative]) => mkdir(path.dirname(path.join(modelRoot, relative)), { recursive: true }))
  ]);
  const oldTime = new Date(Date.now() - 60_000);
  for (const [relative, byteLength] of modelFiles) {
    const target = path.join(modelRoot, relative);
    await writeFile(target, "");
    await truncate(target, byteLength);
    await utimes(target, oldTime, oldTime);
  }
  await Promise.all([
    writeFile(path.join(comfyRoot, "python_embeded", "Lib", "site-packages", "av", "__init__.py"), "# fixture\n"),
    writeFile(path.join(comfyRoot, "python_embeded", "Lib", "site-packages", "av", "_core.pyd"), "fixture"),
    writeFile(path.join(operationRoot, "request.json"), JSON.stringify(completedRequest(operationId, installRoot, modelRoot)))
  ]);
  await writeFile(path.join(operationRoot, "state.json"), JSON.stringify(completedState(operationId, installRoot)));
  const setup = {
    installRoot,
    comfyUiRoot: comfyRoot,
    modelRoot,
    comfySource: "explicit",
    modelSource: "explicit",
    setupComplete: false,
    completedComponents: [],
    completedInstallationId: null
  };

  const restored = await api.inspectPersistedComponents(setup, { comfyRootVerified: true });
  assert.ok(restored.verifiedComponents.includes("fl2va_base"));
  assert.equal(restored.setupComplete, true);

  const changedFile = path.join(modelRoot, modelFiles[0][0]);
  const laterTime = new Date(Date.now() + 60_000);
  await utimes(changedFile, laterTime, laterTime);
  const rejected = await api.inspectPersistedComponents(setup, { comfyRootVerified: true });
  assert.ok(!rejected.verifiedComponents.includes("fl2va_base"));
  assert.ok(rejected.foundComponents.includes("fl2va_base"));
  assert.equal(rejected.setupComplete, false);
});
