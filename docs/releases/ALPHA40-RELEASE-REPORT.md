# Relay 0.1.0-alpha.40 完整交付报告

> **历史内部证据**：本文记录 Alpha 40 候选的当时状态、资产和验证结果，不是 Relay 1.0 的发布证据或当前公开说明。当前正式发布说明见 [`relay-1.0-release-notes.md`](relay-1.0-release-notes.md)。

日期：2026-09-01

## 结论

Alpha 40 的源码、离线功能测试、类型检查和未启动成品的 R4 静态校验已完成。最终 R4 候选目录严格只有 Setup、Portable 和 `SHA256SUMS.txt` 三个文件。

本轮遵守用户的运行中任务保护要求：没有关闭、重启、附加或控制正在运行的旧版 Relay/ComfyUI，没有启动 Setup、Portable 或打包后的 Relay，没有使用 Computer Use，也没有点击 Run、调用 `/prompt`、提交 ComfyUI 队列或生成媒体。因此安装、快捷方式、便携版启动、卸载、真实 ComfyUI 交接和桌面截图由用户在隔离环境中核查，本报告不把这些项目标记为通过。

用户随后明确授权仅使用已登录 Chrome 管理 GitHub。已确认账号为 `PlaTuring` 并拥有仓库 Settings 权限，公开仓库已从 `PlaTuring/noess3` 成功重命名为 `PlaTuring/Relay`。仓库描述、Topics、产品 README 以及 Alpha 40 Pre-release 表单已准备完成；公开保存、提交与发布仍需在最终动作前确认后执行。

## 最终成品

冻结发布目录：`apps/control-plane/release-alpha40-r4/`

原 `apps/control-plane/release-alpha40/` 被用户当前运行中的旧候选文件占用，按用户要求没有枚举、关闭或强制替换任何进程，因此该 canonical 目录仍保留 R3。公开上传必须且只能使用 R4 目录中的三个文件。

| 文件 | 字节长度 | SHA-256 |
|---|---:|---|
| `Relay-0.1.0-alpha.40-x64-Setup.exe` | 100,914,652 | `db59fa75edd6508aa21167ca41b5b03775f0b54ba6d1b0d230a9211dfb6bd1fe` |
| `Relay-0.1.0-alpha.40-x64-Portable.exe` | 100,506,997 | `91b77b19cc6cf9bad352c95373fbc3d4ed5af4415213e4313a291d84b082646d` |
| `SHA256SUMS.txt` | 205 | 严格两行 `<sha256> *<filename>`，UTF-8 无 BOM、仅 LF |

最终成品与重新构建的 staging 文件长度和 SHA-256 完全一致。静态 `Get-AuthenticodeSignature` 结果均为 `NotSigned`，无 signer/timestamper；这与 About、README 和 Release 文案中的“测试预览版 · 未签名”一致。SHA-256 只证明传输完整性，不证明发布者身份。

## 已生成视频

- 导航顺序固定为：项目、快速创建、专业导播、素材库、已生成视频、画质超分、关于。
- “画质超分”显示明确的“功能规划中”空状态和边界说明，没有按钮、表单、执行入口或伪功能。
- “已生成视频”导航标签受 53px 按钮与 `3em` 文字宽度约束，按 3+2 字安全换行；常规与窄窗均不会横向越界。
- 编译前预分配 `workflowId`，并在权威工作流计算身份哈希和交接之前写入 `SaveVideo` 前缀。
- 输出前缀固定为 `video/Relay/p_<项目短哈希>/w_<工作流短哈希>/Relay_H3`，不包含项目名、提示词或私有路径。
- T2V、FL2VA、Ref2VA 和分段工作流使用相同归属合同。
- 自动扫描只访问当前项目、已登记工作流的精确输出子目录；拒绝越界、重解析点和未知前缀。
- 文件必须经过至少两次、间隔不少于 1.5 秒的大小与修改时间稳定检查，然后通过 magic bytes、流式 SHA-256 和可用时的 ffprobe 检查。
- 无 FFmpeg 时准确显示无法生成封面/技术信息未检查，不生成假预览。
- Renderer 只能提交 `projectId/resultId`，不能提交路径。
- 用户明确点击“加入素材库”后才复制并校验项目副本，原始 ComfyUI 输出不变。
- 本机结果索引写入项目 `recovery/generated-videos.v1.json`；项目复制和 `.relayproj` 均排除该索引及生成结果封面缓存，普通恢复数据和普通缩略图仍保留。
- 崩溃遗留的结果索引/封面 `.tmp` 也在复制和项目包扫描之前排除，避免其中的本机路径或缓存进入副本；普通 recovery/thumbnail 临时文件不会被误删。

## Alpha Pre-release 更新通道

- `sourceId=github-releases:PlaTuring/Relay:alpha`。
- 匿名读取 `https://api.github.com/repos/PlaTuring/Relay/releases?per_page=20`。
- 只接受 `draft=false`、`prerelease=true`、严格 `0.1.0-alpha.N`。
- 先选择最高合格版本，再校验精确三项资产；最高版本不完整时返回 `release_incomplete`，不降级到旧版。
- 主进程独占 URL、下载和本机路径权限；Renderer 只看到受限元数据和下载状态。
- 下载写入 `<dataRoot>/downloads/updates/<version>/`，使用同目录 `.partial`、真实字节进度、API/HTTP 长度、严格 SHA 清单、流式 SHA-256 和原子发布。
- 取消、断网、短/长响应、危险重定向、长度或哈希不符均失败并删除临时文件。
- 下载完成只可打开所在目录或发布页，绝不执行 EXE。
- 缓存升级为 v2；旧 sourceId 缓存被忽略，失败不覆盖有效缓存。

