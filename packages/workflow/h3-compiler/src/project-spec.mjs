import { Buffer } from "node:buffer";
import { win32 } from "node:path";
import {
  CANVASES,
  DEFAULT_CANVAS,
  DEFAULT_RESOLUTION_MEGAPIXELS,
  DEFAULT_ADVANCED_OPTIONS,
  MAX_ENDPOINT_BYTES,
  MAX_PROMPT_BYTES,
  MAX_RESOLUTION_MEGAPIXELS,
  MIN_RESOLUTION_MEGAPIXELS,
  MODES,
  PROJECT_SCHEMA_VERSION,
  SAMPLING_PROFILES,
  SEGMENT_DURATIONS,
} from "./constants.mjs";
import { fail } from "./errors.mjs";
import { isSafeSeed, normalizeSeedPolicy } from "./seed-policy.mjs";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, allowed, path) {
  if (!isRecord(value)) fail("PROJECT.TYPE", "Expected an object.", path);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail("PROJECT.UNKNOWN_FIELD", "Unknown ProjectSpec field.", `${path}/${key}`);
  }
}

function endpointPath(value, path) {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value, "utf8") > MAX_ENDPOINT_BYTES) {
    fail("PROJECT.ENDPOINT_PATH", "Endpoint must be a bounded local image path.", path);
  }
  if (value.includes("\0") || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)
    || value.startsWith("\\\\") || value.startsWith("\\\\?\\") || value.startsWith("\\\\.\\")) {
    fail("PROJECT.ENDPOINT_PATH", "Endpoint must be a normal local path, not a URI, share, or device path.", path);
  }
  const windowsAbsolute = /^[A-Za-z]:[\\/](?![\\/])/.test(value);
  if (!windowsAbsolute && (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) || value.startsWith("/") || value.startsWith("\\"))) {
    fail("PROJECT.ENDPOINT_PATH", "Endpoint path form is unsupported.", path);
  }
  const tail = windowsAbsolute ? value.slice(3) : value;
  if (windowsAbsolute && tail.includes(":")) fail("PROJECT.ENDPOINT_PATH", "Alternate data streams are forbidden.", path);
  const parts = tail.replaceAll("\\", "/").split("/");
  if (parts.some((part) => part.length === 0 || part === "." || part === ".." || /[\u0000-\u001f]/.test(part))) {
    fail("PROJECT.ENDPOINT_PATH", "Endpoint path contains an unsafe segment.", path);
  }
  return windowsAbsolute ? win32.normalize(value) : parts.join("/");
}

