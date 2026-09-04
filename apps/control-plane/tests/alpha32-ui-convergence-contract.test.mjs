import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const read = (relative) => readFile(resolve(root, relative), "utf8");

test("Alpha 32 applies one bounded control and spacing system across the shell", async () => {
  const styles = await read("src/renderer/styles.css");
  for (const contract of [
    "--control-height-compact: 32px",
    "--control-height: 40px",
    "--control-height-primary: 42px",
    "--control-radius: 6px",
    "--page-content-max: 1440px"
  ]) assert.ok(styles.includes(contract), `missing design token ${contract}`);
  assert.match(styles, /\.button\s*\{[\s\S]*?min-height:\s*var\(--control-height\)/u);
  assert.match(styles, /\.adapter-pill\s*\{[\s\S]*?height:\s*var\(--control-height-compact\)/u);
  assert.match(styles, /\.header-settings\s*\{[\s\S]*?height:\s*var\(--control-height-compact\)/u);
  assert.doesNotMatch(styles, /font-size:\s*(?:8|9|10)px/u);
});

test("Alpha 32 asset library has one ordinary import path, real preview, and recoverable deletion", async () => {
  const [html, renderer, preload, contract] = await Promise.all([
    read("src/renderer/index.html"),
    read("src/renderer/index.ts"),
    read("src/preload/index.ts"),
    read("src/shared/ipc-contract.ts")
  ]);
  assert.match(html, /id="asset-import-button"[\s\S]*?>[\s\S]*?导入本地素材/u);
  assert.match(html, /id="asset-drop-zone"(?![^>]*(?:tabindex|role=))/u);
  assert.doesNotMatch(html, /id="asset-import-policy"/u);
  assert.match(html, /id="asset-detail-thumbnail"[\s\S]*?id="asset-binding-list"[\s\S]*?<summary>高级 \/ 诊断信息<\/summary>/u);
  assert.match(renderer, /async function performDroppedAssetImport[\s\S]*?importDroppedProjectAssets[\s\S]*?assetDropZone\.addEventListener\("drop"[\s\S]*?performDroppedAssetImport/u);
  assert.doesNotMatch(renderer, /assetDropZone\.addEventListener\("(?:click|keydown)"/u);
  assert.ok(renderer.includes("getProjectAssetPreview"));
  assert.ok(renderer.includes("listDeletedProjectAssets"));
  assert.ok(renderer.includes("restoreProjectAsset"));
  assert.ok(renderer.includes("copyProjectAssetIntoProject"));
  assert.doesNotMatch(html, /id="asset-replacement-dialog"/u);
  assert.doesNotMatch(renderer, /assetReplacementDialog|pendingAssetReplacement/u);
  assert.match(renderer, /所选文件与原素材内容不同[s\S]*?作为新素材加入项目/u);
  assert.ok(preload.includes("webUtils.getPathForFile"));
  for (const method of [
    "importDroppedProjectAssets",
    "getProjectAssetPreview",
    "listDeletedProjectAssets",
    "restoreProjectAsset"
  ]) assert.ok(contract.includes(method), `missing asset API ${method}`);
});

test("Alpha 32 permits only IPC-provided data images and keeps the hidden availability filter out of layout", async () => {
  const [html, css] = await Promise.all([
    read("src/renderer/index.html"),
    read("src/renderer/styles.css")
  ]);

  assert.match(html, /img-src 'self' data:;/u);
  assert.doesNotMatch(html, /(?:script-src|style-src|connect-src)[^;]*data:/u);
  assert.match(html, /id="asset-availability-filter" class="sr-only"[^>]*aria-hidden="true"/u);
  assert.match(css, /\.asset-library-toolbar select:not\(\.sr-only\)\s*\{[^}]*width:\s*100%/su);
  assert.doesNotMatch(css, /\.asset-library-toolbar select\s*\{[^}]*width:\s*100%/su);
});

test("Alpha 32 deletion is themed, recoverable, and no native confirmation remains", async () => {
  const [html, renderer, contract] = await Promise.all([
    read("src/renderer/index.html"),
    read("src/renderer/index.ts"),
    read("src/shared/ipc-contract.ts")
  ]);
  assert.match(html, /id="project-center-archive"[\s\S]*?>删除项目<\/button>/u);
  assert.match(html, /id="project-center-trash"[\s\S]*?>回收站<\/button>/u);
  assert.match(html, /id="asset-remove-record"[\s\S]*?>删除素材<\/button>/u);
  assert.match(html, /id="action-confirm-dialog"[\s\S]*?id="action-confirm-cancel"[\s\S]*?id="action-confirm-submit"/u);
  assert.doesNotMatch(`${html}\n${renderer}`, /window\.confirm|\bconfirm\s*\(/u);
  assert.ok(renderer.includes("confirmAction"));
  assert.ok(renderer.includes("restoreRelayProject"));
  assert.ok(contract.includes("restoreRelayProject"));
  assert.doesNotMatch(html, />[^<]*(?:归档|已归档)[^<]*</u);
});

test("About uses local Relay project identity and honest anonymous update states", async () => {
  const [html, renderer, updateRenderer, preload, contract, update, updateSource] = await Promise.all([
    read("src/renderer/index.html"),
    read("src/renderer/index.ts"),
    read("src/renderer/update-ui.ts"),
    read("src/preload/index.ts"),
    read("src/shared/ipc-contract.ts"),
    read("src/main/services/github-update-check.ts"),
    read("src/shared/update-source.ts")
  ]);
  const profile = html.match(/<section class="about-product__profile"[\s\S]*?<\/section>/u)?.[0] ?? "";
  assert.match(html, /aria-label="Relay 项目标识"[\s\S]*?src="\.\/assets\/relay-logo\.svg"/u);
  assert.notEqual(profile, "", "About must keep the 1.0-style developer identity inside the current-program card");
  assert.match(profile, /aria-label="柏拉图灵标识"[\s\S]*?src="\.\/assets\/platuring-avatar\.png"[^>]*alt="柏拉图灵标识"/u);
  assert.match(profile, /<p class="eyebrow">独立开发者<\/p>/u);
  assert.match(profile, /id="about-author-state">柏拉图灵 \| PlaTuring<\/span>/u);
  assert.match(profile, /id="about-author-tagline">抖音 \/ B站：柏拉图灵<\/p>/u);
  assert.equal((profile.match(/<dt>/gu) ?? []).length, 1);
  assert.match(profile, /<dt>项目仓库<\/dt>[\s\S]*?id="about-author-profile"[^>]*type="button"[^>]*>[\s\S]*?github\.com\/PlaTuring\/Relay/u);
  assert.doesNotMatch(profile, /<dt>(?:GitHub|开发者)<\/dt>|id="about-developer-name"/u);
  assert.doesNotMatch(html, /class="[^"]*\bsurface\s+about-brand\b/u);
  assert.ok(contract.includes('author: "柏拉图灵 | PlaTuring"'));
  assert.ok(contract.includes('authorTagline: "抖音 / B站：柏拉图灵"'));
  assert.match(html, /id="about-check-update"[\s\S]*?>[\s\S]*?检查更新/u);
  assert.match(updateRenderer, /checkForUpdates\(\)[\s\S]*?downloadUpdate\(\{ kind: "setup" \}\)/u);
  assert.match(updateRenderer, /openDownloadedUpdateFolder\(\)/u);
  assert.doesNotMatch(updateRenderer, /(?:path|url|command|args)\s*:/iu);
  assert.doesNotMatch(`${renderer}\n${updateRenderer}`, /aboutOpenRelease/u);
  assert.match(renderer, /openAboutLink\(aboutAuthorProfile, "repository"\)/u);
  assert.match(renderer, /aboutAuthorState\.textContent = bootstrap\.author/u);
  assert.match(renderer, /aboutAuthorTagline\.textContent = bootstrap\.authorTagline/u);
  assert.doesNotMatch(renderer, /aboutDeveloperName/u);
  assert.match(updateRenderer, /lastSuccessfulUpdateCheck[\s\S]*?本次失败没有覆盖有效结果/u);
  assert.match(updateRenderer, /已知新版本 \$\{formalVersionNumber\(cache\.latestVersion\)\}[\s\S]*?cachedEvidence/u);
  assert.match(updateRenderer, /status: "checking",\s*checkedAt: null/u);
  assert.doesNotMatch(updateRenderer, /catch\(\(error: unknown\)[\s\S]{0,500}更新检查未完成/u);
  for (const state of ["latest", "update_available", "no_release", "release_incomplete", "network", "rate_limit", "malformed"]) {
    assert.ok(`${updateRenderer}\n${update}`.includes(state), `missing update state ${state}`);
  }
  assert.ok(updateSource.includes('owner: "PlaTuring"'));
  assert.ok(updateSource.includes('repository: "Relay"'));
  assert.ok(updateSource.includes('authorProfileUrl: "https:\/\/github.com\/PlaTuring\/Relay"'));
  assert.ok(updateSource.includes('repositoryPageUrl: "https:\/\/github.com\/PlaTuring\/Relay"'));
  assert.doesNotMatch(update, /Authorization|GITHUB_TOKEN|process\.env/u);
  assert.match(preload, /无法确认本次工作流是否已写入或打开/u);
  assert.doesNotMatch(preload, /工作流已写入，但交接完成状态/u);
});

test("Alpha 32 drawers isolate the background, trap focus, and restore their trigger", async () => {
  const [html, renderer] = await Promise.all([
    read("src/renderer/index.html"),
    read("src/renderer/index.ts")
  ]);
  assert.match(html, /id="director-drawer-scrim"[^>]*tabindex="-1"/u);
  assert.match(html, /id="asset-detail-backdrop"[^>]*tabindex="-1"/u);
  assert.match(html, /id="director-drawer-tab-issues"[^>]*aria-controls="director-drawer-panel-issues"/u);
  assert.match(html, /id="director-drawer-panel-issues"[^>]*aria-labelledby="director-drawer-tab-issues"/u);
  assert.match(renderer, /function openDirectorDrawer[\s\S]*?\(activeTab \?\? directorDrawerClose\)\.focus/u);
  assert.match(renderer, /function openAssetDetailDrawer[\s\S]*?assetDetailClose\.focus/u);
  assert.match(renderer, /function closeDirectorDrawer[\s\S]*?restoreFocus && target\?\.isConnected === true[\s\S]*?target\.focus/u);
  assert.match(renderer, /function closeAssetDetailDrawer[\s\S]*?restoreFocus && target\?\.isConnected === true[\s\S]*?target\.focus/u);
  assert.match(renderer, /function setModalIsolation[\s\S]*?setAttribute\("inert", ""\)/u);
  assert.match(renderer, /function modalFocusableElements[\s\S]*?summary/u);
});

test("Alpha 40 migrates the old import placeholder to a non-interactive planned upscale page", async () => {
  const html = await read("src/renderer/index.html");
  assert.match(html, /data-view-target="upscale"[^>]*aria-label="画质超分"/u);
  const upscaleStart = html.indexOf('id="view-upscale"');
  const aboutStart = html.indexOf('id="view-about"');
  assert.ok(upscaleStart >= 0 && aboutStart > upscaleStart);
  const upscale = html.slice(upscaleStart, aboutStart);
  assert.match(upscale, /<h1 id="upscale-title">画质超分<\/h1>/u);
  assert.match(upscale, /<h2 id="upscale-planned-title">功能规划中<\/h2>/u);
  assert.ok(upscale.includes("当前版本不提供超分处理，也不会在此页面执行任何任务。"));
  assert.doesNotMatch(upscale, /<(?:a|button|form|input|select|textarea)\b/iu);
  assert.doesNotMatch(upscale, /data-(?:action|command|execute)=|tabindex=|role="button"/iu);
  assert.doesNotMatch(html, /view-import|data-view-target="import"/u);
});

test("Alpha 32 uses non-blocking notices for routine success and enters the selected project editor", async () => {
  const [html, renderer] = await Promise.all([
    read("src/renderer/index.html"),
    read("src/renderer/index.ts")
  ]);
  assert.match(html, /id="app-toast"[^>]*role="status"[^>]*aria-live="polite"/u);
  assert.match(renderer, /if \(options\.kind === "success" && options\.modal !== true\) \{\s*showToast\(options\);\s*return;/u);
  assert.match(renderer, /kind: !projectStillActive[\s\S]*?modal: result\.handoff/u);
  assert.match(renderer, /const projectTarget:[\s\S]*?summary\.editorMode === "professional" \? "director" : "project"/u);
  assert.match(renderer, /activateRelayProject\(summary\.projectId, projectTarget\)/u);
});

test("Alpha 32 reports theme persistence failures and suppresses duplicate async actions", async () => {
  const renderer = await read("src/renderer/index.ts");
  assert.match(renderer, /setUiTheme\(theme\)\.catch\(\(error: unknown\) => \{[\s\S]*?主题仅在当前会话生效/u);
  assert.match(renderer, /applyTheme\(choice, true\)/u);
  assert.match(renderer, /const inFlightActionKeys = new Set<string>\(\)/u);
  assert.match(renderer, /if \(inFlightActionKeys\.has\(actionKey\)\) return;[\s\S]*?inFlightActionKeys\.add\(actionKey\)[\s\S]*?finally \{\s*inFlightActionKeys\.delete\(actionKey\)/u);
});
