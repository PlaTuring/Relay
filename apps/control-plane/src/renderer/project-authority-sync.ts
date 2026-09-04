import type { RelayProjectDocument } from "../shared/project-domain.js";
import type { ProjectWorkspaceController } from "./project-workspace-controller.js";
import { canonicalProjectJson, projectContentHash } from "./project-state-engine.js";

/**
 * Rebase renderer-owned editor state onto the newest main-process authority.
 * Service-owned collections must always come from authority so a subsequent
 * full-document autosave cannot erase workflows, handoffs, history or assets.
 */
export function mergeAuthoritativeProjectWithEditorState(
  authoritativeProject: RelayProjectDocument,
  editorProject: RelayProjectDocument
): RelayProjectDocument {
  if (authoritativeProject.projectId !== editorProject.projectId) {
    throw new Error("项目操作结果与当前编辑项目不一致，Relay 未采用该项目版本。");
  }
  return Object.freeze({
    ...authoritativeProject,
    quick: editorProject.quick,
    professional: editorProject.professional,
    assets: authoritativeProject.assets,
    entities: editorProject.entities,
    bindings: editorProject.bindings,
    scenes: editorProject.scenes,
    shots: editorProject.shots,
    externalReferences: authoritativeProject.externalReferences,
    workflows: authoritativeProject.workflows,
    history: authoritativeProject.history
  });
}

/** Also rebase undo/redo and checkpoint snapshots, otherwise Undo can revive an old CAS token. */
export function synchronizeWorkspaceAuthoritativeProject(
  controller: ProjectWorkspaceController,
  authoritativeProject: RelayProjectDocument
): ProjectWorkspaceController {
  if (controller.session.current.projectId !== authoritativeProject.projectId) return controller;
  const rebase = (project: RelayProjectDocument): RelayProjectDocument =>
    mergeAuthoritativeProjectWithEditorState(authoritativeProject, project);
  const commands = Object.freeze(controller.session.commands.map((command) => Object.freeze({
    ...command,
    before: rebase(command.before),
    after: rebase(command.after)
  })));
  const history = Object.freeze(controller.session.history.map((checkpoint) => {
    const snapshot = rebase(JSON.parse(checkpoint.projectSnapshot) as RelayProjectDocument);
    return Object.freeze({
      ...checkpoint,
      projectContentHash: projectContentHash(snapshot),
      projectSnapshot: canonicalProjectJson(snapshot)
    });
  }));
  return Object.freeze({
    ...controller,
    session: Object.freeze({
      ...controller.session,
      current: rebase(controller.session.current),
      persistedContentHash: projectContentHash(authoritativeProject),
      commands,
      history
    })
  });
}

export function assertProjectContainsCompileHandoff(
  authoritativeProject: RelayProjectDocument,
  workflowFileName: string,
  targetRelativePath: string | null
): void {
  const workflow = authoritativeProject.workflows.find((candidate) =>
    candidate.projectRelativePath.replaceAll("\\", "/").split("/").at(-1) === workflowFileName
  );
  if (workflow === undefined) {
    throw new Error("编译结果未包含本次权威工作流，Relay 未继续覆盖项目。");
  }
  if (
    targetRelativePath !== null &&
    !workflow.handoffs.some((handoff) => handoff.targetRelativePath === targetRelativePath)
  ) {
    throw new Error("编译结果未包含本次 ComfyUI 交接记录，Relay 未继续覆盖项目。");
  }
}

export function canAdoptProjectAuthority(input: {
  readonly authoritativeProject: RelayProjectDocument;
  readonly expectedProjectId: string;
  readonly currentProjectId: string | null;
  readonly expectedActivationEpoch: number;
  readonly currentActivationEpoch: number;
  readonly knownUpdatedAt: string | undefined;
}): boolean {
  if (input.authoritativeProject.projectId !== input.expectedProjectId) {
    throw new Error("项目操作返回了其他项目的数据，Relay 已阻止写入当前项目。");
  }
  if (
    input.currentActivationEpoch !== input.expectedActivationEpoch ||
    input.currentProjectId !== input.expectedProjectId
  ) return false;
  if (
    input.knownUpdatedAt !== undefined &&
    Date.parse(input.authoritativeProject.updatedAt) < Date.parse(input.knownUpdatedAt)
  ) return false;
  return true;
}
