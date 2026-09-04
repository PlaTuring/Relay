import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const projectRoot = path.resolve(import.meta.dirname, "..");

async function loadDownloadModule(context) {
  const buildRoot = await mkdtemp(path.join(os.tmpdir(), "relay-stable-download-build-"));
  context.after(() => rm(buildRoot, { recursive: true, force: true }));
  const outfile = path.join(buildRoot, "github-update-download.mjs");
  await build({
    entryPoints: [path.join(projectRoot, "src", "main", "services", "github-update-download.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "silent"
  });
  return import(`${new URL(`file:///${outfile.replaceAll("\\", "/")}`).href}?test=${Date.now()}`);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function releaseFixture(overrides = {}) {
  const version = "1.0.1";
  const tag = `v${version}`;
  const setupName = "Relay-1.0.1-x64-Setup.exe";
  const setup = Buffer.from("Relay stable Setup 1.0.1\n", "utf8");
  const files = new Map([[setupName, setup]]);
  const release = Object.freeze({
    channel: "stable",
    tag,
    version,
    releasePageUrl: `https://github.com/PlaTuring/Relay/releases/tag/${tag}`,
    releaseNotes: "Relay 1.0 stable",
    publishedAt: "2026-09-01T12:00:00.000Z",
    assets: Object.freeze({
      setup: Object.freeze({
        kind: "setup",
        name: setupName,
        length: setup.length,
        sha256: sha256(setup),
        downloadUrl: `https://github.com/PlaTuring/Relay/releases/download/${tag}/${setupName}`
      })
    }),
    ...overrides
  });
  return { release, files, setupName, setup };
}

function headerResponse(status, headers, body = null) {
  return Object.freeze({ status, headers: Object.freeze(headers), body });
}

function chunked(value, chunkSize = 7) {
  return (async function* chunks() {
    for (let offset = 0; offset < value.length; offset += chunkSize) {
      await Promise.resolve();
      yield value.subarray(offset, Math.min(value.length, offset + chunkSize));
    }
  }());
}

function successfulClient(fixture, calls, mutate = {}) {
  return async (request) => {
    calls.push(request.url);
    const url = new URL(request.url);
    const fileName = decodeURIComponent(path.posix.basename(url.pathname));
    if (url.hostname === "github.com") {
      const location = mutate.redirectLocation?.(fileName)
        ?? `https://release-assets.githubusercontent.com/relay/${encodeURIComponent(fileName)}?token=bounded`;
      return headerResponse(302, { location });
    }
    const original = fixture.files.get(fileName);
    assert.ok(original, `unexpected asset ${fileName}`);
    const body = mutate.body?.(fileName, original, request.signal) ?? chunked(original);
    const declared = mutate.contentLength?.(fileName, original) ?? original.length;
    return headerResponse(200, { "content-length": String(declared) }, body);
  };
}

async function dataRoot(context, suffix) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), `relay-stable-download-${suffix}-`));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  return path.join(temporary, "Relay 下载 Ω");
}

