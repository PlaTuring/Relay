# P0-ARC-004 — .NET desktop 有界技术栈证据

> **状态：** CONDITIONAL / BUILD BLOCKED（候选栈证据，不是最终选型）  
> **日期：** 2026-08-27  
> **允许范围：** `prototypes/phase0/stack-dotnet/**`、本文件  
> **产品边界：** 仅控制平面技术验证；无 ComfyUI/H3/GPU/云 API、无生成或正式 Queue 能力

## 1. 结论

当前主机不能构建、运行或打包现代 .NET 桌面候选：`dotnet` host存在，但 `dotnet --list-sdks` 返回零个SDK；只安装了`Microsoft.NETCore.App 8.0.21`，没有`Microsoft.WindowsDesktop.App`；未发现Visual Studio、现代MSBuild、Windows SDK、MSIX工具或签名工具。因此framework-dependent与self-contained发布、WPF运行、WinUI、安装包、体积、启动/内存、签名和运行期可访问性均为 **BLOCKED**，不是失败模拟，也不能用推测数字填表。

本任务产出的是一个明确标注的 **uncompiled WPF design fixture**：它复用Electron/Tauri的路径和四方法对比合同，并通过只读主机探测、静态边界检查、Alpha无自更新检查和公开证据lint。它能证明设计/证据卫生形状，不能证明编译器、WPF dispatcher、`OpenFolderDialog`、`ProcessStartInfo.ArgumentList`、发布器或打包器实际接受并执行了代码。

系统自带.NET Framework 4.x编译器、旧MSBuild和WPF运行程序集存在，但缺少目标reference pack，且它们不是现代.NET SDK替代品。本任务没有利用它们拼出一个不可比较的旧框架产品，也没有全局安装或下载缺失工具链。

结论是“.NET/WPF在这台主机上保持条件候选、运行证据阻断”，不是选择或淘汰.NET。最终ADR只能在预配置并锁定的Windows构建主机上完成同夹具PoC后作出。

## 2. 范围确认与未执行事项

本任务只实现安装、检测、配置和工作流交接控制面的设计/技术验证。MiniMax H3仍只在ComfyUI中、用户可见地点击Run之后生成实际视频和原生音频。

没有执行以下行为：

- 安装或修改 .NET SDK/runtime/workload、Visual Studio、Windows SDK、Windows App SDK或全局NuGet配置；
- restore NuGet、下载任何包、模型、runtime、ComfyUI或构建工具；
- 编译或启动WPF/WinUI、调用H3/GPU、创建媒体、调用云/Partner API或`/prompt`；
- 构建/运行MSIX、MSI、EXE installer，写注册表、服务、计划任务或系统环境变量；
- 增加工具侧“生成/Run”动作、自动队列、telemetry、updater或远程catalog；
- 修改root lockfile、registry、schema、主计划或其他候选原型。

验证只调用已有的PowerShell与Node.js，执行只读主机探测和文本/JSON静态检查；子进程均使用参数数组与`shell=false`。

## 3. 当前主机/工具链事实

主机probe只输出版本与布尔能力，不输出可执行文件路径、账户名、环境变量集合或私有目录。

| 项目 | 只读实测结果 |
|---|---|
| Windows | `10.0.26200.0`，x64 |
| `dotnet` host | 存在，product `8.0.21`，commit `362ab6669d55a75d51166f01b596c967c734ef4c` |
| .NET SDK | 0个；modern build/publish不可用 |
| 已安装runtime | 仅`Microsoft.NETCore.App 8.0.21` |
| Windows Desktop runtime | 未发现`Microsoft.WindowsDesktop.App` |
| Visual Studio 2022已知根 / `vswhere` | 未发现 |
| 现代MSBuild | PATH与已知VS根均未发现 |
| Windows SDK已知根 | 未发现 |
| `signtool` / `makeappx` | 未发现 |
| legacy .NET Framework | registry version `4.8.09221`，release `533509` |
| legacy compiler/MSBuild/WPF runtime assemblies | 存在 |
| legacy reference targeting pack | 未发现；不接受为现代SDK替代 |

