import { findSimilarSemanticNames } from '../../functions/findSimilarSemanticNames';
import { semanticNameKey } from '../../functions/normalizeSemanticName';

/** 只读标签投影的最小数据库形状：插件经 Host 端口传入自己的连接（含独立 CLI 的只读连接）。 */
interface SemanticTagReader {
  prepare(sql: string): unknown;
}
interface ReadStatement {
  all(...parameters: readonly unknown[]): unknown[];
  get(...parameters: readonly unknown[]): unknown;
}
function isReadStatement(value: unknown): value is ReadStatement {
  return (
    typeof value === 'object' && value !== null &&
    'all' in value && typeof value.all === 'function' &&
    'get' in value && typeof value.get === 'function'
  );
}
function read(db: SemanticTagReader, sql: string): ReadStatement {
  const statement = db.prepare(sql);
  if (!isReadStatement(statement)) throw new Error('Semantic tag projection requires a read statement');
  return statement;
}

/** 插件可见的标签身份：稳定 ID 与当前名称。 */
export interface SemanticTagName {
  readonly id: string;
  readonly name: string;
}

interface TagRow {
  readonly id: string;
  readonly name: string;
  readonly deleted_at: number | null;
}

const MERGE_HOPS = 8;

function isTagRow(value: unknown): value is TagRow {
  return typeof value === 'object' && value !== null && 'id' in value && 'name' in value;
}

function rows(db: SemanticTagReader, sql: string, ...parameters: unknown[]): TagRow[] {
  return read(db, sql).all(...parameters).filter(isTagRow);
}

/** 现有标签，按新建先后。 */
export function listSemanticTagNames(db: SemanticTagReader): readonly SemanticTagName[] {
  return rows(db, 'SELECT id, name, deleted_at FROM semantic_tags WHERE deleted_at IS NULL ORDER BY created_at, id')
    .map(row => ({ id: row.id, name: row.name }));
}

function mergedInto(db: SemanticTagReader, id: string): string | null {
  const row = read(
    db,
    `SELECT json_extract(undo_json, '$.targetId') AS target FROM semantic_schema_changes
      WHERE kind = 'merge_tags' AND undone_at IS NULL AND json_extract(undo_json, '$.sourceId') = ?
      ORDER BY created_at DESC LIMIT 1`
  ).get(id);
  return typeof row === 'object' && row !== null && 'target' in row && typeof row.target === 'string'
    ? row.target
    : null;
}

/**
 * 按 ID 读当前标签。已合并的标签跟到合并目标（可连续合并），已删除的不返回；
 * 结果以调用方给的 ID 为键，值是当前身份，多个旧 ID 可指向同一个标签。
 */
export function readSemanticTagNames(
  db: SemanticTagReader,
  ids: readonly string[]
): ReadonlyMap<string, SemanticTagName> {
  const result = new Map<string, SemanticTagName>();
  if (!ids.length) return result;
  const lookup = read(db, 'SELECT id, name, deleted_at FROM semantic_tags WHERE id = ?');
  for (const id of new Set(ids)) {
    let current: string | null = id;
    for (let hop = 0; current && hop <= MERGE_HOPS; hop++) {
      const row = lookup.get(current);
      if (!isTagRow(row)) break;
      if (row.deleted_at === null) {
        result.set(id, { id: row.id, name: row.name });
        break;
      }
      current = mergedInto(db, row.id);
    }
  }
  return result;
}

/** 名称解析结果：找到的按输入原样为键；找不到的给出名称相近的现有标签。 */
export interface SemanticTagResolution {
  readonly found: ReadonlyMap<string, SemanticTagName>;
  readonly missing: readonly { readonly name: string; readonly similar: readonly string[] }[];
}

function nameKey(name: string): string | null {
  try {
    return semanticNameKey(name);
  } catch {
    return null;
  }
}

/** 按 ID 或名称（与语义层同一套归一化：NFKC、合并空白、大小写折叠）解析现有标签，不新建。 */
export function resolveSemanticTagNames(
  db: SemanticTagReader,
  inputs: readonly string[]
): SemanticTagResolution {
  const all = listSemanticTagNames(db);
  const byKey = new Map(all.map(tag => [semanticNameKey(tag.name), tag]));
  const found = new Map<string, SemanticTagName>();
  const missing: { name: string; similar: string[] }[] = [];
  for (const input of new Set(inputs)) {
    const key = nameKey(input);
    const tag = all.find(candidate => candidate.id === input) ?? (key ? byKey.get(key) : undefined);
    if (tag) found.set(input, tag);
    else
      missing.push({
        name: input,
        similar: key ? findSimilarSemanticNames(input, all).map(candidate => candidate.name) : [],
      });
  }
  return { found, missing };
}
