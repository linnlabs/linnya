import type { PluginStorage } from '@linnya/plugin-host-contract/backend/storageRuntime';
import { getDatabaseService } from 'src/electron-main/services/database';
import { pathManager } from 'src/shared/utils/pathManager';
import { assertKnowledgeResourceAdmission } from 'src/app-hosts/linnya/plugin-registry/knowledgeResourceAdmission';

export type * from '@linnya/plugin-host-contract/backend/storageRuntime';

export function getPluginStorage(pluginId: string): PluginStorage {
  assertKnowledgeResourceAdmission(pluginId);
  const db = getDatabaseService().getDb();
  return {
    database: { prepare: sql => db.prepare(sql), transaction: operation => db.transaction(operation) },
    dataDirectory: pathManager.getKbDataPath(),
  };
}
