import { randomBytes } from "node:crypto";
import { lstat, link, open, readFile, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { COMPILER_VERSION, TEMPLATE_REVISION } from "./constants.mjs";
import { sha256Bytes, workflowBytes } from "./canonical.mjs";
import { compileProject } from "./compiler.mjs";
import { CompilerError, fail } from "./errors.mjs";
import { createHandoffWorkflow, publicSegmentPlan } from "./handoff.mjs";

function rejectAmbiguousPath(value, instancePath) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0") || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(value)) {
    fail("IO.PATH", "Expected a local filesystem path.", instancePath);
  }
  const resolved = path.resolve(value);
  if (resolved.startsWith("\\\\") || resolved.startsWith("\\\\?\\") || resolved.startsWith("\\\\.\\")) {
    fail("IO.PATH", "Network and device paths are forbidden.", instancePath);
  }
  const drive = path.parse(resolved).root;
  if (resolved.slice(drive.length).includes(":")) fail("IO.PATH", "Alternate data streams are forbidden.", instancePath);
  return resolved;
}

async function existingSafeDirectory(value) {
  const resolved = rejectAmbiguousPath(value, "/output_directory");
  let stat;
  try {
    stat = await lstat(resolved);
  } catch {
    fail("IO.OUTPUT_DIRECTORY", "Output directory must already exist.", "/output_directory");
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("IO.OUTPUT_DIRECTORY", "Output directory is not a direct local directory.", "/output_directory");
  const identity = await realpath(resolved);
  if (path.resolve(identity) !== resolved) fail("IO.OUTPUT_DIRECTORY", "Output directory traverses a reparse path.", "/output_directory");
  return resolved;
}

async function assertAbsent(filePath) {
  try {
    await lstat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  fail("IO.OUTPUT_EXISTS", "Compiler never overwrites an existing export.", "/output_directory");
}

async function writeNewVerified(filePath, bytes) {
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`,
  );
  const handle = await open(tempPath, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await assertAbsent(filePath);
    await link(tempPath, filePath);
    const reread = await readFile(filePath);
    const expected = sha256Bytes(bytes);
    if (sha256Bytes(reread) !== expected) {
      await unlink(filePath);
      fail("IO.WRITE_VERIFY", "Export verification failed.", "/output_directory");
    }
    return expected;
  } finally {
    try { await unlink(tempPath); } catch { /* the temporary file may already be absent */ }
  }
}

function workflowFilename(entry, index, compilation) {
  return compilation.plan.single_workflow_dag || compilation.workflows.length === 1 && compilation.plan.segment_count === 1
    ? "minimax-h3.workflow.json"
    : entry.segment.planned_workflow_file ?? `minimax-h3.segment-${String(index).padStart(2, "0")}.workflow.json`;
}

export async function exportProject({ project, outputDirectory }) {
  const directory = await existingSafeDirectory(outputDirectory);
  const compilation = await compileProject(project);
  if (compilation.plan.status === "experimental_blocked") {
    fail(
      "HANDOFF.BLOCKED_SEGMENT_PLAN",
      "The requested long-video mode cannot yet be exported as one complete safe workflow.",
      "/segment_plan",
    );
  }
  const handoffWorkflow = createHandoffWorkflow(compilation);
  const names = compilation.workflows.map((entry, index) => workflowFilename(entry, index + 1, compilation));
  if (compilation.plan.segment_count > 1) names.push("minimax-h3.segment-plan.json");
  const paths = names.map((name) => path.join(directory, name));
  for (const filePath of paths) await assertAbsent(filePath);

  const created = [];
  try {
    const exported = [];
    for (let index = 0; index < compilation.workflows.length; index += 1) {
      const entry = compilation.workflows[index];
      const fileName = names[index];
      const filePath = path.join(directory, fileName);
      const workflow = index === 0 ? handoffWorkflow : entry.workflow;
      const sha256 = await writeNewVerified(filePath, workflowBytes(workflow));
      created.push(filePath);
      exported.push(Object.freeze({
        segment: entry.segment.index,
        included_segments: entry.included_segments ?? [entry.segment.index],
        file_name: fileName,
        workflow_path: filePath,
        workflow_sha256: sha256,
        template_path: entry.template.path,
        template_sha256: entry.template.sha256,
        template_structure_sha256: entry.template.structure_sha256,
        compiled_structure_sha256: entry.lint.structure_sha256,
        static_lint_digest: entry.lint.static_lint.digest,
      }));
    }
    let segmentPlan;
    if (compilation.plan.segment_count > 1) {
      const fileName = names.at(-1);
      const filePath = path.join(directory, fileName);
      const bytes = Buffer.from(`${JSON.stringify(publicSegmentPlan(compilation), null, 2)}\n`, "utf8");
      const sha256 = await writeNewVerified(filePath, bytes);
      created.push(filePath);
      segmentPlan = Object.freeze({ file_name: fileName, path: filePath, sha256 });
    }
    return Object.freeze({
      ok: true,
      compiler_version: COMPILER_VERSION,
      template_revision: TEMPLATE_REVISION,
      status: compilation.plan.status,
      exported: Object.freeze(exported),
      ...(segmentPlan ? { segment_plan: segmentPlan } : {}),
      handoff: Object.freeze({
        capability: "EXPORT_ONLY",
        status: "AWAITING_USER_OPEN",
        user_action: "Open the exported JSON in local ComfyUI, inspect the visible graph, and click Run manually.",
        automatic_execution: false,
        automatic_submission: false,
        auto_run: false,
      }),
    });
  } catch (error) {
    for (const filePath of created.reverse()) {
      try { await unlink(filePath); } catch { /* exact files created by this call only */ }
    }
    if (error instanceof CompilerError) throw error;
    fail("IO.EXPORT", "Workflow export failed.", "/output_directory");
  }
}

export { rejectAmbiguousPath };
