# MiniMax H3 + ComfyUI 环境配置与工作流生成工具执行计划

> 文档状态：三路独立审计、红队审计与三路交叉复核已完成；Phase 0 证据任务正在执行  
> 版本：0.4  
> 日期：2026-08-27  
> 首发平台假设：Windows 10/11 + NVIDIA GPU  
> 产品形态：本地安装配置器 + ComfyUI 工作流编译器  

## 0. 文档目的

本文件把当前已确认的产品方向整理为可拆工、可审核、可验收的实施计划。安装工程、工作流架构、产品风险三类独立审核、关键假设红队审核以及三路交叉审核均已完成。后续 Agent 按 `tasks/TASK_BREAKDOWN.md` 的 152 项原子任务和 `tasks/registry.json` 的活动状态执行，由根 Agent `/root` 统一审查、管理和调度。新增的 production app、窄签名 Win32 helper、per-user package 与拆分后的发布决策任务只实现控制平面和交付基础设施，不实现或替代任何媒体生成。

本文件不是最终技术实现，也不授权 Agent 擅自扩大产品范围。任何影响模型来源、许可证、用户文件、系统环境或最终视频质量承诺的改动，都必须先更新本计划并通过对应审查门。

### 0.1 首轮审核结论

结论：**有条件可行**。产品可以做到“安装后无需第三方推理 API，用户填写提示词/素材和时长，即可生成一个在 ComfyUI 中点击运行的工作流”，但必须接受以下边界：

- 先发布 5–15 秒 FL2VA 基线，再增加 Ref2VA，最后发布 30 秒 Stable 候选和 60 秒 Beta；不能把所有能力塞进首个安装包。
- 30/60 秒不能只靠静态 `workflow.json` 保证可靠循环；必须提供本工具固定版本的本地长视频执行器/自定义节点。
- 自动复用仅面向经过明确验证的模型格式和哈希；未知量化、GGUF、Diffusers 目录等只报告，不自动接入 MVP。
- 官方 ComfyUI Desktop 的分发许可证、安装路径和用户目录行为必须先实测；必要时改为“检测现有 Desktop/引导官方安装 + 自有隔离运行时”。
- H3 模型许可的地域、商业展示、下游限制和 AI 生成披露要求，以及 ComfyUI Desktop、FFmpeg 的分发义务，均为发布阻断项。
- 软件本体品牌只作用于软件名称、Logo、作者署名、关于页和安装包；产品不提供视频、图片、音频或输出文件水印。软件本体品牌不能替代 MiniMax H3 归属、NOTICE 或适用时的 AI 生成披露。

### 0.2 制作 Agent 的最高优先级执行指令（不可越界）

> **本项目不是视频生成模型，也不是 AI 导演或视频创作工具。工具本体只负责安装、检测、复用、配置、工作流编译和打开受支持的 ComfyUI 界面；MiniMax H3 是唯一负责生成视频与声音的模型。用户最终在 ComfyUI 中点击“运行”，由 ComfyUI 调用 H3 完成推理。Alpha-0 使用本工具拥有的 ComfyUI Core + 锁定前端；官方 Desktop 只有在独立 `OPEN_AND_FOCUS` 能力实证通过后才可成为自动交接目标。**

任何 Agent 开始任务前都必须按下表确认职责：

| 参与方 | 唯一职责 | 明确禁止 |
|---|---|---|
| 本工具 | 检测电脑；安装或接入 ComfyUI/H3 环境；复用或下载模型；选择锁定配方；生成项目文件和工作流；打开 ComfyUI；配置 FFmpeg 后处理 | 自研或替代 H3 推理；自动替用户提交正式生成任务；创作视频内容；判断故事类型；扩写剧本；生成提示词、音乐或素材 |
| MiniMax H3 | 根据用户原始提示词、首尾帧或参考素材生成视频和 H3 原生声音 | 安装环境、管理磁盘、选择模型文件、修复依赖或管理项目 |
| ComfyUI | 展示并执行工具生成的工作流；在用户点击“运行”后调用 H3 节点 | 替代本工具做全盘扫描、安装决策或组件许可证管理 |
| 制作/测试 Agent | 开发安装器、检测器、配方解析器、工作流编译器、最小调度节点和自动化技术验收 | 实现新的生成模型；把工具扩展成 AI 导演；调用第三方云推理 API；以“做一个示例视频”为产品开发目标 |

不可违反的实现边界：

1. 工具的正常用户路径在“工作流已生成并已打开 ComfyUI”处完成交接，不在本工具界面内自动开始正式推理。
2. `H3LongVideoRunner` 只是 ComfyUI 内的确定性调度器：逐段调用现有 H3 节点、传递上下文、保存检查点并调用 FFmpeg 组装；它不是生成模型，不能包含内容创作或提示词扩写逻辑。
3. 只有任务包明确授权时，开发、安装或 CI 验收才可以自动提交固定、最小、无用户提示词或素材的本地 H3 冒烟任务，用于验证模型可加载、节点可执行、音视频可封装。这些样本由 H3 生成，仅用于一次性技术证据，不属于产品内容功能，不是用户第一笔正式队列，也不作为创意作品交付。
4. 测试 Agent 只判断运行成功率、节点完整性、时长、帧数、音轨、显存、速度、异常与恢复，不评价故事、镜头美感、人物表演或提示词创意质量。
5. 如果某项需求要求工具自行生成内容、调用其他生成 API、自动写剧本或取代 H3，Agent 必须停止实现并提交范围变更审查，不得自行扩展。

**制作 Agent 的正式交付物是源代码、安装包、配置清单、工作流 JSON、测试和验收报告，不是视频作品。测试产生的 MP4 只是 H3 冒烟测试证据，应放在测试临时目录，不进入产品素材或用户项目模板。**

### 0.3 第二轮深度审计后的约束性修订

本节是 0.4 的约束性基线。若后续仍保留的 0.3 细节与本节、已接受 ADR、`docs/OPTIMIZED_ARCHITECTURE.md` 或活动任务 context packet 冲突，以后者为准；Agent 不得挑选旧文字绕开新门禁。

1. **Alpha-0 先做一条受管 ComfyUI Core 垂直路径。**首个闭环只支持一台真实 Windows/NVIDIA 候选机、一个本地固定 NTFS 受管根、一个锁定 FL2VA 配方、5 秒非空提示词 T2VA、H3 原生声音和用户在 ComfyUI 中点击 Run。Desktop/Portable 执行 adapter、Ref2VA、长视频、社区加速、BGM/旁白、超分补帧和正式软件品牌资产不阻塞这条主线。
2. **Desktop 自动打开是独立 capability，不是已成立事实。**只有被实测为 `OPEN_AND_FOCUS` 的版本才满足小白一键交接；`PERSIST_ONLY`、`EXPORT_ONLY` 和手动拖入 JSON 只能算受限/高级回退。
3. **Relay 不提供后台更新、静默安装或组件热更新。**当前 ADR-016 只允许用户明确点击“下载并安装”后，从固定 `PlaTuring/Relay` Stable Release 下载严格更新版本的唯一 Setup；主进程必须复核 API/HTTP/落盘文件的精确长度与 SHA-256、受管目录和固定文件名，随后以空参数启动一次可见的交互式 Setup，且仅在 Windows 接受启动后退出 Relay。组件 catalog 仍随具体应用版本冻结；后台检查/下载、静默参数、任意 URL/路径/命令桥和远程 recipe/catalog 仍被禁止。
4. **现有 ComfyUI 默认 attach-only。**静态发现不得启动外部 Python、导入 custom nodes、执行 pip 或修改 Desktop 私有配置；动态 `/object_info` 认证仅对本工具拥有并完整校验的 immutable generation 执行。
5. **工作流只有一个权威构建源。**`ProjectSpec → RoutePlan → CanvasPlan → FrameAudioPlan → 锁定模板绑定 → canonical workflow.json` 是主链。API graph 由锁定、无第三方 JS 的官方前端投影派生，只作构建/审计证据，不是第二份可编辑真相源，更不能用来自动提交用户的第一笔正式队列。
6. **图安全按精确 `class_type` fail closed。**本地 H3、同名 Partner/API 节点、未知节点和鉴权字段必须明确区分；visual graph、派生 graph、subgraph 和 Runner expansion 都要检查。
7. **外部 `ffmpeg.exe` 由媒体能力解析器决定。**认证通过的 Core/PyAV 原生短片路径可不安装私有 CLI；精确重定时、统一编码、长视频组装、混音或补帧/放大重封装需要私有 FFmpeg/FFprobe。PyAV 自带的 FFmpeg 库仍须进入版本、SBOM 和许可证审查。
8. **端点保护不能统一尾裁。**H3 把尾帧锚定在生成序列最后一帧，124→120 等简单尾裁会删除用户尾帧。`FrameAudioPlan` 必须分别处理 T2VA、I2VA、L2VA、FL2VA，并以同一 24 FPS / 40 Hz latent / 32 kHz PCM 时间轴计算交付。
9. **4 秒、空提示词和严格尾端点是独立 capability。**先认证 5/10/15 秒非空文本路由；纯首帧目标保留，但空串需 PoC。若底层必须有文本，只允许使用用户可见、可替换、版本化的最小中性技术占位，并与用户原文分开记录。
10. **程序默认不追加“继续上一段”或“自然收束”等语义文本。**这仍会改变用户动作和结尾意图。长视频一致性优先靠明确上下文；任何续接文字必须由用户主动提供、默认关闭并逐字可见。
11. **长视频先做两段 PoC。**Stable 候选先验证官方 `MiniMaxH3AddGuide` 的 decoded-guide 路径；paired AV latent 是自研、强版本锁定的实验 profile，不能写成官方契约。Runner 在用户 Run 后用 GraphBuilder 展开，不重入 `/prompt`；崩溃后重启同一 generation，用户再次点击 Run 才恢复。
12. **模型扫描先快后严。**首次页面不对所有 20–40GB 文件同步全哈希；先做路径、大小、受限 Safetensors header/语义指纹，用户选中复用候选后才做完整 SHA-256，并按文件 identity 缓存。
13. **Python 环境在最终 generation 绝对路径构建。**已安装 venv 不从 staging 搬移；验证完成后只切换小型 `active.json` 指针。Alpha 一个根、一个 profile、一个初装 journal，不先实现多卷/多 adapter/五层通用回滚平台。
14. **硬件识别优先 NVML/`nvidia-smi` 或等价 API。**WMI `AdapterRAM` 只能作回退，因为在当前 RTX 5080 上会把 16GB 截断成约 4GB。当前 5080 16GB + 64GB RAM 只是首个候选，不是已认证档位。
15. **社区热度只能帮助发现候选方案。**保守官方基线先通过；Turbo、SageAttention、缓存、卸载和其他加速组合必须分别锁 GPU/驱动/Torch/CUDA/节点/模型并同时验证视频、H3 原生音频、成功率、耗时和资源，失败自动回退基线。

