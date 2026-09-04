import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test, { after } from "node:test";

import { build } from "esbuild";

const projectRoot = resolve(import.meta.dirname, "..");
const bundleRoot = await mkdtemp(resolve(tmpdir(), "relay-handoff-timing-module-"));
const bundlePath = resolve(bundleRoot, "comfy-handoff-timing-log.mjs");
await build({
  entryPoints: [resolve(projectRoot, "src", "main", "services", "comfy-handoff-timing-log.ts")],
  outfile: bundlePath,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  legalComments: "none",
  sourcemap: false
});
const timingLog = await import(`${pathToFileURL(bundlePath).href}?fixture=handoff-timing`);

after(async () => rm(bundleRoot, { recursive: true, force: true }));

function evidence(totalMs, options = {}) {
  return {
    schemaVersion: "2.0.0",
    outcome: options.outcome ?? "loaded",
    failedStage: options.failedStage ?? null,
    stableErrorCode: options.stableErrorCode ?? null,
    totalMs,
    requestValidationMs: 1,
    inputPreparationMs: 2,
    workflowCompilationMs: 3,
    capabilityPreflightMs: 4,
    workflowPersistenceMs: 5,
    visibleHandoffMs: 6,
    visibleHandoff: options.visibleHandoff === undefined
      ? {
          schemaVersion: "1.0.0",
          outcome: "loaded",
          totalMs: 6,
          capabilityReadinessMs: 2,
          nodeDefinitionRefresh: { disposition: "performed", elapsedMs: 1 },
          workflowLoadConfirmationMs: 3
        }
      : options.visibleHandoff
  };
}

async function readLog(dataRoot) {
  return JSON.parse(await readFile(
    resolve(dataRoot, "logs", timingLog.COMFY_HANDOFF_TIMING_FILE_NAME),
    "utf8"
  ));
}

