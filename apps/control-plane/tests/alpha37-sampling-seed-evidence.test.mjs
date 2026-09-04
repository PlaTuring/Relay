import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const read = (relativePath) => readFile(resolve(root, relativePath), "utf8");

test("quick create and professional director expose exactly the three certified sampling tiers", async () => {
  const [html, contract, serviceValidation, ipcRegistry] = await Promise.all([
    read("src/renderer/index.html"),
    read("src/shared/ipc-contract.ts"),
    read("src/main/services/validation.ts"),
    read("src/main/ipc-registry.ts")
  ]);

  for (const selectId of ["sampling-profile", "director-sampling"]) {
    const select = html.match(new RegExp(`<select id="${selectId}"[\\s\\S]*?</select>`, "u"))?.[0] ?? "";
    assert.match(select, /value="quality_20"[^>]*>20 步标准</u);
    assert.match(select, /value="quality_25"[^>]*>25 步高质量</u);
    assert.match(select, /value="turbo_8"[^>]*>8 步 Turbo</u);
    assert.equal((select.match(/<option /gu) ?? []).length, 3);
  }

  assert.match(contract, /export type SamplingProfile = "quality_20" \| "quality_25" \| "turbo_8";/u);
  assert.match(contract, /highQualitySteps: 25/u);
  for (const source of [serviceValidation, ipcRegistry]) {
    assert.match(source, /samplingProfile !== "quality_25"/u);
    assert.match(source, /samplingProfile === "turbo_8"/u);
  }
});

test("compile result dialog renders the exact persisted base seed and every shot seed", async () => {
  const [html, renderer, contract] = await Promise.all([
    read("src/renderer/index.html"),
    read("src/renderer/index.ts"),
    read("src/shared/ipc-contract.ts")
  ]);

  for (const id of [
    "feedback-seed-evidence",
    "feedback-seed-policy",
    "feedback-base-seed",
    "feedback-shot-seeds"
  ]) assert.match(html, new RegExp(`id="${id}"`, "u"));

  assert.match(contract, /readonly seedResolution: RelayResolvedSeedPlan;/u);
  assert.match(renderer, /seedResolution: result\.seedResolution/u);
  assert.match(renderer, /feedbackBaseSeed\.textContent = String\(plan\.baseSeed\)/u);
  assert.match(renderer, /for \(const shot of plan\.shots\)/u);
  assert.match(renderer, /value\.textContent = String\(shot\.seed\)/u);
  assert.match(renderer, /feedbackSeedEvidence\.hidden = false/u);
  assert.match(renderer, /feedbackSeedEvidence\.hidden = true/u);
});

test("required ComfyUI capability is excluded from the renderer optional-component request", async () => {
  const renderer = await read("src/renderer/index.ts");
  assert.match(
    renderer,
    /function selectedOptionalComponents\(\): ComponentId\[\][\s\S]{0,260}input\.dataset\.locked !== "true"/u
  );
});
