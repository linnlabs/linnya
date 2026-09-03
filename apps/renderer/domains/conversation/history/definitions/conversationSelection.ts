/**
 * 对话列表的操作选择集合。
 *
 * 中文说明：它只服务批量删除等列表操作，不表示当前正在打开的会话；
 * 当前会话由 activeConversationId 独立表达。
 */
export interface ConversationBatchSelectionState {
  readonly selectedIds: readonly string[];
  readonly anchorId: string | null;
}

export interface ConversationSelectionGestureInput {
  readonly shiftKey: boolean;
  readonly toggleKey: boolean;
  /**
   * 普通点击由 active conversation 承担单选状态，因此它也是首次 Shift 范围选择的隐式锚点。
   */
  readonly activeConversationId: string | null;
}

export type ConversationSelectionGestureResult =
  | { readonly kind: 'open-conversation' }
  | {
      readonly kind: 'update-batch-selection';
      readonly selection: ConversationBatchSelectionState;
    };
