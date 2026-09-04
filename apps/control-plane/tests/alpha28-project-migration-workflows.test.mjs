import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");

async function loadModule(context, entry) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "relay-alpha28-migration-build-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const outfile = path.join(directory, "module.mjs");
  await build({ entryPoints: [path.join(root, entry)], outfile, bundle: true, format: "esm", platform: "node", target: "node22", logLevel: "silent" });
  return import(`${new URL(`file:///${outfile.replaceAll("\\", "/")}`).href}?${Date.now()}`);
}

function fixtureClock() {
  let value = 0;
  return () => new Date(Date.UTC(2026, 7, 30, 2, 0, value++));
}

function fixtureIds() {
  let value = 1;
  return () => (value++).toString(16).padStart(32, "0");
}

test("explicit legacy setup, theme and director drafts migrate once with backup and exact payload preservation", async (context) => {
  const [migration, repoModule, data] = await Promise.all([
    loadModule(context, "src/main/services/project-migration.ts"),
    loadModule(context, "src/main/services/project-repository.ts"),
    loadModule(context, "src/main/services/data-root.ts")
  ]);
  const temporary = await mkdtemp(path.join(os.tmpdir(), "relay-alpha28-legacy-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const dataRoot = path.join(temporary, "data-root");
  const userData = path.join(temporary, "old-user-data");
  await mkdir(userData);
  const legacyFile = path.join(userData, "setup-locations.v1.json");
  await writeFile(legacyFile, "legacy-source-must-remain");
  const clock = fixtureClock();
  const ids = fixtureIds();
  const directorPayload = {
    version: 7,
    workflowName: "旧导播 雨夜🙂",
    draft: { prompt: "逐字保留\r\nNo rewrite 🐟", shots: [{ id: "legacy-shot", description: "镜头原文" }] },
    productionState: { schemaVersion: 2, takes: [{ id: "take-legacy", notes: "不可丢失" }], revisions: [{ id: "revision-legacy" }] }
  };
  const result = await migration.migrateLegacyDataToDataRoot({
    dataRoot,
    userDataPath: userData,
    setupPreferences: { version: 2, installRoot: "D:\\MiniMaxH3", comfyUiRoot: "D:\\Comfy UI" },
    uiThemePreference: { version: 1, theme: "dark" },
    applicationPreferences: { previousPage: "director" },
    directorDrafts: [{ storageKey: "relay-director-draft-v1", payload: directorPayload }],
    now: clock,
    createId: ids
  });
  assert.equal(result.status, "migrated");
  assert.equal(result.projectIds.length, 1);
  assert.equal(await readFile(legacyFile, "utf8"), "legacy-source-must-remain", "legacy AppData is never deleted or rewritten");
  const backup = JSON.parse(await readFile(path.join(dataRoot, ...result.backupRelativePath.split("/")), "utf8"));
  assert.deepEqual(backup.payload.directorDrafts[0].payload, directorPayload);
  assert.equal(backup.inputSha256, result.inputSha256);
  const installation = JSON.parse(await readFile(path.join(dataRoot, "config", "installation.json"), "utf8"));
  const ui = JSON.parse(await readFile(path.join(dataRoot, "config", "ui.json"), "utf8"));
  assert.equal(installation.migratedLegacySetup.installRoot, "D:\\MiniMaxH3");
  assert.equal(ui.theme, "dark");

  const repository = repoModule.createProjectRepository({ dataRoot, now: clock, createId: ids });
  const project = await repository.loadProject(result.projectIds[0]);
  assert.equal(project.name, "旧导播 雨夜🙂");
  assert.equal(project.editorMode, "professional");
  assert.equal(project.quick.originalPrompt, "", "legacy Director content must not leak into Quick Create");
  assert.deepEqual(project.professional.directorState, directorPayload);
  const second = await migration.migrateLegacyDataToDataRoot({
    dataRoot,
    userDataPath: userData,
    setupPreferences: { changed: true },
    directorDrafts: [{ storageKey: "different", payload: { version: 7 } }],
    now: clock,
    createId: ids
  });
  assert.equal(second.status, "already_migrated");
  assert.deepEqual(second.projectIds, result.projectIds);
  assert.equal((await repository.listProjects({ includeArchived: true })).length, 1, "idempotent restart cannot duplicate migrated drafts");
  const application = JSON.parse(await readFile(data.resolveDataRootLayout(dataRoot).applicationConfig, "utf8"));
  assert.equal(application.legacyDataRootMigration.projectIds[0], project.projectId);
});

test("migration failure retains explicit legacy input and never records false completion", async (context) => {
  const [migration, data] = await Promise.all([
    loadModule(context, "src/main/services/project-migration.ts"),
    loadModule(context, "src/main/services/data-root.ts")
  ]);
  const temporary = await mkdtemp(path.join(os.tmpdir(), "relay-alpha28-legacy-fail-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const dataRoot = path.join(temporary, "data");
  const legacy = { prompt: "保留失败迁移原文" };
  await assert.rejects(migration.migrateLegacyDataToDataRoot({
    dataRoot,
    userDataPath: path.join(temporary, "old-user-data"),
    directorDrafts: [{ storageKey: "", payload: legacy }],
    now: fixtureClock(),
    createId: fixtureIds()
  }), /storage key/u);
  const applicationPath = data.resolveDataRootLayout(dataRoot).applicationConfig;
  let application = {};
  try { application = JSON.parse(await readFile(applicationPath, "utf8")); } catch {}
  assert.equal(application.legacyDataRootMigration, undefined);
  const backups = path.join(dataRoot, "config", "migration-backups");
  assert.equal((await readdir(backups)).length, 1, "failure retains its exact backup for recovery evidence");
});

test("authoritative workflow and ComfyUI handoff copy have exact SHA mapping without queue execution", async (context) => {
  const [repoModule, workflowModule, data] = await Promise.all([
    loadModule(context, "src/main/services/project-repository.ts"),
    loadModule(context, "src/main/services/project-workflow-store.ts"),
    loadModule(context, "src/main/services/data-root.ts")
  ]);
  const temporary = await mkdtemp(path.join(os.tmpdir(), "relay-alpha28-workflow-store-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const dataRoot = path.join(temporary, "data");
  const comfyRoot = path.join(temporary, "ComfyUI portable");
  const comfyWorkflows = path.join(comfyRoot, "ComfyUI", "user", "default", "workflows");
  await mkdir(comfyWorkflows, { recursive: true });
  const clock = fixtureClock();
  const ids = fixtureIds();
  const repository = repoModule.createProjectRepository({ dataRoot, now: clock, createId: ids });
  let project = await repository.createProject({ name: "权威工作流" });
  project = await repository.saveProject({
    ...project,
    externalReferences: [{ referenceId: "reference-comfy001", kind: "comfyui_root", displayName: "本机 ComfyUI",
      locatorId: "installation.comfy.primary", expectedSha256: null, attachOnly: true }]
  }, { expectedUpdatedAt: project.updatedAt });
  const store = workflowModule.createProjectWorkflowStore({ dataRoot, repository, now: clock, createId: ids });
  const workflowJson = { version: 1, nodes: [{ id: 1, type: "MiniMaxH3", widgets_values: ["本次提示词"] }], links: [] };
  const authority = await store.storeAuthoritativeWorkflow({ projectId: project.projectId, displayName: "雨夜 🐟 01", workflow: workflowJson });
  assert.equal(await store.verifyAuthoritativeWorkflow(project.projectId, authority.workflowId), true);
  const authorityPath = path.join(data.resolveProjectDirectoryLayout(dataRoot, project.projectId).root, ...authority.projectRelativePath.split("/"));
  const bytes = await readFile(authorityPath);
  assert.equal(bytes.byteLength, authority.byteLength);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), authority.sha256);

  const handedOff = await store.handoffAuthoritativeWorkflow({
    projectId: project.projectId,
    workflowId: authority.workflowId,
    targetComfyReferenceId: "reference-comfy001",
    targetComfyRoot: comfyRoot,
    targetWorkflowDirectory: comfyWorkflows
  });
  assert.equal(handedOff.handoffs.length, 1);
  assert.equal(handedOff.handoffs[0].sha256, authority.sha256);
  const target = path.join(comfyRoot, ...handedOff.handoffs[0].targetRelativePath.split("/"));
  assert.deepEqual(await readFile(target), bytes);
  const savedProject = await repository.loadProject(project.projectId);
  assert.equal(savedProject.workflows[0].handoffs[0].targetComfyReferenceId, "reference-comfy001");
  assert.equal(savedProject.history.length, 1);
  assert.equal(savedProject.history[0].kind, "compile_handoff");
  assert.match(savedProject.history[0].label, /雨夜/u);
  const historyPath = path.join(
    data.resolveProjectDirectoryLayout(dataRoot, project.projectId).root,
    ...savedProject.history[0].projectRelativePath.split("/")
  );
  const historyBytes = await readFile(historyPath);
  assert.equal(historyBytes.byteLength, savedProject.history[0].byteLength);
  assert.equal(createHash("sha256").update(historyBytes).digest("hex"), savedProject.history[0].sha256);
  const checkpointProject = JSON.parse(historyBytes.toString("utf8"));
  assert.equal(checkpointProject.workflows[0].handoffs[0].sha256, authority.sha256);
  assert.deepEqual(checkpointProject.history, [], "the immutable checkpoint does not self-reference its own digest");
  assert.equal(JSON.stringify(savedProject).includes(comfyRoot), false, "project authority stores stable references, not private absolute paths");

  const sources = await Promise.all([
    readFile(path.join(root, "src", "main", "services", "project-workflow-store.ts"), "utf8"),
    readFile(path.join(root, "src", "main", "services", "project-repository.ts"), "utf8"),
    readFile(path.join(root, "src", "main", "services", "project-migration.ts"), "utf8")
  ]);
  assert.doesNotMatch(sources.join("\n"), /\/prompt|queuePrompt|submitPrompt|generate(?:Video|Audio)|runComfy|autoQueue/iu);
});

test("changed authoritative workflow gets a new immutable file and clears obsolete handoff mappings", async (context) => {
  const [repoModule, workflowModule, data] = await Promise.all([
    loadModule(context, "src/main/services/project-repository.ts"),
    loadModule(context, "src/main/services/project-workflow-store.ts"),
    loadModule(context, "src/main/services/data-root.ts")
  ]);
  const temporary = await mkdtemp(path.join(os.tmpdir(), "relay-alpha28-workflow-update-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const dataRoot = path.join(temporary, "data");
  const repository = repoModule.createProjectRepository({ dataRoot, now: fixtureClock(), createId: fixtureIds() });
  const project = await repository.createProject({ name: "更新工作流" });
  const store = workflowModule.createProjectWorkflowStore({ dataRoot, repository, now: fixtureClock(), createId: fixtureIds() });
  const first = await store.storeAuthoritativeWorkflow({ projectId: project.projectId, displayName: "版本", workflow: { prompt: "A" } });
  const second = await store.storeAuthoritativeWorkflow({ projectId: project.projectId, workflowId: first.workflowId, displayName: "版本", workflow: { prompt: "B" } });
  assert.notEqual(second.sha256, first.sha256);
  assert.notEqual(second.projectRelativePath, first.projectRelativePath);
  assert.deepEqual(second.handoffs, []);
  const workflowDirectory = data.resolveProjectDirectoryLayout(dataRoot, project.projectId).workflows;
  assert.equal((await readdir(workflowDirectory)).length, 2, "old authority remains immutable recovery evidence");
});
