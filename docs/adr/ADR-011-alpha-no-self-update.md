# ADR-011：无应用/组件自动自更新

> **Relay 1.0 当前覆盖说明（2026-09-01）**：ADR-015、ADR-016、D-022 与 D-023 由产品所有者明确接受，覆盖本文关于“运行中应用不得发现、下载或启动新版本”的绝对表述，但只限固定 `PlaTuring/Relay` Stable Release、严格稳定 SemVer，以及用户明确点击“下载并安装”后对唯一 Setup 的下载、完整验证和交互式启动。Relay 不后台检查、不静默安装、不更新组件/catalog，也不把 GitHub SHA-256 当作发布者身份。本文对后台更新、远程组件/recipe/catalog、任意 URL/路径/命令桥和其他安装程序执行的禁令继续完全有效。

> **历史说明**：ADR-014 与 D-021 记录 Alpha 40 的狭窄 Pre-release 通道，现已由 ADR-015 与 D-022 取代，不再定义当前产品行为。

- **状态：** Accepted（Root 于 2026-08-27 复跑 16/16 两次并完成主审）
- **日期：** 2026-08-27
- **任务：** `P0-GOV-007`
- **正式化：** `D-005`；强化 `D-016` 的 managed process/zero-egress 边界
- **适用范围：** Relay application、helper、后台任务、packaged dependencies/config/scripts、内嵌 component catalog、managed runtime generation
- **相关 ADR：** ADR-001 产品/进程边界；ADR-015 用户主动的 Stable Release 下载通道；ADR-016 用户主动启动已验证 Stable Setup

## 1. 背景

Alpha 需要下载体积很大的、版本锁定的运行时和模型 artifact，但这不意味着运行中的应用需要自更新。若 Alpha 同时存在 updater framework、remote catalog、Stable/Testing channel、`latest/main` 解析、后台检查或 runtime package installer，就必须立刻解决远程元数据签名、回滚/冻结/混搭攻击、密钥轮换、通道隔离、N-1 兼容和失败回滚。这会扩大首个 managed Core 垂直切片的攻击面与关键路径。

`D-005` 已接受更小的边界：具体 app 版本携带自己的 immutable component catalog；目标固定 revision、length 和 SHA-256；用户通过下一份独立安装包安装新 app 版本。未取得 Authenticode 时，安装包必须如实披露未签名风险。`D-016` 还要求强零外联声明只适用于 allowlisted managed process tree。一个“默认关闭但仍打包”的 updater 既扩大进程/依赖面，也可能因配置、环境或依赖行为被重新启用。

旧计划中曾出现“更新检查可关闭”的宽松表述。除 ADR-015 明确授权的 Stable Release 用户主动检查/校验下载，以及 ADR-016 明确授权的同一次用户操作下交互式 Setup 启动外，仍以活动 task context、`D-005` 和 binding optimized architecture 为准：**不得出现后台或静默更新面，也不得借更新通道改变组件能力。**

## 2. 决策

Relay application 和它启动的所有 managed helper/runtime **不得后台、静默或无人值守更新 application 或 component**。除 ADR-015 明确列出的用户主动 Stable Setup 检查/下载，以及 ADR-016 明确列出的同一次用户操作下已验证 Setup 交互式启动外，构建中不得包含：

- updater service/framework/API 或后台 scheduler；
- application/component update check、update channel、remote feed、appcast；ADR-015 的固定 Stable Release typed surface 是唯一例外；
- 自动 Stable/Testing/Beta/Canary/Nightly updater channel；
- mutable `latest`、`main`、`master`、`HEAD` 或 branch resolution；
- remote component catalog、application manifest 或 recipe lookup；
- silent component replacement、runtime package download/install、Manager download；
- `update all`、自助更新 CLI、托盘更新、启动时检查或隐藏 IPC update command；
- updater telemetry、update advertising ID 或因更新而新增的 background process。

禁用、隐藏 UI、feature flag=false 或“只有内部使用”都不满足本 ADR；dependency、service、config、endpoint 和 command 必须从 Alpha build 中移除。

### 2.1 允许的内嵌 catalog 安装/修复

app version `A` 打包唯一 catalog `C_A`。`C_A` 是签名 app artifact 的一部分，不在运行时从网络替换。它的每个下载目标至少由后续 component-manifest contract 固定 immutable source/revision、expected length、SHA-256、origin/provenance、license chain 和 role。

