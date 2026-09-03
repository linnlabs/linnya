import type { MessageParams } from '@app/localization';
import type { ConversationMessageKey } from '../../../../definitions/conversationMessages';
import type { ToolCompactStepProjector } from '../../types';
import { createConversationToolLocalizedTextDescriptor } from '../../functions/createConversationToolTitleDescriptor';

/**
 * 为不需要解释 payload 的工具动作创建紧凑步骤 projector。
 *
 * 工具与文案的对应关系仍由各 ToolUiConfig 显式注册；这里不维护工具名映射。
 */
export function createStaticToolCompactStepProjector(
  key: ConversationMessageKey,
  params?: MessageParams,
): ToolCompactStepProjector {
  return () => ({
    title: createConversationToolLocalizedTextDescriptor(key, params),
  });
}
