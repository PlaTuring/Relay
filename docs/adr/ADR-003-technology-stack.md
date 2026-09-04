# ADR-003：Alpha 控制平面技术栈

- **状态：** Accepted — Root 于 2026-08-27 完成候选证据与信任边界主审
- **日期：** 2026-08-27
- **任务：** `P0-ARC-005`
- **决策所有者：** Root Integration / Architecture Owner
- **候选证据：** Accepted `P0-ARC-002` Electron、`P0-ARC-003` Tauri、`P0-ARC-004` .NET
- **上游约束：** Accepted ADR-001、ADR-002、ADR-004、ADR-011、ADR-015；ADR-014 为历史通道决策
- **适用范围：** Alpha Windows application UI、control-plane service、packaging adapter与必需native helper边界
- **不决定：** H3/Comfy模型能力、workflow/recipe内容、installer许可结论、硬件支持、Desktop adapter或长视频能力

## 1. 背景与不可变产品边界

Alpha需要选择一个可立即进入生产脚手架的Windows UI/control-plane stack。保留Electron、Tauri、.NET三套实现会把installer、路径、process ownership、schema、diagnostics、accessibility和测试矩阵复制三次，也会让未运行的static fixture与真实packaged证据混为一谈。

本工具只负责安装、检测、验证、配置、workflow编译、受管Comfy启动与交接。它不得：

- 生成视频或音频、提供工具侧Generate/Run按钮；
- 调用`/prompt`、等价queue/executor submit，或替用户操作ComfyUI Run；
- 扩写/分类/创作prompt、故事、分镜、对白或音乐；
- 使用云/Partner推理、隐藏上传或本地失败后的远程fallback；
- 在运行期通过pip/npm/Git/Manager补依赖；
- 打包self-updater、remote catalog或后台update check；ADR-015 仅允许固定 GitHub Stable Release 的用户主动检查与校验下载唯一 Setup，且不能执行安装包。

用户在当前可见、已验证的ComfyUI frontend中亲自点击 **Run** 后，MiniMax H3才生成实际视频和原生音频。UI技术栈选择不改变ADR-001/002的这一边界。

## 2. 决策

### 2.1 Alpha唯一栈

Alpha选择：

> **Electron + TypeScript 作为唯一application UI与control plane；一个独立、窄、版本化、发布时签名的Win32 native helper负责强Windows process/path assurance。**

Electron不成为推理后端，不包含H3，不取代ComfyUI。它只提供安装向导、检测结果、项目表单、workflow编译、诊断和Comfy交接。Comfy Managed Core仍是ADR-002规定的唯一Alpha执行拓扑。

`P0-ARC-002`使用Electron `44.0.0`形成当前host证据基线；这**不是**生产版本下限、长期固定版本或允许解析`latest`的规则。每个发布版本必须在immutable build manifest中固定一个经过安全评审的exact Electron/Chromium/Node组合及其hash，并重新完成本文release gates。

Native helper的wire contract和职责在本文固定；helper的Rust/MSVC或最小C/C++实现语言由专门的`P0-ARC-010` PoC在同一职责边界内选择。一个Alpha build只能包含一个helper实现，不能运行时切换。helper语言不是第二UI栈；变更helper语言、ABI或信任模型必须重开本ADR。

### 2.2 进程与信任结构

```text
Sandboxed local Electron renderer
  form UI only; no Node/filesystem/process/network/generic invoke
                 |
                 | frozen, exact, versioned contextBridge methods
                 v
Electron main/control-plane services
  contracts, installer transaction, detection, workflow compilation
  no generic shell, no formal queue client, no Comfy Run bridge
                 |
                 | inherited private pipes; exact helper protocol
                 v
Signed narrow Win32 helper
  volume/handle/reparse identity + owned path commit
  suspended create -> non-breakaway Job -> verify -> resume
  loopback socket/PID identity + owned stop
                 |
                 v
Pinned Managed Comfy Core + locked frontend
  user visibly clicks Run -> H3 generates media
```

Locked Comfy frontend必须使用独立BrowserWindow/session partition，只允许已验证的owned loopback origin；不得复用control UI preload，也不得获得tool bridge、Node或任意native capability。它可以在真实用户Run后向其owned Comfy backend提交任务，但工具main/preload/helper在此之前的正式submit计数必须为零。

### 2.3 本决策不是对所有生产门的通过声明

Electron被选择是因为它具有当前唯一的runtime/package证据与可安全收窄的条件路径；并不表示以下项目已通过：

- native Job Object/handle/reparse helper；
- exact Comfy workflow focus与user-Run关联；
- signed installer/helper/uninstaller；
- 非管理员install/repair/upgrade/uninstall VM行为；
- offline/hermetic/reproducible packaging；
- production packaged SBOM和完整许可notice；
- Narrator、全键盘、高对比、200%缩放；
- 24小时profile/log/C盘预算；
- packaged进程树zero-egress与断网generation repeat。

