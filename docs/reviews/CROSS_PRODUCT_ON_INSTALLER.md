# 安装器架构产品交付交叉审计

> 交叉对象：`docs/reviews/INSTALLER_ARCHITECTURE_AUDIT.md` 与 `MINIMAX_H3_TOOL_EXECUTION_PLAN.md` 0.3  
> 视角：产品交付、普通用户决策负担、许可与发布、GPT-5.6 Sol 多 Agent 执行效率  
> 日期：2026-08-27  
> 边界：本报告只审查安装器建议，不修改原计划或其他审计文件；许可判断不构成法律意见。

## 结论

安装器审计的安全判断大体正确，但它把“未来公开自动更新平台需要的完整工程”与“第一次跑通 Alpha 所需的安全安装”混在同一 P0 中。照 30 项任务原样执行，会先花大量时间建设 TUF、三类 adapter、多卷事务、五类回滚、内容仓库和全面故障注入，仍然没有一条用户从安装页走到 ComfyUI 点击 Run 的完整产品路径。

建议拆成三个交付层：

| 层级 | 目标 | 可以没有什么 | 绝不能没有什么 |
|---|---|---|---|
| Alpha-0 内部垂直切片 | 在一台锁定 Windows/NVIDIA 机器上从 D 盘安装到 5 秒 T2V 成功 | Desktop adapter、自动更新、签名证书、TUF、多卷、卸载清理、Ref/长视频/加速 | 一个受管 Core、一个硬件 recipe、一个固定 workflow、逐文件 hash、失败不破坏、用户在 ComfyUI 点击 Run |
| Alpha-1 受控外测 | 给许可地域内少量用户重复安装并恢复 | TUF、旧版 Desktop 全兼容、内容寻址、多 profile 更新 | 法务地域/模型/Comfy/FFmpeg结论、真实签名安装包、D/C 盘实测、固定下载清单、离线生成、普通用户 IA |
| 1.0 公开发布 | 稳定更新、更多硬件与长期维护 | 无 | 更新信任链、完整卸载/回滚、SBOM、支持流程、全部公开 claim 证据 |

### 最重要的产品决策

**P0：Alpha 默认采用 managed Core，不采用 Desktop-managed。**

原因不是 Desktop 不好，而是本工具当前没有经验证的稳定契约去选择 Desktop 的某个 install、控制其版本/启动参数/端口并自动激活指定 workflow。Desktop 还有自身 AppData、更新和多实例状态，这与 Alpha 的 D 盘、大文件边界、离线和可复现目标冲突。受管 Core 允许本工具控制 runtime、frontend、模型路径、loopback、workflow 和进程树，是最短的可靠垂直路径。

Desktop 在 Alpha 中只保留：

1. 只读检测“已安装”；
2. 说明不会修改；
3. 高级入口“导出 workflow，用户手动在已有 ComfyUI 打开”；
4. 独立的 Desktop 自动打开 PoC，成功后再升级 capability。

如果产品所有者把“必须自动显示在官方 ComfyUI Desktop 中”设为不可让步的 Alpha 定义，则应先做不超过 8–12 Agent 工时的 P0 PoC；PoC 失败时必须暂停该承诺，不能同时启动一套 Core 和一套 Desktop 正式实现，更不能用鼠标坐标自动化伪装成支持。

## 优先级定义

- **P0**：阻断 Alpha 架构选择、垂直切片，或阻断外部 Alpha 发布。文中会注明“实现门”或“发布门”。
- **P1**：不阻断第一条内部切片，但在普通用户 Alpha 或对应公开承诺前必须关闭。
- **P2**：1.0、自动更新、多硬件/多环境规模化能力，Alpha 后移。

## 同意

