import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";
import { compileProject } from "../../../packages/workflow/h3-compiler/src/compiler.mjs";

const root = path.resolve(import.meta.dirname, "..");

async function loadModule(context, entry) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "relay-alpha30-seed-build-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const outfile = path.join(directory, "module.mjs");
  await build({
    entryPoints: [path.join(root, entry)],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "silent",
  });
  return import(`${new URL(`file:///${outfile.replaceAll("\\", "/")}`).href}?${Date.now()}-${Math.random()}`);
}

function entropy(value) {
  const bytes = new Uint8Array(8);
  bytes[7] = value;
  return bytes;
}

test("random compile plans differ, fixed plans repeat, and fixed mode never requests entropy", async (context) => {
  const seed = await loadModule(context, "src/shared/seed-policy.ts");
  const first = seed.resolveRelaySeedPlan({
    policy: "random_per_compile",
    fixedSeed: 1,
    shotIds: [null],
    entropy: () => entropy(9),
  });
  const second = seed.resolveRelaySeedPlan({
    policy: "random_per_compile",
    fixedSeed: 1,
    shotIds: [null],
    entropy: () => entropy(9),
    previousRandomBaseSeed: first.baseSeed,
  });
  assert.equal(first.baseSeed, 9);
  assert.equal(second.baseSeed, 10, "adjacent random compile transactions cannot resolve equally");
  let entropyCalls = 0;
  const fixedInput = {
    policy: "fixed",
    fixedSeed: 314159,
    shotIds: ["shot-fixed0001", "shot-fixed0002"],
    entropy: () => { entropyCalls += 1; return entropy(1); },
  };
  const fixedFirst = seed.resolveRelaySeedPlan(fixedInput);
  const fixedSecond = seed.resolveRelaySeedPlan(fixedInput);
  assert.equal(entropyCalls, 0);
  assert.deepEqual(fixedFirst, fixedSecond);
  assert.equal(fixedFirst.nodeControlAfterGenerate, "fixed");
});

test("autosave serializes but never resolves or changes project seed state", async (context) => {
  const [domain, engine] = await Promise.all([
    loadModule(context, "src/shared/project-domain.ts"),
    loadModule(context, "src/renderer/project-state-engine.ts"),
  ]);
  const empty = domain.createEmptyRelayProject({
    projectId: "project-seed0001",
    name: "种子自动保存",
    createdAt: "2026-08-30T00:00:00.000Z",
  });
  const fixed = domain.normalizeRelayProject({
    ...empty,
    quick: { ...empty.quick, seed: "8888", seedPolicy: "fixed" },
  });
  let session = engine.createProjectStateSession(fixed, { autosaveDelayMs: 1 });
  session = engine.applyProjectStateCommand(session, {
    label: "只改项目名",
    nextProject: { ...fixed, name: "种子自动保存 2" },
    createdAtMs: 10,
  });
  const [saving, request] = engine.claimProjectAutosave(session, 11);
  assert.ok(request);
  const serialized = JSON.parse(request.payload);
  assert.equal(serialized.quick.seed, "8888");
  assert.equal(serialized.quick.seedPolicy, "fixed");
  const saved = engine.completeProjectAutosave(saving, {
    request,
    succeeded: true,
    completedAt: "2026-08-30T00:00:01.000Z",
  });
  assert.equal(saved.current.quick.seed, "8888");
  assert.equal(saved.current.quick.seedPolicy, "fixed");
});

test("quick promotion and Director migrations preserve one shared seed policy", async (context) => {
  const [domain, professional, production, controller] = await Promise.all([
    loadModule(context, "src/shared/project-domain.ts"),
    loadModule(context, "src/renderer/professional-director.ts"),
    loadModule(context, "src/renderer/director-production.ts"),
    loadModule(context, "src/renderer/director-p1-controller.ts"),
  ]);
  const empty = domain.createEmptyRelayProject({
    projectId: "project-seed0002",
    name: "迁移与互转",
    createdAt: "2026-08-30T00:00:00.000Z",
  });
  assert.equal(empty.quick.seedPolicy, "random_per_compile");
  const legacyRandom = domain.normalizeRelayProject({
    ...empty,
    quick: { ...empty.quick, seed: "77", seedPolicy: "randomize" },
  });
  assert.equal(legacyRandom.quick.seedPolicy, "random_per_compile");
  const fixed = domain.normalizeRelayProject({
    ...empty,
    quick: { ...empty.quick, seed: "42", seedPolicy: "fixed", totalDurationSeconds: 10 },
  });
  const promoted = professional.promoteQuickProjectToProfessional({
    project: fixed,
    updatedAt: "2026-08-30T00:00:01.000Z",
  });
  assert.equal(promoted.quick.seedPolicy, "fixed");
  assert.equal(promoted.professional.promotedQuickState.seedPolicy, "fixed");
  assert.equal(promoted.professional.promotedQuickState.seed, "42");

  const migratedV5 = production.migrateDirectorV5Draft({
    version: 5,
    workflowName: "旧导播",
    seed: "90210",
    seedPolicy: "fixed",
    draft: {
      language: "zh",
      mode: "T2V",
      totalDurationSeconds: 5,
      segmentDurationSeconds: 5,
      shots: [{ startSeconds: 0, durationSeconds: 5, description: "原文" }],
    },
  });
  assert.equal(migratedV5.state.project.directorSettings.seedPolicy, "fixed");
  const synchronized = controller.syncDirectorProductionState({
    state: migratedV5.state,
    workflowName: "旧导播",
    draft: {
      language: "zh",
      mode: "T2V",
      totalDurationSeconds: 5,
      segmentDurationSeconds: 5,
      characterBible: "",
      worldBible: "",
      visualStyleBible: "",
      continuity: "",
      shots: [{ startSeconds: 0, durationSeconds: 5, description: "原文" }],
      overallSoundscape: "",
      nonDiegeticMusic: "",
      subjectDefinitions: "",
      summary: "",
      retentionAnalysis: "",
      styleOpening: "",
    },
  });
  assert.equal(synchronized.state.project.directorSettings.seedPolicy, "fixed");
});

