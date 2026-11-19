import type { AdoptedHostData } from '@linnya/plugin-host-contract/backend/adoptedHostDataRuntime';
import { getDatabaseService } from 'src/electron-main/services/database';
import { assertKnowledgeResourceAdmission } from 'src/app-hosts/linnya/plugin-registry/knowledgeResourceAdmission';
import { resolveRegisteredPluginDataRoot } from 'src/app-hosts/linnya/plugin-registry/pluginDataRoot';

export type * from '@linnya/plugin-host-contract/backend/adoptedHostDataRuntime';

/** 数据根由 Host 按 manifest 与装配来源解析；SDK 不知道任何具体插件目录。 */
export function getAdoptedHostData(pluginId: string): AdoptedHostData {
  assertKnowledgeResourceAdmission(pluginId);
  const db = getDatabaseService().getDb();
  return {
    database: { prepare: sql => db.prepare(sql), transaction: operation => db.transaction(operation) },
    dataDirectory: resolveRegisteredPluginDataRoot(pluginId),
  };
}
