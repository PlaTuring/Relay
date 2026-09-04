# MiniMax H3 工具关键假设红队审计

> 审计对象：`MINIMAX_H3_TOOL_EXECUTION_PLAN.md` 0.3  
> 审计角色：独立红队 Agent C  
> 审计日期：2026-08-27  
> 范围：Comfy Desktop 外部集成、工作流双表示、完全本地与零外联、H3 文件来源、comfy-cli、隐藏用户选择、产品承诺证据门  
> 限制：本报告不修改主计划，不构成法律意见；许可结论仍须由合格法务按实际发布物复核。

## 结论

[待PoC] 当前 0.3 计划不能把“生成工作流并自动在 ComfyUI Desktop 显示”视为已解决接口。[已证实] `--disable-api-nodes`、节点 allowlist 或“没有云推理 API”中的任何一个，单独都不足以证明“生成阶段无外联”。这两项都是 **P0 实验门**。

[推断] 工作流数据契约应避免两个可编辑真相源：`project.h3.json + recipe.lock.json + workflow.json` 可以成为长期权威输入，`prompt.json` 更适合作为由目标 ComfyUI 版本编译出来的、带指纹的构建/运行快照，而不是让用户或两个模块长期分别维护。[待PoC] 是否完全取消持久化 `prompt.json` 仍需用 H3 节点、长视频 Runner 和故障恢复实验决定。

[已证实] comfy-cli 可以降低安装和检查成本，但当前官方 CLI 同时具备本地安装、节点脚本执行、模型下载、云端路由、Partner 模型调用和 Mixpanel 分析能力。[推断] 它不能未经约束地被当成“纯本地可信安装库”；若采用，优先作为固定版本的独立子进程，并限制为精确 allowlist 命令、显式 workspace、本地路由、独立配置目录和禁用遥测。Stable 节点供应链仍应由本工具签名 manifest 与本地 wheelhouse 控制。

### 立即执行的 P0 结论

1. **冻结“自动在 Desktop 显示”承诺**，先完成 RT-DESKTOP-OPEN；失败即切受管 runtime 或诚实降级为手动从 Workflows 列表打开。
2. **冻结 workflow contract**：只能有一个权威源；`prompt.json` 作为带 build ID 的派生产物，待 RT-WORKFLOW-DUAL 决定保存周期。
3. **强离线承诺只授予受管实例**；现有任意 Desktop/custom-node 环境在 RT-ZERO-EGRESS 通过前不得标为“零外联认证”。
4. **冻结 Alpha 逐文件 manifest**：每个 FL2VA、encoder、VAE、LoRA 都有 revision、hash、原创者、量化/重打包者和许可链；未关闭的 Turbo 直接回退基线。
5. **comfy-cli 只进入受限 PoC**：独立进程、固定 wheel、显式 workspace/local、禁遥测、命令 allowlist；不得用默认 install、setup、latest、update all 或任意 node 脚本作为 Stable 路线。
6. **普通安装页先去掉未来能力选择**：Ref2VA、30/60 秒、补帧、BGM 和品牌水印在 capability 未发布前完全隐藏。
7. **建立 claim registry**：没有版本化证据的“一键、全部、任何、绝不、完全、最快、官方”不得进入公开发布物。

### 状态标记

- **已证实**：有截至审计日可核对的官方文档、官方仓库或实际 0.3 计划文字支持。
- **推断**：由已证实事实得出的产品/架构判断，尚未完成目标发布物实测。
- **待PoC**：没有稳定公开契约，或必须在锁定版本、真实 Windows/GPU/网络环境中用实验关闭。

### 七项假设总表

| 假设 | 红队判定 | 当前是否可写成承诺 |
|---|---|---|
| Desktop 可被稳定定位并自动打开指定 workflow | **待PoC**：官方公开资料证明多实例和手动打开，但未给出跨版本外部“选实例并激活画布文件”的稳定契约 | 否 |
| 只长期保存 UI workflow、不保存 API graph | **推断：有条件合理**；API graph 应按目标版本派生并在运行证据中留快照，不能完全丢失可复现证据 | 只能写成内部数据设计，不能写成兼容承诺 |
| 禁用 API 节点即可证明完全本地、零隐藏外联 | **已证实为不足**：该开关覆盖 Partner Nodes 和前端外联，不约束任意 custom node、Desktop、CLI、更新器和安装脚本 | 否 |
| Comfy-Org H3 文件均是 MiniMax 官方原始模型/同一来源 | **已证实为错误表述**：官方卡明确称为 repackaged，且列出 MiniMax、LightX2V、第三方 Qwen 量化来源；部分 embedding 明确为社区贡献 | 否 |
| comfy-cli 可直接作为安全、纯本地安装后端 | **推断：只能受限使用**；独立进程方向合理，但 GPL、云路由、遥测和节点脚本风险必须关闭 | 否 |
| 小白仅需提示词或图片与时长，没有其他选择 | **推断：仅在产品预先做完多数决定时成立**；异常硬件、路径、许可、输入冲突和素材导入仍需条件式选择 | 只能写“正常认证路径” |
| 一键、离线、最快、无 C 盘写入、全兼容等可以先作为愿景宣传 | **已证实不可接受**：0.3 自身仍把多项列为 Phase 0/认证事项 | 否 |

