import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const projectRoot = resolve(import.meta.dirname, "..");
const read = (relativePath) => readFile(resolve(projectRoot, relativePath), "utf8");

test("P1 Take picker is a closed no-input invoke with a narrow renderer result", async () => {
  const [contract, registry, preload] = await Promise.all([
    read("src/shared/ipc-contract.ts"),
    read("src/main/ipc-registry.ts"),
    read("src/preload/index.ts")
  ]);

  assert.ok(contract.includes('chooseResultMedia: "control:choose-result-media"'));
  assert.match(
    contract,
    /interface ResultMediaSelection\s*\{\s*readonly displayPath: string;\s*readonly displayName: string;\s*\}/u
  );
  assert.ok(contract.includes("chooseResultMedia(): Promise<ResultMediaSelection | null>"));
  assert.ok(preload.includes("ipcRenderer.invoke(IPC_REGISTRY.chooseResultMedia)"));
  assert.match(
    registry,
    /IPC_REGISTRY\.chooseResultMedia,[\s\S]*?requireNoInput\(input, "result media selection"\);[\s\S]*?services\.chooseResultMedia\(\)/u
  );
  assert.doesNotMatch(preload, /chooseResultMedia:\s*\([^)]*[A-Za-z][^)]*\)\s*=>/u);
});

test("P1 Take picker only selects one existing local media path and returns no file contents", async () => {
  const services = await read("src/main/services/index.ts");
  const start = services.indexOf("const chooseResultMedia = async");
  const end = services.indexOf("const chooseDirectory = async", start);
  assert.ok(start > 0 && end > start, "chooseResultMedia service block must exist");
  const picker = services.slice(start, end);

  assert.ok(picker.includes('properties: ["openFile"]'));
  assert.ok(picker.includes("result.canceled) return null"));
  assert.ok(picker.includes("result.filePaths.length !== 1"));
  assert.ok(services.includes("!isAbsolute(selectedPath)"));
  assert.ok(services.includes("RESULT_MEDIA_EXTENSIONS.has(extension)"));
  for (const extension of ["png", "jpg", "webp", "mp4", "mov", "mkv", "wav", "mp3", "flac"]) {
    assert.ok(services.includes(`"${extension}"`), `missing allowed media extension: ${extension}`);
  }
  assert.ok(services.includes("Object.freeze({ displayPath: selectedPath, displayName })"));
  assert.doesNotMatch(picker, /readFile|createReadStream|copyFile|writeFile|fetch|upload|queue|prompt/iu);
  assert.doesNotMatch(picker, /console\.(?:log|info|warn|error|debug)/u);
});

test("P1 Take picker cannot generate, execute or submit media work", async () => {
  const sources = (
    await Promise.all([
      read("src/shared/ipc-contract.ts"),
      read("src/preload/index.ts"),
      read("src/main/ipc-registry.ts"),
      read("src/main/services/index.ts")
    ])
  ).join("\n");

  assert.doesNotMatch(sources, /chooseResultMedia[\s\S]{0,600}(?:generate|inference|submitQueue|queuePrompt|\/prompt)/iu);
  assert.doesNotMatch(sources, /resultMedia(?:Command|Executable|Arguments|Environment)/u);
});
