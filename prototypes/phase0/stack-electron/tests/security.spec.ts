import { describe, expect, it } from "vitest";

import { createRendererWebPreferences } from "../src/main/security";

describe("renderer security preferences", () => {
  it("pins sandbox and context isolation with no Node integration", () => {
    const preferences = createRendererWebPreferences("C:\\fixed path\\preload.js");

    expect(preferences).toMatchObject({
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false
    });
  });
});
