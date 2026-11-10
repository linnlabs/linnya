import type Database from 'better-sqlite3';

import type { SemanticTagDefinition } from '../../../definitions/semanticLayer';
import { compileSemanticQuery, type SemanticQueryDefinitions } from '../functions/compileSemanticQuery';
import type { SemanticQuery, SemanticQueryGroup, SemanticQueryResult, SemanticQueryRow } from '../definitions/semanticQuery';

const folded = new WeakSet<Database.Database>();

/** 与名称唯一性同一规则的折叠函数：NFKC 后大小写折叠。SQLite 的 lower() 只折叠 ASCII。 */
export function registerSemanticFold(db: Database.Database): void {
  if (folded.has(db)) return;
  db.function('semantic_fold', { deterministic: true }, (value: unknown) =>
    typeof value === 'string' ? value.normalize('NFKC').toLowerCase() : value);
  folded.add(db);
}

interface Row {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly created_at: number;
  readonly updated_at: number;
  readonly revision: number;
  readonly property_values: string | null;
  readonly tag_ids: string;
}

function visibleValues(tagIds: readonly string[], raw: string | null, tags: readonly SemanticTagDefinition[]) {
  const all = raw ? JSON.parse(raw) as Record<string, unknown> : {};
  const fields = new Set(tags.filter(tag => tagIds.includes(tag.id)).flatMap(tag => tag.fields.map(field => field.propertyId)));
  return Object.fromEntries(Object.entries(all).filter(([id]) => fields.has(id)));
}

/** 只读执行：语句经 better-sqlite3 确认是只读的才运行。 */
function readonly<T>(db: Database.Database, sql: string) {
  const statement = db.prepare<unknown[], T>(sql);
  if (!statement.readonly) throw new Error('语义查询只允许只读语句');
  return statement;
}

export function runSemanticQuery(
  db: Database.Database,
  query: SemanticQuery,
  definitions: SemanticQueryDefinitions
): SemanticQueryResult {
  registerSemanticFold(db);
  const compiled = compileSemanticQuery(query, definitions);
  const rows = readonly<Row>(db, `
    SELECT node.id, node.name, node.type, node.created_at, node.updated_at,
      COALESCE(value.revision, 0) AS revision, json(value.property_values) AS property_values,
      (SELECT json_group_array(tag_id) FROM (
        SELECT object_tag.tag_id FROM semantic_object_tags object_tag
        JOIN semantic_tags tag ON tag.id = object_tag.tag_id AND tag.deleted_at IS NULL
        WHERE object_tag.object_kind = 'document' AND object_tag.object_id = node.id
        ORDER BY object_tag.created_at, object_tag.tag_id
      )) AS tag_ids
    ${compiled.from}
    ORDER BY ${compiled.orderBy}
    LIMIT ?
  `).all(...compiled.params, ...compiled.orderParams, compiled.limit);
  const total = readonly<{ total: number }>(db, `SELECT COUNT(*) AS total ${compiled.from}`).get(...compiled.params)?.total ?? 0;

  let groups: SemanticQueryGroup[] | undefined;
  if (compiled.group) {
    const { group } = compiled;
    const keyed = group.kind === 'multi'
      ? `SELECT CASE WHEN chosen.value IS NULL THEN NULL ELSE chosen.value END AS group_key
          FROM (SELECT ${group.select} AS raw ${compiled.from}) grouped
          LEFT JOIN json_each(grouped.raw) chosen`
      : `SELECT ${group.select} AS group_key ${compiled.from}`;
    groups = readonly<{ group_key: string | number | null; count: number }>(db, `
      SELECT group_key, COUNT(*) AS count FROM (${keyed}) GROUP BY group_key ORDER BY count DESC, group_key
    `).all(...group.params, ...compiled.params).map(row => ({
      key: group.kind === 'checkbox' && row.group_key !== null ? row.group_key === 1 : row.group_key === null ? null : String(row.group_key),
      count: row.count,
    }));
  }

  return {
    rows: rows.map((row): SemanticQueryRow => {
      const tagIds = JSON.parse(row.tag_ids) as string[];
      return {
        documentId: row.id, name: row.name, nodeType: row.type,
        createdAt: row.created_at, updatedAt: row.updated_at, revision: row.revision,
        tagIds, values: visibleValues(tagIds, row.property_values, definitions.tags),
      };
    }),
    total,
    truncated: total > rows.length,
    ...(groups ? { groups } : {}),
  };
}
