# ADR-004：版本化合同、序列化与兼容性约定

- **状态：** Accepted — Root 于 2026-08-27 完成共同约定主审
- **日期：** 2026-08-27
- **任务：** `P0-CON-001`
- **资源锁：** `SCHEMA`
- **上游约束：** Accepted ADR-001、Accepted ADR-002、`D-001`–`D-016` 中与合同相关的 accepted decisions
- **适用范围：** P0-CON-002..012 创建的内部 JSON 合同、fixtures、迁移、验证器与 cross-contract harness
- **不适用：** 上游 Comfy workflow 原生格式本身、模型/wheel/media 二进制内容、普通日志文本

## 1. 目的与产品边界

本 ADR 在任何具体业务 schema 出现前冻结共同规则。后续作者不得为 capability、component、recipe、project、install、ownership、hardware/model、route/canvas/timebase、workflow build 或 run/checkpoint 各自发明版本、时间、路径、hash、unknown-field 或错误语义。

合同只描述安装、检测、配置、workflow 编译与 ComfyUI 交接。任何 JSON 字段、extension、migration 或兼容模式都不能授权：

- 工具侧生成视频或音频；
- 自动提交用户第一笔或后续正式 `/prompt`；
- 云/Partner 推理、隐藏上传或本地失败后的远程 fallback；
- prompt 扩写、内容分类、脚本/分镜/音乐创作；
- Manager、运行期 dependency/model/node/frontend 下载。

MiniMax H3 仍只在 ComfyUI 中、用户点击 Run 后生成实际视频和原生音频。derived API graph 是构建/测试证据，不是可自动执行命令。

## 2. 规范性语言与基础格式

本文的“必须/不得”是 schema review 和 cross-contract harness 的发布阻断规则。“可以”只表示对应 schema 明确选择并有 fixture 时才允许。

所有内部 JSON 合同使用：

- JSON Schema Draft 2020-12；
- UTF-8，**无 BOM**，拒绝非法 UTF-8、未配对 surrogate 和重复 object key；
- RFC 8785 JSON Canonicalization Scheme（JCS）作为逻辑内容 canonicalization；
- RFC 3339 的固定 UTC timestamp 子集；
- RFC 6901 JSON Pointer 作为 instance location；
- RFC 9562 UUID version 4 的小写文本形式作为 document/correlation opaque ID；
- I-JSON safe integer 范围，禁止依赖 binary floating-point。

字段名使用 ASCII `lower_snake_case`；schema/contract 文件夹名使用 ASCII `lower-kebab-case`；enum/tag 使用 ASCII `lower_snake_case`。字段名、enum、ID 不做 locale-sensitive case folding。

## 3. Contract、schema 与 document identity

### 3.1 三种不同版本/身份

以下概念不得混用：

| 字段/概念 | 含义 | 不代表 |
|---|---|---|
| `contract_id` | 一个业务合同家族的永久逻辑名称 | 文档实例、recipe/model/app 版本 |
| `schema_version` | 该合同 JSON shape/约束的 SemVer | 文档修改次数、producer 版本 |
| `document_id` | 一个逻辑文档实例的 opaque UUIDv4 | 权限、所有权、真实性或内容 hash |
| `document_revision` | 同一 mutable 文档成功提交的单调整数 | schema version、wall-clock 顺序 |
| `integrity.content_sha256` | 文档逻辑内容的 JCS SHA-256 | 签名、来源可信、delete authority |
| domain ID | recipe/project/build/model/run 等业务身份 | 通用 document identity |

### 3.2 命名与 `$id`

- `contract_id` 形式为 `minimax-h3-tool.<contract-name>`，例如 `minimax-h3-tool.component-manifest`；`<contract-name>` 为 1–80 字节 lower-kebab-case。
- schema `$id` 必须是不可变绝对 URN：`urn:minimax-h3-tool:schema:<contract-name>:<MAJOR.MINOR.PATCH>`。
- schema 文件和 `$ref` 必须指向 exact version；不得出现 `latest`、`main`、浮动 branch、无 version 的 schema URL 或网络解析 `$ref`。
- validator 从安装包内的 exact offline schema registry 解析 `$id -> schema JCS SHA-256`。实例提供的 URL、路径或同名 schema 不参与解析。
- 每个内部 root document 必须包含 `contract_id`、`schema_version` 和 `document_id`。持久化 mutable document 还必须包含 `document_revision`，首个成功版本为 `1`，以后每次 atomic commit 恰好加 `1`。
- immutable authority document 的 `document_revision` 固定为 `1`；新内容是新 `document_id`/content hash，不修改旧文档。
- lower-case UUIDv4 形式固定为 `xxxxxxxx-xxxx-4xxx-[89ab]xxx-xxxxxxxxxxxx`。测试 fixture 可使用固定、合法的 UUIDv4；生产不得把用户名、路径、时间或硬件序列编码进 ID。

嵌入式 value object 不重复 root envelope。Comfy 原生 visual workflow/API graph 不能被强行加入内部 envelope；P0-CON-010 的 workflow-build sidecar 保存其 exact hash、format/frontend/template identity 和来源 document references。

### 3.3 引用另一份 mutable 文档

