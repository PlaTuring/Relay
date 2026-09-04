import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createContext, runInContext } from "node:vm";

import { build } from "esbuild";

const projectRoot = path.resolve(import.meta.dirname, "..");

async function loadHandoffModule(context, harness, options = {}) {
  const buildRoot = await mkdtemp(path.join(os.tmpdir(), "h3-comfy-handoff-"));
  context.after(() => rm(buildRoot, { recursive: true, force: true }));
  const outfile = path.join(buildRoot, "comfy-handoff.mjs");
  await build({
    entryPoints: [path.join(projectRoot, "src", "main", "services", "comfy-handoff.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "silent",
    plugins: [{
      name: "bounded-deadline-fixture",
      setup(builder) {
        builder.onLoad({ filter: /comfy-handoff\.ts$/ }, async (args) => ({
          contents: options.frontendDeadlineMs === undefined
            ? await readFile(args.path, "utf8")
            : (await readFile(args.path, "utf8")).replace(
                "const FRONTEND_SCRIPT_DEADLINE_MS = 25_000;",
                `const FRONTEND_SCRIPT_DEADLINE_MS = ${options.frontendDeadlineMs};`
              ),
          loader: "ts"
        }));
      }
    }, {
      name: "electron-handoff-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^electron$/ }, () => ({
          path: "electron",
          namespace: "handoff-fixture"
        }));
        builder.onLoad({ filter: /.*/, namespace: "handoff-fixture" }, () => ({
          contents: `
            export class BrowserWindow {
              constructor(options) { return globalThis.__h3ComfyHandoffHarness.createWindow(options); }
            }
            export const session = {
              fromPartition(name, options) {
                return globalThis.__h3ComfyHandoffHarness.createSession(name, options);
              }
            };
            export const dialog = {
              showMessageBox(window, options) {
                return globalThis.__h3ComfyHandoffHarness.showMessageBox(window, options);
              }
            };
          `,
          loader: "js"
        }));
      }
    }]
  });
  globalThis.__h3ComfyHandoffHarness = harness;
  context.after(() => {
    delete globalThis.__h3ComfyHandoffHarness;
  });
  return import(`${new URL(`file:///${outfile.replaceAll("\\", "/")}`).href}?fixture=${Date.now()}`);
}

