export interface ProjectOperationContext {
  readonly projectId: string;
  readonly activationEpoch: number;
}

export class ProjectOperationSupersededError extends Error {
  constructor() {
    super("项目已经切换，本次旧操作结果已丢弃。");
    this.name = "ProjectOperationSupersededError";
  }
}

export function captureProjectOperationIdentity(
  projectId: string | null,
  activationEpoch: number
): ProjectOperationContext {
  if (projectId === null) throw new Error("请先在项目中心新建或打开一个项目。");
  return Object.freeze({ projectId, activationEpoch });
}

export function projectOperationIdentityMatches(
  context: ProjectOperationContext,
  currentProjectId: string | null,
  currentActivationEpoch: number
): boolean {
  return currentActivationEpoch === context.activationEpoch
    && currentProjectId === context.projectId;
}

export function requireProjectOperationIdentity(
  context: ProjectOperationContext,
  currentProjectId: string | null,
  currentActivationEpoch: number
): void {
  if (!projectOperationIdentityMatches(context, currentProjectId, currentActivationEpoch)) {
    throw new ProjectOperationSupersededError();
  }
}
