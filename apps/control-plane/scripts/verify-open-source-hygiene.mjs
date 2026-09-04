import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import { projectRoot } from "./lib.mjs";
import { localExtraResourceMappings } from "./input-inventory-contract.mjs";

const repositoryRoot = resolve(projectRoot, "..", "..");
const excludedDirectories = new Set([
  ".git",
  ".build-cache",
  "node_modules",
  "artifacts",
  "dist",
  "release",
  "release-alpha",
  "release-signed",
  "release-unsigned"
]);

async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function text(path) {
  return readFile(path, "utf8");
}

async function collectNamed(directory, filename) {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && (
      excludedDirectories.has(entry.name) || entry.name.startsWith("release-") || entry.name.startsWith("release-v")
    )) {
      continue;
    }
    const candidate = resolve(directory, entry.name);
    if (entry.isDirectory()) results.push(...await collectNamed(candidate, filename));
    else if (entry.isFile() && entry.name === filename) results.push(candidate);
  }
  return results;
}

const rootPackage = await json(resolve(repositoryRoot, "package.json"));
const appPackage = await json(resolve(projectRoot, "package.json"));
for (const [name, manifest] of [["root", rootPackage], ["control-plane", appPackage]]) {
  assert.equal(manifest.license, "Apache-2.0", `${name} SPDX license`);
  assert.equal(manifest.private, true, `${name} must remain npm-private`);
}

const manifests = await collectNamed(repositoryRoot, "package.json");
const firstPartyManifestPaths = new Set([
  "package.json",
  "apps/control-plane/package.json",
  "packages/detection/media-capability/package.json",
  "packages/installer/catalog-loader/package.json",
  "packages/installer/download-sidecar/package.json",
  "packages/local-runtime/package.json",
  "packages/workflow/h3-compiler/package.json",
  "packages/workflow/static-graph-lint/package.json",
  "prototypes/phase0/stack-electron/package.json"
]);
for (const manifestPath of manifests) {
  const repositoryPath = relative(repositoryRoot, manifestPath).replaceAll("\\", "/");
  const manifest = await json(manifestPath);
  if (firstPartyManifestPaths.has(repositoryPath)) {
    assert.equal(manifest.license, "Apache-2.0", `${repositoryPath} SPDX license`);
  } else {
    assert.match(repositoryPath, /^prototypes\/phase0\/no-self-update\/fixtures\//u,
      `unclassified package manifest: ${repositoryPath}`);
  }
}
assert.equal(
  [...firstPartyManifestPaths].every((path) => manifests.some((manifestPath) =>
    relative(repositoryRoot, manifestPath).replaceAll("\\", "/") === path
  )),
  true,
  "first-party manifest allowlist is incomplete"
);

for (const lockPath of ["package-lock.json", "apps/control-plane/package-lock.json"]) {
  const packageLock = await json(resolve(repositoryRoot, lockPath));
  assert.equal(packageLock.packages?.[""]?.license, "Apache-2.0", `${lockPath} root SPDX license`);
}

const requiredDocuments = [
  "LICENSE",
  "NOTICE",
  "README.md",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "THIRD_PARTY_NOTICES.md",
  "docs/adr/ADR-017-relay-source-license-and-distribution-boundary.md"
];
const documents = new Map();
for (const path of requiredDocuments) {
  documents.set(path, await text(resolve(repositoryRoot, path)));
}
assert.match(documents.get("LICENSE"), /Apache License\s+Version 2\.0/u);
assert.match(documents.get("NOTICE"), /Copyright 2026 Relay contributors/u);

const thirdParty = documents.get("THIRD_PARTY_NOTICES.md");
for (const marker of [
  "71f43419e53dfcb16330748f3b933ac0efcc4778",
  "video_minimax_h3_t2v.json",
  "video_minimax_h3_i2v.json",
  "video_minimax_h3_r2v.json",
  "Copyright (c) 2023-present Comfy Org",
  "platuring-avatar.png",
  "MiniMax H3 Community License",
  "FFmpeg / FFprobe",
  "LICENSE.electron.txt",
  "LICENSES.chromium.html"
]) assert.ok(thirdParty.includes(marker), `third-party marker missing: ${marker}`);

