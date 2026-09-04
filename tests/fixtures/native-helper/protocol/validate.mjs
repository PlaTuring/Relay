import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../../..");
const ABI_PATH = path.join(ROOT, "native/win32-helper/spec/abi-manifest.v1.json");
const TOOLCHAIN_PATH = path.join(ROOT, "native/win32-helper/spec/toolchain-lock.v1.json");
const HEADER_PATH = path.join(ROOT, "native/win32-helper/include/minimaxh3_winbroker_abi.h");
const PROTOCOL_PATH = path.join(ROOT, "native/win32-helper/spec/protocol-v1.md");
const THREAT_PATH = path.join(ROOT, "native/win32-helper/spec/threat-model.md");
const ADR_PATH = path.join(ROOT, "docs/adr/ADR-013-win32-helper-protocol.md");
const MESSAGES_PATH = path.join(HERE, "valid/messages.json");
const STREAM_PATH = path.join(HERE, "valid/artifact-stream.json");
const HOSTILE_PATH = path.join(HERE, "hostile/cases.json");

const EXPECTED_ABI_DIGEST = "sha256:9ec29a44e4fa3292c6e77cce98a104fe4e6f36aa56d173b64d1ff00f490fa085";
const EXPECTED_TOOLCHAIN_DIGEST = "sha256:2bcc9e6347229a2ad9ff8f301c1af4e320a93caf3342e2738d35835b6f8b2832";
const EXPECTED_MESSAGE_COUNT = 16;
const EXPECTED_STREAM_CHUNK_COUNT = 2;
const EXPECTED_VALID_COUNT = 18;
const EXPECTED_HOSTILE_COUNT = 96;
const EXPECTED_THREAT_COUNT = 23;

const MAX_JSON_BYTES = 16 * 1024 * 1024;
const MAX_DEPTH = 64;
const MAX_VALUES = 200_000;
const MAX_OBJECT_PROPERTIES = 10_000;
const MAX_ARRAY_ITEMS = 10_000;
const MAX_STRING_BYTES = 1024 * 1024;
const CONTROL_HEADER_BYTES = 32;
const CONTROL_MAX_PAYLOAD = 262_144;
const STREAM_HEADER_BYTES = 40;
const STREAM_MAX_CHUNK = 1_048_576;
const STREAM_MAX_TOTAL = 274_877_906_944;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;

const EXPECTED_OPERATIONS = [
  { opcode: 257, name: "inspect_volume_candidate", timeout_min_ms: 100, timeout_max_ms: 5000, request_fields: ["candidate_path", "candidate_kind", "required_filesystem", "require_fixed_local"] },
  { opcode: 258, name: "validate_path_identity", timeout_min_ms: 100, timeout_max_ms: 15000, request_fields: ["candidate_path", "purpose", "mutation_policy"] },
  { opcode: 259, name: "prepare_owned_root", timeout_min_ms: 100, timeout_max_ms: 15000, request_fields: ["path_ref", "owner_id", "owner_marker_sha256"] },
  { opcode: 513, name: "materialize_owned_artifact", timeout_min_ms: 1000, timeout_max_ms: 14400000, request_fields: ["owned_root_ref", "relative_locator", "artifact_role", "expected_length_bytes", "expected_sha256", "stream_ref"] },
  { opcode: 514, name: "commit_owned_state", timeout_min_ms: 100, timeout_max_ms: 30000, request_fields: ["owned_root_ref", "relative_locator", "state_role", "prior_state", "candidate_length_bytes", "candidate_sha256", "stream_ref"] },
  { opcode: 769, name: "launch_managed_core", timeout_min_ms: 1000, timeout_max_ms: 60000, request_fields: ["owned_root_ref", "generation_id", "launch_manifest_ref", "launch_manifest_sha256", "runtime_lease_ref", "port_policy"] },
  { opcode: 770, name: "verify_loopback_owner", timeout_min_ms: 100, timeout_max_ms: 30000, request_fields: ["launch_ref", "listener_ref"] },
  { opcode: 771, name: "query_or_stop_owned_launch", timeout_min_ms: 100, timeout_max_ms: 30000, request_fields: ["launch_ref", "action", "stop_policy_id"] }
];

const REQUIRED_THREATS = new Set([
  "threat.ambient_authority",
  "threat.build_substitution",
  "threat.cancel_crash_partial",
  "threat.correlation_confusion",
  "threat.encoding_confusion",
  "threat.external_mutation",
  "threat.filesystem_authority",
  "threat.frame_confusion",
  "threat.generic_command",
  "threat.job_escape",
  "threat.network_surface",
  "threat.parent_spoof",
  "threat.path_ambiguity",
  "threat.path_toctou",
  "threat.prompt_creative",
  "threat.queue_generation",
  "threat.replay",
  "threat.secret_disclosure",
  "threat.signing_promotion",
  "threat.stop_wrong_process",
  "threat.stream_smuggling",
  "threat.truncation_dos",
  "threat.version_downgrade"
]);

const MESSAGE_KINDS = new Map([
  [1, { name: "client_hello", directions: new Set(["caller_to_helper"]), opcode: "zero" }],
  [2, { name: "server_hello", directions: new Set(["helper_to_caller"]), opcode: "zero" }],
  [3, { name: "request", directions: new Set(["caller_to_helper"]), opcode: "operation" }],
  [4, { name: "response", directions: new Set(["helper_to_caller"]), opcode: "operation" }],
  [5, { name: "cancel_request", directions: new Set(["caller_to_helper"]), opcode: "zero" }],
  [6, { name: "cancel_result", directions: new Set(["helper_to_caller"]), opcode: "zero" }],
  [7, { name: "close", directions: new Set(["caller_to_helper", "helper_to_caller"]), opcode: "zero" }]
]);

const OP_BY_CODE = new Map(EXPECTED_OPERATIONS.map((item) => [item.opcode, item]));
const OP_BY_NAME = new Map(EXPECTED_OPERATIONS.map((item) => [item.name, item]));
const ISSUED_FIXTURE_REFS = new Set([
  "41000000-0000-4000-8000-000000000001",
  "42000000-0000-4000-8000-000000000001",
  "43000000-0000-4000-8000-000000000001",
  "43000000-0000-4000-8000-000000000002",
  "44000000-0000-4000-8000-000000000001",
  "45000000-0000-4000-8000-000000000001",
  "46000000-0000-4000-8000-000000000001",
  "47000000-0000-4000-8000-000000000001"
]);
let TYPED_ERROR_NUMBERS = new Map();

const SIGNED = Object.freeze({
  session: "11111111-1111-4111-8111-111111111111",
  callerNonce: "1".repeat(64),
  helperNonce: "2".repeat(64),
  appBuild: "sha256:" + "a".repeat(64),
  appImage: "sha256:" + "ab".repeat(32),
  helperBuild: "sha256:" + "bc".repeat(32),
  helperImage: "sha256:" + "bd".repeat(32),
  publisher: "sha256:" + "c".repeat(64),
  parentPid: 4242,
  parentHigh: 31234567,
  parentLow: 2309737967
});

const INTERNAL = Object.freeze({
  session: "22222222-2222-4222-8222-222222222222",
  callerNonce: "3".repeat(64),
  helperNonce: "4".repeat(64),
  appBuild: "sha256:" + "da".repeat(32),
  appImage: "sha256:" + "db".repeat(32),
  helperBuild: "sha256:" + "ea".repeat(32),
  helperImage: "sha256:" + "eb".repeat(32),
  parentPid: 5151,
  parentHigh: 31234568,
  parentLow: 1985229328
});

function fail(message) {
  throw new Error(message);
}

class ParseFailure extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

class StrictJsonParser {
  constructor(text) {
    this.text = text;
    this.pos = 0;
    this.values = 0;
  }

  parse() {
    this.skipWhitespace();
    const value = this.parseValue(0);
    this.skipWhitespace();
    if (this.pos !== this.text.length) throw new ParseFailure("invalid_json", `trailing JSON at ${this.pos}`);
    return value;
  }

  skipWhitespace() {
    while (this.pos < this.text.length && /[\u0009\u000a\u000d\u0020]/.test(this.text[this.pos])) this.pos += 1;
  }

  count(depth) {
    if (depth > MAX_DEPTH) throw new ParseFailure("limit", "JSON depth exceeded");
    this.values += 1;
    if (this.values > MAX_VALUES) throw new ParseFailure("limit", "JSON value count exceeded");
  }

  parseValue(depth) {
    this.count(depth);
    const ch = this.text[this.pos];
    if (ch === "{") return this.parseObject(depth + 1);
    if (ch === "[") return this.parseArray(depth + 1);
    if (ch === '"') return this.parseString();
    if (ch === "t" && this.text.startsWith("true", this.pos)) { this.pos += 4; return true; }
    if (ch === "f" && this.text.startsWith("false", this.pos)) { this.pos += 5; return false; }
    if (ch === "n" && this.text.startsWith("null", this.pos)) { this.pos += 4; return null; }
    return this.parseInteger();
  }

