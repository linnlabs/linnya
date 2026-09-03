import type Database from 'better-sqlite3';
import { listDocumentTypeBackendHooks } from '@plugin/backend/documentTypeBackendHook';
import type { RecentDocumentInfo } from '../definitions/workspaceDocumentActivity';

function getWorkspaceDocumentNodeTypes(): string[] {
  return Array.from(new Set([
    'document',
    ...listDocumentTypeBackendHooks({ includeDisabled: true }).map((hook) => hook.docType),
  ]));
}

function buildSqlPlaceholders(values: readonly unknown[]): string {
  return values.map(() => '?').join(', ');
}

export function listRecentWorkspaceDocuments(params: {
  readonly db: Database.Database;
  readonly limit: number;
  readonly projectId?: string | null;
}): RecentDocumentInfo[] {
  const documentTypes = getWorkspaceDocumentNodeTypes();
  const placeholders = buildSqlPlaceholders(documentTypes);
  const projectPredicate = typeof params.projectId === 'string' && params.projectId.length > 0
    ? 'AND wn.project_id = ?'
    : '';
  const queryParams = projectPredicate
    ? [...documentTypes, params.projectId, params.limit]
    : [...documentTypes, params.limit];

  return params.db.prepare(`
    SELECT
      wn.id, wn.name, wn.project_id, wn.parent_id,
      p.name AS project_name,
      wn.last_opened_at, wn.updated_at, wn.access_count, wn.type
    FROM workspace_nodes wn
    LEFT JOIN projects p ON wn.project_id = p.id
    WHERE
      wn.type IN (${placeholders})
      AND wn.deleted_at IS NULL
      ${projectPredicate}
    ORDER BY COALESCE(wn.last_opened_at, wn.created_at) DESC, wn.updated_at DESC
    LIMIT ?
  `).all(...queryParams) as RecentDocumentInfo[];
}

export function notifyWorkspaceDocumentOpened(params: {
  readonly db: Database.Database;
  readonly nodeId: string;
}): void {
  const documentTypes = getWorkspaceDocumentNodeTypes();
  const placeholders = buildSqlPlaceholders(documentTypes);
  const now = Date.now();
  const result = params.db.prepare(`
    UPDATE workspace_nodes
    SET
      last_opened_at = ?,
      access_count = COALESCE(access_count, 0) + 1,
      updated_at = ?
    WHERE id = ? AND deleted_at IS NULL AND type IN (${placeholders})
  `).run(now, now, params.nodeId, ...documentTypes);

  if (result.changes === 0) {
    console.warn(
      `[workspace-document-activity] Node ${params.nodeId} not found, not a document, or already deleted.`,
    );
  }
}
