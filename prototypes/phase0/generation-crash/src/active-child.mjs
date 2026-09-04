import { closeSync, fsyncSync, mkdirSync, openSync, writeSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  ProtocolError,
  assertScenarioOwned,
  validateOwnedIncompleteGeneration,
  writeChildActiveHook
} from "./protocol.mjs";

function parseArguments(values) {
  if (values.length !== 6 || values[0] !== "--scenario" || values[2] !== "--generation" || values[4] !== "--parent-pid") {
    throw new Error("GC.CHILD_ARGUMENTS");
  }
  const parentPid = Number(values[5]);
  if (!Number.isInteger(parentPid) || parentPid <= 0) throw new Error("GC.CHILD_ARGUMENTS");
  return { scenarioRoot: resolve(values[1]), generationId: values[3], parentPid };
}

let handle = null;
try {
  const { scenarioRoot, generationId, parentPid } = parseArguments(process.argv.slice(2));
  assertScenarioOwned(scenarioRoot);
  const owned = validateOwnedIncompleteGeneration(scenarioRoot, generationId);
  mkdirSync(dirname(owned.artifact_path), { recursive: true });
  handle = openSync(owned.artifact_path, "w");
  const chunk = Buffer.alloc(4096, 0x5a);
  writeSync(handle, chunk, 0, chunk.length, 0);
  fsyncSync(handle);
  writeChildActiveHook(scenarioRoot, parentPid);

  let position = chunk.length;
  setInterval(() => {
    writeSync(handle, chunk, 0, chunk.length, position);
    position = position >= 60 * 1024 ? 0 : position + chunk.length;
  }, 20);
} catch (error) {
  if (handle !== null) {
    try { closeSync(handle); } catch {}
  }
  const code = error instanceof ProtocolError ? error.code : "GC.CHILD_FAILED";
  process.stderr.write(`${code}\n`);
  process.exitCode = 2;
}
