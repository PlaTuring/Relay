import componentManifestSchema from "../../../../schemas/component-manifest/1.0.0.schema.json" with { type: "json" };

import { loaderError } from "./errors.mjs";
import { canonicalJson, contentSha256, sha256Jcs } from "./strict-json.mjs";

export const COMPONENT_MANIFEST_SCHEMA_DIGEST =
  "sha256:62704fae90e6f9d1895a3d1351b8664f67222aedb8db390ab46e674394236608";

const ROOT_FIELDS = new Set([
  "contract_id",
  "schema_version",
  "document_id",
  "document_revision",
  "manifest_id",
  "catalog_binding",
  "authority",
  "license_records",
  "components",
  "disposition",
  "extensions",
  "integrity"
]);
const COMPONENT_FIELDS = new Set([
  "component_id",
  "component_version",
  "component_role",
  "platform",
  "architecture",
  "release_state",
  "artifact",
  "source",
  "provenance",
  "license_ref",
  "destination",
  "ownership_policy",
  "offline_availability",
  "dependencies",
  "signature",
  "disposition"
]);
const MUTABLE_SEGMENT = /^(?:latest|main|master|head|current|branch)(?:[._-].*)?$/iu;
const IMMUTABLE_PRODUCER_VERSION = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const DEVICE_STEM = /^(?:con|prn|aux|nul|clock\$|com[1-9]|lpt[1-9])$/iu;

function issue(code, instancePath, ruleId) {
  return { code, instancePath, ruleId };
}

function pointerToken(value) {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function pointerParts(pointer) {
  if (pointer === "") return [];
  return pointer
    .slice(1)
    .split("/")
    .map((part) => part.replace(/~1/gu, "/").replace(/~0/gu, "~"));
}

function resolveLocalRef(rootSchema, reference) {
  let current = rootSchema;
  for (const part of pointerParts(reference.slice(1))) current = current[part];
  return current;
}

function schemaErrors(instance, schema, rootSchema, instancePath) {
  if (schema === true) return [];
  if (schema === false) return [instancePath];
  const errors = [];
  if (schema.$ref) {
    errors.push(
      ...schemaErrors(instance, resolveLocalRef(rootSchema, schema.$ref), rootSchema, instancePath)
    );
  }
  if (schema.const !== undefined && canonicalJson(instance) !== canonicalJson(schema.const)) {
    errors.push(instancePath);
  }
  if (
    schema.enum &&
    !schema.enum.some((candidate) => canonicalJson(candidate) === canonicalJson(instance))
  ) {
    errors.push(instancePath);
  }
  if (schema.type) {
    const matches =
      schema.type === "object"
        ? instance !== null && typeof instance === "object" && !Array.isArray(instance)
        : schema.type === "array"
          ? Array.isArray(instance)
          : schema.type === "string"
            ? typeof instance === "string"
            : schema.type === "integer"
              ? Number.isSafeInteger(instance)
              : schema.type === "boolean"
                ? typeof instance === "boolean"
                : schema.type === "null"
                  ? instance === null
                  : false;
    if (!matches) return [...errors, instancePath];
  }
  if (schema.allOf) {
    for (const branch of schema.allOf) {
      errors.push(...schemaErrors(instance, branch, rootSchema, instancePath));
    }
  }
  if (schema.oneOf) {
    const matches = schema.oneOf.filter(
      (branch) => schemaErrors(instance, branch, rootSchema, instancePath).length === 0
    ).length;
    if (matches !== 1) errors.push(instancePath);
  }
  if (typeof instance === "string") {
    if (schema.minLength !== undefined && [...instance].length < schema.minLength) {
      errors.push(instancePath);
    }
    if (schema.maxLength !== undefined && [...instance].length > schema.maxLength) {
      errors.push(instancePath);
    }
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(instance)) errors.push(instancePath);
  }
  if (Number.isSafeInteger(instance)) {
    if (schema.minimum !== undefined && instance < schema.minimum) errors.push(instancePath);
    if (schema.maximum !== undefined && instance > schema.maximum) errors.push(instancePath);
  }
  if (Array.isArray(instance)) {
    if (schema.minItems !== undefined && instance.length < schema.minItems) errors.push(instancePath);
    if (schema.maxItems !== undefined && instance.length > schema.maxItems) errors.push(instancePath);
    if (schema.uniqueItems) {
      const seen = new Set();
      for (const item of instance) {
        const identity = canonicalJson(item);
        if (seen.has(identity)) errors.push(instancePath);
        seen.add(identity);
      }
    }
    if (schema.items) {
      instance.forEach((item, index) => {
        errors.push(...schemaErrors(item, schema.items, rootSchema, `${instancePath}/${index}`));
      });
    }
  }
  if (instance !== null && typeof instance === "object" && !Array.isArray(instance)) {
    const keys = Object.keys(instance);
    if (schema.minProperties !== undefined && keys.length < schema.minProperties) {
      errors.push(instancePath);
    }
    if (schema.maxProperties !== undefined && keys.length > schema.maxProperties) {
      errors.push(instancePath);
    }
    if (schema.required) {
      for (const key of schema.required) {
        if (!Object.hasOwn(instance, key)) errors.push(`${instancePath}/${pointerToken(key)}`);
      }
    }
    if (schema.propertyNames) {
      for (const key of keys) {
        errors.push(
          ...schemaErrors(
            key,
            schema.propertyNames,
            rootSchema,
            `${instancePath}/${pointerToken(key)}`
          )
        );
      }
    }
    const declared = new Set(Object.keys(schema.properties ?? {}));
    if (schema.properties) {
      for (const [key, propertySchema] of Object.entries(schema.properties)) {
        if (Object.hasOwn(instance, key)) {
          errors.push(
            ...schemaErrors(
              instance[key],
              propertySchema,
              rootSchema,
              `${instancePath}/${pointerToken(key)}`
            )
          );
        }
      }
    }
    for (const key of keys) {
      if (declared.has(key)) continue;
      if (schema.additionalProperties === false) {
        errors.push(`${instancePath}/${pointerToken(key)}`);
      }
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        errors.push(
          ...schemaErrors(
            instance[key],
            schema.additionalProperties,
            rootSchema,
            `${instancePath}/${pointerToken(key)}`
          )
        );
      }
    }
  }
  return errors;
}

function isDeviceSegment(segment) {
  const normalized = segment.replace(/[. ]+$/gu, "");
  const stem = (normalized.split(".")[0] ?? "").replace(/[. ]+$/gu, "");
  return DEVICE_STEM.test(stem);
}

function firstUnknown(object, allowed, instancePath, ruleId) {
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) {
      return issue(
        "CONTRACT.UNKNOWN_FIELD",
        `${instancePath}/${pointerToken(key)}`,
        ruleId
      );
    }
  }
  return null;
}

