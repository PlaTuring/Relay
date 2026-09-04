import assert from "node:assert/strict";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign
} from "node:crypto";
import {
  lstatSync,
  readFileSync,
  readdirSync
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CatalogLoaderError,
  COMPONENT_MANIFEST_SCHEMA_DIGEST,
  createEmbeddedCatalogLoader
} from "../src/index.mjs";
import { canonicalJson, contentSha256, sha256Jcs } from "../src/strict-json.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(HERE, "..");
const REPOSITORY_ROOT = resolve(PACKAGE_ROOT, "../../..");
const BASE_CATALOG_PATH = resolve(
  REPOSITORY_ROOT,
  "tests/fixtures/contracts/component/valid/component-role-examples.json"
);
const CASES_PATH = resolve(HERE, "fixtures/loader-cases.json");
const USER_IDENTITIES_PATH = resolve(HERE, "fixtures/user-provided-upstream-identities.json");
const BASE_CATALOG_TEXT = readFileSync(BASE_CATALOG_PATH, "utf8");
const BASE_DOCUMENT = JSON.parse(BASE_CATALOG_TEXT);
const BASE_RESOURCE = BASE_DOCUMENT.catalog_binding.catalog_resource;
const CURRENT_APP = Object.freeze({
  app_id: "minimax-h3-tool",
  app_version: "0.1.0",
  app_build_id: "alpha0-schema-fixture"
});
const FIXTURE_KEY_ID = "fixture-build-inventory-key";
const ED25519_PKCS8_PREFIX = "302e020100300506032b657004220420";
const FIXTURE_SEED = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const FIXTURE_PRIVATE_KEY = createPrivateKey({
  key: Buffer.from(`${ED25519_PKCS8_PREFIX}${FIXTURE_SEED}`, "hex"),
  format: "der",
  type: "pkcs8"
});
const FIXTURE_PUBLIC_KEY_DER = createPublicKey(FIXTURE_PRIVATE_KEY).export({
  format: "der",
  type: "spki"
});
const loader = createEmbeddedCatalogLoader({
  current_app: CURRENT_APP,
  trusted_inventory_keys: [
    {
      key_id: FIXTURE_KEY_ID,
      algorithm: "ed25519",
      public_key_spki_der: FIXTURE_PUBLIC_KEY_DER
    }
  ]
});

const tests = [];
function test(name, callback) {
  tests.push({ name, callback });
}

function clone(value) {
  return structuredClone(value);
}

function refreshIntegrity(document) {
  document.integrity.content_sha256 = contentSha256(document);
  return document;
}

function makePayload(document = BASE_DOCUMENT) {
  return {
    contract_id: "minimax-h3-tool.signed-build-inventory-catalog-binding",
    schema_version: "1.0.0",
    inventory_id: "alpha0-schema-fixture-build-inventory",
    disposition: { kind: "active" },
    signing: { algorithm: "ed25519", key_id: FIXTURE_KEY_ID },
    current_app: { ...CURRENT_APP, artifact_status: "current_app_build" },
    catalog_bindings: [
      {
        kind: "component_manifest",
        status: "active",
        ...CURRENT_APP,
        catalog_resource: BASE_RESOURCE,
        content_sha256: document.integrity.content_sha256
      }
    ]
  };
}

function signEnvelope(payload, { envelopeKeyId = FIXTURE_KEY_ID } = {}) {
  const signature = sign(
    null,
    Buffer.from(canonicalJson(payload), "utf8"),
    FIXTURE_PRIVATE_KEY
  ).toString("base64");
  return {
    envelope_version: "1.0.0",
    payload,
    signature: {
      algorithm: "ed25519",
      key_id: envelopeKeyId,
      encoding: "base64",
      value: signature
    }
  };
}

function canonicalBytes(value) {
  return Buffer.from(canonicalJson(value), "utf8");
}