上述仍是外测/发布阻断门。选栈只消除三套UI实现分支，不升级任何blocked capability。

## 3. 决策方法：先证据等级，后门禁

本ADR不计算会让`static-only`冒充runtime pass的总分。每个维度先使用以下等级：

| 等级 | 含义 | 能否满足Alpha runtime gate |
|---|---|---|
| `runtime_proven` | 当前accepted PoC真实编译/运行/打包并可重复 | 可以，但只覆盖其已测边界 |
| `static_only` | source/config/fixture可审查，未由目标runtime执行 | 不可以 |
| `blocked` | 缺工具链/artifact/外部条件或实验失败 | 不可以 |
| `external` | 需签名、VM、法务、硬件或独立native gate | 不可以，直到外部门关闭 |

### 3.1 Alpha可执行性门

| Gate | Electron | Tauri | .NET |
|---|---|---|---|
| 当前批准host可build/test | `runtime_proven` | `blocked`：无Rust/Cargo/Tauri/MSVC/SDK | `blocked`：无现代.NET SDK/Desktop pack/SDK |
| packaged UI/bridge可运行 | `runtime_proven` | `blocked` | `blocked` |
| 可形成installer artifact | `runtime_proven`：NSIS已构建，未签名/未VM | `blocked` | `blocked` |
| 产品边界/no updater/public evidence | runtime + static policy evidence | `static_only` | `static_only` |
| 强process/path native assurance | `external` | `external` | `external` |

当前host toolchain只是**Alpha交付可行性事实**，不是Electron的内在质量优势，也不是Tauri/.NET的永久劣势。它仍足以决定现在只能让Electron进入生产脚手架；把另外两者的静态设计算作runtime通过会违反证据规则。

### 3.2 同维度证据矩阵

| 维度 | Electron | Tauri | .NET | Alpha解释 |
|---|---|---|---|---|
| 实现速度/反馈 | `runtime_proven`：strict TS、17 tests、packaged self-test | `static_only/blocked` | `static_only/blocked` | Electron唯一可立即迭代 |
| package/C盘 | `runtime_proven`：95.18 MiB installer、365.90 MiB unpacked | `blocked` | `blocked` | Electron成本已知且偏大；其他候选不能填推测值 |
| dependency/SBOM | npm lock与384-component build SBOM `runtime_proven`；packaged binary SBOM `blocked` | Cargo graph `blocked` | SDK/NuGet/runtime graph `blocked` | Electron有起点，不是完整供应链证明 |
| renderer/service隔离 | packaged sandbox/contextIsolation/no Node/4-channel bridge `runtime_proven` | config/source `static_only` | typed service source `static_only` | Electron胜出，但production channel需重新注册 |
| native picker | Electron directory dialog已运行；人工UX仍`external` | `blocked` | API source `static_only` | 只选择器行为不代表安全path identity |
| Unicode/path shape | unit/runtime `runtime_proven` | JS oracle；Rust `blocked` | JS oracle；C# `blocked` | handle/volume/reparse对三者均`external` |
| direct child | dev+packaged direct child `runtime_proven` | source `static_only` | source `static_only` | Electron普通spawn不是生产Job containment |
| Job/process tree | `blocked/external` | `blocked/external` | `blocked/external` | 必须共享native helper，不因UI栈弱化 |
| installer | assisted NSIS build `runtime_proven`；真实per-user行为`external` | `blocked` | `blocked` | 继续NSIS baseline，但VM/签名未过 |
| signing | NotSigned结果`runtime_proven`，合规发布`external` | `blocked` | `blocked` | 未签名只能内部evidence |
| accessibility | semantic/focus/reduced-motion `static_only`；人工/AT `external` | `static_only` | `static_only` | 三者都不能宣称等级 |
| offline build | offline verify `runtime_proven`；offline package `blocked` | build `blocked` | build `blocked` | 不得声称离线/可复现打包 |
| updater边界 | 无updater package/config `runtime_proven` + ADR-011 policy | policy `static_only` | policy `static_only` | Alpha统一无self-updater |
| startup/idle memory | `blocked` | `blocked` | `blocked` | 不参与正向评分，后续同夹具测量 |
| testability | unit/dev/packaged probe `runtime_proven` | static verifier only | static verifier only | Electron当前风险反馈最快 |

## 4. Electron application边界

### 4.1 Renderer

所有control UI renderer必须：

- 只加载签名package中的local assets；不得加载远程代码、字体、脚本、图片或模板；
- `sandbox=true`、`contextIsolation=true`、`nodeIntegration=false`、`webviewTag=false`；production不得出现`--no-sandbox`；
- CSP默认`default-src 'self'`，control UI使用`connect-src 'none'`；
- 无`require`、`process`、filesystem、child process、raw socket、generic HTTP或clipboard自动化；
- 不接受或渲染untrusted HTML；用户文本只用text node/property绑定；
- `window.open`、非local navigation、permission request和未知download全部拒绝；
- 只拿到冻结的、按业务命名的contextBridge methods，不拿到`ipcRenderer.send/invoke/on`。

