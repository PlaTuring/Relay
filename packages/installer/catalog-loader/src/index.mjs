import { createPublicKey, verify } from "node:crypto";

import { CatalogLoaderError, loaderError } from "./errors.mjs";
import {
  COMPONENT_MANIFEST_SCHEMA_DIGEST,
  contractRelativePathIssue,
  validateComponentManifest
} from "./manifest-validator.mjs";
import { canonicalJson, parseStrictJson } from "./strict-json.mjs";

const DOMAIN_ID = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/u;
const SEMVER = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const MUTABLE_SEGMENT = /^(?:latest|main|master|head|current|branch)(?:[._-].*)?$/iu;
const REMOTE_OPTION_FIELDS = new Set([
  "catalog_uri",
  "catalog_url",
  "discovery_uri",
  "fallback",
  "remote_fallback",
  "remote_override",
  "override",
  "url",
  "uri"
]);

function fail(code, stage, instancePath, ruleId) {
  throw loaderError({ code, stage, instancePath, ruleId });
}

function pointerToken(value) {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function isDataObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  if (Object.getOwnPropertySymbols(value).length !== 0) return false;
  return Object.values(Object.getOwnPropertyDescriptors(value)).every(
    (descriptor) => "value" in descriptor && descriptor.enumerable
  );
}

function assertDataArray(value, instancePath, stage, maximumLength) {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0 ||
    value.length > maximumLength
  ) {
    fail("CATALOG.INVALID_DATA_SHAPE", stage, instancePath, "catalog.input.plain_array_only");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      fail("CATALOG.INVALID_DATA_SHAPE", stage, instancePath, "catalog.input.dense_array_only");
    }
  }
  for (const key of Object.keys(descriptors)) {
    if (key === "length") continue;
    if (!/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= value.length) {
      fail("CATALOG.INVALID_DATA_SHAPE", stage, instancePath, "catalog.input.array_fields_closed");
    }
  }
}

function assertDataObject(value, instancePath, stage) {
  if (!isDataObject(value)) {
    fail("CATALOG.INVALID_DATA_SHAPE", stage, instancePath, "catalog.input.plain_data_only");
  }
}

function assertExactFields(value, allowed, instancePath, stage) {
  assertDataObject(value, instancePath, stage);
  for (const key of Object.keys(value)) {
    if (allowed.has(key)) continue;
    if (REMOTE_OPTION_FIELDS.has(key)) {
      fail(
        "CATALOG.REMOTE_DISCOVERY_FORBIDDEN",
        stage,
        `${instancePath}/${pointerToken(key)}`,
        "catalog.remote.discovery_override_fallback_forbidden"
      );
    }
    fail(
      "CATALOG.UNKNOWN_FIELD",
      stage,
      `${instancePath}/${pointerToken(key)}`,
      "catalog.input.closed"
    );
  }
  for (const key of allowed) {
    if (!Object.hasOwn(value, key)) {
      fail(
        "CATALOG.REQUIRED_FIELD_MISSING",
        stage,
        `${instancePath}/${pointerToken(key)}`,
        "catalog.input.required_fields"
      );
    }
  }
}

function assertDomainId(value, instancePath, stage) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    !DOMAIN_ID.test(value)
  ) {
    fail("CATALOG.INVALID_IDENTITY", stage, instancePath, "catalog.identity.domain_id");
  }
}

function assertImmutableId(value, instancePath, stage) {
  assertDomainId(value, instancePath, stage);
  if (value.split(/[-_.]/u).some((segment) => MUTABLE_SEGMENT.test(segment))) {
    fail(
      "CATALOG.MUTABLE_REFERENCE_FORBIDDEN",
      stage,
      instancePath,
      "catalog.identity.mutable_segment_forbidden"
    );
  }
}

function assertSemver(value, instancePath, stage) {
  if (typeof value !== "string" || !SEMVER.test(value)) {
    fail("CATALOG.INVALID_APP_VERSION", stage, instancePath, "catalog.identity.exact_semver");
  }
}

