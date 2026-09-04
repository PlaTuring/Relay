# P0-WF-001：MiniMax H3 / ComfyUI 上游能力锁定快照

> 任务：`P0-WF-001`  
> 快照时间：2026-08-27T10:24:26Z  
> 机器可读产物：`prototypes/phase0/capability-snapshot.json`  
> 边界：只做上游事实冻结与技术验证；未下载模型、未运行 GPU、未启动 Comfy Desktop、未调用云推理 API、未修改主计划/registry/shared schema。

## 结论

本快照已把下列事实锁定为 `proven`：

- MiniMax 官方 H3-Base 有 FL2VA 与 Ref2VA 两个 checkpoint 家族；FL2VA 规定零图 T2VA、一图首帧或尾帧、两图首尾帧，输出规格为 4–15 秒、24 FPS、32 kHz 立体声。
- 锁定的 Comfy Core 直接提供本地 `MiniMaxH3ImageToVideo`、`MiniMaxH3ReferenceToVideo`、`MiniMaxH3AddGuide`、`EmptyMiniMaxH3LatentAV` 和 `MiniMaxH3SigmaShift`。
- `CreateVideo`/`SaveVideo` 是 Comfy Core 本地节点；源码支持把可选音频封装为 Video，并提供 MP4/MKV/WebM 与 auto/H.264/AV1 选择。核心短片不以单独的用户 `ffmpeg.exe` 为节点输入。
- `GraphBuilder` 是 Comfy Core 的后端图构造工具；其引入提交包含 expansion/loop 测试。
- Comfy frontend 的保存服务把 `app.graphToPrompt()` 的 `workflow` 与 `output` 作为两种不同导出对象使用。
- 同一 Comfy Core revision 还注册名称相近的 MiniMax Partner/API 节点；这些类明确设置 `is_api_node=True`，并使用鉴权、上传和 `/proxy/minimax/...` 路径，必须拒绝。

以下仍不是 `proven` 的产品能力：

- 空提示词的首帧/尾帧/首尾帧稳定路径；
- 本地精确 4 秒；
- 精确目标时长同时严格保留尾端点；
- Ref2VA + 精确端点；
- AddGuide 两段以上连续质量、30/60 秒与崩溃恢复；
- paired AV latent 的跨运行稳定序列化 ABI；
- 当前 Desktop 自动显示外部指定 `workflow.json`；
- 本工具的 visual/API 双编译器和 `graphToPrompt()` 语义等价；
- 目标机器上的实际模型兼容性、GPU 输出、PyAV codec 与 metadata 行为。

这些能力在 JSON 中分别标记为 `poc_pending` 或 `experimental`，不能出现在 Stable 默认能力中。

## 状态语义

| 状态 | 本快照含义 |
|---|---|
| `proven` | 不可变一手官方 revision 直接支持该事实；不自动代表本工具已经通过本机/GPU 验收。 |
| `poc_pending` | 源码路径存在或可达，但仍需被接受、可重复的 PoC 才能面向用户开放。 |
| `experimental` | 依赖不稳定、第三方、未公开或本工具自有兼容契约，不能成为 Stable 默认。 |

## 锁定上游 revisions

以下 GitHub revision 已用 `git ls-remote ... HEAD` 复核；Hugging Face revision 已用模型 metadata API 复核。

