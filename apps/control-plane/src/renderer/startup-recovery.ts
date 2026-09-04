interface RecoveryState {
  readonly code: string;
  readonly message: string;
  readonly busy: boolean;
}

interface RecoveryApi {
  getState(): Promise<RecoveryState>;
  retry(): Promise<RecoveryState>;
  chooseDataRoot(): Promise<RecoveryState>;
  openDiagnostics(): Promise<boolean>;
  exit(): Promise<boolean>;
  onStateChanged(listener: (state: RecoveryState) => void): () => void;
}

declare global {
  interface Window {
    readonly startupRecovery: RecoveryApi;
  }
}

const code = document.querySelector<HTMLElement>("#recovery-code")!;
const message = document.querySelector<HTMLElement>("#recovery-message")!;
const retry = document.querySelector<HTMLButtonElement>("#recovery-retry")!;
const choose = document.querySelector<HTMLButtonElement>("#recovery-choose")!;
const diagnostics = document.querySelector<HTMLButtonElement>("#recovery-diagnostics")!;
const exit = document.querySelector<HTMLButtonElement>("#recovery-exit")!;

function render(state: RecoveryState): void {
  code.textContent = state.code;
  message.textContent = state.message;
  retry.disabled = state.busy;
  choose.disabled = state.busy;
  diagnostics.disabled = state.busy;
  retry.setAttribute("aria-busy", String(state.busy));
  choose.setAttribute("aria-busy", String(state.busy));
}

retry.addEventListener("click", () => void window.startupRecovery.retry());
choose.addEventListener("click", () => void window.startupRecovery.chooseDataRoot());
diagnostics.addEventListener("click", () => void window.startupRecovery.openDiagnostics());
exit.addEventListener("click", () => void window.startupRecovery.exit());
window.startupRecovery.onStateChanged(render);
void window.startupRecovery.getState().then(render);

export {};