function assertCatalogResource(value, instancePath, stage) {
  if (typeof value === "string" && /^(?:https?|ftp|file|data|ws|wss):/iu.test(value)) {
    fail(
      "CATALOG.REMOTE_DISCOVERY_FORBIDDEN",
      stage,
      instancePath,
      "catalog.resource.embedded_relative_only"
    );
  }
  const pathIssue = contractRelativePathIssue(value, instancePath);
  if (pathIssue) {
    fail("CATALOG.INVALID_RESOURCE", stage, instancePath, "catalog.resource.contract_relative");
  }
  if (/%[0-9a-f]{2}/iu.test(value)) {
    fail("CATALOG.INVALID_RESOURCE", stage, instancePath, "catalog.resource.no_percent_encoding");
  }
  if (value.split("/").some((segment) => MUTABLE_SEGMENT.test(segment))) {
    fail(
      "CATALOG.MUTABLE_REFERENCE_FORBIDDEN",
      stage,
      instancePath,
      "catalog.resource.mutable_segment_forbidden"
    );
  }
}

function assertOtherEmbeddedResource(value, instancePath, stage) {
  if (typeof value === "string" && /^(?:https?|ftp|file|data|ws|wss):/iu.test(value)) {
    fail(
      "CATALOG.REMOTE_DISCOVERY_FORBIDDEN",
      stage,
      instancePath,
      "catalog.resource.embedded_relative_only"
    );
  }
  if (contractRelativePathIssue(value, instancePath) || /%[0-9a-f]{2}/iu.test(value)) {
    fail("CATALOG.INVALID_RESOURCE", stage, instancePath, "catalog.resource.contract_relative");
  }
}

function validateCurrentApp(value) {
  assertExactFields(
    value,
    new Set(["app_id", "app_version", "app_build_id"]),
    "/current_app",
    "configuration"
  );
  if (value.app_id !== "minimax-h3-tool") {
    fail(
      "CATALOG.CURRENT_APP_IDENTITY_INVALID",
      "configuration",
      "/current_app/app_id",
      "catalog.current_app.app_id_exact"
    );
  }
  assertSemver(value.app_version, "/current_app/app_version", "configuration");
  assertImmutableId(value.app_build_id, "/current_app/app_build_id", "configuration");
  return Object.freeze({
    app_id: value.app_id,
    app_version: value.app_version,
    app_build_id: value.app_build_id
  });
}

function validateTrustAnchors(value) {
  if (!Array.isArray(value) || value.length === 0) {
    fail(
      "CATALOG.TRUST_ANCHOR_SET_INVALID",
      "configuration",
      "/trusted_inventory_keys",
      "catalog.inventory.trust_anchor_set_bounded"
    );
  }
  assertDataArray(value, "/trusted_inventory_keys", "configuration", 16);
  const keys = new Map();
  value.forEach((candidate, index) => {
    const prefix = `/trusted_inventory_keys/${index}`;
    assertExactFields(
      candidate,
      new Set(["key_id", "algorithm", "public_key_spki_der"]),
      prefix,
      "configuration"
    );
    assertDomainId(candidate.key_id, `${prefix}/key_id`, "configuration");
    if (candidate.algorithm !== "ed25519") {
      fail(
        "CATALOG.TRUST_ANCHOR_ALGORITHM_INVALID",
        "configuration",
        `${prefix}/algorithm`,
        "catalog.inventory.ed25519_only"
      );
    }
    if (!(candidate.public_key_spki_der instanceof Uint8Array)) {
      fail(
        "CATALOG.TRUST_ANCHOR_INVALID",
        "configuration",
        `${prefix}/public_key_spki_der`,
        "catalog.inventory.spki_der_bytes"
      );
    }
    if (
      candidate.public_key_spki_der.byteLength === 0 ||
      candidate.public_key_spki_der.byteLength > 4096
    ) {
      fail(
        "CATALOG.TRUST_ANCHOR_INVALID",
        "configuration",
        `${prefix}/public_key_spki_der`,
        "catalog.inventory.spki_der_size_bounded"
      );
    }
    if (keys.has(candidate.key_id)) {
      fail(
        "CATALOG.TRUST_ANCHOR_DUPLICATE",
        "configuration",
        `${prefix}/key_id`,
        "catalog.inventory.trust_anchor_id_unique"
      );
    }
    let key;
    try {
      key = createPublicKey({
        key: Buffer.from(candidate.public_key_spki_der),
        format: "der",
        type: "spki"
      });
    } catch {
      fail(
        "CATALOG.TRUST_ANCHOR_INVALID",
        "configuration",
        `${prefix}/public_key_spki_der`,
        "catalog.inventory.spki_der_ed25519"
      );
    }
    if (key.asymmetricKeyType !== "ed25519") {
      fail(
        "CATALOG.TRUST_ANCHOR_INVALID",
        "configuration",
        `${prefix}/public_key_spki_der`,
        "catalog.inventory.spki_der_ed25519"
      );
    }
    const canonicalDer = key.export({ format: "der", type: "spki" });
    if (
      canonicalDer.byteLength !== candidate.public_key_spki_der.byteLength ||
      Buffer.compare(canonicalDer, candidate.public_key_spki_der) !== 0
    ) {
      fail(
        "CATALOG.TRUST_ANCHOR_INVALID",
        "configuration",
        `${prefix}/public_key_spki_der`,
        "catalog.inventory.spki_der_canonical"
      );
    }
    keys.set(candidate.key_id, key);
  });
  return keys;
}

