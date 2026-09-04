import {
  createMarkdownAnnotation,
  type MarkdownAnnotation,
  type MarkdownAnnotationMeta,
} from '@app/schemas';
import { generateEditorAnnotationId } from '../../../../../shared/utils/idUtils';
import {
  assertExpectedMarkdownDocumentVersion,
  type DocumentVersion,
} from '../../document-storage';
import type { MarkdownDocJson } from '../../normalization/runtime';
import { appendMarkdownAnnotations } from '../functions/appendMarkdownAnnotations';

export interface MarkdownAnnotationCreationDraft {
  readonly blockId: string;
  readonly content: string;
}

export interface MarkdownAnnotationCreationStore {
  getDocument(documentId: string): MarkdownDocJson;
  getLatestVersion(documentId: string): DocumentVersion | null;
  updateDocument(documentId: string, content: MarkdownDocJson): DocumentVersion;
  runInTransaction<T>(fn: () => T): T;
}

export interface CreatedMarkdownAnnotation extends MarkdownAnnotationCreationDraft {
  readonly annotation: MarkdownAnnotation;
}

export interface CreateMarkdownAnnotationsResult {
  readonly documentId: string;
  readonly version: DocumentVersion | null;
  readonly created: readonly CreatedMarkdownAnnotation[];
}

/**
 * Markdown domain 内唯一的批注创建用例。
 *
 * 不论请求来自 Review 工具还是 file-style write，都必须在这里统一建立业务身份、
 * 固定 confirmed 初态，并把整批批注写进同一个文档版本。
 */
export function createMarkdownAnnotations(params: {
  readonly store: MarkdownAnnotationCreationStore;
  readonly documentId: string;
  readonly drafts: readonly MarkdownAnnotationCreationDraft[];
  readonly author: string;
  readonly meta: MarkdownAnnotationMeta;
  readonly expectedDocumentVersion?: number;
  readonly createId?: () => string;
  readonly now?: () => string;
}): CreateMarkdownAnnotationsResult {
  return params.store.runInTransaction(() => {
    const latestVersion = params.store.getLatestVersion(params.documentId);
    if (!latestVersion) {
      throw new Error(`文档不存在: ${params.documentId}`);
    }
    if (params.expectedDocumentVersion !== undefined) {
      assertExpectedMarkdownDocumentVersion({
        expected: params.expectedDocumentVersion,
        actual: latestVersion.version_number,
      });
    }
    if (params.drafts.length === 0) {
      return { documentId: params.documentId, version: null, created: [] };
    }

    const timestamp = (params.now ?? (() => new Date().toISOString()))();
    const createId = params.createId ?? generateEditorAnnotationId;
    const created = params.drafts.map(draft => ({
      ...draft,
      annotation: createMarkdownAnnotation({
        id: createId(),
        content: draft.content,
        author: params.author,
        timestamp,
        meta: params.meta,
      }),
    }));
    const document = params.store.getDocument(params.documentId);
    const updated = appendMarkdownAnnotations(
      document,
      created.map(item => ({ blockId: item.blockId, annotation: item.annotation })),
    );
    const version = params.store.updateDocument(params.documentId, updated);

    return { documentId: params.documentId, version, created };
  });
}
