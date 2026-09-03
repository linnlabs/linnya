import type { ISchemaProvider } from '../../../../../shared/database/schema-provider';
import { CONVERSATION_DIRECTORY_CLEANUP_JOB_SCHEMA } from './conversationCleanupJob.schema';

export class ConversationFilesSchemaProvider implements ISchemaProvider {
  readonly name = 'conversation-files';

  getSchema(): string[] {
    return CONVERSATION_DIRECTORY_CLEANUP_JOB_SCHEMA;
  }
}