function defaultResourceIndex(catalogBytes = Buffer.from(BASE_CATALOG_TEXT, "utf8")) {
  return {
    kind: "complete_current_app_embedded_resource_index",
    resources: [
      {
        resource: "licenses/schema-fixture-license.txt",
        role: "other_embedded_resource"
      },
      {
        resource: BASE_RESOURCE,
        role: "component_catalog",
        bytes: catalogBytes
      },
      {
        resource: "notices/schema-fixture-notice.txt",
        role: "other_embedded_resource"
      }
    ]
  };
}

function makeRequest({
  document = BASE_DOCUMENT,
  catalogBytes,
  mutatePayload,
  mutateEnvelope,
  nonCanonicalInventory = false,
  resourceIndex
} = {}) {
  const payload = makePayload(document);
  if (mutatePayload) mutatePayload(payload);
  const envelope = signEnvelope(payload);
  if (mutateEnvelope) mutateEnvelope(envelope);
  const inventoryBytes = nonCanonicalInventory
    ? Buffer.from(JSON.stringify(envelope, null, 2), "utf8")
    : canonicalBytes(envelope);
  const bytes = catalogBytes ?? Buffer.from(JSON.stringify(document), "utf8");
  return {
    signed_build_inventory: inventoryBytes,
    embedded_resource_index: resourceIndex ?? defaultResourceIndex(bytes)
  };
}

function expectFailure(callback, expected) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof CatalogLoaderError);
    const expectedCode = typeof expected === "string" ? expected : expected.code;
    assert.equal(error.code, expectedCode);
    assert.equal(error.message, expectedCode);
    assert.equal(typeof error.stage, "string");
    assert.equal(typeof error.instance_path, "string");
    assert.match(error.rule_id, /^[a-z0-9_.-]+$/u);
    if (typeof expected === "object") {
      assert.deepEqual(
        {
          code: error.code,
          stage: error.stage,
          instance_path: error.instance_path,
          rule_id: error.rule_id
        },
        expected
      );
    }
    assert.doesNotMatch(JSON.stringify(error), /[A-Za-z]:[\\/]Users[\\/]/iu);
    return true;
  });
}

function mutateSignatureValue(envelope) {
  const value = envelope.signature.value;
  envelope.signature.value = `${value[0] === "A" ? "B" : "A"}${value.slice(1)}`;
}

function invalidCatalogBytes(caseId) {
  if (caseId === "catalog-bom") {
    return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(BASE_CATALOG_TEXT)]);
  }
  if (caseId === "catalog-invalid-utf8") return Buffer.from([0xff]);
  if (caseId === "catalog-duplicate-key") {
    return Buffer.from(
      BASE_CATALOG_TEXT.replace(
        '"contract_id": "minimax-h3-tool.component-manifest",',
        '"contract_id": "minimax-h3-tool.component-manifest",\n  "contract_id": "minimax-h3-tool.component-manifest",'
      ),
      "utf8"
    );
  }
  if (caseId === "catalog-negative-zero") {
    return Buffer.from(BASE_CATALOG_TEXT.replace('"document_revision": 1', '"document_revision": -0'));
  }
  if (caseId === "catalog-float") {
    return Buffer.from(BASE_CATALOG_TEXT.replace('"document_revision": 1', '"document_revision": 1.0'));
  }
  if (caseId === "catalog-exponent") {
    return Buffer.from(BASE_CATALOG_TEXT.replace('"document_revision": 1', '"document_revision": 1e0'));
  }
  if (caseId === "catalog-unsafe-integer") {
    return Buffer.from(
      BASE_CATALOG_TEXT.replace('"document_revision": 1', '"document_revision": 9007199254740992')
    );
  }
  if (caseId === "catalog-lone-surrogate") {
    return Buffer.from(
      BASE_CATALOG_TEXT.replace(
        '"manifest_id": "alpha0-component-schema-fixture"',
        '"manifest_id": "\\ud800"'
      )
    );
  }
  if (caseId === "catalog-depth-limit") {
    return Buffer.from(`${"[".repeat(66)}0${"]".repeat(66)}`);
  }
  if (caseId === "catalog-object-property-limit") {
    return Buffer.from(
      `{${Array.from({ length: 10_001 }, (_, index) => `"k${index}":0`).join(",")}}`
    );
  }
  if (caseId === "catalog-array-item-limit") {
    return Buffer.from(`[${Array.from({ length: 10_001 }, () => "0").join(",")}]`);
  }
  if (caseId === "catalog-key-limit") {
    return Buffer.from(`{"${"k".repeat(129)}":0}`);
  }
  if (caseId === "catalog-string-limit") {
    return Buffer.from(`"${"s".repeat(1024 * 1024 + 1)}"`);
  }
  if (caseId === "catalog-total-string-limit") {
    const value = `"${"s".repeat(1_000_000)}"`;
    return Buffer.from(`[${Array.from({ length: 13 }, () => value).join(",")}]`);
  }
  if (caseId === "catalog-value-count-limit") {
    const array = `[${Array.from({ length: 10_000 }, () => "0").join(",")}]`;
    return Buffer.from(`[${Array.from({ length: 20 }, () => array).join(",")},[0]]`);
  }
  if (caseId === "catalog-raw-size-limit") {
    return Buffer.alloc(16 * 1024 * 1024 + 1, 0x20);
  }
  throw new Error("TEST.UNKNOWN_INVALID_CATALOG_CASE");
}

