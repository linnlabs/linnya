import type { BaseMessage } from '../../../types';
import type { ConversationMessageExtension } from '@app/schemas';
import type {
  ConversationMaterializationAssistantStore,
  ConversationMaterializationScopeStore,
} from '../../../services/orchestration/ensureMaterializedConversation';

export interface ConversationSubrunRunScope extends ConversationMaterializationScopeStore {
  readonly currentProjectId: string | null;
}

export interface ConversationSubrunRunAssistantStore extends ConversationMaterializationAssistantStore {
  readonly activeMessages: BaseMessage[];
}

export interface PreparedConversationSubrunRun {
  readonly conversationId: string;
  readonly runId: string;
  /** Renderer 只预分配 command identity；收到 durable ack 前不得创建同 ID 的消息。 */
  readonly messageId: string;
  readonly projectId: string;
  readonly projectMetadata: { readonly id: string };
  readonly wasNewConversation: boolean;
  readonly userInputExtension?: ConversationMessageExtension;
}

export type PrepareConversationSubrunRunCommandResult =
  | { readonly ok: true; readonly run: PreparedConversationSubrunRun }
  | { readonly ok: false; readonly reason: 'cancelled' }
  | {
      readonly ok: false;
      readonly reason: 'conversation-missing' | 'project-missing';
      readonly message: string;
    };
