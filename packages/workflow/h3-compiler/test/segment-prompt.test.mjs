import assert from "node:assert/strict";
import test from "node:test";
import { compileProject } from "../src/index.mjs";
import { createSegmentPrompts } from "../src/segment-prompt.mjs";

const structuredPrompt = `integrated_multimodal_description: [镜头 1] 视觉一：雨中的高架铁路。

[镜头 2] 在 00:05.000，视觉二：骑车穿过巷道。

[镜头 3] 在 00:10.000，视觉三：进入屋顶温室。

[镜头 4] 在 00:15.000，视觉四：倒下金色种子。

[镜头 5] 在 00:20.000，视觉五：花园快速生长。

[镜头 6] 在 00:25.000，视觉六：日出时回望花园。视频在 30.00 秒时结束。

overall_soundscape: 全片雨声、车链声和温室水滴声保持连续。

non_diegetic_music: 全片毛毡钢琴、电子脉冲和弦乐保持连续。`;

function project(prompt, segmentDuration) {
  return {
    schema_version: "1.0.0",
    prompt,
    mode: "t2v",
    duration: 30,
    segment_duration: segmentDuration,
    canvas: "16:9",
    resolution_megapixels: 0.98,
  };
}

function segmentPrompts(compilation) {
  return compilation.workflows[0].workflow.nodes
    .filter((node) => node.type === "79dd8a95-ce9d-4c14-b264-2162e8bec5ce")
    .sort((left, right) => left.title.localeCompare(right.title))
    .map((node) => node.widgets_values_named.prompt);
}

function allCallPrompts(compilation) {
  return compilation.workflows[0].workflow.nodes
    .filter((node) => new Set([
      "79dd8a95-ce9d-4c14-b264-2162e8bec5ce",
      "4c314f31-ecda-4b08-ae98-faaba1bf613f",
      "MiniMaxH3ReferenceToVideo",
    ]).has(node.type))
    .sort((left, right) => left.title.localeCompare(right.title))
    .map((node) => node.widgets_values_named.prompt);
}

function timeline(prompt) {
  return prompt.match(/integrated_multimodal_description: ([\s\S]*?)(?:\n\noverall_soundscape:|\n\nnon_diegetic_music:|$)/u)?.[1] ?? "";
}

function clearSection(prompt, header, followingHeader) {
  const pattern = new RegExp(`(${header}:)[\\s\\S]*?(?=\\r?\\n\\r?\\n${followingHeader}:)`, "u");
  return prompt.replace(pattern, "$1");
}

function assertEmptyOfficialAudioFields(prompt, expectedHeaders) {
  const headers = [...prompt.matchAll(
    /(?:^|\r?\n)(subject_definitions|summary|retention_analysis|detailed_description|integrated_multimodal_description|overall_soundscape|non_diegetic_music):/gu,
  )].map((match) => match[1]);
  assert.deepEqual(headers, expectedHeaders);
  assert.match(prompt, /\noverall_soundscape:\r?\n\r?\nnon_diegetic_music:\s*$/u);
  assert.doesNotMatch(prompt, /N\/A|无|静音/u);
}

test("Chinese timed shots become six local five-second prompts with shared audio context", async () => {
  const result = await compileProject(project(structuredPrompt, 5));
  const prompts = segmentPrompts(result);
  assert.equal(result.project.prompt, structuredPrompt);
  assert.equal(prompts.length, 6);
  assert.equal(new Set(prompts).size, 6);

  for (let index = 0; index < prompts.length; index += 1) {
    assert.match(prompts[index], new RegExp(`视觉${"一二三四五六"[index]}`));
    for (let other = 0; other < prompts.length; other += 1) {
      if (other !== index) assert.doesNotMatch(prompts[index], new RegExp(`视觉${"一二三四五六"[other]}`));
    }
    assert.deepEqual([...timeline(prompts[index]).matchAll(/\[Shot (\d+)\]/gu)].map((match) => match[1]), ["1"]);
    assert.match(prompts[index], /overall_soundscape: 全片雨声、车链声和温室水滴声保持连续。/u);
    assert.match(prompts[index], /non_diegetic_music: 全片毛毡钢琴、电子脉冲和弦乐保持连续。/u);
    assert.doesNotMatch(prompts[index], /segment_timing:/u);
  }

  assert.match(prompts[1], /\[Shot 1\] 视觉二/u);
  assert.doesNotMatch(prompts[1], /\[Shot 1\][^\n]*00:00\.000/u);
  assert.doesNotMatch(prompts[1], /在 00:05\.000，视觉二/u);
  assert.match(prompts[5], /视频在 5\.00 秒时结束/u);
  assert.doesNotMatch(prompts[5], /视频在 30\.00 秒时结束/u);
});

