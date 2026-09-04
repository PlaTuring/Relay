/**
 * The only remote update authority granted to Relay. Renderer requests never
 * supply an owner, repository, URL, header, credential, tag, or file target.
 * This object stays in the main process and is not returned by update checks.
 */
export const RELAY_UPDATE_SOURCE = Object.freeze({
  schemaVersion: 2 as const,
  sourceId: "github-releases:PlaTuring/Relay:stable" as const,
  channel: "stable" as const,
  provider: "github_releases" as const,
  owner: "PlaTuring" as const,
  repository: "Relay" as const,
  authorProfileUrl: "https://github.com/PlaTuring/Relay" as const,
  repositoryPageUrl: "https://github.com/PlaTuring/Relay" as const,
  releasesApiUrl: "https://api.github.com/repos/PlaTuring/Relay/releases?per_page=20" as const,
  releasesPageUrl: "https://github.com/PlaTuring/Relay/releases" as const
});

export type RelayUpdateSource = typeof RELAY_UPDATE_SOURCE;
export type UpdateChannel = RelayUpdateSource["channel"];

export type UpdateReleaseAssetKind = "setup";
export type UpdateDownloadKind = "setup";

/** Safe release-asset metadata. Download URLs intentionally have no shared type. */
export interface UpdateReleaseAssetContract {
  readonly kind: UpdateReleaseAssetKind;
  readonly name: string;
  readonly length: number;
}

export type UpdateCheckStatus =
  | "checking"
  | "latest"
  | "update_available"
  | "no_release"
  | "release_incomplete"
  | "network"
  | "rate_limit"
  | "malformed";

export type CompletedUpdateCheckStatus = Exclude<UpdateCheckStatus, "checking">;
export type SuccessfulUpdateCheckStatus = Extract<
  CompletedUpdateCheckStatus,
  "latest" | "update_available" | "no_release"
>;

export interface UpdateCheckCacheContract {
  readonly schemaVersion: 2;
  readonly sourceId: RelayUpdateSource["sourceId"];
  readonly channel: UpdateChannel;
  readonly checkedAt: string;
  readonly status: SuccessfulUpdateCheckStatus;
  readonly currentVersion: string;
  readonly latestVersion: string | null;
  readonly tag: string | null;
  readonly releaseNotes: string | null;
  readonly publishedAt: string | null;
  readonly assets: readonly UpdateReleaseAssetContract[];
}

/**
 * Renderer-safe update result. It contains no repository URL, release URL,
 * asset URL, local path, request header, credential, or command authority.
 */
export interface UpdateCheckResultContract {
  readonly status: CompletedUpdateCheckStatus;
  readonly channel: UpdateChannel;
  readonly checkedAt: string;
  readonly currentVersion: string;
  readonly latestVersion: string | null;
  readonly tag: string | null;
  readonly releaseNotes: string | null;
  readonly publishedAt: string | null;
  readonly assets: readonly UpdateReleaseAssetContract[];
  readonly rateLimitResetAt: string | null;
  readonly message: string;
  readonly cachePersisted: boolean;
  /** Last valid v2 cache after this request. Failures never replace it. */
  readonly cached: UpdateCheckCacheContract | null;
}

export type UpdateDownloadState =
  | "idle"
  | "downloading"
  | "installing"
  | "completed"
  | "failed"
  | "cancelled";
export type UpdateDownloadPhase =
  | "idle"
  | "binary"
  | "verifying"
  | "finalizing"
  | "installing"
  | "completed"
  | "failed"
  | "cancelled";

export type UpdateDownloadErrorCode =
  | "download_in_progress"
  | "no_validated_release"
  | "no_newer_release"
  | "data_root_unavailable"
  | "network"
  | "http"
  | "redirect_blocked"
  | "length_mismatch"
  | "hash_mismatch"
  | "installer_launch_unavailable"
  | "installer_launch_failed"
  | "filesystem"
  | "cancelled";

/** Renderer-safe, polling-oriented download status. */
export interface UpdateDownloadStatusContract {
  readonly state: UpdateDownloadState;
  readonly preferredKind: UpdateDownloadKind;
  readonly kind: UpdateDownloadKind | null;
  readonly version: string | null;
  readonly tag: string | null;
  readonly phase: UpdateDownloadPhase;
  readonly assetName: string | null;
  readonly bytesReceived: number;
  readonly bytesTotal: number;
  readonly errorCode: UpdateDownloadErrorCode | null;
  readonly message: string | null;
  readonly canOpenFolder: boolean;
  readonly canOpenReleasePage: boolean;
}
