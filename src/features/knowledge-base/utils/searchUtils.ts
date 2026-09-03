/**
 * @file src/knowledge-base/utils/searchUtils.ts
 *
 * @brief 知识库搜索工具函数模块
 *
 * @description
 * 包含搜索结果格式化和其他搜索相关的工具函数。
 */

import { logger } from '@shared/index';
import { SotRepository } from '../infrastructure/sotRepository';
import { isCanonicalCitationRef } from '../../../domains/citation';
import type { DocumentSoT } from '../domain/block';
import {
  DEFAULT_FULL_GRAPH_BUDGET,
  DEFAULT_LIGHT_GRAPH_BUDGET,
  type GraphBudget,
  type GraphMode,
} from '../graph/application/graphBudget';
import {
  UNTRUSTED_KNOWLEDGE_SOURCE_END_NOTICE,
  UNTRUSTED_KNOWLEDGE_SOURCE_NOTICE_LINES,
  wrapUntrustedKnowledgeSource,
} from '../shared/agent-observation/knowledgeSourceBoundary';

/**
 * SoT 获取器接口（用于复用 formatSearchResultsForLLM 的输出格式）
 *
 * 说明：
 * - `formatSearchResultsForLLM` 历史上直接依赖 `SotRepository`；
 * - deep_search 等工具链路在工具侧通常只有 KnowledgeBaseService（可直接拿到 SoT），不应反向依赖 repository 实现；
 * - 因此提供一个“最小能力”接口，以保持格式化逻辑单一来源。
 */
export interface SoTProvider {
  get(docId: string): Promise<DocumentSoT | null | undefined>;
}

/**
 * 将混合搜索结果格式化为对LLM友好的、包含上下文预览的详细字符串
 *
 * @param results 搜索结果数组（原始payload格式）
 * @param sotRepository SoT仓库实例
 * @param docId 可选的文档ID（用于文档内搜索）
 * @param originalQuery 原始查询文本
 * @param citationOffset 🔥 引用编号偏移量,用于多次工具调用时保持编号连续
 * @returns 格式化的搜索结果字符串
 */
export async function formatSearchResultsForLLM(
  results: Array<Record<string, unknown>>,
  sotRepository: SotRepository,
  docId?: string,
  originalQuery?: string,
  citationOffset: number = 0,
  citationRefs: readonly string[] = [],
  options?: {
    /**
     * 默认 kbId（单知识库搜索场景）。
     */
    kbId?: string;
    /**
     * M5：按 (kbId|docId|blockId) 命中的图谱增强信息。
     */
    graphAugmentations?: ReadonlyMap<
      string,
      import('../graph/application/graphSearchService').GraphAugmentation
    >;
    /**
     * 图谱档位：off/light/full
     * - off：不输出图谱字段
     * - light/full：输出图谱字段，但受预算裁剪
     */
    graphMode?: GraphMode;
    /**
     * 图谱输出预算（仅影响“输出体积裁剪”，不影响检索召回）
     */
    graphBudget?: GraphBudget;
    /**
     * 是否省略整体 header（用于把同构结果插入到一个自定义 section 中）
     */
    omitHeader?: boolean;
    /**
     * 是否省略末尾的 Next Step Suggestions（避免一个 observation 出现多段重复建议）
     */
    omitNextStepSuggestions?: boolean;
  }
): Promise<string> {
  return formatSearchResultsForLLMWithSoTProvider(
    results,
    { get: (id: string) => sotRepository.get(id) },
    docId,
    originalQuery,
    citationOffset,
    citationRefs,
    options
  );
}

/**
 * 格式化搜索结果（同 formatSearchResultsForLLM 输出格式），但通过 SoTProvider 解耦 repository。
 */
