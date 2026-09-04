import { sanitizeBuildConfiguration } from "./build-config.ts";
import { validateExecutorOutput } from "./executor-boundary.ts";
import { failure, rejected } from "./failure.ts";
import { isSha256, sha256Text } from "./hash.ts";
import { isLocalDrivePath } from "./path-policy.ts";
import { assertSafeIdentifier, compareOrdinal } from "./safe-text.ts";
import { parseStrictJson, requireClosedObject } from "./strict-json.ts";
import type {
  CodecCapability,
  ContainerCapability,
  ExternalPyAvIdentityObservation,
  ManagedPyAvProbeDependencies,
  ManagedPyAvTarget,
  MetadataPathCapability,
  PyAvCapabilities,
  PyAvObservation,
  VersionedLibrary
} from "./types.ts";

const pyAvProbeSchema = "minimax-h3-tool.pyav-capability.v1";
const probeLimits = Object.freeze({ timeoutMs: 15_000, maxOutputBytes: 1024 * 1024 });

export const PYAV_CAPABILITY_ARGUMENTS: readonly string[] = Object.freeze([
  "-I",
  "-S",
  "-B",
  "-c",
  String.raw`
import sys
if len(sys.argv) != 2:
    raise RuntimeError("verified import root required")
sys.path.insert(0, sys.argv[1])
import json
import platform
import av

def codec_rows():
    rows = []
    for name in sorted(av.codecs_available):
        media_type = "unknown"
        can_decode = False
        can_encode = False
        try:
            descriptor = av.codec.Codec(name, "r")
            media_type = str(descriptor.type)
            can_decode = True
        except Exception:
            pass
        try:
            descriptor = av.codec.Codec(name, "w")
            candidate_type = str(descriptor.type)
            if media_type != "unknown" and candidate_type != media_type:
                raise RuntimeError("codec type conflict")
            media_type = candidate_type
            can_encode = True
        except RuntimeError:
            raise
        except Exception:
            pass
        rows.append({"name": str(name), "media_type": media_type, "can_decode": can_decode, "can_encode": can_encode})
    return rows

def format_rows():
    rows = []
    for name in sorted(av.formats_available):
        descriptor = av.format.ContainerFormat(name)
        extensions = sorted(str(value) for value in (descriptor.extensions or []))
        rows.append({"names": [str(name)], "extensions": extensions, "can_demux": bool(descriptor.is_input), "can_mux": bool(descriptor.is_output)})
    return rows

libraries = []
for name in sorted(av.library_versions):
    version = av.library_versions[name]
    configuration = av.library_configurations.get(name, "")
    libraries.append({"name": str(name), "version": ".".join(str(part) for part in version), "configuration": str(configuration)})

metadata_paths = [
    {"path": "input_container.metadata", "access": "read", "available": hasattr(av.container.InputContainer, "metadata"), "mechanism": "InputContainer.metadata"},
    {"path": "output_container.metadata", "access": "write", "available": hasattr(av.container.OutputContainer, "metadata"), "mechanism": "OutputContainer.metadata"},
    {"path": "stream.metadata", "access": "read", "available": hasattr(av.stream.Stream, "metadata"), "mechanism": "Stream.metadata"}
]

payload = {
    "schema": "minimax-h3-tool.pyav-capability.v1",
    "pyav_version": str(av.__version__),
    "python_version": platform.python_version(),
    "linked_libraries": libraries,
    "codecs": codec_rows(),
    "containers": format_rows(),
    "metadata_paths": metadata_paths
}
print(json.dumps(payload, ensure_ascii=True, separators=(",", ":"), sort_keys=True))
`
]);

export function fixedManagedPyAvArguments(
  target: ManagedPyAvTarget,
  command: "pyav_capability_v1"
): readonly string[] {
  if (command !== "pyav_capability_v1") throw new Error("MEDIA.INVALID_REQUEST");
  return Object.freeze([...PYAV_CAPABILITY_ARGUMENTS, target.pyavImportRootPath]);
}

function requireArray(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw new Error("MEDIA.OUTPUT_INVALID");
  return value;
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("MEDIA.OUTPUT_INVALID");
  return value;
}

function requireVersion(value: unknown): string {
  if (typeof value !== "string" || value.length > 128 || !/^[0-9]+(?:\.[0-9A-Za-z]+){1,7}(?:[+_.-][0-9A-Za-z.-]+)?$/u.test(value)) {
    throw new Error("MEDIA.OUTPUT_INVALID");
  }
  return value;
}

