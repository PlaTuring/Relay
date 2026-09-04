export type Sha256 = `sha256:${string}`;

export type MediaFailureCode =
  | "MEDIA.INVALID_REQUEST"
  | "MEDIA.EXECUTABLE_NOT_ABSOLUTE"
  | "MEDIA.PROCESS_SPAWN_FAILED"
  | "MEDIA.PROCESS_NONZERO"
  | "MEDIA.PROCESS_TIMEOUT"
  | "MEDIA.PROCESS_OUTPUT_LIMIT"
  | "MEDIA.PROCESS_TREE_UNCONFIRMED"
  | "MEDIA.OUTPUT_INVALID_UTF8"
  | "MEDIA.OUTPUT_UNSAFE_TEXT"
  | "MEDIA.OUTPUT_INVALID"
  | "MEDIA.PYAV_RUNTIME_UNVERIFIED"
  | "MEDIA.PYAV_CONFLICT"
  | "MEDIA.CATALOG_PROOF_MISSING"
  | "MEDIA.ARTIFACT_MISMATCH"
  | "MEDIA.SIGNATURE_PROOF_MISSING"
  | "MEDIA.OWNERSHIP_PROOF_MISSING"
  | "MEDIA.EXACT_IMAGE_PROOF_MISSING"
  | "MEDIA.FFMPEG_PAIR_CONFLICT"
  | "MEDIA.PROBE_UNAVAILABLE";

export interface SafeFailure {
  readonly code: MediaFailureCode;
  readonly summary: string;
}

export interface CommandRequest {
  readonly executablePath: string;
  readonly arguments: readonly string[];
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}

export interface CommandSuccess {
  readonly ok: true;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutSha256: Sha256;
  readonly stderrSha256: Sha256;
}

export interface CommandFailure {
  readonly ok: false;
  readonly failure: SafeFailure;
}

export type CommandResult = CommandSuccess | CommandFailure;

export interface ProcessExecutor {
  execute(request: CommandRequest): Promise<CommandResult>;
}

export interface VersionedLibrary {
  readonly name: string;
  readonly version: string;
  readonly configurationFingerprintSha256: Sha256;
  readonly configurationFlags: readonly BuildConfigurationFlag[];
}

export interface BuildConfigurationFlag {
  readonly option: string;
  readonly valueState: "absent" | "safe" | "redacted";
  readonly safeValue?: string;
}

export interface CodecCapability {
  readonly name: string;
  readonly mediaType: "audio" | "video" | "subtitle" | "data" | "attachment" | "unknown";
  readonly canDecode: boolean;
  readonly canEncode: boolean;
}

export interface ContainerCapability {
  readonly names: readonly string[];
  readonly extensions: readonly string[];
  readonly canDemux: boolean;
  readonly canMux: boolean;
}

export interface MetadataPathCapability {
  readonly path: string;
  readonly access: "read" | "write" | "copy";
  readonly available: boolean;
  readonly mechanism: string;
  readonly evidence: "api_surface_observed" | "cli_surface_observed";
}

export interface PyAvCapabilities {
  readonly source: "managed_pyav" | "external_pyav";
  readonly pyavVersion: string;
  readonly pythonVersion: string;
  readonly linkedLibraries: readonly VersionedLibrary[];
  readonly codecs: readonly CodecCapability[];
  readonly containers: readonly ContainerCapability[];
  readonly metadataPaths: readonly MetadataPathCapability[];
}

export interface FfmpegProgramIdentity {
  readonly program: "ffmpeg" | "ffprobe";
  readonly version: string;
  readonly compiler: Readonly<{
    family: "gcc" | "clang" | "msvc" | "unknown";
    version?: string;
  }>;
  readonly configurationFingerprintSha256: Sha256;
  readonly configurationFlags: readonly BuildConfigurationFlag[];
  readonly libraries: readonly Readonly<{
    name: string;
    compiledVersion: string;
    runtimeVersion: string;
  }>[];
}

