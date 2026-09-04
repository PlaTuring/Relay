import path from "node:path";

import { H3_ATTACH_PROFILE } from "./constants.mjs";
import { createFixtureFileAdapter } from "./filesystem.mjs";
import { createLocalRuntimeService } from "./service.mjs";
import { createFixtureHostProbe } from "./windows-probe.mjs";

const ROOT = "D:\\Synthetic Fixture\\ComfyUI_windows_portable";
const MODEL_ROOT = path.win32.join(ROOT, "ComfyUI", "models");

function smokeEntries() {
  const entries = new Map([
    [ROOT, { kind: "directory", byte_length: null, modified_ns: "1" }],
    [path.win32.join(ROOT, "ComfyUI", "main.py"), { kind: "file", byte_length: 1, modified_ns: "1" }],
    [path.win32.join(ROOT, "ComfyUI", "comfy", "cli_args.py"), { kind: "file", byte_length: 1, modified_ns: "1" }],
    [path.win32.join(ROOT, "python_embeded", "python.exe"), { kind: "file", byte_length: 1, modified_ns: "1" }]
  ]);
  for (const artifact of H3_ATTACH_PROFILE.assets) {
    entries.set(path.win32.join(MODEL_ROOT, artifact.relative_path.replaceAll("/", "\\")), {
      kind: "file",
      byte_length: artifact.expected_byte_length,
      modified_ns: "1",
      artifact_sha256: artifact.expected_artifact_sha256
    });
  }
  return entries;
}

export async function createSyntheticSmokePlan() {
  const hostProbe = createFixtureHostProbe({
    probe_status: "complete",
    system: {
      platform: "win32",
      architecture: "x64",
      logical_processor_count: 16,
      system_ram_bytes: 34_359_738_368
    },
    volumes: [{
      drive_letter: "D:",
      drive_type: "fixed_local",
      filesystem: "ntfs",
      capacity_bytes: 1_099_511_627_776,
      free_bytes: 549_755_813_888
    }],
    gpus: [{
      subject_id: "gpu-0",
      status: "resolved_observation",
      reason: "preferred_source_exact",
      official_support_claim: "none",
      sources: [
        { kind: "nvidia_smi", index: 0, product_name: "Synthetic GPU", vram_bytes: 17_179_869_184, driver_version: "600.00", confidence_basis_points: 9500 },
        { kind: "wmi_cim", index: 0, product_name: "Synthetic GPU", vram_bytes: 17_179_869_184, driver_version: "600.00", confidence_basis_points: 2500 }
      ]
    }],
    failures: []
  });
  const service = createLocalRuntimeService({
    evidenceMode: "synthetic_smoke_no_host_io",
    hostProbe,
    fileAdapter: createFixtureFileAdapter(smokeEntries()),
    modelInspectionMode: "full"
  });
  return service.inspect({
    request_version: "1.0.0",
    user_comfy_roots: [ROOT]
  });
}
