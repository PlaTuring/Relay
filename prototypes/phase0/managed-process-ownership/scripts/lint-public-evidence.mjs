import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const prototypeRoot = resolve(scriptDirectory, "..");
const repositoryRoot = resolve(scriptDirectory, "../../../..");
const adrPath = resolve(repositoryRoot, "docs/adr/ADR-012-managed-process-network-ownership.md");
const evidencePath = resolve(prototypeRoot, "evidence/LAST_RUN.json");
const ignorePath = resolve(prototypeRoot, ".gitignore");

const excludedTopLevel = new Set(["artifacts", "work"]);
const textExtensions = new Set([".cs", ".gitignore", ".json", ".md", ".mjs", ".ps1", ".txt"]);
const requiredIgnoreEntries = ["/artifacts/local/", "/work/"];
const privateRootPattern = new RegExp(
  "[A-Za-z]:" + "[\\\\/]+" + "Users" + "[\\\\/]+" + "[^\\\\/\\s<>]+",
  "iu",
);

function repositoryRelative(path) {
  return relative(repositoryRoot, path).split(sep).join("/");
}

function lineContainsPrivateHostData(line, accountName) {
  if (privateRootPattern.test(line)) return true;
  if (accountName.length >= 5) {
    const escaped = accountName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return new RegExp(`(?:^|[^A-Za-z0-9_])${escaped}(?:$|[^A-Za-z0-9_])`, "iu").test(line);
  }
  return false;
}

const syntheticPrivate = ["X:", "Users", "sample-account", "result.txt"].join("\\");
if (
  !lineContainsPrivateHostData(syntheticPrivate, "") ||
  lineContainsPrivateHostData("D:\\MiniMaxH3\\control", "")
) {
  throw new Error("Public evidence path lint self-test failed.");
}

async function collect(directory = prototypeRoot) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = resolve(directory, entry.name);
    const parts = relative(prototypeRoot, absolute).split(sep);
    if (excludedTopLevel.has(parts[0])) continue;
    if (entry.isDirectory()) {
      files.push(...(await collect(absolute)));
    } else if (
      entry.isFile() &&
      (textExtensions.has(extname(entry.name)) || /^README(?:\.|$)/iu.test(entry.name))
    ) {
      files.push(absolute);
    }
  }
  return files;
}

const accountName = (process.env.USERNAME ?? process.env.USER ?? "").trim();
const files = [adrPath, ...(await collect())];
const violations = [];
for (const file of files) {
  const lines = (await readFile(file, "utf8")).split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    if (lineContainsPrivateHostData(lines[index] ?? "", accountName)) {
      violations.push(`${repositoryRelative(file)}:${index + 1}`);
    }
  }
}

const ignoreEntries = new Set(
  (await readFile(ignorePath, "utf8"))
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean),
);
for (const entry of requiredIgnoreEntries) {
  if (!ignoreEntries.has(entry)) {
    violations.push(`prototypes/phase0/managed-process-ownership/.gitignore:missing:${entry}`);
  }
}

const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
if (
  evidence.status !== "pass" ||
  evidence.publicEvidence?.containsTokens !== false ||
  evidence.publicEvidence?.containsPrivateAbsolutePaths !== false ||
  Object.hasOwn(evidence, "launchToken") ||
  Object.hasOwn(evidence, "ownerToken")
) {
  violations.push("prototypes/phase0/managed-process-ownership/evidence/LAST_RUN.json:evidence-contract");
}

if (violations.length > 0) {
  process.stderr.write(
    `Public evidence lint failed at ${violations.join(", ")}; offending content suppressed.\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `${JSON.stringify({ event: "managed-process-public-evidence-lint", filesScanned: files.length, status: "pass" })}\n`,
  );
}
