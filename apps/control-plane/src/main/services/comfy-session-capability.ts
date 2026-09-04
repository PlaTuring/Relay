import { setTimeout as delay } from "node:timers/promises";

import { ControlPlaneServiceError } from "./errors.js";

const COMFY_ORIGIN = "http://127.0.0.1:8188/" as const;
const COMFY_OBJECT_INFO_URL = new URL("object_info", COMFY_ORIGIN).toString();
const MAX_OBJECT_INFO_BYTES = 64 * 1024 * 1024;
const MAX_COMPILED_GRAPH_NODES = 512;
const MAX_COMPILED_SUBGRAPHS = 16;
const MAX_COMPILED_GRAPH_LINKS = MAX_COMPILED_GRAPH_NODES * 32;
const REQUEST_TIMEOUT_MS = 4_000;
const DEFAULT_ATTACH_RETRY_ATTEMPTS = 1;
const DEFAULT_POST_LAUNCH_ATTEMPTS = 120;
const DEFAULT_RETRY_DELAY_MS = 250;

interface ModelWidgetLock {
  readonly classType: string;
  readonly widgetName: string;
}

// These are ComfyUI class_type identifiers and their model-valued widgets.
// Node titles, localized labels and other display text are intentionally ignored.
const MODEL_WIDGET_LOCKS = Object.freeze([
  Object.freeze({ classType: "UNETLoader", widgetName: "unet_name" }),
  Object.freeze({ classType: "CLIPLoader", widgetName: "clip_name" }),
  Object.freeze({ classType: "VAELoader", widgetName: "vae_name" }),
  Object.freeze({ classType: "LoraLoaderModelOnly", widgetName: "lora_name" })
] satisfies readonly ModelWidgetLock[]);

const LOCK_BY_CLASS_TYPE = new Map<string, ModelWidgetLock>(
  MODEL_WIDGET_LOCKS.map((lock) => [lock.classType, lock] as const)
);

export interface RequiredComfyModel {
  readonly classType: string;
  readonly widgetName: string;
  readonly modelFileName: string;
}

export interface AssertComfySessionCapabilityOptions {
  readonly workflow: unknown;
  readonly launchIfUnavailable?: () => Promise<boolean>;
  readonly fetchImpl?: typeof fetch;
  readonly attachRetryAttempts?: number;
  readonly postLaunchAttempts?: number;
  readonly requestTimeoutMs?: number;
  readonly retryDelayMs?: number;
  readonly delayImpl?: (milliseconds: number) => Promise<void>;
}

type ObjectInfoResult =
  | { readonly state: "available"; readonly value: Record<string, unknown> }
  | { readonly state: "unreachable" }
  | { readonly state: "timeout" }
  | { readonly state: "invalid" };

interface CertifiedLink {
  readonly id: unknown;
  readonly originId: unknown;
  readonly originSlot: number;
  readonly targetId: unknown;
  readonly targetSlot: number;
  readonly type: string;
}

interface CertifiedGraph {
  readonly graph: Record<string, unknown>;
  readonly nodes: readonly Record<string, unknown>[];
  readonly nodeById: ReadonlyMap<unknown, Record<string, unknown>>;
  readonly links: readonly CertifiedLink[] | null;
  readonly linkById: ReadonlyMap<unknown, CertifiedLink>;
  readonly subgraphTurboMode: boolean | null;
  readonly boundaryWidgetValues: ReadonlyMap<string, string>;
}

const EMPTY_BOUNDARY_WIDGET_VALUES = new Map<string, string>();
const MODEL_BOUNDARY_WIDGET_NAMES = new Set([
  "unet_name",
  "clip_name",
  "vae_name",
  "vae_name_1",
  "lora_name"
]);

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function boundedPositiveInteger(value: number | undefined, fallback: number, maximum: number): number {
  return Number.isInteger(value) && value !== undefined && value > 0 && value <= maximum
    ? value
    : fallback;
}

