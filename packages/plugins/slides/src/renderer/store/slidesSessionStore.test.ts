import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useSlidesSessionStore } from './slidesSessionStore';

describe('slidesSessionStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('tracks transient slide workflows and resets them together', () => {
    const store = useSlidesSessionStore();

    store.startGenerating();
    store.startInspecting();
    store.startRepairing();
    store.markDiagnosticsRefreshed();

    expect(store.isGenerating).toBe(true);
    expect(store.isInspecting).toBe(true);
    expect(store.isRepairing).toBe(true);
    expect(store.lastDiagnosticsRefresh).toEqual(expect.any(Number));

    store.$reset();

    expect(store.isGenerating).toBe(false);
    expect(store.isInspecting).toBe(false);
    expect(store.isRepairing).toBe(false);
    expect(store.lastDiagnosticsRefresh).toBeNull();
  });
});