test("ten- and fifteen-second nodes group shots by source time and rebase local numbering and time", async () => {
  const tenSecond = segmentPrompts(await compileProject(project(structuredPrompt, 10)));
  assert.equal(tenSecond.length, 3);
  assert.deepEqual(tenSecond.map((prompt) => (
    [...prompt.matchAll(/视觉([一二三四五六])/gu)].map((match) => match[1]).join("")
  )), ["一二", "三四", "五六"]);
  for (const prompt of tenSecond) {
    assert.deepEqual([...timeline(prompt).matchAll(/\[Shot (\d+)\]/gu)].map((match) => match[1]), ["1", "2"]);
  }
  assert.match(tenSecond[1], /\[Shot 1\] 视觉三/u);
  assert.doesNotMatch(tenSecond[1], /\[Shot 1\][^\n]*00:00\.000/u);
  assert.match(tenSecond[1], /\[Shot 2\] At 00:05\.000, 视觉四/u);
  assert.doesNotMatch(tenSecond[1], /在 00:10\.000，视觉三/u);
  assert.doesNotMatch(tenSecond[1], /在 00:15\.000，视觉四/u);
  assert.match(tenSecond[2], /视频在 10\.00 秒时结束/u);

  const fifteenSecond = segmentPrompts(await compileProject(project(structuredPrompt, 15)));
  assert.equal(fifteenSecond.length, 2);
  assert.deepEqual(fifteenSecond.map((prompt) => (
    [...prompt.matchAll(/视觉([一二三四五六])/gu)].map((match) => match[1]).join("")
  )), ["一二三", "四五六"]);
  assert.deepEqual(
    [...timeline(fifteenSecond[1]).matchAll(/\[Shot (\d+)\]/gu)].map((match) => match[1]),
    ["1", "2", "3"],
  );
  assert.match(fifteenSecond[1], /\[Shot 1\] 视觉四/u);
  assert.doesNotMatch(fifteenSecond[1], /\[Shot 1\][^\n]*00:00\.000/u);
  assert.match(fifteenSecond[1], /\[Shot 2\] At 00:05\.000, 视觉五/u);
  assert.match(fifteenSecond[1], /\[Shot 3\] At 00:10\.000, 视觉六/u);
  assert.match(fifteenSecond[1], /视频在 15\.00 秒时结束/u);
});

test("multi-segment base and FL2VA prompts preserve empty official audio fields", async () => {
  const basePrompt = `integrated_multimodal_description: [Shot 1] Opening. [Shot 2] At 00:05.000, conclusion.

overall_soundscape:

non_diegetic_music:`;
  const basePrompts = allCallPrompts(await compileProject({
    ...project(basePrompt, 5),
    duration: 10,
  }));
  assert.equal(basePrompts.length, 2);

  const fl2vaPrompt = `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 2) aligns with the 10.00-second mark of the target video.

integrated_multimodal_description: [Shot 1] Begin at <Picture 1>. [Shot 2] At 00:05.000, conclude at <Picture 2>.

overall_soundscape:

non_diegetic_music:`;
  const fl2vaPrompts = allCallPrompts(await compileProject({
    ...project(fl2vaPrompt, 5),
    mode: "first_last_frame",
    duration: 10,
    endpoints: {
      first_frame: "input/first.png",
      last_frame: "input/last.png",
    },
  }));
  assert.equal(fl2vaPrompts.length, 2);

  for (const output of [...basePrompts, ...fl2vaPrompts]) {
    assertEmptyOfficialAudioFields(output, [
      "integrated_multimodal_description",
      "overall_soundscape",
      "non_diegetic_music",
    ]);
  }
});

