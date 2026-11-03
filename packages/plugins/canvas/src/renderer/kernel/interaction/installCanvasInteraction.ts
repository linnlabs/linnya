import type { CanvasCamera, CanvasCardId, CanvasPoint } from '../../../shared';
import type { CanvasKernel, CanvasKernelIntent } from '../definitions/canvasKernel';

/** Pointer 捕获只产生操作意图，持久化与撤销由 feature 层处理。 */
export function installCanvasInteraction(kernel: CanvasKernel, onIntent: (intent: CanvasKernelIntent) => void): () => void {
  const canvas = kernel.canvas;
  let space = false;
  let active: { pointer: number; screen: CanvasPoint; world: CanvasPoint; camera: CanvasCamera; id: CanvasCardId | null; pan: boolean } | null = null;
  function point(event: MouseEvent): CanvasPoint {
    const box = canvas.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }
  function down(event: PointerEvent): void {
    if (event.button !== 0 && event.button !== 1) return;
    const screen = point(event);
    const world = kernel.screenToWorld(screen);
    const card = kernel.hitTest(world);
    active = { pointer: event.pointerId, screen, world, camera: kernel.readCamera(), id: card?.id ?? null, pan: space || event.button === 1 };
    canvas.setPointerCapture(event.pointerId);
    canvas.focus({ preventScroll: true });
    if (!active.pan) onIntent({ kind: 'select', ids: card ? [card.id] : [], additive: event.shiftKey || event.metaKey || event.ctrlKey });
  }
  function move(event: PointerEvent): void {
    if (!active || active.pointer !== event.pointerId || !active.pan) return;
    const current = point(event);
    const camera = { ...active.camera, x: active.camera.x + current.x - active.screen.x, y: active.camera.y + current.y - active.screen.y };
    kernel.setCamera(camera);
    onIntent({ kind: 'camera', camera });
  }
  function up(event: PointerEvent): void {
    if (!active || active.pointer !== event.pointerId) return;
    const operation = active;
    active = null;
    const end = kernel.screenToWorld(point(event));
    if (!operation.pan && operation.id) {
      const dx = end.x - operation.world.x;
      const dy = end.y - operation.world.y;
      if (Math.hypot(dx, dy) > 1) onIntent({ kind: 'move', ids: [operation.id], dx, dy });
    } else if (!operation.pan) {
      const left = Math.min(operation.world.x, end.x);
      const top = Math.min(operation.world.y, end.y);
      const right = Math.max(operation.world.x, end.x);
      const bottom = Math.max(operation.world.y, end.y);
      if (right - left > 1 || bottom - top > 1) {
        const ids = kernel.visibleCards().filter((card) => card.x <= right && card.x + card.width >= left && card.y <= bottom && card.y + card.height >= top).map((card) => card.id);
        onIntent({ kind: 'select', ids, additive: event.shiftKey });
      }
    }
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }
  function wheel(event: WheelEvent): void {
    event.preventDefault();
    const camera = kernel.readCamera();
    let next: CanvasCamera;
    if (event.ctrlKey || event.metaKey) {
      const screen = point(event);
      const world = kernel.screenToWorld(screen);
      const zoom = Math.min(4, Math.max(0.02, camera.zoom * Math.exp(-event.deltaY * 0.006)));
      next = { zoom, x: screen.x - world.x * zoom, y: screen.y - world.y * zoom };
    } else next = { ...camera, x: camera.x - event.deltaX, y: camera.y - event.deltaY };
    kernel.setCamera(next);
    onIntent({ kind: 'camera', camera: next });
  }
  const keyDown = (event: KeyboardEvent) => { if (event.code === 'Space' && !event.isComposing) { space = true; if (event.target === canvas) event.preventDefault(); } };
  const keyUp = (event: KeyboardEvent) => { if (event.code === 'Space') space = false; };
  const blur = () => { space = false; active = null; };
  const open = (event: MouseEvent) => { const card = kernel.hitTest(kernel.screenToWorld(point(event))); if (card) onIntent({ kind: 'open', id: card.id }); };
  const context = (event: MouseEvent) => { event.preventDefault(); const world = kernel.screenToWorld(point(event)); onIntent({ kind: 'context', point: world, id: kernel.hitTest(world)?.id ?? null }); };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', blur);
  canvas.addEventListener('wheel', wheel, { passive: false });
  canvas.addEventListener('dblclick', open);
  canvas.addEventListener('contextmenu', context);
  window.addEventListener('keydown', keyDown);
  window.addEventListener('keyup', keyUp);
  window.addEventListener('blur', blur);
  return () => {
    canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointercancel', blur); canvas.removeEventListener('wheel', wheel); canvas.removeEventListener('dblclick', open); canvas.removeEventListener('contextmenu', context);
    window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); window.removeEventListener('blur', blur);
  };
}
