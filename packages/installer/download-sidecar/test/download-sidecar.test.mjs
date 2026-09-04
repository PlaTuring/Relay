import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { canonicalBytes } from "../src/canonical-json.mjs";
import {
  DownloadSidecarError,
  MAX_ARTIFACT_BYTES,
  attachIntegrity,
  computePartialIdentity,
  parseCanonicalRecoveryPrior,
  parseCanonicalSidecar,
  serializeCanonicalSidecar,
  toPublicError,
  validateInitialSidecar,
  validateSidecar,
  validateTransition
} from "../src/index.mjs";
import {
  FIXTURE_ARTIFACT_HASH,
  FIXTURE_EXPECTED_LENGTH,
  FIXTURE_LEASE_ID,
  FIXTURE_OWNER_TOKEN,
  FIXTURE_PROCESS_TICKS,
  FIXTURE_REVISION,
  HOSTILE_CLASS_NAMES,
  RAW_HOSTILE_FIXTURES,
  activeLease,
  expectedBytesReceivedDocument,
  makeDocument,
  makeLease,
  receivingDocument,
  resign
} from "./fixtures.mjs";

function expectError(operation, expected) {
  let captured;
  try {
    operation();
  } catch (error) {
    captured = error;
  }
  assert.ok(captured instanceof DownloadSidecarError, "expected DownloadSidecarError");
  assert.deepEqual(toPublicError(captured), expected);
  assert.equal(captured.message, expected.code);
  return captured;
}

function publicTuple(code, instancePath, ruleId) {
  return { code, instance_path: instancePath, rule_id: ruleId };
}

function validateFixture(document, lease = document.lease) {
  return validateSidecar(document, { activeLease: activeLease(lease) });
}

function locatorWithPath(path) {
  return `https://downloads.example.test/${path}`;
}

function changeLocator(document, locator, revision = FIXTURE_REVISION) {
  return resign(
    document,
    (core) => {
      core.component_manifest.source_locator = locator;
      core.component_manifest.source_revision = revision;
      core.source.locator = locator;
      core.source.revision = revision;
    },
    { recomputePartialIdentity: true }
  );
}

