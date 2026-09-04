# Alpha32 UX / 文案 / 交互真实性复核（第二轮）

- 任务：`A32-UX-REVIEW-2`
- 结论：**未达到“0 个 P0/P1、0 假成功”的冻结门槛**。本轮未发现 P0；确认 2 项 P1（第一轮更新项只部分关闭 1 项、新发现无证据成功断言 1 项）以及 3 项仍待收尾的 P2。
- 范围确认：本审查只涉及安装、检测、配置、项目素材、工作流编译、确定性编排和技术验证。MiniMax H3 仅在用户进入 ComfyUI 并亲自点击 Run 后生成视频与原生音频。
- 行为边界：未点击 Run，未调用 `/prompt`，未提交队列，未生成媒体，未启动或操作外部 ComfyUI / 模型。
- 修改边界：本文件是唯一变更；未修改 renderer、CSS、schema、API、lockfile 或用户文件。

## 证据等级与审查基线

- **已证实（proven）**：可由当前源码控制流、静态选择器或本地自动化测试直接复现。
- **推断（inferred）**：需要最新桌面像素或真实辅助技术会话才能最终确认。
- 本轮没有 `COMFY-DESKTOP` 资源锁，因此没有启动桌面应用；不把旧截图当作 Alpha32 当前像素证据。
- 复核期间共享工作区发生过并行更新；本文所有行号与结论均以报告落笔前再次读取的 `src` 为准，而不是较旧 `dist` 或发布包。

## 发布门结论

| 等级 | 数量 | 结论 |
| --- | ---: | --- |
| P0 | 0 | 未发现删除用户文件、越权队列提交、媒体生成或隐蔽上传入口 |
| P1 | 2 | 更新缓存呈现仍不完整；交接轮询超时存在无证据“已写入”断言 |
| P2 | 3 | 专业工作区术语、主层工程术语、About 地址操作性仍未完全收敛 |
| 假按钮 | 0 | 当前可见操作均有真实路由、表单提交或明确的委托事件；规划页没有操作控件 |
| 假成功 | 1 | `src/preload/index.ts:115` 在操作仍可能只是 pending 时声称“工作流已写入” |

## P1

### P1-01 GitHub 检查中/失败时仍隐藏上次成功发现的版本号（第一轮 P1-02 只部分关闭，已证实）

**影响**：此前成功结果为 `update_available` 时，用户能看到“发现新版本 0.x.y”；一旦再次检查或遇到网络、限流、格式失败，这个版本号从卡片消失。旧成功时间和发布页按钮仍在，但用户无法在同一视野判断保留的发布页属于哪个版本。这个行为仍未满足第一轮验收条件“旧版本、旧成功时间与发布页动作始终保留”。

**精确证据**：

- `apps/control-plane/src/renderer/index.ts:2792-2802`：`lastSuccessfulUpdateCheck` 会保存成功缓存，失败结果携带的 `cached` 也会写回该变量。
- `apps/control-plane/src/renderer/index.ts:2808-2810,2834-2841`：检查中与失败会继续展示缓存的成功时间，且明确本次失败没有覆盖有效结果。
- `apps/control-plane/src/renderer/index.ts:2845-2848`：缓存状态为 `update_available` 时，发布页按钮和旧 `releaseUrl` 会保留。
- `apps/control-plane/src/renderer/index.ts:2817-2832`：主状态只按本次 `presentation.status` 渲染；`checking` 和三个失败状态都会替换“发现新版本 …”。
- `apps/control-plane/src/renderer/index.ts:2822-2823`：版本号只读取 `presentation.latestVersion`；整个缓存回退分支没有读取 `lastSuccessfulUpdateCheck.latestVersion`。
- `apps/control-plane/src/renderer/index.ts:2854-2861`：pending 状态使用 `checkedAt: null`，没有伪造“上次成功检查”时间。
- `apps/control-plane/src/renderer/index.ts:2862-2874`：预期失败只更新卡片，不再打开重复反馈 modal。这两部分已关闭。
- `apps/control-plane/tests/alpha32-ui-convergence-contract.test.mjs:70-91`：现有测试只匹配缓存变量、空 `checkedAt` 和无重复 modal，没有断言缓存版本号在 checking/failure DOM 中仍可见，因此绿色测试没有覆盖此缺口。

**建议**：把“上次成功结果”和“本次尝试状态”拆成两个可见区域。只要缓存存在，就持续显示其状态与版本，例如“上次成功：发现 0.1.0-alpha.32”；检查中或失败作为第二行补充。成功结果到达后再替换缓存卡片。

**验收测试**：

1. 预置 `cached.status=update_available` 且 `latestVersion=0.1.0-alpha.32`，依次渲染 `checking/network/rate_limit/malformed`；每个状态都断言版本号、缓存时间与 `#about-open-release` 可见，同时显示本次尝试状态。
2. pending 时缓存时间不变；新成功到达后才更新。
3. 无缓存时显示“尚无成功检查记录”，不得伪造版本或成功时间。
4. 预期失败不打开 `#feedback-dialog`。

