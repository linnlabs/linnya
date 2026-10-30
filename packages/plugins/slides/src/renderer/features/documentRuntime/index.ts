export {
  createActiveDeckRefreshCoordinator,
  type ActiveDeckRefreshCoordinator,
  type ActiveDeckRefreshCoordinatorPorts,
  type ActiveDeckRefreshRequest,
} from './orchestration/createActiveDeckRefreshCoordinator';

export { slidesFileHandler } from './fileHandler';
export { registerSlidesDocumentSaveParticipant, saveSlidesDocument } from './ports/documentSaveParticipant';

export { useSlidesDocumentRuntime } from './orchestration/useSlidesDocumentRuntime';

export { useSlidesStore } from './store/slidesDocumentStore';
export { usePresentedFrame } from './orchestration/usePresentedFrame';
export type { PresentationFrame } from './definitions/documentPresentation';
