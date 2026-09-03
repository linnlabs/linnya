import type { CommandRunnerEventV1 } from '@app/schemas/commands';

export interface CommandRunnerProcessRuntimeTransport {
  sendEvent(event: CommandRunnerEventV1): Promise<void>;
  writeDiagnostic(message: string): void;
  finish(exitCode: number): void;
}

export interface CommandRunnerProcessController {
  acceptRequest(request: unknown): void;
  ownerEnded(): void;
  transportFailed(message: string): void;
}
