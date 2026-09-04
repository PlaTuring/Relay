import { parseCompilerIdentity, sanitizeBuildConfiguration } from "./build-config.ts";
import { failure, unavailable } from "./failure.ts";
import { validateExecutorOutput } from "./executor-boundary.ts";
import { assertNoPrivatePaths, assertSafeIdentifier, assertSafeText, compareOrdinal } from "./safe-text.ts";
import type {
  AmbientFfmpegObservation,
  CodecCapability,
  CommandResult,
  ContainerCapability,
  FfmpegCapabilities,
  FfmpegProgramIdentity,
  MediaFailureCode,
  MetadataPathCapability,
} from "./types.ts";

export const FFMPEG_FIXED_COMMANDS = Object.freeze({
  version: Object.freeze(["-hide_banner", "-version"]),
  codecs: Object.freeze(["-hide_banner", "-codecs"]),
  formats: Object.freeze(["-hide_banner", "-formats"]),
  help: Object.freeze(["-hide_banner", "-h", "full"])
});

const normalLimits = Object.freeze({ timeoutMs: 10_000, maxOutputBytes: 1024 * 1024 });
const helpLimits = Object.freeze({ timeoutMs: 15_000, maxOutputBytes: 2 * 1024 * 1024 });

class ProbeError extends Error {
  readonly code: MediaFailureCode;

  constructor(code: MediaFailureCode) {
    super(code);
    this.code = code;
  }
}

const privateBuildIdentity = new WeakMap<
  FfmpegProgramIdentity,
  Readonly<{ compilerRaw: string; configurationRaw: string }>
>();

function combinedOutput(result: Extract<CommandResult, { ok: true }>): string {
  const separator = result.stdout !== "" && result.stderr !== "" ? "\n" : "";
  const output = `${result.stdout}${separator}${result.stderr}`;
  assertSafeText(output, 2 * 1024 * 1024);
  return output.replace(/\r\n?/gu, "\n");
}

function checkedLines(text: string, maximumLines: number, maximumLineBytes: number): string[] {
  const lines = text.split("\n");
  if (lines.length > maximumLines) throw new ProbeError("MEDIA.OUTPUT_INVALID");
  for (const line of lines) {
    if (Buffer.byteLength(line, "utf8") > maximumLineBytes) {
      throw new ProbeError("MEDIA.OUTPUT_INVALID");
    }
  }
  return lines;
}

function versionString(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._+~-]{0,127}$/u.test(value)) {
    throw new ProbeError("MEDIA.OUTPUT_INVALID");
  }
  return value;
}

export function parseFfmpegVersion(
  text: string,
  program: "ffmpeg" | "ffprobe"
): FfmpegProgramIdentity {
  const lines = checkedLines(text, 4_096, 16_384);
  let version: string | null = null;
  let compilerRaw: string | null = null;
  let configurationRaw: string | null = null;
  const libraries = new Map<string, Readonly<{ name: string; compiledVersion: string; runtimeVersion: string }>>();
  const identityPattern = new RegExp(`^${program} version ([A-Za-z0-9][A-Za-z0-9._+~-]{0,127})(?:\\s|$)`, "u");
  const libraryPattern = /^\s*(lib(?:av|sw)[A-Za-z0-9_]+|libpostproc)\s+([0-9]+)\.\s*([0-9]+)\.\s*([0-9]+)\s*\/\s*([0-9]+)\.\s*([0-9]+)\.\s*([0-9]+)\s*$/u;

  for (const line of lines) {
    const identity = identityPattern.exec(line);
    if (identity) {
      if (version !== null) throw new ProbeError("MEDIA.OUTPUT_INVALID");
      version = versionString(identity[1] ?? "");
      continue;
    }
    if (line.startsWith("built with ")) {
      if (compilerRaw !== null) throw new ProbeError("MEDIA.OUTPUT_INVALID");
      compilerRaw = line.slice("built with ".length);
      continue;
    }
    if (line.startsWith("configuration:")) {
      if (configurationRaw !== null) throw new ProbeError("MEDIA.OUTPUT_INVALID");
      configurationRaw = line.slice("configuration:".length).trimStart();
      continue;
    }
    try {
      assertNoPrivatePaths(line);
    } catch {
      throw new ProbeError("MEDIA.OUTPUT_UNSAFE_TEXT");
    }
    const library = libraryPattern.exec(line);
    if (library) {
      const name = library[1] ?? "";
      if (libraries.has(name)) throw new ProbeError("MEDIA.OUTPUT_INVALID");
      const compiledVersion = `${library[2]}.${library[3]}.${library[4]}`;
      const runtimeVersion = `${library[5]}.${library[6]}.${library[7]}`;
      libraries.set(name, Object.freeze({ name, compiledVersion, runtimeVersion }));
    }
  }
  if (version === null || compilerRaw === null || configurationRaw === null || libraries.size < 3) {
    throw new ProbeError("MEDIA.OUTPUT_INVALID");
  }
  for (const required of [
    "libavutil",
    "libavcodec",
    "libavformat",
    "libavdevice",
    "libavfilter",
    "libswscale",
    "libswresample"
  ]) {
    if (!libraries.has(required)) throw new ProbeError("MEDIA.OUTPUT_INVALID");
  }
  for (const library of libraries.values()) {
    if (library.compiledVersion !== library.runtimeVersion) {
      throw new ProbeError("MEDIA.FFMPEG_PAIR_CONFLICT");
    }
  }
  const configuration = sanitizeBuildConfiguration(configurationRaw);
  const identity = Object.freeze({
    program,
    version,
    compiler: parseCompilerIdentity(compilerRaw),
    ...configuration,
    libraries: Object.freeze([...libraries.values()].sort((left, right) => compareOrdinal(left.name, right.name))),
  });
  privateBuildIdentity.set(identity, Object.freeze({ compilerRaw, configurationRaw }));
  return identity;
}

