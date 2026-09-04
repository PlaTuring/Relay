# P0-ARC-002 — Electron/TypeScript 有界技术栈 Spike

> **状态：** PASS（候选栈技术验证通过，不代表最终选型）  
> **日期：** 2026-08-27  
> **允许范围：** `prototypes/phase0/stack-electron/**`、本文件  
> **产品边界：** 仅控制平面技术验证；无 ComfyUI/H3/GPU/云 API、无生成或正式 Queue 能力

## 1. 结论

Electron + TypeScript 能构建满足 Phase 0 控制平面最低边界的 Windows x64 原型：真实 packaged renderer 以 `contextIsolation=true`、`sandbox=true`、`nodeIntegration=false` 运行；main world 中 `require` 和 `process` 均为 `undefined`；bundled preload 只暴露四个 request/response IPC；无害 owned direct child 能以参数数组传递空格/Unicode，并在返回前终止；Windows 路径策略不静默回退 C；可生成 assisted NSIS installer。

本 spike **不选择 Electron 为最终栈**。其最大负担同样被实测确认：只有约 28 KiB 的应用 asar，却产生约 365.90 MiB unpacked 包、95.18 MiB installer 和约 527.50 MiB 本地 Node toolchain；锁文件/SBOM 面包含数百个构建依赖。Tauri 与 .NET 必须用同一测量矩阵比较后，才能进入技术栈 ADR。

## 2. 边界与未执行事项

本任务没有：

- 下载、安装、探测或启动 ComfyUI/Desktop；
- 下载模型、调用 H3、申请 GPU lock 或生成媒体；
- 调用云/Partner API、`/prompt` 或任何推理 endpoint；
- 运行生成的 NSIS installer、写注册表、服务、计划任务或系统环境变量；
- 修改仓库根 `package.json`、lockfile、registry、schema、主计划或其他共享合同；
- 实现应用自更新、签名、模型目录扫描或真实 runtime launcher。

网络下载仅限该原型的锁定 npm 工具链、Electron 44.0.0 runtime 和 electron-builder 的 NSIS/7zip 构建工具。npm/Electron/electron-builder cache 被定向到原型子目录。NSIS build 会使用 Windows临时目录创建瞬时中间文件，但没有安装或系统配置行为。

## 3. 测试主机与锁定版本

| 项 | 实测值 |
|---|---|
| Windows | `10.0.26200.0`，build `26200`，AMD64 |
| Node.js | `v24.19.0` |
| npm | `11.17.0` |
| Electron | `44.0.0` |
| electron-builder | `26.15.3` |
| TypeScript | `7.0.2` |
| esbuild | `0.28.2`，仅用于 sandboxed preload bundling |
| Vitest | `4.1.11` |
| `@types/node` | `26.4.0` |
| Prototype lock | `package-lock.json` v3；SHA-256 `AAC7E6A4F2E13B070E6383648FA487FE0C9E98542D5CDC713365A59403D34805` |

所有六个 direct dev dependency 都在原型 `package.json` 中使用精确版本；没有 runtime npm dependency。

## 4. 最小架构

```text
Renderer main world
  semantic local HTML/CSS
  no Node, require, process, webview, remote content
          |
          | frozen contextBridge API: 4 invoke methods
          v
Bundled sandboxed preload
          |
          | exact channel + exact file:// sender URL
          v
Electron main process
  path picker / path shape policy
  security summary
  fixed harmless child probe
  renderer network and permission deny policy
```

### 4.1 Renderer 隔离

`BrowserWindow` 固定：

```text
contextIsolation=true
sandbox=true
nodeIntegration=false
nodeIntegrationInWorker=false
nodeIntegrationInSubFrames=false
webviewTag=false
webSecurity=true
allowRunningInsecureContent=false
```

其他措施：

