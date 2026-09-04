# MiniMax H3 产品交付计划 × 工作流运行时交叉审计

> 审计对象：`MINIMAX_H3_TOOL_EXECUTION_PLAN.md` 0.3、`docs/reviews/PRODUCT_DELIVERY_AUDIT.md`  
> 审计角色：独立工作流运行时交叉审计 Agent B  
> 审计日期：2026-08-27  
> 审计边界：只判断 H3/ComfyUI 工作流能力能否兑现产品范围、WBS 和发布门；不实现产品代码，不把本工具扩展成视频生成后端  
> 固定原则：本工具只检测、安装、配置、编译工作流并打开 ComfyUI；正式音视频由用户在 ComfyUI 点击运行后交给 MiniMax H3 生成，`H3LongVideoRunner` 只调度既有 H3 节点。

## 结论

结论：**产品审计的范围收敛、capability-driven IA、运行时二选一、资源互斥与外部负责人门禁值得采纳；但其“五类 schema + 当前 G5/G6/G8 + 首批 5 任务 + 79 项 WBS”仍不能直接交给制作 Agent 执行。必须先关闭 8 个工作流 P0。**

最重要的交叉结论如下：

1. 官方已经证实 FL2VA 的四种基础输入模式：无图 T2VA、一张首帧 I2VA、一张尾帧 L2VA、两张首尾帧 FL2VA，并能产生 24 FPS 视频与 32 kHz 立体声；这证明“路由存在”，**没有同时证明产品承诺的 4.00–15.00 秒精确交付、空提示词、最终端点保护、双格式图正确、断网无 API 节点以及 Desktop 自动显示指定工作流**。
2. Alpha 应先收敛为锁定版本上的 **5/10/15 秒、非空提示词 T2VA/I2VA/L2VA/FL2VA**；4 秒、空提示词和“精确时长同时保留尾帧”分别通过 PoC 后再打开 capability。若产品必须把纯首帧空提示词纳入 Alpha，则中性占位回退必须被视为 Alpha 实现的一部分，而不能把空串稳定性写成已证实的 H3 能力。
3. Product Audit 建议的五份共享 contract 不足。至少还缺 `capability-catalog`、`frame-audio-plan`、`typed-workflow-ir/graph-pair` 三份核心 contract；否则 UI、编译器、安装器和 QA 会分别发明“支持什么、裁哪几帧、两张图是否等价”的答案。
4. 外部 `ffmpeg.exe` 不是 H3/ComfyUI 官方短视频保存的技术前置条件。官方 `CreateVideo` + `SaveVideo` 可通过 PyAV 保存带音频视频。外部 FFmpeg 应移到长视频组装、混音、重定时、公开导出和水印 capability；不能用当前 G6 阻断 Alpha 短视频，也不能在 Alpha 安装 IA 中作为必需组件。
5. 当前 Comfy Desktop 能被启动，不等于已证实外部程序可让它自动显示指定 `workflow.json`。必须把“启动正确实例”“自动载入指定工作流”“安全的手动导入回退”拆成三个验收层级。
6. `workflow.json` 与 `prompt.json` 是两种图。前者是可视化保存图，后者是 API 执行图；必须从同一个带类型 IR 分别编译，并用官方前端 `graphToPrompt()` 做语义等价测试。`prompt.json` 只能用于校验、审计和恢复契约，本工具不能拿它自动提交第一笔正式 Queue。
7. 长视频 Runner 方向可研究，但 WBS 已把“原始成对 AV latent 续接”提前写成实现任务。官方公开契约只证实 `MiniMaxH3AddGuide` 的解码素材 Guide 路径，没有稳定的跨段 paired-latent 序列化 ABI。应先做 `decoded-guide` 与 `paired-latent` 两个两段 PoC，再选择 profile。
8. Product Audit 的首批任务违反了它自己的依赖图：A-003/A-005 均依赖被遗漏的 A-002；A-009/A-010 依赖尚未完成的 A-007；A-012 依赖 A-007，却被安排在仅 A-003/A-005 后启动。按该顺序派 Agent 会产出不可合并的 schema 和错误的安装文案。

因此，本交叉审计的判定是：

- **可立即执行**：仓库治理、范围 ADR、官方能力快照、Desktop/managed-runtime spike、只读探测设计和下面列出的工作流 PoC。
- **暂不可执行为正式产品代码**：Alpha 双图编译器、Alpha 安装 UI、自动打开交接、外部 FFmpeg 强依赖、纯空提示词正式承诺、30/60 秒 Runner 产品实现。
- **对外 Alpha 发布前**：本文所有 P0 必须有锁定版本的自动化或 GPU 证据；不能用“官方规格支持”替代本机 Comfy 路径的端到端证据。

## 证据基线与能力边界

本报告沿用工作流运行时审计冻结的上游快照，并只用 MiniMax/Comfy 官方资料或官方源码判断基础能力：

