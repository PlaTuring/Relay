import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const read = (relative) => readFile(resolve(root, relative), "utf8");

test("canvas aspect and resolution megapixels remain independent across both validation layers", async () => {
  const [contract, serviceValidation, ipcValidation, adapter] = await Promise.all([
    read("src/shared/ipc-contract.ts"),
    read("src/main/services/validation.ts"),
    read("src/main/ipc-registry.ts"),
    read("src/main/services/ab-cli-adapter.ts")
  ]);

  assert.ok(contract.includes('readonly canvas: CanvasPreset'));
  assert.ok(contract.includes('readonly resolutionMegapixels: number'));
  for (const aspect of ["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"]) {
    assert.ok(contract.includes(`| "${aspect}"`) || contract.includes(`=\n  | "${aspect}"`));
  }
  assert.doesNotMatch(contract, /"(?:1344x576|1344x768|1152x768|1024x768|768x768|768x1024|768x1152|768x1344)"/u);

  for (const validator of [serviceValidation, ipcValidation]) {
    assert.ok(validator.includes('"resolutionMegapixels"'));
    assert.ok(validator.includes("Number.isFinite"));
    assert.ok(validator.includes("< 0.1"));
    assert.ok(validator.includes("> 16"));
  }
  assert.ok(adapter.includes("resolution_megapixels: request.project.resolutionMegapixels"));
});