describe("canonical, duplicate-detecting sidecar bytes", () => {
  test("initial fixture serializes to exact canonical UTF-8 and parses frozen", () => {
    const document = makeDocument();
    const lease = activeLease(document.lease);
    const first = serializeCanonicalSidecar(document, { activeLease: lease, initial: true });
    const second = serializeCanonicalSidecar(document, { activeLease: lease, initial: true });

    assert.deepEqual(first, second);
    assert.deepEqual(first, canonicalBytes(document));
    assert.equal(first[0], "{".charCodeAt(0));
    assert.equal(first.at(-1), "}".charCodeAt(0));
    assert.equal(first.includes(0x0a), false);
    assert.equal(first.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), false);

    const parsed = parseCanonicalSidecar(first, { activeLease: lease, initial: true });
    assert.deepEqual(canonicalBytes(parsed), canonicalBytes(document));
    assert.equal(Object.isFrozen(parsed), true);
    assert.equal(Object.isFrozen(parsed.lease.owner), true);
    assert.equal(parsed.partial.identity, computePartialIdentity(parsed));
    assert.equal(first.length, 2118);
    assert.equal(
      createHash("sha256").update(first).digest("hex"),
      "57d989bf085fb041a7fa5ceef530568847a5ece0e5bae88284f2437f0c5a39cc"
    );
    assert.equal(
      document.partial.identity,
      "sha256:dea9f10712d901c3397daf1a4859db937fde0a5e4dc7b941eaf7454b616d1b86"
    );
    assert.equal(
      document.integrity.content_sha256,
      "sha256:29ed93eb13824902d5ebebcdb2abbeeb617a96c2524b4cd4c3d89a2d57eaa486"
    );
  });

  for (const fixture of RAW_HOSTILE_FIXTURES) {
    test(`rejects raw hostile fixture: ${fixture.name}`, () => {
      const expectedByName = {
        duplicate_key: publicTuple(
          "SIDECAR.DUPLICATE_KEY",
          "/contract_id",
          "sidecar.json.duplicate_key"
        ),
        exponent_number: publicTuple(
          "SIDECAR.INVALID_NUMBER",
          "/<redacted>",
          "sidecar.json.integer_lexical_only"
        ),
        fractional_number: publicTuple(
          "SIDECAR.INVALID_NUMBER",
          "/<redacted>",
          "sidecar.json.integer_lexical_only"
        ),
        invalid_utf8: publicTuple(
          "SIDECAR.INVALID_UTF8",
          "",
          "sidecar.input.valid_utf8"
        ),
        negative_zero: publicTuple(
          "SIDECAR.INVALID_NUMBER",
          "/<redacted>",
          "sidecar.json.negative_zero_forbidden"
        ),
        noncanonical_whitespace: publicTuple(
          "SIDECAR.NON_CANONICAL_BYTES",
          "",
          "sidecar.input.exact_jcs_bytes"
        ),
        unsafe_integer: publicTuple(
          "SIDECAR.INVALID_NUMBER",
          "/<redacted>",
          "sidecar.json.safe_integer_only"
        ),
        utf8_bom: publicTuple(
          "SIDECAR.UTF8_BOM_FORBIDDEN",
          "",
          "sidecar.input.utf8_without_bom"
        )
      };
      expectError(() => parseCanonicalSidecar(fixture.bytes), expectedByName[fixture.name]);
    });
  }

  test("rejects a noncanonical pretty-printed otherwise valid document", () => {
    const document = makeDocument();
    const bytes = Buffer.from(JSON.stringify(document, null, 2), "utf8");
    expectError(
      () => parseCanonicalSidecar(bytes, { activeLease: activeLease(document.lease) }),
      publicTuple("SIDECAR.NON_CANONICAL_BYTES", "", "sidecar.input.exact_jcs_bytes")
    );
  });

  test("enforces raw bytes, nesting, key, and string parser ceilings", () => {
    expectError(
      () => parseCanonicalSidecar(Buffer.alloc(64 * 1024 + 1, 0x20)),
      publicTuple("SIDECAR.INPUT_TOO_LARGE", "", "sidecar.input.raw_size_limit")
    );

    const depth = 17;
    const deepBytes = Buffer.from(`${'{"a":'.repeat(depth)}0${"}".repeat(depth)}`, "utf8");
    expectError(
      () => parseCanonicalSidecar(deepBytes),
      publicTuple(
        "SIDECAR.INPUT_TOO_DEEP",
        "/<redacted>".repeat(depth),
        "sidecar.json.depth_limit"
      )
    );

    const longKeyBytes = Buffer.from(`{${JSON.stringify("k".repeat(129))}:0}`, "utf8");
    expectError(
      () => parseCanonicalSidecar(longKeyBytes),
      publicTuple("SIDECAR.KEY_TOO_LARGE", "", "sidecar.json.key_size_limit")
    );

    const longStringBytes = Buffer.from(
      `{"state":${JSON.stringify("s".repeat(4097))}}`,
      "utf8"
    );
    expectError(
      () => parseCanonicalSidecar(longStringBytes),
      publicTuple("SIDECAR.STRING_TOO_LARGE", "/state", "sidecar.json.string_size_limit")
    );
  });

  test("rejects unknown closed fields with an exact tuple", () => {
    const document = resign(makeDocument(), (core) => {
      core.unexpected = "data";
    });
    expectError(
      () => validateFixture(document),
      publicTuple("SIDECAR.UNKNOWN_FIELD", "/<redacted>", "sidecar.root.closed")
    );
  });

  test("redacts hostile unknown and duplicate key names from public error paths", () => {
    const privateKey = "C:\\Users\\Administrator\\secret/token";
    const document = resign(makeDocument(), (core) => {
      core[privateKey] = "private";
    });
    const unknownError = expectError(
      () => validateFixture(document),
      publicTuple("SIDECAR.UNKNOWN_FIELD", "/<redacted>", "sidecar.root.closed")
    );

    const encodedKey = JSON.stringify(privateKey);
    const duplicateBytes = Buffer.from(`{${encodedKey}:1,${encodedKey}:2}`, "utf8");
    const duplicateError = expectError(
      () => parseCanonicalSidecar(duplicateBytes),
      publicTuple("SIDECAR.DUPLICATE_KEY", "/<redacted>", "sidecar.json.duplicate_key")
    );

    const nested = resign(makeDocument(), (core) => {
      core.source[privateKey] = "private";
    });
    const nestedError = expectError(
      () => validateFixture(nested),
      publicTuple("SIDECAR.UNKNOWN_FIELD", "/source/<redacted>", "sidecar.source.closed")
    );

    const malformedBytes = Buffer.from(`{${encodedKey}:-0}`, "utf8");
    const malformedError = expectError(
      () => parseCanonicalSidecar(malformedBytes),
      publicTuple(
        "SIDECAR.INVALID_NUMBER",
        "/<redacted>",
        "sidecar.json.negative_zero_forbidden"
      )
    );

    for (const error of [unknownError, duplicateError, nestedError, malformedError]) {
      const publicObject = toPublicError(error);
      const publicBytes = JSON.stringify(publicObject);
      const publicPropertyNames = Object.keys(publicObject).join("|");
      for (const forbidden of [
        "Administrator",
        "secret",
        "ownerToken",
        "owner_token",
        "processStartUtcTicks",
        "owner_process_start_utc_ticks",
        "C:\\\\"
      ]) {
        assert.equal(publicBytes.includes(forbidden), false, forbidden);
        assert.equal(publicPropertyNames.includes(forbidden), false, forbidden);
      }
    }
  });

  test("rejects integrity mismatch before domain interpretation", () => {
    const document = makeDocument();
    const tampered = structuredClone(document);
    tampered.retry_generation = 1;
    expectError(
      () =>
        parseCanonicalSidecar(canonicalBytes(tampered), {
          activeLease: activeLease(document.lease)
        }),
      publicTuple(
        "SIDECAR.INTEGRITY_MISMATCH",
        "/integrity",
        "sidecar.integrity.root_without_integrity_jcs"
      )
    );
  });

  test("attachIntegrity is deterministic and refuses a second integrity envelope", () => {
    const document = makeDocument();
    const core = structuredClone(document);
    delete core.integrity;
    assert.deepEqual(attachIntegrity(core), document);
    expectError(
      () => attachIntegrity(document),
      publicTuple(
        "SIDECAR.INTEGRITY_ALREADY_PRESENT",
        "/integrity",
        "sidecar.integrity.attach_once"
      )
    );
  });
});