test("authoritative workflow and immutable project history persist exact base and shot seeds", async (context) => {
  const [repositoryModule, storeModule, dataModule] = await Promise.all([
    loadModule(context, "src/main/services/project-repository.ts"),
    loadModule(context, "src/main/services/project-workflow-store.ts"),
    loadModule(context, "src/main/services/data-root.ts"),
  ]);
  const temporary = await mkdtemp(path.join(os.tmpdir(), "relay-alpha30-seed-history-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const dataRoot = path.join(temporary, "Relay data");
  const comfyRoot = path.join(temporary, "ComfyUI");
  const comfyWorkflows = path.join(comfyRoot, "ComfyUI", "user", "default", "workflows");
  await mkdir(comfyWorkflows, { recursive: true });
  let clockValue = 0;
  const now = () => new Date(Date.UTC(2026, 7, 30, 3, 0, clockValue++));
  let idValue = 1;
  const createId = () => (idValue++).toString(16).padStart(32, "0");
  const repository = repositoryModule.createProjectRepository({ dataRoot, now, createId });
  let project = await repository.createProject({ name: "可复现历史" });
  project = await repository.saveProject({
    ...project,
    externalReferences: [{
      referenceId: "reference-comfyseed",
      kind: "comfyui_root",
      displayName: "本机 ComfyUI",
      locatorId: "installation.comfy.seed",
      expectedSha256: null,
      attachOnly: true,
    }],
  }, { expectedUpdatedAt: project.updatedAt });
  const shotIds = ["shot-history001", "shot-history002", "shot-history003"];
  const compilation = await compileProject({
    schema_version: "1.0.0",
    prompt: "integrated_multimodal_description: [Shot 1] Opening.\n[Shot 2] At 00:05.000, continuation.\n[Shot 3] At 00:10.000, ending.\n\noverall_soundscape: Room tone.\n\nnon_diegetic_music: N/A",
    mode: "t2v",
    duration: 15,
    segment_duration: 5,
    shot_ids: shotIds,
    canvas: "16:9",
    resolution_megapixels: 0.98,
    advanced: { seed: 7654321, seed_policy: "fixed", sampling_profile: "quality_20" },
  });
  const workflow = compilation.workflows[0].workflow;
  const seedResolution = {
    contractId: "relay.seed-plan",
    schemaVersion: 1,
    policy: compilation.seed_plan.policy,
    baseSeed: compilation.seed_plan.base_seed,
    nodeControlAfterGenerate: "fixed",
    shots: compilation.seed_plan.shots.map((shot) => ({
      shotId: shot.shot_id,
      ordinal: shot.ordinal,
      seed: shot.seed,
    })),
  };
  const store = storeModule.createProjectWorkflowStore({ dataRoot, repository, now, createId });
  const authority = await store.storeAuthoritativeWorkflow({
    projectId: project.projectId,
    displayName: "固定种子工作流",
    workflow,
    seedResolution,
  });
  await store.handoffAuthoritativeWorkflow({
    projectId: project.projectId,
    workflowId: authority.workflowId,
    targetComfyReferenceId: "reference-comfyseed",
    targetComfyRoot: comfyRoot,
    targetWorkflowDirectory: comfyWorkflows,
  });
  const saved = await repository.loadProject(project.projectId);
  assert.deepEqual(saved.workflows[0].seedResolution, seedResolution);
  assert.deepEqual(saved.history[0].seedResolution, seedResolution);
  const layout = dataModule.resolveProjectDirectoryLayout(dataRoot, project.projectId);
  const workflowDocument = JSON.parse(await readFile(path.join(layout.root, saved.workflows[0].projectRelativePath), "utf8"));
  assert.equal(workflowDocument.extra.relay_seed.base_seed, 7654321);
  assert.deepEqual(workflowDocument.extra.relay_seed.shots.map((shot) => shot.seed), seedResolution.shots.map((shot) => shot.seed));
  const checkpoint = JSON.parse(await readFile(path.join(layout.root, saved.history[0].projectRelativePath), "utf8"));
  assert.deepEqual(checkpoint.workflows[0].seedResolution, seedResolution);
});
