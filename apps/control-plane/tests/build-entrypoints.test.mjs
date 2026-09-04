import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const projectRoot = resolve(import.meta.dirname, "..");
const read = (relativePath) => readFile(resolve(projectRoot, relativePath), "utf8");

test("development, smoke and Setup-only default Windows package entrypoints are explicit", async () => {
  const packageJson = JSON.parse(await read("package.json"));

  assert.deepEqual(
    Object.fromEntries(
      [
        "dev", "start", "build", "typecheck", "test", "smoke",
        "dist", "dist:win", "dist:portable", "package:dir"
      ].map(
        (name) => [name, packageJson.scripts[name]]
      )
    ),
    {
      dev: "node scripts/start.mjs --dev",
      start: "node scripts/start.mjs",
      build: "node scripts/build.mjs",
      typecheck: "node scripts/typecheck.mjs",
      test: "node scripts/test.mjs",
      smoke: "node scripts/smoke.mjs",
      dist: "node scripts/package.mjs --target nsis",
      "dist:win": "node scripts/package.mjs --target nsis",
      "dist:portable": "node scripts/package.mjs --target portable",
      "package:dir": "node scripts/package.mjs --dir"
    }
  );
  assert.equal(packageJson.scripts.preinstall, undefined);
  assert.equal(packageJson.scripts.install, undefined);
  assert.equal(packageJson.scripts.postinstall, undefined);
  assert.equal(packageJson.scripts.publish, undefined);
});