export function contractRelativePathIssue(value, instancePath) {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") > 4096 ||
    /^[A-Za-z]:/u.test(value) ||
    /^[\\/]/u.test(value) ||
    /^\\\\/u.test(value)
  ) {
    return issue(
      "COMPONENT.PATH_ABSOLUTE_FORBIDDEN",
      instancePath,
      "component.destination.relative.no_absolute"
    );
  }
  if (value.includes("\\")) {
    return issue(
      "COMPONENT.PATH_SEPARATOR_FORBIDDEN",
      instancePath,
      "component.destination.relative.forward_slash"
    );
  }
  const segments = value.split("/");
  if (segments.some((segment) => Buffer.byteLength(segment, "utf8") > 255)) {
    return issue("COMPONENT.PATH_UNSAFE", instancePath, "component.destination.relative.segment_limit");
  }
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return issue(
      "COMPONENT.PATH_TRAVERSAL_FORBIDDEN",
      instancePath,
      "component.destination.relative.no_traversal"
    );
  }
  if (value.includes(":")) {
    return issue(
      "COMPONENT.PATH_ADS_FORBIDDEN",
      instancePath,
      "component.destination.relative.no_ads"
    );
  }
  if (segments.some(isDeviceSegment)) {
    return issue(
      "COMPONENT.PATH_DEVICE_FORBIDDEN",
      instancePath,
      "component.destination.relative.no_device"
    );
  }
  if (
    segments.some(
      (segment) => segment.length === 0 || /[\u0000-\u001f<>"|?*]/u.test(segment) || /[. ]$/u.test(segment)
    )
  ) {
    return issue("COMPONENT.PATH_UNSAFE", instancePath, "component.destination.relative.safe_segments");
  }
  return null;
}

function locatorPathIssue(locator, instancePath) {
  if (typeof locator !== "string" || !locator.startsWith("app-resource:")) {
    return issue(
      "COMPONENT.APP_RESOURCE_INVALID",
      instancePath,
      "component.source.app_resource_relative"
    );
  }
  if (/%[0-9a-f]{2}/iu.test(locator)) {
    return issue(
      "COMPONENT.APP_RESOURCE_INVALID",
      instancePath,
      "component.source.app_resource_relative"
    );
  }
  const pathIssue = contractRelativePathIssue(locator.slice("app-resource:".length), instancePath);
  if (!pathIssue) return null;
  return issue(
    "COMPONENT.APP_RESOURCE_INVALID",
    instancePath,
    "component.source.app_resource_relative"
  );
}

function validateImmutableLocator(locator, revision, instancePath, code, ruleId) {
  if (typeof locator === "string" && locator.startsWith("app-resource:")) {
    return locatorPathIssue(locator, instancePath);
  }
  let url;
  try {
    url = new URL(locator);
  } catch {
    return issue(code, instancePath, ruleId);
  }
  let segments;
  try {
    segments = url.pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));
  } catch {
    return issue(code, instancePath, ruleId);
  }
  const encodedPathHazard =
    /%(?:00|2e|2f|5c)/iu.test(url.pathname) || locator.includes("\\") || url.pathname.includes("//");
  if (
    url.protocol !== "https:" ||
    (url.port && url.port !== "443") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    encodedPathHazard ||
    segments.some((segment) => MUTABLE_SEGMENT.test(segment)) ||
    !segments.includes(revision)
  ) {
    return issue(code, instancePath, ruleId);
  }
  return null;
}

function validateProducerSourceLocator(locator, revision, instancePath) {
  const invalid = () =>
    issue(
      "COMPONENT.PRODUCER_BUILD_IDENTITY_MUTABLE",
      instancePath,
      "component.provenance.producer_build_immutable"
    );
  if (typeof locator !== "string" || typeof revision !== "string") return invalid();
  if (locator.startsWith("app-resource:")) {
    if (locatorPathIssue(locator, instancePath)) return invalid();
    return locator === `app-resource:producer-builds/${revision}/source` ? null : invalid();
  }
  let url;
  try {
    url = new URL(locator);
  } catch {
    return invalid();
  }
  let segments;
  try {
    segments = url.pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment));
  } catch {
    return invalid();
  }
  const encodedPathHazard =
    /%(?:00|2e|2f|5c)/iu.test(url.pathname) || locator.includes("\\") || url.pathname.includes("//");
  if (
    url.protocol !== "https:" ||
    (url.port && url.port !== "443") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    encodedPathHazard ||
    segments.length !== 3 ||
    !["revisions", "commits"].includes(segments[0]) ||
    segments[1] !== revision ||
    segments[2] !== "source"
  ) {
    return invalid();
  }
  return null;
}

function validateImmutableSource(source, prefix) {
  const locatorIssue = validateImmutableLocator(
    source.locator,
    source.source_revision,
    `${prefix}/locator`,
    "COMPONENT.MUTABLE_SOURCE_FORBIDDEN",
    "component.source.immutable_locator"
  );
  if (locatorIssue) return locatorIssue;
  if (source.kind === "embedded_app_resource") {
    if (source.retrieval_policy !== "not_retrievable_embedded") {
      return issue(
        "COMPONENT.SOURCE_POLICY_CONFLICT",
        `${prefix}/retrieval_policy`,
        "component.source.kind_policy_exact"
      );
    }
    return null;
  }
  if (source.kind === "immutable_https" && source.retrieval_policy !== "explicit_install_only") {
    return issue(
      "COMPONENT.SOURCE_POLICY_CONFLICT",
      `${prefix}/retrieval_policy`,
      "component.source.kind_policy_exact"
    );
  }
  if (source.kind === "external_match_only" && source.retrieval_policy !== "match_only_no_retrieval") {
    return issue(
      "COMPONENT.SOURCE_POLICY_CONFLICT",
      `${prefix}/retrieval_policy`,
      "component.source.kind_policy_exact"
    );
  }
  return null;
}