function createHarness(options = {}) {
  const state = {
    navigationCount: 0,
    graphLoadCount: 0,
    maximumConcurrentGraphLoads: 0,
    activeGraphLoads: 0,
    shown: 0,
    focused: 0,
    createdWindows: 0,
    closeAttempts: 0,
    unloadOverrides: 0,
    destroyedWindows: 0,
    rendererCrashesRemaining: options.rendererCrashes ?? 0,
    graphFailuresRemaining: options.graphFailures ?? 0,
    closeDuringGraphLoad: options.closeDuringGraphLoad ?? false,
    closedDuringGraphLoad: false,
    serviceReachable: true,
    graphDirty: options.graphDirty ?? false,
    closeConfirmations: 0,
    activeWindow: null,
    loadedNames: [],
    liveWorkflowName: null,
    queueSubmissions: 0,
    fetchCalls: 0,
    nodeDefinitionRefreshes: 0,
    handoffEvents: [],
    liveGraph: { version: 0.4, nodes: [{ id: 0, widgets_values: ["initial"] }], extra: {} }
  };
  return {
    state,
    createWindow() {
      state.createdWindows += 1;
      let currentUrl = "";
      let ready = false;
      let destroyed = false;
      let navigationCount = 0;
      const closedListeners = [];
      const closeListeners = [];
      const rendererGoneListeners = [];
      const willPreventUnloadListeners = [];
      const clone = (value) => JSON.parse(JSON.stringify(value));
      const workflowStore = {
        activeWorkflow: null,
        openWorkflows: []
      };
      const rendererApp = {
        get vueAppReady() { return ready; },
        get isGraphReady() { return ready; },
        get configuringGraph() { return false; },
        extensionManager: { spinner: false, workflow: workflowStore },
        api: {
          async queuePrompt() {
            state.queueSubmissions += 1;
            throw new Error("fixture: queue submission is forbidden");
          }
        },
        canvas: {},
        graph: {
          serialize() {
            return clone(state.liveGraph);
          }
        },
        ...(options.nodeDefinitionRefreshAvailable === false ? {} : {
          async reloadNodeDefs() {
            state.nodeDefinitionRefreshes += 1;
            state.handoffEvents.push("reloadNodeDefs");
            if (options.nodeDefinitionRefreshFails === true) {
              throw new Error("fixture: node definition refresh failed");
            }
            if (options.nodeDefinitionRefreshPromiseHangs === true) {
              return await new Promise(() => {});
            }
          }
        }),
        async loadGraphData(workflow, _clean, _restoreView, workflowName) {
          state.handoffEvents.push("loadGraphData");
          state.graphLoadCount += 1;
          state.activeGraphLoads += 1;
          state.maximumConcurrentGraphLoads = Math.max(
            state.maximumConcurrentGraphLoads,
            state.activeGraphLoads
          );
          const workflowTarget = typeof workflowName === "string"
            ? { path: workflowName, activeState: clone(workflow) }
            : workflowName;
          if (typeof workflowName === "string") workflowStore.openWorkflows.push(workflowTarget);
          state.loadedNames.push(workflowTarget.path);
          const previousGraph = clone(state.liveGraph);
          const previousWorkflowName = state.liveWorkflowName;
          const previousActiveWorkflow = workflowStore.activeWorkflow;
          state.liveGraph = clone(workflow);
          workflowTarget.activeState = clone(workflow);
          workflowStore.activeWorkflow = workflowTarget;
          state.liveWorkflowName = workflowTarget.path;
          if (options.graphLoadPromiseHangs === true) {
            return await new Promise(() => {});
          }
          await new Promise((resolve) => setImmediate(resolve));
          state.activeGraphLoads -= 1;
          if ((options.staleOnGraphLoads ?? []).includes(state.graphLoadCount)) {
            setTimeout(() => {
              state.liveGraph = clone(options.staleRestoreGraph ?? previousGraph);
              state.liveWorkflowName = options.staleRestoreWorkflowName ?? previousWorkflowName;
              workflowStore.activeWorkflow = options.staleRestoreActiveWorkflow
                ?? previousActiveWorkflow;
              if (options.userInteractionOnStale === true) {
                rendererContext.__minimaxH3UserInteractionGeneration += 1;
              }
            }, options.staleRestoreDelayMs ?? 150);
          }
        }
      };
      const rendererContext = createContext({
        app: rendererApp,
        JSON,
        Promise,
        setTimeout: options.timeoutClampMs === undefined
          ? setTimeout
          : (callback, milliseconds, ...args) => setTimeout(
              callback,
              Math.min(milliseconds, options.timeoutClampMs),
              ...args
            ),
        clearTimeout,
        async fetch() {
          state.fetchCalls += 1;
          throw new Error("fixture: network fetch is forbidden");
        }
      });
      const finishClose = () => {
        if (destroyed) return;
        destroyed = true;
        ready = false;
        state.destroyedWindows += 1;
        for (const listener of closedListeners) listener();
      };
      const webContents = {
        getURL: () => currentUrl,
        setWindowOpenHandler() {},
        on(event, listener) {
          if (event === "render-process-gone") rendererGoneListeners.push(listener);
          if (event === "will-prevent-unload") willPreventUnloadListeners.push(listener);
        },
        async executeJavaScript(expression) {
          if (options.evaluateRenderer === true) {
            if (state.graphDirty && expression.includes("__minimaxH3ManagedGraphBaseline")
              && !expression.includes("const workflow = JSON.parse")) {
              return true;
            }
            const execution = runInContext(expression, rendererContext);
            if (
              options.executeJavaScriptPromiseHangsAfterVisibleLoad === true &&
              expression.includes("const workflow = JSON.parse")
            ) {
              void Promise.resolve(execution).catch(() => undefined);
              await new Promise((resolve) => setImmediate(resolve));
              return await new Promise(() => {});
            }
            return await execution;
          }
          if (expression.includes("__minimaxH3ManagedGraphBaseline")
            && !expression.includes("const workflow = JSON.parse")) {
            return state.graphDirty;
          }
          if (!expression.includes("const workflow = JSON.parse")) return ready;
          state.graphLoadCount += 1;
          state.activeGraphLoads += 1;
          state.maximumConcurrentGraphLoads = Math.max(
            state.maximumConcurrentGraphLoads,
            state.activeGraphLoads
          );
          const match = expression.match(
            /\? retryWorkflowTarget\s*:\s*("(?:[^"\\]|\\.)*");\s*const graphLoadResult/u
          );
          if (match) state.loadedNames.push(JSON.parse(match[1]));
          if (state.closeDuringGraphLoad && !state.closedDuringGraphLoad) {
            state.closedDuringGraphLoad = true;
            window.close();
          }
          await new Promise((resolve) => setImmediate(resolve));
          state.activeGraphLoads -= 1;
          if (state.rendererCrashesRemaining > 0) {
            state.rendererCrashesRemaining -= 1;
            for (const listener of rendererGoneListeners) {
              listener({}, { reason: "crashed", exitCode: 1 });
            }
            throw new Error("fixture: renderer process gone");
          }
          if (state.graphFailuresRemaining > 0) {
            state.graphFailuresRemaining -= 1;
            return "failed";
          }
          return ready ? "loaded" : "not_ready";
        }
      };
      const window = {
        webContents,
        isDestroyed: () => destroyed,
        async loadURL(url) {
          state.navigationCount += 1;
          if (!state.serviceReachable) {
            throw new Error("fixture: ComfyUI service unavailable");
          }
          navigationCount += 1;
          if (navigationCount > 1) {
            // This is the old race: reloading an already active frontend tears down
            // app readiness before the next graph can be imported.
            ready = false;
            throw new Error("fixture: active ComfyUI frontend was reloaded");
          }
          currentUrl = url;
          ready = true;
          if ((options.startupSpinnerMs ?? 0) > 0) {
            rendererApp.extensionManager.spinner = true;
            setTimeout(() => {
              state.liveGraph = clone(options.startupRestoredGraph ?? state.liveGraph);
              rendererApp.extensionManager.spinner = false;
            }, options.startupSpinnerMs);
          }
        },
        show: () => { state.shown += 1; },
        focus: () => { state.focused += 1; },
        close() {
          if (destroyed) return;
          state.closeAttempts += 1;
          let closePrevented = false;
          const closeEvent = { preventDefault() { closePrevented = true; } };
          for (const listener of closeListeners) listener(closeEvent);
          if (closePrevented) return;
          if (options.unsavedBeforeUnload) {
            let unloadAllowed = false;
            const event = {
              preventDefault() {
                unloadAllowed = true;
                state.unloadOverrides += 1;
              }
            };
            for (const listener of willPreventUnloadListeners) listener(event);
            if (!unloadAllowed) return;
          }
          finishClose();
        },
        destroy() {
          finishClose();
        },
        markNotReady() {
          ready = false;
        },
        rendererWorkflowCount() {
          return workflowStore.openWorkflows.length;
        },
        on(event, listener) {
          if (event === "close") closeListeners.push(listener);
          if (event === "closed") closedListeners.push(listener);
        }
      };
      state.activeWindow = window;
      return window;
    },
    createSession() {
      return {
        setPermissionCheckHandler() {},
        setPermissionRequestHandler() {},
        on() {},
        webRequest: { onBeforeRequest() {} }
      };
    },
    setServiceReachable(value) {
      state.serviceReachable = value;
    },
    setGraphDirty(value) {
      state.graphDirty = value;
    },
    async showMessageBox() {
      state.closeConfirmations += 1;
      return { response: options.confirmDiscard === false ? 0 : 1 };
    }
  };
}

