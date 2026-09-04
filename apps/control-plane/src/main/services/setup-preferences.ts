import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type {
  ComponentId,
  ScanDetectedLocations
} from "../../shared/ipc-contract.js";
import { validateInstallRoot } from "./validation.js";

export interface SetupPreferences extends ScanDetectedLocations {
  readonly installRoot: string;
  readonly setupComplete: boolean;
  readonly completedComponents: readonly ComponentId[];
  readonly completedInstallationId: string | null;
}

export interface PersistedComponentInspection {
  readonly verifiedComponents: readonly ComponentId[];
  readonly foundComponents: readonly ComponentId[];
  readonly claimedComponents: readonly ComponentId[];
  readonly completedComponents: readonly ComponentId[];
  readonly completedInstallationId: string | null;
  readonly recoveredModelRoot: string | null;
  readonly vramBytes: number | null;
  readonly setupComplete: boolean;
}

const FILE_NAME = "setup-locations.v1.json";
const OPERATION_ID = /^install-[0-9a-f]{24}$/u;
const COMPONENT_IDS = new Set<ComponentId>([
  "fl2va_base",
  "turbo_acceleration_recommended",
  "ref2va_optional",
  "pyav_required",
  "ffmpeg_long_video_optional",
  "comfyui_desktop_optional"
]);

interface ArtifactIdentity {
  readonly id: string;
  readonly expectedByteLength: number;
  readonly expectedSha256: string;
  readonly relativeModelPath?: string;
}

const ARTIFACTS = Object.freeze({
  comfyPortable: Object.freeze({
    id: "comfy-portable-nvidia-0.34.0",
    expectedByteLength: 2_146_721_943,
    expectedSha256: "ed57cc6b19ae3d83add1ecebfdd56b25e04e0008cf0fe9af43a4ad8797e2a24c"
  }),
  fl2va: Object.freeze({
    id: "h3-fl2va-int8-convrot",
    expectedByteLength: 20_970_379_616,
    expectedSha256: "e889202c41dafb67b10d67b97f0d8541508036a6090af23425a5c2615d03c47a",
    relativeModelPath: "diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors"
  }),
  ref2va: Object.freeze({
    id: "h3-ref2va-int8-convrot",
    expectedByteLength: 20_970_379_616,
    expectedSha256: "9255f52b6677845ad238f20dfaafa94727053694127ab7f255c048f0f9365779",
    relativeModelPath: "diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors"
  }),
  textEncoder: Object.freeze({
    id: "h3-qwen3vl-32b-nvfp4-awq",
    expectedByteLength: 15_687_142_551,
    expectedSha256: "35a88d51044231fe332301d7a62aa81e3f2cba62febeb446e2c1e3e0ef76f2c6",
    relativeModelPath: "text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"
  }),
  videoVae: Object.freeze({
    id: "h3-video-vae-fp16",
    expectedByteLength: 5_207_808_496,
    expectedSha256: "7c1f131492e7eddacaac9069a61b81bdd39de5cc96561e677c5eab1cdce5e522",
    relativeModelPath: "vae/minimax_h3_video_vae_fp16.safetensors"
  }),
  audioVae: Object.freeze({
    id: "h3-audio-vae-fp32",
    expectedByteLength: 605_254_808,
    expectedSha256: "8e505d95dd1561d47abd43d4238fd40d9bb1ae9e147ed0a4cba778d76ae4db48",
    relativeModelPath: "vae/minimax_h3_audio_vae_fp32.safetensors"
  }),
  turbo: Object.freeze({
    id: "h3-fl2v-turbo-8step",
    expectedByteLength: 1_956_193_000,
    expectedSha256: "2339acdf19bfe123f46b971ea35d367a84adb85de43627e1eceafa5a5b2b111e",
    relativeModelPath: "loras/minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors"
  }),
  ffmpeg: Object.freeze({
    id: "ffmpeg-btbn-n9.0.1-6-g9d4ca21220-win64-gpl-9.0",
    expectedByteLength: 169_203_574,
    expectedSha256: "5bbf30d81a46e4ea3bf692da189141e88a269252518e9202b95fedec3996b93e"
  })
} satisfies Record<string, ArtifactIdentity>);

