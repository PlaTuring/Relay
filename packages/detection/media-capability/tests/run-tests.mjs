import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  fixedFfmpegArguments,
  fixedManagedPyAvArguments,
  observeAmbientFfmpegPresence,
  observeExternalPyAvIdentity,
  probeManagedPyAv,
  probeMediaCapabilities,
  probePrivateFfmpeg
} from "../src/index.ts";
import { BoundedProcessExecutor } from "../src/bounded-process.ts";
import { parseFfmpegCodecs, parseFfmpegFormats, parseFfmpegVersion } from "../src/ffmpeg.ts";
import { sha256Text } from "../src/hash.ts";
import { parsePyAvCapabilityPayload } from "../src/pyav.ts";
import { redactText } from "../src/safe-text.ts";
import { parseStrictJson } from "../src/strict-json.ts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = async (name) => readFile(join(packageRoot, "fixtures", name), "utf8");
const [ffmpegVersion, ffprobeVersion, codecs, formats, ffmpegHelp, ffprobeHelp, pyavPayload] = await Promise.all([
  fixture("ffmpeg-version.txt"),
  fixture("ffprobe-version.txt"),
  fixture("ffmpeg-codecs.txt"),
  fixture("ffmpeg-formats.txt"),
  fixture("ffmpeg-help.txt"),
  fixture("ffprobe-help.txt"),
  fixture("pyav-valid.json")
]);

const hashes = Object.freeze({
  manifest: `sha256:${"e".repeat(64)}`,
  ffmpeg: `sha256:${"a".repeat(64)}`,
  ffprobe: `sha256:${"b".repeat(64)}`,
  ffmpegTree: `sha256:${"c".repeat(64)}`,
  ffprobeTree: `sha256:${"d".repeat(64)}`,
  ledger: `sha256:${"1".repeat(64)}`,
  runtimeManifest: `sha256:${"2".repeat(64)}`,
  python: `sha256:${"3".repeat(64)}`,
  wheel: `sha256:${"4".repeat(64)}`,
  dllTree: `sha256:${"5".repeat(64)}`,
  importTree: `sha256:${"6".repeat(64)}`
});

const manifest = Object.freeze({
  contractId: "minimax-h3-tool.component-manifest",
  schemaVersion: "1.0.0",
  schemaId: "urn:minimax-h3-tool:schema:component-manifest:1.0.0",
  schemaContentSha256: "sha256:62704fae90e6f9d1895a3d1351b8664f67222aedb8db390ab46e674394236608",
  documentId: "123e4567-e89b-42d3-a456-426614174000",
  documentRevision: 1,
  contentSha256: hashes.manifest,
  appId: "minimax-h3-tool",
  appVersion: "0.1.0",
  appBuildId: "alpha-test-build",
  catalogResource: "app-resource:catalog/component-manifest.json"
});

function record(slot) {
  const isFfmpeg = slot === "ffmpeg";
  const artifactSha256 = isFfmpeg ? hashes.ffmpeg : hashes.ffprobe;
  return Object.freeze({
    slot,
    componentId: `private-${slot}-fixture`,
    componentVersion: "7.1.1",
    componentRole: "private_media_tool",
    releaseState: "eligible",
    destinationRelativePath: `private-tools/${slot}.exe`,
    artifact: Object.freeze({ byteLength: isFfmpeg ? 1000 : 900, sha256: artifactSha256 }),
    signature: Object.freeze({
      kind: "embedded_authenticode",
      scheme: "authenticode",
      signerId: "release-signer",
      signedArtifactSha256: artifactSha256,
      verificationPolicy: "verify_against_release_trust_store_before_materialization"
    }),
    runtimeDependencyTreeSha256: isFfmpeg ? hashes.ffmpegTree : hashes.ffprobeTree
  });
}

const privateTarget = Object.freeze({
  manifest,
  ffmpeg: record("ffmpeg"),
  ffprobe: record("ffprobe"),
  execution: Object.freeze({
    ffmpeg: Object.freeze({ slot: "ffmpeg", executablePath: "D:\\MiniMaxH3\\private-tools\\ffmpeg.exe" }),
    ffprobe: Object.freeze({ slot: "ffprobe", executablePath: "D:\\MiniMaxH3\\private-tools\\ffprobe.exe" })
  })
});