const codecMediaTypes: Readonly<Record<string, CodecCapability["mediaType"]>> = Object.freeze({
  V: "video",
  A: "audio",
  S: "subtitle",
  D: "data",
  T: "attachment",
  ".": "unknown"
});

export function parseFfmpegCodecs(text: string): CodecCapability[] {
  try {
    assertNoPrivatePaths(text);
  } catch {
    throw new ProbeError("MEDIA.OUTPUT_UNSAFE_TEXT");
  }
  if (!text.endsWith("\n")) throw new ProbeError("MEDIA.OUTPUT_INVALID");
  const lines = checkedLines(text, 8_192, 4_096);
  const rows = new Map<string, CodecCapability>();
  const pattern = /^\s*([D.])([E.])([VASDT.])([I.])([L.])([S.])\s+([A-Za-z0-9][A-Za-z0-9_.+-]{0,127})(?:\s|$)/u;
  const headerIndex = lines.indexOf("Codecs:");
  const dividerIndex = lines.findIndex((line, index) => index > headerIndex && /^\s*-{6,}\s*$/u.test(line));
  if (headerIndex < 0 || dividerIndex < 0) throw new ProbeError("MEDIA.OUTPUT_INVALID");
  const legend = lines.slice(headerIndex + 1, dividerIndex).join("\n");
  if (!/Decoding supported/iu.test(legend) || !/Encoding supported/iu.test(legend)) {
    throw new ProbeError("MEDIA.OUTPUT_INVALID");
  }
  for (const line of lines.slice(dividerIndex + 1)) {
    if (line.trim() === "") continue;
    const match = pattern.exec(line);
    if (!match) throw new ProbeError("MEDIA.OUTPUT_INVALID");
    const name = match[7] ?? "";
    if (rows.has(name)) throw new ProbeError("MEDIA.OUTPUT_INVALID");
    const mediaType = codecMediaTypes[match[3] ?? "."];
    if (!mediaType) throw new ProbeError("MEDIA.OUTPUT_INVALID");
    rows.set(
      name,
      Object.freeze({
        name,
        mediaType,
        canDecode: match[1] === "D",
        canEncode: match[2] === "E"
      })
    );
  }
  if (rows.size < 1) throw new ProbeError("MEDIA.OUTPUT_INVALID");
  return [...rows.values()].sort((left, right) => compareOrdinal(left.name, right.name));
}

