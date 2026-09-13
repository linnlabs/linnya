export { PresentationDraftRepository } from './repositories/PresentationDraftRepository';
export { PresentationRepository } from './repositories/PresentationRepository';
export { toSlidesDraftStatus } from './functions/toSlidesDraftStatus';
export {
  PresentationDraftConflictError,
  PresentationDraftStaleBaseError,
  PresentationManualEditCommandConflictError,
  PresentationStaleBaseError,
  PresentationStaleSourceError,
} from './definitions/presentationRepository';
export { PRESENTATION_DOCUMENT_SCHEMAS } from './schemas/presentation.schema';
export { PRESENTATION_IMAGE_BINDING_SCHEMAS } from './schemas/presentationImageBinding.schema';
export type {
  PresentationDraftErrorKind,
  PresentationDraftRecord,
  PresentationDraftRepositoryPort,
  PresentationManualEditReceiptRecord,
  PresentationCommitOptions,
  PresentationCommitResult,
  PresentationCreateOptions,
  PresentationDocumentIdentity,
  PresentationDocumentRecord,
  PresentationPreviewSourceRecord,
  PresentationRepositoryPort,
  PresentationRevisionOrigin,
  PresentationRevisionRecord,
  PresentationTemplateRecord,
} from './definitions/presentationRepository';
