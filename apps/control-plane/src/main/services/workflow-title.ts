import { createWorkflowFileName } from "../../shared/workflow-name.js";

export function createUserNamedWorkflowFileName(workflowName: string): string {
  return createWorkflowFileName(workflowName);
}
