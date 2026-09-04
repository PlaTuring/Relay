import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { build } from "esbuild";

const projectRoot = path.resolve(import.meta.dirname, "..");
const fixedPrefix = [
  "-v",
  "error",
  "-print_format",
  "json",
  "-show_format",
  "-show_streams"
];

async function loadAdapter(context) {
  const buildRoot = await mkdtemp(path.join(os.tmpdir(), "relay-ffprobe-runner-build-"));
  context.after(() => rm(buildRoot, { recursive: true, force: true }));
  const outfile = path.join(buildRoot, "ab-cli-adapter.mjs");
  await build({
    entryPoints: [path.join(projectRoot, "src", "main", "services", "ab-cli-adapter.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "silent",
    plugins: [{
      name: "relay-ffprobe-child-process-stub",
      setup(buildApi) {
        buildApi.onResolve({ filter: /^node:child_process$/ }, () => ({
          path: "child-process",
          namespace: "relay-ffprobe-stub"
        }));
        buildApi.onLoad({ filter: /.*/, namespace: "relay-ffprobe-stub" }, () => ({
          contents: `
            export const spawn = (...args) => {
              const fake = globalThis.__relayFfprobeSpawn?.(...args);
              if (fake === undefined) throw new Error("unexpected real child process");
              return fake;
            };
          `,
          loader: "js"
        }));
        buildApi.onResolve({ filter: /^electron$/ }, () => ({
          path: "electron",
          namespace: "relay-electron-stub"
        }));
        buildApi.onLoad({ filter: /.*/, namespace: "relay-electron-stub" }, () => ({
          contents: "export const utilityProcess = Object.freeze({});",
          loader: "js"
        }));
      }
    }]
  });
  return import(`${pathToFileURL(outfile).href}?fixture=${Date.now()}-${Math.random()}`);
}

async function createFixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), "relay-ffprobe-runner-fixture-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const executable = path.join(root, "ffprobe.exe");
  const media = path.join(root, "测试 media.mp4");
  await Promise.all([
    writeFile(executable, "fixture executable", "utf8"),
    writeFile(media, "fixture media", "utf8")
  ]);
  return Object.freeze({ root, executable, media });
}

function fakeChild(options = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    options.onKill?.();
    return true;
  };
  queueMicrotask(() => {
    child.emit("spawn");
    if (options.error !== undefined) {
      child.emit("error", options.error);
      return;
    }
    for (const chunk of options.stdout ?? []) child.stdout.emit("data", chunk);
    for (const chunk of options.stderr ?? []) child.stderr.emit("data", chunk);
    if (options.hang !== true) child.emit("close", options.exitCode ?? 0);
  });
  return child;
}

test("fixed ffprobe runner uses only the trusted executable and immutable read-only arguments", async (context) => {
  const fixture = await createFixture(context);
  const calls = [];
  const payload = {
    format: { duration: "1.250" },
    streams: [{ codec_type: "video", codec_name: "h264", width: 1280, height: 720 }]
  };
  globalThis.__relayFfprobeSpawn = (command, arguments_, options) => {
    calls.push({ command, arguments_: [...arguments_], options });
    return fakeChild({ stdout: [Buffer.from(JSON.stringify(payload), "utf8")] });
  };
  context.after(() => { delete globalThis.__relayFfprobeSpawn; });

  const { createFixedFfprobeRunner } = await loadAdapter(context);
  const runner = createFixedFfprobeRunner({ trustedExecutablePath: fixture.executable });
  assert.deepEqual(await runner(fixture.executable, [...fixedPrefix, fixture.media]), payload);
  assert.equal(calls.length, 1);
  assert.equal(path.resolve(calls[0].command), path.resolve(fixture.executable));
  assert.deepEqual(calls[0].arguments_, [...fixedPrefix, path.resolve(fixture.media)]);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.windowsHide, true);
  assert.deepEqual(calls[0].options.stdio, ["ignore", "pipe", "pipe"]);
  assert.equal(calls[0].options.cwd, path.dirname(path.resolve(fixture.executable)));
  assert.equal(calls[0].options.env.ELECTRON_RUN_AS_NODE, undefined);
});

test("fixed ffprobe runner rejects executable substitution, extra switches and relative media paths before spawn", async (context) => {
  const fixture = await createFixture(context);
  let spawnCount = 0;
  globalThis.__relayFfprobeSpawn = () => {
    spawnCount += 1;
    return fakeChild();
  };
  context.after(() => { delete globalThis.__relayFfprobeSpawn; });

  const { createFixedFfprobeRunner } = await loadAdapter(context);
  const runner = createFixedFfprobeRunner({ trustedExecutablePath: fixture.executable });
  await assert.rejects(
    runner(path.join(fixture.root, "other.exe"), [...fixedPrefix, fixture.media]),
    (error) => error?.code === "INVALID_REQUEST"
  );
  await assert.rejects(
    runner(fixture.executable, [...fixedPrefix, "-i", fixture.media]),
    (error) => error?.code === "INVALID_REQUEST"
  );
  await assert.rejects(
    runner(fixture.executable, [...fixedPrefix, "relative.mp4"]),
    (error) => error?.code === "INVALID_REQUEST"
  );
  assert.throws(
    () => createFixedFfprobeRunner({ trustedExecutablePath: "relative\\ffprobe.exe" }),
    (error) => error?.code === "INVALID_REQUEST"
  );
  assert.equal(spawnCount, 0);
});

test("fixed ffprobe runner enforces timeout and stdout/stderr byte bounds", async (context) => {
  const fixture = await createFixture(context);
  const killed = [];
  let behavior = "hang";
  globalThis.__relayFfprobeSpawn = () => fakeChild(
    behavior === "hang"
      ? { hang: true, onKill: () => killed.push("timeout") }
      : {
          stdout: [Buffer.alloc(1_048_577, 0x20)],
          onKill: () => killed.push("output")
        }
  );
  context.after(() => { delete globalThis.__relayFfprobeSpawn; });

  const { createFixedFfprobeRunner } = await loadAdapter(context);
  const runner = createFixedFfprobeRunner({
    trustedExecutablePath: fixture.executable,
    timeoutMilliseconds: 20
  });
  await assert.rejects(
    runner(fixture.executable, [...fixedPrefix, fixture.media]),
    /未能在 20 毫秒内完成/u
  );
  behavior = "output";
  await assert.rejects(
    runner(fixture.executable, [...fixedPrefix, fixture.media]),
    /输出超过安全上限/u
  );
  assert.deepEqual(killed, ["timeout", "output"]);
});

test("fixed ffprobe runner preserves launch errors and rejects nonzero or malformed results", async (context) => {
  const fixture = await createFixture(context);
  const missing = new Error("missing fixture executable");
  missing.code = "ENOENT";
  const behaviors = [
    { error: missing },
    { exitCode: 9 },
    { stdout: [Buffer.from("not-json", "utf8")] }
  ];
  globalThis.__relayFfprobeSpawn = () => fakeChild(behaviors.shift());
  context.after(() => { delete globalThis.__relayFfprobeSpawn; });

  const { createFixedFfprobeRunner } = await loadAdapter(context);
  const runner = createFixedFfprobeRunner({ trustedExecutablePath: fixture.executable });
  await assert.rejects(
    runner(fixture.executable, [...fixedPrefix, fixture.media]),
    (error) => error?.code === "ENOENT"
  );
  await assert.rejects(
    runner(fixture.executable, [...fixedPrefix, fixture.media]),
    /退出码 9/u
  );
  await assert.rejects(
    runner(fixture.executable, [...fixedPrefix, fixture.media]),
    /无效 JSON/u
  );
});
