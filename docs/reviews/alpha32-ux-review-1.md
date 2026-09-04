# Alpha32 UX / 信息架构 / 文案审查（第一轮）

- 任务：`A32-UX-REVIEW-1`
- 结论：静态审查未发现 P0；确认 6 项 P1、6 项 P2。P1 应在 Alpha32 界面冻结前处理。
- 范围确认：本审查只涉及安装、检测、配置、工作流编译、确定性编排和技术验证。用户在 ComfyUI 中点击 Run 后，只有 MiniMax H3 生成视频与原生音频。
- 行为边界：未点击 Run，未调用 `/prompt`，未提交队列，未生成媒体，未启动或改动外部 ComfyUI / 模型。
- 修改边界：本文件是唯一变更；未修改 renderer、CSS、共享 schema、API 或 lockfile。

## 审查基线与证据等级

审查对象是 root 冻结的最新 `src/renderer` 快照，而不是较旧的 `dist`。冻结快照如下：

| 文件 | SHA-256 |
| --- | --- |
| `apps/control-plane/src/renderer/index.html` | `807BE8DDF8E84A763DC765A1169075BF26E43BAFBC207892CCDFC2A0FA657ABE` |
| `apps/control-plane/src/renderer/index.ts` | `F9283A52C32DC42CB5F151CFDD8DA46E8740949A391D6DD726CCFF599129FF9A` |
| `apps/control-plane/src/renderer/styles.css` | `679B36386603FF78D321C9F89CF472CB866BDF86EF9A787DE8B17BB90946FD8E` |
| `apps/control-plane/src/renderer/component-policy.ts` | `071A2009D85CF20965A8C4E91DBA5893A4ACC661B078D97FCF40219D0992EEF2` |
| `apps/control-plane/src/renderer/director-p1-ui.ts` | `CD18AEDEDF4ED11F4B9781336C0A9961B933423EB55C7499DE53D9F6BD421645` |

- **已证实（proven）**：可由冻结源码、静态选择器或现有自动化测试直接复现。
- **推断（inferred）**：只由 CSS 几何或旧版截图支持，需最新 Alpha32 像素证据确认。
- 本任务没有 `COMFY-DESKTOP` 资源锁，因此没有启动桌面应用，也没有把 Alpha31 截图冒充为 Alpha32 视觉证据。

## P0

未确认 P0。当前最严重的问题会造成失败、误导和中断，但从源码看均为关闭失败（fail closed），没有证据表明会删除用户文件、提交队列或生成媒体。

## P1 — Alpha32 界面冻结前处理

### P1-01 素材详情抽屉同时暴露两个不可完成的动作（已证实）

**影响**：用户看到可用的“复制到项目”和“确认替换记录”，但前者在它唯一可见的状态必定报错；后者确认必定报错，连“取消”或 Escape 也会触发错误反馈。这是当前最明确的假 affordance。

**精确证据**：

- `apps/control-plane/src/renderer/index.html:522-526`：抽屉动作 `#asset-relocate`、`#asset-copy-project`、`#asset-remove-record`、`#asset-save-metadata`。
- `apps/control-plane/src/renderer/index.ts:1314-1316`：`#asset-copy-project` 只在 `storageMode !== "project_copy"` 时显示，并在外部引用可用时启用。
- `apps/control-plane/src/renderer/index.ts:980-990`：`copyLocalAssetToProject()` 只有已经是 `project_copy` 才返回成功；外部引用一律抛出“引用模式素材请通过项目包导出……”错误。因此成功分支恰好被 UI 隐藏。
- `apps/control-plane/src/main/main.ts:558-559` 与 `apps/control-plane/src/shared/ipc-contract.ts:794-796`：已有真实的 `copyProjectAssetIntoProject()` IPC，可完成该动作，但 renderer 适配器没有调用它。
- `apps/control-plane/src/renderer/index.html:632-636`：`#asset-replacement-dialog` 承诺“确认后会把它作为该素材的新源文件”，主动作是“确认替换记录”。
- `apps/control-plane/src/renderer/index.ts:960-973`：对话框候选名称写死为“所选文件与原素材不同”，大小与 SHA-256 取自旧素材记录，不是新选文件；`relocationToken` 也被替换成 `assetId`。
- `apps/control-plane/src/renderer/index.ts:977-978`：`confirmLocalAssetReplacement()` 无条件抛错，确认永远不可能成功。
- `apps/control-plane/src/renderer/index.ts:2126-2151`：取消按钮和 Escape 都调用 `confirmReplacement(... acceptReplacement: false)`，继而进入同一个抛错分支并弹出“素材记录未替换”。取消被错误地表现成失败。

