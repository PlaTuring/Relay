# MiniMax H3 Control Plane 全软件交叉审查与抖音市场研究

审查日期：2026-08-28  
审查对象：`0.1.0-alpha.12` 及当前工作区源码  
结论等级：内部 Alpha，可继续开发；当前不满足面向普通客户公开销售与分发的条件。

## 1. 结论先行

软件的核心方向成立：它不是视频生成器，而是 MiniMax H3 的本地安装、复用、配置、工作流编译与 ComfyUI 交接工具。正式视频和原生音频仍由 MiniMax H3 在 ComfyUI 中、由用户检查后点击 Run 生成。

现有基础并不差：自动化测试、类型检查、构建和依赖漏洞检查都通过；模型下载已具备固定 revision、长度、SHA-256、断点续传、备用源和复用校验；30/60 秒工作流能按 5/10/15 秒正确拆成不同的分段提示词；没有第三方推理 API，也没有自动提交 ComfyUI `/prompt`。

但当前仍有四类不可绕过的问题：

1. **商业发布阻断**：许可确认被程序直接写成 `true`，成品缺少 MiniMax H3 LICENSE/NOTICE，Setup 与 Portable 均未签名，外部分发 Gate 未关闭。
2. **ComfyUI 身份与生命周期缺陷**：固定连接 `127.0.0.1:8188`，没有证明端口上的实例就是用户配置的 ComfyUI；重启后受管启动上下文丢失；工具启动的后端没有可靠退出路径。
3. **并发和恢复缺陷**：同一安装根可并发写 manifest；安装中重新扫描会丢失活动事务；配置并发保存会互相删除临时文件；断点续传的磁盘预检仍按完整文件计算。
4. **小白输入与诊断缺口**：伪图片、零宽提示词、弱 Comfy 根验证、`.venv` PyAV 漏检、长中文提示词限制不一致，都会把错误延迟到 ComfyUI 或表现成“明明装了却未安装”。

市场同样成立，但竞争已经从“能不能装”进入“能不能稳定装对、按硬件选对、出错后能不能自己恢复”。因此最有价值的定位不是“另一个整合包”，而是：

> **MiniMax H3 本地部署控制台：官方身份可验证、国内下载可恢复、复用已有环境、按硬件选择认证配方，并生成经过验证的可编辑 ComfyUI 工作流。**

## 2. 审查范围与证据

本轮由主审和三个独立方向交叉完成：全软件静态/动态审查、小白异常输入与 E2E fuzz、抖音/B站需求与竞品交叉研究。

明确没有进行的行为：

- 没有运行 MiniMax H3；
- 没有提交 ComfyUI `/prompt` 或自动点击 Run；
- 没有生成视频、音频或其他媒体；
- 没有下载几十 GB 模型；
- 没有登录、点赞、评论、私信或抓取非公开平台数据。

### 2.1 自动化与构建结果

| 检查 | 结果 |
|---|---:|
| `packages/local-runtime` | 47/47 通过 |
| `packages/workflow/h3-compiler` | 54/54 通过 |
| `apps/control-plane` | 57/57 通过 |
| Control Plane typecheck | 3/3 通过 |
| Control Plane build | 通过 |
| Product smoke | 通过，`media_generated=0`、`prompt_submitted=0` |
| `npm audit`（399 个开发/可选依赖范围） | 0 已知漏洞 |
| Setup/Portable SHA-256 | 与 `SHA256SUMS.txt` 一致 |
| Authenticode | 两个 EXE 均为 `NotSigned` |
| Offline reproducibility gate | 失败：`BUILD_INPUT.FILE_SET_MISMATCH` |

离线清单失败不是误报。当前实际输入比 `build/input-inventory.json` 多 14 个文件，包括新的 prompt preflight、workflow title、component policy 及多项测试。这说明代码可以构建，但当前“构建输入已封存、可复现”的声明已经失效。

## 3. 缺陷与发布风险

### 3.1 P0：公开发行前必须关闭

#### P0-01 用户授权被程序自动代填

执行阶段在 [ab-cli-adapter.ts](../../apps/control-plane/src/main/services/ab-cli-adapter.ts) 中固定写入：

