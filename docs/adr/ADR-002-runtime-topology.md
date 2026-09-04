# ADR-002：Alpha Managed Core 运行时拓扑

- **状态：** Accepted — Root 于 2026-08-27 完成边界与状态机主审
- **日期：** 2026-08-27
- **任务：** `P0-ARC-009`
- **决策依据：** `D-003`、`D-004`、`D-006`、`D-013`、`D-014`、`D-016`
- **相关 ADR：** `ADR-001-product-process-boundary.md`
- **适用范围：** Alpha 运行时物化、启动、身份验证、模型桥接、workflow 交接、离线复跑、诊断与停止
- **不改变：** 产品/生成职责、workflow schema、registry、安装计划、许可结论或任何上游 capability 状态

## 1. 背景

Alpha 需要一条可重建、可离线验证且不会同时维护多套运行时语义的执行路径。已接受的 Phase 0 结论是：

- 工具只安装、检测、验证、配置、编译和交接 workflow；MiniMax H3 只在 ComfyUI 中、用户点击 **Run** 后生成实际视频和原生音频；
- 现有 ComfyUI/Desktop/Portable 实例默认只能 attach，静态发现不得执行其 Python、custom node 或私有更新逻辑；
- Python/runtime generation 必须在最终绝对路径中直接构建，不能把已填充 venv 从 staging 搬入；
- Alpha 的工具自有大文件和可控写路径使用一个用户确认的本地固定 NTFS root；D 盘只有在满足条件时才作为可见建议，不能静默回退到 C；
- 强进程所有权、离线和零意外外联声明只能授予受管、allowlisted 的进程树；
- Desktop 的精确 `OPEN_AND_FOCUS` 以及 comfy-cli 的受限 helper 都没有当前已接受的运行 PoC，不能反向阻塞或替代 Alpha 主路径。

P0-ARC-001 选择了 Managed Core 作为条件推荐；P0-ARC-006 用惰性假 runtime 证明了最终 generation 路径、中文/空格 NTFS 路径、incomplete fail-closed 和小指针切换的文件系统协议。P0-ARC-006 **没有**启动真实 Python、ComfyUI、frontend 或 H3，因而不能被引用为真实启动、模型兼容、`OPEN_AND_FOCUS`、离线或 GPU 能力证明。

## 2. 决策

### 2.1 唯一 Alpha 执行拓扑

Alpha 的唯一正式执行拓扑是：

> **工具拥有的 immutable ComfyUI Core/backend generation + 同一 generation 锁定并验证的官方 frontend，运行于一个用户确认的本地固定 NTFS managed root。**

工具直接启动该 generation 的私有 Python/Comfy entry point，验证 owned process、loopback endpoint、backend/frontend/node 身份和 workflow 后，把锁定的本地 frontend 聚焦到确切 project revision。随后工具停在 `AWAITING_USER_RUN`；用户在 ComfyUI 中点击 Run 才产生第一笔正式任务。

这是一项拓扑选择，不是对尚未运行的 PoC 作通过声明。真实 managed launch、身份探测、精确 workflow focus、model bridge 和离线复跑都是主路径必过 gate；任一 gate 未关闭时，Alpha 保持 evidence-only，不得自动换用 Desktop、comfy-cli、任意外部 Comfy 或云服务。

```text
Tool control plane
  verifies active generation / paths / models / workflow
  creates one owned launch envelope
  starts pinned Comfy Core directly
  verifies PID + loopback port + backend/frontend/schema identity
  opens and focuses the exact canonical visual workflow
                       |
                       | no /prompt; state = AWAITING_USER_RUN
                       v
Locked local Comfy frontend
                       |
                       | user explicitly clicks Run
                       v
Owned Comfy backend execution
                       |
                       v
Local MiniMax H3 nodes generate actual video + native audio
```

### 2.2 可选适配器不构成第二运行时

| 路径 | Alpha 决策 | 当前状态 | 失败回退 |
|---|---|---|---|
| Managed Core + locked frontend | 唯一正式执行拓扑 | 架构选定；真实启动/交接仍待 gate | Alpha evidence-only；不执行用户正式任务 |
| Existing Comfy/Core/Portable | attach-only；不由工具安装、启动、更新、停止或动态导入 | 静态发现范围已定义；不自动认证 | `EXPORT_ONLY`/诊断说明或 `UNSUPPORTED` |
| Comfy Desktop | 独立、版本化 adapter capability；只有 `OPEN_AND_FOCUS` 才算 novice 自动交接 | 当前 `OPEN_AND_FOCUS` blocked/unproven | 继续使用 Managed Core；Desktop 可保持 attach/export-only |
| comfy-cli | 不是 Alpha trusted backend、runtime owner、installer、updater 或 model manager | 受限 helper gate 未通过且默认无必要 | 完全省略；直接启动 Managed Core |

Desktop gate 或 comfy-cli gate 的成功可以在未来增加可选 capability，但不得改变本文的 Managed Core 所有权、路径、身份、graph 或用户 Run 契约。它们失败也不得阻止 Alpha 对 Managed Core 主路径的实现与验证。

## 3. 所有权与可变性

### 3.1 工具拥有的对象

