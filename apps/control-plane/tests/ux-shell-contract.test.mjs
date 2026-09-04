import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const read = (relative) => readFile(resolve(root, relative), "utf8");
const readBinary = (relative) => readFile(resolve(root, relative));

test("default workflow directory is beside the launched executable", async () => {
  const [main, services, renderer] = await Promise.all([
    read("src/main/main.ts"),
    read("src/main/services/index.ts"),
    read("src/renderer/index.html")
  ]);
  assert.ok(main.includes("PORTABLE_EXECUTABLE_DIR"));
  assert.ok(main.includes("dirname(process.execPath)"));
  assert.ok(services.includes('DEFAULT_WORKFLOW_DIRECTORY_NAME = "工作流文件"'));
  assert.ok(services.includes("options.executableDirectory"));
  assert.doesNotMatch(services, /join\(options\.userDataPath,\s*"exports"\)/u);
  assert.ok(renderer.includes("程序同目录\\工作流文件"));
});

test("post-install component management is a separate header action", async () => {
  const [html, renderer] = await Promise.all([
    read("src/renderer/index.html"),
    read("src/renderer/index.ts")
  ]);
  const navigation = html.match(/<nav id="main-navigation"[\s\S]*?<\/nav>/u)?.[0] ?? "";
  assert.ok(navigation.includes('data-view-target="home"'));
  assert.ok(navigation.includes("项目"));
  assert.ok(navigation.includes("快速创建工作流"));
  assert.ok(navigation.includes("专业导播"));
  assert.ok(navigation.includes("项目素材库"));
  assert.ok(navigation.includes("视频成品"));
  assert.ok(navigation.includes("画质超分"));
  assert.match(html, /id="view-home"[\s\S]*?id="project-center-data-root"[\s\S]*?id="project-center-recent-list"/u);
  assert.doesNotMatch(navigation, /安装与组件/u);
  assert.match(html, /id="component-settings-button"[\s\S]*?安装与组件/u);
  assert.ok(renderer.includes("mainNavigation.hidden = false"));
  assert.ok(renderer.includes("componentSettingsButton.hidden = false"));
});

test("project-centered shell exposes honest project, dataRoot, asset, and director surfaces", async () => {
  const html = await read("src/renderer/index.html");
  const navigation = html.match(/<nav id="main-navigation"[\s\S]*?<\/nav>/u)?.[0] ?? "";
  assert.ok(navigation.indexOf('data-view-target="home"') < navigation.indexOf('data-view-target="project"'));
  assert.ok(navigation.indexOf('data-view-target="project"') < navigation.indexOf('data-view-target="director"'));
  assert.ok(navigation.includes("项目素材库"));
  assert.ok(navigation.indexOf('data-view-target="assets"') < navigation.indexOf('data-view-target="generated"'));
  assert.ok(navigation.indexOf('data-view-target="generated"') < navigation.indexOf('data-view-target="upscale"'));
  assert.match(html, /id="view-home"[\s\S]*?id="project-center-create"[\s\S]*?id="project-center-data-root"/u);
  assert.match(html, /不是 Windows 的程序安装目录/u);
  assert.match(html, /id="project-center-recent-list"[\s\S]*?id="project-center-import-bundle"[\s\S]*?id="project-center-archive"/u);
  assert.match(html, /id="project-create-dialog"[\s\S]*?id="project-create-name"[\s\S]*?id="project-create-confirm"/u);
  assert.match(html, /id="data-root-dialog"[\s\S]*?value="migrate"[\s\S]*?value="new_library"[\s\S]*?id="data-root-cancel"/u);
  assert.match(html, /id="director-undo-button"[\s\S]*?id="director-redo-button"[\s\S]*?id="director-history-button"/u);
  assert.match(html, /id="director-shot-start-state"[\s\S]*?id="director-shot-end-state"[\s\S]*?id="director-shot-transition-kind"/u);
  assert.match(html, /id="asset-import-button"[\s\S]*?id="asset-drop-zone"[\s\S]*?id="asset-advanced-import-button"[\s\S]*?id="asset-list"[\s\S]*?id="asset-detail-drawer"/u);
  assert.doesNotMatch(html, /id="asset-import-policy"/u);
  assert.match(html, /id="asset-binding-list"[\s\S]*?当前项目尚未引用此素材/u);
  assert.doesNotMatch(html, /data-view="(?:continuity|versions|results)"/u);
});

