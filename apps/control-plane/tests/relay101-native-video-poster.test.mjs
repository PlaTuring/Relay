import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { build } from "esbuild";

const appRoot = path.resolve(import.meta.dirname, "..");
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function loadRenderer(context) {
  const buildRoot = await mkdtemp(path.join(os.tmpdir(), "relay-native-poster-build-"));
  context.after(() => rm(buildRoot, { recursive: true, force: true }));
  const output = path.join(buildRoot, "native-video-poster.mjs");
  await build({
    entryPoints: [path.join(appRoot, "src", "main", "services", "native-video-poster.ts")],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    logLevel: "silent"
  });
  return import(`${pathToFileURL(output).href}?test=${Date.now()}-${Math.random()}`);
}

function png() {
  return Buffer.concat([PNG_SIGNATURE, Buffer.alloc(64)]);
}

test("native video poster writes a bounded PNG without modifying the source", async (context) => {
  const module = await loadRenderer(context);
  const root = await mkdtemp(path.join(os.tmpdir(), "relay-native-poster-你好-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const cache = path.join(root, "cache");
  await mkdir(cache);
  const source = path.join(root, "视频.mp4");
  const target = path.join(cache, "poster.tmp");
  const videoBytes = Buffer.from("video-evidence");
  await writeFile(source, videoBytes);
  const calls = [];
  const render = module.createNativeVideoPosterRenderer({
    createThumbnailFromPath: async (input, size) => {
      calls.push({ input, size });
      return { isEmpty: () => false, toPNG: () => png() };
    }
  });

  await render(source, target);
  assert.deepEqual(calls, [{ input: source, size: { width: 512, height: 384 } }]);
  assert.deepEqual(await readFile(target), png());
  assert.deepEqual(await readFile(source), videoBytes);
});

test("native video poster rejects empty, malformed and overwrite outputs", async (context) => {
  const module = await loadRenderer(context);
  const root = await mkdtemp(path.join(os.tmpdir(), "relay-native-poster-invalid-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "video.mp4");
  await writeFile(source, "video");

  await assert.rejects(module.createNativeVideoPosterRenderer({
    createThumbnailFromPath: async () => ({ isEmpty: () => true, toPNG: () => png() })
  })(source, path.join(root, "empty.tmp")), /empty/u);
  await assert.rejects(module.createNativeVideoPosterRenderer({
    createThumbnailFromPath: async () => ({ isEmpty: () => false, toPNG: () => Buffer.from("not-png") })
  })(source, path.join(root, "malformed.tmp")), /bounded PNG/u);

  const existingTarget = path.join(root, "existing.tmp");
  await writeFile(existingTarget, "existing");
  await assert.rejects(module.createNativeVideoPosterRenderer({
    createThumbnailFromPath: async () => ({ isEmpty: () => false, toPNG: () => png() })
  })(source, existingTarget), (error) => error?.code === "EEXIST");
  assert.equal(await readFile(existingTarget, "utf8"), "existing");
});

test("professional director settings stay visible without a disclosure control", async () => {
  const html = await readFile(path.join(appRoot, "src", "renderer", "index.html"), "utf8");
  const styles = await readFile(path.join(appRoot, "src", "renderer", "styles.css"), "utf8");
  assert.match(html, /<section class="surface director-setup"/u);
  assert.doesNotMatch(html, /director-settings-disclosure|>收起<|>展开</u);
  assert.doesNotMatch(styles, /director-settings-disclosure/u);
});
