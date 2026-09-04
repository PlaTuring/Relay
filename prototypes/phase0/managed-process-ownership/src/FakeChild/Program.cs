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

namespace ManagedProcessOwnershipFakeChild
{
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
                return 2;
            }

            string mode = Get(options, "mode", "managed");
            if (string.Equals(mode, "grandchild", StringComparison.Ordinal))
            {
                while (true) Thread.Sleep(1000);
            }
            if (string.Equals(mode, "escape-parent", StringComparison.Ordinal))
            {
                return RunEscapeParent(options);
            }
            if (!string.Equals(mode, "managed", StringComparison.Ordinal))
            {
                return 2;
            }
            return RunManaged(options);
        }

        private static int RunManaged(Dictionary<string, string> options)
        {
            ProcessIdentity grandchild = null;
            try
            {
                string marker = Require(options, "instruction-marker");
                using (FileStream markerStream = new FileStream(marker, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                {
                    byte[] markerBytes = Encoding.ASCII.GetBytes("first-body-marker");
                    markerStream.Write(markerBytes, 0, markerBytes.Length);
                    markerStream.Flush(true);
                }

                string executable = Process.GetCurrentProcess().MainModule.FileName;
                ProcessIdentity self = ProcessIdentityTools.CaptureByPid(Process.GetCurrentProcess().Id);
                bool inJob = ProcessIdentityTools.IsCurrentProcessInAnyJob();
                grandchild = TestNative.StartOrdinaryProcess(executable, new[] { "--mode", "grandchild" });
                bool breakawayBlocked = TestNative.IsBreakawayCreateDeniedByJob(executable);

                string responseMode = Get(options, "response-mode", "valid");
                bool egressAttempted = false;
                if (string.Equals(responseMode, "egress", StringComparison.Ordinal))
                {
                    int decoyPort = ParseInt(Require(options, "decoy-port"));
                    using (TcpClient decoy = new TcpClient(AddressFamily.InterNetwork))
                    {
                        decoy.Connect(IPAddress.Loopback, decoyPort);
                        decoy.GetStream().WriteByte(0x45);
                    }
                    egressAttempted = true;
                }

                string token = Require(options, "token");
                string port = Require(options, "port");
                string bind = "127.0.0.1";
                string schema = Require(options, "schema");
                string backend = Require(options, "backend");
                string frontend = Require(options, "frontend");
                if (string.Equals(responseMode, "stale-token", StringComparison.Ordinal))
                    token = token.Substring(0, token.Length - 1) + (token.EndsWith("a", StringComparison.Ordinal) ? "b" : "a");
                if (string.Equals(responseMode, "wrong-port", StringComparison.Ordinal))
                    port = (ParseInt(port) + 1).ToString(CultureInfo.InvariantCulture);
                if (string.Equals(responseMode, "wildcard-report", StringComparison.Ordinal))
                    bind = "0.0.0.0";
                if (string.Equals(responseMode, "wrong-schema", StringComparison.Ordinal))
                    schema = IdentityTools.Sha256Text("wrong-schema-fixture");
                if (string.Equals(responseMode, "wrong-backend", StringComparison.Ordinal))
                    backend = "backend-fixture-mismatch";
                if (string.Equals(responseMode, "wrong-frontend", StringComparison.Ordinal))
                    frontend = "frontend-fixture-mismatch";

                Console.Out.WriteLine("sensitive token=" + Require(options, "token") + " path=" + executable);
                Console.Out.Flush();
                Console.Error.WriteLine("sensitive token=" + Require(options, "token") + " path=" + executable);
                Console.Error.Flush();

                Dictionary<string, string> response = new Dictionary<string, string>(StringComparer.Ordinal);
                response.Add("token", token);
                response.Add("pid", self.ProcessId.ToString(CultureInfo.InvariantCulture));
                response.Add("creation", self.CreationFileTime.ToString(CultureInfo.InvariantCulture));
                response.Add("parentPid", self.ParentProcessId.ToString(CultureInfo.InvariantCulture));
                response.Add("port", port);
                response.Add("bind", bind);
                response.Add("generationId", Require(options, "generation-id"));
                response.Add("generationManifest", Require(options, "generation-manifest"));
                response.Add("backend", backend);
                response.Add("frontend", frontend);
                response.Add("schema", schema);
                response.Add("label", Require(options, "label"));
                response.Add("generationCorrelation", Require(options, "generation-correlation"));
                response.Add("launchCorrelation", Require(options, "launch-correlation"));
                response.Add("processCorrelation", Require(options, "process-correlation"));
                response.Add("instanceCorrelation", Require(options, "instance-correlation"));
                response.Add("runCorrelation", Get(options, "run-correlation", string.Empty));
                response.Add("inJob", inJob ? "true" : "false");
                response.Add("breakawayBlocked", breakawayBlocked ? "true" : "false");
                response.Add("grandchildPid", grandchild.ProcessId.ToString(CultureInfo.InvariantCulture));
                response.Add("grandchildCreation", grandchild.CreationFileTime.ToString(CultureInfo.InvariantCulture));
                response.Add("egressAttempted", egressAttempted ? "true" : "false");

                long listenerValue = long.Parse(Require(options, "listener-handle"), CultureInfo.InvariantCulture);
                bool ignoreShutdown = string.Equals(responseMode, "ignore-shutdown", StringComparison.Ordinal);
                SocketNative.ServeInheritedListener(new IntPtr(listenerValue), response, ignoreShutdown);
                if (ProcessIdentityTools.IsSameLiveProcess(grandchild)) OwnedStop.TryTerminateExactProcess(grandchild);
                return 0;
            }
            catch
            {
                if (grandchild != null && ProcessIdentityTools.IsSameLiveProcess(grandchild))
                    OwnedStop.TryTerminateExactProcess(grandchild);
                return 3;
            }
        }

        private static int RunEscapeParent(Dictionary<string, string> options)
        {
            ProcessIdentity grandchild = null;
            try
            {
                string executable = Process.GetCurrentProcess().MainModule.FileName;
                grandchild = TestNative.StartOrdinaryProcess(executable, new[] { "--mode", "grandchild" });
                string resultPath = Require(options, "result");
                string value = grandchild.ProcessId.ToString(CultureInfo.InvariantCulture)
                    + "|" + grandchild.CreationFileTime.ToString(CultureInfo.InvariantCulture);
                using (FileStream stream = new FileStream(resultPath, FileMode.CreateNew, FileAccess.Write, FileShare.Read))
                using (StreamWriter writer = new StreamWriter(stream, new UTF8Encoding(false)))
                {
                    writer.Write(value);
                    writer.Flush();
                    stream.Flush(true);
                }
                while (true) Thread.Sleep(1000);
            }
            catch
            {
                if (grandchild != null && ProcessIdentityTools.IsSameLiveProcess(grandchild))
                    OwnedStop.TryTerminateExactProcess(grandchild);
                return 4;
            }
        }

        private static Dictionary<string, string> ParseArguments(string[] args)
        {
            if (args.Length % 2 != 0) throw new InvalidOperationException();
            Dictionary<string, string> values = new Dictionary<string, string>(StringComparer.Ordinal);
            for (int index = 0; index < args.Length; index += 2)
            {
                string key = args[index];
                if (!key.StartsWith("--", StringComparison.Ordinal) || values.ContainsKey(key.Substring(2)))
                    throw new InvalidOperationException();
                values.Add(key.Substring(2), args[index + 1]);
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

        private static int ParseInt(string value)
        {
            return int.Parse(value, NumberStyles.None, CultureInfo.InvariantCulture);
        }
    }
}