凡跨合同引用会影响执行、所有权、路径、artifact、graph 或恢复，不能只保存裸 `*_id`。下游 schema 必须绑定：

```text
source_document_id
source_document_revision
source_content_sha256
```

读取时三者必须与被引用 snapshot 同时匹配。ID 相同但 revision/hash 漂移要产生 deterministic conflict，不得自动使用“当前最新”。

## 4. Schema SemVer 与兼容矩阵

### 4.1 SemVer 含义

- **MAJOR：** 删除/重命名字段、改变字段语义/单位/required 集合、放宽或收紧安全行为、改变 union/enum 解释、改变 canonical hash projection，或任何不能由旧实例无损表达的变化。
- **MINOR：** 新 reader 对旧实例保持兼容的 additive change，例如新增 optional display metadata、显式新 union branch 或新 enum。旧 reader **不被假定** 能处理新 minor；遇到未知 operational 值仍 fail closed。
- **PATCH：** 不改变 accepted/rejected instance 集与运行语义的注释、示例或等价 schema 修正。任何 validator 行为变化至少是 MINOR；安全/含义破坏是 MAJOR。
- SemVer 不允许 prerelease/build metadata、前导 `v` 或缺省段；必须精确 `MAJOR.MINOR.PATCH`。

SemVer 是变更分类，不是自动接受授权。consumer 维护 exact `(contract_id, schema_version, schema_content_sha256)` 集与 explicit migration edges，绝不使用 `>=`、`^`、`latest` 或“同 major 大概兼容”。

### 4.2 Reader 行为

| Incoming | Reader 行为 | 可执行/写入/删除/启动？ |
|---|---|---|
| exact registered version + schema digest | 完整 validate、integrity/trust 校验 | 只有所有 domain gate 也通过后可以 |
| known older exact version | 先用旧 schema 验证；按 explicit deterministic migration 或保留旧 validator | 迁移并复验前不可以 |
| unknown newer PATCH/MINOR、同 MAJOR | 最多读取 bounded minimal envelope/display extension；不得猜字段 | 不可以 |
| different/unknown MAJOR | 返回 unsupported-version error，不迁移、不写回 | 不可以 |
| contract/schema identity 缺失或格式错误 | 作为 hostile/invalid document 拒绝 | 不可以 |

一个 newer reader 可以保留多个 exact old validators；immutable recipe/catalog/manifest 以原 exact validator 读取，不做 in-place migration。mutable state/project 只有存在受测 edge 时才迁移。generated workflow 从权威 project/template 重新编译，不做通用 JSON migration。

### 4.3 降级

- Older producer/consumer 不得打开 newer document 后“删除看不懂的字段并保存”。
- 不提供自动 downgrade。显式 downgrade/export converter 必须证明无损、产生新 document ID/hash 并由新 ADR/capability 授权；Alpha 不包含该功能。
- newer document 可在 UI 显示 `unsupported_version` 及非敏感 envelope，但不得触发 install、launch、path mutation、model reuse、graph handoff 或 cleanup。

## 5. Required、optional、omitted 与 null

- 会影响 execution、ownership/delete authority、path、artifact identity/provenance、graph safety、状态转换或恢复的字段必须 required，或位于 required discriminator 选择的严格 union branch 中。
- optional 只允许两种情况：缺失的语义唯一且不会改变安全决定；或字段是明确的纯 display metadata。
- 每个 optional property 的 schema description 必须写清楚“omitted means …”。不得把“unknown / not observed / not applicable / deliberately empty / unavailable”全部折叠成缺失；需要区分时使用显式 enum/union/status。
- `null` 默认禁止。只有 null 本身具有独立、稳定业务语义，且 schema 显式把它列入 union 时才允许；null 不得表示 missing、delete、unknown、reset 或“使用默认”。
- 空字符串、空 array、空 object 不能代替 omitted/null。是否允许空值由具体 schema 显式决定并有 valid/invalid fixture。
- JSON Schema `default` 只可作为 UI annotation，validator/migrator 不得注入它。所有 effective operational values 必须由 producer 明确写出并进入 content hash。
- 条件 required 必须用 discriminator/`if-then`/严格 `oneOf` 表达，不能只写 prose。

这允许 P0-CON-005 分离 original/effective text 与素材槽，也防止空 prompt capability 被 schema 默认值偷偷放宽。

## 6. Closed core、unknown fields 与 extensions

### 6.1 核心对象默认关闭

没有“默认忽略 unknown field”模式。每个 object 必须显式关闭：

- 非组合 object 使用 `additionalProperties: false`；
- 使用 `$ref`/`allOf`/`oneOf` 等组合的完整边界使用 Draft 2020-12 `unevaluatedProperties: false`；
- schema review 必须证明没有因为组合关键字意外留下 open object；
- unknown core property 在第一次可能影响 action 前产生 `CONTRACT.UNKNOWN_FIELD`。

Runtime observation 或 external discovery 若要保留上游未知值，只能放进 schema 明确定义、受全局 limits 约束的 `raw_evidence`/opaque container；该内容永远不能提升 capability、选择 model、形成 process argument、授权 path/delete 或进入 graph。

### 6.2 Extension namespace

