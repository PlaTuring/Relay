# Alpha Capability Matrix

> Task：`P0-GOV-001`  
> Owner：Root Integration / Product Contract Owner  
> 状态：Phase 0 初始基线  
> 适用范围：Alpha-0 内部垂直切片、Alpha-1 受控外测、1.0 目标  
> 重要：本表中的“阶段目标”是进入该阶段的门槛，不是当前产品承诺。当前没有实现证据的能力一律保持 `poc_pending` 或 `hidden`。

## 1. 不可越界的产品定义

本工具只负责 Windows 环境检测、安装、模型验证与复用、配置、项目与 workflow 编译、启动/打开受管 ComfyUI，以及确定性技术验证。实际视频和原生声音只能由 MiniMax H3 在 ComfyUI 内、用户点击 **Run** 后生成。

任何阶段均禁止：

- 工具界面提供“生成视频”或自动提交用户第一笔正式 ComfyUI Queue；
- 内置替代推理后端、云/Partner 推理 API 或隐藏上传；
- 提示词扩写、故事/分镜、内容类型判断或音乐生成；
- 把 PoC、推断、社区呼声或单机偶然成功写成 Stable/Certified 承诺。

## 2. Capability 状态词典

| 状态 | 精确定义 | 用户可见性 | 允许进入的产品文案 |
|---|---|---|---|
| `hidden` | 当前阶段不提供，不参与下载、空间估算或工作流编译 | 普通/高级界面均隐藏 | 不得宣传为可用或“即将自动启用” |
| `poc_pending` | 假设尚未由锁定版本 PoC 重复证明 | 仅开发诊断页可见 | 只能写“正在验证”，不得进入安装摘要 |
| `internal` | 已在一个明确内部 profile 上重复通过，但未完成外测、许可或发布门 | 内部构建可见；外部构建隐藏 | 只能用于内部技术验证，不得公开承诺 |
| `certified` | 技术验收、隐私、安全、许可和发布 gates 对适用版本/profile 全部关闭 | Stable 默认或正常用户路径可见 | 只能按认证版本、硬件和地域作受限承诺 |
| `experimental` | 有实测证据但未达到 Stable 门槛；风险和回退已明确 | 仅高级入口，默认关闭 | 必须写版本/profile限制和已知失败，不得叫“自动稳定” |

### 状态迁移规则

```text
hidden → poc_pending → internal → certified
                     ↘ experimental → certified
```

- `poc_pending` 不得直接变为 `certified`。
- `internal` 只有在适用的 Human/External gates 关闭后才能变为 `certified`。
- 上游 Comfy/backend/frontend、模型、runtime、driver、FFmpeg、许可或 workflow schema 变化时，受影响能力至少退回 `poc_pending`。
- 失败回退不是“继续用旧状态名称”，而是隐藏 capability、恢复保守 recipe 或缩小支持 profile。

## 3. 阶段定义

### Alpha-0：内部最小垂直切片

固定范围：

```text
managed Core
+ Windows/NVIDIA 一个真实可测 profile
+ 一个本地固定 NTFS 受管根
+ 5 秒 T2VA
+ H3 原生声音
+ 用户在 ComfyUI 点击 Run
+ 无自更新
+ 无 Ref2VA
+ 无 16–60 秒长视频
+ 无 Turbo/Sage/社区加速
+ 无 BGM/旁白、放大补帧和品牌水印
```

Alpha-0 只供内部技术验证，不得向外部用户发行。达到 `internal` 才算完成；`poc_pending` 不能算“基本完成”。

### Alpha-1：许可地域内受控外测

在 Alpha-0 基础上，目标支持一个明确认证矩阵内的 Windows/NVIDIA 范围、T2VA/I2VA/L2VA/FL2VA、4–15 秒帧网格、纯首帧空提示词、模型安全复用、断网生成和已签名安装包。所有对外能力必须是 `certified`，或在高级页明确为 `experimental`。

Alpha-1 仍无应用内自更新、Ref2VA、30/60 秒、社区加速、BGM/旁白、放大补帧和品牌水印。

### 1.0：公开发布目标

