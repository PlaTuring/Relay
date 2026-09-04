import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ProjectSpec } from "../../shared/ipc-contract.js";
import type { RelayResolvedSeedPlan } from "../../shared/seed-policy.js";
import type { JsonValue } from "./ab-cli-adapter.js";
import { ControlPlaneServiceError } from "./errors.js";
import { createUserNamedWorkflowFileName } from "./workflow-title.js";

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function uuidFromDigest(digest: string): string {
  const characters = digest.slice(0, 32).split("");
  characters[12] = "5";
  characters[16] = ((Number.parseInt(characters[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const hex = characters.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function assignUserWorkflowIdentity(options: {
  readonly workflowName: string;
  readonly workflow: JsonValue;
}): JsonValue {
  if (
    options.workflow === null ||
    typeof options.workflow !== "object" ||
    Array.isArray(options.workflow)
  ) {
    throw new ControlPlaneServiceError("WORKFLOW_EXPORT_FAILED", "编译器没有返回有效的 ComfyUI 工作流对象。");
  }
  const fileName = createUserNamedWorkflowFileName(options.workflowName);
  const canonicalWorkflow = stableJson(options.workflow);
  const digest = createHash("sha256")
    .update("minimax-h3-user-workflow-identity\0", "utf8")
    .update(fileName.normalize("NFKC"), "utf8")
    .update("\0", "utf8")
    .update(canonicalWorkflow, "utf8")
    .digest("hex");
  const cloned = JSON.parse(canonicalWorkflow) as Record<string, JsonValue>;
  cloned.id = uuidFromDigest(digest);
  return cloned;
}

function createWorkflowDocument(
  project: ProjectSpec,
  compiledWorkflow: JsonValue | null,
  seedResolution: RelayResolvedSeedPlan
): unknown {
  if (compiledWorkflow !== null) return compiledWorkflow;
  return Object.freeze({
    project,
    seedResolution,
    branding: Object.freeze({
      software_brand_only: true,
      media_branding_authority: false
    }),
    queueSubmission: false
  });
}

export async function exportDeterministicWorkflow(options: {
  readonly exportDirectory: string;
  readonly workflowName: string;
  readonly project: ProjectSpec;
  readonly compiledWorkflow: JsonValue | null;
  readonly seedResolution: RelayResolvedSeedPlan;
}): Promise<string> {
  const serialized = `${stableJson(createWorkflowDocument(options.project, options.compiledWorkflow, options.seedResolution))}\n`;
  let fileName: string;
  try {
    fileName = createUserNamedWorkflowFileName(options.workflowName);
  } catch (error) {
    throw new ControlPlaneServiceError(
      "INVALID_REQUEST",
      error instanceof Error ? error.message : "工作流名称无效。"
    );
  }
  const outputPath = join(options.exportDirectory, fileName);

  try {
    await mkdir(options.exportDirectory, { recursive: true });
    await writeFile(outputPath, serialized, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      try {
        const existing = await readFile(outputPath, "utf8");
        if (existing === serialized) return fileName;
      } catch {
        // Fall through to the stable public error below.
      }
    }
    throw new ControlPlaneServiceError(
      "WORKFLOW_EXPORT_FAILED",
      (error as NodeJS.ErrnoException).code === "EEXIST"
        ? "同名工作流已经存在且内容不同，请更改工作流名称后重试。"
        : "无法导出工作流文件。"
    );
  }
  return fileName;
}