本计划的执行配套文件：

- `AGENTS.md`：主/子 Agent 权限、文件所有权与资源锁；
- `docs/OPTIMIZED_ARCHITECTURE.md`：约束性架构基线；
- `docs/MASTER_ORCHESTRATION.md`：根 Agent 调度和审查流程；
- `docs/DECISION_LOG.md`、`docs/RISK_REGISTER.md`：决策与风险；
- `docs/PLAN_VALIDATION_REPORT.md`：七路审查合并结论、关键优化和仍未关闭的真实门；
- `tasks/TASK_BREAKDOWN.md`：152 项原子 WBS；
- `tasks/registry.json`：已激活任务的状态、owner 与锁；
- `tasks/validate_wbs.ps1`：任务数、依赖、环、gate、锁和活动波次的一键校验；
- `docs/EXTERNAL_GATES.md`：法务、签名、硬件和软件本体品牌资产等不能由 Agent 自行关闭的门。

## 1. 产品一句话定义

这是一个面向小白的 MiniMax H3 + ComfyUI 本地安装配置与工作流生成工具：自动检测电脑、复用已验证模型、安装缺失的受管环境、按硬件选择锁定配方，并输出已经配置好的 ComfyUI 工作流。工具不生成视频；用户只需提供提示词或首帧等有效素材、选择时长，随后在本工具打开的受支持 ComfyUI 界面中点击“运行”，由 H3 生成视频和声音。官方 Desktop 是条件能力，不是 Alpha-0 的既定依赖。

## 2. 已确认的产品原则

### 2.1 产品负责什么

- 检测 Windows、GPU、显存、驱动、内存、磁盘和现有 AI 环境。
- 查找并验证已有 ComfyUI、FL2VA、Ref2VA、文本编码器、Video VAE、Audio VAE、LoRA 和 FFmpeg。
- 复用兼容文件，只下载缺失组件。
- 仅当 D 盘是可写、空间满足要求的本地固定 NTFS 卷时，才推荐把大文件安装到 `D:\MiniMaxH3`；推荐路径必须明确展示并允许用户修改，绝不默认或静默回退到 C 盘。
- 根据硬件选择一个可运行的模型精度和经过认证的加速配方。
- 安装本工具拥有并认证的 ComfyUI H3 运行环境；已有实例默认只读发现/高级导出，不作为 Alpha 普通执行目标。运行环境与 ComfyUI Desktop 在界面上必须解释为不同组件。
- 生成 T2V、I2V、FL2V、Ref2V 和长视频工作流。
- 对 30/60 秒项目自动配置分段、音画上下文、检查点、恢复和拼接。
- 生成项目清单、配方锁文件和工作流 JSON。
- 将工作流交给 ComfyUI 后等待用户自行点击“运行”；除明确标记的安装冒烟测试外，本工具不自动提交 H3 推理队列。
- 为软件 UI、关于页和安装包保留软件本体品牌资产位；该资产位不进入 workflow、媒体 finalizer 或输出文件。
- MiniMax H3 归属、NOTICE 与适用时的“AI 生成披露”是独立合规策略，不能被软件品牌替代或合并成用户水印开关。

### 2.2 H3 负责什么

- H3 是本项目中唯一的视频与原生声音生成引擎。
- 理解用户提示词中的主体、动作、场景、风格、镜头、对白和声音。
- 在单个 H3 生成窗口内决定内容和镜头表现。
- 根据首帧、尾帧或参考素材生成音视频。

### 2.3 产品不负责什么

- 不询问或分类“故事、产品展示、口播、氛围、音乐视频”。
- 不充当 AI 导演，不替用户编写完整故事。
- 不实现文字生视频、图生视频或音视频生成算法，不训练、微调、转换或修改 H3 模型能力。
- 不在工具自身界面提供“生成视频”按钮；用户正式生成必须在 ComfyUI 中点击“运行”。
- 不自动扩写提示词、生成分镜、生成配乐、生成旁白或搜索创作素材；BGM/旁白仅接收用户提供的本地文件并配置后处理。
- 不把自动技术检查结果包装成对视频创意或审美质量的评价。
- 安装完成后的生成不依赖 MiniMax 或其他第三方云推理 API；首次下载、更新和许可证校验仍可能需要网络。
- 当前产品范围不集成、不调用官方未开源的 H3-Context-IR 或 H3-Regenerate-2K；未来若要增加其中任何能力，必须先通过独立范围 ADR，不能作为隐藏、高级或非默认云路径接入。
- 不把一句模糊提示词自动扩写成结构完整的一分钟剧本。
- 不下载同一模型的所有 BF16、INT8、FP8 版本。
- 不修改用户的全局 PATH、CUDA 安装或其他 ComfyUI 环境，除非用户明确选择迁移模式。
- 不移动、删除或覆盖用户已有模型。
- 不实现用户视频水印、文件水印、媒体后处理水印或相应开关；`EXT-BRAND-ASSET` 仅控制软件 UI/关于页/安装包品牌资产。

## 3. 版本与支持边界

### 3.1 Alpha-0 内部垂直切片

- 一个实际可获得、待认证的 Windows 11 + NVIDIA profile；当前候选为 RTX 5080 16GB、64GB RAM。
- 一个工具受管且锁定的 ComfyUI Core/backend/frontend generation。
- 一个用户可见的本地固定 NTFS 受管根；D 合格时建议 `D:\MiniMaxH3`，否则显示真实推荐盘。
- 一个经逐文件验证的 FL2VA、文本编码器、Video VAE、Audio VAE 基础栈。
- 一个 5 秒、16:9、非空提示词 T2VA workflow。
- H3 原生 32kHz 立体声音频和本地可播放短片。
- 本工具只打开并交接到受管 ComfyUI；用户点击 Run 后 H3 才生成。
- 安装完成后断网重复运行。

Alpha-0 仅作内部技术验证，能力最高标记为 `internal`，不能对外宣传。它明确不包含应用内更新、Desktop/Portable 执行 adapter、Ref2VA、空提示词、4 秒、30/60 秒、外部混音、社区加速、放大补帧和正式软件品牌资产。

### 3.2 Alpha-1 受控外测

只有相应 capability gate 通过后才逐项增加：

- 锁定硬件/驱动范围内的 Windows 10/11。
- T2VA、I2VA、L2VA、FL2VA 的 5/10/15 秒路由。
- 4 秒自定义下界、纯首帧空提示词和严格尾端点分别通过独立 PoC 后启用；任一失败只隐藏该项，不拖累已认证路线。
- 白名单模型复用、安全下载恢复、安装失败恢复、断网与零未声明外联认证。
- 经过法务/开源合规/硬件/签名外部门批准的受控安装包。

Alpha-1 普通界面仍不显示 Ref2VA、16–60 秒、社区加速、BGM/旁白、放大补帧和应用内更新；项目创建页在任何版本都没有媒体水印设置。

### 3.3 完整 1.0 目标（Phase 0–5）

在 Alpha-1 基础上按独立门增加：

- Ref2VA 参考图片/视频/音频生成。
- 30 秒 Stable 候选和 60 秒 Beta。
- 16–60 秒由长视频执行器编译的自定义时长。
- 本地 BGM/旁白后期混合和私有 FFmpeg finalizer。
- 硬件分层的预览/最终质量加速配方。
- 远程更新信任、回滚、发布签名、许可证材料和公开发行加固。
- 产品所有者后续提供资产后的软件名称、Logo、作者署名、关于页和安装包品牌集成。

### 3.4 暂不承诺

- AMD、Intel GPU、macOS、Linux 的一键安装。
- 8GB 以下显存的可接受速度或质量。
- 官方云端 2K Regenerate 的完全本地等价质量。
- 一分钟无切镜长镜头的稳定质量。
- 所有第三方自定义节点的任意版本兼容。
- 自动把 Diffusers 多目录权重转换成 ComfyUI 单文件权重。
- 完全无人值守情况下每次都得到可用的一分钟成片。

这些范围可以在后续版本扩展，但不得进入 MVP 的宣传承诺。

## 4. 核心用户流程

### 4.1 首次安装

```text
启动安装器
→ 只读检测硬件、固定磁盘、已知 Comfy 路径和已有模型候选
→ 推荐一个合格的本地固定 NTFS 受管根（D 合格时为 D:\MiniMaxH3），明确展示并允许修改
→ 展示唯一推荐方案：创建独立受管 H3 环境并复用已验证模型
→ 展示找到/验证/复用/缺失的基础组件、用途、来源和状态
→ 按所选盘展示下载量、安装峰值、最终占用和建议余量
→ 在解析 H3 下载 URL 前完成适用许可、地域和组件条款门
→ 使用断点下载、校验、最终 generation 构建和事务 journal
→ 运行不调用 H3 的 runtime/node/model 可见性检查
→ 仅在任务包明确授权且用户明确同意后，可运行一次固定、无用户内容的最小 H3 技术冒烟
→ 显示“受管环境已就绪”及实际路径
```

普通模式不询问 Desktop/Core/Portable，不让用户勾选 Ref2VA、长视频、加速节点、BGM 或补帧，也从不提供媒体水印选项。若发现已有 ComfyUI，文案是“不会修改或运行它的节点；推荐创建独立环境并复用已验证模型”。高级模式才允许只读导出 workflow；“直接使用现有实例执行”不属于 Alpha。

### 4.2 创建项目

Alpha-0 普通用户只面对：

```text
提示词（必填）
时长：5 秒（内部切片固定）
画面比例：16:9（内部切片固定）
```

Alpha-1 在相应 gate 通过后增加首帧、尾帧、5/10/15 秒和认证画幅。4 秒、空提示词和严格尾端点是独立 capability。Ref 素材、BGM/旁白、16–60 秒、导出超分只在 1.0 对应 capability 已安装且通过后出现。

点击：

```text
生成工作流并打开 ComfyUI
```

### 4.3 运行项目

```text
本工具拥有的 ComfyUI Core + 锁定前端打开已经配置好的工作流
→ 用户检查提示词和素材
→ 点击“运行”
→ ComfyUI 调用 MiniMax H3 在本地生成视频和声音
→ 工作流保存检查点并完成拼接
→ 输出视频和运行清单
```

已通过 `OPEN_AND_FOCUS` 实证的官方 Desktop adapter 可以替换第一行；`EXPORT_ONLY` 或手动导入不能替换普通模式的一键交接。

职责交接点是用户点击“运行”：点击前属于本工具的安装、配置、工作流编译和受管实例交接职责；点击后由 ComfyUI 调用 H3 推理，本工具不成为第二个视频生成引擎。Alpha-0 可以使用本工具受管的 ComfyUI Core + 锁定前端，不把官方 Desktop 自动打开当作已成立前提。

## 5. 安装页面产品规格

### 5.1 安装路径区

