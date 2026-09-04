import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { nativeEvidenceRoot, projectRoot, sha256File } from "./lib.mjs";

const repositoryRoot = resolve(projectRoot, "..", "..");
const evidenceRoot = nativeEvidenceRoot;
let profilePath = resolve(repositoryRoot, "native", "relay-winbroker", "capability-profile.v1.json");
let binaryPath = resolve(repositoryRoot, "native", "relay-winbroker", "bin", "relay-winbroker.exe");
let evidenceFile = "native-runtime-probe.json";
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === "--binary" && typeof process.argv[index + 1] === "string") {
    binaryPath = resolve(process.argv[++index]);
  } else if (argument === "--profile" && typeof process.argv[index + 1] === "string") {
    profilePath = resolve(process.argv[++index]);
  } else if (argument === "--evidence-file" && /^[a-z0-9.-]+\.json$/u.test(process.argv[index + 1] ?? "")) {
    evidenceFile = process.argv[++index];
  } else {
    throw new Error("NATIVE_VERIFY.INVALID_ARGUMENT");
  }
}

function canonicalize(value) {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const keys = Object.keys(value).sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

function frame(kind, opcode, sequence, payload, rawPayload = null) {
  const bytes = Buffer.from(rawPayload ?? canonicalize(payload), "utf8");
  const header = Buffer.alloc(32);
  header.write("MH3W", 0, 4, "ascii");
  header.writeUInt16LE(32, 4);
  header.writeUInt16LE(1, 6);
  header.writeUInt32LE(bytes.length, 8);
  header.writeUInt16LE(kind, 12);
  header.writeUInt16LE(opcode, 14);
  header.writeUInt32LE(0, 16);
  header.writeBigUInt64LE(BigInt(sequence), 20);
  header.writeUInt32LE(0, 28);
  return Buffer.concat([header, bytes]);
}

function parseResponses(bytes) {
  const responses = [];
  let offset = 0;
  while (offset < bytes.length) {
    if (bytes.length - offset < 32) throw new Error("NATIVE_VERIFY.TRUNCATED_RESPONSE_HEADER");
    if (bytes.toString("ascii", offset, offset + 4) !== "MH3W") throw new Error("NATIVE_VERIFY.BAD_RESPONSE_MAGIC");
    const length = bytes.readUInt32LE(offset + 8);
    const kind = bytes.readUInt16LE(offset + 12);
    const opcode = bytes.readUInt16LE(offset + 14);
    const sequence = Number(bytes.readBigUInt64LE(offset + 20));
    if (bytes.length - offset - 32 < length) throw new Error("NATIVE_VERIFY.BAD_RESPONSE_FRAME");
    const text = bytes.toString("utf8", offset + 32, offset + 32 + length);
    const payload = JSON.parse(text);
    if (text !== canonicalize(payload)) throw new Error("NATIVE_VERIFY.NON_CANONICAL_RESPONSE");
    responses.push({ kind, opcode, sequence, payload });
    offset += 32 + length;
  }
  return responses;
}

const profile = JSON.parse(await readFile(profilePath, "utf8"));
if (
  profile.profile_id !== "relay.win32.path-inspection" ||
  profile.profile_version !== "1.0.0" ||
  canonicalize(profile.enabled_operations.map(({ opcode }) => opcode)) !== "[257,258]" ||
  canonicalize(profile.reserved_not_enabled_opcodes) !== "[259,513,514,769,770,771]"
) {
  throw new Error("NATIVE_VERIFY.CAPABILITY_PROFILE_INVALID");
}

await mkdir(evidenceRoot, { recursive: true });
const junctionPath = resolve(evidenceRoot, "probe-reparse-junction");
await rm(junctionPath, { recursive: true, force: true });
await symlink(dirname(binaryPath), junctionPath, "junction");

const helloPayload = {
  message_kind: "client_hello",
  profile_id: profile.profile_id,
  profile_version: profile.profile_version
};
const frames = [frame(1, 0, 0, helloPayload)];
let sequence = 1;
frames.push(frame(3, 0x0101, sequence++, {
  candidate_kind: "runtime_app_data",
  candidate_path: projectRoot,
  require_fixed_local: true,
  required_filesystem: "ntfs"
}));
frames.push(frame(3, 0x0102, sequence++, {
  candidate_path: binaryPath,
  mutation_policy: "read_only",
  purpose: "native_helper_selfcheck"
}));
for (const opcode of profile.reserved_not_enabled_opcodes) frames.push(frame(3, opcode, sequence++, {}));
frames.push(frame(3, 0x7fff, sequence++, {}));
frames.push(frame(3, 0x0102, sequence++, {
  candidate_path: binaryPath.replaceAll("\\", "/"),
  mutation_policy: "read_only",
  purpose: "native_helper_selfcheck"
}));
frames.push(frame(3, 0x0102, sequence++, {
  candidate_path: junctionPath,
  mutation_policy: "read_only",
  purpose: "reparse_rejection_probe"
}));
frames.push(frame(7, 0, sequence++, {
  message_kind: "close",
  profile_id: profile.profile_id,
  profile_version: profile.profile_version
}));

const probe = spawnSync(binaryPath, ["--capability-profile=path-inspection-v1"], {
  cwd: projectRoot,
  input: Buffer.concat(frames),
  encoding: null,
  maxBuffer: 4 * 1024 * 1024,
  shell: false,
  windowsHide: true,
  timeout: 15_000
});
if (probe.status !== 0) throw new Error(`NATIVE_VERIFY.PROBE_FAILED:${probe.status}`);
const responses = parseResponses(probe.stdout);
if (responses.length !== sequence - 1) throw new Error("NATIVE_VERIFY.RESPONSE_COUNT");
if (
  responses[0].kind !== 2 || responses[0].opcode !== 0 || responses[0].sequence !== 0 ||
  responses[0].payload.status !== "ready" ||
  canonicalize(responses[0].payload.enabled_opcodes) !== "[257,258]" ||
  responses[0].payload.build_state !== "internal_unsigned"
) throw new Error("NATIVE_VERIFY.HANDSHAKE_FAILED");
if (
  responses[1].payload.status !== "ok" || responses[1].payload.filesystem !== "ntfs" ||
  responses[1].payload.fixed_local !== true || responses[1].payload.supported !== true
) throw new Error("NATIVE_VERIFY.VOLUME_PROBE_FAILED");
if (
  responses[2].payload.status !== "ok" || responses[2].payload.exists !== true ||
  responses[2].payload.reparse !== false
) throw new Error("NATIVE_VERIFY.PATH_PROBE_FAILED");
const rejected = responses.slice(3, 3 + profile.reserved_not_enabled_opcodes.length + 1);
if (rejected.some(({ payload }) => payload.status !== "error" || payload.code !== "RELAY_NATIVE.OPCODE_NOT_ENABLED")) {
  throw new Error("NATIVE_VERIFY.DISABLED_OPCODE_ACCEPTED");
}
if (responses.at(-2)?.payload.code !== "RELAY_NATIVE.PATH_INVALID") {
  throw new Error("NATIVE_VERIFY.AMBIGUOUS_PATH_ACCEPTED");
}
if (responses.at(-1)?.payload.code !== "RELAY_NATIVE.PATH_REPARSE_REJECTED") {
  throw new Error("NATIVE_VERIFY.REPARSE_PATH_ACCEPTED");
}
await rm(junctionPath, { recursive: true, force: true });

const invalidCli = spawnSync(binaryPath, ["--not-an-operation"], {
  cwd: projectRoot, encoding: null, shell: false, windowsHide: true, timeout: 5_000
});
if (invalidCli.status !== 10) throw new Error("NATIVE_VERIFY.CLI_NOT_CLOSED");
const malformed = Buffer.from(frames[0]);
malformed.write("NOPE", 0, 4, "ascii");
const badMagic = spawnSync(binaryPath, ["--capability-profile=path-inspection-v1"], {
  cwd: projectRoot, input: malformed, encoding: null, shell: false, windowsHide: true, timeout: 5_000
});
if (badMagic.status !== 21) throw new Error("NATIVE_VERIFY.BAD_MAGIC_NOT_REJECTED");
const nonCanonical = frame(1, 0, 0, helloPayload, `${canonicalize(helloPayload)} `);
const badJson = spawnSync(binaryPath, ["--capability-profile=path-inspection-v1"], {
  cwd: projectRoot, input: nonCanonical, encoding: null, shell: false, windowsHide: true, timeout: 5_000
});
if (badJson.status !== 26) throw new Error("NATIVE_VERIFY.NON_CANONICAL_JSON_NOT_REJECTED");

const binary = await readFile(binaryPath);
if (binary.toString("ascii", 0, 2) !== "MZ") throw new Error("NATIVE_VERIFY.NOT_PE");
const peOffset = binary.readUInt32LE(0x3c);
if (binary.toString("ascii", peOffset, peOffset + 4) !== "PE\0\0" || binary.readUInt16LE(peOffset + 4) !== 0x8664) {
  throw new Error("NATIVE_VERIFY.NOT_X64_PE");
}
const stats = await stat(binaryPath);
const evidence = {
  schema_version: 2,
  conclusion: "enabled_profile_passed",
  capability_profile: {
    id: profile.profile_id,
    version: profile.profile_version,
    sha256: await sha256File(profilePath),
    enabled_opcodes: [257, 258],
    enabled_count: 2,
    reserved_not_enabled_opcodes: profile.reserved_not_enabled_opcodes,
    reserved_rejected_count: profile.reserved_not_enabled_opcodes.length
  },
  binary: { filename: "relay-winbroker.exe", bytes: stats.size, sha256: await sha256File(binaryPath), pe_machine: "x64" },
  protocol: { fixed_argument_allowlist: true, handshake: true, strict_sequence: true, canonical_json: true, bad_magic_rejected: true },
  enabled_operations: { inspect_fixed_ntfs_volume: true, validate_existing_path_handle: true },
  fail_closed: { reserved_opcodes_rejected: true, unknown_opcode_rejected: true, ambiguous_path_rejected: true, reparse_path_rejected: true },
  forbidden_surfaces: { shell: "absent", network: "absent", download: "absent", comfy_queue: "absent", prompt_endpoint: "absent", media_generation: "absent" },
  product_boundary: { ran_model: false, submitted_prompt: false, submitted_queue: false, generated_media: false }
};
await writeFile(resolve(evidenceRoot, evidenceFile), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
process.stdout.write(`NATIVE_VERIFY status=enabled-profile-passed enabled=2 reserved_rejected=6 sha256=${evidence.binary.sha256} bytes=${stats.size}\n`);