test("multi-segment Ref2VA prompts preserve empty official audio fields", async () => {
  const prompt = `subject_definitions:
<Subject 1> is defined by <Picture 1>.

summary:
[reference generation] Keep <Subject 1> consistent.

retention_analysis:
<Subject 1>: fully_preserved - Preserve identity and clothing.

detailed_description:
The target video uses a live-action cinematic style.
[Shot 1] <Subject 1> opens in the referenced scene. [Shot 2] At 00:05.000, <Subject 1> concludes the action.

overall_soundscape:

non_diegetic_music:`;
  const compilation = await compileProject({
    ...project(prompt, 5),
    mode: "ref2va",
    duration: 10,
    endpoints: { reference_images: ["input/reference.png"] },
  });
  assert.equal(compilation.plan.segment_count, 2);
  assert.equal(compilation.workflows.length, 1);
  const prompts = createSegmentPrompts(compilation.project, compilation.plan);
  assert.equal(prompts.length, 2);
  for (const output of prompts) {
    assertEmptyOfficialAudioFields(output, [
      "subject_definitions",
      "summary",
      "retention_analysis",
      "detailed_description",
      "overall_soundscape",
      "non_diegetic_music",
    ]);
  }
});

test("empty non-audio fields remain invalid in base, FL2VA, and Ref2VA prompts", async () => {
  const validBase = `integrated_multimodal_description: [Shot 1] Opening. [Shot 2] At 00:05.000, conclusion.

overall_soundscape:

non_diegetic_music:`;
  const fl2vaPreamble = "How the reference pictures align with the target video — Picture 1 aligns with the 0.00-second mark and Picture 2 aligns with the 10.00-second mark.\n\n";
  await assert.rejects(
    () => compileProject({ ...project(clearSection(validBase, "integrated_multimodal_description", "overall_soundscape"), 5), duration: 10 }),
    (error) => error?.code === "PROJECT.PROMPT_FORMAT",
  );
  await assert.rejects(
    () => compileProject({
      ...project(fl2vaPreamble + clearSection(validBase, "integrated_multimodal_description", "overall_soundscape"), 5),
      mode: "first_last_frame",
      duration: 10,
      endpoints: { first_frame: "input/first.png", last_frame: "input/last.png" },
    }),
    (error) => error?.code === "PROJECT.PROMPT_FORMAT",
  );

  const validRef2va = `subject_definitions:
<Subject 1> is defined by <Picture 1>.

summary:
[reference generation] Keep <Subject 1> consistent.

retention_analysis:
<Subject 1>: fully_preserved - Preserve identity and clothing.

detailed_description:
The target video uses a live-action cinematic style.
[Shot 1] Opening. [Shot 2] At 00:05.000, conclusion.

overall_soundscape:

non_diegetic_music:`;
  for (const [header, nextHeader] of [
    ["subject_definitions", "summary"],
    ["summary", "retention_analysis"],
    ["retention_analysis", "detailed_description"],
    ["detailed_description", "overall_soundscape"],
  ]) {
    await assert.rejects(
      () => compileProject({
        ...project(clearSection(validRef2va, header, nextHeader), 5),
        mode: "ref2va",
        duration: 10,
        endpoints: { reference_images: ["input/reference.png"] },
      }),
      (error) => error?.code === "PROJECT.PROMPT_FORMAT",
    );
  }
});

test("untimed and unstructured multi-segment input fails closed", async () => {
  const positional = `integrated_multimodal_description: [镜头 1] A\n\n[镜头 2] B\n\n[镜头 3] C\n\n[镜头 4] D\n\n[镜头 5] E\n\n[镜头 6] F

overall_soundscape: Rain.

non_diegetic_music: N/A`;
  await assert.rejects(
    () => compileProject(project(positional, 10)),
    (error) => error?.code === "PROJECT.PROMPT_SEGMENTATION",
  );

  const unstructured = "一个连续的雨夜追逐镜头，没有结构化镜头标记，但必须原样保留。";
  await assert.rejects(
    () => compileProject(project(unstructured, 5)),
    (error) => error?.code === "PROJECT.PROMPT_SEGMENTATION",
  );

  const ambiguous = `integrated_multimodal_description: [镜头 1] A\n[镜头 2] B\n[镜头 3] C\n[镜头 4] D

overall_soundscape: Rain.

non_diegetic_music: N/A`;
  await assert.rejects(
    () => compileProject(project(ambiguous, 5)),
    (error) => error?.code === "PROJECT.PROMPT_SEGMENTATION",
  );
});

test("sparse timed shots that leave an output segment empty fail instead of being duplicated", async () => {
  const english = `integrated_multimodal_description: [Shot 1] Opening\n\n[Shot 2] At 00:05.000, continuation\n\noverall_soundscape: Rain.\n\nnon_diegetic_music: N/A`;
  await assert.rejects(
    () => compileProject(project(english, 15)),
    (error) => error?.code === "PROJECT.PROMPT_SEGMENTATION",
  );
});