1.0 可以在独立 gate 关闭后增加 Ref2VA、30 秒 Stable 候选、60 秒 Beta、后期音频、加速 recipe、更新系统和品牌扩展。未来目标不自动继承 `certified`；每个 capability 仍需单独证据。

## 4. 技术 Gate 索引

| Gate ID | Gate | 关闭证据 | 失败结果 |
|---|---|---|---|
| `TG-SCOPE-001` | Alpha scope 与 runtime topology | ADR 明确 managed Core、单根、无更新/第三方节点；普通用户不选运行时 | 停止 UI/installer 并行实现 |
| `TG-HW-001` | 首个硬件 profile | 真实 GPU、VRAM、driver、OS、runtime、模型精度和资源峰值记录 | capability 保持 `poc_pending`；其他 GPU `hidden` |
| `TG-RUNTIME-001` | Managed Core runtime | 最终 generation 路径构建、锁定 Comfy/frontend、Manager关闭、loopback启动、重启重复通过 | 不激活 generation；隔离残留并重试 |
| `TG-DISK-001` | 单 NTFS 根与 C 盘预算 | D/用户选定根安装、下载、TEMP、输出 I/O 记录；C 盘只有已披露小型设置/日志 | 阻止公开文案；根不合格时要求改选 |
| `TG-MODEL-001` | Alpha 基础模型清单 | FL2VA、text encoder、video/audio VAE 的 immutable source、revision、size、SHA-256、header与许可链 | 不复用/不加载；损坏文件只报告不删除 |
| `TG-DOWNLOAD-001` | 安全下载与恢复 | 固定 URL/length/hash、partial、基本 Range/ETag、损坏/中断/盘满测试 | 保留已验证旧文件；重新下载 owned partial |
| `TG-WF-T2VA-001` | 5 秒 T2VA workflow | 锁定 workflow、object-info/schema fingerprint、模型非空、用户点击 Run 后得到带声 MP4 | 回退到 golden workflow；禁止项目交接 |
| `TG-HANDOFF-001` | ComfyUI 交接 | 打开本工具拥有的 loopback实例；不自动提交正式 Queue；错误端口/第二实例测试 | 显示手动打开本地 workflow，不误连其他实例 |
| `TG-FFMPEG-001` | MP4/FFmpeg 路线 | 记录实际输出节点、是否调用 FFmpeg、codec、ffprobe需求与二进制来源 | 若 Core 原生路线足够则不安装私有 FFmpeg；否则阻止外测直到许可门关闭 |
| `TG-OFFLINE-001` | 断网与无未声明外联 | 断网二次运行成功；联网抓包非 loopback egress 为0；`--disable-api-nodes`与节点 allowlist生效 | 只保留内部诊断；未知节点或外联 fail closed |
| `TG-UX-001` | 普通用户 Alpha IA | 安装首屏不出现 runtime/model精度/节点选择；任务测试记录 | 收窄到固定时长/画幅；高级能力隐藏 |
| `TG-WF-BASE-002` | Alpha-1 基础模式 | T2VA/I2VA/L2VA/FL2VA 的 5/10/15 秒非空文本 golden matrix；4 秒、空提示词和严格端点分别出独立能力报告 | 未通过的输入/时长/端点组合单独隐藏，不整体冒充支持 |
| `TG-DESKTOP-001` | Desktop 自动打开 PoC | 指定 installation ID、冷/热启动、未保存画布、多实例、版本漂移，不依赖坐标自动化 | capability保持 `poc_pending`；只读检测+手动导出 |
| `TG-UPDATE-001` | 1.0 更新系统 | 防回滚/冻结、过期、通道隔离、密钥轮换/吊销、N-1回滚 | 无应用内更新；继续手动安装签名版本 |
| `TG-REF-001` | Ref2VA | 逐文件 provenance、输入限制、golden workflows、资源和许可 | capability `hidden` |
| `TG-LONG-001` | 30/60秒 runner | 固定 runner、逐段原子保存、恢复、精确时长、A/V、通过率 | 30秒保持`experimental`或`hidden`；60秒`hidden` |
| `TG-ACCEL-001` | 加速 recipe | 每个 GPU/runtime/node/LoRA 分别验证速度、VRAM、视频与音频完整性 | 回退原生保守 recipe |
| `TG-BRAND-001` | 品牌水印 | 资产、位置/安全区、导出、关闭回退、与AI披露独立性 | 水印 `hidden`；不影响 H3归属和AI披露 |

