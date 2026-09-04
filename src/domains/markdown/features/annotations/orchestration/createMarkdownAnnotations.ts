import type { MarkdownAnnotationMeta } from '@app/schemas';
import {
  applyMarkdownAnnotationChanges,
  type CreatedMarkdownAnnotation,
  type MarkdownAnnotationCreationDraft,
  type MarkdownAnnotationMutationStore,
} from './applyMarkdownAnnotationChanges';

export type MarkdownAnnotationCreationStore = MarkdownAnnotationMutationStore;

export interface CreateMarkdownAnnotationsResult {
  readonly documentId: string;
  readonly version: ReturnType<MarkdownAnnotationCreationStore['getLatestVersion']>;
  readonly created: readonly CreatedMarkdownAnnotation[];
}

/** 创建专用门面；实体规则与事务提交由 Annotation 增删改统一入口拥有。 */
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
  const result = applyMarkdownAnnotationChanges({
    store: params.store,
    documentId: params.documentId,
    creations: params.drafts,
    updates: [],
    deletions: [],
    author: params.author,
    meta: params.meta,
    ...(params.expectedDocumentVersion !== undefined
      ? { expectedDocumentVersion: params.expectedDocumentVersion }
      : {}),
    ...(params.createId ? { createId: params.createId } : {}),
    ...(params.now ? { now: params.now } : {}),
  });
  return {
    documentId: result.documentId,
    version: result.version,
    created: result.created,
  };
}

export type {
  CreatedMarkdownAnnotation,
  MarkdownAnnotationCreationDraft,
} from './applyMarkdownAnnotationChanges';
