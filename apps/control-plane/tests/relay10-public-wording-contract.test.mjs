import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

async function read(relativePath) {
  return readFile(resolve(repositoryRoot, relativePath), "utf8");
}

test("Relay public copy describes product functions and names the developer without a creator claim", async () => {
  const [readme, lightHeader, darkHeader, releaseNotes, html, renderer] = await Promise.all([
    read("README.md"),
    read("header-light.svg"),
    read("header-dark.svg"),
    read("docs/releases/relay-1.0-release-notes.md"),
    read("apps/control-plane/src/renderer/index.html"),
    read("apps/control-plane/src/renderer/index.ts")
  ]);
  const publicCopy = [readme, lightHeader, darkHeader, releaseNotes, html, renderer].join("\n");
  const profile = html.match(/<section class="about-product__profile"[\s\S]*?<\/section>/u)?.[0] ?? "";

  assert.match(readme, /本地安装配置器、项目与素材管理器[\s\S]*MiniMax H3 的确定性 ComfyUI 工作流编译器/u);
  assert.match(releaseNotes, /安装、检测、配置、项目与素材管理、确定性工作流编译和 ComfyUI 可编辑交接/u);
  assert.doesNotMatch(publicCopy, /(?:Relay 是|由).{0,32}(?:柏拉图灵|PlaTuring).{0,20}(?:开发|制作)/u);
  assert.match(profile, /<p class="eyebrow">独立开发者<\/p>[\s\S]*?id="about-author-state">柏拉图灵 \| PlaTuring<\/span>/u);
  assert.match(profile, /id="about-author-tagline">抖音 \/ B站：柏拉图灵<\/p>/u);
  assert.deepEqual([...profile.matchAll(/<dt>([^<]+)<\/dt>/gu)].map((match) => match[1]), ["项目仓库"]);
  assert.doesNotMatch(profile, /<dt>GitHub<\/dt>|id="about-developer-name"/iu);
  assert.doesNotMatch(publicCopy, /开发者信息|作者信息|作者与声明|PlaTuring GitHub 头像/u);
  assert.doesNotMatch(publicCopy, /安全与产品边界|安装与安全|Authenticode|SmartScreen|未知发布者|未签名|\/prompt|点击 Run|亲自点击 Run|You choose when to click Run\./u);

  // The fixed repository identifier is functional update/download metadata, not creator copy.
  assert.match(publicCopy, /PlaTuring\/Relay/u);
});
