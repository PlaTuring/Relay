import {
  CONTINUITY_DIMENSIONS,
  addProductionTake,
  archiveProductionBinding,
  archiveProductionEntity,
  archiveProductionScene,
  archiveProductionTake,
  assignShotToScene,
  buildContinuityMatrix,
  directorTimelineDuration,
  normalizeProductionState,
  productionBindingsForTarget,
  resolveShotContinuity,
  restoreProductionEntity,
  restoreProductionScene,
  setProductionShotDuration,
  setShotContinuity,
  unsetShotContinuity,
  updateProductionTake,
  upsertProductionBinding,
  upsertProductionEntity,
  upsertProductionScene,
  type ContinuityDimension,
  type DirectorProductionState,
  type ProductionEntityKind,
  type ProductionScene,
  type ProductionShot,
  type ProductionTakeStatus
} from "./director-production";

export interface DirectorP1AssetOption {
  readonly assetId: string;
  readonly displayName: string;
  readonly mediaType: "image" | "video" | "audio";
  readonly availability: "available" | "missing";
}

export interface DirectorP1UiOptions {
  readonly initialState: DirectorProductionState;
  readonly onChange: (state: DirectorProductionState) => void;
  readonly onRestoreRevision: (revisionId: string) => void;
  readonly onValidationError: (message: string) => void;
  readonly onOpenShotDrawer?: (tab: "details" | "takes") => void;
  readonly confirmAction: (options: {
    readonly title: string;
    readonly message: string;
    readonly confirmLabel: string;
  }) => Promise<boolean>;
}

export interface DirectorP1Ui {
  getState(): DirectorProductionState;
  setState(state: DirectorProductionState): void;
  resetTransientEditors(): void;
  setAssetOptions(assets: readonly DirectorP1AssetOption[]): void;
  setActiveShot(shotId: string | null): void;
  focusField(shotId: string, field: string): boolean;
  render(): void;
}

const ENTITY_LABELS: Readonly<Record<ProductionEntityKind, string>> = Object.freeze({
  character: "角色 / 服装",
  location: "地点 / 场景",
  prop: "道具"
});

const CONTINUITY_LABELS: Readonly<Record<ContinuityDimension, string>> = Object.freeze({
  characterAppearance: "人物外观",
  wardrobe: "服装",
  props: "道具",
  movementDirection: "运动方向",
  scene: "场景",
  weather: "天气",
  timeOfDay: "时间",
  lighting: "光线",
  visualStyle: "视觉风格",
  sound: "声音"
});

const CONTINUITY_MODE_LABELS = Object.freeze({
  inherit: "继承上一镜头",
  override: "本镜头覆盖",
  unset: "恢复继承"
} as const);

const ALLOWED_SHOT_DURATIONS = Object.freeze([5, 10, 15] as const);

const TAKE_STATUS_LABELS: Readonly<Record<ProductionTakeStatus, string>> = Object.freeze({
  candidate: "备选",
  selected: "选用",
  rejected: "弃用",
  archived: "已删除"
});

function requiredElement<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (value === null) throw new Error(`P1 UI element is missing: ${id}`);
  return value as T;
}

function cloneTemplate<T extends HTMLElement>(id: string): T {
  const template = requiredElement<HTMLTemplateElement>(id);
  const value = template.content.firstElementChild?.cloneNode(true);
  if (!(value instanceof HTMLElement)) throw new Error(`P1 UI template is empty: ${id}`);
  return value as T;
}

function activeScenes(state: DirectorProductionState): readonly ProductionScene[] {
  return state.scenes.filter((scene) => !scene.archived);
}

export function activeShotsForP1(state: DirectorProductionState): readonly ProductionShot[] {
  return Object.freeze(activeScenes(state)
    .flatMap((scene) => scene.shots.filter((shot) => !shot.archived))
    .sort((left, right) => left.startSeconds - right.startSeconds
      || left.durationSeconds - right.durationSeconds
      || left.id.localeCompare(right.id)));
}

function shotLocation(state: DirectorProductionState, shotId: string): { readonly scene: ProductionScene; readonly shot: ProductionShot } | null {
  for (const scene of state.scenes) {
    const shot = scene.shots.find((candidate) => candidate.id === shotId);
    if (shot !== undefined) return { scene, shot };
  }
  return null;
}

function assignExistingShot(state: DirectorProductionState, sceneId: string, shot: ProductionShot): DirectorProductionState {
  return assignShotToScene(state, sceneId, {
    id: shot.id,
    identityKey: shot.id,
    startSeconds: shot.startSeconds,
    durationSeconds: shot.durationSeconds,
    description: shot.description,
    cameraLanguage: shot.cameraLanguage,
    soundCue: shot.soundCue,
    transitionNote: shot.transitionNote,
    entityIds: shot.entityIds
  });
}

function activeShotLocation(
  state: DirectorProductionState,
  shotId: string
): { readonly scene: ProductionScene; readonly shot: ProductionShot } | null {
  const location = shotLocation(state, shotId);
  return location === null || location.scene.archived || location.shot.archived ? null : location;
}