async function settleCloseDecision() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function pinnedLoadImage(id, imageName = "minimax-h3-pinned-input.png") {
  return {
    id,
    type: "LoadImage",
    properties: {
      "Node name for S&R": "任意本地化显示名称",
      cnr_id: "comfy-core",
      ver: "0.33.0"
    },
    widgets_values: [imageName, "image"],
    widgets_values_named: { image: imageName, upload: "image" }
  };
}

test("a second workflow reuses the ready ComfyUI document without the reload race", async (context) => {
  const harness = createHarness();
  const api = await loadHandoffModule(context, harness);
  const launchIfNeeded = async () => {
    throw new Error("an already reachable ComfyUI must not be launched again");
  };

  const first = await api.showWorkflowInComfyWindow({
    workflow: { version: 0.4, nodes: [{ id: 1 }] },
    workflowName: "first.json",
    launchIfNeeded
  });
  const second = await api.showWorkflowInComfyWindow({
    workflow: { version: 0.4, nodes: [{ id: 2 }] },
    workflowName: "second.json",
    launchIfNeeded
  });

  assert.deepEqual(first, { visible: true, automaticallyLoaded: true });
  assert.deepEqual(second, { visible: true, automaticallyLoaded: true });
  assert.equal(harness.state.createdWindows, 1);
  assert.equal(harness.state.navigationCount, 1);
  assert.equal(harness.state.graphLoadCount, 2);
  assert.deepEqual(harness.state.loadedNames, ["first", "second"]);
});

test("a visibly loaded media graph releases Relay even when ComfyUI frontend promises never settle", async (context) => {
  const harness = createHarness({
    evaluateRenderer: true,
    nodeDefinitionRefreshPromiseHangs: true,
    graphLoadPromiseHangs: true,
    timeoutClampMs: 2
  });
  const api = await loadHandoffModule(context, harness);
  const workflow = (id, imageName) => ({
    version: 0.4,
    nodes: [pinnedLoadImage(id, imageName)],
    extra: {}
  });

  const first = await api.showWorkflowInComfyWindow({
    workflow: workflow(101, "first-valid.png"),
    workflowName: "first-after-invalid.json",
    launchIfNeeded: null
  });
  const second = await api.showWorkflowInComfyWindow({
    workflow: workflow(102, "second-valid.png"),
    workflowName: "second-after-invalid.json",
    launchIfNeeded: null
  });

  assert.deepEqual(first, { visible: true, automaticallyLoaded: true });
  assert.deepEqual(second, { visible: true, automaticallyLoaded: true });
  assert.equal(harness.state.createdWindows, 1);
  assert.equal(harness.state.navigationCount, 1);
  assert.equal(harness.state.nodeDefinitionRefreshes, 2);
  assert.equal(harness.state.graphLoadCount, 2);
  assert.equal(harness.state.liveWorkflowName, "second-after-invalid");
  assert.equal(harness.state.liveGraph.nodes[0].widgets_values_named.image, "second-valid.png");
  assert.equal(harness.state.queueSubmissions, 0);
  assert.equal(harness.state.fetchCalls, 0);
});

test("a visibly loaded graph does not inherit a six-second delay from a hanging frontend promise", { timeout: 2_500 }, async (context) => {
  const harness = createHarness({
    evaluateRenderer: true,
    graphLoadPromiseHangs: true
  });
  const api = await loadHandoffModule(context, harness);
  const startedAt = performance.now();
  const result = await api.showWorkflowInComfyWindow({
    workflow: { version: 0.4, nodes: [{ id: 103, widgets_values: ["本次可见提示词"] }], extra: {} },
    workflowName: "hanging-promise-visible-graph.json",
    launchIfNeeded: null
  });
  const elapsedMs = performance.now() - startedAt;

  assert.deepEqual(result, { visible: true, automaticallyLoaded: true });
  assert.ok(elapsedMs >= 500, `stability protection returned too early: ${elapsedMs.toFixed(0)}ms`);
  assert.ok(elapsedMs < 1_500, `visible graph waited too long: ${elapsedMs.toFixed(0)}ms`);
  assert.equal(harness.state.graphLoadCount, 1);
  assert.equal(harness.state.queueSubmissions, 0);
  assert.equal(harness.state.fetchCalls, 0);
});

test("an Electron executeJavaScript hang returns a bounded warning and releases the next handoff", { timeout: 2_000 }, async (context) => {
  const harness = createHarness({
    evaluateRenderer: true,
    executeJavaScriptPromiseHangsAfterVisibleLoad: true,
    timeoutClampMs: 1
  });
  const api = await loadHandoffModule(context, harness, { frontendDeadlineMs: 25 });
  const makeWorkflow = (id, imageName) => ({
    version: 0.4,
    nodes: [pinnedLoadImage(id, imageName)],
    extra: {}
  });

  const first = await api.showWorkflowInComfyWindow({
    workflow: makeWorkflow(201, "bounded-first.png"),
    workflowName: "bounded-first.json",
    launchIfNeeded: null
  });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const second = await api.showWorkflowInComfyWindow({
    workflow: makeWorkflow(202, "bounded-second.png"),
    workflowName: "bounded-second.json",
    launchIfNeeded: null
  });
  await new Promise((resolve) => setTimeout(resolve, 250));

  assert.deepEqual(first, { visible: true, automaticallyLoaded: false });
  assert.deepEqual(second, { visible: true, automaticallyLoaded: false });
  assert.equal(harness.state.liveWorkflowName, "bounded-second");
  assert.equal(harness.state.liveGraph.nodes[0].widgets_values_named.image, "bounded-second.png");
  assert.equal(harness.state.maximumConcurrentGraphLoads, 1);
  assert.equal(harness.state.queueSubmissions, 0);
  assert.equal(harness.state.fetchCalls, 0);
});

