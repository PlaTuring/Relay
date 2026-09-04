import { lstat, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { localExtraResourceMappings } from "./input-inventory-contract.mjs";
import { sha256, sha256File } from "./lib.mjs";

function normalizedRelativePath(root, candidate) {
  return relative(root, candidate).split(sep).join("/");
}

function containedOrEqual(candidate, root) {
  const child = relative(root, candidate);
  return child === "" || (
    child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child)
  );
}

export async function collectRegularFiles(candidate) {
  const identity = await lstat(candidate);
  if (identity.isSymbolicLink()) {
    throw new Error(`RELEASE_RESOURCE.SYMLINK_REJECTED:${candidate}`);
  }
  if (identity.isFile()) return [candidate];
  if (!identity.isDirectory()) {
    throw new Error(`RELEASE_RESOURCE.UNSUPPORTED_ENTRY:${candidate}`);
  }
  const files = [];
  for (const entry of await readdir(candidate, { withFileTypes: true })) {
    const absolute = resolve(candidate, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`RELEASE_RESOURCE.SYMLINK_REJECTED:${absolute}`);
    }
    if (entry.isDirectory()) files.push(...await collectRegularFiles(absolute));
    else if (entry.isFile()) files.push(absolute);
    else throw new Error(`RELEASE_RESOURCE.UNSUPPORTED_ENTRY:${absolute}`);
  }
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

async function identity(path) {
  const metadata = await stat(path);
  return Object.freeze({ bytes: metadata.size, sha256: await sha256File(path) });
}

function addUniqueEntry(entries, entry) {
  const previous = entries.get(entry.path);
  if (previous !== undefined) {
    if (previous.bytes !== entry.bytes || previous.sha256 !== entry.sha256) {
      throw new Error(`PACKAGE_INPUT.DUPLICATE_IDENTITY_MISMATCH:${entry.path}`);
    }
    return;
  }
  entries.set(entry.path, entry);
}

