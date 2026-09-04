import { validateExecutorOutput } from "./executor-boundary.ts";
import { failure, rejected } from "./failure.ts";
import { probeFfmpegPairWithFixedRunner } from "./ffmpeg.ts";
import { isSha256 } from "./hash.ts";
import { isLocalDrivePath, isManagedRelativeExecutablePath } from "./path-policy.ts";
import { assertSafeIdentifier } from "./safe-text.ts";
import type {
  ArtifactObservation,
  CatalogEntryProjection,
  CatalogVerificationProof,
  ExactImageExecutionResult,
  PrivateFfmpegObservation,
  PrivatePairTarget,
  PrivateProbeDependencies,
  PrivateToolExecutionTarget,
  PrivateToolManifestRecord
} from "./types.ts";

const maximumPrivateToolBytes = 256 * 1024 * 1024;
const acceptedComponentSchemaSha256 = "sha256:62704fae90e6f9d1895a3d1351b8664f67222aedb8db390ab46e674394236608";

function exactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validRecord(value: unknown, slot: "ffmpeg" | "ffprobe"): value is PrivateToolManifestRecord {
  if (typeof value !== "object" || value === null || !exactKeys(value, [
    "slot", "componentId", "componentVersion", "componentRole", "releaseState",
    "destinationRelativePath", "artifact", "signature", "runtimeDependencyTreeSha256"
  ])) return false;
  const record = value as Partial<PrivateToolManifestRecord>;
  try {
    assertSafeIdentifier(record.componentId, 128);
    assertSafeIdentifier(record.componentVersion, 128);
  } catch {
    return false;
  }
  if (
    record.slot !== slot || record.componentRole !== "private_media_tool" || record.releaseState !== "eligible" ||
    !isManagedRelativeExecutablePath(record.destinationRelativePath) ||
    !isSha256(record.runtimeDependencyTreeSha256) ||
    typeof record.artifact !== "object" || record.artifact === null ||
    !exactKeys(record.artifact, ["byteLength", "sha256"]) ||
    !Number.isSafeInteger(record.artifact.byteLength) || record.artifact.byteLength < 1 ||
    record.artifact.byteLength > maximumPrivateToolBytes || !isSha256(record.artifact.sha256) ||
    typeof record.signature !== "object" || record.signature === null ||
    !exactKeys(record.signature, ["kind", "scheme", "signerId", "signedArtifactSha256", "verificationPolicy"])
  ) return false;
  try {
    assertSafeIdentifier(record.signature.signerId, 128);
  } catch {
    return false;
  }
  return record.signature.kind === "embedded_authenticode" &&
    record.signature.scheme === "authenticode" &&
    record.signature.signedArtifactSha256 === record.artifact.sha256 &&
    record.signature.verificationPolicy === "verify_against_release_trust_store_before_materialization";
}

function validExecution(value: unknown, slot: "ffmpeg" | "ffprobe"): value is PrivateToolExecutionTarget {
  return typeof value === "object" && value !== null && exactKeys(value, ["slot", "executablePath"]) &&
    (value as PrivateToolExecutionTarget).slot === slot &&
    isLocalDrivePath((value as PrivateToolExecutionTarget).executablePath, true);
}

