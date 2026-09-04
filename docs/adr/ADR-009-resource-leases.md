# ADR-009：安装控制面的资源租约协议

- **状态：** Accepted（Phase 0 协议与假 worker 证据已由 Root Integration 独立复跑并接受）
- **日期：** 2026-08-27
- **任务：** `P0-ARC-012`
- **来源：** `docs/reviews/CROSS_INSTALLER_ON_WORKFLOW.md` 的 `XW-06/XW-06a`
- **相关约束：** `AGENTS.md`、`docs/MASTER_ORCHESTRATION.md`、`docs/OPTIMIZED_ARCHITECTURE.md`
- **适用范围：** artifact 获取、卷空间预留、immutable runtime generation、GPU 认证/运行、project Runner/checkpoint mutation

## 1. 背景

Agent slot、线程或 UI 窗口空闲不代表模型 artifact、磁盘、runtime generation、GPU 和同一项目可以并发使用。若 downloader、更新器、GPU PoC 和 Runner 各自使用临时 lockfile，会出现重复下载、同卡争抢、磁盘峰值超卖、更新时仍被读取，以及两个 Runner 同时修改 checkpoint 等问题。

锁也不能简单依赖超时时间：H3 推理、模型 hash、睡眠/唤醒和调试暂停都可能超过估计时长。以 TTL 到期直接抢锁会把一个正常长任务误判为死亡。仅记录 PID 也不够，因为 Windows 会重用 PID。

Phase 0 需要先证明一个不接触真实模型、GPU 或 ComfyUI 的最小协议，再让 downloader、runtime updater、GPU certification 和 Runner 分别接入。租约协调器不是下载事务、runtime rollback 或 checkpoint journal 的替代品。

## 2. 决策

采用一个由本工具进程共同遵守的**协作式资源租约 ledger**。每个受管 installation/control state root 对应一个 `resource-leases.json`；所有读取、冲突判断、回收和提交都先由同一 state root 派生的 Windows named mutex 串行化。

租约协议不调用被保护资源。`gpu` key 来自上层硬件 adapter，协调器本身不枚举 GPU；`volume` 使用上层提供的容量快照，协调器不读取物理 free bytes；`artifact` 只接收 digest，不打开模型；`runtime` 和 `project-run` 只接收 opaque ID。

### 2.1 Owner identity

每个逻辑 owner 必须包含：

```text
ownerToken = random GUID token
ownerPid = Windows PID
ownerProcessStartUtcTicks = 该 PID 的进程创建时间
```

三项必须同时匹配才是同一 owner：

- token 防止同一进程内的两个 operation 互相释放租约；
- PID 标识当前进程；
- process creation time 防止 PID 重用后继承旧租约；
- owner object 只能由创建它的当前进程使用；
- 公共 acquire result 和 snapshot 不返回 owner token，普通日志与支持包不得记录 token。

owner token 是并发 identity，不是认证密钥。state root 仍必须使用当前用户专用 ACL。

### 2.2 类型、顺序和兼容矩阵

固定获取顺序为：

```text
artifact（同类型按 digest 排序）
  -> volume（同类型按 key 排序）
  -> runtime（同类型按 generation ID 排序）
  -> GPU（同类型按 LUID 排序）
  -> project-run（同类型按 key 排序）
```

| rank | 类型 | key | mode | 兼容语义 |
|---:|---|---|---|---|
| 10 | `artifact` | 64 hex SHA-256 | `write` | 相同 digest 单 writer |
| 20 | `volume` | adapter 生成的 opaque volume ID | `reserve` | 多 reservation 可共存，但总 bytes 不得超过相同 capacity snapshot |
| 30 | `runtime` | immutable generation ID | `read` / `write` | read/read 兼容；write 与任何 read/write 冲突 |
| 40 | `gpu` | 规范化 `XXXXXXXX:XXXXXXXX` LUID | `exclusive` | 相同 LUID 排他 |
| 50 | `project-run` | opaque project/run ID | `exclusive` | 相同 project-run 排他 |

