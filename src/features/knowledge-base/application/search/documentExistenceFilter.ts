/**
 * @file src/features/knowledge-base/application/search/documentExistenceFilter.ts
 *
 * @brief DocumentExistenceFilter：以元数据为权威，过滤“向量库有但元数据不存在”的孤儿结果（高内聚）。
 *
 * 背景：
 * - 搜索结果由 Qdrant 返回（payload.doc_id）
 * - 浏览/列表由 metadataRepository 返回（kb_documents）
 * - 若删除链路或历史数据导致两者不一致，search 会产出无法浏览的 doc_id
 *
 * 这里以元数据为 SoT，仅保留仍存在于 kb_documents 的 doc_id。
 */

import { logger } from '@shared/index';
import type { MetadataRepository } from '../../infrastructure/metadataRepository';
import type { RankedRetrievedPoint } from './types';

export class DocumentExistenceFilter {
  private readonly metadataRepository: MetadataRepository;

  constructor(args: { metadataRepository: MetadataRepository }) {
    this.metadataRepository = args.metadataRepository;
  }

  async filterResultsByExistingDocuments(results: RankedRetrievedPoint[]): Promise<RankedRetrievedPoint[]> {
    const docIds = Array.from(
      new Set(
        results
          .map((r) => r.payload?.doc_id)
          .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      )
    );

    if (docIds.length === 0) return [];

    const existence = await Promise.all(
      docIds.map(async (docId) => {
        const doc = await this.metadataRepository.getDocumentById(docId);
        return { docId, exists: !!doc };
      })
    );

    const existing = new Set(existence.filter((x) => x.exists).map((x) => x.docId));
    const filtered = results.filter((r) => existing.has(r.payload?.doc_id));

    const dropped = results.length - filtered.length;
    if (dropped > 0) {
      logger.warn(`[SearchService] 过滤孤儿搜索结果: dropped=${dropped}, kept=${filtered.length}`);
    }

    return filtered;
  }
}