export function validateProjectSpec(value) {
  exactKeys(
    value,
    new Set([
      "schema_version",
      "prompt",
      "mode",
      "duration",
      "segment_duration",
      "segment_durations",
      "shot_ids",
      "transitions",
      "canvas",
      "resolution_megapixels",
      "endpoints",
      "advanced",
    ]),
    "/",
  );
  if (value.schema_version !== PROJECT_SCHEMA_VERSION) fail("PROJECT.SCHEMA_VERSION", "Unsupported ProjectSpec schema version.", "/schema_version");
  if (typeof value.prompt !== "string" || value.prompt.trim().length === 0 || Buffer.byteLength(value.prompt, "utf8") > MAX_PROMPT_BYTES) {
    fail("PROJECT.PROMPT", "Prompt must be non-empty and bounded.", "/prompt");
  }
  if (!MODES.includes(value.mode)) fail("PROJECT.MODE", "Unsupported mode.", "/mode");
  if (!Number.isSafeInteger(value.duration) || value.duration < 5 || value.duration > 180 || value.duration % 5 !== 0) {
    fail("PROJECT.DURATION", "Duration must be a multiple of five between 5 and 180 seconds.", "/duration");
  }
  const segmentDuration = value.segment_duration ?? 5;
  if (!SEGMENT_DURATIONS.includes(segmentDuration)) {
    fail("PROJECT.SEGMENT_DURATION", "Segment duration must be 5, 10, or 15 seconds.", "/segment_duration");
  }
  let segmentDurations;
  if (value.segment_durations !== undefined) {
    if (!Array.isArray(value.segment_durations)
      || value.segment_durations.length < 1
      || value.segment_durations.length > 36
      || value.segment_durations.some((entry) => !SEGMENT_DURATIONS.includes(entry))) {
      fail("PROJECT.SEGMENT_DURATIONS", "Segment durations must contain 1–36 values of 5, 10, or 15 seconds.", "/segment_durations");
    }
    if (value.segment_durations.reduce((sum, entry) => sum + entry, 0) !== value.duration) {
      fail("PROJECT.SEGMENT_DURATIONS_TOTAL", "Segment durations must sum to the requested duration.", "/segment_durations");
    }
    segmentDurations = Object.freeze([...value.segment_durations]);
  }
  if (value.mode === "ref2va" && segmentDurations !== undefined && segmentDurations.length !== 1) {
    fail("PROJECT.REF2VA_SEGMENTS", "Ref2VA supports exactly one 5, 10, or 15 second segment.", "/segment_durations");
  }
  const canvas = value.canvas ?? DEFAULT_CANVAS;
  if (typeof canvas !== "string" || !Object.hasOwn(CANVASES, canvas)) {
    fail("PROJECT.CANVAS", "Canvas must be one of the eight official aspect ratios.", "/canvas");
  }
  const resolutionMegapixels = value.resolution_megapixels ?? DEFAULT_RESOLUTION_MEGAPIXELS;
  if (typeof resolutionMegapixels !== "number" || !Number.isFinite(resolutionMegapixels)
    || resolutionMegapixels < MIN_RESOLUTION_MEGAPIXELS
    || resolutionMegapixels > MAX_RESOLUTION_MEGAPIXELS) {
    fail(
      "PROJECT.RESOLUTION_MEGAPIXELS",
      "Resolution megapixels must be within the official ResolutionSelector range 0.1–16.0.",
      "/resolution_megapixels",
    );
  }

  let advanced = DEFAULT_ADVANCED_OPTIONS;
  if (value.advanced !== undefined) {
    exactKeys(value.advanced, new Set([
      "seed",
      "seed_policy",
      "sampling_profile",
      "resolved_base_seed",
      "resolved_shot_seeds",
    ]), "/advanced");
    if (!isSafeSeed(value.advanced.seed)) {
      fail("PROJECT.SEED", "Seed must be a non-negative safe integer.", "/advanced/seed");
    }
    const seedPolicy = normalizeSeedPolicy(value.advanced.seed_policy);
    if (seedPolicy === null) {
      fail("PROJECT.SEED_POLICY", "Seed policy must be fixed or random_per_compile.", "/advanced/seed_policy");
    }
    if (!SAMPLING_PROFILES.includes(value.advanced.sampling_profile)) {
      fail(
        "PROJECT.SAMPLING_PROFILE",
        "Sampling profile must be quality_20, quality_25, or turbo_8.",
        "/advanced/sampling_profile",
      );
    }
    if (value.advanced.resolved_base_seed !== undefined && !isSafeSeed(value.advanced.resolved_base_seed)) {
      fail("PROJECT.SEED", "Resolved base seed must be a non-negative safe integer.", "/advanced/resolved_base_seed");
    }
    if (value.advanced.resolved_shot_seeds !== undefined && (
      !Array.isArray(value.advanced.resolved_shot_seeds)
      || value.advanced.resolved_shot_seeds.length < 1
      || value.advanced.resolved_shot_seeds.length > 36
      || value.advanced.resolved_shot_seeds.some((seed) => !isSafeSeed(seed))
    )) {
      fail("PROJECT.SEED", "Resolved shot seeds must be JSON-safe integers.", "/advanced/resolved_shot_seeds");
    }
    advanced = Object.freeze({
      seed: value.advanced.seed,
      seed_policy: seedPolicy,
      sampling_profile: value.advanced.sampling_profile,
      ...(value.advanced.resolved_base_seed === undefined ? {} : { resolved_base_seed: value.advanced.resolved_base_seed }),
      ...(value.advanced.resolved_shot_seeds === undefined ? {} : {
        resolved_shot_seeds: Object.freeze([...value.advanced.resolved_shot_seeds]),
      }),
    });
  }
  if (value.mode === "ref2va" && !["quality_20", "quality_25"].includes(advanced.sampling_profile)) {
    fail(
      "PROJECT.SAMPLING_PROFILE_MODE",
      "The Ref2VA image-reference path supports only the pinned 20-step and 25-step quality profiles.",
      "/advanced/sampling_profile",
    );
  }

  const segmentCount = segmentDurations?.length ?? (value.duration > segmentDuration
    ? Math.ceil(value.duration / segmentDuration)
    : 1);
  let transitions;
  if (value.transitions === undefined) {
    transitions = Object.freeze(Array.from(
      { length: Math.max(0, segmentCount - 1) },
      () => "tail_frame_continuation",
    ));
  } else {
    if (!Array.isArray(value.transitions)
      || value.transitions.length !== Math.max(0, segmentCount - 1)) {
      fail(
        "PROJECT.TRANSITIONS",
        "Transitions must contain exactly one entry for every adjacent segment pair.",
        "/transitions",
      );
    }
    if (value.transitions.some((entry) => !["hard_cut", "tail_frame_continuation"].includes(entry))) {
      fail(
        "PROJECT.TRANSITION_TYPE",
        "Transition must be hard_cut or tail_frame_continuation.",
        "/transitions",
      );
    }
    transitions = Object.freeze([...value.transitions]);
  }
  let shotIds;
  if (value.shot_ids !== undefined) {
    if (!Array.isArray(value.shot_ids)
      || value.shot_ids.length !== segmentCount
      || value.shot_ids.some((entry) => typeof entry !== "string" || !/^shot-[a-z0-9][a-z0-9-]{7,127}$/u.test(entry))
      || new Set(value.shot_ids).size !== value.shot_ids.length) {
      fail("PROJECT.SHOT_IDS", "Shot IDs must be unique stable Relay IDs matching the segment plan.", "/shot_ids");
    }
    shotIds = Object.freeze([...value.shot_ids]);
  }
  if (advanced.resolved_shot_seeds !== undefined && advanced.resolved_shot_seeds.length !== segmentCount) {
    fail("PROJECT.SEED_RESOLUTION", "Resolved shot seeds must match the segment plan.", "/advanced/resolved_shot_seeds");
  }

  const needsEndpoints = value.mode !== "t2v";
  if (!needsEndpoints && value.endpoints !== undefined) fail("PROJECT.ENDPOINTS_UNEXPECTED", "T2V must not declare endpoints.", "/endpoints");
  if (needsEndpoints && value.endpoints === undefined) fail("PROJECT.ENDPOINTS_REQUIRED", "Selected mode requires endpoints.", "/endpoints");

  let endpoints;
  if (needsEndpoints) {
    if (value.mode === "ref2va") {
      exactKeys(value.endpoints, new Set(["reference_images"]), "/endpoints");
      if (!Array.isArray(value.endpoints.reference_images)
        || value.endpoints.reference_images.length < 1
        || value.endpoints.reference_images.length > 2) {
        fail(
          "PROJECT.REFERENCE_IMAGES",
          "The pinned Ref2VA image-reference path requires one or two reference images.",
          "/endpoints/reference_images",
        );
      }
      endpoints = Object.freeze({
        reference_images: Object.freeze(value.endpoints.reference_images.map((entry, index) => (
          endpointPath(entry, `/endpoints/reference_images/${index}`)
        ))),
      });
    } else {
      exactKeys(value.endpoints, new Set(["first_frame", "last_frame"]), "/endpoints");
      const hasFirst = Object.hasOwn(value.endpoints, "first_frame");
      const hasLast = Object.hasOwn(value.endpoints, "last_frame");
      const expected = {
        first_frame: [true, false],
        last_frame: [false, true],
        first_last_frame: [true, true],
      }[value.mode];
      if (hasFirst !== expected[0] || hasLast !== expected[1]) fail("PROJECT.ENDPOINT_MODE_MISMATCH", "Endpoint fields do not match mode.", "/endpoints");
      endpoints = Object.freeze({
        ...(hasFirst ? { first_frame: endpointPath(value.endpoints.first_frame, "/endpoints/first_frame") } : {}),
        ...(hasLast ? { last_frame: endpointPath(value.endpoints.last_frame, "/endpoints/last_frame") } : {}),
      });
    }
  }

  return Object.freeze({
    schema_version: PROJECT_SCHEMA_VERSION,
    prompt: value.prompt,
    mode: value.mode,
    duration: value.duration,
    segment_duration: segmentDuration,
    ...(segmentDurations === undefined ? {} : { segment_durations: segmentDurations }),
    ...(shotIds === undefined ? {} : { shot_ids: shotIds }),
    transitions,
    canvas,
    resolution_megapixels: resolutionMegapixels,
    advanced,
    ...(endpoints ? { endpoints } : {}),
  });
}

