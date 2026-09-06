import type { HistoryPanelPort, HistoryPanelState } from '../definitions/historyPanel';
import type { createHistoryPanelState } from '../store/historyPanelState';

export function createHistoryPanelController(
  documentId: string,
  store: ReturnType<typeof createHistoryPanelState>,
  port: HistoryPanelPort
) {
  let generation = 0;
  async function load(
    outcome?: 'restored' | 'version_conflict' | 'version_not_found'
  ): Promise<void> {
    const ticket = ++generation;
    const error: HistoryPanelState['error'] = outcome && outcome !== 'restored' ? outcome : null;
    store.set({
      ...store.state.value,
      phase: 'loading',
      error,
      restored: outcome === 'restored',
    });
    try {
      const response = await port.list(documentId);
      if (ticket !== generation) return;
      if (!response.success) {
        store.set({ ...store.state.value, phase: 'ready', error: response.code, selectedId: null });
        return;
      }
      store.set({
        phase: 'ready',
        recent: response.recent,
        earlier: response.earlier,
        selectedId: response.recent[0]?.versionId ?? null,
        error,
        restored: outcome === 'restored',
      });
    } catch {
      if (ticket === generation)
        store.set({
          ...store.state.value,
          phase: 'ready',
          error: 'history_unavailable',
          selectedId: null,
        });
    }
  }
  return {
    load,
    select(versionId: string): void {
      if (store.state.value.phase !== 'ready') return;
      store.set({ ...store.state.value, selectedId: versionId });
    },
    close(): void {
      generation++;
      store.set({
        phase: 'closed',
        recent: [],
        earlier: [],
        selectedId: null,
        error: null,
        restored: false,
      });
    },
    async restore(): Promise<void> {
      const { selectedId, recent, phase } = store.state.value;
      const current = recent[0];
      if (!selectedId || !current || selectedId === current.versionId || phase !== 'ready') return;
      const ticket = ++generation;
      store.set({ ...store.state.value, phase: 'restoring', error: null, restored: false });
      try {
        const response = await port.restore({
          documentId,
          versionId: selectedId,
          expectedCurrentVersionId: current.versionId,
        });
        if (ticket !== generation) return;
        if (response.success) {
          await load('restored');
          return;
        }
        if (response.code === 'version_conflict' || response.code === 'version_not_found') {
          await load(response.code);
          return;
        }
        store.set({ ...store.state.value, phase: 'ready', error: response.code });
      } catch {
        if (ticket === generation)
          store.set({ ...store.state.value, phase: 'ready', error: 'restore_failed' });
      }
    },
  };
}