test("a segment boundary without an authored cut fails instead of dropping an in-progress shot", async () => {
  const unaligned = `integrated_multimodal_description: [Shot 1] Opening.\n\n[Shot 2] At 00:05.000, continuous action.\n\n[Shot 3] At 00:12.000, final action.\n\noverall_soundscape: Rain.\n\nnon_diegetic_music: N/A`;
  await assert.rejects(
    () => compileProject({ ...project(unaligned, 10), duration: 15 }),
    (error) => error?.code === "PROJECT.PROMPT_SEGMENTATION",
  );
});

test("dialogue and visible clock text are never treated as timeline controls", async () => {
  const protectedPrompt = `integrated_multimodal_description: [Shot 1] A sign reading "20:00" remains visible while the courier says: <d>[Chinese] 00:07.000 见。</d> 视频在 5.00 秒时结束。

overall_soundscape: Quiet room tone.

non_diegetic_music: N/A`;
  const result = await compileProject({ ...project(protectedPrompt, 5), duration: 5 });
  const [output] = allCallPrompts(result);
  assert.match(output, /"20:00"/u);
  assert.match(output, /<d>\[Chinese\] 00:07\.000 见。<\/d>/u);
  assert.match(output, /视频在 5\.00 秒时结束/u);
});

test("official shot numbering, first-shot timing, and later-shot timing fail closed", async () => {
  const wrap = (timeline) => `integrated_multimodal_description: ${timeline}\n\noverall_soundscape: Rain.\n\nnon_diegetic_music: N/A`;
  await assert.rejects(
    () => compileProject({ ...project(wrap("[Shot 1] At 00:00.000, opening."), 5), duration: 5 }),
    (error) => error?.code === "PROJECT.PROMPT_TIMELINE",
  );
  await assert.rejects(
    () => compileProject({ ...project(wrap("[Shot 1] Opening. [Shot 3] At 00:05.000, ending."), 10), duration: 10 }),
    (error) => error?.code === "PROJECT.PROMPT_FORMAT",
  );
  await assert.rejects(
    () => compileProject({ ...project(wrap("[Shot 1] Opening. [Shot 2] Ending."), 10), duration: 10 }),
    (error) => error?.code === "PROJECT.PROMPT_SEGMENTATION",
  );
});

test("a Chinese cut without punctuation is normalized to official At syntax", async () => {
  const noComma = `integrated_multimodal_description: [镜头 1] 开场。 [镜头 2] 在 00:05.000 结束。\n\noverall_soundscape: 雨声。\n\nnon_diegetic_music: N/A`;
  const result = await compileProject({ ...project(noComma, 10), duration: 10 });
  const [output] = allCallPrompts(result);
  assert.match(output, /\[Shot 2\] At 00:05\.000, 结束。/u);
});

test("fullwidth Chinese shot numbers, clocks, and end time normalize to official ASCII controls", async () => {
  const fullwidth = `integrated_multimodal_description: 【镜头 １】开场。 【镜头 ２】在 ００：０５．０００，继续。 【镜头 ３】在 ００：１０．０００，结束。视频在 １５．００ 秒时结束。

overall_soundscape: 雨声。

non_diegetic_music: N/A`;
  const result = await compileProject({ ...project(fullwidth, 5), duration: 15 });
  const prompts = allCallPrompts(result);
  assert.equal(prompts.length, 3);
  assert.equal(new Set(prompts).size, 3);
  assert.match(prompts[1], /integrated_multimodal_description: \[Shot 1\] 继续。/u);
  assert.match(prompts[2], /integrated_multimodal_description: \[Shot 1\] 结束。/u);
  assert.match(prompts[2], /视频在 5\.00 秒时结束/u);
  assert.doesNotMatch(prompts[2], /视频在 15\.00 秒时结束/u);
  assert.doesNotMatch(prompts.join("\n"), /[０-９：．]/u);
});

