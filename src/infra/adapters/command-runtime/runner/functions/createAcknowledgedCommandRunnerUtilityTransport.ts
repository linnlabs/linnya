import type { CommandRunnerUtilityGeneration } from '../definitions/commandRunnerUtilityTransport';
import {
  COMMAND_RUNNER_UTILITY_ACK_DEADLINE_MS,
  parseCommandRunnerUtilityEnvelope,
} from '../definitions/commandRunnerUtilityTransport';

interface PendingAcknowledgement {
  readonly timeout: ReturnType<typeof setTimeout>;
  resolve(): void;
  reject(error: Error): void;
}

export interface AcknowledgedCommandRunnerUtilityTransport<TOutgoingPayload> {
  send(payload: TOutgoingPayload): Promise<void>;
  receive(envelope: unknown): void;
  close(reason: Error): void;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function requireAcknowledgementDeadline(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('command runner utility acknowledgement deadline must be a positive safe integer');
  }
  return value;
}

/**
 * Electron postMessage 只表示消息进入 Chromium 通道，不表示接收方已校验或分派。
 * 因此两端共用显式 ACK；ACK 只在同步分派完成后发送，并用连续编号避免无界去重表。
 */
export function createAcknowledgedCommandRunnerUtilityTransport<
  TOutgoingPayload,
  TIncomingPayload,
>(input: {
  readonly generation: CommandRunnerUtilityGeneration;
  readonly postMessage: (envelope: unknown) => void;
  readonly parseIncomingPayload: (payload: unknown) => TIncomingPayload;
  readonly acceptIncomingPayload: (payload: TIncomingPayload) => void;
  readonly onFailure: (error: Error) => void;
  readonly acknowledgementDeadlineMs?: number;
}): AcknowledgedCommandRunnerUtilityTransport<TOutgoingPayload> {
  const acknowledgementDeadlineMs = requireAcknowledgementDeadline(
    input.acknowledgementDeadlineMs ?? COMMAND_RUNNER_UTILITY_ACK_DEADLINE_MS,
  );
  const pending = new Map<number, PendingAcknowledgement>();
  let nextOutgoingMessageId = 0;
  let nextIncomingMessageId = 0;
  let unavailable: Error | undefined;
  let failurePublished = false;

  function rejectPending(error: Error): void {
    for (const acknowledgement of pending.values()) {
      clearTimeout(acknowledgement.timeout);
      acknowledgement.reject(error);
    }
    pending.clear();
  }

  function fail(rawError: unknown): void {
    if (unavailable) return;
    const error = toError(rawError);
    unavailable = error;
    rejectPending(error);
    if (!failurePublished) {
      failurePublished = true;
      input.onFailure(error);
    }
  }

  return Object.freeze({
    send(payload: TOutgoingPayload): Promise<void> {
      if (unavailable) return Promise.reject(unavailable);
      const transportMessageId = nextOutgoingMessageId;
      nextOutgoingMessageId += 1;
      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(transportMessageId);
          const error = new Error(
            `command runner utility acknowledgement timed out: ${transportMessageId}`,
          );
          reject(error);
          fail(error);
        }, acknowledgementDeadlineMs);
        pending.set(transportMessageId, { timeout, resolve, reject });
        try {
          input.postMessage({
            kind: 'command_runner_utility_message',
            generation: input.generation,
            transport_message_id: transportMessageId,
            payload,
          });
        } catch (error) {
          clearTimeout(timeout);
          pending.delete(transportMessageId);
          reject(toError(error));
          fail(error);
        }
      });
    },

    receive(rawEnvelope: unknown): void {
      if (unavailable) return;
      try {
        const envelope = parseCommandRunnerUtilityEnvelope(rawEnvelope);
        // 每个 adapter 只接受自己创建的 generation，迟到旧 callback 不得伤害新 owner。
        if (envelope.generation !== input.generation) return;
        if (envelope.kind === 'command_runner_utility_ack') {
          const acknowledgement = pending.get(envelope.transport_message_id);
          if (!acknowledgement) {
            throw new Error(
              `unexpected command runner utility acknowledgement: ${envelope.transport_message_id}`,
            );
          }
          pending.delete(envelope.transport_message_id);
          clearTimeout(acknowledgement.timeout);
          acknowledgement.resolve();
          return;
        }
        if (envelope.transport_message_id !== nextIncomingMessageId) {
          throw new Error(
            `command runner utility message sequence mismatch: expected ${nextIncomingMessageId}, `
              + `received ${envelope.transport_message_id}`,
          );
        }
        const payload = input.parseIncomingPayload(envelope.payload);
        input.acceptIncomingPayload(payload);
        input.postMessage({
          kind: 'command_runner_utility_ack',
          generation: input.generation,
          transport_message_id: envelope.transport_message_id,
        });
        nextIncomingMessageId += 1;
      } catch (error) {
        fail(error);
      }
    },

    close(reason: Error): void {
      if (unavailable) return;
      unavailable = reason;
      rejectPending(reason);
    },
  });
}
