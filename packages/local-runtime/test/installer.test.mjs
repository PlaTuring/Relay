import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { main as cliMain } from "../bin/local-runtime.mjs";
import {
  INSTALL_CATALOG,
  LocalRuntimeError,
  cancelInstall,
  createInstallPlan,
  downloadArtifact,
  extractComfyPortable,
  extractFfmpegArchive,
  getInstallStatus,
  installComponents,
  recoverInstall,
  resolveSelectedArtifacts,
  validateArchiveListing
} from "../src/index.mjs";

const GIB = 1024 ** 3;

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function missing(filePath) {
  try {
    await stat(filePath);
    return false;
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
}

async function servePayload(payload, { slow = false } = {}) {
  const ranges = [];
  const server = createServer((request, response) => {
    const range = request.headers.range ?? null;
    ranges.push(range);
    let offset = 0;
    if (range) offset = Number(/^bytes=([0-9]+)-$/u.exec(range)?.[1] ?? 0);
    const body = payload.subarray(offset);
    response.statusCode = range ? 206 : 200;
    response.setHeader("content-length", body.byteLength);
    if (range) response.setHeader("content-range", `bytes ${offset}-${payload.byteLength - 1}/${payload.byteLength}`);
    if (!slow || body.byteLength < 2) {
      response.end(body);
      return;
    }
    const midpoint = Math.max(1, Math.floor(body.byteLength / 2));
    response.write(body.subarray(0, midpoint));
    setTimeout(() => response.end(body.subarray(midpoint)), 80);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}/artifact.bin`,
    ranges,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

async function serveInterruptedPayload(payload, cutoff) {
  const ranges = [];
  const server = createServer((request, response) => {
    const range = request.headers.range ?? null;
    ranges.push(range);
    let offset = 0;
    if (range) offset = Number(/^bytes=([0-9]+)-$/u.exec(range)?.[1] ?? 0);
    const body = payload.subarray(offset);
    response.statusCode = range ? 206 : 200;
    response.setHeader("content-length", body.byteLength);
    if (range) response.setHeader("content-range", `bytes ${offset}-${payload.byteLength - 1}/${payload.byteLength}`);
    response.flushHeaders();
    response.write(body.subarray(0, Math.min(cutoff, body.byteLength - 1)));
    setTimeout(() => response.destroy(), 20);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}/artifact.bin`,
    ranges,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

async function serveChunkedPayload(payload, { chunkSize = 4 * 1024, intervalMs = 2 } = {}) {
  const ranges = [];
  const server = createServer((request, response) => {
    const range = request.headers.range ?? null;
    ranges.push(range);
    let offset = 0;
    if (range) offset = Number(/^bytes=([0-9]+)-$/u.exec(range)?.[1] ?? 0);
    const body = payload.subarray(offset);
    response.statusCode = range ? 206 : 200;
    response.setHeader("content-length", body.byteLength);
    if (range) response.setHeader("content-range", `bytes ${offset}-${payload.byteLength - 1}/${payload.byteLength}`);
    let cursor = 0;
    const writeNext = () => {
      if (cursor >= body.byteLength) {
        response.end();
        return;
      }
      const next = Math.min(cursor + chunkSize, body.byteLength);
      response.write(body.subarray(cursor, next));
      cursor = next;
      setTimeout(writeNext, intervalMs);
    };
    writeNext();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}/artifact.bin`,
    ranges,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

function fixtureCatalog(url, payload) {
  return {
    schema_version: "1.0.0",
    catalog_id: "fixture-catalog-v1",
    components: { "comfy-portable": { requires: [] } },
    artifacts: [{
      id: "fixture-model",
      component: "comfy-portable",
      kind: "model",
      role: "fixture_model",
      relative_path: "diffusion_models/fixture.bin",
      destination_relative_path: "runtime/ComfyUI_windows_portable/ComfyUI/models/diffusion_models/fixture.bin",
      url,
      expected_byte_length: payload.byteLength,
      expected_sha256: digest(payload),
      source: { repository: url, revision: "fixture-rev", relative_path: "diffusion_models/fixture.bin" },
      experimental: false
    }]
  };
}

function ffmpegFixtureCatalog(url, payload) {
  return {
    schema_version: "1.0.0",
    catalog_id: "fixture-ffmpeg-catalog-v1",
    components: { "ffmpeg-managed": { requires: [] } },
    artifacts: [{
      id: "fixture-ffmpeg",
      component: "ffmpeg-managed",
      kind: "ffmpeg_archive",
      role: "ffmpeg_cli",
      relative_path: "fixture-ffmpeg.zip",
      destination_relative_path: "downloads/fixture-ffmpeg.zip",
      managed_destination_relative_path: "runtime/ffmpeg/fixture-ffmpeg",
      archive_root: "fixture-ffmpeg",
      required_files: ["bin/ffmpeg.exe", "bin/ffprobe.exe"],
      url,
      expected_byte_length: payload.byteLength,
      expected_sha256: digest(payload),
      installed_byte_estimate: payload.byteLength * 4,
      source: { repository: url, revision: "fixture-rev", relative_path: "fixture-ffmpeg.zip" },
      experimental: false
    }]
  };
}

function desktopInstallerFixtureCatalog(url, payload) {
  return {
    schema_version: "1.0.0",
    catalog_id: "fixture-comfy-desktop-catalog-v1",
    components: { "comfy-desktop": { requires: [] } },
    artifacts: [{
      id: "fixture-comfy-desktop-installer",
      component: "comfy-desktop",
      kind: "external_installer",
      role: "comfy_desktop_installer",
      relative_path: "Comfy-Desktop-fixture-x64-Setup.exe",
      destination_relative_path: "downloads/Comfy-Desktop-fixture-x64-Setup.exe",
      url,
      expected_byte_length: payload.byteLength,
      expected_sha256: digest(payload),
      execution_policy: "download_verify_user_launch_only",
      mutable_origin: true,
      fail_closed_identity: true,
      source: { repository: url, revision: "fixture-version", relative_path: "Comfy-Desktop-fixture-x64-Setup.exe" },
      signature: { status: "Valid", subject: "Fixture Signer" },
      experimental: false
    }]
  };
}

function installRequest(managedRoot) {
  return {
    managedRoot,
    components: ["comfy-portable"],
    hardware: { vramBytes: 24 * GIB },
    acknowledgements: {
      licenseAccepted: true,
      territoryAcknowledged: true,
      commercialAcknowledged: true,
      downloadConsent: true
    }
  };
}

function memoryCliStreams(input) {
  let stdout = "";
  let stderr = "";
  return {
    streams: {
      stdin: Readable.from([input]),
      stdout: { write(value) { stdout += value; } },
      stderr: { write(value) { stderr += value; } }
    },
    output: () => ({ stdout, stderr })
  };
}

test("production catalog pins exact Comfy, H3, FFmpeg, and Desktop installer identities", () => {
  assert.equal(INSTALL_CATALOG.comfy_version, "0.34.0");
  assert.equal(INSTALL_CATALOG.h3_revision, "4cc1d817b6184899b41293954329f576cb5ae86b");
  assert.equal(INSTALL_CATALOG.artifacts.length, 10);
  const comfy = INSTALL_CATALOG.artifacts.find((value) => value.kind === "comfy_archive");
  assert.equal(comfy.expected_byte_length, 2_146_721_943);
  assert.equal(comfy.expected_sha256, "ed57cc6b19ae3d83add1ecebfdd56b25e04e0008cf0fe9af43a4ad8797e2a24c");
  const ffmpeg = INSTALL_CATALOG.artifacts.find((value) => value.kind === "ffmpeg_archive");
  assert.equal(ffmpeg.source.asset_id, 522_311_360);
  assert.equal(ffmpeg.source.revision, "48576f197ad1c2afb2e0b8efe204919a1afbff54");
  assert.equal(ffmpeg.expected_byte_length, 169_203_574);
  assert.equal(ffmpeg.expected_sha256, "5bbf30d81a46e4ea3bf692da189141e88a269252518e9202b95fedec3996b93e");
  assert.equal(ffmpeg.url, "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-08-20-13-45/ffmpeg-n9.0.1-6-g9d4ca21220-win64-gpl-9.0.zip");
  const desktop = INSTALL_CATALOG.artifacts.find((value) => value.kind === "external_installer");
  assert.equal(desktop.component, "comfy-desktop");
  assert.equal(desktop.expected_byte_length, 179_991_984);
  assert.equal(desktop.expected_sha256, "16322682641f1262c2686183f96f1cef8bbc523f3886c8fbd516508295606ab5");
  assert.equal(desktop.url, "https://dl.todesktop.com/241130tqe9q3y/windows/nsis/x64");
  assert.equal(desktop.execution_policy, "download_verify_user_launch_only");
  assert.equal(desktop.mutable_origin, true);
  assert.equal(desktop.fail_closed_identity, true);
  assert.deepEqual(desktop.signature, { status: "Valid", subject: "Drip Artificial Inc" });
  const h3Models = INSTALL_CATALOG.artifacts.filter((value) => value.kind === "model");
  assert.equal(h3Models.length, 7);
  for (const artifact of h3Models) {
    assert.equal(artifact.urls.length, 2);
    assert.equal(artifact.urls[0], artifact.url);
    assert.match(artifact.urls[0], /^https:\/\/www\.modelscope\.cn\/models\/Comfy-Org\/MiniMax-H3\/resolve\/550fc1018db6decfd70b5c0e461a9df477bddf04\//u);
    assert.match(artifact.urls[1], /^https:\/\/huggingface\.co\/Comfy-Org\/MiniMax-H3\/resolve\/4cc1d817b6184899b41293954329f576cb5ae86b\//u);
    assert.equal(artifact.mirrors[0].identity_policy, "exact_byte_length_and_sha256");
  }
  for (const artifact of INSTALL_CATALOG.artifacts) {
    assert.match(artifact.url, /^https:\/\//u);
    assert.doesNotMatch(new URL(artifact.url).pathname, /\/(?:main|latest)(?:\/|$)/u);
    assert.match(artifact.expected_sha256, /^[0-9a-f]{64}$/u);
  }
});

test("managed FFmpeg and Comfy Desktop resolve to distinct, non-executing artifacts", async (context) => {
  const ffmpegArtifacts = resolveSelectedArtifacts(["ffmpeg-managed"]);
  assert.equal(ffmpegArtifacts.length, 1);
  assert.equal(ffmpegArtifacts[0].kind, "ffmpeg_archive");
  const desktopArtifacts = resolveSelectedArtifacts(["comfy-desktop"]);
  assert.equal(desktopArtifacts.length, 1);
  assert.equal(desktopArtifacts[0].kind, "external_installer");
  assert.equal(desktopArtifacts[0].execution_policy, "download_verify_user_launch_only");
  const root = await mkdtemp(path.join(os.tmpdir(), "h3-comfy-desktop-plan-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const plan = await createInstallPlan(
    { ...installRequest(root), components: ["comfy-desktop"] },
    { freeSpaceBytes: 2 * GIB }
  );
  assert.equal(plan.entries[0].action, "download");
  assert.equal(plan.entries[0].execution_policy, "download_verify_user_launch_only");
  assert.equal(plan.entries[0].destination_relative_path, "downloads/Comfy-Desktop-1.0.46-x64-Setup.exe");
});

test("CLI install-plan persists queryable state before execute and keeps deterministic root and operation id", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "h3-cli-prepare-execute-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const payload = Buffer.from("prepared transaction installer fixture", "utf8");
  const server = await servePayload(payload);
  context.after(() => server.close());
  const catalog = desktopInstallerFixtureCatalog(server.url, payload);
  const dependencies = { catalog, testMode: true, freeSpaceBytes: 2 * GIB };
  const preparedRequest = {
    ...installRequest(root),
    components: ["comfy-desktop"],
    acknowledgements: {
      licenseAccepted: false,
      territoryAcknowledged: false,
      commercialAcknowledged: false,
      downloadConsent: false
    }
  };
  const prepareIo = memoryCliStreams(JSON.stringify(preparedRequest));
  assert.equal(await cliMain(["install-plan", "--request", "-"], dependencies, prepareIo.streams), 0);
  assert.equal(prepareIo.output().stderr, "");
  const plan = JSON.parse(prepareIo.output().stdout);

  const locator = { managedRoot: root, operationId: plan.operation_id };
  const initialStatusIo = memoryCliStreams(JSON.stringify(locator));
  assert.equal(await cliMain(["install-status", "--request", "-"], dependencies, initialStatusIo.streams), 0);
  assert.equal(initialStatusIo.output().stderr, "");
  const initialStatus = JSON.parse(initialStatusIo.output().stdout);
  assert.equal(initialStatus.status, "in_progress");
  assert.equal(initialStatus.operation_id, plan.operation_id);
  assert.equal(initialStatus.managed_root, plan.managed_root);
  assert.equal(initialStatus.entries[0].status, "pending");

  const executeIo = memoryCliStreams(JSON.stringify({
    ...installRequest(root),
    components: ["comfy-desktop"],
    operationId: plan.operation_id
  }));
  assert.equal(await cliMain(["install", "--request", "-"], dependencies, executeIo.streams), 0);
  assert.equal(executeIo.output().stderr, "");
  const executed = JSON.parse(executeIo.output().stdout);
  assert.equal(executed.status, "complete");
  assert.equal(executed.operation_id, plan.operation_id);
  assert.equal(executed.managed_root, plan.managed_root);

  const finalStatusIo = memoryCliStreams(JSON.stringify(locator));
  assert.equal(await cliMain(["install-status", "--request", "-"], dependencies, finalStatusIo.streams), 0);
  const finalStatus = JSON.parse(finalStatusIo.output().stdout);
  assert.equal(finalStatus.status, "complete");
  assert.equal(finalStatus.operation_id, plan.operation_id);
  assert.equal(finalStatus.managed_root, plan.managed_root);
});

test("duplicate prepared plan preserves cancellation and all-reuse execution cannot complete", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "h3-cli-prepare-cancel-reuse-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const payload = Buffer.from("already verified managed installer", "utf8");
  const catalog = desktopInstallerFixtureCatalog("http://127.0.0.1:1/artifact.bin", payload);
  const dependencies = { catalog, testMode: true, freeSpaceBytes: 2 * GIB };
  const installerPath = path.join(root, ...catalog.artifacts[0].destination_relative_path.split("/"));
  await mkdir(path.dirname(installerPath), { recursive: true });
  await writeFile(installerPath, payload);
  const preparedRequest = {
    ...installRequest(root),
    components: ["comfy-desktop"],
    acknowledgements: {
      licenseAccepted: false,
      territoryAcknowledged: false,
      commercialAcknowledged: false,
      downloadConsent: false
    }
  };
  const firstIo = memoryCliStreams(JSON.stringify(preparedRequest));
  assert.equal(await cliMain(["install-plan", "--request", "-"], dependencies, firstIo.streams), 0);
  const plan = JSON.parse(firstIo.output().stdout);
  assert.equal(plan.entries[0].action, "reuse_managed");
  assert.equal((await cancelInstall({ managedRoot: root, operationId: plan.operation_id })).status, "cancellation_requested");

  const duplicateIo = memoryCliStreams(JSON.stringify(preparedRequest));
  assert.equal(await cliMain(["install-plan", "--request", "-"], dependencies, duplicateIo.streams), 0);
  assert.equal(JSON.parse(duplicateIo.output().stdout).operation_id, plan.operation_id);
  assert.equal((await getInstallStatus({ managedRoot: root, operationId: plan.operation_id })).status, "cancellation_requested");

  const cancelled = await installComponents({
    ...installRequest(root),
    components: ["comfy-desktop"],
    operationId: plan.operation_id
  }, dependencies);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.entries[0].status, "reused");
  assert.deepEqual(await readFile(installerPath), payload);
});

test("external Comfy attach selects models only while fresh managed install explicitly selects Comfy", () => {
  const attachArtifacts = resolveSelectedArtifacts(["fl2va-base", "fl2v-turbo"]);
  assert.equal(attachArtifacts.some((artifact) => artifact.kind === "comfy_archive"), false);
  assert.equal(attachArtifacts.length, 5);
  const freshArtifacts = resolveSelectedArtifacts(["comfy-portable", "fl2va-base", "fl2v-turbo"]);
  assert.equal(freshArtifacts.some((artifact) => artifact.kind === "comfy_archive"), true);
  assert.equal(freshArtifacts.length, 6);
});

test("download resumes with HTTPS-Range semantics and atomically verifies exact bytes", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "h3-download-range-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const payload = Buffer.from("0123456789abcdefghijklmnopqrstuvwxyz", "utf8");
  const server = await servePayload(payload);
  context.after(() => server.close());
  const artifact = fixtureCatalog(server.url, payload).artifacts[0];
  const destinationPath = path.join(root, "fixture.bin");
  await writeFile(`${destinationPath}.partial`, payload.subarray(0, 7));
  await writeFile(`${destinationPath}.partial.json`, `${JSON.stringify({
    schema_version: "1.0.0",
    artifact_id: artifact.id,
    url: artifact.url,
    expected_byte_length: artifact.expected_byte_length,
    expected_sha256: artifact.expected_sha256,
    downloaded_bytes: 7
  })}\n`);
  const result = await downloadArtifact({ artifact, destinationPath, allowHttp: true });
  assert.equal(result.status, "downloaded");
  assert.equal(server.ranges[0], "bytes=7-");
  assert.deepEqual(await readFile(destinationPath), payload);
  assert.equal(await missing(`${destinationPath}.partial`), true);
  assert.equal(await missing(`${destinationPath}.partial.json`), true);
});

test("an interrupted primary stream resumes from the second allowed URL through Range", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "h3-download-mirror-resume-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const payload = Buffer.alloc(512 * 1024, 0x6d);
  const cutoff = 64 * 1024;
  const primary = await serveInterruptedPayload(payload, cutoff);
  const mirror = await servePayload(payload);
  context.after(() => primary.close());
  context.after(() => mirror.close());
  const baseArtifact = fixtureCatalog(primary.url, payload).artifacts[0];
  const artifact = { ...baseArtifact, urls: [primary.url, mirror.url] };
  assert.equal(artifact.urls[0], artifact.url);

  const destinationPath = path.join(root, "fixture.bin");
  const result = await downloadArtifact({ artifact, destinationPath, allowHttp: true });

  assert.equal(result.status, "downloaded");
  assert.equal(primary.ranges[0], null);
  assert.equal(mirror.ranges[0], `bytes=${cutoff}-`);
  assert.deepEqual(await readFile(destinationPath), payload);
  assert.equal(await missing(`${destinationPath}.partial`), true);
  assert.equal(await missing(`${destinationPath}.partial.json`), true);
});

test("a partial sidecar from an older allowed source resumes against the current primary", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "h3-download-cross-source-sidecar-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const payload = Buffer.from("cross-source resume keeps the artifact identity binding", "utf8");
  const currentPrimary = await servePayload(payload);
  context.after(() => currentPrimary.close());
  const previousPrimaryUrl = "http://127.0.0.1:9/previous-artifact.bin";
  const baseArtifact = fixtureCatalog(currentPrimary.url, payload).artifacts[0];
  const artifact = { ...baseArtifact, urls: [currentPrimary.url, previousPrimaryUrl] };
  const destinationPath = path.join(root, "fixture.bin");
  const downloadedBytes = 17;
  await writeFile(`${destinationPath}.partial`, payload.subarray(0, downloadedBytes));
  await writeFile(`${destinationPath}.partial.json`, `${JSON.stringify({
    schema_version: "1.0.0",
    artifact_id: artifact.id,
    url: previousPrimaryUrl,
    expected_byte_length: artifact.expected_byte_length,
    expected_sha256: artifact.expected_sha256,
    downloaded_bytes: downloadedBytes
  })}\n`);

  const result = await downloadArtifact({ artifact, destinationPath, allowHttp: true });

  assert.equal(result.status, "downloaded");
  assert.equal(currentPrimary.ranges[0], `bytes=${downloadedBytes}-`);
  assert.deepEqual(await readFile(destinationPath), payload);
  assert.equal(await missing(`${destinationPath}.partial`), true);
  assert.equal(await missing(`${destinationPath}.partial.json`), true);
});

test("a source that ignores Range cannot discard a trusted partial before mirror fallback", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "h3-download-range-ignored-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const payload = Buffer.from("preserve this prefix when a source ignores the requested range", "utf8");
  const primaryRanges = [];
  const primaryServer = createServer((request, response) => {
    primaryRanges.push(request.headers.range ?? null);
    response.statusCode = 200;
    response.setHeader("content-length", payload.byteLength);
    response.end(payload);
  });
  await new Promise((resolve) => primaryServer.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise((resolve, reject) => primaryServer.close((error) => error ? reject(error) : resolve())));
  const primaryAddress = primaryServer.address();
  const primaryUrl = `http://127.0.0.1:${primaryAddress.port}/artifact.bin`;
  const mirror = await servePayload(payload);
  context.after(() => mirror.close());
  const baseArtifact = fixtureCatalog(primaryUrl, payload).artifacts[0];
  const artifact = { ...baseArtifact, urls: [primaryUrl, mirror.url] };
  const destinationPath = path.join(root, "fixture.bin");
  const downloadedBytes = 19;
  await writeFile(`${destinationPath}.partial`, payload.subarray(0, downloadedBytes));
  await writeFile(`${destinationPath}.partial.json`, `${JSON.stringify({
    schema_version: "1.0.0",
    artifact_id: artifact.id,
    url: artifact.url,
    expected_byte_length: artifact.expected_byte_length,
    expected_sha256: artifact.expected_sha256,
    downloaded_bytes: downloadedBytes
  })}\n`);

  const result = await downloadArtifact({ artifact, destinationPath, allowHttp: true });

  assert.equal(result.status, "downloaded");
  assert.deepEqual(primaryRanges, [`bytes=${downloadedBytes}-`]);
  assert.equal(mirror.ranges[0], `bytes=${downloadedBytes}-`);
  assert.deepEqual(await readFile(destinationPath), payload);
});

test("a fully downloaded partial is verified and committed without an invalid end-of-file Range request", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "h3-download-complete-partial-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const payload = Buffer.from("complete partial survives a crash before final rename", "utf8");
  const unreachableUrl = "http://127.0.0.1:1/artifact.bin";
  const artifact = fixtureCatalog(unreachableUrl, payload).artifacts[0];
  const destinationPath = path.join(root, "fixture.bin");
  await writeFile(`${destinationPath}.partial`, payload);
  await writeFile(`${destinationPath}.partial.json`, `${JSON.stringify({
    schema_version: "1.0.0",
    artifact_id: artifact.id,
    url: artifact.url,
    expected_byte_length: artifact.expected_byte_length,
    expected_sha256: artifact.expected_sha256,
    downloaded_bytes: payload.byteLength
  })}\n`);

  const result = await downloadArtifact({ artifact, destinationPath, allowHttp: true });

  assert.equal(result.status, "downloaded");
  assert.deepEqual(await readFile(destinationPath), payload);
  assert.equal(await missing(`${destinationPath}.partial`), true);
  assert.equal(await missing(`${destinationPath}.partial.json`), true);
});

test("a complete valid partial without a sidecar is recovered by full SHA-256 without network access", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "h3-download-complete-no-sidecar-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const payload = Buffer.from("state sidecar may be lost after the complete partial reaches disk", "utf8");
  const artifact = fixtureCatalog("http://127.0.0.1:1/artifact.bin", payload).artifacts[0];
  const destinationPath = path.join(root, "fixture.bin");
  await writeFile(`${destinationPath}.partial`, payload);

  const result = await downloadArtifact({ artifact, destinationPath, allowHttp: true });

  assert.equal(result.status, "downloaded");
  assert.deepEqual(await readFile(destinationPath), payload);
  assert.equal(await missing(`${destinationPath}.partial`), true);
});

test("cancellation wins before a complete partial is hashed or committed", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "h3-download-complete-cancelled-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const payload = Buffer.from("leave the complete partial untouched when cancellation is already requested", "utf8");
  const artifact = fixtureCatalog("http://127.0.0.1:1/artifact.bin", payload).artifacts[0];
  const destinationPath = path.join(root, "fixture.bin");
  await writeFile(`${destinationPath}.partial`, payload);

  const result = await downloadArtifact({
    artifact,
    destinationPath,
    allowHttp: true,
    isCancelled: async () => true
  });

  assert.equal(result.status, "cancelled");
  assert.equal(await missing(destinationPath), true);
  assert.deepEqual(await readFile(`${destinationPath}.partial`), payload);
});