test("a local LoadImage refreshes node definitions before the first graph load", async (context) => {
  const harness = createHarness({ evaluateRenderer: true });
  const api = await loadHandoffModule(context, harness);

  const result = await api.showWorkflowInComfyWindow({
    workflow: {
      version: 0.4,
      nodes: [pinnedLoadImage(1)],
      extra: {}
    },
    workflowName: "media-input.json",
    launchIfNeeded: null
  });

  assert.deepEqual(result, { visible: true, automaticallyLoaded: true });
  assert.equal(harness.state.nodeDefinitionRefreshes, 1);
  assert.equal(harness.state.graphLoadCount, 1);
  assert.deepEqual(harness.state.handoffEvents, ["reloadNodeDefs", "loadGraphData"]);
  const timing = api.getLastComfyHandoffTimingEvidence();
  assert.equal(timing.schemaVersion, "1.0.0");
  assert.equal(timing.outcome, "loaded");
  assert.equal(timing.nodeDefinitionRefresh.disposition, "performed");
  for (const value of [
    timing.totalMs,
    timing.capabilityReadinessMs,
    timing.nodeDefinitionRefresh.elapsedMs,
    timing.workflowLoadConfirmationMs
  ]) assert.equal(Number.isSafeInteger(value) && value >= 0, true);
  assert.doesNotMatch(JSON.stringify(timing), /media-input|\.json|prompt|\\|\//iu);
  assert.equal(harness.state.queueSubmissions, 0);
  assert.equal(harness.state.fetchCalls, 0);
});

test("a completed handoff reports path-free timing evidence before releasing the serialized queue", async (context) => {
  const harness = createHarness({ evaluateRenderer: true });
  const api = await loadHandoffModule(context, harness);
  const recorded = [];

  const result = await api.showWorkflowInComfyWindow({
    workflow: { version: 0.4, nodes: [{ id: 305, type: "Note" }], extra: {} },
    workflowName: "timing-callback.json",
    launchIfNeeded: null,
    onTimingEvidence: async (evidence) => recorded.push(evidence)
  });

  assert.deepEqual(result, { visible: true, automaticallyLoaded: true });
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].schemaVersion, "1.0.0");
  assert.equal(recorded[0].outcome, "loaded");
  assert.doesNotMatch(JSON.stringify(recorded[0]), /timing-callback|\.png|\.json|prompt|\\|\//iu);
  assert.equal(harness.state.queueSubmissions, 0);
  assert.equal(harness.state.fetchCalls, 0);
});

test("a diagnostics write failure never changes a successful visible handoff", async (context) => {
  const harness = createHarness({ evaluateRenderer: true });
  const api = await loadHandoffModule(context, harness);

  const result = await api.showWorkflowInComfyWindow({
    workflow: { version: 0.4, nodes: [{ id: 306, type: "Note" }], extra: {} },
    workflowName: "timing-write-failure.json",
    launchIfNeeded: null,
    onTimingEvidence: async () => {
      throw new Error("synthetic diagnostics failure");
    }
  });

  assert.deepEqual(result, { visible: true, automaticallyLoaded: true });
  assert.equal(harness.state.queueSubmissions, 0);
  assert.equal(harness.state.fetchCalls, 0);
});

test("repeating the same pinned media workflow reuses its verified node-definition refresh", async (context) => {
  const harness = createHarness({ evaluateRenderer: true });
  const api = await loadHandoffModule(context, harness);
  const workflow = {
    version: 0.4,
    nodes: [pinnedLoadImage(1, "same-media.png")],
    extra: {}
  };

  assert.deepEqual(await api.showWorkflowInComfyWindow({
    workflow,
    workflowName: "same-media.json",
    launchIfNeeded: null
  }), { visible: true, automaticallyLoaded: true });
  const firstTiming = api.getLastComfyHandoffTimingEvidence();
  assert.deepEqual(await api.showWorkflowInComfyWindow({
    workflow,
    workflowName: "same-media.json",
    launchIfNeeded: null
  }), { visible: true, automaticallyLoaded: true });
  const secondTiming = api.getLastComfyHandoffTimingEvidence();

  assert.equal(harness.state.nodeDefinitionRefreshes, 1);
  assert.equal(harness.state.graphLoadCount, 2);
  assert.deepEqual(harness.state.handoffEvents, ["reloadNodeDefs", "loadGraphData", "loadGraphData"]);
  assert.equal(firstTiming.nodeDefinitionRefresh.disposition, "performed");
  assert.equal(secondTiming.nodeDefinitionRefresh.disposition, "reused");
});

test("a pinned LoadImage inside an official subgraph also requires a refresh", async (context) => {
  const harness = createHarness({ evaluateRenderer: true });
  const api = await loadHandoffModule(context, harness);

  const result = await api.showWorkflowInComfyWindow({
    workflow: {
      version: 0.4,
      nodes: [{ id: 1, type: "official-subgraph-id" }],
      definitions: {
        subgraphs: [{
          id: "official-subgraph-id",
          nodes: [pinnedLoadImage(2, "nested.png")]
        }]
      },
      extra: {}
    },
    workflowName: "nested-media-input.json",
    launchIfNeeded: null
  });

  assert.deepEqual(result, { visible: true, automaticallyLoaded: true });
  assert.equal(harness.state.nodeDefinitionRefreshes, 1);
  assert.deepEqual(harness.state.handoffEvents, ["reloadNodeDefs", "loadGraphData"]);
});