const BASE_MODEL_ARTIFACTS = Object.freeze([
  ARTIFACTS.fl2va,
  ARTIFACTS.textEncoder,
  ARTIFACTS.videoVae,
  ARTIFACTS.audioVae
]);

const A3_COMPONENTS = new Set([
  "comfy-portable",
  "comfy-desktop",
  "ffmpeg-managed",
  "fl2va-base",
  "ref2va-addon",
  "fl2v-turbo",
  "ref2v-turbo"
]);

const A3_PUBLIC_COMPONENT = Object.freeze<Partial<Record<string, ComponentId>>>({
  "comfy-portable": "pyav_required",
  "comfy-desktop": "comfyui_desktop_optional",
  "ffmpeg-managed": "ffmpeg_long_video_optional",
  "fl2va-base": "fl2va_base",
  "ref2va-addon": "ref2va_optional",
  "fl2v-turbo": "turbo_acceleration_recommended"
});

const A3_REQUIRED_ARTIFACTS = Object.freeze<Record<string, readonly string[]>>({
  "comfy-portable": Object.freeze([ARTIFACTS.comfyPortable.id]),
  "comfy-desktop": Object.freeze(["comfy-desktop-installer-1.0.46-x64"]),
  "ffmpeg-managed": Object.freeze([ARTIFACTS.ffmpeg.id]),
  "fl2va-base": Object.freeze(BASE_MODEL_ARTIFACTS.map((artifact) => artifact.id)),
  "ref2va-addon": Object.freeze([
    ARTIFACTS.ref2va.id,
    ARTIFACTS.textEncoder.id,
    ARTIFACTS.videoVae.id,
    ARTIFACTS.audioVae.id
  ]),
  "fl2v-turbo": Object.freeze([ARTIFACTS.turbo.id]),
  "ref2v-turbo": Object.freeze(["h3-ref2v-turbo-4step"])
});

function preferencesPath(userDataPath: string, fileName = FILE_NAME): string {
  return join(userDataPath, fileName);
}

function optionalRoot(value: unknown): string | null {
  return value === null ? null : validateInstallRoot(value);
}

function validSource(value: unknown): value is SetupPreferences["comfySource"] {
  return value === "explicit" || value === "detected" || value === "missing";
}

function parseCompletedComponents(value: unknown): readonly ComponentId[] | null {
  if (!Array.isArray(value) || value.length > COMPONENT_IDS.size) return null;
  const result: ComponentId[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !COMPONENT_IDS.has(item as ComponentId)) return null;
    result.push(item as ComponentId);
  }
  if (new Set(result).size !== result.length) return null;
  return Object.freeze(result);
}

function parseOperationId(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" && OPERATION_ID.test(value) ? value : undefined;
}

function parseLocations(record: Record<string, unknown>): Omit<SetupPreferences, "setupComplete" | "completedComponents" | "completedInstallationId"> | null {
  const comfyUiRoot = optionalRoot(record.comfyUiRoot);
  const modelRoot = optionalRoot(record.modelRoot);
  if (
    !validSource(record.comfySource) ||
    !validSource(record.modelSource) ||
    (record.comfySource === "missing") !== (comfyUiRoot === null) ||
    (record.modelSource === "missing") !== (modelRoot === null)
  ) return null;
  return Object.freeze({
    installRoot: validateInstallRoot(record.installRoot),
    comfyUiRoot,
    modelRoot,
    comfySource: record.comfySource,
    modelSource: record.modelSource
  });
}