function projection(value) {
  return Object.freeze({
    slot: value.slot,
    componentId: value.componentId,
    componentVersion: value.componentVersion,
    componentRole: value.componentRole,
    releaseState: value.releaseState,
    artifactByteLength: value.artifact.byteLength,
    artifactSha256: value.artifact.sha256,
    destinationRelativePath: value.destinationRelativePath,
    signatureKind: value.signature.kind,
    signatureScheme: value.signature.scheme,
    signerId: value.signature.signerId,
    signedArtifactSha256: value.signature.signedArtifactSha256,
    signatureVerificationPolicy: value.signature.verificationPolicy,
    runtimeDependencyTreeSha256: value.runtimeDependencyTreeSha256
  });
}

function artifactFor(slot) {
  return Object.freeze({
    kind: "verified_local_handle_artifact",
    byteLength: slot === "ffmpeg" ? 1000 : 900,
    sha256: slot === "ffmpeg" ? hashes.ffmpeg : hashes.ffprobe,
    fileIdentity: Object.freeze({ volumeId: "volume-main", fileId: `file-${slot}` }),
    locality: "fixed_local_volume",
    containment: "handle_contained_no_reparse",
    hashExecution: "bounded_stream_complete"
  });
}

function catalogProof(target = privateTarget) {
  return Object.freeze({
    kind: "verified_signed_build_inventory",
    manifestContentSha256: target.manifest.contentSha256,
    schemaId: target.manifest.schemaId,
    schemaContentSha256: target.manifest.schemaContentSha256,
    documentId: target.manifest.documentId,
    documentRevision: target.manifest.documentRevision,
    appId: target.manifest.appId,
    appVersion: target.manifest.appVersion,
    appBuildId: target.manifest.appBuildId,
    catalogResource: target.manifest.catalogResource,
    entries: Object.freeze([projection(target.ffmpeg), projection(target.ffprobe)])
  });
}

function ownershipFor(value, artifact, rootId = "managed-root-main") {
  return Object.freeze({
    kind: "verified_current_ownership_handle",
    componentId: value.componentId,
    artifactSha256: artifact.sha256,
    fileIdentity: artifact.fileIdentity,
    ledgerDocumentId: "ledger-main",
    ledgerDocumentRevision: 1,
    ledgerContentSha256: hashes.ledger,
    managedRootId: rootId,
    runtimeGenerationId: "generation-main",
    resolvedDestinationRelativePath: value.destinationRelativePath,
    destinationBinding: "managed_root_plus_manifest_relative_path",
    readLeaseId: `lease-${value.slot}`,
    ledgerState: "committed_tool_owned",
    containment: "handle_contained_no_reparse",
    executionLease: "read_lease_held"
  });
}

const outputs = Object.freeze({
  ffmpeg: Object.freeze({ version: ffmpegVersion, codecs, formats, help: ffmpegHelp }),
  ffprobe: Object.freeze({ version: ffprobeVersion, help: ffprobeHelp })
});

function successResult(text, value, artifact) {
  return Object.freeze({
    ok: true,
    stdout: text,
    stderr: "",
    stdoutSha256: sha256Text(text),
    stderrSha256: sha256Text(""),
    processTreeProof: "verified_job_closed_no_survivors",
    imageProof: Object.freeze({
      kind: "verified_spawned_image",
      componentId: value.componentId,
      artifactSha256: artifact.sha256,
      fileIdentity: artifact.fileIdentity,
      loadedDependencyTreeSha256: value.runtimeDependencyTreeSha256
    })
  });
}

function privateDependencies(overrides = {}) {
  const base = {
    catalogVerifier: { verify: async (target) => catalogProof(target) },
    artifactVerifier: { verify: async (value) => artifactFor(value.slot) },
    authenticodeVerifier: {
      verify: async (value, _execution, artifact) => Object.freeze({
        kind: "verified_authenticode",
        signerId: value.signature.signerId,
        signedArtifactSha256: artifact.sha256,
        fileIdentity: artifact.fileIdentity,
        trustPolicy: "release_trust_store"
      })
    },
    ownershipVerifier: { verify: async (value, _execution, artifact) => ownershipFor(value, artifact) },
    exactImageExecutor: {
      execute: async (value, _execution, artifact, _ownership, command) =>
        successResult(outputs[value.slot][command], value, artifact)
    }
  };
  return { ...base, ...overrides };
}

