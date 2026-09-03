import type { KnowledgeSearchCitation } from '@app/schemas';
import type {
  KnowledgeDocumentReadRequest,
  KnowledgeDocumentReadResult,
  OrderedKnowledgeDocumentBlock,
} from '../definitions/knowledgeDocumentRead';
import {
  UNTRUSTED_KNOWLEDGE_SOURCE_END_NOTICE,
  UNTRUSTED_KNOWLEDGE_SOURCE_NOTICE_LINES,
  wrapUntrustedKnowledgeSource,
} from '../../shared/agent-observation/knowledgeSourceBoundary';

const MAX_FULL_CHUNKS_PER_CALL = 30;
const MAX_GLANCE_CHUNKS_PER_CALL = 200;
const GLANCE_PREVIEW_MAX_CHARS = 80;

function filterMultipleNewlines(content: string): string {
  return content.replace(/\n{2,}/g, '\n');
}

function extractGlancePreview(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';

  const sentenceEnders = ['。', '！', '？', '.', '!', '?', '；', ';', '…'];
  let endIndex = -1;
  for (const ender of sentenceEnders) {
    const index = normalized.indexOf(ender);
    if (index !== -1 && (endIndex === -1 || index < endIndex)) {
      endIndex = index;
    }
  }

  const firstSentence = endIndex === -1 ? normalized : normalized.slice(0, endIndex + 1).trim();
  return firstSentence.length <= GLANCE_PREVIEW_MAX_CHARS
    ? firstSentence
    : firstSentence.slice(0, GLANCE_PREVIEW_MAX_CHARS).trim();
}

export interface KnowledgeDocumentReadSelection {
  readonly request: KnowledgeDocumentReadRequest;
  readonly totalChunks: number;
  readonly startChunk: number;
  readonly endChunk: number;
  readonly adjustmentNote: string;
  readonly rangeAdjusted: boolean;
  readonly selectedEntries: readonly OrderedKnowledgeDocumentBlock[];
}

/** 范围裁剪是唯一来源；编排层据此批量申请 refs，结果构建不再重复决定窗口。 */
export function selectKnowledgeDocumentReadBlocks(params: {
  readonly request: KnowledgeDocumentReadRequest;
  readonly orderedBlocks: readonly OrderedKnowledgeDocumentBlock[];
}): KnowledgeDocumentReadSelection {
  const { request, orderedBlocks } = params;
  const totalChunks = orderedBlocks.length;
  const maxChunks =
    request.mode === 'glance' ? MAX_GLANCE_CHUNKS_PER_CALL : MAX_FULL_CHUNKS_PER_CALL;

  let startChunk = request.startChunk;
  let endChunk = request.endChunk;
  let adjustmentNote = '';

  if (endChunk - startChunk + 1 > maxChunks) {
    endChunk = startChunk + maxChunks - 1;
    adjustmentNote = `Note: In ${request.mode} mode, you can read at most ${maxChunks} chunks per call. The range has been adjusted to ${startChunk}-${endChunk}.\n\n`;
  }

  let rangeAdjusted = false;
  if (startChunk > totalChunks && totalChunks > 0) {
    startChunk = totalChunks;
    endChunk = totalChunks;
    rangeAdjusted = true;
  } else if (endChunk > totalChunks) {
    endChunk = totalChunks;
    rangeAdjusted = true;
  }

  const selectedEntries = orderedBlocks.slice(startChunk - 1, endChunk);
  if (selectedEntries.length === 0) {
    throw new Error(`Document ${request.documentId} has no content in the available range.`);
  }
  return {
    request,
    totalChunks,
    startChunk,
    endChunk,
    adjustmentNote,
    rangeAdjusted,
    selectedEntries,
  };
}

export function buildKnowledgeDocumentReadResult(params: {
  readonly filename: string;
  readonly selection: KnowledgeDocumentReadSelection;
  readonly citationRefs: readonly string[];
}): KnowledgeDocumentReadResult {
  const { filename, citationRefs } = params;
  const {
    request,
    totalChunks,
    startChunk,
    endChunk,
    adjustmentNote,
    rangeAdjusted,
    selectedEntries,
  } = params.selection;
  if (citationRefs.length !== selectedEntries.length) {
    throw new Error(
      'Knowledge document read requires one admitted citation ref per selected block.'
    );
  }

  const hasMore = endChunk < totalChunks;
  const nextStartChunk = hasMore ? endChunk + 1 : null;
  let observation = adjustmentNote;
  if (rangeAdjusted) {
    observation += `Note: This document has only ${totalChunks} chunks. The range has been adjusted to chunks ${startChunk}-${endChunk}.\n\n`;
  }
  if (nextStartChunk !== null) {
    observation += `Cursor: To continue, set start_chunk to ${nextStartChunk}.\n\n`;
  }

  const preparedChunks = selectedEntries.map((entry, index) => ({
    entry,
    index: startChunk + index,
    text: filterMultipleNewlines(
      request.mode === 'glance' ? extractGlancePreview(entry.block.text) : entry.block.text
    ),
  }));

  observation += `${UNTRUSTED_KNOWLEDGE_SOURCE_NOTICE_LINES.join('\n')}\n\n`;
  observation += preparedChunks
    .map(({ entry, index: chunkNumber, text }, localIndex) => {
      // chunk 编号始终表示文档内位置；citationOffset 只服务同一 turn 的引用序号去重。
      const ref = citationRefs[localIndex];
      if (!ref) throw new Error('Knowledge document read lost an admitted citation ref.');
      return [
        `[Chunk ${chunkNumber}/${totalChunks}] [@${ref}] source_type=knowledge_base block_id=${JSON.stringify(entry.blockId)}`,
        ...wrapUntrustedKnowledgeSource({
          ref,
          docId: request.documentId,
          blockId: entry.blockId,
          body: text,
        }),
      ].join('\n');
    })
    .join('\n\n');
  observation += `\n\n${UNTRUSTED_KNOWLEDGE_SOURCE_END_NOTICE}`;
  const chunks = preparedChunks.map(({ index, text }) => ({ index, text }));
  const citations: KnowledgeSearchCitation[] = preparedChunks.map(
    ({ entry, index, text }, localIndex) => {
      const ref = citationRefs[localIndex];
      if (!ref) throw new Error('Knowledge document read lost an admitted citation ref.');
      return {
        // 引用序号可跨工具调用递增，但稳定锚点仍是 docId + 真实 SoT blockId。
        index: index + request.citationOffset,
        sourceType: 'knowledge_base',
        docId: request.documentId,
        blockId: entry.blockId,
        ref,
        docTitle: filename,
        snippet: text.slice(0, 100),
      };
    }
  );

  return {
    data: {
      chunks,
      filename,
      total_chunks: totalChunks,
      start_chunk: startChunk,
      end_chunk: endChunk,
      mode: request.mode,
      has_more: hasMore,
      next_start_chunk: nextStartChunk,
      citations: {
        query: `阅读文档: ${filename}`,
        searchMode: 'document',
        citations,
        docName: filename,
      },
    },
    observation: filterMultipleNewlines(observation),
    observationPreviewMeta: { filename },
  };
}
