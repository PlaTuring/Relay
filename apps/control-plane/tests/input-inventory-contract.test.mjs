import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import test from "node:test";

import {
  excludedInventoryPaths,
  inventoryDirectoryInputs,
  inventoryRoots,
  inventoryTopLevel,
  isExcludedInventoryPath,
  localExtraResourceMappings,
  repositoryInventoryRoots,
  nativeInventoryInputs,
  repositoryInventoryTopLevel,
  repositoryTopLevelInputs
} from "../scripts/input-inventory-contract.mjs";

const projectRoot = resolve(import.meta.dirname, "..");

test("refresh and offline verification share one native input inventory contract", async () => {
  assert.deepEqual(inventoryRoots, ["build", "scripts", "src", "tests"]);
  assert.deepEqual(repositoryInventoryRoots, ["packages", "schemas"]);
  assert.deepEqual(repositoryInventoryTopLevel, ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"]);
  assert.equal(inventoryTopLevel.includes("package-lock.json"), true);
  assert.deepEqual(excludedInventoryPaths, []);
  assert.equal(isExcludedInventoryPath("src/renderer/assets/platuring-avatar.png"), false);
  assert.equal(isExcludedInventoryPath("src/renderer/assets/relay-logo.svg"), false);
  const nativeInputs = nativeInventoryInputs(projectRoot);
  assert.deepEqual(
    nativeInputs.map((path) => relative(projectRoot, path).split(sep).join("/")),
    [
      "../../native/relay-winbroker/capability-profile.v1.json",
      "../../native/relay-winbroker/src/main.cpp",
      "../../native/relay-winbroker/src/json.cpp",
      "../../native/relay-winbroker/src/json.hpp",
      "../../native/win32-helper/include/minimaxh3_winbroker_abi.h"
    ]
  );
  assert.deepEqual(
    repositoryTopLevelInputs(projectRoot).map((path) => relative(projectRoot, path).split(sep).join("/")),
    ["../../LICENSE", "../../NOTICE", "../../THIRD_PARTY_NOTICES.md"]
  );
  await Promise.all(nativeInputs.map((path) => access(path)));
  assert.deepEqual(
    inventoryDirectoryInputs(projectRoot).map((path) => relative(projectRoot, path).split(sep).join("/")),
    ["build", "scripts", "src", "tests", "../../packages", "../../schemas"]
  );

  const packageMetadata = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8"));
  assert.deepEqual(
    localExtraResourceMappings(projectRoot, packageMetadata).map(({ source_inventory_path, destination }) => ({
      source_inventory_path,
      destination
    })),
    [
      { source_inventory_path: "../../packages/local-runtime/bin", destination: "runtime/packages/local-runtime/bin" },
      { source_inventory_path: "../../packages/local-runtime/src", destination: "runtime/packages/local-runtime/src" },
      { source_inventory_path: "../../packages/installer/catalog-loader/src", destination: "runtime/packages/installer/catalog-loader/src" },
      { source_inventory_path: "../../packages/installer/download-sidecar/src", destination: "runtime/packages/installer/download-sidecar/src" },
      { source_inventory_path: "../../packages/detection/media-capability/src", destination: "runtime/packages/detection/media-capability/src" },
      { source_inventory_path: "../../schemas/component-manifest/1.0.0.schema.json", destination: "runtime/schemas/component-manifest/1.0.0.schema.json" },
      { source_inventory_path: "../../packages/workflow/h3-compiler/bin", destination: "runtime/packages/workflow/h3-compiler/bin" },
      { source_inventory_path: "../../packages/workflow/h3-compiler/src", destination: "runtime/packages/workflow/h3-compiler/src" },
      { source_inventory_path: "../../packages/workflow/h3-compiler/templates", destination: "runtime/packages/workflow/h3-compiler/templates" },
      { source_inventory_path: "../../packages/workflow/static-graph-lint/src", destination: "runtime/packages/workflow/static-graph-lint/src" },
      { source_inventory_path: "../../LICENSE", destination: "licenses/Relay/LICENSE" },
      { source_inventory_path: "../../NOTICE", destination: "licenses/Relay/NOTICE" },
      { source_inventory_path: "../../THIRD_PARTY_NOTICES.md", destination: "licenses/Relay/THIRD_PARTY_NOTICES.md" },
      { source_inventory_path: "dist/main/services/electron-utility-wrapper.cjs", destination: "runtime/electron-utility-wrapper.cjs" },
      { source_inventory_path: "dist/main/services/electron-workflow-compiler-wrapper.cjs", destination: "runtime/electron-workflow-compiler-wrapper.cjs" }
    ]
  );

  const [refreshSource, verifySource] = await Promise.all([
    readFile(resolve(projectRoot, "scripts", "refresh-input-inventory.mjs"), "utf8"),
    readFile(resolve(projectRoot, "scripts", "verify-offline.mjs"), "utf8")
  ]);
  for (const source of [refreshSource, verifySource]) {
    assert.ok(source.includes('from "./input-inventory-contract.mjs"'));
    assert.ok(source.includes("nativeInventoryInputs(projectRoot)"));
    assert.ok(source.includes("inventoryDirectoryInputs(projectRoot)"));
    assert.ok(source.includes("repositoryTopLevelInputs(projectRoot)"));
    assert.ok(source.includes("isExcludedInventoryPath"));
    assert.equal(source.includes('"relay-winbroker", "src", "main.cpp"'), false);
  }
});

test("source-only verification ignores stale packaged and installer evidence", async () => {
  const source = await readFile(resolve(projectRoot, "scripts", "verify-offline.mjs"), "utf8");
  assert.match(
    source,
    /const packagedIdentity = sourceOnly \? null : await readOptionalJson\(packagedIdentityPath\)/u
  );
  assert.match(
    source,
    /const packagedCall = sourceOnly \? null : await readOptionalJson\(packagedCallPath\)/u
  );
  assert.match(source, /const installerEvidence = sourceOnly\s*\? null\s*:\s*await readOptionalJson/u);
  assert.match(
    source,
    /if \(!sourceOnly && \(packagedIdentity !== null \|\| packagedCall !== null\)\)/u
  );
  assert.match(source, /if \(!sourceOnly && installerEvidence !== null\)/u);
  assert.match(
    source,
    /if \(!sourceOnly && packageGate !== "passed_release_artifact_and_runtime"\)/u
  );
  assert.match(
    source,
    /if \(!sourceOnly && installerGate !== "passed_installer_shortcuts_runtime_uninstall"\)/u
  );
});
