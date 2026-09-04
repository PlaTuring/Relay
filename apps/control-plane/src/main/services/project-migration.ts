import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

import {
  canonicalRelayProjectJson,
  normalizeRelayProject,
  type JsonValue,
  type RelayProjectDocument
} from "../../shared/project-domain.js";
import { normalizeRelaySeedPolicy, type RelaySeedPolicy } from "../../shared/seed-policy.js";
import {
  ensureDataRootLayout,
  resolveProjectDirectoryLayout
} from "./data-root.js";
import {
  createProjectRepository,
  type RelayProjectRepository
} from "./project-repository.js";

const MIGRATION_KEY = "legacyDataRootMigration";
const MIGRATION_VERSION = 1 as const;
const MAX_CONFIG_BYTES = 16 * 1024 * 1024;

export interface LegacyDirectorDraftInput {
  readonly storageKey: string;
  readonly payload: unknown;
}

export interface LegacyDataRootMigrationInput {
  readonly dataRoot: string;
  /** Included for explicit provenance only; no files are scanned implicitly. */
  readonly userDataPath: string;
  readonly setupPreferences?: unknown;
  readonly uiThemePreference?: unknown;
  readonly applicationPreferences?: unknown;
  readonly directorDrafts?: readonly LegacyDirectorDraftInput[];
  readonly repository?: RelayProjectRepository;
  readonly now?: () => Date;
  readonly createId?: () => string;
}

export interface LegacyDataRootMigrationResult {
  readonly status: "migrated" | "already_migrated";
  readonly migrationId: string;
  readonly inputSha256: string;
  readonly backupRelativePath: string;
  readonly projectIds: readonly string[];
  readonly warnings: readonly string[];
}

interface PersistedMigrationMarker {
  readonly version: typeof MIGRATION_VERSION;
  readonly migrationId: string;
  readonly inputSha256: string;
  readonly backupRelativePath: string;
  readonly projectIds: readonly string[];
  readonly completedAt: string;
}

function samePath(left: string, right: string): boolean {
  return resolve(left).toLocaleLowerCase("en-US") === resolve(right).toLocaleLowerCase("en-US");
}

function toJson(value: unknown): JsonValue {
  return JSON.parse(canonicalRelayProjectJson(value)) as JsonValue;
}

async function readConfig(path: string): Promise<Record<string, unknown>> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_CONFIG_BYTES || !samePath(await realpath(path), path)) return {};
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

function migrationMarker(value: unknown): PersistedMigrationMarker | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (
    source.version !== MIGRATION_VERSION || typeof source.migrationId !== "string" ||
    typeof source.inputSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(source.inputSha256) ||
    typeof source.backupRelativePath !== "string" || !Array.isArray(source.projectIds) ||
    source.projectIds.some((entry) => typeof entry !== "string") ||
    typeof source.completedAt !== "string" || !Number.isFinite(Date.parse(source.completedAt))
  ) return null;
  return {
    version: MIGRATION_VERSION,
    migrationId: source.migrationId,
    inputSha256: source.inputSha256,
    backupRelativePath: source.backupRelativePath,
    projectIds: Object.freeze([...source.projectIds] as string[]),
    completedAt: source.completedAt
  };
}

function draftName(value: unknown, index: number): string {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const source = value as Record<string, unknown>;
    if (typeof source.workflowName === "string" && source.workflowName.trim()) return source.workflowName.trim().slice(0, 160);
  }
  return `迁移的 Relay 项目 ${index + 1}`;
}

function legacySeedSettings(value: unknown): { readonly seed: string; readonly seedPolicy: RelaySeedPolicy } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { seed: "1", seedPolicy: "random_per_compile" };
  }
  const source = value as Record<string, unknown>;
  const production = source.productionState !== null && typeof source.productionState === "object" && !Array.isArray(source.productionState)
    ? source.productionState as Record<string, unknown>
    : null;
  const project = production?.project !== null && typeof production?.project === "object" && !Array.isArray(production.project)
    ? production.project as Record<string, unknown>
    : null;
  const settings = project?.directorSettings !== null && typeof project?.directorSettings === "object" && !Array.isArray(project.directorSettings)
    ? project.directorSettings as Record<string, unknown>
    : null;
  const seedValue = settings?.seed ?? source.seed;
  const seed = typeof seedValue === "string" && /^\d{1,16}$/u.test(seedValue) ? seedValue : "1";
  return {
    seed,
    seedPolicy: normalizeRelaySeedPolicy(settings?.seedPolicy ?? settings?.seed_policy ?? source.seedPolicy ?? source.seed_policy)
  };
}

async function promoteMigratedProject(
  repository: RelayProjectRepository,
  project: RelayProjectDocument,
  payload: unknown
): Promise<RelayProjectDocument> {
  const seedSettings = legacySeedSettings(payload);
  const quick = {
    ...project.quick,
    // A legacy Director draft belongs exclusively to the professional editor.
    // Copying its prompt into Quick Create made the two editors silently share
    // content and could expose an old Director prompt in a newly migrated Quick
    // project. Preserve the complete source payload below instead.
    originalPrompt: "",
    workflowName: project.name,
    ...seedSettings
  };
  return repository.saveProject(normalizeRelayProject({
    ...project,
    editorMode: "professional",
    quick,
    professional: {
      ...project.professional,
      directorState: toJson(payload),
      promotedQuickState: quick
    }
  }), { expectedUpdatedAt: project.updatedAt });
}

