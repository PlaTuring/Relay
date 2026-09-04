# Relay 1.0.1 镜头状态热修复与重新发布报告

日期：2026-09-04

## 原始故障

旧项目的 `RelayProjectDocument.shots[].shotId` 与嵌入的 v5/v6/v7 专业导播草稿、生产状态中的镜头 ID 可能不一致。严格一致性保护因此拒绝载入并显示“专业导播镜头与连续性状态不同步”。该异常又沿环境刷新路径上冒，导致顶部被错误标记为“初始化失败”。

## 修复后的行为

- 项目文档中的镜头列表继续作为唯一权威数据源。
- 载入旧草稿时先按精确 ID 匹配；无法精确匹配时，仅允许按镜头顺序与时间区间进行确定性的一对一映射。
- 同一次项目 CAS 保存中同步草稿、生产镜头、Binding、Take、当前镜头和所属场景。
- 只读 Revision、项目历史、历史工作流与旧交接记录保持不变；当前编译指纹在身份变化时保守失效。
- 镜头数量、时间或旧 ID 存在歧义时拒绝迁移，不把旧内容附到错误镜头。
- 历史恢复复用同一对账流程；第二次启动不重复改写。
- 项目草稿恢复失败只在项目功能内准确报告，不再污染本机环境扫描或全局初始化状态。

## 主要修改文件

- `apps/control-plane/src/renderer/professional-director-reconciliation.ts`
- `apps/control-plane/src/renderer/index.ts`
- `apps/control-plane/tests/relay101-director-shot-id-hotfix.test.mjs`
- `apps/control-plane/tests/director-p1-workspace-integration.test.mjs`
- `README.md`
- `docs/releases/relay-1.0.1-release-notes.md`

## 验证结果

- 镜头 ID 热修专项：12/12 通过。
- 专业导播组合专项：28/28 通过。
- 独立最终复核：P0=0，P1=0；重点组合 21/21 通过。
- Control Plane 全量：478 项，477 通过，1 项按设计跳过，0 失败。
- H3 编译器：78/78 通过。
- TypeScript：3/3 通过。
- 产品冒烟：通过；`media_generated=0`、`prompt_submitted=0`。
- 离线源与打包资源验证：通过；打包运行资源 131 个文件通过长度与 SHA-256 校验。
- 打包后的原生组件隐藏隔离探针：通过。
- 真实本地 v5/v6/v7 数据只读审计：8/8 可安全处理，6 个需要确定性对账，0 个失败。

未对用户当前正在运行的 Relay、ComfyUI 或 H3 任务进行窗口操作；未点击 Run，未调用 `/prompt`，未提交队列，未生成媒体。

## 发布结果

- Release：`https://github.com/PlaTuring/Relay/releases/tag/v1.0.1`
- 资产：仅 `Relay-1.0.1-x64-Setup.exe`
- 长度：`100928869` 字节
- SHA-256：`0b7d39cfb7edec8804e6cca25c712500748a0654a8b33458e9480a15af09db30`
- GitHub 状态：`draft=false`、`prerelease=false`、`Latest`、资产状态 `uploaded`。
- 匿名重新下载后的长度与 SHA-256 与本地冻结文件完全一致。
- 旧安装包已保存在 `artifacts/archive/relay-1.0.1-pre-shot-id-hotfix/`。

因为热修保持 `1.0.1` 版本号不变，已安装旧构建的用户不能只靠 SemVer 检测到替换，需要从同一 Release 重新下载。

## 安装验证边界

本轮未在当前宿主机执行可见安装/卸载：宿主机存在正在使用的 Relay/ComfyUI 与现有快捷方式，且用户明确要求不要操作当前程序。构建过程已完成隔离的打包后启动探针，但全新 Windows 主机上的交互式安装/卸载仍应在不会影响现有工作的独立环境中执行。

安装包当前未使用 Authenticode 证书签名；SHA-256 只证明下载文件与发布文件一致。