- preload 由 esbuild 打成单文件，只把 `electron` 保持 external，适配 sandboxed preload 不能任意 require 本地模块的约束；
- CSP 为 `default-src 'self'`、`connect-src 'none'`、无 `unsafe-inline/unsafe-eval`；
- renderer 的 `http/https/ws/wss` request 在 session 层取消；所有 permission check/request 拒绝；
- `window.open` 拒绝，非当前 renderer URL 的 navigation 阻止；
- DOM 只使用 `textContent`，没有 `innerHTML`、remote image/script 或 `fetch`。

注意：session webRequest 规则只证明 renderer 面被阻断；它不是整个进程树的零 egress 证明。正式产品仍需 managed process-tree 抓包与 OS 级测试。

### 4.2 IPC allowlist

唯一四个 channel：

```text
security:get-summary
managed-root:choose
managed-root:inspect
owned-child:run-probe
```

- preload 不暴露通用 `send/invoke/on`；
- main handler 要求 `event.senderFrame.url` 精确匹配本地 renderer URL；
- path input 先检查类型、长度和 NUL，再执行 local Windows drive shape policy；
- renderer 无法提供 child executable、script、cwd、environment 或 args；child probe 所有值由 main 固定。

真实 packaged renderer probe：

```json
{
  "contextIsolation": true,
  "sandbox": true,
  "nodeIntegration": false,
  "preloadApiReady": true,
  "rendererRequireType": "undefined",
  "rendererProcessType": "undefined",
  "ipcChannelCount": 4,
  "childReady": true,
  "childTerminated": true
}
```

## 5. Owned child 验证

探针使用 `spawn(executable, args[], { shell:false, detached:false, windowsHide:true })`。身份由随机 token 同时放入参数与受限环境，child 的首条 JSON ready 事件必须匹配 token、label 和 PID；owner 随后终止并等待 `exit`，超时才升级强制终止。

证据：

- 单测连续 5 次传递 `路径 含空格 Ω #N`，5/5 ready 且 5/5 terminated；
- Electron dev runtime probe 通过；
- `win-unpacked` packaged probe 退出码 0，ready/terminated 均为 true；
- 打包验证首次捕获到 child `cwd` 指向 `app.asar` 虚拟目录而导致 Windows `CreateProcess ENOENT`；改为固定 executable 的真实目录后，packaged probe 通过。这证明只跑 Node 单测不足以验收 packaged child。

限制：当前只证明**一个直接无害 child**。测试通过 `ELECTRON_RUN_AS_NODE=1` 运行固定 JS fixture，仅属于 spike harness；正式产品不得把它当作 managed Comfy launcher。生产 launcher 需要锁定 Python/runtime executable、Windows Job Object、grandchild/process-tree终止、崩溃清理、PID重用和权限边界测试。Electron fuse 是否关闭 RunAsNode 也必须在发布策略中明确。

## 6. Windows 路径与 managed root

### 已证明

- `D:\MiniMax H3\模型 Ω` 保留空格、中文和 `Ω`；不会经过 shell 拼接；
- relative、UNC 和 device namespace path 在这个有界策略中 fail closed；
- D 不存在时建议值为 `null`，不会改写成 C；
- 用户显式选择 C 时保留路径但显示大文件警告；
- UI 始终显示建议路径、当前选择和警告；path picker 使用 Electron 原生 open-directory dialog 且不写所选目录；
- 当前主机只读检查显示 D 为 fixed NTFS，容量 `644245090304` bytes，剩余 `452159901696` bytes。该事实只属于当前主机，不是产品支持声明。

### 未证明

原型只实现路径形态与可见性，没有在应用内证明 volume 是 fixed NTFS、free-space峰值、reparse point、权限、长路径、大小写、断盘或运行中卸载。真实 Windows volume/space probe 应使用原生 API/已批准 helper，并在对应 runtime/disk 任务验收。

## 7. Per-user 包、签名与更新

electron-builder 当前配置：

```text
target=NSIS x64
oneClick=false
perMachine=false
allowElevation=false
allowToChangeInstallationDirectory=true
createDesktopShortcut=true (Relay Alpha.20 production delta; earlier prototypes used false)
runAfterFinish=true (assisted 完成页显示可取消的“运行 Relay”选项)
differentialPackage=false
```

