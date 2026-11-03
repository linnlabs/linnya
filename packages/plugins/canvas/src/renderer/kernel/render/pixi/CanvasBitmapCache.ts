import { Container, Rectangle, Sprite, Texture, type TextureSource } from 'pixi.js';
import type { CanvasCardId, CanvasRectangle } from '../../../../shared';
import type { CanvasRasterTile } from '../../definitions/canvasKernel';
import { subtractCanvasRegions } from '../../geometry/canvasVisibleRegions';
import { selectCanvasRasterCoverage } from '../../geometry/selectCanvasRasterCoverage';

interface BitmapOwner { readonly source: TextureSource; readonly bitmap: ImageBitmap; readonly frame: CanvasRectangle }
interface Region extends CanvasRectangle { readonly scale: number; readonly owner: BitmapOwner; readonly sprite: Sprite; readonly texture: Texture }
interface Entry { readonly key: string; readonly regions: readonly Region[]; readonly bytes: number }
const owners = (regions: readonly Region[]) => new Set(regions.map(region => region.owner));
const size = (owner: BitmapOwner) => owner.bitmap.width * owner.bitmap.height * 4;
function releaseRegion(region: Region): void { region.sprite.removeFromParent(); region.sprite.destroy(); region.texture.destroy(false); }
function releaseOwner(owner: BitmapOwner): void { owner.source.destroy(); owner.bitmap.close(); }
function croppedRegion(owner: BitmapOwner, frame: CanvasRectangle, scale: number): Region {
  const source = owner.frame, x = (frame.x - source.x) / source.width * owner.bitmap.width, y = (frame.y - source.y) / source.height * owner.bitmap.height;
  const texture = new Texture({ source: owner.source, frame: new Rectangle(x, y, frame.width / source.width * owner.bitmap.width, frame.height / source.height * owner.bitmap.height) });
  const sprite = new Sprite(texture); sprite.position.set(frame.x, frame.y); sprite.width = frame.width; sprite.height = frame.height;
  return { ...frame, scale, owner, texture, sprite };
}

/** 持有位图唯一所有权与有界LRU；高倍补图只裁掉旧低倍重叠，不重叠叠画半透明笔画。 */
export class CanvasBitmapCache {
  private readonly entries = new Map<CanvasCardId, Entry>();
  private bytes = 0;
  constructor(private readonly options: { readonly budget: number; readonly changed: (id: CanvasCardId) => void }) {}
  has(id: CanvasCardId, key?: string): boolean { const entry = this.entries.get(id); return entry !== undefined && (key === undefined || entry.key === key); }
  covers(id: CanvasCardId, regions: readonly CanvasRectangle[]): boolean {
    const entry = this.entries.get(id); return entry !== undefined && subtractCanvasRegions(regions, entry.regions).length === 0;
  }
  missing(id: CanvasCardId, key: string, regions: readonly CanvasRectangle[], resolution: { readonly scale: number; readonly exact: boolean }): readonly CanvasRectangle[] {
    const entry = this.entries.get(id); return entry?.key === key ? subtractCanvasRegions(regions, selectCanvasRasterCoverage(entry.regions, resolution)) : regions;
  }
  touch(id: CanvasCardId): void { const entry = this.entries.get(id); if (entry) { this.entries.delete(id); this.entries.set(id, entry); } }
  remove(id: CanvasCardId): void {
    const entry = this.entries.get(id); if (!entry) return;
    entry.regions.forEach(releaseRegion); owners(entry.regions).forEach(releaseOwner);
    this.bytes -= entry.bytes; this.entries.delete(id); this.options.changed(id);
  }
  clear(): void { for (const id of this.entries.keys()) this.remove(id); }
  private upgrade(entry: Entry, tiles: readonly CanvasRasterTile[], body: Container): Entry {
    const regions = entry.regions.flatMap(region => {
      const remaining = subtractCanvasRegions([region], tiles.filter(tile => tile.scale > region.scale));
      if (remaining.length === 1 && remaining[0] === region) return [region];
      releaseRegion(region);
      return remaining.map(frame => { const next = croppedRegion(region.owner, frame, region.scale); body.addChild(next.sprite); return next; });
    });
    const retained = owners(regions);
    for (const owner of owners(entry.regions)) if (!retained.has(owner)) releaseOwner(owner);
    return { key: entry.key, regions, bytes: [...retained].reduce((sum, owner) => sum + size(owner), 0) };
  }
  install(id: CanvasCardId, key: string, tiles: readonly CanvasRasterTile[], body: Container): boolean {
    const previous = this.entries.get(id);
    let retained = previous?.key === key ? previous : undefined;
    const additions = tiles.filter(tile => {
      if (retained && !subtractCanvasRegions([tile], retained.regions.filter(region => region.scale === tile.scale)).length) { tile.bitmap.close(); return false; }
      return true;
    });
    if (!additions.length) return true;
    const bytes = additions.reduce((sum, tile) => sum + tile.bitmap.width * tile.bitmap.height * 4, 0);
    if (bytes > this.options.budget) { additions.forEach(tile => tile.bitmap.close()); return false; }
    if (retained) {
      const next = this.upgrade(retained, additions, body); this.bytes += next.bytes - retained.bytes;
      retained = next; this.entries.set(id, retained);
    }
    if (!retained || retained.bytes + bytes > this.options.budget) { this.remove(id); retained = undefined; }
    else this.touch(id);
    while (this.bytes + bytes > this.options.budget) { const first = this.entries.keys().next(); if (first.done) break; this.remove(first.value); }
    const regions = additions.map(tile => {
      const texture = Texture.from(tile.bitmap, true);
      const owner: BitmapOwner = { source: texture.source, bitmap: tile.bitmap, frame: { x: tile.x, y: tile.y, width: tile.width, height: tile.height } };
      const sprite = new Sprite(texture); sprite.position.set(tile.x, tile.y); sprite.width = tile.width; sprite.height = tile.height; body.addChild(sprite);
      return { ...owner.frame, owner, texture, sprite, scale: tile.scale };
    });
    this.entries.set(id, { key, regions: [...retained?.regions ?? [], ...regions], bytes: (retained?.bytes ?? 0) + bytes }); this.bytes += bytes;
    this.options.changed(id); return true;
  }
  readStats(): { readonly bitmaps: number; readonly bitmapBytes: number } { return { bitmaps: this.entries.size, bitmapBytes: this.bytes }; }
}