describe("immutable source, ETag, manifest, and partial identity bindings", () => {
  const urlCases = [
    ["non_https", `http://downloads.example.test/releases/${FIXTURE_REVISION}/model.safetensors`, "sidecar.source.url.https_only"],
    ["credentials", `https://user@downloads.example.test/releases/${FIXTURE_REVISION}/model.safetensors`, "sidecar.source.url.credentials_or_ip_literal"],
    ["query", `https://downloads.example.test/releases/${FIXTURE_REVISION}/model.safetensors?x=1`, "sidecar.source.url.raw_hazards_forbidden"],
    ["fragment", `https://downloads.example.test/releases/${FIXTURE_REVISION}/model.safetensors#x`, "sidecar.source.url.raw_hazards_forbidden"],
    ["non_443", `https://downloads.example.test:444/releases/${FIXTURE_REVISION}/model.safetensors`, "sidecar.source.url.https_port_only"],
    ["backslash", `https://downloads.example.test/releases\\${FIXTURE_REVISION}/model.safetensors`, "sidecar.source.url.raw_hazards_forbidden"],
    ["traversal", `https://downloads.example.test/releases/../${FIXTURE_REVISION}/model.safetensors`, "sidecar.source.url.path_segments"],
    ["percent_traversal", `https://downloads.example.test/releases/%2e%2e/${FIXTURE_REVISION}/model.safetensors`, "sidecar.source.url.raw_hazards_forbidden"]
  ];

  for (const [name, locator, ruleId] of urlCases) {
    test(`rejects hostile raw URL without normalization: ${name}`, () => {
      const document = changeLocator(makeDocument(), locator);
      expectError(
        () => validateFixture(document),
        publicTuple(
          "SIDECAR.UNSAFE_SOURCE_URL",
          "/component_manifest/source_locator",
          ruleId
        )
      );
    });
  }

  for (const mutable of [
    "latest",
    "latest.zip",
    "main",
    "main-build",
    "master",
    "head",
    "current",
    "current_1",
    "branch",
    "branch.foo",
    "refs",
    "heads"
  ]) {
    test(`rejects mutable source reference segment: ${mutable}`, () => {
      const locator = locatorWithPath(
        `releases/${mutable}/${FIXTURE_REVISION}/model.safetensors`
      );
      const document = changeLocator(makeDocument(), locator);
      expectError(
        () => validateFixture(document),
        publicTuple(
          "SIDECAR.MUTABLE_SOURCE_REF",
          "/component_manifest/source_locator",
          "sidecar.source.url.mutable_ref_forbidden"
        )
      );
    });
  }

  test("rejects locator whose revision segment differs from the exact revision field", () => {
    const otherRevision = "f".repeat(40);
    const locator = locatorWithPath(`releases/${otherRevision}/model.safetensors`);
    const document = changeLocator(makeDocument(), locator, FIXTURE_REVISION);
    expectError(
      () => validateFixture(document),
      publicTuple(
        "SIDECAR.REVISION_BINDING_INVALID",
        "/component_manifest/source_locator",
        "sidecar.source.url.exact_revision_segment"
      )
    );
  });

  for (const invalidEtag of ["W/\"weak\"", "unquoted", '"a","b"', '"has space"', '""']) {
    test(`rejects invalid or weak/list ETag: ${JSON.stringify(invalidEtag)}`, () => {
      const document = resign(
        makeDocument(),
        (core) => {
          core.source.strong_etag = invalidEtag;
        },
        { recomputePartialIdentity: true }
      );
      expectError(
        () => validateFixture(document),
        publicTuple(
          "SIDECAR.INVALID_ETAG",
          "/source/strong_etag",
          "sidecar.source.etag.strong_single_quoted"
        )
      );
    });
  }

  test("rejects content-derived partial identity tampering even with valid root integrity", () => {
    const document = resign(makeDocument(), (core) => {
      core.partial.identity = `sha256:${"c".repeat(64)}`;
    });
    expectError(
      () => validateFixture(document),
      publicTuple(
        "SIDECAR.PARTIAL_IDENTITY_MISMATCH",
        "/partial/identity",
        "sidecar.partial.identity.projection_exact"
      )
    );
  });

  test("rejects source, ETag, expected identity, manifest snapshot, and partial path drift", () => {
    const previous = receivingDocument();
    const nextBase = receivingDocument({ byteLength: 256, documentRevision: 3 });
    const otherRevision = "fedcba9876543210fedcba9876543210fedcba98";

    const sourceDrift = resign(
      nextBase,
      (core) => {
        const locator = locatorWithPath(`releases/${otherRevision}/model.safetensors`);
        core.source.locator = locator;
        core.source.revision = otherRevision;
        core.component_manifest.source_locator = locator;
        core.component_manifest.source_revision = otherRevision;
      },
      { recomputePartialIdentity: true }
    );
    expectError(
      () => validateTransition(previous, sourceDrift, { activeLease: activeLease(sourceDrift.lease) }),
      publicTuple("SIDECAR.SOURCE_DRIFT", "/source", "sidecar.transition.source_stable")
    );

    const etagDrift = resign(
      nextBase,
      (core) => {
        core.source.strong_etag = '"fixture-etag-b"';
      },
      { recomputePartialIdentity: true }
    );
    expectError(
      () => validateTransition(previous, etagDrift, { activeLease: activeLease(etagDrift.lease) }),
      publicTuple(
        "SIDECAR.ETAG_DRIFT",
        "/source/strong_etag",
        "sidecar.transition.etag_stable"
      )
    );

    const expectedDrift = resign(
      nextBase,
      (core) => {
        core.source.expected_byte_length = 2048;
        core.component_manifest.artifact_byte_length = 2048;
      },
      { recomputePartialIdentity: true }
    );
    expectError(
      () => validateTransition(previous, expectedDrift, { activeLease: activeLease(expectedDrift.lease) }),
      publicTuple(
        "SIDECAR.EXPECTED_IDENTITY_DRIFT",
        "/source",
        "sidecar.transition.expected_identity_stable"
      )
    );

    const manifestDrift = resign(
      nextBase,
      (core) => {
        core.component_manifest.content_sha256 = `sha256:${"c".repeat(64)}`;
      },
      { recomputePartialIdentity: true }
    );
    expectError(
      () => validateTransition(previous, manifestDrift, { activeLease: activeLease(manifestDrift.lease) }),
      publicTuple(
        "SIDECAR.MANIFEST_BINDING_DRIFT",
        "/component_manifest",
        "sidecar.transition.manifest_binding_stable"
      )
    );

    const pathDigestMismatch = resign(
      nextBase,
      (core) => {
        core.partial.relative_path = `cache/downloads/${"d".repeat(64)}.partial`;
      },
      { recomputePartialIdentity: true }
    );
    expectError(
      () => validateTransition(previous, pathDigestMismatch, { activeLease: activeLease(pathDigestMismatch.lease) }),
      publicTuple(
        "SIDECAR.PARTIAL_PATH_IDENTITY_MISMATCH",
        "/partial/relative_path",
        "sidecar.partial.path.artifact_addressed_exact"
      )
    );
  });
});