test("two operations cannot write the same managed artifact partial concurrently", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "h3-download-single-writer-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const payload = Buffer.alloc(512 * 1024, 0x41);
  const server = await serveChunkedPayload(payload, { chunkSize: 4 * 1024, intervalMs: 3 });
  context.after(() => server.close());
  const artifact = fixtureCatalog(server.url, payload).artifacts[0];
  const destinationPath = path.join(root, "fixture.bin");
  const first = downloadArtifact({ artifact, destinationPath, allowHttp: true });
  for (let attempt = 0; attempt < 100 && await missing(`${destinationPath}.download.lock`); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }

  await assert.rejects(
    () => downloadArtifact({ artifact, destinationPath, allowHttp: true }),
    (error) => error instanceof LocalRuntimeError && error.code === "LOCAL_RUNTIME.DOWNLOAD_ALREADY_RUNNING"
  );
  assert.equal((await first).status, "downloaded");
  assert.deepEqual(await readFile(destinationPath), payload);
  assert.equal(await missing(`${destinationPath}.download.lock`), true);
});

test("the closed partial is re-hashed from disk before commit", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "h3-download-disk-rehash-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const payload = Buffer.alloc(9 * 1024 * 1024, 0x52);
  const server = await servePayload(payload);
  context.after(() => server.close());
  const artifact = fixtureCatalog(server.url, payload).artifacts[0];
  const destinationPath = path.join(root, "fixture.bin");
  let mutated = false;

  await assert.rejects(
    () => downloadArtifact({
      artifact,
      destinationPath,
      allowHttp: true,
      onProgress: async (downloadedBytes) => {
        if (!mutated && downloadedBytes >= 8 * 1024 * 1024) {
          mutated = true;
          await writeFile(`${destinationPath}.partial`, Buffer.from([0x00]), { flag: "r+" });
        }
      }
    }),
    (error) => error instanceof LocalRuntimeError && error.code === "LOCAL_RUNTIME.DOWNLOAD_SHA256_MISMATCH"
  );
  assert.equal(mutated, true);
  assert.equal(await missing(destinationPath), true);
  assert.equal(await missing(`${destinationPath}.partial`), true);
});