- MiniMax H3 官方规格：单段 4–15 秒，FL2VA 的零/一/两张端点图输入，Ref2VA 的独立权重与多模态参考约束。[MiniMax H3 官方模型卡](https://huggingface.co/MiniMaxAI/MiniMax-H3)
- ComfyUI 本地 H3 节点：`MiniMaxH3ImageToVideo`、`MiniMaxH3ReferenceToVideo`、`MiniMaxH3AddGuide`；帧数按 `17k+5` 对齐，视频/音频 latent 成对存在。[ComfyUI H3 原生节点源码](https://github.com/Comfy-Org/ComfyUI/blob/d8e7bbc9d586d95f758d6b0ed23d519088be578a/comfy_extras/nodes_minimax_h3.py)
- ComfyUI 同仓库还包含名称相近的付费 Partner/API 节点，源码标记 `is_api_node=True` 并调用远程代理。[MiniMax API 节点源码](https://github.com/Comfy-Org/ComfyUI/blob/d8e7bbc9d586d95f758d6b0ed23d519088be578a/comfy_api_nodes/nodes_minimax.py)
- Comfy 前端 `graphToPrompt()` 同时产生可视化 `workflow` 与执行 `output`；官方 H3 模板包含子图和动态 widgets，不能按扁平 JSON 处理。[前端导出源码](https://github.com/Comfy-Org/ComfyUI_frontend/blob/7ba60a03bb8655b4fae9e6181265217010a98e8a/src/platform/workflow/core/services/workflowService.ts#L127-L145)、[官方 H3 T2V 模板](https://github.com/Comfy-Org/workflow_templates/blob/71f43419e53dfcb16330748f3b933ac0efcc4778/templates/video_minimax_h3_t2v.json)
- Comfy 核心 `CreateVideo`/`SaveVideo` 能保存带音频视频；外部 FFmpeg CLI 不是核心短片的前置条件。[SaveVideo 源码](https://github.com/Comfy-Org/ComfyUI/blob/d8e7bbc9d586d95f758d6b0ed23d519088be578a/comfy_extras/nodes_video.py#L124-L237)
- Comfy 官方 Node Expansion/`GraphBuilder` 可表达循环；这证明 Runner 可扩展依赖图，不证明跨运行 AV latent ABI 或崩溃恢复已经存在。[ComfyUI Node Expansion](https://docs.comfy.org/custom-nodes/backend/expansion)
- 当前 Desktop 的 `second-instance` 处理忽略传入 argv，仅聚焦窗口；官方未给稳定的外部文件打开 CLI 契约。[Comfy Desktop 当前源码](https://github.com/Comfy-Org/Comfy-Desktop/blob/29087358520593cc2d08224e89d6bc8c9d455254/src/main/index.ts#L1295-L1308)

## Alpha T2/I2/L2/FL2 承诺核查

| 路由 | 官方基础模式 | 当前可认定已证实 | 尚未证实、不能直接写入 G8 的部分 | Alpha 建议 |
|---|---|---|---|---|
| T2VA（零图） | 是 | 非空文字进入本地 FL2VA；H3 可输出原生音视频 | 4.00 秒本地认证；精确裁切后的 A/V；双图语义等价；自动打开 Desktop | 先认证 5/10/15 秒；4 秒单独 capability |
| I2VA（首帧） | 是 | 首帧可作为生成端点 Guide；首帧位于生成帧 0 | 空提示词质量/兼容性；首帧按目标 canvas 拉伸；精确时长后的音频同步 | 非空提示词先入 Alpha；空串/占位单独 PoC；增加 canvas 预览 |
| L2VA（尾帧） | 是 | 一张图可被指定为尾帧，锚定到生成帧 `frame_count-1` | 统一尾裁会直接删除尾帧；空提示词；仅尾帧自动画幅可能 center-cover 裁切 | 必须先选“裁头或重定时”策略并锁 frame plan |
| FL2VA（首尾） | 是 | 两张图可分别锚定生成首尾帧 | 124→120、243→240、362→360 若尾裁会删除尾锚；内部丢帧/重采样对 A/V 的影响 | 必须先通过端点保护 PoC；不能仅检查工作流能跑 |
| H3 原生音频 | 是 | H3 本地路径可产生 32 kHz 立体声；视频 24 FPS | 空提示词是否产生有意义音频；裁头/裁尾/重定时后的样本数、PTS 和声道完整性 | 所有四路由都要做音轨验收，不得只验画面 |

交叉判定：**四类路由的模型角色已证实；四类“产品端到端承诺”均未全部证实。** Product Audit 的 G8 把两层事实合并成一个“4–15 秒可交接”门，必须拆开。尤其是：

- 官方模型卡的 4–15 秒不等于当前本地节点的每个秒数都已认证。当前节点 tooltip 把训练范围提示为约 124–362 帧，约 5.17–15.08 秒；4 秒需单独实测。
- `5 秒 → 124 生成帧 → 120 交付帧` 时，尾帧被锚在生成帧 123。直接裁尾 4 帧会违反“尾帧必须是最终一帧”。10 秒和 15 秒同理。
- 空串是源码可达路径，不是官方稳定质量承诺。首帧、尾帧、首尾帧空串必须分别测试；失败时只能使用用户可见、可替换、写入 `project.h3.json` 的版本化中性占位文本。
- T2VA 不能把空提示词当有效输入；Ref2VA 也不能从“参考素材存在”自动推断文字中各素材承担身份、动作、声音还是镜头语义。

## 同意 Product Delivery Audit 的项目

| 优先级 | 判定 | 交叉审计意见 |
|---|---|---|
| P0 | 同意 | Alpha 与 1.0 capability 必须分离；Ref2VA、30/60 秒、BGM/旁白、放大补帧不应出现在未启用 capability 的 Alpha 普通安装/创建页。 |
| P0 | 同意 | Desktop-managed 与 managed Portable/Core 必须只选一条主路径；但选择证据必须同时覆盖“正确实例启动”和“指定工作流载入”，不能只证明环境可创建。 |
| P0 | 同意 | 范围、许可证、目标硬件、外部 Human owner、GPU/Desktop/VM/download 互斥队列都应成为门禁。 |
| P1 | 同意 | 安装烟测与 30/60 秒认证实验必须分开；用户安装不能跑长视频实验矩阵。 |
| P1 | 同意 | 公开导出与项目私有工件必须分开，公开 MP4/图片/音频/sidecar 不得泄漏 prompt、workflow、用户名和绝对路径。 |
| P1 | 同意 | 模型状态不能从 `found` 直接跳到 `reused`；应经历 identified、verified、compatible、approved、selected。 |
| P1 | 同意 | 一个硬件档位、一个运行时拓扑、一个基础 recipe 先行；社区热度不能代替配方认证。 |
| P2 | 同意 | 小白页面不询问内容类型，不暴露 sampler、scheduler、steps、量化、attention、cache、context 等技术选择。 |

## 反对的项目

| 优先级 | Product Audit/原计划主张 | 反对原因 | 修正方向 |
|---|---|---|---|
| P0 | “五类 schema v1”足以解锁模块并行 | 五份运营 contract 无法表达上游能力、端点/时间轴和双图语义；UI、编译器、QA 会各自硬编码 | 至少扩为八份核心 contract，见下文 |
| P0 | G6 FFmpeg 未通过时只能保留中间文件 | 对 Alpha 官方短片不成立；Comfy `SaveVideo` 可保存带音频视频 | G6 只阻断长视频/混音/重定时/水印 finalizer；Alpha 改为 Core SaveVideo gate |
| P0 | G8 直接承诺 4–15 秒 T2/I2/L2/FL2 | 路由存在不等于 4 秒、空提示、端点、精确时长、双图和打开交接都成立 | 拆 G8a–G8d；未通过的 capability 隐藏或降级 |
| P0 | 首批把 A-003、A-005、A-008/009/010 并行，然后 A-012 | 违反 A-003/A-005→A-002、A-009/A-010→A-007、A-012→A-007 的明示依赖 | 改为 A-001/A-002 后再做 capability 与两条 runtime spike |
| P0 | 默认 runtime envelope 自动追加“继续上一段/自然收束” | 这是动作与结尾语义修改，越过“本工具不创作”的边界 | 默认原文逐段复用；若保留续接文本，必须是用户输入、默认关闭、逐字可见 |
| P0 | F-008 直接实现“AV latent 上下文” | 官方没有稳定的跨段 paired-latent 存储 ABI；当前只能作为自研实验 profile | 先 decoded-guide 与 paired-latent 两个 PoC，再由 ADR 选择 |
| P1 | Alpha 普通安装卡展示 FFmpeg、Ref、长视频、放大补帧 | 把 1.0 功能和依赖提前，增加下载、许可和失败面；与 Alpha 非目标矛盾 | Alpha 普通页只显示基础 FL2VA 运行时、共享模型和可选最小烟测 |
| P1 | Desktop 能创建/管理环境即可优先定主路径 | 环境管理能力不等于外部一键加载工作流；当前源码未提供稳定 argv/file association | G1 必须同时验 launch、load、fallback；产品文案按实测等级承诺 |
| P1 | B-005 “技术 envelope diff UI”作为既定功能 | 即使显示 diff，默认自动追加仍在替用户决定语义 | 改为 `actual_model_text` 透明展示；只有显式 opt-in 字段才允许差异 |

## 需改写的项目

### P0：安装信息架构

Product Audit 对 Alpha/1.0 混用的判断正确，但推荐 IA 仍写“可选最小生成验证”而没有把依赖层次拆清。Alpha 普通安装页应按以下顺序和组件层级改写：

```text
根目录（默认 D:\MiniMaxH3，可改）
→ 只读硬件/磁盘/已有 Comfy/已有模型扫描
→ 推荐的唯一运行时方案
→ 基础 FL2VA 能力包（锁定、必需）
   · FL2VA checkpoint 或已验证复用路径
   · 共享 text encoder / VAE
   · 锁定 Comfy Core/前端/本地 H3 节点能力
   · Core CreateVideo/SaveVideo 短片输出
→ 下载量、峰值空间、最终占用、C 盘例外
→ H3 与相关组件许可
→ 事务安装、节点导入烟测
→ 用户明确同意后，可选最小 H3 生成烟测
```

Alpha 普通页应隐藏：

- Ref2VA 模型与参考素材槽；
- `H3LongVideoRunner`、30/60 秒；
- 外部 FFmpeg finalizer、BGM/旁白混音；
- 本地超分/补帧；
- 品牌水印配置。

这些组件只能在对应 capability 已安装、许可证通过且运行时 PoC/认证完成后进入“功能扩展”页。若产品决定 Alpha 也要外部 FFmpeg 做统一公开导出，文案必须写“本工具公开导出/后处理需要”，不能写“H3 运行必须”；同时保留 Core SaveVideo 的短片诊断路径，避免 FFmpeg 许可/部署问题把 H3 基础安装误判为失败。

### P0：共享 schema 与编译管线

Product Audit 的五份 contract 应改为至少八份核心 contract：

| Contract | 责任 | 不能被哪一份替代 |
|---|---|---|
| `component-manifest.schema` | 下载源、版本、哈希、许可证、依赖和管理所有权 | 不表达本机是否实际有对应节点能力 |
| `recipe.schema` | 硬件/运行时/模型/采样/加速锁 | 不表达用户输入路由和具体帧裁切 |
| `project.schema` | 原始输入、素材角色、用户选择、输出目标 | 不应塞入 Comfy 节点对象或临时运行状态 |
| `install-state.schema` | 事务安装、复用、回滚、卸载状态 | 不表达生成链状态 |
| `run-manifest.schema` | 某次运行的 recipe、产物、状态、证据 | 不应成为跨版本 capability 真相源 |
| `capability-catalog.schema` | release channel、H3/Comfy/frontend commit、local/API class type、`object_info` 指纹、支持等级、硬件与许可条件 | 这是安装 IA、创建 IA、编译器和 QA 的共同功能门 |
| `frame-audio-plan.schema` | requested/generated/delivered 帧、端点保护策略、24 FPS PTS、40 Hz audio latent、32 kHz PCM 样本数、裁切/重定时 | 不能把关键数学散落在 FFmpeg 参数或 workflow widget 中 |
| `typed-workflow-ir.schema` + graph-pair 元数据 | 类型化素材槽、路由、节点、边、subgraph、动态 widget、模型角色；分别编译 visual/API 图，保存共同 `semantic_graph_hash` | 不能用 `workflow.json` 删除布局字段来伪造 `prompt.json` |

此外，以下虽可作为上述 schema 的子文档，也必须有独立、版本化校验：`hardware-report`、`model-registry`、`segment/checkpoint-manifest`、`context-profile`。计划已经列出部分文件名，但 A-012 没有分配 schema owner、迁移和兼容测试。

推荐确定性编译链：

```text
ProjectInput
→ CapabilityResolve
→ RoutePlan（只按素材槽，不分析故事/MV/口播）
→ CanvasPlan
→ FrameAudioPlan
→ TypedWorkflowIR
   ├─ VisualGraphCompiler → workflow.json
   └─ ApiGraphCompiler    → prompt.json（校验/审计，不自动 Queue）
→ schema + live /api/object_info validation
→ graphToPrompt semantic-equivalence test
→ OfflineSafetyLint（local class allowlist；API/Partner/unknown fail closed）
→ DesktopOpenAdapter 或明确的手动导入回退
→ 用户在 ComfyUI 点击 Run
```

### P0：工作流打开、双图与 API 节点

G1、E-001、E-008 和 G8 必须共同改写：

1. “打开 ComfyUI”只代表启动了正确实例。
2. “打开指定工作流”必须证明冷启动、热启动、多实例、非默认安装、中文/空格路径均让目标可视图出现在画布；当前不能根据 Desktop argv 假定成立。
3. 自动载入失败时，合格回退是：启动正确实例、保存并显示工作流文件位置、提示用户从 Workflows 打开或拖入；不得写未批准的 Desktop 管理文件。
4. `workflow.json` 是用户要看的可视图；`prompt.json` 不是可视工作流，也不能作为“打开”的对象。
5. 本地 class type 只能来自锁定 allowlist；任何 `is_api_node=True`、Partner/API 类、鉴权字段、未知 output node 或未批准 custom node 都 fail closed。
6. 检查必须同时扫描 visual graph、API graph、subgraph definitions 与 Runner expansion 后的执行图，不能只查顶层节点显示名。
7. 生成工具不得调用 `/prompt` 提交用户正式任务。长 Runner 的循环应由用户一次 Run 后的本地 Node Expansion/GraphBuilder 依赖链完成，不能在节点内部重入队列。

### P0：端点保护、帧网格和空提示词

E-004/E-006/E-007/G8 不应继续使用“统一精确裁切”表述，必须输出路由相关的 `FrameAudioPlan`：

- T2VA/仅首帧：可优先尾裁，但仍需同步裁音频和 PTS。
- 仅尾帧：应比较裁头与整体 A/V 重定时，最终一帧必须保留尾锚。
- 首尾帧：必须保留两端，只能从内部受控丢帧/重采样、整体重定时，或向用户交付对齐后的实际时长。
- 任何方案都要从一个全局有理数时间轴推导视频帧、audio latent steps 和 PCM 样本数；不能分别按每段秒数四舍五入。
- 5/10/15 秒分别覆盖 T/I/L/FL 四路由；4 秒单列 PoC，不能靠 schema min 值通过。
- 空串矩阵至少覆盖首、尾、首尾；实际送模文本、是否占位、占位版本和来源都写入项目文件。若空串失败，普通 UI 应使用显式中性占位或禁用该 capability，而不是运行后才报错。

### P0：长视频职责与实现顺序

原计划把 Runner 定位为调度器是正确的；Product Audit 的 F 组仍需要改写实现顺序：

1. 先冻结 `GraphBuilder` expansion 约束，禁止 Runner 调 `/prompt` 或自行调用不稳定的 Comfy executor 内部接口。
2. 先做官方保守路径 `decoded-guide`：将上一段尾部视频帧/音频经 `MiniMaxH3AddGuide` 重新编码，完成两段依赖链。
3. 再独立做实验路径 `paired-latent`：自研最小切片/保存/加载节点；保存视频与音频两个 tensor、dtype、shape、分辨率、fps、audio rate、模型/VAE/recipe/context hash。
4. 由 ADR 选择 Stable 候选；不允许 WBS 在 ADR 前默认 paired-latent。
5. 检查点只有原子 commit 后才能成为下一段父节点；文件写一半、采样完成但 manifest 未提交、组装失败、进程退出都要做 fault injection。
6. 窗口公式必须支持变长窗口：`F_effective = W1 + Σ(Wi - Oi)`。Manifest 分开记录 `O_video_frames`、`O_audio_latent_steps`、`trim_audio_samples` 和全局 PTS。
7. 外部 FFmpeg 在所有片段完成后接手最终组装、混音、公开导出；品牌水印仍保持在最终组装和可选放大/补帧之后。原计划这一水印顺序正确，应保留。

### P1：G5 硬件认证门

Product Audit 的 P0-07/G5 只要求“5 秒 T2V/I2V/音频”。如果 Alpha 对外宣称 L2VA/FL2VA，则 G5 必须也覆盖尾帧和首尾帧；否则应收窄 Alpha 为 T2VA/I2VA。硬件 gate 至少记录：

- 锁定 GPU/驱动/RAM/磁盘、Comfy/core/frontend commit、模型/VAE/encoder hash；
- 5/10/15 秒 T/I/L/FL 的 requested/generated/delivered 帧数；
- 端点保留证据、最终 PTS、32 kHz stereo、A/V 末端差；
- Core SaveVideo 元数据关闭或清理证据；
- 断网与 API-node fail-closed 证据；
- 4 秒、空提示、加速 recipe 分别作为附加 capability，不借基础门顺带通过。

## 新增遗漏

| 优先级 | 遗漏 | 必须新增的产物/门 |
|---|---|---|
| P0 | 本地 H3 与同名 API/Partner 节点混淆 | `local-node-allowlist.json`、live `/api/object_info` 校验、API/unknown 拒绝 fixture、Runner expansion lint |
| P0 | 两张图没有共同语义真相源 | `TypedWorkflowIR`、visual/API 双编译器、`semantic_graph_hash`、官方 `graphToPrompt()` 等价 harness |
| P0 | 端点保护与精确时长冲突 | `FrameAudioPlan`、5/10/15 × T/I/L/FL GPU PoC、裁头/裁尾/内部采样/重定时比较 |
| P0 | Desktop 自动载入能力未证实 | current/legacy/Portable 的冷/热启动与多实例 PoC；手动导入回退验收 |
| P0 | 4 秒被官方规格直接推导为本地已认证 | 独立 4 秒 capability test；未通过时普通 UI 最小值为 5 秒 |
| P0 | Runner 没有正式选择 continuation ABI | decoded-guide 两段 PoC、paired-latent 两段 PoC、GraphBuilder ADR、ABI/fingerprint/checkpoint schema |
| P0 | “不自动 Queue”没有可测试约束 | 编译/打开阶段 `/prompt` 调用为零的网络/进程测试；Runner 只在用户 Run 后展开 |
| P1 | 首帧拉伸、尾帧 center-cover 的几何差异 | `CanvasPlan` 与裁切预览；比例冲突告警；32 倍数和面积上限测试 |
| P1 | Ref2VA 引用 tag 与空提示词未形成 route contract | Picture/Video/Audio tag 顺序映射、视频自带音轨顺序、官方数量/时长预检、Ref-only 决策 |
| P1 | SaveVideo 可写 workflow/prompt 元数据 | 短片路径显式禁用/清理 metadata；二进制和容器 tag 测试，不依赖外部 FFmpeg 才安全 |
| P1 | context profile 只有字符串 | 不可变 `context-profile.schema`、兼容范围、模型/VAE/Comfy/Runner 指纹、迁移/拒绝规则 |
| P1 | 加速配方门没有独立图安全与音频完整性要求 | 基于 20-step 保守基线；Turbo/社区节点逐 recipe A/B；任何音轨或图 lint 失败自动回退 |
| P2 | 固定 seed “可复现”语义过强 | 改成同锁定环境可追溯并满足容差；不承诺跨 GPU/Torch/driver bit-exact |
| P2 | 官方模板会移动 | 固定 workflow template commit、compiler version、object_info fingerprint 与 graph semantic hash |

## 79 项 WBS 依赖与可并行性审计

### P0：当前调度图的硬错误

| 问题 | 当前任务 | 错误 | 修正 |
|---|---|---|---|
| 首批遗漏范围 ADR | A-003、A-005 | 两者明示依赖 A-002，但首批任务没有 A-002 | A-001 后立即完成 A-002；capability/runtime spike 不得绕过范围 ADR |
| 许可任务被错误合并提前 | A-008/A-009/A-010 | A-009、A-010 依赖 A-007；A-007 又依赖 A-004/A-005/A-006 | 首波只做 A-008；A-009/A-010 等 A-007 后分别执行 |
| Schema 被错误提前 | A-012 | 依赖 A-003、A-007；首批说明只等待 A-003/A-005 | 必须等两条 runtime spike、技术栈比较和 A-007；并拆为八类 contract |
| 外部 FFmpeg 错误阻断 Alpha | D-010、E-007、D-012、D-013 | 安装烟测和短片 output graph 都硬依赖 D-009 | 拆 Core short output 与 external finalizer；Alpha 主链移除 D-009 |
| UI 成了编译器前置 | E-002、E-003 依赖 B-004 | 路由和项目实现不应依赖 UI 产物 | 新建 RoutePlan/input-truth contract；B-004 与 E-002/E-003 并行消费 |
| 运行时选择依赖语义含糊 | E-008 依赖 `A-005/A-006` | `/` 无法判断 AND、OR 或选中路线 | 依赖 A-007 和 `selected_runtime_adapter_id`；再依赖打开 PoC 结果 |
| 编译器缺共同 IR | E-005、E-006 | T2 与 I/L/FL 可能各自拼 JSON，无法保证双图/节点安全一致 | 合并共享 RoutePlan→TypedIR compiler；路由 fixture/端点测试分开 |
| 长视频默认 latent ABI | F-008 | 直接从 Runner skeleton 进入“AV latent 上下文” | 拆两种 continuation PoC、ADR、正式 integration，未选择前不建产品任务 |
| 长视频任务混入创作语义 | B-005、F-012 | effective prompt 默认包含自动 envelope | 只展示用户原文和显式 opt-in 文本；默认无自动续写 |

### P1：任务粒度与依赖表达不满足自身规则

Product Audit 要求单项 4–12 Agent 工时，超过 12 小时继续拆分；但下列 19 项的估算上限为 14–20 小时：

`A-005`、`A-012`、`C-004`、`D-004`、`D-005`、`D-006`、`D-007`、`D-011`、`D-012`、`D-013`、`E-010`、`F-004`、`F-007`、`F-008`、`F-009`、`F-010`、`G-003`、`G-008`、`G-010`。

这些不是估算措辞问题，而会造成文件所有权长期占用、集成延迟和 Agent 无法在一轮内完成验证。至少按“契约/实现/故障注入/矩阵报告”拆分。GPU/VM/下载等待继续单列，不能计入 Agent 工时，也不能以并行 Agent 规避互斥锁。

WBS 中 `A-007…A-014`、`B-001…B-006`、`E-001…E-009`、`A-005/A-006` 等范围和斜杠依赖不应进入可执行任务图。发布前应转换成明确 ID 数组；否则自动调度器和人工负责人会对 AND/OR 得出不同结论。

### 建议的任务合并/拆分

| 处理 | 原任务 | 新任务建议 | 目的 |
|---|---|---|---|
| 拆分 P0 | A-012 | A-012a contract conventions；A-012b 五份运营 schema；A-012c capability catalog；A-012d FrameAudioPlan；A-012e TypedWorkflowIR/GraphPair | 让不同 owner 可串行冻结，避免一项 16h 覆盖全部公共真相源 |
| 新增 P0 | 无 | WF-001 上游 commit/capability freeze；WF-002 local/API allowlist 与 lint 规范 | 在 UI/模板/安装前统一“哪个节点是真正本地 H3” |
| 新增 P0 | E-001 附近 | WF-003 `graphToPrompt` 等价 harness | 证明 visual/API 双图不是两份漂移模板 |
| 拆分 P0 | E-004 | E-004a CanvasPlan；E-004b FrameAudioPlan；E-004c 端点保护 GPU PoC；E-004d 4 秒 PoC | 把几何、时间轴、端点和边界时长分离 |
| 合并后拆测 P0 | E-005/E-006 | E-005a 共享 FL2VA RoutePlan→TypedIR compiler；E-005b T2 fixture；E-006a I fixture；E-006b L fixture；E-006c FL fixture | 共享实现，路由风险独立验收 |
| 拆分 P0 | E-007 | E-007a Core SaveVideo short output；E-007b external finalizer（转 Phase 5）；E-007c short metadata sanitizer | 解除 Alpha 对 D-009 的错误硬依赖 |
| 拆分 P0 | E-008 | E-008a 正确实例启动；E-008b 指定 workflow 载入；E-008c 手动导入回退 | 让产品承诺与实测支持等级一致 |
| 合并契约 P0 | B-004/E-003 | 新建 RoutePlan/input-truth contract，由 B-004 渲染 UI、E-003 编译路由 | UI 不成为运行时的依赖 |
| 拆分 P0 | F-008 | F-008a decoded-guide 两段 PoC；F-008b paired-latent/serializer PoC；F-008c continuation ADR；F-008d selected profile integration | 不把社区可行性伪装成官方稳定 ABI |
| 拆分 P1 | F-010 | F-010a segment assembly/timebase；F-010b BGM/voice mix；F-010c public finalization handoff | 30 秒核心组装不被可选音频 UI 阻断 |
| 拆分 P1 | D-012/D-013 | Alpha 基础安装 UI/矩阵；1.0 add-on UI/矩阵；FFmpeg/Ref/Runner 各自 capability matrix | 安装 IA 真正按发布版本过滤 |
| 拆分 P1 | F-013/F-014 | harness、固定用例、GPU 执行批次、报告/门判定 | 把 Agent 工时与 GPU 排队分开，允许测试协调员串行运行 |

### 修正后的首批 5 任务

首批不应包含正式 UI、正式 schema 或 FFmpeg/Comfy 组合许可结论。建议：

| 顺序 | 任务 | 依赖 | 可并行性 | 产物/验收 |
|---|---|---|---|---|
| 1 | A-001 仓库治理与 allowed paths | 无 | 根/集成 Agent | 文件 owner、测试入口、共享 contract 变更流程 |
| 2 | A-002 产品范围 ADR | A-001 | 立即 | 明确工具/H3/Comfy/Runner/烟测边界和“不自动首个 Queue” |
| 3 | WF-001 官方能力与 commit 快照 | A-002 | 与 4、5 并行 | capability 草案；本地/API class type、版本、schema 指纹、已证实/未证实 |
| 4 | A-005 Desktop workflow-open spike | A-002 | 占 Desktop 串行队列 | 发现/启动/载入/手动回退矩阵；不假设 argv 支持 |
| 5 | A-006 managed Portable/Core spike | A-002 | 可与 3 并行；避免占同一 Desktop 实例 | D 盘锁定运行时、最小本地图、路径接入、回滚边界 |

A-004 技术栈比较应在第一空闲位立即启动；A-007 等 A-004/A-005/A-006；A-003 以 WF-001 为事实输入；A-012a–e 等 A-003/A-007。A-008 可在 A-002 后并行，但 A-009/A-010 仍必须等 A-007，因为组合/分发边界取决于实际主运行时。这样才能形成真实的 DAG。

## 发布门修正

| 当前 Gate | 判定 | 修正后的门 |
|---|---|---|
| G0 范围门 | 保留并增强 | capability matrix 必须标 `official-spec/source-reachable/poc-passed/certified/experimental/hidden`，不能只有布尔值 |
| G1 运行时门 | 需改写 P0 | 分开 `runtime-start`、`workflow-auto-load`、`manual-import-fallback`；主路径选择不能自动承诺后两项 |
| G4 Contract 门 | 不通过 P0 | 从五类扩为至少八类核心 contract；必须有 schema、样例、迁移、owner、unknown-field policy、cross-contract invariants |
| G5 硬件门 | 需改写 P1 | 若 Alpha 含 L/FL，基线必须测 T/I/L/FL；空串、4 秒、加速独立 capability |
| G6 FFmpeg 门 | 反对当前作用域 P0 | 移到 long/finalizer gate；Alpha 增加 Core SaveVideo + metadata gate，FFmpeg 失败不等于只能保留中间文件 |
| G8 Alpha 工作流门 | 不通过 P0 | 拆为 G8a 图安全/双图等价；G8b 5/10/15 T/I/L/FL 非空文本；G8c 空提示/占位；G8d 4 秒与端点精确时长；只有已过子门的 capability 对用户显示 |
| G9 Ref2VA 门 | 增强 P1 | 增加 tag 顺序、视频内音轨 tag、Ref-only 空文本决策、Guide+端点组合等级和官方数量/时长边界 |
| G10/G11 长视频门 | 增强 P0 | 先加 Runner Architecture Gate：GraphBuilder、不重入 Queue、continuation profile、checkpoint ABI、全局时间轴；再进入 30/60 秒认证 |
| G12 发布门 | 保留并增强 | 证据包必须含 visual/API graph hash、allowlist/lint 报告、Desktop fallback、无 `/prompt` 预提交、所有公开工件 metadata 扫描 |

建议 G8 的实际放行逻辑：

```text
G8a 通过：编译器可进入内部 Alpha
G8b 通过：对外显示 5/10/15 秒、非空文本的已认证路由
G8c 通过：才显示“只给首/尾帧、提示词可空”
G8d-4s 通过：自定义最小值才从 5 秒降到 4 秒
G8d-endpoint 通过：才宣传“最终一帧严格匹配尾帧 + 精确目标时长”
```

## 最终分级清单

### P0：不关闭就不能让制作 Agent实现 Alpha 主链

1. 冻结官方能力快照、本地节点 allowlist 与 API/Partner fail-closed lint。
2. 把五类 schema 扩为至少八类核心 contract，并指定唯一 owner。
3. 建立 TypedWorkflowIR、双编译器与 `graphToPrompt()` 等价测试。
4. 完成 5/10/15 秒 T/I/L/FL 的端点保护与 A/V `FrameAudioPlan` PoC。
5. 完成 Desktop 自动载入/手动回退 PoC，并按证据收窄产品文案。
6. 把外部 FFmpeg 从 Alpha 基础安装/短片输出依赖中移出。
7. 修复首批 5 任务和 WBS DAG；不允许依赖省略、范围符或斜杠语义。
8. 删除默认自动“继续/自然收束”文本；Runner continuation profile 在正式实现前完成两段 PoC 与 ADR。

### P1：Alpha 冻结前或对应 capability 开启前关闭

1. 空提示词/中性占位三路由矩阵与实际送模文本记录。
2. 4 秒本地认证；未通过则 UI 从 5 秒起。
3. CanvasPlan、首帧拉伸/尾帧裁切预览和比例冲突告警。
4. SaveVideo metadata 清理与公开工件二进制扫描。
5. Ref2VA tag/数量/时长/空文本/Guide+端点 route contract。
6. 24/40/32000 全局时间轴、变长窗口与上下文 profile 版本契约。
7. 拆分 19 个超过 12 小时的 WBS，所有 GPU/VM/download 等待单独调度。

### P2：可在对应稳定门之后优化

1. 统一使用官方任务名 T2VA/I2VA/L2VA/FL2VA/Ref2VA。
2. 固定 seed 只承诺锁定环境内可追溯/容差复现。
3. 模板 commit、编译器版本和 semantic hash 的迁移报告可视化。
4. 高级用户覆盖配方的“一键恢复认证 recipe”。

## 交付判定

`PRODUCT_DELIVERY_AUDIT.md` **可以作为产品治理输入，但不能原样作为制作 Agent 的执行 WBS**。在完成本文 P0 修订前，建议项目状态保持：

```text
可进入：Phase 0、只读检测、独立 PoC
不可进入：正式 Alpha 安装 UI、正式工作流编译主链、30/60 秒产品实现、公开发布
```

一旦 P0 关闭，最窄、可诚实交付的 Alpha 应是：

```text
一个锁定 Windows/NVIDIA 档位
+ 一个主运行时拓扑
+ 已认证的 FL2VA 5/10/15 秒路由
+ H3 原生音频
+ TypedWorkflowIR 双图编译与 API-node fail-closed
+ Core SaveVideo 短片输出与 metadata 安全
+ 启动正确 Comfy 实例；自动载入若未证实则提供清晰手动导入回退
+ 用户在 ComfyUI 点击 Run
```

纯首帧空提示词、4 秒、严格尾帧端点、Ref2VA、外部 FFmpeg finalizer、30/60 秒和水印，应只在各自 capability gate 有证据后逐项加入，不能再次打包成一个“Alpha 全部已支持”的布尔开关。
