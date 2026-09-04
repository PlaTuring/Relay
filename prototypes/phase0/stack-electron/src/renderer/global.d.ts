import type { ControlPlaneApi } from "../shared/contracts";

declare global {
  interface Window {
    readonly controlPlane: ControlPlaneApi;
  }
}

export {};
