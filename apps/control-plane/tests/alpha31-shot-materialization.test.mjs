import assert from "node:assert/strict";
import { readFile, rm, writeFile, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path, { resolve } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

import { build, transform } from "esbuild";

const root = resolve(import.meta.dirname, "..");

async function bundledModule(entry) {
  const result = await build({
    entryPoints: [resolve(root, entry)],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    target: "node22"
  });
  const source = result.outputFiles[0]?.text;
  assert.ok(source);
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

const [domain, professional, workspace] = await Promise.all([
  bundledModule("src/shared/project-domain.ts"),
  bundledModule("src/renderer/professional-director.ts"),
  bundledModule("src/renderer/project-workspace-controller.ts")
]);

function emptyProject(suffix = "base") {
  return domain.createEmptyRelayProject({
    projectId: `project-alpha31-${suffix}`,
    name: "Alpha31 镜头物化",
    createdAt: "2026-08-30T00:00:00.000Z"
  });
}

function materialize(project, totalDurationSeconds, segmentDurationSeconds = 5, extra = {}) {
  return workspace.materializeDirectorSegmentPlan(project, {
    mode: "T2V",
    totalDurationSeconds,
    segmentDurationSeconds,
    updatedAt: extra.updatedAt ?? "2026-08-30T00:00:01.000Z",
    ...(extra.seedShots === undefined ? {} : { seedShots: extra.seedShots })
  });
}

function ordered(project) {
  return professional.orderedDirectorShots(project).map((entry) => entry.shot);
}

function assertAuthoritativePlan(project, expectedCount, expectedDuration) {
  const shots = ordered(project);
  assert.equal(shots.length, expectedCount);
  assert.deepEqual(shots.map((shot) => shot.durationSeconds), Array(expectedCount).fill(expectedDuration));
  assert.equal(new Set(shots.map((shot) => shot.shotId)).size, expectedCount);
  assert.equal(project.quick.totalDurationSeconds, expectedCount * expectedDuration);
  assert.equal(project.quick.segmentDurationSeconds, expectedDuration);
  assert.ok(shots.some((shot) => shot.shotId === project.professional.activeShotId));
  const activeScene = project.scenes.find((scene) => scene.sceneId === project.professional.activeSceneId);
  assert.ok(activeScene);
  assert.deepEqual(activeScene.shotIds.filter((id) => shots.some((shot) => shot.shotId === id)), shots.map((shot) => shot.shotId));
  assert.equal(project.shots.filter((shot) => !shot.archived).length, expectedCount);
  assert.doesNotThrow(() => domain.normalizeRelayProject(project));
}

test("Alpha31 materializes 30/5, 15/5, and 60/5 into authoritative project shots and scene membership", () => {
  for (const [seconds, count] of [[30, 6], [15, 3], [60, 12]]) {
    const project = materialize(emptyProject(`${seconds}s`), seconds);
    assertAuthoritativePlan(project, count, 5);
  }
});

test("Alpha31 generates deterministic shot IDs and keeps a matching plan as an identity no-op", () => {
  const left = materialize(emptyProject("stable"), 30);
  const right = materialize(emptyProject("stable"), 30, 5, {
    updatedAt: "2026-08-30T00:02:00.000Z"
  });
  assert.deepEqual(ordered(left).map((shot) => shot.shotId), ordered(right).map((shot) => shot.shotId));
  assert.equal(materialize(left, 30, 5, { updatedAt: "2026-08-30T00:03:00.000Z" }), left);
});

test("Alpha31 shrink archives authored shots without losing fields, binding, continuity, or stable recovery", () => {
  let project = materialize(emptyProject("recovery"), 30);
  const originalIds = ordered(project).map((shot) => shot.shotId);
  const protectedId = originalIds[5];
  const asset = {
    assetId: "asset-alpha31-protected",
    displayName: "绑定素材",
    sourceFileName: "bound.png",
    mediaType: "image",
    storageMode: "project_copy",
    projectRelativePath: "assets/originals/bound.png",
    externalReferenceId: null,
    byteLength: 12,
    sha256: "a".repeat(64),
    tags: [],
    notes: "",
    availability: "available",
    inspection: null,
    createdAt: "2026-08-30T00:00:01.000Z",
    updatedAt: "2026-08-30T00:00:01.000Z"
  };
  project = domain.normalizeRelayProject({
    ...project,
    assets: [asset],
    shots: project.shots.map((shot) => shot.shotId === protectedId ? {
      ...shot,
      prompt: "第六镜头原文",
      camera: "手持跟随",
      sound: "雨声",
      startState: { subject: { mode: "override", value: "红色外套", locked: true } },
      endState: { lighting: { mode: "override", value: "霓虹侧光", locked: false } },
      transitionFromPrevious: {
        ...shot.transitionFromPrevious,
        type: "hard_cut",
        capability: "proven",
        customIntent: "动作匹配"
      }
    } : shot),
    bindings: [{
      bindingId: "binding-alpha31-protected",
      targetKind: "shot",
      targetId: protectedId,
      assetId: asset.assetId,
      purpose: "continuity_reference",
      notes: "保留绑定",
      createdAt: "2026-08-30T00:00:01.000Z"
    }]
  });

  const shrunk = materialize(project, 15);
  assertAuthoritativePlan(shrunk, 3, 5);
  const archived = shrunk.shots.find((shot) => shot.shotId === protectedId);
  assert.ok(archived?.archived);
  assert.equal(archived.prompt, "第六镜头原文");
  assert.equal(archived.camera, "手持跟随");
  assert.equal(archived.sound, "雨声");
  assert.equal(archived.startState.subject.value, "红色外套");
  assert.equal(archived.endState.lighting.value, "霓虹侧光");
  assert.equal(archived.transitionFromPrevious.customIntent, "动作匹配");
  assert.equal(shrunk.bindings.find((binding) => binding.targetId === protectedId)?.notes, "保留绑定");

  const restored = materialize(shrunk, 30);
  assertAuthoritativePlan(restored, 6, 5);
  assert.deepEqual(ordered(restored).map((shot) => shot.shotId), originalIds);
  const recovered = ordered(restored)[5];
  assert.equal(recovered.prompt, "第六镜头原文");
  assert.equal(recovered.camera, "手持跟随");
  assert.equal(recovered.sound, "雨声");
  assert.equal(recovered.archived, false);
});

test("Alpha31 segment-duration changes never overwrite the prior authored plan and can restore it", () => {
  let project = materialize(emptyProject("duration-switch"), 30);
  const fiveSecondIds = ordered(project).map((shot) => shot.shotId);
  project = domain.normalizeRelayProject({
    ...project,
    shots: project.shots.map((shot, index) => ({ ...shot, prompt: `原始 5 秒镜头 ${index + 1}` }))
  });
  const tenSecond = materialize(project, 30, 10);
  assertAuthoritativePlan(tenSecond, 3, 10);
  assert.ok(fiveSecondIds.every((id) => tenSecond.shots.find((shot) => shot.shotId === id)?.archived));
  assert.deepEqual(
    fiveSecondIds.map((id) => tenSecond.shots.find((shot) => shot.shotId === id)?.prompt),
    Array.from({ length: 6 }, (_, index) => `原始 5 秒镜头 ${index + 1}`)
  );
  const restored = materialize(tenSecond, 30, 5);
  assert.deepEqual(ordered(restored).map((shot) => shot.shotId), fiveSecondIds);
  assert.deepEqual(ordered(restored).map((shot) => shot.prompt), Array.from({ length: 6 }, (_, index) => `原始 5 秒镜头 ${index + 1}`));
});

test("Alpha31 migrates legacy DOM-only draft shots once while existing Relay content remains authoritative", () => {
  let project = materialize(emptyProject("legacy-seed"), 5);
  const firstId = ordered(project)[0].shotId;
  project = domain.normalizeRelayProject({
    ...project,
    shots: project.shots.map((shot) => ({ ...shot, prompt: "权威第一镜头" }))
  });
  const seedShots = Array.from({ length: 6 }, (_, index) => ({
    id: `shot-alpha31-legacy-${index + 1}`,
    startSeconds: index * 5,
    durationSeconds: 5,
    description: `旧草稿镜头 ${index + 1}`,
    cameraLanguage: `机位 ${index + 1}`,
    soundCue: `声音 ${index + 1}`
  }));
  const migrated = materialize(project, 30, 5, { seedShots });
  assertAuthoritativePlan(migrated, 6, 5);
  assert.equal(ordered(migrated)[0].shotId, firstId);
  assert.equal(ordered(migrated)[0].prompt, "权威第一镜头");
  assert.deepEqual(ordered(migrated).slice(1).map((shot) => shot.shotId), seedShots.slice(1).map((shot) => shot.id));
  assert.deepEqual(ordered(migrated).slice(1).map((shot) => shot.prompt), seedShots.slice(1).map((shot) => shot.description));
  assert.deepEqual(ordered(migrated).slice(1).map((shot) => shot.camera), seedShots.slice(1).map((shot) => shot.cameraLanguage));
  assert.deepEqual(ordered(migrated).slice(1).map((shot) => shot.sound), seedShots.slice(1).map((shot) => shot.soundCue));
});

test("Alpha31 active shot survives extension, falls back deterministically on shrink, and survives autosave/restart", () => {
  let project = materialize(emptyProject("active"), 30);
  const ids = ordered(project).map((shot) => shot.shotId);
  project = professional.focusDirectorShot(project, ids[5], "2026-08-30T00:00:02.000Z");
  project = materialize(project, 60);
  assert.equal(project.professional.activeShotId, ids[5]);
  project = materialize(project, 15);
  assert.equal(project.professional.activeShotId, ids[2]);

  let controller = workspace.createProjectWorkspaceController(materialize(emptyProject("persist"), 30), {
    viewportWidth: 1600,
    autosaveDelayMs: 1
  });
  const lastId = ordered(controller.session.current).at(-1).shotId;
  controller = workspace.focusProjectWorkspaceShot(controller, {
    shotId: lastId,
    updatedAt: "2026-08-30T00:00:03.000Z",
    createdAtMs: 1
  });
  let request;
  [controller, request] = workspace.claimProjectWorkspaceAutosave(controller, 2);
  assert.ok(request);
  const diskProject = domain.normalizeRelayProject(JSON.parse(request.payload));
  const restarted = workspace.createProjectWorkspaceController(diskProject, {
    viewportWidth: 1366,
    initiallyPersisted: true
  });
  assert.equal(restarted.session.current.professional.activeShotId, lastId);
  assert.equal(workspace.currentProjectWorkspaceShot(restarted).shotId, lastId);
  assertAuthoritativePlan(restarted.session.current, 6, 5);
});

function functionSource(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing function: ${name}`);
  const parametersStart = source.indexOf("(", start + `function ${name}`.length);
  let parametersDepth = 0;
  let parametersEnd = -1;
  for (let index = parametersStart; index < source.length; index += 1) {
    if (source[index] === "(") parametersDepth += 1;
    if (source[index] === ")" && --parametersDepth === 0) {
      parametersEnd = index;
      break;
    }
  }
  const bodyStart = source.indexOf("{", parametersEnd);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unterminated function: ${name}`);
}

async function runChromiumDomScenarios(selectionAndP1JavaScript, scenarios) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "relay-alpha31-dom-"));
  const scriptPath = path.join(temporary, "alpha31-real-dom.cjs");
  const payloadPath = path.join(temporary, "payload.json");
  const userDataPath = path.join(temporary, "profile");
  const electronExecutable = resolve(
    root,
    "node_modules",
    "electron",
    "dist",
    process.platform === "win32" ? "electron.exe" : "electron"
  );
  const harness = `
    ${selectionAndP1JavaScript}
    let directorWorkspace = null;
    let activeRelayProject = null;
    let directorActiveShotId = null;
    let directorShotList = null;
    let directorTimelineTrack = null;
    let state = {};
    let activeShotId = null;
    let totalDuration = null;
    let currentShotDuration = null;
    let currentShotHeading = null;
    function activeShotsForP1() { return []; }
    function directorTimelineDuration(shots) {
      return shots.reduce((total, shot) => total + shot.durationSeconds, 0);
    }
    const directorP1Ui = {
      activeShotId: null,
      setActiveShot(shotId) {
        this.activeShotId = shotId;
        activeShotId = shotId;
        renderCurrentShot();
      },
      focusField(shotId) {
        this.setActiveShot(shotId);
        return true;
      },
      render() { renderCurrentShot(); }
    };
    function focusProjectWorkspaceShot(controller, input) {
      return {
        ...controller,
        session: { current: {
          ...controller.session.current,
          professional: { ...controller.session.current.professional, activeShotId: input.shotId }
        }}
      };
    }
    function scheduleDirectorWorkspaceAutosave() {}
    function preferredScrollBehavior() { return "auto"; }
    function renderDirectorWorkspaceControls() {
      const project = directorWorkspace.session.current;
      const shotId = project.professional.activeShotId;
      const shot = project.shots.find((candidate) => candidate.shotId === shotId && !candidate.archived);
      const scene = project.scenes.find((candidate) => !candidate.archived && candidate.shotIds.includes(shotId));
      currentShotHeading.textContent = shot === undefined
        ? "尚未选择镜头"
        : (scene?.name ?? "场景") + " · " + shot.name;
      document.getElementById("summary").textContent = shotId ?? "";
    }
    window.mountAlpha31 = (project) => {
      document.body.innerHTML = '<main id="view"><strong id="director-p1-current-shot-heading"></strong><div id="timeline"></div><div id="shots"></div><output id="summary"></output></main>';
      directorShotList = document.getElementById("shots");
      directorTimelineTrack = document.getElementById("timeline");
      currentShotHeading = document.getElementById("director-p1-current-shot-heading");
      totalDuration = document.createElement("output");
      currentShotDuration = document.createElement("select");
      directorWorkspace = { session: { current: structuredClone(project) } };
      activeRelayProject = directorWorkspace.session.current;
      directorActiveShotId = project.professional.activeShotId;
      directorP1Ui.activeShotId = null;
      const active = project.shots.filter((shot) => !shot.archived).sort((a, b) => a.order - b.order);
      for (const shot of active) {
        const timeline = document.createElement("button");
        timeline.type = "button";
        timeline.dataset.directorShotId = shot.shotId;
        timeline.textContent = shot.shotId;
        timeline.addEventListener("click", () => selectDirectorShot(shot.shotId, { focusEditor: true, scroll: true }));
        directorTimelineTrack.append(timeline);
        const card = document.createElement("article");
        card.dataset.directorShotId = shot.shotId;
        const header = document.createElement("button");
        header.type = "button";
        header.className = "director-shot-toggle";
        header.setAttribute("aria-expanded", "false");
        header.textContent = shot.name;
        header.addEventListener("click", () => selectDirectorShot(shot.shotId, { focusEditor: true }));
        const body = document.createElement("div");
        body.className = "director-shot-body";
        body.hidden = true;
        body.setAttribute("aria-hidden", "true");
        const editor = document.createElement("textarea");
        editor.className = "director-shot-description";
        editor.value = shot.prompt;
        body.append(editor);
        card.append(header, body);
        directorShotList.append(card);
      }
      selectDirectorShot(project.professional.activeShotId);
      return window.alpha31Snapshot();
    };
    window.alpha31Snapshot = () => {
      // Exercise the exact late legacy-P1 render that previously overwrote the
      // authoritative workspace heading when its state lacked the new shots.
      directorP1Ui.render();
      const cards = [...directorShotList.querySelectorAll("[data-director-shot-id]")];
      const timeline = [...directorTimelineTrack.querySelectorAll("[data-director-shot-id]")];
      const visibleBodies = cards.filter((card) => {
        const body = card.querySelector(".director-shot-body");
        return !body.hidden && getComputedStyle(body).display !== "none";
      });
      const activeCard = cards.find((card) => card.classList.contains("is-active"));
      const project = directorWorkspace.session.current;
      const authoritativeShot = project.shots.find((shot) => shot.shotId === project.professional.activeShotId && !shot.archived);
      const authoritativeScene = project.scenes.find((scene) => !scene.archived && scene.shotIds.includes(project.professional.activeShotId));
      return {
        activeShotId: directorWorkspace.session.current.professional.activeShotId,
        relayActiveShotId: activeRelayProject.professional.activeShotId,
        rendererActiveShotId: directorActiveShotId,
        p1ActiveShotId: directorP1Ui.activeShotId,
        summaryShotId: document.getElementById("summary").textContent,
        headingText: currentShotHeading.textContent,
        expectedHeading: authoritativeShot === undefined
          ? "尚未选择镜头"
          : (authoritativeScene?.name ?? "场景") + " · " + authoritativeShot.name,
        activeCards: cards.filter((card) => card.classList.contains("is-active")).map((card) => card.dataset.directorShotId),
        expandedCards: cards.filter((card) => card.querySelector(".director-shot-toggle").getAttribute("aria-expanded") === "true").map((card) => card.dataset.directorShotId),
        visibleBodies: visibleBodies.map((card) => card.dataset.directorShotId),
        hiddenBodies: cards.filter((card) => card.querySelector(".director-shot-body").hidden).map((card) => card.dataset.directorShotId),
        activeTimeline: timeline.filter((item) => item.classList.contains("is-active")).map((item) => item.dataset.directorShotId),
        pressedTimeline: timeline.filter((item) => item.getAttribute("aria-pressed") === "true").map((item) => item.dataset.directorShotId),
        editorValue: activeCard?.querySelector(".director-shot-description")?.value ?? null,
        focusedShotId: document.activeElement?.closest?.("[data-director-shot-id]")?.dataset.directorShotId ?? null,
        serializedProject: JSON.stringify(directorWorkspace.session.current)
      };
    };
    window.alpha31Click = (surface, shotId) => {
      const root = surface === "timeline" ? directorTimelineTrack : directorShotList;
      const target = root.querySelector('[data-director-shot-id="' + CSS.escape(shotId) + '"]');
      const button = surface === "timeline" ? target : target?.querySelector(".director-shot-toggle");
      button?.click();
      return window.alpha31Snapshot();
    };
    window.alpha31Focus = (surface, shotId) => {
      const root = surface === "timeline" ? directorTimelineTrack : directorShotList;
      const target = root.querySelector('[data-director-shot-id="' + CSS.escape(shotId) + '"]');
      const button = surface === "timeline" ? target : target?.querySelector(".director-shot-toggle");
      button?.focus();
    };
    window.alpha31Navigate = () => {
      const view = document.getElementById("view");
      view.hidden = true;
      view.hidden = false;
      return window.alpha31Snapshot();
    };
    void 0;
  `;
  const electronScript = `
    const { app, BrowserWindow } = require("electron");
    const fs = require("node:fs");
    app.disableHardwareAcceleration();
    app.setPath("userData", ${JSON.stringify(userDataPath)});
    const payload = JSON.parse(fs.readFileSync(${JSON.stringify(payloadPath)}, "utf8"));
    const emit = (value) => process.stdout.write("ALPHA31_DOM_RESULT=" + JSON.stringify(value) + "\\n");
    app.whenReady().then(async () => {
      const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, sandbox: true } });
      await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent("<!doctype html><style>[hidden]{display:none!important}</style><body></body>"));
      win.webContents.debugger.attach("1.3");
      await win.webContents.executeJavaScript(payload.harness, true);
      const results = [];
      for (const scenario of payload.scenarios) {
        results.push(await win.webContents.executeJavaScript("mountAlpha31(" + JSON.stringify(scenario.project) + ")", true));
        for (const action of scenario.actions) {
          if (action.kind === "click") {
            results.push(await win.webContents.executeJavaScript("alpha31Click(" + JSON.stringify(action.surface) + "," + JSON.stringify(action.shotId) + ")", true));
            continue;
          }
          if (action.kind === "navigate") {
            results.push(await win.webContents.executeJavaScript("alpha31Navigate()", true));
            continue;
          }
          if (action.kind === "remount") {
            const serialized = await win.webContents.executeJavaScript("alpha31Snapshot().serializedProject", true);
            results.push(await win.webContents.executeJavaScript("mountAlpha31(JSON.parse(" + JSON.stringify(serialized) + "))", true));
            continue;
          }
          await win.webContents.executeJavaScript("alpha31Focus(" + JSON.stringify(action.surface) + "," + JSON.stringify(action.shotId) + ")", true);
          win.webContents.focus();
          const key = action.key === "Space"
            ? { key: " ", code: "Space", text: " ", unmodifiedText: " ", windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 }
            : { key: "Enter", code: "Enter", text: "\\r", unmodifiedText: "\\r", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
          await win.webContents.debugger.sendCommand("Input.dispatchKeyEvent", { type: "keyDown", ...key });
          await win.webContents.debugger.sendCommand("Input.dispatchKeyEvent", { type: "keyUp", ...key });
          await new Promise((resolve) => setTimeout(resolve, 25));
          results.push(await win.webContents.executeJavaScript("alpha31Snapshot()", true));
        }
      }
      emit(results);
      win.destroy();
      app.quit();
    }).catch((error) => { process.stderr.write(String(error.stack || error)); app.exit(1); });
  `;
  await writeFile(payloadPath, JSON.stringify({ harness, scenarios }));
  await writeFile(scriptPath, electronScript);
  try {
    const output = await new Promise((resolvePromise, reject) => {
      const child = spawn(electronExecutable, [scriptPath], {
        cwd: root,
        env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error("Alpha31 Chromium DOM test timed out"));
      }, 30_000);
      child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
      child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
      child.on("error", reject);
      child.on("exit", (code) => {
        clearTimeout(timeout);
        if (code !== 0) reject(new Error(`Alpha31 Chromium DOM process failed (${code}): ${stderr}`));
        else resolvePromise(stdout);
      });
    });
    const marker = output.split(/\r?\n/u).find((line) => line.startsWith("ALPHA31_DOM_RESULT="));
    assert.ok(marker, `missing Chromium DOM result: ${output}`);
    return JSON.parse(marker.slice("ALPHA31_DOM_RESULT=".length));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