function simpleOrdinalFold(value) {
  return [...value]
    .map((character) => {
      const upper = character.toUpperCase();
      return [...upper].length === 1 ? upper : character;
    })
    .join("");
}

function selectCatalogResource(resourceIndex) {
  assertExactFields(
    resourceIndex,
    new Set(["kind", "resources"]),
    "/embedded_resource_index",
    "resource_index"
  );
  if (resourceIndex.kind !== "complete_current_app_embedded_resource_index") {
    fail(
      "CATALOG.RESOURCE_INDEX_INCOMPLETE",
      "resource_index",
      "/embedded_resource_index/kind",
      "catalog.resource_index.complete_enumeration_required"
    );
  }
  if (!Array.isArray(resourceIndex.resources)) {
    fail(
      "CATALOG.RESOURCE_INDEX_INVALID",
      "resource_index",
      "/embedded_resource_index/resources",
      "catalog.resource_index.bounded_array"
    );
  }
  assertDataArray(
    resourceIndex.resources,
    "/embedded_resource_index/resources",
    "resource_index",
    100_000
  );
  const names = new Map();
  const catalogs = [];
  resourceIndex.resources.forEach((resource, index) => {
    const prefix = `/embedded_resource_index/resources/${index}`;
    assertDataObject(resource, prefix, "resource_index");
    if (Object.hasOwn(resource, "uri") || Object.hasOwn(resource, "url")) {
      const locatorKey = Object.hasOwn(resource, "uri") ? "uri" : "url";
      fail(
        "CATALOG.REMOTE_DISCOVERY_FORBIDDEN",
        "resource_index",
        `${prefix}/${locatorKey}`,
        "catalog.resource_index.network_locator_forbidden"
      );
    }
    if (resource.role === "component_catalog") {
      assertExactFields(
        resource,
        new Set(["resource", "role", "bytes"]),
        prefix,
        "resource_index"
      );
    } else if (resource.role === "other_embedded_resource") {
      assertExactFields(
        resource,
        new Set(["resource", "role"]),
        prefix,
        "resource_index"
      );
    } else {
      fail(
        "CATALOG.RESOURCE_ROLE_INVALID",
        "resource_index",
        `${prefix}/role`,
        "catalog.resource_index.closed_roles"
      );
    }
    if (resource.role === "component_catalog") {
      assertCatalogResource(resource.resource, `${prefix}/resource`, "resource_index");
    } else {
      assertOtherEmbeddedResource(resource.resource, `${prefix}/resource`, "resource_index");
    }
    const folded = simpleOrdinalFold(resource.resource);
    if (names.has(folded)) {
      fail(
        "CATALOG.RESOURCE_NAME_COLLISION",
        "resource_index",
        `${prefix}/resource`,
        "catalog.resource_index.windows_ordinal_unique"
      );
    }
    names.set(folded, resource.resource);
    if (resource.role === "component_catalog") {
      if (!(resource.bytes instanceof Uint8Array)) {
        fail(
          "CATALOG.RESOURCE_BYTES_INVALID",
          "resource_index",
          `${prefix}/bytes`,
          "catalog.resource_index.catalog_bytes_required"
        );
      }
      catalogs.push({ resource: resource.resource, bytes: resource.bytes });
    }
  });
  if (catalogs.length !== 1) {
    fail(
      "CATALOG.CARDINALITY_INVALID",
      "resource_index",
      "/embedded_resource_index/resources",
      "catalog.resource_index.exactly_one_catalog"
    );
  }
  return catalogs[0];
}

