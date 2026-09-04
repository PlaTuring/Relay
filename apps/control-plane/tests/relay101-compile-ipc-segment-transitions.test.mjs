import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const projectRoot = path.resolve(import.meta.dirname, "..");

async function loadIpcRegistry(context) {
  const buildRoot = await mkdtemp(path.join(os.tmpdir(), "relay-compile-ipc-transition-"));
  context.after(() => rm(buildRoot, { recursive: true, force: true }));
  const outfile = path.join(buildRoot, "ipc-registry.mjs");
  await build({
    entryPoints: [path.join(projectRoot, "src/main/ipc-registry.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "silent",
    plugins: [{
      name: "electron-ipc-main-stub",
      setup(buildApi) {
        buildApi.onResolve({ filter: /^electron$/ }, () => ({
          path: "electron",
          namespace: "electron-stub",
        }));
        buildApi.onLoad({ filter: /.*/, namespace: "electron-stub" }, () => ({
          contents: `
            export const ipcMain = {
              handle(channel, handler) {
                globalThis.__relayCompileIpcHandlers.set(channel, handler);
              }
            };
          `,
          loader: "js",
        }));
      },
    }],
  });
  return import(`${new URL(`file:///${outfile.replaceAll("\\", "/")}`).href}?${Date.now()}-${Math.random()}`);
}

function compileRequest(project) {
  return {
    workflowName: "Relay IPC transition regression",
    project,
    exportDirectorySelectionId: null,
    projectId: "project-ipctransitions01",
  };
}

function quickProject() {
  return {
    prompt: "integrated_multimodal_description: One quick shot.",
    mode: "T2V",
    firstFrameSelectionId: null,
    lastFrameSelectionId: null,
    durationSeconds: 5,
    segmentDurationSeconds: 5,
    canvas: "16:9",
    resolutionMegapixels: 0.4,
    advanced: {
      seed: 117117,
      seedPolicy: "fixed",
      samplingProfile: "quality_20",
    },
  };
}

function directorProject(shotCount, segmentTransitions) {
  return {
    ...quickProject(),
    prompt: Array.from(
      { length: shotCount },
      (_, index) => `[Shot ${index + 1}] At 00:${String(index * 5).padStart(2, "0")}.000, deterministic shot.`,
    ).join("\n\n"),
    durationSeconds: shotCount * 5,
    segmentDurationsSeconds: Array.from({ length: shotCount }, () => 5),
    segmentShotIds: Array.from(
      { length: shotCount },
      (_, index) => `shot-ipctransition${String(index + 1).padStart(2, "0")}`,
    ),
    segmentTransitions,
  };
}

async function waitForCallCount(calls, expected) {
  for (let attempt = 0; attempt < 20 && calls.length < expected; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(calls.length, expected, "validated IPC requests must reach the compile service exactly once");
}

test("compile IPC accepts and preserves Director transitions while remaining fail-closed", async (context) => {
  globalThis.__relayCompileIpcHandlers = new Map();
  context.after(() => { delete globalThis.__relayCompileIpcHandlers; });

  const module = await loadIpcRegistry(context);
  const compileCalls = [];
  const services = new Proxy({
    async compileAndOpenWorkflow(request) {
      compileCalls.push(request);
      return Object.freeze({});
    },
  }, {
    get(target, property) {
      if (property in target) return target[property];
      return async () => undefined;
    },
  });
  const unusedController = new Proxy({}, { get: () => async () => undefined });
  const rendererUrl = "file:///Relay/index.html";
  module.registerClosedIpcRegistry(
    rendererUrl,
    services,
    unusedController,
    unusedController,
    async () => undefined,
    async () => true,
  );

  const handler = globalThis.__relayCompileIpcHandlers.get("control:compile-and-open-workflow");
  assert.equal(typeof handler, "function");
  const frame = { url: rendererUrl };
  const event = { senderFrame: frame, sender: { mainFrame: frame } };

  const singleShot = directorProject(1, []);
  const singleOperation = await handler(event, compileRequest(singleShot));
  assert.match(singleOperation.operationId, /^[0-9a-f-]{36}$/iu);
  await waitForCallCount(compileCalls, 1);
  assert.deepEqual(compileCalls[0].project.segmentTransitions, []);

  const transitions = ["hard_cut", "tail_frame_continuation"];
  const threeShot = directorProject(3, transitions);
  await handler(event, compileRequest(threeShot));
  await waitForCallCount(compileCalls, 2);
  assert.deepEqual(compileCalls[1].project.segmentTransitions, transitions);

  const quick = quickProject();
  await handler(event, compileRequest(quick));
  await waitForCallCount(compileCalls, 3);
  assert.equal(Object.hasOwn(compileCalls[2].project, "segmentTransitions"), false);

  const rejected = [
    directorProject(3, ["hard_cut"]),
    directorProject(3, ["hard_cut", "dissolve"]),
    { ...directorProject(1, []), unexpectedHotfixField: true },
  ];
  for (const project of rejected) {
    await assert.rejects(
      handler(event, compileRequest(project)),
      (error) => error?.code === "INVALID_REQUEST" && /INVALID_REQUEST/u.test(error.message),
    );
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(compileCalls.length, 3, "invalid transition requests must fail before service dispatch");
});
