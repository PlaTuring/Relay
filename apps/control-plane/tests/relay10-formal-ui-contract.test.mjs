import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const read = (relative) => readFile(resolve(root, relative), "utf8");

test("Relay displays the exact stable patch version from the shared runtime version", async (context) => {
  const temporary = await mkdtemp(resolve(tmpdir(), "relay10-version-presentation-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const output = resolve(temporary, "version-presentation.mjs");
  await build({
    entryPoints: [resolve(root, "src/renderer/version-presentation.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
    logLevel: "silent"
  });
  const presentation = await import(`${pathToFileURL(output).href}?relay10`);
  assert.equal(presentation.formalVersionLabel("1.0.0"), "版本 1.0.0");
  assert.equal(presentation.formalVersionLabel("1.0"), "版本 1.0");
  assert.equal(presentation.formalVersionLabel("1.0.7"), "版本 1.0.7");
  assert.equal(
    presentation.formalVersionLabel("0.1.0-alpha.40"),
    "版本 0.1.0-alpha.40",
    "a non-stable package must not be silently presented as Relay 1.0"
  );

  const [renderer, updateRenderer] = await Promise.all([
    read("src/renderer/index.ts"),
    read("src/renderer/update-ui.ts")
  ]);
  assert.match(renderer, /const visualVersion = formalVersionLabel\(bootstrap\.appVersion\)/u);
  assert.match(renderer, /element\("header-version"\)\.textContent = visualVersion/u);
  assert.match(renderer, /aboutAppVersion\.textContent = visualVersion/u);
  assert.match(renderer, /updateUi\.setCurrentVersion\(bootstrap\.appVersion\)/u);
  assert.match(updateRenderer, /aboutCurrentVersion\.textContent = formalVersionNumber\(version\)/u);
  assert.match(updateRenderer, /aboutCurrentVersion\.textContent = formalVersionNumber\(presentation\.currentVersion\)/u);
  assert.match(updateRenderer, /formalVersionNumber\(release\.latestVersion\)/u);
});

test("Relay 1.0 About keeps a compact version summary without release notes or asset inventory", async () => {
  const [html, updateRenderer] = await Promise.all([
    read("src/renderer/index.html"),
    read("src/renderer/update-ui.ts")
  ]);
  const about = html.slice(html.indexOf('id="view-about"'), html.indexOf("</main>"));
  for (const label of ["当前版本", "最新版本", "发布日期"]) {
    assert.ok(about.includes(label), `missing stable update label: ${label}`);
  }
  for (const copy of ["软件更新", "Relay 更新", "GitHub Releases", "最新稳定版本信息"]) {
    assert.ok(about.includes(copy), `missing formal update copy: ${copy}`);
  }
  assert.doesNotMatch(about, /(?:Alpha|Pre-release|测试预览|预发布|未签名|SmartScreen|Authenticode)/iu);
  assert.doesNotMatch(about, /发行说明|发布资产|下载验证|由你决定何时安装/u);
  assert.doesNotMatch(about, /about-release-details|about-release-notes|about-update-assets|about-update-safety/u);
  assert.doesNotMatch(updateRenderer, /(?:Alpha|Pre-release|测试预览|预发布|未签名|SmartScreen|Authenticode)/iu);
});

test("Relay 1.0 update UI exposes one explicit validated Setup download-and-install path", async () => {
  const [html, renderer, updateRenderer, main, service] = await Promise.all([
    read("src/renderer/index.html"),
    read("src/renderer/index.ts"),
    read("src/renderer/update-ui.ts"),
    read("src/main/main.ts"),
    read("src/main/services/github-update-download.ts")
  ]);
  const about = html.slice(html.indexOf('id="view-about"'), html.indexOf("</main>"));
  assert.match(about, /id="about-download-update"[\s\S]*?下载并安装/u);
  assert.doesNotMatch(about, /about-download-kind|name="update-kind"|value="portable"/u);
  assert.match(updateRenderer, /downloadUpdate\(\{ kind: "setup" \}\)/u);
  assert.doesNotMatch(updateRenderer, /selectedUpdateDownloadKind|choosePreferredUpdateKind/u);
  assert.match(updateRenderer, /安装程序已启动，Relay 正在退出/u);
  assert.match(service, /verifyPublishedInstaller\(binaryDestination, binary\)[\s\S]*?launchInstaller\(binaryDestination\)/u);
  assert.match(service, /compareStrictSemver\(release\.version, currentVersion\) <= 0/u);
  assert.match(main, /launchValidatedUpdateInstaller:[\s\S]*?shell\.openPath\(installerPath\)[\s\S]*?setImmediate\(requestApplicationQuit\)/u);
  const downloadClick = updateRenderer.slice(
    updateRenderer.indexOf('aboutDownloadUpdate.addEventListener("click"'),
    updateRenderer.indexOf('aboutCancelDownload.addEventListener("click"')
  );
  assert.match(downloadClick, /downloadUpdate\(\{ kind: "setup" \}\)/u);
  assert.doesNotMatch(downloadClick, /(?:path|url|command|args)\s*:/iu);
  assert.doesNotMatch(`${renderer}\n${updateRenderer}`, /(?:execFile|spawn|shell\.openPath)\([^)]*(?:Setup|assetName|download)/iu);
});