function requestForCase(caseId) {
  if (caseId === "resource-index-incomplete-kind") {
    const index = defaultResourceIndex();
    index.kind = "partial_embedded_resource_index";
    return makeRequest({ resourceIndex: index });
  }
  if (caseId === "resource-zero-catalog") {
    const index = defaultResourceIndex();
    index.resources = index.resources.filter((resource) => resource.role !== "component_catalog");
    return makeRequest({ resourceIndex: index });
  }
  if (caseId === "resource-second-catalog") {
    const index = defaultResourceIndex();
    index.resources.push({
      resource: "catalog/second-component-manifest.json",
      role: "component_catalog",
      bytes: Buffer.from(BASE_CATALOG_TEXT)
    });
    return makeRequest({ resourceIndex: index });
  }
  if (caseId === "resource-duplicate-name") {
    const index = defaultResourceIndex();
    index.resources.push({ resource: BASE_RESOURCE, role: "other_embedded_resource" });
    return makeRequest({ resourceIndex: index });
  }
  if (caseId === "resource-windows-case-alias") {
    const index = defaultResourceIndex();
    index.resources.push({ resource: BASE_RESOURCE.toUpperCase(), role: "other_embedded_resource" });
    return makeRequest({ resourceIndex: index });
  }
  if (caseId === "request-remote-override") {
    return { ...makeRequest(), remote_override: "https://example.invalid/catalog.json" };
  }
  if (caseId === "resource-network-uri") {
    const index = defaultResourceIndex();
    index.resources[1].resource = "https://example.invalid/catalog.json";
    return makeRequest({ resourceIndex: index });
  }
  if (caseId === "resource-percent-encoded-traversal") {
    const index = defaultResourceIndex();
    index.resources[1].resource = "catalog/%2e%2e/component-manifest.json";
    return makeRequest({ resourceIndex: index });
  }
  if (caseId === "inventory-noncanonical") return makeRequest({ nonCanonicalInventory: true });
  if (caseId === "inventory-duplicate-key") {
    const request = makeRequest();
    const text = request.signed_build_inventory.toString("utf8");
    request.signed_build_inventory = Buffer.from(
      text.replace(
        '"envelope_version":"1.0.0",',
        '"envelope_version":"1.0.0","envelope_version":"1.0.0",'
      ),
      "utf8"
    );
    return request;
  }
  if (caseId === "inventory-signature-tamper") {
    return makeRequest({ mutateEnvelope: mutateSignatureValue });
  }
  if (caseId === "inventory-unknown-key") {
    return makeRequest({
      mutateEnvelope(envelope) {
        envelope.signature.key_id = "untrusted-inventory-key";
      }
    });
  }
  if (caseId === "inventory-self-declared-verified") {
    return makeRequest({
      mutateEnvelope(envelope) {
        envelope.signature_status = "verified";
      }
    });
  }
  if (caseId === "inventory-self-supplied-key") {
    return makeRequest({
      mutateEnvelope(envelope) {
        envelope.signature.public_key_spki_der = FIXTURE_PUBLIC_KEY_DER.toString("base64");
      }
    });
  }
  if (caseId === "inventory-status-drift") {
    return makeRequest({ mutatePayload: (payload) => (payload.disposition.kind = "revoked") });
  }
  if (caseId === "inventory-signing-policy-drift") {
    return makeRequest({ mutatePayload: (payload) => (payload.signing.key_id = "different-key") });
  }
  if (caseId === "inventory-app-drift") {
    return makeRequest({
      mutatePayload(payload) {
        payload.current_app.app_version = "0.2.0";
        payload.catalog_bindings[0].app_version = "0.2.0";
      }
    });
  }
  if (caseId === "inventory-hash-drift") {
    return makeRequest({
      mutatePayload(payload) {
        payload.catalog_bindings[0].content_sha256 = `sha256:${"0".repeat(64)}`;
      }
    });
  }
  if (caseId === "inventory-resource-drift") {
    return makeRequest({
      mutatePayload(payload) {
        payload.catalog_bindings[0].catalog_resource = "catalog/other-component-manifest.json";
      }
    });
  }
  if (caseId === "inventory-extra-binding") {
    return makeRequest({
      mutatePayload(payload) {
        payload.catalog_bindings.push(clone(payload.catalog_bindings[0]));
      }
    });
  }
  if (caseId === "inventory-network-catalog") {
    return makeRequest({
      mutatePayload(payload) {
        payload.catalog_bindings[0].catalog_resource = "https://example.invalid/catalog.json";
      }
    });
  }
  if (caseId === "inventory-mutable-catalog") {
    return makeRequest({
      mutatePayload(payload) {
        payload.catalog_bindings[0].catalog_resource = "catalog/latest/component-manifest.json";
      }
    });
  }
  if (caseId.startsWith("catalog-")) {
    return makeRequest({ catalogBytes: invalidCatalogBytes(caseId) });
  }
  if (caseId === "manifest-integrity-drift") {
    const document = clone(BASE_DOCUMENT);
    document.manifest_id = "tampered-manifest-id";
    return makeRequest({ document });
  }
  if (caseId === "manifest-unknown-operational-field") {
    const document = clone(BASE_DOCUMENT);
    document.auto_install = true;
    refreshIntegrity(document);
    return makeRequest({ document });
  }
  if (caseId === "manifest-mutable-latest") {
    const document = clone(BASE_DOCUMENT);
    const component = document.components[0];
    component.source.locator = component.source.locator.replace(
      "/python/",
      "/latest/python/"
    );
    refreshIntegrity(document);
    return makeRequest({ document });
  }
  if (caseId === "manifest-dependency-cycle") {
    const document = clone(BASE_DOCUMENT);
    const source = document.components[0];
    const target = document.components[1];
    source.dependencies.push({
      component_id: target.component_id,
      component_version: target.component_version,
      artifact_sha256: target.artifact.artifact_sha256,
      kind: "required_runtime"
    });
    refreshIntegrity(document);
    return makeRequest({ document });
  }
  if (caseId === "manifest-signature-stale") {
    const document = clone(BASE_DOCUMENT);
    const component = document.components.find((candidate) => candidate.signature);
    component.signature.signed_artifact_sha256 = `sha256:${"0".repeat(64)}`;
    refreshIntegrity(document);
    return makeRequest({ document });
  }
  if (caseId === "manifest-status-drift") {
    const document = clone(BASE_DOCUMENT);
    document.disposition = {
      kind: "revoked",
      reason_code: "CATALOG.REVOKED"
    };
    refreshIntegrity(document);
    return makeRequest({ document });
  }
  if (caseId === "manifest-app-binding-drift") {
    const document = clone(BASE_DOCUMENT);
    document.catalog_binding.app_version = "0.2.0";
    refreshIntegrity(document);
    return makeRequest({ document });
  }
  if (caseId === "manifest-resource-binding-drift") {
    const document = clone(BASE_DOCUMENT);
    document.catalog_binding.catalog_resource = "catalog/other-component-manifest.json";
    refreshIntegrity(document);
    return makeRequest({ document });
  }
  if (caseId === "manifest-authority-escalation") {
    const document = clone(BASE_DOCUMENT);
    document.authority.execution_authority = "queue_and_execute";
    refreshIntegrity(document);
    return makeRequest({ document });
  }
  throw new Error("TEST.UNKNOWN_CASE");
}