owner 的新请求若小于已持有租约的 `(rank, normalized key)`，立即返回 `order-violation`，不进入等待。调用方应先计算完整资源集合，按固定顺序获取，失败时逆序释放已经取得的租约。Phase 0 不提供原子 multi-acquire；部分获取期间可能占用前序资源，但不会形成循环等待。

`runtime` 不允许 read→write 原地升级或 write→read 原地降级。调用方必须释放，再从完整有序集合重新获取。

本 ADR 的 `artifact` 只保护下载、materialization 和 full-hash writer。已安装 immutable model 的消费由 `runtime:<generation>` read lease 保护；若以后 artifact GC 需要和独立 reader 协调，必须扩展兼容矩阵和测试，不能把当前 `write` 静默解释为读写锁。

### 2.3 Acquire 状态机

```text
VALIDATE_REQUEST
  -> ENTER_COORDINATOR
  -> READ_AND_VALIDATE_LEDGER
  -> RECLAIM_ONLY_DEFINITELY_STALE
  -> CHECK_IDEMPOTENCY
  -> CHECK_ORDER
  -> CHECK_COMPATIBILITY_OR_CAPACITY
       -> AVAILABLE: ATOMIC_COMMIT -> ACQUIRED
       -> TERMINAL_MISMATCH: FAIL_CLOSED
       -> BUSY: RELEASE_COORDINATOR -> POLL
            -> deadline: TIMEOUT_WITHOUT_STEAL
```

同一 owner 以完全相同参数重复 acquire 是幂等成功；参数不同则 `request-mismatch`。同一 volume 的 active reservation 若报告不同 `capacityBytes`，返回 terminal `capacity-mismatch`，而不是选择更大值或更小值猜测。

超时只终止调用方等待，绝不改变 live/unknown owner 的租约。协议不使用 TTL。

### 2.4 陈旧 owner 判定

只有以下证据允许回收：

1. `GetProcessById(ownerPid)` 明确证明 PID 不存在；或
2. PID 存在，但实际 process creation time 与 ledger 不同，证明 PID 已重用。

下列情况不得回收：

- 仅仅超过预计时长或 acquire timeout；
- named mutex 被遗弃；
- 无法读取 process/creation time、访问被拒或检查结果未知；
- 另一个 owner 声称原 owner 已死但没有本机进程证据。

named mutex 被遗弃仅意味着新进程已经取得 ledger 协调权；它仍需按上述 PID identity 规则检查每个资源 lease。`unknown` 可以造成保守阻塞；诊断/人工恢复流程必须先收集进程和 ledger 证据，不得提供“一键强制解锁”作为默认动作。

### 2.5 Ledger 原子性

- schema version 和每个 lease 的字段、key、mode、owner identity 必须完整校验；未知或畸形 ledger 失败关闭；
- revision 每次成功 mutation 单调增加；
- 在相同本地卷和目录写临时文件，然后用 `File.Replace` 切换现有 ledger；首次创建用同卷 `File.Move`；
- `File.Replace` 使用同目录 backup 以兼容 Windows PowerShell 5.1；目标提交成功后 backup cleanup 是 best effort，cleanup 失败不得把已提交 mutation 报成未提交；
- 崩溃可能留下 `.tmp/.bak`，但不得产生半写 ledger。生产清理器只能在 coordinator 内、验证精确文件名与 state root 后清理孤儿文件；
- release 只能释放三元 owner identity 匹配的 lease；释放其他 owner 的 lease 必须失败。

