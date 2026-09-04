# ADR-012：Managed Core 进程、端口与网络所有权协议

- **状态：** Accepted（Root 于 2026-08-27 完成 14 项进程证据与两级网络门主审）
- **日期：** 2026-08-27
- **任务：** `P0-ARC-010`
- **依赖：** Accepted `ADR-002`、Accepted `ADR-009`、Accepted `P0-ARC-006`
- **适用范围：** 工具拥有的 Managed Core backend 启动、身份验证、停止、崩溃回收和网络声明
- **不改变：** 产品生成职责、Comfy workflow schema、registry、模型或安装布局合同

## 1. 结论

Managed Core 只能采用以下顺序创建 backend：

```text
runtime read lease 已取得
  -> 校验 immutable generation / image / arguments / paths / identity
  -> 独占保留 127.0.0.1:<port> listener
  -> 建立 non-breakaway + KILL_ON_JOB_CLOSE Job
  -> CreateProcessW(CREATE_SUSPENDED, exact image, fixed argument array)
  -> 查询 PID creation time / parent / canonical image / hash
  -> AssignProcessToJobObject
  -> 查询 Job membership 与 limit flags
  -> 仅在全部一致后 ResumeThread
  -> 通过继承 listener + launch token 校验 endpoint identity
```

任一创建、分配、查询或身份步骤不成立都失败关闭。进程仍 suspended 时使用原始 process
handle 终止；已经 resume 后只终止已验证的 Job。禁止降级成普通启动后“尽快 attach”。

本任务用假 .NET Framework child/grandchild 和 loopback socket 在当前 Windows 主机上证明了
这条顺序。它没有启动 Python、ComfyUI、H3、模型或 GPU，也没有提交 `/prompt`。实际视频和
原生音频仍只能由 MiniMax H3 在 ComfyUI 中、用户点击 Run 后生成。

## 2. 身份域与租约

四类 correlation identity 必须分域：

| 域 | 语义 | 启动时状态 |
|---|---|---|
| generation correlation | 本次解析/验证 immutable generation 的诊断关联 | UUIDv4 |
| process/launch correlation | 一次 OS process envelope 与 launch journal | 各自独立 UUIDv4 |
| instance correlation | 长寿命 backend instance | 独立 UUIDv4 |
| run correlation | 一次真实、可见的 frontend 用户 Run | **必须为 null/omitted** |

run correlation 只能在锁定 frontend 捕获真实用户 Run event 后创建；提前生成 ID 不构成排队
授权。launcher、health probe 和本 ADR 的 fake tests 都不得创建正式 run ID 或提交请求。

每次 launch 另生成至少 256 bit CSPRNG `launch token`，只用于本次 inherited endpoint 的
rendezvous/identity 校验。它与 correlation ID、ADR-009 owner token 均不复用。token 不是抵抗
已控制同一 Windows 用户会话恶意软件的认证边界；普通日志、support bundle、公开结果、错误
文本和 URL 均不得包含它。量产实现应优先通过继承的单次 pipe/shared memory 传 token，避免
把它长期留在命令行。本 spike 为验证参数边界而使用命令行传递，但只在内存中比较并做输出
脱敏，不能直接复制成 release secret transport。

创建进程前，调用方必须按 ADR-009 获取 `runtime:<generation-id>` read lease，并一直持有到
backend 进程树完全停止。resource owner token 与 launch token 分开保存。`project-run` lease
只在真实用户 Run 进入执行域时获取，不由 launcher 预占；缺 runtime lease 时不得调用
`CreateProcessW`。本 spike 使用明确的 fake lease receipt 接口消费该顺序，未重复实现或替代
ADR-009 ledger。

## 3. 启动前的 immutable 输入

launch spec 必须由已接受 recipe/active generation 派生并锁定：

- generation ID、manifest hash、recipe/backend/frontend revision 和 schema fingerprint；
- canonical executable path、artifact SHA-256、允许的 generation root；
- 固定 working directory、instance temp/log/input/output 路径和最小环境；
- exact `127.0.0.1` bind、端口 reservation policy；
- 固定参数数组；用户 prompt、项目文本和素材名称不能变成额外启动开关；
- 允许的 child image/hash/parent relation；
- Job limits 必须精确含 `KILL_ON_JOB_CLOSE` 且不含 `BREAKAWAY_OK` 或
  `SILENT_BREAKAWAY_OK`。

