import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");

async function stateEngineModule() {
  const result = await build({
    entryPoints: [resolve(root, "src/renderer/project-state-engine.ts")],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    target: "node22"
  });
  const source = result.outputFiles[0]?.text;
  assert.ok(source);
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

test("command stack is immutable, undoable, redoable, and truncates stale redo", async () => {
  const {
    applyProjectStateCommand,
    canRedoProjectState,
    canUndoProjectState,
    createProjectStateSession,
    redoProjectState,
    undoProjectState
  } = await stateEngineModule();
  const initial = { projectId: "project-alpha28", value: 1, nested: { label: "原始" } };
  let session = createProjectStateSession(initial, { autosaveDelayMs: 500, maximumUndoDepth: 10 });
  initial.nested.label = "调用者篡改";
  assert.equal(session.current.nested.label, "原始");
  assert.equal(Object.isFrozen(session.current), true);

  session = applyProjectStateCommand(session, {
    label: "修改值",
    nextProject: { ...session.current, value: 2 },
    createdAtMs: 100
  });
  session = applyProjectStateCommand(session, {
    label: "再次修改",
    nextProject: { ...session.current, value: 3 },
    createdAtMs: 200
  });
  assert.equal(session.current.value, 3);
  assert.equal(canUndoProjectState(session), true);
  session = undoProjectState(session, 300);
  assert.equal(session.current.value, 2);
  assert.equal(canRedoProjectState(session), true);
  session = redoProjectState(session, 400);
  assert.equal(session.current.value, 3);
  session = undoProjectState(session, 500);
  session = applyProjectStateCommand(session, {
    label: "新分支",
    nextProject: { ...session.current, value: 9 },
    createdAtMs: 600
  });
  assert.equal(session.current.value, 9);
  assert.equal(canRedoProjectState(session), false);
  assert.equal(session.commands.length, 2);
});

test("autosave is throttled and exposes an atomic repository request, never fake success", async () => {
  const {
    applyProjectStateCommand,
    claimProjectAutosave,
    completeProjectAutosave,
    createProjectStateSession,
    isProjectSessionDirty
  } = await stateEngineModule();
  let session = createProjectStateSession({ projectId: "project-alpha28", value: 1 }, { autosaveDelayMs: 500 });
  session = applyProjectStateCommand(session, {
    label: "编辑",
    nextProject: { ...session.current, value: 2 },
    createdAtMs: 1_000
  });
  assert.equal(session.autosave.phase, "scheduled");
  assert.equal(session.autosave.dueAtMs, 1_500);
  let request;
  [session, request] = claimProjectAutosave(session, 1_499);
  assert.equal(request, null);
  [session, request] = claimProjectAutosave(session, 1_500);
  assert.ok(request);
  assert.equal(request.strategy, "write_temp_flush_replace");
  assert.equal(request.targetRelativePath, "project.relay.json");
  assert.match(request.temporaryRelativePath, /^project\.relay\.json\.autosave-[a-f0-9]{24}\.tmp$/u);
  assert.equal(JSON.parse(request.payload).value, 2);
  assert.equal(session.autosave.phase, "saving");
  assert.equal(isProjectSessionDirty(session), true, "claiming is not persistence success");

  session = completeProjectAutosave(session, {
    request,
    succeeded: false,
    completedAt: "2026-08-30T10:00:00.000Z",
    error: "磁盘已满"
  });
  assert.equal(session.autosave.phase, "failed");
  assert.equal(session.autosave.lastError, "磁盘已满");
  assert.equal(isProjectSessionDirty(session), true);

  // A later claimed write may complete after another edit. The old snapshot is
  // recorded as persisted but the current work remains scheduled and dirty.
  session = { ...session, autosave: { ...session.autosave, phase: "scheduled", dueAtMs: 2_000 } };
  [session, request] = claimProjectAutosave(session, 2_000);
  assert.ok(request);
  session = applyProjectStateCommand(session, {
    label: "写入期间继续编辑",
    nextProject: { ...session.current, value: 3 },
    createdAtMs: 2_010
  });
  // Simulate repository completion against the request that was actually written.
  session = { ...session, autosave: { ...session.autosave, phase: "saving", activeRequestId: request.requestId } };
  session = completeProjectAutosave(session, {
    request,
    succeeded: true,
    completedAt: "2026-08-30T10:00:01.000Z"
  });
  assert.equal(session.current.value, 3);
  assert.equal(session.autosave.phase, "scheduled");
  assert.equal(isProjectSessionDirty(session), true);
});

test("history restore creates a new branch head and leaves source checkpoints immutable", async () => {
  const {
    applyProjectStateCommand,
    createProjectHistoryCheckpoint,
    createProjectStateSession,
    restoreProjectHistoryCheckpoint
  } = await stateEngineModule();
  let session = createProjectStateSession({ projectId: "project-alpha28", value: "A" });
  session = createProjectHistoryCheckpoint(session, {
    reason: "manual",
    label: "版本 A",
    createdAt: "2026-08-30T00:00:00.000Z"
  });
  const source = session.history[0];
  session = applyProjectStateCommand(session, {
    label: "改成 B",
    nextProject: { ...session.current, value: "B" },
    createdAtMs: 1
  });
  session = createProjectHistoryCheckpoint(session, {
    reason: "compile_handoff",
    label: "版本 B",
    createdAt: "2026-08-30T00:00:01.000Z"
  });
  session = restoreProjectHistoryCheckpoint(session, {
    checkpointId: source.id,
    createdAt: "2026-08-30T00:00:02.000Z",
    createdAtMs: 2
  });
  assert.equal(session.current.value, "A");
  assert.equal(session.history.length, 3);
  assert.equal(session.history[0], source);
  assert.equal(session.history[2].reason, "restore");
  assert.equal(session.history[2].parentCheckpointId, source.id);
  assert.notEqual(session.history[2].id, source.id);
});

test("state engine has no filesystem, generation, queue, or creative-director surface", async () => {
  const source = await readFile(resolve(root, "src/renderer/project-state-engine.ts"), "utf8");
  assert.doesNotMatch(source, /node:fs|readFile|writeFile|fetch\s*\(|XMLHttpRequest|WebSocket|\/prompt|queuePrompt|submitPrompt/u);
  assert.doesNotMatch(source, /generate(?:Video|Audio)|translatePrompt|expandPrompt|writeStory/u);
  assert.match(source, /write_temp_flush_replace/u);
});

