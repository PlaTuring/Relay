import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";

const repositoryRoot = resolve(import.meta.dirname, "..");
const rendererPath = resolve(repositoryRoot, "apps/control-plane/src/renderer/index.ts");
const renderer = await readFile(rendererPath, "utf8");

function createToastHarness() {
  const startMarker = "// A33_TOAST_LIFECYCLE_START";
  const endMarker = "// A33_TOAST_LIFECYCLE_END";
  const start = renderer.indexOf(startMarker);
  const end = renderer.indexOf(endMarker);
  assert.ok(start >= 0 && end > start, "toast lifecycle must remain an isolated, executable contract");

  const scheduled = new Map();
  const cleared = new Set();
  let nextTimerId = 0;
  let closeHandler = null;
  const appToast = { hidden: true };
  const appToastTitle = { textContent: "" };
  const appToastMessage = { textContent: "" };
  const context = {
    appToast,
    appToastTitle,
    appToastMessage,
    appToastClose: {
      addEventListener(type, handler) {
        assert.equal(type, "click");
        closeHandler = handler;
      }
    },
    window: {
      clearTimeout(timerId) {
        cleared.add(timerId);
      },
      setTimeout(handler, delay) {
        assert.equal(delay, 5200);
        const timerId = ++nextTimerId;
        scheduled.set(timerId, handler);
        return timerId;
      }
    }
  };

  const lifecycle = renderer.slice(start, end);
  const executable = stripTypeScriptTypes(lifecycle, { mode: "transform" });
  runInNewContext(`${executable}\n    globalThis.toastApi = {
      captureToastScope,
      feedbackForScope,
      hideToast,
      setToastView,
      showFeedback,
      state: () => ({
        activeToast: activeToast === null ? null : { ...activeToast },
        currentToastView,
        hidden: appToast.hidden,
        message: appToastMessage.textContent,
        navigationRevision: toastNavigationRevision,
        timerId: appToastTimer,
        title: appToastTitle.textContent
      })
    };`, context);

  return {
    api: context.toastApi,
    cleared,
    close: () => closeHandler(),
    fireEvenIfCleared(timerId) {
      const handler = scheduled.get(timerId);
      assert.equal(typeof handler, "function", `missing timer ${timerId}`);
      handler();
    }
  };
}

function success(title) {
  return { kind: "success", title, message: `${title} message` };
}

test("Alpha 33 wires view changes and async actions into scoped toast feedback", () => {
  assert.match(renderer, /function setToastView\(view: ViewName\)[\s\S]*?if \(currentToastView === view\) return;/u);
  assert.match(renderer, /function showView\(view: ViewName\)[\s\S]*?setToastView\(requestedView\);/u);
  assert.match(renderer, /function runAssetAction\([\s\S]*?const reportFeedback = feedbackForScope\(\);[\s\S]*?await operation\(reportFeedback\);/u);
  assert.match(renderer, /createRelayProject\([\s\S]*?activateRelayProject\(project\.projectId, "project"\);\s*feedbackForScope\(\)\(/u);
  assert.match(renderer, /window\.setTimeout\(\(\) => hideToast\(notificationId\), 5200\)/u);
  assert.doesNotMatch(renderer, /window\.setTimeout\(hideToast, 5200\)/u);
});

test("project success disappears immediately on About, install, and import views", () => {
  const { api } = createToastHarness();
  for (const destination of ["about", "install", "import"]) {
    api.setToastView("project");
    api.showFeedback(success("项目已建立"));
    assert.equal(api.state().hidden, false, "project feedback should be visible on its target view");
    api.setToastView(destination);
    assert.equal(api.state().hidden, true, `project feedback leaked into ${destination}`);
    assert.equal(api.state().activeToast, null);
  }
});

test("same-view navigation preserves current feedback", () => {
  const { api } = createToastHarness();
  api.setToastView("assets");
  api.showFeedback(success("素材已加入项目"));
  const before = api.state();
  api.setToastView("assets");
  const after = api.state();
  assert.equal(after.hidden, false);
  assert.equal(after.activeToast.notificationId, before.activeToast.notificationId);
  assert.equal(after.navigationRevision, before.navigationRevision);
});

test("async feedback cannot attach itself to a later view or a leave-and-return revision", () => {
  const { api } = createToastHarness();
  api.setToastView("assets");
  const delayedFeedback = api.feedbackForScope();
  api.setToastView("about");
  delayedFeedback(success("素材已加入项目"));
  assert.equal(api.state().hidden, true, "an assets operation must not report on About");

  api.setToastView("assets");
  const olderAssetsOperation = api.feedbackForScope();
  api.setToastView("install");
  api.setToastView("assets");
  olderAssetsOperation(success("过期素材反馈"));
  assert.equal(api.state().hidden, true, "returning to the same view name must not revive an older operation");

  api.feedbackForScope()(success("当前素材反馈"));
  assert.equal(api.state().hidden, false, "feedback captured in the current revision remains valid");
});

test("old timers cannot close a newer notification", () => {
  const { api, cleared, fireEvenIfCleared } = createToastHarness();
  api.setToastView("home");
  api.showFeedback(success("第一条"));
  const first = api.state();
  api.showFeedback(success("第二条"));
  const second = api.state();
  assert.notEqual(second.activeToast.notificationId, first.activeToast.notificationId);
  assert.ok(cleared.has(first.timerId), "replacing a toast must cancel its timer");

  fireEvenIfCleared(first.timerId);
  assert.equal(api.state().hidden, false);
  assert.equal(api.state().title, "第二条");
  assert.equal(api.state().timerId, second.timerId);

  fireEvenIfCleared(second.timerId);
  assert.equal(api.state().hidden, true);
  assert.equal(api.state().activeToast, null);
});

test("a stale timer cannot erase feedback started on the newly selected page", () => {
  const { api, close, fireEvenIfCleared } = createToastHarness();
  api.setToastView("project");
  api.showFeedback(success("项目已建立"));
  const projectTimer = api.state().timerId;

  api.setToastView("about");
  api.showFeedback(success("当前页面反馈"));
  const aboutToast = api.state();
  fireEvenIfCleared(projectTimer);
  assert.equal(api.state().hidden, false);
  assert.equal(api.state().activeToast.notificationId, aboutToast.activeToast.notificationId);
  assert.equal(api.state().title, "当前页面反馈");

  close();
  assert.equal(api.state().hidden, true);
  assert.equal(api.state().activeToast, null);
});
