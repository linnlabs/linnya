import type { ConversationReferenceInput } from '@linnya/plugin-host-contract/renderer';
import { ConversationReferenceIdSchema, type ConversationReferenceId } from '@app/schemas';
import type { ConversationReference } from '../types';
import type { UserMessageContent } from '../definitions/userMessageContent';

export type ConversationReferenceUserQuotePayload = NonNullable<UserMessageContent['userQuote']>;

const PREVIEW_EDGE_LENGTH = 4;

export function createConversationReference(
  payload: ConversationReferenceInput,
  id: ConversationReferenceId,
): ConversationReference {
  // 引用身份必须由调用方显式声明。此前对缺失 owner/kind 静默套用 platform/text-selection
  // 默认值，会让 JS 调用方或忘记回填的 provider 悄悄伪装成平台引用，既可能展示错误 chip，
  // 也会逃过停用时按 pluginId 清草稿。故在唯一构造入口处硬性校验，不再兜底。
  if (!payload.pluginId) {
    throw new Error('[conversationReferences] 引用必须显式声明 pluginId，不继承平台默认身份');
  }
  if (!payload.kind) {
    throw new Error('[conversationReferences] 引用必须显式声明 kind，不继承平台默认身份');
  }

  const previewText = payload.previewText ?? payload.text;
  const label = payload.label ?? buildConversationReferencePreview({
    text: payload.text,
    previewText,
  });

  return {
    id: ConversationReferenceIdSchema.parse(id),
    pluginId: payload.pluginId,
    kind: payload.kind,
    ...(payload.uri ? { uri: payload.uri } : {}),
    label,
    text: payload.text,
    previewText,
    source: payload.source ?? {},
    ...(payload.metadata ? { metadata: payload.metadata } : {}),
  };
}

export function buildConversationReferencePreview(reference: Pick<ConversationReference, 'text' | 'previewText'>): string {
  const baseText = reference.previewText.trim() || reference.text;
  const trimmed = baseText.trim();
  if (!trimmed) return '';

  if (trimmed.length <= PREVIEW_EDGE_LENGTH * 2) {
    return trimmed;
  }

  const head = trimmed.slice(0, PREVIEW_EDGE_LENGTH);
  const tail = trimmed.slice(-PREVIEW_EDGE_LENGTH);
  return `${head}...${tail}`;
}

/** 将 composer 内逐条引用无损转换为 renderer 运行态 userQuote。 */
export function buildUserQuotePayloadFromConversationReferences(
  references: readonly ConversationReference[],
): ConversationReferenceUserQuotePayload | undefined {
  if (references.length === 0) return undefined;

  return {
    items: references.map(reference => ({
      id: reference.id,
      pluginId: reference.pluginId,
      kind: reference.kind,
      ...(reference.uri !== undefined ? { uri: reference.uri } : {}),
      text: reference.text,
      label: reference.label,
      ...(reference.source !== undefined ? { source: reference.source } : {}),
      ...(reference.metadata !== undefined ? { metadata: reference.metadata } : {}),
    })),
  };
}