function ensureUnassignedScene(
  state: DirectorProductionState,
  excludedSceneId: string
): { readonly state: DirectorProductionState; readonly sceneId: string } {
  const preferred = activeScenes(state)
    .filter((scene) => scene.id !== excludedSceneId)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
    .find((scene) => scene.title === "默认场景" || scene.title === "未分组镜头");
  if (preferred !== undefined) return Object.freeze({ state, sceneId: preferred.id });

  let next = state;
  for (let attempt = 0; attempt <= state.scenes.length + 1; attempt += 1) {
    const knownIds = new Set(next.scenes.map((scene) => scene.id));
    const candidate = upsertProductionScene(next, {
      identityKey: `p1-unassigned:${state.project.id}:${excludedSceneId}:${attempt}`,
      title: "未分组镜头",
      order: next.scenes.length,
      notes: ""
    });
    const created = candidate.scenes.find((scene) => !knownIds.has(scene.id) && !scene.archived);
    if (created !== undefined) return Object.freeze({ state: candidate, sceneId: created.id });
    next = candidate;
  }
  throw new Error("无法建立未分组镜头场景。");
}

export function replaceSceneMembership(
  state: DirectorProductionState,
  targetSceneId: string,
  selectedShotIds: readonly string[]
): DirectorProductionState {
  const target = activeScenes(state).find((scene) => scene.id === targetSceneId);
  if (target === undefined) throw new RangeError("找不到需要更新的场景。");
  const timeline = activeShotsForP1(state);
  const activeIds = new Set(timeline.map((shot) => shot.id));
  const selectedIds = new Set(selectedShotIds);
  for (const shotId of selectedIds) {
    if (!activeIds.has(shotId)) throw new RangeError("所选镜头不存在或已删除。");
  }

  let next = state;
  const removedShots = target.shots.filter((shot) => !shot.archived && !selectedIds.has(shot.id));
  if (removedShots.length > 0) {
    const fallback = ensureUnassignedScene(next, targetSceneId);
    next = fallback.state;
    for (const shot of removedShots) next = assignExistingShot(next, fallback.sceneId, shot);
  }
  for (const shot of timeline) {
    if (!selectedIds.has(shot.id)) continue;
    const current = activeShotLocation(next, shot.id);
    if (current !== null) next = assignExistingShot(next, targetSceneId, current.shot);
  }
  return next;
}

function parseShotRange(value: string, shots: readonly ProductionShot[]): readonly string[] {
  const ids = new Set<string>();
  for (const rawPart of value.split(/[,，\s]+/u).map((part) => part.trim()).filter(Boolean)) {
    const range = rawPart.match(/^(\d+)[-–—](\d+)$/u);
    if (range !== null) {
      const first = Number(range[1]);
      const last = Number(range[2]);
      if (first <= 0 || last < first || last > shots.length) throw new RangeError(`镜头范围 ${rawPart} 无效。`);
      for (let index = first; index <= last; index += 1) ids.add(shots[index - 1]!.id);
      continue;
    }
    const numeric = Number(rawPart);
    if (Number.isSafeInteger(numeric)) {
      if (numeric <= 0 || numeric > shots.length) throw new RangeError(`镜头序号 ${rawPart} 不存在。`);
      ids.add(shots[numeric - 1]!.id);
      continue;
    }
    throw new RangeError(`镜头序号 ${rawPart} 无效；请填写数字或范围，例如 1, 3-5。`);
  }
  return Object.freeze([...ids]);
}