生产 state root 必须位于工具拥有的本地 NTFS 目录，不能位于 SMB、FAT/exFAT 或同步盘。本 Phase 0 只证明当前用户、当前 Windows session 下的 `Local\` named mutex；若 updater/service、快速用户切换或多个登录 session 会访问同一 ledger，发布前必须选择并验证带明确 ACL 的 `Global\` mutex 或本地 NTFS 文件协调器。

### 2.6 Volume 语义

`volume` lease 是本工具进程间的**容量承诺**，不是文件系统配额，也不阻止其他应用写盘。上层 adapter 必须：

1. 将实际卷标识映射为不含用户名/绝对路径的稳定 opaque key；
2. 在规划阶段提供同一次容量快照或批准的安装预算；
3. 在 staging 写入和原子 commit 前再次读取物理 free bytes；
4. 把 partial、staging、backup、rollback generation 和缓存峰值全部计入 requested bytes；
5. 无论成功、失败或取消，都在事务收尾时释放 reservation。

因此本 ADR 不改变“默认 D 盘、用户可选位置、C 盘预算”的安装布局决策；它只阻止本工具自身并发任务重复承诺同一卷容量。

### 2.7 公平性与取消

Phase 0 使用有界 polling，不承诺 FIFO 或 writer fairness。持续到来的 runtime readers 理论上可能让 writer 饥饿。生产更新流程应先进入“停止接纳新 run”状态再等待 runtime write lease，或以后增加持久化 writer-intent/ticket 队列并单独验证。不得通过抢占 reader 解决饥饿。

取消等待只返回失败；已持有 lease 的 operation 必须在自己的 `finally`/事务补偿中逆序 release。进程异常退出依赖下一次 acquire 的 stale-owner 检查恢复。

## 3. 可自动验收的不变量

| ID | 不变量 | Phase 0 测试 |
|---|---|---|
| `RL-001` | 相同 artifact digest 同时最多一个 writer | 两个独立 fake worker，第二个在第一个持有期间无 acquired event，释放后成功 |
| `RL-002` | 相同 GPU LUID 串行 | 两个独立 worker 使用同一假 LUID |
| `RL-003` | runtime read/read 兼容，writer 排除所有 reader/writer | 两 reader 同时 acquired，writer 等两者释放后成功 |
| `RL-004` | 相同 project-run 互斥 | 两个独立 worker 串行完成 |
| `RL-005` | volume reservation 总额不超过 capacity | 70+30/100 共存，额外 40/100 超时，释放后 40 成功 |
| `RL-006` | timeout 不抢 live owner | timeout 后两 live owner 仍在 ledger，PID 未被替换 |
| `RL-007` | owner token 和 PID creation identity 都参与判定 | 不同 token 不幂等；伪造 creation ticks 被拒绝 |
| `RL-008` | 只回收 definitely stale owner | 精确强杀测试自己启动的 worker 后，successor 报告 stale reclaim 并成功 |
| `RL-009` | 反序立即拒绝 | owner 先拿 GPU 再拿 runtime，返回 `order-violation` 且不按 contention 等待 |
| `RL-010` | 公共输出不泄露私有 owner identity | 对 Acquire result 与 snapshot 同时执行属性名枚举和 `ConvertTo-Json` 负向断言；均不得出现 `ownerToken`、`ownerProcessStartUtcTicks` 或 `processStartUtcTicks`。私有 ledger 不参与此断言 |

## 4. 被否决的方案

### A. 每种组件各写一个 `.lock`，看见文件就等待

**否决。** 无统一顺序、owner identity、schema 和冲突矩阵，无法防 PID 重用，也无法协调 runtime reader/writer 或 volume bytes。

### B. lockfile 超过 N 分钟直接删除

**否决。** 模型下载、full hash、H3 运行、系统睡眠或调试都可能合法超过 N 分钟。TTL 不是死亡证明。

### C. 只使用 PID

**否决。** PID 会重用；新进程可能被误认作旧 owner，或旧 lease 被错误保留/释放。

### D. 以随机 backoff 代替固定顺序

**否决。** backoff 只能降低碰撞概率，不能消除循环等待，也不能给反序调用确定性诊断。

### E. 用 SQLite/外部 daemon 作为 Phase 0 前置

**暂不选择。** 它们可以提供更强事务或公平队列，但会增加部署、升级、ACL 和生命周期表面。先用 Windows/.NET 内置原语证明协议；跨 session、公平性或查询规模证明需要时再评估迁移。

### F. 超时后提供默认“强制解锁”

**否决。** 小白无法判断长任务、挂起、权限不足和真正崩溃。默认动作必须是诊断与等待；只有可验证死亡证据才能自动回收。

## 5. 后果

### 正面

- downloader、磁盘规划、runtime 更新、GPU PoC 和 Runner 使用同一套 owner/recovery 语义；
- 超时不会破坏仍在工作的长任务；
- 固定顺序使反序成为立即、可定位的程序错误；
- ledger 保留最小 revision 和非语义资源 ID，不需要记录 prompt、模型路径或项目名称；
- 协调器不依赖 Python、第三方 API、模型、GPU driver API 或 ComfyUI。

### 成本与限制

- 所有参与者必须合作；外部程序不受 volume/GPU lease 约束；
- JSON 单 ledger 适合安装控制面规模，不适合高频分布式调度；
- `Local\` mutex 尚不覆盖多个 Windows session；
- 没有公平队列，维护 writer 可能饥饿；
- multi-acquire 不是原子 bundle，等待后序资源时会占用前序 lease；
- 租约只避免并发冲突，不负责 partial 下载恢复、digest 验证、runtime generation commit/rollback 或 project checkpoint 原子性。

## 6. 接入 gate

Phase 0 通过不等于允许真实 H3/GPU/模型任务。接入真实组件前至少完成：

1. 将协议移植到选定控制平面技术栈，并保持 `RL-001` 至 `RL-010`；
2. 将 state root 固定为本地 NTFS，并实现用户专用 ACL、orphan temp/backup 清理和支持诊断；
3. 明确单 session 保证，或完成跨 session/service coordinator PoC；
4. downloader 同时接入 artifact writer、volume reservation 和自己的 partial-sidecar/事务 journal；
5. runtime updater 使用 write lease，Comfy/测试使用 read lease，并增加停止接纳新 run 的 writer-drain 状态；
6. GPU adapter 产生规范化 LUID，但 lease 层不得以型号名代替 LUID；
7. project-run key 使用非敏感 project/revision ID，不使用绝对路径或用户项目名；
8. 所有取消、异常、更新回滚和应用退出路径进行 lease leak/fault-injection 测试；
9. 真实模型下载或 GPU PoC 仍需 Root 分配 `MODEL-DOWNLOAD` / `GPU-H3` 协调锁，直到生产 coordinator 被评审接管。

测试脚本中的 `ExecutionPolicy Bypass` 只用于启动隔离的本地 fixture；生产程序不得把它复制为脚本供应链策略。生产包仍需签名、锁定来源并遵守已有依赖/更新 ADR。

## 7. Phase 0 证据

执行环境：Windows NT `10.0.26200.0`、Windows PowerShell `5.1.26100.7920`、workspace 所在卷 NTFS。测试没有下载或读取模型，没有枚举/调用 GPU，没有启动 ComfyUI/H3；GPU、artifact、volume 和 project 都使用假 ID/假字节。

执行命令：

```powershell
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\prototypes\phase0\resource-leases\tests\Run-Tests.ps1
```

2026-08-27 结果：

```text
PASS artifact digest permits only one writer
PASS same fake GPU LUID is serialized
PASS runtime readers coexist and exclude writer
PASS project-run is mutually exclusive
PASS volume byte reservations are bounded and timeout never steals
PASS owner token and PID creation identity are both enforced
PASS public acquire result and snapshot redact private owner identity
PASS crashed owner is reclaimed only after process death proof
PASS reverse acquisition order is rejected immediately
RESULT passed=9 failed=0
```

此证据证明的是本机 NTFS、当前 session、协作式多 PowerShell 进程的协议语义，不证明真实 GPU 排他、真实磁盘预算准确性、跨 session/service、网络盘或生产 installer 集成。

## 8. 重新评审触发

出现以下任一情况必须重新评审本 ADR：

1. 修改五类资源的 rank、key 或兼容矩阵；
2. 增加 artifact reader/GC、runtime upgrade 或抢占；
3. 允许 service、多 Windows session、远程主机或网络盘共享 ledger；
4. 引入 FIFO、公平 writer、原子 multi-acquire 或分布式 coordinator；
5. 改变 owner liveness 证据或允许 TTL/人工强制抢锁；
6. 将真实路径、prompt、模型名、项目名或凭据写入 resource key/ledger；
7. 让协调器直接下载、调用 GPU、启动 ComfyUI、提交 `/prompt` 或执行 H3；
8. ledger schema 或原子替换机制改变，或更新器需要跨 generation 事务地持有多类 lease。