test("media handoff fails closed when the frontend refresh capability is unavailable", async (context) => {
  const harness = createHarness({
    evaluateRenderer: true,
    nodeDefinitionRefreshAvailable: false
  });
  const api = await loadHandoffModule(context, harness);

  const result = await api.showWorkflowInComfyWindow({
    workflow: {
      version: 0.4,
      nodes: [pinnedLoadImage(1, "missing-refresh.png")],
      extra: {}
    },
    workflowName: "no-refresh-capability.json",
    launchIfNeeded: null
  });

  assert.deepEqual(result, { visible: true, automaticallyLoaded: false });
  assert.equal(harness.state.nodeDefinitionRefreshes, 0);
  assert.equal(harness.state.graphLoadCount, 0);
  assert.deepEqual(harness.state.handoffEvents, []);
  assert.equal(api.getLastComfyHandoffTimingEvidence().nodeDefinitionRefresh.disposition, "failed");
});

test("media handoff fails closed when refreshing node definitions rejects", async (context) => {
  const harness = createHarness({
    evaluateRenderer: true,
    nodeDefinitionRefreshFails: true
  });
  const api = await loadHandoffModule(context, harness);

  const result = await api.showWorkflowInComfyWindow({
    workflow: {
      version: 0.4,
      nodes: [pinnedLoadImage(1, "failed-refresh.png")],
      extra: {}
    },
    workflowName: "failed-refresh.json",
    launchIfNeeded: null
  });

  assert.deepEqual(result, { visible: true, automaticallyLoaded: false });
  assert.equal(harness.state.nodeDefinitionRefreshes, 1);
  assert.equal(harness.state.graphLoadCount, 0);
  assert.deepEqual(harness.state.handoffEvents, ["reloadNodeDefs"]);
  assert.equal(api.getLastComfyHandoffTimingEvidence().nodeDefinitionRefresh.disposition, "failed");
});

test("a workflow without pinned media does not require the refresh capability", async (context) => {
  const harness = createHarness({
    evaluateRenderer: true,
    nodeDefinitionRefreshAvailable: false
  });
  const api = await loadHandoffModule(context, harness);

  const result = await api.showWorkflowInComfyWindow({
    workflow: { version: 0.4, nodes: [{ id: 1, type: "MiniMaxH3TextToVideo" }], extra: {} },
    workflowName: "text-only.json",
    launchIfNeeded: null
  });

  assert.deepEqual(result, { visible: true, automaticallyLoaded: true });
  assert.equal(harness.state.nodeDefinitionRefreshes, 0);
  assert.equal(harness.state.graphLoadCount, 1);
  assert.deepEqual(harness.state.handoffEvents, ["loadGraphData"]);
  assert.equal(api.getLastComfyHandoffTimingEvidence().nodeDefinitionRefresh.disposition, "not_required");
});

test("a 150k-element unrelated array is ignored without spread or recursive scanning", async (context) => {
  const harness = createHarness({
    evaluateRenderer: true,
    nodeDefinitionRefreshAvailable: false
  });
  const api = await loadHandoffModule(context, harness);

  const result = await api.showWorkflowInComfyWindow({
    workflow: {
      version: 0.4,
      nodes: [{ id: 1, type: "MiniMaxH3TextToVideo" }],
      noise: new Array(150_000).fill(0),
      extra: {}
    },
    workflowName: "large-unrelated-noise.json",
    launchIfNeeded: null
  });

  assert.deepEqual(result, { visible: true, automaticallyLoaded: true });
  assert.equal(harness.state.nodeDefinitionRefreshes, 0);
  assert.equal(harness.state.graphLoadCount, 1);
});

test("an oversized certified nodes container fails closed without evaluating the graph", async (context) => {
  const harness = createHarness({ evaluateRenderer: true });
  const api = await loadHandoffModule(context, harness);

  const result = await api.showWorkflowInComfyWindow({
    workflow: {
      version: 0.4,
      nodes: new Array(150_000).fill(null),
      extra: {}
    },
    workflowName: "oversized-node-container.json",
    launchIfNeeded: null
  });

  assert.deepEqual(result, { visible: true, automaticallyLoaded: false });
  assert.equal(harness.state.nodeDefinitionRefreshes, 0);
  assert.equal(harness.state.graphLoadCount, 0);
  assert.deepEqual(harness.state.handoffEvents, []);
});

test("an oversized definition budget wins over an otherwise valid media node", async (context) => {
  const harness = createHarness({ evaluateRenderer: true });
  const api = await loadHandoffModule(context, harness);

  const result = await api.showWorkflowInComfyWindow({
    workflow: {
      version: 0.4,
      nodes: [pinnedLoadImage(1)],
      definitions: { subgraphs: new Array(150_000).fill(null) },
      extra: {}
    },
    workflowName: "oversized-definition-container.json",
    launchIfNeeded: null
  });

  assert.deepEqual(result, { visible: true, automaticallyLoaded: false });
  assert.equal(harness.state.nodeDefinitionRefreshes, 0);
  assert.equal(harness.state.graphLoadCount, 0);
  assert.deepEqual(harness.state.handoffEvents, []);
});

