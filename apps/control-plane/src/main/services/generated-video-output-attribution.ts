import { createHash, randomUUID } from "node:crypto";

const PROJECT_ID = /^project-[a-z0-9][a-z0-9-]{7,127}$/u;
const WORKFLOW_ID = /^workflow-[a-z0-9][a-z0-9-]{7,127}$/u;

export interface WorkflowOutputAttributionInput {
  readonly projectId: string;
  readonly workflowId: string;
}

export interface WorkflowOutputAttribution {
  readonly schema_version: "1.0.0";
  readonly project_id: string;
  readonly workflow_id: string;
  readonly project_token: string;
  readonly workflow_token: string;
  readonly output_prefix: string;
}

function shortToken(namespace: "project" | "workflow", stableId: string): string {
  return createHash("sha256")
    .update(Buffer.from(`relay-generated-video-v1\0${namespace}\0${stableId}`, "utf8"))
    .digest("hex")
    .slice(0, 16);
}

export function allocateWorkflowId(createId: () => string = randomUUID): string {
  if (typeof createId !== "function") throw new TypeError("Workflow identity allocator is invalid.");
  const value = createId();
  if (typeof value !== "string") throw new TypeError("Workflow identity allocator returned an invalid value.");
  const workflowId = `workflow-${value.replaceAll("-", "").toLocaleLowerCase("en-US")}`;
  if (!WORKFLOW_ID.test(workflowId)) throw new TypeError("Workflow identity allocator returned an invalid value.");
  return workflowId;
}

export function createWorkflowOutputAttribution(
  input: WorkflowOutputAttributionInput
): WorkflowOutputAttribution {
  if (input === null || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).sort().join(",") !== "projectId,workflowId"
    || !PROJECT_ID.test(input.projectId) || !WORKFLOW_ID.test(input.workflowId)) {
    throw new TypeError("Output attribution requires exact stable project and workflow IDs.");
  }
  const projectToken = shortToken("project", input.projectId);
  const workflowToken = shortToken("workflow", input.workflowId);
  return Object.freeze({
    schema_version: "1.0.0",
    project_id: input.projectId,
    workflow_id: input.workflowId,
    project_token: projectToken,
    workflow_token: workflowToken,
    output_prefix: `video/Relay/p_${projectToken}/w_${workflowToken}/Relay_H3`,
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Mutates only the unique SaveVideo filename binding and bounded workflow metadata. */
export function applyWorkflowOutputAttribution(
  workflow: unknown,
  input: WorkflowOutputAttributionInput
): WorkflowOutputAttribution {
  const root = record(workflow);
  if (root === null || !Array.isArray(root.nodes)) throw new TypeError("A compiled visual workflow is required.");
  const nodes = root.nodes.map(record).filter((entry): entry is Record<string, unknown> => entry !== null);
  const saves = nodes.filter((node) => node.type === "SaveVideo");
  if (saves.length !== 1) throw new TypeError("Compiled workflow must contain exactly one SaveVideo node.");
  const save = saves[0]!;
  const named = record(save.widgets_values_named);
  if (!Array.isArray(save.widgets_values) || save.widgets_values.length < 1
    || named === null || !Object.hasOwn(named, "filename_prefix")) {
    throw new TypeError("SaveVideo filename binding is invalid.");
  }
  const attribution = createWorkflowOutputAttribution(input);
  save.widgets_values[0] = attribution.output_prefix;
  named.filename_prefix = attribution.output_prefix;
  const extra = record(root.extra) ?? {};
  root.extra = extra;
  extra.relay_output_attribution = { ...attribution };
  return attribution;
}

export const GENERATED_VIDEO_PROJECT_ID_PATTERN = PROJECT_ID;
export const GENERATED_VIDEO_WORKFLOW_ID_PATTERN = WORKFLOW_ID;