当 D 盘已经通过“本地固定 NTFS、可写、空间满足要求”检测时，页面按下例显示而不是隐藏路径与占用；D 不合格时必须改为实际推荐的合格非系统盘，只有 C 可用时要求用户明示确认：

```text
安装位置             D:\MiniMaxH3                 [浏览]
模型保存位置         D:\MiniMaxH3\models          [修改]
下载与临时缓存       D:\MiniMaxH3\cache           [修改]
项目与输出位置       D:\MiniMaxH3\workspace       [修改]

可用空间             426 GB
本次新增占用         67 GB
安装后预计剩余       359 GB
```

上述四路径是 1.0 的高级布局示意。Alpha 普通页只提供一个“受管数据位置”，runtime、工具管理的模型、下载缓存、临时文件和 workspace 均在同一固定 NTFS 根下；用户外部模型只读引用。这样避免让小白做多卷选择，也避免跨卷事务被误称为原子操作。

默认策略：

1. Alpha 中若 D 盘为本地固定 NTFS、可写且空间足够，推荐 `D:\MiniMaxH3`；ReFS 只有独立原子替换/重解析点/工具链 PoC 通过后才可在后续版本加入。
2. D 盘不可用时，选择可写、支持大文件且剩余空间最大的非系统本地盘作为建议值，但必须展示。
3. 只有 C 盘可用时，不得静默落到 C 盘；必须让用户明确选择。
4. 模型、Hugging Face 缓存、下载分片、临时解码、ComfyUI temp 和输出默认跟随所选盘。
5. FAT32 单文件上限约为 4GiB，H3 大权重受管根直接拒绝 FAT32；Alpha 只认证本地固定 NTFS。
6. Alpha 不接受网络盘、移动盘或云同步目录作为受管根；本地固定机械盘只能作为未认证高级候选并显示显著 I/O 风险，不能自动套用 SSD/NVMe recipe。
7. 安装前预留下载失败、解压和运行临时空间；所需空间由组件清单动态计算。
8. Windows 可能仍在用户配置目录写入少量设置或日志，但不得写入大型模型和视频缓存。

### 5.2 自动扫描区

安装页打开后先执行非破坏性扫描：

```text
正在查找已有 ComfyUI、H3 模型和视频组件……
```

扫描目标：

- ComfyUI Desktop 已知安装记录和用户目录。
- ComfyUI Portable 常见目录。
- 当前运行中的 ComfyUI 进程及其启动目录（只读）。
- 每个已发现 ComfyUI 的 `models/` 子目录。
- 已存在的 `extra_model_paths.yaml`。
- `HF_HOME`、`HUGGINGFACE_HUB_CACHE` 和默认 Hugging Face 缓存。
- D、E、F 等固定磁盘上的常见 `AI`、`Models`、`ComfyUI`、`HuggingFace` 目录。
- 用户主动选择的其他模型目录。

扫描采用分层授权：

1. 快速扫描已知目录和配置文件。
2. 展示已发现结果，并提供“选择其他模型目录”。
3. 只有用户主动点击“深度扫描其他磁盘”后，才对其勾选的固定磁盘进行精确文件名/模型头特征扫描；显示范围、进度并允许取消。

禁止无提示地递归遍历整块磁盘或用户个人文档。深度扫描也应优先检查候选目录和模型文件特征，不索引无关文件内容。

### 5.3 模型验证与复用

发现候选文件后不能只按文件名判断。至少验证：

- 文件可读、不是零字节或未完成下载。
- Safetensors 头部能够解析。
- 模型角色：FL2VA、Ref2VA、文本编码器、Video VAE、Audio VAE 或 LoRA。
- 精度和当前硬件是否在认证范围内。
- 文件大小和发布清单一致。
- 下载来源或 SHA-256/等价内容哈希可验证。
- 是否为官方 ComfyUI 单文件 Safetensors；Diffusers、GGUF 和社区量化只识别格式，不在 MVP 自动接入。
- 依赖组件是否齐全。

验证分为两级，不能让安装页打开就同步读取所有大文件：

1. **发现/识别：**已知路径、文件名/大小、受限 Safetensors header、关键 tensor 名/shape/dtype、immutable revision 线索；不使用 `torch.load`/pickle。
2. **批准复用：**只有用户或推荐方案选中候选后才做完整 SHA-256、来源链和 recipe 兼容校验；结果按 volume/file identity、size、mtime 缓存，任一变化即失效。

候选状态：

```text
兼容且完整       可直接复用
兼容但缺少依赖   只下载缺失组件
格式不兼容       不直接接入，解释原因
未经认证         可由专家选择，默认不使用
损坏或不完整     禁止使用，不删除原文件
```

复用规则：

- MVP 自动复用的白名单是：组件清单逐文件登记的 ComfyUI 单文件 Safetensors，并同时通过大小、语义头部指纹和完整 SHA-256 校验。界面分别显示模型原创者、重打包/量化发布者和许可证链，不能把所有 Comfy-Org 文件统称为 MiniMax 官方原始权重。
- Diffusers 多目录、GGUF、未知社区量化和来源不明文件显示为“已发现、未经认证”，不自动转换、不自动选择；后续配方认证后再逐项开放。
- 通过当前实例类型对应的模型路径适配器引用原模型位置：受管 Core 可优先使用本工具生成的 `extra_model_paths.yaml`；Portable/Desktop 只有各自 adapter capability 实测确认受支持配置入口后才允许执行接入，Alpha 默认仍只读发现/高级导出。
- 不移动、不复制、不重命名用户模型。
- 不覆盖用户已有配置；对允许写入的文件采用解析、合并、备份和可回滚写入，对 Desktop 自身管理的配置保持只读。
- 每次写入前保留原文件备份并记录变更。
- 工作流 Loader 使用复用模型的真实名称。
- 如果用户更换模型位置，重新生成 `model-registry.json` 和配方锁文件。

### 5.4 组件卡片

每张卡片都必须显示：**用途、是否必需、已发现路径、复用状态、新增下载量、安装后占用、许可证入口和风险提示**。不能只显示模糊名称。

组件页由 capability catalog 动态过滤。Alpha-0 普通页只显示受管运行环境、基础 FL2VA 四角色、Core/PyAV 短片输出和可选最小冒烟；Ref2VA、长视频、私有 FFmpeg finalizer、放大补帧和社区加速完全隐藏，不以灰色“未来功能”增加决策负担。软件本体品牌属于应用壳层而非可选组件；组件目录、工作流和项目设置中不存在媒体水印能力或未来功能入口。

#### A. ComfyUI H3 运行环境能力（必需；可复用或独立安装）

用途：

- 提供隔离的 Python、PyTorch/CUDA Runtime、ComfyUI Core 和 H3 所需原生节点。
- 让工作流在不修改系统 Python、全局 PATH 或用户其他 ComfyUI 环境的情况下运行。
- 固定并验证节点、依赖和运行时版本。

说明：

- **本组件不包含 FL2VA/Ref2VA 模型权重**；运行环境和模型包必须拆开显示。
- Alpha 普通路径固定“创建独立受管 H3 实例并复用已验证模型”，以减少节点冲突、未知外联和版本漂移。
- 现有环境只做静态 attach-only 发现；不得为检查兼容性启动未知 Python/custom nodes。直接执行 adapter 只有独立 capability 通过后才出现。
- 安装、升级和回滚以隔离目录为单位，不执行全局 `pip install`。

#### B. MiniMax H3 基础模型包（含 FL2VA，必需）

用途：

- 文字生成视频和声音。
- 首帧生成视频。
- 尾帧生成视频。
- 首尾帧生成视频。

自动包含：

- 一个按硬件选择的 FL2VA 权重，不是全部精度版本。
- 一个共享 H3 Qwen3-VL 文本编码器。
- H3 Video VAE。
- H3 Audio VAE。
- 与运行环境匹配的模型登记和基础工作流配置。

常用量化基础包约为：

- FL2VA：约 21GB。
- 文本编码器：约 15.7GB。
- Video/Audio VAE：约 5.8GB。
- 合计约 42.5GB；实际以在线组件清单和硬件配方为准。

界面说明必须直写：**“安装后可进行文字生视频、首帧/尾帧/首尾帧生成；本包会自动选择一个适合本机的 FL2VA 权重，不会下载全部精度。”**

#### C. Ref2VA 参考素材生成包（可选）

用途：

- 用参考图片保持人物、产品或风格。
- 用参考视频提供动作、镜头运动、剪辑节奏或编辑上下文。
- 用参考音频提供声音、音色、音乐或声音质感。

包含：

- 一个按硬件选择的 Ref2VA 权重。
- 可选 Ref2VA 快速预览 LoRA。

复用基础包中的文本编码器和 Video/Audio VAE，不重复下载共享组件。常用量化 Ref2VA 权重约增加 21GB，实际以配方为准。

界面说明必须直写：**“用于参考图片、参考视频或参考音频生成；不等同于首帧/尾帧。未使用参考素材时无需安装。”**

#### D. 硬件适配与加速组件（推荐）

用途：

- 根据 GPU、VRAM、驱动、PyTorch/CUDA 组合选择可用内核。
- 配置模型精度、显存卸载、分块和注意力方案。
- 提供快速预览与最终质量两套配方。

原则：

- 不默认安装和开启所有社区加速节点。
- SageAttention、Turbo LoRA、Spectrum、EasyCache 等必须分别认证。
- 原生音频工作流要单独验证音质、爆音、静音和接缝。
- 不兼容时回退到保守基线，而不是强行启用。
- 每个组合标注支持等级：`已认证 / 有限支持 / 实验 / 不支持`；未知 GPU 不自动套用相近显卡配方。

#### E. 长视频续接与恢复组件（1.0 独立能力；Alpha 隐藏）

用途：

- 30/60 秒项目自动分段。
- 按选定 continuation profile 携带上一段上下文；优先验证官方 decoded AddGuide，paired AV latent 仅为强版本锁定实验方案。
- 删除重复上下文。
- 每段原子保存、失败重试和中断恢复。
- 最终精确裁切和组装。

该组件不能只是若干静态 JSON。正式方案必须包含本工具维护并锁定版本的 `H3LongVideoRunner`（名称可在 ADR 中调整）本地执行器/自定义节点，负责窗口循环、选定上下文方式、原子检查点、恢复和组装；其内部调用 ComfyUI/H3 原生能力。Runner 不重入 `/prompt`。崩溃后由用户重新打开同一 generation 并再次点击 Run，才从最近完整检查点恢复。

#### F. 视频处理引擎（按媒体能力解析）

用途：

- 画面和 H3 音频封装成 MP4。
- 长视频片段拼接。
- BGM/旁白混音。
- 精确时长裁切。
- 编码、转码、探测和完整性验证。

包含或复用：

- 通过 Phase 0 分发审查的应用私有 FFmpeg，或通过完整冒烟测试的现有 FFmpeg。
- FFprobe。