function assertDomSelection(snapshot, shotId, shotCount, context = "") {
  assert.equal(snapshot.activeShotId, shotId, `${context}: workspace active shot`);
  assert.equal(snapshot.relayActiveShotId, shotId);
  assert.equal(snapshot.rendererActiveShotId, shotId);
  assert.equal(snapshot.p1ActiveShotId, shotId);
  assert.equal(snapshot.summaryShotId, shotId);
  assert.equal(snapshot.headingText, snapshot.expectedHeading, `${context}: authoritative current-shot heading`);
  assert.notEqual(snapshot.headingText, "尚未选择镜头", `${context}: stale P1 must not clear heading`);
  assert.deepEqual(snapshot.activeCards, [shotId]);
  assert.deepEqual(snapshot.expandedCards, [shotId]);
  assert.deepEqual(snapshot.visibleBodies, [shotId]);
  assert.equal(snapshot.hiddenBodies.length, shotCount - 1);
  assert.deepEqual(snapshot.activeTimeline, [shotId]);
  assert.deepEqual(snapshot.pressedTimeline, [shotId]);
  assert.equal(typeof snapshot.editorValue, "string");
}

test("Alpha31 real Chromium DOM selects 6/3/12 shots by timeline, card, reverse order, Enter/Space, navigation, and remount", { timeout: 45_000 }, async () => {
  const renderer = await readFile(resolve(root, "src/renderer/index.ts"), "utf8");
  const p1Ui = await readFile(resolve(root, "src/renderer/director-p1-ui.ts"), "utf8");
  const selectionTypeScript = functionSource(renderer, "selectDirectorShot");
  const p1RenderTypeScript = functionSource(p1Ui, "renderCurrentShot");
  const compiled = await transform(`${selectionTypeScript}\n${p1RenderTypeScript}`, { loader: "ts", target: "chrome130" });
  const plans = [
    materialize(emptyProject("dom6"), 30),
    materialize(emptyProject("dom3"), 15),
    materialize(emptyProject("dom12"), 60)
  ];
  const scenarios = plans.map((project) => {
    const ids = ordered(project).map((shot) => shot.shotId);
    return {
      project,
      actions: [
        ...ids.map((shotId) => ({ kind: "click", surface: "timeline", shotId })),
        ...ids.map((shotId) => ({ kind: "click", surface: "card", shotId })),
        ...[...ids].reverse().map((shotId) => ({ kind: "click", surface: "card", shotId })),
        { kind: "key", surface: "timeline", shotId: ids[Math.min(1, ids.length - 1)], key: "Enter" },
        { kind: "key", surface: "card", shotId: ids[Math.min(2, ids.length - 1)], key: "Space" },
        { kind: "navigate" },
        { kind: "remount" }
      ]
    };
  });
  const snapshots = await runChromiumDomScenarios(compiled.code, scenarios);
  let cursor = 0;
  for (const scenario of scenarios) {
    const count = ordered(scenario.project).length;
    assertDomSelection(snapshots[cursor], scenario.project.professional.activeShotId, count, `mount ${count}`);
    cursor += 1;
    for (const action of scenario.actions) {
      const expectedId = action.kind === "click" || action.kind === "key"
        ? action.shotId
        : snapshots[cursor - 1].activeShotId;
      assertDomSelection(snapshots[cursor], expectedId, count, `${count} shots ${JSON.stringify(action)}`);
      if (action.kind === "click" || action.kind === "key") {
        assert.equal(snapshots[cursor].focusedShotId, expectedId);
      }
      cursor += 1;
    }
  }
  assert.equal(cursor, snapshots.length);
});

