import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { main } from "../bin/static-graph-lint.mjs";
import { documents, positiveApiGraph } from "./fixture-factory.mjs";

function stream() {
  let value = "";
  return { write(chunk) { value += chunk; }, get value() { return value; } };
}

async function invoke(argv) {
  const stdout = stream();
  const stderr = stream();
  const exitCode = await main(argv, { stdout, stderr });
  return { exitCode, stdout: stdout.value, stderr: stderr.value };
}

async function fixtureDirectory() {
  const root = await mkdtemp(path.join(os.tmpdir(), "minimax-h3-static-lint-"));
  const unicode = path.join(root, "含 空格 fixtures");
  await mkdir(unicode);
  const fixture = documents();
  const files = {
    graph: path.join(unicode, "graph 图.json"),
    allowlist: path.join(unicode, "allow list.json"),
    descriptors: path.join(unicode, "descriptor 描述.json"),
  };
  await Promise.all([
    writeFile(files.graph, JSON.stringify(positiveApiGraph()), "utf8"),
    writeFile(files.allowlist, JSON.stringify(fixture.allowlist), "utf8"),
    writeFile(files.descriptors, JSON.stringify(fixture.descriptors), "utf8"),
  ]);
  return { root, files };
}

function args(files, extra = []) {
  return [
    "--graph", files.graph,
    "--allowlist", files.allowlist,
    "--descriptors", files.descriptors,
    "--kind", "api",
    ...extra,
  ];
}

test("CLI accepts Unicode/space local regular paths, is read-only, and is byte deterministic", async (t) => {
  const fixture = await fixtureDirectory();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const before = await Promise.all(Object.values(fixture.files).map((file) => stat(file)));
  const first = await invoke(args(fixture.files));
  const second = await invoke(args(fixture.files));
  assert.equal(first.exitCode, 0);
  assert.equal(first.stderr, "");
  assert.equal(first.stdout, second.stdout);
  assert.equal(JSON.parse(first.stdout).ok, true);
  const after = await Promise.all(Object.values(fixture.files).map((file) => stat(file)));
  assert.deepEqual(after.map((item) => [item.size, item.mtimeMs]), before.map((item) => [item.size, item.mtimeMs]));
});

test("CLI lines output is compact and deterministic", async (t) => {
  const fixture = await fixtureDirectory();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const result = await invoke(args(fixture.files, ["--format", "lines"]));
  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /^PASS\tsha256:[0-9a-f]{64}\n$/);
});

test("CLI returns 1 for lint rejection and 2 for malformed input", async (t) => {
  const fixture = await fixtureDirectory();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  await writeFile(fixture.files.graph, JSON.stringify({ hostile: { class_type: "MinimaxHailuo03TextToVideoNode", inputs: {} } }), "utf8");
  const rejected = await invoke(args(fixture.files));
  assert.equal(rejected.exitCode, 1);
  assert.deepEqual(JSON.parse(rejected.stdout).diagnostics.map((item) => item.code), ["GRAPH.PARTNER_API_NODE"]);
  await writeFile(fixture.files.graph, '{"a":1,"a":2}', "utf8");
  const malformed = await invoke(args(fixture.files));
  assert.equal(malformed.exitCode, 2);
  assert.deepEqual(JSON.parse(malformed.stdout).diagnostics.map((item) => item.code), ["INPUT.DUPLICATE_JSON_KEY"]);
});

test("CLI rejects stdin, URI/URL, unknown, missing, and duplicate arguments", async (t) => {
  const fixture = await fixtureDirectory();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const stdin = await invoke(args({ ...fixture.files, graph: "-" }));
  assert.equal(stdin.exitCode, 2);
  assert.equal(JSON.parse(stdin.stderr).error.code, "CLI.LOCAL_FILE_REQUIRED");
  const uri = await invoke(args({ ...fixture.files, graph: "https://example.invalid/workflow.json" }));
  assert.equal(uri.exitCode, 2);
  assert.equal(JSON.parse(uri.stderr).error.code, "CLI.URI_FORBIDDEN");
  const unknown = await invoke([...args(fixture.files), "--surprise", "x"]);
  assert.equal(unknown.exitCode, 2);
  assert.equal(JSON.parse(unknown.stderr).error.code, "CLI.UNKNOWN_ARGUMENT");
  const duplicate = await invoke([...args(fixture.files), "--graph", fixture.files.graph]);
  assert.equal(duplicate.exitCode, 2);
  assert.equal(JSON.parse(duplicate.stderr).error.code, "CLI.DUPLICATE_ARGUMENT");
  const missing = await invoke(["--graph", fixture.files.graph]);
  assert.equal(missing.exitCode, 2);
  assert.equal(JSON.parse(missing.stderr).error.code, "CLI.REQUIRED_ARGUMENT_MISSING");
});

test("CLI rejects directories and symlink/reparse paths when detectable", async (t) => {
  const fixture = await fixtureDirectory();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const directory = await invoke(args({ ...fixture.files, graph: path.dirname(fixture.files.graph) }));
  assert.equal(directory.exitCode, 2);
  assert.equal(JSON.parse(directory.stderr).error.code, "CLI.REGULAR_FILE_REQUIRED");
  const link = path.join(fixture.root, "graph-link.json");
  try {
    await symlink(fixture.files.graph, link, "file");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
      t.skip("host does not permit creating a test symlink");
      return;
    }
    throw error;
  }
  const linked = await invoke(args({ ...fixture.files, graph: link }));
  assert.equal(linked.exitCode, 2);
  assert.equal(JSON.parse(linked.stderr).error.code, "CLI.REPARSE_PATH_FORBIDDEN");
});

test("CLI rejects ADS syntax without echoing the private path", async (t) => {
  const fixture = await fixtureDirectory();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const result = await invoke(args({ ...fixture.files, graph: `${fixture.files.graph}:stream` }));
  assert.equal(result.exitCode, 2);
  assert.equal(JSON.parse(result.stderr).error.code, "CLI.ADS_PATH_FORBIDDEN");
  assert.equal(result.stderr.includes(fixture.root), false);
});
