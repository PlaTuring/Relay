export const WORKFLOW_NAME_MAX_LENGTH = 80;

export type WorkflowNameValidation =
  | Readonly<{ ok: true; value: string }>
  | Readonly<{ ok: false; message: string }>;

const INVALID_WINDOWS_FILE_NAME_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/u;
const RESERVED_WINDOWS_FILE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;

export function validateWorkflowName(value: unknown): WorkflowNameValidation {
  if (typeof value !== "string") {
    return Object.freeze({ ok: false, message: "请输入工作流名称。" });
  }

  let normalized = value.normalize("NFKC").trim();
  if (/\.json$/iu.test(normalized)) normalized = normalized.slice(0, -5).trimEnd();

  if (normalized.length === 0) {
    return Object.freeze({ ok: false, message: "请输入工作流名称。" });
  }
  if ([...normalized].length > WORKFLOW_NAME_MAX_LENGTH) {
    return Object.freeze({ ok: false, message: `工作流名称不能超过 ${WORKFLOW_NAME_MAX_LENGTH} 个字符。` });
  }
  if (
    normalized === "." ||
    normalized === ".." ||
    INVALID_WINDOWS_FILE_NAME_CHARACTERS.test(normalized) ||
    /[. ]$/u.test(normalized) ||
    RESERVED_WINDOWS_FILE_NAME.test(normalized)
  ) {
    return Object.freeze({
      ok: false,
      message: "名称不能包含 \\ / : * ? \" < > |，也不能使用 Windows 保留名称。"
    });
  }

  return Object.freeze({ ok: true, value: normalized });
}

export function createWorkflowFileName(workflowName: string): string {
  const result = validateWorkflowName(workflowName);
  if (!result.ok) throw new TypeError(result.message);
  return `${result.value}.json`;
}
