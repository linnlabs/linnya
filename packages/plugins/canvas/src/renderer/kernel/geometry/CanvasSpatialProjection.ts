import type { CanvasCard, CanvasCardId, CanvasPoint, CanvasRectangle } from '../../../shared';
import type {
  CanvasSpatialCell,
  CanvasSpatialEntry,
  CanvasSpatialProjectionStats,
} from '../definitions/canvasSpatialProjection';
import { intersectCanvasRegion, subtractCanvasCover } from './canvasVisibleRegions';
import {
  canvasSpatialCell,
  canvasSpatialCellSize,
  canvasSpatialKeys,
  projectCanvasSpatialCell,
} from './canvasSpatialCells';
import { mergeCanvasRegionFragments } from './mergeCanvasRegionFragments';

/** 几何索引拥有自己的bounds快照：拖动会原地改display card，不能用同一引用判断位置是否变化。 */
export class CanvasSpatialProjection {
  private readonly entries = new Map<CanvasCardId, CanvasSpatialEntry>();
  private readonly cells = new Map<string, CanvasSpatialCell>();
  private readonly large = new Set<CanvasSpatialEntry>();
  private translucent: ReadonlySet<CanvasCardId> = new Set();
  private readonly cache = new Map<string, ReadonlyMap<CanvasCardId, readonly CanvasRectangle[]>>();
  private published = new Map<CanvasCardId, readonly CanvasRectangle[]>();
  private publishedKey = '';
  private candidateCards = 0;
  private queryCards = 0;
  private hitCandidates = 0;
  private cellBuilds = 0;
  setCards(cards: readonly CanvasCard[]): void {
    const ids = new Set(cards.map(card => card.id));
    for (const [id, entry] of this.entries)
      if (!ids.has(id)) {
        this.remove(entry);
        this.entries.delete(id);
      }
    cards.forEach((card, rank) => this.install(card, rank));
  }
  updateCards(cards: readonly CanvasCard[]): void {
    for (const card of cards) {
      const previous = this.entries.get(card.id);
      if (previous) this.install(card, previous.rank);
    }
  }
  setTranslucent(ids: ReadonlySet<CanvasCardId>): void {
    this.translucent = ids;
    for (const entry of this.entries.values())
      if (entry.opaque === ids.has(entry.card.id)) this.install(entry.card, entry.rank);
  }
  private install(card: CanvasCard, rank: number): void {
    const previous = this.entries.get(card.id);
    const opaque = !this.translucent.has(card.id);
    if (
      previous &&
      previous.opaque === opaque &&
      previous.rank === rank &&
      previous.bounds.x === card.x &&
      previous.bounds.y === card.y &&
      previous.bounds.width === card.width &&
      previous.bounds.height === card.height
    ) {
      previous.card = card;
      return;
    }
    if (previous) this.remove(previous);
    const bounds = { x: card.x, y: card.y, width: card.width, height: card.height },
      keys = canvasSpatialKeys(bounds);
    const entry = { card, rank, bounds, keys: keys ?? [], opaque };
    this.entries.set(card.id, entry);
    if (keys === null) {
      this.large.add(entry);
      this.invalidateLarge(bounds);
      return;
    }
    for (const key of keys) {
      let cell = this.cells.get(key);
      if (!cell) {
        const [x, y] = key.split(':').map(Number);
        cell = canvasSpatialCell(key, x, y);
        this.cells.set(key, cell);
      }
      cell.entries.add(entry);
      this.invalidateAddition(cell, entry);
    }
    this.publishedKey = '';
  }
  private invalidateAddition(cell: CanvasSpatialCell, entry: CanvasSpatialEntry): void {
    const projection = this.cache.get(cell.key);
    if (!projection) return;
    const bounds = intersectCanvasRegion(entry.bounds, cell.bounds);
    if (!bounds) return;
    let visible: readonly CanvasRectangle[] = [bounds];
    // 低层卡在原有上层纸面中移动时，缓存仍是精确答案。只用已显露的上层实体证明遮挡；
    // 证明不了就重算该格，不能用“移动了小距离”猜测不会露出正文。
    for (const id of projection.keys()) {
      const cover = this.entries.get(id);
      if (
        !cover ||
        !cover.opaque ||
        cover.rank <= entry.rank ||
        cover.bounds.width <= 12 ||
        cover.bounds.height <= 12
      )
        continue;
      const paper = {
        x: cover.bounds.x + 6,
        y: cover.bounds.y + 6,
        width: cover.bounds.width - 12,
        height: cover.bounds.height - 12,
      };
      visible = subtractCanvasCover(visible, paper);
      if (!visible.length) return;
    }
    this.cache.delete(cell.key);
  }
  private invalidateLarge(bounds: CanvasRectangle): void {
    for (const key of this.cache.keys()) {
      const [x, y] = key.split(':').map(Number);
      if (intersectCanvasRegion(bounds, canvasSpatialCell(key, x, y).bounds))
        this.cache.delete(key);
    }
    this.publishedKey = '';
  }
  private remove(entry: CanvasSpatialEntry): void {
    if (this.large.delete(entry)) this.invalidateLarge(entry.bounds);
    for (const key of entry.keys) {
      const cell = this.cells.get(key);
      cell?.entries.delete(entry);
      if (cell && !cell.entries.size) this.cells.delete(key);
      if (this.cache.get(key)?.has(entry.card.id)) this.cache.delete(key);
    }
    this.publishedKey = '';
  }
  private viewportCells(viewport: CanvasRectangle): ReadonlyMap<string, CanvasSpatialCell> {
    const result = new Map<string, CanvasSpatialCell>();
    for (const [key, cell] of this.cells)
      if (intersectCanvasRegion(viewport, cell.bounds)) result.set(key, cell);
    // 长卡只为当前视口交集建立格，不把全文的数千个空格登记成长期索引。
    for (const entry of this.large) {
      const bounds = intersectCanvasRegion(viewport, entry.bounds);
      if (!bounds) continue;
      const left = Math.floor(bounds.x / canvasSpatialCellSize),
        right = Math.ceil((bounds.x + bounds.width) / canvasSpatialCellSize) - 1;
      const top = Math.floor(bounds.y / canvasSpatialCellSize),
        bottom = Math.ceil((bounds.y + bounds.height) / canvasSpatialCellSize) - 1;
      for (let y = top; y <= bottom; y++)
        for (let x = left; x <= right; x++) {
          const key = `${x}:${y}`;
          if (!result.has(key)) result.set(key, canvasSpatialCell(key, x, y));
        }
    }
    return result;
  }
  project(viewport: CanvasRectangle): ReadonlyMap<CanvasCardId, readonly CanvasRectangle[]> {
    const cells = this.viewportCells(viewport),
      key = [...cells.keys()].sort().join('|');
    if (this.publishedKey === key && this.publishedKey) return this.published;
    const published = new Map<CanvasCardId, CanvasRectangle[]>(),
      candidates = new Set<CanvasCardId>();
    for (const [key, cell] of cells) {
      for (const entry of cell.entries) candidates.add(entry.card.id);
      let projection = this.cache.get(key);
      if (!projection) {
        projection = projectCanvasSpatialCell(cell, this.large);
        this.cache.set(key, projection);
        this.cellBuilds++;
      }
      for (const [id, regions] of projection) {
        const existing = published.get(id);
        if (existing) existing.push(...regions);
        else published.set(id, [...regions]);
      }
    }
    for (const entry of this.large)
      if (intersectCanvasRegion(entry.bounds, viewport)) candidates.add(entry.card.id);
    // 世界格缓存有界，不能让巡游过的五万字长卡留下无限排版投影。
    while (this.cache.size > 4096) {
      const first = this.cache.keys().next();
      if (first.done) break;
      this.cache.delete(first.value);
    }
    for (const [id, regions] of published) published.set(id, mergeCanvasRegionFragments(regions));
    this.published = published;
    this.publishedKey = key;
    this.candidateCards = candidates.size;
    this.queryCards = published.size;
    return published;
  }
  hitTest(point: CanvasPoint, accepts?: (card: CanvasCard) => boolean): CanvasCard | null {
    const key = `${Math.floor(point.x / canvasSpatialCellSize)}:${Math.floor(point.y / canvasSpatialCellSize)}`;
    const candidates = [...(this.cells.get(key)?.entries ?? []), ...this.large].filter(
      entry =>
        point.x >= entry.bounds.x &&
        point.x <= entry.bounds.x + entry.bounds.width &&
        point.y >= entry.bounds.y &&
        point.y <= entry.bounds.y + entry.bounds.height
    );
    this.hitCandidates = (this.cells.get(key)?.entries.size ?? 0) + this.large.size;
    candidates.sort((a, b) => b.rank - a.rank);
    for (const entry of candidates) if (!accepts || accepts(entry.card)) return entry.card;
    return null;
  }
  readStats(): CanvasSpatialProjectionStats {
    return {
      spatialCards: this.entries.size,
      spatialCells: this.cells.size,
      spatialLargeCards: this.large.size,
      spatialCachedCells: this.cache.size,
      spatialCellCapacity: 4096,
      spatialCandidateCards: this.candidateCards,
      spatialQueryCards: this.queryCards,
      spatialHitCandidates: this.hitCandidates,
      spatialCellBuilds: this.cellBuilds,
    };
  }
}