export async function loadSetupPreferences(userDataPath: string, fileName = FILE_NAME): Promise<SetupPreferences | null> {
  try {
    const value: unknown = JSON.parse(await readFile(preferencesPath(userDataPath, fileName), "utf8"));
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const commonKeys = ["comfySource", "comfyUiRoot", "installRoot", "modelRoot", "modelSource", "version"];
    const expected = record.version === 1
      ? commonKeys
      : record.version === 2
        ? [...commonKeys, "setupComplete", "completedComponents", "completedInstallationId"]
        : [];
    const keys = Object.keys(record).sort();
    const sortedExpected = expected.sort();
    if (keys.length !== sortedExpected.length || keys.some((key, index) => key !== sortedExpected[index])) return null;
    const locations = parseLocations(record);
    if (locations === null) return null;
    if (record.version === 1) {
      return Object.freeze({
        ...locations,
        setupComplete: false,
        completedComponents: Object.freeze([]),
        completedInstallationId: null
      });
    }
    const completedComponents = parseCompletedComponents(record.completedComponents);
    const completedInstallationId = parseOperationId(record.completedInstallationId);
    if (
      typeof record.setupComplete !== "boolean" ||
      completedComponents === null ||
      completedInstallationId === undefined
    ) return null;
    return Object.freeze({
      ...locations,
      setupComplete: record.setupComplete,
      completedComponents,
      completedInstallationId
    });
  } catch {
    return null;
  }
}