| 项目 | 优先级 | 交叉意见 |
|---|---|---|
| venv 不应在 staging 建好后搬移 | P0 实现门 | 同意。若选 venv，必须在最终 generation 绝对路径创建；只切小型激活指针。也允许用经验证可重定位的固定 runtime archive，但 Alpha 只能选一条路线 |
| Desktop 私有配置默认只读、未知 schema fail closed | P0 | 同意。尤其不能直接写 Desktop 标明自管的模型 YAML 或把内部 registry 当公共 API |
| attach-only 不 import/执行未知 custom node | P0 | 同意。“检查现有实例”若启动它，已经越过只读边界；Alpha 不做现有实例直接执行 |
| Stable 固定 Comfy backend、frontend、模型和依赖，Manager 默认关闭 | P0 | 同意。Alpha 用原生 H3/Core 节点，先不装 Sage/KJNodes 等社区节点 |
| FAT32 单文件上限修正为 4 GiB，Alpha 受管根只认证本地固定 NTFS | P0 | 同意。这能直接缩小文件系统矩阵 |
| 明确 loopback、端口和自有进程树 | P0 | 同意。显式 `127.0.0.1`、不误连其他 8188、不终止用户进程是最小安全边界 |
| 模型逐文件 hash、角色和 immutable revision | P0 | 同意。但 Alpha 先做四个基础角色，不建设通用模型知识平台 |
| D 盘承诺需覆盖受管 cache/temp/output，C 盘少量系统数据单独披露 | P1/公开 claim 门 | 同意。产品不得写“C 盘零写入” |
| 安装状态需单写者与可恢复记录 | P0 | 同意，但先做一个简化初装状态机，不建设通用多版本事务平台 |
| 只用 H3 原生节点的短视频 MVP | P0 范围门 | 强烈同意。这是最有效的供应链和交付减法 |
| Windows 路径、reparse 和卸载不能靠字符串前缀 | P1 | 同意。Alpha 可通过“不自动递归删除受管数据”先降低破坏面，完整安全清理后移 |

## 反对

| 建议 | 优先级 | 反对原因 | 替代方案 |
|---|---|---|---|
| 把完整 TUF/阈值签名/冻结与轮换列为 Phase 2 Alpha P0 | P2；有自动更新时升 P0 | Alpha 完全可以没有应用内自动更新；先建设 TUF 会阻塞下载器和垂直切片 | Alpha 将 component catalog 嵌入具体应用版本；下载目标固定 immutable URL、长度和 SHA-256。升级靠用户安装下一份已签名安装包。1.0 启用远程更新时再引入 TUF/等价协议 |
| Alpha 同时实现 Desktop、Core、Portable 三个 adapter | P2 | 三条路径把安装、模型桥、启动、工作流打开、版本和 QA 乘三，且 Desktop 核心契约仍未知 | 先只实现 managed Core；定义 adapter interface，但 Desktop/Portable 只输出只读检测报告 |
| Alpha 普通用户选择“使用现有/只复用模型/忽略全新安装” | P0 UX | 把架构和风险转嫁给小白；“使用现有”还暗示会修改/运行 | 普通模式固定“创建独立 H3 环境并复用验证通过的模型”。高级模式才提供只读导出 |
| Alpha 支持 runtime/model/cache/workspace 分别选盘并做跨卷事务 | P2 | 需要每卷空间、staging、恢复和 UI，显著扩大测试；用户也难理解 | Alpha 只选一个受管根，所有受管大文件同一 NTFS 卷；外部模型可只读引用，不搬移 |
| 从第一版就做通用内容寻址 artifact store 与 hardlink 去重 | P2 | 需要引用计数、跨卷、ACL、卸载和损坏恢复；对单 profile Alpha收益低 | 简单组件目录 + SHA-256 ledger；hash 是验证身份，不是通用存储架构 |
| 在开始产品实现前完成五种独立回滚模型 | P2 | Alpha 无自动更新时不需要 Desktop/模型/项目五层回滚平台 | 初装只保证旧 complete generation 不受影响；1.0 更新阶段再拆五类状态 |
| 把“当前版 + 一个旧版 Desktop”兼容作为 Alpha前置 | P2 | Desktop 不是默认路径，兼容旧版不会解锁垂直切片 | 只做当前版自动打开 PoC；旧版矩阵在 Desktop capability 正式发布后补 |
| “上述最先五任务可由五个 Agent 并行” | P1 项目管理 | IA-003、IA-013 均依赖 IA-001；IA-002 分组也依赖 IA-001。依赖图与并行声明矛盾 | 先由一个 Contract/Integrator 完成 IA-001 精简版；其后最多三路并行 |

## 需要降级后保留