function parseBase64Signature(value, instancePath) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]{86}==$/u.test(value)) {
    fail(
      "CATALOG.INVENTORY_SIGNATURE_INVALID",
      "inventory_signature",
      instancePath,
      "catalog.inventory.ed25519_signature_encoding"
    );
  }
  const signature = Buffer.from(value, "base64");
  if (signature.length !== 64 || signature.toString("base64") !== value) {
    fail(
      "CATALOG.INVENTORY_SIGNATURE_INVALID",
      "inventory_signature",
      instancePath,
      "catalog.inventory.ed25519_signature_encoding"
    );
  }
  return signature;
}

function validateSignedInventory(bytes, trustedKeys, currentApp) {
  const envelope = parseStrictJson(bytes, {
    stage: "inventory_parse",
    requireCanonicalBytes: true
  });
  assertExactFields(
    envelope,
    new Set(["envelope_version", "payload", "signature"]),
    "",
    "inventory_envelope"
  );
  if (envelope.envelope_version !== "1.0.0") {
    fail(
      "CATALOG.INVENTORY_VERSION_UNSUPPORTED",
      "inventory_envelope",
      "/envelope_version",
      "catalog.inventory.envelope_version_exact"
    );
  }
  assertExactFields(
    envelope.signature,
    new Set(["algorithm", "key_id", "encoding", "value"]),
    "/signature",
    "inventory_envelope"
  );
  if (envelope.signature.algorithm !== "ed25519" || envelope.signature.encoding !== "base64") {
    fail(
      "CATALOG.INVENTORY_SIGNATURE_POLICY_INVALID",
      "inventory_signature",
      "/signature/algorithm",
      "catalog.inventory.ed25519_base64_only"
    );
  }
  assertDomainId(envelope.signature.key_id, "/signature/key_id", "inventory_signature");
  const key = trustedKeys.get(envelope.signature.key_id);
  if (!key) {
    fail(
      "CATALOG.INVENTORY_TRUST_ANCHOR_UNKNOWN",
      "inventory_signature",
      "/signature/key_id",
      "catalog.inventory.key_must_be_app_trusted"
    );
  }
  const signature = parseBase64Signature(envelope.signature.value, "/signature/value");
  let authentic = false;
  try {
    authentic = verify(
      null,
      Buffer.from(canonicalJson(envelope.payload), "utf8"),
      key,
      signature
    );
  } catch {
    authentic = false;
  }
  if (!authentic) {
    fail(
      "CATALOG.INVENTORY_SIGNATURE_INVALID",
      "inventory_signature",
      "/signature/value",
      "catalog.inventory.signature_authentic"
    );
  }

  const payload = envelope.payload;
  assertExactFields(
    payload,
    new Set([
      "contract_id",
      "schema_version",
      "inventory_id",
      "disposition",
      "signing",
      "current_app",
      "catalog_bindings"
    ]),
    "/payload",
    "inventory_payload"
  );
  if (
    payload.contract_id !== "minimax-h3-tool.signed-build-inventory-catalog-binding" ||
    payload.schema_version !== "1.0.0"
  ) {
    fail(
      "CATALOG.INVENTORY_CONTRACT_INVALID",
      "inventory_payload",
      "/payload/contract_id",
      "catalog.inventory.contract_exact"
    );
  }
  assertImmutableId(payload.inventory_id, "/payload/inventory_id", "inventory_payload");
  assertExactFields(
    payload.disposition,
    new Set(["kind"]),
    "/payload/disposition",
    "inventory_payload"
  );
  if (payload.disposition.kind !== "active") {
    fail(
      "CATALOG.INVENTORY_STATUS_INVALID",
      "inventory_payload",
      "/payload/disposition/kind",
      "catalog.inventory.active_only"
    );
  }
  assertExactFields(
    payload.signing,
    new Set(["algorithm", "key_id"]),
    "/payload/signing",
    "inventory_payload"
  );
  if (
    payload.signing.algorithm !== envelope.signature.algorithm ||
    payload.signing.key_id !== envelope.signature.key_id
  ) {
    fail(
      "CATALOG.INVENTORY_SIGNATURE_POLICY_DRIFT",
      "inventory_payload",
      "/payload/signing",
      "catalog.inventory.signed_policy_matches_envelope"
    );
  }
  assertExactFields(
    payload.current_app,
    new Set(["app_id", "app_version", "app_build_id", "artifact_status"]),
    "/payload/current_app",
    "inventory_payload"
  );
  if (payload.current_app.artifact_status !== "current_app_build") {
    fail(
      "CATALOG.INVENTORY_STATUS_INVALID",
      "inventory_payload",
      "/payload/current_app/artifact_status",
      "catalog.inventory.current_app_status_exact"
    );
  }
  for (const field of ["app_id", "app_version", "app_build_id"]) {
    if (payload.current_app[field] !== currentApp[field]) {
      fail(
        "CATALOG.APP_BINDING_MISMATCH",
        "cross_binding",
        `/payload/current_app/${field}`,
        "catalog.binding.current_app_inventory_exact"
      );
    }
  }
  if (!Array.isArray(payload.catalog_bindings) || payload.catalog_bindings.length !== 1) {
    fail(
      "CATALOG.INVENTORY_CATALOG_CARDINALITY_INVALID",
      "inventory_payload",
      "/payload/catalog_bindings",
      "catalog.inventory.exactly_one_catalog_binding"
    );
  }
  const binding = payload.catalog_bindings[0];
  assertExactFields(
    binding,
    new Set([
      "kind",
      "status",
      "app_id",
      "app_version",
      "app_build_id",
      "catalog_resource",
      "content_sha256"
    ]),
    "/payload/catalog_bindings/0",
    "inventory_payload"
  );
  if (binding.kind !== "component_manifest" || binding.status !== "active") {
    fail(
      "CATALOG.INVENTORY_STATUS_INVALID",
      "inventory_payload",
      "/payload/catalog_bindings/0/status",
      "catalog.inventory.catalog_binding_active"
    );
  }
  assertCatalogResource(
    binding.catalog_resource,
    "/payload/catalog_bindings/0/catalog_resource",
    "inventory_payload"
  );
  if (typeof binding.content_sha256 !== "string" || !SHA256.test(binding.content_sha256)) {
    fail(
      "CATALOG.INVENTORY_HASH_INVALID",
      "inventory_payload",
      "/payload/catalog_bindings/0/content_sha256",
      "catalog.inventory.content_sha256_exact"
    );
  }
  for (const field of ["app_id", "app_version", "app_build_id"]) {
    if (binding[field] !== currentApp[field] || binding[field] !== payload.current_app[field]) {
      fail(
        "CATALOG.APP_BINDING_MISMATCH",
        "cross_binding",
        `/payload/catalog_bindings/0/${field}`,
        "catalog.binding.current_app_inventory_exact"
      );
    }
  }
  return Object.freeze({ ...binding });
}

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function createLazyDataHandle(document, validation) {
  const frozenDocument = deepFreeze(document);
  const componentsById = new Map(
    frozenDocument.components.map((component) => [component.component_id, component])
  );
  const licensesById = new Map(
    frozenDocument.license_records.map((record) => [record.license_record_id, record])
  );
  const metadata = deepFreeze({
    contract_id: frozenDocument.contract_id,
    schema_version: frozenDocument.schema_version,
    document_id: frozenDocument.document_id,
    document_revision: frozenDocument.document_revision,
    manifest_id: frozenDocument.manifest_id,
    catalog_binding: frozenDocument.catalog_binding,
    authority: frozenDocument.authority,
    disposition: frozenDocument.disposition,
    integrity: frozenDocument.integrity
  });
  const handle = {
    kind: "lazy_embedded_component_catalog_data",
    schema_digest: validation.schema_digest,
    content_sha256: validation.content_sha256,
    component_count: frozenDocument.components.length,
    license_record_count: frozenDocument.license_records.length,
    metadata,
    has_component(componentId) {
      return typeof componentId === "string" && componentsById.has(componentId);
    },
    get_component(componentId) {
      return typeof componentId === "string" ? componentsById.get(componentId) : undefined;
    },
    *components() {
      yield* frozenDocument.components;
    },
    get_license_record(recordId) {
      return typeof recordId === "string" ? licensesById.get(recordId) : undefined;
    },
    *license_records() {
      yield* frozenDocument.license_records;
    }
  };
  return Object.freeze(handle);
}