test("Alpha31 renderer source keeps workspace authority ahead of DOM and Production State", async () => {
  const renderer = await readFile(resolve(root, "src/renderer/index.ts"), "utf8");
  const p1Ui = await readFile(resolve(root, "src/renderer/director-p1-ui.ts"), "utf8");
  const render = functionSource(renderer, "renderDirectorShots");
  const selection = functionSource(renderer, "selectDirectorShot");
  const workspaceControls = functionSource(renderer, "renderDirectorWorkspaceControls");
  const p1CurrentShot = functionSource(p1Ui, "renderCurrentShot");
  assert.match(render, /workspacePlan\s*=\s*directorWorkspace\s*===\s*null[\s\S]*?directorProjectPlan\(directorWorkspace\.session\.current\)/u);
  assert.match(render, /body\.hidden\s*=\s*true/u);
  assert.match(selection, /workspaceProject\.shots\.some/u);
  assert.match(selection, /body\.hidden\s*=\s*!active/u);
  assert.doesNotMatch(selection, /renderDirectorShots|renderDirectorTimeline|replaceChildren/u);
  assert.match(workspaceControls, /directorCurrentShotHeading\.textContent\s*=\s*`\$\{ordered\[index\]\?\.scene\.name/u);
  assert.doesNotMatch(p1Ui, /requiredElement<HTMLElement>\("director-p1-current-shot-heading"\)/u);
  assert.doesNotMatch(p1CurrentShot, /currentShotHeading|director-p1-current-shot-heading/u);
});
