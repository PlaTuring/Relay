import { fail } from "./errors.mjs";

const BASE_FIELD_ORDER = Object.freeze([
  "integrated_multimodal_description",
  "overall_soundscape",
  "non_diegetic_music",
]);
const REF_FIELD_ORDER = Object.freeze([
  "subject_definitions",
  "summary",
  "retention_analysis",
  "detailed_description",
  "overall_soundscape",
  "non_diegetic_music",
]);
const EMPTY_VALUE_FIELDS = Object.freeze(new Set([
  "overall_soundscape",
  "non_diegetic_music",
]));
const FIELD_ALIASES = new Map([
  ["integrated_multimodal_description", "integrated_multimodal_description"],
  ["综合多模态描述", "integrated_multimodal_description"],
  ["综合多模态说明", "integrated_multimodal_description"],
  ["overall_soundscape", "overall_soundscape"],
  ["整体声景", "overall_soundscape"],
  ["整体声音景观", "overall_soundscape"],
  ["non_diegetic_music", "non_diegetic_music"],
  ["非叙事音乐", "non_diegetic_music"],
  ["非剧情音乐", "non_diegetic_music"],
  ["画外配乐", "non_diegetic_music"],
  ["subject_definitions", "subject_definitions"],
  ["主体定义", "subject_definitions"],
  ["summary", "summary"],
  ["摘要", "summary"],
  ["总结", "summary"],
  ["retention_analysis", "retention_analysis"],
  ["保留分析", "retention_analysis"],
  ["参考保留分析", "retention_analysis"],
  ["detailed_description", "detailed_description"],
  ["详细描述", "detailed_description"],
]);
const FIELD_HEADER = /(^|\r?\n)[\t ]*(integrated_multimodal_description|综合多模态描述|综合多模态说明|overall_soundscape|整体声景|整体声音景观|non_diegetic_music|非叙事音乐|非剧情音乐|画外配乐|subject_definitions|主体定义|summary|摘要|总结|retention_analysis|保留分析|参考保留分析|detailed_description|详细描述)[\t ]*[:：][\t ]*/gimu;
const SHOT_MARKER = /[\[［【][\t ]*(镜头|shot)[\t ]*([\p{N}]+)[\t ]*[\]］】]/giu;
const SHOT_START_CLOCK = /^(?:at|[Ａａ][Ｔｔ]|在)[\t ]*([\p{N}]{2,3})[:：]([\p{N}]{2})(?:[.．]([\p{N}]{1,3}))?(?![\p{N}.．])/iu;
const CHINESE_VIDEO_END_SECONDS = /(视频[\t ]*在[\t ]*)([\p{N}]+(?:[.．][\p{N}]+)?)([\t ]*秒(?:时)?结束)/gu;
const ENGLISH_VIDEO_END_SECONDS = /((?:the[\t ]+)?video[\t ]+(?:ends|finishes)[\t ]+at[\t ]+)([\p{N}]+(?:[.．][\p{N}]+)?)([\t ]+seconds?\b)/giu;
const PROTECTED_PROMPT_TEXT = /<d>[\s\S]*?<\/d>|"[^"\r\n]*"/giu;
const REFERENCE_LABEL = /<[\t ]*(Picture|图片|Video|视频|Audio|音频|Subject|主体)[\t ]*([\p{N}]+)[\t ]*>/giu;
const CANONICAL_PICTURE_LABEL = /<Picture[\t ]+([0-9]+)>/giu;
const CANONICAL_REFERENCE_LABEL = /<(Subject|Picture|Video|Audio)[\t ]+([0-9]+)>/giu;
const REF_TASK_TYPES = Object.freeze(new Set([
  "keyframe completion",
  "reference generation",
  "video editing",
  "video continuation",
  "audio reuse",
  "audio reference",
]));
const RETENTION_LINE = /^<(Subject|Picture|Video|Audio)[\t ]+[0-9]+>(?:[\t ]*\([^\r\n]*\))?[\t ]*:[\t ]*(fully_preserved|partially_preserved|attribute_transfer|weak_reference|fully_copy|partially_copy|reference)[\t ]*-[\t ]*\S[^\r\n]*$/iu;

function canonicalField(value) {
  return FIELD_ALIASES.get(value.toLowerCase()) ?? FIELD_ALIASES.get(value) ?? null;
}

function asciiDigits(value) {
  return value.normalize("NFKC").replace(
    /[０-９]/gu,
    (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xFEE0),
  );
}