路径必须先做 canonical containment、owner、reparse/device/ADS/traversal 检查。进程环境采用
allowlist，不继承 proxy、cloud token、credential、用户 Python/PATH 或下载器变量。启动 image
必须是 generation 内哈希锁定的私有 executable；本 spike 的假 executable 位于隔离 generation
fixture，不代表真实 Python/Comfy artifact 已获批准。

Win32 最终接收 command-line buffer，但控制面 API 必须保持 `executable + string[] args`。实现
只能用经过测试的 Windows quoting 算法逐参数编码，不能经 `cmd.exe`、PowerShell、batch 或
字符串 shell。包含空格、Unicode、`&|><^%!;$()` 的假标签已作为单个 literal 参数 round-trip，
且未创建注入 sentinel。

## 4. 端口 reservation 与 handle transfer

端口号不是身份。launcher 必须先创建 exact IPv4 loopback listener，启用 exclusive address use，
再 bind `127.0.0.1:0` 或已批准端口。reservation 失败意味着该端口由未知 owner 占用：不 attach、
不 kill、不换端口猜测。

本协议通过 `PROC_THREAD_ATTRIBUTE_HANDLE_LIST` 只把 listener 与标准流的精确 handles 继承给
suspended child。child 在 resume 前已经拥有 reserved listener，因而不存在“parent 关闭端口、
child 重新 bind”间隙。parent 在成功 resume 后关闭自己的 listener copy；握手 PID/creation/
parent、随机 token、reported port/bind 和 Job membership 必须同时匹配。wrong owner、wrong port、
stale token 都失败关闭。

量产实现仍应记录 Windows socket owner evidence或等价 inherited-handle lineage，并验证 endpoint
属于该 Job process tree。仅端口可连接、页面可打开或进程名类似均不合格。

## 5. “第一条第三方指令之前” containment

必须先创建并设置 Job limits，再用 `CREATE_SUSPENDED` 创建精确 image。child primary thread 仍未
运行时，launcher 完成：

1. 从 process handle 获取 PID、creation FILETIME、parent PID；
2. 查询 canonical process image 并重算 artifact hash；
3. `AssignProcessToJobObject`；
4. `IsProcessInJob(child, exactJob)`；
5. `QueryInformationJobObject` 确认 limit flags 精确为 non-breakaway
   `KILL_ON_JOB_CLOSE`；
6. 检查 first-body marker 尚未出现；
7. 最后才 `ResumeThread`。

本 spike 的 marker 在 fake child 首个业务 body 写入。14 项测试证明 marker 在 assignment/verify
之前不存在、resume 后出现，child 的第一个 grandchild 自动继承 exact Job。

作为负向对照，测试故意普通启动另一个 fake parent，让它先派生 grandchild，再把 parent 加入
新 Job：grandchild 确实留在新 Job 外，关闭 Job 只能杀 parent；测试随后依据精确 PID creation
identity 清理逃逸的 fake child。这证明“start then quickly attach”不是可接受近似，负向控制代码
不得进入产品 launcher。

## 6. breakaway、nested Job 与 PID reuse

- 任何请求的 `BREAKAWAY_OK`/`SILENT_BREAKAWAY_OK` flag 在进程创建前拒绝；
- contained fake child 实际尝试 `CREATE_BREAKAWAY_FROM_JOB | CREATE_SUSPENDED`，当前主机返回
  access denied；若未来该调用成功，launcher gate 必须失败；
- 当前主机上的 pre-existing/nested Job 测试成功：outer Job 中的 suspended owner 创建 inner
  non-breakaway Job，inner child 在 resume 前通过 membership；
- 其他 Windows/企业 Job policy 若不允许安全 nested assignment，只能在 child suspended 时终止并
  报 `JOB_ASSIGN_FAILED`，不能要求 breakaway 或放弃 containment。

owner identity 至少为：

```text
launch correlation + private launch token
PID + process creation FILETIME
canonical image path + artifact hash
parent PID + exact Job handle/membership
generation/instance identity
```

停止时先用 PID 打开 handle，再重验 creation time、image/hash 和 Job membership。任一不匹配都不
终止。Phase 0 通过人为改变 creation FILETIME 覆盖 PID-reuse 防护分支，证明它拒绝并保留 live
process；测试没有等待 Windows 实际复用同一 PID，因此“真实 PID 重用发生”不属于已证明事实。

## 7. backend/frontend/schema endpoint identity

从 `LAUNCHING` 进入 `IDENTITY_VERIFIED` 需要全部相等：

