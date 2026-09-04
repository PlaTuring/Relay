import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  REASONS,
  RunnerError,
  containsSensitiveOutput,
  createRunnerPolicy,
  parseManifestText,
  runManifest,
  sanitizeOutput,
  validateManifest
} from "../../scripts/test/runner-core.mjs";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "../..");
const manifestRoot = resolve(testDirectory, "fixtures/manifests");
const networkGuardPath = resolve(repositoryRoot, "scripts/test/network-deny.mjs");

async function loadFixture(name) {
  return parseManifestText(await readFile(resolve(manifestRoot, name), "utf8"));
}

function expectReason(callback, reason) {
  assert.throws(callback, (error) => error instanceof RunnerError && error.code === reason);
}

function policy(unavailableAdapters = []) {
  return createRunnerPolicy({ repositoryRoot, networkGuardPath, unavailableAdapters });
}

async function runFixture(name, unavailableAdapters = []) {
  const manifest = validateManifest(await loadFixture(name), repositoryRoot);
  return await runManifest(manifest, "fast", policy(unavailableAdapters));
}

async function waitUntilDead(pid) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error?.code === "ESRCH") alive = false;
      else throw error;
    }
    if (!alive) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  assert.fail("timed-out descendant remained alive");
}

test("rejects shell metacharacters before spawn with an exact reason", async () => {
  const manifest = await loadFixture("injection.json");
  expectReason(
    () => validateManifest(manifest, repositoryRoot),
    REASONS.SHELL_METACHARACTER
  );
});

test("rejects duplicate IDs before execution with an exact reason", async () => {
  const manifest = await loadFixture("duplicate-id.json");
  expectReason(() => validateManifest(manifest, repositoryRoot), REASONS.DUPLICATE_ID);
});

test("rejects every forbidden execution lane with an exact reason", async () => {
  const source = await loadFixture("forbidden-lane.json");
  for (const lane of ["gpu", "model", "h3", "comfy", "comfyui", "desktop", "vm", "network", "download"]) {
    const manifest = structuredClone(source);
    manifest.tests[0].lane = lane;
    expectReason(() => validateManifest(manifest, repositoryRoot), REASONS.FORBIDDEN_LANE);
  }
});

test("missing allowlisted executable is failed, never passed", async () => {
  const result = await runFixture("missing-executable.json", ["node_script"]);
  assert.equal(result.exitCode, 1);
  assert.deepEqual(
    [result.results[0].status, result.results[0].reason],
    ["failed", REASONS.EXECUTABLE_NOT_FOUND]
  );
});

test("nonzero child exit is failed with an exact reason", async () => {
  const result = await runFixture("nonzero.json");
  assert.equal(result.exitCode, 1);
  assert.deepEqual(
    [result.results[0].status, result.results[0].reason],
    ["failed", REASONS.CHILD_NONZERO]
  );
});

test("oversized output is bounded, terminated and failed exactly", async () => {
  const result = await runFixture("oversized-output.json");
  assert.equal(result.exitCode, 1);
  assert.deepEqual(
    [result.results[0].status, result.results[0].reason],
    ["failed", REASONS.OUTPUT_LIMIT]
  );
  assert.ok(Buffer.byteLength(result.results[0].stdout_excerpt ?? "", "utf8") <= 4096);
  assert.ok(Buffer.byteLength(result.results[0].stderr_excerpt ?? "", "utf8") <= 4096);
});

test("private paths, tokens and prompts are detected and suppressed", async () => {
  const raw = [
    "X:\\Users\\fixture-account\\secret.txt",
    "AUTH_TOKEN=sk-fixturetokenvalue",
    "prompt=this is private"
  ].join("\n");
  assert.equal(containsSensitiveOutput(raw, repositoryRoot), true);
  const sanitized = sanitizeOutput(raw, repositoryRoot);
  assert.doesNotMatch(sanitized, /fixture-account|fixturetokenvalue|this is private/u);

  const result = await runFixture("private-path.json");
  assert.equal(result.exitCode, 1);
  assert.deepEqual(
    [result.results[0].status, result.results[0].reason],
    ["failed", REASONS.SENSITIVE_OUTPUT]
  );
  assert.equal("stdout_excerpt" in result.results[0], false);
  assert.equal("stderr_excerpt" in result.results[0], false);
});

