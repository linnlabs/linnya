import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useSlidesUiStore } from './slidesUiStore';

describe('slidesUiStore deck view', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('resets the grid view and filmstrip visibility with deck UI state', () => {
    const store = useSlidesUiStore();
    store.setDeckViewMode('grid');
    store.toggleFilmstrip();

    store.$reset();

    expect(store.deckViewMode).toBe('slide');
    expect(store.filmstripCollapsed).toBe(false);
  });
});