function namedWidgetValue(node: Record<string, unknown>, lock: ModelWidgetLock): string | null {
  const named = record(node.widgets_values_named);
  const namedValue = named?.[lock.widgetName];
  if (typeof namedValue === "string" && namedValue.length > 0) return namedValue;

  // Also accept ComfyUI API-format graphs. The class_type and widget name are
  // still exact locked identifiers; no title/display-name fallback is allowed.
  if (node.class_type === lock.classType) {
    const inputs = record(node.inputs);
    const apiValue = inputs?.[lock.widgetName];
    if (typeof apiValue === "string" && apiValue.length > 0) return apiValue;
  }
  return null;
}

function certifiedNodeArray(value: unknown): readonly Record<string, unknown>[] | null {
  if (!Array.isArray(value) || value.length > MAX_COMPILED_GRAPH_NODES) return null;
  const nodes: Record<string, unknown>[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const node = record(value[index]);
    if (node === null) return null;
    nodes.push(node);
  }
  return nodes;
}

function normalizeLink(value: unknown): CertifiedLink | null {
  if (Array.isArray(value)) {
    if (value.length < 6 || !Number.isInteger(value[2]) || !Number.isInteger(value[4])
      || typeof value[5] !== "string") return null;
    return Object.freeze({
      id: value[0],
      originId: value[1],
      originSlot: value[2] as number,
      targetId: value[3],
      targetSlot: value[4] as number,
      type: value[5]
    });
  }
  const link = record(value);
  if (link === null || !Number.isInteger(link.origin_slot) || !Number.isInteger(link.target_slot)
    || typeof link.type !== "string") return null;
  return Object.freeze({
    id: link.id,
    originId: link.origin_id,
    originSlot: link.origin_slot as number,
    targetId: link.target_id,
    targetSlot: link.target_slot as number,
    type: link.type
  });
}

function certifiedLinks(value: unknown): readonly CertifiedLink[] | null {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > MAX_COMPILED_GRAPH_LINKS) return null;
  const links: CertifiedLink[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const link = normalizeLink(value[index]);
    if (link === null) return null;
    links.push(link);
  }
  return links;
}

function exactBooleanWidget(node: Record<string, unknown>, name: string): boolean | null {
  const named = record(node.widgets_values_named);
  const value = named?.[name];
  return typeof value === "boolean" ? value : null;
}

function linkedPrimitiveBooleanValue(
  graph: CertifiedGraph,
  call: Record<string, unknown>,
  input: Record<string, unknown>,
  targetSlot: number
): boolean | null {
  if (call.id === undefined || input.link === null || input.link === undefined) return null;
  const inbound = graph.links?.filter((link) => (
    link.targetId === call.id && link.targetSlot === targetSlot
  ));
  if (inbound?.length !== 1) return null;
  const link = inbound[0];
  if (link === undefined || link.id !== input.link || link.type !== "BOOLEAN" || link.originSlot !== 0) return null;

  const source = graph.nodeById.get(link.originId);
  if (source?.type !== "PrimitiveBoolean" || source.mode !== 0
    || !Array.isArray(source.inputs) || source.inputs.length !== 0
    || !Array.isArray(source.outputs) || source.outputs.length !== 1) return null;
  const output = record(source.outputs[0]);
  if (output?.type !== "BOOLEAN" || !Array.isArray(output.links)
    || output.links.length === 0 || output.links.length > MAX_COMPILED_GRAPH_LINKS) return null;
  const outputLinkIds = new Set<unknown>();
  for (const outputLinkId of output.links) {
    if (outputLinkIds.has(outputLinkId)) return null;
    outputLinkIds.add(outputLinkId);
  }
  const outgoing = graph.links?.filter((candidate) => candidate.originId === source.id);
  if (outgoing === undefined || outgoing.length !== outputLinkIds.size
    || outgoing.some((candidate) => (
      candidate.originSlot !== 0
      || candidate.type !== "BOOLEAN"
      || !outputLinkIds.has(candidate.id)
    ))) return null;

  const value = exactBooleanWidget(source, "value");
  return value !== null && exactBooleanWidget(call, "value") === value ? value : null;
}

