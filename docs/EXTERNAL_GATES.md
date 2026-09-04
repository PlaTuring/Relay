# Human and External Gates

> Task：`P0-GOV-003`  
> 用途：记录不能由制作 Agent 自行关闭的许可、签名、硬件和品牌依赖  
> 规则：Agent 可以准备证据包和提出建议，但只有表中 Human/External Owner 能把 gate 从 `OPEN/PARTIAL` 改为 `CLOSED`。

## 1. Gate 状态

| 状态 | 含义 |
|---|---|
| `OPEN` | 尚无负责人签核或必要证据不完整；所有依赖能力保持`internal/poc_pending/hidden` |
| `PARTIAL` | 已有部分材料，但结论不覆盖实际发布物、地域、版本或主体 |
| `CLOSED` | 指定 owner 对准确发布物、版本、地域和阶段给出可审计签核；变更触发后会重新打开 |

初始状态均为 `OPEN`。本文件不把 Agent 的许可证摘要当成法律批准，也不把“已有一台显卡”当成硬件认证。

## 2. External Gate 总表

| Gate ID | Gate | 初始状态 | Human/External Owner | 阻断阶段 | 所需证据 | 关闭决定 | 失败/未关闭降级 |
|---|---|---|---|---|---|---|---|
| `EXT-H3-LICENSE` | H3地域、权重/量化/LoRA来源与许可、AUP、下游限制、商业和AI披露 | `OPEN` | `<待指定：法务负责人>` + `<待指定：产品所有者>` | Alpha-1任何外测；1.0公开发布；H3文件下载入口 | 目标发行地域与主体；当前许可/AUP文本和hash；逐文件provenance；下载/引用/转分发方式；NOTICE；商业UI“MiniMax H3”文案；收入授权判断；用户条款/违规报告/安全防护；AI披露策略 | 法务签核ID、适用版本、地域、有效期 | 仅内部技术PoC；不向外部提供下载/安装包；Turbo/Ref等未清文件保持hidden |
| `EXT-COMFY-CORE` | managed ComfyUI Core分发/修改与GPL义务 | `OPEN` | `<待指定：开源合规/法务负责人>` | Alpha-1外部安装包；1.0 | 精确Core commit/release；获取方式（独立下载/捆绑）；是否修改；GPL文本；对应源码/提供方式；NOTICE；进程与组合边界 | 发布物级开源合规签核 | Alpha-0仅内部受控环境；外测推迟或改为用户从官方源独立安装 |
| `EXT-COMFY-FRONTEND` | 锁定frontend、templates及其分发许可 | `OPEN` | `<待指定：开源合规/法务负责人>` | Alpha-1外部安装包；1.0 | 精确frontend artifact/version/hash；模板来源；许可证；修改记录；源码/NOTICE；不使用`latest`的证明。本仓库三份 H3 模板已固定为 Comfy-Org/workflow_templates MIT revision `71f43419e53dfcb16330748f3b933ac0efcc4778` 且逐字节匹配；该证据只覆盖模板，不覆盖 frontend 或模型 | 发布物级签核 | 不捆绑未批准frontend；仅内部PoC或引导官方安装 |
| `EXT-SOURCE-ASSET-PROVENANCE` | 仓库内非代码图片及新增第三方源码/资源的来源与再分发授权 | `CLOSED`（仅 1.0.2 精确文件） | Relay 发布所有者（2026-09-04 本轮提供与公开分发授权） | 相关文件进入公开源码或安装包前 | `platuring-avatar.png`，25,194 bytes，SHA-256 `138b2925844d1464ba7f5b4beb736c6fda4114c3c25127341069ebf497b2818e`；公开源码、About 与安装包包含关系；`THIRD_PARTY_NOTICES.md` 的非 Apache 边界 | 仅授权该精确文件随未修改 Relay 分发；不声明作者/权利人身份，不授予独立复用；替换任一字节即重新打开 | 未来任何未确认或替换文件仍从公开源码和打包输入排除；不得用 Apache-2.0 覆盖未知权利 |
| `EXT-RUNNER-DIST` | 自有`H3LongVideoRunner`/frontend extension许可证及与GPL进程内组件关系 | `OPEN` | `<待指定：法务负责人>` + `<待指定：架构负责人>` | 不阻断Alpha-0/Alpha-1；阻断任何16–60秒/自有节点外发与1.0相应功能 | runner是否custom node/独立进程；源码边界；拟用许可证；依赖图；修改/分发方式；源码与NOTICE策略 | 架构ADR + 法务签核 | Runner和长视频capability保持hidden；短视频原生Core路径继续 |
| `EXT-FFMPEG` | 实际FFmpeg/FFprobe构建、分发和codec专利路线 | `OPEN` | `<待指定：开源合规/法务负责人>` + `<待指定：发布负责人>` | Alpha-1若捆绑/下载FFmpeg；1.0视频处理功能 | 实际binary来源、版本/hash、`-buildconf`、启用codec、LGPL/GPL/nonfree判断、对应源码与构建材料、NOTICE/About、目标市场codec专利评估 | 发布物级签核 | 优先使用已证明不需私有FFmpeg的Core输出；否则只内部PoC，不对外分发最终处理组件 |
| `EXT-COMFY-CLI` | comfy-cli采用、GPL分发、云/Partner/telemetry与供应链边界 | `OPEN` | `<待指定：架构负责人>` + `<待指定：开源合规负责人>` | 仅当Alpha或1.0采用/捆绑comfy-cli时阻断对应阶段 | 是否使用决定；精确wheel/version/hash；独立进程或库；GPL材料；显式workspace/local；禁遥测；无token/cloud继承；命令allowlist；网络与C盘trace | “不采用”ADR或采用路线的架构+法务签核 | Alpha默认不采用通用CLI；用自有固定manifest/runtime materializer |
| `EXT-DESKTOP-DIST` | Comfy Desktop检测、官方引导、自动安装或一体分发边界 | `OPEN` | `<待指定：法务负责人>` + `<待指定：产品所有者>` | 不阻断managed Core Alpha；阻断Desktop捆绑/自动安装和公开宣传 | 实际Desktop版本；检测/引导/下载/捆绑/修改方式；AGPL或商业许可路线；源码/NOTICE；官方安装器签名与更新边界 | 发布物级签核 | Desktop仅只读检测和手动workflow导出；不捆绑、不自动安装 |
| `EXT-SIGNING` | Windows Authenticode证书、时间戳和私钥托管 | `OPEN` | `<待指定：组织管理员/发布负责人>` | Alpha-1任何外部`.exe/.msi`；1.0 | 合法组织证书；publisher名称；RFC3161时间戳；签名/验签命令；私钥存储与访问控制；吊销/续期；CI审批；安装器/updater/uninstaller/helper覆盖清单 | 发布负责人签名验收记录 | 仅内部hash标识build，不提供外部普通用户安装包 |
| `EXT-HARDWARE` | 首个真实可用硬件与认证profile | `OPEN` | `<待指定：硬件/QA负责人>` | Alpha-0进入GPU/H3冒烟；Alpha-1支持声明 | 实际机器资产ID；Windows build；GPU/SKU/VRAM/compute capability；driver；RAM/磁盘；recipe；模型精度；5秒T2VA成功、峰值VRAM/RAM/磁盘/耗时；可重复次数 | QA签核首个`hardware_profile_id` | 无GPU证据时只做无模型contract tests；不声称任何显卡受支持 |
| `EXT-BRAND-ASSET` | 用户品牌名称、logo/水印资产和使用规范 | `OPEN` | `<待指定：品牌/产品所有者>` | 不阻断Alpha-0/Alpha-1；只阻断品牌水印capability和1.0相应功能 | 原始矢量/高分辨率资产；品牌名；颜色/透明度；横竖屏安全区；最小尺寸；位置；是否可关闭；版权/使用授权；验收样例 | 品牌负责人签核asset版本 | `CAP-BRAND-WATERMARK=hidden`；不生成临时logo；H3归属与AI披露照常独立执行 |

