export type WindowsOwnedPipeNativeOutputChannel = 'stdout' | 'stderr';

export interface WindowsOwnedPipeNativeEnvironmentEntry {
  readonly name: string;
  readonly value: string;
}

export interface WindowsOwnedPipeNativeLaunchInput {
  readonly executablePath: string;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly environment: readonly WindowsOwnedPipeNativeEnvironmentEntry[];
}

export interface WindowsOwnedPipeNativeProcess {
  startObservers(callback: (payload: unknown) => boolean): void;
  resumeAfterObserversReady(): void;
  resumeOutput(channel: WindowsOwnedPipeNativeOutputChannel): void;
  cancelOutput(channel: WindowsOwnedPipeNativeOutputChannel): void;
  terminateAndWaitTreeEmpty(): Promise<void>;
  release(): Promise<void>;
}

export interface WindowsOwnedPipeNativeBinding {
  createWindowsOwnedPipeProcess(
    input: WindowsOwnedPipeNativeLaunchInput,
  ): WindowsOwnedPipeNativeProcess;
}

export type WindowsOwnedPipeNativeEvent =
  | {
      readonly kind: 'data';
      readonly channel: WindowsOwnedPipeNativeOutputChannel;
      readonly bytes: Uint8Array;
    }
  | {
      readonly kind: 'eof';
      readonly channel: WindowsOwnedPipeNativeOutputChannel;
    }
  | {
      readonly kind: 'root_exit';
      readonly exitCode: number;
    }
  | {
      readonly kind: 'observer_error';
      readonly message: string;
    };
