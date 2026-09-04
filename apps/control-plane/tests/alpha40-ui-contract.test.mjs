import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const read = (relative) => readFile(resolve(root, relative), "utf8");

test("navigation has the locked seven-page order, single-line labels, and an honest planned upscale view", async () => {
  const [html, renderer, styles] = await Promise.all([
    read("src/renderer/index.html"),
    read("src/renderer/index.ts"),
    read("src/renderer/styles.css")
  ]);
  const sidebar = html.slice(html.indexOf('<aside class="tool-sidebar"'), html.indexOf('<div id="global-status"'));
  const targets = [...sidebar.matchAll(/data-view-target="([^"]+)"/gu)].map((match) => match[1]);
  assert.deepEqual(targets, ["home", "project", "director", "assets", "generated", "upscale", "about"]);
  for (const label of ["项目", "快速创建", "专业导播", "素材库", "视频成品", "画质超分", "关于"]) {
    assert.ok(sidebar.includes(label), `missing navigation label: ${label}`);
  }
  const upscale = html.slice(html.indexOf('id="view-upscale"'), html.indexOf('id="view-about"'));
  assert.match(upscale, /<h1 id="upscale-title">画质超分<\/h1>/u);
  assert.match(upscale, /<h2 id="upscale-planned-title">功能规划中<\/h2>/u);
  assert.ok(upscale.includes("当前版本不提供超分处理，也不会在此页面执行任何任务。"));
  assert.equal((upscale.match(/<h1\b/gu) ?? []).length, 1);
  assert.doesNotMatch(upscale, /<(?:a|button|form|input|select|textarea)\b/iu);
  assert.doesNotMatch(upscale, /data-(?:action|command|execute)=|tabindex=|role="button"/iu);
  assert.match(styles, /\.header-tab\s*\{[^}]*min-width:\s*0[^}]*max-width:\s*100%/u);
  const baseToolLabel = styles.match(/\.tool-label\s*\{[^}]*\}/u)?.[0] ?? "";
  assert.match(baseToolLabel, /white-space:\s*nowrap/u);
  assert.match(baseToolLabel, /word-break:\s*keep-all/u);
  const phone = styles.slice(styles.lastIndexOf("@media (max-width: 520px)"));
  assert.match(phone, /\.tool-label\s*\{\s*display:\s*none/u);
  assert.doesNotMatch(styles, /\.tool-label\s*\{[^}]*white-space:\s*normal/u);
  assert.doesNotMatch(`${html}\n${renderer}`, /view-import|data-view-target="import"|value === "import"/u);
});