| 原建议 | 优先级 | Alpha 降级版本 | 后续完整版本 |
|---|---|---|---|
| generation + active pointer | P0 | 一个 recipe、一个 active pointer、`complete=false/true`；失败 generation 不可启动 | N-1、跨版本切换、垃圾回收和模型引用计数 |
| 下载事务 | P0 | 固定 URL/length/hash；`.partial`、ETag/Range 基本续传、hash 后落盘 | 多镜像、delegation、复杂断点、跨源恢复、TUF |
| 事务 journal/mutex | P0 | 一个安装根 named mutex；6 状态 JSON；步骤幂等；崩溃后续传或隔离 owned partial | 通用 WAL、跨多个 profile/卷、升级迁移协调 |
| Recipe schema | P0 | 只描述一个 OS/GPU profile、Python/runtime、Comfy/frontend、4 个模型、FFmpeg 路线和 workflow build | Desktop/Portable、多 GPU、多加速、Manager、Ref/长视频完整 capability catalog |
| wheelhouse | P0，若用户机现场建 venv | 只服务一个 Python ABI/Torch CUDA profile；完全离线安装，或改用一个已验证 runtime archive | 多架构、多驱动、多 profile 解析器 |
| 安全解压/路径 | P0 基础、P1 完整 | 固定受信 archive、限制路径/大小/条目、拒绝 reparse/ADS/设备名；根必须短 NTFS 路径 | 完整恶意 corpus、handle based TOCTOU、防多种卷挂载 |
| 模型扫描 | P1 | 已知 Comfy 目录 + 用户选择目录；先 size/header，选中后 hash | 全盘异步扫描、HF/Xet 全适配、文件 identity cache、后台索引 |
| 所有权 ledger/卸载 | P0 ledger，P1 自动清理 | 从第一天记录 `managed_by_tool`；Alpha 卸载默认只移除应用，保留模型/项目/runtime并显示路径 | 安全删除预览、引用计数、自动清理、回滚恢复 |
| C 盘 I/O 基线 | P1/公开门 | 一台干净 VM 做安装/运行差异；只承诺受管大文件不落 C | 多 Windows build、AV/代理/Controlled Folder Access矩阵 |
| 故障注入 | P1 | 下载中断、磁盘满、激活前强杀三项 | 所有事务点、盘符移除、锁定、manifest 过期和升级回滚 |
| Authenticode | P0 外部发布门 | 内部 Alpha 可用受控 hash；任何外部安装包必须签名和时间戳 | 自动更新器/helper 分离密钥、CI硬件签名和吊销演练 |
| SBOM/构建 provenance | P1 外测，P0公开1.0 | Alpha 锁依赖、保存许可证和构建清单 | 完整可验证 provenance、发布 attestations |

## 新增遗漏

| 遗漏 | 优先级 | 为什么重要 | 需要的决定/产物 |
|---|---|---|---|
| 没有明确“Alpha 禁止应用内更新” | P0 | 不关闭更新功能，TUF、回滚、通道和自动检查会不断回流为 P0 | ADR：Alpha catalog 内嵌、无远程自更新、手动安装新版本 |
| managed Core 的 GPL 分发并未因避开 Desktop 自动消失 | P0 发布门 | Core 是 GPL；若下载/捆绑/修改都需明确源码、NOTICE和组合方式 | H3、Comfy Core/frontend、自有 node、CLI、FFmpeg逐组件分发矩阵与法务签核 |
| comfy-cli 是否采用没有进入安装器路线决策 | P0 架构门 | 当前 CLI 同时有本地、云、Partner、节点脚本和分析能力；默认使用会扩大攻击面 | Alpha 默认不依赖通用 CLI，或仅以固定版本独立受限 helper 使用；单独 ADR和抓包 |
| FFmpeg 对 Alpha 短视频是否真的必需尚未做窄 PoC | P0 | 如果原生 H3/Core workflow 已能产出合格 MP4，私有 FFmpeg可后移；若必须 mux/ffprobe，则立即触发分发许可门 | 一个 5 秒带声 workflow：记录实际输出节点、二进制调用、codec；二选一 ADR |
| 30 项 installer WBS 没有实际工作流编译/交接任务 | P0 交付 | 任务做完仍不证明用户能点 Run | 把 5 秒 T2V Workflow Compiler、打开本地 UI、Run 后 MP4加入同一垂直切片 |
| 缺少一个具体可获得的首个硬件 profile | P0 | “自动适配”无法编码和验收 | 选择团队手上真实 GPU、driver、VRAM、runtime、模型精度和5秒 fixture；其他硬件先不支持 |
| 缺少 installer UI 技术栈和安装包形式决定 | P0 | 决定签名、权限、C盘缓存、升级和 Agent 文件边界 | 桌面技术栈 ADR、per-user/per-machine、是否需要管理员、构建/签名方式 |
| 缺少模型下载许可与地域 gating 在下载前的精确时点 | P0 发布门 | 不能下载后才展示 H3 条款；地域和下游义务不是普通复选框能自动解决 | 在解析下载 URL 前完成许可版本展示、地域/主体策略和接受记录；外部法务 owner |
| 缺少普通用户“需要多少等待和下载”的退出/恢复体验 | P1 | 40GB级下载长，用户会关闭应用；仅有 journal 不等于可理解 | 每个阶段显示下载/峰值/最终空间、暂停/继续、关窗后恢复和“不会重复下载” |
| 缺少 Agent 共用下载/GPU/VM 的资源锁 | P1 效率 | 多 Agent 会重复下载40GB、抢同一 Desktop/GPU或重置同一 VM | 单一 artifact cache owner；download/GPU/Desktop/VM 四个队列；测试证据统一登记 |
| 缺少外部 owner 看板 | P0 外部发布门 | 法务、H3授权、签名证书和真实硬件不是 Agent可完成任务 | `external-gates.md`/看板，明确 owner、所需证据、截止与阻断阶段 |

