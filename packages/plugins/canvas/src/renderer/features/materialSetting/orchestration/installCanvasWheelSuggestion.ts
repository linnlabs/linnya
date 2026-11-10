import { useCanvasPreferencesStore } from '../store/canvasPreferencesStore';
import { createCanvasWheelSuggestionState } from '../store/createCanvasWheelSuggestionState';
import {
  canvasMouseWheelEvidence,
  type CanvasMouseWheelEvidence,
} from '../functions/canvasMouseWheelEvidence';

export function installCanvasWheelSuggestion(host: HTMLElement) {
  const store = useCanvasPreferencesStore(),
    state = createCanvasWheelSuggestionState();
  let evidence: CanvasMouseWheelEvidence | null = null;
  const wheel = (event: WheelEvent) => {
    if (store.preferences.wheelSuggestionSeen || store.preferences.wheelZoom) return;
    evidence = canvasMouseWheelEvidence(evidence, event);
    if (!evidence || evidence.count < 3) return;
    store.replace({ ...store.preferences, wheelSuggestionSeen: true });
    state.show();
  };
  host.addEventListener('wheel', wheel, { passive: true });
  return {
    state,
    enable() {
      store.replace({ ...store.preferences, wheelZoom: true });
      state.hide();
    },
    dismiss: state.hide,
    dispose() {
      host.removeEventListener('wheel', wheel);
      state.hide();
    },
  };
}
