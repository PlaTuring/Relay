import assert from "node:assert/strict";
import { copyFile, cp, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import test from "node:test";

import { localExtraResourceMappings } from "../scripts/input-inventory-contract.mjs";
import {
  assertFrozenExtraResourceInputs,
  attestPackagedRuntimeResources,
  collectPackageInputInventory
} from "../scripts/release-resource-attestation.mjs";

const realProjectRoot = resolve(import.meta.dirname, "..");

async function collectCleanCheckoutPackageInventory(packageMetadata) {
  const fixtureRoot = await mkdtemp(resolve(tmpdir(), "relay-package-inventory-"));
  const fixtureProjectRoot = resolve(fixtureRoot, "repo", "apps", "control-plane");
  try {
    await mkdir(fixtureProjectRoot, { recursive: true });
    await writeFile(resolve(fixtureProjectRoot, "package.json"), `${JSON.stringify(packageMetadata, null, 2)}\n`, "utf8");
    for (const mapping of packageMetadata.build.extraResources) {
      const source = mapping.from.startsWith("dist/main/services/")
        ? resolve(realProjectRoot, "src", "main", "services", basename(mapping.from))
        : resolve(realProjectRoot, mapping.from);
      const destination = resolve(fixtureProjectRoot, mapping.from);
      await mkdir(dirname(destination), { recursive: true });
      if ((await lstat(source)).isDirectory()) {
        await cp(source, destination, { recursive: true });
      } else {
        await copyFile(source, destination);
      }
    }
    return await collectPackageInputInventory(fixtureProjectRoot, packageMetadata);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

test("every electron-builder extraResources mapping is derived and freezes repository code, schemas, and legal notices", async () => {
  const packageMetadata = JSON.parse(await readFile(resolve(realProjectRoot, "package.json"), "utf8"));
  const mappings = localExtraResourceMappings(realProjectRoot, packageMetadata);
  assert.equal(mappings.length, packageMetadata.build.extraResources.length);
  assert.deepEqual(mappings.map(({ destination }) => destination), [
    "runtime/packages/local-runtime/bin",
    "runtime/packages/local-runtime/src",
    "runtime/packages/installer/catalog-loader/src",
    "runtime/packages/installer/download-sidecar/src",
    "runtime/packages/detection/media-capability/src",
    "runtime/schemas/component-manifest/1.0.0.schema.json",
    "runtime/packages/workflow/h3-compiler/bin",
    "runtime/packages/workflow/h3-compiler/src",
    "runtime/packages/workflow/h3-compiler/templates",
    "runtime/packages/workflow/static-graph-lint/src",
    "licenses/Relay/LICENSE",
    "licenses/Relay/NOTICE",
    "licenses/Relay/THIRD_PARTY_NOTICES.md",
    "runtime/electron-utility-wrapper.cjs",
    "runtime/electron-workflow-compiler-wrapper.cjs"
  ]);
  const packageInventory = await collectCleanCheckoutPackageInventory(packageMetadata);
  assert.deepEqual(
    packageInventory.extra_resource_mappings.map(({ source_path, destination }) => ({ source_path, destination })),
    [
      { source_path: "../../packages/local-runtime/bin", destination: "runtime/packages/local-runtime/bin" },
      { source_path: "../../packages/local-runtime/src", destination: "runtime/packages/local-runtime/src" },
      { source_path: "../../packages/installer/catalog-loader/src", destination: "runtime/packages/installer/catalog-loader/src" },
      { source_path: "../../packages/installer/download-sidecar/src", destination: "runtime/packages/installer/download-sidecar/src" },
      { source_path: "../../packages/detection/media-capability/src", destination: "runtime/packages/detection/media-capability/src" },
      { source_path: "../../schemas/component-manifest/1.0.0.schema.json", destination: "runtime/schemas/component-manifest/1.0.0.schema.json" },
      { source_path: "../../packages/workflow/h3-compiler/bin", destination: "runtime/packages/workflow/h3-compiler/bin" },
      { source_path: "../../packages/workflow/h3-compiler/src", destination: "runtime/packages/workflow/h3-compiler/src" },
      { source_path: "../../packages/workflow/h3-compiler/templates", destination: "runtime/packages/workflow/h3-compiler/templates" },
      { source_path: "../../packages/workflow/static-graph-lint/src", destination: "runtime/packages/workflow/static-graph-lint/src" },
      { source_path: "../../LICENSE", destination: "licenses/Relay/LICENSE" },
      { source_path: "../../NOTICE", destination: "licenses/Relay/NOTICE" },
      { source_path: "../../THIRD_PARTY_NOTICES.md", destination: "licenses/Relay/THIRD_PARTY_NOTICES.md" },
      {
        source_path: "dist/main/services/electron-utility-wrapper.cjs",
        destination: "runtime/electron-utility-wrapper.cjs"
      },
      {
        source_path: "dist/main/services/electron-workflow-compiler-wrapper.cjs",
        destination: "runtime/electron-workflow-compiler-wrapper.cjs"
      }
    ]
  );
  assert.ok(packageInventory.inputs.some(({ path }) => path.startsWith("../../packages/")));
  assert.ok(packageInventory.extra_resources.some(({ packaged_path }) => packaged_path.startsWith("resources/runtime/packages/")));
  assert.equal(packageInventory.extra_resources.some(({ packaged_path }) => /\/(?:test|tests|fixture|fixtures|example|examples)\//iu.test(packaged_path)), false);
  assert.ok(packageInventory.extra_resources.some(({ packaged_path }) => packaged_path === "resources/licenses/Relay/LICENSE"));

  const frozen = {
    inputs: packageInventory.extra_resources
      .filter(({ source_path }) => source_path.startsWith("../../"))
      .map(({ source_path: path, bytes, sha256 }) => ({ path, bytes, sha256 }))
  };
  assert.doesNotThrow(() => assertFrozenExtraResourceInputs(packageInventory, frozen));
  assert.throws(
    () => assertFrozenExtraResourceInputs(packageInventory, { inputs: frozen.inputs.slice(1) }),
    /PACKAGE_INPUT\.EXTRA_RESOURCE_NOT_FROZEN/u
  );
  assert.throws(
    () => assertFrozenExtraResourceInputs(
      {
        ...packageInventory,
        extra_resource_mappings: packageInventory.extra_resource_mappings.filter(
          ({ source_path }) => source_path !== "../../packages/workflow/static-graph-lint/src"
        )
      },
      frozen
    ),
    /PACKAGE_INPUT\.REQUIRED_EXTRA_RESOURCE_MAPPING_MISSING:\.\.\/\.\.\/packages\/workflow\/static-graph-lint\/src/u
  );
  assert.throws(
    () => assertFrozenExtraResourceInputs(
      {
        ...packageInventory,
        extra_resource_mappings: packageInventory.extra_resource_mappings.filter(
          ({ source_path }) => source_path !== "../../NOTICE"
        )
      },
      frozen
    ),
    /PACKAGE_INPUT\.REQUIRED_EXTRA_RESOURCE_MAPPING_MISSING:\.\.\/\.\.\/NOTICE/u
  );
  for (const requiredSourcePath of [
    "../../packages/installer/catalog-loader/src",
    "../../packages/installer/download-sidecar/src",
    "../../packages/detection/media-capability/src",
    "../../schemas/component-manifest/1.0.0.schema.json"
  ]) {
    assert.throws(
      () => assertFrozenExtraResourceInputs(
        {
          ...packageInventory,
          extra_resource_mappings: packageInventory.extra_resource_mappings.filter(
            ({ source_path }) => source_path !== requiredSourcePath
          )
        },
        frozen
      ),
      new RegExp(`PACKAGE_INPUT\\.REQUIRED_EXTRA_RESOURCE_MAPPING_MISSING:${requiredSourcePath.replaceAll("/", "\\/").replaceAll(".", "\\.")}`, "u")
    );
  }
});

test("packaged runtime attestation rejects extra and hash-mismatched resources", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "relay-package-attestation-"));
  const projectRoot = resolve(root, "repo", "apps", "control-plane");
  const repositoryRoot = resolve(projectRoot, "..", "..");
  const releaseRoot = resolve(projectRoot, "release-unsigned");
  const runtimeMappings = [
    { from: "../../packages/local-runtime/bin", to: "runtime/packages/local-runtime/bin", file: "runtime.mjs" },
    { from: "../../packages/local-runtime/src", to: "runtime/packages/local-runtime/src", file: "runtime.mjs" },
    { from: "../../packages/installer/catalog-loader/src", to: "runtime/packages/installer/catalog-loader/src", file: "runtime.mjs" },
    { from: "../../packages/installer/download-sidecar/src", to: "runtime/packages/installer/download-sidecar/src", file: "runtime.mjs" },
    { from: "../../packages/detection/media-capability/src", to: "runtime/packages/detection/media-capability/src", file: "runtime.mjs" },
    { from: "../../packages/workflow/h3-compiler/bin", to: "runtime/packages/workflow/h3-compiler/bin", file: "runtime.mjs" },
    { from: "../../packages/workflow/h3-compiler/src", to: "runtime/packages/workflow/h3-compiler/src", file: "runtime.mjs" },
    { from: "../../packages/workflow/h3-compiler/templates", to: "runtime/packages/workflow/h3-compiler/templates", file: "template.json" },
    { from: "../../packages/workflow/static-graph-lint/src", to: "runtime/packages/workflow/static-graph-lint/src", file: "runtime.mjs" }
  ];
  const packageMetadata = {
    build: {
      extraResources: [
        ...runtimeMappings.map(({ from, to }) => ({ from, to, filter: ["**/*"] })),
        {
          from: "../../schemas/component-manifest/1.0.0.schema.json",
          to: "runtime/schemas/component-manifest/1.0.0.schema.json"
        },
        { from: "../../LICENSE", to: "licenses/Relay/LICENSE" },
        { from: "../../NOTICE", to: "licenses/Relay/NOTICE" },
        { from: "../../THIRD_PARTY_NOTICES.md", to: "licenses/Relay/THIRD_PARTY_NOTICES.md" }
      ]
    }
  };
  try {
    await mkdir(resolve(projectRoot, "dist"), { recursive: true });
    await writeFile(resolve(projectRoot, "package.json"), JSON.stringify(packageMetadata), "utf8");
    await writeFile(resolve(projectRoot, "dist", "main.js"), "dist", "utf8");
    for (const mapping of runtimeMappings) {
      const source = resolve(projectRoot, mapping.from);
      await mkdir(source, { recursive: true });
      await writeFile(resolve(source, mapping.file), mapping.file.endsWith(".json") ? "{}" : "export {};", "utf8");
    }
    const componentSchema = resolve(repositoryRoot, "schemas", "component-manifest", "1.0.0.schema.json");
    await mkdir(resolve(componentSchema, ".."), { recursive: true });
    await writeFile(componentSchema, "{}", "utf8");
    await writeFile(resolve(repositoryRoot, "LICENSE"), "license", "utf8");
    await writeFile(resolve(repositoryRoot, "NOTICE"), "notice", "utf8");
    await writeFile(resolve(repositoryRoot, "THIRD_PARTY_NOTICES.md"), "third-party", "utf8");

    const packageInventory = await collectPackageInputInventory(projectRoot, packageMetadata);
    const sourceInventory = {
      inputs: packageInventory.extra_resources.map(({ source_path: path, bytes, sha256 }) => ({ path, bytes, sha256 }))
    };
    const resourcesRoot = resolve(releaseRoot, "win-unpacked", "resources");
    const runtimeRoot = resolve(resourcesRoot, "runtime");
    for (const mapping of runtimeMappings) {
      await cp(resolve(projectRoot, mapping.from), resolve(resourcesRoot, mapping.to), { recursive: true });
    }
    await mkdir(resolve(resourcesRoot, "runtime", "schemas", "component-manifest"), { recursive: true });
    await cp(componentSchema, resolve(resourcesRoot, "runtime", "schemas", "component-manifest", "1.0.0.schema.json"));
    const legalRoot = resolve(releaseRoot, "win-unpacked", "resources", "licenses", "Relay");
    await mkdir(legalRoot, { recursive: true });
    await cp(resolve(repositoryRoot, "LICENSE"), resolve(legalRoot, "LICENSE"));
    await cp(resolve(repositoryRoot, "NOTICE"), resolve(legalRoot, "NOTICE"));
    await cp(resolve(repositoryRoot, "THIRD_PARTY_NOTICES.md"), resolve(legalRoot, "THIRD_PARTY_NOTICES.md"));
    const parameters = {
      projectRoot,
      releaseRoot,
      packageMetadata,
      packageInventory,
      sourceInventory,
      evidencePath: null,
      releaseMode: "unsigned"
    };
    const passed = await attestPackagedRuntimeResources(parameters);
    assert.equal(passed.conclusion, "passed");
    assert.equal(passed.file_count, 13);

    const runtimeFile = resolve(runtimeRoot, "packages", "local-runtime", "src", "runtime.mjs");
    await writeFile(runtimeFile, "tampered", "utf8");
    await assert.rejects(
      attestPackagedRuntimeResources(parameters),
      /PACKAGE_RESOURCE\.(?:LENGTH|HASH)_MISMATCH/u
    );
    await writeFile(runtimeFile, "export {};", "utf8");
    await rm(runtimeFile);
    await assert.rejects(
      attestPackagedRuntimeResources(parameters),
      /PACKAGE_RESOURCE\.FILE_SET_MISMATCH/u
    );
    await writeFile(runtimeFile, "export {};", "utf8");
    await writeFile(resolve(runtimeRoot, "unexpected.txt"), "unexpected", "utf8");
    await assert.rejects(
      attestPackagedRuntimeResources(parameters),
      /PACKAGE_RESOURCE\.FILE_SET_MISMATCH/u
    );
    await rm(resolve(runtimeRoot, "unexpected.txt"));

    const privateFixture = ["C:", "Users", "sample-user", "secret", "token"].join("\\");
    await writeFile(runtimeFile, `export const sample = ${JSON.stringify(privateFixture)};`, "utf8");
    await assert.rejects(
      attestPackagedRuntimeResources(parameters),
      /PACKAGE_RESOURCE\.PRIVATE_PATH_FORBIDDEN/u
    );
    await writeFile(runtimeFile, "export {};", "utf8");

    const privateTypescript = resolve(runtimeRoot, "packages", "local-runtime", "src", "private.ts");
    await writeFile(privateTypescript, `export const sample = ${JSON.stringify(privateFixture)};`, "utf8");
    await assert.rejects(
      attestPackagedRuntimeResources(parameters),
      /PACKAGE_RESOURCE\.PRIVATE_PATH_FORBIDDEN/u
    );
    await rm(privateTypescript);

    const forbiddenTestDirectory = resolve(runtimeRoot, "packages", "local-runtime", "test");
    await mkdir(forbiddenTestDirectory, { recursive: true });
    await writeFile(resolve(forbiddenTestDirectory, "fixture.mjs"), "export {};", "utf8");
    await assert.rejects(
      attestPackagedRuntimeResources(parameters),
      /PACKAGE_RESOURCE\.TEST_MATERIAL_FORBIDDEN/u
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("extraResources mappings reject unsafe destinations and unsupported filters", () => {
  assert.throws(
    () => localExtraResourceMappings(realProjectRoot, {
      build: { extraResources: [{ from: "../../packages", to: "../escape", filter: ["**/*"] }] }
    }),
    /EXTRA_RESOURCE\.INVALID_DESTINATION/u
  );
  assert.throws(
    () => localExtraResourceMappings(realProjectRoot, {
      build: { extraResources: [{ from: "../../packages", to: "runtime/packages", filter: ["**/*.js"] }] }
    }),
    /EXTRA_RESOURCE\.UNSUPPORTED_FILTER/u
  );
});
