import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const projectRoot = path.resolve(import.meta.dirname, "..");

async function loadModule(context) {
  const buildRoot = await mkdtemp(path.join(os.tmpdir(), "relay-a28-preflight-module-"));
  context.after(() => rm(buildRoot, { recursive: true, force: true }));
  const outfile = path.join(buildRoot, "asset-preflight.mjs");
  await build({
    entryPoints: [path.join(projectRoot, "src", "main", "services", "asset-preflight.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "silent"
  });
  return import(`${new URL(`file:///${outfile.replaceAll("\\", "/")}`).href}?test=${Date.now()}`);
}

function png(width, height, colorType = 6) {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes[24] = 8;
  bytes[25] = colorType;
  return bytes;
}

function fakeMp4() {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32BE(24, 0);
  bytes.write("ftyp", 4, "ascii");
  bytes.write("isom", 8, "ascii");
  return bytes;
}

function fakeWav() {
  const bytes = Buffer.alloc(44);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(36, 4);
  bytes.write("WAVE", 8, "ascii");
  bytes.write("fmt ", 12, "ascii");
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(48_000, 24);
  return bytes;
}

test("image preflight validates magic, SHA-256, dimensions, alpha and expected-content changes", async (context) => {
  const module = await loadModule(context);
  const root = await mkdtemp(path.join(os.tmpdir(), "relay a28 预检 Ω "));
  context.after(() => rm(root, { recursive: true, force: true }));
  const image = path.join(root, "首帧.png");
  await writeFile(image, png(1344, 768, 6));
  const checked = await module.preflightLocalAsset(image, { now: () => new Date("2026-08-30T00:00:00.000Z") });
  assert.equal(checked.status, "usable");
  assert.equal(checked.mediaType, "image");
  assert.equal(checked.detectedMime, "image/png");
  assert.equal(checked.image.width, 1344);
  assert.equal(checked.image.height, 768);
  assert.equal(checked.image.hasAlpha, true);
  assert.equal(checked.image.orientation, 1);
  assert.equal(checked.image.structurallyDecoded, true);
  assert.match(checked.sha256, /^[0-9a-f]{64}$/u);
  assert.equal(checked.byteLength, 33);

  const changed = await module.preflightLocalAsset(image, {
    expectedByteLength: checked.byteLength,
    expectedSha256: "0".repeat(64)
  });
  assert.equal(changed.status, "changed");
  assert.equal(changed.issues[0].code, "CONTENT_CHANGED");

  const mismatch = path.join(root, "伪装.jpg");
  await writeFile(mismatch, png(32, 32));
  const rejected = await module.preflightLocalAsset(mismatch);
  assert.equal(rejected.status, "incompatible");
  assert.equal(rejected.issues[0].code, "MIME_EXTENSION_MISMATCH");
});

test("video and audio preflight consumes ffprobe JSON through a fixed executable/argument seam", async (context) => {
  const module = await loadModule(context);
  const root = await mkdtemp(path.join(os.tmpdir(), "relay-a28-av-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const video = path.join(root, "镜头.mp4");
  const audio = path.join(root, "环境声.wav");
  await writeFile(video, fakeMp4());
  await writeFile(audio, fakeWav());
  const calls = [];
  const ffprobeRunner = async (executable, arguments_) => {
    const filePath = arguments_.at(-1);
    calls.push({ executable, arguments_, filePath });
    if (filePath === video) return {
      format: { duration: "5.000" },
      streams: [
        { codec_type: "video", codec_name: "h264", pix_fmt: "yuv420p", width: 1920, height: 1080, avg_frame_rate: "24/1" },
        { codec_type: "audio", codec_name: "aac", channels: 2, sample_rate: "48000" }
      ]
    };
    return { format: { duration: "12.5" }, streams: [{ codec_type: "audio", codec_name: "pcm_s16le", channels: 2, sample_rate: "48000" }] };
  };
  const checkedVideo = await module.preflightLocalAsset(video, { ffprobePath: "C:\\Tools\\ffprobe.exe", ffprobeRunner });
  assert.equal(checkedVideo.status, "usable");
  assert.deepEqual(checkedVideo.video, {
    durationSeconds: 5,
    frameRate: 24,
    codec: "h264",
    pixelFormat: "yuv420p",
    width: 1920,
    height: 1080,
    audioTrackCount: 1
  });
  assert.equal(checkedVideo.audio.codec, "aac");
  const checkedAudio = await module.preflightLocalAsset(audio, { ffprobePath: "C:\\Tools\\ffprobe.exe", ffprobeRunner });
  assert.equal(checkedAudio.status, "usable");
  assert.equal(checkedAudio.audio.durationSeconds, 12.5);
  assert.equal(checkedAudio.audio.sampleRate, 48_000);
  assert.deepEqual(calls.map((call) => call.executable), ["C:\\Tools\\ffprobe.exe", "C:\\Tools\\ffprobe.exe"]);
  assert.deepEqual(calls[0].arguments_.slice(0, 6), ["-v", "error", "-print_format", "json", "-show_format", "-show_streams"]);

  const noProbe = await module.preflightLocalAsset(video, { ffprobePath: null });
  assert.equal(noProbe.status, "check_failed");
  assert.equal(noProbe.issues[0].code, "FFPROBE_UNAVAILABLE");
});

test("missing, directories, unsupported files and reparse paths fail closed without fake success", async (context) => {
  const module = await loadModule(context);
  const root = await mkdtemp(path.join(os.tmpdir(), "relay-a28-safety-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const missing = await module.preflightLocalAsset(path.join(root, "missing.png"));
  assert.equal(missing.status, "missing");
  const directory = await module.preflightLocalAsset(root);
  assert.equal(directory.status, "incompatible");
  assert.equal(directory.issues[0].code, "EXTENSION_UNSUPPORTED");
  const payload = path.join(root, "payload.exe");
  await writeFile(payload, "MZ");
  assert.equal((await module.preflightLocalAsset(payload)).status, "incompatible");

  const realDirectory = path.join(root, "real");
  const source = path.join(realDirectory, "image.png");
  const link = path.join(root, "linked.png");
  await mkdir(realDirectory);
  await writeFile(source, png(64, 64));
  try {
    await symlink(source, link, "file");
  } catch (error) {
    if (error?.code === "EPERM") return;
    throw error;
  }
  const linked = await module.preflightLocalAsset(link);
  assert.equal(linked.status, "incompatible");
  assert.equal(linked.issues[0].code, "NOT_DIRECT_FILE");
});