function uniqueKey(set: Set<string>, key: string): void {
  if (set.has(key)) throw new Error("MEDIA.PYAV_CONFLICT");
  set.add(key);
}

function parseLibraries(value: unknown): VersionedLibrary[] {
  const seen = new Set<string>();
  return requireArray(value, 32)
    .map((item) => {
      const record = requireClosedObject(item, ["name", "version", "configuration"]);
      assertSafeIdentifier(record.name, 64);
      uniqueKey(seen, record.name);
      const version = requireVersion(record.version);
      if (typeof record.configuration !== "string") throw new Error("MEDIA.OUTPUT_INVALID");
      const configuration = sanitizeBuildConfiguration(record.configuration);
      return Object.freeze({ name: record.name, version, ...configuration });
    })
    .sort((left, right) => compareOrdinal(left.name, right.name));
}

const mediaTypes = new Set(["audio", "video", "subtitle", "data", "attachment", "unknown"]);

function parseCodecs(value: unknown): CodecCapability[] {
  const seen = new Set<string>();
  return requireArray(value, 4_096)
    .map((item) => {
      const record = requireClosedObject(item, ["name", "media_type", "can_decode", "can_encode"]);
      assertSafeIdentifier(record.name, 128);
      uniqueKey(seen, record.name);
      if (typeof record.media_type !== "string" || !mediaTypes.has(record.media_type)) {
        throw new Error("MEDIA.OUTPUT_INVALID");
      }
      return Object.freeze({
        name: record.name,
        mediaType: record.media_type as CodecCapability["mediaType"],
        canDecode: requireBoolean(record.can_decode),
        canEncode: requireBoolean(record.can_encode)
      });
    })
    .sort((left, right) => compareOrdinal(left.name, right.name));
}

function safeIdentifierArray(value: unknown, maximum: number): string[] {
  const items = requireArray(value, maximum);
  const seen = new Set<string>();
  return items
    .map((item) => {
      assertSafeIdentifier(item, 128);
      uniqueKey(seen, item);
      return item;
    })
    .sort(compareOrdinal);
}

function parseContainers(value: unknown): ContainerCapability[] {
  const seen = new Set<string>();
  return requireArray(value, 2_048)
    .map((item) => {
      const record = requireClosedObject(item, ["names", "extensions", "can_demux", "can_mux"]);
      const names = safeIdentifierArray(record.names, 32);
      if (names.length < 1) throw new Error("MEDIA.OUTPUT_INVALID");
      for (const name of names) uniqueKey(seen, name);
      return Object.freeze({
        names: Object.freeze(names),
        extensions: Object.freeze(safeIdentifierArray(record.extensions, 64)),
        canDemux: requireBoolean(record.can_demux),
        canMux: requireBoolean(record.can_mux)
      });
    })
    .sort((left, right) => compareOrdinal(left.names.join(","), right.names.join(",")));
}

const metadataAccess = new Set(["read", "write", "copy"]);

function parseMetadata(value: unknown): MetadataPathCapability[] {
  const seen = new Set<string>();
  return requireArray(value, 32)
    .map((item) => {
      const record = requireClosedObject(item, ["path", "access", "available", "mechanism"]);
      assertSafeIdentifier(record.path, 128);
      assertSafeIdentifier(record.mechanism, 128);
      if (typeof record.access !== "string" || !metadataAccess.has(record.access)) {
        throw new Error("MEDIA.OUTPUT_INVALID");
      }
      uniqueKey(seen, `${record.path}\0${record.access}`);
      return Object.freeze({
        path: record.path,
        access: record.access as MetadataPathCapability["access"],
        available: requireBoolean(record.available),
        mechanism: record.mechanism,
        evidence: "api_surface_observed" as const
      });
    })
    .sort((left, right) => compareOrdinal(`${left.path}\0${left.access}`, `${right.path}\0${right.access}`));
}

