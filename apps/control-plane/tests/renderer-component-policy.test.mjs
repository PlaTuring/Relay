import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  componentProgressLabel,
  componentUiPolicy
} from "../src/renderer/component-policy.ts";

const component = (id, state, selected = false, required = false) => Object.freeze({
  id,
  title: id,
  description: id,
  required,
  selected,
  state,
  sizeGiB: 1
});

test("missing FFmpeg stays optional while ComfyUI Desktop or an attached ComfyUI is mandatory", () => {
  const ffmpeg = componentUiPolicy(component("ffmpeg_long_video_optional", "needs_download"));
  assert.equal(ffmpeg.externalVisibleOption, true);
  assert.equal(ffmpeg.checked, false);
  assert.equal(ffmpeg.permanentlyLocked, false);
  assert.equal(ffmpeg.requirementLabel, "可选");
  assert.equal(ffmpeg.stateLabel, "可选安装");

  const desktop = componentUiPolicy(component("comfyui_desktop_optional", "needs_download"));
  assert.equal(desktop.externalVisibleOption, true);
  assert.equal(desktop.detectedExternalReuse, false);
  assert.equal(desktop.checked, true);
  assert.equal(desktop.permanentlyLocked, true);
  assert.equal(desktop.requirementLabel, "必需");
  assert.equal(desktop.stateLabel, "需安装");
  assert.equal(componentProgressLabel(component("comfyui_desktop_optional", "needs_download", true, true), true), "等待安装或配置");
});

test("component transaction labels do not claim that an external installer was executed", async () => {
  const [html, source] = await Promise.all([
    readFile(resolve(import.meta.dirname, "..", "src", "renderer", "index.html"), "utf8"),
    readFile(resolve(import.meta.dirname, "..", "src", "renderer", "index.ts"), "utf8")
  ]);

  assert.match(html, /处理所选组件/u);
  assert.doesNotMatch(html, /下载并安装所选组件/u);
  assert.match(source, /requiresDownload[\s\S]*?下载并配置所选组件/u);
  assert.match(source, /requiresVerification[\s\S]*?校验并使用此环境/u);
  assert.match(source, /使用此环境并继续/u);
  assert.match(source, /所选组件已完成下载、校验与本机配置/u);
  assert.doesNotMatch(source, /真实安装事务已完成/u);
});

test("unverified external candidates stay selected for validation and mandatory Desktop stays locked", () => {
  for (const id of ["ffmpeg_long_video_optional", "comfyui_desktop_optional"]) {
    const found = componentUiPolicy(component(id, "found_unverified"));
    assert.equal(found.detectedExternalReuse, false);
    assert.equal(found.checked, true);
    assert.equal(found.permanentlyLocked, id === "comfyui_desktop_optional");
    assert.equal(found.requirementLabel, id === "comfyui_desktop_optional" ? "必需" : "待校验");
    assert.equal(found.stateLabel, "已找到，待校验");
    assert.equal(found.initialProgressLabel, "等待安装前校验");
    assert.equal(found.initialProgressState, "pending");

    const verified = componentUiPolicy(component(id, "verified_reuse"));
    assert.equal(verified.detectedExternalReuse, true);
    assert.equal(verified.checked, true);
    assert.equal(verified.permanentlyLocked, true);
    assert.equal(verified.requirementLabel, id === "comfyui_desktop_optional" ? "必需" : "已配置");
    assert.equal(
      verified.stateLabel,
      id === "comfyui_desktop_optional" ? "已配置" : "已验证可复用"
    );
    assert.equal(
      verified.initialProgressLabel,
      id === "comfyui_desktop_optional" ? "已保存现有 ComfyUI 配置" : "已验证，可直接复用"
    );
    assert.equal(verified.initialProgressState, "complete");
  }
});

test("every unverified component reports discovery and validation without claiming reuse", () => {
  const cases = [
    ["fl2va_base", true],
    ["turbo_acceleration_recommended", false],
    ["ref2va_optional", false],
    ["pyav_required", true],
    ["ffmpeg_long_video_optional", false],
    ["comfyui_desktop_optional", true]
  ];

  for (const [id, required] of cases) {
    const policy = componentUiPolicy(component(id, "found_unverified", false, required));
    assert.equal(policy.requirementLabel, required ? "必需" : "待校验", `${id} requirement`);
    assert.equal(policy.stateLabel, "已找到，待校验", `${id} state`);
    assert.equal(policy.initialProgressLabel, "等待安装前校验", `${id} progress`);
    assert.equal(policy.initialProgressState, "pending", `${id} progress state`);
    assert.doesNotMatch(
      `${policy.requirementLabel} ${policy.stateLabel} ${policy.initialProgressLabel}`,
      /可复用/u,
      `${id} must not claim reuse before validation`
    );
  }
});

test("installation activity disables selectable components without permanently locking them", async () => {
  const source = await readFile(
    resolve(import.meta.dirname, "..", "src", "renderer", "index.ts"),
    "utf8"
  );
  assert.ok(source.includes('checkbox.disabled = active || checkbox.dataset.locked === "true"'));
  assert.ok(source.includes('input.dataset.componentState !== "verified_reuse"'));
  assert.ok(source.includes('article.dataset.externalReuse = String(policy.detectedExternalReuse)'));
  assert.ok(source.includes('if (article.dataset.externalReuse === "true")'));
});
