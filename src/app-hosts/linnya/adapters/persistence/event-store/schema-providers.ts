/**
 * @file src/app-hosts/linnya/adapters/persistence/event-store/schema-providers.ts
 * @description Linnya backend conversation event-store 的 schema provider 聚合入口。
 */

import type { ISchemaProvider } from '../../../../../shared/database/schema-provider';
import { ConversationSchemaProvider } from './conversation-schema.provider';

export function getConversationSchemaProviders(): ISchemaProvider[] {
  return [new ConversationSchemaProvider()];
}
