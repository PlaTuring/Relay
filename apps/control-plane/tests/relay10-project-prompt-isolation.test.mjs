import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");

async function bundledModule(entry) {
  const result = await build({
    entryPoints: [resolve(root, entry)],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    target: "node22",
    logLevel: "silent"
  });
  const source = result.outputFiles[0]?.text;
  assert.ok(source);
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

async function source(path) {
  return readFile(resolve(root, path), "utf8");
}

function sliceBetween(value, startMarker, endMarker) {
  const start = value.indexOf(startMarker);
  const end = value.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `missing source slice: ${startMarker} -> ${endMarker}`);
  return value.slice(start, end);
}

test("Quick Create and Professional Director prompts remain independent in one project", async () => {
  const [domain, director] = await Promise.all([
    bundledModule("src/shared/project-domain.ts"),
    bundledModule("src/renderer/professional-director.ts")
  ]);
  const quickSentinel = "QUICK_ONLY_快建提示词";
  const directorSentinel = "DIRECTOR_ONLY_导播镜头";
  const created = domain.createEmptyRelayProject({
    projectId: "project-prompt-isolation",
    name: "提示词隔离项目",
    createdAt: "2026-09-02T00:00:00.000Z"
  });
  const quickProject = domain.normalizeRelayProject({
    ...created,
    quick: {
      ...created.quick,
      workflowName: "快速工作流",
      originalPrompt: quickSentinel,
      totalDurationSeconds: 15,
      segmentDurationSeconds: 5
    }
  });
  const promoted = director.promoteQuickProjectToProfessional({
    project: quickProject,
    updatedAt: "2026-09-02T00:00:01.000Z"
  });
  assert.equal(promoted.quick.originalPrompt, quickSentinel);
  assert.ok(promoted.shots.every((shot) => shot.prompt === ""));
  assert.equal(director.effectiveDirectorShotPrompt(promoted, promoted.shots[0].shotId), "");

  const edited = domain.normalizeRelayProject({
    ...promoted,
    shots: promoted.shots.map((shot, index) => index === 0 ? { ...shot, prompt: directorSentinel } : shot)
  });
  assert.equal(edited.quick.originalPrompt, quickSentinel);
  assert.equal(director.effectiveDirectorShotPrompt(edited, edited.shots[0].shotId), directorSentinel);

  const cleared = domain.normalizeRelayProject({
    ...edited,
    shots: edited.shots.map((shot, index) => index === 0 ? { ...shot, prompt: "" } : shot)
  });
  assert.equal(cleared.quick.originalPrompt, quickSentinel);
  assert.equal(
    director.effectiveDirectorShotPrompt(cleared, cleared.shots[0].shotId),
    "",
    "an empty Director shot must never fall back to the Quick prompt"
  );
});

test("archiving a populated project then creating a new project persists no old prompt data", async (context) => {
  const [domain, director, repositoryModule] = await Promise.all([
    bundledModule("src/shared/project-domain.ts"),
    bundledModule("src/renderer/professional-director.ts"),
    bundledModule("src/main/services/project-repository.ts")
  ]);
  const dataRoot = await mkdtemp(join(os.tmpdir(), "relay-prompt-isolation-"));
  context.after(() => rm(dataRoot, { recursive: true, force: true }));
  let clockTick = 0;
  const repository = repositoryModule.createProjectRepository({
    dataRoot,
    now: () => new Date(Date.UTC(2026, 8, 2, 0, 0, clockTick++))
  });
  let oldProject = await repository.createProject({ name: "即将删除的项目" });
  oldProject = domain.normalizeRelayProject({
    ...oldProject,
    quick: {
      ...oldProject.quick,
      originalPrompt: "OLD_QUICK_SENTINEL",
      totalDurationSeconds: 15,
      segmentDurationSeconds: 5
    }
  });
  oldProject = director.promoteQuickProjectToProfessional({
    project: oldProject,
    updatedAt: "2026-09-02T00:00:10.000Z"
  });
  oldProject = domain.normalizeRelayProject({
    ...oldProject,
    shots: oldProject.shots.map((shot, index) => index === 0
      ? { ...shot, prompt: "OLD_DIRECTOR_SENTINEL" }
      : shot)
  });
  oldProject = await repository.saveProject(oldProject, { expectedUpdatedAt: oldProject.createdAt });
  await repository.archiveProject(oldProject.projectId);

  const freshProject = await repository.createProject({ name: "全新项目" });
  const restartedRepository = repositoryModule.createProjectRepository({ dataRoot });
  const reloaded = await restartedRepository.loadProject(freshProject.projectId);
  assert.equal(reloaded.quick.originalPrompt, "");
  assert.equal(reloaded.professional.directorState, null);
  assert.equal(reloaded.professional.promotedQuickState, null);
  assert.deepEqual(reloaded.shots, []);
  assert.equal(JSON.stringify(reloaded).includes("OLD_QUICK_SENTINEL"), false);
  assert.equal(JSON.stringify(reloaded).includes("OLD_DIRECTOR_SENTINEL"), false);
});

