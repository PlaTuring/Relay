import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";
import { resolveSelectedArtifacts } from "../../../packages/local-runtime/src/catalog.mjs";
import { compileProject } from "../../../packages/workflow/h3-compiler/src/index.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");

async function loadPolicy(context) {
  const buildRoot = await mkdtemp(path.join(os.tmpdir(), "relay-install-capability-truth-"));
  context.after(() => rm(buildRoot, { recursive: true, force: true }));
  const outfile = path.join(buildRoot, "installation-component-policy.mjs");
  await build({
    entryPoints: [path.join(projectRoot, "src", "main", "services", "installation-component-policy.ts")],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "silent"
  });
  return import(`${new URL(`file:///${outfile.replaceAll("\\", "/")}`).href}?fixture=${Date.now()}`);
}

function officialTimedPrompt(duration) {
  const shots = Array.from({ length: duration / 5 }, (_, index) => index === 0
    ? "[Shot 1] Live-action, cinematic. The first local segment begins."
    : `[Shot ${index + 1}] At 00:${String(index * 5).padStart(2, "0")}.000, the next local segment begins.`
  ).join("\n");
  return `integrated_multimodal_description: ${shots}\n\noverall_soundscape: Stable room tone continues.\n\nnon_diegetic_music: N/A`;
}

function officialReferencePrompt() {
  return `subject_definitions:\n<Subject 1> is the subject in <Picture 1>.\n\nsummary:\n[reference generation] Preserve <Subject 1>.\n\nretention_analysis:\n<Subject 1>: fully_preserved - identity remains consistent.\n\ndetailed_description:\nLive-action cinematic style.\n[Shot 1] The subject remains in frame.\n\noverall_soundscape:\nStable room tone.\n\nnon_diegetic_music:\nN/A`;
}

test("new install plans never consume the legacy Ref2VA Turbo artifact", async (context) => {
  const policy = await loadPolicy(context);
  const selections = [
    "turbo_acceleration_recommended",
    "ref2va_optional",
    "ffmpeg_long_video_optional"
  ];

  for (const hasAttachedComfyUi of [false, true]) {
    const components = policy.resolveA3InstallationComponents({
      hasAttachedComfyUi,
      selectedOptionalComponents: selections
    });
    assert.equal(components.includes("fl2v-turbo"), true, "T2V/FL2VA Turbo remains available");
    assert.equal(components.includes("ref2va-addon"), true, "Ref2VA quality weights remain available");
    assert.equal(components.includes("ref2v-turbo"), false, "unsupported Ref2VA Turbo is not planned");
    assert.equal(components.includes("ffmpeg-managed"), true);

    const artifacts = resolveSelectedArtifacts(components);
    assert.equal(
      artifacts.some(({ component }) => component === "ref2v-turbo"),
      false,
      "unsupported legacy artifact cannot reach the download plan"
    );
  }
});

test("the legacy component ID remains parse-compatible but no new adapter path schedules it", async () => {
  const [policySource, adapterSource] = await Promise.all([
    readFile(path.join(projectRoot, "src", "main", "services", "installation-component-policy.ts"), "utf8"),
    readFile(path.join(projectRoot, "src", "main", "services", "ab-cli-adapter.ts"), "utf8")
  ]);

  assert.match(policySource, /\| "ref2v-turbo";/u, "old manifests retain a recognized component ID");
  assert.match(adapterSource, /const A3_COMPONENTS[\s\S]*?"ref2v-turbo"/u);
  assert.doesNotMatch(policySource, /components\.push\("ref2v-turbo"\)/u);
  assert.doesNotMatch(adapterSource, /values\.push\("ref2v-turbo"\)/u);
});

test("installation cards state the certified Ref2VA and FFmpeg capabilities exactly", async () => {
  const source = await readFile(
    path.join(projectRoot, "src", "main", "services", "ab-cli-adapter.ts"),
    "utf8"
  );
  const refStart = source.indexOf('id: "ref2va_optional"');
  const pyavStart = source.indexOf('id: "pyav_required"', refStart);
  const ffmpegStart = source.indexOf('id: "ffmpeg_long_video_optional"', pyavStart);
  const desktopStart = source.indexOf('id: "comfyui_desktop_optional"', ffmpegStart);
  assert.ok(refStart >= 0 && pyavStart > refStart && ffmpegStart > pyavStart && desktopStart > ffmpegStart);

  const refCard = source.slice(refStart, pyavStart);
  assert.match(refCard, /当前认证工作流仅接入 1–2 张参考图片/u);
  assert.match(refCard, /不接入参考视频或声音/u);
  assert.doesNotMatch(refCard, /用于参考图片、视频或声音生成/u);

  const ffmpegCard = source.slice(ffmpegStart, desktopStart);
  assert.match(ffmpegCard, /FFmpeg（素材检查与封面选配）/u);
  assert.match(ffmpegCard, /本地视频\/音频的时长与编解码检查/u);
  assert.match(ffmpegCard, /可用时提取视频封面/u);
  assert.match(ffmpegCard, /不参与 H3 采样或分段拼接/u);
  assert.doesNotMatch(ffmpegCard, /用于 30\/60 秒分段拼接/u);
});

test("compiler truth matches installation claims: Ref2VA rejects Turbo and long assembly is Comfy Core", async () => {
  await assert.rejects(
    () => compileProject({
      schema_version: "1.0.0",
      prompt: officialReferencePrompt(),
      mode: "ref2va",
      duration: 5,
      canvas: "16:9",
      resolution_megapixels: 0.98,
      endpoints: { reference_images: ["input/reference.png"] },
      advanced: { seed: 1, seed_policy: "fixed", sampling_profile: "turbo_8" }
    }),
    (error) => error?.code === "PROJECT.SAMPLING_PROFILE_MODE"
  );

  const compiled = await compileProject({
    schema_version: "1.0.0",
    prompt: officialTimedPrompt(30),
    mode: "t2v",
    duration: 30,
    segment_duration: 5,
    canvas: "16:9",
    resolution_megapixels: 0.98
  });
  const workflow = compiled.workflows[0].workflow;
  const types = workflow.nodes.map(({ type }) => type);
  for (const coreType of [
    "GetVideoComponents",
    "BatchImagesNode",
    "AudioConcat",
    "CreateVideo",
    "Video Slice",
    "SaveVideo"
  ]) assert.equal(types.includes(coreType), true, `missing certified Comfy Core node ${coreType}`);
  assert.equal(types.some((type) => /ffmpeg/iu.test(type)), false);
  assert.equal(JSON.stringify(workflow).includes("ffmpeg"), false);
});