export function h3FrameCount(seconds) {
  const nominal = seconds * 24;
  const frames = Math.max(5, nominal) + ((5 - (Math.max(5, nominal) % 17)) % 17);
  if (!Number.isSafeInteger(frames) || frames < 5 || (frames - 5) % 17 !== 0) fail("COMPILER.FRAME_PLAN", "Invalid H3 frame plan.", "/duration");
  return frames;
}

function segmentMode(projectMode, index, count, transitionFromPrevious) {
  if (count === 1) return projectMode;
  const first = index === 0;
  const last = index === count - 1;
  if (first) {
    if (projectMode === "ref2va") return "ref2va";
    return projectMode === "first_frame" || projectMode === "first_last_frame" ? "first_frame" : "t2v";
  }
  const inheritsTail = transitionFromPrevious === "tail_frame_continuation";
  const hasUserLastFrame = last && (projectMode === "last_frame" || projectMode === "first_last_frame");
  if (inheritsTail && hasUserLastFrame) return "first_last_frame";
  if (inheritsTail) return "first_frame";
  if (hasUserLastFrame) return "last_frame";
  return "t2v";
}

export function segmentName(index, count) {
  const digits = Math.max(2, String(count).length);
  return `segment-${String(index).padStart(digits, "0")}-of-${String(count).padStart(digits, "0")}`;
}

