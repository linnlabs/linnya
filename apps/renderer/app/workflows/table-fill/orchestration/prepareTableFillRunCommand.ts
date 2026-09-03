import { generateMessageId } from '@shared/utils/idUtils';
import {
  prepareConversationSubrunRunCommand,
  type ConversationSubrunRunAssistantStore,
  type ConversationSubrunRunScope,
} from '@/domains/conversation/features/subrun-invocation';
import type { PrepareTableFillRunResult } from '../definitions/tableFillRunCommand';
import { resolveCurrentTableFillMessage } from '../functions/resolveCurrentTableFillMessage';

interface PrepareTableFillRunCommandOptions {
  assistantStore: ConversationSubrunRunAssistantStore;
  workspaceScopeStore: ConversationSubrunRunScope;
  signal: AbortSignal;
  createRunId?: () => string;
  createMessageId?: () => string;
}

/** 为系统表格批次准备 command scope；durable ack 到达前不创建 Conversation 消息。 */
export async function prepareTableFillRunCommand(
  options: PrepareTableFillRunCommandOptions,
): Promise<PrepareTableFillRunResult> {
  return prepareConversationSubrunRunCommand({
    runId: options.createRunId?.() ?? generateMessageId(),
    assistantStore: options.assistantStore,
    workspaceScopeStore: options.workspaceScopeStore,
    signal: options.signal,
    createMessageId: options.createMessageId,
    resolveMissingConversationMessage: () => resolveCurrentTableFillMessage(
      'tableFill.flow.missingConversation',
    ),
    resolveMissingProjectMessage: () => resolveCurrentTableFillMessage(
      'tableFill.flow.missingProject',
    ),
  });
}
