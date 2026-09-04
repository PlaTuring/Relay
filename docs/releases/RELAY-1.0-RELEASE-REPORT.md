# Relay 1.0 正式版发布报告

日期：2026-09-01  
正式版本：`1.0.0`  
界面版本：`1.0`  
预定标签：`v1.0.0`  
预定 Release 标题：`Relay 1.0`

## 结论

Relay 1.0 的本地正式版代码、Setup、静默安装验证、离线发布门禁和控制闭环已经通过。冻结目录只包含一个发布资产：

- `Relay-1.0-x64-Setup.exe`

本轮没有构建或冻结 Portable，也没有把 Portable、校验清单或其他文件列入公开资产闭包。

截至本报告生成时，公开仓库 `PlaTuring/Relay` 存在且为公开仓库，但 Releases 数量为 0；当前执行环境没有可用的非交互 GitHub 凭据，且本轮明确不允许浏览器、Chrome 或桌面自动化，因此没有对公开仓库执行 README 提交、Release 创建或资产上传。这个结论是精确的远程发布状态，不是产品实现或成品门禁失败。

## 产品边界

Relay 只负责安装、检测、配置、项目与素材管理、确定性工作流编译，以及把可编辑工作流交接给 ComfyUI。所有验证均确认：

- 不点击 Run；
- 不调用 `/prompt`；
- 不提交 ComfyUI 队列；
- 不生成视频或音频；
- 不自动执行下载的安装程序。

用户正在运行的旧版 Relay、ComfyUI 和 H3 会话没有被启动、关闭、切换或操作。

## 版本和发布合同

| 项目 | 结果 |
| --- | --- |
| 根包版本 | `1.0.0` |
| control-plane 版本 | `1.0.0` |
| PE ProductVersion / FileVersion | `1.0.0` / `1.0.0` |
| 界面显示 | `版本 1.0`，由运行时统一版本源派生 |
| 更新通道 | `github-releases:PlaTuring/Relay:stable` |
| 接受的 Release | `draft=false`、`prerelease=false`、严格 Stable SemVer |
| 下载资产 | 唯一 Setup；不接受 Portable 或清单作为通道资产 |
| 下载校验 | GitHub API 资产长度 + `sha256` digest + HTTP/落盘长度 + 本地 SHA-256 |
| 下载后行为 | 只允许打开所在目录或发布页；绝不执行 EXE |

## 功能闭环审计

独立审计覆盖 213 个静态交互节点和 22 类运行时动态控件，共 `235/235` 个审计单元：

| 严重度 | 数量 | 结论 |
| --- | ---: | --- |
| P0 | 0 | 无破坏性、越权或生成边界问题 |
| P1 | 0 | 审计发现的建议时长持久化缺口已修复并复核 |
| P2 | 1 | 少量项目/记录操作已有重复提交保护，但长 IPC 期间没有按钮级忙碌视觉；不造成重复变更、假成功或数据丢失，不阻断本次发布 |

审计没有发现假按钮、假预览、假进度或仅弹成功但没有真实结果的分支。“画质超分”是唯一有意占位页面，且没有任何可执行控件。

完整审计证据：`apps/control-plane/artifacts/native-v1.0.0/reviews/relay10-control-closure.md`。

## 本轮修复

1. 正式版本统一为 `1.0.0`，公开文件名由同一版本源派生为 `Relay-1.0-x64-Setup.exe`。
2. 更新通道从历史 Alpha Pre-release 合同切换为 Stable、Setup-only、用户主动下载。
3. About 和当前用户界面清除 Alpha、测试预览、预发布和显眼未签名状态；README/发布说明保留准确 SmartScreen 与 Authenticode 风险说明。
4. 默认打包入口只构建 NSIS Setup；Portable 仅保留为显式开发入口，不进入本次发布闭包。
5. 修复“接受提示词建议时长后立即切页/重启可能恢复旧值”：现在点击后会调用真实项目自动保存调度。
6. 修复下载取消/恢复测试的时序不确定性：测试先证明存在未完成可信分片，再取消并验证 Range 恢复。
7. 将旧 CSS 注释标记和 Setup+Portable 假设的历史测试迁移到当前 Relay 1.0 响应式与 Setup-only 合同。

## 测试与门禁