- launch token、launch/process/instance/generation correlation；run correlation 仍为空；
- PID、creation time、parent、Job membership、image/hash；
- inherited `127.0.0.1:<reserved-port>` lineage；
- generation ID/manifest hash；
- backend revision、frontend revision、schema fingerprint。

fake helper 对 token、port、backend、frontend、schema 和 bind 分别注入 mismatch。所有 mismatch
只发生在 process 已经安全 containment 后，并触发 exact Job teardown；没有未知进程被 attach 或
结束。真实 Comfy identity/read-only health/object schema 尚未运行，仍是后续 managed runtime gate。

## 8. 网络所有权边界

backend bind 必须是字符串和 socket address 都精确等于 `127.0.0.1`。`0.0.0.0`、LAN 地址、
hostname、IPv6/wildcard、remote CORS/tunnel 均在 create 前拒绝；child 若回报 wildcard bind 也立即
关闭 owned Job。只允许 locked frontend、launcher 和 backend 使用本次验证 origin。

**Job Object 不提供网络隔离。** 本 spike 特意让已 containment 的 fake child 连接另一个 loopback
decoy port；capture 收到连接后，identity policy 将其分类为 unexpected egress 并终止 exact Job。
这只证明 fake process 的 detection/escalation 与归因边界，不证明真实 Comfy process tree 已完成
离线复跑，也不证明外部非 loopback 流量已被 OS 阻断。

网络资格拆成两个彼此独立、不得混称的 gate。

### 8.1 Gate A：基础 Alpha `managed_local_offline_qualified`

Gate A 决定某个精确 recipe/generation 是否可以作为基础 Alpha 本地运行。它是受管、已审核代码的
运行资格，不是恶意代码级网络沙箱。至少需要同一 locked recipe 的以下证据全部通过：

1. process image、hash、parent/child relation 和 generation root 全部在 allowlist，运行期间没有未知
   child、外部 Desktop/Core 或 generation 外 helper 加入受管树；
2. Partner/API nodes 被禁用，ComfyUI Manager 被禁用，runtime `pip`/node/model/download 与自动更新
   hook 被禁用；配置证据和运行时观察必须一致；
3. 所有模型、wheel、node、frontend 和输出依赖完成安装并验证后，在真实断网条件下对同一 recipe
   完整复跑；不得临时联网修复、下载或改走另一条 route；
4. 在联网 QA 环境对 launcher、backend、frontend、custom node、FFmpeg/finalizer 和全部 descendants
   做完整受管树 capture，覆盖 backend 启动、可见用户 Run 到最终文件落盘；只允许声明过的 loopback
   IPC，不能出现未声明外联；
5. 使用受控 decoy egress 负例证明 capture 能看见、归因到 exact generation/process tree，并使该
   注入运行失败关闭。Phase 0 的 loopback decoy 只证明 harness 机制，不能替代真实 recipe 的此项证据。

任一真实运行观察到未声明 egress、未知 descendant、下载 hook 或配置漂移时，该精确 recipe/generation
立即失去 Gate A 资格：禁止选择并禁止 launch，直到新 revision 重新取证。不能忽略告警、降级为 attach
外部实例或 fallback 到 Partner/API/云推理。Gate A 通过后可以运行基础 Alpha，并只能表述为“安装完成
且依赖齐全后，该受管配方已通过本地离线运行测试”；它不允许宣称恶意 custom node 已被系统防火墙
阻断，也不允许把一次 capture 概括成操作系统强制零外联。

### 8.2 Gate B：可选增强 `os_enforced_zero_egress`

Gate B 仅控制更强的 `os_enforced_zero_egress` 声明。它需要经过发布评审的 WFP、Windows Firewall、
AppContainer 或等价真实 OS enforcement，绑定 exact generation/process tree，并用受控负例证明
非 loopback connect 被操作系统拒绝，而不只是被记录后终止。API nodes disabled、清空 proxy、Job
Object 或一次成功抓包均不能替代 Gate B。

Gate B 未通过时，只隐藏/禁止 `os_enforced_zero_egress` 徽标、文案和策略承诺；已经通过身份、
containment 与 Gate A 的 recipe 仍可作为基础 Alpha 运行。Gate B 失败也绝不授权 API/云 fallback。
现阶段未对 real Comfy 执行 locked identity 和 Gate A，所以它仍是 evidence-only/disabled；Gate B
同样尚未执行，但不是这次基础禁用的原因。后续只要 locked identity 和 Gate A 通过即可解除基础运行
禁用，不能再把 Gate B 误设为永久前置。

