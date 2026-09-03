/**
 * @file src/tools/knowledgebase/search/format/formatObservation.ts
 * @description 将 UI documents 格式化为 Deep Search 专用的“阅读视图”（Reading View）
 *
 * 设计变更 (2025-01):
 * - 原逻辑：复用浅搜索 Formatter，只显示 Hit 片段 + 极短前后文，导致 AI 无法获取连贯上下文。
 * - 新逻辑：Deep Search 本质是“深度阅读”，因此改为“以文档为中心”的视图：
 *   1. 按文档分组，不再破碎地列出 Result 1, Result 2...
 *   2. 自动上下文扩充：选中 Block 的前后 Block 会自动补全。
 *   3. 连续片段合并：如果 Block N 和 N+1 都被选中（或扩充），合并展示为连续文本。
 *   4. 显示完整内容：直接读取 SoT 全文，不再使用被 Judge 截断的 snippet。
 */

import type { KnowledgeSearchDocument } from '../types';
import type { KnowledgeSearchCitationMetadata } from '@app/schemas';
import type { DocumentSoT } from '../../../../features/knowledge-base/domain/block';
import type { KnowledgeBaseService } from '../../../../features/knowledge-base/application/knowledgeBaseService';
import {
  UNTRUSTED_KNOWLEDGE_SOURCE_END_NOTICE,
  UNTRUSTED_KNOWLEDGE_SOURCE_NOTICE_LINES,
  wrapUntrustedKnowledgeSource,
} from '../../../../features/knowledge-base/shared/agent-observation/knowledgeSourceBoundary';

export interface DeepSearchEmittedEvidence {
  readonly ref: string;
  readonly docId: string;
  readonly blockId: string;
  readonly docTitle: string;
  readonly text: string;
}

export interface DeepSearchObservationProjection {
  readonly observation: string;
  readonly emittedEvidence: readonly DeepSearchEmittedEvidence[];
}