## 默认运行时：managed Core，而不是 Desktop-managed

### 推荐普通路径

```text
检测硬件与一个受管根
→ 发现已有模型（只读）
→ 创建独立 MiniMax H3 环境（managed Core）
→ 复用哈希通过的外部模型；下载缺失文件
→ 生成 workflow
→ 启动本工具拥有的本地 ComfyUI 实例
→ 用户点击 Run
```

managed Core 仍然不是“本工具自己生成视频”：它只是受管的 ComfyUI runtime；用户点击 Run 后，由 ComfyUI 的 MiniMax H3 节点推理。这与计划的产品边界一致。

### 为什么不选 Desktop-managed 作为 Alpha 默认

| 维度 | Desktop-managed | managed Core |
|---|---|---|
| 外部定位/打开 | 待PoC，存在多实例和内部 schema | workspace、进程、端口由工具直接控制 |
| 版本锁 | Desktop app/backend/frontend可分别更新 | 一个 recipe 可锁定全部组件 |
| D/C边界 | AppData、日志、更新由 Desktop管理 | 受管大文件可统一置于用户根；仍披露小型 AppData |
| 未知节点 | 用户实例可能已有任意节点 | Alpha 可只启用 Core/H3 原生节点 |
| 用户现有环境风险 | 接入容易被理解为修改/运行 | 与用户环境隔离，只读复用模型 |
| 工程范围 | 需要 adapter + 官方 app行为兼容 | 需要维护一个明确 runtime profile |
| 许可 | Desktop AGPL/商业双许可评审 | ComfyUI Core GPL 分发评审；并非无许可成本 |

### Desktop capability 的升级条件

只有同时满足以下证据，才把按钮从“手动导出”升级为“打开 Desktop”：

1. 能锁定并识别目标 installation ID；
2. 不写 Desktop 私有 registry/YAML；
3. 冷/热启动都能激活指定 workflow，不依赖坐标自动化；
4. 未保存画布不会被覆盖；
5. Desktop 更新后未知 schema fail closed；
6. 外部进程/协议属于可支持契约，或本工具维护的扩展有独立兼容矩阵；
7. 实际分发方式通过 Desktop 双许可审查。

## attach-only 的用户文案

“接入现有实例”不适合作为普通用户按钮。建议 Alpha 使用：

```text
检测到已有 ComfyUI

我们不会修改或运行它的节点。
推荐方案：创建独立 H3 环境，并复用下列已验证模型。

[继续推荐安装]
[高级：仅导出 workflow 到已有 ComfyUI]
```

高级页说明：

> “仅导出”只读取实例版本和模型位置，不安装节点、不执行 pip、不更改 Python 或配置，也不保证该实例可直接运行 H3。工具会保存 workflow 文件并显示手动打开步骤。

Alpha 删除以下选择：

- “使用现有实例”直接执行；
- “忽略并全新安装”（推荐路径本身已隔离，无需暴露）；
- Desktop/Core/Portable 名词选择；
- Ref2VA、30/60秒、补帧、BGM、Turbo/Sage 节点复选框。

## D 盘与 C 盘承诺

### Alpha 产品规则

