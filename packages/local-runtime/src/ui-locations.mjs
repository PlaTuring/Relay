import path from "node:path";

import { INSTALL_CATALOG } from "./catalog.mjs";
import { discoverComfyInstallations, knownPortableRoots } from "./discovery.mjs";
import { runtimeFail } from "./errors.mjs";
import { createLiveFileAdapter } from "./filesystem.mjs";
import {
  assertClosedObject,
  deepFreeze,
  normalizeWindowsAbsolutePath,
  uniqueWindowsPaths
} from "./util.mjs";
import { probeWindowsHost } from "./windows-probe.mjs";

const REQUEST_FIELDS = new Set([
  "request_version",
  "known_comfy_roots",
  "user_comfy_roots",
  "user_model_roots"
]);
const MAX_CANDIDATE_ROOTS = 128;
const DEFAULT_DEADLINE_MILLISECONDS = 8_000;
const EMPTY_HOST = Object.freeze({ volumes: Object.freeze([]) });
const MODEL_ARTIFACTS = Object.freeze(INSTALL_CATALOG.artifacts.filter((artifact) => artifact.kind === "model"));

function pathArray(value, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_CANDIDATE_ROOTS) {
    runtimeFail(
      "LOCAL_RUNTIME.INVALID_UI_LOCATIONS_REQUEST",
      "ui_locations",
      `local_runtime.ui_locations.${field}.bounded_array`
    );
  }
  return uniqueWindowsPaths(value.map((item) => normalizeWindowsAbsolutePath(item, "ui_locations")));
}

function validateRequest(request) {
  assertClosedObject(request, REQUEST_FIELDS, "ui_locations", "local_runtime.ui_locations.request");
  if (request.request_version !== "1.0.0") {
    runtimeFail(
      "LOCAL_RUNTIME.UNSUPPORTED_VERSION",
      "ui_locations",
      "local_runtime.ui_locations.request.version_exact"
    );
  }
  return {
    knownComfyRoots: pathArray(request.known_comfy_roots, "known_comfy_roots"),
    userComfyRoots: pathArray(request.user_comfy_roots, "user_comfy_roots"),
    userModelRoots: pathArray(request.user_model_roots, "user_model_roots")
  };
}

function fixedCoreRoots(host) {
  const roots = [];
  for (const volume of Array.isArray(host?.volumes) ? host.volumes : []) {
    if (volume?.drive_type !== "fixed_local" || typeof volume.drive_letter !== "string" || !/^[A-Z]:$/u.test(volume.drive_letter)) continue;
    roots.push(`${volume.drive_letter}\\AI\\ComfyUI`);
    roots.push(`${volume.drive_letter}\\ComfyUI`);
  }
  return uniqueWindowsPaths(roots);
}

function fixedModelRoots(host) {
  const roots = [];
  for (const volume of Array.isArray(host?.volumes) ? host.volumes : []) {
    if (volume?.drive_type !== "fixed_local" || typeof volume.drive_letter !== "string" || !/^[A-Z]:$/u.test(volume.drive_letter)) continue;
    const drive = volume.drive_letter;
    roots.push(`${drive}\\AI\\ComfyUI_windows_portable\\ComfyUI\\models`);
    roots.push(`${drive}\\ComfyUI_windows_portable\\ComfyUI\\models`);
    roots.push(`${drive}\\AI\\ComfyUI\\models`);
    roots.push(`${drive}\\ComfyUI\\models`);
    roots.push(`${drive}\\MiniMaxH3\\runtime\\ComfyUI_windows_portable\\ComfyUI\\models`);
  }
  return uniqueWindowsPaths(roots);
}

function installationByInputOrder(installations, roots) {
  const byRoot = new Map(installations.map((installation) => [installation.private_root.toUpperCase(), installation]));
  for (const root of roots) {
    const installation = byRoot.get(root.toUpperCase());
    if (installation) return installation;
  }
  return null;
}

async function inspectComfyCandidates(roots, fileAdapter) {
  if (roots.length === 0) return [];
  return discoverComfyInstallations({
    host: EMPTY_HOST,
    knownRoots: roots.slice(0, MAX_CANDIDATE_ROOTS),
    fileAdapter
  });
}

async function inspectModelRoot(root, source, order, fileAdapter) {
  if (typeof fileAdapter.pathSafety === "function" && await fileAdapter.pathSafety(root) !== "safe") return null;
  const rootObservation = await fileAdapter.inspect(root);
  if (rootObservation.kind !== "directory") return null;
  const roles = [];
  for (const artifact of MODEL_ARTIFACTS) {
    const candidate = path.win32.join(root, ...artifact.relative_path.split("/"));
    if (typeof fileAdapter.pathSafety === "function" && await fileAdapter.pathSafety(candidate) !== "safe") continue;
    const observation = await fileAdapter.inspect(candidate);
    if (observation.kind === "file" && observation.byte_length === artifact.expected_byte_length) roles.push(artifact.role);
  }
  return {
    source,
    root_path: root,
    recognized_asset_count: roles.length,
    recognized_roles: roles,
    order
  };
}

function chooseModelRoot(candidates) {
  const usable = candidates.filter((candidate) => candidate !== null && candidate.recognized_asset_count > 0);
  usable.sort((left, right) =>
    right.recognized_asset_count - left.recognized_asset_count ||
    (left.source === right.source ? 0 : left.source === "explicit" ? -1 : 1) ||
    left.order - right.order);
  return usable[0] ?? null;
}

