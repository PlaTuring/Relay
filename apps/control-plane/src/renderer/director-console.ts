export type DirectorLanguage = "zh" | "en";
export type DirectorMode = "T2V" | "FL2VA" | "REF2VA";

export interface DirectorShot {
  readonly id?: string;
  readonly startSeconds: number;
  readonly durationSeconds: number;
  readonly description: string;
  readonly cameraLanguage?: string;
  readonly soundCue?: string;
  readonly transitionNote?: string;
}

export interface DirectorDraft {
  readonly language: DirectorLanguage;
  readonly mode: DirectorMode;
  readonly totalDurationSeconds: number;
  readonly segmentDurationSeconds: number;
  readonly characterBible?: string;
  readonly worldBible?: string;
  readonly visualStyleBible?: string;
  readonly continuity: string;
  readonly shots: readonly DirectorShot[];
  readonly overallSoundscape: string;
  readonly nonDiegeticMusic: string;
  readonly subjectDefinitions: string;
  readonly summary: string;
  readonly retentionAnalysis: string;
  readonly styleOpening: string;
}

export interface DirectorPromptResult {
  readonly prompt: string;
  readonly errors: readonly string[];
  readonly segmentCount: number;
}

export interface DirectorCompilationInputs {
  readonly draft: DirectorDraft;
  readonly workflowName: string;
  readonly canvas: string;
  readonly resolutionMegapixels: number;
  readonly seed: number;
  readonly seedPolicy?: "fixed" | "random_per_compile";
  readonly samplingProfile: string;
  readonly firstFrameSelectionId: string | null;
  readonly lastFrameSelectionId: string | null;
}

const OFFICIAL_FIELD_HEADER = /(^|\r?\n)[\t ]*(integrated_multimodal_description|综合多模态描述|综合多模态说明|overall_soundscape|整体声景|整体声音景观|non_diegetic_music|非叙事音乐|非剧情音乐|画外配乐|subject_definitions|主体定义|summary|摘要|总结|retention_analysis|保留分析|参考保留分析|detailed_description|详细描述)[\t ]*[:：]/imu;
const SHOT_MARKER = /[\[［【][\t ]*(?:镜头|shot)[\t ]*[\p{N}]+[\t ]*[\]］】]/iu;
const OPENING_CUT_CLOCK = /^(?:at|在)[\t ]*[\p{N}]{2,3}[:：][\p{N}]{2}(?:[.．][\p{N}]{1,3})?(?![\p{N}.．])/iu;
const REFERENCE_LABEL = /<[\t ]*(Picture|图片|Video|视频|Audio|音频|Subject|主体)[\t ]*([\p{N}]+)[\t ]*>/giu;
const CANONICAL_REFERENCE_LABEL = /<(Subject|Picture|Video|Audio)[\t ]+([0-9]+)>/giu;
const REF_TASK_TYPES = Object.freeze(new Set([
  "keyframe completion",
  "reference generation",
  "video editing",
  "video continuation",
  "audio reuse",
  "audio reference"
]));
const RETENTION_LINE = /^<(Subject|Picture|Video|Audio)[\t ]+[0-9]+>(?:[\t ]*\([^\r\n]*\))?[\t ]*:[\t ]*(fully_preserved|partially_preserved|attribute_transfer|weak_reference|fully_copy|partially_copy|reference)[\t ]*-[\t ]*\S[^\r\n]*$/iu;
const DIRECTOR_SHOT_DURATIONS = Object.freeze(new Set([5, 10, 15]));

function asciiDigits(value: string): string {
  return value.normalize("NFKC").replace(
    /[０-９]/gu,
    (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xFEE0)
  );
}

function normalizeReferenceLabels(value: string): string {
  const types: Readonly<Record<string, string>> = Object.freeze({
    picture: "Picture",
    图片: "Picture",
    video: "Video",
    视频: "Video",
    audio: "Audio",
    音频: "Audio",
    subject: "Subject",
    主体: "Subject"
  });
  return value.replace(REFERENCE_LABEL, (match, type: string, number: string) => {
    const canonical = types[type.toLowerCase()] ?? types[type];
    return canonical === undefined ? match : `<${canonical} ${asciiDigits(number)}>`;
  });
}

