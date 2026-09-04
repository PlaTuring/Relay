# Alpha32 第三轮 UX / 真实性冻结门

- 任务：`A32-UX-REVIEW-3`
- 冻结结论：**允许通过 Alpha32 UX / 交互真实性冻结门**。
- 严重度计数：**P0 = 0，P1 = 0，假成功 = 0，假按钮 = 0**。
- 已知非阻塞项：3 项 P2，均为术语、技术信息层级或地址操作性收尾，不改变真实执行结果。
- 范围确认：本轮只检查安装、检测、配置、项目素材、工作流编译、确定性编排与技术验证。MiniMax H3 仅在用户进入 ComfyUI 并亲自点击 Run 后生成视频与原生音频。
- 行为边界：未点击 Run，未调用 `/prompt`，未提交队列，未生成媒体，未启动或操作外部 ComfyUI / 模型。
- 修改边界：本报告是本任务唯一变更；未修改 renderer、preload、CSS、schema、API 或 lockfile。

## 审查基线与证据等级

本轮以当前 `src` 为准，不以较旧 `dist`、发布包或旧截图作为真实性证据。

| 文件 | SHA-256 |
| --- | --- |
| `apps/control-plane/src/renderer/index.ts` | `6E5728044DD0E1532C840A532FB3D30EEDBBBA8EE52BC95A21B543C21E2F98AB` |
| `apps/control-plane/src/preload/index.ts` | `DEF6B938DEB897BB4956877C45416450E4AAAE26EF99077E10BA33CB1EF37139` |
| `apps/control-plane/tests/alpha32-ui-convergence-contract.test.mjs` | `40A5E2C899C0C393C2940ECCA3F0AEBA13E56E248FD794E1AD571D01AB4B5336` |

- **已证实（proven）**：当前源码控制流或本地自动化可直接验证。
- **推断（inferred）**：需要持有 `COMFY-DESKTOP` 锁的像素或真实辅助技术会话确认。
- 本轮没有 `COMFY-DESKTOP` 锁，因此没有启动桌面应用；这不影响两个 P1 的控制流结论。

## 两项 P1 复核

### 原 P1-A：检查中/失败时必须保留缓存版本与上次状态 — 已关闭（proven）

**当前真实行为**：

- `apps/control-plane/src/renderer/index.ts:2794-2801` 的 `summarizeCachedUpdateCheck()` 会把缓存状态明确转换为用户可见文字：
  - `update_available` → `已知新版本 ${cache.latestVersion}`
  - `latest` → `当时已是最新版本`
  - `no_release` → `当时尚无公开 Release`
- `index.ts:2818-2824` 把上次成功时间和上述状态合并为 `上次成功检查：… · …`，没有只保留内部变量。
- `index.ts:2848-2855` 在 `checking`、`network`、`rate_limit`、`malformed` 路径继续显示 `cachedEvidence`；失败只补充“本次失败没有覆盖有效结果”。
- `index.ts:2859-2862` 同时保留缓存的可信发布页动作。
- `index.ts:2868-2875` 的 checking 状态仍使用 `checkedAt: null`，不会把点击时间伪造成成功检查时间。
- `index.ts:2876-2888` 的可预期异常只更新内联卡片，不打开重复 modal。
- `apps/control-plane/tests/alpha32-ui-convergence-contract.test.mjs:84-87` 已加入缓存版本摘要、空 `checkedAt` 和无重复 modal 的静态回归门；更新服务测试继续覆盖三类失败不覆盖持久缓存。

**结论**：缓存的版本/上次状态、成功时间和发布页动作在检查中及失败时均保持可见；没有伪造成功检查时间，没有重复 modal。原 P1 关闭。

### 原 P1-B：pending 超时不得无证据声称“工作流已写入” — 已关闭（proven）

**当前真实行为**：

