import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const projectRoot = resolve(import.meta.dirname, "..");
const read = (relativePath) => readFile(resolve(projectRoot, relativePath), "utf8");

test("Ref2VA stays in the shared project-mode contract and is installation-gated, not hidden", async () => {
  const contract = await read("src/shared/ipc-contract.ts");
  const ref2va = contract.match(/REF2VA: Object\.freeze\(\{[\s\S]*?\n  \}\)\n\} as const\);/u)?.[0] ?? "";
  assert.ok(ref2va.length > 0, "missing fixed REF2VA capability");
  for (const fragment of [
    'visibility: "always"',
    'requiredComponentId: "ref2va_optional"',
    'availabilityGate: "installation_state"',
    'missingComponentBehavior: "visible_install_required"',
    'compilerMode: "ref2va"',
    'kind: "reference_images"',
    "minimumImages: 1",
    "maximumImages: 2",
    'semantics: "reference_conditioning_not_endpoints"',
    'samplingProfiles: Object.freeze(["quality_20", "quality_25"] as const)',
  ]) assert.ok(ref2va.includes(fragment), `missing Ref2VA contract fragment: ${fragment}`);
  assert.match(contract, /export type ProjectMode = keyof typeof MINIMAX_H3_PROJECT_MODE_CAPABILITIES;/u);
});

test("both closed main-process validation layers accept REF2VA and require a reference image", async () => {
  const [serviceValidation, ipcRegistry] = await Promise.all([
    read("src/main/services/validation.ts"),
    read("src/main/ipc-registry.ts"),
  ]);
  for (const source of [serviceValidation, ipcRegistry]) {
    assert.match(source, /\["T2V", "FL2VA", "REF2VA"\]/u);
    assert.match(source, /project\.mode === "REF2VA"[\s\S]{0,240}firstFrameSelectionId === null[\s\S]{0,160}lastFrameSelectionId === null/u);
    assert.match(source, /project\.mode === "REF2VA"[\s\S]{0,160}samplingProfile === "turbo_8"/u);
  }
});

test("long Ref2VA stays visibly fail-closed while T2V and FL2VA retain long plans", async () => {
  const [renderer, adapter] = await Promise.all([
    read("src/renderer/index.ts"),
    read("src/main/services/ab-cli-adapter.ts"),
  ]);
  assert.ok(renderer.includes("referenceMode && Number(option.value) > 15"));
  assert.ok(renderer.includes('projectDuration.value = "15"'));
  assert.ok(renderer.includes("referenceMode && Number(option.value) !== selectedDuration()"));
  assert.ok(renderer.includes("segmentDuration.value = String(selectedDuration())"));
  assert.ok(adapter.includes("request.project.durationSeconds > 15"));
  assert.ok(adapter.includes("refDurations.length !== 1 || refDurations[0] !== request.project.durationSeconds"));
});

test("Ref2VA is gated by the completed component set and maps references to the R2V compiler", async () => {
  const [services, adapter, staging] = await Promise.all([
    read("src/main/services/index.ts"),
    read("src/main/services/ab-cli-adapter.ts"),
    read("src/main/services/frame-staging.ts"),
  ]);
  assert.ok(services.includes('completedInstallationComponents.has("ref2va_optional")'));
  assert.ok(adapter.includes('request.project.mode === "REF2VA"'));
  assert.ok(adapter.includes('context.publicComponents.includes("ref2va_optional")'));
  assert.ok(adapter.includes("request.project.durationSeconds > 15"));
  assert.ok(adapter.includes("30/60 秒长链尚未通过官方连续性兼容验证"));
  assert.ok(adapter.includes('? "ref2va"'));
  assert.ok(adapter.includes("reference_images: Object.freeze("));
  assert.match(
    adapter,
    /request\.project\.mode === "REF2VA"[\s\S]{0,180}\? Object\.freeze\(\{[\s\S]{0,80}reference_images:/u
  );
  assert.ok(staging.includes('options.mode === "REF2VA"'));
});
