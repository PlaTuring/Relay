import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const projectRoot = path.resolve(import.meta.dirname, "..");

async function loadAdapter(context) {
  const buildRoot = await mkdtemp(path.join(os.tmpdir(), "h3-stream-b-adapter-"));
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
    plugins: [{
      name: "electron-utility-process-stub",
      setup(buildApi) {
        buildApi.onResolve({ filter: /^electron$/ }, () => ({
          path: "electron",
          namespace: "electron-stub"
        }));
        buildApi.onLoad({ filter: /.*/, namespace: "electron-stub" }, () => ({
          contents: "export const utilityProcess = Object.freeze({});",
          loader: "js"
        }));
      }
    }]
  });
  return import(`${new URL(`file:///${outfile.replaceAll("\\", "/")}`).href}?fixture=${Date.now()}`);
}

test("control-plane accepts the pinned compiler included_segments export field", async (context) => {
  const { createAbCliAdapter } = await loadAdapter(context);
  const adapter = createAbCliAdapter({
    appPath: projectRoot,
    resourcesPath: projectRoot,
    isPackaged: false,
    enabled: true
  });
  assert.equal(adapter.streamBAvailable, true);

  const workflow = await adapter.compileWorkflow({
    project: {
      prompt: `integrated_multimodal_description: [Shot 1] 固定回归测试：清晨海边的白色帆船缓慢驶过镜头。

[Shot 2] At 00:05.000, 帆船继续前进。

[Shot 3] At 00:10.000, 镜头靠近船帆。

[Shot 4] At 00:15.000, 海浪从船侧经过。

[Shot 5] At 00:20.000, 帆船驶向晨光。

[Shot 6] At 00:25.000, 镜头缓慢后拉。

overall_soundscape: 轻微海浪声。

non_diegetic_music: 无。`,
      mode: "T2V",
      firstFrameSelectionId: null,
      lastFrameSelectionId: null,
      durationSeconds: 30,
      segmentDurationSeconds: 5,
      canvas: "9:16",
      resolutionMegapixels: 0.4,
      advanced: {
        seed: 1,
        seedPolicy: "fixed",
        samplingProfile: "quality_20"
      }
    },
    resolvedFrames: { first: null, last: null }
  });

  assert.equal(workflow?.version, 0.4);
  assert.ok(Array.isArray(workflow?.nodes));
  assert.equal(workflow.nodes.filter((node) => node.type === "SaveVideo").length, 1);
  assert.equal(workflow.nodes.filter((node) => node.type === "Video Slice").length, 1);
});
