import { spawn, type ChildProcessByStdio } from "node:child_process";
import { dirname, isAbsolute } from "node:path";
import type { Readable } from "node:stream";

import { failure } from "./failure.ts";
import { sha256Bytes } from "./hash.ts";
import { assertSafeText } from "./safe-text.ts";
import type { CommandRequest, CommandResult, ProcessExecutor } from "./types.ts";

const maximumArguments = 128;
const maximumArgumentBytes = 65_536;
const minimumTimeoutMs = 25;
const maximumTimeoutMs = 60_000;
const minimumOutputBytes = 256;
const maximumOutputBytes = 2 * 1024 * 1024;
const treeCloseTimeoutMs = 5_000;

function validRequest(request: CommandRequest): boolean {
  const executablePathValid = typeof request.executablePath === "string" &&
    (process.platform === "win32"
      ? /^[A-Za-z]:\\(?![?.]\\).+\.exe$/iu.test(request.executablePath) &&
        !request.executablePath.slice(3).includes(":") &&
        !/^(?:\\\\|file:)/iu.test(request.executablePath)
      : request.executablePath.startsWith("/") && !request.executablePath.startsWith("//"));
  return (
    executablePathValid &&
    !request.executablePath.includes("\0") &&
    Array.isArray(request.arguments) &&
    request.arguments.length <= maximumArguments &&
    request.arguments.every(
      (argument) =>
        typeof argument === "string" &&
        !argument.includes("\0") &&
        Buffer.byteLength(argument, "utf8") <= maximumArgumentBytes
    ) &&
    Number.isInteger(request.timeoutMs) &&
    request.timeoutMs >= minimumTimeoutMs &&
    request.timeoutMs <= maximumTimeoutMs &&
    Number.isInteger(request.maxOutputBytes) &&
    request.maxOutputBytes >= minimumOutputBytes &&
    request.maxOutputBytes <= maximumOutputBytes
  );
}

function probeEnvironment(): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = Object.create(null) as NodeJS.ProcessEnv;
  for (const key of ["SystemRoot", "WINDIR", "TEMP", "TMP", "LANG"] as const) {
    const value = process.env[key];
    if (value !== undefined) result[key] = value;
  }
  result.NO_COLOR = "1";
  result.AV_LOG_FORCE_NOCOLOR = "1";
  return result;
}

function waitForClose(
  closePromise: Promise<void>,
  timeoutMs: number
): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    timer.unref();
    closePromise.then(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function runTaskkill(pid: number, taskkillPath: string | null): Promise<boolean> {
  if (!taskkillPath || !isAbsolute(taskkillPath) || taskkillPath.includes("\0")) return false;
  return new Promise((resolve) => {
    let finished = false;
    const killer = spawn(taskkillPath, ["/PID", String(pid), "/T", "/F"], {
      shell: false,
      windowsHide: true,
      stdio: "ignore",
      env: probeEnvironment()
    });
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      killer.kill("SIGKILL");
      resolve(false);
    }, treeCloseTimeoutMs);
    timer.unref();
    killer.once("error", () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(false);
    });
    killer.once("close", (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}

async function terminateTree(
  child: ChildProcessByStdio<null, Readable, Readable>,
  closePromise: Promise<void>,
  windowsTreeTerminatorPath: string | null
): Promise<boolean> {
  const pid = child.pid;
  if (pid === undefined) return false;
  let terminationIssued = false;
  if (process.platform === "win32") {
    terminationIssued = await runTaskkill(pid, windowsTreeTerminatorPath);
    if (!terminationIssued) child.kill("SIGKILL");
  } else {
    try {
      process.kill(-pid, "SIGKILL");
      terminationIssued = true;
    } catch {
      terminationIssued = false;
    }
  }
  const closed = await waitForClose(closePromise, treeCloseTimeoutMs);
  return terminationIssued && closed;
}

function decodeUtf8(value: Buffer): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    return null;
  }
}

export class BoundedProcessExecutor implements ProcessExecutor {
  readonly #windowsTreeTerminatorPath: string | null;

  constructor(options: Readonly<{ windowsTreeTerminatorPath?: string }> = {}) {
    this.#windowsTreeTerminatorPath = options.windowsTreeTerminatorPath ?? null;
  }