**建议**：

1. 立即把“复制到项目”连接到现有 `window.controlPlane.copyProjectAssetIntoProject()`，成功后重新读取素材并隐藏该按钮。
2. Alpha32 若不准备新增安全的项目素材替换契约，应删除替换确认对话框：不同内容只提示“不是同一文件，请作为新素材导入”，并提供真实的“导入为新素材”动作。
3. 若确实保留替换，主进程必须返回真实、受限的候选摘要和不透明 token，并提供项目素材专用确认 IPC；不得从旧记录伪造候选详情。
4. Cancel / Escape 只关闭对话框、恢复焦点，不调用确认 API，不显示失败反馈。

**验收测试**：

- 给当前项目注入一个 `available + reference` 素材，打开详情后点击 `#asset-copy-project`；断言只调用一次 `copyProjectAssetIntoProject({ projectId, assetId })`，返回后素材为 `project_copy`、按钮隐藏、源文件未改动。
- 让重新定位返回不同 SHA；点击 Cancel 和按 Escape，断言确认 IPC 调用数为 0、对话框关闭、焦点返回 `#asset-relocate`、`#feedback-dialog` 不打开。
- 若选择“导入为新素材”方案，断言页面中不存在“确认替换记录”承诺，且新素材获得新 `assetId`，旧素材及绑定不变。
- 若选择“替换”方案，断言候选文件名、字节数、SHA 均来自主进程预检结果，并分别覆盖确认、拒绝、过期 token、重复内容和取消。

### P1-02 更新失败会遮蔽此前有效结果，状态时间也不真实（已证实）

**影响**：一次离线重试会让此前已发现的新版本和“打开 GitHub 发布页”动作消失；检查尚未完成时，界面已经把当前时间写成“上次检查”。异常路径还同时显示内联失败和阻塞式错误弹窗。

**精确证据**：

- `apps/control-plane/src/shared/update-source.ts:45-58`：失败结果带有 `cached`，契约明确“Failures never replace it”。
- `apps/control-plane/src/renderer/index.ts:2811-2817`：`UpdatePresentation` 没有 `cached`，renderer 无法呈现此前有效结果。
- `apps/control-plane/src/renderer/index.ts:2819-2849`：只有当前状态为 `update_available` 才保留发布页按钮；`network`、`rate_limit`、`malformed` 都清空该动作。
- `apps/control-plane/src/renderer/index.ts:2852-2861`：点击后立即用当前时间构造 `checking`，随后 `#about-update-meta` 显示“上次检查：……”，但请求仍在进行。
- `apps/control-plane/src/renderer/index.ts:2864-2872`：IPC 异常既渲染 `network`，又调用 `showFeedback()`，同一失败出现两套反馈。
- `apps/control-plane/src/renderer/index.html:571-572`：对应选择器为 `#about-update-status`、`#about-update-meta`、`#about-open-release`。

**建议**：把“当前检查尝试”和“上次成功结果”拆成两个状态。检查中或失败时保留此前成功卡片、版本、时间和发布页动作；只在新成功结果到达时替换。可预期的网络、限流和格式失败使用卡片内联状态，不再额外弹模态框。

**验收测试**：

- 预置 `cached.status = update_available`，随后依次返回 `network`、`rate_limit`、`malformed`；断言旧版本、旧成功时间与 `#about-open-release` 始终保留，同时显示本次尝试失败原因。
- Promise pending 时断言“上次成功检查”时间不变化；完成后才更新。
- `rate_limit` 同时显示重试时间和旧有效结果；没有旧缓存时明确显示“尚无成功检查结果”。
- 可预期失败不得打开 `#feedback-dialog`；未知 IPC 异常即使使用模态框，也不得重复显示同一错误。

### P1-03 未验证的可选组件被提前标记为“可复用”（已证实）

