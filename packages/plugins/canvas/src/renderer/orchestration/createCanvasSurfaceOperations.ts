import { type CanvasArrangeRequest, type CanvasCardId } from '@plugin/canvas/shared';
import type { CanvasResizeEdge } from '../features/cardResizing';

import type { CanvasSurfaceOperationsOptions } from './definitions/canvasSurfaceComposition';

/** 工具栏和详情面板触发的跨能力流程。 */
export function createCanvasSurfaceOperations({
  ports,
  base,
  rendering,
  drafts,
  selection: commands,
  presentation,
  viewport,
}: CanvasSurfaceOperationsOptions) {
  const { layout, selection, readonly, resizing, state, cards } = base;
  const { kernel, raster, refreshView } = rendering;
  const { finish } = drafts;
  const { connections, actions } = commands;
  const { selectedCards } = presentation;
  const { camera } = state;
  const { fit } = viewport;
  return {
    async arrange(request: CanvasArrangeRequest['options']) {
      if (!layout || !(await finish())) return;
      await layout.run({
        ...request,
        ...(selection.ids.value.length ? { elementIds: [...selection.ids.value] } : {}),
      });
      layout.state.setDirection(request.direction);
      layout.state.setTreeKeyboard(request.algorithm === 'tree');
      fit(Boolean(selection.ids.value.length));
    },
    async connect() {
      if (await finish()) await connections.select(await actions.connect());
    },
    prepareMutation: async () => (await finish()) && (await connections.saveLabel()),
    prepareDetail: (id: CanvasCardId) => {
      kernel.finishTransitions([id]);
      state.advanceDisplay();
      return raster.prepareEditing(id);
    },
    retryDisplay() {
      state.clearFailure();
      ports.retryContent?.();
      raster.retry();
      refreshView();
    },
    resizeStart(event: PointerEvent, edge: CanvasResizeEdge) {
      if (readonly.value) return;
      const card = selectedCards.value[0];
      if (card && selectedCards.value.length === 1) {
        kernel.finishTransitions([card.id]);
        const target = cards().find(item => item.id === card.id);
        if (target)
          resizing.start(target, event, {
            edge,
            zoom: camera.value.zoom,
            display: {
              show: frame => kernel.setResizePreview(target.id, frame),
              // 撤掉预览后按落地的新尺寸重排正文。
              clear: () => {
                kernel.clearDragPreview();
                refreshView();
              },
            },
          });
      }
    },
    closeContext() {
      state.setContext(null);
      viewport.focus();
    },
  };
}
