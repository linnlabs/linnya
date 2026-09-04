export {
  resolveMarkdownAnnotationTarget,
  type ResolveBlockIdResult,
  type ResolveParams as ResolveMarkdownAnnotationTargetParams,
} from './functions/resolveMarkdownAnnotationTarget';
export {
  appendMarkdownAnnotations,
  type MarkdownAnnotationInsertion,
} from './functions/appendMarkdownAnnotations';
export {
  applyMarkdownAnnotationMutations,
  type MarkdownAnnotationDeletion,
  type MarkdownAnnotationUpdate,
} from './functions/applyMarkdownAnnotationMutations';
export {
  planMarkdownFileAnnotationChanges,
  type MarkdownFileAnnotationChangePlan,
} from './functions/planMarkdownFileAnnotationChanges';
export {
  applyMarkdownAnnotationChanges,
  type ApplyMarkdownAnnotationChangesResult,
  type MarkdownAnnotationMutationStore,
} from './orchestration/applyMarkdownAnnotationChanges';
export {
  createMarkdownAnnotations,
  type CreateMarkdownAnnotationsResult,
  type CreatedMarkdownAnnotation,
  type MarkdownAnnotationCreationDraft,
  type MarkdownAnnotationCreationStore,
} from './orchestration/createMarkdownAnnotations';
