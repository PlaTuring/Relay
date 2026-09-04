# Windows 安装器对工作流运行时审计的交叉审计

> 审计对象：`MINIMAX_H3_TOOL_EXECUTION_PLAN.md` 0.3、`docs/reviews/WORKFLOW_RUNTIME_AUDIT.md`  
> 审计视角：Windows 安装、运行时隔离、恢复、供应链和资源调度  
> 边界：本工具只安装、配置、扫描、编译并交接工作流；MiniMax H3 负责生成。本文不把自动提交正式任务纳入工具职责。

## 结论

`WORKFLOW_RUNTIME_AUDIT.md` 对 H3 本地/Partner 节点隔离、首尾帧时长冲突、Runner 必须 PoC、短片不必依赖外部 `ffmpeg.exe` 等判断总体正确，但它还不能原样并入执行计划。交叉审计发现五个 P0：

1. “共享 Typed IR + 两个独立编译器 + `graphToPrompt` 等价性”把验证手段升级成了第二套产品编译器，MVP 过度设计且扩大前端供应链；应改成单一可视图编译源和锁定官方转换器派生验证。
2. 对任意现有 Comfy 实例读取 `object_info` 不是无代码执行的安全扫描；启动 Python 会导入运行时，`object_info` 还会调用节点 schema 代码。动态认证只能在工具拥有且完整锁定的运行时中进行。
3. `graphToPrompt` 不是对任意 JSON 的纯函数。当前官方实现会执行虚拟节点 `applyToGraph()` 和 widget `serializeValue()`；不得把用户或第三方前端扩展加载进“安全验证器”。
4. “打开目录并让用户拖入 JSON”只能是诊断回退，不能算面向小白的“已交接成功”。没有自动打开契约的 Desktop 版本必须判为不支持该能力，或者明确降低产品承诺。
5. GPU PoC、42–65GB 级模型获取、runtime generation、Runner 检查点尚无跨 Agent/跨进程资源租约；按原任务表并行会重复下载、争抢 GPU、错误估算磁盘峰值，并可能破坏恢复测试。

因此，本报告对工作流审计给出的结论是：**可作为 Phase 0 输入，但应先合并本文 P0 改写和依赖修正，之后才可下发工作流实现任务。**

## 一、逐条挑战：同意、反对、需改写、新增遗漏

