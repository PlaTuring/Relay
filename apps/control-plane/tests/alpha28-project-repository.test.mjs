import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");

async function loadModule(context, entry) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "relay-alpha28-repo-build-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const outfile = path.join(directory, "module.mjs");
  await build({ entryPoints: [path.join(root, entry)], outfile, bundle: true, format: "esm", platform: "node", target: "node22", logLevel: "silent" });
  return import(`${new URL(`file:///${outfile.replaceAll("\\", "/")}`).href}?${Date.now()}`);
}

function fixtureClock() {
  let value = 0;
  return () => new Date(Date.UTC(2026, 7, 30, 0, 0, value++));
}

function fixtureIds() {
  let value = 1;
  return () => (value++).toString(16).padStart(32, "0");
}

test("dataRoot layout and pointer keep business data outside Electron userData", async (context) => {
  const data = await loadModule(context, "src/main/services/data-root.ts");
  const temporary = await mkdtemp(path.join(os.tmpdir(), "relay-alpha28-data-root-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const userData = path.join(temporary, "electron-user-data");
  const dataRoot = path.join(temporary, "Relay 数据 Ω");
  const layout = await data.ensureDataRootLayout(dataRoot);
  assert.deepEqual((await readdir(layout.root)).sort(), ["cache", "config", "downloads", "logs", "models", "projects", "runtime"]);
  assert.equal(layout.applicationConfig, path.join(dataRoot, "config", "application.json"));
  await data.saveDataRootPointer(userData, dataRoot, new Date("2026-08-30T00:00:00Z"));
  assert.deepEqual((await readdir(userData)).sort(), ["data-root.pointer.json"]);
  const pointer = await data.loadDataRootPointer(userData);
  assert.equal(pointer.dataRoot, path.resolve(dataRoot));
  assert.equal(pointer.version, 1);

  const project = await data.ensureProjectDirectoryLayout(dataRoot, "project-12345678");
  assert.equal(project.document, path.join(dataRoot, "projects", "project-12345678", "project.relay.json"));
  assert.deepEqual((await readdir(project.root)).sort(), ["assets", "exports", "history", "recovery", "workflows"]);
  assert.throws(() => data.resolveProjectDirectoryLayout(dataRoot, "../../escape"), /project ID/u);
});

test("explicit dataRoot migration copies, verifies, switches pointer, and preserves source recovery copy", async (context) => {
  const data = await loadModule(context, "src/main/services/data-root.ts");
  const temporary = await mkdtemp(path.join(os.tmpdir(), "relay-alpha28-data-move-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const source = path.join(temporary, "old-library");
  const target = path.join(temporary, "new-library");
  const userData = path.join(temporary, "user-data");
  await data.ensureDataRootLayout(source);
  await mkdir(path.join(source, "projects", "project-12345678"), { recursive: true });
  await writeFile(path.join(source, "projects", "project-12345678", "evidence.bin"), "migration-evidence");
  const result = await data.configureDataRoot({
    userDataPath: userData,
    sourceRoot: source,
    targetRoot: target,
    mode: "migrate",
    now: new Date("2026-08-30T01:00:00Z")
  });
  assert.equal(result.copiedFiles, 1);
  assert.equal(result.copiedBytes, Buffer.byteLength("migration-evidence"));
  assert.equal(result.sourcePreserved, true);
  assert.equal(await readFile(path.join(target, "projects", "project-12345678", "evidence.bin"), "utf8"), "migration-evidence");
  assert.equal(await readFile(path.join(source, "projects", "project-12345678", "evidence.bin"), "utf8"), "migration-evidence");
  assert.equal((await data.loadDataRootPointer(userData)).dataRoot, path.resolve(target));
  await assert.rejects(data.configureDataRoot({ userDataPath: userData, sourceRoot: source, targetRoot: target, mode: "migrate" }), /empty|same/u);
});

test("an existing empty selected folder is accepted while nested migration roots are rejected", async (context) => {
  const data = await loadModule(context, "src/main/services/data-root.ts");
  const temporary = await mkdtemp(path.join(os.tmpdir(), "relay-alpha28-selected-folder-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const selected = path.join(temporary, "用户已选空目录");
  await mkdir(selected);
  const userData = path.join(temporary, "user-data");
  const configured = await data.configureDataRoot({ userDataPath: userData, targetRoot: selected, mode: "new_library" });
  assert.equal(configured.targetRoot, path.resolve(selected));
  assert.ok((await readdir(selected)).includes("projects"));
  const nestedTarget = path.join(selected, "nested-new-root");
  await assert.rejects(
    data.configureDataRoot({ userDataPath: userData, sourceRoot: selected, targetRoot: nestedTarget, mode: "migrate" }),
    /cannot contain one another/u
  );
});

test("project repository creates, saves, lists, restarts, clones and archives real project directories", async (context) => {
  const [repoModule, data] = await Promise.all([
    loadModule(context, "src/main/services/project-repository.ts"),
    loadModule(context, "src/main/services/data-root.ts")
  ]);
  const temporary = await mkdtemp(path.join(os.tmpdir(), "relay-alpha28-projects-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const dataRoot = path.join(temporary, "D 模拟盘", "Relay");
  const clock = fixtureClock();
  const ids = fixtureIds();
  const repository = repoModule.createProjectRepository({ dataRoot, now: clock, createId: ids });
  const created = await repository.createProject({ name: "重庆 雨夜 🙂 / 01" });
  assert.equal(created.name, "重庆 雨夜 🙂 / 01");
  assert.match(created.projectId, /^project-/u);
  const layout = data.resolveProjectDirectoryLayout(dataRoot, created.projectId);
  assert.equal(JSON.parse(await readFile(layout.document, "utf8")).projectId, created.projectId);

  const edited = await repository.saveProject({
    ...created,
    quick: { ...created.quick, workflowName: "测试 02", originalPrompt: "用户原文，不扩写", totalDurationSeconds: 30 }
  }, { expectedUpdatedAt: created.updatedAt });
  assert.equal(edited.quick.originalPrompt, "用户原文，不扩写");
  await assert.rejects(
    repository.saveProject({ ...created, name: "过期保存" }, { expectedUpdatedAt: created.updatedAt }),
    (error) => error?.code === "PROJECT_CONFLICT"
  );
  const restarted = repoModule.createProjectRepository({ dataRoot, now: clock, createId: ids });
  assert.equal((await restarted.loadProject(created.projectId)).quick.workflowName, "测试 02");
  assert.equal((await restarted.listProjects()).length, 1);
  assert.equal((await restarted.listRecentProjects())[0].projectId, created.projectId);

  await writeFile(path.join(layout.assetOriginals, "帧.png"), "project-owned-asset");
  const cloned = await restarted.cloneProject(created.projectId, { name: "副本 Ω" });
  assert.notEqual(cloned.projectId, created.projectId);
  assert.equal(cloned.name, "副本 Ω");
  assert.equal(await readFile(path.join(data.resolveProjectDirectoryLayout(dataRoot, cloned.projectId).assetOriginals, "帧.png"), "utf8"), "project-owned-asset");
  const archived = await restarted.archiveProject(created.projectId);
  assert.equal(archived.status, "archived");
  assert.ok(archived.archivedAt);
  assert.deepEqual((await restarted.listProjects()).map((item) => item.projectId), [cloned.projectId]);
  assert.equal((await restarted.listProjects({ includeArchived: true })).length, 2);
});

test("tampered project identity and reparse roots fail closed without overwriting evidence", async (context) => {
  const [repoModule, data] = await Promise.all([
    loadModule(context, "src/main/services/project-repository.ts"),
    loadModule(context, "src/main/services/data-root.ts")
  ]);
  const temporary = await mkdtemp(path.join(os.tmpdir(), "relay-alpha28-project-tamper-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const repository = repoModule.createProjectRepository({ dataRoot: path.join(temporary, "data"), now: fixtureClock(), createId: fixtureIds() });
  const project = await repository.createProject({ name: "保留损坏证据" });
  const document = data.resolveProjectDirectoryLayout(path.join(temporary, "data"), project.projectId).document;
  const value = JSON.parse(await readFile(document, "utf8"));
  value.projectId = "project-ffffffffffffffffffffffffffffffff";
  const tampered = `${JSON.stringify(value)}\n`;
  await writeFile(document, tampered);
  await assert.rejects(repository.loadProject(project.projectId), (error) => error?.code === "PROJECT_INVALID");
  assert.equal(await readFile(document, "utf8"), tampered);
});
