import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { main as cliMain } from "../bin/local-runtime.mjs";
import {
  H3_ATTACH_PROFILE,
  INSTALL_CATALOG,
  LocalRuntimeError,
  chooseManagedRoot,
  createFixtureFileAdapter,
  createFixtureHostProbe,
  createSyntheticSmokePlan,
  discoverH3Assets,
  initializeInstallTransaction,
  observeMediaCapabilities,
  probeWindowsHost,
  readInstallTransaction,
  resolveUiLocations,
  runSidecarOperation,
  transitionInstallTransaction,
  verifyH3Assets
} from "../src/index.mjs";
import { normalizeWindowsAbsolutePath, stableJson } from "../src/util.mjs";
import { createLiveProcessRunner } from "../src/windows-probe.mjs";

const fixedNtfs = (drive = "D:") => ({
  drive_letter: drive,
  drive_type: "fixed_local",
  filesystem: "ntfs",
  capacity_bytes: 1_000_000,
  free_bytes: 500_000
});

test("synthetic single-command plan verifies five byte identities and plans zero download bytes", async () => {
  const plan = await createSyntheticSmokePlan();
  assert.equal(plan.evidence_mode, "synthetic_smoke_no_host_io");
  assert.equal(plan.models.expected_asset_count, 5);
  assert.equal(plan.models.verified_asset_count, 5);
  assert.equal(plan.models.all_five_byte_identities_verified, true);
  assert.equal(plan.models.totals.reuse_download_bytes, 0);
  assert.equal(plan.models.totals.missing_download_bytes, 0);
  assert.equal(plan.models.missing_file_download_plan.entries.length, 0);
  assert.equal(plan.storage.managed_root.display_path, "D:\\MiniMaxH3");
  assert.equal(plan.storage.managed_root.silent_c_fallback, false);
  assert.equal(plan.attach_plan.comfy_started, false);
  assert.equal(plan.attach_plan.network_called, false);
  assert.equal(plan.attach_plan.model_executed, false);
  for (const asset of plan.models.assets) {
    assert.equal(asset.current_stage, "verified");
    assert.equal(asset.progression.compatible, false);
    assert.equal(asset.progression.approved, false);
    assert.equal(asset.progression.selected, false);
    assert.equal(asset.external_ownership.tool_owned, false);
    assert.equal(asset.external_ownership.delete_authority, "never");
  }
});

test("managed root defaults only to a supported D volume and never silently falls back to C", () => {
  const selected = chooseManagedRoot({ volumes: [fixedNtfs("D:")] });
  assert.equal(selected.status, "eligible_for_explicit_prepare");
  assert.equal(selected.private_path, "D:\\MiniMaxH3");
  const blocked = chooseManagedRoot({ volumes: [fixedNtfs("C:")] });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.private_path, null);
  assert.equal(blocked.silent_c_fallback, false);
  const explicit = chooseManagedRoot({ volumes: [fixedNtfs("C:")] }, "C:\\Chosen Root");
  assert.equal(explicit.status, "eligible_for_explicit_prepare");
  assert.equal(explicit.source, "user_selected");
});

test("managed root rejects UNC, device, ADS, traversal, reserved and volume-root paths", () => {
  const invalid = [
    "\\\\server\\share\\root",
    "\\\\?\\D:\\root",
    "D:\\root:stream",
    "D:\\root\\..\\escape",
    "D:\\CON",
    "D:\\"
  ];
  for (const candidate of invalid) {
    assert.throws(() => normalizeWindowsAbsolutePath(candidate), LocalRuntimeError);
  }
});

test("preferred SMI remains an observation when WMI reports truncated VRAM", async () => {
  const runner = {
    async run(executable, args) {
      if (executable.toLowerCase().endsWith("\\nvidia-smi.exe")) return { ok: true, stdout: "0, Synthetic GPU, 16384, 600.00\n" };
      const script = args.at(-1);
      if (script.includes("Win32_LogicalDisk")) {
        return { ok: true, stdout: JSON.stringify({ DeviceID: "D:", DriveType: 3, FileSystem: "NTFS", Size: 1000, FreeSpace: 500 }) };
      }
      return { ok: true, stdout: JSON.stringify({ Name: "Synthetic GPU", AdapterRAM: 4_294_967_296, DriverVersion: "600.00" }) };
    }
  };
  const report = await probeWindowsHost({ runner, platform: "win32" });
  assert.equal(report.gpus[0].status, "resolved_observation");
  assert.equal(report.gpus[0].reason, "preferred_source_exact_wmi_non_authoritative");
  assert.equal(report.gpus[0].official_support_claim, "none");
});