**影响**：安装页图例说“已发现，安装前校验”，但 FFmpeg 等外部候选会显示“已检测，可复用”和“已检测，可复用；安装前校验”。这把 `found_unverified` 说成了复用授权，违反 `found → identified → verified → compatible → approved → selected` 的真值顺序。

**精确证据**：

- `apps/control-plane/src/renderer/component-policy.ts:23-35`：外部 `found_unverified` 返回“已检测，可复用”。
- `apps/control-plane/src/renderer/component-policy.ts:38-53`：其进度文案为“已检测，可复用；安装前校验”。
- `apps/control-plane/src/renderer/component-policy.ts:57-77`：同一状态的 requirement 又正确显示“待校验”，单卡内部自相矛盾。
- `apps/control-plane/src/renderer/index.ts:3068-3156`：文案进入 `.component-state strong` 和 `.component-progress__label`。
- `apps/control-plane/src/renderer/index.html:87-89`：安装摘要和图例使用更准确的“已发现待校验 / 已发现，安装前校验”。

**建议**：`found_unverified` 统一为“已找到，待校验”或“已检测，安装前校验”；只有 `verified_reuse` 使用“已验证，可复用”。

**验收测试**：

- 在 `tests/renderer-component-policy.test.mjs` 增加精确文案断言：`ffmpeg_long_video_optional + found_unverified` 的 state、progress、requirement 中均不得出现“可复用”，初始进度仍为 pending。
- `verified_reuse` 必须仍显示“已验证复用 / 已验证，可直接复用”。
- 对 `.component-state`、`.component-progress__label` 和安装图例做同态快照，三处不得表达互相冲突的阶段。

### P1-04 项目列表的“打开项目”实际只选中项目，继续工作仍需第二次选择（已证实）

**影响**：非当前项目的列表行用无障碍名称“打开项目 …”，点击后却停留在项目中心；用户要再从三个同权重次级按钮中选择“快速创建 / 专业导播 / 项目素材库”。当前项目行本身也仍可点击，但只会重新载入后停在原页。项目中心把“继续工作”做成了两步，且没有一个依据上次编辑模式的主动作。

**精确证据**：

- `apps/control-plane/src/renderer/index.html:127-131`：区块标题是“继续工作”，列表行模板的主按钮为 `[data-project-action="open"]`。
- `apps/control-plane/src/renderer/index.ts:2351-2361`：非当前行的 `aria-label` 是“打开项目 …”，却调用 `activateRelayProject(projectId, "home")`。
- `apps/control-plane/src/renderer/index.ts:2561-2581`：`target === "home"` 时不调用 `showView()`，所以没有进入编辑器。
- `apps/control-plane/src/renderer/index.ts:2288-2309`：只有当前项目才追加三个全部为 `button--secondary` 的等权动作；没有“继续上次编辑”。
- `apps/control-plane/src/renderer/index.html:113`：页面唯一明显主动作仍是“新建项目”。

**建议**：项目行点击直接进入其 `editorMode` 对应的上次工作区；或把行明确改名为“选择项目”，选择后提供唯一主动作“继续快速创建 / 继续专业导播”。素材库和另一编辑模式保留为次级动作。

**验收测试**：

- 分别点击 `editorMode=quick` 和 `editorMode=professional` 的非当前行；断言一次操作进入正确页面，焦点落在页面标题，且 `aria-label` 与实际行为一致。
- 当前行必须只有一个视觉主动作“继续……”，另两个入口为次级；不得要求用户先重新选择当前行。
- 若产品坚持两步选择，第一步必须写“选择项目”，第二步主动作必须可键盘访问且在选择后获得清晰状态提示。

### P1-05 “功能规划中”仍作为正常顶级导航呈现（已证实）

**影响**：导入页本身诚实说明不读取文件，但侧栏把“导入工作流”做成与真实页面完全相同的启用按钮。用户只有点击后才知道没有功能，仍属于顶级假 affordance。

**精确证据**：

- `apps/control-plane/src/renderer/index.html:32`：`button.header-tab[data-view-target="import"]` 正常启用，标签只有“导入工作流”，没有“规划中”。
- `apps/control-plane/src/renderer/index.html:534-550`：目标页明确写“功能规划中”“不选择或解析 JSON 工作流”。

**建议**：发布版导航隐藏该入口；若必须展示路线图，则标签显式写“导入（规划中）”，呈禁用/非导航状态并在同一视野解释，而不是允许进入一个空工作区。