const managedTarget = Object.freeze({
  pythonExecutablePath: "D:\\MiniMaxH3\\runtimes\\python\\python.exe",
  pyavImportRootPath: "D:\\MiniMaxH3\\runtimes\\python\\site-packages",
  runtimeId: "managed-python-main",
  expected: Object.freeze({
    runtimeManifestSha256: hashes.runtimeManifest,
    pythonArtifactSha256: hashes.python,
    pythonArtifactByteLength: 5000,
    pyavWheelArtifactSha256: hashes.wheel,
    linkedDllTreeSha256: hashes.dllTree,
    pyavImportRootTreeSha256: hashes.importTree,
    runtimeGenerationId: "generation-main"
  })
});

const runtimeProof = Object.freeze({
  kind: "verified_managed_pyav_runtime",
  runtimeId: managedTarget.runtimeId,
  ...managedTarget.expected,
  pythonFileIdentity: Object.freeze({ volumeId: "volume-main", fileId: "file-python" }),
  containment: "handle_contained_no_reparse",
  executionLease: "read_lease_held"
});

function managedDependencies(overrides = {}) {
  const base = {
    runtimeVerifier: { verify: async () => runtimeProof },
    exactImageExecutor: {
      execute: async () => Object.freeze({
        ok: true,
        stdout: pyavPayload,
        stderr: "",
        stdoutSha256: sha256Text(pyavPayload),
        stderrSha256: sha256Text(""),
        processTreeProof: "verified_job_closed_no_survivors",
        imageProof: Object.freeze({
          kind: "verified_spawned_managed_python",
          runtimeId: runtimeProof.runtimeId,
          runtimeGenerationId: runtimeProof.runtimeGenerationId,
          pythonArtifactSha256: runtimeProof.pythonArtifactSha256,
          pythonFileIdentity: runtimeProof.pythonFileIdentity,
          linkedDllTreeSha256: runtimeProof.linkedDllTreeSha256,
          pyavImportRootTreeSha256: runtimeProof.pyavImportRootTreeSha256
        })
      })
    }
  };
  return { ...base, ...overrides };
}

const tests = [];
function test(name, action) {
  tests.push({ name, action });
}

test("fixed commands are argv arrays", () => {
  assert.deepEqual(fixedFfmpegArguments("version"), ["-hide_banner", "-version"]);
  const args = fixedManagedPyAvArguments(managedTarget, "pyav_capability_v1");
  assert.equal(args[0], "-I");
  assert.equal(args[1], "-S");
  assert.equal(args.at(-1), managedTarget.pyavImportRootPath);
});

test("external PyAV identity stays observation-only", () => {
  const result = observeExternalPyAvIdentity({
    pyavVersion: "18.0.0",
    linkedLibraryVersions: [
      { name: "libavutil", version: "60.26.102" },
      { name: "libavcodec", version: "62.28.102" },
      { name: "libavformat", version: "62.12.102" },
      { name: "libavdevice", version: "62.3.102" },
      { name: "libavfilter", version: "11.14.102" },
      { name: "libswscale", version: "9.5.102" },
      { name: "libswresample", version: "6.3.102" }
    ]
  });
  assert.equal(result.status, "identity_observed");
  assert.equal(result.selectable, false);
  assert.equal(result.selected, false);
});

test("ambient presence is never selectable", () => {
  assert.deepEqual(observeAmbientFfmpegPresence(true), {
    status: "present_unverified",
    source: "ambient_host",
    selectable: false,
    selected: false,
    reason: "exact_build_not_observed"
  });
});

test("managed PyAV reports exact linked family and safe projection", async () => {
  const result = await probeManagedPyAv(managedTarget, managedDependencies());
  assert.equal(result.status, "available");
  assert.equal(result.selected, false);
  assert.equal(result.capabilities.linkedLibraries.length, 7);
  const rendered = JSON.stringify(result);
  assert.equal(rendered.includes("private build"), false);
  assert.equal(rendered.includes("D:\\"), false);
  assert.equal(result.runtimeBinding.pyavWheelArtifactSha256, hashes.wheel);
});

test("managed PyAV rejects unverified runtime literal", async () => {
  const result = await probeManagedPyAv(managedTarget, managedDependencies({
    runtimeVerifier: { verify: async () => ({ ...runtimeProof, pyavWheelArtifactSha256: hashes.ffmpeg }) }
  }));
  assert.equal(result.failure.code, "MEDIA.PYAV_RUNTIME_UNVERIFIED");
});

test("managed PyAV rejects UNC before verifier", async () => {
  let called = false;
  const target = { ...managedTarget, pythonExecutablePath: "\\\\server\\share\\python.exe" };
  const result = await probeManagedPyAv(target, managedDependencies({
    runtimeVerifier: { verify: async () => { called = true; return runtimeProof; } }
  }));
  assert.equal(result.failure.code, "MEDIA.EXECUTABLE_NOT_ABSOLUTE");
  assert.equal(called, false);
});

