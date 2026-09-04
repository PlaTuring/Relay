import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const projectRoot = path.resolve(import.meta.dirname, "..");

async function loadFrameStaging(context) {
  const buildRoot = await mkdtemp(path.join(os.tmpdir(), "relay-frame-staging-module-"));
  context.after(() => rm(buildRoot, { recursive: true, force: true }));
  const outfile = path.join(buildRoot, "frame-staging.mjs");
  await build({
    entryPoints: [path.join(projectRoot, "src", "main", "services", "frame-staging.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "silent"
  });
  return import(`${new URL(`file:///${outfile.replaceAll("\\", "/")}`).href}?test=${Date.now()}`);
}

test("an invalid BMP does not poison a later valid PNG staging attempt", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "relay-frame-retry-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const inputDirectory = path.join(root, "input");
  await mkdir(inputDirectory);
  const bmp = path.join(root, "尾帧 旧.bmp");
  const disguised = path.join(root, "伪装图片.png");
  const png = path.join(root, "尾帧 新.png");
  await writeFile(bmp, Buffer.from("BM-not-supported", "ascii"));
  await writeFile(disguised, Buffer.from("plain text wearing a png extension", "utf8"));
  const pngBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );
  await writeFile(png, pngBytes);
  const api = await loadFrameStaging(context);

  await assert.rejects(
    api.stageProjectFrames({
      mode: "FL2VA",
      comfyInputDirectory: inputDirectory,
      firstFrame: null,
      lastFrame: bmp
    }),
    (error) => error?.code === "INVALID_REQUEST" && /类型无效/u.test(error.message)
  );
  await assert.rejects(
    api.stageProjectFrames({
      mode: "FL2VA",
      comfyInputDirectory: inputDirectory,
      firstFrame: null,
      lastFrame: disguised
    }),
    (error) => error?.code === "INVALID_REQUEST" && /内容与扩展名不匹配/u.test(error.message)
  );

  const staged = await api.stageProjectFrames({
    mode: "FL2VA",
    comfyInputDirectory: inputDirectory,
    firstFrame: null,
    lastFrame: png
  });
  assert.equal(staged.first, null);
  assert.match(staged.last, /^minimax-h3-[a-f0-9]{24}\.png$/u);
  assert.deepEqual(await readFile(path.join(inputDirectory, staged.last)), pngBytes);
});
