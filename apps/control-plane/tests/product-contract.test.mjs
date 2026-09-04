import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import test from "node:test";

const projectRoot = resolve(import.meta.dirname, "..");
const read = (relativePath) => readFile(resolve(projectRoot, relativePath), "utf8");

async function collectFiles(directory, acceptedExtensions) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(absolute, acceptedExtensions)));
    } else if (
      entry.isFile() &&
      [...acceptedExtensions].some((extension) => entry.name.endsWith(extension))
    ) {
      files.push(absolute);
    }
  }
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

test("renderer stays sandboxed behind a strict local-only CSP", async () => {
  const [security, html] = await Promise.all([
    read("src/main/security.ts"),
    read("src/renderer/index.html")
  ]);

  for (const fragment of [
    "contextIsolation: true",
    "sandbox: true",
    "nodeIntegration: false",
    "nodeIntegrationInWorker: false",
    "nodeIntegrationInSubFrames: false",
    "webviewTag: false",
    "webSecurity: true",
    "allowRunningInsecureContent: false",
    "backgroundThrottling: false",
    "setPermissionCheckHandler(() => false)",
    'setWindowOpenHandler(() => ({ action: "deny" }))',
    'controlSession.on("will-download"'
  ]) {
    assert.ok(security.includes(fragment), `missing security invariant: ${fragment}`);
  }

  for (const directive of [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'"
  ]) {
    assert.ok(html.includes(directive), `missing CSP directive: ${directive}`);
  }
  assert.doesNotMatch(html, /unsafe-(?:inline|eval)/u);
  const allowedVisibleAboutUrls = [
    "https://github.com/PlaTuring",
    "https://github.com/PlaTuring/Relay"
  ];
  let htmlWithoutAllowedVisibleUrls = html;
  for (const url of allowedVisibleAboutUrls) {
    htmlWithoutAllowedVisibleUrls = htmlWithoutAllowedVisibleUrls.replaceAll(url, "");
  }
  assert.doesNotMatch(htmlWithoutAllowedVisibleUrls, /https?:\/\//u);
});

test("typed IPC exposes only the explicit closed-channel allowlist with a bounded handoff status query", async () => {
  const [contract, mainRegistry, preload] = await Promise.all([
    read("src/shared/ipc-contract.ts"),
    read("src/main/ipc-registry.ts"),
    read("src/preload/index.ts")
  ]);
  const expectedRegistry = [
    ["getBootstrap", "control:get-bootstrap"],
    ["scanInstallation", "control:scan-installation"],
    ["prepareInstallation", "control:prepare-installation"],
    ["executeInstallation", "control:execute-installation"],
    ["queryInstallation", "control:query-installation"],
    ["cancelInstallation", "control:cancel-installation"],
    ["chooseDirectory", "control:choose-directory"],
    ["chooseFrame", "control:choose-frame"],
    ["chooseResultMedia", "control:choose-result-media"],
    ["chooseExportDirectory", "control:choose-export-directory"],
    ["importLocalAssets", "control:asset-import-local"],
    ["listLocalAssets", "control:asset-list-local"],
    ["updateLocalAsset", "control:asset-update-local"],
    ["refreshLocalAssets", "control:asset-refresh-local"],
    ["relocateLocalAsset", "control:asset-relocate-local"],
    ["confirmLocalAssetReplacement", "control:asset-confirm-replacement"],
    ["copyLocalAssetToProject", "control:asset-copy-to-project"],
    ["prepareLocalAssetFrame", "control:asset-prepare-frame"],
    ["setUiTheme", "control:set-ui-theme"],
    ["getProjectCenter", "control:project-center-get"],
    ["createRelayProject", "control:project-create"],
    ["loadRelayProject", "control:project-load"],
    ["saveRelayProject", "control:project-save"],
    ["cloneRelayProject", "control:project-clone"],
    ["archiveRelayProject", "control:project-archive"],
    ["restoreRelayProject", "control:project-restore"],
    ["chooseAndConfigureDataRoot", "control:data-root-choose-configure"],
    ["openDataRoot", "control:data-root-open"],
    ["getUpdateCheckCache", "control:update-check-cache-get"],
    ["checkForUpdates", "control:update-check-run"],
    ["downloadUpdate", "control:update-download-start"],
    ["getUpdateDownloadStatus", "control:update-download-status-get"],
    ["cancelUpdateDownload", "control:update-download-cancel"],
    ["openDownloadedUpdateFolder", "control:update-download-folder-open"],
    ["openValidatedReleasePage", "control:update-validated-release-open"],
    ["openAboutLink", "control:about-link-open"],
    ["listGeneratedVideos", "control:generated-videos-list"],
    ["supplementGeneratedVideo", "control:generated-videos-supplement"],
    ["getGeneratedVideoPreview", "control:generated-videos-preview"],
    ["playGeneratedVideo", "control:generated-videos-play"],
    ["showGeneratedVideoInFolder", "control:generated-videos-reveal"],
    ["addGeneratedVideoToProjectAssets", "control:generated-videos-add-to-assets"],
    ["importProjectAssets", "control:project-assets-import"],
    ["importDroppedProjectAssets", "control:project-assets-import-dropped"],
    ["listProjectAssets", "control:project-assets-list"],
    ["updateProjectAsset", "control:project-assets-update"],
    ["refreshProjectAssets", "control:project-assets-refresh"],
    ["relocateProjectAsset", "control:project-assets-relocate"],
    ["removeProjectAsset", "control:project-assets-remove"],
    ["listDeletedProjectAssets", "control:project-assets-deleted-list"],
    ["restoreProjectAsset", "control:project-assets-restore"],
    ["getProjectAssetPreview", "control:project-assets-preview"],
    ["bindProjectAsset", "control:project-assets-bind"],
    ["unbindProjectAsset", "control:project-assets-unbind"],
    ["revealProjectAsset", "control:project-assets-reveal"],
    ["prepareProjectAssetFrame", "control:project-assets-prepare-frame"],
    ["copyProjectAssetIntoProject", "control:project-assets-copy-into-project"],
    ["exportRelayProjectBundle", "control:project-bundle-export"],
    ["importRelayProjectBundle", "control:project-bundle-import"],
    ["compileAndOpenWorkflow", "control:compile-and-open-workflow"],
    ["queryWorkflowHandoff", "control:query-workflow-handoff"]
  ];
  const declaredRegistry = [...contract.matchAll(/^\s{2}([a-zA-Z][a-zA-Z0-9]*): "(control:[a-z-]+)",?$/gmu)]
    .map((match) => [match[1], match[2]]);
  const expectedKeys = expectedRegistry.map(([key]) => key);
  const mainKeys = [...mainRegistry.matchAll(/ipcMain\.handle\(\s*IPC_REGISTRY\.([a-zA-Z][a-zA-Z0-9]*)/gu)]
    .map((match) => match[1]);
  const preloadKeys = [...preload.matchAll(/IPC_REGISTRY\.([a-zA-Z][a-zA-Z0-9]*)/gu)]
    .map((match) => match[1]);

  assert.deepEqual(declaredRegistry, expectedRegistry);
  assert.deepEqual(mainKeys, expectedKeys, "main must register every closed channel once and in contract order");
  assert.equal(new Set(preloadKeys).size, expectedKeys.length, "preload must expose each registry channel exactly once");
  assert.deepEqual([...preloadKeys].sort(), [...expectedKeys].sort());
  assert.equal((mainRegistry.match(/ipcMain\.handle\(/gu) ?? []).length, expectedRegistry.length);
  assert.equal(
    (preload.match(/ipcRenderer\.invoke\(/gu) ?? []).length,
    expectedRegistry.length - 1,
    "compile-and-open uses the one bounded invokeWithDeadline wrapper"
  );
  assert.equal((preload.match(/contextBridge\.exposeInMainWorld\(/gu) ?? []).length, 1);
  assert.ok(mainRegistry.includes("event.senderFrame !== event.sender.mainFrame"));
  assert.ok(mainRegistry.includes("event.senderFrame.url !== expectedRendererUrl"));
  assert.ok(mainRegistry.includes("requireExactRecord"));
  assert.match(
    mainRegistry,
    /IPC_REGISTRY\.downloadUpdate,[\s\S]*?services\.downloadUpdate\(validateUpdateDownloadRequest\(input\)\)/u
  );
  assert.match(
    preload,
    /downloadUpdate: \(request: \{ readonly kind: UpdateDownloadKind \}\) =>\s*ipcRenderer\.invoke\(IPC_REGISTRY\.downloadUpdate, request\)/u
  );
  assert.match(
    mainRegistry,
    /IPC_REGISTRY\.openAboutLink,[\s\S]*?openAboutLink\(validateAboutLinkTarget\(input\)\)/u
  );
  assert.match(
    preload,
    /openAboutLink: \(target: AboutLinkTarget\) =>\s*ipcRenderer\.invoke\(IPC_REGISTRY\.openAboutLink, target\)/u
  );
  assert.ok(preload.includes("HANDOFF_QUERY_DEADLINE_MS"));
  assert.ok(preload.includes("IPC_REGISTRY.queryWorkflowHandoff"));
  assert.doesNotMatch(preload, /ipcRenderer\.(?:send|on|once|sendSync|postMessage)/u);
  assert.doesNotMatch(
    contract,
    /\b(?:command|executable|argv|arguments|environment|workingDirectory)\??\s*:/u
  );
});

test("product boundary, software-only branding and mock reuse totals are fixed", async () => {
  const [contract, mock] = await Promise.all([
    read("src/shared/ipc-contract.ts"),
    read("src/main/services/mock.ts")
  ]);
  const runtime = `${contract}\n${mock}`;

  for (const fragment of [
    'applicationRole: "installer_configurator_workflow_compiler"',
    'formalSubmissionOwner: "visible_comfyui_user_action"',
    'mediaGenerationOwner: "minimax_h3_inside_comfyui"',
    "queueSubmission: false",
    "software_brand_only: true",
    "media_branding_authority: false",
    'aiGenerationIdentifier: "encouraged_not_required"',
    'recommendedInstallRoot: "D:\\\\MiniMaxH3"',
    "verifiedReuseGiB: 0",
    'mode: "attach_only"',
    "mutatesExistingInstance: false"
  ]) {
    assert.ok(runtime.includes(fragment), `missing fixed product boundary: ${fragment}`);
  }
  assert.doesNotMatch(runtime, /software_brand_only\s*:\s*false/u);
  assert.doesNotMatch(runtime, /media_branding_authority\s*:\s*true/u);
});

test("UI has the bounded installer and workflow-handoff controls", async () => {
  const [rendererFiles, mock] = await Promise.all([
    collectFiles(resolve(projectRoot, "src", "renderer"), new Set([".html", ".ts", ".css"])),
    read("src/main/services/mock.ts")
  ]);
  const renderer = (
    await Promise.all(rendererFiles.map((path) => readFile(path, "utf8")))
  ).join("\n");
  const productText = `${renderer}\n${mock}`;

  for (const requiredText of [
    "编译并在 ComfyUI 中打开",
    "开始安装",
    "下载缺失文件",
    "失败恢复",
    "已验证复用",
    "需下载",
    "FL2VA 基础包",
    "Turbo 加速权重",
    "Ref2VA 可选包",
    "PyAV",
    "FFmpeg",
    "ComfyUI Desktop",
    "更改…",
    "选择已有 ComfyUI…",
    "提示词",
    "模式",
    "首帧",
    "尾帧",
    "时长",
    "画布"
  ]) {
    assert.ok(productText.includes(requiredText), `missing bounded UI text: ${requiredText}`);
  }

  for (const forbiddenText of ["内容类型", "许可证、支持渠道与正式作者信息将在发布版本补充"]) {
    assert.equal(productText.includes(forbiddenText), false, `forbidden UI authority: ${forbiddenText}`);
  }
  assert.ok(productText.includes("检测、安装和配置本机 ComfyUI 与 MiniMax H3 环境"));
  assert.ok(productText.includes("确定性编译并在 ComfyUI 中打开可编辑工作流"));
  assert.equal(productText.includes("生成并在 ComfyUI 中打开工作流"), false);
  assert.doesNotMatch(renderer, /id=["'](?:generate-video|run-workflow|submit-queue)["']/iu);
  assert.doesNotMatch(renderer, /<(?:button|a)[^>]*>[^<]*(?:生成视频|自动运行)[^<]*<\//iu);
  assert.ok(renderer.includes('id="browse-install-root"'));
  assert.ok(renderer.includes('id="browse-existing-comfy-root"'));
  assert.doesNotMatch(renderer, /确认授权|license-acknowledged|region-commercial-confirmed|download-consent/u);
});

test("runtime has no queue route, generic executor or auto-updater and only the two fixed GitHub Alpha clients may use fetch", async () => {
  const runtimeFiles = await collectFiles(
    resolve(projectRoot, "src"),
    new Set([".ts", ".html", ".css"])
  );
  const sources = await Promise.all(
    runtimeFiles.map(async (path) => ({
      path: relative(projectRoot, path).split(sep).join("/"),
      text: await readFile(path, "utf8")
    }))
  );
  const runtime = sources.map(({ path, text }) => `\n/* ${path} */\n${text}`).join("\n");
  const updateClients = sources.filter(({ path }) => (
    path === "src/main/services/github-update-check.ts"
    || path === "src/main/services/github-update-download.ts"
  ));
  assert.equal(updateClients.length, 2);
  const nonUpdateRuntime = sources
    .filter(({ path }) => !updateClients.some((client) => client.path === path))
    .map(({ path, text }) => `\n/* ${path} */\n${text}`)
    .join("\n");
  const forbiddenQueueRoute = new RegExp(["/", "prompt", "\\b"].join(""), "u");

  for (const forbidden of [
    forbiddenQueueRoute,
    /\bWebSocket\b/u,
    /\baxios\b/iu,
    /electron-updater/iu,
    /\bautoUpdater\b/u,
    /import\s*\{[^}]*\bexec(?:File|Sync)?\b[^}]*\}\s*from\s*"node:child_process"/u,
    /shell\s*:\s*true/u,
    /submit[_-]?(?:graph|queue|job)/iu,
    /(?:run|queue)[_-]?(?:workflow|job)\s*\(/iu
  ]) {
    assert.doesNotMatch(runtime, forbidden);
  }

  for (const forbiddenNetwork of [
    /node:(?:http|https|http2|net|dns|dgram|tls|worker_threads)/u,
    /\bfetch\s*\(/u
  ]) {
    assert.doesNotMatch(nonUpdateRuntime, forbiddenNetwork);
  }
  for (const updateClient of updateClients) {
    assert.match(updateClient.text, /fetch\(request\.url/u);
    assert.doesNotMatch(updateClient.text, /authorization|bearer|cookie|credentials|chrome|electron-updater|autoUpdater/iu);
  }
  assert.match(updateClients.find(({ path }) => path.endsWith("github-update-check.ts"))?.text ?? "", /RELAY_UPDATE_SOURCE\.releasesApiUrl/u);
  const updateSource = sources.find(({ path }) => path === "src/shared/update-source.ts")?.text;
  assert.equal(typeof updateSource, "string");
  assert.match(updateSource, /https:\/\/api\.github\.com\/repos\/PlaTuring\/Relay\/releases\?per_page=20/u);
  assert.match(updateSource, /https:\/\/github\.com\/PlaTuring\/Relay\/releases/u);
  const mainEntry = sources.find(({ path }) => path === "src/main/main.ts")?.text;
  assert.equal(typeof mainEntry, "string");
  assert.equal((mainEntry.match(/shell\.openExternal\(/gu) ?? []).length, 2);
  assert.match(mainEntry, /openValidatedUpdateRelease: \(url\) => shell\.openExternal\(url\)/u);
  assert.match(mainEntry, /target === "author"[\s\S]*?RELAY_UPDATE_SOURCE\.authorProfileUrl[\s\S]*?RELAY_UPDATE_SOURCE\.repositoryPageUrl[\s\S]*?shell\.openExternal\(targetUrl\)/u);

  const childProcessUsers = sources
    .filter(({ text }) => text.includes('from "node:child_process"'))
    .map(({ path }) => path);
  assert.deepEqual(childProcessUsers, [
    "src/main/services/ab-cli-adapter.ts",
    "src/main/services/fixed-ffmpeg-poster.ts",
    "src/main/services/native-helper-client.ts"
  ]);
  const adapter = sources.find(({ path }) => path.endsWith("/ab-cli-adapter.ts"))?.text;
  assert.equal(typeof adapter, "string");
  assert.ok(adapter.includes("shell: false"));
  assert.doesNotMatch(adapter, /(?:request|input)\.(?:command|executable|args|arguments)/u);

  const posterRenderer = sources.find(({ path }) => path.endsWith("/fixed-ffmpeg-poster.ts"))?.text;
  assert.equal(typeof posterRenderer, "string");
  assert.ok(posterRenderer.includes("spawn(executable, Object.freeze(["));
  assert.ok(posterRenderer.includes("shell: false"));
  assert.ok(posterRenderer.includes("windowsHide: true"));
  assert.ok(posterRenderer.includes('stdio: ["ignore", "ignore", "pipe"]'));
  assert.doesNotMatch(posterRenderer, /(?:request|input)\.(?:command|executable|args|arguments)/u);

  const nativeHelper = sources.find(({ path }) => path.endsWith("/native-helper-client.ts"))?.text;
  assert.equal(typeof nativeHelper, "string");
  assert.ok(nativeHelper.includes('const PROFILE_ARGUMENT = "--capability-profile=path-inspection-v1"'));
  assert.ok(nativeHelper.includes('const helperPath = join(nativeDirectory, "relay-winbroker.exe")'));
  assert.ok(nativeHelper.includes("spawnSync(helperPath, [PROFILE_ARGUMENT]"));
  assert.ok(nativeHelper.includes('stdio: ["pipe", "pipe", "pipe"]'));
  assert.ok(nativeHelper.includes("shell: false"));
  assert.ok(nativeHelper.includes("windowsHide: true"));
  assert.doesNotMatch(
    nativeHelper,
    /(?:request|input)\.(?:command|executable|args|arguments|environment|workingDirectory)/u
  );

  const urls = runtime.match(/https?:\/\/[^\s"'`)<]+/gu) ?? [];
  const allowedUrls = new Set([
    "http://127.0.0.1:8188/",
    "https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE",
    "https://github.com/PlaTuring",
    "https://github.com/PlaTuring/Relay",
    "https://api.github.com/repos/PlaTuring/Relay/releases?per_page=20",
    "https://github.com/PlaTuring/Relay/releases",
    "http://*/*",
    "https://*/*"
  ]);
  for (const url of urls) {
    assert.ok(allowedUrls.has(url), `unexpected runtime URL: ${url}`);
  }
});

test("A3 install and visible ComfyUI handoff remain narrow and fail closed", async () => {
  const [adapter, services, registry, handoff, frameStaging] = await Promise.all([
    read("src/main/services/ab-cli-adapter.ts"),
    read("src/main/services/index.ts"),
    read("src/main/ipc-registry.ts"),
    read("src/main/services/comfy-handoff.ts"),
    read("src/main/services/frame-staging.ts")
  ]);
  for (const command of [
    "install-plan",
    "install-status",
    "install-cancel",
    "install-recover"
  ]) assert.ok(adapter.includes(`\"${command}\"`), `missing A3 command: ${command}`);
  for (const component of [
    "comfy-portable",
    "comfy-desktop",
    "ffmpeg-managed",
    "fl2va-base",
    "ref2va-addon",
    "fl2v-turbo",
    "ref2v-turbo"
  ]) assert.ok(adapter.includes(`\"${component}\"`), `missing A3 component: ${component}`);
  assert.ok(adapter.includes('includes("ffmpeg_long_video_optional")'));
  assert.ok(adapter.includes('values.push("ffmpeg-managed")'));
  assert.ok(adapter.includes('includes("comfyui_desktop_optional")'));
  assert.ok(adapter.includes('values.push("comfy-desktop")'));
  assert.doesNotMatch(adapter, /外部可见选配，不属于当前 A3 受管安装事务/u);
  assert.doesNotMatch(
    adapter,
    /id: "ref2va_optional"[\s\S]{0,500}state: comfy\.installations\.length/u,
    "ComfyUI discovery alone must never claim that Ref2VA weights were verified"
  );
  for (const mode of ["first_frame", "last_frame", "first_last_frame"]) {
    assert.ok(adapter.includes(`\"${mode}\"`), `missing single/both-frame compiler mode: ${mode}`);
  }
  assert.ok(frameStaging.includes("options.firstFrame === null && options.lastFrame === null"));
  assert.ok(frameStaging.includes("options.firstFrame === null\n    ? null"));
  assert.ok(frameStaging.includes("options.lastFrame === null\n    ? null"));
  for (const acknowledgement of [
    "licenseAccepted: true",
    "territoryAcknowledged: true",
    "commercialAcknowledged: true",
    "downloadConsent: true"
  ]) assert.ok(adapter.includes(acknowledgement), `missing A3 gate: ${acknowledgement}`);
  assert.ok(adapter.includes('profile === "experimental_16gb_class"'));
  assert.ok(adapter.includes('"--async-offload"'));
  assert.ok(adapter.includes("createExternalPortableLaunchPlan"));
  assert.ok(adapter.includes('"--disable-all-custom-nodes"'));
  assert.doesNotMatch(registry, /licenseAcknowledged|regionAndCommercialConfirmed|downloadConsent/u);
  assert.ok(services.includes("completedInstallationId === null"));
  assert.ok(handoff.includes("contextIsolation: true"));
  assert.ok(handoff.includes("sandbox: true"));
  assert.ok(handoff.includes("nodeIntegration: false"));
  assert.ok(handoff.includes("comfyApp.loadGraphData(workflow, true, true"));
  assert.ok(handoff.includes("return enqueueHandoff(async () => {"));
  assert.ok(handoff.indexOf("await showWorkflowInComfyWindowExclusive(options)") < handoff.indexOf("await options.onTimingEvidence(evidence)"));
  assert.ok(handoff.includes('parsed.hostname === "127.0.0.1"'));
  assert.doesNotMatch(`${adapter}\n${services}\n${handoff}`, /queuePrompt|submitQueue/iu);
});

test("Windows Unicode and space fixture survives the product flow unchanged", async () => {
  const fixture = JSON.parse(
    await read("tests/fixtures/路径 含空格 Ω/product-flow.json")
  );
  assert.deepEqual(fixture, {
    expected_state: "workflow_handoff_ready",
    label: "Windows Unicode and space fixture Ω"
  });
});
