# ADR-001：产品、进程与生成职责边界

- **状态：** Accepted
- **日期：** 2026-08-27
- **决策所有者：** Root Integration / Product Contract Owner
- **任务：** `P0-GOV-004`
- **正式化：** `D-001`、`D-002`
- **相关约束：** `D-007`、`D-008`、`D-010`、`D-012`、`AGENTS.md`
- **适用范围：** 安装器、控制平面、workflow 编译器、ComfyUI 交接、技术冒烟、未来 Runner 及其测试

## 1. 背景

产品目标是让普通用户完成环境准备和项目配置，然后在 ComfyUI 中查看工作流并亲自点击 **Run**。如果控制平面在打开工作流前后自动提交队列、在自己的界面提供“生成视频”按钮，或者 Runner 通过 `/prompt` 反复重入队列，本工具就会从“安装器与工作流编译器”漂移成第二套推理产品。

相同的漂移还可能通过更隐蔽的方式发生：编译器扩写用户提示词、采用同名云端 Partner 节点、安装冒烟复用用户素材、崩溃后后台静默续跑，或把技术测试 MP4 当成用户作品。因此，边界必须由进程、状态和可自动测试的不变量共同约束，而不能只依靠按钮文案。

## 2. 决策

本工具是 Windows 本地**控制平面**，只负责安装、检测、验证、配置、workflow 编译、启动/打开受管 ComfyUI、确定性编排和技术验证。ComfyUI 是执行平面；MiniMax H3 节点是实际视频和原生音频的唯一生成者。

普通项目的第一笔正式任务只能由用户在 ComfyUI 中点击 **Run** 触发。工具界面不得提供“生成视频”“开始生成”“立即运行”等会直接或间接提交正式队列的动作。编译和打开阶段对 `/prompt` 的调用数必须为零。

未来的 `H3LongVideoRunner` 只有在该次用户 Run 已被 ComfyUI 接受、Runner 节点进入执行后，才可通过 Node Expansion/`GraphBuilder` 展开确定性子图。Runner 不得调用 `/prompt`、不得调用等价内部队列入口，也不得生成或改写提示词。崩溃后只能重新打开同一受管 generation，并由用户再次点击 Run；之后 Runner 才能从最后一个已提交 checkpoint 重建剩余图。

安装器/CI 的固定 H3 冒烟任务是唯一、严格隔离的技术验证例外。它不是用户正式任务，不接受用户 prompt 或素材，不进入项目输出，且只有在具体测试任务明确授权时才可提交固定的本地测试 job。

### 2.1 规范性用词

本文中的“必须”“不得”是发布阻断要求；“可以”表示只有在相关 capability、许可和技术 gate 均关闭后才允许实现。改名、隐藏按钮或换用 CLI 不会改变行为性质。

### 2.2 职责分配

| 主体 | 允许职责 | 禁止职责 | 是否可提交 `/prompt` |
|---|---|---|---|
| 用户 | 输入自己的 prompt/素材/技术设置；在 ComfyUI 中检查图；点击 Run；崩溃后决定是否再次 Run | 无需选择节点、采样器或云服务；不能被后台事件冒充为点击 | 用户在 ComfyUI 的明确 Run 动作可以触发正式提交 |
| 工具 UI / 控制平面 | 硬件与磁盘检测、组件安装、模型发现与验证、recipe 选择、项目保存、workflow 编译、启动和聚焦 ComfyUI、显示诊断 | 生成视频/音频、自动 Run、远程控制 Comfy Run、创作 prompt、调用云推理 | 普通产品路径不得 |
| Workflow 编译器 | 验证输入形状和能力；把用户提供的值绑定到锁定模板；生成可视 workflow 和派生的测试图；执行本地节点 lint | 扩写、翻译、总结、分类或“优化”用户语义；执行派生图；把 API graph 作为自动运行路径 | 不得 |
| ComfyUI 前端 | 显示图；接收真实用户 Run 操作；将该图提交给受管本地 backend | 被工具脚本、坐标自动化、深链或隐藏消息自动触发 Run | 仅真实用户 Run 后可提交正式任务 |
| ComfyUI backend / executor | 接收并执行已提交的本地 allowlisted graph；提供本地执行事件 | 加载未知/API/Partner 节点；运行期下载；代表工具创作内容 | 接收前端正式提交；不得由 Runner 重入 |
| MiniMax H3 本地节点 | 在 Comfy 执行中生成实际视频和原生音频 | 云/Partner 代理、隐藏上传、把工具变成其他推理后端 | 不主动提交；作为已提交图中的节点执行 |
| `H3LongVideoRunner` | 用户 Run 后确定性展开 H3 子图；管理段依赖、时间线、原子 checkpoint、恢复读取与获批的确定性组装 | 实现生成模型；创作 prompt/故事/分镜/音乐；在节点内调用 `/prompt` 或 executor 私有入口；静默恢复 | 永远不得 |
| 技术冒烟 harness | 在明确授权的测试域，用固定 prompt/seed/fixture 向隔离的本地 runtime 提交最小 H3 job；采集资源和媒体证据 | 使用用户项目、用户 prompt、用户素材或用户输出目录；把结果展示为作品；调用云节点 | 仅 `TECHNICAL_SMOKE` 测试域内可以 |
| 确定性后处理器 | 在 H3 产物之后执行已认证的 mux、时长校验或组装 | 生成内容、补写语义、隐藏上传 | 不得 |

