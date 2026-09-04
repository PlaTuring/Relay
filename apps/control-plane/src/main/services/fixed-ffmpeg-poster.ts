import { spawn } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, normalize, resolve } from "node:path";

const MAX_DIAGNOSTIC_BYTES = 8 * 1024;

export interface FixedFfmpegPosterOptions {
  readonly trustedExecutablePath: string;
  readonly timeoutMs?: number;
}

function sameWindowsPath(left: string, right: string): boolean {
  return resolve(left).toLocaleLowerCase("en-US") === resolve(right).toLocaleLowerCase("en-US");
}

async function requireDirectFile(path: string, label: string): Promise<string> {
  if (!isAbsolute(path) || path.includes("\u0000")) throw new TypeError(`${label} path is invalid.`);
  const normalized = normalize(path);
  const metadata = await lstat(normalized);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new TypeError(`${label} is not a direct file.`);
  if (!sameWindowsPath(await realpath(normalized), normalized)) throw new TypeError(`${label} cannot be a reparse path.`);
  return normalized;
}

/**
 * Creates a local-only, fixed-argument poster renderer. The executable is an
 * explicitly pinned Relay runtime path; PATH lookup and shell parsing are never used.
 */
export function createFixedFfmpegPosterRenderer(
  options: FixedFfmpegPosterOptions
): (sourcePath: string, outputPath: string) => Promise<void> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
    throw new TypeError("FFmpeg poster timeout is invalid.");
  }
  return async (sourcePath: string, outputPath: string): Promise<void> => {
    const [executable, source] = await Promise.all([
      requireDirectFile(options.trustedExecutablePath, "Trusted FFmpeg executable"),
      requireDirectFile(sourcePath, "Video source")
    ]);
    if (!isAbsolute(outputPath) || outputPath.includes("\u0000")) {
      throw new TypeError("Video poster output path is invalid.");
    }
    const target = normalize(outputPath);
    await new Promise<void>((resolveProcess, rejectProcess) => {
      const child = spawn(executable, Object.freeze([
        "-hide_banner",
        "-nostdin",
        "-loglevel", "error",
        "-ss", "0",
        "-i", source,
        "-frames:v", "1",
        "-vf", "scale=512:384:force_original_aspect_ratio=decrease",
        "-an",
        "-f", "image2",
        "-vcodec", "png",
        "-n",
        target
      ]), {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"]
      });
      const diagnostics: Buffer[] = [];
      let diagnosticBytes = 0;
      child.stderr?.on("data", (chunk: Buffer) => {
        if (diagnosticBytes >= MAX_DIAGNOSTIC_BYTES) return;
        const remaining = MAX_DIAGNOSTIC_BYTES - diagnosticBytes;
        const bounded = chunk.subarray(0, remaining);
        diagnostics.push(bounded);
        diagnosticBytes += bounded.length;
      });
      const timer = setTimeout(() => child.kill(), timeoutMs);
      timer.unref();
      child.once("error", (error) => {
        clearTimeout(timer);
        rejectProcess(error);
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolveProcess();
          return;
        }
        const detail = Buffer.concat(diagnostics).toString("utf8").trim();
        rejectProcess(new Error(detail.length > 0 ? `FFmpeg poster failed: ${detail}` : "FFmpeg poster failed."));
      });
    });
  };
}
