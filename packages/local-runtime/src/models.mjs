import path from "node:path";

import { H3_ATTACH_PROFILE } from "./constants.mjs";
import { createLiveFileAdapter } from "./filesystem.mjs";
import { compareOrdinal, deepFreeze, redactWindowsPath, sumSafeIntegers } from "./util.mjs";

function candidatePaths(root, artifact) {
  const relative = artifact.relative_path.replaceAll("/", "\\");
  return [
    path.win32.join(root, relative),
    path.win32.join(root, artifact.filename),
    path.win32.join(root, "models", relative),
    path.win32.join(root, "ComfyUI", "models", relative)
  ];
}

function publicCandidatePath(filePath, role) {
  return {
    path_ref: `external-candidate-${role}`,
    display_path: redactWindowsPath(filePath)
  };
}

async function inspectOneArtifact(artifact, roots, fileAdapter, verifyIdentity) {
  const seen = new Set();
  let found = null;
  let identified = null;
  let mismatchReason = "not_found";
  for (const root of roots) {
    for (const filePath of candidatePaths(root, artifact)) {
      const key = filePath.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      if (seen.size > 1024) break;
      const observation = await fileAdapter.inspect(filePath);
      if (observation.kind === "reparse") {
        mismatchReason = "reparse_candidate_forbidden";
        continue;
      }
      if (observation.kind !== "file") continue;
      if (typeof fileAdapter.pathSafety === "function" && await fileAdapter.pathSafety(filePath) !== "safe") {
        mismatchReason = "reparse_candidate_forbidden";
        continue;
      }
      found ??= { filePath, observation };
      if (observation.byte_length !== artifact.expected_byte_length) {
        mismatchReason = "byte_length_mismatch";
        continue;
      }
      identified ??= { filePath, observation };
      if (!verifyIdentity) {
        const location = publicCandidatePath(filePath, artifact.role);
        return deepFreeze({
          role: artifact.role,
          requirement: artifact.requirement,
          current_stage: "identified",
          progression: {
            found: true,
            identified: true,
            verified: false,
            compatible: false,
            approved: false,
            selected: false
          },
          location,
          expected_byte_length: artifact.expected_byte_length,
          expected_artifact_sha256: artifact.expected_artifact_sha256,
          observed_byte_length: observation.byte_length,
          verified_artifact_sha256: null,
          external_ownership: {
            ownership_class: "external_read_only",
            tool_owned: false,
            delete_authority: "never",
            mutation_authority: "none"
          },
          reuse_plan: {
            status: "full_sha256_required_before_reuse",
            download_bytes: null,
            authorization: "blocked_until_full_sha256_and_exact_compatible_approved_selected_binding"
          },
          reason: "full_sha256_required_before_reuse",
          source_evidence_status: artifact.source.evidence_status
        });
      }
      const hash = await fileAdapter.sha256(filePath, artifact.expected_byte_length);
      if (hash.status !== "complete") {
        mismatchReason = "full_hash_read_failed_or_identity_changed";
        continue;
      }
      if (hash.artifact_sha256 !== artifact.expected_artifact_sha256) {
        mismatchReason = "artifact_sha256_mismatch";
        continue;
      }
      const location = publicCandidatePath(filePath, artifact.role);
      return deepFreeze({
        role: artifact.role,
        requirement: artifact.requirement,
        current_stage: "verified",
        progression: {
          found: true,
          identified: true,
          verified: true,
          compatible: false,
          approved: false,
          selected: false
        },
        location,
        expected_byte_length: artifact.expected_byte_length,
        expected_artifact_sha256: artifact.expected_artifact_sha256,
        observed_byte_length: observation.byte_length,
        verified_artifact_sha256: hash.artifact_sha256,
        external_ownership: {
          ownership_class: "external_read_only",
          tool_owned: false,
          delete_authority: "never",
          mutation_authority: "none"
        },
        reuse_plan: {
          status: "verified_external_candidate_plan_only",
          download_bytes: 0,
          authorization: "blocked_until_exact_compatible_approved_selected_binding"
        },
        source_evidence_status: artifact.source.evidence_status
      });
    }
  }
  const basis = identified ?? found;
  return deepFreeze({
    role: artifact.role,
    requirement: artifact.requirement,
    current_stage: identified ? "identified" : found ? "found" : "not_found",
    progression: {
      found: Boolean(found),
      identified: Boolean(identified),
      verified: false,
      compatible: false,
      approved: false,
      selected: false
    },
    location: basis ? publicCandidatePath(basis.filePath, artifact.role) : null,
    expected_byte_length: artifact.expected_byte_length,
    expected_artifact_sha256: artifact.expected_artifact_sha256,
    observed_byte_length: basis?.observation.byte_length ?? null,
    verified_artifact_sha256: null,
    external_ownership: {
      ownership_class: "external_read_only",
      tool_owned: false,
      delete_authority: "never",
      mutation_authority: "none"
    },
    reuse_plan: {
      status: "not_reusable",
      download_bytes: null,
      authorization: "none"
    },
    reason: mismatchReason,
    source_evidence_status: artifact.source.evidence_status
  });
}