export interface FfmpegCapabilities {
  readonly ffmpeg: FfmpegProgramIdentity;
  readonly ffprobe: FfmpegProgramIdentity;
  readonly codecs: readonly CodecCapability[];
  readonly containers: readonly ContainerCapability[];
  readonly metadataPaths: readonly MetadataPathCapability[];
  readonly coherent: true;
}

export interface UnavailableObservation {
  readonly status: "unavailable" | "rejected";
  readonly selectable: false;
  readonly selected: false;
  readonly failure: SafeFailure;
}

export interface PyAvObservationAvailable {
  readonly status: "available";
  readonly source: "managed_pyav" | "external_pyav";
  readonly selectable: false;
  readonly selected: false;
  readonly capabilities: PyAvCapabilities;
  readonly runtimeBinding?: Readonly<{
    runtimeManifestSha256: Sha256;
    pythonArtifactSha256: Sha256;
    pyavWheelArtifactSha256: Sha256;
    linkedDllTreeSha256: Sha256;
    pyavImportRootTreeSha256: Sha256;
    runtimeGenerationId: string;
  }>;
}

export interface ExternalPyAvIdentityObservation {
  readonly status: "identity_observed";
  readonly source: "external_pyav";
  readonly selectable: false;
  readonly selected: false;
  readonly evidenceStatus: "observation_only";
  readonly pyavVersion: string;
  readonly linkedLibraryVersions: readonly Readonly<{
    name: string;
    version: string;
  }>[];
  readonly evidenceSha256: Sha256;
}

export type PyAvObservation =
  | PyAvObservationAvailable
  | ExternalPyAvIdentityObservation
  | UnavailableObservation;

export interface AmbientFfmpegPresenceObservation {
  readonly status: "present_unverified";
  readonly source: "ambient_host";
  readonly selectable: false;
  readonly selected: false;
  readonly reason: "exact_build_not_observed";
}

export type AmbientFfmpegObservation =
  | AmbientFfmpegPresenceObservation
  | UnavailableObservation;

export interface PrivateFfmpegObservationAvailable {
  readonly status: "available";
  readonly source: "verified_private_pair";
  readonly selectable: true;
  readonly selected: false;
  readonly catalogContentSha256: Sha256;
  readonly ffmpegComponentId: string;
  readonly ffprobeComponentId: string;
  readonly artifacts: Readonly<{
    ffmpeg: Readonly<{ componentVersion: string; artifactSha256: Sha256; dependencyTreeSha256: Sha256 }>;
    ffprobe: Readonly<{ componentVersion: string; artifactSha256: Sha256; dependencyTreeSha256: Sha256 }>;
  }>;
  readonly capabilities: FfmpegCapabilities;
}

export type PrivateFfmpegObservation = PrivateFfmpegObservationAvailable | UnavailableObservation;

export interface MediaCapabilityReport {
  readonly schemaVersion: 1;
  readonly pyav: readonly PyAvObservation[];
  readonly privateFfmpeg: PrivateFfmpegObservation;
  readonly ambientFfmpeg: AmbientFfmpegObservation;
}

export interface ManagedPyAvTarget {
  readonly pythonExecutablePath: string;
  readonly pyavImportRootPath: string;
  readonly runtimeId: string;
  readonly expected: {
    readonly runtimeManifestSha256: Sha256;
    readonly pythonArtifactSha256: Sha256;
    readonly pythonArtifactByteLength: number;
    readonly pyavWheelArtifactSha256: Sha256;
    readonly linkedDllTreeSha256: Sha256;
    readonly pyavImportRootTreeSha256: Sha256;
    readonly runtimeGenerationId: string;
  };
}

export interface ManifestIdentity {
  readonly contractId: "minimax-h3-tool.component-manifest";
  readonly schemaVersion: "1.0.0";
  readonly schemaId: "urn:minimax-h3-tool:schema:component-manifest:1.0.0";
  readonly schemaContentSha256: Sha256;
  readonly documentId: string;
  readonly documentRevision: number;
  readonly contentSha256: Sha256;
  readonly appId: string;
  readonly appVersion: string;
  readonly appBuildId: string;
  readonly catalogResource: string;
}

