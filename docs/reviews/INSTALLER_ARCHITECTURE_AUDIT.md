# MiniMax H3 工具：Windows 安装器与运行时架构独立审计

- 审计对象：`MINIMAX_H3_TOOL_EXECUTION_PLAN.md` 0.3
- 审计角色：独立审计 Agent A
- 审计日期：2026-08-27（Asia/Shanghai）
- 审计范围：Windows 安装器、ComfyUI Desktop/Core/Portable 接入、Python/Torch/CUDA 隔离、模型扫描复用、D 盘与缓存、下载事务、依赖锁、更新回滚、供应链与安全
- 范围边界：本工具只安装、检测、复用、配置并编译工作流；ComfyUI 调用 MiniMax H3 执行实际音视频生成。本报告不建议把生成、提示词创作或云推理能力放入工具本体。

## 结论

**结论：有条件通过。**

0.3 版已经把产品边界、运行环境与模型包拆分、默认 D 盘、已有 ComfyUI 三选项、分层扫描授权、模型白名单复用、Desktop Phase 0 门、许可证门和“生成阶段不调用第三方推理 API”等核心方向写对了。它可以交给 Agent 开始 **Phase 0 架构验证** 和 **Phase 1 只读检测器**，但还不能直接进入面向外部用户的 Phase 2 安装器发布。

公开安装器之前必须关闭六类 P0：

1. Python 虚拟环境不能按当前文字从 staging 目录搬到最终目录；必须改成“在最终绝对版本目录内构建，验证后只原子切换小型激活指针”。
2. ComfyUI Desktop 是会自动更新、支持多实例且拥有自管配置的外部产品，不是稳定的文件夹布局；必须按 Desktop 版本和配置 schema 建立只读/受支持入口适配器。
3. “签名 manifest + SHA-256”不足以构成安全更新系统；还缺抗回滚、过期、防冻结、密钥轮换/吊销和通道隔离。
4. “使用现有实例”尚未定义不执行未知自定义节点、不改用户 Python/节点/配置的强边界。
5. ComfyUI Core 当前 CLI 的前端默认值可指向 `latest` 并联网获取；Stable 配方必须固定并本地化前端、依赖、节点和模型，生成进程不得隐式取最新。
6. Windows junction/symlink/reparse point、压缩包路径逃逸、卸载递归删除和跨卷“原子切换”的安全模型不完整。

因此建议的放行范围是：

| 阶段 | 审计意见 |
|---|---|
| Phase 0 | 可立即开始，且应优先关闭本报告 P0 |
| Phase 1 只读检测器 | 可与 Phase 0 并行，但不得导入或运行未知现有节点 |
| Phase 2 内部原型 | P0-01、P0-02、P0-04、P0-05、P0-06 关闭后可做 |
| Phase 2 外部发布 | 所有 P0、许可证门、签名与更新信任门全部关闭后才可做 |
| Phase 3 工作流编译器 | 可先针对一个锁定的自管 Core 配方开发；Desktop 交接依赖 P0-02 |

### 官方一手依据

本审计只用官方文档、官方仓库和官方规范核对不稳定事实，主要证据如下：

