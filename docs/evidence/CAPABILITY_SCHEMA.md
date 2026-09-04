# P0-CON-002：Capability catalog 与本地节点 allowlist 合同证据

## 1. 结论与边界

本任务已建立两个 Draft 2020-12 immutable-authority 合同及离线 conformance corpus：

- `minimax-h3-tool.capability-catalog@1.0.0`：只记录证据、发布状态和独立 capability gates；
- `minimax-h3-tool.node-allowlist@1.0.0`：只允许 locked ComfyUI Core revision 中 `class_type + input/output/combined schema fingerprints + origin + local/API flags` 全部精确相等的本地节点。

工具边界没有扩大。合同只支持安装、检测、配置、工作流编译和交接。它不生成音视频，不下载/加载模型，不启动 ComfyUI/H3，不调用云/Partner API，也不提交 `/prompt`；MiniMax H3 仍只在用户于 ComfyUI 点击 Run 后生成实际视频和原生音频。

失败回退固定为 unavailable：display name、loose version、未知节点、Partner/API 节点、schema drift、stale cross-document hash、缺 gate、未知 operational field、inferred/experimental Stable 宣称或非 active Stable 宣称均不能授权工作流编译。

## 2. 锁定输入与可复现 fingerprints

本任务只读取 Root-accepted ADR-004 和 P0-WF-001 快照，未联网重新发现上游：

| Authority | Exact identity |
|---|---|
| P0-WF-001 snapshot raw bytes | `sha256:d123836a883573ad5bd957935af11ab5b8812bd2ad3f12bc21e0c50ae89b3bfd` |
| ComfyUI Core | `d8e7bbc9d586d95f758d6b0ed23d519088be578a` |
| MiniMax H3 Hugging Face | `42ed227ee7df40d41602854ae760620d6eb651fe` |
| capability schema JCS | `sha256:e3ec4c0c1cefbec0ac4f0bf7d1853c125b02521f617dd581506ee77b8441d12d` |
| node allowlist schema JCS | `sha256:831cdae6677c2d735844245fade720f13e9b8717c41bda25f0626319d88a7b48` |

P0-WF-001 已给出 combined descriptor fingerprints。本任务从同一 accepted descriptor 用其 `sha256-c14n-json-sort-keys-v1` 规则确定性派生两个更小投影：

```text
input  = sha256(c14n({required_inputs, optional_inputs, hidden_inputs}))
output = sha256(c14n({outputs}))
```

allowlist schema 同时固定 input、output、combined 三个值，不能用其中一个替代另两个。当前七个 source-proven local classes 均已编码：`EmptyMiniMaxH3LatentAV`、`MiniMaxH3ImageToVideo`、`MiniMaxH3AddGuide`、`MiniMaxH3ReferenceToVideo`、`MiniMaxH3SigmaShift`、`CreateVideo`、`SaveVideo`。Alpha-0 T2VA fixture 只选择其中实际需要的四个：`MiniMaxH3ImageToVideo`、`MiniMaxH3SigmaShift`、`CreateVideo`、`SaveVideo`。

九个 P0-WF-001 Partner/API classes 已作为 explicit deny regression seed 固定；该 seed 不是 allowlist 的反面。任何不在七个 exact local identities 中的 class 均按 unknown fail closed，即使显示名与本地节点完全相同。

## 3. 独立 gating 与 Stable 规则

每个 capability 必须分别包含以下五个 feature gate，不能由一个总状态代替：

1. `route`：`t2va/i2va/l2va/fl2va/ref2va`；
2. `duration`：请求秒数与有理数 frame rate；
3. `prompt`：明确记录是否允许 empty prompt；
4. `endpoint`：`none/first/last/first_last`；
5. `audio`：native-audio requirement、sample rate、channel count。

硬件、runtime、license 也是三个独立 prerequisite gates。每个 gate 同时带 `evidence_status`、`readiness`、deterministic `reason_code` 和 evidence references。`evidence_status` 的 authority 词汇是 `proven/inferred/experimental/blocked`；产品 readiness 是 `passed/poc_pending/experimental/blocked`，二者不得混用。

`publication_status: stable` 只有在 capability evidence 为 `proven`、全部八个 gates 都是 proven + passed、capability/catalog authority active、node allowlist exact reference 未漂移且所有 required classes 都存在于 active allowlist 时才可能行动。revoked/superseded capability 必须显示为 `blocked`；revocation record 可继续读取和审计，但不能执行。

有效 Alpha-0 T2VA fixture 故意保持 `poc_pending`：source surface 是 proven，但 live object-info、GPU output、5-second frame/audio behavior、hardware matrix、model/runtime verification、H3/Comfy/codec license approval 均未在本任务证明。fixture 只证明合同 shape 与 fail-closed semantics，不把 Alpha-0 宣称为可运行 Stable 配方。

## 4. ADR-004 落点