export interface PrivateToolManifestRecord {
  readonly slot: "ffmpeg" | "ffprobe";
  readonly componentId: string;
  readonly componentVersion: string;
  readonly componentRole: "private_media_tool";
  readonly releaseState: "eligible";
  readonly destinationRelativePath: string;
  readonly artifact: {
    readonly byteLength: number;
    readonly sha256: Sha256;
  };
  readonly signature: {
    readonly kind: "embedded_authenticode";
    readonly scheme: "authenticode";
    readonly signerId: string;
    readonly signedArtifactSha256: Sha256;
    readonly verificationPolicy: "verify_against_release_trust_store_before_materialization";
  };
  readonly runtimeDependencyTreeSha256: Sha256;
}

export interface PrivateToolExecutionTarget {
  readonly slot: "ffmpeg" | "ffprobe";
  readonly executablePath: string;
}

export interface PrivatePairTarget {
  readonly manifest: ManifestIdentity;
  readonly ffmpeg: PrivateToolManifestRecord;
  readonly ffprobe: PrivateToolManifestRecord;
  readonly execution: {
    readonly ffmpeg: PrivateToolExecutionTarget;
    readonly ffprobe: PrivateToolExecutionTarget;
  };
}

export interface FileIdentity {
  readonly volumeId: string;
  readonly fileId: string;
}

export interface ArtifactObservation {
  readonly kind: "verified_local_handle_artifact";
  readonly byteLength: number;
  readonly sha256: Sha256;
  readonly fileIdentity: FileIdentity;
  readonly locality: "fixed_local_volume";
  readonly containment: "handle_contained_no_reparse";
  readonly hashExecution: "bounded_stream_complete";
}

export interface CatalogVerificationProof {
  readonly kind: "verified_signed_build_inventory";
  readonly manifestContentSha256: Sha256;
  readonly schemaId: "urn:minimax-h3-tool:schema:component-manifest:1.0.0";
  readonly schemaContentSha256: Sha256;
  readonly documentId: string;
  readonly documentRevision: number;
  readonly appId: string;
  readonly appVersion: string;
  readonly appBuildId: string;
  readonly catalogResource: string;
  readonly entries: readonly [CatalogEntryProjection, CatalogEntryProjection];
}

export interface CatalogEntryProjection {
  readonly slot: "ffmpeg" | "ffprobe";
  readonly componentId: string;
  readonly componentVersion: string;
  readonly componentRole: "private_media_tool";
  readonly releaseState: "eligible";
  readonly artifactByteLength: number;
  readonly artifactSha256: Sha256;
  readonly destinationRelativePath: string;
  readonly signatureKind: "embedded_authenticode";
  readonly signatureScheme: "authenticode";
  readonly signerId: string;
  readonly signedArtifactSha256: Sha256;
  readonly signatureVerificationPolicy: "verify_against_release_trust_store_before_materialization";
  readonly runtimeDependencyTreeSha256: Sha256;
}

export interface AuthenticodeVerificationProof {
  readonly kind: "verified_authenticode";
  readonly signerId: string;
  readonly signedArtifactSha256: Sha256;
  readonly fileIdentity: FileIdentity;
  readonly trustPolicy: "release_trust_store";
}

export interface OwnershipVerificationProof {
  readonly kind: "verified_current_ownership_handle";
  readonly componentId: string;
  readonly artifactSha256: Sha256;
  readonly fileIdentity: FileIdentity;
  readonly ledgerDocumentId: string;
  readonly ledgerDocumentRevision: number;
  readonly ledgerContentSha256: Sha256;
  readonly managedRootId: string;
  readonly runtimeGenerationId: string;
  readonly resolvedDestinationRelativePath: string;
  readonly destinationBinding: "managed_root_plus_manifest_relative_path";
  readonly readLeaseId: string;
  readonly ledgerState: "committed_tool_owned";
  readonly containment: "handle_contained_no_reparse";
  readonly executionLease: "read_lease_held";
}

export interface ExactImageProof {
  readonly kind: "verified_spawned_image";
  readonly componentId: string;
  readonly artifactSha256: Sha256;
  readonly fileIdentity: FileIdentity;
  readonly loadedDependencyTreeSha256: Sha256;
}