```text
licenseAccepted = true
territoryAcknowledged = true
commercialAcknowledged = true
downloadConsent = true
```

用户没有作出对应动作也会被记作已确认。这既是软件审计缺陷，也是商业发行风险。

MiniMax H3 当前官方许可要求：分发时提供 Agreement；非 Hosted 分发需附精确 NOTICE；商业 UI 显著显示 MiniMax H3；在让用户使用相关产品前，使用户受至少同等保护的可执行使用条款约束。官方许可还定义了排除地区和收入超过 2,000 万美元时的单独授权要求。详见 [MiniMax H3 官方许可证](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE)。

建议不是恢复三个繁琐复选框，而是做一次简洁、可审计的首次使用确认：

- 一个主确认：“我已阅读并接受 MiniMax H3 使用条款，开始下载”；
- 显示官方 Agreement、适用地域说明、将下载的组件；
- 保存许可证 revision/hash、时间、应用版本和用户动作；
- 下载同意与法律资格不要由程序静默代判；
- 具体商用文案交由法务确认，本报告不构成法律意见。

#### P0-02 成品缺少 H3 分发材料，外部 Gate 未关闭

`release-alpha12/win-unpacked` 只发现 Electron/Chromium 自带许可证，没有 MiniMax H3 的 LICENSE、NOTICE、完整第三方声明或成品 SBOM。`docs/EXTERNAL_GATES.md` 中 H3、ComfyUI、FFmpeg、Desktop 再分发及签名仍处于 OPEN。

公开销售前至少需要：

- H3 Agreement 与精确 NOTICE；
- ComfyUI/Core/Frontend/Desktop 的再分发结论和对应材料；
- FFmpeg 构建的 GPL/源码提供方式与 NOTICE；
- 成品 SBOM、源代码/许可证入口和“关于”页面；
- 法务对目标销售地域、商用条款和用户条款的正式确认。

#### P0-03 Windows 成品未签名

Setup 与 Portable 哈希正确，但 Authenticode 都是 `NotSigned`；`forceCodeSigning` 也是 `false`。这对中国普通 Windows 用户会直接转化为 SmartScreen、杀软拦截、安装信任和售后问题。

公开发行需要组织代码签名证书、RFC3161 时间戳，并在干净 Windows VM 上验证安装器、便携版、卸载器和辅助进程。

#### P0-04 构建输入清单漂移

`npm run verify:offline` 当前稳定失败：`BUILD_INPUT.FILE_SET_MISMATCH`。14 个新文件没有进入输入清单。发布流程应在合并后刷新清单、重新执行 offline gate，并把该命令放进 CI；不能仅因为普通 build 通过就发布。

### 3.2 P1：会直接制造客户故障或数据状态不一致

#### P1-01 固定 8188 可能把图交给错误的 ComfyUI

[comfy-handoff.ts](../../apps/control-plane/src/main/services/comfy-handoff.ts) 固定连接 `http://127.0.0.1:8188/`，只验证前端有 `app/loadGraphData` 等通用能力，没有绑定 PID、根目录、模型目录、ComfyUI/Frontend 版本、节点 schema 或所需模型清单。

如果 ComfyUI B 已占用 8188，而用户配置的是 A，工作流会进入 B。典型表现就是“文件明明存在，ComfyUI 却说缺模型/缺节点”。

修复要求：

- 受管实例使用独占动态 loopback 端口；
- 记录并校验 PID、进程启动时间、根目录、启动参数、版本和随机会话标识；
- 加载前读取 `/object_info`，核对锁定 `class_type` 与输入 schema fingerprint；
- 核对工作流引用的模型名；
- 不匹配时只导出 JSON，绝不加载到未知实例，也不结束未知进程。

#### P1-02 软件重启后受管启动上下文丢失

UI 会恢复 saved setup，但 `latestLaunchContext` 只存在内存。重新启动工具后，如果 8188 没有现成 ComfyUI，`launchManagedComfy()` 会直接返回 false；Ref2VA/Turbo 就绪判断也可能与 UI 显示不一致。

应从经过验证的完成事务和 `launch_plan` 重建 adapter 状态，并让 UI、服务层、adapter 共享同一能力真相。

