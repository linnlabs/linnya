import type { ConversationAnswerCompletionReason } from '@app/schemas';
import type { AnswerMessage, BaseMessage } from '../../types';
import type { UiMessageDto } from './uiMessagesDto';
import type { Raw } from 'vue';

export const WINDOW_MAX_ROWS = 320;

export type MessageWindowLoadMode = 'tail' | 'before' | 'after' | 'around';

export type MessageWindowStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'preparing'
  | 'error';

export interface WindowMessageRow {
  readonly conversationId: string;
  readonly messageId: string;
  readonly sortSeq: number;
  readonly revision: number;
  readonly dto: UiMessageDto;
  readonly message: BaseMessage;
}

/**
 * Window 行是加载完成后不可变的历史快照，只允许 store 通过替换行或数组更新。
 * 标记 Raw 可阻止 Vue 深代理大段历史 payload；外层 rows 数组仍保持响应式。
 */
export type StoredWindowMessageRow = Raw<WindowMessageRow>;

export interface MessageWindowSnapshot {
  readonly conversationId: string;
  readonly rows: readonly WindowMessageRow[];
  readonly hasMoreBefore: boolean;
  readonly hasMoreAfter: boolean;
  readonly prevCursor?: number;
  readonly nextCursor?: number;
  readonly revision: number;
}

export interface MessageWindowStateSnapshot {
  readonly conversationId: string | null;
  readonly status: MessageWindowStatus;
  readonly rows: readonly WindowMessageRow[];
  readonly hasMoreBefore: boolean;
  readonly hasMoreAfter: boolean;
  readonly prevCursor?: number;
  readonly nextCursor?: number;
  readonly revision: number | null;
  readonly loadingMode: MessageWindowLoadMode | null;
  readonly error: string | null;
}

export interface MessageWindowState {
  conversationId: string | null;
  status: MessageWindowStatus;
  rows: StoredWindowMessageRow[];
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
  prevCursor?: number;
  nextCursor?: number;
  revision: number | null;
  loadingMode: MessageWindowLoadMode | null;
  error: string | null;
}

export interface MergeWindowAndLiveResult {
  readonly messages: readonly BaseMessage[];
  readonly rows: readonly WindowMessageRow[];
  /**
   * 仅用于诊断绕过 admission 后形成的非法状态。
   * 生产写入必须在 window/live 各自入口拒绝冲突，selector 不负责吞错或修复身份。
   */
  readonly conflicts: readonly WindowLiveMessageConflict[];
}

export type WindowLiveMessageConflict =
  | {
      readonly kind: 'message_type';
      readonly messageId: string;
      readonly windowType: BaseMessage['type'];
      readonly liveType: BaseMessage['type'];
    }
  | {
      readonly kind: 'answer_seal';
      readonly messageId: string;
      readonly windowType: AnswerMessage['type'];
      readonly liveType: AnswerMessage['type'];
      readonly windowCompletionReason: ConversationAnswerCompletionReason;
      readonly liveCompletionReason: ConversationAnswerCompletionReason;
      readonly contentMismatch: boolean;
    };
