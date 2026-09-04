using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;

namespace ManagedProcessOwnership
{
    public sealed class SafeProtocolException : Exception
    {
        public string Code { get; private set; }

        public SafeProtocolException(string code)
            : base(code)
        {
            Code = code;
        }
    }

    public sealed class CorrelationSet
    {
        public string GenerationCorrelationId { get; set; }
        public string LaunchCorrelationId { get; set; }
        public string ProcessCorrelationId { get; set; }
        public string InstanceCorrelationId { get; set; }
        public string RunCorrelationId { get; set; }

        public static CorrelationSet CreateForLaunch()
        {
            return new CorrelationSet
            {
                GenerationCorrelationId = IdentityTools.NewCorrelationId(),
                LaunchCorrelationId = IdentityTools.NewCorrelationId(),
                ProcessCorrelationId = IdentityTools.NewCorrelationId(),
                InstanceCorrelationId = IdentityTools.NewCorrelationId(),
                RunCorrelationId = null
            };
        }
    }

    public sealed class ExpectedRuntimeIdentity
    {
        public string GenerationId { get; set; }
        public string GenerationManifestSha256 { get; set; }
        public string BackendRevision { get; set; }
        public string FrontendRevision { get; set; }
        public string SchemaFingerprint { get; set; }
    }

    public sealed class RuntimeReadLeaseReceipt
    {
        private readonly string ownerToken;
        private bool held;

        private RuntimeReadLeaseReceipt(string generationId, int ownerPid, long ownerCreationFileTime, string ownerToken)
        {
            GenerationId = generationId;
            OwnerPid = ownerPid;
            OwnerCreationFileTime = ownerCreationFileTime;
            this.ownerToken = ownerToken;
            held = true;
        }

        public string GenerationId { get; private set; }
        public int OwnerPid { get; private set; }
        public long OwnerCreationFileTime { get; private set; }
        public bool IsHeld { get { return held; } }

        public static RuntimeReadLeaseReceipt AcquireFakeForCurrentProcess(string generationId)
        {
            if (string.IsNullOrWhiteSpace(generationId)) throw new SafeProtocolException("LEASE_GENERATION_INVALID");
            ProcessIdentity owner = ProcessIdentityTools.CaptureByPid(Process.GetCurrentProcess().Id);
            return new RuntimeReadLeaseReceipt(
                generationId,
                owner.ProcessId,
                owner.CreationFileTime,
                Guid.NewGuid().ToString("D"));
        }

        internal bool ValidateForCurrentOwner(string generationId)
        {
            if (!held || string.IsNullOrWhiteSpace(ownerToken)) return false;
            if (!string.Equals(GenerationId, generationId, StringComparison.Ordinal)) return false;
            if (OwnerPid != Process.GetCurrentProcess().Id) return false;
            return ProcessIdentityTools.IsPidWithCreationLive(OwnerPid, OwnerCreationFileTime);
        }

        internal void ReleaseForCurrentOwner()
        {
            if (!held) return;
            if (OwnerPid != Process.GetCurrentProcess().Id
                || !ProcessIdentityTools.IsPidWithCreationLive(OwnerPid, OwnerCreationFileTime))
            {
                throw new SafeProtocolException("LEASE_RELEASE_OWNER_MISMATCH");
            }
            held = false;
        }
    }

    public sealed class LaunchSpec
    {
        public string ExecutablePath { get; set; }
        public string GenerationRoot { get; set; }
        public string WorkingDirectory { get; set; }
        public string TempDirectory { get; set; }
        public string ExpectedExecutableSha256 { get; set; }
        public string InstructionMarkerPath { get; set; }
        public string BindAddress { get; set; }
        public int RequestedPort { get; set; }
        public int DecoyPort { get; set; }
        public string ResponseMode { get; set; }
        public string LiteralLabel { get; set; }
        public RuntimeReadLeaseReceipt RuntimeReadLease { get; set; }
        public uint RequestedJobLimitFlags { get; set; }
        public CorrelationSet Correlations { get; set; }
        public ExpectedRuntimeIdentity ExpectedIdentity { get; set; }
    }

    public sealed class ProcessIdentity
    {
        public int ProcessId { get; set; }
        public long CreationFileTime { get; set; }
        public int ParentProcessId { get; set; }
        public string CanonicalImagePath { get; set; }
        public string ImageSha256 { get; set; }