function subgraphCallTurboMode(
  parentGraph: CertifiedGraph,
  subgraph: Record<string, unknown>
): boolean | null {
  if (typeof subgraph.id !== "string" || !Array.isArray(subgraph.inputs)) return null;
  const boundaryInputs = subgraph.inputs;
  if (boundaryInputs.length > MAX_COMPILED_GRAPH_NODES) return null;
  let boundaryIndex = -1;
  for (let index = 0; index < boundaryInputs.length; index += 1) {
    const input = record(boundaryInputs[index]);
    if (input?.name === "value" && input.type === "BOOLEAN") {
      if (boundaryIndex !== -1) return null;
      boundaryIndex = index;
    }
  }
  if (boundaryIndex < 0) return null;

  let resolved: boolean | null = null;
  let foundCall = false;
  for (const call of parentGraph.nodes) {
    if (call.type !== subgraph.id) continue;
    foundCall = true;
    if (call.mode !== 0 || !Array.isArray(call.inputs)
      || call.inputs.length > MAX_COMPILED_GRAPH_NODES) return null;
    let targetSlot = -1;
    let input: Record<string, unknown> | null = null;
    for (let index = 0; index < call.inputs.length; index += 1) {
      const candidate = record(call.inputs[index]);
      if (candidate?.name !== "value" || candidate.type !== "BOOLEAN") continue;
      if (input !== null) return null;
      input = candidate;
      targetSlot = index;
    }
    if (input === null || record(input.widget)?.name !== "value") return null;
    const mode = input.link === null
      ? exactBooleanWidget(call, "value")
      : linkedPrimitiveBooleanValue(parentGraph, call, input, targetSlot);
    if (mode === null) return null;
    if (resolved !== null && resolved !== mode) return null;
    resolved = mode;
  }
  return foundCall ? resolved : null;
}

function buildCertifiedGraph(
  graph: Record<string, unknown>,
  nodes: readonly Record<string, unknown>[],
  subgraphTurboMode: boolean | null,
  boundaryWidgetValues: ReadonlyMap<string, string> = EMPTY_BOUNDARY_WIDGET_VALUES
): CertifiedGraph | null {
  const links = certifiedLinks(graph.links);
  if (links === null) return null;
  const nodeById = new Map<unknown, Record<string, unknown>>();
  for (const node of nodes) {
    if (node.id !== undefined) {
      if (nodeById.has(node.id)) return null;
      nodeById.set(node.id, node);
    }
  }
  const linkById = new Map<unknown, CertifiedLink>();
  for (const link of links) {
    if (linkById.has(link.id)) return null;
    linkById.set(link.id, link);
  }
  return Object.freeze({ graph, nodes, nodeById, links, linkById, subgraphTurboMode, boundaryWidgetValues });
}

function subgraphBoundaryWidgetValues(
  parentGraph: CertifiedGraph,
  subgraph: Record<string, unknown>
): ReadonlyMap<string, string> | null {
  if (typeof subgraph.id !== "string" || !Array.isArray(subgraph.inputs)) {
    return EMPTY_BOUNDARY_WIDGET_VALUES;
  }
  const calls = parentGraph.nodes.filter((node) => node.type === subgraph.id);
  if (calls.length === 0) return EMPTY_BOUNDARY_WIDGET_VALUES;
  const result = new Map<string, string>();
  for (const candidate of subgraph.inputs) {
    const boundary = record(candidate);
    if (typeof boundary?.name !== "string" || !MODEL_BOUNDARY_WIDGET_NAMES.has(boundary.name)) continue;
    let resolved: string | null = null;
    for (const call of calls) {
      if (call.mode !== 0) return null;
      const named = record(call.widgets_values_named);
      const value = named?.[boundary.name];
      if (typeof value !== "string" || value.length === 0 || (resolved !== null && resolved !== value)) return null;
      resolved = value;
    }
    if (resolved === null) return null;
    result.set(boundary.name, resolved);
  }
  return result;
}

