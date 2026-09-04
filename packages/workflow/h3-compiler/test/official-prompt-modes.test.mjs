import assert from "node:assert/strict";
import test from "node:test";
import { compileProject } from "../src/index.mjs";
import { createSegmentPrompts } from "../src/segment-prompt.mjs";

const ALL_TAGS = Object.freeze(Array.from({ length: 6 }, (_, index) => `SCENE_${index + 1}`));
const SEGMENT_DURATIONS = Object.freeze([5, 10, 15]);

const englishSameLinePrompt = `integrated_multimodal_description: [Shot 1] Live-action, cinematic. SCENE_1 opens on a rain-covered station. [Shot 2] At 00:05.000, the camera cuts to SCENE_2 beside a moving train. [Shot 3] At 00:10.000, the shot switches to SCENE_3 inside the carriage. [Shot 4] At 00:15.000, the camera cuts to SCENE_4 near the exit. [Shot 5] At 00:20.000, the shot transitions to SCENE_5 on the platform. [Shot 6] At 00:25.000, the camera cuts to SCENE_6 beneath the sunrise.

overall_soundscape: EN_GLOBAL_SOUND remains continuous across the complete timeline.

non_diegetic_music: EN_GLOBAL_MUSIC continues at a slow tempo before fading out.`;

const chineseCrossLinePrompt = `integrated_multimodal_description:
[镜头 1]
真人实拍、电影质感。SCENE_1 展示雨中的车站。

[镜头 2]
在 00:05.000，画面切换至 SCENE_2，列车开始移动。

[镜头 3]
在 00:10.000，画面切换至 SCENE_3，人物走入车厢。

[镜头 4]
在 00:15.000，画面切换至 SCENE_4，人物靠近出口。

[镜头 5]
在 00:20.000，画面切换至 SCENE_5，人物走上站台。

[镜头 6]
在 00:25.000，画面切换至 SCENE_6，日出照亮远处。

overall_soundscape: ZH_GLOBAL_SOUND 在完整时间线上保持连续。

non_diegetic_music: ZH_GLOBAL_MUSIC 以缓慢节奏持续并淡出。`;

const officialFl2vaPrompt = `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 6) aligns with the 30.00-second mark of the target video.

integrated_multimodal_description: [镜头 1] <Picture 1> 建立人物外观、构图与场景锚点，SCENE_1 从该状态开始。

[镜头 2] 在 00:05.000，画面切换至 SCENE_2，人物保持身份与服装一致。

[镜头 3] 在 00:10.000，画面切换至 SCENE_3，动作连续发展。

[镜头 4] 在 00:15.000，画面切换至 SCENE_4，构图逐步接近结尾。

[镜头 5] 在 00:20.000，画面切换至 SCENE_5，物体与光线继续过渡。

[镜头 6] 在 00:25.000，画面切换至 SCENE_6，并在结尾落到 <Picture 2> 的状态与构图。

overall_soundscape: FL_GLOBAL_SOUND 在六个镜头之间连续衔接。

non_diegetic_music: FL_GLOBAL_MUSIC 保持统一配器并在结尾淡出。`;

const officialRef2vaPrompt = `subject_definitions:
<Subject 1> is the courier referenced by <Picture 1>, with stable clothing and identity.
<Picture 1> is the visual reference for <Subject 1> and the target environment.

summary:
[reference generation] The target keeps <Subject 1> and the environment from <Picture 1> consistent.

retention_analysis:
<Subject 1>: fully_preserved - Preserve the identity, clothing, colors, and scene geometry referenced by <Picture 1> throughout all shots.

detailed_description:
The target video uses a live-action cinematic style with stable lighting.
[Shot 1] Live-action, cinematic. SCENE_1 begins with <Subject 1> in the referenced environment. [Shot 2] At 00:05.000, the camera cuts to SCENE_2 while the subject remains consistent. [Shot 3] At 00:10.000, the shot switches to SCENE_3 with the same clothing and colors. [Shot 4] At 00:15.000, the camera cuts to SCENE_4 as the action continues. [Shot 5] At 00:20.000, the shot transitions to SCENE_5 without changing identity. [Shot 6] At 00:25.000, the camera cuts to SCENE_6 and settles on the referenced environment.

overall_soundscape:
REF_GLOBAL_SOUND remains continuous across the complete timeline.

non_diegetic_music:
REF_GLOBAL_MUSIC continues at a slow tempo before fading out.`;