export async function migrateLegacyDataToDataRoot(input: LegacyDataRootMigrationInput): Promise<LegacyDataRootMigrationResult> {
  if (!isAbsolute(input.userDataPath) || input.userDataPath.includes("\0")) throw new TypeError("Explicit legacy userData provenance is invalid.");
  const now = input.now ?? (() => new Date());
  const createId = input.createId ?? randomUUID;
  const layout = await ensureDataRootLayout(input.dataRoot);
  const application = await readConfig(layout.applicationConfig);
  const existing = migrationMarker(application[MIGRATION_KEY]);
  if (existing !== null) {
    return Object.freeze({
      status: "already_migrated",
      migrationId: existing.migrationId,
      inputSha256: existing.inputSha256,
      backupRelativePath: existing.backupRelativePath,
      projectIds: existing.projectIds,
      warnings: Object.freeze([])
    });
  }

  const legacyPayload = toJson({
    setupPreferences: input.setupPreferences === undefined ? null : input.setupPreferences,
    uiThemePreference: input.uiThemePreference === undefined ? null : input.uiThemePreference,
    applicationPreferences: input.applicationPreferences === undefined ? null : input.applicationPreferences,
    directorDrafts: input.directorDrafts ?? []
  });
  const inputJson = `${JSON.stringify(legacyPayload, null, 2)}\n`;
  const inputSha256 = createHash("sha256").update(inputJson).digest("hex");
  const migrationId = `migration-${createId().replaceAll("-", "").toLocaleLowerCase("en-US")}`;
  if (!/^migration-[a-f0-9]{32}$/u.test(migrationId)) throw new TypeError("Migration ID generation failed.");
  const backupRelativePath = `config/migration-backups/${migrationId}/legacy-input.json`;
  const backupPath = join(layout.root, ...backupRelativePath.split("/"));
  await atomicJson(backupPath, {
    version: MIGRATION_VERSION,
    source: "explicit-legacy-electron-state",
    inputSha256,
    capturedAt: now().toISOString(),
    payload: legacyPayload
  });

  const repository = input.repository ?? createProjectRepository({ dataRoot: layout.root, now, createId });
  const createdProjectIds: string[] = [];
  try {
    if (input.setupPreferences !== undefined) {
      const current = await readConfig(layout.installationConfig);
      await atomicJson(layout.installationConfig, {
        ...current,
        schemaVersion: typeof current.schemaVersion === "number" ? current.schemaVersion : 1,
        migratedLegacySetup: toJson(input.setupPreferences),
        migratedAt: now().toISOString()
      });
    }
    if (input.uiThemePreference !== undefined) {
      const current = await readConfig(layout.uiConfig);
      let theme: string | null = null;
      if (input.uiThemePreference === "light" || input.uiThemePreference === "dark") theme = input.uiThemePreference;
      else if (input.uiThemePreference !== null && typeof input.uiThemePreference === "object" && !Array.isArray(input.uiThemePreference)) {
        const candidate = (input.uiThemePreference as Record<string, unknown>).theme;
        if (candidate === "light" || candidate === "dark") theme = candidate;
      }
      await atomicJson(layout.uiConfig, {
        ...current,
        schemaVersion: typeof current.schemaVersion === "number" ? current.schemaVersion : 1,
        ...(typeof current.theme === "string" || theme === null ? {} : { theme }),
        migratedLegacyTheme: toJson(input.uiThemePreference),
        migratedAt: now().toISOString()
      });
    }
    for (const [index, draft] of (input.directorDrafts ?? []).entries()) {
      if (typeof draft.storageKey !== "string" || !draft.storageKey.trim() || draft.storageKey.length > 512) throw new TypeError("Legacy director storage key is invalid.");
      const project = await repository.createProject({ name: draftName(draft.payload, index) });
      createdProjectIds.push(project.projectId);
      await promoteMigratedProject(repository, project, draft.payload);
    }
    const completedAt = now().toISOString();
    const updatedApplication = await readConfig(layout.applicationConfig);
    const marker: PersistedMigrationMarker = Object.freeze({
      version: MIGRATION_VERSION,
      migrationId,
      inputSha256,
      backupRelativePath,
      projectIds: Object.freeze([...createdProjectIds]),
      completedAt
    });
    await atomicJson(layout.applicationConfig, {
      ...updatedApplication,
      schemaVersion: typeof updatedApplication.schemaVersion === "number" ? updatedApplication.schemaVersion : 1,
      ...(input.applicationPreferences === undefined ? {} : { migratedLegacyApplication: toJson(input.applicationPreferences) }),
      [MIGRATION_KEY]: marker
    });
    return Object.freeze({
      status: "migrated",
      migrationId,
      inputSha256,
      backupRelativePath,
      projectIds: Object.freeze([...createdProjectIds]),
      warnings: Object.freeze([])
    });
  } catch (error) {
    for (const projectId of createdProjectIds) {
      const projectLayout = resolveProjectDirectoryLayout(layout.root, projectId);
      await rm(projectLayout.root, { recursive: true, force: true }).catch(() => undefined);
    }
    if (createdProjectIds.length > 0) {
      const current = await readConfig(layout.applicationConfig);
      const recentProjects = Array.isArray(current.recentProjects)
        ? current.recentProjects.filter((entry) => entry === null || typeof entry !== "object" || Array.isArray(entry) ||
          !createdProjectIds.includes(String((entry as Record<string, unknown>).projectId)))
        : [];
      await atomicJson(layout.applicationConfig, { ...current, recentProjects }).catch(() => undefined);
    }
    throw error;
  }
}
