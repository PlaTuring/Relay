import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import path from "node:path";

import type { OwnedChildProbeResult } from "../shared/contracts";

export interface OwnedChildProbeOptions {
  readonly executable: string;
  readonly childScript: string;
  readonly label: string;
  readonly environment?: Readonly<NodeJS.ProcessEnv>;
  readonly readyTimeoutMs?: number;
  readonly stopTimeoutMs?: number;
}

interface ReadyEvent {
  readonly event: "ready";
  readonly token: string;
  readonly label: string;
  readonly pid: number;
}

function validateFixedPath(value: string, name: string): void {
  if (!path.isAbsolute(value) || value.includes("\0")) {
    throw new TypeError(`${name} must be an absolute, NUL-free path.`);
  }
}

async function stopChild(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number
): Promise<{ exitCode: number | null; exitSignal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { exitCode: child.exitCode, exitSignal: child.signalCode };
  }

  const exitPromise = once(child, "exit") as Promise<[number | null, NodeJS.Signals | null]>;
  child.kill();

  const graceful = await Promise.race([
    exitPromise.then(([exitCode, exitSignal]) => ({ exitCode, exitSignal })),
    new Promise<null>((resolveTimeout) => {
      setTimeout(() => resolveTimeout(null), timeoutMs);
    })
  ]);

  if (graceful) {
    return graceful;
  }

  child.kill("SIGKILL");
  const [exitCode, exitSignal] = await exitPromise;
  return { exitCode, exitSignal };
}

export async function runOwnedChildProbe(
  options: OwnedChildProbeOptions
): Promise<OwnedChildProbeResult> {
  validateFixedPath(options.executable, "Executable");
  validateFixedPath(options.childScript, "Child script");

  const token = randomUUID();
  const args = [options.childScript, "--token", token, "--label", options.label];
  const child = spawn(options.executable, args, {
    // A packaged child script can live behind Electron's app.asar virtual path.
    // Windows CreateProcess requires a real cwd, so anchor it to the owned executable.
    cwd: path.dirname(options.executable),
    env: {
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      ...options.environment,
      MINIMAX_H3_SPIKE_CHILD_TOKEN: token
    },
    shell: false,
    detached: false,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"]
  });

  child.stdin.end();
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  const readyTimeoutMs = options.readyTimeoutMs ?? 5_000;
  const stopTimeoutMs = options.stopTimeoutMs ?? 2_000;
  let buffer = "";

  try {
    const ready = await new Promise<ReadyEvent>((resolveReady, rejectReady) => {
      const timeout = setTimeout(() => {
        rejectReady(new Error("Owned child did not report ready before timeout."));
      }, readyTimeoutMs);

      const rejectOnce = (error: Error): void => {
        clearTimeout(timeout);
        rejectReady(error);
      };

      child.once("error", rejectOnce);
      child.once("exit", (code, signal) => {
        rejectOnce(
          new Error(`Owned child exited before ready (code=${code}, signal=${signal}).`)
        );
      });
      child.stderr.once("data", (chunk: string) => {
        rejectOnce(new Error(`Owned child wrote to stderr: ${chunk.trim()}`));
      });
      child.stdout.on("data", (chunk: string) => {
        buffer += chunk;
        const newline = buffer.indexOf("\n");
        if (newline < 0) {
          return;
        }
        try {
          const parsed = JSON.parse(buffer.slice(0, newline)) as ReadyEvent;
          if (
            parsed.event !== "ready" ||
            parsed.token !== token ||
            parsed.label !== options.label ||
            parsed.pid !== child.pid
          ) {
            throw new Error("Owned child returned a mismatched identity.");
          }
          clearTimeout(timeout);
          resolveReady(parsed);
        } catch (error) {
          rejectOnce(error instanceof Error ? error : new Error("Invalid ready event."));
        }
      });
    });

    const stopped = await stopChild(child, stopTimeoutMs);
    return Object.freeze({
      label: ready.label,
      childPid: ready.pid,
      readyObserved: true,
      exitCode: stopped.exitCode,
      exitSignal: stopped.exitSignal,
      terminated: child.exitCode !== null || child.signalCode !== null
    });
  } catch (error) {
    await stopChild(child, stopTimeoutMs);
    throw error;
  }
}