外部 `ffmpeg.exe` 不是所有 H3 短片的技术前置条件。认证通过的 Core `CreateVideo`/`SaveVideo` + PyAV 路径可以直接保存带音频短片；PyAV 及其 FFmpeg libraries 仍进入 recipe、SBOM、codec 和 metadata 测试。只有精确重定时/统一编码、长视频拼接、混音或放大补帧重封装等所选媒体能力需要私有 FFmpeg/FFprobe 时，安装卡才把它锁定为必需。软件本体品牌不进入媒体能力解析，也不产生 FFmpeg 依赖。界面必须解释“当前选择为什么需要”，不能写成“没有外部 FFmpeg，H3 只能生成中间文件”。

#### G. 示例及通用工作流（默认安装）

- Alpha-0 只安装 5 秒 T2VA golden workflow 和本机无 H3 runtime 检查图。
- Alpha-1 只加入已经分别通过门禁的 I2VA、L2VA、FL2VA 与时长 fixture。
- Ref2VA、30 秒、60 秒、加速与后处理示例只随相应能力包出现，不能在基础安装中预放一个会缺节点/模型的工作流。

#### H. ComfyUI Desktop（条件安装）

- Alpha 普通模式不安装、不捆绑、不修改 Desktop，只显示“已检测到；我们不会运行或修改它的节点，推荐创建独立 H3 环境并复用已验证模型”。
- 高级模式可 `EXPORT_ONLY`；这不满足小白一键交接 DoD。
- 只有 current-version adapter 完成实例身份、冷/热启动、多实例、未保存画布和 `OPEN_AND_FOCUS` 实证后，才显示“自动在 Desktop 中打开”能力。
- 未发现 Desktop 时不默认勾选安装。官方引导、自动安装或再分发分别受许可和签名门控制。
- Portable 执行 adapter 后移；Alpha 只允许静态发现或高级导出。

是否能够控制官方 Desktop 本体安装目录必须在启用 Desktop 自动安装/交接 capability 前实测，不阻塞 managed Core Alpha。官方 Desktop 即使安装在非系统盘，也可能在 `%APPDATA%` 或 `%LOCALAPPDATA%` 写入少量用户数据；产品只能承诺大型模型、缓存、中间视频和输出不落 C 盘，不能宣传“C 盘零写入”。若上游安装器不能完全遵守受管路径，该 capability 保持隐藏；主线继续采用可控路径的隔离 ComfyUI 运行时，并明确 Desktop、运行时和模型/缓存是三个不同概念。

#### I. 本地放大与补帧组件（可选）

用途：

- 本地放大到 1080p/2K。
- 24 FPS 补帧到 48/60 FPS。

不得宣传为官方 H3-Regenerate-2K 等价实现。安装页必须显示额外模型大小、预计时间和质量风险。

本组件在 Alpha-0/Alpha-1 完全隐藏，只有独立模型来源、性能、输出和 FFmpeg 路线认证后才进入 1.0 高级能力。

## 6. 模型与组件目录规范

当 D 盘满足受管根条件时的推荐目录示例：

```text
D:\MiniMaxH3\
├─ app\
├─ runtime\
│  ├─ ffmpeg\
│  └─ helpers\
├─ comfyui\                 # 仅当安装自有运行时
├─ models\
│  ├─ diffusion_models\
│  ├─ text_encoders\
│  ├─ vae\
│  ├─ loras\
│  └─ upscale_models\
├─ cache\
│  ├─ downloads\
│  ├─ huggingface\
│  └─ temp\
├─ workspace\
│  ├─ projects\
│  └─ output\
├─ manifests\
└─ logs\
```

用户复用外部模型时，`models/` 可以只保存本工具下载的缺失组件；其他路径由模型注册表和对应 ComfyUI 实例的模型路径适配器引用。

## 7. 硬件检测与配方系统

### 7.1 必须采集

- Windows 版本和架构。
- GPU 厂商、型号、计算能力、VRAM。
- NVIDIA 驱动版本。
- CPU 和系统 RAM。
- 固定磁盘、文件系统、可用空间和盘类型。
- 已有 Python、ComfyUI、PyTorch、CUDA Runtime 版本。
- 已安装自定义节点及其 commit/version。
- FFmpeg/FFprobe 路径、版本和编码能力。

默认不上传任何硬件信息。检测结果保存在本地并可由用户查看、导出和删除。

NVIDIA 识别优先使用 NVML、`nvidia-smi` 或等价受支持接口，并交叉记录设备 ID/LUID；WMI `AdapterRAM` 只作低置信度回退，不能单独选择 recipe。当前开发机的 RTX 5080 实际为约 16GB，但 WMI 只返回约 4GB，这一冲突必须成为硬件 probe 负向 fixture。

### 7.2 配方不是简单 GPU 名称表

配方键至少包括：

```text
OS + GPU 架构 + VRAM + 驱动
+ ComfyUI 版本 + Python + PyTorch + CUDA Runtime
+ 模型家族/精度 + 文本编码器精度
+ 是否生成 H3 原生音频
+ 分辨率 + 时长档位
```

每个配方包含：

- 模型文件及哈希。
- 必需节点及固定版本。
- 采样器、步数和 scheduler。
- 注意力实现。
- 显存卸载和系统内存策略。
- 预览/最终质量配置。
- 已知问题和禁用组合。
- 冒烟测试期望值。

首个配方只覆盖一个真实可测硬件/驱动/runtime/model 组合。当前机器只是 candidate profile；在 5 秒 T2VA H3 冒烟、峰值 VRAM/RAM/磁盘和离线复跑通过前，UI 不得标记“已认证 16GB 档”。

### 7.3 回退规则

- 加速内核不可用：回退标准 attention。
- Turbo/缓存导致测试失败：关闭并保留基础工作流。
- VAE 解码 OOM：降低分段长度或使用已认证的解码策略。
- 音频测试失败：关闭影响音频的加速组合，不允许只验证画面。
- 未知 GPU：只提供诊断报告，不声称兼容。

## 8. 项目创建页面规格

### 8.1 必填与有效输入规则

- Alpha-0：非空提示词；时长固定 5 秒。
- Alpha-1/1.0：总时长，以及提示词、首帧、尾帧或已启用 Ref2VA 时的有效参考输入组合；每种组合由 capability truth table 决定，未通过的组合不显示。

“只有首帧、提示词为空”仍是产品目标，但不是已证实的上游事实。必须分别对首帧、尾帧、首尾帧做空串 PoC；如果锁定 H3/ComfyUI 技术上不接受空文本，编译器只能使用版本化的最小中性技术占位文本，且必须在创建页和 `project.h3.json` 中明确展示、允许用户替换，不能暗中进行故事扩写或对有意义的对白/音乐作承诺。

### 8.2 可选素材槽必须分开

- 首帧：必须成为视频第一帧的端点锚点。
- 尾帧：必须成为视频最后一帧的端点锚点。
- 参考图片/视频/音频：保持身份、风格、运动、镜头或声音，需要 Ref2VA。
- BGM/旁白：最终完整音轨或混音素材，不等同于参考音频。

### 8.3 默认值

- 画面比例：自动；有首帧时跟随首帧，无首帧时 16:9。
- H3 生成画布：自动；根据已认证的硬件 recipe、32 像素网格和源素材比例选择并预览裁切。只有安装本地超分能力后才出现独立“导出分辨率”，且明确不是 H3 Regenerate-2K。
- H3 原生声音：开启。
- 种子：自动生成并写入项目清单。
- 输出目录：当前项目目录。

### 8.4 不出现在普通界面

- 内容类型。
- 模型文件名。
- Sampler、Scheduler、Steps、CFG。
- 量化等级。
- Sage/Spectrum/EasyCache/Turbo 开关。
- 上下文帧数。
- VAE 分块参数。
- 显存卸载参数。
- FPS 和音频采样率。

这些仅在“专家设置”中只读展示或允许高级用户覆盖；覆盖后配方标记为“未认证”。

## 9. 工作流路由规则

| 用户输入 | 默认路径 | 模型家族 |
|---|---|---|
| 只有提示词 | T2VA | FL2VA |
| 只有首帧，提示词为空 | I2VA；空串/中性占位 capability 通过后启用 | FL2VA |
| 只有尾帧，提示词为空 | L2VA；空串/中性占位 capability 通过后启用 | FL2VA |
| 提示词 + 首帧 | I2VA | FL2VA |
| 提示词 + 尾帧 | L2VA | FL2VA |
| 提示词 + 首帧 + 尾帧 | FL2VA | FL2VA |
| 提示词 + 参考图片/视频/音频 | Ref2VA | Ref2VA |
| 参考素材 + 精确端点 | Ref2VA + 原生 Guide | Ref2VA，进入高级兼容测试 |
| 只有参考素材、提示词为空 | 默认不支持；单独 Ref-only PoC 后决定 | Ref2VA |

路由由素材槽决定，不分析“故事、口播、MV”等语义类型。

Ref2VA 编译器可以按连接顺序机械生成并向用户展示 `<Picture i>`、`<Video i>`、`<Audio i>` 标签映射，但不能猜测某个素材负责身份、动作、风格、镜头或声音。正式路径按 MiniMax 官方数量、单项时长、总时长和混合文件上限预检；当前 Comfy schema 更宽松不等于产品可放宽官方边界。

如果用户选择了参考素材但没有安装 Ref2VA：

- 创建页明确提示缺少哪个功能包。
- 提供返回安装管理页下载或选择已有 Ref2VA 路径。
- 不得把参考图片静默当成首帧。

## 10. 时长编译规则

### 10.1 原生单段

H3 官方规格为 4–15 秒、24 FPS；产品只承诺锁定本地路径已经实际认证的 frame plan。当前 Comfy 节点将帧数向上对齐到 `17k+5`，Alpha-0 先做 5 秒，Alpha-1 先做 5/10/15 秒，4 秒另设 PoC。

| 用户时长 | H3 生成帧 | 最终帧 |
|---|---:|---:|
| 5 秒 | 124 | 120 |
| 10 秒 | 243 | 240 |
| 15 秒 | 362 | 360 |

表中“从生成帧裁到交付帧”不是统一尾裁命令。`last_frame` 位于生成序列末端，5 秒的 124→120 若裁掉尾部 4 帧就会删除尾锚。编译器必须生成 route-specific `FrameAudioPlan`：

- T2VA/仅首帧：可以评估尾裁，但同步处理音频和 PTS；
- 仅尾帧：比较裁头与整体 A/V 重定时，最终一帧必须保留尾锚；
- 首尾帧：保留两端，只能从内部受控丢帧/重采样、整体重定时，或交付明确对齐后的实际时长；
- 所有路径：requested/generated/delivered 帧、24 FPS PTS、40 Hz audio latent steps、32kHz PCM samples 从同一个全局有理时间轴推导。

