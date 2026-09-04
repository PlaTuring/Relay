import { AUTHORITY } from "./constants.mjs";
import {
  chooseManagedRoot,
  collectModelRoots,
  discoverComfyInstallations,
  publicInstallations
} from "./discovery.mjs";
import { runtimeFail } from "./errors.mjs";
import { createLiveFileAdapter } from "./filesystem.mjs";
import { discoverH3Assets, verifyH3Assets } from "./models.mjs";
import { assertClosedObject, deepFreeze, normalizeWindowsAbsolutePath, sha256Json } from "./util.mjs";
import { probeWindowsHost } from "./windows-probe.mjs";

const REQUEST_FIELDS = new Set([
  "request_version",
  "known_comfy_roots",
  "user_comfy_roots",
  "user_model_roots",
  "managed_root"
]);

function pathArray(value, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 128) {
    runtimeFail("LOCAL_RUNTIME.INVALID_REQUEST", "request", `local_runtime.request.${field}.bounded_array`);
  }
  return value.map((item) => normalizeWindowsAbsolutePath(item, "request"));
}

function validateRequest(request) {
  assertClosedObject(request, REQUEST_FIELDS, "request", "local_runtime.request");
  if (request.request_version !== "1.0.0") {
    runtimeFail("LOCAL_RUNTIME.UNSUPPORTED_VERSION", "request", "local_runtime.request.version_exact");
  }
  if (request.managed_root !== undefined && request.managed_root !== null) {
    normalizeWindowsAbsolutePath(request.managed_root, "request");
  }
  return {
    request_version: request.request_version,
    known_comfy_roots: pathArray(request.known_comfy_roots, "known_comfy_roots"),
    user_comfy_roots: pathArray(request.user_comfy_roots, "user_comfy_roots"),
    user_model_roots: pathArray(request.user_model_roots, "user_model_roots"),
    managed_root: request.managed_root ?? null
  };
}

function publicManagedRoot(value) {
  const { private_path: _privatePath, ...publicValue } = value;
  return publicValue;
}

function componentInstallPlan(installations, managedRoot, models) {
  const actions = [];
  if (installations.length) {
    actions.push({
      action_id: "attach-existing-comfy",
      kind: "attach_external_runtime",
      status: "planned_read_only",
      installation_ref: installations[0].installation_ref,
      mutation_authority: "none"
    });
  } else {
    actions.push({
      action_id: "prepare-managed-runtime",
      kind: "managed_runtime_install",
      status: managedRoot.status === "eligible_for_explicit_prepare" ? "blocked_until_signed_catalog_and_explicit_transaction" : "blocked_no_eligible_root",
      mutation_authority: "explicit_transaction_only"
    });
  }
  for (const asset of models.assets) {
    const identityPending = asset.current_stage === "identified" && !asset.progression.verified;
    actions.push({
      action_id: `model-${asset.role}`,
      kind: asset.progression.verified
        ? "reuse_external_model"
        : identityPending
          ? "model_identity_pending"
          : "model_artifact_missing",
      status: asset.progression.verified
        ? "planned_read_only_zero_download_bytes"
        : identityPending
          ? "blocked_until_full_sha256"
          : "blocked_plan_only",
      role: asset.role,
      mutation_authority: "none",
      external_tool_owned: false
    });
  }
  return {
    transaction_model: "restart_safe_journal_explicit_commit",
    execution_authority: "none_plan_only",
    actions
  };
}

function publicHardware(host) {
  return {
    probe_status: host.probe_status,
    system: host.system,
    volumes: host.volumes,
    gpus: host.gpus,
    failures: host.failures
  };
}

export function createLocalRuntimeService(dependencies = {}) {
  const fileAdapter = dependencies.fileAdapter ?? createLiveFileAdapter();
  const hostProbe = dependencies.hostProbe ?? { probe: () => probeWindowsHost() };
  const inspectModels = dependencies.modelInspectionMode === "full"
    ? verifyH3Assets
    : discoverH3Assets;
  if (!hostProbe || typeof hostProbe.probe !== "function") {
    runtimeFail("LOCAL_RUNTIME.INVALID_DEPENDENCY", "configuration", "local_runtime.dependency.host_probe");
  }
  return Object.freeze({
    async inspect(request) {
      const validated = validateRequest(request);
      const host = await hostProbe.probe();
      const managedRoot = chooseManagedRoot(host, validated.managed_root);
      const installations = await discoverComfyInstallations({
        host,
        knownRoots: validated.known_comfy_roots,
        userRoots: validated.user_comfy_roots,
        fileAdapter
      });
      const modelRoots = collectModelRoots(installations, validated.user_model_roots);
      const models = await inspectModels({ modelRoots, fileAdapter });
      const publicComfy = publicInstallations(installations);
      const core = {
        response_version: "1.0.0",
        evidence_mode: dependencies.evidenceMode ?? "live_read_only",
        redacted: true,
        authority: AUTHORITY,
        hardware: publicHardware(host),
        storage: { managed_root: publicManagedRoot(managedRoot) },
        comfy: {
          discovery_scope: "fixed_known_candidates_and_explicit_user_roots",
          installations: publicComfy,
          attach_candidate_count: publicComfy.length
        },
        models,
        component_install_plan: componentInstallPlan(publicComfy, managedRoot, models),
        attach_plan: {
          status: publicComfy.length && models.all_five_byte_identities_verified ? "ready_for_external_approval_and_exact_recipe_binding" : "blocked",
          portable_or_core_attached: publicComfy.length > 0,
          all_five_byte_identities_verified: models.all_five_byte_identities_verified,
          external_models_read_only: true,
          comfy_started: false,
          custom_nodes_imported: false,
          network_called: false,
          model_executed: false,
          prompt_submitted: false
        }
      };
      const planDigest = sha256Json(core);
      return deepFreeze({ ...core, plan_digest: planDigest });
    }
  });
}

export async function inspectLocalRuntime(request, dependencies = {}) {
  return createLocalRuntimeService(dependencies).inspect(request);
}
