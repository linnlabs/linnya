import type { ISchemaProvider } from '../../../../../shared/database/schema-provider';
import { ConversationFilesSchemaProvider } from './conversationFilesSchemaProvider';

export function getConversationFilesSchemaProviders(): ISchemaProvider[] {
  return [new ConversationFilesSchemaProvider()];
}
