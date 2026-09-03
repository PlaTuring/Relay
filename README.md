<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./header-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="./header-light.svg">
  <img alt="Relay 1.0.1 — Windows 本地 MiniMax H3 工作流控制工具" src="./header-light.svg" width="100%">
</picture>

<p align="center">
  <img alt="Relay 1.0.1" src="https://img.shields.io/badge/Relay-1.0.1-2563EB?style=flat-square">
  <img alt="Windows 10 / 11 x64" src="https://img.shields.io/badge/Windows-10%20%7C%2011%20x64-0078D4?style=flat-square&logo=windows11&logoColor=white">
  <img alt="Local first" src="https://img.shields.io/badge/data-local--first-0F766E?style=flat-square">
  <img alt="Setup only" src="https://img.shields.io/badge/package-Setup%20only-475569?style=flat-square">
</p>

<p align="center"><strong>准备本机环境，管理项目与素材，编译可编辑工作流，再清楚地交接给 ComfyUI。</strong></p>
<p align="center">面向 Windows 10 / 11 x64 的本地环境准备、项目与素材管理、确定性工作流编译与 ComfyUI 可编辑交接工具。</p>

<p align="center">
  <a href="https://github.com/PlaTuring/Relay/releases/download/v1.0.1/Relay-1.0.1-x64-Setup.exe"><img alt="下载 Relay 1.0.1 Setup" src="https://img.shields.io/badge/下载-Relay%201.0.1%20Setup-2563EB?style=for-the-badge&logo=windows11&logoColor=white"></a>
</p>

<p align="center">
  <a href="https://github.com/PlaTuring/Relay/releases/tag/v1.0.1">发布说明</a>
  · <a href="#开始使用">开始使用</a>
  · <a href="#核心工作区">核心工作区</a>
  · <a href="#本地数据与生成结果">本地数据与生成结果</a>
</p>

> [!IMPORTANT]
> **当前正式版本是 Relay 1.0.1。** 产品界面沿用“Relay 1.0”主版本标识，内部更新版本为 `1.0.1`，GitHub Release 标签为 [`v1.0.1`](https://github.com/PlaTuring/Relay/releases/tag/v1.0.1)。支持 Windows 10 / 11 x64。

> **1.0.1 热修复提示：** 2026-09-04 之前下载过 1.0.1 的用户，请从同一 Release 重新下载安装。此次修复保持版本号不变，已安装的旧 1.0.1 无法仅靠版本比较识别新的构建。

## Relay 是什么

Relay 把复杂的本地准备工作收拢到一个可检查的流程中：检测或安装 ComfyUI 与 MiniMax H3 组件，管理项目和素材，确定性编译 T2V、FL2VA、Ref2VA 及分段工作流，并在 ComfyUI 中打开本次可编辑工作流。

```text
项目与素材  →  Relay 确定性编译  →  ComfyUI 可编辑工作流
```

交接后的工作流在 ComfyUI 中保持可编辑，可继续检查节点、提示词、素材、模型、种子与输出设置。

## 核心工作区

| 工作区 | 用途 |
| --- | --- |
| **项目** | 新建、打开、复制、安全删除和恢复本地项目。 |
| **快速创建** | 以最少参数编译 T2V、FL2VA 或 Ref2VA 工作流。 |
| **专业导播** | 管理场景、镜头、素材关系、连续性、种子与分段工作流。 |
| **素材库** | 显式导入本地图片、视频和音频；默认复制到项目，不上传云端或修改源文件。 |
| **ComfyUI 结果发现（已生成视频）** | 发现当前项目已完成写盘的 ComfyUI 输出，也可由用户手动补录旧输出。 |
| **安装与组件** | 检测并复用现有 ComfyUI / 模型，或在用户选定的数据目录中安装缺失组件。 |
| **画质超分** | 功能规划中；当前不提供未实现按钮或伪功能。 |

## 开始使用

1. 下载 [`Relay-1.0.1-x64-Setup.exe`](https://github.com/PlaTuring/Relay/releases/download/v1.0.1/Relay-1.0.1-x64-Setup.exe)。
2. 检查下载来源和文件名，然后由你亲自运行安装程序。
3. 首次设置时确认 Relay 数据目录。默认建议使用受支持的本机固定 NTFS 数据盘，例如 `D:\MiniMaxH3`。
4. 复用已有 ComfyUI / 模型，或在“安装与组件”中安装缺失的必需项。
5. 在快速创建或专业导播中编译，并在 ComfyUI 中检查本次工作流。

本版本只提供 Setup 安装包，不提供 Portable。安装版默认创建桌面和开始菜单快捷方式。GitHub 自动生成的 Source code 压缩包不是 Relay 安装包。

### 安装包完整性

```powershell
Get-FileHash .\Relay-1.0.1-x64-Setup.exe -Algorithm SHA256
```

预期 SHA-256：

```text
0b7d39cfb7edec8804e6cca25c712500748a0654a8b33458e9480a15af09db30
```

## 本地数据与生成结果

项目、素材、模型、工作流、恢复数据、下载与日志保存在用户选择的 `dataRoot` 下。Electron 用户目录只保留很小的数据目录指针及不可避免的运行缓存。

Relay 1.0.1 会为当前项目和工作流写入不含项目名、提示词或本机路径的安全输出前缀，并扫描已稳定写盘的 `SaveVideo` 输出。通过本地检查的视频会显示在“已生成视频”中。

旧版通用前缀、自定义 ComfyUI 输出目录或用户改名的视频需要手动补录。只有用户明确点击“加入素材库”后，Relay 才会复制并校验项目副本；ComfyUI 原始输出保持不变。

## 更新机制

“关于”页面只在用户主动点击后匿名读取 `PlaTuring/Relay` 的公开 Stable Release。Relay 只接受严格稳定 SemVer、唯一匹配的 Setup 资产、有效长度和 GitHub SHA-256 摘要；候选不合格时会准确失败，不回退到较旧版本。

发现更高稳定版本时会显示“下载并安装”。只有用户明确点击后，Relay 才会下载并再次验证受管 Setup，然后启动可见的 Windows 安装界面；不后台检查、不静默安装，也不把下载权限扩展到其他文件或组件。

## 兼容性说明

MiniMax H3、ComfyUI 和 Comfy-Org 名称仅用于说明兼容对象；相关模型、许可与使用限制以各自官方内容为准。

Relay Logo 与品牌用于软件界面和项目介绍。

---

<p align="center">本仓库用于 Relay 的产品介绍与官方二进制 Release。</p>

