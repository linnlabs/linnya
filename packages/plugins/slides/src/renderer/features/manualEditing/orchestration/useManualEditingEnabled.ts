import { computed } from 'vue';
import { useSlidesStore } from '../../documentRuntime';
import { resolveManualEditingAvailability } from '../functions/manualEditingAvailability';

export function useManualEditingEnabled() {
  const slides = useSlidesStore();
  return computed(() => resolveManualEditingAvailability({
    buildState: slides.documentBuildState,
    renderModel: slides.renderModel,
    currentSlide: slides.currentSlide,
  }).available);
}