**验收测试**：

- 生产构建中不存在正常启用的 `[data-view-target="import"]`，或其可见名称必须含“规划中”、不可触发页面切换且有可访问说明。
- 保留占位页时，深链进入仍不得出现文件选择器、拖放处理、JSON 解析、第三方安装或队列动作。

### P1-06 普通成功也统一弹阻塞式模态框并抢焦点（已证实）

**影响**：素材导入、资料保存、项目创建/复制/恢复等连续工作每完成一步都要求点击“知道了”。成功反馈与错误、警告共用同一模态层，降低批量整理素材和项目的效率。

**精确证据**：

- `apps/control-plane/src/renderer/index.html:621-625`：`#feedback-dialog` 是带“知道了”主按钮的 `<dialog>`。
- `apps/control-plane/src/renderer/index.ts:595-617`：`showFeedback()` 对 success/warning/error 一律 `showModal()` 并把焦点移到关闭按钮。
- 典型普通成功调用：素材导入 `index.ts:2024-2031`、素材资料保存 `index.ts:2098`、复制项目素材 `index.ts:2161-2165`、项目恢复 `index.ts:2429-2430`、项目创建 `index.ts:2693-2694`、项目复制 `index.ts:2737-2738`。

**建议**：普通 success 使用非模态、自动消退但可被读屏读取的状态/Toast；warning、error 仅在必须阻止继续或需要用户决策时使用模态框。批量导入的部分失败可保留可展开的持久结果，但不应把纯成功变成确认步骤。

**验收测试**：

- 素材成功导入、保存资料、创建/复制/恢复项目后，断言 `#feedback-dialog.open === false`，触发控件/下一工作控件仍保有焦点，`role="status"` 区域读出结果。
- 错误与危险确认仍具备焦点圈闭、Escape 行为和返回焦点；普通 success 不应抢焦点。
- 连续导入三批素材不需要额外点击“知道了”。

## P2 — 清晰度、一致性与视觉收尾

### P2-01 主工作区仍直接暴露过多工程术语（已证实）

**影响**：安全细节本身必要，但直接铺在新手主路径会掩盖“会发生什么”和“下一步做什么”。专业导播的每张镜头卡还显示内部 ID 与 fingerprint。

**精确证据**：

- 安装页：`index.html:70,75-77,97,99` 的“完整 SHA-256”“统一受管根”“`.minimax-h3`”“安装事务”“安全解压与物化”。
- 快速创建：`index.html:165,180,183` 的“官方三字段/六字段”“multiple=32”“静态展开为多段实验链”。
- 专业导播：`index.html:206,340,371` 的“确定性编译”“不可变 Revision”“机械继承”；`director-p1-ui.ts:547,555` 的英文 `Revision`。
- `index.ts:3675-3685,3838-3851`：每张镜头卡直接显示 `ID ${shotId.slice(-10)}` 和 `已编译 · ${fingerprint}` / `待重新编译 · ${fingerprint}`。

**建议**：主层只写用户结果，如“待校验”“保存位置”“会拆成 N 段”“沿用上一镜头”“历史版本”；SHA、目录树、multiple、稳定 ID、fingerprint 放入默认关闭的“技术详情 / 诊断信息”。

**验收测试**：主路径 DOM（不含关闭的 `details`）不得出现 `物化|multiple=32|Revision|fingerprint|ID [0-9a-f]{6,}`；镜头卡只显示“已编译 / 需重新编译”，技术值仍可在诊断层复制。

### P2-02 同一专业工作区有四套名称（已证实）

**精确证据**：侧栏 `index.html:30` 为“专业导播”，页面标题 `index.html:206` 为“H3 导播台”，项目状态 `index.ts:2375` 为“专业项目”，转换按钮 `index.html:156` 为“转为专业项目”。

**建议**：建立单一词表。推荐产品入口统一用“专业导播”，项目类型写“专业导播项目”，转换写“切换到专业导播”。若转换会改变数据结构，旁边补一句“快速创建内容仍保留”。

**验收测试**：对用户可见字符串做词表测试；除品牌性页面标题外，不得交替出现“专业项目 / 导播台 / 专业导播”表达同一概念。