function collectCertifiedGraphs(workflow: unknown): readonly CertifiedGraph[] | null {
  const root = record(workflow);
  if (root === null) return null;
  const graphs: CertifiedGraph[] = [];
  const visited = new Set<object>();
  let subgraphCount = 0;

  const visitUiGraph = (
    graph: Record<string, unknown>,
    turboMode: boolean | null,
    boundaryWidgetValues: ReadonlyMap<string, string> = EMPTY_BOUNDARY_WIDGET_VALUES
  ): boolean => {
    if (visited.has(graph)) return false;
    visited.add(graph);
    const nodes = certifiedNodeArray(graph.nodes);
    if (nodes === null) return false;
    const certified = buildCertifiedGraph(graph, nodes, turboMode, boundaryWidgetValues);
    if (certified === null) return false;
    graphs.push(certified);

    if (graph.definitions === undefined) return true;
    const definitions = record(graph.definitions);
    if (definitions === null || !Array.isArray(definitions.subgraphs)
      || definitions.subgraphs.length > MAX_COMPILED_SUBGRAPHS) return false;
    for (let index = 0; index < definitions.subgraphs.length; index += 1) {
      subgraphCount += 1;
      if (subgraphCount > MAX_COMPILED_SUBGRAPHS) return false;
      const subgraph = record(definitions.subgraphs[index]);
      if (subgraph === null) return false;
      const mode = subgraphCallTurboMode(certified, subgraph);
      const values = subgraphBoundaryWidgetValues(certified, subgraph);
      if (values === null || !visitUiGraph(subgraph, mode, values)) return false;
    }
    return true;
  };

  if (root.nodes !== undefined) return visitUiGraph(root, null) ? Object.freeze(graphs) : null;

  // ComfyUI API-format graphs are a flat root map keyed by node id. Do not
  // recurse into metadata or arbitrary values: only direct class_type records
  // are certified nodes, and the same compiler node budget applies.
  const apiNodes: Record<string, unknown>[] = [];
  let rootEntryCount = 0;
  for (const key in root) {
    if (!Object.hasOwn(root, key)) continue;
    rootEntryCount += 1;
    if (rootEntryCount > MAX_COMPILED_GRAPH_NODES) return null;
    const candidate = record(root[key]);
    if (candidate !== null && typeof candidate.class_type === "string") apiNodes.push(candidate);
  }
  return Object.freeze([Object.freeze({
    graph: root,
    nodes: Object.freeze(apiNodes),
    nodeById: new Map<unknown, Record<string, unknown>>(),
    links: Object.freeze([]),
    linkById: new Map<unknown, CertifiedLink>(),
    subgraphTurboMode: null,
    boundaryWidgetValues: EMPTY_BOUNDARY_WIDGET_VALUES
  })]);
}

function inputAt(node: Record<string, unknown>, index: number): Record<string, unknown> | null {
  return Array.isArray(node.inputs) ? record(node.inputs[index]) : null;
}

const INVALID_MODEL_VALUE = Symbol("invalid-model-value");

function effectiveModelWidgetValue(
  graph: CertifiedGraph,
  node: Record<string, unknown>,
  lock: ModelWidgetLock
): string | null | typeof INVALID_MODEL_VALUE {
  if (node.id !== undefined && Array.isArray(node.inputs)) {
    for (let index = 0; index < node.inputs.length; index += 1) {
      const input = record(node.inputs[index]);
      if (input === null) continue;
      const widget = record(input?.widget);
      if (input.name !== lock.widgetName && widget?.name !== lock.widgetName) continue;
      if (input.link === null || input.link === undefined) break;
      const link = graph.linkById.get(input.link);
      const boundaryInputs = Array.isArray(graph.graph.inputs) ? graph.graph.inputs : null;
      if (link?.targetId !== node.id || link.targetSlot !== index || link.originId !== -10
        || boundaryInputs === null || link.originSlot < 0 || link.originSlot >= boundaryInputs.length) {
        return INVALID_MODEL_VALUE;
      }
      const boundary = record(boundaryInputs[link.originSlot]);
      const effective = typeof boundary?.name === "string"
        ? graph.boundaryWidgetValues.get(boundary.name)
        : undefined;
      return typeof effective === "string" && effective.length > 0 ? effective : INVALID_MODEL_VALUE;
    }
  }
  return namedWidgetValue(node, lock);
}