test("SMI is paired by GPU identity instead of WMI enumeration order", async () => {
  const runner = {
    async run(executable, args) {
      if (executable.toLowerCase().endsWith("\\nvidia-smi.exe")) return { ok: true, stdout: "0, NVIDIA GPU, 16384, 600.00\n" };
      const script = args.at(-1);
      if (script.includes("Win32_LogicalDisk")) return { ok: true, stdout: "[]" };
      return {
        ok: true,
        stdout: JSON.stringify([
          { Name: "Virtual Display", AdapterRAM: null, DriverVersion: "1.0" },
          { Name: "NVIDIA GPU", AdapterRAM: 4_294_967_296, DriverVersion: "600.00" }
        ])
      };
    }
  };
  const report = await probeWindowsHost({ runner, platform: "win32" });
  assert.equal(report.gpus[0].sources[0].product_name, "NVIDIA GPU");
  assert.equal(report.gpus[0].sources[1].product_name, "NVIDIA GPU");
  assert.equal(report.gpus[1].sources[0].product_name, "Virtual Display");
  assert.equal(report.gpus[1].status, "non_actionable");
});

test("live probe keeps the minimal Program Files environment required by NVIDIA NVML", async () => {
  let capturedOptions;
  const runner = createLiveProcessRunner({
    environment: {
      SystemRoot: "C:\\Windows",
      WINDIR: "C:\\Windows",
      ProgramFiles: "C:\\Program Files",
      ProgramW6432: "C:\\Program Files",
      SHOULD_NOT_LEAK: "secret"
    },
    async execute(_executable, _args, options) {
      capturedOptions = options;
      return { stdout: "0, Synthetic GPU, 16384, 600.00\n" };
    }
  });
  const result = await runner.run("C:\\Windows\\System32\\nvidia-smi.exe", []);
  assert.equal(result.ok, true);
  assert.deepEqual(capturedOptions.env, {
    SystemRoot: "C:\\Windows",
    WINDIR: "C:\\Windows",
    ProgramFiles: "C:\\Program Files",
    ProgramW6432: "C:\\Program Files"
  });
  assert.equal("SHOULD_NOT_LEAK" in capturedOptions.env, false);
});

test("WMI-only GPU observation never certifies a recipe", async () => {
  const runner = {
    async run(executable, args) {
      if (executable.toLowerCase().endsWith("\\nvidia-smi.exe")) return { ok: false, stdout: "" };
      const script = args.at(-1);
      if (script.includes("Win32_LogicalDisk")) return { ok: true, stdout: "[]" };
      return { ok: true, stdout: JSON.stringify({ Name: "Synthetic GPU", AdapterRAM: 4_294_967_296, DriverVersion: "600.00" }) };
    }
  };
  const report = await probeWindowsHost({ runner, platform: "win32" });
  assert.equal(report.gpus[0].status, "non_actionable");
  assert.equal(report.gpus[0].reason, "wmi_only_never_certifies_recipe");
});

test("filename and exact size do not authorize reuse when full SHA differs", async () => {
  const root = "D:\\Models";
  const artifact = H3_ATTACH_PROFILE.assets[0];
  const target = path.win32.join(root, artifact.relative_path.replaceAll("/", "\\"));
  const adapter = createFixtureFileAdapter(new Map([[target, {
    kind: "file",
    byte_length: artifact.expected_byte_length,
    modified_ns: "1",
    artifact_sha256: `sha256:${"0".repeat(64)}`
  }]]));
  const result = await verifyH3Assets({ modelRoots: [root], fileAdapter: adapter });
  const candidate = result.assets.find((item) => item.role === artifact.role);
  assert.equal(candidate.current_stage, "identified");
  assert.equal(candidate.progression.verified, false);
  assert.equal(candidate.progression.selected, false);
  assert.equal(candidate.reason, "artifact_sha256_mismatch");
});

