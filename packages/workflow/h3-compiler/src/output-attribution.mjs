import { randomUUID } from "node:crypto";
import { sha256Bytes } from "./canonical.mjs";
import { fail } from "./errors.mjs";

const PROJECT_ID = /^project-[a-z0-9][a-z0-9-]{7,127}$/u;
const WORKFLOW_ID = /^workflow-[a-z0-9][a-z0-9-]{7,127}$/u;
const TOKEN = /^[a-f0-9]{16}$/u;

function shortToken(namespace, stableId) {
  return sha256Bytes(Buffer.from(`relay-generated-video-v1\0${namespace}\0${stableId}`, "utf8")).slice(0, 16);
}

export function allocateWorkflowId(createId = randomUUID) {
  if (typeof createId !== "function") {
    fail("COMPILER.WORKFLOW_ID", "Workflow identity allocator is invalid.", "/output_attribution/workflow_id");
  }
  const value = createId();
  if (typeof value !== "string") {
    fail("COMPILER.WORKFLOW_ID", "Workflow identity allocator returned an invalid value.", "/output_attribution/workflow_id");
  }
  const compact = value.replaceAll("-", "").toLocaleLowerCase("en-US");
  const workflowId = `workflow-${compact}`;
  if (!WORKFLOW_ID.test(workflowId)) {
    fail("COMPILER.WORKFLOW_ID", "Workflow identity allocator returned an invalid value.", "/output_attribution/workflow_id");
  }
  return workflowId;
}

export function createWorkflowOutputAttribution(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).sort().join(",") !== "projectId,workflowId"
    || typeof input.projectId !== "string" || !PROJECT_ID.test(input.projectId)
    || typeof input.workflowId !== "string" || !WORKFLOW_ID.test(input.workflowId)) {
    fail(
      "COMPILER.OUTPUT_ATTRIBUTION",
      "Output attribution requires exact stable project and workflow IDs.",
      "/output_attribution",
    );
  }
  const projectToken = shortToken("project", input.projectId);
  const workflowToken = shortToken("workflow", input.workflowId);
  const outputPrefix = `video/Relay/p_${projectToken}/w_${workflowToken}/Relay_H3`;
  return Object.freeze({
    schema_version: "1.0.0",
    project_id: input.projectId,
    workflow_id: input.workflowId,
    project_token: projectToken,
    workflow_token: workflowToken,
    output_prefix: outputPrefix,
  });
}

function setFilenamePrefix(saveVideo, outputPrefix) {
  if (!Array.isArray(saveVideo.widgets_values) || saveVideo.widgets_values.length < 1
    || saveVideo.widgets_values_named === null || typeof saveVideo.widgets_values_named !== "object"
    || Array.isArray(saveVideo.widgets_values_named)
    || !Object.hasOwn(saveVideo.widgets_values_named, "filename_prefix")) {
    fail("TEMPLATE.OUTPUT_BINDING", "Pinned SaveVideo filename binding drifted.", "/template");
  }
  saveVideo.widgets_values[0] = outputPrefix;
  saveVideo.widgets_values_named.filename_prefix = outputPrefix;
}

/**
 * Applies the safe namespace to an already compiled visual workflow. This is
 * intentionally available as a separate integration seam for the control
 * plane, which allocates its authoritative workflow ID before storing or
 * handing off bytes. It never submits or executes the workflow.
 */
export function applyWorkflowOutputAttribution(workflow, input) {
  const attribution = createWorkflowOutputAttribution(input);
  if (workflow === null || typeof workflow !== "object" || Array.isArray(workflow)
    || !Array.isArray(workflow.nodes)) {
    fail("COMPILER.OUTPUT_ATTRIBUTION", "A compiled visual workflow is required.", "/workflow");
  }
  const saveVideos = workflow.nodes.filter((node) => node?.type === "SaveVideo");
  if (saveVideos.length !== 1) {
    fail("TEMPLATE.OUTPUT_BINDING", "Pinned SaveVideo node is absent or ambiguous.", "/template");
  }
  setFilenamePrefix(saveVideos[0], attribution.output_prefix);
  if (workflow.extra === null || typeof workflow.extra !== "object" || Array.isArray(workflow.extra)) {
    workflow.extra = {};
  }
  workflow.extra.relay_output_attribution = {
    schema_version: attribution.schema_version,
    project_id: attribution.project_id,
    workflow_id: attribution.workflow_id,
    project_token: attribution.project_token,
    workflow_token: attribution.workflow_token,
    output_prefix: attribution.output_prefix,
  };
  return attribution;
}

export function isWorkflowOutputAttribution(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && value.schema_version === "1.0.0"
    && typeof value.project_id === "string" && PROJECT_ID.test(value.project_id)
    && typeof value.workflow_id === "string" && WORKFLOW_ID.test(value.workflow_id)
    && typeof value.project_token === "string" && TOKEN.test(value.project_token)
    && typeof value.workflow_token === "string" && TOKEN.test(value.workflow_token)
    && value.project_token === shortToken("project", value.project_id)
    && value.workflow_token === shortToken("workflow", value.workflow_id)
    && value.output_prefix === `video/Relay/p_${value.project_token}/w_${value.workflow_token}/Relay_H3`;
}

export const WORKFLOW_OUTPUT_PROJECT_ID_PATTERN = PROJECT_ID;
export const WORKFLOW_OUTPUT_WORKFLOW_ID_PATTERN = WORKFLOW_ID;
