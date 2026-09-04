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
import {
  applyMarkdownAnnotationMutations,
  type MarkdownAnnotationDeletion,
  type MarkdownAnnotationUpdate,
} from '../functions/applyMarkdownAnnotationMutations';

export interface MarkdownAnnotationCreationDraft {
  readonly blockId: string;
  readonly content: string;
}

export interface MarkdownAnnotationMutationStore {
  getDocument(documentId: string): MarkdownDocJson;
  getLatestVersion(documentId: string): DocumentVersion | null;
  updateDocument(documentId: string, content: MarkdownDocJson): DocumentVersion;
  runInTransaction<T>(fn: () => T): T;
}

export interface CreatedMarkdownAnnotation extends MarkdownAnnotationCreationDraft {
  readonly annotation: MarkdownAnnotation;
}

export interface ApplyMarkdownAnnotationChangesResult {
  readonly documentId: string;
  readonly version: DocumentVersion | null;
  readonly created: readonly CreatedMarkdownAnnotation[];
  readonly updated: readonly MarkdownAnnotationUpdate[];
  readonly deleted: readonly MarkdownAnnotationDeletion[];
}

/** Annotation 增删改的后端统一入口；整批变化只提交一个文档版本。 */
export function applyMarkdownAnnotationChanges(params: {
  readonly store: MarkdownAnnotationMutationStore;
  readonly documentId: string;
  readonly creations: readonly MarkdownAnnotationCreationDraft[];
  readonly updates: readonly MarkdownAnnotationUpdate[];
  readonly deletions: readonly MarkdownAnnotationDeletion[];
  readonly author: string;
  readonly meta: MarkdownAnnotationMeta;
  readonly expectedDocumentVersion?: number;
  readonly createId?: () => string;
  readonly now?: () => string;
}): ApplyMarkdownAnnotationChangesResult {
  return params.store.runInTransaction(() => {
    const latestVersion = params.store.getLatestVersion(params.documentId);
    if (!latestVersion) throw new Error(`文档不存在: ${params.documentId}`);
    if (params.expectedDocumentVersion !== undefined) {
      assertExpectedMarkdownDocumentVersion({
        expected: params.expectedDocumentVersion,
        actual: latestVersion.version_number,
      });
    }

    const hasChanges = params.creations.length > 0
      || params.updates.length > 0
      || params.deletions.length > 0;
    if (!hasChanges) {
      return {
        documentId: params.documentId,
        version: null,
        created: [],
        updated: [],
        deleted: [],
      };
    }

    const timestamp = (params.now ?? (() => new Date().toISOString()))();
    const createId = params.createId ?? generateEditorAnnotationId;
    const created = params.creations.map(draft => ({
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
    const updatedDocument = applyMarkdownAnnotationMutations({
      document,
      insertions: created.map(item => ({ blockId: item.blockId, annotation: item.annotation })),
      updates: params.updates,
      deletions: params.deletions,
    });
    const version = params.store.updateDocument(params.documentId, updatedDocument);

    return {
      documentId: params.documentId,
      version,
      created,
      updated: params.updates,
      deleted: params.deletions,
    };
  });
}
