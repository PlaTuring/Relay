import { isAbsolute, relative, resolve, sep } from "node:path";

export const inventoryRoots = Object.freeze(["build", "scripts", "src", "tests"]);

export const repositoryInventoryRoots = Object.freeze(["packages", "schemas"]);

export const repositoryInventoryTopLevel = Object.freeze([
  "LICENSE",
  "NOTICE",
  "THIRD_PARTY_NOTICES.md"
]);

export const inventoryTopLevel = Object.freeze([
  ".gitignore",
  "package-lock.json",
  "package.json",
  "tsconfig.base.json",
  "tsconfig.main.json",
  "tsconfig.preload.json",
  "tsconfig.renderer.json"
]);

// Every renderer asset used by the product is a reproducible public-source
// input. This list remains available so refresh and verification cannot drift
// if a future explicitly excluded local input is introduced.
export const excludedInventoryPaths = Object.freeze([]);

export function isExcludedInventoryPath(path) {
  return excludedInventoryPaths.includes(path);
}

export function nativeInventoryInputs(projectRoot) {
  return Object.freeze([
    resolve(projectRoot, "..", "..", "native", "relay-winbroker", "capability-profile.v1.json"),
    resolve(projectRoot, "..", "..", "native", "relay-winbroker", "src", "main.cpp"),
    resolve(projectRoot, "..", "..", "native", "relay-winbroker", "src", "json.cpp"),
    resolve(projectRoot, "..", "..", "native", "relay-winbroker", "src", "json.hpp"),
    resolve(projectRoot, "..", "..", "native", "win32-helper", "include", "minimaxh3_winbroker_abi.h")
  ]);
}

export function inventoryDirectoryInputs(projectRoot) {
  const repositoryRoot = resolve(projectRoot, "..", "..");
  return Object.freeze([
    ...inventoryRoots.map((path) => resolve(projectRoot, path)),
    ...repositoryInventoryRoots.map((path) => resolve(repositoryRoot, path))
  ]);
}

export function repositoryTopLevelInputs(projectRoot) {
  const repositoryRoot = resolve(projectRoot, "..", "..");
  return Object.freeze(repositoryInventoryTopLevel.map((path) => resolve(repositoryRoot, path)));
}

function normalizedRelativePath(root, candidate) {
  return relative(root, candidate).split(sep).join("/");
}

function containedOrEqual(candidate, root) {
  const child = relative(root, candidate);
  return child === "" || (
    child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child)
  );
}

export function localExtraResourceMappings(projectRoot, packageMetadata) {
  const repositoryRoot = resolve(projectRoot, "..", "..");
  const entries = packageMetadata?.build?.extraResources;
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("EXTRA_RESOURCE.MAPPINGS_REQUIRED");
  }
  const destinations = new Set();
  const mappings = entries.map((entry, index) => {
    if (
      entry === null || typeof entry !== "object" ||
      typeof entry.from !== "string" || entry.from.length === 0 ||
      typeof entry.to !== "string" || entry.to.length === 0
    ) {
      throw new Error(`EXTRA_RESOURCE.INVALID_MAPPING:${index}`);
    }
    const source = resolve(projectRoot, entry.from);
    if (!containedOrEqual(source, repositoryRoot)) {
      throw new Error(`EXTRA_RESOURCE.SOURCE_OUTSIDE_REPOSITORY:${index}`);
    }
    const destination = entry.to.replaceAll("\\", "/");
    if (
      destination.startsWith("/") || /^[a-z]:\//iu.test(destination) ||
      destination.split("/").some((part) => part === "" || part === "." || part === "..")
    ) {
      throw new Error(`EXTRA_RESOURCE.INVALID_DESTINATION:${index}`);
    }
    if (destinations.has(destination)) {
      throw new Error(`EXTRA_RESOURCE.DUPLICATE_DESTINATION:${destination}`);
    }
    destinations.add(destination);
    const filter = entry.filter ?? ["**/*"];
    if (!Array.isArray(filter) || filter.length !== 1 || filter[0] !== "**/*") {
      throw new Error(`EXTRA_RESOURCE.UNSUPPORTED_FILTER:${index}`);
    }
    return Object.freeze({
      source,
      source_inventory_path: normalizedRelativePath(projectRoot, source),
      destination,
      filter: Object.freeze([...filter])
    });
  });
  return Object.freeze(mappings);
}
