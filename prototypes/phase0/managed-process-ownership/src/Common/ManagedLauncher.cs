using Microsoft.Win32.SafeHandles;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace ManagedProcessOwnership
{
    internal sealed class CreatedSuspendedProcess : IDisposable
    {
        public IntPtr ProcessHandle;
        public IntPtr ThreadHandle;
        public int ProcessId;
        public StreamReader Stdout;
        public StreamReader Stderr;

        public void Dispose()
        {
            if (ThreadHandle != IntPtr.Zero)
            {
                NativeMethods.CloseHandle(ThreadHandle);
                ThreadHandle = IntPtr.Zero;
            }
            if (ProcessHandle != IntPtr.Zero)
            {
                NativeMethods.CloseHandle(ProcessHandle);
                ProcessHandle = IntPtr.Zero;
            }
            if (Stdout != null)
            {
                Stdout.Dispose();
                Stdout = null;
            }
            if (Stderr != null)
            {
                Stderr.Dispose();
                Stderr = null;
            }
        }
    }

    internal static class NativeProcessFactory
    {
        private const uint GENERIC_READ = 0x80000000;
        private const uint FILE_SHARE_READ = 0x00000001;
        private const uint FILE_SHARE_WRITE = 0x00000002;
        private const uint OPEN_EXISTING = 3;
        private const uint FILE_ATTRIBUTE_NORMAL = 0x00000080;

        public static CreatedSuspendedProcess Create(
            string executablePath,
            IList<string> arguments,
            string currentDirectory,
            string tempDirectory,
            IList<IntPtr> additionalInheritedHandles)
        {
            SECURITY_ATTRIBUTES inheritable = new SECURITY_ATTRIBUTES();
            inheritable.nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES));
            inheritable.bInheritHandle = 1;

            IntPtr stdoutRead = IntPtr.Zero;
            IntPtr stdoutWrite = IntPtr.Zero;
            IntPtr stderrRead = IntPtr.Zero;
            IntPtr stderrWrite = IntPtr.Zero;
            IntPtr stdinHandle = IntPtr.Zero;
            IntPtr attributeList = IntPtr.Zero;
            IntPtr handleArray = IntPtr.Zero;
            IntPtr environment = IntPtr.Zero;
            PROCESS_INFORMATION process = new PROCESS_INFORMATION();
            bool processCreated = false;

            try
            {
                if (!NativeMethods.CreatePipe(out stdoutRead, out stdoutWrite, ref inheritable, 0))
                    throw new SafeProtocolException("STDOUT_PIPE_CREATE_FAILED");
                if (!NativeMethods.SetHandleInformation(stdoutRead, NativeMethods.HANDLE_FLAG_INHERIT, 0))
                    throw new SafeProtocolException("STDOUT_PIPE_FLAG_FAILED");
                if (!NativeMethods.CreatePipe(out stderrRead, out stderrWrite, ref inheritable, 0))
                    throw new SafeProtocolException("STDERR_PIPE_CREATE_FAILED");
                if (!NativeMethods.SetHandleInformation(stderrRead, NativeMethods.HANDLE_FLAG_INHERIT, 0))
                    throw new SafeProtocolException("STDERR_PIPE_FLAG_FAILED");

                stdinHandle = NativeMethods.CreateFile(
                    "NUL",
                    GENERIC_READ,
                    FILE_SHARE_READ | FILE_SHARE_WRITE,
                    ref inheritable,
                    OPEN_EXISTING,
                    FILE_ATTRIBUTE_NORMAL,
                    IntPtr.Zero);
                if (stdinHandle == NativeMethods.INVALID_HANDLE_VALUE)
                    throw new SafeProtocolException("STDIN_HANDLE_CREATE_FAILED");

                List<IntPtr> inherited = new List<IntPtr>();
                inherited.Add(stdinHandle);
                inherited.Add(stdoutWrite);
                inherited.Add(stderrWrite);
                if (additionalInheritedHandles != null)
                {
                    foreach (IntPtr handle in additionalInheritedHandles)
                    {
                        inherited.Add(handle);
                    }
                }

                IntPtr attributeSize = IntPtr.Zero;
                NativeMethods.InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref attributeSize);
                attributeList = Marshal.AllocHGlobal(attributeSize);
                if (!NativeMethods.InitializeProcThreadAttributeList(attributeList, 1, 0, ref attributeSize))
                    throw new SafeProtocolException("HANDLE_LIST_INIT_FAILED");

                handleArray = Marshal.AllocHGlobal(IntPtr.Size * inherited.Count);
                for (int index = 0; index < inherited.Count; index++)
                {
                    Marshal.WriteIntPtr(handleArray, index * IntPtr.Size, inherited[index]);
                }
                if (!NativeMethods.UpdateProcThreadAttribute(
                    attributeList,
                    0,
                    NativeMethods.PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
                    handleArray,
                    new IntPtr(IntPtr.Size * inherited.Count),
                    IntPtr.Zero,
                    IntPtr.Zero))
                {
                    throw new SafeProtocolException("HANDLE_LIST_UPDATE_FAILED");
                }

                STARTUPINFOEX startup = new STARTUPINFOEX();
                startup.StartupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFOEX));
                startup.StartupInfo.dwFlags = NativeMethods.STARTF_USESTDHANDLES;
                startup.StartupInfo.hStdInput = stdinHandle;
                startup.StartupInfo.hStdOutput = stdoutWrite;
                startup.StartupInfo.hStdError = stderrWrite;
                startup.lpAttributeList = attributeList;

                List<string> commandArguments = new List<string>();
                commandArguments.Add(executablePath);
                foreach (string argument in arguments) commandArguments.Add(argument);
                StringBuilder commandLine = new StringBuilder(WindowsCommandLine.Join(commandArguments));
                environment = Marshal.StringToHGlobalUni(BuildEnvironment(executablePath, tempDirectory));

                bool created = NativeMethods.CreateProcess(
                    executablePath,
                    commandLine,
                    IntPtr.Zero,
                    IntPtr.Zero,
                    true,
                    NativeMethods.CREATE_SUSPENDED
                        | NativeMethods.CREATE_UNICODE_ENVIRONMENT
                        | NativeMethods.EXTENDED_STARTUPINFO_PRESENT
                        | NativeMethods.CREATE_NO_WINDOW,
                    environment,
                    currentDirectory,
                    ref startup,
                    out process);
                if (!created) throw new SafeProtocolException("PROCESS_CREATE_SUSPENDED_FAILED");
                processCreated = true;

                NativeMethods.CloseHandle(stdoutWrite);
                stdoutWrite = IntPtr.Zero;
                NativeMethods.CloseHandle(stderrWrite);
                stderrWrite = IntPtr.Zero;
                NativeMethods.CloseHandle(stdinHandle);
                stdinHandle = IntPtr.Zero;

                StreamReader stdout = new StreamReader(
                    new FileStream(new SafeFileHandle(stdoutRead, true), FileAccess.Read, 4096, false),
                    new UTF8Encoding(false));
                stdoutRead = IntPtr.Zero;
                StreamReader stderr = new StreamReader(
                    new FileStream(new SafeFileHandle(stderrRead, true), FileAccess.Read, 4096, false),
                    new UTF8Encoding(false));
                stderrRead = IntPtr.Zero;

                return new CreatedSuspendedProcess
                {
                    ProcessHandle = process.hProcess,
                    ThreadHandle = process.hThread,
                    ProcessId = process.dwProcessId,
                    Stdout = stdout,
                    Stderr = stderr
                };
            }
            catch
            {
                if (processCreated)
                {
                    NativeMethods.TerminateProcess(process.hProcess, 0xE0010004);
                    NativeMethods.WaitForSingleObject(process.hProcess, 5000);
                    NativeMethods.CloseHandle(process.hThread);
                    NativeMethods.CloseHandle(process.hProcess);
                }
                throw;
            }
            finally
            {
                if (attributeList != IntPtr.Zero)
                {
                    NativeMethods.DeleteProcThreadAttributeList(attributeList);
                    Marshal.FreeHGlobal(attributeList);
                }
                if (handleArray != IntPtr.Zero) Marshal.FreeHGlobal(handleArray);
                if (environment != IntPtr.Zero) Marshal.FreeHGlobal(environment);
                if (stdoutWrite != IntPtr.Zero) NativeMethods.CloseHandle(stdoutWrite);
                if (stderrWrite != IntPtr.Zero) NativeMethods.CloseHandle(stderrWrite);
                if (stdinHandle != IntPtr.Zero && stdinHandle != NativeMethods.INVALID_HANDLE_VALUE) NativeMethods.CloseHandle(stdinHandle);
                if (stdoutRead != IntPtr.Zero) NativeMethods.CloseHandle(stdoutRead);
                if (stderrRead != IntPtr.Zero) NativeMethods.CloseHandle(stderrRead);
            }
        }

        private static string BuildEnvironment(string executablePath, string tempDirectory)
        {
            string systemRoot = Environment.GetEnvironmentVariable("SystemRoot");
            if (string.IsNullOrWhiteSpace(systemRoot)) throw new SafeProtocolException("SYSTEM_ROOT_MISSING");
            string system32 = Path.Combine(systemRoot, "System32");
            SortedDictionary<string, string> values = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            values.Add("COMPlus_EnableDiagnostics", "0");
            values.Add("PATH", Path.GetDirectoryName(executablePath) + ";" + system32);
            values.Add("SystemRoot", systemRoot);
            values.Add("TEMP", tempDirectory);
            values.Add("TMP", tempDirectory);
            values.Add("WINDIR", systemRoot);
            StringBuilder block = new StringBuilder();
            foreach (KeyValuePair<string, string> pair in values)
            {
                block.Append(pair.Key);
                block.Append('=');
                block.Append(pair.Value);
                block.Append('\0');
            }
            block.Append('\0');
            return block.ToString();
        }
    }

    public static class ManagedLauncher
    {
        private static readonly string[] HandshakeKeys = new[]
        {
            "token", "pid", "creation", "parentPid", "port", "bind", "generationId",
            "generationManifest", "backend", "frontend", "schema", "label",
            "generationCorrelation", "launchCorrelation", "processCorrelation",
            "instanceCorrelation", "runCorrelation", "inJob", "breakawayBlocked",
            "grandchildPid", "grandchildCreation", "egressAttempted"
        };

        public static LaunchAttempt TryLaunch(LaunchSpec spec)
        {
            JobObject job = null;
            ReservedLoopbackSocket listener = null;
            CreatedSuspendedProcess created = null;
            ProcessIdentity rootIdentity = null;
            TcpClient controlClient = null;
            StreamReader controlReader = null;
            StreamWriter controlWriter = null;
            bool assigned = false;
            bool containmentVerified = false;
            bool resumed = false;
            string stage = "preflight";

            try
            {
                ValidatePreflight(spec);
                string launchToken = IdentityTools.NewLaunchToken();
                stage = "job-create";
                job = JobObject.Create(spec.RequestedJobLimitFlags);
                stage = "port-reserve";
                listener = ReservedLoopbackSocket.Create(spec.RequestedPort);
                List<string> arguments = BuildChildArguments(spec, listener, launchToken);
                stage = "process-create";
                created = NativeProcessFactory.Create(
                    spec.ExecutablePath,
                    arguments,
                    spec.WorkingDirectory,
                    spec.TempDirectory,
                    new[] { listener.Handle });

                if (File.Exists(spec.InstructionMarkerPath))
                    throw new SafeProtocolException("INSTRUCTION_RAN_BEFORE_ASSIGNMENT");

                stage = "process-identity";
                rootIdentity = ProcessIdentityTools.Capture(created.ProcessHandle, created.ProcessId);
                if (!string.Equals(rootIdentity.CanonicalImagePath, Path.GetFullPath(spec.ExecutablePath), StringComparison.OrdinalIgnoreCase))
                    throw new SafeProtocolException("PROCESS_IMAGE_PATH_MISMATCH");
                if (!string.Equals(rootIdentity.ImageSha256, spec.ExpectedExecutableSha256, StringComparison.OrdinalIgnoreCase))
                    throw new SafeProtocolException("PROCESS_IMAGE_HASH_MISMATCH");
                if (rootIdentity.ParentProcessId != Process.GetCurrentProcess().Id)
                    throw new SafeProtocolException("PROCESS_PARENT_MISMATCH");

                stage = "job-assign";
                job.Assign(created.ProcessHandle);
                assigned = true;
                if (!job.Contains(created.ProcessHandle))
                    throw new SafeProtocolException("JOB_MEMBERSHIP_VERIFY_FAILED");
                uint flags = job.QueryLimitFlags();
                if (flags != NativeMethods.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE)
                    throw new SafeProtocolException("JOB_FLAGS_VERIFY_FAILED");
                containmentVerified = true;

                stage = "resume";
                uint resumeResult = NativeMethods.ResumeThread(created.ThreadHandle);
                if (resumeResult == 0xffffffff) throw new SafeProtocolException("PROCESS_RESUME_FAILED");
                resumed = true;
                NativeMethods.CloseHandle(created.ThreadHandle);
                created.ThreadHandle = IntPtr.Zero;
                listener.RelinquishParentCopy();

                stage = "handshake-connect";
                Dictionary<string, string> response = ConnectAndReadHandshake(
                    listener.Port,
                    out controlClient,
                    out controlReader,
                    out controlWriter);
                stage = "handshake-validate";
                ProcessIdentity grandchild = ValidateHandshake(
                    spec,
                    response,
                    launchToken,
                    listener.Port,
                    rootIdentity,
                    job);

                ManagedLaunch launch = new ManagedLaunch(
                    job,
                    created.ProcessHandle,
                    rootIdentity,
                    grandchild,
                    created.Stdout,
                    created.Stderr,
                    controlClient,
                    controlReader,
                    controlWriter,
                    launchToken,
                    rootIdentity.CanonicalImagePath,
                    spec.RuntimeReadLease);

                job = null;
                created.ProcessHandle = IntPtr.Zero;
                created.Stdout = null;
                created.Stderr = null;
                controlClient = null;
                controlReader = null;
                controlWriter = null;
                created.Dispose();
                created = null;
                listener.Dispose();
                listener = null;
                return new LaunchAttempt
                {
                    Success = true,
                    FailureCode = null,
                    ContainmentVerifiedBeforeResume = containmentVerified,
                    Resumed = resumed,
                    FailedProcessGone = false,
                    Launch = launch
                };
            }
            catch (SafeProtocolException error)
            {
                return FailAttempt(error.Code, job, listener, created, rootIdentity, assigned, containmentVerified, resumed, controlWriter, controlReader, controlClient, spec == null ? null : spec.RuntimeReadLease);
            }
            catch (Exception error)
            {
                return FailAttempt("UNEXPECTED_" + error.GetType().Name.ToUpperInvariant() + "_" + stage.ToUpperInvariant(), job, listener, created, rootIdentity, assigned, containmentVerified, resumed, controlWriter, controlReader, controlClient, spec == null ? null : spec.RuntimeReadLease);
            }
        }

        private static LaunchAttempt FailAttempt(
            string code,
            JobObject job,
            ReservedLoopbackSocket listener,
            CreatedSuspendedProcess created,
            ProcessIdentity rootIdentity,
            bool assigned,
            bool containmentVerified,
            bool resumed,
            StreamWriter controlWriter,
            StreamReader controlReader,
            TcpClient controlClient,
            RuntimeReadLeaseReceipt runtimeReadLease)
        {
            try
            {
                if (created != null && created.ProcessHandle != IntPtr.Zero)
                {
                    if (assigned && job != null)
                    {
                        job.Terminate();
                    }
                    else
                    {
                        NativeMethods.TerminateProcess(created.ProcessHandle, 0xE0010005);
                    }
                    NativeMethods.WaitForSingleObject(created.ProcessHandle, 5000);
                }
            }
            catch
            {
                code = "FAILURE_CLEANUP_FAILED";
            }
            bool gone = rootIdentity == null || !ProcessIdentityTools.IsSameLiveProcess(rootIdentity);
            if (controlWriter != null) controlWriter.Dispose();
            if (controlReader != null) controlReader.Dispose();
            if (controlClient != null) controlClient.Close();
            if (created != null) created.Dispose();
            if (listener != null) listener.Dispose();
            if (job != null) job.Dispose();
            if (runtimeReadLease != null && runtimeReadLease.IsHeld)
            {
                try { runtimeReadLease.ReleaseForCurrentOwner(); }
                catch { code = "LEASE_FAILURE_CLEANUP_FAILED"; }
            }
            return new LaunchAttempt
            {
                Success = false,
                FailureCode = code,
                ContainmentVerifiedBeforeResume = containmentVerified,
                Resumed = resumed,
                FailedProcessGone = gone,
                Launch = null
            };
        }

        private static void ValidatePreflight(LaunchSpec spec)
        {
            if (spec == null) throw new SafeProtocolException("SPEC_MISSING");
            if (!string.Equals(spec.BindAddress, "127.0.0.1", StringComparison.Ordinal))
                throw new SafeProtocolException("NON_LOOPBACK_BIND_REJECTED");
            if (spec.RequestedPort < 0 || spec.RequestedPort > 65535)
                throw new SafeProtocolException("PORT_INVALID");
            if (spec.Correlations == null || spec.ExpectedIdentity == null)
                throw new SafeProtocolException("IDENTITY_MISSING");
            if (spec.RuntimeReadLease == null)
                throw new SafeProtocolException("RUNTIME_LEASE_REQUIRED");
            if (!spec.RuntimeReadLease.ValidateForCurrentOwner(spec.ExpectedIdentity.GenerationId))
                throw new SafeProtocolException("RUNTIME_LEASE_MISMATCH");
            ValidateCorrelations(spec.Correlations);
            ValidateRuntimeIdentity(spec.ExpectedIdentity);

            string executable = Path.GetFullPath(spec.ExecutablePath);
            string generationRoot = EnsureTrailingSeparator(Path.GetFullPath(spec.GenerationRoot));
            if (!executable.StartsWith(generationRoot, StringComparison.OrdinalIgnoreCase))
                throw new SafeProtocolException("IMAGE_OUTSIDE_GENERATION_ROOT");
            if (!File.Exists(executable)) throw new SafeProtocolException("IMAGE_MISSING");
            if ((File.GetAttributes(executable) & FileAttributes.ReparsePoint) != 0)
                throw new SafeProtocolException("IMAGE_REPARSE_REJECTED");
            if (!Directory.Exists(spec.WorkingDirectory) || !Directory.Exists(spec.TempDirectory))
                throw new SafeProtocolException("LAUNCH_DIRECTORY_MISSING");
            if (!Path.IsPathRooted(spec.InstructionMarkerPath))
                throw new SafeProtocolException("MARKER_PATH_INVALID");
            if (File.Exists(spec.InstructionMarkerPath))
                throw new SafeProtocolException("MARKER_ALREADY_EXISTS");
            if (!IsHexSha256(spec.ExpectedExecutableSha256))
                throw new SafeProtocolException("IMAGE_HASH_INVALID");
            string actualHash = IdentityTools.Sha256File(executable);
            if (!string.Equals(actualHash, spec.ExpectedExecutableSha256, StringComparison.OrdinalIgnoreCase))
                throw new SafeProtocolException("IMAGE_HASH_PREFLIGHT_MISMATCH");
            if (spec.LiteralLabel == null || spec.LiteralLabel.Length > 1024 || spec.LiteralLabel.IndexOf('\0') >= 0)
                throw new SafeProtocolException("LABEL_INVALID");
        }

        private static void ValidateCorrelations(CorrelationSet ids)
        {
            string[] values = new[]
            {
                ids.GenerationCorrelationId,
                ids.LaunchCorrelationId,
                ids.ProcessCorrelationId,
                ids.InstanceCorrelationId
            };
            HashSet<string> unique = new HashSet<string>(StringComparer.Ordinal);
            foreach (string value in values)
            {
                Guid parsed;
                if (value == null || value.Length != 36 || value[14] != '4' || value != value.ToLowerInvariant() || !Guid.TryParseExact(value, "D", out parsed))
                    throw new SafeProtocolException("CORRELATION_INVALID");
                if (!unique.Add(value)) throw new SafeProtocolException("CORRELATION_REUSED");
            }
            if (ids.RunCorrelationId != null)
                throw new SafeProtocolException("RUN_CORRELATION_PREMATURE");
        }

        private static void ValidateRuntimeIdentity(ExpectedRuntimeIdentity identity)
        {
            if (string.IsNullOrWhiteSpace(identity.GenerationId)
                || !IsHexSha256(identity.GenerationManifestSha256)
                || string.IsNullOrWhiteSpace(identity.BackendRevision)
                || string.IsNullOrWhiteSpace(identity.FrontendRevision)
                || !IsHexSha256(identity.SchemaFingerprint))
            {
                throw new SafeProtocolException("RUNTIME_IDENTITY_INVALID");
            }
            string joined = (identity.GenerationId + identity.BackendRevision + identity.FrontendRevision).ToLowerInvariant();
            if (joined.Contains("latest") || joined.Contains("main") || joined.Contains("master"))
                throw new SafeProtocolException("MUTABLE_IDENTITY_REJECTED");
        }

        private static bool IsHexSha256(string value)
        {
            if (value == null || value.Length != 64) return false;
            for (int index = 0; index < value.Length; index++)
            {
                char character = value[index];
                if (!((character >= '0' && character <= '9') || (character >= 'a' && character <= 'f') || (character >= 'A' && character <= 'F')))
                    return false;
            }
            return true;
        }

        private static string EnsureTrailingSeparator(string path)
        {
            return path.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
        }

        private static List<string> BuildChildArguments(LaunchSpec spec, ReservedLoopbackSocket listener, string launchToken)
        {
            return new List<string>
            {
                "--mode", "managed",
                "--listener-handle", listener.Handle.ToInt64().ToString(CultureInfo.InvariantCulture),
                "--port", listener.Port.ToString(CultureInfo.InvariantCulture),
                "--token", launchToken,
                "--instruction-marker", spec.InstructionMarkerPath,
                "--response-mode", spec.ResponseMode ?? "valid",
                "--label", spec.LiteralLabel,
                "--generation-id", spec.ExpectedIdentity.GenerationId,
                "--generation-manifest", spec.ExpectedIdentity.GenerationManifestSha256,
                "--backend", spec.ExpectedIdentity.BackendRevision,
                "--frontend", spec.ExpectedIdentity.FrontendRevision,
                "--schema", spec.ExpectedIdentity.SchemaFingerprint,
                "--generation-correlation", spec.Correlations.GenerationCorrelationId,
                "--launch-correlation", spec.Correlations.LaunchCorrelationId,
                "--process-correlation", spec.Correlations.ProcessCorrelationId,
                "--instance-correlation", spec.Correlations.InstanceCorrelationId,
                "--run-correlation", string.Empty,
                "--decoy-port", spec.DecoyPort.ToString(CultureInfo.InvariantCulture)
            };
        }

        private static Dictionary<string, string> ConnectAndReadHandshake(
            int port,
            out TcpClient client,
            out StreamReader reader,
            out StreamWriter writer)
        {
            client = null;
            reader = null;
            writer = null;
            Exception last = null;
            for (int attempt = 0; attempt < 100; attempt++)
            {
                TcpClient candidate = new TcpClient(AddressFamily.InterNetwork);
                try
                {
                    candidate.Connect(IPAddress.Loopback, port);
                    client = candidate;
                    break;
                }
                catch (Exception error)
                {
                    last = error;
                    candidate.Close();
                    Thread.Sleep(20);
                }
            }
            if (client == null) throw new SafeProtocolException("HANDSHAKE_CONNECT_FAILED");
            client.ReceiveTimeout = 5000;
            client.SendTimeout = 5000;
            NetworkStream stream = client.GetStream();
            reader = new StreamReader(stream, new UTF8Encoding(false), false, 4096, true);
            writer = new StreamWriter(stream, new UTF8Encoding(false), 4096, true);
            writer.NewLine = "\n";
            writer.WriteLine("HELLO");
            writer.Flush();
            return WireProtocol.Decode(reader);
        }

        private static ProcessIdentity ValidateHandshake(
            LaunchSpec spec,
            Dictionary<string, string> values,
            string launchToken,
            int reservedPort,
            ProcessIdentity root,
            JobObject job)
        {
            if (values.Count != HandshakeKeys.Length) throw new SafeProtocolException("HANDSHAKE_FIELD_SET_MISMATCH");
            foreach (string key in HandshakeKeys)
            {
                if (!values.ContainsKey(key)) throw new SafeProtocolException("HANDSHAKE_FIELD_SET_MISMATCH");
            }
            if (!string.Equals(values["token"], launchToken, StringComparison.Ordinal))
                throw new SafeProtocolException("TOKEN_MISMATCH");

            int pid = ParseInt(values["pid"], "PID_REPORT_INVALID");
            long creation = ParseLong(values["creation"], "CREATION_REPORT_INVALID");
            int parentPid = ParseInt(values["parentPid"], "PARENT_REPORT_INVALID");
            int port = ParseInt(values["port"], "PORT_REPORT_INVALID");
            if (pid != root.ProcessId || creation != root.CreationFileTime || parentPid != Process.GetCurrentProcess().Id)
                throw new SafeProtocolException("PROCESS_IDENTITY_REPORT_MISMATCH");
            if (port != reservedPort) throw new SafeProtocolException("PORT_REPORT_MISMATCH");
            if (!string.Equals(values["bind"], "127.0.0.1", StringComparison.Ordinal))
                throw new SafeProtocolException("BIND_REPORT_MISMATCH");
            if (!string.Equals(values["generationId"], spec.ExpectedIdentity.GenerationId, StringComparison.Ordinal)
                || !string.Equals(values["generationManifest"], spec.ExpectedIdentity.GenerationManifestSha256, StringComparison.Ordinal)
                || !string.Equals(values["backend"], spec.ExpectedIdentity.BackendRevision, StringComparison.Ordinal)
                || !string.Equals(values["frontend"], spec.ExpectedIdentity.FrontendRevision, StringComparison.Ordinal)
                || !string.Equals(values["schema"], spec.ExpectedIdentity.SchemaFingerprint, StringComparison.Ordinal))
                throw new SafeProtocolException("RUNTIME_IDENTITY_REPORT_MISMATCH");
            if (!string.Equals(values["label"], spec.LiteralLabel, StringComparison.Ordinal))
                throw new SafeProtocolException("ARGUMENT_ROUNDTRIP_MISMATCH");
            if (!string.Equals(values["generationCorrelation"], spec.Correlations.GenerationCorrelationId, StringComparison.Ordinal)
                || !string.Equals(values["launchCorrelation"], spec.Correlations.LaunchCorrelationId, StringComparison.Ordinal)
                || !string.Equals(values["processCorrelation"], spec.Correlations.ProcessCorrelationId, StringComparison.Ordinal)
                || !string.Equals(values["instanceCorrelation"], spec.Correlations.InstanceCorrelationId, StringComparison.Ordinal)
                || values["runCorrelation"].Length != 0)
                throw new SafeProtocolException("CORRELATION_REPORT_MISMATCH");
            if (!string.Equals(values["inJob"], "true", StringComparison.Ordinal)
                || !string.Equals(values["breakawayBlocked"], "true", StringComparison.Ordinal))
                throw new SafeProtocolException("JOB_REPORT_MISMATCH");
            if (!string.Equals(values["egressAttempted"], "false", StringComparison.Ordinal))
                throw new SafeProtocolException("UNEXPECTED_EGRESS_CAPTURED");

            int grandchildPid = ParseInt(values["grandchildPid"], "GRANDCHILD_PID_INVALID");
            long grandchildCreation = ParseLong(values["grandchildCreation"], "GRANDCHILD_CREATION_INVALID");
            ProcessIdentity grandchild = ProcessIdentityTools.CaptureByPid(grandchildPid);
            if (grandchild.CreationFileTime != grandchildCreation || grandchild.ParentProcessId != root.ProcessId)
                throw new SafeProtocolException("GRANDCHILD_IDENTITY_MISMATCH");
            if (!TestNative.IsPidInJob(grandchildPid, job))
                throw new SafeProtocolException("GRANDCHILD_JOB_MISMATCH");
            return grandchild;
        }

        private static int ParseInt(string value, string code)
        {
            int parsed;
            if (!int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out parsed))
                throw new SafeProtocolException(code);
            return parsed;
        }

        private static long ParseLong(string value, string code)
        {
            long parsed;
            if (!long.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out parsed))
                throw new SafeProtocolException(code);
            return parsed;
        }
    }

    public sealed class SuspendedJobProcess : IDisposable
    {
        private CreatedSuspendedProcess created;
        private JobObject job;

        internal SuspendedJobProcess(CreatedSuspendedProcess created, JobObject job, ProcessIdentity identity)
        {
            this.created = created;
            this.job = job;
            Identity = identity;
        }

        public ProcessIdentity Identity { get; private set; }
        public JobObject Job { get { return job; } }

        public uint Wait(int milliseconds)
        {
            return NativeMethods.WaitForSingleObject(created.ProcessHandle, (uint)milliseconds);
        }

        public void Dispose()
        {
            if (created != null)
            {
                if (ProcessIdentityTools.IsSameLiveProcess(Identity))
                {
                    job.Terminate();
                    NativeMethods.WaitForSingleObject(created.ProcessHandle, 5000);
                }
                created.Dispose();
                created = null;
            }
            if (job != null)
            {
                job.Dispose();
                job = null;
            }
        }
    }

    public static class SuspendedJobTestLauncher
    {
        public static SuspendedJobProcess Start(
            string executablePath,
            IList<string> arguments,
            string workingDirectory,
            string tempDirectory,
            string mustNotExistMarker)
        {
            JobObject job = JobObject.Create(NativeMethods.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE);
            CreatedSuspendedProcess created = null;
            try
            {
                created = NativeProcessFactory.Create(executablePath, arguments, workingDirectory, tempDirectory, null);
                if (File.Exists(mustNotExistMarker)) throw new SafeProtocolException("TEST_HELPER_RAN_BEFORE_ASSIGNMENT");
                ProcessIdentity identity = ProcessIdentityTools.Capture(created.ProcessHandle, created.ProcessId);
                job.Assign(created.ProcessHandle);
                if (!job.Contains(created.ProcessHandle)) throw new SafeProtocolException("TEST_HELPER_ASSIGN_VERIFY_FAILED");
                if (NativeMethods.ResumeThread(created.ThreadHandle) == 0xffffffff) throw new SafeProtocolException("TEST_HELPER_RESUME_FAILED");
                NativeMethods.CloseHandle(created.ThreadHandle);
                created.ThreadHandle = IntPtr.Zero;
                SuspendedJobProcess result = new SuspendedJobProcess(created, job, identity);
                created = null;
                job = null;
                return result;
            }
            catch
            {
                if (created != null)
                {
                    if (created.ProcessHandle != IntPtr.Zero)
                    {
                        job.Terminate();
                        NativeMethods.WaitForSingleObject(created.ProcessHandle, 5000);
                    }
                    created.Dispose();
                }
                if (job != null) job.Dispose();
                throw;
            }
        }
    }
}