下列动作允许：

1. 用户开始首次安装或显式修复；
2. 控制平面只读取本地 `C_A`；
3. 对其中已经批准的缺失 artifact 执行受事务保护的下载/续传；
4. 校验 length/hash/许可和 generation 后原子激活；
5. 已安装 generation 在断网时重复运行。

这个下载器不能请求“新的 catalog”、搜索“更佳版本”、解析 `latest`、改变 recipe，或在 Comfy/H3 execution 中安装依赖。普通 immutable artifact URL 不等于 update endpoint；policy linter 必须区分二者。

### 2.2 新 app 版本的人工安装路径

新版本仍通过**另一份明确版本的安装包**完成安装。ADR-015 允许在用户主动操作后发现并校验下载固定 Stable Release 的唯一 Setup；ADR-016 进一步允许同一次“下载并安装”操作在复核受管文件后启动其交互式安装界面。新安装包携带自己的 catalog `C_B`，并按安装/迁移 ADR 做验证、备份和 generation transaction。

新安装不允许成为绕过：除 ADR-015 的固定源、严格版本、唯一 Setup 和用户主动下载合同，以及 ADR-016 的受管文件复核、空参数交互式启动合同外，运行中的应用不得借“打开任意下载页”“helper 代下载”“remote notice JSON”或 tray service 扩大更新权限。发布公告分发本身不授予执行能力。

## 3. 可 lint 的 build policy

Phase 0 提供 `alpha-no-self-update` policy 和纯 Node built-in linter。linter 只读已物化 build-plan/source inventory，输出到 stdout，按 rule ID/相对文件/位置/消息确定性排序，不写报告或缓存，不使用网络或子进程。

| Rule | 拒绝面 | 精确 fixture |
|---|---|---|
| `NSU-000` | 不可读、invalid JSON、symlink/junction 等扫描不完整 | scanner fail-closed contract |
| `NSU-001` | packaged/resolved updater dependency | `forbidden-dependency` |
| `NSU-002` | updater service/API | `updater-service` |
| `NSU-003` | background scheduler/startup check | `background-scheduler` |
| `NSU-004` | package/command update script | `update-script` |
| `NSU-005` | updater config key | `updater-config` |
| `NSU-006` | update/appcast endpoint | `update-endpoint` |
| `NSU-007` | update channel | `update-channel` |
| `NSU-008` | mutable target | `mutable-latest`、`mutable-main` |
| `NSU-009` | remote catalog/manifest | `remote-catalog`、`remote-manifest` |
| `NSU-010` | runtime dependency install/download hook | `runtime-download` |
| `NSU-011` | update-all command | `update-all` |

clean fixture 同时包含：内嵌 catalog、固定 revision/length/SHA-256、普通 artifact URL、源码注释/帮助字符串/README 中的政策术语。它必须通过，以证明规则不是对 `update`、`latest` 等单词做裸全文搜索。

每个 negative fixture 必须：

- linter exit code 为 `1`；
- 恰好产生一个 violation；
- violation rule ID 与 fixture 预期完全相等；
- 只报告相对路径，不包含本机绝对路径；
- 不因为执行测试改变 fixture/prototype 字节。

输入/扫描器错误使用 exit code `2`；CI 必须把 `1` 和 `2` 都视为构建失败。

### 3.1 生产接入点

生产技术栈选定后，packaging gate 必须把以下**完整 materialized inventory**交给 policy adapter：

1. production source/config 与 generated source；
2. root package manifests 和 resolved dependency lock/SBOM；
3. packaged command/IPC/service/scheduler registry；
4. bundle resources、update metadata、install hooks 和 helper manifests；
5. native/opaque binary 的供应链声明与专用 scanner 结果。

Prototype linter 忽略 Markdown/TXT/RST/AsciiDoc 和开发 test/fixture 目录，避免政策说明/负例自触发。它会列出 unsupported files；生产 CI 不得把 `ignoredUnsupportedFiles` 非空的结果直接解释为完整覆盖，必须把每类输入交给对应 binary/SBOM/bundle scanner 或经 release gate 批准。

`P2-INS-002` 的 embedded catalog loader 消费本 ADR：只能装载与当前 app version 一起交付的 catalog，不能加入 remote fallback。可选 `P0-ARC-008` comfy-cli PoC 也必须在 isolated config/command allowlist 中证明无 cloud、telemetry、update、latest 或 runtime installer surface。