function asciiNumber(value) {
  return asciiDigits(value).replaceAll("．", ".");
}

function normalizeReferenceLabels(value) {
  const types = Object.freeze({
    picture: "Picture",
    图片: "Picture",
    video: "Video",
    视频: "Video",
    audio: "Audio",
    音频: "Audio",
    subject: "Subject",
    主体: "Subject",
  });
  return value.replace(REFERENCE_LABEL, (match, type, number) => {
    const canonical = types[String(type).toLowerCase()] ?? types[type];
    return canonical ? `<${canonical} ${asciiDigits(number)}>` : match;
  });
}

function unwrapPrompt(prompt) {
  const withoutBom = prompt.replace(/^\uFEFF/u, "");
  const fenced = withoutBom.match(/^[\t ]*```(?:text|txt|markdown|md)?[\t ]*\r?\n([\s\S]*?)\r?\n```[\t ]*$/iu);
  return fenced ? fenced[1] : withoutBom;
}

function clockPartsToMilliseconds(minutes, seconds, fraction = "") {
  const asciiMinutes = asciiDigits(minutes);
  const asciiSeconds = asciiDigits(seconds);
  const asciiFraction = asciiDigits(fraction);
  const milliseconds = asciiFraction.length === 0
    ? 0
    : Number(asciiFraction.padEnd(3, "0").slice(0, 3));
  return (Number(asciiMinutes) * 60 + Number(asciiSeconds)) * 1000 + milliseconds;
}