export async function saveSetupPreferences(userDataPath: string, value: SetupPreferences, fileName = FILE_NAME): Promise<boolean> {
  const destination = preferencesPath(userDataPath, fileName);
  const temporary = `${destination}.${process.pid}.new`;
  try {
    const completedComponents = parseCompletedComponents(value.completedComponents);
    const completedInstallationId = parseOperationId(value.completedInstallationId);
    const locations = parseLocations(value as unknown as Record<string, unknown>);
    if (
      completedComponents === null ||
      completedInstallationId === undefined ||
      locations === null ||
      typeof value.setupComplete !== "boolean"
    ) return false;
    await mkdir(dirname(destination), { recursive: true });
    await rm(temporary, { force: true });
    await writeFile(
      temporary,
      `${JSON.stringify({
        version: 2,
        ...locations,
        setupComplete: value.setupComplete,
        completedComponents,
        completedInstallationId
      })}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 }
    );
    await rename(temporary, destination);
    return true;
  } catch {
    await rm(temporary, { force: true }).catch(() => undefined);
    return false;
  }
}

function samePath(left: string, right: string): boolean {
  return resolve(left).toLocaleLowerCase("en-US") === resolve(right).toLocaleLowerCase("en-US");
}

async function directMetadata(path: string, kind: "file" | "directory", expectedByteLength?: number): Promise<boolean> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) return false;
    if (kind === "file" ? !metadata.isFile() : !metadata.isDirectory()) return false;
    if (expectedByteLength !== undefined && metadata.size !== expectedByteLength) return false;
    return samePath(await realpath(path), path);
  } catch {
    return false;
  }
}

export async function verifySavedDirectory(path: string | null): Promise<string | null> {
  return path !== null && await directMetadata(path, "directory") ? path : null;
}

interface ManifestEntry {
  readonly id: string;
  readonly expected_byte_length: number;
  readonly expected_sha256: string;
}

async function readManagedManifest(installRoot: string): Promise<ReadonlyMap<string, ManifestEntry>> {
  try {
    const manifestPath = join(installRoot, ".minimax-h3", "managed-manifest.json");
    if (!await directMetadata(manifestPath, "file")) return new Map();
    const value: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
    if (value === null || typeof value !== "object" || Array.isArray(value)) return new Map();
    const artifacts = (value as Record<string, unknown>).artifacts;
    if (!Array.isArray(artifacts) || artifacts.length > 64) return new Map();
    const entries = new Map<string, ManifestEntry>();
    for (const item of artifacts) {
      if (item === null || typeof item !== "object" || Array.isArray(item)) return new Map();
      const entry = item as Record<string, unknown>;
      if (
        typeof entry.id !== "string" ||
        typeof entry.expected_byte_length !== "number" ||
        !Number.isSafeInteger(entry.expected_byte_length) ||
        typeof entry.expected_sha256 !== "string" ||
        !/^[a-f0-9]{64}$/u.test(entry.expected_sha256)
      ) return new Map();
      entries.set(entry.id, {
        id: entry.id,
        expected_byte_length: entry.expected_byte_length,
        expected_sha256: entry.expected_sha256
      });
    }
    return entries;
  } catch {
    return new Map();
  }
}

function manifestContains(manifest: ReadonlyMap<string, ManifestEntry>, artifact: ArtifactIdentity): boolean {
  const entry = manifest.get(artifact.id);
  return entry?.expected_byte_length === artifact.expectedByteLength &&
    entry.expected_sha256 === artifact.expectedSha256;
}

function modelCandidates(root: string, relativePath: string): readonly string[] {
  const segments = relativePath.split("/");
  const fileName = segments.at(-1) ?? "";
  return Object.freeze([
    join(root, ...segments),
    join(root, fileName),
    join(root, "models", ...segments),
    join(root, "ComfyUI", "models", ...segments)
  ]);
}

async function modelArtifactPresent(roots: readonly string[], artifact: ArtifactIdentity): Promise<boolean> {
  if (artifact.relativeModelPath === undefined) return false;
  for (const root of roots) {
    for (const candidate of modelCandidates(root, artifact.relativeModelPath)) {
      if (await directMetadata(candidate, "file", artifact.expectedByteLength)) return true;
    }
  }
  return false;
}

interface FileEvidence {
  readonly path: string;
  readonly modifiedMilliseconds: number;
}

async function modelArtifactEvidence(
  roots: readonly string[],
  artifact: ArtifactIdentity,
  modifiedNotAfterMilliseconds = Number.POSITIVE_INFINITY
): Promise<FileEvidence | null> {
  if (artifact.relativeModelPath === undefined) return null;
  for (const root of roots) {
    for (const candidate of modelCandidates(root, artifact.relativeModelPath)) {
      try {
        const metadata = await lstat(candidate);
        if (
          metadata.isSymbolicLink() ||
          !metadata.isFile() ||
          metadata.size !== artifact.expectedByteLength ||
          metadata.mtimeMs > modifiedNotAfterMilliseconds ||
          !samePath(await realpath(candidate), candidate)
        ) continue;
        return Object.freeze({
          path: candidate,
          modifiedMilliseconds: metadata.mtimeMs
        });
      } catch {
        // Continue through the bounded set of pinned category locations.
      }
    }
  }
  return null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return keys.length === sortedExpected.length && keys.every((key, index) => key === sortedExpected[index]);
}

async function boundedJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0 || metadata.size > 1024 * 1024) return null;
    if (!samePath(await realpath(path), path)) return null;
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

interface CompletedTransactionProof {
  readonly operationId: string;
  readonly components: readonly ComponentId[];
  readonly externalArtifactIds: readonly string[];
  readonly externalModelRoots: readonly string[];
  readonly vramBytes: number | null;
  readonly modifiedMilliseconds: number;
}

async function completedTransactionProof(
  installRoot: string,
  operationDirectory: string,
  operationId: string
): Promise<CompletedTransactionProof | null> {
  if (!OPERATION_ID.test(operationId) || !await directMetadata(operationDirectory, "directory")) return null;
  const [state, request] = await Promise.all([
    boundedJson(join(operationDirectory, "state.json")),
    boundedJson(join(operationDirectory, "request.json"))
  ]);
  if (state === null || request === null) return null;
  if (
    !exactKeys(state, ["schema_version", "operation_id", "status", "managed_root", "entries", "launch_plan", "error"]) ||
    !exactKeys(request, ["managedRoot", "components", "existingModelRoots", "hardware", "acknowledgements", "operationId"]) ||
    state.schema_version !== "1.0.0" ||
    state.operation_id !== operationId ||
    state.status !== "complete" ||
    state.error !== null ||
    request.operationId !== operationId ||
    typeof state.managed_root !== "string" ||
    typeof request.managedRoot !== "string"
  ) return null;
  try {
    if (
      !samePath(validateInstallRoot(state.managed_root), installRoot) ||
      !samePath(validateInstallRoot(request.managedRoot), installRoot)
    ) return null;
  } catch {
    return null;
  }
  const acknowledgements = request.acknowledgements;
  if (
    acknowledgements === null ||
    typeof acknowledgements !== "object" ||
    Array.isArray(acknowledgements) ||
    !exactKeys(acknowledgements as Record<string, unknown>, [
      "licenseAccepted",
      "territoryAcknowledged",
      "commercialAcknowledged",
      "downloadConsent"
    ]) ||
    Object.values(acknowledgements as Record<string, unknown>).some((value) => value !== true)
  ) return null;
  const hardware = request.hardware;
  if (
    hardware === null ||
    typeof hardware !== "object" ||
    Array.isArray(hardware) ||
    !exactKeys(hardware as Record<string, unknown>, ["vramBytes"])
  ) return null;
  const rawVramBytes = (hardware as Record<string, unknown>).vramBytes;
  if (
    rawVramBytes !== null &&
    (
      typeof rawVramBytes !== "number" ||
      !Number.isSafeInteger(rawVramBytes) ||
      rawVramBytes < 0
    )
  ) return null;
  if (!Array.isArray(request.components) || request.components.length === 0 || request.components.length > A3_COMPONENTS.size) return null;
  const components = request.components.filter((value): value is string => typeof value === "string");
  if (components.length !== request.components.length || new Set(components).size !== components.length || components.some((value) => !A3_COMPONENTS.has(value))) return null;
  if (!Array.isArray(state.entries) || state.entries.length === 0 || state.entries.length > 64) return null;
  const artifactIds = new Set<string>();
  const externalArtifactIds = new Set<string>();
  for (const value of state.entries) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const entry = value as Record<string, unknown>;
    if (
      !exactKeys(entry, ["artifact_id", "action", "status", "downloaded_bytes"]) ||
      typeof entry.artifact_id !== "string" ||
      typeof entry.action !== "string" ||
      !["download", "reuse_managed", "extract_downloaded_archive", "reuse_external_read_only"].includes(entry.action) ||
      !["complete", "reused"].includes(String(entry.status)) ||
      (entry.action.startsWith("reuse_") ? entry.status !== "reused" : entry.status !== "complete") ||
      typeof entry.downloaded_bytes !== "number" ||
      !Number.isSafeInteger(entry.downloaded_bytes) ||
      entry.downloaded_bytes < 0
    ) return null;
    artifactIds.add(entry.artifact_id);
    if (entry.action === "reuse_external_read_only") externalArtifactIds.add(entry.artifact_id);
  }
  for (const component of components) {
    if (!(A3_REQUIRED_ARTIFACTS[component] ?? []).every((artifactId) => artifactIds.has(artifactId))) return null;
  }
  const expectedArtifactIds = new Set(components.flatMap((component) => A3_REQUIRED_ARTIFACTS[component] ?? []));
  if (
    artifactIds.size !== expectedArtifactIds.size ||
    [...artifactIds].some((artifactId) => !expectedArtifactIds.has(artifactId))
  ) return null;
  if (
    !Array.isArray(request.existingModelRoots) ||
    request.existingModelRoots.length > 16 ||
    request.existingModelRoots.some((value) => typeof value !== "string")
  ) return null;
  let externalModelRoots: readonly string[];
  try {
    externalModelRoots = Object.freeze([
      ...new Set((request.existingModelRoots as string[]).map((root) => validateInstallRoot(root)))
    ]);
  } catch {
    return null;
  }
  if (externalArtifactIds.size > 0 && externalModelRoots.length === 0) return null;
  const stateMetadata = await lstat(join(operationDirectory, "state.json"));
  if (stateMetadata.mtimeMs > Date.now() + 2_000) return null;
  return Object.freeze({
    operationId,
    components: Object.freeze([...new Set(components.map((component) => A3_PUBLIC_COMPONENT[component]))].filter((value): value is ComponentId => value !== undefined)),
    externalArtifactIds: Object.freeze([...externalArtifactIds]),
    externalModelRoots,
    vramBytes: rawVramBytes as number | null,
    modifiedMilliseconds: stateMetadata.mtimeMs
  });
}

async function recoverCompletedTransactions(installRoot: string): Promise<readonly CompletedTransactionProof[]> {
  const installDirectory = join(installRoot, ".minimax-h3", "install");
  try {
    if (!await directMetadata(installDirectory, "directory")) return Object.freeze([]);
    const entries = await readdir(installDirectory, { withFileTypes: true });
    if (entries.length > 64) return Object.freeze([]);
    const proofs = await Promise.all(entries.map(async (entry) => {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !OPERATION_ID.test(entry.name)) return null;
      return completedTransactionProof(installRoot, join(installDirectory, entry.name), entry.name);
    }));
    return Object.freeze(proofs.filter((value): value is CompletedTransactionProof => value !== null));
  } catch {
    return Object.freeze([]);
  }
}

export async function inspectPersistedComponents(
  setup: SetupPreferences,
  options: { readonly comfyRootVerified: boolean }
): Promise<PersistedComponentInspection> {
  const [manifest, transactionProofs] = await Promise.all([
    readManagedManifest(setup.installRoot),
    recoverCompletedTransactions(setup.installRoot)
  ]);
  const baseProofs = [...transactionProofs]
    .filter((proof) => proof.components.includes("fl2va_base"))
    .sort((left, right) => right.modifiedMilliseconds - left.modifiedMilliseconds);
  const latestBaseProof = baseProofs.find(
    (proof) => proof.operationId === setup.completedInstallationId
  ) ?? baseProofs[0] ?? null;
  const transactionComponents = transactionProofs.flatMap((proof) => proof.components);
  const claimed = new Set<ComponentId>([...setup.completedComponents, ...transactionComponents]);
  const verified = new Set<ComponentId>();
  const found = new Set<ComponentId>();
  const managedModels = join(setup.installRoot, "runtime", "ComfyUI_windows_portable", "ComfyUI", "models");
  const transactionRoots = transactionProofs.flatMap((proof) => proof.externalModelRoots);
  const roots = Object.freeze([
    ...new Set([setup.modelRoot, managedModels, ...transactionRoots].filter((value): value is string => value !== null))
  ]);
  const managedArtifactVerified = async (artifact: ArtifactIdentity): Promise<boolean> =>
    manifestContains(manifest, artifact) && await modelArtifactPresent([managedModels], artifact);
  const externalArtifactVerified = async (artifact: ArtifactIdentity): Promise<boolean> => {
    for (const proof of transactionProofs) {
      if (!proof.externalArtifactIds.includes(artifact.id)) continue;
      const evidence = await modelArtifactEvidence(
        proof.externalModelRoots,
        artifact,
        proof.modifiedMilliseconds
      );
      // A completed transaction already performed the full SHA-256. Reuse that
      // proof only while the exact-size file has not been modified since the
      // terminal state was written. The supported Windows target uses NTFS, so
      // accepting a later timestamp would weaken the fail-closed proof.
      if (evidence !== null) return true;
    }
    return false;
  };
  const modelComponentEvidence = async (
    artifacts: readonly ArtifactIdentity[]
  ): Promise<{ readonly present: boolean; readonly verified: boolean }> => {
    const checks = await Promise.all(artifacts.map(async (artifact) => Object.freeze({
      present: await modelArtifactPresent(roots, artifact),
      verified: await managedArtifactVerified(artifact) || await externalArtifactVerified(artifact)
    })));
    return Object.freeze({
      present: checks.every((check) => check.present),
      verified: checks.every((check) => check.verified)
    });
  };

  const modelChecks = await Promise.all([
    modelComponentEvidence(BASE_MODEL_ARTIFACTS),
    modelComponentEvidence([ARTIFACTS.turbo]),
    modelComponentEvidence([ARTIFACTS.ref2va, ARTIFACTS.textEncoder, ARTIFACTS.videoVae, ARTIFACTS.audioVae])
  ]);
  const modelComponents: readonly [ComponentId, { readonly present: boolean; readonly verified: boolean } | undefined][] = [
    ["fl2va_base", modelChecks[0]],
    ["turbo_acceleration_recommended", modelChecks[1]],
    ["ref2va_optional", modelChecks[2]]
  ];
  for (const [component, evidence] of modelComponents) {
    if (evidence?.present !== true) continue;
    if (evidence.verified) verified.add(component);
    else if (claimed.has(component)) found.add(component);
  }

  const ffmpegRoot = join(setup.installRoot, "runtime", "ffmpeg", "ffmpeg-n9.0.1-6-g9d4ca21220-win64-gpl-9.0", "bin");
  const ffmpegPresent = (await Promise.all([
    directMetadata(join(ffmpegRoot, "ffmpeg.exe"), "file"),
    directMetadata(join(ffmpegRoot, "ffprobe.exe"), "file")
  ])).every(Boolean);
  if (ffmpegPresent) {
    if (manifestContains(manifest, ARTIFACTS.ffmpeg)) verified.add("ffmpeg_long_video_optional");
    else if (claimed.has("ffmpeg_long_video_optional")) found.add("ffmpeg_long_video_optional");
  }

  if (options.comfyRootVerified) {
    // A valid static ComfyUI root proves a configured handoff target. A cached
    // Desktop installer alone never proves this and is intentionally ignored.
    verified.add("comfyui_desktop_optional");
    const pyAvRoots = setup.comfyUiRoot === null
      ? []
      : ["python_embeded", "python_embedded"].map((directory) => join(setup.comfyUiRoot as string, directory, "Lib", "site-packages", "av"));
    const pyAvPresent = (await Promise.all(pyAvRoots.map(async (root) =>
      await directMetadata(join(root, "__init__.py"), "file") &&
      await directMetadata(join(root, "_core.pyd"), "file")
    ))).some(Boolean);
    if (pyAvPresent) {
      verified.add("pyav_required");
    }
  }

  const verifiedComponents = Object.freeze([...verified].sort());
  const foundComponents = Object.freeze([...found].filter((component) => !verified.has(component)).sort());
  const claimedComponents = Object.freeze([...claimed].sort());
  // Only current, re-proven capabilities are exposed as completed. Historical
  // transaction claims remain separate and never unlock compilation modes.
  const completedComponents = verifiedComponents;
  const completedInstallationId = latestBaseProof?.operationId ?? null;
  let recoveredModelRoot: string | null = null;
  for (const proof of transactionProofs) {
    if (!BASE_MODEL_ARTIFACTS.every((artifact) => proof.externalArtifactIds.includes(artifact.id))) continue;
    for (const root of proof.externalModelRoots) {
      const evidence = await Promise.all(BASE_MODEL_ARTIFACTS.map((artifact) =>
        modelArtifactEvidence([root], artifact, proof.modifiedMilliseconds)
      ));
      if (evidence.every((value) => value !== null)) {
        recoveredModelRoot = root;
        break;
      }
    }
    if (recoveredModelRoot !== null) break;
  }
  if (
    recoveredModelRoot === null &&
    (await Promise.all(BASE_MODEL_ARTIFACTS.map(managedArtifactVerified))).every(Boolean)
  ) {
    recoveredModelRoot = await verifySavedDirectory(managedModels);
  }
  return Object.freeze({
    verifiedComponents,
    foundComponents,
    claimedComponents,
    completedComponents,
    completedInstallationId,
    recoveredModelRoot,
    vramBytes: latestBaseProof?.vramBytes ?? null,
    setupComplete:
      options.comfyRootVerified &&
      verified.has("fl2va_base") &&
      verified.has("pyav_required") &&
      completedInstallationId !== null
  });
}
