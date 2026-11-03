import type { DocumentBacklinkSource } from '@app/schemas';
import type { BacklinksPanelPort } from '../definitions/backlinksPanel';
import type { createBacklinksPanelState } from '../store/backlinksPanelState';

export function createBacklinksPanelController(
  scope: { readonly projectId: string; readonly documentId: string },
  store: ReturnType<typeof createBacklinksPanelState>,
  port: BacklinksPanelPort
) {
  let generation = 0;
  async function load(append = false): Promise<void> {
    const previous = store.state.value;
    if (
      previous.phase === 'closed' ||
      (append && (previous.phase === 'loading' || previous.nextOffset === null))
    )
      return;
    const offset = append ? previous.nextOffset : 0;
    if (offset === null) return;
    const ticket = ++generation;
    store.set({ ...previous, phase: 'loading', error: false });
    try {
      const response = await port.list({ ...scope, offset });
      if (generation !== ticket) return;
      store.set({
        ...response,
        documents: append ? [...previous.documents, ...response.documents] : response.documents,
        phase: 'ready',
        error: false,
      });
    } catch {
      if (generation === ticket) store.set({ ...store.state.value, phase: 'failed', error: true });
    }
  }
  const unsubscribe = port.subscribe(() => {
    void load();
  });
  return {
    load,
    async open(source: DocumentBacklinkSource): Promise<void> {
      try {
        await port.open(source);
      } catch {
        if (store.state.value.phase !== 'closed') store.set({ ...store.state.value, error: true });
      }
    },
    close(): void {
      generation++;
      unsubscribe();
      store.set({ ...store.state.value, phase: 'closed', documents: [] });
    },
  };
}
