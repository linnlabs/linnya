import type { CanvasCamera, CanvasCardId, CanvasPoint } from '../../../shared';
import type { CanvasInteractionKernel, CanvasKernelIntent } from '../definitions/canvasKernel';
import type { CanvasInteractionOptions, CanvasPointerGesture, CanvasSnapTargets } from '../definitions/canvasInteraction';
import { createCanvasSnapTargets, snapCanvasMovementWithGuides } from './functions/canvasSnapping';

/** 手势只修改显示投影并产生意图；一次松手才提交一次业务修改。 */
class CanvasPointerInteraction {
  private readonly canvas: HTMLCanvasElement;
  private space = false;
  private active: CanvasPointerGesture | null = null;
  private snapTargets: CanvasSnapTargets | null = null;
  private hovered: CanvasCardId | null = null;
  private isReadonly(): boolean { return this.options.readonly === true || this.options.readReadonly?.() === true; }
  private movement(event: PointerEvent, gesture: CanvasPointerGesture): CanvasPoint {
    const world = this.kernel.screenToWorld(this.point(event)), movement = { x: world.x - gesture.world.x, y: world.y - gesture.world.y };
    const result = !event.altKey && this.options.readPreferences?.().snapping !== false
      ? snapCanvasMovementWithGuides(this.snapTargets, movement, this.kernel.readCamera().zoom) : { delta: movement, guides: [] };
    this.kernel.setGuides(result.guides); return result.delta;
  }
  private point(event: MouseEvent): CanvasPoint {
    const box = this.canvas.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }
  private selectedIds(gesture: CanvasPointerGesture): readonly CanvasCardId[] { return gesture.id && gesture.selection.includes(gesture.id)
    ? gesture.selection : gesture.id ? [gesture.id] : []; }
  private cancel = () => {
    if (this.active) {
      this.onIntent({ kind: 'editing', ids: this.selectedIds(this.active), active: false });
      this.onIntent({ kind: 'select', ids: this.active.selection, additive: false });
      if (this.canvas.hasPointerCapture(this.active.pointer)) this.canvas.releasePointerCapture(this.active.pointer);
    }
    this.active = null; this.snapTargets = null; this.space = false; this.hover(null); this.kernel.setBrush(null); this.kernel.setGuides([]); this.kernel.clearDragPreview();
  };
  private down = (event: PointerEvent): void => {
    if (event.button !== 0 && event.button !== 1) return;
    const screen = this.point(event);
    const world = this.kernel.screenToWorld(screen);
    const card = this.kernel.hitTest(world);
    this.active = { pointer: event.pointerId, screen, world, camera: this.kernel.readCamera(), id: card?.id ?? null, edgeId: card ? null : this.kernel.hitTestEdge(world)?.id ?? null,
      pan: this.isReadonly() || this.space || event.button === 1, locked: card?.locked ?? false, selection: this.kernel.readSelection(), additive: event.shiftKey, moved: false };
    this.canvas.setPointerCapture(event.pointerId); this.canvas.focus({ preventScroll: true });
    this.kernel.setBrush(null);
    this.snapTargets = createCanvasSnapTargets(this.kernel.visibleCards(), this.selectedIds(this.active));
    if (!this.active.pan && card && !card.locked) this.onIntent({ kind: 'editing', ids: this.selectedIds(this.active), active: true });
  }
  private move = (event: PointerEvent): void => {
    const gesture = this.active;
    if (!gesture) { this.hover(this.kernel.hitTest(this.kernel.screenToWorld(this.point(event)))?.id ?? null); return; }
    if (this.isReadonly() && !gesture.pan) { this.cancel(); return; }
    if (gesture.pointer !== event.pointerId) return;
    const current = this.point(event);
    if (Math.hypot(current.x - gesture.screen.x, current.y - gesture.screen.y) < 3 && !gesture.moved) return;
    gesture.moved = true;
    if (gesture.pan) {
      const camera = { ...gesture.camera, x: gesture.camera.x + current.x - gesture.screen.x, y: gesture.camera.y + current.y - gesture.screen.y };
      this.kernel.setCamera(camera); this.onIntent({ kind: 'camera', camera }); return;
    }
    const world = this.kernel.screenToWorld(current);
    if (gesture.id && !gesture.locked) {
      const ids = this.selectedIds(gesture);
      this.onIntent({ kind: 'select', ids, additive: false });
      const delta = this.movement(event, gesture);
      this.kernel.setDragPreview(ids, delta.x, delta.y);
      return;
    }
    if (gesture.id || gesture.edgeId) return;
    const rectangle = { x: Math.min(gesture.world.x, world.x), y: Math.min(gesture.world.y, world.y),
      width: Math.abs(world.x - gesture.world.x), height: Math.abs(world.y - gesture.world.y) };
    this.kernel.setBrush(rectangle);
    const right = rectangle.x + rectangle.width, bottom = rectangle.y + rectangle.height;
    const ids = this.kernel.visibleCards().filter(card => event.metaKey || event.ctrlKey
      ? card.x >= rectangle.x && card.y >= rectangle.y && card.x + card.width <= right && card.y + card.height <= bottom
      : card.x <= right && card.x + card.width >= rectangle.x && card.y <= bottom && card.y + card.height >= rectangle.y).map(card => card.id);
    this.onIntent({ kind: 'select', ids: gesture.additive ? [...new Set([...gesture.selection, ...ids])] : ids, additive: false });
  }
  private up = (event: PointerEvent): void => {
    const gesture = this.active;
    if (!gesture || gesture.pointer !== event.pointerId) return;
    if (this.isReadonly() && !gesture.pan) { this.cancel(); return; }
    this.active = null; this.kernel.setBrush(null);
    if (!gesture.pan && gesture.id && !gesture.locked && gesture.moved) {
      const delta = this.movement(event, gesture);
      this.onIntent({ kind: 'move', ids: this.selectedIds(gesture), dx: delta.x, dy: delta.y, copy: event.altKey });
      // 提交完成前保留编辑保护；feature 在真实提交/失败收口后释放。
    } else if (!gesture.pan && !gesture.moved) {
      if (gesture.edgeId) this.onIntent({ kind: 'select-edge', id: gesture.edgeId });
      else this.onIntent({ kind: 'select', ids: gesture.id ? [gesture.id] : [], additive: gesture.additive });
      this.onIntent({ kind: 'editing', ids: this.selectedIds(gesture), active: false });
    }
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    this.kernel.setGuides([]); this.snapTargets = null;
  }
  private wheel = (event: WheelEvent): void => {
    event.preventDefault();
    const camera = this.kernel.readCamera();
    let next: CanvasCamera;
    if (event.ctrlKey || event.metaKey || this.options.readPreferences?.().wheelZoom) {
      const screen = this.point(event), world = this.kernel.screenToWorld(screen);
      const zoom = Math.min(4, Math.max(0.02, camera.zoom * Math.exp(-event.deltaY * 0.006)));
      next = { zoom, x: screen.x - world.x * zoom, y: screen.y - world.y * zoom };
    } else next = { ...camera, x: camera.x - event.deltaX, y: camera.y - event.deltaY };
    this.kernel.setCamera(next); this.onIntent({ kind: 'camera', camera: next });
  }
  private keyDown = (event: KeyboardEvent) => {
    if (event.isComposing) return;
    if (event.code === 'Space') { this.space = true; if (event.target === this.canvas) event.preventDefault(); }
    if (event.key === 'Escape' && this.active) { event.preventDefault(); this.cancel(); }
  };
  private keyUp = (event: KeyboardEvent) => { if (event.code === 'Space') this.space = false; };
  private open = (event: MouseEvent) => { if (this.isReadonly()) return; const card = this.kernel.hitTest(this.kernel.screenToWorld(this.point(event))); if (card) this.onIntent({ kind: 'open', id: card.id }); };
  private hover(id: CanvasCardId | null) { if (id === this.hovered) return; this.hovered = id; this.kernel.setHoveredCard(id); this.onIntent({ kind: 'hover', id }); }
  private context = (event: MouseEvent) => { if (this.isReadonly()) return; event.preventDefault(); const world = this.kernel.screenToWorld(this.point(event)), card = this.kernel.hitTest(world); this.onIntent({ kind: 'context', point: world, id: card?.id ?? null, edgeId: card ? null : this.kernel.hitTestEdge(world)?.id ?? null }); };
  constructor(private readonly kernel: CanvasInteractionKernel, private readonly onIntent: (intent: CanvasKernelIntent) => void, private readonly options: CanvasInteractionOptions) {
    this.canvas = kernel.canvas;
  }
  install(): () => void {
  this.canvas.addEventListener('pointerdown', this.down); this.canvas.addEventListener('pointermove', this.move); this.canvas.addEventListener('pointerup', this.up);
  this.canvas.addEventListener('pointercancel', this.cancel); this.canvas.addEventListener('wheel', this.wheel, { passive: false });
  this.canvas.addEventListener('dblclick', this.open); this.canvas.addEventListener('contextmenu', this.context);
  window.addEventListener('keydown', this.keyDown); window.addEventListener('keyup', this.keyUp); window.addEventListener('blur', this.cancel);
  return () => {
    this.canvas.removeEventListener('pointerdown', this.down); this.canvas.removeEventListener('pointermove', this.move); this.canvas.removeEventListener('pointerup', this.up);
    this.canvas.removeEventListener('pointercancel', this.cancel); this.canvas.removeEventListener('wheel', this.wheel);
    this.canvas.removeEventListener('dblclick', this.open); this.canvas.removeEventListener('contextmenu', this.context);
    window.removeEventListener('keydown', this.keyDown); window.removeEventListener('keyup', this.keyUp); window.removeEventListener('blur', this.cancel);
  };
  }
}

export function installCanvasInteraction(kernel: CanvasInteractionKernel, onIntent: (intent: CanvasKernelIntent) => void, options: CanvasInteractionOptions = {}): () => void {
  return new CanvasPointerInteraction(kernel, onIntent, options).install();
}
