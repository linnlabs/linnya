// @vitest-environment jsdom
import { createApp, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { SlidesIpcError } from '@plugin/slides/shared/ipc';
import SlidesView from './SlidesView.vue';
import { useSlidesStore } from '../features/documentRuntime';
import { useSlidesManualEditingStore, useManualEditSubmission } from '../features/manualEditing';
import { useSlidesDocumentRuntime } from '../features/documentRuntime';
import { makePresentationView } from '../../shared/presentationViewSnapshot/testing/viewFixture';
const read = vi.hoisted(() => vi.fn());
const submit = vi.hoisted(() => vi.fn());
vi.mock('../features/documentRuntime/orchestration/readPresentationView', () => ({ readPresentationView: read }));
vi.mock('../services/slidesApi', () => ({ slidesApi: { submitManualEdit: submit } }));
vi.mock('../features/deckNavigator', () => ({ useSlideThumbnails: vi.fn() }));
vi.mock('@plugin/renderer/workspaceRuntime', () => ({
  getActiveFileSession: () => ({ documentId: 'deck', type: 'presentation' }), markActiveFileDirty: vi.fn(),
  notifyWorkspaceDocumentOpened: vi.fn(async () => ({ success: true })),
}));
vi.mock('../ui/deck/DeckViewer.vue', () => ({ default: {
  setup: () => ({ enqueue: useManualEditSubmission().enqueue }),
  template: `<button @click="enqueue({ operation: { op: 'translate_by', target: { slideKey: 'overview', editKey: 'hero' }, targetKind: 'image', delta: { dx: 0.2, dy: 0 } } })" /><button class="duplicate" @click="enqueue({ operation: { op: 'duplicate_slide', index: 0 } })" />`,
} }));
vi.mock('../ui/shared/SlidesStatusState.vue', () => ({ default: { template: '<div />' } }));
let app: App | null = null;
async function flush() { for (let i = 0; i < 8; i++) { await Promise.resolve(); await nextTick(); } }
function candidate(revision: number) { return { installed: makePresentationView('deck', revision), blocks: new Map(), pages: new Map() }; }
function mount() { const host = document.createElement('div'); document.body.append(host); app = createApp(SlidesView); app.mount(host); return host; }
beforeEach(() => { setActivePinia(createPinia()); read.mockReset(); submit.mockReset(); });
afterEach(() => { app?.unmount(); app = null; document.body.innerHTML = ''; });

it('uses a preloaded complete snapshot and dispatches the next edit only after the committed frame', async () => {
  read.mockResolvedValueOnce(candidate(1)).mockResolvedValueOnce(candidate(2)).mockResolvedValueOnce(candidate(3));
  let confirm!: (value: unknown) => void;
  submit.mockImplementationOnce(() => new Promise(resolve => { confirm = resolve; }))
    .mockImplementationOnce(async command => ({ status: 'committed', commandId: command.commandId, documentId: 'deck', revisionId: 'v3', revision: 3, history: { revisionId: 'v3', undoDepth: 1, redoDepth: 0 } }));
  await useSlidesDocumentRuntime().loadDeck('deck');
  const host = mount(); host.querySelector('button')?.click(); host.querySelector('button')?.click(); await flush();
  expect(submit).toHaveBeenCalledTimes(1);
  const first = submit.mock.calls[0][0];
  confirm({ status: 'committed', commandId: first.commandId, documentId: 'deck', revisionId: 'v2', revision: 2, history: { revisionId: 'v2', undoDepth: 1, redoDepth: 0 } });
  await flush();
  expect(useSlidesStore().renderModel?.version).toBe(2); expect(submit).toHaveBeenCalledTimes(1);
  useSlidesManualEditingStore().recordPresentedRevision(2); await flush();
  expect(submit).toHaveBeenCalledTimes(2); expect(submit.mock.calls[1][0].expectedBase.revision).toBe(2);
});

it('keeps a committed operation and the old complete view when refreshing fails, then reads without resubmitting', async () => {
  read.mockResolvedValueOnce(candidate(1)).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(candidate(2));
  submit.mockImplementation(async command => ({ status: 'committed', commandId: command.commandId, documentId: 'deck', revisionId: 'v2', revision: 2, history: { revisionId: 'v2', undoDepth: 1, redoDepth: 0 } }));
  await useSlidesDocumentRuntime().loadDeck('deck'); const host = mount(); host.querySelector('button')?.click(); await flush();
  const manual = useSlidesManualEditingStore();
  expect(manual.submission.phase).toBe('awaiting_frame'); expect(manual.errorMessage).toBeTruthy();
  expect(useSlidesStore().renderModel?.version).toBe(1);
  await useSlidesDocumentRuntime().refreshDeck('deck', 2); manual.recordPresentedRevision(2); await flush();
  expect(manual.submission.phase).toBe('idle'); expect(submit).toHaveBeenCalledTimes(1);
});

it('keeps one structure selection intent across an explicitly retryable failure', async () => {
  read.mockResolvedValueOnce(candidate(1)).mockResolvedValueOnce(candidate(2));
  const runtime = useSlidesDocumentRuntime();
  let confirm!: (value: unknown) => void;
  submit.mockImplementationOnce(async () => {
    void runtime.refreshDeck('deck', 2);
    throw new SlidesIpcError('busy', 'busy', true);
  }).mockImplementationOnce(() => new Promise(resolve => { confirm = resolve; }));
  await runtime.loadDeck('deck'); const host = mount(); host.querySelector<HTMLElement>('.duplicate')?.click(); await flush();
  expect(useSlidesStore().renderModel?.version).toBe(1);
  expect(submit).toHaveBeenCalledTimes(2);
  expect(submit.mock.calls[0][0].commandId).toBe(submit.mock.calls[1][0].commandId);
  const command = submit.mock.calls[1][0];
  confirm({ status: 'committed', commandId: command.commandId, documentId: 'deck', revisionId: 'v2', revision: 2, history: { revisionId: 'v2', undoDepth: 1, redoDepth: 0 } });
  await flush(); expect(useSlidesStore().renderModel?.version).toBe(2); expect(useSlidesStore().currentSlideIndex).toBe(1);
});