async function waitForFinal(service) {
  for (let index = 0; index < 400; index += 1) {
    const status = service.getUpdateDownloadStatus();
    if (status.state !== "downloading" && status.state !== "installing") return status;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("download did not reach a final state");
}

test("validated Setup download checks REST length/digest, reports real bytes and atomically publishes", async (context) => {
  const module = await loadDownloadModule(context);
  const fixture = releaseFixture();
  const root = await dataRoot(context, "success");
  const calls = [];
  const openedFolders = [];
  const openedPages = [];
  const launchedInstallers = [];
  const service = module.createGithubUpdateDownloadService({
    dataRootPath: root,
    currentVersion: "1.0.0",
    preferredKind: "setup",
    getValidatedRelease: () => fixture.release,
    httpClient: successfulClient(fixture, calls),
    openFolder: async (folder) => { openedFolders.push(folder); },
    openExternal: async (url) => { openedPages.push(url); },
    launchInstaller: async (installerPath) => {
      assert.deepEqual(await readFile(installerPath), fixture.setup);
      launchedInstallers.push(installerPath);
    }
  });

  const started = await service.downloadUpdate({ kind: "setup" });
  assert.equal(started.state, "downloading");
  assert.equal(started.preferredKind, "setup");
  assert.equal(started.kind, "setup");
  assert.equal(started.phase, "binary");
  assert.equal(started.bytesTotal, fixture.setup.length);
  const completed = await waitForFinal(service);
  assert.equal(completed.state, "completed");
  assert.equal(completed.bytesReceived, fixture.setup.length);
  assert.equal(completed.bytesTotal, fixture.setup.length);
  assert.equal(completed.assetName, fixture.setupName);
  assert.equal(completed.errorCode, null);
  assert.match(completed.message, /安装程序已启动/u);
  assert.doesNotMatch(JSON.stringify(completed), /https:\/\/|[A-Z]:\\|downloads[\\/]updates/iu);

  const folder = module.updateDownloadDirectory(root, fixture.release.version);
  assert.deepEqual(launchedInstallers, [path.join(folder, fixture.setupName)]);
  const repeated = await service.downloadUpdate({ kind: "setup" });
  assert.equal(repeated.state, "completed");
  assert.equal(launchedInstallers.length, 1, "a completed release must never launch twice in one app session");
  assert.deepEqual(await readFile(path.join(folder, fixture.setupName)), fixture.setup);
  assert.deepEqual(await readdir(folder), [fixture.setupName]);
  assert.equal(await service.openDownloadedUpdateFolder(), true);
  assert.equal(await service.openValidatedReleasePage(), true);
  assert.deepEqual(openedFolders, [folder]);
  assert.deepEqual(openedPages, [fixture.release.releasePageUrl]);
  assert.ok(calls.some((url) => url.startsWith("https://github.com/PlaTuring/Relay/releases/download/")));
  assert.ok(calls.some((url) => url.startsWith("https://release-assets.githubusercontent.com/")));
});

test("stable downloader rejects Portable and accepts no renderer URL/path authority", async (context) => {
  const module = await loadDownloadModule(context);
  const fixture = releaseFixture();
  const service = module.createGithubUpdateDownloadService({
    dataRootPath: await dataRoot(context, "setup-only"),
    currentVersion: "1.0.0",
    preferredKind: "setup",
    getValidatedRelease: () => fixture.release,
    httpClient: successfulClient(fixture, [])
  });
  await assert.rejects(service.downloadUpdate({ kind: "portable" }), /kind=setup/u);
  await assert.rejects(service.downloadUpdate({ kind: "setup", url: "https://evil.example" }), /kind=setup/u);
});

test("only one Setup download runs; cancellation removes the partial file", async (context) => {
  const module = await loadDownloadModule(context);
  const fixture = releaseFixture();
  const root = await dataRoot(context, "cancel");
  let firstChunkWritten;
  const firstChunk = new Promise((resolve) => { firstChunkWritten = resolve; });
  const client = successfulClient(fixture, [], {
    body: (_name, original, signal) => (async function* stalled() {
      yield original.subarray(0, 1);
      firstChunkWritten();
      await new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    }())
  });
  const service = module.createGithubUpdateDownloadService({
    dataRootPath: root,
    currentVersion: "1.0.0",
    preferredKind: "setup",
    getValidatedRelease: () => fixture.release,
    httpClient: client
  });
  await service.downloadUpdate({ kind: "setup" });
  await firstChunk;
  await assert.rejects(
    service.downloadUpdate({ kind: "setup" }),
    (error) => error.code === "download_in_progress"
  );
  const cancelled = await service.cancelUpdateDownload();
  assert.equal(cancelled.state, "cancelled");
  assert.equal(cancelled.errorCode, "cancelled");
  const folder = module.updateDownloadDirectory(root, fixture.release.version);
  assert.equal((await readdir(folder)).some((name) => name.endsWith(".partial")), false);
});

test("length, digest, redirect and network failures are precise and remove temporary files", async (context) => {
  const module = await loadDownloadModule(context);
  const base = releaseFixture();
  const badSameLength = Buffer.from(base.setup);
  badSameLength[0] ^= 0xff;
  const failureCases = [
    {
      name: "http-length",
      expected: "length_mismatch",
      fixture: base,
      client: successfulClient(base, [], { contentLength: (_name, original) => original.length + 1 })
    },
    {
      name: "short-response",
      expected: "length_mismatch",
      fixture: base,
      client: successfulClient(base, [], { body: (_name, original) => chunked(original.subarray(0, original.length - 1)) })
    },
    {
      name: "long-response",
      expected: "length_mismatch",
      fixture: base,
      client: successfulClient(base, [], { body: (_name, original) => chunked(Buffer.concat([original, Buffer.from("x")])) })
    },
    {
      name: "unsafe-redirect",
      expected: "redirect_blocked",
      fixture: base,
      client: successfulClient(base, [], { redirectLocation: () => "https://evil.example/payload.exe" })
    },
    {
      name: "network",
      expected: "network",
      fixture: base,
      client: async () => { throw new Error("offline"); }
    },
    {
      name: "digest",
      expected: "hash_mismatch",
      fixture: { ...base, files: new Map([[base.setupName, badSameLength]]) },
      client: successfulClient({ ...base, files: new Map([[base.setupName, badSameLength]]) }, [])
    }
  ];
  for (const item of failureCases) {
    const root = await dataRoot(context, item.name);
    const service = module.createGithubUpdateDownloadService({
      dataRootPath: root,
      currentVersion: "1.0.0",
      preferredKind: "setup",
      getValidatedRelease: () => base.release,
      httpClient: item.client
    });
    await service.downloadUpdate({ kind: "setup" });
    const failed = await waitForFinal(service);
    assert.equal(failed.state, "failed", item.name);
    assert.equal(failed.errorCode, item.expected, item.name);
    const folder = module.updateDownloadDirectory(root, base.release.version);
    const entries = await readdir(folder).catch(() => []);
    assert.equal(entries.some((name) => name.endsWith(".partial")), false, item.name);
    assert.equal(entries.includes(base.setupName), false, item.name);
  }
});

test("idle timeout reports network and leaves no partial file", async (context) => {
  const module = await loadDownloadModule(context);
  const fixture = releaseFixture();
  const root = await dataRoot(context, "timeout");
  const service = module.createGithubUpdateDownloadService({
    dataRootPath: root,
    currentVersion: "1.0.0",
    preferredKind: "setup",
    getValidatedRelease: () => fixture.release,
    timeoutMs: 1_000,
    httpClient: async ({ signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    })
  });
  await service.downloadUpdate({ kind: "setup" });
  const failed = await waitForFinal(service);
  assert.equal(failed.state, "failed");
  assert.equal(failed.errorCode, "network");
  assert.match(failed.message, /超时/u);
  const folder = module.updateDownloadDirectory(root, fixture.release.version);
  const entries = await readdir(folder).catch(() => []);
  assert.equal(entries.some((name) => name.endsWith(".partial")), false);
});

test("same or older releases cannot download or launch even if main-process release state exists", async (context) => {
  const module = await loadDownloadModule(context);
  for (const version of ["1.0.0", "0.9.9"]) {
    const fixture = releaseFixture({ version, tag: `v${version}` });
    let launches = 0;
    const service = module.createGithubUpdateDownloadService({
      dataRootPath: await dataRoot(context, `not-newer-${version}`),
      currentVersion: "1.0.0",
      preferredKind: "setup",
      getValidatedRelease: () => fixture.release,
      httpClient: successfulClient(fixture, []),
      launchInstaller: async () => { launches += 1; }
    });
    const status = await service.downloadUpdate({ kind: "setup" });
    assert.equal(status.state, "failed");
    assert.equal(status.errorCode, "no_newer_release");
    assert.equal(launches, 0);
  }
});

test("installer launch failure is precise, keeps Relay-side state failed and never reports success", async (context) => {
  const module = await loadDownloadModule(context);
  const fixture = releaseFixture();
  const root = await dataRoot(context, "launch-failure");
  let launches = 0;
  const openedFolders = [];
  const service = module.createGithubUpdateDownloadService({
    dataRootPath: root,
    currentVersion: "1.0.0",
    preferredKind: "setup",
    getValidatedRelease: () => fixture.release,
    httpClient: successfulClient(fixture, []),
    openFolder: async (folder) => { openedFolders.push(folder); },
    launchInstaller: async () => {
      launches += 1;
      throw new Error("blocked by policy");
    }
  });
  await service.downloadUpdate({ kind: "setup" });
  const failed = await waitForFinal(service);
  assert.equal(failed.state, "failed");
  assert.equal(failed.errorCode, "installer_launch_failed");
  assert.match(failed.message, /未能启动/u);
  assert.equal(failed.canOpenFolder, true);
  assert.equal(launches, 1);
  const folder = module.updateDownloadDirectory(root, fixture.release.version);
  assert.deepEqual(await readFile(path.join(folder, fixture.setupName)), fixture.setup);
  assert.equal(await service.openDownloadedUpdateFolder(), true);
  assert.deepEqual(openedFolders, [folder]);
});

test("validated Setup remains recoverable when this build has no launch adapter", async (context) => {
  const module = await loadDownloadModule(context);
  const fixture = releaseFixture();
  const root = await dataRoot(context, "launch-unavailable");
  const openedFolders = [];
  const service = module.createGithubUpdateDownloadService({
    dataRootPath: root,
    currentVersion: "1.0.0",
    preferredKind: "setup",
    getValidatedRelease: () => fixture.release,
    httpClient: successfulClient(fixture, []),
    openFolder: async (folder) => { openedFolders.push(folder); }
  });
  await service.downloadUpdate({ kind: "setup" });
  const failed = await waitForFinal(service);
  assert.equal(failed.state, "failed");
  assert.equal(failed.errorCode, "installer_launch_unavailable");
  assert.equal(failed.canOpenFolder, true);
  assert.equal(await service.openDownloadedUpdateFolder(), true);
  const folder = module.updateDownloadDirectory(root, fixture.release.version);
  assert.deepEqual(openedFolders, [folder]);
  assert.deepEqual(await readFile(path.join(folder, fixture.setupName)), fixture.setup);
});

test("redirect policy is allowlisted and renderer has no executable path or command authority", async () => {
  const source = await readFile(
    path.join(projectRoot, "src", "main", "services", "github-update-download.ts"),
    "utf8"
  );
  const moduleBuildRoot = await mkdtemp(path.join(os.tmpdir(), "relay-stable-redirect-build-"));
  try {
    const outfile = path.join(moduleBuildRoot, "github-update-download.mjs");
    await build({
      entryPoints: [path.join(projectRoot, "src", "main", "services", "github-update-download.ts")],
      outfile,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node22",
      logLevel: "silent"
    });
    const module = await import(`${new URL(`file:///${outfile.replaceAll("\\", "/")}`).href}?test=${Date.now()}`);
    assert.equal(module.isAllowedUpdateRedirect("https://release-assets.githubusercontent.com/a/b?token=1"), true);
    assert.equal(module.isAllowedUpdateRedirect("https://objects.githubusercontent.com/a/b?token=1"), true);
    assert.equal(module.isAllowedUpdateRedirect("http://release-assets.githubusercontent.com/a"), false);
    assert.equal(module.isAllowedUpdateRedirect("https://github.com/PlaTuring/Relay/releases/download/x/y"), false);
    assert.equal(module.isAllowedUpdateRedirect("https://evil.example/a"), false);
  } finally {
    await rm(moduleBuildRoot, { recursive: true, force: true });
  }
  assert.doesNotMatch(source, /node:child_process|execFile|spawn\(|shell\.openPath|shell\.showItemInFolder/u);
  assert.doesNotMatch(source, /SHA256SUMS|sha256_manifest|parseStrictSha256Manifest/u);
  assert.match(source, /downloadUpdate\(request: \{ readonly kind: UpdateDownloadKind \}\)/u);
  assert.match(source, /assertVerifiedInstallerStillCurrent\(binaryDestination, verifiedInstallerIdentity\)/u);
  assert.match(source, /dev:[\s\S]*ino:[\s\S]*mtimeMs:[\s\S]*ctimeMs:/u);
  assert.match(source, /launchInstaller\(binaryDestination\)/u);
  const validator = source.match(/function strictDownloadRequest[\s\S]*?\n\}/u)?.[0] ?? "";
  assert.match(validator, /value\.kind !== "setup"/u);
  assert.doesNotMatch(validator, /\.(?:url|path|filename|command)\b/u);
});
