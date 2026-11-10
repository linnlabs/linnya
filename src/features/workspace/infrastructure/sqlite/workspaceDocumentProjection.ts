import * as z from 'zod';
import { readPersistedWorkspaceDocumentLocation, splitNormalizedVfsPath, type WorkspaceVfsStatement } from '../../vfs/projection';

interface WorkspaceProjectionDatabase {
  prepare(sql: string): unknown;
}
interface ReadStatement {
  get(...params: readonly unknown[]): unknown;
}
interface WriteStatement {
  run(...params: readonly unknown[]): unknown;
}
function isReadStatement(value: unknown): value is ReadStatement {
  return (
    typeof value === 'object' && value !== null && 'get' in value && typeof value.get === 'function'
  );
}
function isWriteStatement(value: unknown): value is WriteStatement {
  return (
    typeof value === 'object' && value !== null && 'run' in value && typeof value.run === 'function'
  );
}
function readStatement(db: WorkspaceProjectionDatabase, sql: string): ReadStatement {
  const statement = db.prepare(sql);
  if (!isReadStatement(statement))
    throw new Error('Workspace projection requires a read statement');
  return statement;
}
function writeStatement(db: WorkspaceProjectionDatabase, sql: string): WriteStatement {
  const statement = db.prepare(sql);
  if (!isWriteStatement(statement))
    throw new Error('Workspace projection requires a write statement');
  return statement;
}

const metadataSchema = z.object({ project_id: z.string().nullable() });
const identityListSchema = z.object({
  ids: z.string().transform(value => z.array(z.string()).parse(JSON.parse(value))),
});

/** 只提供节点身份/归属，不读取文档类型自己的正文表。 */
export function readWorkspaceDocumentMetadata(
  db: WorkspaceProjectionDatabase,
  nodeId: string
): { readonly projectId: string | null } | null {
  const row: unknown = readStatement(
    db,
    'SELECT project_id FROM workspace_nodes WHERE id = ? AND deleted_at IS NULL'
  ).get(nodeId);
  return row === undefined ? null : { projectId: metadataSchema.parse(row).project_id };
}

export function listWorkspaceDocumentIds(
  db: WorkspaceProjectionDatabase,
  input: { readonly projectId: string; readonly nodeType: string }
): readonly string[] {
  const row: unknown = readStatement(
    db,
    'SELECT json_group_array(id) AS ids FROM workspace_nodes WHERE project_id = ? AND type = ? AND deleted_at IS NULL'
  ).get(input.projectId, input.nodeType);
  return identityListSchema.parse(row).ids;
}

/** 与插件正文共享调用方事务；回滚必须同时撤销正文、VFS 快照和节点时间。 */
export function touchWorkspaceDocument(
  db: WorkspaceProjectionDatabase,
  nodeId: string,
  updatedAt: number
): void {
  const result = z
    .object({ changes: z.number() })
    .parse(
      writeStatement(
        db,
        'UPDATE workspace_nodes SET updated_at = ? WHERE id = ? AND deleted_at IS NULL'
      ).run(updatedAt, nodeId)
    );
  if (result.changes !== 1) throw new Error(`Workspace document not found: ${nodeId}`);
}

const identitySchema = z.object({ id: z.string(), project_id: z.string().nullable(), name: z.string(), type: z.string(), deleted_at: z.number().nullable() });

/** 引用生命周期需要区分软删除与越界；调用方不读取 Workspace 内部表。 */
export function readWorkspaceDocumentIdentity(db: WorkspaceProjectionDatabase, nodeId: string) {
  const row = readStatement(db, 'SELECT id, project_id, name, type, deleted_at FROM workspace_nodes WHERE id = ?').get(nodeId);
  if (row === undefined) return null;
  const node = identitySchema.parse(row);
  return { id: node.id, projectId: node.project_id, name: node.name, nodeType: node.type, deletedAt: node.deleted_at };
}

function isVfsStatement(value: unknown): value is WorkspaceVfsStatement {
  return typeof value === 'object' && value !== null && 'get' in value && typeof value.get === 'function'
    && 'all' in value && typeof value.all === 'function' && 'run' in value && typeof value.run === 'function';
}

export function readWorkspaceDocumentLocation(db: WorkspaceProjectionDatabase, nodeId: string) {
  return readPersistedWorkspaceDocumentLocation({ prepare(sql) {
    const statement = db.prepare(sql);
    if (!isVfsStatement(statement)) throw new Error('Workspace location requires a complete statement port');
    return statement;
  } }, nodeId);
}

const candidateRowsSchema = z.array(z.object({ id: z.string(), name: z.string(), type: z.string(), project_id: z.string() }));
export function searchWorkspaceDocumentIdentities(db: WorkspaceProjectionDatabase, input: { readonly projectId: string; readonly keyword: string; readonly limit: number }) {
  const statement: unknown = db.prepare(`SELECT id, name, type, project_id FROM workspace_nodes WHERE project_id = ? AND type != 'folder' AND deleted_at IS NULL AND name LIKE ? ESCAPE '!' ORDER BY COALESCE(last_opened_at, 0) DESC, updated_at DESC, name LIMIT ?`);
  if (typeof statement !== 'object' || statement === null || !('all' in statement) || typeof statement.all !== 'function') throw new Error('Workspace search requires a readable statement');
  const keyword = input.keyword.replace(/[!%_]/g, char => '!' + char);
  const rows: unknown = Reflect.apply(statement.all, statement, [input.projectId, '%' + keyword + '%', input.limit]);
  return candidateRowsSchema.parse(rows);
}

/** 只解析当前项目的正式持久节点；不把系统视图或文件系统路径接纳为引用目标。 */
export function resolveWorkspaceDocumentPath(db: WorkspaceProjectionDatabase, input: { readonly projectId: string; readonly path: string }) {
  if (!input.path.startsWith('workspace:/')) throw new Error('Workspace document reference requires a workspace:/ path');
  const segments = splitNormalizedVfsPath(input.path.slice('workspace:'.length));
  let parentId: string | null = null;
  for (const segment of segments) {
    const raw = readStatement(db, 'SELECT id FROM workspace_nodes WHERE project_id = ? AND parent_id IS ? AND name = ? AND deleted_at IS NULL').get(input.projectId, parentId, segment);
    if (raw === undefined) return null;
    parentId = z.object({ id: z.string() }).parse(raw).id;
  }
  if (!parentId || !readWorkspaceDocumentLocation(db, parentId)) return null;
  return readWorkspaceDocumentIdentity(db, parentId);
}
