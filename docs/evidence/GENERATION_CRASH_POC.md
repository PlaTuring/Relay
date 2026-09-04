# P0-ARC-011 — Generation/active-pointer crash PoC

## 结论

**PASS（限当前 Windows 主机、fake bytes、进程终止故障）。** 原型在 12 个 materialization、marker、
pointer、cleanup 和 parent/child 故障边界终止独立 worker。完成 marker 之前的 generation 从未成为
active 或 launchable；marker 之后但 pointer 替换之前只成为已验证候选，旧 active 始终有效；同目录
原子替换之后只解析到完整的新 generation，旧 generation 本身仍保持可验证。

每个故障场景随后连续重试两次，第二次没有改变 active pointer bytes、manifest hash 或 artifact hash。
恢复逻辑从不按目录时间或“最新 generation”猜测；active pointer 无效时拒绝启动和清理。

本 PoC 只实现安装/runtime authority state 的技术验证。它没有启动或安装 Python、ComfyUI、MiniMax
H3、模型、GPU 工作、下载器、网络或媒体生成任务。实际视频和原生音频仍只能由 MiniMax H3 在
ComfyUI 中、用户点击 Run 后生成。

## 文件系统协议

```text
durable transaction intent
  -> 在最终 generation 路径创建目录
  -> 第一份受管文件为 owner marker
  -> state=building manifest
  -> 写 deterministic fake artifact bytes
  -> artifact handle fsync
  -> state=verified manifest + verification receipt
  -> durable checksummed complete.json
  -> generation 才是 ready/launchable candidate
  -> 同 control 目录 durable active.json.next
  -> 重验 candidate pointer + target generation
  -> same-directory rename replace active.json
  -> launcher 重新校验 pointer checksum、manifest、receipt、marker 和 artifact
```

`active.json` 为 362 bytes，包含 schema version、recipe/generation identity、manifest/completion hashes
和 payload checksum，不包含绝对路径或可执行命令。`complete.json` 也有独立 checksum；仅将 manifest
写成 `verified` 而没有 completion marker 仍返回 `GC.COMPLETION_MISSING`。

## 崩溃矩阵

每个前 10 项都由独立 Node worker 在写入 crash hook 后调用 Windows 进程终止语义；不是在同一进程
抛出可恢复异常。

| ID / crash point | 终止后的权威状态 | active 结果 | 重试结果 |
|---|---|---|---|
| GC-003 before generation create | 只有 transaction，无 generation；`GC.GENERATION_MISSING` | `gen-old` 完整有效 | 同 ID 安全创建并切换 |
| GC-004 after directory create | 空目录、无 owner；`GC.NOT_OWNED` | `gen-old` 完整有效 | 仅凭预先存在且精确匹配的 transaction 回收空目录后重建 |
| GC-005 mid-file | owner + building manifest + 部分 bytes；`GC.MANIFEST_INCOMPLETE` | `gen-old` 完整有效 | owned cleanup 后重建 |
| GC-006 after all bytes, before fsync/verification | bytes 可见性不作耐久性假设；无 verified authority | `gen-old` 完整有效 | owned cleanup 后重建 |
| GC-007 before completion marker | verified manifest/receipt，但无 marker；`GC.COMPLETION_MISSING` | `gen-old` 完整有效 | 重建后切换 |
| GC-008 after completion marker | `gen-new` 是完整候选但尚未 active | `gen-old` 完整有效 | 复用已验证候选并切换 |
| GC-009 before pointer temp write | 完整候选，无 pointer temp | `gen-old` 完整有效 | 写 temp、重验并切换 |
| GC-010 after pointer temp write | durable、有效 `.next` 仅为候选 | `gen-old` 完整有效 | 覆盖/重验 candidate 后切换 |
| GC-011 before atomic replace | `.next` 已重验，尚未替换 | `gen-old` 完整有效 | 原子切换 |
| GC-012 immediately after replace | `active.json` 完整指向 `gen-new` | `gen-new` 完整有效；`gen-old` 仍可验证 | 再重试为 byte-identical no-op |
| GC-013 during retry cleanup | 第一个 owned file 已删，但 owner marker 保留到最后 | `gen-old`、neighbor、unowned 和外部 sentinel 均未变化 | cleanup 可重入并成功重建 |
| GC-014 parent termination with child active | fake child 正在写 artifact 时终止 exact parent tree；generation 仍 building | `gen-old` 完整有效，child 已消失 | owned cleanup 后重建 |

GC-014 使用固定参数数组调用 Windows `taskkill /T` 终止本 harness 创建且仍存活的 exact parent PID
及其 child tree。它证明此测试中的受管树终止结果，不替代 ADR-012 的 suspended Job/
`KILL_ON_JOB_CLOSE` 量产协议。

## 不变量和负例