function validateRole(component, prefix) {
  const artifact = component.artifact;
  const archive = artifact.archive_shape;
  const destination = component.destination.destination_class;
  const role = component.component_role;
  let valid = false;
  if (role === "python_runtime") {
    valid =
      component.architecture === "x86_64" &&
      archive.kind === "fixed_archive" &&
      ["application/zip", "application/x-tar+zstd"].includes(artifact.content_type) &&
      destination === "runtime_generation";
  } else if (role === "comfy_backend") {
    valid = component.architecture === "noarch" && archive.kind === "fixed_archive" && destination === "runtime_generation";
  } else if (role === "comfy_frontend") {
    valid = component.architecture === "noarch" && archive.kind === "fixed_archive" && destination === "frontend_bundle";
  } else if (role === "workflow_templates") {
    valid = component.architecture === "noarch" && archive.kind === "fixed_archive" && destination === "workflow_templates";
  } else if (role === "local_node") {
    valid = component.architecture === "noarch" && archive.kind === "fixed_archive" && destination === "local_nodes";
  } else if (role === "python_wheelhouse") {
    valid =
      component.architecture === "noarch" &&
      archive.kind === "fixed_archive" &&
      archive.format === "wheelhouse_zip" &&
      artifact.content_type === "application/vnd.python.wheelhouse" &&
      destination === "runtime_generation";
  } else if (["model_diffusion", "model_text_encoder", "model_video_vae", "model_audio_vae"].includes(role)) {
    valid =
      component.architecture === "noarch" &&
      archive.kind === "single_file" &&
      artifact.content_type === "application/vnd.safetensors" &&
      [role, "external_read_only_reference"].includes(destination);
  } else if (role === "native_helper") {
    valid =
      component.architecture === "x86_64" &&
      archive.kind === "single_file" &&
      artifact.content_type === "application/vnd.microsoft.portable-executable" &&
      destination === "private_tools";
  } else if (role === "private_media_tool") {
    valid =
      component.architecture === "x86_64" &&
      destination === "private_tools" &&
      ((archive.kind === "single_file" &&
        artifact.content_type === "application/vnd.microsoft.portable-executable") ||
        (archive.kind === "fixed_archive" && artifact.content_type === "application/zip"));
  }
  return valid
    ? null
    : issue(
        "COMPONENT.ROLE_ARTIFACT_MISMATCH",
        `${prefix}/component_role`,
        "component.role.artifact_destination_exact"
      );
}

function validateArchive(component, prefix) {
  const archive = component.artifact.archive_shape;
  if (archive.kind !== "fixed_archive") return null;
  const pathPrefix = `${prefix}/artifact/archive_shape`;
  if (archive.link_policy !== "forbid_links_and_reparse") {
    return issue(
      "COMPONENT.REPARSE_INTENT_FORBIDDEN",
      `${pathPrefix}/link_policy`,
      "component.archive.links_reparse_forbidden"
    );
  }
  if (!("expanded_tree_sha256" in archive)) {
    return issue(
      "COMPONENT.ARCHIVE_EXPANDED_TREE_REQUIRED",
      `${pathPrefix}/expanded_tree_sha256`,
      "component.archive.expanded_tree_required"
    );
  }
  if (!("max_entry_byte_length" in archive) || archive.max_entry_byte_length > archive.expanded_byte_length) {
    return issue(
      "COMPONENT.ARCHIVE_BOUNDS_INVALID",
      `${pathPrefix}/max_entry_byte_length`,
      "component.archive.expanded_bounds"
    );
  }
  if (
    archive.path_policy !== "canonical_relative_no_traversal_ads_device" ||
    archive.expanded_tree_profile !== "canonical_regular_files_v1"
  ) {
    return issue("COMPONENT.ARCHIVE_POLICY_INVALID", pathPrefix, "component.archive.materializer_policy_exact");
  }
  return null;
}