test("a deterministic mirror failure is not repeated because another source was transient", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "h3-download-per-source-retry-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const expectedPayload = Buffer.alloc(256 * 1024, 0x33);
  const wrongPayload = Buffer.alloc(expectedPayload.byteLength, 0x44);
  const primary = await serveInterruptedPayload(expectedPayload, 32 * 1024);
  const mirror = await servePayload(wrongPayload);
  context.after(() => primary.close());
  context.after(() => mirror.close());
  const baseArtifact = fixtureCatalog(primary.url, expectedPayload).artifacts[0];
  const artifact = { ...baseArtifact, urls: [primary.url, mirror.url] };
  const destinationPath = path.join(root, "fixture.bin");

  await assert.rejects(
    () => downloadArtifact({ artifact, destinationPath, allowHttp: true }),
    (error) => error instanceof LocalRuntimeError && error.code === "LOCAL_RUNTIME.DOWNLOAD_STREAM_FAILED"
  );
  assert.equal(mirror.ranges.length, 1);
  assert.equal(primary.ranges.length, 2);
});

test("hash mismatch never commits a final file and removes the corrupt partial", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "h3-download-hash-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const payload = Buffer.from("bad download", "utf8");
  const server = await servePayload(payload);
  context.after(() => server.close());
  const artifact = { ...fixtureCatalog(server.url, payload).artifacts[0], expected_sha256: "0".repeat(64) };
  const destinationPath = path.join(root, "fixture.bin");
  await assert.rejects(() => downloadArtifact({ artifact, destinationPath, allowHttp: true }), (error) => {
    assert.ok(error instanceof LocalRuntimeError);
    assert.equal(error.code, "LOCAL_RUNTIME.DOWNLOAD_SHA256_MISMATCH");
    return true;
  });
  assert.equal(await missing(destinationPath), true);
  assert.equal(await missing(`${destinationPath}.partial`), true);
});

