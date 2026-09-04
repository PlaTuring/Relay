import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const projectRoot = path.resolve(import.meta.dirname, "..");

async function loadUpdateModule(context) {
  const buildRoot = await mkdtemp(path.join(os.tmpdir(), "relay-alpha32-update-build-"));
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

function response(status, body = "", headers = {}) {
  return Object.freeze({ status, body, headers: Object.freeze(headers) });
}

function release(overrides = {}) {
  const version = String(overrides.tag_name ?? "v1.0.1").replace(/^v/u, "");
  const tag = String(overrides.tag_name ?? "v1.0.1");
  const [major, minor, patchVersion] = version.split(".").map(Number);
  const displayVersion = patchVersion === 0 ? `${major}.${minor}` : version;
  const name = `Relay-${displayVersion}-x64-Setup.exe`;
  return JSON.stringify([{
    tag_name: tag,
    html_url: `https://github.com/PlaTuring/Relay/releases/tag/${tag}`,
    body: "修复项目素材库。\n\n不会自动下载安装。",
    published_at: "2026-08-30T12:00:00.000Z",
    draft: false,
    prerelease: false,
    assets: [
      {
        name,
        size: 120,
        digest: `sha256:${"a".repeat(64)}`,
        state: "uploaded",
        browser_download_url: `https://github.com/PlaTuring/Relay/releases/download/${tag}/${name}`
      }
    ],
    ...overrides
  }]);
}

async function dataRoot(context, suffix) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), `relay-alpha32-${suffix}-`));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  return path.join(temporary, "Relay 数据 Ω");
}

test("strict semver comparison follows release and prerelease precedence", async (context) => {
  const module = await loadUpdateModule(context);
  const ordered = [
    "1.0.0-alpha",
    "1.0.0-alpha.1",
    "1.0.0-alpha.beta",
    "1.0.0-beta",
    "1.0.0-beta.2",
    "1.0.0-beta.11",
    "1.0.0-rc.1",
    "1.0.0"
  ];
  for (let index = 0; index < ordered.length - 1; index += 1) {
    assert.equal(module.compareStrictSemver(ordered[index], ordered[index + 1]), -1);
    assert.equal(module.compareStrictSemver(ordered[index + 1], ordered[index]), 1);
  }
  assert.equal(module.compareStrictSemver("v0.1.0-alpha.31", "0.1.0-alpha.31+build.9"), 0);
  for (const invalid of ["1", "1.0", "01.0.0", "1.0.0-alpha.01", " 1.0.0", "vV1.0.0", "latest"]) {
    assert.throws(() => module.parseStrictSemver(invalid), /version|semantic/iu);
  }
});

test("fixed anonymous request reports update_available and persists only bounded public release data", async (context) => {
  const module = await loadUpdateModule(context);
  const root = await dataRoot(context, "available");
  const requests = [];
  const service = module.createGithubUpdateCheckService({
    currentVersion: "1.0.0",
    dataRootPath: root,
    now: () => new Date("2026-08-30T13:00:00.000Z"),
    httpClient: async (request) => {
      requests.push(request);
      return response(200, release());
    }
  });
  const checked = await service.checkForUpdates();
  assert.equal(checked.status, "update_available");
  assert.equal(checked.latestVersion, "1.0.1");
  assert.equal(checked.tag, "v1.0.1");
  assert.equal("releaseUrl" in checked, false);
  assert.equal(checked.cachePersisted, true);
  assert.deepEqual(requests, [{
    url: "https://api.github.com/repos/PlaTuring/Relay/releases?per_page=20",
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Relay-Stable-Update-Check",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    timeoutMs: 12_000
  }]);
  assert.equal(Object.keys(requests[0].headers).some((key) => /authorization|cookie/iu.test(key)), false);
  const stored = JSON.parse(await readFile(module.updateCheckCachePath(root), "utf8"));
  assert.deepEqual(stored, checked.cached);
  assert.equal(stored.schemaVersion, 2);
  assert.equal("downloadUrl" in stored, false);
  assert.equal(JSON.stringify(stored).includes("browser_download_url"), false);
  const restarted = module.createGithubUpdateCheckService({
    currentVersion: "1.0.0",
    dataRootPath: root,
    httpClient: async () => response(500)
  });
  assert.deepEqual(await restarted.getCachedUpdateCheck(), checked.cached);
});