## 测试结果

### 专项回归

命令：

```text
node --test tests/alpha40-update-download.test.mjs tests/alpha40-update-channel.test.mjs tests/alpha40-generated-video-service.test.mjs tests/alpha40-ui-contract.test.mjs tests/a40-integration-bundle-exclusion.test.mjs
```

结果：22/22 通过。

该轮首次运行发现“超长响应”失败状态可能先于 `.partial` 删除被观察到。已在 `github-update-download.ts` 中改为先完成临时文件清理，再发布终态；回归随后 22/22 通过。

### 全量与类型检查

- `npm --prefix apps/control-plane test`：405 项，404 通过、1 项跳过、0 失败。跳过项是需要公开 `PlaTuring/Relay` Release 的匿名网络检查。
- `npm --prefix apps/control-plane run typecheck`：3/3 通过。
- 本轮 R4 Alpha 40 专项：20/20 通过；本轮 UI 契约复核：22/22 通过。
- 编译器打包门禁：12/12 通过。
- Alpha 40 集成/更新/产品契约独立审计：37/37 通过。
- `.relayproj` 与项目复制结果隔离：2/2 通过。
- 冻结源码输入清单：309/309；打包输入：192/192；额外资源：129/129。

全量测试证明产品代码没有 `/prompt` HTTP 调用、Run/队列提交、自动更新执行、通用命令执行或媒体生成入口。测试中的 ComfyUI/窗口行为由内存夹具完成，不是对用户当前进程的操作。

## 静态打包证据

- Electron 应用版本：`0.1.0-alpha.40`。
- Windows 文件版本：`0.1.0-alpha.40`；产品名 `Relay`；公司名 `PlaTuring`。
- x64 NSIS + Portable；`publish: null`，构建命令额外使用 `--publish never`。
- NSIS `runAfterFinish=false`，构建过程没有启动成品。
- `app.asar` 含主进程、Renderer、Preload 与共享合同。
- unpacked native 资源含匹配的 `capability-profile.v1.json` 与 `relay-winbroker.exe`。
- R4 安装包、便携版与 `release-alpha40-staging-r4` 暂存原件的长度和 SHA-256 完全一致。
- R4 ASAR 中 64/64 个 `dist` 载荷与冻结工作区一致；画质超分规划状态及其无控件边界已在包内核验。

## 主要实现文件

- `apps/control-plane/src/shared/update-source.ts`
- `apps/control-plane/src/main/services/github-update-check.ts`
- `apps/control-plane/src/main/services/github-update-download.ts`
- `apps/control-plane/src/main/services/generated-video-service.ts`
- `apps/control-plane/src/main/services/generated-video-inspection.ts`
- `apps/control-plane/src/main/services/index.ts`
- `apps/control-plane/src/main/services/relay-project-bundle.ts`
- `apps/control-plane/src/main/services/project-repository.ts`
- `apps/control-plane/src/preload/index.ts`
- `apps/control-plane/src/renderer/index.html`
- `apps/control-plane/src/renderer/index.ts`
- `apps/control-plane/src/renderer/styles.css`
- `packages/workflow/h3-compiler/src/output-attribution.mjs`
- `apps/control-plane/tests/alpha40-generated-video-service.test.mjs`
- `apps/control-plane/tests/alpha40-update-channel.test.mjs`
- `apps/control-plane/tests/alpha40-update-download.test.mjs`
- `apps/control-plane/tests/alpha40-ui-contract.test.mjs`
- `apps/control-plane/tests/a40-integration-bundle-exclusion.test.mjs`
- `docs/adr/ADR-014-user-initiated-prerelease-download-channel.md`
- `docs/releases/alpha40-release-notes.md`

## 用户隔离验收清单

以下项目没有在本轮自动执行，应由用户在不影响当前 H3 任务的隔离环境中验证：

1. Setup 安装、桌面/开始菜单快捷方式和卸载。
2. Portable 启动。
3. 浅色/深色、窄窗和 Windows DPI 实机截图。
4. T2V、FL2VA、Ref2VA 的真实 ComfyUI 交接，以及交接前后队列为空。
5. 用户在 ComfyUI 手动点击 Run 后，当前项目“已生成视频”的自动发现、播放、显示目录和加入素材库。
6. Alpha 40 Pre-release 发布后，Alpha 39/40 的公开更新检查与下载。

## 发布状态

- 本地源码与静态成品候选：通过。
- 公开仓库：已重命名为 `PlaTuring/Relay`；公开项目介绍与 Pre-release 内容已在 Chrome 中准备，尚未执行最终保存/提交/发布动作。
- Authenticode：未签名，属于已明确披露的证书限制。
- 最终判定：**R4 本地候选通过静态发布门禁，可供用户隔离实机验收；在 Pre-release 最终发布及用户实机验收完成前，不宣称已经公开发布或完整生产可用。**