test("managed FFmpeg installs atomically, records identity, and is reused without redownload", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "h3-install-ffmpeg-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const payload = Buffer.from("fixture FFmpeg archive bytes", "utf8");
  const server = await servePayload(payload);
  context.after(() => server.close());
  const catalog = ffmpegFixtureCatalog(server.url, payload);
  const request = { ...installRequest(root), components: ["ffmpeg-managed"] };
  let extractions = 0;
  const tarRunner = {
    async list() {
      return "fixture-ffmpeg/bin/ffmpeg.exe\nfixture-ffmpeg/bin/ffprobe.exe\n";
    },
    async extract(_archive, destination) {
      extractions += 1;
      const binaryDirectory = path.join(destination, "fixture-ffmpeg", "bin");
      await mkdir(binaryDirectory, { recursive: true });
      await writeFile(path.join(binaryDirectory, "ffmpeg.exe"), "ffmpeg fixture");
      await writeFile(path.join(binaryDirectory, "ffprobe.exe"), "ffprobe fixture");
    }
  };

  const installed = await installComponents(request, {
    catalog,
    testMode: true,
    freeSpaceBytes: 2 * GIB,
    tarRunner
  });
  assert.equal(installed.status, "complete");
  assert.equal(extractions, 1);
  const managedFfmpeg = path.join(root, "runtime", "ffmpeg", "fixture-ffmpeg", "bin");
  assert.equal((await readFile(path.join(managedFfmpeg, "ffmpeg.exe"), "utf8")), "ffmpeg fixture");
  assert.equal((await readFile(path.join(managedFfmpeg, "ffprobe.exe"), "utf8")), "ffprobe fixture");
  assert.equal(await missing(path.join(root, "downloads", "fixture-ffmpeg.zip")), true);

  const manifest = JSON.parse(await readFile(path.join(root, ".minimax-h3", "managed-manifest.json"), "utf8"));
  assert.equal(manifest.artifacts[0].id, "fixture-ffmpeg");
  assert.equal(manifest.artifacts[0].expected_sha256, digest(payload));
  const reusePlan = await createInstallPlan(request, { catalog, testMode: true, freeSpaceBytes: 2 * GIB });
  assert.equal(reusePlan.entries[0].action, "reuse_managed");
  assert.equal(reusePlan.totals.download_bytes, 0);
});