#### P1-03 工具启动的 ComfyUI 后端没有可靠退出

当前只持有 child handle 并监听自然退出，应用退出没有 process-tree teardown。这能解释“窗口关了但端口/显存仍被占用，只能任务管理器结束”。

需要显式“停止由本工具启动的 ComfyUI”，优先温和关闭，超时后仅终止本工具拥有且身份匹配的进程树。用户自己启动的外部 ComfyUI 绝不能被关闭。

#### P1-04 同一安装根并发事务会丢资产清单

动态无网络测试中，同一临时安装根并发安装两个小组件，30 次有 16 次最终 manifest 只保留一个条目，但两个调用都返回完成。根因是锁按 operation ID，而 manifest 和 YAML 是同一个安装根共享的 read-modify-write 资源。

必须改为安装根粒度唯一写锁，把 manifest/YAML 合并与原子替换放在同一事务内，并使用 Electron 单实例锁。

#### P1-05 安装中重新扫描会让活动事务从 UI 消失

安装期间扫描与路径入口未完全禁用；重新扫描会清空 renderer 和服务层的活动安装 ID，但后台下载仍可能继续。用户失去查询和取消入口，还可能再启动第二个事务，进一步触发 P1-04。

服务层应在 `running/cancel_pending` 时拒绝扫描；UI 暂停路径、扫描、导航和重新准备；活动事务必须保留到真实终态。

#### P1-06 setup 配置并发保存会互相删除临时文件

`saveSetupPreferences()` 对同一进程始终使用同一个 `${destination}.${pid}.new`，没有 mutex、队列或 CAS。

动态结果：

- 100 轮双写：两次都成功 0 轮；仅一次成功 2 轮；两次都失败 98 轮；最终 JSON 可读仅 1 轮。
- 20 路并发：0 成功、20 失败、无最终文件。

正常用户快速切页即可触发重复扫描并进入并发写。需要 renderer single-flight、主进程写队列/互斥、每次唯一 temp，以及 Windows rename/杀软占用的有界重试。

#### P1-07 断点续传的磁盘预检仍按完整文件计算

动态测试中，100 字节文件已有可信 60 字节 partial，只需再下 40；剩余空间 50 字节时仍被按 100 字节判定空间不足。映射到 20GB 模型后，会出现“明明剩余空间足以续传，却不让继续”。

预检必须先验证 partial sidecar、URL/hash/长度身份，再扣除可信 partial；解压临时空间应单独计算并在阶段切换时复查。

#### P1-08 “安装 ComfyUI Desktop”实际只是下载安装器

目录中的 Desktop 策略是 `download_verify_user_launch_only`：下载并验证官方安装 EXE，但不会安装或启动。若 UI 把它显示成“已安装”，小白会误解。

在真正的一键安装 Gate 关闭前，应改称“下载官方 ComfyUI Desktop 安装程序”，完成后提供“打开所在文件夹/启动安装程序”，并明确用户仍需完成官方安装。

#### P1-09 图片只按扩展名校验

普通文本改名为 `.png` 会被复制进 ComfyUI input 并成功编译，直到 LoadImage 节点才报错。应做有界 magic、解码、宽高和总像素验证；先放事务临时目录，编译成功后再提交 staging，失败时清理本次新文件。

#### P1-10 视觉空白的零宽提示词可通过

两个 U+200B 能通过 UI、IPC 和编译器的 `.trim()` 检查，生成空内容工作流。应在保留 emoji 合法 ZWJ 的前提下，剔除空白和 default-ignorable/format 字符后确认仍有可见文本。

#### P1-11 Comfy 根与 PyAV topology 判定失衡

仅有空壳 `main.py`、`comfy/cli_args.py` 和 `input/` 的假目录就能作为 Comfy 根通过；反过来，正常 git clone + `.venv/Lib/site-packages/av` 又不会被识别，因为只探测 embedded Python。

应明确支持 portable、`.venv`、用户指定解释器三种 topology；静态 marker 只能表示 `found`，版本、节点能力和解释器验证后才能表示 `compatible/approved`。

### 3.3 P2：质量、兼容性与工程治理