export interface PyAvRuntimeVerificationProof {
  readonly kind: "verified_managed_pyav_runtime";
  readonly runtimeId: string;
  readonly runtimeManifestSha256: Sha256;
  readonly pythonArtifactSha256: Sha256;
  readonly pythonArtifactByteLength: number;
  readonly pyavWheelArtifactSha256: Sha256;
  readonly linkedDllTreeSha256: Sha256;
  readonly pyavImportRootTreeSha256: Sha256;
  readonly pythonFileIdentity: FileIdentity;
  readonly runtimeGenerationId: string;
  readonly containment: "handle_contained_no_reparse";
  readonly executionLease: "read_lease_held";
}

export interface PyAvRuntimeVerifier {
  verify(target: ManagedPyAvTarget): Promise<PyAvRuntimeVerificationProof | null>;
}

export interface ExactImageExecutionSuccess extends CommandSuccess {
  readonly imageProof: ExactImageProof;
  readonly processTreeProof: "verified_job_closed_no_survivors";
}

export type ExactImageExecutionResult = ExactImageExecutionSuccess | CommandFailure;

export interface ManagedRuntimeImageProof {
  readonly kind: "verified_spawned_managed_python";
  readonly runtimeId: string;
  readonly runtimeGenerationId: string;
  readonly pythonArtifactSha256: Sha256;
  readonly pythonFileIdentity: FileIdentity;
  readonly linkedDllTreeSha256: Sha256;
  readonly pyavImportRootTreeSha256: Sha256;
}

export interface ManagedPyAvExecutionSuccess extends CommandSuccess {
  readonly imageProof: ManagedRuntimeImageProof;
  readonly processTreeProof: "verified_job_closed_no_survivors";
}

export type ManagedPyAvExecutionResult = ManagedPyAvExecutionSuccess | CommandFailure;

export interface CatalogBuildVerifier {
  verify(target: PrivatePairTarget): Promise<CatalogVerificationProof | null>;
}

export interface PrivateArtifactVerifier {
  verify(
    record: PrivateToolManifestRecord,
    executionTarget: PrivateToolExecutionTarget,
    limits: Readonly<{ timeoutMs: number; maximumBytes: number }>
  ): Promise<ArtifactObservation | null>;
}

export interface AuthenticodeVerifier {
  verify(
    record: PrivateToolManifestRecord,
    executionTarget: PrivateToolExecutionTarget,
    artifact: ArtifactObservation
  ): Promise<AuthenticodeVerificationProof | null>;
}

export interface OwnershipVerifier {
  verify(
    record: PrivateToolManifestRecord,
    executionTarget: PrivateToolExecutionTarget,
    artifact: ArtifactObservation
  ): Promise<OwnershipVerificationProof | null>;
}

export interface ExactImageExecutor {
  execute(
    record: PrivateToolManifestRecord,
    executionTarget: PrivateToolExecutionTarget,
    artifact: ArtifactObservation,
    ownership: OwnershipVerificationProof,
    command: "version" | "codecs" | "formats" | "help",
    limits: Readonly<{ timeoutMs: number; maxOutputBytes: number }>
  ): Promise<ExactImageExecutionResult>;
}

export interface PrivateProbeDependencies {
  readonly catalogVerifier: CatalogBuildVerifier;
  readonly artifactVerifier: PrivateArtifactVerifier;
  readonly authenticodeVerifier: AuthenticodeVerifier;
  readonly ownershipVerifier: OwnershipVerifier;
  readonly exactImageExecutor: ExactImageExecutor;
}

export interface ManagedPyAvProbeDependencies {
  readonly runtimeVerifier: PyAvRuntimeVerifier;
  readonly exactImageExecutor: {
    execute(
      target: ManagedPyAvTarget,
      proof: PyAvRuntimeVerificationProof,
      command: "pyav_capability_v1",
      limits: Readonly<{ timeoutMs: number; maxOutputBytes: number }>
    ): Promise<ManagedPyAvExecutionResult>;
  };
}