export async function formatSearchResultsForLLMWithSoTProvider(
  results: Array<Record<string, unknown>>,
  sotProvider: SoTProvider,
  docId?: string,
  originalQuery?: string,
  citationOffset: number = 0,
  citationRefs: readonly string[] = [],
  options?: {
    kbId?: string;
    graphAugmentations?: ReadonlyMap<
      string,
      import('../graph/application/graphSearchService').GraphAugmentation
    >;
    graphMode?: GraphMode;
    graphBudget?: GraphBudget;
    /**
     * 是否省略整体 header（用于把同构结果插入到一个自定义 section 中）
     */
    omitHeader?: boolean;
    /**
     * 是否省略末尾的 Next Step Suggestions（避免一个 observation 出现多段重复建议）
     */
    omitNextStepSuggestions?: boolean;
  }
): Promise<string> {
  if (citationRefs.length !== results.length) {
    throw new Error('Knowledge search formatter requires one admitted citation ref per result.');
  }
  citationRefs.forEach(ref => {
    if (!isCanonicalCitationRef(ref)) {
      throw new Error(
        `Knowledge search formatter received invalid citation ref ${JSON.stringify(ref)}.`
      );
    }
  });
  if (!results || results.length === 0) {
    if (docId) {
      return `No relevant results found for '${originalQuery}' within document ID '${docId}'.`;
    } else {
      return 'No relevant results found.';
    }
  }

  let header: string;
  if (docId && originalQuery) {
    header = `Found ${results.length} relevant results for '${originalQuery}' within document ID '${docId}':`;
  } else {
    header = `Found ${results.length} relevant results for query '${originalQuery}':`;
  }

  const formattedLines: string[] = [];
  if (options?.omitHeader !== true) {
    formattedLines.push(header, '---');
  }
  formattedLines.push(...UNTRUSTED_KNOWLEDGE_SOURCE_NOTICE_LINES, '');
  // 图谱输出预算（默认与历史行为保持一致：entities=6, edges=3）
  const graphMode: GraphMode = options?.graphMode ?? 'light';
  /**
   * 重要：不要在 formatter 里“手写默认 budget”。
   *
   * 原因：
   * - `GraphBudget` 是单一真实来源（`graphBudget.ts`），字段会随 full 能力演进而扩展；
   * - 手写默认值会造成“缺字段”的类型错误，也会导致默认策略在不同模块间漂移。
   */
  const graphBudget: GraphBudget =
    options?.graphBudget ??
    (graphMode === 'full' ? DEFAULT_FULL_GRAPH_BUDGET : DEFAULT_LIGHT_GRAPH_BUDGET);

  // 为每个文档ID缓存其SoT数据
  const sotCache: Record<string, DocumentSoT | null | undefined> = {};
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const currentDocIdRaw = result.doc_id;
    const blockIdRaw = result.block_id;
    const currentDocId =
      typeof currentDocIdRaw === 'string' ? currentDocIdRaw : String(currentDocIdRaw ?? '');
    const blockId = typeof blockIdRaw === 'string' ? blockIdRaw : String(blockIdRaw ?? '');

    // 🔥 使用偏移量计算实际的结果编号
    const resultNumber = citationOffset + i + 1;

    // 确保我们有doc_id和block_id
    if (!currentDocId || !blockId) {
      formattedLines.push(`Result ${resultNumber}: Incomplete data, unable to process.`);
      formattedLines.push('---');
      continue;
    }

    // 使用缓存的SoT数据
    if (!(currentDocId in sotCache)) {
      try {
        sotCache[currentDocId] = await sotProvider.get(currentDocId);
      } catch (error) {
        logger.warn(`无法获取 doc_id '${currentDocId}' 的 SoT: ${error}`);
        sotCache[currentDocId] = null;
      }
    }

    const sotDoc = sotCache[currentDocId];
    const docTitleFromPayload =
      typeof result.doc_title === 'string' ? result.doc_title : currentDocId;
    const pageNumber = typeof result.page_number === 'number' ? result.page_number : undefined; // 修复字段名
    // 🔥 为该条结果生成短引用 ref（与 citations 元数据保持一致）
    const ref = citationRefs[i];
    if (!ref) throw new Error('Knowledge search formatter lost an admitted citation ref.');

    // 可信骨架只包含 owner 生成的 ref 与稳定来源锚点；标题和正文统一放入动态不可信边界。
    formattedLines.push(`Result ${resultNumber} [@${ref}] source_type=knowledge_base`);
    const untrustedLines = [`Document: ${docTitleFromPayload}`];

    /**
     * Discovery（Path B）结果的“孤岛检测”标签与路径摘要
     *
     * 说明：
     * - 这些字段由 searchService 在 block_type='graph_discovery' 的伪结果中注入；
     * - 仅用于提示 Agent：哪些是“可回溯连通的直接上下文”，哪些是“潜在相关但尚未证明连通”的线索。
     */
    if (typeof result.block_type === 'string' && result.block_type === 'graph_discovery') {
      const label =
        typeof (result as Record<string, unknown>)['_graph_discovery_label'] === 'string'
          ? String((result as Record<string, unknown>)['_graph_discovery_label'])
          : '';
      const pathSummaryRaw = (result as Record<string, unknown>)['_graph_discovery_path_summary'];
      const pathSummary =
        typeof pathSummaryRaw === 'string' && pathSummaryRaw.trim().length > 0
          ? pathSummaryRaw
          : '';

      if (label === 'direct_context') {
        untrustedLines.push(`补漏判定: Direct Context（已找到短路径连通）`);
        if (pathSummary.length > 0) {
          untrustedLines.push(`连通路径: ${pathSummary}`);
        }
      } else if (label === 'potential_insight') {
        untrustedLines.push(`补漏判定: Potential Insight（暂未找到与当前锚点的直接连通路径）`);
      }
    }

    // 核心上下文预览逻辑
    const contextPreview: {
      previous_block_preview: string | null;
      next_block_preview: string | null;
    } = {
      previous_block_preview: null,
      next_block_preview: null,
    };

    if (sotDoc) {
      const structureList = sotDoc.structure?.root || [];
      const structureMap: Record<string, number> = {};
      structureList.forEach((bId: string, index: number) => {
        structureMap[bId] = index;
      });
      const contentBlocks = sotDoc.content_blocks || {};

      if (blockId in structureMap) {
        const currentIndex = structureMap[blockId];

        // 获取上一段预览
        if (currentIndex > 0) {
          const prevBlockId = structureList[currentIndex - 1];
          const prevBlockText = contentBlocks[prevBlockId]?.text || '';
          if (prevBlockText) {
            // 区分长短文本，实现更智能的上一段预览
            // 降低阈值以更积极地截断，避免将短标题/句子显示为完整预览
            if (prevBlockText.length <= 30) {
              contextPreview.previous_block_preview = prevBlockText;
            } else {
              contextPreview.previous_block_preview = `${prevBlockText.substring(0, 15)}...${prevBlockText.substring(prevBlockText.length - 15)}`;
            }
          }
        }

        // 获取下一段预览
        if (currentIndex < structureList.length - 1) {
          const nextBlockId = structureList[currentIndex + 1];
          const nextBlockText = contentBlocks[nextBlockId]?.text || '';
          if (nextBlockText) {
            // 移除条件逻辑，始终显示前15个字符的预览，以提供一致的格式
            contextPreview.next_block_preview = `${nextBlockText.substring(0, 15)}...`;
          }
        }
      }
    }

    if (contextPreview.previous_block_preview) {
      untrustedLines.push(`  └─ Prev: ${contextPreview.previous_block_preview}`);
    }

    // 确保 'document' 字段总是被正确显示
    const hitText =
      typeof result.document === 'string'
        ? result.document
        : '[Error: Hit text not found in payload]';
    untrustedLines.push(`  ├─ Hit:  "${hitText}"`);

    if (contextPreview.next_block_preview) {
      untrustedLines.push(`  └─ Next: ${contextPreview.next_block_preview}`);
    }

    // --- M5（light）：图谱增强信息（仅当存在 augmentation 时输出） ---
    // 说明：key 使用 kbId|docId|blockId，避免跨 KB 冲突
    const kbIdFromItem =
      typeof (result as { _kb_id?: unknown })._kb_id === 'string'
        ? ((result as { _kb_id?: unknown })._kb_id as string)
        : typeof options?.kbId === 'string'
          ? options.kbId
          : '';
    if (
      graphMode !== 'off' &&
      i < graphBudget.maxResultsWithGraph &&
      options?.graphAugmentations &&
      kbIdFromItem.trim().length > 0
    ) {
      const key = `${kbIdFromItem}|${currentDocId}|${blockId}`;
      const aug = options.graphAugmentations.get(key);
      if (aug) {
        const entityText = aug.entities
          .slice(0, graphBudget.maxEntitiesPerResult)
          .map(e => `${e.canonicalName || e.name}(${e.id})`)
          .join(', ');
        const edgeText = aug.edges
          .slice(0, graphBudget.maxEdgesPerResult)
          .map(e => {
            const s = e.sourceEntityId;
            const t = e.targetEntityId;
            const stmt =
              typeof e.statement === 'string' && e.statement.trim().length > 0
                ? `: ${e.statement}`
                : '';
            const ref =
              typeof (e as { evidenceRefType?: unknown }).evidenceRefType === 'string'
                ? String((e as { evidenceRefType?: unknown }).evidenceRefType)
                : '';
            const refText =
              ref === 'in_rag' ? ' [ref: in_rag]' : ref === 'external' ? ' [ref: external]' : '';
            return `(${e.relationType}) ${s} -> ${t}${stmt}${refText}`;
          })
          .join(' | ');
        untrustedLines.push(`  ├─ Graph: Entities: ${entityText}`);
        untrustedLines.push(`  ├─ Graph: Relations: ${edgeText}`);
      }
    }

    // Add page number and match type to the reference line for clarity
    const refPageInfo = pageNumber ? `, page_number: ${pageNumber}` : '';

    // 🔥 新增：显示匹配类型信息
    let matchTypeText = '';
    const matchType = result.final_match_type || result.match_type || 'semantic';

    switch (matchType) {
      case 'exact':
        matchTypeText = '精确匹配';
        break;
      case 'full_keyword':
        matchTypeText = '全关键词匹配';
        break;
      case 'partial_keyword':
        matchTypeText = '部分关键词匹配';
        break;
      case 'strong_semantic':
        matchTypeText = '高价值语义匹配';
        break;
      case 'hybrid':
        matchTypeText = '混合匹配';
        break;
      case 'keyword':
        matchTypeText = '关键词匹配';
        break;
      case 'semantic':
      default:
        matchTypeText = '语义匹配';
        break;
    }

    formattedLines.push(
      `  (Ref: doc_id='${currentDocId}', block_id='${blockId}'${refPageInfo}, 匹配类型: ${matchTypeText})`
    );
    formattedLines.push(
      ...wrapUntrustedKnowledgeSource({
        ref,
        docId: currentDocId,
        blockId,
        body: untrustedLines.join('\n'),
      })
    );
    formattedLines.push('---');
  }

  formattedLines.push(UNTRUSTED_KNOWLEDGE_SOURCE_END_NOTICE);

  if (options?.omitNextStepSuggestions !== true) {
    formattedLines.push(
      "Next Step Suggestions:\n - To read the content, use 'knowledge_read' with the 'doc_id' and, if available, 'start_chunk' and 'end_chunk'."
    );
  }

  return formattedLines.join('\n');
}
