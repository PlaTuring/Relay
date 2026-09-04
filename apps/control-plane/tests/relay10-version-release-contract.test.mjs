import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const controlPlaneRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(controlPlaneRoot, "..", "..");

async function json(relativePath, root = controlPlaneRoot) {
  return JSON.parse(await readFile(path.resolve(root, relativePath), "utf8"));
}

async function text(relativePath) {
  return readFile(path.resolve(controlPlaneRoot, relativePath), "utf8");
}

test("Relay formal release uses one canonical stable SemVer source", async () => {
  const rootPackage = await json("package.json", repositoryRoot);
  const rootLock = await json("package-lock.json", repositoryRoot);
  const appPackage = await json("package.json");
  const appLock = await json("package-lock.json");

  assert.equal(rootPackage.version, "1.0.2");
  assert.equal(rootLock.version, "1.0.2");
  assert.equal(rootLock.packages[""].version, "1.0.2");
  assert.equal(appPackage.version, "1.0.2");
  assert.equal(appLock.version, "1.0.2");
  assert.equal(appLock.packages[""].version, "1.0.2");
  assert.match(appPackage.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u);
});

test("Setup-only package output derives Relay 1.0.2 filename from canonical SemVer", async () => {
  const rootPackage = await json("package.json", repositoryRoot);
  const appPackage = await json("package.json");
  const library = await import("../scripts/lib.mjs");
  const packageScript = await text("scripts/package.mjs");

  assert.equal(rootPackage.scripts["package:win"], "node apps/control-plane/scripts/package.mjs --target nsis");
  assert.equal(appPackage.scripts.dist, "node scripts/package.mjs --target nsis");
  assert.equal(appPackage.scripts["dist:win"], "node scripts/package.mjs --target nsis");
  assert.equal(library.applicationVersion, "1.0.2");
  assert.equal(library.applicationDisplayVersion, "1.0.2");
  assert.equal(library.releaseArtifactName("setup"), "Relay-1.0.2-x64-Setup.exe");
  assert.match(packageScript, /releaseArtifactName\("setup"\)/u);
  assert.match(packageScript, /PACKAGE_CHECKSUMS count=/u);
  assert.match(packageScript, /versionedReleaseRoot\s*=\s*resolve\(releaseRoot, `v\$\{packageMetadata\.version\}`\)/u);
  assert.match(packageScript, /PACKAGE\.VERSIONED_RELEASE_ALREADY_EXISTS/u);
  assert.match(packageScript, /PACKAGE\.VERSIONED_RELEASE_ASSET_WHITELIST_FAILED/u);
  assert.match(packageScript, /copyFile\(artifactPath, destination, fsConstants\.COPYFILE_EXCL\)/u);
  assert.match(packageScript, /expectedNames\s*=\s*\[\.\.\.artifactNames, "SHA256SUMS\.txt"\]/u);
  assert.doesNotMatch(packageScript, /rm\(versionedReleaseRoot,\s*\{\s*recursive:\s*true/u);
});

test("packaged UI presents version 1.0.2 without preview-channel product status", async () => {
  const html = await text("src/renderer/index.html");
  const renderer = await text("src/renderer/index.ts");
  const versionPresentation = await text("src/renderer/version-presentation.ts");

  for (const forbidden of [
    "测试预览版",
    "Alpha Pre-release",
    "未签名预览版",
    "0.1.0-alpha.40"
  ]) {
    assert.equal(html.includes(forbidden), false, forbidden);
    assert.equal(renderer.includes(forbidden), false, forbidden);
  }
  assert.match(versionPresentation, /formalVersionLabel/u);
  assert.match(renderer, /formalVersionLabel\(bootstrap\.appVersion\)/u);
});
