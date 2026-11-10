import type { CanvasResizeEdge, CanvasResizeGesture } from '../definitions/cardResizing';

/** 选中卡片描边上的八个改尺寸区域，四角在前，便于叠放时角压住边。 */
export const CANVAS_RESIZE_EDGES: readonly CanvasResizeEdge[] = [
  'n',
  's',
  'e',
  'w',
  'nw',
  'ne',
  'sw',
  'se',
];

/** 按拖动的边或角算出新外框：被拖的边跟随指针，对边固定；Shift 保持原比例。 */
export function resolveCanvasResize(
  gesture: Pick<CanvasResizeGesture, 'card' | 'edge' | 'clientX' | 'clientY' | 'zoom'>,
  event: Pick<PointerEvent, 'clientX' | 'clientY' | 'shiftKey'>
) {
  const { card, edge } = gesture;
  const east = edge.includes('e'),
    west = edge.includes('w'),
    north = edge.includes('n'),
    south = edge.includes('s');
  const dx = (event.clientX - gesture.clientX) / gesture.zoom,
    dy = (event.clientY - gesture.clientY) / gesture.zoom;
  let width = Math.max(80, card.width + (east ? dx : west ? -dx : 0));
  let height = Math.max(60, card.height + (south ? dy : north ? -dy : 0));
  if (event.shiftKey) {
    const ratio = card.width / card.height;
    const horizontal = east || west,
      vertical = north || south;
    if (horizontal && !vertical) height = width / ratio;
    else if (vertical && !horizontal) width = height * ratio;
    else if (width / height > ratio) height = width / ratio;
    else width = height * ratio;
  }
  return {
    x: west ? card.x + card.width - width : card.x,
    y: north ? card.y + card.height - height : card.y,
    width,
    height,
  };
}