test("compatibility-form English controls and circled shot numbers compile without changing shot content", async () => {
  const compatibility = `integrated_multimodal_description: ［Shot ①］Opening text stays here. ［Shot ②］Ａｔ ００：０５．０，Second scene text.

overall_soundscape: Rain.

non_diegetic_music: N/A`;
  const result = await compileProject({ ...project(compatibility, 5), duration: 10 });
  const prompts = allCallPrompts(result);
  assert.equal(prompts.length, 2);
  assert.match(prompts[0], /Opening text stays here/u);
  assert.match(prompts[1], /Second scene text/u);
  assert.doesNotMatch(prompts.join("\n"), /[①②Ａｔ０-９：．]/u);
});

test("a cut clock with more than three fractional digits fails instead of leaving a stray digit", async () => {
  const excessPrecision = `integrated_multimodal_description: [Shot 1] Opening. [Shot 2] At 00:05.0000, second scene.

overall_soundscape: Rain.

non_diegetic_music: N/A`;
  await assert.rejects(
    () => compileProject({ ...project(excessPrecision, 5), duration: 10 }),
    (error) => error?.code === "PROJECT.PROMPT_SEGMENTATION",
  );
});

test("long last-frame mode remaps the authored final Picture 1 to the local Picture 2 binding", async () => {
  const lastFrame = `How the reference pictures align with the target video — <Picture 1> (from [Shot 2]) aligns with the 15.00-second mark of the target video.

integrated_multimodal_description: [Shot 1] Opening without a reference image. [Shot 2] At 00:10.000, the composition converges on <图片 1>.

overall_soundscape: Rain.

non_diegetic_music: N/A`;
  const result = await compileProject({
    ...project(lastFrame, 10),
    duration: 15,
    mode: "last_frame",
    endpoints: { last_frame: "input/last.png" },
  });
  const prompts = allCallPrompts(result);
  const finalTimeline = timeline(prompts[1]);
  assert.match(finalTimeline, /<Picture 2>/u);
  assert.doesNotMatch(finalTimeline, /<Picture 1>/u);
});

test("long FL2VA rejects global picture labels that are not bound in a middle segment", async () => {
  const invalidMiddle = `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 3) aligns with the 15.00-second mark of the target video.

integrated_multimodal_description: [Shot 1] Begin at <Picture 1>. [Shot 2] At 00:05.000, incorrectly retain <Picture 2>. [Shot 3] At 00:10.000, end at <Picture 2>.

overall_soundscape: Rain.

non_diegetic_music: N/A`;
  await assert.rejects(
    () => compileProject({
      ...project(invalidMiddle, 5),
      duration: 15,
      mode: "first_last_frame",
      endpoints: { first_frame: "input/first.png", last_frame: "input/last.png" },
    }),
    (error) => error?.code === "PROJECT.PROMPT_REFERENCE_BINDING",
  );
});

test("Ref2VA normalizes Chinese reference labels and enforces official summary and retention controls", async () => {
  const valid = `主体定义：\n<主体 1> 来自 <图片 1>。\n\n摘要：\n[reference generation] 目标视频保持 <主体 1> 一致。\n\n保留分析：\n<主体 1>: fully_preserved - 保持身份与服装一致。\n\n详细描述：\nThe target video uses a live-action cinematic style.\n[镜头 1] <主体 1> 留在 <图片 1> 所示场景中。\n\n整体声景：\nN/A\n\n画外配乐：\nN/A`;
  const refProject = {
    schema_version: "1.0.0",
    prompt: valid,
    mode: "ref2va",
    duration: 5,
    segment_duration: 5,
    canvas: "16:9",
    resolution_megapixels: 0.4,
    endpoints: { reference_images: ["input/reference.png"] },
  };
  const [output] = allCallPrompts(await compileProject(refProject));
  assert.match(output, /<Subject 1>/u);
  assert.match(output, /<Picture 1>/u);
  assert.doesNotMatch(output, /<主体|<图片/u);

  await assert.rejects(
    () => compileProject({ ...refProject, prompt: valid.replace("[reference generation]", "[image reference]") }),
    (error) => error?.code === "PROJECT.PROMPT_FORMAT",
  );
  await assert.rejects(
    () => compileProject({ ...refProject, prompt: valid.replace(
      "<主体 1>: fully_preserved - 保持身份与服装一致。",
      "保留身份与服装。",
    ) }),
    (error) => error?.code === "PROJECT.PROMPT_FORMAT",
  );
  await assert.rejects(
    () => compileProject({ ...refProject, prompt: valid.replaceAll("<图片 1>", "<图片 2>") }),
    (error) => error?.code === "PROJECT.PROMPT_REFERENCE_BINDING",
  );
});