describe("lexical hostile Windows partial paths", () => {
  const pathCases = [
    ["traversal", "../model.partial", "sidecar.partial.path.segment_safety"],
    ["percent_traversal", "cache/%2e%2e/model.partial", "sidecar.partial.path.lexical_safety"],
    ["ads", "cache/model.partial:stream", "sidecar.partial.path.lexical_safety"],
    ["device_name", "cache/CON.partial", "sidecar.partial.path.device_name_forbidden"],
    ["device_prefix", "//?/C:/model.partial", "sidecar.partial.path.lexical_safety"],
    ["unc", "\\\\server\\share\\model.partial", "sidecar.partial.path.lexical_safety"],
    ["absolute", "C:/cache/model.partial", "sidecar.partial.path.lexical_safety"],
    ["backslash", "cache\\model.partial", "sidecar.partial.path.lexical_safety"],
    ["empty_segment", "cache//model.partial", "sidecar.partial.path.segment_safety"],
    ["trailing_dot", "cache./model.partial", "sidecar.partial.path.segment_safety"],
    ["trailing_space", "cache /model.partial", "sidecar.partial.path.segment_safety"],
    ["reserved_character", "cache/<model>.partial", "sidecar.partial.path.lexical_safety"]
  ];

  for (const [name, relativePath, ruleId] of pathCases) {
    test(`rejects hostile path: ${name}`, () => {
      const document = resign(
        makeDocument(),
        (core) => {
          core.partial.relative_path = relativePath;
        },
        { recomputePartialIdentity: true }
      );
      expectError(
        () => validateFixture(document),
        publicTuple("SIDECAR.UNSAFE_RELATIVE_PATH", "/partial/relative_path", ruleId)
      );
    });
  }
});

describe("inclusive range and bounded length invariants", () => {
  test("accepts a contiguous inclusive prefix and rejects redundant length drift", () => {
    const valid = receivingDocument({ byteLength: 128 });
    assert.equal(validateFixture(valid), valid);
    assert.deepEqual(valid.partial.received_range, {
      byte_length: 128,
      end_inclusive: 127,
      kind: "inclusive_prefix",
      start_inclusive: 0
    });

    const mismatch = resign(valid, (core) => {
      core.partial.received_range.byte_length = 127;
    });
    expectError(
      () => validateFixture(mismatch),
      publicTuple(
        "SIDECAR.RANGE_LENGTH_MISMATCH",
        "/partial/received_range",
        "sidecar.partial.range.inclusive_length_exact"
      )
    );
  });

  test("rejects inclusive +1 overflow before range arithmetic is trusted", () => {
    const overflow = resign(receivingDocument(), (core) => {
      core.partial.received_range.end_inclusive = Number.MAX_SAFE_INTEGER;
      core.partial.received_range.byte_length = MAX_ARTIFACT_BYTES;
    });
    expectError(
      () => validateFixture(overflow),
      publicTuple(
        "SIDECAR.LENGTH_OVERFLOW",
        "/partial/received_range",
        "sidecar.partial.range.inclusive_math_safe"
      )
    );
  });

  test("rejects range over expected artifact length", () => {
    const overrun = makeDocument({ byteLength: FIXTURE_EXPECTED_LENGTH + 1, state: "receiving_bytes" });
    expectError(
      () => validateFixture(overrun),
      publicTuple(
        "SIDECAR.LENGTH_OVERFLOW",
        "/partial/received_range",
        "sidecar.partial.range.not_over_expected"
      )
    );
  });

  test("rejects expected lengths outside the package ceiling", () => {
    const document = resign(
      makeDocument(),
      (core) => {
        core.component_manifest.artifact_byte_length = MAX_ARTIFACT_BYTES + 1;
        core.source.expected_byte_length = MAX_ARTIFACT_BYTES + 1;
      },
      { recomputePartialIdentity: true }
    );
    expectError(
      () => validateFixture(document),
      publicTuple(
        "SIDECAR.INVALID_NUMBER",
        "/component_manifest/artifact_byte_length",
        "sidecar.component_manifest.artifact_length"
      )
    );
  });
});

