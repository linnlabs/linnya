import type { UserQuoteItemData } from '@app/schemas';
import { buildConversationReferencePreview } from './conversationReferences';

export interface UserMessageQuoteDisplay {
  readonly item: UserQuoteItemData;
  readonly displayText: string;
}

/** 历史展示优先使用生产方给出的业务 label；缺失时退回正文预览。 */
export function buildUserMessageQuoteDisplay(
  item: UserQuoteItemData,
): UserMessageQuoteDisplay | undefined {
  const textPreview = buildConversationReferencePreview({
    text: item.text,
    previewText: item.text,
  });
  const displayText = item.label?.trim() || textPreview;

  return displayText ? { item, displayText } : undefined;
}
