# MiniMax H3 工作流与运行时独立审计

> 审计对象：`MINIMAX_H3_TOOL_EXECUTION_PLAN.md` 0.3，SHA-256 `E0CF3EE2AC7CF389B84E44D21302D28C98864AED176D574E59320AED35CC249A`  
> 审计日期：2026-08-27  
> 审计边界：本工具只安装、检测、配置、编译工作流并打开 ComfyUI；用户点击“运行”后，MiniMax H3 才在 ComfyUI 内生成音视频。`H3LongVideoRunner` 只能调度 H3、管理状态和后处理，不能实现生成模型或创作内容。

## 结论

结论为：**有条件通过，但当前只适合进入 Phase 0/PoC，不能直接把 30/60 秒、纯空提示词、精确端点和“一键打开指定工作流”交给制作 Agent 当成已成立能力。**

官方资料已证实，本地 ComfyUI 可以用 FL2VA 完成 T2VA、首帧/尾帧/首尾帧生成，用独立 Ref2VA 权重完成多模态参考生成，并由 H3 同时产生 24 FPS 视频和 32 kHz 立体声。官方单段输出规格为 4–15 秒；ComfyUI 本地节点把帧数对齐到 `17k+5`。因此，**5–15 秒本地 Alpha 的基础路径可行**。[MiniMax H3 官方模型卡](https://huggingface.co/MiniMaxAI/MiniMax-H3)、[ComfyUI 官方 H3 教程](https://docs.comfy.org/tutorials/video/minimax/minimax-h3)、[ComfyUI H3 原生节点源码](https://github.com/Comfy-Org/ComfyUI/blob/d8e7bbc9d586d95f758d6b0ed23d519088be578a/comfy_extras/nodes_minimax_h3.py)

30/60 秒在工程上也有可行路径：ComfyUI 官方提供 Node Expansion/`GraphBuilder`，明确说明它可用于循环；H3 原生 `MiniMaxH3AddGuide` 也给出了用 22 帧视频与音频引导续接的官方示例。但官方节点只证明了“把解码后的图像/音频重新编码成 Guide”这一续接路径，**没有提供稳定的跨段原始 AV latent 存取、跨进程恢复或长视频质量承诺**。社区源码证明直接成对 latent、裁头、保存/加载和恢复可以被实现，但它们依赖 H3 内部布局、版本自检并明确承认长链质量会衰减，不能转写成官方能力或产品稳定性结论。[ComfyUI Node Expansion](https://docs.comfy.org/custom-nodes/backend/expansion)、[H3 AddGuide 官方说明](https://docs.comfy.org/tutorials/video/minimax/minimax-h3#anchoring-guides-at-any-frame-15439)、[H3 Motion Context 源码仓库](https://github.com/NikoDemon80/ComfyUI-H3-Motion-Context/tree/e5f6f627392d3b867748fbe62c94ea79a91e04f6)、[Contex Loop 恢复协议](https://github.com/ethanfel/ComfyUI-MiniMaxH3-Contex-Loop/blob/3d9407fccc830173f251d24828bd5043f37f40bb/docs/RUNS_AND_RECOVERY.md)

建议发布门结论：

- MVP Alpha：关闭 P0-01、P0-02、P0-03、P0-05、P0-06，并完成纯首帧 PoC 后可制作。
- Ref2VA：完成引用标签映射、空提示词策略、数量/时长预检和端点组合 PoC 后可制作。
- 30/60 秒：P0-04 的 Runner ADR、两段原型、成对 latent/Guide 方案选择、原子恢复和全局音频时间轴全部通过后才可制作；60 秒仍只能标记 Beta。

## P0 问题

### P0-01：离线承诺缺少“本地节点白名单 + API 节点拒绝”门

ComfyUI 同时包含本地 H3 节点和名字非常相似的付费 Partner/API 节点。本地节点类名是 `MiniMaxH3ImageToVideo`、`MiniMaxH3ReferenceToVideo`、`MiniMaxH3AddGuide`；API 节点则包括 `MinimaxHailuo03TextToVideoNode`、`MinimaxHailuo03FirstLastFrameNode`、`MinimaxHailuo03ReferenceNode`，源码把它们标成 `is_api_node=True`，并上传素材、调用 `/proxy/minimax/...`。[本地 H3 节点](https://github.com/Comfy-Org/ComfyUI/blob/d8e7bbc9d586d95f758d6b0ed23d519088be578a/comfy_extras/nodes_minimax_h3.py)、[MiniMax API 节点](https://github.com/Comfy-Org/ComfyUI/blob/d8e7bbc9d586d95f758d6b0ed23d519088be578a/comfy_api_nodes/nodes_minimax.py)

仅按显示名、模板名或“MiniMax H3”字符串选节点，会破坏“生成阶段无第三方 API”的核心承诺。关闭条件：

1. 编译器只允许锁定的本地 class type；禁止按 display name 解析。
2. 针对目标 Comfy 实例读取 `/api/object_info`，校验 class type、输入 schema 和 `is_api_node`。
3. `workflow.json` 与 `prompt.json` 均运行 fail-closed 静态检查：任何 API/Partner 节点、认证字段、未知 output node 或未批准自定义节点都阻止交接。
4. 生成阶段断网与抓包测试必须覆盖短视频、Ref2VA、Runner 和 FFmpeg 后处理。

### P0-02：`workflow.json` 与 `prompt.json` 不是同一种图，不能靠删布局字段互转

ComfyUI 前端的 `graphToPrompt()` 同时返回 `workflow`（可视化保存图）和 `output`（API 执行图）；官方导出逻辑按两种属性分别保存。当前官方 H3 T2V/I2V 模板还使用 `version: 0.4`、`definitions.subgraphs`、动态 widgets 和子图实例，不能假设是扁平节点数组。[前端导出源码](https://github.com/Comfy-Org/ComfyUI_frontend/blob/7ba60a03bb8655b4fae9e6181265217010a98e8a/src/platform/workflow/core/services/workflowService.ts#L127-L145)、[工作流 schema](https://github.com/Comfy-Org/ComfyUI_frontend/blob/7ba60a03bb8655b4fae9e6181265217010a98e8a/src/platform/workflow/validation/schemas/workflowSchema.ts#L292-L320)、[官方 H3 T2V 模板](https://github.com/Comfy-Org/workflow_templates/blob/71f43419e53dfcb16330748f3b933ac0efcc4778/templates/video_minimax_h3_t2v.json)

关闭条件：定义一个共享、带类型的内部 IR，分别编译可视图与 API 图；用当前前端 schema 校验可视图、用实时 `/api/object_info` 校验执行图，再把生成的可视图交给官方 `graphToPrompt()`，要求其 `output` 与自编译 `prompt.json` 语义等价。`prompt.json` 只用于审计、验证和恢复契约；本工具不得以它自动提交用户的正式生成任务。

### P0-03：计划同时承诺“精确目标时长”和“首/尾帧为最终端点”，现有尾部裁切会破坏尾帧

以 5 秒为例，ComfyUI 需要生成 124 帧，再交付 120 帧。源码把 `last_frame` 锚定在生成帧 `frame_count-1`，即第 123 帧；若按计划从尾部裁掉 4 帧，用户的尾帧锚点也被裁掉。10 秒的 243→240、15 秒的 362→360 同样存在这一问题。[端点锚定源码](https://github.com/Comfy-Org/ComfyUI/blob/d8e7bbc9d586d95f758d6b0ed23d519088be578a/comfy_extras/nodes_minimax_h3.py#L124-L146)

关闭条件：帧计划必须按路由决定，而不能统一“裁尾”。至少要比较并实测以下策略：

- 无端点或仅首帧：允许裁尾，保留帧 0。
- 仅尾帧：从头部裁除或整体重定时，保留最后一帧，同时同步处理音频。
- 首尾帧：保留首尾两帧，只在内部丢帧/重采样，或向用户显示对齐后的实际时长；不得直接裁掉任一端点。
- 所有路径：视频帧、32 kHz 音频样本、40 Hz 音频 latent 和容器时间戳使用同一全局有理数时间轴。

在该 PoC 通过前，计划中的“必须成为视频第一/最后一帧”和“精确裁到目标时长”不能同时作为验收承诺。

### P0-04：`H3LongVideoRunner` 可调度循环，但“原始 AV latent 续接 + 原子恢复”尚无稳定上游契约

官方 `MiniMaxH3AddGuide` 接收 `IMAGE`/`AUDIO` 与 VAE，重新编码为 Guide；它没有接收“上一段采样后的成对 AV latent”的公开输入。H3 latent 在核心源码中是含视频和音频两个 tensor 的 `NestedTensor`，而官方没有给出跨运行序列化格式。社区 Motion Context 直接说明 stock Save/Load Latent 不能处理这种成对 latent，并提供了自己的保存/加载节点；这证明方案可研究，不证明 ABI 稳定。[H3 latent 构造](https://github.com/Comfy-Org/ComfyUI/blob/d8e7bbc9d586d95f758d6b0ed23d519088be578a/comfy_extras/nodes_minimax_h3.py#L74-L80)、[Motion Context Save/Load 说明](https://github.com/NikoDemon80/ComfyUI-H3-Motion-Context/tree/e5f6f627392d3b867748fbe62c94ea79a91e04f6#carrying-the-previous-clip-across)

Phase 0 必须明确二选一或分级支持：

1. `decoded-guide`：只用官方 AddGuide，把上一段尾部解码成 5/22/39… 帧及音频再编码；上游语义更稳定，但有重复编解码、颜色/清晰度和音频累积衰减。
2. `paired-latent`：自研最小上下文节点，直接切片成对 latent；接缝潜力更好，但必须锁 Comfy commit、H3 布局指纹、序列化 schema、分辨率、dtype、模型/VAE hash，并在不兼容时拒绝运行。

Runner 应通过官方 Node Expansion/`GraphBuilder` 构建依赖链，不能在节点执行函数里重入 `/prompt` 队列或直接调用不稳定的内部执行器。每段检查点节点必须成为下一段的显式依赖，避免 Comfy 的输出裁剪跳过副作用。恢复 PoC 需证明：进程在第 N 段任意写入点退出后，半文件不被承认；重启后只从最近完整父片段继续；修改上游指纹会使后续缓存失效。

### P0-05：当前官方 Comfy Desktop 没有被证实支持“从外部命令行打开指定 workflow.json”

当前 Desktop 源码的 `second-instance` 回调忽略 argv，只把已有窗口拉到前台；官方 README 也未公开稳定的工作流文件关联或 CLI 打开参数。[Comfy Desktop 当前源码](https://github.com/Comfy-Org/Comfy-Desktop/blob/29087358520593cc2d08224e89d6bc8c9d455254/src/main/index.ts#L1295-L1308)、[Comfy Desktop README](https://github.com/Comfy-Org/Comfy-Desktop/tree/29087358520593cc2d08224e89d6bc8c9d455254)

因此，“打开 ComfyUI”已可行，“让正在运行的 Desktop 自动显示指定工作流”仍未证实。Phase 0 需对新版 Desktop、旧版 Desktop、Portable 分别做适配器 PoC。安全回退必须是：启动正确实例、将工作流保存到明确项目路径并打开文件所在位置，提示用户拖入/从 Workflows 打开；不能静默改 Desktop 管理文件。若要做到真正一键加载，应采用经过版本锁定的本地前端扩展/受支持工作流存储接口，并保留手动回退。

### P0-06：自动追加“继续上一段/最后自然收束”仍属于提示词语义修改，与职责边界矛盾

计划 10.3 的固定技术指令会改变动作和结尾语义；它不是单纯的帧数或节点配置。H3 只能根据送入的当前提示词和上下文生成，不能替工具决定用户想怎样延续或收束。关闭条件：默认逐段传入用户原文，不自动追加创作性文本；只按用户明确写出的时间码/分隔符机械切分。若保留“续接提示”字段，必须是用户可见、默认关闭、逐字可编辑且写入清单的显式输入，不能由工具推断。长视频的一致性主要依赖上下文 Guide/latent，不能宣传一句模糊提示词会自动成为完整一分钟故事。

## P1 问题

### P1-01：纯首帧/尾帧空提示词是源码可达路径，不是官方质量承诺

本地节点的 `prompt` 是必需字符串，但没有显式非空校验；文本编码器在有图片 token 时可以构造 conditioning。因此“技术上可能运行”有源码依据。可是官方教程和嵌入式节点文档仍把 prompt 列为必需输入，没有承诺空文本的生成质量、声音内容或跨版本兼容性。[H3 节点源码](https://github.com/Comfy-Org/ComfyUI/blob/d8e7bbc9d586d95f758d6b0ed23d519088be578a/comfy_extras/nodes_minimax_h3.py#L103-L146)、[H3 文本编码器](https://github.com/Comfy-Org/ComfyUI/blob/d8e7bbc9d586d95f758d6b0ed23d519088be578a/comfy/text_encoders/minimax.py)

必须在锁定版本上分别验证“首帧+空串”“尾帧+空串”“首尾帧+空串”。失败时使用版本化、用户可见的最小中性占位文本；不得暗中扩写。空提示词也不能承诺产生有意义的对白、音乐或声效。

### P1-02：参考素材为空提示词的路由未定义，Ref2VA 标签绑定必须机械可见

项目有效输入规则允许“只有参考素材”，路由表却只列“提示词 + 参考素材”。官方 Ref2VA 规格描述的是“text with references”，并要求按连接顺序使用 `<Picture i>`、`<Video k>`、`<Audio j>`，明确分配每项引用的作用。视频自带音轨时，核心源码还会先登记对应 Audio tag，再登记 Video tag。[官方 Ref2VA 规格](https://huggingface.co/MiniMaxAI/MiniMax-H3#model-variants-and-input-specifications)、[官方引用提示规则](https://docs.comfy.org/tutorials/video/minimax/minimax-h3#minimax-h3-reference-to-video-r2v)、[Ref2VA 节点源码](https://github.com/Comfy-Org/ComfyUI/blob/d8e7bbc9d586d95f758d6b0ed23d519088be578a/comfy_extras/nodes_minimax_h3.py#L263-L328)

应选择其一：Ref2VA 要求非空用户提示词；或把“参考素材单独生成”标记实验并完成 PoC。编译器可以生成确定性的素材编号清单并展示 tag 映射，但不能猜测“这张图负责身份、那段视频负责动作”等语义角色。预检应采用 MiniMax 官方限制：图片≤9，视频≤3 且每段 2–15 秒、视频总长≤15 秒，音频≤3 且每段 2–15 秒、音频总长≤15 秒，混合文件总数≤12；不能因当前 Comfy 源码接受更短视频而放宽官方边界。

### P1-03：Comfy 0.30.0 只能作为基础 H3 下限，不能作为所有功能的统一下限

官方教程说明基础 H3 需要 ComfyUI 0.30.0+；但 AddGuide、prompt embedding、近期 VAE/采样/音频修复分别在后续提交落地，当前官方模板已经标注 core 0.33.0。计划必须按能力锁 commit/version，而不是写一个全局“0.30.0 以上”。此外，MiniMax 模型卡给出 4–15 秒，而当前节点 tooltip 又写“trained range is ~124–362”，约为 5.17–15.08 秒；4 秒本地路径应单独 PoC，不能用 schema 允许就替代生成验证。[官方 H3 教程](https://docs.comfy.org/tutorials/video/minimax/minimax-h3#getting-started)、[当前长度 schema](https://github.com/Comfy-Org/ComfyUI/blob/d8e7bbc9d586d95f758d6b0ed23d519088be578a/comfy_extras/nodes_minimax_h3.py#L82-L119)

### P1-04：外部 FFmpeg CLI 不是官方短视频工作流的技术必需项

官方 H3 模板用核心 `CreateVideo` + `SaveVideo` 输出带音频视频。当前 `SaveVideo` 通过 Comfy 的 Video 类型和 PyAV 保存 MP4/MKV/WebM，不要求用户系统里存在 `ffmpeg.exe`；PyAV 自身使用 FFmpeg 库不等于必须安装外部 CLI。[CreateVideo/SaveVideo 源码](https://github.com/Comfy-Org/ComfyUI/blob/d8e7bbc9d586d95f758d6b0ed23d519088be578a/comfy_extras/nodes_video.py#L124-L237)、[SaveVideo 官方文档](https://docs.comfy.org/built-in-nodes/SaveVideo)

外部 FFmpeg/FFprobe 可以被本产品规定为长视频拼接、精确重定时、BGM/旁白、元数据清理、水印和统一交付格式的必需组件，但安装卡片应写成“本工具完整后处理需要”，不能声称“没有它 H3/Comfy 只能生成中间文件”。Alpha 若仅输出官方短片，应允许核心 SaveVideo 路径独立通过。

### P1-05：第一帧与最后一帧的缩放策略不同，自动画幅必须先在编译器中解析

核心源码会把首帧直接拉伸到目标 canvas，而把尾帧按比例 center-cover crop。若编译器没有先根据首帧计算合法的 32 倍数 canvas，人物和产品可能被拉伸；若首尾帧比例不同，尾帧会被裁切；仅尾帧时默认 16:9 也可能裁切用户素材。创建页应预览最终 canvas 和裁切框，并在比例冲突时明确告警，不能只显示“自动”。[画布与缩放源码](https://github.com/Comfy-Org/ComfyUI/blob/d8e7bbc9d586d95f758d6b0ed23d519088be578a/comfy_extras/nodes_minimax_h3.py#L24-L63)

### P1-06：长视频不能用单一整数重叠量同时代表视频帧和音频裁切

H3 视频是 24 FPS，音频 latent 是 40 Hz，最终 PCM 是 32 kHz。视觉 Guide 的合法多帧长度是 5、22、39…，而 22 个视频帧对应的音频 latent 不是整数秒。核心通过 `round(duration*40)` 创建音频 latent，会出现约毫秒级 overhang；逐段独立取整会累积接缝偏移。计划中的 `N=max(1,ceil((T-O)/(W-O)))` 对固定视频窗口是正确的，但 manifest 还要分别记录 `O_video_frames`、`O_audio_latent_steps`、`trim_audio_samples` 和全局 PTS。最终音频应从全局目标样本数 `round(T/24*32000)` 推导，不能把每段秒数各自四舍五入后相加。[H3 时间轴源码](https://github.com/Comfy-Org/ComfyUI/blob/d8e7bbc9d586d95f758d6b0ed23d519088be578a/comfy_extras/nodes_minimax_h3.py#L28-L44)

若窗口因 OOM 动态改变，还应使用 `F_effective=W1+Σ(Wi-Oi)`，并使计划变更失效所有下游检查点，不能继续套常量窗口公式。

### P1-07：加速配方必须以保守基线为根，不能用社区热度自动选择

官方教程证实的基线是 20 steps；FL2VA Turbo 为 8 steps、Ref2VA Turbo 为 4 steps，并明确提示音频和运动质量略降。MiniMax 还说明初始开源版本没有发布原生 sparse-attention 实现。Spectrum、EasyCache、第三方 Sage/attention、缓存节点和组合效果均不能按 stars 或作者速度数字直接变成自动配置。[官方 Turbo 说明](https://docs.comfy.org/tutorials/video/minimax/minimax-h3#minimax-h3-text-to-video-t2v)、[MiniMax sparse attention 说明](https://huggingface.co/MiniMaxAI/MiniMax-H3#h3-base)

每个 recipe 必须锁：GPU/计算能力、驱动、Torch/CUDA、Comfy commit、节点 commit/hash、模型/VAE/LoRA hash、精度、steps、attention、offload、VAE decode、上下文 profile。认证至少对照 20-step 无缓存基线测试成功率、峰值 VRAM、耗时、视频帧、音轨、静音/爆音和接缝；任何未知组合回退基线。

### P1-08：官方 SaveVideo 默认可写入 workflow/prompt 元数据，隐私清理要成为可测试节点

计划要求公开 MP4 清除提示词和本地路径，这是正确的，但当前 SaveVideo 在未禁用 metadata 时会保存 `prompt`/`extra_pnginfo`。短视频若绕过最终 FFmpeg，也必须显式禁用或清理元数据；长视频最终编码需使用白名单元数据而非仅复制输入容器。验收应在二进制和容器 tags 两层检查，不只看文件名。[SaveVideo 元数据源码](https://github.com/Comfy-Org/ComfyUI/blob/d8e7bbc9d586d95f758d6b0ed23d519088be578a/comfy_extras/nodes_video.py#L149-L190)

## P2 问题

1. UI 和清单统一用官方任务名 `T2VA/I2VA/L2VA/FL2VA/Ref2VA`；`Ref2V` 只作为用户易读简称，不能被误认为另一个模型。
2. “最终清晰度：自动”必须区分“H3 Base 本地原生 768 短边”和“本地传统放大”。官方 `H3-Regenerate-2K`、`H3-Context-IR` 未开源，只能走官方 API；离线版本不得把普通 upscale 称为 H3 2K regeneration。[官方开源边界](https://huggingface.co/MiniMaxAI/MiniMax-H3#h3-regenerate-2k)
3. “固定 seed 可复现”应定义为配方、输入、seed 和依赖可追溯，不默认承诺跨 GPU、驱动、Torch 或节点版本逐 bit 相同。
4. `context_profile_id` 需要不可变 schema 版本和兼容范围；仅保存一个字符串不足以恢复旧运行。
5. 官方模板是移动目标。recipe 必须保存模板 commit、编译器版本和语义 hash，不能运行时抓 `main`。
6. 30 秒“Stable”至少应覆盖多种画幅、提示长度、音频类型、重启点和三种硬件档位；“10 次成功”不能全是同一 seed/同一素材。

## 已证实能力

| 能力 | 证据与边界 |
|---|---|
| 本地 ComfyUI 原生 H3 | 官方教程支持 ComfyUI 0.30.0+；当前 core 有本地 H3 节点。 |
| FL2VA 路由 | 官方模型卡明确：0 图=T2VA，1 图=首帧或尾帧，2 图=首尾帧。 |
| Ref2VA 独立权重 | 官方模型卡和 Comfy 教程明确 Ref2VA 与 FL2VA 是不同 checkpoint。 |
| H3 原生音频 | 24 FPS 视频 + 32 kHz stereo；视频/audio latent 成对存在。 |
| 单段时长与帧网格 | 官方 4–15 秒；Comfy 本地节点向上对齐 `17k+5`。 |
| 本地画布 | 32 像素倍数，默认 768 短边，面积上限 `768×1344`。 |
| 原生 Guide 续接 | AddGuide 可在任意帧锚定图像/视频片段和音频；官方示例使用 22 帧与音频续接。 |
| Comfy 内循环机制 | 官方 Node Expansion/GraphBuilder 明确可用于 loops。 |
| 核心短片封装 | CreateVideo + SaveVideo 可在 Comfy 中保存带音频视频。 |
| 可视图/API 图分离 | 前端 `graphToPrompt()` 同时产生 `workflow` 与 `output`。 |
| 最终水印顺序 | 计划已正确放在最终拼接、可选放大/补帧之后；应继续保持。 |

## 未证实能力

| 能力 | 当前状态 |
|---|---|
| 纯首帧/尾帧空提示词的稳定质量 | 源码可达，官方未承诺；必须锁版本实测。 |
| 只有 Ref2VA 素材、没有文字 | 计划路由缺失，官方建议显式 tag/角色；必须决策或 PoC。 |
| Ref2VA + 精确首/尾端点 | AddGuide 可接在 conditioning 后，但官方未给该组合的稳定性结论。 |
| 精确 4.00 秒本地输出 | 模型卡允许 4 秒，当前 core tooltip 的训练范围从约 124 帧起；需实测。 |
| 原始成对 AV latent 的稳定跨段 ABI | 社区实现存在，官方没有存储/兼容契约。 |
| 单次点击后的跨崩溃自动恢复 | GraphBuilder 可循环，但原子检查点、恢复图重建尚未验证。 |
| 30/60 秒无明显画质/音质衰减 | 社区源码明确承认长链衰减；不存在官方质量保证。 |
| 外部程序自动让 Desktop 显示指定 JSON | 当前 Desktop 源码未提供稳定 argv/file association 契约。 |
| 任意加速组合的音画等价性 | 官方只给基线/Turbo边界；其他组合必须逐 recipe 认证。 |

## 计划中的错误或过度承诺

| 计划表述 | 审计结论 | 建议替换 |
|---|---|---|
| “FFmpeg 必需、不可取消；缺少只能生成中间文件” | 对官方 4–15 秒 CreateVideo/SaveVideo 路径不正确。 | “完整长视频/混音/水印后处理需要应用私有 FFmpeg；核心短片可由 Comfy SaveVideo 直接保存。” |
| “ComfyUI Desktop 打开已经配置好的工作流” | 启动 Desktop 可行，自动载入指定文件尚未证实。 | “尝试通过已认证适配器打开；失败时启动正确实例并提供明确的手动导入回退。” |
| “首/尾帧必须成为最终端点 + 统一精确裁切” | 尾裁会删除尾帧锚点。 | 写入路由相关 frame-plan，并让首/尾端点保护成为验收项。 |
| “携带上一段原始 AV latent” | 不是官方原生公开契约。 | 标注为自研、版本锁定的实验 profile；官方 AddGuide 为保守 profile。 |
| “H3 官方可靠输出 4–15 秒” | 官方是规格范围，不等于每个本地对齐长度都已认证。 | “官方规格 4–15 秒；本产品仅承诺已实测帧计划。” |
| “纯首帧空提示词必须通过” | 应是产品 PoC/DoD，不应描述为已证实上游能力。 | 保留验收，但发布前允许明确中性占位回退。 |
| 自动追加“继续/自然收束” | 会修改用户内容语义。 | 默认不追加；仅允许用户可见、默认关闭的字面字段。 |
| “固定 seed 可复现” | 未定义跨版本/跨硬件范围。 | “相同锁定环境可追溯并达到规定容差；不承诺跨环境 bit-exact。” |

## 架构优化

建议把“工作流编译”拆成下列确定性契约：

```text
ProjectSpec（用户原文、素材槽、时长）
  → CapabilityMatrix（锁定 Comfy/object_info/节点/模型能力）
  → RoutePlan（FL2VA 或 Ref2VA；不做内容分类）
  → FrameAudioPlan（端点保护、17k+5、24/40/32000 时间轴）
  → TypedWorkflowIR
      ├─ VisualGraphCompiler → workflow.json
      └─ ApiGraphCompiler    → prompt.json（只用于校验/审计）
  → OfflineSafetyLint
  → DesktopOpenAdapter（失败可手动导入）
  → 用户在 ComfyUI 点击运行
  → H3 执行单段或 Runner 展开的 H3 依赖链
  → SegmentCommit/Resume
  → FinalAssembler（长片才要求外部 FFmpeg）
  → 可选放大/补帧 → 品牌水印 → AI 披露 → 最终保存
```

关键约束：

- `TypedWorkflowIR` 不保存 widget 数组位置；visual compiler 才根据锁定前端 schema 生成数组和 named widgets。
- 每次编译保存 visual graph 与 API graph 的共同 `semantic_graph_hash`，防止二者漂移。
- `CapabilityMatrix` 按节点 class type 记录 `local/api`、schema 指纹和首次引入版本；功能开关依据能力而非宽泛版本号。
- `FrameAudioPlan` 保存 requested/generated/delivered 三套帧数、端点保护策略、视频 PTS、audio latent steps 和 PCM sample count。
- `Runner` 的状态机建议为 `COMPILED → RUNNING_i → SEGMENT_COMMITTED_i → ASSEMBLING → FINALIZED`；只有原子 commit 完成的段才可成为父段。
- paired-latent checkpoint 至少保存两个 tensor、dtype/shape、分辨率、fps、audio rate、父段 ID、模型/VAE/recipe/context hash；禁止“最新文件”隐式父引用。
- FFmpeg 交接使用参数数组和应用私有绝对路径。仅当所有片段 codec/timebase 完全一致时允许 stream-copy concat，否则受控重编码。水印始终位于最终组装和可选放大之后。
- 任何质量/加速决策来自 `recipe.lock.json`；H3 只负责根据已经确定的输入生成，不能自行选择硬件精度、节点、frame plan、引用槽、混音或水印。

不能交给 H3 自行完成的技术决策包括：FL2VA/Ref2VA 文件路由、素材角色绑定、引用 tag 编号、模型精度、加速配方、分辨率和裁切框、合法帧数、端点保护、分段窗口、上下文长度、缓存失效、恢复点、BGM/旁白混音、最终编码、水印和离线/许可证策略。H3 只决定单个生成窗口内的音视频内容。

## 建议 PoC

### PoC-1：短视频双图编译与离线校验

从同一 IR 生成 T2VA/I2VA/L2VA/FL2VA 的 `workflow.json` 和 `prompt.json`；覆盖官方子图、动态 widget、模型真实名称。让锁定前端执行 `graphToPrompt()`，比较 API 图语义；扫描确保没有 `is_api_node`。用户最终仍只在可视化工作流中点击运行。

验收：四条路由都可加载、无缺失节点/模型、断网可运行；生成前编译器不提交 `/prompt`；API 图与前端转换结果语义等价。

### PoC-2：端点与精确时长

对 5/10/15 秒分别测试无端点、首帧、尾帧、首尾帧；记录生成帧、交付帧、首尾相似度、音视频时长和 PTS。比较裁头、裁尾、内部丢帧、AV 整体重定时四种方案。

验收：选定策略在目标时长容差内，不删除声明的端点，不产生音频漂移；策略写入 frame-plan，而不是散落在 FFmpeg 参数中。

### PoC-3：空提示词与 Ref2VA 组合矩阵

测试首帧/尾帧/首尾帧空串、最小中性占位、只有 Ref 素材、Ref + prompt、Ref + Guide 端点；验证官方 Ref 数量/时长限制和 tag 映射。

验收：每条正式支持路径有明确输入规则、实际模型文本、运行结果和失败回退；未通过路径从普通 UI 隐藏或标实验。

### PoC-4：两段 Runner 与恢复

先用官方 decoded-guide 实现两段 GraphBuilder 展开，再独立试验 paired-latent。模拟采样完成前、checkpoint 写一半、segment commit 后、assembly 中四个退出点。

验收：单次用户点击后由 Comfy/H3 执行两段；Runner 不重入队列、不生成提示词；半文件永不被承认；重启后从正确父段恢复；修改模型/上下文/上游 prompt 后下游失效。

### PoC-5：全局音频时间轴和 FFmpeg 交接

用 24 FPS、40 Hz latent、32 kHz PCM 的有理数时间轴拼接至少三段，分别测试 H3 原声、用户 BGM、旁白、无后期短片。检查接缝、样本数、声道、响度和 metadata。

验收：最终帧数与 PCM 样本数由一个全局计划推导；短片无需外部 CLI 仍能交付；长片/混音用锁定 FFmpeg；公开文件不含 prompt、workflow 或本地绝对路径。

### PoC-6：Desktop 打开适配器

分别验证当前 Desktop、被支持的旧 Desktop、Portable：冷启动、已运行、非默认目录、多实例、用户 workflow 目录只读/可写、文件名含中文和空格。

验收：每个适配器有可重复的自动打开证据或明确标记不支持；任何失败都能安全退回“启动正确实例 + 打开文件位置 + 手动导入”，不覆盖 Desktop 配置。

## 可并行细粒度任务

> 工时是单个 Agent 的工程/审计工时估计，不含模型下载和 GPU 生成等待时间。

| ID | 任务 | 依赖 | 产物 | 验收 | 预计 Agent 工时 |
|---|---|---|---|---|---:|
| WRA-01 | 固定上游源码与能力矩阵 | 无 | `capability-matrix.json`、源码 commit 清单 | 基础 H3、AddGuide、SaveVideo、schema、API node 均有 class type/版本/指纹 | 5h |
| WRA-02 | 离线节点白名单与图 lint 规范 | WRA-01 | lint ADR、拒绝样例 | 本地 H3 通过；任一 Partner/API/未知节点 fail closed | 6h |
| WRA-03 | 共享 TypedWorkflowIR 与双编译器 ADR | WRA-01 | IR/schema ADR、示例图 | 可表达子图、动态 widgets、素材槽；不依赖固定 widget 位置 | 8h |
| WRA-04 | `graphToPrompt` 等价性测试架 | WRA-03 | round-trip harness 设计与 fixture | visual→官方转换结果与 `prompt.json` 语义等价 | 6h |
| WRA-05 | 端点保护与帧计划 PoC | 无 | 5/10/15 秒实验报告、FrameAudioPlan 草案 | 四种端点路由均明确保留规则和精确时长策略 | 8h |
| WRA-06 | 空提示词能力 PoC | 无 | 首/尾/首尾空串与占位测试报告 | 每条路径有锁定版本结果、回退和实际送模文本 | 5h |
| WRA-07 | FL2VA 短视频图 fixture | WRA-03,WRA-05,WRA-06 | T2VA/I2VA/L2VA/FL2VA 双格式 fixture | live object_info 校验、无 API node、断网运行 | 10h |
| WRA-08 | Ref2VA 槽位与 tag 编译规范 | WRA-01 | tag map、限制校验器规格、fixtures | 官方数量/时长限制准确，视频音轨 tag 顺序可见可复现 | 7h |
| WRA-09 | Ref2VA + Guide 兼容 PoC | WRA-08 | 组合矩阵报告 | 明确支持/实验/拒绝三类，不把引用图当首帧 | 6h |
| WRA-10 | 24/40/32000 全局时间轴 | WRA-05 | 时间轴库接口/测试向量设计 | 多段取整不累积漂移，目标帧和样本数唯一确定 | 8h |
| WRA-11 | Desktop 打开适配器 PoC | 无 | 新/旧/Portable 支持矩阵、回退 UX | 冷/热启动和多实例均有证据，不写未批准配置 | 8h |
| WRA-12 | Runner 架构 spike（GraphBuilder） | 无 | decoded-guide/paired-latent ADR、两段图 | 不重入 `/prompt`，每段真实调用本地 H3 节点 | 10h |
| WRA-13 | 成对 AV latent 序列化契约 | WRA-12 | checkpoint schema、兼容指纹、自检 | 视频/音频 tensor 原子保存加载；stock/不兼容情况明确拒绝 | 10h |
| WRA-14 | Runner 恢复状态机 | WRA-12,WRA-13 | state machine、failure-injection 测试 | 四类中断可恢复，半写入不完成，上游变更使下游失效 | 12h |
| WRA-15 | FFmpeg 最终组装与元数据规范 | WRA-10,WRA-14 | assembly manifest、命令参数契约 | 精确时长/音轨/metadata 通过，绝对私有路径且无 shell 拼接 | 9h |
| WRA-16 | 加速 recipe 认证矩阵 | WRA-07 | baseline/Turbo/候选组合报告 | 每组合锁全依赖；音画失败自动回退 20-step 基线 | 10h |
| WRA-17 | 水印/AI 披露后处理接口 | WRA-15 | 两层独立扩展契约 | 位于最终组装和放大后，默认无品牌资产，互不代替 | 4h |
| WRA-18 | 30/60 秒技术认证 | WRA-14,WRA-15,WRA-16 | 多硬件运行报告、Stable/Beta 决策 | 30 秒达矩阵门槛；60 秒恢复和精确输出且显著标 Beta | 16h |

## 首批 5 任务

以下五项可立即并行，且在结果出来前不应实现正式产品代码：

1. **WRA-01**：冻结官方上游和能力矩阵，给后续所有 Agent 一个共同事实基线。
2. **WRA-05**：验证 124→120 等裁切下的首尾端点保护，关闭当前最直接的工作流逻辑矛盾。
3. **WRA-06**：验证纯首帧/尾帧空提示词与中性占位回退。
4. **WRA-11**：实测 Desktop 新/旧/Portable 的工作流打开方式与手动回退。
5. **WRA-12**：只做两段 Runner 架构 spike，比较官方 decoded-guide 与自研 paired-latent，不进入 30/60 秒产品实现。

## 审计来源快照

本审计的技术结论只使用模型/产品官方资料、官方源码以及被审计社区实现自身的直接源码说明；未使用二手教程或社交媒体结论。

- MiniMax H3 官方仓库：[`d21241f`](https://github.com/MiniMax-AI/MiniMax-H3/tree/d21241f0a4b3acbb34c97dae47fa417b7065e438)
- ComfyUI core：[`d8e7bbc`](https://github.com/Comfy-Org/ComfyUI/tree/d8e7bbc9d586d95f758d6b0ed23d519088be578a)
- ComfyUI frontend：[`7ba60a0`](https://github.com/Comfy-Org/ComfyUI_frontend/tree/7ba60a03bb8655b4fae9e6181265217010a98e8a)
- 官方 workflow templates：[`71f4341`](https://github.com/Comfy-Org/workflow_templates/tree/71f43419e53dfcb16330748f3b933ac0efcc4778)
- Comfy Desktop：[`2908735`](https://github.com/Comfy-Org/Comfy-Desktop/tree/29087358520593cc2d08224e89d6bc8c9d455254)
- H3 Motion Context：[`e5f6f62`](https://github.com/NikoDemon80/ComfyUI-H3-Motion-Context/tree/e5f6f627392d3b867748fbe62c94ea79a91e04f6)
- H3 Contex Loop：[`3d9407f`](https://github.com/ethanfel/ComfyUI-MiniMaxH3-Contex-Loop/tree/3d9407fccc830173f251d24828bd5043f37f40bb)
