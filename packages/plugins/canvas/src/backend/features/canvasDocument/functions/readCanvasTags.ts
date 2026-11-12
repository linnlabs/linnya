import {
  listSemanticTagNames,
  readSemanticTagNames,
  resolveSemanticTagNames,
} from '@plugin/backend/semanticTags';
import {
  CanvasTagsRequestSchema,
  listCanvasTagIds,
  type CanvasElement,
  type CanvasTagNames,
  type CanvasTagsResult,
} from '../../../../shared';
import type { CanvasDatabase } from '../../../definitions/canvasDatabase';
import { CanvasDocumentFailure } from '../definitions/canvasDocumentFailure';

/** 卡片上存的标签 ID 换成当前工作区标签；合并的跟到目标，删除的不出现。 */
export function readCanvasTagNames(
  database: Pick<CanvasDatabase, 'prepare'>,
  elements: readonly CanvasElement[]
): CanvasTagNames {
  const ids = listCanvasTagIds(elements);
  return ids.length ? readSemanticTagNames(database, ids) : new Map();
}

/** find 的标签、状态筛选从工作区标签名换成 ID；其他查询原样返回。 */
export function resolveCanvasQueryTags<
  T extends { readonly kind: string; readonly tag?: string; readonly status?: string },
>(database: Pick<CanvasDatabase, 'prepare'>, query: T): T {
  if (query.kind !== 'find' || (!query.tag && !query.status)) return query;
  return {
    ...query,
    ...(query.tag ? { tag: resolveCanvasTagFilter(database, query.tag) } : {}),
    ...(query.status ? { status: resolveCanvasTagFilter(database, query.status) } : {}),
  };
}

/** 界面用：工作区现有标签（供挑选）与卡片上存的 ID 对应的当前标签。 */
export function readCanvasTagCatalog(
  database: Pick<CanvasDatabase, 'prepare'>,
  payload: unknown
): CanvasTagsResult {
  const { ids } = CanvasTagsRequestSchema.parse(payload);
  return {
    tags: [...listSemanticTagNames(database)],
    resolved: Object.fromEntries(ids.length ? readSemanticTagNames(database, ids) : []),
  };
}

/** 查询用的标签名换成标签 ID；没有这个标签时说明并给出相近的已有标签。 */
export function resolveCanvasTagFilter(
  database: Pick<CanvasDatabase, 'prepare'>,
  name: string
): string {
  const { found, missing } = resolveSemanticTagNames(database, [name]);
  const tag = found.get(name);
  if (tag) return tag.id;
  const similar = missing[0]?.similar ?? [];
  throw new CanvasDocumentFailure(
    'tag_unavailable',
    `没有标签“${name}”${similar.length ? `；相近的有：${similar.join('、')}` : ''}。`
  );
}
