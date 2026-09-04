#!/usr/bin/env node

import { lstat, readdir, readFile } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDirectory = resolve(fileURLToPath(new URL(".", import.meta.url)));
const policyPath = join(moduleDirectory, "policy.json");

function normalizeKey(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function jsonPointerSegment(value) {
  return String(value).replace(/~/g, "~0").replace(/\//g, "~1");
}

function toRelativeDisplay(root, absolutePath) {
  const value = relative(root, absolutePath).replace(/\\/g, "/");
  return value || ".";
}

function stripCommentsPreservingStrings(source) {
  let state = "code";
  let result = "";
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1] ?? "";

    if (state === "line-comment") {
      if (character === "\n") {
        state = "code";
        result += "\n";
      } else {
        result += " ";
      }
      continue;
    }

    if (state === "block-comment") {
      if (character === "*" && next === "/") {
        result += "  ";
        index += 1;
        state = "code";
      } else {
        result += character === "\n" ? "\n" : " ";
      }
      continue;
    }

    if (state !== "code") {
      result += character;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (
        (state === "single-quote" && character === "'") ||
        (state === "double-quote" && character === '"') ||
        (state === "template" && character === "`")
      ) {
        state = "code";
      }
      continue;
    }

    if (character === "/" && next === "/") {
      result += "  ";
      index += 1;
      state = "line-comment";
    } else if (character === "/" && next === "*") {
      result += "  ";
      index += 1;
      state = "block-comment";
    } else if (character === "#" && (index === 0 || /\s/.test(source[index - 1]))) {
      result += " ";
      state = "line-comment";
    } else if (character === "'") {
      result += character;
      state = "single-quote";
    } else if (character === '"') {
      result += character;
      state = "double-quote";
    } else if (character === "`") {
      result += character;
      state = "template";
    } else {
      result += character;
    }
  }
  return result;
}

function lineNumberAt(source, index) {
  let line = 1;
  for (let position = 0; position < index; position += 1) {
    if (source.charCodeAt(position) === 10) line += 1;
  }
  return line;
}

