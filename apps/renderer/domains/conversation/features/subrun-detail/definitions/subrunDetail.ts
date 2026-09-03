import type { ConversationMessageId } from '@app/schemas';
import type { SubagentStatus } from '@app/schemas';
import type { InjectionKey } from 'vue';

/** ConversationHost 内一次就地详情导航的不可变业务身份。 */
export interface SubrunDetailScope {
  readonly conversationId: string;
  readonly parentMessageId: ConversationMessageId;
  readonly parentToolCallId: string;
  readonly subrunId: string;
  readonly description: string;
}

export interface SubrunDetailNavigationPort {
  open(scope: SubrunDetailScope): void;
  close(): void;
}

export type SubrunDetailExecutionStatus = 'running' | SubagentStatus;

export interface SubrunDetailFooterPresentation {
  readonly status: SubrunDetailExecutionStatus;
  readonly modelId?: string;
}

export const SUBRUN_DETAIL_NAVIGATION_PORT_KEY: InjectionKey<SubrunDetailNavigationPort> =
  Symbol('conversation:subrun-detail-navigation');
