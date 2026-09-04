import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { build } from "esbuild";

const projectRoot = path.resolve(import.meta.dirname, "..");

function ids() {
  let value = 1;
  return () => (value++).toString(16).padStart(32, "0");
}

function clock() {
  let value = 0;
  return () => new Date(Date.UTC(2026, 7, 30, 12, 0, value++));
}

async function loadServices(context) {
  const buildRoot = await mkdtemp(path.join(os.tmpdir(), "relay-alpha28-authority-build-"));
  context.after(() => rm(buildRoot, { recursive: true, force: true }));
  const outfile = path.join(buildRoot, "services.mjs");
  await build({
    entryPoints: [path.join(projectRoot, "src", "main", "services", "index.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "silent",
    plugins: [{
      name: "relay-alpha28-electron-stub",
      setup(builder) {
        builder.onResolve({ filter: /^electron$/ }, () => ({
          path: "electron",
          namespace: "relay-alpha28-electron-stub"
        }));
        builder.onLoad({ filter: /.*/, namespace: "relay-alpha28-electron-stub" }, () => ({
          contents: `
            export class BrowserWindow {}
            export const dialog = Object.freeze({});
            export const session = Object.freeze({});
            export const utilityProcess = Object.freeze({});
          `,
          loader: "js"
        }));
      }
    }]
  });
  return import(`${pathToFileURL(outfile).href}?fixture=${Date.now()}-${Math.random()}`);
}

async function loadCompileServices(context, environment) {
  const buildRoot = await mkdtemp(path.join(os.tmpdir(), "relay-alpha28-compile-service-build-"));
  context.after(() => rm(buildRoot, { recursive: true, force: true }));
  const outfile = path.join(buildRoot, "compile-services.mjs");
  const setup = {
    installRoot: environment.temporary,
    comfyUiRoot: environment.comfyRoot.root,
    modelRoot: environment.temporary,
    comfySource: "explicit",
    modelSource: "explicit",
    setupComplete: true,
    completedComponents: ["fl2va_base", "pyav_required", "comfyui_desktop_optional"],
    completedInstallationId: "install-0123456789abcdef01234567"
  };
  await build({
    entryPoints: [path.join(projectRoot, "src", "main", "services", "index.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "silent",
    plugins: [{
      name: "relay-compile-service-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "fixture" }));
        builder.onResolve({ filter: /^\.\/ab-cli-adapter\.js$/ }, () => ({ path: "adapter", namespace: "fixture" }));
        builder.onResolve({ filter: /^\.\/setup-preferences\.js$/ }, () => ({ path: "setup", namespace: "fixture" }));
        builder.onResolve({ filter: /^\.\/comfy-root\.js$/ }, () => ({ path: "comfy-root", namespace: "fixture" }));
        builder.onLoad({ filter: /^electron$/, namespace: "fixture" }, () => ({
          contents: `
            export class BrowserWindow { static getAllWindows() { return []; } }
            export const dialog = Object.freeze({ showOpenDialog: async () => ({ canceled: true, filePaths: [] }) });
            export const session = Object.freeze({ defaultSession: Object.freeze({}) });
            export const utilityProcess = Object.freeze({});
          `,
          loader: "js"
        }));
        builder.onLoad({ filter: /^adapter$/, namespace: "fixture" }, () => ({
          contents: `
            export function createAbCliAdapter() {
              return Object.freeze({
                streamAAvailable: true,
                streamBAvailable: true,
                restoreCompletedInstallation: async () => undefined,
                compileWorkflow: async (request) => ({
                  version: 0.4,
                  nodes: [{ id: 1, type: "SaveVideo", widgets_values: ["old"], widgets_values_named: { filename_prefix: "old" } }],
                  links: [],
                  extra: {
                    relay_seed: {
                      contract_id: request.seedResolution.contractId,
                      schema_version: request.seedResolution.schemaVersion,
                      policy: request.seedResolution.policy,
                      base_seed: request.seedResolution.baseSeed,
                      node_control_after_generate: request.seedResolution.nodeControlAfterGenerate,
                      shots: request.seedResolution.shots.map((shot) => ({
                        shot_id: shot.shotId,
                        ordinal: shot.ordinal,
                        seed: shot.seed
                      }))
                    }
                  }
                })
              });
            }
          `,
          loader: "js"
        }));
        builder.onLoad({ filter: /^setup$/, namespace: "fixture" }, () => ({
          contents: `
            const setup = Object.freeze(${JSON.stringify(setup)});
            export async function loadSetupPreferences() { return setup; }
            export async function saveSetupPreferences() { return true; }
            export async function verifySavedDirectory(value) { return value; }
            export async function inspectPersistedComponents() {
              return Object.freeze({
                verifiedComponents: setup.completedComponents,
                foundComponents: [],
                claimedComponents: setup.completedComponents,
                completedComponents: setup.completedComponents,
                completedInstallationId: setup.completedInstallationId,
                recoveredModelRoot: null,
                vramBytes: null,
                setupComplete: true
              });
            }
          `,
          loader: "js"
        }));
        builder.onLoad({ filter: /^comfy-root$/, namespace: "fixture" }, () => ({
          contents: `
            import { join } from "node:path";
            export async function verifyUserSelectedComfyRoot(root) {
              return Object.freeze({
                root,
                comfyDirectory: join(root, "ComfyUI"),
                inputDirectory: join(root, "ComfyUI", "input"),
                outputDirectory: join(root, "ComfyUI", "output"),
                workflowDirectory: join(root, "ComfyUI", "user", "default", "workflows"),
                mainScript: join(root, "ComfyUI", "main.py"),
                embeddedPython: join(root, "python_embeded", "python.exe"),
                topology: "portable"
              });
            }
          `,
          loader: "js"
        }));
      }
    }]
  });
  return import(`${pathToFileURL(outfile).href}?fixture=${Date.now()}-${Math.random()}`);
}

async function loadProjectCenter(context) {
  const buildRoot = await mkdtemp(path.join(os.tmpdir(), "relay-alpha28-project-frame-build-"));
  context.after(() => rm(buildRoot, { recursive: true, force: true }));
  const outfile = path.join(buildRoot, "project-center.mjs");
  await build({
    entryPoints: [path.join(projectRoot, "src", "main", "services", "project-center.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "silent"
  });
  return import(`${pathToFileURL(outfile).href}?fixture=${Date.now()}-${Math.random()}`);
}

function png(width, height, marker = 0) {
  const bytes = Buffer.alloc(34);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes[24] = 8;
  bytes[25] = 6;
  bytes[33] = marker;
  return bytes;
}

async function fixture(context) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "relay-alpha28-authority-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const dataRoot = path.join(temporary, "Relay 数据 Ω");
  const comfyRoot = path.join(temporary, "外部 ComfyUI");
  const comfyDirectory = path.join(comfyRoot, "ComfyUI");
  const workflowDirectory = path.join(comfyDirectory, "user", "default", "workflows");
  const inputDirectory = path.join(comfyDirectory, "input");
  const fs = await import("node:fs/promises");
  await Promise.all([
    fs.mkdir(inputDirectory, { recursive: true }),
    fs.mkdir(comfyRoot, { recursive: true })
  ]);
  return Object.freeze({
    temporary,
    dataRoot,
    comfyRoot: Object.freeze({
      root: comfyRoot,
      comfyDirectory,
      inputDirectory,
      workflowDirectory,
      mainScript: path.join(comfyDirectory, "main.py"),
      embeddedPython: path.join(comfyRoot, "python_embeded", "python.exe"),
      topology: "portable"
    })
  });
}

test("real compiled graph is authoritative in the project before a hash-verified attach-only Comfy handoff", async (context) => {
  const services = await loadServices(context);
  const environment = await fixture(context);
  const repository = services.createProjectRepository({
    dataRoot: environment.dataRoot,
    now: clock(),
    createId: ids()
  });
  const project = await repository.createProject({ name: "雨夜项目 01" });
  const workflow = Object.freeze({
    version: 0.4,
    nodes: Object.freeze([{ id: 1, type: "MiniMax H3", widgets_values: Object.freeze(["本次提示词 Ω"]) }]),
    links: Object.freeze([]),
    extra: Object.freeze({ relayEvidence: "alpha28" })
  });

  const evidence = await services.storeAndHandoffProjectWorkflow({
    dataRootPath: environment.dataRoot,
    repository,
    projectId: project.projectId,
    workflowName: "重庆 雨夜 01",
    workflow,
    comfyRoot: environment.comfyRoot
  });

  const authorityPath = path.join(evidence.authorityDirectory, evidence.workflowFileName);
  const targetPath = path.join(environment.comfyRoot.root, evidence.targetRelativePath);
  const authority = await readFile(authorityPath);
  const target = await readFile(targetPath);
  assert.deepEqual(target, authority);
  assert.equal(authority.byteLength, evidence.authorityByteLength);
  assert.equal(createHash("sha256").update(authority).digest("hex"), evidence.authoritySha256);

  const persisted = await repository.loadProject(project.projectId);
  assert.equal(persisted.workflows.length, 1);
  assert.equal(persisted.workflows[0].handoffs.length, 1);
  assert.equal(persisted.workflows[0].handoffs[0].sha256, evidence.authoritySha256);
  assert.equal(persisted.externalReferences.length, 1);
  assert.equal(persisted.externalReferences[0].kind, "comfyui_root");
  assert.equal(persisted.externalReferences[0].attachOnly, true);
  assert.match(persisted.externalReferences[0].locatorId, /^comfy-root-[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(persisted).includes(environment.comfyRoot.root), false);
  assert.equal(JSON.stringify(persisted).includes(environment.comfyRoot.workflowDirectory), false);
  assert.deepEqual(evidence.authoritativeProject, persisted);
  assert.equal(evidence.authoritativeProject.updatedAt, persisted.updatedAt);
  assert.equal(evidence.authoritativeProject.workflows[0].handoffs.length, 1);
  assert.equal(evidence.authoritativeProject.history[0].kind, "compile_handoff");
});

test("consecutive project handoffs reuse one stable Comfy reference while keeping distinct immutable authorities", async (context) => {
  const services = await loadServices(context);
  const environment = await fixture(context);
  const repository = services.createProjectRepository({
    dataRoot: environment.dataRoot,
    now: clock(),
    createId: ids()
  });
  const project = await repository.createProject({ name: "连续交接" });
  const first = await services.storeAndHandoffProjectWorkflow({
    dataRootPath: environment.dataRoot,
    repository,
    projectId: project.projectId,
    workflowName: "镜头 A",
    workflow: { nodes: [{ id: 1, prompt: "A" }], links: [] },
    comfyRoot: environment.comfyRoot
  });
  const second = await services.storeAndHandoffProjectWorkflow({
    dataRootPath: environment.dataRoot,
    repository,
    projectId: project.projectId,
    workflowName: "镜头 B",
    workflow: { nodes: [{ id: 1, prompt: "B" }], links: [] },
    comfyRoot: environment.comfyRoot
  });
  assert.notEqual(first.workflowId, second.workflowId);
  assert.notEqual(first.workflowFileName, second.workflowFileName);
  assert.notEqual(first.authoritySha256, second.authoritySha256);
  const persisted = await repository.loadProject(project.projectId);
  assert.equal(persisted.externalReferences.length, 1);
  assert.equal(persisted.workflows.length, 2);
  assert.deepEqual(persisted.workflows.map((entry) => entry.handoffs.length), [1, 1]);
});

test("post-handoff Director save uses the returned revision and preserves every workflow and history record", async (context) => {
  const services = await loadServices(context);
  const environment = await fixture(context);
  const repository = services.createProjectRepository({
    dataRoot: environment.dataRoot,
    now: clock(),
    createId: ids()
  });
  const project = await repository.createProject({ name: "连续编译后切换" });
  await repository.createProject({ name: "目标项目" });
  let authoritative = project;
  for (const label of ["镜头 1", "镜头 2", "镜头 3"]) {
    const evidence = await services.storeAndHandoffProjectWorkflow({
      dataRootPath: environment.dataRoot,
      repository,
      projectId: project.projectId,
      workflowName: label,
      workflow: { nodes: [{ id: 1, prompt: label }], links: [] },
      comfyRoot: environment.comfyRoot
    });
    authoritative = evidence.authoritativeProject;
  }

  const directorState = { source: "post-handoff-regression", revisionCount: 1 };
  const saved = await repository.saveProject({
    ...authoritative,
    professional: {
      ...authoritative.professional,
      directorState
    }
  }, { expectedUpdatedAt: authoritative.updatedAt });

  assert.equal(saved.workflows.length, 3);
  assert.equal(saved.history.length, 3);
  assert.equal(saved.externalReferences.length, 1);
  assert.deepEqual(saved.professional.directorState, directorState);
  assert.deepEqual(saved.workflows.map((entry) => entry.handoffs.length), [1, 1, 1]);
});

test("public compile service returns the exact post-handoff project authority used by the next CAS save", async (context) => {
  const environment = await fixture(context);
  const servicesModule = await loadCompileServices(context, environment);
  const repository = servicesModule.createProjectRepository({
    dataRoot: environment.dataRoot,
    now: clock(),
    createId: ids()
  });
  const project = await repository.createProject({ name: "公开编译入口" });
  const services = servicesModule.createControlPlaneServices({
    appVersion: "1.0.0",
    userDataPath: path.join(environment.temporary, "redirected-user-data"),
    dataRootPath: environment.dataRoot,
    projectRepository: repository,
    appPath: environment.temporary,
    executableDirectory: environment.temporary,
    resourcesPath: environment.temporary,
    isPackaged: true,
    enableExternalAdapters: true,
    skipVisibleOpen: true
  });
  await services.getBootstrap();
  const result = await services.compileAndOpenWorkflow({
    workflowName: "本次工作流",
    projectId: project.projectId,
    exportDirectorySelectionId: null,
    project: {
      prompt: "只属于本次项目的提示词",
      mode: "T2V",
      firstFrameSelectionId: null,
      lastFrameSelectionId: null,
      durationSeconds: 5,
      segmentDurationSeconds: 5,
      canvas: "9:16",
      resolutionMegapixels: 0.4,
      advanced: { seed: 7, seedPolicy: "fixed", samplingProfile: "quality_20" }
    }
  });
  const persisted = await repository.loadProject(project.projectId);
  assert.ok(result.authoritativeProject, "real project compile must return a complete authority document");
  assert.deepEqual(result.authoritativeProject, persisted);
  assert.equal(result.authoritativeProject.updatedAt, persisted.updatedAt);
  assert.equal(result.authoritativeProject.workflows.length, 1);
  assert.equal(result.authoritativeProject.workflows[0].handoffs.length, 1);
  assert.equal(result.workflowFileName, path.basename(result.authoritativeProject.workflows[0].projectRelativePath));
  assert.equal(result.workflowLibraryDisplay, result.authoritativeProject.workflows[0].handoffs[0].targetRelativePath);

  const timingPath = path.join(environment.dataRoot, "logs", "comfy-handoff-timing.v2.json");
  const successfulTiming = JSON.parse(await readFile(timingPath, "utf8"));
  assert.equal(successfulTiming.schema_version, 2);
  assert.equal(successfulTiming.samples.length, 1);
  assert.equal(successfulTiming.samples[0].outcome, "stored_not_opened");
  assert.equal(successfulTiming.samples[0].failed_stage, null);
  assert.equal(successfulTiming.samples[0].stable_error_code, null);
  assert.equal(successfulTiming.samples[0].stages.visible_handoff, null);
  for (const stage of [
    "request_validation_ms",
    "input_preparation_ms",
    "workflow_compilation_ms",
    "capability_preflight_ms",
    "workflow_persistence_ms",
    "visible_handoff_ms"
  ]) {
    assert.equal(Number.isInteger(successfulTiming.samples[0].stages[stage]), true, stage);
    assert.equal(successfulTiming.samples[0].stages[stage] >= 0, true, stage);
  }
  const serializedTiming = JSON.stringify(successfulTiming);
  assert.equal(serializedTiming.includes(environment.dataRoot), false);
  assert.equal(serializedTiming.includes(environment.comfyRoot.root), false);
  assert.equal(serializedTiming.includes("只属于本次项目的提示词"), false);

  await assert.rejects(
    services.compileAndOpenWorkflow({}),
    (error) => error?.code === "INVALID_REQUEST"
  );
  const failedTiming = JSON.parse(await readFile(timingPath, "utf8"));
  assert.equal(failedTiming.samples.length, 2);
  assert.equal(failedTiming.samples[1].outcome, "failed");
  assert.equal(failedTiming.samples[1].failed_stage, "request_validation");
  assert.equal(failedTiming.samples[1].stable_error_code, "INVALID_REQUEST");

  const next = await repository.saveProject({
    ...result.authoritativeProject,
    professional: { ...result.authoritativeProject.professional, directorState: { marker: "saved-after-public-compile" } }
  }, { expectedUpdatedAt: result.authoritativeProject.updatedAt });
  assert.equal(next.workflows.length, 1);
  assert.equal(next.history.length, 1);
  assert.deepEqual(next.professional.directorState, { marker: "saved-after-public-compile" });
});

test("project authority rejects a repository from a different dataRoot before writing", async (context) => {
  const services = await loadServices(context);
  const environment = await fixture(context);
  const repository = services.createProjectRepository({
    dataRoot: path.join(environment.temporary, "另一数据根"),
    now: clock(),
    createId: ids()
  });
  await assert.rejects(
    services.storeAndHandoffProjectWorkflow({
      dataRootPath: environment.dataRoot,
      repository,
      projectId: "project-12345678",
      workflowName: "不得写入",
      workflow: { nodes: [], links: [] },
      comfyRoot: environment.comfyRoot
    }),
    /does not belong/u
  );
});

test("project frame resolution is main-process-only and fails closed after the registered asset changes", async (context) => {
  const { createProjectCenterService } = await loadProjectCenter(context);
  const temporary = await mkdtemp(path.join(os.tmpdir(), "relay-alpha28-project-frame-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const dataRoot = path.join(temporary, "Relay 数据");
  const source = path.join(temporary, "首帧 Ω.png");
  await writeFile(source, png(608, 352, 1));
  const center = createProjectCenterService({ dataRoot, now: clock(), createId: ids() });
  await center.initialize();
  const project = await center.createProject({ name: "素材桥接" });
  const imported = await center.importAssets(project.projectId, { paths: [source], mode: "copy" });
  const asset = imported.results[0].asset;
  assert.ok(asset);
  const resolved = await center.resolveUsableAssetPath(project.projectId, asset.assetId);
  assert.equal(path.isAbsolute(resolved), true);
  assert.equal(resolved, path.join(dataRoot, "projects", project.projectId, asset.projectRelativePath));
  assert.equal(JSON.stringify(await center.listAssets(project.projectId)).includes(resolved), false);

  await writeFile(resolved, png(608, 352, 2));
  await assert.rejects(
    center.resolveUsableAssetPath(project.projectId, asset.assetId),
    /长度|SHA-256|变化|changed/u
  );
});

test("project asset frame IPC exposes stable IDs and a slot, never an absolute path", async () => {
  const [contract, preload, registry, main] = await Promise.all([
    readFile(path.join(projectRoot, "src", "shared", "ipc-contract.ts"), "utf8"),
    readFile(path.join(projectRoot, "src", "preload", "index.ts"), "utf8"),
    readFile(path.join(projectRoot, "src", "main", "ipc-registry.ts"), "utf8"),
    readFile(path.join(projectRoot, "src", "main", "main.ts"), "utf8")
  ]);
  assert.match(contract, /ProjectAssetFrameRequestContract extends ProjectAssetIdRequestContract[\s\S]{0,120}readonly slot: FrameSlot/u);
  assert.match(preload, /prepareProjectAssetFrame:[\s\S]{0,180}IPC_REGISTRY\.prepareProjectAssetFrame/u);
  assert.match(registry, /requireExactRecord\([\s\S]{0,160}\["projectId", "assetId", "slot"\][\s\S]{0,260}validateFrameSlot\(input\.slot\)/u);
  assert.match(main, /prepareProjectAssetFrame\(request\)[\s\S]{0,220}resolveUsableAssetPath\(request\.projectId, request\.assetId\)[\s\S]{0,180}registerTrustedFrameSelection\(absolutePath, request\.slot\)/u);
  const requestContract = contract.match(/export interface ProjectAssetFrameRequestContract[\s\S]*?\n\}/u)?.[0] ?? "";
  assert.doesNotMatch(requestContract, /(?:absolutePath|displayPath|canonicalPath)/u);
});