- `apps/control-plane/src/preload/index.ts:100-113` 仍严格区分 `pending`、`succeeded` 和 `failed`；只有 `succeeded` 返回成功结果。
- `preload/index.ts:114-117` 的超时文本现在是：

  > 交接完成状态在三分钟内未返回，Relay 无法确认本次工作流是否已写入或打开；没有提交运行任务。请重试，并以 ComfyUI 当前标签或工作流目录中的实际文件为准。

- 该文本明确状态未知，没有声称“已写入 / 已保存 / 已打开 / 已完成”，并再次声明没有提交运行任务。
- `apps/control-plane/src/main/ipc-registry.ts:796-809` 仍只在服务 Promise fulfilled 后登记 `succeeded`，所以成功文案的证据边界没有被放宽。
- `apps/control-plane/tests/alpha32-ui-convergence-contract.test.mjs:94-95` 要求“无法确认本次工作流是否已写入或打开”，并禁止旧字符串“工作流已写入，但交接完成状态…”。

**结论**：pending 超时现在保持未知状态，不再是假成功。原 P1 关闭。

**非阻塞措辞建议**：当前“请重试”可能发生在原操作仍于主进程 pending 的情况下。后续可改为“先核对实际文件；确认没有结果后再重试”，以减少重复操作，但现有文本已经真实披露不确定性，不构成 P1 或假成功。

## P0 / P1 / 假成功 / 假按钮冻结矩阵

| 门项 | 数量 | 结论 |
| --- | ---: | --- |
| P0 | 0 | 未发现删除用户外部文件、越权生成、队列提交、自动 Run 或隐蔽上传入口 |
| P1 | 0 | 第二轮两项 P1 均已真实关闭；第一轮其余 P1 回归门保持绿色 |
| 假成功 | 0 | pending 文案明确“无法确认”；成功写入/打开仍只来自窄终态结果 |
| 假按钮 | 0 | 规划入口明确标注“规划中”且页面无操作控件；其他可见动作均有真实路由或明确失败路径 |

## 剩余 P2：精确字符串与最小修复建议

### P2-01 “专业导播 / 导播台”用户词汇仍混用（proven）

产品主名称已经是“专业导播”，但以下用户可见文字仍使用“导播台”：

- `apps/control-plane/src/renderer/index.html:209`
  - `导播台尚未解锁`
  - `请先完成本机环境配置；导播台只编译和交接工作流，不会提交队列或自动生成视频。`
- `apps/control-plane/src/renderer/index.ts:4297`：`导播台草稿已保存`
- `apps/control-plane/src/renderer/index.ts:4669`：`导播台还有未完成项目`
- `apps/control-plane/src/renderer/director-console.ts:285`：`${label}不能包含 [Shot N] 或 [镜头 N] 标记；镜头编号由导播台生成。`
- `apps/control-plane/src/renderer/director-p1-controller.ts:455,457,462,483,497,504,518,520`：用户可能看到的恢复/迁移文字仍包括：
  - `导播台草稿不是对象。`
  - `导播台草稿缺少有效的镜头数据。`
  - `导播台 v7 制作数据无效。`
  - `导播台 v6 制作数据无效。`
  - `已将导播台 v6 制作数据确定性迁移为 v7；原始草稿未被自动覆盖。`
  - `导播台 v5 草稿迁移失败。`
  - `仅支持导播台 v5、v6 或 v7 草稿。`
  - `导播台草稿恢复失败，原始数据未被改写。`
- `apps/control-plane/src/renderer/director-production.ts:1469,1477`：
  - `未识别为导播台 v5 草稿，已建立空白制作数据。`
  - `导播台 v5 草稿缺少 draft，已建立空白制作数据。`

**最小修复**：只替换用户可见字符串中的“导播台”为“专业导播”；不重命名 TypeScript 类型、序列化字段、schema 或历史版本号。

### P2-02 主层仍暴露工程标识和英文 Revision（proven）

精确用户可见文字：

