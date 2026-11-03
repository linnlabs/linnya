import type { CanvasResizeGesture } from '../definitions/cardResizing';
export function resolveCanvasResize(gesture: CanvasResizeGesture, event: PointerEvent) {
  let width = Math.max(80, gesture.card.width + (event.clientX - gesture.clientX) / gesture.zoom);
  let height = Math.max(60, gesture.card.height + (event.clientY - gesture.clientY) / gesture.zoom);
  if (event.shiftKey) {
    const ratio = gesture.card.width / gesture.card.height;
    if (width / height > ratio) height = width / ratio; else width = height * ratio;
  }
  return { x: gesture.card.x, y: gesture.card.y, width, height };
}
