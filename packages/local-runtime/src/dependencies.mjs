import {
  CatalogLoaderError,
  createEmbeddedCatalogLoader
} from "../../installer/catalog-loader/src/index.mjs";
import {
  DownloadSidecarError,
  attachIntegrity,
  parseCanonicalSidecar,
  serializeCanonicalSidecar,
  sidecarAuthority,
  validateInitialSidecar,
  validateSidecar,
  validateTransition
} from "../../installer/download-sidecar/src/index.mjs";

import { runtimeFail } from "./errors.mjs";
import { assertClosedObject, deepFreeze } from "./util.mjs";

function decodeBase64(value, stage, ruleId, maximumBytes = 64 * 1024 * 1024) {
  if (typeof value !== "string" || value.length === 0 || value.length > Math.ceil(maximumBytes * 4 / 3) + 4 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) {
    runtimeFail("LOCAL_RUNTIME.INVALID_BASE64", stage, ruleId);
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.byteLength === 0 || bytes.byteLength > maximumBytes || bytes.toString("base64") !== value) {
    runtimeFail("LOCAL_RUNTIME.INVALID_BASE64", stage, ruleId);
  }
  return bytes;
}

export function loadEmbeddedCatalogFromJson(input) {
  assertClosedObject(input, new Set(["current_app", "trusted_inventory_keys", "signed_build_inventory_base64", "resources"]), "catalog", "local_runtime.catalog.input");
  if (!Array.isArray(input.trusted_inventory_keys) || input.trusted_inventory_keys.length === 0 || input.trusted_inventory_keys.length > 16) {
    runtimeFail("LOCAL_RUNTIME.INVALID_REQUEST", "catalog", "local_runtime.catalog.trust_keys_bounded");
  }
  const trustedKeys = input.trusted_inventory_keys.map((key) => {
    assertClosedObject(key, new Set(["key_id", "algorithm", "public_key_spki_der_base64"]), "catalog", "local_runtime.catalog.trust_key");
    return {
      key_id: key.key_id,
      algorithm: key.algorithm,
      public_key_spki_der: decodeBase64(key.public_key_spki_der_base64, "catalog", "local_runtime.catalog.spki_base64", 4096)
    };
  });
  if (!Array.isArray(input.resources) || input.resources.length === 0 || input.resources.length > 100_000) {
    runtimeFail("LOCAL_RUNTIME.INVALID_REQUEST", "catalog", "local_runtime.catalog.resources_bounded");
  }
  const resources = input.resources.map((resource) => {
    assertClosedObject(resource, new Set(["resource", "role", "bytes_base64"]), "catalog", "local_runtime.catalog.resource");
    if (resource.role === "component_catalog") {
      return {
        resource: resource.resource,
        role: resource.role,
        bytes: decodeBase64(resource.bytes_base64, "catalog", "local_runtime.catalog.resource_bytes")
      };
    }
    if (resource.role === "other_embedded_resource" && resource.bytes_base64 === undefined) {
      return { resource: resource.resource, role: resource.role };
    }
    runtimeFail("LOCAL_RUNTIME.INVALID_REQUEST", "catalog", "local_runtime.catalog.resource_role");
  });
  try {
    const loader = createEmbeddedCatalogLoader({ current_app: input.current_app, trusted_inventory_keys: trustedKeys });
    const handle = loader.load({
      signed_build_inventory: decodeBase64(input.signed_build_inventory_base64, "catalog", "local_runtime.catalog.inventory_base64"),
      embedded_resource_index: { kind: "complete_current_app_embedded_resource_index", resources }
    });
    return deepFreeze({
      kind: handle.kind,
      schema_digest: handle.schema_digest,
      content_sha256: handle.content_sha256,
      component_count: handle.component_count,
      license_record_count: handle.license_record_count,
      metadata: handle.metadata,
      components: [...handle.components()].map((component) => ({
        component_id: component.component_id,
        component_version: component.component_version,
        component_role: component.component_role,
        release_state: component.release_state,
        disposition: component.disposition
      }))
    });
  } catch (error) {
    if (error instanceof CatalogLoaderError) throw error;
    throw error;
  }
}

export function runSidecarOperation(input) {
  assertClosedObject(input, new Set(["operation", "document", "previous", "active_lease", "initial"]), "sidecar", "local_runtime.sidecar.input");
  try {
    if (input.operation === "authority") return deepFreeze(sidecarAuthority());
    if (input.operation === "attach_integrity") return attachIntegrity(input.document);
    if (input.operation === "validate") {
      const value = input.initial
        ? validateInitialSidecar(input.document, { activeLease: input.active_lease })
        : validateSidecar(input.document, { activeLease: input.active_lease });
      return deepFreeze({ valid: true, document_revision: value.document_revision, state: value.state });
    }
    if (input.operation === "transition") {
      const value = validateTransition(input.previous, input.document, { activeLease: input.active_lease });
      return deepFreeze({ valid: true, document_revision: value.document_revision, state: value.state });
    }
    if (input.operation === "serialize") {
      const bytes = serializeCanonicalSidecar(input.document, {
        activeLease: input.active_lease,
        previous: input.previous,
        initial: input.initial === true
      });
      return deepFreeze({ encoding: "base64", value: Buffer.from(bytes).toString("base64") });
    }
    if (input.operation === "parse") {
      const bytes = decodeBase64(input.document, "sidecar", "local_runtime.sidecar.document_base64");
      const value = parseCanonicalSidecar(bytes, {
        activeLease: input.active_lease,
        previous: input.previous,
        initial: input.initial === true
      });
      return deepFreeze(value);
    }
    runtimeFail("LOCAL_RUNTIME.UNKNOWN_OPERATION", "sidecar", "local_runtime.sidecar.operation");
  } catch (error) {
    if (error instanceof DownloadSidecarError) throw error;
    throw error;
  }
}

export async function observeMediaCapabilities(request) {
  const { probeMediaCapabilities } = await import("../../detection/media-capability/src/index.ts");
  return deepFreeze(await probeMediaCapabilities(request));
}
