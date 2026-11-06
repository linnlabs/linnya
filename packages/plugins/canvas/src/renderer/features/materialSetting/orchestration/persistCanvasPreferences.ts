import { watch } from 'vue';
import { CanvasPreferencesSchema } from '../definitions/canvasPreferences';
import { useCanvasPreferencesStore } from '../store/canvasPreferencesStore';

const storageKey = 'linnya.canvas.preferences.v1';
export function persistCanvasPreferences(): () => void {
  const store = useCanvasPreferencesStore();
  const saved = localStorage.getItem(storageKey);
  if (saved !== null) store.replace(CanvasPreferencesSchema.parse(JSON.parse(saved)));
  return watch(
    () => store.preferences,
    value => localStorage.setItem(storageKey, JSON.stringify(value)),
    { flush: 'sync' }
  );
}