Human/External gates 见 [`docs/EXTERNAL_GATES.md`](../EXTERNAL_GATES.md)。

## 5. 可执行 Capability Matrix

表中阶段列是该阶段完成时的**目标状态**；“当前状态”是本任务建立基线时的真实状态。

### 5.1 安装、runtime 与模型

| ID | Capability | 当前 | Alpha-0目标 | Alpha-1目标 | 1.0目标 | 普通用户界面 | 依赖 gate | 必需证据 | 失败降级 |
|---|---|---|---|---|---|---|---|---|---|
| `CAP-RT-CORE` | 受管 ComfyUI Core runtime | `poc_pending` | `internal` | `certified` | `certified` | 只显示“独立 H3 环境（推荐）”，不显示 Core/Python/CUDA术语 | TG-SCOPE-001, TG-RUNTIME-001, EXT-COMFY-CORE, EXT-COMFY-FRONTEND | 最终目录、版本/hash、启动/重启、许可证据 | 不激活；环境状态显示失败并可重试 |
| `CAP-HW-ONE` | 单一 Windows/NVIDIA profile | `poc_pending` | `internal` | `certified` | `certified`（仅已列 profile） | 只读显示“已认证/不支持”和原因 | TG-HW-001, EXT-HARDWARE | GPU/driver/VRAM/OS/recipe与5秒峰值 | 未知GPU不猜配方，显示不支持 |
| `CAP-DISK-ONE` | 一个本地固定 NTFS 受管根 | `poc_pending` | `internal` | `certified` | `certified` | 可见一个安装位置；默认合格非C盘，允许修改 | TG-DISK-001 | 文件系统、空间、安装峰值、I/O trace | D不存在时推荐其他合格盘；不静默落C |
| `CAP-MULTI-VOLUME` | runtime/model/cache/output 多卷 | `hidden` | `hidden` | `hidden` | `poc_pending` | 不显示 | 未来多卷ADR | 跨卷空间、事务和恢复矩阵 | 继续使用单根 |
| `CAP-MODEL-BASE` | FL2VA + encoder + 双VAE基础包 | `poc_pending` | `internal` | `certified` | `certified` | 锁定必需组件，显示用途/来源/新增空间，不可取消 | TG-MODEL-001, EXT-H3-LICENSE | 每文件source/revision/hash/header/license与load test | 缺失/漂移即阻止workflow |
| `CAP-MODEL-REUSE` | 发现并复用已验证基础模型 | `poc_pending` | `internal` | `certified` | `certified` | 摘要“找到并将复用X项”；冲突时才询问 | TG-MODEL-001 | found→approved状态、只读、hash、外部所有权 | 不复用；下载缺失文件；不移动/删除外部模型 |
| `CAP-DEEP-SCAN` | 全盘/HF-Xet深度扫描 | `hidden` | `hidden` | `hidden` | `experimental` | 仅高级页、明确授权 | 后续scanner gate | 性能、取消、隐私、cache失效 | known roots + 手动选择目录 |
| `CAP-DOWNLOAD` | 缺失组件下载、校验和续传 | `poc_pending` | `internal` | `certified` | `certified` | 显示下载量、峰值、进度、暂停/继续 | TG-DOWNLOAD-001, EXT-H3-LICENSE | 中断/盘满/hash/redirect/恢复证据 | 不激活半安装；保留安全partial或重下 |
| `CAP-RUNTIME-UPDATE` | 应用内 runtime/component更新 | `hidden` | `hidden` | `hidden` | `poc_pending` | Alpha不显示更新通道 | TG-UPDATE-001, EXT-SIGNING | 更新威胁模型、签名、anti-rollback与恢复 | 手动安装下一签名版本 |
| `CAP-DESKTOP-INSTALL` | 工具内安装/捆绑官方 Desktop | `hidden` | `hidden` | `hidden` | `poc_pending` | 不显示；只提供官方渠道说明 | EXT-DESKTOP-DIST | Desktop实际发布物许可与签名来源 | 不捆绑；继续managed Core |
| `CAP-PORTABLE-ADAPTER` | Portable执行 adapter | `hidden` | `hidden` | `hidden` | `experimental` | 仅高级页 | 后续adapter gate | 版本/layout/节点/模型/启动矩阵 | 只导出workflow |