这些负结论是有界探测：只检查官方命令、注册项和已知machine roots，不递归搜索用户目录、不执行setup脚本、不加载未知代码。Microsoft官方把`dotnet --list-sdks`和`dotnet --list-runtimes`列为已安装版本检测入口；本报告据此区分“runtime存在”与“SDK存在”。参考：[检查已安装的.NET版本](https://learn.microsoft.com/en-us/dotnet/core/install/how-to-detect-installed-versions)。

## 4. WPF选择与WinUI对照

### 4.1 为什么fixture选择WPF

本候选fixture以`net8.0-windows + UseWPF=true`表达最小Windows控制平面，理由是：

- 与Electron/Tauri比较的UI只需要表单、状态、文件夹选择、可访问性和typed service边界，不需要WebView；
- WPF是成熟的Windows-only .NET桌面UI，适合本产品只支持Windows的前提；
- .NET 8 WPF提供`Microsoft.Win32.OpenFolderDialog`，设计上可以使用系统文件夹选择面，而无需为本fixture引入第三方picker包；
- WPF对P/Invoke/Windows Job Object/native volume API没有框架层阻碍，但这些能力仍须独立实现和运行证明。

这只是设计候选。官方要求SDK-style项目使用Windows-specific TFM并设置`UseWPF=true`；当前主机没有相应SDK/Desktop pack，故fixture命名为`StackDotnet.csproj.fixture`，没有伪装成可构建项目。参考：[.NET Desktop SDK的MSBuild属性](https://learn.microsoft.com/en-in/dotnet/core/project-sdk/msbuild-props-desktop)、[WPF概览](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/overview/)。

### 4.2 WinUI为何未选为本地fixture

WinUI 3是Windows App SDK的一部分，当前官方命令行路径要求现代.NET SDK并通过模板/NuGet取得相应工具和包；本机既无SDK，也无Windows App SDK构建证据。WinUI设计、runtime、unpackaged/packaged模式和依赖体积全部BLOCKED，不能靠创建未解析的NuGet引用来假装完成。

官方把WinUI 3定位为新Windows原生应用的推荐UI，并说明其支持Windows 10 1809+；这会带来Windows App SDK runtime与packaging决策，而非“系统自带零成本”。后续PoC应在同一预配置主机把WPF与WinUI作为.NET内部二选一小门，而不是在本任务无工具链时下结论。参考：[WinUI 3概览](https://learn.microsoft.com/en-us/windows/apps/winui/winui3/)、[WinUI开始要求](https://learn.microsoft.com/en-us/windows/apps/get-started/winui-get-started-overview)。

## 5. 产物性质与最小架构

原型没有`.csproj`、solution、NuGet lock、`bin/obj`、可执行文件或安装包。唯一类似project的文件以`.fixture`结尾，并显式声明`not-consumed-by-dotnet-sdk`。

```text
WPF MainWindow design fixture
  native controls; no WebView; no generic dispatcher
                 |
                 | exact typed IControlPlaneService: 4 methods
                 v
ControlPlaneService design fixture
  security summary
  OpenFolderDialog picker
  managed-root shape policy
  fixed harmless direct-child probe
```

四个确切方法：

```text
GetSecuritySummaryAsync
ChooseManagedRootAsync
InspectManagedRootAsync
RunOwnedChildProbeAsync
```

UI只持有typed interface，未提供字符串command router、reflection dispatcher、HTTP client、Comfy client或任意endpoint调用器。当前证据只证明source/contract形状；没有WPF runtime dispatcher或编译器证据。

## 6. Windows路径与native folder picker

相同JS oracle重复Electron/Tauri的fixture：

- `D:\MiniMax H3\模型 Ω`保留空格、中文与`Ω`；
- 用户显式选择`C:\MiniMaxH3`时可识别为system-drive语义，供UI显示大文件警告；
- relative、UNC和device namespace形式fail closed；
- D盘只有在上游证明为supported fixed NTFS时才建议`D:\MiniMaxH3`；否则为`null`，绝不静默回退C。

C# path source静态镜像上述shape policy，但未编译/执行。真实fixed NTFS、free-space、canonical path、reparse/device/ADS、权限、长路径、断盘和运行时卸载仍需共享native helper/后续disk任务。

folder picker设计使用WPF `.NET 8` 的`Microsoft.Win32.OpenFolderDialog`、单选并传入owner window。它没有本地运行证据，因此focus恢复、取消、Unicode、键盘、Narrator和高DPI行为均BLOCKED；不能把source存在写成“native picker已通过”。

## 7. Owned child与Job Object边界

uncompiled设计固定`FileName=Environment.ProcessPath`，把固定标志、随机token和Unicode/空格label逐项加入`ProcessStartInfo.ArgumentList`，设置`UseShellExecute=false`，重定向标准流，校验ready token，最后`Kill(entireProcessTree:true)`并等待退出。renderer/UI不能提供executable、working directory、environment或任意argument数组。

这些是source shape，不是运行证据；本机没有编译它。尤其：

- `Kill(entireProcessTree:true)`不是“首条用户代码之前”的non-breakaway Job Object containment；
- 没有`CreateProcess(CREATE_SUSPENDED)`、`AssignProcessToJobObject`、membership验证或nested-Job负例；
- 没有证明readiness、PID/creation identity、取消race、崩溃清理、grandchild escape或packaged path；
- 因此fixture明确返回`ProcessTreeContained=false`。

Electron与Tauri也未证明生产Job Object。无论最终选哪种UI栈，ADR-002要求的first-instruction前containment都应由一个共享、最小、审阅过的Windows native launcher/helper提供，而不是由UI框架的普通`Process`/`Command`包装替代。

## 8. 隐私、DPAPI与零外联

本spike不需要保存credential、token或API key，因此没有引入DPAPI、Credential Manager或secret vault。用“不存在secret surface”代替“实现一个暂时用不到的保险箱”可以减少Alpha攻击面。如果未来出现获批的敏感本地状态，必须单独定义user/machine scope、备份/重装/多用户行为、日志redaction和密钥迁移测试；不能因选择.NET就默认声称DPAPI边界完成。

fixture没有HTTP、queue、Partner/API、telemetry、update或remote catalog代码。静态缺失不等于零外联证明：只有真实packaged进程树、联网抓包和断网复跑后，才可授予offline/zero-egress状态。

## 9. 发布、安装器、签名与C盘预算

Microsoft官方定义：framework-dependent publish要求目标机器已有兼容runtime；self-contained publish把runtime一起发布。两种模式都通过SDK的`dotnet publish`生成。本机没有SDK，且连WPF所需Windows Desktop runtime也未安装，所以两种publish均BLOCKED。参考：[dotnet publish](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-publish)、[.NET发布模式](https://learn.microsoft.com/mt-mt/dotnet/core/deploying/deploy-with-cli)。

| Artifact/能力 | 结果 |
|---|---|
| framework-dependent build/publish | BLOCKED：无SDK/Desktop pack |
| self-contained `win-x64` publish | BLOCKED：无SDK，未解析runtime pack |
| WPF executable / unpacked size | N/A：无artifact |
| startup / idle memory | N/A：无可运行app |
| MSIX | BLOCKED：无Windows SDK/`makeappx`，无package identity实测 |
| MSI/EXE/Bootstrapper | BLOCKED：未选定/安装/锁定packager |
| Authenticode | BLOCKED：无artifact、无`signtool`、无publisher证书 |
| install/upgrade/uninstall/residue | BLOCKED：需要`WIN-VM`和最终installer |

MSIX、unpackaged和其他installer路线各有不同的identity、更新、权限、企业部署和签名语义。官方也把内部工具/开发工具的unpackaged路径列为较简单的部署选项；这不替代本产品的assisted per-user installer需求。最终installer格式应由统一发布ADR决定，而不是让UI栈spike自行选择。参考：[Windows app packaging概览](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/packaging/)、[MSIX概览](https://learn.microsoft.com/en-us/windows/msix/overview)。

没有artifact就不能声称.NET更小。即使未来framework-dependent shell很小，也必须把.NET Windows Desktop runtime bootstrap/repair、app files、logs、crash dump和配置写入C盘预算；self-contained则把runtime体积计入installer/managed app。模型、Comfy runtime、cache、temp media和output仍属于用户可见fixed-NTFS managed root，不能静默落C。

## 10. Alpha无自更新与发布修复

设计fixture无updater dependency、service、scheduler、channel、remote catalog、download endpoint、telemetry或“update all”表面；共享Alpha no-self-update lint通过。Alpha安全更新只能通过下一份完整、审阅并签名的installer人工升级。

这不是“永不更新”。最终发布需要.NET/WPF或Windows App SDK的安全支持窗口、重发SLA、完整installer验签和rollback策略。引入App Installer、MSIX自动更新或任何远程manifest必须经过独立trusted-update gate，不得作为UI栈默认能力进入Alpha。

## 11. 可访问性

WPF XAML fixture静态包含：

- `zh-CN`、native `Window/ScrollViewer/TextBlock/TextBox/Button/GroupBox`；
- 明确label/help text、状态`LiveSetting=Polite`、44 px最小按钮高度；
- 只读路径显示、文本化成功/失败信息，不只依赖颜色；
- 两个动作仅为“选择安装位置”和“验证无害进程边界”，没有工具侧Run/生成/排队/提交。

这只是static foundation。编译后的UI Automation tree、Tab顺序、焦点恢复、Narrator、高对比、200%缩放、多语言、错误摘要和native dialog均BLOCKED。WPF使用native desktop控件并不自动等于满足某个WCAG或Windows accessibility等级。

## 12. 依赖、SBOM、许可与安全清单

没有SDK，就没有可信的SDK版本解析、NuGet assets graph、runtime pack、native binary清单或publish manifest。本任务故意不创建虚假的`packages.lock.json`/SBOM，也不把系统已安装runtime当作最终应用分发清单。

| 证据 | 状态 |
|---|---|
| exact .NET SDK/global.json pin | BLOCKED |
| Windows Desktop targeting/runtime pack | BLOCKED |
| NuGet restore/assets/transitive graph | BLOCKED；未restore |
| framework-dependent runtime prerequisites | BLOCKED |
| self-contained runtime/native files | BLOCKED |
| packaged SBOM与第三方notices | BLOCKED |
| license inventory | BLOCKED；不得从design推断最终分发许可 |
| advisory/vulnerability snapshot | BLOCKED；没有resolved graph |
| Windows SDK/packager/signtool provenance | BLOCKED |

后续PoC必须固定SDK artifact/hash，关闭workload advertising/background下载，使用隔离`DOTNET_CLI_HOME`与NuGet cache，锁定所有source，记录restore/build scripts，分别为framework-dependent与self-contained生成publish manifest、binary SBOM、许可notices和安全快照。

## 13. 与Electron/Tauri同矩阵比较

| 维度 | Electron已接受证据 | Tauri当前证据 | .NET本任务证据 | 当前可比？ |
|---|---|---|---|---|
| installer / unpacked | 95.18 / 365.90 MiB | 无artifact | 无artifact | 仅Electron可测 |
| build footprint / SBOM | 约527.50 MiB dev modules；384 components | Cargo graph blocked | SDK/NuGet/runtime graph blocked | 否 |
| UI隔离 | packaged Chromium/contextBridge已测 | WebView/config shape only | native WPF typed boundary shape only | 仅source层部分 |
| typed allowlist | 4 IPC runtime证明 | 4 command静态 | 4 service方法静态 | 部分 |
| native folder picker | Electron dialog实现，人工UX未验 | blocked | OpenFolderDialog source only | 否 |
| Unicode/space path | runtime/unit通过 | JS oracle；Rust blocked | 同JS oracle；C# blocked | 只比较fixture语义 |
| owned direct child | dev+packaged通过 | source only | ArgumentList source only | 否 |
| Job Object/process tree | blocked | blocked | blocked | 是：三者共同缺口 |
| per-user installer | NSIS已构建，VM行为未验 | blocked | blocked | 否 |
| signing | artifact实测NotSigned | 无artifact | 无artifact | 只比较发布门存在 |
| startup / memory | 未测 | 未测 | 未测 | 三者均blocked |
| accessibility | static Web基础，人工未验 | static Web基础 | static native XAML基础 | 仅静态部分 |
| no updater | proven | static policy pass | static policy pass | 部分 |
| public evidence hygiene | proven | proven | proven | 是 |

不得用“native”推断.NET更安全/更小/更快，也不得用“系统有.NETCore runtime”推断WPF无需分发依赖；当前机器甚至没有Windows Desktop runtime。只有同一主机、同一功能、同一签名状态和同一测量脚本产生的真实artifact才可比较。

## 14. 验证与可重复性

从仓库根执行：

```powershell
pwsh -NoLogo -NoProfile -NonInteractive -File .\prototypes\phase0\stack-dotnet\scripts\probe-toolchain.ps1
node .\prototypes\phase0\stack-dotnet\scripts\verify-static.mjs
node .\prototypes\phase0\stack-dotnet\scripts\verify-static.mjs
```

两个verifier run都必须重新执行只读probe并与sanitized capture比较，运行全部path fixture，检查四方法/WPF/picker/child/DPAPI/no-network/accessibility/dependency边界，调用共享Alpha no-self-update lint和public-evidence lint。第三方raw stdout不得保存为公开证据；公开记录只保留相对路径、计数、状态和hash。

Public evidence lint扫描本报告与prototype公开文本/source，拒绝Windows账户根绝对路径、当前账户名、常见token形态和raw environment dump，并要求`bin/obj/publish/packages/NuGet cache/.NET CLI home/cache/local artifacts`保持ignored。lint失败只回报仓库相对位置，不回显内容。

连续两次verifier均Exit 0：每次`34 PASS / 14 BLOCKED`，host probe match、共享no-self-update lint和public-evidence lint均通过。精确计数和hash记录在`evidence/TEST_RESULTS.md`。`BLOCKED`是明确的证据状态，不是被忽略的测试失败；若host事实漂移，verifier会失败并要求更新sanitized capture与报告，而不是接受模糊的“接近版本”。

## 15. 证据等级

### Proven（当前主机）

- sanitized只读host事实与零SDK/零Desktop runtime/零Windows SDK的有界结论；
- 同一JS managed-root path oracle和无静默C fallback；
- exact四方法、WPF/picker/ArgumentList/无secret/no-network的静态source shape；
- 工具侧无生成/queue动作、Alpha无自更新和public evidence hygiene；
- 两次本地static verifier复跑（计数以TEST_RESULTS为准）。

### Inferred / configuration-only

- WPF适合作为Windows-only控制平面候选；
- `OpenFolderDialog`可提供目标native picker API；
- `ArgumentList`设计可避免shell字符串拼接；
- framework-dependent可能比Electron壳体积小，但未测且依赖目标机Desktop runtime。

### Blocked

- 现代.NET compile/analyzers/tests及任何WPF/WinUI runtime行为；
- native picker、typed dispatch、owned-child readiness/cancel/terminate真实执行；
- Job Object first-instruction containment与grandchild清理；
- framework-dependent和self-contained发布、体积与runtime兼容；
- installer、per-user、upgrade/uninstall/residue、签名和SmartScreen；
- startup/memory、UIA/Narrator/keyboard/high-contrast/200% scaling；
- NuGet/runtime/packager SBOM、许可、advisory和binary provenance；
- offline/zero-egress packaged进程树认证。

## 16. 建议与下一PoC

保持.NET/WPF为条件候选，不因本机缺SDK直接淘汰，也不因native UI想象优势提前选择。下一个获批PoC应使用预配置、版本锁定且无需全局临时安装的Windows build host：

1. 固定现代LTS .NET SDK、Windows Desktop targeting/runtime pack和Windows SDK hash；
2. 把本fixture转成真实SDK-style WPF项目，不增加第三方包即可完成四方法、OpenFolderDialog、路径和无害child；
3. 同时发布framework-dependent与self-contained `win-x64`，记录完整manifest、体积、启动、idle memory和C盘写入；
4. 在child执行任何可扩展代码前加入共享native Job Object launcher，并测pre-assignment escape/nested Job/grandchild；
5. 选择一个assisted per-user installer，与Electron/Tauri保持相同安装/签名/VM矩阵；
6. 生成resolved依赖、runtime/native binary SBOM、许可notices与安全快照；
7. 运行keyboard/Narrator/high-contrast/200% scaling与native picker focus测试；
8. 在线抓包与断网复跑真实packaged app，未通过前不授予zero-egress/offline声明。

Root接受P0-ARC-004后，可把这份“exact blocked”证据连同Electron/Tauri证据交给P0-ARC-005；最终stack ADR仍须明确哪些维度是runtime proven，不能让静态fixture与真实package评分相同。
