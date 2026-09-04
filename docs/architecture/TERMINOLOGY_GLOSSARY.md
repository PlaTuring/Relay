# MiniMax H3 Tool — Terminology and UI-language Glossary

> Task: `P0-GOV-006`  
> Status: normative Phase 0 terminology baseline  
> Machine authority: [`tests/fixtures/governance/terminology/glossary.valid.json`](../../tests/fixtures/governance/terminology/glossary.valid.json)  
> Scope: product, architecture, contracts, diagnostics, installer copy, workflow copy, support copy, and release claims

## 1. Normative use

This glossary fixes machine identifiers and Chinese UI meanings. Architecture and contract identifiers use the exact casing shown here. Normal UI may pair a plain Chinese label with a normative token, but it may not change the semantic actor, lifecycle state, execution location, or evidence level.

When another document uses a looser upstream name such as T2V/I2V, the product route and UI still use `T2VA`/`I2VA` so the native-audio part is not erased. `FL2VA` must be qualified as either an FL2VA route or an FL2VA model family when context could be ambiguous. The bare word “generation” must be qualified as `runtime generation` or `media generation` in technical records; normal UI calls the former “运行环境版本”.

本工具不生成视频或声音。The tool installs, detects, verifies, configures, compiles, and hands off. The user explicitly clicks **Run** in visible ComfyUI; only then does MiniMax H3 generate the actual video and native audio inside ComfyUI.

```text
Tool control plane: compile -> handoff -> zero formal queue submissions
User in ComfyUI:                         Run
MiniMax H3 in ComfyUI:                   media generation
```

## 2. Route truth table

Routes are selected only from supplied slots, never from content classification. Empty-text support, exact duration, crop behavior, and endpoint preservation remain separate capability gates.

| Route | First frame | Last frame | Reference media | Model family | Baseline text rule |
|---|---|---|---|---|---|
| `T2VA` | absent | absent | absent | FL2VA | non-empty user text in Alpha baseline |
| `I2VA` | required | absent | absent | FL2VA | empty text needs a separate capability |
| `L2VA` | absent | required | absent | FL2VA | empty text needs a separate capability; preserve last anchor |
| `FL2VA` | required | required | absent | FL2VA | empty text needs a separate capability; preserve both anchors |

<!-- glossary:route.t2va -->
- `T2VA` 是无首帧、无尾帧、无参考素材的文字到视频与原生音频路由；Alpha 基线要求非空用户文本，使用 FL2VA 模型家族。

<!-- glossary:route.i2va -->
- `I2VA` 是仅有首帧锚点、没有尾帧锚点的图像到视频与原生音频路由；空文本是否可用由独立 capability 决定。

<!-- glossary:route.l2va -->
- `L2VA` 是仅有尾帧锚点、没有首帧锚点的尾帧到视频与原生音频路由；任何交付策略都必须保留尾锚。

<!-- glossary:route.fl2va -->
- `FL2VA` 路由是同时具有首帧和尾帧锚点的视频与原生音频路由；两端都必须按已认证的 FrameAudioPlan 保留。

## 3. Runtime, model, and generation

Runtime software and model artifacts are separate component cards, manifests, ownership records, download sizes, and validation decisions. A runtime version being active does not imply that any model is present, compatible, approved, or selected.

<!-- glossary:model.fl2va_family -->
- `FL2VA 模型家族` 是为 T2VA、I2VA、L2VA 和 FL2VA 四种端点路由提供 H3 扩散权重的模型家族；它不是工作流路由名称的同义替代。

<!-- glossary:model.ref2va_family -->
- `Ref2VA 模型家族` 是独立的参考图片、视频或音频条件模型家族；它不是 FL2VA，也不能作为端点路由的静默回退。

<!-- glossary:runtime.runtime -->
- `runtime` 是执行锁定 ComfyUI、Python/Torch/CUDA、批准的本地节点和媒体库的软件环境；它不包含模型权重，也不表示正在生成媒体。

<!-- glossary:runtime.generation -->
- `runtime generation` 是最终路径中的一个不可变运行环境安装版本及其 generation ID；它是部署版本，不是视频生成动作。

<!-- glossary:execution.media_generation -->
- `media generation` 是用户在 ComfyUI 中点击 Run 后，由 MiniMax H3 节点执行并产生实际视频与原生音频的过程。

<!-- glossary:model.model -->
- `model` 是单独验证、按角色绑定的权重或模型组件，不是 runtime，也不会因被发现而自动获准复用。

### Base model roles

The Alpha base package contains exactly one hardware-appropriate FL2VA diffusion artifact plus the shared text encoder, Video VAE, and Audio VAE. These are four roles, not four interchangeable files. Ref2VA and Turbo/LoRA are separately gated additions.

