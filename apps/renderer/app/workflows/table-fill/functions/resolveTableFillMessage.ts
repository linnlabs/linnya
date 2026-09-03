import type { MessageParams } from '@app/localization';
import { TABLE_FILL_MESSAGE_FALLBACKS } from '../definitions/tableFillMessageCatalog';
import type {
  TableFillMessageKey,
  TableFillMessageResolver,
} from '../definitions/tableFillMessages';

export type TableFillRawMessageResolver = (
  key: string,
  fallback: string,
  params?: MessageParams,
) => string;

export function resolveTableFillMessage(
  key: TableFillMessageKey,
  resolveMessage: TableFillRawMessageResolver,
  params?: MessageParams,
): string {
  return resolveMessage(key, TABLE_FILL_MESSAGE_FALLBACKS[key], params);
}

export function createTableFillMessageResolver(
  resolveMessage: TableFillRawMessageResolver,
): TableFillMessageResolver {
  return (key, params) => resolveTableFillMessage(key, resolveMessage, params);
}
