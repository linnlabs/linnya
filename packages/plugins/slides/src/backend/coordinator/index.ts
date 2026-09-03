export { PptCoordinator } from './PptCoordinator';
export type { PptCoordinatorRuntimeOptions } from './PptCoordinator';
export { createPptCoordinator } from './createPptCoordinator';
export {
  activateSharedPptCoordinatorRuntime,
  deactivateSharedPptCoordinatorRuntime,
  getSharedPptCoordinator,
} from './sharedPptCoordinator';
export type {
  GeneratePresentationOptions,
  GeneratePresentationResult,
  RestorePresentationRevisionResult,
  PresentationDocumentRecord,
  PresentationRepositoryPort,
  TemplateManagerPort,
  WorkspacePresentationPort,
} from './types';
export type {
  PresentationInspectionRequest,
  PresentationInspectionSelection,
} from '@plugin/slides/shared';
export type { PresentationInspectionResult } from '../features/presentationInspection';
export type {
  PresentationScreenshotRequest,
  PresentationScreenshotResult,
  PresentationScreenshotSlide,
  PresentationScreenshotSelection,
} from '../features/presentationScreenshot';
