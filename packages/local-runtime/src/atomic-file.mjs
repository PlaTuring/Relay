import { open, rename, rm } from "node:fs/promises";

import { stableJson } from "./util.mjs";

const WINDOWS_REPLACE_RETRY_DELAYS_MS = Object.freeze([0, 10, 25, 50, 100, 200, 400, 800, 1_600]);
const RETRYABLE_REPLACE_ERRORS = new Set(["EACCES", "EBUSY", "EEXIST", "EPERM"]);
let temporarySequence = 0;

function temporaryPathFor(filePath) {
  temporarySequence = (temporarySequence + 1) % Number.MAX_SAFE_INTEGER;
  return `${filePath}.${process.pid}.${Date.now().toString(36)}.${temporarySequence.toString(36)}.new`;
}

async function delay(milliseconds) {
  if (milliseconds <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function persistenceFailure(error, failureCode, ruleId, stage) {
  const wrapped = new Error(failureCode, { cause: error });
  wrapped.code = failureCode;
  wrapped.rule_id = ruleId;
  wrapped.stage = stage;
  return wrapped;
}

export async function atomicWriteText(filePath, text, {
  failureCode = "LOCAL_RUNTIME.STATE_PERSIST_FAILED",
  ruleId = "local_runtime.state.atomic_replace",
  stage = "install"
} = {}) {
  const temporary = temporaryPathFor(filePath);
  let committed = false;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(text, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }

    for (let attempt = 0; attempt < WINDOWS_REPLACE_RETRY_DELAYS_MS.length; attempt += 1) {
      await delay(WINDOWS_REPLACE_RETRY_DELAYS_MS[attempt]);
      try {
        await rename(temporary, filePath);
        committed = true;
        return;
      } catch (error) {
        const retryable = RETRYABLE_REPLACE_ERRORS.has(error?.code);
        if (!retryable || attempt === WINDOWS_REPLACE_RETRY_DELAYS_MS.length - 1) throw error;
      }
    }
  } catch (error) {
    throw persistenceFailure(error, failureCode, ruleId, stage);
  } finally {
    if (!committed) await rm(temporary, { force: true }).catch(() => {});
  }
}

export async function atomicWriteJson(filePath, value, options) {
  await atomicWriteText(filePath, `${stableJson(value)}\n`, options);
}