  parseString() {
    const start = this.pos;
    this.pos += 1;
    while (this.pos < this.text.length) {
      const code = this.text.charCodeAt(this.pos);
      const ch = this.text[this.pos];
      if (ch === '"') {
        this.pos += 1;
        let value;
        try { value = JSON.parse(this.text.slice(start, this.pos)); }
        catch { throw new ParseFailure("invalid_json", `bad string at ${start}`); }
        if (Buffer.byteLength(value, "utf8") > MAX_STRING_BYTES) throw new ParseFailure("limit", "string limit exceeded");
        for (let i = 0; i < value.length; i += 1) {
          const current = value.charCodeAt(i);
          if (current >= 0xd800 && current <= 0xdbff) {
            const next = value.charCodeAt(i + 1);
            if (!(next >= 0xdc00 && next <= 0xdfff)) throw new ParseFailure("unpaired_surrogate", "unpaired high surrogate");
            i += 1;
          } else if (current >= 0xdc00 && current <= 0xdfff) {
            throw new ParseFailure("unpaired_surrogate", "unpaired low surrogate");
          }
        }
        return value;
      }
      if (code < 0x20) throw new ParseFailure("invalid_json", "unescaped control character");
      if (ch === "\\") {
        this.pos += 1;
        const escape = this.text[this.pos];
        if (!'"\\/bfnrtu'.includes(escape ?? "")) throw new ParseFailure("invalid_json", "invalid escape");
        if (escape === "u") {
          const hex = this.text.slice(this.pos + 1, this.pos + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new ParseFailure("invalid_json", "invalid unicode escape");
          this.pos += 4;
        }
      }
      this.pos += 1;
    }
    throw new ParseFailure("invalid_json", `unterminated string at ${start}`);
  }

  parseInteger() {
    const rest = this.text.slice(this.pos);
    const match = /^-?(?:0|[1-9][0-9]*)/.exec(rest);
    if (!match || match[0] === "-0") throw new ParseFailure("invalid_json", `invalid number at ${this.pos}`);
    const end = this.pos + match[0].length;
    if (/[.eE]/.test(this.text[end] ?? "")) throw new ParseFailure("invalid_json", "fractional/exponent number forbidden");
    const value = Number(match[0]);
    if (!Number.isSafeInteger(value)) throw new ParseFailure("limit", "unsafe integer");
    this.pos = end;
    return value;
  }

  parseObject(depth) {
    const object = {};
    const keys = new Set();
    this.pos += 1;
    this.skipWhitespace();
    if (this.text[this.pos] === "}") { this.pos += 1; return object; }
    while (true) {
      if (this.text[this.pos] !== '"') throw new ParseFailure("invalid_json", "object key must be string");
      const key = this.parseString();
      if (Buffer.byteLength(key, "utf8") > 128) throw new ParseFailure("limit", "key limit exceeded");
      if (keys.has(key)) throw new ParseFailure("duplicate_key", `duplicate key ${key}`);
      keys.add(key);
      if (keys.size > MAX_OBJECT_PROPERTIES) throw new ParseFailure("limit", "object property count exceeded");
      this.skipWhitespace();
      if (this.text[this.pos] !== ":") throw new ParseFailure("invalid_json", "missing colon");
      this.pos += 1;
      this.skipWhitespace();
      object[key] = this.parseValue(depth);
      this.skipWhitespace();
      if (this.text[this.pos] === "}") { this.pos += 1; return object; }
      if (this.text[this.pos] !== ",") throw new ParseFailure("invalid_json", "missing comma");
      this.pos += 1;
      this.skipWhitespace();
    }
  }

  parseArray(depth) {
    const array = [];
    this.pos += 1;
    this.skipWhitespace();
    if (this.text[this.pos] === "]") { this.pos += 1; return array; }
    while (true) {
      if (array.length >= MAX_ARRAY_ITEMS) throw new ParseFailure("limit", "array item count exceeded");
      array.push(this.parseValue(depth));
      this.skipWhitespace();
      if (this.text[this.pos] === "]") { this.pos += 1; return array; }
      if (this.text[this.pos] !== ",") throw new ParseFailure("invalid_json", "missing comma");
      this.pos += 1;
      this.skipWhitespace();
    }
  }
}

function decodeUtf8(bytes) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new ParseFailure("invalid_utf8", "invalid UTF-8"); }
}

function strictParseBytes(bytes) {
  if (bytes.length > MAX_JSON_BYTES) throw new ParseFailure("limit", "document exceeds 16 MiB");
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) throw new ParseFailure("bom", "BOM forbidden");
  return new StrictJsonParser(decodeUtf8(bytes)).parse();
}

function readJson(filePath) {
  const bytes = fs.readFileSync(filePath);
  try { return strictParseBytes(bytes); }
  catch (failure) { fail(`${path.relative(ROOT, filePath)}: ${failure.message}`); }
}

function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) fail("canonical JSON accepts safe integers only");
    return String(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  fail("unsupported canonical JSON value");
}

function sha256(value) {
  const input = Buffer.isBuffer(value) || typeof value === "string" ? value : canonicalJson(value);
  return `sha256:${crypto.createHash("sha256").update(input).digest("hex")}`;
}

function documentHash(document) {
  const projection = structuredClone(document);
  delete projection.integrity;
  return sha256(projection);
}

function refreshIntegrity(document) {
  document.integrity = { profile: "rfc8785-sha256-v1", content_sha256: documentHash(document) };
  return document;
}

function clone(value) {
  return structuredClone(value);
}

function error(code, instancePath, ruleId) {
  return { code, instance_path: instancePath, rule_id: ruleId };
}

function assertExact(actual, expected, context) {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail(`${context}: expected ${canonicalJson(expected)} but got ${canonicalJson(actual)}`);
  }
}

function firstUnknown(object, allowed, pointer, ruleId) {
  if (!object || typeof object !== "object" || Array.isArray(object)) return error("WIN32_HELPER.POLICY_REJECTED", pointer, `${ruleId}.object_required`);
  const unknown = Object.keys(object).filter((key) => !allowed.has(key)).sort()[0];
  return unknown === undefined ? null : error("CONTRACT.UNKNOWN_FIELD", `${pointer}/${unknown}`, ruleId);
}

function verifyIntegrity(document) {
  if (!document.integrity || document.integrity.profile !== "rfc8785-sha256-v1" || document.integrity.content_sha256 !== documentHash(document)) {
    return error("CONTRACT.INTEGRITY_MISMATCH", "/integrity/content_sha256", "wire.integrity.jcs_sha256");
  }
  return null;
}

function validateUuid(value, pointer, ruleId = "wire.id.uuidv4") {
  return typeof value === "string" && UUID_V4.test(value) ? null : error("WIN32_HELPER.POLICY_REJECTED", pointer, ruleId);
}

function validateSha(value, pointer, ruleId) {
  return typeof value === "string" && SHA256.test(value) ? null : error("WIN32_HELPER.POLICY_REJECTED", pointer, ruleId);
}

function operationProjection(value) {
  return {
    opcode: value.opcode,
    name: value.name,
    timeout_min_ms: value.timeout_min_ms,
    timeout_max_ms: value.timeout_max_ms,
    request_fields: value.request_fields
  };
}