在端点 PoC 通过前，不能同时宣传“精确时长”和“严格保留最终尾帧”。工具也不通过自动改写提示词来掩盖裁切问题。

### 10.2 30/60 秒长视频

不构造默认单次 30/60 秒 latent。工作流编译为短窗口串行任务：

```text
原始提示词
→ 合法窗口计划
→ 片段 1
→ 保存已选择 profile 的上下文和检查点
→ 后续片段携带明确的尾部视频/音频上下文
→ 删除重复上下文
→ 每段落盘
→ 流式组装
→ 精确裁到目标帧数
```

默认技术策略：

- 工作流按硬件选择约 5–15 秒的窗口。
- 第一条 PoC 使用官方 `MiniMaxH3AddGuide` 支持的 decoded-guide：上一段合法尾部帧批次和音频重新编码为 Guide。22 帧只是官方支持网格中的首个候选值，仍需锁版本实测。
- paired AV latent 续接是独立 Experimental profile；必须保存两个 tensor、dtype/shape、分辨率、fps/audio rate、模型/VAE/runtime/recipe/context hash，并在 ABI 不匹配时拒绝。
- 同一续接链固定分辨率、24 FPS 和 H3 原生 32kHz 音频时间轴。
- 最后输出可统一转为用户选定的交付格式。
- 每段使用明确 ID，禁止以“最新文件”作为隐式父片段。
- 每段结束原子保存，失败只重跑当前及后续依赖段。
- 60 秒无切镜只标记为实验能力。

分段数必须考虑重叠，而不是简单使用 `总时长 / 单段时长`。若目标帧数为 `T`、每个生成窗口为 `W`、相邻窗口重叠为 `O`，则：

```text
N = max(1, ceil((T - O) / (W - O)))
总有效帧 = W + (N - 1) × (W - O)
```

编译器把目标帧、窗口、重叠、片段数和最终裁切点写入项目清单，并用同一时间轴计算音频重叠与裁切。

### 10.3 不使用语义导演的提示词处理

程序不判断视频类型，也不调用本地/云端 LLM 扩写故事。

确定性规则：

1. 如果提示词包含工具明确支持的时间码或 `---` 分隔符，只按用户写出的结构机械分配到片段。
2. 普通提示词在每个窗口继续使用用户原文。
3. 默认不追加“继续上一段”“不重复动作”“自然收束”等文本；这些会改变用户动作和结尾意图，不是纯技术参数。
4. 未来若提供“逐段续接文本”，它必须由用户主动填写、默认关闭、逐字可编辑并写入项目清单。
5. 空提示词的最小技术占位只服务底层节点输入有效性，必须可见、版本化且不加入人物、故事、风格、动作或声音语义。

长视频一致性主要依赖选定的 Guide/上下文 profile；产品不能承诺一句模糊提示词会自动形成完整一分钟故事。

## 11. 长视频运行与恢复

Alpha 的短视频工作流只使用锁定的 ComfyUI 原生节点；长视频在后续由固定版本、本工具签名/锁定的 `H3LongVideoRunner` 调度。静态工作流 JSON 只呈现入口和参数，Runner 在用户一次点击 Run 后通过 Node Expansion/GraphBuilder 展开本地 H3 依赖链，不能在节点中重入 `/prompt`。`H3LongVideoRunner` 每个窗口仍调用 MiniMax H3 完成实际音视频生成；Runner 本身不实现扩散/采样模型、不创作内容、不改写用户语义。

执行器必须调度 H3，并保存或登记以下 H3 输出与运行状态：

- 每段视频预览。
- 每段所选 continuation profile 的上下文；decoded-guide 保存合法尾部帧/音频，paired-latent 仅在 Experimental ABI 中保存成对 latent。
- 每段解码视频和音频 sidecar。
- prompt、seed、父片段 ID 和 recipe hash。
- accepted/completed/failed 状态。
- 最终 assembly manifest。

断点规则：

- 关闭 ComfyUI 或系统重启后，重新启动同一 runtime generation；用户再次点击 Run 后，Runner 才从最后完整片段继续。本工具不静默自动重新提交正式队列。
- 半写入文件不得被识别为完成。
- 修改第 N 段的提示词、种子、参考或模型后，连续链的 N+1 以后缓存失效。
- 只发生 OOM/内核错误时，首先用相同 seed 和内容重试。
- 模型、VAE、LoRA、节点或核心配方变化时，必须重新验证缓存兼容性。

未完成 run 对 runtime generation、模型、Runner、checkpoint 和项目 revision 持有引用/租约；更新、GC 或卸载不得删除仍被引用的内容。

自动检查至少包括：

- 最终帧数和时长。
- 视频 FPS、分辨率和编码格式。
- 音频采样率、声道和时长。
- NaN、黑帧、灰片和纯色异常。
- 尾部近冻结。
- 接缝亮度/颜色大跳变。
- 静音、DC、爆音和明显音量阶跃。

## 12. ComfyUI 工作流呈现

小白工作流不展示大量交叉连线。建议采用 ComfyUI Subgraph、分组节点或自有宏节点，主画布只展示：

```text
项目输入
→ H3 模型与硬件配方
→ 时长/分段运行器
→ 解码与自动检查
→ 拼接、混音与输出
```

必须保留“展开或查看详细工作流”的能力，避免黑盒。专家可以复制完整图继续编辑。

工作流生成器必须使用 ComfyUI 当前对象信息/schema 写入 widget 值，不能依赖易错的固定数组位置。

## 13. 项目文件与数据契约

每个项目目录至少包含：

```text
project-name\
├─ project.h3.json
├─ workflow.json             # canonical ComfyUI 可视化工作流；用户可查看/编辑的主构建物
├─ recipe.lock.json
├─ capability.snapshot.json
├─ route-plan.json
├─ canvas-plan.json
├─ frame-audio-plan.json
├─ resolved-profile.json     # 本机最终解析后的硬件/上下文配方
├─ model-registry.snapshot.json
├─ build\<build-id>\
│  ├─ prompt.derived.json    # 锁定官方前端投影出的审计/测试产物，不是第二权威源
│  └─ build.manifest.json    # workflow/recipe/template/frontend/object-info/hash 闭环
├─ assets\
├─ checkpoints\
├─ segments\
├─ output\
├─ run.manifest.json         # 首次运行时创建
└─ render-log.jsonl          # 逐事件追加，不记录完整敏感素材
```

`project.h3.json + recipe.lock.json + 素材哈希 + canonical workflow.json` 构成权威项目 revision。派生 API graph 只能由同一 build transaction 产生，用户不编辑，任何上游指纹变化即失效。本工具不通过它自动提交正式任务。

### 13.1 `project.h3.json`

- 用户原始提示词（允许为空）。
- 实际送入模型的有效提示词及来源；若为空提示词路径使用中性技术占位文本，必须单独标记，不能伪装成用户输入。
- 用户选择的总时长、画幅和最终清晰度。
- 素材角色与相对路径。
- 是否生成 H3 原生音频。
- BGM/旁白处理方式。
- 固定技术续写指令。

“固定技术续写指令”在 0.4 中改为可选、用户主动填写的逐段文本；默认不存在。若底层需要空输入占位，只记录版本化最小技术占位及其来源，不伪装为用户文本。

### 13.2 `recipe.lock.json`

- ComfyUI 版本/commit。
- Python、PyTorch、CUDA Runtime。
- 自定义节点版本/commit/hash。
- 模型、编码器、VAE、LoRA 路径与哈希。
- 采样、注意力、显存和长视频配置。
- FFmpeg/FFprobe 版本。
- `context_profile_id`、工作流 schema 版本和 `H3LongVideoRunner` 版本。

### 13.3 `model-registry.json`

- 模型角色。
- 真实路径。
- 文件格式和精度。
- 文件大小、哈希、来源和验证时间。
- 是否由工具安装或仅引用。
- 是否允许卸载器删除。

### 13.4 删除规则

- 卸载器只能删除 `managed_by_tool=true` 的文件。
- 引用的外部模型永不删除。
- 删除前展示准确列表。
- 项目和输出默认保留，除非用户明确勾选删除。

## 14. 系统模块建议

| 模块 | 职责 |
|---|---|
| Desktop UI | 安装、扫描结果、组件说明、项目创建和状态展示 |
| Hardware Probe | GPU/驱动/RAM/磁盘/Comfy/PyTorch 检测 |
| Component Catalog | 官方模型、节点、FFmpeg、工作流及许可证元数据 |
| Recipe Resolver | 根据硬件和功能选择固定配方 |
| Model Scanner | 查找、识别、验证和登记已有模型 |
| Download Manager | 断点下载、临时文件、哈希校验和原子落盘 |
| Environment Manager | Alpha 构建最终路径 immutable managed Core generation；外部实例只读 attach-only |
| Model Path Bridge | 按 Desktop/Core/Portable 类型安全读取或合并模型路径配置 |
| Workflow Compiler | 编译 Project/Route/Canvas/FrameAudio 计划并绑定锁定模板，生成 canonical visual workflow；API graph 只在受管 harness 中派生验证 |
| Resource Coordinator | 管理 artifact、volume、runtime、GPU、project-run、Desktop 和 VM 租约，阻止多 Agent 重复下载或争抢资源 |
| H3 Long Video Runner | 用户 Run 后通过 GraphBuilder 调度现有 H3 节点，管理选定上下文 profile、检查点、恢复和组装；不包含或替代生成模型实现，不重入队列 |
| MiniMax H3（外部模型组件） | 在 ComfyUI 工作流内执行实际视频与原生声音生成；不是本工具自行实现的模块 |
| Project Manager | 项目文件、素材、锁文件和升级迁移 |
| Diagnostics | 冒烟测试、日志、支持包和回滚 |

Phase 0 技术栈 ADR 已接受：Relay production 控制平面使用 Electron + TypeScript，并配合一个窄、版本化的 Win32 helper。Electron 只实现 UI、受限 IPC、安装/检测/配置、工作流编译和 ComfyUI 交接；helper 只暴露批准的 handle、volume、reparse-point 与 pre-first-instruction Job 操作，禁止 generic shell/command bridge。ADR-015 另行允许用户主动的 Stable Release 检查与 Setup 校验下载，但禁止后台检查、Portable 下载和自动执行。三类 production 任务均不得包含模型推理、媒体生成、提示词创作或正式 `/prompt` 提交。

Tauri/Rust 仅保留为满足 ADR 明确重开条件后的 evidence-gated revisit；.NET 不是并行生产分支；Python/PySide 不作为控制平面。剩余生产门包括原生 helper 实机验证、签名、干净 VM、离线打包可重建、可访问性、安全更新 SLA 和发布物体积/C 盘预算，不得把 spike 证据宣传成这些门已经关闭。

任何本工具模块都不得新增独立的视频生成服务、模型推理后端、提示词创作服务或第三方生成 API 适配器。

