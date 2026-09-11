import {
  CONVERSATION_CONTROL_SCHEMA_VERSION,
  type ConversationUiMessage,
  type ConversationControlWorkspaceToolsRequest,
} from '@app/schemas';
import {
  LinnyaCliError,
  type ConversationControlClient,
} from '../definitions/cli';
import { workspaceToolSucceeded } from '../functions/workspaceToolOutcome';
import { watchConversationStatus } from './watchConversationStatus';

interface ExecuteWorkspaceToolCallOptions {
  readonly client: ConversationControlClient;
  readonly request: Extract<ConversationControlWorkspaceToolsRequest, { action: 'call' }>;
  readonly intervalMs: number;
  readonly timeoutMs: number;
  readonly now?: () => number;
  readonly sleep?: (durationMs: number) => Promise<void>;
}

/**
 * CLI 的同步体验只负责等待 Host 已接纳的 detached run；工具执行本身仍完全归 ToolNode。
 * terminal 与 UI projection 是两个独立 durable owner，因此终态后还需短暂等待工具卡投影完成。
 */
export async function executeWorkspaceToolCall(options: ExecuteWorkspaceToolCallOptions) {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? (durationMs => new Promise(resolve => setTimeout(resolve, durationMs)));
  const startedAt = now();
  const accepted = await options.client.execute(options.request);
  if (accepted.command !== 'workspace_tools' || accepted.action !== 'call') {
    throw new LinnyaCliError(
      'protocol_incompatible',
      'Workspace tool call returned another response type',
      false,
      'workspace_tools',
    );
  }

  const terminal = await watchConversationStatus({
    client: options.client,
    request: {
      schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
      command: 'status',
      conversation_id: accepted.receipt.conversation_id,
      expected_run_id: accepted.receipt.run_id,
    },
    intervalMs: options.intervalMs,
    timeoutMs: options.timeoutMs,
    writeFrame: () => undefined,
    now,
    sleep,
  });
  if (!terminal || terminal.status !== 'completed') {
    throw new LinnyaCliError(
      'internal_error',
      terminal?.error?.message ?? `Workspace tool run ended as ${terminal?.status ?? 'missing'}`,
      false,
      'workspace_tools',
    );
  }

  while (true) {
    const response = await options.client.execute({
      schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
      command: 'messages',
      conversation_id: accepted.receipt.conversation_id,
      window: 'tail',
      limit: 200,
    });
    if (response.command !== 'messages') {
      throw new LinnyaCliError(
        'protocol_incompatible',
        'Workspace tool result query returned another response type',
        false,
        'workspace_tools',
      );
    }
    if (response.status === 'ready') {
      const matches = response.messages.filter(
        (message): message is Extract<ConversationUiMessage, { message_type: 'tool_calls' }> => (
          message.run_id === accepted.receipt.run_id
          && message.message_type === 'tool_calls'
          && message.payload.tool_name === accepted.tool_name
          && message.payload.status !== 'loading'
        ),
      );
      if (matches.length === 1 && matches[0]) {
        return {
          schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
          ok: workspaceToolSucceeded(matches[0]),
          command: 'workspace_tools' as const,
          action: 'call' as const,
          conversation_id: accepted.receipt.conversation_id,
          run_id: accepted.receipt.run_id,
          tool: matches[0],
        };
      }
      if (matches.length > 1) {
        throw new LinnyaCliError(
          'internal_error',
          `Workspace tool run ${accepted.receipt.run_id} produced multiple terminal tool results`,
          false,
          'workspace_tools',
        );
      }
    }
    if (now() - startedAt >= options.timeoutMs) {
      throw new LinnyaCliError(
        'result_unavailable',
        `Workspace tool result projection timed out after ${options.timeoutMs}ms`,
        true,
        'workspace_tools',
      );
    }
    await sleep(options.intervalMs);
  }
}
