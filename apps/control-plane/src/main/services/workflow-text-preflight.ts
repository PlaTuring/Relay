import type { ProjectSpec } from "../../shared/ipc-contract.js";
import { ControlPlaneServiceError } from "./errors.js";

interface SectionSpec {
  readonly canonical: string;
  readonly aliases: readonly string[];
}

interface SectionMatch {
  readonly canonical: string;
  readonly start: number;
  readonly bodyStart: number;
}

const BASE_SECTIONS = Object.freeze<readonly SectionSpec[]>([
  Object.freeze({
    canonical: "integrated_multimodal_description",
    aliases: Object.freeze([
      "integrated_multimodal_description",
      "综合多模态描述",
      "综合多模态说明"
    ])
  }),
  Object.freeze({
    canonical: "overall_soundscape",
    aliases: Object.freeze([
      "overall_soundscape",
      "整体声景",
      "整体声音景观"
    ])
  }),
  Object.freeze({
    canonical: "non_diegetic_music",
    aliases: Object.freeze([
      "non_diegetic_music",
      "非叙事音乐",
      "非剧情音乐",
      "画外配乐"
    ])
  })
]);

const REF2VA_SECTIONS = Object.freeze<readonly SectionSpec[]>([
  Object.freeze({
    canonical: "subject_definitions",
    aliases: Object.freeze(["subject_definitions", "主体定义"])
  }),
  Object.freeze({
    canonical: "summary",
    aliases: Object.freeze(["summary", "摘要", "总结"])
  }),
  Object.freeze({
    canonical: "retention_analysis",
    aliases: Object.freeze(["retention_analysis", "保留分析", "参考保留分析"])
  }),
  Object.freeze({
    canonical: "detailed_description",
    aliases: Object.freeze(["detailed_description", "详细描述"])
  }),
  ...BASE_SECTIONS.slice(1)
]);

const EMPTY_VALUE_SECTIONS = Object.freeze(new Set([
  "overall_soundscape",
  "non_diegetic_music"
]));

