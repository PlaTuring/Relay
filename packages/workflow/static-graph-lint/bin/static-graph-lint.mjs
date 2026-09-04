#!/usr/bin/env node
import path from "node:path";
import { constants as fsConstants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { LIMITS, lintStaticJsonBytes } from "../src/index.mjs";

const FLAGS = new Set(["--graph", "--allowlist", "--descriptors", "--kind", "--format"]);
const REQUIRED = ["--graph", "--allowlist", "--descriptors", "--kind"];

class CliError extends Error {
  constructor(code, instancePath) {
    super(code);
    this.payload = Object.freeze({
      ok: false,
      error: Object.freeze({ code, instance_path: instancePath, rule_id: "static_graph.cli.v1" }),
    });
  }
}

function argPath(flag) {
  return `/args/${flag.slice(2)}`;
}

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    if (typeof flag !== "string" || !FLAGS.has(flag)) throw new CliError("CLI.UNKNOWN_ARGUMENT", "/args");
    if (values.has(flag)) throw new CliError("CLI.DUPLICATE_ARGUMENT", argPath(flag));
    if (index + 1 >= argv.length || typeof argv[index + 1] !== "string" || argv[index + 1].startsWith("--")) {
      throw new CliError("CLI.ARGUMENT_VALUE_MISSING", argPath(flag));
    }
    values.set(flag, argv[index + 1]);
  }
  for (const required of REQUIRED) if (!values.has(required)) throw new CliError("CLI.REQUIRED_ARGUMENT_MISSING", argPath(required));
  if (!["visual", "api", "expanded", "bundle"].includes(values.get("--kind"))) throw new CliError("CLI.KIND_INVALID", "/args/kind");
  if (values.has("--format") && !["json", "lines"].includes(values.get("--format"))) throw new CliError("CLI.FORMAT_INVALID", "/args/format");
  return Object.freeze({
    graph: values.get("--graph"),
    allowlist: values.get("--allowlist"),
    descriptors: values.get("--descriptors"),
    kind: values.get("--kind"),
    format: values.get("--format") ?? "json",
  });
}

function rejectPathSyntax(value, label) {
  if (value === "-" || value.length === 0 || value.includes("\u0000")) throw new CliError("CLI.LOCAL_FILE_REQUIRED", `/args/${label}`);
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value) || /^file:/i.test(value)) throw new CliError("CLI.URI_FORBIDDEN", `/args/${label}`);
  if (/^(?:\\\\|\/\/|\\\\[?.]\\)/.test(value)) throw new CliError("CLI.UNC_OR_DEVICE_PATH_FORBIDDEN", `/args/${label}`);
  const parsed = path.parse(path.resolve(value));
  const remainder = path.resolve(value).slice(parsed.root.length);
  if (remainder.includes(":")) throw new CliError("CLI.ADS_PATH_FORBIDDEN", `/args/${label}`);
}

async function rejectReparseAncestors(absolute, label) {
  const parsed = path.parse(absolute);
  const remainder = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root;
  for (const part of remainder) {
    current = path.join(current, part);
    let information;
    try {
      information = await lstat(current);
    } catch {
      throw new CliError("CLI.FILE_NOT_FOUND", `/args/${label}`);
    }
    if (information.isSymbolicLink()) throw new CliError("CLI.REPARSE_PATH_FORBIDDEN", `/args/${label}`);
  }
}

async function readLocalRegularFile(value, label) {
  rejectPathSyntax(value, label);
  const absolute = path.resolve(value);
  await rejectReparseAncestors(absolute, label);
  let handle;
  try {
    handle = await open(absolute, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const information = await handle.stat();
    if (!information.isFile()) throw new CliError("CLI.REGULAR_FILE_REQUIRED", `/args/${label}`);
    if (information.size > LIMITS.maxFileBytes) throw new CliError("CLI.FILE_SIZE_LIMIT", `/args/${label}`);
    const bytes = await handle.readFile();
    if (bytes.byteLength !== information.size) throw new CliError("CLI.FILE_CHANGED_DURING_READ", `/args/${label}`);
    return bytes;
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError("CLI.FILE_READ_FAILED", `/args/${label}`);
  } finally {
    await handle?.close();
  }
}

function renderLines(result) {
  if (result.ok) return `PASS\t${result.digest}\n`;
  return `${result.diagnostics.map((item) => `${item.code}\t${item.instance_path}\t${item.rule_id}`).join("\n")}\n`;
}

export async function main(argv, streams = { stdout: process.stdout, stderr: process.stderr }) {
  try {
    const args = parseArguments(argv);
    const [graphBytes, allowlistBytes, descriptorBytes] = await Promise.all([
      readLocalRegularFile(args.graph, "graph"),
      readLocalRegularFile(args.allowlist, "allowlist"),
      readLocalRegularFile(args.descriptors, "descriptors"),
    ]);
    if (graphBytes.byteLength + allowlistBytes.byteLength + descriptorBytes.byteLength > LIMITS.maxTotalBytes) {
      throw new CliError("CLI.TOTAL_SIZE_LIMIT", "/args");
    }
    const result = lintStaticJsonBytes({ kind: args.kind, graphBytes, allowlistBytes, descriptorBytes });
    streams.stdout.write(args.format === "json" ? `${JSON.stringify(result)}\n` : renderLines(result));
    if (result.ok) return 0;
    return result.diagnostics.some((item) => item.code.startsWith("INPUT.")) ? 2 : 1;
  } catch (error) {
    const cliError = error instanceof CliError ? error : new CliError("CLI.INTERNAL_FAILURE", "/args");
    streams.stderr.write(`${JSON.stringify(cliError.payload)}\n`);
    return 2;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === path.resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = await main(process.argv.slice(2));
}
