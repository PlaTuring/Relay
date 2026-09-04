// Uncompiled design fixture. Direct-child control is not Windows Job Object containment.
using System;
using System.Diagnostics;
using System.Threading;
using System.Threading.Tasks;

namespace MiniMaxH3.StackDotnet.Fixture;

internal static class OwnedChildProbe
{
    internal static async Task<OwnedChildResult> RunAsync(
        string label,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(label) || label.Length > 128)
        {
            throw new ArgumentException("The bounded fixture label is invalid.", nameof(label));
        }

        string executable = Environment.ProcessPath ??
            throw new InvalidOperationException("The fixed current executable is unavailable.");
        string token = Guid.NewGuid().ToString("N");
        var startInfo = new ProcessStartInfo
        {
            FileName = executable,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            WorkingDirectory = AppContext.BaseDirectory
        };
        startInfo.ArgumentList.Add("--bounded-child");
        startInfo.ArgumentList.Add("--token");
        startInfo.ArgumentList.Add(token);
        startInfo.ArgumentList.Add("--label");
        startInfo.ArgumentList.Add(label);
        startInfo.Environment.Clear();
        startInfo.Environment["MINIMAX_H3_PROBE_TOKEN"] = token;

        using var process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
        if (!process.Start())
        {
            throw new InvalidOperationException("The fixed harmless child could not start.");
        }
        process.StandardInput.Close();

        bool ready = false;
        try
        {
            string? line = await process.StandardOutput.ReadLineAsync(cancellationToken);
            ready = string.Equals(line, "READY " + token, StringComparison.Ordinal);
            if (!ready)
            {
                throw new InvalidOperationException("The child readiness identity did not match.");
            }
        }
        finally
        {
            if (!process.HasExited)
            {
                process.Kill(entireProcessTree: true);
            }
            await process.WaitForExitAsync(CancellationToken.None);
        }

        return new OwnedChildResult(
            ready,
            process.HasExited,
            ProcessTreeContained: false,
            EvidenceCode: "DIRECT_CHILD_ONLY_JOB_OBJECT_BLOCKED");
    }
}

