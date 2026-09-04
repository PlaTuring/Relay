import type { RelayProjectDocument } from "../shared/project-domain.js";
import type { DirectorDraft, DirectorShot } from "./director-console.js";
import {
  normalizeProductionState,
  type DirectorProductionState,
  type ProductionShot
} from "./director-production.js";
import { orderedDirectorShots } from "./professional-director.js";

export type ProfessionalDirectorReconciliationSourceVersion = 5 | 6 | 7;

export type ProfessionalDirectorReconciliationErrorCode =
  | "DIRECTOR_SHOT_ID_RECONCILIATION_INCOMPLETE"
  | "DIRECTOR_SHOT_ID_RECONCILIATION_AMBIGUOUS"
  | "DIRECTOR_SHOT_ID_RECONCILIATION_CONFLICT";

export interface ProfessionalDirectorReconciliationInput {
  readonly project: RelayProjectDocument;
  readonly draft: DirectorDraft;
  readonly state: DirectorProductionState;
  readonly sourceVersion: ProfessionalDirectorReconciliationSourceVersion;
  readonly legacyActiveShotId?: unknown;
  readonly lastCompiledShotFingerprints?: Readonly<Record<string, string>>;
}

export type ProfessionalDirectorReconciliationResult = Readonly<
  | {
      readonly ok: true;
      readonly changed: boolean;
      readonly draft: DirectorDraft;
      readonly state: DirectorProductionState;
      readonly activeShotId: string | null;
      readonly lastCompiledShotFingerprints: Readonly<Record<string, string>>;
      readonly shotIdMap: Readonly<Record<string, string>>;
      readonly warnings: readonly string[];
    }
  | {
      readonly ok: false;
      readonly code: ProfessionalDirectorReconciliationErrorCode;
      readonly error: string;
    }
>;

type AuthoritativeShot = Readonly<{
  sceneId: string;
  shotId: string;
  startSeconds: number;
  durationSeconds: number;
}>;

function immutableJsonCopy<T>(value: T): T {
  const copy = JSON.parse(JSON.stringify(value)) as T;
  const freeze = (candidate: unknown, seen = new Set<object>()): void => {
    if (candidate === null || typeof candidate !== "object" || seen.has(candidate)) return;
    seen.add(candidate);
    for (const child of Object.values(candidate as Record<string, unknown>)) freeze(child, seen);
    Object.freeze(candidate);
  };
  freeze(copy);
  return copy;
}

function failure(
  code: ProfessionalDirectorReconciliationErrorCode,
  error: string
): ProfessionalDirectorReconciliationResult {
  return Object.freeze({ ok: false, code, error });
}

function authoritativeTimeline(project: RelayProjectDocument): readonly AuthoritativeShot[] {
  let startSeconds = 0;
  return Object.freeze(orderedDirectorShots(project).map(({ scene, shot }) => {
    const entry = Object.freeze({
      sceneId: scene.sceneId,
      shotId: shot.shotId,
      startSeconds,
      durationSeconds: shot.durationSeconds
    });
    startSeconds += shot.durationSeconds;
    return entry;
  }));
}

function shotTimingMatches(left: Pick<DirectorShot, "startSeconds" | "durationSeconds">, right: AuthoritativeShot): boolean {
  return left.startSeconds === right.startSeconds && left.durationSeconds === right.durationSeconds;
}

/**
 * Reconciles a restored v5/v6/v7 Director work copy with the Relay project,
 * whose Shot IDs and timeline are authoritative.
 *
 * Exact stable IDs win. A drifted ID is accepted only when its timing and
 * ordinal position identify exactly one unused source and target. Any count,
 * duplicate-ID, timing, or re-key collision fails closed without mutating the
 * caller's project, draft, production state, or immutable Revision snapshots.
 */
