# MiniMax H3 工具产品与交付深度审计

> 审计对象：`MINIMAX_H3_TOOL_EXECUTION_PLAN.md` 0.3  
> 审计角色：独立审计 Agent C  
> 审计日期：2026-08-27  
> 范围：产品边界、小白流程、安装与项目创建信息架构、版本切分、验收、隐私安全、许可证、发布门、多 Agent 交付可行性  
> 说明：本报告是产品与工程审计意见，不构成法律意见。

## 结论

结论：**有条件通过，可作为 Phase 0 和只读原型的执行依据；在 P0 决策门关闭前，不适合让多个 Agent 同时进入产品代码实现。**

0.3 已经把最重要的范围边界说清楚：本工具只做安装、检测、复用、配置、工作流编译、打开 ComfyUI 和确定性后处理；不实现视频生成模型，不充当 AI 导演，不扩写故事，不调用第三方云推理 API。正式用户路径必须在 ComfyUI 中由用户点击“运行”，再由 MiniMax H3 生成视频和原生声音。`H3LongVideoRunner` 只能在这次点击之后调度既有 H3 节点，不能成为第二套生成后端。安装/开发期间的 H3 自动运行应限定为最小技术冒烟测试，测试 MP4 不是产品内容交付物。

计划也正确区分了官方本地 H3-Base 与未本地开放的 H3-Context-IR、H3-Regenerate-2K。MiniMax 官方当前说明仍是单窗口 4–15 秒、24 FPS、32 kHz 立体声；FL2VA 支持零/一/两张端点图，Ref2VA 支持图像、视频和音频参考。30/60 秒是本工具在 ComfyUI 内进行的分段调度与组装能力，不应宣传为 H3 官方原生单次长视频能力。[MiniMax H3 官方模型卡](https://huggingface.co/MiniMaxAI/MiniMax-H3)

计划适合由 GPT-5.6 Sol 多 Agent 实施，但有四个必要条件：

1. 先由一个集成负责人锁定运行时拓扑、技术栈和五类共享 schema，再分派代码。
2. 共享工作区采用严格文件所有权；任何两个并行任务不得编辑同一文件或 lockfile。
3. GPU、Comfy Desktop 实例、Windows VM、模型下载与哈希任务必须串行排队，不能与代码并行度等同。
4. 法务签核、代码签名证书、目标地域决定和真实硬件认证不能由 Agent 自我证明，必须有外部负责人提供决定或证据。

若按本报告的决策门和 WBS 推进，建议总规模按 **约 360–520 Agent 工时**规划，另加模型下载、H3 渲染、Windows VM 重置、法务与商业授权等待时间。这些等待时间不是 Agent 工时，也不能靠增加 Agent 数量压缩。

## P0：阻断产品代码并行展开或公开发布

| ID | 问题 | 影响 | 必须关闭的结果 |
|---|---|---|---|
| P0-01 | Alpha 与 1.0 功能仍在安装 IA 中混用：Alpha 明确不含 Ref2VA、30/60 秒、放大补帧，但安装流程仍让用户勾选这些组件；“长视频组件”和 30/60 示例又写成默认安装 | Agent 会把 1.0 范围提前塞进 Alpha，安装页也会对小白展示不可用功能 | 建立版本化 capability catalog；Alpha 只显示可交付功能，未来功能隐藏或明确禁用，不参与空间计算和下载 |
| P0-02 | 运行时拓扑未二选一：官方当前 Comfy Desktop 已支持多套隔离环境、快照与回滚，而计划同时保留“利用 Desktop”与“自建完整环境管理器”两条重路线 | 两组 Agent 会实现重复的环境、快照、升级和回滚系统，最后难以合并 | Phase 0 选择主路径：A. 当前官方 Comfy Desktop 的独立 install 编排；或 B. 自有 managed Portable/Core。另一条只做兼容适配，不并行建设完整产品能力 |
| P0-03 | H3 地域、再分发、下游约束、安全防护和 AI 公开披露尚只有“待法务确认”，没有目标地域与交付机制 | 无法决定谁能下载权重、安装器展示什么条款、公开输出是否默认加 AI 披露 | 形成目标发行地域、被排除地域处理、用户条款、AUP 传递、违规报告、安全防护、AI 披露默认策略的书面签核。官方许可当前排除欧盟、英国、韩国和美国，并对商业 UI、下游条款和公众披露提出要求 |
| P0-04 | Comfy Desktop 双许可已识别，但 ComfyUI Core（GPL）、本工具自有 `H3LongVideoRunner` 作为进程内 custom node 的许可、第三方节点与闭源桌面工具的组合边界尚未决策 | 可能在代码完成后才发现自有节点或一体分发不适合预期商业模式 | 许可证矩阵必须覆盖 Desktop、Core、frontend、Manager、每个 custom node、本工具自有 node、FFmpeg、模型和 LoRA；明确哪些组件独立下载、哪些捆绑、哪些源代码必须提供 |
| P0-05 | FFmpeg 只定义了“私有或复用”，尚未选定二进制、构建参数、调用方式、输出编码器和目标市场专利路线 | MP4/H.264/AAC 是交付链核心；错误构建会改变 LGPL/GPL 义务或缺少编码器 | 决定 FFmpeg 来源与哈希、进程调用或库链接方式、H.264/AAC 等输出规格、`--enable-gpl/--enable-nonfree` 策略、对应源码/构建材料和专利审查 |
| P0-06 | 技术栈、Comfy 打开/导入接口、当前 Desktop/Portable 配置入口和共享 contracts 尚未锁定 | UI、安装器、扫描器和工作流编译器无法在稳定接口上并行 | 完成可运行 spike 后签署 runtime ADR、desktop-stack ADR、launch/import ADR，并冻结 component/recipe/project/install/run 五类 schema v1 |
| P0-07 | 首个“已认证硬件档位”没有明确 GPU、驱动、RAM、磁盘、模型精度和基线工作流 | “自动选择适合本机模型”无法实现或验收，未知机器可能被错误配置 | 选择一个窄基线，例如一个实际可获得的 NVIDIA GPU 档位；给出完整配方、峰值资源、5 秒 T2V/I2V/音频通过记录。其他硬件先显示有限/实验/不支持 |
| P0-08 | 法务签名、商业授权、代码签名证书、目标硬件和大模型并非 Agent 可自行取得 | “全程由多 Agent 完成”若理解为无人工/外部输入，会在发布门处永久阻塞 | 在项目看板中建立 External Owner 队列，Agent 负责准备证据包；人类负责人负责签核、证书、账号、硬件与授权，结果回填 ADR |

官方依据：

- H3 当前许可把适用地域定义为全球但排除欧盟、英国、韩国和美国；再分发需传递许可，商业产品/服务超过许可所述收入阈值需授权，商业 UI 需显著显示 `MiniMax H3`，下游用户需受至少同等严格条款约束。[MiniMax H3 Community License](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE)
- 当前官方 Comfy Desktop README 明确支持多套独立安装、隔离运行时、快照和回滚，并采用 AGPL-3.0-or-later / 商业许可双许可。[Comfy Desktop 官方 README](https://github.com/Comfy-Org/Comfy-Desktop/blob/main/README.md)
- FFmpeg 官方说明其默认是 LGPL 2.1+，启用 GPL 部件后整个 FFmpeg 构建进入 GPL 2+；官方合规清单还要求匹配源码、构建信息和 About/EULA 提示，并单独提醒编解码器专利风险。[FFmpeg Legal](https://ffmpeg.org/legal.html)

## P1：不阻止 Phase 0，但应在 Alpha 代码冻结前关闭

| ID | 问题 | 建议 |
|---|---|---|
| P1-01 | 小白安装流程仍要求理解三个 Comfy 选项、多个根路径、模型逐项复用和多个可选包 | 普通模式只显示一个推荐方案：“复用已验证模型 + 创建受管 H3 环境”；现有实例接入、分路径和深度扫描放入高级设置 |
| P1-02 | 必需组件仍用“可勾选”语义，Alpha 未发布组件也可能出现 | 必需项显示锁定状态而不是复选框；组件卡由 release channel、hardware profile、license eligibility 动态过滤 |
| P1-03 | “最终清晰度”混合了 H3 生成分辨率和可选本地超分 | Alpha 只显示“生成分辨率：自动”；安装本地放大包后才出现独立“导出分辨率”，并注明不是 H3-Regenerate-2K |
| P1-04 | 仅首帧空提示词有明确技术占位规则；仅尾帧、仅 Ref 素材空提示词没有同等验收 | 为 T2VA、I2VA、L2VA、FL2VA、Ref2VA 建立输入真值表；不受支持的空提示词组合在创建页阻止，而不是运行后失败 |
| P1-05 | “固定技术续写指令”会修改实际送入 H3 的文本，容易被理解为提示词扩写 | 定义为版本化 runtime envelope；始终显示原始提示词与追加 diff，可关闭，并禁止加入人物、故事、风格等新语义 |
| P1-06 | 安装时“小型 H3 冒烟测试”和实验室 30/60 秒认证没有区分成本 | 安装时只运行最小合法窗口且提前显示预计时间/磁盘/功耗；30/60 次数测试只在认证实验室执行，不作为用户安装步骤 |
| P1-07 | Stable/Beta 的运行次数有数量但没有成功率、输入覆盖和失败定义 | 定义 Stable 为例如认证矩阵每格 10/10 技术完成；Beta 明确允许的失败类型。固定验收集合，不用随机社区提示词代替基准 |
| P1-08 | 精确时长、A/V 同步、C 盘保护、黑帧/冻结、接缝检查缺少数值阈值 | 至少定义最终时长误差 ≤1 帧、A/V 末端差 ≤1 帧、PTS 单调、无重复 overlap、工具管理的大文件不离开用户根目录；黑帧/静音检测默认告警而非一律判失败 |
| P1-09 | 项目素材是复制到 `assets/` 还是引用原路径未定义 | 默认复制或内容寻址导入项目，保证工作流可迁移；高级模式可引用原文件，并显示移动/删除风险和隐私差异 |
| P1-10 | 只规定最终 MP4 清理元数据，未覆盖预览 PNG、片段 MP4、音频 sidecar、checkpoint 和支持包 | 区分“项目私有工件”和“公开导出工件”；公开导出清除 prompt、workflow、本地路径和用户名，支持包强制脱敏并让用户预览清单 |
| P1-11 | 更新检查“可关闭”，但没有默认值、域名、签名根轮换和撤销机制 | 更新与生成进程隔离；公开域名 allowlist；签名 manifest 具备 key id、过期、撤销和回滚；生成阶段零未声明外联 |
| P1-12 | Windows 删除与解压规则没有明确处理 junction/reparse point/hardlink | 所有删除、安装和解压在解析后的受管根内执行；拒绝越界 reparse point，测试 ZIP Slip、符号链接、junction、压缩炸弹和 TOCTOU |
| P1-13 | 当前 Comfy H3 单文件量化包可能来自 Comfy-Org，而不是 MiniMax 官方原始 BF16 checkpoint | UI 和 manifest 分开记录“模型原作者/许可证”“包装或量化发布者”“文件来源/修订”；不得统一宣传为 MiniMax 官方原始权重 |
| P1-14 | Agent A–E 职责有交叉：A/D 都碰安装 UI，A/B 都碰模型扫描，A/E 都碰更新回滚，C/D 都碰项目 schema | 建立模块 RACI 和 allowed-paths；共享 schema 只由 Contract Owner 修改，其他 Agent 通过变更请求扩展 |
| P1-15 | 多 Agent 可并行写代码，但 H3 渲染、Comfy Desktop UI、模型下载/哈希和 Windows VM 是单实例资源 | 建立 GPU/desktop/VM/download 四个互斥锁队列；代码单测可并行，端到端与模型任务串行 |

## P2：可在 Alpha 后优化

| ID | 问题 | 建议 |
|---|---|---|
| P2-01 | 没有小白可用性量化标准 | 进行至少 5 名未接触 ComfyUI 用户的任务测试；记录无需文档完成率、错误恢复率和平均决策数 |
| P2-02 | 安装空间与耗时只展示静态估算 | 首次 5 秒校准后更新渲染 ETA；空间估算区分下载峰值、最终占用、项目临时占用和建议保留空间 |
| P2-03 | 深度扫描大盘和几十 GB 模型全哈希可能很慢 | 先 header/size/revision，后台做一次全哈希并缓存 file id、size、mtime；文件变化后失效 |
| P2-04 | 专家覆盖仅标“未认证”，缺少恢复路径 | 自动复制为新 recipe override，不修改 Stable 锁；提供“一键恢复认证配方” |
| P2-05 | 本地化、键盘操作、高 DPI、屏幕阅读器和色弱状态未进入验收 | 把中文首发、125%/150% DPI、键盘导航、非颜色状态标识加入 UI 测试 |
| P2-06 | 品牌水印扩展契约有功能字段，但没有安全区预览和旧项目迁移 | 品牌阶段再增加 `branding.schema` 版本、横竖屏安全区预览、资产哈希和无水印回退；保持与 AI 披露完全独立 |

## 范围问题审计

### 已清晰、应保持不变

- 工具没有“生成视频”按钮；正式任务只能交接给 ComfyUI。
- 工具不创建新生成模型、不微调 H3、不替代采样器、不接入云推理。
- 不询问故事/MV/口播类型，不做 AI 导演或语义分类。
- 用户提示词为原始内容来源；技术占位和长视频 envelope 必须与原文分栏记录。
- H3 冒烟样本只证明模型可加载、节点可执行、音视频能封装；QA 不评价审美、表演和故事。
- `H3LongVideoRunner` 可以在用户点击一次 ComfyUI Run 后内部循环，但不得在点击前替用户提交正式任务。

### 仍需一句精确定义

建议在范围章节再加入：

> “本工具不自动提交第一笔正式 ComfyUI Queue；用户点击 Run 后，工作流中的 H3LongVideoRunner 可以确定性调度多个 H3 窗口，这是已获用户触发的同一工作流执行，不视为工具界面的自动生成服务。”

这句话可以消除“禁止自动排队”与长视频 runner 必须循环之间的解释冲突。

## 小白流程与信息架构问题

### 推荐的 Alpha 安装 IA

```text
欢迎页
→ 硬件与磁盘只读检测
→ 推荐安装位置（默认 D:\MiniMaxH3，可修改）
→ 自动发现并验证现有模型
→ 推荐方案摘要
   · 创建独立 H3 环境
   · 复用哪些模型
   · 缺失哪些文件
   · 下载/峰值/最终空间
   · 为什么适合当前电脑
→ H3 与第三方许可
→ 安装、校验、回滚点
→ 可选最小生成验证
→ 完成
```

普通用户不应在首屏选择 Desktop/Core/Portable。检测器应先给出一个推荐结果；“直接修改现有实例”“深度扫描”“分开模型/缓存/输出目录”进入高级设置。

### 推荐的 Alpha 项目创建 IA

```text
提示词（可空）
首帧 / 尾帧（可选）
时长：5 / 10 / 15 / 自定义 4–15 秒
画面比例：自动 / 16:9 / 9:16 / 1:1
生成分辨率：自动推荐

自动摘要：I2VA · FL2VA 配方 · 10 秒 · 24 FPS · H3 原生声音

[生成工作流并打开 ComfyUI]
```

Ref 素材、BGM/旁白、30/60 秒、导出超分只有在对应 1.0 capability 安装并启用后才出现。页面不询问内容类型，也不要求理解模型文件、采样器、加速节点或上下文帧数。

## 合规、隐私与安全问题

### H3

计划对当前许可的核心识别基本准确，但发布前仍需把“法务确认”变成可执行产物：

- 目标发行地域清单及被排除地域处理。
- 下载权重前的许可版本、哈希、接受记录和用户条款。
- 商业 UI 中 `MiniMax H3` 的固定展示位置。
- 公开成片 AI 生成披露是始终默认开启，还是由“公开导出”模式强制开启。
- 下游 AUP、安全防护和违规报告入口。
- 许可/AUP 更新时旧安装是否继续可用、何时要求重新接受。
- 量化、LoRA 与派生文件的来源、发布者和同一 H3 许可继承记录。

官方许可当前的地域、商业 UI、下游约束和收入授权条款见 [MiniMax H3 Community License](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE)。

### Comfy Desktop、ComfyUI Core 与 custom node

当前官方 Comfy Desktop 已能管理多套独立环境、更新、快照和回滚，且 README 明确给出 AGPL-3.0-or-later / 商业许可双许可。这既是许可问题，也是 build-vs-buy 决策：若采用官方 Desktop 作为环境宿主，本工具可显著缩小安装器范围；若自建 managed runtime，则需承担 Python/Torch/CUDA、升级、快照和恢复的长期维护成本。[Comfy Desktop 官方 README](https://github.com/Comfy-Org/Comfy-Desktop/blob/main/README.md)

此外需要单独评审 [ComfyUI Core 的 GPL-3.0 许可](https://github.com/Comfy-Org/ComfyUI/blob/master/LICENSE) 和 `H3LongVideoRunner` 的发布许可证。不能只完成 Desktop 的双许可判断，就认为整个组合已经合规。

### FFmpeg

FFmpeg 是本产品视频交付链的核心依赖，不只是“一个命令行工具”。发布门必须锁定：构建来源、配置、哈希、动态库/独立进程方式、实际编码器、对应源码和专利评估。若走 LGPL 路径，官方清单明确建议不启用 GPL/nonfree，并要求匹配源码、构建说明和 About/EULA 文案；libx264 等会改变合规路径。[FFmpeg 官方 Legal 页面](https://ffmpeg.org/legal.html)

### 节点供应链

计划的 allowlist、commit/hash、wheelhouse 和 SBOM 方向正确。Comfy Registry 当前提供语义版本、不可变发布版本及恶意行为扫描，工作流也可记录节点版本；它可作为来源之一，但不能替代本工具自己的锁定、代码审计和签名 manifest。[Comfy Registry 官方说明](https://docs.comfy.org/registry/overview)

## 交付与项目管理问题

### GPT-5.6 Sol 多 Agent 适配性

适合执行的工作：

- ADR、schema、威胁模型草案、UI 信息架构和测试规范。
- 模块化代码、单元测试、fixture、安装事务、扫描器、编译器和自定义节点。
- 官方来源核验、SBOM 生成、静态许可证矩阵和发布证据整理。

不能由 Agent 单独完成或证明的工作：

- 法律意见、商业授权和目标地域决定。
- 代码签名证书、官方账号、镜像托管和下载服务凭证。
- 多种真实 GPU/驱动/RAM/磁盘的认证结果。
- 最终品牌水印资产和商业视觉决策。
- 对公众内容安全防护是否满足 H3 许可的法律充分性判断。

### 当前职责重叠

| 冲突 | 涉及角色 | 解决方式 |
|---|---|---|
| 安装页面与路径交互 | Agent A / D | A 提供 installer service 与状态机；D 只实现 UI 绑定，不写安装逻辑 |
| 模型发现与安装 | Agent A / B | B 拥有 scanner/registry；A 只消费 registry 并执行下载/安装 |
| 项目 schema 与工作流 schema | Agent C / D | Contract Owner 拥有 schema；C 生成工作流，D 只读写经版本化的 project contract |
| 更新、回滚、发布 | Agent A / E | A 实现；E 定义验收、做破坏性测试和独立审计，不改同一实现文件 |
| H3 兼容测试 | Agent C / E | C 提供 golden workflow/fixture；E 从外部调用并记录结果 |
| 许可证与组件 catalog | Agent B / E | E 拥有许可判断字段；B 只消费已批准 catalog，不自行决定可分发性 |

### 并行瓶颈

- 单张 GPU：所有 H3 smoke、30/60 秒、加速 A/B 必须串行。
- 单一 Comfy Desktop 会话：安装、导入、快照、升级和 UI 自动化不能并行。
- 大模型下载与全哈希：会占满网络和磁盘，禁止多个 Agent 重复下载。
- Windows VM 快照：安装/卸载/升级矩阵应由专门测试队列执行。
- lockfile、schema、manifest 和安装状态机是高冲突文件，只能由指定 owner 修改。

## 优化建议

1. **采用 capability-driven 产品，而不是写死页面。** 所有组件和创建页字段从同一 `capability_catalog` 解析，键包含 release channel、hardware profile、license eligibility、installed state 和 support level。
2. **优先验证 Desktop-managed 路线。** 官方当前 Desktop 已有多 install、隔离、快照、回滚；先验证能否创建/选择目标 install、配置模型路径、导入 workflow。验证失败再自建完整 runtime manager。
3. **五份 contract 先行。** 在任何 UI 或安装器代码前冻结 `component-manifest`、`recipe`、`project`、`install-state`、`run-manifest`，每份都有 JSON Schema、示例、版本和迁移规则。
4. **把最小冒烟与认证实验分开。** 安装器只运行一次最小合法 H3 窗口；30/60 秒和加速 A/B 在实验室 test queue 运行。
5. **建立双层测试。** 无模型的快速 contract/unit tests 在每次提交运行；需 GPU 的 golden workflow tests 只在锁定环境和人工调度下运行。
6. **公开导出与项目工件分开。** 项目目录保留复现信息；公开导出通过 sanitizer，保证 MP4/图片/音频/sidecar 不泄漏 prompt、workflow、用户名和绝对路径。
7. **不把“检测到了”当作“可复用”。** 状态至少分为 found、identified、verified、compatible、approved、selected 六步，只有最后两步才进入 recipe。
8. **先支持一个运行时和一个硬件档位。** Alpha 不同时承担旧 Desktop、新 Desktop、Portable、未知量化和多套 GPU 配方。
9. **给每个 Agent 一个 context packet。** 包含任务 ID、允许路径、依赖 contract、禁止项、验收命令、需人工提供的外部条件和最大改动范围。
10. **集成负责人不并行写业务模块。** 其职责是 schema、接口评审、合并、冲突解决和 gate 判定，保证其他 Agent 交付可组合。

## 建议决策门

| Gate | 决策 | 必需证据 | 决策者 | 未通过时允许做什么 |
|---|---|---|---|---|
| G0 范围门 | Alpha/1.0 capability matrix | 版本功能表、普通/专家 IA、非目标 | 产品负责人 | 只写文档与 fixture |
| G1 运行时门 | Desktop-managed 或 managed Portable/Core | 两条 spike、路径/启动/导入/回滚实测、维护成本 | 架构负责人 + 产品 | 只做只读探测 |
| G2 技术栈门 | Tauri/.NET/PySide | 安装、升级、签名、文件权限、UI 原型对比 | 架构负责人 | 不写正式 UI |
| G3 合规门 | H3/Comfy/FFmpeg 分发路线 | 官方许可矩阵、目标地域、用户条款、NOTICE、外部法务意见 | 法务/产品所有者 | 内部原型，不公开分发 |
| G4 Contract 门 | 五类 schema v1 | JSON Schema、样例、迁移、兼容策略、owner | 集成负责人 | 模块只能做 spike |
| G5 硬件门 | 首个认证 profile | 真实硬件、驱动、模型/hash、资源峰值、5 秒 golden tests | QA/硬件负责人 | 显示实验或不支持 |
| G6 FFmpeg 门 | 编码/分发规格 | 二进制/hash/buildconf、codec、源代码材料、专利审查 | 法务 + 发布负责人 | 仅保留中间文件 |
| G7 Alpha 安装门 | 安装器可交付 | 新装/复用/断点/回滚/卸载/C 盘保护矩阵 | QA | 不进入短视频 UAT |
| G8 Alpha 工作流门 | 4–15 秒可交接 | T2V/I2V/L2V/FL2V、音轨、时长、metadata sanitizer | QA + 产品 | 不公开 Alpha |
| G9 Ref2VA 门 | 参考包可用 | 输入约束、复用共享模型、golden workflows | QA | 隐藏 Ref UI |
| G10 30 秒门 | Stable 候选 | 明确 pass rate、恢复、缓存失效、A/V 时间轴 | QA | 保持 Experimental |
| G11 60 秒门 | Beta | 风险提示、恢复、精确时长、资源上限 | 产品 + QA | 不展示 60 秒 |
| G12 发布门 | 1.0 公开发布 | 签名、SBOM、许可材料、网络抓包、隐私、支持流程 | 发布委员会 | 只内部/封闭测试 |

## 完整细粒度 WBS 候选

估算单位为 GPT-5.6 Sol 的主动 Agent 工时，不含人类法务等待、下载、渲染、VM 重置和硬件排队。每项应由一个 Agent 独占允许路径；标注 `Human` 的验收必须由外部负责人签署。

### A. 治理、架构与合同

| ID | 依赖 | 产物 | 验收 | 预计 Agent 工时 |
|---|---|---|---|---:|
| A-001 | 无 | 仓库骨架、`AGENTS.md`、目录所有权、提交/测试规范 | 新 Agent 能从单页规则知道允许路径、禁止项和测试命令 | 4–6 |
| A-002 | 无 | 产品范围 ADR | 明确工具/H3/Comfy/Runner/测试职责，无“生成视频”按钮或云推理 | 3–4 |
| A-003 | A-002 | Alpha/1.0 capability matrix | 安装卡、创建字段、工作流和测试均能按版本过滤 | 4–6 |
| A-004 | A-002 | 技术栈比较 spike | 三候选至少完成文件权限、进程启动、自动更新/签名、基础 UI 验证 | 8–12 |
| A-005 | A-002 | 当前 Comfy Desktop 集成 spike | 能发现 install、创建/选择隔离环境、定位模型配置、导入或打开 workflow；记录失败点 | 10–16 |
| A-006 | A-002 | Managed Portable/Core spike | 在 D 盘启动锁定 Comfy、加载最小 workflow，不改系统 Python/PATH | 8–12 |
| A-007 | A-004,A-005,A-006 | Runtime topology ADR | 主路径唯一；兼容路径范围和非目标明确 | 4–6 |
| A-008 | A-002 | H3 许可/地域证据包 | 逐条引用官方许可，列出目标地域、UI 归属、AUP、AI 披露和待 Human 决策 | 6–8 |
| A-009 | A-007 | Comfy 许可组合矩阵 | 覆盖 Desktop、Core、frontend、Manager、自有 Runner、第三方 node | 6–10 |
| A-010 | A-007 | FFmpeg/codec ADR 草案 | 锁定候选构建、调用方式、codec、源码材料；Human 法务项单列 | 6–10 |
| A-011 | A-007,A-008 | 数据流图与威胁模型 | 覆盖扫描、下载、解压、模型、prompt、输出、更新、支持包、删除 | 8–12 |
| A-012 | A-003,A-007 | 五类 JSON Schema v1 | schema、示例、版本、迁移、未知字段策略和 owner 齐全 | 12–16 |
| A-013 | A-011,A-012 | Manifest 签名与信任根 ADR | key id、轮换、撤销、过期、离线验证和回滚可测试 | 6–8 |
| A-014 | A-003 | 首个硬件认证矩阵草案 | 指定 GPU/驱动/RAM/磁盘/模型/精度/基线，不用“相似 GPU”猜测 | 5–8 |
| A-015 | A-007…A-014 | Phase 0 gate report | 每个 P0 有 owner、证据、状态；Human 未签项明确阻止公开分发 | 4–6 |

### B. 小白 UX 与产品文案

| ID | 依赖 | 产物 | 验收 | 预计 Agent 工时 |
|---|---|---|---|---:|
| B-001 | A-003,A-007 | Alpha 安装 IA/低保真原型 | 普通路径只需确认根目录、推荐方案和许可；高级项折叠 | 6–8 |
| B-002 | A-003,A-008,A-010 | 组件卡文案 catalog | 每项有用途、必需性、来源、状态、下载/占用、许可和风险；按版本过滤 | 5–7 |
| B-003 | A-012 | 模型发现/复用交互 | verified 模型默认推荐；未知/损坏不静默使用；可改路径 | 4–6 |
| B-004 | A-003,A-012 | 项目创建 IA/真值表 | 支持 prompt/首/尾组合；Ref/BGM/长视频仅在能力开启后出现 | 6–8 |
| B-005 | B-004 | 编译摘要与技术 envelope diff UI | 用户可见模式、时长、配方、实际 prompt 差异和风险，无内容类型判断 | 4–6 |
| B-006 | A-011 | 错误与恢复文案规范 | 每个错误说明发生了什么、保留了什么、下一步；无纯错误码 | 6–8 |
| B-007 | B-001…B-006 | 小白 UAT 脚本与评分表 | 5 名新手可在不读 Comfy 节点文档下完成安装/创建/交接任务 | 6–10 |

### C. 只读检测、模型注册与路径适配

| ID | 依赖 | 产物 | 验收 | 预计 Agent 工时 |
|---|---|---|---|---:|
| C-001 | A-012 | Windows/磁盘 probe | 正确识别固定盘、文件系统、空间、SSD/移动/网络盘；零写入 | 6–8 |
| C-002 | A-014 | NVIDIA/GPU/驱动/RAM probe | 输出稳定结构；未知 GPU 不被自动认证 | 6–8 |
| C-003 | A-007,A-012 | Comfy 实例发现器 | 区分当前 Desktop、旧 Desktop、Portable/Core 与运行中实例 | 8–12 |
| C-004 | A-007,C-003 | 模型路径 adapter | 每类实例只读解析受支持入口；Desktop 管理配置不擅自写入 | 10–14 |
| C-005 | A-012,C-004 | 分层目录扫描器 | 默认只扫已知目录；深扫需用户授权、可取消、不索引无关内容 | 8–12 |
| C-006 | A-012 | Safetensors/候选分类器 | header 有大小上限；能区分角色、格式、未完成文件和未知量化 | 8–10 |
| C-007 | C-006,A-013 | 哈希与验证缓存 | 首次全哈希、后续安全缓存；文件变化后失效；不只信文件名 | 6–10 |
| C-008 | A-010 | FFmpeg/FFprobe 能力 probe | 输出版本、buildconf、codec、mux/mix/probe 冒烟结果 | 4–6 |
| C-009 | C-001…C-008 | `hardware-report`/`model-registry` | schema 校验通过，标注 found→approved 全状态和管理所有权 | 6–8 |
| C-010 | C-005…C-009,A-011 | 扫描安全与性能测试 | 覆盖拒绝访问、长路径、中文、junction、超大 header、取消和重复扫描 | 8–12 |

### D. 安装、下载、运行时与回滚

| ID | 依赖 | 产物 | 验收 | 预计 Agent 工时 |
|---|---|---|---|---:|
| D-001 | A-012,A-013 | 签名 component catalog loader | 签名、版本、过期、撤销、离线 manifest 全部可验证 | 7–10 |
| D-002 | A-008,D-001 | H3/组件许可接受状态机 | 下载前阻断；记录版本/hash/time；许可变化触发明确策略 | 6–8 |
| D-003 | C-001,B-001 | 安装根与空间规划器 | 默认 D、可改；峰值/最终/余量准确；仅 C 时明确确认 | 6–8 |
| D-004 | D-001,D-003 | 断点下载器 | `.partial`、Range、重试、哈希、取消、恢复和限速通过 | 10–14 |
| D-005 | D-004,A-011 | 安全 staging/解压/原子切换 | 拒绝 path traversal/reparse escape/压缩炸弹；失败不污染 current | 10–14 |
| D-006 | D-001,A-013 | 锁定 wheelhouse/环境依赖安装 | Stable 不联网 pip；每个 wheel 有来源、版本和哈希 | 10–14 |
| D-007 | A-007,D-005,D-006 | 主运行时 adapter | 按 G1 选定路线安装/接入；不改系统 Python/CUDA/PATH | 12–18 |
| D-008 | C-009,D-007 | 模型复用与路径 bridge | 外部模型零移动/零删除；写入有备份、事务和回滚 | 8–12 |
| D-009 | A-010,D-005,C-008 | FFmpeg 部署/复用 | 只使用批准构建；编码、混音、probe 测试通过，About 材料可生成 | 6–8 |
| D-010 | D-007,D-008,D-009 | 安装技术冒烟 | Comfy 启动、节点导入、模型可加载；H3 最小样本需明确用户同意 | 8–12 |
| D-011 | D-005,D-007,D-008 | ownership/rollback/uninstall | 只删 `managed_by_tool`；外部模型、项目和用户修改不受影响 | 10–14 |
| D-012 | B-001…B-003,D-001…D-011 | 安装 UI 集成 | 所有状态来自服务 contract；UI 不自行执行文件写入 | 10–14 |
| D-013 | D-012,C-010 | Alpha 安装矩阵 | 新装、复用、中断、重启、空间不足、无 D、中文路径、卸载全部通过 | 12–18 |

### E. 项目、短视频工作流与 Comfy 交接

| ID | 依赖 | 产物 | 验收 | 预计 Agent 工时 |
|---|---|---|---|---:|
| E-001 | A-007,A-012 | 当前 Comfy object/schema 捕获器与 golden templates | 不依赖脆弱 widget 数组位置；模板修订可检测 | 8–12 |
| E-002 | A-012,B-004 | 项目/素材管理器 | 原始 prompt、effective prompt、素材角色、相对路径/引用策略可复现 | 8–10 |
| E-003 | B-004,E-002 | 输入路由器 | T2VA/I2VA/L2VA/FL2VA 真值表全覆盖；无静默降级 | 6–8 |
| E-004 | E-001,A-014 | 时长/分辨率编译器 | 17k+5、24 FPS、4–15 秒、倍数 32、最终裁切可单测 | 8–12 |
| E-005 | E-001,E-003,E-004 | T2VA workflow compiler | 可视图/API 图 schema 通过、模型已解析、无缺失节点 | 6–8 |
| E-006 | E-001,E-003,E-004 | I2VA/L2VA/FL2VA compiler | 首/尾端点正确；空 prompt 策略可见；三条 golden tests 通过 | 8–12 |
| E-007 | D-009,E-005,E-006 | 短视频封装/output graph | MP4 可播放，24 FPS、32 kHz stereo、最终时长误差 ≤1 帧 | 6–10 |
| E-008 | A-005/A-006,E-005 | Comfy 打开与交接 adapter | 工具不提交首个 Queue；目标 install 正确打开已编译 workflow | 8–12 |
| E-009 | A-011,E-002,E-007 | 公开导出 sanitizer | MP4/图片/音频不含 prompt、workflow、用户名、绝对路径；项目私有工件保留复现信息 | 8–12 |
| E-010 | E-001…E-009,D-013 | Alpha 端到端认证 | T2V/I2V/L2V/FL2V、横竖方、空 prompt、离线、恢复全部通过 | 12–18 |

### F. Ref2VA 与长视频

| ID | 依赖 | 产物 | 验收 | 预计 Agent 工时 |
|---|---|---|---|---:|
| F-001 | Gate G8,E-010,D-001 | Ref2VA capability/catalog | 仅在 Phase 4 启用；共享 encoder/VAE 不重复下载 | 4–6 |
| F-002 | F-001,E-003 | Ref 输入预检与路由 | 官方数量/时长限制、混合输入和空 prompt 策略明确 | 6–8 |
| F-003 | F-002,E-001 | Ref2VA compiler | 图片/视频/音频 golden workflows 无缺失节点 | 8–12 |
| F-004 | F-001…F-003 | Ref2VA 技术认证 | 三类参考、H3 原生音频、metadata sanitizer 和卸载复用通过 | 10–14 |
| F-005 | A-007,A-012,E-004 | Long Runner 状态机 ADR/format | 片段 ID、父链、状态、fingerprint、原子文件和恢复协议冻结 | 8–12 |
| F-006 | F-005 | 视频/音频 timebase 数学库 | overlap、裁切、PTS、32 kHz/40 Hz latent 边界有属性测试 | 8–12 |
| F-007 | F-005,E-001 | `H3LongVideoRunner` node skeleton | 只在用户 Run 后调度既有 H3 节点；不含生成模型或语义创作 | 10–14 |
| F-008 | F-006,F-007 | AV latent 上下文与重复头裁切 | 版本化 context profile；分辨率固定；重叠无重复帧/音频 | 14–20 |
| F-009 | F-005,F-007 | 原子 checkpoint/resume/cache invalidation | 崩溃/重启恢复；半文件无效；修改 N 段使后续缓存失效 | 10–14 |
| F-010 | F-006,F-009,D-009 | 流式组装、BGM/旁白混音 | 不持有全片 RAM；精确时长；PTS 单调；失败保留片段 | 10–14 |
| F-011 | F-008,F-010 | 技术异常检查 | 黑/灰/冻结/静音/DC/爆音/接缝输出可解释告警，避免把创作选择误判为失败 | 8–12 |
| F-012 | F-007…F-011,B-005 | 小白长视频 subgraph/状态 UI | 主画布简洁，片段进度、恢复点、Beta 风险和 effective prompt 可见 | 6–10 |
| F-013 | F-008…F-012 | 30 秒 Stable 候选认证 | 认证矩阵达到书面 pass rate；恢复、缓存失效、A/V、metadata 全通过 | 8–12 + GPU 排队 |
| F-014 | F-013 | 60 秒 Beta 认证 | 达到 Beta 门、资源上限与失败边界可见；不宣传无缝一镜到底 | 8–12 + GPU 排队 |

### G. 安全、更新、品牌扩展与发布

| ID | 依赖 | 产物 | 验收 | 预计 Agent 工时 |
|---|---|---|---|---:|
| G-001 | A-011,D-013,E-010 | 生成阶段网络抓包测试 | 工具/Comfy/节点/FFmpeg 无未声明外联；更新与下载阶段独立 | 6–10 |
| G-002 | A-011,E-009 | 支持包脱敏器 | 默认移除 prompt、素材、用户名和绝对路径；用户可预览包含项 | 6–8 |
| G-003 | A-013,D-001 | Signed update client | Stable/Testing 分离，签名/撤销/过期/回滚测试通过 | 10–14 |
| G-004 | A-008…A-010,D-001 | SBOM/NOTICE/About 生成器 | 每个发布物可追溯 license/source/hash/buildconf，缺项阻止发布 | 8–12 |
| G-005 | A-011,D-005,D-011 | 路径/压缩/删除安全测试 | ZIP Slip、junction、hardlink、TOCTOU、越界删除均被拒绝 | 8–12 |
| G-006 | A-008,B-002,E-009 | MiniMax H3 UI 归属与 AI 披露策略实现 | 商业 UI 显示与公开成片披露可分别验收；品牌 Logo 不能关闭它们 | 6–10 |
| G-007 | A-012,G-006 | `branding.schema` no-op 扩展位 | 当前无品牌资产仍可运行；以后加水印无需改变生成/runner schema | 4–6 |
| G-008 | A-004,G-003,G-004 | 安装包签名与发布构建 | 可复现构建、签名验证、第三方材料、病毒扫描和升级路径通过 | 10–14 + Human 证书 |
| G-009 | G-001…G-008,F-014 | 独立发布审计 | P0/P1 清零，所有证据链接到版本，未关闭 Human 项阻止发布 | 8–12 |
| G-010 | G-009 | 1.0 release candidate 与回滚演练 | 新装、升级、降级、卸载、项目迁移、离线、支持包全流程通过 | 10–16 |

## 调度方案与首批 5 任务

### 调度原则

- 当前调度上限为 **1 名根集成 Agent + 10 名并行工作 Agent**。这是对原三 Worker 建议的治理升级；根 Agent 仍不与 Worker 抢写业务模块，且 schemas、lockfile、GPU、Desktop、VM 与模型下载继续受单持有锁约束。
- 每个任务先发 context packet，再创建 Agent；任务粒度控制在 4–12 Agent 工时，超过 12 小时继续拆分。
- 并行任务必须声明 `allowed_paths`。共享 schema、根 lockfile、installer state machine 和 runner format 由唯一 owner 修改。
- 使用三类队列：`CPU/文档并行队列`、`Windows Desktop/VM 串行队列`、`GPU/H3 串行队列`。
- GPU 测试通过测试协调 Agent 请求时间窗；其他 Agent 不得自行下载第二份模型或启动 H3。
- 每个任务完成时必须给出：范围确认、文件清单、schema 影响、测试证据、未关闭问题、下一任务解锁条件。
- 每波结束由根 Agent 做一次 contract integration test，再启动下一波；不要让 Phase 1–3 按角色完全平行到底。

### 首批 5 任务

| 顺序 | 任务 | 是否并行 | 首要产物 | 为什么先做 |
|---|---|---|---|---|
| 1 | A-001 仓库骨架与 Agent 文件所有权 | 立即，根/集成 Agent | `AGENTS.md`、目录边界、测试入口 | 当前仓库只有计划文件；没有边界就并行必冲突 |
| 2 | A-003 Alpha/1.0 capability matrix | 与 3、4 并行 | 版本化功能表 | 先消除安装页把 Ref/长视频/超分提前展示的矛盾 |
| 3 | A-005 当前 Comfy Desktop 集成 spike | 与 2、4 并行；占 Desktop 队列 | 发现/创建 install、模型配置、workflow 打开实测 | 决定是否需要自建完整运行时，是最大架构分叉 |
| 4 | A-008/A-009/A-010 许可证据矩阵草案 | 与 2、3 并行 | H3/Comfy/FFmpeg 官方来源矩阵与 Human 决策清单 | 及早确定能否捆绑、目标地域和自有 node 许可 |
| 5 | A-012 五类 schema v1 | 等 2、3 给出结论后启动 | JSON Schema、样例和迁移规则 | 所有后续扫描、安装、UI、编译器和 runner 的并行契约 |

首波结束必须召开 G0/G1/G3/G4 四门联合评审。只有 capability matrix、runtime topology、合规路线和 contracts 同时达到“可执行”状态，才启动检测器、安装器 UI 和工作流编译器的并行开发。

## 最终审计意见

0.3 的方向是正确的，尤其是工具/H3/Comfy 的职责分离、无云推理、无 AI 导演、D 盘与模型复用、供应链锁定、品牌水印和 AI 披露分层。当前不建议继续把计划扩展成更大的功能愿望清单；下一步应收敛成一个窄 Alpha：

```text
一个 Windows/NVIDIA 已认证档位
+ 一个主运行时拓扑
+ FL2VA 4–15 秒
+ H3 原生声音
+ 已验证模型复用
+ 生成工作流并打开 ComfyUI
+ 用户点击 Run
```

先把这条路径做到可安装、可恢复、可审计、可卸载，再进入 Ref2VA、30 秒、60 秒和品牌水印。对 GPT-5.6 Sol 多 Agent 而言，这种 contract-first、资源串行、文件独占的拆分是可执行的；若跳过 Phase 0 直接按 Agent A–E 同时写代码，最可能失败在运行时重复建设、共享 schema 冲突、单 GPU 排队和许可证返工，而不是失败在 H3 工作流本身。
