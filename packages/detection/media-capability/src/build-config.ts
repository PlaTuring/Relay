import { sha256Text } from "./hash.ts";
import { assertSafeText, compareOrdinal } from "./safe-text.ts";
import type { BuildConfigurationFlag, FfmpegProgramIdentity } from "./types.ts";

const safeValuedOptions = new Set([
  "arch",
  "cpu",
  "target-os",
  "toolchain",
  "cc",
  "cxx",
  "ld",
  "nm",
  "ar",
  "as"
]);

function compareFlags(left: BuildConfigurationFlag, right: BuildConfigurationFlag): number {
  return (
    compareOrdinal(left.option, right.option) ||
    compareOrdinal(left.valueState, right.valueState) ||
    compareOrdinal(left.safeValue ?? "", right.safeValue ?? "")
  );
}

export function sanitizeBuildConfiguration(raw: string): Readonly<{
  configurationFingerprintSha256: ReturnType<typeof sha256Text>;
  configurationFlags: readonly BuildConfigurationFlag[];
}> {
  assertSafeText(raw, 32_768);
  const tokens = raw.trim() === "" ? [] : raw.trim().split(/\s+/u);
  if (tokens.length > 1_024) throw new Error("MEDIA.OUTPUT_INVALID");
  const flags: BuildConfigurationFlag[] = [];
  for (const token of tokens) {
    if (Buffer.byteLength(token, "utf8") > 1_024) throw new Error("MEDIA.OUTPUT_INVALID");
    const match = /^--([a-z0-9][a-z0-9-]{0,63})(?:=(.*))?$/u.exec(token);
    if (!match) {
      flags.push(Object.freeze({ option: "unknown", valueState: "redacted" }));
      continue;
    }
    const option = match[1] ?? "unknown";
    const value = match[2];
    if (value === undefined) {
      flags.push(Object.freeze({ option, valueState: "absent" }));
    } else if (
      safeValuedOptions.has(option) &&
      /^[A-Za-z0-9_.+:-]{1,128}$/u.test(value) &&
      !/(?:secret|token|password|key)/iu.test(option)
    ) {
      flags.push(Object.freeze({ option, valueState: "safe", safeValue: value }));
    } else {
      flags.push(Object.freeze({ option, valueState: "redacted" }));
    }
  }
  const configurationFlags = Object.freeze(flags.sort(compareFlags));
  return Object.freeze({
    configurationFingerprintSha256: sha256Text(JSON.stringify(configurationFlags)),
    configurationFlags
  });
}

export function parseCompilerIdentity(raw: string): FfmpegProgramIdentity["compiler"] {
  assertSafeText(raw, 1_024);
  const lower = raw.toLowerCase();
  const family = lower.includes("clang")
    ? "clang"
    : lower.includes("gcc") || lower.includes("gnu")
      ? "gcc"
      : lower.includes("msvc") || lower.includes("microsoft")
        ? "msvc"
        : "unknown";
  const versionMatch = /\b([0-9]+(?:\.[0-9]+){0,3})\b/u.exec(raw);
  const version = versionMatch?.[1];
  return Object.freeze({
    family,
    ...(version ? { version } : {})
  });
}
