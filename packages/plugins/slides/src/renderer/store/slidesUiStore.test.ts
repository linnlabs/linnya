import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useSlidesUiStore } from './slidesUiStore';

describe('slidesUiStore source selection mode', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('keeps source element selection mode off until the user explicitly enables it', () => {
    const store = useSlidesUiStore();

    expect(store.sourceSelectionModeEnabled).toBe(false);

    store.toggleSourceSelectionMode();
    expect(store.sourceSelectionModeEnabled).toBe(true);

    store.setSourceSelectionModeEnabled(false);
    expect(store.sourceSelectionModeEnabled).toBe(false);
  });

  it('resets source element selection mode when deck UI state is reset', () => {
    const store = useSlidesUiStore();
    store.setSourceSelectionModeEnabled(true);

    store.$reset();

    expect(store.sourceSelectionModeEnabled).toBe(false);
  });
});