| 原审计主张 | 交叉判断 | 优先级 | 应合并的结论 |
|---|---|---:|---|
| 本地 H3 节点必须使用严格白名单，并拒绝 Partner/API/未知节点 | 同意 | P0 | 静态 allowlist 是最终裁决；不要依赖名称相似度，也不要仅依赖一个随 schema 漂移的 API 标志字段。 |
| 对目标实例读取 `/api/object_info`，检查 `is_api_node` | 需改写 | P0 | 动态探测只用于工具自管、哈希锁定的 Core；现有 Desktop/Core/Portable 默认仅静态发现。当前 server 的传统节点信息字段是 `api_node`，Partner schema 的作者字段是 `is_api_node`，不能假设所有 schema 代际的响应字段一致。启用 `--disable-api-nodes` 后再以“期望 class 存在 + 严格 allowlist”认证。路由前缀由 adapter 解析，不硬编码 `/api`。 |
| TypedWorkflowIR 分别编译 `workflow.json` 和 `prompt.json` | 反对原实现 | P0 | 保留小型、领域化的 `ProjectSpec/RoutePlan/FrameAudioPlan`；取消两个通用图编译器。以 recipe 锁定的官方可视模板和语义绑定表为单一图源，API 图只由同一锁定前端的官方转换器派生。 |
| 把可视图交给官方 `graphToPrompt()`，与自编译 API 图语义等价 | 需改写 | P0 | `graphToPrompt` 只能在工具拥有的、固定 digest、无第三方 JS 扩展的前端 harness 中运行；它本身会执行前端节点/widget 逻辑。MVP 不自动提交 API 图，故 API 图可只作 recipe 认证/测试产物，不必成为每项目的第二份权威文件。 |
| Desktop 自动打开能力未证实，应有手动拖入回退 | 前半同意、后半反对 | P0 | 手动导入是故障诊断态，不得通过“用户只点运行”的 DoD。支持矩阵必须区分 `OPEN_AND_FOCUS`、`PERSIST_ONLY`、`EXPORT_ONLY`；只有第一类满足正常交付。 |
| `/userdata`/工作流存储可作为交接候选 | 需改写 | P0 | 官方接口能保存/列出用户数据，但不等于会让正在运行的 Desktop 聚焦该工作流。还需验证目标实例、用户 profile、唯一命名、并发覆盖和前端刷新；不得直接改 Desktop 私有状态文件。 |
| `decoded-guide` 是较稳定保守 profile | 同意方向、需降级措辞 | P1 | 它比私有 paired latent ABI 稳定，但仍锁定 AddGuide schema、H3/VAE、Comfy commit、Torch/Torchaudio、模型 hash、时间轴和 SaveVideo。它不是“脱离上游版本的稳定接口”。 |
| GraphBuilder/Node Expansion 可构建 Runner 循环 | 同意能力、反对恢复推论 | P0 | 官方只证明执行时可展开子图和实现循环，不证明进程退出后自动恢复。崩溃后必须重启同一 recipe generation，由用户再次点击“运行”，Runner 再从已提交 checkpoint 重建剩余图；工具不得静默 `/prompt` 重投。 |
| paired-latent 可作为高保真自研 profile | 同意仅作实验 | P1 | Runner 和 latent codec 都是可执行自定义节点，必须签名、锁 commit/hash、列入 wheelhouse/SBOM/allowlist；1.0 Stable 前必须有 schema migration 和旧 generation 保留策略。 |
| 外部 FFmpeg 对官方 4–15 秒短片不是技术必需 | 同意 | P1 | 必须写成“外部 CLI 非必需”，不能写成“完全没有 FFmpeg 供应链”：PyAV 仍使用 FFmpeg 库。短片若承诺精确时长、统一编码、元数据清除等而 SaveVideo 认证不过，所选交付 profile 仍应强制私有 FFmpeg。 |
| WRA-05、WRA-06、WRA-11、WRA-12 可作为无依赖首批任务 | 反对 | P0 | 只可先做纯数学/静态 fixture。真实 H3、Runner 和 Desktop PoC 分别依赖锁定 runtime/model、资源协调器、Desktop adapter fixture；原任务依赖和 Agent 工时漏掉下载/GPU/人工观察的墙钟时间。 |
| 加速 recipe 必须逐组合认证并回退 20-step 基线 | 同意 | P1 | 每个候选 recipe 还必须取得 GPU 独占租约和模型 artifact 只读租约，记录驱动、GPU LUID、峰值 VRAM/RAM/磁盘、模型/运行时 hash；不得与另一 Agent 同时跑同卡 PoC。 |
| SaveVideo 元数据必须验证 | 同意 | P1 | 将 PyAV/FFmpeg 两条输出路径都纳入二进制字符串和容器 tag 检查；`--disable-metadata` 是受管 Core 的 recipe 参数，外部实例不能只凭用户设置推断。 |

## 二、P0 阻断项

### P0-01：安全探测必须区分“静态发现”和“受管动态认证”