工具只可创建、修改、切换或删除具有自身 ownership ledger/marker 且位于所选 managed root 内的对象：

- control state、transaction journal、launch records 和小型 `active.json`；
- immutable runtime generation，包括私有 Python、Comfy Core/backend、locked frontend、local templates 和 recipe 明确列出的依赖；
- tool-managed model artifacts、cache 和 project/workspace 副本；
- 每次 launch 的 user/input/output/temp/log/bridge 目录；
- 工具直接创建的 Comfy process 及 recipe 明确允许的子进程。

工具不得因为路径名称相似、进程标题相似、端口可访问或发现某个 Comfy 目录，就推断所有权。

### 3.2 外部对象

下列对象不属于工具所有：

- 已存在的 Desktop/Portable/Core 安装及其 Python、配置、Manager、节点、更新、snapshot 和运行进程；
- 用户选择复用的外部模型；
- 用户原始图片、视频、音频及其他源文件；
- 系统浏览器或并非由本次 launch 创建的任何进程。

外部对象只能通过明确 capability 以只读方式引用。工具不得改写其配置、移动/重命名/删除模型、结束其进程或把它纳入 managed zero-egress 声明。用户素材若需要进入 Comfy input，必须使用用户已选择的素材创建工具拥有的 input 副本或另行证明的只读映射；不能扫描或吸收未选择的目录。

### 3.3 generation 不变量

1. generation 从第一个受管文件开始就在最终绝对路径中构建；
2. 已填充的 Python/venv/runtime 不从临时或 staging 路径搬迁；
3. generation 在验证后不可变；运行期 bytecode、cache、temp、logs 和 output 必须重定向到可写 workspace/cache；
4. incomplete、缺 owner、receipt/hash 不匹配、含 staging 引用或路径逃逸的 generation 不得成为 active 或 launch target；
5. 只有验证成功后才能用同目录原子 rename/replace 更新小型 `active.json`；active pointer 只保存稳定 identity/hash，不保存待执行命令；
6. 更新创建新 generation；不原地升级。rollback 只切到仍完整、仍被验证且未被项目 lease 禁止回收的旧 generation；
7. 工具绝不使用或修改全局 Python、CUDA、PATH、用户 pip 配置或注册表 Python 关联。

## 4. 单一 fixed-NTFS path envelope

Alpha 所有工具自有大数据和所有可控运行期写入必须落在同一个 root：

```text
<managed-root>\
  control\
    active.json
    catalog\
    transactions\
    launches\<launch-id>\
  runtimes\<recipe-id>\<generation-id>\
    private-python\
    comfy-core\
    frontend\
    templates\
    manifest.json
    verification.json
  models\
  cache\
  workspace\
    instances\<instance-id>\
      user\
      input\
      output\
      temp\
      logs\
      bridge\
    projects\<project-id>\build\<build-id>\
```

P0-CON-001 可以正式化字段名、ID 语法、JSON 兼容规则和 manifest 版本，但不得改变以下拓扑约束：

- `<managed-root>` 必须是用户看见并确认的绝对路径，位于受支持的 local、Fixed、NTFS 卷；
- 只有 D 盘符合全部条件时才建议 D；没有合格 D 盘时必须展示其他真实候选并让用户选择，不能把 large data 静默放到 C；
- Alpha 不把 runtime、models、cache 和 workspace 分散到多个卷；多卷是 1.0 后的独立 capability；
- tool-owned 路径必须做规范化、containment、reparse/device/ADS/traversal 和 ownership 检查；
- generation 只读，instance/workspace/cache 可写；不得为了让 package 可写而修改 generation；
- `TEMP/TMP`、framework/model cache、Comfy user/input/output/temp 和可控日志必须指向上述 root 内；
- Windows、驱动、安全软件、崩溃转储或应用自身小设置可能仍写 C。产品不得承诺“C 盘零写入”，但必须测量、分类和披露；
- 显式选择且已验证的外部模型或源素材可以在 root 外保持只读，它们是例外引用，不是第二个受管存储 root。

## 5. Owned process 与 lifecycle

### 5.1 启动前

控制平面必须在创建进程前完成：

1. 解析 `active.json`，重验 generation owner、final path、manifest/receipt/artifact hashes 和 recipe compatibility；
2. 验证 managed root/launch paths、空间和可写范围，不跟随未批准 reparse target；
3. 验证 selected model identities、model bridge 和 canonical workflow/build/recipe hashes；
4. 创建唯一 `launch-id` 与工具拥有的 instance envelope；
5. 选择一个只用于本次 owned instance 的 loopback port，并把 reservation/race handling 交由 P0-ARC-010 的进程协议实现；
6. 构造固定 executable、独立 argument array、固定 working directory 和最小环境；不得拼接 shell command，也不得接受 project/prompt 传入额外启动参数。

### 5.2 创建与拥有

