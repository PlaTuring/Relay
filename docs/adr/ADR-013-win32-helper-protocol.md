# ADR-013：Win32 helper ABI、工具链与威胁合同

- **状态：** Proposed — `P1-NAT-001` 静态合同与负例完成，等待 Root acceptance
- **日期：** 2026-08-27
- **任务：** `P1-NAT-001`
- **依赖：** Accepted ADR-003、ADR-004、ADR-012
- **适用范围：** production Win32 helper 的实现前 wire ABI、工具链计划、身份/签名状态、operation allowlist、错误和威胁边界
- **不包含：** native source/binary、真实编译、进程启动、工具链安装、Electron bridge、schema/registry/WBS、签名证书或任何媒体生成

## 1. 固定产品边界

本任务只实现安装、检测、配置、workflow 编译、确定性编排或技术验证合同。MiniMax H3 仍只在
ComfyUI 内、用户点击 Run 后生成实际视频和原生音频。

Helper 不包含 generic command/shell/filesystem/network/download、Comfy queue、`/prompt`、
inference、prompt/story/music 创作或 video/audio/media generation surface。它没有工具侧 Run，
也不能替用户提交第一笔或后续正式任务。

## 2. 决策摘要

1. ABI 是 Electron main 与独立 helper 之间的 **out-of-process private inherited-pipe wire ABI**；
   不是 DLL/native-addon ABI，不暴露函数、公共 named pipe、TCP 或通用 CLI。
2. Control 使用 32-byte little-endian header + 最多 256 KiB exact JCS UTF-8；artifact 使用独立
   pipe、40-byte header、最多 1 MiB chunk、256 GiB total 和一次性 `stream_ref`。JSON 不嵌 binary/base64。
3. Frame/schema/ABI/digest/app/helper/build/publisher tuple 全部 exact；无协商、范围匹配、downgrade
   或 unknown operational field。双向 sequence 从 0 严格递增，request ID 在 session 内永不复用。
4. Handshake 同时绑定 parent handle、PID+creation FILETIME、canonical image/hash、app/helper
   version/build manifest、双 nonce、ABI digest 和 OS 验证的签名身份。Peer 自报不是 authority。
5. `internal_unsigned` 与 `authenticode_release` 是 build-derived closed states。前者只用于内部证据；
   后者要求 app/helper、publisher SPKI、RFC 3161 timestamp 和 signed pairing manifest 全部 exact。
   runtime flag/config/env/请求不能提升状态。
6. 只允许 ADR-003 的八个 operation family。只有 volume/path inspection 可接受一个 raw candidate
   path；其后全部使用 session-scoped opaque refs 与明确 contract-relative locator。
7. Timeout 使用 helper monotonic clock；cancel 有明确 publish point。Launch 在 resume 前取消原
   process handle，resume 后只 teardown exact Job；atomic publish 后不能伪报 cancelled。
8. Error 是稳定 `code/numeric_code/instance_path/rule_id` tuple，加 retry/session/effect 分类；不回显
   invalid value、absolute path、nonce、token、prompt、command line 或 raw Win32 text。

规范性细节与 digest authority 位于：

- `native/win32-helper/spec/abi-manifest.v1.json`
- `native/win32-helper/spec/toolchain-lock.v1.json`
- `native/win32-helper/spec/protocol-v1.md`
- `native/win32-helper/spec/threat-model.md`
- `native/win32-helper/include/minimaxh3_winbroker_abi.h`

## 3. 工具链与 architecture 计划

ADR-003 曾把 Rust/MSVC/最小 C/C++ 选择交给 P0-ARC-010；accepted ADR-012 实际只用 .NET
Framework C# fake harness 证明 Win32 顺序，没有选择 production helper 语言。本文关闭该**计划选择**，
不把它写成 runtime proof：

| 项目 | 冻结值 |
|---|---|
| 语言 | ISO C++20，无第三方 dependency |
| 编译发行物 | Visual Studio Build Tools 2022 `17.14.39`，build `17.14.37614.0` |
| MSVC component | `Microsoft.VisualStudio.Component.VC.14.44.17.14.x86.x64` |
| Toolset/compiler line | v143 `14.44` / MSVC `19.44` |
| Windows SDK | `10.0.26100.8876` |
| Target | x64/PE32+/little-endian/64-bit pointer/UTF-16 `wchar_t`，x86/ARM64/WOW64 unsupported |
| Runtime | `/MT` static CRT；一个 console/no-window EXE；无 DLL/native addon |
| Build resolution | exact offline artifact only；build phase network denied |
| Release signing | locked SDK `signtool`, SHA-256, RFC 3161, exact publisher SPKI in signed authorization |

Compiler/link hardening、allowed import libraries 和 forbidden build features 在 toolchain lock 中逐项固定。
首次 build 前必须 materialize distribution/compiler/linker/SDK/signtool 的 exact URI、length、SHA-256、
file version、license 和 provenance；任何字段未齐都阻断编译。本文没有下载、安装或运行这些工具，
因此工具链选择是 `contract_frozen`，当前主机 materialization/build 仍 `blocked/pending`。