## 3. Gate 详细要求

### EXT-H3-LICENSE

官方事实基线只用于准备问题，不代表本 gate 已关闭：

- MiniMax H3 当前由 [MiniMax H3 Community License](https://huggingface.co/MiniMaxAI/MiniMax-H3/blob/main/LICENSE) 管理；地域、分发、商业UI、下游限制、安全防护和公开披露都需按实际主体/发行方式解释。
- Comfy-Org H3仓库自称重打包文件，且模型链包含MiniMax、LightX2V、Qwen/量化发布者；最终仓库顶部一个license badge不能代替逐文件来源链。
- Turbo LoRA、Ref2VA和社区embedding与Alpha基础文件分开决策；未关闭时保持hidden。

最小证据包：

```text
legal/H3/
├─ target-territories-and-entity.pdf
├─ license-and-aup-snapshots.json
├─ per-file-provenance.csv
├─ distribution-decision.md
├─ user-terms-and-reporting.md
├─ attribution-and-ai-disclosure.md
└─ signoff.json
```

### EXT-COMFY-CORE / EXT-COMFY-FRONTEND / EXT-RUNNER-DIST

三个 gate 必须分开，不能用“ComfyUI是开源的”一次性关闭：

- Core与frontend可能有不同artifact、修改和源码提供路径；
- 本工具与managed Core保持独立控制/数据平面，不等于自动免除分发义务；
- 自有Runner若作为进程内custom node加载，必须单独评审其许可证和组合边界；
- Alpha-0不含Runner，因此Runner gate不能阻塞短视频垂直切片。

### EXT-FFMPEG

先由技术PoC关闭 `TG-FFMPEG-001`：确认短视频workflow是否真的需要应用私有FFmpeg。只有实际选定binary后，法务才能依据 [FFmpeg Legal](https://ffmpeg.org/legal.html) 审查构建和codec；抽象讨论“FFmpeg通常是LGPL”不能关闭gate。

### EXT-COMFY-CLI

默认决定是“不进入Alpha主路径”，除非架构PoC证明其明显降低风险。若采用，证据必须包含：

- 固定版本与hash；
- 独立进程，不把GPL模块嵌入闭源进程的架构说明；
- 显式受管workspace、显式local路由；
- `COMFY_NO_TELEMETRY`/`DO_NOT_TRACK`等有效策略；
- 清除cloud/API/token默认状态；
- 禁止`setup`、`latest/nightly`、`update all`、Partner generate和未知node安装脚本；
- 网络、文件写入和失败post-condition实测。

官方能力与许可证依据：[comfy-cli README](https://github.com/Comfy-Org/comfy-cli/blob/main/README.md)。

### EXT-SIGNING

制作Agent可以实现签名流水线和验签测试，但不能：

- 购买或代表组织申请证书；
- 自行决定publisher法人名称；
- 把开发自签名证书当成外部可信签名；
- 把普通SHA-256文件摘要当成Authenticode。

外部发布证据应包含Microsoft [SignTool](https://learn.microsoft.com/en-us/windows/win32/seccrypto/signtool) 的签名、验签和RFC3161时间戳结果。

### EXT-HARDWARE

首个profile必须绑定一台实际机器，不允许先写“16GB/24GB显卡应该可以”。硬件负责人需要提供可排他使用的测试窗口；GPU-H3、MODEL-DOWNLOAD和WIN-VM仍受仓库资源锁约束。

最低记录：

```text
hardware_profile_id
asset_owner
Windows edition/build
GPU exact name/device id/VRAM/compute capability
NVIDIA driver
CPU/RAM
install volume/filesystem/free space
runtime recipe + all hashes
5s T2VA fixture + seed
pass count / attempts
peak VRAM/RAM/temp disk
wall time
output ffprobe summary
known limitations
```

### EXT-BRAND-ASSET

品牌水印是后处理扩展，不是Alpha安装门，也不替代：

1. 商业界面的`MiniMax H3`模型归属；
2. 对公众生成内容的AI披露；
3. 输出元数据清理。

资产到位前任何Agent不得制作“临时正式logo”或把文字占位写入默认成片。

## 4. 阶段阻断关系

### Alpha-0 内部垂直切片

必须由Human关闭或提供：

- `EXT-HARDWARE`：至少关闭到一个内部`hardware_profile_id`可用；
- `EXT-H3-LICENSE`：内部测试主体/地域/权重获取至少有书面可执行确认。若仍OPEN，只允许无模型contract测试。

不阻断Alpha-0但必须保持功能hidden：

- Runner、Desktop分发、签名证书、品牌资产；
- FFmpeg/comfy-cli仅在技术路线选择实际使用它们时才阻断相应内部PoC之外的交付。

### Alpha-1 受控外测

至少关闭：

```text
EXT-H3-LICENSE
EXT-COMFY-CORE
EXT-COMFY-FRONTEND
EXT-FFMPEG（若分发/下载）
EXT-COMFY-CLI（若采用）
EXT-SIGNING
EXT-HARDWARE
```

Desktop与Runner gates没有关闭时，相应capability保持hidden，不应阻断managed Core短视频外测。

### 1.0 公开发布

- 上述Alpha-1 gates持续有效并覆盖实际1.0版本；
- 启用Runner/长视频时关闭`EXT-RUNNER-DIST`；
- 启用Desktop捆绑/自动安装时关闭`EXT-DESKTOP-DIST`；
- 启用品牌水印时关闭`EXT-BRAND-ASSET`；
- 新模型、LoRA、FFmpeg构建、frontend、地域或法人主体变化会重新打开相应gate。

## 5. Owner 回填模板

每个Human/External Owner接受任务后，应补充：

```text
gate_id:
owner_name:
owner_role:
contact_or_team:
decision_scope:
target_stage:
due_date:
evidence_location:
state: OPEN | PARTIAL | CLOSED
decision_summary:
approved_versions_or_artifacts:
approved_territories_or_hardware:
expiry_or_revalidation_trigger:
signature_or_ticket_id:
```

禁止只写“法务已看”“硬件已测”“证书已有”等不可审计描述。

## 6. Agent 工作规则

- Agent 可以收集官方材料、生成SBOM/NOTICE草案、编写测试和证据索引。
- Agent 不得把自己的法律解释、品牌偏好或单机成功记录为Human签核。
- Gate仍为`OPEN/PARTIAL`时，依赖capability最多为`internal`；外部构建必须隐藏或阻止。
- Gate关闭必须引用准确版本、hash、地域/profile和实际发布方式；泛化批准无效。
- 本文件状态变化应由Root Integration Agent审核，并同步到任务调度；本任务不修改registry或schema。
