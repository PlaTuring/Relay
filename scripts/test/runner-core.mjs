import { spawn, spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const REASONS = Object.freeze({
  CHILD_NONZERO: "RUNNER.CHILD_NONZERO",
  CLEANUP_FAILED: "RUNNER.CLEANUP_FAILED",
  EXECUTABLE_NOT_FOUND: "RUNNER.EXECUTABLE_NOT_FOUND",
  FORBIDDEN_LANE: "RUNNER.MANIFEST_FORBIDDEN_LANE",
  INTERNAL: "RUNNER.INTERNAL",
  LANE_EMPTY: "RUNNER.LANE_EMPTY",
  INVALID_ARGUMENT: "RUNNER.MANIFEST_INVALID_ARGUMENT",
  INVALID_LANE: "RUNNER.MANIFEST_INVALID_LANE",
  INVALID_SHAPE: "RUNNER.MANIFEST_INVALID_SHAPE",
  INVALID_VALUE: "RUNNER.MANIFEST_INVALID_VALUE",
  LANE_NOT_SELECTED: "RUNNER.LANE_NOT_SELECTED",
  MANIFEST_PARSE: "RUNNER.MANIFEST_PARSE",
  OUTPUT_LIMIT: "RUNNER.OUTPUT_LIMIT",
  SCRIPT_NOT_FOUND: "RUNNER.MANIFEST_SCRIPT_NOT_FOUND",
  SCRIPT_PATH: "RUNNER.MANIFEST_SCRIPT_PATH",
  SENSITIVE_OUTPUT: "RUNNER.SENSITIVE_OUTPUT",
  SHELL_METACHARACTER: "RUNNER.MANIFEST_SHELL_METACHARACTER",
  SPAWN_FAILED: "RUNNER.SPAWN_FAILED",
  TIMEOUT: "RUNNER.TIMEOUT",
  UNKNOWN_FIELD: "RUNNER.MANIFEST_UNKNOWN_FIELD",
  DUPLICATE_ID: "RUNNER.MANIFEST_DUPLICATE_ID"
});

const ALLOWED_TOP_LEVEL_FIELDS = new Set(["schema_version", "tests"]);
const ALLOWED_TEST_FIELDS = new Set([
  "id",
  "lane",
  "kind",
  "required",
  "adapter",
  "script",
  "args",
  "timeout_ms",
  "max_output_bytes"
]);
const ALLOWED_LANES = new Set(["fast", "local_stack"]);
const FORBIDDEN_LANES = new Set([
  "gpu",
  "model",
  "h3",
  "comfy",
  "comfyui",
  "desktop",
  "vm",
  "network",
  "download"
]);
const ALLOWED_KINDS = new Set(["contract", "policy", "runner", "static", "unit"]);
const ALLOWED_ADAPTERS = new Set(["node_script", "node_test"]);
const ALLOWED_SCRIPT_PREFIXES = ["prototypes/phase0/", "scripts/test/", "tests/"];
const MAX_TESTS = 512;
const MAX_ARGUMENTS = 32;
const MAX_ARGUMENT_BYTES = 4096;
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 120000;
const MIN_OUTPUT_BYTES = 256;
const MAX_OUTPUT_BYTES = 262144;
const EXCERPT_BYTES = 4096;

export class RunnerError extends Error {
  constructor(code) {
    super(code);
    this.name = "RunnerError";
    this.code = code;
  }
}

function fail(code) {
  throw new RunnerError(code);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function lexicalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertOnlyFields(value, allowed) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(REASONS.UNKNOWN_FIELD);
  }
}

