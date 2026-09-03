import { generateMessageId } from '@shared/utils/idUtils';
import type { ConversationMessageExtension } from '@app/schemas';

import { resolveConversationProjectId } from '../../../functions/resolveConversationProjectId';
import {
  ensureMaterializedConversation,
  hasRenderableConversationContent,
} from '../../../services/orchestration/ensureMaterializedConversation';
import type {
  ConversationSubrunRunAssistantStore,
  ConversationSubrunRunScope,
  PrepareConversationSubrunRunCommandResult,
} from '../definitions/conversationSubrunRunCommand';

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export interface PrepareConversationSubrunRunCommandOptions {
  readonly runId: string;
  readonly userInputExtension?: ConversationMessageExtension;
  readonly assistantStore: ConversationSubrunRunAssistantStore;
  readonly workspaceScopeStore: ConversationSubrunRunScope;
  readonly signal: AbortSignal;
  readonly resolveMissingConversationMessage: () => string;
  readonly resolveMissingProjectMessage: () => string;
  readonly createMessageId?: () => string;
}

function readConversationMetadata(activeConversation: unknown): unknown {
  return isRecord(activeConversation) ? activeConversation.metadata : undefined;
}

/**
 * 准备 subrun 的 request scope，不创建 UI 消息。
 *
 * `messageId` 在此阶段只是发给 Host 的 command identity。只有
 * `user_input_committed` 才能把它接纳为 Renderer timeline message。
 */
export function prepareConversationSubrunRunCommand(
  options: PrepareConversationSubrunRunCommandOptions,
): PrepareConversationSubrunRunCommandResult {
  if (options.signal.aborted) return { ok: false, reason: 'cancelled' };

  if (!options.assistantStore.activeConversation && !options.workspaceScopeStore.currentProjectId) {
    return {
      ok: false,
      reason: 'project-missing',
      message: options.resolveMissingProjectMessage(),
    };
  }

  const conversation = ensureMaterializedConversation(
    options.assistantStore,
    options.workspaceScopeStore,
  );
  if (!conversation) {
    return {
      ok: false,
      reason: 'conversation-missing',
      message: options.resolveMissingConversationMessage(),
    };
  }

  const projectId = resolveConversationProjectId(
    options.workspaceScopeStore.currentProjectId,
    readConversationMetadata(conversation),
  );
  if (!projectId) {
    return {
      ok: false,
      reason: 'project-missing',
      message: options.resolveMissingProjectMessage(),
    };
  }

  return {
    ok: true,
    run: {
      conversationId: conversation.id,
      runId: options.runId,
      messageId: options.createMessageId?.() ?? generateMessageId(),
      projectId,
      projectMetadata: { id: projectId },
      wasNewConversation: !hasRenderableConversationContent(
        conversation,
        options.assistantStore.activeMessages,
      ),
      ...(options.userInputExtension ? { userInputExtension: options.userInputExtension } : {}),
    },
  };
}