具体 schema 可以选择是否提供 root `extensions`；未声明时 extensions 也属于 unknown field。若提供，必须使用以下 envelope：

```json
{
  "extensions": {
    "org.example.ui_notes": {
      "extension_version": "1.0.0",
      "effect": "display_metadata",
      "data": {}
    }
  }
}
```

- key 是 3–128 字节 lower-case reverse-DNS namespace，至少三段，匹配 `^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9_]*){2,}$`；`app.minimaxh3tool.*` 保留给本项目。
- unknown extension 只允许 exact `effect: "display_metadata"`；consumer 必须完全不解释 `data`，但在同 schema family 的 read-modify-write/migration 中按逻辑 JSON 原样保留。
- extension envelope 本身 closed，`extension_version` 使用同一 exact SemVer 规则；`data` 仍受 depth/count/string/byte limits。
- extension 全部进入 document canonical hash。preserve 不表示信任，也不表示支持。
- extension 不得改变 required/default/enum/union、执行命令、path、URL、artifact/model/node、workflow、ownership、delete、launch、queue 或恢复行为。
- 任何 operational extension 必须先成为 registered capability，拥有 exact schema/digest 与 consumer gate；不认识它的 reader 必须拒绝相应 action，不能把它伪装成 display extension。
- support bundle 默认不导出 extension data，除非 extension schema 中每个字段通过 support allowlist。

由此，无害展示元数据可以前向保存；任何新执行语义仍需 schema/version/capability 升级。

## 7. Enum 与 discriminated union

- enum 值使用 lower_snake_case ASCII，不依赖 display label。
- execution/ownership/path/artifact/graph/state enum 的 unknown value 一律拒绝；不得映射到第一个值、`other`、false 或附近状态。
- `unknown` 只能作为 schema 明确定义的 observation 状态；它表示“不足以行动”，不能成为兼容 wildcard。
- enum 新增是至少 MINOR。旧 reader 遇到新值按 unknown-version/value fail closed，即使 major 相同。
- union 必须有 required `kind` discriminator；每个 `oneOf` branch 用 `kind: { const: ... }`，branch 完整关闭。不得按“哪些字段刚好存在”猜 branch。
- unknown `kind` 拒绝。Observation 合同如需保留未知 source kind，必须有显式 `kind: "unknown"` branch、bounded raw value 和 `actionable: false` 不变量。
- boolean 只用于永久二值事实。若未来可能出现 `unknown/pending/blocked`，从第一版就使用 enum。

## 8. Canonical JSON、integrity 与 hashing

### 8.1 JSON profile

- Parser 在构造普通 map 前必须检测 duplicate keys；last-key-wins 不允许。
- JSON number token 只允许纯十进制整数词法 `0|-?[1-9][0-9]*`；拒绝 `-0`、小数点和 exponent，即使某语言会把 `1.0`/`1e0` 判断为数学整数。
- 只允许 I-JSON safe integers `[-9007199254740991, 9007199254740991]`。NaN、Infinity、binary float 和超范围 integer 拒绝。
- JCS 不进行 Unicode normalization。Prompt、素材文字、path 和用户文本的 code points/换行必须原样保留；不得为了 hash 做 NFC/NFD、trim、换行或大小写改写。
- Identifier/field/enum 使用 ASCII 规避 Unicode identity 混淆。普通 string 拒绝 NUL、未配对 surrogate；是否允许其他 control character 由 schema 收紧。
- 工具写出的 contract JSON 是 exact JCS UTF-8 bytes，无 BOM、无尾随 newline。人类可格式化 schema source/fixture，但 hash 必须对逻辑 JCS projection 计算。

### 8.2 `integrity` profile

所有工具持久化的 internal root documents 必须包含 closed `integrity` object：

```json
{
  "profile": "rfc8785-sha256-v1",
  "content_sha256": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
}
```

计算规则固定：

1. 在 raw-size/depth/key 预检后，用 duplicate-detecting parser 解析；
2. 从 root **完整移除 `integrity` property**；不存在其他可配置 exclusion；
3. 对剩余逻辑 document 执行 RFC 8785 JCS；
4. 对 JCS UTF-8 bytes 计算 SHA-256；
5. 编码为小写 `sha256:<64 hex>`；
6. 恢复并验证 closed `integrity` object。

不得通过修改 schema 为某个文档添加 hash exclusion。未来 signature/authenticity 使用 detached envelope 并绑定 content hash，不能塞入可变 exclusion。

`content_sha256` 只检测逻辑内容/并发变化，不证明 publisher、license、ownership 或 delete authority。Model/wheel/archive/media 的 `artifact_sha256` 是**原始文件 bytes hash**；schema/source 可同时有 JCS logical digest 和 distribution raw artifact digest，两者不得混名。

上游 Comfy workflow 不插入 internal `integrity`。P0-CON-010 sidecar 必须分别记录 canonical visual workflow JCS hash、derived API graph JCS hash、locked frontend/template/schema fingerprints；这些 hash 不授权自动 queue。

## 9. Integer、unit、time 与 rational

### 9.1 数字与单位