function snapshotPackageTree() {
  const records = [];
  function visit(directory) {
    for (const name of readdirSync(directory).sort()) {
      const absolute = resolve(directory, name);
      const metadata = lstatSync(absolute);
      assert.equal(metadata.isSymbolicLink(), false);
      if (metadata.isDirectory()) visit(absolute);
      else if (metadata.isFile()) {
        records.push(
          `${relative(PACKAGE_ROOT, absolute).replaceAll("\\", "/")}:${createHash("sha256")
            .update(readFileSync(absolute))
            .digest("hex")}`
        );
      }
    }
  }
  visit(PACKAGE_ROOT);
  return records.join("\n");
}

const packageSnapshotBefore = snapshotPackageTree();

test("valid signed current-app tuple yields frozen lazy data only", () => {
  const handle = loader.load(makeRequest());
  assert.equal(handle.kind, "lazy_embedded_component_catalog_data");
  assert.equal(handle.schema_digest, COMPONENT_MANIFEST_SCHEMA_DIGEST);
  assert.equal(handle.content_sha256, BASE_DOCUMENT.integrity.content_sha256);
  assert.equal(handle.component_count, BASE_DOCUMENT.components.length);
  assert.equal(handle.license_record_count, BASE_DOCUMENT.license_records.length);
  assert.equal(Object.isFrozen(handle), true);
  assert.equal(Object.isFrozen(handle.metadata), true);
  assert.equal(handle.has_component("python-runtime-fixture"), true);
  assert.equal(handle.get_component("missing-component"), undefined);
  assert.deepEqual(
    [...handle.components()].map((component) => component.component_id),
    BASE_DOCUMENT.components.map((component) => component.component_id)
  );
  assert.equal(Object.isFrozen(handle.get_component("python-runtime-fixture")), true);
  assert.throws(() => {
    handle.get_component("python-runtime-fixture").release_state = "eligible";
  }, TypeError);
  assert.doesNotMatch(
    Object.keys(handle).join(" "),
    /download|materialize|execute|delete|launch|queue|install/iu
  );
});

