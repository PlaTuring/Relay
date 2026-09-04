"use strict";

const { basename, dirname, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const PROTOCOL = "minimax-h3.workflow-compiler.utility.v1";
const MAX_OUTPUT_BYTES = 1024 * 1024;

function exactRecord(value, keys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    return null;
  }
  return value;
}

function fixedLocalPath(value) {
  if (
    typeof value !== "string" ||
    value.length < 3 ||
    value.length > 512 ||
    !/^[A-Za-z]:\\/u.test(value) ||
    value.startsWith("\\\\?\\") ||
    value.startsWith("\\\\.\\") ||
    /(?:^|\\)\.\.?(?:\\|$)/u.test(value) ||
    value.includes("\0")
  ) return null;
  return resolve(value);
}

function boundedSink() {
  const chunks = [];
  let bytes = 0;
  return {
    stream: {
      write(value) {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
        bytes += chunk.byteLength;
        if (bytes > MAX_OUTPUT_BYTES) throw new Error("WORKFLOW_WRAPPER.OUTPUT_LIMIT");
        chunks.push(chunk);
        return true;
      }
    },
    bytes: () => bytes,
    text: () => Buffer.concat(chunks).toString("utf8")
  };
}

function post(value) {
  if (process.parentPort === null || process.parentPort === undefined) return;
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

function safeCompilerError(text) {
  try {
    const value = JSON.parse(text);
    const detail = value && typeof value === "object" && !Array.isArray(value)
      && value.error && typeof value.error === "object" && !Array.isArray(value.error)
      ? value.error
      : null;
    const code = detail === null ? null : detail.code;
    const reason = detail === null ? null : detail.reason;
    if (typeof code === "string" && /^[A-Z][A-Z0-9_.-]{1,95}$/u.test(code)) {
      return {
        error_code: code,
        ...(typeof reason === "string" && /^[A-Z][A-Z0-9_]{1,95}$/u.test(reason)
          ? { error_reason: reason }
          : {})
      };
    }
  } catch {
    // A malformed compiler error is reduced to the fixed internal code.
  }
  return { error_code: "WORKFLOW_WRAPPER.COMPILER_FAILED" };
}

const parentPort = process.parentPort;
if (parentPort === null || parentPort === undefined) process.exit(70);

post({ protocol: PROTOCOL, ready: true });
let handled = false;
parentPort.once("message", async (event) => {
  if (handled) return;
  handled = true;
  const request = exactRecord(
    event.data,
    ["protocol", "request_id", "command", "project_path", "output_directory"]
  );
  const requestId = request && typeof request.request_id === "string" ? request.request_id : "invalid";
  const projectPath = request === null ? null : fixedLocalPath(request.project_path);
  const outputDirectory = request === null ? null : fixedLocalPath(request.output_directory);
  if (
    request === null ||
    request.protocol !== PROTOCOL ||
    !/^[a-f0-9]{32}$/u.test(requestId) ||
    request.command !== "compile" ||
    projectPath === null ||
    outputDirectory === null ||
    basename(projectPath) !== "project.json" ||
    basename(outputDirectory) !== "output" ||
    dirname(projectPath).toLocaleLowerCase("en-US") !== dirname(outputDirectory).toLocaleLowerCase("en-US")
  ) {
    post({
      protocol: PROTOCOL,
      request_id: requestId,
      ok: false,
      stage: "request",
      error_code: "WORKFLOW_WRAPPER.INVALID_REQUEST"
    });
    return;
  }

  const stdout = boundedSink();
  const stderr = boundedSink();
  try {
    const compilerEntry = resolve(
      __dirname,
      "packages",
      "workflow",
      "h3-compiler",
      "bin",
      "h3-compiler.mjs"
    );
    const compiler = await import(pathToFileURL(compilerEntry).href);
    if (typeof compiler.main !== "function") throw new Error("WORKFLOW_WRAPPER.MAIN_EXPORT");
    const exitCode = await compiler.main(
      ["compile", "--project", projectPath, "--output-dir", outputDirectory],
      { stdin: process.stdin, stdout: stdout.stream, stderr: stderr.stream }
    );
    const text = stdout.text().trim();
    if (exitCode !== 0) {
      const compilerError = safeCompilerError(stderr.text().trim());
      post({
        protocol: PROTOCOL,
        request_id: requestId,
        ok: false,
        stage: "execute",
        exit_code: exitCode,
        stdout_bytes: stdout.bytes(),
        stderr_bytes: stderr.bytes(),
        ...compilerError
      });
      return;
    }
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error("WORKFLOW_WRAPPER.INVALID_JSON");
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
      error_code: safeErrorCode(error) ?? "WORKFLOW_WRAPPER.INTERNAL",
      module_basename: safeMissingModuleBasename(error)
    });
  }
});
