import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const projectRoot = path.resolve(import.meta.dirname, "..");
const DIGEST = "a".repeat(64);

async function loadUpdateModule(context) {
  const buildRoot = await mkdtemp(path.join(os.tmpdir(), "relay-stable-channel-build-"));
  context.after(() => rm(buildRoot, { recursive: true, force: true }));
  const outfile = path.join(buildRoot, "github-update-check.mjs");
  await build({
    entryPoints: [path.join(projectRoot, "src", "main", "services", "github-update-check.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "silent"
  });
  return import(`${new URL(`file:///${outfile.replaceAll("\\", "/")}`).href}?test=${Date.now()}`);
}

function displayVersion(version) {
  const [major, minor, patchVersion] = version.split(".").map(Number);
  return patchVersion === 0 ? `${major}.${minor}` : `${major}.${minor}.${patchVersion}`;
}

function asset(tag, version, overrides = {}) {
  const name = `Relay-${displayVersion(version)}-x64-Setup.exe`;
  return {
    name,
    size: 1_024,
    digest: `sha256:${DIGEST}`,
    state: "uploaded",
    browser_download_url: `https://github.com/PlaTuring/Relay/releases/download/${tag}/${name}`,
    ...overrides
  };
}

function release(version, overrides = {}) {
  const tag = `v${version}`;
  return {
    tag_name: tag,
    html_url: `https://github.com/PlaTuring/Relay/releases/tag/${tag}`,
    body: "Stable notes\u0000\u202E\n由用户主动下载。",
    published_at: "2026-09-01T12:00:00.000Z",
    draft: false,
    prerelease: false,
    assets: [asset(tag, version)],
    ...overrides
  };
}

function response(status, value, headers = {}) {
  return Object.freeze({
    status,
    headers: Object.freeze(headers),
    body: typeof value === "string" ? value : JSON.stringify(value)
  });
}

async function dataRoot(context, suffix) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), `relay-stable-channel-${suffix}-`));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  return path.join(temporary, "Relay 数据 Ω");
}

test("stable parser and Setup display formatter reject prerelease/build metadata", async (context) => {
  const module = await loadUpdateModule(context);
  assert.equal(module.parseStrictStableVersion("1.0.0"), "1.0.0");
  assert.equal(module.parseStrictStableVersion("v2.3.4"), "2.3.4");
  assert.equal(module.formatStableAssetVersion("1.0.0"), "1.0");
  assert.equal(module.formatStableAssetVersion("1.0.1"), "1.0.1");
  assert.equal(module.expectedStableSetupAssetName("1.0.0"), "Relay-1.0-x64-Setup.exe");
  assert.equal(module.expectedStableSetupAssetName("1.0.1"), "Relay-1.0.1-x64-Setup.exe");
  for (const invalid of ["1.0", "1.0.0-alpha.1", "1.0.0+build.1", "01.0.0", "latest"]) {
    assert.throws(() => module.parseStrictStableVersion(invalid), /stable|version|semantic/iu);
  }
});

test("GitHub response reader enforces the four MiB limit while streaming", async (context) => {
  const module = await loadUpdateModule(context);
  const source = await readFile(
    path.join(projectRoot, "src", "main", "services", "github-update-check.ts"),
    "utf8"
  );
  assert.doesNotMatch(source, /response\.text\(\)/u);
  assert.match(source, /readBoundedGithubResponseBody\(response\.body\)/u);
  const withinLimit = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("["));
      controller.enqueue(new TextEncoder().encode("]"));
      controller.close();
    }
  });
  assert.equal(await module.readBoundedGithubResponseBody(withinLimit), "[]");

  let cancelled = false;
  const oversized = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(4 * 1024 * 1024));
      controller.enqueue(new Uint8Array([1]));
    },
    cancel() {
      cancelled = true;
    }
  });
  await assert.rejects(
    module.readBoundedGithubResponseBody(oversized),
    /too large/iu
  );
  assert.equal(cancelled, true, "oversized bodies must be cancelled before further buffering");
});