        public ProcessIdentity Clone()
        {
            return new ProcessIdentity
            {
                ProcessId = ProcessId,
                CreationFileTime = CreationFileTime,
                ParentProcessId = ParentProcessId,
                CanonicalImagePath = CanonicalImagePath,
                ImageSha256 = ImageSha256
            };
        }
    }

    public sealed class RedactionSummary
    {
        public int StdoutSensitiveLines { get; set; }
        public int StderrSensitiveLines { get; set; }
        public bool RawValueReturned { get; set; }
    }

    public sealed class ShutdownResult
    {
        public bool Graceful { get; set; }
        public bool EscalatedToVerifiedJob { get; set; }
        public bool RootExited { get; set; }
    }

    public sealed class LaunchAttempt
    {
        public bool Success { get; set; }
        public string FailureCode { get; set; }
        public bool ContainmentVerifiedBeforeResume { get; set; }
        public bool Resumed { get; set; }
        public bool FailedProcessGone { get; set; }
        public ManagedLaunch Launch { get; set; }
    }

    public sealed class ManagedLaunch : IDisposable
    {
        private bool disposed;
        private readonly StreamReader stdoutReader;
        private readonly StreamReader stderrReader;
        private readonly TcpClient controlClient;
        private readonly StreamReader controlReader;
        private readonly StreamWriter controlWriter;
        private readonly RuntimeReadLeaseReceipt runtimeReadLease;

        internal ManagedLaunch(
            JobObject job,
            IntPtr processHandle,
            ProcessIdentity rootIdentity,
            ProcessIdentity grandchildIdentity,
            StreamReader stdoutReader,
            StreamReader stderrReader,
            TcpClient controlClient,
            StreamReader controlReader,
            StreamWriter controlWriter,
            string launchToken,
            string executablePath,
            RuntimeReadLeaseReceipt runtimeReadLease)
        {
            Job = job;
            ProcessHandle = processHandle;
            RootIdentity = rootIdentity;
            GrandchildIdentity = grandchildIdentity;
            this.stdoutReader = stdoutReader;
            this.stderrReader = stderrReader;
            this.controlClient = controlClient;
            this.controlReader = controlReader;
            this.controlWriter = controlWriter;
            LaunchToken = launchToken;
            ExecutablePath = executablePath;
            this.runtimeReadLease = runtimeReadLease;
        }

        public JobObject Job { get; private set; }
        public IntPtr ProcessHandle { get; private set; }
        public ProcessIdentity RootIdentity { get; private set; }
        public ProcessIdentity GrandchildIdentity { get; private set; }
        internal string LaunchToken { get; private set; }
        internal string ExecutablePath { get; private set; }

        public RedactionSummary CollectRedactionSummary(int timeoutMilliseconds)
        {
            string stdout = ReadOneLine(stdoutReader, timeoutMilliseconds);
            string stderr = ReadOneLine(stderrReader, timeoutMilliseconds);
            bool stdoutSensitive = stdout != null && stdout.Contains(LaunchToken) && stdout.Contains(ExecutablePath);
            bool stderrSensitive = stderr != null && stderr.Contains(LaunchToken) && stderr.Contains(ExecutablePath);
            return new RedactionSummary
            {
                StdoutSensitiveLines = stdoutSensitive ? 1 : 0,
                StderrSensitiveLines = stderrSensitive ? 1 : 0,
                RawValueReturned = false
            };
        }

        private static string ReadOneLine(StreamReader reader, int timeoutMilliseconds)
        {
            Task<string> result = reader.ReadLineAsync();
            if (!result.Wait(timeoutMilliseconds))
            {
                throw new SafeProtocolException("OUTPUT_TIMEOUT");
            }
            return result.Result;
        }