export function createDirectorP1Ui(options: DirectorP1UiOptions): DirectorP1Ui {
  const root = requiredElement<HTMLElement>("director-p1-workspace");
  const totalDuration = requiredElement<HTMLOutputElement>("director-p1-total-duration");
  const currentShotTools = requiredElement<HTMLElement>("director-p1-current-shot-tools");
  const currentShotDuration = requiredElement<HTMLSelectElement>("director-p1-current-shot-duration");
  const entityList = requiredElement<HTMLElement>("director-p1-entity-list");
  const entityEmpty = requiredElement<HTMLElement>("director-p1-entity-empty");
  const entityCount = requiredElement<HTMLElement>("director-p1-entity-count");
  const entityEditor = requiredElement<HTMLFieldSetElement>("director-p1-entity-editor");
  const entityId = requiredElement<HTMLInputElement>("director-p1-entity-id");
  const entityType = requiredElement<HTMLSelectElement>("director-p1-entity-type");
  const entityName = requiredElement<HTMLInputElement>("director-p1-entity-name");
  const entityDetails = requiredElement<HTMLTextAreaElement>("director-p1-entity-details");
  const entityAsset = requiredElement<HTMLSelectElement>("director-p1-entity-asset");
  const entityArchive = requiredElement<HTMLButtonElement>("director-p1-entity-archive");
  const deletedEntityList = requiredElement<HTMLElement>("director-p1-deleted-entity-list");

  const sceneList = requiredElement<HTMLElement>("director-p1-scene-list");
  const sceneEmpty = requiredElement<HTMLElement>("director-p1-scene-empty");
  const sceneCount = requiredElement<HTMLElement>("director-p1-scene-count");
  const sceneEditor = requiredElement<HTMLFieldSetElement>("director-p1-scene-editor");
  const sceneId = requiredElement<HTMLInputElement>("director-p1-scene-id");
  const sceneName = requiredElement<HTMLInputElement>("director-p1-scene-name");
  const sceneSetting = requiredElement<HTMLTextAreaElement>("director-p1-scene-setting");
  const sceneShotRange = requiredElement<HTMLInputElement>("director-p1-scene-shot-range");
  const sceneArchive = requiredElement<HTMLButtonElement>("director-p1-scene-archive");
  const deletedSceneList = requiredElement<HTMLElement>("director-p1-deleted-scene-list");
  const currentSceneName = requiredElement<HTMLElement>("director-p1-current-scene-name");
  const currentSceneMeta = requiredElement<HTMLElement>("director-p1-current-scene-meta");

  const continuityMatrix = requiredElement<HTMLElement>("director-p1-continuity-matrix");
  const continuityFields = requiredElement<HTMLElement>("director-p1-continuity-fields");
  const continuityEmpty = requiredElement<HTMLElement>("director-p1-continuity-empty");
  const continuityCount = requiredElement<HTMLElement>("director-p1-continuity-count");
  const continuityEditor = requiredElement<HTMLFieldSetElement>("director-p1-continuity-editor");
  const continuityShot = requiredElement<HTMLOutputElement>("director-p1-continuity-shot");
  const continuityEntity = requiredElement<HTMLSelectElement>("director-p1-continuity-entity");
  const continuityDimension = requiredElement<HTMLSelectElement>("director-p1-continuity-dimension");
  const continuityMode = requiredElement<HTMLSelectElement>("director-p1-continuity-mode");
  const continuityLocks = requiredElement<HTMLTextAreaElement>("director-p1-continuity-locks");
  const continuitySource = requiredElement<HTMLOutputElement>("director-p1-continuity-source");

  const revisionList = requiredElement<HTMLOListElement>("director-p1-revision-list");
  const revisionEmpty = requiredElement<HTMLElement>("director-p1-revision-empty");
  const revisionCount = requiredElement<HTMLElement>("director-p1-revision-count");
  const historySummary = requiredElement<HTMLElement>("director-p1-history-summary");

  const takeList = requiredElement<HTMLElement>("director-p1-take-list");
  const takesPanel = requiredElement<HTMLDetailsElement>("director-p1-takes-panel");
  const takeEmpty = requiredElement<HTMLElement>("director-p1-take-empty");
  const takeCount = requiredElement<HTMLElement>("director-p1-take-count");
  const takeEditor = requiredElement<HTMLFieldSetElement>("director-p1-take-editor");
  const takeId = requiredElement<HTMLInputElement>("director-p1-take-id");
  const takeName = requiredElement<HTMLInputElement>("director-p1-take-name");
  const takeShot = requiredElement<HTMLSelectElement>("director-p1-take-shot");
  const takeAsset = requiredElement<HTMLSelectElement>("director-p1-take-asset");
  const takeRating = requiredElement<HTMLSelectElement>("director-p1-take-rating");
  const takeStatus = requiredElement<HTMLSelectElement>("director-p1-take-status");
  const takeNote = requiredElement<HTMLTextAreaElement>("director-p1-take-note");
  const takeArchive = requiredElement<HTMLButtonElement>("director-p1-take-archive");

  let state = normalizeProductionState(options.initialState);
  let activeShotId: string | null = activeShotsForP1(state)[0]?.id ?? null;
  let activeEntityId: string | null = null;
  let activeSceneId: string | null = activeScenes(state)[0]?.id ?? null;
  let assetOptions: readonly DirectorP1AssetOption[] = Object.freeze([]);

  const commit = (next: DirectorProductionState): void => {
    state = normalizeProductionState(next);
    if (activeShotId !== null && activeShotLocation(state, activeShotId) === null) activeShotId = null;
    if (activeSceneId !== null && !state.scenes.some((scene) => scene.id === activeSceneId && !scene.archived)) {
      activeSceneId = activeScenes(state)[0]?.id ?? null;
    }
    options.onChange(state);
    render();
  };

  const openEntity = (id: string | null): void => {
    const entity = id === null ? undefined : state.entities.find((candidate) => candidate.id === id);
    activeEntityId = entity?.id ?? null;
    entityId.value = entity?.id ?? "";
    entityType.value = entity?.kind ?? "character";
    entityName.value = entity?.name ?? "";
    entityDetails.value = entity?.notes ?? "";
    entityAsset.value = entity === undefined
      ? ""
      : productionBindingsForTarget(state, "entity", entity.id).find((binding) => binding.role === "reference")?.assetId ?? "";
    entityArchive.hidden = entity === undefined;
    entityEditor.hidden = false;
    entityName.focus();
  };

  const openScene = (id: string | null): void => {
    const scene = id === null ? undefined : state.scenes.find((candidate) => candidate.id === id);
    activeSceneId = scene?.id ?? activeSceneId;
    sceneId.value = scene?.id ?? "";
    sceneName.value = scene?.title ?? "";
    sceneSetting.value = scene?.notes ?? "";
    const allShots = activeShotsForP1(state);
    sceneShotRange.value = scene === undefined
      ? ""
      : scene.shots.filter((shot) => !shot.archived).map((shot) => allShots.findIndex((candidate) => candidate.id === shot.id) + 1).filter((index) => index > 0).join(", ");
    sceneArchive.hidden = scene === undefined;
    sceneEditor.hidden = false;
    sceneName.focus();
  };

  const openTake = (id: string | null): void => {
    const take = id === null ? undefined : state.takes.find((candidate) => candidate.id === id);
    takeId.value = take?.id ?? "";
    takeName.value = take?.name ?? "";
    takeShot.value = take?.shotId ?? activeShotId ?? takeShot.options[0]?.value ?? "";
    takeAsset.value = take?.assetId ?? "";
    takeRating.value = take?.rating === null || take?.rating === undefined ? "" : String(take.rating);
    takeStatus.value = take?.status === "archived" || take === undefined ? "candidate" : take.status;
    takeNote.value = take?.notes ?? "";
    takeArchive.hidden = take === undefined;
    takeShot.disabled = take !== undefined;
    takeEditor.hidden = false;
    takeAsset.focus();
  };

  function renderAssetSelectors(): void {
    const entitySelection = entityAsset.value;
    const takeSelection = takeAsset.value;
    const selectable = assetOptions.filter((asset) => asset.availability === "available");
    entityAsset.replaceChildren(new Option("不绑定素材", ""));
    takeAsset.replaceChildren(new Option(selectable.length === 0 ? "素材库中没有可用素材" : "请选择素材", ""));
    for (const asset of selectable) {
      const label = `${asset.displayName} · ${asset.mediaType === "image" ? "图片" : asset.mediaType === "video" ? "视频" : "音频"}`;
      entityAsset.add(new Option(label, asset.assetId));
      if (asset.mediaType === "video" || asset.mediaType === "audio") takeAsset.add(new Option(label, asset.assetId));
    }
    if ([...entityAsset.options].some((option) => option.value === entitySelection)) entityAsset.value = entitySelection;
    if ([...takeAsset.options].some((option) => option.value === takeSelection)) takeAsset.value = takeSelection;
    entityAsset.disabled = selectable.length === 0;
    takeAsset.disabled = takeAsset.options.length <= 1;
  }

  function renderCurrentShot(): void {
    const shots = activeShotsForP1(state);
    totalDuration.value = String(directorTimelineDuration(shots));
    totalDuration.textContent = `${totalDuration.value} 秒`;
    const index = activeShotId === null ? -1 : shots.findIndex((shot) => shot.id === activeShotId);
    const shot = index < 0 ? undefined : shots[index];
    currentShotDuration.disabled = shot === undefined;
    currentShotDuration.dataset.directorP1ShotId = shot?.id ?? "";
    if (shot !== undefined) currentShotDuration.value = String(shot.durationSeconds);
  }

  function renderEntities(): void {
    const entities = state.entities.filter((entity) => !entity.archived);
    entityList.replaceChildren();
    for (const entity of entities) {
      const item = cloneTemplate<HTMLElement>("director-p1-entity-template");
      item.dataset.directorP1EntityId = entity.id;
      const name = item.querySelector<HTMLElement>("[data-director-p1-entity-name]");
      const meta = item.querySelector<HTMLElement>("[data-director-p1-entity-meta]");
      if (name !== null) name.textContent = entity.name || "未命名实体";
      const binding = productionBindingsForTarget(state, "entity", entity.id).find((candidate) => candidate.role === "reference");
      const asset = binding === undefined ? undefined : assetOptions.find((candidate) => candidate.assetId === binding.assetId);
      if (meta !== null) meta.textContent = `${ENTITY_LABELS[entity.kind]}${asset === undefined ? "" : ` · ${asset.displayName}`}`;
      entityList.append(item);
    }
    entityCount.textContent = String(entities.length);
    entityEmpty.hidden = entities.length > 0;
    deletedEntityList.replaceChildren();
    for (const entity of state.entities.filter((candidate) => candidate.archived)) {
      const row = document.createElement("article");
      row.dataset.directorP1EntityId = entity.id;
      row.setAttribute("role", "listitem");
      const label = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = entity.name || "未命名实体";
      const detail = document.createElement("small");
      detail.textContent = ENTITY_LABELS[entity.kind];
      label.append(title, detail);
      const restore = document.createElement("button");
      restore.type = "button";
      restore.className = "button button--secondary button--small";
      restore.dataset.directorP1Action = "restore-entity";
      restore.textContent = "恢复";
      row.append(label, restore);
      deletedEntityList.append(row);
    }
  }

  function renderScenes(): void {
    const scenes = activeScenes(state);
    sceneList.replaceChildren();
    for (const scene of scenes) {
      const item = cloneTemplate<HTMLElement>("director-p1-scene-template");
      item.dataset.directorP1SceneId = scene.id;
      const name = item.querySelector<HTMLElement>("[data-director-p1-scene-name]");
      const meta = item.querySelector<HTMLElement>("[data-director-p1-scene-meta]");
      const select = item.querySelector<HTMLButtonElement>("[data-director-p1-action='select-scene']");
      if (name !== null) name.textContent = scene.title || "未命名场景";
      if (meta !== null) meta.textContent = `${scene.shots.filter((shot) => !shot.archived).length} 个镜头`;
      select?.setAttribute("aria-pressed", String(scene.id === activeSceneId));
      sceneList.append(item);
    }
    sceneCount.textContent = String(scenes.length);
    sceneEmpty.hidden = scenes.length > 0;
    deletedSceneList.replaceChildren();
    for (const scene of state.scenes.filter((candidate) => candidate.archived)) {
      const row = document.createElement("article");
      row.dataset.directorP1SceneId = scene.id;
      row.setAttribute("role", "listitem");
      const label = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = scene.title || "未命名场景";
      const detail = document.createElement("small");
      detail.textContent = `${scene.shots.filter((shot) => !shot.archived).length} 个镜头`;
      label.append(title, detail);
      const restore = document.createElement("button");
      restore.type = "button";
      restore.className = "button button--secondary button--small";
      restore.dataset.directorP1Action = "restore-scene";
      restore.textContent = "恢复";
      row.append(label, restore);
      deletedSceneList.append(row);
    }
    const current = activeSceneId === null ? undefined : state.scenes.find((scene) => scene.id === activeSceneId);
    currentSceneName.textContent = current?.title || "未分配场景";
    currentSceneMeta.textContent = current === undefined ? "镜头可独立编辑" : `${current.shots.filter((shot) => !shot.archived).length} 个镜头`;
  }

  function renderContinuity(): void {
    const shots = activeShotsForP1(state);
    const entities = state.entities.filter((entity) => !entity.archived);
    continuityEntity.replaceChildren(new Option("不新增实体关联", ""));
    for (const entity of entities) continuityEntity.add(new Option(`${ENTITY_LABELS[entity.kind]} · ${entity.name}`, entity.id));
    continuityEditor.hidden = activeShotId === null;
    continuityShot.textContent = activeShotId === null ? "未选择镜头" : `当前镜头 · ${activeShotId.slice(-10)}`;
    continuityMatrix.replaceChildren();
    const matrixByShotId = new Map(buildContinuityMatrix(state).map((row) => [row.shotId, row]));
    const matrix = shots.map((shot) => matrixByShotId.get(shot.id)).filter((row) => row !== undefined);
    for (const [index, row] of matrix.entries()) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "director-p1-matrix-row";
      button.dataset.directorP1ShotId = row.shotId;
      button.dataset.directorP1Action = "select-continuity-shot";
      const populated = row.cells.filter((cell) => cell.value.trim().length > 0);
      button.innerHTML = `<strong>镜头 ${index + 1}</strong><span>${populated.length === 0 ? "未设置" : populated.map((cell) => CONTINUITY_LABELS[cell.dimension]).join("、")}</span>`;
      button.classList.toggle("is-active", row.shotId === activeShotId);
      continuityMatrix.append(button);
    }
    continuityCount.textContent = String(matrix.reduce((count, row) => count + row.cells.filter((cell) => cell.value.trim().length > 0).length, 0));
    continuityEmpty.hidden = matrix.length > 0;
    continuityFields.replaceChildren();
    if (activeShotId === null) {
      const empty = document.createElement("p");
      empty.className = "director-p1-empty";
      empty.textContent = "先从时间线选择一个镜头，再检查它继承或覆盖的制作要求。";
      continuityFields.append(empty);
    } else {
      const location = activeShotLocation(state, activeShotId);
      const resolved = new Map(resolveShotContinuity(state, activeShotId).map((cell) => [cell.dimension, cell]));
      for (const dimension of CONTINUITY_DIMENSIONS) {
        const row = document.createElement("section");
        row.className = "director-p1-continuity-field";
        row.dataset.directorP1ContinuityDimension = dimension;
        row.dataset.directorP1ShotId = activeShotId;
        const copy = document.createElement("div");
        const label = document.createElement("strong");
        label.textContent = CONTINUITY_LABELS[dimension];
        const source = document.createElement("small");
        const resolvedCell = resolved.get(dimension);
        source.textContent = resolvedCell === undefined || resolvedCell.source === "empty"
          ? "当前没有可继承内容"
          : `${resolvedCell.source === "project" ? "项目固定设定" : resolvedCell.source === "scene" ? "场景设定" : "本镜头覆盖"}${resolvedCell.value.trim().length === 0 ? " · 空值" : ` · ${resolvedCell.value}`}`;
        copy.append(label, source);
        const controls = document.createElement("div");
        controls.className = "director-p1-continuity-modes";
        controls.setAttribute("role", "group");
        controls.setAttribute("aria-label", `${CONTINUITY_LABELS[dimension]}连续性状态`);
        const storedMode = location?.shot.continuity[dimension]?.mode ?? "unset";
        for (const mode of ["inherit", "override", "unset"] as const) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "button button--secondary";
          button.dataset.directorP1Action = "set-continuity-mode";
          button.dataset.directorP1ShotId = activeShotId;
          button.dataset.directorP1ContinuityDimension = dimension;
          button.dataset.directorP1ContinuityMode = mode;
          button.textContent = mode === "override" ? "编辑覆盖" : CONTINUITY_MODE_LABELS[mode];
          button.setAttribute("aria-pressed", String(storedMode === mode));
          controls.append(button);
        }
        row.append(copy, controls);
        continuityFields.append(row);
      }
    }
    const dimension = continuityDimension.value as ContinuityDimension;
    if (activeShotId !== null) {
      const resolved = resolveShotContinuity(state, activeShotId).find((cell) => cell.dimension === dimension);
      continuitySource.textContent = resolved === undefined || resolved.source === "empty"
        ? "当前无继承来源"
        : `当前来源：${resolved.source === "project" ? "项目" : resolved.source === "scene" ? "场景" : "本镜头"}${resolved.value.length > 0 ? ` · ${resolved.value}` : " · 显式空值"}`;
      const found = activeShotLocation(state, activeShotId);
      const cell = found?.shot.continuity[dimension];
      continuityMode.value = cell === undefined ? "unset" : cell.mode;
      continuityLocks.value = cell?.mode === "override" ? cell.value : "";
    } else {
      continuityMode.value = "unset";
      continuityLocks.value = "";
      continuitySource.textContent = "当前无继承来源";
    }
    continuityLocks.disabled = continuityMode.value !== "override";
  }

  function renderRevisions(): void {
    revisionList.replaceChildren();
    const revisions = [...state.revisions].reverse();
    for (const [index, revision] of revisions.entries()) {
      const item = cloneTemplate<HTMLLIElement>("director-p1-revision-template");
      item.dataset.directorP1RevisionId = revision.id;
      const name = item.querySelector<HTMLElement>("[data-director-p1-revision-name]");
      const meta = item.querySelector<HTMLElement>("[data-director-p1-revision-meta]");
      if (name !== null) name.textContent = `历史版本 ${state.revisions.length - index}`;
      if (meta !== null) meta.textContent = revision.createdAt || "本机快照";
      revisionList.append(item);
    }
    revisionCount.textContent = String(revisions.length);
    revisionEmpty.hidden = revisions.length > 0;
    historySummary.textContent = revisions.length === 0
      ? "尚无编译历史"
      : `${revisions.length} 个不可变历史版本 · 可恢复为新草稿`;
  }

  function renderTakes(): void {
    const shots = activeShotsForP1(state);
    takeShot.replaceChildren();
    for (const [index, shot] of shots.entries()) takeShot.add(new Option(`镜头 ${index + 1}`, shot.id));
    takeList.replaceChildren();
    const takes = state.takes.filter((take) => take.status !== "archived" && take.shotId === activeShotId);
    for (const take of takes) {
      const item = cloneTemplate<HTMLElement>("director-p1-take-template");
      item.dataset.directorP1TakeId = take.id;
      const name = item.querySelector<HTMLElement>("[data-director-p1-take-name]");
      const meta = item.querySelector<HTMLElement>("[data-director-p1-take-meta]");
      const asset = assetOptions.find((candidate) => candidate.assetId === take.assetId);
      if (name !== null) name.textContent = take.name || asset?.displayName || "旧版结果 · 待重新绑定素材";
      if (meta !== null) meta.textContent = `${TAKE_STATUS_LABELS[take.status]} · ${take.rating === null ? "未评分" : `${take.rating}/5`}${asset === undefined ? " · 素材不可用" : ` · ${asset.displayName}`}`;
      takeList.append(item);
    }
    takeCount.textContent = String(takes.length);
    takeEmpty.hidden = takes.length > 0;
    if (takes.length === 0 && takeEditor.hidden) takesPanel.open = false;
    requiredElement<HTMLButtonElement>("director-p1-take-add").disabled = shots.length === 0
      || activeShotId === null
      || state.activeRevisionId === null
      || takeAsset.options.length <= 1;
  }

  function render(): void {
    renderAssetSelectors();
    renderCurrentShot();
    renderEntities();
    renderScenes();
    renderContinuity();
    renderRevisions();
    renderTakes();
  }

  continuityDimension.addEventListener("change", renderContinuity);
  continuityMode.addEventListener("change", () => {
    continuityLocks.disabled = continuityMode.value !== "override";
    if (continuityMode.value !== "override") continuityLocks.value = "";
  });
  currentShotDuration.addEventListener("change", () => {
    if (activeShotId === null) return;
    const duration = Number(currentShotDuration.value);
    if (!ALLOWED_SHOT_DURATIONS.includes(duration as 5 | 10 | 15)) {
      options.onValidationError("镜头时长只能选择 5、10 或 15 秒。");
      renderCurrentShot();
      return;
    }
    commit(setProductionShotDuration(state, activeShotId, duration as 5 | 10 | 15));
  });

  root.addEventListener("click", async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-director-p1-action]");
    const action = button?.dataset.directorP1Action;
    if (button === null || action === undefined) return;
    const entityRecord = button.closest<HTMLElement>("[data-director-p1-entity-id]");
    const sceneRecord = button.closest<HTMLElement>("[data-director-p1-scene-id]");
    const revisionRecord = button.closest<HTMLElement>("[data-director-p1-revision-id]");
    const takeRecord = button.closest<HTMLElement>("[data-director-p1-take-id]");
    try {
      if (action === "add-entity") openEntity(null);
      if (action === "select-entity" || action === "edit-entity") openEntity(entityRecord?.dataset.directorP1EntityId ?? null);
      if (action === "save-entity") {
        if (entityName.value.trim().length === 0) throw new TypeError("请填写实体名称。");
        const knownEntityIds = new Set(state.entities.map((entity) => entity.id));
        let next = upsertProductionEntity(state, {
          ...(entityId.value.length > 0 ? { id: entityId.value } : {}),
          identityKey: entityId.value || window.crypto.randomUUID(),
          kind: entityType.value as ProductionEntityKind,
          name: entityName.value.trim(),
          notes: entityDetails.value
        });
        const targetEntityId = entityId.value || next.entities.find((entity) => !knownEntityIds.has(entity.id))?.id;
        if (targetEntityId === undefined) throw new Error("实体保存后未找到稳定 ID。");
        const referenceBindings = productionBindingsForTarget(next, "entity", targetEntityId)
          .filter((binding) => binding.role === "reference");
        if (entityAsset.value.length === 0) {
          for (const binding of referenceBindings) next = archiveProductionBinding(next, binding.id);
        } else {
          for (const binding of referenceBindings.filter((binding) => binding.assetId !== entityAsset.value)) {
            next = archiveProductionBinding(next, binding.id);
          }
          next = upsertProductionBinding(next, {
            identityKey: `entity-reference:${targetEntityId}`,
            targetKind: "entity",
            targetId: targetEntityId,
            assetId: entityAsset.value,
            role: "reference"
          });
        }
        activeEntityId = targetEntityId;
        commit(next);
        entityEditor.hidden = true;
      }
      if (action === "archive-entity" && entityId.value.length > 0) {
        const current = state.entities.find((entity) => entity.id === entityId.value);
        if (current === undefined) throw new RangeError("找不到需要删除的实体。");
        if (!await options.confirmAction({
          title: `删除实体“${current.name}”？`,
          message: "实体会移入回收站，可随时恢复；关联的本地素材不会被删除。",
          confirmLabel: "删除实体"
        })) return;
        commit(archiveProductionEntity(state, entityId.value));
        entityEditor.hidden = true;
      }
      if (action === "toggle-deleted-entities") deletedEntityList.hidden = !deletedEntityList.hidden;
      if (action === "restore-entity") {
        const requested = entityRecord?.dataset.directorP1EntityId;
        if (requested === undefined) throw new RangeError("找不到需要恢复的实体。");
        commit(restoreProductionEntity(state, requested));
      }
      if (action === "add-scene") openScene(null);
      if (action === "select-scene") {
        activeSceneId = sceneRecord?.dataset.directorP1SceneId ?? null;
        renderScenes();
      }
      if (action === "edit-scene") openScene(sceneRecord?.dataset.directorP1SceneId ?? null);
      if (action === "save-scene") {
        if (sceneName.value.trim().length === 0) throw new TypeError("请填写场景名称。");
        const existingSceneId = sceneId.value.trim();
        const knownSceneIds = new Set(state.scenes.map((scene) => scene.id));
        let next = upsertProductionScene(state, {
          ...(existingSceneId.length > 0 ? { id: existingSceneId } : {}),
          identityKey: existingSceneId || window.crypto.randomUUID(),
          title: sceneName.value.trim(),
          notes: sceneSetting.value
        });
        const target = existingSceneId || next.scenes.find((scene) => !knownSceneIds.has(scene.id))?.id;
        if (target === undefined) throw new Error("场景保存后未找到稳定 ID。");
        const selectedShotIds = parseShotRange(sceneShotRange.value, activeShotsForP1(next));
        next = replaceSceneMembership(next, target, selectedShotIds);
        activeSceneId = target;
        commit(next);
        sceneEditor.hidden = true;
      }
      if (action === "archive-scene" && sceneId.value.length > 0) {
        const archived = state.scenes.find((scene) => scene.id === sceneId.value);
        if (archived === undefined) throw new RangeError("找不到需要删除的场景。");
        const activeShotCount = archived.shots.filter((shot) => !shot.archived).length;
        if (activeShotCount > 0) throw new TypeError(`该场景仍包含 ${activeShotCount} 个镜头。请先把镜头移到其他场景，再删除场景。`);
        if (!await options.confirmAction({
          title: `删除场景“${archived.title}”？`,
          message: "场景会移入回收站，可以恢复。",
          confirmLabel: "删除场景"
        })) return;
        commit(archiveProductionScene(state, archived.id));
        sceneEditor.hidden = true;
      }
      if (action === "toggle-deleted-scenes") deletedSceneList.hidden = !deletedSceneList.hidden;
      if (action === "restore-scene") {
        const requested = sceneRecord?.dataset.directorP1SceneId;
        if (requested === undefined) throw new RangeError("找不到需要恢复的场景。");
        commit(restoreProductionScene(state, requested));
      }
      if (action === "select-continuity-shot") {
        const requestedShotId = button.dataset.directorP1ShotId ?? null;
        activeShotId = requestedShotId !== null && activeShotLocation(state, requestedShotId) !== null
          ? requestedShotId
          : null;
        renderContinuity();
      }
      if (action === "set-continuity-mode") {
        const requestedShotId = button.dataset.directorP1ShotId ?? null;
        const requestedDimension = button.dataset.directorP1ContinuityDimension as ContinuityDimension | undefined;
        const requestedMode = button.dataset.directorP1ContinuityMode;
        if (requestedShotId === null || activeShotLocation(state, requestedShotId) === null) {
          throw new RangeError("当前镜头已经不存在或已删除。");
        }
        if (requestedDimension === undefined || !CONTINUITY_DIMENSIONS.includes(requestedDimension)) {
          throw new TypeError("连续性字段无效。");
        }
        if (requestedMode !== "inherit" && requestedMode !== "override" && requestedMode !== "unset") {
          throw new TypeError("连续性状态无效。");
        }
        activeShotId = requestedShotId;
        continuityDimension.value = requestedDimension;
        if (requestedMode === "override") {
          continuityMode.value = "override";
          continuityLocks.disabled = false;
          continuityLocks.value = activeShotLocation(state, requestedShotId)?.shot.continuity[requestedDimension]?.value ?? "";
          continuityEditor.hidden = false;
          continuityLocks.focus();
        } else {
          const next = requestedMode === "unset"
            ? unsetShotContinuity(state, requestedShotId, requestedDimension)
            : setShotContinuity(state, requestedShotId, requestedDimension, { mode: "inherit", value: "" });
          commit(next);
        }
      }
      if (action === "save-continuity") {
        if (activeShotId === null) throw new TypeError("请先选择镜头。");
        let next = state;
        const found = activeShotLocation(next, activeShotId);
        if (found === null) throw new RangeError("当前镜头已经不存在或已删除。");
        if (continuityEntity.value.length > 0 && !found.shot.entityIds.includes(continuityEntity.value)) {
          next = assignShotToScene(next, found.scene.id, {
            id: found.shot.id,
            startSeconds: found.shot.startSeconds,
            durationSeconds: found.shot.durationSeconds,
            description: found.shot.description,
            cameraLanguage: found.shot.cameraLanguage,
            soundCue: found.shot.soundCue,
            transitionNote: found.shot.transitionNote,
            entityIds: [...found.shot.entityIds, continuityEntity.value]
          });
        }
        const dimension = continuityDimension.value as ContinuityDimension;
        next = continuityMode.value === "unset"
          ? unsetShotContinuity(next, activeShotId, dimension)
          : setShotContinuity(next, activeShotId, dimension, continuityMode.value === "override"
              ? { mode: "override", value: continuityLocks.value }
              : { mode: "inherit", value: "" });
        commit(next);
      }
      if (action === "restore-revision") {
        const revisionId = revisionRecord?.dataset.directorP1RevisionId;
        if (revisionId !== undefined) options.onRestoreRevision(revisionId);
      }
      if (action === "add-take") openTake(null);
      if (action === "edit-take") openTake(takeRecord?.dataset.directorP1TakeId ?? null);
      if (action === "save-take") {
        if (takeAsset.value.length === 0) throw new TypeError("请先从素材库选择本地成片或候选素材。");
        const rating = takeRating.value.length === 0 ? null : Number(takeRating.value);
        const status = takeStatus.value as ProductionTakeStatus;
        const selectedAssetName = assetOptions.find((asset) => asset.assetId === takeAsset.value)?.displayName ?? "本地候选素材";
        const next = takeId.value.length === 0
          ? addProductionTake(state, {
              identityKey: window.crypto.randomUUID(),
              name: takeName.value.trim() || selectedAssetName,
              shotId: takeShot.value,
              revisionId: state.activeRevisionId,
              assetId: takeAsset.value,
              notes: takeNote.value,
              rating,
              status,
              createdAt: new Date().toISOString()
            })
          : updateProductionTake(state, takeId.value, {
              assetId: takeAsset.value,
              name: takeName.value.trim(),
              notes: takeNote.value,
              rating,
              status
            });
        commit(next);
        takeEditor.hidden = true;
      }
      if (action === "archive-take" && takeId.value.length > 0) {
        commit(archiveProductionTake(state, takeId.value));
        takeEditor.hidden = true;
      }
    } catch (error) {
      options.onValidationError(error instanceof Error ? error.message : "制作数据未保存。");
    }
  });

  render();
  return Object.freeze({
    getState: () => state,
    setState: (next: DirectorProductionState) => {
      state = normalizeProductionState(next);
      if (activeShotId !== null && activeShotLocation(state, activeShotId) === null) activeShotId = null;
      if (activeSceneId === null || !state.scenes.some((scene) => scene.id === activeSceneId && !scene.archived)) {
        activeSceneId = activeScenes(state)[0]?.id ?? null;
      }
      render();
    },
    resetTransientEditors: () => {
      activeEntityId = null;
      activeSceneId = activeScenes(state)[0]?.id ?? null;
      entityId.value = "";
      entityType.value = "character";
      entityName.value = "";
      entityDetails.value = "";
      entityAsset.value = "";
      entityArchive.hidden = true;
      entityEditor.hidden = true;
      sceneId.value = "";
      sceneName.value = "";
      sceneSetting.value = "";
      sceneShotRange.value = "";
      sceneArchive.hidden = true;
      sceneEditor.hidden = true;
      takeId.value = "";
      takeName.value = "";
      takeAsset.value = "";
      takeRating.value = "";
      takeStatus.value = "candidate";
      takeNote.value = "";
      takeArchive.hidden = true;
      takeShot.disabled = false;
      takeEditor.hidden = true;
      render();
    },
    setAssetOptions: (assets: readonly DirectorP1AssetOption[]) => {
      assetOptions = Object.freeze(assets.map((asset) => Object.freeze({ ...asset })));
      render();
    },
    setActiveShot: (shotId: string | null) => {
      activeShotId = shotId !== null && activeShotLocation(state, shotId) !== null ? shotId : null;
      const location = activeShotId === null ? null : activeShotLocation(state, activeShotId);
      activeSceneId = location?.scene.id ?? activeSceneId;
      renderCurrentShot();
      renderScenes();
      renderContinuity();
      renderTakes();
    },
    focusField: (shotId: string, field: string) => {
      if (activeShotLocation(state, shotId) === null) return false;
      activeShotId = shotId;
      currentShotTools.hidden = false;
      options.onOpenShotDrawer?.(field === "take" ? "takes" : "details");
      if (field === "duration" || field === "durationSeconds") {
        renderCurrentShot();
        window.requestAnimationFrame(() => currentShotDuration.focus());
        return true;
      }
      if (!CONTINUITY_DIMENSIONS.includes(field as ContinuityDimension)) return false;
      continuityDimension.value = field;
      renderContinuity();
      window.requestAnimationFrame(() => continuityFields.querySelector<HTMLButtonElement>(
        `[data-director-p1-continuity-dimension="${CSS.escape(field)}"] [data-director-p1-action="set-continuity-mode"]`
      )?.focus());
      return true;
    },
    render
  });
}
