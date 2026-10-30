import { makePresentationView } from '../../../../shared/presentationViewSnapshot/testing/viewFixture';
import { useSlidesManualSelectionStore } from '../../manualEditing/selection';
// @vitest-environment jsdom
import { createApp, defineComponent, h, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { describe, expect, it, vi } from 'vitest';
import type { SlidesInsertedObject } from '@plugin/slides/shared';
import { installTestPresentation } from '../../documentRuntime/testing/installTestPresentation';
import { provideManualEditSubmission, type ManualEditIntent, type ManualEditSubmissionPort } from '../../manualEditing/submission';
import { useSlidesElementClipboardStore } from '../store/slidesElementClipboardStore';
import { createElementClipboard } from './useElementClipboard';
import { provideElementClipboard, useElementClipboard } from '../ports/elementClipboard';

const copied: SlidesInsertedObject = { kind: 'shape', editKey: 'badge', geometry: 'rect', fill: '#2563EB', content: '', box: { x: 1, y: 1, w: 2, h: 1 } };
vi.mock('../../../services/slidesApi', () => ({ slidesApi: { copyObjects: vi.fn(async () => [copied]) } }));

function mountClipboard() {
  setActivePinia(createPinia());
  installTestPresentation({ documentId: 'deck', ...makePresentationView('deck', 1) });
  const manualSelection = useSlidesManualSelectionStore();
  const intents: ManualEditIntent[] = [];
  const port: ManualEditSubmissionPort = {
    enqueue: intent => { intents.push(intent); return { clientOperationId: crypto.randomUUID(), settled: new Promise(() => {}) }; },
    flush: async () => {}, refreshPresentation: async () => {},
  };
  let clipboard: ReturnType<typeof useElementClipboard> | undefined;
  const Child = defineComponent({ setup() { clipboard = useElementClipboard(); return () => null; } });
  createApp(defineComponent({ setup() { provideManualEditSubmission(port); provideElementClipboard(createElementClipboard(port)); return () => h(Child); } })).mount(document.createElement('div'));
  if (!clipboard) throw new Error('Clipboard was not mounted');
  return { clipboard, intents, manual: manualSelection };
}

function insertedBoxes(intents: readonly ManualEditIntent[]) {
  return intents.map(intent => intent.operation.op === 'insert_objects' ? intent.operation.objects[0]?.box.x : undefined);
}

describe('useElementClipboard', () => {
  it('cascades repeated pastes instead of stacking them on one spot', async () => {
    const { clipboard, intents } = mountClipboard();
    useSlidesElementClipboardStore().write({ documentId: 'deck', objects: [copied] });
    await nextTick();
    clipboard.paste(); clipboard.paste();
    expect(insertedBoxes(intents)).toEqual([1.2, 1.4]);
  });

  it('duplicates the selection without replacing what the user copied', async () => {
    const { clipboard, intents, manual } = mountClipboard();
    const store = useSlidesElementClipboardStore();
    const earlier = { documentId: 'deck', objects: [{ ...copied, editKey: 'earlier' }] };
    store.write(earlier);
    manual.selectTargets([{ elementId: 'badge', nodeKind: 'shape', targetKind: 'shape', capabilities: ['copy'], authoringRef: { slideKey: 'overview', editKey: 'badge' }, authoringAncestorRefs: [], bounds: { x: 1, y: 1, w: 2, h: 1 }, polygon: [], translationElementIds: ['badge'] }]);
    await clipboard.duplicate();
    expect(insertedBoxes(intents)).toEqual([1.2]);
    expect(store.content).toBe(earlier);
  });
});
