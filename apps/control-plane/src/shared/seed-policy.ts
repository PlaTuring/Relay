/**
 * Relay-local seed policy contract.
 *
 * Randomness is supplied lazily by an explicit compile caller. Persistence,
 * rendering, navigation, migration and autosave use only the normalisation and
 * deterministic derivation helpers below and therefore cannot advance a seed.
 */

export const RELAY_SEED_MAX = Number.MAX_SAFE_INTEGER;
export const RELAY_DEFAULT_SEED_POLICY = "random_per_compile" as const;

export type RelaySeedPolicy = "random_per_compile" | "fixed";

export interface RelayResolvedShotSeed {
  /** Stable Director shot ID, or null when a quick project uses its ordinal. */
  readonly shotId: string | null;
  /** One-based, stable compile-plan ordinal. */
  readonly ordinal: number;
  readonly seed: number;
}

export interface RelayResolvedSeedPlan {
  readonly contractId: "relay.seed-plan";
  readonly schemaVersion: 1;
  readonly policy: RelaySeedPolicy;
  readonly baseSeed: number;
  /** ComfyUI must not mutate the already-resolved Relay seed after Run. */
  readonly nodeControlAfterGenerate: "fixed";
  readonly shots: readonly RelayResolvedShotSeed[];
}

export interface ResolveRelaySeedPlanInput {
  readonly policy: RelaySeedPolicy;
  readonly fixedSeed: number;
  readonly shotIds: readonly (string | null)[];
  /** Invoked only for random_per_compile. */
  readonly entropy?: () => Uint8Array;
  /** Prevents two adjacent random compile transactions from resolving equally. */
  readonly previousRandomBaseSeed?: number | null;
}

const SAFE_SEED_MASK = (1n << 53n) - 1n;
const FNV_OFFSET_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const UINT64_MASK = (1n << 64n) - 1n;
const STABLE_SHOT_ID = /^shot-[a-z0-9][a-z0-9-]{7,127}$/u;

function immutable<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) immutable(child);
    Object.freeze(value);
  }
  return value;
}

export function isRelaySafeSeed(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= RELAY_SEED_MAX;
}

/**
 * Persistence migration accepts Alpha 29's old `randomize` spelling but emits
 * only the new two-value contract. Missing policies adopt the recommended
 * random-per-compile default.
 */
export function normalizeRelaySeedPolicy(value: unknown): RelaySeedPolicy {
  if (value === "fixed") return "fixed";
  if (value === "random_per_compile" || value === "randomize") return "random_per_compile";
  return RELAY_DEFAULT_SEED_POLICY;
}

function entropySeed(bytes: Uint8Array): number {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 8) {
    throw new TypeError("Compile seed entropy must contain at least eight local bytes.");
  }
  let value = 0n;
  for (let index = 0; index < 8; index += 1) {
    value = (value << 8n) | BigInt(bytes[index] ?? 0);
  }
  return Number(value & SAFE_SEED_MASK);
}

function stableSeedIdentity(shotId: string | null, ordinal: number): string {
  if (shotId !== null) {
    if (!STABLE_SHOT_ID.test(shotId)) throw new TypeError("Resolved shot seed requires a stable Relay shot ID.");
    return shotId;
  }
  return `ordinal-${ordinal}`;
}

function fnv1a64(value: string): bigint {
  let hash = FNV_OFFSET_64;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME_64) & UINT64_MASK;
  }
  return hash;
}

export function deriveRelayShotSeed(baseSeed: number, shotId: string | null, ordinal: number): number {
  if (!isRelaySafeSeed(baseSeed)) throw new TypeError("Base seed must be a non-negative JSON-safe integer.");
  if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > 36) {
    throw new TypeError("Shot seed ordinal must be between 1 and 36.");
  }
  const identity = stableSeedIdentity(shotId, ordinal);
  return Number(fnv1a64(`relay-shot-seed-v1\0${baseSeed}\0${identity}`) & SAFE_SEED_MASK);
}

function deterministicShotSeeds(
  baseSeed: number,
  shotIds: readonly (string | null)[]
): readonly RelayResolvedShotSeed[] {
  if (shotIds.length < 1 || shotIds.length > 36) throw new TypeError("A compile seed plan requires 1 to 36 shots.");
  const stableIds = shotIds.filter((value): value is string => value !== null);
  if (new Set(stableIds).size !== stableIds.length) throw new TypeError("Compile shot IDs must be unique.");
  const used = new Set<number>();
  const shots = shotIds.map((shotId, index): RelayResolvedShotSeed => {
    const ordinal = index + 1;
    let seed = shotIds.length === 1 ? baseSeed : deriveRelayShotSeed(baseSeed, shotId, ordinal);
    // A deterministic linear probe makes the already-tiny hash collision case
    // explicit and guarantees distinct node seeds inside one multi-shot graph.
    while (used.has(seed)) seed = seed === RELAY_SEED_MAX ? 0 : seed + 1;
    used.add(seed);
    return { shotId, ordinal, seed };
  });
  return immutable(shots);
}

