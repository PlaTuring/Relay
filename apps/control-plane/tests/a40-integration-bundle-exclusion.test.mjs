import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { build } from "esbuild";

const appRoot = path.resolve(import.meta.dirname, "..");

async function loadModules(context) {
  const buildRoot = await mkdtemp(path.join(os.tmpdir(), "relay-a40-bundle-exclusion-build-"));
  context.after(() => rm(buildRoot, { recursive: true, force: true }));
  const bundleOut = path.join(buildRoot, "relay-project-bundle.mjs");
  const domainOut = path.join(buildRoot, "project-domain.mjs");
  const repositoryOut = path.join(buildRoot, "project-repository.mjs");
  await Promise.all([
    build({
      entryPoints: [path.join(appRoot, "src", "main", "services", "relay-project-bundle.ts")],
      outfile: bundleOut,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node22",
      logLevel: "silent",
    }),
    build({
      entryPoints: [path.join(appRoot, "src", "shared", "project-domain.ts")],
      outfile: domainOut,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node22",
      logLevel: "silent",
    }),
    build({
      entryPoints: [path.join(appRoot, "src", "main", "services", "project-repository.ts")],
      outfile: repositoryOut,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node22",
      logLevel: "silent",
    }),
  ]);
  const cache = `${Date.now()}-${Math.random()}`;
  return Object.freeze({
    bundle: await import(`${pathToFileURL(bundleOut).href}?test=${cache}`),
    domain: await import(`${pathToFileURL(domainOut).href}?test=${cache}`),
    repository: await import(`${pathToFileURL(repositoryOut).href}?test=${cache}`),
  });
}

function ids() {
  let value = 0;
  return () => (++value).toString(16).padStart(32, "0");
}

test(".relayproj keeps ordinary thumbnails but excludes generated-result caches and the local results index", async (context) => {
  const modules = await loadModules(context);
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "relay-a40-bundle-exclusion-"));
  context.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const projectRoot = path.join(fixtureRoot, "project-alpha40-bundle");
  const thumbnailRoot = path.join(projectRoot, "assets", "thumbnails");
  const generatedPoster = "generated-result-alpha40video-0123456789abcdef.png";
  const generatedPosterTemporary = ".generated-result-alpha40video-0123456789abcdef.tmp";
  const generatedIndexTemporary = ".generated-videos.v1.json.0123456789abcdef.tmp";
  await Promise.all([
    mkdir(path.join(projectRoot, "assets", "originals"), { recursive: true }),
    mkdir(path.join(projectRoot, "assets", "proxies"), { recursive: true }),
    mkdir(thumbnailRoot, { recursive: true }),
    mkdir(path.join(projectRoot, "workflows"), { recursive: true }),
    mkdir(path.join(projectRoot, "history"), { recursive: true }),
    mkdir(path.join(projectRoot, "recovery"), { recursive: true }),
    mkdir(path.join(fixtureRoot, "exports"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(thumbnailRoot, "ordinary-asset-thumbnail.png"), Buffer.from("ordinary-thumbnail")),
    writeFile(path.join(thumbnailRoot, ".ordinary-thumbnail.tmp"), Buffer.from("ordinary-thumbnail-temporary")),
    writeFile(path.join(thumbnailRoot, generatedPoster), Buffer.from("generated-video-poster-cache")),
    writeFile(path.join(thumbnailRoot, generatedPosterTemporary), Buffer.from("generated-video-poster-temporary")),
    writeFile(
      path.join(projectRoot, "recovery", "generated-videos.v1.json"),
      `${JSON.stringify({ schemaVersion: 1, projectId: "project-alpha40-bundle", origins: [], results: [] })}\n`,
      "utf8",
    ),
    writeFile(
      path.join(projectRoot, "recovery", generatedIndexTemporary),
      `${JSON.stringify({ externalPath: "C:\\private\\generated.mp4" })}\n`,
      "utf8",
    ),
  ]);

  const project = modules.domain.createEmptyRelayProject({
    projectId: "project-alpha40-bundle",
    name: "Alpha 40 bundle exclusion",
    createdAt: "2026-09-01T00:00:00.000Z",
  });
  const destination = path.join(fixtureRoot, "exports", "portable.relayproj");
  const exported = await modules.bundle.exportRelayProjectBundle({
    projectRoot,
    project,
    destinationPath: destination,
    externalReferencePolicy: "exclude",
    resolveExternalReference: async () => null,
    now: () => new Date("2026-09-01T00:01:00.000Z"),
    createId: () => "00112233445566778899aabbccddeeff",
  });
  const inspected = await modules.bundle.inspectRelayProjectBundle(destination);
  const exportedPaths = exported.manifest.files.map((entry) => entry.path);
  const inspectedPaths = inspected.manifest.files.map((entry) => entry.path);

  assert.ok(exportedPaths.includes("assets/thumbnails/ordinary-asset-thumbnail.png"));
  assert.ok(exportedPaths.includes("assets/thumbnails/.ordinary-thumbnail.tmp"));
  assert.deepEqual(inspectedPaths, exportedPaths, "verified ZIP central directory and manifest agree");
  assert.equal(exportedPaths.includes(`assets/thumbnails/${generatedPoster}`), false);
  assert.equal(exportedPaths.includes(`assets/thumbnails/${generatedPosterTemporary}`), false);
  assert.equal(exportedPaths.includes("recovery/generated-videos.v1.json"), false);
  assert.equal(exportedPaths.includes(`recovery/${generatedIndexTemporary}`), false);
  assert.equal(exportedPaths.some((entry) => entry.startsWith("recovery/")), false);
});