## 15. 下载、更新与回滚

### 15.1 下载

- 只从组件清单允许的官方或审计通过来源下载。
- 组件清单必须签名，条目包含来源 URL、版本、大小、SHA-256、许可证和兼容配方。
- 使用 `.partial` 临时文件和断点续传。
- 下载缓存位于用户选择的盘。
- 校验通过后原子重命名。
- 失败不删除可续传分片。
- 计算并展示下载量、峰值临时空间和最终占用。
- 普通下载/归档在所选卷的 `.partial`/staging 中完成；但 Python venv/runtime generation 必须直接在最终不可变绝对目录构建，因为已安装 venv 通常不可搬移。该 generation 在 `install-state` 中保持 incomplete，验证通过后只原子替换小型 `active.json` 指针。失败时完整旧 generation 继续可用，半安装永不成为 active。

### 15.2 版本锁

- 每个正式配方锁定 ComfyUI、节点、Torch/CUDA、模型和 LoRA。
- 不自动更新到未经认证的最新版本。
- Relay 1.0 仅按 ADR-015 提供用户主动的固定 GitHub Stable Release 检查与 Setup 校验下载；不在后台检查，不自动执行安装包，也不允许远端改变 catalog。每个组件 catalog 随应用版本冻结。
- 真正引入后台或自动更新前，必须实现 TUF 或具备抗回滚、冻结、混搭、过期、密钥轮换/吊销和通道隔离的等价协议；更新前创建配置备份和可回滚 generation。

### 15.3 现有环境保护

- 不在用户现有 ComfyUI 中执行无版本锁的 `pip install -U`。
- 推荐并行隔离运行时或严格的依赖事务。
- 写入自定义节点前检查同名目录和工作树状态。
- 不覆盖用户修改过的节点代码。

## 16. 安全、隐私与许可证

### 16.1 离线和隐私

- 模型下载完成后，生成流程应能完全离线运行。
- 宣传统一使用“安装完成后可离线生成”，不得表述为“安装全过程无需网络”。
- 默认无遥测、无提示词上传、无素材上传。
- 更新检查可关闭。
- 日志默认不记录完整提示词和素材内容。
- 导出支持包前显示将包含哪些路径、版本和日志。
- 公开交付的 MP4 默认清除提示词、工作流 JSON、用户名、本地绝对路径和其他调试元数据；完整清单只保存在本地项目目录。
- 在联网测试环境进行生成阶段抓包：从点击“运行”到最终文件落盘，工具、ComfyUI、自定义节点和 FFmpeg 不得产生未声明的外联；安装下载和更新检查必须使用独立进程阶段及可审计域名清单。

“完全离线/零未声明外联”的强认证默认只授予本工具受管 generation：显式 loopback、锁定前端/模板、Manager 关闭、`--disable-api-nodes`、未知 custom nodes 关闭、运行期下载关闭，并对整个受管进程树做断网和在线抓包负向测试。任意用户现有 Desktop/custom-node 实例只能标记为发现/兼容候选，不能因一份 workflow allowlist 就继承同等认证。

### 16.2 节点供应链

- 安装器和生成进程默认以普通用户最小权限运行，不安装显卡驱动、系统 CUDA 或全局 Python；确有管理员操作时必须单独解释目标并由用户明确确认。
- 自定义节点可以执行 Python 代码，必须使用 allowlist。
- 固定仓库、commit、内容哈希和许可证。
- 锁定所有传递 Python 依赖：生成 lockfile，保存 wheel 来源、版本和哈希；Stable 运行时只从已校验的本地 wheelhouse 安装。
- 安装前展示用途和来源。
- 禁止运行任意工作流自动推荐的未知节点安装脚本。
- 禁止 ComfyUI Manager 在 Stable 配方中自动安装“latest”或自动升级锁定节点。
- 一个正式配方只启用一个长视频执行引擎，避免多个循环插件同时接管队列和状态。
- 首次加载节点在隔离环境完成导入测试。
- 生成阶段禁止触发联网 `pip install`、节点下载或模型下载；缺失依赖必须在进入 ComfyUI 前由安装阶段显式解决。
- 发布物生成 SBOM；解压必须防路径穿越、符号链接逃逸和压缩炸弹，子进程以参数数组启动而不是拼接 shell 命令。

### 16.3 MiniMax H3 模型许可证与使用政策（P0 发布门）

- 下载 H3 前展示 [MiniMax H3 Community License](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE) 与适用使用政策，记录许可版本、文本哈希、接受时间和工具版本。
- 2026-08-02 版许可把适用地域定义为全球但排除欧盟、英国、大韩民国和美国；发布、下载入口、地域可用性和转分发方式必须先经法务确认，不能仅靠安装页复选框解决。
- 商业产品界面必须醒目展示 `MiniMax H3`；可以由产品所有者后续设计软件本体品牌样式，但不能删除模型名称归属。
- 使用 H3 的商业产品和服务年收入超过 2,000 万美元时需事先取得 MiniMax 书面授权；具体收入范围和主体归属由法务按许可证原文解释，发行流程保留确认记录。
- 产品需把适用的下游使用限制传递给用户，建立合理安全防护和违规报告入口。
- 面向公众传播机器生成内容时，适用的 AI 生成披露由独立 Human/legal 策略执行；它不是用户水印，也不由软件本体品牌资产控制。若适用规则要求把标识写入媒体文件，当前工具应阻断相应发布并转交外部合规流程，而不是获得修改媒体的权限。
- 优先由用户从官方源下载权重，不将大模型直接打包进安装器。
- 工具宣传不能暗示模型权重归本工具所有。
- 上述为工程发布门，不构成法律意见；正式商业发布前必须由合格法务复核当时有效的许可版本。

### 16.4 ComfyUI Desktop 分发（P0 发布门）