test("timeout kills the owned descendant process tree", async () => {
  const result = await runFixture("timeout.json");
  assert.equal(result.exitCode, 1);
  assert.deepEqual(
    [result.results[0].status, result.results[0].reason],
    ["failed", REASONS.TIMEOUT]
  );
  const match = /GRANDCHILD_PID=(\d+)/u.exec(result.results[0].stdout_excerpt ?? "");
  assert.ok(match, "timeout fixture did not report its descendant PID");
  await waitUntilDead(Number(match[1]));
});

test("network APIs are denied in a descendant before an outbound attempt", async () => {
  const result = await runFixture("network-attempt.json");
  assert.equal(result.exitCode, 1);
  assert.deepEqual(
    [result.results[0].status, result.results[0].reason],
    ["failed", REASONS.CHILD_NONZERO]
  );
  assert.match(result.results[0].stdout_excerpt, /RUNNER\.NETWORK_FORBIDDEN/u);
  assert.doesNotMatch(result.results[0].stdout_excerpt, /NETWORK_GUARD_MISSING/u);
});

test("Unicode and spaces in repository-relative paths execute safely", async () => {
  const result = await runFixture("unicode-space.json");
  assert.equal(result.exitCode, 0);
  assert.equal(result.results[0].status, "passed");

  const unicodeRepositoryRoot = resolve(testDirectory, "fixtures/仓库 根路径 Ω");
  const nestedManifest = validateManifest(
    {
      schema_version: 1,
      tests: [
        {
          id: "unicode-repository-root",
          lane: "fast",
          kind: "runner",
          required: true,
          adapter: "node_script",
          script: "tests/pass.mjs",
          args: [],
          timeout_ms: 5000,
          max_output_bytes: 4096
        }
      ]
    },
    unicodeRepositoryRoot
  );
  const nestedResult = await runManifest(
    nestedManifest,
    "fast",
    createRunnerPolicy({
      repositoryRoot: unicodeRepositoryRoot,
      networkGuardPath
    })
  );
  assert.equal(nestedResult.exitCode, 0);
  assert.equal(nestedResult.results[0].status, "passed");
});

test("execution order is lexical and independent of manifest order", async () => {
  const source = await loadFixture("unicode-space.json");
  const first = structuredClone(source.tests[0]);
  first.id = "z-last";
  const second = structuredClone(source.tests[0]);
  second.id = "a-first";
  const manifest = validateManifest({ schema_version: 1, tests: [first, second] }, repositoryRoot);
  const result = await runManifest(manifest, "fast", policy());
  assert.deepEqual(result.results.map(({ id }) => id), ["a-first", "z-last"]);
  assert.equal(result.exitCode, 0);
});

test("optional missing prerequisite is blocked and other lane is skipped", async () => {
  const source = await loadFixture("missing-executable.json");
  const optional = structuredClone(source.tests[0]);
  optional.required = false;
  const otherLane = structuredClone(source.tests[0]);
  otherLane.id = "local-stack-not-selected";
  otherLane.lane = "local_stack";
  const manifest = validateManifest(
    { schema_version: 1, tests: [otherLane, optional] },
    repositoryRoot
  );
  const result = await runManifest(
    manifest,
    "fast",
    policy(["node_script"])
  );
  assert.equal(result.exitCode, 2);
  assert.deepEqual(
    result.results.map(({ id, status, reason }) => [id, status, reason]),
    [
      ["local-stack-not-selected", "skipped", REASONS.LANE_NOT_SELECTED],
      ["missing-executable", "blocked", REASONS.EXECUTABLE_NOT_FOUND]
    ]
  );

  const fastOnly = validateManifest(source, repositoryRoot);
  await assert.rejects(
    () => runManifest(fastOnly, "local_stack", policy()),
    (error) => error instanceof RunnerError && error.code === REASONS.LANE_EMPTY
  );
});