describe("active artifact writer lease and three-part owner", () => {
  test("requires an active exact lease context", () => {
    const document = makeDocument();
    expectError(
      () => validateSidecar(document),
      publicTuple(
        "SIDECAR.ACTIVE_LEASE_REQUIRED",
        "/lease",
        "sidecar.lease.active_context_required"
      )
    );

    const inactive = activeLease(document.lease);
    inactive.active = false;
    expectError(
      () => validateSidecar(document, { activeLease: inactive }),
      publicTuple("SIDECAR.INVALID_VALUE", "/lease", "sidecar.active_lease.must_be_active")
    );
  });

  test("rejects lease ID/key/mode mismatch and requires a bare artifact hash key", () => {
    const document = makeDocument();
    const wrongId = activeLease(document.lease);
    wrongId.lease_id = "9".repeat(32);
    expectError(
      () => validateSidecar(document, { activeLease: wrongId }),
      publicTuple("SIDECAR.LEASE_MISMATCH", "/lease", "sidecar.lease.active_identity_exact")
    );

    const wrongKeyDocument = resign(document, (core) => {
      core.lease.resource_key = "d".repeat(64);
    });
    expectError(
      () => validateSidecar(wrongKeyDocument, { activeLease: activeLease(wrongKeyDocument.lease) }),
      publicTuple("SIDECAR.LEASE_MISMATCH", "/lease", "sidecar.lease.expected_artifact_key")
    );

    const prefixedKeyDocument = resign(document, (core) => {
      core.lease.resource_key = FIXTURE_ARTIFACT_HASH;
    });
    expectError(
      () => validateSidecar(prefixedKeyDocument, { activeLease: activeLease(prefixedKeyDocument.lease) }),
      publicTuple(
        "SIDECAR.INVALID_VALUE",
        "/lease/resource_key",
        "sidecar.lease.bare_hash_key"
      )
    );
  });

  test("rejects each foreign owner component without exposing private values", () => {
    const document = makeDocument();
    const mutations = [
      (lease) => {
        lease.owner.owner_token = "5".repeat(32);
      },
      (lease) => {
        lease.owner.owner_pid += 1;
      },
      (lease) => {
        lease.owner.owner_process_start_utc_ticks = "638602752000000001";
      }
    ];
    for (const mutate of mutations) {
      const foreign = activeLease(document.lease);
      mutate(foreign);
      const error = expectError(
        () => validateSidecar(document, { activeLease: foreign }),
        publicTuple(
          "SIDECAR.FOREIGN_OWNER",
          "/lease/owner",
          "sidecar.lease.active_owner_triple_exact"
        )
      );
      const publicObject = toPublicError(error);
      const publicBytes = JSON.stringify(publicObject);
      const publicPropertyNames = Object.keys(publicObject).join("|");
      assert.equal(publicBytes.includes(FIXTURE_OWNER_TOKEN), false);
      assert.equal(publicBytes.includes(FIXTURE_PROCESS_TICKS), false);
      assert.equal(publicBytes.includes("Administrator"), false);
      assert.equal(publicBytes.includes("C:\\"), false);
      assert.equal(publicBytes.includes("owner_token"), false);
      assert.equal(publicBytes.includes("owner_process_start_utc_ticks"), false);
      assert.equal(publicPropertyNames.includes("owner_token"), false);
      assert.equal(publicPropertyNames.includes("process_start"), false);
      assert.equal(error.stack.includes("C:\\"), false);
      assert.equal(error.stack.includes("Administrator"), false);
    }
  });

  test("stores process creation ticks as exact decimal text, never an unsafe JSON number", () => {
    const document = makeDocument();
    assert.equal(typeof document.lease.owner.owner_process_start_utc_ticks, "string");
    expectError(
      () =>
        resign(document, (core) => {
          core.lease.owner.owner_process_start_utc_ticks = 638602752000000000;
        }),
      publicTuple(
        "SIDECAR.INVALID_NUMBER",
        "/lease/owner",
        "sidecar.jcs.safe_integer_only"
      )
    );

    const outOfRangeTicks = resign(document, (core) => {
      core.lease.owner.owner_process_start_utc_ticks = "9999999999999999999";
    });
    expectError(
      () =>
        validateSidecar(outOfRangeTicks, {
          activeLease: activeLease(outOfRangeTicks.lease)
        }),
      publicTuple(
        "SIDECAR.INVALID_VALUE",
        "/lease/owner",
        "sidecar.lease.owner.process_start_ticks_bounds"
      )
    );
  });
});

