import { isAbsolute, join } from "node:path";

import type { SetupPreferences } from "./services/setup-preferences.js";

export interface InitialDataRootCandidateOptions {
  readonly legacySetup: SetupPreferences | null;
  readonly userDataPath: string;
  readonly headlessMode: boolean;
  readonly dDriveAvailable: boolean;
}

/**
 * Product startup never invents a C: business-data fallback.  The user must
 * explicitly choose a supported library when neither a saved root nor a
 * supported D: drive exists.  The headless branch is an explicit disposable
 * test fixture, not a production fallback.
 */
export function chooseInitialDataRootCandidate(
  options: InitialDataRootCandidateOptions
): string | null {
  if (options.headlessMode) return join(options.userDataPath, "RelayData");
  if (options.legacySetup !== null && isAbsolute(options.legacySetup.installRoot)) {
    return options.legacySetup.installRoot;
  }
  return options.dDriveAvailable ? "D:\\MiniMaxH3" : null;
}