function inactiveTurboLora(graph: CertifiedGraph, lora: Record<string, unknown>): boolean {
  if (graph.links === null || lora.id === undefined || lora.mode !== 0) return false;
  const loraOutputLinks = graph.links.filter((link) => link.originId === lora.id);
  if (loraOutputLinks.length !== 1) return false;
  const loraBranchLink = loraOutputLinks.at(0);
  if (loraBranchLink === undefined || loraBranchLink.originSlot !== 0
    || loraBranchLink.targetSlot !== 1 || loraBranchLink.type !== "MODEL") return false;
  const switchNode = graph.nodeById.get(loraBranchLink.targetId);
  if (switchNode?.type !== "ComfySwitchNode" || switchNode.mode !== 0) return false;
  const onFalse = inputAt(switchNode, 0);
  const onTrue = inputAt(switchNode, 1);
  const control = inputAt(switchNode, 2);
  if (onFalse?.name !== "on_false" || onFalse.type !== "MODEL"
    || onTrue?.name !== "on_true" || onTrue.type !== "MODEL"
    || control?.name !== "switch" || control.type !== "BOOLEAN"
    || onTrue.link !== loraBranchLink.id) return false;

  const falseLink = graph.linkById.get(onFalse.link);
  const controlLink = graph.linkById.get(control.link);
  if (falseLink === undefined || controlLink === undefined) return false;
  const loraModelInput = inputAt(lora, 0);
  const loraModelLink = graph.linkById.get(loraModelInput?.link);
  if (loraModelLink === undefined) return false;
  const baseLoader = graph.nodeById.get(falseLink.originId);
  if (falseLink.targetId !== switchNode.id || falseLink.originSlot !== 0
    || falseLink.targetSlot !== 0 || falseLink.type !== "MODEL"
    || baseLoader?.type !== "UNETLoader" || baseLoader.mode !== 0
    || loraModelInput?.name !== "model" || loraModelInput.type !== "MODEL"
    || loraModelLink.originId !== falseLink.originId || loraModelLink.originSlot !== 0
    || loraModelLink.targetId !== lora.id
    || loraModelLink.targetSlot !== 0 || loraModelLink.type !== "MODEL"
    || controlLink.targetId !== switchNode.id || controlLink.originSlot !== 0
    || controlLink.targetSlot !== 2
    || controlLink.type !== "BOOLEAN") return false;
  const booleanNode = graph.nodeById.get(controlLink.originId);
  if (booleanNode?.type !== "PrimitiveBoolean" || booleanNode.mode !== 0) return false;

  const booleanInput = inputAt(booleanNode, 0);
  if (booleanInput !== null && booleanInput.link !== null && booleanInput.link !== undefined) {
    const boundaryLink = graph.linkById.get(booleanInput.link);
    const subgraphInputs = Array.isArray(graph.graph.inputs) ? graph.graph.inputs : null;
    if (boundaryLink?.originId !== -10 || boundaryLink.targetId !== booleanNode.id
      || boundaryLink.targetSlot !== 0 || boundaryLink.type !== "BOOLEAN"
      || subgraphInputs === null || boundaryLink.originSlot < 0
      || boundaryLink.originSlot >= subgraphInputs.length) return false;
    const boundaryInput = record(subgraphInputs[boundaryLink.originSlot]);
    if (boundaryInput?.name !== "value" || boundaryInput.type !== "BOOLEAN"
      || !Array.isArray(boundaryInput.linkIds) || !boundaryInput.linkIds.includes(boundaryLink.id)) return false;
    return graph.subgraphTurboMode === false;
  }

  return exactBooleanWidget(booleanNode, "value") === false;
}

export function collectRequiredComfyModels(workflow: unknown): readonly RequiredComfyModel[] {
  const found = new Map<string, RequiredComfyModel>();
  const graphs = collectCertifiedGraphs(workflow);
  if (graphs === null) return Object.freeze([]);
  for (const graph of graphs) {
    for (const node of graph.nodes) {
      const classType = typeof node.class_type === "string"
        ? node.class_type
        : typeof node.type === "string"
          ? node.type
          : null;
      const lock = classType === null ? undefined : LOCK_BY_CLASS_TYPE.get(classType);
      if (lock === undefined || (lock.classType === "LoraLoaderModelOnly" && inactiveTurboLora(graph, node))) {
        continue;
      }
      const modelFileName = effectiveModelWidgetValue(graph, node, lock);
      if (modelFileName === INVALID_MODEL_VALUE) return Object.freeze([]);
      if (modelFileName === null) continue;
      const key = `${lock.classType}\u0000${lock.widgetName}\u0000${modelFileName}`;
      found.set(key, Object.freeze({
        classType: lock.classType,
        widgetName: lock.widgetName,
        modelFileName
      }));
    }
  }
  return Object.freeze([...found.values()].sort((left, right) =>
    left.classType.localeCompare(right.classType, "en") ||
    left.widgetName.localeCompare(right.widgetName, "en") ||
    left.modelFileName.localeCompare(right.modelFileName, "en")
  ));
}