| 命令 / 门禁 | 结果 |
| --- | --- |
| `npm test` | 5/5，0 failed |
| `npm --prefix apps/control-plane test` | 412 passed，0 failed，1 个显式公网测试跳过 |
| `npm --prefix apps/control-plane run typecheck` | 3/3 |
| UI/控制闭环专项 | 83/83 |
| 历史门禁迁移专项 | 23/23 |
| 正式版版本/UI专项 | 13/13 |
| Stable 更新/下载专项 | 18 passed，0 failed，1 个显式公网测试跳过 |
| 产品冒烟 | complete=1，media_generated=0，prompt_submitted=0 |
| control-plane 无界面 UI 冒烟 | `CONTROL_PLANE_UI_READY mode=deterministic_mock` |
| NSIS 打包 | passed；原生 helper/runtime resources passed |
| 静默安装验证 | passed；native passed；桌面+开始菜单快捷方式 2；uninstall passed |
| 完整离线校验 | `release_passed` |

离线发布门禁明细：

- package gate：`passed_release_artifact_and_runtime`
- packaged runtime resource gate：`passed_exact_file_set_length_sha256`
- checksum gate：`passed_setup_exact_sha256`
- native helper gate：`enabled_profile_passed_2_of_2_reserved_6_rejected`
- installer runtime gate：`passed_installer_shortcuts_runtime_uninstall`
- signing gate：`not_required_unsigned_release`

公网测试跳过原因是公开仓库当前还没有 Stable Release；本地 fixture 已覆盖版本选择、错误资产、长度、digest、重定向、取消、并发和清理全部确定性分支。

## 成品证据

冻结目录：

`apps/control-plane/release-relay-1.0/`（相对于仓库根目录）

| 文件 | 字节数 | SHA-256 | Authenticode |
| --- | ---: | --- | --- |
| `Relay-1.0-x64-Setup.exe` | 100,914,689 | `6ee1a1f046d89388db9ebbf54a0d670e7d49fe7401f1a7c744a7ef9b5f4498a6` | `NotSigned` |

文件元数据：ProductName=`Relay`，CompanyName=`PlaTuring`，ProductVersion=`1.0.0`，FileVersion=`1.0.0`。

未签名是已披露的发布风险；没有把 SHA-256 描述为发布者身份保证，也没有把 Authenticode 当成本轮成品构建阻断。

## 公开仓库状态

只读匿名核验结果：

- 仓库：`https://github.com/PlaTuring/Relay`
- 仓库 ID：`1348105484`
- 可见性：Public
- 默认分支：`main`
- Release 数量：`0`
- 仓库描述和 topics 已是 Relay 产品内容
- 远端 README 与本地 Relay 1.0 README 不同

非交互凭据探测使用 `GCM_INTERACTIVE=Never` 和 `GIT_TERMINAL_PROMPT=0`，结果为 credential status `128` 且没有获得凭据。探测过程没有输出、记录或保存 token。由于本轮禁止浏览器/桌面自动化，没有用登录会话绕过这一限制。

在获得显式非交互 GitHub 凭据后，远程动作应严格限定为：更新 README，创建 `v1.0.0` / `Relay 1.0` / `prerelease=false` 的 Release，仅上传冻结目录中的 Setup，重新下载核对长度和 SHA-256 后再公开。

## 发布判定

- 本地成品：**可发布**。
- 产品实现：**P0=0、P1=0，可发布**。
- GitHub 公开状态：**尚未发布**，原因是本执行环境没有非交互 GitHub 写权限，且没有使用被排除的浏览器/桌面操作。

## 后续合同变更附录（2026-09-01）

本报告主体记录的是当时冻结的 Relay 1.0 成品与当次远程状态，相关“绝不执行 EXE”和“尚未发布”结论均为历史快照，不应被改写成该二进制后来具备的新能力。

产品所有者随后接受 ADR-016 / D-023：在未来纳入该实现的构建中，当固定 `PlaTuring/Relay` Stable 通道发现更高合格版本时，只有用户明确点击“下载并安装”，Relay 才可下载并验证唯一 Setup、立即复核受管目标文件、以空参数启动可见的 Windows 安装界面，并在启动请求成功后退出。后台检查/下载、静默安装、任意 URL/路径/命令 IPC、组件 catalog 变更、Run、`/prompt`、ComfyUI 队列和媒体生成仍禁止。

该附录是治理合同更新，不构成对上表冻结 Setup 的重新构建、重新测试或能力追认；新实现必须通过专项测试与新的发布门禁后，方可对外声明“下载并安装”闭环。