function projectFor({ prompt, mode, segmentDuration, duration = 30 }) {
  return {
    schema_version: "1.0.0",
    prompt,
    mode,
    duration,
    segment_duration: segmentDuration,
    canvas: "16:9",
    resolution_megapixels: 0.4,
    ...(mode === "first_last_frame" ? {
      endpoints: {
        first_frame: "input/official-first.png",
        last_frame: "input/official-last.png",
      },
    } : {}),
    ...(mode === "first_frame" ? {
      endpoints: {
        first_frame: "input/official-first.png",
      },
    } : {}),
    ...(mode === "ref2va" ? {
      endpoints: {
        reference_images: ["input/reference-one.png", "input/reference-two.png"],
      },
    } : {}),
  };
}

function shortStructuredPrompt(shotCount) {
  const shots = Array.from({ length: shotCount }, (_, index) => {
    const number = index + 1;
    if (index === 0) return `[镜头 1] 真人实拍、电影质感。SHORT_SCENE_1 建立初始构图。`;
    return `[镜头 ${number}] 在 00:${String(index * 5).padStart(2, "0")}.000，画面切换至 SHORT_SCENE_${number}。`;
  }).join("\n\n");
  return `integrated_multimodal_description: ${shots}

overall_soundscape: SHORT_GLOBAL_SOUND 在完整时间线上保持连续。

non_diegetic_music: SHORT_GLOBAL_MUSIC 以缓慢节奏持续并淡出。`;
}

function callPrompts(compilation) {
  const callTypes = new Set([
    "79dd8a95-ce9d-4c14-b264-2162e8bec5ce",
    "4c314f31-ecda-4b08-ae98-faaba1bf613f",
  ]);
  return compilation.workflows[0].workflow.nodes
    .filter((node) => callTypes.has(node.type))
    .sort((left, right) => String(left.title).localeCompare(String(right.title)))
    .map((node) => node.widgets_values_named.prompt);
}

function boundPrompt(compilation) {
  const referenceCall = compilation.workflows[0].workflow.nodes
    .find((node) => node.type === "MiniMaxH3ReferenceToVideo");
  return referenceCall?.widgets_values_named.prompt ?? callPrompts(compilation)[0];
}

function extractSection(prompt, name, followingNames) {
  const header = new RegExp(`(?:^|\\r?\\n)[\\t ]*${name}[\\t ]*[:：][\\t ]*`, "iu");
  const match = header.exec(prompt);
  assert.ok(match, `missing ${name} section`);
  const start = match.index + match[0].length;
  const remaining = prompt.slice(start);
  if (followingNames.length === 0) return remaining.trim();
  const nextHeader = new RegExp(
    `\\r?\\n[\\t ]*(?:${followingNames.join("|")})[\\t ]*[:：]`,
    "iu",
  );
  const next = nextHeader.exec(remaining);
  return remaining.slice(0, next?.index ?? remaining.length).trim();
}

function parseShots(description) {
  const marker = /[\[［【][\t ]*(Shot|镜头)[\t ]*([0-9]+)[\t ]*[\]］】]/giu;
  const matches = [...description.matchAll(marker)];
  return matches.map((match, index) => ({
    label: match[1],
    number: Number(match[2]),
    body: description.slice(
      match.index + match[0].length,
      matches[index + 1]?.index ?? description.length,
    ).trim(),
  }));
}

function expectedGroups(segmentDuration) {
  const perSegment = segmentDuration / 5;
  return Array.from({ length: 30 / segmentDuration }, (_, segmentIndex) => (
    ALL_TAGS.slice(segmentIndex * perSegment, (segmentIndex + 1) * perSegment)
  ));
}