function missingResult(deadlineExceeded = false, deadlineMilliseconds = DEFAULT_DEADLINE_MILLISECONDS) {
  return deepFreeze({
    response_version: "1.0.0",
    sensitivity: "local_ui_only_do_not_log_or_export",
    locations: {
      comfy: { source: "missing", root_path: null, topology: null },
      models: {
        source: "missing",
        root_path: null,
        recognized_asset_count: 0,
        expected_asset_count: MODEL_ARTIFACTS.length,
        recognized_roles: []
      }
    },
    inspection: {
      bounded: true,
      deadline_milliseconds: deadlineMilliseconds,
      deadline_exceeded: deadlineExceeded,
      max_candidate_roots: MAX_CANDIDATE_ROOTS,
      inspected_comfy_root_count: 0,
      inspected_model_root_count: 0,
      recursive_scan: false,
      custom_nodes_imported: false,
      model_content_hashed: false,
      network_called: false
    }
  });
}

async function resolveWithinDeadline(validated, dependencies, deadlineMilliseconds) {
  const fileAdapter = dependencies.fileAdapter ?? createLiveFileAdapter();
  const hostProbe = dependencies.hostProbe ?? { probe: () => probeWindowsHost() };
  const host = await hostProbe.probe();

  const explicitComfyRoots = validated.userComfyRoots.slice(0, MAX_CANDIDATE_ROOTS);
  const explicitInstallations = await inspectComfyCandidates(explicitComfyRoots, fileAdapter);
  const explicitComfy = installationByInputOrder(explicitInstallations, explicitComfyRoots);
  const detectedComfyRoots = uniqueWindowsPaths([
    ...validated.knownComfyRoots,
    ...knownPortableRoots(host),
    ...fixedCoreRoots(host)
  ]).filter((root) => !explicitComfyRoots.some((explicit) => explicit.toUpperCase() === root.toUpperCase()))
    .slice(0, Math.max(0, MAX_CANDIDATE_ROOTS - explicitComfyRoots.length));
  const detectedInstallations = await inspectComfyCandidates(detectedComfyRoots, fileAdapter);
  const detectedComfy = installationByInputOrder(detectedInstallations, detectedComfyRoots);
  const selectedComfy = explicitComfy ?? detectedComfy;
  const selectedComfySource = explicitComfy ? "explicit" : detectedComfy ? "detected" : "missing";

  const derivedModelRoots = [...explicitInstallations, ...detectedInstallations]
    .flatMap((installation) => installation.private_model_roots);
  const detectedModelRoots = uniqueWindowsPaths([
    ...derivedModelRoots,
    ...fixedModelRoots(host)
  ]);
  const candidateDescriptors = [];
  const seen = new Set();
  for (const [source, roots] of [["explicit", validated.userModelRoots], ["detected", detectedModelRoots]]) {
    for (const root of roots) {
      const key = root.toUpperCase();
      if (seen.has(key) || candidateDescriptors.length >= MAX_CANDIDATE_ROOTS) continue;
      seen.add(key);
      candidateDescriptors.push({ source, root, order: candidateDescriptors.length });
    }
  }
  const inspectedModelRoots = [];
  for (const candidate of candidateDescriptors) {
    inspectedModelRoots.push(await inspectModelRoot(candidate.root, candidate.source, candidate.order, fileAdapter));
  }
  const selectedModels = chooseModelRoot(inspectedModelRoots);

  return deepFreeze({
    response_version: "1.0.0",
    sensitivity: "local_ui_only_do_not_log_or_export",
    locations: {
      comfy: selectedComfy === null
        ? { source: "missing", root_path: null, topology: null }
        : { source: selectedComfySource, root_path: selectedComfy.private_root, topology: selectedComfy.topology },
      models: selectedModels === null
        ? {
            source: "missing",
            root_path: null,
            recognized_asset_count: 0,
            expected_asset_count: MODEL_ARTIFACTS.length,
            recognized_roles: []
          }
        : {
            source: selectedModels.source,
            root_path: selectedModels.root_path,
            recognized_asset_count: selectedModels.recognized_asset_count,
            expected_asset_count: MODEL_ARTIFACTS.length,
            recognized_roles: selectedModels.recognized_roles
          }
    },
    inspection: {
      bounded: true,
      deadline_milliseconds: deadlineMilliseconds,
      deadline_exceeded: false,
      max_candidate_roots: MAX_CANDIDATE_ROOTS,
      inspected_comfy_root_count: explicitComfyRoots.length + detectedComfyRoots.length,
      inspected_model_root_count: candidateDescriptors.length,
      recursive_scan: false,
      custom_nodes_imported: false,
      model_content_hashed: false,
      network_called: false
    }
  });
}

export async function resolveUiLocations(request, dependencies = {}) {
  const validated = validateRequest(request);
  const configuredDeadline = dependencies.uiLocationsDeadlineMilliseconds;
  const deadlineMilliseconds = Number.isSafeInteger(configuredDeadline) && configuredDeadline > 0
    ? Math.min(configuredDeadline, DEFAULT_DEADLINE_MILLISECONDS)
    : DEFAULT_DEADLINE_MILLISECONDS;
  let timeoutHandle;
  const timeout = new Promise((resolve) => {
    timeoutHandle = setTimeout(() => resolve(missingResult(true, deadlineMilliseconds)), deadlineMilliseconds);
  });
  try {
    return await Promise.race([
      resolveWithinDeadline(validated, dependencies, deadlineMilliseconds),
      timeout
    ]);
  } finally {
    clearTimeout(timeoutHandle);
  }
}
