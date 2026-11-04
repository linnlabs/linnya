import type { CanvasCard, CanvasSnapshot, CanvasVersionBudgetStatus } from '@plugin/canvas/shared';
import { createPixiCanvasKernel, type CanvasKernel, type CanvasAppearance } from '../../../kernel';
import type { CanvasCardContent } from '../../cardMedia';
import { createCanvasHistoryPreviewState } from '../store/createCanvasHistoryPreviewState';

/** 历史是独立只读投影，永远不创建文档提交会话或编辑保护。 */
export function createCanvasHistoryPreview(options: {
  readonly host: HTMLElement;
  readonly createContent: (documentId: string) => CanvasCardContent;
  readonly read: (documentId: string, versionId: string) => Promise<CanvasSnapshot>;
  readonly readBudget: (documentId: string) => Promise<CanvasVersionBudgetStatus>;
  readonly readAppearance: () => CanvasAppearance;
  readonly observeResolution: (changed: () => void) => () => void;
  readonly createRaster: (options: { readonly kernel: CanvasKernel; readonly createContent: CanvasCardContent['create']; readonly readContentKey: CanvasCardContent['contentKey']; readonly readAppearance: () => CanvasAppearance; readonly reportFailure: (message: string) => void }) => { refresh(): void; dispose(): void };
}) {
  const state = createCanvasHistoryPreviewState();
  let generation = 0, disposeView: (() => void) | null = null, kernel: CanvasKernel | null = null;
  let cards: readonly CanvasCard[] = [];
  let currentDocumentId: string | null = null;
  let budgetEpoch = 0;
  let refresh: (() => void) | null = null;
  return { state,
    async open(documentId: string, versionId: string) {
      const token = ++generation; currentDocumentId = documentId; disposeView?.(); disposeView = null; kernel = null; refresh = null; state.loading();
      try {
        const budgetToken = budgetEpoch;
        const [snapshot, budget] = await Promise.all([options.read(documentId, versionId), options.readBudget(documentId)]);
        if (token !== generation) return;
        if (budgetToken === budgetEpoch) state.installBudget(budget);
        const current = await createPixiCanvasKernel({ host: options.host, readonly: true, onIntent: intent => { if (intent.kind === 'camera') refresh?.(); if (intent.kind === 'render-status') state.setRenderNotice(intent.message); } });
        if (token !== generation) { current.destroy(); return; }
        kernel = current; current.canvas.setAttribute('aria-label', '画布历史预览，只读，可平移和缩放');
        const content = options.createContent(documentId);
        const raster = options.createRaster({ kernel: current, createContent: content.create, readContentKey: content.contentKey,
          readAppearance: options.readAppearance, reportFailure: message => state.fail(message) });
        refresh = () => { content.refreshVisible(current.renderableCards()); raster.refresh(); };
        cards = snapshot.elements.filter((element): element is CanvasCard => element.type !== 'edge');
        const stopContent = content.subscribe(failure => { if (failure) state.fail(failure.message); else { current.setDocumentTitles(content.documentTitles()); current.setThumbnailCards(content.thumbnailCards(cards)); refresh?.(); } });
        void content.refreshReferences(cards).catch(error => { if (token === generation) state.fail(error instanceof Error ? error.message : String(error)); });
        current.setAppearance(options.readAppearance()); current.setElements(snapshot.elements); current.fit(cards); refresh();
        const resized = () => { current.resize(options.host.clientWidth, options.host.clientHeight, devicePixelRatio); refresh?.(); };
        const resize = new ResizeObserver(resized); resize.observe(options.host);
        const stopResolution = options.observeResolution(resized);
        disposeView = () => { stopContent(); resize.disconnect(); stopResolution(); raster.dispose(); content.dispose(); current.destroy(); };
        state.ready();
      } catch (error) { if (token === generation) state.fail(error instanceof Error ? error.message : String(error)); }
    },
    fit() { kernel?.fit(cards); refresh?.(); },
    refreshAppearance() { kernel?.setAppearance(options.readAppearance()); refresh?.(); },
    budgetChanged(status: CanvasVersionBudgetStatus) { if (status.documentId === currentDocumentId) { budgetEpoch += 1; state.installBudget(status); } },
    dispose() { generation += 1; currentDocumentId = null; disposeView?.(); disposeView = null; kernel = null; refresh = null; },
  };
}
