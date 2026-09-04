using ManagedProcessOwnership;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace ManagedProcessOwnershipHarness
{
    internal sealed class TestResult
    {
        public string Id;
        public bool Passed;
        public string Code;
    }

    internal sealed class TestContext
    {
        public string HarnessPath;
        public string ChildPath;
        public string GenerationRoot;
        public string WorkRoot;
        public string EvidencePath;
        public string ChildHash;
        public int Sequence;

        public string NewDirectory(string label)
        {
            Sequence++;
            string path = Path.Combine(WorkRoot, Sequence.ToString("D2", CultureInfo.InvariantCulture) + "-" + label);
            Directory.CreateDirectory(path);
            return path;
        }

        public LaunchSpec NewSpec(string label, string responseMode)
        {
            string directory = NewDirectory(label);
            return CreateSpec(ChildPath, GenerationRoot, directory, ChildHash, label, responseMode);
        }

        public static LaunchSpec CreateSpec(
            string childPath,
            string generationRoot,
            string workDirectory,
            string childHash,
            string label,
            string responseMode)
        {
            return new LaunchSpec
            {
                ExecutablePath = childPath,
                GenerationRoot = generationRoot,
                WorkingDirectory = generationRoot,
                TempDirectory = workDirectory,
                ExpectedExecutableSha256 = childHash,
                InstructionMarkerPath = Path.Combine(workDirectory, "instruction.marker"),
                BindAddress = "127.0.0.1",
                RequestedPort = 0,
                DecoyPort = 0,
                ResponseMode = responseMode,
                LiteralLabel = label,
                RuntimeReadLease = RuntimeReadLeaseReceipt.AcquireFakeForCurrentProcess("gen-fixture-20260827"),
                RequestedJobLimitFlags = NativeMethods.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                Correlations = CorrelationSet.CreateForLaunch(),
                ExpectedIdentity = new ExpectedRuntimeIdentity
                {
                    GenerationId = "gen-fixture-20260827",
                    GenerationManifestSha256 = IdentityTools.Sha256Text("fake-generation-manifest-v1"),
                    BackendRevision = "backend-fixture-4f7c2d1",
                    FrontendRevision = "frontend-fixture-38a6b19",
                    SchemaFingerprint = IdentityTools.Sha256Text("fake-schema-v1")
                }
            };
        }
    }

    internal static class Program
    {
        private static int Main(string[] args)
        {
            Dictionary<string, string> options;
            try
            {
                options = ParseArguments(args);
            }
            catch
            {
                Console.WriteLine("FAIL harness-arguments code=ARGUMENT_FORMAT");
                return 2;
            }

            string mode = Get(options, "mode", "tests");
            if (string.Equals(mode, "crash-owner", StringComparison.Ordinal))
                return RunCrashOwner(options);
            if (string.Equals(mode, "nested-owner", StringComparison.Ordinal))
                return RunNestedOwner(options);
            if (!string.Equals(mode, "tests", StringComparison.Ordinal))
                return 2;
            return RunTests(options);
        }

        private static int RunTests(Dictionary<string, string> options)
        {
            TestContext context = new TestContext
            {
                HarnessPath = Path.GetFullPath(Require(options, "harness")),
                ChildPath = Path.GetFullPath(Require(options, "child")),
                GenerationRoot = Path.GetFullPath(Require(options, "generation-root")),
                WorkRoot = Path.GetFullPath(Require(options, "work")),
                EvidencePath = Path.GetFullPath(Require(options, "evidence"))
            };
            context.ChildHash = IdentityTools.Sha256File(context.ChildPath);
            Directory.CreateDirectory(context.WorkRoot);

            List<TestResult> results = new List<TestResult>();
            Run(results, "MP-001-containment-before-first-instruction", delegate { TestContainmentAndIdentity(context); });
            Run(results, "MP-002-runtime-lease-before-create", delegate { TestRuntimeLeaseRequired(context); });
            Run(results, "MP-003-preassignment-escape-negative-control", delegate { TestPreassignmentEscape(context); });
            Run(results, "MP-004-breakaway-config-and-attempt", delegate { TestBreakaway(context); });
            Run(results, "MP-005-nested-preexisting-job", delegate { TestNestedJob(context); });
            Run(results, "MP-006-pid-creation-identity", delegate { TestPidCreationIdentity(context); });
            Run(results, "MP-007-image-and-generation-allowlist", delegate { TestImageAllowlist(context); });
            Run(results, "MP-008-port-owner-and-transfer", delegate { TestWrongPortOwner(context); });
            Run(results, "MP-009-token-port-and-runtime-identity", delegate { TestHandshakeMismatches(context); });
            Run(results, "MP-010-loopback-only-bind", delegate { TestLoopbackOnly(context); });
            Run(results, "MP-011-contained-egress-capture-boundary", delegate { TestEgressCapture(context); });
            Run(results, "MP-012-shell-metacharacter-literal-argument", delegate { TestShellMetacharacters(context); });
            Run(results, "MP-013-parent-crash-kills-job-tree", delegate { TestParentCrash(context); });
            Run(results, "MP-014-timeout-escalation-preserves-unrelated", delegate { TestTimeoutAndUnrelated(context); });

            WriteEvidence(context.EvidencePath, results);
            int failed = 0;
            foreach (TestResult result in results) if (!result.Passed) failed++;
            Console.WriteLine("RESULT passed=" + (results.Count - failed).ToString(CultureInfo.InvariantCulture)
                + " failed=" + failed.ToString(CultureInfo.InvariantCulture));
            return failed == 0 ? 0 : 1;
        }

        private static void Run(List<TestResult> results, string id, Action action)
        {
            try
            {
                action();
                results.Add(new TestResult { Id = id, Passed = true, Code = "PASS" });
                Console.WriteLine("PASS " + id);
            }
            catch (SafeProtocolException error)
            {
                results.Add(new TestResult { Id = id, Passed = false, Code = error.Code });
                Console.WriteLine("FAIL " + id + " code=" + error.Code);
            }
            catch (Exception error)
            {
                string code = "UNEXPECTED_" + error.GetType().Name.ToUpperInvariant();
                results.Add(new TestResult { Id = id, Passed = false, Code = code });
                Console.WriteLine("FAIL " + id + " code=" + code);
            }
        }

        private static void TestContainmentAndIdentity(TestContext context)
        {
            LaunchSpec spec = context.NewSpec("valid-identity", "valid");
            string tokenOne = IdentityTools.NewLaunchToken();
            string tokenTwo = IdentityTools.NewLaunchToken();
            RequireCondition(tokenOne.Length == 43 && tokenTwo.Length == 43 && tokenOne != tokenTwo, "TOKEN_STRENGTH_FAILED");
            RequireCondition(spec.Correlations.RunCorrelationId == null, "RUN_ID_PREMATURE");
            LaunchAttempt attempt = ManagedLauncher.TryLaunch(spec);
            RequireSuccess(attempt);
            using (ManagedLaunch launch = attempt.Launch)
            {
                RequireCondition(attempt.ContainmentVerifiedBeforeResume && attempt.Resumed, "CONTAINMENT_SEQUENCE_FAILED");
                RequireCondition(File.Exists(spec.InstructionMarkerPath), "FIRST_INSTRUCTION_MARKER_MISSING");
                RequireCondition(launch.Job.Contains(launch.ProcessHandle), "ROOT_JOB_MEMBERSHIP_MISSING");
                RequireCondition(TestNative.IsPidInJob(launch.GrandchildIdentity.ProcessId, launch.Job), "GRANDCHILD_JOB_MEMBERSHIP_MISSING");
                RequireCondition(launch.Job.QueryLimitFlags() == NativeMethods.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, "JOB_LIMIT_FLAGS_WRONG");
                RedactionSummary redaction = launch.CollectRedactionSummary(5000);
                RequireCondition(redaction.StdoutSensitiveLines == 1 && redaction.StderrSensitiveLines == 1 && !redaction.RawValueReturned, "OUTPUT_REDACTION_FAILED");
                ShutdownResult shutdown = launch.Shutdown(5000);
                RequireCondition(shutdown.Graceful && !shutdown.EscalatedToVerifiedJob && shutdown.RootExited, "GRACEFUL_SHUTDOWN_FAILED");
                RequireCondition(!ProcessIdentityTools.IsSameLiveProcess(launch.GrandchildIdentity), "GRANDCHILD_SURVIVED_GRACEFUL_STOP");
            }
        }

        private static void TestRuntimeLeaseRequired(TestContext context)
        {
            LaunchSpec spec = context.NewSpec("missing-runtime-lease", "valid");
            spec.RuntimeReadLease = null;
            LaunchAttempt attempt = ManagedLauncher.TryLaunch(spec);
            RequireFailure(attempt, "RUNTIME_LEASE_REQUIRED", false);
            RequireCondition(!File.Exists(spec.InstructionMarkerPath), "LEASE_FAILURE_EXECUTED_CHILD");

            LaunchSpec mismatch = context.NewSpec("mismatched-runtime-lease", "valid");
            mismatch.RuntimeReadLease = RuntimeReadLeaseReceipt.AcquireFakeForCurrentProcess("different-generation");
            LaunchAttempt mismatchAttempt = ManagedLauncher.TryLaunch(mismatch);
            RequireFailure(mismatchAttempt, "RUNTIME_LEASE_MISMATCH", false);
            RequireCondition(!File.Exists(mismatch.InstructionMarkerPath), "LEASE_MISMATCH_EXECUTED_CHILD");
        }

        private static void TestPreassignmentEscape(TestContext context)
        {
            string directory = context.NewDirectory("unsafe-preassignment-control");
            string resultPath = Path.Combine(directory, "escape.result");
            ProcessIdentity unsafeParent = TestNative.StartOrdinaryProcess(
                context.ChildPath,
                new[] { "--mode", "escape-parent", "--result", resultPath });
            ProcessIdentity escaped = null;
            JobObject lateJob = null;
            try
            {
                WaitForFile(resultPath, 5000);
                string[] fields = WaitForText(resultPath, 5000).Split('|');
                int escapedPid = int.Parse(fields[0], CultureInfo.InvariantCulture);
                long escapedCreation = long.Parse(fields[1], CultureInfo.InvariantCulture);
                escaped = ProcessIdentityTools.CaptureByPid(escapedPid);
                RequireCondition(escaped.CreationFileTime == escapedCreation, "ESCAPE_IDENTITY_INVALID");

                lateJob = JobObject.Create(NativeMethods.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE);
                using (Process parent = Process.GetProcessById(unsafeParent.ProcessId))
                {
                    lateJob.Assign(parent.Handle);
                    RequireCondition(lateJob.Contains(parent.Handle), "LATE_ASSIGN_PARENT_FAILED");
                }
                RequireCondition(!TestNative.IsPidInJob(escaped.ProcessId, lateJob), "NEGATIVE_CONTROL_DID_NOT_ESCAPE");
                RequireCondition(lateJob.Terminate(), "LATE_JOB_TERMINATE_FAILED");
                WaitForGone(unsafeParent.ProcessId, unsafeParent.CreationFileTime, 5000);
                RequireCondition(ProcessIdentityTools.IsSameLiveProcess(escaped), "ESCAPED_CONTROL_NOT_LIVE");
            }
            finally
            {
                if (lateJob != null) lateJob.Dispose();
                if (ProcessIdentityTools.IsSameLiveProcess(unsafeParent)) OwnedStop.TryTerminateExactProcess(unsafeParent);
                if (escaped != null && ProcessIdentityTools.IsSameLiveProcess(escaped)) OwnedStop.TryTerminateExactProcess(escaped);
            }
        }

        private static void TestBreakaway(TestContext context)
        {
            LaunchSpec spec = context.NewSpec("breakaway-flags", "valid");
            spec.RequestedJobLimitFlags = NativeMethods.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | NativeMethods.JOB_OBJECT_LIMIT_BREAKAWAY_OK;
            LaunchAttempt rejected = ManagedLauncher.TryLaunch(spec);
            RequireFailure(rejected, "JOB_FLAGS_REJECTED", false);
            RequireCondition(!File.Exists(spec.InstructionMarkerPath), "BREAKAWAY_CONFIG_EXECUTED_CHILD");

            LaunchSpec validSpec = context.NewSpec("breakaway-attempt", "valid");
            LaunchAttempt valid = ManagedLauncher.TryLaunch(validSpec);
            RequireSuccess(valid);
            using (ManagedLaunch launch = valid.Launch)
            {
                ShutdownResult result = launch.Shutdown(5000);
                RequireCondition(result.RootExited, "BREAKAWAY_ATTEMPT_LAUNCH_STOP_FAILED");
            }
        }

        private static void TestNestedJob(TestContext context)
        {
            string directory = context.NewDirectory("nested-job");
            string marker = Path.Combine(directory, "nested-first.marker");
            string resultPath = Path.Combine(directory, "nested.result");
            List<string> args = new List<string>
            {
                "--mode", "nested-owner",
                "--harness", context.HarnessPath,
                "--child", context.ChildPath,
                "--generation-root", context.GenerationRoot,
                "--work", directory,
                "--result", resultPath,
                "--start-marker", marker
            };
            using (SuspendedJobProcess nested = SuspendedJobTestLauncher.Start(
                context.HarnessPath,
                args,
                context.GenerationRoot,
                directory,
                marker))
            {
                RequireCondition(nested.Wait(10000) == NativeMethods.WAIT_OBJECT_0, "NESTED_OWNER_TIMEOUT");
                WaitForFile(resultPath, 1000);
                string[] fields = WaitForText(resultPath, 5000).Split('|');
                RequireCondition(fields.Length >= 3 && fields[0] == "in-job", "NESTED_OWNER_NOT_PREASSIGNED");
                bool safeSuccess = fields[1] == "success" && fields[2] == "contained";
                bool safeClosed = fields[1] == "failclosed" && fields[2] == "JOB_ASSIGN_FAILED";
                RequireCondition(safeSuccess || safeClosed, "NESTED_JOB_UNSAFE_RESULT");
            }
        }

        private static void TestPidCreationIdentity(TestContext context)
        {
            LaunchSpec spec = context.NewSpec("pid-identity", "valid");
            LaunchAttempt attempt = ManagedLauncher.TryLaunch(spec);
            RequireSuccess(attempt);
            using (ManagedLaunch launch = attempt.Launch)
            {
                ProcessIdentity forged = launch.RootIdentity.Clone();
                forged.CreationFileTime++;
                RequireCondition(!OwnedStop.TryTerminateVerifiedJob(launch.Job, forged), "FORGED_CREATION_TERMINATED_JOB");
                RequireCondition(ProcessIdentityTools.IsSameLiveProcess(launch.RootIdentity), "ROOT_DIED_ON_FORGED_IDENTITY");
                forged = launch.RootIdentity.Clone();
                forged.CanonicalImagePath = Path.Combine(context.WorkRoot, "wrong-image.exe");
                RequireCondition(!OwnedStop.TryTerminateVerifiedJob(launch.Job, forged), "FORGED_IMAGE_TERMINATED_JOB");
                ShutdownResult result = launch.Shutdown(5000);
                RequireCondition(result.RootExited, "PID_IDENTITY_TEST_STOP_FAILED");
            }
        }

        private static void TestImageAllowlist(TestContext context)
        {
            LaunchSpec badHash = context.NewSpec("wrong-image-hash", "valid");
            badHash.ExpectedExecutableSha256 = new string('0', 64);
            RequireFailure(ManagedLauncher.TryLaunch(badHash), "IMAGE_HASH_PREFLIGHT_MISMATCH", false);
            RequireCondition(!File.Exists(badHash.InstructionMarkerPath), "WRONG_IMAGE_EXECUTED");

            LaunchSpec outsideRoot = context.NewSpec("outside-generation-root", "valid");
            outsideRoot.GenerationRoot = outsideRoot.TempDirectory;
            RequireFailure(ManagedLauncher.TryLaunch(outsideRoot), "IMAGE_OUTSIDE_GENERATION_ROOT", false);
            RequireCondition(!File.Exists(outsideRoot.InstructionMarkerPath), "OUTSIDE_ROOT_EXECUTED");
        }

        private static void TestWrongPortOwner(TestContext context)
        {
            TcpListener foreign = new TcpListener(IPAddress.Loopback, 0);
            foreign.Server.ExclusiveAddressUse = true;
            foreign.Start();
            try
            {
                int port = ((IPEndPoint)foreign.LocalEndpoint).Port;
                LaunchSpec spec = context.NewSpec("foreign-port-owner", "valid");
                spec.RequestedPort = port;
                LaunchAttempt attempt = ManagedLauncher.TryLaunch(spec);
                RequireFailure(attempt, "PORT_RESERVATION_FAILED", false);
                RequireCondition(foreign.Server.IsBound, "FOREIGN_PORT_OWNER_MODIFIED");
                RequireCondition(!File.Exists(spec.InstructionMarkerPath), "PORT_FAILURE_EXECUTED_CHILD");
            }
            finally
            {
                foreign.Stop();
            }
        }

        private static void TestHandshakeMismatches(TestContext context)
        {
            AssertContainedFailure(context.NewSpec("stale-token", "stale-token"), "TOKEN_MISMATCH");
            AssertContainedFailure(context.NewSpec("wrong-port", "wrong-port"), "PORT_REPORT_MISMATCH");
            AssertContainedFailure(context.NewSpec("wrong-backend", "wrong-backend"), "RUNTIME_IDENTITY_REPORT_MISMATCH");
            AssertContainedFailure(context.NewSpec("wrong-frontend", "wrong-frontend"), "RUNTIME_IDENTITY_REPORT_MISMATCH");
            AssertContainedFailure(context.NewSpec("wrong-schema", "wrong-schema"), "RUNTIME_IDENTITY_REPORT_MISMATCH");
        }

        private static void TestLoopbackOnly(TestContext context)
        {
            LaunchSpec wildcard = context.NewSpec("wildcard-request", "valid");
            wildcard.BindAddress = "0.0.0.0";
            RequireFailure(ManagedLauncher.TryLaunch(wildcard), "NON_LOOPBACK_BIND_REJECTED", false);
            RequireCondition(!File.Exists(wildcard.InstructionMarkerPath), "WILDCARD_REQUEST_EXECUTED_CHILD");
            AssertContainedFailure(context.NewSpec("wildcard-report", "wildcard-report"), "BIND_REPORT_MISMATCH");
        }

        private static void TestEgressCapture(TestContext context)
        {
            TcpListener decoy = new TcpListener(IPAddress.Loopback, 0);
            decoy.Server.ExclusiveAddressUse = true;
            decoy.Start();
            Task<TcpClient> accepted = decoy.AcceptTcpClientAsync();
            try
            {
                LaunchSpec spec = context.NewSpec("unexpected-egress", "egress");
                spec.DecoyPort = ((IPEndPoint)decoy.LocalEndpoint).Port;
                LaunchAttempt attempt = ManagedLauncher.TryLaunch(spec);
                RequireFailure(attempt, "UNEXPECTED_EGRESS_CAPTURED", true);
                RequireCondition(accepted.Wait(5000), "EGRESS_DECOY_NOT_REACHED");
                using (TcpClient client = accepted.Result)
                {
                    int value = client.GetStream().ReadByte();
                    RequireCondition(value == 0x45, "EGRESS_DECOY_PAYLOAD_WRONG");
                }
            }
            finally
            {
                decoy.Stop();
            }
        }

        private static void TestShellMetacharacters(TestContext context)
        {
            string directory = context.NewDirectory("shell-literal");
            string sentinel = Path.Combine(directory, "must-not-exist.sentinel");
            string label = "literal Ω & echo injected | whoami > \"" + sentinel + "\" ^ % ! ; $(noop)";
            LaunchSpec spec = TestContext.CreateSpec(
                context.ChildPath,
                context.GenerationRoot,
                directory,
                context.ChildHash,
                label,
                "valid");
            LaunchAttempt attempt = ManagedLauncher.TryLaunch(spec);
            RequireSuccess(attempt);
            using (ManagedLaunch launch = attempt.Launch)
            {
                RequireCondition(!File.Exists(sentinel), "SHELL_METACHAR_EXECUTED");
                ShutdownResult result = launch.Shutdown(5000);
                RequireCondition(result.RootExited, "SHELL_LITERAL_STOP_FAILED");
            }
        }

        private static void TestParentCrash(TestContext context)
        {
            string directory = context.NewDirectory("parent-crash");
            string resultPath = Path.Combine(directory, "crash.result");
            ProcessIdentity crashOwner = TestNative.StartOrdinaryProcess(
                context.HarnessPath,
                new[]
                {
                    "--mode", "crash-owner",
                    "--harness", context.HarnessPath,
                    "--child", context.ChildPath,
                    "--generation-root", context.GenerationRoot,
                    "--work", directory,
                    "--result", resultPath
                });
            try
            {
                WaitForFile(resultPath, 10000);
                string[] fields = WaitForText(resultPath, 5000).Split('|');
                RequireCondition(fields.Length == 4, "CRASH_RESULT_FORMAT");
                int childPid = int.Parse(fields[0], CultureInfo.InvariantCulture);
                long childCreation = long.Parse(fields[1], CultureInfo.InvariantCulture);
                int grandPid = int.Parse(fields[2], CultureInfo.InvariantCulture);
                long grandCreation = long.Parse(fields[3], CultureInfo.InvariantCulture);
                WaitForGone(crashOwner.ProcessId, crashOwner.CreationFileTime, 5000);
                WaitForGone(childPid, childCreation, 5000);
                WaitForGone(grandPid, grandCreation, 5000);
            }
            finally
            {
                if (ProcessIdentityTools.IsSameLiveProcess(crashOwner)) OwnedStop.TryTerminateExactProcess(crashOwner);
            }
        }

        private static void TestTimeoutAndUnrelated(TestContext context)
        {
            ProcessIdentity unrelated = TestNative.StartOrdinaryProcess(context.ChildPath, new[] { "--mode", "grandchild" });
            try
            {
                LaunchSpec spec = context.NewSpec("ignore-shutdown", "ignore-shutdown");
                LaunchAttempt attempt = ManagedLauncher.TryLaunch(spec);
                RequireSuccess(attempt);
                using (ManagedLaunch launch = attempt.Launch)
                {
                    ShutdownResult result = launch.Shutdown(250);
                    RequireCondition(!result.Graceful && result.EscalatedToVerifiedJob && result.RootExited, "TIMEOUT_ESCALATION_FAILED");
                    RequireCondition(!ProcessIdentityTools.IsSameLiveProcess(launch.GrandchildIdentity), "JOB_GRANDCHILD_SURVIVED_ESCALATION");
                    RequireCondition(ProcessIdentityTools.IsSameLiveProcess(unrelated), "UNRELATED_PROCESS_TERMINATED");
                }
            }
            finally
            {
                if (ProcessIdentityTools.IsSameLiveProcess(unrelated)) OwnedStop.TryTerminateExactProcess(unrelated);
            }
        }

        private static int RunCrashOwner(Dictionary<string, string> options)
        {
            string child = Path.GetFullPath(Require(options, "child"));
            string generation = Path.GetFullPath(Require(options, "generation-root"));
            string work = Path.GetFullPath(Require(options, "work"));
            string result = Path.GetFullPath(Require(options, "result"));
            LaunchSpec spec = TestContext.CreateSpec(child, generation, work, IdentityTools.Sha256File(child), "crash-owner", "valid");
            LaunchAttempt attempt = ManagedLauncher.TryLaunch(spec);
            if (!attempt.Success) return 20;
            ManagedLaunch launch = attempt.Launch;
            string value = launch.RootIdentity.ProcessId.ToString(CultureInfo.InvariantCulture)
                + "|" + launch.RootIdentity.CreationFileTime.ToString(CultureInfo.InvariantCulture)
                + "|" + launch.GrandchildIdentity.ProcessId.ToString(CultureInfo.InvariantCulture)
                + "|" + launch.GrandchildIdentity.CreationFileTime.ToString(CultureInfo.InvariantCulture);
            DurableWrite(result, value);
            Process.GetCurrentProcess().Kill();
            return 21;
        }

        private static int RunNestedOwner(Dictionary<string, string> options)
        {
            string marker = Path.GetFullPath(Require(options, "start-marker"));
            DurableWrite(marker, "nested-owner-started");
            string child = Path.GetFullPath(Require(options, "child"));
            string generation = Path.GetFullPath(Require(options, "generation-root"));
            string work = Path.GetFullPath(Require(options, "work"));
            string result = Path.GetFullPath(Require(options, "result"));
            bool currentInJob = ProcessIdentityTools.IsCurrentProcessInAnyJob();
            LaunchSpec spec = TestContext.CreateSpec(child, generation, work, IdentityTools.Sha256File(child), "nested-child", "valid");
            spec.InstructionMarkerPath = Path.Combine(work, "nested-child.marker");
            LaunchAttempt attempt = ManagedLauncher.TryLaunch(spec);
            if (attempt.Success)
            {
                using (ManagedLaunch launch = attempt.Launch)
                {
                    bool contained = attempt.ContainmentVerifiedBeforeResume && launch.Job.Contains(launch.ProcessHandle);
                    launch.Shutdown(5000);
                    DurableWrite(result, (currentInJob ? "in-job" : "not-in-job") + "|success|" + (contained ? "contained" : "not-contained"));
                }
            }
            else
            {
                DurableWrite(result, (currentInJob ? "in-job" : "not-in-job") + "|failclosed|" + attempt.FailureCode);
            }
            return 0;
        }

        private static void AssertContainedFailure(LaunchSpec spec, string expectedCode)
        {
            LaunchAttempt attempt = ManagedLauncher.TryLaunch(spec);
            RequireFailure(attempt, expectedCode, true);
            RequireCondition(File.Exists(spec.InstructionMarkerPath), "CONTAINED_FAILURE_MARKER_MISSING");
        }

        private static void RequireSuccess(LaunchAttempt attempt)
        {
            if (attempt == null || !attempt.Success || attempt.Launch == null)
                throw new SafeProtocolException(attempt == null ? "LAUNCH_RESULT_MISSING" : "LAUNCH_FAILED_" + attempt.FailureCode);
        }

        private static void RequireFailure(LaunchAttempt attempt, string expectedCode, bool expectedResumed)
        {
            RequireCondition(attempt != null && !attempt.Success, "EXPECTED_FAILURE_MISSING");
            RequireCondition(string.Equals(attempt.FailureCode, expectedCode, StringComparison.Ordinal), "FAILURE_CODE_MISMATCH");
            RequireCondition(attempt.Resumed == expectedResumed, "FAILURE_RESUME_STATE_MISMATCH");
            RequireCondition(attempt.FailedProcessGone, "FAILED_PROCESS_SURVIVED");
            if (expectedResumed) RequireCondition(attempt.ContainmentVerifiedBeforeResume, "RESUMED_WITHOUT_CONTAINMENT");
        }

        private static void RequireCondition(bool condition, string code)
        {
            if (!condition) throw new SafeProtocolException(code);
        }

        private static void WaitForFile(string path, int timeoutMilliseconds)
        {
            Stopwatch timer = Stopwatch.StartNew();
            while (timer.ElapsedMilliseconds < timeoutMilliseconds)
            {
                if (File.Exists(path)) return;
                Thread.Sleep(20);
            }
            throw new SafeProtocolException("RESULT_FILE_TIMEOUT");
        }

        private static string WaitForText(string path, int timeoutMilliseconds)
        {
            Stopwatch timer = Stopwatch.StartNew();
            while (timer.ElapsedMilliseconds < timeoutMilliseconds)
            {
                try
                {
                    if (File.Exists(path))
                    {
                        string value = File.ReadAllText(path, Encoding.UTF8);
                        if (value.Length > 0) return value;
                    }
                }
                catch (IOException)
                {
                    // The fake writer may have created but not yet flushed its private result file.
                }
                Thread.Sleep(20);
            }
            throw new SafeProtocolException("RESULT_TEXT_TIMEOUT");
        }

        private static void WaitForGone(int pid, long creation, int timeoutMilliseconds)
        {
            Stopwatch timer = Stopwatch.StartNew();
            while (timer.ElapsedMilliseconds < timeoutMilliseconds)
            {
                if (!ProcessIdentityTools.IsPidWithCreationLive(pid, creation)) return;
                Thread.Sleep(20);
            }
            throw new SafeProtocolException("PROCESS_STILL_LIVE");
        }

        private static void DurableWrite(string path, string value)
        {
            using (FileStream stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.Read))
            using (StreamWriter writer = new StreamWriter(stream, new UTF8Encoding(false)))
            {
                writer.Write(value);
                writer.Flush();
                stream.Flush(true);
            }
        }

        private static void WriteEvidence(string path, IList<TestResult> results)
        {
            int failed = 0;
            foreach (TestResult result in results) if (!result.Passed) failed++;
            StringBuilder json = new StringBuilder();
            json.Append("{\n");
            json.Append("  \"schemaVersion\": \"1.0.0\",\n");
            json.Append("  \"task\": \"P0-ARC-010\",\n");
            json.Append("  \"scope\": \"fake-process-loopback-only\",\n");
            json.Append("  \"status\": \"");
            json.Append(failed == 0 ? "pass" : "fail");
            json.Append("\",\n");
            json.Append("  \"passed\": ");
            json.Append((results.Count - failed).ToString(CultureInfo.InvariantCulture));
            json.Append(",\n  \"failed\": ");
            json.Append(failed.ToString(CultureInfo.InvariantCulture));
            json.Append(",\n  \"tests\": [\n");
            for (int index = 0; index < results.Count; index++)
            {
                TestResult result = results[index];
                json.Append("    { \"id\": \"");
                json.Append(JsonEscape(result.Id));
                json.Append("\", \"status\": \"");
                json.Append(result.Passed ? "pass" : "fail");
                json.Append("\", \"code\": \"");
                json.Append(JsonEscape(result.Code));
                json.Append("\" }");
                if (index + 1 < results.Count) json.Append(',');
                json.Append('\n');
            }
            json.Append("  ],\n");
            json.Append("  \"publicEvidence\": { \"containsTokens\": false, \"containsPrivateAbsolutePaths\": false },\n");
            json.Append("  \"productBoundary\": { \"comfyStarted\": false, \"modelUsed\": false, \"gpuUsed\": false, \"promptSubmitted\": false, \"externalNetworkUsed\": false }\n");
            json.Append("}\n");
            File.WriteAllText(path, json.ToString(), new UTF8Encoding(false));
        }

        private static string JsonEscape(string value)
        {
            return value.Replace("\\", "\\\\").Replace("\"", "\\\"");
        }

        private static Dictionary<string, string> ParseArguments(string[] args)
        {
            if (args.Length % 2 != 0) throw new InvalidOperationException();
            Dictionary<string, string> values = new Dictionary<string, string>(StringComparer.Ordinal);
            for (int index = 0; index < args.Length; index += 2)
            {
                string key = args[index];
                if (!key.StartsWith("--", StringComparison.Ordinal)) throw new InvalidOperationException();
                key = key.Substring(2);
                if (values.ContainsKey(key)) throw new InvalidOperationException();
                values.Add(key, args[index + 1]);
            }
            return values;
        }

        private static string Require(Dictionary<string, string> values, string key)
        {
            string value;
            if (!values.TryGetValue(key, out value)) throw new InvalidOperationException();
            return value;
        }

        private static string Get(Dictionary<string, string> values, string key, string fallback)
        {
            string value;
            return values.TryGetValue(key, out value) ? value : fallback;
        }
    }
}
