import process from "node:process";

const port = Number(process.argv[2] ?? 9333);
const closeComfyAfterProof = process.argv.includes("--close-comfy");
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
  throw new Error("QA.INVALID_CDP_PORT");
}

const origin = `http://127.0.0.1:${port}`;
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function targets() {
  const response = await fetch(`${origin}/json/list`);
  if (!response.ok) throw new Error(`QA.CDP_HTTP_${response.status}`);
  return response.json();
}

async function waitForTarget(predicate, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const match = (await targets()).find(predicate);
    if (match?.webSocketDebuggerUrl) return match;
    await delay(250);
  }
  throw new Error("QA.CDP_TARGET_TIMEOUT");
}

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!Number.isSafeInteger(message.id)) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result);
    });
    return this;
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "QA.CDP_EVALUATION_FAILED");
    return result.result?.value;
  }

  close() {
    this.socket.close();
  }
}

const controlTarget = await waitForTarget((target) => target.url?.startsWith("file:") && target.title === "Relay");
const control = await new CdpClient(controlTarget.webSocketDebuggerUrl).open();

let readyState;
for (let attempt = 0; attempt < 80; attempt += 1) {
  readyState = await control.evaluate(`(() => ({
    ready: document.getElementById("app-shell")?.dataset.ready,
    setupComplete: document.getElementById("app-shell")?.dataset.setupComplete,
    compileDisabled: document.getElementById("compile-button")?.disabled,
    activeView: document.querySelector(".view.is-active")?.id
  }))()`);
  if (readyState?.ready === "true" && readyState?.setupComplete === "true" && readyState?.compileDisabled === false) break;
  await delay(250);
}
if (readyState?.compileDisabled !== false) throw new Error(`QA.CONTROL_NOT_READY ${JSON.stringify(readyState)}`);

const prompt = `integrated_multimodal_description: [镜头 1] 真人实拍，雨中的城市屋顶，快递员看见发光的折纸鹤。[镜头 2] 在 00:05.000，低机位跟拍她骑车穿过积水巷道。[镜头 3] 在 00:10.000，中远景展示她走进恢复生机的屋顶温室。

overall_soundscape: 持续雨声、自行车链条声与远处城市环境声。

non_diegetic_music: 稀疏钢琴与柔和电子脉冲。`;

const submitted = await control.evaluate(`(() => {
  const setValue = (id, value) => {
    const element = document.getElementById(id);
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  };
  document.querySelector('input[name="mode"][value="T2V"]').click();
  setValue("project-prompt", ${JSON.stringify(prompt)});
  setValue("project-duration", "15");
  setValue("segment-duration", "5");
  setValue("project-canvas", "9:16");
  setValue("project-resolution", "0.4");
  document.getElementById("project-form").requestSubmit();
  return true;
})()`);
if (submitted !== true) throw new Error("QA.SUBMIT_FAILED");

const comfyTarget = await waitForTarget((target) => target.url?.startsWith("http://127.0.0.1:8188/"), 160);
const comfy = await new CdpClient(comfyTarget.webSocketDebuggerUrl).open();

let controlEvidence;
for (let attempt = 0; attempt < 160; attempt += 1) {
  controlEvidence = await control.evaluate(`(() => ({
    success: document.getElementById("success-message")?.textContent,
    errorHidden: document.getElementById("compile-error")?.hidden,
    error: document.getElementById("compile-error")?.textContent,
    compileDisabled: document.getElementById("compile-button")?.disabled
  }))()`);
  if (controlEvidence?.compileDisabled === false && controlEvidence?.success) break;
  await delay(250);
}