test("stable channel selects the highest eligible release and exposes no URL or digest authority", async (context) => {
  const module = await loadUpdateModule(context);
  const root = await dataRoot(context, "highest");
  const requests = [];
  const service = module.createGithubUpdateCheckService({
    currentVersion: "1.0.0",
    dataRootPath: root,
    now: () => new Date("2026-09-01T18:00:00.000Z"),
    httpClient: async (request) => {
      requests.push(request);
      return response(200, [
        release("1.0.3", { draft: true }),
        release("1.0.1"),
        { ...release("1.0.2"), prerelease: true },
        { ...release("1.0.4"), tag_name: "v1.0.4-alpha.1" },
        { ...release("1.0.5"), tag_name: "v1.0.5+build.1" }
      ]);
    }
  });
  const checked = await service.checkForUpdates();
  assert.equal(checked.status, "update_available");
  assert.equal(checked.channel, "stable");
  assert.equal(checked.latestVersion, "1.0.1");
  assert.equal(checked.tag, "v1.0.1");
  assert.deepEqual(checked.assets, [{ kind: "setup", name: "Relay-1.0.1-x64-Setup.exe", length: 1_024 }]);
  assert.equal(checked.releaseNotes.includes("\u0000"), false);
  assert.equal(checked.releaseNotes.includes("\u202E"), false);
  assert.equal(requests[0].url, "https://api.github.com/repos/PlaTuring/Relay/releases?per_page=20");
  assert.equal(requests[0].headers["User-Agent"], "Relay-Stable-Update-Check");
  const serialized = JSON.stringify(checked);
  assert.doesNotMatch(serialized, /browser_download_url|releases\/download|downloadUrl|digest|sha256|https:\/\//u);
  const authority = service.getValidatedRelease();
  assert.equal(authority.version, "1.0.1");
  assert.equal(authority.assets.setup.sha256, DIGEST);
  assert.match(authority.assets.setup.downloadUrl, /^https:\/\/github\.com\/PlaTuring\/Relay\/releases\/download\//u);
  const stored = await readFile(module.updateCheckCachePath(root), "utf8");
  assert.doesNotMatch(stored, /https:\/\/|downloadUrl|browser_download_url|digest|sha256/iu);
});

test("highest stable release is validated before assets and never falls back", async (context) => {
  const module = await loadUpdateModule(context);
  let payload = [release("1.0.1")];
  const service = module.createGithubUpdateCheckService({
    currentVersion: "1.0.0",
    dataRootPath: null,
    httpClient: async () => response(200, payload)
  });
  assert.equal((await service.checkForUpdates()).latestVersion, "1.0.1");
  payload = [release("1.0.1"), release("1.0.2", {
    assets: [asset("v1.0.2", "1.0.2", { digest: null })]
  })];
  const incomplete = await service.checkForUpdates();
  assert.equal(incomplete.status, "release_incomplete");
  assert.equal(incomplete.latestVersion, "1.0.2");
  assert.equal(service.getValidatedRelease(), null);
});

test("Setup-only release rejects missing, duplicate, extra, unsafe, zero-length and bad-digest assets", async (context) => {
  const module = await loadUpdateModule(context);
  const good = asset("v1.0.1", "1.0.1");
  const cases = [
    [],
    [good, { ...good }],
    [good, { ...good, name: "Relay-1.0.1-x64-Portable.exe" }],
    [{ ...good, name: "Relay-1.0.0-x64-Setup.exe" }],
    [{ ...good, browser_download_url: "https://example.com/payload.exe" }],
    [{ ...good, size: 0 }],
    [{ ...good, state: undefined }],
    [{ ...good, digest: undefined }],
    [{ ...good, digest: `sha256:${"A".repeat(64)}` }],
    [{ ...good, digest: `sha512:${DIGEST}` }]
  ];
  for (const [index, assets] of cases.entries()) {
    const service = module.createGithubUpdateCheckService({
      currentVersion: "1.0.0",
      dataRootPath: null,
      httpClient: async () => response(200, [release("1.0.1", { assets })])
    });
    assert.equal((await service.checkForUpdates()).status, "release_incomplete", `case ${index}`);
  }
});

test("draft, prerelease, alpha and build-tag releases are ignored", async (context) => {
  const module = await loadUpdateModule(context);
  const service = module.createGithubUpdateCheckService({
    currentVersion: "1.0.0",
    dataRootPath: null,
    httpClient: async () => response(200, [
      release("1.0.1", { draft: true }),
      release("1.0.2", { prerelease: true }),
      { ...release("1.0.3"), tag_name: "v1.0.3-alpha.1" },
      { ...release("1.0.4"), tag_name: "v1.0.4+meta" },
      { ...release("1.0.5"), tag_name: "1.0.5" }
    ])
  });
  assert.equal((await service.checkForUpdates()).status, "no_release");
});

test("alpha/legacy caches are rejected and failures preserve only a valid stable cache", async (context) => {
  const module = await loadUpdateModule(context);
  const root = await dataRoot(context, "cache");
  await mkdir(path.dirname(module.updateCheckCachePath(root)), { recursive: true });
  await writeFile(module.updateCheckCachePath(root), JSON.stringify({
    schemaVersion: 2,
    sourceId: "github-releases:PlaTuring/Relay:alpha",
    channel: "alpha",
    checkedAt: "2026-09-01T00:00:00.000Z",
    status: "latest",
    currentVersion: "0.1.0-alpha.40",
    latestVersion: "0.1.0-alpha.40",
    tag: "v0.1.0-alpha.40",
    releaseNotes: null,
    publishedAt: "2026-09-01T00:00:00.000Z",
    assets: []
  }));
  const initial = module.createGithubUpdateCheckService({
    currentVersion: "1.0.0",
    dataRootPath: root,
    httpClient: async () => response(200, [release("1.0.1")])
  });
  assert.equal(await initial.getCachedUpdateCheck(), null);
  const valid = await initial.checkForUpdates();
  assert.equal(valid.cached.sourceId, "github-releases:PlaTuring/Relay:stable");
  assert.equal(valid.cached.channel, "stable");

  const failed = module.createGithubUpdateCheckService({
    currentVersion: "1.0.0",
    dataRootPath: root,
    httpClient: async () => { throw new Error("offline"); }
  });
  const checked = await failed.checkForUpdates();
  assert.equal(checked.status, "network");
  assert.deepEqual(checked.cached, valid.cached);
  assert.deepEqual(await failed.getCachedUpdateCheck(), valid.cached);
});

test("check service accepts only strict stable current versions", async (context) => {
  const module = await loadUpdateModule(context);
  for (const version of ["1.0", "1.0.0-alpha.1", "1.0.0+build.1", "01.0.0", "latest"]) {
    assert.throws(() => module.createGithubUpdateCheckService({
      currentVersion: version,
      dataRootPath: null,
      httpClient: async () => response(200, [])
    }), /stable|version|semantic/iu);
  }
});