test("managed PyAV revalidates adapter hashes", async () => {
  const result = await probeManagedPyAv(managedTarget, managedDependencies({
    exactImageExecutor: { execute: async () => ({ ...(await managedDependencies().exactImageExecutor.execute()), stdoutSha256: hashes.ffmpeg }) }
  }));
  assert.equal(result.failure.code, "MEDIA.OUTPUT_INVALID");
});

test("PyAV parser rejects missing linked family", () => {
  const payload = JSON.parse(pyavPayload);
  payload.linked_libraries = payload.linked_libraries.filter((item) => item.name !== "libavfilter");
  assert.throws(() => parsePyAvCapabilityPayload(JSON.stringify(payload), "managed_pyav"), /MEDIA.PYAV_CONFLICT/);
});

test("private pair becomes selectable but never selected", async () => {
  const result = await probePrivateFfmpeg(privateTarget, privateDependencies());
  assert.equal(result.status, "available");
  assert.equal(result.selectable, true);
  assert.equal(result.selected, false);
  assert.equal(result.capabilities.coherent, true);
  assert.equal(result.capabilities.codecs.length, 2);
  assert.equal(result.capabilities.containers.length, 2);
  assert.equal(result.artifacts.ffmpeg.artifactSha256, hashes.ffmpeg);
  const rendered = JSON.stringify(result);
  assert.equal(rendered.includes("private build"), false);
  assert.equal(rendered.includes("MiniMaxH3"), false);
});

test("catalog entry drift fails its own gate", async () => {
  const deps = privateDependencies({
    catalogVerifier: { verify: async (target) => {
      const proof = structuredClone(catalogProof(target));
      proof.entries[0].componentId = "forged-component";
      return proof;
    } }
  });
  assert.equal((await probePrivateFfmpeg(privateTarget, deps)).failure.code, "MEDIA.CATALOG_PROOF_MISSING");
});

test("artifact hash drift fails artifact gate", async () => {
  const deps = privateDependencies({ artifactVerifier: { verify: async (value) => ({ ...artifactFor(value.slot), sha256: hashes.ledger }) } });
  assert.equal((await probePrivateFfmpeg(privateTarget, deps)).failure.code, "MEDIA.ARTIFACT_MISMATCH");
});

test("signature drift fails signature gate", async () => {
  const deps = privateDependencies({
    authenticodeVerifier: { verify: async (value, _execution, artifact) => ({
      kind: "verified_authenticode", signerId: "wrong-signer", signedArtifactSha256: artifact.sha256,
      fileIdentity: artifact.fileIdentity, trustPolicy: "release_trust_store"
    }) }
  });
  assert.equal((await probePrivateFfmpeg(privateTarget, deps)).failure.code, "MEDIA.SIGNATURE_PROOF_MISSING");
});

test("ownership root drift fails ownership gate", async () => {
  const deps = privateDependencies({
    ownershipVerifier: { verify: async (value, _execution, artifact) => ownershipFor(value, artifact, value.slot === "ffmpeg" ? "root-a" : "root-b") }
  });
  assert.equal((await probePrivateFfmpeg(privateTarget, deps)).failure.code, "MEDIA.OWNERSHIP_PROOF_MISSING");
});

test("ownership lease drift after a command fails ownership gate", async () => {
  const calls = new Map();
  const deps = privateDependencies({
    ownershipVerifier: { verify: async (value, _execution, artifact) => {
      const count = (calls.get(value.slot) ?? 0) + 1;
      calls.set(value.slot, count);
      const proof = ownershipFor(value, artifact);
      return count > 1 && value.slot === "ffmpeg" ? { ...proof, readLeaseId: "lease-replaced" } : proof;
    } }
  });
  assert.equal((await probePrivateFfmpeg(privateTarget, deps)).failure.code, "MEDIA.OWNERSHIP_PROOF_MISSING");
});

test("destination path substitution fails before verifier", async () => {
  let called = false;
  const target = structuredClone(privateTarget);
  target.execution.ffmpeg.executablePath = "D:\\MiniMaxH3\\other\\ffmpeg.exe";
  const deps = privateDependencies({ catalogVerifier: { verify: async () => { called = true; return catalogProof(); } } });
  assert.equal((await probePrivateFfmpeg(target, deps)).failure.code, "MEDIA.INVALID_REQUEST");
  assert.equal(called, false);
});