test("generated videos are current-project-only and every native action uses bounded identifiers", async () => {
  const [html, renderer, generated] = await Promise.all([
    read("src/renderer/index.html"),
    read("src/renderer/index.ts"),
    read("src/renderer/generated-video-ui.ts")
  ]);
  const view = html.slice(html.indexOf('id="view-generated"'), html.indexOf('id="view-upscale"'));
  assert.match(view, /id="generated-supplement"[\s\S]*?补录已有视频/u);
  assert.match(view, /id="generated-video-list"[^>]+role="list"/u);
  assert.ok(view.includes("当前项目"));
  assert.ok(view.includes("早期版本的通用前缀、自定义输出目录或改名文件"));
  assert.match(renderer, /const needsProject = [^;]+view === "generated"/u);
  assert.match(renderer, /requestedView === "generated"\) \{[\s\S]{0,100}?generatedVideoUi\.activate\(\)/u);
  assert.match(renderer, /requestedView !== "generated"\) generatedVideoUi\.deactivate\(\)/u);
  assert.match(generated, /GENERATED_VIDEO_POLL_DELAYS_MS = Object\.freeze\(\[1_500, 3_000, 6_000, 12_000, 30_000\]\)/u);
  assert.match(generated, /const viewIsPollable[\s\S]{0,260}?document\.visibilityState !== "hidden"/u);
  assert.match(generated, /setTimeout\(\(\) => \{[\s\S]*?refresh\(true\)[\s\S]*?\}, delay\)/u);
  assert.match(generated, /quiet && nextSignature === signature\) \{[\s\S]{0,100}?unchangedPollCount \+= 1/u);
  assert.match(generated, /document\.addEventListener\("visibilitychange"[\s\S]{0,360}?stopPolling\(\)[\s\S]{0,220}?refresh\(true\)/u);
  for (const method of [
    "listGeneratedVideos",
    "supplementGeneratedVideo",
    "getGeneratedVideoPreview",
    "playGeneratedVideo",
    "showGeneratedVideoInFolder",
    "addGeneratedVideoToProjectAssets"
  ]) assert.ok(generated.includes(method), `missing generated-video action: ${method}`);
  assert.match(generated, /listGeneratedVideos\(\{ projectId: projectContext\.projectId \}\)/u);
  assert.match(generated, /getGeneratedVideoPreview\(\{ projectId: projectContext\.projectId, resultId: video\.resultId \}\)/u);
  assert.match(generated, /playGeneratedVideo\(\{ projectId: projectContext\.projectId, resultId: video\.resultId \}\)/u);
  assert.match(generated, /showGeneratedVideoInFolder\(\{ projectId: projectContext\.projectId, resultId: video\.resultId \}\)/u);
  assert.match(generated, /addGeneratedVideoToProjectAssets\(\{[\s\S]*?projectId: mutation\.projectId,[\s\S]*?resultId: video\.resultId/u);
  assert.match(generated, /addGeneratedVideoToProjectAssets[\s\S]{0,360}synchronizeProjectMutation\(mutation\)/u);
  assert.doesNotMatch(generated, /(?:playGeneratedVideo|showGeneratedVideoInFolder|addGeneratedVideoToProjectAssets)\(\{[^}]*\b(?:path|url|command)\b/iu);
  assert.ok(generated.includes("无法生成封面"));
  assert.ok(generated.includes("技术信息未检查"));
  assert.ok(generated.includes("ComfyUI 原始视频保持不变"));
});

test("About presents the formal Relay update flow, Setup package, and failed-launch recovery", async () => {
  const [html, renderer, updateUi, styles] = await Promise.all([
    read("src/renderer/index.html"),
    read("src/renderer/index.ts"),
    read("src/renderer/update-ui.ts"),
    read("src/renderer/styles.css")
  ]);
  const about = html.slice(html.indexOf('id="view-about"'), html.indexOf("</main>"));
  for (const copy of [
    "本地工作流",
    "从项目准备到可编辑工作流",
    "查看版本、项目信息与 Relay 的本地工作方式。",
    "软件更新",
    "Relay 更新",
    "当前版本",
    "最新版本",
    "发布日期",
    "GitHub Releases",
    "下载并安装",
    "https://github.com/PlaTuring/Relay"
  ]) assert.ok(about.includes(copy), `missing About disclosure: ${copy}`);
  for (const id of [
    "about-current-version",
    "about-latest-version",
    "about-release-date",
    "about-download-progress",
    "about-cancel-download"
  ]) assert.ok(about.includes(`id="${id}"`), `missing update UI: ${id}`);
  for (const method of [
    "downloadUpdate",
    "getUpdateDownloadStatus",
    "cancelUpdateDownload",
    "openDownloadedUpdateFolder"
  ]) assert.ok(updateUi.includes(method), `missing update action: ${method}`);
  assert.match(updateUi, /setTimeout\(\(\) => void pollUpdateDownloadStatus\(\), 500\)/u);
  assert.match(updateUi, /downloadUpdate\(\{ kind: "setup" \}\)/u);
  assert.match(about, /id="about-open-download-folder"[^>]*hidden/u);
  assert.match(updateUi, /errorCode === "installer_launch_failed"[\s\S]{0,100}?status\.canOpenFolder/u);
  assert.match(updateUi, /aboutOpenDownloadFolder\.addEventListener[\s\S]*?openDownloadedUpdateFolder\(\)/u);
  assert.doesNotMatch(about, /(?:Alpha|Pre-release|测试预览|预发布|未签名|SmartScreen|Authenticode)/iu);
  assert.doesNotMatch(about, /name="update-kind"|value="portable"/u);
  assert.doesNotMatch(about, /发行说明|发布资产|下载验证|由你决定何时安装/u);
  assert.doesNotMatch(about, /about-release-details|about-release-notes|about-update-assets|about-update-safety|about-open-release/u);
  assert.doesNotMatch(updateUi, /selectedUpdateDownloadKind|choosePreferredUpdateKind/u);
  assert.doesNotMatch(updateUi, /openUpdateReleasesPage|aboutReleaseUrl|releaseUrl|aboutOpenRelease/u);
  assert.match(updateUi, /aboutCheckUpdateButton\.hidden = updateAvailable/u);
  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*?\.generated-video-list\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/u);
  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*?\.about-update__actions\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/u);
});
