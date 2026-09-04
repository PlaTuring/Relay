import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { projectRoot } from "./lib.mjs";

const mode = process.argv[2];
if (mode !== "--sbom" && mode !== "--licenses") {
  throw new Error("SUPPLY_CHAIN.INVALID_MODE");
}

const lock = JSON.parse(await readFile(resolve(projectRoot, "package-lock.json"), "utf8"));
const components = Object.entries(lock.packages)
  .filter(([path]) => path !== "")
  .map(([path, value]) => {
    const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
    return {
      lockPath: path,
      name,
      version: value.version,
      license: value.license,
      integrity: value.integrity,
      resolved: value.resolved
    };
  })
  .sort((left, right) =>
    `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`, "en")
  );

for (const component of components) {
  if (
    typeof component.version !== "string" ||
    typeof component.license !== "string" ||
    typeof component.integrity !== "string" ||
    typeof component.resolved !== "string"
  ) {
    throw new Error("SUPPLY_CHAIN.INCOMPLETE_LOCK_ENTRY");
  }
}

function cyclonedxLicenseChoice(spdxExpression) {
  // CycloneDX models a single SPDX identifier and a compound SPDX expression
  // as different union members.  Putting `MIT OR ISC` in license.id produces
  // an invalid BOM even though the package-lock value itself is valid SPDX.
  return /(?:\s(?:AND|OR|WITH)\s|[()])/u.test(spdxExpression)
    ? { expression: spdxExpression }
    : { license: { id: spdxExpression } };
}

await mkdir(resolve(projectRoot, "artifacts"), { recursive: true });
if (mode === "--licenses") {
  const output = {
    schema_version: 1,
    source: "package-lock.json",
    packages: components.map(({ name, version, license }) => ({
      name,
      version,
      license
    }))
  };
  await writeFile(
    resolve(projectRoot, "artifacts", "source-licenses.json"),
    `${JSON.stringify(output, null, 2)}\n`,
    "utf8"
  );
  process.stdout.write(`LICENSES components=${components.length}\n`);
} else {
  const output = {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    metadata: {
      component: {
        type: "application",
        name: lock.name,
        version: lock.version,
        licenses: [{ license: { id: "Apache-2.0" } }]
      }
    },
    components: components.map(({ lockPath, name, version, license, integrity, resolved }) => ({
      "bom-ref": `npm-lock:${encodeURIComponent(lockPath)}`,
      type: "library",
      name,
      version,
      licenses: [cyclonedxLicenseChoice(license)],
      properties: [
        { name: "npm:lock-path", value: lockPath },
        { name: "npm:integrity", value: integrity },
        { name: "npm:resolved", value: resolved }
      ]
    }))
  };
  await writeFile(
    resolve(projectRoot, "artifacts", "source-sbom.cdx.json"),
    `${JSON.stringify(output, null, 2)}\n`,
    "utf8"
  );
  process.stdout.write(`SBOM components=${components.length}\n`);
}