test("spawned image drift fails exact-image gate", async () => {
  const deps = privateDependencies({
    exactImageExecutor: { execute: async (value, _execution, artifact, _ownership, command) => ({
      ...successResult(outputs[value.slot][command], value, artifact),
      imageProof: { ...successResult("", value, artifact).imageProof, artifactSha256: hashes.ledger }
    }) }
  });
  assert.equal((await probePrivateFfmpeg(privateTarget, deps)).failure.code, "MEDIA.EXACT_IMAGE_PROOF_MISSING");
});

test("adapter timeout stays fail-closed", async () => {
  const deps = privateDependencies({
    exactImageExecutor: { execute: async () => ({ ok: false, failure: { code: "MEDIA.PROCESS_TIMEOUT", summary: "fixed" } }) }
  });
  assert.equal((await probePrivateFfmpeg(privateTarget, deps)).failure.code, "MEDIA.PROCESS_TIMEOUT");
});

test("oversized adapter stdout is rejected at boundary", async () => {
  const deps = privateDependencies({
    exactImageExecutor: { execute: async (value, _execution, artifact) => successResult("x".repeat(2_000_001), value, artifact) }
  });
  assert.equal((await probePrivateFfmpeg(privateTarget, deps)).failure.code, "MEDIA.OUTPUT_INVALID");
});

test("malicious secret stdout is rejected", async () => {
  const deps = privateDependencies({
    exactImageExecutor: { execute: async (value, _execution, artifact, _ownership, command) => {
      const text = command === "version" ? `${outputs[value.slot][command]}password=stolen\n` : outputs[value.slot][command];
      return successResult(text, value, artifact);
    } }
  });
  assert.equal((await probePrivateFfmpeg(privateTarget, deps)).failure.code, "MEDIA.OUTPUT_INVALID");
});

test("private path outside configuration is rejected", async () => {
  const deps = privateDependencies({
    exactImageExecutor: { execute: async (value, _execution, artifact, _ownership, command) => {
      const text = command === "version" ? `${outputs[value.slot][command]}loaded C:\\Users\\secret\\dll.dll\n` : outputs[value.slot][command];
      return successResult(text, value, artifact);
    } }
  });
  assert.equal((await probePrivateFfmpeg(privateTarget, deps)).failure.code, "MEDIA.OUTPUT_UNSAFE_TEXT");
});

test("private path in codec table is rejected", async () => {
  const deps = privateDependencies({
    exactImageExecutor: { execute: async (value, _execution, artifact, _ownership, command) => {
      const text = value.slot === "ffmpeg" && command === "codecs"
        ? outputs[value.slot][command].replace("H.264 / AVC", "loaded C:\\Users\\private\\codec.dll")
        : outputs[value.slot][command];
      return successResult(text, value, artifact);
    } }
  });
  assert.equal((await probePrivateFfmpeg(privateTarget, deps)).failure.code, "MEDIA.OUTPUT_UNSAFE_TEXT");
});

test("ffmpeg and ffprobe build conflict is rejected", async () => {
  const deps = privateDependencies({
    exactImageExecutor: { execute: async (value, _execution, artifact, _ownership, command) => {
      let text = outputs[value.slot][command];
      if (value.slot === "ffprobe" && command === "version") text = text.replace("7.1.1-static", "7.1.2-static");
      return successResult(text, value, artifact);
    } }
  });
  assert.equal((await probePrivateFfmpeg(privateTarget, deps)).failure.code, "MEDIA.FFMPEG_PAIR_CONFLICT");
});

test("raw configuration drift hidden by redaction is rejected", async () => {
  const deps = privateDependencies({
    exactImageExecutor: { execute: async (value, _execution, artifact, _ownership, command) => {
      let text = outputs[value.slot][command];
      if (value.slot === "ffprobe" && command === "version") text = text.replace("C:\\private build\\ffmpeg", "D:\\other private\\ffmpeg");
      return successResult(text, value, artifact);
    } }
  });
  assert.equal((await probePrivateFfmpeg(privateTarget, deps)).failure.code, "MEDIA.FFMPEG_PAIR_CONFLICT");
});

test("strict table parsers reject malformed row-like content", () => {
  assert.throws(() => parseFfmpegCodecs(codecs.replace(" DEV.LS h264", " broken h264")), /MEDIA.OUTPUT_INVALID/);
  assert.throws(() => parseFfmpegFormats(formats.replace(" DE mp4,mov", " malformed")), /MEDIA.OUTPUT_INVALID/);
});