function validateProvenance(component, prefix) {
  const provenance = component.provenance;
  const base = `${prefix}/provenance`;
  if (!("publisher" in provenance)) {
    return issue(
      "COMPONENT.PUBLISHER_REQUIRED",
      `${base}/publisher`,
      "component.provenance.publisher_required"
    );
  }
  if (
    provenance.creator.role !== "creator" ||
    provenance.publisher.role !== "publisher" ||
    provenance.packager.role !== "packager"
  ) {
    return issue("COMPONENT.PARTY_ROLE_CONFLICT", base, "component.provenance.party_roles_exact");
  }
  const sameCreatorPackager = provenance.creator.party_id === provenance.packager.party_id;
  if ((provenance.relationship === "same_party") !== sameCreatorPackager) {
    return issue(
      "COMPONENT.PARTY_RELATIONSHIP_CONFLICT",
      `${base}/relationship`,
      "component.provenance.party_relationship_exact"
    );
  }
  const samePublisherPackager = provenance.publisher.party_id === provenance.packager.party_id;
  if ((provenance.publisher_packager_relationship === "same_party") !== samePublisherPackager) {
    return issue(
      "COMPONENT.PARTY_RELATIONSHIP_CONFLICT",
      `${base}/publisher_packager_relationship`,
      "component.provenance.publisher_packager_relationship_exact"
    );
  }
  const namesByParty = new Map();
  for (const party of [provenance.creator, provenance.publisher, provenance.packager]) {
    if (namesByParty.has(party.party_id) && namesByParty.get(party.party_id) !== party.display_name) {
      return issue(
        "COMPONENT.PARTY_IDENTITY_CONFLICT",
        base,
        "component.provenance.same_party_display_name_exact"
      );
    }
    namesByParty.set(party.party_id, party.display_name);
  }

  const producer = provenance.producer_build_identity;
  if (producer.producer_id !== provenance.packager.party_id) {
    return issue(
      "COMPONENT.PRODUCER_BUILD_IDENTITY_CONFLICT",
      `${base}/producer_build_identity/producer_id`,
      "component.provenance.producer_is_packager"
    );
  }
  if (!IMMUTABLE_PRODUCER_VERSION.test(producer.producer_version)) {
    return issue(
      "COMPONENT.PRODUCER_BUILD_IDENTITY_MUTABLE",
      `${base}/producer_build_identity/producer_version`,
      "component.provenance.producer_build_immutable"
    );
  }
  if (!/^sha256:[0-9a-f]{64}$/u.test(producer.producer_build_id)) {
    return issue(
      "COMPONENT.PRODUCER_BUILD_IDENTITY_MUTABLE",
      `${base}/producer_build_identity/producer_build_id`,
      "component.provenance.producer_build_immutable"
    );
  }
  const producerLocatorIssue = validateProducerSourceLocator(
    producer.producer_source_locator,
    producer.producer_source_revision,
    `${base}/producer_build_identity/producer_source_locator`
  );
  if (producerLocatorIssue) return producerLocatorIssue;
  const producerBuildProjection = {
    build_recipe_sha256: producer.build_recipe_sha256,
    producer_id: producer.producer_id,
    producer_source_locator: producer.producer_source_locator,
    producer_source_revision: producer.producer_source_revision,
    producer_version: producer.producer_version
  };
  if (producer.producer_build_id !== sha256Jcs(producerBuildProjection)) {
    return issue(
      "COMPONENT.PRODUCER_BUILD_IDENTITY_HASH_MISMATCH",
      `${base}/producer_build_identity/producer_build_id`,
      "component.provenance.producer_build_record_hash_exact"
    );
  }

  const evidenceIds = new Set();
  for (let index = 0; index < provenance.evidence.items.length; index += 1) {
    const evidence = provenance.evidence.items[index];
    if (evidenceIds.has(evidence.evidence_id)) {
      return issue(
        "COMPONENT.DUPLICATE_PROVENANCE_EVIDENCE",
        `${base}/evidence/items/${index}/evidence_id`,
        "component.provenance.evidence_id_unique"
      );
    }
    evidenceIds.add(evidence.evidence_id);
    const locatorIssue = locatorPathIssue(
      evidence.locator,
      `${base}/evidence/items/${index}/locator`
    );
    if (locatorIssue) return locatorIssue;
  }
  const evidenceVerified = provenance.evidence.items.every(
    (evidence) => evidence.review_state === "verified_by_release_owner"
  );
  const evidenceKinds = new Set(provenance.evidence.items.map((evidence) => evidence.kind));
  let evidenceStatusValid = false;
  if (provenance.evidence.status === "declared_unverified") {
    evidenceStatusValid = !evidenceVerified;
  } else if (provenance.evidence.status === "verified_release_attestation") {
    evidenceStatusValid =
      evidenceVerified &&
      (evidenceKinds.has("source_attestation") || evidenceKinds.has("package_attestation"));
  } else if (provenance.evidence.status === "verified_reproducible_build") {
    evidenceStatusValid = evidenceVerified && evidenceKinds.has("reproducibility_report");
  }
  if (!evidenceStatusValid) {
    return issue(
      "COMPONENT.PROVENANCE_EVIDENCE_STATUS_CONFLICT",
      `${base}/evidence/status`,
      "component.provenance.evidence_status_exact"
    );
  }

  const chain = provenance.chain;
  const allowedActors = new Set([
    provenance.creator.party_id,
    provenance.publisher.party_id,
    provenance.packager.party_id
  ]);
  if (
    chain[0].event !== "created" ||
    chain[0].actor_party_id !== provenance.creator.party_id ||
    chain[0].input.kind !== "none"
  ) {
    return issue(
      "COMPONENT.PROVENANCE_ORIGIN_INVALID",
      `${base}/chain/0`,
      "component.provenance.origin_exact"
    );
  }
  if (!chain.some((step) => step.actor_party_id === provenance.publisher.party_id)) {
    return issue(
      "COMPONENT.PUBLISHER_NOT_IN_CHAIN",
      `${base}/publisher/party_id`,
      "component.provenance.publisher_participates"
    );
  }
  for (let index = 0; index < chain.length; index += 1) {
    const step = chain[index];
    if (step.sequence !== index || !allowedActors.has(step.actor_party_id)) {
      return issue(
        "COMPONENT.PROVENANCE_STEP_INVALID",
        `${base}/chain/${index}`,
        "component.provenance.sequence_actor_exact"
      );
    }
    const locatorIssue = validateImmutableLocator(
      step.source_locator,
      step.source_revision,
      `${base}/chain/${index}/source_locator`,
      "COMPONENT.PROVENANCE_MUTABLE_LOCATOR",
      "component.provenance.each_locator_immutable"
    );
    if (locatorIssue) return locatorIssue;
    if (
      index > 0 &&
      (step.input.kind !== "artifact" ||
        canonicalJson(step.input.identity) !== canonicalJson(chain[index - 1].output))
    ) {
      return issue(
        "COMPONENT.PROVENANCE_CHAIN_BROKEN",
        `${base}/chain/${index}/input/identity`,
        "component.provenance.input_matches_parent"
      );
    }
  }
  const last = chain.at(-1);
  if (last.event !== "packaged" || last.actor_party_id !== provenance.packager.party_id) {
    return issue(
      "COMPONENT.PROVENANCE_PACKAGER_INVALID",
      `${base}/chain/${chain.length - 1}`,
      "component.provenance.packager_exact"
    );
  }
  if (
    last.source_locator !== component.source.locator ||
    last.source_revision !== component.source.source_revision
  ) {
    return issue(
      "COMPONENT.PROVENANCE_SOURCE_STALE",
      `${base}/chain/${chain.length - 1}/source_locator`,
      "component.provenance.final_source_exact"
    );
  }
  if (
    last.output.byte_length !== component.artifact.byte_length ||
    last.output.artifact_sha256 !== component.artifact.artifact_sha256
  ) {
    return issue(
      "COMPONENT.PROVENANCE_OUTPUT_STALE",
      `${base}/chain/${chain.length - 1}/output`,
      "component.provenance.final_output_exact"
    );
  }
  const events = chain.map((step) => step.event);
  const sameIdentity = (left, right) => canonicalJson(left) === canonicalJson(right);
  let transformationValid = false;
  if (provenance.transformation === "original_bytes_republished") {
    transformationValid =
      events[0] === "created" &&
      events.at(-1) === "packaged" &&
      events.slice(1, -1).every((event) => event === "mirrored") &&
      chain.slice(1).every((step) => sameIdentity(step.output, chain[0].output));
  } else {
    const exactMiddleEvent = {
      compiled: "compiled",
      quantized: "quantized",
      bundled: "bundled",
      repackaged: "packaged"
    }[provenance.transformation];
    transformationValid =
      exactMiddleEvent !== undefined &&
      canonicalJson(events) === canonicalJson(["created", exactMiddleEvent, "packaged"]) &&
      !sameIdentity(chain[1].input.identity, chain[1].output) &&
      sameIdentity(chain[2].input.identity, chain[2].output);
  }
  return transformationValid
    ? null
    : issue(
        "COMPONENT.PROVENANCE_TRANSFORMATION_MISMATCH",
        `${base}/transformation`,
        "component.provenance.transformation_chain_exact"
      );
}

function validateOwnership(component, prefix) {
  const ownership = component.ownership_policy;
  if (component.source.kind === "external_match_only") {
    if (
      ownership.kind !== "external_match_only" ||
      ownership.classification !== "external_read_only" ||
      ownership.delete_authority !== "never" ||
      ownership.manifest_grants_ownership !== false ||
      ownership.manifest_grants_delete !== false
    ) {
      return issue(
        "COMPONENT.EXTERNAL_OWNERSHIP_FORBIDDEN",
        `${prefix}/ownership_policy/classification`,
        "component.external.always_read_only"
      );
    }
    if (
      component.destination.kind !== "external_match_requirement" ||
      "relative_path" in component.destination ||
      "candidate_ref" in component.destination ||
      component.destination.destination_class !== "external_read_only_reference" ||
      component.destination.selection_binding !== "later_exact_model_observation_reference_required" ||
      component.offline_availability.kind !== "external_presence_required"
    ) {
      return issue(
        "COMPONENT.EXTERNAL_ROUTE_CONFLICT",
        `${prefix}/destination`,
        "component.external.route_exact"
      );
    }
  } else {
    if (
      ownership.kind !== "managed_target" ||
      ownership.classification !== "tool_owned_only_after_verified_ledger_commit" ||
      ownership.manifest_grants_ownership !== false ||
      ownership.manifest_grants_delete !== false ||
      ownership.delete_authority !== "separate_ledger_containment_lease_gate"
    ) {
      return issue(
        "COMPONENT.MANIFEST_AUTHORITY_FORBIDDEN",
        `${prefix}/ownership_policy`,
        "component.ownership.manifest_never_grants"
      );
    }
    const requiredProofs = [
      "verified_download_length_hash",
      "owned_transaction_commit",
      "ownership_ledger_entry",
      "handle_containment_no_reparse",
      "no_active_lease"
    ];
    if (canonicalJson(ownership.required_proofs) !== canonicalJson(requiredProofs)) {
      return issue(
        "COMPONENT.MANAGED_PROOFS_INCOMPLETE",
        `${prefix}/ownership_policy/required_proofs`,
        "component.ownership.required_proofs_exact"
      );
    }
    if (component.destination.kind !== "managed_relative" || !("relative_path" in component.destination)) {
      return issue(
        "COMPONENT.MANAGED_ROUTE_CONFLICT",
        `${prefix}/destination`,
        "component.managed.route_exact"
      );
    }
    const expectedOffline =
      component.source.kind === "embedded_app_resource"
        ? "bundled_in_app"
        : "requires_explicit_install_network";
    if (component.offline_availability.kind !== expectedOffline) {
      return issue(
        "COMPONENT.OFFLINE_POLICY_CONFLICT",
        `${prefix}/offline_availability/kind`,
        "component.offline.source_exact"
      );
    }
  }
  if (component.offline_availability.runtime_network_install !== "forbidden") {
    return issue(
      "COMPONENT.RUNTIME_NETWORK_FORBIDDEN",
      `${prefix}/offline_availability/runtime_network_install`,
      "component.offline.runtime_network_forbidden"
    );
  }
  return null;
}

