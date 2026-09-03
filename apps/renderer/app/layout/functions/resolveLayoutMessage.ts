import type { MessageParams } from '@app/localization';
import { LAYOUT_MESSAGE_FALLBACKS } from '../definitions/layoutMessageCatalog';
import type { LayoutMessageKey, LayoutMessageResolver } from '../definitions/layoutMessages';

export type LayoutRawMessageResolver = (
  key: string,
  fallback: string,
  params?: MessageParams,
) => string;

export function resolveLayoutMessage(
  key: LayoutMessageKey,
  resolveMessage: LayoutRawMessageResolver,
  params?: MessageParams,
): string {
  return resolveMessage(key, LAYOUT_MESSAGE_FALLBACKS[key], params);
}

export function createLayoutMessageResolver(
  resolveMessage: LayoutRawMessageResolver,
): LayoutMessageResolver {
  return (key, params) => resolveLayoutMessage(key, resolveMessage, params);
}
