/**
 * @file src/features/knowledge-base/infrastructure/qdrant-repository/filters.ts
 *
 * @brief 搜索/删除通用过滤器构建（领域过滤器 -> Qdrant filter）
 */

import type { SearchFilterOptions } from '../qdrantRepository';

type QdrantFilter = {
  must: QdrantFieldCondition[];
};

type QdrantFieldCondition = {
  key: string;
  match?: { any: string[] } | { value: string } | { any: string[] | number[] } | { value: string | number | boolean };
  range?: { gte?: number; lte?: number };
};

/**
 * 功能：将领域层过滤条件转换为 Qdrant 原生 filter 结构。
 *
 * 设计说明：
 * - 返回值为 `undefined` 表示无需过滤
 * - 只负责结构转换，不做“容错猜测”
 */
export function buildQdrantFilter(filterOptions?: SearchFilterOptions): QdrantFilter | undefined {
  if (!filterOptions) return undefined;

  const must: QdrantFieldCondition[] = [];

  if (filterOptions.docIds && filterOptions.docIds.length > 0) {
    must.push({
      key: 'doc_id',
      match: { any: filterOptions.docIds }
    });
  }

  if (filterOptions.blockTypes && filterOptions.blockTypes.length > 0) {
    must.push({
      key: 'block_type',
      match: { any: filterOptions.blockTypes }
    });
  }

  if (filterOptions.pageRange) {
    if (filterOptions.pageRange.min !== undefined) {
      must.push({
        key: 'page_number',
        range: { gte: filterOptions.pageRange.min }
      });
    }
    if (filterOptions.pageRange.max !== undefined) {
      must.push({
        key: 'page_number',
        range: { lte: filterOptions.pageRange.max }
      });
    }
  }

  if (filterOptions.metadataMatch) {
    const metadata = filterOptions.metadataMatch;
    for (const [k, cond] of Object.entries(metadata)) {
      const key = typeof k === 'string' ? k.trim() : '';
      if (key.length === 0) continue;

      const qdrantKey = `metadata.${key}`;
      if ('value' in cond) {
        const v = cond.value;
        if (
          typeof v === 'string' ||
          (typeof v === 'number' && Number.isFinite(v)) ||
          typeof v === 'boolean'
        ) {
          must.push({ key: qdrantKey, match: { value: v } });
        }
      } else if ('any' in cond) {
        const anyList = cond.any;
        if (!Array.isArray(anyList) || anyList.length === 0) continue;
        const normalized: Array<string | number> = [];
        for (const item of anyList) {
          if (typeof item === 'string' && item.trim().length > 0) normalized.push(item);
          else if (typeof item === 'number' && Number.isFinite(item)) normalized.push(item);
        }
        if (normalized.length > 0) {
          must.push({ key: qdrantKey, match: { any: normalized } });
        }
      }
    }
  }

  if (must.length === 0) return undefined;

  const filter: QdrantFilter = { must };
  return filter;
}