同一 Windows 用户会话中已经控制用户账户的恶意软件不在本 ADR 的认证威胁边界内。任意用户现有
Desktop/custom-node 实例也不能因 workflow allowlist 或兼容探测继承 Gate A/Gate B；这保持 D-016。
本 Phase 0 不连接公网，也没有执行或伪造上述 real Comfy capture、断网复跑或 OS enforcement 证据。

## 9. stdout/stderr、日志与诊断

child stdout/stderr 必须通过 handle allowlist 中的匿名 pipe 接管，不能继承控制台或写任意用户
路径。普通日志采用事件 allowlist，只输出 code、阶段、opaque correlation；不记录 raw line。
validation error 不回显 token、命令行、prompt、用户名或绝对路径。

fake child 故意把 launch token 与 executable absolute path 写入 stdout/stderr；harness 只返回
`sensitive-line-count` 和 `raw-value-returned=false`，公开 JSON 只保留 test ID/status。公开 lint 扫描
ADR、源码、README 和 evidence，拒绝账户目录绝对路径与当前用户名。raw runtime `work/` 和编译
artifact 被 `.gitignore` 排除。

## 10. owned shutdown、崩溃与 unrelated process

正常停止先通过已验证 control connection 请求 graceful shutdown，并等待固定 timeout。超时后：

1. 以 PID + creation + image/hash 重新打开 root process；
2. 再确认它仍属于 exact Job；
3. 只调用 `TerminateJobObject(exactJob)`；
4. 等待 root/descendant 退出并记录脱敏结果。

不得按端口、窗口标题、process name 或裸 PID 杀进程。测试伪造 creation/image 时停止被拒绝且 live
root 保留；正确 timeout escalation 杀死 root+grandchild，同时另一个相同 fake image、但不在该
Job 的 unrelated process 保持存活。

Job handle 只由 owner process 持有，不继承给 child。`KILL_ON_JOB_CLOSE` 的 parent-crash 测试强制
终止 owner，root+grandchild 随 handle close 全部退出。量产 launch journal 在下次启动时仍须依据
PID creation/image/Job evidence判断 orphan；不能因为 journal 存在或 TTL 到期就杀/认领进程。

## 11. Phase 0 验收结果

命令：

```powershell
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\prototypes\phase0\managed-process-ownership\scripts\Run-Tests.ps1
```

最终状态连续运行两次，均为：

```text
PASS MP-001-containment-before-first-instruction
PASS MP-002-runtime-lease-before-create
PASS MP-003-preassignment-escape-negative-control
PASS MP-004-breakaway-config-and-attempt
PASS MP-005-nested-preexisting-job
PASS MP-006-pid-creation-identity
PASS MP-007-image-and-generation-allowlist
PASS MP-008-port-owner-and-transfer
PASS MP-009-token-port-and-runtime-identity
PASS MP-010-loopback-only-bind
PASS MP-011-contained-egress-capture-boundary
PASS MP-012-shell-metacharacter-literal-argument
PASS MP-013-parent-crash-kills-job-tree
PASS MP-014-timeout-escalation-preserves-unrelated
RESULT passed=14 failed=0
```

两次 public-evidence lint 均通过。测试只编译/启动隔离 fake executable、使用 loopback socket 和
prototype 内忽略目录；没有模型、Comfy、GPU、外网、registry、全局 toolchain 变更或用户文件写入。

### Proven（限当前主机、fake process）

- suspended create、assignment/membership/flags verify 全部发生在 resume/marker 前；
- child/grandchild inheritance、breakaway denied、nested Job 成功；
- 不安全 pre-assignment 的真实逃逸反例；
- exclusive loopback listener handle transfer 与 wrong owner/token/port/bind/identity fail closed；
- PID creation/image/Job stop guard、parent-crash kill-on-close、timeout escalation；
- unrelated process preservation、literal metachar argument、stdout/stderr redaction；
- resource lease receipt 先于 process create；run correlation 在 launch 时为空。
- contained fake child 的 loopback decoy egress 可被 harness 观察、归因并触发 exact Job teardown；
  这不是 real recipe Gate A，也不是 Gate B 的 OS deny 证据。

### Inferred / protocol-only

- 相同 Win32 protocol 可应用于 locked private Python/Comfy image；
- production generation/path/ACL/reparse validation 与 native packaging可以保留相同语义；
- 真实 backend/frontend/schema 可通过只读 identity surface 提供同一 tuple；
- Gate A 的 allowlisted-tree、配置禁用、断网复跑、全树 capture 和 decoy 负例可组成基础 Alpha
  offline qualification；尚无 real Comfy 运行证据，不能提升为 Proven。

