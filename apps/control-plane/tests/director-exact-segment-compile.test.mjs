import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { compileProject } from "../../../packages/workflow/h3-compiler/src/compiler.mjs";
import { createSegmentPlan, validateProjectSpec } from "../../../packages/workflow/h3-compiler/src/project-spec.mjs";

const root = resolve(import.meta.dirname, "..");

const prompt = `integrated_multimodal_description: [Shot 1] A courier enters a quiet station.

[Shot 2] At 00:05.000, the camera follows the courier along the platform.

[Shot 3] At 00:15.000, the train arrives and the final composition holds until 00:30.000.

overall_soundscape: Footsteps, rain, and a distant train.

non_diegetic_music: A restrained electronic pulse.`;

test("mixed Director shot durations survive validation and reach the real H3 segment graph", async () => {
  const project = validateProjectSpec({
    schema_version: "1.0.0",
    prompt,
    mode: "t2v",
    duration: 30,
    segment_duration: 5,
    segment_durations: [5, 10, 15],
    canvas: "16:9",
    resolution_megapixels: 0.4,
    advanced: { seed: 1, seed_policy: "fixed", sampling_profile: "quality_20" }
  });
  const plan = createSegmentPlan(project);
  assert.deepEqual(plan.segment_durations, [5, 10, 15]);
  assert.deepEqual(plan.segments.map((segment) => segment.duration), [5, 10, 15]);
  assert.equal(plan.total_duration, 30);
  assert.equal(plan.segment_count, 3);

  const compilation = await compileProject(project);
  assert.deepEqual(compilation.plan.segments.map((segment) => segment.duration), [5, 10, 15]);
  assert.equal(compilation.plan.single_workflow_dag, true);
  assert.equal(compilation.workflows.length, 1);
  assert.equal(compilation.workflows[0].included_segments.length, 3);
});

test("renderer and closed adapter transport the exact Director duration list", async () => {
  const [renderer, adapter, contract] = await Promise.all([
    readFile(resolve(root, "src/renderer/index.ts"), "utf8"),
    readFile(resolve(root, "src/main/services/ab-cli-adapter.ts"), "utf8"),
    readFile(resolve(root, "src/shared/ipc-contract.ts"), "utf8")
  ]);
  assert.match(contract, /segmentDurationsSeconds\?: readonly SegmentDurationSeconds\[\]/u);
  assert.match(renderer, /const segmentDurationsSeconds = Object\.freeze/u);
  assert.match(renderer, /project = submittedDirectorCompilation\.project/u);
  assert.match(adapter, /segment_durations: request\.project\.segmentDurationsSeconds/u);
  assert.doesNotMatch([renderer, adapter].join("\n"), /\/prompt|queuePrompt|submitPrompt/u);
});

test("explicit mixed segments fail closed when their sum or Ref2VA cardinality is invalid", () => {
  assert.throws(() => validateProjectSpec({
    schema_version: "1.0.0",
    prompt: "one shot",
    mode: "t2v",
    duration: 30,
    segment_duration: 5,
    segment_durations: [5, 10],
    canvas: "16:9",
    resolution_megapixels: 0.4
  }), /Segment durations must sum/u);

  assert.throws(() => validateProjectSpec({
    schema_version: "1.0.0",
    prompt: "reference",
    mode: "ref2va",
    duration: 10,
    segment_duration: 5,
    segment_durations: [5, 5],
    canvas: "16:9",
    resolution_megapixels: 0.4,
    endpoints: { reference_images: ["input/reference.png"] }
  }), /Ref2VA supports exactly one/u);
});