function validateSignature(component, prefix) {
  const signature = component.signature;
  if (!signature) return null;
  if (signature.signed_artifact_sha256 !== component.artifact.artifact_sha256) {
    return issue(
      "COMPONENT.SIGNATURE_ARTIFACT_STALE",
      `${prefix}/signature/signed_artifact_sha256`,
      "component.signature.signed_artifact_exact"
    );
  }
  if (signature.kind === "embedded_authenticode") {
    if (
      signature.scheme !== "authenticode" ||
      component.artifact.archive_shape.kind !== "single_file" ||
      component.artifact.content_type !== "application/vnd.microsoft.portable-executable"
    ) {
      return issue(
        "COMPONENT.SIGNATURE_SCHEME_MISMATCH",
        `${prefix}/signature/scheme`,
        "component.signature.scheme_shape_exact"
      );
    }
  } else if (signature.kind === "detached_signature") {
    const resourceIssue = locatorPathIssue(
      signature.signature_resource.locator,
      `${prefix}/signature/signature_resource/locator`
    );
    if (resourceIssue) return resourceIssue;
  } else {
    return issue(
      "COMPONENT.SIGNATURE_KIND_UNKNOWN",
      `${prefix}/signature/kind`,
      "component.signature.kind_exact"
    );
  }
  return null;
}

function validateLicenseReference(component, prefix, licenses) {
  const record = licenses.get(component.license_ref.license_record_id);
  if (!record || record.disposition.kind !== "active") {
    return issue(
      "COMPONENT.LICENSE_REFERENCE_INVALID",
      `${prefix}/license_ref/license_record_id`,
      "component.license_ref.active_record"
    );
  }
  if (component.license_ref.license_record_content_sha256 !== sha256Jcs(record)) {
    return issue(
      "COMPONENT.LICENSE_REFERENCE_STALE",
      `${prefix}/license_ref/license_record_content_sha256`,
      "component.license_ref.content_exact"
    );
  }
  return null;
}

function expectedLicenseScopeHashes(components) {
  const ordered = [...components].sort((left, right) => {
    const leftKey = `${left.component_id}\u0000${left.component_version}\u0000${left.artifact.artifact_sha256}`;
    const rightKey = `${right.component_id}\u0000${right.component_version}\u0000${right.artifact.artifact_sha256}`;
    return Buffer.compare(Buffer.from(leftKey, "utf8"), Buffer.from(rightKey, "utf8"));
  });
  const artifacts = ordered.map((component) => ({
    artifact_sha256: component.artifact.artifact_sha256,
    byte_length: component.artifact.byte_length,
    component_id: component.component_id,
    component_version: component.component_version,
    source_kind: component.source.kind
  }));
  const provenance = ordered.map((component) => ({
    component_id: component.component_id,
    component_version: component.component_version,
    provenance_content_sha256: sha256Jcs(component.provenance)
  }));
  return { artifactSet: sha256Jcs(artifacts), provenanceSet: sha256Jcs(provenance) };
}

function validateApprovedLicenseScopes(document, licenses) {
  for (const [licenseId, record] of licenses.entries()) {
    if (record.review.state !== "approved") continue;
    const index = document.license_records.findIndex(
      (candidate) => candidate.license_record_id === licenseId
    );
    const prefix = `/license_records/${index}`;
    const components = document.components.filter(
      (component) => component.license_ref.license_record_id === licenseId
    );
    const hashes = expectedLicenseScopeHashes(components);
    if (record.review.reviewed_artifact_set_sha256 !== hashes.artifactSet) {
      return issue(
        "COMPONENT.LICENSE_ARTIFACT_SCOPE_STALE",
        `${prefix}/review/reviewed_artifact_set_sha256`,
        "component.license.reviewed_artifact_set_exact"
      );
    }
    if (record.review.reviewed_provenance_set_sha256 !== hashes.provenanceSet) {
      return issue(
        "COMPONENT.LICENSE_PROVENANCE_SCOPE_STALE",
        `${prefix}/review/reviewed_provenance_set_sha256`,
        "component.license.reviewed_provenance_set_exact"
      );
    }
    const requiredModes = new Set(
      components.map((component) =>
        component.source.kind === "embedded_app_resource"
          ? "bundled_redistribution"
          : component.source.kind === "external_match_only"
            ? "external_read_only_reuse"
            : "explicit_user_download"
      )
    );
    for (const mode of requiredModes) {
      if (!record.review.delivery_modes.includes(mode)) {
        return issue(
          "COMPONENT.LICENSE_DELIVERY_SCOPE_MISSING",
          `${prefix}/review/delivery_modes`,
          "component.license.delivery_modes_cover_components"
        );
      }
    }
    if (
      (requiredModes.has("bundled_redistribution") || requiredModes.has("explicit_user_download")) &&
      record.obligations.redistribution !== "approved_with_conditions"
    ) {
      return issue(
        "COMPONENT.LICENSE_REDISTRIBUTION_NOT_APPROVED",
        `${prefix}/obligations/redistribution`,
        "component.license.redistribution_approved"
      );
    }
    if (
      record.obligations.source_code === "review_pending" ||
      record.obligations.attribution === "review_pending"
    ) {
      return issue(
        "COMPONENT.LICENSE_OBLIGATIONS_UNRESOLVED",
        `${prefix}/obligations`,
        "component.license.obligations_resolved"
      );
    }
  }
  return null;
}

