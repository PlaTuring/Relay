// Uncompiled design fixture. UI calls only the typed four-method service contract.
using System.Threading;
using System.Windows;

namespace MiniMaxH3.StackDotnet.Fixture;

internal sealed partial class MainWindow : Window
{
    private readonly IControlPlaneService service;
    private readonly CancellationTokenSource lifetime = new();

    internal MainWindow(IControlPlaneService service)
    {
        this.service = service;
        InitializeComponent();
        ChooseRootButton.Click += async (_, _) =>
        {
            ManagedRootResult? result =
                await this.service.ChooseManagedRootAsync(this, lifetime.Token);
            ManagedRootText.Text = result?.DisplayPath ?? "尚未选择";
            StatusText.Text = result?.Accepted == true ? "路径形态检查通过。" : "未选择或路径被拒绝。";
        };
        ProbeChildButton.Click += async (_, _) =>
        {
            OwnedChildResult result = await this.service.RunOwnedChildProbeAsync(
                "路径 含空格 Ω",
                lifetime.Token);
            StatusText.Text = result.ReadyObserved && result.DirectChildTerminated
                ? "直接子进程技术验证完成；Job Object 仍未证明。"
                : "直接子进程技术验证失败。";
        };
        Closed += (_, _) => lifetime.Cancel();
    }
}

