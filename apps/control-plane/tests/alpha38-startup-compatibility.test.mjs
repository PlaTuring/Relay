import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const projectRoot = path.resolve(import.meta.dirname, "..");
const read = (relativePath) => readFile(path.resolve(projectRoot, relativePath), "utf8");

async function loadTypeScriptModule(context, relativePath) {
  const buildRoot = await mkdtemp(path.join(os.tmpdir(), "relay-alpha38-startup-"));
  context.after(() => rm(buildRoot, { recursive: true, force: true }));
  const outfile = path.join(buildRoot, `${path.basename(relativePath, ".ts")}-${Math.random().toString(16).slice(2)}.mjs`);
  await build({
    entryPoints: [path.join(projectRoot, relativePath)],
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "silent"
  });
  return import(`${new URL(`file:///${outfile.replaceAll("\\", "/")}`).href}?fixture=${Date.now()}`);
}

function volume(overrides = {}) {
  return Object.freeze({
    exists: true,
    isDirectory: true,
    fixedLocal: true,
    filesystem: "NTFS",
    driveType: "fixed_local",
    readable: true,
    writable: true,
    ...overrides
  });
}

function assertCodedFailure(error, expectedCode, expectedMessage) {
  assert.equal(error?.code, expectedCode);
  assert.equal(error?.message, expectedMessage);
  return true;
}

function canonicalize(value) {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

function nativeFrame(kind, opcode, sequence, payload) {
  const payloadBytes = Buffer.from(canonicalize(payload), "utf8");
  const header = Buffer.alloc(32);
  header.write("MH3W", 0, 4, "ascii");
  header.writeUInt16LE(32, 4);
  header.writeUInt16LE(1, 6);
  header.writeUInt32LE(payloadBytes.length, 8);
  header.writeUInt16LE(kind, 12);
  header.writeUInt16LE(opcode, 14);
  header.writeUInt32LE(0, 16);
  header.writeBigUInt64LE(BigInt(sequence), 20);
  header.writeUInt32LE(0, 28);
  return Buffer.concat([header, payloadBytes]);
}

function nativeFixture(overrides = {}) {
  const hashBytes = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const helper = Buffer.from("MZ-relay-winbroker-fixture", "utf8");
  const profile = Buffer.from(JSON.stringify({
    schema_version: 1,
    profile_id: "relay.win32.path-inspection",
    profile_version: "1.0.0",
    binary: "relay-winbroker.exe",
    architecture: "x64",
    fixed_argument_array: ["--capability-profile=path-inspection-v1"],
    enabled_operations: [{ opcode: 257 }, { opcode: 258 }],
    transport: { network: false, shell: false }
  }), "utf8");
  const manifest = Buffer.from(JSON.stringify({
    schema_version: 1,
    product: "relay-winbroker",
    protocol_argument: "--capability-profile=path-inspection-v1",
    architecture: "x64",
    capability_profile: {
      id: "relay.win32.path-inspection",
      version: "1.0.0",
      enabled_opcodes: [257, 258],
      sha256: hashBytes(profile)
    },
    binary: {
      filename: "relay-winbroker.exe",
      sha256: hashBytes(helper),
      bytes: helper.length
    }
  }), "utf8");
  const responses = Buffer.concat([
    nativeFrame(2, 0, 0, {
      enabled_opcodes: [257, 258],
      message_kind: "server_hello",
      profile_id: "relay.win32.path-inspection",
      profile_version: "1.0.0",
      status: "ready"
    }),
    nativeFrame(4, 258, 1, {
      canonicalized: true,
      exists: true,
      reparse: false,
      status: "ok"
    })
  ]);
  const files = new Map([
    ["relay-winbroker.exe", helper],
    ["capability-profile.v1.json", profile],
    ["startup-native-build-manifest.json", manifest]
  ]);
  const dependencies = {
    platform: "win32",
    architecture: "x64",
    osRelease: "10.0.26100",
    lstat(filePath) {
      const bytes = files.get(path.basename(filePath));
      if (bytes === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return { size: bytes.length, isFile: () => true, isSymbolicLink: () => false };
    },
    readFile(filePath) {
      const bytes = files.get(path.basename(filePath));
      if (bytes === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return bytes;
    },
    hashBytes,
    spawn: () => ({ status: 0, signal: null, stdout: responses, stderr: Buffer.alloc(0) }),
    ...overrides
  };
  return { dependencies, files, responses };
}

function verifyFixture(native, fixture, other = {}) {
  return native.verifyNativeHelperAtStartup({
    resourcesPath: "C:\\Relay\\resources",
    isPackaged: true,
    appVersion: "0.1.0-alpha.38",
    dependencies: fixture.dependencies,
    ...other
  });
}

test("redirected or VM-style Electron userData is pointer-only and is never subjected to the fixed-NTFS startup probe", async (context) => {
  const dataRoot = await loadTypeScriptModule(context, "src/main/services/data-root.ts");
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "relay-alpha38-redirected-user-"));
  context.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const regularUserData = path.join(fixtureRoot, "Local Profile", "AppData", "Roaming", "Relay");
  const redirectedUserData = path.join(fixtureRoot, "VM Shared Profile", "用户 Ω", "AppData", "Roaming", "Relay");
  const businessDataRoot = path.join(fixtureRoot, "fixed-ntfs-data", "MiniMaxH3");
  await Promise.all([
    mkdir(regularUserData, { recursive: true }),
    mkdir(redirectedUserData, { recursive: true }),
    mkdir(businessDataRoot, { recursive: true })
  ]);

  const { readdir } = await import("node:fs/promises");
  for (const userData of [regularUserData, redirectedUserData]) {
    await dataRoot.saveDataRootPointer(userData, businessDataRoot, new Date("2026-08-31T00:00:00.000Z"));
    const pointer = await dataRoot.loadDataRootPointer(userData, { strict: true });
    assert.equal(pointer?.dataRoot, path.resolve(businessDataRoot));
    assert.deepEqual((await readdir(userData)).sort(), ["data-root.pointer.json"]);
  }

  const [nativeSource, mainSource] = await Promise.all([
    read("src/main/services/native-helper-client.ts"),
    read("src/main/main.ts")
  ]);
  assert.doesNotMatch(nativeSource, /candidate_kind:\s*"runtime_app_data"|candidate_path:\s*options\.userDataPath/u);
  assert.doesNotMatch(mainSource, /verifyNativeHelperAtStartup\(\{[\s\S]{0,300}\buserDataPath\b/u);
});

test("dataRoot volume policy remains fail-closed for large managed data without a silent C fallback", async (context) => {
  const [dataRoot, startupDataRoot] = await Promise.all([
    loadTypeScriptModule(context, "src/main/services/data-root.ts"),
    loadTypeScriptModule(context, "src/main/startup-data-root.ts")
  ]);
  assert.equal(dataRoot.classifyDataRootVolume(volume()), null);
  for (const filesystem of ["FAT32", "exFAT"]) {
    assert.equal(dataRoot.classifyDataRootVolume(volume({ filesystem })), "DATA_ROOT_NOT_FIXED_NTFS");
  }
  assert.equal(dataRoot.classifyDataRootVolume(volume({ fixedLocal: false, driveType: "network" })), "DATA_ROOT_NOT_FIXED_NTFS");
  assert.equal(dataRoot.classifyDataRootVolume(volume({ fixedLocal: false, driveType: "removable" })), "DATA_ROOT_NOT_FIXED_NTFS");
  assert.equal(dataRoot.classifyDataRootVolume(volume({ exists: false, isDirectory: false })), "DATA_ROOT_UNAVAILABLE");
  assert.equal(dataRoot.classifyDataRootVolume(volume({ writable: false })), "DATA_ROOT_PERMISSION_DENIED");

  assert.equal(startupDataRoot.chooseInitialDataRootCandidate({
    legacySetup: null,
    userDataPath: "R:\\RedirectedProfile\\Relay",
    headlessMode: false,
    dDriveAvailable: false
  }), null, "production startup must not silently place managed data on C");
  assert.equal(startupDataRoot.chooseInitialDataRootCandidate({
    legacySetup: null,
    userDataPath: "R:\\RedirectedProfile\\Relay",
    headlessMode: false,
    dDriveAvailable: true
  }), "D:\\MiniMaxH3");
});

test("dataRoot and pointer failures expose stable codes and exact user-facing Chinese reasons", async (context) => {
  const dataRoot = await loadTypeScriptModule(context, "src/main/services/data-root.ts");
  const cases = [
    ["DATA_ROOT_UNAVAILABLE", "Relay 数据目录不存在或当前不可访问。"],
    ["DATA_ROOT_NOT_FIXED_NTFS", "Relay 数据目录必须位于本机固定 NTFS 磁盘，请重新选择目录。"],
    ["DATA_ROOT_PERMISSION_DENIED", "Relay 没有权限读写所选数据目录，请选择其他目录或检查权限。"],
    ["POINTER_READ_FAILED", "Relay 无法读取数据目录位置配置。"],
    ["POINTER_WRITE_FAILED", "Relay 无法保存数据目录位置配置。"]
  ];
  for (const [code, message] of cases) {
    assertCodedFailure(new dataRoot.DataRootFailure(code), code, message);
  }

  await assert.rejects(
    dataRoot.validateDataRootLocation("D:\\MiniMaxH3", async () => { throw Object.assign(new Error("blocked"), { code: "EACCES" }); }),
    (error) => assertCodedFailure(error, "DATA_ROOT_PERMISSION_DENIED", cases[2][1])
  );
  await assert.rejects(
    dataRoot.validateDataRootLocation("D:\\MiniMaxH3", async () => volume({ filesystem: "exFAT" })),
    (error) => assertCodedFailure(error, "DATA_ROOT_NOT_FIXED_NTFS", cases[1][1])
  );

  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "relay-alpha38-pointer-bad-"));
  context.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  await writeFile(path.join(fixtureRoot, "data-root.pointer.json"), "{bad json", "utf8");
  await assert.rejects(
    dataRoot.loadDataRootPointer(fixtureRoot, { strict: true }),
    (error) => assertCodedFailure(error, "POINTER_READ_FAILED", cases[3][1])
  );
});

test("native helper failure taxonomy provides exact reasons and only real recovery actions", async (context) => {
  const native = await loadTypeScriptModule(context, "src/main/services/native-helper-client.ts");
  const expected = new Map([
    ["NATIVE_HELPER_MISSING", "Relay 本机组件缺失，可能安装不完整或被安全软件隔离。"],
    ["NATIVE_HELPER_BLOCKED", "Relay 本机组件被 Windows 安全策略阻止，请检查 Defender、AppLocker 或企业安全策略。"],
    ["NATIVE_HELPER_PROFILE_MISMATCH", "Relay 主程序与本机组件版本不一致，请使用完整安装包修复安装。"],
    ["NATIVE_HELPER_CORRUPTED", "Relay 本机组件校验失败，文件可能损坏或被替换。"],
    ["NATIVE_HELPER_TIMEOUT", "Relay 本机组件启动超时，请检查安全软件或系统策略。"],
    ["NATIVE_HELPER_PROTOCOL_INVALID", "Relay 本机组件返回了无效响应。"],
    ["UNSUPPORTED_OS", "Relay 当前支持 Windows 10 和 Windows 11。"],
    ["UNSUPPORTED_ARCH", "Relay 当前仅提供 Windows x64 版本；ARM64 尚未提供原生版本。"]
  ]);
  for (const [code, message] of expected) {
    assert.equal(native.nativeHelperStartupMessage(code), message, code);
    const actions = native.nativeHelperStartupActions(code);
    assert.ok(Array.isArray(actions) && actions.length >= 1, `${code} must provide a real action`);
    assert.ok(actions.every((action) => ["retry", "open_diagnostics", "open_data_root_settings", "exit"].includes(action)), `${code} exposes an unknown or fake action`);
  }
  assert.notEqual(native.nativeHelperStartupMessage("NATIVE_HELPER_MISSING"), native.nativeHelperStartupMessage("NATIVE_HELPER_TIMEOUT"));
});

test("Win10/11 x64 is supported while unsupported OS and architecture fail with stable codes", async (context) => {
  const native = await loadTypeScriptModule(context, "src/main/services/native-helper-client.ts");
  for (const release of ["10.0.19045", "10.0.26100"]) {
    const fixture = nativeFixture({ osRelease: release });
    assert.equal(verifyFixture(native, fixture).helperPathVerified, true);
  }
  for (const [overrides, expectedCode] of [
    [{ platform: "linux", architecture: "x64", osRelease: "6.8.0" }, "UNSUPPORTED_OS"],
    [{ platform: "darwin", architecture: "arm64", osRelease: "24.0.0" }, "UNSUPPORTED_OS"],
    [{ platform: "win32", architecture: "arm64", osRelease: "10.0.26100" }, "UNSUPPORTED_ARCH"],
    [{ platform: "win32", architecture: "ia32", osRelease: "10.0.19045" }, "UNSUPPORTED_ARCH"]
  ]) {
    const fixture = nativeFixture(overrides);
    assert.throws(() => verifyFixture(native, fixture), (error) => error?.code === expectedCode);
  }
});

test("injectable native helper fixtures classify missing, blocked, timeout, profile mismatch, corrupted and malformed responses", async (context) => {
  const native = await loadTypeScriptModule(context, "src/main/services/native-helper-client.ts");
  const missing = nativeFixture({ lstat: () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); } });
  assert.throws(() => verifyFixture(native, missing), (error) => error?.code === "NATIVE_HELPER_MISSING");
  for (const code of ["EACCES", "EPERM"]) {
    const blocked = nativeFixture({ spawn: () => ({ status: null, error: { code }, stdout: Buffer.alloc(0) }) });
    assert.throws(() => verifyFixture(native, blocked), (error) => error?.code === "NATIVE_HELPER_BLOCKED");
  }
  const timeout = nativeFixture({ spawn: () => ({ status: null, signal: "SIGTERM", error: { code: "ETIMEDOUT" }, stdout: Buffer.alloc(0) }) });
  assert.throws(() => verifyFixture(native, timeout), (error) => error?.code === "NATIVE_HELPER_TIMEOUT");

  const profileMismatch = nativeFixture();
  profileMismatch.files.set("capability-profile.v1.json", Buffer.from("{}", "utf8"));
  assert.throws(() => verifyFixture(native, profileMismatch), (error) => error?.code === "NATIVE_HELPER_PROFILE_MISMATCH");

  const corrupted = nativeFixture();
  corrupted.files.set("relay-winbroker.exe", Buffer.from("MZ-replaced", "utf8"));
  assert.throws(() => verifyFixture(native, corrupted), (error) => error?.code === "NATIVE_HELPER_CORRUPTED");

  const malformed = nativeFixture({ spawn: () => ({ status: 0, signal: null, stdout: Buffer.from("not-a-frame", "utf8") }) });
  assert.throws(() => verifyFixture(native, malformed), (error) => error?.code === "NATIVE_HELPER_PROTOCOL_INVALID");
});

