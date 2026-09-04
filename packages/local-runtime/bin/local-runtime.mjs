#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  LocalRuntimeError,
  cancelInstall,
  createSyntheticSmokePlan,
  getInstallStatus,
  initializeInstallTransaction,
  inspectLocalRuntime,
  installComponents,
  loadEmbeddedCatalogFromJson,
  observeMediaCapabilities,
  prepareInstallPlan,
  publicError,
  readInstallTransaction,
  recoverInstall,
  resolveUiLocations,
  runSidecarOperation,
  transitionInstallTransaction
} from "../src/index.mjs";
import { runtimeFail } from "../src/errors.mjs";
import { stableJson } from "../src/util.mjs";

const MAX_REQUEST_BYTES = 16 * 1024 * 1024;

async function readStdin(stream) {
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > MAX_REQUEST_BYTES) runtimeFail("LOCAL_RUNTIME.INPUT_TOO_LARGE", "cli", "local_runtime.cli.input_limit");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

async function readJsonRequest(source, stdin) {
  let bytes;
  try {
    bytes = source === "-" ? await readStdin(stdin) : await readFile(source);
  } catch {
    runtimeFail("LOCAL_RUNTIME.INPUT_READ_FAILED", "cli", "local_runtime.cli.input_read");
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_REQUEST_BYTES || (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)) {
    runtimeFail("LOCAL_RUNTIME.INVALID_JSON", "cli", "local_runtime.cli.utf8_json_no_bom");
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    runtimeFail("LOCAL_RUNTIME.INVALID_UTF8", "cli", "local_runtime.cli.valid_utf8");
  }
  try {
    const value = JSON.parse(text);
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("shape");
    return value;
  } catch {
    runtimeFail("LOCAL_RUNTIME.INVALID_JSON", "cli", "local_runtime.cli.json_object");
  }
}

function requestSource(argv) {
  if (argv.length !== 2 || argv[0] !== "--request" || typeof argv[1] !== "string" || argv[1].length === 0) {
    runtimeFail("LOCAL_RUNTIME.INVALID_ARGUMENTS", "cli", "local_runtime.cli.request_argument");
  }
  return argv[1];
}

async function dispatch(command, input, dependencies) {
  if (command === "attach-plan") return inspectLocalRuntime(input, dependencies);
  if (command === "install-plan") return prepareInstallPlan(input, dependencies);
  if (command === "install") return installComponents(input, dependencies);
  if (command === "install-status") return getInstallStatus(input, dependencies);
  if (command === "install-cancel") return cancelInstall(input, dependencies);
  if (command === "install-recover") return recoverInstall(input, dependencies);
  if (command === "catalog-validate") return loadEmbeddedCatalogFromJson(input);
  if (command === "sidecar") return runSidecarOperation(input);
  if (command === "media-probe") return observeMediaCapabilities(input);
  if (command === "ui-locations") return resolveUiLocations(input, dependencies);
  if (command === "transaction-init") return initializeInstallTransaction(input);
  if (command === "transaction-status") return readInstallTransaction(input);
  if (command === "transaction-transition") return transitionInstallTransaction(input);
  runtimeFail("LOCAL_RUNTIME.UNKNOWN_COMMAND", "cli", "local_runtime.cli.command");
}

export async function main(
  argv = process.argv.slice(2),
  dependencies = {},
  streams = { stdin: process.stdin, stdout: process.stdout, stderr: process.stderr }
) {
  try {
    const command = argv[0];
    let result;
    if (command === "smoke") {
      if (argv.length !== 1) runtimeFail("LOCAL_RUNTIME.INVALID_ARGUMENTS", "cli", "local_runtime.cli.smoke_arguments");
      result = await createSyntheticSmokePlan();
    } else {
      const source = requestSource(argv.slice(1));
      const request = await readJsonRequest(source, streams.stdin);
      result = await dispatch(command, request, dependencies);
    }
    streams.stdout.write(`${stableJson(result)}\n`);
    if (command === "attach-plan" && result.attach_plan?.status === "blocked") return 1;
    return 0;
  } catch (error) {
    streams.stderr.write(`${stableJson(publicError(error))}\n`);
    if (error instanceof LocalRuntimeError) return error.exit_code;
    if (error && typeof error === "object" && typeof error.code === "string") return 1;
    return 70;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath.toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  process.exitCode = await main();
}
