import type { LinnyaLocale } from '@app/localization';
import type {
  ConversationInformationPresentation,
  ConversationInformationProjectionInput,
} from '../definitions/conversationInformation';

export function projectConversationInformation(
  input: ConversationInformationProjectionInput,
): ConversationInformationPresentation {
  const visibleUserMessageCount = input.messages.reduce(
    (count, message) => count + (message.type === 'user_input' ? 1 : 0),
    0,
  );

  return {
    createdAt: input.createdAt,
    // 历史列表提供全量计数；live 数量用于覆盖新会话尚未完成 metadata 同步的短暂阶段。
    userMessageCount: Math.max(input.persistedUserMessageCount ?? 0, visibleUserMessageCount),
  };
}

export function formatConversationCreatedAt(timestamp: number, locale: LinnyaLocale): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

export function formatConversationUserMessageCount(
  count: number,
  locale: LinnyaLocale,
): string {
  return new Intl.NumberFormat(locale).format(count);
}
