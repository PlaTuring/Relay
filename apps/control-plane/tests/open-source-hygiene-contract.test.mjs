import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const controlPlaneRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(controlPlaneRoot, "..", "..");

async function text(relativePath, root = repositoryRoot) {
  return readFile(path.resolve(root, relativePath), "utf8");
}

test("open-source hygiene verifier closes metadata, notice, privacy and packaging contracts", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/verify-open-source-hygiene.mjs"],
    { cwd: controlPlaneRoot, encoding: "utf8" }
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /OPEN_SOURCE_HYGIENE manifests=\d+ dependencies=399/u);
  assert.match(result.stdout, /packaged_notices=3 privacy=passed release_whitelist=passed/u);
});

test("every first-party manifest and lock root declares the exact Apache-2.0 SPDX license", async () => {
  const firstPartyManifests = [
    "package.json",
    "apps/control-plane/package.json",
    "packages/detection/media-capability/package.json",
    "packages/installer/catalog-loader/package.json",
    "packages/installer/download-sidecar/package.json",
    "packages/local-runtime/package.json",
    "packages/workflow/h3-compiler/package.json",
    "packages/workflow/static-graph-lint/package.json",
    "prototypes/phase0/stack-electron/package.json"
  ];

  for (const relativePath of firstPartyManifests) {
    const manifest = JSON.parse(await text(relativePath));
    assert.equal(manifest.license, "Apache-2.0", relativePath);
    assert.equal(manifest.private, true, `${relativePath} must remain npm-private`);
  }

  for (const relativePath of ["package-lock.json", "apps/control-plane/package-lock.json"]) {
    const lock = JSON.parse(await text(relativePath));
    assert.equal(lock.packages?.[""]?.license, "Apache-2.0", `${relativePath} root package`);
  }
});

test("source ledger and CycloneDX SBOM preserve single licenses and compound SPDX expressions", async () => {
  for (const mode of ["--licenses", "--sbom"]) {
    const result = spawnSync(
      process.execPath,
      ["scripts/generate-supply-chain.mjs", mode],
      { cwd: controlPlaneRoot, encoding: "utf8" }
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /components=399/u);
  }

  const ledger = JSON.parse(await text("artifacts/source-licenses.json", controlPlaneRoot));
  const sbom = JSON.parse(await text("artifacts/source-sbom.cdx.json", controlPlaneRoot));
  assert.equal(ledger.packages.length, 399);
  assert.equal(sbom.bomFormat, "CycloneDX");
  assert.equal(sbom.specVersion, "1.6");
  assert.equal(sbom.components.length, 399);
  assert.deepEqual(
    sbom.metadata?.component?.licenses,
    [{ license: { id: "Apache-2.0" } }]
  );

  const bomRefs = new Set();
  for (const entry of sbom.components) {
    assert.equal(typeof entry["bom-ref"], "string");
    assert.ok(!bomRefs.has(entry["bom-ref"]), `duplicate bom-ref: ${entry["bom-ref"]}`);
    bomRefs.add(entry["bom-ref"]);
    const lockPath = entry.properties?.find(({ name }) => name === "npm:lock-path")?.value;
    assert.equal(typeof lockPath, "string", `${entry.name}@${entry.version} lock path`);
    assert.equal(entry["bom-ref"], `npm-lock:${encodeURIComponent(lockPath)}`);
    const licenseChoice = entry.licenses?.[0];
    assert.equal(
      Number(typeof licenseChoice?.expression === "string") +
        Number(typeof licenseChoice?.license?.id === "string"),
      1,
      `${entry.name}@${entry.version} CycloneDX license union`
    );
  }
  assert.equal(bomRefs.size, 399);

  const component = (name, version) => sbom.components.find((entry) => (
    entry.name === name && entry.version === version
  ));
  for (const [name, version, expression] of [
    ["sanitize-filename", "1.6.4", "WTFPL OR ISC"],
    ["type-fest", "0.13.1", "(MIT OR CC0-1.0)"],
    ["utf8-byte-length", "1.0.5", "(WTFPL OR MIT)"]
  ]) {
    const licenseChoice = component(name, version)?.licenses?.[0];
    assert.deepEqual(licenseChoice, { expression }, `${name}@${version}`);
  }

  const singleLicense = component("@electron/asar", "3.4.1")?.licenses?.[0];
  assert.deepEqual(singleLicense, { license: { id: "MIT" } });
});