test("revision-pinned HTTPS artifact locators remain inert accepted data", () => {
  const handle = loader.load(makeRequest());
  const component = handle.get_component("python-runtime-fixture");
  assert.equal(component.source.kind, "immutable_https");
  assert.equal(
    component.source.locator,
    "https://artifacts.example.invalid/python/1111111111111111111111111111111111111111/python-runtime-fixture.zip"
  );
  assert.equal(component.source.retrieval_policy, "explicit_install_only");
});

test("source capability boundary contains no I/O, process, network, Python or action API", () => {
  const sourceFiles = readdirSync(resolve(PACKAGE_ROOT, "src"))
    .filter((name) => name.endsWith(".mjs"))
    .sort();
  const source = sourceFiles
    .map((name) => readFileSync(resolve(PACKAGE_ROOT, "src", name), "utf8"))
    .join("\n");
  assert.doesNotMatch(source, /from\s+["']node:(?:fs|net|http|https|tls|dns|dgram|child_process|worker_threads)["']/u);
  assert.doesNotMatch(source, /\b(?:fetch|WebSocket|XMLHttpRequest)\s*\(/u);
  assert.doesNotMatch(source, /(?:import|require)\s*\([^)]*(?:\.py|python|custom[_-]?node)/iu);
  assert.doesNotMatch(source, /Buffer\.from\((?:resource\.bytes|request\.signed_build_inventory)\)/u);
});

test("delegated upstream identities remain blocked, unverified and non-actionable evidence", () => {
  const fixture = JSON.parse(readFileSync(USER_IDENTITIES_PATH, "utf8"));
  assert.equal(fixture.evidence_class, "delegated_user_provided_unverified_identity_data");
  assert.equal(fixture.actionable, false);
  assert.equal(fixture.license_approved, false);
  assert.equal(fixture.provenance_verified, false);
  assert.equal(fixture.signature_verified, false);
  assert.equal(fixture.release_state, "blocked");
  assert.equal(
    sha256Jcs(fixture),
    "sha256:f48c6dcb82bf8ebf834072082f0e34b5562243ae13b2b4cd06012c8b90b71759"
  );
  assert.equal(fixture.upstream.revision, "4cc1d817b6184899b41293954329f576cb5ae86b");
  assert.equal(fixture.artifacts.length, 5);
  for (const artifact of fixture.artifacts) {
    assert.equal(Number.isSafeInteger(artifact.byte_length), true);
    assert.match(artifact.artifact_sha256, /^sha256:[0-9a-f]{64}$/u);
  }
  assert.equal(fixture.artifacts.find((artifact) => artifact.role === "ref2va").byte_length, 20970379616);
});

const fixtureCases = JSON.parse(readFileSync(CASES_PATH, "utf8"));
assert.equal(fixtureCases.fixture_case_version, "1.0.0");
for (const fixtureCase of fixtureCases.cases) {
  test(`fail closed ${fixtureCase.case_id}`, () => {
    expectFailure(() => loader.load(requestForCase(fixtureCase.case_id)), fixtureCase.expected);
  });
}

test("current app mutable build identity is rejected before loading", () => {
  expectFailure(
    () =>
      createEmbeddedCatalogLoader({
        current_app: { ...CURRENT_APP, app_build_id: "latest" },
        trusted_inventory_keys: [
          {
            key_id: FIXTURE_KEY_ID,
            algorithm: "ed25519",
            public_key_spki_der: FIXTURE_PUBLIC_KEY_DER
          }
        ]
      }),
    "CATALOG.MUTABLE_REFERENCE_FORBIDDEN"
  );
});

test("trust-anchor DER is size-bounded before parsing or copying", () => {
  expectFailure(
    () =>
      createEmbeddedCatalogLoader({
        current_app: CURRENT_APP,
        trusted_inventory_keys: [
          {
            key_id: FIXTURE_KEY_ID,
            algorithm: "ed25519",
            public_key_spki_der: new Uint8Array(4097)
          }
        ]
      }),
    {
      code: "CATALOG.TRUST_ANCHOR_INVALID",
      stage: "configuration",
      instance_path: "/trusted_inventory_keys/0/public_key_spki_der",
      rule_id: "catalog.inventory.spki_der_size_bounded"
    }
  );
});

test("trust-anchor DER rejects a parseable trailing-byte alias", () => {
  expectFailure(
    () =>
      createEmbeddedCatalogLoader({
        current_app: CURRENT_APP,
        trusted_inventory_keys: [
          {
            key_id: FIXTURE_KEY_ID,
            algorithm: "ed25519",
            public_key_spki_der: Buffer.concat([FIXTURE_PUBLIC_KEY_DER, Buffer.from([0])])
          }
        ]
      }),
    {
      code: "CATALOG.TRUST_ANCHOR_INVALID",
      stage: "configuration",
      instance_path: "/trusted_inventory_keys/0/public_key_spki_der",
      rule_id: "catalog.inventory.spki_der_canonical"
    }
  );
});

test("package tree remains byte-identical during tests", () => {
  assert.equal(snapshotPackageTree(), packageSnapshotBefore);
});

let passed = 0;
let failed = 0;
for (const { name, callback } of tests) {
  try {
    await callback();
    process.stdout.write(`PASS ${name}\n`);
    passed += 1;
  } catch (error) {
    const reason = error?.code ?? error?.name ?? "TEST.FAILURE";
    process.stdout.write(`FAIL ${name} reason=${reason}\n`);
    failed += 1;
  }
}
process.stdout.write(
  `SUMMARY passed=${passed} failed=${failed} negative_cases=${fixtureCases.cases.length}\n`
);
if (failed > 0) process.exitCode = 1;