1. 只提供一个“受管数据位置”，默认选择首个空间足够的本地固定 NTFS 非 C 盘；D 不存在时显示实际推荐盘，绝不伪造 `D:\MiniMaxH3`。
2. runtime、模型、wheel/archive、下载 partial、TEMP、Comfy input/output/temp 和项目全部位于同一受管根，避免多卷事务。
3. 用户已有模型可以从其他位置只读引用；卸载器永不删除。
4. 安装页显示：受管根新增最终占用、下载峰值和推荐保留空间；无需让小白分别选择 cache/model/output。
5. C 盘只允许已披露的小型应用设置、日志、证书/Windows安装器行为；设置上限和轮转。

### 可公开使用的措辞

> “大型模型、受管运行环境、下载缓存、临时视频和项目输出默认保存在你确认的位置，不会静默写入 C 盘。Windows 和应用可能在 AppData 或系统安装缓存写入少量设置与日志，安装前会显示路径和预计上限。”

禁止写“完全不占 C 盘”“C 盘零写入”。若选择 Desktop compatibility，必须单列 Desktop 自己的 AppData、日志和更新行为，不把它们算成本工具可控制的数据。

## FFmpeg、签名与法务外部门

### FFmpeg

- **P0 技术 spike**：先确认锁定的 5 秒 H3 带声 workflow 到底由哪个节点/库产生 MP4，是否调用系统/私有 FFmpeg，FFprobe 是否只用于 QA。
- 若 Alpha runtime 必须 FFmpeg，普通用户不需要勾选；它是锁定工作流的必需内部组件，只显示用途、大小、来源和许可。
- Alpha 不实现 BGM、旁白、30/60 秒拼接、补帧和多编码器选择，因此 FFmpeg 只认证一个输入/输出路径和一组 codec。
- **P0 外部发布门**：实际 binary、build configuration、LGPL/GPL路线、对应源码材料、NOTICE和目标市场 codec 专利由发布/法务签核。[FFmpeg 官方 Legal](https://ffmpeg.org/legal.html)

### 签名

- 内部 Alpha-0 可以用受控分发 + 发布 hash，不对外宣称“已签名安全安装包”。
- 任何给外部普通用户的 `.exe/.msi` 必须完成 Authenticode 与 RFC 3161 时间戳；证书采购、组织验证和私钥托管是 External Owner，不是 Agent 任务。[Microsoft SignTool](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool)
- Alpha 禁用应用内更新，因此暂不需要 TUF。组件 catalog 内嵌在签名 app 版本中，所有大文件仍验长度和 hash。

### 法务/许可

在 Alpha-1 外测前，必须有可执行结论而不是“Agent 已读许可证”：

| 组件 | 外部门 |
|---|---|
| MiniMax H3 权重/派生量化/LoRA | 目标地域、下载/转分发、AUP、NOTICE、界面归属、商业阈值和下游条款 |
| ComfyUI Core/frontend | GPL 分发/修改/源码和 NOTICE；managed Core 不是免许可路线 |
| Comfy Desktop | Alpha 不捆绑；若未来自动安装或一体分发，评审 AGPL/商业许可 |
| comfy-cli | 若捆绑或修改，GPL 义务；若仅独立调用仍需发布物级评审、禁云/遥测策略 |
| FFmpeg | 实际构建 LGPL/GPL、源码材料和 codec 专利 |
| 本工具自有 custom/frontend node | 选择与商业模式兼容的许可证，并评审与进程内 GPL 组件组合边界 |

H3 当前地域、再分发和商业条款以 [MiniMax H3 Community License](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE) 为依据；最终决定必须记录法务负责人和签核版本。

## 对 30 项任务的逐项处置

| ID | 处置 | 优先级 | Alpha 处理 |
|---|---|---|---|
| IA-001 | 同意并缩小 | P0 | 只冻结 managed Core、外部模型只读、项目保留、工具不推理四类所有权 |
| IA-002 | 同意并缩小 | P0 | 只支持单一本地 NTFS 根；FAT32拒绝；其他文件系统标不支持，不做全矩阵 |
| IA-003 | 同意 | P0 | 二选一：最终路径 venv 或可重定位 runtime archive；只做一个 profile |
| IA-004 | 需降级 | P0 PoC/P2产品 | 只验证当前 Desktop 是否可安全定位/打开；失败不阻塞 managed Core |
| IA-005 | 后移 | P2 | Desktop capability 发布后再做旧版/升级矩阵 |
| IA-006 | 拆分 | P0/P2 | managed Core launcher 留P0；Portable adapter后移 |
| IA-007 | 同意并缩小 | P0 | 只做 Base T2V/I2V/L2V/FL2V所需原生 node/schema；Ref/AddGuide后移 |
| IA-008 | 同意并简化 | P0 | Alpha attach-only完全静态；不做现有实例动态 probe/直接执行 |
| IA-009 | 同意并缩小 | P0 | 最小 recipe字段；不要先覆盖所有未来 adapter/加速/Runner |
| IA-010 | 同意 | P0 | 只选团队真实可测的一个 GPU/driver/runtime profile |
| IA-011 | 条件保留 | P0 | 若现场构建 venv则做单 profile离线 wheelhouse；若用固定 runtime archive则转为构建端任务 |
| IA-012 | 同意 | P0 | 锁本地 frontend；Manager关闭；不解析 latest |
| IA-013 | 后移 | P2 | Alpha无应用内更新；只做内嵌 catalog和artifact hash |
| IA-014 | 改为外部发布门 | P0外测 | Agent写签名流水线设计；证书/时间戳服务由外部负责人提供 |
| IA-015 | 同意并解除TUF依赖 | P0 | 依赖最小 component manifest，不依赖 IA-013；支持一个源的安全续传 |
| IA-016 | 同意并缩小 | P0 | 初装mutex+简化journal；无多profile/多卷升级 |
| IA-017 | 需降级 | P0基础/P1完整 | 固定archive基础拒绝规则先做；大规模恶意corpus后移 |
| IA-018 | 需降级 | P1 | 先拒绝受管根祖先reparse并不自动递归删除；完整handle/TOCTOU库后移 |
| IA-019 | 同意 | P0 | 只为Alpha四个基础文件建立逐文件manifest；Turbo/Ref/embedding不进入 |
| IA-020 | 同意并缩小 | P1 | known roots + manual folder；仅选中候选做全hash |
| IA-021 | 后移大部 | P2 | Alpha可读已知Comfy模型路径；HF/Xet自动缓存适配后移，允许用户手动选择文件夹 |
| IA-022 | 保留窄验收 | P1外测 | 单干净VM做D/C差异和日志预算；多环境矩阵后移 |
| IA-023 | 同意 | P0 | 属于managed Core垂直切片核心 |
| IA-024 | 后移 | P2 | Alpha无自动更新；只定义初装失败和项目schema备份 |
| IA-025 | 拆分 | P0 ledger/P1删除 | 从第一天记录所有权；Alpha卸载保留大数据，不做自动递归清理 |
| IA-026 | 需降级 | P1/公开1.0 P0 | 技术栈一旦确定就锁依赖；完整SBOM/provenance在外测/公开发布完成 |
| IA-027 | 同意但改依赖 | P0切片/P1矩阵 | 先依赖实际installer/workflow/launcher实现；一个Win11 profile跑通，再扩Win10/已有Desktop |
| IA-028 | 后移大部 | P1/P2 | Alpha先测下载中断、盘满、激活前强杀；完整chaos后移 |
| IA-029 | 同意且前移 | P0 UX | 用fixture即可先做普通安装摘要；不应等待HF cache适配完成 |
| IA-030 | 反对作为单一总门 | P1项目管理 | 拆成 runtime、模型、垂直切片、外测合规四个小门，避免全项目在一个join点等待 |

### 30 项依赖图的具体问题

1. IA-002、IA-003、IA-013 都声明依赖 IA-001，却又被列入“立即并行”或“最先五任务并行”；这是直接矛盾。
2. IA-015 被强绑 IA-013，使一个普通安全下载器必须等待完整 TUF。取消应用内更新后，IA-015 只需最小内嵌 manifest。
3. IA-027 的前置全是 ADR/协议/测试规格，没有“安装器实现、runtime materializer、Workflow Compiler、Comfy handoff”的任务，端到端验收架没有可验收对象。
4. IA-026 的依赖写成未编号的“技术栈决策”，IA-030 写成模糊范围，调度器无法机器判断 ready。
5. IA-029 是 UI/文案，完全可以消费 fixtures 提前原型，不需要等 IA-021 HF/Xet 实现。
6. IA-004/005 的 Desktop 支线会占用唯一 Desktop/VM资源，但不是 managed Core垂直路径依赖，不应阻塞主线。
7. 任务多为报告/ADR，没有明确唯一文件 owner、允许路径、合并入口和实现后续；多 Agent容易同时修改 schema/lockfile。

## 最小垂直切片

目标不是“做完安装平台”，而是在一个锁定环境证明产品承诺的最短闭环：

```text
选择受管根
→ 检测一个硬件 profile
→ 安装一个固定 managed Core runtime
→ 复用或下载一套固定 FL2VA基础文件
→ 生成一个 5秒T2V workflow
→ 打开受管 ComfyUI
→ 用户点击 Run
→ 得到带H3原生声音的本地MP4
→ 断网重跑成功
```

### 垂直切片任务

| ID | 依赖 | 任务/产物 | 验收 | Agent 工时 |
|---|---|---|---|---:|
| VS-001 | 无 | Alpha scope ADR：managed Core、单NTFS根、单GPU profile、无更新/Manager/第三方节点 | 所有 Agent 使用同一 capability表；Desktop不阻塞主线 | 4–6 |
| VS-002 | VS-001 | 锁定H3 T2V 5秒golden workflow、Comfy/frontend/model文件表 | 手工在开发机点击Run得到带声MP4；记录真实FFmpeg路径 | 6–10 + 推理等待 |
| VS-003 | VS-001 | 最小 recipe/component/install-state schema与ownership ledger | 一套fixture完整校验；外部模型标只读 | 6–8 |
| VS-004 | VS-001,VS-003 | managed runtime final-generation materializer + loopback launcher | D盘最终路径启动；不依赖staging；只连接自己的端口 | 10–14 |
| VS-005 | VS-003 | 四文件model manifest、known-root/manual发现、安全下载/续传 | 复用只在hash通过；中断后继续；损坏文件阻止 | 10–14 |
| VS-006 | VS-002,VS-003 | T2V Workflow Compiler与project fixture | 由项目输入稳定产生目标workflow，模型不为空 | 8–12 |
| VS-007 | VS-004,VS-005,VS-006 | 极简安装页/进度页/完成页 | 普通用户只确认根路径、许可和安装摘要；无技术复选框 | 8–12 |
| VS-008 | VS-007 | E2E：打开受管Comfy、用户Run、MP4与run manifest | 在线首次安装、断网二次运行、下载中断、盘满、C盘I/O报告通过 | 10–16 + 下载/推理等待 |

预计 **62–92 Agent 工时**，不含模型下载、H3推理、真实硬件/VM排队、法务和签名等待。它比先完成30项平台任务更早暴露真正风险：模型是否能加载、workflow是否等价、Comfy是否能打开、FFmpeg是否真实需要、D盘环境是否稳定。

### 调度

1. 根集成 Agent 先独占 VS-001，并指定 schema/lockfile owner。
2. VS-001 后并行三路：VS-002（GPU队列）、VS-003（contract）、Desktop open PoC（独立、不阻塞）。
3. VS-003 完成后并行 VS-004 与 VS-005；二者不得同时改 install schema。
4. VS-006 由 workflow owner完成；VS-007 只消费 schema/fixtures，不自行扩字段。
5. VS-008 独占 Windows VM、GPU和下载缓存；其他 Agent不得同时启动H3或下载第二套模型。

## Alpha 最小实现

### Alpha-0 内部切片

- Windows 10/11 只选一个实际可测版本作为首条；NVIDIA一个具体profile。
- managed Core；无 Desktop/Portable执行 adapter。
- 一个本地固定NTFS受管根，默认非C盘；无多路径。
- T2V 5秒、16:9、自动质量；H3原生声音。
- 四个基础模型角色，只选一种精度；无Turbo LoRA、Ref2VA、embedding。
- Core/H3原生节点，Manager关闭，禁Partner/API节点。
- component catalog随app版本冻结；无自更新/Stable/Testing通道。
- known-root + manual目录模型发现；hash通过才复用。
- 简化download resume、install-state、ownership ledger；无自动大数据卸载。
- FFmpeg只按VS-002实测结果决定，不预做长视频/混音抽象。
- 受管Comfy打开后由用户点击Run；工具不自动提交正式Queue。

### Alpha-1 受控外测增加

- T2V、I2V、L2V、FL2V和纯首帧空提示词；4–15秒帧网格。
- 一个明确的支持硬件/driver范围，而不是“所有NVIDIA”。
- 普通用户可理解的安装摘要、失败恢复、空间和等待时间。
- 当前版Desktop只读检测；自动打开只有PoC通过才开启，否则手动导出。
- 干净Win10/11矩阵、断网、零未声明外联、C盘预算和外部模型保护。
- 许可证材料、法务地域签核、签名安装包、支持/错误收集流程。

## 后续移项

| 移项 | 目标阶段 | 原因 |
|---|---|---|
| Desktop自动选实例/打开workflow、旧版矩阵 | Alpha后 capability | 等稳定PoC和许可路线，不阻塞managed Core |
| Portable attach adapter | Alpha后 | 只为专家兼容，不是小白主路径 |
| TUF/等价更新、Stable/Testing通道、密钥轮换 | 1.0更新阶段 | Alpha禁应用内更新后无必要 |
| 内容寻址store、hardlink、跨profile引用计数 | 1.0 | 单profile收益低、卸载风险高 |
| runtime/model/cache/workspace多卷 | 1.0 | UI和事务复杂度高 |
| 五层独立回滚与项目downgrade | 1.0更新阶段 | 初装不需要完整平台 |
| HF/Xet自动缓存适配、全盘扫描 | 0.4/1.0 | Alpha known-root + manual足够证明复用价值 |
| 自动安全清理大数据 | 0.4/1.0 | Alpha先保留并显示路径，避免误删 |
| 全恶意archive/reparse/chaos矩阵 | 1.0发布加固 | Alpha保留最小安全规则和三项故障注入 |
| Ref2VA、30/60秒、BGM/旁白、放大补帧 | 原计划Phase 4–6 | 不进入基础安装器 |
| SageAttention/KJNodes/Turbo等加速配方 | 独立认证阶段 | 需逐hardware/音视频成功率验证与新增供应链 |
| 品牌水印 | 产品所有者提供资产后 | 与模型归属、AI披露独立，不阻塞Alpha |

## 一手资料依据

- Python 官方明确说明 venv 脚本含解释器绝对路径、环境通常不可移动，支持“最终目录构建”而非“建好再搬”的判断：[Python `venv` 文档](https://docs.python.org/3/library/venv.html#how-venvs-work)。
- 当前 Comfy Desktop 官方 Windows 文档确认它是多安装管理器，并列出实例、共享目录、设置和日志位置：[Comfy Desktop Windows](https://docs.comfy.org/installation/desktop/windows)。Desktop 的实际 AGPL-3.0-or-later/商业双许可见[官方仓库](https://github.com/Comfy-Org/Comfy-Desktop)。
- managed Core 仍需遵守 ComfyUI Core 的 [GPL-3.0 许可证](https://github.com/Comfy-Org/ComfyUI/blob/master/LICENSE)，不能被描述为“避开 Desktop 后无许可义务”。
- comfy-cli 官方 README 记录了 workspace、本地/云路由、节点安装脚本、分析开关和 GPL-3.0，因此是否采用必须是显式架构/供应链决定：[comfy-cli 官方 README](https://github.com/Comfy-Org/comfy-cli/blob/main/README.md)。
- FFmpeg 的 LGPL/GPL 构建差异、源码材料和专利提示见 [FFmpeg 官方 Legal](https://ffmpeg.org/legal.html)。
- 外部 Windows 安装包的签名、验签和 RFC 3161 时间戳依据 [Microsoft SignTool](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool)。
- H3 地域、再分发、商业界面、下游限制及授权条件以 [MiniMax H3 Community License](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE) 为准。

## 最终交叉结论

| 类别 | 结论 |
|---|---|
| 同意 | 安装器审计对 venv、Desktop只读、固定frontend、attach-only、NTFS、loopback、hash和D/C披露的判断正确 |
| 反对 | 不应让完整TUF、三adapter、多卷、内容寻址、五层回滚和30项总门阻塞Alpha |
| 需降级 | journal、解压、扫描、wheelhouse、卸载、故障注入都保留最小安全版本，再按公开发布风险扩展 |
| 新增 | 必须补“Alpha无自更新”、managed Core GPL、comfy-cli路线、FFmpeg真实需求、首个硬件profile、工作流垂直任务、外部owner看板 |
| Alpha默认 | managed Core；Desktop只读检测/手动导出；普通用户不选择运行时类型 |
| 首要成功标准 | 同一用户根内完成固定runtime+模型+5秒T2V，用户在受管ComfyUI点击Run得到带声MP4并可断网重跑 |

达到这条最小闭环后，再投入 Desktop adapter、更新平台和多环境兼容，团队才能根据真实失败数据扩展，而不是在尚未生成第一段视频前建设一个通用 Comfy 发行平台。