- 所有 incomplete 状态都由 launch-time full validation 拒绝，pointer candidate 文件从不自动生效。
- fully verified replacement 发生同目录 rename 前，旧 pointer bytes 和旧 generation hashes 保持不变。
- 每个 crash case 的第一次恢复后再次重试；active pointer bytes 与 hashes 完全相同。
- cleanup 在删除任何 owned 内容前重验 scenario、transaction、generation owner、active pointer 和
  containment；owner marker 最后删除。缺 transaction 的 unowned 目录返回
  `GC.TRANSACTION_MISMATCH` 并原样保留。
- corrupt pointer fixture 精确返回 `GC.POINTER_CHECKSUM`；指向 incomplete generation 的有效 checksum
  fixture 返回 `GC.MANIFEST_INCOMPLETE`；路径穿越 fixture 返回 `GC.GENERATION_ID_INVALID`。
- active pointer 被破坏时，resolve 返回 `GC.POINTER_CHECKSUM`，activate/retry 返回
  `GC.POINTER_INVALID`；即使存在更新、更完整的目录也不会按名称或时间自动选择。
- cleanup crash 前后，另一个 verified generation、unowned sentinel 和 `work/` 外安全 sentinel 的
  hashes 不变。

## Owned containment、路径和卷

可变树只位于原型忽略的 `work/`。每次 reset 前必须同时满足：目标是原型直属的精确 `work` 目录、
owner marker 的 fixture/path identity 完全匹配、整棵树没有 symlink/reparse escape。任何条件不成立都
拒绝递归删除。

场景根、generation、control、pointer temp 与 active pointer 位于同一 local `Fixed/NTFS` volume；内部
owner 记录并复核 volume root。实际测试路径同时包含中文、Unicode 和空格。这里使用的是仓库所在卷，
不代表产品默认安装到该卷，也不构成静默 C 盘 fallback。

## 稳定 hashes 与公开证据

所有场景使用相同 deterministic 128 KiB fake artifact：

```text
artifact SHA-256: c094f75a988b470c822f157431f2b920bd750803225be7d89374eced4a070147
recovered gen-new active pointer SHA-256: e920265dbe6ffdc1431946b05848b716971d6c233f0c2e31f870846ce7010b4d
evidence/LAST_RUN.json SHA-256: e5c9ae0f445bbf09c71f311518a1d9abcde0fa87b189e32e42282e3bfd6d5da2
```

机器证据只包含稳定 test ID、状态、能力边界和 hashes。公开 lint 拒绝当前用户名、Windows 用户目录
绝对路径、常见 token、完整环境、PID 和未限长 child log。

## 验收命令与结果

从仓库根运行：

```powershell
node .\prototypes\phase0\generation-crash\scripts\run-harness.mjs
```

最终代码和报告下连续运行两次均为：

```text
RESULT 19/19 checks passed
PASS evidence-written sha256=e5c9ae0f445bbf09c71f311518a1d9abcde0fa87b189e32e42282e3bfd6d5da2
```

## 证据边界：process kill 不等于 power loss

### 已证明（当前 Windows 主机）

- 独立 materializer process 在命名步骤被强制终止后的文件可见状态与 fail-closed recovery；
- 已显式 `fsync` 的普通文件、completion marker 和 pointer temp 在**进程终止后**可重新读取；
- same-directory rename 前后 active pointer 在测试进程重启后的 old-or-new 完整可见性；
- exact fake parent tree 终止、cleanup 二次终止和幂等恢复；
- owned containment、Unicode/space path、同 Fixed/NTFS volume identity 与公开证据脱敏。

### 未证明 / 后续 QA-014 门

- 真实断电、VM power-off、kernel crash、磁盘控制器缓存或设备断电后的 persistence；
- NTFS directory-entry/rename 在真实 power loss 下的 durability、write ordering 或 torn-write 行为；
- `fsync`/write-through 是否穿透所有 Windows、虚拟化和存储硬件缓存层；
- 磁盘满、盘符消失、坏块、锁文件、AV/EDR、ACL、长路径、休眠/恢复或企业存储策略；
- 并发 installer/lease、真实 Python venv、Comfy Core、wheel、模型或大文件 materialization。

因此本 PoC 不能被宣传成“断电绝不损坏”。真实 power-loss/NTFS durability 必须由 QA-014 在受控 VM
或硬件故障环境重新验证。失败时保留最后仍能通过 pointer+generation 全校验的版本并拒绝 launch；
绝不通过猜测最新目录修复。

## 产物和影响

- `prototypes/phase0/generation-crash/src/`：协议、独立 crash worker 和 fake writer child。
- `prototypes/phase0/generation-crash/scripts/`：确定性 harness 与只读 volume probe。
- `prototypes/phase0/generation-crash/fixtures/`：安全 sentinel 和三项静态 pointer 负例。
- `prototypes/phase0/generation-crash/evidence/LAST_RUN.json`：19 项脱敏机器证据。
- `prototypes/phase0/generation-crash/work/`：本地可重建、被 `.gitignore` 排除的绝对路径状态。

未修改 schema、registry、主计划、root package/lockfile 或 P0-ARC-006 fixture。Root 接受后可解锁
`P0-CON-006`、`P2-INS-010` 和 `QA-014`。
