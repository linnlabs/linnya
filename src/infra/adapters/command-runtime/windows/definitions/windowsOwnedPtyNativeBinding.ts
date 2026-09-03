import type { WindowsOwnedPipeNativeLaunchInput } from '../../../local-process-runtime/windows';

export type WindowsOwnedPtyNativeEvent =
  | { readonly kind: 'terminal_data'; readonly bytes: Uint8Array }
  | { readonly kind: 'terminal_eof' }
  | { readonly kind: 'root_exit'; readonly exitCode: number }
  | { readonly kind: 'observer_error'; readonly message: string };

export interface WindowsOwnedPtyNativeProcess {
  startObservers(callback: (payload: unknown) => boolean): void;
  resumeAfterObserversReady(): void;
  writeInput(data: Uint8Array): Promise<number>;
  resize(columns: number, rows: number): void;
  resumeOutput(): void;
  cancelOutput(): void;
  terminateAndWaitTreeEmpty(): Promise<void>;
  release(): Promise<void>;
}

export interface WindowsOwnedPtyNativeBinding {
  createWindowsOwnedPtyProcess(
    launch: WindowsOwnedPipeNativeLaunchInput,
    columns: number,
    rows: number,
  ): WindowsOwnedPtyNativeProcess;
}
