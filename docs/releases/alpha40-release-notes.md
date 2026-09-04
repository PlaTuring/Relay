# Relay 0.1.0-alpha.40 — 测试预览版（未签名）

> **历史内部证据**：本文只保留 Alpha 40 当时的发布文案，不是当前或待发布的产品说明。当前正式发布说明见 [`relay-1.0-release-notes.md`](relay-1.0-release-notes.md)。

Relay Alpha 40 是面向 Windows 10 / 11 x64 的公开测试预览版。

## 重要安全提示

- 本版本尚未使用 Authenticode 代码签名，Windows SmartScreen 可能显示“未知发布者”或阻止首次运行。
- 本次公开 Release 按发布者选择只提供 Setup；下方列出 Setup 的 SHA-256 供手动完整性核对。SHA-256 不能证明发布者身份，也不能替代 Authenticode。
- 请只从 `PlaTuring/Relay` 的公开 GitHub Release 下载。
- Relay 不会自动执行下载的 Setup 或 Portable；下载完成后只能由用户自行检查并运行。

## 本次新增

- 新增当前项目“已生成视频”：在用户于 ComfyUI 点击 Run 且 SaveVideo 完成写盘后，Relay 可自动发现属于当前项目/工作流的稳定视频。
- 新工作流使用不含项目名、提示词或本机路径的安全输出前缀；旧版通用前缀、自定义输出目录和改名视频可手动补录。
- 已生成视频可播放、显示所在目录，并可由用户明确复制加入项目素材库；原始 ComfyUI 输出保持不变。
- “导入规划中”迁移为“画质超分（功能规划中）”页面，不提供任何未实现按钮。
- 关于页已实现严格 Alpha Pre-release 检查与校验下载；由于本次公开 Release 只提供 Setup、不满足三资产合同，应用会准确显示“发布资产不完整”，本版本需从 GitHub 页面手动下载安装。
- 更新源统一为 `PlaTuring/Relay`，Alpha 客户端只接受严格 `0.1.0-alpha.N` Pre-release。

## 升级说明

Alpha 39 及更早版本需要手动升级一次；本次 Setup-only Alpha 40 同样需从 GitHub 页面手动下载安装。后续 Alpha 若发布完整的 Setup、Portable 和 `SHA256SUMS.txt`，Relay 才会允许在应用内校验下载。

## 产品边界

Relay 只负责安装、检测、配置、项目与素材管理、确定性工作流编译和交接。Relay 不点击 Run、不调用 `/prompt`、不提交 ComfyUI 队列，也不生成视频或音频。只有用户在 ComfyUI 中亲自点击 Run 后，MiniMax H3 才生成视频与原生音频。

## 发布资产

- `Relay-0.1.0-alpha.40-x64-Setup.exe`

Setup SHA-256：`db59fa75edd6508aa21167ca41b5b03775f0b54ba6d1b0d230a9211dfb6bd1fe`