export function parsePyAvCapabilityPayload(
  stdout: string,
  source: PyAvCapabilities["source"]
): PyAvCapabilities {
  const root = requireClosedObject(parseStrictJson(stdout), [
    "schema",
    "pyav_version",
    "python_version",
    "linked_libraries",
    "codecs",
    "containers",
    "metadata_paths"
  ]);
  if (root.schema !== pyAvProbeSchema) throw new Error("MEDIA.OUTPUT_INVALID");
  const pyavVersion = requireVersion(root.pyav_version);
  const pythonVersion = requireVersion(root.python_version);
  const linkedLibraries = parseLibraries(root.linked_libraries);
  const requiredLibraries = new Set([
    "libavutil",
    "libavcodec",
    "libavformat",
    "libavdevice",
    "libavfilter",
    "libswscale",
    "libswresample"
  ]);
  const allowedLibraries = new Set([...requiredLibraries, "libpostproc"]);
  for (const library of linkedLibraries) {
    requiredLibraries.delete(library.name);
    if (!allowedLibraries.has(library.name)) throw new Error("MEDIA.PYAV_CONFLICT");
  }
  if (requiredLibraries.size !== 0) throw new Error("MEDIA.PYAV_CONFLICT");
  const codecs = parseCodecs(root.codecs);
  const containers = parseContainers(root.containers);
  if (codecs.length < 1 || containers.length < 1 ||
    codecs.some((codec) => !codec.canDecode && !codec.canEncode) ||
    containers.some((container) => !container.canDemux && !container.canMux)) {
    throw new Error("MEDIA.PYAV_CONFLICT");
  }
  return Object.freeze({
    source,
    pyavVersion,
    pythonVersion,
    linkedLibraries: Object.freeze(linkedLibraries),
    codecs: Object.freeze(codecs),
    containers: Object.freeze(containers),
    metadataPaths: Object.freeze(parseMetadata(root.metadata_paths))
  });
}

export function observeExternalPyAvIdentity(value: unknown): ExternalPyAvIdentityObservation {
  const root = requireClosedObject(value, ["pyavVersion", "linkedLibraryVersions"]);
  const pyavVersion = requireVersion(root.pyavVersion);
  const seen = new Set<string>();
  const linkedLibraryVersions = requireArray(root.linkedLibraryVersions, 32)
    .map((item) => {
      const record = requireClosedObject(item, ["name", "version"]);
      assertSafeIdentifier(record.name, 64);
      uniqueKey(seen, record.name);
      return Object.freeze({ name: record.name, version: requireVersion(record.version) });
    })
    .sort((left, right) => compareOrdinal(left.name, right.name));
  if (linkedLibraryVersions.length < 1) throw new Error("MEDIA.OUTPUT_INVALID");
  const canonical = JSON.stringify({ pyavVersion, linkedLibraryVersions });
  return Object.freeze({
    status: "identity_observed",
    source: "external_pyav",
    selectable: false,
    selected: false,
    evidenceStatus: "observation_only",
    pyavVersion,
    linkedLibraryVersions: Object.freeze(linkedLibraryVersions),
    evidenceSha256: sha256Text(canonical)
  });
}

