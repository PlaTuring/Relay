# ADR-015：用户主动的 Stable Release 下载通道

- **状态：** Accepted（产品所有者于 2026-09-01 明确授权 Relay 1.0）
- **日期：** 2026-09-01
- **适用范围：** Relay Stable 应用版本检查、用户主动下载与 GitHub Release 分发
- **取代范围：** 取代 ADR-014 对当前产品分发通道的约束；ADR-014 仅保留为 Alpha 40 历史决策
- **后续补充：** ADR-016 允许在用户明确点击“下载并安装”后启动已通过完整验证的交互式 Stable Setup；本文其余固定源、版本选择、下载、组件 catalog 和发布者身份边界保持不变

## 决策

Relay 可以匿名读取固定仓库 `PlaTuring/Relay` 的公开 GitHub Releases，并且只在用户明确操作后下载合格 Stable Release 的 Setup。该能力必须同时满足：

1. 固定 source ID 为 `github-releases:PlaTuring/Relay:stable`，不接受 renderer 或用户提供的 owner、repository、URL、路径或通道；
2. 只接受 `draft=false`、`prerelease=false`，且 tag 为 `vMAJOR.MINOR.PATCH`、版本为无 prerelease/build metadata 的严格 SemVer；
3. 在满足 `draft`、`prerelease`、tag 和版本条件的 Release 中，选择版本高于当前版本的最高版本候选；随后校验其元数据和资产，任何不合格都必须失败关闭，不得回退到较旧版本；
4. 当前版本合同固定为内部版本 `1.0.2`、UI 显示 `1.0.2`、tag `v1.0.2`、Release 标题 `Relay 1.0.2`；
5. Setup 命名规则为：patch 等于零时使用 `Relay-<major>.<minor>-x64-Setup.exe`，patch 大于零时使用完整 `Relay-<major>.<minor>.<patch>-x64-Setup.exe`；因此 `1.0.2` 的唯一资产名是 `Relay-1.0.2-x64-Setup.exe`；
6. 合格 Release 的上传资产闭包只能包含一个严格匹配的 Setup，不要求或接受 Portable、`SHA256SUMS.txt` 作为通道合同；
7. Setup 必须具有 GitHub 官方资产 URL、正整数 `size`，以及 GitHub REST API 返回的严格 `sha256:<64 lowercase hex>` digest；
8. 下载只发生于用户显式操作，使用 `.partial` 文件；HTTP `Content-Length` 必须等于 API `size`，流式计算的 SHA-256 必须等于 API digest，全部通过后才原子发布目标文件；
9. 取消、断网、长度不符、摘要不符或写入失败都必须删除临时文件，并且不得产生成功状态；
10. 下载完成后的默认结果仍是受管目录中的已验证 Setup；只有满足 ADR-016 的同一次用户“下载并安装”事务，才可启动该精确文件。不得执行其他下载文件或外部路径；
11. 不读取 Chrome 登录态，不使用 token，不保存凭据，不后台检查，不启动托盘、服务或计划任务；
12. 旧 Alpha source/channel/cache 必须忽略，不参与 Stable 选择或下载；
13. 组件 catalog、模型、ComfyUI、节点和 runtime 仍只能由当前应用内嵌的 immutable catalog 决定，Stable 下载通道不得改变 recipe 或安装未知组件。

## 信任与风险接受

该通道不是 TUF，也不声称具备独立的抗仓库接管、冻结、回滚、密钥轮换或发布者身份保证。GitHub REST API 返回的 SHA-256 与资产元数据来自同一发布信任域；它可以关闭传输损坏和下载内容不一致，但不能证明发布者身份，也不能替代 Authenticode。

Relay 1.0 当前未使用 Authenticode 代码签名。应用、README 和 Release 必须如实说明 SmartScreen 可能显示“未知发布者”，不得把 SHA-256 描述为签名、认证或发布者身份保证。

风险通过以下限制收敛：

- 固定 GitHub owner/repository、固定 Stable 通道和严格 SemVer；
- 只选择满足稳定版本条件的最高版本候选，不接受回滚，也不在该候选失败后回退；
- Release 元数据、唯一 Setup 资产、API 长度、HTTP 长度、API digest 和目标文件相互闭合；
- renderer 没有 URL、路径、摘要、命令或可执行文件权限；
- 下载不会在后台自动执行；只有用户明确点击“下载并安装”后，才可按 ADR-016 启动已验证的交互式 Setup，Windows 安装界面和 UAC 仍由用户决定；
- 公开文案明确区分 SHA-256 完整性与 Authenticode 身份验证。

后台更新、静默/无人值守安装、强制最低版本、组件热更新或超出 ADR-016 固定 Setup 范围的可执行启动仍需新的 trusted-update ADR 和 TUF/等价信任设计。

## 可验收不变量

- 更新源唯一为 `https://api.github.com/repos/PlaTuring/Relay/releases?per_page=20`，source ID 为 `github-releases:PlaTuring/Relay:stable`。
- Stable 只接受 `draft=false`、`prerelease=false` 和严格 `vMAJOR.MINOR.PATCH`。
- 内部版本、UI 显示、tag、标题和 Setup 文件名分别为 `1.0.2`、`1.0.2`、`v1.0.2`、`Relay 1.0.2`、`Relay-1.0.2-x64-Setup.exe`。
- Release 资产闭包恰好只有一个 Setup；Portable、`SHA256SUMS.txt`、重复或危险资产均不能成为合格 Stable Release。
- 缺失或无效 `size`/digest、URL 不合格、长度或 SHA-256 不符都失败关闭，不得回退旧版。
- renderer 无任意 URL/path/digest/command authority。
- 下载服务不暴露通用进程启动能力；ADR-016 的 main-process 固定 Setup 启动只能消费内部已验证受管文件，且不存在 renderer URL/path/args authority、Run、`/prompt` 或队列提交路径。
- 任何 Alpha source ID 或缓存都不参与 Stable 更新决策。

## 重新评审触发

- 超出 ADR-016 的自动执行、静默/无人值守安装、替换应用或后台下载；
- 启动时、后台、托盘、服务或计划任务检查；
- 引入 Testing/Beta/Canary 或其他 promotion 通道；
- 改变 Stable tag、版本选择、资产闭包、命名、长度或 digest 合同；
- 远程元数据改变组件 catalog、模型、节点、recipe 或 runtime；
- 允许 renderer 提供 URL、路径、摘要、命令或凭据；
- 宣称更新通道提供发布者身份、代码签名或完整 TUF 等价保证。
