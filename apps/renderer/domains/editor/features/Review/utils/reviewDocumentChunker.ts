/**
 * @file apps/renderer/domains/editor/features/Review/utils/reviewDocumentChunker.ts
 * @description Review（审阅）专用分段器：从编辑器导出全篇 DocumentView，并按块分段生成多个 document_fragment
 *
 * 关键约束（与 PLAN.md 对齐）：
 * - 必须按块分段（rootBlock），禁止把一个块的内容切断
 * - 输出使用 DocumentView 协议（<workspace_document> + `[#ref] 文本`）
 * - 每个 chunk 的 document_fragment 都包含同一个 document_id（用于模型在 tool_call 里填写 document_id）
 */

import type { Editor } from '@tiptap/core';
import {
  buildDocumentView,
  flattenBlocksFromEditor,
  type FlattenedBlock,
} from '../../../../../shared/utils/documentViewSerializer';
import type { DocumentViewMeta } from '@app/schemas';
import { generateRefId } from '../../../../../shared/utils/refIdGenerator';
import type { ReviewContextConfig } from '../config/contextConfig';

export interface ReviewDocumentChunk {
  /** chunk 索引（从 0 开始） */
  chunkIndex: number;
  /** DocumentView 协议的文本（将作为 conversation/next 的 document_fragment 传给后端） */
  document_fragment: string;
  /** 本 chunk 包含的块数量（用于调试/统计） */
  blocksCount: number;
}

interface BlockWithRef {
  blockId: string;
  ref: string;
  markdown: string;
}

async function buildBlocksWithRefs(blocks: FlattenedBlock[]): Promise<BlockWithRef[]> {
  const out: BlockWithRef[] = [];
  for (const b of blocks) {
    const ref = await generateRefId(b.blockId);
    out.push({
      blockId: b.blockId,
      ref,
      markdown: b.markdown,
    });
  }
  return out;
}

function buildBodyFromBlocks(blocks: BlockWithRef[]): string {
  const lines: string[] = [];
  for (const b of blocks) {
    const trimmedMarkdown = b.markdown.trim();
    lines.push(`[${b.ref}] ${trimmedMarkdown}`);
  }
  return lines.join('\n\n');
}

/**
 * 从编辑器导出 Review 分段后的 DocumentView 列表。
 *
 * @param editor - 当前编辑器实例（必须是“所见即所得”的前端状态）
 * @param documentId - 当前文档 ID（必须与 workspace DB 的 documentId 一致）
 * @param config - 分段配置
 */
export async function chunkReviewDocumentFromEditor(params: {
  editor: Editor;
  documentId: string;
  config: ReviewContextConfig;
}): Promise<ReviewDocumentChunk[]> {
  const { editor, documentId, config } = params;

  const flattened = flattenBlocksFromEditor(editor);
  if (!flattened || flattened.length === 0) {
    return [];
  }

  const blocksWithRefs = await buildBlocksWithRefs(flattened);
  const fullBody = buildBodyFromBlocks(blocksWithRefs);

  const totalTextLength = fullBody.length;
  const blocksTotal = blocksWithRefs.length;

  const chunks: ReviewDocumentChunk[] = [];
  const maxBlocks = Math.max(1, Math.floor(config.maxBlocksPerChunk));
  const maxChars = config.maxCharsPerChunk;

  // 分段策略：块数和字符数取先满足者
  let start = 0;
  while (start < blocksWithRefs.length) {
    let end = start;
    let currentChars = 0;

    // 逐块累加，直到达到块数或字符数限制
    while (end < blocksWithRefs.length) {
      const block = blocksWithRefs[end];
      // 每行格式: "[ref] markdown\n\n"，计算实际字符数
      const blockChars = `[${block.ref}] ${block.markdown.trim()}`.length + 2; // +2 for "\n\n"

      // 如果是第一个块，无论多大都要包含（避免死循环）
      if (end === start) {
        currentChars += blockChars;
        end++;
        continue;
      }

      // 检查是否会超限
      if (end - start >= maxBlocks || currentChars + blockChars > maxChars) {
        break;
      }

      currentChars += blockChars;
      end++;
    }

    const slice = blocksWithRefs.slice(start, end);

    const meta: DocumentViewMeta = {
      documentId,
      docType: 'markdown',
      offsetChars: 0,
      truncatedByChars: false,
      totalTextLength,
      nextOffset: null,
      blocksShown: slice.length,
      blocksTotal,
    };

    const body = buildBodyFromBlocks(slice);
    const documentViewText = buildDocumentView(meta, body);

    chunks.push({
      chunkIndex: chunks.length,
      document_fragment: documentViewText,
      blocksCount: slice.length,
    });

    start = end;
  }

  return chunks;
}


