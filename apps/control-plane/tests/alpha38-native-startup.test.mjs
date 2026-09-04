import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test, { after } from "node:test";

import { build } from "esbuild";

const projectRoot = resolve(import.meta.dirname, "..");
const bundleRoot = await mkdtemp(resolve(tmpdir(), "relay-alpha38-native-"));
const bundlePath = resolve(bundleRoot, "native-helper-client.mjs");
await build({
  entryPoints: [resolve(projectRoot, "src", "main", "services", "native-helper-client.ts")],
  outfile: bundlePath,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  legalComments: "none",
  sourcemap: false
});
const native = await import(`${pathToFileURL(bundlePath).href}?fixture=alpha38`);

after(async () => rm(bundleRoot, { recursive: true, force: true }));

const canonicalize = (value) => {
  if (value === null || ["boolean", "number", "string"].includes(typeof value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
};

const frame = (kind, opcode, sequence, payload, canonical = true) => {
  const text = canonical ? canonicalize(payload) : JSON.stringify(payload, null, 2);
  const bytes = Buffer.from(text, "utf8");
  const header = Buffer.alloc(32);
  header.write("MH3W", 0, 4, "ascii");
  header.writeUInt16LE(32, 4);
  header.writeUInt16LE(1, 6);
  header.writeUInt32LE(bytes.length, 8);
  header.writeUInt16LE(kind, 12);
  header.writeUInt16LE(opcode, 14);
  header.writeBigUInt64LE(BigInt(sequence), 20);
  return Buffer.concat([header, bytes]);
};

const decodeFrames = (bytes) => {
  const values = [];
  let offset = 0;
  while (offset < bytes.length) {
    const length = bytes.readUInt32LE(offset + 8);
    values.push({
      kind: bytes.readUInt16LE(offset + 12),
      opcode: bytes.readUInt16LE(offset + 14),
      sequence: Number(bytes.readBigUInt64LE(offset + 20)),
      payload: JSON.parse(bytes.toString("utf8", offset + 32, offset + 32 + length))
    });
    offset += 32 + length;
  }
  return values;
};

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const helperBytes = Buffer.from("MZ relay-winbroker alpha38 fixture", "utf8");
const profileBytes = Buffer.from(`${JSON.stringify({
  schema_version: 1,
  profile_id: "relay.win32.path-inspection",
  profile_version: "1.0.0",
  binary: "relay-winbroker.exe",
  architecture: "x64",
  fixed_argument_array: ["--capability-profile=path-inspection-v1"],
  transport: { network: false, shell: false },
  enabled_operations: [{ opcode: 257 }, { opcode: 258 }]
})}\n`, "utf8");

const identityBytes = (binaryHash = sha256(helperBytes), profileHash = sha256(profileBytes)) => Buffer.from(`${JSON.stringify({
  schema_version: 1,
  product: "relay-winbroker",
  capability_profile: {
    id: "relay.win32.path-inspection",
    version: "1.0.0",
    sha256: profileHash,
    enabled_opcodes: [257, 258]
  },
  protocol_argument: "--capability-profile=path-inspection-v1",
  architecture: "x64",
  binary: { filename: "relay-winbroker.exe", bytes: helperBytes.length, sha256: binaryHash }
})}\n`, "utf8");

const successStdout = (opcode, payload, canonical = true) => Buffer.concat([
  frame(2, 0, 0, {
    build_state: "internal_unsigned",
    enabled_opcodes: [257, 258],
    message_kind: "server_hello",
    profile_id: "relay.win32.path-inspection",
    profile_version: "1.0.0",
    status: "ready"
  }, canonical),
  frame(4, opcode, 1, payload, canonical)
]);

function fixtureDependencies(overrides = {}) {
  const files = new Map([
    ["relay-winbroker.exe", helperBytes],
    ["capability-profile.v1.json", profileBytes],
    ["startup-native-build-manifest.json", identityBytes()]
  ]);
  const calls = [];
  const readCalls = [];
  const hashCalls = [];
  const identities = new Map([
    ["relay-winbroker.exe", { dev: 7, ino: 101, mtimeMs: 1_000, ctimeMs: 1_000 }],
    ["capability-profile.v1.json", { dev: 7, ino: 102, mtimeMs: 1_000, ctimeMs: 1_000 }],
    ["startup-native-build-manifest.json", { dev: 7, ino: 103, mtimeMs: 1_000, ctimeMs: 1_000 }]
  ]);
  const dependencies = {
    platform: "win32",
    architecture: "x64",
    osRelease: "10.0.22631",
    lstat(path) {
      const bytes = files.get(basename(path));
      if (bytes === undefined) throw Object.assign(new Error("not found"), { code: "ENOENT" });
      return {
        size: bytes.length,
        ...identities.get(basename(path)),
        isFile: () => true,
        isSymbolicLink: () => false
      };
    },
    readFile(path) {
      const bytes = files.get(basename(path));
      if (bytes === undefined) throw Object.assign(new Error("not found"), { code: "ENOENT" });
      readCalls.push(path);
      return bytes;
    },
    hashBytes(bytes) {
      hashCalls.push(bytes);
      return sha256(bytes);
    },
    spawn(executablePath, arguments_, configuration) {
      const inputFrames = decodeFrames(configuration.input);
      calls.push({ executablePath, arguments_, configuration, inputFrames });
      const opcode = inputFrames[1].opcode;
      const payload = opcode === 258
        ? { canonicalized: true, exists: true, reparse: false, status: "ok" }
        : { drive_type: 3, filesystem: "ntfs", fixed_local: true, status: "ok", supported: true };
      return { status: 0, signal: null, stdout: successStdout(opcode, payload), stderr: Buffer.alloc(0) };
    },
    ...overrides
  };
  return { dependencies, files, identities, calls, readCalls, hashCalls };
}

const baseOptions = (dependencies) => ({
  resourcesPath: "R:\\RelayResources",
  isPackaged: true,
  appVersion: "0.1.0-alpha.38",
  userDataPath: "\\\\vmware-host\\Shared Folders\\Users\\测试用户\\AppData\\Relay",
  dependencies
});

const assertCode = (action, code) => assert.throws(action, (error) => {
  assert.equal(error.code, code);
  assert.equal(error.message, code);
  assert.doesNotMatch(JSON.stringify(error), /测试用户|vmware-host|RelayResources/u);
  return true;
});

test("startup ignores redirected userData and probes only the helper path with opcode 258", () => {
  const fixture = fixtureDependencies();
  const result = native.verifyNativeHelperAtStartup(baseOptions(fixture.dependencies));
  assert.equal(result.helperPathVerified, true);
  assert.deepEqual(result.enabledOpcodes, [257, 258]);
  assert.equal(fixture.calls.length, 1);
  const request = fixture.calls[0];
  assert.deepEqual(request.arguments_, ["--capability-profile=path-inspection-v1"]);
  assert.deepEqual(request.inputFrames.map(({ opcode }) => opcode), [0, 258, 0]);
  assert.equal(canonicalize(request.inputFrames).includes("runtime_app_data"), false);
  assert.equal(canonicalize(request.inputFrames).includes("require_fixed_local"), false);
  assert.equal(canonicalize(request.inputFrames).includes("vmware-host"), false);
});

test("unchanged startup self-check and preparation are reused while every dataRoot inspection remains opcode 257", () => {
  const fixture = fixtureDependencies();
  const first = native.verifyNativeHelperAtStartup(baseOptions(fixture.dependencies));
  const second = native.verifyNativeHelperAtStartup(baseOptions(fixture.dependencies));
  assert.deepEqual(second, first);
  native.inspectNativeDataRoot({
    ...baseOptions(fixture.dependencies),
    dataRootPath: "D:\\MiniMaxH3"
  });
  native.inspectNativeDataRoot({
    ...baseOptions(fixture.dependencies),
    dataRootPath: "D:\\MiniMaxH3"
  });
  assert.equal(fixture.calls.length, 3, "258 may be reused, but distinct 257 checks are never cached or merged");
  assert.deepEqual(fixture.calls.map(({ inputFrames }) => inputFrames[1].opcode), [258, 257, 257]);
  assert.equal(fixture.readCalls.length, 3, "helper/profile/manifest bytes are hashed only once");
  assert.equal(fixture.hashCalls.length, 2);
});

test("slow startup still reuses the verified helper preparation without a wall-clock expiry", () => {
  const fixture = fixtureDependencies();
  native.verifyNativeHelperAtStartup(baseOptions(fixture.dependencies));
  const originalNow = Date.now;
  Date.now = () => originalNow() + 60_000;
  try {
    native.inspectNativeDataRoot({
      ...baseOptions(fixture.dependencies),
      dataRootPath: "D:\\MiniMaxH3"
    });
  } finally {
    Date.now = originalNow;
  }
  assert.deepEqual(fixture.calls.map(({ inputFrames }) => inputFrames[1].opcode), [258, 257]);
  assert.equal(fixture.readCalls.length, 3, "slow pointer/dataRoot work must not trigger a second preparation");
  assert.equal(fixture.hashCalls.length, 2);
});

test("helper preparation cache is discarded when an artifact identity changes", () => {
  const fixture = fixtureDependencies();
  native.verifyNativeHelperAtStartup(baseOptions(fixture.dependencies));
  fixture.identities.set("relay-winbroker.exe", {
    ...fixture.identities.get("relay-winbroker.exe"),
    ino: 999
  });
  native.inspectNativeDataRoot({
    ...baseOptions(fixture.dependencies),
    dataRootPath: "D:\\MiniMaxH3"
  });
  assert.equal(fixture.readCalls.length, 6, "changed identity forces complete integrity validation");
  assert.equal(fixture.hashCalls.length, 4);
});

test("changed artifact identity invalidates the cached opcode 258 self-check", () => {
  const fixture = fixtureDependencies();
  native.verifyNativeHelperAtStartup(baseOptions(fixture.dependencies));
  fixture.identities.set("relay-winbroker.exe", {
    ...fixture.identities.get("relay-winbroker.exe"),
    ino: 1_001
  });
  native.verifyNativeHelperAtStartup(baseOptions(fixture.dependencies));
  assert.deepEqual(fixture.calls.map(({ inputFrames }) => inputFrames[1].opcode), [258, 258]);
  assert.equal(fixture.readCalls.length, 6);
  assert.equal(fixture.hashCalls.length, 4);
});

test("helper/profile presence, block, timeout and integrity failures use stable codes", () => {
  {
    const fixture = fixtureDependencies({ lstat: () => { throw Object.assign(new Error(), { code: "ENOENT" }); } });
    assertCode(() => native.verifyNativeHelperAtStartup(baseOptions(fixture.dependencies)), "NATIVE_HELPER_MISSING");
  }
  for (const blockedCode of ["EACCES", "EPERM"]) {
    const fixture = fixtureDependencies({ spawn: () => ({ status: null, error: { code: blockedCode } }) });
    assertCode(() => native.verifyNativeHelperAtStartup(baseOptions(fixture.dependencies)), "NATIVE_HELPER_BLOCKED");
  }
  {
    const fixture = fixtureDependencies({ spawn: () => ({ status: null, signal: "SIGTERM", error: { code: "ETIMEDOUT" } }) });
    assertCode(() => native.verifyNativeHelperAtStartup(baseOptions(fixture.dependencies)), "NATIVE_HELPER_TIMEOUT");
  }
  {
    const fixture = fixtureDependencies();
    fixture.files.set("relay-winbroker.exe", Buffer.from("replaced helper"));
    assertCode(() => native.verifyNativeHelperAtStartup(baseOptions(fixture.dependencies)), "NATIVE_HELPER_CORRUPTED");
  }
});

test("malformed or mismatched capability profiles fail as PROFILE_MISMATCH", () => {
  for (const bytes of [Buffer.from("{"), Buffer.from(JSON.stringify({ profile_id: "wrong" }))]) {
    const fixture = fixtureDependencies();
    fixture.files.set("capability-profile.v1.json", bytes);
    assertCode(
      () => native.verifyNativeHelperAtStartup(baseOptions(fixture.dependencies)),
      "NATIVE_HELPER_PROFILE_MISMATCH"
    );
  }
});

test("non-zero status, malformed frames and non-canonical payloads are PROTOCOL_INVALID", () => {
  for (const spawn of [
    () => ({ status: 28, signal: null, stdout: Buffer.alloc(0) }),
    () => ({ status: 0, signal: null, stdout: Buffer.from("broken") }),
    () => ({
      status: 0,
      signal: null,
      stdout: successStdout(258, { canonicalized: true, exists: true, reparse: false, status: "ok" }, false)
    })
  ]) {
    const fixture = fixtureDependencies({ spawn });
    assertCode(
      () => native.verifyNativeHelperAtStartup(baseOptions(fixture.dependencies)),
      "NATIVE_HELPER_PROTOCOL_INVALID"
    );
  }
});

test("Windows 10/11 x64 is admitted while unsupported OS and architecture fail closed", () => {
  for (const osRelease of ["10.0.19045", "10.0.26100"]) {
    const fixture = fixtureDependencies({ osRelease });
    assert.equal(native.verifyNativeHelperAtStartup(baseOptions(fixture.dependencies)).helperPathVerified, true);
  }
  {
    const fixture = fixtureDependencies({ platform: "linux", osRelease: "6.8" });
    assertCode(() => native.verifyNativeHelperAtStartup(baseOptions(fixture.dependencies)), "UNSUPPORTED_OS");
  }
  {
    const fixture = fixtureDependencies({ architecture: "arm64" });
    assertCode(() => native.verifyNativeHelperAtStartup(baseOptions(fixture.dependencies)), "UNSUPPORTED_ARCH");
  }
});

test("dataRoot inspection is a separate opcode 257 fixed-local NTFS operation", () => {
  const fixture = fixtureDependencies();
  const result = native.inspectNativeDataRoot({
    ...baseOptions(fixture.dependencies),
    dataRootPath: "D:\\MiniMaxH3"
  });
  assert.deepEqual(
    { supported: result.supported, fixedLocal: result.fixedLocal, filesystem: result.filesystem, driveType: result.driveType },
    { supported: true, fixedLocal: true, filesystem: "ntfs", driveType: 3 }
  );
  const request = fixture.calls[0].inputFrames[1];
  assert.equal(request.opcode, 257);
  assert.deepEqual(request.payload, {
    candidate_kind: "relay_data_root",
    candidate_path: "D:\\MiniMaxH3",
    require_fixed_local: true,
    required_filesystem: "ntfs"
  });
});

test("dataRoot unsupported, unavailable and permission responses use path-free recovery codes", () => {
  const cases = [
    {
      payload: { drive_type: 2, filesystem: "exfat", fixed_local: false, status: "ok", supported: false },
      code: "DATA_ROOT_NOT_FIXED_NTFS"
    },
    {
      payload: { code: "RELAY_NATIVE.VOLUME_UNSUPPORTED", reason: "profile.inspect.volume-information", status: "error" },
      code: "DATA_ROOT_UNAVAILABLE"
    },
    {
      payload: { code: "RELAY_NATIVE.PERMISSION_DENIED", reason: "profile.inspect.access", status: "error" },
      code: "DATA_ROOT_PERMISSION_DENIED"
    }
  ];
  for (const { payload, code } of cases) {
    const fixture = fixtureDependencies({
      spawn: (_path, _args, configuration) => ({
        status: 0,
        signal: null,
        stdout: successStdout(257, payload)
      })
    });
    assertCode(() => native.inspectNativeDataRoot({
      ...baseOptions(fixture.dependencies),
      dataRootPath: "Z:\\private\\用户"
    }), code);
  }
});

test("messages, actions and diagnostic formatting are stable, Chinese and privacy-minimal", () => {
  const expectedMessages = new Map([
    ["NATIVE_HELPER_MISSING", "Relay 本机组件缺失"],
    ["NATIVE_HELPER_BLOCKED", "Windows 安全策略阻止"],
    ["NATIVE_HELPER_PROFILE_MISMATCH", "版本不一致"],
    ["NATIVE_HELPER_CORRUPTED", "校验失败"],
    ["NATIVE_HELPER_TIMEOUT", "启动超时"],
    ["NATIVE_HELPER_PROTOCOL_INVALID", "无效响应"],
    ["UNSUPPORTED_OS", "Windows 10 和 Windows 11"],
    ["UNSUPPORTED_ARCH", "Windows x64"]
  ]);
  for (const [code, text] of expectedMessages) {
    assert.match(native.nativeHelperStartupMessage(code), new RegExp(text));
    assert.ok(native.nativeHelperStartupActions(code).includes("open_diagnostics"));
  }
  const diagnostic = native.createStartupDiagnostic({
    relayVersion: "0.1.0-alpha.38 Q:\\PrivateProfile token=secret",
    platform: "win32",
    osRelease: "10.0.22631 Q:\\测试资料",
    architecture: "x64",
    stage: "data_root",
    code: "DATA_ROOT_NOT_FIXED_NTFS",
    helperExists: true,
    profileMatches: true,
    integrityVerified: true,
    dataRootVolume: { fixedLocal: false, filesystem: "exFAT", driveType: 2 }
  });
  const formatted = native.formatStartupDiagnostic(diagnostic);
  assert.match(formatted, /relay=0\.1\.0-alpha\.38/u);
  assert.match(formatted, /dataRoot\.fs=exfat/u);
  assert.doesNotMatch(formatted, /PrivateProfile|测试资料|token=secret|Q:\\/u);
});

test("native build publishes the trusted identity manifest inside app.asar scope", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(resolve(projectRoot, "scripts", "build-native-helper.mjs"), "utf8")
  );
  assert.match(source, /distMainServicesRoot/u);
  assert.match(source, /startup-native-build-manifest\.json/u);
  assert.match(source, /writeFileAtomically\([\s\S]*distMainServicesRoot/u);
});
