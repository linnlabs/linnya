import {
  CONVERSATION_CONTROL_SCHEMA_VERSION,
  ConversationControlProgressFrameSchema,
  type ConversationControlProgressFrame,
  type ConversationControlRunStatusSnapshot,
  type ConversationControlStatusRequest,
} from '@app/schemas';
import { LinnyaCliError, type ConversationControlClient } from '../definitions/cli';

interface WatchConversationStatusOptions {
  readonly client: ConversationControlClient;
  readonly request: ConversationControlStatusRequest;
  readonly intervalMs: number;
  readonly timeoutMs: number;
  readonly writeFrame: (frame: ConversationControlProgressFrame) => void;
  readonly now?: () => number;
  readonly sleep?: (durationMs: number) => Promise<void>;
}

function hasWatchSettled(
  status: ConversationControlRunStatusSnapshot['status'],
): boolean {
  return status === 'awaiting_user'
    || status === 'completed'
    || status === 'failed'
    || status === 'cancelled';
}

export async function watchConversationStatus(
  options: WatchConversationStatusOptions,
): Promise<void> {
  if (options.intervalMs < options.client.handshake.limits.min_watch_interval_ms) {
    throw new LinnyaCliError(
      'invalid_request',
      `--interval must be at least ${options.client.handshake.limits.min_watch_interval_ms}ms`,
      false,
      'status',
    );
  }
  if (options.timeoutMs > options.client.handshake.limits.max_watch_timeout_ms) {
    throw new LinnyaCliError(
      'invalid_request',
      `--timeout must not exceed ${options.client.handshake.limits.max_watch_timeout_ms}ms`,
      false,
      'status',
    );
  }

  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? (durationMs => new Promise(resolve => setTimeout(resolve, durationMs)));
  const startedAt = now();
  let sequence = 0;
  let previousSnapshot: string | undefined;

  while (true) {
    const response = await options.client.execute(options.request);
    if (response.command !== 'status') {
      throw new LinnyaCliError('protocol_incompatible', 'Status command returned another response type');
    }
    const serialized = JSON.stringify(response.run);
    if (serialized !== previousSnapshot) {
      const frame = ConversationControlProgressFrameSchema.parse({
        schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
        frame: 'status',
        sequence,
        observed_at: now(),
        snapshot: response.run,
      });
      options.writeFrame(frame);
      previousSnapshot = serialized;
      sequence += 1;
    }
    if (!response.run || hasWatchSettled(response.run.status)) return;
    if (now() - startedAt >= options.timeoutMs) {
      throw new LinnyaCliError(
        'transport_failure',
        `Status watch timed out after ${options.timeoutMs}ms`,
        true,
        'status',
      );
    }
    await sleep(options.intervalMs);
  }
}