### 5.2 项目、workflow 与输出

| ID | Capability | 当前 | Alpha-0目标 | Alpha-1目标 | 1.0目标 | 普通用户界面 | 依赖 gate | 必需证据 | 失败降级 |
|---|---|---|---|---|---|---|---|---|---|
| `CAP-T2VA-5S` | 5秒文字生成视频和H3原生声音 workflow | `poc_pending` | `internal` | `certified` | `certified` | 提示词；时长5秒只读；默认16:9；按钮“生成工作流并打开ComfyUI” | TG-WF-T2VA-001, TG-HANDOFF-001 | schema fingerprint、workflow hash、用户Run、带声MP4 | 回退golden workflow或阻止交接 |
| `CAP-BASE-MODES` | T2VA/I2VA/L2VA/FL2VA 4–15秒 | `hidden` | `hidden` | `certified` | `certified` | 提示词/首帧/尾帧、时长、画幅；自动路由，不问内容类型 | TG-WF-BASE-002 | 输入真值表、每模式golden、帧网格、纯首帧空提示词 | 逐组合隐藏或给出有效输入要求 |
| `CAP-HANDOFF-CORE` | 打开受管ComfyUI并由用户点击Run | `poc_pending` | `internal` | `certified` | `certified` | 只显示交接按钮；没有工具侧“生成视频” | TG-HANDOFF-001 | 正确进程/端口/workflow；未自动提交正式Queue | 打开workflow目录并给手动本地步骤 |
| `CAP-UI-WORKFLOW` | 小白可视化workflow | `poc_pending` | `internal` | `certified` | `certified` | 主图只见输入→H3→输出；可展开详细图 | TG-WF-T2VA-001 / TG-WF-BASE-002 | UI graph与派生API graph build ID/hash闭环 | 使用完整原生图；不显示错误简化图 |
| `CAP-MP4-AUDIO` | 带H3原生声音的本地MP4 | `poc_pending` | `internal` | `certified` | `certified` | 输出位置与完成状态 | TG-WF-T2VA-001, TG-FFMPEG-001, EXT-FFMPEG（仅分发时） | ffprobe、时长、24fps/音轨、实际mux链 | 保留中间文件并解释缺失组件；不伪造完成 |
| `CAP-OFFLINE-RUN` | 安装后断网生成、生成阶段零未声明外联 | `poc_pending` | `internal` | `certified` | `certified` | 完成页显示“当前profile已通过离线验证”仅在证据存在时 | TG-OFFLINE-001 | 断网run、pcap/ETL、进程树、节点allowlist | 删除认证标识；未知外联阻止运行 |
| `CAP-DESKTOP-DETECT` | 现有Desktop/Comfy只读发现 | `poc_pending` | `poc_pending` | `experimental` | `certified`（仅支持版本） | Alpha-1仅摘要“已检测，不会修改”；高级查看 | TG-DESKTOP-001（只读子集） | 零写入、未import节点、版本/实例报告 | 不显示候选；允许手动选择workflow目录 |
| `CAP-DESKTOP-OPEN` | 自动选择Desktop实例并激活workflow | `poc_pending` | `hidden` | `poc_pending` | `experimental`，通过稳定契约后方可`certified` | 默认隐藏 | TG-DESKTOP-001, EXT-DESKTOP-DIST | 冷/热启动、多实例、未保存画布、版本漂移、无坐标自动化 | 手动导出/打开；managed Core主路径不受影响 |
| `CAP-REF2VA` | 参考图片/视频/音频生成 | `hidden` | `hidden` | `hidden` | `poc_pending`，gate关闭后可升`certified` | 未发布前完全隐藏 | TG-REF-001, EXT-H3-LICENSE | Ref权重/LoRA provenance、输入限制、golden、资源 | 保持hidden；不下载Ref包 |
| `CAP-LONG-30` | 30秒分段续接 | `hidden` | `hidden` | `hidden` | `poc_pending`，通过后`certified` | 未通过前隐藏 | TG-LONG-001, EXT-RUNNER-DIST | runner/hash、恢复、时长、A/V、通过率 | 保持hidden或高级experimental |
| `CAP-LONG-60` | 60秒分段续接 | `hidden` | `hidden` | `hidden` | `experimental` | 高级页，默认关闭并显示Beta风险 | TG-LONG-001, EXT-RUNNER-DIST | 失败恢复、资源上限、精确时长、Beta成功率 | 隐藏60秒，保留30秒/短视频 |
| `CAP-POST-AUDIO` | 本地BGM/旁白混合 | `hidden` | `hidden` | `hidden` | `poc_pending` | 未发布前隐藏 | 后续audio gate, EXT-FFMPEG | mix规范、响度/同步、许可、输入隐私 | 只保留H3原生声音 |
| `CAP-UPSCALE-FI` | 本地放大/补帧 | `hidden` | `hidden` | `hidden` | `experimental` | 仅安装相应包后高级显示；明确非H3 Regenerate-2K | 后续upscale gate | 模型来源、性能、输出质量、FFmpeg链 | 输出H3原始分辨率/帧率 |