test("FFmpeg extraction rejects extra roots and observes cancellation before commit", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "h3-extract-ffmpeg-safe-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const archivePath = path.join(root, "fixture.zip");
  await writeFile(archivePath, "fixture");
  const destinationPath = path.join(root, "runtime", "ffmpeg", "fixture-ffmpeg");
  const stagingPath = path.join(root, "staging");
  const unsafeRunner = {
    async list() {
      return "fixture-ffmpeg/bin/ffmpeg.exe\nfixture-ffmpeg/bin/ffprobe.exe\nother-root/file.txt\n";
    },
    async extract() {
      assert.fail("unsafe archive must not be extracted");
    }
  };
  await assert.rejects(
    () => extractFfmpegArchive({
      archivePath,
      stagingPath,
      destinationPath,
      archiveRoot: "fixture-ffmpeg",
      requiredFiles: ["bin/ffmpeg.exe", "bin/ffprobe.exe"],
      runner: unsafeRunner
    }),
    (error) => error instanceof LocalRuntimeError && error.code === "LOCAL_RUNTIME.FFMPEG_ARCHIVE_LAYOUT_INVALID"
  );
  assert.equal(await missing(destinationPath), true);

  let cancellationChecks = 0;
  const cancelled = await extractFfmpegArchive({
    archivePath,
    stagingPath,
    destinationPath,
    archiveRoot: "fixture-ffmpeg",
    requiredFiles: ["bin/ffmpeg.exe", "bin/ffprobe.exe"],
    runner: {
      async list() { return "fixture-ffmpeg/bin/ffmpeg.exe\nfixture-ffmpeg/bin/ffprobe.exe\n"; },
      async extract() { assert.fail("cancelled extraction must not start"); }
    },
    isCancelled: async () => {
      cancellationChecks += 1;
      return cancellationChecks >= 2;
    }
  });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(await missing(destinationPath), true);
});