这产生 assisted installer，默认面向 current user，且不主动提权。交互式完成页允许用户选择是否立即启动 Relay；该选择只启动 Relay 应用，不启动 ComfyUI、不提交队列，静默安装也不会通过完成页无条件启动。`oneClick=false + perMachine=false` 的实际 install-mode页面、路径、upgrade/uninstall和非管理员行为尚未在干净 VM 运行，因此这里只能称为**已构建的 per-user-first 策略**，不能称为发布认证。若产品要求绝对禁止 per-machine选项，需要定制 NSIS或选择另一种配置并单独测试。

Alpha 更新边界：

- 无 `electron-updater` dependency；
- 无 `publish` channel、update service 或更新 IPC；
- `differentialPackage=false`；最终 `release-alpha` 中 `.blockmap` 数量为 0；
- Alpha 只能通过下一份完整签名安装包人工升级，自动更新另开 gate。

签名边界：

- 为避免伪装发布物，spike 设置 `signAndEditExecutable=false`；
- 最终 installer 的 `Get-AuthenticodeSignature` 为 `NotSigned`；
- electron-builder 日志中的“signing with signtool.exe”步骤不能替代 Authenticode 结果；
- 外测前需要组织 publisher、证书、RFC3161时间戳、私钥托管、installer/uninstaller/helper覆盖和验签证据。

本任务没有运行 installer。最终安装/卸载、注册表、Start Menu、升级和残留必须在 `WIN-VM` 资源任务中验证。

## 8. C 盘预算与体积

| Artifact | Bytes | 约合 | 结论 |
|---|---:|---:|---|
| 编译后 `dist/` | 25,197 | 24.61 KiB | 业务原型本身很小 |
| packaged `app.asar` | 28,640 | 27.97 KiB | 仅包含 dist 和 package.json |
| `win-unpacked/` | 383,675,170 | 365.90 MiB | Electron/Chromium 固定开销显著 |
| NSIS installer | 99,807,898 | 95.18 MiB | 未签名、x64、无blockmap |
| 开发 `node_modules/` | 553,127,900 | 527.50 MiB | 构建供应链与CI缓存成本较高 |
| `package-lock.json` | 192,079 | 187.58 KiB | 原型独立 lock |
| CycloneDX SBOM | 375,176 | 366.38 KiB | 384 components |
| 单次 packaged self-test profile | 2,420,384 | 2.31 MiB | 首次 Chromium/profile开销，仅一次短测 |

Installer SHA-256：

```text
E64D5532BF071BC8FDF037C2F26318318C53355676856AB3B8973CB3841108A3
```

默认 per-user app 安装若接受 Windows默认位置，约 365.90 MiB unpacked runtime 可能位于 C；这必须进入 C 盘预算并在安装摘要显示。它与大文件 managed root 是两件事：模型、runtime、cache、temp media 和 output 仍不得静默落 C，并应放在用户明确看到的 D/其他合格 fixed NTFS root。Electron profile/cache也需配置上限；本原型设置 10 MiB disk cache 和 0 media cache，但长期日志/session增长尚未测试。

## 9. 可访问性

已实现和静态测试：

- `zh-CN`、语义 `main/header/section/h1/h2/button/dl/output`；
- 所有动作使用原生 button，44 px最小高度，`:focus-visible`高对比轮廓；
- 状态与路径变化使用 `aria-live=polite`，没有仅依赖颜色的完成信息；
- 窄窗口响应式布局和 `prefers-reduced-motion`处理；
- 没有 canvas-only UI 或坐标自动化。

未完成：键盘全流程人工测试、Narrator/屏幕阅读器、Windows高对比/200%缩放、焦点恢复、错误摘要和 axe/WCAG自动扫描。因此“具备可访问性基础”已证实，“满足某个 WCAG等级”未证实。

## 10. 依赖锁与 SBOM