test("compile-to-Comfy timing keeps the latest 20 complete path-free samples", async () => {
  const dataRoot = await mkdtemp(resolve(tmpdir(), "relay-handoff-timing-log-"));
  try {
    for (let index = 0; index < 25; index += 1) {
      await timingLog.writeCompileAndOpenTimingEvidence(
        dataRoot,
        evidence(100 + index),
        new Date(Date.UTC(2026, 8, 4, 1, 0, index))
      );
    }

    assert.deepEqual(await readdir(resolve(dataRoot, "logs")), [timingLog.COMFY_HANDOFF_TIMING_FILE_NAME]);
    const serialized = await readFile(
      resolve(dataRoot, "logs", timingLog.COMFY_HANDOFF_TIMING_FILE_NAME),
      "utf8"
    );
    const parsed = JSON.parse(serialized);
    assert.equal(parsed.schema_version, 2);
    assert.equal(parsed.samples.length, timingLog.COMFY_HANDOFF_TIMING_HISTORY_LIMIT);
    assert.equal(parsed.samples[0].total_ms, 105);
    assert.equal(parsed.samples.at(-1).total_ms, 124);
    assert.deepEqual(parsed.samples.at(-1).stages, {
      request_validation_ms: 1,
      input_preparation_ms: 2,
      workflow_compilation_ms: 3,
      capability_preflight_ms: 4,
      workflow_persistence_ms: 5,
      visible_handoff_ms: 6,
      visible_handoff: {
        outcome: "loaded",
        total_ms: 6,
        capability_readiness_ms: 2,
        node_definition_refresh: { disposition: "performed", elapsed_ms: 1 },
        workflow_load_confirmation_ms: 3
      }
    });
    assert.doesNotMatch(serialized, /prompt|workflowName|projectId|[A-Z]:\\|Users|MiniMaxH3/iu);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("concurrent and restarted writers retain a valid bounded history", async () => {
  const dataRoot = await mkdtemp(resolve(tmpdir(), "relay-handoff-timing-concurrent-"));
  try {
    await Promise.all(Array.from({ length: 25 }, (_, index) => (
      timingLog.writeCompileAndOpenTimingEvidence(
        dataRoot,
        evidence(200 + index),
        new Date(Date.UTC(2026, 8, 4, 2, 0, index))
      )
    )));
    let parsed = await readLog(dataRoot);
    assert.equal(parsed.samples.length, 20);
    assert.deepEqual(parsed.samples.map(({ total_ms }) => total_ms), Array.from({ length: 20 }, (_, index) => 205 + index));

    await timingLog.writeCompileAndOpenTimingEvidence(
      dataRoot,
      evidence(999, { outcome: "stored_not_opened", visibleHandoff: null }),
      new Date("2026-09-04T03:00:00.000Z")
    );
    parsed = await readLog(dataRoot);
    assert.equal(parsed.samples.length, 20);
    assert.equal(parsed.samples.at(-1).total_ms, 999);
    assert.equal(parsed.samples.at(-1).stages.visible_handoff, null);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("a failed stage stores only its stable code and timing", async () => {
  const dataRoot = await mkdtemp(resolve(tmpdir(), "relay-handoff-timing-failed-"));
  try {
    await timingLog.writeCompileAndOpenTimingEvidence(
      dataRoot,
      evidence(17, {
        outcome: "failed",
        failedStage: "workflow_compilation",
        stableErrorCode: "ADAPTER_FAILED",
        visibleHandoff: null
      }),
      new Date("2026-09-04T04:00:00.000Z")
    );
    const sample = (await readLog(dataRoot)).samples[0];
    assert.equal(sample.outcome, "failed");
    assert.equal(sample.failed_stage, "workflow_compilation");
    assert.equal(sample.stable_error_code, "ADAPTER_FAILED");
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("malformed and oversized owned history is replaced with one safe sample", async () => {
  const dataRoot = await mkdtemp(resolve(tmpdir(), "relay-handoff-timing-recovery-"));
  const logs = resolve(dataRoot, "logs");
  const destination = resolve(logs, timingLog.COMFY_HANDOFF_TIMING_FILE_NAME);
  try {
    await mkdir(logs);
    await writeFile(destination, "{bad", "utf8");
    await timingLog.writeCompileAndOpenTimingEvidence(dataRoot, evidence(1));
    assert.equal((await readLog(dataRoot)).samples.length, 1);

    await writeFile(destination, "x".repeat(129 * 1024), "utf8");
    await timingLog.writeCompileAndOpenTimingEvidence(dataRoot, evidence(2));
    const parsed = await readLog(dataRoot);
    assert.equal(parsed.samples.length, 1);
    assert.equal(parsed.samples[0].total_ms, 2);
  } finally {
    await rm(dataRoot, { recursive: true, force: true });
  }
});

test("relative roots, redirected logs and linked destinations fail without touching an external sentinel", async (context) => {
  await assert.rejects(
    timingLog.writeCompileAndOpenTimingEvidence("relative-data-root", evidence(1)),
    /HANDOFF_TIMING\.DATA_ROOT_INVALID/u
  );

  const base = await mkdtemp(resolve(tmpdir(), "relay-handoff-timing-links-"));
  const dataRoot = resolve(base, "data");
  const external = resolve(base, "external");
  const sentinel = resolve(external, "sentinel.txt");
  await mkdir(dataRoot);
  await mkdir(external);
  await writeFile(sentinel, "unchanged", "utf8");
  try {
    try {
      await symlink(external, resolve(dataRoot, "logs"), process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (["EPERM", "EACCES", "UNKNOWN"].includes(error?.code)) {
        context.skip("symlink or junction creation is unavailable on this host");
        return;
      }
      throw error;
    }
    await assert.rejects(
      timingLog.writeCompileAndOpenTimingEvidence(dataRoot, evidence(2)),
      /HANDOFF_TIMING\.DIRECTORY_UNSAFE/u
    );
    assert.equal(await readFile(sentinel, "utf8"), "unchanged");

    await rm(resolve(dataRoot, "logs"), { force: true });
    await mkdir(resolve(dataRoot, "logs"));
    const destination = resolve(dataRoot, "logs", timingLog.COMFY_HANDOFF_TIMING_FILE_NAME);
    await symlink(sentinel, destination, "file");
    await assert.rejects(
      timingLog.writeCompileAndOpenTimingEvidence(dataRoot, evidence(3)),
      /HANDOFF_TIMING\.DESTINATION_UNSAFE/u
    );
    assert.equal(await readFile(sentinel, "utf8"), "unchanged");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