function validateDependencies(document) {
  const byId = new Map(
    document.components.map((component, index) => [component.component_id, { component, index }])
  );
  for (let sourceIndex = 0; sourceIndex < document.components.length; sourceIndex += 1) {
    const source = document.components[sourceIndex];
    for (let dependencyIndex = 0; dependencyIndex < source.dependencies.length; dependencyIndex += 1) {
      const dependency = source.dependencies[dependencyIndex];
      const target = byId.get(dependency.component_id);
      const prefix = `/components/${sourceIndex}/dependencies/${dependencyIndex}`;
      if (
        !target ||
        target.component.component_version !== dependency.component_version ||
        target.component.artifact.artifact_sha256 !== dependency.artifact_sha256
      ) {
        return issue("COMPONENT.DEPENDENCY_STALE", prefix, "component.dependencies.exact_identity");
      }
      if (
        source.release_state === "eligible" &&
        (target.component.disposition.kind !== "active" || target.component.release_state !== "eligible")
      ) {
        return issue(
          "COMPONENT.DEPENDENCY_NOT_ACTIONABLE",
          prefix,
          "component.dependencies.eligible_closure"
        );
      }
    }
  }
  function reaches(currentId, goalId, seen) {
    if (currentId === goalId) return true;
    if (seen.has(currentId)) return false;
    seen.add(currentId);
    const current = byId.get(currentId);
    if (!current) return false;
    return current.component.dependencies.some((dependency) =>
      reaches(dependency.component_id, goalId, seen)
    );
  }
  for (let sourceIndex = 0; sourceIndex < document.components.length; sourceIndex += 1) {
    const source = document.components[sourceIndex];
    for (let dependencyIndex = 0; dependencyIndex < source.dependencies.length; dependencyIndex += 1) {
      if (reaches(source.dependencies[dependencyIndex].component_id, source.component_id, new Set())) {
        return issue(
          "COMPONENT.DEPENDENCY_CYCLE",
          `/components/${sourceIndex}/dependencies/${dependencyIndex}`,
          "component.dependencies.acyclic"
        );
      }
    }
  }
  return null;
}

function validateActionability(document, licenses) {
  for (let index = 0; index < document.components.length; index += 1) {
    const component = document.components[index];
    if (component.release_state !== "eligible") continue;
    const license = licenses.get(component.license_ref.license_record_id);
    if (!license || license.review.state !== "approved") {
      return issue(
        "COMPONENT.LICENSE_NOT_APPROVED",
        `/components/${index}/release_state`,
        "component.license.release_blocked_until_approved"
      );
    }
    if (
      component.provenance.evidence.status === "declared_unverified" ||
      !component.provenance.evidence.items.every(
        (evidence) => evidence.review_state === "verified_by_release_owner"
      )
    ) {
      return issue(
        "COMPONENT.PROVENANCE_NOT_VERIFIED",
        `/components/${index}/release_state`,
        "component.provenance.release_blocked_until_verified"
      );
    }
  }
  return null;
}

function validateExtensions(document) {
  if (!("extensions" in document)) return null;
  let totalBytes = 0;
  for (const [namespace, extension] of Object.entries(document.extensions)) {
    if (!/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9_]*){2,}$/u.test(namespace)) {
      return issue(
        "CONTRACT.INVALID_EXTENSION",
        `/extensions/${namespace}`,
        "contract.extension.namespace"
      );
    }
    if (!extension || extension.effect !== "display_metadata") {
      return issue(
        "CONTRACT.OPERATIONAL_EXTENSION_FORBIDDEN",
        `/extensions/${namespace}/effect`,
        "contract.extension.display_only"
      );
    }
    for (const key of Object.keys(extension)) {
      if (!["extension_version", "effect", "data"].includes(key)) {
        return issue(
          "CONTRACT.UNKNOWN_FIELD",
          `/extensions/${namespace}/${key}`,
          "contract.extension.object.closed"
        );
      }
    }
    const extensionBytes = Buffer.byteLength(canonicalJson(extension), "utf8");
    if (extensionBytes > 256 * 1024) {
      return issue(
        "CONTRACT.EXTENSION_TOO_LARGE",
        `/extensions/${namespace}`,
        "contract.extension.single_size"
      );
    }
    totalBytes += extensionBytes;
  }
  if (totalBytes > 1024 * 1024) {
    return issue(
      "CONTRACT.EXTENSIONS_TOO_LARGE",
      "/extensions",
      "contract.extension.total_size"
    );
  }
  return null;
}