test("upscale is an honest planned view with no fake execution surface", async () => {
  const [html, renderer, ipc] = await Promise.all([
    read("src/renderer/index.html"),
    read("src/renderer/index.ts"),
    read("src/shared/ipc-contract.ts")
  ]);
  const projectNavigation = html.match(/<nav id="main-navigation"[\s\S]*?<\/nav>/u)?.[0] ?? "";
  const upscaleStart = html.indexOf('id="view-upscale"');
  const aboutStart = html.indexOf('id="view-about"');
  const upscaleView = upscaleStart >= 0 && aboutStart > upscaleStart ? html.slice(upscaleStart, aboutStart) : "";
  assert.ok(projectNavigation.indexOf("视频成品") < projectNavigation.indexOf("画质超分"));
  assert.match(upscaleView, /<h1 id="upscale-title">画质超分<\/h1>/u);
  assert.match(upscaleView, /<h2 id="upscale-planned-title">功能规划中<\/h2>/u);
  assert.ok(upscaleView.includes("当前版本不提供超分处理，也不会在此页面执行任何任务。"));
  assert.doesNotMatch(upscaleView, /<(?:a|button|form|input|select|textarea)\b/iu);
  assert.doesNotMatch(upscaleView, /data-(?:action|command|import|execute)=/iu);
  assert.ok(renderer.includes('value === "upscale"'));
  assert.doesNotMatch(html, /id="view-import"|data-view-target="import"/u);
  assert.doesNotMatch(`${renderer}\n${ipc}`, /(?:importWorkflow|executeImport|parseImportedWorkflow|installThirdPartyNode)/u);
});

test("about page uses runtime identity, project resources and stable update information", async () => {
  const [html, renderer, styles, main, services, contract, packageJsonText] = await Promise.all([
    read("src/renderer/index.html"),
    read("src/renderer/index.ts"),
    read("src/renderer/styles.css"),
    read("src/main/main.ts"),
    read("src/main/services/index.ts"),
    read("src/shared/ipc-contract.ts"),
    read("package.json")
  ]);
  const packageJson = JSON.parse(packageJsonText);
  const aboutNavigation = html.match(/<nav class="main-navigation main-navigation--secondary"[\s\S]*?<\/nav>/u)?.[0] ?? "";
  const aboutStart = html.indexOf('id="view-about"');
  const aboutView = aboutStart >= 0 ? html.slice(aboutStart, html.indexOf("</main>", aboutStart)) : "";
  const aboutProfile = aboutView.match(/<section class="about-product__profile"[\s\S]*?<\/section>/u)?.[0] ?? "";
  assert.ok(aboutNavigation.includes("关于"));
  assert.ok(html.indexOf("main-navigation--secondary") < html.indexOf("tool-sidebar__footer"));
  assert.ok(aboutView.includes('id="about-app-name"'));
  assert.ok(aboutView.includes('id="about-app-version"'));
  assert.ok(aboutView.includes('id="about-author-profile"'));
  assert.ok(aboutView.includes("检测、安装和配置本机 ComfyUI 与 MiniMax H3 环境"));
  assert.ok(aboutView.includes("确定性编译并在 ComfyUI 中打开可编辑工作流"));
  assert.ok(aboutView.includes("本地工作流"));
  assert.ok(aboutView.includes("从项目准备到可编辑工作流"));
  assert.ok(aboutView.includes("查看版本、项目信息与 Relay 的本地工作方式。"));
  assert.ok(aboutView.includes("软件更新"));
  assert.ok(aboutView.includes("Relay 更新"));
  assert.ok(aboutView.includes("GitHub Releases"));
  assert.ok(aboutView.includes("下载并安装"));
  assert.doesNotMatch(aboutView, /发行说明|发布资产|下载验证|由你决定何时安装/u);
  assert.doesNotMatch(aboutView, /(?:Alpha|Pre-release|测试预览|预发布|未签名|SmartScreen|Authenticode)/iu);
  assert.doesNotMatch(html, /0\.1\.0-alpha\.\d+/u);
  assert.ok(renderer.includes("aboutAppName.textContent = bootstrap.appName"));
  assert.ok(renderer.includes("const visualVersion = formalVersionLabel(bootstrap.appVersion)"));
  assert.ok(renderer.includes("aboutAppVersion.textContent = visualVersion"));
  assert.ok(renderer.includes("aboutAuthorState.textContent = bootstrap.author"));
  assert.ok(renderer.includes("aboutAuthorTagline.textContent = bootstrap.authorTagline"));
  assert.doesNotMatch(renderer, /aboutDeveloperName/u);
  assert.ok(renderer.includes("aboutAuthorProfile.textContent = bootstrap.authorIntroductionUrl"));
  assert.ok(contract.includes('name: "Relay"'));
  assert.ok(contract.includes('author: "柏拉图灵 | PlaTuring"'));
  assert.ok(contract.includes('authorTagline: "抖音 / B站：柏拉图灵"'));
  assert.ok(contract.includes('authorProfileUrl: "https://github.com/PlaTuring/Relay"'));
  assert.ok(contract.includes('authorIntroductionUrl: "https://github.com/PlaTuring/Relay"'));
  assert.equal(packageJson.build.productName, "Relay");
  assert.equal(packageJson.author, "Relay contributors");
  assert.ok(main.includes("appVersion: app.getVersion()"));
  assert.ok(services.includes("appName: APPLICATION_IDENTITY.name"));
  assert.ok(services.includes("appVersion: options.appVersion"));
  assert.equal((html.match(/id="project-form"/gu) ?? []).length, 1);
  assert.ok(renderer.includes("section.hidden = !active"));
  assert.doesNotMatch(renderer, /projectForm\.(?:reset|replaceChildren)\(/u);
  assert.match(styles, /\.main-navigation--secondary\s*\{[^}]*margin-top:\s*auto/u);
  assert.match(styles, /\.about-layout\s*\{[^}]*display:\s*grid/u);
  assert.match(styles, /\.about-product\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\((?:300|320)px,\s*\.92fr\)/u);
  assert.match(styles, /\.about-product__profile\s*\{[^}]*border-left:\s*1px solid var\(--border\)/u);
  assert.match(styles, /\.about-brand__copy\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(112px,\s*\.92fr\)[\s\S]*?"developer-label repository"[\s\S]*?"developer-name repository"[\s\S]*?"developer-social repository"/u);
  assert.match(styles, /\.about-profile\s*\{[^}]*grid-area:\s*repository[^}]*margin:\s*0/u);
  assert.match(styles, /@media \(max-width:\s*760px\)[\s\S]*?\.about-product\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/u);
  assert.match(styles, /@media \(max-width:\s*760px\)[\s\S]*?\.about-product__profile\s*\{[^}]*border-top:\s*1px solid var\(--border\);[^}]*border-left:\s*0/u);
  assert.match(aboutProfile, /<p class="eyebrow">独立开发者<\/p>[\s\S]*?id="about-author-state">柏拉图灵 \| PlaTuring<\/span>[\s\S]*?id="about-author-tagline">抖音 \/ B站：柏拉图灵<\/p>/u);
  assert.deepEqual([...aboutProfile.matchAll(/<dt>([^<]+)<\/dt>/gu)].map((match) => match[1]), ["项目仓库"]);
  assert.doesNotMatch(aboutProfile, /<dt>(?:GitHub|开发者)<\/dt>|id="about-developer-name"/u);
});