function comboValues(
  objectInfo: Record<string, unknown>,
  requirement: RequiredComfyModel
): readonly string[] | null {
  const nodeInfo = record(objectInfo[requirement.classType]);
  const input = record(nodeInfo?.input);
  for (const groupName of ["required", "optional"] as const) {
    const group = record(input?.[groupName]);
    const spec = group?.[requirement.widgetName];
    if (!Array.isArray(spec) || !Array.isArray(spec[0])) continue;
    if (spec[0].every((value) => typeof value === "string")) return spec[0] as string[];
  }
  return null;
}

async function readObjectInfo(
  fetchImpl: typeof fetch,
  requestTimeoutMs: number
): Promise<ObjectInfoResult> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, requestTimeoutMs);
  try {
    let response: Response;
    try {
      response = await fetchImpl(COMFY_OBJECT_INFO_URL, {
        method: "GET",
        headers: Object.freeze({ Accept: "application/json" }),
        redirect: "error",
        signal: controller.signal
      });
    } catch {
      return Object.freeze({ state: timedOut ? "timeout" : "unreachable" });
    }
    if (!response.ok) return Object.freeze({ state: "invalid" });

    const declaredLengthHeader = response.headers.get("content-length");
    if (declaredLengthHeader !== null) {
      if (!/^\d+$/u.test(declaredLengthHeader)) return Object.freeze({ state: "invalid" });
      const declaredLength = Number(declaredLengthHeader);
      if (!Number.isSafeInteger(declaredLength) || declaredLength > MAX_OBJECT_INFO_BYTES) {
        return Object.freeze({ state: "invalid" });
      }
    }

    if (response.body === null) return Object.freeze({ state: "invalid" });
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        received += chunk.value.byteLength;
        if (received > MAX_OBJECT_INFO_BYTES) {
          controller.abort();
          await reader.cancel().catch(() => undefined);
          return Object.freeze({ state: "invalid" });
        }
        chunks.push(chunk.value);
      }
    } catch {
      return Object.freeze({ state: timedOut ? "timeout" : "invalid" });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.concat(chunks, received).toString("utf8")) as unknown;
    } catch {
      return Object.freeze({ state: "invalid" });
    }
    const parsedRecord = record(parsed);
    return parsedRecord === null
      ? Object.freeze({ state: "invalid" })
      : Object.freeze({ state: "available", value: parsedRecord });
  } finally {
    clearTimeout(timeout);
  }
}

type ObjectInfoFailure = Exclude<ObjectInfoResult, { readonly state: "available" }>;

function stopHandoff(message: string, recovery: string): never {
  throw new ControlPlaneServiceError(
    "INSTALLATION_NOT_READY",
    `${message} ${recovery} Relay 已停止本次交接，也没有提交运行任务。`
  );
}

function failObjectInfoRead(result: ObjectInfoFailure, launched: boolean): never {
  const prefix = launched ? "新启动的 ComfyUI 会话" : "当前 ComfyUI 会话";
  if (result.state === "timeout") {
    stopHandoff(
      `COMFY_SESSION_TIMEOUT：${prefix}在固定地址 127.0.0.1:8188 的节点能力检查响应超时。`,
      "ComfyUI 可能正在启动或繁忙，请稍候后重试；如持续出现，请保存 ComfyUI 中的工作后重启 ComfyUI。"
    );
  }
  if (result.state === "unreachable") {
    stopHandoff(
      `COMFY_SESSION_UNREACHABLE：${prefix}在本机固定地址 127.0.0.1:8188 不可达，无法完成节点能力验证。`,
      "请确认 ComfyUI 已启动并监听该地址；如刚启动，请稍候后重试。"
    );
  }
  stopHandoff(
    `COMFY_SESSION_PROTOCOL_INVALID：${prefix}返回了无效或不兼容的节点能力信息。`,
    "请保存 ComfyUI 中的工作后重启 ComfyUI，再重新编译导入。"
  );
}

