import type { CommandRunnerRequestV1 } from '@app/schemas/commands';

export interface CommandRunnerProcessHandlers {
  onMessage(message: unknown): void;
  onDiagnostic(bytes: Uint8Array): void;
  onDisconnect(): void;
  onError(error: unknown): void;
  onClose(): void;
}

/**
 * 一次性 helper 的宿主控制面。业务 child、PID、stdio 和 Node ChildProcess 都留在 adapter 内，
 * host 只发送已冻结的 runner wire，并观察消息与最终 close。
 */
export interface CommandRunnerProcessControl {
  send(request: CommandRunnerRequestV1): Promise<void>;
  disconnect(): void;
  kill(): void;
}

export interface CommandRunnerProcessPort {
  /** fork 会创建 OS 资源，因此只能在 Prepared runtime 的 start() 内调用。 */
  fork(handlers: CommandRunnerProcessHandlers): CommandRunnerProcessControl;
}
