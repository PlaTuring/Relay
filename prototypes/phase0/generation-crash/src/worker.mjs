import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ProtocolError,
  assertScenarioOwned,
  cleanupGeneration,
  materializeAndActivate,
  prepareParentChildGeneration
} from "./protocol.mjs";

const sourceDirectory = dirname(fileURLToPath(import.meta.url));

function parseArguments(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index];
    const value = values[index + 1];
    if (!key?.startsWith("--") || value === undefined || key in parsed) throw new Error("GC.WORKER_ARGUMENTS");
    parsed[key] = value;
  }
  const allowed = new Set(["--action", "--scenario", "--generation", "--fault"]);
  if (Object.keys(parsed).some((key) => !allowed.has(key))) throw new Error("GC.WORKER_ARGUMENTS");
  if (!parsed["--action"] || !parsed["--scenario"] || !parsed["--generation"]) throw new Error("GC.WORKER_ARGUMENTS");
  return {
    action: parsed["--action"],
    scenarioRoot: resolve(parsed["--scenario"]),
    generationId: parsed["--generation"],
    fault: parsed["--fault"] ?? null
  };
}

try {
  const { action, scenarioRoot, generationId, fault } = parseArguments(process.argv.slice(2));
  assertScenarioOwned(scenarioRoot);
  if (action === "build-activate") {
    materializeAndActivate(scenarioRoot, generationId, fault);
    process.stdout.write("WORKER_OK\n");
  } else if (action === "cleanup") {
    cleanupGeneration(scenarioRoot, generationId, fault);
    process.stdout.write("WORKER_OK\n");
  } else if (action === "parent-child") {
    prepareParentChildGeneration(scenarioRoot, generationId);
    const child = spawn(process.execPath, [
      resolve(sourceDirectory, "active-child.mjs"),
      "--scenario",
      scenarioRoot,
      "--generation",
      generationId,
      "--parent-pid",
      String(process.pid)
    ], {
      shell: false,
      stdio: "ignore",
      windowsHide: true
    });
    child.once("error", () => process.exit(3));
    setInterval(() => {}, 1000);
  } else {
    throw new Error("GC.WORKER_ARGUMENTS");
  }
} catch (error) {
  const code = error instanceof ProtocolError ? error.code : "GC.WORKER_FAILED";
  process.stderr.write(`${code}\n`);
  process.exitCode = 2;
}
