import { z } from 'zod';
interface ReadDatabase { prepare(sql: string): unknown }
interface ReadStatement { all(...values: readonly unknown[]): unknown[] }
function isReadStatement(value: unknown): value is ReadStatement { return typeof value === 'object' && value !== null && 'all' in value && typeof value.all === 'function'; }
/** 与真实删除共用活动子树；未展开的后代与重叠选择都由数据库事实决定。 */
export function readActiveWorkspaceSubtreeNodeIds(db: ReadDatabase, nodeIds: readonly string[]): string[] {
  if (!nodeIds.length) return [];
  const statement = db.prepare(`WITH RECURSIVE subtree(id) AS (
    SELECT id FROM workspace_nodes WHERE id IN (SELECT value FROM json_each(?)) AND deleted_at IS NULL
    UNION
    SELECT child.id FROM workspace_nodes child JOIN subtree parent ON child.parent_id = parent.id WHERE child.deleted_at IS NULL
  ) SELECT id FROM subtree`);
  if (!isReadStatement(statement)) throw new Error('Workspace subtree requires readable SQLite statements.');
  return z.array(z.object({ id: z.string() })).parse(statement.all(JSON.stringify(nodeIds))).map(row => row.id);
}