function restartRequired(message: string): never {
  throw new ControlPlaneServiceError(
    "INSTALLATION_NOT_READY",
    `${message} 请保存 ComfyUI 中的工作后重启 ComfyUI，再重新编译导入；Relay 已停止本次交接，也没有提交运行任务。`
  );
}

function proveRequirements(
  requirements: readonly RequiredComfyModel[],
  objectInfo: Record<string, unknown>
): void {
  const missingClasses = new Set<string>();
  const missingModels = new Set<string>();
  for (const requirement of requirements) {
    const choices = comboValues(objectInfo, requirement);
    if (choices === null) {
      missingClasses.add(`${requirement.classType}.${requirement.widgetName}`);
    } else if (!choices.includes(requirement.modelFileName)) {
      missingModels.add(requirement.modelFileName);
    }
  }
  if (missingClasses.size > 0) {
    restartRequired(`当前 ComfyUI 会话未加载工作流要求的官方节点能力：${[...missingClasses].join("、")}。`);
  }
  if (missingModels.size > 0) {
    restartRequired(`当前 ComfyUI 会话尚未识别工作流要求的模型：${[...missingModels].join("、")}。`);
  }
}

export async function assertComfySessionSupportsWorkflow(
  options: AssertComfySessionCapabilityOptions
): Promise<readonly RequiredComfyModel[]> {
  const requirements = collectRequiredComfyModels(options.workflow);
  if (requirements.length === 0) {
    restartRequired("工作流中没有可验证的官方模型加载器，无法证明当前 ComfyUI 会话具备所需能力。");
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const requestTimeoutMs = boundedPositiveInteger(
    options.requestTimeoutMs,
    REQUEST_TIMEOUT_MS,
    15_000
  );
  const retryDelayMs = boundedPositiveInteger(
    options.retryDelayMs,
    DEFAULT_RETRY_DELAY_MS,
    5_000
  );
  const delayImpl = options.delayImpl ?? (async (milliseconds: number) => {
    await delay(milliseconds);
  });
  let result = await readObjectInfo(fetchImpl, requestTimeoutMs);
  if (result.state === "available") {
    proveRequirements(requirements, result.value);
    return requirements;
  }
  if (result.state === "invalid") {
    failObjectInfoRead(result, false);
  }

  const attachRetryAttempts = boundedPositiveInteger(
    options.attachRetryAttempts,
    DEFAULT_ATTACH_RETRY_ATTEMPTS,
    4
  );
  for (let attempt = 0; attempt < attachRetryAttempts; attempt += 1) {
    await delayImpl(retryDelayMs);
    result = await readObjectInfo(fetchImpl, requestTimeoutMs);
    if (result.state === "available") {
      proveRequirements(requirements, result.value);
      return requirements;
    }
    if (result.state === "invalid") failObjectInfoRead(result, false);
  }

  const launched = await options.launchIfUnavailable?.() ?? false;
  if (!launched) failObjectInfoRead(result, false);

  const attempts = boundedPositiveInteger(
    options.postLaunchAttempts,
    DEFAULT_POST_LAUNCH_ATTEMPTS,
    240
  );
  let timeoutFailures = 0;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await delayImpl(retryDelayMs);
    result = await readObjectInfo(fetchImpl, requestTimeoutMs);
    if (result.state === "available") {
      proveRequirements(requirements, result.value);
      return requirements;
    }
    if (result.state === "invalid") {
      failObjectInfoRead(result, true);
    }
    if (result.state === "timeout") {
      timeoutFailures += 1;
      if (timeoutFailures >= 2) failObjectInfoRead(result, true);
    }
  }
  if (result.state === "timeout") failObjectInfoRead(result, true);
  failObjectInfoRead(Object.freeze({ state: "unreachable" }), true);
}
