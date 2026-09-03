import type { ConversationMessageKey } from '../../../definitions/conversationMessages';

/** 工具业务失败映射出的最小产品动作；执行仍由 Conversation UI 编排。 */
export interface ToolErrorAction {
  readonly messageKey: ConversationMessageKey;
  readonly actionLabelKey: ConversationMessageKey;
  readonly settingsTabId: string;
}
