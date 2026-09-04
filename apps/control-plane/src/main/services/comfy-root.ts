import { lstat, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";

import { ControlPlaneServiceError } from "./errors.js";

export interface VerifiedComfyRoot {
  readonly root: string;
  readonly comfyDirectory: string;
  readonly inputDirectory: string;
  readonly outputDirectory: string;
  readonly workflowDirectory: string;
  readonly mainScript: string;
  readonly embeddedPython: string | null;
  readonly topology: "portable" | "core";
}

function sameWindowsPath(left: string, right: string): boolean {
  return resolve(left).toLocaleLowerCase("en-US") === resolve(right).toLocaleLowerCase("en-US");
}

async function directPath(path: string, kind: "file" | "directory"): Promise<boolean> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) return false;
    if (kind === "file" ? !metadata.isFile() : !metadata.isDirectory()) return false;
    return sameWindowsPath(await realpath(path), path);
  } catch {
    return false;
  }
}

async function portableRoot(root: string): Promise<VerifiedComfyRoot | null> {
  const comfyRoot = join(root, "ComfyUI");
  const inputDirectory = join(comfyRoot, "input");
  const embeddedPythonCandidates = [
    join(root, "python_embeded", "python.exe"),
    join(root, "python_embedded", "python.exe")
  ];
  if (
    !(await directPath(root, "directory")) ||
    !(await directPath(join(comfyRoot, "main.py"), "file")) ||
    !(await directPath(join(comfyRoot, "comfy", "cli_args.py"), "file")) ||
    !(await directPath(inputDirectory, "directory")) ||
    !(await Promise.any(embeddedPythonCandidates.map(async (path) => {
      if (!(await directPath(path, "file"))) throw new Error("missing");
      return true;
    })).catch(() => false))
  ) return null;
  const embeddedPython = await Promise.any(
    embeddedPythonCandidates.map(async (candidate) => {
      if (!(await directPath(candidate, "file"))) throw new Error("missing");
      return candidate;
    })
  ).catch(() => null);
  if (embeddedPython === null) return null;
  return Object.freeze({
    root,
    comfyDirectory: comfyRoot,
    inputDirectory,
    outputDirectory: join(comfyRoot, "output"),
    workflowDirectory: join(comfyRoot, "user", "default", "workflows"),
    mainScript: join(comfyRoot, "main.py"),
    embeddedPython,
    topology: "portable"
  });
}

async function coreRoot(root: string): Promise<VerifiedComfyRoot | null> {
  const inputDirectory = join(root, "input");
  if (
    !(await directPath(root, "directory")) ||
    !(await directPath(join(root, "main.py"), "file")) ||
    !(await directPath(join(root, "comfy", "cli_args.py"), "file")) ||
    !(await directPath(inputDirectory, "directory"))
  ) return null;
  return Object.freeze({
    root,
    comfyDirectory: root,
    inputDirectory,
    outputDirectory: join(root, "output"),
    workflowDirectory: join(root, "user", "default", "workflows"),
    mainScript: join(root, "main.py"),
    embeddedPython: null,
    topology: "core"
  });
}

export async function verifyUserSelectedComfyRoot(
  root: string | null
): Promise<VerifiedComfyRoot | null> {
  if (root === null) return null;
  const verified = (await portableRoot(root)) ?? (await coreRoot(root));
  if (verified === null) {
    throw new ControlPlaneServiceError(
      "INVALID_REQUEST",
      "用户选择的 ComfyUI 根目录缺少静态 markers、input 目录，或经过 reparse。"
    );
  }
  return verified;
}