| 检查 | 结果 |
|---|---|
| npm audit | total/critical/high/moderate/low/info 全为 0（2026-08-27快照） |
| lockfile | v3，400 package entries，399 integrity entries |
| direct deps | 6 个，全部 exact version；0 runtime npm deps |
| CycloneDX | 384 components，生成于 `artifacts/sbom.cdx.json` |
| asar内容 | 仅 `dist/**` 与 `package.json`；无测试、lock、SBOM、source map或node_modules |

`npm audit=0` 不是安全证明。安装时仍出现 `boolean@3.2.0`、`rimraf@2.6.3`、`inflight@1.0.6`、`glob@7.2.3` 的传递依赖弃用警告；npm 11 还报告 esbuild/electron-winstaller install-script审批面。Electron binary postinstall 因当前审批策略未自动执行，本任务只显式运行锁定 `electron@44.0.0` 的官方 install script，未批准其他脚本。

现有 CycloneDX来自 npm lock，只覆盖 npm组件；它不完整覆盖 Electron ZIP、Chromium内部件、NSIS、7zip、Windows SDK/signtool或未来native helper。生产供应链还必须：

1. 把下载的 Electron/NSIS/7zip URL、版本、hash与许可写入artifact manifest；
2. 生成 packaged runtime SBOM，而不是只交 build-tool SBOM；
3. 记录所有 install/postinstall脚本是否允许及其执行证据；
4. 固定构建容器/主机和npm版本，执行可复现性与二次hash比较；
5. 把 Chromium/Electron安全更新节奏与“Alpha无应用内自更新”分开处理。

`release-alpha/builder-debug.yml` 包含用户名、仓库与临时目录绝对路径，只能留在本地 evidence/build目录，禁止和 installer、支持包或公开release一起分发。

Public-evidence hygiene 由 `npm run lint:public-evidence` 强制：扫描本报告、prototype README/文本源码、直接 `artifacts` 证据与 CycloneDX SBOM；排除 `.gitignore` 明确禁止提交的 `node_modules/dist/release/release-alpha/.npm-cache/.cache` 和私有运行 profile。lint 会拒绝 `X:\Users\<account>\...`、当前账户名及其 JSON/file-URL变体，失败时只报告仓库相对文件和行号，不回显敏感内容。SBOM生成器的成功 stdout 只输出 `artifacts/sbom.cdx.json`，不输出主机绝对路径。

独立 `git check-ignore` 回归对 `node_modules`、`dist`、`release`、`release-alpha`、`.npm-cache`、`.cache` 六类候选路径为 6/6 ignored；lint同时要求这六条规则继续存在，防止后续误提交大包、cache或带路径的builder日志。

Vitest/Vite、npm和electron-builder是第三方工具，原始stdout可能自行打印绝对cwd或临时路径；其 raw stdout 只能作为本地临时诊断，**禁止保存、提交或发布为证据**。公开报告只能记录计数、状态、hash和经过上述lint的摘要。自有 `run-electron-smoke` 与 SBOM/lint脚本的成功输出均为无绝对路径的固定JSON；自测失败时也不回显child原始stdout/stderr。

## 11. 构建与验收命令

在 `prototypes/phase0/stack-electron` 中：

```powershell
$repoRoot = (Resolve-Path '..\..\..').Path
$proto = Join-Path $repoRoot 'prototypes\phase0\stack-electron'
$env:npm_config_cache = Join-Path $proto '.npm-cache'
$env:ELECTRON_CACHE = Join-Path $proto '.cache\electron'
$env:ELECTRON_BUILDER_CACHE = Join-Path $proto '.cache\electron-builder'

npm ci
if (-not (Test-Path (Join-Path $proto 'node_modules\electron\dist\electron.exe'))) {
  node .\node_modules\electron\install.js
}
npm run verify

$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
npm run dist:win
npm audit --json
Get-AuthenticodeSignature .\release-alpha\MiniMaxH3-ControlPlane-Spike-0.0.1-x64-setup.exe
```

`npm run verify` 依次执行：

- 两套 TypeScript strict typecheck；
- build + Vitest；
- 实际 Electron hidden self-test；
- CycloneDX SBOM生成；
- public-evidence/path lint。

