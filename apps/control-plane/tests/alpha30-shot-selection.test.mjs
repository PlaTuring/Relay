import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { transform } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const renderer = await readFile(resolve(root, "src/renderer/index.ts"), "utf8");

function functionSource(name) {
  const marker = `function ${name}(`;
  const start = renderer.indexOf(marker);
  assert.notEqual(start, -1, `missing function: ${name}`);
  const parametersStart = renderer.indexOf("(", start + `function ${name}`.length);
  let parametersDepth = 0;
  let parametersEnd = -1;
  for (let index = parametersStart; index < renderer.length; index += 1) {
    if (renderer[index] === "(") parametersDepth += 1;
    if (renderer[index] === ")") {
      parametersDepth -= 1;
      if (parametersDepth === 0) {
        parametersEnd = index;
        break;
      }
    }
  }
  const bodyStart = renderer.indexOf("{", parametersEnd);
  assert.notEqual(bodyStart, -1, `missing body: ${name}`);
  let depth = 0;
  for (let index = bodyStart; index < renderer.length; index += 1) {
    if (renderer[index] === "{") depth += 1;
    if (renderer[index] === "}") {
      depth -= 1;
      if (depth === 0) return renderer.slice(start, index + 1);
    }
  }
  throw new Error(`unterminated function: ${name}`);
}

function sliceBetween(startMarker, endMarker) {
  const start = renderer.indexOf(startMarker);
  const end = renderer.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  assert.ok(end > start, `missing end marker after ${startMarker}: ${endMarker}`);
  return renderer.slice(start, end);
}

class FakeClassList {
  #values = new Set();

  toggle(name, force) {
    if (force === true) this.#values.add(name);
    else if (force === false) this.#values.delete(name);
    else if (this.#values.has(name)) this.#values.delete(name);
    else this.#values.add(name);
    return this.#values.has(name);
  }

  contains(name) {
    return this.#values.has(name);
  }
}

class FakeControl {
  constructor() {
    this.classList = new FakeClassList();
    this.attributes = new Map();
    this.focusCount = 0;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  focus() {
    this.focusCount += 1;
  }
}

class FakeShotCard extends FakeControl {
  constructor(shotId, draft) {
    super();
    this.dataset = { directorShotId: shotId };
    this.header = new FakeControl();
    this.editor = new FakeControl();
    this.editor.value = draft;
    this.scrollCount = 0;
  }

  querySelector(selector) {
    if (selector === ".director-shot-toggle") return this.header;
    if (selector === ".director-shot-description") return this.editor;
    return null;
  }

