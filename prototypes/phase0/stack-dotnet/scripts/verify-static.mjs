import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const prototypeRoot = resolve(scriptDirectory, "..");
const repositoryRoot = resolve(scriptDirectory, "../../../..");
const passes = [];

function check(id, condition) {
  if (!condition) throw new Error(id);
  passes.push(id);
  process.stdout.write(`PASS ${id}\n`);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function runSanitized(executable, args) {
  const result = spawnSync(executable, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    timeout: 30_000,
  });
  if (result.error || result.status !== 0) throw new Error("sanitized-subprocess");
  return result.stdout.trim();
}

function inspectManagedRoot(candidate, systemDrive) {
  if (
    typeof candidate !== "string" ||
    candidate.length === 0 ||
    candidate.length > 32_767 ||
    candidate.includes("\0") ||
    candidate.startsWith("\\\\") ||
    !/^[A-Za-z]:[\\/]/u.test(candidate)
  ) {
    return { accepted: false };
  }
  const drive = candidate.slice(0, 2).toUpperCase();
  return {
    accepted: true,
    displayPath: candidate,
    drive,
    isSystemDrive: drive === systemDrive.trim().toUpperCase(),
    containsSpaces: /\s/u.test(candidate),
    containsUnicode: /[^\x00-\x7f]/u.test(candidate),
  };
}