最终结果：

```text
TypeScript typecheck: PASS
Test files: 6 passed
Tests: 17 passed
Owned child repeated unit attempts: 5/5
Electron dev self-test: PASS
win-unpacked packaged self-test: exit 0 / PASS
npm audit: 0 vulnerabilities
NSIS x64 build: PASS
Authenticode: NotSigned（预期的发布阻断状态）
Public-evidence/path lint: PASS（30 files）
```

### 11.1 两次离线模式复跑

在依赖和 Electron runtime 已按lock安装后，连续两次使用以下约束执行完整 `npm run verify`：

```powershell
$env:npm_config_offline = 'true'
$env:npm_config_audit = 'false'
$env:npm_config_fund = 'false'
$env:HTTP_PROXY = 'http://127.0.0.1:9'
$env:HTTPS_PROXY = 'http://127.0.0.1:9'
$env:ALL_PROXY = 'http://127.0.0.1:9'
$env:NO_PROXY = ''
npm run verify
```

为遵守证据卫生，第三方raw stdout只在PowerShell内存中匹配验收信号，没有写盘或复制进报告。结果：

| 离线复跑 | Exit | Typecheck | 6 files / 17 tests | Electron self-test | SBOM相对stdout | Public path lint |
|---|---:|---|---|---|---|---|
| Run 1 | 0 | PASS | PASS | PASS | PASS | PASS |
| Run 2 | 0 | PASS | PASS | PASS | PASS | PASS |

这证明当前锁定依赖、已下载Electron runtime、build、测试、hidden Electron自测、SBOM和path lint可以在npm offline模式与不可用代理下重复完成。它不等于OS网卡物理断开或全进程树pcap零egress认证；后者仍属于正式managed runtime安全验收。

### 11.2 打包联网性分级

为避免把“离线验证”误写成“离线可打包”，本次证据分为三类：

| 能力 | 状态 | 证据与限制 |
|---|---|---|
| Offline verify | **PROVEN** | 两次 `npm run verify` 均在 npm offline 模式与不可用代理下 Exit 0，覆盖 typecheck、17项测试、hidden Electron自测、SBOM和public-path lint |
| Offline package | **BLOCKED / 未认证** | 同样约束下执行 `npm run dist:win` 时，electron-builder仍尝试获取未命中本地缓存的构件并因不可用代理失败；因此不得声称NSIS可离线或可复现重建 |
| Online pinned spike package | **PROVEN** | 在不改 `package-lock.json`、不新增依赖、不启用updater/签名的前提下，受限联网完成一次NSIS重打包；新installer SHA-256见§8，随后`win-unpacked` self-test Exit 0，Authenticode为`NotSigned`，blockmap为0 |

这只证明当前锁定npm依赖对应的 **spike产物** 可在线构建。发布流水线仍需把Electron/NSIS/7zip等非npm构件做版本、URL与hash manifest，并预热受控artifact cache；在该门关闭前，离线/隔离构建与可复现构建均保持未认证。

## 12. 优点、缺点与待比较项

### Electron 候选的实测优点

- TypeScript可同时表达 UI、IPC contract和控制平面逻辑，strict typecheck与单测反馈快；
- sandbox、context isolation、preload和session策略能形成明确的可测试边界；
- bundled Chromium减少Windows WebView版本差异，中文/Unicode/响应式 UI容易实现；
- electron-builder能产出 assisted NSIS，路径选择与per-user-first策略配置直接；
- packaged self-test容易自动化，且本次确实捕获到Node测试无法发现的asar路径问题。

### Electron 候选的实测成本/风险

- 约365.90 MiB unpacked、95.18 MiB installer，对“轻量安装器”明显偏大；
- build toolchain 约527.50 MiB、数百SBOM组件，供应链和安全补丁面较宽；
- Chromium/profile/cache会占用额外 C 盘预算；
- Windows volume、reparse point、Job Object、签名和installer细节仍需native helper/专门测试；
- CSP/session隔离不能代替主进程与child的零egress证明；
- Web accessibility基础良好，但Narrator/高对比/原生对话框焦点仍需Windows实测；
- Electron/Chromium需要频繁安全升级，而Alpha不能依赖内置自动更新，必须有安全发布SLA。

