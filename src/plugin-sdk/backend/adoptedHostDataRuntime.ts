import type { AdoptedHostData } from '@linnya/plugin-host-contract/backend/adoptedHostDataRuntime';
import { getDatabaseService } from 'src/electron-main/services/database';
import { pathManager } from 'src/shared/utils/pathManager';
import { assertKnowledgeResourceAdmission } from 'src/app-hosts/linnya/plugin-registry/knowledgeResourceAdmission';

export type * from '@linnya/plugin-host-contract/backend/adoptedHostDataRuntime';

/** 接管的是知识库原有的表与资料目录，所以准入与数据目录都按知识库装配。 */
export function getAdoptedHostData(pluginId: string): AdoptedHostData {
  assertKnowledgeResourceAdmission(pluginId);
  const db = getDatabaseService().getDb();
  return {
    database: { prepare: sql => db.prepare(sql), transaction: operation => db.transaction(operation) },
    dataDirectory: pathManager.getKbDataPath(),
  };
}
