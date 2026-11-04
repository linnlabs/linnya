import type { Container } from 'pixi.js';
import type { CanvasCamera, CanvasCard, CanvasCardId } from '../../../../shared';
import type { CanvasSceneMotionPlan } from '../../motion';

export interface CanvasMotionView { card: CanvasCard; readonly container: Container; lodAlpha: number }
interface CardMotion {
  readonly view: CanvasMotionView; readonly kind: CanvasSceneMotionPlan['kind']; readonly started: number; readonly duration: number;
  readonly fromX: number; readonly fromY: number; readonly toX: number; readonly toY: number;
  readonly fromScale: number; readonly toScale: number; readonly fromAlpha: number; readonly toAlpha: number;
  scale: number; alpha: number;
}
interface CameraMotion { readonly from: CanvasCamera; readonly to: CanvasCamera; readonly started: number; readonly duration: number }

/** 有界显示投影动画；逻辑target由Kernel持有，timer只准备当前显示姿态。 */
export class CanvasSceneMotion {
  private readonly cards = new Map<CanvasCardId, CardMotion>();
  private readonly translucent = new Set<CanvasCardId>();
  private readonly changed: CanvasCardId[] = [];
  private camera: CameraMotion | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private enabled = true;
  constructor(private readonly options: {
    readonly project: (ids: readonly CanvasCardId[], opacityChanged: boolean, cameraChanged: boolean) => void;
    readonly removed: (id: CanvasCardId) => void; readonly complete: (id: CanvasCardId) => void;
    readonly appeared: (id: CanvasCardId) => void;
    readonly camera: (camera: CanvasCamera) => void;
  }) {}
  apply(view: CanvasMotionView): void {
    const node = this.cards.get(view.card.id), scale = node?.scale ?? 1;
    view.container.position.set(view.card.x + view.card.width * (1 - scale) / 2, view.card.y + view.card.height * (1 - scale) / 2);
    view.container.scale.set(scale); view.container.alpha = (node?.alpha ?? 1) * view.lodAlpha;
  }
  start(plan: CanvasSceneMotionPlan, view: CanvasMotionView, target: CanvasCard | undefined, started: number): void {
    this.cards.delete(plan.id); this.translucent.delete(plan.id);
    if (!this.enabled) {
      if (plan.kind === 'remove') this.options.removed(plan.id);
      else { if (view.container.alpha === 0) this.options.appeared(plan.id); if (target) { view.card.x = target.x; view.card.y = target.y; } this.apply(view); this.options.complete(plan.id); }
      return;
    }
    const appearing = plan.kind === 'add' || plan.kind === 'batch';
    const fromScale = plan.kind === 'add' ? 0.96 : plan.kind === 'batch' ? 1 : view.container.scale.x;
    const fromAlpha = appearing ? 0 : view.container.alpha / view.lodAlpha;
    const node: CardMotion = { view, kind: plan.kind, started, duration: plan.durationMs,
      fromX: view.card.x, fromY: view.card.y, toX: target?.x ?? view.card.x, toY: target?.y ?? view.card.y,
      fromScale, toScale: plan.kind === 'remove' ? fromScale : 1, fromAlpha, toAlpha: plan.kind === 'remove' ? 0 : 1,
      scale: fromScale, alpha: fromAlpha };
    this.cards.set(plan.id, node); if (appearing || fromAlpha < 1) this.translucent.add(plan.id);
    this.apply(view); this.schedule();
  }
  private advance(node: CardMotion, now: number): boolean {
    const progress = Math.min(1, (now - node.started) / node.duration), eased = 1 - (1 - progress) ** 3;
    node.view.card.x = node.fromX + (node.toX - node.fromX) * eased; node.view.card.y = node.fromY + (node.toY - node.fromY) * eased;
    node.scale = node.fromScale + (node.toScale - node.fromScale) * eased;
    node.alpha = node.fromAlpha + (node.toAlpha - node.fromAlpha) * progress; this.apply(node.view); return progress === 1;
  }
  private end(id: CanvasCardId, node: CardMotion): void {
    this.cards.delete(id); this.translucent.delete(id);
    if (node.kind === 'remove') this.options.removed(id);
    else { if (node.alpha === 0) this.options.appeared(id); node.view.card.x = node.toX; node.view.card.y = node.toY; this.apply(node.view); this.options.complete(id); }
  }
  private readonly pulse = () => {
    this.timer = undefined; this.changed.length = 0;
    const now = performance.now(); let opacityChanged = false;
    for (const [id, node] of this.cards) {
      if (node.kind !== 'remove' && (node.kind === 'move' || node.kind === 'add')) this.changed.push(id);
      const wasVisible = node.alpha > 0, complete = this.advance(node, now);
      if (!wasVisible && node.alpha > 0) this.options.appeared(id);
      if (complete) { this.end(id, node); opacityChanged = true; }
    }
    const cameraChanged = this.advanceCamera(now);
    this.options.project(this.changed, opacityChanged, cameraChanged); this.schedule();
  };
  private schedule(): void { if ((this.cards.size || this.camera) && this.timer === undefined) this.timer = setTimeout(this.pulse, 8); }
  private stopTimer(): void { if (!this.cards.size && !this.camera) { clearTimeout(this.timer); this.timer = undefined; } }
  private advanceCamera(now: number): boolean {
    const motion = this.camera; if (!motion) return false;
    const progress = Math.min(1, (now - motion.started) / motion.duration), eased = 1 - (1 - progress) ** 3;
    this.options.camera({ x: motion.from.x + (motion.to.x - motion.from.x) * eased,
      y: motion.from.y + (motion.to.y - motion.from.y) * eased, zoom: motion.from.zoom + (motion.to.zoom - motion.from.zoom) * eased });
    if (progress === 1) this.camera = undefined; return true;
  }
  fly(from: CanvasCamera, to: CanvasCamera, duration: number): void {
    if (!this.enabled || duration <= 0) { this.camera = undefined; this.options.camera(to); this.options.project([], false, true); return; }
    this.camera = { from, to, duration, started: performance.now() }; this.schedule();
  }
  cancelCamera(): void { this.camera = undefined; this.stopTimer(); }
  finish(ids?: readonly CanvasCardId[]): void {
    this.changed.length = 0;
    for (const id of ids ?? [...this.cards.keys()]) {
      const node = this.cards.get(id); if (!node) continue;
      this.end(id, node); this.changed.push(id);
    }
    const cameraChanged = !ids && this.camera !== undefined;
    if (cameraChanged && this.camera) { this.options.camera(this.camera.to); this.camera = undefined; }
    if (this.changed.length || cameraChanged) this.options.project(this.changed, true, cameraChanged);
    this.stopTimer();
  }
  freeze(ids: readonly CanvasCardId[]): void {
    this.changed.length = 0;
    for (const id of ids) {
      const node = this.cards.get(id); if (!node) continue;
      if (node.kind === 'remove') { this.end(id, node); continue; }
      this.cards.delete(id); this.translucent.delete(id);
      if (node.alpha === 0) this.options.appeared(id);
      node.view.card.x = node.view.container.x; node.view.card.y = node.view.container.y;
      this.apply(node.view); this.changed.push(id); this.options.complete(id);
    }
    if (this.changed.length) this.options.project(this.changed, true, false); this.stopTimer();
  }
  has(id: CanvasCardId): boolean { return this.cards.has(id); }
  forget(id: CanvasCardId): void { this.cards.delete(id); this.translucent.delete(id); this.stopTimer(); }
  readOpacity(id: CanvasCardId): number { return this.cards.get(id)?.alpha ?? 1; }
  opaque(id: CanvasCardId): boolean { return !this.translucent.has(id); }
  translucentIds(): ReadonlySet<CanvasCardId> { return this.translucent; }
  isMoving(): boolean { if (this.camera) return true; for (const node of this.cards.values()) if (node.kind === 'move' || node.kind === 'add') return true; return false; }
  setEnabled(enabled: boolean): void { this.enabled = enabled; if (!enabled) this.finish(); }
  readStats() { return { sceneTransitions: this.cards.size, cameraTransition: this.camera !== undefined }; }
  dispose(): void { clearTimeout(this.timer); this.timer = undefined; this.camera = undefined; this.cards.clear(); this.translucent.clear(); }
}
