# ADR-014：用户主动的 Alpha Pre-release 下载通道（历史）

- **状态：** Superseded — 当前 Relay 1.0 分发由 ADR-015 管理；本文仅保留为 Alpha 40 历史决策
- **日期：** 2026-09-01
- **适用范围：** Relay Alpha 应用版本检查、用户主动下载与 GitHub Pre-release 分发
- **取代范围：** 仅取代 ADR-011 对“应用不得发现或下载新版本”的绝对禁令；组件 catalog、后台更新、自动执行和 Stable 自动更新禁令继续有效

> 本文不再定义当前产品通道。Relay 1.0 的 Stable Release 选择、Setup-only 资产、用户主动下载和禁止自动执行合同见 [`ADR-015-user-initiated-stable-download-channel.md`](ADR-015-user-initiated-stable-download-channel.md)。

## 决策

Relay Alpha 40 可以匿名读取固定仓库 `PlaTuring/Relay` 的公开 GitHub Releases，并在用户明确点击后下载同一 Alpha 通道的 Setup 或 Portable。该能力必须同时满足：

1. 只接受 `draft=false`、`prerelease=true`、严格 `0.1.0-alpha.N` 的 Release；
2. 最高合格 Release 必须同时包含版本和 x64 架构严格匹配的 Setup、Portable 与 `SHA256SUMS.txt`；
3. renderer 不提供 URL、路径、版本、命令或可执行文件；主进程独占固定更新源、目标选择、下载路径和校验；
4. 下载只发生于用户显式操作，使用 `.partial`、资产长度和 SHA-256 双校验，成功后原子改名；
5. 下载完成后只允许打开所在目录或已验证 Release 页面，应用绝不执行安装程序；
6. 不读取 Chrome 登录态，不使用 token，不保存凭据，不后台检查，不启动托盘或计划任务；
7. SHA-256 只证明文件完整性，不能证明发布者身份。未取得 Authenticode 前，应用、README 和 Release 必须醒目标注未签名风险；
8. 组件 catalog、模型、ComfyUI、节点和 runtime 仍只能由当前应用内嵌的 immutable catalog 决定，更新通道不得改变 recipe 或安装未知组件。

## 信任与风险接受

该通道不是 TUF，也不声称具备独立的抗仓库接管、冻结、回滚、密钥轮换或发布者身份保证。产品所有者明确接受其仅用于公开未签名 Alpha Pre-release 的风险，并以以下限制收敛攻击面：

- 固定 GitHub owner/repository、固定 Alpha 通道和严格资产名；
- 同通道只选择最高 SemVer，不接受旧版回滚；
- Release 元数据、资产长度、清单和目标文件相互闭合；
- 下载永不自动执行，最终运行仍由用户在 Windows 中明确决定；
- 公开文案明确区分 SHA-256 完整性与 Authenticode 身份验证。

Stable 自动更新、后台更新、强制最低版本、组件热更新或自动执行安装程序仍需新的 trusted-update ADR 和 TUF/等价信任设计。

## 可验收不变量

- 更新源唯一为 `https://api.github.com/repos/PlaTuring/Relay/releases?per_page=20`。
- Alpha 只接受 `prerelease=true` 与严格 `0.1.0-alpha.N`。
- 缺失、重复或危险资产返回 `release_incomplete`，不得回退旧版。
- renderer 无任意 URL/path/command authority。
- 取消、断网、长度或哈希不符均不能产生成功文件或成功提示。
- 下载服务不存在任何进程启动、`shell.openPath(exe)`、Run、`/prompt` 或队列提交路径。
- 任何旧仓库 sourceId 的缓存均 fail closed，不参与 Alpha 更新决策。

## 重新评审触发

- 自动执行安装程序或静默替换应用；
- 启动时、后台、托盘或计划任务检查；
- Stable/Testing 多通道 promotion；
- 远程元数据改变组件 catalog、模型、节点、recipe 或 runtime；
- 允许 renderer 提供 URL、路径、命令或凭据；
- 宣称更新通道提供发布者身份或完整 TUF 等价保证。