function assertSegmentedPrompts({
  prompts,
  segmentDuration,
  timelineField,
  followingFields,
  markerLabel,
  globalSound,
  globalMusic,
}) {
  const groups = expectedGroups(segmentDuration);
  assert.equal(prompts.length, groups.length);
  for (let segmentIndex = 0; segmentIndex < prompts.length; segmentIndex += 1) {
    const prompt = prompts[segmentIndex];
    const description = extractSection(prompt, timelineField, followingFields);
    const expectedTags = groups[segmentIndex];
    for (const tag of expectedTags) assert.match(description, new RegExp(`\\b${tag}\\b`, "u"));
    for (const tag of ALL_TAGS.filter((candidate) => !expectedTags.includes(candidate))) {
      assert.doesNotMatch(description, new RegExp(`\\b${tag}\\b`, "u"));
    }

    const shots = parseShots(description);
    assert.deepEqual(shots.map((shot) => shot.number), expectedTags.map((_, index) => index + 1));
    assert.equal(shots.every((shot) => shot.label.toLowerCase() === markerLabel.toLowerCase()), true);
    for (let localIndex = 0; localIndex < shots.length; localIndex += 1) {
      assert.match(shots[localIndex].body, new RegExp(`\\b${expectedTags[localIndex]}\\b`, "u"));
      if (localIndex === 0) {
        assert.doesNotMatch(shots[localIndex].body, /(?:At|在)[\t ]*00:00\.000/iu);
      } else {
        assert.match(
          shots[localIndex].body,
          new RegExp(`(?:At|在)[\\t ]*00:${String(localIndex * 5).padStart(2, "0")}\\.000`, "iu"),
        );
      }
    }

    assert.equal(extractSection(prompt, "overall_soundscape", ["non_diegetic_music"]), globalSound);
    assert.equal(extractSection(prompt, "non_diegetic_music", []), globalMusic);
  }
}

for (const segmentDuration of SEGMENT_DURATIONS) {
  test(`official English T2VA with same-line [Shot N] markers segments at ${segmentDuration}s`, async () => {
    const compilation = await compileProject(projectFor({
      prompt: englishSameLinePrompt,
      mode: "t2v",
      segmentDuration,
    }));
    assertSegmentedPrompts({
      prompts: callPrompts(compilation),
      segmentDuration,
      timelineField: "integrated_multimodal_description",
      followingFields: ["overall_soundscape", "non_diegetic_music"],
      markerLabel: "Shot",
      globalSound: "EN_GLOBAL_SOUND remains continuous across the complete timeline.",
      globalMusic: "EN_GLOBAL_MUSIC continues at a slow tempo before fading out.",
    });
  });

  test(`Chinese content with cross-line [镜头 N] markers segments at ${segmentDuration}s`, async () => {
    const compilation = await compileProject(projectFor({
      prompt: chineseCrossLinePrompt,
      mode: "t2v",
      segmentDuration,
    }));
    assertSegmentedPrompts({
      prompts: callPrompts(compilation),
      segmentDuration,
      timelineField: "integrated_multimodal_description",
      followingFields: ["overall_soundscape", "non_diegetic_music"],
      markerLabel: "Shot",
      globalSound: "ZH_GLOBAL_SOUND 在完整时间线上保持连续。",
      globalMusic: "ZH_GLOBAL_MUSIC 以缓慢节奏持续并淡出。",
    });
  });

  test(`official FL2VA alignment preamble remains segmentable at ${segmentDuration}s`, async () => {
    const compilation = await compileProject(projectFor({
      prompt: officialFl2vaPrompt,
      mode: "first_last_frame",
      segmentDuration,
    }));
    assertSegmentedPrompts({
      prompts: callPrompts(compilation),
      segmentDuration,
      timelineField: "integrated_multimodal_description",
      followingFields: ["overall_soundscape", "non_diegetic_music"],
      markerLabel: "Shot",
      globalSound: "FL_GLOBAL_SOUND 在六个镜头之间连续衔接。",
      globalMusic: "FL_GLOBAL_MUSIC 保持统一配器并在结尾淡出。",
    });
  });

  test(`official six-section Ref2VA prompt remains segmentable at ${segmentDuration}s`, async () => {
    const compilation = await compileProject(projectFor({
      prompt: officialRef2vaPrompt,
      mode: "ref2va",
      segmentDuration,
    }));
    const prompts = createSegmentPrompts(compilation.project, compilation.plan);
    for (const prompt of prompts) {
      assert.match(prompt, /subject_definitions:/u);
      assert.match(prompt, /summary:/u);
      assert.match(prompt, /retention_analysis:/u);
      assert.match(prompt, /<Subject 1>/u);
      assert.match(prompt, /<Picture 1>/u);
    }
    assertSegmentedPrompts({
      prompts,
      segmentDuration,
      timelineField: "detailed_description",
      followingFields: ["overall_soundscape", "non_diegetic_music"],
      markerLabel: "Shot",
      globalSound: "REF_GLOBAL_SOUND remains continuous across the complete timeline.",
      globalMusic: "REF_GLOBAL_MUSIC continues at a slow tempo before fading out.",
    });
    const call = compilation.workflows[0].workflow.nodes.find((node) => node.type === "MiniMaxH3ReferenceToVideo");
    assert.equal(call.widgets_values_named.prompt, prompts[0]);
  });
}