## 1. ComfyUI Desktop 能否被外部工具稳定定位实例并打开指定 workflow

### 红队结论

- **已证实**：当前官方 Windows 文档把 Comfy Desktop 描述为多安装管理器；默认安装记录位于 `%APPDATA%\Comfy Desktop`，实例和共享目录分别可能位于 `%LOCALAPPDATA%\Comfy-Desktop\ComfyUI-Installs`、`%LOCALAPPDATA%\Comfy-Desktop\ComfyUI-Shared`，旧版还可能位于 `%USERPROFILE%` 下，且用户可以选择自定义安装路径。[Comfy Desktop Windows 官方文档](https://docs.comfy.org/installation/desktop/windows)
- **已证实**：官方用户文档当前公开的 workflow 打开方式是界面中的 `Workflows -> Open` 或拖放文件；comfy-cli 文档公开了 `--workspace`、`launch` 和运行 workflow，却没有在所引用的公开接口中定义“让 Desktop 选择某个 install，并把某个外部文件激活为当前画布”的命令或 deep link。[ComfyUI 首次生成文档](https://docs.comfy.org/get_started/first_generation)；[comfy-cli 官方 README](https://github.com/Comfy-Org/comfy-cli/blob/main/README.md)
- **推断**：通过固定目录扫描找到“候选 ComfyUI 根目录”是可行的，但把 Desktop 的内部 installation registry 当成稳定公共 API 会造成版本耦合。多实例、旧版迁移、自定义目录和正在运行的第二实例使“找到一个路径”不等于“选中了正确实例”。
- **待PoC**：目前不能确认外部工具是否能在不做鼠标/键盘自动化、不覆盖用户当前未保存画布的前提下，稳定完成“启动/聚焦指定 Desktop install + 激活指定 workflow”。

### P0 实验 RT-DESKTOP-OPEN

| 项目 | 要求 |
|---|---|
| 样本 | 当前 Stable Desktop、上一 Stable、官方仍支持的 Legacy 迁移样本、Portable；每类至少包含默认路径、自定义 D 盘路径、中文/空格路径和两实例并存 |
| 实验 | 冷启动、Desktop 已启动、目标实例未启动、错误实例已启动、画布有未保存修改、端口 8188 被占用、第二次启动、workflow 文件更新后再次打开 |
| 必须记录 | 安装 ID、实际根目录、Desktop/Comfy/frontend 版本、启动命令、进程树、端口、加载前后 workflow 内容哈希、用户画布是否被覆盖、外联记录 |
| 通过门槛 | 30/30 次定位到指定实例；用户确认后 5 秒内显示指定 workflow；画布图指纹与生成文件一致；不依赖坐标点击；不修改其他实例；遇到未保存画布必须阻止覆盖并给出选择 |
| 验收证据 | 版本化 PoC 程序、自动化日志、进程/端口清单、前后截图或前端状态导出、文件哈希、失败注入录像、ADR 中的受支持版本表 |

### 失败回退

1. 若 Desktop 没有稳定外部打开契约，Alpha 主路径改为本工具控制的独立 ComfyUI runtime：本工具掌握 workspace、启动参数、端口和浏览器页面；Desktop 仅提供“检测并引导安装”或高级兼容模式。
2. 若必须保留 Desktop，诚实降级为“保存到目标实例的 workflows 目录并打开 Desktop；用户在 Workflows 列表中选择刚生成的项目”，按钮文案不能再承诺“自动显示”。
3. 可评估一个由本工具维护、固定版本的本地 Comfy 前端扩展，通过 loopback IPC 接收 workflow 并调用前端公开服务；它本身属于新的 custom/frontend extension，必须独立做版本兼容和安全审计，不能当成零成本补丁。
4. 严禁用通用鼠标坐标、剪贴板粘贴或窗口标题猜测作为 Stable 实现；这类方法只能用于实验室自动化。

## 2. 只输出 UI workflow、不长期保存 API graph 是否合理

### 红队结论

- **已证实**：ComfyUI 的 UI workflow 与 API format 用途不同；API format 是可执行节点图。官方 comfy-cli 当前宣称能够把 UI-format JSON 自动转换后运行，这证明 API graph 可以派生，但不证明所有目标 H3/custom nodes 在所有版本中都能无损转换。[comfy-cli 官方 README](https://github.com/Comfy-Org/comfy-cli/blob/main/README.md)
- **已证实**：0.3 当前同时把 `workflow.json` 和 `prompt.json` 放在项目根目录，且没有声明哪一份是唯一真相源、何时重新生成、用户在 Comfy 里编辑后如何同步。这会产生漂移风险。
- **推断**：对“用户在 ComfyUI 中点击运行”的正常短视频路径，长期只维护 UI workflow 是合理的；Comfy 前端会在点击时构造可执行图。对安装冒烟、无 UI 验证、长视频恢复、问题复现和供应链审计，仍需要一个与目标 Comfy 版本绑定的 API graph 或等价执行快照。
- **推断**：推荐的数据模型是“单一权威源 + 派生构建物”，而不是“只存 UI”或“长期双主”。权威源为 `project.h3.json`、`recipe.lock.json`、素材哈希和规范化 `workflow.json`；`prompt.json` 存放在 `build/<build_id>/` 或 `runs/<run_id>/`，带 `derived_from_workflow_sha256`、Comfy/frontend/object-info 指纹和生成器版本，禁止人工编辑。
- **待PoC**：H3 原生节点、Subgraph、宏节点和未来 `H3LongVideoRunner` 是否能由选定转换器稳定生成等价 API graph，必须逐版本测试；不能只依赖 comfy-cli 的一句“auto-conversion”。

### P0 实验 RT-WORKFLOW-DUAL

| 项目 | 要求 |
|---|---|
| Fixture | T2V、纯首帧空提示词 I2V、仅尾帧、首尾帧、不同画幅/帧网格、缺模型、节点重命名、Subgraph；Ref2VA/Runner 进入其 Phase 前补充 |
| 实验 | 由同一 project contract 生成 UI graph；在锁定 Comfy/frontend 上编译 API graph；静态检查 node class、模型名、输入值和输出节点；运行最小冒烟；人为修改 UI graph 后验证旧 API graph 必须失效 |
| 通过门槛 | 每次构建只产生一个 `build_id`；UI/API/project/recipe 哈希闭环；任何一方变化都拒绝混用；相同 seed/输入至少在技术结果上等价；无法转换时在进入 Comfy 前报错 |
| 验收证据 | JSON Schema、规范化规则、golden fixtures、字段级 diff、目标版本 `/object_info` 快照、编译日志、冒烟结果、迁移测试 |

### 失败回退

1. 若通用 UI→API 转换不稳定，Workflow Compiler 同时从 project IR 生成 UI graph 与 API graph，但二者必须共享同一 build ID、由同一事务产生，仍不能成为双主。
2. 若部分 Subgraph/custom node 无法转换，Alpha 禁用这些 UI 抽象，改用可验证的原生图或一个经过审计的宏节点。
3. 若产品最终完全不需要无 UI 执行，可不在项目根目录长期保存 `prompt.json`，但每次交接前仍做转换/验证，并把执行图哈希和必要快照写入本地 run manifest 以支持问题复现。

## 3. 完全本地、禁用 API 节点、无隐藏外联如何验收

### 红队结论

- **已证实**：官方提供 `--disable-api-nodes`；官方说明该参数禁用 Partner Nodes，并阻止 ComfyUI 前端与互联网通信。[Partner Nodes 官方文档](https://docs.comfy.org/tutorials/partner-nodes/overview)
- **已证实**：该官方说明的范围是 Partner Nodes 和前端，不包含任意第三方 custom node、节点安装脚本、Comfy Desktop 主进程、comfy-cli、FFmpeg 构建、更新器或操作系统服务。因此“用了这个参数”不能推出“整个进程树零外联”。
- **已证实**：comfy-cli 当前同时支持 `--where cloud`、直接 Partner 模型调用、模型下载和可选 Mixpanel 分析；云路由还能被持久设为默认。若它进入运行路径而没有显式 `--where local` 和隔离配置，就与“无隐藏云路径”目标冲突。[comfy-cli 官方 README](https://github.com/Comfy-Org/comfy-cli/blob/main/README.md)
- **推断**：必须把四个产品声明拆开验收：①不含第三方推理节点；②推理和后处理在本机；③断网仍可完成；④联网环境中生成进程树无未声明的非 loopback 流量。前三项不能替代第四项。
- **推断**：接入用户现有、可任意安装 custom node 的 Desktop 实例时，本工具无法仅靠 workflow allowlist 保证零外联。强保证需要专用受管实例、节点白名单、固定进程树和操作系统级 egress deny；现有实例兼容模式最多标为“可离线尝试/未认证”。
- **待PoC**：当前 Desktop 是否允许对指定 install 持久施加 `--disable-api-nodes`、仅绑定 `127.0.0.1` 和关闭其自身统计/更新，同时不改变用户其他实例设置，尚未实测。

### P0 实验 RT-ZERO-EGRESS

| 项目 | 要求 |
|---|---|
| 测试形态 A | 物理/VM 断网或 Windows 出站 deny，运行安装完成后的 golden H3 workflow；不能命中任何在线缓存或自动下载 |
| 测试形态 B | 网络保持可用，使用 Windows Filtering Platform/ETW、pktmon 或等价抓包并结合 DNS、进程树、命令行和端口日志，从启动 Comfy 到最终文件落盘全程观察 |
| 覆盖进程 | 本工具、Desktop/Electron、Comfy Python、所有子 worker、自有/第三方节点、comfy-cli（若存在）、FFmpeg/FFprobe、更新辅助进程 |
| 正向检查 | 有效启动参数包含 `--disable-api-nodes`；服务仅监听 loopback；workflow node class 全在 allowlist；模型和 wheel 已本地校验；没有运行期 pip/git/hf 下载 |
| 负向检查 | 注入一个会尝试 DNS/HTTPS 的测试节点和一个缺失依赖，外联必须被阻止并在 UI 明确报错，不能静默放行或临时安装 |
| 通过门槛 | 断网完成全部 golden run；在线抓包中非 loopback DNS/TCP/UDP 事件为 0；loopback 连接只指向已登记端口；负向 egress 100% 被阻止；日志不含提示词/素材正文 |
| 验收证据 | pcap/ETL、WFP 规则导出、进程镜像哈希和签名、完整命令行、监听端口表、graph allowlist 报告、断网输出哈希与 run manifest |

### 失败回退

1. 若现有 Desktop 无法被可靠约束，取消其“已认证完全本地”标签，默认创建受管独立实例。
2. 若普通用户权限无法建立可靠 egress deny，宣传降级为“安装完成后支持断网生成”；不得宣称“程序永不联网”。高级零外联模式可要求一次明确的管理员授权来创建精确防火墙规则，但必须可撤销且不影响其他 Comfy 实例。
3. 安装/更新阶段与生成阶段使用不同进程和网络策略；所有下载先进入 staging，验 hash/签名后原子落盘。生成阶段不启动 Manager、CLI update、Registry 查询或模型下载器。
4. 任何未知 custom node 或 frontend extension 出现时阻止进入 Stable 工作流，而不是只给黄色提示后继续运行。

## 4. H3 模型、量化、LoRA 和 embedding 的来源及许可证表述

### 红队结论

- **已证实**：MiniMax 官方原始仓库以 MiniMax H3 Community License 发布 H3，并定义了 Model Derivatives 和再分发条件。[MiniMax H3 官方模型卡](https://huggingface.co/MiniMaxAI/MiniMax-H3)；[MiniMax H3 Community License](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE)
- **已证实**：Comfy-Org 官方 H3 仓库自称“Repackaged model files for ComfyUI”，聚合卡的 license metadata 指向 H3 Community License，但同时列出 MiniMaxAI、LightX2V 和第三方 Qwen NVFP4 量化为来源。因此 `Comfy-Org` 是分发/重打包者，不应被写成所有文件的模型原创者，也不能把聚合仓库顶部的 license badge 当成每个文件完整来源证明。[Comfy-Org/MiniMax-H3 官方仓库](https://huggingface.co/Comfy-Org/MiniMax-H3)
- **已证实**：官方 Comfy H3 教程推荐的 `pruned_int8_convrot`、`nvfp4_awq`、VAE 和 Turbo LoRA 托管在 Comfy-Org 仓库；同一教程又明确说明其 embedding 是社区成员贡献，并非 Comfy-Org 或 MiniMax 制作。[ComfyUI MiniMax H3 官方教程](https://docs.comfy.org/tutorials/video/minimax/minimax-h3)
- **已证实**：LightX2V 的 Turbo 仓库标记 Apache-2.0，Qwen 官方 32B VL 仓库也标记 Apache-2.0；这两个 metadata 不能自动消除 H3 模型派生条款或量化发布者自己的 NOTICE/归属要求。[LightX2V MiniMax-H3 Turbo](https://huggingface.co/lightx2v/Minimax-h3-Turbo)；[Qwen3-VL-32B-Instruct](https://huggingface.co/Qwen/Qwen3-VL-32B-Instruct)
- **推断**：Turbo LoRA 很可能落入 H3 许可证对 Model Derivatives 的宽泛定义；“LoRA 仓库标 Apache-2.0，所以只需 Apache”不是安全结论。实际发布必须让法务确认许可证叠加、地域和 NOTICE。
- **待PoC**：每一个拟纳入 Stable manifest 的具体 safetensors 文件，尚需逐文件固定 revision、SHA-256、转换脚本/方法、上游链和许可证文本哈希；不能按目录或相似文件名批量继承结论。

### 建议的逐文件归属字段

| 字段 | 示例含义 | 禁止简化为 |
|---|---|---|
| `artifact_role` | FL2VA diffusion、Ref2VA diffusion、text encoder、video/audio VAE、Turbo LoRA、embedding | “H3 模型” |
| `model_creator` | MiniMax / Qwen / LightX2V 或待确认 | 下载网站名 |
| `packager_publisher` | Comfy-Org 或原发布者 | “官方原作者” |
| `quantizer_converter` | Comfy-Org、cybermotaz 或转换链中的真实主体 | MiniMax |
| `upstream_repositories` | 全部直接和间接来源及 revision | 只保留最终 URL |
| `license_chain` | H3 Community、Apache-2.0、额外 NOTICE/AUP、待法务结论 | 仓库顶部一个 badge |
| `sha256/size/revision` | 精确文件身份 | 文件名匹配 |
| `support_status` | Stable/Beta/Experimental/blocked | “官方可用” |

### P0 实验 RT-MODEL-PROVENANCE

| 项目 | 要求 |
|---|---|
| 样本 | Alpha 必需 FL2VA、文本编码器、Video VAE、Audio VAE、拟启用 Turbo LoRA；Ref2VA、embedding 先不进入 Alpha Stable |
| 实验 | 从 manifest URL 下载到 staging；验证 revision、重定向最终域名、大小、SHA-256、safetensors header；追溯模型卡和转换来源；比对官方模板真实文件名；离线加载冒烟 |
| 通过门槛 | 每个文件都有一条不含“未知”的来源链和发布决定；UI 可分别显示“模型原创者、重打包/量化发布者”；许可/AUP/NOTICE 可从安装页打开；未知或哈希漂移默认阻止 |
| 验收证据 | 签名 component manifest、逐文件 provenance JSON、许可证文本与哈希、NOTICE、SBOM、下载日志、离线加载结果、法务签核 ID |

### 失败回退

1. 任何 Turbo LoRA 的许可链未关闭时，Alpha 回退 20/25-step 基线，不安装 Turbo；不能因“加速很有用”降低发布门。
2. NVFP4 文本编码器链未关闭时，改用来源更清晰且已认证的 BF16/int8 选项，哪怕硬件门槛变高；不允许以社区下载量替代许可证据。
3. 社区 embedding 默认不安装、不扫描为“官方 H3 组件”；后续单独功能包逐个评审。
4. UI 文案统一使用“基于 MiniMax H3、由 X 重打包/量化并托管”，只有 MiniMaxAI 仓库原始文件才能写“MiniMax 官方原始权重”。

## 5. 安装器是否应借助 comfy-cli 独立进程

### 红队结论

- **已证实**：comfy-cli 官方支持精确 `--workspace`、安装/启动 ComfyUI、节点管理、快照、模型下载和 JSON 输出，适合作为 PoC 或受控 helper。[comfy-cli 官方 README](https://github.com/Comfy-Org/comfy-cli/blob/main/README.md)
- **已证实**：默认 `comfy install` 会下载 ComfyUI 和 Manager；不显式 workspace 时可落到用户 HOME，且它会复用活动虚拟环境或把依赖装入其 Python 环境。`registry-install` 会运行节点自带安装脚本；`node install` 会委托 Manager。直接调用默认命令与 0.3 的 D 盘边界、隔离运行时、禁止未知脚本和本地 wheelhouse 原则冲突。
- **已证实**：CLI 以 GPL-3.0 发布；分析为默认关闭、需 opt-in，但启用后使用 Mixpanel。`DO_NOT_TRACK` 或 `COMFY_NO_TELEMETRY` 可覆盖配置。CLI 还允许把 cloud 设为默认路由，并能直接调用 Partner 模型和上传本地素材。[comfy-cli Analytics 与 License](https://github.com/Comfy-Org/comfy-cli/blob/main/README.md#analytics)
- **已证实**：官方文档承认部分更新/Manager 错误可能仍返回成功状态，因此安装器不能只看进程退出码，必须做文件、版本、节点导入和依赖 post-condition 验证。
- **推断**：若商业工具不修改 comfy-cli，按固定版本把它作为独立进程调用，比导入其 GPL Python 模块更容易维持清晰组件边界；但是否随闭源安装包分发、如何提供对应源码和 NOTICE 仍须法务决定，不能由“独立进程”四个字自动豁免。
- **推断**：Stable 最安全的用法不是让 CLI 自由安装社区节点，而是仅让它完成被 allowlist 的只读发现或受控 Core 操作；节点归档、wheel、模型仍由本工具签名 manifest 下载和校验。
- **待PoC**：固定版本 comfy-cli 能否在独立配置目录、无用户 token、无 Manager 最新索引、无 C 盘大型写入和无意外外联的条件下满足安装事务，必须实验。

### 最低调用策略

```text
独立、锁定版本的 comfy-cli tool environment
+ 独立 APPDATA/config/cache 根
+ 显式 --workspace=<受管 D 盘绝对路径>
+ 每次显式 --where local（适用命令）
+ COMFY_NO_TELEMETRY=1 + DO_NOT_TRACK=1
+ COMFY_KNOWLEDGE_DISABLE=1
+ 清除 COMFY_API_KEY / HF / CivitAI 等非本次显式需要的 token
+ 命令/参数 allowlist，禁止任意用户附加参数
+ --json 输出 + 退出码 + post-condition 三重验证
+ 下载阶段域名 allowlist，生成阶段不启动 CLI
```

禁止在 Stable 中调用：交互式 `comfy setup`、未指定 workspace 的命令、`--recent`、`update all`、`latest/nightly`、`--where cloud`、`comfy generate`、任意 PR、无固定版本的 node install，以及会直接运行未知节点安装脚本的 `registry-install`。

### P0 实验 RT-COMFY-CLI

| 项目 | 要求 |
|---|---|
| 环境 | 干净 Windows VM；HOME/C 盘可写审计；D 盘受管根；预置一个用户自己的 Comfy 与一个恶意默认 cloud/telemetry 配置 |
| 实验 | 固定 CLI wheel/hash；显式 workspace 本地安装；断网重放；中断下载；依赖冲突；错误节点；恶意 node archive；退出码异常；用户已有默认 workspace/cloud/token |
| 通过门槛 | 只修改受管根与已声明的小型配置/日志；不读取或上传用户 token/素材；不会继承 cloud 默认；无遥测；所有下载命中 allowlist；错误不会假成功；回滚后恢复前态 |
| 许可门 | 明确“系统已有/安装时下载/工具捆绑”三种分发路线；若捆绑，准备 GPL 文本、对应源码/offer、修改说明、NOTICE，由法务签核 |
| 验收证据 | CLI wheel/hash/SBOM、完整命令日志、环境变量红acted清单、Procmon 文件写入报告、网络抓包、失败注入记录、post-condition 报告、法务 ADR |

### 失败回退

1. 若 CLI 无法满足隔离和确定性，基础安装器直接按签名 manifest 获取固定 Comfy release/portable/runtime，不把通用 CLI 放进产品路径。
2. 若只是在节点安装上失败，保留 CLI 作为只读 discovery/diagnostics，节点和 wheel 改由本工具自己的 staging + hash + 原子安装器处理。
3. 若 GPL 捆绑路线不符合商业目标，检测用户已有 comfy-cli 或在安装时明确跳转官方安装；产品不打包其二进制/源码，并保留自有 adapter。

## 6. 小白流程仍包含哪些隐性选择

### 红队结论

- **已证实**：0.3 在首次安装时仍让用户理解“现有实例/独立实例/全新安装”、模型复用、Ref2VA、放大补帧等概念；但 Alpha 又明确不含 Ref2VA、长视频和完整加速认证。这是版本 IA 与小白目标的直接冲突。
- **推断**：“少问用户”不能等于静默替用户接受许可、修改已有 Comfy、扫描整个磁盘、上传/引用私人素材或选择未经认证模型。必须区分产品可以决定的技术默认和必须由用户授权的边界决定。
- **推断**：正常 Alpha 认证路径可收敛为三项内容选择：输入（提示词和/或首尾帧）、时长、画幅；其余由 capability/hardware recipe 决定。只有触发异常时才逐步展开条件式问题。
- **待PoC**：未接触 ComfyUI 的用户是否能在不理解模型、节点、量化、实例和 API graph 的情况下完成首次项目，必须用可用性测试而不是内部评审判断。

### 隐性选择及处理原则

| 隐性选择 | 默认处理 | 何时必须询问 |
|---|---|---|
| 发行地域、H3/AUP 接受 | 安装前显示当前条款和产品支持地域 | 用户未接受、地域不符合或许可版本变化时；不得静默代选 |
| 安装根目录 | 推荐第一个满足空间/NTFS/固定盘条件的非 C 盘路径并展示 | 没有安全 D/其他盘、路径已占用、网络/移动/FAT32 盘时 |
| 使用哪个 Comfy 实例 | 产品默认创建受管 H3 实例并复用已验证模型 | 用户明确选择高级“修改现有实例”，或发现同名受管实例冲突时 |
| 模型复用 | 仅 SHA-256 白名单自动复用 | 哈希未知、来源不明、多份冲突或需要专家 override 时 |
| 扫描范围 | 只扫已知目录；深度扫描默认关闭 | 用户主动授权目录/磁盘时 |
| Driver/重启 | 只诊断并给官方建议 | 驱动不满足认证门槛时；工具不代装驱动 |
| 速度/质量/精度 | 使用已认证 hardware recipe；Alpha 不显示量化名称 | 没有匹配 profile 时只能显示有限支持/不支持，不能猜 |
| API/云端路由 | 强制本地 recipe、清除 workflow Partner 节点 | 不提供云端选项；检测到现有 Partner/custom node 时阻止并解释 |
| 输入模式 | 由实际槽位自动路由 T2V/I2V/L2V/FL2V | 输入组合无定义、首尾画幅冲突或素材损坏时 |
| 提示词为空 | 只在已验证的有效素材组合使用版本化中性 envelope | 无有效素材、Ref 角色不明确或用户要求精确台词但没提供文本/音频时 |
| 画幅与裁切 | 单图时继承输入比例；纯文本默认 16:9；预览裁切 | 首尾图比例不同、参考与目标冲突、关键内容会被裁掉时 |
| 素材复制/引用 | 默认复制到项目或内容寻址资产库 | 空间不足、用户选择只引用外部路径时并解释可迁移风险 |
| 输出位置/覆盖 | 项目内新版本输出，不覆盖 | 外部输出目录、同名覆盖或磁盘不足时 |
| Seed | 默认随机但写入 manifest | 用户开启复现/批量时；不用在首屏显示 |
| H3 原生音频 | Alpha 默认开启 | 明确静音、输入音频冲突或后续 BGM/旁白功能启用时 |
| 公开导出/AI 披露 | 与本地项目工件分开，按合规策略默认 | 用户选择公开导出或需关闭可选品牌水印时；AI 披露不能被品牌水印替代 |

不应询问：故事/产品/口播/MV 类型、节点、连线、采样器、CUDA 版本、量化文件名、VAE、Subgraph、API graph。它们是产品 recipe 或模型对提示词的理解范围，不是小白表单字段。

### P0 实验 RT-NOVICE-CHOICES

| 项目 | 要求 |
|---|---|
| 参与者 | 至少 5 名从未使用 ComfyUI 的 Windows 用户；另 2 名有多个 Comfy 实例的用户做异常路径 |
| 任务 | 全新安装、复用已有模型、纯提示词、纯首帧空提示词、首尾图比例冲突、磁盘不足、未知模型、断网第二次运行 |
| 通过门槛 | 正常路径无需文档完成率 ≥80%；首个项目首屏技术选择不超过 3 类；无人需要理解模型/节点；危险修改 0 次；所有失败均能返回可行动的下一步 |
| 验收证据 | 逐屏录像、点击/决策数、成功率、耗时、中断点、用户原话摘要、修订前后对照、最终普通/高级 IA |

### 失败回退

1. 若三项首屏仍导致失败，Alpha 固定 16:9/10 秒/自动质量，只保留提示词和首帧；时长与画幅移到“更多设置”。
2. 若 existing Desktop 选择造成大部分困惑，普通模式完全取消该问题，永远创建受管实例；现有实例接入移到专家页。
3. Ref2VA、30/60 秒、BGM、补帧和品牌水印在对应 capability 尚未发布时完全隐藏，不以灰色复选框或“即将推出”占据首次安装。

## 7. 未验证前绝不能写成承诺的事实

### 红队结论

- **已证实**：0.3 已把 Desktop 打开方式、运行时路线、硬件档位、加速节点、分发许可和生成阶段抓包列入后续实测/发布门，因此这些在关闭前都不是产品事实。
- **推断**：宣传证据必须按“具体版本 + 具体硬件 + 具体输入模式 + 具体地域/许可 + 明确测试次数”限定；不能从一台开发机外推到“所有 NVIDIA 电脑”。
- **待PoC**：下表每项只有拿到对应证据后才能从受限措辞升级为承诺。

| 禁止提前承诺 | 为什么不能承诺 | 最低证据 | 门关闭前允许措辞 |
|---|---|---|---|
| “自动找到并打开你电脑上的任意 ComfyUI Desktop 项目” | 无公开稳定外部 open contract，多实例/旧版/自定义路径复杂 | RT-DESKTOP-OPEN 全矩阵 | “将生成 workflow；受支持环境可尝试打开，其他环境提供手动打开步骤” |
| “一键安装，适配所有 NVIDIA 显卡” | 未定义首个完整认证 profile，驱动/VRAM/指令集不同 | 每个 SKU/driver/recipe 认证记录 | “首版支持认证列表中的 Windows/NVIDIA 配置” |
| “自动选择最快且质量最好” | 速度、显存、质量和音频有权衡，无单一最优 | 固定基准、成功率和质量回退阈值 | “自动选择已认证的保守配方，可切换预览/最终模式” |
| “完全不写 C 盘” | Desktop、APPDATA、日志、系统临时目录、签名/安装器会有小文件 | Procmon 全安装/运行/卸载报告 | “大型模型、缓存、片段和输出不静默写入 C 盘；少量系统配置/日志位置会明确列出” |
| “整个程序永不联网/绝对无外联” | 下载、更新、Desktop/CLI 统计和未知节点可能联网 | RT-ZERO-EGRESS + 运行时 egress deny | “安装完成后支持断网生成；生成阶段目标是无未声明外联” |
| “禁用 API 节点就绝对隐私” | 不约束 custom node、安装脚本、Desktop/CLI/更新器 | 进程树抓包、负向 egress 测试 | “Partner Nodes 已禁用；Stable 实例还经过节点白名单和网络验证” |
| “全部是 MiniMax 官方模型/官方量化/官方 LoRA” | Comfy-Org 是 repackager；Qwen、LightX2V、第三方贡献链不同 | RT-MODEL-PROVENANCE 逐文件签核 | “基于 MiniMax H3；每个文件展示原创者、重打包/量化发布者和许可” |
| “可在全球商用/不受地域限制” | H3 当前许可存在适用地域、商业和下游条件 | 目标地域法务签核与所需授权 | “仅在已批准地域和条款下提供” |
| “Comfy Desktop 可直接随闭源工具免费打包” | Desktop 双许可和实际组合方式未签核 | 具体发布物许可 ADR | “检测现有 Desktop或引导至官方渠道；是否捆绑待许可确认” |
| “FFmpeg 可自由打包，H.264/AAC 没有其他问题” | 构建选项改变 LGPL/GPL 路线，专利独立存在 | buildconf、源码材料、codec/地域审查 | “最终编码组件和分发方式待发布审查” |
| “30/60 秒一镜到底、人物绝不漂移” | 分段续接是产品执行器能力，质量未认证，计划也不承诺稳定长镜头 | 固定 prompt 集、接缝/身份/音频指标和通过率 | “长视频由多个 H3 窗口组装；60 秒为 Beta，连续性可能变化” |
| “本地原生 2K 与官方 Regenerate-2K 等价” | 官方本地开放和模板当前不是该在线 2K 路线 | 独立模型和许可/质量证据 | “H3 Base 使用认证生成画布；可选本地后处理不等同于 H3 Regenerate-2K” |
| “复用模型绝不会出错” | 文件名不能证明格式、转换链和完整性 | hash/header/load/golden workflow | “只自动复用白名单且完整校验通过的文件” |
| “绝不会影响已有 ComfyUI，卸载绝不丢数据” | 路径合并、junction、shared models 和误标 ownership 仍待破坏性测试 | 新装/升级/回滚/卸载/重解析点矩阵 | “默认创建独立实例；外部文件保持只读，已验证后再承诺保护范围” |
| “用户只放一张图就一定得到满意视频” | 技术可执行不等于审美/语义成功，空提示词只在部分路径验收 | 技术成功率与用户研究分开 | “有效输入可生成可运行 workflow；成片效果受模型、素材和随机性影响” |
| “用户自己的水印已经满足模型归属和 AI 披露” | 三者是不同层级和义务 | 品牌/模型归属/AI 披露三层验收 | “品牌水印可选；MiniMax H3 归属和 AI 披露独立处理” |

### P0 实验 RT-CLAIM-GATE

| 项目 | 要求 |
|---|---|
| Claim registry | 每个官网/安装器/README claim 有 ID、限定条件、证据链接、负责人、到期/重验版本 |
| 自动门 | 发布构建只允许引用状态为 `verified` 且适用当前版本/地域/hardware profile 的 claim；`inferred`/`poc_pending` 不能进入公开文案 |
| 变更触发 | Desktop、Comfy、frontend、CLI、节点、模型、driver、FFmpeg 或许可 revision 变化时，相关 claim 自动失效并重新验收 |
| 通过门槛 | 抽查全部公开绝对化词语（“全部、任何、绝不、完全、最快、官方、一键”）均有对应证据或被改为受限措辞 |
| 验收证据 | `claims.yaml`/等价登记、文案 lint、证据包、版本映射、法务/QA/产品三方发布签核 |

### 失败回退

没有证据时不延期伪造证据，而是缩小 claim：限定硬件、版本、地域、正常路径和支持等级；若仍不能真实说明，则从公开页面删除，仅保留为内部研发目标。

## 建议关闭顺序

1. **RT-DESKTOP-OPEN**：它决定产品是 Desktop adapter 还是自管 runtime，必须最先关闭。
2. **RT-COMFY-CLI**：与运行时拓扑并行，决定是否采用 CLI 及其边界。
3. **RT-MODEL-PROVENANCE**：在任何 40GB 级下载器和公开安装包之前关闭 Alpha 文件表。
4. **RT-WORKFLOW-DUAL**：在 Workflow Compiler 和 Runner 分头实现之前冻结权威源/构建物契约。
5. **RT-ZERO-EGRESS**：先做无模型的恶意节点负向测试，再用最小 H3 golden run 做最终验收。
6. **RT-NOVICE-CHOICES**：使用真实 Alpha 原型验证普通/高级 IA。
7. **RT-CLAIM-GATE**：作为每次发布的持续门，而不是一次性文档检查。

任何一项失败都不应迫使团队“把实验写成已支持”；应采用对应降级路径，并同步缩小 Definition of Done 和公开文案。

## 官方一手资料索引

- [Comfy Desktop Windows：多实例、数据位置、旧版迁移与卸载边界](https://docs.comfy.org/installation/desktop/windows)
- [Comfy-Desktop 官方仓库与许可证](https://github.com/Comfy-Org/Comfy-Desktop)
- [ComfyUI workflow 的官方手动打开方式](https://docs.comfy.org/get_started/first_generation)
- [comfy-cli 官方 README：workspace、安装、运行、云路由、节点脚本、分析和 GPL](https://github.com/Comfy-Org/comfy-cli/blob/main/README.md)
- [ComfyUI Partner Nodes 与 `--disable-api-nodes`](https://docs.comfy.org/tutorials/partner-nodes/overview)
- [MiniMax H3 官方模型卡](https://huggingface.co/MiniMaxAI/MiniMax-H3)
- [MiniMax H3 Community License](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE)
- [ComfyUI MiniMax H3 官方教程与当前推荐文件](https://docs.comfy.org/tutorials/video/minimax/minimax-h3)
- [Comfy-Org MiniMax-H3 重打包仓库](https://huggingface.co/Comfy-Org/MiniMax-H3)
- [LightX2V MiniMax-H3 Turbo](https://huggingface.co/lightx2v/Minimax-h3-Turbo)
- [Qwen3-VL-32B-Instruct 官方仓库](https://huggingface.co/Qwen/Qwen3-VL-32B-Instruct)
