import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useKnowledgeGraphProgress } from '../runtime';

const api = vi.hoisted(() => ({
  getKbGraphProgress: vi.fn<(id: string) => Promise<unknown>>(async id => ({ kbId: id, percent: 42.4, totalUnits: 12.9, doneUnits: 5.8, updatedAtSeconds: 10 })),
  onKbGraphProgressUpdated: vi.fn<(callback: (payload: unknown) => void) => (() => void) | null>(),
}));
vi.mock('../../../services/knowledgeBaseService', () => ({ knowledgeBaseService: api }));

describe('knowledge graph progress runtime', () => {
  let listener: (payload: unknown) => void;
  const unsubscribe = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-11T00:00:00Z'));
    vi.clearAllMocks(); setActivePinia(createPinia());
    api.onKbGraphProgressUpdated.mockImplementation(callback => { listener = callback; return unsubscribe; });
  });
  afterEach(() => { useKnowledgeGraphProgress().cleanup(); vi.useRealTimers(); });

  it('shares one subscription between list and details, and commits normalized push facts', () => {
    const list = useKnowledgeGraphProgress(), details = useKnowledgeGraphProgress();
    list.ensureSubscribed(); details.ensureSubscribed();
    expect(api.onKbGraphProgressUpdated).toHaveBeenCalledTimes(1);
    listener({ kbId: 'kb-1', percent: 100.6, totalUnits: 12.9, doneUnits: 15.8, updatedAtSeconds: null });
    expect(details.getProgress(' kb-1 ')).toEqual({ kbId: 'kb-1', percent: 100, totalUnits: 12, doneUnits: 15, updatedAtSeconds: null });
    expect(details.percentByKbId['kb-1']).toBe(100);
    list.cleanup(); details.cleanup();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    details.ensureSubscribed();
    expect(api.onKbGraphProgressUpdated).toHaveBeenCalledTimes(2);
  });

  it('deduplicates IDs and retains the existing 30-second prefetch window', async () => {
    const runtime = useKnowledgeGraphProgress();
    await runtime.prefetchForKbIds([' kb-1 ', 'kb-1', 'kb-2', '']);
    expect(api.getKbGraphProgress.mock.calls).toEqual([['kb-1'], ['kb-2']]);
    expect(runtime.getProgress('kb-1')).toMatchObject({ percent: 42, totalUnits: 12, doneUnits: 5 });
    await runtime.prefetchForKbIds(['kb-1']);
    expect(api.getKbGraphProgress).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(30_000);
    await runtime.prefetchForKbIds(['kb-1']);
    expect(api.getKbGraphProgress).toHaveBeenCalledTimes(3);
  });

  it('does not overwrite known progress or mark a fetch successful for unavailable/malformed results', async () => {
    const runtime = useKnowledgeGraphProgress();
    await runtime.fetchKbProgress('kb-1');
    api.getKbGraphProgress.mockResolvedValueOnce(null).mockResolvedValueOnce({ kbId: 'kb-1', percent: '99' });
    expect(await runtime.fetchKbProgress('kb-1')).toBeNull();
    expect(await runtime.fetchKbProgress('kb-1')).toBeNull();
    expect(runtime.getProgress('kb-1')?.percent).toBe(42);
  });
});
