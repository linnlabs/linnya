import {
  CONVERSATION_CONTROL_SCHEMA_VERSION,
  type ConversationControlStopRequest,
  type ConversationControlStopResponse,
} from '@app/schemas';
import { LinnyaCliError, type ConversationControlClient } from '../definitions/cli';

/** 首次选择后固定 run 身份；丢失响应后的重试不能碰到后来启动的 run。 */
export async function stopConversationRun(input: {
  readonly client: ConversationControlClient;
  readonly request: ConversationControlStopRequest;
  readonly timeoutMs: number;
  readonly now?: () => number;
}): Promise<ConversationControlStopResponse> {
  let runId = input.request.expected_run_id;
  if (!runId) {
    const status = await input.client.execute({
      schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
      command: 'status',
      conversation_id: input.request.conversation_id,
    });
    if (status.command !== 'status') {
      throw new LinnyaCliError('protocol_incompatible', 'Expected status before stop', false, 'stop');
    }
    if (!status.run || !['pending', 'running', 'awaiting_user', 'paused'].includes(status.run.status)) {
      throw new LinnyaCliError('no_active_run',
        'No active foreground run. Use stop --run <id> to confirm a specific run settlement.', false, 'stop');
    }
    runId = status.run.run_id;
  }
  const request = { ...input.request, expected_run_id: runId };
  const now = input.now ?? Date.now;
  const deadline = now() + input.timeoutMs;
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await input.client.execute(request, {
        timeoutMs: Math.max(1, deadline - now()),
      });
      if (response.command !== 'stop' || response.run_id !== runId) {
        throw new LinnyaCliError('protocol_incompatible', 'Stop returned another run or response type', false, 'stop');
      }
      return response;
    } catch (error: unknown) {
      const ambiguous = error instanceof LinnyaCliError && error.retryable
        && (error.code === 'stale_connection' || error.code === 'transport_failure');
      if (!ambiguous) throw error;
      // 只重试有幂等合同的 exact stop，最多一次且共用总等待预算。
      if (attempt === 0 && now() < deadline) continue;
      throw new LinnyaCliError(error.code,
        `${error.message} Stop outcome is unconfirmed. Recheck with: linnya stop ${request.conversation_id} --run ${runId} --timeout ${input.timeoutMs}`,
        true, 'stop');
    }
  }
}
