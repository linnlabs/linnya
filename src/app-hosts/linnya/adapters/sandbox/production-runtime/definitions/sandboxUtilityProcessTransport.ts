import type {
  SandboxUtilityChildPayload,
  SandboxUtilityGeneration,
  SandboxUtilityHostPayload,
} from 'src/features/sandbox/runners/local-process/definitions/sandboxUtilityTransport';

export type SandboxUtilityStartPayload = Extract<
  SandboxUtilityHostPayload,
  { readonly kind: 'sandbox_start' }
>;

export type SandboxUtilityEvaluatorFramePayload = Extract<
  SandboxUtilityChildPayload,
  { readonly kind: 'sandbox_evaluator_frame' }
>;

export type SandboxUtilityTerminalPayload = Extract<
  SandboxUtilityChildPayload,
  { readonly kind: 'sandbox_terminal' }
>;

export interface SandboxUtilityProcessLike {
  readonly stderr: NodeJS.ReadableStream | null;
  postMessage(message: unknown): void;
  kill(): boolean;
  onMessage(listener: (message: unknown) => void): void;
  onceExit(listener: (exitCode: number) => void): void;
  onceError(listener: (error: Error) => void): void;
}

export interface SandboxUtilityProcessExit {
  readonly exitCode: number;
  readonly stderrBytes: number;
  readonly stderrTail: string;
  readonly transportFailure?: Error;
}

export interface SandboxUtilityProcessTerminal {
  readonly utilityPid: number;
  readonly evaluatorFrames: readonly SandboxUtilityEvaluatorFramePayload[];
  readonly terminal: SandboxUtilityTerminalPayload;
}

export interface SandboxUtilityProcessTransport {
  waitUntilReady(): Promise<number>;
  sendStart(payload: SandboxUtilityStartPayload): Promise<void>;
  sendCancel(runToken: string): Promise<void>;
  endOwner(): Promise<void>;
  waitForTerminal(): Promise<SandboxUtilityProcessTerminal>;
  waitForExit(): Promise<SandboxUtilityProcessExit>;
  killAndWait(): Promise<SandboxUtilityProcessExit>;
}

export interface CreateSandboxUtilityProcessTransportInput {
  readonly child: SandboxUtilityProcessLike;
  readonly generation: SandboxUtilityGeneration;
  readonly acknowledgementDeadlineMs?: number;
  readonly readyDeadlineMs?: number;
  readonly exitDeadlineMs?: number;
}
