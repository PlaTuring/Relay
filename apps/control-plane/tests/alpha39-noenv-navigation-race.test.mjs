import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const applicationRoot = path.resolve(import.meta.dirname, "..");
const rendererPath = path.join(applicationRoot, "src", "renderer", "index.ts");

function bounded(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.ok(startIndex >= 0, `missing start marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(endIndex > startIndex, `missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("quick-create and Director no-environment guards run before snapshots or compilation IPC", async () => {
  const renderer = await readFile(rendererPath, "utf8");
  const directorClick = bounded(
    renderer,
    'directorCompileButton.addEventListener("click"',
    "renderDirectorShots();"
  );
  const quickSubmit = bounded(
    renderer,
    'projectForm.addEventListener("submit"',
    "void (async () => {\n  try {\n    const bootstrap"
  );

  const directorGuard = directorClick.indexOf("if (!installationComplete)");
  assert.ok(directorGuard >= 0);
  for (const sideEffect of ["validateDirectorForCompilation", "captureDirectorCompilation", "requestSubmit"]) {
    assert.ok(
      directorGuard < directorClick.indexOf(sideEffect),
      `Director environment guard must precede ${sideEffect}`
    );
  }

  const quickGuard = quickSubmit.indexOf("if (!installationComplete)");
  assert.ok(quickGuard >= 0);
  for (const sideEffect of ["flushQuickProjectSave", "window.controlPlane.compileAndOpenWorkflow"]) {
    assert.ok(
      quickGuard < quickSubmit.indexOf(sideEffect),
      `quick-create environment guard must precede ${sideEffect}`
    );
  }
});

test("the real install action closes the modal, navigates, and only then starts discovery", async () => {
  const renderer = await readFile(rendererPath, "utf8");
  const installAction = bounded(
    renderer,
    'environmentRequiredInstall.addEventListener("click"',
    'environmentRequiredDialog.addEventListener("close"'
  );

  const close = installAction.indexOf("environmentRequiredDialog.close()");
  const navigate = installAction.indexOf('showView("install")');
  const discover = installAction.indexOf("runScan(true)");
  assert.ok(close >= 0 && close < navigate && navigate < discover);
  assert.doesNotMatch(installAction, /compileAndOpenWorkflow|\/prompt|requestSubmit/u);
});

test("first-run discovery cannot steal a view selected while the scan is in flight", async () => {
  const renderer = await readFile(rendererPath, "utf8");
  const bootstrapTail = bounded(
    renderer,
    "if (bootstrap.savedSetup?.setupComplete === true)",
    "  } catch (error) {"
  );
  const noEnvironment = bootstrapTail.slice(bootstrapTail.lastIndexOf("    } else {"));
  const home = noEnvironment.indexOf('showView("home")');
  const scan = noEnvironment.indexOf("await runScan(true)");

  assert.ok(home >= 0 && scan >= 0, "missing no-environment home/scan flow");
  assert.ok(
    home < scan,
    "show the project center before awaiting discovery; a late home navigation otherwise overwrites the user's current view"
  );
  assert.doesNotMatch(
    noEnvironment.slice(scan + "await runScan(true)".length),
    /showView\("home"\)/u,
    "automatic discovery completion must not issue a second navigation"
  );
});
