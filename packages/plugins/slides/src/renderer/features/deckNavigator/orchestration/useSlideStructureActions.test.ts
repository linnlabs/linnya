// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia';
import { effectScope, nextTick } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SlidesManualEditCommand, SlidesManualEditCommandResult } from '@plugin/slides/shared/authoringEditing';
import type { PresentationRenderModel } from '../../../types/render';
import { useManualEditQueue, useSlidesManualEditingStore } from '../../manualEditing';
import { useSlidesRenderStore } from '../../../store/slidesRenderStore';
import { useSlidesStore } from '../../../store/slidesStore';
import { useSlideStructureActions } from './useSlideStructureActions';

vi.mock('@plugin/renderer/workspaceRuntime', () => ({
  notifyWorkspaceDocumentOpened: vi.fn(),
}));

const scopes: ReturnType<typeof effectScope>[] = [];

function installRevision(version: number, slideCount: number): void {
  const slidesStore = useSlidesStore();
  slidesStore.documentBuildState = {
    state: 'ready', presentationId: 'deck', versionId: `v${version}`, versionNumber: version, sourceHash: 'a'.repeat(64),
  };
  slidesStore.deckPreview = {
    nodeId: 'deck', versionNumber: version, title: 'Deck', slideSize: { width: 10, height: 5.625 },
    slides: Array.from({ length: slideCount }, (_, index) => ({ slideId: `s${index}`, number: index + 1, elements: [] })),
    theme: { colors: {}, fonts: { major: 'Arial', minor: 'Arial' } }, warnings: [],
  };
  const model: PresentationRenderModel = {
    presentationId: 'deck', title: 'Deck', version, sourceKind: 'generated',
    slideSize: { width: 10, height: 5.625, unit: 'in' },
    slides: Array.from({ length: slideCount }, (_, index) => ({
      slideId: `s${index}`, index, layoutKey: 'freeform', background: { paint: { type: 'none' } }, elements: [],
    })),
    capabilities: { hasSemanticRender: true, hasReferencePreview: false, hasHitTest: true, hasSelection: true },
  };
  useSlidesRenderStore().renderModel = model;
}

function createFixture() {
  const slidesStore = useSlidesStore();
  slidesStore.currentDeckId = 'deck';
  installRevision(4, 3);
  slidesStore.setCurrentSlide(1);
  const commands: { command: SlidesManualEditCommand; resolve: (value: SlidesManualEditCommandResult) => void }[] = [];
  const submit = vi.fn((command: SlidesManualEditCommand) => new Promise<SlidesManualEditCommandResult>(resolve => {
    commands.push({ command, resolve });
  }));
  const refreshDocument = vi.fn(async (_id: string, version?: number) => {
    if (version !== undefined) installRevision(version, 4);
  });
  const scope = effectScope();
  scopes.push(scope);
  const controller = scope.run(() => {
    const queue = useManualEditQueue({
      createCommandId: () => crypto.randomUUID(), submit, refreshDocument, message: key => key,
      readSnapshot: () => ({
        documentId: slidesStore.currentDeckId,
        buildState: slidesStore.documentBuildState,
        renderVersion: useSlidesRenderStore().renderModel?.version ?? null,
        presentationError: null,
      }),
    });
    return useSlideStructureActions(queue);
  });
  if (!controller) throw new Error('Fixture scope failed');
  return { controller, commands, submit, refreshDocument, slidesStore, manualStore: useSlidesManualEditingStore() };
}

async function flush() { await Promise.resolve(); await nextTick(); await Promise.resolve(); await nextTick(); }

describe('blank slide insertion + real submission queue', () => {
  beforeEach(() => setActivePinia(createPinia()));
  afterEach(() => { for (const scope of scopes.splice(0)) scope.stop(); });

  it('submits after the current slide against the visible revision and selects the committed page before waiting for its frame', async () => {
    const f = createFixture();
    expect(f.controller.availability.value).toEqual({ available: true, index: 2 });

    const inserted = f.controller.insertAfterCurrentSlide();
    await flush();
    expect(f.controller.pending.value).toBe(true);
    expect(f.commands[0]?.command).toMatchObject({
      documentId: 'deck',
      expectedBase: { revisionId: 'v4', revision: 4 },
      operation: { op: 'insert_blank_slide', index: 2 },
    });

    // 等待期间再次点击不会产生第二次写入。
    await f.controller.insertAfterCurrentSlide();
    expect(f.submit).toHaveBeenCalledTimes(1);

    const pending = f.commands[0];
    if (!pending) throw new Error('Missing insert command');
    pending.resolve({ status: 'committed', commandId: pending.command.commandId, documentId: 'deck', revisionId: 'v5', revision: 5 });
    await flush();
    expect(f.refreshDocument).toHaveBeenCalledWith('deck', 5);
    expect(f.slidesStore.currentSlideIndex).toBe(2);
    expect(f.controller.pending.value).toBe(true);

    f.manualStore.recordPresentedRevision(5);
    await inserted;
    expect(f.slidesStore.currentSlideIndex).toBe(2);
    expect(f.controller.pending.value).toBe(false);
  });

  it('stays on the current slide and surfaces the queue error when the source cannot be rewritten', async () => {
    const f = createFixture();
    const inserted = f.controller.insertAfterCurrentSlide();
    await flush();
    const pending = f.commands[0];
    if (!pending) throw new Error('Missing insert command');
    pending.resolve({
      status: 'validation_failed', commandId: pending.command.commandId, documentId: 'deck',
      code: 'slides_not_static', message: '当前页面结构无法从界面直接插入空白页',
    });
    await inserted;

    expect(f.slidesStore.currentSlideIndex).toBe(1);
    expect(f.manualStore.errorMessage).toContain('当前页面结构无法从界面直接插入空白页');
    expect(f.controller.pending.value).toBe(false);
  });
  it('duplicates beside the selected page and blocks other page operations until presentation', async () => {
    const f = createFixture();
    const copied = f.controller.duplicateSlide(1);
    await flush();
    expect(f.commands[0]?.command.operation).toEqual({ op: 'duplicate_slide', index: 1 });
    await f.controller.deleteSlide(0);
    await f.controller.insertAfterCurrentSlide();
    expect(f.commands).toHaveLength(1);
    const pending = f.commands[0];
    pending.resolve({ status: 'committed', commandId: pending.command.commandId, documentId: 'deck', revisionId: 'v5', revision: 5 });
    await flush(); f.manualStore.recordPresentedRevision(5); await copied;
    expect(f.slidesStore.currentSlideIndex).toBe(2);
  });

  it('deleting the last selected page selects its predecessor and keeps one page minimum', async () => {
    const f = createFixture();
    f.slidesStore.setCurrentSlide(2);
    f.refreshDocument.mockImplementation(async () => { installRevision(5, 2); });
    const deleted = f.controller.deleteSlide(2);
    await flush();
    const pending = f.commands[0];
    expect(pending.command.operation).toEqual({ op: 'delete_slide', index: 2 });
    pending.resolve({ status: 'committed', commandId: pending.command.commandId, documentId: 'deck', revisionId: 'v5', revision: 5 });
    await flush(); f.manualStore.recordPresentedRevision(5); await deleted;
    expect(f.slidesStore.currentSlideIndex).toBe(1);
    installRevision(6, 1);
    expect(f.controller.canDelete.value).toBe(false);
    await f.controller.deleteSlide(0);
    expect(f.commands).toHaveLength(1);
  });

});
