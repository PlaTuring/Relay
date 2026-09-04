# Relay 深度完成与开源整理审计 — 2026-09-04

## 结论

本轮要求范围内的产品缺陷、可靠性优化和开源整理已经闭环。既有
`1.0.1` 多套发布物身份问题仍按要求不做清理或合并。随后根据用户明确
索要最新版安装包的请求，使用当前源码生成并冻结了一份新的本地未签名
Setup；没有上传或公开，也没有修改 GitHub Release、tag 或远端仓库。

全程未操作正在运行的 ComfyUI，未点击 Run，未调用 `/prompt`，未提交
ComfyUI 队列，也未生成视频或音频。

## 已完成的产品与可靠性工作

1. 所有跨 `await` 的项目操作均携带不可变项目 ID 和激活代次；项目切换
   会使旧列表、预览、素材、回收站、帧选择和编译结果失效，避免旧项目
   数据写回新项目。
2. 快速创建与专业导播保留独立提示词和独立帧选择权威；删除旧项目后
   新建项目不会恢复旧提示词，专业导播编译不会回写快速创建字段。
3. T2V 的图片关系明确为项目资料，不伪造 `LoadImage`；FL2VA 的首/尾帧
   与 Ref2VA 的一至两张参考图通过受限 ID、校验后的本地副本和真实连线
   进入认证工作流。
4. ComfyUI 工作流显式显示真实分辨率、20 步标准、25 步高质量、8 步
   Turbo、基础种子与每镜实际种子；Turbo 开关、LoRA、强度和步数均按
   认证模板生效，不以纯标题冒充参数节点。
5. ComfyUI 可见交接取消固定六秒等待，使用窗口就绪、能力检查、节点
   刷新和图加载确认；相同媒体工作流可复用已验证的节点定义刷新。
6. 新增完整编译到可见交接耗时证据，覆盖请求校验、输入准备、工作流
   编译、能力预检、工作流持久化和可见交接六个互斥阶段。成功与失败均
   记录，失败只保存稳定错误码和失败阶段。
7. 耗时历史仅保留最近 20 条，串行写入；文件位于受验证 `dataRoot/logs`
   的直接子目录。写入前后验证真实路径、非重解析点、目录身份与包含
   关系，使用同目录独占临时文件、同步和原子改名。日志不含项目名、
   工作流名、提示词或绝对路径，诊断失败也不会改变原始操作结果。
8. 已生成视频扫描采用当前项目有界目录、稳定文件双检、增量索引、有限
   并发和退避；拒绝越界、重解析点、未知前缀和不稳定文件。
9. About 与更新页显示精确补丁版本；启动 helper 的准备和自检按不可变
   产物身份复用；重试会刷新磁盘诊断；安装器启动失败保留已验证下载并
   提供真实恢复入口。
10. Renderer 的大型主文件已拆分为有职责边界的控制器；侧栏“视频成品”
    的样式契约不再被通用单行规则冲突覆盖。

## 安装包运行时清理

- 生产 `h3-compiler` 不再从 `static-graph-lint/test` 导入夹具；认证文档
  构造器迁入生产 `src`，测试只复用该权威实现。
- Electron Builder 不再复制完整 `packages` 和 `schemas` 树，而是只复制
  local-runtime、h3-compiler 与 static-graph-lint 所需的六个 `bin/src/
  templates` 目录，以及两个固定 UtilityProcess 包装器和三份法律文件。
- 发布资源校验新增运行时卫生门禁，拒绝 test/fixture/example 目录、通用
  Windows 用户绝对路径和 secret/token 路径样例。
- 新构建的解包应用通过 15 个映射、75 个资源文件的严格证明；禁用目录和
  私有路径标记均为 0。
- `resources/licenses/Relay/` 中存在 `LICENSE`、`NOTICE` 和
  `THIRD_PARTY_NOTICES.md`；应用根同时存在 Electron 与 Chromium 许可文件。
- 发布所有者提供的精确头像已按 SHA-256 固定、在第三方声明中单独说明，
  并经 Renderer 资产白名单进入 About 与安装包；它不属于 Apache-2.0。
- package、`app.asar` 和 Relay.exe 的作者/公司元数据统一为中性的
  `Relay contributors`；公开文案只介绍软件功能，不声称个人制作身份。

## 开源状态

Relay 自有源代码采用 Apache-2.0。12 个受检清单、399 个锁定依赖、13 种
许可证表达式、源许可证台账和 CycloneDX 1.6 SBOM 均通过验证。三个来自
锁定 Comfy-Org 修订的 H3 JSON 模板保留其 MIT 来源和完整通知。

这不等于为第三方模型、运行时或编解码器重新授权。ComfyUI、ComfyUI
Desktop、FFmpeg/FFprobe、MiniMax H3、Qwen、量化/重打包权重、Turbo
LoRA、Ref2VA 与可选 Embedding 的精确分发许可仍由 `docs/EXTERNAL_GATES.md`
管理；代码签名也仍是独立外部条件。

## 最终验证证据

- Control-plane：521 个测试，520 通过，0 失败；1 个匿名联网探针按设计
  跳过。
- H3 compiler：83 通过，0 失败。
- Static graph lint：56 通过，0 失败。
- TypeScript：main、preload、renderer 共 3 个项目全部通过。
- Root fast lane：5 通过，0 失败。
- Product smoke：local runtime 47 通过，compiler 12 通过，完整
  control-plane 通过，UI readiness 通过；`media_generated=0`，
  `prompt_submitted=0`。
- Open-source hygiene：12 个清单、399 个依赖、13 种许可证表达式、3 份
  Relay 打包通知、隐私和发布白名单全部通过。
- Source-only offline verification、public-evidence lint、产品构建、解包构建、
  native helper/profile 探针和 packaged adapter 探针全部通过。
- 当前源码 Setup：`Relay-1.0.1-x64-Setup.exe`，100,810,435 字节，
  SHA-256 `85bb3de9eba0cb05f61188ae9363aadb55f1f145fd254134d466a917fbffaab2`。
  根目录与冻结目录字节一致，冻结目录仅含 Setup 与 `SHA256SUMS.txt`。

## 未声明完成的事项

- 没有处理或掩盖既有 `1.0.1` 多套发布物身份。
- 已按后续请求生成一个未签名 Setup 与 SHA256SUMS；没有生成 Portable、
  签名成品或 GitHub Release，也没有删除或调和历史 1.0.1 身份。
- 没有声称 Authenticode、第三方模型/运行时分发权或正式公开二进制发布
  已获批准。
- Setup 已唯一冻结并通过静态成品校验，但遵守“不操作电脑、用户自行核查”
  的要求，没有执行安装器。完整门禁因此仍准确停止于
  `RELEASE_GATE.INSTALLER_EVIDENCE_REQUIRED`；不得将其描述为安装验证通过。
