import test from "node:test";
import assert from "node:assert/strict";
import { computeDescriptorFingerprints, lintStaticGraph } from "../src/index.mjs";
import { documents, positiveApiGraph, resign } from "./fixture-factory.mjs";

function lint(changes) {
  const fixture = documents();
  changes?.(fixture);
  return lintStaticGraph({ kind: "api", graph: positiveApiGraph(), ...fixture });
}

function onlyCode(result) {
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics.length, 1, JSON.stringify(result.diagnostics));
  return result.diagnostics[0].code;
}

test("valid immutable authority and descriptor sidecar bind statically, never at runtime", () => {
  const result = lint();
  assert.equal(result.ok, true);
  assert.equal(result.authority_binding, "static_authority_binding");
  assert.equal(result.runtime_certified, false);
});

test("authority envelope, identity, disposition, and integrity fail closed", () => {
  assert.equal(onlyCode(lint(({ allowlist }) => { allowlist.extra = true; resign(allowlist); })), "AUTHORITY.ENVELOPE_INVALID");
  assert.equal(onlyCode(lint(({ allowlist }) => { allowlist.document_revision = 2; resign(allowlist); })), "AUTHORITY.IDENTITY_INVALID");
  assert.equal(onlyCode(lint(({ allowlist }) => { allowlist.disposition = { kind: "revoked" }; resign(allowlist); })), "AUTHORITY.NOT_ACTIVE");
  assert.equal(onlyCode(lint(({ allowlist }) => { allowlist.integrity.content_sha256 = `sha256:${"0".repeat(64)}`; })), "AUTHORITY.INTEGRITY_MISMATCH");
});

test("authority duplicate classes, evidence references, local/API flags, and forbidden seed fail closed", () => {
  assert.equal(onlyCode(lint(({ allowlist }) => {
    allowlist.entries.push(structuredClone(allowlist.entries[0]));
    resign(allowlist);
  })), "AUTHORITY.DUPLICATE_CLASS_TYPE");
  assert.equal(onlyCode(lint(({ allowlist }) => {
    allowlist.entries[0].origin.evidence_source_ids = ["missing-evidence"];
    resign(allowlist);
  })), "AUTHORITY.ENTRY_IDENTITY_INVALID");
  assert.equal(onlyCode(lint(({ allowlist }) => {
    allowlist.entries[0].flags.local_only = false;
    resign(allowlist);
  })), "AUTHORITY.ENTRY_IDENTITY_INVALID");
  assert.equal(onlyCode(lint(({ allowlist }) => {
    allowlist.forbidden_identities.pop();
    resign(allowlist);
  })), "AUTHORITY.FORBIDDEN_SEED_INVALID");
});

test("descriptor authority tuple and root integrity fail closed", () => {
  assert.equal(onlyCode(lint(({ descriptors }) => {
    descriptors.authority_ref.document_revision = 2;
    resign(descriptors);
  })), "DESCRIPTOR.AUTHORITY_REF_MISMATCH");
  assert.equal(onlyCode(lint(({ descriptors }) => {
    descriptors.integrity.content_sha256 = `sha256:${"f".repeat(64)}`;
  })), "DESCRIPTOR.INTEGRITY_MISMATCH");
});

for (const field of ["input_schema_sha256", "output_schema_sha256", "combined_schema_sha256"]) {
  test(`descriptor ${field} drift is rejected`, () => {
    const result = lint(({ descriptors }) => {
      descriptors.descriptors[0].schema_fingerprints[field] = `sha256:${"0".repeat(64)}`;
      resign(descriptors);
    });
    assert.equal(onlyCode(result), "DESCRIPTOR.FINGERPRINT_MISMATCH");
  });
}

for (const [field, value] of [
  ["origin_uri", "https://example.invalid/local"],
  ["locked_revision", "0".repeat(40)],
  ["source_path", "comfy_extras/other.py"],
  ["git_blob_sha", "1".repeat(40)],
]) {
  test(`descriptor origin ${field} drift is rejected`, () => {
    const result = lint(({ descriptors }) => {
      descriptors.descriptors[0].origin[field] = value;
      resign(descriptors);
    });
    assert.equal(onlyCode(result), "DESCRIPTOR.ORIGIN_MISMATCH");
  });
}

test("descriptor schema, flags, evidence, and active disposition drift fail closed", () => {
  assert.equal(onlyCode(lint(({ descriptors }) => {
    descriptors.descriptors[0].required_inputs[0].default = 999;
    resign(descriptors);
  })), "DESCRIPTOR.FINGERPRINT_MISMATCH");
  assert.equal(onlyCode(lint(({ descriptors }) => {
    descriptors.descriptors[0].flags.is_api_node = true;
    resign(descriptors);
  })), "DESCRIPTOR.FINGERPRINT_MISMATCH");
  assert.equal(onlyCode(lint(({ descriptors }) => {
    descriptors.descriptors[0].evidence_status = "inferred";
    resign(descriptors);
  })), "DESCRIPTOR.DISPOSITION_MISMATCH");
  assert.equal(onlyCode(lint(({ descriptors }) => {
    descriptors.descriptors[0].disposition = { kind: "revoked" };
    resign(descriptors);
  })), "DESCRIPTOR.DISPOSITION_MISMATCH");
});

test("descriptor set omission and duplicate remain unauthorized", () => {
  assert.equal(onlyCode(lint(({ descriptors }) => {
    descriptors.descriptors.pop();
    resign(descriptors);
  })), "DESCRIPTOR.SET_MISMATCH");
  assert.equal(onlyCode(lint(({ descriptors }) => {
    descriptors.descriptors[1] = structuredClone(descriptors.descriptors[0]);
    resign(descriptors);
  })), "DESCRIPTOR.DUPLICATE_CLASS_TYPE");
});

test("a fabricated self-consistent allowlist and descriptor cannot replace the compiled trust anchor", () => {
  const result = lint(({ allowlist, descriptors }) => {
    const fabricated = descriptors.descriptors[0];
    fabricated.required_inputs = [];
    fabricated.schema_fingerprints = structuredClone(computeDescriptorFingerprints(fabricated));
    allowlist.entries[0].schema_fingerprints = structuredClone(fabricated.schema_fingerprints);
    resign(allowlist);
    descriptors.authority_ref.content_sha256 = allowlist.integrity.content_sha256;
    resign(descriptors);
  });
  assert.equal(onlyCode(result), "AUTHORITY.ENTRY_TUPLE_ANCHOR_MISMATCH");
});