export function createSegmentPlan(project) {
  const explicitDurations = project.segment_durations;
  const shouldSegment = explicitDurations !== undefined
    ? explicitDurations.length > 1
    : project.duration > project.segment_duration;
  const seconds = shouldSegment ? project.segment_duration : project.duration;
  const durations = explicitDurations ?? Object.freeze(
    shouldSegment
      ? Array.from({ length: Math.ceil(project.duration / seconds) }, (_, index) => (
        Math.min(seconds, project.duration - index * seconds)
      ))
      : [project.duration]
  );
  const count = durations.length;
  const transitions = project.transitions ?? Object.freeze(Array.from(
    { length: Math.max(0, count - 1) },
    () => "tail_frame_continuation",
  ));
  if (!Array.isArray(transitions) || transitions.length !== Math.max(0, count - 1)
    || transitions.some((entry) => !["hard_cut", "tail_frame_continuation"].includes(entry))) {
    fail("PROJECT.TRANSITIONS", "Transition plan does not match the segment plan.", "/transitions");
  }
  const singleWorkflowDag = shouldSegment && project.mode !== "ref2va";
  const segments = [];
  for (let index = 0; index < count; index += 1) {
    const segmentDuration = durations[index];
    const transitionFromPrevious = index === 0 ? null : transitions[index - 1];
    const mode = segmentMode(project.mode, index, count, transitionFromPrevious);
    const isContinuation = count > 1 && index > 0;
    const inheritsPreviousTail = isContinuation && transitionFromPrevious === "tail_frame_continuation";
    const isBlockedContinuation = isContinuation && !singleWorkflowDag;
    const name = segmentName(index + 1, count);
    let endpoints;
    if (mode === "ref2va" && index === 0) {
      endpoints = { reference_images: project.endpoints.reference_images };
    } else if (project.endpoints) {
      const endpointValues = {};
      if (index === 0 && (project.mode === "first_frame" || project.mode === "first_last_frame")) {
        endpointValues.first_frame = project.endpoints.first_frame;
      }
      if (index === count - 1 && (project.mode === "last_frame" || project.mode === "first_last_frame")) {
        endpointValues.last_frame = project.endpoints.last_frame;
      }
      if (Object.keys(endpointValues).length > 0) endpoints = endpointValues;
    }
    segments.push(Object.freeze({
      index: index + 1,
      name,
      duration: segmentDuration,
      generated_frames: h3FrameCount(segmentDuration),
      mode,
      workflow_status: isBlockedContinuation
        ? "blocked"
        : singleWorkflowDag
          ? "included_in_single_workflow"
          : "ready",
      transition_from_previous: transitionFromPrevious,
      requires_previous_segment_final_frame: inheritsPreviousTail,
      planned_output_prefix: singleWorkflowDag
        ? null
        : count > 1
          ? `video/MiniMax_H3_${name.replaceAll("-", "_")}`
          : "video/MiniMax_H3",
      planned_workflow_file: singleWorkflowDag
        ? "minimax-h3.workflow.json"
        : count > 1
          ? `minimax-h3.${name}.workflow.json`
          : "minimax-h3.workflow.json",
      output_role: singleWorkflowDag ? "internal_segment_not_saved_separately" : "saved_workflow_output",
      ...(inheritsPreviousTail ? {
        continuity_source: Object.freeze({
          segment: segmentName(index, count),
          output: "final_frame",
        }),
      } : {}),
      ...(endpoints ? { endpoints: Object.freeze(endpoints) } : {}),
    }));
  }
  return Object.freeze({
    status: count === 1
      ? "export_ready"
      : singleWorkflowDag
        ? "experimental_export_ready"
        : "experimental_blocked",
    total_duration: project.duration,
    segment_duration: seconds,
    requested_segment_duration: project.segment_duration,
    segment_durations: Object.freeze([...durations]),
    segment_count: count,
    transitions: Object.freeze([...transitions]),
    emitted_segment_count: singleWorkflowDag ? count : 1,
    emitted_workflow_count: 1,
    single_workflow_dag: singleWorkflowDag,
    experimental: count > 1,
    continuity: count === 1
      ? "single_segment_workflow"
      : singleWorkflowDag
        ? transitions.every((entry) => entry === "tail_frame_continuation")
          ? "official_core_tail_frame_dependency_chain"
          : transitions.every((entry) => entry === "hard_cut")
            ? "official_core_hard_cut_sequence"
            : "official_core_mixed_transition_sequence"
        : "blocked_until_required_prior_segment_final_frames_are_selected",
    ...(count > 1 && !singleWorkflowDag
      ? { block_code: "LONG_CONTINUITY_REQUIRES_PRIOR_SEGMENT_FINAL_FRAME" }
      : {}),
    ...(singleWorkflowDag ? {
      warning_code: transitions.every((entry) => entry === "tail_frame_continuation")
        ? "EXPERIMENTAL_H3_SUBGRAPH_TAIL_FRAME_CHAIN"
        : "EXPERIMENTAL_H3_SUBGRAPH_TRANSITION_SEQUENCE",
      warning: "The exported ComfyUI dependency graph may intermittently fail inside repeated H3 subgraph calls; it is not a Stable capability.",
    } : {}),
    automatic_execution: false,
    automatic_assembly: false,
    assembly_after_manual_run: singleWorkflowDag,
    assembly_owner: singleWorkflowDag ? "comfyui_dependency_graph_after_user_clicks_run" : "none",
    segments: Object.freeze(segments),
  });
}
