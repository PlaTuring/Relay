import { createHash, randomUUID } from "node:crypto";
import {
  constants as fsConstants,
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import {
  canonicalRelayProjectJson,
  normalizeProjectRelativePath,
  normalizeRelayProject,
  type RelayAuthoritativeWorkflowRecord,
  type RelayProjectDocument,
  type RelayProjectHistoryRecord
} from "../../shared/project-domain.js";
import {
  normalizeRelayResolvedSeedPlan,
  relaySeedPlansEqual,
  relayWorkflowSeedPlan,
  type RelayResolvedSeedPlan
} from "../../shared/seed-policy.js";
import { resolveProjectDirectoryLayout } from "./data-root.js";
import {
  createProjectRepository,
  type RelayProjectRepository
} from "./project-repository.js";

const MAX_WORKFLOW_BYTES = 32 * 1024 * 1024;
const WORKFLOW_ID = /^workflow-[a-z0-9][a-z0-9-]{7,127}$/u;
const REFERENCE_ID = /^reference-[a-z0-9][a-z0-9-]{7,127}$/u;
const HISTORY_ID = /^history-[a-z0-9][a-z0-9-]{7,127}$/u;

export interface CreateProjectWorkflowStoreOptions {
  readonly dataRoot: string;
  readonly repository?: RelayProjectRepository;
  readonly now?: () => Date;
  readonly createId?: () => string;
}

export interface StoreAuthoritativeWorkflowInput {
  readonly projectId: string;
  readonly displayName: string;
  readonly workflow: unknown;
  readonly seedResolution?: RelayResolvedSeedPlan | null;
  readonly workflowId?: string;
}

export interface HandoffAuthoritativeWorkflowInput {
  readonly projectId: string;
  readonly workflowId: string;
  readonly targetComfyReferenceId: string;
  readonly targetComfyRoot: string;
  readonly targetWorkflowDirectory: string;
}

export interface ProjectWorkflowStore {
  storeAuthoritativeWorkflow(input: StoreAuthoritativeWorkflowInput): Promise<RelayAuthoritativeWorkflowRecord>;
  handoffAuthoritativeWorkflow(input: HandoffAuthoritativeWorkflowInput): Promise<RelayAuthoritativeWorkflowRecord>;
  verifyAuthoritativeWorkflow(projectId: string, workflowId: string): Promise<boolean>;
}

function samePath(left: string, right: string): boolean {
  return resolve(left).toLocaleLowerCase("en-US") === resolve(right).toLocaleLowerCase("en-US");
}

function workflowId(factory: () => string, value?: string): string {
  const candidate = value ?? `workflow-${factory().replaceAll("-", "").toLocaleLowerCase("en-US")}`;
  if (!WORKFLOW_ID.test(candidate)) throw new TypeError("Invalid stable workflow ID.");
  return candidate;
}

function historyId(factory: () => string): string {
  const candidate = `history-${factory().replaceAll("-", "").toLocaleLowerCase("en-US")}`;
  if (!HISTORY_ID.test(candidate)) throw new TypeError("Invalid stable history ID.");
  return candidate;
}

function safeDisplayName(value: unknown): string {
  if (typeof value !== "string" || value.length > 160 || value.includes("\0")) throw new TypeError("Workflow display name is invalid.");
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError("Workflow display name is required.");
  return trimmed;
}

function safeFileStem(value: string): string {
  const stem = value.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, "_").replace(/[. ]+$/gu, "").slice(0, 80) || "workflow";
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu.test(stem) ? `_${stem}` : stem;
}

async function directDirectory(path: string): Promise<string> {
  if (!isAbsolute(path) || path.includes("\0")) throw new TypeError("ComfyUI target must be an absolute local directory.");
  const absolute = resolve(path);
  const metadata = await lstat(absolute);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || !samePath(await realpath(absolute), absolute)) {
    throw new TypeError("ComfyUI target cannot be a file, symbolic link, or reparse point.");
  }
  return absolute;
}