test("startup diagnostics are path-free, privacy-minimized and retain the required compatibility evidence", async (context) => {
  const native = await loadTypeScriptModule(context, "src/main/services/native-helper-client.ts");
  assert.equal(typeof native.createStartupDiagnostic, "function", "missing safe startup diagnostic formatter");
  const diagnostic = native.createStartupDiagnostic({
    relayVersion: "0.1.0-alpha.38",
    platform: "win32",
    osRelease: "10.0.26100",
    architecture: "x64",
    stage: "spawn",
    code: "NATIVE_HELPER_BLOCKED",
    helperExists: true,
    profileMatches: true,
    integrityVerified: true,
    dataRootVolume: { fixedLocal: true, driveType: 3, filesystem: "NTFS" },
    userDataPath: "R:\\RedirectedProfile\\Relay",
    dataRootPath: "D:\\客户项目\\MiniMaxH3",
    prompt: "private prompt",
    token: "ghp_secret"
  });
  const serialized = JSON.stringify(diagnostic);
  for (const required of ["0.1.0-alpha.38", "Windows 10.0.26100", "x64", "spawn", "NATIVE_HELPER_BLOCKED", "true", "ntfs"]) {
    assert.ok(serialized.includes(required), `diagnostic missing ${required}`);
  }
  for (const secret of ["Alice", "客户项目", "private prompt", "ghp_secret", "C:\\\\Users", "D:\\\\"]) {
    assert.ok(!serialized.includes(secret), `diagnostic leaked ${secret}`);
  }
});

