# Relay

Relay 是柏拉图灵（PlaTuring）开发的 Windows 本地生产力工具，用于准备 MiniMax H3 / ComfyUI 环境、管理项目与素材、确定性编译可编辑工作流，并把工作流交接到 ComfyUI。

Relay **不会点击 Run、不会调用 `/prompt`、不会提交 ComfyUI 队列，也不会替用户生成视频或音频**。只有用户在 ComfyUI 中检查工作流并亲自点击 Run 后，MiniMax H3 才会生成视频与原生音频。

## Relay 1.0

当前正式版本为 Relay 1.0，支持 Windows 10 / 11 x64。内部版本号为 `1.0.0`，界面显示 `1.0`，GitHub Release 标签为 `v1.0.0`。参见 [Relay 1.0 发布说明](https://github.com/PlaTuring/Relay/releases/tag/v1.0.0)。

### 安装与安全

Relay 1.0 当前未使用 Authenticode 代码签名。Windows SmartScreen 可能在首次运行时显示“未知发布者”或阻止运行。请只从 `PlaTuring/Relay` 的官方 GitHub Release 下载，并确认文件名为 `Relay-1.0-x64-Setup.exe`。

应用内下载会核对 GitHub Release 提供的资产长度和 SHA-256 摘要。SHA-256 只用于确认文件完整性，不能证明发布者身份，也不能替代 Authenticode。Relay 不会后台检查、不会静默下载，也绝不会自动运行下载的安装程序。

## 主要模块

- **项目**：新建、打开、复制、安全删除和恢复本地项目。
- **快速创建**：以最少参数编译 T2V、FL2VA 或 Ref2VA 工作流。
- **专业导播**：管理场景、镜头、素材关系、连续性、种子与分段工作流。
- **素材库**：显式导入本地图片、视频和音频，默认复制到项目；不会上传云端或修改源文件。
- **已生成视频**：在当前项目已经交接的有界 ComfyUI 输出目录中发现已完成写盘的视频；也可由用户手动补录旧输出。视频仍由 ComfyUI 中的 MiniMax H3 生成，不由 Relay 生成。
- **画质超分（功能规划中）**：当前仅展示明确的规划状态，不提供按钮或伪功能。
- **安装与组件**：检测并复用现有 ComfyUI / 模型，或在用户选定的数据目录中安装缺失组件。

## 本地数据与隐私

首次设置时，Relay 会建议使用受支持的本机固定 NTFS 数据盘，例如 `D:\MiniMaxH3`；用户可明确选择其他受支持目录。项目、素材、模型、工作流、恢复数据、下载与日志都保存在该 `dataRoot` 下。程序二进制安装目录与业务数据目录相互独立，Relay 不会把大型业务数据静默回退到 C 盘。

外部已有 ComfyUI 和模型默认只读复用，不移动、不覆盖、不删除。普通运行不会上传项目、素材、提示词或生成结果，也不读取浏览器登录态或 GitHub token。

## 安装

1. 从 [GitHub Releases](https://github.com/PlaTuring/Relay/releases) 的 `v1.0.0` Release 下载 `Relay-1.0-x64-Setup.exe`。
2. 检查下载来源和文件名后，由用户自行运行安装程序。安装版默认创建桌面和开始菜单快捷方式。

本版本只提供 Setup 安装包，不提供 Portable。安装程序当前未签名；SmartScreen 提示和发布者身份风险见上方“安装与安全”。

## 已生成视频的归属

Relay 1.0 编译工作流时会为当前项目和工作流写入不含项目名、提示词或本机路径的安全输出前缀。用户在 ComfyUI 点击 Run 且 `SaveVideo` 完成写盘后，Relay 才会把稳定、通过本地检查的视频显示在当前项目的“已生成视频”中。旧版本通用前缀、自定义 ComfyUI 输出目录或用户改名的视频需要手动补录，Relay 不会猜测归属。

用户明确点击“加入素材库”后，Relay 才会复制并校验项目副本；ComfyUI 原始输出保持不变。`.relayproj` 默认不携带外部生成视频或本机结果索引。

## 更新通道

“关于”页面只在用户主动点击后匿名读取 `PlaTuring/Relay` 的公开 GitHub Stable Release。主进程只接受 `draft=false`、`prerelease=false`、没有预发布或构建元数据的严格 SemVer 标签，并在满足这些版本条件的 Release 中选择最高版本候选。Relay 1.0 的合同为内部版本 `1.0.0`、标签 `v1.0.0` 和唯一资产 `Relay-1.0-x64-Setup.exe`。

主进程要求资产具有正整数长度和 GitHub REST API 提供的 `sha256` 摘要；下载时同时校验响应长度和文件 SHA-256，失败或取消会删除临时文件，并且不会回退到较旧版本。Renderer 不接收下载 URL、本机路径或摘要权限。下载完成后只能由用户打开所在目录或 Release 页面并自行运行安装程序，Relay 绝不执行 EXE。

## 非官方声明

Relay 是独立开发的第三方工具，不是 MiniMax、ComfyUI 或 Comfy-Org 的官方产品，与其权利人不存在隶属、赞助或背书关系。MiniMax H3 的模型、许可与使用限制以其官方发布内容为准。

软件 Logo、作者信息与 Relay 品牌只属于软件界面，不会写入生成的视频、图片或音频。

## 作者

- 柏拉图灵 | PlaTuring
- 抖音 / B站：柏拉图灵
- GitHub：<https://github.com/PlaTuring>
- 项目：<https://github.com/PlaTuring/Relay>

## 开发与验证

```powershell
npm test
npm run smoke:product
npm --prefix packages/workflow/h3-compiler test
npm --prefix apps/control-plane run typecheck
npm --prefix apps/control-plane test
npm --prefix apps/control-plane run smoke
npm --prefix apps/control-plane run verify:offline
```

生成 Windows Setup 安装包：

```powershell
npm --prefix apps/control-plane run dist:win
```

Relay 1.0 构建产物当前未使用 Authenticode 签名；不应把 SHA-256 描述为发布者身份保证。
