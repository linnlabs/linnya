import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useSlidesStore } from '../features/documentRuntime';
import { useSlidesDocumentRuntime } from '../features/documentRuntime/orchestration/useSlidesDocumentRuntime';
import { makePresentationView } from '../../shared/presentationViewSnapshot/testing/viewFixture';

const read = vi.hoisted(() => vi.fn());
vi.mock('../features/documentRuntime/orchestration/readPresentationView', () => ({ readPresentationView: read }));
vi.mock('@plugin/renderer/workspaceRuntime', () => ({ notifyWorkspaceDocumentOpened: vi.fn(async () => ({ success: true })) }));
function candidate(id = 'deck', revision = 1, count = 3) {
  return { installed: makePresentationView(id, revision, count), blocks: new Map(), pages: new Map() };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

describe('document snapshot installation', () => {
  beforeEach(() => { setActivePinia(createPinia()); read.mockReset(); });
  it('installs navigation and model together, preserving the latest user selection during refresh', async () => {
    const next = deferred<ReturnType<typeof candidate>>();
    read.mockResolvedValueOnce(candidate()).mockReturnValueOnce(next.promise);
    const runtime = useSlidesDocumentRuntime(); const store = useSlidesStore();
    await runtime.loadDeck('deck');
    const refresh = runtime.refreshDeck('deck', 2);
    store.setCurrentSlide(2);
    expect(store.renderModel?.version).toBe(1);
    expect(store.deckPreview?.versionNumber).toBe(1);
    next.resolve(candidate('deck', 2)); await refresh;
    expect(store.renderModel?.version).toBe(2);
    expect(store.deckPreview?.versionNumber).toBe(2);
    expect(store.documentBuildState?.versionNumber).toBe(2);
    expect(store.currentSlideIndex).toBe(2);
  });
  it('keeps the complete view after refresh failure and retries only the read', async () => {
    read.mockResolvedValueOnce(candidate()).mockRejectedValueOnce(new Error('Read failed')).mockResolvedValueOnce(candidate('deck', 2));
    const runtime = useSlidesDocumentRuntime(); const store = useSlidesStore();
    await runtime.loadDeck('deck');
    await expect(runtime.refreshDeck('deck', 2)).rejects.toThrow('Read failed');
    expect(store.renderModel?.version).toBe(1); expect(store.deckError).toBeNull();
    await runtime.refreshDeck('deck', 2); expect(store.renderModel?.version).toBe(2);
  });
  it('coalesces version events with command refreshes after a complete revision is installed', async () => {
    const next = deferred<ReturnType<typeof candidate>>();
    read.mockResolvedValueOnce(candidate()).mockReturnValueOnce(next.promise);
    const runtime = useSlidesDocumentRuntime(); await runtime.loadDeck('deck');
    const first = runtime.refreshDeck('deck', 2); const second = runtime.refreshDeck('deck', 2);
    next.resolve(candidate('deck', 2)); await Promise.all([first, second]);
    await runtime.refreshDeck('deck', 2); expect(read).toHaveBeenCalledTimes(2);
  });
  it('does not let an old A response overwrite a later A visit', async () => {
    const old = deferred<ReturnType<typeof candidate>>();
    read.mockResolvedValueOnce(candidate('a')).mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(candidate('b')).mockResolvedValueOnce(candidate('a', 3));
    const runtime = useSlidesDocumentRuntime(); const store = useSlidesStore();
    await runtime.loadDeck('a'); const pending = runtime.refreshDeck('a', 2);
    await runtime.loadDeck('b'); await runtime.loadDeck('a');
    old.resolve(candidate('a', 2)); await pending;
    expect(store.documentBuildState?.versionNumber).toBe(3);
  });
  it('opens at the requested page and accepts a draft update on the same compiled base', async () => {
    const ready = candidate(); const draft = candidate();
    draft.installed = { ...draft.installed, preview: null, renderModel: null,
      buildState: { ...ready.installed.buildState, state: 'draft', draftStatus: {
        baseVersionId: 'v1', baseVersionNumber: 1, updatedAt: 1, errorSummary: 'Invalid source' } } };
    read.mockResolvedValueOnce(ready).mockResolvedValueOnce(draft);
    const runtime = useSlidesDocumentRuntime(); const store = useSlidesStore();
    await runtime.openDeckAtSlide('deck', 3); expect(store.currentSlideIndex).toBe(2);
    await runtime.refreshDeck('deck'); expect(store.documentBuildState?.state).toBe('draft');
    expect(store.renderModel).toBeNull(); expect(store.deckPreview).toBeNull();
  });
  it('waits for command ownership when an event arrives before the receipt, then selects the new page in the installation', async () => {
    read.mockResolvedValueOnce(candidate()).mockResolvedValueOnce(candidate('deck', 2, 4));
    const runtime = useSlidesDocumentRuntime(); const store = useSlidesStore(); await runtime.loadDeck('deck');
    const confirm = runtime.prepareStructureSelection(3, 1);
    const refresh = runtime.refreshDeck('deck', 2);
    await Promise.resolve(); expect(store.renderModel?.version).toBe(1);
    confirm(2);
    await refresh; expect(store.currentSlideIndex).toBe(3); expect(store.renderModel?.version).toBe(2);
  });
  it('does not override an explicit page choice made while a structure command is saving', async () => {
    read.mockResolvedValueOnce(candidate()).mockResolvedValueOnce(candidate('deck', 2, 4));
    const runtime = useSlidesDocumentRuntime(); const store = useSlidesStore(); await runtime.loadDeck('deck');
    const confirm = runtime.prepareStructureSelection(3, 1); const refresh = runtime.refreshDeck('deck', 2);
    store.setCurrentSlide(1);
    confirm(2);
    await refresh; expect(store.currentSlideIndex).toBe(1);
  });
});