function lintSpec(abi, toolchain, headerText) {
  if (abi.contract_id !== "minimax-h3-tool.win32-helper-abi" || abi.schema_version !== "1.0.0" || abi.abi_version !== "1.0.0") fail("ABI identity drift");
  if (toolchain.contract_id !== "minimax-h3-tool.win32-helper-toolchain" || toolchain.schema_version !== "1.0.0") fail("toolchain identity drift");
  if (documentHash(abi) !== abi.integrity?.content_sha256) fail("ABI content integrity mismatch");
  if (documentHash(toolchain) !== toolchain.integrity?.content_sha256) fail("toolchain content integrity mismatch");
  const abiDigest = sha256(abi);
  const toolchainDigest = sha256(toolchain);
  if (abiDigest !== EXPECTED_ABI_DIGEST) fail(`ABI digest drift: ${abiDigest}`);
  if (toolchainDigest !== EXPECTED_TOOLCHAIN_DIGEST) fail(`toolchain digest drift: ${toolchainDigest}`);
  if (abi.toolchain_manifest_sha256 !== toolchainDigest) fail("ABI references a different toolchain manifest");
  if (abi.control_frame.header_size_bytes !== CONTROL_HEADER_BYTES || abi.control_frame.max_payload_bytes !== CONTROL_MAX_PAYLOAD || abi.control_frame.framing_version !== 1) fail("control framing drift");
  if (abi.stream_frame.header_size_bytes !== STREAM_HEADER_BYTES || abi.stream_frame.max_chunk_bytes !== STREAM_MAX_CHUNK || abi.stream_frame.max_total_bytes !== STREAM_MAX_TOTAL || abi.stream_frame.framing_version !== 1) fail("stream framing drift");
  if (abi.transport.kind !== "inherited_private_anonymous_pipes" || canonicalJson(abi.transport.fixed_argument_array) !== canonicalJson(["--wire-abi=1"]) || abi.transport.named_pipe || abi.transport.tcp_listener || abi.transport.network_client || abi.transport.shell) fail("transport widened");
  const actualOperations = abi.operation_families.map(operationProjection);
  assertExact(actualOperations, EXPECTED_OPERATIONS, "operation allowlist");
  const opNames = new Set(EXPECTED_OPERATIONS.map((item) => item.name));
  const forbiddenIntersection = abi.forbidden_operation_names.filter((name) => opNames.has(name));
  if (forbiddenIntersection.length !== 0) fail(`forbidden operation became executable: ${forbiddenIntersection.join(",")}`);
  const errorCodes = new Set();
  const numericCodes = new Set();
  for (const item of abi.typed_errors) {
    if (!/^(?:WIN32_HELPER|CONTRACT)\.[A-Z0-9_]+$/.test(item.code)) fail(`invalid typed error code ${item.code}`);
    if (errorCodes.has(item.code) || numericCodes.has(item.numeric_code)) fail(`duplicate typed error ${item.code}`);
    errorCodes.add(item.code);
    numericCodes.add(item.numeric_code);
  }
  for (const required of ["WIN32_HELPER.UNKNOWN_OPCODE", "WIN32_HELPER.FORBIDDEN_SURFACE", "WIN32_HELPER.PARENT_IDENTITY_MISMATCH", "WIN32_HELPER.SIGNING_STATE_MISMATCH", "WIN32_HELPER.FRAME_TRUNCATED", "CONTRACT.UNKNOWN_FIELD"]) {
    if (!errorCodes.has(required)) fail(`missing typed error ${required}`);
  }
  if (toolchain.selection_status !== "frozen_plan_unmaterialized" || toolchain.language.family !== "iso_cpp" || toolchain.language.edition !== "c++20" || toolchain.language.implementation !== "msvc" || toolchain.language.third_party_dependencies !== false) fail("toolchain language drift");
  if (toolchain.distribution.product_version !== "17.14.39" || toolchain.distribution.product_build !== "17.14.37614.0" || toolchain.distribution.vc_component_id !== "Microsoft.VisualStudio.Component.VC.14.44.17.14.x86.x64" || toolchain.distribution.windows_sdk_version !== "10.0.26100.8876") fail("toolchain version drift");
  if (toolchain.target.architecture !== "x86_64" || toolchain.target.machine !== "x64" || toolchain.target.pointer_bits !== 64 || toolchain.target.arm64_status !== "unsupported" || toolchain.target.x86_status !== "unsupported") fail("target architecture drift");
  if (toolchain.artifact_materialization_gate.state !== "blocked_pending_immutable_artifact_manifest" || toolchain.artifact_materialization_gate.build_before_gate !== "forbidden" || toolchain.artifact_materialization_gate.network_during_build !== "denied") fail("toolchain materialization gate weakened");
  if (Object.values(toolchain.evidence).some((value) => value !== false && value !== "contract_frozen")) fail("toolchain evidence overclaimed");
  const requiredHeaderFragments = [
    `#define MINIMAXH3_WINBROKER_ABI_MANIFEST_SHA256 "${EXPECTED_ABI_DIGEST}"`,
    "#define MINIMAXH3_WINBROKER_CONTROL_HEADER_BYTES 32u",
    "#define MINIMAXH3_WINBROKER_CONTROL_MAX_PAYLOAD_BYTES 262144u",
    "#define MINIMAXH3_WINBROKER_STREAM_HEADER_BYTES 40u",
    "#define MINIMAXH3_WINBROKER_STREAM_MAX_CHUNK_BYTES 1048576u",
    "#define MINIMAXH3_WINBROKER_OPERATION_FAMILY_COUNT 8u",
    "MINIMAXH3_WINBROKER_OPCODE_INSPECT_VOLUME_CANDIDATE",
    "MINIMAXH3_WINBROKER_OPCODE_QUERY_OR_STOP_OWNED_LAUNCH",
    "sizeof(minimaxh3_winbroker_control_frame_header_v1) == 32u",
    "sizeof(minimaxh3_winbroker_stream_frame_header_v1) == 40u"
  ];
  for (const fragment of requiredHeaderFragments) if (!headerText.includes(fragment)) fail(`header mirror missing: ${fragment}`);
  if (/\b(?:__declspec\s*\(\s*dllexport|LoadLibrary|ShellExecute|WinHttp|system\s*\()/i.test(headerText)) fail("header declares an implementation or generic surface");
  return { abiDigest, toolchainDigest, errorCodes, errorNumbers: new Map(abi.typed_errors.map((item) => [item.code, item.numeric_code])), forbiddenIntersection };
}

function buildControlFrame(payload, frame) {
  const payloadBytes = Buffer.from(canonicalJson(payload), "utf8");
  return buildRawControlFrame(payloadBytes, frame.message_kind, frame.opcode, frame.sequence);
}

function buildRawControlFrame(payloadBytes, messageKind, opcode, sequence) {
  const header = Buffer.alloc(CONTROL_HEADER_BYTES);
  header.write("MH3W", 0, 4, "ascii");
  header.writeUInt16LE(CONTROL_HEADER_BYTES, 4);
  header.writeUInt16LE(1, 6);
  header.writeUInt32LE(payloadBytes.length, 8);
  header.writeUInt16LE(messageKind, 12);
  header.writeUInt16LE(opcode, 14);
  header.writeUInt32LE(0, 16);
  header.writeBigUInt64LE(BigInt(sequence), 20);
  header.writeUInt32LE(0, 28);
  return Buffer.concat([header, payloadBytes]);
}

function decodeControlFrame(buffer, direction, context = {}) {
  if (buffer.length < CONTROL_HEADER_BYTES) return { error: error("WIN32_HELPER.FRAME_TRUNCATED", "", "frame.header.exact_length") };
  if (buffer.subarray(0, 4).toString("ascii") !== "MH3W") return { error: error("WIN32_HELPER.BAD_MAGIC", "", "frame.magic.exact") };
  if (buffer.readUInt16LE(4) !== CONTROL_HEADER_BYTES) return { error: error("WIN32_HELPER.INVALID_HEADER", "", "frame.header.size_exact") };
  if (buffer.readUInt16LE(6) !== 1) return { error: error("WIN32_HELPER.UNSUPPORTED_FRAME_VERSION", "", "frame.version.exact") };
  const payloadLength = buffer.readUInt32LE(8);
  if (payloadLength > CONTROL_MAX_PAYLOAD) return { error: error("WIN32_HELPER.FRAME_TOO_LARGE", "", "frame.payload.max_bytes") };
  if (buffer.readUInt32LE(16) !== 0) return { error: error("WIN32_HELPER.RESERVED_BITS_SET", "", "frame.flags.allowed") };
  if (buffer.readUInt32LE(28) !== 0) return { error: error("WIN32_HELPER.RESERVED_BITS_SET", "", "frame.reserved.zero") };
  const messageKindCode = buffer.readUInt16LE(12);
  const kind = MESSAGE_KINDS.get(messageKindCode);
  if (!kind) return { error: error("WIN32_HELPER.UNEXPECTED_FRAME_KIND", "", "frame.kind.known") };
  if (!kind.directions.has(direction)) return { error: error("WIN32_HELPER.UNEXPECTED_FRAME_KIND", "", "frame.kind.direction") };
  const opcode = buffer.readUInt16LE(14);
  if (kind.opcode === "operation") {
    if (!OP_BY_CODE.has(opcode)) return { error: error("WIN32_HELPER.UNKNOWN_OPCODE", "", "frame.opcode.allowlist") };
  } else if (opcode !== 0) {
    return { error: error("WIN32_HELPER.OPCODE_KIND_MISMATCH", "", "frame.opcode.zero_for_control") };
  }
  if (buffer.length < CONTROL_HEADER_BYTES + payloadLength) return { error: error("WIN32_HELPER.FRAME_TRUNCATED", "", "frame.payload.exact_length") };
  if (buffer.length !== CONTROL_HEADER_BYTES + payloadLength) return { error: error("WIN32_HELPER.INVALID_HEADER", "", "frame.payload.single_exact") };
  const payloadBytes = buffer.subarray(CONTROL_HEADER_BYTES);
  if (payloadBytes.length >= 3 && payloadBytes[0] === 0xef && payloadBytes[1] === 0xbb && payloadBytes[2] === 0xbf) return { error: error("WIN32_HELPER.NON_CANONICAL_JSON", "", "payload.utf8.no_bom") };
  let text;
  let payload;
  try {
    text = decodeUtf8(payloadBytes);
    payload = new StrictJsonParser(text).parse();
  } catch (failure) {
    if (failure.kind === "invalid_utf8") return { error: error("CONTRACT.INVALID_UTF8", "", "payload.utf8.valid") };
    if (failure.kind === "unpaired_surrogate") return { error: error("CONTRACT.INVALID_UTF8", "", "json.string.unpaired_surrogate") };
    if (failure.kind === "duplicate_key") return { error: error("CONTRACT.DUPLICATE_KEY", "", "json.object.unique_keys") };
    if (failure.kind === "limit") return { error: error("WIN32_HELPER.INPUT_LIMIT_EXCEEDED", "", "payload.json.limits") };
    return { error: error("WIN32_HELPER.NON_CANONICAL_JSON", "", "payload.json.valid") };
  }
  if (text !== canonicalJson(payload)) return { error: error("WIN32_HELPER.NON_CANONICAL_JSON", "", "payload.jcs.exact") };
  const header = { messageKindCode, kind: kind.name, opcode, sequence: buffer.readBigUInt64LE(20), direction };
  const payloadError = validatePayload(payload, header, context);
  return payloadError ? { error: payloadError, header, payload } : { error: null, header, payload };
}

const COMMON_FIELDS = new Set(["contract_id", "schema_version", "document_id", "document_revision", "message_kind", "session_id", "integrity"]);

function branchFields(...names) {
  return new Set([...COMMON_FIELDS, ...names]);
}

function validatePayload(payload, header, context = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return error("WIN32_HELPER.POLICY_REJECTED", "", "wire.root.object");
  if (payload.contract_id !== "minimax-h3-tool.win32-helper-wire") return error("CONTRACT.UNKNOWN_CONTRACT", "/contract_id", "wire.envelope.contract_exact");
  if (payload.schema_version !== "1.0.0") return error("CONTRACT.UNSUPPORTED_VERSION", "/schema_version", "wire.envelope.version_exact");
  if (payload.message_kind !== header.kind) return error("WIN32_HELPER.UNEXPECTED_FRAME_KIND", "/message_kind", "payload.kind.header_exact");
  if (payload.document_revision !== 1) return error("WIN32_HELPER.POLICY_REJECTED", "/document_revision", "wire.document_revision.one");
  let issue = validateUuid(payload.document_id, "/document_id"); if (issue) return issue;
  issue = validateUuid(payload.session_id, "/session_id"); if (issue) return issue;
  if (context.sessionId && payload.session_id !== context.sessionId) return error("WIN32_HELPER.SESSION_MISMATCH", "/session_id", "session.id.exact");
  issue = verifyIntegrity(payload); if (issue) return issue;
  if (header.kind === "client_hello") issue = validateClientHello(payload);
  else if (header.kind === "server_hello") issue = validateServerHello(payload);
  else if (header.kind === "request") issue = validateRequest(payload, header.opcode);
  else if (header.kind === "response") issue = validateResponse(payload, header.opcode, context);
  else if (header.kind === "cancel_request") issue = validateCancelRequest(payload);
  else if (header.kind === "cancel_result") issue = validateCancelResult(payload);
  else if (header.kind === "close") issue = firstUnknown(payload, branchFields("reason"), "", "close.object.closed");
  return issue;
}

function validateClientHello(payload) {
  let issue = firstUnknown(payload, branchFields("abi_version", "abi_manifest_sha256", "caller_nonce", "caller_identity", "expected_helper", "build_authorization"), "", "client_hello.object.closed");
  if (issue) return issue;
  if (payload.abi_version !== "1.0.0") return error("WIN32_HELPER.UNSUPPORTED_ABI_VERSION", "/abi_version", "protocol.abi.version_exact");
  if (payload.abi_manifest_sha256 !== EXPECTED_ABI_DIGEST) return error("WIN32_HELPER.ABI_DIGEST_MISMATCH", "/abi_manifest_sha256", "protocol.abi.digest_exact");
  if (!/^[0-9a-f]{64}$/.test(payload.caller_nonce ?? "")) return error("WIN32_HELPER.NONCE_MISMATCH", "/caller_nonce", "handshake.nonce.bits_exact");
  const caller = payload.caller_identity;
  const helper = payload.expected_helper;
  const authorization = payload.build_authorization;
  if (!caller || !helper || !authorization) return error("WIN32_HELPER.POLICY_REJECTED", "/caller_identity", "handshake.identity.required");
  issue = firstUnknown(caller, new Set(["role", "product_id", "version", "build_id", "build_manifest_sha256", "image_sha256", "release_state", "signature", "parent"]), "/caller_identity", "caller_identity.object.closed"); if (issue) return issue;
  if (caller.role !== "electron_main" || caller.product_id !== "minimax-h3-tool.control-plane") return error("WIN32_HELPER.PARENT_IDENTITY_MISMATCH", "/caller_identity/role", "handshake.caller.role_exact");
  const internalTuple = authorization.state === "internal_unsigned" || caller.build_id === "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  if (internalTuple && caller.release_state !== "internal_unsigned") return error("WIN32_HELPER.SIGNING_STATE_MISMATCH", "/caller_identity/release_state", "handshake.signing.derived_exact");
  if (caller.release_state === "authenticode_release") {
    if (caller.signature?.state !== "valid") return error("WIN32_HELPER.SIGNATURE_REQUIRED", "/caller_identity/signature/state", "handshake.release.signature_valid");
    if (caller.signature.publisher_spki_sha256 !== SIGNED.publisher || authorization.publisher_spki_sha256 !== SIGNED.publisher || helper.publisher_spki_sha256 !== SIGNED.publisher) return error("WIN32_HELPER.PUBLISHER_MISMATCH", "/caller_identity/signature/publisher_spki_sha256", "handshake.publisher.exact");
    if (caller.signature.timestamp_state !== "valid" || authorization.state !== "valid" || helper.release_state !== "authenticode_release") return error("WIN32_HELPER.SIGNING_STATE_MISMATCH", "/caller_identity/release_state", "handshake.signing.derived_exact");
    if (caller.build_manifest_sha256 !== SIGNED.appBuild) return error("WIN32_HELPER.APP_BUILD_MISMATCH", "/caller_identity/build_manifest_sha256", "handshake.app_build.exact");
    if (caller.image_sha256 !== SIGNED.appImage) return error("WIN32_HELPER.APP_IMAGE_HASH_MISMATCH", "/caller_identity/image_sha256", "handshake.app_image.hash_exact");
    if (helper.build_manifest_sha256 !== SIGNED.helperBuild) return error("WIN32_HELPER.HELPER_BUILD_MISMATCH", "/expected_helper/build_manifest_sha256", "handshake.helper.build_exact");
    if (helper.image_sha256 !== SIGNED.helperImage) return error("WIN32_HELPER.HELPER_HASH_MISMATCH", "/expected_helper/image_sha256", "handshake.helper.hash_exact");
    if (helper.version !== "1.0.0") return error("WIN32_HELPER.HELPER_BUILD_MISMATCH", "/expected_helper/version", "handshake.helper.version_exact");
    if (caller.parent?.pid !== SIGNED.parentPid) return error("WIN32_HELPER.PARENT_IDENTITY_MISMATCH", "/caller_identity/parent/pid", "handshake.parent.pid_exact");
    if (caller.parent?.creation_filetime?.high_u32 !== SIGNED.parentHigh || caller.parent?.creation_filetime?.low_u32 !== SIGNED.parentLow) return error("WIN32_HELPER.PARENT_IDENTITY_MISMATCH", "/caller_identity/parent/creation_filetime", "handshake.parent.creation_exact");
    if (caller.parent?.canonical_image_sha256 !== SIGNED.appImage) return error("WIN32_HELPER.PARENT_IDENTITY_MISMATCH", "/caller_identity/parent/canonical_image_sha256", "handshake.parent.image_exact");
  } else if (caller.release_state === "internal_unsigned") {
    if (caller.signature?.state !== "unsigned" || helper.release_state !== "internal_unsigned" || authorization.state !== "internal_unsigned") return error("WIN32_HELPER.SIGNING_STATE_MISMATCH", "/caller_identity/release_state", "handshake.signing.derived_exact");
    if (caller.build_manifest_sha256 !== INTERNAL.appBuild || caller.image_sha256 !== INTERNAL.appImage || helper.build_manifest_sha256 !== INTERNAL.helperBuild || helper.image_sha256 !== INTERNAL.helperImage) return error("WIN32_HELPER.APP_BUILD_MISMATCH", "/caller_identity/build_manifest_sha256", "handshake.internal_pair.exact");
    if (caller.parent?.pid !== INTERNAL.parentPid) return error("WIN32_HELPER.PARENT_IDENTITY_MISMATCH", "/caller_identity/parent/pid", "handshake.parent.pid_exact");
    if (caller.parent?.creation_filetime?.high_u32 !== INTERNAL.parentHigh || caller.parent?.creation_filetime?.low_u32 !== INTERNAL.parentLow) return error("WIN32_HELPER.PARENT_IDENTITY_MISMATCH", "/caller_identity/parent/creation_filetime", "handshake.parent.creation_exact");
  } else {
    return error("WIN32_HELPER.SIGNING_STATE_MISMATCH", "/caller_identity/release_state", "handshake.signing.closed_state");
  }
  return null;
}

function validateServerHello(payload) {
  let issue = firstUnknown(payload, branchFields("abi_version", "abi_manifest_sha256", "caller_nonce_echo", "helper_nonce", "observed_parent", "helper_identity", "build_authorization_status"), "", "server_hello.object.closed");
  if (issue) return issue;
  if (payload.abi_version !== "1.0.0") return error("WIN32_HELPER.UNSUPPORTED_ABI_VERSION", "/abi_version", "protocol.abi.version_exact");
  if (payload.abi_manifest_sha256 !== EXPECTED_ABI_DIGEST) return error("WIN32_HELPER.ABI_DIGEST_MISMATCH", "/abi_manifest_sha256", "protocol.abi.digest_exact");
  const expected = payload.session_id === SIGNED.session ? SIGNED : payload.session_id === INTERNAL.session ? INTERNAL : null;
  if (!expected) return error("WIN32_HELPER.SESSION_MISMATCH", "/session_id", "session.id.exact");
  if (payload.caller_nonce_echo !== expected.callerNonce) return error("WIN32_HELPER.NONCE_MISMATCH", "/caller_nonce_echo", "handshake.nonce.echo_exact");
  if (payload.helper_nonce !== expected.helperNonce) return error("WIN32_HELPER.NONCE_MISMATCH", "/helper_nonce", "handshake.nonce.bits_exact");
  if (payload.observed_parent?.pid !== expected.parentPid || payload.observed_parent?.creation_filetime?.high_u32 !== expected.parentHigh || payload.observed_parent?.creation_filetime?.low_u32 !== expected.parentLow) return error("WIN32_HELPER.PARENT_IDENTITY_MISMATCH", "/observed_parent", "handshake.parent.exact");
  if (payload.helper_identity?.image_sha256 !== expected.helperImage) return error("WIN32_HELPER.HELPER_HASH_MISMATCH", "/helper_identity/image_sha256", "handshake.helper.hash_exact");
  return null;
}

const COMMAND_FIELDS = new Set(["command", "shell", "powershell", "cmd", "executable", "args", "argv"]);
const AMBIENT_FIELDS = new Set(["cwd", "environment", "env", "path", "handle", "handle_value"]);
const FILESYSTEM_FIELDS = new Set(["source_path", "target_path", "delete_path", "filesystem_operation"]);
const NETWORK_FIELDS = new Set(["url", "host", "port", "socket", "http", "download", "update"]);
const QUEUE_FIELDS = new Set(["endpoint", "queue", "submit_graph", "workflow", "graph", "prompt"]);
const GENERATION_FIELDS = new Set(["generation_request", "video", "audio", "media", "media_request"]);
const CREATIVE_FIELDS = new Set(["story", "shot_plan", "prompt_expand", "music"]);

function forbiddenBodyField(field) {
  if (field === "path_utf16le_base64" || field === "path_bytes_hex") return error("WIN32_HELPER.PATH_ENCODING_AMBIGUOUS", "/operation/body/candidate_path", "path.single_canonical_encoding");
  if (field === "data_base64" || field === "blob") return error("WIN32_HELPER.FORBIDDEN_SURFACE", `/operation/body/${field}`, "operation.binary_json.forbidden");
  if (field === "external_model_ref") return error("WIN32_HELPER.FORBIDDEN_SURFACE", `/operation/body/${field}`, "operation.external_mutation.forbidden");
  if (field === "breakaway_ok" || field === "job_flags") return error("WIN32_HELPER.FORBIDDEN_SURFACE", `/operation/body/${field}`, "operation.job_policy.caller_control_forbidden");
  if (field === "pid" || field === "process_name") return error("WIN32_HELPER.FORBIDDEN_SURFACE", `/operation/body/${field}`, "operation.stop.raw_identity_forbidden");
  if (COMMAND_FIELDS.has(field)) return error("WIN32_HELPER.FORBIDDEN_SURFACE", `/operation/body/${field}`, "operation.command.forbidden");
  if (AMBIENT_FIELDS.has(field)) return error("WIN32_HELPER.FORBIDDEN_SURFACE", `/operation/body/${field}`, "operation.ambient_authority.forbidden");
  if (FILESYSTEM_FIELDS.has(field)) return error("WIN32_HELPER.FORBIDDEN_SURFACE", `/operation/body/${field}`, "operation.filesystem.generic_forbidden");
  if (NETWORK_FIELDS.has(field)) return error("WIN32_HELPER.FORBIDDEN_SURFACE", `/operation/body/${field}`, "operation.network.forbidden");
  if (QUEUE_FIELDS.has(field)) return error("WIN32_HELPER.FORBIDDEN_SURFACE", `/operation/body/${field}`, "operation.queue.forbidden");
  if (GENERATION_FIELDS.has(field)) return error("WIN32_HELPER.FORBIDDEN_SURFACE", `/operation/body/${field}`, "operation.generation.forbidden");
  if (CREATIVE_FIELDS.has(field)) return error("WIN32_HELPER.FORBIDDEN_SURFACE", `/operation/body/${field}`, "operation.creative.forbidden");
  return null;
}

function validateCandidatePath(candidate) {
  const pointer = "/operation/body/candidate_path";
  if (typeof candidate !== "string") return error("WIN32_HELPER.PATH_INVALID", pointer, "path.lexical.string_required");
  if (/[\u0000-\u001f]/.test(candidate)) return error("WIN32_HELPER.PATH_INVALID", pointer, "path.lexical.control_forbidden");
  if (candidate.startsWith("\\\\?\\") || candidate.startsWith("\\\\.\\") || candidate.startsWith("\\\\") || candidate.slice(2).includes(":")) return error("WIN32_HELPER.PATH_INVALID", pointer, "path.lexical.device_unc_ads_forbidden");
  if (candidate.includes("/") || candidate.includes("%")) return error("WIN32_HELPER.PATH_ENCODING_AMBIGUOUS", pointer, "path.single_canonical_encoding");
  if (!/^[A-Z]:\\[^.]/u.test(candidate) && !/^[A-Z]:\\$/u.test(candidate)) return error("WIN32_HELPER.PATH_INVALID", pointer, "path.lexical.allowed_form");
  const segments = candidate.slice(3).split("\\");
  if (segments.some((segment) => segment === "." || segment === ".." || /[. ]$/.test(segment))) return error("WIN32_HELPER.PATH_INVALID", pointer, "path.lexical.segment_forbidden");
  return null;
}

function validateRelativeLocator(locator, pointer) {
  if (typeof locator !== "string" || locator.length === 0 || locator.startsWith("/") || locator.includes("\\") || locator.includes(":") || locator.split("/").some((part) => !part || part === "." || part === "..")) return error("WIN32_HELPER.PATH_INVALID", pointer, "path.relative.exact");
  return null;
}

function validateRequest(payload, opcode) {
  let issue = firstUnknown(payload, branchFields("request_id", "correlation_id", "operation"), "", "request.object.closed"); if (issue) return issue;
  issue = validateUuid(payload.request_id, "/request_id"); if (issue) return issue;
  issue = validateUuid(payload.correlation_id, "/correlation_id"); if (issue) return issue;
  const operation = payload.operation;
  issue = firstUnknown(operation, new Set(["kind", "timeout_ms", "body"]), "/operation", "operation.object.closed"); if (issue) return issue;
  const expected = OP_BY_CODE.get(opcode);
  if (!expected || operation.kind !== expected.name) return error("WIN32_HELPER.OPCODE_KIND_MISMATCH", "/operation/kind", "request.opcode_kind.exact");
  if (!Number.isSafeInteger(operation.timeout_ms) || operation.timeout_ms < expected.timeout_min_ms || operation.timeout_ms > expected.timeout_max_ms) return error("WIN32_HELPER.TIMEOUT", "/operation/timeout_ms", "operation.timeout.bounded");
  const body = operation.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return error("WIN32_HELPER.POLICY_REJECTED", "/operation/body", "operation.body.object");
  for (const field of Object.keys(body).sort()) {
    if (!expected.request_fields.includes(field)) {
      const forbidden = forbiddenBodyField(field);
      if (forbidden) return forbidden;
      return error("CONTRACT.UNKNOWN_FIELD", `/operation/body/${field}`, "operation.branch.closed");
    }
  }
  for (const required of expected.request_fields) if (!(required in body)) return error("WIN32_HELPER.POLICY_REJECTED", `/operation/body/${required}`, "operation.field.required");
  if (expected.name === "inspect_volume_candidate" || expected.name === "validate_path_identity") {
    issue = validateCandidatePath(body.candidate_path); if (issue) return issue;
  }
  const referenceFields = expected.request_fields.filter((field) => field.endsWith("_ref"));
  for (const field of referenceFields) if (!UUID_V4.test(body[field] ?? "") || !ISSUED_FIXTURE_REFS.has(body[field])) return error("WIN32_HELPER.INVALID_REFERENCE", `/operation/body/${field}`, "reference.issued_by_session");
  if ("relative_locator" in body) { issue = validateRelativeLocator(body.relative_locator, "/operation/body/relative_locator"); if (issue) return issue; }
  if ("expected_sha256" in body) { issue = validateSha(body.expected_sha256, "/operation/body/expected_sha256", "artifact.hash.shape"); if (issue) return issue; }
  if ("candidate_sha256" in body) { issue = validateSha(body.candidate_sha256, "/operation/body/candidate_sha256", "state.hash.shape"); if (issue) return issue; }
  if ("expected_length_bytes" in body && (!Number.isSafeInteger(body.expected_length_bytes) || body.expected_length_bytes < 1 || body.expected_length_bytes > STREAM_MAX_TOTAL)) return error("WIN32_HELPER.INPUT_LIMIT_EXCEEDED", "/operation/body/expected_length_bytes", "stream.total.max_bytes");
  if ("candidate_length_bytes" in body && (!Number.isSafeInteger(body.candidate_length_bytes) || body.candidate_length_bytes < 1 || body.candidate_length_bytes > CONTROL_MAX_PAYLOAD)) return error("WIN32_HELPER.INPUT_LIMIT_EXCEEDED", "/operation/body/candidate_length_bytes", "state.stream.total.max_bytes");
  if (expected.name === "launch_managed_core" && body.port_policy !== "ephemeral_ipv4_loopback") return error("WIN32_HELPER.POLICY_REJECTED", "/operation/body/port_policy", "launch.port_policy.exact");
  if (expected.name === "query_or_stop_owned_launch" && !["query", "request_graceful_stop"].includes(body.action)) return error("WIN32_HELPER.POLICY_REJECTED", "/operation/body/action", "stop.action.closed");
  return null;
}

function validateResponse(payload, opcode, context) {
  const allowed = payload.status === "success" ? branchFields("reply_to_request_id", "reply_to_document_id", "status", "result") : branchFields("reply_to_request_id", "reply_to_document_id", "status", "error");
  let issue = firstUnknown(payload, allowed, "", "response.object.closed"); if (issue) return issue;
  issue = validateUuid(payload.reply_to_request_id, "/reply_to_request_id"); if (issue) return issue;
  issue = validateUuid(payload.reply_to_document_id, "/reply_to_document_id"); if (issue) return issue;
  if (context.expectedRequestId && payload.reply_to_request_id !== context.expectedRequestId) return error("WIN32_HELPER.CORRELATION_MISMATCH", "/reply_to_request_id", "response.request_id.exact");
  if (context.expectedDocumentId && payload.reply_to_document_id !== context.expectedDocumentId) return error("WIN32_HELPER.CORRELATION_MISMATCH", "/reply_to_document_id", "response.document_id.exact");
  if (!OP_BY_CODE.has(opcode)) return error("WIN32_HELPER.UNKNOWN_OPCODE", "", "frame.opcode.allowlist");
  if (payload.status === "error") {
    const rawError = payload.error;
    if (rawError && "raw_win32_message" in rawError) return error("WIN32_HELPER.FORBIDDEN_SURFACE", "/error/raw_win32_message", "error.sensitive.raw_os_forbidden");
    issue = firstUnknown(rawError, new Set(["code", "numeric_code", "instance_path", "rule_id", "retryability", "session_action", "operation_effect"]), "/error", "error.object.closed"); if (issue) return issue;
    for (const field of ["code", "numeric_code", "instance_path", "rule_id", "retryability", "session_action", "operation_effect"]) if (!(field in rawError)) return error("WIN32_HELPER.POLICY_REJECTED", `/error/${field}`, "error.field.required");
    if (TYPED_ERROR_NUMBERS.get(rawError.code) !== rawError.numeric_code) return error("WIN32_HELPER.POLICY_REJECTED", "/error/numeric_code", "error.code_number.exact");
    if (!/^[a-z0-9_.]+$/.test(rawError.rule_id) || !["never", "after_user_change", "after_state_change"].includes(rawError.retryability) || !["continue", "close"].includes(rawError.session_action) || !["none", "rolled_back", "owned_job_closed", "published"].includes(rawError.operation_effect)) return error("WIN32_HELPER.POLICY_REJECTED", "/error", "error.shape.closed");
  } else if (payload.status !== "success") {
    return error("WIN32_HELPER.POLICY_REJECTED", "/status", "response.status.closed");
  }
  return null;
}

function validateCancelRequest(payload) {
  const issue = firstUnknown(payload, branchFields("target_request_id"), "", "cancel_request.object.closed");
  return issue ?? validateUuid(payload.target_request_id, "/target_request_id");
}

function validateCancelResult(payload) {
  const issue = firstUnknown(payload, branchFields("target_request_id", "status"), "", "cancel_result.object.closed");
  if (issue) return issue;
  if (!["accepted", "already_requested"].includes(payload.status)) return error("WIN32_HELPER.INVALID_CANCEL", "/status", "cancel.status.closed");
  return validateUuid(payload.target_request_id, "/target_request_id");
}

class SessionTracker {
  constructor({ handshakeComplete = true, sessionId = SIGNED.session } = {}) {
    this.handshakeComplete = handshakeComplete;
    this.sessionId = sessionId;
    this.next = new Map([["caller_to_helper", 1n], ["helper_to_caller", 1n]]);
    this.seenRequestIds = new Set();
  }

  process(buffer, direction) {
    const decoded = decodeControlFrame(buffer, direction, { sessionId: this.sessionId });
    if (decoded.error) return decoded.error;
    const expected = this.next.get(direction);
    if (decoded.header.sequence < expected) return error("WIN32_HELPER.REPLAY_DETECTED", "", "session.sequence.strict_increment");
    if (decoded.header.sequence > expected) return error("WIN32_HELPER.SEQUENCE_VIOLATION", "", "session.sequence.strict_increment");
    this.next.set(direction, expected + 1n);
    if (!this.handshakeComplete && decoded.header.kind !== "client_hello" && decoded.header.kind !== "server_hello") return error("WIN32_HELPER.SESSION_NOT_ESTABLISHED", "/session_id", "session.handshake.complete");
    if (decoded.header.kind === "request") {
      if (this.seenRequestIds.has(decoded.payload.request_id)) return error("WIN32_HELPER.DUPLICATE_REQUEST_ID", "/request_id", "session.request_id.unique");
      this.seenRequestIds.add(decoded.payload.request_id);
    }
    return null;
  }
}

function uuidBytes(uuid) {
  return Buffer.from(uuid.replaceAll("-", ""), "hex");
}

function buildStreamFrame(streamId, sequence, final, bytes) {
  const header = Buffer.alloc(STREAM_HEADER_BYTES);
  header.write("MH3S", 0, 4, "ascii");
  header.writeUInt16LE(STREAM_HEADER_BYTES, 4);
  header.writeUInt16LE(1, 6);
  header.writeUInt32LE(bytes.length, 8);
  header.writeUInt32LE(final ? 1 : 0, 12);
  uuidBytes(streamId).copy(header, 16);
  header.writeUInt32LE(sequence, 32);
  header.writeUInt32LE(0, 36);
  return Buffer.concat([header, bytes]);
}

function createStreamContext(fixture, overrides = {}) {
  return {
    authorized: overrides.authorized ?? true,
    completed: false,
    streamRef: overrides.streamRef ?? fixture.stream_ref,
    expectedTotal: overrides.expectedTotal ?? fixture.authorized_total_bytes,
    expectedSha: overrides.expectedSha ?? fixture.expected_sha256,
    nextSequence: 0,
    total: 0,
    hash: crypto.createHash("sha256")
  };
}

function authorizeStream(expectedTotal) {
  if (!Number.isSafeInteger(expectedTotal) || expectedTotal < 1 || expectedTotal > STREAM_MAX_TOTAL) return error("WIN32_HELPER.INPUT_LIMIT_EXCEEDED", "/expected_length_bytes", "stream.total.max_bytes");
  return null;
}

function evaluateCancelState(state) {
  if (state === "published") return error("WIN32_HELPER.CANCEL_TOO_LATE", "/target_request_id", "cancel.publish_point.terminal");
  if (state === "unknown" || state === "completed") return error("WIN32_HELPER.INVALID_CANCEL", "/target_request_id", "cancel.target.live");
  return state === "live" ? null : error("WIN32_HELPER.INVALID_CANCEL", "/target_request_id", "cancel.target.live");
}

function validateStreamFrame(buffer, context) {
  if (buffer.length < STREAM_HEADER_BYTES) return error("WIN32_HELPER.FRAME_TRUNCATED", "", "stream.header.exact_length");
  if (buffer.subarray(0, 4).toString("ascii") !== "MH3S") return error("WIN32_HELPER.BAD_MAGIC", "", "stream.magic.exact");
  if (buffer.readUInt16LE(4) !== STREAM_HEADER_BYTES || buffer.readUInt16LE(6) !== 1) return error("WIN32_HELPER.INVALID_HEADER", "", "stream.header.exact");
  const chunkLength = buffer.readUInt32LE(8);
  if (chunkLength > STREAM_MAX_CHUNK) return error("WIN32_HELPER.INPUT_LIMIT_EXCEEDED", "", "stream.chunk.max_bytes");
  if (buffer.readUInt32LE(12) & ~1) return error("WIN32_HELPER.RESERVED_BITS_SET", "", "stream.flags.allowed");
  if (buffer.readUInt32LE(36) !== 0) return error("WIN32_HELPER.RESERVED_BITS_SET", "", "stream.reserved.zero");
  if (buffer.length < STREAM_HEADER_BYTES + chunkLength) return error("WIN32_HELPER.FRAME_TRUNCATED", "", "stream.chunk.exact_length");
  if (context?.completed) return error("WIN32_HELPER.STREAM_NOT_AUTHORIZED", "", "stream.authorization.one_use");
  if (!context?.authorized) return error("WIN32_HELPER.STREAM_NOT_AUTHORIZED", "", "stream.authorization.required");
  if (!buffer.subarray(16, 32).equals(uuidBytes(context.streamRef))) return error("WIN32_HELPER.STREAM_NOT_AUTHORIZED", "", "stream.reference.exact");
  const sequence = buffer.readUInt32LE(32);
  if (sequence !== context.nextSequence) return error("WIN32_HELPER.STREAM_SEQUENCE_MISMATCH", "", "stream.sequence.strict_increment");
  const bytes = buffer.subarray(STREAM_HEADER_BYTES, STREAM_HEADER_BYTES + chunkLength);
  context.nextSequence += 1;
  context.total += bytes.length;
  context.hash.update(bytes);
  if (context.total > context.expectedTotal) return error("WIN32_HELPER.STREAM_LENGTH_MISMATCH", "/expected_length_bytes", "stream.total.exact");
  const final = (buffer.readUInt32LE(12) & 1) === 1;
  if (final) {
    if (context.total !== context.expectedTotal) return error("WIN32_HELPER.STREAM_LENGTH_MISMATCH", "/expected_length_bytes", "stream.total.exact");
    const actual = `sha256:${context.hash.digest("hex")}`;
    context.completed = true;
    context.authorized = false;
    if (actual !== context.expectedSha) return error("WIN32_HELPER.STREAM_HASH_MISMATCH", "/expected_sha256", "stream.hash.exact");
  }
  return null;
}

function validById(messages, caseId) {
  const entry = messages.messages.find((item) => item.case_id === caseId);
  if (!entry) fail(`valid fixture not found: ${caseId}`);
  return clone(entry);
}

function requestByOperation(messages, operation) {
  const entry = messages.messages.find((item) => item.payload.operation?.kind === operation);
  if (!entry) fail(`request fixture not found: ${operation}`);
  return clone(entry);
}

function decodedEntry(entry, context = {}) {
  return decodeControlFrame(buildControlFrame(entry.payload, entry.frame), entry.direction, context).error;
}

function mutateEntry(entry, mutate) {
  mutate(entry.payload, entry.frame);
  refreshIntegrity(entry.payload);
  return entry;
}

function runProbe(testCase, messages, streamFixture) {
  const signedClient = () => validById(messages, "signed-client-hello");
  const internalClient = () => validById(messages, "internal-client-hello");
  const signedServer = () => validById(messages, "signed-server-hello");
  const inspect = () => requestByOperation(messages, "inspect_volume_candidate");
  const responseSuccess = () => validById(messages, "response-volume-success");
  switch (testCase.probe) {
    case "bad_control_magic": {
      const frame = buildControlFrame(signedClient().payload, signedClient().frame); frame.write("NOPE", 0, 4, "ascii"); return decodeControlFrame(frame, "caller_to_helper").error;
    }
    case "frame_version_lower":
    case "frame_version_higher": {
      const entry = signedClient(); const frame = buildControlFrame(entry.payload, entry.frame); frame.writeUInt16LE(testCase.probe.endsWith("lower") ? 0 : 2, 6); return decodeControlFrame(frame, entry.direction).error;
    }
    case "control_header_size": { const entry = signedClient(); const frame = buildControlFrame(entry.payload, entry.frame); frame.writeUInt16LE(31, 4); return decodeControlFrame(frame, entry.direction).error; }
    case "unknown_control_kind": { const entry = signedClient(); const frame = buildControlFrame(entry.payload, entry.frame); frame.writeUInt16LE(99, 12); return decodeControlFrame(frame, entry.direction).error; }
    case "wrong_direction_kind": { const entry = signedClient(); return decodeControlFrame(buildControlFrame(entry.payload, entry.frame), "helper_to_caller").error; }
    case "control_reserved_set": { const entry = signedClient(); const frame = buildControlFrame(entry.payload, entry.frame); frame.writeUInt32LE(1, 28); return decodeControlFrame(frame, entry.direction).error; }
    case "control_flags_set": { const entry = signedClient(); const frame = buildControlFrame(entry.payload, entry.frame); frame.writeUInt32LE(1, 16); return decodeControlFrame(frame, entry.direction).error; }
    case "control_payload_oversized": { const entry = signedClient(); const frame = buildControlFrame(entry.payload, entry.frame).subarray(0, CONTROL_HEADER_BYTES); frame.writeUInt32LE(CONTROL_MAX_PAYLOAD + 1, 8); return decodeControlFrame(frame, entry.direction).error; }
    case "truncated_control_header": return decodeControlFrame(Buffer.alloc(12), "caller_to_helper").error;
    case "truncated_control_payload": { const entry = signedClient(); const frame = buildControlFrame(entry.payload, entry.frame); frame.writeUInt32LE(frame.length - CONTROL_HEADER_BYTES + 1, 8); return decodeControlFrame(frame, entry.direction).error; }
    case "stream_on_control_pipe": { const chunk = streamFixture.chunks[0]; return decodeControlFrame(buildStreamFrame(streamFixture.stream_ref, chunk.sequence, chunk.final, Buffer.from(chunk.data_hex, "hex")), "caller_to_helper").error; }
    case "invalid_utf8": return decodeControlFrame(buildRawControlFrame(Buffer.from([0xc3, 0x28]), 1, 0, 0), "caller_to_helper").error;
    case "utf8_bom": { const entry = signedClient(); const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(canonicalJson(entry.payload))]); return decodeControlFrame(buildRawControlFrame(bytes, 1, 0, 0), entry.direction).error; }
    case "duplicate_json_key": return decodeControlFrame(buildRawControlFrame(Buffer.from('{"a":1,"a":2}'), 1, 0, 0), "caller_to_helper").error;
    case "noncanonical_json": { const entry = signedClient(); return decodeControlFrame(buildRawControlFrame(Buffer.from(JSON.stringify(entry.payload, null, 2)), 1, 0, 0), entry.direction).error; }
    case "unpaired_surrogate": return decodeControlFrame(buildRawControlFrame(Buffer.from('{"x":"\\ud800"}'), 1, 0, 0), "caller_to_helper").error;
    case "unknown_wire_contract": return decodedEntry(mutateEntry(signedClient(), (payload) => { payload.contract_id = "minimax-h3-tool.unknown"; }));
    case "unknown_wire_version": return decodedEntry(mutateEntry(signedClient(), (payload) => { payload.schema_version = "1.1.0"; }));
    case "abi_version_lower": return decodedEntry(mutateEntry(signedClient(), (payload) => { payload.abi_version = "0.9.0"; }));
    case "abi_version_higher": return decodedEntry(mutateEntry(signedClient(), (payload) => { payload.abi_version = "2.0.0"; }));
    case "abi_digest_mismatch": return decodedEntry(mutateEntry(signedClient(), (payload) => { payload.abi_manifest_sha256 = "sha256:" + "0".repeat(64); }));
    case "inject_client_field": return decodedEntry(mutateEntry(signedClient(), (payload) => { payload[testCase.field] = clone(testCase.value); }));
    case "request_before_handshake": { const entry = inspect(); const tracker = new SessionTracker({ handshakeComplete: false }); return tracker.process(buildControlFrame(entry.payload, entry.frame), entry.direction); }
    case "wrong_session_id": { const entry = mutateEntry(inspect(), (payload) => { payload.session_id = INTERNAL.session; }); return decodedEntry(entry, { sessionId: SIGNED.session }); }
    case "wrong_session_nonce": { const entry = mutateEntry(signedServer(), (payload) => { payload.caller_nonce_echo = "9".repeat(64); }); return decodedEntry(entry); }
    case "exact_frame_replay": { const entry = inspect(); const frame = buildControlFrame(entry.payload, entry.frame); const tracker = new SessionTracker(); if (tracker.process(frame, entry.direction)) fail("replay setup rejected"); return tracker.process(frame, entry.direction); }
    case "sequence_gap": { const entry = inspect(); entry.frame.sequence = 2; return new SessionTracker().process(buildControlFrame(entry.payload, entry.frame), entry.direction); }
    case "duplicate_request_id":
    case "fresh_sequence_reused_request_id": {
      const first = inspect(); const second = requestByOperation(messages, "validate_path_identity"); second.frame.sequence = 2; second.payload.request_id = first.payload.request_id; refreshIntegrity(second.payload); const tracker = new SessionTracker(); if (tracker.process(buildControlFrame(first.payload, first.frame), first.direction)) fail("duplicate ID setup rejected"); return tracker.process(buildControlFrame(second.payload, second.frame), second.direction);
    }
    case "response_request_mismatch": { const entry = responseSuccess(); return decodedEntry(entry, { expectedRequestId: "31000000-0000-4000-8000-000000000099", expectedDocumentId: entry.payload.reply_to_document_id }); }
    case "response_document_mismatch": { const entry = responseSuccess(); return decodedEntry(entry, { expectedRequestId: entry.payload.reply_to_request_id, expectedDocumentId: "30000000-0000-4000-8000-000000000099" }); }
    case "wrong_opcode_kind_pair": { const entry = inspect(); entry.frame.opcode = 258; return decodedEntry(entry); }
    case "cancel_unknown": return evaluateCancelState("unknown");
    case "cancel_completed": return evaluateCancelState("completed");
    case "cancel_after_publish": return evaluateCancelState("published");
    case "parent_pid_mismatch": return decodedEntry(mutateEntry(signedClient(), (payload) => { payload.caller_identity.parent.pid += 1; }));
    case "parent_creation_mismatch": return decodedEntry(mutateEntry(signedClient(), (payload) => { payload.caller_identity.parent.creation_filetime.low_u32 += 1; }));
    case "wrong_app_build": return decodedEntry(mutateEntry(signedClient(), (payload) => { payload.caller_identity.build_manifest_sha256 = "sha256:" + "1".repeat(64); }));
    case "wrong_app_image_hash": return decodedEntry(mutateEntry(signedClient(), (payload) => { payload.caller_identity.image_sha256 = "sha256:" + "1".repeat(64); }));
    case "helper_build_mismatch": return decodedEntry(mutateEntry(signedClient(), (payload) => { payload.expected_helper.build_manifest_sha256 = "sha256:" + "1".repeat(64); }));
    case "helper_version_mismatch": return decodedEntry(mutateEntry(signedClient(), (payload) => { payload.expected_helper.version = "1.1.0"; }));
    case "helper_hash_mismatch": return decodedEntry(mutateEntry(signedClient(), (payload) => { payload.expected_helper.image_sha256 = "sha256:" + "1".repeat(64); }));
    case "publisher_mismatch": return decodedEntry(mutateEntry(signedClient(), (payload) => { payload.caller_identity.signature.publisher_spki_sha256 = "sha256:" + "1".repeat(64); }));
    case "release_unsigned_signature": return decodedEntry(mutateEntry(signedClient(), (payload) => { payload.caller_identity.signature = { state: "unsigned" }; }));
    case "signing_state_promotion": return decodedEntry(mutateEntry(internalClient(), (payload) => { payload.caller_identity.release_state = "authenticode_release"; }));
    case "unknown_opcode":
    case "forbidden_operation": { const entry = inspect(); if (testCase.kind) entry.payload.operation.kind = testCase.kind; refreshIntegrity(entry.payload); entry.frame.opcode = 0x7fff; return decodedEntry(entry); }
    case "inject_operation_field": { const entry = requestByOperation(messages, testCase.operation); entry.payload.operation.body[testCase.field] = clone(testCase.value); refreshIntegrity(entry.payload); return decodedEntry(entry); }
    case "path_form": { const entry = requestByOperation(messages, "validate_path_identity"); entry.payload.operation.body.candidate_path = testCase.value; refreshIntegrity(entry.payload); return decodedEntry(entry); }
    case "invalid_opaque_ref": { const entry = requestByOperation(messages, testCase.operation); entry.payload.operation.body[testCase.field] = "41000000-0000-4000-8000-000000000099"; refreshIntegrity(entry.payload); return decodedEntry(entry); }
    case "inject_error_field": { const entry = validById(messages, "response-path-error"); entry.payload.error[testCase.field] = clone(testCase.value); refreshIntegrity(entry.payload); return decodedEntry(entry); }
    case "stream_before_authorization": { const chunk = streamFixture.chunks[0]; return validateStreamFrame(buildStreamFrame(streamFixture.stream_ref, 0, false, Buffer.from(chunk.data_hex, "hex")), createStreamContext(streamFixture, { authorized: false })); }
    case "stream_wrong_reference": { const chunk = streamFixture.chunks[0]; return validateStreamFrame(buildStreamFrame("43000000-0000-4000-8000-000000000099", 0, false, Buffer.from(chunk.data_hex, "hex")), createStreamContext(streamFixture)); }
    case "stream_chunk_oversized": { const frame = buildStreamFrame(streamFixture.stream_ref, 0, false, Buffer.from("a")); frame.writeUInt32LE(STREAM_MAX_CHUNK + 1, 8); return validateStreamFrame(frame.subarray(0, STREAM_HEADER_BYTES), createStreamContext(streamFixture)); }
    case "stream_total_oversized": return authorizeStream(STREAM_MAX_TOTAL + 1);
    case "stream_truncated_chunk": { const frame = buildStreamFrame(streamFixture.stream_ref, 0, false, Buffer.from("abc")); frame.writeUInt32LE(4, 8); return validateStreamFrame(frame, createStreamContext(streamFixture)); }
    case "stream_sequence_gap": { const chunk = streamFixture.chunks[0]; return validateStreamFrame(buildStreamFrame(streamFixture.stream_ref, 1, false, Buffer.from(chunk.data_hex, "hex")), createStreamContext(streamFixture)); }
    case "stream_length_underrun": return validateStreamFrame(buildStreamFrame(streamFixture.stream_ref, 0, true, Buffer.from("abc")), createStreamContext(streamFixture));
    case "stream_length_overrun": return validateStreamFrame(buildStreamFrame(streamFixture.stream_ref, 0, true, Buffer.from("abcdefg")), createStreamContext(streamFixture));
    case "stream_hash_mismatch": return validateStreamFrame(buildStreamFrame(streamFixture.stream_ref, 0, true, Buffer.from("abcdef")), createStreamContext(streamFixture, { expectedSha: "sha256:" + "0".repeat(64) }));
    case "stream_replay": {
      const context = createStreamContext(streamFixture);
      for (const chunk of streamFixture.chunks) {
        const issue = validateStreamFrame(buildStreamFrame(streamFixture.stream_ref, chunk.sequence, chunk.final, Buffer.from(chunk.data_hex, "hex")), context);
        if (issue) fail(`stream replay setup rejected: ${canonicalJson(issue)}`);
      }
      const chunk = streamFixture.chunks[1]; return validateStreamFrame(buildStreamFrame(streamFixture.stream_ref, chunk.sequence, chunk.final, Buffer.from(chunk.data_hex, "hex")), context);
    }
    case "control_on_stream_pipe": { const entry = signedClient(); return validateStreamFrame(buildControlFrame(entry.payload, entry.frame), createStreamContext(streamFixture)); }
    default: fail(`${testCase.case_id}: unknown probe ${testCase.probe}`);
  }
}