- 直接运行 active generation 内经哈希验证的私有 Python/Comfy entry point；不得经 `cmd.exe`、PowerShell、用户 Python、Desktop、Manager 或 comfy-cli 间接启动；
- **在进程能够执行 Python、Comfy、用户或第三方代码并派生子进程之前完成 OS 强制的 process-tree containment。** 首选机制是 native `CreateProcess(..., CREATE_SUSPENDED, ...)`，用返回的精确 process handle 将 suspended child 分配到不可 breakaway、带 `KILL_ON_JOB_CLOSE` 的工具 Job Object，验证 membership 后才 `ResumeThread`；
- 也可以使用一个自身已经位于不可 breakaway Job 中、且由 OS 保证所有 child 从第一条可执行指令起继承该 Job 的最小 native launcher，或另一个能证明相同“first instruction 前 containment、无 polling/attach race、不可 breakaway”性质的机制；仅在普通启动后“尽快”调用 `AssignProcessToJobObject` 不合格；
- 若 suspended-create、Job assignment、membership/limit verification 或 resume 前 identity 任一失败，必须用原始 process handle 在 child 仍 suspended 时终止它并 fail closed，绝不能先 resume 再轮询补绑；若宿主自身 Job/nested-Job 限制导致无法证明 containment，也不得降级；
- 记录 PID、creation time、process image canonical path/hash、parent PID、Job membership、generation/recipe/launch ID；PID 单独不是 identity。若 recipe 允许子进程，必须按 executable/hash/parent relation 显式列出，且不得设置 `BREAKAWAY_OK`/`SILENT_BREAKAWAY_OK`；
- 控制平面只能 stop/kill 自己的匹配进程树。PID 被复用、creation time/image/hash 不匹配或 Job membership 不确定时，不得结束该进程；
- 同一 instance 的重复 launch 必须由明确 mutex/lease 串行化。发现占用端口或相同路径的未知进程时 fail closed，不 attach、不杀进程、不换端口继续猜测；
- 正常停止先请求受支持的本地 shutdown；超时后只能终止已验证 Job Object。崩溃后记录诊断，不自动提交用户任务。

### 5.3 generation、instance 与单次 Run lifecycle

实现必须把安装 generation、长寿命 backend instance 和每一次用户 Run/execution 作为三个不同状态域及 correlation identity。具体枚举由 P0-CON-001 固化，但不得把一次 Run 的成功、失败或取消写成 backend process 的 `STOPPED`/`CRASHED`。

**Generation lifecycle：**

```text
MATERIALIZED -> VERIFIED -> ACTIVE
任何 materialize/verify/activate 失败 -> INCOMPLETE | QUARANTINED
```

`ACTIVE` 只代表安装 generation；不代表进程、workflow、模型或离线能力已经通过本次 launch 验证。

**Backend instance lifecycle：**

```text
NOT_RUNNING
  -> LAUNCHING
  -> IDENTITY_VERIFIED
  -> WORKFLOW_FOCUSED
  -> INSTANCE_READY

INSTANCE_READY
  -- explicit stop / accepted idle policy --> STOPPING -> STOPPED

LAUNCHING | IDENTITY_VERIFIED | WORKFLOW_FOCUSED | INSTANCE_READY | STOPPING
  -- unexpected process exit --> PROCESS_CRASHED

任何 preflight/identity/handoff 失败 -> FAIL_CLOSED
```

`STOPPING -> STOPPED` 只能由明确的用户/控制平面停止动作，或已版本化并获接受的 idle policy 触发。idle policy 只能在 queue 为空、没有 active execution/commit 且保存边界已验证时停止 owned instance。`RUN_COMPLETED`、`RUN_FAILED` 或 `RUN_CANCELLED` 本身均不得停止或重启 backend。

**Single formal Run / execution lifecycle：**

```text
AWAITING_USER_RUN
  -- visible frontend user Run --> RUN_ACCEPTED -> COMFY_EXECUTING

COMFY_EXECUTING -> RUN_COMPLETED -> AWAITING_USER_RUN
COMFY_EXECUTING -> RUN_FAILED    -> AWAITING_USER_RERUN
COMFY_EXECUTING -> RUN_CANCELLED -> AWAITING_USER_RUN

COMFY_EXECUTING
  -- backend process exits --> RUN_INTERRUPTED_BY_PROCESS_CRASH
```

成功执行后 backend 保持 `INSTANCE_READY`，frontend 回到 `AWAITING_USER_RUN`，用户可以再次点击 Run。单次 execution fail/cancel 也不等于 process crash：backend identity 仍有效时只记录该 run 的结果并等待下一次真实用户 Run，不自动重投。

若 backend 在 active execution 中 crash，则 instance 进入 `PROCESS_CRASHED`，该 run 进入 `RUN_INTERRUPTED_BY_PROCESS_CRASH`。重新物化/启动不是允许的快捷恢复：必须重验相同 generation、process/endpoint identity、workflow 和 checkpoint，重新聚焦后进入 `AWAITING_USER_RERUN`，并等待用户再次 Run。若 backend 在没有 active run 时 crash，重新验证/聚焦后进入普通 `AWAITING_USER_RUN`。两种情况都不得自动 `/prompt`。

## 6. Loopback 与 endpoint 身份

### 6.1 网络边界