test("main startup keeps dataRoot failures recoverable instead of exiting before the settings surface", async () => {
  const [mainSource, html] = await Promise.all([
    read("src/main/main.ts"),
    read("src/renderer/index.html")
  ]);
  assert.match(mainSource, /DATA_ROOT_(?:UNAVAILABLE|NOT_FIXED_NTFS|PERMISSION_DENIED)|DataRootFailure/u);
  assert.match(mainSource, /StartupRecovery|startup-recovery|createStartupRecoveryWindow/u);
  assert.match(mainSource, /startup-diagnostic-\$\{Date\.now\(\)\}-\$\{process\.pid\}\.json/u);
  assert.match(mainSource, /persistSuccessfulStartupDiagnostic/u);
  assert.doesNotMatch(mainSource, /showErrorBox\("Relay 无法启动",\s*"本机组件自检失败，请重新安装 Relay 后重试。"\)/u);
  assert.match(html, /数据目录/u);
});

test("NSIS and portable packages retain explicit Windows x64 launch seams with isolated userData", async () => {
  const [metadata, packageScript, installerValidation, portableValidation] = await Promise.all([
    read("package.json").then(JSON.parse),
    read("scripts/package.mjs"),
    read("scripts/validate-installer-runtime.mjs"),
    read("scripts/validate-startup-compatibility.mjs")
  ]);
  assert.deepEqual(metadata.build.win.target, [
    { target: "nsis", arch: ["x64"] },
    { target: "portable", arch: ["x64"] }
  ]);
  assert.match(packageScript, /MINIMAX_H3_PACKAGED_PROBE/u);
  assert.match(packageScript, /`--user-data-dir=\$\{probeUserData\}`/u);
  assert.match(installerValidation, /`--user-data-dir=\$\{userDataPath\}`/u);
  assert.match(installerValidation, /Relay\.exe/u);
  assert.match(metadata.build.portable.artifactName, /Portable/u);
  assert.match(portableValidation, /MINIMAX_H3_PACKAGED_PROBE/u);
  assert.match(portableValidation, /`--user-data-dir=\$\{userData\}`/u);
  assert.match(portableValidation, /VM Shared Profile/u);
  assert.match(portableValidation, /用户 Ω/u);
  assert.match(portableValidation, /PACKAGED_NATIVE_HELPER_READY/u);
  assert.match(portableValidation, /PACKAGED_ADAPTER_READY/u);
  assert.match(portableValidation, /packaged-startup-probe\.json/u);
  assert.match(portableValidation, /persistedBoundary/u);
  assert.match(portableValidation, /sensitive_output_detected/u);
  assert.match(portableValidation, /submitted_prompt:\s*false/u);
  assert.match(portableValidation, /submitted_queue:\s*false/u);
  assert.match(portableValidation, /generated_media:\s*false/u);
  assert.doesNotMatch(portableValidation, /shell:\s*true/u);
});

test("startup compatibility work preserves the no-Run, no-/prompt, no-queue and no-media product boundary", async () => {
  const sources = await Promise.all([
    read("src/main/services/native-helper-client.ts"),
    read("src/main/services/data-root.ts"),
    read("src/main/main.ts")
  ]);
  const combined = sources.join("\n");
  assert.doesNotMatch(combined, /\/prompt|queue_prompt|queuePrompt|submitQueue|generate(?:Video|Audio|Media)/iu);
  assert.match(combined, /shell:\s*false/u);
});