export function parseFfmpegFormats(text: string): ContainerCapability[] {
  try {
    assertNoPrivatePaths(text);
  } catch {
    throw new ProbeError("MEDIA.OUTPUT_UNSAFE_TEXT");
  }
  if (!text.endsWith("\n")) throw new ProbeError("MEDIA.OUTPUT_INVALID");
  const lines = checkedLines(text, 8_192, 4_096);
  const seenNames = new Set<string>();
  const rows: ContainerCapability[] = [];
  const pattern = /^\s*([D. ])([E. ])\s+([A-Za-z0-9][A-Za-z0-9_.+,-]{0,511})(?:\s|$)/u;
  const headerIndex = lines.indexOf("File formats:");
  const dividerIndex = lines.findIndex((line, index) => index > headerIndex && /^\s*-{2,}\s*$/u.test(line));
  if (headerIndex < 0 || dividerIndex < 0) throw new ProbeError("MEDIA.OUTPUT_INVALID");
  const legend = lines.slice(headerIndex + 1, dividerIndex).join("\n");
  if (!/Demuxing supported/iu.test(legend) || !/Muxing supported/iu.test(legend)) {
    throw new ProbeError("MEDIA.OUTPUT_INVALID");
  }
  for (const line of lines.slice(dividerIndex + 1)) {
    if (line.trim() === "") continue;
    const match = pattern.exec(line);
    if (!match) throw new ProbeError("MEDIA.OUTPUT_INVALID");
    const names = (match[3] ?? "").split(",").sort(compareOrdinal);
    if (names.length < 1 || names.length > 64) throw new ProbeError("MEDIA.OUTPUT_INVALID");
    for (const name of names) {
      assertSafeIdentifier(name, 128);
      if (seenNames.has(name)) throw new ProbeError("MEDIA.OUTPUT_INVALID");
      seenNames.add(name);
    }
    rows.push(
      Object.freeze({
        names: Object.freeze(names),
        extensions: Object.freeze([]),
        canDemux: match[1] === "D",
        canMux: match[2] === "E"
      })
    );
  }
  if (rows.length < 1) throw new ProbeError("MEDIA.OUTPUT_INVALID");
  return rows.sort((left, right) => compareOrdinal(left.names.join(","), right.names.join(",")));
}

function hasOption(text: string, option: string): boolean {
  const escaped = option.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const pattern = new RegExp(`^\\s*${escaped}(?:\\[[^\\]]+\\]|:[^\\s]+)?(?:\\s|$)`, "mu");
  return pattern.test(text);
}

export function parseMetadataPaths(ffmpegHelp: string, ffprobeHelp: string): MetadataPathCapability[] {
  try {
    assertNoPrivatePaths(ffmpegHelp);
    assertNoPrivatePaths(ffprobeHelp);
  } catch {
    throw new ProbeError("MEDIA.OUTPUT_UNSAFE_TEXT");
  }
  checkedLines(ffmpegHelp, 32_768, 16_384);
  checkedLines(ffprobeHelp, 32_768, 16_384);
  const metadata = hasOption(ffmpegHelp, "-metadata");
  const mapMetadata = hasOption(ffmpegHelp, "-map_metadata");
  const showEntries = hasOption(ffprobeHelp, "-show_entries");
  const rows: MetadataPathCapability[] = [
    { path: "output.container.tags", access: "write", available: metadata, mechanism: "-metadata", evidence: "cli_surface_observed" },
    { path: "output.stream.tags", access: "write", available: metadata, mechanism: "-metadata:stream_specifier", evidence: "cli_surface_observed" },
    { path: "output.container.tags", access: "copy", available: mapMetadata, mechanism: "-map_metadata", evidence: "cli_surface_observed" },
    { path: "output.stream.tags", access: "copy", available: mapMetadata, mechanism: "-map_metadata:stream_specifier", evidence: "cli_surface_observed" },
    { path: "output.all.tags", access: "write", available: mapMetadata, mechanism: "-map_metadata -1 (strip)", evidence: "cli_surface_observed" },
    { path: "output.all_streams.tags", access: "write", available: mapMetadata, mechanism: "-map_metadata:s -1 (strip)", evidence: "cli_surface_observed" },
    { path: "input.format.tags", access: "read", available: showEntries && hasOption(ffprobeHelp, "-show_format"), mechanism: "-show_entries format_tags", evidence: "cli_surface_observed" },
    { path: "input.stream.tags", access: "read", available: showEntries && hasOption(ffprobeHelp, "-show_streams"), mechanism: "-show_entries stream_tags", evidence: "cli_surface_observed" },
    { path: "input.chapter.tags", access: "read", available: showEntries && hasOption(ffprobeHelp, "-show_chapters"), mechanism: "-show_entries chapter_tags", evidence: "cli_surface_observed" },
    { path: "input.program.tags", access: "read", available: showEntries && hasOption(ffprobeHelp, "-show_programs"), mechanism: "-show_entries program_tags", evidence: "cli_surface_observed" }
  ];
  return rows
    .map((row) => Object.freeze(row))
    .sort((left, right) => compareOrdinal(`${left.path}\0${left.access}`, `${right.path}\0${right.access}`));
}