官方 CLI 支持显式 loopback、独立 input/output/temp/base 目录，并支持 `--disable-all-custom-nodes`、`--whitelist-custom-nodes`、`--disable-api-nodes` 和 `--disable-metadata`。[锁定 CLI 源码](https://github.com/Comfy-Org/ComfyUI/blob/d8e7bbc9d586d95f758d6b0ed23d519088be578a/comfy/cli_args.py#L57-L70)、[节点/网络相关参数](https://github.com/Comfy-Org/ComfyUI/blob/d8e7bbc9d586d95f758d6b0ed23d519088be578a/comfy/cli_args.py#L142-L185)

但是，启动一个外部 Python/Comfy 环境本身就会执行其中的 Python 代码。`/object_info` 会遍历已注册节点并调用节点信息/`INPUT_TYPES()`；它不是只读解析磁盘 JSON。[锁定 server 源码](https://github.com/Comfy-Org/ComfyUI/blob/d8e7bbc9d586d95f758d6b0ed23d519088be578a/server.py#L678-L741)

必须改成两层协议：

- **静态发现（默认，适用于 Desktop/Core/Portable）：**只读文件、版本记录、配置和模型路径；不导入 Python、不运行 `main.py`、不加载 custom nodes。结果只能是“候选兼容”，不能成为执行认证。
- **受管动态认证：**只允许工具拥有、artifact hash 已验证、recipe 完整的 immutable generation。启动参数至少包含显式 `127.0.0.1`、保留的随机端口、`--disable-auto-launch`、工具私有 user/input/output/temp、锁定 frontend、`--disable-all-custom-nodes`、`--disable-api-nodes`；短片 profile 不加载任何自定义节点，长片 profile 只 whitelist 工具签名的 Runner。Manager 不启用，进程环境禁止隐式下载。
- **已运行外部实例：**可以读取其状态给用户做兼容提示，但不能因一次 `object_info` 成功就授予“受管/可信”状态；端口、进程 PID、实例 ID、backend/frontend 版本必须与 adapter 目标一致。
- **fail closed：**图中的每个 `class_type` 必须在 recipe allowlist 中；未知节点、Partner 节点、API 节点或 schema 指纹不符即拒绝。API 标志仅作为附加证据，不替代 allowlist。

受管探测进程还要有 owner token、PID/creation-time 记录和 Job Object；终止时只杀自己的进程树，不能按端口或进程名误杀用户的 Desktop。

### P0-02：`graphToPrompt` 不能用于不受信任图的“安全纯转换”

当前官方 `graphToPrompt` 要求已经构造好的 LiteGraph；它会对虚拟节点调用 `applyToGraph()`，并在导出时调用 widget 的 `serializeValue()`。这些都是可执行前端逻辑，不是 JSON 到 JSON 的无副作用转换。[锁定 `executionUtil.ts`](https://github.com/Comfy-Org/ComfyUI_frontend/blob/7ba60a03bb8655b4fae9e6181265217010a98e8a/src/utils/executionUtil.ts#L53-L178)

建议以一个 ADR 替换 WRA-03/WRA-04 的“双独立编译器”设计：

```text
ProjectSpec
  -> RoutePlan + FrameAudioPlan
  -> TemplateBinding（语义角色 -> 锁定模板中的 node/subgraph/widget）
  -> Canonical Visual Workflow
  -> Static Allowlist Lint
  -> [仅受管 harness] 官方 graphToPrompt
  -> Derived API Graph（测试/审计产物，不是第二权威源）
```

约束如下：

1. 每个 workflow template、frontend bundle、node definition 和 binding manifest 都有 digest；任何漂移都拒绝 patch，而不是猜 node ID/widget 位置。
2. harness 不加载用户的 JS、Desktop 扩展或第三方 custom-node frontend；只加载 recipe 明示的官方前端和工具自有签名扩展。
3. 只为 Alpha 的四条固定路由实现领域化 binding，不实现可表达任意 Comfy 子图的通用 Typed IR。
4. 若无法把官方前端安全、可复现地封装进发布物，则项目运行时不生成 `prompt.json`；在 recipe 构建/CI 中完成 visual→API 认证，并在目标处只做 schema/allowlist/能力指纹检查。
5. 若未来确实要自动 API 执行，再单独立项第二阶段 IR；当前“用户在 Comfy 点击运行”的边界不为它买复杂度。

这会减少一套编译器漂移，也避免额外引入未锁定的 Node/Chromium/headless DOM 运行时。

### P0-03：Desktop 手动回退不满足小白 DoD

官方 server 暴露 `/userdata` 的列出和 `/userdata/{file}` 的读写接口，官方前端也从 `workflows` 用户数据目录同步工作流。[官方路由文档](https://docs.comfy.org/development/comfyui-server/comms_routes)、[锁定 workflow store](https://github.com/Comfy-Org/ComfyUI_frontend/blob/7ba60a03bb8655b4fae9e6181265217010a98e8a/src/platform/workflow/management/stores/workflowStore.ts#L376-L437)

这些证据只支持“可以持久化/列出”，不支持“外部程序可让当前 Desktop 实例自动打开并聚焦某工作流”。当前 Comfy Desktop 还支持多个独立实例和自动更新，因此仅启动一个 exe 或向某个用户目录写文件，可能交接到错误实例。[Comfy Desktop 官方仓库](https://github.com/Comfy-Org/Comfy-Desktop/tree/29087358520593cc2d08224e89d6bc8c9d455254)

Desktop adapter 应返回能力枚举：

- `OPEN_AND_FOCUS`：已验证冷启动、热启动、多实例、现有未保存 tab 场景，且最终画布 hash/项目 ID 与刚编译工作流一致；这是正常成功态。
- `PERSIST_ONLY`：可通过受支持接口写入唯一的工具命名工作流，但无法聚焦；不满足“一键交接”，只能显示为受限支持。
- `EXPORT_ONLY`：只导出文件/打开目录；是故障诊断或高级用户模式，不计入 Alpha DoD。
- `UNSUPPORTED`：版本/schema/实例身份未知，完全 fail closed。

写入工作流存储时必须使用 project UUID + revision 的唯一名称，先检查冲突，写后重新读取并核 hash；不得覆盖同名用户文件，不得直接改 Desktop 私有 tab/session/config。Desktop 更新后先重跑 adapter probe，再允许交接。

如果 Phase 0 证明没有稳定 `OPEN_AND_FOCUS` 契约，则产品必须二选一：只支持工具自管 Core + 锁定前端，或把 Alpha 文案/DoD 改为“引导导入”；不能把手动拖放包装成已完成的一键体验。

### P0-04：Runner 的依赖、更新和恢复边界未闭合

GraphBuilder/Node Expansion 官方只承诺节点执行时返回替代子图，可用于循环，并要求跨展开保持唯一、确定的 node ID；它没有承诺进程重启后的恢复。[Node Expansion 官方文档](https://docs.comfy.org/custom-nodes/backend/expansion)

Runner 必须被视为 runtime recipe 的可执行组成，而不是普通工作流 JSON：

- 短片 profile：`--disable-all-custom-nodes --disable-api-nodes`，不需要 Runner。
- 长片 profile：在上述基础上仅 `--whitelist-custom-nodes <signed-runner>`；Runner 源 commit、目录 hash、Python wheels、GraphBuilder API 指纹、AddGuide/H3/VAE/Torch/Torchaudio、模型 hash、checkpoint schema 和 FFmpeg build 全部进入 recipe。
- Runner 不能独立自动更新。升级要创建新 immutable generation；未完成项目继续引用旧 generation，直到 checkpoint 已完成、迁移成功或用户明确放弃。
- `decoded-guide` 和 `paired-latent` 是两个不同兼容 profile。前者仍需完整版本锁；后者在稳定 migration 前只能 Experimental/Beta。
- 每段产物和 checkpoint 使用同卷临时文件、flush/close 后原子替换，并把内容 hash、父段 ID、recipe hash、时间轴写入 manifest。只有 manifest 提交成功才算一段完成。
- 崩溃后不自动 `/prompt`。恢复语义必须写成：“启动同一 generation，用户再次点击运行，Runner 读取最后一个已提交 checkpoint 并重建剩余扩展图”。这既符合当前职责边界，也可明确验收。

更新/GC/卸载必须持有项目租约，禁止删除未完成 run 引用的 runtime、模型、Runner 或 checkpoint。否则“可恢复”会被一次正常清理操作破坏。

### P0-05：GPU PoC 与大模型下载缺少统一资源协调器

原 WRA 任务表把多个真实生成 PoC 标成“无依赖”，且工时只记 Agent 操作时间。必须新增跨 Agent、跨进程的资源服务/协议：

- `artifact:<sha256>` 下载锁：相同模型只允许一个 downloader；其他任务复用 `.partial`/完成 artifact，不另开 42–65GB 下载。
- `volume:<volume-id>` 空间租约：开始前预留下载临时、解压/复制、模型最终、checkpoint/输出和 N-1 generation 峰值；磁盘不足在下载前失败。
- `runtime:<generation-id>` 读/写租约：PoC 只读使用 active generation；更新/回滚/卸载需要排他写租约。
- `gpu:<adapter-luid>` 排他租约：同一物理 GPU 同时只跑一个认证生成；锁记录 recipe、PID、creation time、开始时间和可恢复 owner token，防 PID 复用。
- `project-run:<project-id>` 排他租约：同一长视频 run 不允许两个 Runner 同时提交同一 segment。

建议固定加锁顺序 `artifact（按 digest 排序） -> volume -> runtime -> GPU -> project-run`，并在事务 journal 中记录租约；崩溃后以 PID creation time/Job Object 做陈旧锁回收，不凭一个过期 lockfile 直接解锁。

PoC 报告分开记录：Agent 工时、下载墙钟时间/字节、GPU 墙钟时间、人工观察时间。每次 GPU 结果必须包含 GPU LUID/型号、驱动、OS、runtime/model/frontend/Runner hash、峰值 VRAM/RAM/磁盘和输出 hash/质量结论。

## 三、P1/P2 修正

### P1-01：FFmpeg 应由“媒体能力解析器”决定，而非全局必需/可选

原计划把 FFmpeg 设成“必需、不可取消；缺少只能生成中间文件”，对官方短片 SaveVideo 路径不准确；工作流审计把外部 CLI 改为短片可选是对的，但安装 IA 还需细分：

| 项目选择/交付契约 | 外部私有 FFmpeg/FFprobe |
|---|---|
| 官方短片、SaveVideo 原生容器，且时长/音轨/codec/metadata 已通过认证 | 可不安装 |
| 短片要求精确重定时、统一 codec/container、SaveVideo 无法满足的 metadata 清理 | 必需 |
| 30/60 秒拼接、BGM/旁白混音、补帧/放大后重封装、最终水印 | 必需 |

安装卡片建议写成“视频后处理引擎（完整功能默认选择；仅原生短片时可省略）”，即时展示“当前项目为何需要”。用户后来选择长视频/混音/水印时，必须在工作流编译和 Desktop 交接前补齐组件；不能先打开一个注定缺依赖的图。

即使没有 `ffmpeg.exe`，PyAV 及其 FFmpeg libraries 仍要进入 lockfile、SBOM、许可证/codec 清单。私有 CLI 和 PyAV 路径分别做 metadata、音画时长、编码器和失败恢复测试。

### P1-02：项目、工作流、checkpoint 和输出需要一致性协议

当前两份报告都没有完整定义：用户改项目设置、工作流已打开、Runner 正在生成时，哪个 revision 生效。新增：

- `project_revision`、`workflow_hash`、`recipe_hash`、`run_id`、`segment_parent_hash` 贯穿工作流 extra、run manifest、checkpoint 和输出 sidecar。
- 用户修改任何影响图/时长/素材/recipe 的字段后创建新 revision；已开始 run 保持旧 revision，不原地变更。
- Desktop 中用户手动编辑图后，Runner 应检测 workflow hash 不一致并要求“作为自定义 revision 运行”或拒绝恢复，不能继续写原 run。
- 卸载、更新、模型 GC 根据引用 ledger 判断，未完成 run 默认保护。

### P1-03：把真实生成 PoC 拆成静态测试和资源依赖测试

- WRA-05a：帧数、端点、裁切的纯函数/fixture，可无 GPU先做。
- WRA-05b：四路由真实 5/10/15 秒生成，依赖受管 runtime、FL2VA 模型认证、GPU 租约。
- WRA-06a：空串/占位词在图和文本编码 schema 的静态测试。
- WRA-06b：真实质量/音频行为，依赖同上。
- WRA-12a：GraphBuilder 两段图的结构 spike，可用 mock 节点。
- WRA-12b：真实 AddGuide/Runner 两段生成，依赖时间轴、Runner recipe、模型和 GPU 租约。

这样可以早关逻辑错误，又不会让“无依赖”任务偷偷触发超大下载和 GPU 争用。

### P2-01：headless 前端 harness 本身也要纳入供应链和性能预算

如果项目发布物包含 Node/Chromium/Playwright/Electron harness，应记录完整包管理锁、浏览器二进制 hash、许可证、CVE 和磁盘开销，并在 D 盘/C 盘 I/O 基线中计量。如果只在 CI/recipe 构建使用，应明确不随客户端分发，避免安装器为了一个验证步骤多出数百 MB 和第二套自动更新面。

### P2-02：诊断信息要区分“不可信”和“不兼容”

静态发现的外部实例可能功能兼容但不可认证；版本不支持则是不兼容。UI 不应都显示“扫描失败”。建议状态为 `DISCOVERED_UNTRUSTED`、`COMPATIBLE_ATTACH_ONLY`、`CERTIFIED_MANAGED`、`ADAPTER_UNSUPPORTED`，并告诉小白下一步是使用独立受管环境还是仅导出工作流。

## 四、任务合并与依赖修正

下表不是新增一套平行 backlog，而是对 IA/WRA 任务做合并归属，避免两组 Agent 重复实现同一契约。

| 交叉任务 ID | 合并/替换 | 依赖修正 | 产物与验收 |
|---|---|---|---|
| XW-01 能力/recipe/离线图契约 | 合并 WRA-01、WRA-02、IA-007、IA-009 的节点部分 | IA-001；锁定官方源码 | 一个 capability schema 同时描述 backend/frontend/template/node class/schema/API 禁止标志/模型角色；API/Partner/未知节点 fixtures 全部 fail closed。 |
| XW-02 受管 Probe Harness | 合并 WRA-02 动态部分、IA-012、IA-023；复用 IA-003 generation | XW-01、IA-003、IA-010、IA-011 | 只启动哈希锁定 generation；显式 loopback/随机端口/私有目录/custom+API disabled；恶意外部实例永不被启动认证；只终止自有 Job Object。 |
| XW-03 单一可视编译源与官方投影 | **替换** WRA-03、WRA-04 | XW-01、IA-012 的锁定 frontend、XW-02 | TemplateBinding ADR、四路由 fixtures、受管 `graphToPrompt` harness；无第二通用 API 编译器；第三方 JS fixture 不加载，visual→derived API 语义测试通过。 |
| XW-04 Desktop 工作流交接 | 合并 WRA-11、IA-004、IA-005 | IA-001、XW-01；当前/旧版 Desktop fixture | `OPEN_AND_FOCUS/PERSIST_ONLY/EXPORT_ONLY/UNSUPPORTED` 矩阵；冷/热启动、多实例、未保存 tab、升级漂移测试；只有前者通过小白 DoD。 |
| XW-05 媒体能力解析器 | 合并 WRA-15 的安装面、IA-009 FFmpeg 字段、IA-029 | WRA-10；短片 SaveVideo 认证；长片另依赖 XW-07 | 按项目 feature 解析 PyAV/私有 FFmpeg；缺依赖时在编译前阻断；两条路径 codec/audio/duration/metadata 通过且许可证可追溯。 |
| XW-06 Artifact/GPU/Project 资源协调器 | 新增，复用 IA-015、IA-016、IA-019、IA-021 | 协议/假 worker：IA-001、IA-002；真实下载实现：再依赖 IA-013、IA-015、IA-016、IA-019、IA-021 | digest 下载锁、卷空间租约、runtime/GPU/project-run 租约；双 Agent 同模型只下载一次，同卡 PoC 串行；强杀后锁可安全回收。 |
| XW-07 Runner generation 与恢复 | 合并 WRA-12～WRA-14、IA-003、IA-016、IA-024、IA-025 的 Runner 部分 | XW-01、WRA-05a、WRA-10、XW-06、受管模型/runtime | signed Runner whitelist、decoded/paired profiles、原子 checkpoint、generation 引用保留；强杀后启动同代并由用户再次点击运行可从最后提交段恢复。 |
| XW-08 项目一致性与引用 ledger | 新增，扩展 IA-024、IA-025 | XW-03、XW-07 | project/workflow/recipe/run/segment hash 链；改设置创建 revision；更新/GC/卸载不删除未完成 run 的依赖。 |
| XW-09 GPU 认证套件 | 重排 WRA-05b、WRA-06b、WRA-07、WRA-09、WRA-16、WRA-18 | XW-02、XW-03、XW-06；各任务再依赖对应模型/Runner/媒体能力 | 每项先声明下载字节、磁盘峰值、GPU 时长；报告含完整硬件/recipe/hash；相同硬件与 recipe 可复现，失败自动回退且不污染 active。 |

### 对原 WRA 依赖的具体修改

1. WRA-01 与 IA-007 只保留一个事实源；WRA-02 静态 lint 依赖它，动态 lint 再依赖 XW-02。
2. WRA-03/WRA-04 不继续实现双编译器，改由 XW-03 替换。
3. WRA-05、WRA-06 拆 a/b；只有 a 可以“无依赖”。
4. WRA-07 依赖 XW-03、WRA-05b、WRA-06b、XW-02、XW-06，不能只依赖 IR。
5. WRA-11 并入 XW-04，依赖 IA-004/005 的实例/schema 取证；手动拖放不作为通过条件。
6. WRA-12 拆 mock/真实；真实任务依赖锁定 Runner generation、FL2VA、WRA-10 和 GPU 租约。
7. WRA-13/WRA-14 还依赖 IA-003/016/024/025 和 XW-08；否则只有 tensor 文件格式，没有产品级恢复。
8. WRA-15 通过 XW-05 获取 FFmpeg/PyAV 能力，不自行假设路径或编码器；长片组装再依赖 XW-07。
9. WRA-16、WRA-18 必须依赖 XW-06，工时之外单列模型下载和 GPU 墙钟预算。

## 五、修正后的最先五项

1. **XW-01：统一能力/recipe/离线 allowlist 契约。**先消除 `is_api_node`、class/schema 和 frontend/template 指纹的多套定义。
2. **XW-06a：定义资源租约协议并用假 downloader/GPU worker 做并发故障测试。**它只依赖 IA-001/IA-002；真实下载实现等 IA-013/015/016/019/021 完成后再接入。任何 Agent 下载全套模型或跑 GPU 前必须已有可用锁。
3. **IA-003 + XW-02：受管 generation 与 Probe Harness 最小 PoC。**只对一个最终路径 generation 实现可信启动和 `object_info` 认证；不碰现有 Desktop/custom nodes，完整认证再补 IA-010/011。
4. **XW-03：对 T2VA 一条固定路由验证“模板绑定 + 官方投影”。**先证明不需要双编译器，再扩到 I2VA/L2VA/FL2VA。
5. **XW-04：Desktop 当前版 `OPEN_AND_FOCUS` 实证。**如果失败，立即决定 Alpha 采用受管 Core 还是降低 DoD，避免安装器和 UI 围绕不存在的能力继续开发。

WRA-05a、WRA-06a、WRA-12a 可在上述任务旁并行做纯逻辑/fixture；任何真实模型下载和 GPU 运行必须先经过 XW-06。

## 六、合并门

只有满足以下条件，`WORKFLOW_RUNTIME_AUDIT.md` 才可视为从安装器视角“已关闭”：

- 原“双编译器”已改为单一 canonical visual source，或另有经批准 ADR 证明第二编译器的必要性和供应链成本。
- `object_info/graphToPrompt` 的执行边界写明，且未知外部 Python/JS 从未被安全探测器加载。
- Desktop 正常成功态有 `OPEN_AND_FOCUS` 的版本化证据；手动导入不计入小白 DoD。
- Runner 是 recipe 锁定、签名和可回滚的 custom node；恢复明确要求用户再次点击运行，不会由工具静默提交。
- FFmpeg 安装卡片由项目媒体能力解析，不再全局误报“没有它只能生成中间文件”。
- 所有真实 H3/GPU PoC 取得 artifact、volume、runtime、GPU、project-run 租约，并在报告中分开 Agent 工时与墙钟资源。