test("display and arbitrary nested LoadImage lookalikes never trigger a refresh", async (context) => {
  const harness = createHarness({
    evaluateRenderer: true,
    nodeDefinitionRefreshAvailable: false
  });
  const api = await loadHandoffModule(context, harness);
  const nestedLookalike = pinnedLoadImage(99, "must-not-be-scanned.png");

  const result = await api.showWorkflowInComfyWindow({
    workflow: {
      version: 0.4,
      nodes: [
        { id: 1, type: "MarkdownNote", title: "LoadImage" },
        {
          ...pinnedLoadImage(2, "wrong-core.png"),
          properties: { cnr_id: "unknown-pack", ver: "0.33.0" }
        },
        {
          ...pinnedLoadImage(3, "wrong-widget.png"),
          widgets_values_named: { image: "wrong-widget.png", upload: "video" }
        }
      ],
      metadata: { nodes: [nestedLookalike] },
      extra: {}
    },
    workflowName: "load-image-lookalikes.json",
    launchIfNeeded: null
  });

  assert.deepEqual(result, { visible: true, automaticallyLoaded: true });
  assert.equal(harness.state.nodeDefinitionRefreshes, 0);
  assert.equal(harness.state.graphLoadCount, 1);
});

test("a previous-tab restore after loadGraphData is corrected during the same handoff", async (context) => {
  const harness = createHarness({
    evaluateRenderer: true,
    staleOnGraphLoads: [2, 4],
    staleRestoreDelayMs: 150
  });
  const api = await loadHandoffModule(context, harness);
  const handoff = (name, prompt) => api.showWorkflowInComfyWindow({
    workflow: {
      version: 0.4,
      nodes: [{ id: 1, widgets_values: [prompt] }],
      extra: { fixture: name }
    },
    workflowName: `${name}.json`,
    launchIfNeeded: null
  });

  const first = await handoff("first", "第一条提示词");
  const second = await handoff("second", "第二条完全不同的提示词");
  const third = await handoff("third", "第三条最终提示词");

  assert.deepEqual(first, { visible: true, automaticallyLoaded: true });
  assert.deepEqual(second, { visible: true, automaticallyLoaded: true });
  assert.deepEqual(third, { visible: true, automaticallyLoaded: true });
  assert.equal(harness.state.createdWindows, 1);
  assert.equal(harness.state.navigationCount, 1);
  assert.equal(harness.state.graphLoadCount, 5);
  assert.deepEqual(harness.state.loadedNames, ["first", "second", "second", "third", "third"]);
  assert.equal(harness.state.liveGraph.nodes[0].widgets_values[0], "第三条最终提示词");
  assert.equal(harness.state.liveWorkflowName, "third");
  assert.equal(harness.state.activeWindow.rendererWorkflowCount(), 3);
  assert.equal(typeof harness.state.liveGraph.extra.__minimaxH3HandoffToken, "string");
  assert.equal(harness.state.queueSubmissions, 0);
  assert.equal(harness.state.fetchCalls, 0);
});

test("initial handoff waits until ComfyUI finishes restoring its workspace tabs", async (context) => {
  const restored = {
    version: 0.4,
    nodes: [{ id: 9, widgets_values: ["启动时恢复的旧提示词"] }],
    extra: { restored: true }
  };
  const harness = createHarness({
    evaluateRenderer: true,
    startupSpinnerMs: 300,
    startupRestoredGraph: restored
  });
  const api = await loadHandoffModule(context, harness);

  const result = await api.showWorkflowInComfyWindow({
    workflow: {
      version: 0.4,
      nodes: [{ id: 10, widgets_values: ["本次首次点击的新提示词"] }],
      extra: {}
    },
    workflowName: "after-startup.json",
    launchIfNeeded: null
  });

  assert.deepEqual(result, { visible: true, automaticallyLoaded: true });
  assert.equal(harness.state.graphLoadCount, 1);
  assert.equal(harness.state.liveGraph.nodes[0].widgets_values[0], "本次首次点击的新提示词");
});

test("a real in-memory user edit is preserved instead of being replaced", async (context) => {
  const harness = createHarness({ evaluateRenderer: true });
  const api = await loadHandoffModule(context, harness);
  const first = await api.showWorkflowInComfyWindow({
    workflow: {
      version: 0.4,
      nodes: [{ id: 1, widgets_values: ["原始提示词"] }],
      extra: {}
    },
    workflowName: "editable.json",
    launchIfNeeded: null
  });
  harness.state.liveGraph.nodes[0].widgets_values[0] = "用户在 ComfyUI 手工修改后的提示词";

  const second = await api.showWorkflowInComfyWindow({
    workflow: {
      version: 0.4,
      nodes: [{ id: 2, widgets_values: ["不应覆盖用户修改"] }],
      extra: {}
    },
    workflowName: "must-not-overwrite.json",
    launchIfNeeded: null
  });

  assert.deepEqual(first, { visible: true, automaticallyLoaded: true });
  assert.deepEqual(second, { visible: true, automaticallyLoaded: false });
  assert.equal(harness.state.graphLoadCount, 1);
  assert.equal(
    harness.state.liveGraph.nodes[0].widgets_values[0],
    "用户在 ComfyUI 手工修改后的提示词"
  );
  assert.equal(harness.state.queueSubmissions, 0);
});

test("a user tab switch during verification is not mistaken for the restore race", async (context) => {
  const userSelectedGraph = {
    version: 0.4,
    nodes: [{ id: 99, widgets_values: ["用户切换到的另一张画布"] }],
    extra: { userSelected: true }
  };
  const harness = createHarness({
    evaluateRenderer: true,
    staleOnGraphLoads: [2],
    staleRestoreDelayMs: 150,
    staleRestoreGraph: userSelectedGraph,
    staleRestoreWorkflowName: "user-selected-tab"
  });
  const api = await loadHandoffModule(context, harness);
  const first = await api.showWorkflowInComfyWindow({
    workflow: {
      version: 0.4,
      nodes: [{ id: 1, widgets_values: ["第一条提示词"] }],
      extra: {}
    },
    workflowName: "first.json",
    launchIfNeeded: null
  });

  const second = await api.showWorkflowInComfyWindow({
    workflow: {
      version: 0.4,
      nodes: [{ id: 2, widgets_values: ["第二条提示词"] }],
      extra: {}
    },
    workflowName: "second.json",
    launchIfNeeded: null
  });

  assert.deepEqual(first, { visible: true, automaticallyLoaded: true });
  assert.deepEqual(second, { visible: true, automaticallyLoaded: false });
  assert.equal(harness.state.graphLoadCount, 2);
  assert.equal(harness.state.liveGraph.nodes[0].widgets_values[0], "用户切换到的另一张画布");
  assert.equal(harness.state.liveWorkflowName, "user-selected-tab");
  assert.equal(harness.state.queueSubmissions, 0);
});