## 4. 可自动验收的不变量

| ID | 不变量 | 证据 |
|---|---|---|
| `NSUA-001` | clean build plan 通过 | clean fixture exit 0、0 violations |
| `NSUA-002` | 13 个负例精确 fail closed | 每例 exit 1、恰好一个预期 rule ID |
| `NSUA-003` | prose/comment/help text 不误报 | clean README 被明确忽略；clean source 含术语仍通过 |
| `NSUA-004` | embedded immutable artifact URL 允许 | clean component catalog 被扫描且通过 |
| `NSUA-005` | linter 无网络/子进程/文件 mutation 能力 | source capability boundary test |
| `NSUA-006` | lint 无持久化副作用 | prototype tree 前后内容 hash/文件集合完全一致 |
| `NSUA-007` | 输出不泄露绝对 fixture path | JSON report 只含 basename 和相对文件 |
| `NSUA-008` | rule registry 完整 | `NSU-000` 至 `NSU-011` 唯一且连续 |

这些证明仅覆盖 policy、linter 和 fixtures，不证明未来 Electron/Tauri/.NET package 或第三方 native binary 没有隐藏 updater，也不替代 allowlisted process-tree 的在线 egress capture。

## 5. 未来 TUF/等价更新计划的触发门

出现下列任一超出 ADR-015 狭窄 Stable 下载合同及 ADR-016 狭窄交互式 Setup 启动合同的提案，无自动更新边界立即保持 fail closed，并在代码合并前启动新的 remote-update scope ADR：

1. app 在没有用户明确点击“下载并安装”时检查、发现、下载或启动新 app version，或静默完成安装；
2. 从网络读取 catalog/manifest/recipe/compatibility/revocation 元数据；
3. Stable/Testing 或任何 update/promotion channel；
4. 后台、启动时、tray、service、CLI/helper 或 IPC update path；
5. 无新 app 安装包却替换 component/model/runtime/frontend/node；
6. remote metadata 决定目标 URL、version、hash、license 或 capability；
7. emergency hotfix、forced minimum version 或 silent security update。

新的更新项目在启用远程 metadata 或 updater PoC 前，必须通过 TUF 或证明满足下列同等威胁属性的方案：

- 信任根安全 bootstrap、角色/职责分离和适当的 threshold signing；
- metadata/target version monotonicity、rollback protection 和最低安全版本策略；
- expiry/freshness、freeze detection，以及错误/回滚系统时间策略；
- snapshot/target 一致性、length/hash 验证、mix-and-match 与 partial metadata 防护；
- root/online/targets key rotation、revocation、compromise recovery 和审计；
- channel 密钥/metadata/缓存隔离与明确 promotion；
- staged download、atomic activation、N/N-1 配置迁移、失败回滚和不可恢复状态处理；
- 用户同意、管理员权限、代理/离线/限流、隐私与 update telemetry 政策；
- 更新中的 app/helper/process-tree allowlist、签名、SBOM、来源和 egress evidence；
- replay、freeze、rollback、mix-and-match、expired/revoked/wrong-channel、MITM、磁盘满、断电和 N-1 回滚测试。

仅有 HTTPS、单个代码签名证书、remote JSON 内的 hash、可关闭开关或 vendor updater library 都不等价。方案是否“等价”必须由安全 owner 的威胁模型和验证证据决定，不能由功能 Agent 自行宣布。

在该 gate 未关闭时，失败回退始终是：**保留当前版本并准确显示失败；用户可从固定 Release 页面取得独立安装包。未取得 Authenticode 时不得把 SHA-256 描述为发布者身份。**

## 6. 被否决的方案

### A. 打包 updater，但默认关闭

**否决。** dormant dependency/service 仍扩大供应链和进程面，且可能被配置、环境或依赖默认值重新启用。

### B. 远端 catalog 只返回带 SHA-256 的目标

**否决。** 若攻击者可回滚/冻结/混搭 catalog，也可替换目标 hash；单个 remote JSON 自带 hash 不能建立外部信任。

### C. GitHub `latest`/`main` 加 HTTPS

**否决。** 目标可变，无法与已认证 recipe 和离线复现绑定；HTTPS 不提供版本/冻结/回滚语义。

### D. 仅扫描单词 `update`、`latest`、`channel`

