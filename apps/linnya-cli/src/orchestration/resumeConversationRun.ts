import {
  CONVERSATION_CONTROL_SCHEMA_VERSION,
  ConversationControlResumeRequestSchema,
  type ConversationControlResumeResponse,
} from '@app/schemas';
import {
  LinnyaCliError,
  requireCapability,
  type ConversationControlClient,
} from '../definitions/cli';

/**
 * 先读取 exact run 的 settled pause，再把观察到的 execution fence 原样交回 Host。
 * CLI 不生成用户消息、不审批 interaction，也不自行解释 checkpoint 或工具副作用。
 */
export async function resumeConversationRun(input: {
  readonly client: ConversationControlClient;
  readonly conversationId: string;
  readonly runId: string;
  readonly timeoutMs: number;
}): Promise<ConversationControlResumeResponse> {
  requireCapability(input.client.handshake.capabilities, 'resume');
  const status = await input.client.execute({
    schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
    command: 'status',
    conversation_id: input.conversationId,
    expected_run_id: input.runId,
  });
  if (status.command !== 'status' || status.run?.run_id !== input.runId) {
    throw new LinnyaCliError(
      'protocol_incompatible',
      'Expected the exact run status before resume',
      false,
      'resume'
    );
  }
  if (status.run.status === 'awaiting_user') {
    throw new LinnyaCliError(
      'unsupported_runtime_state',
      `Run ${input.runId} is awaiting user input; use linnya respond instead`,
      false,
      'resume'
    );
  }
  if (status.run.status !== 'paused' || status.run.pause?.settled !== true) {
    throw new LinnyaCliError(
      'unsupported_runtime_state',
      `Run ${input.runId} is ${status.run.status}; only a settled paused run can be resumed`,
      false,
      'resume'
    );
  }
  const request = ConversationControlResumeRequestSchema.parse({
    schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
    command: 'resume',
    conversation_id: input.conversationId,
    expected_run_id: input.runId,
    expected_execution_id: status.run.execution_id,
    expected_updated_at: status.run.updated_at,
  });
  const response = await input.client.execute(request, { timeoutMs: input.timeoutMs });
  if (response.command !== 'resume' || response.receipt.run_id !== input.runId) {
    throw new LinnyaCliError(
      'protocol_incompatible',
      'Resume returned another run or response type',
      false,
      'resume'
    );
  }
  return response;
}