### P1-02 交接轮询超时在没有完成证据时断言“工作流已写入”（新发现，已证实）

**影响**：三分钟轮询到期只证明 renderer 尚未收到终态；操作可能还在编译、可能尚未写文件，也可能随后失败。当前错误却告诉用户“工作流已写入”，并让用户去 ComfyUI 查找标签。这会造成假成功、无效查找以及不确定的重复重试。

**精确证据**：

- `apps/control-plane/src/preload/index.ts:96-105`：preload 首先只拿到 `operationId`，之后查询状态。
- `apps/control-plane/src/preload/index.ts:107-113`：只有 `succeeded` 返回结果，`failed` 抛出真实错误。
- `apps/control-plane/src/preload/index.ts:114-115`：循环仅因本地 deadline 到期退出，却无条件声称“工作流已写入”。
- `apps/control-plane/src/main/ipc-registry.ts:796-799`：操作创建后先登记为 `pending`，实际编译/写入在 `setImmediate` 中才开始。
- `apps/control-plane/src/main/ipc-registry.ts:800-810`：只有服务 Promise fulfilled 后才登记 `succeeded`；reject 则登记 `failed`。因此 pending 不含任何已写入证明。
- `apps/control-plane/src/renderer/index.ts:5615-5617`：preload 抛出的文字最终会进入“工作流未完成”错误反馈；标题虽是失败，正文仍包含错误的成功断言。

**建议**：超时文本应保持未知状态，例如“交接状态长时间未返回，Relay 无法确认工作流是否已写入或打开；未提交运行任务。”只有查询得到 `succeeded` 的窄结果后，才允许出现“已写入 / 已保存 / 已打开”。如要支持之后核对，应保留不透明 operation ID 并提供真实的继续查询入口，不能靠文件成功猜测。

**验收测试**：

1. 让 handoff 永久保持 `pending` 直至 preload deadline；错误文本不得包含“已写入、已保存、已打开、已完成”，renderer 必须呈现失败/未知状态。
2. 让操作在 deadline 前返回 `failed`，必须呈现主进程错误且不暗示有文件。
3. 只有 `succeeded` 且结果明确为 `stored_for_visible_selection`、`visible_existing_graph_preserved` 或 `loaded_visible_comfyui` 时，才分别显示对应的已保存/已打开状态。

## 第一轮六项 P1 关闭矩阵

| 第一轮项 | 第二轮状态 | 已证实证据 |
| --- | --- | --- |
| P1-01 外部引用“复制到项目”与假替换弹窗 | **已关闭** | `index.ts:993-1005` 真实调用 `copyProjectAssetIntoProject({projectId, assetId})` 并返回项目相对路径；`index.ts:2125-2137` 点击后刷新目录并仅在成功后反馈；`index.ts:1322-1324` 完成后按钮隐藏。不同 SHA 在 `index.ts:985-986,2121-2122` 明确拒绝并引导作为新素材导入。`index.html` 已无 `asset-replacement-dialog`；`alpha32-ui-convergence-contract.test.mjs:40-43` 建立回归门。 |
| P1-02 更新缓存、时间和重复 modal | **部分关闭，仍为 P1** | 缓存时间、发布页动作、pending 的空 `checkedAt` 与无重复 modal 已修复；缓存版本号在 checking/failure 主状态中仍消失，见本报告 P1-01。 |
| P1-03 未验证组件称“可复用” | **已关闭** | `component-policy.ts:23-30,34-50,65-74` 把 `found_unverified` 统一为“已找到，待校验 / 等待安装前校验 / 待校验”，只有 verified 才称复用；`renderer-component-policy.test.mjs:50-99` 精确覆盖所有未验证组件并禁止“可复用”。 |
| P1-04 项目行只选择、不进入编辑器 | **已关闭** | `index.ts:2323-2330` 按项目 `editorMode` 选择 quick/professional 目标，并由一次点击直接 `activateRelayProject(..., projectTarget)`；可访问名称也声明实际目的地。 |
| P1-05 规划入口像已实现功能 | **已关闭** | `index.html:32` 导航可见名称和 aria-label 均含“规划中”；`index.html:542-550` 明确当前不读取、解析、安装、修复或提交，且页面无按钮/表单/输入；`alpha32-ui-convergence-contract.test.mjs:109-119` 防止假入口回归。 |
| P1-06 普通成功统一阻塞 modal | **已关闭** | `index.html:589-592` 提供 `role=status` 的非模态 Toast；`index.ts:619-629` 普通 success 默认走 Toast。素材导入/保存、项目建立/复制/恢复等均未传 `modal:true`。正式工作流交接成功可在 `index.ts:5597-5604` 显式选择 modal；它不是普通批量操作，且只在收到终态结果后出现。 |

## P2 — 文案与信息架构收尾

### P2-01 “专业导播 / 导播台”仍混用（已证实）