function hasShellMetacharacter(value) {
  return (
    /[;&|<>`^\r\n\0]/u.test(value) ||
    /\$[({]/u.test(value) ||
    /%[^%\r\n]+%/u.test(value)
  );
}

function normalizeRelativeScriptPath(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    isAbsolute(value) ||
    value.includes("\\") ||
    value.includes("\0") ||
    value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    fail(REASONS.SCRIPT_PATH);
  }
  if (!ALLOWED_SCRIPT_PREFIXES.some((prefix) => value.startsWith(prefix))) {
    fail(REASONS.SCRIPT_PATH);
  }
  if (!/\.(?:c?js|mjs)$/u.test(value)) fail(REASONS.SCRIPT_PATH);
  return value;
}

function validateArgument(value) {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") > MAX_ARGUMENT_BYTES ||
    value.includes("\0")
  ) {
    fail(REASONS.INVALID_ARGUMENT);
  }
  if (hasShellMetacharacter(value)) fail(REASONS.SHELL_METACHARACTER);
  return value;
}

function verifyMaterializedScript(repositoryRoot, script) {
  const repositoryRealPath = realpathSync(repositoryRoot);
  const absolutePath = resolve(repositoryRealPath, ...script.split("/"));
  const relativePath = relative(repositoryRealPath, absolutePath);
  if (relativePath.startsWith(`..${sep}`) || relativePath === ".." || isAbsolute(relativePath)) {
    fail(REASONS.SCRIPT_PATH);
  }
  if (!existsSync(absolutePath)) fail(REASONS.SCRIPT_NOT_FOUND);
  const metadata = lstatSync(absolutePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) fail(REASONS.SCRIPT_PATH);
  const materializedPath = realpathSync(absolutePath);
  const materializedRelative = relative(repositoryRealPath, materializedPath);
  if (
    materializedRelative.startsWith(`..${sep}`) ||
    materializedRelative === ".." ||
    isAbsolute(materializedRelative)
  ) {
    fail(REASONS.SCRIPT_PATH);
  }
  return materializedPath;
}

export function parseManifestText(source) {
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    fail(REASONS.MANIFEST_PARSE);
  }
  return value;
}

export function validateManifest(value, repositoryRoot) {
  if (!isPlainObject(value)) fail(REASONS.INVALID_SHAPE);
  assertOnlyFields(value, ALLOWED_TOP_LEVEL_FIELDS);
  if (value.schema_version !== 1 || !Array.isArray(value.tests)) fail(REASONS.INVALID_SHAPE);
  if (value.tests.length === 0 || value.tests.length > MAX_TESTS) fail(REASONS.INVALID_VALUE);

  const ids = new Set();
  const normalized = [];
  for (const candidate of value.tests) {
    if (!isPlainObject(candidate)) fail(REASONS.INVALID_SHAPE);
    assertOnlyFields(candidate, ALLOWED_TEST_FIELDS);
    if (typeof candidate.id !== "string" || !/^[a-z0-9][a-z0-9._-]{0,79}$/u.test(candidate.id)) {
      fail(REASONS.INVALID_VALUE);
    }
    if (ids.has(candidate.id)) fail(REASONS.DUPLICATE_ID);
    ids.add(candidate.id);

    if (typeof candidate.lane !== "string") fail(REASONS.INVALID_LANE);
    const normalizedLane = candidate.lane.toLowerCase();
    if (FORBIDDEN_LANES.has(normalizedLane)) fail(REASONS.FORBIDDEN_LANE);
    if (!ALLOWED_LANES.has(candidate.lane)) fail(REASONS.INVALID_LANE);
    if (!ALLOWED_KINDS.has(candidate.kind)) fail(REASONS.INVALID_VALUE);
    if (typeof candidate.required !== "boolean") fail(REASONS.INVALID_VALUE);
    if (!ALLOWED_ADAPTERS.has(candidate.adapter)) fail(REASONS.INVALID_VALUE);

    const script = normalizeRelativeScriptPath(candidate.script);
    if (!Array.isArray(candidate.args) || candidate.args.length > MAX_ARGUMENTS) {
      fail(REASONS.INVALID_ARGUMENT);
    }
    const args = candidate.args.map(validateArgument);
    if (candidate.adapter === "node_test" && args.length !== 0) {
      fail(REASONS.INVALID_ARGUMENT);
    }
    if (
      !Number.isInteger(candidate.timeout_ms) ||
      candidate.timeout_ms < MIN_TIMEOUT_MS ||
      candidate.timeout_ms > MAX_TIMEOUT_MS
    ) {
      fail(REASONS.INVALID_VALUE);
    }
    if (
      !Number.isInteger(candidate.max_output_bytes) ||
      candidate.max_output_bytes < MIN_OUTPUT_BYTES ||
      candidate.max_output_bytes > MAX_OUTPUT_BYTES
    ) {
      fail(REASONS.INVALID_VALUE);
    }

    normalized.push({
      ...candidate,
      script,
      args,
      absolute_script: verifyMaterializedScript(repositoryRoot, script)
    });
  }

  normalized.sort((left, right) => lexicalCompare(left.id, right.id));
  return Object.freeze({ schema_version: 1, tests: Object.freeze(normalized) });
}

export function readAndValidateManifest(manifestPath, repositoryRoot) {
  let source;
  try {
    source = readFileSync(manifestPath, "utf8");
  } catch {
    fail(REASONS.MANIFEST_PARSE);
  }
  return validateManifest(parseManifestText(source), repositoryRoot);
}

function replaceLiteral(text, value, replacement) {
  if (!value || typeof value !== "string") return text;
  return text.split(value).join(replacement);
}

function sensitivePatterns(repositoryRoot) {
  const literalRoots = [
    repositoryRoot,
    process.env.USERPROFILE,
    process.env.HOME,
    process.env.HOMEDRIVE && process.env.HOMEPATH
      ? `${process.env.HOMEDRIVE}${process.env.HOMEPATH}`
      : null
  ].filter(Boolean);
  return {
    literalRoots,
    patterns: [
      /[A-Za-z]:[\\/][^\r\n"'<>]*/giu,
      /\\\\[^\\/\r\n"'<>]+[\\/][^\r\n"'<>]*/gu,
      /[A-Za-z]:[\\/]Users[\\/][^\\/\s"'<>]+(?:[\\/][^\r\n"'<>]*)?/giu,
      /(?:^|[\s"'])\/(?:home|Users)\/[^/\s"'<>]+(?:\/[^\r\n"'<>]*)?/gmu,
      /\b(?:(?:ghp|github_pat|glpat)_[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{8,})\b/gu,
      /\bBearer\s+[A-Za-z0-9._~+\/-]{8,}={0,2}\b/giu,
      /\b(?:API[_-]?KEY|ACCESS[_-]?TOKEN|AUTH[_-]?TOKEN|SECRET)\s*[:=]\s*[^\s,;]+/giu,
      /(?:"prompt"\s*:\s*"(?:[^"\\]|\\.)*"|\bprompt\s*[:=]\s*[^\r\n]+)/giu
    ]
  };
}

export function containsSensitiveOutput(text, repositoryRoot) {
  const { literalRoots, patterns } = sensitivePatterns(repositoryRoot);
  const folded = text.toLowerCase();
  if (literalRoots.some((value) => folded.includes(String(value).toLowerCase()))) return true;
  return patterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}

export function sanitizeOutput(text, repositoryRoot) {
  const { literalRoots, patterns } = sensitivePatterns(repositoryRoot);
  let value = String(text);
  value = replaceLiteral(value, repositoryRoot, "<repo>");
  value = replaceLiteral(value, repositoryRoot.replaceAll("\\", "/"), "<repo>");
  for (const root of literalRoots) {
    value = replaceLiteral(value, root, "<private-root>");
    value = replaceLiteral(value, String(root).replaceAll("\\", "/"), "<private-root>");
  }
  const replacements = [
    "<absolute-path>",
    "<absolute-path>",
    "<private-path>",
    " <private-path>",
    "<token>",
    "Bearer <token>",
    "<secret>",
    "prompt=<redacted>"
  ];
  patterns.forEach((pattern, index) => {
    pattern.lastIndex = 0;
    value = value.replace(pattern, replacements[index]);
  });
  return value;
}

function boundedSanitizedExcerpt(text, repositoryRoot) {
  const bytes = Buffer.from(sanitizeOutput(text, repositoryRoot), "utf8");
  if (bytes.length <= EXCERPT_BYTES) return bytes.toString("utf8");
  return bytes.subarray(0, EXCERPT_BYTES).toString("utf8").replace(/\uFFFD$/u, "");
}

function buildChildEnvironment(networkGuardPath) {
  const environment = {};
  for (const key of [
    "LANG",
    "TEMP",
    "TMP",
    "TMPDIR"
  ]) {
    if (process.env[key]) environment[key] = process.env[key];
  }
  environment.PATH = dirname(process.execPath);
  environment.NODE_OPTIONS = `--import=${pathToFileURL(networkGuardPath).href}`;
  environment.CI = "1";
  environment.DOTNET_CLI_TELEMETRY_OPTOUT = "1";
  environment.DOTNET_NOLOGO = "1";
  environment.DOTNET_SKIP_FIRST_TIME_EXPERIENCE = "1";
  environment.POWERSHELL_TELEMETRY_OPTOUT = "1";
  environment.npm_config_audit = "false";
  environment.npm_config_fund = "false";
  environment.npm_config_offline = "true";
  environment.HTTP_PROXY = "http://127.0.0.1:9";
  environment.HTTPS_PROXY = "http://127.0.0.1:9";
  environment.ALL_PROXY = "http://127.0.0.1:9";
  environment.NO_PROXY = "";
  return environment;
}

function resolveWindowsTaskkill() {
  // Alpha's test runner does not select executables through PATH or environment.
  // A non-standard Windows system drive therefore fails closed at cleanup time.
  const candidates = ["C:\\Windows\\System32\\taskkill.exe"];
  for (const candidate of candidates) {
    try {
      const actual = realpathSync(candidate);
      if (basename(actual).toLowerCase() !== "taskkill.exe") continue;
      if (basename(dirname(actual)).toLowerCase() !== "system32") continue;
      if (lstatSync(actual).isFile()) return actual;
    } catch {
      // Try the next fixed Windows system candidate.
    }
  }
  return null;
}

async function terminateProcessTree(child) {
  if (!child.pid) return true;
  if (process.platform === "win32") {
    const taskkill = resolveWindowsTaskkill();
    if (!taskkill) {
      try {
        child.kill("SIGKILL");
      } catch {
        return false;
      }
      return false;
    }
    const result = spawnSync(taskkill, ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      shell: false,
      stdio: "ignore",
      timeout: 5000
    });
    if (result.status === 0) return true;
    try {
      child.kill("SIGKILL");
    } catch {
      // Cleanup remains unproven and will be reported as a hard failure.
    }
    return false;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
    return true;
  } catch {
    try {
      child.kill("SIGKILL");
      return false;
    } catch {
      return false;
    }
  }
}

function adapterArguments(test, networkGuardPath) {
  const prefix = [`--import=${pathToFileURL(networkGuardPath).href}`];
  if (test.adapter === "node_test") {
    return [...prefix, "--test", "--test-concurrency=1", test.absolute_script];
  }
  return [...prefix, test.absolute_script, ...test.args];
}

function outcome(status, test, reason, extra = {}) {
  return Object.freeze({
    id: test.id,
    required: test.required,
    status,
    reason,
    ...extra
  });
}

async function runOne(test, policy) {
  const executable = policy.executableFor(test.adapter);
  if (!executable || !existsSync(executable)) {
    return outcome(test.required ? "failed" : "blocked", test, REASONS.EXECUTABLE_NOT_FOUND);
  }
  const args = adapterArguments(test, policy.networkGuardPath);
  const child = spawn(executable, args, {
    cwd: policy.repositoryRoot,
    detached: process.platform !== "win32",
    env: buildChildEnvironment(policy.networkGuardPath),
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });

  return await new Promise((resolveResult) => {
    let completed = false;
    let forcedReason = null;
    let cleanupSucceeded = true;
    let terminationGuard = null;
    let outputBytes = 0;
    const stdoutChunks = [];
    const stderrChunks = [];

    const requestTermination = async (reason) => {
      if (forcedReason) return;
      forcedReason = reason;
      cleanupSucceeded = await terminateProcessTree(child);
      terminationGuard = setTimeout(() => {
        try {
          child.stdout.destroy();
          child.stderr.destroy();
          child.unref();
        } catch {
          // The deterministic cleanup failure below remains authoritative.
        }
        finish("failed", REASONS.CLEANUP_FAILED);
      }, 2000);
    };

    const capture = (target, chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      outputBytes += bytes.length;
      if (outputBytes <= test.max_output_bytes) target.push(bytes);
      if (outputBytes > test.max_output_bytes) void requestTermination(REASONS.OUTPUT_LIMIT);
    };
    child.stdout.on("data", (chunk) => capture(stdoutChunks, chunk));
    child.stderr.on("data", (chunk) => capture(stderrChunks, chunk));

    const timer = setTimeout(() => {
      void requestTermination(REASONS.TIMEOUT);
    }, test.timeout_ms);
    timer.unref();

    const finish = (status, reason, extra = {}) => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      if (terminationGuard) clearTimeout(terminationGuard);
      resolveResult(outcome(status, test, reason, extra));
    };

    child.once("error", (error) => {
      const reason = error && error.code === "ENOENT"
        ? REASONS.EXECUTABLE_NOT_FOUND
        : REASONS.SPAWN_FAILED;
      finish(test.required ? "failed" : "blocked", reason);
    });

    child.once("close", (code) => {
      setImmediate(() => {
        const stdout = Buffer.concat(stdoutChunks).toString("utf8");
        const stderr = Buffer.concat(stderrChunks).toString("utf8");
        const combined = `${stdout}\n${stderr}`;
        const excerpts = {
          stdout_excerpt: boundedSanitizedExcerpt(stdout, policy.repositoryRoot),
          stderr_excerpt: boundedSanitizedExcerpt(stderr, policy.repositoryRoot)
        };
        if (forcedReason) {
          if (!cleanupSucceeded) {
            finish("failed", REASONS.CLEANUP_FAILED, excerpts);
          } else {
            finish("failed", forcedReason, excerpts);
          }
          return;
        }
        if (containsSensitiveOutput(combined, policy.repositoryRoot)) {
          finish("failed", REASONS.SENSITIVE_OUTPUT);
          return;
        }
        if (code !== 0) {
          finish("failed", REASONS.CHILD_NONZERO, excerpts);
          return;
        }
        finish("passed", null);
      });
    });
  });
}

export function createRunnerPolicy({
  repositoryRoot,
  networkGuardPath,
  unavailableAdapters = []
}) {
  const fixedNodeExecutable = realpathSync(process.execPath);
  const unavailable = new Set(unavailableAdapters);
  for (const adapter of unavailable) {
    if (!ALLOWED_ADAPTERS.has(adapter)) fail(REASONS.INVALID_VALUE);
  }
  const fixedExecutables = Object.freeze({
    node_script: fixedNodeExecutable,
    node_test: fixedNodeExecutable
  });
  return Object.freeze({
    repositoryRoot: realpathSync(repositoryRoot),
    networkGuardPath: realpathSync(networkGuardPath),
    executableFor(adapter) {
      if (unavailable.has(adapter)) return null;
      return fixedExecutables[adapter] ?? null;
    }
  });
}

export async function runManifest(manifest, lane, policy) {
  if (!ALLOWED_LANES.has(lane)) fail(REASONS.INVALID_LANE);
  if (!manifest.tests.some((test) => test.lane === lane)) fail(REASONS.LANE_EMPTY);
  const results = [];
  for (const test of manifest.tests) {
    if (test.lane !== lane) {
      results.push(outcome("skipped", test, REASONS.LANE_NOT_SELECTED));
      continue;
    }
    results.push(await runOne(test, policy));
  }
  const summary = Object.freeze({
    passed: results.filter(({ status }) => status === "passed").length,
    failed: results.filter(({ status }) => status === "failed").length,
    blocked: results.filter(({ status }) => status === "blocked").length,
    skipped: results.filter(({ status }) => status === "skipped").length
  });
  const exitCode = summary.failed > 0 ? 1 : summary.blocked > 0 ? 2 : 0;
  return Object.freeze({ results: Object.freeze(results), summary, exitCode });
}
