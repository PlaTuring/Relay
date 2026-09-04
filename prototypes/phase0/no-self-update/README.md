# P0-GOV-007：Alpha 无自更新构建政策原型

本原型把“Alpha 没有应用/组件自更新”从文案变成确定性、离线、只读的构建检查。它不实现 updater，不访问网络，不安装依赖，不读取模型，不启动 ComfyUI/H3，也不调用 GPU。

## 一条验收命令

从仓库根目录执行：

```powershell
node .\prototypes\phase0\no-self-update\test-policy.mjs
```

测试会：

1. 检查 linter 只导入只读文件 API，没有网络或子进程能力；
2. 让 clean fixture 通过；
3. 对每个负例启动独立 linter 进程，要求退出码为 `1`、恰好一个 violation、恰好命中预期 rule ID；
4. 在执行前后散列整个 prototype 树，要求文件集合和内容逐字节不变。

直接检查任意已物化的 build-plan/source inventory：

```powershell
node .\prototypes\phase0\no-self-update\lint-no-self-update.mjs <build-plan-root>
```

机器可读输出：

```powershell
node .\prototypes\phase0\no-self-update\lint-no-self-update.mjs <build-plan-root> --json
```

退出码：`0` 通过，`1` 有政策 violation，`2` 输入/扫描不完整或 linter 自身失败。

## 规则

| Rule ID | 构建即拒绝 |
|---|---|
| `NSU-000` | 无法读取、无效 JSON、symlink/junction 等不完整扫描输入 |
| `NSU-001` | updater framework 出现在 packaged/resolved dependencies |
| `NSU-002` | updater service、`autoUpdater` 或 check/install API |
| `NSU-003` | 后台更新 scheduler、启动时检查、周期检查配置 |
| `NSU-004` | package/command registry 中的 update/check/self-update script |
| `NSU-005` | updater enablement、feed、self-update 等 config key |
| `NSU-006` | appcast、update feed 或 update-service endpoint |
| `NSU-007` | Stable/Testing/Beta/Canary/Nightly update channel |
| `NSU-008` | `latest`、`main`、`master`、`HEAD`、branch/latest URL 等可变目标 |
| `NSU-009` | 远端 component catalog/application manifest 地址或运行期 lookup |
| `NSU-010` | production hook 在运行期执行 pip/npm/Git/OS package/Comfy installer |
| `NSU-011` | `update all` 命令或 command array |

规则数据位于 `policy.json`，输出按 rule ID、相对文件、位置、消息排序。报告只包含输入 root 的 basename 和相对路径，不输出本机绝对路径。

## 为什么 clean fixture 不误报

clean fixture 刻意包含：

- 一个随 app 版本内嵌、revision/length/SHA-256 固定的 component catalog；
- 一个普通的 immutable artifact 下载 URL；
- 源码注释、帮助字符串和 README 中关于 updater、latest、channel、remote catalog、runtime download、update all 的说明文字。

JSON 使用 key/value 结构检查；源码先去除注释，再匹配明确 API、process hook、网络 lookup 和 URL 形状；Markdown/TXT/RST/AsciiDoc 被明确列为 prose 并跳过。因此 linter 不是对 `update` 或 `latest` 做全仓库裸字符串搜索。普通锁定 artifact URL不等于 update endpoint。

## Alpha 中允许与禁止的下载

允许：用户在安装/显式修复流程中，根据**当前签名应用内嵌 catalog**下载其中已经固定 URL/revision/length/SHA-256 的缺失 artifact。这个流程不能获得新 catalog，也不能把目标改为 `latest`。

禁止：运行中的 app、helper、Comfy generation、Manager、custom node 或 background service 获取新 application/component catalog、检查 channel、静默替换组件、安装 Python/Node/package 依赖，或执行 update all。

用户手动安装下一份独立签名应用安装包属于 app 外部版本迁移；新安装包携带自己的新 catalog。Alpha 进程本身不发现、下载或安装它。

## 扫描边界和已知限制

本 PoC 扫描已物化的 JSON manifests/config、package dependency/script declarations，以及列入 policy 的生产源码/配置扩展名。它明确忽略 prose 和开发测试目录，避免把政策说明或负例本身当成产品违规。

它不能单独证明：

- opaque `asar`、压缩包、原生 EXE/DLL 或预编译第三方代码中没有 updater；
- 运行时通过字符串拼接、反射、环境变量或下载代码构造 endpoint；
- 未提交给 linter 的另一份 manifest、lock/SBOM、generated source 或 packaging resource 安全；
- transitive dependency 的实际行为仅凭包名就是安全的；
- 进程树真实零外联。

生产 build gate 必须给 linter 一份完整、物化、无链接的 packaged-source/config inventory，并另行检查 resolved lock/SBOM、bundle resources、签名产物内容和 allowlisted process-tree egress。`ignoredUnsupportedFiles` 非空不能被 CI 当成完整覆盖证明；生产 adapter 必须逐类分派到可验证 scanner 或批准的 binary/SBOM gate。

`test-policy.mjs` 使用子进程只是为了隔离验证 linter 的退出码；实际 linter 自身没有 child-process、网络或文件写能力。