### 5.3 加速、安全、发布与品牌

| ID | Capability | 当前 | Alpha-0目标 | Alpha-1目标 | 1.0目标 | 普通用户界面 | 依赖 gate | 必需证据 | 失败降级 |
|---|---|---|---|---|---|---|---|---|---|
| `CAP-BASELINE-RECIPE` | 原生保守性能recipe | `poc_pending` | `internal` | `certified` | `certified` | 只显示“已认证配置”，不显示节点/精度细节 | TG-HW-001, TG-WF-T2VA-001 | 成功率、VRAM/RAM、耗时、音视频完整性 | 标不支持或降低认证范围 |
| `CAP-TURBO-LORA` | Turbo LoRA加速 | `hidden` | `hidden` | `hidden` | `experimental` | 高级页，默认关闭 | TG-ACCEL-001, EXT-H3-LICENSE | 逐文件provenance、每profile A/B、音频/运动回退 | 原生20/25步recipe |
| `CAP-SAGE-NODES` | SageAttention/KJNodes等社区加速 | `hidden` | `hidden` | `hidden` | `experimental` | 高级页，默认关闭 | TG-ACCEL-001 | node/wheel hash、Torch/CUDA兼容、无外联、A/B | 原生attention |
| `CAP-SUPPORT-BUNDLE` | 本地脱敏诊断包 | `poc_pending` | `internal` | `certified` | `certified` | 用户预览包含项后导出 | privacy gate | 字段allowlist、无prompt/token/用户名/绝对私密路径 | 只显示本地诊断，不生成包 |
| `CAP-PUBLIC-INSTALLER` | 面向外部用户的签名安装包 | `hidden` | `hidden` | `certified` | `certified` | 下载/安装时显示publisher与版本 | EXT-H3-LICENSE, EXT-COMFY-CORE, EXT-COMFY-FRONTEND, EXT-FFMPEG（适用时）, EXT-SIGNING, EXT-HARDWARE | Authenticode/时间戳、许可材料、目标地域、认证矩阵 | 仅内部受控build，不对外分发 |
| `CAP-AI-DISCLOSURE` | MiniMax H3归属与AI生成披露 | `poc_pending` | `internal`（仅占位验证） | `certified` | `certified` | 商业界面醒目标注MiniMax H3；公开导出按批准策略披露 | EXT-H3-LICENSE | 法务批准文案、UI/导出测试 | 阻止外测/公开导出，不用品牌水印代替 |
| `CAP-BRAND-WATERMARK` | 用户品牌水印 | `hidden` | `hidden` | `hidden` | `poc_pending`，资产到位后可升`certified` | 默认关闭；与AI披露分开 | TG-BRAND-001, EXT-BRAND-ASSET | 原始资产、使用规范、安全区、横竖屏和关闭回退 | hidden；完全不阻塞Alpha或AI披露 |

## 6. 普通用户字段矩阵

### 安装页面

