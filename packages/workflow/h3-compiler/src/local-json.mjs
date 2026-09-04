import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { parseStrictJsonBytes } from "../../static-graph-lint/src/index.mjs";
import { MAX_PROJECT_BYTES } from "./constants.mjs";
import { fail } from "./errors.mjs";
import { rejectAmbiguousPath } from "./exporter.mjs";

export async function readProjectJson(localPath) {
  const resolved = rejectAmbiguousPath(localPath, "/project_file");
  let stat;
  try {
    stat = await lstat(resolved);
  } catch {
    fail("IO.PROJECT_FILE", "Project file cannot be opened.", "/project_file");
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_PROJECT_BYTES) {
    fail("IO.PROJECT_FILE", "Project file must be a bounded direct local file.", "/project_file");
  }
  if (path.resolve(await realpath(resolved)) !== resolved) fail("IO.PROJECT_FILE", "Project file traverses a reparse path.", "/project_file");
  const bytes = await readFile(resolved);
  try {
    return parseStrictJsonBytes(bytes, { maxFileBytes: MAX_PROJECT_BYTES }).value;
  } catch {
    fail("PROJECT.JSON", "Project file is not strict bounded JSON.", "/project_file");
  }
}