### 2.3 普通项目状态机

```text
NO_PROJECT
  -> PROJECT_CONFIGURED
  -> WORKFLOW_COMPILED
  -> COMFY_OPENED
  -> AWAITING_USER_RUN
       -- 用户在 ComfyUI 点击 Run --> FORMAL_JOB_ACCEPTED
       -> COMFY_EXECUTING
            -> H3_GENERATING
            -> [可选且已认证] RUNNER_EXPANDING / FINALIZING
       -> COMPLETED

COMFY_EXECUTING -- 崩溃 --> INTERRUPTED
INTERRUPTED -> COMFY_OPENED -> AWAITING_USER_RERUN
AWAITING_USER_RERUN
       -- 用户再次点击 Run --> FORMAL_JOB_ACCEPTED
       -> Runner 校验指纹并从最后 committed checkpoint 继续
```

以下转换不存在：

```text
WORKFLOW_COMPILED  -X-> FORMAL_JOB_ACCEPTED
COMFY_OPENED       -X-> FORMAL_JOB_ACCEPTED
INTERRUPTED        -X-> FORMAL_JOB_ACCEPTED
Runner             -X-> /prompt 或内部 queue submit
Tool UI button     -X-> Comfy Run
```

`WORKFLOW_COMPILED` 和 `COMFY_OPENED` 可以访问本地、只读或非执行性的能力端点，但不得调用 `/prompt`、等价 queue API、内部 executor 或能让前端代为 Run 的桥接命令。派生 API graph 是构建/测试证据，不是待自动执行的命令。

### 2.4 正式 Run 的定义

一次任务只有同时满足下列条件才是“用户正式 Run”：

1. 用户当前可见的是 ComfyUI 图，而不是工具侧伪装的运行控件；
2. 用户在 ComfyUI 中执行明确的 Run 操作；
3. 提交的是当前可见 workflow 对应的锁定本地 graph；
4. Comfy backend 接收该动作产生的正式队列请求；
5. 事件关联记录只保存 project revision、workflow/recipe hash 和非敏感 correlation ID，不记录完整 prompt。

工具打开窗口、聚焦窗口、导入 workflow、倒计时、安装完成、恢复网络、进程重启或定时器触发都不构成用户 Run。工具不得用 UI 自动化替用户点击 Run。

### 2.5 Runner 与 GraphBuilder 边界

Runner 是未来长视频 capability 的受管 custom node，不是 Alpha-0/Alpha-1 默认组件。在相关 gate 关闭前，它保持 hidden 且不加载进短视频 runtime。

启用后，Runner 必须遵守：

- 只有在 Comfy 接受用户正式 Run 且执行到 Runner 节点后，才创建 `GraphBuilder` 并返回 expansion；
- expansion 中每个节点 ID 全局唯一、确定且可由 segment/revision 推导；
- expansion 只可包含 recipe allowlist 中已锁定 `class_type + schema fingerprint` 的本地节点；
- 每个生成段的实际视频和音频由 MiniMax H3 节点产生；Runner 只编排依赖、checkpoint 和确定性后处理；
- Runner 及其依赖中不得存在 HTTP `/prompt` client、内部 queue/executor submit、Partner/API node 或运行期下载路径；
- 一次用户 Run 后可以在同一次 Comfy execution 内展开多个段；这不是多次工具提交；
- 进程崩溃会终止本次 execution。后台服务、计划任务、窗口重开和工具启动都不得自动重投；
- 用户再次 Run 后，Runner 只能认可原子提交且指纹匹配的 checkpoint。指纹不匹配、generation 缺失或半写入时 fail closed，不猜测继续位置。