function coherent(left: FfmpegProgramIdentity, right: FfmpegProgramIdentity): boolean {
  const leftRaw = privateBuildIdentity.get(left);
  const rightRaw = privateBuildIdentity.get(right);
  return (
    leftRaw !== undefined &&
    rightRaw !== undefined &&
    leftRaw.configurationRaw === rightRaw.configurationRaw &&
    leftRaw.compilerRaw === rightRaw.compilerRaw &&
    left.version === right.version &&
    left.configurationFingerprintSha256 === right.configurationFingerprintSha256 &&
    JSON.stringify(left.compiler) === JSON.stringify(right.compiler) &&
    JSON.stringify(left.libraries) === JSON.stringify(right.libraries)
  );
}

export type FixedToolRunner = (
  slot: "ffmpeg" | "ffprobe",
  command: "version" | "codecs" | "formats" | "help",
  limits: Readonly<{ timeoutMs: number; maxOutputBytes: number }>
) => Promise<CommandResult>;

export function fixedFfmpegArguments(
  command: "version" | "codecs" | "formats" | "help"
): readonly string[] {
  return FFMPEG_FIXED_COMMANDS[command];
}

async function requireSuccess(
  promise: Promise<CommandResult>,
  limits: Readonly<{ timeoutMs: number; maxOutputBytes: number }>
): Promise<Extract<CommandResult, { ok: true }>> {
  const result = await promise.catch(() => ({ ok: false as const, failure: failure("MEDIA.PROCESS_SPAWN_FAILED") }));
  if (!result.ok) throw new ProbeError(result.failure.code);
  if (!validateExecutorOutput(result, limits.maxOutputBytes)) throw new ProbeError("MEDIA.OUTPUT_INVALID");
  return result;
}

export async function probeFfmpegPairWithFixedRunner(runner: FixedToolRunner): Promise<FfmpegCapabilities> {
  const ffmpegVersionResult = await requireSuccess(runner("ffmpeg", "version", normalLimits), normalLimits);
  const ffprobeVersionResult = await requireSuccess(runner("ffprobe", "version", normalLimits), normalLimits);
  const ffmpeg = parseFfmpegVersion(combinedOutput(ffmpegVersionResult), "ffmpeg");
  const ffprobe = parseFfmpegVersion(combinedOutput(ffprobeVersionResult), "ffprobe");
  if (!coherent(ffmpeg, ffprobe)) throw new ProbeError("MEDIA.FFMPEG_PAIR_CONFLICT");

  const [codecsResult, formatsResult, ffmpegHelpResult, ffprobeHelpResult] = await Promise.all([
    requireSuccess(runner("ffmpeg", "codecs", normalLimits), normalLimits),
    requireSuccess(runner("ffmpeg", "formats", normalLimits), normalLimits),
    requireSuccess(runner("ffmpeg", "help", helpLimits), helpLimits),
    requireSuccess(runner("ffprobe", "help", helpLimits), helpLimits)
  ]);
  return Object.freeze({
    ffmpeg,
    ffprobe,
    codecs: Object.freeze(parseFfmpegCodecs(combinedOutput(codecsResult))),
    containers: Object.freeze(parseFfmpegFormats(combinedOutput(formatsResult))),
    metadataPaths: Object.freeze(parseMetadataPaths(combinedOutput(ffmpegHelpResult), combinedOutput(ffprobeHelpResult))),
    coherent: true
  });
}

export function observeAmbientFfmpegPresence(present: boolean): AmbientFfmpegObservation {
  if (!present) return unavailable("MEDIA.PROBE_UNAVAILABLE");
  return Object.freeze({
    status: "present_unverified",
    source: "ambient_host",
    selectable: false,
    selected: false,
    reason: "exact_build_not_observed"
  });
}
