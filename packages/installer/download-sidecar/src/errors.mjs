const SENSITIVE_OWNER_PATH = "/lease/owner";
const PUBLIC_PATH_SEGMENTS = new Set([
  "<redacted>",
  "active",
  "artifact_byte_length",
  "artifact_sha256",
  "authority",
  "byte_length",
  "component_id",
  "component_manifest",
  "component_version",
  "content_sha256",
  "contract_id",
  "deletion_authority",
  "document_id",
  "document_revision",
  "download_authority",
  "end_inclusive",
  "execution_authority",
  "expected_artifact_sha256",
  "expected_byte_length",
  "identity",
  "integrity",
  "kind",
  "lease",
  "lease_id",
  "locator",
  "materialization_authority",
  "mode",
  "network_authority",
  "owner",
  "ownership_authority",
  "partial",
  "profile",
  "queue_authority",
  "received_range",
  "relative_path",
  "resource_key",
  "resource_type",
  "retry_generation",
  "revision",
  "schema_version",
  "source",
  "source_locator",
  "source_revision",
  "start_inclusive",
  "state",
  "strong_etag",
  "verification_authority"
]);

function redactInstancePath(instancePath) {
  if (instancePath.startsWith(`${SENSITIVE_OWNER_PATH}/`)) return SENSITIVE_OWNER_PATH;
  if (instancePath === "") return "";
  const segments = instancePath.slice(1).split("/");
  return `/${segments
    .map((segment) => (PUBLIC_PATH_SEGMENTS.has(segment) ? segment : "<redacted>"))
    .join("/")}`;
}

export class DownloadSidecarError extends Error {
  constructor({ code, instancePath = "", ruleId }) {
    super(code);
    this.name = "DownloadSidecarError";
    this.code = code;
    this.instance_path = redactInstancePath(instancePath);
    this.rule_id = ruleId;
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
      instance_path: this.instance_path,
      rule_id: this.rule_id
    });
  }
}

export function fail(code, instancePath, ruleId) {
  throw new DownloadSidecarError({ code, instancePath, ruleId });
}

export function toPublicError(error) {
  if (error instanceof DownloadSidecarError) return error.toJSON();
  return Object.freeze({
    code: "SIDECAR.INTERNAL",
    instance_path: "",
    rule_id: "sidecar.error.internal"
  });
}
