#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  RunnerError,
  createRunnerPolicy,
  readAndValidateManifest,
  runManifest
} from "./runner-core.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const manifestPath = resolve(scriptDirectory, "test-manifest.json");
const networkGuardPath = resolve(scriptDirectory, "network-deny.mjs");

function parseLane(argumentsList) {
  if (argumentsList.length !== 2 || argumentsList[0] !== "--lane") {
    throw new RunnerError("RUNNER.CLI_INVALID_ARGUMENT");
  }
  return argumentsList[1];
}

function render(result, lane) {
  process.stdout.write(`RUNNER lane=${lane} order=lexical shell=false network=denied\n`);
  for (const item of result.results) {
    const label = item.status.toUpperCase();
    const reason = item.reason ? ` reason=${item.reason}` : "";
    process.stdout.write(`${label} ${item.id}${reason}\n`);
  }
  const { passed, failed, blocked, skipped } = result.summary;
  process.stdout.write(
    `SUMMARY passed=${passed} failed=${failed} blocked=${blocked} skipped=${skipped}\n`
  );
}

async function main() {
  const lane = parseLane(process.argv.slice(2));
  const manifest = readAndValidateManifest(manifestPath, repositoryRoot);
  const policy = createRunnerPolicy({ repositoryRoot, networkGuardPath });
  const result = await runManifest(manifest, lane, policy);
  render(result, lane);
  process.exitCode = result.exitCode;
}

main().catch((error) => {
  const reason = error instanceof RunnerError ? error.code : "RUNNER.INTERNAL";
  process.stderr.write(`RUNNER_ABORT reason=${reason}\n`);
  process.exitCode = 3;
});
