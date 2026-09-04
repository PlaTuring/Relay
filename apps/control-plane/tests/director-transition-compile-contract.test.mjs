import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const projectRoot = path.resolve(import.meta.dirname, "..");

async function loadModule(context, entry, electronStub = false) {
  const buildRoot = await mkdtemp(path.join(os.tmpdir(), "relay-transition-contract-"));
  context.after(() => rm(buildRoot, { recursive: true, force: true }));
  const outfile = path.join(buildRoot, "module.mjs");
  await build({
    entryPoints: [path.join(projectRoot, entry)],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "silent",
    plugins: electronStub ? [{
      name: "electron-utility-process-stub",
      setup(buildApi) {
        buildApi.onResolve({ filter: /^electron$/ }, () => ({
          path: "electron",
          namespace: "electron-stub",
        }));
        buildApi.onLoad({ filter: /.*/, namespace: "electron-stub" }, () => ({
          contents: "export const utilityProcess = Object.freeze({});",
          loader: "js",
        }));
      },
    }] : [],
  });
  return import(`${new URL(`file:///${outfile.replaceAll("\\", "/")}`).href}?${Date.now()}-${Math.random()}`);
}

const shotIds = Object.freeze([
  "shot-transition01",
  "shot-transition02",
  "shot-transition03",
]);

function project(overrides = {}) {
  return {
    prompt: `integrated_multimodal_description: [Shot 1] Opening frame.

[Shot 2] At 00:05.000, second frame.

[Shot 3] At 00:10.000, third frame.

overall_soundscape: Room tone.

non_diegetic_music: N/A`,
    mode: "T2V",
    firstFrameSelectionId: null,
    lastFrameSelectionId: null,
    durationSeconds: 15,
    segmentDurationSeconds: 5,
    segmentDurationsSeconds: [5, 5, 5],
    segmentShotIds: shotIds,
    canvas: "16:9",
    resolutionMegapixels: 0.4,
    advanced: {
      seed: 117117,
      seedPolicy: "fixed",
      samplingProfile: "quality_20",
    },
    ...overrides,
  };
}

test("ProjectSpec accepts one proven transition for every adjacent Director shot", async (context) => {
  const { validateProjectSpec } = await loadModule(context, "src/main/services/validation.ts");
  const transitions = ["hard_cut", "tail_frame_continuation"];
  const validated = validateProjectSpec(project({ segmentTransitions: transitions }));

  assert.deepEqual(validated.segmentTransitions, transitions);
  assert.equal(Object.isFrozen(validated.segmentTransitions), true);
});

test("ProjectSpec rejects transition length drift and unknown transition values", async (context) => {
  const { validateProjectSpec } = await loadModule(context, "src/main/services/validation.ts");

  assert.throws(
    () => validateProjectSpec(project({ segmentTransitions: ["hard_cut"] })),
    /逐镜衔接必须与相邻镜头一一对应/u,
  );
  assert.throws(
    () => validateProjectSpec(project({
      segmentTransitions: ["hard_cut", "tail_frame_continuation", "hard_cut"],
    })),
    /逐镜衔接必须与相邻镜头一一对应/u,
  );
  assert.throws(
    () => validateProjectSpec(project({ segmentTransitions: ["hard_cut", "dissolve"] })),
    /只能使用硬切或尾帧延续/u,
  );
});

test("single-shot ProjectSpec permits an empty transition plan or omission only", async (context) => {
  const { validateProjectSpec } = await loadModule(context, "src/main/services/validation.ts");
  const single = project({
    durationSeconds: 5,
    segmentDurationsSeconds: [5],
    segmentShotIds: ["shot-transition01"],
    segmentTransitions: [],
  });
  const validated = validateProjectSpec(single);
  assert.deepEqual(validated.segmentTransitions, []);

  const omitted = { ...single };
  delete omitted.segmentTransitions;
  assert.equal(Object.hasOwn(validateProjectSpec(omitted), "segmentTransitions"), false);
  assert.throws(
    () => validateProjectSpec({ ...single, segmentTransitions: ["hard_cut"] }),
    /逐镜衔接必须与相邻镜头一一对应/u,
  );
});

async function createCapturingCompiler(context) {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), "relay-transition-compiler-"));
  context.after(() => rm(runtimeRoot, { recursive: true, force: true }));
  const compilerDirectory = path.join(runtimeRoot, "packages", "workflow", "h3-compiler", "bin");
  await mkdir(compilerDirectory, { recursive: true });
  const compilerPath = path.join(compilerDirectory, "h3-compile.mjs");
  await writeFile(compilerPath, `
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const projectPath = process.argv[process.argv.indexOf("--project") + 1];
const outputDirectory = process.argv[process.argv.indexOf("--output-dir") + 1];
const project = JSON.parse(await readFile(projectPath, "utf8"));
const fileName = "captured-transition-workflow.json";
const workflowPath = path.join(outputDirectory, fileName);
const workflow = {
  version: 0.4,
  extra: {
    captured_project: project,
    relay_seed: {
      contract_id: "relay.seed-plan",
      schema_version: 1,
      policy: project.advanced.seed_policy,
      base_seed: project.advanced.resolved_base_seed,
      node_control_after_generate: "fixed",
      shots: project.advanced.resolved_shot_seeds.map((seed, index) => ({
        shot_id: project.shot_ids[index],
        ordinal: index + 1,
        seed,
      })),
    },
  },
};
const bytes = Buffer.from(JSON.stringify(workflow), "utf8");
await writeFile(workflowPath, bytes);
process.stdout.write(JSON.stringify({
  ok: true,
  compiler_version: "transition-fixture",
  template_revision: "transition-fixture",
  status: "compiled",
  exported: [{
    segment: 1,
    included_segments: project.shot_ids.map((_, index) => index + 1),
    file_name: fileName,
    workflow_path: workflowPath,
    workflow_sha256: createHash("sha256").update(bytes).digest("hex"),
  }],
  handoff: {
    capability: "EXPORT_ONLY",
    status: "exported",
    user_action: "open",
    automatic_execution: false,
    automatic_submission: false,
    auto_run: false,
  },
}));
`, "utf8");
  return runtimeRoot;
}

test("adapter projects validated segmentTransitions verbatim to compiler project.transitions", async (context) => {
  const [{ createAbCliAdapter }, runtimeRoot] = await Promise.all([
    loadModule(context, "src/main/services/ab-cli-adapter.ts", true),
    createCapturingCompiler(context),
  ]);
  const adapter = createAbCliAdapter({
    appPath: path.join(runtimeRoot, "apps", "control-plane"),
    resourcesPath: runtimeRoot,
    isPackaged: false,
    enabled: true,
  });
  const transitions = Object.freeze(["hard_cut", "tail_frame_continuation"]);
  const workflow = await adapter.compileWorkflow({
    project: project({ segmentTransitions: transitions }),
    resolvedFrames: { first: null, last: null },
  });

  assert.deepEqual(workflow.extra.captured_project.transitions, transitions);
  assert.equal(Object.hasOwn(workflow.extra.captured_project, "segmentTransitions"), false);
});
