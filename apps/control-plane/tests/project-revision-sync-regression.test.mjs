import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const source = (relativePath) => readFile(resolve(root, relativePath), "utf8");

async function loadAuthoritySync(context) {
  const buildRoot = await mkdtemp(path.join(os.tmpdir(), "relay-project-authority-sync-"));
  context.after(() => rm(buildRoot, { recursive: true, force: true }));
  const outfile = path.join(buildRoot, "project-authority-sync.mjs");
  await build({
    entryPoints: [path.join(root, "src", "renderer", "project-authority-sync.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "silent"
  });
  return import(`${pathToFileURL(outfile).href}?fixture=${Date.now()}-${Math.random()}`);
}

function project(projectId, updatedAt, suffix = "editor") {
  return Object.freeze({
    schemaVersion: 1,
    projectId,
    name: `项目 ${suffix}`,
    editorMode: "professional",
    status: "active",
    createdAt: "2026-09-02T00:00:00.000Z",
    updatedAt,
    archivedAt: null,
    quick: Object.freeze({ originalPrompt: `quick-${suffix}` }),
    professional: Object.freeze({ directorState: { prompt: `director-${suffix}` } }),
    assets: Object.freeze([{ assetId: `asset-${suffix}` }]),
    entities: Object.freeze([{ entityId: `entity-${suffix}` }]),
    bindings: Object.freeze([{ bindingId: `binding-${suffix}` }]),
    scenes: Object.freeze([{ sceneId: `scene-${suffix}` }]),
    shots: Object.freeze([{ shotId: `shot-${suffix}` }]),
    externalReferences: Object.freeze([{ referenceId: `reference-${suffix}` }]),
    workflows: Object.freeze([]),
    history: Object.freeze([])
  });
}

function authorityWithHandoff(projectId, updatedAt) {
  return Object.freeze({
    ...project(projectId, updatedAt, "authority"),
    workflows: Object.freeze([Object.freeze({
      workflowId: "workflow-authority1",
      projectRelativePath: "workflows/本次工作流.json",
      handoffs: Object.freeze([Object.freeze({ targetRelativePath: "user/default/workflows/本次工作流.json" })])
    })]),
    history: Object.freeze([{ historyId: "history-authority1" }])
  });
}

function sliceBetween(value, startMarker, endMarker) {
  const start = value.indexOf(startMarker);
  const end = value.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing start marker: ${startMarker}`);
  assert.ok(end > start, `missing end marker after ${startMarker}: ${endMarker}`);
  return value.slice(start, end);
}

test("compile handoff returns the authoritative project document produced after its project mutations", async () => {
  const [contract, services] = await Promise.all([
    source("src/shared/ipc-contract.ts"),
    source("src/main/services/index.ts")
  ]);
  const resultContract = sliceBetween(
    contract,
    "export interface CompileAndOpenWorkflowResult",
    "export interface RelayProjectSummaryContract"
  );
  assert.match(
    resultContract,
    /readonly authoritativeProject:\s*RelayProjectDocument \| null/u,
    "the renderer needs the complete authority state, not only a new timestamp"
  );

  const handoffService = sliceBetween(
    services,
    "export async function storeAndHandoffProjectWorkflow",
    "function createResultMediaSelection"
  );
  const projectHandoff = handoffService.indexOf("await workflowStore.handoffAuthoritativeWorkflow");
  const finalReload = handoffService.indexOf("await options.repository.loadProject(options.projectId)", projectHandoff);
  const evidenceReturn = handoffService.indexOf("return Object.freeze({", finalReload);
  assert.ok(projectHandoff >= 0, "the authoritative workflow must be handed off before its project snapshot is returned");
  assert.ok(finalReload > projectHandoff, "handoff evidence must reload the final repository document");
  assert.ok(evidenceReturn > finalReload, "the final repository document must be included in handoff evidence");
  assert.match(handoffService.slice(evidenceReturn), /\bauthoritativeProject\b/u);

  const compile = sliceBetween(
    services,
    "const compileAndOpenWorkflow = async",
    "\n  return Object.freeze({\n    getBootstrap,"
  );
  const handoffMutation = compile.indexOf("await storeAndHandoffProjectWorkflow");
  const authorityCapture = compile.indexOf("authoritativeProject", handoffMutation);
  const resultReturn = compile.lastIndexOf("return Object.freeze({");
  assert.ok(handoffMutation >= 0, "the project authority handoff must remain explicit");
  assert.ok(
    authorityCapture > handoffMutation,
    "authoritativeProject must be captured only after workflow and handoff records mutate the project"
  );
  assert.ok(resultReturn > authorityCapture, "the captured authority must be returned to the renderer");
  assert.match(compile.slice(resultReturn), /\bauthoritativeProject\b/u);
  assert.match(
    compile.slice(handoffMutation, resultReturn),
    /authoritativeProject\s*=\s*projectAuthority\.authoritativeProject/u,
    "the compile result must forward the final project carried by verified handoff evidence"
  );
});

test("renderer adopts authority-owned collections and its revision before committing a Director Revision", async () => {
  const [renderer, authoritySyncSource] = await Promise.all([
    source("src/renderer/index.ts"),
    source("src/renderer/project-authority-sync.ts")
  ]);
  const submit = sliceBetween(
    renderer,
    'projectForm.addEventListener("submit"',
    "void (async () => {\n  try {\n    const bootstrap"
  );
  const handoff = submit.indexOf("await window.controlPlane.compileAndOpenWorkflow");
  const authoritySync = submit.indexOf("adoptCompiledProjectAuthority(", handoff);
  const directorRevision = submit.indexOf("markDirectorCompiled(submittedDirectorCompilation)", handoff);
  assert.ok(handoff >= 0, "missing workflow handoff call");
  assert.ok(authoritySync > handoff, "the handoff result must synchronize project authority");
  assert.ok(
    directorRevision > authoritySync,
    "authority synchronization must finish before markDirectorCompiled can save another full project document"
  );

  const merge = sliceBetween(
    authoritySyncSource,
    "function mergeAuthoritativeProjectWithEditorState",
    "function synchronizeWorkspaceAuthoritativeProject"
  );
  assert.match(merge, /return Object\.freeze\(\{[\s\S]*?\.\.\.authoritativeProject/u);
  assert.match(merge, /quick:\s*editorProject\.quick/u);
  assert.match(merge, /professional:\s*editorProject\.professional/u);
  assert.match(
    renderer,
    /persistedProjectUpdatedAtById\.set\(authoritativeProject\.projectId,\s*authoritativeProject\.updatedAt\)/u,
    "the next CAS save must use the exact post-handoff project revision"
  );
  for (const field of ["assets", "externalReferences", "workflows", "history"]) {
    assert.doesNotMatch(
      merge,
      new RegExp(`${field}:\\s*editorProject\\.${field}`, "u"),
      `post-handoff synchronization must not replace authority-owned ${field} with stale editor data`
    );
  }
  assert.doesNotMatch(
    renderer,
    /activeRelayProject\s*=\s*authoritativeProject\s*;/u,
    "adopting authority must not discard newer in-memory Director edits by replacing the whole active document"
  );
  const workspaceSync = sliceBetween(
    authoritySyncSource,
    "function synchronizeWorkspaceAuthoritativeProject",
    "function assertProjectContainsCompileHandoff"
  );
  assert.match(workspaceSync, /commands\.map[\s\S]*?before: rebase\(command\.before\)[\s\S]*?after: rebase\(command\.after\)/u);
  assert.match(workspaceSync, /history\.map[\s\S]*?projectSnapshot[\s\S]*?canonicalProjectJson\(snapshot\)/u);
  assert.match(workspaceSync, /persistedContentHash:\s*projectContentHash\(authoritativeProject\)/u);
});

test("consecutive compile and project switching keep revision tokens isolated by project and activation epoch", async () => {
  const renderer = await source("src/renderer/index.ts");
  const activate = sliceBetween(renderer, "async function activateRelayProject", "function projectWithQuickForm");
  const persist = sliceBetween(renderer, "async function persistRelayProject", "function scheduleQuickProjectSave");
  const submit = sliceBetween(
    renderer,
    'projectForm.addEventListener("submit"',
    "void (async () => {\n  try {\n    const bootstrap"
  );

  assert.match(
    persist,
    /const projectId = project\.projectId[\s\S]*?expectedUpdatedAt:\s*persistedProjectUpdatedAtById\.get\(projectId\) \?\? project\.updatedAt/u,
    "a save for project B must never reuse project A's post-compile token"
  );
  assert.doesNotMatch(persist, /\bpersistedProjectUpdatedAt\b(?!ById)/u);
  assert.match(
    activate,
    /persistedProjectUpdatedAtById\.set\(project\.projectId,\s*project\.updatedAt\)/u,
    "switching projects must seed the destination project's own authoritative token"
  );

  const handoff = submit.indexOf("await window.controlPlane.compileAndOpenWorkflow");
  const guardFunction = submit.indexOf("const compilationProjectIsStillActive", handoff);
  const initialGuard = submit.indexOf("let projectStillActive = compilationProjectIsStillActive()", guardFunction);
  const authoritySync = submit.indexOf("adoptCompiledProjectAuthority(", initialGuard);
  const fallbackReload = submit.indexOf("await window.controlPlane.loadRelayProject", authoritySync);
  const finalGuard = submit.indexOf("projectStillActive = compilationProjectIsStillActive()", fallbackReload);
  const directorRevision = submit.indexOf("markDirectorCompiled(submittedDirectorCompilation)", handoff);
  assert.ok(
    handoff >= 0 && guardFunction > handoff && initialGuard > guardFunction
      && authoritySync > initialGuard && fallbackReload > authoritySync
      && finalGuard > fallbackReload && directorRevision > finalGuard,
    "compile completion must guard, adopt (or reload), guard again, and only then permit a subsequent save"
  );
  assert.match(
    submit.slice(guardFunction, initialGuard),
    /activeRelayProject\?\.projectId === relayProjectDocument\.projectId[\s\S]*?activeProjectActivationEpoch === compilationActivationEpoch/u,
    "a late compile from project A must not save into project B after a switch"
  );
  assert.match(
    submit.slice(finalGuard, directorRevision),
    /if \(projectStillActive && !authorityAdopted\)[\s\S]*?throw new Error/u,
    "a current project whose authoritative state could not be adopted must fail closed before markDirectorCompiled"
  );
  const adopt = sliceBetween(
    renderer,
    "function adoptCompiledProjectAuthority",
    "async function flushAndCaptureProjectMutation"
  );
  assert.match(adopt, /authoritativeProject\.projectId !== expectedProjectId[\s\S]*?throw new Error/u);
  assert.match(adopt, /assertProjectContainsCompileHandoff\(authoritativeProject, workflowFileName, targetRelativePath\)/u);
});

test("authority synchronization behavior rejects stale or cross-project results and rebases undo/history", async (context) => {
  const sync = await loadAuthoritySync(context);
  const projectId = "project-authority-sync1";
  const editor = project(projectId, "2026-09-02T10:00:00.000Z", "editor");
  const authority = authorityWithHandoff(projectId, "2026-09-02T10:00:01.000Z");

  assert.equal(sync.canAdoptProjectAuthority({
    authoritativeProject: authority,
    expectedProjectId: projectId,
    currentProjectId: projectId,
    expectedActivationEpoch: 7,
    currentActivationEpoch: 7,
    knownUpdatedAt: editor.updatedAt
  }), true);
  assert.equal(sync.canAdoptProjectAuthority({
    authoritativeProject: authority,
    expectedProjectId: projectId,
    currentProjectId: projectId,
    expectedActivationEpoch: 7,
    currentActivationEpoch: 8,
    knownUpdatedAt: editor.updatedAt
  }), false);
  assert.equal(sync.canAdoptProjectAuthority({
    authoritativeProject: editor,
    expectedProjectId: projectId,
    currentProjectId: projectId,
    expectedActivationEpoch: 7,
    currentActivationEpoch: 7,
    knownUpdatedAt: authority.updatedAt
  }), false);
  assert.throws(() => sync.canAdoptProjectAuthority({
    authoritativeProject: authorityWithHandoff("project-other-sync1", authority.updatedAt),
    expectedProjectId: projectId,
    currentProjectId: projectId,
    expectedActivationEpoch: 7,
    currentActivationEpoch: 7,
    knownUpdatedAt: editor.updatedAt
  }), /其他项目/u);

  const checkpoint = Object.freeze({
    id: "checkpoint-1",
    parentCheckpointId: null,
    createdAt: editor.updatedAt,
    reason: "manual",
    label: "保存前",
    projectContentHash: "stale",
    projectSnapshot: JSON.stringify(editor)
  });
  const controller = Object.freeze({
    session: Object.freeze({
      current: editor,
      currentRevision: 1,
      persistedContentHash: "stale",
      commands: Object.freeze([Object.freeze({ id: "command-1", label: "编辑镜头", before: editor, after: editor, createdAtMs: 1 })]),
      commandCursor: 1,
      history: Object.freeze([checkpoint]),
      activeCheckpointId: checkpoint.id,
      autosave: Object.freeze({ phase: "saved", dueAtMs: null, activeRequestId: null, lastSavedAt: null, lastError: null }),
      autosaveDelayMs: 750,
      maximumUndoDepth: 100
    }),
    layout: Object.freeze({}),
    activeAuxiliaryView: "compile_check",
    auxiliaryOpen: false,
    focusedLocation: null,
    issues: Object.freeze([]),
    summary: Object.freeze({}),
    actions: Object.freeze([])
  });
  const rebased = sync.synchronizeWorkspaceAuthoritativeProject(controller, authority);
  for (const state of [
    rebased.session.current,
    rebased.session.commands[0].before,
    rebased.session.commands[0].after,
    JSON.parse(rebased.session.history[0].projectSnapshot)
  ]) {
    assert.equal(state.quick.originalPrompt, "quick-editor", "unsaved editor prompt must survive authority adoption");
    assert.equal(state.workflows.length, 1, "authority workflow must survive later Undo/Redo/history restore");
    assert.equal(state.history.length, 1, "authority compile history must survive later Undo/Redo/history restore");
    assert.equal(state.assets[0].assetId, "asset-authority", "service-owned assets come from authority");
  }
  assert.notEqual(rebased.session.persistedContentHash, "stale");

  assert.doesNotThrow(() => sync.assertProjectContainsCompileHandoff(
    authority,
    "本次工作流.json",
    "user/default/workflows/本次工作流.json"
  ));
  assert.throws(() => sync.assertProjectContainsCompileHandoff(authority, "旧工作流.json", null), /未包含本次权威工作流/u);
  assert.throws(() => sync.assertProjectContainsCompileHandoff(
    authority,
    "本次工作流.json",
    "user/default/workflows/错误.json"
  ), /未包含本次 ComfyUI 交接记录/u);
});

test("every renderer project-asset mutation flushes editor state and reloads the new authority revision", async () => {
  const [renderer, generatedVideoRenderer] = await Promise.all([
    source("src/renderer/index.ts"),
    source("src/renderer/generated-video-ui.ts")
  ]);
  const mutationMethods = [
    "importProjectAssets",
    "importDroppedProjectAssets",
    "updateProjectAsset",
    "refreshProjectAssets",
    "relocateProjectAsset",
    "copyProjectAssetIntoProject",
    "removeProjectAsset",
    "restoreProjectAsset",
    "addGeneratedVideoToProjectAssets"
  ];
  for (const method of mutationMethods) {
    const mutationSource = method === "addGeneratedVideoToProjectAssets" ? generatedVideoRenderer : renderer;
    const call = mutationSource.indexOf(`.${method}(`);
    assert.ok(call >= 0, `missing ${method} call`);
    const dependencyPrefix = method === "addGeneratedVideoToProjectAssets" ? "dependencies." : "";
    const start = mutationSource.lastIndexOf(`const mutation = await ${dependencyPrefix}flushAndCaptureProjectMutation();`, call);
    const sync = mutationSource.indexOf(`await ${dependencyPrefix}synchronizeProjectMutation(mutation)`, call);
    assert.ok(start >= 0 && start < call && sync > call && sync - call < 700, `${method} must flush before mutation and reload authority immediately after it`);
  }
});

test("a genuine remaining project conflict is described as a reload conflict, not a generic open failure", async () => {
  const renderer = await source("src/renderer/index.ts");
  const classifier = sliceBetween(renderer, "function projectOpenFailureTitle", "assetLibraryController.subscribe");
  assert.match(classifier, /项目已在另一操作中更新\|项目版本已变化\|项目已被移除/u);
  assert.match(classifier, /项目版本需要重新载入/u);
  const center = sliceBetween(renderer, "function projectCenterSurfaceButton", "function appendActiveProjectSummary");
  assert.match(center, /projectOpenFailureTitle/u);
});
