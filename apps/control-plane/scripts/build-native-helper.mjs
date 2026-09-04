import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { nativeEvidenceRoot, projectRoot, sha256File } from "./lib.mjs";

const repositoryRoot = resolve(projectRoot, "..", "..");
const nativeRoot = resolve(repositoryRoot, "native", "relay-winbroker");
const compileSourcePaths = [
  resolve(nativeRoot, "src", "main.cpp"),
  resolve(nativeRoot, "src", "json.cpp")
];
const sourceInventoryPaths = [
  ...compileSourcePaths,
  resolve(nativeRoot, "src", "json.hpp")
];
const capabilityProfilePath = resolve(nativeRoot, "capability-profile.v1.json");
const abiHeaderPath = resolve(repositoryRoot, "native", "win32-helper", "include", "minimaxh3_winbroker_abi.h");
const outputRoot = resolve(nativeRoot, "bin");
const evidenceRoot = nativeEvidenceRoot;
const distNativeRoot = resolve(projectRoot, "dist", "main", "native");
const distMainServicesRoot = resolve(projectRoot, "dist", "main", "services");

const lockedMsvcToolset = "14.44.35207";
const lockedCompilerVersion = "19.44.35228";
const lockedSdkVersion = "10.0.26100.0";
const visualStudioRoot = resolve(
  process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
  "Microsoft Visual Studio",
  "2022",
  "BuildTools"
);
const msvcRoot = resolve(visualStudioRoot, "VC", "Tools", "MSVC", lockedMsvcToolset);
const windowsKitsRoot = resolve(
  process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
  "Windows Kits",
  "10"
);
const sdkVersion = lockedSdkVersion;
const sdkIncludeRoot = resolve(windowsKitsRoot, "Include", sdkVersion);
const sdkLibRoot = resolve(windowsKitsRoot, "Lib", sdkVersion);
const sdkBinRoot = resolve(windowsKitsRoot, "bin", sdkVersion, "x64");
const compilerPath = resolve(msvcRoot, "bin", "Hostx64", "x64", "cl.exe");
const dumpbinPath = resolve(msvcRoot, "bin", "Hostx64", "x64", "dumpbin.exe");
for (const requiredPath of [msvcRoot, sdkIncludeRoot, sdkLibRoot, compilerPath, dumpbinPath]) {
  try {
    await stat(requiredPath);
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`NATIVE_TOOLCHAIN.LOCKED_PATH_MISSING:${requiredPath}`);
    throw error;
  }
}

const include = [
  resolve(msvcRoot, "include"),
  resolve(sdkIncludeRoot, "ucrt"),
  resolve(sdkIncludeRoot, "shared"),
  resolve(sdkIncludeRoot, "um"),
  resolve(sdkIncludeRoot, "winrt")
].join(";");
const library = [
  resolve(msvcRoot, "lib", "x64"),
  resolve(sdkLibRoot, "ucrt", "x64"),
  resolve(sdkLibRoot, "um", "x64")
].join(";");
const buildEnvironment = {
  SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
  TEMP: process.env.TEMP ?? "",
  TMP: process.env.TMP ?? "",
  INCLUDE: include,
  LIB: library,
  PATH: [resolve(msvcRoot, "bin", "Hostx64", "x64"), sdkBinRoot, process.env.PATH ?? ""].join(";")
};

const compileArguments = [
  "/nologo", "/std:c++20", "/permissive-", "/Zc:__cplusplus", "/Zc:preprocessor",
  "/utf-8", "/W4", "/WX", "/sdl", "/GS", "/guard:cf", "/O2", "/Oi",
  "/Gy", "/Gw", "/MT", "/GR-", "/EHsc", "/Brepro", "/DUNICODE", "/D_UNICODE",
  "/DWIN32_LEAN_AND_MEAN", "/D_WIN32_WINNT=0x0A00", ...compileSourcePaths,
  `/I${resolve(repositoryRoot, "native", "win32-helper", "include")}`
];
const linkArguments = [
  "/link", "/NOLOGO", "/SUBSYSTEM:CONSOLE", "/MACHINE:X64", "/DYNAMICBASE",
  "/NXCOMPAT", "/HIGHENTROPYVA", "/GUARD:CF", "/CETCOMPAT", "/DEPENDENTLOADFLAG:0x800",
  "/OPT:REF", "/OPT:ICF", "/INCREMENTAL:NO", "/RELEASE", "/Brepro", "/MANIFEST:EMBED",
  "kernel32.lib"
];