<!-- glossary:model.role.diffusion -->
- `model_diffusion` 是 H3 联合视频与音频扩散权重角色；Alpha 基础包只选择一个与硬件配方匹配的 FL2VA artifact。

<!-- glossary:model.role.text_encoder -->
- `model_text_encoder` 是共享 H3 文本编码器角色；它编码用户提供的文本，不授权工具扩写、翻译或创作文本。

<!-- glossary:model.role.video_vae -->
- `model_video_vae` 是 H3 视频 latent 编解码组件角色，必须与锁定配方和扩散权重兼容。

<!-- glossary:model.role.audio_vae -->
- `model_audio_vae` 是 H3 音频 latent 编解码组件角色，不能被 BGM、旁白或后期混音组件替代。

## 4. Runtime topology

| Topology | Ownership | Default behavior | Stable execution meaning |
|---|---|---|---|
| Managed Core | tool-owned | managed execution | Alpha default, exact immutable runtime generation |
| Desktop | external-owned | attach-only | adapter capability must be proven for an exact version |
| Portable | external-owned | attach-only | adapter capability must be proven for an exact layout/version |

<!-- glossary:runtime.managed_core -->
- `Managed Core` 是工具拥有、锁定、不可变、仅绑定 loopback 的本地 ComfyUI Core 运行环境，也是 Alpha 默认执行路径。

<!-- glossary:runtime.desktop -->
- `Desktop` 是已存在或另行安装的 ComfyUI Desktop 环境；默认仅静态只读发现，除非精确版本的 adapter capability 已获证据支持。

<!-- glossary:runtime.portable -->
- `Portable` 是外部拥有的便携式 ComfyUI 布局；默认仅静态只读发现，不能因目录被发现就视为可执行或已认证。

<!-- glossary:runtime.attach_only -->
- `attach-only` 表示只读发现外部环境，禁止启动未知 Python、导入 custom node、安装依赖或修改其私有状态。

## 5. Compile, handoff, Run, and generation

`compile`, `handoff`, `Run`, and `media generation` are separate events with different actors and side effects. A compiled derived API graph is audit evidence, not a pending execution command. 交接不得调用 `/prompt`、不能模拟 Run、不能用“自动打开”暗示已经开始生成。

<!-- glossary:workflow.compile -->
- `compile` 把 ProjectSpec 与锁定配方确定性转换为 canonical visual workflow 和派生审计图；它不执行 H3、不生成媒体、不提交队列。

<!-- glossary:workflow.handoff -->
- `handoff` 启动或聚焦正确的受管 ComfyUI 并呈现精确 workflow；它不点击 Run，也不调用 `/prompt`。

<!-- glossary:workflow.run -->
- `Run` 仅指用户在可见的 ComfyUI 前端执行的明确运行动作；它触发用户第一笔正式队列提交，工具不能代理。

<!-- glossary:workflow.prompt_endpoint -->
- `/prompt` 是 ComfyUI 正式队列提交端点；工具的 compile、open 和 handoff 阶段调用数必须为零。

<!-- glossary:audio.native -->
- `native audio` 是 MiniMax H3 在同一次 ComfyUI 执行中生成并随视频输出的原生声音，不是 BGM、旁白、后期混音、静音轨或工具提示音。

## 6. Capability and evidence language

Capability readiness and evidence status are different namespaces. A source-level route fact can be `proven` while the corresponding product capability remains `poc_pending`. A recipe or copy file cannot promote either namespace.

<!-- glossary:status.stable -->
- `Stable` 是仅可用于已达到 certified 且所有适用技术、隐私、安全、许可与发布 gate 均关闭之精确能力/profile 的用户界面标签；它不是机器状态值。

<!-- glossary:status.hidden -->
- `hidden` 表示当前阶段不提供该能力，普通与高级界面都不得把它宣传为可用。

<!-- glossary:status.poc_pending -->
- `poc_pending` 表示锁定版本的可重复 PoC 尚未完成，只能出现在开发诊断中，不能标为 Stable、可运行或已认证。

<!-- glossary:status.internal -->
- `internal` 表示能力仅在明确内部 profile 上重复通过，仍未完成所有外测、许可或发布 gate。

<!-- glossary:status.certified -->
- `certified` 表示精确版本、profile、地域和适用 gate 的技术、隐私、安全、许可与发布验收全部关闭；只有它可映射到 Stable UI。

<!-- glossary:status.experimental -->
- `experimental` 表示存在实测证据但未达到 Stable 门槛，只能在高级入口默认关闭并清楚显示范围、风险和回退。

<!-- glossary:evidence.proven -->
- `proven` 只表示某项事实由不可变上游证据或已接受的可重复 PoC 支持，不会自动把产品 capability 升为 certified。

<!-- glossary:evidence.inferred -->
- `inferred` 表示结论来自推断而非可重复证明，不能进入 Stable 默认路径。

