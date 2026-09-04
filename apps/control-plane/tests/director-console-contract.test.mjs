import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { build } from "esbuild";
import { compileProject } from "../../../packages/workflow/h3-compiler/src/compiler.mjs";

const root = resolve(import.meta.dirname, "..");

async function read(relativePath) {
  return readFile(resolve(root, relativePath), "utf8");
}

async function directorModule() {
  const result = await build({
    entryPoints: [resolve(root, "src/renderer/director-console.ts")],
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

test("director console is a real local editor while preserving the product boundary", async () => {
  const [html, renderer, styles, directorSource] = await Promise.all([
    read("src/renderer/index.html"),
    read("src/renderer/index.ts"),
    read("src/renderer/styles.css"),
    read("src/renderer/director-console.ts")
  ]);
  assert.match(html, /data-view-target="director"[^>]*>[\s\S]*?专业导播/u);
  assert.match(html, /id="view-director"[^>]+data-view="director"/u);
  assert.match(html, /id="director-shot-list"/u);
  assert.match(html, /id="director-prompt-preview"/u);
  assert.match(html, /id="director-style-opening"/u);
  assert.match(html, /id="director-clear-first-frame"/u);
  assert.match(html, /id="director-clear-last-frame"/u);
  assert.match(html, /id="director-open-ref-install"/u);
  assert.match(html, /id="director-character-bible"/u);
  assert.match(html, /id="director-world-bible"/u);
  assert.match(html, /id="director-visual-style-bible"/u);
  assert.match(html, /class="director-timeline" aria-label="分段结构时间线"/u);
  assert.doesNotMatch(html, /结构时间线 · 不是视频预览/u);
  assert.match(renderer, /serializeDirectorPrompt/u);
  assert.match(renderer, /const directorShotMetadata = new Map/u);
  assert.match(renderer, /buildDirectorV7Payload/u);
  assert.match(renderer, /lastCompiledSnapshot/u);
  assert.match(renderer, /submittedDirectorCompilation/u);
  assert.match(renderer, /directorLastCompiledShotFingerprints/u);
  assert.match(renderer, /currentDirectorTechnicalSnapshot/u);
  assert.match(renderer, /const directorShotIds = new Map/u);
  assert.match(renderer, /restoreDirectorShotId/u);
  const saveDraftSource = renderer.slice(renderer.indexOf("function saveDirectorDraft"), renderer.indexOf("function captureDirectorCompilation"));
  assert.doesNotMatch(saveDraftSource, /directorLastCompiledSnapshot\s*=/u);
  const compileMarkerSource = renderer.slice(renderer.indexOf("function markDirectorCompiled"), renderer.indexOf("function optionValueExists"));
  assert.match(compileMarkerSource, /commitDirectorP1Compilation/u);
  assert.match(compileMarkerSource, /pending\.submission\.effectiveFingerprints/u);
  assert.match(compileMarkerSource, /liveStillMatches/u);
  assert.match(directorSource, /export function directorCompilationSnapshot[\s\S]*return JSON\.stringify/u);
  assert.doesNotMatch(directorSource.slice(directorSource.indexOf("export function directorCompilationSnapshot"), directorSource.indexOf("export function directorCompilationIsCurrent")), /deterministicFingerprint/u);
  assert.match(renderer, /createDirectorShotId/u);
  assert.match(renderer, /option\.disabled = false/u);
  assert.match(renderer, /directorCompileButton\.disabled = busy/u);
  assert.match(
    renderer,
    /directorCompileButton\.addEventListener\("click", \(\) => \{[\s\S]*?if \(!installationComplete\) \{[\s\S]*?showEnvironmentRequiredDialog\(\);[\s\S]*?return;[\s\S]*?validateDirectorForCompilation/u
  );
  assert.match(renderer, /不能只绑定参考图 2/u);
  assert.match(renderer, /projectForm\.requestSubmit\(\)/u);
  assert.match(styles, /\.page-container--director/u);
  assert.match(styles, /\.director-bible/u);
  assert.match(styles, /\.director-shot-fingerprint/u);
  assert.match(styles, /\.director-timeline__track \{[^}]*overflow-x: auto/u);
  const directorView = html.slice(html.indexOf('id="view-director"'), html.indexOf('id="view-assets"'));
  assert.doesNotMatch(directorView, /生成视频(?:按钮|任务)|自动分镜|AI 优化|一键成片|autoQueue|\/prompt/u);
  assert.match(directorView, /Relay 将当前内容确定性序列化为官方字段，并在 ComfyUI 中打开可继续编辑的工作流/u);
});

test("production bible and optional shot lanes merge as unlabeled natural-language paragraphs", async () => {
  const { directorShotFingerprint, serializeDirectorPrompt } = await directorModule();
  const shot = {
    id: "shot-stable-a",
    startSeconds: 0,
    durationSeconds: 5,
    description: "A courier enters the greenhouse.",
    cameraLanguage: "A slow, small-amplitude push-in.",
    soundCue: "Rain softens as the door opens.",
    transitionNote: "Hold the courier's yellow coat across the cut."
  };
  const draft = {
    language: "en",
    mode: "T2V",
    totalDurationSeconds: 5,
    segmentDurationSeconds: 5,
    characterBible: "The courier wears a yellow coat and carries a red bag.",
    worldBible: "A wet rooftop greenhouse before sunrise.",
    visualStyleBible: "Live action with restrained magical realism.",
    continuity: "Keep the paper crane scale consistent.",
    shots: [shot],
    overallSoundscape: "",
    nonDiegeticMusic: "",
    subjectDefinitions: "",
    summary: "",
    retentionAnalysis: "",
    styleOpening: ""
  };
  const result = serializeDirectorPrompt(draft);
  assert.deepEqual(result.errors, []);
  assert.match(result.prompt, /\[Shot 1\] A courier enters the greenhouse\./u);
  for (const exactParagraph of [
    "The courier wears a yellow coat and carries a red bag.",
    "A wet rooftop greenhouse before sunrise.",
    "Live action with restrained magical realism.",
    "A slow, small-amplitude push-in.",
    "Rain softens as the door opens.",
    "Hold the courier's yellow coat across the cut.",
    "Keep the paper crane scale consistent."
  ]) assert.ok(result.prompt.includes(`\n\n${exactParagraph}`));
  assert.doesNotMatch(result.prompt, /^(character_bible|camera_direction|shot_sound|transition_note|Character, wardrobe|Scene and world|Visual style|Camera direction|Shot sound cue|Transition and continuity note):/mu);

  const initialFingerprint = directorShotFingerprint(draft, shot);
  assert.equal(initialFingerprint, directorShotFingerprint(draft, { ...shot, id: "shot-reordered-but-same-content" }));
  assert.notEqual(
    initialFingerprint,
    directorShotFingerprint(draft, { ...shot, cameraLanguage: "A locked-off wide shot." })
  );
  assert.notEqual(
    initialFingerprint,
    directorShotFingerprint({ ...draft, characterBible: "The courier wears a blue coat." }, shot)
  );
});

test("blank production-bible and shot-lane values remain optional", async () => {
  const { serializeDirectorPrompt } = await directorModule();
  const result = serializeDirectorPrompt({
    language: "zh",
    mode: "T2V",
    totalDurationSeconds: 5,
    segmentDurationSeconds: 5,
    characterBible: "",
    worldBible: "",
    visualStyleBible: "",
    continuity: "",
    shots: [{
      id: "shot-empty-optionals",
      startSeconds: 0,
      durationSeconds: 5,
      description: "一只纸鹤飞过屋顶。",
      cameraLanguage: "",
      soundCue: "",
      transitionNote: ""
    }],
    overallSoundscape: "",
    nonDiegeticMusic: "",
    subjectDefinitions: "",
    summary: "",
    retentionAnalysis: "",
    styleOpening: ""
  });
  assert.deepEqual(result.errors, []);
  assert.doesNotMatch(result.prompt, /角色、服装|场景与世界参考|视觉风格参考|镜头语言|本镜头声音提示|转场与连续性备注/u);
  assert.match(result.prompt, /整体声景:[ \t]*\r?\n\r?\n画外配乐:[ \t]*$/u);
  assert.doesNotMatch(result.prompt, /N\/A/u);
});

test("canonical compilation snapshots cover every workflow input and reject stale async snapshots", async () => {
  const { directorCompilationSnapshot, directorCompilationIsCurrent } = await directorModule();
  const base = {
    draft: {
      language: "en",
      mode: "REF2VA",
      totalDurationSeconds: 5,
      segmentDurationSeconds: 5,
      characterBible: "character",
      worldBible: "world",
      visualStyleBible: "style",
      continuity: "continuity",
      shots: [{
        id: "shot-a",
        startSeconds: 0,
        durationSeconds: 5,
        description: "description",
        cameraLanguage: "camera",
        soundCue: "sound",
        transitionNote: "transition"
      }],
      overallSoundscape: "soundscape",
      nonDiegeticMusic: "music",
      subjectDefinitions: "subjects",
      summary: "summary",
      retentionAnalysis: "retention",
      styleOpening: "opening"
    },
    workflowName: "workflow",
    canvas: "16:9",
    resolutionMegapixels: 0.4,
    seed: 1,
    samplingProfile: "quality_20",
    firstFrameSelectionId: "frame-first",
    lastFrameSelectionId: "frame-last"
  };
  const submitted = directorCompilationSnapshot(base);
  assert.match(submitted, /"workflowName":"workflow"/u);
  const variants = [
    { ...base, workflowName: "workflow-2" },
    { ...base, canvas: "9:16" },
    { ...base, resolutionMegapixels: 0.98 },
    { ...base, seed: 2 },
    { ...base, samplingProfile: "turbo_8" },
    { ...base, firstFrameSelectionId: "frame-first-2" },
    { ...base, lastFrameSelectionId: null },
    { ...base, draft: { ...base.draft, language: "zh" } },
    { ...base, draft: { ...base.draft, mode: "FL2VA" } },
    { ...base, draft: { ...base.draft, totalDurationSeconds: 10 } },
    { ...base, draft: { ...base.draft, segmentDurationSeconds: 10 } },
    { ...base, draft: { ...base.draft, characterBible: "changed" } },
    { ...base, draft: { ...base.draft, worldBible: "changed" } },
    { ...base, draft: { ...base.draft, visualStyleBible: "changed" } },
    { ...base, draft: { ...base.draft, continuity: "changed" } },
    { ...base, draft: { ...base.draft, overallSoundscape: "changed" } },
    { ...base, draft: { ...base.draft, nonDiegeticMusic: "changed" } },
    { ...base, draft: { ...base.draft, subjectDefinitions: "changed" } },
    { ...base, draft: { ...base.draft, summary: "changed" } },
    { ...base, draft: { ...base.draft, retentionAnalysis: "changed" } },
    { ...base, draft: { ...base.draft, styleOpening: "changed" } },
    { ...base, draft: { ...base.draft, shots: [{ ...base.draft.shots[0], description: "changed" }] } },
    { ...base, draft: { ...base.draft, shots: [{ ...base.draft.shots[0], cameraLanguage: "changed" }] } },
    { ...base, draft: { ...base.draft, shots: [{ ...base.draft.shots[0], soundCue: "changed" }] } },
    { ...base, draft: { ...base.draft, shots: [{ ...base.draft.shots[0], transitionNote: "changed" }] } }
  ];
  for (const variant of variants) {
    const current = directorCompilationSnapshot(variant);
    assert.notEqual(current, submitted);
    assert.equal(directorCompilationIsCurrent(submitted, current), false);
  }
  assert.equal(directorCompilationIsCurrent(submitted, submitted), true);
  assert.equal(directorCompilationIsCurrent("", submitted), false);
});

test("a 30 second plan serializes six literal Chinese shots at exact boundaries", async () => {
  const { directorSegmentPlan, serializeDirectorPrompt } = await directorModule();
  const plan = directorSegmentPlan(30, 5).map((shot, index) => ({ ...shot, description: `用户镜头-${index + 1}` }));
  const result = serializeDirectorPrompt({
    language: "zh",
    mode: "T2V",
    totalDurationSeconds: 30,
    segmentDurationSeconds: 5,
    continuity: "黄色雨衣保持一致",
    shots: plan,
    overallSoundscape: "雨声",
    nonDiegeticMusic: "无",
    subjectDefinitions: "",
    summary: "",
    retentionAnalysis: "",
    styleOpening: ""
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.segmentCount, 6);
  assert.match(result.prompt, /^综合多模态描述:/u);
  assert.match(result.prompt, /\[镜头 2\] 在 00:05\.000，用户镜头-2/u);
  assert.match(result.prompt, /\[镜头 6\] 在 00:25\.000，用户镜头-6/u);
  assert.equal((result.prompt.match(/黄色雨衣保持一致/gu) ?? []).length, 6);
  assert.doesNotMatch(result.prompt, /用户镜头-7/u);
});

test("English FL2VA and Ref2VA use deterministic official field contracts", async () => {
  const { directorSegmentPlan, serializeDirectorPrompt } = await directorModule();
  const flPlan = directorSegmentPlan(15, 5).map((shot, index) => ({ ...shot, description: `literal-${index + 1}` }));
  const fl = serializeDirectorPrompt({
    language: "en",
    mode: "FL2VA",
    totalDurationSeconds: 15,
    segmentDurationSeconds: 5,
    continuity: "same coat",
    shots: flPlan,
    overallSoundscape: "rain",
    nonDiegeticMusic: "none",
    subjectDefinitions: "",
    summary: "",
    retentionAnalysis: "",
    styleOpening: ""
  });
  assert.deepEqual(fl.errors, []);
  assert.match(fl.prompt, /integrated_multimodal_description:/u);
  assert.match(fl.prompt, /\[Shot 3\] At 00:10\.000, literal-3/u);
  assert.match(fl.prompt, /overall_soundscape: rain/u);

  const ref = serializeDirectorPrompt({
    language: "zh",
    mode: "REF2VA",
    totalDurationSeconds: 5,
    segmentDurationSeconds: 5,
    continuity: "",
    shots: [{ startSeconds: 0, durationSeconds: 5, description: "<主体 1> 留在 <图片 1> 所示场景中" }],
    overallSoundscape: "脚步声",
    nonDiegeticMusic: "无",
    subjectDefinitions: "<主体 1> 由 <图片 1> 定义",
    summary: "[reference generation] 保持 <主体 1> 一致。",
    retentionAnalysis: "<主体 1>: fully_preserved - 保留身份与服装。",
    styleOpening: "真人实拍、电影感。"
  });
  assert.deepEqual(ref.errors, []);
  for (const heading of ["主体定义:", "摘要:", "参考保留分析:", "详细描述:", "整体声景:", "画外配乐:"]) {
    assert.ok(ref.prompt.includes(heading));
  }
});

test("director validation refuses empty segments and unsupported long Ref2VA", async () => {
  const { directorSegmentPlan, serializeDirectorPrompt } = await directorModule();
  const plan = directorSegmentPlan(30, 5);
  const result = serializeDirectorPrompt({
    language: "zh",
    mode: "REF2VA",
    totalDurationSeconds: 30,
    segmentDurationSeconds: 5,
    continuity: "",
    shots: plan,
    overallSoundscape: "",
    nonDiegeticMusic: "",
    subjectDefinitions: "",
    summary: "",
    retentionAnalysis: "",
    styleOpening: ""
  });
  assert.ok(result.errors.some((message) => message.includes("镜头 1")));
  assert.ok(result.errors.some((message) => message.includes("仅支持不超过 15 秒")));
  assert.ok(result.errors.some((message) => message.includes("主体定义")));
});

test("director shot-memory keys isolate segment plans but survive total-duration changes", async () => {
  const {
    directorSegmentPlan,
    directorShotIdentityKey,
    directorShotMemoryKey,
    uniqueDirectorShotId
  } = await directorModule();
  const keys = [5, 10, 15].map((segmentSeconds) => directorShotMemoryKey(
    "T2V",
    30,
    segmentSeconds,
    0,
    segmentSeconds
  ));
  assert.equal(new Set(keys).size, 3);
  assert.notEqual(
    directorShotMemoryKey("T2V", 30, 5, 0, 5),
    directorShotMemoryKey("FL2VA", 30, 5, 0, 5)
  );
  assert.equal(
    directorShotMemoryKey("T2V", 30, 5, 0, 5),
    directorShotMemoryKey("T2V", 60, 5, 0, 5)
  );
  const firstSixAt30 = directorSegmentPlan(30, 5).map((shot) => directorShotIdentityKey(
    "T2V", 5, shot.startSeconds, shot.durationSeconds
  ));
  const firstSixAt60 = directorSegmentPlan(60, 5).slice(0, 6).map((shot) => directorShotIdentityKey(
    "T2V", 5, shot.startSeconds, shot.durationSeconds
  ));
  assert.deepEqual(firstSixAt60, firstSixAt30);
  assert.ok(firstSixAt30.every((key) => !key.includes(":30:") && !key.includes(":60:")));

  const usedIds = new Set(["shot-duplicate", "shot-generated"]);
  assert.equal(uniqueDirectorShotId("shot-kept", usedIds, () => "shot-unused"), "shot-kept");
  assert.equal(uniqueDirectorShotId("shot-duplicate", usedIds, () => "shot-fresh"), "shot-fresh");
  const generatedCandidates = ["invalid", "shot-generated", "shot-repaired"];
  assert.equal(uniqueDirectorShotId("legacy-id", usedIds, () => generatedCandidates.shift()), "shot-repaired");
});

test("blank optional audio fields stay blank in every certified director mode and segment length", async () => {
  const { directorSegmentPlan, serializeDirectorPrompt } = await directorModule();
  const segmentLengths = [5, 10, 15];
  const baseModes = [
    ["T2V", "t2v", {}],
    ["FL2VA", "first_last_frame", {
      endpoints: { first_frame: "input/first.png", last_frame: "input/last.png" }
    }]
  ];

  for (const [directorMode, projectMode, projectExtras] of baseModes) {
    for (const segmentSeconds of segmentLengths) {
      const shots = directorSegmentPlan(30, segmentSeconds).map((shot, index) => ({
        ...shot,
        description: `literal-${directorMode}-${segmentSeconds}-${index + 1}`
      }));
      const serialized = serializeDirectorPrompt({
        language: "en",
        mode: directorMode,
        totalDurationSeconds: 30,
        segmentDurationSeconds: segmentSeconds,
        continuity: "",
        shots,
        overallSoundscape: "   ",
        nonDiegeticMusic: "",
        subjectDefinitions: "",
        summary: "",
        retentionAnalysis: "",
        styleOpening: ""
      });
      assert.deepEqual(serialized.errors, []);
      assert.match(serialized.prompt, /overall_soundscape:[ \t]*\r?\n\r?\nnon_diegetic_music:[ \t]*$/u);
      assert.doesNotMatch(serialized.prompt, /N\/A/u);

      const compilation = await compileProject({
        schema_version: "1.0.0",
        prompt: serialized.prompt,
        mode: projectMode,
        duration: 30,
        segment_duration: segmentSeconds,
        canvas: "16:9",
        resolution_megapixels: 0.4,
        ...projectExtras
      });
      assert.equal(compilation.plan.requested_segment_duration, segmentSeconds);
      assert.ok(compilation.workflows.length > 0);
      const boundPrompts = compilation.workflows.flatMap(({ workflow }) => workflow.nodes
        .map((node) => node.widgets_values_named?.prompt)
        .filter((prompt) => typeof prompt === "string" && prompt.includes("overall_soundscape")));
      assert.ok(boundPrompts.length > 0);
      for (const prompt of boundPrompts) {
        assert.match(prompt, /overall_soundscape:/u);
        assert.match(prompt, /non_diegetic_music:/u);
        assert.doesNotMatch(prompt, /N\/A/u);
      }
    }
  }

  for (const durationSeconds of segmentLengths) {
    const serialized = serializeDirectorPrompt({
      language: "zh",
      mode: "REF2VA",
      totalDurationSeconds: durationSeconds,
      segmentDurationSeconds: durationSeconds,
      continuity: "",
      shots: [{
        startSeconds: 0,
        durationSeconds,
        description: "<主体 1> 留在 <图片 1> 所示场景中。"
      }],
      overallSoundscape: "",
      nonDiegeticMusic: "\n",
      subjectDefinitions: "<主体 1> 来自 <图片 1>。",
      summary: "[reference generation] 目标视频保持 <主体 1> 一致。",
      retentionAnalysis: "<主体 1>: fully_preserved - 保持身份与服装一致。",
      styleOpening: "真人实拍、电影级写实风格。"
    });
    assert.deepEqual(serialized.errors, []);
    assert.match(serialized.prompt, /整体声景:[ \t]*\r?\n\r?\n画外配乐:[ \t]*$/u);
    assert.doesNotMatch(serialized.prompt, /N\/A/u);

    const compilation = await compileProject({
      schema_version: "1.0.0",
      prompt: serialized.prompt,
      mode: "ref2va",
      duration: durationSeconds,
      segment_duration: durationSeconds,
      canvas: "16:9",
      resolution_megapixels: 0.4,
      endpoints: { reference_images: ["input/reference.png"] }
    });
    assert.equal(compilation.workflows.length, 1);
    assert.equal(compilation.workflows[0].lint.ok, true);
    const call = compilation.workflows[0].workflow.nodes
      .find((node) => node.type === "MiniMaxH3ReferenceToVideo");
    assert.ok(call);
    assert.match(call.widgets_values_named.prompt, /overall_soundscape:/u);
    assert.match(call.widgets_values_named.prompt, /non_diegetic_music:/u);
    assert.doesNotMatch(call.widgets_values_named.prompt, /N\/A/u);
  }
});

test("Ref2VA serializer enforces official subject, summary, retention, and style-opening contracts", async () => {
  const { serializeDirectorPrompt } = await directorModule();
  const valid = {
    language: "zh",
    mode: "REF2VA",
    totalDurationSeconds: 5,
    segmentDurationSeconds: 5,
    continuity: "",
    shots: [{ startSeconds: 0, durationSeconds: 5, description: "<主体 1> 留在 <图片 1> 所示场景中。" }],
    overallSoundscape: "稳定的环境声。",
    nonDiegeticMusic: "无",
    subjectDefinitions: "<主体 1> 来自 <图片 1>。",
    summary: "[reference generation] 目标视频保持 <主体 1> 一致。",
    retentionAnalysis: "<主体 1>: fully_preserved - 保持身份与服装一致。",
    styleOpening: "真人实拍、电影级写实风格。"
  };

  assert.deepEqual(serializeDirectorPrompt(valid).errors, []);
  const cases = [
    [{ ...valid, summary: "保持主体一致。" }, "官方英文任务类型"],
    [{ ...valid, retentionAnalysis: "保留身份与服装。" }, "官方关系格式"],
    [{ ...valid, styleOpening: "" }, "风格开场"],
    [{ ...valid, subjectDefinitions: "这是参考主体。" }, "至少一个"],
    [{ ...valid, shots: [{ ...valid.shots[0], description: "<主体 2> 行走。" }] }, "未声明"],
    [{ ...valid, styleOpening: "电影感。[镜头 1] 不应手写标记。" }, "镜头编号由专业导播生成"],
    [{ ...valid, subjectDefinitions: "<主体 1> 来自 <视频 1>。" }, "只绑定参考图片"]
  ];
  for (const [draft, expectedMessage] of cases) {
    assert.ok(
      serializeDirectorPrompt(draft).errors.some((message) => message.includes(expectedMessage)),
      `expected Ref2VA validation error containing ${expectedMessage}`
    );
  }
});

test("a valid Director Ref2VA prompt compiles through the real pinned H3 compiler", async () => {
  const { serializeDirectorPrompt } = await directorModule();
  const serialized = serializeDirectorPrompt({
    language: "zh",
    mode: "REF2VA",
    totalDurationSeconds: 5,
    segmentDurationSeconds: 5,
    continuity: "外观与服装保持一致。",
    shots: [{ startSeconds: 0, durationSeconds: 5, description: "<主体 1> 留在 <图片 1> 所示场景中。" }],
    overallSoundscape: "稳定的室内环境声。",
    nonDiegeticMusic: "无",
    subjectDefinitions: "<主体 1> 来自 <图片 1>。",
    summary: "[reference generation] 目标视频保持 <主体 1> 一致。",
    retentionAnalysis: "<主体 1>: fully_preserved - 保持身份与服装一致。",
    styleOpening: "真人实拍、电影级写实风格。"
  });
  assert.deepEqual(serialized.errors, []);

  const compilation = await compileProject({
    schema_version: "1.0.0",
    prompt: serialized.prompt,
    mode: "ref2va",
    duration: 5,
    segment_duration: 5,
    canvas: "16:9",
    resolution_megapixels: 0.4,
    advanced: { seed: 1, seed_policy: "fixed", sampling_profile: "quality_20" },
    endpoints: { reference_images: ["input/reference.png"] }
  });
  assert.equal(compilation.workflows.length, 1);
  assert.equal(compilation.workflows[0].lint.ok, true);
  assert.equal(compilation.workflows[0].lint.template_kind, "r2v");
  const call = compilation.workflows[0].workflow.nodes.find((node) => node.type === "MiniMaxH3ReferenceToVideo");
  assert.ok(call);
  assert.match(call.widgets_values_named.prompt, /detailed_description:\n真人实拍、电影级写实风格。\n\[Shot 1\]/u);
  assert.match(call.widgets_values_named.prompt, /<Subject 1>/u);
  assert.match(call.widgets_values_named.prompt, /<Picture 1>/u);
});

test("serializer blocks malformed base shot bodies before the real compiler rejects them", async () => {
  const { serializeDirectorPrompt } = await directorModule();
  const draft = (mode, description, totalDurationSeconds = 5) => ({
    language: "en",
    mode,
    totalDurationSeconds,
    segmentDurationSeconds: 5,
    continuity: "",
    shots: Array.from({ length: totalDurationSeconds / 5 }, (_, index) => ({
      startSeconds: index * 5,
      durationSeconds: 5,
      description: index === 0 ? description : `ordinary scene ${index + 1}`
    })),
    overallSoundscape: "Stable room tone.",
    nonDiegeticMusic: "N/A",
    subjectDefinitions: "",
    summary: "",
    retentionAnalysis: "",
    styleOpening: ""
  });
  const invalidCases = [
    {
      draft: draft("T2V", "Opening scene. [Shot 2] hidden extra shot."),
      project: { mode: "t2v" },
      error: "镜头编号由专业导播生成"
    },
    {
      draft: draft("T2V", "Opening scene.\noverall_soundscape: injected field."),
      project: { mode: "t2v" },
      error: "官方字段标题"
    },
    {
      draft: draft("T2V", "At 00:00.000, opening scene."),
      project: { mode: "t2v" },
      error: "切点由分段边界生成"
    },
    {
      draft: draft("T2V", "Begin from <Picture 1>."),
      project: { mode: "t2v" },
      error: "不能手写"
    },
    {
      draft: draft("FL2VA", "Begin from unsupported <Picture 2>."),
      project: { mode: "first_frame", endpoints: { first_frame: "input/first.png" } },
      error: "不能手写"
    }
  ];

  for (const invalid of invalidCases) {
    const serialized = serializeDirectorPrompt(invalid.draft);
    assert.ok(
      serialized.errors.some((message) => message.includes(invalid.error)),
      `expected early serializer error containing ${invalid.error}`
    );
    await assert.rejects(
      () => compileProject({
        schema_version: "1.0.0",
        prompt: serialized.prompt,
        duration: invalid.draft.totalDurationSeconds,
        segment_duration: invalid.draft.segmentDurationSeconds,
        canvas: "16:9",
        resolution_megapixels: 0.4,
        ...invalid.project
      }),
      (error) => typeof error?.code === "string" && error.code.startsWith("PROJECT.")
    );
  }
});