async function inspectH3Assets({ modelRoots, fileAdapter, verifyIdentity }) {
  const assets = [];
  for (const artifact of H3_ATTACH_PROFILE.assets) {
    assets.push(await inspectOneArtifact(artifact, modelRoots, fileAdapter, verifyIdentity));
  }
  assets.sort((left, right) => compareOrdinal(left.role, right.role));
  const verified = assets.filter((asset) => asset.progression.verified);
  const pending = verifyIdentity
    ? []
    : assets.filter((asset) => asset.current_stage === "identified" && !asset.progression.verified);
  const pendingRoles = new Set(pending.map((asset) => asset.role));
  const unresolved = H3_ATTACH_PROFILE.assets.filter((artifact) => !verified.some((asset) => asset.role === artifact.role));
  const missing = unresolved.filter((artifact) => !pendingRoles.has(artifact.role));
  const avoidedDownloadBytes = sumSafeIntegers(verified.map((asset) => asset.expected_byte_length));
  const pendingVerificationBytes = sumSafeIntegers(pending.map((asset) => asset.expected_byte_length));
  const missingDownloadBytes = sumSafeIntegers(missing.map((asset) => asset.expected_byte_length));
  const missingFileDownloadPlan = unresolved.map((artifact) => {
    const asset = assets.find((candidate) => candidate.role === artifact.role);
    const requiresVerification = asset?.current_stage === "identified";
    return {
      role: artifact.role,
      requirement: artifact.requirement,
      expected_byte_length: artifact.expected_byte_length,
      expected_artifact_sha256: artifact.expected_artifact_sha256,
      destination_relative_path: artifact.relative_path,
      source_repository: artifact.source.repository,
      source_revision: artifact.source.revision,
      source_relative_path: artifact.source.relative_path,
      action: requiresVerification
        ? "full_sha256_then_reuse_or_download_plan_only"
        : "download_plan_only_no_network_authority",
      evidence_status: artifact.source.evidence_status
    };
  });
  return deepFreeze({
    profile_id: H3_ATTACH_PROFILE.profile_id,
    profile_status: H3_ATTACH_PROFILE.profile_status,
    expected_asset_count: H3_ATTACH_PROFILE.assets.length,
    verified_asset_count: verified.length,
    all_five_byte_identities_verified: verified.length === H3_ATTACH_PROFILE.assets.length,
    assets,
    totals: {
      reuse_download_bytes: 0,
      avoided_download_bytes: avoidedDownloadBytes,
      pending_verification_bytes: pendingVerificationBytes,
      missing_download_bytes: missingDownloadBytes
    },
    missing_file_download_plan: {
      authority: "none_plan_only",
      network_called: false,
      entries: missingFileDownloadPlan
    },
    selection_authority: "none_until_exact_compatible_approved_selected_binding"
  });
}

/**
 * Performs bounded, metadata-only discovery. This phase intentionally never
 * reads model contents and therefore never marks a candidate as verified or
 * reusable. Full SHA-256 verification remains a separate authorization gate.
 */
export async function discoverH3Assets({ modelRoots, fileAdapter = createLiveFileAdapter() }) {
  return inspectH3Assets({ modelRoots, fileAdapter, verifyIdentity: false });
}

/**
 * Performs full byte-identity verification. Callers may only authorize reuse
 * from this result (or from another operation that performs the same complete
 * SHA-256 verification against the immutable catalog identity).
 */
export async function verifyH3Assets({ modelRoots, fileAdapter = createLiveFileAdapter() }) {
  return inspectH3Assets({ modelRoots, fileAdapter, verifyIdentity: true });
}
