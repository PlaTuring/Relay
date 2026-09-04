import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const prototypeRoot = resolve(scriptDirectory, "..");
const repositoryRoot = resolve(scriptDirectory, "../../../..");
const reportPath = resolve(repositoryRoot, "docs", "evidence", "STACK_TAURI.md");
const ignorePath = resolve(prototypeRoot, ".gitignore");

const excludedTopLevelDirectories = new Set([
  "target",
  "dist",
  "node_modules",
  ".cargo-home",
  ".rustup-home",
  ".cache",
]);
const publicTextExtensions = new Set([
  ".css",
  ".gitignore",
  ".html",
  ".json",
  ".md",
  ".mjs",
  ".ps1",
  ".rs",
  ".toml",
  ".ts",
  ".txt",
  ".yaml",
  ".yml",
]);
const requiredIgnoreEntries = [
  "target/",
  "dist/",
  "node_modules/",
  ".cargo-home/",
  ".rustup-home/",
  ".cache/",
  "artifacts/local/",
];
const userRootPattern = new RegExp(
  "[A-Za-z]:" + "[\\\\/]+" + "Users" + "[\\\\/]+" + "[^\\\\/\\s<>]+",
  "iu",
);

function repositoryRelative(filePath) {
  return relative(repositoryRoot, filePath).split(sep).join("/");
}

function isExcluded(relativeParts) {
  if (excludedTopLevelDirectories.has(relativeParts[0])) return true;
  return relativeParts[0] === "artifacts" && relativeParts[1] === "local";
}

function isPublicTextFile(name) {
  return /^README(?:\.|$)/iu.test(name) || publicTextExtensions.has(extname(name));
}

async function collectPrototypeFiles(directory = prototypeRoot) {
  const collected = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = resolve(directory, entry.name);
    const parts = relative(prototypeRoot, absolute).split(sep);
    if (isExcluded(parts)) continue;
    if (entry.isDirectory()) {
      collected.push(...(await collectPrototypeFiles(absolute)));
    } else if (entry.isFile() && isPublicTextFile(entry.name)) {
      collected.push(absolute);
    }
  }
  return collected;
}

function lineViolatesPolicy(line, currentAccountName) {
  if (userRootPattern.test(line)) return true;
  if (currentAccountName.length >= 5) {
    const escaped = currentAccountName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const accountPattern = new RegExp(
      `(?:^|[^A-Za-z0-9_])${escaped}(?:$|[^A-Za-z0-9_])`,
      "iu",
    );
    return accountPattern.test(line);
  }
  return false;
}

const syntheticPrivatePath = ["X:", "Users", "sample-account", "evidence.json"].join("\\");
if (
  !lineViolatesPolicy(syntheticPrivatePath, "") ||
  lineViolatesPolicy("D:\\MiniMaxH3\\models", "")
) {
  throw new Error("Public-evidence path lint self-test failed.");
}

const currentAccountName = (process.env.USERNAME ?? process.env.USER ?? "").trim();
const candidates = [reportPath, ...(await collectPrototypeFiles())];
const violations = [];

for (const filePath of candidates) {
  const source = await readFile(filePath, "utf8");
  const lines = source.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    if (lineViolatesPolicy(lines[index] ?? "", currentAccountName)) {
      violations.push(`${repositoryRelative(filePath)}:${index + 1}`);
    }
  }
}

const ignoreEntries = new Set(
  (await readFile(ignorePath, "utf8"))
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean),
);
for (const requiredEntry of requiredIgnoreEntries) {
  if (!ignoreEntries.has(requiredEntry)) {
    violations.push(`prototypes/phase0/stack-tauri/.gitignore:missing:${requiredEntry}`);
  }
}

if (violations.length > 0) {
  process.stderr.write(
    `Public-evidence path lint failed at ${violations.join(", ")}; offending content suppressed.\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `${JSON.stringify({ event: "public-evidence-path-lint", filesScanned: candidates.length, status: "pass" })}\n`,
  );
}