### 与 Tauri/.NET 使用同一夹具比较

| 比较维度 | Electron本次基线 | Tauri待测 | .NET待测 |
|---|---|---|---|
| installer / unpacked体积 | 95.18 / 365.90 MiB | 相同空壳功能测量；明确WebView2依赖 | framework-dependent与self-contained都测 |
| 构建依赖/SBOM | 6 direct；384 SBOM components | Rust crates、WebView2、bundler/toolchain | NuGet、Windows App SDK/运行时、打包工具 |
| renderer/UI隔离 | sandbox/contextBridge/4 IPC已证实 | invoke allowlist、CSP、WebView权限 | UI与service边界、COM/PInvoke权限 |
| owned process | direct child已证实；Job Object未证实 | Rust Job Object/process tree | .NET Job Object/PInvoke/process tree |
| Windows路径/volume | Unicode shape通过；volume native probe缺失 | Win32/Rust volume API成本 | .NET/Win32 volume API成本 |
| per-user installer | NSIS可构建；VM行为未证实 | MSI/NSIS/burn方案 | MSIX/MSI/自包含方案 |
| 签名 | artifact未签名；外部门禁 | EXE/MSI/helper覆盖 | EXE/MSIX/MSI/helper覆盖 |
| 启动/内存 | 未测，加入统一冷/热启动和idle working set夹具 | 同夹具 | 同夹具 |
| 可访问性 | 静态Web基础；Windows人工测试缺失 | WebView同类测试 | WPF/WinUI/native控件测试 |
| 更新策略 | Alpha无更新；安全版本需手工签名发布 | 同一Alpha规则 | 同一Alpha规则 |
| 开发效率 | strict TS + Web UI 快 | Rust边界与双语言成本 | Windows专用栈与原生API优势 |

三者必须在同一主机、相同按钮/路径/child/self-test功能、相同签名状态下比较；不能用各自示例项目或官方宣传数字替代。

## 13. 证据等级与开放项

### Proven（限当前主机与锁定版本）

- TypeScript build/typecheck、17项测试、Electron dev运行和packaged运行；
- packaged renderer隔离值、preload API、4-channel IPC、direct child启动/参数/终止；
- Unicode/空格路径shape、无静默 C fallback、C警告；
- x64 assisted NSIS可构建、artifact大小/hash、无blockmap、NotSigned；
- lock/SBOM/audit快照和asar内容。

### Inferred / configuration-only

- per-user-first installer策略：配置与build已证实，真实非管理员安装/升级/卸载尚未运行；
- managed-root chooser的视觉和键盘体验：代码/语义已存在，未人工操作对话框；
- 长期 C 盘profile/log上限：短自测约2.31 MiB，不代表长期使用。

### Blocked / 后续任务

- 真实签名与publisher：`EXT-SIGNING`；
- install/upgrade/uninstall与残留：需要`WIN-VM`；
- production Job Object/native helper和进程树清理：后续process ownership任务；
- fixed NTFS、free space、reparse point与权限：后续disk/runtime probe；
- Narrator、高对比、200%缩放、全键盘：Windows accessibility验收；
- ARM64、多语言、企业策略/杀软、SmartScreen：发布矩阵；
- packaged runtime完整SBOM、Electron/NSIS binary hash manifest和安全更新SLA；
- 与 Tauri/.NET 的相同夹具结果及最终 `P0-ARC-005` ADR。

## 14. 选型建议边界

本 spike 的结论是“Electron 技术上可行”，不是“Electron 应被选择”。若团队最看重统一 TypeScript、复杂Web UI迭代和固定Chromium，Electron有明显生产力优势；若工具应保持很小、Windows原生集成/Job Object/安装器权重更高，其365.90 MiB unpacked和供应链面可能成为否决因素。最终决策必须等待 Tauri 和 .NET 的同夹具证据。
