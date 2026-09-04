import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const renderer = await readFile(resolve(root, "src/renderer/index.ts"), "utf8");

function sliceBetween(startMarker, endMarker) {
  const start = renderer.indexOf(startMarker);
  const end = renderer.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing start marker: ${startMarker}`);
  assert.ok(end > start, `missing end marker after ${startMarker}: ${endMarker}`);
  return renderer.slice(start, end);
}

test("director shot technical state does not invalidate preserved shots when only total duration changes", () => {
  const technicalSnapshot = sliceBetween(
    "function currentDirectorTechnicalSnapshot",
    "function currentDirectorCompilationSnapshot"
  );
  const capture = sliceBetween("function captureDirectorCompilation", "function markDirectorCompiled");

  assert.doesNotMatch(technicalSnapshot, /totalDurationSeconds|directorTotalDuration/u);
  assert.match(technicalSnapshot, /segmentDurationSeconds/u);
  assert.match(capture, /directorCompilationSnapshot\s*\(\s*\{[\s\S]*?draft:\s*submission\.effectiveDraft/u);
});

test("v6 restore gives current-mode draft identities priority over archived production data", () => {
  const apply = sliceBetween(
    "function applyDirectorDraftToWorkCopy",
    "function restoreDirectorProductionRevisionToWorkCopy"
  );
  const currentDraftIds = apply.indexOf("for (const shot of draft.shots)");
  const persistedIds = apply.indexOf("Array.isArray(persisted?.shotIds)");

  assert.ok(currentDraftIds >= 0 && persistedIds > currentDraftIds);
  assert.doesNotMatch(apply, /state\.scenes/u);
  assert.match(apply, /restoreDirectorShotId\(key,\s*shot\.id,\s*usedShotIds\)/u);
});

test("legacy director memory, metadata, and IDs share the normalized identity key", () => {
  const restore = sliceBetween("function restoreDirectorDraft", "function validateDirectorForCompilation");

  assert.match(restore, /const normalizedKey = normalizedDirectorStoredKey\(candidate\.key\)/u);
  assert.match(restore, /directorShotMemory\.set\(normalizedKey,\s*candidate\.description\)/u);
  assert.match(restore, /directorShotMetadata\.set\(normalizedKey,/u);
  assert.match(restore, /restoreDirectorShotId\(normalizedKey,\s*candidate\.id,\s*usedShotIds\)/u);
  assert.doesNotMatch(restore, /directorShotMemory\.set\(candidate\.key|directorShotMetadata\.set\(candidate\.key/u);
});

test("only the latest director request owns the current compiled marker and the button remains locked", () => {
  const capture = sliceBetween("function captureDirectorCompilation", "function markDirectorCompiled");
  const mark = sliceBetween("function markDirectorCompiled", "function optionValueExists");
  const click = sliceBetween(
    'directorCompileButton.addEventListener("click"',
    "renderDirectorShots();"
  );
  const submit = sliceBetween(
    'projectForm.addEventListener("submit"',
    "void (async () => {\n  try {\n    const bootstrap"
  );

  assert.match(capture, /const sequence = \+\+directorCompilationSequence/u);
  assert.match(capture, /directorLatestSubmittedSequence = sequence/u);
  assert.match(mark, /pending\.sequence === directorLatestSubmittedSequence/u);
  assert.match(mark, /if \(ownsCurrentMarker\)[\s\S]*?directorLastCompiledSnapshot\s*=\s*pending\.compilationSnapshot/u);
  assert.match(click, /directorCompileDispatchPending \|\| directorCompileInFlightCount > 0/u);
  assert.match(click, /directorCompileDispatchPending = true[\s\S]*?syncDirectorCompileButtonState\(\)/u);
  assert.match(submit, /directorCompileInFlightCount \+= 1/u);
  assert.match(submit, /directorCompileInFlightCount = Math\.max\(0,\s*directorCompileInFlightCount - 1\)/u);
});

test("revision restore clears current compile proof and preview reuses one production view", () => {
  const restoreRevision = sliceBetween(
    "function restoreDirectorProductionRevisionToWorkCopy",
    "function restoreDirectorDraft"
  );
  const preview = sliceBetween("function updateDirectorPreview", "function syncDirectorFrames");

  assert.match(restoreRevision, /directorLastCompiledShotFingerprints\s*=\s*Object\.freeze\(\{\}\)/u);
  assert.match(restoreRevision, /directorLastCompiledTechnicalSnapshot\s*=\s*""/u);
  assert.match(restoreRevision, /directorLastCompiledSnapshot\s*=\s*""/u);
  assert.match(preview, /const production = currentDirectorProductionView\(\)/u);
  assert.match(preview, /directorValidationErrors\(production\)/u);
  assert.match(preview, /updateDirectorShotStatuses\(production\)/u);
  assert.equal((preview.match(/currentDirectorProductionView\(\)/gu) ?? []).length, 1);
});

test("fresh renderer bootstrap falls back to the quick plan when production has no active shots", () => {
  const syncMode = sliceBetween("function syncDirectorMode", "function syncDirectorRefAvailability");

  assert.match(syncMode, /const productionTimeline = preserveProductionTimeline/u);
  assert.match(syncMode, /productionTimeline\.length > 0/u);
  assert.match(syncMode, /\? productionTimeline\s*:\s*undefined/u);
  assert.match(syncMode, /renderDirectorShots\([\s\S]*?updateDirectorPreview\(\)/u);
});
