import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const projectRoot = resolve(import.meta.dirname, "..");
const catalogModule = await import(
  pathToFileURL(resolve(projectRoot, "packages/local-runtime/src/catalog.mjs")).href
);
const { INSTALL_CATALOG, validateInstallCatalog } = catalogModule;
validateInstallCatalog(INSTALL_CATALOG);

const outputFlag = process.argv.indexOf("--output");
const outputPath = outputFlag >= 0 && process.argv[outputFlag + 1]
  ? resolve(process.argv[outputFlag + 1])
  : null;

const candidates = [];
for (const artifact of INSTALL_CATALOG.artifacts) {
  const urls = artifact.urls ?? [artifact.url];
  for (let index = 0; index < urls.length; index += 1) {
    candidates.push({
      artifact_id: artifact.id,
      role: index === 0 ? "primary" : "fallback",
      expected_byte_length: artifact.expected_byte_length,
      url: urls[index]
    });
  }
}

function parseContentRange(value) {
  const match = /^bytes\s+0-0\/(\d+)$/iu.exec(value ?? "");
  return match ? Number(match[1]) : null;
}

function redactUrl(value) {
  const parsed = new URL(value);
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

async function probe(candidate) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  const startedAt = performance.now();
  try {
    const response = await fetch(candidate.url, {
      headers: {
        Accept: "application/octet-stream",
        Range: "bytes=0-0",
        "User-Agent": "Relay-download-source-probe/1.0"
      },
      redirect: "follow",
      signal: controller.signal
    });
    const contentRange = response.headers.get("content-range");
    const observedTotal = parseContentRange(contentRange);
    const result = {
      ...candidate,
      final_url: redactUrl(response.url),
      http_status: response.status,
      accept_ranges: response.headers.get("accept-ranges"),
      content_range: contentRange,
      observed_total_byte_length: observedTotal,
      elapsed_ms: Math.round(performance.now() - startedAt),
      passed: response.status === 206 && observedTotal === candidate.expected_byte_length
    };
    await response.body?.cancel().catch(() => undefined);
    return result;
  } catch (error) {
    return {
      ...candidate,
      elapsed_ms: Math.round(performance.now() - startedAt),
      passed: false,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    };
  } finally {
    clearTimeout(timer);
  }
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const output = new Array(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(values[index]);
    }
  });
  await Promise.all(workers);
  return output;
}

const probes = await mapWithConcurrency(candidates, 4, probe);
const report = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  evidence_scope: "current-host read-only one-byte HTTP Range probe",
  catalog_id: INSTALL_CATALOG.catalog_id,
  candidate_count: probes.length,
  passed_count: probes.filter((entry) => entry.passed).length,
  failed_count: probes.filter((entry) => !entry.passed).length,
  all_passed: probes.every((entry) => entry.passed),
  caveat: "This proves the configured endpoints from this host at this time; it does not guarantee every Chinese carrier or future endpoint availability.",
  probes
};

const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputPath) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, serialized, "utf8");
}
process.stdout.write(serialized);
process.exitCode = report.all_passed ? 0 : 1;