test("Relay branding uses local, self-contained assets at every visible brand position", async () => {
  const [html, styles, svg, avatar, png, ico, installerHeader, installerSidebar] = await Promise.all([
    read("src/renderer/index.html"),
    read("src/renderer/styles.css"),
    read("src/renderer/assets/relay-logo.svg"),
    readBinary("src/renderer/assets/platuring-avatar.png"),
    readBinary("src/renderer/assets/relay-icon.png"),
    readBinary("src/renderer/assets/relay-icon.ico"),
    readBinary("src/renderer/assets/relay-installer-header.bmp"),
    readBinary("src/renderer/assets/relay-installer-sidebar.bmp")
  ]);

  assert.match(html, /<title>Relay<\/title>/u);
  assert.match(html, /rel="icon"[^>]+href="\.\/assets\/relay-logo\.svg"/u);
  assert.equal((html.match(/src="\.\/assets\/relay-logo\.svg"/gu) ?? []).length, 2);
  assert.match(html, /aria-label="Relay 项目标识"[^>]*>[\s\S]*?src="\.\/assets\/relay-logo\.svg"[^>]+alt=""[^>]+aria-hidden="true"/u);
  assert.equal((html.match(/src="\.\/assets\/platuring-avatar\.png"/gu) ?? []).length, 1);
  assert.match(html, /aria-label="柏拉图灵标识"[^>]*>[\s\S]*?src="\.\/assets\/platuring-avatar\.png"[^>]+alt="柏拉图灵标识"/u);
  assert.match(html, /class="about-product__profile"[\s\S]*?<p class="eyebrow">独立开发者<\/p>[\s\S]*?id="about-author-state">柏拉图灵 \| PlaTuring<\/span>/u);
  assert.match(html, /class="about-product__profile"[\s\S]*?<dt>项目仓库<\/dt>[\s\S]*?id="about-author-profile"/u);
  assert.doesNotMatch(html, /<dt>(?:GitHub|开发者)<\/dt>|id="about-developer-name"/u);
  assert.doesNotMatch(html, /class="[^"]*\bsurface\s+about-brand\b/u);
  assert.doesNotMatch(html, />\s*PR\s*</u);
  assert.doesNotMatch(html, /PlaTuring Relay/u);
  assert.match(styles, /\.brand-logo\s*\{/u);
  assert.doesNotMatch(styles, /\.brand-mark\s*\{/u);

  assert.match(svg, /<svg[^>]+viewBox="0 0 512 512"/u);
  assert.match(svg, /<title[^>]*>Relay<\/title>/u);
  assert.doesNotMatch(svg, /<(?:script|image)\b/iu);
  assert.doesNotMatch(svg, /(?:href|src)="https?:/iu);

  assert.equal(avatar.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(avatar.readUInt32BE(16), 1024);
  assert.equal(avatar.readUInt32BE(20), 1024);

  assert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(png.readUInt32BE(16), 512);
  assert.equal(png.readUInt32BE(20), 512);

  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  const iconCount = ico.readUInt16LE(4);
  const iconSizes = Array.from({ length: iconCount }, (_, index) => {
    const offset = 6 + index * 16;
    return ico[offset] === 0 ? 256 : ico[offset];
  });
  assert.deepEqual(iconSizes, [16, 20, 24, 32, 40, 48, 64, 128, 256]);

  const assertBmp = (bitmap, width, height) => {
    assert.equal(bitmap.subarray(0, 2).toString("ascii"), "BM");
    assert.equal(bitmap.readInt32LE(18), width);
    assert.equal(bitmap.readInt32LE(22), height);
    assert.equal(bitmap.readUInt16LE(28), 24);
  };
  assertBmp(installerHeader, 150, 57);
  assertBmp(installerSidebar, 164, 314);
});

test("workflow name is explicit and prompt guidance stays placeholder-only", async () => {
  const [html, renderer, title, contract] = await Promise.all([
    read("src/renderer/index.html"),
    read("src/renderer/index.ts"),
    read("src/main/services/workflow-title.ts"),
    read("src/shared/ipc-contract.ts")
  ]);
  const nameIndex = html.indexOf('id="workflow-name"');
  const promptIndex = html.indexOf('id="project-prompt"');
  assert.ok(nameIndex >= 0 && promptIndex > nameIndex, "workflow name must be above the prompt");
  assert.match(html, /id="workflow-name"[^>]+maxlength="80"[^>]+required/u);
  assert.doesNotMatch(html, /名称由你填写，用于 JSON 文件名|灰色示例只提示官方写法/u);
  assert.ok(renderer.includes("validateWorkflowName(workflowNameInput.value)"));
  assert.ok(renderer.includes("workflowName: compileWorkflowName"));
  assert.ok(contract.includes("readonly workflowName: string"));
  assert.ok(title.includes("createUserNamedWorkflowFileName"));
  assert.doesNotMatch(title, /project\.prompt|createPromptDerived|normalizePromptPhrase|safeTitle/u);
  assert.ok(renderer.includes("function syncPromptPlaceholder"));
  assert.ok(html.includes('id="prompt-timeline-advice"'));
  assert.ok(renderer.includes("function detectedPromptDuration"));
  assert.ok(renderer.includes("按最后一个镜头切点至少应选择"));
  assert.ok(renderer.includes("projectPrompt.placeholder ="));
  const quickRestoreStart = renderer.indexOf("function setQuickFormFromProject");
  const quickRestoreEnd = renderer.indexOf("async function restoreProjectFrameSelections", quickRestoreStart);
  assert.ok(quickRestoreStart >= 0 && quickRestoreEnd > quickRestoreStart);
  const quickRestoreSource = renderer.slice(quickRestoreStart, quickRestoreEnd);
  const rendererOutsideQuickRestore = `${renderer.slice(0, quickRestoreStart)}${renderer.slice(quickRestoreEnd)}`;
  assert.match(quickRestoreSource, /projectPrompt\.value = project\.quick\.originalPrompt/u);
  assert.doesNotMatch(
    quickRestoreSource,
    /project\.quick\.originalPrompt\s*\.(?:trim|replace|slice|substring)|(?:expand|rewrite|generate|derive)[A-Za-z]*Prompt/iu,
    "restoration must use the exact stored prompt without creative rewriting"
  );
  assert.doesNotMatch(
    rendererOutsideQuickRestore.replaceAll('projectPrompt.value = "";', ""),
    /projectPrompt\.value\s*=/u,
    "outside project restoration the prompt field may only be explicitly cleared"
  );
  assert.match(renderer, /originalPrompt: projectPrompt\.value/u);
  assert.doesNotMatch(
    renderer,
    /workflowNameInput\.value\s*=\s*[^;\n]*(?:projectPrompt|originalPrompt)|\b(?:generatePrompt|expandPrompt|rewritePrompt|deriveWorkflowNameFromPrompt|createPromptDerived)\b/iu,
    "the quick workflow name and prompt must not be synthesized from one another"
  );
  assert.doesNotMatch(
    title,
    /\bprompt\b|originalPrompt|createPromptDerived|normalizePromptPhrase|safeTitle/iu,
    "workflow-title service must use the explicit user name only"
  );
  for (const officialFragment of [
    "综合多模态描述：",
    "整体声景：",
    "画外配乐：",
    "主体定义：",
    "[reference generation]",
    "fully_preserved",
    "<Subject 1>",
    "<Picture 1>"
  ]) assert.ok(renderer.includes(officialFragment), `missing prompt placeholder fragment: ${officialFragment}`);
  assert.ok(renderer.includes("timelineTimestamp(start)"));
});

test("plain-language service status and visible Ref2VA mode replace internal jargon", async () => {
  const [html, renderer] = await Promise.all([
    read("src/renderer/index.html"),
    read("src/renderer/index.ts")
  ]);
  assert.ok(renderer.includes('"Relay 服务可用"'));
  assert.doesNotMatch(`${html}\n${renderer}`, /A\/B 本机适配器已连接/u);
  assert.match(html, /name="mode" value="REF2VA"/u);
  assert.ok(html.includes("该模式始终显示") || renderer.includes("该模式始终显示"));
  assert.ok(renderer.includes('completedOptionalComponents.has("ref2va_optional")'));
});

test("project output controls use compact selects with a conservative segment plan", async () => {
  const [html, renderer, styles] = await Promise.all([
    read("src/renderer/index.html"),
    read("src/renderer/index.ts"),
    read("src/renderer/styles.css")
  ]);
  assert.doesNotMatch(html, /<input[^>]+type="radio"[^>]+name="(?:duration|canvas)"/u);
  assert.match(html, /<select id="project-duration"[^>]+data-contract-hook="total-duration"/u);
  assert.match(html, /<select id="segment-duration"[^>]+data-contract-hook="segment-duration"/u);
  assert.match(html, /<select id="project-canvas"[^>]+name="canvas"[^>]+data-contract-hook="canvas-aspect-ratios"/u);
  assert.match(html, /<select id="project-resolution"[^>]+name="resolutionMegapixels"[^>]+data-contract-hook="resolution-megapixels"/u);
  assert.match(html, /<option value="5" selected>5 秒 \/ 段（默认）<\/option>/u);
  const projectSection = html.slice(html.indexOf('id="view-project"'), html.indexOf('id="view-director"'));
  assert.equal((projectSection.match(/<option value="(?:21:9|16:9|3:2|4:3|1:1|3:4|2:3|9:16)"/gu) ?? []).length, 8);
  assert.equal((projectSection.match(/<option value="(?:0\.2|0\.3|0\.4|0\.5|0\.6|0\.7|0\.8|0\.9|0\.98|1\.0|1\.2|1\.5|1\.8|2\.0)"/gu) ?? []).length, 14);
  assert.match(html, /<option value="9:16" selected>9:16 竖屏<\/option>/u);
  assert.match(html, /<option value="0\.4" selected>0\.4 MP<\/option>/u);
  assert.doesNotMatch(html, /<option value="(?:1344x576|1344x768|1152x768|1024x768|768x768|768x1024|768x1152|768x1344)"/u);
  assert.ok(html.includes("画布比例"));
  assert.ok(html.includes("分辨率 / 百万像素"));
  assert.ok(html.includes('id="segment-summary"'));
  assert.ok(renderer.includes("segmentDurationSeconds"));
  assert.ok(renderer.includes("resolutionMegapixels"));
  assert.ok(renderer.includes("megapixels * (1024 ** 2)"));
  assert.ok(renderer.includes("function roundHalfEven"));
  assert.ok(renderer.includes("/ 32) * 32"));
  assert.ok(renderer.includes("Math.ceil(totalSeconds / segmentSeconds)"));
  assert.ok(renderer.includes("setSegmentRecommendation(result.system.vramBytes)"));
  assert.ok(renderer.includes("bootstrap.savedSetup?.vramBytes ?? null"));
  assert.match(styles, /\.output-parameter-list\s*\{/u);
  assert.doesNotMatch(styles, /\.canvas-options\s*\{/u);
});

test("renderer exposes a complete light and dark Codex-style theme shell", async () => {
  const [html, styles, renderer] = await Promise.all([
    read("src/renderer/index.html"),
    read("src/renderer/styles.css"),
    read("src/renderer/index.ts")
  ]);
  const adapterIndex = html.indexOf('id="adapter-pill"');
  const switcherIndex = html.indexOf('id="theme-switcher"');
  const settingsIndex = html.indexOf('id="component-settings-button"');
  assert.ok(adapterIndex >= 0 && switcherIndex > adapterIndex && settingsIndex > switcherIndex);
  assert.match(html, /<html lang="zh-CN" data-theme="dark">/u);
  assert.match(html, /id="theme-switcher"[^>]+role="group"[^>]+aria-label="界面主题"/u);
  assert.match(html, /data-theme-choice="light" aria-pressed="false"/u);
  assert.match(html, /data-theme-choice="dark" aria-pressed="true"/u);
  assert.ok(html.includes("浅色") && html.includes("深色"));
  assert.match(styles, /html\[data-theme="light"\]\s*\{[\s\S]*?color-scheme:\s*light/u);
  assert.match(styles, /--titlebar-height:\s*env\(titlebar-area-height,\s*32px\)/u);
  assert.match(styles, /\.app-shell::before\s*\{[\s\S]*?-webkit-app-region:\s*drag/u);
  assert.match(styles, /\.theme-switcher\s*\{[\s\S]*?-webkit-app-region:\s*no-drag/u);
  assert.match(styles, /\.output-parameter__label strong\s*\{[^}]*font-size:\s*15px/u);
  assert.match(styles, /\.output-parameter__label small\s*\{[^}]*font-size:\s*12\.5px/u);
  assert.match(styles, /\.output-parameter\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+220px/u);
  assert.match(styles, /\.output-parameter select\s*\{[^}]*max-width:\s*220px/u);
  assert.match(styles, /#project-duration, #segment-duration\s*\{[^}]*max-width:\s*220px/u);
  assert.match(styles, /\.page-container\s*\{[^}]*width:\s*min\(980px,\s*100%\)/u);
  assert.match(styles, /\.page-container--setup\s*\{[^}]*width:\s*min\(1200px,\s*100%\)/u);
  assert.doesNotMatch(styles, /min\(1400px,\s*100%\)/u);
  assert.match(styles, /@media \(max-width:\s*760px\)[\s\S]*?\.output-parameter select, #project-duration, #segment-duration\s*\{[^}]*max-width:\s*100%;[^}]*justify-self:\s*stretch/u);
  assert.match(styles, /\.app-header\s*\{[^}]*box-shadow:\s*none/u);
  assert.match(styles, /\.segment-plan\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent/u);
  assert.match(html, /<dialog id="feedback-dialog"[^>]*aria-labelledby="feedback-title"/u);
  assert.match(html, /id="compile-button"[^>]*form="project-form"/u);
  assert.match(styles, /\.feedback-dialog\s*\{[^}]*background:\s*var\(--surface\)/u);
  assert.match(renderer, /feedbackDialog\.showModal\(\)/u);
  assert.doesNotMatch(html, /id="(?:handoff-boundary|compile-error|compile-result)"/u);
  assert.doesNotMatch(styles, /\.handoff-section\s*\{[^}]*position:\s*sticky/u);
  const visibleFontSizes = [...styles.matchAll(/font-size:\s*([0-9.]+)px/gu)].map((match) => Number(match[1]));
  assert.ok(visibleFontSizes.every((size) => size >= 11), `found undersized text: ${visibleFontSizes.filter((size) => size < 11).join(", ")}`);
  const nonTokenHex = styles.slice(styles.indexOf("* { ")).match(/#[0-9a-fA-F]{3,8}/gu) ?? [];
  assert.deepEqual([...new Set(nonTokenHex)], ["#fff"]);
});
