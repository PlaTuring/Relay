// Uncompiled design fixture: no local modern .NET SDK validated this source.
using System.Threading;
using System.Threading.Tasks;
using System.Windows;

namespace MiniMaxH3.StackDotnet.Fixture;

internal interface IControlPlaneService
{
    Task<SecuritySummary> GetSecuritySummaryAsync(CancellationToken cancellationToken);

    Task<ManagedRootResult?> ChooseManagedRootAsync(
        Window owner,
        CancellationToken cancellationToken);

    Task<ManagedRootResult> InspectManagedRootAsync(
        string candidate,
        CancellationToken cancellationToken);

    Task<OwnedChildResult> RunOwnedChildProbeAsync(
        string label,
        CancellationToken cancellationToken);
}

internal sealed record SecuritySummary(
    int AllowedMethodCount,
    bool GenericDispatcherExposed,
    bool ToolSubmitsFormalQueue,
    bool ToolGeneratesMedia,
    bool AutomaticUpdaterPresent,
    bool TelemetryPresent);

internal sealed record ManagedRootResult(
    bool Accepted,
    string? DisplayPath,
    string? Drive,
    bool IsSystemDrive,
    bool ContainsSpaces,
    bool ContainsUnicode,
    string? FailureCode);

internal sealed record OwnedChildResult(
    bool ReadyObserved,
    bool DirectChildTerminated,
    bool ProcessTreeContained,
    string EvidenceCode);

