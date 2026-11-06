import { selectCanvasSubgraph } from '../features/clipboard';
import { canvasDraggedCopySource } from '../functions/canvasDraggedCopySource';
import { type CanvasKernelIntent } from '../kernel';

import type { CanvasSurfaceIntentOptions } from './definitions/canvasSurfaceComposition';

/** Kernel 意图进入文档能力的唯一分发点，不把手势状态复制进文档 store。 */
export function createCanvasSurfaceIntentHandler({
  base,
  rendering,
  drafts,
  selection: commands,
  viewport,
}: CanvasSurfaceIntentOptions) {
  const { session, state, dragging } = base;
  const { kernel, refreshView } = rendering;
  const { movement } = drafts;
  const { connections, select, actions, opening } = commands;
  return async (intent: Exclude<CanvasKernelIntent, { kind: 'render-status' }>) => {
    switch (intent.kind) {
      case 'preview-changed':
        state.advanceDisplay();
        refreshView();
        return;
      case 'hover':
        state.setHovered(intent.id);
        connections.labelPreview.hover(intent.edgeId);
        return;
      case 'select-edge':
        await connections.select(intent.id);
        return;
      case 'select':
        await select(intent.ids, intent.additive);
        return;
      case 'editing':
        await dragging.set(intent.ids, intent.active);
        return;
      case 'move':
        if (intent.copy) {
          try {
            await actions.duplicate(
              canvasDraggedCopySource(
                selectCanvasSubgraph(session.state.snapshot.value?.elements ?? [], intent.ids),
                intent.positions,
                intent.dx,
                intent.dy
              ),
              intent.dx,
              intent.dy
            );
          } finally {
            kernel.clearDragPreview();
            await dragging.set(intent.ids, false);
          }
        } else await movement.place(intent.ids, intent.positions);
        return;
      case 'open':
        await opening.open(intent.id);
        return;
      case 'camera':
        state.setCamera(intent.camera);
        refreshView();
        return;
      case 'context':
        if (await viewport.selectContext(intent)) state.setContext(intent);
        return;
    }
  };
}