export function reconcileProfessionalDirectorStateWithProject(
  input: ProfessionalDirectorReconciliationInput
): ProfessionalDirectorReconciliationResult {
  const authoritative = authoritativeTimeline(input.project);
  const sourceShots = [...input.draft.shots];
  if (authoritative.length !== sourceShots.length || authoritative.length === 0) {
    return failure(
      "DIRECTOR_SHOT_ID_RECONCILIATION_INCOMPLETE",
      "旧版专业导播镜头数量与当前项目不一致；Relay 未自动关联，以免覆盖镜头内容。"
    );
  }

  const authoritativeIds = new Set(authoritative.map((shot) => shot.shotId));
  if (authoritativeIds.size !== authoritative.length) {
    return failure(
      "DIRECTOR_SHOT_ID_RECONCILIATION_CONFLICT",
      "当前项目包含重复镜头标识；Relay 已停止恢复旧版导播状态。"
    );
  }

  const sourceIdCounts = new Map<string, number>();
  for (const shot of sourceShots) {
    if (typeof shot.id !== "string" || shot.id.length === 0) {
      return failure(
        "DIRECTOR_SHOT_ID_RECONCILIATION_INCOMPLETE",
        "旧版专业导播镜头缺少稳定标识；Relay 未自动关联，以免串接错误镜头。"
      );
    }
    sourceIdCounts.set(shot.id, (sourceIdCounts.get(shot.id) ?? 0) + 1);
  }
  if ([...sourceIdCounts.values()].some((count) => count !== 1)) {
    return failure(
      "DIRECTOR_SHOT_ID_RECONCILIATION_AMBIGUOUS",
      "旧版专业导播包含重复镜头标识；无法安全判断镜头对应关系。"
    );
  }

  const sourceIndexByAuthoritativeIndex = new Map<number, number>();
  const usedSourceIndexes = new Set<number>();

  // Stable identity is stronger than timing and survives legitimate reordering.
  for (const [targetIndex, target] of authoritative.entries()) {
    const exactIndexes = sourceShots.flatMap((shot, sourceIndex) => shot.id === target.shotId ? [sourceIndex] : []);
    if (exactIndexes.length > 1) {
      return failure(
        "DIRECTOR_SHOT_ID_RECONCILIATION_AMBIGUOUS",
        "旧版专业导播有多个镜头声称同一个项目镜头标识；Relay 已停止自动恢复。"
      );
    }
    const exactIndex = exactIndexes[0];
    if (exactIndex !== undefined) {
      sourceIndexByAuthoritativeIndex.set(targetIndex, exactIndex);
      usedSourceIndexes.add(exactIndex);
    }
  }

  // Drifted IDs may only move across the boundary when timing is unique and
  // their ordinal slot also agrees. This intentionally rejects clever guesses.
  for (const [targetIndex, target] of authoritative.entries()) {
    if (sourceIndexByAuthoritativeIndex.has(targetIndex)) continue;
    const timingCandidates = sourceShots.flatMap((shot, sourceIndex) => (
      !usedSourceIndexes.has(sourceIndex) && shotTimingMatches(shot, target) ? [sourceIndex] : []
    ));
    if (timingCandidates.length > 1) {
      return failure(
        "DIRECTOR_SHOT_ID_RECONCILIATION_AMBIGUOUS",
        "旧版专业导播存在多个时间位置相同的镜头；无法安全判断镜头对应关系。"
      );
    }
    const sourceIndex = timingCandidates[0];
    if (sourceIndex === undefined || sourceIndex !== targetIndex) {
      return failure(
        "DIRECTOR_SHOT_ID_RECONCILIATION_INCOMPLETE",
        "旧版专业导播镜头的时间或顺序与当前项目不一致；Relay 未自动关联。"
      );
    }
    sourceIndexByAuthoritativeIndex.set(targetIndex, sourceIndex);
    usedSourceIndexes.add(sourceIndex);
  }

  if (usedSourceIndexes.size !== sourceShots.length) {
    return failure(
      "DIRECTOR_SHOT_ID_RECONCILIATION_INCOMPLETE",
      "仍有旧版专业导播镜头无法对应当前项目；Relay 未修改原始数据。"
    );
  }

  const idMap = new Map<string, string>();
  const reconciledDraftShots: DirectorShot[] = [];
  for (const [targetIndex, target] of authoritative.entries()) {
    const sourceIndex = sourceIndexByAuthoritativeIndex.get(targetIndex);
    const source = sourceIndex === undefined ? undefined : sourceShots[sourceIndex];
    if (source === undefined || source.id === undefined) {
      return failure(
        "DIRECTOR_SHOT_ID_RECONCILIATION_INCOMPLETE",
        "旧版专业导播镜头对账结果不完整；Relay 未修改原始数据。"
      );
    }
    const existingTarget = idMap.get(source.id);
    if (existingTarget !== undefined && existingTarget !== target.shotId) {
      return failure(
        "DIRECTOR_SHOT_ID_RECONCILIATION_AMBIGUOUS",
        "同一旧版镜头不能安全对应多个当前项目镜头。"
      );
    }
    idMap.set(source.id, target.shotId);
    reconciledDraftShots.push({
      ...source,
      id: target.shotId,
      startSeconds: target.startSeconds,
      durationSeconds: target.durationSeconds
    });
  }

  const productionShots = input.state.scenes.flatMap((scene) => scene.shots);
  const productionIdCounts = new Map<string, number>();
  for (const shot of productionShots) {
    productionIdCounts.set(shot.id, (productionIdCounts.get(shot.id) ?? 0) + 1);
  }
  for (const [sourceId, targetId] of idMap) {
    if ((productionIdCounts.get(sourceId) ?? 0) !== 1) {
      return failure(
        "DIRECTOR_SHOT_ID_RECONCILIATION_AMBIGUOUS",
        "旧版制作数据中无法唯一定位需要迁移的镜头；Relay 未修改制作数据。"
      );
    }
    if (sourceId !== targetId && (productionIdCounts.get(targetId) ?? 0) > 0) {
      return failure(
        "DIRECTOR_SHOT_ID_RECONCILIATION_CONFLICT",
        "旧版制作数据中的镜头重键会与现有镜头冲突；Relay 已停止自动恢复。"
      );
    }
  }

  const targetById = new Map(authoritative.map((shot) => [shot.shotId, shot]));
  const rekeyShot = (shot: ProductionShot): ProductionShot => {
    const targetId = idMap.get(shot.id);
    if (targetId === undefined) return shot;
    const target = targetById.get(targetId);
    if (target === undefined) return shot;
    return {
      ...shot,
      id: targetId,
      startSeconds: target.startSeconds,
      durationSeconds: target.durationSeconds
    };
  };
  const rekeyedState: DirectorProductionState = {
    ...input.state,
    scenes: input.state.scenes.map((scene) => ({
      ...scene,
      shots: scene.shots.map(rekeyShot)
    })),
    bindings: input.state.bindings.map((binding) => (
      binding.targetKind === "shot" && idMap.has(binding.targetId)
        ? { ...binding, targetId: idMap.get(binding.targetId)! }
        : binding
    )),
    takes: input.state.takes.map((take) => (
      idMap.has(take.shotId) ? { ...take, shotId: idMap.get(take.shotId)! } : take
    ))
    // Revision snapshots are immutable historical evidence. They remain byte
    // identical and are reconciled only when a user restores one as a new work copy.
  };

  const mappedLegacyActive = typeof input.legacyActiveShotId === "string"
    ? idMap.get(input.legacyActiveShotId) ?? input.legacyActiveShotId
    : null;
  const activeShotId = input.project.professional.activeShotId !== null
    && authoritativeIds.has(input.project.professional.activeShotId)
    ? input.project.professional.activeShotId
    : mappedLegacyActive !== null && authoritativeIds.has(mappedLegacyActive)
      ? mappedLegacyActive
      : authoritative[0]?.shotId ?? null;
  const activeSceneId = authoritative.find((shot) => shot.shotId === activeShotId)?.sceneId ?? null;
  const activeSelectionChanged = input.project.professional.activeShotId !== activeShotId
    || input.project.professional.activeSceneId !== activeSceneId;

  const shotIdMap = Object.fromEntries([...idMap.entries()].sort(([left], [right]) => left.localeCompare(right)));
  const draft: DirectorDraft = { ...input.draft, shots: reconciledDraftShots };
  const identityOrTimingChanged = sourceShots.some((shot, index) => {
    const reconciled = reconciledDraftShots[index];
    return reconciled === undefined
      || shot.id !== reconciled.id
      || shot.startSeconds !== reconciled.startSeconds
      || shot.durationSeconds !== reconciled.durationSeconds;
  }) || JSON.stringify(input.state.scenes) !== JSON.stringify(rekeyedState.scenes)
    || JSON.stringify(input.state.bindings) !== JSON.stringify(rekeyedState.bindings)
    || JSON.stringify(input.state.takes) !== JSON.stringify(rekeyedState.takes);

  // Shot identity participates in deterministic seed derivation and workflow
  // identity. A re-keyed work copy must never inherit a stale "compiled" claim.
  // Immutable Revision snapshots remain intact, but the live compile marker is
  // cleared and the next user compile establishes fresh evidence.
  // Repairing a missing/invalid authoritative active-shot selection must be
  // persisted together with the reconciled work copy. Conservatively clear
  // live compile evidence for that writeback as well; immutable Revisions and
  // project workflow/history evidence remain untouched.
  const reconciliationRequiresWriteback = identityOrTimingChanged || activeSelectionChanged;
  const stateForNormalization: DirectorProductionState = reconciliationRequiresWriteback
    ? {
        ...rekeyedState,
        project: {
          ...rekeyedState.project,
          directorSettings: {
            ...rekeyedState.project.directorSettings,
            lastCompiledSnapshot: ""
          }
        }
      }
    : rekeyedState;
  let reconciledState: DirectorProductionState;
  try {
    reconciledState = normalizeProductionState(stateForNormalization);
  } catch {
    return failure(
      "DIRECTOR_SHOT_ID_RECONCILIATION_CONFLICT",
      "旧版制作数据在镜头重键后未通过一致性校验；Relay 未修改原始数据。"
    );
  }
  const fingerprints = reconciliationRequiresWriteback
    ? Object.freeze({})
    : immutableJsonCopy(input.lastCompiledShotFingerprints ?? {});
  const changed = reconciliationRequiresWriteback
    || JSON.stringify(input.state) !== JSON.stringify(reconciledState);

  return immutableJsonCopy({
    ok: true as const,
    changed,
    draft,
    state: reconciledState,
    activeShotId,
    lastCompiledShotFingerprints: fingerprints,
    shotIdMap,
    warnings: changed
      ? [`已将专业导播 v${input.sourceVersion} 工作副本的镜头标识确定性对齐到当前项目；历史检查点保持不变。`]
      : []
  });
}

/**
 * Keeps a project/editor-only refresh failure out of environment detection and
 * bootstrap state. The caller owns the local error presentation.
 */
export function safelyRefreshProfessionalDirectorState(
  refresh: () => void,
  onError: (error: unknown) => void
): boolean {
  try {
    refresh();
    return true;
  } catch (error) {
    onError(error);
    return false;
  }
}
