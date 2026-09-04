export class CatalogLoaderError extends Error {
  constructor({
    code,
    stage,
    instancePath = "",
    ruleId,
    byteOffset,
    contractId,
    schemaVersion
  }) {
    super(code);
    this.name = "CatalogLoaderError";
    this.code = code;
    this.stage = stage;
    this.instance_path = instancePath;
    this.rule_id = ruleId;
    if (Number.isSafeInteger(byteOffset) && byteOffset >= 0) this.byte_offset = byteOffset;
    if (contractId) this.contract_id = contractId;
    if (schemaVersion) this.schema_version = schemaVersion;
    Object.freeze(this);
  }
}

export function loaderError(details) {
  return new CatalogLoaderError(details);
}

export function throwLoaderError(code, stage, instancePath, ruleId, byteOffset) {
  throw loaderError({ code, stage, instancePath, ruleId, byteOffset });
}
