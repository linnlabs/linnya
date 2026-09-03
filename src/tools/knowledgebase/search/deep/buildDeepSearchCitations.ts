/**
 * @file src/tools/knowledgebase/search/deep/buildDeepSearchCitations.ts
 * @description deep_search 专用 citations 构建器
 *
 * 设计目标：
 * - 满足“AI 必须能引用它看到的一切”的硬约束：命中块 + 上下文扩充块 都必须进入 citations，并拥有 ref。
 * - 保持工具边界清晰：deep_search 的 citations 不再复用浅搜索的 buildCitationMetadataFromResults，
 *   因为浅搜索只关心命中片段，而 deep_search 会展示更长、更连贯的阅读材料。
 */

import type { KnowledgeSearchCitationMetadata, KnowledgeSearchCitation } from '@app/schemas';
import type { ToolContext } from '../../../types';
import type { DocumentSoT } from '../../../../features/knowledge-base/domain/block';
import type { KnowledgeSearchDocument } from '../types';
import type { CitationRefAllocatorPort } from '../../../../domains/citation';
import { createCitationSourceIdentity } from '../../../../domains/citation';

type KnowledgeSearchCitationDraft = Omit<KnowledgeSearchCitation, 'ref' | 'index'>;

function isPositiveInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && Number.isInteger(n) && n > 0;
}

function getPageNumberFromSoTBlock(block: unknown): number | undefined {
  if (typeof block !== 'object' || block === null) return undefined;
  const b = block as Record<string, unknown>;
  const sourceInfo = b['source_info'];
  if (typeof sourceInfo !== 'object' || sourceInfo === null) return undefined;
  const si = sourceInfo as Record<string, unknown>;

  // 新规范优先：page_num，其次兼容 page_number
  const pageNum = si['page_num'];
  if (isPositiveInt(pageNum)) return pageNum;
  const pageNumber = si['page_number'];
  if (isPositiveInt(pageNumber)) return pageNumber;
  return undefined;
}

function normalizeSnippet(text: string, maxChars: number): string {
  const normalized = text.replace(/\n{3,}/g, '\n\n').trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars).trim()}...`;
}

function buildBlockIdToIndexMap(sot: DocumentSoT): Map<string, number> {
  const map = new Map<string, number>();
  const root = Array.isArray(sot.structure?.root) ? sot.structure.root : [];
  for (let i = 0; i < root.length; i += 1) {
    const blockId = root[i];
    if (typeof blockId === 'string') map.set(blockId, i);
  }
  return map;
}

/**
 * 为 deep_search 构建 citations：
 * - 对每个 doc：从命中块出发，扩充前后文（±contextExpansionRange），得到“展示块集合”
 * - 为展示块集合生成 citations（包含 ref），并标注 isContext
 *
 * 注意：这里的 citations 顺序会影响 `index`（但 ref 与 index 无关）。
 */
export async function buildDeepSearchCitationMetadata(params: {
  query: string;
  documents: KnowledgeSearchDocument[];
  searchMode: 'global' | 'document';
  docName?: string;
  citationOffset: number;
  context: ToolContext;
  citationRefAllocator: CitationRefAllocatorPort;
  contextExpansionRange: number;
  /**
   * snippet 仅用于前端引用弹窗的列表预览，不应过长。
   * deep_search 的 observation 里会展示全文；citations.snippet 做短预览即可。
   */
  citationSnippetMaxChars?: number;
}): Promise<KnowledgeSearchCitationMetadata> {
  const {
    query,
    documents,
    searchMode,
    docName,
    citationOffset,
    context,
    citationRefAllocator,
    contextExpansionRange,
    citationSnippetMaxChars = 240,
  } = params;

  const service = context.knowledgeBaseService;
  if (!service) {
    throw new Error('[DeepSearchCitations] 缺少 context.knowledgeBaseService');
  }

  // 1) 保持 doc 出现顺序（通常是相关度顺序）
  const docOrder: string[] = [];
  const hitsByDoc = new Map<string, KnowledgeSearchDocument[]>();
  for (const d of documents) {
    if (!hitsByDoc.has(d.doc_id)) {
      hitsByDoc.set(d.doc_id, []);
      docOrder.push(d.doc_id);
    }
    hitsByDoc.get(d.doc_id)?.push(d);
  }

  // 2) 先收集稳定来源事实，再交给 Conversation allocator 一次性占位。
  const drafts: KnowledgeSearchCitationDraft[] = [];
  const emittedKeys = new Set<string>(); // docId:blockId 去重（跨多个命中扩充可能重叠）

  for (const docId of docOrder) {
    const docHits = hitsByDoc.get(docId) ?? [];
    if (docHits.length === 0) continue;

    // 文档标题：优先用 docHits 的 doc_name（由 judge 回填 filename），其次用 docId
    const docTitle = docHits[0]?.doc_name || docId;

    const sot = await service.getRawSoTDocument(docId);
    if (!sot) {
      throw new Error(`[DeepSearchCitations] SoT 不存在：doc_id="${docId}"`);
    }
    const root = Array.isArray(sot.structure?.root) ? sot.structure.root : [];
    const contentBlocks = sot.content_blocks ?? {};
    const blockIdToIndex = buildBlockIdToIndexMap(sot);

    // 命中索引集合
    const hitIndices = new Set<number>();
    for (const hit of docHits) {
      const idx = blockIdToIndex.get(hit.block_id);
      if (idx !== undefined) hitIndices.add(idx);
    }

    // 展示索引集合（命中 + 上下文扩充）
    const indicesToShow = new Set<number>();
    for (const idx of hitIndices) {
      for (let i = idx - contextExpansionRange; i <= idx + contextExpansionRange; i += 1) {
        if (i >= 0 && i < root.length) indicesToShow.add(i);
      }
    }

    const sortedIndices = Array.from(indicesToShow).sort((a, b) => a - b);
    for (const idx of sortedIndices) {
      const blockId = root[idx];
      if (typeof blockId !== 'string') continue;

      const key = createCitationSourceIdentity({
        sourceType: 'knowledge_base',
        docId,
        blockId,
      });
      if (emittedKeys.has(key)) continue;
      emittedKeys.add(key);

      const block = contentBlocks[blockId];
      if (!block || typeof block.text !== 'string') continue;

      const isContext = !hitIndices.has(idx);
      const pageNumber = getPageNumberFromSoTBlock(block);

      drafts.push({
        sourceType: 'knowledge_base',
        docId,
        blockId,
        docTitle,
        pageNumber,
        snippet: normalizeSnippet(block.text, citationSnippetMaxChars),
        matchType: 'semantic',
        isContext,
      });
    }
  }

  const refs = await citationRefAllocator.allocate(
    drafts.map(draft => ({
      sourceType: 'knowledge_base' as const,
      docId: draft.docId,
      blockId: draft.blockId,
    }))
  );
  if (refs.length !== drafts.length) {
    throw new Error('[DeepSearchCitations] Citation allocator 返回了错位批次。');
  }
  const citations: KnowledgeSearchCitation[] = drafts.map((draft, index) => {
    const ref = refs[index];
    if (!ref) throw new Error('[DeepSearchCitations] Citation allocator 丢失已分配 ref。');
    return {
      ...draft,
      ref,
      index: citationOffset + index + 1,
    };
  });

  return {
    query,
    searchMode,
    citations,
    docName: docName ?? undefined,
  };
}