- 官方结构提示词生成文件名仍可能是 `integratedmultimodaldesc...`，应本地解析第一个 Shot 的视觉描述取名；不需要 API。
- UI 限制 4000 UTF-16 字符，编译器允许 32KB UTF-8；详细中文长视频提示词会被 UI 过早拒绝，应共享字节级上限。
- 中文 IME 全角官方字段仍可能被拒绝；UI 与编译器应共用同一个规范化/parser 合约。
- 控制层 Windows 路径校验弱于底层，对盘符根、ADS、设备名和尾部点/空格会先给出含糊错误。
- 一次安装状态查询异常会停止轮询并误报“安装失败”，即使后台事务最后成功；应退避重试并区分“查询失败”和“事务失败”。
- 项目提示词、模式、时长、画布、分辨率和高级选项没有草稿恢复。
- PID 锁缺少进程启动时间/身份和 heartbeat，存在低概率 PID 复用风险。
- 根 `package.json` 仍是 `0.0.0-alpha.0`，应用是 `0.1.0-alpha.12`；仓库尚无任何 git commit，也没有 CI workflow，发布追溯性不足。

## 4. 已确认正常的核心能力

- T2V、FL2VA、Ref2VA 的中英文官方字段与 5/10/15 秒分段主路径通过现有测试。
- 30 秒中文官方结构提示词动态得到 6 个不同的 5 秒提示词；60 秒矩阵同样通过。
- 每段视觉内容不同，后续段含本地连续性前缀；当前不存在“所有分段都复制整段视觉提示词”的回归。
- Comfy handoff 的重复加载、旧文档恢复、重叠请求串行、renderer crash、脏工作流保护等 headless 测试通过。
- 工作流交接代码不提交队列、不点击 Run。
- 下载层有固定长度、SHA-256、重定向 allowlist、Range 续传、取消恢复、备用源和原子写入。
- 当前机器扫描约 0.8 秒，当前版本未复现早期“扫描卡十几秒”。
- 下层目录安全覆盖 UNC、设备路径、目录穿越、reparse point、hardlink 和工作流库哈希校验。
- 模型、ComfyUI portable、FFmpeg 使用固定 revision/长度/SHA；Desktop mutable URL 的字节身份不一致会 fail closed。

## 5. 下载源与中国网络结论

当前 H3 模型下载策略是：

1. ModelScope 锁定 revision 作为国内优先候选；
2. Hugging Face 的 Comfy-Org/MiniMax-H3 锁定 revision 作为 fallback；
3. 两者最终必须匹配同一个固定长度和 SHA-256。

因此 ModelScope 即使作为镜像，其字节身份仍与锁定的上游对象一致。这一部分设计正确。

但并非所有组件都来自“中国可稳定访问的官方源”：

- ComfyUI portable：GitHub Release；
- FFmpeg：BtbN GitHub Release。BtbN 是 FFmpeg 官方下载页列出的 Windows 构建提供者之一，但不是 `ffmpeg.org` 直接托管；
- ComfyUI Desktop：官方 `download.comfy.org` 导向的 ToDesktop/CDN 安装器；
- H3 模型：ModelScope mirror + Hugging Face 上游，双源固定身份。

当前机器探测这些地址可达，只能证明本机网络；不能代表中国电信/联通/移动和不同地区。正式发布需要：

- 多运营商/多地区定时探测；
- 当前源、备用源、速度、重试和断点状态可见；
- ComfyUI/FFmpeg/Desktop 增加经授权且固定哈希的国内镜像，或允许用户手动导入离线包；
- 镜像必须保持不可变 revision、长度和 SHA，绝不能退化到 `latest`；
- 网络错误给出 DNS/TLS/403/超时/磁盘/哈希不一致的中文分类，而不是统一 `LOCAL_RUNTIME.INTERNAL`。

## 6. 抖音需求研究

### 6.1 样本

截至 2026-08-28，合并 7 组抖音关键词并按视频 URL 去重，共观察 124 个公开结果。命中是内容供给与关注方向信号，不能等同用户规模或平台市场占比；搜索卡片数字也只作为页面可见热度，不擅自解释成播放量。