### 尚未执行：基础 Gate A

- real Python/Comfy/custom-node process tree 与真实 endpoint identity；
- 完整安装后的真实断网复跑；
- 联网 QA 环境中的真实全树 capture，以及 real recipe decoy egress 负例；
- API/Manager/runtime-download disabled 的真实配置与运行时一致性证明。

上述任何一项未通过时只阻断对应 real recipe/generation 的基础 launch，不把 fake spike 当作替代证据。

### 尚未执行：可选 Gate B 与其他平台矩阵

- WFP/Firewall/AppContainer/等价机制的真实非 loopback OS deny certification；Gate B 未通过只阻断
  `os_enforced_zero_egress` 强声明，不阻断已经通过 Gate A 的基础 Alpha recipe；
- 实际 PID reuse、跨 Windows session/service、企业 Job policy矩阵；
- signed packaged launcher、ACL、AV/EDR、sleep/resume、upgrade/crash journal集成；
- 真正 frontend user Run 与 first `/prompt` correlation（本任务禁止提交）。

## 12. 被否决的方案

1. **普通 start 后按 PID attach Job：** grandchild 可在 assignment 前逃逸；已有实测反例。
2. **允许 breakaway 以兼容宿主 Job：** 会破坏 process-tree ownership；必须 fail closed。
3. **关闭 reservation 后让 child 重 bind：** 留下 wrong-owner race；使用 inherited listener。
4. **端口或 token 单独作为身份：** 二者都不是 OS ownership；必须与 handle/process/Job/generation tuple
   联合验证。
5. **按 name/port/PID kill：** PID reuse 和外部 Comfy 会导致误杀；只终止 exact verified Job。
6. **把 Job 当防火墙：** Job 不阻止 socket；基础 Alpha offline 资格必须过 Gate A，只有更强的
   `os_enforced_zero_egress` 声明才要求独立 Gate B OS enforcement。
7. **经 shell 启动：** 引入 quoting/injection 与间接 process tree；只允许 exact image + argument array。
8. **将 unknown/nested Job 错误降级为无 Job：** 不可证明 first-instruction containment时保持 disabled。

## 13. 后果、接入 gate 与重审触发

正面结果是 installer/runtime adapter 获得单一、可测试的 ownership state machine；停止不会误杀外部
Desktop/Core，parent crash 也不会留下已知 child tree。代价是需要 native Windows launcher、Job/
socket handle 生命周期、最小环境、release signing 和更多企业策略测试。

`P2-INS-013` 与 `QA-005` 实现/验证本协议时必须保留下列依赖；把某个 real Comfy recipe 标记为
基础 Alpha 可运行前，至少需要：

1. 将本协议移植到 Root 选择的 production stack，保持全部 14 项 fixture；
2. 使用 ADR-009 真实 runtime read lease/owner identity，不接受 boolean receipt；
3. 接入 P0-ARC-006/ADR-002 generation ownership、path/reparse/ACL 与 immutable hash；
4. 固化 launch journal/redaction/support schema；
5. 为 real Comfy 执行 locked identity probe，但仍不自动 `/prompt`；
6. 关闭 Gate A：验证 allowlisted managed tree、API/Manager/runtime-download disabled、完整安装后断网
   复跑、联网全树 capture 与 decoy egress 负例；任一未声明 egress 使该 recipe/generation disabled；
7. Gate B 可后置：只有发布 `os_enforced_zero_egress` 强声明前才必须完成真实 OS deny 取证；未完成
   Gate B 不得阻断已经通过 Gate A 的基础 Alpha launch，也不得触发 API/云 fallback；
8. 对签名 package、非管理员用户、AV/EDR、sleep/resume、parent hard crash 和升级做 Windows QA。

Root 接受本 ADR 后解锁 `P2-INS-013`、`QA-005`，并约束 `QA-009`。以下变化必须重审：Job flags/
assignment sequence、token transport、port transfer、允许 child image、nested/breakaway policy、网络隔离
机制、停止 identity、跨 session/service、run correlation 或任何允许工具提交首笔 formal queue 的改变。

## 14. 影响声明

- Schema/API：未修改共享 schema；本 prototype 类型不是 production API。
- Registry/主计划/root lockfile：未修改。
- 全局系统状态：未安装 SDK/package、未写 PATH/registry/firewall。
- ADR 保持 Proposed，接受状态由 Root 决定。