let graphEvidence;
for (let attempt = 0; attempt < 160; attempt += 1) {
  graphEvidence = await comfy.evaluate(`(() => {
    const graph = globalThis.app?.graph?.serialize?.();
    if (!graph || !Array.isArray(graph.nodes)) return null;
    const serializedGraph = JSON.stringify(graph);
    const baseline = globalThis.__minimaxH3ManagedGraphBaseline;
    const baselineDiffs = [];
    if (typeof baseline === "string" && serializedGraph !== baseline) {
      const visit = (left, right, path) => {
        if (baselineDiffs.length >= 20 || Object.is(left, right)) return;
        if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
          baselineDiffs.push([path, left, right]);
          return;
        }
        const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
        for (const key of keys) visit(left[key], right[key], path + "/" + key);
      };
      try { visit(JSON.parse(baseline), graph, ""); } catch { baselineDiffs.push(["/", "unparseable_baseline", null]); }
    }
    const h3Nodes = graph.nodes.filter((node) => node.type === "79dd8a95-ce9d-4c14-b264-2162e8bec5ce");
    const resolution = graph.nodes.find((node) => node.type === "ResolutionSelector");
    const components = graph.nodes.filter((node) => node.type === "GetVideoComponents");
    const create = graph.nodes.find((node) => node.type === "CreateVideo");
    return {
      title: document.title,
      nodeCount: graph.nodes.length,
      linkCount: graph.links?.length ?? 0,
      h3Count: h3Nodes.length,
      uniquePrompts: new Set(h3Nodes.map((node) => node.widgets_values?.[0])).size,
      durations: h3Nodes.map((node) => node.widgets_values?.[3]),
      resolutionWidgets: resolution?.widgets_values,
      componentSchemas: components.map((node) => node.outputs?.map((output) => [output.name, output.type])),
      createVideoWidgets: create?.widgets_values,
      saveVideoSize: graph.nodes.find((node) => node.type === "SaveVideo")?.size,
      managedBaseline: typeof baseline === "string",
      dirtyAgainstBaseline: typeof baseline === "string" ? serializedGraph !== baseline : null,
      baselineLength: typeof baseline === "string" ? baseline.length : null,
      serializedLength: serializedGraph.length,
      baselineDiffs
    };
  })()`);
  if (graphEvidence?.h3Count === 3 && graphEvidence?.managedBaseline === true) break;
  await delay(250);
}

const expectedSchema = JSON.stringify([
  ["images", "IMAGE"],
  ["audio", "AUDIO"],
  ["fps", "FLOAT"],
  ["bit_depth", "COMBO"],
  ["color_space", "COMBO"],
]);
const legacyCompatibleSchema = JSON.stringify([
  ["images", "IMAGE"],
  ["audio", "AUDIO"],
  ["fps", "FLOAT"],
  ["bit_depth", "INT"],
  ["color_space", "COMBO"],
]);
const failures = [];
if (graphEvidence?.h3Count !== 3) failures.push("H3_SEGMENT_COUNT");
if (graphEvidence?.uniquePrompts !== 3) failures.push("H3_PROMPT_SPLIT");
if (JSON.stringify(graphEvidence?.durations) !== JSON.stringify([5, 5, 5])) failures.push("H3_SEGMENT_DURATION");
if (JSON.stringify(graphEvidence?.resolutionWidgets) !== JSON.stringify(["9:16 (Portrait Widescreen)", 0.4, 32])) failures.push("RESOLUTION_SELECTOR");
if (!graphEvidence?.componentSchemas?.every((schema) => {
  const serialized = JSON.stringify(schema);
  return serialized === expectedSchema || serialized === legacyCompatibleSchema;
})) failures.push("VIDEO_COMPONENT_SCHEMA");
if (![JSON.stringify([24, 8, "sRGB"]), JSON.stringify([24, 8])].includes(JSON.stringify(graphEvidence?.createVideoWidgets))) failures.push("CREATE_VIDEO_SCHEMA");
if (graphEvidence?.saveVideoSize?.[0] !== 380 || graphEvidence?.saveVideoSize?.[1] > 150) failures.push("SAVE_VIDEO_SIZE");
if (graphEvidence?.managedBaseline !== true) failures.push("DIRTY_BASELINE");
if (controlEvidence?.errorHidden !== true) failures.push("CONTROL_ERROR");

let closeEvidence = "not_requested";
if (closeComfyAfterProof) {
  await comfy.evaluate("window.close(); true");
  closeEvidence = "still_open";
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (!(await targets()).some((target) => target.id === comfyTarget.id)) {
      closeEvidence = "closed_without_task_manager";
      break;
    }
    await delay(250);
  }
  if (closeEvidence !== "closed_without_task_manager") failures.push("COMFY_WINDOW_CLOSE");
}

control.close();
comfy.close();
console.log(JSON.stringify({ ok: failures.length === 0, failures, closeEvidence, readyState, controlEvidence, graphEvidence }, null, 2));
if (failures.length > 0) process.exitCode = 1;