async function compileTo(outputPath, objectDirectory) {
  const result = spawnSync(
    compilerPath,
    [...compileArguments, `/Fo${objectDirectory}\\`, `/Fe${outputPath}`, ...linkArguments],
    {
      cwd: nativeRoot,
      env: buildEnvironment,
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      shell: false,
      windowsHide: true
    }
  );
  if (result.status !== 0) {
    const error = new Error("NATIVE_HELPER.COMPILE_FAILED");
    error.cause = { status: result.status, stdout: result.stdout, stderr: result.stderr };
    throw error;
  }
}

async function publishFileAtomically(sourcePath, targetPath) {
  await mkdir(dirname(targetPath), { recursive: true });
  const stagedPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
  await copyFile(sourcePath, stagedPath);
  try {
    await rename(stagedPath, targetPath);
  } catch (error) {
    // A concurrent verifier can already be executing the published PE. If
    // both deterministic builders produced identical bytes, keep the complete
    // existing file rather than attempting to replace a Windows image-mapped
    // executable. A different payload still fails closed.
    if (!["EACCES", "EBUSY", "EEXIST", "EPERM"].includes(error?.code)) throw error;
    let identical = false;
    try {
      identical = await sha256File(stagedPath) === await sha256File(targetPath);
    } catch {
      identical = false;
    }
    if (!identical) throw error;
  } finally {
    await rm(stagedPath, { force: true });
  }
}

async function writeFileAtomically(targetPath, contents) {
  await mkdir(dirname(targetPath), { recursive: true });
  const stagedPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(stagedPath, contents, { encoding: "utf8", flag: "wx" });
  try {
    await rename(stagedPath, targetPath);
  } catch (error) {
    if (!["EACCES", "EBUSY", "EEXIST", "EPERM"].includes(error?.code)) throw error;
    let identical = false;
    try {
      identical = await sha256File(stagedPath) === await sha256File(targetPath);
    } catch {
      identical = false;
    }
    if (!identical) throw error;
  } finally {
    await rm(stagedPath, { force: true });
  }
}

