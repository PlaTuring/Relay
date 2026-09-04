#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstat, readdir, readFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const prototypeRoot = resolve(fileURLToPath(new URL(".", import.meta.url)));
const linterPath = join(prototypeRoot, "lint-no-self-update.mjs");
const policyPath = join(prototypeRoot, "policy.json");
const fixturesRoot = join(prototypeRoot, "fixtures");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function hashTree(root) {
  const records = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      const relativePath = relative(root, absolutePath).replace(/\\/g, "/");
      const metadata = await lstat(absolutePath);
      if (metadata.isSymbolicLink()) {
        records.push(`${relativePath}\u0000LINK`);
      } else if (metadata.isDirectory()) {
        await visit(absolutePath);
      } else if (metadata.isFile()) {
        const bytes = await readFile(absolutePath);
        const digest = createHash("sha256").update(bytes).digest("hex");
        records.push(`${relativePath}\u0000${bytes.length}\u0000${digest}`);
      }
    }
  }

  await visit(root);
  return records.sort((left, right) => left.localeCompare(right, "en"));
}

function runLinter(fixturePath) {
  const processResult = spawnSync(process.execPath, [linterPath, fixturePath, "--json"], {
    cwd: prototypeRoot,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  assert(processResult.signal === null, `Linter was terminated by signal ${processResult.signal}.`);
  assert(processResult.error === undefined, `Linter process error: ${processResult.error?.message}`);

  let report;
  try {
    report = JSON.parse(processResult.stdout);
  } catch (error) {
    throw new Error(`Linter did not emit JSON for ${basename(fixturePath)}: ${error.message}; stderr=${processResult.stderr}`);
  }
  assert(
    !JSON.stringify(report).toLowerCase().includes(fixturePath.toLowerCase()),
    `Public report leaked the absolute fixture path for ${basename(fixturePath)}.`,
  );
  return { exitCode: processResult.status, report, stderr: processResult.stderr };
}

function exactRuleIds(report) {
  return report.violations.map((violation) => violation.ruleId).sort((left, right) => left.localeCompare(right, "en"));
}

const negativeCases = [
  ["forbidden-dependency", "NSU-001"],
  ["updater-service", "NSU-002"],
  ["background-scheduler", "NSU-003"],
  ["update-script", "NSU-004"],
  ["updater-config", "NSU-005"],
  ["update-endpoint", "NSU-006"],
  ["update-channel", "NSU-007"],
  ["mutable-latest", "NSU-008"],
  ["mutable-main", "NSU-008"],
  ["remote-catalog", "NSU-009"],
  ["remote-manifest", "NSU-009"],
  ["runtime-download", "NSU-010"],
  ["update-all", "NSU-011"],
];

async function main() {
  let passed = 0;
  const before = await hashTree(prototypeRoot);
  const policy = JSON.parse(await readFile(policyPath, "utf8"));
  const linterSource = await readFile(linterPath, "utf8");

  const ruleIds = policy.rules.map((rule) => rule.id);
  assert(new Set(ruleIds).size === 12, "Policy must contain exactly NSU-000 through NSU-011 once each.");
  for (let index = 0; index <= 11; index += 1) {
    assert(ruleIds.includes(`NSU-${String(index).padStart(3, "0")}`), `Policy is missing NSU-${String(index).padStart(3, "0")}.`);
  }
  assert(
    !/\b(?:writeFile|appendFile|mkdir|mkdtemp|rm|rmdir|unlink|rename|copyFile|createWriteStream)\b/.test(linterSource),
    "Linter source imports or calls a filesystem mutation API.",
  );
  assert(
    !/(?:node:(?:http|https|net|tls|dns|dgram)|\bfetch\s*\(|\bXMLHttpRequest\b)/.test(linterSource),
    "Linter source imports or calls a network API.",
  );
  assert(!/node:child_process/.test(linterSource), "Linter source can start child processes.");
  console.log("PASS linter capability boundary is read-only, offline, and child-process-free");
  passed += 1;

  const clean = runLinter(join(fixturesRoot, "clean"));
  assert(clean.exitCode === 0, `Clean fixture exit code was ${clean.exitCode}; ${clean.stderr}`);
  assert(clean.report.result === "pass", "Clean fixture did not report pass.");
  assert(clean.report.violations.length === 0, "Clean fixture reported violations.");
  assert(clean.report.ignoredProseFiles.includes("README.md"), "Clean prose fixture was not explicitly ignored.");
  assert(clean.report.scannedFiles.includes("catalog/component-catalog.json"), "Embedded catalog was not scanned.");
  assert(clean.report.scannedFiles.includes("src/main.mjs"), "Production source was not scanned.");
  console.log("PASS clean fixture (embedded immutable catalog, normal artifact URL, prose-only mentions)");
  passed += 1;

  for (const [fixtureName, expectedRuleId] of negativeCases) {
    const result = runLinter(join(fixturesRoot, "negative", fixtureName));
    assert(result.exitCode === 1, `${fixtureName} exit code was ${result.exitCode}, expected 1.`);
    assert(result.report.result === "fail", `${fixtureName} did not report fail.`);
    assert(result.report.violations.length === 1, `${fixtureName} produced ${result.report.violations.length} violations, expected exactly 1.`);
    const actualRuleIds = exactRuleIds(result.report);
    assert(
      actualRuleIds.length === 1 && actualRuleIds[0] === expectedRuleId,
      `${fixtureName} expected only ${expectedRuleId}, got ${actualRuleIds.join(",") || "none"}.`,
    );
    assert(
      !/^[A-Za-z]:\\/.test(result.report.violations[0].file),
      `${fixtureName} violation file is an absolute Windows path.`,
    );
    console.log(`PASS ${expectedRuleId} rejects ${fixtureName} precisely`);
    passed += 1;
  }

  const after = await hashTree(prototypeRoot);
  assert(JSON.stringify(after) === JSON.stringify(before), "Policy test changed prototype files or created externalized evidence state.");
  console.log("PASS fixture/prototype tree is byte-identical after linting");
  passed += 1;

  console.log(`RESULT passed=${passed} failed=0`);
}

main().catch((error) => {
  console.error(`FAIL ${error.message}`);
  process.exitCode = 1;
});
