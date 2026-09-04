function requireElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required renderer element: ${selector}`);
  }
  return element;
}

function setStatus(message: string, kind: "idle" | "working" | "success" | "error"): void {
  const status = requireElement<HTMLOutputElement>("#status");
  status.textContent = message;
  status.dataset.kind = kind;
}

async function initialize(): Promise<void> {
  const security = await window.controlPlane.getSecuritySummary();
  const securityOutput = requireElement<HTMLOutputElement>("#security-summary");
  securityOutput.textContent = [
    `contextIsolation=${security.contextIsolation}`,
    `sandbox=${security.sandbox}`,
    `nodeIntegration=${security.nodeIntegration}`,
    `rendererNetworkBlocked=${security.rendererNetworkBlocked}`,
    `IPC=${security.ipcChannels.length}`,
    `Alpha自更新=${security.alphaSelfUpdate}`
  ].join(" · ");

  const suggested = requireElement<HTMLOutputElement>("#suggested-root");
  suggested.textContent = security.suggestedManagedRoot ?? "没有合格的 D 盘默认值；必须由用户选择";
}

requireElement<HTMLButtonElement>("#choose-root").addEventListener("click", async () => {
  setStatus("正在等待文件夹选择…", "working");
  try {
    const result = await window.controlPlane.chooseManagedRoot();
    if (!result) {
      setStatus("已取消，未改变受管数据位置。", "idle");
      return;
    }
    requireElement<HTMLOutputElement>("#selected-root").textContent = result.displayPath;
    requireElement<HTMLOutputElement>("#root-warnings").textContent =
      result.warnings.length > 0 ? result.warnings.join(" ") : "路径形态通过；NTFS与空间仍需后续原生探针认证。";
    setStatus("路径已显示；此探针不会创建或写入该目录。", "success");
  } catch {
    setStatus("路径检查失败；没有写入任何位置。", "error");
  }
});

requireElement<HTMLButtonElement>("#run-child-probe").addEventListener("click", async () => {
  setStatus("正在运行固定无害子进程探针…", "working");
  try {
    const result = await window.controlPlane.runOwnedChildProbe();
    requireElement<HTMLOutputElement>("#child-result").textContent =
      `${result.label} · PID ${result.childPid} · 已终止=${result.terminated}`;
    setStatus("子进程启动、Unicode参数传递和终止已完成。", "success");
  } catch {
    setStatus("子进程探针失败；请查看本地测试报告。", "error");
  }
});

window.addEventListener("DOMContentLoaded", () => {
  initialize().catch(() => {
    setStatus("安全摘要加载失败。", "error");
  });
});