### P2-03 删除与恢复词汇在“最近删除 / 回收站”之间跳变（已证实）

**精确证据**：素材工具栏 `#asset-trash-button`（`index.html:497`）写“最近删除”，素材空态 `#asset-trash-empty`（`index.html:609`）写“回收站中没有素材”，异常标题 `index.ts:2788` 又写“素材回收站未打开”；项目则统一使用“回收站”（`index.html:138,598-603`）。实体和场景使用“最近删除”（`index.html:268,288`）。

**建议**：整站选一个恢复隐喻。若采用“回收站”，危险动作直接写“移到回收站”，确认按钮同名，减少“删除”看似永久、正文才说明可恢复的反差。

**验收测试**：项目、素材、实体、场景的入口、确认标题、确认按钮、成功反馈、空态和错误状态使用同一词；所有恢复式删除都明确“文件不会被永久删除”。

### P2-04 顶部“本机服务正常”仍容易被理解为整套环境就绪（已证实）

**精确证据**：`#adapter-pill` tooltip（`index.html:20`）专门说明“不代表模型或 ComfyUI 已安装完成”，但可见标签在 `index.ts:5648-5655` 仍是绿色语义的“本机服务正常”。关键信息只藏在 hover title 中。

**建议**：改为“Relay 服务可用”或“安装 / 编译服务可用”；模型与 ComfyUI 的就绪状态继续由安装页呈现。不要用 title 承担必要区分。

**验收测试**：可见标签在无 tooltip 情况下也能表明范围；服务可用但安装未完成时，不出现“环境就绪 / 本机正常”等整体成功措辞。

### P2-05 关于页的两个 URL 不可操作，职责边界又重复过密（已证实）

**精确证据**：`index.html:568` 把 GitHub 与项目仓库渲染为普通 `<dd>`；`index.ts:5645-5646` 只赋 `textContent`，没有键盘可用的打开或复制动作。`index.html:574-581` 用五条长句再次陈述职责边界，而快速创建、导播 guard、导播正文、交接详情和导入页已重复类似边界（`index.html:183,209,247,468,544-550`）。

**建议**：URL 提供 allowlist 主进程打开动作或显式“复制地址”；不要把普通 `<dd>` 做成看似链接的文本。关于页保留最关键的一句“Relay 准备工作流，MiniMax H3 在 ComfyUI Run 后生成”，其余安全/法律细节放入可展开详情。各工作区只保留与当前动作直接相关的一句，不能删除必要的产品边界。

**验收测试**：两个地址可由键盘打开或复制，外部导航只能到固定 allowlist URL；页面首层职责边界不超过三条且仍明确“不会提交队列”“Run 后才生成”。

### P2-06 About / 导入页在宽屏下可能留出过多空白（推断，待像素证据）

**依据**：通用 `.page-container` 固定为 `min(980px, 100%)`（`styles.css:383-387`），而项目中心为 1160px、导播/素材为 1440px。规划中的 `.placeholder-page` 只有 `min-height: 230px`（`styles.css:448-455`）。在 1920×1080 窗口中，About 和只有一张占位卡的导入页会比相邻主页面窄很多，预计出现明显横向与下方空白。没有最新 Alpha32 桌面截图，因此不把该项标成已证实。

**建议**：先用像素证据决定，不要盲目拉伸正文。About 可使用独立的 1120–1160px 容器并保持内容卡最大阅读宽度；规划入口若继续保留，应把下一步/可用替代路径放入首屏，而不是单独占据空页面。

**验收测试**：在 1366×768 与 1920×1080、Windows 100% / 125% / 150% 缩放下捕获 About、导入、项目中心、快速创建、专业导播、素材库；人工确认首屏没有大面积无目的空白、关键动作不被推到折叠线下，并记录截图路径。该测试必须由持有 `COMFY-DESKTOP` 锁的任务执行。

## 已确认关闭或应保留的回归门

以下第一轮旧问题在冻结快照中已处理，不应在后续修改中回退：

