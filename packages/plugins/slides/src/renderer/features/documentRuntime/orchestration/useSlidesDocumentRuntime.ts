import type { PendingStructureSelection } from '../definitions/documentPresentation';
import { resolvePresentationSelection, resolveRequestedSlideIndex } from '../functions/presentationSelection';
import type { SlideRenderModel } from '@plugin/slides/shared/renderModel';
import { notifyWorkspaceDocumentOpened } from '@plugin/renderer/workspaceRuntime';
import type { ViewJsonRecord } from '@plugin/slides/shared/presentationViewSnapshot';
import { useSlidesStore } from '../store/slidesDocumentStore';
import { createActiveDeckRefreshCoordinator } from './createActiveDeckRefreshCoordinator';
import { readPresentationView } from './readPresentationView';

const runtimes = new WeakMap<ReturnType<typeof useSlidesStore>, ReturnType<typeof createRuntime>>();
export function useSlidesDocumentRuntime() {
  const store = useSlidesStore();
  let runtime = runtimes.get(store);
  if (!runtime) { runtime = createRuntime(store); runtimes.set(store, runtime); }
  return runtime;
}
function createRuntime(store: ReturnType<typeof useSlidesStore>) {
  let pages = new Map<string, SlideRenderModel>();
  let blocks = new Map<string, ViewJsonRecord>();
  let pendingSelection: PendingStructureSelection | null = null;
  const coordinator = createActiveDeckRefreshCoordinator({
    readDocumentEpoch: () => store.state.epoch,
    isActiveDocument: documentId => store.currentDeckId === documentId,
    hasLoadedRevision: (documentId, revision) => store.currentDeckId === documentId
      && store.documentBuildState?.state === 'ready' && store.renderModel !== null
      && store.documentBuildState.versionNumber >= revision,
    readDocument: read,
  });
  async function read(nodeId: string): Promise<void> {
    const epoch = store.state.epoch;
    const candidate = await readPresentationView(nodeId, blocks, pages);
    const intent = pendingSelection;
    let confirmedRevision: number | null = null;
    if (intent?.epoch === epoch && candidate.installed.buildState.versionNumber > intent.base) {
      confirmedRevision = await intent.confirmed;
      if (pendingSelection === intent) pendingSelection = null;
    }
    if (store.state.epoch !== epoch || store.currentDeckId !== nodeId) return;
    const installedRevision = store.documentBuildState?.versionNumber ?? 0;
    if (candidate.installed.buildState.versionNumber < installedRevision) return;
    const count = candidate.installed.renderModel?.slides.length ?? 0;
    blocks = candidate.blocks; pages = candidate.pages;
    const selectedIndex = resolvePresentationSelection({ currentIndex: store.currentSlideIndex,
      slideCount: count, revision: candidate.installed.buildState.versionNumber,
      selectionEpoch: store.state.selectionEpoch, confirmedRevision, intent });
    store.installSnapshot(candidate.installed, selectedIndex);
  }
  async function loadDeck(nodeId: string): Promise<void> {
    store.beginDocument(nodeId);
    blocks = new Map(); pages = new Map(); pendingSelection = null;
    const epoch = store.state.epoch;
    try {
      await read(nodeId);
      if (store.state.epoch === epoch) {
        const result = await notifyWorkspaceDocumentOpened({ documentId: nodeId });
        if (!result.success) console.error('[Slides] notify-document-opened failed:', result.error);
      }
    } catch (error) {
      if (store.state.epoch === epoch) store.setReadError(error instanceof Error ? error.message : String(error));
    }
  }
  async function refreshDeck(nodeId: string, expectedVersion?: number): Promise<void> {
    await coordinator.refresh({ documentId: nodeId, ...(expectedVersion !== undefined ? { expectedVersion } : {}) });
  }
  async function openDeckAtSlide(nodeId: string, slideNumber: number): Promise<void> {
    if (store.currentDeckId !== nodeId || !store.deckPreview) await loadDeck(nodeId);
    store.setCurrentSlide(resolveRequestedSlideIndex(slideNumber, store.slideCount));
  }
  /** 页序事件可以先于提交回执到达：候选等待归属确认后再原子选页，不能先画旧选择再补 watcher。 */
  function prepareStructureSelection(target: number, base: number): (revision: number | null) => void {
    let confirm!: (revision: number | null) => void;
    const confirmed = new Promise<number | null>(resolve => { confirm = resolve; });
    const intent = { epoch: store.state.epoch, selectionEpoch: store.state.selectionEpoch, target, base, confirmed };
    pendingSelection = intent;
    return revision => {
      confirm(revision);
      if (revision === null && pendingSelection === intent) pendingSelection = null;
    };
  }
  function closeDeck(): void {
    store.$reset(); blocks.clear(); pages.clear(); pendingSelection = null;
  }
  return { loadDeck, refreshDeck, openDeckAtSlide, prepareStructureSelection, closeDeck };
}