function normalizeSchemaStage(document) {
  const rawErrors = schemaErrors(document, componentManifestSchema, componentManifestSchema, "");
  if (rawErrors.length === 0) return null;
  if (document && typeof document === "object" && !Array.isArray(document)) {
    const rootUnknown = firstUnknown(
      document,
      ROOT_FIELDS,
      "",
      "component-manifest.object.closed"
    );
    if (rootUnknown) return rootUnknown;
    const catalog = document.catalog_binding;
    if (catalog && typeof catalog === "object" && !Array.isArray(catalog)) {
      if (
        catalog.remote_catalog_policy !== "forbidden" ||
        catalog.delivery !== "embedded_in_current_app" ||
        catalog.runtime_override_policy !== "forbidden"
      ) {
        return issue(
          "COMPONENT.REMOTE_CATALOG_FORBIDDEN",
          "/catalog_binding/remote_catalog_policy",
          "component.catalog.embedded_only"
        );
      }
      if (catalog.app_id !== "minimax-h3-tool") {
        return issue(
          "COMPONENT.APP_BINDING_MISMATCH",
          "/catalog_binding/app_id",
          "component.catalog.app_exact"
        );
      }
      if (
        catalog.external_binding_requirement !==
          "signed_build_inventory_binds_exact_catalog_tuple" ||
        catalog.catalog_cardinality !== "exactly_one"
      ) {
        return issue(
          "COMPONENT.CATALOG_EXTERNAL_BINDING_REQUIRED",
          "/catalog_binding/external_binding_requirement",
          "component.catalog.external_build_binding"
        );
      }
    }
    if (Array.isArray(document.license_records)) {
      for (let index = 0; index < document.license_records.length; index += 1) {
        const record = document.license_records[index];
        if (record && typeof record === "object" && !("review" in record)) {
          return issue(
            "COMPONENT.LICENSE_REVIEW_REQUIRED",
            `/license_records/${index}/review`,
            "component.license.review.required"
          );
        }
      }
    }
    if (Array.isArray(document.components)) {
      for (let index = 0; index < document.components.length; index += 1) {
        const component = document.components[index];
        const prefix = `/components/${index}`;
        if (!component || typeof component !== "object" || Array.isArray(component)) continue;
        const unknown = firstUnknown(component, COMPONENT_FIELDS, prefix, "component.object.closed");
        if (unknown) return unknown;
        if (component.artifact && typeof component.artifact === "object") {
          if (!("byte_length" in component.artifact)) {
            return issue(
              "COMPONENT.ARTIFACT_LENGTH_REQUIRED",
              `${prefix}/artifact/byte_length`,
              "component.artifact.length.required"
            );
          }
          if (!("artifact_sha256" in component.artifact)) {
            return issue(
              "COMPONENT.ARTIFACT_HASH_REQUIRED",
              `${prefix}/artifact/artifact_sha256`,
              "component.artifact.hash.required"
            );
          }
          const archive = component.artifact.archive_shape;
          if (archive && typeof archive === "object" && archive.kind === "fixed_archive") {
            if (archive.link_policy !== "forbid_links_and_reparse") {
              return issue(
                "COMPONENT.REPARSE_INTENT_FORBIDDEN",
                `${prefix}/artifact/archive_shape/link_policy`,
                "component.archive.links_reparse_forbidden"
              );
            }
            if (!("expanded_tree_sha256" in archive)) {
              return issue(
                "COMPONENT.ARCHIVE_EXPANDED_TREE_REQUIRED",
                `${prefix}/artifact/archive_shape/expanded_tree_sha256`,
                "component.archive.expanded_tree_required"
              );
            }
          }
        }
        if (component.provenance && typeof component.provenance === "object") {
          if (!("publisher" in component.provenance)) {
            return issue(
              "COMPONENT.PUBLISHER_REQUIRED",
              `${prefix}/provenance/publisher`,
              "component.provenance.publisher_required"
            );
          }
          if (!("producer_build_identity" in component.provenance)) {
            return issue(
              "COMPONENT.PRODUCER_BUILD_IDENTITY_REQUIRED",
              `${prefix}/provenance/producer_build_identity`,
              "component.provenance.producer_build_required"
            );
          }
          if (!("evidence" in component.provenance)) {
            return issue(
              "COMPONENT.PROVENANCE_EVIDENCE_REQUIRED",
              `${prefix}/provenance/evidence`,
              "component.provenance.evidence_required"
            );
          }
        }
        const producer = component.provenance?.producer_build_identity;
        if (producer && typeof producer === "object" && !Array.isArray(producer)) {
          if (
            typeof producer.producer_version === "string" &&
            !IMMUTABLE_PRODUCER_VERSION.test(producer.producer_version)
          ) {
            return issue(
              "COMPONENT.PRODUCER_BUILD_IDENTITY_MUTABLE",
              `${prefix}/provenance/producer_build_identity/producer_version`,
              "component.provenance.producer_build_immutable"
            );
          }
          if (
            typeof producer.producer_build_id === "string" &&
            !/^sha256:[0-9a-f]{64}$/u.test(producer.producer_build_id)
          ) {
            return issue(
              "COMPONENT.PRODUCER_BUILD_IDENTITY_MUTABLE",
              `${prefix}/provenance/producer_build_identity/producer_build_id`,
              "component.provenance.producer_build_immutable"
            );
          }
          const producerLocatorIssue = validateProducerSourceLocator(
            producer.producer_source_locator,
            producer.producer_source_revision,
            `${prefix}/provenance/producer_build_identity/producer_source_locator`
          );
          if (producerLocatorIssue) return producerLocatorIssue;
        }
        if (
          component.source?.kind === "external_match_only" &&
          component.destination &&
          typeof component.destination === "object" &&
          "candidate_ref" in component.destination
        ) {
          return issue(
            "COMPONENT.RUNTIME_OBSERVATION_IN_MANIFEST_FORBIDDEN",
            `${prefix}/destination/candidate_ref`,
            "component.external.candidate_binding_later_only"
          );
        }
        if (
          component.source?.kind === "external_match_only" &&
          component.ownership_policy?.classification !== "external_read_only"
        ) {
          return issue(
            "COMPONENT.EXTERNAL_OWNERSHIP_FORBIDDEN",
            `${prefix}/ownership_policy/classification`,
            "component.external.always_read_only"
          );
        }
        if (
          component.ownership_policy?.kind === "managed_target" &&
          Array.isArray(component.ownership_policy.required_proofs) &&
          component.ownership_policy.required_proofs.length !== 5
        ) {
          return issue(
            "COMPONENT.MANAGED_PROOFS_INCOMPLETE",
            `${prefix}/ownership_policy/required_proofs`,
            "component.ownership.required_proofs_exact"
          );
        }
      }
    }
  }
  const paths = [...new Set(rawErrors)].sort(
    (left, right) =>
      left.length - right.length || Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"))
  );
  return issue(
    "CONTRACT.SCHEMA_INVALID",
    paths[0] ?? "",
    "component-manifest.schema.exact"
  );
}

function collectLicenses(document) {
  return new Map(document.license_records.map((record) => [record.license_record_id, record]));
}