test("fast model discovery is metadata-only and reports exact-size candidates as pending verification", async () => {
  const root = "D:\\Models";
  const entries = new Map();
  for (const artifact of H3_ATTACH_PROFILE.assets) {
    entries.set(path.win32.join(root, artifact.relative_path.replaceAll("/", "\\")), {
      kind: "file",
      byte_length: artifact.expected_byte_length,
      modified_ns: "1",
      artifact_sha256: artifact.expected_artifact_sha256
    });
  }
  const fixture = createFixtureFileAdapter(entries);
  let inspectCalls = 0;
  let sha256Calls = 0;
  const adapter = {
    pathSafety: (filePath) => fixture.pathSafety(filePath),
    async inspect(filePath) {
      inspectCalls += 1;
      return fixture.inspect(filePath);
    },
    async sha256() {
      sha256Calls += 1;
      throw new Error("fast discovery must not read model contents");
    }
  };

  const result = await discoverH3Assets({ modelRoots: [root], fileAdapter: adapter });

  assert.equal(sha256Calls, 0);
  assert.ok(inspectCalls <= H3_ATTACH_PROFILE.assets.length * 4);
  assert.equal(result.verified_asset_count, 0);
  assert.equal(result.all_five_byte_identities_verified, false);
  assert.equal(result.totals.avoided_download_bytes, 0);
  assert.equal(result.totals.pending_verification_bytes, 44_426_778_471);
  assert.equal(result.totals.missing_download_bytes, 0);
  for (const asset of result.assets) {
    assert.equal(asset.current_stage, "identified");
    assert.equal(asset.progression.verified, false);
    assert.equal(asset.progression.selected, false);
    assert.equal(asset.reason, "full_sha256_required_before_reuse");
    assert.equal(asset.reuse_plan.status, "full_sha256_required_before_reuse");
  }
  for (const entry of result.missing_file_download_plan.entries) {
    assert.equal(entry.action, "full_sha256_then_reuse_or_download_plan_only");
  }
});

function addPortableFixture(entries, root) {
  entries.set(root, { kind: "directory", byte_length: null, modified_ns: "1" });
  entries.set(path.win32.join(root, "ComfyUI", "main.py"), { kind: "file", byte_length: 1, modified_ns: "1" });
  entries.set(path.win32.join(root, "ComfyUI", "comfy", "cli_args.py"), { kind: "file", byte_length: 1, modified_ns: "1" });
  entries.set(path.win32.join(root, "python_embeded", "python.exe"), { kind: "file", byte_length: 1, modified_ns: "1" });
}

function addModelRootFixture(entries, root, count) {
  entries.set(root, { kind: "directory", byte_length: null, modified_ns: "1" });
  const artifacts = INSTALL_CATALOG.artifacts.filter((artifact) => artifact.kind === "model").slice(0, count);
  for (const artifact of artifacts) {
    entries.set(path.win32.join(root, ...artifact.relative_path.split("/")), {
      kind: "file",
      byte_length: artifact.expected_byte_length,
      modified_ns: "1",
      artifact_sha256: `sha256:${artifact.expected_sha256}`
    });
  }
}

test("ui-locations returns full local paths, prefers explicit Comfy, and selects the model root with most identified assets", async () => {
  const explicitComfy = "E:\\Chosen\\ComfyUI_windows_portable";
  const detectedComfy = "R:\\AI\\ComfyUI_windows_portable";
  const explicitModels = "E:\\Chosen\\Models";
  const detectedModels = path.win32.join(detectedComfy, "ComfyUI", "models");
  const entries = new Map();
  addPortableFixture(entries, explicitComfy);
  addPortableFixture(entries, detectedComfy);
  addModelRootFixture(entries, explicitModels, 2);
  addModelRootFixture(entries, detectedModels, 6);
  const fixture = createFixtureFileAdapter(entries);
  let sha256Calls = 0;
  const fileAdapter = {
    pathSafety: (filePath) => fixture.pathSafety(filePath),
    inspect: (filePath) => fixture.inspect(filePath),
    async sha256() {
      sha256Calls += 1;
      throw new Error("ui-locations must not hash model contents");
    }
  };
  const hostProbe = createFixtureHostProbe({
    probe_status: "complete",
    system: { platform: "win32", architecture: "x64", logical_processor_count: 1, system_ram_bytes: 1 },
    volumes: [fixedNtfs("R:")],
    gpus: [],
    failures: []
  });

  const result = await resolveUiLocations({
    request_version: "1.0.0",
    user_comfy_roots: [explicitComfy],
    user_model_roots: [explicitModels]
  }, { hostProbe, fileAdapter });

  assert.equal(sha256Calls, 0);
  assert.deepEqual(result.locations.comfy, {
    source: "explicit",
    root_path: explicitComfy,
    topology: "portable"
  });
  assert.equal(result.locations.models.source, "detected");
  assert.equal(result.locations.models.root_path, detectedModels);
  assert.equal(result.locations.models.recognized_asset_count, 6);
  assert.equal(result.locations.models.expected_asset_count, 7);
  assert.equal(result.sensitivity, "local_ui_only_do_not_log_or_export");
  assert.equal(result.inspection.recursive_scan, false);
  assert.equal(result.inspection.custom_nodes_imported, false);
  assert.equal(result.inspection.model_content_hashed, false);
});

