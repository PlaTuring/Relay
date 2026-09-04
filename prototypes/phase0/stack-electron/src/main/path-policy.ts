import { existsSync } from "node:fs";
import path from "node:path";

import type { ManagedRootInspection } from "../shared/contracts";

const DRIVE_ABSOLUTE_PATTERN = /^[A-Za-z]:[\\/]/;
const DEVICE_OR_UNC_PATTERN = /^(?:\\\\|\\\\\?\\|\\\\\.\\)/;

export function inspectWindowsManagedRoot(
  candidate: string,
  systemDrive = process.env.SystemDrive ?? "C:"
): ManagedRootInspection {
  if (
    candidate.length === 0 ||
    candidate.length > 32_767 ||
    candidate.includes("\0") ||
    DEVICE_OR_UNC_PATTERN.test(candidate) ||
    !DRIVE_ABSOLUTE_PATTERN.test(candidate)
  ) {
    throw new TypeError("Choose an absolute path on a local Windows drive.");
  }

  const displayPath = path.win32.normalize(candidate);
  const driveRoot = path.win32.parse(displayPath).root;
  const drive = driveRoot.slice(0, 2).toUpperCase();
  const normalizedSystemDrive = systemDrive.slice(0, 2).toUpperCase();
  const isSystemDrive = drive === normalizedSystemDrive;
  const warnings: string[] = [];

  if (isSystemDrive) {
    warnings.push(
      "This is the Windows system drive. Large runtime/model/cache/output data must not silently default here."
    );
  }
  if (displayPath.toUpperCase() === driveRoot.toUpperCase()) {
    warnings.push("Choose a visible subdirectory instead of the volume root.");
  }

  return Object.freeze({
    displayPath,
    drive,
    isSystemDrive,
    containsSpaces: /\s/u.test(displayPath),
    containsUnicode: /[^\x00-\x7F]/u.test(displayPath),
    warnings: Object.freeze(warnings)
  });
}

export function suggestedManagedRoot(
  volumeExists: (candidate: string) => boolean = existsSync
): string | null {
  return volumeExists("D:\\") ? "D:\\MiniMaxH3" : null;
}