test("Comfy Desktop installer is downloaded and verified but never executed", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "h3-install-comfy-desktop-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const payload = Buffer.from("signed Comfy Desktop installer fixture", "utf8");
  const server = await servePayload(payload);
  context.after(() => server.close());
  const catalog = desktopInstallerFixtureCatalog(server.url, payload);
  const request = { ...installRequest(root), components: ["comfy-desktop"] };
  const plan = await createInstallPlan(request, { catalog, testMode: true, freeSpaceBytes: 2 * GIB });
  assert.equal(plan.entries[0].kind, "external_installer");
  assert.equal(plan.entries[0].action, "download");
  assert.equal(plan.entries[0].execution_policy, "download_verify_user_launch_only");
  const tarRunner = {
    async list() { assert.fail("Desktop installer must not be inspected as an archive"); },
    async extract() { assert.fail("Desktop installer must never be executed or extracted"); }
  };
  const installed = await installComponents({ ...request, operationId: plan.operation_id }, {
    catalog,
    testMode: true,
    freeSpaceBytes: 2 * GIB,
    tarRunner
  });
  assert.equal(installed.status, "complete");
  const installerPath = path.join(root, "downloads", "Comfy-Desktop-fixture-x64-Setup.exe");
  assert.deepEqual(await readFile(installerPath), payload);
  const manifest = JSON.parse(await readFile(path.join(root, ".minimax-h3", "managed-manifest.json"), "utf8"));
  assert.equal(manifest.artifacts[0].id, "fixture-comfy-desktop-installer");
  const reusePlan = await createInstallPlan(request, { catalog, testMode: true, freeSpaceBytes: 2 * GIB });
  assert.equal(reusePlan.entries[0].action, "reuse_managed");
  assert.equal(reusePlan.totals.download_bytes, 0);
});