test("FL2VA long-DAG compilation keeps both user-selected endpoint images at graph edges", async () => {
  for (const segmentDuration of SEGMENT_DURATIONS) {
    const compilation = await compileProject(projectFor({
      prompt: officialFl2vaPrompt,
      mode: "first_last_frame",
      segmentDuration,
    }));
    assert.deepEqual(compilation.plan.segments[0].endpoints, { first_frame: "input/official-first.png" });
    assert.deepEqual(compilation.plan.segments.at(-1).endpoints, { last_frame: "input/official-last.png" });
    const locators = compilation.workflows[0].workflow.nodes
      .filter((node) => node.type === "LoadImage")
      .map((node) => node.widgets_values_named.image)
      .sort();
    assert.deepEqual(locators, ["input/official-first.png", "input/official-last.png"]);
  }
});

test("Ref2VA compilation keeps reference-image endpoints and labels without path loss", async () => {
  for (const segmentDuration of SEGMENT_DURATIONS) {
    const compilation = await compileProject(projectFor({
      prompt: officialRef2vaPrompt,
      mode: "ref2va",
      segmentDuration,
    }));
    assert.deepEqual(
      compilation.plan.segments[0].endpoints.reference_images,
      ["input/reference-one.png", "input/reference-two.png"],
    );
    const locators = compilation.workflows[0].workflow.nodes
      .filter((node) => node.type === "LoadImage")
      .map((node) => node.widgets_values_named.image);
    assert.deepEqual(locators, ["input/reference-one.png", "input/reference-two.png"]);
    assert.match(compilation.workflows[0].workflow.nodes
      .find((node) => node.type === "MiniMaxH3ReferenceToVideo")
      .widgets_values_named.prompt, /<Picture 1>/u);
  }
});

test("only single-node T2V accepts a plain prompt; keyframe and Ref2VA require official structures", async () => {
  const prompt = "用户给出的普通中文提示词，没有结构化字段或镜头标记；必须原样保留。";
  const single = await compileProject(projectFor({ prompt, mode: "t2v", duration: 5, segmentDuration: 5 }));
  assert.deepEqual(createSegmentPrompts(single.project, single.plan), [prompt]);
  await assert.rejects(
    () => compileProject(projectFor({ prompt, mode: "t2v", segmentDuration: 5 })),
    (error) => error?.code === "PROJECT.PROMPT_SEGMENTATION",
  );
  for (const mode of ["first_last_frame", "ref2va"]) {
    await assert.rejects(
      () => compileProject(projectFor({ prompt, mode, duration: 5, segmentDuration: 5 })),
      (error) => error?.code === "PROJECT.PROMPT_FORMAT",
    );
  }
});