| 需求方向 | 命中 |
|---|---:|
| 安装、部署、配置、新手 | 71/124 |
| 工作流、节点、插件、导演台 | 52/124 |
| 显存、硬件、速度 | 33/124 |
| 提示词与小白化操作 | 25/124 |
| 首尾帧、参考素材、多模式 | 17/124 |
| 长视频、分段、续接 | 10/124 |
| 放大、修脸、质量修复 | 10/124 |

### 6.2 公开评论反复出现的具体问题

#### 安装与环境

- “求整合包/安装包”“新手适合吗”“模型到底放哪个目录”；
- 希望根据缺失模型提示直接定位到正确目录；
- 下载中断、模型重复下载、机械盘/SSD 空间不知道怎么分配；
- 命令行“请按任意键继续”不知道怎么办。

代表内容：[H3 本地部署](https://www.douyin.com/video/7671186919849577769)、[零基础安装到出片](https://www.douyin.com/video/7674168141374704948)、[模型下载位置](https://www.douyin.com/video/7659614124690787626)。

#### 硬件、速度与成本

- 5060 8GB 不知道选 FP8、INT8 还是 Turbo；
- 4090/32GB 也有人遇到内存占满、GPU 波动、进度 0% 后失败；
- 双 5090 在更长片段仍可能连接断开或设备消失；
- 用户最关心“要跑多久、要多少显存/内存/虚拟内存、花多少电费或云算力”。

代表内容：[不同硬件完整测试](https://www.douyin.com/video/7670875269384736052)、[8GB 参数方案](https://www.douyin.com/video/7674653171659029609)、[6GB 方案](https://www.douyin.com/video/7671938254074598394)。

#### 长视频与一致性

- “最长是不是 10/15 秒”“30 秒怎么直接做”；
- 关注上一段尾帧作为下一段首帧、每段提示词怎么写；
- 人物变脸、服装变化、尾帧过曝会污染后续分段；
- 本地两分钟可能需要数小时，希望能过夜运行、失败恢复。

代表内容：[突破 15 秒分段](https://www.douyin.com/video/7672450773053197614)、[首尾帧长视频一致性](https://www.douyin.com/video/7678003860161514815)、[8GB 约两分钟案例](https://www.douyin.com/video/7675438725568023854)。

#### 工作流、提示词和参考资产

- 希望输入一个目标就得到可编辑工作流，而不是自己连线；
- 希望三种模式一直可见，未安装时告诉缺什么而不是隐藏；
- 需要人物、场景、道具和参考图的项目化管理；
- 需要把已有时间戳/镜头提示词稳定拆段，不希望程序偷偷改写创意。

代表内容：[H3 导演台](https://www.douyin.com/video/7678674016923618566)、[官方式多模态提示词与三模式](https://www.douyin.com/video/7670533685464108322)、[工作流/节点报错](https://www.douyin.com/video/7666330284556170687)。

### 6.3 竞品

主要竞品形态不是单一软件：

1. 秋叶/Aki 等通用 ComfyUI 整合包；
2. H3 懒人包和一键 WebUI；
3. H3 Director 类自定义节点；
4. RunningHub 等云工作流；
5. 教程、社群、远程安装和算力推广。

[B站 MiniMax H3 ComfyUI 搜索](https://search.bilibili.com/all?keyword=MiniMax%20H3%20ComfyUI)还显示 8GB 懒人包、长视频导演节点、加速节点、放大/修脸等大量供给。对同一 SageAttention/H3 Cache，社区存在“推荐”和“不推荐”的相反测试结论。这说明软件不能按热度盲装节点，必须按硬件、固定版本、实测 recipe 和回退能力管理。

## 7. 产品应该集中增加什么

不要把所有需求堆成更多页面。建议收敛为三个中心：

### 7.1 环境中心

- 一眼显示 GPU/显存、RAM、虚拟内存、驱动、空闲空间、SSD/HDD、ComfyUI/Frontend/Python/PyAV 版本；
- `found → verified → compatible → selected` 四级状态，避免“看见文件就叫已安装”；
- 国内源测速、换源、暂停/续传、离线包导入、重复模型去重；
- 8/12/16/24/32GB 认证配方，不支持的机器明确说明原因；
- 模型/节点来源、revision、大小、SHA、官方/社区、稳定/实验状态；
- 中文诊断中心与可导出的脱敏支持包。

### 7.2 工作流工作台

- T2V、FL2VA、Ref2VA 永远显示；缺包时直接显示体积和安装入口；
- 总时长、片段时长、画布比例、MP/分辨率独立；
- 编译前展示每段时间、提示词、首尾帧依赖和最终节点数量；
- 对用户已有结构做确定性分段，显示 diff，绝不静默创作或改写；
- 用户提供的人物/场景/道具/参考资产库及一致性绑定；
- 本地草稿、历史版本、最近工作流、可读的本地文件名；
- 最终仍只是导出/打开可编辑工作流，由用户在 ComfyUI 点击 Run。

### 7.3 配方与诊断中心

- Draft / Preview / Final 三档，用显存、RAM、分辨率、模型精度、Turbo 和本机微基准给出 ETA 区间；
- OOM、设备丢失、进度 0%、节点缺失、模型路径、端口错绑、磁盘不足、网络/哈希失败的中文诊断；
- Turbo/Cache/Attention 节点只来自 allowlist，固定 commit/SHA，显示适用显卡与已测版本；
- A/B 微基准后再推荐，不宣称固定百分比提速；
- 一键回滚节点、模型和 ComfyUI 版本；
- 可选放大、修脸、二次采样配方必须独立安装、清晰标为社区/实验，仍不自动运行。

## 8. 优先实施顺序

### Sprint 0：先把 Alpha 变成可信 Beta

1. 授权状态、LICENSE/NOTICE/SBOM、外部分发 Gate；
2. Authenticode 签名与干净 VM 安装/升级/卸载；
3. ComfyUI 实例身份、动态端口、重启恢复和 owned-process teardown；
4. 安装根锁、安装中扫描防护、偏好写队列；
5. partial-aware 磁盘预检、状态查询退避；
6. 图片/提示词/路径/parser 输入硬化；
7. 修复 offline inventory，建立首次 git 基线与 CI。

### Sprint 1：实现真正的市场差异化

1. 硬件认证配方与本机微基准 ETA；
2. 国内下载中心和离线包；
3. `/object_info` 工作流兼容诊断；
4. 长视频分段预览、尾帧风险和逐段重编译；
5. 项目资产库、草稿与历史；
6. allowlist 加速配方与回滚。

### Sprint 2：工作室能力

- 局域网共享模型仓库和跨机器去重；
- 项目导出包、环境清单和多机部署报告；
- 经验证的放大/修脸/二次采样工作流配方；
- 纯本地支持包与长期性能历史。

## 9. 明确不要做的事情

- 不接第三方推理 API，不把用户素材上传云端；
- 不在本软件中生成视频；
- 不自动提交 ComfyUI 正式队列或替用户点击 Run；
- 不根据“社区呼声最高”盲装 Manager 节点；
- 不自动扩写故事、判断内容类型或偷偷改写用户提示词；
- 不承诺某张显卡必然能跑，也不宣传未经实测的固定提速百分比；
- 不把模型文件本身作为收费商品。

如未来确实要扩展云端、自动队列或创意生成，应另立产品范围和许可/隐私审查，不能悄悄混入当前本地控制台。

## 10. 商业判断

市场有需求，但单独的“安装器”付费空间有限，因为免费整合包很多。真正可收费的价值是：

- 签名且可验证的稳定版本；
- 持续更新的硬件认证配方；
- 国内可靠下载、断点恢复与离线包；
- 一键诊断/修复和优先售后；
- 工作室的局域网模型去重、多机部署与项目迁移。

可考虑“免费基础版 + 一次性个人专业版或年度维护”；工作室版按部署/支持能力收费。不要出售本就受上游许可约束的模型文件，卖的是可靠性、兼容性、验证和节省的时间。

## 11. 最终判断

这个工具值得继续做，而且定位已经比单纯 H3 懒人包更有长期价值。当前最重要的不是增加十个新功能，而是先修复实例身份、并发事务、持久化和发行合规。把这些 P0/P1 关闭后，再加入硬件认证、国内下载、诊断中心和分段预览，才会形成真正面向中国小白用户、能减少售后的产品闭环。