- `apps/control-plane/src/renderer/index.html:30,156,206` 与 `index.ts:2322-2325,2347` 已统一主入口、转换和项目类型为“专业导播”。
- 但 `index.html:209` 仍两次写“导播台”，`index.ts:4297` 的保存成功、`index.ts:4669` 的校验警告以及 `director-console.ts:285` 的输入错误仍使用“导播台”。
- 建议用户可见名称全部采用“专业导播”；“导播台”若保留，只作为内部模块名，不出现在反馈和错误中。

### P2-02 主层仍暴露 `multiple=32`、稳定 ID、fingerprint 和英文 Revision（已证实）

- `apps/control-plane/src/renderer/index.html:180` 与 `index.ts:3509` 在普通画布摘要直接显示 `multiple=32`。
- `index.ts:3698,3854` 在每张镜头卡显示 fingerprint 与截断 ID。
- `index.html:340-343`、`director-p1-ui.ts:547,555` 在普通历史 UI 使用英文 `Revision`。
- 建议主层改为“尺寸已对齐 / 已编译 / 需重新编译 / 历史版本”；技术值放到默认关闭的诊断详情。

### P2-03 About 的两个地址仍不可操作（已证实）

- `apps/control-plane/src/renderer/index.html:568` 把 GitHub 与项目仓库放在普通 `<dd>`。
- `apps/control-plane/src/renderer/index.ts:5660-5661` 只写 `textContent`，没有打开或复制动作。
- 这不是假按钮，但宽泛地址样式容易被当作可操作信息。建议使用固定 allowlist 外链动作，或提供真实的“复制地址”。

## 假按钮、假成功与边界复核

- **假按钮**：未发现。素材复制、重新定位、显示目录、删除、项目 CRUD、数据目录、编译交接、更新检查均有真实异步调用；动态专业导播控件由 `data-director-p1-action` / drawer tab 委托处理；导入规划页没有任何按钮、表单或输入。
- **普通成功**：素材、项目和资料类成功默认走 5.2 秒非模态 Toast，不抢焦点。正式交接结果的显式 modal 属于关键终态，不扩大为普通成功默认值。
- **假成功**：除本报告 P1-02 的 pending 超时断言外，抽查到的成功文案均位于 awaited 主进程/服务结果之后；底层素材和项目测试也覆盖失败不报告成功。
- **产品边界**：源码与测试未发现 renderer 或 preload 调用 `/prompt`、提交 ComfyUI 队列、自动点击 Run、生成视频/音频、创作镜头或扩写用户提示词。主编译动作仍是“编译并在 ComfyUI 中打开”。

## 自动化证据

执行命令（只使用本地 TypeScript/Node 测试；未运行正式 ComfyUI、未生成媒体）：

```powershell
cd apps/control-plane
node scripts/typecheck.mjs
node scripts/test.mjs
```

结果：

- TypeScript：3 个工程通过，0 失败。
- 完整 control-plane 测试：316 项，315 通过，0 失败，1 跳过；耗时约 22.5 秒。
- 唯一跳过项：公开 GitHub Release 的真实网络探测；本轮不需要外网证据。
- 绿色测试证明底层复制、哈希重新定位、项目路由、组件阶段、非模态普通成功、规划入口与更新缓存服务的主体行为；它不推翻本报告两个由当前控制流直接证明的 P1，尤其未覆盖缓存版本持续可见和 pending 超时措辞。

## 视觉证据限制

第一轮的宽屏空白/DPI 项仍是 **inferred**。没有 `COMFY-DESKTOP` 锁，本轮未捕获 1366×768、1920×1080 或 100%/125%/150% 缩放截图。此限制不影响两个 P1 的源码结论，但像素与焦点细节仍需持锁任务验证。

## 契约影响、风险与下一依赖

- **本报告变更影响**：无 schema、API、IPC、CSS、renderer 或 lockfile 影响。
- **P1-01 修复影响**：只需 renderer 展示状态调整和 DOM 行为测试，不需要 schema 变更；现有 `UpdateCheckCacheContract` 已包含 `latestVersion`、`releaseUrl` 与 `checkedAt`。
- **P1-02 修复影响**：仅修正文案不需要契约变更；若要在 UI timeout 后继续查询，则需要 handoff 状态/生命周期所有者设计明确且有界的恢复交互。
- **开放风险**：共享工作区有并行修改，集成前应以合并后的最终源码重新运行两个新增验收场景；现有静态字符串测试容易在行为未完整实现时仍通过。
- **下一依赖**：
  1. renderer 所有者让缓存版本在 checking/failure 期间持续可见，并补真实状态渲染测试。
  2. preload/handoff 所有者移除 pending 超时的“已写入”断言，并补 pending/failed/succeeded 三分支测试。
  3. UX 文案所有者统一“专业导播”词表，把 ID、fingerprint、Revision、`multiple=32` 下沉到诊断层。
  4. 上述两项 P1 合入后重新执行 Alpha32 第三轮只读真实性门；通过后才可声称“0 P0/P1、0 假成功”。