        public ShutdownResult Shutdown(int timeoutMilliseconds)
        {
            if (disposed)
            {
                throw new SafeProtocolException("LAUNCH_DISPOSED");
            }

            bool graceful = false;
            bool escalated = false;
            try
            {
                controlWriter.WriteLine("SHUTDOWN");
                controlWriter.Flush();
                graceful = NativeMethods.WaitForSingleObject(ProcessHandle, (uint)timeoutMilliseconds) == NativeMethods.WAIT_OBJECT_0;
            }
            catch
            {
                graceful = false;
            }

            if (!graceful)
            {
                if (!OwnedStop.TryTerminateVerifiedJob(Job, RootIdentity))
                {
                    throw new SafeProtocolException("ESCALATION_OWNERSHIP_MISMATCH");
                }
                escalated = true;
                NativeMethods.WaitForSingleObject(ProcessHandle, 5000);
            }

            bool exited = !ProcessIdentityTools.IsSameLiveProcess(RootIdentity);
            if (exited && runtimeReadLease != null && runtimeReadLease.IsHeld)
                runtimeReadLease.ReleaseForCurrentOwner();
            return new ShutdownResult
            {
                Graceful = graceful,
                EscalatedToVerifiedJob = escalated,
                RootExited = exited
            };
        }

        public void Dispose()
        {
            if (disposed)
            {
                return;
            }
            disposed = true;
            try
            {
                if (ProcessIdentityTools.IsSameLiveProcess(RootIdentity))
                {
                    OwnedStop.TryTerminateVerifiedJob(Job, RootIdentity);
                    NativeMethods.WaitForSingleObject(ProcessHandle, 5000);
                }
            }
            finally
            {
                if (controlWriter != null) controlWriter.Dispose();
                if (controlReader != null) controlReader.Dispose();
                if (controlClient != null) controlClient.Close();
                if (stdoutReader != null) stdoutReader.Dispose();
                if (stderrReader != null) stderrReader.Dispose();
                if (ProcessHandle != IntPtr.Zero) NativeMethods.CloseHandle(ProcessHandle);
                if (Job != null) Job.Dispose();
                if (runtimeReadLease != null && runtimeReadLease.IsHeld)
                    runtimeReadLease.ReleaseForCurrentOwner();
                ProcessHandle = IntPtr.Zero;
            }
        }
    }

    public static class IdentityTools
    {
        public static string NewCorrelationId()
        {
            return Guid.NewGuid().ToString("D").ToLowerInvariant();
        }

        public static string NewLaunchToken()
        {
            byte[] bytes = new byte[32];
            using (RandomNumberGenerator rng = RandomNumberGenerator.Create())
            {
                rng.GetBytes(bytes);
            }
            return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        }

        public static string Sha256File(string path)
        {
            using (FileStream stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read))
            using (SHA256 sha = SHA256.Create())
            {
                return Hex(sha.ComputeHash(stream));
            }
        }

        public static string Sha256Text(string value)
        {
            using (SHA256 sha = SHA256.Create())
            {
                return Hex(sha.ComputeHash(Encoding.UTF8.GetBytes(value)));
            }
        }

        private static string Hex(byte[] bytes)
        {
            StringBuilder result = new StringBuilder(bytes.Length * 2);
            for (int index = 0; index < bytes.Length; index++)
            {
                result.Append(bytes[index].ToString("x2"));
            }
            return result.ToString();
        }
    }

    public static class WireProtocol
    {
        public static string Encode(IDictionary<string, string> values)
        {
            StringBuilder builder = new StringBuilder();
            foreach (KeyValuePair<string, string> pair in values)
            {
                string value = pair.Value ?? string.Empty;
                builder.Append(pair.Key);
                builder.Append(':');
                builder.Append(Convert.ToBase64String(Encoding.UTF8.GetBytes(value)));
                builder.Append('\n');
            }
            builder.Append('\n');
            return builder.ToString();
        }

        public static Dictionary<string, string> Decode(StreamReader reader)
        {
            Dictionary<string, string> values = new Dictionary<string, string>(StringComparer.Ordinal);
            while (true)
            {
                string line = reader.ReadLine();
                if (line == null) throw new SafeProtocolException("HANDSHAKE_EOF");
                if (line.Length == 0) break;
                int separator = line.IndexOf(':');
                if (separator <= 0 || values.ContainsKey(line.Substring(0, separator)))
                {
                    throw new SafeProtocolException("HANDSHAKE_FORMAT");
                }
                string key = line.Substring(0, separator);
                string encoded = line.Substring(separator + 1);
                values.Add(key, Encoding.UTF8.GetString(Convert.FromBase64String(encoded)));
            }
            return values;
        }
    }
}
