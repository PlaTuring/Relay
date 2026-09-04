# P1-APP-001 — Production Electron application scaffold

> **状态：** SOURCE/BUILD-GRAPH PROVEN；待 Root 总控审查。Production package、native helper、签名与 Windows VM gate 为 `blocked_external`。  
> **日期：** 2026-08-27  
> **任务：** `P1-APP-001`

## 1. 范围确认

本任务只创建 production Electron/TypeScript 应用脚手架、离线构建验证与供应链 hooks。它不下载或启动 ComfyUI，不下载模型，不调用 GPU，不生成媒体，不提交正式任务，也不包含工具侧生成控制。实际视频和原生音频只由用户在 ComfyUI 中明确操作后执行的 MiniMax H3 生成。

本任务只写入：

- `apps/control-plane/**`
- `docs/evidence/PRODUCTION_APP_SCAFFOLD.md`

根 package/lockfile、Phase 0 spike、native helper、schema、registry、WBS、主计划、安装器、模型和外部路径均未修改。Phase 0 Electron spike 只作为已接受的锁定输入证据，没有被重命名或当作 production app。

## 2. Production workspace

Production workspace 独立位于 `apps/control-plane/`，具有自己的：

- exact `package.json` 与 lockfile；
- `src/main/`、`src/preload/`、`src/renderer/`、`src/shared/`；
- `tests/` 与 Windows 空格/Unicode fixture；
- `scripts/` 固定构建、类型检查、SBOM、许可、公开证据 lint 与离线验证入口；
- `build/` 构建图、输入 hash inventory 和 release gate 状态；
- `dist/`、`artifacts/` 等忽略的可重建本地输出。

唯一 placeholder IPC 是无参数、只读的 `app:get-scaffold-boundary`。Renderer 不能提供 executable、argument、path、URL、endpoint、文件操作或通用 operation，也没有 raw `send/invoke/on` bridge。

## 3. Renderer/main/preload 边界

Source 与自动检查证明：

- `sandbox=true`、`contextIsolation=true`、`nodeIntegration=false`；worker/subframe Node integration 与 `webviewTag` 同样关闭；
- control renderer 使用独立非持久 session partition；HTTP(S)、WebSocket、FTP request、permission request、download、window open 和非 exact local renderer navigation 全部拒绝；
- CSP 使用 local-only source，并设置 `connect-src 'none'`、`object-src 'none'`、`base-uri 'none'`、`form-action 'none'`、`frame-src 'none'`、`worker-src 'none'`；无 inline/eval 或 remote asset；
- IPC sender 同时匹配 exact main frame 与 exact local file URL；
- runtime source 不含 child process、filesystem/network client、generic shell/command、updater、remote catalog、runtime install、formal queue 或 cloud fallback authority；
- renderer 只使用 `textContent`，没有 untrusted HTML 注入或工具侧正式任务控件。

## 4. Fuse、ASAR 与 package inventory

`package.json` 的 production packaging policy 固定：

- ASAR enabled；只包含 `dist/main`、`dist/preload`、`dist/renderer`、`dist/shared` 与 `package.json`；
- RunAsNode disabled；Node options 与 CLI inspect arguments disabled；
- embedded ASAR integrity 与 only-load-from-ASAR enabled；cookie encryption enabled；
- assisted per-user NSIS baseline，无自动启动、无 differential package、无 publish/update 配置。

`build/input-inventory.json` 保存所有 source/build/test 输入的 exact byte length 与 SHA-256；`verify:offline` 同时拒绝缺失、额外或 hash 漂移输入。每次 build 后生成 `artifacts/package-input-inventory.json`，列出 exact ASAR/package input path、length 与 SHA-256。

这些是 source/build-graph 证据，不是 fuse 已写入真实 EXE、ASAR 已打包、installer 已签名或 VM 已安装的证据。

## 5. 锁定供应链

仅使用 Electron spike 已审查且本机已存在的 exact 输入：

| Direct dev input | Exact version |
|---|---:|
| Electron | `44.0.0` |
| electron-builder | `26.15.3` |
| TypeScript | `7.0.2` |
| esbuild | `0.28.2` |
| Vitest | `4.1.11` |
| `@types/node` | `26.4.0` |

Production lock 通过 npm offline mode、不可用代理和 `--ignore-scripts` 物化。其 399 个非根 package entry 与 accepted Electron spike lock 逐项相同，graph SHA-256 均为：

```text
b5fdd305fe3a68a15ed12906db065892e8b4b55a05375b76f369242a32f230a5
```