function validManifest(target: PrivatePairTarget): boolean {
  const manifest = target.manifest;
  if (typeof manifest !== "object" || manifest === null || !exactKeys(manifest, [
    "contractId", "schemaVersion", "schemaId", "schemaContentSha256", "documentId", "documentRevision",
    "contentSha256", "appId", "appVersion", "appBuildId", "catalogResource"
  ])) return false;
  try {
    assertSafeIdentifier(manifest.appId, 128);
    assertSafeIdentifier(manifest.appVersion, 128);
    assertSafeIdentifier(manifest.appBuildId, 128);
  } catch {
    return false;
  }
  return manifest.contractId === "minimax-h3-tool.component-manifest" && manifest.schemaVersion === "1.0.0" &&
    manifest.schemaId === "urn:minimax-h3-tool:schema:component-manifest:1.0.0" &&
    manifest.schemaContentSha256 === acceptedComponentSchemaSha256 && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(manifest.documentId) &&
    manifest.documentRevision === 1 && manifest.appId === "minimax-h3-tool" &&
    isSha256(manifest.contentSha256) && /^app-resource:[^?#]{1,480}$/u.test(manifest.catalogResource);
}

function validTarget(value: unknown): value is PrivatePairTarget {
  if (typeof value !== "object" || value === null || !exactKeys(value, ["manifest", "ffmpeg", "ffprobe", "execution"])) return false;
  const target = value as PrivatePairTarget;
  if (!validManifest(target) || !validRecord(target.ffmpeg, "ffmpeg") || !validRecord(target.ffprobe, "ffprobe") ||
    typeof target.execution !== "object" || target.execution === null || !exactKeys(target.execution, ["ffmpeg", "ffprobe"]) ||
    !validExecution(target.execution.ffmpeg, "ffmpeg") || !validExecution(target.execution.ffprobe, "ffprobe")) return false;
  const ffmpegSuffix = `\\${target.ffmpeg.destinationRelativePath.replaceAll("/", "\\")}`.toUpperCase();
  const ffprobeSuffix = `\\${target.ffprobe.destinationRelativePath.replaceAll("/", "\\")}`.toUpperCase();
  return target.ffmpeg.componentId !== target.ffprobe.componentId &&
    target.ffmpeg.destinationRelativePath.toUpperCase() !== target.ffprobe.destinationRelativePath.toUpperCase() &&
    target.execution.ffmpeg.executablePath.toUpperCase() !== target.execution.ffprobe.executablePath.toUpperCase() &&
    target.execution.ffmpeg.executablePath.toUpperCase().endsWith(ffmpegSuffix) &&
    target.execution.ffprobe.executablePath.toUpperCase().endsWith(ffprobeSuffix);
}

function projection(record: PrivateToolManifestRecord): CatalogEntryProjection {
  return Object.freeze({
    slot: record.slot,
    componentId: record.componentId,
    componentVersion: record.componentVersion,
    componentRole: record.componentRole,
    releaseState: record.releaseState,
    artifactByteLength: record.artifact.byteLength,
    artifactSha256: record.artifact.sha256,
    destinationRelativePath: record.destinationRelativePath,
    signatureKind: record.signature.kind,
    signatureScheme: record.signature.scheme,
    signerId: record.signature.signerId,
    signedArtifactSha256: record.signature.signedArtifactSha256,
    signatureVerificationPolicy: record.signature.verificationPolicy,
    runtimeDependencyTreeSha256: record.runtimeDependencyTreeSha256
  });
}

function sameProjection(left: CatalogEntryProjection, right: CatalogEntryProjection): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validCatalogProof(target: PrivatePairTarget, proof: CatalogVerificationProof | null): proof is CatalogVerificationProof {
  if (!proof || proof.kind !== "verified_signed_build_inventory" || !Array.isArray(proof.entries) || proof.entries.length !== 2) return false;
  const manifest = target.manifest;
  if (proof.manifestContentSha256 !== manifest.contentSha256 || proof.schemaId !== manifest.schemaId ||
    proof.schemaContentSha256 !== manifest.schemaContentSha256 || proof.documentId !== manifest.documentId ||
    proof.documentRevision !== manifest.documentRevision || proof.appId !== manifest.appId ||
    proof.appVersion !== manifest.appVersion || proof.appBuildId !== manifest.appBuildId ||
    proof.catalogResource !== manifest.catalogResource) return false;
  const bySlot = new Map(proof.entries.map((entry) => [entry.slot, entry]));
  return bySlot.size === 2 && sameProjection(projection(target.ffmpeg), bySlot.get("ffmpeg") as CatalogEntryProjection) &&
    sameProjection(projection(target.ffprobe), bySlot.get("ffprobe") as CatalogEntryProjection);
}

function validArtifact(record: PrivateToolManifestRecord, artifact: ArtifactObservation | null): artifact is ArtifactObservation {
  return artifact?.kind === "verified_local_handle_artifact" && artifact.byteLength === record.artifact.byteLength &&
    artifact.sha256 === record.artifact.sha256 && artifact.locality === "fixed_local_volume" &&
    artifact.containment === "handle_contained_no_reparse" && artifact.hashExecution === "bounded_stream_complete" &&
    typeof artifact.fileIdentity?.volumeId === "string" && /^[A-Za-z0-9_.:-]{1,128}$/u.test(artifact.fileIdentity.volumeId) &&
    typeof artifact.fileIdentity.fileId === "string" && /^[A-Za-z0-9_.:-]{1,128}$/u.test(artifact.fileIdentity.fileId);
}

function sameIdentity(left: ArtifactObservation, right: ArtifactObservation): boolean {
  return left.fileIdentity.volumeId === right.fileIdentity.volumeId && left.fileIdentity.fileId === right.fileIdentity.fileId;
}

function validOwnershipProof(
  record: PrivateToolManifestRecord,
  artifact: ArtifactObservation,
  ownership: Awaited<ReturnType<PrivateProbeDependencies["ownershipVerifier"]["verify"]>>
): ownership is NonNullable<typeof ownership> {
  if (!ownership || ownership.kind !== "verified_current_ownership_handle" || ownership.componentId !== record.componentId ||
    ownership.artifactSha256 !== artifact.sha256 || ownership.fileIdentity.volumeId !== artifact.fileIdentity.volumeId ||
    ownership.fileIdentity.fileId !== artifact.fileIdentity.fileId || ownership.ledgerState !== "committed_tool_owned" ||
    ownership.containment !== "handle_contained_no_reparse" || ownership.executionLease !== "read_lease_held" ||
    ownership.destinationBinding !== "managed_root_plus_manifest_relative_path" ||
    ownership.resolvedDestinationRelativePath !== record.destinationRelativePath ||
    !isSha256(ownership.ledgerContentSha256) || ownership.ledgerDocumentRevision !== 1) return false;
  try {
    assertSafeIdentifier(ownership.ledgerDocumentId, 128);
    assertSafeIdentifier(ownership.managedRootId, 128);
    assertSafeIdentifier(ownership.runtimeGenerationId, 128);
    assertSafeIdentifier(ownership.readLeaseId, 128);
    return true;
  } catch {
    return false;
  }
}

function sameOwnershipProof(
  left: NonNullable<Awaited<ReturnType<PrivateProbeDependencies["ownershipVerifier"]["verify"]>>>,
  right: NonNullable<Awaited<ReturnType<PrivateProbeDependencies["ownershipVerifier"]["verify"]>>>
): boolean {
  return left.kind === right.kind && left.componentId === right.componentId && left.artifactSha256 === right.artifactSha256 &&
    left.fileIdentity.volumeId === right.fileIdentity.volumeId && left.fileIdentity.fileId === right.fileIdentity.fileId &&
    left.ledgerDocumentId === right.ledgerDocumentId && left.ledgerDocumentRevision === right.ledgerDocumentRevision &&
    left.ledgerContentSha256 === right.ledgerContentSha256 && left.managedRootId === right.managedRootId &&
    left.runtimeGenerationId === right.runtimeGenerationId &&
    left.resolvedDestinationRelativePath === right.resolvedDestinationRelativePath &&
    left.destinationBinding === right.destinationBinding && left.readLeaseId === right.readLeaseId &&
    left.ledgerState === right.ledgerState && left.containment === right.containment && left.executionLease === right.executionLease;
}

type VerifiedOne = Readonly<{
  artifact: ArtifactObservation;
  ownership: Awaited<ReturnType<PrivateProbeDependencies["ownershipVerifier"]["verify"]>> & object;
}>;

type VerifyOneResult = Readonly<{ ok: true; value: VerifiedOne }> | Readonly<{
  ok: false;
  code: "MEDIA.ARTIFACT_MISMATCH" | "MEDIA.SIGNATURE_PROOF_MISSING" | "MEDIA.OWNERSHIP_PROOF_MISSING";
}>;

async function verifyOne(
  record: PrivateToolManifestRecord,
  execution: PrivateToolExecutionTarget,
  dependencies: PrivateProbeDependencies
): Promise<VerifyOneResult> {
  const artifactLimits = Object.freeze({ timeoutMs: 15_000, maximumBytes: record.artifact.byteLength });
  const artifact = await dependencies.artifactVerifier.verify(record, execution, artifactLimits).catch(() => null);
  if (!validArtifact(record, artifact)) return { ok: false, code: "MEDIA.ARTIFACT_MISMATCH" };
  const signature = await dependencies.authenticodeVerifier.verify(record, execution, artifact).catch(() => null);
  if (!signature || signature.kind !== "verified_authenticode" || signature.signerId !== record.signature.signerId ||
    signature.signedArtifactSha256 !== artifact.sha256 || signature.trustPolicy !== "release_trust_store" ||
    signature.fileIdentity.volumeId !== artifact.fileIdentity.volumeId || signature.fileIdentity.fileId !== artifact.fileIdentity.fileId) {
    return { ok: false, code: "MEDIA.SIGNATURE_PROOF_MISSING" };
  }
  const ownership = await dependencies.ownershipVerifier.verify(record, execution, artifact).catch(() => null);
  if (!validOwnershipProof(record, artifact, ownership)) {
    return { ok: false, code: "MEDIA.OWNERSHIP_PROOF_MISSING" };
  }
  return { ok: true, value: Object.freeze({ artifact, ownership }) };
}

export async function probePrivateFfmpeg(
  value: unknown,
  dependencies: PrivateProbeDependencies
): Promise<PrivateFfmpegObservation> {
  try {
    if (!validTarget(value)) return rejected("MEDIA.INVALID_REQUEST");
    const target = value;
    if (typeof dependencies !== "object" || dependencies === null ||
      typeof dependencies.catalogVerifier?.verify !== "function" || typeof dependencies.artifactVerifier?.verify !== "function" ||
      typeof dependencies.authenticodeVerifier?.verify !== "function" || typeof dependencies.ownershipVerifier?.verify !== "function" ||
      typeof dependencies.exactImageExecutor?.execute !== "function") return rejected("MEDIA.CATALOG_PROOF_MISSING");
    const catalog = await dependencies.catalogVerifier.verify(target).catch(() => null);
    let catalogAccepted = false;
    try {
      catalogAccepted = validCatalogProof(target, catalog);
    } catch {
      catalogAccepted = false;
    }
    if (!catalogAccepted) return rejected("MEDIA.CATALOG_PROOF_MISSING");
    const ffmpegVerified = await verifyOne(target.ffmpeg, target.execution.ffmpeg, dependencies);
    if (!ffmpegVerified.ok) return rejected(ffmpegVerified.code);
    const ffprobeVerified = await verifyOne(target.ffprobe, target.execution.ffprobe, dependencies);
    if (!ffprobeVerified.ok) return rejected(ffprobeVerified.code);
    const ffmpegArtifact = ffmpegVerified.value.artifact;
    const ffprobeArtifact = ffprobeVerified.value.artifact;
    if (sameIdentity(ffmpegArtifact, ffprobeArtifact)) return rejected("MEDIA.ARTIFACT_MISMATCH");
    const leftOwnership = ffmpegVerified.value.ownership;
    const rightOwnership = ffprobeVerified.value.ownership;
    if (leftOwnership.ledgerDocumentId !== rightOwnership.ledgerDocumentId ||
      leftOwnership.ledgerDocumentRevision !== rightOwnership.ledgerDocumentRevision ||
      leftOwnership.ledgerContentSha256 !== rightOwnership.ledgerContentSha256 ||
      leftOwnership.managedRootId !== rightOwnership.managedRootId ||
      leftOwnership.runtimeGenerationId !== rightOwnership.runtimeGenerationId) {
      return rejected("MEDIA.OWNERSHIP_PROOF_MISSING");
    }

    const artifacts = { ffmpeg: ffmpegArtifact, ffprobe: ffprobeArtifact } as const;
    const records = { ffmpeg: target.ffmpeg, ffprobe: target.ffprobe } as const;
    const executions = { ffmpeg: target.execution.ffmpeg, ffprobe: target.execution.ffprobe } as const;
    const capabilities = await probeFfmpegPairWithFixedRunner(async (slot, command, limits) => {
      const result: ExactImageExecutionResult = await dependencies.exactImageExecutor
        .execute(records[slot], executions[slot], artifacts[slot], slot === "ffmpeg" ? leftOwnership : rightOwnership, command, limits)
        .catch(() => ({ ok: false as const, failure: failure("MEDIA.PROCESS_SPAWN_FAILED") }));
      if (!result.ok) return result;
      if (!validateExecutorOutput(result, limits.maxOutputBytes)) {
        return { ok: false, failure: failure("MEDIA.OUTPUT_INVALID") };
      }
      if (result.processTreeProof !== "verified_job_closed_no_survivors" ||
        result.imageProof.kind !== "verified_spawned_image" || result.imageProof.componentId !== records[slot].componentId ||
        result.imageProof.artifactSha256 !== artifacts[slot].sha256 ||
        result.imageProof.loadedDependencyTreeSha256 !== records[slot].runtimeDependencyTreeSha256 ||
        result.imageProof.fileIdentity.volumeId !== artifacts[slot].fileIdentity.volumeId ||
        result.imageProof.fileIdentity.fileId !== artifacts[slot].fileIdentity.fileId) {
        return { ok: false, failure: failure("MEDIA.EXACT_IMAGE_PROOF_MISSING") };
      }
      const refreshedOwnership = await dependencies.ownershipVerifier
        .verify(records[slot], executions[slot], artifacts[slot])
        .catch(() => null);
      const initialOwnership = slot === "ffmpeg" ? leftOwnership : rightOwnership;
      if (!validOwnershipProof(records[slot], artifacts[slot], refreshedOwnership) ||
        !sameOwnershipProof(initialOwnership, refreshedOwnership)) {
        return { ok: false, failure: failure("MEDIA.OWNERSHIP_PROOF_MISSING") };
      }
      return result;
    });

    const afterFfmpeg = await dependencies.artifactVerifier.verify(target.ffmpeg, target.execution.ffmpeg, Object.freeze({ timeoutMs: 15_000, maximumBytes: target.ffmpeg.artifact.byteLength })).catch(() => null);
    const afterFfprobe = await dependencies.artifactVerifier.verify(target.ffprobe, target.execution.ffprobe, Object.freeze({ timeoutMs: 15_000, maximumBytes: target.ffprobe.artifact.byteLength })).catch(() => null);
    if (!validArtifact(target.ffmpeg, afterFfmpeg) || !validArtifact(target.ffprobe, afterFfprobe) ||
      !sameIdentity(ffmpegArtifact, afterFfmpeg) || !sameIdentity(ffprobeArtifact, afterFfprobe)) {
      return rejected("MEDIA.ARTIFACT_MISMATCH");
    }
    const afterLeftOwnership = await dependencies.ownershipVerifier.verify(target.ffmpeg, target.execution.ffmpeg, afterFfmpeg).catch(() => null);
    const afterRightOwnership = await dependencies.ownershipVerifier.verify(target.ffprobe, target.execution.ffprobe, afterFfprobe).catch(() => null);
    if (!validOwnershipProof(target.ffmpeg, afterFfmpeg, afterLeftOwnership) ||
      !validOwnershipProof(target.ffprobe, afterFfprobe, afterRightOwnership) ||
      !sameOwnershipProof(leftOwnership, afterLeftOwnership) ||
      !sameOwnershipProof(rightOwnership, afterRightOwnership)) {
      return rejected("MEDIA.OWNERSHIP_PROOF_MISSING");
    }
    return Object.freeze({
      status: "available",
      source: "verified_private_pair",
      selectable: true,
      selected: false,
      catalogContentSha256: target.manifest.contentSha256,
      ffmpegComponentId: target.ffmpeg.componentId,
      ffprobeComponentId: target.ffprobe.componentId,
      artifacts: Object.freeze({
        ffmpeg: Object.freeze({ componentVersion: target.ffmpeg.componentVersion, artifactSha256: target.ffmpeg.artifact.sha256, dependencyTreeSha256: target.ffmpeg.runtimeDependencyTreeSha256 }),
        ffprobe: Object.freeze({ componentVersion: target.ffprobe.componentVersion, artifactSha256: target.ffprobe.artifact.sha256, dependencyTreeSha256: target.ffprobe.runtimeDependencyTreeSha256 })
      }),
      capabilities
    });
  } catch (error) {
    const code = error instanceof Error && /^MEDIA\./u.test(error.message) ? error.message as Parameters<typeof rejected>[0] : "MEDIA.OUTPUT_INVALID";
    return rejected(code);
  }
}