test("clicking back to the exact previous managed tab is never auto-overwritten", async (context) => {
  const harness = createHarness({
    evaluateRenderer: true,
    staleOnGraphLoads: [2],
    staleRestoreDelayMs: 150,
    userInteractionOnStale: true
  });
  const api = await loadHandoffModule(context, harness);
  const first = await api.showWorkflowInComfyWindow({
    workflow: {
      version: 0.4,
      nodes: [{ id: 1, widgets_values: ["上一张由工具管理的提示词"] }],
      extra: {}
    },
    workflowName: "previous-managed.json",
    launchIfNeeded: null
  });
  const second = await api.showWorkflowInComfyWindow({
    workflow: {
      version: 0.4,
      nodes: [{ id: 2, widgets_values: ["本次不应抢回的提示词"] }],
      extra: {}
    },
    workflowName: "new-attempt.json",
    launchIfNeeded: null
  });

  assert.deepEqual(first, { visible: true, automaticallyLoaded: true });
  assert.deepEqual(second, { visible: true, automaticallyLoaded: false });
  assert.equal(harness.state.graphLoadCount, 2);
  assert.equal(harness.state.liveGraph.nodes[0].widgets_values[0], "上一张由工具管理的提示词");
  assert.equal(harness.state.liveWorkflowName, "previous-managed");
  assert.equal(harness.state.queueSubmissions, 0);
});

test("a stale existing document is relaunched and loaded by the same click", async (context) => {
  const harness = createHarness();
  const api = await loadHandoffModule(context, harness);
  let launchCalls = 0;
  const launchIfNeeded = async () => {
    launchCalls += 1;
    harness.setServiceReachable(true);
    return true;
  };

  const first = await api.showWorkflowInComfyWindow({
    workflow: { version: 0.4, nodes: [{ id: 1 }] },
    workflowName: "before-stale.json",
    launchIfNeeded
  });
  harness.state.activeWindow.markNotReady();
  harness.setServiceReachable(false);

  const recovered = await api.showWorkflowInComfyWindow({
    workflow: { version: 0.4, nodes: [{ id: 2 }] },
    workflowName: "after-stale.json",
    launchIfNeeded
  });

  assert.deepEqual(first, { visible: true, automaticallyLoaded: true });
  assert.deepEqual(recovered, { visible: true, automaticallyLoaded: true });
  assert.equal(launchCalls, 1);
  assert.equal(harness.state.createdWindows, 2);
  assert.deepEqual(harness.state.loadedNames, ["before-stale", "after-stale"]);
});

test("a stale dirty document is preserved instead of being destroyed during recovery", async (context) => {
  const harness = createHarness();
  const api = await loadHandoffModule(context, harness);
  const first = await api.showWorkflowInComfyWindow({
    workflow: { version: 0.4, nodes: [{ id: 21 }] },
    workflowName: "dirty-before-stale.json",
    launchIfNeeded: null
  });
  harness.setGraphDirty(true);
  harness.state.activeWindow.markNotReady();
  harness.setServiceReachable(false);

  const second = await api.showWorkflowInComfyWindow({
    workflow: { version: 0.4, nodes: [{ id: 22 }] },
    workflowName: "must-not-replace-dirty-stale.json",
    launchIfNeeded: async () => true
  });

  assert.deepEqual(first, { visible: true, automaticallyLoaded: true });
  assert.deepEqual(second, { visible: true, automaticallyLoaded: false });
  assert.equal(harness.state.createdWindows, 1);
  assert.equal(harness.state.destroyedWindows, 0);
  assert.equal(harness.state.graphLoadCount, 1);
  assert.deepEqual(harness.state.loadedNames, ["dirty-before-stale"]);
});

test("overlapping handoff requests are serialized around loadGraphData", async (context) => {
  const harness = createHarness();
  const api = await loadHandoffModule(context, harness);
  const options = (id) => ({
    workflow: { version: 0.4, nodes: [{ id }] },
    workflowName: `workflow-${id}.json`,
    launchIfNeeded: null
  });

  const [first, second] = await Promise.all([
    api.showWorkflowInComfyWindow(options(1)),
    api.showWorkflowInComfyWindow(options(2))
  ]);

  assert.equal(first.automaticallyLoaded, true);
  assert.equal(second.automaticallyLoaded, true);
  assert.equal(harness.state.navigationCount, 1);
  assert.equal(harness.state.maximumConcurrentGraphLoads, 1);
  assert.deepEqual(harness.state.loadedNames, ["workflow-1", "workflow-2"]);
});

test("a renderer crash rebuilds once and loads without another user click", async (context) => {
  const harness = createHarness({ rendererCrashes: 1 });
  const api = await loadHandoffModule(context, harness);

  const result = await api.showWorkflowInComfyWindow({
    workflow: { version: 0.4, nodes: [{ id: 7 }] },
    workflowName: "renderer-recovery.json",
    launchIfNeeded: null
  });

  assert.deepEqual(result, { visible: true, automaticallyLoaded: true });
  assert.equal(harness.state.createdWindows, 2);
  assert.equal(harness.state.navigationCount, 2);
  assert.equal(harness.state.graphLoadCount, 2);
  assert.deepEqual(harness.state.loadedNames, ["renderer-recovery", "renderer-recovery"]);
});