test("electron-builder is unsigned, never publishes and keeps Portable opt-in", async () => {
  const [packageJson, packageScript, offlineVerify] = await Promise.all([
    read("package.json").then(JSON.parse),
    read("scripts/package.mjs"),
    read("scripts/verify-offline.mjs")
  ]);
  const targets = packageJson.build.win.target.map(({ target, arch }) => ({ target, arch }));

  assert.deepEqual(targets, [
    { target: "nsis", arch: ["x64"] },
    { target: "portable", arch: ["x64"] }
  ]);
  assert.equal(packageJson.build.forceCodeSigning, false);
  assert.equal(packageJson.build.win.sign, undefined);
  assert.equal(packageJson.build.publish, null);
  assert.equal(packageJson.build.asar, true);
  assert.deepEqual(packageJson.build.asarUnpack, ["dist/main/native/*"]);
  assert.equal(packageJson.name, "minimax-h3-control-plane");
  assert.equal(packageJson.build.appId, "io.github.platuring.relay");
  assert.equal(packageJson.build.productName, "Relay");
  assert.equal(packageJson.build.win.executableName, "Relay");
  assert.equal(packageJson.build.win.icon, "src/renderer/assets/relay-icon.ico");
  assert.equal(packageJson.build.nsis.installerIcon, "src/renderer/assets/relay-icon.ico");
  assert.equal(packageJson.build.nsis.uninstallerIcon, "src/renderer/assets/relay-icon.ico");
  assert.equal(packageJson.build.nsis.installerHeader, "src/renderer/assets/relay-installer-header.bmp");
  assert.equal(packageJson.build.nsis.installerSidebar, "src/renderer/assets/relay-installer-sidebar.bmp");
  assert.equal(packageJson.build.nsis.uninstallerSidebar, "src/renderer/assets/relay-installer-sidebar.bmp");
  assert.equal(packageJson.build.nsis.installerHeaderIcon, undefined);
  assert.equal(packageJson.build.electronDist, "node_modules/electron/dist");
  assert.equal(packageJson.build.nsis.runAfterFinish, true);
  assert.equal(packageJson.build.nsis.allowElevation, false);
  assert.equal(packageJson.build.nsis.createDesktopShortcut, true);
  assert.equal(packageJson.build.nsis.createStartMenuShortcut, true);
  assert.equal(packageJson.build.directories.output, "release-unsigned");
  assert.ok(packageScript.includes('"--publish", "never"'));
  assert.ok(packageScript.includes('packageEnvironment.CSC_IDENTITY_AUTO_DISCOVERY = "false"'));
  assert.ok(packageScript.includes('resolve(projectRoot, ".build-cache")'));
  assert.ok(packageScript.includes("PACKAGE.CACHE_CONTAINMENT_FAILED"));
  assert.ok(packageScript.includes("packageEnvironment.ELECTRON_BUILDER_CACHE = builderCache"));
  assert.ok(packageScript.includes('process.stdout.write("PACKAGE unsigned=1 publish=never interactive_launch=0'));
  assert.ok(packageScript.includes('createHash("sha256")'));
  assert.ok(packageScript.includes('"SHA256SUMS.txt"'));
  assert.ok(packageScript.includes("PACKAGE_CHECKSUMS count="));
  assert.doesNotMatch(packageScript, /npm_config_offline\s*=\s*["']false["']/u);
  assert.ok(packageScript.includes('rm(resolve(projectRoot, "release-unsigned", fileName), { force: true })'));
  assert.ok(packageScript.includes('await rm(probeProfileRoot, { recursive: true, force: true })'));
  assert.ok(
    packageScript.indexOf('resolve(nativeEvidenceRoot, "packaged-app-native-call.json")') <
    packageScript.lastIndexOf('process.stdout.write(`PACKAGE_CHECKSUMS count=')
  );
  assert.ok(packageScript.includes('probeEnvironment.MINIMAX_H3_PACKAGED_PROBE = "1"'));
  assert.ok(packageScript.includes('`--user-data-dir=${probeUserData}`'));
  assert.ok(packageScript.includes("PACKAGED_ADAPTER_READY streamA=stream_a_cli streamB=stream_b_cli"));
  assert.ok(packageScript.includes("PACKAGE_NATIVE_HELPER"));
  assert.ok(packageScript.includes("verify-native-helper.mjs"));
  assert.ok(packageScript.includes('"Relay.exe"'));
  assert.doesNotMatch(packageScript, /shell\s*:\s*true/u);
  assert.ok(offlineVerify.includes('throw new Error("RELEASE_GATE.PACKAGE_EVIDENCE_REQUIRED")'));
  assert.ok(offlineVerify.includes('throw new Error("RELEASE_GATE.INSTALLER_EVIDENCE_REQUIRED")'));
  assert.ok(offlineVerify.includes('? [releaseArtifactName("portable"), releaseArtifactName("setup")]'));
  assert.ok(offlineVerify.includes(': [releaseArtifactName("setup")]'));
  assert.ok(offlineVerify.includes('? "passed_setup_portable_exact_sha256"'));
  assert.ok(offlineVerify.includes(': "passed_setup_exact_sha256"'));
  assert.ok(offlineVerify.includes('status: sourceOnly ? "source_only_passed" : "release_passed"'));
  assert.ok(offlineVerify.includes("installer_runtime_gate: installerGate"));
  assert.doesNotMatch(offlineVerify, /installer_vm_gate/u);
  assert.equal(packageJson.devDependencies["electron-updater"], undefined);
});

test("Relay assets are copied into the renderer and applied to all app-owned Windows windows", async () => {
  const [buildScript, main, handoff] = await Promise.all([
    read("scripts/build.mjs"),
    read("src/main/main.ts"),
    read("src/main/services/comfy-handoff.ts")
  ]);

  assert.ok(buildScript.includes('resolve(projectRoot, "src", "renderer", "assets")'));
  assert.ok(buildScript.includes('resolve(dist, "renderer", "assets")'));
  assert.ok(buildScript.includes("{ recursive: true }"));
  assert.ok(main.includes('"assets", "relay-icon.png"'));
  assert.ok(main.includes('app.setAppUserModelId("io.github.platuring.relay")'));
  assert.ok(handoff.includes('"assets", "relay-icon.png"'));
});

test("all child process entrypoints use argument arrays with shell disabled", async () => {
  const scripts = await Promise.all(
    ["build-native-helper.mjs", "build.mjs", "lib.mjs", "package.mjs", "smoke.mjs", "start.mjs", "test.mjs", "typecheck.mjs", "verify-native-helper.mjs"].map(
      async (name) => ({ name, text: await read(`scripts/${name}`) })
    )
  );

  for (const { name, text } of scripts) {
    if (text.includes("spawn")) {
      assert.ok(text.includes("shell: false"), `${name} must disable shell execution`);
    }
    assert.doesNotMatch(
      text,
      /import\s*\{[^}]*\bexec(?:File|Sync)?\b[^}]*\}\s*from\s*"node:child_process"/u
    );
    assert.doesNotMatch(text, /(?:cmd(?:\.exe)?|powershell(?:\.exe)?|pwsh(?:\.exe)?)\b/iu);
  }
});

