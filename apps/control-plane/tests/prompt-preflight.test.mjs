import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const projectRoot = path.resolve(import.meta.dirname, "..");

async function loadModule(context) {
  const buildRoot = await mkdtemp(path.join(os.tmpdir(), "h3-prompt-preflight-"));
  context.after(() => rm(buildRoot, { recursive: true, force: true }));
  const outfile = path.join(buildRoot, "prompt-preflight.mjs");
  await build({
    entryPoints: [path.join(projectRoot, "src", "main", "services", "workflow-text-preflight.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "silent"
  });
  return import(`${new URL(`file:///${outfile.replaceAll("\\", "/")}`).href}?fixture=${Date.now()}`);
}

function project(prompt, overrides = {}) {
  return {
    prompt,
    mode: "T2V",
    firstFrameSelectionId: null,
    lastFrameSelectionId: null,
    durationSeconds: 30,
    segmentDurationSeconds: 5,
    canvas: "16:9",
    resolutionMegapixels: 0.4,
    advanced: { seed: 1, seedPolicy: "fixed", samplingProfile: "quality_20" },
    ...overrides
  };
}

const baseEnglish = `integrated_multimodal_description: [Shot 1] Opening. [Shot 2] At 00:05.000, continuation. [Shot 3] At 00:10.000, continuation. [Shot 4] At 00:15.000, continuation. [Shot 5] At 00:20.000, continuation. [Shot 6] At 00:25.000, conclusion.

overall_soundscape: Rain remains audible.

non_diegetic_music: Sparse piano.`;

const baseChineseAliases = `综合多模态描述：[镜头 1] 开场。[镜头 2] 在 00:05.000，画面切换。[镜头 3] 在 00:10.000，继续动作。[镜头 4] 在 00:15.000，继续动作。[镜头 5] 在 00:20.000，继续动作。[镜头 6] 在 00:25.000，结束画面。

整体声景：雨声持续。

画外配乐：稀疏的钢琴。`;

const ref2vaEnglish = `subject_definitions: <Subject 1> comes from <Picture 1>.

summary: [reference generation] Keep the referenced subject consistent.

retention_analysis: <Subject 1>: fully_preserved - Preserve identity and clothing.

detailed_description: The target video uses a live-action cinematic style. [Shot 1] Opening. [Shot 2] At 00:05.000, continuation. [Shot 3] At 00:10.000, continuation. [Shot 4] At 00:15.000, continuation. [Shot 5] At 00:20.000, continuation. [Shot 6] At 00:25.000, conclusion.

overall_soundscape: Rain remains audible.

non_diegetic_music: N/A`;

const ref2vaChineseAliases = `主体定义：<Subject 1> 来自 <Picture 1>。

摘要：[reference generation] 保持参考主体一致。

保留分析：<Subject 1>: fully_preserved - 保留身份和服装。

详细描述：The target video uses a live-action cinematic style. [镜头 1] 开场。[镜头 2] 在 00:05.000，继续动作。[镜头 3] 在 00:10.000，继续动作。[镜头 4] 在 00:15.000，继续动作。[镜头 5] 在 00:20.000，继续动作。[镜头 6] 在 00:25.000，结束画面。

整体声景：雨声持续。

非叙事音乐：无。`;

function clearSection(prompt, header, followingHeader) {
  const pattern = new RegExp(`(${header}:)[\\s\\S]*?(?=\\r?\\n\\r?\\n${followingHeader}:)`, "u");
  return prompt.replace(pattern, "$1");
}

function captureError(action) {
  try {
    action();
  } catch (error) {
    return error;
  }
  assert.fail("expected preflight error");
}

test("single-segment prompts bypass structural preflight without mutation", async (context) => {
  const { assertMultiSegmentPromptPreflight } = await loadModule(context);
  const input = project("普通中文提示词", { durationSeconds: 5, segmentDurationSeconds: 5 });
  assert.doesNotThrow(() => assertMultiSegmentPromptPreflight(input));
  assert.equal(input.prompt, "普通中文提示词");
});

test("a structured 15-second prompt reports a selected 5-second duration mismatch clearly", async (context) => {
  const { assertMultiSegmentPromptPreflight } = await loadModule(context);
  const prompt = `integrated_multimodal_description: [Shot 1] Opening in a rainy alley.

[Shot 2] At 00:05.000, the subject stops beneath the neon signs.

[Shot 3] At 00:10.000, the camera pulls back while the glow fades at 00:15.000.

overall_soundscape: Rain and distant traffic.

non_diegetic_music: Synth pulses fade at 00:15.000.`;
  const error = captureError(() => assertMultiSegmentPromptPreflight(project(prompt, {
    durationSeconds: 5,
    segmentDurationSeconds: 5
  })));
  assert.equal(error.code, "INVALID_REQUEST");
  assert.match(error.message, /当前选择的总时长是 5 秒/u);
  assert.match(error.message, /镜头 2 从 00:05\.000 开始/u);

  assert.doesNotThrow(() => assertMultiSegmentPromptPreflight(project(prompt, {
    durationSeconds: 15,
    segmentDurationSeconds: 5
  })));
});

test("base preflight accepts official English fields, Chinese aliases, and FL2VA preamble", async (context) => {
  const { assertMultiSegmentPromptPreflight } = await loadModule(context);
  assert.doesNotThrow(() => assertMultiSegmentPromptPreflight(project(baseEnglish)));
  assert.doesNotThrow(() => assertMultiSegmentPromptPreflight(project(baseChineseAliases, { mode: "FL2VA" })));
  const withPreamble = `How the reference pictures align with the target video — Picture 1 aligns with 0.00 seconds.\n\n${baseEnglish}`;
  assert.doesNotThrow(() => assertMultiSegmentPromptPreflight(project(withPreamble, { mode: "FL2VA" })));
});

test("preflight accepts multi-segment base, FL2VA, and Ref2VA prompts with empty official audio fields", async (context) => {
  const { assertMultiSegmentPromptPreflight } = await loadModule(context);
  const baseEmpty = baseEnglish
    .replace("overall_soundscape: Rain remains audible.", "overall_soundscape:")
    .replace("non_diegetic_music: Sparse piano.", "non_diegetic_music:");
  const ref2vaEmpty = ref2vaEnglish
    .replace("overall_soundscape: Rain remains audible.", "overall_soundscape:")
    .replace("non_diegetic_music: N/A", "non_diegetic_music:");
  const cases = [
    project(baseEmpty),
    project(`How the reference pictures align with the target video.\n\n${baseEmpty}`, { mode: "FL2VA" }),
    project(ref2vaEmpty, { mode: "REF2VA" }),
  ];
  for (const input of cases) {
    const before = input.prompt;
    assert.doesNotThrow(() => assertMultiSegmentPromptPreflight(input));
    assert.equal(input.prompt, before);
    assert.doesNotMatch(input.prompt, /N\/A|无|静音/u);
  }
});

test("preflight still rejects empty non-audio base, FL2VA, and Ref2VA fields", async (context) => {
  const { assertMultiSegmentPromptPreflight } = await loadModule(context);
  const emptyBaseDescription = clearSection(
    baseEnglish,
    "integrated_multimodal_description",
    "overall_soundscape",
  );
  const invalidCases = [
    project(emptyBaseDescription),
    project(`How the reference pictures align with the target video.\n\n${emptyBaseDescription}`, { mode: "FL2VA" }),
    ...[
      ["subject_definitions", "summary"],
      ["summary", "retention_analysis"],
      ["retention_analysis", "detailed_description"],
      ["detailed_description", "overall_soundscape"],
    ].map(([header, nextHeader]) => project(
      clearSection(ref2vaEnglish, header, nextHeader),
      { mode: "REF2VA" },
    )),
  ];
  for (const input of invalidCases) {
    const error = captureError(() => assertMultiSegmentPromptPreflight(input));
    assert.equal(error.code, "INVALID_REQUEST");
    assert.match(error.message, /官方(?:基础三|六)字段结构/u);
  }
});

test("preflight accepts BOM, NFKC controls, and one-to-three or omitted millisecond digits", async (context) => {
  const { assertMultiSegmentPromptPreflight } = await loadModule(context);
  const compatibility = `\uFEFF${baseEnglish}`
    .replace("[Shot 2] At 00:05.000", "［Shot ②］ Ａｔ ００：０５．０")
    .replace("[Shot 3] At 00:10.000", "[Shot ③] At 00:10")
    .replace("[Shot 4] At 00:15.000", "[Shot ④] At 00:15.00")
    .replace("[Shot 5] At 00:20.000", "[Shot ⑤] At 00:20.000")
    .replace("[Shot 6] At 00:25.000", "[Shot ⑥] At 00:25");
  assert.doesNotThrow(() => assertMultiSegmentPromptPreflight(project(compatibility)));
});

test("base preflight rejects unstructured, missing-field, and marker-free multi-segment prompts", async (context) => {
  const { assertMultiSegmentPromptPreflight } = await loadModule(context);
  for (const prompt of [
    "普通中文提示词",
    "integrated_multimodal_description: [Shot 1] Opening.\n\noverall_soundscape: Rain.",
    "integrated_multimodal_description: Opening.\n\noverall_soundscape: Rain.\n\nnon_diegetic_music: N/A"
  ]) {
    const error = captureError(() => assertMultiSegmentPromptPreflight(project(prompt)));
    assert.equal(error.code, "INVALID_REQUEST");
    assert.match(error.message, /官方基础三字段结构/u);
    assert.match(error.message, /不会自动创作或改写/u);
  }
});

test("Ref2VA preflight accepts official six fields and deterministic Chinese aliases", async (context) => {
  const { assertMultiSegmentPromptPreflight } = await loadModule(context);
  assert.doesNotThrow(() => assertMultiSegmentPromptPreflight(project(ref2vaEnglish, { mode: "REF2VA" })));
  assert.doesNotThrow(() => assertMultiSegmentPromptPreflight(project(ref2vaChineseAliases, { mode: "REF2VA" })));
});

test("Ref2VA preflight rejects base-only and incomplete multi-segment structures", async (context) => {
  const { assertMultiSegmentPromptPreflight } = await loadModule(context);
  for (const prompt of [baseEnglish, ref2vaEnglish.replace(/retention_analysis:[^\n]+\n\n/u, "")]) {
    const error = captureError(() => assertMultiSegmentPromptPreflight(project(prompt, { mode: "REF2VA" })));
    assert.equal(error.code, "INVALID_REQUEST");
    assert.match(error.message, /官方六字段结构/u);
  }
});

test("English and Chinese shot-start cut times must remain strictly before project duration", async (context) => {
  const { assertMultiSegmentPromptPreflight } = await loadModule(context);
  const valid = baseEnglish.replace("[Shot 6] At 00:25.000, conclusion.", "[Shot 6] At 00:25.000, conclusion. [Shot 7] At 00:29.999, final hold.");
  assert.doesNotThrow(() => assertMultiSegmentPromptPreflight(project(valid)));

  for (const prompt of [
    baseEnglish.replace("00:25.000", "00:30.000"),
    baseChineseAliases.replace("00:25.000", "00:31.000")
  ]) {
    const error = captureError(() => assertMultiSegmentPromptPreflight(project(prompt)));
    assert.equal(error.code, "INVALID_REQUEST");
    assert.match(error.message, /当前选择的总时长是 30 秒/u);
  }
});

test("every segment boundary requires an authored cut", async (context) => {
  const { assertMultiSegmentPromptPreflight } = await loadModule(context);
  const error = captureError(() => assertMultiSegmentPromptPreflight(
    project(baseEnglish.replace("00:10.000", "00:12.000"))
  ));
  assert.equal(error.code, "INVALID_REQUEST");
  assert.match(error.message, /分段边界 00:10\.000 缺少明确镜头切点/u);
  assert.match(error.message, /不会猜写跨段续接内容/u);
});

test("adapter invokes prompt preflight before the Stream B compiler", async () => {
  const source = await readFile(path.join(projectRoot, "src", "main", "services", "ab-cli-adapter.ts"), "utf8");
  const method = source.indexOf("async compileWorkflow(request: CompilerRequest)");
  const preflight = source.indexOf("assertMultiSegmentPromptPreflight(request.project)", method);
  const compiler = source.indexOf("await runStreamBCompiler(", method);
  assert.ok(method >= 0 && preflight > method && compiler > preflight);
  for (const code of [
    "PROJECT.PROMPT_FORMAT",
    "PROJECT.PROMPT_TIMELINE",
    "PROJECT.PROMPT_SEGMENTATION",
    "PROJECT.PROMPT_REFERENCE_BINDING"
  ]) assert.ok(source.includes(`errorCode === "${code}"`) || source.includes(`"${code}"`));
});
