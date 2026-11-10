import { expect, it, vi } from 'vitest';
import type { DocumentBacklinksPage } from '@app/schemas';
import type { BacklinksPanelPort } from '../definitions/backlinksPanel';
import { createBacklinksPanelController } from '../orchestration/createBacklinksPanelController';
import { createBacklinksPanelState } from '../store/backlinksPanelState';
const first: DocumentBacklinksPage = {
  referenceCount: 3,
  documentCount: 2,
  documents: [
    { sourceDocumentId: 'source', title: 'Source', nodeType: 'document', referenceCount: 2 },
  ],
  nextOffset: 1,
};
it('loads grouped pages and refreshes from the first page on mutation, ignoring stale and closed reads', async () => {
  let changed: (() => void) | undefined;
  const unsubscribed = vi.fn();
  const port: BacklinksPanelPort = {
    list: vi.fn(async () => first),
    open: vi.fn(async () => {}),
    subscribe(listener) {
      changed = listener;
      return unsubscribed;
    },
  };
  const store = createBacklinksPanelState();
  const controller = createBacklinksPanelController(
    { projectId: 'project', documentId: 'target' },
    store,
    port
  );
  await controller.load();
  expect(store.state.value.documents).toHaveLength(1);
  vi.mocked(port.list).mockResolvedValueOnce({
    ...first,
    documents: [
      { sourceDocumentId: 'second', title: 'Second', nodeType: 'slides', referenceCount: 1 },
    ],
    nextOffset: null,
  });
  await controller.load(true);
  expect(port.list).toHaveBeenLastCalledWith({
    projectId: 'project',
    documentId: 'target',
    offset: 1,
  });
  expect(store.state.value.documents).toHaveLength(2);
  let delayed: ((value: DocumentBacklinksPage) => void) | undefined;
  vi.mocked(port.list).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        delayed = resolve;
      })
  );
  const old = controller.load();
  changed?.();
  await Promise.resolve();
  expect(store.state.value.documents).toEqual(first.documents);
  delayed?.({ ...first, documents: [] });
  await old;
  expect(store.state.value.documents).toEqual(first.documents);
  let closing: ((value: DocumentBacklinksPage) => void) | undefined;
  vi.mocked(port.list).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        closing = resolve;
      })
  );
  const pending = controller.load();
  controller.close();
  closing?.(first);
  await pending;
  expect(store.state.value.phase).toBe('closed');
  expect(store.state.value.documents).toEqual([]);
  expect(unsubscribed).toHaveBeenCalledOnce();
});
