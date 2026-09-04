# P0-ARC-006 — Managed Core final-path layout spike

## 结论

**PASS。** 一个完全离线、CPU-only 的微型假 runtime/假 Python 环境已经证明 Managed Core 可以在本地固定 NTFS 卷上的最终绝对 generation 路径中直接构建，并在验证通过后只通过同目录、低于 4 KiB 的 `active.json` 原子切换激活版本。构建中断、指针替换前中断、未完成 generation、含 staging 来源的 manifest、未拥有 generation 和删除 active generation 均 fail closed。

本证据只覆盖安装器的布局、所有权、验证、切换和恢复边界。它没有启动真实 Python、ComfyUI 或 MiniMax H3；实际视频和声音仍只能由 MiniMax H3 在 ComfyUI 中、用户点击运行后生成。

## 范围与产品边界

- 允许：安装/配置/检测/工作流技术验证所需的本地文件布局原型。
- 未做：真实 ComfyUI/H3 启动、模型下载、GPU 推理、网络访问、云 API、自动排队、提示词改写或任何内容创作逻辑。
- 假 `python.exe.fixture`、`pyvenv.cfg.fixture` 和 `main.py.fixture` 都是惰性文本文件，从未执行或导入。
- 测试读取了 PATH、注册表 PATH 和 `python` 命令发现结果的前后摘要，但没有写入或调用它们。

## 已验证布局

```text
<prototype>/work/受管 Core 布局测试/Managed Core Root/
  .managed-root-owner.json
  control/
    active.json                         # 201 bytes; relative identity only
    transactions/layout-spike-journal.json
  runtimes/alpha-core-fixture/
    gen-0001/                           # verified and final active generation
      .managed-core-owner.json
      manifest.json
      verification.json
      private-python/                   # inert final-path-bound fixture
      runtime/Comfy Fixture/            # inert runtime fixture
    gen-0002/                           # verified inactive generation
    gen-build-interrupted/              # state=building; cannot activate
    gen-incomplete-pointer/             # state=building; cannot activate
    gen-unowned/                         # no owner marker; cannot switch/delete
```

测试目录位于仓库获准写入范围内，因此本次实际卷是 `C:\`，检测结果为 `Fixed/NTFS`。这不是产品安装位置默认值，也不是对 D 盘策略的静默回退；量产安装器仍须独立实现“有效固定 NTFS D 盘优先建议、展示并允许用户修改、不可静默回退”的根目录选择策略。

## 需求到证据映射

| 要求 | 机制 | 验收结果 |
|---|---|---|
| generation 从一开始就在最终绝对路径构建 | generation 目录创建后首个内容是所有权 marker；假 private Python/runtime 直接写入该目录；manifest 标记 `direct-final-path` 与 `environment_relocated=false` | `generation_built_directly_at_final_path`、`private_environment_final_path_bound` PASS |
| 不把已填充 venv 从 staging 搬入 | 原型没有 environment 搬迁步骤；假 `pyvenv.cfg` 只嵌入最终绝对路径 | PASS |
| 支持含空格、中文的本地固定 NTFS 路径 | 在 `受管 Core 布局测试\Managed Core Root` 下构建；Windows PowerShell 5.1 用 Unicode code point 构造精确目录名 | `fixed_ntfs_space_unicode_root` PASS |
| incomplete generation 不能启动 | 激活前重验 owner、manifest `state=verified`、路径策略、artifact hash、receipt 与 manifest hash | 两种 building generation 和静态 incomplete pointer 均被拒绝，旧 active 不变 |
| 只替换小型 active pointer | candidate 在 `control` 同目录写入并 `Flush(true)`；首次用同卷 rename，后续用 `File.Replace`；`active.json` 不含绝对路径 | 201 bytes；初次激活、原子升级和切回均 PASS |
| path/journal/manifest 不残留 staging | 对 positive managed tree 的路径及 JSON/config/fixture 内容递归扫描；negative corpus 隔离在 managed root 外 | `positive_state_has_no_staging_reference` PASS |
| 不改全局 PATH/注册表/用户 Python | 前后快照包括 process/user/machine PATH、HKCU/HKLM PATH、只读 Python 发现与可读时 fingerprint | 摘要前后相同：`c596fc50a6de0a299383c7339a029987891334b8d2722ed9a1b244d6eac91e95` |
| 删除/切换只操作本工具拥有 fixture | reset 先验证精确 work-root marker；generation 激活/删除验证 marker、路径 containment、recipe/id；active 不可删；reparse point 被拒绝 | unowned switch/delete 被拒；owned inactive 可删；active 拒删；外部 sentinel 未变 |
| 公开证据不泄露本机用户路径 | 最终机器证据只保存稳定的仓库相对 locator；脚本自动扫描 README、报告和最终 JSON 中的当前账户名及 Windows 用户配置目录绝对路径 | `public_evidence_is_profile_path_sanitized` PASS |

## 故障注入结果

1. **构建中断**：在最终 generation 路径写入假 private Python 和 `state=building` manifest 后抛出受控异常。该 generation 保留用于诊断，但激活验证拒绝它，`gen-0001` 继续可解析。
2. **指针替换前中断**：完成并验证 `gen-0002`，将 `active.json.next` durable flush 后、`File.Replace` 前抛出受控异常。此时 `active.json` 仍解析到 `gen-0001`；重试后原子切到 `gen-0002`。
3. **负向 corpus**：静态 fixtures 覆盖 incomplete pointer、staging-origin manifest、unowned pointer。它们都不会覆盖真实 `active.json`。
4. **回切与删除**：验证并回切到 `gen-0001`；只删除拥有且 inactive 的 `gen-disposable`，拒绝删除 active 或 unowned generation。

## 一键验收与实际结果

从仓库根目录运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\prototypes\phase0\managed-core-layout\Invoke-ManagedCoreLayoutSpike.ps1
```