- root envelope 使用 exact `contract_id/schema_version/document_id/document_revision=1`；
- 两份 authority document 均为 immutable，新内容、新 supersession 或 revocation 产生新 document，不原位修改；
- cross-document node allowlist reference 绑定 schema digest、document ID、revision 和 JCS content hash；
- root logical integrity 使用 RFC 8785 JCS，计算时移除整个 root `integrity`；
- core objects closed，unknown operational field fail closed；
- 唯一 forward-safe 通道是 bounded reverse-DNS extension，且 exact `effect: display_metadata`；
- 每个 concrete property 均带 `x-sensitive` 和有序 `x-trust-impact`；
- 每个 schema constraint 均直接带唯一、稳定的 `x-error-code/x-rule-id`，lint 会拒绝缺失或重复；domain normalizer 对安全关键规则输出更具体的稳定三元组；
- JSON parser 拒绝 BOM、非法 UTF-8、重复 key、非整数/unsafe integer、超出 ADR-004 ceilings 的输入；
- schema `$ref` 全部是 exact local fragment，不发生网络解析；
- deterministic domain error 使用 ADR-004 的 `(code, instance_path, rule_id)`。

## 5. Fixture coverage

完整 valid contracts 位于 `tests/fixtures/contracts/capability/valid/`。负例采用受限 JSON-Pointer mutation，mutation 后重算 root integrity，因此不会同时制造无关的 integrity error。

| Case | Expected exact rule |
|---|---|
| inferred capability exposed as Stable | `CAPABILITY.STABLE_REQUIRES_PROVEN` |
| display-name collision/decoy | `NODE.DISPLAY_NAME_COLLISION` |
| same class, input schema drift | `NODE.INPUT_SCHEMA_DRIFT` |
| same class, output schema drift | `NODE.OUTPUT_SCHEMA_DRIFT` |
| stale combined fingerprint | `NODE.COMBINED_SCHEMA_DRIFT` |
| explicit Partner/API class | `NODE.PARTNER_API_FORBIDDEN` |
| unknown class | `NODE.UNKNOWN_CLASS_TYPE` |
| missing license prerequisite | `CAPABILITY.GATE_REQUIRED` at `/prerequisites/license` |
| missing hardware prerequisite | `CAPABILITY.GATE_REQUIRED` at `/prerequisites/hardware` |
| missing route/duration/prompt/endpoint/audio | five distinct `CAPABILITY.GATE_REQUIRED` rule IDs |
| unknown execution-affecting field | `CONTRACT.UNKNOWN_FIELD` |
| stale allowlist document hash | `CAPABILITY.ALLOWLIST_REFERENCE_STALE` |
| revoked capability presented as Stable | `CAPABILITY.NONACTIVE_MUST_BE_BLOCKED` |
| display-only forward metadata | valid and integrity-covered |
| revoked capability retained as blocked audit record | valid but non-actionable |

## 6. Acceptance command and result

Run from repository root:

```text
node tests/fixtures/contracts/capability/validate.mjs
```

Accepted result:

```text
PASS schema capability-catalog sha256:e3ec4c0c1cefbec0ac4f0bf7d1853c125b02521f617dd581506ee77b8441d12d
PASS schema node-allowlist sha256:831cdae6677c2d735844245fade720f13e9b8717c41bda25f0626319d88a7b48
PASS valid alpha0-local-node-allowlist
PASS valid alpha0-t2va-capability
SUMMARY schemas=2 valid_contracts=2 negative_cases=17 valid_mutation_cases=2
```

Two consecutive executions produced identical normalized stdout, `sha256:f4054d4fc17b835393efef602d70c7006b675def24416dfb36ec39544052a32e`, and each scanned 28 public artifacts. The command uses Node built-ins only. It strict-parses JSON, checks the exact Draft/schema identities, per-constraint error annotations and trust annotations, validates positive documents with the subset of Draft 2020-12 keywords used by these schemas, runs domain/cross-document invariants, compares every negative case to one exact error tuple, and scans public artifacts for a current username or private Windows user path. It does not execute input as code.

## 7. Evidence classification and remaining gates

### Proven in this task

- both schema files parse, use exact immutable `$id`, and close core objects;
- the accepted P0-WF-001 node descriptors reproduce all stored split/combined fingerprints;
- Alpha-0 valid authority documents pass schema, integrity, exact identity and cross-document checks;
- all required negative/positive mutation cases produce deterministic outcomes;
- route, duration, empty-prompt policy, endpoint policy, audio, hardware, runtime and license are independently representable and independently required;
- Partner/API, unknown identity and display-name authorization are fail closed;
- public contract evidence contains no private user path or current username.

### Derived, not a live-runtime claim

- input/output fingerprints are deterministic projections of the accepted source snapshot. They have not yet been compared to a selected live `/api/object_info` response;
- the compact fixture evaluator implements only the JSON Schema keywords used here. It is evidence for this corpus, not a replacement for the production validator or cross-language equivalence tests.

### Still blocked or `poc_pending`

- live Managed Core object-info normalization and exact fingerprint match;
- H3 model file verification, hardware selection, GPU generation, 5/10/15-second output, empty prompt, endpoint preservation and native-audio output;
- H3, Comfy distribution and codec legal approvals;
- generated visual/API graph lint/equivalence and ComfyUI handoff;
- cross-language RFC 8785/parser/error equivalence and hostile-input corpus in P0-CON-012.

No schema, fixture or validator result may promote these items.

## 8. Contract impact and downstream readiness

Created only the P0-CON-002 schema families, fixtures and this evidence file. No registry, root plan, unrelated schema, root lockfile or product implementation was changed; no dependency was added.

This contract is ready for Root review and, once accepted, provides the required input to P0-CON-004 (recipe/catalog binding), P0-CON-010 (workflow graph allowlist/lint) and P0-CON-012 (cross-contract and cross-language mismatch corpus). Consumers must bind the exact schema JCS digests above; they must not use `latest`, version lower bounds, display labels or permissive fallback.
