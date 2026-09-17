import { alignMarkdownAnnotationComments } from '../functions/alignMarkdownAnnotationComments';
/**
 * @file writeMarkdownDocumentFromText.ts
 * @description 将 file-style 的 Markdown 全文写入转换为块级 pending revisions。
 */

import { v4 as uuidv4 } from 'uuid';
import { generateRefId } from '../../../../../shared/utils/refIdGenerator';
import type { PendingRevisionMetadata } from '../../pending-revisions';
import { buildMarkdownCitationReadProjection } from '../../document-read';
import { planMarkdownBlocks } from '../../normalization';
import { serializeMarkdownBlocks, type FlattenedMarkdownBlock } from '../../../shared';
import { normalizeMarkdownCitationTokenSpelling } from '../../../../citation';
import { planMarkdownBlockWrites } from '../functions/planMarkdownBlockWrites';
import type { MarkdownAnnotationMeta } from '@app/schemas';
import {
  applyMarkdownAnnotationChanges,
  planMarkdownFileAnnotationChanges,
} from '../../annotations';

import type { MarkdownDocumentWriteStore, MarkdownFileWriteEdit, MarkdownFileWriteOperation, MarkdownFileWriteResult } from '../definitions/markdownDocumentWrite';
export type { MarkdownDocumentWriteStore, MarkdownFileWriteEdit, MarkdownFileWriteOperation, MarkdownFileWriteResult } from '../definitions/markdownDocumentWrite';

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
}): MarkdownFileWriteEdit | null {
  const result = params.markdownService.setPendingRevisionForToolIntent({
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

  if (result.cancelled) return null;
  return {
    operation: params.operation,
    blockId: params.block.blockId,
    ref: params.block.ref,
  };
}

function insertPending(params: {
  readonly markdownService: MarkdownDocumentWriteStore;
  readonly documentId: string;
  readonly anchorBlockId: string | null;
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
      ...(params.anchorBlockId ? { anchorBlockId: params.anchorBlockId } : {}),
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
  readonly annotationAdmission: {
    readonly author: string;
    readonly meta: MarkdownAnnotationMeta;
  };
  readonly touchDocumentUpdatedAt: (documentId: string, updatedAt: number) => void;
  /** Host 的结果凭据必须与正文/pending 同事务；失败整体回滚，不传入任何运行时身份。 */
  readonly commitResult?: (result: MarkdownFileWriteResult) => void;
}): Promise<MarkdownFileWriteResult> {
  // 编译可能等待 worker；读取当前正文必须在等待之后，避免按旧块快照提交修订。
  const planned = await planMarkdownBlocks(params.targetText);
  const content = params.documentStore.getDocument(params.documentId);
  const pendings = params.documentStore.getPendingRevisions(params.documentId);
  // edit_file 的 old_string 来自 citation-aware VFS 文本。写入规划必须复用同一当前视图，
  // 否则持久层里的 UI label（如 `[1]`）会和 Agent 看到的 `[@ref]` 不同，导致未修改的引用块被误写。
  const currentProjection = buildMarkdownCitationReadProjection({
    content,
    pendings,
    viewMode: 'preview',
  });
  const currentBodyProjection = buildMarkdownCitationReadProjection({
    content,
    pendings,
    viewMode: 'preview',
    includeAnnotations: false,
  });
  const currentBlocks: readonly FlattenedMarkdownBlock[] = currentBodyProjection.viewBlocks;
  const targetBlocks = planned.bodyBlocks;
  const targetComparisonBlocks = targetBlocks.map(normalizeMarkdownCitationTokenSpelling);
  const currentText = serializeMarkdownBlocks(currentProjection.viewBlocks);

  const baseline = buildMarkdownCitationReadProjection({
    content, pendings: [], viewMode: 'original', includeAnnotations: false,
  });
  const pendingByBlock = new Map(pendings.map(pending => [pending.target_block_id, pending]));
  const currentByBlock = new Map(currentBlocks.map(block => [block.blockId, block.text]));
  const steps = planMarkdownBlockWrites({
    candidates: baseline.baseBlocks.map(block => ({
      block,
      currentText: currentByBlock.get(block.blockId) ?? block.text,
      pending: pendingByBlock.get(block.blockId),
    })),
    markdown: targetBlocks,
    comparison: targetComparisonBlocks,
  });

  const annotationChanges = planMarkdownFileAnnotationChanges({
    currentDocument: content,
    currentBlocks: baseline.baseBlocks,
    annotationComments: alignMarkdownAnnotationComments(steps, baseline.baseBlocks, planned.annotationComments),
  });

  const writeResult = params.documentStore.runInTransaction(() => {
    const annotationMutation = applyMarkdownAnnotationChanges({
      store: params.documentStore,
      documentId: params.documentId,
      creations: annotationChanges.creations,
      updates: annotationChanges.updates,
      deletions: annotationChanges.deletions,
      author: params.annotationAdmission.author,
      meta: params.annotationAdmission.meta,
    });
    const executed: MarkdownFileWriteEdit[] = [];
    let cancelledCount = 0;
    let anchorBlockId: string | null = null;
    for (const step of steps) {
      if (step.kind === 'insert') {
        const inserted = insertPending({
          markdownService: params.documentStore,
          documentId: params.documentId,
          anchorBlockId,
          markdown: step.markdown,
          toolName: params.toolName,
          extraMeta: params.pendingMetaByMarkdown?.get(step.markdown),
        });
        executed.push(inserted);
        anchorBlockId = inserted.blockId;
        continue;
      }
      const block = step.candidate.block;
      if (step.kind === 'cancel') {
        cancelledCount += params.documentStore.clearPendingRevision(params.documentId, block.blockId);
      } else if (step.kind !== 'retain') {
        const edit = setPending({
          markdownService: params.documentStore,
          documentId: params.documentId,
          block,
          markdown: step.kind === 'delete' ? '' : step.markdown,
          operation: step.kind,
          toolName: params.toolName,
          extraMeta: step.kind === 'update' ? params.pendingMetaByMarkdown?.get(step.markdown) : undefined,
        });
        if (edit) executed.push(edit);
        else cancelledCount += 1;
      }
      if (step.kind !== 'delete') anchorBlockId = block.blockId;
    }

    if (executed.length > 0 || cancelledCount > 0) {
      params.touchDocumentUpdatedAt(params.documentId, Date.now());
    }

    const result: MarkdownFileWriteResult = {
      documentId: params.documentId,
      currentText,
      targetText: planned.blocks.join('\n\n'),
      edits: executed,
      cancelledCount,
      pendingCount: params.documentStore.getPendingRevisions(params.documentId).length,
      createdAnnotationIds: annotationMutation.created.map(item => item.annotation.id),
      updatedAnnotationIds: annotationMutation.updated.map(item => item.annotation.id),
      deletedAnnotationIds: annotationMutation.deleted.map(item => item.annotationId),
    };
    params.commitResult?.(result);
    return result;
  });

  return writeResult;
}