test("cancel preserves a trusted partial and recover resumes it through Range", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "h3-install-cancel-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const payload = Buffer.alloc(256 * 1024, 0x5a);
  // Keep the transfer incomplete past the downloader's 50 ms cancellation
  // checkpoint. A two-chunk response can be fully buffered by newer Node fetch
  // implementations before cancellation is observed, which correctly recovers
  // by hashing the complete partial without issuing a Range request.
  const server = await serveChunkedPayload(payload, { chunkSize: 4 * 1024, intervalMs: 10 });
  context.after(() => server.close());
  const catalog = fixtureCatalog(server.url, payload);
  const request = installRequest(root);
  const plan = await createInstallPlan(request, { catalog, testMode: true, freeSpaceBytes: 2 * GIB });
  const installing = installComponents({ ...request, operationId: plan.operation_id }, { catalog, testMode: true, freeSpaceBytes: 2 * GIB });
  const statePath = path.join(root, ".minimax-h3", "install", plan.operation_id, "state.json");
  for (let attempt = 0; attempt < 50 && await missing(statePath); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  const destinationPath = path.join(root, ...catalog.artifacts[0].destination_relative_path.split("/"));
  const partialPath = `${destinationPath}.partial`;
  let partialSize = 0;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      partialSize = (await stat(partialPath)).size;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (partialSize > 0 && partialSize < payload.byteLength) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(partialSize > 0 && partialSize < payload.byteLength, "cancellation fixture must observe an incomplete trusted partial");
  assert.equal((await cancelInstall({ managedRoot: root, operationId: plan.operation_id })).status, "cancellation_requested");
  const cancelled = await installing;
  assert.equal(cancelled.status, "cancelled");
  assert.equal((await getInstallStatus({ managedRoot: root, operationId: plan.operation_id })).status, "cancelled");
  const recovered = await recoverInstall({ managedRoot: root, operationId: plan.operation_id }, { catalog, testMode: true, freeSpaceBytes: 2 * GIB });
  assert.equal(recovered.status, "complete");
  assert.equal((await cancelInstall({ managedRoot: root, operationId: plan.operation_id })).status, "complete");
  assert.ok(server.ranges.some((value) => typeof value === "string" && value.startsWith("bytes=")));
  assert.deepEqual(await readFile(destinationPath), payload);
});

test("an in-progress state without install.lock is reported as a recoverable orphan failure", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "h3-install-orphan-status-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const payload = Buffer.from("orphaned install fixture", "utf8");
  const catalog = fixtureCatalog("http://127.0.0.1:1/artifact.bin", payload);
  const plan = await createInstallPlan(installRequest(root), {
    catalog,
    testMode: true,
    freeSpaceBytes: 2 * GIB
  });
  const stateRoot = path.join(root, ".minimax-h3", "install", plan.operation_id);
  const lockPath = path.join(stateRoot, "install.lock");
  await mkdir(stateRoot, { recursive: true });
  await writeFile(path.join(stateRoot, "state.json"), `${JSON.stringify({
    schema_version: "1.0.0",
    operation_id: plan.operation_id,
    status: "in_progress",
    managed_root: plan.managed_root,
    entries: [{
      artifact_id: plan.entries[0].artifact_id,
      action: plan.entries[0].action,
      status: "running",
      downloaded_bytes: 7
    }],
    launch_plan: plan.launch_plan,
    error: null
  })}\n`);
  assert.equal(await missing(lockPath), true);

  const status = await getInstallStatus({ managedRoot: root, operationId: plan.operation_id });

  assert.equal(status.status, "failed");
  assert.deepEqual(status.error, {
    code: "LOCAL_RUNTIME.INSTALL_ORPHANED",
    rule_id: "local_runtime.install.orphaned_writer"
  });
  assert.equal(status.entries[0].status, "failed");
});

test("concurrent high-frequency status polling remains coherent during progress writes", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "h3-install-status-polling-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const payload = Buffer.alloc(512 * 1024, 0x73);
  const server = await serveChunkedPayload(payload);
  context.after(() => server.close());
  const catalog = fixtureCatalog(server.url, payload);
  const request = installRequest(root);
  const dependencies = { catalog, testMode: true, freeSpaceBytes: 2 * GIB };
  const plan = await createInstallPlan(request, dependencies);
  const locator = { managedRoot: root, operationId: plan.operation_id };
  const statePath = path.join(root, ".minimax-h3", "install", plan.operation_id, "state.json");
  const installing = installComponents({ ...request, operationId: plan.operation_id }, dependencies);
  for (let attempt = 0; attempt < 100 && await missing(statePath); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.equal(await missing(statePath), false);

  const snapshots = [];
  for (let wave = 0; wave < 32; wave += 1) {
    snapshots.push(...await Promise.all(Array.from(
      { length: 8 },
      () => getInstallStatus(locator)
    )));
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  const installed = await installing;

  assert.equal(snapshots.length, 256);
  assert.ok(snapshots.some((snapshot) => snapshot.status === "in_progress"));
  for (const snapshot of snapshots) {
    assert.equal(snapshot.operation_id, plan.operation_id);
    assert.ok(["in_progress", "complete"].includes(snapshot.status));
    assert.equal(snapshot.error, null);
  }
  assert.equal(installed.status, "complete");
  assert.equal((await getInstallStatus(locator)).status, "complete");
  assert.deepEqual(
    await readFile(path.join(root, ...catalog.artifacts[0].destination_relative_path.split("/"))),
    payload
  );
});

test("external exact model reuse is zero-download and never moves the source", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "h3-install-reuse-"));
  const external = await mkdtemp(path.join(os.tmpdir(), "h3-external-model-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  context.after(() => rm(external, { recursive: true, force: true }));
  const payload = Buffer.from("external model identity", "utf8");
  const catalog = fixtureCatalog("http://127.0.0.1:1/artifact.bin", payload);
  const source = path.join(external, ...catalog.artifacts[0].relative_path.split("/"));
  await mkdir(path.dirname(source), { recursive: true });
  await writeFile(source, payload);
  const plan = await createInstallPlan({ ...installRequest(root), existingModelRoots: [external] }, { catalog, testMode: true, freeSpaceBytes: 2 * GIB });
  assert.equal(plan.entries[0].action, "reuse_external_read_only");
  assert.equal(plan.entries[0].external_read_only, true);
  assert.equal(plan.totals.download_bytes, 0);
  const installed = await installComponents(
    { ...installRequest(root), existingModelRoots: [external], operationId: plan.operation_id },
    { catalog, testMode: true, freeSpaceBytes: 2 * GIB }
  );
  assert.equal(installed.status, "complete");
  const yaml = await readFile(path.join(root, ".minimax-h3", "extra_model_paths.yaml"), "utf8");
  assert.equal(yaml, [
    "# Generated by Relay. Managed paths are tool-owned; external model files remain read-only.",
    "minimax_h3_external_1:",
    `  base_path: ${JSON.stringify(path.dirname(source))}`,
    "  diffusion_models: .",
    ""
  ].join("\n"));
  assert.deepEqual(await readFile(source), payload);
});

