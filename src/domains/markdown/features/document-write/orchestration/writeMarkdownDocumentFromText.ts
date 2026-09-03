/**
 * @file writeMarkdownDocumentFromText.ts
 * @description 将 file-style 的 Markdown 全文写入转换为块级 pending revisions。
 */

import { v4 as uuidv4 } from 'uuid';
import { generateRefId } from '../../../../../shared/utils/refIdGenerator';
import type { PendingRevisionMetadata } from '../../pending-revisions';
import {
  buildMarkdownCitationReadProjection,
} from '../../document-read';
import {
  planMarkdownBlocks,
} from '../../normalization';
import {
  serializeMarkdownBlocks,
  type FlattenedMarkdownBlock,
} from '../../../shared';
import { normalizeMarkdownCitationTokenSpelling } from '../../../../citation';

export type MarkdownFileWriteOperation = 'update' | 'insert' | 'delete';

export interface MarkdownFileWriteEdit {
  readonly operation: MarkdownFileWriteOperation;
  readonly blockId: string;
  readonly ref: string;
}

export interface MarkdownFileWriteResult {
  readonly documentId: string;
  readonly edits: MarkdownFileWriteEdit[];
  readonly currentText: string;
  readonly targetText: string;
}

export interface MarkdownDocumentWriteStore {
  getDocument(documentId: string): unknown;
  getPendingRevisions(documentId: string): Array<{
    readonly target_block_id: string;
    readonly new_markdown: string | null;
    readonly operation?: 'insert' | 'update' | 'delete' | null;
    readonly meta_json: string | null;
  }>;
  runInTransaction<T>(fn: () => T): T;
  insertEmptyBlockAfter(documentId: string, anchorBlockId: string, newBlockId: string): void;
  setPendingRevisionForToolIntent(params: {
    readonly documentId: string;
    readonly blockId: string;
    readonly newMarkdown: string;
    readonly source?: 'ai' | 'user' | 'tool';
    readonly meta?: PendingRevisionMetadata;
  }): unknown;
}

function buildMeta(params: {
  readonly operation: MarkdownFileWriteOperation;
  readonly toolName: 'edit_file' | 'write_file';
  readonly anchorBlockId?: string;
  readonly extra?: PendingRevisionMetadata;
}): PendingRevisionMetadata {
  return {
    ...(params.extra ?? {}),
    operation: params.operation,
    toolName: params.toolName,
    ...(params.anchorBlockId ? { anchorBlockId: params.anchorBlockId } : {}),
  };
}

function setPending(params: {
  readonly markdownService: MarkdownDocumentWriteStore;
  readonly documentId: string;
  readonly block: FlattenedMarkdownBlock;
  readonly markdown: string;
  readonly operation: 'update' | 'delete';
  readonly toolName: 'edit_file' | 'write_file';
  readonly extraMeta?: PendingRevisionMetadata;
}): MarkdownFileWriteEdit {
  params.markdownService.setPendingRevisionForToolIntent({
    documentId: params.documentId,
    blockId: params.block.blockId,
    newMarkdown: params.operation === 'delete' ? '' : params.markdown,
    source: 'ai',
    meta: buildMeta({
      operation: params.operation,
      toolName: params.toolName,
      extra: params.extraMeta,
    }),
  });

  return {
    operation: params.operation,
    blockId: params.block.blockId,
    ref: params.block.ref,
  };
}

function insertPending(params: {
  readonly markdownService: MarkdownDocumentWriteStore;
  readonly documentId: string;
  readonly anchorBlockId: string;
  readonly markdown: string;
  readonly toolName: 'edit_file' | 'write_file';
  readonly extraMeta?: PendingRevisionMetadata;
}): MarkdownFileWriteEdit {
  const blockId = uuidv4();
  params.markdownService.insertEmptyBlockAfter(params.documentId, params.anchorBlockId, blockId);
  params.markdownService.setPendingRevisionForToolIntent({
    documentId: params.documentId,
    blockId,
    newMarkdown: params.markdown,
    source: 'ai',
    meta: buildMeta({
      operation: 'insert',
      toolName: params.toolName,
      anchorBlockId: params.anchorBlockId,
      extra: params.extraMeta,
    }),
  });

  return {
    operation: 'insert',
    blockId,
    ref: generateRefId(blockId),
  };
}