  async execute(request: CommandRequest): Promise<CommandResult> {
    if (!validRequest(request)) {
      const absolute = typeof request.executablePath === "string" && isAbsolute(request.executablePath);
      return { ok: false, failure: failure(absolute ? "MEDIA.INVALID_REQUEST" : "MEDIA.EXECUTABLE_NOT_ABSOLUTE") };
    }

    const environment = probeEnvironment();

    return new Promise((resolve) => {
      let child: ChildProcessByStdio<null, Readable, Readable>;
      try {
        child = spawn(request.executablePath, [...request.arguments], {
          shell: false,
          windowsHide: true,
          detached: process.platform !== "win32",
          stdio: ["ignore", "pipe", "pipe"],
          env: environment,
          cwd: dirname(request.executablePath)
        });
      } catch {
        resolve({ ok: false, failure: failure("MEDIA.PROCESS_SPAWN_FAILED") });
        return;
      }

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let outputBytes = 0;
      let terminationReason: "MEDIA.PROCESS_TIMEOUT" | "MEDIA.PROCESS_OUTPUT_LIMIT" | null = null;
      let settled = false;
      let closeResolve!: () => void;
      const closePromise = new Promise<void>((close) => {
        closeResolve = close;
      });

      const finish = (result: CommandResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(result);
      };

      const forceClose = (reason: "MEDIA.PROCESS_TIMEOUT" | "MEDIA.PROCESS_OUTPUT_LIMIT"): void => {
        if (terminationReason !== null || settled) return;
        terminationReason = reason;
        void terminateTree(child, closePromise, this.#windowsTreeTerminatorPath).then((confirmed) => {
          finish({
            ok: false,
            failure: failure(confirmed ? reason : "MEDIA.PROCESS_TREE_UNCONFIRMED")
          });
        });
      };

      const capture = (destination: Buffer[]) => (chunk: Buffer | string): void => {
        if (terminationReason !== null || settled) return;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        outputBytes += buffer.byteLength;
        if (outputBytes > request.maxOutputBytes) {
          stdoutChunks.length = 0;
          stderrChunks.length = 0;
          forceClose("MEDIA.PROCESS_OUTPUT_LIMIT");
          return;
        }
        destination.push(buffer);
      };

      child.stdout.on("data", capture(stdoutChunks));
      child.stderr.on("data", capture(stderrChunks));
      child.once("error", () => {
        if (terminationReason === null) {
          finish({ ok: false, failure: failure("MEDIA.PROCESS_SPAWN_FAILED") });
        }
      });
      child.once("close", (code, signal) => {
        closeResolve();
        if (terminationReason !== null || settled) return;
        if (code !== 0 || signal !== null) {
          finish({ ok: false, failure: failure("MEDIA.PROCESS_NONZERO") });
          return;
        }
        if (process.platform === "win32") {
          finish({ ok: false, failure: failure("MEDIA.PROCESS_TREE_UNCONFIRMED") });
          return;
        }
        try {
          if (child.pid !== undefined) process.kill(-child.pid, 0);
          finish({ ok: false, failure: failure("MEDIA.PROCESS_TREE_UNCONFIRMED") });
          return;
        } catch (error) {
          if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") {
            finish({ ok: false, failure: failure("MEDIA.PROCESS_TREE_UNCONFIRMED") });
            return;
          }
        }
        const stdoutBytes = Buffer.concat(stdoutChunks);
        const stderrBytes = Buffer.concat(stderrChunks);
        const stdout = decodeUtf8(stdoutBytes);
        const stderr = decodeUtf8(stderrBytes);
        if (stdout === null || stderr === null) {
          finish({ ok: false, failure: failure("MEDIA.OUTPUT_INVALID_UTF8") });
          return;
        }
        try {
          assertSafeText(stdout, request.maxOutputBytes);
          assertSafeText(stderr, request.maxOutputBytes);
        } catch {
          finish({ ok: false, failure: failure("MEDIA.OUTPUT_UNSAFE_TEXT") });
          return;
        }
        finish({
          ok: true,
          stdout,
          stderr,
          stdoutSha256: sha256Bytes(stdoutBytes),
          stderrSha256: sha256Bytes(stderrBytes)
        });
      });

      const timeout = setTimeout(() => forceClose("MEDIA.PROCESS_TIMEOUT"), request.timeoutMs);
      timeout.unref();
    });
  }
}