- 核心合同不得使用 JSON fractional number。Percentage、confidence、ratio、FPS、duration 和 timebase 不能用 binary float。
- Exact counter 使用 integer 和不可歧义字段/unit：`*_bytes`、`*_frames`、`*_samples`、`*_steps`、`*_hz`、`*_basis_points` 等。存储 size 一律 bytes；UI 的 KiB/MiB/GiB 是派生显示。
- 不能用整数精确表达的量使用 reduced rational：`numerator`、正 `denominator` 和 schema 明确的 `unit`。分母不得为 0；GCD 必须为 1；负号只在 numerator；0 固定表示为 `0/1`。
- 时间轴推荐 `ticks + timebase`：真实秒数为 `ticks * numerator / denominator`。比较/换算使用 arbitrary-precision cross multiplication 并显式检查最终范围，不能先转 float。
- Schema 必须列出 unit enum；不得接受自由文本 unit、`MB`、`fps-ish` 或隐式秒。
- 24 FPS、40 Hz audio-latent、32 kHz PCM 等属于 P0-CON-009/recipe 的值，不在本 ADR 预设；本 ADR只规定它们如何无损表示和比较。

### 9.2 Timestamp

普通 wall-clock timestamp 采用唯一 shape：

```text
YYYY-MM-DDTHH:mm:ss.SSSZ
```

- JSON Schema assertion format 名称固定为 `utc-date-time-ms`；validator 必须执行 lexical pattern 与 calendar-validity 检查，不能把 custom `format` 当 annotation 忽略。
- 必须是 calendar-valid UTC、exact 三位毫秒、uppercase `T/Z`；拒绝 local offset、无时区、leap second `:60`、多余精度和空格。
- Timestamp 不用于 duration/frame/sample math，也不单独用于 ordering/identity。事务顺序另用单调 `sequence` integer 和 revision/hash。
- Windows FILETIME/process creation 等需要更高精度时，具体 schema 使用 safe integer ticks + explicit epoch/unit，并可另带上述 display timestamp；不得截成 float seconds。
- `created_at_utc` 在同一 logical document 中不可变。mutable observation 可有 `observed_at_utc`；可重现 recipe/catalog 不得在 build 时注入“当前时间”破坏 deterministic content。

## 10. Windows path 表示与 containment

### 10.1 两种 path 类型

合同必须区分：

