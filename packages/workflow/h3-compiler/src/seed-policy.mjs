import { randomBytes } from "node:crypto";

import { fail } from "./errors.mjs";

export const SEED_MAX = Number.MAX_SAFE_INTEGER;
export const DEFAULT_SEED_POLICY = "random_per_compile";

const SAFE_SEED_MASK = (1n << 53n) - 1n;
const FNV_OFFSET_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const UINT64_MASK = (1n << 64n) - 1n;
const STABLE_SHOT_ID = /^shot-[a-z0-9][a-z0-9-]{7,127}$/u;

let previousLocallyGeneratedBaseSeed = null;

export function isSafeSeed(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= SEED_MAX;
}

export function normalizeSeedPolicy(value) {
  if (value === "fixed") return "fixed";
  if (value === "random_per_compile" || value === "randomize") return "random_per_compile";
  return null;
}

function baseSeedFromEntropy(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 8) {
    fail("PROJECT.SEED_ENTROPY", "Local compile seed entropy is invalid.", "/advanced/seed_policy");
  }
  let value = 0n;
  for (let index = 0; index < 8; index += 1) value = (value << 8n) | BigInt(bytes[index] ?? 0);
  return Number(value & SAFE_SEED_MASK);
}

function fnv1a64(value) {
  let hash = FNV_OFFSET_64;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME_64) & UINT64_MASK;
  }
  return hash;
}

function seedIdentity(shotId, ordinal) {
  if (shotId !== null) {
    if (!STABLE_SHOT_ID.test(shotId)) fail("PROJECT.SHOT_ID", "Shot ID is not a stable Relay shot ID.", "/shot_ids");
    return shotId;
  }
  return `ordinal-${ordinal}`;
}

export function deriveShotSeed(baseSeed, shotId, ordinal) {
  if (!isSafeSeed(baseSeed)) fail("PROJECT.SEED", "Base seed must be a non-negative JSON-safe integer.", "/advanced/seed");
  if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > 36) {
    fail("PROJECT.SHOT_ORDINAL", "Shot ordinal must be between 1 and 36.", "/shot_ids");
  }
  return Number(fnv1a64(`relay-shot-seed-v1\0${baseSeed}\0${seedIdentity(shotId, ordinal)}`) & SAFE_SEED_MASK);
}

function shotSeedPlan(baseSeed, shotIds) {
  const used = new Set();
  return Object.freeze(shotIds.map((shotId, index) => {
    const ordinal = index + 1;
    let seed = shotIds.length === 1 ? baseSeed : deriveShotSeed(baseSeed, shotId, ordinal);
    while (used.has(seed)) seed = seed === SEED_MAX ? 0 : seed + 1;
    used.add(seed);
    return Object.freeze({ shot_id: shotId, ordinal, seed });
  }));
}

export function resolveCompileSeedPlan(project, plan, options = {}) {
  const policy = normalizeSeedPolicy(project.advanced.seed_policy);
  if (policy === null) fail("PROJECT.SEED_POLICY", "Seed policy must be fixed or random_per_compile.", "/advanced/seed_policy");
  const shotIds = project.shot_ids ?? Object.freeze(Array.from({ length: plan.segment_count }, () => null));
  if (!Array.isArray(shotIds) || shotIds.length !== plan.segment_count) {
    fail("PROJECT.SHOT_IDS", "Shot IDs must match the exact segment plan.", "/shot_ids");
  }
  let baseSeed = project.advanced.resolved_base_seed;
  if (baseSeed === undefined) {
    if (policy === "fixed") {
      baseSeed = project.advanced.seed;
    } else {
      const generateBaseSeed = options.generateBaseSeed ?? (() => baseSeedFromEntropy(randomBytes(8)));
      baseSeed = generateBaseSeed();
      if (!isSafeSeed(baseSeed)) fail("PROJECT.SEED", "Generated base seed is outside the certified JSON-safe range.", "/advanced/seed");
      const previous = options.previousRandomBaseSeed ?? previousLocallyGeneratedBaseSeed;
      if (baseSeed === previous) baseSeed = baseSeed === SEED_MAX ? 0 : baseSeed + 1;
      previousLocallyGeneratedBaseSeed = baseSeed;
    }
  }
  if (!isSafeSeed(baseSeed)) fail("PROJECT.SEED", "Resolved base seed is outside the certified JSON-safe range.", "/advanced/resolved_base_seed");
  if (policy === "fixed" && baseSeed !== project.advanced.seed) {
    fail("PROJECT.SEED_RESOLUTION", "Fixed seed resolution must equal the selected fixed seed.", "/advanced/resolved_base_seed");
  }
  const shots = shotSeedPlan(baseSeed, shotIds);
  const supplied = project.advanced.resolved_shot_seeds;
  if (supplied !== undefined && (supplied.length !== shots.length || supplied.some((seed, index) => seed !== shots[index]?.seed))) {
    fail("PROJECT.SEED_RESOLUTION", "Resolved shot seeds do not match deterministic derivation.", "/advanced/resolved_shot_seeds");
  }
  return Object.freeze({
    contract_id: "relay.seed-plan",
    schema_version: 1,
    policy,
    base_seed: baseSeed,
    node_control_after_generate: "fixed",
    shots,
  });
}

export function attachSeedPlan(workflow, seedPlan) {
  if (!workflow.extra || typeof workflow.extra !== "object" || Array.isArray(workflow.extra)) workflow.extra = {};
  workflow.extra.relay_seed = structuredClone(seedPlan);
}
