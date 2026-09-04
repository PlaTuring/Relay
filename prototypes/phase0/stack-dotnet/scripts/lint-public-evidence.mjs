import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const prototypeRoot = resolve(scriptDirectory, "..");
const repositoryRoot = resolve(scriptDirectory, "../../../..");
const reportPath = resolve(repositoryRoot, "docs", "evidence", "STACK_DOTNET.md");
const ignorePath = resolve(prototypeRoot, ".gitignore");

const excludedTopLevelDirectories = new Set([
  "bin",
  "obj",
  "publish",
  "packages",
  ".nuget-packages",
  ".dotnet-home",
  ".cache",
]);
const publicTextExtensions = new Set([
  ".cs",
  ".fixture",
  ".gitignore",
  ".json",
  ".md",
  ".mjs",
  ".ps1",
  ".txt",
  ".xml",
  ".xaml",
  ".yaml",
  ".yml",
]);
const requiredIgnoreEntries = [
  "bin/",
  "obj/",
  "publish/",
  "packages/",
  ".nuget-packages/",
  ".dotnet-home/",
  ".cache/",
  "artifacts/local/",
];
const userRootPattern = new RegExp(
  "[A-Za-z]:" + "[\\\\/]+" + "Users" + "[\\\\/]+" + "[^\\\\/\\s<>]+",
  "iu",
);
const secretPatterns = [
  new RegExp(["g", "h", "p", "_", "[A-Za-z0-9]{20,}"].join(""), "u"),
  new RegExp(["s", "k", "-", "[A-Za-z0-9_-]{16,}"].join(""), "u"),
  new RegExp(["A", "K", "I", "A", "[A-Z0-9]{16}"].join(""), "u"),
  new RegExp(["Bearer", "\\s+", "[A-Za-z0-9._~-]{12,}"].join(""), "iu"),
];
const rawEnvironmentDumpPatterns = [
  new RegExp(["Get-ChildItem", "\\s+", "Env:"].join(""), "iu"),
  new RegExp(["Convert", "To", "-", "Json", "[\\s\\S]{0,80}", "Env:"].join(""), "iu"),
  new RegExp(["JSON\\.stringify\\(", "process\\.env", "\\)"].join(""), "u"),
];

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
  if (secretPatterns.some((pattern) => pattern.test(line))) return true;
  if (rawEnvironmentDumpPatterns.some((pattern) => pattern.test(line))) return true;
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

async function main() {
  const syntheticPrivatePath = ["X:", "Users", "sample-account", "evidence.json"].join("\\");
  const syntheticToken = ["g", "h", "p", "_", "A".repeat(24)].join("");
  if (
    !lineViolatesPolicy(syntheticPrivatePath, "") ||
    !lineViolatesPolicy(syntheticToken, "") ||
    lineViolatesPolicy("D:\\MiniMaxH3\\models", "")
  ) {
    throw new Error("lint-self-test");
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
      violations.push(`prototypes/phase0/stack-dotnet/.gitignore:missing:${requiredEntry}`);
    }
  }

  if (violations.length > 0) {
    process.stderr.write(
      `Public-evidence lint failed at ${violations.join(", ")}; content suppressed.\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `${JSON.stringify({ event: "stack-dotnet-public-evidence-lint", filesScanned: candidates.length, status: "pass" })}\n`,
  );
}

main().catch(() => {
  process.stderr.write("Public-evidence lint failed; private diagnostics suppressed.\n");
  process.exitCode = 1;
});
