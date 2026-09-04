import type {
  ControlPlaneErrorCode,
  ControlPlanePublicError
} from "../../shared/ipc-contract.js";

export class ControlPlaneServiceError extends Error {
  readonly code: ControlPlaneErrorCode;

  constructor(code: ControlPlaneErrorCode, message: string) {
    super(message);
    this.name = "ControlPlaneError";
    this.code = code;
  }
}

export function toControlPlanePublicError(error: unknown): ControlPlanePublicError {
  if (error instanceof ControlPlaneServiceError) {
    return Object.freeze({
      name: "ControlPlaneError",
      code: error.code,
      message: error.message
    });
  }

  return Object.freeze({
    name: "ControlPlaneError",
    code: "ADAPTER_FAILED",
    message: "操作未完成，请重试。"
  });
}