实际结果：

```text
RESULT 17/17 checks passed
```

连续运行两次后，`evidence/LAST_RUN.json` 的 SHA-256 都是：

```text
05793AF522C7F97B709ADE7556C04420BDFF531FD233C12E01286EF6C8C69AFB
```

因此该命令在相同主机能力状态下可重复，公开证据不再依赖 checkout 的绝对路径：它只在验证精确 ownership marker 后重置自己的 `work/` fixture，并生成相同机器可读结果。

## 产物

- `prototypes/phase0/managed-core-layout/Invoke-ManagedCoreLayoutSpike.ps1`：一键确定性布局、故障注入与验收。
- `prototypes/phase0/managed-core-layout/fixtures/negative/`：三项静态负向输入。
- `prototypes/phase0/managed-core-layout/fixtures/safety/outside-work.sentinel`：越界修改哨兵。
- `prototypes/phase0/managed-core-layout/evidence/LAST_RUN.json`：17 项已脱敏的机器可读 PASS 结果。
- `prototypes/phase0/managed-core-layout/.gitignore`：排除可重建且绑定本机绝对路径的 `/work/`。
- `prototypes/phase0/managed-core-layout/work/`：每次运行时可重建的本地检查树；由原型内 `.gitignore` 排除，不是待提交源码或公开证据产物。

## 未覆盖风险与后续门

- `File.Replace`/同卷 rename 的逻辑边界已验证，但本任务使用受控异常而不是 VM 强杀或断电；真实进程终止、写缓存与电源故障耐久性仍应由 P0-ARC-011/QA-014 验证。
- 未验证真实 Python venv、真实 ComfyUI 包或原生 wheel 对最终路径的绝对路径绑定；量产 materializer 仍需逐 artifact 证据。
- 未覆盖并发安装器、命名 mutex、磁盘满、ACL/杀软占用、长路径策略、设备路径/ADS/reparse corpus；这些属于后续 installer/QA 任务。
- 未实现 D 盘候选探测、容量预算、用户改路径 UI 或禁止静默 C 盘回退；本任务只能在获准的仓库 fixture 路径内写入。
- 该原型不构成真实 runtime 的供应链、签名、许可证或 SBOM 证明。

## 影响声明

- Schema/API：无修改。
- Registry/主计划/根 lockfile：无修改。
- 全局系统状态：无修改。
- 未新增生成模型、云 API、自动排队或内容创作逻辑。