  scrollIntoView() {
    this.scrollCount += 1;
  }
}

class FakeTimelineItem extends FakeControl {
  constructor(shotId) {
    super();
    this.dataset = { directorShotId: shotId };
  }
}

function shotIdFromSelector(selector) {
  return selector.match(/\[data-director-shot-id="([^"]+)"\]/u)?.[1] ?? null;
}

function selectionDom(shotIds) {
  const cards = shotIds.map((shotId, index) => new FakeShotCard(shotId, `draft-${index + 1}`));
  const timeline = shotIds.map((shotId) => new FakeTimelineItem(shotId));
  return {
    cards,
    timeline,
    directorShotList: {
      querySelector: (selector) => cards.find((card) => card.dataset.directorShotId === shotIdFromSelector(selector)) ?? null,
      querySelectorAll: () => cards,
      replaceChildren: () => assert.fail("plain selection must not rebuild the shot list")
    },
    directorTimelineTrack: {
      querySelectorAll: () => timeline,
      replaceChildren: () => assert.fail("plain selection must not rebuild the timeline")
    }
  };
}

function projectWithActiveShot(shotIds, activeShotId) {
  return {
    projectId: "project-alpha30-shot-selection",
    shots: shotIds.map((shotId) => ({ shotId, archived: false })),
    professional: { activeShotId }
  };
}

async function createSelectionHarness({ shotIds, activeShotId, workspace = true, staleFallbackShotId = null }) {
  const authoritative = functionSource("authoritativeDirectorShotId");
  const selection = functionSource("selectDirectorShot");
  const harnessSource = `
    function createHarness(deps: any) {
      let directorWorkspace = deps.directorWorkspace;
      let activeRelayProject = deps.activeRelayProject;
      let directorActiveShotId = deps.directorActiveShotId;
      const directorShotList = deps.directorShotList;
      const directorTimelineTrack = deps.directorTimelineTrack;
      const directorP1Ui = deps.directorP1Ui;
      const focusProjectWorkspaceShot = deps.focusProjectWorkspaceShot;
      const scheduleDirectorWorkspaceAutosave = deps.scheduleDirectorWorkspaceAutosave;
      const preferredScrollBehavior = () => "auto";
      const CSS = { escape: (value: string) => value };
      const renderDirectorWorkspaceControls = () => deps.renderDirectorWorkspaceControls(
        directorWorkspace?.session.current.professional.activeShotId ?? directorActiveShotId
      );
      ${authoritative}
      ${selection}
      return {
        selectDirectorShot,
        authoritativeDirectorShotId,
        snapshot: () => ({ directorWorkspace, activeRelayProject, directorActiveShotId })
      };
    }
    globalThis.__alpha30CreateSelectionHarness = createHarness;
  `;
  const compiled = await transform(harnessSource, { loader: "ts", format: "iife", target: "es2022" });
  new Function(compiled.code)();
  const createHarness = globalThis.__alpha30CreateSelectionHarness;
  delete globalThis.__alpha30CreateSelectionHarness;

  const dom = selectionDom(shotIds);
  const project = projectWithActiveShot(shotIds, activeShotId);
  const calls = {
    workspaceFocus: [],
    autosave: 0,
    productionUi: [],
    summaries: []
  };
  const dependencies = {
    ...dom,
    directorWorkspace: workspace ? { session: { current: project } } : null,
    activeRelayProject: project,
    directorActiveShotId: staleFallbackShotId,
    focusProjectWorkspaceShot: (controller, input) => {
      calls.workspaceFocus.push(input.shotId);
      return {
        ...controller,
        session: {
          current: {
            ...controller.session.current,
            professional: {
              ...controller.session.current.professional,
              activeShotId: input.shotId
            }
          }
        }
      };
    },
    scheduleDirectorWorkspaceAutosave: () => {
      calls.autosave += 1;
    },
    directorP1Ui: {
      setActiveShot: (shotId) => calls.productionUi.push({ kind: "select", shotId }),
      focusField: (shotId, field) => {
        calls.productionUi.push({ kind: "field", shotId, field });
        return true;
      }
    },
    renderDirectorWorkspaceControls: (shotId) => calls.summaries.push(shotId)
  };
  return { harness: createHarness(dependencies), dom, calls };
}

function assertSingleSelection(dom, selectedShotId) {
  const activeCards = dom.cards.filter((card) => card.classList.contains("is-active"));
  const expandedHeaders = dom.cards.filter((card) => card.header.getAttribute("aria-expanded") === "true");
  const activeTimelineItems = dom.timeline.filter((item) => item.classList.contains("is-active"));
  const pressedTimelineItems = dom.timeline.filter((item) => item.getAttribute("aria-pressed") === "true");
  assert.deepEqual(activeCards.map((card) => card.dataset.directorShotId), [selectedShotId]);
  assert.deepEqual(expandedHeaders.map((card) => card.dataset.directorShotId), [selectedShotId]);
  assert.deepEqual(activeTimelineItems.map((item) => item.dataset.directorShotId), [selectedShotId]);
  assert.deepEqual(pressedTimelineItems.map((item) => item.dataset.directorShotId), [selectedShotId]);
}

test("Alpha 30 wires each shot selection gesture through one transaction", () => {
  const renderTimeline = functionSource("renderDirectorTimeline");
  const renderShots = functionSource("renderDirectorShots");
  const selector = functionSource("selectDirectorShot");

  assert.match(renderTimeline, /item\.type\s*=\s*"button"/u);
  assert.match(renderTimeline, /item\.addEventListener\("click",\s*\(\)\s*=>\s*\{[\s\S]*?selectDirectorShot/u);
  assert.match(renderShots, /header\.type\s*=\s*"button"/u);
  assert.match(renderShots, /header\.addEventListener\("click",\s*\(\)\s*=>\s*selectDirectorShot/u);
  assert.doesNotMatch(renderShots, /pointerdown/u);
  assert.doesNotMatch(renderShots, /textarea\.addEventListener\("focus"[\s\S]*?DirectorShot/u);
  assert.doesNotMatch(renderer, /activateDirectorShot/u);
  assert.doesNotMatch(selector, /renderDirectorShots|renderDirectorTimeline|replaceChildren/u);
  assert.equal((selector.match(/directorP1Ui\.(?:setActiveShot|focusField)\(/gu) ?? []).length, 2);
});

test("Alpha 30 selects 1→2→3 and 3→2→1 with one authoritative active shot and intact drafts", async () => {
  const shotIds = ["shot-1", "shot-2", "shot-3"];
  const { harness, dom, calls } = await createSelectionHarness({
    shotIds,
    activeShotId: "shot-1",
    staleFallbackShotId: "shot-stale"
  });
  const draftValues = dom.cards.map((card) => card.editor.value);
  const sequence = ["shot-1", "shot-2", "shot-3", "shot-3", "shot-2", "shot-1"];

  for (const shotId of sequence) {
    const beforeUiCalls = calls.productionUi.length;
    assert.equal(harness.selectDirectorShot(shotId, { focusEditor: true, scroll: true }), true);
    assert.equal(calls.productionUi.length, beforeUiCalls + 1, "production UI must synchronize exactly once per selection");
    assert.equal(harness.snapshot().directorWorkspace.session.current.professional.activeShotId, shotId);
    assert.equal(harness.snapshot().directorActiveShotId, shotId);
    assert.equal(calls.productionUi.at(-1).shotId, shotId);
    assert.equal(calls.summaries.at(-1), shotId);
    assertSingleSelection(dom, shotId);
    assert.equal(dom.cards.find((card) => card.dataset.directorShotId === shotId).editor.focusCount > 0, true);
  }

  assert.deepEqual(dom.cards.map((card) => card.editor.value), draftValues, "selection must preserve uncommitted inputs");
  assert.deepEqual(calls.workspaceFocus, ["shot-2", "shot-3", "shot-2", "shot-1"]);
  assert.equal(calls.autosave, calls.workspaceFocus.length);
});

test("Alpha 30 selects all 12 shots and restores the persisted active shot after rerender, navigation, and restart", async () => {
  const shotIds = Array.from({ length: 12 }, (_, index) => `shot-${index + 1}`);
  const first = await createSelectionHarness({ shotIds, activeShotId: "shot-1", staleFallbackShotId: "shot-stale" });

  for (const shotId of shotIds) {
    assert.equal(first.harness.selectDirectorShot(shotId), true);
    assertSingleSelection(first.dom, shotId);
    assert.equal(first.calls.summaries.at(-1), shotId);
  }
  assert.equal(first.calls.productionUi.length, shotIds.length);
  assert.equal(first.harness.snapshot().directorWorkspace.session.current.professional.activeShotId, "shot-12");

  const persistedProject = first.harness.snapshot().directorWorkspace.session.current;
  const afterRerender = await createSelectionHarness({
    shotIds,
    activeShotId: persistedProject.professional.activeShotId,
    staleFallbackShotId: "shot-1"
  });
  assert.equal(afterRerender.harness.authoritativeDirectorShotId(), "shot-12");
  assert.equal(afterRerender.harness.selectDirectorShot(afterRerender.harness.authoritativeDirectorShotId()), true);
  assertSingleSelection(afterRerender.dom, "shot-12");

  const afterRestart = await createSelectionHarness({
    shotIds,
    activeShotId: persistedProject.professional.activeShotId,
    workspace: false,
    staleFallbackShotId: "shot-1"
  });
  assert.equal(afterRestart.harness.authoritativeDirectorShotId(), "shot-12");
  assert.equal(afterRestart.harness.selectDirectorShot(afterRestart.harness.authoritativeDirectorShotId()), true);
  assertSingleSelection(afterRestart.dom, "shot-12");
});

test("Alpha 30 reads editor and summary state from project activeShotId and preserves it across presentation-only navigation", () => {
  const workspaceControls = functionSource("renderDirectorWorkspaceControls");
  const renderShots = functionSource("renderDirectorShots");
  const showView = sliceBetween("function showView", "function formatGiB");

  assert.match(workspaceControls, /activeDirectorWorkspaceShot\(workspace\)/u);
  assert.doesNotMatch(workspaceControls, /currentProjectWorkspaceShot/u);
  assert.match(renderShots, /authoritativeDirectorShotId\(\)/u);
  assert.doesNotMatch(showView, /renderDirectorShots|replaceChildren|activeShotId\s*=/u);
});