const FORBIDDEN_RUNTIME_DIRECTORY = /(?:^|\/)(?:test|tests|fixture|fixtures|example|examples)(?:\/|$)/iu;
const PRIVATE_WINDOWS_USER_PATH = /(?:[a-z]:\\+users\\+|\\{2,}[^\\\r\n]+\\+[^\\\r\n]+\\+users\\+)[^\\\r\n\s"'`]+/iu;
const SECRET_PATH_MARKER = /secret[\\/]+token/iu;
const TEXT_RUNTIME_EXTENSION = /\.(?:cjs|js|json|mjs|ts|txt)$/iu;
const MAX_RUNTIME_TEXT_BYTES = 8 * 1024 * 1024;

async function assertPackagedRuntimeHygiene(resourcesRoot, actualFiles) {
  for (const absolute of actualFiles) {
    const packagedPath = `resources/${normalizedRelativePath(resourcesRoot, absolute)}`;
    if (!packagedPath.startsWith("resources/runtime/")) continue;
    if (FORBIDDEN_RUNTIME_DIRECTORY.test(packagedPath)) {
      throw new Error(`PACKAGE_RESOURCE.TEST_MATERIAL_FORBIDDEN:${packagedPath}`);
    }
    if (!TEXT_RUNTIME_EXTENSION.test(packagedPath)) continue;
    const metadata = await stat(absolute);
    if (metadata.size > MAX_RUNTIME_TEXT_BYTES) {
      throw new Error(`PACKAGE_RESOURCE.RUNTIME_TEXT_TOO_LARGE:${packagedPath}`);
    }
    const content = await readFile(absolute, "utf8");
    if (PRIVATE_WINDOWS_USER_PATH.test(content) || SECRET_PATH_MARKER.test(content)) {
      throw new Error(`PACKAGE_RESOURCE.PRIVATE_PATH_FORBIDDEN:${packagedPath}`);
    }
  }
}

export async function collectPackageInputInventory(projectRoot, packageMetadata) {
  const entries = new Map();
  for (const absolute of await collectRegularFiles(resolve(projectRoot, "dist"))) {
    const fileIdentity = await identity(absolute);
    addUniqueEntry(entries, {
      path: normalizedRelativePath(projectRoot, absolute),
      ...fileIdentity
    });
  }
  const packagePath = resolve(projectRoot, "package.json");
  addUniqueEntry(entries, { path: "package.json", ...await identity(packagePath) });

  const mappings = localExtraResourceMappings(projectRoot, packageMetadata);
  const extraResourceMappings = mappings.map((mapping) => ({
    source_path: mapping.source_inventory_path,
    destination: mapping.destination,
    filter: [...mapping.filter]
  }));
  const extraResources = [];
  for (const mapping of mappings) {
    const sourceMetadata = await stat(mapping.source);
    const sourceFiles = await collectRegularFiles(mapping.source);
    for (const absolute of sourceFiles) {
      const relativeWithinSource = sourceMetadata.isDirectory()
        ? normalizedRelativePath(mapping.source, absolute)
        : "";
      const destinationPath = relativeWithinSource.length === 0
        ? mapping.destination
        : `${mapping.destination}/${relativeWithinSource}`;
      const fileIdentity = await identity(absolute);
      const path = normalizedRelativePath(projectRoot, absolute);
      addUniqueEntry(entries, { path, ...fileIdentity });
      extraResources.push({
        source_path: path,
        packaged_path: `resources/${destinationPath}`,
        ...fileIdentity
      });
    }
  }
  const inputs = [...entries.values()].sort((left, right) => left.path.localeCompare(right.path, "en"));
  extraResources.sort((left, right) => left.packaged_path.localeCompare(right.packaged_path, "en"));
  return Object.freeze({
    schema_version: 3,
    asar: true,
    inputs: Object.freeze(inputs),
    extra_resource_mappings: Object.freeze(extraResourceMappings),
    extra_resources: Object.freeze(extraResources)
  });
}

export function sourceInventoryDigest(sourceInventory) {
  return sha256(Buffer.from(JSON.stringify(sourceInventory.inputs), "utf8"));
}

export function packageInventoryDigest(packageInventory) {
  return sha256(Buffer.from(JSON.stringify(packageInventory.inputs), "utf8"));
}

export function assertFrozenExtraResourceInputs(packageInventory, sourceInventory) {
  const requiredRepositoryMappings = new Map([
    ["../../packages/local-runtime/bin", "runtime/packages/local-runtime/bin"],
    ["../../packages/local-runtime/src", "runtime/packages/local-runtime/src"],
    ["../../packages/installer/catalog-loader/src", "runtime/packages/installer/catalog-loader/src"],
    ["../../packages/installer/download-sidecar/src", "runtime/packages/installer/download-sidecar/src"],
    ["../../packages/detection/media-capability/src", "runtime/packages/detection/media-capability/src"],
    ["../../schemas/component-manifest/1.0.0.schema.json", "runtime/schemas/component-manifest/1.0.0.schema.json"],
    ["../../packages/workflow/h3-compiler/bin", "runtime/packages/workflow/h3-compiler/bin"],
    ["../../packages/workflow/h3-compiler/src", "runtime/packages/workflow/h3-compiler/src"],
    ["../../packages/workflow/h3-compiler/templates", "runtime/packages/workflow/h3-compiler/templates"],
    ["../../packages/workflow/static-graph-lint/src", "runtime/packages/workflow/static-graph-lint/src"],
    ["../../LICENSE", "licenses/Relay/LICENSE"],
    ["../../NOTICE", "licenses/Relay/NOTICE"],
    ["../../THIRD_PARTY_NOTICES.md", "licenses/Relay/THIRD_PARTY_NOTICES.md"]
  ]);
  const declaredMappings = new Map(
    (packageInventory.extra_resource_mappings ?? []).map((entry) => [entry.source_path, entry.destination])
  );
  for (const [sourcePath, destination] of requiredRepositoryMappings) {
    if (declaredMappings.get(sourcePath) !== destination) {
      throw new Error(`PACKAGE_INPUT.REQUIRED_EXTRA_RESOURCE_MAPPING_MISSING:${sourcePath}`);
    }
    if (!packageInventory.extra_resources.some((entry) => (
      entry.source_path === sourcePath || entry.source_path.startsWith(`${sourcePath}/`)
    ))) {
      throw new Error(`PACKAGE_INPUT.REQUIRED_EXTRA_RESOURCE_EMPTY:${sourcePath}`);
    }
  }
  const frozen = new Map(sourceInventory.inputs.map((entry) => [entry.path, entry]));
  for (const entry of packageInventory.extra_resources) {
    if (!entry.source_path.startsWith("../../")) {
      continue;
    }
    const declared = frozen.get(entry.source_path);
    if (declared === undefined) {
      throw new Error(`PACKAGE_INPUT.EXTRA_RESOURCE_NOT_FROZEN:${entry.source_path}`);
    }
    if (declared.bytes !== entry.bytes || declared.sha256 !== entry.sha256) {
      throw new Error(`PACKAGE_INPUT.EXTRA_RESOURCE_FROZEN_MISMATCH:${entry.source_path}`);
    }
  }
}

export function assertPackageInventoriesEqual(actual, declared) {
  if (JSON.stringify(actual) !== JSON.stringify(declared)) {
    throw new Error("PACKAGE_INPUT.INVENTORY_MISMATCH");
  }
}

export async function writePackageInputInventory(projectRoot, inventory) {
  await mkdir(resolve(projectRoot, "artifacts"), { recursive: true });
  await writeFile(
    resolve(projectRoot, "artifacts", "package-input-inventory.json"),
    `${JSON.stringify(inventory, null, 2)}\n`,
    "utf8"
  );
}

export async function attestPackagedRuntimeResources({
  projectRoot,
  releaseRoot,
  packageMetadata,
  packageInventory,
  sourceInventory,
  evidencePath,
  releaseMode
}) {
  assertFrozenExtraResourceInputs(packageInventory, sourceInventory);
  const expected = packageInventory.extra_resources;
  const resourcesRoot = resolve(releaseRoot, "win-unpacked", "resources");
  const actualFileSet = new Set();
  const attestedNamespaces = new Set(
    (packageInventory.extra_resource_mappings ?? []).map((mapping) => mapping.destination.split("/")[0])
  );
  for (const namespace of attestedNamespaces) {
    for (const absolute of await collectRegularFiles(resolve(resourcesRoot, namespace))) {
      actualFileSet.add(absolute);
    }
  }
  const actualFiles = [...actualFileSet].sort((left, right) => left.localeCompare(right, "en"));
  await assertPackagedRuntimeHygiene(resourcesRoot, actualFiles);
  const actual = [];
  for (const absolute of actualFiles) {
    if (!containedOrEqual(absolute, resourcesRoot)) {
      throw new Error("PACKAGE_RESOURCE.PATH_ESCAPED");
    }
    actual.push({
      packaged_path: `resources/${normalizedRelativePath(resourcesRoot, absolute)}`,
      ...await identity(absolute)
    });
  }
  actual.sort((left, right) => left.packaged_path.localeCompare(right.packaged_path, "en"));
  const expectedRuntime = expected.map(({ packaged_path, bytes, sha256: hash }) => ({
    packaged_path,
    bytes,
    sha256: hash
  }));
  if (JSON.stringify(actual.map(({ packaged_path }) => packaged_path)) !== JSON.stringify(expectedRuntime.map(({ packaged_path }) => packaged_path))) {
    throw new Error("PACKAGE_RESOURCE.FILE_SET_MISMATCH");
  }
  for (let index = 0; index < expectedRuntime.length; index += 1) {
    const expectedEntry = expectedRuntime[index];
    const actualEntry = actual[index];
    if (expectedEntry.bytes !== actualEntry.bytes) {
      throw new Error(`PACKAGE_RESOURCE.LENGTH_MISMATCH:${expectedEntry.packaged_path}`);
    }
    if (expectedEntry.sha256 !== actualEntry.sha256) {
      throw new Error(`PACKAGE_RESOURCE.HASH_MISMATCH:${expectedEntry.packaged_path}`);
    }
  }
  const evidence = {
    schema_version: 1,
    conclusion: "passed",
    release_mode: releaseMode,
    source_inventory_sha256: sourceInventoryDigest(sourceInventory),
    package_inputs_sha256: packageInventoryDigest(packageInventory),
    mapping_count: localExtraResourceMappings(projectRoot, packageMetadata).length,
    file_count: expectedRuntime.length,
    total_bytes: expectedRuntime.reduce((total, entry) => total + entry.bytes, 0),
    entries: expected
  };
  if (evidencePath !== null) {
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  }
  return evidence;
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
