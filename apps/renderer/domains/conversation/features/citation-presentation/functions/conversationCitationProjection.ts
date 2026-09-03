import {
  ConversationCitationDependencySnapshotSchema,
  type SearchResultCitation,
} from '@app/schemas';
import {
  createConversationCitationWorkspace,
  extractCanonicalCitationRefs,
  projectConversationCitationDependencies,
  projectConversationCitationRegistration,
} from '@linnya/citation-domain/conversation-presentation';

import type { BaseMessage } from '../../../types';
import type { ConversationCitationProjectionWorkspace } from '../definitions/conversationCitationPresentation';

function readMessageTurnId(message: BaseMessage): string | null {
  if (message.type === 'summarization_progress') return null;
  const turnId = message.metadata?.turn_id;
  return typeof turnId === 'string' && turnId.length > 0 ? turnId : null;
}

export function createConversationCitationProjectionWorkspace(
): ConversationCitationProjectionWorkspace {
  return createConversationCitationWorkspace();
}

/**
 * 先在 detached Map 上完成冲突校验，再一次性返回新 workspace。
 * 调用方可在消息 commit 成功后替换工作区，避免半提交。
 */
export function projectMessageCitationDependencies(
  workspace: ConversationCitationProjectionWorkspace,
  turnId: string,
  content: string,
): ReturnType<typeof ConversationCitationDependencySnapshotSchema.parse> | undefined {
  const refs = extractCanonicalCitationRefs(content);
  if (refs.length === 0) return undefined;
  return ConversationCitationDependencySnapshotSchema.parse(
    projectConversationCitationDependencies(workspace, turnId, refs),
  );
}

export { projectConversationCitationRegistration };

export function findCitationInMessages(
  messages: readonly BaseMessage[],
  turnId: string,
  ref: string,
): SearchResultCitation | null {
  for (const message of messages) {
    if (readMessageTurnId(message) !== turnId) continue;
    const citation = message.citationDependencies?.citations.find(item => item.ref === ref);
    if (citation) return citation;
  }
  return null;
}
