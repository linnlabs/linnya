import type Database from 'better-sqlite3';
import { listDocumentTypeBackendHooks } from '@plugin/backend/documentTypeBackendHook';
import { adaptDocumentTypeBackendDatabase } from '../../../../app-hosts/linnya/plugin-registry/documentTypeBackendDatabaseAdapter';
import type { ProjectCharStats } from '../definitions/workspaceProjectStats';

export function readWorkspaceProjectCharStats(params: {
  readonly db: Database.Database;
  readonly projectId: string;
}): ProjectCharStats {
  const markdownRow = params.db.prepare(`
    SELECT COALESCE(SUM(v.char_count), 0) AS total
    FROM document_versions v
    JOIN (
      SELECT node_id, MAX(version_number) AS max_ver
      FROM document_versions
      GROUP BY node_id
    ) latest
      ON latest.node_id = v.node_id AND latest.max_ver = v.version_number
    JOIN workspace_nodes wn ON wn.id = v.node_id
    WHERE
      wn.project_id = ?
      AND wn.deleted_at IS NULL
      AND wn.type = 'document'
  `).get(params.projectId) as { total: number } | undefined;

  // 中文说明：插件文档的 char_count 由插件定义，本 feature 只聚合稳定 hook。
  const hookDb = adaptDocumentTypeBackendDatabase(params.db);
  const pluginDocumentTotal = listDocumentTypeBackendHooks({ includeDisabled: true }).reduce(
    (total, hook) => total + (hook.readProjectCharCount?.({
      db: hookDb,
      projectId: params.projectId,
    }) ?? 0),
    0,
  );

  return {
    projectId: params.projectId,
    charCount: Number(markdownRow?.total ?? 0) + Number(pluginDocumentTotal),
  };
}