- [ComfyUI Desktop](https://github.com/Comfy-Org/Comfy-Desktop/blob/main/README.md) 采用 `AGPL-3.0-or-later` / 商业许可双许可；是否打包、修改或与本工具一体分发必须先做许可证评审。
- MVP 默认优先检测现有 Desktop，或把用户引导到官方安装渠道；本工具与 Desktop 保持独立进程和独立安装边界。
- 未经许可确认不得把官方 Desktop 二进制直接塞入闭源安装包，也不得把“可勾选安装”理解为天然拥有再分发权。
- 如果选择 AGPL 路径或商业许可路径，必须在 ADR 中写明发布物、源码提供、网络交互、修改内容和 NOTICE 处理方式。

### 16.5 FFmpeg 分发（P0 发布门）

- 依据 [FFmpeg 官方法律说明](https://ffmpeg.org/legal.html) 选定并锁定构建：默认组件通常适用 LGPL 2.1+，启用 GPL 组件后整体会进入 GPL 2+ 路径。
- 保存构建来源、版本、配置参数、二进制哈希和启用编码器清单；不得随意更换网上来源不明的“全功能包”。
- 随安装包提供对应许可证、第三方 NOTICE、About 入口以及适用的源代码/链接义务材料。
- 建立使用到的编码器清单并由发布审查确认。
- 单独评估目标市场的编解码器专利问题；开源许可证合规不等于专利许可已经解决。

## 17. 软件本体品牌与独立合规层

软件本体品牌只出现在控制平面和发行物：

```text
软件名称 / Logo / 作者署名
→ 安装包与应用 UI
→ 关于页和第三方许可证入口
```

品牌契约必须固定 `software_brand_only=true` 和 `media_branding_authority=false`。它可绑定产品所有者提供的软件名称、Logo、作者署名、关于页布局和安装包素材，但不得：

- 写入视频、图片、音频或输出文件；
- 增加媒体水印、文件水印、后处理水印或相应开关；
- 进入 workflow graph、FFmpeg finalizer 或项目创建字段；
- 替代或关闭 MiniMax H3 商业 UI 归属、Agreement/NOTICE 或适用时的 AI 生成披露。

MiniMax H3 attribution、NOTICE 和条件性 AI disclosure 由许可证/Human gate 独立决定。它们不是“用户水印”，不得冒充产品所有者的软件名称、Logo 或作者署名，软件 Logo 的存在或缺失也不改变其适用性。当前工具只能在应用 UI、关于页、NOTICE/许可证材料和导出前提示中呈现这些合规信息；该义务不授予工具转码、叠字、叠加 Logo 或以其他方式修改视频、图片、音频和输出文件的权限。若合规结论要求媒体内标识，当前版本必须 fail closed 并转交外部合规流程。`EXT-BRAND-ASSET` 只审批软件 UI/关于页/安装包资产；Agent 不得自行生成或替代正式品牌资产。

## 18. 错误处理与用户提示

错误必须说明三件事：发生了什么、哪些文件已安全保存、下一步可做什么。

典型错误：

- D 盘不存在或空间不足。
- 模型文件损坏或格式不兼容。
- 已有 ComfyUI 版本不受支持。
- 驱动过旧。
- SageAttention wheel 与 Torch/CUDA 不匹配。
- 节点导入冲突。
- VAE 解码 OOM。
- FFmpeg 缺少编码器或音频混合失败。
- 长视频某段失败。
- 下载中断或哈希不一致。

禁止使用只有错误代码、没有恢复建议的提示。

## 19. 测试与认证矩阵

### 19.1 安装器测试

- 全新 Windows 环境、D 盘存在。
- D 盘不存在。
- 只有 C 盘可用。
- D 盘为 FAT32、网络盘、移动盘或空间不足。
- 已有 ComfyUI Desktop。
- 已有 Portable ComfyUI。
- 多个 ComfyUI 共存。
- 已有完整 FL2VA。
- 只有共享编码器/VAE。
- 已有完整 Ref2VA。
- 已有 Diffusers 格式但无 Comfy 单文件格式。
- 下载中断、系统重启、恢复下载。
- 更新失败和回滚。
- 卸载时外部模型不受影响。
- 验证 C 盘没有出现大型模型、缓存或临时视频。

### 19.2 工作流执行兼容性测试（由 H3 生成最小测试样本）

以下是跨阶段测试目录，不是 Alpha-0 一次性必过清单；每项只在其依赖 capability/模型/媒体组件安装并过门后执行。测试只是让 ComfyUI 调用 H3 生成最小样本，以证明安装和工作流可执行。制作 Agent 不创作这些视频，也不把测试样本作为产品内容交付：

- 5 秒 T2V。
- 5 秒首帧 I2V。
- 首尾帧 FL2V。
- Ref2VA 图片参考。
- Ref2VA 视频/音频参考。
- H3 原生立体音频输出。
- 本地 BGM/旁白混音。
- 16:9、9:16、1:1。
- 自动分辨率和手动覆盖。
- 30 秒分段生成与精确输出。
- 60 秒 Beta 分段生成。
- 第 N 段失败后的恢复。
- 修改前段后缓存失效。
- 工作流在 ComfyUI 中可视、可编辑、可运行。
- 纯首帧空提示词矩阵：通过才进入受支持 I2VA；如需中性占位文本，界面和项目清单均可见；失败则只隐藏该组合。

### 19.3 技术稳定性与性能测试（非创作质量评审）

这里只检查技术指标，不评价题材、故事、镜头语言、美感或人物表演：

- 固定 seed 可复现。
- 黑帧、灰片、冻结和 NaN 检测。
- 音频静音、DC、爆音和接缝检测。
- 加速配方与保守基线的成功率、耗时、显存、帧/音轨完整性 A/B。
- 冷启动与暖启动。
- 峰值 VRAM/RAM/磁盘临时占用。
- 断网后运行。
- 联网环境抓包验证生成阶段无未声明外联，且不会触发运行期 `pip install`、节点或模型下载。
- 连续运行多个项目后无路径串用或状态污染。

### 19.4 正式认证最低门槛

- 每个硬件档位完成基线 T2V/I2V/音频测试。
- 30 秒方案至少 10 次完整运行后才可标记 Stable。
- 60 秒方案探索期至少 3 次，正式 Stable 前至少 10 次。
- 所有正式配方保存版本、seed、耗时、峰值资源和技术完整性检查结果。

## 20. 分阶段实施计划

0.4 采用“证据门 → 最小闭环 → 扩能力”的顺序。完整任务、精确依赖、工时、队列和验收见 `tasks/TASK_BREAKDOWN.md`；本节只定义阶段目标和退出门。

### Phase 0：范围、事实和架构冻结（当前进行中）

目标：在大模型下载、GPU 运行和正式产品模块并行前，关闭会推翻主路径的事实与合同。

任务：

- 固化产品边界 ADR：工具不生成、不创作、不自动提交第一笔正式 Queue；H3 在用户 Run 后生成。
- 固化 Alpha-0/Alpha-1/1.0 capability matrix 和 Human/External gates。
- 锁定 MiniMax H3、Comfy backend/frontend/templates、本地/API class types、模型文件和证明状态。
- 完成 managed Core 的最终路径 spike 并选择主运行时；Desktop `OPEN_AND_FOCUS` 与受限 comfy-cli 做成可选能力 spike。缺少外部夹具时可以保持 hidden/blocked，不得阻塞 managed Core 主线。
- 已完成 Electron/TypeScript、Tauri/Rust、.NET 的有界控制平面 spike 并接受技术栈 ADR；后续只实施 Electron production app、窄签名 Win32 helper 和 per-user package/release 主线，Tauri 保留为证据门控的重开候选，.NET 不作为并行生产分支。
- 建立 artifact/volume/runtime/GPU/project-run 资源租约，先用假 worker 验证。
- 按依赖顺序冻结 Alpha 所需的 contract conventions、capability、component、recipe、project、install、ownership、hardware/model、route/canvas/frame-audio 和 workflow-build schema；run/segment/checkpoint schema 在进入长视频 Runner 前单独关闭，不阻塞 5 秒垂直切片。
- 建立目标地域、H3/Core/frontend/FFmpeg/CLI/Runner、代码签名、硬件和软件本体品牌资产外部门。

退出条件：G0 范围、G1 运行时、G2 技术栈、G3 Contracts 达到可执行状态；未证实能力保持 hidden/poc_pending。Phase 0 可以做静态探测和小型无模型 PoC，但不得下载全套模型或承诺硬件兼容。

### Phase 1：Alpha-0 内部垂直切片

目标：在一台锁定机器跑通最短真实闭环，而不是先建设通用安装平台。

```text
选择一个受管 NTFS 根
→ 检测一个硬件 candidate profile
→ 构建一个最终路径 managed Core generation
→ 复用或下载一套逐文件锁定的 FL2VA 基础栈
→ 编译并 lint 一个 5 秒 T2VA visual workflow
→ 打开本工具拥有的 ComfyUI/frontend
→ 用户点击 Run
→ MiniMax H3 生成带原生声音的本地短片
→ 断网重复运行
```

实现边界：一个 root、一个 profile、内嵌 catalog、无应用内更新、无 Desktop 执行 adapter、无 Ref/Runner/社区加速；项目与媒体管线没有水印功能。下载中断、磁盘满和 active 指针前崩溃必须安全恢复；外部模型保持只读。

退出条件：`CAP-RT-CORE`、`CAP-HW-ONE`、`CAP-DISK-ONE`、`CAP-MODEL-BASE`、`CAP-DOWNLOAD`、`CAP-T2VA-5S`、`CAP-HANDOFF-CORE`、`CAP-MP4-AUDIO`、`CAP-OFFLINE-RUN` 达到 internal，QA-016 内部闭环通过。技术 MP4 只存证据目录。

### Phase 2：Alpha-1 受控外测

目标：把单机闭环变成一个可恢复、可解释、可签名、许可地域内可交付的小白短视频安装器。

任务：

- 增加 T2VA/I2VA/L2VA/FL2VA 的 5/10/15 秒 canonical workflows。
- 完成 route-specific CanvasPlan/FrameAudioPlan、端点保护和全局 A/V 时间轴。
- 空提示词/中性占位与 4 秒分别做独立 PoC；未通过的组合继续隐藏。
- 完成 known-root/manual-folder 模型复用、分层扫描、选中后全哈希和缓存失效。
- 完成安装 UI、项目创建 UI、错误恢复、可访问性与至少 5 名新手 UAT。
- 完成断网、零未声明外联、C 盘 I/O 预算、Win10/11、外部模型保护、metadata 清理。
- 完成实际发布物的许可、NOTICE/SBOM、目标地域、AI 披露、Authenticode 和硬件外部门。

退出条件：只有 certified capability 进入普通界面。Desktop 自动打开不阻塞 managed Core 主线；如果未达到 `OPEN_AND_FOCUS`，仅作为高级导出能力，不计入一键 DoD。

### Phase 3：Ref2VA 独立能力包

目标：在不重复基础 encoder/VAE 的前提下支持参考图片、视频和音频。

任务：逐文件 provenance；官方数量/时长/混合限制；`<Picture i>/<Video i>/<Audio i>` 机械标签映射；Ref-only 文本策略；Ref + Guide 组合分级；UI/安装/卸载/离线/metadata 技术认证。

退出条件：未安装时普通界面完全隐藏；安装后只有通过的输入组合可选，工具不猜参考素材的创意角色。

### Phase 4：长视频与恢复

目标：先证明两个 H3 窗口的 continuation，再认证 30 秒和 60 秒；不开发新的长视频生成模型。

顺序：

1. GraphBuilder/no-requeue ADR和 mock 两段图。
2. 24/40/32000 全局时间轴。
3. 官方 decoded AddGuide 两段 PoC。
4. paired AV latent codec 独立 Experimental PoC。
5. continuation ADR、原子 checkpoint、用户再次 Run 的恢复和缓存失效。
6. 私有 FFmpeg finalizer、可选用户 BGM/旁白、metadata 和公开导出。
7. 固定用例的 30 秒 Stable 候选批次；通过后再做 60 秒 Beta。

退出条件：30 秒达到书面 pass rate、恢复、A/V、资源、离线和 metadata 门；60 秒显著标 Beta，不宣传一镜到底或无漂移。

### Phase 5：加速、更新、软件本体品牌和公开 1.0

目标：在保守基线稳定后增加经过认证的速度/质量 recipe 和公开发行维护能力。

任务：

- 官方 Turbo、SageAttention、offload/fast-disk、cache 等逐项 A/B；同一卡串行测试。
- 每个 recipe 锁 GPU/driver/Torch/CUDA/node/model，音频或图安全失败即回退 baseline。
- Stable 后台更新、自动执行或远程组件更新真正启用前完成 TUF/等价信任、通道隔离、轮换、吊销和回滚；ADR-015 的用户主动 Setup 校验下载例外不得扩大。
- 完整 SBOM/provenance、恶意 archive/reparse/TOCTOU/chaos、支持包、公开 claim 审计。
- 产品所有者提供正式资产后接入软件 UI/关于页/安装包品牌；保持 MiniMax H3 归属、NOTICE 和 AI 披露独立，且不触碰媒体输出。

退出条件：所有实际启用的功能和发布物均有适用版本、硬件、地域、许可证、隐私、安全、签名、升级/回滚和 claim 证据；任何 Human gate 未关闭均阻止相应外发。


## 21. 主 Agent 审查调度与原子任务执行制度

项目采用一个永久 Root 加最多三个端到端代码 Worker：A 安装/发现、B 工作流、C Electron/Windows。Root 只做 shared schema 最小合并、跨流 smoke、真实 attach-only 验收和集成返工；不再为拆分而新建纯审计/报告/fixture Worker。SCHEMA、lockfile、模型下载、GPU、Desktop 与 VM 仍为单持有资源锁。

### 21.1 主 Agent `/root` 的唯一权限

- 维护本计划、ADR/风险索引、152 项 WBS、`tasks/registry.json`、依赖图、gate 和 release claim。
- 在派工前把 backlog 项物化到活动 registry，写明 owner、依赖、允许路径、资源锁、禁止动作、验收命令和证据位置。
- 最多同时运行三个端到端代码 Worker；A/B/C 的目录必须互不重叠，资源锁仍单持有。
- 对每个返回结果完整读文件、复跑测试、检查越界和未声明外联；只能由 `/root` 标记 `accepted`、`changes_requested` 或 `blocked_external`。
- 只有已接受任务才能解锁依赖项。执行 Agent 的“完成”消息不自动等于验收通过。
- 发现合同冲突时先冻结消费者，修正 ADR/schema/fixture，再恢复并行；不得让多个 Agent 各自发明兼容层。

### 21.2 执行 Agent 的任务包

每个任务包必须包含：

1. 原子任务 ID、目标、明确的非目标和上游证据。
2. 唯一允许修改的文件/目录；其他文件只能读取。
3. 资源锁：`SCHEMA`、`ROOT-LOCKFILE`、`MODEL-DOWNLOAD`、`GPU-H3`、`COMFY-DESKTOP`、`WIN-VM` 中的零个或多个。
4. 确定性验收命令、预期输出和失败关闭规则。
5. 产品边界：**“只实现安装、配置、检测、工作流编译或技术验收；实际视频与声音由 MiniMax H3 在 ComfyUI 中生成。”**
6. 安全边界：是否允许联网、下载、启动 Comfy、使用 GPU、写外部目录或修改系统状态；未明确允许即禁止。

执行 Agent 不得修改 `tasks/registry.json`、本主计划或不在允许列表内的共享 schema/lockfile；不得新增云端推理 API、工具内正式生成按钮、自动提示词扩写、脚本/分镜创作或素材生成。

### 21.3 高并行拆分方式

- 152 个任务按治理与证据、架构 spike、共享 contracts、检测、安装/复用、工作流、production app、窄 Win32 helper、per-user package、UI、QA、安全发布、Ref2VA、长视频、加速、软件本体品牌和公开发行拆分；每项控制在 2–8 个有效工时并有单一验收产物。原 10 小时的一体化 1.0 发布任务已拆成演练、证据冻结、Human 发布决策三项。软件本体品牌任务只处理软件名称、Logo、作者署名、关于页和安装包，不创建媒体处理扩展；新增 production 任务只建设本地控制平面、系统安全边界和发行包，不生成或修改媒体。
- Schema 任务严格串行占用 `SCHEMA`；只有仓库根构建/测试入口与根 lockfile 改动占用 `ROOT-LOCKFILE`，互不重叠的技术栈 spike 使用各自子目录 lockfile 可并行；模型下载和 GPU H3 测试分别单写者；CPU 文档、纯函数、fixture 和静态安全测试可并行。
- 外部条件不足的能力（例如当前 Desktop `OPEN_AND_FOCUS`、签名证书、目标地域法律结论）标记 `blocked_external` 或 Human gate；它们不会被伪造为通过，也不能无关地阻塞 managed Core 内部切片。
- 主 Agent 每轮优先填满三个 worker 槽：一个关键路径实现、一个独立证据/安全任务、一个可并行测试或替代方案 spike；任一返回后立即审查并补发下一个 ready 项。

### 21.4 首批实际调度

当前已经执行/正在执行的 Phase 0 波次记录在 `tasks/registry.json`。首批包括产品边界与 capability matrix、运行时只读探针、官方上游能力快照、控制平面技术栈 spike、资源租约以及 managed Core 最终路径布局。后续按依赖依次进入运行时 ADR、合同冻结、静态检测、事务安装和 5 秒 T2VA 垂直切片；不得跳过 gate 直接下载全套模型或开发长视频。

### 21.5 子 Agent 返回格式

每个执行 Agent 的交付说明必须包含：

1. 任务 ID、结果状态和对应验收标准。
2. 修改文件与是否触及 schema、迁移、锁或外部状态。
3. 实际运行的命令、测试结果和证据路径。
4. 明确声明“未新增生成模型、云推理 API、正式自动排队或内容创作逻辑”。
5. 未关闭的阻断项、风险、可安全解锁的下一任务；失败时保留可复现证据，不伪造通过。

## 22. 后续 Agent 审核清单

每个审核 Agent 必须明确回答：

1. 产品定位是否仍是安装配置器 + 工作流编译器，有无越界成 AI 导演。
2. D 盘默认和 C 盘保护是否覆盖下载缓存、临时文件和输出。
3. 已有模型发现、验证、复用和卸载保护是否完整。
4. FL2VA 与 Ref2VA 是否说明清楚，是否避免下载全部精度版本。
5. ComfyUI Desktop 路径控制是否真实可行。
6. 自定义节点依赖是否最小、固定且可回滚。
7. 加速配方是否分别验证视频与音频的技术完整性、成功率和性能。
8. 30/60 秒是否采用分段而非默认超训练范围单次生成。
9. 工作流是否能在中断后恢复，并严格输出目标时长。
10. 是否有任何隐藏云 API、遥测或 C 盘大文件。
11. 模型、节点和 FFmpeg 许可证是否允许拟定分发方式。
12. 软件品牌是否严格限制在 UI/关于页/安装包，且不存在视频、文件或媒体后处理水印与对应开关。
13. H3 地域/商业条款、ComfyUI Desktop 双许可和 FFmpeg 分发是否已关闭发布阻断项。
14. 长视频是否由固定版本本地执行器完成循环与恢复，而非只交付一份静态 JSON。
15. 工具是否仍只负责安装、配置和工作流交接；实际生成是否明确由 ComfyUI 中的 H3 完成，且不存在工具内“生成视频”功能。

审核结论格式：

```text
结论：通过 / 有条件通过 / 不通过
阻断项：
高风险项：
建议修改：
可进入的下一 Phase：
```

## 23. Definition of Done

### 23.1 Alpha-0 内部垂直切片完成定义

- 工具本体只完成安装、检测、配置、工作流编译和打开受管 ComfyUI；没有内置视频生成引擎、AI 导演、提示词扩写或用户正式任务自动排队功能。
- G0 范围门、managed Core 主路径、控制平面技术栈和本切片需要的最小合同已关闭；Desktop、Ref2VA、长视频和社区加速可以保持 hidden。
- 在一台明确登记的 Windows/NVIDIA 候选机上，用户选择一个本地固定 NTFS 受管根；程序在最终 generation 路径安全安装或复用逐文件校验的一个 FL2VA 基础配方。
- 只承诺非空用户提示词、固定认证画幅和 5 秒 T2VA；canonical visual workflow 及派生审计图通过 class/schema lint，Partner/API/未知节点 fail closed。
- 本工具拥有的 Core + 锁定前端能打开该工作流；用户点击 Run 后才由 MiniMax H3 生成带原生声音的本地短片。
- 下载中断、磁盘满、active 指针前崩溃可安全重试；第二次运行在断网条件下不下载、不安装、不访问第三方推理 API。
- 技术测试 MP4 只进入 evidence 目录；它不是本工具交付的视频内容。

### 23.2 Alpha-1 受控外测完成定义

- 只有通过 capability gate 的 I2VA/L2VA/FL2VA、5/10/15 秒、画幅和输入组合进入普通界面；4 秒、空提示词、严格尾端点分别认证，未通过继续隐藏。
- 已有环境只做安全静态发现；模型白名单候选经选中后完整哈希才复用，外部模型和用户项目在更新/卸载/失败时保持不变。
- D 盘是合格时的可见推荐值而非硬编码；C 盘 I/O 预算、真实峰值空间、回滚、隐私、无未声明外联、Win10/11、可访问性和至少 5 名新手 UAT 全部有证据。
- 对外分发前，适用地域、H3/Core/frontend/PyAV/FFmpeg 许可证、NOTICE/SBOM、AI 披露、签名和硬件范围等 Human/External gates 必须关闭。
- Desktop 未达到 `OPEN_AND_FOCUS` 时只显示高级导出，不计入小白一键交接 DoD。

### 23.3 完整 1.0 公开发布完成定义

工具达到完整 1.0 公开发布版本，需要同时满足：

- 产品界面不存在由本工具自行推理的“生成视频”路径；正常流程明确交接到 ComfyUI，并由 MiniMax H3 负责全部音视频内容生成。
- 全新 Windows/NVIDIA 电脑可完成受控安装。
- D 盘仅在其为可写、空间满足要求的本地固定 NTFS 卷时作为可见推荐值；路径始终可改，只有 C 可用时必须要求用户明示确认，绝不默认或静默回退到 C。
- 大型模型、缓存、临时视频和输出不静默写入 C 盘。
- 能识别并复用已有兼容模型，只下载缺失组件。
- 自动复用仅发生在白名单单文件模型完整校验通过后，未知格式不会被静默使用。
- 基础包明确包含硬件适配 FL2VA、共享编码器和双 VAE。
- 运行环境与模型包在安装界面分开说明，用户清楚每一项用途和新增空间。
- Ref2VA 用途明确且按需安装。
- H3 推理流程完全本地，不使用第三方推理 API；本工具不实现替代推理后端。
- 用户只需提示词或有效素材并选择时长即可生成工作流。
- ComfyUI 打开后工作流无缺失节点、无空模型选择，点击运行即可执行。
- 5–15 秒 T2V/I2V/FL2V 通过认证。
- 30 秒长视频通过稳定性门槛。
- 60 秒明确标记 Beta，能断点恢复并精确输出。
- 长视频由锁定版本的本地执行器运行，支持逐段原子保存、重启恢复和依赖缓存失效。
- FFmpeg、节点、模型和加速配方均有固定版本、哈希和许可证记录。
- 更新失败可回滚，卸载不删除外部模型和用户项目。
- 默认无遥测、无提示词或素材上传。
- 生成阶段经抓包确认无未声明外联，Stable 节点的传递 wheel 依赖全部锁定哈希且不会在运行期联网安装。
- 目标发行地域与 H3 模型许可兼容，商业界面醒目标注 `MiniMax H3`，所需授权、下游限制和 AI 生成披露均已落实。
- ComfyUI Desktop 和 FFmpeg 的实际分发方式通过许可证审查并附齐材料。
- 软件 UI/关于页/安装包品牌资产由产品所有者提供并经 `EXT-BRAND-ASSET` 审批；媒体与输出文件不存在用户水印能力，MiniMax H3 归属、NOTICE 和适用 AI 披露保持独立。

## 24. 主要技术参考

- [MiniMax H3 官方模型卡](https://huggingface.co/MiniMaxAI/MiniMax-H3)
- [MiniMax H3 官方许可证](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE)
- [ComfyUI 官方 MiniMax H3 教程](https://docs.comfy.org/tutorials/video/minimax/minimax-h3)
- [ComfyUI H3 本地节点源码](https://github.com/Comfy-Org/ComfyUI/blob/master/comfy_extras/nodes_minimax_h3.py)
- [MiniMaxH3AddGuide 官方内嵌文档](https://github.com/Comfy-Org/embedded-docs/blob/main/comfyui_embedded_docs/docs/MiniMaxH3AddGuide/en.md)
- [ComfyUI Node Expansion 文档](https://docs.comfy.org/custom-nodes/backend/expansion)
- [ComfyUI Desktop 官方仓库](https://github.com/Comfy-Org/Comfy-Desktop)
- [ComfyUI Desktop Windows 安装文档](https://docs.comfy.org/installation/desktop/windows)
- [comfy-cli 官方仓库](https://github.com/Comfy-Org/comfy-cli)
- [Comfy-Org MiniMax H3 单文件权重](https://huggingface.co/Comfy-Org/MiniMax-H3/tree/main)
- [ComfyUI extra_model_paths 示例](https://github.com/Comfy-Org/ComfyUI/blob/master/extra_model_paths.yaml.example)
- [FFmpeg 法律与许可证说明](https://ffmpeg.org/legal.html)

以下社区项目只用于发现候选长视频/工作流/媒体方案，不构成 Stable、兼容性、许可证或安全证明；任何接入必须经过固定 revision、源码审计、依赖锁定和独立音画 A/B：

- [H3 Motion Context](https://github.com/NikoDemon80/ComfyUI-H3-Motion-Context)
- [H3 Contex Loop](https://github.com/ethanfel/ComfyUI-MiniMaxH3-Contex-Loop)
- [H3 Multishot](https://github.com/jlucasmcrell/ComfyUI-H3-Multishot)
- [H3 LongMedia](https://github.com/vizart-vj/ComfyUI-MiniMax-H3-LongMedia)
- [ComfyUI VideoHelperSuite](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite)

---

本计划的默认原则是：让小白少做决定，但让每一个技术决定都能被查看、复现、回滚和审核。