test("project clone keeps ordinary recovery/thumbnail data but drops generated-video machine-local evidence", async (context) => {
  const modules = await loadModules(context);
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "relay-a40-clone-exclusion-"));
  context.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const dataRoot = path.join(fixtureRoot, "Relay data");
  const repository = modules.repository.createProjectRepository({
    dataRoot,
    createId: ids(),
    now: () => new Date("2026-09-01T00:00:00.000Z"),
  });
  const source = await repository.createProject({ name: "source" });
  const sourceRoot = path.join(dataRoot, "projects", source.projectId);
  const generatedPoster = "generated-result-alpha40clone-0123456789abcdef.png";
  const generatedPosterTemporary = ".generated-result-alpha40clone-0123456789abcdef.tmp";
  const generatedIndexTemporary = ".generated-videos.v1.json.0123456789abcdef.tmp";
  await Promise.all([
    writeFile(path.join(sourceRoot, "assets", "thumbnails", "ordinary.png"), "ordinary", "utf8"),
    writeFile(path.join(sourceRoot, "assets", "thumbnails", ".ordinary.tmp"), "ordinary temporary", "utf8"),
    writeFile(path.join(sourceRoot, "assets", "thumbnails", generatedPoster), "generated", "utf8"),
    writeFile(path.join(sourceRoot, "assets", "thumbnails", generatedPosterTemporary), "generated temporary", "utf8"),
    writeFile(path.join(sourceRoot, "recovery", "ordinary-recovery.json"), "{}\n", "utf8"),
    writeFile(path.join(sourceRoot, "recovery", ".ordinary-recovery.tmp"), "ordinary temporary\n", "utf8"),
    writeFile(path.join(sourceRoot, "recovery", "generated-videos.v1.json"), "{}\n", "utf8"),
    writeFile(path.join(sourceRoot, "recovery", generatedIndexTemporary), "{\"externalPath\":\"C:\\\\private\\\\generated.mp4\"}\n", "utf8"),
  ]);

  const cloned = await repository.cloneProject(source.projectId, { name: "copy" });
  const cloneRoot = path.join(dataRoot, "projects", cloned.projectId);
  assert.equal(await readFile(path.join(cloneRoot, "assets", "thumbnails", "ordinary.png"), "utf8"), "ordinary");
  assert.equal(await readFile(path.join(cloneRoot, "assets", "thumbnails", ".ordinary.tmp"), "utf8"), "ordinary temporary");
  assert.equal(await readFile(path.join(cloneRoot, "recovery", "ordinary-recovery.json"), "utf8"), "{}\n");
  assert.equal(await readFile(path.join(cloneRoot, "recovery", ".ordinary-recovery.tmp"), "utf8"), "ordinary temporary\n");
  await assert.rejects(readFile(path.join(cloneRoot, "assets", "thumbnails", generatedPoster)), { code: "ENOENT" });
  await assert.rejects(readFile(path.join(cloneRoot, "assets", "thumbnails", generatedPosterTemporary)), { code: "ENOENT" });
  await assert.rejects(readFile(path.join(cloneRoot, "recovery", "generated-videos.v1.json")), { code: "ENOENT" });
  await assert.rejects(readFile(path.join(cloneRoot, "recovery", generatedIndexTemporary)), { code: "ENOENT" });
});
