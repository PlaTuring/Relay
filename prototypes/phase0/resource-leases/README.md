# P0-ARC-012：资源租约协议原型

这是 Windows 安装控制面的**协作式租约**原型。它只用 JSON 元数据、Windows named mutex 和多个自有 `powershell.exe` 假 worker 验证并发语义；不枚举或调用 GPU，不读取/下载模型，不启动 ComfyUI，也不运行 H3。

## 原型包含什么

- `ResourceLeases.psm1`：租约 ledger、固定顺序、冲突判断、原子替换、owner 存活证明和保守回收。
- `FakeWorker.ps1`：只申请/持有/释放假资源标识，并把阶段事件写入隔离测试目录。
- `tests/Run-Tests.ps1`：启动多个独立 Windows PowerShell 5.1 进程，验证互斥、共享、超时和崩溃恢复。

## 五类租约

| 顺序 | 类型 | key 契约 | mode | 语义 |
|---:|---|---|---|---|
| 10 | `artifact` | 完整 64 字符 SHA-256 digest | `write` | 同一内容 artifact 只允许一个 writer |
| 20 | `volume` | adapter 产生的非路径 volume ID | `reserve` | 在相同容量快照内协作预留字节；不实际分配磁盘空间 |
| 30 | `runtime` | immutable generation ID | `read` / `write` | 多 reader 或单 writer；不支持原地升级 |
| 40 | `gpu` | 规范化 LUID：`XXXXXXXX:XXXXXXXX` | `exclusive` | 同一 GPU LUID 串行；本 PoC 只使用假 LUID |
| 50 | `project-run` | 非路径 project/run ID | `exclusive` | 同一项目正式运行互斥 |

一个 owner 同时获取多个租约时，必须按上表顺序获取；同类型 key 还必须按规范化字符串升序获取。反序请求立即返回 `order-violation`，不会伪装成超时。建议按逆序释放。

典型计划顺序：下载/落盘为 `artifact -> volume -> runtime(write)`；正式运行为 `runtime(read) -> gpu -> project-run`。调用方必须先计算完整资源集合，不能先拿 project 锁再临时发现需要 GPU。

## Owner 与回收规则

owner identity 是三元组：

```text
随机 owner token + PID + 该 PID 的进程创建时间（UTC ticks）
```

- token 区分同一进程内的不同逻辑 owner；
- PID 创建时间防止 PID 重用后误认旧 owner；
- 只有“PID 已不存在”或“相同 PID 的创建时间不同”才是可回收证明；
- 无法读取进程信息（例如访问被拒）是 `unknown`，必须保留租约并失败关闭；
- mutex 被遗弃只表示 ledger 协调器需要继续检查，不表示任何资源租约可抢占；
- 等待超时只返回 `timeout`，绝不删除仍存活的 owner。

ledger 不使用 TTL。长任务不会因为墙钟时间、睡眠/唤醒或调试暂停而被错误抢锁。

## 持久化和事务边界

每个工具拥有的 state root 只有一个 `resource-leases.json` ledger。进程先进入基于 state root 散列得到的 `Local\...` named mutex，再读取和校验完整 ledger；任何未知 schema、畸形 key 或畸形 owner identity 都失败关闭。修改通过同目录临时文件和 `File.Replace` 原子切换，revision 单调增加。

原型刻意不把 owner token 暴露在公共结果或 snapshot 中。生产实现还必须为 state root 配置当前用户专用 ACL，并决定多 Windows session/服务场景应使用有明确 ACL 的 `Global\` mutex，还是改为本地 NTFS 文件协调器。

`volume` 只是本工具进程之间的容量承诺，不能阻止其他程序同时消耗磁盘。调用方应在真正提交文件前再次检查物理 free bytes，并保留 staging、digest 校验和原子 commit 的独立事务。

## 运行验收

在仓库根目录执行：

```powershell
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\prototypes\phase0\resource-leases\tests\Run-Tests.ps1
```

测试使用每次运行唯一的 `.test-state/<GUID>`，只启动测试自己跟踪的假 worker。`finally` 只终止这些精确 PID，并在确认绝对路径仍位于 prototype 的 `.test-state` 后清理该次目录。

验收覆盖：

1. 同 artifact digest 只有一个 writer；
2. 同一假 GPU LUID 串行；
3. runtime reader 可重叠，writer 与 reader 互斥；
4. 同 project-run 互斥；
5. volume 预留不超容量，等待超时不抢走活 owner；
6. owner token 与 PID 创建 identity 均参与判定；
7. Acquire result 与 snapshot 的属性及 JSON 序列化均不包含私有 owner identity；
8. 假 worker 被精确强杀后，下一 worker 回收已证明死亡的 lease；
9. 反序获取立即拒绝。

## 尚未证明的生产能力

- 没有验证真实 GPU LUID 枚举、GPU driver reset、Windows service 或跨登录 session；
- 没有验证网络盘、FAT/exFAT、云同步目录；生产 state root 应限定为本地 NTFS；
- 没有实现公平队列，持续竞争下不承诺严格 FIFO；
- 没有把租约接入 downloader、runtime generation switch、Comfy 进程或项目 Runner；
- 没有替代 artifact 下载事务、磁盘 free-space 复核、模型 digest 验证或 runtime rollback。

这些都是后续集成 gate。本 PoC 的通过只证明协作协议在本机 Windows PowerShell 多进程假场景中满足已列不变量。
