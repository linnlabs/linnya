import { defineStore } from 'pinia';
import { shallowRef } from 'vue';
import type { CanvasPreferences } from '../definitions/canvasPreferences';
import { DEFAULT_CANVAS_PREFERENCES } from '../definitions/canvasPreferences';
export const useCanvasPreferencesStore = defineStore('canvas-preferences', () => {
  const preferences = shallowRef<CanvasPreferences>({ ...DEFAULT_CANVAS_PREFERENCES });
  return {
    preferences,
    replace(value: CanvasPreferences) {
      preferences.value = value;
    },
  };
});