function referenceLabels(value: string): readonly string[] {
  const normalized = normalizeReferenceLabels(value);
  return Object.freeze([...normalized.matchAll(CANONICAL_REFERENCE_LABEL)]
    .map((match) => `<${match[1]} ${match[2]}>`));
}

function pushUnique(errors: string[], message: string): void {
  if (!errors.includes(message)) errors.push(message);
}

export function directorShotMemoryKey(
  mode: DirectorMode,
  _totalSeconds: number,
  segmentSeconds: number,
  startSeconds: number,
  durationSeconds: number
): string {
  // A shot keeps its identity when the project tail grows or shrinks. Total
  // duration therefore must not participate in the memory key; otherwise a
  // 30 -> 60 second edit appears to erase the first six five-second shots.
  return directorShotIdentityKey(mode, segmentSeconds, startSeconds, durationSeconds);
}

export function directorShotIdentityKey(
  mode: DirectorMode,
  segmentSeconds: number,
  startSeconds: number,
  durationSeconds: number
): string {
  return `${mode}:${segmentSeconds}:${startSeconds}:${durationSeconds}`;
}

export function uniqueDirectorShotId(
  candidateId: unknown,
  usedIds: ReadonlySet<string>,
  createId: () => string
): string {
  if (typeof candidateId === "string" && candidateId.startsWith("shot-") && !usedIds.has(candidateId)) {
    return candidateId;
  }
  let generated: string;
  do {
    generated = createId();
  } while (!generated.startsWith("shot-") || usedIds.has(generated));
  return generated;
}

export function directorSegmentPlan(totalSeconds: number, segmentSeconds: number): readonly DirectorShot[] {
  if (!Number.isSafeInteger(totalSeconds) || !Number.isSafeInteger(segmentSeconds)
    || totalSeconds <= 0 || !DIRECTOR_SHOT_DURATIONS.has(segmentSeconds)) return Object.freeze([]);
  const segments: DirectorShot[] = [];
  for (let start = 0; start < totalSeconds; start += segmentSeconds) {
    const durationSeconds = Math.min(segmentSeconds, totalSeconds - start);
    if (!DIRECTOR_SHOT_DURATIONS.has(durationSeconds)) return Object.freeze([]);
    segments.push(Object.freeze({
      startSeconds: start,
      durationSeconds,
      description: ""
    }));
  }
  return Object.freeze(segments);
}

