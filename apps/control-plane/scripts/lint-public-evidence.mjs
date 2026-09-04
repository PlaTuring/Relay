import { userInfo } from "node:os";
import { readdir, readFile } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";

import { projectRoot } from "./lib.mjs";

const repositoryRoot = resolve(projectRoot, "..", "..");
const evidencePath = resolve(
  repositoryRoot,
  "docs",
  "evidence",
  "PRODUCTION_APP_SCAFFOLD.md"
);
const excludedDirectories = new Set([
  "node_modules",
  "dist",
  "artifacts",
  ".npm-cache",
  ".cache",
  ".build-cache",
  "release",
  "release-alpha",
  "release-unsigned"
]);
const textExtensions = new Set([
  ".css",
  ".gitignore",
  ".html",
  ".json",
  ".md",
  ".mjs",
  ".ts"
]);
const privateWindowsPath = /[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"'`<>]+/iu;
const privateFileUrl = /file:\/{2,3}[A-Za-z]:\/Users\/[^/\s"'`<>]+/iu;
const currentAccount = userInfo().username.toLocaleLowerCase("en-US");

async function collect(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (
      entry.isDirectory() &&
      (
        excludedDirectories.has(entry.name) ||
        entry.name.startsWith("release-") ||
        entry.name === "win-unpacked"
      )
    ) {
      continue;
    }
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collect(absolute)));
    } else if (entry.isFile() && textExtensions.has(extname(entry.name))) {
      files.push(absolute);
    }
  }
  return files;
}

const files = [...(await collect(projectRoot)), evidencePath];
for (const file of files) {
  const text = await readFile(file, "utf8");
  if (
    privateWindowsPath.test(text) ||
    privateFileUrl.test(text) ||
    (currentAccount.length >= 3 && text.toLocaleLowerCase("en-US").includes(currentAccount))
  ) {
    const locator = relative(repositoryRoot, file).split(sep).join("/");
    process.stderr.write(`PUBLIC_EVIDENCE.PRIVATE_VALUE:${locator}\n`);
    process.exit(1);
  }
}

process.stdout.write(`PUBLIC_EVIDENCE files=${files.length} violations=0\n`);