test("renderer asset packaging is explicit, rejects unknown inputs, and includes the noticed profile art", async () => {
  const [build, html, notices, avatar] = await Promise.all([
    text("scripts/build.mjs", controlPlaneRoot),
    text("src/renderer/index.html", controlPlaneRoot),
    text("THIRD_PARTY_NOTICES.md"),
    readFile(path.resolve(controlPlaneRoot, "src/renderer/assets/platuring-avatar.png"))
  ]);

  for (const packagedName of [
    "relay-icon.ico",
    "relay-icon.png",
    "relay-installer-header.bmp",
    "relay-installer-sidebar.bmp",
    "relay-logo.svg",
    "platuring-avatar.png"
  ]) {
    assert.match(build, new RegExp(`"${packagedName.replaceAll(".", "\\.")}"`, "u"));
  }
  assert.match(build, /const packagedRendererAssets = new Set/u);
  assert.match(build, /BUILD\.RENDERER_ASSET_NOT_ALLOWLISTED/u);
  assert.match(build, /BUILD\.RENDERER_ASSET_UNSUPPORTED/u);
  assert.match(build, /BUILD\.RENDERER_ASSET_MISSING/u);
  assert.match(build, /await copyFile\(source, resolve\(rendererAssetDestination, entry\.name\)\)/u);
  assert.doesNotMatch(
    build,
    /await cp\([\s\S]{0,160}src["'], ["']renderer["'], ["']assets["'][\s\S]{0,160}\{\s*recursive:\s*true/u
  );

  assert.match(html, /src="\.\/assets\/platuring-avatar\.png"/u);
  assert.match(notices, /138b2925844d1464ba7f5b4beb736c6fda4114c3c25127341069ebf497b2818e/u);
  assert.match(notices, /not licensed under Relay's Apache-2\.0 license/u);
  assert.equal(
    createHash("sha256").update(avatar).digest("hex"),
    "138b2925844d1464ba7f5b4beb736c6fda4114c3c25127341069ebf497b2818e"
  );
});

test("vendored H3 templates carry exact MIT provenance rather than an Apache claim", async () => {
  const notices = await text("THIRD_PARTY_NOTICES.md");
  const adr = await text("docs/adr/ADR-017-relay-source-license-and-distribution-boundary.md");

  assert.match(notices, /Comfy-Org\/workflow_templates.*71f43419e53dfcb16330748f3b933ac0efcc4778/su);
  assert.match(notices, /2400b01a7c8acae3fed038c0372f08bacb90d2cdf915febadbe7e3f9802506ea/u);
  assert.match(notices, /4dc94e9ea308c1d60409e7f55dba5e2788dab4659c2dbb90f1e9481498767540/u);
  assert.match(notices, /14b30659a057547e02bdd4bbbdda3f8670aa6d7d81d1d8d99c4f9ad1e2eabc44/u);
  assert.match(notices, /Copyright \(c\) 2023-present Comfy Org/u);
  assert.match(notices, /apps\/control-plane\/src\/renderer\/assets\/platuring-avatar\.png/u);
  assert.match(adr, /MIT-licensed upstream/u);
});

test("versioned release freeze never reuses or replaces a previous identity", async () => {
  const script = await text("scripts/package.mjs", controlPlaneRoot);

  assert.match(script, /const versionedReleaseRoot = resolve\(releaseRoot, `v\$\{packageMetadata\.version\}`\)/u);
  assert.match(script, /await lstat\(versionedReleaseRoot\);\s*throw new Error\("PACKAGE\.VERSIONED_RELEASE_ALREADY_EXISTS"\)/u);
  assert.match(script, /\.relay-release-staging-\$\{randomUUID\(\)\}/u);
  assert.match(script, /const expectedNames = \[\.\.\.artifactNames, "SHA256SUMS\.txt"\]\.sort\(\)/u);
  assert.match(script, /copyFile\(artifactPath, destination, fsConstants\.COPYFILE_EXCL\)/u);
  assert.match(script, /await rename\(stagingRoot, destinationRoot\)/u);
  assert.doesNotMatch(script, /release-v1\.0\.1(?:-current)?/u);
  assert.doesNotMatch(script, /rm\(versionedReleaseRoot,\s*\{\s*recursive:\s*true/u);
});

test("source-control exclusions cover private projects and local release outputs without hiding fixtures", async () => {
  const ignore = await text(".gitignore");

  for (const marker of [
    "release-v*/",
    "apps/control-plane/release-*/",
    ".build-cache/",
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
  ]) {
    assert.ok(ignore.includes(marker), marker);
  }
  assert.doesNotMatch(ignore, /^\*\.exe$/mu);
  assert.doesNotMatch(ignore, /(?:^|\/)platuring-avatar\.png$/mu);
});