**否决。** 会误报政策文档、UI 帮助、数据迁移和普通业务文本，同时仍可漏掉换名 API。使用结构化 manifest 检查和明确 executable patterns。

### E. 运行时缺依赖时自动 pip/npm/Git/Manager 安装

**否决。** 破坏 immutable generation、离线重复运行、SBOM/许可、回滚和 process-tree 边界。缺失依赖必须让 generation 验证失败并回到显式安装/修复流程。

## 7. 后果与限制

### 正面

- Alpha 不需要在首个垂直切片内建设远程更新信任系统；
- app version、catalog、recipe、runtime 和 workflow evidence 可确定性绑定；
- managed runtime 的离线和 allowlisted process-tree 声明更容易验证；
- 不会通过 updater/helper 静默加入云节点、社区加速或未经认证组件；
- build failure 有稳定 rule ID，可用于不同生产技术栈的 packaging adapter。

### 成本

- 用户需要明确点击“下载并安装”，并在可见的 Windows Setup/UAC 中完成或取消安装；
- Alpha 不能强制即时 hotfix，安全问题可能要求撤回分发并发布新安装包；
- component catalog 随 app 发布，不能独立热更新；
- linter 需要生产 stack adapter、resolved dependency/SBOM 和 binary/bundle gate 才能成为完整 release evidence。

## 8. Phase 0 证据

从仓库根执行：

```powershell
node .\prototypes\phase0\no-self-update\test-policy.mjs
```

预期并已观测的最终结果：

```text
PASS linter capability boundary is read-only, offline, and child-process-free
PASS clean fixture (embedded immutable catalog, normal artifact URL, prose-only mentions)
PASS NSU-001 rejects forbidden-dependency precisely
PASS NSU-002 rejects updater-service precisely
PASS NSU-003 rejects background-scheduler precisely
PASS NSU-004 rejects update-script precisely
PASS NSU-005 rejects updater-config precisely
PASS NSU-006 rejects update-endpoint precisely
PASS NSU-007 rejects update-channel precisely
PASS NSU-008 rejects mutable-latest precisely
PASS NSU-008 rejects mutable-main precisely
PASS NSU-009 rejects remote-catalog precisely
PASS NSU-009 rejects remote-manifest precisely
PASS NSU-010 rejects runtime-download precisely
PASS NSU-011 rejects update-all precisely
PASS fixture/prototype tree is byte-identical after linting
RESULT passed=16 failed=0
```

### 证据分级

- **Proven：** 当前 Node linter 对 clean/13 negative fixtures 的规则、退出码、精确 ID、只读/无网络能力和 prototype 内容不变。
- **Inferred：** 同一 policy 经选定 production stack adapter 扫描完整 materialized inventory 后，可成为 packaging build gate。
- **Blocked：** production stack/package 尚未选定；resolved lock/SBOM、opaque bundle/native binary、真实 process-tree egress 尚无本 ADR 的集成证据。
- **Not implemented：** 后台/self-directed updater、静默安装、TUF/等价信任、key 或 remote component catalog。ADR-015 的固定 Stable Release 元数据/用户主动 Setup 下载和 ADR-016 的受限交互式启动是唯一例外。

上述 16/16 是 ADR-011 原始 Phase 0 linter 的历史证据，不证明 ADR-016 的下载后复核、单次启动、空参数或“启动成功后才退出”。这些能力必须由 ADR-016 的独立生产专项测试和发布门禁证明。

## 9. 重新评审触发

以下变化必须重新打开本 ADR并先关闭第 5 节 gate：

- 在 ADR-015 合同之外加入任何 updater dependency/service/scheduler/config/endpoint/channel；
- application 或 component catalog 不再只来自当前签名 app；
- 允许 remote recipe/capability/compatibility/revocation metadata；
- 引入 mutable target、silent component replacement、runtime installer 或 update all；
- app 在 ADR-015 合同之外发现/下载 installer，或在 ADR-016 合同之外启动任何 installer；
- production build inventory、packaging stack、SBOM/bundle format 改变而现有 scanner 不再完整；
- 希望把 policy violation 降为 warning 或允许 remote fallback。

不涉及远程更新的普通 schema/data migration 可以使用自己的明确命令名和事务测试；不得为了避开本 policy 把 updater 改名为 migration、repair、sync 或 catalog refresh。