版本存在性参考 Microsoft 的固定版本与组件清单；这些网页只作审计依据，不参与 build-time resolution：

- [Visual Studio 2022 release history](https://learn.microsoft.com/en-us/visualstudio/releases/2022/release-history)
- [Visual Studio Build Tools components](https://learn.microsoft.com/en-us/visualstudio/install/workload-component-id-vs-build-tools?view=visualstudio)
- [Windows SDK downloads](https://learn.microsoft.com/en-us/windows/apps/windows-sdk/downloads)

## 4. Operation allowlist

| Opcode | Family | Authority |
|---:|---|---|
| `0x0101` | `inspect_volume_candidate` | bounded volume observation only |
| `0x0102` | `validate_path_identity` | handle/volume/reparse policy；返回 opaque path ref |
| `0x0103` | `prepare_owned_root` | exact validated candidate 的 owner marker/root |
| `0x0201` | `materialize_owned_artifact` | approved role/length/hash stream 到 owned target |
| `0x0202` | `commit_owned_state` | exact role/CAS 的 same-directory atomic replace |
| `0x0301` | `launch_managed_core` | verified manifest → suspended create → Job verify → resume |
| `0x0302` | `verify_loopback_owner` | inherited listener 与 exact launch/Job identity observation |
| `0x0303` | `query_or_stop_owned_launch` | 只 query 或停止 exact `launch_ref`/Job |

Cancel 是 control message，不是第九个 capability。未知 opcode、header opcode/JSON kind mismatch、
body unknown field、caller-supplied executable/argv/cwd/env/PID/port/URL/endpoint/path mutation 均 fail closed。
External models/instances 永远 read-only；Alpha 没有通用 delete operation。

## 5. Threat contract

威胁模型固定处理：frame/control-stream confusion、oversize/truncation、UTF-8/JCS/duplicate-key ambiguity、
downgrade、sequence/request/stream replay、response/cancel correlation confusion、wrong parent/build/helper/hash/
publisher、unsigned promotion、generic command/filesystem/network/download、queue/`/prompt`/generation smuggling、
ambient path/PID/handle、path device/UNC/ADS/reparse/TOCTOU、external mutation、stream overrun、Job escape、
wrong-process stop、cancel/crash partial publish 和 secret/log disclosure。

Same-user malware、elevated OS principal/kernel/signing-key compromise 不属于 handshake authentication promise；这不允许
release 降低校验。Job 也不是 firewall。Real Comfy Gate A/Gate B、真实路径 primitive、packaged bridge、
Authenticode 和 certificate custody 仍是后续独立 gates。

## 6. Hostile fixture gate

`tests/fixtures/native-helper/protocol` 使用 Node built-ins only，不编译或启动 helper。Validator 固定：

- exact ABI SHA-256、8-family equality、header mirror 和 typed error map；
- exact valid/hostile counts 与 required threat IDs，删除负例会失败；
- frame/stream byte mutation、strict UTF-8/duplicate/JCS parser 和 deterministic error tuple；
- generic command/shell/network/download/arbitrary executable、Comfy queue、`/prompt`、generation/media 请求
  的逐项拒绝；
- 无 timestamp、hostname、username、absolute private path 或环境依赖的 summary。

它可证明 static protocol/threat contract 与 hostile corpus 自洽，不能证明 Win32 implementation。

## 7. 后果与证据状态

### Proven（本任务静态范围，待验收命令通过）

- exact wire layout、limits、version/digest、closed operation/error registry；
- caller/build/signing state machine 与禁止 runtime promotion；
- hostile fixture 对 downgrade/replay/truncation/confusion/forbidden surface 的 deterministic rejection；
- x64 C++/MSVC/SDK plan 已冻结且诚实标注未 materialize。

### Pending / downstream

- `P1-NAT-002`：suspended process/Job/PID/listener identity implementation；
- `P1-NAT-003`：volume/handle/reparse/owned path and atomic artifact implementation；
- packaged Electron bridge、import/PE hardening、real compiler equivalence、fuzzing、VM、AV/EDR；
- organization Authenticode certificate、publisher SPKI、RFC 3161 与 signed pairing manifest；
- real Comfy/H3/Run/zero-submit/Gate A/B evidence。

失败回退是阻断 native implementation 和 production launcher；不得改用 Node direct spawn、string path、
PowerShell、generic helper、external Comfy attach、API/cloud 或 queue bridge。

## 8. 影响与重审触发

- Schema/API：未修改 shared schema；本文只冻结 private helper wire API。
- Registry/WBS/计划/root lockfile：未修改。
- 系统状态：未安装 SDK/package，未写 registry/PATH/firewall，未创建/启动 helper。
- 用户/外部资产：未触碰。

新增/改义 operation、frame/stream layout、limit、path/owner authority、error semantics、caller/signing anchor、
timeout publish point、network/admin/service、queue/`/prompt` 或 generation surface 必须重审本 ADR。Root 接受且
两次 deterministic validation/WBS green 后，`P1-NAT-002` 与 `P1-NAT-003` 才 ready。
