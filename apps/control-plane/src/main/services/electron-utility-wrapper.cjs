"use strict";

const { pathToFileURL } = require("node:url");
const { basename, resolve } = require("node:path");

const PROTOCOL = "minimax-h3.local-runtime.utility.v1";
const MAX_OUTPUT_BYTES = 1024 * 1024;
const COMMANDS = new Set([
  "ui-locations",
  "attach-plan",
  "install-plan",
  "install",
  "install-status",
  "install-cancel",
  "install-recover"
]);

function exactRecord(value, keys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    return null;
  }
  return value;
}

function boundedSink() {
  const chunks = [];
  let bytes = 0;
  return {
    stream: {
      write(value) {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
        bytes += chunk.byteLength;
        if (bytes > MAX_OUTPUT_BYTES) throw new Error("UTILITY_WRAPPER.OUTPUT_LIMIT");
        chunks.push(chunk);
        return true;
      }
    },
    bytes: () => bytes,
    text: () => Buffer.concat(chunks).toString("utf8")
  };
}

function post(value) {
  if (process.parentPort === null) return;
  process.parentPort.postMessage(value);
}

function safeErrorCode(error) {
  const code = error && typeof error === "object" ? error.code : null;
  return typeof code === "string" && /^[A-Z][A-Z0-9_.-]{1,95}$/u.test(code) ? code : null;
}

function safeMissingModuleBasename(error) {
  const message = error instanceof Error ? error.message : "";
  const match = /Cannot find (?:module|package) ['"]([^'"]+)['"]/u.exec(message);
  if (match === null) return null;
  const name = basename(match[1]);
  return /^[A-Za-z0-9._-]{1,120}$/u.test(name) ? name : null;
}

function safeCliError(text) {
  try {
    const value = JSON.parse(text);
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof value.code === "string" &&
      /^[A-Z][A-Z0-9_.-]{1,95}$/u.test(value.code)
    ) return value.code;
  } catch {
    // A malformed dependency error is reduced to the fixed internal code.
  }
  return "LOCAL_RUNTIME.INTERNAL";
}

const parentPort = process.parentPort;
if (parentPort === null || parentPort === undefined) process.exit(70);

post({ protocol: PROTOCOL, ready: true });
let handled = false;
parentPort.once("message", async (event) => {
  if (handled) return;
  handled = true;
  const request = exactRecord(event.data, ["protocol", "request_id", "command", "request_path"]);
  const requestId = request && typeof request.request_id === "string" ? request.request_id : "invalid";
  if (
    request === null ||
    request.protocol !== PROTOCOL ||
    !/^[a-f0-9]{32}$/u.test(requestId) ||
    typeof request.command !== "string" ||
    !COMMANDS.has(request.command) ||
    typeof request.request_path !== "string" ||
    !/^[A-Za-z]:\\/u.test(request.request_path) ||
    request.request_path.includes("\0")
  ) {
    post({ protocol: PROTOCOL, request_id: requestId, ok: false, stage: "request" });
    return;
  }

  const stdout = boundedSink();
  const stderr = boundedSink();
  try {
    const runtimeEntry = resolve(
      __dirname,
      "packages",
      "local-runtime",
      "bin",
      "local-runtime.mjs"
    );
    const runtime = await import(pathToFileURL(runtimeEntry).href);
    if (typeof runtime.main !== "function") throw new Error("UTILITY_WRAPPER.MAIN_EXPORT");
    const exitCode = await runtime.main(
      [request.command, "--request", request.request_path],
      {},
      { stdin: process.stdin, stdout: stdout.stream, stderr: stderr.stream }
    );
    const text = stdout.text().trim();
    if (text.length === 0 && exitCode !== 0) {
      post({
        protocol: PROTOCOL,
        request_id: requestId,
        ok: false,
        stage: "execute",
        exit_code: exitCode,
        stdout_bytes: stdout.bytes(),
        stderr_bytes: stderr.bytes(),
        error_code: safeCliError(stderr.text().trim())
      });
      return;
    }
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error("UTILITY_WRAPPER.INVALID_JSON");
    }
    post({
      protocol: PROTOCOL,
      request_id: requestId,
      ok: true,
      exit_code: exitCode,
      stdout_bytes: stdout.bytes(),
      stderr_bytes: stderr.bytes(),
      value
    });
  } catch (error) {
    post({
      protocol: PROTOCOL,
      request_id: requestId,
      ok: false,
      stage: "execute",
      stdout_bytes: stdout.bytes(),
      stderr_bytes: stderr.bytes(),
      error_code: safeErrorCode(error) ?? "UTILITY_WRAPPER.INTERNAL",
      module_basename: safeMissingModuleBasename(error)
    });
  }
});
