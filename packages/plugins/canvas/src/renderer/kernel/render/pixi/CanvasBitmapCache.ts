import type { Container } from 'pixi.js';
import type { CanvasCardId, CanvasRectangle } from '../../../../shared';
import type { CanvasRasterTile } from '../../definitions/canvasKernel';
import { intersectCanvasRegion, subtractCanvasRegions } from '../../geometry/canvasVisibleRegions';
import { selectCanvasRasterCoverage } from '../../geometry/selectCanvasRasterCoverage';
import {
  CanvasBitmapResources,
  type CanvasBitmapLayer,
  type CanvasBitmapRegion,
} from './canvasBitmapResources';
import { CanvasBitmapFades } from './CanvasBitmapFades';

interface Entry extends CanvasBitmapLayer {
  readonly key: string;
  acceptedAfterRender: number;
  firstVisibleAfterRender: number | null;
}

/** 当前采样与120ms退休层共用唯一位图owner及同一个有界LRU预算。 */
export class CanvasBitmapCache {
  private readonly entries = new Map<CanvasCardId, Entry>();
  private readonly resources = new CanvasBitmapResources();
  private readonly fades;
  constructor(
    private readonly options: {
      readonly budget: number;
      readonly changed: (id: CanvasCardId) => void;
      readonly requestDraw: () => void;
      readonly readRenderCount: () => number;
      readonly readAvailableBudget?: () => number;
      readonly reserveExternal?: (incomingBytes: number, currentBytes: number) => void;
    }
  ) {
    this.fades = new CanvasBitmapFades({
      resources: this.resources,
      requestDraw: options.requestDraw,
      appeared: id => {
        const entry = this.entries.get(id);
        if (entry) entry.firstVisibleAfterRender = options.readRenderCount();
      },
      complete: id => {
        const entry = this.entries.get(id);
        if (entry) {
          entry.acceptedAfterRender = options.readRenderCount();
          options.changed(id);
        }
      },
    });
  }
  setMotionEnabled(enabled: boolean): void {
    this.fades.setEnabled(enabled);
  }
  finishTransitions(ids?: readonly CanvasCardId[]): void {
    for (const id of ids ?? this.entries.keys()) this.fades.finish(id);
  }
  has(id: CanvasCardId, key?: string): boolean {
    const entry = this.entries.get(id);
    return entry !== undefined && (key === undefined || entry.key === key);
  }
  covers(id: CanvasCardId, regions: readonly CanvasRectangle[]): boolean {
    const entry = this.entries.get(id);
    return entry !== undefined && subtractCanvasRegions(regions, entry.regions).length === 0;
  }
  missing(
    id: CanvasCardId,
    key: string,
    regions: readonly CanvasRectangle[],
    resolution: { readonly scale: number; readonly exact: boolean }
  ): readonly CanvasRectangle[] {
    const entry = this.entries.get(id);
    return entry?.key === key
      ? subtractCanvasRegions(regions, selectCanvasRasterCoverage(entry.regions, resolution))
      : regions;
  }
  touch(id: CanvasCardId): void {
    const entry = this.entries.get(id);
    if (entry) {
      this.entries.delete(id);
      this.entries.set(id, entry);
    }
  }
  remove(id: CanvasCardId): void {
    this.fades.cancel(id);
    const entry = this.entries.get(id);
    if (!entry) return;
    for (const region of entry.regions) this.resources.release(region);
    this.entries.delete(id);
    this.options.changed(id);
  }
  clear(): void {
    for (const id of this.entries.keys()) this.remove(id);
  }
  private availableBudget(): number {
    return Math.min(
      this.options.budget,
      this.options.readAvailableBudget?.() ?? this.options.budget
    );
  }
  trimTo(bytes: number): void {
    this.reserve(0, undefined, bytes);
  }
  private reserve(bytes: number, current?: CanvasCardId, limit = this.availableBudget()): void {
    while (this.resources.readBytes() + bytes > limit) {
      // 先结束退休层，再淘汰不相关卡；旧/新双份资源绝不突破原预算。
      if (this.fades.finishOldest()) continue;
      let candidate: CanvasCardId | undefined;
      for (const id of this.entries.keys())
        if (id !== current) {
          candidate = id;
          break;
        }
      if (candidate !== undefined) this.remove(candidate);
      else {
        if (current) this.remove(current);
        break;
      }
    }
  }
  private retained(
    previous: Entry | undefined,
    key: string,
    additions: readonly CanvasRasterTile[],
    body: Container
  ): CanvasBitmapRegion[] {
    if (previous?.key !== key) return [];
    return previous.regions.flatMap(region =>
      subtractCanvasRegions(
        [region],
        additions.filter(tile => tile.scale > region.scale)
      ).map(frame => {
        const next = this.resources.region(region.owner, frame, region.scale);
        body.addChild(next.sprite);
        return next;
      })
    );
  }
  private appendable(
    id: CanvasCardId,
    previous: Entry | undefined,
    key: string,
    additions: readonly CanvasRasterTile[]
  ): Entry | undefined {
    if (previous?.key !== key || this.fades.has(id)) return undefined;
    return additions.every(tile =>
      previous.regions.every(region => !intersectCanvasRegion(tile, region))
    )
      ? previous
      : undefined;
  }
  install(
    id: CanvasCardId,
    key: string,
    tiles: readonly CanvasRasterTile[],
    body: Container
  ): boolean {
    const existing = this.entries.get(id),
      same = existing?.key === key ? existing : undefined;
    const additions = tiles.filter(tile => {
      if (
        same &&
        !subtractCanvasRegions(
          [tile],
          same.regions.filter(region => region.scale === tile.scale)
        ).length
      ) {
        tile.bitmap.close();
        return false;
      }
      return true;
    });
    if (!additions.length) return true;
    const bytes = additions.reduce(
      (sum, tile) => sum + tile.bitmap.width * tile.bitmap.height * 4,
      0
    );
    // 正文也可回收未显示的身份牌页；不能让旧页占满共享预算后永久拒绝新正文。
    this.options.reserveExternal?.(bytes, this.resources.readBytes());
    if (bytes > this.availableBudget()) {
      additions.forEach(tile => tile.bitmap.close());
      return false;
    }
    this.reserve(bytes, id);
    const previous = this.entries.get(id);
    // 同一正文的未见区域没有旧像素可替换；保留既有Sprite，不能每补一条就重建并淡入整张卡。
    const append = this.appendable(id, previous, key, additions);
    const regions = append ? [...append.regions] : this.retained(previous, key, additions, body);
    for (const tile of additions) {
      const owner = this.resources.create(tile),
        region = this.resources.region(owner, tile, tile.scale);
      body.addChild(region.sprite);
      regions.push(region);
    }
    const next: Entry = {
      key,
      regions,
      alpha: 1,
      acceptedAfterRender: this.options.readRenderCount(),
      firstVisibleAfterRender: append?.firstVisibleAfterRender ?? this.options.readRenderCount(),
    };
    this.entries.delete(id);
    this.entries.set(id, next);
    if (append) {
      this.options.changed(id);
      return true;
    }
    // 首图未实际显示时直接接纳新图；不能为未见过的旧片制造一次模糊飞入。
    const displayed =
      previous &&
      (this.fades.has(id) || this.options.readRenderCount() > previous.acceptedAfterRender)
        ? previous
        : undefined;
    this.fades.start(id, displayed, next);
    if (this.fades.has(id)) next.firstVisibleAfterRender = null;
    if (!this.fades.has(id) && previous)
      for (const region of previous.regions) this.resources.release(region);
    this.options.changed(id);
    return true;
  }
  readReceipt(
    id: CanvasCardId,
    key: string
  ): {
    readonly acceptedAfterRender: number;
    readonly firstVisibleAfterRender: number | null;
  } | null {
    const entry = this.entries.get(id);
    return entry?.key === key ? entry : null;
  }
  isFading(id: CanvasCardId): boolean {
    return this.fades.has(id);
  }
  readStats() {
    const current = new Set<CanvasBitmapRegion['owner']>();
    let currentBytes = 0,
      rasterTiles = 0;
    for (const entry of this.entries.values())
      for (const region of entry.regions) {
        rasterTiles++;
        if (!current.has(region.owner)) {
          current.add(region.owner);
          currentBytes += region.owner.bitmap.width * region.owner.bitmap.height * 4;
        }
      }
    const retiringTiles = this.fades.readRetiringTiles();
    return {
      bitmaps: this.entries.size,
      bitmapBytes: this.resources.readBytes(),
      bitmapBudgetBytes: this.options.budget,
      fadingCards: this.fades.readCount(),
      retiringBytes: this.resources.readBytes() - currentBytes,
      retiringTiles,
      rasterTiles: rasterTiles + retiringTiles,
    };
  }
}