export async function formatObservationFromDocuments(params: {
  documents: KnowledgeSearchDocument[];
  query: string;
  citationOffset: number;
  reader: Pick<KnowledgeBaseService, 'getRawSoTDocument'>;
  citations: KnowledgeSearchCitationMetadata;
  contextExpansionRange: number;
  /**
   * deep_search observation 输出上限（可选）
   *
   * 背景：
   * - deep_search 允许子 Agent 选择较多块（例如 20~30），且每块可能是长段落；
   * - observation 是给“上层 Agent”阅读的，过长会挤爆模型上下文，导致回答质量下降甚至失败；
   * - 因此这里提供一个明确的体积约束：按“块数/字符数”提前截断。
   *
   * 注意：截断不是兜底补丁，而是工具协议的一部分：保证输出规模稳定、可控。
   */
  maxTotalBlocks?: number;
  maxTotalChars?: number;
}): Promise<DeepSearchObservationProjection> {
  const {
    documents,
    query,
    reader,
    citations,
    contextExpansionRange,
    maxTotalBlocks,
    maxTotalChars,
  } = params;
  if (documents.length === 0) {
    return {
      observation: `Deep Search did not find any relevant documents for query: "${query}".`,
      emittedEvidence: [],
    };
  }

  // 1. 按 doc_id 分组
  const docsMap = new Map<string, KnowledgeSearchDocument[]>();
  // 保持文档出现的原始顺序（通常是相关度顺序），但去重
  const docOrder: string[] = [];

  for (const doc of documents) {
    if (!docsMap.has(doc.doc_id)) {
      docsMap.set(doc.doc_id, []);
      docOrder.push(doc.doc_id);
    }
    docsMap.get(doc.doc_id)?.push(doc);
  }

  const lines: string[] = [];
  const emittedEvidence: DeepSearchEmittedEvidence[] = [];
  lines.push(`Deep Search Report for query: "${query}"`);
  lines.push(`Found ${documents.length} relevant fragments across ${docOrder.length} documents.`);
  lines.push('');
  lines.push(
    [
      '说明（重要）：',
      '- doc_id：完整文档 ID，用于后续 knowledge_read 的 doc_id 入参。',
      '- block_id：SoT 块 ID（稳定锚点），用于 assemble_documents 的 selected_blocks.block_id（必须使用它，不能用 [@ref] 代替）。',
      '- [@ref]：引用短 ID（citation ref），用于在回答中标注来源与定位到具体chunk；它不是 doc_id，也不能替代 doc_id 或 block_id。',
    ].join('\n')
  );
  lines.push('', ...UNTRUSTED_KNOWLEDGE_SOURCE_NOTICE_LINES, '');

  // 输出体积控制：统计已输出的“块数/字符数”
  let emittedBlocks = 0;
  let emittedChars = 0;
  let isTruncated = false;

  const canEmitMore = (nextText: string): boolean => {
    if (typeof maxTotalBlocks === 'number' && maxTotalBlocks > 0) {
      if (emittedBlocks + 1 > maxTotalBlocks) return false;
    }
    if (typeof maxTotalChars === 'number' && maxTotalChars > 0) {
      if (emittedChars + nextText.length > maxTotalChars) return false;
    }
    return true;
  };

  const markTruncatedOnce = () => {
    if (isTruncated) return;
    isTruncated = true;
    lines.push('');
    lines.push(
      `[Truncated] 输出过长已截断：已输出 ${emittedBlocks} 个块 / ${emittedChars} 字符。你可以通过减少 top_k 或降低上下文扩充范围来缩短阅读材料。`
    );
  };

  /**
   * 🔥 引用一致性（关键）：
   * - runDeepSearch 已通过 buildCitationMetadataFromResults 生成 citations（包含 ref）。
   * - observation 必须复用同一份 ref，否则极低概率下可能出现 “observation 里的 ref 与 citations 不一致”。
   */
  const refByDocAndBlock = new Map<string, string>();
  for (const c of citations.citations) {
    if (typeof c.ref !== 'string' || c.ref.length === 0) {
      // schemas 允许 ref 可选（旧消息/旧工具输出兼容），但 deep_search 必须提供 ref，才能让 AI 输出可追溯引用。
      throw new Error(
        `[DeepSearchObservation] citations 缺少 ref：docId="${c.docId}" blockId="${c.blockId}"`
      );
    }
    const key = `${c.docId}:${c.blockId}`;
    // 同一 (docId, blockId) 理论上不会重复；若重复，后者覆盖即可（语义一致）
    refByDocAndBlock.set(key, c.ref);
  }

  // 2. 遍历文档并构建阅读视图
  for (const docId of docOrder) {
    if (isTruncated) break;
    const docHits = docsMap.get(docId) || [];
    const docName = docHits[0].doc_name || docId;

    // 获取 SoT 数据
    let sot: DocumentSoT | undefined;
    try {
      // 使用 getRawSoTDocument 获取完整内容
      sot = await reader.getRawSoTDocument(docId);
    } catch (e) {
      lines.push(
        `[Error reading document ${docId}: ${e instanceof Error ? e.message : String(e)}]`
      );
      continue;
    }

    if (!sot || !sot.structure || !Array.isArray(sot.structure.root)) {
      lines.push(`[Document doc_id=${JSON.stringify(docId)} has no valid structure]`);
      continue;
    }

    // 🔥 关键：必须把“可用于阅读工具的完整 doc_id”直接展示出来，避免用户/模型拿不到后续阅读所需的 ID。
    lines.push(`Document: doc_id=${JSON.stringify(docId)}`);
    lines.push('--------------------------------------------------');

    const rootStructure = sot.structure.root; // Block IDs
    const contentBlocks = sot.content_blocks || {};

    // 映射 BlockId -> Index
    const blockIdToIndex = new Map<string, number>();
    rootStructure.forEach((bid, idx) => {
      if (typeof bid === 'string') blockIdToIndex.set(bid, idx);
    });

    // 3. 计算需要显示的 Index 集合（Hits + Context）
    const indicesToShow = new Set<number>();
    const hitIndices = new Set<number>(); // 记录哪些是原始命中（用于加 ref）

    for (const hit of docHits) {
      const idx = blockIdToIndex.get(hit.block_id);
      if (idx !== undefined) {
        hitIndices.add(idx);
        // 扩充上下文
        for (let i = idx - contextExpansionRange; i <= idx + contextExpansionRange; i++) {
          if (i >= 0 && i < rootStructure.length) {
            indicesToShow.add(i);
          }
        }
      }
    }

    // 排序并合并连续区间
    const sortedIndices = Array.from(indicesToShow).sort((a, b) => a - b);

    // 遍历索引构建文本
    let lastIdx = -999;

    for (const idx of sortedIndices) {
      if (isTruncated) break;
      // 如果是非连续的（跨度大于1），插入分隔符
      if (idx > lastIdx + 1) {
        if (lastIdx !== -999) {
          lines.push('(...)');
        }
      }

      const blockId = rootStructure[idx];
      const block = contentBlocks[blockId];
      if (!block) continue;

      /**
       * 🔥 deep_search 约束：AI 看到的一切都必须可引用
       * - 因此无论命中还是上下文块，都要输出 [@ref]
       * - ref 必须来自 citations（与前端引用弹窗保持一致）
       */
      const ref = refByDocAndBlock.get(`${docId}:${blockId}`);
      if (!ref) {
        throw new Error(
          `[DeepSearchObservation] 缺少 citation ref：doc_id="${docId}" block_id="${blockId}"`
        );
      }
      const isContext = !hitIndices.has(idx);
      // 🔥 关键：在 observation 中显式输出 block_id，避免子 Agent 误把 [@ref] 当作 block_id 传给 assemble_documents
      const sourceIdentity = isContext
        ? `[@${ref}] source_type=knowledge_base context=true block_id=${JSON.stringify(String(blockId))}`
        : `[@${ref}] source_type=knowledge_base block_id=${JSON.stringify(String(blockId))}`;

      const text = (block.text || '').trim();
      if (text) {
        // 先判断是否还能继续输出（避免输出半截块导致误读）
        if (!canEmitMore(text)) {
          markTruncatedOnce();
          break;
        }
        lines.push(
          sourceIdentity,
          ...wrapUntrustedKnowledgeSource({
            ref,
            docId,
            blockId: String(blockId),
            body: [`Document: ${docName}`, text].join('\n'),
          })
        );
        emittedEvidence.push({
          ref,
          docId,
          blockId: String(blockId),
          docTitle: docName,
          text,
        });
        emittedBlocks += 1;
        emittedChars += text.length;
      }

      lastIdx = idx;
    }

    lines.push(''); // 文档间空行
    lines.push('');
  }

  lines.push(UNTRUSTED_KNOWLEDGE_SOURCE_END_NOTICE);

  return {
    observation: lines.join('\n'),
    emittedEvidence,
  };
}
