import type { Component } from 'vue';
import type { UserQuoteItemData } from '@app/schemas';
import type { ConversationReferenceChipInput } from '@linnya/plugin-host-contract/renderer';
import { buildConversationReferencePreview } from './conversationReferences';
import { fromUserQuoteItemWire } from './userQuoteWire';

export interface UserMessageQuoteDisplay {
  readonly item: UserQuoteItemData;
  readonly displayText: string;
  /** 引用类型声明了对象图标时按标签显示；null 表示正文引用，按引用块显示。 */
  readonly icon: Component | null;
}

/** 历史条目投影回引用类型的通用展示输入；字段映射集中在 userQuoteWire。 */
export function toConversationReferenceChipInput(item: UserQuoteItemData): ConversationReferenceChipInput {
  const reference = fromUserQuoteItemWire(item);
  return { ...reference, label: reference.label ?? '', previewText: reference.text };
}

/** 历史展示优先使用生产方给出的业务 label；缺失时退回正文预览。 */
export function buildUserMessageQuoteDisplay(
  item: UserQuoteItemData,
  readIcon: (reference: ConversationReferenceChipInput) => Component | null = () => null,
): UserMessageQuoteDisplay | undefined {
  const textPreview = buildConversationReferencePreview({
    text: item.text,
    previewText: item.text,
  });
  const displayText = item.label?.trim() || textPreview;

  return displayText ? { item, displayText, icon: readIcon(toConversationReferenceChipInput(item)) } : undefined;
}
