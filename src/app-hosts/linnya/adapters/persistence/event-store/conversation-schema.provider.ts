/**
 * @file src/app-hosts/linnya/adapters/persistence/event-store/conversation-schema.provider.ts
 * @description Linnya backend conversation event-store 的 schema provider。
 */

import { ISchemaProvider } from '../../../../../shared/database/schema-provider';
import { CONVERSATION_SCHEMAS } from './conversation.schema';

export class ConversationSchemaProvider implements ISchemaProvider {
  readonly name = 'conversations';

  getSchema(): string[] {
    return CONVERSATION_SCHEMAS;
  }
}
