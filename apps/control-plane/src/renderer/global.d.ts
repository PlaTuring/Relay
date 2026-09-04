import type { RendererControlPlaneApi } from "../shared/ipc-contract";

declare global {
  interface Window {
    readonly controlPlane: RendererControlPlaneApi;
  }
}

export {};
