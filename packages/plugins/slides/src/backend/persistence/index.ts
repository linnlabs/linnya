export { PresentationDraftRepository } from './repositories/PresentationDraftRepository';
export { PresentationRepository } from './repositories/PresentationRepository';
export { toSlidesDraftStatus } from './functions/toSlidesDraftStatus';
export {
  PresentationDraftStaleBaseError,
  PresentationStaleBaseError,
  PresentationStaleSourceError,
} from './definitions/presentationRepository';
export { PRESENTATION_DOCUMENT_SCHEMAS } from './schemas/presentation.schema';
export { PRESENTATION_IMAGE_BINDING_SCHEMAS } from './schemas/presentationImageBinding.schema';
export type {
  PresentationDraftErrorKind,
  PresentationDraftRecord,
  PresentationDraftRepositoryPort,
  PresentationCommitOptions,
  PresentationCommitResult,
  PresentationCreateOptions,
  PresentationDocumentRecord,
  PresentationRepositoryPort,
  PresentationRevisionOrigin,
  PresentationRevisionRecord,
  PresentationTemplateRecord,
} from './definitions/presentationRepository';