test("project activation clears Director transients and rejects stale async restores", async () => {
  const renderer = await source("src/renderer/index.ts");
  const reset = sliceBetween(renderer, "function resetDirectorSession", "async function activateRelayProject");
  const activate = sliceBetween(renderer, "async function activateRelayProject", "function projectWithQuickForm");
  const restore = sliceBetween(renderer, "function restoreDirectorDraft", "function validateDirectorForCompilation");
  const quickSave = sliceBetween(renderer, "function scheduleQuickProjectSave", "async function flushQuickProjectSave");
  const directorSave = sliceBetween(renderer, "function markDirectorDirty", "function updateDirectorShotStatuses");

  for (const required of [
    "directorShotMemory.clear()",
    "directorShotMetadata.clear()",
    "directorShotIds.clear()",
    "directorP1Ui.resetTransientEditors()",
    "directorPromptPreview.textContent = \"\"",
    "directorPendingCompilation = null"
  ]) assert.ok(reset.includes(required), `Director reset must contain ${required}`);
  assert.match(activate, /const activationEpoch = requestedActivationEpoch \?\? beginProjectTransition\(\)/u);
  assert.match(activate, /activationEpoch !== activeProjectActivationEpoch/u);
  assert.match(activate, /resetDirectorSession\(project\)/u);
  assert.doesNotMatch(restore, /localStorage|DIRECTOR_DRAFT_STORAGE_KEY|legacyStored/u);
  assert.match(quickSave, /const context = captureProjectOperationContext\(\)/u);
  assert.match(quickSave, /if \(!isCurrentProjectOperation\(context\)\) return/u);
  assert.match(quickSave, /error instanceof ProjectOperationSupersededError/u);
  assert.match(directorSave, /const context = activeRelayProject === null \? null : captureProjectOperationContext\(\)/u);
  assert.match(directorSave, /context === null \|\| !isCurrentProjectOperation\(context\)/u);
  assert.match(directorSave, /saveDirectorDraft\(true, true, context\)/u);
});

test("Director compilation captures an immutable Director-owned request and never writes Quick fields", async () => {
  const renderer = await source("src/renderer/index.ts");
  const capture = sliceBetween(renderer, "function captureDirectorCompilation", "async function markDirectorCompiled");
  const validate = sliceBetween(renderer, "function validateDirectorForCompilation", "function setSegmentRecommendation");
  const submitStart = renderer.indexOf('projectForm.addEventListener("submit"');
  const submitEnd = renderer.indexOf("\nvoid (async () => {\n  try {\n    const bootstrap", submitStart);
  assert.ok(submitStart >= 0 && submitEnd > submitStart);
  const submit = renderer.slice(submitStart, submitEnd);
  const directorBranch = sliceBetween(submit, "if (submittedDirectorCompilation !== null)", "} else {");

  assert.match(capture, /const compilationDraft = directorDraftWithContinuityPromptContexts\(submission\.effectiveDraft, authoritativeProject\)/u);
  assert.match(capture, /const promptResult = serializeDirectorPrompt\(compilationDraft\)/u);
  assert.match(capture, /projectId: activeRelayProject\.projectId/u);
  assert.match(capture, /activationEpoch: activeProjectActivationEpoch/u);
  assert.match(capture, /const project: ProjectSpec = Object\.freeze/u);
  assert.doesNotMatch(capture, /projectPrompt|workflowNameInput|flushQuickProjectSave/u);
  assert.doesNotMatch(validate, /projectPrompt|workflowNameInput|setRangeText|flushQuickProjectSave/u);
  assert.match(directorBranch, /project = submittedDirectorCompilation\.project/u);
  assert.doesNotMatch(directorBranch, /projectPrompt|workflowNameInput|flushQuickProjectSave|projectWithQuickForm/u);
  assert.match(submit, /const compilationProjectIsStillActive = \(\): boolean =>[\s\S]*?activeRelayProject\?\.projectId === relayProjectDocument\.projectId[\s\S]*?activeProjectActivationEpoch === compilationActivationEpoch/u);
  assert.match(submit, /projectStillActive[\s\S]*?authorityAdopted[\s\S]*?markDirectorCompiled/u);
});

test("ComfyUI handoff observes a visibly loaded graph without a fixed six-second promise wait", async () => {
  const [handoff, preload] = await Promise.all([
    source("src/main/services/comfy-handoff.ts"),
    source("src/preload/index.ts")
  ]);
  const injectedLoad = sliceBetween(handoff, "const operation = (async () =>", "globalThis.__minimaxH3WorkflowLoadResult = {");
  assert.match(injectedLoad, /graphLoadState = "pending"/u);
  assert.match(injectedLoad, /void Promise\.resolve\(graphLoadResult\)\.then/u);
  assert.match(injectedLoad, /const verification = await settleAndVerify\(\)/u);
  assert.match(injectedLoad, /if \(verification\.matches/u);
  assert.doesNotMatch(injectedLoad, /settleBounded\(graphLoadResult,\s*6000\)|6_000|6000/u);

  const statusLoop = sliceBetween(preload, "async function compileAndOpenWorkflow", "const controlPlaneApi");
  const query = statusLoop.indexOf("queryWorkflowHandoff");
  const delay = statusLoop.indexOf("await delay(HANDOFF_QUERY_INTERVAL_MS)");
  assert.ok(query >= 0 && delay > query, "handoff status must be queried before the first polling delay");
});