export function directorClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}.000`;
}

function trimmed(value: string): string {
  return value.trim();
}

function optionalAudioField(value: string): string {
  return trimmed(value);
}

function deterministicFingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function directorShotFingerprint(draft: DirectorDraft, shot: DirectorShot): string {
  return deterministicFingerprint(JSON.stringify({
    language: draft.language,
    mode: draft.mode,
    startSeconds: shot.startSeconds,
    durationSeconds: shot.durationSeconds,
    description: shot.description,
    cameraLanguage: shot.cameraLanguage ?? "",
    soundCue: shot.soundCue ?? "",
    transitionNote: shot.transitionNote ?? "",
    characterBible: draft.characterBible ?? "",
    worldBible: draft.worldBible ?? "",
    visualStyleBible: draft.visualStyleBible ?? "",
    continuity: draft.continuity,
    overallSoundscape: draft.overallSoundscape,
    nonDiegeticMusic: draft.nonDiegeticMusic
  }));
}

export function directorCompilationSnapshot(inputs: DirectorCompilationInputs): string {
  const draft = inputs.draft;
  return JSON.stringify({
    workflowName: inputs.workflowName.trim(),
    language: draft.language,
    mode: draft.mode,
    totalDurationSeconds: draft.totalDurationSeconds,
    segmentDurationSeconds: draft.segmentDurationSeconds,
    characterBible: draft.characterBible ?? "",
    worldBible: draft.worldBible ?? "",
    visualStyleBible: draft.visualStyleBible ?? "",
    continuity: draft.continuity,
    shots: draft.shots.map((shot) => ({
      startSeconds: shot.startSeconds,
      durationSeconds: shot.durationSeconds,
      description: shot.description,
      cameraLanguage: shot.cameraLanguage ?? "",
      soundCue: shot.soundCue ?? "",
      transitionNote: shot.transitionNote ?? ""
    })),
    overallSoundscape: draft.overallSoundscape,
    nonDiegeticMusic: draft.nonDiegeticMusic,
    subjectDefinitions: draft.subjectDefinitions,
    summary: draft.summary,
    retentionAnalysis: draft.retentionAnalysis,
    styleOpening: draft.styleOpening,
    canvas: inputs.canvas,
    resolutionMegapixels: inputs.resolutionMegapixels,
    seed: inputs.seed,
    seedPolicy: inputs.seedPolicy ?? "fixed",
    samplingProfile: inputs.samplingProfile,
    firstFrameSelectionId: inputs.firstFrameSelectionId,
    lastFrameSelectionId: inputs.lastFrameSelectionId
  });
}

export function directorCompilationIsCurrent(
  submittedSnapshot: string,
  currentSnapshot: string
): boolean {
  return submittedSnapshot.length > 0 && submittedSnapshot === currentSnapshot;
}

function shotBody(draft: DirectorDraft, shot: DirectorShot): string {
  const body = trimmed(shot.description);
  const optionalParts = [
    draft.characterBible ?? "",
    draft.worldBible ?? "",
    draft.visualStyleBible ?? "",
    shot.cameraLanguage ?? "",
    shot.soundCue ?? "",
    shot.transitionNote ?? "",
    draft.continuity
  ] as const;
  const parts = [body];
  for (const value of optionalParts) {
    const content = trimmed(value);
    if (content.length > 0) parts.push(content);
  }
  return parts.join("\n\n");
}

function timeline(draft: DirectorDraft): string {
  return draft.shots.map((shot, index) => {
    const marker = draft.language === "zh" ? `[镜头 ${index + 1}]` : `[Shot ${index + 1}]`;
    const time = index === 0
      ? " "
      : draft.language === "zh"
        ? ` 在 ${directorClock(shot.startSeconds)}，`
        : ` At ${directorClock(shot.startSeconds)}, `;
    return `${marker}${time}${shotBody(draft, shot)}`;
  }).join("\n\n");
}

function validateNoFieldInjection(value: string, label: string, errors: string[]): void {
  if (OFFICIAL_FIELD_HEADER.test(value)) {
    errors.push(`${label}不能在行首重复写入官方字段标题。`);
  }
}

function validateShotLikeText(
  value: string,
  label: string,
  mode: DirectorMode,
  errors: string[],
  options: { readonly openingClock: boolean }
): void {
  const body = trimmed(value);
  if (SHOT_MARKER.test(body)) {
    errors.push(`${label}不能包含 [Shot N] 或 [镜头 N] 标记；镜头编号由专业导播生成。`);
  }
  validateNoFieldInjection(body, label, errors);
  if (options.openingClock && OPENING_CUT_CLOCK.test(body)) {
    errors.push(`${label}不能自行填写 At/在 MM:SS.mmm 切点；切点由分段边界生成。`);
  }
  if (mode !== "REF2VA" && referenceLabels(body).length > 0) {
    errors.push(`${label}不能手写 Picture/Subject/Video/Audio 引用标签；文字与首尾帧模式的图片绑定由工作流编译器生成。`);
  }
}

function validateReferenceContract(draft: DirectorDraft, errors: string[]): void {
  const definitions = trimmed(draft.subjectDefinitions);
  const summary = trimmed(draft.summary);
  const retention = trimmed(draft.retentionAnalysis);
  const opening = trimmed(draft.styleOpening);

  if (definitions.length === 0) {
    errors.push("Ref2VA 需要填写主体定义。");
  } else {
    const definedLabels = new Set(referenceLabels(definitions));
    if (definedLabels.size === 0) {
      errors.push("Ref2VA 主体定义必须声明至少一个 <Subject N> 或 <Picture N> 引用标签。");
    }
  }

  if (summary.length === 0) {
    errors.push("Ref2VA 需要填写摘要。");
  } else {
    const normalizedSummary = normalizeReferenceLabels(summary);
    const prefix = normalizedSummary.match(/^\[([^\]]+)\][\t ]+\S/iu);
    const taskTypes = prefix?.[1]?.split("+").map((value) => value.trim().toLowerCase()) ?? [];
    if (taskTypes.length === 0
      || new Set(taskTypes).size !== taskTypes.length
      || taskTypes.some((value) => !REF_TASK_TYPES.has(value))) {
      errors.push("Ref2VA 摘要必须以官方英文任务类型开头，例如 [reference generation]；多类型用 + 连接且不能重复。");
    }
  }

  if (retention.length === 0) {
    errors.push("Ref2VA 需要填写参考保留分析。");
  } else {
    const lines = normalizeReferenceLabels(retention)
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0 || lines.some((line) => !RETENTION_LINE.test(line))) {
      errors.push("Ref2VA 保留分析的每一行都必须使用“<Subject N>: fully_preserved - 说明”这类官方关系格式。");
    }
  }

  if (opening.length === 0) {
    errors.push("Ref2VA 详细描述需要在 [Shot 1]/[镜头 1] 前填写非空的风格开场。");
  } else {
    validateShotLikeText(opening, "Ref2VA 风格开场", draft.mode, errors, { openingClock: true });
  }

  if (definitions.length === 0) return;
  const definedLabels = new Set(referenceLabels(definitions));
  const referenceValues = [
    definitions,
    summary,
    retention,
    opening,
    draft.continuity,
    draft.characterBible ?? "",
    draft.worldBible ?? "",
    draft.visualStyleBible ?? "",
    ...draft.shots.map((shot) => shot.description),
    ...draft.shots.flatMap((shot) => [shot.cameraLanguage ?? "", shot.soundCue ?? "", shot.transitionNote ?? ""]),
    draft.overallSoundscape,
    draft.nonDiegeticMusic
  ];
  for (const label of new Set(referenceValues.flatMap((value) => [...referenceLabels(value)]))) {
    const match = label.match(/^<(Subject|Picture|Video|Audio) ([0-9]+)>$/u);
    if (match === null) continue;
    if (Number(match[2]) < 1) {
      pushUnique(errors, `Ref2VA 引用标签编号必须从 1 开始：${label}。`);
    }
    if (match[1] === "Video" || match[1] === "Audio") {
      pushUnique(errors, `当前 Ref2VA 工作流只绑定参考图片，不能使用 ${label}。`);
    }
    if (!definedLabels.has(label)) {
      pushUnique(errors, `Ref2VA 使用了主体定义中未声明的引用标签：${label}。`);
    }
  }
}

function validateDraft(draft: DirectorDraft): string[] {
  const errors: string[] = [];
  if (!DIRECTOR_SHOT_DURATIONS.has(draft.segmentDurationSeconds)) {
    errors.push("快速分段时长必须是 5、10 或 15 秒。");
  }
  if (draft.shots.length === 0) errors.push("至少需要一个镜头。");
  let expectedStart = 0;
  draft.shots.forEach((shot, index) => {
    if (!DIRECTOR_SHOT_DURATIONS.has(shot.durationSeconds)) {
      errors.push(`镜头 ${index + 1} 的时长必须是 5、10 或 15 秒。`);
    }
    if (shot.startSeconds !== expectedStart) {
      errors.push(`镜头 ${index + 1} 的开始时间应为 ${directorClock(expectedStart)}，镜头必须按顺序连续。`);
    }
    expectedStart += shot.durationSeconds;
    if (trimmed(shot.description).length === 0) {
      errors.push(`请填写镜头 ${index + 1} 的内容。`);
    } else {
      validateShotLikeText(shot.description, `镜头 ${index + 1} 正文`, draft.mode, errors, { openingClock: true });
    }
    for (const [label, value] of [
      [`镜头 ${index + 1} 镜头语言`, shot.cameraLanguage ?? ""],
      [`镜头 ${index + 1} 声音提示`, shot.soundCue ?? ""],
      [`镜头 ${index + 1} 转场与连续性备注`, shot.transitionNote ?? ""]
    ] as const) {
      if (trimmed(value).length > 0) {
        validateShotLikeText(value, label, draft.mode, errors, { openingClock: false });
      }
    }
  });
  if (draft.totalDurationSeconds !== expectedStart) {
    errors.push(`总时长必须等于各镜头时长之和（当前应为 ${expectedStart} 秒）。`);
  }
  for (const [label, value] of [
    ["角色、服装与道具参考", draft.characterBible ?? ""],
    ["场景与世界参考", draft.worldBible ?? ""],
    ["视觉风格参考", draft.visualStyleBible ?? ""]
  ] as const) {
    if (trimmed(value).length > 0) {
      validateShotLikeText(value, label, draft.mode, errors, { openingClock: false });
    }
  }
  if (trimmed(draft.continuity).length > 0) {
    validateShotLikeText(draft.continuity, "连续性约束", draft.mode, errors, { openingClock: false });
  }
  if (trimmed(draft.overallSoundscape).length > 0) {
    validateNoFieldInjection(draft.overallSoundscape, "整体声景", errors);
    if (draft.mode !== "REF2VA" && referenceLabels(draft.overallSoundscape).length > 0) {
      errors.push("整体声景不能手写引用标签；文字与首尾帧模式的图片绑定由工作流编译器生成。");
    }
  }
  if (trimmed(draft.nonDiegeticMusic).length > 0) {
    validateNoFieldInjection(draft.nonDiegeticMusic, "画外配乐", errors);
    if (draft.mode !== "REF2VA" && referenceLabels(draft.nonDiegeticMusic).length > 0) {
      errors.push("画外配乐不能手写引用标签；文字与首尾帧模式的图片绑定由工作流编译器生成。");
    }
  }
  if (draft.mode === "REF2VA") {
    if (draft.shots.length !== 1 || draft.totalDurationSeconds > 15) {
      errors.push("当前认证的 Ref2VA 工作流仅支持不超过 15 秒的单段计划。");
    }
    for (const [label, value] of [
      ["Ref2VA 主体定义", draft.subjectDefinitions],
      ["Ref2VA 摘要", draft.summary],
      ["Ref2VA 保留分析", draft.retentionAnalysis]
    ] as const) {
      validateNoFieldInjection(value, label, errors);
    }
    validateReferenceContract(draft, errors);
  }
  return errors;
}

export function serializeDirectorPrompt(draft: DirectorDraft): DirectorPromptResult {
  const errors = validateDraft(draft);
  const description = timeline(draft);
  const soundscape = optionalAudioField(draft.overallSoundscape);
  const music = optionalAudioField(draft.nonDiegeticMusic);
  let prompt: string;
  if (draft.mode === "REF2VA") {
    const opening = trimmed(draft.styleOpening);
    prompt = draft.language === "zh"
      ? `主体定义: ${trimmed(draft.subjectDefinitions)}\n\n摘要: ${trimmed(draft.summary)}\n\n参考保留分析: ${trimmed(draft.retentionAnalysis)}\n\n详细描述:\n${opening}\n${description}\n\n整体声景: ${soundscape}\n\n画外配乐: ${music}`
      : `subject_definitions: ${trimmed(draft.subjectDefinitions)}\n\nsummary: ${trimmed(draft.summary)}\n\nretention_analysis: ${trimmed(draft.retentionAnalysis)}\n\ndetailed_description:\n${opening}\n${description}\n\noverall_soundscape: ${soundscape}\n\nnon_diegetic_music: ${music}`;
  } else {
    prompt = draft.language === "zh"
      ? `综合多模态描述:\n${description}\n\n整体声景: ${soundscape}\n\n画外配乐: ${music}`
      : `integrated_multimodal_description:\n${description}\n\noverall_soundscape: ${soundscape}\n\nnon_diegetic_music: ${music}`;
  }
  if (prompt.length > 4000) errors.push(`编译后的提示词为 ${prompt.length} 个字符，超过 4000 字符上限。`);
  return Object.freeze({
    prompt,
    errors: Object.freeze(errors),
    segmentCount: draft.shots.length
  });
}