| 上游 | 锁定 revision | 权威角色 |
|---|---|---|
| [MiniMax-AI/MiniMax-H3](https://github.com/MiniMax-AI/MiniMax-H3/tree/d21241f0a4b3acbb34c97dae47fa417b7065e438) | `d21241f0a4b3acbb34c97dae47fa417b7065e438` | 模型创建者文档/代码 |
| [MiniMaxAI/MiniMax-H3](https://huggingface.co/MiniMaxAI/MiniMax-H3/tree/42ed227ee7df40d41602854ae760620d6eb651fe) | `42ed227ee7df40d41602854ae760620d6eb651fe` | 模型创建者权重；初始 revision `5d9b308…` |
| [ComfyUI Core](https://github.com/Comfy-Org/ComfyUI/tree/d8e7bbc9d586d95f758d6b0ed23d519088be578a) | `d8e7bbc9d586d95f758d6b0ed23d519088be578a` | Comfy 官方 backend/nodes |
| [ComfyUI frontend](https://github.com/Comfy-Org/ComfyUI_frontend/tree/7ba60a03bb8655b4fae9e6181265217010a98e8a) | `7ba60a03bb8655b4fae9e6181265217010a98e8a` | Comfy 官方 visual workflow/frontend |
| [workflow_templates](https://github.com/Comfy-Org/workflow_templates/tree/71f43419e53dfcb16330748f3b933ac0efcc4778) | `71f43419e53dfcb16330748f3b933ac0efcc4778` | Comfy 官方模板 |
| [Comfy Desktop](https://github.com/Comfy-Org/Comfy-Desktop/tree/29087358520593cc2d08224e89d6bc8c9d455254) | `29087358520593cc2d08224e89d6bc8c9d455254` | Comfy 官方 Desktop |
| [Comfy-Org/MiniMax-H3](https://huggingface.co/Comfy-Org/MiniMax-H3/tree/4cc1d817b6184899b41293954329f576cb5ae86b) | `4cc1d817b6184899b41293954329f576cb5ae86b` | Comfy 官方单文件包装，不是模型原作者；初始 revision `3f57e829…` |

锁定 revision 是能力事实基线，不是以后运行时自动跟随 `main` 的授权。正式 recipe 必须显式固定 backend、frontend、templates、模型文件和哈希。

## 本地 class_type 与 schema 指纹

### 指纹规则

`sha256-c14n-json-sort-keys-v1`：对本快照内的逻辑 `schema_contract` 递归排序对象键、保留数组顺序、无多余空白，以 UTF-8 JSON 计算 SHA-256。

这些是**锁定源码派生指纹**，不是已经读取的 live `/api/object_info`。正式运行前必须把目标实例的 `/api/object_info` 归一化成同一结构并精确比较；缺失、未知、Partner/API 或不匹配一律 fail closed。

| class_type | 输入/输出摘要 | schema fingerprint | 首次引入 |
|---|---|---|---|
| `EmptyMiniMaxH3LatentAV` | `width,height,length → LATENT` | `sha256:f23c9fb5…4860a2` | `57500fc5…` |
| `MiniMaxH3ImageToVideo` | `CLIP,VAE,prompt,width,height,length,[first],[last] → CONDITIONING,LATENT` | `sha256:701870dd…2c9818` | `57500fc5…` |
| `MiniMaxH3AddGuide` | `positive,latent,frame_idx,[VAE],[audio VAE],[image],[audio] → CONDITIONING` | `sha256:bf7bfd20…7d2d62` | `e01fb4c5…` |
| `MiniMaxH3ReferenceToVideo` | `CLIP,video/audio VAE,prompt,canvas,length,reference autogrow slots → CONDITIONING,LATENT` | `sha256:65c8d527…85059c` | `57500fc5…` |
| `MiniMaxH3SigmaShift` | `MODEL,video shift,audio shift → MODEL` | `sha256:def7b38f…e561b8` | `57500fc5…` |
| `CreateVideo` | `IMAGE,fps,[AUDIO],[bit depth],[color space] → VIDEO` | `sha256:cb95bed0…da823d` | `68f0d352…` |
| `SaveVideo` | `VIDEO,prefix,format,[codec],hidden prompt/extra_pnginfo → VIDEO`; output node | `sha256:1ec11f52…f93996` | `68f0d352…` |

完整 inputs、默认值、上下限、可选槽和输出位于机器可读 JSON。源码依据：

- H3 nodes：[`comfy_extras/nodes_minimax_h3.py`](https://github.com/Comfy-Org/ComfyUI/blob/d8e7bbc9d586d95f758d6b0ed23d519088be578a/comfy_extras/nodes_minimax_h3.py)，locked blob `0a08f185fd1155f18f16757c02553ff48cf365eb`。
- Create/SaveVideo：[`comfy_extras/nodes_video.py`](https://github.com/Comfy-Org/ComfyUI/blob/d8e7bbc9d586d95f758d6b0ed23d519088be578a/comfy_extras/nodes_video.py)，locked blob `58f58aaf4daecd08e3b7488c5f313377e6f527e2`。

该列表是 Phase 0 capability allowlist seed，不是完整 production recipe allowlist；正式工作流涉及的 loader、sampler、decode 等所有其他 class_type 仍必须由 recipe owner 显式批准，未知节点不能因“属于 Comfy Core”而自动放行。

## 核心能力判定

| 能力 | 上游事实 | 产品 readiness | 运行时/模型 | 许可门 | 测试门 |
|---|---|---|---|---|---|
| H3 Base FL2VA | `proven`：本地节点与官方零/一/两图规格存在 | `poc_pending` | 锁定 Core/frontend；FL2VA、H3 encoder、video/audio VAE | H3、Comfy、codec | object_info、node lint、双图等价、模型校验、5/10/15 T/I/L/FL GPU、端点/时间轴、SaveVideo |
| H3 Base Ref2VA | `proven`：独立本地节点、独立 checkpoint、引用 tags/槽存在 | `poc_pending` | Ref2VA、H3 encoder、video/audio VAE | H3、Comfy、codec | Ref 数量/时长/tag/空文本/音频、双图、模型校验、SaveVideo |
| AddGuide | `proven`：可在指定帧锚定图像/合法 clip/audio | `poc_pending` | Core；选定 H3 模型与双 VAE | H3、Comfy | 两段 GraphBuilder PoC、无 `/prompt` 重入、A/V guide 时间轴 |
| Create/SaveVideo | `proven`：Core 本地 Video/PyAV 保存路径 | `poc_pending` | 选定 Core/PyAV build | Comfy、codec/专利 | 实际 MP4、24 FPS、32 kHz stereo、metadata 清理与 codec probe |
| GraphBuilder | `proven`：可构造 backend graph；首次提交含 expansion/loop tests | `poc_pending` | Core | Comfy | 两段有限展开；禁止队列重入；Runner checkpoint/resume 另行验证 |
| visual/API 双图 | `proven`：frontend 区分 `workflow` 和 `output` | `poc_pending` | 锁定 frontend + compiler | Comfy | `graphToPrompt()` semantic-equivalence harness |

### Base/FL2VA 的边界

MiniMax 官方锁定规格证明：

- 零图：T2VA；
- 一图：首帧或尾帧；
- 两图：首尾帧；
- 4–15 秒、24 FPS、32 kHz stereo。

Comfy 锁定源码又证明：

- 帧数向上对齐到 `17k+5`；
- node tooltip 把约 124–362 帧称为训练范围；
- 首帧被拉伸到目标 canvas，尾帧使用 center cover-crop；
- 尾帧锚在生成 `frame_count-1`。

因此，官方“4–15 秒”只作为 upstream specification 标 `proven`；“本产品本地 4 秒”和“124→120 等裁切后尾帧仍为最终端点”保留为 `poc_pending`。

### Ref2VA 的边界

机器快照保存了官方限制：图片 ≤9；视频 ≤3、每段 2–15 秒、总长 ≤15 秒；音频 ≤3、每段 2–15 秒、总长 ≤15 秒；混合文件总数 ≤12。

本地源码证明 `<Picture i>`、`<Video k>`、`<Audio j>` 顺序映射存在；视频自带声音时 Audio tag 在 Video tag 之前进入 presentation。它不证明工具可以猜测“哪个素材负责身份/动作/声音”，也不证明只有参考素材且空提示词的质量。

### AddGuide 与长视频边界

`MiniMaxH3AddGuide` 首次引入 revision 为 [`e01fb4c5…`](https://github.com/Comfy-Org/ComfyUI/commit/e01fb4c56b7a88149d469b99cbbfe3223d715054)。源码证明：

- 图像、合法多帧 clip、audio 或 clip+soundtrack 可锚到明确 `frame_idx`；
- 多帧 clip 被裁成 5、22、39…；
- guide audio 会编码并裁到剩余 audio-latent 时长。

它接收的是 image/audio 并重新编码成 Guide，不是上一段 sampler paired AV latent 的公开序列化器。因此：

- decoded-guide 两段方案：`poc_pending`；
- paired-latent 跨运行存取、30/60 秒原子恢复：`experimental`。

### SaveVideo 与 FFmpeg 边界

`SaveVideo`/`CreateVideo` 首次引入 revision 为 [`68f0d352…`](https://github.com/Comfy-Org/ComfyUI/commit/68f0d3529667a2b34b27cc0ac5051bc0e8c45b49)。这证明外部 `ffmpeg.exe` 不是核心短片节点图的输入要求；不代表 codec/许可问题消失：

- 目标 runtime 的 PyAV/FFmpeg library build 和 codec 必须 probe；
- `SaveVideo` 在 metadata 未禁用时会保存 prompt/extra info；公开导出必须通过 metadata 测试；
- 长视频拼接、混音、重定时和水印是否采用应用私有 FFmpeg 是后续 finalizer ADR，不属于本快照的 Stable 能力。

### GraphBuilder 与双图边界

`GraphBuilder` 首次引入 revision 为 [`5cfe38f4…`](https://github.com/Comfy-Org/ComfyUI/commit/5cfe38f41c7091b0fd954877d9d7427a8b438b1a)，当前位于 `comfy_execution/graph_utils.py`。锁定 surface fingerprint 是 `sha256:70c3a1f0…58d9a71`。

它只证明可生成 `{node_id: {class_type, inputs}}` backend graph。H3LongVideoRunner 仍必须证明：用户点击一次 Run 后有限展开；节点执行中不调用 `/prompt`；依赖链、检查点和副作用不会被裁剪；恢复和缓存失效另有可重复证据。

锁定 frontend 的 export 服务直接区分 `p.workflow` 与 `p.output`，surface fingerprint 为 `sha256:17272281…6217b`。[官方 frontend 源码](https://github.com/Comfy-Org/ComfyUI_frontend/blob/7ba60a03bb8655b4fae9e6181265217010a98e8a/src/platform/workflow/core/services/workflowService.ts)

因此 `workflow.json` 与 `prompt.json` 不能互相删字段得到；后续 compiler 需要同一个 typed IR、两个编译器和 semantic-equivalence harness。

## Partner/API 禁止类

锁定 `comfy_api_nodes/nodes_minimax.py` blob 为 `de3895221eb8261ee2650b020727d670079f0f23`。下列类均在源码中设置 `is_api_node=True`，因此无条件禁止；`MinimaxSubjectToVideoNode` 在锁定 revision 定义但未注册，也保留在拒绝回归集：

```text
MinimaxTextToVideoNode
MinimaxImageToVideoNode
MinimaxSubjectToVideoNode
MinimaxHailuoVideoNode
MinimaxHailuo03TextToVideoNode
MinimaxHailuo03FirstLastFrameNode
MinimaxHailuo03ReferenceNode
MinimaxHailuo03ContextIRNode
MinimaxHailuo03RegenerateNode
```

Hailuo 03 T2V/FLF/Reference API 类首次引入 `7dd46274…`；ContextIR/Regenerate API 类首次引入 `12666983…`。拒绝策略不能只匹配此列表：未来任何 `is_api_node`、鉴权字段、Partner/API category、未知 class type 或未知 output node都应 fail closed。[锁定 API 节点源码](https://github.com/Comfy-Org/ComfyUI/blob/d8e7bbc9d586d95f758d6b0ed23d519088be578a/comfy_api_nodes/nodes_minimax.py)

## 官方 workflow templates

| 模板 | 类型 | 首次引入 | locked blob | 判定 |
|---|---|---|---|---|
| `video_minimax_h3_t2v.json` | 本地 reference fixture | `f9f1d101…` | `7605d73b…` | `proven` 存在；production `poc_pending` |
| `video_minimax_h3_i2v.json` | 本地 reference fixture | `f9f1d101…` | `70ac2b28…` | `proven` 存在；空文本/端点裁切未证明 |
| `video_minimax_h3_i2v_continuation.json` | 本地 continuation reference fixture | `8e4d02b5…` | `1455ed41…` | locked 文件不含 `MiniMaxH3AddGuide`，不能证明 AddGuide Runner |
| `video_minimax_h3_r2v.json` | 本地 reference fixture | `f9f1d101…` | `e8929c69…` | `proven` 存在；Ref product gate 未通过 |
| `api_minimax_h3_t2v.json` | Partner/API 禁止 fixture | `04f33569…` | `f4feea28…` | 含 `MinimaxHailuo03TextToVideoNode`，禁止 |
| `api_minimax_h3_flf2v.json` | Partner/API 禁止 fixture | `04f33569…` | `956ff55e…` | 含 `MinimaxHailuo03FirstLastFrameNode`，禁止 |
| `api_minimax_h3_r2v.json` | Partner/API 禁止 fixture | `04f33569…` | `beacd91b…` | 含 `MinimaxHailuo03ReferenceNode`，禁止 |

本地 H3 模板使用 workflow `version: 0.4`；T2V/I2V 模板包含 `definitions.subgraphs` 与动态 widgets。模板内模型下载链接仍使用 `/resolve/main`，且包含 Turbo/LoRA 分支，所以模板只能作为 locked reference fixture，不能直接成为 production recipe 或下载 manifest。

## 模型文件来源

### MiniMax 原始 checkpoint

- 模型创建者：[MiniMaxAI/MiniMax-H3@42ed227e…](https://huggingface.co/MiniMaxAI/MiniMax-H3/tree/42ed227ee7df40d41602854ae760620d6eb651fe)
- 原始 BF16 family：`FL2VA/`、`Ref2VA/`
- 判定：repo/path 事实 `proven`；本工具安装/兼容 `poc_pending`
- 说明：原始 layout 不是官方 Comfy 模板使用的单文件 layout；本任务没有下载或打开任何 shard。

### Comfy 单文件包装

- 包装发布者：[Comfy-Org/MiniMax-H3@4cc1d817…](https://huggingface.co/Comfy-Org/MiniMax-H3/tree/4cc1d817b6184899b41293954329f576cb5ae86b)
- 身份必须记为“Comfy 官方包装、MiniMax 原始模型”，不能写成 MiniMax 官方原始单文件。
- JSON 保存了模板涉及的 FL2VA/Ref2VA BF16 与 pruned INT8、Qwen3-VL encoder、video/audio VAE 和 Turbo LoRA 的 revision、size 与 LFS SHA-256。
- 这些 SHA-256 来自 Hugging Face metadata API；本任务没有取得 `MODEL-DOWNLOAD` lock，也没有做本地全文件哈希。以后只有本地 size/hash/header/role/兼容/许可全部通过，文件才能从 `found` 进入 `selected`。

锁定模板默认引用的核心组合及 metadata：

| 角色 | 文件 | 大小 | LFS SHA-256 |
|---|---|---:|---|
| FL2VA pruned INT8 | `minimax_h3_fl2va_pruned_int8_convrot.safetensors` | 20,970,379,616 | `e889202c…03c47a` |
| Ref2VA pruned INT8 | `minimax_h3_ref2va_pruned_int8_convrot.safetensors` | 20,970,379,616 | `9255f52b…365779` |
| Qwen3-VL NVFP4/AWQ | `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` | 15,687,142,551 | `35a88d51…76f2c6` |
| Audio VAE FP32 | `minimax_h3_audio_vae_fp32.safetensors` | 605,254,808 | `8e505d95…e4db48` |
| Video VAE FP16 | `minimax_h3_video_vae_fp16.safetensors` | 5,207,808,496 | `7c1f1314…e5e522` |

完整 BF16/INT8/LoRA 条目见机器 JSON。Turbo 文件即使被官方模板引用，也仍为 `experimental` recipe component，必须单独做许可证和音画 A/B 认证。

### 第三方 Turbo 引用

锁定模板包含 `lightx2v/Minimax-h3-Turbo` 的 mutable `main` URL。观测 revision `05ef6784…` 的 8-step 文件 LFS SHA-256 与 Comfy-Org 镜像相同，但“内容相同”不等于发布者、许可证或加速 recipe 已获批准；本快照标记为 `experimental`。

## 未证实项与后续门

### 必须优先关闭的 PoC

1. `GATE-RUNTIME-OBJECT-INFO`：在选定 runtime 上读取 live schema，并与本快照 7 个 source-derived fingerprint 对比。
2. `GATE-OFFLINE-NODE-LINT`：同时检查 visual graph、API graph、subgraph definitions 和 expansion graph；API/unknown fail closed。
3. `GATE-DUAL-GRAPH-EQUIVALENCE`：同一 typed IR 双编译，锁定 frontend `graphToPrompt()` 结果语义等价；编译/打开阶段 `/prompt` 调用为零。
4. `GATE-ENDPOINT-FRAMEPLAN`：5/10/15 秒 × T/I/L/FL，比较裁头、裁尾、内部采样、A/V 重定时，保存 24/40/32000 时间轴证据。
5. `GATE-EMPTY-PROMPT` 与 `GATE-LOCAL-4S`：分别独立测试；失败不影响非空 5/10/15 基线，但对应 UI capability 必须隐藏或显式占位。
6. `GATE-ADDGUIDE`/`GATE-GRAPHBUILDER-RUNNER`：只做两段 decoded-guide 展开；paired-latent 和 crash resume 保持 experimental。
7. `GATE-SAVEVIDEO`：实际 runtime codec、24 FPS、32 kHz stereo、metadata 与公开导出检查。

### 人类/外部依赖

- H3 locked license、发行地域、权重下载/再分发、UI 归属、下游限制、AI disclosure；
- Comfy Core/frontend/templates/Desktop/custom node 的发行与组合方式；
- PyAV/FFmpeg library build、codec 与专利路线；
- 第一台认证 GPU、驱动、RAM/磁盘与模型精度选择。

Agent 不能用本快照替代这些签核。

## 验证结果

机器 JSON 已用 Node.js v24.19.0 验证：

```powershell
node prototypes/phase0/capability-snapshot/validate-snapshot.mjs
```

```text
JSON_PARSE_OK task=P0-WF-001 nodes=7 forbidden=9 capabilities=11 templates=7 models=3 gates=17 fingerprints=OK statuses=OK gate_refs=OK
```

验证覆盖：

- JSON 可解析；
- 7 个 local node schema fingerprint 重算一致；
- 2 个 non-node surface fingerprint 重算一致；
- 所有 `status`、`product_readiness`、`runtime_acceptance` 均只使用 `proven`、`poc_pending`、`experimental`。
- 所有 `GATE-*` 引用均能解析到本快照内定义的 gate。

## 现在解锁的下一任务

本产物可以作为以下任务的事实输入，但不替代它们的验收：

- capability catalog/schema owner 定义正式 contract；
- local/API node lint 规范与拒绝 fixtures；
- typed workflow IR 与 dual-graph compiler ADR；
- live `/api/object_info` schema capture PoC；
- T/I/L/FL endpoint/frame-audio plan PoC；
- Desktop workflow-open spike；
- decoded-guide 两段 GraphBuilder spike。

在这些 PoC 返回证据前，不能把 `poc_pending` 或 `experimental` 能力升级为 Stable。
