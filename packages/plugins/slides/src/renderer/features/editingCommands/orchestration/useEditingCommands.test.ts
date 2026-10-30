import { makePresentationView } from '../../../../shared/presentationViewSnapshot/testing/viewFixture';
import { useSlidesManualSelectionStore } from '../../manualEditing/selection';
// @vitest-environment jsdom
import { createApp, defineComponent, h, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { describe, expect, it, vi } from 'vitest';
import { installTestPresentation } from '../../documentRuntime/testing/installTestPresentation';
import { useSlidesStore } from '../../documentRuntime';
import { provideManualEditSubmission, useSlidesManualSubmissionStore, type ManualEditSettlement, type ManualEditSubmissionPort } from '../../manualEditing/submission';
import { createEditingCommands } from './useEditingCommands';
import { provideEditingCommands, useEditingCommands } from '../ports/editingCommands';

function mountCommands(port: ManualEditSubmissionPort) {
  let commands: ReturnType<typeof useEditingCommands> | undefined;
  const Child = defineComponent({ setup() { commands = useEditingCommands(); return () => null; } });
  const app = createApp(defineComponent({ setup() { provideManualEditSubmission(port); provideEditingCommands(createEditingCommands(port)); return () => h(Child); } }));
  app.mount(document.createElement('div'));
  if (!commands) throw new Error('Commands were not mounted');
  return { commands, unmount: () => app.unmount() };
}

describe('useEditingCommands history', () => {
  it('撤销呈现后跳到受影响的页，并请求重新选中受影响对象', async () => {
    setActivePinia(createPinia());
    const view = makePresentationView('deck', 2);
    if (!view.renderModel) throw new Error('Missing model fixture');
    const first = view.renderModel.slides[0];
    if (!first) throw new Error('Missing page fixture');
    installTestPresentation({ documentId: 'deck', ...view, renderModel: { ...view.renderModel, slides: Array.from({ length: 8 }, (_, index) => ({ ...first, slideId: `s${index}`, index })) } });
    const slides = useSlidesStore();
    const manual = useSlidesManualSubmissionStore();
  const manualSelection = useSlidesManualSelectionStore();
      manual.setHistory({ revisionId: 'v2', undoDepth: 1, redoDepth: 0 });
    slides.setCurrentSlide(6);
    let settle: (value: ManualEditSettlement) => void = () => {};
    const port: ManualEditSubmissionPort = {
      enqueue: vi.fn(() => ({ clientOperationId: 'undo', settled: new Promise<ManualEditSettlement>(resolve => { settle = resolve; }) })),
      flush: vi.fn(async () => {}),
      refreshPresentation: vi.fn(async () => {}),
    };
    const { commands, unmount } = mountCommands(port);
    const running = commands.runHistory('undo');
    await nextTick(); await Promise.resolve();
    expect(port.enqueue).toHaveBeenCalledWith({ operation: { op: 'undo' } });
    const targets = [{ slideKey: 'overview', editKey: 'headline' }];
    settle({ status: 'presented', commandId: 'undo', revision: 3, focus: { slideIndex: 2, targets } });
    await running;
    expect(slides.currentSlideIndex).toBe(2);
    expect(manualSelection.revealRequest).toEqual({ targets });
    unmount();
  });
});