- 快速创建与专业导播主动作均为精确字符串“编译并在 ComfyUI 中打开”（`index.html:156,207`）。
- 素材默认导入明确“复制到当前项目”，高级导入才引用外部文件（`index.html:481-488,638-641`）。
- `#asset-drop-zone` 不含 `tabindex`、`role=button` 或 click 模拟，真实动作由按钮承担（`index.html:485-488`）。
- 素材 SHA、存储方式和技术信息位于默认关闭的 `.asset-diagnostics`（`index.html:520`）。
- 素材详情抽屉进入时聚焦关闭按钮，Escape / 背景关闭、Tab 焦点圈闭并返回触发项（`index.html:509-511`；`index.ts:1274-1288,2201-2227`）。
- 原生 `window.confirm` 已由 `#action-confirm-dialog` 和 `confirmAction()` 取代；默认焦点为取消，Escape 取消并恢复焦点（`index.html:627-630`；`index.ts:628-664`）。
- 项目/素材删除确认已明确可恢复和不会永久删除文件（`index.ts:2740-2749,2771-2786`）；实体/场景也使用相同主题化确认（`director-p1-ui.ts:652-703`）。
- 顶部紧凑控件共享 32px token（`styles.css:46,225-286`）。

## 自动化证据

执行命令（只运行本地 Node 测试；未启动 ComfyUI 或 Electron）：

```powershell
cd apps/control-plane
node --test tests/alpha29-project-center-layout-contract.test.mjs tests/alpha30-ui-contract.test.mjs tests/alpha31-quick-plan-layout-contract.test.mjs tests/alpha32-update-check.test.mjs tests/alpha32-asset-backend.test.mjs tests/asset-library.test.mjs tests/renderer-component-policy.test.mjs tests/ux-shell-contract.test.mjs
```

结果：47 项，46 通过，0 失败，1 跳过；耗时约 0.56 秒。

- 通过的证据覆盖：项目中心真实路由、主编译动作、快速计划布局、默认复制素材、删除/恢复、真实缩略图、更新服务缓存、外部组件选择策略。
- `tests/ux-shell-contract.test.mjs` 已接受冻结后的真实 `#asset-binding-list`；本次选择性回归集为绿色。
- 跳过：公开 GitHub Release 网络探测；本审查没有访问外网。

## 覆盖矩阵

| 区域 | 结论 |
| --- | --- |
| 项目中心 | P1-04；主编译入口无关，项目删除恢复文案基本真实 |
| 快速创建 | P2-01、P2-02；主动作已与导播统一 |
| 专业导播 | P2-01、P2-02、P2-03；主题化确认已接入 |
| 项目素材库 / 详情抽屉 / 导入流 | P1-01、P1-06、P2-03；默认复制与高级引用分层清楚 |
| 导入占位页 | P1-05、P2-06；页面正文诚实，导航仍是假入口 |
| 安装与组件 | P1-03、P2-01；关键阶段仍然 fail closed |
| About / 更新 | P1-02、P2-05、P2-06 |
| 通用 dialogs / drawers | P1-01、P1-06、P2-03；原生 confirm 已移除 |

## 契约影响、风险与下一依赖

- **本报告的契约影响**：无。没有改 schema、API、IPC、CSS、renderer 或 lockfile。
- **修复的潜在契约影响**：P1-01 的“复制到项目”可直接复用现有 IPC，不需 schema 变更；若保留“替换记录”，则需要 SCHEMA / IPC 合约所有者决定并提供项目素材专用候选 token 与确认契约。P2-05 若选择打开外链，也需要主进程固定 allowlist 的受信 IPC；“复制地址”方案可避免新增导航契约。
- **残余风险**：本轮是冻结源码与测试证据审查，没有最新 Alpha32 像素截图；P2-06 仍是推断。素材 renderer 当前混用了旧 `AssetLibraryApi` 适配层与新 Project Asset IPC，除本报告列出的两个动作外仍需集成测试覆盖。
- **下一依赖**：
  1. Alpha32 renderer 所有者先处理 P1-01 至 P1-06。
  2. Contract Owner 决定“不同内容重新定位”是“导入为新素材”还是新增受信替换契约。
  3. 测试所有者为各 P1 添加上文交互测试；现有绿色测试只证明底层服务和静态入口，不覆盖 P1-01 的 renderer 适配反转、取消路径或 P1-02 的缓存呈现。
  4. 持有 `COMFY-DESKTOP` 锁的视觉验证任务捕获 1366/1920 与 100%/125%/150% DPI 矩阵，确认 P2-06 后再定最终宽度。