test("downloaded managed models are exposed through their actual ComfyUI category mapping", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "h3-install-managed-model-paths-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const payload = Buffer.from("managed model identity", "utf8");
  const server = await servePayload(payload);
  context.after(() => server.close());
  const catalog = fixtureCatalog(server.url, payload);
  const result = await installComponents(installRequest(root), {
    catalog,
    testMode: true,
    freeSpaceBytes: 2 * GIB
  });
  assert.equal(result.status, "complete");
  const managedModelRoot = path.join(root, "runtime", "ComfyUI_windows_portable", "ComfyUI", "models");
  const yaml = await readFile(path.join(root, ".minimax-h3", "extra_model_paths.yaml"), "utf8");
  assert.equal(yaml, [
    "# Generated by Relay. Managed paths are tool-owned; external model files remain read-only.",
    "minimax_h3_managed:",
    `  base_path: ${JSON.stringify(managedModelRoot)}`,
    "  diffusion_models: diffusion_models",
    ""
  ].join("\n"));
  assert.deepEqual(
    await readFile(path.join(managedModelRoot, "diffusion_models", "fixture.bin")),
    payload
  );
});

test("exact filename and length never authorize external reuse when full SHA-256 differs", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "h3-install-reject-false-reuse-"));
  const external = await mkdtemp(path.join(os.tmpdir(), "h3-external-reject-false-reuse-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  context.after(() => rm(external, { recursive: true, force: true }));
  const payload = Buffer.from("expected model bytes", "utf8");
  const wrongPayload = Buffer.alloc(payload.byteLength, 0x78);
  const catalog = fixtureCatalog("http://127.0.0.1:1/artifact.bin", payload);
  const source = path.join(external, ...catalog.artifacts[0].relative_path.split("/"));
  await mkdir(path.dirname(source), { recursive: true });
  await writeFile(source, wrongPayload);

  const plan = await createInstallPlan(
    { ...installRequest(root), existingModelRoots: [external] },
    { catalog, testMode: true, freeSpaceBytes: 2 * GIB }
  );

  assert.equal(plan.entries[0].action, "download");
  assert.equal(plan.entries[0].external_read_only, false);
  assert.equal(plan.totals.download_bytes, payload.byteLength);
  assert.deepEqual(await readFile(source), wrongPayload);
});

test("unsafe or invalid Comfy extraction rolls back staging and never lands a runtime", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "h3-extract-rollback-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const archivePath = path.join(root, "fixture.7z");
  const stagingPath = path.join(root, "staging");
  const destinationPath = path.join(root, "runtime", "ComfyUI_windows_portable");
  await writeFile(archivePath, "fixture");
  const runner = {
    async list() { return "ComfyUI_windows_portable/ComfyUI/main.py\n"; },
    async extract(_archive, destination) {
      const partial = path.join(destination, "ComfyUI_windows_portable", "ComfyUI");
      await mkdir(partial, { recursive: true });
      await writeFile(path.join(partial, "main.py"), "# missing embedded python");
    }
  };
  await assert.rejects(() => extractComfyPortable({ archivePath, stagingPath, destinationPath, runner }), LocalRuntimeError);
  assert.equal(await missing(stagingPath), true);
  assert.equal(await missing(destinationPath), true);
});

test("RTX 5080 reported 16303 MiB is accepted as experimental 16GB class", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "h3-install-5080-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const payload = Buffer.from("fixture", "utf8");
  const catalog = fixtureCatalog("http://127.0.0.1:1/artifact.bin", payload);
  const request = { ...installRequest(root), hardware: { vramBytes: 16_303 * 1024 * 1024 } };
  const plan = await createInstallPlan(request, { catalog, testMode: true, freeSpaceBytes: 2 * GIB });
  assert.equal(plan.launch_plan.status, "ready_after_install");
  assert.equal(plan.launch_plan.hardware_profile, "experimental_16gb_class");
  assert.equal(plan.launch_plan.experimental, true);
  assert.ok(plan.launch_plan.args.includes("--async-offload"));
});

test("archive listing rejects Windows ADS, reserved device names, and trailing dot or space", () => {
  for (const listing of ["runtime/model.bin:stream\n", "runtime/CON.txt\n", "runtime/trailing.\n", "runtime/trailing \n"]) {
    assert.throws(() => validateArchiveListing(listing), LocalRuntimeError);
  }
  assert.deepEqual(validateArchiveListing("ComfyUI_windows_portable/ComfyUI/main.py\n"), ["ComfyUI_windows_portable/ComfyUI/main.py"]);
});
