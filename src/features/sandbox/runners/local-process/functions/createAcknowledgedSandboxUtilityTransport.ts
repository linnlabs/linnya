import {
  SANDBOX_UTILITY_ACK_DEADLINE_MS,
  SANDBOX_UTILITY_MAX_PENDING_ACKNOWLEDGEMENTS,
  parseSandboxUtilityEnvelope,
  type SandboxUtilityGeneration,
} from '../definitions/sandboxUtilityTransport.js';

interface PendingAcknowledgement {
  readonly timeout: ReturnType<typeof setTimeout>;
  resolve(): void;
  reject(error: Error): void;
}

export interface AcknowledgedSandboxUtilityTransport<TOutgoingPayload> {
  send(payload: TOutgoingPayload): Promise<void>;
  receive(envelope: unknown): void;
  close(reason: Error): void;
}

/**
 * Electron postMessage 只证明写入通道，不证明对端已经校验。ACK 在同步接纳后返回，
 * 但绝不代表 evaluator 结果、进程树或 mailbox 已经结算。
 */
export function createAcknowledgedSandboxUtilityTransport<
  TOutgoingPayload,
  TIncomingPayload,
>(input: {
  readonly generation: SandboxUtilityGeneration;
  readonly postMessage: (envelope: unknown) => void;
  readonly parseIncomingPayload: (payload: unknown) => TIncomingPayload;
  readonly acceptIncomingPayload: (payload: TIncomingPayload) => undefined;
  readonly onFailure: (error: Error) => void;
  readonly acknowledgementDeadlineMs?: number;
}): AcknowledgedSandboxUtilityTransport<TOutgoingPayload> {
  const acknowledgementDeadlineMs = requirePositiveSafeInteger(
    input.acknowledgementDeadlineMs ?? SANDBOX_UTILITY_ACK_DEADLINE_MS,
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

  function fail(error: unknown): void {
    if (unavailable) return;
    unavailable = toError(error);
    rejectPending(unavailable);
    if (failurePublished) return;
    failurePublished = true;
    input.onFailure(unavailable);
  }

  return Object.freeze({
    send(payload: TOutgoingPayload): Promise<void> {
      if (unavailable) return Promise.reject(unavailable);
      if (pending.size >= SANDBOX_UTILITY_MAX_PENDING_ACKNOWLEDGEMENTS) {
        const error = new Error('sandbox utility pending acknowledgement capacity exceeded');
        fail(error);
        return Promise.reject(error);
      }
      const messageId = nextOutgoingMessageId;
      nextOutgoingMessageId += 1;
      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(messageId);
          const error = new Error(`sandbox utility acknowledgement timed out: ${messageId}`);
          reject(error);
          fail(error);
        }, acknowledgementDeadlineMs);
        pending.set(messageId, { timeout, resolve, reject });
        try {
          input.postMessage({
            kind: 'sandbox_utility_message',
            generation: input.generation,
            messageId,
            payload,
          });
        } catch (error) {
          clearTimeout(timeout);
          pending.delete(messageId);
          reject(toError(error));
          fail(error);
        }
      });
    },

    receive(rawEnvelope: unknown): void {
      if (unavailable) return;
      try {
        const envelope = parseSandboxUtilityEnvelope(rawEnvelope);
        if (envelope.generation !== input.generation) return;
        if (envelope.kind === 'sandbox_utility_ack') {
          const acknowledgement = pending.get(envelope.messageId);
          if (!acknowledgement) {
            throw new Error(`unexpected sandbox utility acknowledgement: ${envelope.messageId}`);
          }
          pending.delete(envelope.messageId);
          clearTimeout(acknowledgement.timeout);
          acknowledgement.resolve();
          return;
        }
        if (envelope.messageId !== nextIncomingMessageId) {
          throw new Error(
            `sandbox utility message sequence mismatch: expected ${nextIncomingMessageId}, received ${envelope.messageId}`,
          );
        }
        const payload = input.parseIncomingPayload(envelope.payload);
        input.acceptIncomingPayload(payload);
        input.postMessage({
          kind: 'sandbox_utility_ack',
          generation: input.generation,
          messageId: envelope.messageId,
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

function requirePositiveSafeInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('sandbox utility acknowledgement deadline must be a positive safe integer');
  }
  return value;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