## 7. Local-node and model-reuse truth

Partner/API 节点不是本地节点；相似显示名、同一厂商或同一功能描述都不能替代锁定的 `class_type + schema fingerprint + source revision + local-only` 证明。发现不等于批准复用；状态只能按下列顺序推进，且只有 `selected` artifact 能进入当前 workflow build。

```text
found -> identified -> verified -> compatible -> approved -> selected
```

<!-- glossary:node.local -->
- `local node` 是以锁定 class_type、schema fingerprint、来源 revision 和 local-only 状态批准的 ComfyUI 节点。

<!-- glossary:node.partner_api -->
- `API/Partner node` 是远程、鉴权、Partner/API 类或不能证明本地执行的节点；即使显示名相似也不是 local node，必须 fail closed。

<!-- glossary:model.state.found -->
- `found` 只表示候选路径被观察到，不证明文件身份、完整性、兼容性、许可或复用批准。

<!-- glossary:model.state.identified -->
- `identified` 表示受限元数据、header 与角色指纹足以建立候选身份，仍未证明完整哈希或 recipe 兼容。

<!-- glossary:model.state.verified -->
- `verified` 表示精确完整性与来源身份已核验，仍不等于与当前 recipe 兼容或获准复用。

<!-- glossary:model.state.compatible -->
- `compatible` 表示候选与精确 runtime、hardware 和 recipe 要求匹配，仍需适用批准后才能复用。

<!-- glossary:model.state.approved -->
- `approved` 表示来源、许可、所有权和复用策略检查已接受，候选可以被选择但尚未绑定当前 recipe。

<!-- glossary:model.state.selected -->
- `selected` 表示已批准 artifact 被绑定到当前 recipe 的精确模型角色；只有此状态可以进入 workflow build。

## 8. Desktop handoff levels

Only `OPEN_AND_FOCUS` may be called automatic Desktop handoff, and “automatic” ends at focusing the exact workflow. It never includes Run or queue submission. Coordinate automation, clipboard injection, and private-state edits are not valid Stable implementations.

<!-- glossary:desktop.open_and_focus -->
- `OPEN_AND_FOCUS` 表示精确 Desktop installation 和精确 workflow 已打开并在画布聚焦；它仍不点击 Run 或提交队列。

<!-- glossary:desktop.persist_only -->
- `PERSIST_ONLY` 表示 workflow 可通过受支持接口保存，但没有证据证明它已在正确画布聚焦。

<!-- glossary:desktop.export_only -->
- `EXPORT_ONLY` 表示只导出 workflow 文件并要求用户手动打开，不能称为自动 Desktop handoff。

<!-- glossary:desktop.unsupported -->
- `UNSUPPORTED` 表示版本、schema 或实例身份未知，必须 fail closed 并使用安全的手动导出或 Managed Core 路径。

## 9. UI-language contract

| Surface | Required or permitted copy | Rejected meaning |
|---|---|---|
| Project primary action | “生成工作流并打开 ComfyUI” | “生成视频”, “开始生成”, “立即运行”, tool-side Run |
| Handoff instruction | Ask the user to inspect the graph and click Run in ComfyUI | automatic `/prompt`, automatic Run, background submission |
| Managed Core normal label | “独立 H3 环境（推荐）” | asking normal users to choose Python/Core/CUDA topology |
| Runtime generation | “运行环境版本” | an unqualified “generation” that could mean media generation |
| Found model | State that identity/hash/compatibility/approval checks are still required | “found, so it can be reused directly” |
| Desktop discovery | “已检测到 ComfyUI Desktop；不会修改现有环境” | detected means compatible, certified, managed, or executable |
| Native audio | “H3 原生声音” | automatic music, BGM, voiceover, post-mix, or a synthetic silent track |
| `poc_pending` | “正在验证” in developer diagnostics only | Stable, certified, runnable, or available by default |
| `certified` | “Stable” only for the exact certified scope | extending the claim to other versions, hardware, regions, or routes |

The linter rejects both semantic-data drift and hostile UI copy, including: the tool presented as a generator; handoff presented as automatic `/prompt` or Run; Partner/API presented as local; a `found` model presented as approved reuse; runtime presented as containing model weights; H3 native audio presented as BGM; and `poc_pending` presented as Stable.

## 10. Offline validation and evidence boundary

Run from the repository root:

```powershell
node .\tests\fixtures\governance\terminology\validate-terminology.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tasks\validate_wbs.ps1
```

The terminology validator uses Node built-ins only. It performs no network access, model read, ComfyUI launch, GPU operation, `/prompt` submission, prompt creation, or media operation. Passing it proves only that the glossary data, Markdown mirror, valid copy, and hostile fixtures agree deterministically; it does not prove any H3 capability, runtime compatibility, model approval, Desktop adapter, or Stable release claim.
