# Relay 1.0.2 发布核验报告

日期：2026-09-04  
发布目标：`https://github.com/PlaTuring/Relay` / `v1.0.2`

## 结果

Relay 1.0.2 已完成源码、安装包和产品边界的本地发布门禁。正式 GitHub
Release 只允许上传一个资产：`Relay-1.0.2-x64-Setup.exe`；本地
`SHA256SUMS.txt` 用于独立复核，不作为 Release 资产上传。

## 本轮修复

- 安装包补齐本地运行时映射，消除安装版检测阶段的
  `ERR_MODULE_NOT_FOUND`。
- ComfyUI 固定回环会话先探测、短暂重试，再决定是否尝试受管启动；错误区分
  不可达、超时和协议无效，且不会提交队列。
- 未配置 FFmpeg 时使用 Windows 本机只读封面回退；无法读取真实帧时明确显示
  不可用，不伪造封面。
- 专业导播高级参数保持常显。
- About 将 1.0 风格的开发者资料合并到“当前程序”卡片右侧，使用发布者提供并在
  `THIRD_PARTY_NOTICES.md` 中单独声明的标识；窄窗口下自动上下排列。
  资料区显示“独立开发者”“柏拉图灵 | PlaTuring”和“抖音 / B站：柏拉图灵”；
  链接列表只保留“项目仓库”，不再单列“GitHub”。
- 侧栏把“已生成视频”缩短为四字“视频成品”，内部路由和项目数据格式不变。
- 发布者提供的项目标识已进入公开源码、渲染器资产白名单与冻结输入清单；
  它不属于 Apache-2.0 授权，具体再分发边界见第三方声明。
- 全新检出在断网测试前显式执行锁定 `electron@44.0.0` 包内的
  `install.js`，避免依赖开发机已经存在的 Electron 二进制。

## 验证证据

- 产品冒烟：本地运行时 47/47、H3 编译器 12/12、Control Plane
  527 通过、1 个匿名网络用例因测试环境禁网跳过、0 失败。
- UI 冒烟：`CONTROL_PLANE_UI_READY mode=deterministic_mock`。
- 产品边界：`media_generated=0`、`prompt_submitted=0`。
- 全新隔离克隆：typecheck 3/3、Control Plane 527 通过/1 跳过、根契约
  5/5、开源卫生通过、源码离线清单通过。
- 打包门禁：15 项运行时映射、75 个资源文件、3 个本地运行探针、原生 helper
  profile 与协议检查均通过。
- NSIS 归档结构检查：30 个目录、152 个文件，`Everything is Ok`。
- 解包 `app.asar` 中的头像为 25,194 字节，SHA-256 与授权记录一致：
  `138b2925844d1464ba7f5b4beb736c6fda4114c3c25127341069ebf497b2818e`。

## 冻结安装包

- 本机路径：
  `apps/control-plane/release-unsigned/v1.0.2/Relay-1.0.2-x64-Setup.exe`
- 长度：`100871043` 字节
- SHA-256：
  `345b32283cd77b989eae92b4cf96c929378ff52a19847ccfff3e0aca5a57a7fe`
- FileVersion / ProductVersion：`1.0.2`
- Authenticode：`NotSigned`

SHA-256 只证明下载内容与冻结文件一致，不证明发布者身份。由于用户正在使用
Relay 与 ComfyUI，本轮没有在当前主机执行安装、卸载或关闭现有实例；这不会被
误报为安装验证通过。2026-09-04，发布所有者明确接受仅针对上述精确长度与
SHA-256 安装包跳过隔离 VM 安装/启动验证后公开发布。该豁免不等于验证通过，
不覆盖任何字节发生变化的安装包。

## 开源与边界

公开源码采用 Apache-2.0，并携带 `LICENSE`、`NOTICE`、
`THIRD_PARTY_NOTICES.md`、安全策略与贡献说明。项目文件、提示词、模型、生成
媒体、本机路径、构建产物和历史发布物均不进入公开提交。除本版已按精确哈希
单独授权并声明的项目标识外，缺少再分发来源证明的个人图片也不会进入公开提交。

Relay 只负责安装、检测、配置、项目与素材管理、确定性工作流编译和交接。
Relay 不点击 Run、不调用 `/prompt`、不提交 ComfyUI 队列，也不生成视频或音频。
