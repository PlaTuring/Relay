export class LocalRuntimeError extends Error {
  constructor(code, stage, ruleId, exitCode = 2) {
    super(code);
    this.name = "LocalRuntimeError";
    this.code = code;
    this.stage = stage;
    this.rule_id = ruleId;
    this.exit_code = exitCode;
    Object.defineProperty(this, "stack", {
      configurable: false,
      enumerable: false,
      value: `${this.name}: ${this.code}`,
      writable: false
    });
    Object.freeze(this);
  }

  toJSON() {
    return Object.freeze({
      code: this.code,
      rule_id: this.rule_id,
      stage: this.stage
    });
  }
}

export function runtimeFail(code, stage, ruleId, exitCode = 2) {
  throw new LocalRuntimeError(code, stage, ruleId, exitCode);
}

export function publicError(error) {
  if (error instanceof LocalRuntimeError) return error.toJSON();
  if (
    error &&
    typeof error === "object" &&
    typeof error.code === "string" &&
    typeof error.rule_id === "string"
  ) {
    return Object.freeze({
      code: error.code,
      rule_id: error.rule_id,
      stage: typeof error.stage === "string" ? error.stage : "dependency"
    });
  }
  return Object.freeze({
    code: "LOCAL_RUNTIME.INTERNAL",
    rule_id: "local_runtime.error.internal",
    stage: "internal"
  });
}
