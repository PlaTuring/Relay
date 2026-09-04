#!/usr/bin/env node
import { Buffer } from "node:buffer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileProject, createHandoffWorkflow, exportProject, publicError } from "../src/index.mjs";
import { MAX_PROJECT_BYTES } from "../src/constants.mjs";
import { fail } from "../src/errors.mjs";
import { readProjectJson } from "../src/local-json.mjs";
import { parseStrictJsonBytes } from "../../static-graph-lint/src/index.mjs";

function parseArguments(argv) {
  if (argv[0] !== "compile") fail("CLI.USAGE", "Expected compile command.", "/argv");
  if (argv.length === 3 && argv[1] === "--request" && argv[2] === "-") {
    return Object.freeze({ mode: "request" });
  }
  const values = new Map();
  for (let index = 1; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!['--project', '--output-dir'].includes(key) || value === undefined || values.has(key)) {
      fail("CLI.USAGE", "Expected either --request - or unique --project and --output-dir arguments.", "/argv");
    }
    values.set(key, value);
  }
  if (values.size !== 2 || !values.has("--project") || !values.has("--output-dir")) {
    fail("CLI.USAGE", "Expected either --request - or unique --project and --output-dir arguments.", "/argv");
  }
  return Object.freeze({
    mode: "export",
    projectPath: values.get("--project"),
    outputDirectory: values.get("--output-dir"),
  });
}

async function readBoundedStdin(stream) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > MAX_PROJECT_BYTES) fail("CLI.REQUEST_SIZE", "Request exceeds the bounded stdin limit.", "/request");
    chunks.push(buffer);
  }
  if (bytes === 0) fail("CLI.REQUEST_EMPTY", "Request stdin is empty.", "/request");
  try {
    return parseStrictJsonBytes(Buffer.concat(chunks), { maxFileBytes: MAX_PROJECT_BYTES }).value;
  } catch {
    fail("CLI.REQUEST_JSON", "Request stdin is not strict bounded JSON.", "/request");
  }
}

export async function main(
  argv = process.argv.slice(2),
  streams = { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr },
) {
  try {
    const args = parseArguments(argv);
    if (args.mode === "request") {
      const project = await readBoundedStdin(streams.stdin);
      const compilation = await compileProject(project);
      const workflow = createHandoffWorkflow(compilation);
      streams.stdout.write(`${JSON.stringify({ ok: true, result: { workflow } })}\n`);
    } else {
      const project = await readProjectJson(args.projectPath);
      const result = await exportProject({ project, outputDirectory: args.outputDirectory });
      streams.stdout.write(`${JSON.stringify(result)}\n`);
    }
    return 0;
  } catch (error) {
    const detail = publicError(error);
    streams.stderr.write(`${JSON.stringify({ ok: false, error: detail })}\n`);
    return detail.code.startsWith("GRAPH.") || detail.code.startsWith("TEMPLATE.") ? 1 : 2;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath.toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  process.exitCode = await main();
}