const publicDocuments = [
  ...requiredDocuments,
  "docs/DECISION_LOG.md",
  "docs/RISK_REGISTER.md",
  "docs/EXTERNAL_GATES.md",
  "docs/releases/RELAY-1.0-RELEASE-REPORT.md"
];
const privatePathPattern = /(?:[a-z]:\\Users\\[^\\/\s"'`<>]+(?:\\|\b)|\/Users\/[^/\s"'`<>]+(?:\/|\b))/iu;
for (const path of publicDocuments) {
  const value = documents.get(path) ?? await text(resolve(repositoryRoot, path));
  assert.doesNotMatch(value, privatePathPattern, `private absolute path in ${path}`);
}

const ignore = await text(resolve(repositoryRoot, ".gitignore"));
for (const pattern of [
  ".build-cache/",
  "release-v*/",
  "apps/control-plane/release-*/",
  "*.relayproj",
  "native/**/bin/",
  ".env*",
  "!.env.example",
  ".npmrc",
  ".secrets/",
  "*.pfx",
  "*.p12",
  "*.pem",
  "*.key"
]) assert.ok(ignore.includes(pattern), `.gitignore marker missing: ${pattern}`);
assert.doesNotMatch(ignore, /^\*\.exe$/mu, "textual .exe fixtures must not be hidden by a global ignore");

const mappingPairs = new Map(
  localExtraResourceMappings(projectRoot, appPackage)
    .map((entry) => [entry.source_inventory_path, entry.destination])
);
for (const [source, destination] of [
  ["../../LICENSE", "licenses/Relay/LICENSE"],
  ["../../NOTICE", "licenses/Relay/NOTICE"],
  ["../../THIRD_PARTY_NOTICES.md", "licenses/Relay/THIRD_PARTY_NOTICES.md"]
]) assert.equal(mappingPairs.get(source), destination, `packaged notice mapping: ${source}`);

const lock = await json(resolve(projectRoot, "package-lock.json"));
let dependencyCount = 0;
const licenseCounts = new Map();
for (const [path, metadata] of Object.entries(lock.packages ?? {})) {
  if (path === "") continue;
  dependencyCount += 1;
  assert.equal(typeof metadata.license, "string", `missing locked license: ${path}`);
  assert.ok(metadata.license.length > 0, `empty locked license: ${path}`);
  licenseCounts.set(metadata.license, (licenseCounts.get(metadata.license) ?? 0) + 1);
}
assert.equal(dependencyCount, 399, "review dependency-license changes before release");
for (const expression of ["MIT", "ISC", "Apache-2.0", "MPL-2.0", "BlueOak-1.0.0", "Python-2.0"]) {
  assert.ok(licenseCounts.has(expression), `expected license expression missing: ${expression}`);
}

const packageScript = await text(resolve(projectRoot, "scripts", "package.mjs"));
for (const marker of [
  "PACKAGE.VERSIONED_RELEASE_ALREADY_EXISTS",
  "PACKAGE.VERSIONED_RELEASE_STAGING_CONTAINMENT_FAILED",
  "PACKAGE.VERSIONED_RELEASE_ASSET_WHITELIST_FAILED",
  "fsConstants.COPYFILE_EXCL",
  '"SHA256SUMS.txt"',
  "await rename(stagingRoot, destinationRoot)"
]) assert.ok(packageScript.includes(marker), `release fail-closed marker missing: ${marker}`);
assert.doesNotMatch(packageScript, /release-v1\.0\.1(?:-current)?/u);
assert.doesNotMatch(packageScript, /rm\(versionedReleaseRoot,\s*\{\s*recursive:\s*true/u);

process.stdout.write(
  `OPEN_SOURCE_HYGIENE manifests=${manifests.length} dependencies=${dependencyCount} ` +
  `licenses=${licenseCounts.size} packaged_notices=3 privacy=passed release_whitelist=passed\n`
);
