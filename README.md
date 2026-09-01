# Relay

Relay 是柏拉图灵（PlaTuring）开发的 Windows 本地生产力工具，用于准备 MiniMax H3 / ComfyUI 环境、管理项目与素材、确定性编译可编辑工作流，并把工作流交接到 ComfyUI。

Relay **不会点击 Run、不会调用 `/prompt`、不会提交 ComfyUI 队列，也不会替用户生成视频或音频**。只有用户在 ComfyUI 中检查工作流并亲自点击 Run 后，MiniMax H3 才会生成视频与原生音频。

## Alpha 40 测试预览版

当前公开版本为 `0.1.0-alpha.40`。这是测试预览版，支持 Windows 10 / 11 x64。

> **未签名软件提醒**
>
> Alpha 40 尚未使用 Authenticode 代码签名证书。Windows SmartScreen 可能显示“未知发布者”或阻止首次运行。发布页提供的 SHA-256 只用于确认文件在传输后是否完整，**不能证明发布者身份，也不能替代 Authenticode**。请只从 `PlaTuring/Relay` 的官方 GitHub Release 下载。

Alpha 39 及更早版本需要手动升级一次。Alpha 40 已包含“关于”页的主动更新检查能力，但本次公开 Release 按发布者选择只提供 Setup，因此不会满足应用内严格的三资产下载合同；用户需从 GitHub 页面手动下载安装。Relay 不会后台检查、不会静默下载，也绝不会自动运行下载的安装程序。

## 主要模块

- **项目**：新建、打开、复制、安全删除和恢复本地项目。
- **快速创建**：以最少参数编译 T2V、FL2VA 或 Ref2VA 工作流。
- **专业导播**：管理场景、镜头、素材关系、连续性、种子与分段工作流。
- **素材库**：显式导入本地图片、视频和音频，默认复制到项目；不会上传云端或修改源文件。
- **已生成视频**：在当前项目已经交接的有界 ComfyUI 输出目录中发现已完成写盘的视频；也可由用户手动补录旧输出。视频仍由 ComfyUI 中的 MiniMax H3 生成，不由 Relay 生成。
- **画质超分（功能规划中）**：Alpha 40 仅展示明确的规划状态，不提供按钮或伪功能。
- **安装与组件**：检测并复用现有 ComfyUI / 模型，或在用户选定的数据目录中安装缺失组件。

## 本地数据与隐私

首次设置时，Relay 会建议使用受支持的本机固定 NTFS 数据盘，例如 `D:\MiniMaxH3`；用户可明确选择其他受支持目录。项目、素材、模型、工作流、恢复数据、下载与日志都保存在该 `dataRoot` 下。程序二进制安装目录与业务数据目录相互独立，Relay 不会把大型业务数据静默回退到 C 盘。

外部已有 ComfyUI 和模型默认只读复用，不移动、不覆盖、不删除。普通运行不会上传项目、素材、提示词或生成结果，也不读取浏览器登录态或 GitHub token。

## 安装

1. 从 [GitHub Releases](https://github.com/PlaTuring/Relay/releases) 下载 `Relay-0.1.0-alpha.40-x64-Setup.exe`。安装版默认创建桌面和开始菜单快捷方式。
2. 在 PowerShell 中校验下载文件：

```powershell
Get-FileHash .\Relay-0.1.0-alpha.40-x64-Setup.exe -Algorithm SHA256
```

预期 SHA-256：`db59fa75edd6508aa21167ca41b5b03775f0b54ba6d1b0d230a9211dfb6bd1fe`。

输出必须与上述值逐字一致。哈希一致只说明文件内容与发布说明一致；未签名风险仍然存在，也不能替代 Authenticode。

## 已生成视频的归属

Alpha 40 编译工作流时会为当前项目和工作流写入不含项目名、提示词或本机路径的安全输出前缀。用户在 ComfyUI 点击 Run 且 `SaveVideo` 完成写盘后，Relay 才会把稳定、通过本地检查的视频显示在当前项目的“已生成视频”中。Alpha 39 通用前缀、自定义 ComfyUI 输出目录或用户改名的视频需要手动补录，Relay 不会猜测归属。

用户明确点击“加入素材库”后，Relay 才会复制并校验项目副本；ComfyUI 原始输出保持不变。`.relayproj` 默认不携带外部生成视频或本机结果索引。

## 更新通道

“关于”页面只在用户主动点击后匿名读取 `PlaTuring/Relay` 的公开 GitHub Alpha Pre-release。主进程只接受严格的 `0.1.0-alpha.N` 版本和固定的 Setup、Portable、`SHA256SUMS.txt` 三项资产，并在本地完成长度与 SHA-256 双重校验。由于 Alpha 40 的公开 Release 只上传 Setup，应用会准确显示“发布资产不完整”，不会假装可下载；本版本需从 GitHub 页面手动下载安装。Renderer 不接收下载 URL 或本机路径，也不能执行 EXE。

## 非官方声明

Relay 是独立开发的第三方工具，不是 MiniMax、ComfyUI 或 Comfy-Org 的官方产品，与其权利人不存在隶属、赞助或背书关系。MiniMax H3 的模型、许可与使用限制以其官方发布内容为准。

软件 Logo、作者信息与 Relay 品牌只属于软件界面，不会写入生成的视频、图片或音频。

## 作者

- 柏拉图灵 | PlaTuring
- 抖音 / B站：柏拉图灵
- GitHub：<https://github.com/PlaTuring>
- 项目：<https://github.com/PlaTuring/Relay>