test("latest and no_release are honest successful states with deterministic cache", async (context) => {
  const module = await loadUpdateModule(context);
  const latestRoot = await dataRoot(context, "latest");
  const latest = module.createGithubUpdateCheckService({
    currentVersion: "1.0.1",
    dataRootPath: latestRoot,
    now: () => new Date("2026-08-30T14:00:00.000Z"),
    httpClient: async () => response(200, release())
  });
  assert.equal((await latest.checkForUpdates()).status, "latest");

  const emptyRoot = await dataRoot(context, "no-release");
  const empty = module.createGithubUpdateCheckService({
    currentVersion: "1.0.0",
    dataRootPath: emptyRoot,
    now: () => new Date("2026-08-30T14:10:00.000Z"),
    httpClient: async () => response(404, JSON.stringify({ message: "Not Found" }))
  });
  const result = await empty.checkForUpdates();
  assert.equal(result.status, "no_release");
  assert.equal(result.latestVersion, null);
  assert.equal("releaseUrl" in result, false);
  assert.equal(result.cachePersisted, true);
  assert.equal((await empty.getCachedUpdateCheck()).status, "no_release");
});

test("network, rate_limit and malformed results preserve the previous successful cache", async (context) => {
  const module = await loadUpdateModule(context);
  const root = await dataRoot(context, "failure-cache");
  const seeded = module.createGithubUpdateCheckService({
    currentVersion: "1.0.0",
    dataRootPath: root,
    now: () => new Date("2026-08-30T15:00:00.000Z"),
    httpClient: async () => response(200, release())
  });
  const original = (await seeded.checkForUpdates()).cached;
  assert.ok(original);

  const cases = [
    ["network", async () => { throw new Error("offline"); }],
    ["rate_limit", async () => response(403, "", { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1788091200" })],
    ["malformed", async () => response(200, "{not-json")],
    ["malformed", async () => response(200, release({ html_url: "https://example.com/not-relay" }))]
  ];
  for (const [expected, client] of cases) {
    const service = module.createGithubUpdateCheckService({
      currentVersion: "1.0.0",
      dataRootPath: root,
      now: () => new Date("2026-08-30T15:30:00.000Z"),
      httpClient: client
    });
    const checked = await service.checkForUpdates();
    assert.equal(checked.status, expected);
    assert.equal(checked.cachePersisted, false);
    assert.deepEqual(checked.cached, original);
    assert.deepEqual(await service.getCachedUpdateCheck(), original);
  }
});

test("unexpected HTTP status is network, malformed cache fails closed, and concurrent clicks share one request", async (context) => {
  const module = await loadUpdateModule(context);
  const root = await dataRoot(context, "concurrency");
  let calls = 0;
  let releaseRequest;
  const barrier = new Promise((resolve) => { releaseRequest = resolve; });
  const service = module.createGithubUpdateCheckService({
    currentVersion: "1.0.0",
    dataRootPath: root,
    httpClient: async () => {
      calls += 1;
      await barrier;
      return response(503, "service unavailable");
    }
  });
  const first = service.checkForUpdates();
  const second = service.checkForUpdates();
  assert.equal(first, second);
  releaseRequest();
  assert.equal((await first).status, "network");
  assert.equal(calls, 1);

  await mkdir(path.dirname(module.updateCheckCachePath(root)), { recursive: true });
  await writeFile(module.updateCheckCachePath(root), JSON.stringify({ schemaVersion: 1, sourceId: "legacy-source" }), "utf8");
  assert.equal(await service.getCachedUpdateCheck(), null);
});

test("public PlaTuring/Relay stable releases endpoint is anonymously readable", {
  skip: process.env.RELAY_LIVE_GITHUB_UPDATE_CHECK !== "1"
}, async (context) => {
  const module = await loadUpdateModule(context);
  const root = await dataRoot(context, "live");
  const service = module.createGithubUpdateCheckService({
    currentVersion: "1.0.0",
    dataRootPath: root
  });
  const checked = await service.checkForUpdates();
  assert.ok(["latest", "update_available", "no_release"].includes(checked.status), checked.message);
  assert.equal(checked.channel, "stable");
  assert.equal("source" in checked, false);
  assert.equal(checked.cachePersisted, true);
});
