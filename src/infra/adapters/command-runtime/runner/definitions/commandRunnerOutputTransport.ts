import type { CommandRunnerEventV1 } from '@app/schemas/commands';

export type CommandRunnerOutputEventV1 = Extract<
  CommandRunnerEventV1,
  { readonly kind: 'command_runner_output' | 'command_runner_pty_output' }
>;

export type CommandRunnerControlEventV1 = Exclude<
  CommandRunnerEventV1,
  CommandRunnerOutputEventV1
>;

export interface CommandRunnerOutputTransportLimits {
  readonly maxPendingEvents: number;
  readonly maxPendingBytes: number;
}

/**
 * runner 与 host 各自拥有独立的短突发队列；两者都必须有界，不能用某一侧的预算
 * 假定另一侧永远及时。pipe 双流或 PTY terminal 单流都按 execution 共享同一容量。
 */
export const DEFAULT_COMMAND_RUNNER_OUTPUT_TRANSPORT_LIMITS: CommandRunnerOutputTransportLimits = Object.freeze({
  maxPendingEvents: 1024,
  maxPendingBytes: 4 * 1024 * 1024,
});

export type CommandRunnerOutputOfferResult =
  | { readonly status: 'accepted' }
  | { readonly status: 'overloaded' }
  | { readonly status: 'unavailable' };

export interface CommandRunnerEventTransport {
  offerOutput(event: CommandRunnerOutputEventV1): CommandRunnerOutputOfferResult;
  /** control event 与此前已接纳的 output 共用同一有序 IPC，不能越过待发送 byte。 */
  sendControl(event: CommandRunnerControlEventV1): Promise<void>;
}

export type CommandRunnerEventSendOperation = (
  event: CommandRunnerEventV1,
) => Promise<void>;
