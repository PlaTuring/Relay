import { readdir, readFile, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import { projectRoot, sha256 } from "./lib.mjs";
import {
  inventoryDirectoryInputs,
  inventoryTopLevel,
  isExcludedInventoryPath,
  nativeInventoryInputs,
  repositoryTopLevelInputs
} from "./input-inventory-contract.mjs";

const excluded = new Set(["build/input-inventory.json"]);

async function collect(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collect(absolute)));
    } else if (entry.isFile()) {
      files.push(absolute);
    }
  }
  return files;
}

const candidates = [
  ...inventoryTopLevel.map((path) => resolve(projectRoot, path)),
  ...(await Promise.all(inventoryDirectoryInputs(projectRoot).map((path) => collect(path)))).flat(),
  ...repositoryTopLevelInputs(projectRoot),
  ...nativeInventoryInputs(projectRoot)
];
const entries = [];
for (const absolute of candidates) {
  const path = relative(projectRoot, absolute).split(sep).join("/");
  if (excluded.has(path) || isExcludedInventoryPath(path)) {
    continue;
  }
  const bytes = await readFile(absolute);
  entries.push({ path, bytes: bytes.length, sha256: sha256(bytes) });
}
entries.sort((left, right) => left.path.localeCompare(right.path, "en"));

const inventory = {
  schema_version: 1,
  hash_algorithm: "sha256",
  inputs: entries
};
await writeFile(
  resolve(projectRoot, "build", "input-inventory.json"),
  `${JSON.stringify(inventory, null, 2)}\n`,
  "utf8"
);
process.stdout.write(`INVENTORY inputs=${entries.length}\n`);
