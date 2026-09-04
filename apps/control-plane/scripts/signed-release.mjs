import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { projectRoot } from "./lib.mjs";
import { loadSigningConfiguration } from "./signing-contract.mjs";

// Validate the PFX, publisher, RFC3161 URL and SignTool before any source gate,
// build, installer or evidence file is touched. This is intentionally a
// separate human-authorized transaction, never an unsigned fallback.
await loadSigningConfiguration(process.env);

function run(relativeScript, argumentsList) {
  const result = spawnSync(
    process.execPath,
    [resolve(projectRoot, relativeScript), ...argumentsList],
    {
      cwd: projectRoot,
      env: { ...process.env },
      stdio: "inherit",
      shell: false,
      windowsHide: true
    }
  );
  if (result.status !== 0) throw new Error(`SIGNED_RELEASE.STEP_FAILED:${relativeScript}`);
}

run("scripts/verify-offline.mjs", ["--source-only"]);
run("scripts/package.mjs", ["--signed", "--target", "nsis", "--target", "portable"]);
run("scripts/validate-installer-runtime.mjs", ["--signed"]);
run("scripts/verify-offline.mjs", ["--signed"]);

process.stdout.write(
  "SIGNED_RELEASE status=passed helper=valid app=valid uninstaller=valid setup=valid portable=valid timestamp=present unsigned_fallback=0\n"
);