function isMutableTarget(value, mutableValues) {
  const normalized = String(value).trim().toLowerCase();
  if (mutableValues.has(normalized)) return true;
  return (
    /(?:^|[/#:@])(?:latest|main|master|head)(?:$|[/#?&])/i.test(normalized) ||
    /refs\/heads\/(?:main|master)(?:$|[/#?&])/i.test(normalized) ||
    /\/releases\/latest(?:\/|$)/i.test(normalized) ||
    /[?&](?:ref|revision|branch)=(?:main|master|head)(?:&|$)/i.test(normalized)
  );
}

function isUpdateEndpoint(value) {
  const matches = String(value).match(/https?:\/\/[^\s"'`<>]+/gi) ?? [];
  for (const candidate of matches) {
    try {
      const parsed = new URL(candidate.replace(/[),.;]+$/, ""));
      const labels = parsed.hostname.toLowerCase().split(".");
      const path = parsed.pathname.toLowerCase();
      if (["update", "updates", "updater"].includes(labels[0])) return true;
      if (/(?:^|\/)updates?(?:\/|$)/.test(path)) return true;
      if (/(?:^|\/)(?:appcast\.xml|latest\.ya?ml|app-update\.ya?ml|update-feed\.json)$/.test(path)) return true;
    } catch {
      // A malformed URL is not silently interpreted as an update endpoint.
      // Other build-contract validators own general URL syntax.
    }
  }
  return false;
}

async function loadPolicy() {
  const raw = await readFile(policyPath, "utf8");
  const policy = JSON.parse(raw);
  const ruleIds = new Set();
  for (const rule of policy.rules ?? []) {
    if (!/^NSU-\d{3}$/.test(rule.id) || ruleIds.has(rule.id)) {
      throw new Error(`Invalid or duplicate policy rule ID: ${rule.id}`);
    }
    ruleIds.add(rule.id);
  }
  for (let index = 0; index <= 11; index += 1) {
    const expected = `NSU-${String(index).padStart(3, "0")}`;
    if (!ruleIds.has(expected)) throw new Error(`Policy is missing ${expected}`);
  }
  return policy;
}

function addViolation(collection, ruleId, file, location, message) {
  const key = `${ruleId}\u0000${file}\u0000${location}\u0000${message}`;
  if (collection.keys.has(key)) return;
  collection.keys.add(key);
  collection.items.push({ ruleId, file, location, message });
}

async function collectFiles(root, policy, violations) {
  const files = [];
  const ignoredDirectories = new Set(policy.ignoredDirectoryNames.map((value) => value.toLowerCase()));

  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      addViolation(
        violations,
        "NSU-000",
        toRelativeDisplay(root, directory),
        "$",
        `Directory cannot be read: ${error.code ?? "unknown"}`,
      );
      return;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      const relativePath = toRelativeDisplay(root, absolutePath);
      let metadata;
      try {
        metadata = await lstat(absolutePath);
      } catch (error) {
        addViolation(violations, "NSU-000", relativePath, "$", `Entry cannot be inspected: ${error.code ?? "unknown"}`);
        continue;
      }

      if (metadata.isSymbolicLink()) {
        addViolation(violations, "NSU-000", relativePath, "$", "Linked scan inputs are not followed; provide a materialized build inventory.");
      } else if (metadata.isDirectory()) {
        if (!ignoredDirectories.has(entry.name.toLowerCase())) await visit(absolutePath);
      } else if (metadata.isFile()) {
        files.push({ absolutePath, relativePath });
      }
    }
  }

  await visit(root);
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath, "en"));
}

function scanJson(value, context) {
  const {
    pointer,
    file,
    policy,
    violations,
    forbiddenDependencies,
    forbiddenScripts,
    forbiddenConfigKeys,
    schedulerConfigKeys,
    channelConfigKeys,
    mutableTargetKeys,
    mutableTargetValues,
    remoteCatalogKeys,
    runtimeInstallConfigKeys,
  } = context;

  if (Array.isArray(value)) {
    const normalizedItems = value.map((item) => (typeof item === "string" ? item.trim().toLowerCase() : null));
    for (let index = 0; index + 1 < normalizedItems.length; index += 1) {
      if (normalizedItems[index] === "update" && normalizedItems[index + 1] === "all") {
        addViolation(violations, "NSU-011", file, pointer, "Command array exposes 'update all'.");
        break;
      }
    }
    value.forEach((item, index) => {
      scanJson(item, { ...context, pointer: `${pointer}/${index}` });
    });
    return;
  }

  if (value === null || typeof value !== "object") {
    if (typeof value === "string") {
      const normalizedValue = value.trim().toLowerCase();
      if (["update all", "update-all", "update_all", "--update-all"].includes(normalizedValue)) {
        addViolation(violations, "NSU-011", file, pointer, "Command value exposes 'update all'.");
      }
      if (isUpdateEndpoint(value)) {
        addViolation(violations, "NSU-006", file, pointer, "Update-service/appcast endpoint is forbidden in Alpha.");
      }
    }
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const childPointer = `${pointer}/${jsonPointerSegment(key)}`;
    const normalized = normalizeKey(key);

    if (["dependencies", "devdependencies", "optionaldependencies", "peerdependencies", "bundleddependencies"].includes(normalized)) {
      if (child && typeof child === "object" && !Array.isArray(child)) {
        for (const dependencyName of Object.keys(child)) {
          if (forbiddenDependencies.has(dependencyName.toLowerCase())) {
            addViolation(
              violations,
              "NSU-001",
              file,
              `${childPointer}/${jsonPointerSegment(dependencyName)}`,
              `Forbidden updater dependency '${dependencyName}'.`,
            );
          }
        }
      }
    }

    const lockDependencyIndex = key.toLowerCase().lastIndexOf("node_modules/");
    if (lockDependencyIndex >= 0) {
      const dependencyName = key.slice(lockDependencyIndex + "node_modules/".length).toLowerCase();
      if (forbiddenDependencies.has(dependencyName)) {
        addViolation(violations, "NSU-001", file, childPointer, `Forbidden resolved updater dependency '${dependencyName}'.`);
      }
    }

    if (normalized === "scripts" && child && typeof child === "object" && !Array.isArray(child)) {
      for (const [scriptName, command] of Object.entries(child)) {
        const normalizedScriptName = scriptName.toLowerCase();
        const commandText = String(command);
        if (
          forbiddenScripts.has(normalizedScriptName) ||
          /(?:electron-updater|update-electron-app|tauri\s+updater|check-for-updates)/i.test(commandText)
        ) {
          addViolation(
            violations,
            "NSU-004",
            file,
            `${childPointer}/${jsonPointerSegment(scriptName)}`,
            `Forbidden update script '${scriptName}'.`,
          );
        }
      }
    }

    if (forbiddenConfigKeys.has(normalized)) {
      addViolation(violations, "NSU-005", file, childPointer, `Forbidden updater config key '${key}'.`);
    }
    if (schedulerConfigKeys.has(normalized)) {
      addViolation(violations, "NSU-003", file, childPointer, `Forbidden background update scheduler key '${key}'.`);
    }
    if (channelConfigKeys.has(normalized)) {
      addViolation(violations, "NSU-007", file, childPointer, `Forbidden update channel key '${key}'.`);
    }
    if (remoteCatalogKeys.has(normalized)) {
      addViolation(violations, "NSU-009", file, childPointer, `Forbidden remote catalog/manifest key '${key}'.`);
    }
    if (runtimeInstallConfigKeys.has(normalized)) {
      addViolation(violations, "NSU-010", file, childPointer, `Forbidden runtime install/download hook '${key}'.`);
    }
    if (mutableTargetKeys.has(normalized) && typeof child === "string" && isMutableTarget(child, mutableTargetValues)) {
      addViolation(violations, "NSU-008", file, childPointer, `Mutable target reference '${child}' is forbidden.`);
    }

    scanJson(child, { ...context, pointer: childPointer });
  }
}

function addSourceRegexViolations(violations, ruleId, file, source, regex, message) {
  regex.lastIndex = 0;
  let match;
  while ((match = regex.exec(source)) !== null) {
    addViolation(violations, ruleId, file, `line:${lineNumberAt(source, match.index)}`, message);
    if (match[0].length === 0) regex.lastIndex += 1;
  }
}

function scanSource(source, file, policy, violations) {
  const executable = stripCommentsPreservingStrings(source);

  addSourceRegexViolations(
    violations,
    "NSU-002",
    file,
    executable,
    /\b(?:new\s+(?:AutoUpdater|UpdateService|UpdaterService|UpdateManager)\s*\(|autoUpdater\s*\.\s*(?:checkForUpdates(?:AndNotify)?|quitAndInstall|downloadUpdate|setFeedURL)\s*\(|checkForUpdates(?:AndNotify)?\s*\()/g,
    "Updater service/API is forbidden in Alpha production source.",
  );
  addSourceRegexViolations(
    violations,
    "NSU-003",
    file,
    executable,
    /\b(?:setInterval|scheduleJob|Register-ScheduledTask|PeriodicTimer)\s*\([^;\n]{0,240}\b(?:update|updater|checkForUpdates)\b/gi,
    "Background update scheduler is forbidden in Alpha production source.",
  );
  addSourceRegexViolations(
    violations,
    "NSU-007",
    file,
    executable,
    /\b(?:setUpdateChannel|setUpdaterChannel)\s*\(\s*["'`](?:stable|testing|beta|canary|nightly)["'`]/gi,
    "Update channel API is forbidden in Alpha production source.",
  );
  addSourceRegexViolations(
    violations,
    "NSU-008",
    file,
    executable,
    /(?:@latest\b|\/releases\/latest(?:\/|\b)|refs\/heads\/(?:main|master)\b|[#?&](?:ref|revision|branch)?=?(?:main|master|head)\b)/gi,
    "Mutable latest/main/master/HEAD source reference is forbidden.",
  );
  addSourceRegexViolations(
    violations,
    "NSU-009",
    file,
    executable,
    /\b(?:fetch|axios\s*\.\s*get|https?\s*\.\s*get|Invoke-RestMethod|Invoke-WebRequest)\s*\([^)]{0,320}\b(?:catalog|manifest)\b/gi,
    "Remote catalog/manifest lookup is forbidden in Alpha production source.",
  );
  addSourceRegexViolations(
    violations,
    "NSU-010",
    file,
    executable,
    /\b(?:spawn|spawnSync|execFile|execFileSync)\s*\(\s*["'`](?:pip3?|npm|pnpm|yarn|git|winget|choco|comfy)["'`]\s*,\s*\[[\s\S]{0,240}?["'`](?:install|add|clone|update)["'`]/gi,
    "Runtime process hook downloads/installs a dependency.",
  );
  addSourceRegexViolations(
    violations,
    "NSU-010",
    file,
    executable,
    /\b(?:exec|execSync|Start-Process|subprocess\.(?:run|Popen))\s*\([^;\n]{0,320}\b(?:pip3?\s+install|npm\s+install|pnpm\s+add|yarn\s+add|git\s+clone|winget\s+install|choco\s+install|comfy\s+(?:node\s+)?install)\b/gi,
    "Runtime command string downloads/installs a dependency.",
  );
  addSourceRegexViolations(
    violations,
    "NSU-011",
    file,
    executable,
    /["'`]update(?:[-_ ]|["'`]\s*,\s*["'`])all["'`]/gi,
    "Production source exposes an update-all command.",
  );

  if (isUpdateEndpoint(executable)) {
    const endpointMatch = executable.search(/https?:\/\//i);
    addViolation(
      violations,
      "NSU-006",
      file,
      `line:${lineNumberAt(executable, Math.max(0, endpointMatch))}`,
      "Update-service/appcast endpoint is forbidden in Alpha.",
    );
  }
}

async function lint(root, policy) {
  const violations = { items: [], keys: new Set() };
  const files = await collectFiles(root, policy, violations);
  const proseExtensions = new Set(policy.ignoredProseExtensions.map((value) => value.toLowerCase()));
  const sourceExtensions = new Set(policy.sourceExtensions.map((value) => value.toLowerCase()));
  const ignoredProseFiles = [];
  const ignoredUnsupportedFiles = [];
  const scannedFiles = [];

  const contextSets = {
    forbiddenDependencies: new Set(policy.forbiddenDependencies.map((value) => value.toLowerCase())),
    forbiddenScripts: new Set(policy.forbiddenScriptNames.map((value) => value.toLowerCase())),
    forbiddenConfigKeys: new Set(policy.forbiddenConfigKeys.map(normalizeKey)),
    schedulerConfigKeys: new Set(policy.schedulerConfigKeys.map(normalizeKey)),
    channelConfigKeys: new Set(policy.channelConfigKeys.map(normalizeKey)),
    mutableTargetKeys: new Set(policy.mutableTargetKeys.map(normalizeKey)),
    mutableTargetValues: new Set(policy.mutableTargetValues.map((value) => value.toLowerCase())),
    remoteCatalogKeys: new Set(policy.remoteCatalogKeys.map(normalizeKey)),
    runtimeInstallConfigKeys: new Set(policy.runtimeInstallConfigKeys.map(normalizeKey)),
  };

  for (const file of files) {
    const extension = extname(file.relativePath).toLowerCase();
    if (proseExtensions.has(extension)) {
      ignoredProseFiles.push(file.relativePath);
      continue;
    }
    if (extension !== ".json" && !sourceExtensions.has(extension)) {
      ignoredUnsupportedFiles.push(file.relativePath);
      continue;
    }

    let source;
    try {
      source = await readFile(file.absolutePath, "utf8");
    } catch (error) {
      addViolation(violations, "NSU-000", file.relativePath, "$", `File cannot be read: ${error.code ?? "unknown"}`);
      continue;
    }
    scannedFiles.push(file.relativePath);

    if (extension === ".json") {
      try {
        const parsed = JSON.parse(source);
        scanJson(parsed, {
          pointer: "",
          file: file.relativePath,
          policy,
          violations,
          ...contextSets,
        });
      } catch (error) {
        addViolation(violations, "NSU-000", file.relativePath, "$", `JSON cannot be parsed: ${error.message}`);
      }
    } else {
      scanSource(source, file.relativePath, policy, violations);
    }
  }

  violations.items.sort((left, right) =>
    [left.ruleId, left.file, left.location, left.message]
      .join("\u0000")
      .localeCompare([right.ruleId, right.file, right.location, right.message].join("\u0000"), "en"),
  );

  return {
    policyId: policy.policyId,
    policyVersion: policy.schemaVersion,
    rootLabel: basename(root),
    result: violations.items.length === 0 ? "pass" : "fail",
    scannedFiles: scannedFiles.sort((left, right) => left.localeCompare(right, "en")),
    ignoredProseFiles: ignoredProseFiles.sort((left, right) => left.localeCompare(right, "en")),
    ignoredUnsupportedFiles: ignoredUnsupportedFiles.sort((left, right) => left.localeCompare(right, "en")),
    violations: violations.items,
  };
}

function printHuman(result) {
  if (result.result === "pass") {
    console.log(`PASS ${result.policyId} root=${result.rootLabel} scanned=${result.scannedFiles.length} violations=0`);
    return;
  }
  console.log(`FAIL ${result.policyId} root=${result.rootLabel} violations=${result.violations.length}`);
  for (const violation of result.violations) {
    console.log(`${violation.ruleId}|${violation.file}|${violation.location}|${violation.message}`);
  }
}

async function main() {
  const positional = process.argv.slice(2).filter((argument) => argument !== "--json");
  const jsonOutput = process.argv.slice(2).includes("--json");
  if (positional.length !== 1) {
    console.error("Usage: node lint-no-self-update.mjs <build-plan-root> [--json]");
    process.exitCode = 2;
    return;
  }

  const root = resolve(positional[0]);
  let metadata;
  try {
    metadata = await lstat(root);
  } catch {
    console.error("Build-plan root does not exist or cannot be inspected.");
    process.exitCode = 2;
    return;
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    console.error("Build-plan root must be a materialized directory, not a file or link.");
    process.exitCode = 2;
    return;
  }

  const policy = await loadPolicy();
  const result = await lint(root, policy);
  if (jsonOutput) console.log(JSON.stringify(result, null, 2));
  else printHuman(result);
  process.exitCode = result.result === "pass" ? 0 : 1;
}

main().catch((error) => {
  console.error(`Policy linter failed closed: ${error.message}`);
  process.exitCode = 2;
});
