import type {
  AssetAvailability,
  AssetCopyToProjectResult,
  AssetImportBatchResult,
  AssetLibraryApi,
  AssetMediaType,
  AssetRecord,
  AssetRelocateConfirmResult,
  AssetRelocateResult,
  FrameSelection,
  FrameSlot
} from "../shared/ipc-contract";

export type AssetLibraryPhase = "idle" | "loading" | "ready" | "error";
export type AssetLibraryBusyAction =
  | "import"
  | "update"
  | "refresh"
  | "relocate"
  | "confirm_replacement"
  | "copy"
  | "prepare_frame"
  | null;

export interface AssetLibraryFilters {
  readonly query: string;
  readonly mediaType: AssetMediaType | "all";
  readonly availability: AssetAvailability | "all";
  readonly tags: readonly string[];
}

export interface AssetLibrarySnapshot {
  readonly phase: AssetLibraryPhase;
  readonly busyAction: AssetLibraryBusyAction;
  readonly filters: AssetLibraryFilters;
  readonly assets: readonly AssetRecord[];
  readonly total: number;
  readonly errorMessage: string | null;
  readonly lastImport: AssetImportBatchResult | null;
}

export class AssetLibraryOperationSupersededError extends Error {
  constructor() {
    super("素材库上下文已经切换，旧操作结果已丢弃。");
    this.name = "AssetLibraryOperationSupersededError";
  }
}

export interface AssetLibraryController {
  getSnapshot(): AssetLibrarySnapshot;
  subscribe(listener: (snapshot: AssetLibrarySnapshot) => void): () => void;
  invalidate(): AssetLibrarySnapshot;
  load(): Promise<AssetLibrarySnapshot>;
  setQuery(query: string): Promise<AssetLibrarySnapshot>;
  setFilters(filters: Partial<Omit<AssetLibraryFilters, "query">>): Promise<AssetLibrarySnapshot>;
  importSelected(): Promise<AssetImportBatchResult>;
  updateMetadata(input: {
    readonly assetId: string;
    readonly displayName: string;
    readonly tags: readonly string[];
    readonly note: string;
  }): Promise<AssetRecord>;
  refreshExistence(): Promise<AssetLibrarySnapshot>;
  relocate(assetId: string): Promise<AssetRelocateResult>;
  confirmReplacement(input: {
    readonly assetId: string;
    readonly relocationToken: string;
    readonly acceptReplacement: boolean;
  }): Promise<AssetRelocateConfirmResult>;
  copyToProject(assetId: string): Promise<AssetCopyToProjectResult>;
  prepareFrame(assetId: string, slot: FrameSlot): Promise<FrameSelection>;
}

const INITIAL_FILTERS: AssetLibraryFilters = Object.freeze({
  query: "",
  mediaType: "all",
  availability: "all",
  tags: Object.freeze([])
});

function frozenSnapshot(value: AssetLibrarySnapshot): AssetLibrarySnapshot {
  return Object.freeze({
    ...value,
    filters: Object.freeze({ ...value.filters, tags: Object.freeze([...value.filters.tags]) }),
    assets: Object.freeze([...value.assets])
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "本地素材操作未完成，请重试。";
}

export function createAssetLibraryController(api: AssetLibraryApi): AssetLibraryController {
  const listeners = new Set<(snapshot: AssetLibrarySnapshot) => void>();
  let listRequestGeneration = 0;
  let actionGeneration = 0;
  let snapshot = frozenSnapshot({
    phase: "idle",
    busyAction: null,
    filters: INITIAL_FILTERS,
    assets: Object.freeze([]),
    total: 0,
    errorMessage: null,
    lastImport: null
  });

  const publish = (patch: Partial<AssetLibrarySnapshot>): AssetLibrarySnapshot => {
    snapshot = frozenSnapshot({ ...snapshot, ...patch });
    for (const listener of listeners) listener(snapshot);
    return snapshot;
  };

  const load = async (): Promise<AssetLibrarySnapshot> => {
    const requestGeneration = ++listRequestGeneration;
    const requestedFilters = Object.freeze({
      ...snapshot.filters,
      tags: Object.freeze([...snapshot.filters.tags])
    });
    publish({ phase: "loading", errorMessage: null });
    try {
      const result = await api.listLocalAssets(requestedFilters);
      if (requestGeneration !== listRequestGeneration) return snapshot;
      return publish({
        phase: "ready",
        assets: result.assets,
        total: result.total,
        errorMessage: null
      });
    } catch (error: unknown) {
      if (requestGeneration !== listRequestGeneration) return snapshot;
      publish({ phase: "error", errorMessage: errorMessage(error) });
      throw error;
    }
  };

  const runAction = async <T>(
    busyAction: Exclude<AssetLibraryBusyAction, null>,
    operation: () => Promise<T>,
    reloadAfter: boolean
  ): Promise<T> => {
    if (snapshot.busyAction !== null) throw new Error("另一项本地素材操作仍在进行，请稍候。");
    const requestedActionGeneration = actionGeneration;
    publish({ busyAction, errorMessage: null });
    try {
      const result = await operation();
      if (requestedActionGeneration !== actionGeneration) throw new AssetLibraryOperationSupersededError();
      if (reloadAfter) {
        await load();
        if (requestedActionGeneration !== actionGeneration) throw new AssetLibraryOperationSupersededError();
      }
      publish({ busyAction: null, errorMessage: null });
      return result;
    } catch (error: unknown) {
      if (requestedActionGeneration !== actionGeneration) throw new AssetLibraryOperationSupersededError();
      publish({ busyAction: null, phase: "error", errorMessage: errorMessage(error) });
      throw error;
    }
  };

  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe: (listener: (snapshot: AssetLibrarySnapshot) => void) => {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
    invalidate: () => {
      listRequestGeneration += 1;
      actionGeneration += 1;
      return publish({
        phase: "idle",
        busyAction: null,
        assets: Object.freeze([]),
        total: 0,
        errorMessage: null,
        lastImport: null
      });
    },
    load,
    setQuery: async (query: string) => {
      publish({ filters: Object.freeze({ ...snapshot.filters, query }) });
      return await load();
    },
    setFilters: async (filters: Partial<Omit<AssetLibraryFilters, "query">>) => {
      publish({
        filters: Object.freeze({
          ...snapshot.filters,
          ...filters,
          tags: Object.freeze([...(filters.tags ?? snapshot.filters.tags)])
        })
      });
      return await load();
    },
    importSelected: async () => {
      const result = await runAction("import", () => api.importLocalAssets(), true);
      publish({ lastImport: result });
      return result;
    },
    updateMetadata: (input: {
      readonly assetId: string;
      readonly displayName: string;
      readonly tags: readonly string[];
      readonly note: string;
    }) => runAction("update", () => api.updateLocalAsset(input), true),
    refreshExistence: async () => {
      await runAction("refresh", () => api.refreshLocalAssets(), true);
      return snapshot;
    },
    relocate: (assetId: string) => runAction("relocate", () => api.relocateLocalAsset({ assetId }), true),
    confirmReplacement: (input: {
      readonly assetId: string;
      readonly relocationToken: string;
      readonly acceptReplacement: boolean;
    }) => runAction(
      "confirm_replacement",
      () => api.confirmLocalAssetReplacement(input),
      true
    ),
    copyToProject: (assetId: string) => runAction(
      "copy",
      () => api.copyLocalAssetToProject({ assetId }),
      true
    ),
    prepareFrame: (assetId: string, slot: FrameSlot) => runAction(
      "prepare_frame",
      () => api.prepareLocalAssetFrame({ assetId, slot }),
      false
    )
  });
}
