import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rendererSource = resolve(projectRoot, "src", "renderer");
const rendererTarget = resolve(projectRoot, "dist", "src", "renderer");
const preloadSource = resolve(projectRoot, "src", "preload", "index.ts");
const preloadTarget = resolve(projectRoot, "dist", "src", "preload", "index.js");

await mkdir(rendererTarget, { recursive: true });
await cp(resolve(rendererSource, "index.html"), resolve(rendererTarget, "index.html"));
await cp(resolve(rendererSource, "styles.css"), resolve(rendererTarget, "styles.css"));

await build({
  entryPoints: [preloadSource],
  outfile: preloadTarget,
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  sourcemap: false,
  legalComments: "none"
});