test("ui-locations uses an explicit model root as the tie breaker and has an overall deadline", async () => {
  const explicitModels = "E:\\Chosen\\Models";
  const detectedModels = "R:\\AI\\ComfyUI_windows_portable\\ComfyUI\\models";
  const entries = new Map();
  addModelRootFixture(entries, explicitModels, 3);
  addModelRootFixture(entries, detectedModels, 3);
  const result = await resolveUiLocations({
    request_version: "1.0.0",
    user_model_roots: [explicitModels]
  }, {
    hostProbe: createFixtureHostProbe({ volumes: [fixedNtfs("R:")] }),
    fileAdapter: createFixtureFileAdapter(entries)
  });
  assert.equal(result.locations.models.source, "explicit");
  assert.equal(result.locations.models.root_path, explicitModels);

  const started = performance.now();
  const timedOut = await resolveUiLocations({ request_version: "1.0.0" }, {
    hostProbe: { probe: () => new Promise(() => {}) },
    fileAdapter: createFixtureFileAdapter(new Map()),
    uiLocationsDeadlineMilliseconds: 20
  });
  assert.ok(performance.now() - started < 500);
  assert.equal(timedOut.locations.comfy.source, "missing");
  assert.equal(timedOut.locations.models.source, "missing");
  assert.equal(timedOut.inspection.deadline_exceeded, true);
  assert.equal(timedOut.inspection.deadline_milliseconds, 20);
});

test("missing artifact produces an immutable metadata plan without network authority", async () => {
  const result = await verifyH3Assets({ modelRoots: ["D:\\Empty"], fileAdapter: createFixtureFileAdapter(new Map()) });
  assert.equal(result.verified_asset_count, 0);
  assert.equal(result.missing_file_download_plan.entries.length, 5);
  assert.equal(result.missing_file_download_plan.authority, "none_plan_only");
  assert.equal(result.missing_file_download_plan.network_called, false);
  for (const entry of result.missing_file_download_plan.entries) {
    assert.match(entry.source_revision, /^[0-9a-f]{40}$/u);
    assert.notEqual(entry.source_revision, "main");
    assert.equal(entry.action, "download_plan_only_no_network_authority");
  }
});

test("restart-safe transaction appends immutable journal revisions and resumes", async (context) => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "minimax-h3-local-runtime-"));
  context.after(async () => {
    assert.ok(path.basename(temporary).startsWith("minimax-h3-local-runtime-"));
    await rm(temporary, { recursive: true, force: true });
  });
  const plan = {
    plan_digest: `sha256:${"1".repeat(64)}`,
    component_install_plan: { actions: [{ action_id: "attach-existing-comfy", kind: "attach_external_runtime" }] }
  };
  const first = await initializeInstallTransaction({ managed_root: temporary, plan });
  const resumed = await initializeInstallTransaction({ managed_root: temporary, plan });
  assert.deepEqual(resumed, first);
  const running = await transitionInstallTransaction({
    managed_root: temporary,
    transaction_id: first.transaction_id,
    action_id: "attach-existing-comfy",
    next_state: "running"
  });
  assert.equal(running.revision, 2);
  const complete = await transitionInstallTransaction({
    managed_root: temporary,
    transaction_id: first.transaction_id,
    action_id: "attach-existing-comfy",
    next_state: "complete",
    evidence_digest: `sha256:${"2".repeat(64)}`
  });
  assert.equal(complete.status, "complete");
  assert.equal(complete.revision, 3);
  assert.deepEqual(await readInstallTransaction({ managed_root: temporary, transaction_id: first.transaction_id }), complete);
});

test("frozen sidecar and media capability packages are exposed through data-only wrappers", async () => {
  const authority = runSidecarOperation({ operation: "authority" });
  assert.equal(authority.network_authority, "none");
  const media = await observeMediaCapabilities({ ambientFfmpegPresent: false });
  assert.equal(media.schemaVersion, 1);
  assert.equal(media.ambientFfmpeg.status, "unavailable");
});

