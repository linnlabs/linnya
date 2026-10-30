import { z } from 'zod';

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
