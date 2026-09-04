import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { projectRoot, sha256File } from "./lib.mjs";

const parallelBuilds = 3;
const buildScriptPath = resolve(projectRoot, "scripts", "build-native-helper.mjs");
const nativeOutputRoot = resolve(projectRoot, "..", "..", "native", "relay-winbroker", "bin");
const publishedBinaryPath = resolve(nativeOutputRoot, "relay-winbroker.exe");
const maximumCapturedBytes = 4 * 1024 * 1024;
const buildTimeoutMs = 120_000;

function runBuild(index) {
  return new Promise((resolveBuild, rejectBuild) => {
    const child = spawn(process.execPath, [buildScriptPath], {
      cwd: projectRoot,
      env: process.env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    let capturedBytes = 0;
    let settled = false;

    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const capture = (target, chunk) => {
      capturedBytes += chunk.length;
      if (capturedBytes > maximumCapturedBytes) {
        child.kill();
        finish(() => rejectBuild(new Error(`NATIVE_BUILD_CONCURRENCY.OUTPUT_LIMIT:${index}`)));
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", (chunk) => capture(stdout, chunk));
    child.stderr.on("data", (chunk) => capture(stderr, chunk));
    child.on("error", (error) => finish(() => rejectBuild(error)));
    child.on("close", (code, signal) => finish(() => {
      const output = Buffer.concat(stdout).toString("utf8");
      const errorOutput = Buffer.concat(stderr).toString("utf8");
      if (code !== 0) {
        const error = new Error(`NATIVE_BUILD_CONCURRENCY.BUILD_FAILED:${index}:${code ?? signal ?? "unknown"}`);
        error.cause = { stdout: output.slice(0, 4_096), stderr: errorOutput.slice(0, 4_096) };
        rejectBuild(error);
        return;
      }
      if (/C1083|COMPILE_FAILED/u.test(`${output}\n${errorOutput}`)) {
        rejectBuild(new Error(`NATIVE_BUILD_CONCURRENCY.COMPILE_RACE:${index}`));
        return;
      }
      const hash = /NATIVE_BUILD sha256=([0-9a-f]{64})\b/u.exec(output)?.[1];
      if (!hash) {
        rejectBuild(new Error(`NATIVE_BUILD_CONCURRENCY.MISSING_SUCCESS_RECORD:${index}`));
        return;
      }
      resolveBuild({ index, hash });
    }));

    const timeout = setTimeout(() => {
      child.kill();
      finish(() => rejectBuild(new Error(`NATIVE_BUILD_CONCURRENCY.TIMEOUT:${index}`)));
    }, buildTimeoutMs);
  });
}

const results = await Promise.all(
  Array.from({ length: parallelBuilds }, (_, index) => runBuild(index + 1))
);
const producedHashes = new Set(results.map((result) => result.hash));
if (producedHashes.size !== 1) throw new Error("NATIVE_BUILD_CONCURRENCY.HASH_MISMATCH");

const expectedHash = results[0].hash;
const publishedHash = await sha256File(publishedBinaryPath);
if (publishedHash !== expectedHash) {
  throw new Error(`NATIVE_BUILD_CONCURRENCY.PUBLISHED_HASH_MISMATCH:${publishedHash}`);
}

const residue = (await readdir(nativeOutputRoot))
  .filter((name) => name.startsWith(".repro-"));
if (residue.length > 0) {
  throw new Error(`NATIVE_BUILD_CONCURRENCY.TEMP_RESIDUE:${residue.join(",")}`);
}

process.stdout.write(
  `NATIVE_BUILD_CONCURRENCY status=passed processes=${parallelBuilds} sha256=${publishedHash} residue=0\n`
);