| 字段/控件 | Alpha-0 | Alpha-1 | 1.0 |
|---|---|---|---|
| 受管数据位置 | 可见，一个路径 | 可见，一个路径 | 可见；多卷能力若未认证仍只有一个路径 |
| 硬件/磁盘摘要 | 只读内部profile结果 | 只读认证等级和原因 | 只读；实验profile需高级确认 |
| 已发现模型摘要 | 只读；hash通过才复用 | 只读推荐结果；冲突时询问 | 可进入高级详情 |
| 必需组件 | 锁定：runtime、基础模型、输出链 | 同左，显示用途/来源/空间/许可 | capability驱动 |
| Desktop/Core/Portable选择 | 不显示 | 不显示 | 仅已有认证adapter时高级显示 |
| Ref/长视频/加速/放大/BGM/水印 | 全部隐藏 | 全部隐藏 | 只显示已达到`certified`或明确`experimental`的能力 |
| 自动更新/Stable/Testing | 不显示、功能不存在 | 不显示、功能不存在 | TG-UPDATE-001关闭后显示 |
| 许可接受 | 内部测试记录 | 下载前必须显示已批准的许可版本 | 按component capability显示 |

### 项目创建页面

| 字段/控件 | Alpha-0 | Alpha-1 | 1.0 |
|---|---|---|---|
| 提示词 | 必填（T2VA） | 与有效首/尾帧至少一项 | 同左，Ref启用后增加角色化素材 |
| 首帧/尾帧 | 隐藏 | 分开可选 | 分开可选 |
| 时长 | 固定5秒只读 | 4–15秒认证网格 | capability决定是否出现30/60 |
| 画幅 | 固定16:9或内部fixture | 自动，可修改为认证画幅 | 同左 |
| 生成/导出分辨率 | 自动，不显示技术值 | 自动；高级显示认证生成值 | 超分安装后才出现独立导出值 |
| 内容类型（故事/口播等） | 不存在 | 不存在 | 不存在 |
| 模型/节点/采样器/API graph | 不存在 | 不存在 | 仅专家查看详情，不是项目必选 |
| 主按钮 | “生成工作流并打开ComfyUI” | 同左 | 同左；永远不是“生成视频” |

## 7. 阶段退出条件

### Alpha-0 完成

- `CAP-RT-CORE`、`CAP-HW-ONE`、`CAP-DISK-ONE`、`CAP-MODEL-BASE`、`CAP-DOWNLOAD`、`CAP-T2VA-5S`、`CAP-HANDOFF-CORE`、`CAP-MP4-AUDIO`、`CAP-OFFLINE-RUN` 达到 `internal`。
- Ref、长视频、加速、自更新、Desktop安装/自动打开、放大补帧、后期音频和水印均为 `hidden`。
- 证据只支持锁定的内部机器/版本，不生成外部安装包。

### Alpha-1 完成

- Alpha-0 主路径及 `CAP-BASE-MODES`、`CAP-MODEL-REUSE`、`CAP-PUBLIC-INSTALLER`、`CAP-AI-DISCLOSURE` 达到 `certified`。
- 所有阻断 Alpha-1 的 External gates 为 `CLOSED`。
- 用户研究、Win10/11认证矩阵、D/C盘、断网、零外联、失败恢复和签名证据齐全。
- Desktop自动打开仍可保持`poc_pending`，不得阻断managed Core外测。

### 1.0 完成

- 只有实际达到`certified`的能力进入普通用户路径。
- 60秒、社区加速等若仅为`experimental`，必须高级入口、默认关闭且有一键回退。
- 品牌水印只有 EXT-BRAND-ASSET 与 TG-BRAND-001关闭后出现；它永远不替代MiniMax H3归属和AI披露。

## 8. 证据记录要求

每次状态变更必须记录：

```text
capability_id
from_status / to_status
app_version
recipe_id
hardware_profile_id
upstream versions + immutable revisions
artifact hashes
test cases + pass/fail count
network/disk/resource evidence
applicable external gate IDs
reviewer + date
expiry/revalidation trigger
failure fallback verified
```

无证据路径、只有截图、只有单次成功或只有“官方支持”说明时，状态不得超过 `poc_pending`。
