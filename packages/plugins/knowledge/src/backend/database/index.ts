import type { PluginMigrationDefinition } from '@plugin/backend/pluginMigration';
import { initialKnowledgeSchema } from './migrations/initialKnowledgeSchema';

export const knowledgePluginMigrations: readonly PluginMigrationDefinition[] = [initialKnowledgeSchema];