Comfy 官方文档证明 Node Expansion 可以让节点返回替代子图并用于 loop，且要求节点 ID 全局唯一和确定；它**不证明**跨进程恢复、H3 上下文连续性或长视频质量。本项目必须分别用 PoC 证明这些能力，未证明前不得把 Runner 或长视频写成可用承诺。参考：[ComfyUI Node Expansion](https://docs.comfy.org/custom-nodes/backend/expansion)。

### 2.6 Prompt 与素材边界

工具可以校验字段是否存在、类型、长度和路由组合，并把用户输入绑定到 workflow；不得对用户语义执行以下操作：

- 扩写、润色、翻译、重写、总结或自动补全 prompt；
- 推断“故事、产品、口播、氛围、音乐视频”等内容类型；
- 自动生成故事、脚本、镜头、动作、对白、音乐、续写或结尾指令；
- 根据素材进行语义分析后替用户决定创意内容；
- 把用户输入发送给本地 H3 之外的模型或任何远程服务。

结构性编码、换行保存和模板字段绑定不得改变文本语义。若某条已证明的 H3 路由技术上不接受空文本，只能使用另行 gate 批准的、最小且可见的版本化技术占位符；它必须和用户文本分开记录、可替换，不能伪装成模型“智能优化”。

### 2.7 本地节点与云/Partner 边界

所有 visual graph、派生 API graph、subgraph definition 和 Runner expansion 都必须按锁定 `class_type + schema fingerprint` allowlist 检查。显示名相似、带 API key/token/remote URL 字段、Partner/API 类别、未知 custom node 或无法证明本地执行的节点必须 fail closed。

普通和技术冒烟路径均不得：

- 调用云/Partner 推理 API；
- 上传 prompt、输入媒体、模型指纹或输出；
- 在执行期下载模型、wheel、节点、frontend 或其他依赖；
- 因本地节点不可用而自动回退到远程服务。

未来若引入任何远程推理、提示词服务或 Partner node，必须先用新的产品范围 ADR 重新定义产品、隐私、计费、地域、许可与用户同意；不能作为 recipe 更新静默加入。

### 2.8 技术冒烟与测试 MP4

技术冒烟不属于普通项目状态机。它使用独立状态域：

```text
SMOKE_AUTHORIZED
  -> ISOLATED_RUNTIME_READY
  -> FIXED_TEST_JOB_SUBMITTED
  -> EVIDENCE_CAPTURED
  -> SMOKE_STOPPED
```

只有具体任务明确要求本地 H3 安装/CI 冒烟时，harness 才可进入 `SMOKE_AUTHORIZED`。最低隔离要求：

- 固定、版本化、可散列的 prompt、seed 和测试素材；禁止读取用户项目值；
- 受管本地 runtime、独立 loopback port、独立 user/input/output/temp 和测试 correlation namespace；
- local-node allowlist、API nodes disabled、未知 nodes disabled、无运行期下载；
- 输出写入测试 evidence 目录，不写用户 project/output/media library；
- evidence manifest 标记 `purpose=technical_smoke`、fixture/hash、recipe/hardware ID、结果和清理状态；
- 普通产品 UI 不提供将用户内容送入此 harness 的入口；生产模块不能把 smoke submitter 当成通用 queue client。

冒烟产生的 MP4 只是可播放性、时长、音轨、资源峰值或安装完整性的技术证据。它不是用户作品、不是产品生成成功案例、不得进入最近项目/素材库、不得自动导出或加品牌水印，也不得用于证明未测试的画质、长视频或硬件范围。是否保留文件由证据策略决定；无论保留与否，普通日志和支持包都不得包含完整 prompt 或私有路径。

## 3. 可自动测试的不变量

下表是不依赖人工阅读文案的最低验收。任何一项失败都阻止对应构建进入其目标阶段。

| ID | 不变量 | 自动测试方法 | 通过标准 | 失败动作 |
|---|---|---|---|---|
| `PB-001` | 工具侧无正式生成动作 | 枚举普通 UI route、command registry、IPC handler、快捷键和 accessibility tree | 不存在可提交正式 queue 或代理 Comfy Run 的工具控件/命令 | 构建失败 |
| `PB-002` | 编译阶段零 `/prompt` | 用 mock Comfy server/HTTP recorder 执行项目保存、编译、lint、派生图构建 | `/prompt`、等价 queue submit 和内部 executor 调用均为 0 | 构建失败 |
| `PB-003` | 打开/交接阶段零 `/prompt` | 对冷启动、热启动、重开、第二实例、窗口聚焦记录 Comfy server 与进程网络事件 | 用户点击 Run 前正式提交为 0 | 交接 capability 不激活 |
| `PB-004` | 用户 Run 是第一笔正式提交 | 在测试 Comfy 前端注入明确 user-event marker，并关联 backend request | 第一笔正式 job 发生在 marker 后，来源为受管 Comfy 前端；工具进程提交数为 0 | 构建失败 |
| `PB-005` | 派生 API graph 不执行 | 对编译/打开用例监控 queue、executor、输出目录和 GPU work marker | 只产生构建 artifact；无 queue、无媒体、无 H3 执行 | 构建失败 |
| `PB-006` | Runner 只在 Run 后展开 | mock Runner/GraphBuilder 记录 `formal_job_accepted`、node execute、expand 时间顺序 | `accepted < runner_execute <= expand`；Run 前 expansion 为 0 | Runner 保持 hidden |
| `PB-007` | Runner 不重入队列 | 静态扫描 Runner 依赖和动态拦截 `/prompt`、queue/executor submit；运行两段 mock | 初始用户提交计数为 1；Runner 额外提交计数为 0 | Runner 构建失败 |
| `PB-008` | 崩溃后需再次 Run | 在段执行/写入/commit 后强杀；重启工具和 Comfy 并监控 queue | 重启至用户再次 Run 前提交数为 0；再次 Run 后只从最后完整 checkpoint继续 | 恢复 capability 不激活 |
| `PB-009` | H3 是唯一生成者 | 检查执行 trace、node allowlist、进程树和产物 provenance | 每个生成段均归因于锁定本地 H3 node；Tool/Runner只有控制或后处理事件 | 构建失败 |
| `PB-010` | Prompt 无创作性变换 | 用 Unicode、换行、空白、禁用词和内容类型哨兵做 property/fixture 测试 | workflow绑定值与用户值语义一致；除批准占位符外无新增文本 | 编译器构建失败 |
| `PB-011` | Partner/API/未知节点 fail closed | 对 visual/API/subgraph/expansion 分别注入同名Partner、认证字段和未知节点 | 所有负例在打开/执行前被拒；不会远程回退 | capability 不激活 |
| `PB-012` | 正式路径零未声明外联 | 对允许的受管进程树执行在线抓包和断网重跑 | 除 loopback 外生成阶段 egress 为 0，断网可完成已安装能力 | 删除离线认证并阻止外测 |
| `PB-013` | Smoke 与用户域隔离 | 将用户 prompt/path/token 哨兵放入项目后执行固定冒烟，扫描请求、manifest、输出和日志 | 冒烟只含固定 fixture；用户哨兵均未出现；使用独立路径/port/namespace | 冒烟失败且不得激活环境 |
| `PB-014` | 测试 MP4 仅为证据 | 执行冒烟后检查项目库、最近输出、导出、品牌流程和 manifest | MP4只出现在 evidence域且标为 technical smoke；普通UI不可作为作品访问 | 构建失败 |
| `PB-015` | 恢复指纹 fail closed | 修改 workflow/model/runtime/Runner/checkpoint hash 后尝试恢复 | 不展开剩余图、不自动重投，保留证据并要求新Run或新revision | Runner恢复拒绝 |

测试记录不得通过保存完整 prompt 来证明顺序。使用 fixture ID、内容 hash、进程身份、非敏感事件名和单调时间戳即可。

## 4. 被否决的备选方案

### A. 工具提供“一键生成”，内部调用 Comfy `/prompt`

**否决。** 即使仍使用本地 H3，这也使工具成为正式推理入口，破坏用户在 Comfy 中检查并 Run 的明确交接，并为自动恢复、云回退和无人值守执行打开隐性通道。

### B. 工具打开 Comfy 后用 UI 自动化点击 Run

**否决。** 坐标自动化、DOM 注入、快捷键模拟或 bridge command 都不是用户同意，且不可稳定区分正确实例、未保存画布和当前 workflow。

### C. Runner 每段调用 `/prompt` 或 Comfy 私有 executor

**否决。** 这会产生嵌套队列、取消/缓存/恢复竞态，也使一次用户点击变成不受约束的后台提交器。Runner 必须使用一次 execution 内的官方 Node Expansion/GraphBuilder；如果做不到，长视频 capability 保持 hidden。

### D. 崩溃后由守护进程自动重投

**否决。** 自动重投无法证明用户仍同意、当前图未变化或 checkpoint ABI 仍匹配。恢复必须要求用户重新打开并再次 Run。

### E. 使用云/Partner 节点作为本地缺失时的降级

**否决。** 这改变隐私、许可、地域、费用和产品形态。缺少本地能力时应 fail closed，并说明缺失项。

### F. 内置 Prompt 助手或自动内容类型

**否决。** 用户已决定由 H3 理解 prompt；工具只绑定技术参数。创意辅助是另一产品，不属于安装/配置/workflow 编译。

### G. 完全不做自动技术冒烟

**未选择为绝对规则。** 固定本地 H3 冒烟对验证安装和首个硬件有价值，因此保留严格隔离的测试例外；若隔离不成立，则只执行无模型 contract test，而不是放宽产品边界。

## 5. 后果

### 正面

- 用户知道什么时候开始消耗 GPU 时间，并能在 Comfy 中先检查工作流；
- 控制平面不需要成为第二套推理 API，攻击面和隐性外联面更小；
- Runner 的循环与一次用户授权对应，queue、取消和恢复语义可测试；
- 固定冒烟可以验证安装，又不会冒充产品输出；
- prompt 创作和云节点通过机器可检查的边界被排除，而不是依赖营销文案。

### 成本与限制

- 普通用户仍需在 ComfyUI 中完成一次明确 Run；崩溃恢复还需再次 Run；
- 工具不能宣传“输入后全自动出片”，只能承诺“配置、生成并打开可运行工作流”；
- 未来 Runner 必须绑定锁定的 Comfy/GraphBuilder 契约和 allowlist，版本升级需要重新验证；
- 测试 harness 与生产控制平面必须分离，增加少量测试身份、路径和事件关联工作；
- 在自动打开能力未证明时，只能安全降级为手动打开 workflow，不能用自动提交掩盖交接失败。

## 6. 证据状态

- **已证实的上游事实：** ComfyUI 官方 Node Expansion 允许节点返回替代子图并可实现 loop；GraphBuilder负责满足全局唯一、确定的节点 ID 要求。
- **已接受的产品决策：** 工具/H3/Comfy职责、无工具侧正式生成按钮、编译/打开阶段零 `/prompt`、用户 Run、技术冒烟隔离、prompt/Partner越界规则。
- **待实现验证：** 普通路径的 `PB-001` 至 `PB-015` 自动化证据。
- **待 PoC：** H3 Runner 两段展开、上下文连续性、原子 checkpoint、强杀恢复、30/60秒质量与资源边界。
- **明确未证明：** GraphBuilder 本身不证明跨进程恢复、长视频稳定性、音视频连续性或任何硬件支持范围。

## 7. 变更与重新评审触发

出现以下任一情况必须重新打开本 ADR，由产品所有者批准新的编号 ADR 或明确修订；普通 recipe、UI 文案或节点清单变更不能绕过：

1. 希望在工具 UI、CLI、自动化接口或系统托盘直接触发正式生成；
2. 希望编译/打开/恢复后自动提交第一笔或后续 `/prompt`；
3. Runner 需要 Node Expansion 之外的 queue/executor 调用，或希望跨崩溃静默恢复；
4. 引入 prompt 扩写、翻译、内容分类、脚本/分镜/音乐或其他创意决策；
5. 引入任何云、Partner、远程推理、隐藏上传或远程 prompt 服务；
6. 把技术冒烟开放给用户项目，或把测试 MP4 作为作品/示例/产品输出；
7. ComfyUI 的 Run、`/prompt`、Node Expansion、GraphBuilder 或 frontend/backend 边界发生破坏性变化；
8. 派生 API graph 从构建证据变为长期权威源、无人值守执行入口或外部自动化 API；
9. 新增非 H3 生成模型、替代推理后端或让后处理器生成新的语义内容。

若变化仅影响锁定版本而不改变职责，相关 capability 退回 `poc_pending` 并重新执行不变量测试；若改变谁触发生成、谁创作内容或数据是否离开本机，则必须进行产品范围、隐私、安全、许可和用户同意的完整重新决策。