- backend 必须显式绑定 `127.0.0.1`，不能使用裸 `--listen`、`0.0.0.0`、LAN 地址或隐式 hostname；IPv6/wildcard 监听不属于 Alpha；
- frontend、控制平面与 backend 的产品通信只使用本次验证的 loopback origin；端口号本身不是身份或访问控制；
- 不启用 wildcard CORS、远程 origin、远程 websocket、API key bridge 或公网 tunnel；
- `--disable-api-nodes` 必须启用；Manager、unknown custom nodes、runtime installer/downloader、update checker 和 telemetry 不进入进程树；
- 环境中继承的 proxy、token、cloud credential 和 download cache 不能成为 runtime 的隐式输入；
- 非 loopback 连接尝试必须记录为安全失败并阻止 offline/zero-egress certification，不能自动远程回退。

随机 loopback port 和关闭 CORS 不能证明“用户 Run 是第一笔正式提交”。Alpha gate 还必须把 backend 收到的第一笔 `/prompt` 与 locked frontend 中可见、明确的用户 Run event 关联，并证明 tool/helper 在此前的 submit 计数为零。该声明约束本产品的进程和 handoff，不宣称能够抵抗已控制同一 Windows 用户会话的恶意本地软件。

### 6.2 endpoint identity tuple

只有下列 identity 同时匹配，endpoint 才可从 `LAUNCHING` 进入 `IDENTITY_VERIFIED`：

```text
launch-id
PID + creation-time + Job membership
process image canonical path + artifact hash
owned 127.0.0.1:<port> socket mapped to that PID/process tree
recipe-id + generation-id + generation manifest hash
Comfy backend revision/build identity
frontend revision + served-asset manifest hash
template revision
approved local-node class_type + normalized schema fingerprint set
```

验证必须访问刚刚创建的 owned endpoint，并只调用固定的 health/identity/object-schema read-only surface。不得通过窗口标题、页面文案、favicon、端口能连接或进程名相同来推断 identity。`/object_info` 或等价动态 schema 只允许在该已拥有、custom-node policy 已锁定的 generation 上读取；不得用它探测任意外部实例。

如果 frontend asset、backend revision、template、node schema 或 served origin 与 recipe 不一致，工具必须在展示 workflow 前关闭自己的 launch，并保留脱敏诊断。不得使用浏览器缓存中的旧 frontend，也不得降级到 `latest`。

## 7. Locked frontend 与 workflow handoff

### 7.1 frontend 身份

locked frontend 是 active generation 的已哈希 artifact，不由 Desktop、CDN、模板站、Manager 或浏览器扩展提供。它必须：

- 与 backend、canonical visual workflow version 和受控官方 `graphToPrompt()` projection 使用同一 recipe 兼容集合；
- 只从 verified loopback origin 加载本地 assets/templates，不依赖远程字体、脚本、模板或 service update；
- 对 stale cache/service worker 有可验证的版本隔离或拒绝策略；
- 在 handoff 完成后显示 exact project revision/build hash 对应的 visual graph；
- 不包含代表工具自动 Run、后台提交或静默恢复的桥接命令。

宿主可以由未来 UI stack ADR 选择，但宿主选择不得改变 frontend artifact identity。若使用非工具拥有的系统浏览器，工具不得停止它，也不得把浏览器的其他流量算入 owned runtime process-tree 零外联声明。

### 7.2 exact handoff

Managed Core 主路径必须实现并验证自身的 exact workflow handoff：

1. canonical `workflow.json` 与 project/build/recipe hash 已静态 lint；
2. workflow 保存到本次 owned instance/user 或 project build 路径，不覆盖未知文件；
3. 通过该锁定 frontend 的版本化、已验证 handoff surface 打开；
4. 冷启动、热启动、重复打开和多 tab 场景中，当前可见 canvas 都对应确切 project revision；
5. frontend 回报的当前 graph hash、backend origin 和 build identity 与预期一致；
6. 工具状态进入 `AWAITING_USER_RUN`，且到此为止 `/prompt`/queue submit 计数为零。

简单导出 JSON、打开目录、显示 workflow 列表、聚焦错误 tab 或只打开 Comfy 首页都不满足 Managed Core 主路径。该 handoff 尚未由 P0-ARC-006 证明，是 Alpha 的必过实现 gate；失败时保持 evidence-only。

Desktop 的 `OPEN_AND_FOCUS` 是另一个独立 adapter gate。它没有通过不会削弱或替代上述 Managed Core handoff，也不会阻塞主路径开发。

## 8. Graph safety

### 8.1 权威图与检查范围

权威来源仍是 ProjectSpec/Route/Canvas/FrameAudio plans、pinned template binding 和 canonical visual workflow。派生 API graph 只用于构建/测试证据，不是 editable truth，也不得被工具自动执行。

在打开前，以下每一层都必须 lint：

- canonical visual workflow 的所有 nodes、links、widgets 和 output roles；
- `definitions.subgraphs` 及嵌套 subgraph；
- 由锁定官方 frontend projection 得到的 derived API graph；
- 未来、另行 gate 的 Runner/GraphBuilder expansion。

每个 executable/output node 必须同时匹配 recipe 的 exact `class_type`、normalized schema fingerprint、角色和允许输入字段。显示名、类别或“来自 Comfy Core”不能替代 allowlist。

