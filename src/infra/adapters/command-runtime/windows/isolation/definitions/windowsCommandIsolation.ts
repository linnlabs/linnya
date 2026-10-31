import type { WindowsOwnedPipeNativeLaunchInput, WindowsOwnedPipeNativeProcess } from '../../../../local-process-runtime/windows';
import type { WindowsOwnedPtyNativeProcess } from '../../definitions/windowsOwnedPtyNativeBinding';

export interface WindowsCommandIsolationInput {
  readonly helperPath: string;
  readonly protectedRoots: readonly string[];
  readonly readableRoots: readonly string[];
  readonly writeRoots: readonly string[];
}

export interface WindowsCommandIsolationBinding {
  createPipe(input: WindowsOwnedPipeNativeLaunchInput, isolation: WindowsCommandIsolationInput): Promise<WindowsOwnedPipeNativeProcess>;
  createPty(input: WindowsOwnedPipeNativeLaunchInput, isolation: WindowsCommandIsolationInput, columns: number, rows: number): Promise<WindowsOwnedPtyNativeProcess>;
}
