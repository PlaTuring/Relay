import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const applicationRoot = path.resolve(import.meta.dirname, "..");
const read = (relativePath) => readFile(path.join(applicationRoot, relativePath), "utf8");

function openingTag(source, id) {
  const match = source.match(new RegExp(`<[^>]+id=["']${id}["'][^>]*>`, "u"));
  assert.notEqual(match, null, `missing #${id}`);
  return match[0];
}

test("first-run installation leads with an explicit managed destination instead of empty attach fields", async () => {
  const html = await read("src/renderer/index.html");
  const managedRoot = html.indexOf('id="managed-root-section"');
  const reuse = html.indexOf('id="existing-environment-reuse"');

  assert.ok(managedRoot >= 0, "missing the managed installation destination");
  assert.ok(reuse >= 0, "existing environments need a secondary disclosure entry");
  assert.ok(
    managedRoot < reuse,
    "the default managed destination must appear before optional existing-environment reuse"
  );
  assert.match(
    html,
    /id="managed-root-title"[^>]*>\s*将安装到\s*<\/h3>/u,
    "the primary installation card must state what Relay will do"
  );
  assert.match(
    html,
    /id="install-root"[^>]*value="D:\\MiniMaxH3"/u,
    "the visible first-run destination remains D:\\MiniMaxH3"
  );
  assert.match(
    html,
    /<details[^>]+id="existing-environment-reuse"[^>]*>[\s\S]*?<summary[^>]*>[\s\S]*?已有 ComfyUI 或 H3[\s\S]*?复用现有环境[\s\S]*?<\/summary>/u,
    "attach-only reuse must be a clearly optional secondary disclosure"
  );
  assert.doesNotMatch(
    openingTag(html, "existing-environment-reuse"),
    /\sopen(?:\s|=|>)/u,
    "a missing environment must not open two blank path inputs by default"
  );
});

test("attach-only ComfyUI and H3 selectors remain functional but are not marked required", async () => {
  const [html, renderer] = await Promise.all([
    read("src/renderer/index.html"),
    read("src/renderer/index.ts")
  ]);
  const reuseStart = html.indexOf('id="existing-environment-reuse"');
  const reuseEnd = html.indexOf("</details>", reuseStart);
  assert.ok(reuseStart >= 0 && reuseEnd > reuseStart, "missing bounded reuse disclosure");
  const reuseMarkup = html.slice(reuseStart, reuseEnd);

  for (const id of ["existing-comfy-root", "existing-model-root"]) {
    assert.ok(reuseMarkup.includes(`id="${id}"`), `${id} must live inside optional reuse`);
    const tag = openingTag(html, id);
    assert.doesNotMatch(tag, /\srequired(?:\s|=|>)/u);
    assert.doesNotMatch(tag, /aria-required=["']true["']/u);
  }
  assert.match(renderer, /\["browse-existing-comfy-root",\s*comfyUiRoot,\s*"comfyui_root"\]/u);
  assert.match(renderer, /\["browse-existing-model-root",\s*modelRoot,\s*"model_root"\]/u);
  assert.match(renderer, /if \(kind === "comfyui_root"\) markLocationPending/u);
  assert.match(renderer, /if \(kind === "model_root"\) markLocationPending/u);
});

test("missing attach paths stay null while the managed D destination remains the actionable default", async () => {
  const [renderer, service] = await Promise.all([
    read("src/renderer/index.ts"),
    read("src/main/services/index.ts")
  ]);

  assert.match(service, /recommendedInstallRoot:\s*"D:\\\\MiniMaxH3"/u);
  assert.match(
    renderer,
    /installRoot\.value\s*=\s*bootstrap\.savedSetup\?\.installRoot\s*\?\?\s*bootstrap\.recommendedInstallRoot/u
  );
  assert.match(renderer, /comfyUiRoot:\s*comfyUiRoot\.value\.trim\(\)\.length === 0 \? null/u);
  assert.match(renderer, /modelRoot:\s*modelRoot\.value\.trim\(\)\.length === 0 \? null/u);
  assert.match(
    renderer,
    /function syncInstallationLocationPresentation[\s\S]*?将安装到[\s\S]*?existingEnvironmentReuse/u,
    "a single presentation transaction must keep managed install primary and reuse secondary"
  );
  assert.doesNotMatch(
    renderer,
    /你可以手动选择 ComfyUI、H3 模型和受管根后重新检测/u,
    "scan failure must not imply that optional existing-environment paths are required"
  );
});

test("existing environment reuse is summarized without displacing the managed-install path policy", async () => {
  const renderer = await read("src/renderer/index.ts");
  const presentation = renderer.match(
    /function syncInstallationLocationPresentation[\s\S]*?(?=\nfunction [A-Za-z])/u
  )?.[0] ?? "";

  assert.match(presentation, /locations\.comfyUiRoot/u);
  assert.match(presentation, /locations\.modelRoot/u);
  assert.match(presentation, /existingEnvironmentReuseSummary\.textContent/u);
  assert.match(presentation, /existingEnvironmentReuse\.open\s*=\s*false/u);
  assert.match(
    presentation,
    /未发现可复用环境/u,
    "the collapsed secondary entry must explain why its path fields are empty"
  );
  assert.match(
    presentation,
    /发现可复用环境/u,
    "detected attach-only evidence remains visible in the secondary entry summary"
  );
});

test("the installation IA preserves the safety and generation boundary", async () => {
  const [html, renderer] = await Promise.all([
    read("src/renderer/index.html"),
    read("src/renderer/index.ts")
  ]);
  const combined = `${html}\n${renderer}`;

  assert.match(combined, /不会静默回退到 C 盘/u);
  assert.match(combined, /只读复用/u);
  assert.doesNotMatch(renderer, /controlPlane\.(?:prompt|queuePrompt|generateVideo|generateAudio)/u);
  assert.doesNotMatch(
    html,
    /<button[^>]*>[^<]*(?:生成视频|生成音频|运行 H3)[^<]*<\/button>/u
  );
});
