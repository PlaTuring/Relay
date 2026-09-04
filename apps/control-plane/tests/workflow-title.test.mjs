import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const projectRoot = path.resolve(import.meta.dirname, "..");

async function loadModule(context) {
  const buildRoot = await mkdtemp(path.join(os.tmpdir(), "h3-workflow-title-"));
  context.after(() => rm(buildRoot, { recursive: true, force: true }));
  const outfile = path.join(buildRoot, "workflow-title.mjs");
  await build({
    entryPoints: [path.join(projectRoot, "src", "main", "services", "workflow-title.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "silent"
  });
  return import(`${new URL(`file:///${outfile.replaceAll("\\", "/")}`).href}?fixture=${Date.now()}`);
}

async function loadExportModule(context) {
  const buildRoot = await mkdtemp(path.join(os.tmpdir(), "h3-workflow-export-"));
  context.after(() => rm(buildRoot, { recursive: true, force: true }));
  const outfile = path.join(buildRoot, "workflow-export.mjs");
  await build({
    entryPoints: [path.join(projectRoot, "src", "main", "services", "workflow-export.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "silent"
  });
  return import(`${new URL(`file:///${outfile.replaceAll("\\", "/")}`).href}?fixture=${Date.now()}`);
}

function project(prompt = "固定提示词") {
  return {
    prompt,
    mode: "T2V",
    firstFrameSelectionId: null,
    lastFrameSelectionId: null,
    durationSeconds: 30,
    segmentDurationSeconds: 5,
    canvas: "16:9",
    resolutionMegapixels: 0.98,
    advanced: { seed: 1, seedPolicy: "fixed", samplingProfile: "quality_20" }
  };
}

test("workflow file name is controlled by the user's Chinese name", async (context) => {
  const api = await loadModule(context);
  assert.equal(api.createUserNamedWorkflowFileName("雨夜中的发光纸鹤"), "雨夜中的发光纸鹤.json");
  assert.equal(api.createUserNamedWorkflowFileName("雨夜中的发光纸鹤.json"), "雨夜中的发光纸鹤.json");
});

test("workflow name rejects unsafe names instead of silently rewriting them", async (context) => {
  const api = await loadModule(context);
  assert.throws(() => api.createUserNamedWorkflowFileName("unsafe/path"), /不能包含/u);
  assert.throws(() => api.createUserNamedWorkflowFileName("CON"), /保留名称/u);
  assert.throws(() => api.createUserNamedWorkflowFileName("   "), /请输入/u);
});

test("exported workflow uses only the explicit user name, never the prompt", async (context) => {
  const api = await loadExportModule(context);
  const exportRoot = await mkdtemp(path.join(os.tmpdir(), "h3-named-workflow-"));
  context.after(() => rm(exportRoot, { recursive: true, force: true }));
  const fileName = await api.exportDeterministicWorkflow({
    exportDirectory: exportRoot,
    workflowName: "我的帆船工作流",
    project: project("清晨海边的白色帆船缓慢驶过镜头"),
    compiledWorkflow: { version: 0.4, nodes: [], links: [] }
  });
  assert.equal(fileName, "我的帆船工作流.json");
  assert.doesNotMatch(fileName, /清晨海边/u);
  assert.ok((await readFile(path.join(exportRoot, fileName), "utf8")).includes('"version":0.4'));
});

test("same explicit name is idempotent but never overwrites different content", async (context) => {
  const api = await loadExportModule(context);
  const exportRoot = await mkdtemp(path.join(os.tmpdir(), "h3-name-collision-"));
  context.after(() => rm(exportRoot, { recursive: true, force: true }));
  const options = {
    exportDirectory: exportRoot,
    workflowName: "固定名称",
    project: project(),
    compiledWorkflow: { version: 0.4, nodes: [], links: [] }
  };
  assert.equal(await api.exportDeterministicWorkflow(options), "固定名称.json");
  assert.equal(await api.exportDeterministicWorkflow(options), "固定名称.json");
  await assert.rejects(
    api.exportDeterministicWorkflow({
      ...options,
      compiledWorkflow: { version: 0.4, nodes: [{ id: 1 }], links: [] }
    }),
    /同名工作流已经存在/u
  );
});

test("different user workflows receive distinct stable root identities", async (context) => {
  const api = await loadExportModule(context);
  const template = {
    id: "e3f2b845-8f2c-4b5a-9caf-eac1029d3e7e",
    version: 0.4,
    nodes: [{ id: 1, widgets_values: ["同一模板"] }],
    links: [],
    extra: {}
  };

  const first = api.assignUserWorkflowIdentity({
    workflowName: "第一条工作流",
    workflow: template
  });
  const firstAgain = api.assignUserWorkflowIdentity({
    workflowName: "第一条工作流",
    workflow: template
  });
  const second = api.assignUserWorkflowIdentity({
    workflowName: "第二条工作流",
    workflow: template
  });

  assert.match(first.id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  assert.equal(first.id, firstAgain.id);
  assert.notEqual(first.id, second.id);
  assert.equal(template.id, "e3f2b845-8f2c-4b5a-9caf-eac1029d3e7e");
});
