import type { CanvasCardId } from '../../../../shared';
import {
  setCanvasBitmapLayerAlpha,
  type CanvasBitmapLayer,
  type CanvasBitmapResources,
} from './canvasBitmapResources';

interface FadeLayer {
  readonly layer: CanvasBitmapLayer;
  readonly from: number;
}
interface Fade {
  readonly started: number;
  readonly previous: readonly FadeLayer[];
  readonly target: CanvasBitmapLayer;
}

/** 只在真实旧/新位图共存时运行；120ms任务脉冲只改alpha，不排版、不进入纯绘制RAF。 */
export class CanvasBitmapFades {
  private readonly fades = new Map<CanvasCardId, Fade>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private enabled = true;
  constructor(
    private readonly options: {
      readonly resources: Pick<CanvasBitmapResources, 'release'>;
      readonly requestDraw: () => void;
      readonly appeared: (id: CanvasCardId) => void;
      readonly complete: (id: CanvasCardId) => void;
    }
  ) {}
  private readonly pulse = () => {
    this.timer = undefined;
    const now = performance.now();
    for (const [id, fade] of this.fades) {
      const wasVisible = fade.target.alpha > 0,
        complete = this.advance(fade, now);
      if (!wasVisible && fade.target.alpha > 0) this.options.appeared(id);
      if (complete) this.finish(id);
    }
    this.options.requestDraw();
    this.schedule();
  };
  private schedule(): void {
    if (this.fades.size && this.timer === undefined) this.timer = setTimeout(this.pulse, 8);
  }
  private advance(fade: Fade, now: number): boolean {
    const progress = Math.min(1, (now - fade.started) / 120);
    for (const previous of fade.previous)
      setCanvasBitmapLayerAlpha(previous.layer, previous.from * (1 - progress));
    setCanvasBitmapLayerAlpha(fade.target, progress);
    return progress === 1;
  }
  start(
    id: CanvasCardId,
    previous: CanvasBitmapLayer | undefined,
    target: CanvasBitmapLayer
  ): void {
    const running = this.fades.get(id),
      now = performance.now();
    if (running) this.advance(running, now);
    if (!this.enabled || !previous) {
      this.finish(id);
      return;
    }
    // 新结果在120ms内再次到来时从当前混合权重继续，不能先把上一层跳到全清再重来。
    const layers = [...(running?.previous ?? []), { layer: previous, from: previous.alpha }].map(
      item => ({ layer: item.layer, from: item.layer.alpha })
    );
    setCanvasBitmapLayerAlpha(target, 0);
    this.fades.set(id, { started: now, previous: layers, target });
    this.schedule();
  }
  finish(id: CanvasCardId): void {
    const fade = this.fades.get(id);
    if (!fade) return;
    this.fades.delete(id);
    for (const previous of fade.previous)
      for (const region of previous.layer.regions) this.options.resources.release(region);
    if (fade.target.alpha === 0) this.options.appeared(id);
    setCanvasBitmapLayerAlpha(fade.target, 1);
    this.options.complete(id);
    if (!this.fades.size) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
  cancel(id: CanvasCardId): void {
    const fade = this.fades.get(id);
    if (!fade) return;
    this.fades.delete(id);
    for (const previous of fade.previous)
      for (const region of previous.layer.regions) this.options.resources.release(region);
    if (!this.fades.size) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
  finishOldest(): boolean {
    const first = this.fades.keys().next();
    if (first.done) return false;
    this.finish(first.value);
    return true;
  }
  has(id: CanvasCardId): boolean {
    return this.fades.has(id);
  }
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) for (const id of this.fades.keys()) this.finish(id);
  }
  readCount(): number {
    return this.fades.size;
  }
  readRetiringTiles(): number {
    let count = 0;
    for (const fade of this.fades.values())
      for (const previous of fade.previous) count += previous.layer.regions.length;
    return count;
  }
}
