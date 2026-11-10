import type { CanvasCommand, CanvasEdge } from '@plugin/canvas/shared';
import { canvasText } from '../../localization';

/** 交换完整端点（含固定边/悬空坐标），不新建ID、不丢标签或样式。 */
export function buildCanvasConnectionReversal(edge: CanvasEdge): CanvasCommand {
  if (edge.locked) throw new Error(canvasText('canvas.error.edgeLocked'));
  return {
    op: 'update',
    id: edge.id,
    baseRevision: edge.revision,
    patch: { from: edge.to, to: edge.from },
  };
}
