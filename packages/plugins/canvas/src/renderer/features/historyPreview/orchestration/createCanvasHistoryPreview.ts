import type { CanvasCard, CanvasVersionBudgetStatus } from '@plugin/canvas/shared';
import { createPixiCanvasKernel, type CanvasKernel } from '../../../kernel';
import { canvasKernelText, canvasText } from '../../localization';
import type { CanvasHistoryPreviewOptions } from '../definitions/canvasHistoryPreview';
import { createCanvasHistoryPreviewState } from '../store/createCanvasHistoryPreviewState';

/** 历史是独立只读投影，永远不创建文档提交会话或编辑保护。 */
export function createCanvasHistoryPreview(options: CanvasHistoryPreviewOptions) {
  const state = createCanvasHistoryPreviewState();
  let generation = 0,
    disposeView: (() => void) | null = null,
    kernel: CanvasKernel | null = null;
  let cards: readonly CanvasCard[] = [];
  let currentDocumentId: string | null = null;
  let budgetEpoch = 0;
  let refresh: (() => void) | null = null;
  return {
    state,
    async open(documentId: string, versionId: string) {
      const token = ++generation;
      currentDocumentId = documentId;
      disposeView?.();
      disposeView = null;
      kernel = null;
      refresh = null;
      state.loading();
      try {
        const budgetToken = budgetEpoch;
        const [snapshot, budget] = await Promise.all([
          options.read(documentId, versionId),
          options.readBudget(documentId),
        ]);
        if (token !== generation) return;
        if (budgetToken === budgetEpoch) state.installBudget(budget);
        const current = await createPixiCanvasKernel({
          host: options.host,
          text: canvasKernelText,
          readonly: true,
          onIntent: intent => {
            if (intent.kind === 'camera') refresh?.();
            if (intent.kind === 'render-status') state.setRenderNotice(intent.message);
          },
        });
        if (token !== generation) {
          current.destroy();
          return;
        }
        kernel = current;
        current.canvas.setAttribute('aria-label', canvasText('canvas.history.canvasLabel'));
        const content = options.createContent(documentId);
        const raster = options.createRaster({
          kernel: current,
          createContent: content.create,
          readContentKey: content.contentKey,
          readAppearance: options.readAppearance,
          reportFailure: message => state.fail(message),
        });
        refresh = () => {
          content.refreshVisible(current.renderableCards());
          raster.refresh();
        };
        cards = snapshot.elements.filter(
          (element): element is CanvasCard => element.type !== 'edge'
        );
        const stopContent = content.subscribe(failure => {
          if (failure) state.fail(failure.message);
          else {
            current.setDocumentTitles(content.documentTitles());
            current.setThumbnailCards(content.thumbnailCards(cards));
            refresh?.();
          }
        });
        void content.refreshReferences(cards).catch(error => {
          if (token === generation)
            state.fail(error instanceof Error ? error.message : String(error));
        });
        current.setAppearance(options.readAppearance());
        current.setElements(snapshot.elements);
        current.fit(cards);
        refresh();
        const resized = () => {
          current.resize(options.host.clientWidth, options.host.clientHeight, devicePixelRatio);
          refresh?.();
        };
        const resize = new ResizeObserver(resized);
        resize.observe(options.host);
        const stopResolution = options.observeResolution(resized);
        disposeView = () => {
          stopContent();
          resize.disconnect();
          stopResolution();
          raster.dispose();
          content.dispose();
          current.destroy();
        };
        state.ready();
      } catch (error) {
        if (token === generation)
          state.fail(error instanceof Error ? error.message : String(error));
      }
    },
    fit() {
      kernel?.fit(cards);
      refresh?.();
    },
    refreshAppearance() {
      kernel?.setAppearance(options.readAppearance());
      refresh?.();
    },
    budgetChanged(status: CanvasVersionBudgetStatus) {
      if (status.documentId === currentDocumentId) {
        budgetEpoch += 1;
        state.installBudget(status);
      }
    },
    dispose() {
      generation += 1;
      currentDocumentId = null;
      disposeView?.();
      disposeView = null;
      kernel = null;
      refresh = null;
    },
  };
}
