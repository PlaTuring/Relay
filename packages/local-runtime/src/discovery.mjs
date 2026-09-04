import path from "node:path";

import { createLiveFileAdapter } from "./filesystem.mjs";
import {
  compareOrdinal,
  deepFreeze,
  driveLetterOf,
  normalizeWindowsAbsolutePath,
  redactWindowsPath,
  sha256Text,
  uniqueWindowsPaths
} from "./util.mjs";

function normalizedVolumes(host) {
  return (Array.isArray(host?.volumes) ? host.volumes : []).filter((volume) =>
    volume &&
    typeof volume.drive_letter === "string" &&
    /^[A-Z]:$/u.test(volume.drive_letter) &&
    volume.drive_type === "fixed_local" &&
    typeof volume.filesystem === "string"
  );
}

export function chooseManagedRoot(host, requestedRoot) {
  const volumes = normalizedVolumes(host);
  let candidate = null;
  let source = "none";
  if (requestedRoot !== undefined && requestedRoot !== null) {
    candidate = normalizeWindowsAbsolutePath(requestedRoot, "managed_root");
    source = "user_selected";
  } else if (volumes.some((volume) => volume.drive_letter === "D:" && volume.filesystem.toLowerCase() === "ntfs")) {
    candidate = "D:\\MiniMaxH3";
    source = "default_visible_d";
  }
  if (candidate === null) {
    return deepFreeze({
      status: "blocked",
      reason: "no_supported_d_volume_and_no_user_selection",
      source,
      display_path: null,
      path_ref: null,
      private_path: null,
      silent_c_fallback: false
    });
  }
  const drive = driveLetterOf(candidate);
  const volume = volumes.find((item) => item.drive_letter === drive);
  const supported = Boolean(volume && volume.filesystem.toLowerCase() === "ntfs");
  return deepFreeze({
    status: supported ? "eligible_for_explicit_prepare" : "blocked",
    reason: supported ? "fixed_local_ntfs" : "selected_volume_not_fixed_ntfs",
    source,
    display_path: redactWindowsPath(candidate),
    path_ref: "managed-root-selected",
    private_path: candidate,
    silent_c_fallback: false
  });
}

export function knownPortableRoots(host) {
  const roots = [];
  for (const volume of normalizedVolumes(host)) {
    if (volume.filesystem.toLowerCase() !== "ntfs") continue;
    roots.push(`${volume.drive_letter}\\AI\\ComfyUI_windows_portable`);
    roots.push(`${volume.drive_letter}\\ComfyUI_windows_portable`);
  }
  return uniqueWindowsPaths(roots);
}

async function markerKind(fileAdapter, candidate) {
  return (await fileAdapter.inspect(candidate)).kind;
}

async function inspectPortableRoot(fileAdapter, root) {
  if (typeof fileAdapter.pathSafety === "function" && await fileAdapter.pathSafety(root) !== "safe") return null;
  const rootKind = await markerKind(fileAdapter, root);
  if (rootKind !== "directory") return null;
  const comfyRoot = path.win32.join(root, "ComfyUI");
  const markers = [
    path.win32.join(comfyRoot, "main.py"),
    path.win32.join(comfyRoot, "comfy", "cli_args.py")
  ];
  const embeddedCandidates = [
    path.win32.join(root, "python_embeded", "python.exe"),
    path.win32.join(root, "python_embedded", "python.exe")
  ];
  const markerKinds = await Promise.all(markers.map((candidate) => markerKind(fileAdapter, candidate)));
  const embeddedKinds = await Promise.all(embeddedCandidates.map((candidate) => markerKind(fileAdapter, candidate)));
  if (markerKinds.some((kind) => kind !== "file") || !embeddedKinds.some((kind) => kind === "file")) return null;
  return {
    topology: "portable",
    status: "attach_only_static_markers",
    installation_ref: sha256Text(root.toUpperCase()),
    display_root: redactWindowsPath(root),
    private_root: root,
    private_model_roots: [path.win32.join(comfyRoot, "models")],
    ownership: "external_read_only",
    custom_node_imported: false,
    process_started: false
  };
}

async function inspectCoreRoot(fileAdapter, root) {
  if (typeof fileAdapter.pathSafety === "function" && await fileAdapter.pathSafety(root) !== "safe") return null;
  const rootKind = await markerKind(fileAdapter, root);
  if (rootKind !== "directory") return null;
  const markers = [path.win32.join(root, "main.py"), path.win32.join(root, "comfy", "cli_args.py")];
  const kinds = await Promise.all(markers.map((candidate) => markerKind(fileAdapter, candidate)));
  if (kinds.some((kind) => kind !== "file")) return null;
  return {
    topology: "core",
    status: "attach_only_static_markers",
    installation_ref: sha256Text(root.toUpperCase()),
    display_root: redactWindowsPath(root),
    private_root: root,
    private_model_roots: [path.win32.join(root, "models")],
    ownership: "external_read_only",
    custom_node_imported: false,
    process_started: false
  };
}

export async function discoverComfyInstallations({
  host,
  knownRoots = [],
  userRoots = [],
  fileAdapter = createLiveFileAdapter()
}) {
  const roots = uniqueWindowsPaths([...knownPortableRoots(host), ...knownRoots, ...userRoots]);
  const installations = [];
  for (const root of roots.slice(0, 128)) {
    const portable = await inspectPortableRoot(fileAdapter, root);
    if (portable) {
      installations.push(portable);
      continue;
    }
    const core = await inspectCoreRoot(fileAdapter, root);
    if (core) installations.push(core);
  }
  installations.sort((left, right) => compareOrdinal(left.installation_ref, right.installation_ref));
  return deepFreeze(installations);
}

export function publicInstallations(installations) {
  return deepFreeze(installations.map(({ private_root: _root, private_model_roots: _models, installation_ref: _privateRef, ...publicValue }, index) => ({
    ...publicValue,
    installation_ref: `installation-${index + 1}`
  })));
}

export function collectModelRoots(installations, userModelRoots = []) {
  const roots = [];
  for (const installation of installations) roots.push(...installation.private_model_roots);
  roots.push(...userModelRoots);
  return uniqueWindowsPaths(roots).slice(0, 256);
}