export async function writeMarkdownDocumentFromText(params: {
  readonly documentStore: MarkdownDocumentWriteStore;
  readonly documentId: string;
  readonly targetText: string;
  readonly toolName: 'edit_file' | 'write_file';
  readonly pendingMetaByMarkdown?: ReadonlyMap<string, PendingRevisionMetadata>;
  readonly touchDocumentUpdatedAt: (documentId: string, updatedAt: number) => void;
}): Promise<MarkdownFileWriteResult> {
  const content = params.documentStore.getDocument(params.documentId);
  // edit_file 的 old_string 来自 citation-aware VFS 文本。写入规划必须复用同一当前视图，
  // 否则持久层里的 UI label（如 `[1]`）会和 Agent 看到的 `[@ref]` 不同，导致未修改的引用块被误写。
  const currentProjection = buildMarkdownCitationReadProjection({
    content,
    pendings: params.documentStore.getPendingRevisions(params.documentId),
    viewMode: 'preview',
  });
  const currentBlocks: readonly FlattenedMarkdownBlock[] = currentProjection.viewBlocks;
  const planned = await planMarkdownBlocks(params.targetText);
  const targetBlocks = planned.blocks;
  const targetComparisonBlocks = targetBlocks.map(normalizeMarkdownCitationTokenSpelling);
  const currentText = serializeMarkdownBlocks(currentBlocks);

  if (currentBlocks.length === 0 && targetBlocks.length > 0) {
    throw new Error('当前 Markdown 文档没有可锚定的块，无法通过 pending revision 写入全文。');
  }

  const edits = params.documentStore.runInTransaction(() => {
    const executed: MarkdownFileWriteEdit[] = [];
    const sharedLength = Math.min(currentBlocks.length, targetBlocks.length);

    for (let index = 0; index < sharedLength; index += 1) {
      const block = currentBlocks[index];
      const target = targetBlocks[index];
      const targetComparison = targetComparisonBlocks[index];
      if (!block || typeof target !== 'string' || typeof targetComparison !== 'string'
        || block.text === targetComparison) continue;
      executed.push(setPending({
        markdownService: params.documentStore,
        documentId: params.documentId,
        block,
        markdown: target,
        operation: 'update',
        toolName: params.toolName,
        extraMeta: params.pendingMetaByMarkdown?.get(target),
      }));
    }

    for (let index = targetBlocks.length; index < currentBlocks.length; index += 1) {
      const block = currentBlocks[index];
      if (!block) continue;
      executed.push(setPending({
        markdownService: params.documentStore,
        documentId: params.documentId,
        block,
        markdown: '',
        operation: 'delete',
        toolName: params.toolName,
      }));
    }

    let anchorBlockId = currentBlocks[currentBlocks.length - 1]?.blockId;
    for (let index = currentBlocks.length; index < targetBlocks.length; index += 1) {
      const markdown = targetBlocks[index];
      if (!anchorBlockId || typeof markdown !== 'string') continue;
      const inserted = insertPending({
        markdownService: params.documentStore,
        documentId: params.documentId,
        anchorBlockId,
        markdown,
        toolName: params.toolName,
        extraMeta: params.pendingMetaByMarkdown?.get(markdown),
      });
      executed.push(inserted);
      anchorBlockId = inserted.blockId;
    }

    if (executed.length > 0) {
      params.touchDocumentUpdatedAt(params.documentId, Date.now());
    }

    return executed;
  });

  return {
    documentId: params.documentId,
    edits,
    currentText,
    targetText: targetComparisonBlocks.join('\n\n'),
  };
}