- Python 官方明确说明 venv 脚本包含解释器绝对路径，虚拟环境通常不可搬移，移动后应在新位置重建：[Python `venv` 文档](https://docs.python.org/3/library/venv.html#how-venvs-work)。
- ComfyUI v0.30.0 官方发布记录确实包含原生 MiniMax H3 支持，因此计划中的 `0.30.0+` 可作为“基础 H3”历史下界，但不能替代能力探测：[v0.30.0 release](https://github.com/Comfy-Org/ComfyUI/releases/tag/v0.30.0)、[H3 引入 commit](https://github.com/Comfy-Org/ComfyUI/commit/57500fc5bc92)。当前 H3 节点及其 ID/参数应以锁定 commit 的 schema 为准：[官方 H3 节点源码](https://github.com/Comfy-Org/ComfyUI/blob/d8e7bbc9d586d95f758d6b0ed23d519088be578a/comfy_extras/nodes_minimax_h3.py)。
- ComfyUI 官方 CLI 支持 `--base-directory`、额外模型路径、禁用全部自定义节点、白名单节点、禁用 API 节点、指定前端根目录等；默认监听为回环地址，但无参数的 `--listen` 会暴露所有地址，默认前端版本字符串仍包含 `latest`：[官方 CLI 参数](https://github.com/Comfy-Org/ComfyUI/blob/d8e7bbc9d586d95f758d6b0ed23d519088be578a/comfy/cli_args.py)。
- 当前 Comfy Desktop 是多实例管理器；Windows 官方文档列出安装、共享模型/输出、设置与日志的不同目录并说明自动更新：[Desktop Windows 文档](https://docs.comfy.org/installation/desktop/windows)。当前 Desktop 源码会生成并重写 `shared_model_paths.yaml`，文件自身明确标注“不要手工编辑”：[models.ts（锁定审计 commit）](https://github.com/Comfy-Org/Comfy-Desktop/blob/29087358520593cc2d08224e89d6bc8c9d455254/src/main/lib/models.ts#L202-L273)。其多实例记录包含 shared/per-install 模型、输入、输出开关：[installations.ts](https://github.com/Comfy-Org/Comfy-Desktop/blob/29087358520593cc2d08224e89d6bc8c9d455254/src/main/installations.ts#L16-L71)。自动安装 Desktop 更新当前为默认开启语义：[settings.ts](https://github.com/Comfy-Org/Comfy-Desktop/blob/29087358520593cc2d08224e89d6bc8c9d455254/src/main/settings.ts#L13-L47)。
- 当前 Desktop 的大型数据目录会根据 Windows 安装盘及配置决定，不能用旧版本经验推断：[paths.ts](https://github.com/Comfy-Org/Comfy-Desktop/blob/29087358520593cc2d08224e89d6bc8c9d455254/src/main/lib/paths.ts#L47-L156)。
- 官方 Portable 文档当前同时提供不同 Python/CUDA 组合，证明运行时必须按认证配方锁定而不能写死“一个通用 CUDA 环境”：[ComfyUI Portable for Windows](https://docs.comfy.org/installation/comfyui_portable_windows)。
- pip 官方安全安装要求启用 hash-checking 并禁止源码分发，且所有传递依赖都必须锁定：[pip secure installs](https://pip.pypa.io/en/stable/topics/secure-installs/)。
- Hugging Face 当前规范使用 `HF_HUB_CACHE`，并另有 `HF_XET_CACHE`、`HF_ASSETS_CACHE`、`HF_TOKEN_PATH`；环境变量在 import 时读取，生成阶段可用 `HF_HUB_OFFLINE=1` 禁止 Hub 网络访问：[HF 环境变量](https://huggingface.co/docs/huggingface_hub/main/package_reference/environment_variables)。
- Microsoft 官方文件系统表说明 FAT32 单文件上限为 4 GiB：[文件系统功能比较](https://learn.microsoft.com/en-us/windows/win32/fileio/filesystem-functionality-comparison)。
- Microsoft 官方说明 Windows 路径默认仍可能受 260 字符限制，长路径同时依赖系统设置和应用 manifest 的 `longPathAware`：[Maximum Path Length Limitation](https://learn.microsoft.com/en-us/windows/win32/fileio/maximum-file-path-limitation)。
- Microsoft 官方说明 reparse point 会改变通常的路径行为，并可通过文件属性识别：[Reparse Point Operations](https://learn.microsoft.com/en-us/windows/win32/fileio/reparse-point-operations)。
- Microsoft 对文件替换的示例明确要求同卷且文件未被不兼容方式占用，不能把跨卷复制称为原子切换：[Dynamic-Link Library Updates](https://learn.microsoft.com/en-us/windows/win32/dlls/dynamic-link-library-updates)、[ReplaceFileW](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew)。
- TUF 官方规范覆盖回滚、冻结、混搭、密钥轮换与阈值签名等软件更新威胁：[The Update Framework Specification](https://theupdateframework.github.io/specification/latest/)。
- Windows 官方 SignTool 文档区分签名、验签和 RFC 3161 时间戳；安装器签名不能由普通文件哈希替代：[SignTool](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool)。
- PyTorch 官方发布页把 Torch/Torchvision/Torchaudio 与具体 CUDA wheel 组合列为成套版本；NVIDIA 另行规定驱动与 CUDA 兼容范围：[PyTorch previous versions](https://pytorch.org/get-started/previous-versions/)、[NVIDIA CUDA compatibility](https://docs.nvidia.com/deploy/cuda-compatibility/minor-version-compatibility.html)。

## P0 问题

### P0-01：当前 staging → 原子切换描述不适用于 Python venv

**位置：**计划 §15.1，尤其是“依赖安装和冒烟测试先在 staging 目录完成；全部通过后才原子切换为当前版本”。

**问题：**Python 官方明确说明 venv 中的脚本引用解释器绝对路径，环境通常不可搬移。若在 `...\staging\env` 安装 wheel 后再重命名到 `...\runtimes\env`，入口脚本、生成的配置或第三方包记录可能仍引用旧路径。即使 Python 主程序能启动，也可能在后续调用 console script 时才失败。

**必须修改：**

- 每个 runtime 使用不可变的最终绝对目录，例如 `runtimes/<recipe-id>/<generation-id>/`。
- 在该最终目录创建环境，但在 `install-state` 中标为 `INSTALLING`，不得被启动器发现。
- 安装、`pip check`、import、CUDA、H3 object-info 和最小推理冒烟全部通过后，只原子替换一个很小的 `active.json`/注册表值。
- 旧 generation 保留为 N-1；回滚只是切回指针。
- 若采用上游 Portable/独立 Python 包而不是 venv，仍须单独证明该包在目标目录可重定位，不能把“压缩包可解压”当成通用结论。

**验收：**在包含空格、中文、不同盘符的最终目录各做一次全新安装；安装完成后搜索所有文本入口/配置不得出现 staging 路径；删除任何 staging 目录后完整冒烟仍通过；更新中断时旧 active generation 不受影响。

### P0-02：Desktop 接入仍缺“受支持契约 + 版本门”

**位置：**计划 §5.3、§5.4-H、§20 Phase 0。

**问题：**计划已正确要求 Desktop 自管配置只读，但尚未把它变成可验收的 adapter contract。当前 Desktop：

- 是多实例管理器，不等同于一个固定 ComfyUI 文件夹；
- 同时存在共享模型目录与每实例额外模型目录；
- 会生成并重写 `shared_model_paths.yaml`；
- 自动安装 Desktop 更新当前为默认开启语义；
- app 版本、安装记录 schema、模型 YAML schema、前端和后端版本可独立变化。

只按 `%APPDATA%` 路径或文件名判断“Desktop 已接入”会在一次上游更新后失效，甚至覆盖用户配置。

**必须修改：**

- 定义 `DesktopAdapterCapability`：Desktop app 版本、安装记录 schema、实例 ID、Comfy commit/version、frontend version、可用模型路径入口、工作流打开方式、是否允许写入。
- 所有 Desktop 私有文件默认只读；不得直接写当前 `shared_model_paths.yaml`。
- 若没有官方稳定写入 API，新增模型路径只能走用户可见的 Desktop 官方设置流程，或改为“Desktop 打开工作流 + 自管隔离 Core 执行环境”。
- Desktop 更新后首次使用必须重跑 adapter probe；不兼容时退化为“只导出工作流/引导导入”，不能猜测写入。
- `recipe.lock.json` 记录 Desktop app 版本、Desktop adapter schema、目标实例 ID、Comfy backend commit 和 frontend version。

**验收：**至少对当前 Desktop、一个明确列出的旧版本、Portable、手动 Core 建立 fixture；只读扫描无写入；Desktop 更新或 schema 字段未知时 fail closed；生成的 YAML 不触碰 Desktop 标注为自管的文件。

### P0-03：更新信任链不足，签名 manifest 仍可遭回滚/冻结

**位置：**计划 §15.1、§15.2、§20 Phase 0。

**问题：**单个长期密钥签署的 manifest 即使带 SHA-256，仍可能被攻击者重放旧但有效的 manifest，或长期冻结在有漏洞的版本；计划也没有定义根密钥轮换、撤销、阈值、元数据过期、Stable/Testing 权限隔离和客户端持久化最高版本。

**必须修改：**

- 采用 TUF 或具备等价属性的已审计更新协议：离线 root、targets、snapshot、timestamp；版本单调递增；过期；阈值签名；密钥轮换/撤销；consistent snapshot。
- Stable 与 Testing 使用不同 delegated target 范围，Testing 凭据不得发布 Stable。
- 客户端保存已见最高可信元数据版本，检测 rollback/freeze/mix-and-match。
- manifest 对每个目标记录长度、哈希、目标类型、recipe compatibility、许可证、允许的重定向主机。
- 工具安装器、卸载器、更新器和高权限 helper 另做 Authenticode 签名与 RFC 3161 时间戳；运行前验证 publisher 和签名链。TUF 目标签名与 Windows 可执行文件签名是两层不同控制。

**验收：**自动化演练旧 manifest 重放、过期 timestamp、替换镜像、目标长度超限、错误 channel、密钥轮换、撤销密钥、断网缓存；每项都得到预期 fail-closed 或受控离线行为。

### P0-04：“使用现有实例”没有明确 attach-only 安全边界

**位置：**计划 §3、§5.3、§5.4-A、§15.3。

**问题：**“全部认证检查通过”未说明认证时是否会启动现有 Python、导入 custom_nodes、执行 Manager 计划任务或写 `__pycache__`/数据库。自定义节点就是任意 Python 代码；把现有实例启动一次来“看看缺不缺节点”本身已经执行了未知代码。

**必须修改：**

- 将三选项语义固定为：
  1. **接入现有实例（attach-only）**：只读发现与兼容报告；不安装节点、不 pip、不改配置。若需要用户改变 Desktop 设置，显示步骤并由用户在 Desktop 完成。
  2. **只复用模型并创建受管隔离实例（默认）**：只引用通过认证的外部模型；运行时、节点、配置全部由工具管理。
  3. **忽略并全新安装**：完全受管。
- 静态扫描不得 import Python。
- 需要动态能力探测时，在明确授权后使用临时 user/input/output/temp 目录、`PYTHONDONTWRITEBYTECODE=1`、回环地址，并使用 ComfyUI 官方 `--disable-all-custom-nodes --disable-api-nodes`；只对工具 allowlist 节点开放 whitelist。
- “现有实例可直接执行”必须是一个单独的专家级选择，并显示将修改/执行的精确内容；MVP 建议不实现该写入模式。

**验收：**用含恶意测试 custom node、损坏 YAML、只读目录和正在运行实例的 fixture 验证；快速扫描不触发节点代码，不创建文件，不终止用户进程，不更改 Python 包。

### P0-05：Stable 运行时可能因 `latest` 前端或运行期安装而漂移

**位置：**计划 §13.2、§15.2、§16.2。

**问题：**当前 ComfyUI CLI 的默认 frontend 字符串使用 `latest`，并说明可联网查询/下载前端。只锁 ComfyUI commit 仍不足以复现一个实例；Desktop 也可独立更新 launcher、frontend 和 backend。计划虽然禁止运行期 pip/节点下载，却没有明确禁止前端、模板索引和 Manager 的隐式联网更新。

**必须修改：**

- 受管 Stable profile 必须包含本地 frontend artifact，启动时使用锁定的 `--front-end-root`，或使用精确版本且在安装阶段预取并校验；不得保留 `latest`。
- 默认不启用 Manager；若未来需要，Manager 版本、配置、计划任务和网络域名都属于 recipe。
- 在 `recipe.lock.json` 增加：Comfy frontend、workflow templates/schema、Manager（如有）、Comfy API schema、工具 runner、FFmpeg build、Python ABI、Torch/Torchaudio/Torchvision、CUDA wheel tag、驱动下限、所有 artifact hash。
- 生成子进程设置离线策略，并在联网测试机抓包验证从打开实例到输出完成无未声明外联。

**验收：**断网启动、打开工作流、点击运行均不尝试解析 `latest`、下载 frontend/节点/模型；删除网络后仍能完整运行；锁文件能唯一重建同一 profile。

### P0-06：Windows 路径逃逸与递归删除威胁模型不完整

**位置：**计划 §16.2、§13.4、§15。

**问题：**计划提到压缩包路径穿越/符号链接逃逸，但尚未覆盖 Windows junction、mount point、其他 reparse point、设备名、NTFS ADS、尾随点/空格、UNC/卷挂载、路径大小写别名和卸载时的 TOCTOU。仅检查字符串前缀不能证明目标仍位于受管根内。

**必须修改：**

- 所有受管写根在创建和每次提交前进行规范化、卷 ID、最终 handle path、ACL、reparse 属性检查。
- 默认拒绝受管根或其祖先链中的 reparse point；外部模型可只读引用，但不得作为卸载递归根。
- 解压拒绝绝对路径、盘符、UNC、`..`、ADS 冒号、Windows 设备名、尾随点/空格、symlink/hardlink/reparse entry；限制条目数、单文件大小、总展开大小和压缩比。
- 卸载以所有权 ledger 的逐项文件 ID/相对路径删除，不对未经重新验证的路径执行广泛递归删除。
- 路径检查与最终 create/replace 尽可能基于目录 handle，降低检查后替换 junction 的 TOCTOU。

**验收：**构造 zip-slip、junction swap、模型目录指向系统目录、ADS、`CON`/`NUL`、超长路径、大小写别名和断电恢复测试；不得写出受管根、不得删除外部文件。

## P1 问题

### P1-01：FAT32 规则写错

计划 §5.1 写成“不允许把 20GB 以上权重放到 FAT32”。FAT32 的单文件上限是 **4 GiB**，不是 20GB。H3 的主权重已经远超此限，因此：

- MVP 受管 runtime/model/cache/workspace 建议只认证本地固定 NTFS；
- ReFS、exFAT、网络盘、移动盘、机械盘分别进入 Testing 矩阵，不因“能写大文件”就默认等价；
- 外部模型可以从其他文件系统只读发现，但在认证前不得标记为 Stable。

### P1-02：多路径时必须按卷分别做 staging、峰值空间和提交

模型、缓存、runtime、workspace 可以分别选 D/E/F，但一个全局 staging 目录不能给所有目标提供原子提交。每个目标 artifact 的 `.partial`、校验文件和最终文件应位于同一卷、最好同一目录；每个卷分别计算下载临时、解压、环境构建和回滚保留的峰值空间。

### P1-03：缺少单写者锁和持久事务日志

当前“事务式安装”未定义并发与断电恢复。需要：

- 按安装根创建 Windows named mutex；
- 同卷持久 journal，记录事务 ID、recipe、目标、状态、预期 hash/length、active generation 前值；
- 状态机至少包含 `PLANNED → DOWNLOADING → VERIFIED → MATERIALIZING → VALIDATING → ACTIVATED / ABORTED`；
- 每步可重复执行，应用崩溃或断电后能判定继续、回滚或隔离残留；
- 激活指针写临时文件、flush，再使用同卷替换。

### P1-04：断点续传协议不够严格

`.partial` 除内容外还应有 sidecar：原始 URL、解析后的 pinned revision、ETag/Last-Modified、预期长度、已下载长度、目标 SHA-256、channel/manifest version。续传必须要求 HTTP 206 与匹配的 `Content-Range`；若服务器返回 200、ETag 改变、重定向越出 allowlist 或长度超限，应废弃旧分片重新下载而不是拼接。

### P1-05：依赖锁还需明确“只装 wheel、完全离线”

计划已经要求 wheelhouse 与 hash，这是正确方向，但 Stable 的命令语义应固定为等价于：

- `--no-index`
- `--find-links <已校验 wheelhouse>`
- `--only-binary=:all:`
- `--require-hashes`

所有传递依赖必须 `==` 精确版本并带 SHA-256；禁止 sdist、VCS URL、editable、本地未签名目录、`setup.py` 和构建隔离联网。wheelhouse 必须按 Windows 架构、Python ABI、Torch/CUDA profile 分开。完成后执行 `pip check`、锁定模块 import 和 H3 object-info 冒烟。

### P1-06：recipe 粒度不足

当前 `recipe.lock.json` 应至少再加入：

- Windows 架构与最低 OS build；
- Python 发行来源、完整版本、ABI、archive/hash；
- Torch、Torchaudio、Torchvision 的精确组合与每个 wheel hash；
- CUDA wheel tag、NVIDIA 驱动下限、支持的 compute capability；
- Comfy commit、frontend artifact/version、workflow template/schema；
- Desktop app version、Desktop adapter schema、实例 ID（仅接入时）；
- Manager 是否禁用；若启用则版本、配置 hash；
- FFmpeg 版本、build configure、二进制 hash、启用编码器；
- 模型 repo + immutable revision + 文件 hash + 角色/精度；
- 工具版本、manifest root version、runner 版本和所有自定义节点 hash。

### P1-07：“CUDA Runtime”术语容易让实现误装系统 CUDA

计划正确写了“不安装系统 CUDA”，但 UI 和配方仍要区分：

- **主机依赖：**NVIDIA GPU 与兼容驱动；
- **受管 Python profile：**特定 CUDA tag 的 PyTorch/Torchaudio/Torchvision wheel 及其依赖；
- **可选编译工具链：**只有必须现场编译扩展时才需要系统 CUDA Toolkit/MSVC；Stable 应通过预编译、已签名 wheel 避免这一需求。

不得用 `nvidia-smi` 显示的 “CUDA Version” 当成已安装 Toolkit 版本。工具只比较驱动版本、GPU 能力与认证 profile，并给出不兼容解释，不自动安装驱动或系统 Toolkit。

### P1-08：Hugging Face 缓存枚举不完整且使用了旧变量名

计划 §5.2 扫描 `HUGGINGFACE_HUB_CACHE`，该名字在当前官方文档中属于兼容旧名；应把 `HF_HUB_CACHE` 作为主变量，同时兼容扫描旧名。每个下载子进程在 import `huggingface_hub` 前显式设置：

- `HF_HOME`
- `HF_HUB_CACHE`
- `HF_XET_CACHE`
- `HF_ASSETS_CACHE`
- 必要时 `HF_TOKEN_PATH`

这些路径都应计入用户选择盘的空间估算和清理 UI。生成阶段可设置 `HF_HUB_OFFLINE=1`。不得在日志输出 token；工具也不得清理用户原有 HF cache。

### P1-09：复用 HF cache 不能依赖可变 `main`/`refs`

HF cache 中 `refs/main` 可变化，快照也可能被用户的缓存清理删除。认证复用应解析到 immutable commit 和 blob hash：

- 已有外部 cache 默认按“外部只读引用”登记；
- 启动前复核存在性、文件 identity/size/mtime，首次认证及变化后做完整 SHA-256；
- 若产品需要长期可靠性，征得用户同意后 materialize 到受管模型库；同卷且文件系统支持时才考虑 hardlink，其他情况明确复制量；
- 卸载器永不删除外部 HF blob/snapshot。

### P1-10：模型扫描需要性能层级与解析上限

在首次扫描时对每个 20–40GB 文件完整 SHA-256 会让“打开安装页”非常慢。建议：

1. 配置/已知目录枚举；
2. 文件名、大小、扩展名、Safetensors 固定头读取；
3. 受限 header schema 检查：角色、tensor 名/shape/dtype、offset 完整性；
4. 用户选中候选后再完整 SHA-256；
5. 认证结果按 volume serial + file ID + size + mtime 缓存；变化即失效。

扫描器只用 safetensors 安全解析或受限 JSON header，不调用 `torch.load`/pickle。YAML 使用 safe loader，拒绝自定义 tag/对象构造。Header、tensor 数、JSON 深度和字符串长度都应有限制。

### P1-11：D 盘承诺必须覆盖子进程缓存并变成可测预算

只把主目录设为 D 盘仍可能让 pip、HF Xet、Python TEMP、解压器、Comfy temp、前端下载器或编译缓存写回 C。需要一个“每子进程环境 envelope”，在不改系统全局环境的前提下设置 TEMP/TMP、pip cache、HF 系列变量、Comfy input/output/temp 和已认证后端的缓存目录。

建议验收口径：

- 选 D 盘时，C 盘不得出现模型权重、wheelhouse、HF/Xet 数据、解压 runtime、Comfy temp、输入、输出或下载分片；
- 工具自管的 C 盘设置/日志给出明确上限并做轮转；
- Windows Installer/Defender 等 OS 自管缓存若无法控制，单独披露，不纳入“零写入”宣传；
- 在干净 VM 上使用文件 I/O 追踪做安装前后差异报告。

### P1-12：Windows 长路径、Unicode、空格仍未进入 DoD

应用 manifest 应声明 `longPathAware`，但不得静默修改系统级 LongPathsEnabled。即使主应用支持长路径，Python、FFmpeg、解压器或第三方 wheel 仍可能不支持。因此默认根保持短路径，并在矩阵中测试：

- 中文用户名；
- 安装路径含空格和中文；
- 盘符改变；
- 接近 260 字符；
- UNC（MVP 建议不支持写入）；
- 大小写/尾随点/保留名。

### P1-13：ComfyUI 本地服务需要显式网络与进程边界

受管启动器必须：

- 始终显式传 `--listen 127.0.0.1`，不能只传裸 `--listen`；
- 选择可用端口并把端口与本次子进程绑定，避免误连到别的 8188；
- 不开启通配 CORS；
- Stable 使用 `--disable-api-nodes`，禁用未知 custom nodes；
- 管理完整子进程树和退出；不终止用户自己启动的 ComfyUI；
- object-info 与工作流交接只信任本次启动且持有随机会话标识/进程映射的实例。

### P1-14：回滚要区分五种独立状态

“更新回滚”不能是一个总开关。至少分开：

1. 工具本体版本；
2. 受管 Comfy runtime generation；
3. Desktop 外部 app 与 adapter compatibility；
4. 模型/LoRA artifact；
5. 项目/配置 schema migration。

受管 runtime 应 side-by-side；模型用引用计数而非随 runtime 回滚重复下载；项目迁移先备份且定义 downgrade 策略。Desktop 的自动更新不受本工具完全控制，因此只能重新认证或降级接入能力，不能承诺替用户回滚 Desktop。

### P1-15：供应链锁不仅是 Python

技术栈确定后还要锁：

- Rust/Cargo、Node/pnpm/npm 或 NuGet 依赖；
- CI action 与构建容器/工具链；
- ComfyUI、Desktop、节点、runner 的精确 source commit；
- 官方 installer/archive 的 hash 与 Authenticode publisher；
- SBOM 与许可证清单；
- build provenance 和签名产物。

Stable 禁止在客户端执行 `git pull`、clone 任意分支或解析 `main/latest`。

### P1-16：模型白名单应声明模型“语义指纹”

计划的大小 + header + SHA-256 已经比只看文件名可靠，但 manifest 还应包含：

- repo 与 immutable revision；
-角色（FL2VA/Ref2VA/text encoder/video VAE/audio VAE）；
- dtype/quantization；
- 关键 tensor 名、shape、dtype 的期望摘要；
- 合法 Comfy 模型文件夹类型；
- 兼容 Comfy/Torch recipe 集合。

这样可以在完整 hash 前快速识别误放角色，并在 UI 明确解释“文件存在但不是当前配方所需角色”。

## P2 问题

### P2-01：可增加内容寻址 artifact store

受管下载可按 SHA-256 存储，recipe 只引用 digest，减少重复下载。只有同卷、文件系统支持、生命周期一致时才用 hardlink；不能跨卷伪装成去重，也不能让卸载一个 profile 删除仍被其他 profile 引用的模型。

### P2-02：Hash cache 可与系统文件 identity 结合

完整 SHA-256 是认证真值；日常启动可在未变化的 volume serial/file ID/size/mtime 上复用结果，并定期抽查。不要仅用路径和 mtime 作为长期安全身份。

### P2-03：为慢盘/Xet 建立可解释性能档

HF Xet 当前可并发进行范围读取，对 HDD 和移动盘可能导致抖动。下载器可根据介质类型采用顺序写配置、降低并发，并在 UI 显示“更稳定/更快”而非直接宣称“加速节点”。

### P2-04：诊断包应做结构化脱敏

支持包用字段白名单而不是事后正则清理；默认删除完整提示词、素材名、用户名、绝对路径、HF token、代理认证和环境变量值，只保留匿名化硬件/版本/digest 前缀。用户应能预览。

### P2-05：增加代理、镜像、AV 与 Controlled Folder Access 测试

这些不是首个 MVP 的功能阻断，但会成为真实安装失败高频原因。错误消息应区分 TLS/代理、磁盘被 AV 锁定、权限、路径不可用、镜像不支持 Range、hash 不符，不能统一显示“下载失败”。

### P2-06：引入故障注入测试

在下载 30%、校验后、环境安装中、active pointer 前后、配置迁移中和卸载中强杀进程；验证 journal 恢复、旧版本可用、外部模型不删。再加入磁盘满、盘符消失、文件被占用、manifest 过期。

## 计划中的错误/模糊假设

| 计划表述/假设 | 审计判断 | 修正 |
|---|---|---|
| “20GB 以上权重不能放 FAT32” | **错误** | FAT32 单文件上限 4 GiB；H3 受管大文件根直接拒绝 FAT32 |
| “在 staging 完成依赖安装，再原子切换目录” | **对普通文件成立、对 venv 不成立** | venv 在最终 generation 绝对路径构建；只切 active pointer |
| “ComfyUI 0.30.0+ 即兼容 H3” | **基础下界基本正确，但条件不足** | v0.30.0 确含基础 H3；仍要锁 commit 并探测具体 node ID/schema，Ref2VA/Guide 分开设 capability |
| “Desktop/Core/Portable 是三种目录形状” | **过度简化** | Desktop 是多实例 manager；adapter 要包含 app/schema/实例/自管文件权限 |
| “签名 manifest 即可安全更新” | **不充分** | 增加版本、过期、snapshot/timestamp、阈值、轮换、撤销和 anti-rollback |
| “D:\MiniMaxH3 能保证大文件不落 C” | **不充分** | 为所有子进程设置 cache/temp envelope，并在干净 VM 做 C 盘 I/O 预算验收 |
| 扫描 `HUGGINGFACE_HUB_CACHE` | **兼容旧名，但不是当前主变量** | 主变量改为 `HF_HUB_CACHE`，同时兼容旧名，并覆盖 Xet/assets/token |
| “Python、PyTorch、CUDA Runtime”就是一个版本号组 | **模糊** | 锁 Python ABI、torch/audio/vision wheels、CUDA tag、驱动下限、GPU 架构；不安装系统 Toolkit |
| “原子重命名”未限定卷/对象 | **模糊** | 文件只在同卷同目录替换；目录/profile 用 versioned generation + 小指针，不宣称跨卷原子 |
| “现有实例认证检查” | **可能执行未知代码** | 静态只读优先；动态检查禁用 custom/API nodes，并用临时 user/output/temp |
| “复用已下载 HF 模型” | **来源与寿命不明确** | 解析 immutable revision/blob；外部引用可失效，启动前重验且卸载不删 |
| “锁 ComfyUI commit 就能复现 UI” | **错误** | frontend、workflow templates、Manager/adapter 同样锁定 |
| “Desktop 安装到 D 即可永久保持兼容” | **不成立** | 当前大型数据路径会跟随安装盘，但 app data 与更新行为仍独立；每次 Desktop 版本变化重验 |

## 可优化点

### 1. 固定组件与所有权边界

建议把安装树和责任明确成：

```text
MiniMaxH3 Tool（控制平面，不做推理）
├─ Control state：manifest root、recipe、事务 journal、所有权 ledger
├─ Managed artifacts：Python/Comfy/frontend/wheels/FFmpeg（不可变、带 hash）
├─ Managed runtime generations：只由工具管理，可 side-by-side 回滚
├─ Managed model library：模型内容与引用计数
├─ External references：用户模型/HF cache，只读、永不由卸载器删除
├─ Projects/workspace：用户资产，默认保留
└─ Adapters
   ├─ Managed Core adapter
   ├─ Portable attach-only adapter
   └─ Desktop attach-only adapter

ComfyUI + MiniMax H3（数据平面）
└─ 用户点击运行后执行实际音视频生成
```

这一边界能避免“工具安装了 Desktop，所以也拥有 Desktop 配置/更新”的误解。

### 2. 使用 generation + active pointer，而不是移动环境目录

推荐布局：

```text
D:\MiniMaxH3\
├─ control\
│  ├─ profiles\<profile-id>\active.json
│  ├─ transactions\
│  └─ ownership\
├─ runtimes\<recipe-id>\<generation-id>\
├─ artifacts\sha256\<digest>\
├─ models\
├─ cache\
└─ workspace\
```

每个 generation 在最终路径构建，认证后只替换 `active.json`。更新失败不触碰当前 generation，回滚为 O(1) 指针操作。

### 3. 把 Desktop 变成可降级 adapter

Adapter 的输出不应只是“找到了 Desktop”，而应是：

```text
detected = true
adapter_schema = desktop-v2
desktop_version = ...
installation_id = ...
backend_commit = ...
frontend_version = ...
model_bridge = read-only / supported-ui / unsupported
workflow_open = supported / manual-import
mutation_allowed = false
```

未知版本或字段时保持“可导出工作流、需手动导入”，而不是继续写文件。

### 4. 运行时按能力而不是仅按版本匹配

对每个工作流族声明所需能力：

- Base T2V/I2V/FL2V：必需 node ID、输入/输出 schema、loader 类型；
- Ref2VA：独立 capability；
- AddGuide/长视频 runner：独立 capability；
- 音频保存/视频封装：独立 capability。

版本/commit 是供应链身份，object-info/schema 是运行能力，二者都要满足。

### 5. 扫描先快后严

安装页只做轻量发现；用户选中“复用”时再完整 hash。完整 hash 应可暂停、显示速度/剩余时间，并缓存验证结果。对外部模型变化要使认证失效，而不是继续展示绿色。

### 6. 每个盘显示“最终占用 + 峰值占用”

如果 runtime 在 D、model 在 E、cache 在 F，UI 应分别显示：

| 卷 | 新增最终占用 | 安装峰值 | 回滚保留 | 说明 |
|---|---:|---:|---:|---|
| D | runtime + FFmpeg | 解压 + wheel install | N-1 runtime | 必须本地 NTFS |
| E | models | `.partial` + final | 模型共享 | 可引用已有模型 |
| F | cache | 下载分片/Xet | 可清理 | 清理不影响外部 cache |

### 7. 先实现“零第三方节点”的短视频 MVP

MiniMax H3 已进入 ComfyUI core。MVP 短视频优先只使用锁定的原生节点；不为所谓“一键加速”引入社区节点。性能优化必须先在独立 recipe 测视频、音频、稳定性与画质，再进入 Stable。这样可显著缩小 Python 供应链。

### 8. 建立清晰 C 盘承诺

产品文案建议从“默认 D 盘”升级为可验证的两层承诺：

- 强承诺：模型、受管 runtime、下载分片、HF/Xet、Comfy temp、项目输出不静默落 C；
- 披露：Desktop/Windows 可能在 AppData、安装器缓存和日志写少量数据；显示最近一次实测量和路径。

## 建议 ADR

| ADR ID | 决策主题 | 必须回答的问题 | 状态建议 |
|---|---|---|---|
| ADR-001 | 产品/进程/所有权边界 | 工具、受管 Core、Desktop、外部模型、项目分别由谁拥有和可修改 | Phase 0 首先决策 |
| ADR-002 | Runtime generation 与激活 | 最终路径构建、active pointer、N-1、失败恢复、不可变规则 | P0 |
| ADR-003 | Desktop/Core/Portable adapter contract | 发现、只读字段、受支持写入口、工作流打开、版本降级 | P0 |
| ADR-004 | 文件系统与多路径策略 | NTFS/ReFS/exFAT/FAT32/网络盘支持级别；同卷 staging；C 盘预算 | P0 |
| ADR-005 | 现有实例安全接入 | attach-only、动态探测授权、custom node 禁用、用户配置保护 | P0 |
| ADR-006 | Artifact/recipe schema | 所有版本、hash、ABI、驱动、frontend、模型角色如何唯一描述 | P0 |
| ADR-007 | 更新信任 POUF | TUF 角色、密钥保管、阈值、轮换、通道、过期、离线策略 | P0 |
| ADR-008 | Windows 可执行文件签名 | Authenticode 证书、时间戳、签名验证、私钥与 CI 隔离 | P0 发布门 |
| ADR-009 | 下载与事务状态机 | Range/ETag、同卷 commit、mutex、journal、断电恢复 | P0 |
| ADR-010 | Python/Torch/CUDA profile | Python ABI、wheelhouse、torch/audio/vision、CUDA tag、driver/GPU 矩阵 | P1 |
| ADR-011 | 模型发现、认证与复用 | Safetensors schema、hash cache、HF immutable revision、外部引用寿命 | P1 |
| ADR-012 | Offline/loopback 运行策略 | frontend 本地化、Manager 禁用、HF offline、端口/进程所有权、抓包门 | P0 |
| ADR-013 | 更新/迁移/回滚 | 工具、runtime、Desktop、模型、项目 schema 分别如何回滚 | P1 |
| ADR-014 | 解压、路径、卸载安全 | reparse/ADS/device path、所有权 ledger、删除边界、故障恢复 | P0 |
| ADR-015 | 构建与供应链证明 | 依赖锁、SBOM、构建 provenance、第三方许可证、可复现程度 | P1 |

## 可并行细粒度任务

以下工时是“一个熟悉该技术栈的 Agent 的有效工时”，不包含法务等待、人工大模型下载时间和真实 H3 长推理时间。

| ID | 任务 | 依赖 | 产物 | 验收 | 预计 Agent 工时 |
|---|---|---|---|---|---:|
| IA-001 | 冻结组件/所有权边界 | 无 | ADR-001、组件状态图、mutation matrix | 每个目录/配置/进程有 owner、read/write/delete 规则；明确工具不推理 | 4h |
| IA-002 | Windows 路径与文件系统矩阵 | IA-001 | ADR-004、测试矩阵 | FAT32 4GiB 规则修正；NTFS MVP；跨卷与 ReFS/exFAT/网络盘策略明确 | 6h |
| IA-003 | venv 最终路径 generation POC | IA-001 | ADR-002、最小 POC 记录 | 空格/中文/两盘符环境构建后无 staging 引用；指针回滚通过 | 8h |
| IA-004 | Desktop 当前版 adapter 取证 | IA-001 | Desktop capability report、fixture | 识别 app/实例/backend/frontend/model dirs；零写入；列出自管文件 | 8h |
| IA-005 | Desktop 旧版/升级漂移矩阵 | IA-004 | adapter compatibility matrix | 至少当前版 + 一个旧版；升级后未知 schema fail closed | 8h |
| IA-006 | Core/Portable 只读 adapter | IA-001 | Core/Portable fixture、capability report | 能区分 layout/runtime/model paths；不 import custom nodes | 6h |
| IA-007 | H3 节点能力矩阵 | 无 | capability schema、锁定 commit 列表 | Base/Ref2VA/AddGuide/音频保存分别列 node ID、schema、最小认证 commit | 5h |
| IA-008 | 现有实例 attach-only 威胁模型 | IA-001, IA-006 | ADR-005、恶意 fixture | 静态扫描不执行代码；动态探测需授权且禁 custom/API nodes | 8h |
| IA-009 | Recipe schema 扩展 | IA-001, IA-007 | ADR-006、JSON Schema、示例 recipe | 可唯一描述 Python/torch/audio/vision/CUDA/frontend/Desktop/model/FFmpeg | 8h |
| IA-010 | Python/Torch/CUDA 认证档 | IA-009 | ADR-010、首批 profile manifest | 驱动/GPU/Python ABI/wheel 组合明确；不依赖系统 Toolkit | 8h |
| IA-011 | Stable wheelhouse 构建规范 | IA-009 | lockfile、wheel inventory、安装命令规范 | no-index、only-binary、require-hashes；全部传递依赖有 hash；`pip check` 通过 | 8h |
| IA-012 | Comfy frontend/Manager 离线封装 | IA-009 | ADR-012 子项、frontend artifact | 断网启动不解析 latest；Manager 默认关闭；前端 hash 锁定 | 6h |
| IA-013 | TUF/等价更新 POUF | IA-001 | ADR-007、root/targets/snapshot/timestamp 样例 | 回滚、冻结、过期、channel 混用、轮换测试设计通过 | 10h |
| IA-014 | Windows 签名与发布密钥方案 | IA-001 | ADR-008、签名流水线设计 | installer/updater/uninstaller/helper 可签名验签并带 RFC3161 时间戳 | 6h |
| IA-015 | 下载 sidecar/Range 协议 | IA-013 | 下载状态 schema、协议测试 | 206/Content-Range/ETag/length/redirect 异常均按规范处理 | 8h |
| IA-016 | 事务 journal 与 mutex 状态机 | IA-002, IA-003, IA-015 | ADR-009、状态机、恢复表 | 重入、并发、断电、磁盘满均能恢复；旧 active 不损坏 | 10h |
| IA-017 | 安全解压测试语料 | IA-002 | ADR-014 子项、恶意 archive corpus | zip-slip、ADS、device name、symlink、bomb、超限全部拒绝 | 8h |
| IA-018 | Reparse/路径 containment POC | IA-002 | Windows 路径安全库接口、测试 | junction swap、UNC、大小写/尾点不能越界写删 | 10h |
| IA-019 | 模型 manifest 与 Safetensors 指纹 | IA-007, IA-009 | ADR-011 子项、model manifest schema | 角色/dtype/tensor 摘要/hash/revision/compatibility 可验证 | 8h |
| IA-020 | 分层模型扫描器规格 | IA-019 | scanner state machine、性能基线 | 打开页不对所有大文件全 hash；选中后认证；取消/缓存失效正确 | 8h |
| IA-021 | HF/HF-Xet 缓存适配 | IA-002, IA-019 | HF cache report、环境 envelope | 覆盖 HF_HOME/HUB/XET/ASSETS/TOKEN；main 解析为 immutable revision；不删用户 cache | 7h |
| IA-022 | C 盘写入预算与 I/O 基线 | IA-002, IA-012, IA-021 | 干净 VM I/O 报告、DoD 数值 | 选 D 后无受管大型 artifact 落 C；可控日志轮转；OS 缓存单列 | 8h |
| IA-023 | Comfy loopback 启动器契约 | IA-006, IA-008, IA-012 | 启动参数/进程/端口协议 | 显式 127.0.0.1、随机可用端口、无通配 CORS、只管理自有进程树 | 7h |
| IA-024 | 回滚/项目迁移模型 | IA-003, IA-009, IA-016 | ADR-013、migration/rollback matrix | 工具/runtime/Desktop/model/project 五类状态可独立恢复 | 8h |
| IA-025 | 所有权 ledger 与安全卸载 | IA-016, IA-018 | 卸载 schema、删除预览、测试 | 只删 managed_by_tool；外部模型/项目默认保留；reparse 下不越界 | 8h |
| IA-026 | 非 Python 供应链与 SBOM | 技术栈决策, IA-013, IA-014 | ADR-015、SBOM/provenance 方案 | 包管理锁冻结、CI 依赖 pin、发布 artifact 可追溯 | 8h |
| IA-027 | 干净 VM 端到端安装验收架 | IA-003, IA-016, IA-022, IA-023, IA-025 | Windows 10/11 VM 自动验收 | 全新/已有模型/已有 Desktop、断网生成、更新失败、卸载保护均有报告 | 16h |
| IA-028 | 故障注入与恢复演练 | IA-016, IA-024, IA-025, IA-027 | chaos test suite | 各事务点强杀、盘满、盘符移除、文件锁定后不半安装、不误删 | 12h |
| IA-029 | 安装页组件说明与空间模型 | IA-002, IA-009, IA-021 | UI 字段 schema、文案、每卷空间表 | 每组件显示用途/必需/复用/下载/最终/峰值/许可证；FL2VA 与 runtime 清晰拆分 | 6h |
| IA-030 | Phase 0 安全/合规总门复审 | IA-004–IA-029 相关 P0 | 复审报告 | 所有 P0 有 ADR、实现约束、自动验收；否则只允许内部原型 | 6h |

可并行分组：

- 组 A（立即并行）：IA-001、IA-002、IA-004、IA-007、IA-013。
- 组 B（基础契约完成后）：IA-003、IA-006、IA-009、IA-014、IA-017、IA-019。
- 组 C（实现规格）：IA-008、IA-010～IA-012、IA-015～IA-016、IA-018、IA-020～IA-025。
- 组 D（发布验收）：IA-026～IA-030。

## 最先可执行的 5 个任务

1. **IA-001：冻结组件/所有权边界。**这是所有安装、复用、更新和卸载决策的共同前提；先明确 Desktop 与外部模型默认只读。
2. **IA-004：完成当前 Comfy Desktop adapter 取证。**直接验证多实例记录、模型路径、工作流打开和自管配置，避免后续 UI/安装器建立在旧版 Desktop 假设上。
3. **IA-003：验证“最终绝对路径 generation + active pointer”。**尽早否决 staging 搬移 venv 的错误实现，并为更新回滚奠定目录结构。
4. **IA-013：写更新信任 POUF。**在开始下载器前锁定 manifest 角色、anti-rollback、密钥轮换和 Stable/Testing 隔离，避免后期推翻协议。
5. **IA-007：建立 H3 节点能力矩阵。**把 v0.30.0 的历史版本下界转换成 Base/Ref2VA/AddGuide 等可机器验收的 node ID/schema 条件，供 scanner、recipe 和工作流编译器共同使用。

上述五项可以由五个 Agent 并行推进；其完成后，IA-002、IA-006、IA-009、IA-014、IA-019 可无歧义进入下一批。
