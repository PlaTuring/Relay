import { basename, dirname, resolve } from "node:path";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(projectRoot, "dist");

if (dirname(target) !== projectRoot || basename(target) !== "dist") {
  throw new Error("Refusing to clean a path outside the prototype dist directory.");
}

await rm(target, { recursive: true, force: true });