function memoryStreams(input = "") {
  let stdout = "";
  let stderr = "";
  return {
    streams: {
      stdin: Readable.from([input]),
      stdout: { write(value) { stdout += value; } },
      stderr: { write(value) { stderr += value; } }
    },
    output: () => ({ stdout, stderr })
  };
}

test("CLI smoke stdout is deterministic single-line redacted JSON with explicit exit code", async () => {
  const first = memoryStreams();
  const second = memoryStreams();
  assert.equal(await cliMain(["smoke"], {}, first.streams), 0);
  assert.equal(await cliMain(["smoke"], {}, second.streams), 0);
  assert.equal(first.output().stdout, second.output().stdout);
  assert.equal(first.output().stderr, "");
  assert.equal(first.output().stdout.split("\n").length, 2);
  const parsed = JSON.parse(first.output().stdout);
  assert.equal(parsed.redacted, true);
  assert.equal(parsed.models.verified_asset_count, 5);
  assert.equal(parsed.models.totals.reuse_download_bytes, 0);
  assert.doesNotMatch(first.output().stdout, /Synthetic Fixture|C:\\Users|\/prompt/iu);
});

test("CLI errors use stderr-only stable public JSON and exit 2 for bad input", async () => {
  const io = memoryStreams("{}");
  const exitCode = await cliMain(["unknown", "--request", "-"], {}, io.streams);
  assert.equal(exitCode, 2);
  assert.equal(io.output().stdout, "");
  const error = JSON.parse(io.output().stderr);
  assert.deepEqual(error, {
    code: "LOCAL_RUNTIME.UNKNOWN_COMMAND",
    rule_id: "local_runtime.cli.command",
    stage: "cli"
  });
  assert.equal(io.output().stderr, `${stableJson(error)}\n`);
});

test("CLI attach-plan returns a redacted blocked plan on stdout and business exit 1", async () => {
  const io = memoryStreams('{"request_version":"1.0.0"}');
  const hostProbe = createFixtureHostProbe({
    probe_status: "complete",
    system: { platform: "win32", architecture: "x64", logical_processor_count: 1, system_ram_bytes: 1 },
    volumes: [fixedNtfs("C:")],
    gpus: [],
    failures: []
  });
  const exitCode = await cliMain(
    ["attach-plan", "--request", "-"],
    { evidenceMode: "synthetic_test", hostProbe, fileAdapter: createFixtureFileAdapter(new Map()) },
    io.streams
  );
  assert.equal(exitCode, 1);
  assert.equal(io.output().stderr, "");
  const plan = JSON.parse(io.output().stdout);
  assert.equal(plan.attach_plan.status, "blocked");
  assert.equal(plan.storage.managed_root.silent_c_fallback, false);
  assert.equal(plan.models.missing_file_download_plan.entries.length, 5);
  assert.equal(plan.models.missing_file_download_plan.network_called, false);
});

test("unified CLI exposes sidecar and media observations without action authority", async () => {
  const sidecarIo = memoryStreams('{"operation":"authority"}');
  assert.equal(await cliMain(["sidecar", "--request", "-"], {}, sidecarIo.streams), 0);
  assert.equal(JSON.parse(sidecarIo.output().stdout).network_authority, "none");
  const mediaIo = memoryStreams('{"ambientFfmpegPresent":false}');
  assert.equal(await cliMain(["media-probe", "--request", "-"], {}, mediaIo.streams), 0);
  const media = JSON.parse(mediaIo.output().stdout);
  assert.equal(media.schemaVersion, 1);
  assert.equal(media.ambientFfmpeg.status, "unavailable");
});

test("ui-locations CLI returns full paths only through its explicitly sensitive UI response", async () => {
  const explicitComfy = "E:\\Chosen\\ComfyUI_windows_portable";
  const entries = new Map();
  addPortableFixture(entries, explicitComfy);
  const io = memoryStreams(JSON.stringify({
    request_version: "1.0.0",
    user_comfy_roots: [explicitComfy]
  }));
  const exitCode = await cliMain(["ui-locations", "--request", "-"], {
    hostProbe: createFixtureHostProbe({ volumes: [] }),
    fileAdapter: createFixtureFileAdapter(entries)
  }, io.streams);
  assert.equal(exitCode, 0);
  assert.equal(io.output().stderr, "");
  const result = JSON.parse(io.output().stdout);
  assert.equal(result.sensitivity, "local_ui_only_do_not_log_or_export");
  assert.equal(result.locations.comfy.root_path, explicitComfy);
  assert.equal(result.inspection.recursive_scan, false);
  assert.equal(result.inspection.model_content_hashed, false);
});