await mkdir(outputRoot, { recursive: true });
await mkdir(evidenceRoot, { recursive: true });
await mkdir(distNativeRoot, { recursive: true });
const temporaryRoot = await mkdtemp(resolve(outputRoot, ".repro-"));
try {
const firstPath = resolve(temporaryRoot, "first.exe");
const secondPath = resolve(temporaryRoot, "second.exe");
const firstObjects = resolve(temporaryRoot, "first-objects");
const secondObjects = resolve(temporaryRoot, "second-objects");
await mkdir(firstObjects, { recursive: true });
await mkdir(secondObjects, { recursive: true });
await compileTo(firstPath, firstObjects);
await compileTo(secondPath, secondObjects);
const firstSha256 = await sha256File(firstPath);
const secondSha256 = await sha256File(secondPath);
if (firstSha256 !== secondSha256) throw new Error("NATIVE_HELPER.NON_REPRODUCIBLE_BUILD");

const dependencyProbe = spawnSync(dumpbinPath, ["/dependents", firstPath], {
  cwd: nativeRoot,
  env: buildEnvironment,
  encoding: "utf8",
  maxBuffer: 2 * 1024 * 1024,
  shell: false,
  windowsHide: true
});
if (dependencyProbe.status !== 0) throw new Error("NATIVE_HELPER.DEPENDENCY_PROBE_FAILED");
const dependencies = [...dependencyProbe.stdout.matchAll(/^\s+([A-Z0-9_.-]+\.dll)\s*$/gimu)]
  .map((match) => match[1].toLowerCase())
  .sort();
const allowedDependencies = new Set(["kernel32.dll"]);
const unexpectedDependencies = dependencies.filter((dependency) => !allowedDependencies.has(dependency));
if (unexpectedDependencies.length > 0) {
  throw new Error(`NATIVE_HELPER.UNEXPECTED_DEPENDENCY:${unexpectedDependencies.join(",")}`);
}

const outputPath = resolve(outputRoot, "relay-winbroker.exe");
await publishFileAtomically(firstPath, outputPath);
await publishFileAtomically(firstPath, resolve(distNativeRoot, "relay-winbroker.exe"));
await publishFileAtomically(capabilityProfilePath, resolve(distNativeRoot, "capability-profile.v1.json"));
const compilerProbe = spawnSync(compilerPath, [], {
  cwd: nativeRoot,
  env: buildEnvironment,
  encoding: "utf8",
  maxBuffer: 1024 * 1024,
  shell: false,
  windowsHide: true
});
const compilerBanner = `${compilerProbe.stdout ?? ""}${compilerProbe.stderr ?? ""}`;
const compilerVersion = /Compiler Version ([0-9.]+)/u.exec(compilerBanner)?.[1] ?? "unknown";
if (compilerVersion !== lockedCompilerVersion) {
  throw new Error(`NATIVE_TOOLCHAIN.COMPILER_VERSION_MISMATCH:${compilerVersion}`);
}
const binaryStats = await stat(outputPath);
const manifest = {
  schema_version: 1,
  product: "relay-winbroker",
  capability_profile: {
    id: "relay.win32.path-inspection",
    version: "1.0.0",
    sha256: await sha256File(capabilityProfilePath),
    enabled_opcodes: [257, 258],
    reserved_not_enabled_opcodes: [259, 513, 514, 769, 770, 771]
  },
  protocol_argument: "--capability-profile=path-inspection-v1",
  architecture: "x64",
  release_state: "internal_unsigned",
  compiler: { implementation: "msvc", version: compilerVersion, toolset: msvcRoot.split(/[\\/]/u).at(-1) },
  windows_sdk_version: sdkVersion,
  sources: await Promise.all(sourceInventoryPaths.map(async (path) => ({
    path: path.slice(nativeRoot.length + 1).replaceAll("\\", "/"),
    sha256: await sha256File(path)
  }))),
  abi_header_sha256: await sha256File(abiHeaderPath),
  binary: { filename: "relay-winbroker.exe", bytes: binaryStats.size, sha256: firstSha256 },
  reproducible_unsigned_payload: { builds: 2, byte_identical: true, sha256: firstSha256 },
  imported_dlls: dependencies,
  forbidden_surfaces: ["network", "shell", "download", "comfy_queue", "prompt_endpoint", "media_generation"]
};
const manifestDocument = `${JSON.stringify(manifest, null, 2)}\n`;
await writeFileAtomically(resolve(nativeRoot, "build-manifest.json"), manifestDocument);
await writeFileAtomically(resolve(evidenceRoot, "native-build-manifest.json"), manifestDocument);
// Keep the expected binary/profile identities inside app.asar. The payloads
// being checked are unpacked for execution, so the embedded-ASAR integrity
// fuse protects this independent comparison manifest.
await writeFileAtomically(
  resolve(distMainServicesRoot, "startup-native-build-manifest.json"),
  manifestDocument
);
process.stdout.write(`NATIVE_BUILD sha256=${firstSha256} bytes=${binaryStats.size} compiler=${compilerVersion} sdk=${sdkVersion}\n`);
} finally {
  // Delete only the unique directory created by this build invocation. A
  // concurrent build has a different mkdtemp root and cannot be disrupted.
  await rm(temporaryRoot, { recursive: true, force: true });
}
