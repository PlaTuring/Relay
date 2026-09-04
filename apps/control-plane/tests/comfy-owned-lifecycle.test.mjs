import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const projectRoot = path.resolve(import.meta.dirname, "..");

async function loadAdapter(context) {
  const buildRoot = await mkdtemp(path.join(os.tmpdir(), "relay-owned-comfy-lifecycle-build-"));
  context.after(() => rm(buildRoot, { recursive: true, force: true }));
  const outfile = path.join(buildRoot, "ab-cli-adapter.mjs");
  await build({
    entryPoints: [path.join(projectRoot, "src", "main", "services", "ab-cli-adapter.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "silent",
    plugins: [
      {
        name: "relay-lifecycle-child-process-stub",
        setup(buildApi) {
          buildApi.onResolve({ filter: /^node:child_process$/ }, () => ({
            path: "child-process",
            namespace: "relay-child-process-stub"
          }));
          buildApi.onLoad({ filter: /.*/, namespace: "relay-child-process-stub" }, () => ({
            contents: `
              import { createRequire } from "node:module";
              const realSpawn = createRequire(import.meta.url)("node:child_process").spawn;
              export const spawn = (...args) => {
                const fake = globalThis.__relayLifecycleSpawn?.(...args);
                return fake === undefined ? realSpawn(...args) : fake;
              };
            `,
            loader: "js"
          }));
          buildApi.onResolve({ filter: /^electron$/ }, () => ({
            path: "electron",
            namespace: "relay-electron-stub"
          }));
          buildApi.onLoad({ filter: /.*/, namespace: "relay-electron-stub" }, () => ({
            contents: "export const utilityProcess = Object.freeze({});",
            loader: "js"
          }));
        }
      }
    ]
  });
  return import(`${new URL(`file:///${outfile.replaceAll("\\", "/")}`).href}?fixture=${Date.now()}`);
}

async function createManagedFixture(context) {
  const installRoot = await mkdtemp(path.join(os.tmpdir(), "relay-owned-comfy-root-"));
  context.after(() => rm(installRoot, { recursive: true, force: true }));
  const portableRoot = path.join(installRoot, "runtime", "ComfyUI_windows_portable");
  const pythonRoot = path.join(portableRoot, "python_embeded");
  const comfyRoot = path.join(portableRoot, "ComfyUI");
  const configRoot = path.join(installRoot, ".minimax-h3");
  await Promise.all([
    mkdir(pythonRoot, { recursive: true }),
    mkdir(comfyRoot, { recursive: true }),
    mkdir(configRoot, { recursive: true })
  ]);
  const executable = path.join(pythonRoot, "python.exe");
  const main = path.join(comfyRoot, "main.py");
  const config = path.join(configRoot, "extra_model_paths.yaml");
  await Promise.all([
    writeFile(executable, "fixture-python", "utf8"),
    writeFile(main, "# fixture main\n", "utf8"),
    writeFile(config, "# fixture model roots\n", "utf8")
  ]);
  return Object.freeze({ installRoot, portableRoot, executable, comfyRoot, main, config });
}

async function createExternalPortableFixture(context) {
  const portableRoot = await mkdtemp(path.join(os.tmpdir(), "relay-external-comfy-root-"));
  context.after(() => rm(portableRoot, { recursive: true, force: true }));
  const pythonRoot = path.join(portableRoot, "python_embeded");
  const comfyRoot = path.join(portableRoot, "ComfyUI");
  await Promise.all([
    mkdir(pythonRoot, { recursive: true }),
    mkdir(comfyRoot, { recursive: true })
  ]);
  const executable = path.join(pythonRoot, "python.exe");
  const main = path.join(comfyRoot, "main.py");
  await Promise.all([
    writeFile(executable, "fixture-python", "utf8"),
    writeFile(main, "# external fixture main\n", "utf8")
  ]);
  return Object.freeze({ portableRoot, executable, comfyRoot, main });
}

function completeStatus(fixture, installationId) {
  return {
    schema_version: "1.0.0",
    operation_id: installationId,
    status: "complete",
    managed_root: fixture.installRoot,
    entries: [{
      artifact_id: "comfy-portable-nvidia-0.34.0",
      action: "reuse_managed",
      status: "reused",
      downloaded_bytes: 0
    }],
    launch_plan: {
      status: "ready_after_install",
      hardware_profile: "preferred_24gb_plus",
      experimental: false,
      executable: fixture.executable,
      args: [
        fixture.main,
        "--listen",
        "127.0.0.1",
        "--port",
        "8188",
        "--disable-auto-launch",
        "--disable-api-nodes",
        "--disable-all-custom-nodes",
        "--reserve-vram",
        "2",
        "--extra-model-paths-config",
        fixture.config
      ],
      cwd: fixture.comfyRoot,
      loopback_only: true,
      api_nodes_disabled: true,
      all_custom_nodes_disabled: true,
      started: false,
      prompt_submitted: false,
      queue_submitted: false
    },
    error: null
  };
}

function createFakeChild({ output = null, onKill }) {
  const listeners = new Map();
  const once = (event, listener) => {
    const prior = listeners.get(event) ?? [];
    prior.push(listener);
    listeners.set(event, prior);
    return child;
  };
  const emit = (event, ...args) => {
    const current = listeners.get(event) ?? [];
    listeners.delete(event);
    for (const listener of current) listener(...args);
  };
  const stream = () => ({
    on() { return this; },
    end() {}
  });
  const child = {
    stdout: {
      on(event, listener) {
        if (event === "data" && output !== null) {
          once("fixture-output", listener);
        }
        return this;
      }
    },
    stderr: stream(),
    stdin: stream(),
    exitCode: null,
    killed: false,
    once,
    kill() {
      if (this.killed) return false;
      this.killed = true;
      onKill();
      return true;
    }
  };
  queueMicrotask(() => {
    emit("spawn");
    if (output !== null) {
      emit("fixture-output", Buffer.from(`${JSON.stringify(output)}\n`, "utf8"));
      child.exitCode = 0;
      emit("close", 0);
    }
  });
  return child;
}

function createDeferredSpawnChild({ firstKillResult = false, onKill }) {
  const listeners = new Map();
  const once = (event, listener) => {
    const prior = listeners.get(event) ?? [];
    prior.push(listener);
    listeners.set(event, prior);
    return child;
  };
  const emit = (event, ...args) => {
    const current = listeners.get(event) ?? [];
    listeners.delete(event);
    for (const listener of current) listener(...args);
  };
  let killCalls = 0;
  const child = {
    stdout: null,
    stderr: null,
    stdin: null,
    exitCode: null,
    killed: false,
    once,
    kill() {
      killCalls += 1;
      onKill(killCalls);
      if (killCalls === 1 && !firstKillResult) return false;
      this.killed = true;
      return true;
    },
    emitSpawn() {
      emit("spawn");
    }
  };
  return child;
}

const ref2vaPrompt = `subject_definitions: <Subject 1> comes from <Picture 1>.

summary: [reference generation] Keep the referenced subject consistent.

retention_analysis: <Subject 1>: fully_preserved - Preserve identity and clothing.

detailed_description: A live-action cinematic scene. [Shot 1] The referenced subject walks through rain.

overall_soundscape: Rain remains audible.

non_diegetic_music: N/A`;

function project(overrides = {}) {
  return {
    prompt: "A small paper boat drifts across a quiet pond.",
    mode: "T2V",
    firstFrameSelectionId: null,
    lastFrameSelectionId: null,
    durationSeconds: 5,
    segmentDurationSeconds: 5,
    canvas: "16:9",
    resolutionMegapixels: 0.4,
    advanced: {
      seed: 1,
      seedPolicy: "fixed",
      samplingProfile: "quality_20"
    },
    ...overrides
  };
}

test("restores a pinned completed launch plan and disposes only the exact Relay-owned child", async (context) => {
  const fixture = await createManagedFixture(context);
  const installationId = "install_lifecycle_fixture_001";
  const status = completeStatus(fixture, installationId);
  const calls = [];
  let ownedKillCount = 0;
  let unrelatedKillCount = 0;
  globalThis.__relayLifecycleSpawn = (command, args, options) => {
    calls.push({ command, args: [...args], options });
    if (args.includes("install-status")) {
      return createFakeChild({ output: status, onKill() {} });
    }
    return createFakeChild({ output: null, onKill() { ownedKillCount += 1; } });
  };
  context.after(() => {
    delete globalThis.__relayLifecycleSpawn;
  });

  const { createAbCliAdapter, disposeAbCliAdapters } = await loadAdapter(context);
  const adapter = createAbCliAdapter({
    appPath: projectRoot,
    resourcesPath: projectRoot,
    isPackaged: false,
    enabled: true
  });

  assert.equal(await adapter.launchManagedComfy(), false, "no in-memory plan exists before restore");
  assert.equal(await adapter.restoreCompletedInstallation({
    installRoot: fixture.installRoot,
    installationId,
    comfyUiRoot: fixture.portableRoot,
    completedComponents: ["fl2va_base", "pyav_required"]
  }), true);
  assert.equal(await adapter.launchManagedComfy(), true);
  assert.equal(await adapter.launchManagedComfy(), true, "the retained owned child is reused");

  const statusCalls = calls.filter((call) => call.args.includes("install-status"));
  const launchCalls = calls.filter((call) => !call.args.includes("install-status"));
  assert.equal(statusCalls.length, 1);
  assert.equal(launchCalls.length, 1);
  assert.equal(launchCalls[0].command, fixture.executable);
  assert.deepEqual(launchCalls[0].args, status.launch_plan.args);
  assert.equal(launchCalls[0].options.shell, false);
  assert.equal(launchCalls[0].args.includes("--disable-all-custom-nodes"), true);
  assert.equal(launchCalls[0].args.includes("--disable-api-nodes"), true);
  assert.deepEqual(launchCalls[0].args.slice(1, 4), ["--listen", "127.0.0.1", "--port"]);

  const unrelatedExternalComfy = {
    kill() { unrelatedKillCount += 1; }
  };
  assert.ok(unrelatedExternalComfy);
  disposeAbCliAdapters();
  disposeAbCliAdapters();
  adapter.dispose();
  assert.equal(ownedKillCount, 1, "owned child is killed exactly once");
  assert.equal(unrelatedKillCount, 0, "unrelated external ComfyUI is never inspected or killed");
  assert.equal(await adapter.launchManagedComfy(), false, "disposed adapters cannot spawn again");
});

test("fails closed when the recovered transaction changes the fixed custom-node boundary", async (context) => {
  const fixture = await createManagedFixture(context);
  const installationId = "install_lifecycle_fixture_002";
  const status = completeStatus(fixture, installationId);
  status.launch_plan.args = status.launch_plan.args.filter((value) => value !== "--disable-all-custom-nodes");
  let ownedLaunchCount = 0;
  globalThis.__relayLifecycleSpawn = (_command, args) => {
    if (args.includes("install-status")) {
      return createFakeChild({ output: status, onKill() {} });
    }
    ownedLaunchCount += 1;
    return createFakeChild({ output: null, onKill() {} });
  };
  context.after(() => {
    delete globalThis.__relayLifecycleSpawn;
  });

  const { createAbCliAdapter } = await loadAdapter(context);
  const adapter = createAbCliAdapter({
    appPath: projectRoot,
    resourcesPath: projectRoot,
    isPackaged: false,
    enabled: true
  });
  await assert.rejects(
    adapter.restoreCompletedInstallation({
      installRoot: fixture.installRoot,
      installationId,
      comfyUiRoot: fixture.portableRoot,
      completedComponents: ["fl2va_base", "pyav_required"]
    }),
    /固定 loopback ComfyUI 启动参数/u
  );
  assert.equal(await adapter.launchManagedComfy(), false);
  assert.equal(ownedLaunchCount, 0);
  adapter.dispose();
});

test("Electron shutdown hook delegates to the adapter-owned disposer registry", async () => {
  const mainSource = await readFile(path.join(projectRoot, "src", "main", "main.ts"), "utf8");
  assert.match(mainSource, /app\.once\("before-quit", disposeAbCliAdapters\)/u);
  assert.doesNotMatch(mainSource, /taskkill|Get-Process|Stop-Process/iu);
});

test("saved setup restoration is gated by current verified roots and a completed transaction", async () => {
  const serviceSource = await readFile(path.join(projectRoot, "src", "main", "services", "index.ts"), "utf8");
  const gateStart = serviceSource.indexOf("if (\n      restored.setupComplete &&");
  const returnStart = serviceSource.indexOf("return Object.freeze({", gateStart);
  assert.ok(gateStart >= 0 && returnStart > gateStart, "restore gate remains inside restoreSavedSetup");
  const gate = serviceSource.slice(gateStart, returnStart);
  assert.match(gate, /restored\.completedInstallationId !== null/u);
  assert.match(gate, /restoredComfy !== null/u);
  assert.match(gate, /restored\.modelRoot !== null/u);
  assert.match(gate, /adapter\.restoreCompletedInstallation\(\{/u);
  assert.match(gate, /installRoot: restored\.installRoot/u);
  assert.match(gate, /installationId: restored\.completedInstallationId/u);
  assert.match(gate, /comfyUiRoot: restoredComfy\.root/u);
  assert.match(gate, /completedComponents: inspection\.completedComponents/u);
  assert.match(gate, /catch \{/u, "restore failure is contained and cannot synthesize readiness");
});

test("restored current capability evidence unlocks Ref2VA and Turbo compilation gates", async (context) => {
  const fixture = await createManagedFixture(context);
  const installationId = "install_lifecycle_capability_001";
  const status = completeStatus(fixture, installationId);
  globalThis.__relayLifecycleSpawn = (_command, args) => {
    if (args.includes("install-status")) {
      return createFakeChild({ output: status, onKill() {} });
    }
    return undefined;
  };
  context.after(() => {
    delete globalThis.__relayLifecycleSpawn;
  });

  const referencePath = path.join(fixture.installRoot, "reference.png");
  await writeFile(referencePath, "fixture-reference", "utf8");
  const { createAbCliAdapter } = await loadAdapter(context);
  const adapter = createAbCliAdapter({
    appPath: projectRoot,
    resourcesPath: projectRoot,
    isPackaged: false,
    enabled: true
  });
  assert.equal(await adapter.restoreCompletedInstallation({
    installRoot: fixture.installRoot,
    installationId,
    comfyUiRoot: fixture.portableRoot,
    completedComponents: [
      "fl2va_base",
      "pyav_required",
      "ref2va_optional",
      "turbo_acceleration_recommended"
    ]
  }), true);

  const ref2vaWorkflow = await adapter.compileWorkflow({
    project: project({
      prompt: ref2vaPrompt,
      mode: "REF2VA",
      firstFrameSelectionId: "fixture-reference",
      advanced: {
        seed: 1,
        seedPolicy: "fixed",
        samplingProfile: "quality_20"
      }
    }),
    resolvedFrames: { first: referencePath, last: null }
  });
  assert.ok(Array.isArray(ref2vaWorkflow?.nodes), "restored Ref2VA evidence reaches the real compiler");

  const turboWorkflow = await adapter.compileWorkflow({
    project: project({
      advanced: {
        seed: 1,
        seedPolicy: "fixed",
        samplingProfile: "turbo_8"
      }
    }),
    resolvedFrames: { first: null, last: null }
  });
  assert.ok(Array.isArray(turboWorkflow?.nodes), "restored Turbo evidence reaches the real compiler");
  adapter.dispose();
});

test("restores an external attach-only Comfy root from the currently verified location", async (context) => {
  const fixture = await createManagedFixture(context);
  const external = await createExternalPortableFixture(context);
  const installationId = "install_lifecycle_external_001";
  const status = completeStatus(fixture, installationId);
  const calls = [];
  globalThis.__relayLifecycleSpawn = (command, args, options) => {
    calls.push({ command, args: [...args], options });
    if (args.includes("install-status")) {
      return createFakeChild({ output: status, onKill() {} });
    }
    return createFakeChild({ output: null, onKill() {} });
  };
  context.after(() => {
    delete globalThis.__relayLifecycleSpawn;
  });

  const { createAbCliAdapter } = await loadAdapter(context);
  const adapter = createAbCliAdapter({
    appPath: projectRoot,
    resourcesPath: projectRoot,
    isPackaged: false,
    enabled: true
  });
  assert.equal(await adapter.restoreCompletedInstallation({
    installRoot: fixture.installRoot,
    installationId,
    comfyUiRoot: external.portableRoot,
    completedComponents: ["fl2va_base", "pyav_required"]
  }), true);
  assert.equal(await adapter.launchManagedComfy(), true);

  const launch = calls.find((call) => !call.args.includes("install-status"));
  assert.ok(launch);
  assert.equal(launch.command, external.executable);
  assert.equal(launch.options.cwd, external.comfyRoot);
  assert.equal(launch.args[0], external.main);
  assert.equal(launch.args.includes("--disable-all-custom-nodes"), true);
  assert.equal(launch.args.includes("--disable-api-nodes"), true);
  assert.equal(launch.args.includes(fixture.executable), false, "stale managed launch paths are ignored");
  adapter.dispose();
});

test("restore fails closed for unverified capability sets and incomplete external roots", async (context) => {
  const fixture = await createManagedFixture(context);
  const external = await createExternalPortableFixture(context);
  const installationId = "install_lifecycle_negative_001";
  const status = completeStatus(fixture, installationId);
  let launchCount = 0;
  globalThis.__relayLifecycleSpawn = (_command, args) => {
    if (args.includes("install-status")) {
      return createFakeChild({ output: status, onKill() {} });
    }
    launchCount += 1;
    return createFakeChild({ output: null, onKill() {} });
  };
  context.after(() => {
    delete globalThis.__relayLifecycleSpawn;
  });

  const { createAbCliAdapter } = await loadAdapter(context);
  const adapter = createAbCliAdapter({
    appPath: projectRoot,
    resourcesPath: projectRoot,
    isPackaged: false,
    enabled: true
  });
  await assert.rejects(
    adapter.restoreCompletedInstallation({
      installRoot: fixture.installRoot,
      installationId,
      comfyUiRoot: fixture.portableRoot,
      completedComponents: ["fl2va_base", "fl2va_base", "pyav_required"]
    }),
    /能力集合无效/u
  );
  await assert.rejects(
    adapter.restoreCompletedInstallation({
      installRoot: fixture.installRoot,
      installationId,
      comfyUiRoot: fixture.portableRoot,
      completedComponents: ["fl2va_base", "pyav_required", "unknown_component"]
    }),
    /能力集合无效/u
  );
  await assert.rejects(
    adapter.restoreCompletedInstallation({
      installRoot: fixture.installRoot,
      installationId,
      comfyUiRoot: fixture.portableRoot,
      completedComponents: ["fl2va_base"]
    }),
    /能力集合无效/u
  );
  await rm(external.main, { force: true });
  assert.equal(await adapter.restoreCompletedInstallation({
    installRoot: fixture.installRoot,
    installationId,
    comfyUiRoot: external.portableRoot,
    completedComponents: ["fl2va_base", "pyav_required"]
  }), false);
  assert.equal(await adapter.launchManagedComfy(), false);
  assert.equal(launchCount, 0);
  adapter.dispose();
});

test("dispose before spawn retries termination only for the exact owned child", async (context) => {
  const fixture = await createManagedFixture(context);
  const installationId = "install_lifecycle_race_001";
  const status = completeStatus(fixture, installationId);
  let deferredChild;
  let signalSpawnCreated;
  const spawnCreated = new Promise((resolvePromise) => {
    signalSpawnCreated = resolvePromise;
  });
  const killCalls = [];
  let unrelatedKillCount = 0;
  globalThis.__relayLifecycleSpawn = (_command, args) => {
    if (args.includes("install-status")) {
      return createFakeChild({ output: status, onKill() {} });
    }
    deferredChild = createDeferredSpawnChild({
      firstKillResult: false,
      onKill(call) { killCalls.push(call); }
    });
    signalSpawnCreated();
    return deferredChild;
  };
  context.after(() => {
    delete globalThis.__relayLifecycleSpawn;
  });

  const { createAbCliAdapter } = await loadAdapter(context);
  const adapter = createAbCliAdapter({
    appPath: projectRoot,
    resourcesPath: projectRoot,
    isPackaged: false,
    enabled: true
  });
  assert.equal(await adapter.restoreCompletedInstallation({
    installRoot: fixture.installRoot,
    installationId,
    comfyUiRoot: fixture.portableRoot,
    completedComponents: ["fl2va_base", "pyav_required"]
  }), true);

  const launch = adapter.launchManagedComfy();
  await spawnCreated;
  const unrelatedExternalComfy = { kill() { unrelatedKillCount += 1; } };
  assert.ok(unrelatedExternalComfy);
  adapter.dispose();
  assert.deepEqual(killCalls, [1], "dispose makes the first exact-child kill attempt");
  deferredChild.emitSpawn();
  assert.equal(await launch, false);
  assert.deepEqual(killCalls, [1, 2], "spawn event retries the same child after a false first kill");
  assert.equal(deferredChild.killed, true);
  assert.equal(unrelatedKillCount, 0);
});
