import type { MessageParams } from '@app/localization';
import { CONVERSATION_MESSAGE_FALLBACKS } from '../../../definitions/conversationMessageCatalog';
import type { ConversationMessageKey } from '../../../definitions/conversationMessages';
import type { ToolLocalizedTextDescriptor, ToolTitleDescriptor } from '../types';

/** 工具展示派生共用的延迟本地化文本；不读取当前 locale。 */
export function createConversationToolLocalizedTextDescriptor(
  key: ConversationMessageKey,
  params?: MessageParams,
): ToolLocalizedTextDescriptor {
  return {
    key,
    fallback: CONVERSATION_MESSAGE_FALLBACKS[key],
    ...(params ? { params } : {}),
  };
}

/** 工具 projector 只保存可延迟解析的文案身份，不缓存当前语言字符串。 */
export function createConversationToolTitleDescriptor(
  key: ConversationMessageKey,
  params?: MessageParams,
): ToolTitleDescriptor {
  return {
    text: createConversationToolLocalizedTextDescriptor(key, params),
  };
}