- `apps/control-plane/src/renderer/index.html:180`：默认摘要 `9:16 · 0.4 MP · 约 480 × 864 · multiple=32`
- `apps/control-plane/src/renderer/index.ts:3509`：运行时摘要 `${aspectRatio} · ${megapixelLabel} · 约 ${width} × ${height} · multiple=32`
- `index.ts:3698`：`已编译 · ${fingerprint}` / `待重新编译 · ${fingerprint}`
- `index.ts:3854`：`ID ${shotId.slice(-10)}`
- `apps/control-plane/src/renderer/index.html:340`：辅助技术名称 `不可变 Revision 历史`
- `apps/control-plane/src/renderer/director-p1-ui.ts:547`：`Revision ${state.revisions.length - index}`
- `director-p1-ui.ts:555`：`${revisions.length} 个不可变 Revision · 可恢复为新草稿`
- `apps/control-plane/src/renderer/director-p1-controller.ts:604`：`Revision 无法恢复，当前工作副本保持不变。`
- `apps/control-plane/src/renderer/index.ts:4526`：`历史 Revision 已恢复到编辑区；原历史记录仍保留，后续成功编译会建立新 Revision。`

**最小修复**：

1. 从普通画布摘要移除 `multiple=32`，只显示比例、百万像素和预计尺寸；对齐倍数留在默认关闭的诊断详情。
2. 镜头卡只显示“已编译 / 需重新编译”，把 fingerprint 和稳定 ID 移入诊断详情或复制诊断信息。
3. 所有用户可见 `Revision` 改为“历史版本”，不改内部 revision 标识、算法或字段名。

### P2-03 About 的 GitHub 地址仍是不可操作纯文本（proven）

- `apps/control-plane/src/renderer/index.html:568` 显示：
  - `GitHub` → `https://github.com/PlaTuring`
  - `项目仓库` → `https://github.com/PlaTuring/Relay`
- `apps/control-plane/src/renderer/index.ts:5660-5661` 仅把 runtime 值赋给两个 `<dd>.textContent`，没有打开或复制动作。

**最小修复**：为两个固定地址各增加一个键盘可访问的“打开”或“复制地址”按钮。外部打开必须走主进程固定 allowlist；不要接受 renderer 传入的任意 URL。若本轮不增加 IPC，则至少明确标注“地址（可选中复制）”，但真实按钮仍是最终目标。

## 定向自动化证据

执行命令（仅本地类型检查与 Node 测试；未启动正式 ComfyUI）：

```powershell
cd apps/control-plane
node scripts/typecheck.mjs
node --test tests/alpha32-ui-convergence-contract.test.mjs tests/alpha32-update-check.test.mjs tests/product-contract.test.mjs tests/ux-shell-contract.test.mjs
```

结果：

- TypeScript：3 个工程通过，0 失败。
- 定向测试：30 项，29 通过，0 失败，1 跳过；耗时约 0.34 秒。
- 跳过项为显式 opt-in 的公开 GitHub Release 网络探测；不影响本地状态逻辑结论。
- 覆盖：缓存成功证据、失败不覆盖缓存、pending 超时诚实措辞、产品边界、无队列路由、规划入口、普通成功非阻塞和项目路由。

## 契约影响、风险与冻结许可

- **本报告契约影响**：无。没有修改 schema、API、IPC、CSS、renderer、preload 或 lockfile。
- **P2 最小修复影响**：P2-01 与 P2-02 仅需用户可见字符串/信息层级调整；P2-03 若采用外部打开，需要固定 allowlist 的窄 IPC，采用复制动作也应保持固定地址而非任意 URL。
- **视觉限制**：没有 `COMFY-DESKTOP` 锁，未做 DPI/像素矩阵；该独立视觉验证仍可作为后续证据，但不是本轮两项真实性 P1 的阻塞条件。
- **最终许可**：**允许冻结 Alpha32 UX / 交互真实性基线**。3 项 P2 应登记为非阻塞收尾，后续修改不得回退本报告已经确认的 0 P0、0 P1、0 假成功和 0 假按钮状态。