describe("state, revision, retry generation, and recovery transitions", () => {
  test("accepts same-attempt progress and terminal bytes-received transitions", () => {
    const initial = makeDocument();
    const receiving128 = receivingDocument({ byteLength: 128, documentRevision: 2 });
    const receiving512 = receivingDocument({ byteLength: 512, documentRevision: 3 });
    const received = expectedBytesReceivedDocument({ documentRevision: 4 });
    const lease = activeLease(initial.lease);

    assert.equal(validateInitialSidecar(initial, { activeLease: lease }), initial);
    assert.equal(validateTransition(initial, receiving128, { activeLease: lease }), receiving128);
    assert.equal(validateTransition(receiving128, receiving512, { activeLease: lease }), receiving512);
    assert.equal(validateTransition(receiving512, received, { activeLease: lease }), received);
    assert.equal(received.retry_generation, 0);
  });

  test("accepts explicit retry +1 with non-regressing range and a newly active owner lease", () => {
    const previous = receivingDocument({ byteLength: 128, documentRevision: 2 });
    const newLease = makeLease({
      leaseId: "6".repeat(32),
      ownerPid: 5252,
      ownerProcessStartUtcTicks: "638602752000000111",
      ownerToken: "7".repeat(32)
    });
    const retry = makeDocument({
      byteLength: 128,
      documentRevision: 3,
      lease: newLease,
      retryGeneration: 1,
      state: "prepared"
    });
    assert.equal(
      validateTransition(previous, retry, { activeLease: activeLease(newLease) }),
      retry
    );
  });

  test("strictly parses a stale-owner prior only through the non-actionable recovery API", () => {
    const previous = receivingDocument({ byteLength: 128, documentRevision: 2 });
    const previousBytes = serializeCanonicalSidecar(previous, {
      activeLease: activeLease(previous.lease)
    });
    const newLease = makeLease({
      leaseId: "a1".repeat(16),
      ownerPid: 5353,
      ownerProcessStartUtcTicks: "638602752000000333",
      ownerToken: "b2".repeat(16)
    });
    const currentLease = activeLease(newLease);
    const retry = makeDocument({
      byteLength: 128,
      documentRevision: 3,
      lease: newLease,
      retryGeneration: 1,
      state: "prepared"
    });

    expectError(
      () => parseCanonicalSidecar(previousBytes, { activeLease: currentLease }),
      publicTuple(
        "SIDECAR.LEASE_MISMATCH",
        "/lease",
        "sidecar.lease.active_identity_exact"
      )
    );

    const recoveryPrior = parseCanonicalRecoveryPrior(previousBytes, {
      activeLease: currentLease
    });
    expectError(
      () => validateSidecar(recoveryPrior, { activeLease: currentLease }),
      publicTuple(
        "SIDECAR.RECOVERY_PRIOR_NON_ACTIONABLE",
        "",
        "sidecar.recovery.prior_only"
      )
    );
    assert.equal(
      validateTransition(recoveryPrior, retry, { activeLease: currentLease }),
      retry
    );
  });

  test("recovery-prior parsing rejects same-lease misuse and resource drift", () => {
    const previous = receivingDocument({ byteLength: 128, documentRevision: 2 });
    const previousBytes = serializeCanonicalSidecar(previous, {
      activeLease: activeLease(previous.lease)
    });
    expectError(
      () =>
        parseCanonicalRecoveryPrior(previousBytes, {
          activeLease: activeLease(previous.lease)
        }),
      publicTuple(
        "SIDECAR.RECOVERY_NOT_REQUIRED",
        "/lease",
        "sidecar.recovery.prior_lease_must_differ"
      )
    );

    const stolenIdLease = activeLease(
      makeLease({
        leaseId: previous.lease.lease_id,
        ownerPid: 5757,
        ownerProcessStartUtcTicks: "638602752000000777",
        ownerToken: "39".repeat(16)
      })
    );
    expectError(
      () => parseCanonicalRecoveryPrior(previousBytes, { activeLease: stolenIdLease }),
      publicTuple(
        "SIDECAR.LEASE_ID_OWNER_CONFLICT",
        "/lease",
        "sidecar.recovery.lease_id_never_rebound"
      )
    );

    const otherResource = activeLease(
      makeLease({
        leaseId: "c3".repeat(16),
        ownerPid: 5454,
        ownerProcessStartUtcTicks: "638602752000000444",
        ownerToken: "d4".repeat(16),
        resourceKey: "e".repeat(64)
      })
    );
    expectError(
      () => parseCanonicalRecoveryPrior(previousBytes, { activeLease: otherResource }),
      publicTuple(
        "SIDECAR.LEASE_MISMATCH",
        "/lease",
        "sidecar.recovery.same_artifact_writer_resource"
      )
    );

  });

  test("stale bytes-received terminal can only rebind exactly for downstream verification", () => {
    const terminal = expectedBytesReceivedDocument();
    const terminalBytes = serializeCanonicalSidecar(terminal, {
      activeLease: activeLease(terminal.lease)
    });
    const successorLease = makeLease({
      leaseId: "e5".repeat(16),
      ownerPid: 5555,
      ownerProcessStartUtcTicks: "638602752000000555",
      ownerToken: "f6".repeat(16)
    });
    const currentLease = activeLease(successorLease);
    const stolenIdLease = activeLease(
      makeLease({
        leaseId: terminal.lease.lease_id,
        ownerPid: 5566,
        ownerProcessStartUtcTicks: "638602752000000556",
        ownerToken: "07".repeat(16)
      })
    );
    expectError(
      () => parseCanonicalRecoveryPrior(terminalBytes, { activeLease: stolenIdLease }),
      publicTuple(
        "SIDECAR.LEASE_ID_OWNER_CONFLICT",
        "/lease",
        "sidecar.recovery.lease_id_never_rebound"
      )
    );
    const recoveryPrior = parseCanonicalRecoveryPrior(terminalBytes, {
      activeLease: currentLease
    });
    const rebound = makeDocument({
      byteLength: FIXTURE_EXPECTED_LENGTH,
      documentRevision: terminal.document_revision + 1,
      lease: successorLease,
      retryGeneration: terminal.retry_generation + 1,
      state: "expected_bytes_received"
    });
    assert.equal(validateTransition(recoveryPrior, rebound, { activeLease: currentLease }), rebound);
    assert.equal(validateSidecar(rebound, { activeLease: currentLease }), rebound);

    const sameLeaseRetry = resign(terminal, (core) => {
      core.document_revision += 1;
      core.retry_generation += 1;
    });
    expectError(
      () =>
        validateTransition(terminal, sameLeaseRetry, {
          activeLease: activeLease(sameLeaseRetry.lease)
        }),
      publicTuple(
        "SIDECAR.RECOVERY_REBIND_REQUIRED",
        "/lease",
        "sidecar.transition.terminal_retry_changes_lease_id"
      )
    );

    const reopened = makeDocument({
      byteLength: FIXTURE_EXPECTED_LENGTH,
      documentRevision: terminal.document_revision + 1,
      lease: successorLease,
      retryGeneration: terminal.retry_generation + 1,
      state: "receiving_bytes"
    });
    expectError(
      () => validateTransition(recoveryPrior, reopened, { activeLease: currentLease }),
      publicTuple("SIDECAR.STATE_JUMP", "/state", "sidecar.transition.terminal_rebind_only")
    );

    const etagDrift = resign(
      rebound,
      (core) => {
        core.source.strong_etag = '"terminal-drift"';
      },
      { recomputePartialIdentity: true }
    );
    expectError(
      () => validateTransition(recoveryPrior, etagDrift, { activeLease: currentLease }),
      publicTuple(
        "SIDECAR.ETAG_DRIFT",
        "/source/strong_etag",
        "sidecar.transition.etag_stable"
      )
    );

    const rangeDrift = resign(rebound, (core) => {
      core.partial.received_range.byte_length -= 1;
      core.partial.received_range.end_inclusive -= 1;
    });
    expectError(
      () => validateTransition(recoveryPrior, rangeDrift, { activeLease: currentLease }),
      publicTuple(
        "SIDECAR.STATE_RANGE_MISMATCH",
        "/state",
        "sidecar.state.expected_bytes_received_length"
      )
    );
  });

  test("new owner recovers an already full receiving prefix and finalizes bytes-received state", () => {
    const previous = receivingDocument({
      byteLength: FIXTURE_EXPECTED_LENGTH,
      documentRevision: 2
    });
    const previousBytes = serializeCanonicalSidecar(previous, {
      activeLease: activeLease(previous.lease)
    });
    const newLease = makeLease({
      leaseId: "17".repeat(16),
      ownerPid: 5656,
      ownerProcessStartUtcTicks: "638602752000000666",
      ownerToken: "28".repeat(16)
    });
    const currentLease = activeLease(newLease);
    const recoveryPrior = parseCanonicalRecoveryPrior(previousBytes, {
      activeLease: currentLease
    });
    const resumed = makeDocument({
      byteLength: FIXTURE_EXPECTED_LENGTH,
      documentRevision: 3,
      lease: newLease,
      retryGeneration: 1,
      state: "receiving_bytes"
    });
    const received = makeDocument({
      byteLength: FIXTURE_EXPECTED_LENGTH,
      documentRevision: 4,
      lease: newLease,
      retryGeneration: 1,
      state: "expected_bytes_received"
    });
    assert.equal(
      validateTransition(recoveryPrior, resumed, { activeLease: currentLease }),
      resumed
    );
    assert.equal(validateTransition(resumed, received, { activeLease: currentLease }), received);
  });

  test("rejects document revision skips", () => {
    const initial = makeDocument();
    const skipped = receivingDocument({ byteLength: 128, documentRevision: 3 });
    expectError(
      () => validateTransition(initial, skipped, { activeLease: activeLease(skipped.lease) }),
      publicTuple(
        "SIDECAR.REVISION_SKIP",
        "/document_revision",
        "sidecar.transition.revision_exactly_one"
      )
    );
  });

  test("rejects retry generation skips", () => {
    const previous = receivingDocument({ byteLength: 128, documentRevision: 2 });
    const skipped = makeDocument({
      byteLength: 128,
      documentRevision: 3,
      retryGeneration: 2,
      state: "prepared"
    });
    expectError(
      () => validateTransition(previous, skipped, { activeLease: activeLease(skipped.lease) }),
      publicTuple(
        "SIDECAR.RETRY_SKIP",
        "/retry_generation",
        "sidecar.transition.retry_same_or_exactly_one"
      )
    );
  });

  test("rejects state jumps and same-attempt no-op states", () => {
    const initial = makeDocument();
    const jumped = expectedBytesReceivedDocument({ documentRevision: 2 });
    expectError(
      () => validateTransition(initial, jumped, { activeLease: activeLease(jumped.lease) }),
      publicTuple("SIDECAR.STATE_JUMP", "/state", "sidecar.transition.same_attempt_edge")
    );

    const noOp = resign(initial, (core) => {
      core.document_revision = 2;
    });
    expectError(
      () => validateTransition(initial, noOp, { activeLease: activeLease(noOp.lease) }),
      publicTuple("SIDECAR.STATE_JUMP", "/state", "sidecar.transition.same_attempt_edge")
    );
  });

  test("rejects non-progress and any retry bookkeeping range drift", () => {
    const previous = receivingDocument({ byteLength: 128, documentRevision: 2 });
    const sameRange = receivingDocument({ byteLength: 128, documentRevision: 3 });
    expectError(
      () => validateTransition(previous, sameRange, { activeLease: activeLease(sameRange.lease) }),
      publicTuple(
        "SIDECAR.RANGE_NOT_ADVANCED",
        "/partial/received_range",
        "sidecar.transition.same_attempt_progress"
      )
    );

    const regressed = makeDocument({
      byteLength: 64,
      documentRevision: 3,
      retryGeneration: 1,
      state: "prepared"
    });
    expectError(
      () => validateTransition(previous, regressed, { activeLease: activeLease(regressed.lease) }),
      publicTuple(
        "SIDECAR.RANGE_DRIFT",
        "/partial/received_range",
        "sidecar.transition.retry_range_exact"
      )
    );

    const grown = makeDocument({
      byteLength: 256,
      documentRevision: 3,
      retryGeneration: 1,
      state: "prepared"
    });
    expectError(
      () => validateTransition(previous, grown, { activeLease: activeLease(grown.lease) }),
      publicTuple(
        "SIDECAR.RANGE_DRIFT",
        "/partial/received_range",
        "sidecar.transition.retry_range_exact"
      )
    );
  });

  test("a one-byte artifact has an adjacent-state legal completion path", () => {
    const initial = resign(
      makeDocument(),
      (core) => {
        core.component_manifest.artifact_byte_length = 1;
        core.source.expected_byte_length = 1;
      },
      { recomputePartialIdentity: true }
    );
    const receiving = resign(
      initial,
      (core) => {
        core.document_revision = 2;
        core.state = "receiving_bytes";
        core.partial.received_range = {
          byte_length: 1,
          end_inclusive: 0,
          kind: "inclusive_prefix",
          start_inclusive: 0
        };
      }
    );
    const received = resign(receiving, (core) => {
      core.document_revision = 3;
      core.state = "expected_bytes_received";
    });
    const lease = activeLease(initial.lease);
    assert.equal(validateInitialSidecar(initial, { activeLease: lease }), initial);
    assert.equal(validateTransition(initial, receiving, { activeLease: lease }), receiving);
    assert.equal(validateTransition(receiving, received, { activeLease: lease }), received);
  });

  test("requires retry generation +1 before changing owner/lease", () => {
    const initial = makeDocument();
    const newLease = makeLease({
      leaseId: "8".repeat(32),
      ownerPid: 6262,
      ownerProcessStartUtcTicks: "638602752000000222",
      ownerToken: "9".repeat(32)
    });
    const next = receivingDocument({ byteLength: 128, documentRevision: 2, lease: newLease });
    expectError(
      () => validateTransition(initial, next, { activeLease: activeLease(newLease) }),
      publicTuple(
        "SIDECAR.LEASE_BINDING_DRIFT",
        "/lease",
        "sidecar.transition.same_attempt_same_lease_owner"
      )
    );


    const stolenIdLease = makeLease({
      leaseId: initial.lease.lease_id,
      ownerPid: 6363,
      ownerProcessStartUtcTicks: "638602752000000888",
      ownerToken: "4a".repeat(16)
    });
    const stolenRetry = makeDocument({
      byteLength: 0,
      documentRevision: 2,
      lease: stolenIdLease,
      retryGeneration: 1,
      state: "prepared"
    });
    expectError(
      () =>
        validateTransition(initial, stolenRetry, {
          activeLease: activeLease(stolenIdLease)
        }),
      publicTuple(
        "SIDECAR.LEASE_ID_OWNER_CONFLICT",
        "/lease",
        "sidecar.transition.lease_id_never_rebound"
      )
    );
  });

  test("terminal state means expected bytes received only and grants no further authority", () => {
    const document = expectedBytesReceivedDocument();
    validateFixture(document);
    assert.equal(document.state, "expected_bytes_received");
    assert.equal(document.partial.received_range.byte_length, FIXTURE_EXPECTED_LENGTH);
    for (const [name, value] of Object.entries(document.authority)) {
      assert.equal(value, "none", name);
    }
    assert.equal("verified" in document, false);
    assert.equal("materialized" in document, false);
    assert.equal("complete" in document, false);

    const afterTerminal = resign(document, (core) => {
      core.document_revision += 1;
      core.retry_generation += 1;
      core.state = "prepared";
      core.partial.received_range = {
        byte_length: FIXTURE_EXPECTED_LENGTH - 1,
        end_inclusive: FIXTURE_EXPECTED_LENGTH - 2,
        kind: "inclusive_prefix",
        start_inclusive: 0
      };
    });
    expectError(
      () =>
        validateTransition(document, afterTerminal, {
          activeLease: activeLease(afterTerminal.lease)
      }),
      publicTuple(
        "SIDECAR.STATE_JUMP",
        "/state",
        "sidecar.transition.terminal_rebind_only"
      )
    );
  });
});

