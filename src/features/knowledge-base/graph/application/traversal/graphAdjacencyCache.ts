/**
 * @file graphAdjacencyCache.ts
 *
 * @description
 * 多跳（Multi-hop）读路径的邻接查询缓存（TTL）。
 *
 * 背景：
 * - 多跳扩展会重复查询 (kbId, entityId) 的邻接边；
 * - SQLite 查询本身不算慢，但在 full 模式下会出现大量重复调用（尤其是相近 query 连续触发）；
 * - 因此提供一个轻量 TTL cache：
 *   - 只缓存 “SQLite 邻接结果”（不是最终检索结果）；
 *   - key = `${kbId}|${entityId}|${direction}|${limit}`；
 *   - 默认 TTL 10 分钟（可按需调整）。
 *
 * 约束：
 * - 不使用 any
 * - 不做“无限缓存”：有 maxEntries 上限，超限时按插入顺序淘汰
 */

import type { KnowledgeGraphEdgeRecord } from '../../infrastructure/knowledgeGraphRepository';

export type GraphAdjacencyDirection = 'out' | 'in' | 'both';

type CacheEntry = {
  expiresAtMs: number;
  value: KnowledgeGraphEdgeRecord[];
};

export class GraphAdjacencyCache {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly map = new Map<string, CacheEntry>();

  constructor(args?: { ttlMs?: number; maxEntries?: number }) {
    this.ttlMs = args?.ttlMs ?? 10 * 60 * 1000;
    this.maxEntries = args?.maxEntries ?? 2000;
  }

  private buildKey(kbId: string, entityId: string, direction: GraphAdjacencyDirection, limit: number): string {
    return `${kbId}|${entityId}|${direction}|${limit}`;
  }

  private evictIfNeeded(): void {
    if (this.map.size <= this.maxEntries) return;
    // Map 迭代顺序 = 插入顺序；超限时从最旧开始删
    const over = this.map.size - this.maxEntries;
    let removed = 0;
    for (const key of this.map.keys()) {
      this.map.delete(key);
      removed += 1;
      if (removed >= over) break;
    }
  }

  get(kbId: string, entityId: string, direction: GraphAdjacencyDirection, limit: number): KnowledgeGraphEdgeRecord[] | null {
    const key = this.buildKey(kbId, entityId, direction, limit);
    const hit = this.map.get(key);
    if (!hit) return null;
    if (Date.now() >= hit.expiresAtMs) {
      this.map.delete(key);
      return null;
    }
    return hit.value;
  }

  set(kbId: string, entityId: string, direction: GraphAdjacencyDirection, limit: number, value: KnowledgeGraphEdgeRecord[]): void {
    const key = this.buildKey(kbId, entityId, direction, limit);
    this.map.set(key, { expiresAtMs: Date.now() + this.ttlMs, value });
    this.evictIfNeeded();
  }
}

/**
 * 进程级单例（供 DefaultSearchService 每次 new GraphMultiHopService 时复用）。
 */
export const globalGraphAdjacencyCache = new GraphAdjacencyCache();