Accepted spike lock SHA-256：

```text
AAC7E6A4F2E13B070E6383648FA487FE0C9E98542D5CDC713365A59403D34805
```

Production root metadata 不同，因此 production lock 有自己的 SHA-256，并由最终 `verify:offline` 摘要报告。没有执行 npm install/postinstall script；Electron runtime binary 因而没有被本任务下载或物化。传递依赖仍包含 accepted spike 已记录的 deprecated packages；这不是安全或许可通过声明。

`sbom:source` 与 `licenses:source` 由 lockfile 生成确定性 CycloneDX source graph 和许可 inventory。它们覆盖 npm source/build graph，不覆盖 Electron ZIP、Chromium/Node 内部件、NSIS、7zip、Windows SDK、signtool、未来 native helper 或签名后 package。

## 6. 验收与确定性

从仓库根执行：

```powershell
npm --prefix .\apps\control-plane run verify:offline
npm test
```

`verify:offline` 最终两次完整复跑均 exit `0`，且 summary 完全相同：

```json
{"status":"passed","offline":true,"direct_dependencies":6,"locked_packages":399,"ipc_channels":1,"public_evidence":"passed","source_inventory_sha256":"be33aa7bd0b9ecabd234bfd32af03636260de9d05cfacd4e260ac4c7fc45bd81","package_lock_sha256":"44d4b88420fca3999bbedb821fb8831a5c99a355b8ab3387d2beab274b69358d","package_inputs_sha256":"beb9f8c6d57d64019f8ecc4d5274310ab97655a41cd7dfbae50eb2733bc7615b","package_gate":"blocked_external","native_helper_gate":"blocked_external","signing_gate":"blocked_external","installer_vm_gate":"blocked_external"}
```

这证明当前 27 个 source/build/test 输入、399 个锁定 npm package、strict typecheck、build、5 项 scaffold tests、source SBOM/license hooks、package input inventory 与 public-evidence lint 可在 npm offline/不可用代理约束下确定性重复。它不证明 OS 物理断网、Electron runtime执行、network-denied packaging 或可复现 installer。

根 fast runner 最终两次复跑均 exit `0`，每次结果均为：

```text
PASSED capability-catalog-contract
PASSED capability-snapshot-contract
PASSED component-manifest-contract
PASSED no-self-update-policy
PASSED qa-runner-contract
SUMMARY passed=5 failed=0 blocked=0 skipped=0
```

## 7. 证据等级与阻塞门

### Proven

- production 源码/测试/构建目录分离；
- strict TypeScript typecheck、deterministic local build 和 5 项 scaffold contract tests；
- exact direct versions、独立 lock、与 accepted spike 相同的非根 dependency graph；
- source input 与 package input SHA-256 inventory；
- static renderer/main/preload isolation、closed one-channel placeholder IPC、CSP/navigation/permission/download policy；
- source SBOM/license hooks与 public-evidence lint；
- no updater/publish/remote catalog/runtime download/generic command/formal submission surface 的 source/build-graph检查。

### Inferred / configuration-only

- electron-builder 会消费声明的 ASAR、fuse 和 NSIS 配置；本任务没有构建或执行 production package，因此不能升级为 packaged proof。

### Blocked external

- `package_materialization`：缺 accepted production Electron/NSIS/7zip binary source-length-hash-license manifest、受控 artifact cache 和 network-denied packaging evidence；
- `native_helper`：窄 Win32 helper、private-pipe protocol、pre-first-instruction Job containment、path handle/reparse 与 listener identity 由独立任务实现；
- `signing`：组织 publisher、证书/私钥托管、RFC3161 timestamp、installer/app/helper/uninstaller 验签与 post-sign inventory；
- `installer_vm`：干净非管理员 Windows VM 的 install/repair/upgrade/rollback/uninstall/residue/disk-full/power-loss；
- packaged accessibility、24-hour profile/C-drive budget、full binary SBOM/license、zero-egress 与 Comfy exact handoff 均不由本 scaffold 证明。

## 8. Schema/API/lockfile impact 与下一依赖

- Schema：无变化。
- Root API/lockfile：无变化。
- Production private IPC：新增 1 个无参数、只读 scaffold channel；不是共享业务 contract，不授权 filesystem、network、process、queue 或 generation。
- External/user state：无 mutation。

待 Root 接受后，按任务图可解锁 `P1-APP-002`、`P1-APP-003` 与 `P1-NAT-004`。在 Root 接受前，本任务停在待总控审查状态，不将 source scaffold 描述为 production installer 或可发布 application。