export async function probeManagedPyAv(
  target: ManagedPyAvTarget,
  dependencies: ManagedPyAvProbeDependencies
): Promise<PyAvObservation> {
  try {
    if (
      typeof target !== "object" ||
      target === null ||
      Object.keys(target).sort().join("\0") !== ["expected", "pyavImportRootPath", "pythonExecutablePath", "runtimeId"].join("\0") ||
      !isLocalDrivePath(target.pythonExecutablePath, true) ||
      !isLocalDrivePath(target.pyavImportRootPath, false) ||
      target.pythonExecutablePath.slice(0, 2).toUpperCase() !== target.pyavImportRootPath.slice(0, 2).toUpperCase()
    ) {
      return rejected("MEDIA.EXECUTABLE_NOT_ABSOLUTE");
    }
    assertSafeIdentifier(target.runtimeId, 128);
    const expected = target.expected;
    if (
      typeof expected !== "object" ||
      expected === null ||
      Object.keys(expected).sort().join("\0") !== [
        "linkedDllTreeSha256", "pyavImportRootTreeSha256", "pyavWheelArtifactSha256",
        "pythonArtifactByteLength", "pythonArtifactSha256", "runtimeGenerationId", "runtimeManifestSha256"
      ].join("\0") ||
      !isSha256(expected.runtimeManifestSha256) ||
      !isSha256(expected.pythonArtifactSha256) ||
      !Number.isSafeInteger(expected.pythonArtifactByteLength) ||
      expected.pythonArtifactByteLength < 1 ||
      expected.pythonArtifactByteLength > 256 * 1024 * 1024 ||
      !isSha256(expected.pyavWheelArtifactSha256) ||
      !isSha256(expected.linkedDllTreeSha256) ||
      !isSha256(expected.pyavImportRootTreeSha256)
    ) {
      return rejected("MEDIA.INVALID_REQUEST");
    }
    assertSafeIdentifier(expected.runtimeGenerationId, 128);
    if (
      typeof dependencies !== "object" ||
      dependencies === null ||
      typeof dependencies.runtimeVerifier?.verify !== "function" ||
      typeof dependencies.exactImageExecutor?.execute !== "function"
    ) {
      return rejected("MEDIA.PYAV_RUNTIME_UNVERIFIED");
    }
    const proof = await dependencies.runtimeVerifier.verify(target).catch(() => null);
    if (
      !proof ||
      proof.kind !== "verified_managed_pyav_runtime" ||
      proof.runtimeId !== target.runtimeId ||
      proof.runtimeManifestSha256 !== expected.runtimeManifestSha256 ||
      proof.pythonArtifactSha256 !== expected.pythonArtifactSha256 ||
      proof.pythonArtifactByteLength !== expected.pythonArtifactByteLength ||
      proof.pyavWheelArtifactSha256 !== expected.pyavWheelArtifactSha256 ||
      proof.linkedDllTreeSha256 !== expected.linkedDllTreeSha256 ||
      proof.pyavImportRootTreeSha256 !== expected.pyavImportRootTreeSha256 ||
      proof.runtimeGenerationId !== expected.runtimeGenerationId ||
      proof.containment !== "handle_contained_no_reparse" ||
      proof.executionLease !== "read_lease_held"
    ) {
      return rejected("MEDIA.PYAV_RUNTIME_UNVERIFIED");
    }
    if (!/^[A-Za-z0-9_.:-]{1,128}$/u.test(proof.pythonFileIdentity?.volumeId ?? "") ||
      !/^[A-Za-z0-9_.:-]{1,128}$/u.test(proof.pythonFileIdentity?.fileId ?? "")) {
      return rejected("MEDIA.PYAV_RUNTIME_UNVERIFIED");
    }
    const result = await dependencies.exactImageExecutor
      .execute(target, proof, "pyav_capability_v1", probeLimits)
      .catch(() => ({ ok: false as const, failure: failure("MEDIA.PROCESS_SPAWN_FAILED") }));
    if (!result.ok) return rejected(result.failure.code);
    if (!validateExecutorOutput(result, probeLimits.maxOutputBytes)) {
      return rejected("MEDIA.OUTPUT_INVALID");
    }
    if (
      result.imageProof.kind !== "verified_spawned_managed_python" ||
      result.imageProof.runtimeId !== proof.runtimeId ||
      result.imageProof.runtimeGenerationId !== proof.runtimeGenerationId ||
      result.imageProof.pythonArtifactSha256 !== proof.pythonArtifactSha256 ||
      result.imageProof.linkedDllTreeSha256 !== proof.linkedDllTreeSha256 ||
      result.imageProof.pyavImportRootTreeSha256 !== proof.pyavImportRootTreeSha256 ||
      result.imageProof.pythonFileIdentity.volumeId !== proof.pythonFileIdentity.volumeId ||
      result.imageProof.pythonFileIdentity.fileId !== proof.pythonFileIdentity.fileId ||
      result.processTreeProof !== "verified_job_closed_no_survivors"
    ) {
      return rejected("MEDIA.EXACT_IMAGE_PROOF_MISSING");
    }
    if (result.stderr !== "") return rejected("MEDIA.OUTPUT_INVALID");
    const capabilities = parsePyAvCapabilityPayload(result.stdout, "managed_pyav");
    return Object.freeze({
      status: "available",
      source: "managed_pyav",
      selectable: false,
      selected: false,
      capabilities,
      runtimeBinding: Object.freeze({
        runtimeManifestSha256: proof.runtimeManifestSha256,
        pythonArtifactSha256: proof.pythonArtifactSha256,
        pyavWheelArtifactSha256: proof.pyavWheelArtifactSha256,
        linkedDllTreeSha256: proof.linkedDllTreeSha256,
        pyavImportRootTreeSha256: proof.pyavImportRootTreeSha256,
        runtimeGenerationId: proof.runtimeGenerationId
      })
    });
  } catch (error) {
    return rejected(error instanceof Error && error.message === "MEDIA.PYAV_CONFLICT" ? "MEDIA.PYAV_CONFLICT" : "MEDIA.OUTPUT_INVALID");
  }
}