function validateDomain(document) {
  let problem = firstUnknown(document, ROOT_FIELDS, "", "component-manifest.object.closed");
  if (problem) return problem;
  problem = validateExtensions(document);
  if (problem) return problem;
  const catalog = document.catalog_binding;
  if (
    catalog.remote_catalog_policy !== "forbidden" ||
    catalog.delivery !== "embedded_in_current_app" ||
    catalog.runtime_override_policy !== "forbidden"
  ) {
    return issue(
      "COMPONENT.REMOTE_CATALOG_FORBIDDEN",
      "/catalog_binding/remote_catalog_policy",
      "component.catalog.embedded_only"
    );
  }
  if (catalog.app_id !== "minimax-h3-tool") {
    return issue(
      "COMPONENT.APP_BINDING_MISMATCH",
      "/catalog_binding/app_id",
      "component.catalog.app_exact"
    );
  }
  if (
    catalog.catalog_cardinality !== "exactly_one" ||
    catalog.external_binding_requirement !== "signed_build_inventory_binds_exact_catalog_tuple"
  ) {
    return issue(
      "COMPONENT.CATALOG_EXTERNAL_BINDING_REQUIRED",
      "/catalog_binding/external_binding_requirement",
      "component.catalog.external_build_binding"
    );
  }
  problem = contractRelativePathIssue(catalog.catalog_resource, "/catalog_binding/catalog_resource");
  if (problem) return problem;
  if (catalog.catalog_resource.split("/").some((segment) => MUTABLE_SEGMENT.test(segment))) {
    return issue(
      "COMPONENT.MUTABLE_CATALOG_RESOURCE_FORBIDDEN",
      "/catalog_binding/catalog_resource",
      "component.catalog.resource_immutable"
    );
  }
  const authority = document.authority;
  if (
    authority.materialization_authority !== "none_requires_explicit_install_transaction" ||
    authority.ownership_authority !== "none_requires_verified_ownership_ledger_commit" ||
    authority.deletion_authority !== "none_requires_separate_ledger_containment_lease_gate" ||
    authority.execution_authority !== "none_manifest_is_data_only"
  ) {
    return issue(
      "COMPONENT.MANIFEST_AUTHORITY_FORBIDDEN",
      "/authority",
      "component.manifest.data_only"
    );
  }
  if (document.disposition.kind !== "active") {
    const eligibleIndex = document.components.findIndex(
      (component) => component.release_state === "eligible"
    );
    if (eligibleIndex >= 0) {
      return issue(
        "COMPONENT.MANIFEST_NONACTIVE_MUST_BLOCK_ALL",
        `/components/${eligibleIndex}/release_state`,
        "component.manifest.nonactive_blocks_all"
      );
    }
  }

  const licenses = new Map();
  for (let index = 0; index < document.license_records.length; index += 1) {
    const record = document.license_records[index];
    if (!("review" in record)) {
      return issue(
        "COMPONENT.LICENSE_REVIEW_REQUIRED",
        `/license_records/${index}/review`,
        "component.license.review.required"
      );
    }
    if (licenses.has(record.license_record_id)) {
      return issue(
        "COMPONENT.DUPLICATE_LICENSE_ID",
        `/license_records/${index}/license_record_id`,
        "component.license.id.unique"
      );
    }
    problem = locatorPathIssue(record.license_text.locator, `/license_records/${index}/license_text/locator`);
    if (problem) return problem;
    problem = locatorPathIssue(record.notice.locator, `/license_records/${index}/notice/locator`);
    if (problem) return problem;
    licenses.set(record.license_record_id, record);
  }

  const componentIds = new Set();
  for (let index = 0; index < document.components.length; index += 1) {
    const component = document.components[index];
    const prefix = `/components/${index}`;
    problem = firstUnknown(component, COMPONENT_FIELDS, prefix, "component.object.closed");
    if (problem) return problem;
    if (componentIds.has(component.component_id)) {
      return issue("COMPONENT.DUPLICATE_ID", `${prefix}/component_id`, "component.id.unique");
    }
    componentIds.add(component.component_id);
    if (component.disposition.kind !== "active" && component.release_state !== "blocked") {
      return issue(
        "COMPONENT.NONACTIVE_MUST_BE_BLOCKED",
        `${prefix}/release_state`,
        "component.disposition.nonactive_blocked"
      );
    }
    problem = validateImmutableSource(component.source, `${prefix}/source`);
    if (problem) return problem;
    problem = validateProvenance(component, prefix);
    if (problem) return problem;
    if (component.source.expected_artifact_sha256 !== component.artifact.artifact_sha256) {
      return issue(
        "COMPONENT.ARTIFACT_HASH_CONFLICT",
        `${prefix}/source/expected_artifact_sha256`,
        "component.artifact.identity.hash_consistent"
      );
    }
    if (component.source.expected_byte_length !== component.artifact.byte_length) {
      return issue(
        "COMPONENT.ARTIFACT_SIZE_CONFLICT",
        `${prefix}/source/expected_byte_length`,
        "component.artifact.identity.length_consistent"
      );
    }
    problem = validateRole(component, prefix);
    if (problem) return problem;
    problem = validateArchive(component, prefix);
    if (problem) return problem;
    problem = validateLicenseReference(component, prefix, licenses);
    if (problem) return problem;
    if (component.destination.kind === "managed_relative") {
      problem = contractRelativePathIssue(
        component.destination.relative_path,
        `${prefix}/destination/relative_path`
      );
      if (problem) return problem;
    }
    if (
      /[<>:"/\\|?*\u0000-\u001f]/u.test(component.artifact.filename) ||
      isDeviceSegment(component.artifact.filename) ||
      /[. ]$/u.test(component.artifact.filename)
    ) {
      return issue(
        "COMPONENT.ARTIFACT_FILENAME_UNSAFE",
        `${prefix}/artifact/filename`,
        "component.artifact.filename_safe"
      );
    }
    problem = validateOwnership(component, prefix);
    if (problem) return problem;
    if (["native_helper", "private_media_tool"].includes(component.component_role) && !component.signature) {
      return issue(
        "COMPONENT.PRIVATE_EXECUTABLE_SIGNATURE_REQUIRED",
        `${prefix}/signature`,
        "component.role.private_executable_signature"
      );
    }
    problem = validateSignature(component, prefix);
    if (problem) return problem;
  }
  return null;
}

function validateClosure(document) {
  const licenses = collectLicenses(document);
  let problem = validateApprovedLicenseScopes(document, licenses);
  if (problem) return problem;
  problem = validateDependencies(document);
  if (problem) return problem;
  return validateActionability(document, licenses);
}

function throwIssue(problem, stage, document) {
  throw loaderError({
    code: problem.code,
    stage,
    instancePath: problem.instancePath,
    ruleId: problem.ruleId,
    contractId:
      document?.contract_id === "minimax-h3-tool.component-manifest"
        ? document.contract_id
        : undefined,
    schemaVersion: document?.schema_version === "1.0.0" ? document.schema_version : undefined
  });
}

export function validateComponentManifest(document) {
  const actualSchemaDigest = sha256Jcs(componentManifestSchema);
  if (actualSchemaDigest !== COMPONENT_MANIFEST_SCHEMA_DIGEST) {
    throw loaderError({
      code: "CONTRACT.SCHEMA_REGISTRY_DRIFT",
      stage: "schema_registry",
      instancePath: "",
      ruleId: "component-manifest.schema.digest_exact"
    });
  }
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throwIssue(
      issue("CONTRACT.INVALID_ROOT", "", "contract.root.object_required"),
      "envelope",
      document
    );
  }
  if (document.contract_id !== "minimax-h3-tool.component-manifest") {
    throwIssue(
      issue("CONTRACT.UNKNOWN_CONTRACT", "/contract_id", "component-manifest.envelope.exact"),
      "envelope",
      document
    );
  }
  if (document.schema_version !== "1.0.0") {
    throwIssue(
      issue(
        "CONTRACT.UNSUPPORTED_VERSION",
        "/schema_version",
        "component-manifest.schema_version.exact"
      ),
      "version",
      document
    );
  }
  if (
    !document.integrity ||
    document.integrity.content_sha256 !== contentSha256(document)
  ) {
    throwIssue(
      issue(
        "CONTRACT.INTEGRITY_MISMATCH",
        "/integrity/content_sha256",
        "contract.integrity.jcs_sha256"
      ),
      "integrity",
      document
    );
  }
  let problem = normalizeSchemaStage(document);
  if (problem) throwIssue(problem, "schema", document);
  problem = validateDomain(document);
  if (problem) throwIssue(problem, "domain", document);
  problem = validateClosure(document);
  if (problem) throwIssue(problem, "closure", document);
  return Object.freeze({
    content_sha256: document.integrity.content_sha256,
    schema_digest: COMPONENT_MANIFEST_SCHEMA_DIGEST
  });
}