for (const expected of [
  {
    duration: 10,
    segmentDuration: 5,
    segmentDurations: [5, 5],
    groups: [["SHORT_SCENE_1"], ["SHORT_SCENE_2"]],
  },
  {
    duration: 15,
    segmentDuration: 5,
    segmentDurations: [5, 5, 5],
    groups: [["SHORT_SCENE_1"], ["SHORT_SCENE_2"], ["SHORT_SCENE_3"]],
  },
  {
    duration: 15,
    segmentDuration: 10,
    segmentDurations: [10, 5],
    groups: [["SHORT_SCENE_1", "SHORT_SCENE_2"], ["SHORT_SCENE_3"]],
  },
]) {
  test(`${expected.duration}s total honors ${expected.segmentDuration}s segment length and a partial tail`, async () => {
    const prompt = shortStructuredPrompt(expected.duration / 5);
    const compilation = await compileProject(projectFor({
      prompt,
      mode: "t2v",
      duration: expected.duration,
      segmentDuration: expected.segmentDuration,
    }));

    assert.equal(compilation.plan.requested_segment_duration, expected.segmentDuration);
    assert.equal(compilation.plan.segment_count, expected.segmentDurations.length);
    assert.deepEqual(compilation.plan.segments.map((segment) => segment.duration), expected.segmentDurations);
    assert.deepEqual(
      compilation.plan.segments.map((segment) => segment.generated_frames),
      expected.segmentDurations.map((duration) => duration === 5 ? 124 : 243),
    );

    const workflow = compilation.workflows[0].workflow;
    const calls = workflow.nodes
      .filter((node) => node.type === "79dd8a95-ce9d-4c14-b264-2162e8bec5ce")
      .sort((left, right) => String(left.title).localeCompare(String(right.title)));
    assert.equal(calls.length, expected.segmentDurations.length);
    assert.deepEqual(calls.map((node) => node.widgets_values_named.value_1), expected.segmentDurations);

    for (let segmentIndex = 0; segmentIndex < calls.length; segmentIndex += 1) {
      const segmentPrompt = calls[segmentIndex].widgets_values_named.prompt;
      const description = extractSection(segmentPrompt, "integrated_multimodal_description", [
        "overall_soundscape",
        "non_diegetic_music",
      ]);
      const expectedTags = expected.groups[segmentIndex];
      for (const tag of expectedTags) assert.match(description, new RegExp(`\\b${tag}\\b`, "u"));
      for (const tag of expected.groups.flat().filter((candidate) => !expectedTags.includes(candidate))) {
        assert.doesNotMatch(description, new RegExp(`\\b${tag}\\b`, "u"));
      }
      const shots = parseShots(description);
      assert.deepEqual(shots.map((shot) => shot.number), expectedTags.map((_, index) => index + 1));
      for (let localIndex = 0; localIndex < shots.length; localIndex += 1) {
        if (localIndex === 0) {
          assert.doesNotMatch(shots[localIndex].body, /在[\t ]*00:00\.000/u);
        } else {
          assert.match(
            shots[localIndex].body,
            new RegExp(`At[\\t ]*00:${String(localIndex * 5).padStart(2, "0")}\\.000`, "u"),
          );
        }
      }
      assert.equal(
        extractSection(segmentPrompt, "overall_soundscape", ["non_diegetic_music"]),
        "SHORT_GLOBAL_SOUND 在完整时间线上保持连续。",
      );
      assert.equal(
        extractSection(segmentPrompt, "non_diegetic_music", []),
        "SHORT_GLOBAL_MUSIC 以缓慢节奏持续并淡出。",
      );
    }
  });
}