export function resolveRelaySeedPlan(input: ResolveRelaySeedPlanInput): RelayResolvedSeedPlan {
  if (!isRelaySafeSeed(input.fixedSeed)) throw new TypeError("Fixed seed must be a non-negative JSON-safe integer.");
  const policy = normalizeRelaySeedPolicy(input.policy);
  let baseSeed = input.fixedSeed;
  if (policy === "random_per_compile") {
    if (input.entropy === undefined) throw new TypeError("Random compile seed resolution requires local entropy.");
    baseSeed = entropySeed(input.entropy());
    if (input.previousRandomBaseSeed !== undefined && input.previousRandomBaseSeed !== null) {
      if (!isRelaySafeSeed(input.previousRandomBaseSeed)) throw new TypeError("Previous random seed is invalid.");
      if (baseSeed === input.previousRandomBaseSeed) {
        baseSeed = baseSeed === RELAY_SEED_MAX ? 0 : baseSeed + 1;
      }
    }
  }
  return immutable({
    contractId: "relay.seed-plan" as const,
    schemaVersion: 1 as const,
    policy,
    baseSeed,
    nodeControlAfterGenerate: "fixed" as const,
    shots: deterministicShotSeeds(baseSeed, input.shotIds)
  });
}

export function normalizeRelayResolvedSeedPlan(value: unknown): RelayResolvedSeedPlan {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Resolved seed plan must be an object.");
  }
  const source = value as Record<string, unknown>;
  if (source.contractId !== "relay.seed-plan" || source.schemaVersion !== 1 || source.nodeControlAfterGenerate !== "fixed") {
    throw new TypeError("Resolved seed plan contract is unsupported.");
  }
  const policy = normalizeRelaySeedPolicy(source.policy);
  if (!isRelaySafeSeed(source.baseSeed) || !Array.isArray(source.shots)) {
    throw new TypeError("Resolved seed plan base seed or shots are invalid.");
  }
  const normalizedShots = source.shots.map((value): RelayResolvedShotSeed => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new TypeError("Resolved shot seed must be an object.");
    }
    const shot = value as Record<string, unknown>;
    if (shot.shotId !== null && (typeof shot.shotId !== "string" || !STABLE_SHOT_ID.test(shot.shotId))) {
      throw new TypeError("Resolved shot seed ID is invalid.");
    }
    if (!Number.isSafeInteger(shot.ordinal) || Number(shot.ordinal) < 1 || Number(shot.ordinal) > 36 || !isRelaySafeSeed(shot.seed)) {
      throw new TypeError("Resolved shot seed ordinal or value is invalid.");
    }
    return { shotId: shot.shotId as string | null, ordinal: Number(shot.ordinal), seed: shot.seed };
  });
  const expected = deterministicShotSeeds(source.baseSeed, normalizedShots.map((shot) => shot.shotId));
  if (expected.length !== normalizedShots.length || expected.some((shot, index) => (
    shot.ordinal !== normalizedShots[index]?.ordinal || shot.seed !== normalizedShots[index]?.seed
  ))) {
    throw new TypeError("Resolved shot seeds do not match the deterministic base-seed derivation.");
  }
  return immutable({
    contractId: "relay.seed-plan" as const,
    schemaVersion: 1 as const,
    policy,
    baseSeed: source.baseSeed,
    nodeControlAfterGenerate: "fixed" as const,
    shots: normalizedShots
  });
}

export function relaySeedPlansEqual(left: RelayResolvedSeedPlan, right: RelayResolvedSeedPlan): boolean {
  return left.contractId === right.contractId
    && left.schemaVersion === right.schemaVersion
    && left.policy === right.policy
    && left.baseSeed === right.baseSeed
    && left.nodeControlAfterGenerate === right.nodeControlAfterGenerate
    && left.shots.length === right.shots.length
    && left.shots.every((shot, index) => {
      const other = right.shots[index];
      return other !== undefined && shot.shotId === other.shotId && shot.ordinal === other.ordinal && shot.seed === other.seed;
    });
}

export function relayCompileShotIds(input: {
  readonly durationSeconds: number;
  readonly segmentDurationSeconds: number;
  readonly segmentDurationsSeconds?: readonly number[];
  readonly segmentShotIds?: readonly string[];
}): readonly (string | null)[] {
  const count = input.segmentDurationsSeconds?.length
    ?? Math.ceil(input.durationSeconds / input.segmentDurationSeconds);
  if (!Number.isSafeInteger(count) || count < 1 || count > 36) throw new TypeError("Compile shot count is invalid.");
  if (input.segmentShotIds !== undefined) {
    if (input.segmentShotIds.length !== count) throw new TypeError("Compile shot IDs must match the segment plan.");
    return immutable([...input.segmentShotIds]);
  }
  return immutable(Array.from({ length: count }, () => null));
}

export function relayWorkflowSeedPlan(value: unknown): RelayResolvedSeedPlan | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const extra = (value as Record<string, unknown>).extra;
  if (extra === null || typeof extra !== "object" || Array.isArray(extra)) return null;
  const metadata = (extra as Record<string, unknown>).relay_seed;
  if (metadata === undefined) return null;
  const source = metadata !== null && typeof metadata === "object" && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : null;
  if (source === null) throw new TypeError("Workflow seed metadata is invalid.");
  return normalizeRelayResolvedSeedPlan({
    contractId: source.contract_id,
    schemaVersion: source.schema_version,
    policy: source.policy,
    baseSeed: source.base_seed,
    nodeControlAfterGenerate: source.node_control_after_generate,
    shots: Array.isArray(source.shots) ? source.shots.map((value) => {
      const shot = value !== null && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
      return { shotId: shot.shot_id, ordinal: shot.ordinal, seed: shot.seed };
    }) : source.shots
  });
}
