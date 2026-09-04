// Uncompiled design fixture. No Comfy, H3, queue or network client exists here.
using System;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using Microsoft.Win32;

namespace MiniMaxH3.StackDotnet.Fixture;

internal sealed class ControlPlaneService : IControlPlaneService
{
    public Task<SecuritySummary> GetSecuritySummaryAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(new SecuritySummary(
            AllowedMethodCount: 4,
            GenericDispatcherExposed: false,
            ToolSubmitsFormalQueue: false,
            ToolGeneratesMedia: false,
            AutomaticUpdaterPresent: false,
            TelemetryPresent: false));
    }

    public Task<ManagedRootResult?> ChooseManagedRootAsync(
        Window owner,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var dialog = new OpenFolderDialog
        {
            Title = "选择 MiniMax H3 工具安装位置",
            Multiselect = false
        };
        bool? accepted = dialog.ShowDialog(owner);
        if (accepted != true)
        {
            return Task.FromResult<ManagedRootResult?>(null);
        }

        return Task.FromResult<ManagedRootResult?>(
            ManagedRootPolicy.Inspect(dialog.FolderName, "C:"));
    }

    public Task<ManagedRootResult> InspectManagedRootAsync(
        string candidate,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(ManagedRootPolicy.Inspect(candidate, "C:"));
    }

    public Task<OwnedChildResult> RunOwnedChildProbeAsync(
        string label,
        CancellationToken cancellationToken)
    {
        return OwnedChildProbe.RunAsync(label, cancellationToken);
    }
}