test("Chinese field aliases, shot labels, and cut syntax normalize to the official English controls", async () => {
  const prompt = `综合多模态描述：
[镜头 1] 真人实拍、电影质感。ALIAS_SCENE_1 建立初始构图。

[镜头 2] 在 00:05.000，画面切换至 ALIAS_SCENE_2。

整体声景：ALIAS_SOUND 保持连续。

画外配乐：ALIAS_MUSIC 在结尾淡出。`;
  const compilation = await compileProject(projectFor({
    prompt,
    mode: "t2v",
    duration: 10,
    segmentDuration: 10,
  }));
  const normalized = boundPrompt(compilation);
  assert.match(normalized, /^integrated_multimodal_description: \[Shot 1\]/u);
  assert.match(normalized, /\[Shot 2\] At 00:05\.000, 画面切换至 ALIAS_SCENE_2。/u);
  assert.match(normalized, /\noverall_soundscape: ALIAS_SOUND 保持连续。/u);
  assert.match(normalized, /\nnon_diegetic_music: ALIAS_MUSIC 在结尾淡出。/u);
  assert.doesNotMatch(normalized, /(?:综合多模态描述|整体声景|画外配乐)[：:]/u);
  assert.doesNotMatch(normalized, /\[镜头/u);
  assert.doesNotMatch(normalized, /在[\t ]*00:05\.000/u);
});

test("a 30-second shot timeline fails closed when project.duration is reduced to 15 seconds", async () => {
  await assert.rejects(
    () => compileProject(projectFor({
      prompt: englishSameLinePrompt,
      mode: "t2v",
      duration: 15,
      segmentDuration: 5,
    })),
    (error) => error?.code === "PROJECT.PROMPT_TIMELINE" && error?.instancePath === "/prompt",
  );
});

test("I2VA uses an official local alignment line on every 15s to 10+5 segment", async () => {
  const compilation = await compileProject(projectFor({
    prompt: shortStructuredPrompt(3),
    mode: "first_frame",
    duration: 15,
    segmentDuration: 10,
  }));
  assert.deepEqual(compilation.plan.segments.map((segment) => segment.duration), [10, 5]);
  assert.deepEqual(compilation.plan.segments.map((segment) => segment.mode), ["first_frame", "first_frame"]);
  const prompts = callPrompts(compilation);
  assert.equal(prompts.length, 2);
  const expected = "For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.";
  assert.deepEqual(prompts.map((prompt) => prompt.split(/\r?\n/u, 1)[0]), [expected, expected]);
  assert.deepEqual(
    compilation.workflows[0].workflow.nodes
      .filter((node) => node.type === "4c314f31-ecda-4b08-ae98-faaba1bf613f")
      .sort((left, right) => String(left.title).localeCompare(String(right.title)))
      .map((node) => node.widgets_values_named.value_1),
    [10, 5],
  );
});

test("FL2VA rewrites its 15s to 10+5 tail alignment to the final segment's local duration", async () => {
  const compilation = await compileProject(projectFor({
    prompt: shortStructuredPrompt(3),
    mode: "first_last_frame",
    duration: 15,
    segmentDuration: 10,
  }));
  assert.deepEqual(compilation.plan.segments.map((segment) => segment.duration), [10, 5]);
  assert.deepEqual(compilation.plan.segments.map((segment) => segment.mode), ["first_frame", "first_last_frame"]);
  const prompts = callPrompts(compilation);
  assert.equal(prompts.length, 2);
  assert.equal(
    prompts[0].split(/\r?\n/u, 1)[0],
    "For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.",
  );
  assert.equal(
    prompts[1].split(/\r?\n/u, 1)[0],
    "How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 1) aligns with the 5.00-second mark of the target video.",
  );
  assert.doesNotMatch(prompts[1].split(/\r?\n/u, 1)[0], /(?:10|15)\.00-second/u);
  const tailDescription = extractSection(prompts[1], "integrated_multimodal_description", [
    "overall_soundscape",
    "non_diegetic_music",
  ]);
  assert.match(tailDescription, /^\[Shot 1\][^\n]*SHORT_SCENE_3/u);
  assert.doesNotMatch(tailDescription, /00:10\.000/u);
});

const minimalContracts = Object.freeze([
  {
    name: "T2V English",
    mode: "t2v",
    tag: "MIN_T2V_EN",
    prompt: `integrated_multimodal_description: [Shot 1] Live-action, cinematic. MIN_T2V_EN remains visible.

overall_soundscape: N/A

non_diegetic_music: N/A`,
    headers: ["integrated_multimodal_description", "overall_soundscape", "non_diegetic_music"],
  },
  {
    name: "T2V Chinese",
    mode: "t2v",
    tag: "MIN_T2V_ZH",
    prompt: `综合多模态描述：[镜头 1] 真人实拍、电影质感。MIN_T2V_ZH 保持可见。

整体声景：N/A

画外配乐：N/A`,
    headers: ["integrated_multimodal_description", "overall_soundscape", "non_diegetic_music"],
  },
  {
    name: "FL2VA English",
    mode: "first_last_frame",
    tag: "MIN_FL_EN",
    prompt: `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 1) aligns with the 5.00-second mark of the target video.

integrated_multimodal_description: [Shot 1] Live-action, cinematic. MIN_FL_EN moves continuously from <Picture 1> to <Picture 2>.

overall_soundscape: N/A

non_diegetic_music: N/A`,
    headers: ["integrated_multimodal_description", "overall_soundscape", "non_diegetic_music"],
  },
  {
    name: "FL2VA Chinese",
    mode: "first_last_frame",
    tag: "MIN_FL_ZH",
    prompt: `参考图片与目标视频对齐：图片 1 对应起点，图片 2 对应 5.00 秒终点。

综合多模态描述：[镜头 1] 真人实拍、电影质感。MIN_FL_ZH 从 <Picture 1> 连续变化至 <Picture 2>。

整体声景：N/A

画外配乐：N/A`,
    headers: ["integrated_multimodal_description", "overall_soundscape", "non_diegetic_music"],
  },
  {
    name: "Ref2VA English",
    mode: "ref2va",
    tag: "MIN_REF_EN",
    prompt: `subject_definitions:
<Subject 1> is defined by <Picture 1>.

summary:
[reference generation] MIN_REF_EN keeps <Subject 1> consistent.

retention_analysis:
<Subject 1>: fully_preserved - Preserve the referenced identity and colors.

detailed_description:
The target video uses a live-action cinematic style.
[Shot 1] Live-action, cinematic. <Subject 1> remains in the referenced scene.

overall_soundscape:
N/A

non_diegetic_music:
N/A`,
    headers: [
      "subject_definitions",
      "summary",
      "retention_analysis",
      "detailed_description",
      "overall_soundscape",
      "non_diegetic_music",
    ],
  },
  {
    name: "Ref2VA Chinese",
    mode: "ref2va",
    tag: "MIN_REF_ZH",
    prompt: `主体定义：
<Subject 1> 由 <Picture 1> 定义。

摘要：
[reference generation] MIN_REF_ZH 保持 <Subject 1> 一致。

保留分析：
<Subject 1>: fully_preserved - 保留参考身份与色彩。

详细描述：
The target video uses a live-action cinematic style.
[镜头 1] 真人实拍、电影质感。<Subject 1> 保持在参考场景中。

整体声景：
N/A

画外配乐：
N/A`,
    headers: [
      "subject_definitions",
      "summary",
      "retention_analysis",
      "detailed_description",
      "overall_soundscape",
      "non_diegetic_music",
    ],
  },
]);

for (const contract of minimalContracts) {
  test(`${contract.name} minimal official contract compiles and binds canonically`, async () => {
    const compilation = await compileProject(projectFor({
      prompt: contract.prompt,
      mode: contract.mode,
      duration: 5,
      segmentDuration: 5,
    }));
    assert.equal(compilation.workflows.length, 1);
    assert.equal(compilation.workflows[0].lint.ok, true);
    const prompt = boundPrompt(compilation);
    assert.match(prompt, new RegExp(`\\b${contract.tag}\\b`, "u"));
    assert.match(prompt, /\[Shot 1\]/u);
    assert.doesNotMatch(prompt, /\[镜头/u);
    const headers = [...prompt.matchAll(
      /(?:^|\r?\n)(subject_definitions|summary|retention_analysis|detailed_description|integrated_multimodal_description|overall_soundscape|non_diegetic_music):/gu,
    )].map((match) => match[1]);
    assert.deepEqual(headers, contract.headers);
  });
}
