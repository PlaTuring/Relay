# Relay 1.0.1 编译 IPC 衔接字段热修复报告

日期：2026-09-04

## 原始故障

专业导播的编译请求合法携带 `segmentTransitions`，单镜头请求也会携带空数组。共享 `ProjectSpec` 合同、主服务验证器和编译适配器均已支持该字段，但 Electron 主进程 IPC 注册层维护的第二份严格字段白名单遗漏了它，导致请求在进入编译服务前被拒绝，并显示 `INVALID_REQUEST: project has unexpected fields`。

该错误中的 `project` 是一次临时编译请求，不是 `project.relay.json`。只读审计的 10 个本机项目全部可解析、全部为 schema v1，顶层字段无缺失或多余，因此不需要迁移或改写项目。

## 修复后的行为

- IPC 层接受共享合同已定义的可选 `segmentTransitions`。
- 衔接数量必须严格等于相邻镜头数量，值只允许 `hard_cut` 或 `tail_frame_continuation`。
- 合法数组被冻结并原样传给编译服务；Quick 请求仍可省略该字段。
- 未知字段、未知衔接值和长度漂移继续在进入服务前 fail-closed。
- 项目 schema 保持 v1，现有项目数据不改写。

## 修改与回归

- `apps/control-plane/src/main/ipc-registry.ts`
- `apps/control-plane/tests/relay101-compile-ipc-segment-transitions.test.mjs`
- `apps/control-plane/tests/relay101-installer-finish-launch-option.test.mjs`
- `apps/control-plane/build/input-inventory.json`
- `README.md`
- `docs/releases/relay-1.0.1-release-notes.md`

验证结果：

- 真实 IPC 与关联专项：30/30 通过。
- Control Plane 全量：479 项，478 通过，1 项按设计跳过，0 失败。
- H3 编译器：78/78 通过。
- TypeScript：3/3 通过。
- 产品冒烟：通过；`media_generated=0`、`prompt_submitted=0`。
- 离线源与打包资源验证：通过；131 个打包运行资源通过长度与 SHA-256 校验。
- 打包后 `app.asar` 已确认包含 `segmentTransitions`、`hard_cut` 与 `tail_frame_continuation` 闭集。
- 打包后的原生组件隐藏隔离探针：通过。
- Assisted Setup 完成页保留用户可取消的 Relay 启动选项；构建和静默路径不无条件启动应用。

未操作用户当前运行的 Relay、ComfyUI 或 H3；未点击 Run，未调用 `/prompt`，未提交队列，未生成媒体。

## 成品

- 安装包：`Relay-1.0.1-x64-Setup.exe`
- 长度：`100929265` 字节
- SHA-256：`79d0dbf954aa0e8150a08b8525032231747e356b8569732370fe50a5349706e3`
- 签名状态：未使用 Authenticode；SHA-256 只用于完整性验证。
- 上一个同版本安装包已备份到 `artifacts/archive/relay-1.0.1-pre-ipc-transition-hotfix/`。

因为热修保持 `1.0.1` 版本号不变，旧 1.0.1 不会通过版本比较发现这次替换，需要从同一 Release 重新下载。
