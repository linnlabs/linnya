import { SHARED_COMPONENT_MESSAGE_FALLBACKS } from '../definitions/sharedComponentMessageCatalog';
import type {
  SharedComponentMessageKey,
  SharedComponentMessageParams,
  SharedComponentMessageResolver,
} from '../definitions/sharedComponentMessages';

export type SharedComponentRawMessageResolver = (
  key: string,
  fallback: string,
  params?: SharedComponentMessageParams,
) => string;

export function resolveSharedComponentMessage(
  key: SharedComponentMessageKey,
  resolveMessage: SharedComponentRawMessageResolver,
  params?: SharedComponentMessageParams,
): string {
  return resolveMessage(key, SHARED_COMPONENT_MESSAGE_FALLBACKS[key], params);
}

export function createSharedComponentMessageResolver(
  resolveMessage: SharedComponentRawMessageResolver,
): SharedComponentMessageResolver {
  return (key, params) => resolveSharedComponentMessage(key, resolveMessage, params);
}