test("the packaged native helper exposes only the enabled read-only profile and is probed at startup", async () => {
  const [profile, client, main, buildScript] = await Promise.all([
    read("../../native/relay-winbroker/capability-profile.v1.json").then(JSON.parse),
    read("src/main/services/native-helper-client.ts"),
    read("src/main/main.ts"),
    read("scripts/build-native-helper.mjs")
  ]);

  assert.equal(profile.profile_id, "relay.win32.path-inspection");
  assert.deepEqual(profile.enabled_operations.map(({ opcode }) => opcode), [257, 258]);
  assert.deepEqual(profile.reserved_not_enabled_opcodes, [259, 513, 514, 769, 770, 771]);
  assert.equal(profile.transport.network, false);
  assert.equal(profile.transport.shell, false);
  assert.ok(client.includes('spawnSync(helperPath, [PROFILE_ARGUMENT]'));
  assert.ok(client.includes("shell: false"));
  assert.ok(client.includes("enabledOpcodes: readonly [257, 258]"));
  assert.ok(main.includes("verifyNativeHelperAtStartup"));
  assert.ok(main.includes('await mkdir(userDataPath, { recursive: true })'));
  assert.ok(
    main.indexOf("verifyNativeHelperAtStartup") <
    main.indexOf('await mkdir(userDataPath, { recursive: true })')
  );
  assert.doesNotMatch(main, /verifyNativeHelperAtStartup\(\{[\s\S]{0,300}\buserDataPath\b/u);
  assert.ok(main.includes("PACKAGED_NATIVE_HELPER_READY"));
  assert.ok(buildScript.includes('resolve(distNativeRoot, "capability-profile.v1.json")'));
  assert.doesNotMatch(client, /\/prompt|queue_prompt|media_generation/u);
});

test("smoke launches only the bundled Electron child and requires the fixed ready marker", async () => {
  const [smoke, main] = await Promise.all([
    read("scripts/smoke.mjs"),
    read("src/main/main.ts")
  ]);

  assert.ok(smoke.includes('const readyMarker = "CONTROL_PLANE_UI_READY"'));
  assert.ok(smoke.includes('runtimeEnvironment.MINIMAX_H3_SMOKE = "1"'));
  assert.ok(smoke.includes('`--user-data-dir=${smokeUserData}`'));
  assert.ok(smoke.includes('"node_modules",\n  "electron",\n  "dist"'));
  assert.ok(smoke.includes("child.kill()"));
  assert.ok(smoke.includes("timeoutMilliseconds = 20_000"));
  assert.doesNotMatch(smoke, /shell\s*:\s*true/u);
  assert.ok(main.includes("chooseInitialDataRootCandidate({ legacySetup, userDataPath, headlessMode, dDriveAvailable })"));
  assert.ok(main.includes("const candidate = pointer?.dataRoot"));
  assert.ok(main.includes("initialDataRootCandidate(legacySetup, userDataPath)"));
});

test("build retains hardened fuses and exact direct dependency versions", async () => {
  const packageJson = JSON.parse(await read("package.json"));

  assert.deepEqual(packageJson.build.electronFuses, {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true
  });
  for (const version of Object.values(packageJson.devDependencies)) {
    assert.match(version, /^\d+\.\d+\.\d+$/u);
  }
});