### 8.2 无条件拒绝

以下内容在编译/打开/执行前 fail closed：

- `is_api_node`、Partner/API 类别、鉴权/token/key/account 字段或 remote URL/upload/proxy 语义；
- MiniMax/Hailuo 同名云节点及 capability snapshot 的禁止类；
- unknown class type、unknown output node、schema fingerprint 漂移、未知 custom node；
- Manager、runtime install/update/download、Git/pip/model/frontend/template acquisition；
- 模板中的 mutable `main` URL、Turbo/LoRA 或其他未被当前 recipe 单独批准的分支；
- 任何在编译、打开或恢复阶段调用 `/prompt`、queue/executor submit 的图或 helper。

CLI 禁用 API nodes 和 custom-node policy 是 defense in depth，不替代 graph lint。若用户在 Comfy canvas 修改 prepared graph，graph hash 必须变为未认证；锁定 frontend/backend guard 必须拒绝 forbidden/unknown node，且不得替用户重写、修复或提交。产品只对仍匹配编译 revision 和 recipe policy 的 prepared workflow 作认证。

## 9. Model bridge

Managed Core 的 model registry 是唯一选择权威。每个 workflow 所需模型在 launch 前必须达到 `verified -> compatible -> approved -> selected`，并绑定 exact artifact identity、角色、recipe 和许可状态。

模型只通过 Comfy 锁定 revision 支持的显式 extra-model-path/base-directory 配置入口接入：