test("hostile fixture catalogue covers every required named attack class", () => {
  const covered = [
    "absolute_path",
    "ads_path",
    "backslash_path",
    "bom",
    "device_name",
    "device_prefix",
    "duplicate_key",
    "etag_drift",
    "foreign_owner",
    "fragment_url",
    "integrity_mismatch",
    "invalid_etag",
    "invalid_utf8",
    "lease_mismatch",
    "length_overflow",
    "mutable_ref",
    "non_https",
    "noncanonical_bytes",
    "partial_identity_tampering",
    "percent_traversal",
    "query_url",
    "range_drift",
    "retry_skip",
    "source_drift",
    "state_jump",
    "traversal",
    "unc_path",
    "unknown_field",
    "unsafe_integer",
    "url_credentials"
  ].sort();
  assert.deepEqual(covered, [...HOSTILE_CLASS_NAMES].sort());
  assert.equal(FIXTURE_LEASE_ID.length, 32);
});

test("production source is pure/offline and imports no filesystem, network, process, or child API", () => {
  const sourceUrls = [
    new URL("../src/canonical-json.mjs", import.meta.url),
    new URL("../src/errors.mjs", import.meta.url),
    new URL("../src/index.mjs", import.meta.url)
  ];
  const allowedImports = new Set(["node:crypto", "./canonical-json.mjs", "./errors.mjs"]);
  for (const sourceUrl of sourceUrls) {
    const source = readFileSync(sourceUrl, "utf8");
    const imports = [...source.matchAll(/from\s+"([^"]+)"/gu)].map((match) => match[1]);
    for (const specifier of imports) assert.equal(allowedImports.has(specifier), true, specifier);
    for (const forbidden of [
      /\bfetch\s*\(/u,
      /node:(?:fs|http|https|net|tls|child_process)/u,
      /\b(?:spawn|spawnSync|execFile|execFileSync|execSync)\s*\(/u,
      /\.(?:request|connect|unlink|rm|writeFile|open)\s*\(/u,
      /\/prompt/u
    ]) {
      assert.doesNotMatch(source, forbidden);
    }
  }
});