function formatClock(milliseconds) {
  const bounded = Math.max(0, Math.round(milliseconds));
  const minutes = Math.floor(bounded / 60_000);
  const seconds = Math.floor((bounded % 60_000) / 1000);
  const fraction = bounded % 1000;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(fraction).padStart(3, "0")}`;
}

function extractPromptDocument(prompt, mode) {
  const source = unwrapPrompt(prompt);
  const matches = [...source.matchAll(FIELD_HEADER)];
  if (matches.length === 0) return null;

  const fields = new Map();
  const encountered = [];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const key = canonicalField(match[2]);
    if (!key || fields.has(key)) {
      fail("PROJECT.PROMPT_FORMAT", "Prompt fields are duplicated or unsupported.", "/prompt");
    }
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? source.length;
    const value = source.slice(start, end).trim();
    if (value.length === 0 && !EMPTY_VALUE_FIELDS.has(key)) {
      fail("PROJECT.PROMPT_FORMAT", "Prompt fields other than soundscape and music must not be empty.", "/prompt");
    }
    fields.set(key, value);
    encountered.push(key);
  }

  const isReference = mode === "ref2va";
  const order = isReference ? REF_FIELD_ORDER : BASE_FIELD_ORDER;
  const allowed = new Set(order);
  if (encountered.some((key) => !allowed.has(key))) {
    fail("PROJECT.PROMPT_MODE_FORMAT", "Prompt fields do not match the selected H3 mode.", "/prompt");
  }
  let previous = -1;
  for (const key of encountered) {
    const current = order.indexOf(key);
    if (current <= previous) fail("PROJECT.PROMPT_FIELD_ORDER", "Prompt fields are not in official order.", "/prompt");
    previous = current;
  }

  const timelineField = isReference ? "detailed_description" : "integrated_multimodal_description";
  if (!fields.has(timelineField)) {
    fail("PROJECT.PROMPT_MODE_FORMAT", "The selected H3 mode is missing its official timeline field.", "/prompt");
  }
  if (!isReference && BASE_FIELD_ORDER.some((key) => !fields.has(key))) {
    fail("PROJECT.PROMPT_FORMAT", "Base H3 requires the official three-section prompt format.", "/prompt");
  }
  if (isReference && REF_FIELD_ORDER.some((key) => !fields.has(key))) {
    fail("PROJECT.PROMPT_FORMAT", "Ref2VA requires the official six-section prompt format.", "/prompt");
  }

  const preamble = source.slice(0, matches[0].index).trim();
  if (isReference && preamble.length > 0) {
    fail("PROJECT.PROMPT_FORMAT", "Ref2VA must begin with subject_definitions.", "/prompt");
  }
  if (!isReference && mode === "t2v" && preamble.length > 0) {
    fail("PROJECT.PROMPT_FORMAT", "T2V must begin with integrated_multimodal_description.", "/prompt");
  }
  if (!isReference && mode !== "t2v" && preamble.length > 0
    && !/(?:picture|<picture|图片|参考图)/iu.test(preamble)) {
    fail("PROJECT.PROMPT_FORMAT", "Keyframe prompt preamble is not an image-alignment instruction.", "/prompt");
  }

  return Object.freeze({
    kind: isReference ? "reference" : "base",
    fields,
    order,
    timelineField,
  });
}

function explicitShotStart(body) {
  const contextual = body.match(SHOT_START_CLOCK);
  return contextual ? clockPartsToMilliseconds(contextual[1], contextual[2], contextual[3]) : null;
}

function protectedRanges(value) {
  return [...value.matchAll(PROTECTED_PROMPT_TEXT)].map((match) => Object.freeze({
    start: match.index,
    end: match.index + match[0].length,
  }));
}

function isProtectedOffset(ranges, offset) {
  return ranges.some(({ start, end }) => offset >= start && offset < end);
}

function parseShots(description, kind) {
  const matches = [...description.matchAll(SHOT_MARKER)];
  if (matches.length === 0) return null;
  const intro = description.slice(0, matches[0].index).trim();
  if (kind === "base" && intro.length > 0) {
    fail("PROJECT.PROMPT_FORMAT", "Base-mode timeline must begin with [Shot 1] or [镜头 1].", "/prompt");
  }
  const shots = matches.map((match, index) => {
    const start = match.index + match[0].length;
    const end = matches[index + 1]?.index ?? description.length;
    const body = description.slice(start, end).trim();
    const explicitStart = explicitShotStart(body);
    if (index === 0 && explicitStart !== null) {
      fail("PROJECT.PROMPT_TIMELINE", "[Shot 1] must not contain a cut timestamp.", "/prompt");
    }
    return Object.freeze({
      marker_label: match[1],
      source_number: Number(asciiDigits(match[2])),
      body,
      explicit_start_ms: index === 0 ? 0 : explicitStart,
    });
  });
  if (shots.some((shot) => shot.body.length === 0)) {
    fail("PROJECT.PROMPT_FORMAT", "Every shot must contain a description.", "/prompt");
  }
  if (shots.some((shot, index) => shot.source_number !== index + 1)) {
    fail("PROJECT.PROMPT_FORMAT", "Shot numbers must begin at 1 and remain consecutive.", "/prompt");
  }
  return Object.freeze({ intro, shots: Object.freeze(shots) });
}

function validateProjectEndTimes(description, totalDurationMs) {
  const ranges = protectedRanges(description);
  const values = [];
  for (const expression of [CHINESE_VIDEO_END_SECONDS, ENGLISH_VIDEO_END_SECONDS]) {
    for (const match of description.matchAll(expression)) {
      if (isProtectedOffset(ranges, match.index)) continue;
      values.push(Number(asciiNumber(match[2])) * 1000);
    }
  }
  if (values.some((value) => !Number.isFinite(value) || value !== totalDurationMs)) {
    fail("PROJECT.PROMPT_TIMELINE", "An explicit video end time must match the selected project duration.", "/prompt");
  }
}

function timedShotStarts(shots, totalDurationMs) {
  const starts = shots.map((shot) => shot.explicit_start_ms);
  if (starts[0] !== 0 || starts.slice(1).some((value) => value === null)) return null;
  for (let index = 0; index < starts.length; index += 1) {
    if (starts[index] < 0 || starts[index] >= totalDurationMs) {
      fail("PROJECT.PROMPT_TIMELINE", "A shot starts outside the selected project duration.", "/prompt");
    }
    if (index > 0 && starts[index] <= starts[index - 1]) {
      fail("PROJECT.PROMPT_TIMELINE", "Shot cut times must be strictly increasing.", "/prompt");
    }
  }
  return starts;
}

function segmentBoundaries(plan) {
  let elapsed = 0;
  return plan.segments.map((segment) => {
    const start = elapsed;
    elapsed += segment.duration * 1000;
    return Object.freeze({ start, end: elapsed });
  });
}

function timedShotGroups(shots, starts, boundaries) {
  const groups = boundaries.map(() => []);
  for (let shotIndex = 0; shotIndex < shots.length; shotIndex += 1) {
    const segmentIndex = boundaries.findIndex(({ start, end }) => (
      starts[shotIndex] >= start && starts[shotIndex] < end
    ));
    if (segmentIndex < 0) return null;
    groups[segmentIndex].push(shots[shotIndex]);
  }
  return groups;
}

function rebaseVideoEndSeconds(body, segmentDurationMs, projectTotalMs) {
  const finalSegment = projectTotalMs > 0 && segmentDurationMs > 0;
  if (!finalSegment) return body;
  let output = body;
  for (const expression of [CHINESE_VIDEO_END_SECONDS, ENGLISH_VIDEO_END_SECONDS]) {
    const ranges = protectedRanges(output);
    output = output.replace(expression, (match, prefix, numeric, suffix, offset) => {
      const normalizedNumeric = asciiNumber(numeric);
      if (isProtectedOffset(ranges, offset) || Number(normalizedNumeric) * 1000 !== projectTotalMs) return match;
      const digits = normalizedNumeric.split(".")[1]?.length ?? 0;
      return `${prefix}${(segmentDurationMs / 1000).toFixed(digits)}${suffix}`;
    });
  }
  return output;
}

function rebaseBodyTimes(body, segmentStartMs, segmentDurationMs, projectTotalMs) {
  const rebasedCut = body.replace(SHOT_START_CLOCK, (match, minutes, seconds, fraction = "") => {
    const absolute = clockPartsToMilliseconds(minutes, seconds, fraction);
    const local = absolute - segmentStartMs;
    const prefix = /^在/u.test(match) ? "在 " : "At ";
    return `${prefix}${formatClock(local)}`;
  });
  const segmentEndMs = segmentStartMs + segmentDurationMs;
  return segmentEndMs === projectTotalMs
    ? rebaseVideoEndSeconds(rebasedCut, segmentDurationMs, projectTotalMs)
    : rebasedCut;
}

function removeLocalOpeningTimestamp(body) {
  return body
    .replace(/^在[\t ]*00:00\.000[\t ]*(?:[，,][\t ]*)?/u, "")
    .replace(/^at[\t ]+00:00\.000[\t ]*(?:,[\t ]*)?/iu, "");
}

function normalizeOfficialControls(body, localIndex) {
  const withoutOpening = localIndex === 0 ? removeLocalOpeningTimestamp(body) : body;
  const englishCut = localIndex === 0 ? withoutOpening : withoutOpening.replace(
    /^(?:在[\t ]*|At[\t ]+)(\d{2,3}:[0-5]\d(?:\.\d{1,3})?)[\t ]*(?:[，,][\t ]*)?/iu,
    "At $1, ",
  );
  return englishCut
    .replace(/<d>[\t ]*\[(?:中文|汉语)\]/giu, "<d>[Chinese]")
    .replace(/<d>[\t ]*\[英文\]/giu, "<d>[English]");
}

function mapSegmentPictureLabels(body, {
  projectMode,
  segmentIndex,
  segmentCount,
  referenceImageCount,
}) {
  let normalized = normalizeReferenceLabels(body);
  const pictures = [...normalized.matchAll(CANONICAL_PICTURE_LABEL)].map((match) => Number(match[1]));
  const otherMedia = [...normalized.matchAll(/<(Video|Audio)[\t ]+[0-9]+>/giu)];

  if (projectMode === "ref2va") {
    if (otherMedia.length > 0) {
      fail(
        "PROJECT.PROMPT_REFERENCE_BINDING",
        "This Ref2VA workflow currently binds reference images only; Video and Audio labels are not connected.",
        "/prompt",
      );
    }
    if (pictures.some((number) => number < 1 || number > referenceImageCount)) {
      fail("PROJECT.PROMPT_REFERENCE_BINDING", "A Ref2VA Picture label has no connected reference image.", "/prompt");
    }
    return normalized;
  }

  const rejectPictures = () => {
    if (pictures.length > 0) {
      fail(
        "PROJECT.PROMPT_REFERENCE_BINDING",
        "A Picture label does not match an image input connected to this output segment.",
        "/prompt",
      );
    }
  };

  if (projectMode === "t2v") {
    rejectPictures();
    return normalized;
  }

  if (segmentCount === 1) {
    const maximum = projectMode === "first_last_frame" ? 2 : 1;
    if (pictures.some((number) => number < 1 || number > maximum)) rejectPictures();
    return normalized;
  }

  if (projectMode === "first_frame") {
    if (segmentIndex === 1) {
      if (pictures.some((number) => number !== 1)) rejectPictures();
    } else rejectPictures();
    return normalized;
  }

  if (projectMode === "last_frame") {
    if (segmentIndex !== segmentCount) {
      rejectPictures();
      return normalized;
    }
    if (pictures.some((number) => number !== 1)) rejectPictures();
    normalized = normalized.replace(/<Picture[\t ]+1>/giu, "<Picture 2>");
    return normalized;
  }

  if (projectMode === "first_last_frame") {
    if (segmentIndex === 1) {
      if (pictures.some((number) => number !== 1)) rejectPictures();
    } else if (segmentIndex === segmentCount) {
      if (pictures.some((number) => number !== 2)) rejectPictures();
    } else rejectPictures();
    return normalized;
  }

  fail("PROJECT.PROMPT_MODE_FORMAT", "Unsupported H3 mode for picture-label binding.", "/mode");
}

function validateReferenceDocument({ document, parsed, referenceImageCount }) {
  const summary = normalizeReferenceLabels(document.fields.get("summary"));
  const prefix = summary.match(/^\[([^\]]+)\][\t ]+\S/iu);
  const taskTypes = prefix?.[1].split("+").map((value) => value.trim().toLowerCase()) ?? [];
  if (
    taskTypes.length === 0
    || new Set(taskTypes).size !== taskTypes.length
    || taskTypes.some((value) => !REF_TASK_TYPES.has(value))
  ) {
    fail("PROJECT.PROMPT_FORMAT", "Ref2VA summary must begin with official English task types.", "/prompt");
  }

  const retention = normalizeReferenceLabels(document.fields.get("retention_analysis"));
  const retentionLines = retention.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  if (retentionLines.length === 0 || retentionLines.some((line) => !RETENTION_LINE.test(line))) {
    fail("PROJECT.PROMPT_FORMAT", "Every Ref2VA retention line must use an official relationship marker.", "/prompt");
  }
  if (parsed.intro.length === 0) {
    fail("PROJECT.PROMPT_FORMAT", "Ref2VA detailed_description requires a style opening before [Shot 1].", "/prompt");
  }

  const definitions = normalizeReferenceLabels(document.fields.get("subject_definitions"));
  const definedLabels = new Set(
    [...definitions.matchAll(CANONICAL_REFERENCE_LABEL)].map((match) => `<${match[1]} ${match[2]}>`),
  );
  if (definedLabels.size === 0) {
    fail("PROJECT.PROMPT_FORMAT", "Ref2VA subject_definitions must define at least one reference label.", "/prompt");
  }
  for (const value of document.fields.values()) {
    const normalized = normalizeReferenceLabels(value);
    for (const match of normalized.matchAll(CANONICAL_REFERENCE_LABEL)) {
      const label = `<${match[1]} ${match[2]}>`;
      if (!definedLabels.has(label)) {
        fail("PROJECT.PROMPT_REFERENCE_BINDING", "Ref2VA uses a reference label not declared in subject_definitions.", "/prompt");
      }
    }
    mapSegmentPictureLabels(normalized, {
      projectMode: "ref2va",
      segmentIndex: 1,
      segmentCount: 1,
      referenceImageCount,
    });
  }
}

function alignmentInstruction(mode, duration, shotCount) {
  const seconds = Number(duration).toFixed(2);
  if (mode === "t2v" || mode === "ref2va") return null;
  if (mode === "first_frame") {
    return "For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.";
  }
  if (mode === "last_frame") {
    return `How the reference pictures align with the target video — <Picture 1> (from [Shot ${shotCount}]) aligns with the ${seconds}-second mark of the target video.`;
  }
  if (mode === "first_last_frame") {
    return `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot ${shotCount}) aligns with the ${seconds}-second mark of the target video.`;
  }
  fail("PROJECT.PROMPT_MODE_FORMAT", "Unsupported segment mode for official prompt alignment.", "/mode");
}

function renderTimeline({
  parsed,
  shots,
  segmentStartMs,
  segmentDurationMs,
  projectTotalMs,
  projectMode,
  segmentIndex,
  segmentCount,
  referenceImageCount,
}) {
  const renderedShots = shots.map((shot, localIndex) => {
    const rebasedBody = rebaseBodyTimes(
      shot.body,
      segmentStartMs,
      segmentDurationMs,
      projectTotalMs,
    );
    const body = mapSegmentPictureLabels(normalizeOfficialControls(rebasedBody, localIndex), {
      projectMode,
      segmentIndex,
      segmentCount,
      referenceImageCount,
    });
    return `[Shot ${localIndex + 1}]${body.length > 0 ? ` ${body}` : ""}`;
  }).join("\n\n");
  return parsed.intro.length > 0 ? `${parsed.intro}\n${renderedShots}` : renderedShots;
}

function renderSegmentPrompt({
  document,
  parsed,
  shots,
  segment,
  segmentStartMs,
  projectTotalMs,
  projectMode,
  segmentCount,
  referenceImageCount,
}) {
  const timeline = renderTimeline({
    parsed,
    shots,
    segmentStartMs,
    segmentDurationMs: segment.duration * 1000,
    projectTotalMs,
    projectMode,
    segmentIndex: segment.index,
    segmentCount,
    referenceImageCount,
  });
  const parts = [];
  if (document.kind === "base") {
    const instruction = alignmentInstruction(segment.mode, segment.duration, shots.length);
    if (instruction) parts.push(instruction);
  }
  for (const key of document.order) {
    if (!document.fields.has(key)) continue;
    const value = normalizeReferenceLabels(
      key === document.timelineField ? timeline : document.fields.get(key),
    );
    if (value.length === 0) {
      parts.push(`${key}:`);
    } else {
      parts.push(document.kind === "reference" ? `${key}:\n${value}` : `${key}: ${value}`);
    }
  }
  return parts.join("\n\n");
}

export function createSegmentPrompts(project, plan) {
  const document = extractPromptDocument(project.prompt, project.mode);
  if (!document) {
    // A plain prompt remains a useful convenience for a genuinely single-shot
    // text-to-video request.  Keyframe and reference modes have additional
    // official control sections that we cannot safely invent for the user.
    if (plan.segment_count === 1 && project.mode === "t2v") {
      return Object.freeze([project.prompt]);
    }
    if (project.mode === "ref2va") {
      fail(
        "PROJECT.PROMPT_FORMAT",
        "Ref2VA requires the official six-section prompt structure: subject_definitions, summary, retention_analysis, detailed_description, overall_soundscape, and non_diegetic_music.",
        "/prompt",
      );
    }
    if (project.mode !== "t2v") {
      fail(
        "PROJECT.PROMPT_FORMAT",
        "Keyframe video modes require the official three-section prompt structure so the compiler can add the exact first/last-frame alignment instruction without rewriting the user's content.",
        "/prompt",
      );
    }
    fail(
      "PROJECT.PROMPT_SEGMENTATION",
      "A multi-segment project requires official [Shot N] or [镜头 N] timeline fields; the tool will not duplicate one prompt across every segment.",
      "/prompt",
    );
  }

  const description = document.fields.get(document.timelineField);
  validateProjectEndTimes(description, plan.total_duration * 1000);
  const parsed = parseShots(description, document.kind);
  if (!parsed) {
    fail("PROJECT.PROMPT_SEGMENTATION", "Official prompt timeline contains no [Shot N] or [镜头 N] markers.", "/prompt");
  }
  if (document.kind === "reference") {
    validateReferenceDocument({
      document,
      parsed,
      referenceImageCount: project.endpoints?.reference_images?.length ?? 0,
    });
  }

  const starts = timedShotStarts(parsed.shots, plan.total_duration * 1000);
  if (parsed.shots.length > 1 && starts === null) {
    fail(
      "PROJECT.PROMPT_SEGMENTATION",
      "Every shot after [Shot 1] requires an official At MM:SS.mmm or 在 MM:SS.mmm cut time for multi-segment export.",
      "/prompt",
    );
  }
  const boundaries = segmentBoundaries(plan);
  if (starts && boundaries.slice(1).some(({ start }) => !starts.includes(start))) {
    fail(
      "PROJECT.PROMPT_SEGMENTATION",
      "Every output segment boundary must coincide with an explicitly timed shot cut; the tool will not invent continuation text across a boundary.",
      "/prompt",
    );
  }
  const groups = starts
    ? timedShotGroups(parsed.shots, starts, boundaries)
    : [parsed.shots];
  if (!groups || groups.some((group) => group.length === 0)) {
    fail(
      "PROJECT.PROMPT_SEGMENTATION",
      "Every output segment requires its own explicitly timed shot content.",
      "/prompt",
    );
  }

  return Object.freeze(groups.map((group, segmentIndex) => renderSegmentPrompt({
    document,
    parsed,
    shots: group,
    segment: plan.segments[segmentIndex],
    segmentStartMs: boundaries[segmentIndex].start,
    projectTotalMs: plan.total_duration * 1000,
    projectMode: project.mode,
    segmentCount: plan.segment_count,
    referenceImageCount: project.endpoints?.reference_images?.length ?? 0,
  })));
}