1. **Windows absolute path**：JSON Schema assertion format 固定为 `windows-absolute-path`，只存在于 private local state，例如 `D:\MiniMaxH3\项目`。存储形式使用 uppercase drive letter、反斜杠、无尾斜杠（volume root 除外），保留实际 segment case/code points。不得存储 `\\?\`/`\\.\` device prefix；它只是内部 API 实现细节。
2. **Contract-relative path**：assertion format 固定为 `contract-relative-path`，用于 owned root、artifact/archive 内部定位；使用 `/`，不得以 `/` 开头，不得含 `\`、drive、colon、空 segment、`.`、`..` 或 percent-encoded traversal。

UNC、device path、ADS、alternate stream、8.3 alias、shell URI 和 relative Windows path 默认禁止；未来若支持，必须使用新的 explicit `path_kind` union/capability，不能让普通 string 悄悄接受。

Path 不做 Unicode normalization 或全量 lowercase。Drive letter 可 uppercase；其余显示文本保留。字符串比较最多是初筛，最终 identity/containment 必须绑定 volume identity、file ID/handle 和 reparse policy。

### 10.2 User-selected path 不是可信路径

每次路径可能影响读、写、删、启动、模型复用或 workflow input 时，consumer 必须：

1. 区分 raw user text 与 validated/effective path；raw text 不能进入 process argument 或 authority ledger；
2. 拒绝 NUL/control、device/UNC/ADS（除非 explicit capability）、非法/保留 segment、trailing dot/space、`.`/`..` 和超限；
3. 用 Windows API 得到 absolute normalized path，并验证 local/fixed/NTFS/volume policy；
4. 用 handle/volume/file identity 验证 nearest existing ancestor 与目标；检查每个 reparse point，不用裸 string prefix 作为 containment 证明；
5. create/open 后再次验证 handle-resolved target，防止 TOCTOU；
6. 只在 owner/ledger/action policy 同时允许时 mutate/delete；外部模型/instance 即使路径 contained 也保持 external-read-only；
7. 向 process 传独立 argument，不构造 shell string。

String containment 若用于预检，必须先 full normalize，并比较 `root + separator` 或 exact root，使用 Windows ordinal case-insensitive semantics；它永远不能替代 handle/reparse verification。

### 10.3 Path limits 与公开输出

- Stored absolute path 上限 32,767 UTF-16 code units；每个 segment 同时服从目标 volume 实际上限，schema/产品可以更低。
- Contract-relative path 上限 4,096 UTF-8 bytes、每 segment 255 UTF-8 bytes。
- 普通日志、public evidence、support bundle 和示例不得包含用户名或 private absolute path。输出 stable opaque path ID、owned-root-relative locator 或已批准的分类；不默认输出 path hash，因为低熵路径可能被猜测。

## 11. Trust-boundary compatibility

“文件在本机”不等于可信。每个 concrete schema 必须声明一个 primary trust class，并按下表处理：

| Trust class | 例子/下游 | Unknown/版本 | 在 action 前必须证明 |
|---|---|---|---|
| Immutable authority | P0-CON-002 capability/allowlist、P0-CON-003 component、P0-CON-004 recipe/catalog | exact schema/digest；core unknown 拒绝；仅 bounded display extension 可保留；不 in-place migrate | provenance、artifact/schema hash、status/license/hardware gate、签名策略（如适用） |
| Mutable control state | P0-CON-006 install transaction、P0-CON-007 ownership ledger、P0-CON-011 run/checkpoint | exact 或 explicit migration；core unknown/newer 拒绝 | integrity、revision/CAS、owner、state transition、atomic commit |
| Persisted user configuration | P0-CON-005 project spec、P0-CON-009 plans | 输入始终 untrusted；unknown core 拒绝；prompt/text 不解释为 code | limits、slot/route/capability、effective values、path/media policy；只编译不提交 |
| Runtime observation | P0-CON-008 hardware report、live managed schema observation | normalized core closed；unknown source 仅 bounded raw evidence；允许显式 `unknown` non-actionable 状态 | source/confidence、freshness、conflict；observation 单独不能选 recipe/model |
| User-selected path | managed root、model/source picker | 不是普通“已验证 string”；每次 action 重验 | Windows handle/volume/reparse/containment、owner/action policy |
| External-instance discovery | P0-CON-008/adapter candidate | static observation；unknown version/layout -> unsupported | 不执行 Python/node、不改配置、不启动/停止；不能继承 managed certification |
| Generated visual/API graph | P0-CON-010 workflow build | exact locked upstream format/frontend/template；unknown executable/subgraph/output 拒绝 | 所有 graph layers allowlist/schema lint、source hashes；API graph不执行 |
| Technical run/checkpoint evidence | P0-CON-011 | exact runtime/project/recipe/parent hash；unknown state/codec 拒绝 | 用户 Run 边界、atomic commit、timebase、local H3 provenance |

一个文档若跨多个 class，采用最严格 class，或拆成 authority/control/observation sidecars。不得把 raw discovery 直接保存成 approved registry，也不得把 display extension 复制进 process args、model bridge 或 graph。

## 12. Deterministic validation error contract

### 12.1 Normalized error shape

每个 schema constraint 必须有稳定 `x-error-code`/rule ID。实现把具体 validator 的输出归一化为：

```json
{
  "code": "CONTRACT.UNKNOWN_FIELD",
  "contract_id": "minimax-h3-tool.example",
  "schema_version": "1.0.0",
  "instance_path": "/parent/field",
  "rule_id": "core.object.closed"
}
```

- `code`、`instance_path`、`rule_id` 是每条 normalized error 的 required fields。只有 minimal envelope 已成功识别时才加入 `contract_id`/`schema_version`；不能识别时 omitted，不写 null。
- `code` 形式为 `NAMESPACE.UPPER_SNAKE_CASE`，稳定、不可本地化；UI 根据 code 映射文字。
- `instance_path` 使用 RFC 6901；root 是空字符串。Malformed UTF-8/JSON 的 `instance_path` 固定为空字符串，并增加 zero-based original UTF-8 `byte_offset`；无法确定时 omitted，不猜值。
- `rule_id` 是 schema owner 分配的永久 ASCII ID；schema 重排不能改变它。
- error 不包含 invalid value、prompt、token、完整 path、素材名或任意 source snippet。内部开发模式可以持有敏感 pointer，但普通日志/support projection 必须把 unknown/sensitive segment 改成固定占位符。
- correlation ID、timestamp、localized message 不进入 deterministic error identity，可位于外层诊断 envelope。

### 12.2 归一化和排序

- parse/size/encoding/envelope/version/integrity/schema/domain/cross-contract 各阶段有独立 code；后阶段不得掩盖前阶段 fail-closed。
- `oneOf` branch 噪声折叠成 discriminator/union 的 stable primary error；不得暴露 validator-specific 子错误顺序。
- 返回所有可独立定位错误，但最多 256 条；超限时保留排序后的前 255 条并追加唯一 `CONTRACT.TOO_MANY_ERRORS`。
- 排序固定为：RFC 6901 escaped `instance_path` 的 UTF-8 bytes unsigned lexicographic order、ASCII `code`、ASCII `rule_id`；完全相同 error 去重。
- 相同 schema digest + 相同 logical input 必须在所有受支持实现上产生相同 ordered `(code, instance_path, rule_id)` tuples。
- 每个 invalid fixture 必须声明 exact expected tuple；P0-CON-012 禁止只断言“validation failed”。

建议公共 parse codes 至少包含：`CONTRACT.INPUT_TOO_LARGE`、`CONTRACT.INVALID_UTF8`、`CONTRACT.DUPLICATE_KEY`、`CONTRACT.INVALID_JSON`、`CONTRACT.UNKNOWN_CONTRACT`、`CONTRACT.UNSUPPORTED_VERSION`、`CONTRACT.INTEGRITY_MISMATCH`、`CONTRACT.UNKNOWN_FIELD`、`CONTRACT.UNKNOWN_ENUM`、`CONTRACT.UNKNOWN_UNION_KIND`、`CONTRACT.TOO_MANY_ERRORS`。具体合同使用自己的 namespace 扩展。

## 13. Global limits

Limits 在 parse 前/流式解析中尽早执行；schema 可以收紧，不能静默放宽。超过全局 ceiling 需要修订本 ADR及专门资源/DoS 测试，不能只改一个 schema。

| 项目 | 全局 ceiling |
|---|---:|
| 单个 JSON document raw UTF-8 | 16 MiB |
| nesting depth | 64 |
| total JSON values/nodes | 200,000 |
| 单 object properties | 10,000 |
| 单 array elements | 10,000 |
| 单 key | 128 UTF-8 bytes |
| 单 string | 1 MiB UTF-8 |
| 全文所有 string 合计 | 12 MiB UTF-8 |
| `extensions` entries | 32 |
| 单 extension JCS bytes | 256 KiB |
| 全部 extensions JCS bytes | 1 MiB |
| validation errors | 256 |
| identifier（若 concrete schema 未更低） | 128 ASCII bytes |

JSON 不内嵌 binary/base64 model、media、archive、wheel、thumbnail 或 checkpoint tensor；只引用有 role/length/hash/ownership 的 artifact。Compressed/archive container 的 bomb/count/path limits 由安装合同另定，解压后不能绕过本表。

## 14. Migration 与 downgrade refusal

### 14.1 Migrator 要求

Migration registry 使用 exact `(contract_id, from_version, from_schema_sha256, to_version, to_schema_sha256, migrator_id/version)` edge。每条 edge 必须：

1. 先用 exact old schema 和 integrity 验证输入；损坏/unknown 输入不“修复”；
2. 是 pure、deterministic、bounded transform；不得读网络、系统时间、随机数、hardware、环境变量、external files 或 global state；
3. 不删除 unknown core field 来求通过；只按已知语义转换；
4. preserve `document_id`，使 `document_revision + 1`，重新计算 integrity；
5. 输出 `derived_from` lineage（old document ID/revision/hash + migrator identity）；wall-clock migration event 进入 transaction journal，不进入 deterministic migrated content；
6. 用 exact target schema 完整验证并执行 cross-contract invariants；
7. 把 original bytes/hash 保存在 owned rollback evidence，成功 atomic commit 前不覆盖 current；
8. 有 valid、每个 invalid、idempotence/no-op 和 golden canonical-output fixtures。

不得跨未知中间版本跳跃。多 edge migration 每一步独立验证/记录；任何一步失败保留 original current。Migrator 不能选择 recipe、补 prompt、猜 path/model/node、提升 capability status 或产生自动 queue intent。

### 14.2 各 trust class 的演进方式

- Immutable authority：保留 exact old document/validator；需要新表示时产生新 document ID/hash，并显式 `derived_from`，不原位迁移。
- Mutable control/project state：只沿受测 edges 迁移，通过 CAS + atomic replace 提交。
- Runtime observation：保留 raw evidence hash，重新 normalize 为新 observation；不能用 migration 把 unknown 变成 proven。
- Generated workflow：从原权威 ProjectSpec + locked template/frontend 重新 compile 为新 build；不编辑旧 graph“升级”。
- Checkpoint：ABI/schema/hash 任一不兼容就拒绝 resume；不得做通用 downgrade 或 best-effort load。

## 15. Atomic persistence 与并发

### 15.1 Mutable documents

在 supported local NTFS root 上，持久化 mutable document 必须：

1. 获取该 document/transaction 的 mutex 或 lease；
2. 读取 current，验证 owner、revision、integrity 和 expected prior hash（CAS）；
3. 构造 revision `N+1`，完整 schema/cross-contract validate，生成 exact JCS bytes；
4. 写入**同一目录**的 owned unique candidate，并在关闭前调用等价 `FlushFileBuffers` 的 durable flush；
5. 需要时写 durable journal 的 prepared record；
6. 用 Windows same-volume `ReplaceFile`/atomic rename（新文件发布使用具有等价 write-through 语义的操作）切换 current；不得跨卷 move；
7. 重新打开 current 并复验 revision/integrity；随后记录 committed，清理只针对 verified-owned candidate/backup；
8. reader 只读取 current name/pointer，再验证完整 document；candidate/partial 永不成为 current。

CAS mismatch 返回 deterministic conflict，不 last-writer-wins。`document_revision` 只在成功 commit 后成为 current；process crash、disk full、AV lock 或 replace 前中断都不能让 partial 文档声明 active/owned/complete。

### 15.2 Immutable documents/artifacts

- 写入 final content-addressed/immutable generation path 的 owned candidate，验证 bytes/content/schema/provenance 后才发布小 pointer/reference；
- 已存在同 identity 时必须 byte/content hash 相同才能 reuse，否则是 collision/conflict；
- 不原地 patch recipe/catalog/component manifest/workflow build/checkpoint commit；
- P0-ARC-006/ADR-002 的 final-generation 和 small active-pointer 规则优先，合同不能创建第二套 activation truth。

## 16. Sensitive fields、redaction 与 support export

### 16.1 Schema annotations

每个 property 必须声明或继承 `x-sensitive` 和 `x-trust-impact` annotation：

- `x-sensitive`: `public | internal | local_path | prompt | asset_name | account | token | personal_data`；
- `x-trust-impact`: 一个 non-empty、去重并按本文次序排序的 array，元素来自 `display | observation | execution | ownership | path | artifact | graph | recovery`；多重影响必须全部列出，`display` 不能用来掩盖 operational impact。

Annotation 不替代 validation。schema lint 必须拒绝缺 annotation 的 property；`token/prompt/local_path/...` 不能因为未标注而默认 public。

### 16.2 Default-deny export

- 普通日志/support bundle 使用字段 allowlist，不是“列几个需删除字段”的 denylist。
- prompt、token、账户名、用户名、absolute path、asset filename、原始媒体和完整 workflow 默认 omit；需要维持 shape 时使用固定分类占位符，不暴露长度/前后缀。
- 不用 unkeyed hash 替代 path/prompt/token，因为低熵内容可被猜测。需要一次 bundle 内关联时使用 ephemeral keyed HMAC 或既有 opaque document/candidate ID，key 不进入 bundle。
- Validation error 不回显 invalid value。Public evidence 只存 relative/opaque locator 和 capability result。
- Artifact SHA-256、immutable upstream revision 可以是 public provenance，但必须先确认它不来自 private user content。
- `extensions.data` 默认不导出；raw observation 只导出 explicitly approved fields。

## 17. Provenance、lineage 与 correlation IDs

- `correlation_id` 使用 lower-case UUIDv4，每个 install transaction、launch、workflow build 和 formal run 分域；它只用于事件关联，不是 auth token、ownership proof 或 queue permission。
- `document_id`、domain ID 和 correlation ID 不复用。正式 Run correlation 只能在真实 frontend user event 后关联 backend request；预生成 ID 不构成提交授权。
- 会形成 authority/selection 的 provenance 必须包含 creator/publisher/packager（适用时）、exact immutable source revision、artifact length/hash、license reference、producer build identity 和 evidence/status。mutable `main/latest` 无效。
- Derived document 至少绑定 source document ID/revision/content hash、producer/migrator/compiler identity 和 output content hash。
- `observed_at_utc`/source claim 不会自动把 `found` 提升为 `verified/compatible/approved/selected`，也不会把 `poc_pending` 提升为 proven。
- content hash 不等于签名；signature/trust anchor 是单独 release contract/external gate。
- 普通 correlation/provenance event 不保存完整 prompt、path 或媒体名称。

## 18. Downstream traceability

| 本 ADR 决策 | 至少一个下游落点/例子 |
|---|---|
| contract/schema/document identity + exact registry | P0-CON-002 capability catalog、P0-CON-003 component manifest、P0-CON-004 recipe 的 root envelope |
| SemVer/compatibility/downgrade refusal | P0-CON-006 install state migration；older app 遇到 newer ownership ledger 必须只读拒绝 |
| required/omitted/null/default | P0-CON-005 optional asset slots/original-effective text；P0-CON-009 endpoint strategy |
| strict unknown/extension policy | P0-CON-002 unknown node/status、P0-CON-007 unknown delete authority、P0-CON-010 unknown graph/subgraph |
| enum/discriminated union | P0-CON-006 install states、P0-CON-008 model progression/conflict source、P0-CON-011 run/checkpoint states |
| JCS/integrity/hash projection | P0-CON-003 raw artifact vs logical manifest hash、P0-CON-004 recipe identity、P0-CON-010 visual/API hashes、P0-CON-011 checkpoint parent hash |
| UTF-8/exact user text | P0-CON-005 Unicode prompt/asset labels；compiler不得 normalize/trim |
| integer/rational/timebase/timestamp | P0-CON-009 requested/generated/delivered frames、24/40/32000 time domains；P0-CON-011 media/checkpoint PTS |
| Windows path/containment/private output | P0-CON-006 managed root/transaction、P0-CON-007 delete target、P0-CON-008 external model candidate |
| trust classes | P0-CON-002 immutable authority、P0-CON-005 untrusted project、P0-CON-008 observation/discovery、P0-CON-010 generated graph |
| deterministic error tuples | P0-CON-012 intentional mismatch corpus，必须断言 exact code/path/rule |
| explicit migration | P0-CON-005/006/007 mutable docs；P0-CON-002/003/004 immutable docs不原位迁移 |
| atomic persistence/CAS | P0-CON-006 partial install、P0-CON-007 ownership ledger、P0-CON-011 segment/checkpoint commit |
| sensitive annotations/redaction | P0-CON-005 prompt、P0-CON-008 local paths/hardware IDs、P0-CON-010 workflow、P0-CON-011 run evidence |
| provenance/lineage/correlation | P0-CON-003 creator/packager/license、P0-CON-010 compiler/build、P0-CON-011 run/segment parent chain |
| global limits/no embedded binary | P0-CON-002 catalog、P0-CON-005 project、P0-CON-010 graph、P0-CON-011 checkpoint references |

P0-CON-012 必须同时验证单 schema constraints 与跨合同不变量；一个文档单独 valid 不代表 capability/component/recipe/project/install/ownership/hardware/route/workflow 组合可行动。

## 19. Reviewer checklist

每个 P0-CON-002..011 schema review 必须回答：

- [ ] `$schema` 是 Draft 2020-12，`$id`/`$ref` exact 且可离线解析，没有 `latest/main`。
- [ ] root envelope、contract/schema/document identity 和 integrity profile 符合本文。
- [ ] schema 声明 primary trust class；跨 class 数据已拆分或采用最严格策略。
- [ ] 每个 object closed；组合没有 accidental open properties。
- [ ] 每个 operational field required 或在 strict discriminator branch 中。
- [ ] 每个 optional 的 omitted semantics 明确；null/default/empty 不被混用。
- [ ] unknown core/enum/kind 的 fail-closed fixtures 存在；display extension 有 preserve/bounds fixture。
- [ ] 所有 integer 在 safe range；fraction 用 reduced rational，unit/timebase exact，无 float。
- [ ] timestamp exact UTC milliseconds；ordering 另有 revision/sequence。
- [ ] Windows absolute/relative path 类型分开；containment/reparse/owner 不是 string-prefix 推断。
- [ ] JCS content hash、raw artifact hash 和 schema digest 名称/测试分开。
- [ ] duplicate key、invalid UTF-8/BOM、oversize/depth/count invalid fixtures 存在。
- [ ] migration edge pure/deterministic/non-lossy；unknown/newer/downgrade 拒绝。
- [ ] mutable persistence 定义 CAS/revision/same-directory atomic commit；immutable 文档不原地更新。
- [ ] 每个 property 有 sensitivity/trust-impact；support export default deny且错误不回显值。
- [ ] provenance 使用 exact immutable revision/hash；ID/correlation 不被当 authority。
- [ ] validator 输出 exact sorted error tuples，oneOf 噪声已归一化。
- [ ] concrete schema 没有创建 shell/HTTP/queue/cloud/auto-Run/prompt-creative 通道。
- [ ] valid/invalid/boundary/golden-canonical fixtures 和 schema JCS digest evidence 齐全。
- [ ] cross-contract references 绑定 ID + revision + content hash，而不是裸 ID/“current”。

任何一项未回答或需 implementation-specific 默认时，schema 保持 Proposed/blocked，不解锁 consumer。

## 20. 后果、未决项与证据状态

### 正面

- 下游作者拥有统一的 strict core、可控 display extension、exact version 和 error contract；
- 高风险新字段不能被旧 reader 静默忽略；
- path/time/frame/hash/migration 在 TypeScript、Rust、.NET 等实现间可复现；
- mutable state、immutable authority、observation、external discovery 和 generated graph 不再混用信任假设；
- P0-CON-012 可以用 exact tuples/cross-hash 做真正的回归门。

### 成本

- Reader 需要 duplicate-detecting parser、JCS、exact schema registry、migration registry 和 atomic persistence；
- Strict forward compatibility 会让旧版本拒绝新的 operational minor，而不是“尽量打开”；
- 每个 schema 需要更多 invalid/boundary/redaction/migration fixtures；
- Extension 只能保存展示数据，不能作为快速增加 runtime feature 的后门。

### 证据状态

- **Binding input / accepted：** ADR-001 产品边界、ADR-002 Managed Core/ownership/path/Run 边界、Decision Log accepted decisions。
- **本文决策 / Accepted：** 本 ADR 的 serialization/compatibility conventions 已由 Root 接受；后续 schema 必须逐项提供实现与 fixture 证据。
- **尚未证明：** 任一具体 P0-CON-002..011 schema、validator implementation、跨语言 JCS/error equivalence、migration/atomic persistence code。
- **失败回退：** Root 不接受任一 convention 时，明确列出 unresolved choice 并保持对应 schema task blocked；不得由业务 schema 各自选默认。

Root acceptance 后，直接解锁 P0-CON-002、003、005、007、008、011；P0-CON-004、006、009、010、012 继续等待各自其余依赖，但同样受本文约束。

## 21. 重新评审触发

以下变化必须修订本 ADR：

1. 更换 canonical JSON/hash profile、数字范围或 timestamp/path 表示；
2. 允许 unknown operational fields/extensions 被旧 reader 执行；
3. 引入自动 downgrade、best-effort checkpoint load 或 lossy silent migration；
4. 增大全局 resource limits；
5. 允许多 managed root、UNC/device path 或不同 containment policy；
6. 改变 sensitive export、error value 回显或 public path policy；
7. 让合同字段/extension触发 shell、任意 HTTP、cloud/Partner、queue submit 或自动 Run；
8. 将 content hash 当作签名、ownership/delete authority 或 capability proof；
9. 让 observation/discovery 直接提升为 approved/selected/proven；
10. 下游需要无法由本文明确处理的新 trust class。

## 22. 依据文件

- [`ADR-001-product-process-boundary.md`](ADR-001-product-process-boundary.md)
- [`ADR-002-runtime-topology.md`](ADR-002-runtime-topology.md)
- [`OPTIMIZED_ARCHITECTURE.md`](../OPTIMIZED_ARCHITECTURE.md)
- [`DECISION_LOG.md`](../DECISION_LOG.md)
- [`TASK_BREAKDOWN.md`](../../tasks/TASK_BREAKDOWN.md)