const SHOT_MARKER = /[\[［【][\t ]*(?:shot|镜头)[\t ]*[0-9０-９]+[\t ]*[\]］】]/iu;
const SHOT_MARKER_GLOBAL = /[\[［【][\t ]*(?:shot|镜头)[\t ]*([0-9０-９]+)[\t ]*[\]］】]/giu;
const SHOT_START_CLOCK = /^(?:At|在)[\t ]*(\d{2,3}):(\d{2})(?:\.(\d{1,3}))?(?![\d.])/iu;

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function normalizedAlias(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

function normalizePromptText(value: string): string {
  return value.replace(/^\uFEFF/u, "").normalize("NFKC");
}

function parseSections(prompt: string, specs: readonly SectionSpec[]): readonly SectionMatch[] | null {
  const normalizedPrompt = normalizePromptText(prompt);
  const aliasToCanonical = new Map<string, string>();
  for (const spec of specs) {
    for (const alias of spec.aliases) aliasToCanonical.set(normalizedAlias(alias), spec.canonical);
  }
  const alternatives = [...aliasToCanonical.keys()]
    .sort((left, right) => right.length - left.length)
    .map(escapeRegularExpression)
    .join("|");
  const header = new RegExp(`^[\\t ]*(${alternatives})[\\t ]*:[\\t ]*`, "gimu");
  const matches = [...normalizedPrompt.matchAll(header)].map((match): SectionMatch | null => {
    const alias = match[1];
    const canonical = alias === undefined ? undefined : aliasToCanonical.get(normalizedAlias(alias));
    if (canonical === undefined || match.index === undefined) return null;
    return Object.freeze({
      canonical,
      start: match.index,
      bodyStart: match.index + match[0].length
    });
  });
  if (matches.some((match) => match === null)) return null;
  const sections = matches as readonly SectionMatch[];
  if (sections.length !== specs.length) return null;
  for (let index = 0; index < specs.length; index += 1) {
    const section = sections[index];
    const spec = specs[index];
    if (section === undefined || spec === undefined || section.canonical !== spec.canonical) return null;
    const end = sections[index + 1]?.start ?? normalizedPrompt.length;
    if (
      normalizedPrompt.slice(section.bodyStart, end).trim().length === 0
      && !EMPTY_VALUE_SECTIONS.has(section.canonical)
    ) return null;
  }
  return Object.freeze(sections);
}

function timelineBody(
  prompt: string,
  sections: readonly SectionMatch[],
  timelineCanonical: string
): string | null {
  const normalizedPrompt = normalizePromptText(prompt);
  const timelineIndex = sections.findIndex((section) => section.canonical === timelineCanonical);
  if (timelineIndex < 0) return null;
  const timeline = sections[timelineIndex];
  if (timeline === undefined) return null;
  const end = sections[timelineIndex + 1]?.start ?? normalizedPrompt.length;
  return normalizedPrompt.slice(timeline.bodyStart, end);
}

function formatTimelineClock(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  const fraction = milliseconds % 1_000;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(fraction).padStart(3, "0")}`;
}

function assertShotCutTimesBeforeDuration(prompt: string, durationSeconds: number): ReadonlySet<number> {
  const normalizedPrompt = normalizePromptText(prompt);
  const shotMarkers = [...normalizedPrompt.matchAll(SHOT_MARKER_GLOBAL)];
  const cutTimes = new Set<number>();
  let previousCutTime = -1;
  for (let index = 0; index < shotMarkers.length; index += 1) {
    const marker = shotMarkers[index];
    const markerNumber = Number(marker?.[1]);
    if (!Number.isSafeInteger(markerNumber) || markerNumber !== index + 1) {
      throw new ControlPlaneServiceError(
        "INVALID_REQUEST",
        "镜头编号必须从 [Shot 1] / [镜头 1] 开始并连续递增。"
      );
    }
    const bodyStart = (marker?.index ?? 0) + (marker?.[0].length ?? 0);
    const bodyEnd = shotMarkers[index + 1]?.index ?? normalizedPrompt.length;
    const body = normalizedPrompt.slice(bodyStart, bodyEnd).trimStart();
    const clock = body.match(SHOT_START_CLOCK);
    if (index === 0) {
      if (clock !== null) {
        throw new ControlPlaneServiceError(
          "INVALID_REQUEST",
          "[Shot 1] / [镜头 1] 是 00:00.000 的开场镜头，标题后不要再写开始时间。"
        );
      }
      cutTimes.add(0);
      previousCutTime = 0;
      continue;
    }
    if (clock === null) {
      throw new ControlPlaneServiceError(
        "INVALID_REQUEST",
        `镜头 ${markerNumber} 缺少开始时间；请紧跟镜头标题写 At/在 MM:SS.mmm。`
      );
    }
    const minutes = Number(clock[1]);
    const seconds = Number(clock[2]);
    const fraction = clock[3] ?? "";
    const milliseconds = fraction.length === 0 ? 0 : Number(fraction.padEnd(3, "0"));
    if (!Number.isSafeInteger(minutes) || !Number.isSafeInteger(seconds)
      || !Number.isSafeInteger(milliseconds) || seconds > 59) {
      throw new ControlPlaneServiceError(
        "INVALID_REQUEST",
        "多段提示词包含无效镜头时间；请使用 At/在 MM:SS 或 MM:SS.mmm 格式。"
      );
    }
    const cutTime = (minutes * 60 + seconds) * 1_000 + milliseconds;
    if (cutTime <= previousCutTime) {
      throw new ControlPlaneServiceError(
        "INVALID_REQUEST",
        `镜头 ${markerNumber} 的开始时间 ${formatTimelineClock(cutTime)} 必须晚于上一镜头。`
      );
    }
    if (cutTime >= durationSeconds * 1_000) {
      throw new ControlPlaneServiceError(
        "INVALID_REQUEST",
        `当前选择的总时长是 ${durationSeconds} 秒，但镜头 ${markerNumber} 从 ${formatTimelineClock(cutTime)} 开始；请把“总时长”改成与提示词一致的时长，或调整该镜头时间。`
      );
    }
    cutTimes.add(cutTime);
    previousCutTime = cutTime;
  }
  return cutTimes;
}

export function assertMultiSegmentPromptPreflight(project: ProjectSpec): void {
  const explicitDurations = project.segmentDurationsSeconds;
  const multiSegment = explicitDurations !== undefined
    ? explicitDurations.length > 1
    : project.durationSeconds > project.segmentDurationSeconds;
  const ref2va = project.mode === "REF2VA";
  const specs = ref2va ? REF2VA_SECTIONS : BASE_SECTIONS;
  const sections = parseSections(project.prompt, specs);
  const timelineCanonical = ref2va ? "detailed_description" : "integrated_multimodal_description";
  const timeline = sections === null ? null : timelineBody(project.prompt, sections, timelineCanonical);
  if (!multiSegment && (sections === null || timeline === null || !SHOT_MARKER.test(timeline))) return;
  if (sections === null || timeline === null || !SHOT_MARKER.test(timeline)) {
    const message = ref2va
      ? "多段 Ref2VA 工作流要求使用 MiniMax H3 官方六字段结构：subject_definitions、summary、retention_analysis、detailed_description、overall_soundscape、non_diegetic_music（可使用对应中文字段），并在详细描述中包含 [Shot N] 或 [镜头 N]。本工具不会自动创作或改写提示词。"
      : "多段 T2V/首尾帧工作流要求使用 MiniMax H3 官方基础三字段结构：integrated_multimodal_description、overall_soundscape、non_diegetic_music（可使用对应中文字段），并在多模态描述中包含 [Shot N] 或 [镜头 N]。本工具不会自动创作或改写提示词。";
    throw new ControlPlaneServiceError("INVALID_REQUEST", message);
  }

  const cutTimes = assertShotCutTimesBeforeDuration(timeline, project.durationSeconds);
  if (!multiSegment) return;
  const boundaries: number[] = [];
  if (explicitDurations !== undefined) {
    let elapsed = 0;
    for (const duration of explicitDurations.slice(0, -1)) {
      elapsed += duration;
      boundaries.push(elapsed);
    }
  } else {
    for (
      let boundarySeconds = project.segmentDurationSeconds;
      boundarySeconds < project.durationSeconds;
      boundarySeconds += project.segmentDurationSeconds
    ) boundaries.push(boundarySeconds);
  }
  for (const boundarySeconds of boundaries) {
    if (cutTimes.has(boundarySeconds * 1_000)) continue;
    const minutes = Math.floor(boundarySeconds / 60);
    const seconds = boundarySeconds % 60;
    const boundary = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.000`;
    throw new ControlPlaneServiceError(
      "INVALID_REQUEST",
      `多段提示词在分段边界 ${boundary} 缺少明确镜头切点。请在该时间写入 [Shot N] At ${boundary}, ... 或 [镜头 N] 在 ${boundary}，...；本工具不会猜写跨段续接内容。`
    );
  }
}