export function createEmbeddedCatalogLoader(configuration) {
  assertExactFields(
    configuration,
    new Set(["current_app", "trusted_inventory_keys"]),
    "",
    "configuration"
  );
  const currentApp = validateCurrentApp(configuration.current_app);
  const trustedKeys = validateTrustAnchors(configuration.trusted_inventory_keys);

  return Object.freeze({
    kind: "embedded_catalog_loader",
    load(request) {
      assertExactFields(
        request,
        new Set(["signed_build_inventory", "embedded_resource_index"]),
        "",
        "request"
      );
      if (!(request.signed_build_inventory instanceof Uint8Array)) {
        fail(
          "CATALOG.INVENTORY_BYTES_INVALID",
          "request",
          "/signed_build_inventory",
          "catalog.inventory.bytes_required"
        );
      }
      const selectedResource = selectCatalogResource(request.embedded_resource_index);
      const inventoryBinding = validateSignedInventory(
        request.signed_build_inventory,
        trustedKeys,
        currentApp
      );
      if (inventoryBinding.catalog_resource !== selectedResource.resource) {
        fail(
          "CATALOG.RESOURCE_BINDING_MISMATCH",
          "cross_binding",
          "/embedded_resource_index/resources",
          "catalog.binding.inventory_resource_exact"
        );
      }
      const document = parseStrictJson(selectedResource.bytes, { stage: "catalog_parse" });
      const validation = validateComponentManifest(document);
      if (document.disposition.kind !== "active") {
        fail(
          "CATALOG.MANIFEST_STATUS_INVALID",
          "cross_binding",
          "/disposition/kind",
          "catalog.binding.active_manifest_required"
        );
      }
      const manifestBinding = document.catalog_binding;
      for (const field of ["app_id", "app_version", "app_build_id", "catalog_resource"]) {
        if (
          manifestBinding[field] !== inventoryBinding[field] ||
          (field !== "catalog_resource" && manifestBinding[field] !== currentApp[field])
        ) {
          fail(
            "CATALOG.BINDING_MISMATCH",
            "cross_binding",
            `/catalog_binding/${field}`,
            "catalog.binding.current_app_inventory_manifest_exact"
          );
        }
      }
      if (
        validation.content_sha256 !== inventoryBinding.content_sha256 ||
        document.integrity.content_sha256 !== inventoryBinding.content_sha256
      ) {
        fail(
          "CATALOG.CONTENT_BINDING_MISMATCH",
          "cross_binding",
          "/integrity/content_sha256",
          "catalog.binding.recomputed_content_hash_exact"
        );
      }
      return createLazyDataHandle(document, validation);
    }
  });
}

export { CatalogLoaderError, COMPONENT_MANIFEST_SCHEMA_DIGEST };