- bridge 配置写入本次 tool-owned `workspace\instances\<instance-id>\bridge\`；不得改外部 Comfy/Desktop 配置；
- 每个路径先 canonicalize，并绑定稳定 candidate/model ID；tool-owned model 必须在 managed root 内且 owner/hash 匹配；
- 用户明确选择的外部模型保持只读；只对 selected candidate 做必要的完整 hash，不移动、重命名、覆盖或在 uninstall 时删除；
- external root 缺失、可移动卷断开、只读访问失败、文件 identity 改变、reparse target 漂移或 model role/shape/hash 不匹配时，launch/handoff fail closed；
- bridge 只列出当前 recipe 所需 root/role，不暴露整盘、用户 profile、任意 downloads 目录或未批准模型；
- runtime 不搜索互联网、不运行模型目录脚本，也不因本地 artifact 缺失而下载或调用 Partner/API；
- workflow loader 绑定的文件名/role 必须可解析到 bridge 中唯一的 selected artifact；重复或歧义匹配被拒绝。

具体 bridge 文件格式和 model contract 由相应 owner 固化；本文只允许支持的本地配置入口，不授权编辑 Desktop 私有状态、创建不受控 junction 或扫描任意路径。

## 10. User Run 与生成职责

完成 `WORKFLOW_FOCUSED` 后，工具只可：

- 显示“已在 ComfyUI 中准备好，请检查后点击 Run”的交接状态；
- 保持 owned process、读取受限健康/身份状态、展示脱敏诊断；
- 在用户明确要求时聚焦已验证的 Comfy frontend；
- 停止自己的 idle process，但不得把停止/重启转化为提交。

工具不得：

- 调用 `/prompt`、等价 queue/executor API、frontend hidden command 或 websocket submit；
- 用坐标、DOM、快捷键、clipboard、倒计时或 accessibility automation 点击 Run；
- 提供工具侧“生成视频/开始生成”动作；
- 在打开、网络恢复、重启、定时器或 crash recovery 后自动提交；
- 改写、翻译、扩写、分类或补全用户 prompt。

第一笔正式任务只能来自当前可见 ComfyUI frontend 上的真实用户 Run。之后 Comfy backend 执行 allowlisted local graph，MiniMax H3 节点生成实际视频和原生音频。未来 Runner 只有在独立 gate 通过后，才可在同一次已接受 execution 内做确定性 Node Expansion；永远不得重入 `/prompt`。

崩溃终止本次 execution。重新启动和恢复仍须先完成相同 identity/workflow/checkpoint 验证，并等待用户再次 Run；没有静默重投。

## 11. Offline 与外联边界

### 11.1 Stable 声明范围

安装获取 artifact 的阶段可以是联网的，但每个 URL/revision/length/hash/provenance 必须由另一个安装 contract 锁定。本文的 offline 要求从“所需 artifact 已完整安装并验证”开始：

- 断网后可以再次 launch、打开同一 prepared workflow、等待用户 Run，并由本地 H3 完成已认证能力；
- 生成窗口中 owned backend/process tree 除本次 loopback 通信外没有 egress；
- frontend assets、templates、models、Python wheels、codec libraries 和节点全部来自已验证的本地 generation/store；
- 无 Manager、knowledge refresh、telemetry、update check、runtime pip/Git、model download 或云 fallback；
- online capture 要覆盖 owned process tree，offline repeat 要覆盖相同 recipe/workflow/model identities。

D-016 的强 zero-egress certification 只授予 managed process tree。任意外部实例或系统浏览器的其他流量不自动归因于本 runtime；如果选定 handoff host 也要获得产品级零外联声明，它必须单独进入 allowlisted process/capture gate。

未完成在线 capture 或离线 repeat 时，可以标记 `poc_pending` 并用于内部 evidence，但不得宣传 offline/zero-egress Stable，也不得远程降级。

### 11.2 本地监听不等于离线证明

`127.0.0.1`、`--disable-api-nodes` 或“没有主动调用 API”单独都不能证明离线。验收必须同时覆盖 process tree、DNS/TCP/UDP egress、runtime logs、文件下载痕迹、frontend asset source 和断网复跑。

## 12. Fail-closed 矩阵

| 失败 | 必须行为 | 禁止行为 |
|---|---|---|
| 无合格 fixed NTFS root/空间不足 | 要求用户选择支持位置；保留原状态 | 静默落 C、拆成多卷 |
| active pointer/generation/receipt/hash/owner 无效 | 不启动；保留或明确选择仍验证通过的旧 generation | 猜测目录、原地修补、启动 incomplete |
| launch path 逃逸、reparse/ADS/device 风险 | 拒绝并保留诊断 | 跟随后继续写/删 |
| 无法在 first executable instruction 前证明 non-breakaway Job containment | 保持 child suspended、用原始 handle 终止并 fail closed | 先 resume/运行 Python 后补绑、轮询追子进程 |
| 端口已占用或 socket owner 不匹配 | 停止本次已验证 owned child；返回冲突 | attach、杀未知进程、把端口当身份 |
| PID/creation/image/Job identity 不匹配 | 不访问/不停止未知进程；handoff 失败 | 按 PID 或名称强杀 |
| backend/frontend/template/node schema 漂移 | 关闭 owned launch；generation/capability 退回未认证 | 使用缓存、`latest` 或近似版本 |
| workflow focus/hash 不匹配 | 不进入 `AWAITING_USER_RUN` | 打开错误 tab 后宣称成功、自动 Run |
| graph 含 API/Partner/unknown/下载节点 | 编译/打开失败 | 删除警告后运行、远程回退 |
| model/bridge 缺失、漂移、歧义或越界 | launch/handoff 失败；保留外部文件 | 自动下载、换近似模型、改外部配置 |
| offline gate 未通过或观察到 egress | 去除 offline/zero-egress capability；Stable 发布失败 | 忽略、上传、改走云端 |
| Desktop optional gate 失败 | 继续 Managed Core；Desktop 保持 attach/export-only | 阻塞 Alpha 或用私有状态/坐标自动化 |
| comfy-cli restricted-helper gate 失败 | 不安装、不调用 helper | 让 helper 接管 install/update/model/run |
| 单次 Run fail/cancel，但 backend 仍健康 | 保持 instance ready，记录 run 结果并等待用户下一次 Run | 把 run 结果写成 process crash、自动停止/重启 backend |
| Comfy process crash | instance 与 active run 分别记 `PROCESS_CRASHED`/`RUN_INTERRUPTED_BY_PROCESS_CRASH`；重新验证后等待用户 rerun | 后台自动重投 `/prompt` |

Fail closed 不等于自动删除。未知、外部、incomplete 或仍被项目/lease 引用的对象默认保留，只有 ownership/containment/retention policy 全部通过的工具对象才可清理。

## 13. 支持的诊断面

工具可以收集下列最小诊断：

- recipe/generation/frontend/template/build/model 的非敏感 ID 与 hash；
- PID、creation time、Job membership、process image hash 和 loopback socket owner；
- 启动参数的版本化参数名及脱敏值类别；不得保存 prompt/token/完整用户路径；
- health/identity/schema gate 的 pass/fail 与 fingerprint，不保存完整 `/object_info` 到普通支持包；
- workflow/build hash、graph lint rule ID、model bridge candidate ID；
- exit code、阶段、单调时间戳、资源峰值、离线/egress gate 结果；
- C/D 写入的分类统计，不默认公开用户名、素材名或绝对路径。

诊断调用必须是固定 allowlist 的本地只读 surface。普通 control plane 不包含通用 Comfy HTTP client、通用 queue client、shell console、任意 endpoint 调用器或可把派生 API graph执行的按钮。支持包采用字段 allowlist，默认移除 prompt、素材名称、token、账户名、绝对路径和用户原始媒体。

## 14. 明确非目标

本文不授权或承诺：

1. 工具、installer、control plane、frontend bridge 或 Agent 生成视频/音频或提交用户第一笔正式任务；
2. 自动 prompt 优化、内容类型识别、故事/分镜/对白/音乐生成；
3. 云/Partner/API node、上传、远程推理或本地失败后的远程 fallback；
4. Manager、runtime pip/Git、运行期 node/model/frontend/template 下载或 mutable `latest`；
5. 修改、更新、停止或强认证任意 existing Comfy/Desktop/Portable 实例；
6. 把 comfy-cli 作为 Alpha installer/backend/updater/model manager/workflow runner；
7. 多卷 managed layout、静默 C 盘 fallback 或“C 盘零写入”；
8. Desktop 当前已能自动打开并聚焦指定 workflow；该能力仍 blocked/unproven；
9. 真实 managed launch、模型兼容、GPU、H3 输出、codec、offline、C-drive budget 或精确 workflow focus 已由 P0-ARC-006 证明；
10. Ref2VA、4 秒、空 prompt、30/60 秒、Runner、加速 recipe、BGM、upscale、interpolation 或 watermark；
11. 发行许可、签名、SBOM、codec 专利或硬件范围已经关闭外部门。

## 15. 被否决的方案

### A. Alpha 同时支持 Managed Core、Desktop 和 Portable 三套正式执行路径

**否决。** 这会在首个可用结果前复制 instance identity、路径、model bridge、handoff、offline、更新和诊断协议。外部实例继续 attach-only；可选 adapter 在独立 gate 通过后加入。

### B. 以 Desktop 为默认并等待 `OPEN_AND_FOCUS`

**否决。** 当前没有稳定外部 exact-open 证明，且 Desktop 自己拥有多 installation、更新和私有状态。Desktop gate 不阻塞 Managed Core Alpha。

### C. 以 comfy-cli 统一安装、启动、模型和 workflow

**否决。** 当前 comfy-cli surface 包含 Manager、更新、模型、cloud/Partner 和 run/jobs 等超出产品边界的能力。把它限制到只剩固定 launch 后，直接启动 managed Core 更小、更清楚。

### D. 发现某个 loopback Comfy 后直接复用

**否决。** 端口、进程名和页面都不能证明 backend/frontend/node/model/egress identity，也不能授权停止或修改外部实例。

### E. 运行期自动补依赖或切到云节点

**否决。** 它破坏 immutable recipe、离线、隐私、许可和用户 Run 边界。缺项必须在 launch/compile 前 fail closed。

## 16. 后果

### 正面

- Alpha 只有一个 runtime identity、一个 path envelope、一个 model bridge 和一个 handoff contract；
- backend/frontend/node/模型版本和 offline claim 可以被同一 recipe 重建与审计；
- 最终 generation + 小指针提供清晰的更新、rollback 和 crash-before-activation语义；
- optional Desktop/CLI 研究不再阻塞第一条受管路径；
- existing installs 和外部模型默认不被破坏；
- 用户仍在真实 ComfyUI 中检查图并亲自 Run，H3 仍是唯一媒体生成者。

### 成本与限制

- 项目必须负责私有 Python、Torch/CUDA wheels、Comfy backend/frontend/templates、模型和 codec 的供应链/兼容认证；
- 实现 P0-ARC-010 所需的 Windows Job Object、socket/PID identity 和停止协议；
- locked frontend exact handoff 与 graph guard 是主路径工程，不可用 Desktop 手工导入掩盖；
- strict offline 需要进程树捕获和断网重复测试；
- 单 root 简化事务但不允许高级用户在 Alpha 分盘；
- 普通用户仍需在 ComfyUI 点击一次 Run，crash recovery 仍需再次 Run。

## 17. 证据状态与必过 gate

| 结论 | 状态 | 依据/下一门 |
|---|---|---|
| Managed Core 是 Alpha 唯一正式拓扑 | accepted product/architecture input；本文待 root acceptance | `D-003`、optimized architecture |
| 最终 generation、incomplete 拒绝、小指针切换 | proven for inert filesystem fixture | P0-ARC-006；不外推到真实 runtime |
| locked Comfy Core entrypoint 的 CLI arguments 提供 loopback/path/node/API 控制参数 | proven upstream surface | pinned Comfy Core source；仍需真实 launch |
| 本地 H3/Core 与 Partner/API 类可区分并建立 allowlist seed | proven upstream fact | P0-WF-001；完整 recipe allowlist 仍待 owner |
| pre-execution non-breakaway Job containment + process/socket identity | `poc_pending`，Alpha required | P0-ARC-010；无法证明则 fail closed |
| crash-before-pointer 与真实 process crash recovery | `poc_pending` | P0-ARC-011/QA-014 |
| managed model bridge | `poc_pending`，Alpha required | model-path/config PoC；只读 external fixture |
| Managed Core exact workflow focus | `poc_pending`，Alpha required | locked frontend handoff PoC；失败则 evidence-only |
| visual/subgraph/API graph lint 与 submission-time forbidden-node guard | `poc_pending`，Alpha required | 正/负 graph fixtures；失败则不 handoff |
| 第一笔正式提交与 frontend 用户 Run event 关联 | `poc_pending`，Alpha required | `/prompt` recorder + user-event marker；tool/helper submit 必须为零 |
| generation-window offline/zero-egress | `poc_pending`，Alpha required for claim | allowlisted process capture + offline repeat |
| Desktop `OPEN_AND_FOCUS` | blocked/unproven，optional | 独立 Desktop adapter gate；不阻塞 Alpha |
| comfy-cli restricted helper | blocked/unnecessary by default，optional | 只有独立受限 helper gate 可重新引入 |
| H3 真实输出、硬件、codec、许可 | 未由本文证明 | 后续 GPU/VM/Human gates |

## 18. 下游实现约束

### 18.1 P0-CON-001 必须固化

- `managed_core` 是 Alpha 唯一 Stable execution topology enum；Desktop/CLI 是独立 capability，不是并列默认 runtime；
- path/ID/hash 的 canonical representation、case/Unicode 规则和 unknown-field/fail-closed 规则；
- generation/active/launch/instance/backend/frontend/template/node/model/workflow identity 字段；
- generation、backend instance 与单次 formal Run/execution 分离的状态、correlation ID 和转换规则；`STOPPED`/`PROCESS_CRASHED` 不得复用为 run result；
- ownership、immutability、external-read-only 和 retention/lease 语义；
- capability 状态必须区分 `proven`、`poc_pending`、`blocked`，不得把 topology decision 等同 PoC pass；
- diagnostics 的敏感字段分类和 public redaction 规则。

### 18.2 P0-ARC-010 必须实现/证明

- direct executable + argument array，无 shell；
- native suspended-create -> assign/verify non-breakaway Job -> resume，或满足同等级 first-instruction containment 的机制；失败时不得 resume；
- PID/creation/image/hash/parent/Job Object ownership，以及 `BREAKAWAY_OK`/`SILENT_BREAKAWAY_OK` 均未启用的证据；
- `127.0.0.1` socket 与 PID/process-tree 映射及 port race fail-closed；
- 固定环境和所有可控 cache/temp/user/input/output/log 路径；
- backend/frontend/schema identity probe 的固定 read-only endpoint allowlist；
- 只停止 owned process tree，未知进程零 mutation；
- 用户 Run 前 `/prompt`/queue submit 为零；
- 区分 backend instance stop/crash 与每次 Run completed/failed/cancelled/interrupted 的事件和测试；
- 冷/热启动、身份漂移、端口冲突、**pre-assignment child escape**、breakaway child、nested-Job 不兼容和 process crash 的负向 fixtures；所有 containment 负例都必须在用户/第三方代码执行前 fail closed。

## 19. Acceptance checklist

Root 接受本文前应确认：

- [ ] Alpha 只有 Managed Core + locked frontend 一条正式执行路径；
- [ ] Desktop `OPEN_AND_FOCUS` 与 comfy-cli helper 都是 optional gate，不阻塞 Alpha；
- [ ] existing instances 保持 attach-only，工具不启动/修改/停止；
- [ ] one fixed NTFS root、final immutable generation 和 atomic active pointer 无第二解释；
- [ ] generation、backend instance 与单次 Run lifecycle 已分离；run success/fail/cancel 不停止 backend，只有明确 stop/accepted idle policy 才进入 `STOPPING -> STOPPED`；
- [ ] process 在执行 Python/Comfy/用户/第三方代码前已进入不可 breakaway Job；pre-assignment child escape 无窗口且无法证明时 fail closed；
- [ ] owned process、loopback、identity、frontend、paths、graph、model bridge、user Run、offline 和 fail-closed 均有实现不变量；
- [ ] 所有尚未运行的能力均标 `poc_pending`/blocked，并有 evidence-only/omit/export fallback；
- [ ] ADR 没有授权工具生成内容、调用云 API、自动排队或静默恢复。

Root acceptance 后，本文解锁 G1 Runtime、P0-CON-001，并约束 P0-ARC-010/011。若 Managed Core 主路径的 required gate 失败，失败回退是保持 Alpha evidence-only 并修复/重评本拓扑；不得通过扩大 external-instance、Desktop、CLI 或 cloud 范围绕过。

## 20. 重新评审触发

以下变化必须新增或修订 ADR，不能作为 recipe 小更新静默加入：

1. 把 Desktop、Portable、existing Core 或 comfy-cli 升为 Alpha 正式执行/更新 owner；
2. 引入第二 managed root、多卷或静默 C fallback；
3. 让 runtime generation 原地更新或搬迁已填充 Python 环境；
4. 放宽 loopback/process/frontend/schema/model identity；
5. 允许 Manager、运行期下载、unknown/API/Partner nodes 或远程 fallback；
6. 工具、helper、Runner 或 frontend bridge 提交用户第一笔/后续 `/prompt`；
7. 把外部模型或 existing install 从只读引用改为工具可写对象；
8. 无法通过 locked frontend 实现 exact handoff，因而希望用自动 Run、坐标自动化或错误 tab 作为替代；
9. 将 arbitrary browser/external process 的行为纳入 managed zero-egress 认证；
10. 产品范围扩展到 prompt 创作、替代生成模型、远程推理或无人值守生成。

## 21. 依据文件

- [`ADR-001-product-process-boundary.md`](ADR-001-product-process-boundary.md)
- [`DECISION_LOG.md`](../DECISION_LOG.md)
- [`RUNTIME_TOPOLOGY_OPTIONS.md`](../architecture/RUNTIME_TOPOLOGY_OPTIONS.md)
- [`MANAGED_CORE_LAYOUT.md`](../evidence/MANAGED_CORE_LAYOUT.md)
- [`OPTIMIZED_ARCHITECTURE.md`](../OPTIMIZED_ARCHITECTURE.md)
- [`UPSTREAM_CAPABILITY_SNAPSHOT.md`](../evidence/UPSTREAM_CAPABILITY_SNAPSHOT.md)

这些文件中的 accepted decision 和 proven evidence 是本文输入；其中的 inferred、blocked、`poc_pending` 或 experimental 项不会因被本文引用而升级状态。
