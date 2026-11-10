import type { CanvasPoint } from '@plugin/canvas/shared';
export function installCanvasPastePosition(
  host: HTMLElement,
  screenToWorld: (point: CanvasPoint) => CanvasPoint
) {
  let pointer: CanvasPoint | null = null;
  const move = (event: PointerEvent) => {
    const bounds = host.getBoundingClientRect();
    pointer = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };
  const leave = () => {
    pointer = null;
  };
  host.addEventListener('pointermove', move);
  host.addEventListener('pointerleave', leave);
  return {
    read: () => screenToWorld(pointer ?? { x: host.clientWidth / 2, y: host.clientHeight / 2 }),
    dispose() {
      host.removeEventListener('pointermove', move);
      host.removeEventListener('pointerleave', leave);
    },
  };
}
