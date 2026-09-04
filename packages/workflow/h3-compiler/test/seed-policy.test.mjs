import assert from "node:assert/strict";
import test from "node:test";

import { compileProject, deriveShotSeed, validateProjectSpec } from "../src/index.mjs";

function timedPrompt(count) {
  const shots = Array.from({ length: count }, (_, index) => index === 0
    ? "[Shot 1] Live-action opening."
    : `[Shot ${index + 1}] At 00:${String(index * 5).padStart(2, "0")}.000, live-action continuation.`
  ).join("\n");
  return `integrated_multimodal_description: ${shots}\n\noverall_soundscape: Stable room tone.\n\nnon_diegetic_music: N/A`;
}

function project({
  duration = 5,
  policy = "random_per_compile",
  seed = 1,
  shotIds,
  resolvedBaseSeed,
  resolvedShotSeeds,
} = {}) {
  return {
    schema_version: "1.0.0",
    prompt: timedPrompt(duration / 5),
    mode: "t2v",
    duration,
    segment_duration: 5,
    ...(shotIds === undefined ? {} : { shot_ids: shotIds }),
    canvas: "16:9",
    resolution_megapixels: 0.98,
    advanced: {
      seed,
      seed_policy: policy,
      sampling_profile: "quality_20",
      ...(resolvedBaseSeed === undefined ? {} : { resolved_base_seed: resolvedBaseSeed }),
      ...(resolvedShotSeeds === undefined ? {} : { resolved_shot_seeds: resolvedShotSeeds }),
    },
  };
}

function callSeeds(compilation) {
  return compilation.workflows[0].workflow.nodes
    .filter((node) => typeof node.widgets_values_named?.noise_seed === "number")
    .map((node) => node.widgets_values_named.noise_seed);
}

test("two explicit random compile resolutions differ and remain fixed inside ComfyUI", async () => {
  const first = await compileProject(project(), { generateBaseSeed: () => 101 });
  const second = await compileProject(project(), { generateBaseSeed: () => 202 });
  assert.equal(first.seed_plan.policy, "random_per_compile");
  assert.equal(first.seed_plan.base_seed, 101);
  assert.equal(second.seed_plan.base_seed, 202);
  assert.notEqual(first.seed_plan.base_seed, second.seed_plan.base_seed);
  for (const compilation of [first, second]) {
    const metadata = compilation.workflows[0].workflow.extra.relay_seed;
    assert.equal(metadata.base_seed, compilation.seed_plan.base_seed);
    assert.equal(metadata.node_control_after_generate, "fixed");
    const noise = compilation.workflows[0].workflow.definitions.subgraphs[0].nodes
      .find((node) => node.type === "RandomNoise");
    assert.equal(noise.widgets_values_named.control_after_generate, "fixed");
  }
});

test("fixed seed compiles repeat exactly without requesting entropy", async () => {
  let entropyCalls = 0;
  const fixed = project({ policy: "fixed", seed: 424242 });
  const options = { generateBaseSeed: () => { entropyCalls += 1; return 999; } };
  const first = await compileProject(fixed, options);
  const second = await compileProject(fixed, options);
  assert.equal(entropyCalls, 0);
  assert.deepEqual(first.seed_plan, second.seed_plan);
  assert.deepEqual(callSeeds(first), callSeeds(second));
  assert.equal(first.seed_plan.base_seed, 424242);
});

test("multi-shot seeds derive deterministically from base seed and stable shot IDs", async () => {
  const shotIds = ["shot-alpha0001", "shot-alpha0002", "shot-alpha0003"];
  const baseSeed = 987654321;
  const expected = shotIds.map((shotId, index) => deriveShotSeed(baseSeed, shotId, index + 1));
  const input = project({ duration: 15, policy: "fixed", seed: baseSeed, shotIds });
  const first = await compileProject(input);
  const second = await compileProject(input);
  assert.deepEqual(first.seed_plan.shots.map((shot) => shot.seed), expected);
  assert.deepEqual(second.seed_plan, first.seed_plan);
  assert.deepEqual(callSeeds(first), expected);
  assert.ok(expected.every((seed) => Number.isSafeInteger(seed) && seed >= 0));
});

test("validation and migration aliases never generate or mutate a seed", () => {
  const legacy = validateProjectSpec(project({ policy: "randomize", seed: 77 }));
  const restored = validateProjectSpec(legacy);
  assert.equal(legacy.advanced.seed, 77);
  assert.equal(legacy.advanced.seed_policy, "random_per_compile");
  assert.deepEqual(restored, legacy);
});

test("compiler rejects a forged per-shot resolution", async () => {
  await assert.rejects(
    compileProject(project({
      duration: 15,
      policy: "random_per_compile",
      shotIds: ["shot-bravo0001", "shot-bravo0002", "shot-bravo0003"],
      resolvedBaseSeed: 123,
      resolvedShotSeeds: [1, 2, 3],
    })),
    /deterministic derivation/u,
  );
});
