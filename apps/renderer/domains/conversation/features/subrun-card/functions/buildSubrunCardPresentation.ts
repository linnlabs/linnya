import type { ConversationMessageResolver } from '../../../definitions/conversationMessages';
import type { ConversationCardGroupHeader } from '../../../definitions/conversationPresentation';
import type { BaseMessage } from '../../../types';
import type { ConversationMessageId } from '@app/schemas';

export function buildSubrunCardPresentation(params: {
  readonly history: readonly BaseMessage[];
  readonly headerMessageId: ConversationMessageId;
  readonly description: string;
  readonly conversationMessage: ConversationMessageResolver;
}): { readonly header: ConversationCardGroupHeader; readonly children: BaseMessage[] } {
  return {
    children: [...params.history],
    header: {
      id: `subrun_header_${params.headerMessageId}`,
      collapsedByDefault: true,
      headerText: params.description
        || params.conversationMessage('conversation.tool.subrun.headerFallback'),
    },
  };
}