function validateValidFixtures(messages, streamFixture) {
  if (messages.fixture_version !== "1.0.0" || messages.messages.length !== EXPECTED_MESSAGE_COUNT) fail("valid message fixture count drift");
  const messageIds = new Set();
  for (const entry of messages.messages) {
    const allowed = new Set(["case_id", "direction", "frame", "payload"]);
    const unknown = Object.keys(entry).filter((key) => !allowed.has(key));
    if (unknown.length) fail(`${entry.case_id}: unknown fixture field ${unknown[0]}`);
    if (messageIds.has(entry.case_id)) fail(`duplicate valid case ID ${entry.case_id}`);
    messageIds.add(entry.case_id);
    const decoded = decodeControlFrame(buildControlFrame(entry.payload, entry.frame), entry.direction);
    if (decoded.error) fail(`${entry.case_id}: valid message rejected: ${canonicalJson(decoded.error)}`);
  }
  if (streamFixture.fixture_version !== "1.0.0" || streamFixture.chunks.length !== EXPECTED_STREAM_CHUNK_COUNT) fail("valid stream fixture count drift");
  const context = createStreamContext(streamFixture);
  for (const chunk of streamFixture.chunks) {
    const issue = validateStreamFrame(buildStreamFrame(streamFixture.stream_ref, chunk.sequence, chunk.final, Buffer.from(chunk.data_hex, "hex")), context);
    if (issue) fail(`${chunk.case_id}: valid stream chunk rejected: ${canonicalJson(issue)}`);
  }
  if (!context.completed || context.total !== streamFixture.authorized_total_bytes) fail("valid artifact stream did not complete exactly");
  if (messages.messages.length + streamFixture.chunks.length !== EXPECTED_VALID_COUNT) fail("valid total count drift");
}

