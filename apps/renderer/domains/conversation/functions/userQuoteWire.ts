import {
  UserQuoteSchema,
  type UserQuoteData,
} from '@app/schemas';
import type { RendererAiInvocationUserQuote } from '@plugin/renderer/aiInvocationPort';

export function toUserQuoteWire(userQuote: RendererAiInvocationUserQuote): UserQuoteData {
  return UserQuoteSchema.parse({
    items: userQuote.items.map(item => ({
      quote_id: item.id,
      plugin_id: item.pluginId,
      kind: item.kind,
      ...(item.uri !== undefined ? { uri: item.uri } : {}),
      text: item.text,
      ...(item.label !== undefined ? { label: item.label } : {}),
      ...(item.source !== undefined ? { source: item.source } : {}),
      ...(item.metadata !== undefined ? { metadata: item.metadata } : {}),
    })),
  });
}

export function fromUserQuoteWire(value: UserQuoteData | undefined): RendererAiInvocationUserQuote | undefined {
  if (!value) return undefined;
  return {
    items: value.items.map(item => ({
      id: item.quote_id,
      pluginId: item.plugin_id,
      kind: item.kind,
      ...(item.uri !== undefined ? { uri: item.uri } : {}),
      text: item.text,
      ...(item.label !== undefined ? { label: item.label } : {}),
      ...(item.source !== undefined ? { source: item.source } : {}),
      ...(item.metadata !== undefined ? { metadata: item.metadata } : {}),
    })),
  };
}

export function buildUserQuoteMessageMetadata(
  userQuote: RendererAiInvocationUserQuote | undefined,
): { readonly user_quote: UserQuoteData } | undefined {
  return userQuote ? { user_quote: toUserQuoteWire(userQuote) } : undefined;
}