async function readDirectFile(path: string): Promise<Buffer> {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0 || metadata.size > MAX_WORKFLOW_BYTES || !samePath(await realpath(path), path)) {
    throw new TypeError("Workflow file is missing, unsafe, or too large.");
  }
  return readFile(path);
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function writeNewOrVerify(path: string, bytes: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true }).catch(() => undefined);
  let created = false;
  try {
    const handle = await open(path, "wx", 0o600);
    created = true;
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      if (created) await rm(path, { force: true }).catch(() => undefined);
      throw error;
    }
    const current = await readDirectFile(path);
    if (digest(current) !== digest(bytes)) throw new Error("Workflow target collision.");
  }
  const verified = await readDirectFile(path);
  if (verified.byteLength !== bytes.byteLength || digest(verified) !== digest(bytes)) throw new Error("Workflow write verification failed.");
}

function recordById(project: RelayProjectDocument, id: string): RelayAuthoritativeWorkflowRecord {
  const record = project.workflows.find((candidate) => candidate.workflowId === id);
  if (record === undefined) throw new TypeError("Authoritative workflow is not registered in this project.");
  return record;
}

export function createProjectWorkflowStore(options: CreateProjectWorkflowStoreOptions): ProjectWorkflowStore {
  const repository = options.repository ?? createProjectRepository({
    dataRoot: options.dataRoot,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.createId === undefined ? {} : { createId: options.createId })
  });
  const now = options.now ?? (() => new Date());
  const createId = options.createId ?? randomUUID;
  const dataRoot = resolve(options.dataRoot);

  const store: ProjectWorkflowStore = {
    async storeAuthoritativeWorkflow(input: StoreAuthoritativeWorkflowInput) {
      const displayName = safeDisplayName(input.displayName);
      const id = workflowId(createId, input.workflowId);
      if (input.workflow === null || typeof input.workflow !== "object" || Array.isArray(input.workflow)) {
        throw new TypeError("ComfyUI workflow JSON must be an object.");
      }
      const seedResolution = input.seedResolution === null || input.seedResolution === undefined
        ? null
        : normalizeRelayResolvedSeedPlan(input.seedResolution);
      if (seedResolution !== null) {
        const embedded = relayWorkflowSeedPlan(input.workflow);
        if (embedded === null || !relaySeedPlansEqual(seedResolution, embedded)) {
          throw new TypeError("Workflow seed evidence does not match the resolved compile seed plan.");
        }
      }
      const workflowJson = `${JSON.stringify(JSON.parse(canonicalRelayProjectJson(input.workflow)), null, 2)}\n`;
      const bytes = Buffer.from(workflowJson, "utf8");
      if (bytes.byteLength <= 2 || bytes.byteLength > MAX_WORKFLOW_BYTES) throw new TypeError("Workflow JSON is empty or too large.");
      const sha256 = digest(bytes);
      const project = await repository.loadProject(input.projectId);
      const layout = resolveProjectDirectoryLayout(dataRoot, project.projectId);
      const fileName = `${safeFileStem(displayName)}--${id}--${sha256.slice(0, 12)}.json`;
      const destination = join(layout.workflows, fileName);
      await writeNewOrVerify(destination, bytes);
      const projectRelativePath = normalizeProjectRelativePath(`workflows/${fileName}`, "workflows");
      const previous = project.workflows.find((candidate) => candidate.workflowId === id);
      const createdAt = previous?.createdAt ?? now().toISOString();
      const nextRecord: RelayAuthoritativeWorkflowRecord = Object.freeze({
        workflowId: id,
        displayName,
        projectRelativePath,
        byteLength: bytes.byteLength,
        sha256,
        createdAt,
        seedResolution,
        handoffs: previous?.sha256 === sha256 ? previous.handoffs : Object.freeze([])
      });
      const updated = normalizeRelayProject({
        ...project,
        workflows: [...project.workflows.filter((candidate) => candidate.workflowId !== id), nextRecord]
      });
      try {
        const saved = await repository.saveProject(updated, { expectedUpdatedAt: project.updatedAt });
        return recordById(saved, id);
      } catch (error) {
        if (previous === undefined) await rm(destination, { force: true }).catch(() => undefined);
        throw error;
      }
    },
    async handoffAuthoritativeWorkflow(input: HandoffAuthoritativeWorkflowInput) {
      if (!WORKFLOW_ID.test(input.workflowId) || !REFERENCE_ID.test(input.targetComfyReferenceId)) throw new TypeError("Workflow or ComfyUI reference ID is invalid.");
      const project = await repository.loadProject(input.projectId);
      const record = recordById(project, input.workflowId);
      const external = project.externalReferences.find((candidate) => candidate.referenceId === input.targetComfyReferenceId);
      if (external?.kind !== "comfyui_root" || external.attachOnly !== true) throw new TypeError("Target ComfyUI is not an approved attach-only project reference.");
      const projectLayout = resolveProjectDirectoryLayout(dataRoot, project.projectId);
      const authorityPath = join(projectLayout.root, record.projectRelativePath);
      const authority = await readDirectFile(authorityPath);
      if (authority.byteLength !== record.byteLength || digest(authority) !== record.sha256) throw new Error("Authoritative workflow no longer matches the project record.");
      const comfyRoot = await directDirectory(input.targetComfyRoot);
      const workflowDirectory = await directDirectory(input.targetWorkflowDirectory);
      const back = relative(comfyRoot, workflowDirectory);
      if (back.startsWith("..") || isAbsolute(back)) throw new TypeError("ComfyUI workflow directory must remain inside the selected attach-only root.");
      const fileName = basename(record.projectRelativePath);
      const target = join(workflowDirectory, fileName);
      try {
        await copyFile(authorityPath, target, fsConstants.COPYFILE_EXCL);
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const existing = await readDirectFile(target);
        if (existing.byteLength !== authority.byteLength || digest(existing) !== record.sha256) {
          throw new Error("ComfyUI handoff target already exists with different content; Relay did not overwrite it.");
        }
      }
      const copied = await readDirectFile(target);
      if (copied.byteLength !== record.byteLength || digest(copied) !== record.sha256) throw new Error("ComfyUI handoff copy verification failed.");
      const handedOffAt = now().toISOString();
      const targetRelativePath = normalizeProjectRelativePath(relative(comfyRoot, target).replaceAll("\\", "/"));
      const handoffId = `handoff-${createId().replaceAll("-", "").toLocaleLowerCase("en-US")}`;
      const nextRecord: RelayAuthoritativeWorkflowRecord = Object.freeze({
        ...record,
        handoffs: Object.freeze([...record.handoffs, Object.freeze({
          handoffId,
          targetComfyReferenceId: input.targetComfyReferenceId,
          targetRelativePath,
          byteLength: copied.byteLength,
          sha256: record.sha256,
          handedOffAt
        })])
      });
      const projectAtHandoff = normalizeRelayProject({
        ...project,
        workflows: project.workflows.map((candidate) => candidate.workflowId === record.workflowId ? nextRecord : candidate)
      });
      const checkpointCreatedAt = handedOffAt;
      const checkpointId = historyId(createId);
      const checkpointJson = `${JSON.stringify(JSON.parse(canonicalRelayProjectJson(projectAtHandoff)), null, 2)}\n`;
      const checkpointBytes = Buffer.from(checkpointJson, "utf8");
      const checkpointSha256 = digest(checkpointBytes);
      const checkpointFileName = `${checkpointCreatedAt.replaceAll(":", "-")}--compile-handoff--${checkpointId}--${checkpointSha256.slice(0, 12)}.relay.json`;
      const checkpointPath = join(projectLayout.history, checkpointFileName);
      await writeNewOrVerify(checkpointPath, checkpointBytes);
      const historyRecord: RelayProjectHistoryRecord = Object.freeze({
        historyId: checkpointId,
        kind: "compile_handoff",
        createdAt: checkpointCreatedAt,
        projectRelativePath: normalizeProjectRelativePath(`history/${checkpointFileName}`, "history"),
        byteLength: checkpointBytes.byteLength,
        sha256: checkpointSha256,
        label: `已交接：${record.displayName}`.slice(0, 160),
        seedResolution: record.seedResolution
      });
      let saved: RelayProjectDocument;
      try {
        saved = await repository.saveProject(normalizeRelayProject({
          ...projectAtHandoff,
          history: [...projectAtHandoff.history, historyRecord]
        }), { expectedUpdatedAt: project.updatedAt });
      } catch (error) {
        await rm(checkpointPath, { force: true }).catch(() => undefined);
        throw error;
      }
      return recordById(saved, record.workflowId);
    },
    async verifyAuthoritativeWorkflow(projectId: string, id: string) {
      try {
        const project = await repository.loadProject(projectId);
        const record = recordById(project, id);
        const layout = resolveProjectDirectoryLayout(dataRoot, project.projectId);
        const bytes = await readDirectFile(join(layout.root, record.projectRelativePath));
        return bytes.byteLength === record.byteLength && digest(bytes) === record.sha256;
      } catch {
        return false;
      }
    }
  };
  return Object.freeze(store);
}
