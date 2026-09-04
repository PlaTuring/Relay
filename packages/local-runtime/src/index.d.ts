export interface LocalRuntimeRequest {
  request_version: "1.0.0";
  known_comfy_roots?: readonly string[];
  user_comfy_roots?: readonly string[];
  user_model_roots?: readonly string[];
  managed_root?: string | null;
}

export interface UiLocationsRequest {
  request_version: "1.0.0";
  known_comfy_roots?: readonly string[];
  user_comfy_roots?: readonly string[];
  user_model_roots?: readonly string[];
}

export interface UiLocationValue {
  source: "explicit" | "detected" | "missing";
  root_path: string | null;
}

export interface UiLocationsResult {
  response_version: "1.0.0";
  sensitivity: "local_ui_only_do_not_log_or_export";
  locations: {
    comfy: UiLocationValue & { topology: "portable" | "core" | null };
    models: UiLocationValue & {
      recognized_asset_count: number;
      expected_asset_count: number;
      recognized_roles: readonly string[];
    };
  };
  inspection: Readonly<Record<string, unknown>>;
}

export interface FileObservation {
  kind: "file" | "directory" | "missing" | "reparse" | "other" | "invalid" | "unavailable";
  byte_length: number | null;
  modified_ns: string | null;
  artifact_sha256?: string;
}

export interface LocalRuntimeFileAdapter {
  inspect(path: string): Promise<FileObservation>;
  sha256(path: string, expectedByteLength: number): Promise<{
    status: string;
    artifact_sha256: string | null;
  }>;
}

export interface LocalRuntimeHostProbe {
  probe(): Promise<Record<string, unknown>>;
}

export interface LocalRuntimeDependencies {
  evidenceMode?: string;
  fileAdapter?: LocalRuntimeFileAdapter;
  hostProbe?: LocalRuntimeHostProbe;
  modelInspectionMode?: "fast" | "full";
  uiLocationsDeadlineMilliseconds?: number;
}

export interface InstallAcknowledgements {
  licenseAccepted: boolean;
  territoryAcknowledged: boolean;
  commercialAcknowledged: boolean;
  downloadConsent: boolean;
}

export interface InstallRequest {
  managedRoot: string;
  components: readonly ("comfy-portable" | "fl2va-base" | "ref2va-addon" | "fl2v-turbo" | "ref2v-turbo" | "ffmpeg-managed" | "comfy-desktop")[];
  existingModelRoots?: readonly string[];
  hardware?: { vramBytes: number };
  acknowledgements?: Partial<InstallAcknowledgements>;
  operationId?: string;
}

export interface InstallLocator {
  managedRoot: string;
  operationId: string;
}

export interface LocalRuntimeService {
  inspect(request: LocalRuntimeRequest): Promise<Readonly<Record<string, unknown>>>;
}

export class LocalRuntimeError extends Error {
  readonly code: string;
  readonly stage: string;
  readonly rule_id: string;
  readonly exit_code: number;
  toJSON(): Readonly<{ code: string; rule_id: string; stage: string }>;
}

export const AUTHORITY: Readonly<Record<string, string>>;
export const H3_ATTACH_PROFILE: Readonly<Record<string, unknown>>;
export const INSTALL_CATALOG: Readonly<Record<string, unknown>>;

export function createLocalRuntimeService(dependencies?: LocalRuntimeDependencies): LocalRuntimeService;
export function inspectLocalRuntime(request: LocalRuntimeRequest, dependencies?: LocalRuntimeDependencies): Promise<Readonly<Record<string, unknown>>>;
export function chooseManagedRoot(host: Record<string, unknown>, requestedRoot?: string | null): Readonly<Record<string, unknown>>;
export function knownPortableRoots(host: Record<string, unknown>): readonly string[];
export function discoverComfyInstallations(input: Record<string, unknown>): Promise<ReadonlyArray<Record<string, unknown>>>;
export function publicInstallations(input: ReadonlyArray<Record<string, unknown>>): ReadonlyArray<Record<string, unknown>>;
export function collectModelRoots(installations: ReadonlyArray<Record<string, unknown>>, userModelRoots?: readonly string[]): readonly string[];
export function discoverH3Assets(input: { modelRoots: readonly string[]; fileAdapter?: LocalRuntimeFileAdapter }): Promise<Readonly<Record<string, unknown>>>;
export function verifyH3Assets(input: { modelRoots: readonly string[]; fileAdapter?: LocalRuntimeFileAdapter }): Promise<Readonly<Record<string, unknown>>>;
export function createLiveFileAdapter(): LocalRuntimeFileAdapter;
export function createFixtureFileAdapter(entries: ReadonlyMap<string, FileObservation>): LocalRuntimeFileAdapter;
export function createFixtureHostProbe(observation: Record<string, unknown>): LocalRuntimeHostProbe;
export function probeWindowsHost(input?: Record<string, unknown>): Promise<Readonly<Record<string, unknown>>>;
export function createSyntheticSmokePlan(): Promise<Readonly<Record<string, unknown>>>;
export function resolveUiLocations(request: UiLocationsRequest, dependencies?: LocalRuntimeDependencies): Promise<Readonly<UiLocationsResult>>;
export function createInstallPlan(input: InstallRequest, dependencies?: Record<string, unknown>): Promise<Readonly<Record<string, unknown>>>;
export function prepareInstallPlan(input: InstallRequest, dependencies?: Record<string, unknown>): Promise<Readonly<Record<string, unknown>>>;
export function installComponents(input: InstallRequest, dependencies?: Record<string, unknown>): Promise<Readonly<Record<string, unknown>>>;
export function getInstallStatus(input: InstallLocator): Promise<Readonly<Record<string, unknown>>>;
export function cancelInstall(input: InstallLocator): Promise<Readonly<Record<string, unknown>>>;
export function recoverInstall(input: InstallLocator, dependencies?: Record<string, unknown>): Promise<Readonly<Record<string, unknown>>>;
export function extractFfmpegArchive(input: {
  archivePath: string;
  stagingPath: string;
  destinationPath: string;
  archiveRoot: string;
  requiredFiles: readonly string[];
  runner?: { list(path: string): Promise<string>; extract(path: string, destination: string): Promise<void> };
  isCancelled?: () => Promise<boolean>;
}): Promise<Readonly<Record<string, unknown>>>;

export function loadEmbeddedCatalogFromJson(input: Record<string, unknown>): Readonly<Record<string, unknown>>;
export function runSidecarOperation(input: Record<string, unknown>): Readonly<Record<string, unknown>>;
export function observeMediaCapabilities(request: Record<string, unknown>): Promise<Readonly<Record<string, unknown>>>;

export function initializeInstallTransaction(input: { managed_root: string; plan: Record<string, unknown> }): Promise<Readonly<Record<string, unknown>>>;
export function readInstallTransaction(input: { managed_root: string; transaction_id: string }): Promise<Readonly<Record<string, unknown>>>;
export function transitionInstallTransaction(input: {
  managed_root: string;
  transaction_id: string;
  action_id: string;
  next_state: "running" | "complete" | "failed" | "pending";
  evidence_digest?: string | null;
}): Promise<Readonly<Record<string, unknown>>>;
export function publicError(error: unknown): Readonly<{ code: string; rule_id: string; stage: string }>;