function validateHostileFixtures(corpus, messages, streamFixture, errorCodes) {
  if (corpus.fixture_version !== "1.0.0" || corpus.cases.length !== EXPECTED_HOSTILE_COUNT) fail(`hostile case count drift: ${corpus.cases.length}`);
  const allowedFields = new Set(["case_id", "threat_id", "probe", "operation", "field", "value", "kind", "expected"]);
  const ids = new Set();
  const threats = new Set();
  const sorted = [...corpus.cases].sort((a, b) => Buffer.from(a.case_id).compare(Buffer.from(b.case_id)));
  for (const testCase of sorted) {
    for (const key of Object.keys(testCase)) if (!allowedFields.has(key)) fail(`${testCase.case_id}: unknown hostile fixture field ${key}`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(testCase.case_id)) fail(`invalid hostile case ID ${testCase.case_id}`);
    if (ids.has(testCase.case_id)) fail(`duplicate hostile case ID ${testCase.case_id}`);
    ids.add(testCase.case_id);
    if (!REQUIRED_THREATS.has(testCase.threat_id)) fail(`${testCase.case_id}: unknown threat ID ${testCase.threat_id}`);
    threats.add(testCase.threat_id);
    if (!testCase.expected || !errorCodes.has(testCase.expected.code) || typeof testCase.expected.instance_path !== "string" || !/^[a-z0-9_.]+$/.test(testCase.expected.rule_id ?? "")) fail(`${testCase.case_id}: invalid expected error tuple`);
    const actual = runProbe(testCase, messages, streamFixture);
    if (!actual) fail(`${testCase.case_id}: hostile input was accepted`);
    assertExact(actual, testCase.expected, testCase.case_id);
  }
  if (threats.size !== EXPECTED_THREAT_COUNT || threats.size !== REQUIRED_THREATS.size) fail(`threat coverage count drift: ${threats.size}`);
  for (const threat of REQUIRED_THREATS) if (!threats.has(threat)) fail(`missing hostile threat coverage ${threat}`);
  return threats.size;
}