test("a graph configuration failure is not retried as a renderer crash", async (context) => {
  const harness = createHarness({ graphFailures: 1 });
  const api = await loadHandoffModule(context, harness);

  const result = await api.showWorkflowInComfyWindow({
    workflow: { version: 0.4, nodes: [{ id: 8 }] },
    workflowName: "invalid-graph.json",
    launchIfNeeded: null
  });

  assert.deepEqual(result, { visible: true, automaticallyLoaded: false });
  assert.equal(harness.state.createdWindows, 1);
  assert.equal(harness.state.navigationCount, 1);
  assert.equal(harness.state.graphLoadCount, 1);
});

test("an unchanged managed graph closes without a warning and overrides beforeunload once", async (context) => {
  const harness = createHarness({ unsavedBeforeUnload: true });
  const api = await loadHandoffModule(context, harness);

  const result = await api.showWorkflowInComfyWindow({
    workflow: { version: 0.4, nodes: [{ id: 9 }] },
    workflowName: "already-stored.json",
    launchIfNeeded: null
  });
  harness.state.activeWindow.close();
  await settleCloseDecision();

  assert.deepEqual(result, { visible: true, automaticallyLoaded: true });
  assert.equal(harness.state.closeAttempts, 2);
  assert.equal(harness.state.closeConfirmations, 0);
  assert.equal(harness.state.unloadOverrides, 1);
  assert.equal(harness.state.destroyedWindows, 1);
  assert.equal(harness.state.createdWindows, 1);
});

test("a dirty graph asks before closing and a cancelled close preserves the window", async (context) => {
  const harness = createHarness({
    unsavedBeforeUnload: true,
    graphDirty: true,
    confirmDiscard: false
  });
  const api = await loadHandoffModule(context, harness);
  await api.showWorkflowInComfyWindow({
    workflow: { version: 0.4, nodes: [{ id: 90 }] },
    workflowName: "edited.json",
    launchIfNeeded: null
  });

  harness.state.activeWindow.close();
  await settleCloseDecision();

  assert.equal(harness.state.closeConfirmations, 1);
  assert.equal(harness.state.destroyedWindows, 0);
  assert.equal(harness.state.unloadOverrides, 0);
});

test("a dirty graph closes after explicit discard confirmation", async (context) => {
  const harness = createHarness({ unsavedBeforeUnload: true, graphDirty: true });
  const api = await loadHandoffModule(context, harness);
  await api.showWorkflowInComfyWindow({
    workflow: { version: 0.4, nodes: [{ id: 91 }] },
    workflowName: "discard-edits.json",
    launchIfNeeded: null
  });

  harness.state.activeWindow.close();
  await settleCloseDecision();

  assert.equal(harness.state.closeConfirmations, 1);
  assert.equal(harness.state.destroyedWindows, 1);
  assert.equal(harness.state.unloadOverrides, 1);
});

test("a dirty managed graph is never replaced by a later automatic handoff", async (context) => {
  const harness = createHarness();
  const api = await loadHandoffModule(context, harness);
  const first = await api.showWorkflowInComfyWindow({
    workflow: { version: 0.4, nodes: [{ id: 92 }] },
    workflowName: "kept-edits.json",
    launchIfNeeded: null
  });
  harness.setGraphDirty(true);
  const second = await api.showWorkflowInComfyWindow({
    workflow: { version: 0.4, nodes: [{ id: 93 }] },
    workflowName: "stored-not-overwritten.json",
    launchIfNeeded: null
  });

  assert.deepEqual(first, { visible: true, automaticallyLoaded: true });
  assert.deepEqual(second, { visible: true, automaticallyLoaded: false });
  assert.equal(harness.state.graphLoadCount, 1);
  assert.deepEqual(harness.state.loadedNames, ["kept-edits"]);
});

test("closing during a handoff is not mistaken for a renderer crash or reopened", async (context) => {
  const harness = createHarness({
    unsavedBeforeUnload: true,
    closeDuringGraphLoad: true
  });
  const api = await loadHandoffModule(context, harness);

  const result = await api.showWorkflowInComfyWindow({
    workflow: { version: 0.4, nodes: [{ id: 10 }] },
    workflowName: "close-during-load.json",
    launchIfNeeded: null
  });
  await settleCloseDecision();

  assert.deepEqual(result, { visible: false, automaticallyLoaded: false });
  assert.equal(harness.state.closeAttempts, 2);
  assert.equal(harness.state.unloadOverrides, 1);
  assert.equal(harness.state.createdWindows, 1);
  assert.equal(harness.state.navigationCount, 1);
  assert.equal(harness.state.graphLoadCount, 1);
});

test("a handoff queued before the user closes is cancelled instead of reopening", async (context) => {
  const harness = createHarness({
    unsavedBeforeUnload: true,
    closeDuringGraphLoad: true
  });
  const api = await loadHandoffModule(context, harness);
  const options = (id) => ({
    workflow: { version: 0.4, nodes: [{ id }] },
    workflowName: `queued-close-${id}.json`,
    launchIfNeeded: null
  });

  const [active, queued] = await Promise.all([
    api.showWorkflowInComfyWindow(options(11)),
    api.showWorkflowInComfyWindow(options(12))
  ]);
  await settleCloseDecision();

  assert.deepEqual(active, { visible: false, automaticallyLoaded: false });
  assert.deepEqual(queued, { visible: false, automaticallyLoaded: false });
  assert.equal(harness.state.createdWindows, 1);
  assert.equal(harness.state.navigationCount, 1);
  assert.equal(harness.state.graphLoadCount, 1);
  assert.deepEqual(harness.state.loadedNames, ["queued-close-11"]);
});