Electron官方说明sandboxed renderer没有Node环境，但preload仍比页面更有权限，必须同时使用context isolation并只暴露最小API。参考：[Electron process sandbox](https://www.electronjs.org/docs/latest/tutorial/sandbox)、[Electron security](https://www.electronjs.org/docs/latest/tutorial/security)。

### 4.2 Preload与Electron IPC

- 每个method使用exact channel、exact request/response schema和exact sender/frame/origin校验；
- request遵守ADR-004的UTF-8、version、size、unknown-field、sensitivity和deterministic error规则；
- renderer不能提供executable、cwd、environment、raw argument array、URL、shell text或generic operation name；
- channel registry作为materialized build inventory进入no-self-update/security lint；未知channel使build失败；
- preload不保存prompt/token/path，不转发raw error/stack；取消使用typed request ID，不暴露EventEmitter；
- 普通UI、Comfy frontend window与技术smoke使用不同session/preload/namespace，不能互相调用。

Prototype的四channel只是技术栈证据，不是production完整API。Production新增method必须有owner、schema、positive/negative fixture和最小权限审查；不得加入`exec`、`run_command`、`shell`、`open_any_url`、`call_endpoint`、`submit_graph`或等价generic bridge。

### 4.3 Electron main/control plane允许职责

Electron main中的TypeScript service可以：

- 读取内嵌immutable component catalog和版本化合同；
- 执行硬件/磁盘observation、model静态发现、hash/manifest验证和recipe选择；
- 在用户明确安装/修复阶段从内嵌catalog的exact source下载immutable artifact，并在激活前校验length/hash/license gate；
- 创建项目、绑定用户原始prompt/素材/技术参数、编译并lint canonical visual workflow；
- 调用native helper的exact path/process operations；
- 访问已拥有loopback backend的固定read-only health/identity/schema surface；
- 打开/聚焦锁定Comfy frontend并停在`AWAITING_USER_RUN`。

它不得：

- 直接spawn Python/Comfy/FFmpeg/custom node；production `child_process`只允许启动manifest中exact native helper；
- 使用`cmd.exe`、PowerShell、shell string、用户PATH或全局Python；
- 包含通用Comfy HTTP client、`/prompt`client、generic endpoint client或Run bridge；
- 动态加载外部JS/native addon、未知plugin、Desktop私有状态或任意custom node；
- 在Comfy execution期间下载、安装、修复或更新component；
- 因本地失败切到cloud/Partner或自动重投。

## 5. 必需的窄Win32 native helper

### 5.1 为什么必须独立helper

Node path string与普通`spawn()`不能证明：

- local fixed NTFS、volume identity、nearest existing ancestor/file ID；
- reparse/device/ADS/8.3 alias与create/open后的handle-resolved target；
- TOCTOU期间path未换到root外；
- child在执行第一条Python/Comfy/第三方代码前已进入non-breakaway Job；
- PID、creation time、image identity、Job membership与loopback listener属于同一owned tree。

因此这些能力不得散落到renderer、npm native addons、PowerShell或多个helper。Alpha使用一个无UI、无网络、无plugin、无需管理员权限的native broker（工作名`minimaxh3-winbroker.exe`）。它只接受下一节的closed operations。

### 5.2 Helper允许的operation families

| Family | 允许行为 | 输出/authority |
|---|---|---|
| `inspect_volume_candidate` | 读取指定候选的drive type、filesystem、volume identity、free space和能力 | 返回bounded observation；不创建/扫描内容 |
| `validate_path_identity` | 规范化user-selected root/external read-only path；逐段检查reparse/device/ADS/containment；open handle后复验 | 返回进程内opaque `path_ref`、volume/file identity与policy result，不把raw path写日志 |
| `prepare_owned_root` | 在用户确认的validated fixed-NTFS候选中安全创建/打开tool-owned root和owner marker | 只有owner/empty/conflict规则通过才返回`owned_root_ref` |
| `materialize_owned_artifact` | 在helper持有的owned target中接收一条有长度上限的byte stream，校验expected length/hash，安全commit/rename | 不接受URL、不联网；只写manifest指定artifact role |
| `commit_owned_state` | 对generation pointer/小型authority state执行same-directory atomic replace与handle复验 | 只接受exact contract/hash/CAS revision，不做通用move/copy/delete |
| `launch_managed_core` | 从已验证generation/launch manifest解析固定entrypoint、arg template和最小env；suspended create、Job assign/verify后resume | 返回opaque `launch_ref`、PID+creation time+image/hash+Job identity |
| `verify_loopback_owner` | 把指定`127.0.0.1`listener/socket映射到exact launch Job/process identity | 只验证本次launch；不扫描或连接任意endpoint |
| `query_or_stop_owned_launch` | 查询identity/exit；先请求已批准graceful stop，超时关闭/终止exact Job | 只接受`launch_ref`；未知PID/identity零mutation |

`materialize_owned_artifact`不把helper变成downloader：HTTPS、resume、rate/proxy UX留在main的显式安装transaction；helper只接收当前embedded catalog已批准artifact的bytes与exact identity，并安全落盘。若该stream设计不能在PoC中保持bounded/backpressure/cancellation/hash/cleanup，失败回退是保持安装能力blocked，而不是允许main按字符串路径写入authority目录。

外部模型永远read-only。Helper可以验证identity并返回opaque reference，但不得移动、重命名、覆盖或删除外部模型。Uninstall/cleanup的任何destructive operation不在上述Alpha通用表面；未来必须增加单独typed operation、ownership/lease/containment proof和ADR，不能复用`commit`伪装删除。

### 5.3 Helper明确禁止

Helper不得拥有：

- `exec/run/spawn arbitrary`、generic shell、script、PowerShell/cmd、PATH lookup；
- 任意filesystem read/write/list/delete、任意registry mutation或service/task creation；
- 任意URL/HTTP/socket client、DNS、cloud、telemetry、update或download；
- prompt、素材内容、workflow执行、Comfy `/prompt`、queue或GPU职责；
- plugin/addon/dynamic DLL search、外部config、环境继承或运行期dependency install；
- 管理员提权、Windows service、常驻tray/background scheduler；
- 按PID/name杀进程、attach existing Comfy/Desktop或接管未知Job。

新增helper operation至少需要protocol MINOR/MAJOR分类、negative fixture、安全owner审查和本文re-review；不能靠自由字符串`operation`启用隐藏能力。

### 5.4 Helper协议

Electron main与helper只通过创建helper时继承的private anonymous pipe handles通信，不监听TCP/命名公共endpoint。协议必须：

- control frame使用length-prefixed、bounded UTF-8 JSON/JCS message；artifact bytes使用先由已授权control frame创建的独立`stream_ref`与length-prefixed raw frames，绝不base64/嵌入JSON；message/chunk/total length均由contract固定，超限在分配前拒绝；
- 遵守ADR-004：exact`contract_id`、`schema_version`、`document_id`、integrity、closed core、UUID request/correlation、unknown field/enum fail closed；
- handshake绑定app version、helper exact version、helper artifact hash、publisher identity、parent PID+creation time和随机session nonce；nonce只存在内存，不进ordinary log/support bundle；
- request只含closed operation discriminator和对应strict branch；不存在generic executable/args/env/path mutation branch；
- response使用deterministic error tuple，只回path ID/分类，不回私有绝对路径、prompt、token或raw Win32 message；
- helper启动时拒绝非预期parent image/hash/publisher；Electron main拒绝helper hash/signature/protocol不匹配；
- 每个app build只接受embedded manifest中的exact helper tuple，不使用`>=`、PATH发现或系统同名binary。

Production app关闭`ELECTRON_RUN_AS_NODE`、`NODE_OPTIONS`和CLI inspect相关fuses，启用embedded ASAR integrity与only-load-from-ASAR，并在签名前自动验证。官方说明这些fuses默认并非全部处于安全取值；ASAR integrity在Windows需配合only-load-from-ASAR才不能被其他app path绕过。参考：[Electron fuses](https://www.electronjs.org/docs/latest/tutorial/fuses)、[ASAR integrity](https://www.electronjs.org/docs/latest/tutorial/asar-integrity)。

### 5.5 Launch与crash不变量

`launch_managed_core`必须：

1. 从`owned_root_ref + generation_id + exact launch_manifest hash`解析helper允许的entrypoint/args/env；用户prompt/素材不得成为process argument；
2. 用handle解析并hash验证private Python/entrypoint；
3. `CreateProcessW(..., CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT, ...)`，不经shell；
4. 创建不允许`BREAKAWAY_OK/SILENT_BREAKAWAY_OK`且带`KILL_ON_JOB_CLOSE`的Job；
5. 把suspended child assign到Job并复验membership/image/creation identity；
6. 任一步失败时在仍suspended状态用原handle终止，绝不resume后补绑；
7. 全部通过才resume，并持有Job handle直到本次owned instance停止。

Helper监视Electron parent handle和private pipe。Electron崩溃/pipe断开或helper自身崩溃时，Job handle关闭并终止其owned tree；helper不能作为孤立服务继续。Electron重启不得attach旧PID；未知process零mutation。Comfy crash后按ADR-001/002重新验证并等待用户再次Run，绝不自动重投。

## 6. Filesystem与path责任分配

| 责任 | Electron main | Native helper |
|---|---|---|
| 显示用户原始选择、解释原因 | 是 | 否 |
| 业务policy/managed-root候选排序 | 是 | 返回facts，不作产品决策 |
| volume type/NTFS/free-space/file ID | 不自行宣称 | 唯一authority |
| path lexical precheck | 可以，作为早期UX | 必须重新完整验证 |
| handle/reparse/TOCTOU containment | 不得按string prefix宣称 | 唯一authority |
| 下载URL/HTTP/resume UX | 仅显式install/repair、embedded catalog exact target | 无网络 |
| authority file create/commit | 只发typed transaction | helper持handle、校验hash后commit |
| external model mutation | 永远不得 | 永远不得 |
| cleanup/delete | 只作plan/显示 | Alpha helper无通用delete；独立gate后才可增加 |

Managed root保持ADR-002的一条用户确认fixed-NTFS root。D盘只有在native observation证明合格时才作为可见建议；没有合格D盘时要求用户选择其他真实候选，不静默落C。UI不得把prototype的path-shape pass升级成volume/reparse pass。

## 7. Installer、包体与C盘预算

### 7.1 已知基线

Electron spike当前测量：

| 项目 | 当前证据 | 解释 |
|---|---:|---|
| NSIS x64 installer | 95.18 MiB | 未签名、无blockmap；不是release artifact |
| unpacked Electron app | 365.90 MiB | Chromium/Electron固定成本显著 |
| packaged app.asar | 27.97 KiB | 业务壳很小，不能掩盖runtime成本 |
| 单次短self-test profile | 2.31 MiB | 不能外推长期增长 |
| dev `node_modules` | 527.50 MiB | build/CI供应链成本，不是用户安装体积 |

这些数值属于锁定spike，不是最终签名包承诺。加入production UI、helper、notices、SBOM、签名和installer页面后必须重新测量。

### 7.2 Alpha存储政策

- Electron app/runtime的per-user默认位置可能使用系统盘；产品不得承诺“C盘零写入”；
- installer摘要必须分别显示application预计占用、短期cache/profile/log预算和large managed root预算；
- 用户可以选择application安装目录，但最终per-user/无提权行为需VM证明；
- 模型、Managed Comfy/Python、artifact cache、temp media、project workspace和output不得静默写入C，仍进入用户确认的managed root；
- root选择前只允许bounded bootstrap settings；选择后所有可控cache/session/log重定向到managed root或明确禁用，并需要重启/测量证据；
- control UI不得持久化remote cookie/token；locked Comfy session使用独立partition并进入managed-root/C-budget测量。

外测前必须完成24小时idle+典型安装/编译/交接运行的C/D写入审计。若product owner拒绝最终Electron application/C预算，触发第13节Tauri重评；不得隐去Chromium成本或把app文件冒充model root数据。

### 7.3 Installer baseline

Alpha baseline保持assisted per-user NSIS：`oneClick=false`、`perMachine=false`、不主动提权、允许用户选择app目录、安装后不自动Run。它是当前唯一已构建格式，但尚未被clean VM认证。

Installer必须：

- 同时签名installer、application executable、native helper和所有可执行helper/uninstaller payload；
- 显示publisher、version、app location、managed root、C/D预算、component用途与许可入口；
- 不启动self-updater、不安装service/scheduled task、不修改全局Python/PATH；
- 不在安装结束后提交Comfy任务或生成测试作品；技术smoke另受ADR-001授权；
- repair/upgrade/uninstall只触碰ownership ledger证明的tool-owned对象，外部模型/实例保留。

## 8. Build、供应链与offline边界

### 8.1 当前事实

- 两次`npm run verify`在已安装依赖与不可用代理下通过；这证明typecheck/test/Electron self-test/SBOM/path lint可离线重复；
- 同约束的`npm run dist:win`因electron-builder尝试获取未缓存构件而失败；offline package **BLOCKED/未认证**；
- 一次受限联网、exact lock不变的spike package成功；这只证明online pinned spike package，不证明hermetic或可复现release build。

不得把“离线verify”写成“离线打包”，也不得把一个installer hash写成可复现证明。

### 8.2 Production build规则

- root/application lock固定所有npm package exact version/integrity；禁止`latest`、范围、Git branch和运行期install；
- Electron ZIP、Chromium/Node、NSIS、7zip、fuse tool、native helper/toolchain、Windows SDK/signtool分别记录immutable source、length、SHA-256、license与provenance；
- build在staged inputs后禁网运行；若仍尝试下载，release gate失败；
- build source、generated source、resolved lock、services/IPC/commands、bundle resources、helper manifest与opaque binaries全部进入ADR-011 adapter；
- 生成source SBOM、npm dependency SBOM和packaged binary/runtime SBOM；Electron/Chromium/Node、helper、NSIS/7zip和native runtime不能只靠npm lock覆盖；
- 对unsigned payload生成manifest/hash；若要声明reproducible，至少两个clean builder的normalized unsigned payload必须匹配，签名/timestamp层单独记录；
- no source map、test fixture、private builder log、absolute path、token或raw environment进入release/support bundle；
- installer signing后重新验签、hash、解包inventory和no-self-update scan。

在network-denied package与完整input manifest通过前，external Alpha不得声称offline/hermetic build；在双build匹配前不得声称reproducible。Root可以把reproducible claim保持blocked，但不能降低hash/provenance、SBOM、签名或staged-network-denied packaging门。

## 9. Security update SLA与无self-updater

ADR-011 对组件、catalog、后台检查、自动更新和安装执行继续完全适用。ADR-015 只允许主进程在用户主动操作时读取固定 GitHub Stable Release，并下载经过 API/HTTP 长度和 GitHub digest 双重校验的唯一 Setup；当前 app 永不启动它，SHA-256 也不替代 Authenticode。

Electron官方指出应用vendor必须升级所打包的Electron才能把安全修复交付给用户，并建议保持current supported releases；这正是选择Electron的持续成本，不是可选维护。参考：[Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security)、[Electron release timelines](https://www.electronjs.org/de/docs/latest/tutorial/electron-timelines)。

Release 工程采用下列 SLA；监控发生在开发/发行系统，不在用户 app：

| 严重性/相关性 | 处理SLA |
|---|---|
| Relevant Critical / renderer-main escape / code execution | 24小时内triage并暂停受影响build分发；upstream fixed stable可用后72小时内完成exact-version rebuild、全gate回归和签名replacement；无安全fix时继续撤回/禁用受影响surface |
| Relevant High | 2个工作日内triage；fixed release可用后7个自然日内发布签名replacement |
| Relevant Moderate/Low或无可达路径 | 记录reachability与owner；30个自然日内或下一版本（取较早）纳入，不能无限延期 |

每次Electron版本变更都重新跑packaged isolation、fuses/ASAR、IPC allowlist、native helper handshake、installer、no-self-update、SBOM/license、VM、accessibility smoke和zero-submit tests。若团队无法持续满足Critical/High SLA，立即暂停外测并触发第13节重评；不得因无self-updater而继续分发已知高危build。

## 10. Accessibility与小白UX门

选择Electron不改变产品的novice-first要求。Alpha control UI必须是form/wizard而非节点图：

- 首次安装明确显示组件用途、已有/缺失/复用状态、app location与managed root；
- 默认只询问真正影响技术路线的字段；不询问“故事/产品/口播”等内容类型，不扩写prompt；
- 项目创建绑定用户prompt/首帧/首尾帧与获批技术参数，编译并打开workflow；
- 最终状态清楚写“已在ComfyUI准备好，请检查后点击Run”，工具没有生成按钮；
- 错误用用户语言说明失败阶段、是否修改文件和安全回退，不显示stack/raw path/token；
- keyboard、focus order、44px target、visible focus、reduced motion、非颜色状态和可缩放layout进入自动/static gate。

External Alpha前必须在Windows实测：

1. 全键盘安装→root选择→项目创建→handoff；
2. Narrator/accessible name/live status/error summary；
3. Windows high contrast、200% scaling、窄窗口与中文/Unicode；
4. native directory dialog取消/选择后的focus恢复；
5. locked Comfy frontend window与control UI之间的可识别切换；
6. 无任何accessibility automation替用户点击Comfy Run。

没有这些证据只能称“有accessibility static foundation”，不能宣称WCAG或Windows accessibility等级。

## 11. Release gates

| Gate ID | 必须证据 | 未通过行为 |
|---|---|---|
| `TS-G01` Product boundary | 工具UI/IPC/helper无Generate、`/prompt`、queue、prompt创作、cloud fallback；user Run第一笔正式submit | build失败 |
| `TS-G02` Electron isolation | production packaged renderer sandbox/contextIsolation/no Node；local assets；exact sender/channel/schema；Comfy session隔离 | 外测阻断 |
| `TS-G03` Fuses/package integrity | RunAsNode/Node options/CLI inspect关闭，ASAR integrity+only-load启用并在签名前/后验证 | 外测阻断 |
| `TS-G04` Native helper | protocol、hash/signature、handle/reparse、suspended Job、listener identity、crash/negative fixtures全部通过 | Managed Core launch hidden；Alpha evidence-only |
| `TS-G05` Path/storage | fixed NTFS、free space、reparse/TOCTOU、Unicode、C/D写入、external-read-only和no silent C通过 | install/launch阻断 |
| `TS-G06` Installer VM | clean non-admin install、custom path、repair、N→N+1、rollback、uninstall/residue、disk-full/power-loss；无service/task/PATH | public installer阻断 |
| `TS-G07` Signing | 组织publisher、证书/私钥托管、RFC3161、installer/app/helper/uninstaller验签与post-sign inventory | 只允许internal evidence |
| `TS-G08` Supply chain/build | exact inputs/hash、network-denied package、full materialized inventory、SBOM/license/notices、no-self-update scan | external release阻断 |
| `TS-G09` Offline/egress | packaged control/helper/runtime online capture；安装完整后断网launch/handoff/generation repeat；除owned loopback无egress | 去除offline/zero-egress且Stable阻断 |
| `TS-G10` Accessibility/UX | 第10节Windows人工/自动矩阵通过 | novice external Alpha阻断 |
| `TS-G11` Budget/performance | signed installer/unpacked、cold/warm startup、idle memory、24h profile/log/C/D budget公开评审 | 不得承诺轻量；product owner可触发重评 |
| `TS-G12` Security SLA | upstream monitor、reachability owner、Critical/High演练和manual replacement流程 | 暂停分发 |

这些gate只授予其精确能力。比如`TS-G08`通过不自动授予runtime zero-egress；`TS-G03`通过也不证明Comfy frontend安全或user Run关联。

## 12. 被否决的备选

### A. 继续三栈并行到Beta

**否决。** 这会复制关键路径，并允许static fixture被当作“快完成”。下游只实现Electron UI/control plane。

### B. 现在选择Tauri，因为理论包更小

**否决。** 当前无Cargo/Tauri/MSVC/Windows SDK、无compile/runtime/package、无Cargo lock/SBOM和真实WebView bridge证据。系统已有WebView2不等于Tauri artifact更小、更安全或可用。

### C. 现在选择.NET，因为native UI可能更安全

**否决。** 当前只有.NETCore runtime，无现代SDK/Windows Desktop pack/Windows SDK；WPF/WinUI、ArgumentList、FDD/SCD和installer全未运行。Native UI标签不能替代证据。

### D. Electron main直接spawn Comfy并用字符串检查路径

**否决。** Prototype direct child只证明普通参数数组/直接终止，不满足ADR-002的pre-first-instruction Job、volume/file handle/reparse/TOCTOU身份。

### E. 打包generic native command broker

**否决。** 一个能执行任意exe/args/shell/filesystem/URL的helper会把窄信任边界变成RCE和delete authority。Helper只实现第5节closed operations。

### F. 用self-updater解决Electron安全节奏

**否决。** ADR-011 禁止后台或 self-executing updater；ADR-015 只授权固定 Stable Release 的用户主动 Setup 下载。安全修复使用新 exact-version installer 并由用户人工安装；当前未签名状态必须如实披露，未来自动 updater 需独立 trusted-update ADR。

### G. 因offline package未通过而把online spike说成reproducible

**否决。** Online pinned build只证明一次构建成功。Offline/hermetic/reproducible具有不同证据门。

## 13. Fallback与唯一重评触发

Alpha没有runtime自动fallback，也不保留第二套UI implementation。**Tauri是唯一登记的stack revisit candidate**；它不是当前fallback binary。

只有同时满足以下条件才重开本ADR：

1. Electron出现栈特有的阻断：product owner拒绝实测C/package预算、团队连续无法满足第9节安全SLA，或Electron isolation/package gate本身无法通过；并且
2. Tauri已在批准Windows build host用相同四method、path、native helper、installer、signing、accessibility、offline-build、SBOM和VM夹具获得真实runtime/package证据，不能只提交static source；并且
3. Tauri在触发该重评的具体维度优于Electron，同时不弱化ADR-001/002/004/011和native helper gate。

如果失败的是所有UI栈共有的native Job/path/handoff/许可门，**不切换Tauri**；Alpha保持blocked/evidence-only并修复共同门。没有Tauri runtime证据时，Electron失败的回退是停止相关外测/发布，而不是混入.NET、Desktop、comfy-cli、generic shell或cloud。

## 14. 后果

### 正面

- 下游只维护一套TypeScript UI/service、IPC adapter、installer adapter和测试矩阵；
- 当前host已有真实build/package/renderer/direct-child证据，能立即开始scaffolding；
- Web UI适合novice wizard/form、中文、响应式layout和快速迭代；
- 独立native helper把最危险的Win32 authority从renderer/main通用能力中抽离，并可单独fuzz/sign/SBOM；
- no-self-update、user Run和Managed Core边界保持机器可检查。

### 成本与风险

- 当前unpacked约365.90 MiB，明显大于业务代码；C盘、download和安装时间需诚实披露；
- Electron/Chromium/Node和数百build依赖扩大SBOM、补丁与安全响应面；
- Electron main仍是高权限Node进程，IPC/preload/XSS错误后果高，必须长期维持sandbox/CSP/fuses；
- 项目需要Electron/TypeScript与一个native helper两种toolchain；
- Alpha无self-updater使安全replacement依赖人工分发/安装；
- offline package、签名、VM、accessibility、Job Object和full binary SBOM尚未通过，不能因ADR选栈而弱化。

## 15. 证据状态

### Runtime-proven（只限accepted Electron spike）

- strict TypeScript build/test、17 tests、dev和packaged hidden self-test；
- packaged renderer的sandbox/contextIsolation/no Node和四channel bridge；
- Unicode/space path shape、无静默C fallback；
- fixed harmless direct child的参数数组、ready和direct termination；
- assisted NSIS build、95.18 MiB installer、365.90 MiB unpacked、NotSigned、无blockmap；
- exact npm lock、partial CycloneDX、offline verify两次、public evidence lint。

### Static/inferred

- production module/API列表、novice UI和separate Comfy session设计；
- Electron可在native helper通过后满足完整process/path边界；
- per-user NSIS配置会在真实非管理员VM按预期行为；
- no-self-update policy经production package adapter后覆盖所有opaque binary/bundle。

### Blocked/external

- 第11节`TS-G03`至`TS-G12`中尚无accepted evidence的所有门；
- Tauri/.NET所有runtime/package比较；
- helper实现语言、binary、protocol PoC和签名；
- exact production Electron版本与最终package体积；
- H3、硬件、模型、FFmpeg、许可、Comfy handoff和generation质量。

## 16. Root acceptance checklist与下游约束

Root将本文改为Accepted前应确认：

- [ ] Alpha唯一UI/control-plane stack是Electron + TypeScript；Tauri/.NET不进入production分支；
- [ ] H3/Comfy/user Run职责没有变化，工具/helper无正式queue入口；
- [ ] native helper是强Job/path authority的发布必需组件，不是可选优化；
- [ ] helper不存在generic shell/command/filesystem/network bridge；
- [ ] helper实现语言仍需单一PoC选择，但不会重新打开三套UI；
- [ ] Electron当前大小、安全更新和供应链成本被接受为有条件成本；
- [ ] no self-updater、manual signed replacement与security SLA明确；
- [ ] offline verify、offline package和reproducible build没有混称；
- [ ] signing、VM、C/D budget、accessibility与zero-egress继续是release gates；
- [ ] Tauri是唯一revisit candidate，触发条件要求真实同夹具证据。

Root接受后：

- P1-DET-001/002/003、QA-001与production control-plane scaffolding只生成Electron/TypeScript实现；
- P0-ARC-010实现/选择唯一native helper，并受第5节closed protocol约束；
- packaging adapter消费ADR-011并覆盖Electron/NSIS/helper完整inventory；
- schema/API owner按ADR-004定义renderer-main/helper contracts；
- 任何下游Agent不得用Node direct spawn/string path临时绕过helper门。

## 17. 重新评审触发

以下任一变化必须重开本ADR：

1. 更换Electron UI stack、并行引入Tauri/.NET或引入remote web UI；
2. helper语言/ABI/进程信任模型变化，或增加generic operation/network/admin/service；
3. renderer启用Node、关闭sandbox/context isolation、加载remote code或暴露generic IPC；
4. control plane/helper开始提交`/prompt`、代理Run、创作prompt或cloud fallback；
5. installer改为MSIX/MSI等导致identity/update/elevation/路径模型变化；
6. 引入self-updater、remote catalog，或在 ADR-015 合同之外增加 channel/manifest、版本发现或下载能力；
7. 增加第二managed root、静默C fallback、UNC/device path或放宽reparse/owner策略；
8. 取消manual signed security replacement或无法满足第9节SLA；
9. Electron C/package budget触发第13节Tauri同证据重评；
10. Offline/build/SBOM/signing策略变化使现有release scanner不再完整。

## 18. 依据

- [`STACK_ELECTRON.md`](../evidence/STACK_ELECTRON.md)
- [`STACK_TAURI.md`](../evidence/STACK_TAURI.md)
- [`STACK_DOTNET.md`](../evidence/STACK_DOTNET.md)
- [`ADR-001-product-process-boundary.md`](ADR-001-product-process-boundary.md)
- [`ADR-002-runtime-topology.md`](ADR-002-runtime-topology.md)
- [`ADR-004-contract-conventions.md`](ADR-004-contract-conventions.md)
- [`ADR-011-alpha-no-self-update.md`](ADR-011-alpha-no-self-update.md)
- [`ADR-015-user-initiated-stable-download-channel.md`](ADR-015-user-initiated-stable-download-channel.md)
- [Electron security](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron sandbox](https://www.electronjs.org/docs/latest/tutorial/sandbox)
- [Electron fuses](https://www.electronjs.org/docs/latest/tutorial/fuses)
- [Electron ASAR integrity](https://www.electronjs.org/docs/latest/tutorial/asar-integrity)