async function main() {
  const exactMethods = [
    "GetSecuritySummaryAsync",
    "ChooseManagedRootAsync",
    "InspectManagedRootAsync",
    "RunOwnedChildProbeAsync",
  ];

  const contract = await readJson(resolve(prototypeRoot, "design/comparison-contract.json"));
  const dependencyPlan = await readJson(resolve(prototypeRoot, "design/dependency-plan.json"));
  const fixtures = await readJson(resolve(prototypeRoot, "fixtures/comparison-cases.json"));
  const capturedProbe = await readJson(resolve(prototypeRoot, "evidence/HOST_TOOLCHAIN_PROBE.json"));
  const projectFixture = await readFile(
    resolve(prototypeRoot, "design/StackDotnet.csproj.fixture"),
    "utf8",
  );
  const contractSource = await readFile(
    resolve(prototypeRoot, "design/src/ControlPlaneContracts.cs"),
    "utf8",
  );
  const serviceSource = await readFile(
    resolve(prototypeRoot, "design/src/ControlPlaneService.cs"),
    "utf8",
  );
  const pathSource = await readFile(
    resolve(prototypeRoot, "design/src/ManagedRootPolicy.cs"),
    "utf8",
  );
  const childSource = await readFile(
    resolve(prototypeRoot, "design/src/OwnedChildProbe.cs"),
    "utf8",
  );
  const xaml = await readFile(
    resolve(prototypeRoot, "design/src/MainWindow.xaml.fixture"),
    "utf8",
  );
  const windowSource = await readFile(
    resolve(prototypeRoot, "design/src/MainWindow.xaml.cs"),
    "utf8",
  );
  const allDesignSource = [contractSource, serviceSource, pathSource, childSource, windowSource].join(
    "\n",
  );

  const liveProbeText = runSanitized("pwsh.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-File",
    resolve(prototypeRoot, "scripts/probe-toolchain.ps1"),
  ]);
  const liveProbe = JSON.parse(liveProbeText.split(/\r?\n/u).filter(Boolean).at(-1));
  check(
    "SD-001-host-probe",
    isDeepStrictEqual(liveProbe, capturedProbe) &&
      liveProbe.guarantees.fileWrites === false &&
      liveProbe.guarantees.networkAccess === false &&
      liveProbe.guarantees.privatePathsEmitted === false &&
      liveProbe.guarantees.rawEnvironmentDumped === false,
  );
  check(
    "SD-002-exact-blocked-toolchain",
    capturedProbe.modernDotnet.hostPresent === true &&
      capturedProbe.modernDotnet.sdkPresent === false &&
      capturedProbe.modernDotnet.windowsDesktopRuntimePresent === false &&
      capturedProbe.nativeBuild.windowsSdkKnownRootPresent === false &&
      capturedProbe.nativeBuild.visualStudio2022KnownRootPresent === false &&
      capturedProbe.modernDotnet.frameworkDependentPublishSupported === false &&
      capturedProbe.modernDotnet.selfContainedPublishSupported === false,
  );
  check(
    "SD-003-legacy-not-modern-substitute",
    capturedProbe.legacyFramework.compilerPresent === true &&
      capturedProbe.legacyFramework.wpfRuntimeAssembliesPresent === true &&
      capturedProbe.legacyFramework.referenceTargetingPackPresent === false &&
      capturedProbe.legacyFramework.acceptedAsModernSdkSubstitute === false,
  );
  check(
    "SD-004-product-boundary",
    contract.evidenceKind === "uncompiled-design-fixture" &&
      contract.productBoundary.controlPlaneOnly === true &&
      contract.productBoundary.toolSubmitsFormalQueue === false &&
      contract.productBoundary.toolGeneratesMedia === false &&
      contract.productBoundary.h3GeneratesAfterVisibleUserRunInComfy === true,
  );
  check(
    "SD-005-wpf-choice-is-fixture-only",
    contract.uiChoice.framework === "WPF" &&
      contract.uiChoice.status.startsWith("blocked-") &&
      projectFixture.includes("<TargetFramework>net8.0-windows</TargetFramework>") &&
      projectFixture.includes("<UseWPF>true</UseWPF>") &&
      projectFixture.includes("<FixtureStatus>not-consumed-by-dotnet-sdk</FixtureStatus>"),
  );
  check(
    "SD-006-exact-typed-service-boundary",
    exactMethods.every((method) => contractSource.includes(`${method}(`)) &&
      exactMethods.every((method) => serviceSource.includes(`${method}(`)) &&
      contract.commandSurface.map((entry) => entry.command).join("|") === exactMethods.join("|") &&
      (contractSource.match(/Task<[^\n]+>\s+[A-Za-z]+Async\(/gu) ?? []).length === 4 &&
      !/InvokeAsync\(string\s+command/iu.test(allDesignSource),
  );

  for (const testCase of fixtures.managedRootCases) {
    const actual = inspectManagedRoot(testCase.candidate, testCase.systemDrive);
    for (const [key, expectedValue] of Object.entries(testCase.expected)) {
      check(
        `SD-007-path-${testCase.name}-${key}`,
        actual[key] === expectedValue,
      );
    }
  }
  for (const testCase of fixtures.suggestionCases) {
    const actual = testCase.supportedDrives.some((drive) => drive.toUpperCase() === "D:")
      ? "D:\\MiniMaxH3"
      : null;
    check(`SD-008-suggestion-${testCase.name}`, actual === testCase.expected);
  }
  check(
    "SD-009-path-source-shape",
    pathSource.includes("candidate.StartsWith(@\"\\\\\"") &&
      pathSource.includes("candidate[1] != ':'") &&
      pathSource.includes("return supportedFixedNtfsDriveD ? @\"D:\\MiniMaxH3\" : null"),
  );
  check(
    "SD-010-native-folder-picker-static",
    serviceSource.includes("new OpenFolderDialog") &&
      serviceSource.includes("dialog.ShowDialog(owner)") &&
      serviceSource.includes("Multiselect = false"),
  );
  check(
    "SD-011-safe-child-source-shape",
    childSource.includes("FileName = executable") &&
      childSource.includes("UseShellExecute = false") &&
      childSource.includes("startInfo.ArgumentList.Add") &&
      childSource.includes("process.Kill(entireProcessTree: true)") &&
      childSource.includes("await process.WaitForExitAsync") &&
      childSource.includes("ProcessTreeContained: false") &&
      !/["'](?:cmd|powershell)\.exe["']/iu.test(childSource),
  );
  check(
    "SD-012-job-object-gap-explicit",
    contract.securityBoundaries.jobObjectStatus.startsWith("blocked-") &&
      !/CreateJobObject|AssignProcessToJobObject|CREATE_SUSPENDED/iu.test(allDesignSource),
  );
  check(
    "SD-013-no-secret-or-dpapi-surface",
    contract.securityBoundaries.secretStorageNeededForSpike === false &&
      contract.securityBoundaries.dpapiStatus.startsWith("not-applicable-") &&
      !/ProtectedData|CredentialManager|CredWrite/iu.test(allDesignSource),
  );
  check(
    "SD-014-no-network-or-formal-run-client",
    !/HttpClient|WebRequest|\/prompt|queue[_-]?submit|Partner API/iu.test(allDesignSource),
  );
  check(
    "SD-015-accessibility-static-foundation",
    xaml.includes('Language="zh-CN"') &&
      xaml.includes("<ScrollViewer") &&
      xaml.includes("<Button") &&
      xaml.includes('MinHeight="44"') &&
      xaml.includes('AutomationProperties.LiveSetting="Polite"') &&
      xaml.includes('AutomationProperties.HelpText='),
  );
  const buttonLabels = [...xaml.matchAll(/<Button\b[^>]*Content="([^"]+)"/giu)].map(
    (match) => match[1],
  );
  check(
    "SD-016-no-tool-side-generation-action",
    buttonLabels.length === 2 &&
      buttonLabels.every((label) => !/(?:Run|运行|生成|排队|提交)/iu.test(label)) &&
      xaml.includes("用户在可见的 ComfyUI 中点击 Run"),
  );
  check(
    "SD-017-dependency-honesty",
    dependencyPlan.status === "blocked-exact-resolution-unavailable" &&
      dependencyPlan.nugetRestorePerformed === false &&
      dependencyPlan.plannedRoles.every(
        (entry) => entry.exactPackage === null && entry.exactVersion === null &&
          entry.resolutionStatus.startsWith("blocked-"),
      ),
  );

  const noSelfUpdateOutput = runSanitized(process.execPath, [
    resolve(repositoryRoot, "prototypes/phase0/no-self-update/lint-no-self-update.mjs"),
    prototypeRoot,
  ]);
  check(
    "SD-018-alpha-no-self-update",
    noSelfUpdateOutput.startsWith("PASS alpha-no-self-update"),
  );
  const publicLintOutput = runSanitized(process.execPath, [
    resolve(prototypeRoot, "scripts/lint-public-evidence.mjs"),
  ]);
  const publicLintResult = JSON.parse(publicLintOutput.split(/\r?\n/u).filter(Boolean).at(-1));
  check(
    "SD-019-public-evidence-hygiene",
    publicLintResult.status === "pass" && publicLintResult.filesScanned > 0,
  );

  const blocked = [
    "modern .NET SDK build, analyzers and compiled tests",
    "WPF runtime launch and typed service dispatch",
    "native folder picker behavior and focus restoration",
    "owned-child ArgumentList, readiness, cancellation and termination runtime evidence",
    "Windows Job Object pre-execution descendant containment",
    "framework-dependent publish output and runtime compatibility",
    "self-contained win-x64 publish output and runtime inventory",
    "WinUI and Windows App SDK build/runtime comparison",
    "MSIX MSI or EXE per-user package build and VM behavior",
    "Authenticode signing and RFC3161 timestamp verification",
    "installer/unpacked size startup time and idle memory",
    "Narrator keyboard high-contrast and 200-percent scaling",
    "NuGet assets lock SBOM license advisory and binary provenance",
    "DPAPI or Credential Manager implementation because no spike secret is authorized",
  ];
  for (const item of blocked) process.stdout.write(`BLOCKED ${item}\n`);
  process.stdout.write(
    `${JSON.stringify({ event: "stack-dotnet-static-verify", status: "pass", passed: passes.length, blocked: blocked.length })}\n`,
  );
}

main().catch((error) => {
  const id = error instanceof Error && /^SD-\d+/u.test(error.message) ? error.message : "internal";
  process.stderr.write(`Stack .NET static verification failed at ${id}; diagnostics suppressed.\n`);
  process.exitCode = 1;
});
