import type { DocumentRuntimeLoaderContribution } from '@plugin/renderer/pluginContribution';
import { SLIDES_ACTIVE_DOCUMENT_TYPE } from '@plugin/slides/shared/pluginMeta';
import { useSlidesStore } from '../../store/slidesStore';

export const slidesDocumentRuntimeLoader: DocumentRuntimeLoaderContribution = {
  activeDocumentType: SLIDES_ACTIVE_DOCUMENT_TYPE,
  async load(request) {
    const slidesStore = useSlidesStore();
    const slideNumber = request.parameters?.slideNumber;
    if (typeof slideNumber === 'number' && Number.isFinite(slideNumber) && slideNumber > 0) {
      await slidesStore.openDeckAtSlide(request.documentId, slideNumber);
      return;
    }

    await slidesStore.loadDeck(request.documentId);
  },
};