function sanitizeEvidence() {
  const files = [ABI_PATH, TOOLCHAIN_PATH, HEADER_PATH, PROTOCOL_PATH, THREAT_PATH, ADR_PATH, MESSAGES_PATH, STREAM_PATH, HOSTILE_PATH, fileURLToPath(import.meta.url)];
  const privatePath = /[A-Za-z]:[\\/]Users[\\/][^\\/\s"']+/i;
  const currentUser = (process.env.USERNAME ?? "").trim().toLowerCase();
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    if (privatePath.test(text)) fail(`private absolute path in ${path.basename(file)}`);
    if (currentUser.length >= 3 && text.toLowerCase().includes(currentUser)) fail(`current username in ${path.basename(file)}`);
  }
  const nativeFiles = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full); else nativeFiles.push(full);
    }
  };
  walk(path.join(ROOT, "native/win32-helper"));
  for (const file of nativeFiles) if (/\.(?:c|cc|cpp|cxx|asm|exe|dll|obj|lib|pdb)$/i.test(file)) fail(`implementation/binary forbidden in P1-NAT-001: ${path.basename(file)}`);
  return files.length;
}

function run() {
  const abi = readJson(ABI_PATH);
  const toolchain = readJson(TOOLCHAIN_PATH);
  const messages = readJson(MESSAGES_PATH);
  const streamFixture = readJson(STREAM_PATH);
  const corpus = readJson(HOSTILE_PATH);
  const headerText = fs.readFileSync(HEADER_PATH, "utf8");
  const specResult = lintSpec(abi, toolchain, headerText);
  TYPED_ERROR_NUMBERS = specResult.errorNumbers;
  validateValidFixtures(messages, streamFixture);
  const threatCount = validateHostileFixtures(corpus, messages, streamFixture, specResult.errorCodes);
  const sanitizedCount = sanitizeEvidence();
  console.log(`PASS ABI ${specResult.abiDigest}`);
  console.log(`PASS toolchain ${specResult.toolchainDigest} state=frozen_plan_unmaterialized target=x64`);
  console.log("PASS header mirrors control=32 stream=40 operations=8");
  console.log(`PASS valid messages=${messages.messages.length} stream_chunks=${streamFixture.chunks.length}`);
  console.log(`PASS hostile cases=${corpus.cases.length} threats=${threatCount}`);
  console.log(`PASS forbidden operation intersection=${specResult.forbiddenIntersection.length}`);
  console.log(`PASS sanitized public evidence files=${sanitizedCount}`);
  console.log(`SUMMARY abi_sha256=${specResult.abiDigest} toolchain_sha256=${specResult.toolchainDigest} families=8 wire_opcodes=8 valid=${EXPECTED_VALID_COUNT} hostile=${EXPECTED_HOSTILE_COUNT} threats=${EXPECTED_THREAT_COUNT} forbidden_operations=0`);
}

run();