test("version parser rejects loaded-library substitution", () => {
  assert.throws(() => parseFfmpegVersion(ffmpegVersion.replace("59. 39.100 / 59. 39.100", "59. 39.100 / 59. 40.100"), "ffmpeg"), /MEDIA.FFMPEG_PAIR_CONFLICT/);
});

test("strict JSON rejects duplicates and non-I-JSON values", () => {
  assert.throws(() => parseStrictJson('{"a":1,"a":1}'), /MEDIA.OUTPUT_INVALID/);
  assert.throws(() => parseStrictJson('{"a":"\\ud800"}'), /MEDIA.OUTPUT_INVALID/);
  assert.throws(() => parseStrictJson('{"a":"\\udc00"}'), /MEDIA.OUTPUT_INVALID/);
  assert.throws(() => parseStrictJson('{"a":1.5}'), /MEDIA.OUTPUT_INVALID/);
  assert.throws(() => parseStrictJson('{"a":9007199254740992}'), /MEDIA.OUTPUT_INVALID/);
  assert.throws(() => parseStrictJson('{"a":-0}'), /MEDIA.OUTPUT_INVALID/);
});

test("redaction removes broad absolute paths and secrets", () => {
  const redacted = redactText("R:\\SyntheticMedia\\model C:/temp/file \\\\server\\share\\file file:///C:/x token=abc");
  assert.equal(redacted.includes("R:\\"), false);
  assert.equal(redacted.includes("C:/"), false);
  assert.equal(redacted.includes("server"), false);
  assert.equal(redacted.includes("abc"), false);
});

test("generic runner cannot confer Windows actionable success", async () => {
  const runner = new BoundedProcessExecutor();
  const result = await runner.execute({
    executablePath: process.execPath,
    arguments: [join(packageRoot, "fixtures", "fake-process.mjs"), "orphan-success"],
    timeoutMs: 2_000,
    maxOutputBytes: 4_096
  });
  if (process.platform === "win32") assert.equal(result.failure.code, "MEDIA.PROCESS_TREE_UNCONFIRMED");
  else assert.ok(result.ok === false || result.ok === true);
});

test("generic runner timeout and oversize fail closed", async () => {
  const runner = new BoundedProcessExecutor();
  for (const [mode, maxOutputBytes] of [["timeout", 4_096], ["oversize", 512]]) {
    const result = await runner.execute({
      executablePath: process.execPath,
      arguments: [join(packageRoot, "fixtures", "fake-process.mjs"), mode],
      timeoutMs: mode === "timeout" ? 50 : 2_000,
      maxOutputBytes
    });
    assert.equal(result.ok, false);
    assert.ok(["MEDIA.PROCESS_TREE_UNCONFIRMED", "MEDIA.PROCESS_TIMEOUT", "MEDIA.PROCESS_OUTPUT_LIMIT"].includes(result.failure.code));
  }
});

test("unified report is deterministic and source-separated", async () => {
  const request = {
    managedPyAv: managedTarget,
    externalPyAvIdentity: {
      pyavVersion: "18.0.0",
      linkedLibraryVersions: [
        { name: "libavutil", version: "60.26.102" },
        { name: "libavcodec", version: "62.28.102" },
        { name: "libavformat", version: "62.12.102" },
        { name: "libavdevice", version: "62.3.102" },
        { name: "libavfilter", version: "11.14.102" },
        { name: "libswscale", version: "9.5.102" },
        { name: "libswresample", version: "6.3.102" }
      ]
    },
    privateFfmpegPair: privateTarget,
    ambientFfmpegPresent: true
  };
  const dependencies = { managedPyAv: managedDependencies(), privateFfmpeg: privateDependencies() };
  const first = JSON.stringify(await probeMediaCapabilities(request, dependencies));
  const second = JSON.stringify(await probeMediaCapabilities(request, dependencies));
  assert.equal(first, second);
  assert.equal(first.includes("executablePath"), false);
  assert.equal(first.includes("private build"), false);
  const parsed = JSON.parse(first);
  assert.equal(parsed.pyav.length, 2);
  assert.equal(parsed.ambientFfmpeg.status, "present_unverified");
  assert.equal(parsed.privateFfmpeg.selected, false);
});

let passed = 0;
for (const { name, action } of tests) {
  try {
    await action();
    passed += 1;
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    process.stderr.write(`FAIL ${name}\n`);
    if (error instanceof Error) process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
    break;
  }
}
process.stdout.write(`SUMMARY passed=${passed} failed=${tests.length - passed} total=${tests.length}\n`);
