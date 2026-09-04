import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(projectRoot, "artifacts");
const outputPath = resolve(outputDirectory, "sbom.cdx.json");
const npmCli = process.env.npm_execpath;

if (!npmCli) {
  throw new Error("npm_execpath is required; run this script through npm run sbom.");
}

const raw = execFileSync(
  process.execPath,
  [npmCli, "sbom", "--sbom-format", "cyclonedx", "--package-lock-only"],
  {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true
  }
);

const sbom = JSON.parse(raw);
if (sbom.bomFormat !== "CycloneDX" || !Array.isArray(sbom.components)) {
  throw new Error("npm returned an unexpected SBOM document.");
}

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, `${JSON.stringify(sbom, null, 2)}\n`, "utf8");
console.log(
  JSON.stringify({
    output: "artifacts/sbom.cdx.json",
    components: sbom.components.length
  })
);
